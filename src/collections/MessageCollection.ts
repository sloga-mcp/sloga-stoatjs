import type { Message as APIMessage } from "stoat-api";

import { Message } from "../classes/Message.js";
import type { HydratedMessage } from "../hydration/message.js";

import { ClassCollection } from "./Collection.js";

/**
 * The error a single-message fetch rejects with when the server answers a
 * row of another channel.
 */
function notInChannel(): Error {
  return new Error("Message is not in this channel");
}

/**
 * The error a single-message fetch rejects with when the server answers a
 * row with another id than the one asked for.
 */
function notTheMessage(): Error {
  return new Error("Message is not the one that was asked for");
}

/**
 * Collection of Messages
 */
export class MessageCollection extends ClassCollection<
  Message,
  HydratedMessage
> {
  /**
   * Fetch message by Id
   * @param channelId Channel Id
   * @param messageId Message Id
   * @returns Message
   */
  async fetch(channelId: string, messageId: string): Promise<Message> {
    const message = this.get(messageId);
    if (message && !this.isPartial(messageId)) {
      // A row cached under another channel is not the one asked for
      if (message.channelId !== channelId) throw notInChannel();
      return message;
    }

    const data = await this.client.api.get(
      `/channels/${channelId as ""}/messages/${messageId as ""}`,
    );

    // Another row of the same channel is not the one asked for either
    if (data?._id !== messageId) throw notTheMessage();

    const row = this.getOrCreateIn(channelId, data);
    if (!row) throw notInChannel();
    return row;
  }

  /**
   * Store a row a server sent in answer to a fetch of one channel. A row
   * that names any other channel is dropped before it is hydrated, and an
   * id already cached under another channel is not handed back either. A
   * row is stripped or kept by the channel it names, so without this a
   * server could answer a fetch of a protected channel with rows that name
   * an ordinary one and have its text shown there. No fetch of a channel
   * legitimately answers rows of another, so this holds for every channel.
   * A cached partial is replaced whole: nothing an earlier event wrote on
   * it survives under the fetched row. Logs ids only.
   * @param channelId Channel that was fetched
   * @param data Row from the response
   * @returns The stored row, or `undefined` when it was dropped
   */
  getOrCreateIn(channelId: string, data: APIMessage): Message | undefined {
    const id = (data as { _id?: unknown } | null | undefined)?._id;
    if (typeof id !== "string") return undefined;

    if (data.channel !== channelId) {
      console.warn(
        "[messages] dropped a fetched row that names another channel",
        { channelId, messageId: id },
      );
      return undefined;
    }

    if (this.has(id) && this.isPartial(id)) this.delete(id);

    const row = this.getOrCreate(id, data);
    if (row.channelId !== channelId) {
      console.warn(
        "[messages] dropped a fetched row cached under another channel",
        { channelId, messageId: id },
      );
      return undefined;
    }

    return row;
  }

  /**
   * Get or create
   * @param id Id
   * @param data Data
   * @param isNew Whether this object is new
   */
  getOrCreate(id: string, data: APIMessage, isNew = false): Message {
    if (this.has(id) && !this.isPartial(id)) {
      return this.get(id)!;
    } else {
      const instance = new Message(this, id);
      this.create(id, "message", instance, this.client, data);
      if (isNew) this.client.emit("messageCreate", instance);
      return instance;
    }
  }

  /**
   * Get or return partial
   * @param id Id
   */
  getOrPartial(id: string): Message | undefined {
    if (this.has(id)) {
      return this.get(id)!;
    } else if (this.client.options.partials) {
      const instance = new Message(this, id);
      this.create(id, "message", instance, this.client, {
        id,
        partial: true,
      });
      return instance;
    }
  }
}
