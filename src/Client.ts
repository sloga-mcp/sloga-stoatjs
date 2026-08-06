import type { Accessor, Setter } from "solid-js";
import { batch, createSignal } from "solid-js";

import { ReactiveMap } from "@solid-primitives/map";
import { AsyncEventEmitter } from "@vladfrangu/async_event_emitter";
import { API } from "stoat-api";
import type { DataLogin, RevoltConfig, Role } from "stoat-api";

import type { CalendarEvent, EventRsvpData } from "./classes/CalendarEvent.js";
import type { Channel } from "./classes/Channel.js";
import type { ChannelFollowData } from "./classes/ChannelFollow.js";
import type { DiscordImportJobData } from "./classes/DiscordImport.js";
import type { E2EEAdapter } from "./classes/E2EE.js";
import type { Emoji } from "./classes/Emoji.js";
import type { InteractionCreateEvent } from "./classes/Interaction.js";
import type { Message } from "./classes/Message.js";
import type { ScheduledMessageData } from "./classes/ScheduledMessage.js";
import type {
  SoftResCatalogResponse,
  SoftResData,
  SoftResRaidItemsResponse,
} from "./classes/SoftRes.js";
import type { Server } from "./classes/Server.js";
import type { ServerMember } from "./classes/ServerMember.js";
import type { User } from "./classes/User.js";
import { AccountCollection } from "./collections/AccountCollection.js";
import { BotCollection } from "./collections/BotCollection.js";
import { ChannelCollection } from "./collections/ChannelCollection.js";
import { ChannelUnreadCollection } from "./collections/ChannelUnreadCollection.js";
import { ChannelWebhookCollection } from "./collections/ChannelWebhookCollection.js";
import { EmojiCollection } from "./collections/EmojiCollection.js";
import { EventCollection } from "./collections/EventCollection.js";
import { MessageCollection } from "./collections/MessageCollection.js";
import { ServerCollection } from "./collections/ServerCollection.js";
import { ServerMemberCollection } from "./collections/ServerMemberCollection.js";
import { SessionCollection } from "./collections/SessionCollection.js";
import { UserCollection } from "./collections/UserCollection.js";
import {
  ConnectionState,
  EventClient,
  type EventClientOptions,
} from "./events/EventClient.js";
import { ProtocolV1, UserSlowmodes, handleEvent } from "./events/v1.js";
import type { HydratedChannel } from "./hydration/channel.js";
import type { HydratedEmoji } from "./hydration/emoji.js";
import type { HydratedMessage } from "./hydration/message.js";
import type { HydratedServer } from "./hydration/server.js";
import type { HydratedServerMember } from "./hydration/serverMember.js";
import type { HydratedUser } from "./hydration/user.js";
import {
  RE_CHANNELS,
  RE_CUSTOM_EMOJI,
  RE_MENTIONS,
  RE_SPOILER,
} from "./lib/regex.js";

export type Session = { _id: string; token: string; user_id: string } | string;

/**
 * Events provided by the client
 */
