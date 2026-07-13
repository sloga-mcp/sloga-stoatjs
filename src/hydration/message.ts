import { ReactiveMap } from "@solid-primitives/map";
import { ReactiveSet } from "@solid-primitives/set";
import type { Embed, Interactions, Masquerade, Message } from "stoat-api";

import type { Client } from "../Client.js";
import { File } from "../classes/File.js";
import type {
  ActionRowData,
  MessageInteractionData,
} from "../classes/Interaction.js";
import { MessageWebhook } from "../classes/Message.js";
import { MessageEmbed } from "../classes/MessageEmbed.js";
import type { PollDefinitionData, PollState } from "../classes/Poll.js";
import { SystemMessage } from "../classes/SystemMessage.js";
import type { Merge } from "../lib/merge.js";

import type { Hydrate } from "./index.js";

export type HydratedMessage = {
  id: string;
  nonce?: string;
  channelId: string;
  authorId?: string;
  webhook?: MessageWebhook;
  content?: string;
  systemMessage?: SystemMessage;
  attachments?: File[];
  editedAt?: Date;
  embeds?: MessageEmbed[];
  mentionIds?: string[];
  roleMentionIds?: string[];
  replyIds?: string[];
  reactions: ReactiveMap<string, ReactiveSet<string>>;
  interactions?: Interactions;
  masquerade?: Masquerade;
  pinned?: boolean;
  flags?: MessageFlags;
  /** Thread anchored to this message (server-stamped, never client-sent). */
  threadId?: string;
  /** "used /cmd" context (server-stamped by the interaction respond route). */
  commandContext?: MessageInteractionData;
  /** Interactive components (buttons / selects); bot-authored only. */
  components?: ActionRowData[];
  /**
   * Immutable poll definition (server-stamped by the poll create route,
   * never client-sent — the regular send path has no poll field).
   */
  poll?: PollDefinitionData;
  /**
   * Local dynamic poll state (counts / closed / own ballot). NOT hydrated
   * from message wire data — stamped by fetchPoll / vote responses and the
   * PollVoteUpdate / PollClose events.
   */
  pollState?: PollState;
  /**
   * Local marker: ephemeral interaction response (delivered only to this
   * user, never persisted). Deliberately NOT hydrated from wire data — the
   * InteractionEphemeralMessage event handler stamps it directly onto the
   * underlying object, so a hostile server cannot mark persisted messages
   * "ephemeral" (which would suppress notifications and lie in the UI).
   */
  ephemeral?: boolean;
};

export const messageHydration: Hydrate<
  // `thread_id`/`command_context`/`components` are additive; stoat-api
  // 0.13.5 predates them.
  Merge<Message> & {
    thread_id?: string;
    command_context?: MessageInteractionData;
    components?: ActionRowData[];
    poll?: PollDefinitionData;
  },
  HydratedMessage
> = {
  keyMapping: {
    _id: "id",
    channel: "channelId",
    author: "authorId",
    system: "systemMessage",
    edited: "editedAt",
    mentions: "mentionIds",
    replies: "replyIds",
    thread_id: "threadId",
    command_context: "commandContext",
    components: "components",
    poll: "poll",
  },
  functions: {
    id: (message) => message._id,
    nonce: (message) => message.nonce!,
    channelId: (message) => message.channel,
    authorId: (message) => message.author,
    webhook: (message, ctx) =>
      message.webhook
        ? new MessageWebhook(ctx as Client, message.webhook, message.author)
        : undefined,
    content: (message) => message.content!,
    systemMessage: (message, ctx) =>
      SystemMessage.from(ctx as Client, message, message.system!),
    attachments: (message, ctx) =>
      message.attachments!.map((file) => new File(ctx as Client, file)),
    editedAt: (message) => new Date(message.edited!),
    embeds: (message, ctx) =>
      message.embeds!.map((embed) => MessageEmbed.from(ctx as Client, embed)),
    mentionIds: (message) => message.mentions!,
    roleMentionIds: (message) => message.role_mentions!,
    replyIds: (message) => message.replies!,
    reactions: (message) => {
      const map = new ReactiveMap<string, ReactiveSet<string>>();
      if (message.reactions) {
        for (const reaction of Object.keys(message.reactions)) {
          map.set(reaction, new ReactiveSet(message.reactions![reaction]));
        }
      }
      return map;
    },
    interactions: (message) => message.interactions,
    masquerade: (message) => message.masquerade!,
    pinned: (message) => message.pinned!,
    // Strip the reserved client-only `Encrypted` bit from anything hydrated:
    // a message's encrypted-ness is tracked out-of-band by the native E2EE
    // bridge, never in a server-deliverable flag (which could be forged to
    // fake a lock).
    flags: (message) =>
      message.flags == null
        ? message.flags!
        : message.flags & ~MessageFlags.Encrypted,
    threadId: (message) => message.thread_id,
    commandContext: (message) => message.command_context,
    components: (message) => message.components,
    poll: (message) => message.poll,
    // Never from wire data — dynamic state lives in the polls routes and
    // the PollVoteUpdate/PollClose events, not on the message payload.
    pollState: () => undefined,
    // Deliberately ignores wire data (a hostile server must not be able to
    // stamp persisted messages "ephemeral"); the
    // InteractionEphemeralMessage handler sets the flag directly.
    ephemeral: () => undefined,
  },
  initialHydration: () => ({
    reactions: new ReactiveMap(),
  }),
};

/**
 * Flags attributed to messages
 */
export enum MessageFlags {
  /**
   * Message will not send push / desktop notifications
   */
  SuppressNotifications = 1,
  /**
   * Message will mention all users who can see the channel
   */
  MentionsEveryone = 2,
  /**
   * Message will mention all users who are online and can see the channel.
   * This cannot be true if MentionsEveryone is true
   */
  MentionsOnline = 3,
  /**
   * Message is a bot's response to a slash-command interaction — a bit
   * POSITION like the values above, NOT a mask. Server-set only (the send
   * path rejects client flags above 7), so with `command_context` it proves
   * the "used /cmd" attribution. Test via {@link messageFlagAtPosition}.
   */
  Interaction = 5,
  /**
   * CLIENT-ASSIGNED, never sent to or received from the server: this
   * message was end-to-end encrypted and lives only in the device-local
   * store (injected by the native E2EE bridge). Drives the lock indicator.
   * NOTE: unlike the values above this is a MASK, not a bit position.
   */
  Encrypted = 1 << 30,
}

/**
 * Whether a message flag bitfield has the bit at the given POSITION set —
 * mirrors the server's `MessageFlagsValue::has` (`flags & (1 << position)`).
 * Do NOT use for {@link MessageFlags.Encrypted}, which is a mask.
 */
export function messageFlagAtPosition(
  flags: number | undefined,
  position: MessageFlags,
): boolean {
  return (((flags ?? 0) >> position) & 1) === 1;
}
