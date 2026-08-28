import type { ReactiveMap } from "@solid-primitives/map";
import type { ReactiveSet } from "@solid-primitives/set";
import type {
  Message as APIMessage,
  MessageWebhook as APIMessageWebhook,
  DataEditMessage,
  DataMessageSend,
  Masquerade,
} from "stoat-api";
import { decodeTime, ulid } from "ulid";

import type { Client } from "../Client.js";
import type { MessageCollection } from "../collections/MessageCollection.js";
import { MessageFlags, messageFlagAtPosition } from "../hydration/message.js";

import type { Channel } from "./Channel.js";
import type { CrosspostInfoData } from "./ChannelFollow.js";
import { File } from "./File.js";
import type { HydratedForwardedSnapshot } from "./ForwardedMessage.js";
import type {
  ActionRowData,
  MessageInteractionData,
} from "./Interaction.js";
import type { MessageEmbed } from "./MessageEmbed.js";
import {
  pollStateFromWire,
  type PollData,
  type PollDefinitionData,
  type PollState,
} from "./Poll.js";
import {
  softresStateFromWire,
  type DataSoftResEdit,
  type DataSoftResReserve,
  type SoftResData,
  type SoftResDefinitionData,
  type SoftResExportFormat,
  type SoftResExportResponseData,
  type SoftResState,
} from "./SoftRes.js";
import type { Server } from "./Server.js";
import type { ServerMember } from "./ServerMember.js";
import { ServerRole } from "./ServerRole.js";
import type { SystemMessage } from "./SystemMessage.js";
import type { User } from "./User.js";

/**
 * Message Class
 */
export class Message {
  readonly #collection: MessageCollection;
  readonly id: string;

  /**
   * Construct Message
   * @param collection Collection
   * @param id Message Id
   */
  constructor(collection: MessageCollection, id: string) {
    this.#collection = collection;
    this.id = id;
  }

  /**
   * Whether this object exists
   */
  get $exists(): boolean {
    return !!this.#collection.getUnderlyingObject(this.id).id;
  }

  /**
   * Time when this message was posted
   */
  get createdAt(): Date {
    return new Date(decodeTime(this.id));
  }

  /**
   * Absolute pathname to this message in the client
   */
  get path(): string {
    return `${this.channel?.path}/${this.id}`;
  }

  /**
   * URL to this message
   */
  get url(): string | undefined {
    return this.#collection.client.configuration?.app + this.path;
  }

