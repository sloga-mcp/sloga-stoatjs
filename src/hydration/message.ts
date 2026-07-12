import { ReactiveMap } from "@solid-primitives/map";
import { ReactiveSet } from "@solid-primitives/set";
import type { Embed, Interactions, Masquerade, Message } from "stoat-api";

import type { Client } from "../Client.js";
import { File } from "../classes/File.js";
import { MessageWebhook } from "../classes/Message.js";
import { MessageEmbed } from "../classes/MessageEmbed.js";
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
};

export const messageHydration: Hydrate<
  // `thread_id` is additive and server-set; stoat-api 0.13.5 predates it.
  Merge<Message> & { thread_id?: string },
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
   * CLIENT-ASSIGNED, never sent to or received from the server: this
   * message was end-to-end encrypted and lives only in the device-local
   * store (injected by the native E2EE bridge). Drives the lock indicator.
   */
  Encrypted = 1 << 30,
}
