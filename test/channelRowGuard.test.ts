/**
 * A message row belongs to one channel, and the server does not get to pick
 * another one for it (S4-W4 audit A1, A2, A7).
 *
 * - A fetch of a channel stores and answers rows of that channel only. A row
 *   that names another channel is dropped before it is hydrated, and an id
 *   already cached under another channel is not handed back. Rows are
 *   stripped by the channel they name, so before this a server could answer
 *   a fetch of a protected channel with rows naming an ordinary one and have
 *   their text render there as ordinary messages.
 * - `MessageUpdate` and `MessageAppend` go by the channel the cached row is
 *   stored under. An event that names another channel is dropped, and no
 *   update moves a row to another channel.
 * - `Client.clearPreProtectReveal` withdraws a reveal and strips the rows it
 *   covered without latching anything.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/channelRowGuard.test.ts
 *
 * To run the same cases against another `src/` tree, set `STOATJS_SRC`
 * (see loadSrc.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSrc } from "./loadSrc.ts";

type ClientModule = typeof import("../src/Client.ts");
type EventsModule = typeof import("../src/events/v1.ts");
type HistoryModule = typeof import("../src/lib/protectedHistory.ts");
type StoatClient = InstanceType<ClientModule["Client"]>;

const { Client } = await loadSrc<ClientModule>("Client.ts");
const { handleEvent } = await loadSrc<EventsModule>("events/v1.ts");
const { ProtectedHistoryState } = await loadSrc<HistoryModule>(
  "lib/protectedHistory.ts",
);

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

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID with the given time and a 16-character tail. */
function ulidAt(ms: number, tail: string): string {
  let time = "";
  let rest = ms;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[rest % 32] + time;
    rest = Math.floor(rest / 32);
  }
  return time + tail.padStart(16, "0");
}

const ME = "01K6S000000000000000000001";
const OTHER = "01K6S000000000000000000002";
const SERVER = "01K6S000000000000000000003";
/** Protected. */
const X = "01K6S000000000000000000004";
/** Ordinary. */
const Z = "01K6S000000000000000000005";
/** Ordinary. */
const W = "01K6S000000000000000000006";
/** Protected. */
const X2 = "01K6S000000000000000000007";
/** Not in the cache. */
const NOWHERE = "01K6S00000000000000000000Z";

/** The moment X was protected. */
const T = 1_700_000_000_000;
/** The boundary: the last message written before X was protected. */
const B = ulidAt(T, "5");
const OLD = ulidAt(T - 1000, "1");
const OLD2 = ulidAt(T - 2000, "2");
const OLD3 = ulidAt(T - 3000, "3");
const OLD_ENC = ulidAt(T - 4000, "4");
const OLD5 = ulidAt(T - 5000, "5");
const NEW = ulidAt(T + 1000, "1");
const NEW2 = ulidAt(T + 2000, "2");
const NEW3 = ulidAt(T + 3000, "3");

const REVEAL = { boundary: B, timeLimit: T };

const TEXT = "server text";
const ATTACK = "text the server chose";

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
  /** `[id, channelId]` of every row handed to the adapter, per call. */
  handed: [string, string][][];
  fire: (event: ServerEvent) => Promise<void>;
  /** Answer of every `api.get` from now on. */
  serveGet: (answer: unknown) => void;
  /** Answer of every `api.post` from now on. */
  servePost: (answer: unknown) => void;
  /** Answer of every raw `fetch` from now on. */
  serveRaw: (answer: unknown) => void;
};

function noop(): void {}

/** A fresh offline client with an adapter stub. */
function setup(options: Record<string, unknown> = {}): Harness {
  const data = new Map<string, string>();
  const raw = (answer: unknown) => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(answer), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )) as never;
  };
  raw([]);
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };

  const client = new Client(
    { autoReconnect: false, syncUnreads: true, ...options },
    CONFIG as never,
  );

  const handed: [string, string][][] = [];
  client.e2ee = {
    isEncryptedMessage: () => false,
    onChannelProtected: noop,
    onProtectedFlagStripped: noop,
    onProtectedMessage: noop,
    decryptProtectedHistory: (
      _channel: unknown,
      rows: { id: string; channelId: string }[],
    ) => void handed.push(rows.map((row) => [row.id, row.channelId])),
    onEvent: noop,
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
    handed,
    fire: (event) => handleEvent(client, event as never, noop as never),
    serveGet: (answer) => {
      (client.api as unknown as { get: unknown }).get = () =>
        Promise.resolve(answer);
    },
    servePost: (answer) => {
      (client.api as unknown as { post: unknown }).post = () =>
        Promise.resolve(answer);
    },
    serveRaw: raw,
  };
}

