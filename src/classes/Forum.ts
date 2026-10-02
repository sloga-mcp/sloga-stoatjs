// ----- Wire types -------------------------------------------------------------
// stoat-api 0.13.5 predates forums, so the wire shapes are declared locally
// (Thread.ts / CalendarEvent precedent) to match the Rust `v0` models exactly
// (serde: `_id`, snake_case, tagged `channel_type: "Forum"`).

import type {
  File as APIFile,
  Member as APIMember,
  Message as APIMessage,
  User as APIUser,
  DataMessageSend,
} from "stoat-api";

import type { ThreadChannelData } from "./Thread.js";

/** A tag that can be applied to posts in a forum channel. */
export interface ForumTag {
  /** Server-assigned ulid. */
  id: string;
  name: string;
  emoji?: string;
  /** Only members with ManageChannel may apply this tag. */
  moderated?: boolean;
}

/** Default ordering of a forum's post browse view. */
export type ForumSortOrder =
  | "LatestActivity"
  | "CreationDate"
  | "Alphabetical";

/**
 * How a forum lists its posts: `Modern` = preview cards, `Classic` = one row
 * per post, `ClassicPlus` = a table with reply and last-post columns.
 */
export type ForumLayout = "Modern" | "Classic" | "ClassicPlus";

/**
 * Serialized `v0::Channel::Forum` — a sixth channel variant. Posts are
 * threads whose `parent_channel` is the forum.
 */
export interface ForumChannelData {
  channel_type: "Forum";
  _id: string;
  server: string;
  name: string;
  description?: string;
  icon?: APIFile;
  /** Bumped to the starter message id when a post is created. */
  last_message_id?: string;
  default_permissions?: { a: number; d: number };
  role_permissions?: Record<string, { a: number; d: number }>;
  nsfw?: boolean;
  tags?: ForumTag[];
  require_tag?: boolean;
  default_sort?: ForumSortOrder;
  /**
   * Whether `default_sort` is imposed on every reader rather than being the
   * order the browse view merely opens on. The server enforces this, so a
   * `sort` the caller passes to `fetchPosts` is ignored while it is set.
   */
  force_sort?: boolean;
  /**
   * Default auto-archive duration (minutes) for new posts: 0 = never,
   * otherwise 1 up to two years (1_051_200). Omitted by older servers.
   */
  default_auto_archive_minutes?: number;
  /**
   * Layout the browse view opens on; each reader may override it locally.
   * Omitted by older servers, which means `Modern`.
   */
  default_layout?: ForumLayout;
}

/** Tag definition as submitted through `PATCH /channels/{id}` (`tags`). */
export interface DataForumTag {
  /** Id of an existing tag to keep/edit; omit for a new tag. */
  id?: string;
  name: string;
  emoji?: string;
  moderated?: boolean;
}

/** `POST /channels/{forum}/posts` body. */
export interface DataCreateForumPost {
  /** 1..=100 characters; becomes the thread name. */
  title: string;
  /** Ids of forum tags applied to this post. */
  tags?: string[];
  /**
   * Minutes; 0 = never, otherwise 1 up to two years (1_051_200).
   * Omit to use the forum's `default_auto_archive_minutes`.
   */
  auto_archive_minutes?: number;
  /** Starter message of the post. */
  message: DataMessageSend;
}

/** `POST /channels/{forum}/posts` response. */
export interface ForumPostResponse {
  post: ThreadChannelData;
  /** The starter message; its id equals the post's id. */
  message: APIMessage;
}

/**
 * Reply count and last message of one post, as returned by
 * `GET /channels/{forum}/posts?include_stats=true`.
 */
export interface ForumPostStats {
  /** Id of the post. */
  _id: string;
  /** Messages in the post other than its starter. */
  replies: number;
  /** Newest message in the post; the starter's id if nobody replied. */
  last_message_id?: string;
}

/** `GET /channels/{forum}/posts` response. */
export interface ForumPostsResponse {
  posts: ThreadChannelData[];
  /**
   * Starter messages for this page (present when `include_starters` was
   * set); each message's id equals its post's id.
   */
  starters?: APIMessage[];
  /**
   * One entry per post on this page (present when `include_stats` was set
   * and the caller has ReadMessageHistory). Absent, never empty, otherwise,
   * and always absent from older servers.
   */
  stats?: ForumPostStats[];
  /**
   * Last message of each post on this page, by `stats[].last_message_id`;
   * present under the same conditions as `stats`.
   */
  last_messages?: APIMessage[];
  /**
   * Users referenced by this page (present when `include_users` was set):
   * every post's creator, plus the authors of the starters and last
   * messages when the caller has ReadMessageHistory.
   */
  users?: APIUser[];
  /** Server members for `users` (present when `include_users` was set). */
  members?: APIMember[];
}
