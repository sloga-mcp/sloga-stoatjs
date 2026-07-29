import type { Setter } from "solid-js";
import { batch } from "solid-js";

import { ReactiveSet } from "@solid-primitives/set";
import type {
  Channel,
  ChannelUnread,
  Emoji,
  Error,
  FieldsChannel,
  FieldsMember,
  FieldsServer,
  FieldsUser,
  Member,
  MemberCompositeKey,
  Message,
  RelationshipStatus,
  Role,
  Server,
  User,
} from "stoat-api";

import type { Client } from "../Client.js";
import type { EventData, EventRsvpData } from "../classes/CalendarEvent.js";
import type { ChannelFollowData } from "../classes/ChannelFollow.js";
import type { E2EEClientMessage, E2EEServerEvent } from "../classes/E2EE.js";
import type { InteractionCreateEvent } from "../classes/Interaction.js";
import { MessageEmbed } from "../classes/MessageEmbed.js";
import type { PollAnswerCountData } from "../classes/Poll.js";
import {
  softresStateFromWire,
  type SoftResData,
  type SoftResReserveData,
} from "../classes/SoftRes.js";
import type { ScheduledMessageData } from "../classes/ScheduledMessage.js";
import { ServerRole } from "../classes/ServerRole.js";
import type { ThreadChannelData } from "../classes/Thread.js";
import { VoiceParticipant } from "../classes/VoiceParticipant.js";
import { hydrate } from "../hydration/index.js";

/**
 * Version 1 of the events protocol
 */
export type ProtocolV1 = {
  client: ClientMessage;
  server: ServerMessage;

  types: {
    policyChange: PolicyChange;
  };
};

/**
 * Messages sent to the server
 */
type ClientMessage =
  | { type: "Authenticate"; token: string }
  | {
      type: "BeginTyping";
      channel: string;
    }
  | {
      type: "EndTyping";
      channel: string;
    }
  | {
      type: "Ping";
      data: number;
    }
  | {
      type: "Pong";
      data: number;
    }
  | E2EEClientMessage;

/**
 * Messages sent from the server
 */
