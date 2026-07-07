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
};

/**
 * E2EE events forwarded to the adapter (see `E2EEAdapter.onEvent`).
 */
export type E2EEServerEvent =
  | ({ type: "E2EEMessage" } & E2EEEnvelope)
  | { type: "E2EEDeviceCreate"; user_id: string; device_id: string }
  | { type: "E2EEDeviceDelete"; user_id: string; device_id: string }
  | { type: "E2EEChallenge"; nonce: string }
  | { type: "E2EEClaimResult"; device_id: string; accepted: boolean };

/**
 * Client messages the adapter may send over the events connection.
 */
export type E2EEClientMessage =
  | { type: "E2EERequestChallenge"; device_id: string }
  | { type: "E2EEProveDevice"; device_id: string; signature: string }
  | { type: "E2EEAck"; ids: string[] };

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
   * For an encrypt-mode conversation this either delivers the message
   * end-to-end encrypted and returns the local echo, or THROWS. It never
   * returns `null` on failure: a bundle-fetch error, key revocation or
   * identity change mid-send is a hard, user-visible error — never an
   * automatic plaintext fallback.
   */
  handleDirectMessageSend(
    channel: Channel,
    data: DataMessageSend,
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
   * Fail-closed gate at the shared upload/send chokepoint. THROWS (never
   * returns) when this DM send must not proceed down the plaintext path —
   * in particular so attachments are blocked BEFORE any plaintext upload to
   * Autumn, from EVERY caller (composer, retry, future callers). No-op for
   * plaintext-mode conversations and non-DM channels. Callers must invoke
   * this before uploading attachments or posting the plaintext message.
   */
  guardSend(channel: Channel, hasAttachments: boolean): Promise<void>;

  /**
   * An E2EE event arrived on the events connection (envelope push,
   * device-list change, claim challenge/result).
   */
  onEvent(event: E2EEServerEvent): void;
}