export type Events = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: [error: any];

  connected: [];
  connecting: [];
  disconnected: [];
  ready: [];
  logout: [];

  policyChanges: [
    policyChanges: ProtocolV1["types"]["policyChange"][],
    acknowledge: () => Promise<void>,
  ];

  messageCreate: [message: Message];
  messageUpdate: [message: Message, previousMessage: HydratedMessage];
  messageDelete: [message: HydratedMessage];
  messageDeleteBulk: [messages: HydratedMessage[], channel?: Channel];
  messageReactionAdd: [message: Message, userId: string, emoji: string];
  messageReactionRemove: [message: Message, userId: string, emoji: string];
  messageReactionRemoveEmoji: [message: Message, emoji: string];

  channelCreate: [channel: Channel];
  channelUpdate: [channel: Channel, previousChannel: HydratedChannel];
  channelDelete: [channel: HydratedChannel];
  channelGroupJoin: [channel: Channel, user: User];
  channelGroupLeave: [channel: Channel, user?: User];
  channelStartTyping: [channel: Channel, user?: User];
  channelStopTyping: [channel: Channel, user?: User];
  channelAcknowledged: [channel: Channel, messageId: string];

  threadCreate: [thread: Channel];
  threadMemberJoin: [thread: Channel, userId: string];
  threadMemberLeave: [thread: Channel, userId: string];

  serverCreate: [server: Server];
  serverUpdate: [server: Server, previousServer: HydratedServer];
  serverDelete: [server: HydratedServer];
  serverLeave: [server: HydratedServer];
  serverRoleUpdate: [server: Server, roleId: string, previousRole: Role];
  serverRoleDelete: [server: Server, roleId: string, role: Role];

  serverMemberUpdate: [
    member: ServerMember,
    previousMember: HydratedServerMember,
  ];
  serverMemberJoin: [member: ServerMember];
  serverMemberLeave: [member: HydratedServerMember];

  userUpdate: [user: User, previousUser: HydratedUser];
  // ^ userRelationshipChanged: [user: User, previousRelationship: RelationshipStatus];
  // ^ userPresenceChanged: [user: User, previousPresence: boolean];
  userSettingsUpdate: [id: string, update: Record<string, [number, string]>];

  emojiCreate: [emoji: Emoji];
  emojiDelete: [emoji: HydratedEmoji];

  calendarEventCreate: [event: CalendarEvent];
  calendarEventUpdate: [event: CalendarEvent];
  calendarEventInvite: [event: CalendarEvent];
  calendarEventRsvp: [event: CalendarEvent, rsvp: EventRsvpData];

  /** Bot-facing: a slash command was invoked on this bot (private topic). */
  interactionCreate: [interaction: InteractionCreateEvent];

  /** A poll's aggregate counts changed (count-only; ballots never arrive). */
  pollVoteUpdate: [message: Message];

  /** A poll closed with final results. */
  pollClose: [message: Message];

  /**
   * A soft-reserve sheet's reserve rows / aggregate counts changed. On
   * HIDDEN sheets the event carries the new total only (rows and per-item
   * deltas are exactly what `hidden` conceals), so privileged viewers
   * (creator / ManageMessages) — and any viewer with their own row set
   * from another session — must refetch over REST to stay accurate.
   */
  softresReserveUpdate: [message: Message];

  /**
   * A soft-reserve sheet's settings or lock state changed. The applied
   * payload is the PUBLIC-gated model: on hidden sheets it clears the
   * cached `reserves` / `itemCounts` even for the leader, whose
   * privileged view must be refetched over REST on every one of these.
   */
  softresSheetUpdate: [message: Message];

  /**
   * An ephemeral interaction response addressed to this user (private
   * topic; never persisted — gone on reload). Also emitted as
   * `messageCreate` so message lists render it.
   */
  interactionEphemeral: [message: Message];

  /** This user scheduled a message (private topic; author-only). */
  scheduledMessageCreate: [row: ScheduledMessageData];

  /**
   * A pending scheduled message was cancelled (by this user elsewhere, or
   * because its channel was deleted). Private topic; author-only.
   */
  scheduledMessageCancel: [id: string, channelId: string];

  /**
   * A scheduled message could not be delivered (permanent — permissions
   * revoked, channel gone, or fire-time validation failed).
   */
  scheduledMessageFail: [id: string, channelId: string, reason: string];

  /**
   * A target channel started following an announcement channel (full follow;
   * delivered on the target server topic).
   */
  channelFollowCreate: [follow: ChannelFollowData];

  /** A follow was severed (target server topic). */
  channelFollowDelete: [
    ref: { id: string; sourceChannel: string; targetChannel: string },
  ];

  /**
   * A source announcement channel's follower set changed — a privacy-trimmed
   * refetch signal (source server topic; no target ids). Carries the source
   * channel id so the followers UI can refetch the gated list.
   */
  channelFollowersUpdate: [channelId: string];

  voiceChannelJoin: [channel: Channel, userId: string];
  voiceChannelLeave: [channel: Channel, userId: string];

  /**
   * A soundboard sound was triggered in a voice call (channel topic).
   * Carries only the public sound id — the voice store plays the clip
   * locally if this client is currently in that call.
   */
  soundboardSound: [
    detail: {
      channelId: string;
      soundId: string;
      serverId: string;
      emoji?: string;
    },
  ];

  /**
   * A sharer offered this user remote control of their machine (private
   * topic; the target only). Ships dark behind the server's
   * `remote_control` feature flag.
   *
   * `sharerEphemeralPub` / `rcSessionId` are OPAQUE base64 carried for the
   * native key agreement — never parse or derive from them here.
   *
   * The private topic reaches EVERY session of this user, including ones
   * not in the call; the server's accept route is what enforces that the
   * responding session is the live participant.
   */
  remoteControlOffered: [
    detail: {
      channelId: string;
      offerId: string;
      sharerId: string;
      targetId: string;
      sharerEphemeralPub: string;
      rcSessionId: string;
    },
  ];

  /** A control offer this user made was declined (private; sharer only). */
  remoteControlDeclined: [
    detail: {
      channelId: string;
      offerId: string;
      sharerId: string;
      targetId: string;
    },
  ];

  /**
   * A control offer this user made was accepted (private; sharer only).
   * Carries the controller's opaque ephemeral public key — the return path
   * of the key agreement.
   */
  remoteControlAccepted: [
    detail: {
      channelId: string;
      offerId: string;
      grantId: string;
      sharerId: string;
      controllerId: string;
      controllerEphemeralPub: string;
    },
  ];

  /**
   * Redacted third-party visibility: a control session is active in this
   * channel and between whom (channel topic; no grant id, nothing
   * actionable). Clear the indicator on `remoteControlEnded` with the same
   * (channelId, sharerId) key.
   */
  remoteControlActive: [
    detail: { channelId: string; sharerId: string; controllerId: string },
  ];

  /** A control session ended (channel topic). */
  remoteControlEnded: [
    detail: { channelId: string; sharerId: string; reason: string },
  ];

  userSlowmodes: [];

  /**
   * A Discord import advanced a stage (private topic; owner-only).
   *
   * `stage` is an OPAQUE server string — never switch on it exhaustively.
   * `total` is legitimately `0` while a stage is indeterminate, so guard
   * before dividing.
   */
  discordImportProgress: [
    progress: { jobId: string; stage: string; done: number; total: number },
  ];

  /** A Discord import finished; the server exists and the invite is live. */
  discordImportComplete: [
    result: { jobId: string; serverId: string; inviteCode: string },
  ];

  /** A Discord import failed permanently; `error` is already user-safe. */
  discordImportFailed: [failure: { jobId: string; error: string }];

  reportCreate: [
    report: {
      id: string;
      authorId: string;
      contentType: "Message" | "Server" | "User";
      contentId: string;
      reason: string;
    },
  ];
};

