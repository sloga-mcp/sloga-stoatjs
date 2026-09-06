import { batch } from "solid-js";

import { ReactiveMap } from "@solid-primitives/map";
import { ReactiveSet } from "@solid-primitives/set";
import type {
  Channel as APIChannel,
  Member as APIMember,
  Message as APIMessage,
  User as APIUser,
  DataEditChannel,
  DataMessageSearch,
  DataMessageSend,
  Invite,
  Override,
} from "stoat-api";
import type { APIRoutes } from "stoat-api";
import { decodeTime, ulid } from "ulid";

import { ChannelCollection } from "../collections/index.js";
import { hydrate } from "../hydration/index.js";
import {
  bitwiseAndEq,
  calculatePermission,
} from "../permissions/calculator.js";
import { Permission } from "../permissions/definitions.js";

import type { ChannelWebhook } from "./ChannelWebhook.js";
import type { File } from "./File.js";
import type { Message } from "./Message.js";
import type { Server } from "./Server.js";
import type { ServerMember } from "./ServerMember.js";
import type {
  DataCreateForumPost,
  ForumPostResponse,
  ForumPostsResponse,
  ForumSortOrder,
  ForumTag,
} from "./Forum.js";
import type { ChannelFollowData } from "./ChannelFollow.js";
import type { ApplicationCommandData } from "./Interaction.js";
import type {
  DataWatchUpdate,
  WatchMediaData,
  WatchResult,
  WatchSessionResponse,
} from "../lib/watch.js";
import type { DataPollCreate } from "./Poll.js";
import type { DataSoftResCreate } from "./SoftRes.js";
import type { ScheduledMessageData } from "./ScheduledMessage.js";
import type { DataCreateThread, ThreadChannelData } from "./Thread.js";
import type { User } from "./User.js";
import { VoiceParticipant } from "./VoiceParticipant.js";

/**
 * Per-(channel, sound) last-trigger timestamps for the soundboard throttle.
 */
const soundboardThrottle = new Map<string, number>();

/**
 * What the server hands back for any LiveKit participant it mints
 * (`CreateVoiceUserResponse`). Defined locally: stoat-api 0.13.5's route table
 * predates the screen-leg route, so it goes through `apiReq`.
 *
 * The token is short-lived (10 s) by design — mint it immediately before
 * connecting, never ahead of a user-paced dialog.
 */
export type VoiceTokenResponse = {
  /** Token for authenticating with the voice server */
  token: string;
  /** Url of the LiveKit server to connect to */
  url: string;
};

/**
 * Channel Class
 */
export class Channel {
  readonly #collection: ChannelCollection;
  readonly id: string;

  _typingTimers: Record<string, number> = {};

  voiceParticipants = new ReactiveMap<string, VoiceParticipant>();

  /**
   * User ids of joined thread members (threads only) — kept live by
   * `ThreadMemberJoin` / `ThreadMemberLeave` events and `fetchThreadMembers`.
   */
  threadMembers = new ReactiveSet<string>();

  /**
   * Construct Channel
   * @param collection Collection
   * @param id Channel Id
   */
  constructor(collection: ChannelCollection, id: string) {
    this.#collection = collection;
    this.id = id;
  }

  /**
   * Write to string as a channel mention
   * @returns Formatted String
   */
  toString(): string {
    return `<#${this.id}>`;
  }

  /**
   * Whether this object exists
   */
  get $exists(): boolean {
    return !!this.#collection.getUnderlyingObject(this.id).id;
  }

  /**
   * Time when this server was created
   */
  get createdAt(): Date {
    return new Date(decodeTime(this.id));
  }

  /**
   * Channel type
   */
  get type(): APIChannel["channel_type"] | "Thread" | "Forum" {
    return this.#collection.getUnderlyingObject(this.id).channelType;
  }

  /**
   * Absolute pathname to this channel in the client
   *
   * Threads carry their own `server` field, so they resolve to
   * `/server/:server/channel/:threadId` like any server channel.
   */
  get path(): string {
    if (this.serverId) {
      return `/server/${this.serverId}/channel/${this.id}`;
    } else {
      return `/channel/${this.id}`;
    }
  }

  /**
   * URL to this channel
   */
  get url(): string {
    return this.#collection.client.configuration?.app + this.path;
  }

  /**
   * Channel name
   */
  get name(): string {
    return this.#collection.getUnderlyingObject(this.id).name;
  }

  /**
   * Display name
   */
  get displayName(): string | undefined {
    return this.type === "SavedMessages"
      ? this.user?.username
      : this.type === "DirectMessage"
        ? this.recipient?.username
        : this.name;
  }

