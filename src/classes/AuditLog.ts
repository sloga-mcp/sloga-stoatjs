import type { User as APIUser } from "stoat-api";

// ----- Wire types -------------------------------------------------------------
// stoat-api 0.13.5 has no audit log types, so the wire shapes are declared
// locally (CalendarEvent / Interaction precedent) to match the Rust
// `v0::audit_log` models exactly (serde: `_id`, snake_case).
//
// Literal unions only, no enums: the client's node:test type-stripping
// rejects TypeScript enums.

/**
 * Kind of audited action (`v0::AuditLogAction`, serde `snake_case`).
 *
 * The Rust enum also has an `Unknown` variant (`#[serde(other)]`) that an
 * entry stored by a newer build decodes to; it is not a filter value, so it
 * is not listed here. `AuditLogEntryData.action` accepts any string so such
 * entries still type-check and the client can render a fallback.
 */
export type AuditLogAction =
  | "member_kick"
  | "member_ban_add"
  | "member_ban_remove"
  | "member_timeout"
  | "member_timeout_remove"
  | "member_role_update"
  | "member_update"
  | "member_voice_update"
  | "member_move"
  | "member_disconnect"
  | "message_delete"
  | "message_bulk_delete"
  | "channel_create"
  | "channel_update"
  | "channel_delete"
  | "channel_overwrite_update"
  | "server_permissions_update"
  | "role_create"
  | "role_update"
  | "role_delete"
  | "role_ranks_update"
  | "server_update"
  | "server_owner_transfer";

const ACTIONS = [
  "member_kick",
  "member_ban_add",
  "member_ban_remove",
  "member_timeout",
  "member_timeout_remove",
  "member_role_update",
  "member_update",
  "member_voice_update",
  "member_move",
  "member_disconnect",
  "message_delete",
  "message_bulk_delete",
  "channel_create",
  "channel_update",
  "channel_delete",
  "channel_overwrite_update",
  "server_permissions_update",
  "role_create",
  "role_update",
  "role_delete",
  "role_ranks_update",
  "server_update",
  "server_owner_transfer",
] as const satisfies readonly AuditLogAction[];

// Compile-time guard: fails to type-check if an action is missing from
// `ACTIONS` (`satisfies` above already rejects an entry that is not one).
type _MissingAction = Exclude<AuditLogAction, (typeof ACTIONS)[number]>;
const _allActionsListed: [_MissingAction] extends [never] ? true : false = true;

/** Every known action, in the backend's declaration order. */
export const AUDIT_LOG_ACTIONS: readonly AuditLogAction[] = ACTIONS;

/**
 * A typed value inside an audit log change (`v0::AuditValue`, serde
 * adjacently tagged: `{ "type": ..., "value": ... }`).
 *
 * `Int` is an `i64` on the server; values beyond 2^53 lose precision when
 * parsed as a JS number.
 */
export type AuditValue =
  | { type: "String"; value: string }
  | { type: "Int"; value: number }
  | { type: "Bool"; value: boolean }
  | { type: "StringList"; value: string[] };

/**
 * One field an audited action changed (`v0::AuditLogChange`).
 *
 * `old` / `new` are omitted on the wire when there is no value.
 */
export interface AuditLogChangeData {
  /** Name of the changed field (snake_case) */
  key: string;
  /** Value before the action, if there was one */
  old?: AuditValue;
  /** Value after the action, if there is one */
  new?: AuditValue;
}

/**
 * One moderation or configuration action taken in a server
 * (`v0::AuditLogEntry`).
 *
 * Every optional field is OMITTED on the wire when empty, never sent as
 * `null`. An absent `changes` means no changes (`[]`).
 */
export interface AuditLogEntryData {
  /** Unique Id (ULID); also the paging cursor */
  _id: string;
  /** Id of the server the action was taken in */
  server: string;
  /** Id of the user who took the action (absent = the system) */
  actor?: string;
  /**
   * What kind of action this was. Any other string (such as `"unknown"`)
   * is an action this build does not know.
   */
  action: AuditLogAction | (string & {});
  /**
   * Id of the object acted on (a user, channel or role id, or `"default"`
   * for default permissions), if the action has one
   */
  target?: string;
  /** Id of the channel the action happened in, if relevant */
  channel?: string;
  /** Typed before/after values; absent means `[]` */
  changes?: AuditLogChangeData[];
  /** How many objects the action affected (bulk actions only) */
  count?: number;
  /** The moderator's reason, if one was given */
  reason?: string;
}

/**
 * Query for `GET /servers/<id>/audit_log` (`v0::OptionsFetchAuditLog`).
 *
 * Unset keys must be OMITTED from the request: an empty `user=` filters on an
 * actor id of `""` and returns an empty page that looks like the end of the
 * log.
 */
export interface AuditLogQuery {
  /**
   * Only return entries older than this one: the `_id` of the LAST (oldest)
   * entry of the previous page, verbatim (a 26-character ULID)
   */
  before?: string;
  /** Maximum number of entries (clamped to 1..=100 by the server, default 50) */
  limit?: number;
  /** Only return entries of this action */
  action?: AuditLogAction;
  /** Only return entries taken by this user id */
  user?: string;
}

/**
 * One page of a server's audit log (`v0::AuditLogPage`).
 *
 * The end of the log is an EMPTY `entries` array. A page shorter than `limit`
 * is NOT the end: entries the server cannot decode are skipped after the
 * limit has been applied.
 */
export interface AuditLogPage {
  /** Entries, newest first */
  entries: AuditLogEntryData[];
  /**
   * The users the entries refer to, as the caller sees them. Order is not
   * guaranteed (index them by `_id`); a deleted user is absent.
   */
  users: APIUser[];
}
