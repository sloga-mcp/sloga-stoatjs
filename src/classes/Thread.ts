// ----- Wire types -------------------------------------------------------------
// stoat-api 0.13.5 predates threads, so the wire shapes are declared locally
// (CalendarEvent precedent) to match the Rust `v0` models exactly
// (serde: `_id`, snake_case, tagged `channel_type: "Thread"`).

/**
 * Serialized `v0::Channel::Thread` — a fifth channel variant. All
 * thread-specific fields are additive; older servers never emit them.
 */
export interface ThreadChannelData {
  channel_type: "Thread";
  _id: string;
  server: string;
  /** The parent TextChannel this thread hangs off (permission source). */
  parent_channel: string;
  name: string;
  /** User id of the thread creator (server-stamped). */
  creator: string;
  /** Message in the parent channel this thread was created from, if any. */
  origin_message_id?: string;
  last_message_id?: string;
  /** Server-set only — never accepted from clients. */
  archived?: boolean;
  archived_timestamp?: string;
  /** One of 60 / 1440 / 4320 / 10080 (minutes). */
  auto_archive_minutes?: number;
  locked?: boolean;
}

/**
 * `POST /channels/{target}/threads` and
 * `POST /channels/{target}/messages/{msg}/threads` body.
 */
export interface DataCreateThread {
  name: string;
  auto_archive_minutes?: number;
}

// NOTE: `GET /channels/{thread}/thread_members` returns a plain `string[]`
// of user ids — there is no member-object wire shape.
