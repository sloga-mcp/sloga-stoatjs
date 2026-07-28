import type { User as APIUser, DataEditUser, Presence } from "stoat-api";
import { decodeTime } from "ulid";

import type { UserCollection } from "../collections/UserCollection.js";
import { hydrate } from "../hydration/index.js";
import type { UserConnection } from "../hydration/user.js";
import { U32_MAX, UserPermission } from "../permissions/definitions.js";

import type { Channel } from "./Channel.js";
import type { File } from "./File.js";
import { UserProfile } from "./UserProfile.js";

/**
 * User Class
 */
export class User {
  readonly #collection: UserCollection;
  readonly id: string;

  /**
   * Construct User
   * @param collection Collection
   * @param id Id
   */
  constructor(collection: UserCollection, id: string) {
    this.#collection = collection;
    this.id = id;
  }

  /**
   * Write to string as a user mention
   * @returns Formatted String
   */
  toString(): string {
    return `<@${this.id}>`;
  }

  /**
   * Whether this object exists
   */
  get $exists(): boolean {
    return !!this.#collection.getUnderlyingObject(this.id).id;
  }

  /**
   * Time when this user created their account
   */
  get createdAt(): Date {
    return new Date(decodeTime(this.id));
  }

  /**
   * Username
   */
  get username(): string {
    return this.#collection.getUnderlyingObject(this.id).username;
  }

  /**
   * Discriminator
   */
  get discriminator(): string {
    return this.#collection.getUnderlyingObject(this.id).discriminator;
  }

  /**
   * Display Name
   */
  get displayName(): string {
    return (
      this.#collection.getUnderlyingObject(this.id).displayName ??
      this.#collection.getUnderlyingObject(this.id).username
    );
  }

  /**
   * Avatar
   */
  get avatar(): File | undefined {
    return this.#collection.getUnderlyingObject(this.id).avatar;
  }

  /**
   * Badges
   */
  get badges(): number {
    return this.#collection.getUnderlyingObject(this.id).badges;
  }

  /**
   * Whether this user advertises E2EE opt-in.
   *
   * Discovery / UI hint ONLY (invariant 2): it may trigger an ATTEMPT to
   * establish encryption (sender-initiated upgrade), but actual capability
   * always derives from a fetched, signature-verified key bundle — and a
   * pinned conversation never downgrades because this flag flips.
   */
  get e2eeEnabled(): boolean {
    return this.#collection.getUnderlyingObject(this.id).e2eeEnabled ?? false;
  }

  /**
   * User Status
   */
  get status():
    | {
        text?: string | null;
        presence?: Presence | null;
        activity?: { name: string; started_at?: string } | null;
      }
    | undefined {
    // TODO: issue with API, upstream fix required #319
    if (!this.online)
      return { text: undefined, presence: "Invisible" as const };
    return this.#collection.getUnderlyingObject(this.id).status;
  }

  /**
   * Game or application the user is currently playing, if online
   */
  get activity(): { name: string; started_at?: string } | undefined {
    return (this.online && this.status?.activity) || undefined;
  }

  /**
   * Linked streaming channels (Twitch / YouTube)
   */
  get connections(): UserConnection[] {
    return this.#collection.getUnderlyingObject(this.id).connections ?? [];
  }

  /**
   * Linked streaming channels that are currently live
   */
  get liveConnections(): UserConnection[] {
    return this.connections.filter((connection) => connection.live);
  }

  /**
   * Relationship with user
   */
  get relationship(): string {
    return this.#collection.getUnderlyingObject(this.id).relationship;
  }

  /**
   * Whether the user is online
   */
  get online(): boolean {
    return this.#collection.getUnderlyingObject(this.id).online;
  }

  /**
   * Whether the user is privileged
   */
  get privileged(): boolean {
    return this.#collection.getUnderlyingObject(this.id).privileged;
  }

  /**
   * Flags
   */
  get flags(): number {
    return this.#collection.getUnderlyingObject(this.id).flags;
  }

  /**
   * Bot information
   */
  get bot(): { owner: string } | undefined {
    return this.#collection.getUnderlyingObject(this.id).bot;
  }

  /**
   * Whether this user is ourselves
   */
  get self(): boolean {
    return this.#collection.client.user === this;
  }

  /**
   * URL to the user's default avatar
   */
  get defaultAvatarURL(): string {
    return `${this.#collection.client.options.baseURL}/users/${
      this.id
    }/default_avatar`;
  }

