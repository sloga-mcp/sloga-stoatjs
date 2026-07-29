import type {
  Message as APIMessage,
  SystemMessage as APISystemMessage,
} from "stoat-api";
import { decodeTime } from "ulid";

import type { Client } from "../Client.js";

import type { Channel } from "./Channel.js";
import type { User } from "./User.js";
import { Message } from "./index.js";

/**
 * System message types — stoat-api 0.13.5 predates threads, so the
 * `thread_created` wire type is declared locally (CalendarEvent precedent).
 */
export type SystemMessageType =
  | APISystemMessage["type"]
  | "thread_created"
  | "call_recording_started"
  | "call_recording_stopped";

/**
 * Serialized `SystemMessage::ThreadCreated { id, by, name }` posted into the
 * parent channel when a thread is created (server-authored only).
 */
interface APIThreadCreatedSystemMessage {
  type: "thread_created";
  /** Thread (channel) id */
  id: string;
  /** User who created the thread */
  by: string;
  /** Thread name at creation time */
  name: string;
}

/**
 * Serialized `SystemMessage::CallRecordingStarted | CallRecordingStopped
 * { by }`. Declared locally for the same reason as `thread_created` —
 * stoat-api 0.13.5 predates both.
 *
 * This is the DURABLE half of recording disclosure: the in-call banner dies
 * with the call, so without these two messages the channel would keep no
 * record that a recording ever happened.
 */
interface APICallRecordingSystemMessage {
  type: "call_recording_started" | "call_recording_stopped";
  /** User who started / stopped recording */
  by: string;
}

/**
 * System Message
 */
export abstract class SystemMessage {
  protected client?: Client;
  readonly type: SystemMessageType;

  /**
   * Construct System Message
   * @param client Client
   * @param type Type
   */
  constructor(client: Client, type: SystemMessageType) {
    this.client = client;
    this.type = type;
  }

  /**
   * Create an System Message from an API System Message
   * @param client Client
   * @param embed Data
   * @returns System Message
   */
  static from(
    client: Client,
    parent: APIMessage,
    message: APISystemMessage,
  ): SystemMessage {
    // Handled ahead of the switch: "thread_created" is not part of the
    // stoat-api 0.13.5 union, so it must not widen the narrowing below.
    if ((message as { type: string }).type === "thread_created") {
      return new ThreadCreatedSystemMessage(
        client,
        message as unknown as APIThreadCreatedSystemMessage,
      );
    }

    // Same treatment, same reason (call-recording plan §1).
    const type = (message as { type: string }).type;
    if (
      type === "call_recording_started" ||
      type === "call_recording_stopped"
    ) {
      return new CallRecordingSystemMessage(
        client,
        message as unknown as APICallRecordingSystemMessage,
      );
    }

    switch (message.type) {
      case "text":
        return new TextSystemMessage(client, message);
      case "user_added":
      case "user_remove":
        return new UserModeratedSystemMessage(client, message);
      case "user_joined":
      case "user_left":
      case "user_kicked":
      case "user_banned":
        return new UserSystemMessage(client, message);
      case "channel_renamed":
        return new ChannelRenamedSystemMessage(client, message);
      case "channel_description_changed":
      case "channel_icon_changed":
        return new ChannelEditSystemMessage(client, message);
      case "channel_ownership_changed":
        return new ChannelOwnershipChangeSystemMessage(client, message);
      case "message_pinned":
      case "message_unpinned":
        return new MessagePinnedSystemMessage(client, message);
      case "call_started":
        return new CallStartedSystemMessage(client, parent, message);
      default:
        return new TextSystemMessage(client, {
          type: "text",
          content: `${(message as { type: string }).type} is not supported.`,
        });
    }
  }
}

/**
 * Text System Message
 */
export class TextSystemMessage extends SystemMessage {
  readonly content: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & { type: "text" },
  ) {
    super(client, systemMessage.type);
    this.content = systemMessage.content;
  }
}

/**
 * User System Message
 */
export class UserSystemMessage extends SystemMessage {
  readonly userId: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & {
      type:
        | "user_added"
        | "user_remove"
        | "user_joined"
        | "user_left"
        | "user_kicked"
        | "user_banned";
    },
  ) {
    super(client, systemMessage.type);
    this.userId = systemMessage.id;
  }

  /**
   * User this message concerns
   */
  get user(): User | undefined {
    return this.client!.users.get(this.userId);
  }
}

