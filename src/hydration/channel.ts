import { ReactiveMap } from "@solid-primitives/map";
import { ReactiveSet } from "@solid-primitives/set";
import type { Channel as APIChannel } from "stoat-api";

import type { Client } from "../Client.js";
import { File } from "../classes/File.js";
import type {
  ForumChannelData,
  ForumLayout,
  ForumSortOrder,
  ForumTag,
} from "../classes/Forum.js";
import type { ThreadChannelData } from "../classes/Thread.js";
import { VoiceParticipant } from "../classes/VoiceParticipant.js";
import type { Merge } from "../lib/merge.js";

import type { Hydrate } from "./index.js";

/**
 * What the server reports about a protected channel's pre-protect history
 * (S4): the boundary message id and where the history wipe stands. `at` is
 * the server's ISO 8601 timestamp, `by` a user id, `count` the rows deleted.
 *
 * Informational. Nothing decides a row's rendering from it: that comes from
 * native verified state (see `Client.revealPreProtectRows`). The SDK uses it
 * for the wipe purge only, which removes cached text and reveals nothing.
 */
export type ChannelProtectedHistory = {
  boundary: string;
  wipe:
    | { state: "none" }
    | { state: "requested"; at: string; by: string }
    | { state: "done"; at: string; count: number };
};

/**
 * Whether a value is a non-empty string.
 * @param value Value
 */
function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Read a wire `protected_history`. Strict: a non-empty string boundary and
 * a known wipe state with each of its fields well-formed. Anything else is
 * `undefined`; never throws. The result holds the known fields only.
 * @param raw Wire value
 */
export function parseChannelProtectedHistory(
  raw: unknown,
): ChannelProtectedHistory | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { boundary, wipe } = raw as { boundary?: unknown; wipe?: unknown };
  if (!nonEmptyString(boundary)) return undefined;
  if (typeof wipe !== "object" || wipe === null) return undefined;

  const { state, at, by, count } = wipe as Record<string, unknown>;
  switch (state) {
    case "none":
      return { boundary, wipe: { state: "none" } };
    case "requested":
      if (!nonEmptyString(at) || !nonEmptyString(by)) return undefined;
      return { boundary, wipe: { state: "requested", at, by } };
    case "done":
      if (
        !nonEmptyString(at) ||
        !Number.isSafeInteger(count) ||
        (count as number) < 0
      ) {
        return undefined;
      }
      return { boundary, wipe: { state: "done", at, count: count as number } };
    default:
      return undefined;
  }
}

export type HydratedChannel = {
  id: string;
  channelType: APIChannel["channel_type"] | "Thread" | "Forum";

  name: string;
  description?: string;
  icon?: File;

  active: boolean;
  typingIds: ReactiveSet<string>;
  recipientIds: ReactiveSet<string>;

  userId?: string;
  ownerId?: string;
  serverId?: string;

  permissions?: bigint;
  defaultPermissions?: { a: bigint; d: bigint };
  rolePermissions?: Record<string, { a: bigint; d: bigint }>;
  nsfw: boolean;
  /** Whether clients hide this channel behind a click-to-reveal gate */
  spoiler: boolean;
  slowmode: number;
  /** Whether this text channel is an announcement channel (crosspost source) */
  announcement: boolean;
  /**
   * Whether the server reports this channel as a Protected channel. One-way
   * once true: `ChannelUpdate` never lowers it (see `Client.isProtectedChannel`
   * for the pin-aware predicate).
   */
  protected: boolean;
  /**
   * The server's report of this protected channel's pre-protect history
   * (server text channels only; absent on a channel protected while empty).
   * Informational: see {@link ChannelProtectedHistory}.
   */
  protectedHistory?: ChannelProtectedHistory;
  /**
   * Whether the server marks this group encrypted-only (groups only).
   * One-way once true: no later object lowers it.
   */
  e2eeOnly: boolean;

  lastMessageId?: string;

  voice?: { maxUsers?: number };

  // Thread ("Thread" channel_type) fields — additive, absent on other types.
  parentChannelId?: string;
  originMessageId?: string;
  creatorId?: string;
  archived: boolean;
  archivedTimestamp?: Date;
  autoArchiveMinutes?: number;
  locked: boolean;

  // Forum ("Forum" channel_type) fields — additive, absent on other types.
  tags?: ForumTag[];
  requireTag: boolean;
  defaultSort?: ForumSortOrder;
  /** Whether `defaultSort` is imposed on every reader of this forum. */
  forceSort: boolean;
  /** Layout this forum shows readers who have not picked their own. */
  defaultLayout?: ForumLayout;
  /**
   * Default auto-archive duration (minutes) for new posts in this forum.
   * 0 means never auto-archive; undefined means the server default applies.
   */
  defaultAutoArchiveMinutes?: number;
  // Forum-post (thread under a forum) applied tag ids.
  appliedTags?: string[];
};

export const channelHydration: Hydrate<
  // `announcement`, `spoiler`, `protected`, `protected_history` and
  // `e2ee_only` are additive; stoat-api 0.13.5 predates them.
  Merge<APIChannel | ThreadChannelData | ForumChannelData> & {
    announcement?: boolean;
    spoiler?: boolean;
    protected?: boolean;
    protected_history?: ChannelProtectedHistory;
    e2ee_only?: boolean;
  },
  HydratedChannel
