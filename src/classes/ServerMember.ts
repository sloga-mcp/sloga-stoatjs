import type {
  DataBanCreate,
  DataMemberEdit,
  MemberCompositeKey,
  Role,
} from "stoat-api";

import type { ServerMemberCollection } from "../collections/ServerMemberCollection.js";
import {
  bitwiseAndEq,
  calculatePermission,
} from "../permissions/calculator.js";
import { Permission } from "../permissions/definitions.js";

import type { Channel } from "./Channel.js";
import type { File } from "./File.js";
import type { Server } from "./Server.js";
import { ServerRole } from "./ServerRole.js";
import type { User } from "./User.js";

/**
 * Deterministic conversion of member composite key to string ID
 * @param key Key
 * @returns String key
 */
function key(key: MemberCompositeKey): string {
  return key.server + key.user;
}

/**
 * Server Member Class
 */
export class ServerMember {
  readonly #collection: ServerMemberCollection;
  readonly id: MemberCompositeKey;

  /**
   * Construct Server Member
   * @param collection Collection
   * @param id Id
   */
  constructor(collection: ServerMemberCollection, id: MemberCompositeKey) {
    this.#collection = collection;
    this.id = id;
  }

  /**
   * Convert to string
   * @returns String
   */
  toString(): string {
    return `<@${this.id.user}>`;
  }

  /**
   * Whether this object exists
   */
  get $exists(): boolean {
    return !this.#collection.getUnderlyingObject(key(this.id)).id;
  }

  /**
   * Server this member belongs to
   */
  get server(): Server | undefined {
    return this.#collection.client.servers.get(this.id.server);
  }

  /**
   * User corresponding to this member
   */
  get user(): User | undefined {
    return this.#collection.client.users.get(this.id.user);
  }

  /**
   * When this user joined the server
   */
  get joinedAt(): Date {
    return this.#collection.getUnderlyingObject(key(this.id)).joinedAt;
  }

  /**
   * Nickname
   */
  get nickname(): string | undefined {
    return this.#collection.getUnderlyingObject(key(this.id)).nickname;
  }

  /**
   * Avatar
   */
  get avatar(): File | undefined {
    return this.#collection.getUnderlyingObject(key(this.id)).avatar;
  }

  /**
   * List of role IDs
   */
  get roles(): string[] {
    return this.#collection.getUnderlyingObject(key(this.id)).roles;
  }

  /**
   * Time at which timeout expires
   */
  get timeout(): Date | undefined {
    return this.#collection.getUnderlyingObject(key(this.id)).timeout;
  }

  /**
   * When this member's timeout expires, if they are timed out right now.
   *
   * Returns the `timeout` date only while it is still in the future, and
   * `undefined` otherwise (no timeout, an expired one, or an invalid date).
   *
   * Not reactive to the passage of time: the comparison against the current
   * time happens once per call. A caller that must react to the timeout
   * expiring has to drive its own timer and call this again.
   * @returns Expiry of the active timeout, or undefined
   */
  timedOutUntil(): Date | undefined {
    const timeout = this.timeout;
    if (timeout && timeout.getTime() > Date.now()) {
      return timeout;
    }

    return undefined;
  }

  /**
   * Whether this member is server-muted (may not publish audio or video).
   */
  get serverMuted(): boolean {
    return !this.#collection.getUnderlyingObject(key(this.id)).canPublish;
  }

  /**
   * Whether this member is server-deafened (receives no remote media).
   */
  get serverDeafened(): boolean {
    return !this.#collection.getUnderlyingObject(key(this.id)).canReceive;
  }

  /**
   * Ordered list of roles for this member, from lowest to highest priority.
   */
  get orderedRoles(): ServerRole[] {
    const server = this.server!;
    return this.roles
      ?.map((id) => server.roles.get(id)!)
      .filter((role) => role)
      .sort((a, b) => b.rank! - a.rank!);
  }

  /**
   * Member's currently hoisted role.
   */
  get hoistedRole(): ServerRole | null {
    const roles = this.orderedRoles.filter((x) => x.hoist);
    if (roles.length > 0) {
      return roles[roles.length - 1];
    } else {
      return null;
    }
  }

  /**
   * Member's current role colour.
   */
  get roleColour(): string | null | undefined {
    const roles = this.orderedRoles.filter((x) => x.colour);
    if (roles.length > 0) {
      return roles[roles.length - 1].colour;
    } else {
      return null;
    }
  }

  /**
   * Member's current role icon with name.
   */
  get iconRole(): ServerRole | null | undefined {
    const roles = this.orderedRoles.filter((x) => x.icon);
    if (roles.length > 0) {
      return roles[roles.length - 1]!;
    } else {
      return null;
    }
  }

  /**
   * Member's ranking
   * Smaller values are ranked as higher priority
   */
  get ranking(): number {
    if (this.id.user === this.server?.ownerId) {
      return -Infinity;
    }

    const roles = this.orderedRoles;
    if (roles.length > 0) {
      return roles[roles.length - 1].rank!;
    } else {
      return Infinity;
    }
  }

