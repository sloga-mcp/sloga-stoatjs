import type { DataMessageSend } from "stoat-api";

import type { Channel } from "./Channel.js";
import type { Message } from "./Message.js";

/**
 * An E2EE envelope delivered to this device (mirrors the server's
 * `E2EEMessage` event payload).
 */
export type E2EEEnvelope = {
  id: string;
  recipient_user_id: string;
  recipient_device_id: string;
  sender_user_id: string;
  sender_device_id: string;
  protocol_version: number;
  sequence: number;
  ciphertext: string;
  /**
   * Content discriminator. Absent or `olm` for text envelopes; `mls_commit` /
   * `mls_welcome` for the media-E2EE MLS handshake envelopes (slice 6), which
   * additionally carry `group_id` + `epoch`. The server has stamped this on
   * every envelope since slice 6.1 (defaults to `olm` for legacy rows).
   */
  content_type?: "olm" | "mls_commit" | "mls_welcome" | "mls_ctl";
  /** MLS group id (mls_* content only) */
  group_id?: string;
  /** MLS epoch this envelope establishes (mls_* content only) */
  epoch?: number;
};

/**
 * E2EE events forwarded to the adapter (see `E2EEAdapter.onEvent`).
 */
export type E2EEServerEvent =
  | ({ type: "E2EEMessage" } & E2EEEnvelope)
  | { type: "E2EEDeviceCreate"; user_id: string; device_id: string }
  | { type: "E2EEDeviceDelete"; user_id: string; device_id: string }
  | { type: "E2EEChallenge"; nonce: string }
  | { type: "E2EEClaimResult"; device_id: string; accepted: boolean }
  // Media E2EE (MLS, slice 6). Fanned out on the recipient user's private
  // topic like E2EEMessage; the adapter routes them to the active call
  // session. `MlsJoinRequested` is the admit trigger; `MlsCommit` /
  // `MlsWelcome` wrap an MLS handshake envelope (queue-first, so dedup by
  // envelope ULID and order per group by consecutive epoch).
  | {
      type: "MlsJoinRequested";
      group_id: string;
      channel_id: string;
      user_id: string;
      device_id: string;
      key_package_ref: string;
      signature: string;
      /** The intent came from a device that is ALREADY a member: its leaf
       * is stale (local state wiped) and verifying members should REMOVE it
       * so the device's next normal intent can be admitted. Optional — an
       * older server never sends it. */
      rejoin?: boolean;
    }
  | ({ type: "MlsCommit" } & E2EEEnvelope)
  | ({ type: "MlsWelcome" } & E2EEEnvelope)
  // An MLS application-message envelope (the §3.4 downgrade ctl-announce,
  // slice 6.5). Same ULID-dedup contract as MlsCommit but NO epoch
  // ordering — a ctl must never park the per-group drain.
  | ({ type: "MlsCtl" } & E2EEEnvelope);

/**
 * Client messages the adapter may send over the events connection.
 */
export type E2EEClientMessage =
  | { type: "E2EERequestChallenge"; device_id: string }
  | { type: "E2EEProveDevice"; device_id: string; signature: string }
  | { type: "E2EEAck"; ids: string[] };

/**
 * Message-send data extended with prepared encrypted attachments: local
 * ids returned by `prepareDraftAttachments`, whose refs (blob id, per-file
 * key, digest, name, mime, size) travel INSIDE the envelope ciphertext.
 * Never serialized to the plaintext message route.
 */
export type E2EEDataMessageSend = DataMessageSend & {
  e2eeAttachments?: string[];
};

/**
 * A file staged on a draft, as handed to `prepareDraftAttachments`.
 */
export type E2EEDraftFile = {
  file: File;
  /** Upload progress callback (0..1) */
  onProgress?: (fraction: number) => void;
};

/**
 * Bridge between the client and a native E2EE layer (the Tauri desktop
 * shell, or Android's uniffi binding). Key material NEVER crosses this
 * interface — the adapter talks to the native layer over IPC and only
 * public keys, ciphertext and decrypted-for-display content move through.
 *
 * Set `client.e2ee` on platforms that have a native layer; leave it unset
 * on the web, where E2EE routes are additionally refused server-side.
 */