type ServerMessage =
  | { type: "Error"; data: Error }
  | { type: "Bulk"; v: ServerMessage[] }
  | { type: "Authenticated" }
  | ({ type: "Ready" } & Partial<ReadyData>)
  | { type: "Ping"; data: number }
  | { type: "Pong"; data: number }
  | ({ type: "Message" } & Message)
  | {
      type: "MessageUpdate";
      id: string;
      channel: string;
      data: Partial<Message>;
      /** Fields removed by this update (`FieldsMessage`). */
      clear?: ("Pinned" | "Components")[];
    }
  | {
      type: "MessageAppend";
      id: string;
      channel: string;
      append: Pick<Partial<Message>, "embeds">;
    }
  | { type: "MessageDelete"; id: string; channel: string }
  | {
      type: "MessageReact";
      id: string;
      channel_id: string;
      user_id: string;
      emoji_id: string;
    }
  | {
      type: "MessageUnreact";
      id: string;
      channel_id: string;
      user_id: string;
      emoji_id: string;
    }
  | {
      type: "MessageRemoveReaction";
      id: string;
      channel_id: string;
      emoji_id: string;
    }
  | { type: "BulkMessageDelete"; channel: string; ids: string[] }
  | ({ type: "ChannelCreate" } & (Channel | ThreadChannelData))
  | {
      type: "ChannelUpdate";
      id: string;
      data: Partial<Channel>;
      clear?: FieldsChannel[];
    }
  | { type: "ChannelDelete"; id: string }
  | { type: "ChannelGroupJoin"; id: string; user: string }
  | { type: "ChannelGroupLeave"; id: string; user: string }
  | { type: "ChannelStartTyping"; id: string; user: string }
  | { type: "ChannelStopTyping"; id: string; user: string }
  | { type: "ChannelAck"; id: string; user: string; message_id: string }
  | { type: "ThreadMemberJoin"; id: string; user: string }
  | { type: "ThreadMemberLeave"; id: string; user: string }
  | {
      type: "ServerCreate";
      id: string;
      server: Server;
      channels: Channel[];
    }
  | {
      type: "ServerUpdate";
      id: string;
      data: Partial<Server>;
      clear?: FieldsServer[];
    }
  | { type: "ServerDelete"; id: string }
  | {
      type: "ServerMemberUpdate";
      id: MemberCompositeKey;
      data: Partial<Member>;
      clear?: FieldsMember[];
    }
  | { type: "ServerMemberJoin"; id: string; user: string }
  | { type: "ServerMemberLeave"; id: string; user: string }
  | {
      type: "ServerRoleUpdate";
      id: string;
      role_id: string;
      data: Partial<Role>;
    }
  | { type: "ServerRoleDelete"; id: string; role_id: string }
  | {
      type: "UserUpdate";
      id: string;
      data: Partial<User>;
      clear?: FieldsUser[];
    }
  | { type: "UserRelationship"; user: User; status: RelationshipStatus }
  | { type: "UserPresence"; id: string; online: boolean }
  | {
      type: "UserSettingsUpdate";
      id: string;
      update: { [key: string]: [number, string] };
    }
  | { type: "UserPlatformWipe"; user_id: string; flags: number }
  | ({ type: "EmojiCreate" } & Emoji)
  | { type: "EmojiDelete"; id: string }
  | ({
      type: "Auth";
    } & (
      | {
          event_type: "DeleteSession";
          user_id: string;
          session_id: string;
        }
      | {
          event_type: "DeleteAllSessions";
          user_id: string;
          exclude_session_id: string;
        }
    ))
  | {
      type: "VoiceChannelJoin";
      id: string;
      state: UserVoiceState;
    }
  | {
      type: "VoiceChannelLeave";
      id: string;
      user: string;
    }
  | {
      type: "VoiceChannelMove";
      user: string;
      from: string;
      to: string;
      state: UserVoiceState;
    }
  | {
      type: "UserVoiceStateUpdate";
      id: string;
      channel_id: string;
      data: Partial<UserVoiceState>;
    }
  | {
      type: "UserMoveVoiceChannel";
      node: string;
      token: string;
    }
  | {
      /**
       * A sharer offered remote control of their machine to this user.
       * PRIVATE topic — the target only. Ships dark behind the server's
       * `remote_control` feature flag.
       *
       * The two byte fields are opaque base64 carried for the slice-3 key
       * agreement; nothing in this library interprets them.
       */
      type: "RemoteControlOffered";
      channel_id: string;
      offer_id: string;
      sharer_id: string;
      target_id: string;
      sharer_ephemeral_pub: string;
      rc_session_id: string;
    }
  | {
      /** A control offer was declined. PRIVATE topic — the sharer only. */
      type: "RemoteControlDeclined";
      channel_id: string;
      offer_id: string;
      sharer_id: string;
      target_id: string;
    }
  | {
      /**
       * A control offer was accepted and the grant is live. PRIVATE topic —
       * the SHARER only: this is the return path of the key exchange and
       * carries the controller's ephemeral public key.
       */
      type: "RemoteControlAccepted";
      channel_id: string;
      offer_id: string;
      grant_id: string;
      sharer_id: string;
      controller_id: string;
      controller_ephemeral_pub: string;
    }
  | {
      /**
       * Redacted channel-topic visibility event: a control session is
       * active in this channel, and between whom. Carries no grant id and
       * nothing actionable. Keyed by (channel_id, sharer_id).
       */
      type: "RemoteControlActive";
      channel_id: string;
      sharer_id: string;
      controller_id: string;
    }
  | {
      /**
       * A control session ended. Channel topic, keyed like
       * `RemoteControlActive` so the indicator clears on (channel_id,
       * sharer_id).
       */
      type: "RemoteControlEnded";
      channel_id: string;
      sharer_id: string;
      reason: string;
    }
  | {
      type: "UserSlowmodes";
      slowmodes: UserSlowmodes[];
    }
  | {
      type: "ReportCreate";
      _id: string;
      author_id: string;
      content: {
        type: "Message" | "Server" | "User";
        id: string;
        report_reason: string;
      };
      additional_context: string;
      status: string;
    }
  | { type: "CalendarEventCreate"; event: EventData }
  | { type: "CalendarEventUpdate"; event: EventData }
  | { type: "CalendarEventInvite"; event: EventData }
  | { type: "CalendarEventRsvp"; rsvp: EventRsvpData }
  | { type: "InteractionCreate"; interaction: InteractionCreateEvent }
  | { type: "InteractionEphemeralMessage"; message: Message }
  | {
      type: "PollVoteUpdate";
      id: string;
      channel_id: string;
      message_id: string;
      counts: PollAnswerCountData[];
      total_votes: number;
    }
  | {
      type: "PollClose";
      id: string;
      channel_id: string;
      message_id: string;
      counts: PollAnswerCountData[];
      total_votes: number;
    }
  | {
      type: "SoftresReserveUpdate";
      id: string;
      channel_id: string;
      message_id: string;
      total_reserves: number;
      /**
       * New counts for the CHANGED items only (a delta, not the full
       * map); an item retracted to zero arrives as an explicit 0. Absent
       * on hidden sheets.
       */
      changed_item_counts?: Record<string, number>;
      /** The set/replaced row. Absent on hidden sheets and on retract. */
      reserve?: SoftResReserveData;
      /** The retracting user's id. Absent on hidden sheets and on set. */
      removed_user?: string;
    }
  | {
      type: "SoftresSheetUpdate";
      id: string;
      channel_id: string;
      message_id: string;
      /**
       * The PUBLIC-gated model (no viewer: `my_reserve` never populated;
       * reserves / item_counts absent when hidden, even for the leader,
       * who refetches over REST).
       */
      sheet: SoftResData;
    }
  | {
      type: "SoundboardSound";
      id: string;
      channel_id: string;
      server_id: string;
      emoji?: string;
    }
  | { type: "MessageScheduled"; message: ScheduledMessageData }
  | { type: "MessageScheduleCancelled"; id: string; channel: string }
  | {
      type: "ScheduledMessageFailed";
      id: string;
      channel: string;
      reason: string;
    }
  | { type: "ChannelFollowCreate"; follow: ChannelFollowData }
  | {
      type: "ChannelFollowDelete";
      id: string;
      source_channel: string;
      target_channel: string;
    }
  | { type: "ChannelFollowersUpdate"; channel: string }
  | {
      type: "DiscordImportProgress";
      job_id: string;
      /** Opaque server stage string — later slices add values */
      stage: string;
      done: number;
      /** May legitimately be 0 while the stage is indeterminate */
      total: number;
    }
  | {
      type: "DiscordImportComplete";
      job_id: string;
      server_id: string;
      invite_code: string;
    }
  | { type: "DiscordImportFailed"; job_id: string; error: string }
  | E2EEServerEvent;

/**
 * Policy change type
 */
type PolicyChange = {
  created_time: string;
  effective_time: string;
  description: string;
  url: string;
};

