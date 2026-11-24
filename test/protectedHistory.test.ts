/**
 * The verified reveal of pre-protect rows (S4, design 9.4 "S4" and 9.5).
 *
 * A message without `encrypted` in a protected or pinned channel is stored
 * without its server text (plan D25). That stays the default on every path.
 * The one exception is a reveal the E2EE bridge sets from native verified
 * state through `client.revealPreProtectRows(channelId, { boundary,
 * timeLimit })`: only rows without `encrypted`, with an id at or below the
 * boundary and a ULID time at or before the time limit, then keep their
 * server fields. These cases pin that:
 *
 * - no reveal, a reveal for another channel, a new client (a reload), a
 *   conflict or a wipe all leave rows stripped;
 * - a reveal restores the rows that were cached stripped, and only those it
 *   covers; rows cached before the channel was protected are stripped when
 *   it becomes protected;
 * - a row that carries `encrypted` is never stashed and never revealed;
 * - the purge removes plaintext rows only, and only of that channel;
 * - events that arrive later for a revealed row (edit, embeds) never land,
 *   and server mentions and attachments of a live row never reach unread
 *   state, revealed or not.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/protectedHistory.test.ts
 *
 * To run the same cases against another `src/` tree, set `STOATJS_SRC`
 * (see loadSrc.ts).
 */
import { createMemo, createRoot } from "solid-js";

import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeTime } from "ulid";

import { loadSrc } from "./loadSrc.ts";

type ClientModule = typeof import("../src/Client.ts");
type EventsModule = typeof import("../src/events/v1.ts");
type HistoryModule = typeof import("../src/lib/protectedHistory.ts");
type ProtectedModule = typeof import("../src/lib/protected.ts");
type StoatClient = InstanceType<ClientModule["Client"]>;

const { Client } = await loadSrc<ClientModule>("Client.ts");
const { handleEvent } = await loadSrc<EventsModule>("events/v1.ts");
const {
  ulidTimeMs,
  preProtectRevealed,
  ProtectedHistoryState,
  PRE_PROTECT_STASH_LIMIT,
} = await loadSrc<HistoryModule>("lib/protectedHistory.ts");
const { ProtectedChannelEditRefused, ProtectedChannelUnavailable } =
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
const CH = "01K6S000000000000000000004";
const CH2 = "01K6S000000000000000000005";
const PLAIN = "01K6S000000000000000000006";
const EMOJI = "01K6S000000000000000000007";
const ROLE = "01K6S000000000000000000008";
const REPLY = "01K6S000000000000000000009";

/** The moment the channel was protected. */
const T = 1_700_000_000_000;
/** The boundary: the last message written before the channel was protected. */
const B = ulidAt(T, "5");
/** Written a second before the boundary. */
const OLD = ulidAt(T - 1000, "1");
const OLD2 = ulidAt(T - 2000, "2");
/** Same millisecond as the boundary, one above it in byte order. */
const ABOVE = ulidAt(T, "6");
/** Written a second after the boundary. */
const NEW = ulidAt(T + 1000, "1");
const ANOTHER_B = ulidAt(T + 5000, "5");

const REVEAL = { boundary: B, timeLimit: T };

const TEXT = "server text";

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
  liveRows: string[];
  history: { channelId: string; ids: string[] }[];
  local: Set<string>;
  storage: ReturnType<typeof memoryStorage>;
  fire: (event: ServerEvent) => Promise<void>;
  serve: (rows: unknown[]) => void;
};

function noop(): void {}

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

/**
 * A fresh offline client with an adapter stub. `storage` carries the pins
 * (and their history) from an earlier client, as a reload would.
 */
