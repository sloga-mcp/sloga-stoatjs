import { ReactiveMap } from "@solid-primitives/map";
import { ReactiveSet } from "@solid-primitives/set";
import type { Channel as APIChannel } from "stoat-api";

import type { Client } from "../Client.js";
import { File } from "../classes/File.js";
import type { ThreadChannelData } from "../classes/Thread.js";
import { VoiceParticipant } from "../classes/VoiceParticipant.js";
import type { Merge } from "../lib/merge.js";

import type { Hydrate } from "./index.js";

export type HydratedChannel = {
  id: string;
  channelType: APIChannel["channel_type"] | "Thread";

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
  slowmode: number;

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
};

export const channelHydration: Hydrate<
  Merge<APIChannel | ThreadChannelData>,
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
    parent_channel: "parentChannelId",
    origin_message_id: "originMessageId",
    creator: "creatorId",
    archived_timestamp: "archivedTimestamp",
    auto_archive_minutes: "autoArchiveMinutes",
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
    lastMessageId: (channel) => channel.last_message_id!,
    slowmode: (channel) => channel.slowmode ?? 0,
    voice: (channel) =>
      !!channel.voice ||
      channel.channel_type === "DirectMessage" ||
      channel.channel_type === "Group"
        ? {
            maxUsers: channel.voice?.max_users || undefined,
          }
        : undefined,
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
  },
  initialHydration: () => ({
    typingIds: new ReactiveSet(),
    recipientIds: new ReactiveSet(),
    archived: false,
    locked: false,
  }),
};
