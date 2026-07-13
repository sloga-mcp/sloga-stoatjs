/**
 * Scheduled-message types (local definitions — stoat-api 0.13.5 predates
 * scheduling, so the routes go through `apiReq`, same as polls and
 * threads).
 *
 * Pending scheduled messages are strictly author-private: the list route
 * only returns the caller's own rows and the related events arrive on the
 * author's private topic. They are ephemeral client state — a lightweight
 * per-client ReactiveMap (`client.scheduledMessages`), not a full store
 * collection.
 */
import type { DataMessageSend } from "stoat-api";

/** Lifecycle state of a scheduled message */
export type ScheduledMessageStatus = "Pending" | "Sending" | "Sent" | "Failed";

/** A scheduled message row (wire shape, author-private) */
export type ScheduledMessageData = {
  _id: string;
  /** Id of the scheduling user */
  author: string;
  /** Id of the target channel */
  channel: string;
  /** When the message should be sent (ms since epoch, UTC; ~30s jitter) */
  scheduled_at: number;
  /** The composed message payload, sent verbatim at fire time */
  data: DataMessageSend;
  status: ScheduledMessageStatus;
  /** Why delivery failed, when status is `Failed` */
  failure_reason?: string;
};