function setup(storage = memoryStorage()): Harness {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )) as never;
  (globalThis as { localStorage?: unknown }).localStorage = storage;

  const client = new Client(
    { autoReconnect: false, syncUnreads: true },
    CONFIG as never,
  );

  const liveRows: string[] = [];
  const history: { channelId: string; ids: string[] }[] = [];
  const local = new Set<string>();
  client.e2ee = {
    isEncryptedMessage: (id: string) => local.has(id),
    onChannelProtected: noop,
    onProtectedFlagStripped: noop,
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
    liveRows,
    history,
    local,
    storage,
    fire: (event) => handleEvent(client, event as never, noop as never),
    serve: (rows) => {
      (client.api as unknown as { get: unknown }).get = () =>
        Promise.resolve(rows);
    },
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

/** A wire row carrying server-controlled fields of every kind. */
function row(id: string, channel: string, extra = {}) {
  return {
    _id: id,
    channel,
    author: OTHER,
    content: TEXT,
    embeds: [{ type: "Text", description: TEXT }],
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
    masquerade: { name: TEXT },
    interactions: { reactions: [EMOJI], restrict_reactions: true },
    system: { type: "text", content: TEXT },
    replies: [REPLY],
    mentions: [ME],
    role_mentions: [ROLE],
    // SuppressNotifications mask + MentionsEveryone + MentionsOnline bits
    flags: 1 | (1 << 2) | (1 << 3),
    forwarded: {
      message_id: REPLY,
      channel_id: PLAIN,
      author_id: OTHER,
      content: TEXT,
      original_sent_at: "2026-01-01T00:00:00.000Z",
    },
    webhook: { name: TEXT, avatar: null },
    thread_id: REPLY,
    ...extra,
  };
}

/** The server-controlled part of a stored row, reduced to plain values. */
function state(client: StoatClient, id: string) {
  const raw = client.messages.getUnderlyingObject(id);
  return {
    content: raw.content,
    embeds: raw.embeds?.length,
    attachments: raw.attachments?.length,
    masquerade: raw.masquerade?.name,
    interactions: raw.interactions?.reactions?.length,
    systemMessage: raw.systemMessage !== undefined,
    replyIds: raw.replyIds && [...raw.replyIds],
    mentionIds: raw.mentionIds && [...raw.mentionIds],
    roleMentionIds: raw.roleMentionIds && [...raw.roleMentionIds],
    flags: raw.flags,
    forwarded: raw.forwarded?.content,
    webhook: raw.webhook !== undefined,
    threadId: raw.threadId,
  };
}

const STRIPPED = {
  content: undefined,
  embeds: undefined,
  attachments: undefined,
  masquerade: undefined,
  interactions: undefined,
  systemMessage: false,
  replyIds: undefined,
  mentionIds: undefined,
  roleMentionIds: undefined,
  // Only the SuppressNotifications mask survives
  flags: 1,
  forwarded: undefined,
  webhook: false,
  threadId: undefined,
};

const REVEALED = {
  content: TEXT,
  embeds: 1,
  attachments: 1,
  masquerade: TEXT,
  interactions: 1,
  systemMessage: true,
  replyIds: [REPLY],
  mentionIds: [ME],
  // `role_mentions` has no key mapping at the base, so hydration drops it
  // for every message, protected or not
  roleMentionIds: undefined,
  flags: 1 | (1 << 2) | (1 << 3),
  forwarded: TEXT,
  webhook: true,
  threadId: REPLY,
};

/** A protected channel with rows fetched into the cache. */
async function fetched(rows: unknown[], channel = CH): Promise<Harness> {
  const h = setup();
  await h.fire(ready([textChannel(channel, { protected: true })]));
  h.client.user = h.client.users.get(ME);
  h.serve(rows);
  await h.client.channels.get(channel)!.fetchMessages();
  return h;
}

// --- pure: ulidTimeMs ----------------------------------------------------

test("ulidTimeMs decodes the time of a ULID and agrees with the ulid package", () => {
  assert.equal(ulidTimeMs(B), T);
  assert.equal(ulidTimeMs(OLD), T - 1000);
  assert.equal(ulidTimeMs("00000000000000000000000000"), 0);
  assert.equal(ulidTimeMs("7ZZZZZZZZZZZZZZZZZZZZZZZZZ"), 2 ** 48 - 1);
  for (const id of [B, OLD, NEW, ME, "01ARZ3NDEKTSV4RRFFQ69G5FAV"]) {
    assert.equal(ulidTimeMs(id), decodeTime(id), id);
  }
});

test("ulidTimeMs answers null for anything that is not a 26-character upper-case Crockford ULID", () => {
  for (const id of [
    "",
    B.slice(0, 25),
    `${B}0`,
    B.toLowerCase(),
    `${B.slice(0, 25)}I`,
    `${B.slice(0, 25)}L`,
    `${B.slice(0, 25)}O`,
    `${B.slice(0, 25)}U`,
    `${B.slice(0, 25)}-`,
    // A time above 48 bits
    "80000000000000000000000000",
    "ZZZZZZZZZZZZZZZZZZZZZZZZZZ",
  ]) {
    assert.equal(ulidTimeMs(id), null, JSON.stringify(id));
  }
  for (const id of [undefined, null, 7, {}, [B]]) {
    assert.equal(ulidTimeMs(id as never), null);
  }
});

// --- pure: preProtectRevealed --------------------------------------------

test("preProtectRevealed: a plaintext row at or below the boundary and within the time limit is revealed", () => {
  assert.equal(
    preProtectRevealed({ id: OLD, encrypted: false }, REVEAL, false),
    true,
  );
});

test("preProtectRevealed: no reveal reveals nothing", () => {
  assert.equal(
    preProtectRevealed({ id: OLD, encrypted: false }, undefined, false),
    false,
  );
  assert.equal(
    preProtectRevealed({ id: OLD, encrypted: false }, null as never, false),
    false,
  );
});

test("preProtectRevealed: a row that carries encrypted is never revealed", () => {
  assert.equal(
    preProtectRevealed({ id: OLD, encrypted: true }, REVEAL, false),
    false,
  );
  // Only a literal false counts as "no encrypted payload"
  for (const encrypted of [undefined, null, 0, ""]) {
    assert.equal(
      preProtectRevealed(
        { id: OLD, encrypted: encrypted as never },
        REVEAL,
        false,
      ),
      false,
    );
  }
});

test("preProtectRevealed: the boundary itself is revealed", () => {
  assert.equal(
    preProtectRevealed({ id: B, encrypted: false }, REVEAL, false),
    true,
  );
});

test("preProtectRevealed: an id above the boundary is never revealed, even in the same millisecond", () => {
  assert.equal(
    preProtectRevealed({ id: ABOVE, encrypted: false }, REVEAL, false),
    false,
  );
  assert.equal(
    preProtectRevealed({ id: NEW, encrypted: false }, REVEAL, false),
    false,
  );
  // A generous time limit does not rescue an id above the boundary
  assert.equal(
    preProtectRevealed(
      { id: NEW, encrypted: false },
      { boundary: B, timeLimit: T + 10_000 },
      false,
    ),
    false,
  );
});

test("preProtectRevealed: a ULID time after the time limit is never revealed, whatever the boundary says", () => {
  // The boundary sits after the time limit: rows between the two stay hidden
  const reveal = { boundary: B, timeLimit: T - 500 };
  assert.equal(
    preProtectRevealed({ id: B, encrypted: false }, reveal, false),
    false,
  );
  assert.equal(
    preProtectRevealed({ id: OLD, encrypted: false }, reveal, false),
    true,
  );
  // The limit is inclusive
  assert.equal(
    preProtectRevealed(
      { id: OLD, encrypted: false },
      { boundary: B, timeLimit: T - 1000 },
      false,
    ),
    true,
  );
  assert.equal(
    preProtectRevealed(
      { id: OLD, encrypted: false },
      { boundary: B, timeLimit: T - 1001 },
      false,
    ),
    false,
  );
});

test("preProtectRevealed: a wiped channel reveals nothing", () => {
  assert.equal(
    preProtectRevealed({ id: OLD, encrypted: false }, REVEAL, true),
    false,
  );
  assert.equal(
    preProtectRevealed(
      { id: OLD, encrypted: false },
      REVEAL,
      undefined as never,
    ),
    false,
  );
});

test("preProtectRevealed: an id, a boundary or a time limit that is not valid reveals nothing", () => {
  for (const id of ["", "0", OLD.toLowerCase(), OLD.slice(0, 25), "!"]) {
    assert.equal(
      preProtectRevealed({ id, encrypted: false }, REVEAL, false),
      false,
      `row id ${JSON.stringify(id)}`,
    );
  }
  // "Z" sorts above every ULID in byte order
  for (const boundary of [
    "",
    "Z",
    "ZZZZZZZZZZZZZZZZZZZZZZZZZZ",
    B.toLowerCase(),
  ]) {
    assert.equal(
      preProtectRevealed(
        { id: OLD, encrypted: false },
        { boundary, timeLimit: T },
        false,
      ),
      false,
      `boundary ${JSON.stringify(boundary)}`,
    );
  }
  for (const timeLimit of [NaN, Infinity, -1, 1.5, "9".repeat(15), null]) {
    assert.equal(
      preProtectRevealed(
        { id: OLD, encrypted: false },
        { boundary: B, timeLimit: timeLimit as never },
        false,
      ),
      false,
      `time limit ${String(timeLimit)}`,
    );
  }
});

// --- pure: ProtectedHistoryState -----------------------------------------

test("ProtectedHistoryState: set, same, a moved time limit, and reads are copies", () => {
  const history = new ProtectedHistoryState();
  assert.equal(history.revealOf(CH), undefined);
  assert.equal(history.covers(CH, { id: OLD, encrypted: false }), false);

  assert.equal(history.setReveal(CH, REVEAL), "set");
  assert.equal(history.setReveal(CH, { ...REVEAL }), "same");
  assert.deepEqual(history.revealOf(CH), REVEAL);
  assert.equal(history.covers(CH, { id: OLD, encrypted: false }), true);
  assert.equal(history.covers(CH, { id: OLD, encrypted: true }), false);
  assert.equal(history.covers(CH2, { id: OLD, encrypted: false }), false);

  assert.equal(
    history.setReveal(CH, { boundary: B, timeLimit: T - 500 }),
    "set",
  );
  assert.deepEqual(history.revealOf(CH), { boundary: B, timeLimit: T - 500 });

  // A returned reveal is a copy: mutating it widens nothing
  history.revealOf(CH)!.boundary = ANOTHER_B;
  history.revealOf(CH)!.timeLimit = T + 10_000;
  assert.deepEqual(history.revealOf(CH), { boundary: B, timeLimit: T - 500 });
});

test("ProtectedHistoryState: a second reveal with another boundary removes the reveal for the rest of the session", () => {
  const history = new ProtectedHistoryState();
  history.setReveal(CH, REVEAL);
  history.setReveal(CH2, REVEAL);

  assert.equal(
    history.setReveal(CH, { boundary: ANOTHER_B, timeLimit: T }),
    "conflict",
  );
  assert.equal(history.revealOf(CH), undefined);
  assert.equal(history.isConflicted(CH), true);
  assert.equal(history.canReveal(CH), false);
  assert.equal(history.covers(CH, { id: OLD, encrypted: false }), false);

  // Neither boundary is accepted afterwards
  assert.equal(history.setReveal(CH, REVEAL), "conflict");
  assert.equal(
    history.setReveal(CH, { boundary: ANOTHER_B, timeLimit: T }),
    "conflict",
  );
  assert.equal(history.revealOf(CH), undefined);
  assert.equal(history.covers(CH, { id: OLD, encrypted: false }), false);

  // Another channel is not affected
  assert.equal(history.covers(CH2, { id: OLD, encrypted: false }), true);
});

test("ProtectedHistoryState: a reveal that is not valid is a conflict", () => {
  for (const reveal of [
    { boundary: "", timeLimit: T },
    { boundary: B.toLowerCase(), timeLimit: T },
    { boundary: B, timeLimit: NaN },
    { boundary: B, timeLimit: -1 },
    { boundary: B, timeLimit: 1.5 },
    undefined,
    null,
  ]) {
    const history = new ProtectedHistoryState();
    assert.equal(history.setReveal(CH, reveal as never), "conflict");
    assert.equal(history.revealOf(CH), undefined);
    assert.equal(history.setReveal(CH, REVEAL), "conflict");
  }
});

test("ProtectedHistoryState: a wipe is one-way and outlives a later reveal", () => {
  const history = new ProtectedHistoryState();
  history.setReveal(CH, REVEAL);
  assert.equal(history.isWiped(CH), false);

  history.markWiped(CH);
  assert.equal(history.isWiped(CH), true);
  assert.equal(history.canReveal(CH), false);
  assert.equal(history.covers(CH, { id: OLD, encrypted: false }), false);

  // No later reveal brings rows back, and nothing un-wipes
  history.setReveal(CH, { boundary: B, timeLimit: T + 1 });
  history.setReveal(CH, REVEAL);
  assert.equal(history.isWiped(CH), true);
  assert.equal(history.covers(CH, { id: OLD, encrypted: false }), false);
  for (const name of ["unwipe", "clearWiped", "clear", "reset", "delete"]) {
    assert.equal(
      (history as unknown as Record<string, unknown>)[name],
      undefined,
      `ProtectedHistoryState must not expose ${name}`,
    );
  }
  assert.equal(history.isWiped(CH2), false);
});

test("ProtectedHistoryState: reads are reactive", () => {
  createRoot((dispose) => {
    const history = new ProtectedHistoryState();
    const boundary = createMemo(() => history.revealOf(CH)?.boundary);
    const wiped = createMemo(() => history.isWiped(CH));
    const covered = createMemo(() =>
      history.covers(CH, { id: OLD, encrypted: false }),
    );
    assert.equal(boundary(), undefined);
    assert.equal(covered(), false);

    history.setReveal(CH, REVEAL);
    assert.equal(boundary(), B);
    assert.equal(covered(), true);

    history.markWiped(CH);
    assert.equal(wiped(), true);
    assert.equal(covered(), false);
    dispose();
  });
});

test("ProtectedHistoryState: the stash keeps at most 2000 rows, oldest dropped, and none for a channel that can take no reveal", () => {
  assert.equal(PRE_PROTECT_STASH_LIMIT, 2000);
  const history = new ProtectedHistoryState();
  for (let i = 0; i < PRE_PROTECT_STASH_LIMIT + 3; i++) {
    history.stashField(CH, `row-${i}`, "content", `text-${i}`);
    history.stashField(CH, `row-${i}`, "flags", 5);
  }
  assert.equal(history.stashSize, PRE_PROTECT_STASH_LIMIT);
  assert.equal(history.hasStash("row-0"), false);
  assert.equal(history.hasStash("row-2"), false);
  assert.equal(history.hasStash("row-3"), true);
  assert.deepEqual(history.takeStash("row-3"), {
    channelId: CH,
    fields: { content: "text-3", flags: 5 },
  });
  assert.equal(history.takeStash("row-3"), undefined);

  history.stashField(CH2, "other", "content", "x");
  history.markWiped(CH);
  assert.deepEqual(history.stashedIds(CH), []);
  assert.deepEqual(history.stashedIds(CH2), ["other"]);
  history.stashField(CH, "late", "content", "x");
  assert.equal(history.hasStash("late"), false);

  history.setReveal(CH2, REVEAL);
  history.setReveal(CH2, { boundary: ANOTHER_B, timeLimit: T });
  assert.deepEqual(history.stashedIds(CH2), []);
  history.stashField(CH2, "late", "content", "x");
  assert.equal(history.stashSize, 0);
});

// --- hydration: the strip stays the default ------------------------------

test("no reveal: a fetched plaintext row in a protected channel is stored without server text", async () => {
  const h = await fetched([row(OLD, CH), row(NEW, CH)]);

  assert.deepEqual(state(h.client, OLD), STRIPPED);
  assert.deepEqual(state(h.client, NEW), STRIPPED);
  assert.equal(h.client.messages.get(OLD)!.content, "");
  assert.equal(h.client.messages.get(OLD)!.mentioned, false);
  assert.equal(h.client.protectedHistory.revealOf(CH), undefined);
  // Still handed to the adapter, which decides what the row renders as
  assert.deepEqual(h.history, [{ channelId: CH, ids: [OLD, NEW] }]);
});

test("a reveal for another channel reveals nothing here", async () => {
  const h = setup();
  await h.fire(
    ready([
      textChannel(CH, { protected: true }),
      textChannel(CH2, { protected: true }),
    ]),
  );
  h.client.revealPreProtectRows(CH2, REVEAL);
  h.serve([row(OLD, CH)]);
  await h.client.channels.get(CH)!.fetchMessages();

  assert.deepEqual(state(h.client, OLD), STRIPPED);
});

test("a reveal set first: fetched rows at or below the boundary and within the time limit keep their fields, every other row is stripped", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));
  h.client.revealPreProtectRows(CH, REVEAL);
  h.serve([row(OLD, CH), row(B, CH), row(ABOVE, CH), row(NEW, CH)]);
  await h.client.channels.get(CH)!.fetchMessages();

  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.deepEqual(state(h.client, B), REVEALED);
  assert.deepEqual(state(h.client, ABOVE), STRIPPED);
  assert.deepEqual(state(h.client, NEW), STRIPPED);
  assert.equal(h.client.messages.get(OLD)!.content, TEXT);
});