/**
 * User Moderated System Message
 */
export class UserModeratedSystemMessage extends UserSystemMessage {
  readonly byId: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & {
      type: "user_added" | "user_remove";
    },
  ) {
    super(client, systemMessage);
    this.byId = systemMessage.by;
  }

  /**
   * User this action was performed by
   */
  get by(): User | undefined {
    return this.client!.users.get(this.byId);
  }
}

/**
 * Channel Edit System Message
 */
export class ChannelEditSystemMessage extends SystemMessage {
  readonly byId: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & {
      type:
        | "channel_renamed"
        | "channel_description_changed"
        | "channel_icon_changed";
    },
  ) {
    super(client, systemMessage.type);
    this.byId = systemMessage.by;
  }

  /**
   * User this action was performed by
   */
  get by(): User | undefined {
    return this.client!.users.get(this.byId);
  }
}

/**
 * Channel Renamed System Message
 */
export class ChannelRenamedSystemMessage extends ChannelEditSystemMessage {
  readonly name: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & {
      type: "channel_renamed";
    },
  ) {
    super(client, systemMessage);
    this.name = systemMessage.name;
  }
}

/**
 * Channel Ownership Change System Message
 */
export class ChannelOwnershipChangeSystemMessage extends SystemMessage {
  readonly fromId: string;
  readonly toId: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & {
      type: "channel_ownership_changed";
    },
  ) {
    super(client, systemMessage.type);
    this.fromId = systemMessage.from;
    this.toId = systemMessage.to;
  }

  /**
   * User giving away channel ownership
   */
  get from(): User | undefined {
    return this.client!.users.get(this.fromId);
  }

  /**
   * User receiving channel ownership
   */
  get to(): User | undefined {
    return this.client!.users.get(this.toId);
  }
}

/**
 * Message Pinned System Message
 */
export class MessagePinnedSystemMessage extends SystemMessage {
  readonly messageId: string;
  readonly byId: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & {
      type: "message_pinned" | "message_unpinned";
    },
  ) {
    super(client, systemMessage.type);
    this.messageId = systemMessage.id;
    this.byId = systemMessage.by;
  }

  /**
   * Message that was pinned/unpinned
   */
  get message(): Message | undefined {
    return this.client!.messages.get(this.messageId);
  }

  /**
   * User that pinned/unpinned
   */
  get by(): User | undefined {
    return this.client!.users.get(this.byId);
  }
}

/**
 * Call Started System Message
 */
export class CallStartedSystemMessage extends SystemMessage {
  readonly byId: string;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  /**
   * Construct System Message
   * @param client Client
   * @param parent Message
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    parent: APIMessage,
    systemMessage: APISystemMessage & {
      type: "call_started";
    },
  ) {
    super(client, systemMessage.type);
    this.byId = systemMessage.by;
    this.startedAt = new Date(decodeTime(parent._id));
    this.finishedAt =
      systemMessage.finished_at != null
        ? new Date(systemMessage.finished_at)
        : null;
  }

  /**
   * User that started the call
   */
  get by(): User | undefined {
    return this.client!.users.get(this.byId);
  }
}

/**
 * Call Recording System Message — posted when a participant starts or stops
 * recording a call locally (server-authored only).
 *
 * `type` distinguishes started from stopped, so one class covers both.
 */
export class CallRecordingSystemMessage extends SystemMessage {
  readonly byId: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(client: Client, systemMessage: APICallRecordingSystemMessage) {
    super(client, systemMessage.type);
    this.byId = systemMessage.by;
  }

  /**
   * User that started / stopped recording
   */
  get by(): User | undefined {
    return this.client!.users.get(this.byId);
  }
}

/**
 * Thread Created System Message — posted into the PARENT channel by the
 * server when a thread is created (never client-authored)
 */
export class ThreadCreatedSystemMessage extends SystemMessage {
  readonly threadId: string;
  readonly byId: string;
  readonly name: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(client: Client, systemMessage: APIThreadCreatedSystemMessage) {
    super(client, systemMessage.type);
    this.threadId = systemMessage.id;
    this.byId = systemMessage.by;
    this.name = systemMessage.name;
  }

  /**
   * Thread that was created, if cached
   */
  get thread(): Channel | undefined {
    return this.client!.channels.get(this.threadId);
  }

  /**
   * User that created the thread
   */
  get by(): User | undefined {
    return this.client!.users.get(this.byId);
  }
}