/**
 * Voice state for a user
 */
export type UserVoiceState = {
  id: string;
  joined_at: number;
  is_receiving: boolean;
  is_publishing: boolean;
  /**
   * True while EITHER a screen-video or screen-audio track is live — the two
   * are conflated, so this can read true with no video published at all.
   * Anything that needs "screen video is actually live" must use
   * `screen_video` instead.
   */
  screensharing: boolean;
  camera: boolean;
  /**
   * True only while a screen VIDEO track is live. Additive field — absent
   * from payloads sent by older servers, so treat missing as false.
   */
  screen_video?: boolean;
  /**
   * True while this participant has told the server they are recording the
   * call locally. Additive field — treat missing as false.
   *
   * A SELF-REPORT, unlike every other flag here: the recording runs in the
   * participant's own client and neither the SFU nor the API can observe it,
   * so false means "nobody said they are recording", not "nobody is". It
   * rides on voice state precisely so a late joiner sees an in-progress
   * recording in the roster they read on join.
   */
  recording?: boolean;
};

/**
 * Voice state for a channel
 */
type ChannelVoiceState = {
  id: string;
  participants: UserVoiceState[];
};

/**
 * Channel slowmodes for the active user
 */
export type UserSlowmodes = {
  channel_id: string;
  duration: number;
  retry_after: number;
  receivedAt?: number;
};

/**
 * Initial synchronisation packet
 */
type ReadyData = {
  users: User[];
  servers: Server[];
  channels: (Channel | ThreadChannelData)[];
  members: Member[];
  emojis: Emoji[];
  voice_states: ChannelVoiceState[];

  user_settings: Record<string, unknown>;
  channel_unreads: ChannelUnread[];

  policy_changes: PolicyChange[];
};

/**
 * Handle an event for the Client
 * @param client Client
 * @param event Event
 * @param setReady Signal state change
 */