  /**
   * Channel description
   */
  get description(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).description;
  }

  /**
   * Channel icon
   */
  get icon(): File | undefined {
    return this.#collection.getUnderlyingObject(this.id).icon;
  }

  /**
   * Whether the conversation is active
   */
  get active(): boolean {
    return this.#collection.getUnderlyingObject(this.id).active;
  }

  /**
   * User ids of people currently typing in channel
   */
  get typingIds(): ReactiveSet<string> {
    return this.#collection.getUnderlyingObject(this.id).typingIds;
  }

  /**
   * Users currently trying in channel
   */
  get typing(): User[] {
    return [...this.typingIds.values()].map(
      (id) => this.#collection.client.users.get(id)!,
    );
  }

  /**
   * User ids of recipients of the group
   */
  get recipientIds(): ReactiveSet<string> {
    return this.#collection.getUnderlyingObject(this.id).recipientIds;
  }

  /**
   * Recipients of the group
   */
  get recipients(): User[] {
    return [
      ...this.#collection.getUnderlyingObject(this.id).recipientIds.values(),
    ].map((id) => this.#collection.client.users.get(id)!);
  }

  /**
   * Find recipient of this DM
   */
  get recipient(): User | undefined {
    return this.type === "DirectMessage"
      ? this.recipients?.find(
          (user) => user?.id !== this.#collection.client.user!.id,
        )
      : undefined;
  }

  /**
   * User ID
   */
  get userId(): string {
    return this.#collection.getUnderlyingObject(this.id).userId!;
  }

  /**
   * User this channel belongs to
   */
  get user(): User | undefined {
    return this.#collection.client.users.get(
      this.#collection.getUnderlyingObject(this.id).userId!,
    );
  }

  /**
   * Owner ID
   */
  get ownerId(): string {
    return this.#collection.getUnderlyingObject(this.id).ownerId!;
  }

  /**
   * Owner of the group
   */
  get owner(): User | undefined {
    return this.#collection.client.users.get(
      this.#collection.getUnderlyingObject(this.id).ownerId!,
    );
  }

  /**
   * Server ID
   */
  get serverId(): string {
    return this.#collection.getUnderlyingObject(this.id).serverId!;
  }

  /**
   * Server this channel is in
   */
  get server(): Server | undefined {
    return this.#collection.client.servers.get(
      this.#collection.getUnderlyingObject(this.id).serverId!,
    );
  }

  /**
   * Whether this channel is a thread
   */
  get isThread(): boolean {
    return this.type === "Thread";
  }

  /**
   * Whether this channel is a forum
   */
  get isForum(): boolean {
    return this.type === "Forum";
  }

  /**
   * Whether this thread is a forum post (its parent is a forum)
   */
  get isForumPost(): boolean {
    return this.isThread && this.parent?.type === "Forum";
  }

  /**
   * Tags that can be applied to posts (forums only)
   */
  get tags(): ForumTag[] {
    return this.#collection.getUnderlyingObject(this.id).tags ?? [];
  }

  /**
   * Whether every post must carry at least one tag (forums only)
   */
  get requireTag(): boolean {
    return this.#collection.getUnderlyingObject(this.id).requireTag || false;
  }

  /**
   * Default ordering of the post browse view (forums only)
   */
  get defaultSort(): ForumSortOrder {
    return (
      this.#collection.getUnderlyingObject(this.id).defaultSort ??
      "LatestActivity"
    );
  }

  /**
   * Ids of the forum tags applied to this post (forum-post threads only)
   */
  get appliedTags(): string[] {
    return this.#collection.getUnderlyingObject(this.id).appliedTags ?? [];
  }

  /**
   * Parent channel ID (threads only)
   */
  get parentChannelId(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).parentChannelId;
  }

  /**
   * Parent channel this thread hangs off (threads only) — the source of
   * truth for permissions
   */
  get parent(): Channel | undefined {
    const id = this.parentChannelId;
    return id ? this.#collection.get(id) : undefined;
  }

  /**
   * ID of the message in the parent channel this thread was created from
   * (threads only)
   */
  get originMessageId(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).originMessageId;
  }

  /**
   * User ID of the thread creator (threads only, server-stamped)
   */
  get creatorId(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).creatorId;
  }

  /**
   * User who created this thread (threads only)
   */
  get creator(): User | undefined {
    const id = this.creatorId;
    return id ? this.#collection.client.users.get(id) : undefined;
  }

  /**
   * Whether this thread is archived (threads only, server-set)
   */
  get archived(): boolean {
    return this.#collection.getUnderlyingObject(this.id).archived || false;
  }

  /**
   * Time when this thread was archived (threads only)
   */
  get archivedTimestamp(): Date | undefined {
    return this.#collection.getUnderlyingObject(this.id).archivedTimestamp;
  }

  /**
   * Minutes of inactivity after which this thread auto-archives
   * (threads only; one of 60 / 1440 / 4320 / 10080)
   */
  get autoArchiveMinutes(): number | undefined {
    return this.#collection.getUnderlyingObject(this.id).autoArchiveMinutes;
  }

  /**
   * Whether this thread is locked (threads only, server-set)
   */
  get locked(): boolean {
    return this.#collection.getUnderlyingObject(this.id).locked || false;
  }

  /**
   * Permissions allowed for users in this group
   */
  get permissions(): bigint | undefined {
    return this.#collection.getUnderlyingObject(this.id).permissions;
  }

  /**
   * Default permissions for this server channel
   */
  get defaultPermissions(): { a: bigint; d: bigint } | undefined {
    return this.#collection.getUnderlyingObject(this.id).defaultPermissions;
  }

  /**
   * Role permissions for this server channel
   */
  get rolePermissions(): Record<string, { a: bigint; d: bigint }> | undefined {
    return this.#collection.getUnderlyingObject(this.id).rolePermissions;
  }

  /**
   * Whether this channel is marked as mature
   */
  get mature(): boolean {
    return this.#collection.getUnderlyingObject(this.id).nsfw;
  }

  /**
   * Whether this channel is hidden behind a click-to-reveal spoiler gate
   */
  get isSpoiler(): boolean {
    return this.#collection.getUnderlyingObject(this.id).spoiler ?? false;
  }

  /**
   * ID of the last message sent in this channel
   */
  get lastMessageId(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).lastMessageId;
  }

  /**
   * Last message sent in this channel
   */
  get lastMessage(): Message | undefined {
    return this.#collection.client.messages.get(this.lastMessageId!);
  }

  /**
   * Time when the last message was sent
   */
  get lastMessageAt(): Date | undefined {
    return this.lastMessageId
      ? new Date(decodeTime(this.lastMessageId))
      : undefined;
  }

  /**
   * Time when the channel was last updated (either created or a message was sent)
   */
  get updatedAt(): Date {
    return this.lastMessageAt ?? this.createdAt;
  }

  /**
   * Whether this channel is unread
   */
  get unread(): boolean {
    if (
      !this.lastMessageId ||
      this.type === "SavedMessages" ||
      this.#collection.client.options.channelExclusiveMuted(this)
    )
      return false;

    const unread = this.#collection.client.channelUnreads.for(this);
    return (
      (unread.lastMessageId ?? "0").localeCompare(this.lastMessageId) === -1 ||
      unread.messageMentionIds.size > 0
    );
  }

  /**
   * How many messages sit after the read pointer in this channel.
   *
   * Seeded by the server on connect (saturating at 100) and kept live from
   * incoming messages. Zero whenever the channel is not {@link unread}, and
   * also zero when the server did not supply a count — callers should fall
   * back to the plain unread indicator rather than rendering a "0".
   */
  get unreadCount(): number {
    if (!this.unread) return 0;
    return this.#collection.client.channelUnreads.for(this).unreadCount;
  }

  /**
   * Whether any unread message in this channel carries an attachment
   */
  get unreadHasAttachments(): boolean {
    if (!this.unread) return false;
    return this.#collection.client.channelUnreads.for(this)
      .unreadHasAttachments;
  }

  /**
   * Whether this channel is muted
   */
  get muted(): boolean {
    return this.#collection.client.options.channelIsMuted(this);
  }

  /**
   * Get mentions in this channel for user.
   */
  get mentions(): ReactiveSet<string> | undefined {
    if (this.type === "SavedMessages") return undefined;

    return this.#collection.client.channelUnreads.get(this.id)
      ?.messageMentionIds;
  }

  /**
   * Whether calls can be started or joined in this channel — i.e. whether the
   * server would accept a `join_call` for it.
   *
   * Direct messages always can. Groups and server text channels can only
   * while the server sent voice information that is not switched off: group
   * calling is owner opt-in server-side, and a saved configuration can be
   * disabled without being removed. The hydrated `voice` field exists exactly
   * in that case (see the channel hydration). Reporting every group as
   * callable — the previous rule — put a call card in groups whose join then
   * failed with `NotAVoiceChannel`.
   *
   * NB. subject to change as vc(2) goes to production
   */
  get isVoice(): boolean {
    return (
      this.type === "DirectMessage" ||
      typeof this.#collection.getUnderlyingObject(this.id).voice === "object"
    );
  }

  /**
   * URL to the channel icon
   */
  get iconURL(): string | undefined {
    return this.icon?.createFileURL() ?? this.recipient?.avatarURL;
  }

  /**
   * URL to the animated channel icon
   */
  get animatedIconURL(): string | undefined {
    return this.icon?.createFileURL(true) ?? this.recipient?.animatedAvatarURL;
  }

  /**
   * Whether this channel may be hidden to some users
   */
  get potentiallyRestrictedChannel(): string | boolean | undefined {
    if (!this.serverId) return false;
    return (
      bitwiseAndEq(this.defaultPermissions?.d ?? 0n, Permission.ViewChannel) ||
      !bitwiseAndEq(this.server!.defaultPermissions, Permission.ViewChannel) ||
      [...(this.server?.roles.keys() ?? [])].find(
        (role) =>
          bitwiseAndEq(
            this.rolePermissions?.[role]?.d ?? 0n,
            Permission.ViewChannel,
          ) ||
          bitwiseAndEq(
            this.server?.roles.get(role)?.permissions.d ?? 0n,
            Permission.ViewChannel,
          ),
      )
    );
  }

  /**
   * Permission the currently authenticated user has against this channel
   */
  get permission(): bigint {
    return calculatePermission(this.#collection.client, this);
  }

  /**
   * Check whether we have a given permission in a channel
   * @param permission Permission Names
   * @returns Whether we have this permission
   */
  havePermission(...permission: (keyof typeof Permission)[]): boolean {
    return bitwiseAndEq(
      this.permission,
      ...permission.map((x) => Permission[x]),
    );
  }

  /**
   * Check whether we have at least one of the given permissions in a channel
   * @param permission Permission Names
   * @returns Whether we have one of the permissions
   */
  orPermission(...permission: (keyof typeof Permission)[]): boolean {
    return (
      permission.findIndex((x) =>
        bitwiseAndEq(this.permission, Permission[x]),
      ) !== -1
    );
  }

  /**
   * Fetch a channel's members.
   * @requires `Group`
   * @returns An array of the channel's members.
   */
  async fetchMembers(): Promise<User[]> {
    const members = await this.#collection.client.api.get(
      `/channels/${this.id as ""}/members`,
    );

    return batch(() =>
      members.map((user) =>
        this.#collection.client.users.getOrCreate(user._id, user),
      ),
    );
  }

  /**
   * Create a webhook
   * @param name Webhook name
   * @returns The newly-created webhook
   */
  async createWebhook(name: string): Promise<ChannelWebhook> {
    const webhook = await this.#collection.client.api.post(
      `/channels/${this.id as ""}/webhooks`,
      {
        name,
      },
    );

    return this.#collection.client.channelWebhooks.getOrCreate(
      webhook.id,
      webhook,
    );
  }

  /**
   * Fetch a channel's webhooks
   * @requires `TextChannel`, `Group`
   * @returns Webhooks
   */
  async fetchWebhooks(): Promise<ChannelWebhook[]> {
    const webhooks = await this.#collection.client.api.get(
      `/channels/${this.id as ""}/webhooks`,
    );

    return batch(() =>
      webhooks.map((webhook) =>
        this.#collection.client.channelWebhooks.getOrCreate(
          webhook.id,
          webhook,
        ),
      ),
    );
  }

  /**
   * Edit a channel
   * @param data Changes
   */
  async edit(data: DataEditChannel) {
    const channel = await this.#collection.client.api.patch(
      `/channels/${this.id as ""}`,
      data,
    );

    this.#collection.updateUnderlyingObject(
      this.id,
      hydrate("channel", channel, this.#collection.client, false),
    );
  }

  /**
   * Delete or leave a channel
   * @param leaveSilently Whether to not send a message on leave
   * @requires `DirectMessage`, `Group`, `TextChannel`
   */
  async delete(leaveSilently?: boolean): Promise<void> {
    await this.#collection.client.api.delete(`/channels/${this.id as ""}`, {
      leave_silently: leaveSilently,
    });

    if (this.type === "DirectMessage") {
      this.#collection.updateUnderlyingObject(this.id, "active", false);
      return;
    }

    this.#collection.delete(this.id);
  }

  /**
   * Add a user to a group
   * @param user_id ID of the target user
   * @requires `Group`
   */
  async addMember(user_id: string): Promise<void> {
    return await this.#collection.client.api.put(
      `/channels/${this.id as ""}/recipients/${user_id as ""}`,
    );
  }

  /**
   * Remove a user from a group
   * @param user_id ID of the target user
   * @requires `Group`
   */
  async removeMember(user_id: string): Promise<void> {
    return await this.#collection.client.api.delete(
      `/channels/${this.id as ""}/recipients/${user_id as ""}`,
    );
  }

  /**
   * Send a message
   * @param data Either the message as a string or message sending route data
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   * @returns Sent message
   */
  async sendMessage(
    data: string | DataMessageSend,
    idempotencyKey: string = ulid(),
  ): Promise<Message> {
    const msg: DataMessageSend =
      typeof data === "string" ? { content: data } : data;

    // Mark as silent message
    if (msg.content?.startsWith("@silent ")) {
      msg.content = msg.content.substring(8);
      msg.flags ||= 1;
      msg.flags |= 1;
    }

    // E2EE choke point — every DM send passes through here BEFORE the
    // plaintext path. The native layer decides the conversation's mode
    // from local truth; a non-null result means the message went out
    // end-to-end encrypted (the plaintext request below never happens).
    // Encrypt-mode failures THROW inside the adapter rather than falling
    // through — a lying or failing server can never downgrade a pinned
    // conversation to plaintext (invariants 1–3).
    if (this.type === "DirectMessage") {
      const e2ee = this.#collection.client.e2ee;
      if (e2ee) {
        const sent = await e2ee.handleDirectMessageSend(this, msg);
        if (sent) return sent;
      }
    } else if (this.type === "Group") {
      // Group DM E2EE (slice 5): same choke-point discipline as DMs — an
      // encrypted group's send THROWS on any failure, never falls through
      // to the plaintext route (a null result means the group is genuinely
      // plaintext).
      const e2ee = this.#collection.client.e2ee;
      if (e2ee) {
        const sent = await e2ee.handleGroupMessageSend(this, msg);
        if (sent) return sent;
      }
    }

    // Prepared encrypted-attachment ids must NEVER reach the plaintext
    // route (the adapter throws rather than returning null when they are
    // set; stripping here is defense in depth for adapter-less builds)
    const { e2eeAttachments: _e2eeAttachments, ...plainMsg } = msg as {
      e2eeAttachments?: string[];
    } & DataMessageSend;

    const message = await this.#collection.client.api.post(
      `/channels/${this.id as ""}/messages`,
      plainMsg,
      {
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
      },
    );

    return this.#collection.client.messages.getOrCreate(
      message._id,
      message,
      true,
    );
  }

  /**
   * Create a poll in this channel. The server assembles the message
   * (Poll flag + embedded definition) and counts votes authoritatively.
   * @param data Poll creation data
   * @requires a server-mediated channel; the composer additionally hides
   *   polls for E2EE conversations (they are plaintext by construction)
   * @returns The newly-created poll message
   */
  async createPoll(
    data: DataPollCreate,
    idempotencyKey: string = ulid(),
  ): Promise<Message> {
    const message = (await this.#collection.apiReq(
      "POST",
      `/channels/${this.id}/polls`,
      { body: { ...data, nonce: data.nonce ?? idempotencyKey } },
    )) as { _id: string };

    return this.#collection.client.messages.getOrCreate(
      message._id,
      message as never,
      true,
    );
  }

  /**
   * Create a soft-reserve sheet in this channel. The server assembles the
   * message (SoftRes flag + embedded definition), validates every raid /
   * item against its checked-in catalog and counts reserves
   * authoritatively.
   * @param data Sheet creation data
   * @requires a server-mediated channel; the composer additionally hides
   *   sheets for E2EE conversations (they are plaintext by construction)
   * @returns The newly-created sheet message
   */
  async createSoftRes(
    data: DataSoftResCreate,
    idempotencyKey: string = ulid(),
  ): Promise<Message> {
    const message = (await this.#collection.apiReq(
      "POST",
      `/channels/${this.id}/softres`,
      { body: { ...data, nonce: data.nonce ?? idempotencyKey } },
    )) as { _id: string };

    return this.#collection.client.messages.getOrCreate(
      message._id,
      message as never,
      true,
    );
  }

  /**
   * Schedule a message for later delivery to this channel. The payload is
   * stored server-side and sent through the normal message path when due
   * (~30s jitter); permissions are re-checked at fire time.
   * @param data Message payload (same shape as a live send)
   * @param scheduledAt When to send (ms since epoch; 30s .. 30d from now)
   * @requires a server-mediated channel; the composer additionally blocks
   *   scheduling for E2EE conversations (the payload is stored plaintext)
   * @returns The pending row (also stamped into
   *   {@link Client.scheduledMessages})
   */
  async scheduleMessage(
    data: Omit<DataMessageSend, "nonce">,
    scheduledAt: number,
    idempotencyKey: string = ulid(),
  ): Promise<ScheduledMessageData> {
    const row = (await this.#collection.apiReq(
      "POST",
      `/channels/${this.id}/scheduled_messages`,
      {
        body: {
          ...data,
          nonce: idempotencyKey,
          scheduled_at: scheduledAt,
        },
      },
    )) as ScheduledMessageData;

    this.#collection.client.scheduledMessages.set(row._id, row);
    return row;
  }

  /**
   * Fetch the current user's pending scheduled messages in this channel
   * (strictly author-scoped server-side), refreshing
   * {@link Client.scheduledMessages}.
   */
  async fetchScheduledMessages(): Promise<ScheduledMessageData[]> {
    const rows = (await this.#collection.apiReq(
      "GET",
      `/channels/${this.id}/scheduled_messages`,
    )) as ScheduledMessageData[];

    const map = this.#collection.client.scheduledMessages;
    // Replace this channel's entries wholesale — a row may have fired or
    // been cancelled while we were away.
    for (const [id, row] of map) {
      if (row.channel === this.id) map.delete(id);
    }
    for (const row of rows) {
      map.set(row._id, row);
    }

    return rows;
  }

  /**
   * Cancel one of the current user's pending scheduled messages in this
   * channel. Fails once the delivery daemon has claimed the row.
   */
  async cancelScheduledMessage(id: string): Promise<void> {
    await this.#collection.apiReq(
      "DELETE",
      `/channels/${this.id}/scheduled_messages/${id}`,
    );

    this.#collection.client.scheduledMessages.delete(id);
  }

  /**
   * Fetch a message by its ID
   * @param messageId ID of the target message
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   * @returns Message
   */
  async fetchMessage(messageId: string): Promise<Message> {
    const message = await this.#collection.client.api.get(
      `/channels/${this.id as ""}/messages/${messageId as ""}`,
    );

    return this.#collection.client.messages.getOrCreate(message._id, message);
  }

  /**
   * Fetch multiple messages from a channel
   * @param params Message fetching route data
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   * @returns Messages
   */
  async fetchMessages(
    params?: Omit<
      (APIRoutes & {
        method: "get";
        path: "/channels/{target}/messages";
      })["params"],
      "include_users"
    >,
  ): Promise<Message[]> {
    // E2EE conversations render from the device-local store — the server
    // holds only transit ciphertext (see `E2EEAdapter.fetchLocalHistory`).
    // Applies to both 1:1 DMs and encrypted groups (slice 5).
    if (this.type === "DirectMessage" || this.type === "Group") {
      const e2ee = this.#collection.client.e2ee;
      if (e2ee) {
        const local = await e2ee.fetchLocalHistory(this, params);
        if (local) return local;
      }
    }

    const messages = (await this.#collection.client.api.get(
      `/channels/${this.id as ""}/messages`,
      { ...params },
    )) as APIMessage[];

    return messages.map((message) =>
      this.#collection.client.messages.getOrCreate(message._id, message),
    );
  }

  /**
   * Fetch multiple messages from a channel including the users that sent them
   * @param params Message fetching route data
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   * @returns Object including messages and users
   */
  async fetchMessagesWithUsers(
    params?: Omit<
      (APIRoutes & {
        method: "get";
        path: "/channels/{target}/messages";
      })["params"],
      "include_users"
    >,
  ): Promise<{
    messages: Message[];
    users: User[];
    members: ServerMember[] | undefined;
  }> {
    // E2EE conversations render from the device-local store; DM and group
    // users are already known locally (slice 5)
    if (this.type === "DirectMessage" || this.type === "Group") {
      const e2ee = this.#collection.client.e2ee;
      if (e2ee) {
        const local = await e2ee.fetchLocalHistory(this, params);
        if (local) {
          return { messages: local, users: [], members: undefined };
        }
      }
    }

    const data = (await this.#collection.client.api.get(
      `/channels/${this.id as ""}/messages`,
      { ...params, include_users: true },
    )) as { messages: APIMessage[]; users: APIUser[]; members?: APIMember[] };

    return batch(() => ({
      messages: data.messages.map((message) =>
        this.#collection.client.messages.getOrCreate(message._id, message),
      ),
      users: data.users.map((user) =>
        this.#collection.client.users.getOrCreate(user._id, user),
      ),
      members: data.members?.map((member) =>
        this.#collection.client.serverMembers.getOrCreate(member._id, member),
      ),
    }));
  }

  /**
   * Search for messages
   * @param params Message searching route data
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   * @returns Messages
   */
  async search(
    params: Omit<DataMessageSearch, "include_users">,
  ): Promise<Message[]> {
    const messages = (await this.#collection.client.api.post(
      `/channels/${this.id as ""}/search`,
      params,
    )) as APIMessage[];

    return batch(() =>
      messages.map((message) =>
        this.#collection.client.messages.getOrCreate(message._id, message),
      ),
    );
  }

  /**
   * Search for messages including the users that sent them
   * @param params Message searching route data
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   * @returns Object including messages and users
   */
  async searchWithUsers(
    params: Omit<DataMessageSearch, "include_users">,
  ): Promise<{
    messages: Message[];
    users: User[];
    members: ServerMember[] | undefined;
  }> {
    const data = (await this.#collection.client.api.post(
      `/channels/${this.id as ""}/search`,
      {
        ...params,
        include_users: true,
      },
    )) as { messages: APIMessage[]; users: APIUser[]; members?: APIMember[] };

    return batch(() => ({
      messages: data.messages.map((message) =>
        this.#collection.client.messages.getOrCreate(message._id, message),
      ),
      users: data.users.map((user) =>
        this.#collection.client.users.getOrCreate(user._id, user),
      ),
      members: data.members?.map((member) =>
        this.#collection.client.serverMembers.getOrCreate(member._id, member),
      ),
    }));
  }

  /**
   * Delete many messages by their IDs
   * @param ids List of message IDs
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   */
  async deleteMessages(ids: string[]): Promise<void> {
    await this.#collection.client.api.delete(
      `/channels/${this.id as ""}/messages/bulk`,
      {
        ids,
      },
    );
  }

  /**
   * Create an invite to the channel
   * @requires `TextChannel`
   * @returns Newly created invite code
   */
  async createInvite(): Promise<Invite> {
    return await this.#collection.client.api.post(
      `/channels/${this.id as ""}/invites`,
    );
  }

  /**
   * Create a thread under this channel
   * @param data Thread creation data
   * @param fromMessageId Anchor the thread to an existing message in this
   *   channel (`POST .../messages/{msg}/threads`); omit for a standalone thread
   * @requires `TextChannel` — the server rejects DM / Group / SavedMessages /
   *   Thread parents (E2EE conversations can never host a thread, fail-closed)
   * @returns The newly-created thread
   */
  async createThread(
    data: DataCreateThread,
    fromMessageId?: string,
  ): Promise<Channel> {
    const thread = (await this.#collection.apiReq(
      "POST",
      fromMessageId
        ? `/channels/${this.id}/messages/${fromMessageId}/threads`
        : `/channels/${this.id}/threads`,
      { body: data },
    )) as ThreadChannelData;

    const channel = this.#collection.getOrCreate(thread._id, thread, true);
    // The server auto-joins the creator; reflect that immediately.
    const self = this.#collection.client.user;
    if (self) channel.threadMembers.add(self.id);
    // The WS ChannelCreate for our own creation is deduplicated (the channel
    // is already cached), so emit threadCreate locally too — otherwise the
    // creating device never sees it.
    this.#collection.client.emit("threadCreate", channel);
    return channel;
  }

  /**
   * Fetch threads under this channel
   * @param params archived: list archived instead of active threads;
   *   before: ULID pagination cursor; limit: 1..=100
   * @requires `TextChannel`
   * @returns Threads sorted by last activity, descending
   */
  async fetchThreads(params?: {
    archived?: boolean;
    before?: string;
    limit?: number;
  }): Promise<Channel[]> {
    const threads = (await this.#collection.apiReq(
      "GET",
      `/channels/${this.id}/threads`,
      { query: params },
    )) as ThreadChannelData[];

    return batch(() =>
      threads.map((thread) => this.#collection.getOrCreate(thread._id, thread)),
    );
  }

  /**
   * Join this thread as the current user
   * @requires `Thread`
   */
  async joinThread(): Promise<void> {
    await this.#collection.apiReq(
      "PUT",
      `/channels/${this.id}/thread_members/@me`,
    );

    const self = this.#collection.client.user;
    if (self) this.threadMembers.add(self.id);
  }

  /**
   * Leave this thread, or remove another member from it
   * @param userId Member to remove (defaults to the current user; removing
   *   others requires `ManageChannel` on the parent)
   * @requires `Thread`
   */
  async leaveThread(userId?: string): Promise<void> {
    await this.#collection.apiReq(
      "DELETE",
      `/channels/${this.id}/thread_members/${userId ?? "@me"}`,
    );

    const id = userId ?? this.#collection.client.user?.id;
    if (id) this.threadMembers.delete(id);
  }

  /**
   * Fetch this thread's members, refreshing {@link threadMembers}
   * @requires `Thread`
   * @returns User ids of joined members
   */
  async fetchThreadMembers(): Promise<string[]> {
    // The server returns a plain array of user ids.
    const members = (await this.#collection.apiReq(
      "GET",
      `/channels/${this.id}/thread_members`,
    )) as string[];

    batch(() => {
      this.threadMembers.clear();
      for (const userId of members) {
        this.threadMembers.add(userId);
      }
    });

    return members;
  }

  /**
   * Create a post in this forum
   * @param data Post creation data (title, tags, starter message)
   * @requires `Forum` — the server rejects every other channel type
   * @returns The newly-created post and its starter message
   */
  async createPost(
    data: DataCreateForumPost,
  ): Promise<{ post: Channel; message: Message }> {
    const response = (await this.#collection.apiReq(
      "POST",
      `/channels/${this.id}/posts`,
      { body: data },
    )) as ForumPostResponse;

    const post = this.#collection.getOrCreate(
      response.post._id,
      response.post,
      true,
    );
    // The server auto-joins the creator; reflect that immediately.
    const self = this.#collection.client.user;
    if (self) post.threadMembers.add(self.id);
    // The WS ChannelCreate for our own creation is deduplicated (the channel
    // is already cached), so emit threadCreate locally too.
    this.#collection.client.emit("threadCreate", post);

    const message = this.#collection.client.messages.getOrCreate(
      response.message._id,
      response.message,
    );
    return { post, message };
  }

  /**
   * Fetch posts of this forum
   * @param params sort: latest_activity (default) | creation_date;
   *   tag: filter to a tag id; archived: list archived posts instead;
   *   before: cursor on the sort key; limit: 1..=100;
   *   includeStarters: also fetch each post's starter message
   * @requires `Forum`
   * @returns Posts, plus starter messages when requested
   */
  async fetchPosts(params?: {
    sort?: "latest_activity" | "creation_date";
    tag?: string;
    archived?: boolean;
    before?: string;
    limit?: number;
    includeStarters?: boolean;
  }): Promise<{ posts: Channel[]; starters?: Message[] }> {
    const { includeStarters, ...rest } = params ?? {};
    const response = (await this.#collection.apiReq(
      "GET",
      `/channels/${this.id}/posts`,
      {
        query: {
          ...rest,
          include_starters: includeStarters,
        },
      },
    )) as ForumPostsResponse;

    return batch(() => ({
      posts: response.posts.map((post) =>
        this.#collection.getOrCreate(post._id, post),
      ),
      starters: response.starters?.map((starter) =>
        this.#collection.client.messages.getOrCreate(starter._id, starter),
      ),
    }));
  }

  /**
   * Edit the tags applied to this forum post
   * @param tags Tag ids (replaces the whole set; moderated tags require
   *   `ManageChannel` on the forum)
   * @requires `Thread` whose parent is a `Forum`
   */
  async editAppliedTags(tags: string[]): Promise<void> {
    await this.edit({ applied_tags: tags } as DataEditChannel);
  }

  /**
   * Fetch the slash commands invocable in this channel: commands of bots
   * present in this server/group, merged from the server and global scopes.
   * Empty for DMs and saved messages (interactions are structurally
   * excluded there, E2EE fail-closed).
   */
  async fetchCommands(): Promise<ApplicationCommandData[]> {
    return (await this.#collection.apiReq(
      "GET",
      `/channels/${this.id}/commands`,
    )) as ApplicationCommandData[];
  }

  /**
   * Invoke a slash command in this channel
   * @param commandId Id of the command (from {@link fetchCommands})
   * @param options Option values keyed by option name (all values are
   *   strings on the wire; the server validates them against the command's
   *   typed schema)
   * @returns Id of the created interaction — the bot's reply arrives as a
   *   regular message carrying `commandContext`
   */
  async createInteraction(
    commandId: string,
    options?: Record<string, string>,
  ): Promise<string> {
    const response = (await this.#collection.apiReq(
      "POST",
      `/channels/${this.id}/interactions`,
      { body: { command_id: commandId, options: options ?? {} } },
    )) as { interaction_id: string };
    return response.interaction_id;
  }

  /**
   * Interact with a component (button / select) on a bot message in this
   * channel
   * @param messageId Message the component lives on
   * @param customId Custom id of the clicked component
   * @param values Selected values (selects only; exactly one)
   * @returns Id of the created interaction — the bot answers with a new
   *   message or by editing the component's message
   */
  async interactWithMessage(
    messageId: string,
    customId: string,
    values?: string[],
  ): Promise<string> {
    const response = (await this.#collection.apiReq(
      "POST",
      `/channels/${this.id}/messages/${messageId}/interact`,
      {
        body: {
          custom_id: customId,
          ...(values && values.length ? { values } : {}),
        },
      },
    )) as { interaction_id: string };
    return response.interaction_id;
  }

  /**
   * Archive this thread (requires `ManageChannel` on the parent, or being
   * the thread's creator)
   * @requires `Thread`
   */
  archive(): Promise<void> {
    return this.edit({ archived: true });
  }

  /**
   * Unarchive this thread (requires `ManageChannel` on the parent, or being
   * the thread's creator)
   * @requires `Thread`
   */
  unarchive(): Promise<void> {
    return this.edit({ archived: false });
  }

  #ackTimeout?: number;
  #ackLimit?: number;
  #manuallyMarked?: boolean;

  /**
   * Mark a channel as read
   * @param message Last read message or its ID
   * @param skipRateLimiter Whether to skip the internal rate limiter
   * @param skipRequest For internal updates only
   * @param skipNextMarking For internal usage only
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   */
  async ack(
    message?: Message | string,
    skipRateLimiter?: boolean,
    skipRequest?: boolean,
    skipNextMarking?: boolean,
  ): Promise<void> {
    // Ephemeral messages have no server-side existence; acking their ULID
    // (minted at respond time, so newer than every persisted message)
    // would move the unread pointer past real messages. Message.ack()
    // already guards this — this covers direct library consumers.
    if (typeof message === "object" && message?.isEphemeral) {
      message = undefined;
    }

    if (!message && this.#manuallyMarked) {
      this.#manuallyMarked = false;
      return;
    }
    // Skip the next unread marking
    else if (skipNextMarking) {
      this.#manuallyMarked = true;
    }

    const lastMessageId =
      (typeof message === "string" ? message : message?.id) ??
      this.lastMessageId ??
      ulid();

    const channelUnread = this.#collection.client.channelUnreads.for(this);

    batch(() => {
      this.#collection.client.channelUnreads.updateUnderlyingObject(
        this.id,
        "lastMessageId",
        lastMessageId,
      );

      if (channelUnread.messageMentionIds.size) {
        channelUnread.messageMentionIds.clear();
      }

      // The tail is read, so the badge count goes with it. Acking a message
      // that is not the newest leaves the channel unread with a zero count,
      // which renders as the plain dot — never as a stale number.
      this.#collection.client.channelUnreads.updateUnderlyingObject(
        this.id,
        "unreadCount",
        0,
      );

      this.#collection.client.channelUnreads.updateUnderlyingObject(
        this.id,
        "unreadHasAttachments",
        false,
      );
    });

    // Skip request if not needed
    if (skipRequest) return;

    /**
     * Send the actual acknowledgement request
     */
    const performAck = (): void => {
      this.#ackLimit = undefined;
      this.#collection.client.api.put(
        `/channels/${this.id}/ack/${lastMessageId as ""}`,
      );
    };

    if (skipRateLimiter) return performAck();

    clearTimeout(this.#ackTimeout);
    if (this.#ackLimit && +new Date() > this.#ackLimit) {
      performAck();
    }

    this.#ackTimeout = setTimeout(performAck, 1500) as unknown as number;

    if (!this.#ackLimit) {
      this.#ackLimit = +new Date() + 4e3;
    }
  }

  /**
   * Set role permissions
   * @param role_id Role Id, set to 'default' to affect all users
   * @param permissions Permission value
   * @requires `Group`, `TextChannel`
   */
  async setPermissions(
    role_id = "default",
    permissions: Override | number,
  ): Promise<APIChannel> {
    return await this.#collection.client.api.put(
      `/channels/${this.id as ""}/permissions/${role_id as ""}`,
      { permissions: permissions as never },
    );
  }

  /**
   * Get slowmode value for the channel
   */
  get slowmode(): number {
    return this.#collection.getUnderlyingObject(this.id).slowmode ?? 0;
  }

  /**
   * Whether this is a server text channel flagged as an announcement channel
   * (other servers' channels can follow it, and its messages can be
   * published / crossposted).
   */
  get isAnnouncement(): boolean {
    return (
      this.type === "TextChannel" &&
      this.#collection.getUnderlyingObject(this.id).announcement
    );
  }

  /**
   * Follow this announcement channel from a target channel in another server.
   * @param serverId Id of the server that owns the target channel
   * @param channelId Id of the target (follower) channel
   * @requires `ViewChannel` here, `ManageWebhooks` on the target
   * @returns The created follow
   */
  async follow(
    serverId: string,
    channelId: string,
  ): Promise<ChannelFollowData> {
    return (await this.#collection.apiReq(
      "POST",
      `/channels/${this.id}/follow`,
      {
        body: {
          server: serverId,
          channel: channelId,
        },
      },
    )) as ChannelFollowData;
  }

  /**
   * Sever a follow of this announcement channel.
   * @param followId Id of the follow to remove
   * @requires `ManageChannel` here OR `ManageWebhooks` on the target
   */
  async unfollow(followId: string): Promise<void> {
    await this.#collection.apiReq(
      "DELETE",
      `/channels/${this.id}/follow/${followId}`,
    );
  }

  /**
   * Fetch the follows hanging off this announcement channel.
   * @requires `ManageChannel`
   */
  async fetchFollowers(): Promise<ChannelFollowData[]> {
    return (await this.#collection.apiReq(
      "GET",
      `/channels/${this.id}/followers`,
    )) as ChannelFollowData[];
  }

  /**
   * Publish (crosspost) a message from this announcement channel into every
   * follower channel.
   * @param messageId Id of the message to publish
   * @requires `SendMessage` (+ `ManageMessages` for others' messages)
   */
  async crosspostMessage(messageId: string): Promise<void> {
    await this.#collection.apiReq(
      "POST",
      `/channels/${this.id}/messages/${messageId}/crosspost`,
    );
  }

  /**
   * Join a call
   * @param node Target node
   * @param forceDisconnect Whether to disconnect existing call
   * @param recipients Ring targets
   * @param deviceId E2EE device id — when present the server mints a
   *   device-qualified LiveKit identity `{user_id}:{device_id}` so per-device
   *   MLS frame keys map injectively (media E2EE, slice 6.1/6.4). Omit for
   *   web / non-E2EE calls (identity stays the bare user id).
   * @returns LiveKit URL and Token
   */
  async joinCall(
    node?: string,
    forceDisconnect = true,
    recipients?: (User | string)[],
    deviceId?: string,
  ) {
    const body = {
      node,
      recipients: recipients?.map((entry) =>
        typeof entry === "string" ? entry : entry.id,
      ),
      force_disconnect: forceDisconnect,
    };
    return await this.#collection.client.api.post(
      `/channels/${this.id as ""}/join_call`,
      // `device_id` is carried at runtime by the generic body mapper for this
      // known route; stoat-api 0.13.5's `DataJoinCall` type predates the field,
      // so cast back to the pre-field body type to satisfy the compiler.
      (deviceId ? { ...body, device_id: deviceId } : body) as typeof body,
    );
  }

  /**
   * Mint a token for this device's native SCREEN LEG — a second, publish-only
   * LiveKit participant at identity `{user_id}:{device_id}:screen`.
   *
   * Android has no way to screen-share from the WebView: no web runtime on the
   * platform exposes `getDisplayMedia`, and a native MediaProjection capture
   * cannot be handed to the WebView's sealed WebRTC stack as a track. Rejoining
   * under the SAME identity is not an option either — LiveKit evicts the
   * earlier connection, so the call itself would drop. Hence a separate
   * participant, published by the native plugin.
   *
   * The caller must already be in the call. The leg's identity is derived from
   * the LIVE primary mapping server-side, never from `deviceId`: the claim only
   * proves which device is asking, and the server refuses unless that device is
   * the one currently holding the call (plan §2.1 step 6 / §0-R.2 — otherwise a
   * phone that is NOT in the call could mint a leg under the user's desktop
   * identity and take every viewer's call to mixed).
   *
   * @param deviceId E2EE device id of the calling device. Omit only when the
   *   primary joined without one (a bare, non-E2EE identity), which yields the
   *   three-segment `{user_id}::screen`.
   * @returns LiveKit URL and Token for the leg
   * @throws `FeatureDisabled` while the operator flag is dark, `IsBot`,
   *   `NotAVoiceChannel`, `NotInVoiceChannel`, `FailedValidation` (the device
   *   is unregistered, or is not the one in the call), `VideoCallFull`
   */
  async joinScreenLeg(deviceId?: string): Promise<VoiceTokenResponse> {
    // `apiReq`, NOT the typed client: `screen_leg` is absent from stoat-api
    // 0.13.5's route table, and its generic body mapper drops the body of an
    // unknown route SILENTLY — the request would arrive with no `device_id`
    // and be refused as a mismatched device, with nothing in the error to say
    // why. Same reason as the thread and announcement routes above.
    return (await this.#collection.apiReq(
      "POST",
      `/channels/${this.id}/screen_leg`,
      { body: { device_id: deviceId } },
    )) as VoiceTokenResponse;
  }

  /**
   * Trigger a server soundboard sound in this voice channel. Carries no
   * audio — the server fans a `SoundboardSound` event to everyone in the
   * call, who each play the clip locally. Requires being in the call and
   * holding `UseSoundboard`. Raw fetch: the route is not in stoat-api's
   * generated tables (mirrors the sticker/roll pattern), and it takes no
   * body so the typed client's body-drop quirk is moot.
   *
   * A short client-side throttle per (channel, sound) avoids hammering the
   * server rate-limit bucket from a mashed picker button — the server bucket
   * is the real enforcement.
   * @param soundId Soundboard sound id
   */
  async triggerSound(soundId: string): Promise<void> {
    const key = `${this.id}:${soundId}`;
    const now = Date.now();
    const last = soundboardThrottle.get(key) ?? 0;
    if (now - last < 400) return;
    soundboardThrottle.set(key, now);

    const client = this.#collection.client;
    const [headerKey, headerValue] = client.authenticationHeader;
    await fetch(
      `${client.options.baseURL}/channels/${this.id}/soundboard/${soundId}`,
      {
        method: "POST",
        headers: { [headerKey]: headerValue },
      },
    );
  }

  /**
   * Relay one finalized live caption to the other participants of this call.
   * The server validates (participant + `Connect`/`Speak`), fans a
   * `CallCaption` event to the call's members, and stores nothing.
   *
   * This exists because captions CANNOT ride a LiveKit data channel here: the
   * voice token is minted `can_publish_data: false`, so the SFU silently drops
   * every packet a speaker publishes.
   *
   * Raw fetch, NOT the typed client: this route is absent from stoat-api's
   * generated tables and the typed client sends `{}` for routes it does not
   * know — which would drop the body and post an empty caption.
   *
   * @param text Finalized transcript in the speaker's own language
   * @param lang BCP-47 language the speaker was recognized in
   */
  async sendCaption(text: string, lang: string): Promise<void> {
    const client = this.#collection.client;
    const [headerKey, headerValue] = client.authenticationHeader;
    await fetch(`${client.options.baseURL}/channels/${this.id}/captions`, {
      method: "POST",
      headers: {
        [headerKey]: headerValue,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text, lang }),
    });
  }

  /**
   * Relay a batch of annotation strokes onto a screen-sharer's surface.
   * The server stamps the annotator from the session, validates the target
   * is a live screen-sharer here, and REFUSES (403) unless the target's
   * draw-consent allowlist names this user — consent is server-enforced,
   * never a client toggle. Stroke points are fixed-point integers 0..=10000
   * over the surface's unit square; color/width are palette and class
   * INDEXES. Raw fetch for the `sendCaption` reason (the typed client
   * would drop the body on an unknown route).
   *
   * @returns response.ok — false signals the send was refused (e.g. consent
   * revoked mid-draw), so the capture surface can stop cleanly.
   */
  async sendAnnotation(
    targetId: string,
    strokes: { points: number[]; color: number; width: number }[],
    seq: number,
  ): Promise<boolean> {
    const client = this.#collection.client;
    const [headerKey, headerValue] = client.authenticationHeader;
    const response = await fetch(
      `${client.options.baseURL}/channels/${this.id}/annotations`,
      {
        method: "POST",
        headers: {
          [headerKey]: headerValue,
          "content-type": "application/json",
        },
        body: JSON.stringify({ target: targetId, strokes, seq }),
      },
    );
    return response.ok;
  }

  /**
   * Let one named call participant draw on MY shared screen (the caller
   * must be publishing screen video). Off by default; each grant names
   * exactly one person. The server fans a `CallAnnotationConsent` event
   * with the complete new allowlist.
   */
  async allowAnnotator(userId: string): Promise<boolean> {
    const client = this.#collection.client;
    const [headerKey, headerValue] = client.authenticationHeader;
    const response = await fetch(
      `${client.options.baseURL}/channels/${this.id}/annotations/allow`,
      {
        method: "PUT",
        headers: {
          [headerKey]: headerValue,
          "content-type": "application/json",
        },
        body: JSON.stringify({ user: userId }),
      },
    );
    return response.ok;
  }

  /**
   * The ONE-ACTION revoke: clear my entire draw allowlist at once. This —
   * not the stroke fade — is the backstop against a live phishing overlay,
   * and it works whether or not I am still sharing.
   */
  async revokeAnnotators(): Promise<boolean> {
    const client = this.#collection.client;
    const [headerKey, headerValue] = client.authenticationHeader;
    const response = await fetch(
      `${client.options.baseURL}/channels/${this.id}/annotations/allow`,
      {
        method: "DELETE",
        headers: { [headerKey]: headerValue },
      },
    );
    return response.ok;
  }

  /**
   * Fetch the call's current draw-consent state (sharers with a non-empty
   * allowlist) — lets a late joiner render the draw affordance without
   * having seen the consent events.
   */
  async fetchAnnotationConsent(): Promise<
    { sharer_id: string; allowed: string[] }[]
  > {
    const client = this.#collection.client;
    const [headerKey, headerValue] = client.authenticationHeader;
    const response = await fetch(
      `${client.options.baseURL}/channels/${this.id}/annotations/allow`,
      {
        method: "GET",
        headers: { [headerKey]: headerValue },
      },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as {
      sharers?: { sharer_id: string; allowed: string[] }[];
    };
    return Array.isArray(body.sharers) ? body.sharers : [];
  }

  /**
   * Watch together (synced playback in this voice call). Sloga carries
   * ONLY the control state — item, position, playing, host — over these
   * routes and private events; the media itself is fetched by each viewer
   * from the provider (YouTube embed, their own Jellyfin) on their own
   * machine. Raw `fetch`, NOT the typed client: these routes are absent
   * from stoat-api's tables and the typed client drops unknown bodies.
   *
   * All four return the same shape so the store can derive its clock
   * offset from `server_now` + the local send/receive timestamps.
   */
  async #watchRequest(
    method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
    body?: unknown,
    suffix = "",
  ): Promise<WatchResult> {
    const client = this.#collection.client;
    const [headerKey, headerValue] = client.authenticationHeader;
    const sentAt = Date.now();
    let response: Response;
    try {
      response = await fetch(`${client.options.baseURL}/channels/${this.id}/watch${suffix}`, {
        method,
        headers: {
          [headerKey]: headerValue,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      return { ok: false, status: 0, error: "NetworkError" };
    }
    const receivedAt = Date.now();
    if (!response.ok) {
      let error = `HTTP ${response.status}`;
      try {
        const e = (await response.json()) as { type?: string };
        if (e?.type) error = e.type;
      } catch {
        /* no body */
      }
      return { ok: false, status: response.status, error };
    }
    if (response.status === 204) {
      // DELETE — no session comes back; callers only check `ok`.
      return {
        ok: true,
        body: undefined as unknown as WatchSessionResponse,
        sentAt,
        receivedAt,
      };
    }
    return {
      ok: true,
      body: (await response.json()) as WatchSessionResponse,
      sentAt,
      receivedAt,
    };
  }

  /** Start a watch-together session with the caller as host (paused at 0). */
  startWatch(media: WatchMediaData): Promise<WatchResult> {
    return this.#watchRequest("POST", { media });
  }

  /** Host control write / heartbeat — the FULL host-owned state. */
  updateWatch(data: DataWatchUpdate): Promise<WatchResult> {
    return this.#watchRequest("PATCH", data);
  }

  /** End the session (host or channel manager). Idempotent. */
  endWatch(): Promise<WatchResult> {
    return this.#watchRequest("DELETE");
  }

  /** Current session, for late joiners / reconnects. 404 → `ok: false`. */
  fetchWatch(): Promise<WatchResult> {
    return this.#watchRequest("GET");
  }

  /**
   * Hand the watch session to a new host (host or channel manager). The
   * target must be in the call and, in server channels, hold
   * `UseWatchTogether`. NOTE: unlike the session GET, a `NotInVoiceChannel`
   * here refers to the TARGET and is a real refusal — callers must not
   * apply the self-join retry-once rule to it.
   */
  watchHost(user: string): Promise<WatchResult> {
    return this.#watchRequest("PUT", { user }, "/host");
  }

  /**
   * Set or clear the caller's `watching` roster flag — "this client has the
   * channel's watch session attached". A bare boolean on the channel topic
   * (the `recording`/`screensharing` visibility class); what is being
   * watched stays on the private watch fan-out. The server refuses `true`
   * while the channel has no session and clears the flag for everyone when
   * the session ends, so callers treat this as best-effort advisory state.
   *
   * Raw fetch for the `announceRcCapable` reason: routes absent from
   * stoat-api's generated tables get their body replaced with `{}`.
   */
  async setWatching(watching: boolean): Promise<void> {
    const client = this.#collection.client;
    const [headerKey, headerValue] = client.authenticationHeader;
    await fetch(`${client.options.baseURL}/channels/${this.id}/watching`, {
      method: "PUT",
      headers: {
        [headerKey]: headerValue,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ watching }),
    });
  }

  /**
   * Announce that this client can RECEIVE remote control in this call
   * (pass-the-controller capability beacon). Marks the caller's voice state
   * `rc_capable` for the channel — advisory routing for rotation-queue UIs,
   * verified by nothing and granting nothing. Idempotent; the flag clears
   * with the voice state on leaving the call. Fire once after connecting,
   * and only when the native layer actually reports control support.
   *
   * Raw fetch, NOT the typed client, for the `sendCaption` reason: routes
   * absent from stoat-api's generated tables get their body replaced with
   * `{}` (harmless here, but the throw-on-4xx behavior differs too).
   */
  async announceRcCapable(): Promise<void> {
    const client = this.#collection.client;
    const [headerKey, headerValue] = client.authenticationHeader;
    await fetch(`${client.options.baseURL}/channels/${this.id}/rc_capable`, {
      method: "PUT",
      headers: { [headerKey]: headerValue },
    });
  }

  /**
   * Ask a participant who is streaming in this call for a control turn
   * ("ask for a turn"). The server stamps the asker's identity, validates
   * (both live participants, `Connect`, the sharer publishing screen video)
   * and relays a private `CallControlRequest` event to the sharer — a
   * suggestion for their rotation queue, nothing more.
   *
   * Rate-limited server-side (`control_request` bucket): callers should
   * disable their "ask" affordance after one send rather than retry.
   *
   * Raw fetch, NOT the typed client: this route is absent from stoat-api's
   * generated tables and the typed client sends `{}` for routes it does not
   * know — which would drop the sharer id and 400.
   *
   * @param sharerId User id of the streaming participant being asked
   * @returns The response status: callers distinguish 429 (asked too often)
   */
  async requestControlTurn(sharerId: string): Promise<number> {
    const client = this.#collection.client;
    const [headerKey, headerValue] = client.authenticationHeader;
    const response = await fetch(
      `${client.options.baseURL}/channels/${this.id}/control/request`,
      {
        method: "POST",
        headers: {
          [headerKey]: headerValue,
          "content-type": "application/json",
        },
        body: JSON.stringify({ sharer: sharerId }),
      },
    );
    return response.status;
  }

  /**
   * Start typing in this channel
   * @requires `DirectMessage`, `Group`, `TextChannel`
   */
  startTyping(): void {
    this.#collection.client.events.send({
      type: "BeginTyping",
      channel: this.id,
    });
  }

  /**
   * Stop typing in this channel
   * @requires `DirectMessage`, `Group`, `TextChannel`
   */
  stopTyping(): void {
    this.#collection.client.events.send({
      type: "EndTyping",
      channel: this.id,
    });
  }
}
