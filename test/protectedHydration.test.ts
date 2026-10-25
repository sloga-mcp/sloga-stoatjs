/**
 * Protected-channel state from the server is one-way, and server text never
 * lands on a protected row (plan D1, D2, D25).
 *
 * - `protected` on a channel: Ready, ChannelCreate, ChannelUpdate,
 *   ServerCreate (for a cached server too) and `channels.fetch` apply
 *   `true` (onto a cached channel too), pin it and notify the adapter; an
 *   explicit `protected: false`, or a full object without `true` for a
 *   pinned channel, is reported as stripped and lowers nothing; a partial
 *   without the field (a rename) changes nothing and reports nothing.
 * - A row that carries `encrypted`, or sits in a protected or pinned channel,
 *   is stored without content, embeds, attachments, masquerade,
 *   interactions, components, system, replies, mentions, role mentions or
 *   the mass-mention flags, whether it arrives live or fetched.
 * - On such a row MessageUpdate applies only the pin state (no edit stamp),
 *   MessageAppend is dropped, and delete and reactions keep working.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/protectedHydration.test.ts
 *
 * To run the same cases against another `src/` tree, set `STOATJS_SRC`
 * (see loadSrc.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSrc } from "./loadSrc.ts";

type ClientModule = typeof import("../src/Client.ts");
type EventsModule = typeof import("../src/events/v1.ts");
type ProtectedModule = typeof import("../src/lib/protected.ts");
type StoatClient = InstanceType<ClientModule["Client"]>;

const { Client } = await loadSrc<ClientModule>("Client.ts");
const { handleEvent } = await loadSrc<EventsModule>("events/v1.ts");
const { ProtectedChannelEditRefused } =
  await loadSrc<ProtectedModule>("lib/protected.ts");

// Passing a configuration stops the constructor fetching `/` for one
const CONFIG = {
  revolt: "test",
  features: {
    autumn: { enabled: false, url: "" },
    january: { enabled: false, url: "" },
  },
  ws: "ws://127.0.0.1:9",
  app: "",
  vapid: "",
  build: {},
};

const ME = "01K6R000000000000000000001";
const OTHER = "01K6R000000000000000000002";
const SERVER = "01K6R000000000000000000003";
const CH = "01K6R000000000000000000004";
const CH2 = "01K6R000000000000000000005";
const PLAIN = "01K6R000000000000000000006";
const UNCACHED = "01K6R000000000000000000007";
const DM = "01K6R000000000000000000008";
const MSG = "01K6R000000000000000000009";
const MSG2 = "01K6R00000000000000000000A";
const ROLE = "01K6R00000000000000000000B";
const EMOJI = "01K6R00000000000000000000C";
const POLL = "01K6R00000000000000000000D";
const SHEET = "01K6R00000000000000000000E";

const FORGED = "forged server text";

const ENCRYPTED = {
  v: 1,
  group_id: "g",
  epoch: 3,
  sender_device_id: "d",
  nonce: "n",
  ciphertext: "c",
  sig: "s",
};

type ServerEvent = { type: string } & Record<string, unknown>;

type Harness = {
  client: StoatClient;
  emitted: string[];
  protectedIds: string[];
  strippedIds: string[];
  liveRows: string[];
  history: { channelId: string; ids: string[] }[];
  fire: (event: ServerEvent) => Promise<void>;
};

function noop(): void {}

function textChannel(id: string, extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    channel_type: "TextChannel",
    server: SERVER,
    name: `name-${id}`,
    ...extra,
  };
}

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

/**
 * A fresh offline client with an adapter stub that records every protected
 * hook. `pins` seeds this user's stored pins (read at Ready).
 */
function setup(pins: string[] = []): Harness {
  // Ready awaits the unread sync (syncUnreads), so every request answers
  // with an empty list instead of hanging
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )) as never;
  (globalThis as { localStorage?: unknown }).localStorage = memoryStorage({
    [`protected-channel-pins:${ME}`]: JSON.stringify(pins),
  });

  const client = new Client(
    { autoReconnect: false, syncUnreads: true },
    CONFIG as never,
  );

  const protectedIds: string[] = [];
  const strippedIds: string[] = [];
  const liveRows: string[] = [];
  const history: { channelId: string; ids: string[] }[] = [];
  client.e2ee = {
    isEncryptedMessage: () => false,
    onChannelProtected: (id: string) => void protectedIds.push(id),
    onProtectedFlagStripped: (id: string) => void strippedIds.push(id),
    onProtectedMessage: (message: { id: string }) =>
      void liveRows.push(message.id),
    decryptProtectedHistory: (
      channel: { id: string },
      messages: { id: string }[],
    ) =>
      void history.push({
        channelId: channel.id,
        ids: messages.map((m) => m.id),
      }),
  } as never;

  const emitted: string[] = [];
  const emit = client.emit.bind(client) as (
    name: string,
    ...args: unknown[]
  ) => unknown;
  (client as unknown as { emit: typeof emit }).emit = (name, ...args) => {
    emitted.push(name);
    return emit(name, ...args);
  };

  return {
    client,
    emitted,
    protectedIds,
    strippedIds,
    liveRows,
    history,
    fire: (event) => handleEvent(client, event as never, noop as never),
  };
}