/**
 * Client options object
 */
export type ClientOptions = Partial<EventClientOptions> & {
  /**
   * Base URL of the API server
   */
  baseURL: string;

  /**
   * Whether to allow partial objects to emit from events
   * @default false
   */
  partials: boolean;

  /**
   * Whether to eagerly fetch users and members for incoming events
   * @default true
   * @deprecated
   */
  eagerFetching: boolean;

  /**
   * Whether to automatically sync unreads information
   * @default false
   */
  syncUnreads: boolean;

  /**
   * Whether to reconnect when disconnected
   * @default true
   */
  autoReconnect: boolean;

  /**
   * Whether to rewrite sent messages that include identifiers such as @silent
   * @default true
   */
  messageRewrites: boolean;

  /**
   * Retry delay function
   * @param retryCount Count
   * @returns Delay in seconds
   * @default (2^x-1) ±20%
   */
  retryDelayFunction(retryCount: number): number;

  /**
   * Check whether a channel is muted
   * @param channel Channel
   * @return Whether it is muted or through inheritance
   * @default false
   */
  channelIsMuted(channel: Channel): boolean;

  /**
   * Check whether a channel is exclusively muted (irrespective of server)
   * @param channel Channel
   * @return Whether it is exclusively muted
   * @default false
   */
  channelExclusiveMuted(channel: Channel): boolean;
};

/**
 * Stoat.js Clients
 */
export class Client extends AsyncEventEmitter<Events> {
  readonly account;
  readonly bots;
  readonly calendarEvents;
  readonly channels;
  readonly channelUnreads;
  readonly channelWebhooks;
  readonly emojis;
  readonly messages;
  readonly servers;
  readonly serverMembers;
  readonly sessions;
  readonly users;
  readonly userSlowmodes;
  /**
   * The current user's pending scheduled messages, keyed by row id.
   * Author-private and ephemeral: populated by
   * {@link Channel.fetchScheduledMessages} on channel mount and kept live
   * by the `scheduledMessage*` events.
   */
  readonly scheduledMessages;

  readonly api: API;
  readonly options: ClientOptions;
  readonly events: EventClient<1>;

