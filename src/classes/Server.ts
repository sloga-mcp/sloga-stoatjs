import { batch } from "solid-js";

import type { ReactiveMap } from "@solid-primitives/map";
import type { ReactiveSet } from "@solid-primitives/set";
import type {
  Server as APIServer,
  AllMemberResponse,
  BannedUser,
  Category,
  DataBanCreate,
  DataCreateEmoji,
  DataCreateServerChannel,
  DataEditRole,
  DataEditServer,
  Override,
  OverrideField,
  Role,
} from "stoat-api";
import { decodeTime } from "ulid";

import type { ServerCollection } from "../collections/ServerCollection.js";
import { hydrate } from "../hydration/index.js";
import type { ServerFlags } from "../hydration/server.js";
import {
  bitwiseAndEq,
  calculatePermission,
} from "../permissions/calculator.js";
import { Permission } from "../permissions/definitions.js";

import type { AuditLogPage, AuditLogQuery } from "./AuditLog.js";
import type { Channel } from "./Channel.js";
import type { Emoji } from "./Emoji.js";
import type { File } from "./File.js";
import { ChannelInvite } from "./Invite.js";
import { ServerBan } from "./ServerBan.js";
import { ServerMember } from "./ServerMember.js";
import { ServerRole } from "./ServerRole.js";
import { User } from "./User.js";

/**
 * Server Class
 */
export class Server {
  readonly #collection: ServerCollection;
  readonly id: string;

  /**
   * Construct Server
   * @param collection Collection
   * @param id Id
   */
  constructor(collection: ServerCollection, id: string) {
    this.#collection = collection;
    this.id = id;
  }
  /**
   * Convert to string
   * @returns String
   */
  toString(): string {
    return `<%${this.id}>`;
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
   * Owner's user ID
   */
  get ownerId(): string {
    return this.#collection.getUnderlyingObject(this.id).ownerId;
  }

  /**
   * Owner
   */
  get owner(): User | undefined {
    return this.#collection.client.users.get(
      this.#collection.getUnderlyingObject(this.id).ownerId,
    );
  }

  /**
   * Absolute pathname to this server in the client
   */
  get path(): string {
    return `/server/${this.id}`;
  }

  /**
   * Name
   */
  get name(): string {
    return this.#collection.getUnderlyingObject(this.id).name;
  }