test("a reveal set first: a row whose ULID time is after the time limit is stripped although its id is below the boundary", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));
  h.client.revealPreProtectRows(CH, { boundary: B, timeLimit: T - 500 });
  h.serve([row(OLD, CH), row(B, CH)]);
  await h.client.channels.get(CH)!.fetchMessages();

  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.deepEqual(state(h.client, B), STRIPPED);
});

test("a row that carries encrypted is stripped and never stashed, whatever the reveal says", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));
  h.serve([row(OLD2, CH, { encrypted: ENCRYPTED })]);
  await h.client.channels.get(CH)!.fetchMessages();
  assert.equal(h.client.protectedHistory.hasStash(OLD2), false);

  h.client.revealPreProtectRows(CH, REVEAL);
  h.serve([row(OLD, CH, { encrypted: ENCRYPTED })]);
  await h.client.channels.get(CH)!.fetchMessages();

  for (const id of [OLD, OLD2]) {
    assert.deepEqual(state(h.client, id), STRIPPED, id);
    assert.deepEqual(h.client.messages.get(id)!.encrypted, ENCRYPTED);
    assert.equal(h.client.protectedHistory.hasStash(id), false);
  }
  assert.equal(h.client.protectedHistory.stashSize, 0);
});

test("a pinned channel the server no longer flags: stripped without a reveal, revealed with one", async () => {
  const storage = memoryStorage({
    [`protected-channel-pins:${ME}`]: JSON.stringify([CH]),
  });
  const h = setup(storage);
  await h.fire(ready([textChannel(CH)]));
  h.serve([row(OLD, CH), row(NEW, CH)]);
  await h.client.channels.get(CH)!.fetchMessages();
  assert.deepEqual(state(h.client, OLD), STRIPPED);

  h.client.revealPreProtectRows(CH, REVEAL);
  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.deepEqual(state(h.client, NEW), STRIPPED);
});