function textChannel(id: string, extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    channel_type: "TextChannel",
    server: SERVER,
    name: `name-${id}`,
    ...extra,
  };
}

function ready(channels: unknown[]): ServerEvent {
  return {
    type: "Ready",
    users: [
      {
        _id: ME,
        username: "me",
        discriminator: "0001",
        relationship: "User",
        online: true,
      },
    ],
    servers: [],
    channels,
    members: [],
    emojis: [],
  };
}

/** A wire row with server text. */
function row(id: string, channel: string, extra = {}) {
  return { _id: id, channel, author: OTHER, content: TEXT, ...extra };
}

/**
 * X and X2 protected, Z and W ordinary, with the current user set.
 */
async function world(options: Record<string, unknown> = {}): Promise<Harness> {
  const h = setup(options);
  await h.fire(
    ready([
      textChannel(X, { protected: true }),
      textChannel(X2, { protected: true }),
      textChannel(Z),
      textChannel(W),
    ]),
  );
  h.client.user = h.client.users.get(ME);
  assert.equal(h.client.isProtectedChannel(X), true);
  assert.equal(h.client.isProtectedChannel(Z), false);
  h.emitted.length = 0;
  return h;
}

function channel(h: Harness, id: string) {
  return h.client.channels.get(id)!;
}

/** `[id, channelId, content]` of rows, in order. */
function shape(rows: { id: string; channelId: string; content: string }[]) {
  return rows.map((message) => [
    message.id,
    message.channelId,
    message.content,
  ]);
}

function cachedIds(client: StoatClient): string[] {
  return [...client.messages.keys()].sort();
}

/** What a stored row holds, straight from the store. */
function stored(client: StoatClient, id: string) {
  const raw = client.messages.getUnderlyingObject(id);
  return {
    channelId: raw.channelId,
    content: raw.content,
    embeds: raw.embeds?.length,
    pinned: raw.pinned,
    edited: raw.editedAt !== undefined,
  };
}

/** Rows a hostile server answers a fetch of X with: two foreign, one own. */
const INJECTED = [
  row(NEW, Z, { content: ATTACK }),
  row(NEW2, NOWHERE, { content: ATTACK }),
  row(NEW3, X),
];

// --- A1: fetch paths ------------------------------------------------------

test("fetchMessagesWithUsers of a protected channel drops the rows that name another channel", async () => {
  const h = await world();
  h.serveGet({ messages: INJECTED, users: [] });

  const result = await channel(h, X).fetchMessagesWithUsers({ limit: 50 });

  // Only the row of X comes back, without its server text
  assert.deepEqual(shape(result.messages), [[NEW3, X, ""]]);
  // The foreign rows were never stored, under any channel
  assert.deepEqual(cachedIds(h.client), [NEW3]);
  assert.deepEqual(h.handed, [[[NEW3, X]]]);
});

test("fetchMessages of a protected channel drops the rows that name another channel", async () => {
  const h = await world();
  h.serveGet(INJECTED);

  const rows = await channel(h, X).fetchMessages({ limit: 50 });

  assert.deepEqual(shape(rows), [[NEW3, X, ""]]);
  assert.deepEqual(cachedIds(h.client), [NEW3]);
  assert.deepEqual(h.handed, [[[NEW3, X]]]);
});

test("search of a protected channel drops the rows that name another channel", async () => {
  const h = await world();
  h.servePost(INJECTED);

  const rows = await channel(h, X).search({ pinned: true } as never);

  assert.deepEqual(shape(rows), [[NEW3, X, ""]]);
  assert.deepEqual(cachedIds(h.client), [NEW3]);
});

test("searchWithUsers of a protected channel drops the rows that name another channel", async () => {
  const h = await world();
  h.servePost({ messages: INJECTED, users: [] });

  const result = await channel(h, X).searchWithUsers({
    pinned: true,
  } as never);

  assert.deepEqual(shape(result.messages), [[NEW3, X, ""]]);
  assert.deepEqual(cachedIds(h.client), [NEW3]);
});