const ME_USER = {
  _id: ME,
  username: "me",
  discriminator: "0001",
  relationship: "User",
  online: true,
};

/** Ready with this user, the server and the given channels. */
function ready(channels: unknown[]): ServerEvent {
  return {
    type: "Ready",
    users: [ME_USER],
    servers: [],
    channels,
    members: [],
    emojis: [],
  };
}

/** A protected row carrying every server-controlled field. */
function forgedRow(id: string, channel: string, extra = {}) {
  return {
    _id: id,
    channel,
    author: OTHER,
    content: FORGED,
    embeds: [{ type: "Text", description: FORGED }],
    attachments: [
      {
        _id: "a",
        tag: "attachments",
        filename: "f",
        metadata: { type: "File" },
        content_type: "text/plain",
        size: 1,
      },
    ],
    masquerade: { name: FORGED },
    interactions: { reactions: [EMOJI], restrict_reactions: true },
    components: [{ type: 1, components: [] }],
    system: { type: "text", content: FORGED },
    replies: [MSG2],
    mentions: [ME],
    role_mentions: [ROLE],
    // SuppressNotifications mask + MentionsEveryone + MentionsOnline bits
    flags: 1 | (1 << 2) | (1 << 3),
    poll: {
      id: POLL,
      question: FORGED,
      answers: [{ id: 0, text: FORGED }],
      expires_at: 0,
    },
    softres: { id: SHEET, title: FORGED },
    forwarded: {
      message_id: MSG2,
      channel_id: PLAIN,
      author_id: OTHER,
      content: FORGED,
      original_sent_at: "2026-01-01T00:00:00.000Z",
    },
    crosspost: { server_id: SERVER, channel_id: PLAIN, message_id: MSG2 },
    command_context: { name: FORGED, user: OTHER },
    webhook: { name: FORGED, avatar: null },
    thread_id: MSG2,
    ...extra,
  };
}

function rowState(client: StoatClient, id: string) {
  const raw = client.messages.getUnderlyingObject(id);
  return {
    content: raw.content,
    embeds: raw.embeds,
    attachments: raw.attachments,
    masquerade: raw.masquerade,
    interactions: raw.interactions,
    components: raw.components,
    systemMessage: raw.systemMessage,
    replyIds: raw.replyIds,
    mentionIds: raw.mentionIds,
    roleMentionIds: raw.roleMentionIds,
    flags: raw.flags,
    poll: raw.poll,
    softres: raw.softres,
    forwarded: raw.forwarded,
    crosspost: raw.crosspost,
    commandContext: raw.commandContext,
    webhook: raw.webhook,
    threadId: raw.threadId,
  };
}

const STRIPPED = {
  content: undefined,
  embeds: undefined,
  attachments: undefined,
  masquerade: undefined,
  interactions: undefined,
  components: undefined,
  systemMessage: undefined,
  replyIds: undefined,
  mentionIds: undefined,
  roleMentionIds: undefined,
  // Only the SuppressNotifications mask survives
  flags: 1,
  poll: undefined,
  softres: undefined,
  forwarded: undefined,
  crosspost: undefined,
  commandContext: undefined,
  webhook: undefined,
  threadId: undefined,
};

// --- D1: the channel flag ------------------------------------------------

test("Ready applies protected:true onto an already-cached channel and pins it", async () => {
  const h = setup();
  h.client.channels.getOrCreate(CH, textChannel(CH) as never);
  assert.equal(h.client.channels.get(CH)!.isProtected, false);

  await h.fire(ready([textChannel(CH, { protected: true })]));

  assert.equal(h.client.channels.get(CH)!.isProtected, true);
  assert.equal(h.client.protectedPins.has(CH), true);
  assert.equal(h.client.isProtectedChannel(CH), true);
  assert.deepEqual(h.protectedIds, [CH]);
  assert.deepEqual(h.strippedIds, []);
});

