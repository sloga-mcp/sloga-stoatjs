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
   */
  async edit(data: DataMemberEdit): Promise<void> {
    await this.#collection.client.api.patch(
      `/servers/${this.id.server as ""}/members/${this.id.user as ""}`,
      data,
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
   * Ban this member from the server
   * @param options Ban options
   */
  async ban(options: DataBanCreate): Promise<void> {
    this.server?.banUser(this, options);
  }

  /**
   * Kick this member from the server
   */
  async kick(): Promise<void> {
    this.server?.kickUser(this);
  }
}