  configuration: RevoltConfig | undefined;
  #session: Session | undefined;
  user: User | undefined;

  /**
   * Native E2EE bridge, set by the embedding app on platforms with a
   * native crypto layer (desktop/Android). When present, every direct
   * message send is routed through it first — see `E2EEAdapter`.
   */
  e2ee: E2EEAdapter | undefined;

  readonly ready: Accessor<boolean>;
  #setReady: Setter<boolean>;

  readonly configured: Accessor<boolean>;
  #setConfigured: Setter<boolean>;

  readonly connectionFailureCount: Accessor<number>;
  #setConnectionFailureCount: Setter<number>;
  #reconnectTimeout: number | undefined;
  #slowmodeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * Create Stoat.js Client
   */
  constructor(options?: Partial<ClientOptions>, configuration?: RevoltConfig) {
    super();

    this.options = {
      baseURL: "https://stoat.chat/api",
      partials: false,
      eagerFetching: true,
      syncUnreads: false,
      autoReconnect: true,
      messageRewrites: true,
      /**
       * Retry delay function
       * @param retryCount Count
       * @returns Delay in seconds
       */
      retryDelayFunction(retryCount) {
        return (Math.pow(2, retryCount) - 1) * (0.8 + Math.random() * 0.4);
      },
      /**
       * Check whether a channel is muted
       * @param channel Channel
       * @return Whether it is muted
       */
      channelIsMuted() {
        return false;
      },
      /**
       * Check whether a channel is exclusively muted (irrespective of server)
       * @param channel Channel
       * @return Whether it is exclusively muted
       * @default false
       */
      channelExclusiveMuted() {
        return false;
      },
      ...options,
    };

    this.configuration = configuration;

    this.api = new API({
      baseURL: this.options.baseURL,
    });

    const [configured, setConfigured] = createSignal(
      configuration !== undefined,
    );
    this.configured = configured;
    this.#setConfigured = setConfigured;

    this.#fetchConfiguration();

    const [ready, setReady] = createSignal(false);
    this.ready = ready;
    this.#setReady = setReady;

    const [connectionFailureCount, setConnectionFailureCount] = createSignal(0);
    this.connectionFailureCount = connectionFailureCount;
    this.#setConnectionFailureCount = setConnectionFailureCount;

    this.account = new AccountCollection(this);
    this.bots = new BotCollection(this);
    this.calendarEvents = new EventCollection(this);
    this.channels = new ChannelCollection(this);
    this.channelUnreads = new ChannelUnreadCollection(this);
    this.channelWebhooks = new ChannelWebhookCollection(this);
    this.emojis = new EmojiCollection(this);
    this.messages = new MessageCollection(this);
    this.servers = new ServerCollection(this);
    this.serverMembers = new ServerMemberCollection(this);
    this.sessions = new SessionCollection(this);
    this.users = new UserCollection(this);
    this.userSlowmodes = new ReactiveMap<string, UserSlowmodes>();
    this.scheduledMessages = new ReactiveMap<string, ScheduledMessageData>();

    this.events = new EventClient(1, "json", this.options);
    this.events.on("error", (error) => this.emit("error", error));
    this.events.on("state", (state) => {
      switch (state) {
        case ConnectionState.Connected:
          batch(() => {
            this.servers.forEach((server) => server.resetSyncStatus());
            this.#setConnectionFailureCount(0);
            this.emit("connected");
          });
          break;
        case ConnectionState.Connecting:
          this.emit("connecting");
          break;
        case ConnectionState.Disconnected:
          this.emit("disconnected");
          if (this.options.autoReconnect) {
            this.#reconnectTimeout = setTimeout(
              () => this.connect(),
              this.options.retryDelayFunction(this.connectionFailureCount()) *
                1e3,
            ) as never;

            this.#setConnectionFailureCount((count) => count + 1);
          }
          break;
      }
    });

    this.events.on("event", (event) =>
      handleEvent(this, event, this.#setReady),
    );
  }

  /**
   * Current session id
   */
  get sessionId(): string | undefined {
    return typeof this.#session === "string" ? undefined : this.#session?._id;
  }