  /**
   * URL to the user's avatar
   */
  get avatarURL(): string {
    return this.avatar?.createFileURL() ?? this.defaultAvatarURL;
  }

  /**
   * URL to the user's animated avatar
   */
  get animatedAvatarURL(): string {
    return this.avatar?.createFileURL(true) ?? this.defaultAvatarURL;
  }

  /**
   * Presence
   */
  get presence(): Presence {
    return this.online ? (this.status?.presence ?? "Online") : "Invisible";
  }

  /**
   * Generate status message
   * @param translate Translation function
   * @returns Status message
   */
  statusMessage(
    translate: (presence: Presence) => string = (a) => a,
  ): string | undefined {
    return this.online
      ? (this.status?.text ??
          (this.presence === "Focus" ? translate("Focus") : undefined))
      : undefined;
  }

  /**
   * Permissions against this user
   */
  get permission(): number {
    let permissions = 0;
    switch (this.relationship) {
      case "Friend":
      case "User":
        return U32_MAX;
      case "Blocked":
      case "BlockedOther":
        return UserPermission.Access;
      case "Incoming":
      case "Outgoing":
        permissions = UserPermission.Access;
    }

    if (
      this.#collection.client.channels.find(
        (channel) =>
          (channel.type === "Group" || channel.type === "DirectMessage") &&
          channel.recipientIds.has(this.id),
      ) ||
      this.#collection.client.serverMembers.find(
        (member) => member.id.user === this.id,
      )
    ) {
      // a mutual server or group is enough to message someone, mirroring
      // the backend's calculate_user_permissions
      permissions |=
        UserPermission.Access |
        UserPermission.ViewProfile |
        UserPermission.SendMessage;
    }

    return permissions;
  }

  /**
   * Edit the user
   * @param data Changes
   */
  async edit(data: DataEditUser): Promise<void> {
    this.#collection.updateUnderlyingObject(
      this.id,
      hydrate(
        "user",
        await this.#collection.client.api.patch(
          `/users/${
            this.id === this.#collection.client.user?.id ? "@me" : this.id
          }`,
          data,
        ),
        this.#collection.client,
        false,
      ),
    );
  }

  /**
   * Change the username of the current user
   * @param username New username
   * @param password Current password
   */
  async changeUsername(username: string, password: string): Promise<APIUser> {
    return await this.#collection.client.api.patch("/users/@me/username", {
      username,
      password,
    });
  }

  /**
   * Open a DM with a user
   * @returns DM Channel
   */
  async openDM(): Promise<Channel> {
    let dm = [...this.#collection.client.channels.values()].find(
      (x) => x.type === "DirectMessage" && x.recipient == this,
    );

    if (dm) {
      if (!dm.active) {
        this.#collection.client.channels.updateUnderlyingObject(
          dm.id,
          "active",
          true,
        );
      }
    } else {
      const data = await this.#collection.client.api.get(
        `/users/${this.id as ""}/dm`,
      );

      dm = this.#collection.client.channels.getOrCreate(data._id, data)!;
    }

    return dm;
  }

  /**
   * Send a friend request to a user
   */
  async addFriend(): Promise<User> {
    let discriminator = this.discriminator;
    if (!discriminator) {
      const fresh = await this.#collection.fetch(this.id);
      discriminator = fresh.discriminator;
    }

    const user = await this.#collection.client.api.post(`/users/friend`, {
      username: this.username + "#" + discriminator,
    });

    return this.#collection.getOrCreate(user._id, user);
  }

  /**
   * Remove a user from the friend list
   */
  async removeFriend(): Promise<void> {
    await this.#collection.client.api.delete(`/users/${this.id as ""}/friend`);
  }

  /**
   * Block a user
   */
  async blockUser(): Promise<void> {
    await this.#collection.client.api.put(`/users/${this.id as ""}/block`);
  }

  /**
   * Unblock a user
   */
  async unblockUser(): Promise<void> {
    await this.#collection.client.api.delete(`/users/${this.id as ""}/block`);
  }

  /**
   * Fetch the profile of a user
   * @returns The profile of the user
   */
  async fetchProfile(): Promise<UserProfile> {
    return new UserProfile(
      this.#collection.client,
      await this.#collection.client.api.get(`/users/${this.id as ""}/profile`),
    );
  }

  /**
   * Fetch the mutual connections of the current user and a target user
   * @returns The mutual connections of the current user and a target user
   */
  async fetchMutual(): Promise<{ users: string[]; servers: string[] }> {
    return await this.#collection.client.api.get(
      `/users/${this.id as ""}/mutual`,
    );
  }
}