test("Ready loads the stored pins before the channels: a pinned channel without the flag is stripped", async () => {
  const h = setup([CH2]);
  await h.fire(ready([textChannel(CH2), textChannel(PLAIN)]));

  assert.equal(h.client.isProtectedChannel(CH2), true, "the pin holds");
  assert.equal(h.client.channels.get(CH2)!.isProtected, false);
  assert.deepEqual(h.strippedIds, [CH2]);
  assert.equal(h.client.isProtectedChannel(PLAIN), false);
});

test("ChannelUpdate protected:false cannot unset the flag and reports a strip", async () => {
  const h = setup();
  await h.fire({
    type: "ChannelCreate",
    ...textChannel(CH, { protected: true }),
  });
  assert.equal(h.client.channels.get(CH)!.isProtected, true);

  await h.fire({ type: "ChannelUpdate", id: CH, data: { protected: false } });

  assert.equal(h.client.channels.get(CH)!.isProtected, true);
  assert.equal(h.client.isProtectedChannel(CH), true);
  assert.deepEqual(h.strippedIds, [CH]);
});

test("a rename partial without protected changes the name and reports no strip", async () => {
  const h = setup();
  await h.fire({
    type: "ChannelCreate",
    ...textChannel(CH, { protected: true }),
  });

  await h.fire({ type: "ChannelUpdate", id: CH, data: { name: "renamed" } });

  assert.equal(h.client.channels.get(CH)!.name, "renamed");
  assert.equal(h.client.channels.get(CH)!.isProtected, true);
  assert.deepEqual(h.strippedIds, []);
});

test("ChannelUpdate protected:true sets, pins and notifies; ChannelCreate applies onto a cached channel", async () => {
  const h = setup();
  h.client.channels.getOrCreate(CH, textChannel(CH) as never);
  h.client.channels.getOrCreate(CH2, textChannel(CH2) as never);

  await h.fire({ type: "ChannelUpdate", id: CH, data: { protected: true } });
  await h.fire({
    type: "ChannelCreate",
    ...textChannel(CH2, { protected: true }),
  });

  for (const id of [CH, CH2]) {
    assert.equal(h.client.channels.get(id)!.isProtected, true, id);
    assert.equal(h.client.protectedPins.has(id), true, id);
  }
  assert.deepEqual(h.protectedIds, [CH, CH2]);
});

test("a full ChannelCreate without the flag for a pinned channel is a strip", async () => {
  const h = setup([CH]);
  await h.fire(ready([]));
  await h.fire({ type: "ChannelCreate", ...textChannel(CH) });
  assert.deepEqual(h.strippedIds, [CH]);
  assert.equal(h.client.isProtectedChannel(CH), true);
});

/** A ServerCreate for SERVER carrying the given full channel objects. */
function serverCreate(channels: { _id: string }[]): ServerEvent {
  return {
    type: "ServerCreate",
    id: SERVER,
    server: {
      _id: SERVER,
      owner: OTHER,
      name: "server",
      channels: channels.map((channel) => channel._id),
      default_permissions: 0,
      roles: {},
    },
    channels,
    emojis: [],
    voice_states: [],
  };
}

test("ServerCreate with a protected channel pins it and notifies onChannelProtected (W4d F#2)", async () => {
  const h = setup();
  await h.fire(ready([]));

  await h.fire(
    serverCreate([textChannel(CH, { protected: true }), textChannel(PLAIN)]),
  );

  assert.equal(h.client.servers.has(SERVER), true);
  assert.equal(h.client.channels.get(CH)!.isProtected, true);
  assert.equal(h.client.protectedPins.has(CH), true);
  assert.equal(h.client.isProtectedChannel(CH), true);
  assert.deepEqual(h.protectedIds, [CH]);
  assert.deepEqual(h.strippedIds, []);
  assert.equal(h.client.isProtectedChannel(PLAIN), false);
});

test("a full ServerCreate channel without the flag for a pinned id is a strip (W4d F#2)", async () => {
  const h = setup([CH2]);
  await h.fire(ready([]));

  await h.fire(serverCreate([textChannel(CH2), textChannel(PLAIN)]));

  assert.deepEqual(h.strippedIds, [CH2]);
  assert.equal(h.client.isProtectedFlagStripped(CH2), true);
  assert.equal(h.client.isProtectedChannel(CH2), true, "the pin holds");
  assert.equal(h.client.channels.get(CH2)!.isProtected, false);
  assert.equal(h.client.isProtectedFlagStripped(PLAIN), false);
  assert.deepEqual(h.protectedIds, []);
});