  /**
   * Get authentication header
   */
  get authenticationHeader(): [string, string] {
    return typeof this.#session === "string"
      ? ["X-Bot-Token", this.#session]
      : ["X-Session-Token", this.#session?.token as string];
  }

  /**
   * Connect to Revolt
   */
  connect(): void {
    clearTimeout(this.#reconnectTimeout);
    this.events.disconnect();
    this.#setReady(false);
    this.events.connect(
      this.configuration?.ws ?? "wss://stoat.chat/events",
      typeof this.#session === "string" ? this.#session : this.#session!.token,
    );
  }

  /**
   * Fetches the configuration of the server if it has not been already fetched.
   */
  async #fetchConfiguration(): Promise<void> {
    if (!this.configuration) {
      this.configuration = await this.api.get("/");
      this.#setConfigured(true);
    }
  }

  /**
   * Update API object to use authentication.
   */
  #updateHeaders(): void {
    (this.api as API) = new API({
      baseURL: this.options.baseURL,
      authentication: {
        revolt: this.#session,
      },
    });
  }

  /**
   * Log in with auth data, creating a new session in the process.
   * @param details Login data object
   * @returns An on-boarding function if on-boarding is required, undefined otherwise
   */
  async login(details: DataLogin): Promise<void> {
    await this.#fetchConfiguration();
    const data = await this.api.post("/auth/session/login", details);
    if (data.result === "Success") {
      this.#session = data;
      // TODO: return await this.connect();
    } else {
      throw "MFA not implemented!";
    }
  }

  /**
   * Use an existing session
   */
  useExistingSession(session: Session): void {
    this.#session = session;
    this.#updateHeaders();
  }

  /**
   * Log in as a bot
   * @param token Bot token
   */
  async loginBot(token: string): Promise<void> {
    await this.#fetchConfiguration();
    this.#session = token;
    this.#updateHeaders();
    this.connect();
  }

  /**
   * Log out of current session
   *
   * This function prepares the client for disposal by removing all event listeners and killing the events socket.
   */
  async logout(): Promise<void> {
    await this.api.post("/auth/session/logout");
    this.events.removeAllListeners();
    this.removeAllListeners();
    this.events.disconnect();
  }

  /**
   * Prepare a markdown-based message to be displayed to the user as plain text.
   * @param source Source markdown text
   * @returns Modified plain text
   */
  markdownToText(source: string): string {
    return source
      .replace(RE_MENTIONS, (sub: string, id: string) => {
        const user = this.users.get(id as string);

        if (user) {
          return `@${user.username}`;
        }

        return sub;
      })
      .replace(RE_CHANNELS, (sub: string, id: string) => {
        const channel = this.channels.get(id as string);

        if (channel) {
          return `#${channel.displayName}`;
        }

        return sub;
      })
      .replace(RE_CUSTOM_EMOJI, (sub: string, id: string) => {
        const emoji = this.emojis.get(id as string);

        if (emoji) {
          return `:${emoji.name}:`;
        }

        return sub;
      })
      .replace(RE_SPOILER, "<spoiler>");
  }

  /**
   * Prepare a markdown-based message to be displayed to the user as plain text. This method will fetch each user or channel if they are missing. Useful for serviceworkers.
   * @param source Source markdown text
   * @returns Modified plain text
   */
  async markdownToTextFetch(source: string): Promise<string> {
    // Get all user matches, create a map to dedupe
    const userMatches = Object.fromEntries(
      Array.from(source.matchAll(RE_MENTIONS), (match) => {
        return [match[0], match[1]];
      }),
    );

    // Get all channel matches, create a map to dedupe
    const channelMatches = Object.fromEntries(
      Array.from(source.matchAll(RE_CHANNELS), (match) => {
        return [match[0], match[1]];
      }),
    );

    // Get all custom emoji matches, create a map to dedupe
    const customEmojiMatches = Object.fromEntries(
      Array.from(source.matchAll(RE_CUSTOM_EMOJI), (match) => {
        return [match[0], match[1]];
      }),
    );

    // Send requests to replace user ids
    const userReplacementPromises = Object.keys(userMatches).map(
      async (key) => {
        const substr = userMatches[key];
        if (substr) {
          try {
            const user = await this.users.fetch(substr);
            if (user) {
              return [key, `@${user.username}`];
            }
          } catch {
            // If the fetch fails, just show the match as a default
            return [key, key];
          }
        }

        return [key, key];
      },
    );

    // Send requests to replace channel ids
    const channelReplacementPromises = Object.keys(channelMatches).map(
      async (key) => {
        const substr = channelMatches[key];
        if (substr) {
          try {
            const channel = await this.channels.fetch(substr);
            if (channel) {
              return [key, `#${channel.displayName}`];
            }
          } catch {
            // If the fetch fails, just show the match as a default
            return [key, key];
          }
        }

        return [key, key];
      },
    );

    // Send requests to replace custom emojis
    const customEmojiReplacementPromises = Object.keys(customEmojiMatches).map(
      async (key) => {
        const substr = customEmojiMatches[key];
        if (substr) {
          try {
            const emoji = await this.emojis.fetch(substr);
            if (emoji) {
              return [key, `:${emoji.name}:`];
            }
          } catch {
            // If the fetch fails, just show the match as a default
            return [key, key];
          }
        }

        return [key, key];
      },
    );

    // Await for all promises to get the strings to replace with.
    const replacements = await Promise.all([
      ...userReplacementPromises,
      ...channelReplacementPromises,
      ...customEmojiReplacementPromises,
    ]);

    const replacementsMap = Object.fromEntries(replacements);

    return source
      .replace(RE_MENTIONS, (match) => replacementsMap[match])
      .replace(RE_CHANNELS, (match) => replacementsMap[match])
      .replace(RE_CUSTOM_EMOJI, (match) => replacementsMap[match])
      .replace(RE_SPOILER, "<spoiler>");
  }

  /**
   * Proxy a file through January.
   * @param url URL to proxy
   * @returns Proxied media URL
   */
  proxyFile(url: string): string | undefined {
    if (this.configuration?.features.january.enabled) {
      return `${this.configuration.features.january.url}/proxy?url=${encodeURIComponent(
        url,
      )}`;
    } else {
      return url;
    }
  }

  /**
   * Upload a file
   * @param tag Tag
   * @param file File
   * @param uploadUrl Media server upload route
   */
  async uploadFile(
    tag: string,
    file: File,
    uploadUrl?: string,
  ): Promise<string> {
    const body = new FormData();
    body.append("file", file);

    const [key, value] = this.authenticationHeader;
    const data: { id: string } = await fetch(
      `${uploadUrl ?? this.configuration?.features.autumn.url}/${tag}`,
      {
        method: "POST",
        body,
        headers: {
          [key]: value,
        },
      },
    ).then((res) => res.json());

    return data.id;
  }

  setSlowmode(channelId: string, data: UserSlowmodes): void {
    const existing = this.#slowmodeTimers.get(channelId);
    if (existing) clearTimeout(existing);

    this.userSlowmodes.set(channelId, { ...data, receivedAt: Date.now() });

    const timer = setTimeout(() => {
      this.userSlowmodes.delete(channelId);
      this.#slowmodeTimers.delete(channelId);
      this.emit("userSlowmodes");
    }, data.retry_after * 1000);

    this.#slowmodeTimers.set(channelId, timer);
  }

  /**
   * In-flight/settled soft-reserve catalog fetch — static game data,
   * cached for the client's lifetime (promises so concurrent callers
   * share one request; cleared on rejection so a retry can succeed).
   */
  #softresCatalog?: Promise<SoftResCatalogResponse>;

  /** Per-raid loot-table cache, same policy as {@link #softresCatalog}. */
  #softresRaidItems = new Map<string, Promise<SoftResRaidItemsResponse>>();

  /**
   * Fetch the soft-reserve catalog: editions and their raids, for the
   * sheet-create picker. Static game data — cached after the first call.
   */
  fetchSoftResCatalog(): Promise<SoftResCatalogResponse> {
    if (!this.#softresCatalog) {
      this.#softresCatalog = (
        this.#apiReq("GET", "/softres/catalog") as Promise<SoftResCatalogResponse>
      ).catch((error) => {
        this.#softresCatalog = undefined;
        throw error;
      });
    }
    return this.#softresCatalog;
  }