test("fetchMessage rejects a row that names another channel and stores nothing", async () => {
  const h = await world();
  h.serveGet(row(NEW, Z, { content: ATTACK }));

  await assert.rejects(channel(h, X).fetchMessage(NEW), {
    message: "Message is not in this channel",
  });
  assert.deepEqual(cachedIds(h.client), []);
  assert.deepEqual(h.handed, []);

  // The channel's own row still comes back
  h.serveGet(row(NEW3, X));
  const own = await channel(h, X).fetchMessage(NEW3);
  assert.deepEqual(shape([own]), [[NEW3, X, ""]]);
});

test("messages.fetch rejects a row that names another channel and stores nothing", async () => {
  const h = await world();
  h.serveGet(row(NEW, Z, { content: ATTACK }));

  await assert.rejects(h.client.messages.fetch(X, NEW), {
    message: "Message is not in this channel",
  });
  assert.deepEqual(cachedIds(h.client), []);

  h.serveGet(row(NEW3, X));
  assert.deepEqual(shape([await h.client.messages.fetch(X, NEW3)]), [
    [NEW3, X, ""],
  ]);
});

test("messages.fetch rejects an id that is cached under another channel", async () => {
  const h = await world();
  h.serveGet([row(NEW, Z, { content: ATTACK })]);
  await channel(h, Z).fetchMessages();
  assert.equal(h.client.messages.get(NEW)!.content, ATTACK);

  await assert.rejects(h.client.messages.fetch(X, NEW), {
    message: "Message is not in this channel",
  });
  // Asked for under its own channel, the cached row is answered
  assert.equal((await h.client.messages.fetch(Z, NEW)).content, ATTACK);
});

test("a fetch never hands back an id that is already cached under another channel", async () => {
  const h = await world();
  h.serveGet([row(NEW, Z, { content: ATTACK })]);
  await channel(h, Z).fetchMessages();

  // The same id, now claimed for X: the cached row of Z must not come back
  h.serveGet({ messages: [row(NEW, X), row(NEW3, X)], users: [] });
  const result = await channel(h, X).fetchMessagesWithUsers();
  assert.deepEqual(shape(result.messages), [[NEW3, X, ""]]);

  h.serveGet(row(NEW, X));
  await assert.rejects(channel(h, X).fetchMessage(NEW));

  // The row of Z is where and what it was
  assert.deepEqual(shape([h.client.messages.get(NEW)!]), [[NEW, Z, ATTACK]]);
});

test("the fetch guard holds for an ordinary channel too", async () => {
  const h = await world();
  h.serveGet([row(NEW, W, { content: ATTACK }), row(NEW2, X), row(NEW3, Z)]);

  const rows = await channel(h, Z).fetchMessages();

  assert.deepEqual(shape(rows), [[NEW3, Z, TEXT]]);
  assert.deepEqual(cachedIds(h.client), [NEW3]);
});

test("a row that names another channel cannot use the reveal", async () => {
  const h = await world();
  h.client.revealPreProtectRows(X, REVEAL);

  // A fetch of an ordinary channel answering a pre-boundary row of X
  h.serveGet([row(OLD, X, { content: ATTACK })]);
  assert.deepEqual(shape(await channel(h, Z).fetchMessages()), []);
  // A fetch of X answering a pre-boundary row that names Z
  h.serveGet([row(OLD2, Z, { content: ATTACK }), row(OLD3, X)]);
  assert.deepEqual(shape(await channel(h, X).fetchMessages()), [
    [OLD3, X, TEXT],
  ]);
  // A fetch of another protected channel answering a row of X
  h.serveGet([row(OLD, X, { content: ATTACK })]);
  assert.deepEqual(shape(await channel(h, X2).fetchMessages()), []);

  assert.deepEqual(cachedIds(h.client), [OLD3]);
});

test("a fetched row replaces a cached partial whole", async () => {
  const h = await world({ partials: true });
  // With partials on, an update for a row that is not cached creates one
  await h.fire({
    type: "MessageUpdate",
    id: NEW,
    channel: Z,
    data: { content: ATTACK },
  });
  assert.equal(h.client.messages.get(NEW)!.content, ATTACK);

  // The fetched row carries no content of its own
  h.serveGet([{ _id: NEW, channel: X, author: OTHER }]);
  const rows = await channel(h, X).fetchMessages();

  assert.deepEqual(shape(rows), [[NEW, X, ""]]);
  assert.equal(stored(h.client, NEW).edited, false);
});