test("control: an ordinary channel is untouched by the reveal machinery", async () => {
  const h = setup();
  await h.fire(ready([textChannel(PLAIN)]));
  h.serve([row(OLD, PLAIN), row(NEW, PLAIN)]);
  await h.client.channels.get(PLAIN)!.fetchMessages();
  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.deepEqual(state(h.client, NEW), REVEALED);
  assert.equal(h.client.protectedHistory.stashSize, 0);

  // A reveal, a conflict or a purge of another channel strips nothing here
  h.client.revealPreProtectRows(PLAIN, REVEAL);
  h.client.revealPreProtectRows(PLAIN, { boundary: ANOTHER_B, timeLimit: T });
  h.client.purgePreProtectRows(CH, null);
  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.deepEqual(state(h.client, NEW), REVEALED);
});

// --- the reveal restores stashed rows ------------------------------------

test("a reveal re-stores the stashed rows it covers, and only those", async () => {
  const h = await fetched([
    row(OLD, CH),
    row(B, CH),
    row(ABOVE, CH),
    row(NEW, CH),
  ]);
  for (const id of [OLD, B, ABOVE, NEW]) {
    assert.deepEqual(state(h.client, id), STRIPPED, id);
    assert.equal(h.client.protectedHistory.hasStash(id), true, id);
  }

  h.client.revealPreProtectRows(CH, REVEAL);

  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.deepEqual(state(h.client, B), REVEALED);
  assert.deepEqual(state(h.client, ABOVE), STRIPPED);
  assert.deepEqual(state(h.client, NEW), STRIPPED);
  // What was restored leaves the stash; what was not stays for no one
  assert.equal(h.client.protectedHistory.hasStash(OLD), false);
  assert.equal(h.client.protectedHistory.hasStash(B), false);
  assert.equal(h.client.messages.get(OLD)!.content, TEXT);
});

