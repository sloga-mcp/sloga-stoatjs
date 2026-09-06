import { ReactiveMap } from "@solid-primitives/map";
import { ReactiveSet } from "@solid-primitives/set";
import type { Channel as APIChannel } from "stoat-api";

import type { Client } from "../Client.js";
import { File } from "../classes/File.js";
import type {
  ForumChannelData,
  ForumSortOrder,
  ForumTag,
} from "../classes/Forum.js";
import type { ThreadChannelData } from "../classes/Thread.js";
import { VoiceParticipant } from "../classes/VoiceParticipant.js";
import type { Merge } from "../lib/merge.js";

import type { Hydrate } from "./index.js";

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
  // Forum-post (thread under a forum) applied tag ids.
  appliedTags?: string[];
};

export const channelHydration: Hydrate<
  // `announcement` and `spoiler` are additive; stoat-api 0.13.5 predates them.
  Merge<APIChannel | ThreadChannelData | ForumChannelData> & {
    announcement?: boolean;
    spoiler?: boolean;
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
    parent_channel: "parentChannelId",
    origin_message_id: "originMessageId",
    creator: "creatorId",
    archived_timestamp: "archivedTimestamp",
    auto_archive_minutes: "autoArchiveMinutes",
    tags: "tags",
    require_tag: "requireTag",
    default_sort: "defaultSort",
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
  }),
};