export interface E2EEAdapter {
  /**
   * Handle a direct-message send — THE single choke point for the
   * plaintext-downgrade surface (invariants 1–3). Called by
   * `Channel.sendMessage` for every DM before the plaintext path.
   *
   * MUST return `null` if and ONLY if the native layer's send-mode decision
   * is `plaintext` (a never-encrypted conversation with a never-pinned
   * peer) — the caller then proceeds with the ordinary message path.
   *
   * For a plaintext-mode conversation whose peer ADVERTISES E2EE opt-in
   * (`User.e2eeEnabled`), the adapter should first attempt a sender-initiated
   * upgrade: fetch + verify the peer's key bundle and deliver this message
   * encrypted (establishing the sticky encrypted state). The advertisement is
   * an upgrade trigger only — if the peer turns out to have no verified keys,
   * the conversation remains plaintext exactly as if never advertised (no
   * pins are created), and `null` is returned. Once ANY state was pinned by
   * the attempt, failures are hard errors like the encrypt-mode path.
   *
   * For an encrypt-mode conversation this either delivers the message
   * end-to-end encrypted and returns the local echo, or THROWS. It never
   * returns `null` on failure: a bundle-fetch error, key revocation or
   * identity change mid-send is a hard, user-visible error — never an
   * automatic plaintext fallback.
   */
  handleDirectMessageSend(
    channel: Channel,
    data: E2EEDataMessageSend,
  ): Promise<Message | null>;

  /**
   * Device-local decrypted history for an E2EE conversation, or `null`
   * when the conversation is in plaintext mode (server history applies —
   * the local store is the ONLY history for E2EE DMs). Only `before` and
   * `limit` are meaningful for the local store; other query params yield
   * an empty page.
   */
  fetchLocalHistory(
    channel: Channel,
    params?: { limit?: number; before?: string },
  ): Promise<Message[] | null>;

  /**
   * Whether a message id is one the native layer decrypted and injected
   * locally (i.e. genuinely end-to-end encrypted). This is the ONLY trusted
   * source of a message's encrypted-ness — never a message flag, which the
   * server controls and could forge to fake a lock or mislabel a report.
   */
  isEncryptedMessage(id: string): boolean;

  /**
   * Fail-closed gate at the shared upload/send chokepoint (slice 3.5) —
   * EVERY caller that sends a draft (composer, retry, future callers) MUST
   * route its staged files through here BEFORE any plaintext byte reaches
   * the ordinary Autumn upload path.
   *
   * Decides from native local truth:
   * - plaintext-mode conversation (or non-DM / no adapter reachable
   *   verdict of plaintext): returns `null` — the caller proceeds with the
   *   ordinary plaintext upload path.
   * - encrypt mode: encrypts every file natively (per-file random key),
   *   uploads the CIPHERTEXT to the opaque-blob route, and returns the
   *   prepared local ids for `e2eeAttachments`. Plaintext never leaves the
   *   device. Throws on any failure — never a plaintext fallback.
   * - blocked (peer identity change pending) or an unverifiable native
   *   state: THROWS, even for text-only drafts.
   *
   * Called with no files it still performs the blocked/verifiability check
   * (and returns `null`), preserving the early fail-closed gate.
   */
  prepareDraftAttachments(
    channel: Channel,
    items: E2EEDraftFile[],
  ): Promise<string[] | null>;

  /**
   * Handle a GROUP-channel send (slice 5). The single choke point for group
   * plaintext-downgrade, mirroring `handleDirectMessageSend`: returns `null`
   * ONLY when the native group send-mode verdict is `plaintext` (the group
   * was never encrypted). For an encrypted group this delivers the message
   * end-to-end to the pinned roster or THROWS — never a silent plaintext
   * fallback. There is no group sender-initiated upgrade: a group becomes
   * encrypted only via the explicit `enableGroupEncryption` action.
   */
  handleGroupMessageSend(
    channel: Channel,
    data: E2EEDataMessageSend,
  ): Promise<Message | null>;

  /**
   * An E2EE event arrived on the events connection (envelope push,
   * device-list change, claim challenge/result).
   */
  onEvent(event: E2EEServerEvent): void;
}