test("a reveal with a time limit before the boundary re-stores only rows within the limit", async () => {
  const h = await fetched([row(OLD, CH), row(B, CH)]);
  h.client.revealPreProtectRows(CH, { boundary: B, timeLimit: T - 500 });

  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.deepEqual(state(h.client, B), STRIPPED);
});

test("a time limit that moves back strips the rows it no longer covers, and forward again restores them", async () => {
  const h = await fetched([row(OLD, CH), row(B, CH)]);
  h.client.revealPreProtectRows(CH, REVEAL);
  assert.deepEqual(state(h.client, B), REVEALED);

  h.client.revealPreProtectRows(CH, { boundary: B, timeLimit: T - 500 });
  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.deepEqual(state(h.client, B), STRIPPED);

  h.client.revealPreProtectRows(CH, REVEAL);
  assert.deepEqual(state(h.client, B), REVEALED);
});

test("a stashed row that left the cache is not restored and its stash is dropped", async () => {
  const h = await fetched([row(OLD, CH), row(OLD2, CH)]);
  await h.fire({ type: "MessageDelete", id: OLD, channel: CH });
  assert.equal(h.client.messages.has(OLD), false);

  h.client.revealPreProtectRows(CH, REVEAL);
  assert.equal(h.client.messages.has(OLD), false);
  assert.equal(h.client.protectedHistory.hasStash(OLD), false);
  assert.deepEqual(state(h.client, OLD2), REVEALED);
});