  /**
   * Get the permissions that this member has against a certain object
   * @param target Target object to check permissions against
   * @returns Permissions that this member has
   */
  getPermissions(target: Server | Channel): bigint {
    return calculatePermission(this.#collection.client, target, {
      member: this,
    });
  }

  /**
   * Check whether a member has a certain permission against a certain object
   * @param target Target object to check permissions against
   * @param permission Permission names to check for
   * @returns Whether the member has this permission
   */
  hasPermission(
    target: Server | Channel,
    ...permission: (keyof typeof Permission)[]
  ): boolean {
    return bitwiseAndEq(
      this.getPermissions(target),
      ...permission.map((x) => Permission[x]),
    );
  }

  /**
   * Checks whether the target member has a higher rank than this member.
   * @param target The member to compare against
   * @returns Whether this member is inferior to the target
   */
  inferiorTo(target: ServerMember): boolean {
    return target.ranking < this.ranking;
  }

  /**
   * Display name
   */
  get displayName(): string | undefined {
    return this.nickname ?? this.user?.displayName;
  }

  /**
   * URL to the member's avatar
   */
  get avatarURL(): string | undefined {
    return this.avatar?.createFileURL() ?? this.user?.avatarURL;
  }

  /**
   * URL to the member's animated avatar
   */
  get animatedAvatarURL(): string | undefined {
    return this.avatar?.createFileURL(true) ?? this.user?.animatedAvatarURL;
  }

  /**
   * Edit a member
   * @param data Changes
   * @param options Audit log options; a non-blank `reason` is sent as the
   *   percent-encoded `X-Audit-Log-Reason` header
   */
  async edit(
    data: DataMemberEdit,
    options?: { reason?: string },
  ): Promise<void> {
    const reason = options?.reason?.trim();

    await this.#collection.client.api.patch(
      `/servers/${this.id.server as ""}/members/${this.id.user as ""}`,
      data,
      reason
        ? { headers: { "X-Audit-Log-Reason": encodeURIComponent(reason) } }
        : undefined,
    );
  }

  /**
   * Server-mute or un-mute this member.
   *
   * Sends the explicit boolean in BOTH directions rather than clearing the
   * field: `remove: ["CanPublish"]` is the other shape the API accepts, but
   * it forces every other client to infer the new value, and the server
   * treats the two paths separately.
   * @param muted Whether the member may not publish audio or video
   */
  async setServerMuted(muted: boolean): Promise<void> {
    await this.edit({ can_publish: !muted });
  }

  /**
   * Server-deafen or un-deafen this member.
   * @param deafened Whether the member receives no remote media
   */
  async setServerDeafened(deafened: boolean): Promise<void> {
    await this.edit({ can_receive: !deafened });
  }

  /**
   * Disconnect this member from the voice channel they are in.
   *
   * Clearing `VoiceChannel` is the API's disconnect — it is NOT a server
   * kick, and the member may rejoin unless something else stops them.
   */
  async disconnectFromVoice(): Promise<void> {
    await this.edit({ remove: ["VoiceChannel"] });
  }

  /**
   * Move this member to another voice channel in the same server.
   *
   * Moving another member needs MoveMembers on the source and destination
   * channels, Connect on the destination and a higher rank. Moving yourself
   * needs Connect on the destination and respects its user limit; a
   * device-bound call must be moved from that device's session.
   *
   * The server may refuse with 403 MissingPermission / NotElevated,
   * 400 NotAVoiceChannel / InvalidOperation / NotConnected /
   * FailedValidation / CannotJoinCall / LiveKitUnavailable,
   * 401 NotAuthenticated, 404 UnknownChannel, or 409 VideoCallFull /
   * MlsCallFull.
   * @param channelId Target voice channel id
   */
  async moveToVoiceChannel(channelId: string): Promise<void> {
    await this.edit({ voice_channel: channelId });
  }

  /**
   * Ban this member from the server
   *
   * Rejects when the server refuses the ban, or when the server is not
   * cached.
   * @param options Ban options
   */
  async ban(options: DataBanCreate): Promise<void> {
    await this.#requireServer().banUser(this, options);
  }

  /**
   * Kick this member from the server
   *
   * Rejects when the server refuses the kick, or when the server is not
   * cached.
   * @param options Audit log options; a non-blank `reason` is recorded with
   *   the kick
   */
  async kick(options?: { reason?: string }): Promise<void> {
    await this.#requireServer().kickUser(this, options);
  }

  /**
   * Server this member belongs to, or throw if it is not cached, so that a
   * moderation call never resolves without having reached the API.
   * @returns Server
   */
  #requireServer(): Server {
    const server = this.server;
    if (!server) {
      throw new Error(`Server ${this.id.server} is not cached`);
    }

    return server;
  }
}