test("fetchPosts drops starter and last messages of a protected channel", async () => {
  const h = await world();
  h.client.revealPreProtectRows(X, REVEAL);
  // A row of X that is already cached, and one that is not
  h.serveGet([row(OLD3, X)]);
  await channel(h, X).fetchMessages();

  h.serveRaw({
    posts: [],
    starters: [row(OLD, X, { content: ATTACK }), row(NEW, W)],
    // The second one names W but its id is cached under X
    last_messages: [row(OLD3, X), row(OLD3, W), row(NEW2, W)],
  });
  const page = await channel(h, Z).fetchPosts({
    includeStarters: true,
    includeStats: true,
  });

  assert.deepEqual(shape(page.starters!), [[NEW, W, TEXT]]);
  assert.deepEqual(shape(page.lastMessages), [[NEW2, W, TEXT]]);
  assert.equal(h.client.messages.has(OLD), false);
});

// --- A2: events that change a cached row ----------------------------------

test("MessageUpdate that names another channel is dropped: a row of a protected channel keeps its channel and takes no text", async () => {
  const h = await world();
  h.serveGet([row(NEW, X)]);
  await channel(h, X).fetchMessages();
  const before = stored(h.client, NEW);
  h.emitted.length = 0;

  await h.fire({
    type: "MessageUpdate",
    id: NEW,
    channel: Z,
    data: { content: ATTACK, pinned: true },
  });
  await h.fire({
    type: "MessageUpdate",
    id: NEW,
    channel: NOWHERE,
    data: { content: ATTACK },
  });

  assert.deepEqual(stored(h.client, NEW), before);
  assert.equal(before.channelId, X);
  assert.equal(h.client.messages.get(NEW)!.content, "");
  assert.deepEqual(h.emitted, []);
});

test("MessageUpdate that names another channel is dropped for a row of an ordinary channel too", async () => {
  const h = await world();
  h.serveGet([row(NEW, Z)]);
  await channel(h, Z).fetchMessages();
  const before = stored(h.client, NEW);
  h.emitted.length = 0;

  // Naming a protected channel would otherwise pick the pin-only rules,
  // naming an ordinary one would move the row
  for (const named of [X, W]) {
    await h.fire({
      type: "MessageUpdate",
      id: NEW,
      channel: named,
      data: { content: ATTACK, pinned: true },
    });
  }

  assert.deepEqual(stored(h.client, NEW), before);
  assert.deepEqual(h.emitted, []);
});

test("MessageUpdate whose data carries a channel never moves the row", async () => {
  const h = await world();
  h.serveGet([row(NEW, Z)]);
  await channel(h, Z).fetchMessages();
  h.serveGet([row(NEW2, X)]);
  await channel(h, X).fetchMessages();

  await h.fire({
    type: "MessageUpdate",
    id: NEW,
    channel: Z,
    data: { content: "edited", channel: X },
  });
  await h.fire({
    type: "MessageUpdate",
    id: NEW2,
    channel: X,
    data: { content: ATTACK, channel: Z, pinned: true },
  });

  // The ordinary row takes the edit and stays in Z
  assert.deepEqual(stored(h.client, NEW), {
    channelId: Z,
    content: "edited",
    embeds: undefined,
    pinned: undefined,
    edited: true,
  });
  // The protected row takes the pin only and stays in X
  assert.deepEqual(stored(h.client, NEW2), {
    channelId: X,
    content: undefined,
    embeds: undefined,
    pinned: true,
    edited: false,
  });
});

test("MessageAppend that names another channel is dropped: no embed lands and the row does not move", async () => {
  const h = await world();
  h.serveGet([row(NEW, X)]);
  await channel(h, X).fetchMessages();
  h.serveGet([row(NEW2, Z)]);
  await channel(h, Z).fetchMessages();
  h.emitted.length = 0;

  for (const [id, named] of [
    [NEW, Z],
    [NEW, NOWHERE],
    [NEW2, W],
    [NEW2, X],
  ]) {
    await h.fire({
      type: "MessageAppend",
      id,
      channel: named,
      append: { embeds: [{ type: "Text", description: ATTACK }] },
    });
  }

  assert.equal(stored(h.client, NEW).channelId, X);
  assert.equal(stored(h.client, NEW).embeds, undefined);
  assert.equal(stored(h.client, NEW2).channelId, Z);
  assert.equal(stored(h.client, NEW2).embeds, undefined);
  assert.deepEqual(h.emitted, []);
});