test("ServerCreate applies the flag when a join response already cached the server (W4d F#2)", async () => {
  const h = setup();
  await h.fire(ready([]));
  // What PublicInvite.join / DiscoverableServer.join cache before the event
  const event = serverCreate([textChannel(CH, { protected: true })]);
  h.client.channels.getOrCreate(
    CH,
    textChannel(CH, { protected: true }) as never,
  );
  h.client.servers.getOrCreate(SERVER, event.server as never, true);
  assert.equal(h.client.protectedPins.has(CH), false);
  assert.deepEqual(h.protectedIds, []);

  await h.fire(event);

  assert.equal(h.client.protectedPins.has(CH), true);
  assert.deepEqual(h.protectedIds, [CH]);
});

test("channels.fetch applies the flag from its raw GET: true pins, a pinned id without it is a strip (W4d F#2)", async () => {
  const h = setup([CH2]);
  await h.fire(ready([]));
  const bodies: Record<string, unknown> = {
    [`/channels/${CH}`]: textChannel(CH, { protected: true }),
    [`/channels/${CH2}`]: textChannel(CH2),
  };
  (h.client.api as unknown as { get: unknown }).get = (path: string) =>
    Promise.resolve(bodies[path]);

  await h.client.channels.fetch(CH);
  await h.client.channels.fetch(CH2);

  assert.equal(h.client.channels.get(CH)!.isProtected, true);
  assert.equal(h.client.protectedPins.has(CH), true);
  assert.deepEqual(h.protectedIds, [CH]);
  assert.deepEqual(h.strippedIds, [CH2]);
  assert.equal(h.client.isProtectedChannel(CH2), true, "the pin holds");
});

/** Asserts CH is pinned + notified and the pinned CH2 is reported stripped. */
function assertFlagApplied(h: Harness, path: string): void {
  assert.equal(h.client.channels.get(CH)!.isProtected, true, path);
  assert.equal(h.client.protectedPins.has(CH), true, path);
  assert.deepEqual(h.protectedIds, [CH], path);
  assert.deepEqual(h.strippedIds, [CH2], path);
  assert.equal(h.client.isProtectedChannel(CH2), true, `${path}: pin holds`);
  assert.equal(h.client.isProtectedChannel(PLAIN), false, path);
}

const FLAGGED_CHANNELS = () => [
  textChannel(CH, { protected: true }),
  textChannel(CH2),
  textChannel(PLAIN),
];

test("servers.fetch applies the flag to the channels it caches (W4d)", async () => {
  const h = setup([CH2]);
  await h.fire(ready([]));
  const server = serverCreate(FLAGGED_CHANNELS()).server as object;
  (h.client.api as unknown as { get: unknown }).get = () =>
    Promise.resolve({ ...server, channels: FLAGGED_CHANNELS() });

  await h.client.servers.fetch(SERVER);

  assert.equal(h.client.servers.has(SERVER), true);
  assertFlagApplied(h, "servers.fetch");
});

test("servers.createServer applies the flag to the channels it caches (W4d)", async () => {
  const h = setup([CH2]);
  await h.fire(ready([]));
  const event = serverCreate(FLAGGED_CHANNELS());
  (h.client.api as unknown as { post: unknown }).post = () =>
    Promise.resolve({ server: event.server, channels: FLAGGED_CHANNELS() });

  await h.client.servers.createServer({ name: "server" } as never);

  assert.equal(h.client.servers.has(SERVER), true);
  assertFlagApplied(h, "createServer");
});

test("server.createChannel applies the flag to the channel it caches (W4d)", async () => {
  const h = setup([CH2]);
  await h.fire(ready([]));
  await h.fire(serverCreate([]));
  const server = h.client.servers.get(SERVER)!;
  const bodies = FLAGGED_CHANNELS();
  (h.client.api as unknown as { post: unknown }).post = () =>
    Promise.resolve(bodies.shift());

  for (let i = 0; i < 3; i++) {
    await server.createChannel({ name: "c", type: "Text" } as never);
  }

  assertFlagApplied(h, "createChannel");
});

