// ----- Wire types -------------------------------------------------------------
// stoat-api 0.13.5 predates forums, so the wire shapes are declared locally
// (Thread.ts / CalendarEvent precedent) to match the Rust `v0` models exactly
// (serde: `_id`, snake_case, tagged `channel_type: "Forum"`).

import type {
  File as APIFile,
  Message as APIMessage,
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
export type ForumSortOrder = "LatestActivity" | "CreationDate";

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
  /** One of 60 / 1440 / 4320 / 10080 (minutes), defaults to 1440. */
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

/** `GET /channels/{forum}/posts` response. */
export interface ForumPostsResponse {
  posts: ThreadChannelData[];
  /**
   * Starter messages for this page (present when `include_starters` was
   * set); each message's id equals its post's id.
   */
  starters?: APIMessage[];
}