  /**
   * Nonce value
   */
  get nonce(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).nonce;
  }

  /**
   * Id of channel this message was sent in
   */
  get channelId(): string {
    return this.#collection.getUnderlyingObject(this.id).channelId;
  }

  /**
   * Channel this message was sent in
   */
  get channel(): Channel | undefined {
    return this.#collection.client.channels.get(
      this.#collection.getUnderlyingObject(this.id).channelId,
    );
  }

  /**
   * Server this message was sent in
   */
  get server(): Server | undefined {
    return this.channel?.server;
  }

  /**
   * Member this message was sent by
   */
  get member(): ServerMember | undefined {
    return this.#collection.client.serverMembers.getByKey({
      server: this.channel?.serverId as string,
      user: this.authorId!,
    });
  }

  /**
   * Id of user or webhook this message was sent by
   */
  get authorId(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).authorId;
  }

  /**
   * User this message was sent by
   */
  get author(): User | undefined {
    return this.#collection.client.users.get(
      this.#collection.getUnderlyingObject(this.id).authorId!,
    );
  }

  /**
   * Webhook information for this message
   */
  get webhook(): MessageWebhook | undefined {
    return this.#collection.getUnderlyingObject(this.id).webhook!;
  }

  /**
   * Content
   */
  get content(): string {
    return this.#collection.getUnderlyingObject(this.id).content ?? "";
  }

  /**
   * Content converted to plain text
   */
  get contentPlain(): string {
    return this.#collection.client.markdownToText(this.content);
  }

  /**
   * System message content
   */
  get systemMessage(): SystemMessage | undefined {
    return this.#collection.getUnderlyingObject(this.id).systemMessage;
  }

  /**
   * Attachments
   */
  get attachments(): File[] | undefined {
    return this.#collection.getUnderlyingObject(this.id).attachments;
  }

  /**
   * Time at which this message was edited
   */
  get editedAt(): Date | undefined {
    return this.#collection.getUnderlyingObject(this.id).editedAt;
  }

  /**
   * Embeds
   */
  get embeds(): MessageEmbed[] | undefined {
    return this.#collection.getUnderlyingObject(this.id).embeds;
  }

  /**
   * IDs of users this message mentions
   */
  get mentionIds(): string[] | undefined {
    return this.#collection.getUnderlyingObject(this.id).mentionIds;
  }

  /**
   * IDs of roles this message mentions
   */
  get roleMentionIds(): string[] | undefined {
    return this.#collection.getUnderlyingObject(this.id).roleMentionIds;
  }

  /**
   * Roles this message mentions
   */
  get roleMentions(): ServerRole[] | undefined {
    return this.roleMentionIds
      ?.map((roleId) => this.server?.roles.get(roleId) as ServerRole)
      .filter((role) => role);
  }

  /**
   * Whether this message mentions us
   */
  get mentioned(): boolean {
    return (
      !!(this.flags & MessageFlags.MentionsEveryone) ||
      !!(this.flags & MessageFlags.MentionsOnline) ||
      this.mentionIds?.includes(this.#collection.client.user!.id) ||
      this.roleMentions?.some((role) => role.assigned) ||
      false
    );
  }

  /**
   * ID of the thread anchored to this message, if one was created from it
   * (server-stamped)
   */
  get threadId(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).threadId;
  }

  /**
   * Thread anchored to this message, if one was created from it
   */
  get thread(): Channel | undefined {
    const id = this.threadId;
    return id ? this.#collection.client.channels.get(id) : undefined;
  }

  /**
   * IDs of messages this message replies to
   */
  get replyIds(): string[] | undefined {
    return this.#collection.getUnderlyingObject(this.id).replyIds;
  }

  /**
   * Reactions
   */
  get reactions(): ReactiveMap<string, ReactiveSet<string>> {
    return this.#collection.getUnderlyingObject(this.id).reactions;
  }

  /**
   * Interactions
   */
  get interactions(): APIMessage["interactions"] {
    return this.#collection.getUnderlyingObject(this.id).interactions;
  }

  /**
   * Masquerade
   */
  get masquerade(): Masquerade | undefined {
    return this.#collection.getUnderlyingObject(this.id).masquerade;
  }

  /**
   * Whether this message is pinned
   */
  get pinned(): boolean {
    return this.#collection.getUnderlyingObject(this.id).pinned || false;
  }

  /**
   * Flags
   */
  get flags(): number {
    return this.#collection.getUnderlyingObject(this.id).flags || 0;
  }

  /**
   * "used /cmd" context when this message is a bot's response to a slash
   * command (server-stamped, never client-sent)
   */
  get commandContext(): MessageInteractionData | undefined {
    return this.#collection.getUnderlyingObject(this.id).commandContext;
  }

  /**
   * Whether this message is an authentic bot response to a slash command
   * (the Interaction flag is a bit position only settable server-side)
   */
  get isInteractionResponse(): boolean {
    return messageFlagAtPosition(this.flags, MessageFlags.Interaction);
  }

  /**
   * Interactive components attached to this message (buttons / selects);
   * only ever present on bot messages
   */
  get components(): ActionRowData[] | undefined {
    return this.#collection.getUnderlyingObject(this.id).components;
  }

  /**
   * Whether this is an ephemeral interaction response — visible only to
   * this user and never persisted (gone on reload)
   */
  get isEphemeral(): boolean {
    return this.#collection.getUnderlyingObject(this.id).ephemeral ?? false;
  }

  /**
   * Dismiss an ephemeral message. It has no server-side existence, so this
   * is purely a local removal (emits `messageDelete` so lists drop it);
   * no-op for regular messages.
   */
  dismiss(): void {
    if (!this.isEphemeral) return;
    const message = this.#collection.getUnderlyingObject(this.id);
    this.#collection.client.emit("messageDelete", message);
    this.#collection.delete(this.id);
  }

  /**
   * Immutable poll definition when this message carries a poll
   * (server-stamped by the poll create route — unforgeable, the regular
   * send path has no poll field and rejects the Poll flag bit)
   */
  get poll(): PollDefinitionData | undefined {
    return this.#collection.getUnderlyingObject(this.id).poll;
  }

  /**
   * Whether this message carries a poll
   */
  get isPoll(): boolean {
    return this.poll !== undefined;
  }

  /**
   * Dynamic poll state (counts / closed / own ballot), if hydrated.
   * Populated by {@link fetchPoll}, vote calls and the
   * `PollVoteUpdate` / `PollClose` events.
   */
  get pollState(): PollState | undefined {
    return this.#collection.getUnderlyingObject(this.id).pollState;
  }

  /**
   * Stamp new dynamic poll state onto the message (merging over what is
   * already known so a count-only WS update never erases `myVotes`).
   */
  #mergePollState(next: Partial<PollState> & { hydrated?: boolean }): void {
    const current = this.pollState;
    this.#collection.updateUnderlyingObject(this.id, "pollState", {
      closed: false,
      hydrated: false,
      ...current,
      ...next,
    });
  }

  /**
   * Apply wire poll state onto this message (used by the client's bulk
   * hydration — one `POST …/polls/fetch` per page of messages).
   */
  applyPollState(data: PollData): void {
    this.#mergePollState(pollStateFromWire(data));
  }

  /**
   * Fetch this message's poll state from the API. Counts arrive only when
   * the server allows this user to see them (voted / author / moderator /
   * closed) — hidden-until-vote is enforced server-side.
   */
  async fetchPoll(): Promise<PollState | undefined> {
    const poll = this.poll;
    if (!poll) return undefined;

    const data = (await this.#collection.client.channels.apiReq(
      "GET",
      `/channels/${this.channelId}/polls/${poll.id}`,
    )) as PollData;

    this.#mergePollState(pollStateFromWire(data));
    return this.pollState;
  }

  /**
   * Cast (or replace) this user's ballot on the poll.
   * @param answerIds Selected answer ids (exactly one unless multi-select)
   */
  async votePoll(answerIds: number[]): Promise<void> {
    const poll = this.poll;
    if (!poll) return;

    const data = (await this.#collection.client.channels.apiReq(
      "PUT",
      `/channels/${this.channelId}/polls/${poll.id}/vote`,
      { body: { answer_ids: answerIds } },
    )) as PollData;

    this.#mergePollState(pollStateFromWire(data));
  }

  /**
   * Retract this user's ballot from the poll.
   */
  async removePollVote(): Promise<void> {
    const poll = this.poll;
    if (!poll) return;

    const data = (await this.#collection.client.channels.apiReq(
      "DELETE",
      `/channels/${this.channelId}/polls/${poll.id}/vote`,
    )) as PollData;

    // The wire response reflects the retraction (counts may now be hidden
    // again for this user); myVotes must be cleared explicitly since the
    // merge otherwise preserves it.
    this.#mergePollState({ ...pollStateFromWire(data), myVotes: undefined });
  }

  /**
   * Close the poll now and publish final results. Author or ManageMessages
   * only.
   */
  async endPoll(): Promise<void> {
    const poll = this.poll;
    if (!poll) return;

    const data = (await this.#collection.client.channels.apiReq(
      "POST",
      `/channels/${this.channelId}/polls/${poll.id}/end`,
    )) as PollData;

    this.#mergePollState(pollStateFromWire(data));
  }

  /**
   * List the users who voted for a given answer. Author or ManageMessages
   * only — ballots are never exposed to regular voters.
   */
  async fetchPollVoters(
    answerId: number,
    options?: { after?: string; limit?: number },
  ): Promise<User[]> {
    const poll = this.poll;
    if (!poll) return [];

    const response = (await this.#collection.client.channels.apiReq(
      "GET",
      `/channels/${this.channelId}/polls/${poll.id}/voters`,
      {
        query: {
          answer_id: answerId,
          after: options?.after,
          limit: options?.limit,
        },
      },
    )) as { users: { _id: string }[] };

    return response.users.map((user) =>
      this.#collection.client.users.getOrCreate(
        user._id,
        user as never,
      ),
    );
  }

  /**
   * Immutable soft-reserve sheet definition when this message carries one
   * (server-stamped by the softres create route — unforgeable, the
   * regular send path has no softres field and rejects the flag bit).
   * Creation-time snapshot for cold render only: settings edits leave it
   * stale by design, so prefer {@link softresState}'s `definition` once
   * hydrated.
   */
  get softres(): SoftResDefinitionData | undefined {
    return this.#collection.getUnderlyingObject(this.id).softres;
  }

  /**
   * Whether this message carries a soft-reserve sheet
   */
  get isSoftRes(): boolean {
    return this.softres !== undefined;
  }

  /**
   * Dynamic soft-reserve state (reserves / counts / lock), if hydrated.
   * Populated by {@link fetchSoftRes}, the reserve/manage calls and the
   * `SoftresReserveUpdate` / `SoftresSheetUpdate` events.
   */
  get softresState(): SoftResState | undefined {
    return this.#collection.getUnderlyingObject(this.id).softresState;
  }

  /**
   * Stamp new dynamic soft-reserve state onto the message (merging over
   * what is already known so a partial WS update never erases the rest).
   */
  #mergeSoftresState(next: Partial<SoftResState>): void {
    const current = this.softresState;
    this.#collection.updateUnderlyingObject(this.id, "softresState", {
      locked: false,
      totalReserves: 0,
      hydrated: false,
      ...current,
      ...next,
    });
  }

  /**
   * Apply a full wire sheet model onto this message (used by the client's
   * bulk hydration — one `POST …/softres/fetch` per page of messages —
   * and by every route response). Authoritative: hidden-gated fields the
   * server withheld are cleared rather than kept stale.
   */
  applySoftresState(data: SoftResData): void {
    this.#mergeSoftresState(softresStateFromWire(data));
  }

  /**
   * Fetch this sheet's dynamic state from the API. Reserve rows and
   * per-item counts arrive only when the server allows this user to see
   * them (sheet not hidden / creator / moderator) — the caller's own row
   * always arrives.
   */
  async fetchSoftRes(): Promise<SoftResState | undefined> {
    const softres = this.softres;
    if (!softres) return undefined;

    const data = (await this.#collection.client.channels.apiReq(
      "GET",
      `/channels/${this.channelId}/softres/${softres.id}`,
    )) as SoftResData;

    this.applySoftresState(data);
    return this.softresState;
  }

  /**
   * Set (or replace) this user's reservation row on the sheet.
   * Rejects with `SoftResLocked` when the sheet locked meanwhile, and
   * `SoftResItemCapReached` when a per-item cap filled first — callers
   * should surface the error and refetch.
   */
  async reserveSoftRes(data: DataSoftResReserve): Promise<void> {
    const softres = this.softres;
    if (!softres) return;

    const state = (await this.#collection.client.channels.apiReq(
      "PUT",
      `/channels/${this.channelId}/softres/${softres.id}/reserve`,
      { body: data },
    )) as SoftResData;

    this.applySoftresState(state);
  }

  /**
   * Retract this user's reservation row from the sheet.
   */
  async retractSoftRes(): Promise<void> {
    const softres = this.softres;
    if (!softres) return;

    const state = (await this.#collection.client.channels.apiReq(
      "DELETE",
      `/channels/${this.channelId}/softres/${softres.id}/reserve`,
    )) as SoftResData;

    // The response reflects the retraction (`my_reserve` absent);
    // applying the full model clears `myReserve` since every key is set
    // explicitly by softresStateFromWire.
    this.applySoftresState(state);
  }

  /**
   * Edit the sheet's settings. Creator or ManageMessages only. Raids are
   * immutable post-create. The message-embedded definition stays stale by
   * design — the response (and the `SoftresSheetUpdate` fan-out) carries
   * the fresh copy on `definition`.
   */
  async editSoftRes(data: DataSoftResEdit): Promise<void> {
    const softres = this.softres;
    if (!softres) return;

    const state = (await this.#collection.client.channels.apiReq(
      "PATCH",
      `/channels/${this.channelId}/softres/${softres.id}`,
      { body: data },
    )) as SoftResData;

    this.applySoftresState(state);
  }

  /**
   * Lock (`true`) or unlock (`false`) the sheet. Creator or
   * ManageMessages only. Unlocking also clears the `locks_at` auto-lock
   * snapshot server-side (re-arm via {@link editSoftRes} with
   * `lock_at_event_start: true`).
   */
  async lockSoftRes(locked: boolean): Promise<void> {
    const softres = this.softres;
    if (!softres) return;

    const state = (await this.#collection.client.channels.apiReq(
      locked ? "POST" : "DELETE",
      `/channels/${this.channelId}/softres/${softres.id}/lock`,
    )) as SoftResData;

    this.applySoftresState(state);
  }

  /**
   * Render an addon-importable export of the sheet's FULL reserve data.
   * Creator or ManageMessages only — the export ignores `hidden` by
   * design.
   */
  async exportSoftRes(
    format: SoftResExportFormat,
  ): Promise<SoftResExportResponseData | undefined> {
    const softres = this.softres;
    if (!softres) return undefined;

    return (await this.#collection.client.channels.apiReq(
      "GET",
      `/channels/${this.channelId}/softres/${softres.id}/export`,
      { query: { format } },
    )) as SoftResExportResponseData;
  }

  /**
   * Immutable forwarded-message snapshot when this message is a forward
   * (server-stamped by the forward route, which verified the forwarder
   * could read the source — unforgeable, the regular send/edit paths have
   * no such field). Snapshot semantics: edits or deletion of the original
   * do not propagate.
   */
  get forwarded(): HydratedForwardedSnapshot | undefined {
    return this.#collection.getUnderlyingObject(this.id).forwarded;
  }

  /**
   * Whether this message forwards another message
   */
  get isForwarded(): boolean {
    return this.forwarded !== undefined;
  }

  /**
   * Whether this (origin) message has been published from an announcement
   * channel (the Crossposted flag is a server-only bit position).
   */
  get isCrossposted(): boolean {
    return messageFlagAtPosition(this.flags, MessageFlags.Crossposted);
  }

  /**
   * Whether this message is a delivered crosspost copy (the IsCrosspost flag
   * is a server-only bit position; pairs with {@link crosspost}).
   */
  get isCrosspost(): boolean {
    return messageFlagAtPosition(this.flags, MessageFlags.IsCrosspost);
  }

  /**
   * Server-set origin attribution on a delivered crosspost copy (points at
   * the origin announcement message / channel / server). Unforgeable — never
   * client-settable.
   */
  get crosspost(): CrosspostInfoData | undefined {
    return this.#collection.getUnderlyingObject(this.id).crosspost;
  }

  /**
   * Publish (crosspost) this message from its announcement channel into every
   * follower channel. Requires `SendMessage` (+ `ManageMessages` for others'
   * messages). The `Crossposted` flag flips via the resulting MessageUpdate.
   */
  async publish(): Promise<void> {
    await this.channel?.crosspostMessage(this.id);
  }

  /**
   * Forward this message to another channel. The server copies an
   * immutable snapshot (content + attachments) and verifies this user can
   * both read the source and send in the destination.
   * @param destination Channel (or channel id) to forward to
   * @returns The newly-created forward message
   */
  async forwardTo(
    destination: string | Channel,
    idempotencyKey: string = ulid(),
  ): Promise<Message> {
    const destinationId =
      typeof destination === "string" ? destination : destination.id;

    const message = (await this.#collection.client.channels.apiReq(
      "POST",
      `/channels/${this.channelId}/messages/${this.id}/forward`,
      { body: { destination: destinationId, nonce: idempotencyKey } },
    )) as { _id: string };

    return this.#collection.client.messages.getOrCreate(
      message._id,
      message as never,
    );
  }

  /**
   * Get the username for this message
   */
  get username(): string | undefined {
    const webhook = this.webhook;

    return (
      this.masquerade?.name ??
      (webhook
        ? webhook.name
        : (this.member?.nickname ?? this.author?.username))
    );
  }

  /**
   * Get the role colour for this message
   */
  get roleColour(): string | null | undefined {
    return this.masquerade?.colour ?? this.member?.roleColour;
  }

  /**
   * Get the role colour for this message
   */
  get iconRole(): ServerRole | null | undefined {
    return this.member?.iconRole;
  }

  /**
   * Get the avatar URL for this message
   */
  get avatarURL(): string | undefined {
    const webhook = this.webhook;

    return (
      this.masqueradeAvatarURL ??
      (webhook
        ? webhook.avatarURL
        : (this.member?.avatarURL ?? this.author?.avatarURL))
    );
  }

  /**
   * Get the animated avatar URL for this message
   */
  get animatedAvatarURL(): string | undefined {
    const webhook = this.webhook;

    return (
      this.masqueradeAvatarURL ??
      (webhook
        ? webhook.avatarURL
        : this.member
          ? this.member?.animatedAvatarURL
          : this.author?.animatedAvatarURL)
    );
  }

  /**
   * Avatar URL from the masquerade
   */
  get masqueradeAvatarURL(): string | undefined {
    const avatar = this.masquerade?.avatar;
    return avatar ? this.#collection.client.proxyFile(avatar) : undefined;
  }

  /**
   * Whether this message has suppressed desktop/push notifications
   */
  get isSuppressed(): boolean {
    return (this.flags & 1) === 1;
  }

  /**
   * Edit a message
   * @param data Message edit route data
   */
  async edit(data: DataEditMessage): Promise<APIMessage> {
    return await this.#collection.client.api.patch(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}`,
      data,
    );
  }

  /**
   * Delete a message
   */
  async delete(): Promise<void> {
    return await this.#collection.client.api.delete(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}`,
    );
  }

  /**
   * Acknowledge this message as read
   * @param skipRateLimiter Whether to skip the internal rate limiter
   * @param skipRequest For internal updates only
   * @param skipNextMarking For internal usage only
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   */
  ack(
    skipRateLimiter?: boolean,
    skipRequest?: boolean,
    skipNextMarking?: boolean,
  ): void {
    // Ephemeral messages have no server-side existence; acking their ULID
    // would move the server unread pointer past real messages (an
    // ephemeral id is minted at respond time, so it sorts after every
    // persisted message in the channel).
    if (this.isEphemeral) return;
    this.channel?.ack(this, skipRateLimiter, skipRequest, skipNextMarking);
  }

  /**
   * Reply to Message
   */
  reply(
    data:
      | string
      | (Omit<DataMessageSend, "nonce"> & {
          nonce?: string;
        }),
    mention = true,
  ): Promise<Message> | undefined {
    const obj = typeof data === "string" ? { content: data } : data;
    return this.channel?.sendMessage({
      ...obj,
      replies: [{ id: this.id, mention }],
    });
  }

  /**
   * Clear all reactions from this message
   */
  async clearReactions(): Promise<void> {
    return await this.#collection.client.api.delete(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}/reactions`,
    );
  }

  /**
   * React to a message
   * @param emoji Unicode or emoji ID
   */
  async react(emoji: string): Promise<void> {
    return await this.#collection.client.api.put(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}/reactions/${
        emoji as ""
      }`,
    );
  }

  /**
   * Un-react from a message
   * @param emoji Unicode or emoji ID
   * @param deleteAll Remove all reactions
   */
  async unreact(emoji: string, deleteAll = false): Promise<void> {
    return await this.#collection.client.api.delete(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}/reactions/${
        emoji as ""
      }`,
      { remove_all: deleteAll },
    );
  }

  /**
   * Pin the message
   */
  pin(): Promise<void> {
    return this.#collection.client.api.post(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}/pin`,
    );
  }

  /**
   * Unpin the message
   */
  unpin(): Promise<void> {
    return this.#collection.client.api.delete(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}/pin`,
    );
  }
}

/**
 * Message Webhook Class
 */
export class MessageWebhook {
  #client: Client;

  readonly id: string;
  readonly name: string;
  readonly avatar?: File;

  /**
   * Construct Message Webhook
   * @param client Client
   * @param webhook Webhook data
   */
  constructor(client: Client, webhook: APIMessageWebhook, id: string) {
    this.#client = client;
    this.id = id;
    this.name = webhook.name;
    this.avatar = webhook.avatar
      ? new File(client, {
          _id: webhook.avatar,
          tag: "avatars",
          metadata: {
            type: "Image",
            width: 256,
            height: 256,
          },
        })
      : undefined;
  }

  /**
   * Get the avatar URL for this message webhook
   */
  get avatarURL(): string {
    return (
      this.avatar?.createFileURL() ??
      `${this.#client.options.baseURL}/users/${this.id}/default_avatar?v=2`
    );
  }
}