test("the strip latch: set by protected:false, kept by a rename, cleared by true", async () => {
  const h = setup();
  await h.fire({
    type: "ChannelCreate",
    ...textChannel(CH, { protected: true }),
  });
  assert.equal(h.client.isProtectedFlagStripped(CH), false);

  await h.fire({ type: "ChannelUpdate", id: CH, data: { name: "renamed" } });
  assert.equal(
    h.client.isProtectedFlagStripped(CH),
    false,
    "rename sets nothing",
  );

  await h.fire({ type: "ChannelUpdate", id: CH, data: { protected: false } });
  assert.equal(h.client.isProtectedFlagStripped(CH), true);

  await h.fire({ type: "ChannelUpdate", id: CH, data: { name: "again" } });
  assert.equal(
    h.client.isProtectedFlagStripped(CH),
    true,
    "rename clears nothing",
  );

  await h.fire({ type: "ChannelUpdate", id: CH, data: { protected: true } });
  assert.equal(h.client.isProtectedFlagStripped(CH), false);
});

test("the strip latch: a full Ready object without the flag sets it for a pinned channel only", async () => {
  const h = setup([CH2]);
  await h.fire(ready([textChannel(CH2), textChannel(PLAIN)]));
  assert.equal(h.client.isProtectedFlagStripped(CH2), true);
  assert.equal(h.client.isProtectedFlagStripped(PLAIN), false);

  await h.fire(ready([textChannel(CH2, { protected: true })]));
  assert.equal(h.client.isProtectedFlagStripped(CH2), false);
});

test("poll and sheet state events never stamp a protected row", async () => {
  const h = await protectedRowHarness();
  await h.fire({
    type: "PollVoteUpdate",
    id: POLL,
    message_id: MSG,
    channel_id: CH,
    counts: { 0: 9 },
    total_votes: 9,
  });
  await h.fire({
    type: "SoftresSheetUpdate",
    id: SHEET,
    message_id: MSG,
    channel_id: CH,
    sheet: { id: SHEET },
  });
  const raw = h.client.messages.getUnderlyingObject(MSG);
  assert.equal(raw.pollState, undefined);
  assert.equal(raw.softresState, undefined);
  h.client.messages.get(MSG)!.applyPollState({ id: POLL } as never);
  assert.equal(h.client.messages.getUnderlyingObject(MSG).pollState, undefined);
  assert.deepEqual(h.emitted, []);
});

test("a protected flag on a DM is ignored", async () => {
  const h = setup();
  await h.fire({
    type: "ChannelCreate",
    _id: DM,
    channel_type: "DirectMessage",
    active: true,
    recipients: [ME, OTHER],
    protected: true,
  });
  assert.equal(h.client.isProtectedChannel(DM), false);
  assert.deepEqual(h.protectedIds, []);
});

// --- D25: server text stripped -------------------------------------------

test("a live row in a protected channel is stored without server text and handed to the adapter", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));

  await h.fire({
    type: "Message",
    ...forgedRow(MSG, CH, { encrypted: ENCRYPTED }),
  });

  assert.deepEqual(rowState(h.client, MSG), STRIPPED);
  const message = h.client.messages.get(MSG)!;
  assert.equal(message.content, "");
  assert.deepEqual(message.encrypted, ENCRYPTED);
  assert.deepEqual(h.liveRows, [MSG]);

  // Server mentions never reach unread state
  const unread = h.client.channelUnreads.for(h.client.channels.get(CH)!);
  assert.equal(unread.messageMentionIds.has(MSG), false);
  assert.equal(unread.unreadHasAttachments, false);
});

test("a row in a pinned channel without encrypted is stripped too", async () => {
  const h = setup([CH2]);
  await h.fire(ready([textChannel(CH2)]));
  await h.fire({ type: "Message", ...forgedRow(MSG, CH2) });
  assert.deepEqual(rowState(h.client, MSG), STRIPPED);
});

test("an encrypted row in an uncached channel keeps no server mentions or text", async () => {
  const h = setup();
  await h.fire(ready([]));
  h.client.user = h.client.users.get(ME);
  assert.equal(h.client.isProtectedChannel(UNCACHED), false);

  await h.fire({
    type: "Message",
    ...forgedRow(MSG, UNCACHED, { encrypted: ENCRYPTED }),
  });

  assert.deepEqual(rowState(h.client, MSG), STRIPPED);
  assert.deepEqual(h.client.messages.get(MSG)!.encrypted, ENCRYPTED);
  assert.equal(h.client.messages.get(MSG)!.mentioned, false);
});