test("a row evicted and fetched again follows the reveal of that moment", async () => {
  const h = await fetched([row(OLD, CH)]);
  h.client.revealPreProtectRows(CH, REVEAL);
  assert.deepEqual(state(h.client, OLD), REVEALED);

  // Evicted, fetched again under the reveal: revealed at hydration
  h.client.messages.delete(OLD);
  h.serve([row(OLD, CH)]);
  await h.client.channels.get(CH)!.fetchMessages();
  assert.deepEqual(state(h.client, OLD), REVEALED);

  // Evicted, the reveal conflicts, fetched again: stripped
  h.client.messages.delete(OLD);
  h.client.revealPreProtectRows(CH, { boundary: ANOTHER_B, timeLimit: T });
  await h.client.channels.get(CH)!.fetchMessages();
  assert.deepEqual(state(h.client, OLD), STRIPPED);
});

// --- the reveal does not outlive its conditions --------------------------

test("a second reveal with another boundary strips every row again and no reveal is taken for the rest of the session", async () => {
  const h = await fetched([row(OLD, CH), row(B, CH)]);
  h.client.revealPreProtectRows(CH, REVEAL);
  assert.deepEqual(state(h.client, OLD), REVEALED);

  h.client.revealPreProtectRows(CH, { boundary: ANOTHER_B, timeLimit: T });
  assert.deepEqual(state(h.client, OLD), STRIPPED);
  assert.deepEqual(state(h.client, B), STRIPPED);
  assert.equal(h.client.protectedHistory.revealOf(CH), undefined);
  assert.equal(h.client.protectedHistory.isConflicted(CH), true);

  // The first boundary again changes nothing
  h.client.revealPreProtectRows(CH, REVEAL);
  assert.deepEqual(state(h.client, OLD), STRIPPED);

  // Rows fetched from here on are stripped too, and nothing is kept for later
  h.serve([row(OLD2, CH)]);
  await h.client.channels.get(CH)!.fetchMessages();
  assert.deepEqual(state(h.client, OLD2), STRIPPED);
  assert.equal(h.client.protectedHistory.stashSize, 0);
});

test("a reveal that is not valid strips every row again", async () => {
  const h = await fetched([row(OLD, CH)]);
  h.client.revealPreProtectRows(CH, REVEAL);
  assert.deepEqual(state(h.client, OLD), REVEALED);

  h.client.revealPreProtectRows(CH, { boundary: B, timeLimit: NaN });
  assert.deepEqual(state(h.client, OLD), STRIPPED);
});

test("a new client (a reload) starts with no reveal: the same rows are stripped again", async () => {
  const storage = memoryStorage();
  const first = setup(storage);
  await first.fire(ready([textChannel(CH, { protected: true })]));
  first.client.revealPreProtectRows(CH, REVEAL);
  assert.equal(
    first.client.protectedPins.setHistory(CH, { boundary: B, wiped: false }),
    true,
  );
  first.serve([row(OLD, CH)]);
  await first.client.channels.get(CH)!.fetchMessages();
  assert.deepEqual(state(first.client, OLD), REVEALED);

  // Same storage, so the pin and its stored boundary are back. Neither
  // reveals anything: only the bridge's call does
  const second = setup(storage);
  await second.fire(ready([textChannel(CH, { protected: true })]));
  assert.deepEqual(second.client.protectedPins.historyOf(CH), {
    boundary: B,
    wiped: false,
  });
  second.serve([row(OLD, CH)]);
  await second.client.channels.get(CH)!.fetchMessages();

  assert.equal(second.client.protectedHistory.revealOf(CH), undefined);
  assert.deepEqual(state(second.client, OLD), STRIPPED);
});

// --- rows cached before the channel was protected ------------------------

test("rows cached before protect are stripped when the channel becomes protected, and a reveal restores the covered ones", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH), textChannel(PLAIN)]));
  h.serve([row(OLD, CH), row(NEW, CH)]);
  await h.client.channels.get(CH)!.fetchMessages();
  h.serve([row(OLD2, PLAIN)]);
  await h.client.channels.get(PLAIN)!.fetchMessages();
  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.deepEqual(state(h.client, NEW), REVEALED);

  await h.fire({
    type: "ChannelUpdate",
    id: CH,
    data: { protected: true },
  });

  assert.deepEqual(state(h.client, OLD), STRIPPED);
  assert.deepEqual(state(h.client, NEW), STRIPPED);
  assert.equal(h.client.messages.get(OLD)!.content, "");
  // The other channel keeps its rows
  assert.deepEqual(state(h.client, OLD2), REVEALED);

  h.client.revealPreProtectRows(CH, REVEAL);
  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.deepEqual(state(h.client, NEW), STRIPPED);
});