test("control: an update and an append that name the row's own channel still land on an ordinary row", async () => {
  const h = await world();
  h.serveGet([row(NEW, Z)]);
  await channel(h, Z).fetchMessages();
  h.emitted.length = 0;

  await h.fire({
    type: "MessageUpdate",
    id: NEW,
    channel: Z,
    data: { content: "edited" },
  });
  await h.fire({
    type: "MessageAppend",
    id: NEW,
    channel: Z,
    append: { embeds: [{ type: "Text", description: "late embed" }] },
  });

  assert.deepEqual(stored(h.client, NEW), {
    channelId: Z,
    content: "edited",
    embeds: 1,
    pinned: undefined,
    edited: true,
  });
  assert.deepEqual(h.emitted, ["messageUpdate", "messageUpdate"]);
});

test("a partial without a channel takes the channel of its first event and then keeps it", async () => {
  const h = await world({ partials: true });

  await h.fire({
    type: "MessageAppend",
    id: NEW,
    channel: Z,
    append: { embeds: [{ type: "Text", description: "late embed" }] },
  });
  assert.equal(stored(h.client, NEW).channelId, Z);
  assert.equal(stored(h.client, NEW).embeds, 1);

  await h.fire({
    type: "MessageAppend",
    id: NEW,
    channel: W,
    append: { embeds: [{ type: "Text", description: ATTACK }] },
  });
  await h.fire({
    type: "MessageUpdate",
    id: NEW,
    channel: W,
    data: { content: ATTACK },
  });
  assert.equal(stored(h.client, NEW).channelId, Z);
  assert.equal(stored(h.client, NEW).embeds, 1);
  assert.equal(stored(h.client, NEW).content, undefined);
});

// --- A7: withdrawing a reveal without a latch -----------------------------

/** X revealed, holding two revealed rows, an encrypted row and a new row. */
async function revealed(): Promise<Harness> {
  const h = await world();
  h.client.revealPreProtectRows(X, REVEAL);
  h.client.revealPreProtectRows(X2, REVEAL);
  h.serveGet([
    row(OLD, X),
    row(OLD2, X),
    row(OLD_ENC, X, { encrypted: ENCRYPTED }),
    row(NEW, X),
  ]);
  await channel(h, X).fetchMessages();
  h.serveGet([row(OLD3, X2)]);
  await channel(h, X2).fetchMessages();
  h.serveGet([row(NEW2, Z)]);
  await channel(h, Z).fetchMessages();

  assert.deepEqual(
    [OLD, OLD2, OLD_ENC, NEW, OLD3, NEW2].map(
      (id) => stored(h.client, id).content,
    ),
    [TEXT, TEXT, undefined, undefined, TEXT, TEXT],
  );
  return h;
}

test("clearPreProtectReveal removes the reveal and strips the rows it covered, removing none", async () => {
  const h = await revealed();
  const payload = h.client.messages.getUnderlyingObject(OLD_ENC).encrypted;

  h.client.clearPreProtectReveal(X);

  assert.equal(h.client.protectedHistory.revealOf(X), undefined);
  assert.deepEqual(
    [OLD, OLD2, OLD_ENC, NEW].map((id) => stored(h.client, id).content),
    [undefined, undefined, undefined, undefined],
  );
  assert.equal(h.client.messages.get(OLD)!.content, "");
  // No row left the cache and the encrypted payload is untouched
  assert.deepEqual(
    cachedIds(h.client),
    [OLD, OLD2, OLD_ENC, NEW, OLD3, NEW2].sort(),
  );
  assert.deepEqual(
    h.client.messages.getUnderlyingObject(OLD_ENC).encrypted,
    payload,
  );
});

test("clearPreProtectReveal touches that channel only", async () => {
  const h = await revealed();

  h.client.clearPreProtectReveal(X);

  assert.deepEqual(h.client.protectedHistory.revealOf(X2), REVEAL);
  assert.equal(stored(h.client, OLD3).content, TEXT);
  assert.equal(stored(h.client, NEW2).content, TEXT);
});