test("fetched protected rows are stripped and passed to decryptProtectedHistory", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));
  (h.client.api as unknown as { get: unknown }).get = () =>
    Promise.resolve([forgedRow(MSG, CH, { encrypted: ENCRYPTED })]);

  const rows = await h.client.channels.get(CH)!.fetchMessages();

  assert.deepEqual(
    rows.map((row) => row.id),
    [MSG],
  );
  assert.deepEqual(rowState(h.client, MSG), STRIPPED);
  assert.deepEqual(h.history, [{ channelId: CH, ids: [MSG] }]);
});

test("control: a plaintext row in an ordinary channel keeps its fields", async () => {
  const h = setup();
  await h.fire(ready([textChannel(PLAIN)]));
  await h.fire({ type: "Message", ...forgedRow(MSG, PLAIN) });

  const state = rowState(h.client, MSG);
  assert.equal(state.content, FORGED);
  assert.deepEqual(state.mentionIds, [ME]);
  assert.deepEqual(state.replyIds, [MSG2]);
  assert.equal(state.flags, 1 | (1 << 2) | (1 << 3));
  assert.equal(state.forwarded?.content, FORGED);
  assert.equal(state.poll?.question, FORGED);
  assert.equal(state.threadId, MSG2);
  assert.deepEqual(h.liveRows, []);
});

// --- D2: events on protected rows ----------------------------------------

async function protectedRowHarness(): Promise<Harness> {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));
  await h.fire({
    type: "Message",
    ...forgedRow(MSG, CH, { encrypted: ENCRYPTED }),
  });
  h.emitted.length = 0;
  return h;
}

test("MessageUpdate on a protected row applies only pinned, with no edit stamp", async () => {
  const h = await protectedRowHarness();

  await h.fire({
    type: "MessageUpdate",
    id: MSG,
    channel: CH,
    data: {
      pinned: true,
      content: FORGED,
      embeds: [{ type: "Text", description: FORGED }],
      edited: new Date().toISOString(),
    },
  });

  const message = h.client.messages.get(MSG)!;
  assert.equal(message.pinned, true);
  assert.equal(message.content, "");
  assert.equal(message.embeds, undefined);
  assert.equal(message.editedAt, undefined);
  assert.deepEqual(h.emitted, ["messageUpdate"]);

  await h.fire({
    type: "MessageUpdate",
    id: MSG,
    channel: CH,
    data: {},
    clear: ["Pinned"],
  });
  assert.equal(message.pinned, false);
  assert.equal(message.editedAt, undefined);
});

test("MessageUpdate on a protected row without a pin change does nothing", async () => {
  const h = await protectedRowHarness();
  await h.fire({
    type: "MessageUpdate",
    id: MSG,
    channel: CH,
    data: { content: FORGED },
  });
  assert.equal(h.client.messages.get(MSG)!.content, "");
  assert.deepEqual(h.emitted, []);
});

test("MessageAppend on a protected row is dropped", async () => {
  const h = await protectedRowHarness();
  await h.fire({
    type: "MessageAppend",
    id: MSG,
    channel: CH,
    append: { embeds: [{ type: "Text", description: FORGED }] },
  });
  assert.equal(h.client.messages.get(MSG)!.embeds, undefined);
  assert.deepEqual(h.emitted, []);
});

test("reactions and delete keep their normal behaviour on a protected row", async () => {
  const h = await protectedRowHarness();

  await h.fire({
    type: "MessageReact",
    id: MSG,
    channel_id: CH,
    user_id: OTHER,
    emoji_id: EMOJI,
  });
  assert.equal(
    h.client.messages.get(MSG)!.reactions.get(EMOJI)?.has(OTHER),
    true,
  );

  await h.fire({ type: "MessageDelete", id: MSG, channel: CH });
  assert.equal(h.client.messages.has(MSG), false);
  assert.deepEqual(h.emitted, [
    "messageReactionAdd",
    "messageDeleteId",
    "messageDelete",
  ]);
});

test("Message.edit refuses a protected row without a request", async () => {
  const h = await protectedRowHarness();
  const requests: string[] = [];
  (h.client.api as unknown as { patch: unknown }).patch = (path: string) => {
    requests.push(path);
    return Promise.resolve(undefined);
  };

  await assert.rejects(
    h.client.messages.get(MSG)!.edit({ content: "x" }),
    (error: unknown) => error instanceof ProtectedChannelEditRefused,
  );
  assert.deepEqual(requests, []);
});