test("a reveal set before the channel is protected spares only the rows it covers at protect", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH)]));
  h.serve([row(OLD, CH), row(NEW, CH)]);
  await h.client.channels.get(CH)!.fetchMessages();
  h.client.revealPreProtectRows(CH, REVEAL);
  // Not protected yet: nothing is stripped
  assert.deepEqual(state(h.client, NEW), REVEALED);

  await h.fire({ type: "ChannelUpdate", id: CH, data: { protected: true } });
  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.deepEqual(state(h.client, NEW), STRIPPED);
});

// --- the purge -----------------------------------------------------------

test("purgePreProtectRows removes the plaintext rows at or below the boundary, of that channel only", async () => {
  const h = setup();
  await h.fire(
    ready([
      textChannel(CH, { protected: true }),
      textChannel(CH2, { protected: true }),
      textChannel(PLAIN),
    ]),
  );
  h.client.revealPreProtectRows(CH, REVEAL);
  h.client.revealPreProtectRows(CH2, REVEAL);
  h.serve([row(OLD, CH), row(B, CH), row(ABOVE, CH)]);
  await h.client.channels.get(CH)!.fetchMessages();
  const other = ulidAt(T - 3000, "3");
  const plain = ulidAt(T - 4000, "4");
  h.serve([row(other, CH2)]);
  await h.client.channels.get(CH2)!.fetchMessages();
  h.serve([row(plain, PLAIN)]);
  await h.client.channels.get(PLAIN)!.fetchMessages();

  const removed = h.client.purgePreProtectRows(CH, B);

  assert.deepEqual(removed.sort(), [OLD, B].sort());
  assert.equal(h.client.messages.has(OLD), false);
  assert.equal(h.client.messages.has(B), false);
  assert.equal(h.client.messages.has(ABOVE), true);
  assert.deepEqual(state(h.client, ABOVE), STRIPPED);
  // Other channels keep their rows, revealed or ordinary
  assert.deepEqual(state(h.client, other), REVEALED);
  assert.deepEqual(state(h.client, plain), REVEALED);
  assert.equal(h.client.protectedHistory.isWiped(CH), true);
  assert.equal(h.client.protectedHistory.isWiped(CH2), false);
});

test("purgePreProtectRows removes plaintext rows only: encrypted rows stay", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));
  const local = ulidAt(T - 5000, "7");
  h.local.add(local);
  h.serve([
    row(OLD, CH),
    row(OLD2, CH, { encrypted: ENCRYPTED }),
    row(local, CH),
    row(NEW, CH, { encrypted: ENCRYPTED }),
  ]);
  await h.client.channels.get(CH)!.fetchMessages();

  const removed = h.client.purgePreProtectRows(CH, null);

  assert.deepEqual(removed, [OLD]);
  assert.equal(h.client.messages.has(OLD), false);
  assert.equal(h.client.messages.has(OLD2), true);
  assert.deepEqual(h.client.messages.get(OLD2)!.encrypted, ENCRYPTED);
  assert.equal(h.client.messages.has(NEW), true);
  // A local end-to-end encrypted row is never a server message
  assert.equal(h.client.messages.has(local), true);
});

test("purgePreProtectRows with null removes every plaintext row, above the boundary too", async () => {
  const h = await fetched([row(OLD, CH), row(NEW, CH)]);
  assert.deepEqual(
    h.client.purgePreProtectRows(CH, null).sort(),
    [OLD, NEW].sort(),
  );
  assert.equal(h.client.protectedHistory.stashSize, 0);
});

test("after a purge no row of the channel is revealed again: left-over revealed rows are stripped and a later reveal does nothing", async () => {
  const h = await fetched([row(OLD, CH), row(OLD2, CH)]);
  h.client.revealPreProtectRows(CH, REVEAL);
  assert.deepEqual(state(h.client, OLD), REVEALED);

  // A boundary below both rows removes nothing, but the wipe still latches
  const removed = h.client.purgePreProtectRows(CH, ulidAt(T - 9000, "1"));
  assert.deepEqual(removed, []);
  assert.deepEqual(state(h.client, OLD), STRIPPED);
  assert.deepEqual(state(h.client, OLD2), STRIPPED);

  h.client.revealPreProtectRows(CH, REVEAL);
  assert.deepEqual(state(h.client, OLD), STRIPPED);

  h.client.messages.delete(OLD);
  h.serve([row(OLD, CH)]);
  await h.client.channels.get(CH)!.fetchMessages();
  assert.deepEqual(state(h.client, OLD), STRIPPED);
  assert.equal(h.client.protectedHistory.stashSize, 0);
});

// --- every other consumer of a row's text --------------------------------

test("a live row above the boundary is stripped under a reveal and its server mentions never reach unread state", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));
  h.client.user = h.client.users.get(ME);
  h.client.revealPreProtectRows(CH, REVEAL);

  await h.fire({ type: "Message", ...row(NEW, CH) });

  assert.deepEqual(state(h.client, NEW), STRIPPED);
  assert.deepEqual(h.liveRows, [NEW]);
  const channel = h.client.channels.get(CH)!;
  const unread = h.client.channelUnreads.for(channel);
  assert.equal(unread.messageMentionIds.has(NEW), false);
  assert.equal(unread.unreadHasAttachments, false);
  assert.equal(channel.lastMessage!.content, "");
  assert.equal(channel.lastMessage!.mentioned, false);
});