  /**
   * Fetch one raid's reservable loot table for the item picker. Static
   * game data — cached per raid after the first call.
   */
  fetchSoftResRaidItems(raidId: string): Promise<SoftResRaidItemsResponse> {
    let pending = this.#softresRaidItems.get(raidId);
    if (!pending) {
      pending = (
        this.#apiReq(
          "GET",
          `/softres/catalog/${raidId}`,
        ) as Promise<SoftResRaidItemsResponse>
      ).catch((error) => {
        this.#softresRaidItems.delete(raidId);
        throw error;
      });
      this.#softresRaidItems.set(raidId, pending);
    }
    return pending;
  }

  /**
   * Fetch the soft-reserve sheet linked to a calendar event, if any.
   * Resolves to `null` when the event has no sheet (or its channel is not
   * visible to this user — both are 404 server-side, no oracle). When the
   * carrying message is cached, the state is also stamped onto it.
   */
  async fetchEventSoftRes(eventId: string): Promise<SoftResData | null> {
    let data: SoftResData;
    try {
      data = (await this.#apiReq(
        "GET",
        `/events/event/${eventId}/softres`,
      )) as SoftResData;
    } catch (error) {
      if ((error as { type?: string })?.type === "NotFound") return null;
      throw error;
    }

    this.messages.get(data.message_id)?.applySoftresState(data);
    return data;
  }

  /**
   * Start a "Import from Discord" job from a pasted guild-template link or
   * bare template code. The server parses it; anything unparseable comes back
   * as an `InvalidOperation` error.
   *
   * Rejects with the **parsed API error body** (see {@link Client.#apiReq}) —
   * notably `ImportAlreadyInProgress` (one job per user at a time),
   * `TooManyServers` (server quota) and `OperationFailed` (feature disabled).
   * @param template Pasted link or code
   * @returns The new job's id
   */
  async importDiscordTemplate(template: string): Promise<{ job_id: string }> {
    return (await this.#apiReq("POST", "/import/discord/template", {
      template,
    })) as { job_id: string };
  }

  /**
   * Start the optional sticker-import step from a **Completed** template
   * import job. Requires the instance's importer bot to have been added to
   * the source guild first (the modal walks the user through it); until it
   * has, the job fails with an actionable message.
   *
   * No body: the guild id, target server and ownership are all resolved
   * server-side from the owner-scoped parent job.
   *
   * Rejects with the parsed API error body — notably
   * `ImportAlreadyInProgress` (one job per user), `InvalidOperation` (parent
   * not Completed / predates sticker support) and `OperationFailed` (bot
   * upgrade not configured).
   * @param jobId The Completed TEMPLATE job to import stickers for
   * @returns The NEW sticker job to follow
   */
  async importDiscordStickers(jobId: string): Promise<DiscordImportJobData> {
    return (await this.#apiReq(
      "POST",
      `/import/discord/jobs/${jobId}/stickers`,
    )) as DiscordImportJobData;
  }

  /**
   * Fetch one import job by id. Owner-scoped — 404 for anyone else.
   *
   * The reconnect-safe fallback for missed `discordImport*` events; poll this
   * while a job runs and stop the moment its status is terminal.
   * @param id Job id
   */
  async fetchDiscordImportJob(id: string): Promise<DiscordImportJobData> {
    return (await this.#apiReq(
      "GET",
      `/import/discord/jobs/${id}`,
    )) as DiscordImportJobData;
  }

  /**
   * Fetch the caller's `Queued`/`Running` import job, if any.
   *
   * Resolves to `null` when nothing is in flight — including when a job has
   * already finished, so a client that needs to recover a *completed* job's
   * invite must remember its id and use {@link fetchDiscordImportJob}.
   */
  async fetchActiveDiscordImportJob(): Promise<DiscordImportJobData | null> {
    return (await this.#apiReq(
      "GET",
      "/import/discord/active",
    )) as DiscordImportJobData | null;
  }

  /**
   * Raw request against a custom `/import` route.
   *
   * stoat-api's typed client silently drops the body of routes missing from
   * its generated tables (they arrive as `{}` and Rocket 422s), so these go
   * through `fetch` — the same pattern as `EventCollection.apiReq` and
   * `ChannelCollection.apiReq`.
   *
   * On a non-2xx this **throws the parsed JSON error body**, not an `Error`,
   * and the HTTP status is not preserved: callers branch on `error?.type`.
   */
  async #apiReq(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const api = this.api as unknown as {
      baseURL: string;
      auth: Record<string, string>;
    };

    const response = await fetch(api.baseURL + path, {
      method,
      headers: {
        ...api.auth,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      // Surface the typed error object when the body is JSON, else the raw text.
      let error: unknown = text;
      try {
        error = JSON.parse(text);
      } catch {
        /* keep the raw text */
      }
      throw error;
    }

    return response.status === 204 ? null : response.json();
  }
}
