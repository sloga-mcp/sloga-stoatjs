/**
 * Protected channels (S1): wire shapes, client-side refusals and the list of
 * server-controlled message fields the SDK never stores for a protected row.
 *
 * Pure: no Client, Solid or storage imports, so specs load it directly.
 */

/**
 * `Message.encrypted` on a protected-channel row (design 2.6). Must stay
 * structurally identical to the client's `protectedTextTypes.ts`
 * `EncryptedPayload`; it is handed to native verbatim.
 */
export type EncryptedPayload = {
  v: 1;
  group_id: string;
  epoch: number;
  sender_device_id: string;
  nonce: string;
  ciphertext: string;
  sig: string;
  franking?: unknown;
};

/**
 * The body of a protected send (`POST /channels/:id/messages`): the native
 * cid as the message nonce plus the encrypted payload. No plaintext field.
 */
export type DataProtectedSend = {
  nonce: string;
  encrypted: EncryptedPayload;
  flags?: 0 | 1;
};

/**
 * Thrown by `Channel.sendMessage` for a protected channel when no E2EE
 * adapter can send to it (web, or a shell without the protected send arm).
 * The message is never sent in plaintext instead.
 */
export class ProtectedChannelUnavailable extends Error {
  constructor() {
    super("ProtectedChannelUnavailable");
    this.name = "ProtectedChannelUnavailable";
  }
}

/**
 * Thrown by `Message.edit` for a message in a protected channel: edits are
 * not supported there in S1, and a PATCH would carry plaintext.
 */
export class ProtectedChannelEditRefused extends Error {
  constructor() {
    super("ProtectedChannelEditRefused");
    this.name = "ProtectedChannelEditRefused";
  }
}

/**
 * Thrown by `Channel.sendMessage` for a protected channel when the send
 * data carries a field that cannot travel end-to-end encrypted in S1. The
 * field is refused, never stripped, so nothing is silently dropped.
 */
export class ProtectedFieldRefusedClient extends Error {
  readonly field: ProtectedRefusedSendField;

  constructor(field: ProtectedRefusedSendField) {
    super(`ProtectedFieldRefusedClient: ${field}`);
    this.name = "ProtectedFieldRefusedClient";
    this.field = field;
  }
}

/**
 * Send-data fields refused for a protected channel (plan D9b).
 */
export const PROTECTED_REFUSED_SEND_FIELDS = [
  "attachments",
  "e2eeAttachments",
  "sticker_ids",
  "embeds",
  "masquerade",
  "interactions",
] as const;

export type ProtectedRefusedSendField =
  (typeof PROTECTED_REFUSED_SEND_FIELDS)[number];

/**
 * Throw `ProtectedFieldRefusedClient` for the first refused field the send
 * data carries. `undefined`, `null` and an empty array carry nothing and
 * pass; any other value (an empty object included) is refused.
 * @param data Send data
 */
export function assertProtectedSendable(data: object): void {
  const record = data as Record<string, unknown>;
  for (const field of PROTECTED_REFUSED_SEND_FIELDS) {
    const value = record[field];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    throw new ProtectedFieldRefusedClient(field);
  }
}

/**
 * Server-controlled message fields (wire names) dropped before storing any
 * row that carries `encrypted` or sits in a protected or pinned channel
 * (plan D25, widened by the W4a audit to every server-stamped field that
 * renders text or attribution: poll, softres, the forwarded snapshot with
 * its content, crosspost, command context, webhook and thread anchor). The mention flags are cleared separately
 * ({@link PROTECTED_STRIPPED_FLAG_POSITIONS}).
 */
export const PROTECTED_STRIPPED_FIELDS = [
  "content",
  "embeds",
  "attachments",
  "masquerade",
  "interactions",
  "components",
  "system",
  "replies",
  "mentions",
  "role_mentions",
  "poll",
  "softres",
  "forwarded",
  "crosspost",
  "command_context",
  "webhook",
  "thread_id",
] as const;

export type ProtectedStrippedField = (typeof PROTECTED_STRIPPED_FIELDS)[number];

/**
 * Message flag bit POSITIONS cleared on a protected row: mention-everyone
 * (2) and mention-online (3). Both are server-controlled mass mentions.
 */
export const PROTECTED_STRIPPED_FLAG_POSITIONS = [2, 3] as const;

/**
 * Clear the mass-mention flag bits from a protected row's flags.
 * @param flags Wire flags
 */
export function stripProtectedFlags(flags: number): number {
  let out = flags;
  for (const position of PROTECTED_STRIPPED_FLAG_POSITIONS) {
    out &= ~(1 << position);
  }
  return out;
}

/**
 * Whether a wire message carries an `encrypted` payload. The server refuses
 * `encrypted` outside protected channels, so presence alone marks the row
 * as protected (plan D25), whatever the local channel cache says.
 * @param message Wire message (full or partial)
 */
export function carriesEncrypted(message: object): boolean {
  const value = (message as { encrypted?: unknown }).encrypted;
  return value !== undefined && value !== null;
}