test("clearPreProtectReveal latches nothing: a later reveal is taken and restores the rows", async () => {
  const h = await revealed();

  h.client.clearPreProtectReveal(X);

  const history = h.client.protectedHistory;
  assert.equal(history.isConflicted(X), false);
  assert.equal(history.isWiped(X), false);
  assert.equal(history.canReveal(X), true);

  h.client.revealPreProtectRows(X, REVEAL);
  assert.deepEqual(history.revealOf(X), REVEAL);
  assert.deepEqual(
    [OLD, OLD2, OLD_ENC, NEW].map((id) => stored(h.client, id).content),
    [TEXT, TEXT, undefined, undefined],
  );
});

test("after clearPreProtectReveal a later reveal may carry another boundary without a conflict", async () => {
  const h = await revealed();

  h.client.clearPreProtectReveal(X);
  // Between the two old rows: only the older one is covered now
  h.client.revealPreProtectRows(X, {
    boundary: ulidAt(T - 1500, "9"),
    timeLimit: T,
  });

  assert.equal(h.client.protectedHistory.isConflicted(X), false);
  assert.deepEqual(
    [OLD, OLD2].map((id) => stored(h.client, id).content),
    [undefined, TEXT],
  );
});

test("after clearPreProtectReveal a fetched pre-boundary row is stored stripped until the next reveal", async () => {
  const h = await revealed();
  h.client.clearPreProtectReveal(X);

  h.serveGet([row(OLD5, X)]);
  const rows = await channel(h, X).fetchMessages();
  assert.deepEqual(shape(rows), [[OLD5, X, ""]]);

  h.client.revealPreProtectRows(X, REVEAL);
  assert.equal(h.client.messages.get(OLD5)!.content, TEXT);
});

test("clearPreProtectReveal lifts neither a conflict nor a wipe", async () => {
  const h = await revealed();
  // Another boundary: a conflict, for the rest of the session
  h.client.revealPreProtectRows(X, { boundary: OLD2, timeLimit: T });
  h.client.purgePreProtectRows(X2, null);

  h.client.clearPreProtectReveal(X);
  h.client.clearPreProtectReveal(X2);
  h.client.clearAllPreProtectReveals();

  const history = h.client.protectedHistory;
  assert.equal(history.isConflicted(X), true);
  assert.equal(history.isWiped(X2), true);
  h.client.revealPreProtectRows(X, REVEAL);
  h.client.revealPreProtectRows(X2, REVEAL);
  assert.equal(history.revealOf(X), undefined);
  assert.equal(stored(h.client, OLD).content, undefined);
});

test("clearAllPreProtectReveals withdraws every reveal and strips every covered row", async () => {
  const h = await revealed();

  h.client.clearAllPreProtectReveals();

  const history = h.client.protectedHistory;
  assert.equal(history.revealOf(X), undefined);
  assert.equal(history.revealOf(X2), undefined);
  assert.deepEqual(
    [OLD, OLD2, OLD3].map((id) => stored(h.client, id).content),
    [undefined, undefined, undefined],
  );
  // The ordinary row keeps its text
  assert.equal(stored(h.client, NEW2).content, TEXT);
  assert.equal(history.canReveal(X), true);
  assert.equal(history.canReveal(X2), true);

  h.client.revealPreProtectRows(X2, REVEAL);
  assert.equal(stored(h.client, OLD3).content, TEXT);
  assert.equal(stored(h.client, OLD).content, undefined);
});

test("ProtectedHistoryState.clearReveal removes the reveal only", () => {
  const history = new ProtectedHistoryState();
  assert.equal(history.clearReveal(X), false);

  assert.equal(history.setReveal(X, REVEAL), "set");
  assert.equal(history.setReveal(X2, REVEAL), "set");
  history.stashField(X, OLD, "content", TEXT);
  assert.deepEqual(history.revealedChannels().sort(), [X, X2].sort());

  assert.equal(history.clearReveal(X), true);
  assert.equal(history.revealOf(X), undefined);
  assert.equal(history.covers(X, { id: OLD, encrypted: false }), false);
  assert.equal(history.isConflicted(X), false);
  assert.equal(history.isWiped(X), false);
  assert.equal(history.hasStash(OLD), true);
  assert.deepEqual(history.revealedChannels(), [X2]);

  // Taken like a first reveal, whatever its boundary
  assert.equal(history.setReveal(X, { boundary: OLD2, timeLimit: T }), "set");
});