  /**
   * Description
   */
  get description(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).description;
  }

  /**
   * Icon
   */
  get icon(): File | undefined {
    return this.#collection.getUnderlyingObject(this.id).icon;
  }

  /**
   * Banner
   */
  get banner(): File | undefined {
    return this.#collection.getUnderlyingObject(this.id).banner;
  }

  /**
   * Channel IDs
   */
  get channelIds(): ReactiveSet<string> {
    return this.#collection.getUnderlyingObject(this.id).channelIds;
  }

  /**
   * Channels
   */
  get channels(): Channel[] {
    const channelIds = this.#collection.getUnderlyingObject(this.id).channelIds;
    if (!channelIds) return [];

    return [...channelIds.values()]
      .map((id) => this.#collection.client.channels.get(id)!)
      .filter((x) => x);
  }

  /**
   * Categories
   */
  get categories(): Category[] | undefined {
    return this.#collection.getUnderlyingObject(this.id).categories;
  }

  /**
   * System message channels
   */
  get systemMessages(): APIServer["system_messages"] {
    return this.#collection.getUnderlyingObject(this.id).systemMessages;
  }

  /**
   * Roles
   */
  get roles(): ReactiveMap<string, ServerRole> {
    return this.#collection.getUnderlyingObject(this.id).roles;
  }

  /**
   * Default permissions
   */
  get defaultPermissions(): bigint {
    return this.#collection.getUnderlyingObject(this.id).defaultPermissions;
  }

  /**
   * Server flags
   */
  get flags(): ServerFlags {
    return this.#collection.getUnderlyingObject(this.id).flags;
  }

  /**
   * Whether analytics are enabled for this server
   */
  get analytics(): boolean {
    return this.#collection.getUnderlyingObject(this.id).analytics;
  }

  /**
   * Whether this server is publicly discoverable
   */
  get discoverable(): boolean {
    return this.#collection.getUnderlyingObject(this.id).discoverable;
  }

  /**
   * Whether the owner has requested a public discovery listing
   * (pending until a platform admin approves)
   */
  get discoveryRequested(): boolean {
    return this.#collection.getUnderlyingObject(this.id).discoveryRequested;
  }

  /**
   * Preferred voice node for this server's voice channels (a node name
   * advertised under `features.livekit.nodes`); `undefined` = automatic.
   * Only decides where a room is OPENED — a live room keeps its node.
   */
  get voiceRegion(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).voiceRegion;
  }

  /**
   * Id of this server's AFK voice channel, if one is designated.
   * Members moved here are muted at the SFU; `undefined` = no AFK channel.
   */
  get afkChannelId(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).afkChannelId;
  }

  /**
   * Idle timeout in SECONDS before an idle member is moved to the AFK
   * channel; `undefined` = no timeout configured.
   */
  get afkTimeout(): number | undefined {
    return this.#collection.getUnderlyingObject(this.id).afkTimeout;
  }

  /**
   * Whether this server is marked as mature
   */
  get mature(): boolean {
    return this.#collection.getUnderlyingObject(this.id).nsfw;
  }

  /**
   * Get an array of ordered categories with their respective channels.
   * Uncategorised channels are returned in `id="default"` category.
   */
  get orderedChannels(): (Omit<Category, "channels"> & {
    channels: Channel[];
  })[] {
    const uncategorised = new Set(this.channels.map((channel) => channel.id));

    const elements = [];
    let defaultCategory;

    const categories = this.categories;
    if (categories) {
      for (const category of categories) {
        const channels = [];
        for (const key of category.channels) {
          if (uncategorised.delete(key)) {
            channels.push(this.#collection.client.channels.get(key)!);
          }
        }

        const cat = {
          ...category,
          channels,
        };

        if (cat.id === "default") {
          if (channels.length === 0) continue;

          defaultCategory = cat;
        }

        elements.push(cat);
      }
    }

    // force Default category for client logic
    // if (uncategorised.size > 0) {
    const channels = [...uncategorised].map(
      (key) => this.#collection.client.channels.get(key)!,
    );

    if (defaultCategory) {
      defaultCategory.channels = [...defaultCategory.channels, ...channels];
    } else {
      elements.unshift({
        id: "default",
        title: "Default",
        channels,
      });
    }
    // }

    return elements;
  }

  /**
   * Default channel for this server
   */
  get defaultChannel(): Channel | undefined {
    return this.orderedChannels.find((cat) => cat.channels.length)?.channels[0];
  }

  /**
   * Get an ordered array of roles with their IDs attached.
   * The highest ranking roles will be first followed by lower
   * ranking roles. This is dictated by the "rank" property
   * which is smaller for higher priority roles.
   */
  get orderedRoles(): ServerRole[] {
    const roles = this.roles;
    return roles
      ? [...roles.values()].sort((a, b) => (a.rank || 0) - (b.rank || 0))
      : [];
  }

  /**
   * Check whether the server is currently unread
   * @returns Whether the server is unread
   */
  get unread(): boolean {
    return !!this.channels.find((channel) => channel.unread);
  }

  /**
   * Total unread messages across this server's channels.
   *
   * Muted channels are left out — they do not raise the unread indicator, so
   * they should not inflate the number sitting next to it either.
   */
  get unreadCount(): number {
    return this.channels.reduce(
      (total, channel) => total + (channel.muted ? 0 : channel.unreadCount),
      0,
    );
  }

  /**
   * Whether any unread message across this server's channels carries an
   * attachment
   */
  get unreadHasAttachments(): boolean {
    return this.channels.some(
      (channel) => !channel.muted && channel.unreadHasAttachments,
    );
  }

  /**
   * Find all message IDs of unread messages
   * @returns Array of message IDs which are unread
   */
  get mentions(): string[] {
    const arr = this.channels.map((channel) =>
      Array.from(channel.mentions?.values() ?? []),
    );

    return ([] as string[]).concat(...arr);
  }

  /**
   * URL to the server's icon
   */
  get iconURL(): string | undefined {
    return this.icon?.createFileURL();
  }

  /**
   * URL to the server's animated icon
   */
  get animatedIconURL(): string | undefined {
    return this.icon?.createFileURL(true);
  }

  /**
   * URL to the server's banner
   */
  get bannerURL(): string | undefined {
    return this.banner?.createFileURL();
  }

  /**
   * Own member object for this server
   */
  get member(): ServerMember | undefined {
    return this.#collection.client.serverMembers.getByKey({
      server: this.id,
      user: this.#collection.client.user!.id,
    });
  }

  /**
   * Permission the currently authenticated user has against this server
   */
  get permission(): bigint {
    if (!this.$exists) return 0n;
    return calculatePermission(this.#collection.client, this);
  }

  /**
   * Check whether we have a given permission in a server
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
   * Check whether we have at least one of the given permissions in a server
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
   * Helper function to retrieve cached server member by their ID in this server
   * @param userId User's ID
   * @returns Server Member (if cached)
   */
  getMember(userId: string): ServerMember | undefined {
    return this.#collection.client.serverMembers.getByKey({
      server: this.id,
      user: userId,
    });
  }

  /**
   * Create a channel
   * @param data Channel create route data
   * @returns The newly-created channel
   */
  async createChannel(data: DataCreateServerChannel): Promise<Channel> {
    const channel = await this.#collection.client.api.post(
      `/servers/${this.id as ""}/channels`,
      data,
    );

    return this.#collection.client.channels.getOrCreate(channel._id, channel);
  }

  /**
   * Edit a server
   * @param data Changes
   */
  async edit(data: DataEditServer): Promise<void> {
    this.#collection.updateUnderlyingObject(
      this.id,
      hydrate(
        "server",
        await this.#collection.client.api.patch(
          `/servers/${this.id as ""}`,
          data,
        ),
        this.#collection.client,
        false,
      ),
    );
  }

  /**
   * Set ordering of roles
   * @param roleIds Role IDs
   */
  async setRoleOrdering(roleIds: string[]): Promise<void> {
    this.#collection.updateUnderlyingObject(
      this.id,
      hydrate(
        "server",
        await this.#collection.client.api.patch(
          `/servers/${this.id as ""}/roles/ranks`,
          {
            ranks: roleIds,
          },
        ),
        this.#collection.client,
        false,
      ),
    );
  }

  /**
   * Delete the underlying server
   * @param leaveEvent Whether we are leaving
   */
  $delete(leaveEvent?: boolean): void {
    batch(() => {
      const client = this.#collection.client;
      const server = client.servers.getUnderlyingObject(this.id);

      // Avoid race conditions
      if (server.id) {
        client.emit(leaveEvent ? "serverLeave" : "serverDelete", server);

        // channelIds lists only top-level channels; threads and forum posts
        // are never in it. Sweep every cached channel pointing at this server
        // too, snapshotted before anything is deleted
        const ids = new Set(this.channelIds);
        for (const channel of client.channels.filter(
          (channel) => channel.serverId === this.id,
        )) {
          ids.add(channel.id);
        }

        for (const message of client.messages.filter((message) =>
          ids.has(message.channelId),
        )) {
          client.messages.delete(message.id);
        }

        for (const id of ids) {
          const channel = client.channels.get(id);
          if (channel) {
            // Clear pending typing timers so they cannot recreate the channel
            // as a partial (when partials are on), and so a held thread
            // instance no longer lists us as a member
            for (const timer of Object.values(channel._typingTimers)) {
              clearTimeout(timer);
            }

            channel._typingTimers = {};
            channel.threadMembers.clear();
          }

          client.channels.delete(id);
        }

        // Unread rows are kept on purpose: dropping them would mark every
        // channel fully unread after rejoining in the same session
        this.#collection.delete(this.id);
      }
      // TODO: members, emoji and other per-server collections are left behind
    });
  }

  /**
   * Delete or leave a server
   * @param leaveSilently Whether to not send a message on leave
   */
  async delete(leaveSilently?: boolean): Promise<void> {
    await this.#collection.client.api.delete(`/servers/${this.id as ""}`, {
      leave_silently: leaveSilently,
    });

    this.$delete();
  }

  /**
   * Mark a server as read
   */
  async ack(): Promise<void> {
    batch(() => {
      for (const channel of this.channels) {
        channel.ack(undefined, false, true);
      }
    });

    await this.#collection.client.api.put(`/servers/${this.id}/ack`);
  }

  /**
   * Ban user from this server
   * @param user User
   * @param options Ban options
   */
  async banUser(
    user: string | User | ServerMember,
    options: DataBanCreate = {},
  ): Promise<ServerBan> {
    const userId =
      user instanceof User
        ? user.id
        : user instanceof ServerMember
          ? user.id.user
          : user;

    const ban = await this.#collection.client.api.put(
      `/servers/${this.id as ""}/bans/${userId as ""}`,
      options,
    );

    return new ServerBan(this.#collection.client, ban);
  }

  /**
   * Kick user from this server
   *
   * A reason is recorded in the server's audit log. It travels in the
   * `X-Audit-Log-Reason` header, percent-encoded because header values must
   * be Latin-1 and `fetch` throws on anything else; the server decodes it,
   * trims it and refuses more than 512 characters with
   * `FailedValidation { error: "AuditLogReasonTooLong" }`. A missing or blank
   * reason sends no header.
   * @param user User
   * @param options Kick options
   * @param options.reason Reason shown in the audit log
   * @throws The server's error object when the kick is refused
   */
  async kickUser(
    user: string | User | ServerMember,
    options?: { reason?: string },
  ): Promise<void> {
    const reason =
      typeof options?.reason === "string" ? options.reason.trim() : "";

    return await this.#collection.client.api.delete(
      `/servers/${this.id as ""}/members/${
        typeof user === "string"
          ? user
          : user instanceof User
            ? user.id
            : user.id.user
      }`,
      undefined,
      reason
        ? { headers: { "X-Audit-Log-Reason": encodeURIComponent(reason) } }
        : undefined,
    );
  }

  /**
   * Pardon user's ban
   * @param user User
   */
  async unbanUser(user: string | User): Promise<void> {
    const userId = user instanceof User ? user.id : user;
    return await this.#collection.client.api.delete(
      `/servers/${this.id as ""}/bans/${userId}`,
    );
  }

  /**
   * Fetch a server's invites
   * @returns An array of the server's invites
   */
  async fetchInvites(): Promise<ChannelInvite[]> {
    const invites = await this.#collection.client.api.get(
      `/servers/${this.id as ""}/invites`,
    );

    return invites.map((invite) =>
      ChannelInvite.from(this.#collection.client, invite),
    );
  }

  /**
   * Fetch a server's bans
   * @returns An array of the server's bans.
   */
  async fetchBans(): Promise<ServerBan[]> {
    const { users, bans } = await this.#collection.client.api.get(
      `/servers/${this.id as ""}/bans`,
    );

    const userDict = users.reduce(
      (d, c) => ({ ...d, [c._id]: c }),
      {} as Record<string, BannedUser>,
    );

    return bans.map(
      (ban) =>
        new ServerBan(this.#collection.client, ban, userDict[ban._id.user]),
    );
  }

  /**
   * Fetch one page of this server's audit log, newest first
   *
   * The end of the log is an EMPTY `entries` array; a short page is not the
   * end. To page back, pass the `_id` of the last (oldest) entry as `before`.
   * The page's users are cached in the client's user collection, and the
   * page itself is returned as plain data.
   * @param query Paging and filters; unset, null and empty keys are omitted
   * @requires `ViewAuditLog`
   * @returns One page of entries and the users they refer to
   * @throws The server's error object when the request is refused
   */
  async fetchAuditLog(query: AuditLogQuery = {}): Promise<AuditLogPage> {
    // Omit unset keys entirely. The server reads `?user=` as a filter on an
    // actor id of "", which returns an empty page that looks like the end of
    // the log, and `apiReq` only drops null/undefined, not "".
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      params[key] = value;
    }

    // stoat-api 0.13.5 has no audit log route in its generated tables, so its
    // typed client would drop the query; use the raw request instead.
    const page = (await this.#collection.client.channels.apiReq(
      "GET",
      `/servers/${this.id}/audit_log`,
      { query: params },
    )) as AuditLogPage;

    batch(() => {
      for (const user of page.users) {
        this.#collection.client.users.getOrCreate(user._id, user);
      }
    });

    return page;
  }

  /**
   * Set role permissions
   * @param roleId Role Id, set to 'default' to affect all users
   * @param permissions Permission value
   */
  async setPermissions(
    roleId = "default",
    permissions: Override | number,
  ): Promise<APIServer> {
    return await this.#collection.client.api.put(
      `/servers/${this.id as ""}/permissions/${roleId as ""}`,
      { permissions: permissions as Override },
    );
  }

  /**
   * Create role
   * @param name Role name
   */
  async createRole(name: string): Promise<{ id: string; role: Role }> {
    return await this.#collection.client.api.post(
      `/servers/${this.id as ""}/roles`,
      {
        name,
      },
    );
  }

  /**
   * Edit a role
   * @param roleId Role ID
   * @param data Role editing route data
   */
  async editRole(roleId: string, data: DataEditRole): Promise<ServerRole> {
    const updated = await this.#collection.client.api.patch(
      `/servers/${this.id as ""}/roles/${roleId as ""}`,
      data,
    );

    const role = new ServerRole(
      this.#collection.client,
      this.id,
      roleId,
      updated,
    );

    this.roles.set(roleId, role);

    return role;
  }

  /**
   * Delete role
   * @param roleId Role ID
   */
  async deleteRole(roleId: string): Promise<void> {
    return await this.#collection.client.api.delete(
      `/servers/${this.id as ""}/roles/${roleId as ""}`,
    );
  }

  /**
   * Fetch a server member
   * @param user User
   * @returns Server member object
   */
  async fetchMember(user: User | string): Promise<ServerMember> {
    const userId = typeof user === "string" ? user : user.id;
    const existing = this.#collection.client.serverMembers.getByKey({
      server: this.id,
      user: userId,
    });

    if (existing) return existing;
    return this.#collection.client.serverMembers.fetch(this.id, userId);
  }

  #synced: undefined | "partial" | "full";

  async syncMembers(
    excludeOffline?: boolean,
    excludeOfflineUserCap?: number,
  ): Promise<void> {
    if (this.#synced && (this.#synced === "full" || excludeOffline)) return;

    const data = await this.#collection.client.api.get(
      `/servers/${this.id as ""}/members`,
      { exclude_offline: excludeOffline },
    );

    batch(() => {
      if (excludeOffline && excludeOfflineUserCap) {
        // quick fix to cap users
        let count = 0;

        for (
          let i = 0;
          i < data.users.length && count < excludeOfflineUserCap;
          i++
        ) {
          const user = data.users[i];
          if (user.online && data.members[i].roles?.length) {
            this.#collection.client.users.getOrCreate(user._id, user);
            this.#collection.client.serverMembers.getOrCreate(
              data.members[i]._id,
              data.members[i],
            );

            count++;
          }
        }

        for (
          let i = 0;
          i < data.users.length && count < excludeOfflineUserCap;
          i++
        ) {
          const user = data.users[i];
          if (user.online && !data.members[i].roles?.length) {
            this.#collection.client.users.getOrCreate(user._id, user);
            this.#collection.client.serverMembers.getOrCreate(
              data.members[i]._id,
              data.members[i],
            );

            count++;
          }
        }
        // end quick fix
      } else if (excludeOffline) {
        for (let i = 0; i < data.users.length; i++) {
          const user = data.users[i];
          if (user.online) {
            this.#collection.client.users.getOrCreate(user._id, user);
            this.#collection.client.serverMembers.getOrCreate(
              data.members[i]._id,
              data.members[i],
            );
          }
        }
      } else {
        for (let i = 0; i < data.users.length; i++) {
          this.#collection.client.users.getOrCreate(
            data.users[i]._id,
            data.users[i],
          );
          this.#collection.client.serverMembers.getOrCreate(
            data.members[i]._id,
            data.members[i],
          );
        }
      }
    });
  }

  /**
   * Reset member sync status
   */
  resetSyncStatus(): void {
    this.#synced = undefined;
  }

  /**
   * Fetch a server's members
   * @returns List of the server's members and their user objects
   */
  async fetchMembers(): Promise<{ members: ServerMember[]; users: User[] }> {
    const data = (await this.#collection.client.api.get(
      // @ts-expect-error TODO weird typing issue
      `/servers/${this.id as ""}/members`,
    )) as AllMemberResponse;

    return batch(() => ({
      members: data.members.map((member) =>
        this.#collection.client.serverMembers.getOrCreate(member._id, member),
      ),
      users: data.users.map((user) =>
        this.#collection.client.users.getOrCreate(user._id, user),
      ),
    }));
  }

  /**
   * Query members from a server by name
   * @param query Name
   * @returns List of the server's members and their user objects
   */
  async queryMembersExperimental(
    query: string,
  ): Promise<{ members: ServerMember[]; users: User[] }> {
    // Raw fetch: the typed client appends its own `?` to a path that already
    // embeds a query string, corrupting the last param (`query=foo?` reaches
    // the server with a literal trailing `?` and matches nothing).
    const api = this.#collection.client.api as unknown as {
      baseURL: string;
      auth: Record<string, string>;
    };
    const params = new URLSearchParams({
      experimental_api: "true",
      query,
    });
    const response = await fetch(
      `${api.baseURL}/servers/${this.id}/members_experimental_query?${params}`,
      { headers: api.auth },
    );
    if (!response.ok) throw await response.text();
    const data = (await response.json()) as AllMemberResponse;

    return batch(() => ({
      members: data.members.map((member) =>
        this.#collection.client.serverMembers.getOrCreate(member._id, member),
      ),
      users: data.users.map((user) =>
        this.#collection.client.users.getOrCreate(user._id, user),
      ),
    }));
  }

  /**
   * Create an emoji on the server
   * @param autumnId Autumn Id
   * @param options Options
   */
  async createEmoji(
    autumnId: string,
    options: Omit<DataCreateEmoji, "parent">,
  ): Promise<Emoji> {
    const emoji = await this.#collection.client.api.put(
      `/custom/emoji/${autumnId as ""}`,
      {
        parent: {
          type: "Server",
          id: this.id,
        },
        ...options,
      },
    );

    return this.#collection.client.emojis.getOrCreate(emoji._id, emoji, true);
  }

  /**
   * Fetch a server's emoji
   * @returns List of server emoji
   */
  async fetchEmojis(): Promise<Emoji[]> {
    const emojis = await this.#collection.client.api.get(
      `/servers/${this.id as ""}/emojis`,
    );

    return batch(() =>
      emojis.map((emoji) =>
        this.#collection.client.emojis.getOrCreate(emoji._id, emoji),
      ),
    );
  }

  /**
   * All emojis tied to this server
   */
  get emojis(): Emoji[] {
    return this.#collection.client.emojis.filter(
      (emoji) => emoji.parent.type === "Server" && emoji.parent.id === this.id,
    );
  }

  /**
   * Delete emoji
   * @param emojiId Emoji ID
   */
  async deleteEmoji(emojiId: string): Promise<void> {
    await this.#collection.client.api.delete(`/custom/emoji/${emojiId}`);
  }
}
