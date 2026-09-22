import { batch } from "solid-js";

import { ChannelUnread } from "../classes/ChannelUnread.js";
import { Channel } from "../classes/index.js";
import type {
  APIChannelUnread,
  HydratedChannelUnread,
} from "../hydration/channelUnread.js";

import { ClassCollection } from "./Collection.js";

/**
 * Collection of Channel Unreads
 */
export class ChannelUnreadCollection extends ClassCollection<
  ChannelUnread,
  HydratedChannelUnread
> {
  /**
   * Load unread information from server
   */
  async sync(): Promise<void> {
    const unreads = await this.client.api.get("/sync/unreads");
    batch(() => {
      this.reset();
      for (const unread of unreads) {
        // delete-then-create, never getOrCreate: reading `Channel.unread` for
        // an unknown channel creates a placeholder row via `for()`, and the
        // badge effect does exactly that between the Ready batch and this
        // request resolving. getOrCreate would hand back that placeholder and
        // silently discard the server's read pointer, leaving every channel
        // the UI touched marked fully unread for the whole session.
        this.delete(unread._id.channel);
        this.getOrCreate(unread._id.channel, unread);
      }
    });
  }

  /**
   * Clear all unread data
   */
  reset(): void {
    // `updateUnderlyingObject({})` is a Solid store set with an empty patch,
    // which MERGES: it cleared nothing and left every instance in place.
    batch(() => {
      for (const id of [...this.keys()]) this.delete(id);
    });
  }

  /**
   * Apply a read pointer the server reported for this user, i.e. an ack made
   * from another session.
   *
   * The pointer never moves backwards, so the echo of this session's own ack
   * is a no-op, and only the mentions the server itself drops go with it
   * (those at or before the message). The count is reset either way: what
   * is left unread past a partial pointer is not known here, and zero renders
   * as the plain dot rather than a stale number.
   * @param channelId Channel Id
   * @param messageId Message id now marked read
   * @returns Whether anything changed
   */
  acknowledge(channelId: string, messageId: string): boolean {
    const userId = this.client.user?.id;
    if (!userId) return false;

    const unread = this.getOrCreate(channelId, {
      _id: { channel: channelId, user: userId },
      last_id: null,
      mentions: [],
    });

    const pointerMoves =
      (unread.lastMessageId ?? "0").localeCompare(messageId) === -1;
    const clearedMentions = [...unread.messageMentionIds].filter(
      (mention) => mention.localeCompare(messageId) !== 1,
    );

    if (!pointerMoves && clearedMentions.length === 0) return false;

    batch(() => {
      if (pointerMoves) {
        this.updateUnderlyingObject(channelId, "lastMessageId", messageId);
      }

      for (const mention of clearedMentions) {
        unread.messageMentionIds.delete(mention);
      }

      this.updateUnderlyingObject(channelId, "unreadCount", 0);
      this.updateUnderlyingObject(channelId, "unreadHasAttachments", false);
    });

    return true;
  }

  /**
   * Get or create
   * @param id Id
   * @param data Data
   */
  getOrCreate(id: string, data: APIChannelUnread): ChannelUnread {
    if (this.has(id)) {
      return this.get(id)!;
    } else {
      const instance = new ChannelUnread(this, id);
      this.create(id, "channelUnread", instance, this.client, data);
      return instance;
    }
  }

  /**
   * Get channel unread data for a specific Channel
   * @param channel Channel
   * @returns Unread
   */
  for(channel: Channel): ChannelUnread {
    return this.getOrCreate(channel.id, {
      _id: {
        channel: channel.id,
        user: this.client.user!.id,
      },
      last_id: null,
      mentions: [],
    });
  }
}