> = {
  keyMapping: {
    _id: "id",
    channel_type: "channelType",
    recipients: "recipientIds",
    user: "userId",
    owner: "ownerId",
    server: "serverId",
    default_permissions: "defaultPermissions",
    role_permissions: "rolePermissions",
    last_message_id: "lastMessageId",
    slowmode: "slowmode",
    announcement: "announcement",
    spoiler: "spoiler",
    protected: "protected",
    protected_history: "protectedHistory",
    e2ee_only: "e2eeOnly",
    parent_channel: "parentChannelId",
    origin_message_id: "originMessageId",
    creator: "creatorId",
    archived_timestamp: "archivedTimestamp",
    auto_archive_minutes: "autoArchiveMinutes",
    tags: "tags",
    require_tag: "requireTag",
    default_sort: "defaultSort",
    force_sort: "forceSort",
    default_layout: "defaultLayout",
    default_auto_archive_minutes: "defaultAutoArchiveMinutes",
    applied_tags: "appliedTags",
  },
  functions: {
    id: (channel) => channel._id,
    channelType: (channel) => channel.channel_type,
    name: (channel) => channel.name,
    description: (channel) => channel.description!,
    icon: (channel, ctx) => new File(ctx as Client, channel.icon!),
    active: (channel) => channel.active || false,
    typingIds: () => new ReactiveSet(),
    recipientIds: (channel) => new ReactiveSet(channel.recipients),
    userId: (channel) => channel.user,
    ownerId: (channel) => channel.owner,
    serverId: (channel) => channel.server,
    permissions: (channel) => BigInt(channel.permissions!),
    defaultPermissions: (channel) => ({
      a: BigInt(channel.default_permissions?.a ?? 0),
      d: BigInt(channel.default_permissions?.d ?? 0),
    }),
    rolePermissions: (channel) =>
      Object.fromEntries(
        Object.entries(channel.role_permissions ?? {}).map(([k, v]) => [
          k,
          {
            a: BigInt(v.a),
            d: BigInt(v.d),
          },
        ]),
      ),
    nsfw: (channel) => channel.nsfw || false,
    spoiler: (channel) => channel.spoiler ?? false,
    lastMessageId: (channel) => channel.last_message_id!,
    slowmode: (channel) => channel.slowmode ?? 0,
    announcement: (channel) => channel.announcement ?? false,
    // Only a literal `true` on a server text channel counts. Lowering is
    // refused by the event handlers, which apply partials through
    // `Client.applyProtectedFlag` instead of this value.
    protected: (channel) =>
      channel.protected === true &&
      (channel.channel_type ?? "TextChannel") === "TextChannel",
    // Server text channels only, parsed strictly. A full object (it has
    // its id) that arrives with the wipe already requested or done marks
    // the channel wiped, so no cached or later row of it is revealed; a
    // `ChannelUpdate` partial has no id and is handled by the event handler,
    // which also purges.
    protectedHistory: (channel, ctx) => {
      if ((channel.channel_type ?? "TextChannel") !== "TextChannel") {
        return undefined;
      }

      const history = parseChannelProtectedHistory(channel.protected_history);
      if (
        history &&
        history.wipe.state !== "none" &&
        typeof channel._id === "string"
      ) {
        (ctx as Client | undefined)?.protectedHistory?.markWiped(channel._id);
      }

      return history;
    },
    // Only a literal `true` on a group counts. Objects applied to a channel
    // that is already cached go through `Client.applyE2eeOnlyFlag` instead
    // of this value, so the mark is never lowered.
    e2eeOnly: (channel) =>
      channel.e2ee_only === true &&
      (channel.channel_type ?? "Group") === "Group",
    // Present exactly while the SERVER would accept a `join_call` here. The
    // wire object carries `voice` on groups and server text channels, and
    // with it `disabled` (not in the generated API type yet), which keeps a
    // saved limit while calling is switched off — the backend's
    // `Channel::voice()` yields nothing for a disabled or absent entry, so
    // neither does this. Group calling is owner opt-in server-side: a group
    // with no `voice` at all is NOT callable, which the previous mapping
    // inverted by minting a voice object for every group. Direct messages
    // carry no `voice` field and are always callable; `Channel.isVoice`
    // answers that from the type, not from this mapper (which only runs for
    // payloads that carry the key).
    voice: (channel) => {
      const voice = channel.voice as
        | { max_users?: number | null; disabled?: boolean }
        | null
        | undefined;
      if (!voice || voice.disabled) return undefined;
      return { maxUsers: voice.max_users || undefined };
    },
    parentChannelId: (channel) => channel.parent_channel,
    originMessageId: (channel) => channel.origin_message_id,
    creatorId: (channel) => channel.creator,
    archived: (channel) => channel.archived || false,
    archivedTimestamp: (channel) =>
      channel.archived_timestamp
        ? new Date(channel.archived_timestamp)
        : undefined,
    autoArchiveMinutes: (channel) => channel.auto_archive_minutes,
    locked: (channel) => channel.locked || false,
    tags: (channel) => channel.tags ?? [],
    requireTag: (channel) => channel.require_tag || false,
    defaultSort: (channel) => channel.default_sort ?? "LatestActivity",
    forceSort: (channel) => channel.force_sort || false,
    defaultLayout: (channel) => channel.default_layout ?? "Modern",
    defaultAutoArchiveMinutes: (channel) =>
      channel.default_auto_archive_minutes,
    appliedTags: (channel) => channel.applied_tags ?? [],
  },
  initialHydration: () => ({
    typingIds: new ReactiveSet(),
    recipientIds: new ReactiveSet(),
    archived: false,
    locked: false,
    requireTag: false,
    announcement: false,
    spoiler: false,
    protected: false,
    e2eeOnly: false,
  }),
};