export async function handleEvent(
  client: Client,
  event: ServerMessage,
  setReady: Setter<boolean>,
): Promise<void> {
  if (client.options.debug) {
    console.debug("[S->C]", event);
  }

  switch (event.type) {
    case "Bulk": {
      for (const item of event.v) {
        handleEvent(client, item, setReady);
      }
      break;
    }
    case "Ready": {
      batch(() => {
        if (event.users) {
          for (const user of event.users) {
            const u = client.users.getOrCreate(user._id, user);

            if (u.relationship === "User") {
              client.user = u;
            }
          }
        }

        if (event.servers) {
          for (const server of event.servers) {
            client.servers.getOrCreate(server._id, server);
          }
        }

        if (event.members) {
          for (const member of event.members) {
            client.serverMembers.getOrCreate(member._id, member);
          }
        }

        if (event.channels) {
          for (const channel of event.channels) {
            const instance = client.channels.getOrCreate(channel._id, channel);
            // Ready only ever includes threads the user has JOINED, so seed
            // self-membership — the wire shape carries no membership list.
            if (instance.isThread && client.user) {
              instance.threadMembers.add(client.user.id);
            }
          }
        }

        if (event.voice_states) {
          for (const state of event.voice_states) {
            const channel = client.channels.get(state.id);
            if (channel) {
              channel.voiceParticipants.clear();

              for (const participant of state.participants) {
                channel.voiceParticipants.set(
                  participant.id,
                  new VoiceParticipant(client, participant),
                );
              }
            }
          }
        }
        if (event.emojis) {
          for (const emoji of event.emojis) {
            client.emojis.getOrCreate(emoji._id, emoji);
          }
        }
      });

      if (client.options.syncUnreads) {
        await client.channelUnreads.sync();
      }

      setReady(true);
      client.emit("ready");

      if (event.policy_changes?.length) {
        client.emit("policyChanges", event.policy_changes, async () =>
          client.api.post("/policy/acknowledge"),
        );
      }

      break;
    }
    case "Message": {
      if (!client.messages.has(event._id)) {
        batch(() => {
          if (event.member) {
            client.serverMembers.getOrCreate(event.member._id, event.member);
          }

          if (event.user) {
            client.users.getOrCreate(event.user._id, event.user);
          }

          delete event.member;
          delete event.user;

          client.messages.getOrCreate(event._id, event, true);

          // A delivered scheduled message arrives as a normal Message
          // whose nonce is the pending row's id (stamped by the delivery
          // daemon) — reconcile the author's pending queue so the bar
          // never offers a cancel for something already sent.
          if (event.nonce && client.scheduledMessages.has(event.nonce)) {
            client.scheduledMessages.delete(event.nonce);
          }

          const channel = client.channels.get(event.channel);
          if (!channel) return;

          client.channels.updateUnderlyingObject(
            channel.id,
            "lastMessageId",
            event._id,
          );

          if (
            event.mentions?.includes(client.user!.id) &&
            client.options.syncUnreads
          ) {
            const unread = client.channelUnreads.for(channel);
            unread.messageMentionIds.add(event._id);
            client.channels.updateUnderlyingObject(
              event.channel,
              "lastMessageId",
              event._id,
            );
          }
        });
      }
      break;
    }
    case "MessageUpdate": {
      const message = client.messages.getOrPartial(event.id);
      if (message) {
        const previousMessage = {
          ...client.messages.getUnderlyingObject(event.id),
          channelId: event.channel,
        };

        client.messages.updateUnderlyingObject(event.id, {
          ...hydrate(
            "message",
            { ...event.data, channel: event.channel },
            client,
            false,
          ),
          editedAt: new Date(),
        });

        // Apply cleared fields (e.g. a component edit-response retiring
        // its rows sends clear: ["Components"])
        for (const field of event.clear ?? []) {
          if (field === "Components") {
            client.messages.updateUnderlyingObject(
              event.id,
              "components",
              undefined,
            );
          } else if (field === "Pinned") {
            client.messages.updateUnderlyingObject(event.id, "pinned", false);
          }
        }

        client.emit("messageUpdate", message, previousMessage);
      }
      break;
    }
    case "MessageAppend": {
      const message = client.messages.getOrPartial(event.id);
      if (message) {
        const previousMessage = {
          ...client.messages.getUnderlyingObject(event.id),
          channelId: event.channel,
        };

        client.messages.updateUnderlyingObject(event.id, "embeds", (embeds) => [
          ...(embeds ?? []),
          ...(event.append.embeds?.map((embed) =>
            MessageEmbed.from(client, embed),
          ) ?? []),
        ]);

        client.messages.updateUnderlyingObject(
          event.id,
          "channelId",
          event.channel,
        );

        client.emit("messageUpdate", message, previousMessage);
      }
      break;
    }
    case "MessageDelete": {
      if (client.messages.getOrPartial(event.id)) {
        const message = client.messages.getUnderlyingObject(event.id);
        client.emit("messageDelete", message);
        client.messages.delete(event.id);
      }
      break;
    }
    case "BulkMessageDelete": {
      batch(() =>
        client.emit(
          "messageDeleteBulk",
          event.ids
            .map((id) => {
              if (client.messages.has(id)) {
                const message = client.messages.getUnderlyingObject(id);
                client.messages.delete(id);
                return message!;
              }

              return undefined!;
            })
            .filter((x) => x),
          client.channels.get(event.channel),
        ),
      );
      break;
    }
    case "MessageReact": {
      const message = client.messages.getOrPartial(event.id);
      if (message) {
        const reactions = message.reactions;
        const set = reactions.get(event.emoji_id)!;
        if (set) {
          if (set.has(event.user_id)) return;
          set.add(event.user_id);
        } else {
          reactions.set(event.emoji_id, new ReactiveSet([event.user_id]));
        }

        client.emit(
          "messageReactionAdd",
          message,
          event.user_id,
          event.emoji_id,
        );
      }
      break;
    }
    case "MessageUnreact": {
      const message = client.messages.getOrPartial(event.id);
      if (message) {
        const set = message.reactions.get(event.emoji_id);
        if (set?.has(event.user_id)) {
          if (
            set.size === 1 &&
            !message.interactions?.reactions?.includes(event.emoji_id)
          ) {
            message.reactions.delete(event.emoji_id);
          } else {
            set.delete(event.user_id);
          }
        } else if (!client.messages.isPartial(event.id)) {
          return;
        }

        client.emit(
          "messageReactionRemove",
          message,
          event.user_id,
          event.emoji_id,
        );
      }
      break;
    }
    case "MessageRemoveReaction": {
      const message = client.messages.getOrPartial(event.id);
      if (message) {
        const reactions = message.reactions;
        if (reactions.has(event.emoji_id)) {
          reactions.delete(event.emoji_id);
        } else if (!client.messages.isPartial(event.id)) {
          return;
        }

        client.emit("messageReactionRemoveEmoji", message, event.emoji_id);
      }
      break;
    }
    case "ChannelCreate": {
      if (!client.channels.has(event._id)) {
        const channel = client.channels.getOrCreate(event._id, event, true);
        if (channel.isThread) {
          client.emit("threadCreate", channel);
        }
      }
      break;
    }
    case "ChannelUpdate": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        const previousChannel = {
          ...client.channels.getUnderlyingObject(event.id),
        };

        const changes = hydrate("channel", event.data, client, false);

        if (event.clear) {
          for (const remove of event.clear) {
            // "Tags" is an additive FieldsChannel variant the generated
            // stoat-api union predates.
            switch (remove as string) {
              case "Description":
                changes["description"] = undefined;
                break;
              case "DefaultPermissions":
                changes["defaultPermissions"] = undefined;
                break;
              case "Icon":
                changes["icon"] = undefined;
                break;
              case "Tags":
                changes["tags"] = [];
                break;
            }
          }
        }

        client.channels.updateUnderlyingObject(event.id, changes);
        client.emit("channelUpdate", channel, previousChannel);
      }
      break;
    }
    case "ChannelDelete": {
      if (client.channels.getOrPartial(event.id)) {
        const channel = client.channels.getUnderlyingObject(event.id);
        client.emit("channelDelete", channel);
        client.channels.delete(event.id);
      }
      break;
    }
    case "ChannelGroupJoin": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        if (!channel.recipientIds.has(event.user)) {
          channel.recipientIds.add(event.user);
        } else if (!client.channels.isPartial(event.id)) {
          return;
        }

        client.emit(
          "channelGroupJoin",
          channel,
          await client.users.fetch(event.user),
        );
      }
      break;
    }
    case "ChannelGroupLeave": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        if (channel.recipientIds.has(event.user)) {
          channel.recipientIds.delete(event.user);
        } else if (!client.channels.isPartial(event.id)) {
          return;
        }

        client.emit(
          "channelGroupLeave",
          channel,
          client.users.getOrPartial(event.user)!,
        );
      }
      break;
    }
    case "ChannelStartTyping": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        if (!channel.typingIds.has(event.user)) {
          channel.typingIds.add(event.user);

          clearTimeout(channel._typingTimers[event.user]);
          channel._typingTimers[event.user] = setTimeout(
            () =>
              handleEvent(
                client,
                { ...event, type: "ChannelStopTyping" },
                setReady,
              ),
            4000,
          ) as never;

          client.emit(
            "channelStartTyping",
            channel,
            client.users.getOrPartial(event.user)!,
          );
        }
      }
      break;
    }
    case "ChannelStopTyping": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        if (channel.typingIds.has(event.user)) {
          channel.typingIds.delete(event.user);

          clearTimeout(channel._typingTimers[event.user]);
          delete channel._typingTimers[event.user];

          client.emit(
            "channelStopTyping",
            channel,
            client.users.getOrPartial(event.user)!,
          );
        }
      }
      break;
    }
    case "ChannelAck": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        client.emit("channelAcknowledged", channel, event.message_id);
      }
      break;
    }
    case "ThreadMemberJoin": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        if (!channel.threadMembers.has(event.user)) {
          channel.threadMembers.add(event.user);
        } else if (!client.channels.isPartial(event.id)) {
          return;
        }

        client.emit("threadMemberJoin", channel, event.user);
      }
      break;
    }
    case "ThreadMemberLeave": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        if (channel.threadMembers.has(event.user)) {
          channel.threadMembers.delete(event.user);
        } else if (!client.channels.isPartial(event.id)) {
          return;
        }

        client.emit("threadMemberLeave", channel, event.user);
      }
      break;
    }
    case "ServerCreate": {
      if (!client.servers.has(event.server._id)) {
        batch(() => {
          for (const channel of event.channels) {
            client.channels.getOrCreate(channel._id, channel);
          }

          client.servers.getOrCreate(event.server._id, event.server, true);
        });
      }
      break;
    }
    case "ServerUpdate": {
      const server = client.servers.getOrPartial(event.id);
      if (server) {
        const previousServer = {
          ...client.servers.getUnderlyingObject(event.id),
        };

        const changes = hydrate("server", event.data, client, false);

        if (event.clear) {
          for (const remove of event.clear) {
            switch (remove) {
              case "Banner":
                changes["banner"] = undefined;
                break;
              case "Categories":
                changes["categories"] = undefined;
                break;
              case "SystemMessages":
                changes["systemMessages"] = undefined;
                break;
              case "Description":
                changes["description"] = undefined;
                break;
              case "Icon":
                changes["icon"] = undefined;
                break;
            }
          }
        }

        client.servers.updateUnderlyingObject(event.id, changes);
        client.emit("serverUpdate", server, previousServer);
      }
      break;
    }
    case "ServerDelete": {
      const server = client.servers.getOrPartial(event.id);
      if (server) {
        // TODO: server should tell us if it's a leave or delete on our end
        server.$delete();
      }
      break;
    }
    case "ServerRoleUpdate": {
      const server = client.servers.getOrPartial(event.id);
      if (server) {
        const role = server.roles.get(event.role_id) ?? {};
        server.roles.set(
          event.role_id,
          new ServerRole(client, server.id, event.role_id, {
            ...role,
            ...event.data,
          } as never),
        );

        client.emit("serverRoleUpdate", server, event.role_id, role as never);
      }
      break;
    }
    case "ServerRoleDelete": {
      const server = client.servers.getOrPartial(event.id);
      if (server) {
        let role = {};
        const roles = server.roles;
        if (roles.has(event.role_id)) {
          role = roles.get(event.role_id) as never;
          roles.delete(event.role_id);
        } else if (!client.servers.isPartial(event.id)) {
          return;
        }

        client.emit("serverRoleDelete", server, event.role_id, role as never);
      }
      break;
    }
    case "ServerMemberJoin": {
      const id = {
        server: event.id,
        user: event.user,
      };

      if (!client.serverMembers.hasByKey(id)) {
        if (!client.users.has(id.user)) {
          if (client.options.eagerFetching) {
            await client.users.fetch(id.user);
          }
        }

        client.emit(
          "serverMemberJoin",
          client.serverMembers.getOrCreate(id, {
            _id: id,
            joined_at: new Date().toUTCString(),
          }),
        );
      }
      break;
    }
    case "ServerMemberUpdate": {
      const member = client.serverMembers.getOrPartial(event.id);
      if (member) {
        const previousMember = {
          ...client.serverMembers.getUnderlyingObject(
            event.id.server + event.id.user,
          ),
        };

        const changes = hydrate("serverMember", event.data, client, false);

        if (event.clear) {
          for (const remove of event.clear) {
            switch (remove) {
              case "Nickname":
                changes["nickname"] = undefined;
                break;
              case "Avatar":
                changes["avatar"] = undefined;
                break;
              case "Roles":
                changes["roles"] = [];
                break;
              case "Timeout":
                changes["timeout"] = undefined;
                break;
            }
          }
        }

        client.serverMembers.updateUnderlyingObject(
          event.id.server + event.id.user,
          changes as never,
        );

        client.emit("serverMemberUpdate", member, previousMember);
      }
      break;
    }
    case "ServerMemberLeave": {
      if (event.user && event.user === client.user!.id) {
        handleEvent(
          client,
          {
            type: "ServerDelete",
            id: event.id,
          },
          setReady,
        );

        return;
      }

      const id = {
        server: event.id,
        user: event.user,
      };

      if (client.serverMembers.getOrPartial(id)) {
        const member = client.serverMembers.getUnderlyingObject(
          id.server + id.user,
        );

        client.emit("serverMemberLeave", member);
        client.serverMembers.delete(id.server + id.user);
      }
      break;
    }
    case "UserUpdate": {
      const user = client.users.getOrPartial(event.id);
      if (user) {
        const previousUser = {
          ...client.users.getUnderlyingObject(event.id),
        };

        const changes = hydrate("user", event.data, client, false);

        if (event.clear) {
          for (const remove of event.clear) {
            // widened: stale upstream API types lack StatusActivity
            switch (remove as string) {
              case "Avatar":
                changes["avatar"] = undefined;
                break;
              case "StatusPresence":
                changes["status"] = {
                  ...(previousUser.status ?? {}),
                  ...(changes["status"] ?? {}),
                  presence: undefined,
                };
                break;
              case "StatusText":
                changes["status"] = {
                  ...(previousUser.status ?? {}),
                  ...(changes["status"] ?? {}),
                  text: undefined,
                };
                break;
              case "StatusActivity":
                changes["status"] = {
                  ...(previousUser.status ?? {}),
                  ...(changes["status"] ?? {}),
                  activity: undefined,
                };
                break;
              case "Connections":
                changes["connections"] = [];
                break;
            }
          }
        }

        client.users.updateUnderlyingObject(event.id, changes as never);
        client.emit("userUpdate", user, previousUser);
      }
      break;
    }
    case "UserRelationship": {
      if (
        client.users.has(event.user._id) &&
        !client.users.isPartial(event.user._id)
      ) {
        handleEvent(
          client,
          {
            type: "UserUpdate",
            id: event.user._id,
            data: {
              relationship: event.user.relationship!,
            },
          },
          setReady,
        );
      } else {
        // The event carries the full user; insert it so relationships with
        // users we haven't cached (e.g. a friend request from a stranger)
        // show up without a reload.
        client.users.getOrCreate(event.user._id, event.user);
      }
      break;
    }
    case "UserPresence": {
      handleEvent(
        client,
        {
          type: "UserUpdate",
          id: event.id,
          data: {
            online: event.online,
          },
        },
        setReady,
      );
      break;
    }
    case "UserSettingsUpdate": {
      client.emit("userSettingsUpdate", event.id, event.update);
      break;
    }
    case "UserPlatformWipe": {
      batch(() => {
        handleEvent(
          client,
          {
            type: "BulkMessageDelete",
            channel: "0",
            ids: client.messages
              .toList()
              .filter((message) => message.authorId === event.user_id)
              .map((message) => message.id),
          },
          setReady,
        );

        handleEvent(
          client,
          {
            type: "UserUpdate",
            id: event.user_id,
            data: {
              username: `Deleted User`,
              online: false,
              flags: event.flags,
              badges: 0,
              relationship: "None",
            },
            clear: ["Avatar", "StatusPresence", "StatusText"],
          },
          setReady,
        );
      });

      break;
    }
    case "EmojiCreate": {
      if (!client.emojis.has(event._id)) {
        client.emojis.getOrCreate(event._id, event, true);
      }
      break;
    }
    case "EmojiDelete": {
      if (client.emojis.getOrPartial(event.id)) {
        const emoji = client.emojis.getUnderlyingObject(event.id);
        client.emit("emojiDelete", emoji);
        client.emojis.delete(event.id);
      }
      break;
    }
    case "Auth": {
      // TODO: implement DeleteSession and DeleteAllSessions
      break;
    }
    case "VoiceChannelJoin": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        channel.voiceParticipants.set(
          event.state.id,
          new VoiceParticipant(client, event.state),
        );
        client.emit("voiceChannelJoin", channel, event.state.id);
      }
      break;
    }
    case "VoiceChannelLeave": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        channel.voiceParticipants.delete(event.user);
        client.emit("voiceChannelLeave", channel, event.user);
      }
      break;
    }
    case "VoiceChannelMove": {
      // todo
      break;
    }
    case "UserVoiceStateUpdate": {
      const channel = client.channels.getOrPartial(event.channel_id);
      if (channel) {
        channel.voiceParticipants.get(event.id)?.update(event.data);
        // todo: event
      }
      break;
    }
    case "UserMoveVoiceChannel": {
      // todo
      break;
    }
    case "RemoteControlOffered": {
      // Private to the target. Transient — the offer lives server-side
      // behind a short TTL, so nothing is cached here.
      client.emit("remoteControlOffered", {
        channelId: event.channel_id,
        offerId: event.offer_id,
        sharerId: event.sharer_id,
        targetId: event.target_id,
        sharerEphemeralPub: event.sharer_ephemeral_pub,
        rcSessionId: event.rc_session_id,
      });
      break;
    }
    case "RemoteControlDeclined": {
      client.emit("remoteControlDeclined", {
        channelId: event.channel_id,
        offerId: event.offer_id,
        sharerId: event.sharer_id,
        targetId: event.target_id,
      });
      break;
    }
    case "RemoteControlAccepted": {
      // Private to the sharer; carries the controller's ephemeral public
      // key, which stays opaque here — the native layer consumes it.
      client.emit("remoteControlAccepted", {
        channelId: event.channel_id,
        offerId: event.offer_id,
        grantId: event.grant_id,
        sharerId: event.sharer_id,
        controllerId: event.controller_id,
        controllerEphemeralPub: event.controller_ephemeral_pub,
      });
      break;
    }
    case "RemoteControlActive": {
      client.emit("remoteControlActive", {
        channelId: event.channel_id,
        sharerId: event.sharer_id,
        controllerId: event.controller_id,
      });
      break;
    }
    case "RemoteControlEnded": {
      client.emit("remoteControlEnded", {
        channelId: event.channel_id,
        sharerId: event.sharer_id,
        reason: event.reason,
      });
      break;
    }
    case "UserSlowmodes": {
      for (const slowmode of event.slowmodes) {
        client.setSlowmode(slowmode.channel_id, slowmode);
      }
      client.emit("userSlowmodes");
      break;
    }
    case "ReportCreate": {
      // Broadcast on the global topic; only privileged (moderator) sessions
      // are subscribed to it, so receiving this event means the current user
      // is a moderator and a new report has landed.
      client.emit("reportCreate", {
        id: event._id,
        authorId: event.author_id,
        contentType: event.content.type,
        contentId: event.content.id,
        reason: event.content.report_reason,
      });
      break;
    }
    case "CalendarEventCreate": {
      const instance = client.calendarEvents.upsert(event.event);
      client.emit("calendarEventCreate", instance);
      break;
    }
    case "CalendarEventUpdate": {
      // Full-object merge over a complete hydrated event; also carries
      // soft-cancel (event.cancelled === true).
      const instance = client.calendarEvents.upsert(event.event);
      client.emit("calendarEventUpdate", instance);
      break;
    }
    case "CalendarEventInvite": {
      const instance = client.calendarEvents.upsert(event.event);
      client.emit("calendarEventInvite", instance);
      break;
    }
    case "InteractionCreate": {
      // Bot-facing (this event only arrives on the bot's own private topic;
      // it carries the single-use response token). Transient — no collection.
      client.emit("interactionCreate", event.interaction);
      break;
    }
    case "InteractionEphemeralMessage": {
      // An ephemeral interaction response (arrives only on this user's
      // private topic; never persisted server-side — gone on reload). It
      // enters the local message collection so it renders like any other
      // message, but deliberately skips the lastMessageId bump and
      // unread/mention processing: acks must never reference it.
      const message = event.message;
      if (!client.messages.has(message._id)) {
        const instance = batch(() => {
          if (message.member) {
            client.serverMembers.getOrCreate(message.member._id, message.member);
          }

          if (message.user) {
            client.users.getOrCreate(message.user._id, message.user);
          }

          delete message.member;
          delete message.user;

          // Create WITHOUT the collection's messageCreate emit: the local
          // ephemeral marker must be stamped first, so listeners (e.g. the
          // notification worker) see isEphemeral === true. Hydration never
          // reads `ephemeral` from wire data — this is the only place that
          // sets it.
          const instance = client.messages.getOrCreate(message._id, message);
          client.messages.updateUnderlyingObject(
            message._id,
            "ephemeral",
            true,
          );
          return instance;
        });

        client.emit("messageCreate", instance);
        client.emit("interactionEphemeral", instance);
      }
      break;
    }
    case "PollVoteUpdate":
    case "PollClose": {
      // Count-only aggregate update on the channel topic — ballots (voter
      // identities) are never broadcast. Only meaningful if the carrying
      // message is cached; a cold render re-hydrates via fetchPoll instead.
      const message = client.messages.getOrPartial(event.message_id);
      if (message && message.poll?.id === event.id) {
        const current = client.messages.getUnderlyingObject(
          event.message_id,
        ).pollState;

        // Final results are final: a straggling count update that lost a
        // race with the close must not mutate them.
        if (current?.closed && event.type === "PollVoteUpdate") break;

        client.messages.updateUnderlyingObject(event.message_id, "pollState", {
          hydrated: false,
          myVotes: undefined,
          ...current,
          counts: event.counts,
          totalVotes: event.total_votes,
          closed: event.type === "PollClose" ? true : (current?.closed ?? false),
        });

        client.emit(
          event.type === "PollClose" ? "pollClose" : "pollVoteUpdate",
          message,
        );
      }
      break;
    }
    case "SoftresReserveUpdate": {
      // Per-reserve delta on the channel topic. Only meaningful if the
      // carrying message is cached; a cold render re-hydrates via the
      // bulk softres fetch instead.
      const message = client.messages.getOrPartial(event.message_id);
      if (message && message.softres?.id === event.id) {
        const current = client.messages.getUnderlyingObject(
          event.message_id,
        ).softresState;

        // A locked sheet's reserves are final (the server rejects writes
        // once locked): a straggling reserve update that lost a race with
        // the lock must not mutate them.
        if (current?.locked) break;

        // Merge the per-item deltas into the cached full map, when this
        // viewer has one (an explicit 0 removes the key — the full-model
        // convention omits zero-count items). Without a cached map there
        // is nothing sound to merge into; the aggregate total still
        // updates below.
        let itemCounts = current?.itemCounts;
        if (itemCounts && event.changed_item_counts) {
          itemCounts = { ...itemCounts };
          for (const [item, count] of Object.entries(
            event.changed_item_counts,
          )) {
            if (count === 0) delete itemCounts[item];
            else itemCounts[item] = count;
          }
        }

        // Upsert / drop the row in the cached visible list, when present.
        let reserves = current?.reserves;
        if (reserves) {
          if (event.reserve) {
            const row = event.reserve;
            const index = reserves.findIndex(
              (existing) => existing.user_id === row.user_id,
            );
            reserves =
              index === -1
                ? [...reserves, row]
                : reserves.map((existing, at) =>
                    at === index ? row : existing,
                  );
          } else if (event.removed_user) {
            reserves = reserves.filter(
              (existing) => existing.user_id !== event.removed_user,
            );
          }
        }

        // This user's own row can change from another session; visible
        // sheets carry it in the event (hidden sheets omit rows entirely —
        // the own-session REST response keeps `myReserve` fresh there, and
        // a hidden-sheet cross-session consumer must refetch; see the
        // `softresReserveUpdate` docs). Both operands must be defined —
        // `undefined === undefined` must never match.
        let myReserve = current?.myReserve;
        const selfId = client.user?.id;
        if (selfId && event.reserve && event.reserve.user_id === selfId) {
          myReserve = event.reserve;
        } else if (selfId && event.removed_user === selfId) {
          myReserve = undefined;
        }

        client.messages.updateUnderlyingObject(
          event.message_id,
          "softresState",
          {
            locked: false,
            hydrated: false,
            ...current,
            totalReserves: event.total_reserves,
            itemCounts,
            reserves,
            myReserve,
          },
        );

        client.emit("softresReserveUpdate", message);
      }
      break;
    }
    case "SoftresSheetUpdate": {
      // Settings / lock / event-cancel fan-out carrying the full
      // public-gated model (incl. the fresh definition — the message-
      // embedded copy stays stale by design).
      const message = client.messages.getOrPartial(event.message_id);
      if (message && message.softres?.id === event.id) {
        const current = client.messages.getUnderlyingObject(
          event.message_id,
        ).softresState;

        client.messages.updateUnderlyingObject(
          event.message_id,
          "softresState",
          {
            ...softresStateFromWire(event.sheet),
            // The broadcast has no viewer, so `my_reserve` is never
            // populated — preserve this user's own cached row rather
            // than clearing it.
            myReserve: current?.myReserve,
            hydrated: current?.hydrated ?? false,
          },
        );

        client.emit("softresSheetUpdate", message);
      }
      break;
    }
    case "SoundboardSound": {
      // A soundboard sound was triggered in a voice call (channel topic).
      // Transient — carries no audio, only the public sound id. Played
      // locally by the voice store only if this client is in that call.
      client.emit("soundboardSound", {
        channelId: event.channel_id,
        soundId: event.id,
        serverId: event.server_id,
        emoji: event.emoji,
      });
      break;
    }
    case "MessageScheduled": {
      // Author-private (this user's own pending queue, another session may
      // have scheduled it).
      client.scheduledMessages.set(event.message._id, event.message);
      client.emit("scheduledMessageCreate", event.message);
      break;
    }
    case "MessageScheduleCancelled": {
      client.scheduledMessages.delete(event.id);
      client.emit("scheduledMessageCancel", event.id, event.channel);
      break;
    }
    case "ScheduledMessageFailed": {
      client.scheduledMessages.delete(event.id);
      client.emit("scheduledMessageFail", event.id, event.channel, event.reason);
      break;
    }
    case "ChannelFollowCreate": {
      // Received on the TARGET server topic (full follow). No dedicated
      // collection — emitted straight through for any interested UI.
      client.emit("channelFollowCreate", event.follow);
      break;
    }
    case "ChannelFollowDelete": {
      client.emit("channelFollowDelete", {
        id: event.id,
        sourceChannel: event.source_channel,
        targetChannel: event.target_channel,
      });
      break;
    }
    case "ChannelFollowersUpdate": {
      // Privacy-trimmed refetch signal on the SOURCE server topic — the
      // source-side followers UI refetches the ManageChannel-gated list.
      client.emit("channelFollowersUpdate", event.channel);
      break;
    }
    // "Import from Discord" job progress, delivered on the initiating user's
    // private topic. No collection — the app-level import worker owns the
    // state (the modal may be dismissed while the job runs).
    case "DiscordImportProgress": {
      client.emit("discordImportProgress", {
        jobId: event.job_id,
        stage: event.stage,
        done: event.done,
        total: event.total,
      });
      break;
    }
    case "DiscordImportComplete": {
      // `ServerCreate` is emitted by the worker BEFORE this, so the server
      // collection is already hydrated by the time we navigate to it.
      client.emit("discordImportComplete", {
        jobId: event.job_id,
        serverId: event.server_id,
        inviteCode: event.invite_code,
      });
      break;
    }
    case "DiscordImportFailed": {
      client.emit("discordImportFailed", {
        jobId: event.job_id,
        error: event.error,
      });
      break;
    }
    case "CalendarEventRsvp": {
      const instance = client.calendarEvents.get(event.rsvp.event);
      if (instance) {
        // Authoritative only for the caller's OWN row; other users' counts are
        // refreshed by the open detail via fetchWithContext (no delta drift).
        if (event.rsvp.user === client.user?.id) {
          client.calendarEvents.updateUnderlyingObject(event.rsvp.event, {
            myRsvp: event.rsvp.status,
          } as never);
        }
        client.emit("calendarEventRsvp", instance, event.rsvp);
      }
      break;
    }
    case "E2EEMessage":
    case "E2EEDeviceCreate":
    case "E2EEDeviceDelete":
    case "E2EEChallenge":
    case "E2EEClaimResult":
    // Media E2EE (MLS, slice 6): the join-intent trigger and the
    // commit/Welcome envelope pushes. Same opaque-relay contract — routed to
    // the active call session's sink inside the bridge; no adapter/session =
    // no-op and the envelopes stay queued + unacked server-side.
    case "MlsJoinRequested":
    case "MlsCommit":
    case "MlsWelcome":
    case "MlsCtl": {
      // Forwarded verbatim to the native-layer bridge; ciphertext and key
      // material are opaque to this library. No adapter (web) = no-op —
      // envelopes stay queued server-side for the user's real devices.
      client.e2ee?.onEvent(event);
      break;
    }
  }
}
