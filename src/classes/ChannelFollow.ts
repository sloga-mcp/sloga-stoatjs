/**
 * Announcement-channel follow types (local definitions — stoat-api 0.13.5
 * predates announcement channels, so the follow routes go through `apiReq`,
 * same as polls, threads and scheduled messages).
 *
 * A follow links a source announcement channel to a target (follower)
 * channel in another server; each follow owns a real webhook in the target
 * channel that delivers published (crossposted) copies. The full follower
 * list is only fetchable with `ManageChannel` on the source channel.
 */

/**
 * Server-set attribution attached to a delivered crosspost copy (points at
 * the origin announcement message). The client renders "From {server} •
 * #{channel}" from these ids; a webhook masquerade can never forge them.
 */
export type CrosspostInfoData = {
  /** Id of the origin (published) message */
  message_id: string;
  /** Id of the origin announcement channel */
  channel_id: string;
  /** Id of the origin server */
  server_id: string;
};

/** A channel-follow row (wire shape) */
export type ChannelFollowData = {
  _id: string;
  /** Id of the source announcement channel */
  source_channel: string;
  /** Id of the server the source channel belongs to */
  source_server: string;
  /** Id of the target (follower) channel */
  target_channel: string;
  /** Id of the server the target channel belongs to */
  target_server: string;
  /** Id of the webhook created in the target channel */
  webhook_id: string;
  /** Id of the user who created the follow */
  created_by: string;
  /** When the follow was created (ms since epoch, UTC) */
  created_at: number;
};
