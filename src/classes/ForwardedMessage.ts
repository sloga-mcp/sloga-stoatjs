/**
 * Forwarded-message types (local definitions — stoat-api 0.13.5 predates
 * forwarding, so the forward route goes through `apiReq`, same as polls
 * and threads).
 *
 * The `forwarded` snapshot is server-stamped by the forward route (which
 * verifies the forwarder could actually read the source); the regular
 * send/edit payloads have no such field, so it cannot be forged or edited.
 * It is a snapshot: edits or deletion of the original do not propagate.
 */
import type { File as APIFile } from "stoat-api";

import type { File } from "./File.js";

/** Immutable server-copied snapshot of a forwarded message (wire shape) */
export type ForwardedSnapshotData = {
  /** Id of the original message */
  message_id: string;
  /** Id of the channel the original message was sent in */
  channel_id: string;
  /** Id of the server the original channel belongs to, if any */
  server_id?: string;
  /** Id of the original author (absent when sent by a webhook) */
  author_id?: string;
  /** Content of the original message at forward time */
  content?: string;
  /** Copies of the original attachments (owned by the forwarding message) */
  attachments?: APIFile[];
  /** When the original message was sent (ms since epoch, UTC) */
  original_sent_at: number;
};

/** Local (hydrated) forwarded snapshot stored on the message */
export type HydratedForwardedSnapshot = {
  messageId: string;
  channelId: string;
  serverId?: string;
  authorId?: string;
  content?: string;
  attachments?: File[];
  originalSentAt: Date;
};