test("a live event that replays a pre-boundary id never feeds unread mentions or attachments, and still goes to the adapter", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));
  h.client.user = h.client.users.get(ME);
  h.client.revealPreProtectRows(CH, REVEAL);

  await h.fire({ type: "Message", ...row(OLD, CH) });

  const unread = h.client.channelUnreads.for(h.client.channels.get(CH)!);
  assert.equal(unread.messageMentionIds.has(OLD), false);
  assert.equal(unread.unreadHasAttachments, false);
  assert.deepEqual(h.liveRows, [OLD]);
  // A live row is never one the reveal is about (R-W4-17): a message that
  // is genuinely new cannot carry a pre-boundary id, so the row is stored
  // stripped; only a fetch stores a revealed row
  assert.deepEqual(state(h.client, OLD), STRIPPED);
});

test("MessageUpdate on a revealed row applies only the pin state: no edited text, no edit stamp", async () => {
  const h = await fetched([row(OLD, CH)]);
  h.client.revealPreProtectRows(CH, REVEAL);
  h.emitted.length = 0;

  await h.fire({
    type: "MessageUpdate",
    id: OLD,
    channel: CH,
    data: {
      pinned: true,
      content: "edited by the server",
      embeds: [],
      edited: new Date().toISOString(),
    },
  });

  const message = h.client.messages.get(OLD)!;
  assert.equal(message.pinned, true);
  assert.equal(message.content, TEXT);
  assert.equal(message.embeds?.length, 1);
  assert.equal(message.editedAt, undefined);
  assert.deepEqual(h.emitted, ["messageUpdate"]);
});

test("MessageUpdate on a stripped row changes neither the row nor what a later reveal restores", async () => {
  const h = await fetched([row(OLD, CH)]);

  await h.fire({
    type: "MessageUpdate",
    id: OLD,
    channel: CH,
    data: { content: "edited by the server" },
  });
  assert.equal(h.client.messages.get(OLD)!.content, "");

  h.client.revealPreProtectRows(CH, REVEAL);
  assert.equal(h.client.messages.get(OLD)!.content, TEXT);
});

test("MessageAppend never lands on a revealed or a stripped row", async () => {
  const h = await fetched([row(OLD, CH), row(NEW, CH)]);
  h.client.revealPreProtectRows(CH, REVEAL);
  h.emitted.length = 0;

  for (const id of [OLD, NEW]) {
    await h.fire({
      type: "MessageAppend",
      id,
      channel: CH,
      append: { embeds: [{ type: "Text", description: "late embed" }] },
    });
  }

  assert.equal(h.client.messages.get(OLD)!.embeds?.length, 1);
  assert.equal(h.client.messages.get(NEW)!.embeds, undefined);
  assert.deepEqual(h.emitted, []);
});

test("a single fetch (a reply preview) follows the same rule: stripped without a reveal, covered rows only with one", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));
  const serveOne = (id: string) =>
    ((h.client.api as unknown as { get: unknown }).get = () =>
      Promise.resolve(row(id, CH)));

  serveOne(OLD2);
  assert.equal((await h.client.messages.fetch(CH, OLD2)).content, "");

  h.client.revealPreProtectRows(CH, REVEAL);
  assert.equal(h.client.messages.get(OLD2)!.content, TEXT);

  serveOne(OLD);
  assert.equal((await h.client.messages.fetch(CH, OLD)).content, TEXT);
  serveOne(NEW);
  assert.equal((await h.client.messages.fetch(CH, NEW)).content, "");
  serveOne(ABOVE);
  const single = await h.client.channels.get(CH)!.fetchMessage(ABOVE);
  assert.equal(single.content, "");
});

test("search results follow the same rule", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));
  h.client.revealPreProtectRows(CH, REVEAL);
  (h.client.api as unknown as { post: unknown }).post = () =>
    Promise.resolve([row(OLD, CH), row(NEW, CH)]);

  const rows = await h.client.channels
    .get(CH)!
    .search({ pinned: true } as never);

  assert.deepEqual(
    rows.map((message) => [message.id, message.content]),
    [
      [OLD, TEXT],
      [NEW, ""],
    ],
  );
});

test("a revealed row still refuses edit and forward without a request", async () => {
  const h = await fetched([row(OLD, CH)]);
  h.client.revealPreProtectRows(CH, REVEAL);
  const requests: string[] = [];
  (h.client.api as unknown as { patch: unknown }).patch = (path: string) => {
    requests.push(path);
    return Promise.resolve(undefined);
  };
  (h.client.channels as unknown as { apiReq: unknown }).apiReq = (
    _method: string,
    path: string,
  ) => {
    requests.push(path);
    return Promise.resolve({});
  };

  const message = h.client.messages.get(OLD)!;
  await assert.rejects(
    message.edit({ content: "x" }),
    (error: unknown) => error instanceof ProtectedChannelEditRefused,
  );
  await assert.rejects(
    message.forwardTo(PLAIN),
    (error: unknown) => error instanceof ProtectedChannelUnavailable,
  );
  assert.deepEqual(requests, []);
});
