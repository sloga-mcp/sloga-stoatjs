/**
 * Protected channels S4 in the SDK: the channel's `protected_history`, the
 * wipe purge, the live-row rule, the audit actions and the root exports.
 *
 * - `protected_history` (backend 2efca34c `v0::ProtectedHistory`) hydrates
 *   strictly as `channel.protectedHistory`; anything malformed is
 *   `undefined`. It is informational: no row is revealed from it.
 * - A `ChannelUpdate` whose wipe is `requested` or `done` removes the cached
 *   plaintext rows of that channel at or below the boundary, keeps its
 *   encrypted rows and every row of other channels, and announces the
 *   removed rows as `messageDeleteBulk` (design 9.5 "Wipe purge"). A full
 *   channel object that arrives already wiped marks the channel wiped.
 * - A LIVE row is never revealed and never stashed, whatever its id says
 *   (R-W4-17): only a fetch stores a revealed row.
 * - `ProtectedChannelChanged` with scope `history` relays unchanged.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/protectedS4.test.ts
 *
 * To run the same cases against another `src/` tree, set `STOATJS_SRC`
 * (see loadSrc.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSrc } from "./loadSrc.ts";

type ClientModule = typeof import("../src/Client.ts");
type EventsModule = typeof import("../src/events/v1.ts");
type ChannelHydrationModule = typeof import("../src/hydration/channel.ts");
type AuditModule = typeof import("../src/classes/AuditLog.ts");
type RootModule = typeof import("../src/index.ts");
type StoatClient = InstanceType<ClientModule["Client"]>;

const { Client } = await loadSrc<ClientModule>("Client.ts");
const { handleEvent } = await loadSrc<EventsModule>("events/v1.ts");
const { parseChannelProtectedHistory } = await loadSrc<ChannelHydrationModule>(
  "hydration/channel.ts",
);
const { AUDIT_LOG_ACTIONS } = await loadSrc<AuditModule>("classes/AuditLog.ts");

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
const GROUP = "01K6S000000000000000000006";
const UNCACHED = "01K6S000000000000000000007";

/** The moment the channel was protected. */
const T = 1_700_000_000_000;
/** The boundary: the last message written before the channel was protected. */
const B = ulidAt(T, "5");
const OLD = ulidAt(T - 1000, "1");
const OLD2 = ulidAt(T - 2000, "2");
const OLD_ENC = ulidAt(T - 3000, "3");
const OLD_LOCAL = ulidAt(T - 3500, "7");
const OLD_OTHER = ulidAt(T - 4000, "4");
/** Written a second after the boundary. */
const NEW = ulidAt(T + 1000, "1");

const REVEAL = { boundary: B, timeLimit: T };

const TEXT = "server text";
const AT = "2026-11-23T10:00:00.000Z";

const ENCRYPTED = {
  v: 1,
  group_id: "g",
  epoch: 3,
  sender_device_id: "d",
  nonce: "n",
  ciphertext: "c",
  sig: "s",
};

// Exact backend 2efca34c JSON (`v0::ProtectedHistory`, `HistoryWipe` tagged
// by `state`, snake_case)
const WIRE_NONE = `{"boundary":"${B}","wipe":{"state":"none"}}`;
const WIRE_REQUESTED = `{"boundary":"${B}","wipe":{"state":"requested","at":"${AT}","by":"${ME}"}}`;
const WIRE_DONE = `{"boundary":"${B}","wipe":{"state":"done","at":"${AT}","count":12}}`;

const NONE = { boundary: B, wipe: { state: "none" } };
const REQUESTED = { boundary: B, wipe: { state: "requested", at: AT, by: ME } };
const DONE = { boundary: B, wipe: { state: "done", at: AT, count: 12 } };

type ServerEvent = { type: string } & Record<string, unknown>;

type Bulk = { ids: string[]; channelId: string | undefined };

type Harness = {
  client: StoatClient;
  emitted: string[];
  bulks: Bulk[];
  created: { id: string; content: string }[];
  liveRows: string[];
  relayed: unknown[];
  local: Set<string>;
  fire: (event: ServerEvent) => Promise<void>;
  serve: (rows: unknown) => void;
};

function noop(): void {}

/** A fresh offline client with an adapter stub. */
function setup(): Harness {
  const data = new Map<string, string>();
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )) as never;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };

  const client = new Client(
    { autoReconnect: false, syncUnreads: true },
    CONFIG as never,
  );

  const liveRows: string[] = [];
  const relayed: unknown[] = [];
  const local = new Set<string>();
  client.e2ee = {
    isEncryptedMessage: (id: string) => local.has(id),
    onChannelProtected: noop,
    onProtectedFlagStripped: noop,
    onProtectedMessage: (message: { id: string }) =>
      void liveRows.push(message.id),
    decryptProtectedHistory: noop,
    onEvent: (event: unknown) => void relayed.push(event),
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

  const bulks: Bulk[] = [];
  client.on("messageDeleteBulk", (rows, channel) => {
    bulks.push({
      ids: rows.map((row) => row.id).sort(),
      channelId: channel?.id,
    });
  });

  // What a `messageCreate` listener can read at the moment it runs
  const created: { id: string; content: string }[] = [];
  client.on("messageCreate", (message) => {
    created.push({ id: message.id, content: message.content });
  });

  return {
    client,
    emitted,
    bulks,
    created,
    liveRows,
    relayed,
    local,
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

/** A wire row with server-controlled text, mentions and mass-mention bits. */
function row(id: string, channel: string, extra = {}) {
  return {
    _id: id,
    channel,
    author: OTHER,
    content: TEXT,
    embeds: [{ type: "Text", description: TEXT }],
    mentions: [ME],
    // SuppressNotifications mask + MentionsEveryone + MentionsOnline bits
    flags: 1 | (1 << 2) | (1 << 3),
    ...extra,
  };
}

/** The server-controlled part of a stored row. */
function state(client: StoatClient, id: string) {
  const raw = client.messages.getUnderlyingObject(id);
  return {
    content: raw.content,
    embeds: raw.embeds?.length,
    mentionIds: raw.mentionIds && [...raw.mentionIds],
    flags: raw.flags,
  };
}

const STRIPPED = {
  content: undefined,
  embeds: undefined,
  mentionIds: undefined,
  flags: 1,
};

const REVEALED = {
  content: TEXT,
  embeds: 1,
  mentionIds: [ME],
  flags: 1 | (1 << 2) | (1 << 3),
};

function update(id: string, data: Record<string, unknown>): ServerEvent {
  return { type: "ChannelUpdate", id, data, clear: [] };
}

/** Plain copy of what `channel.protectedHistory` holds. */
function historyOf(client: StoatClient, id: string) {
  const value = client.channels.get(id)?.protectedHistory;
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * Two protected channels with a reveal each. CH holds two revealed rows, a
 * row that carries `encrypted`, a local end-to-end encrypted row and a row
 * above the boundary; CH2 holds one revealed row.
 */
async function populated(history?: unknown): Promise<Harness> {
  const h = setup();
  await h.fire(
    ready([
      textChannel(CH, {
        protected: true,
        ...(history === undefined ? {} : { protected_history: history }),
      }),
      textChannel(CH2, { protected: true }),
    ]),
  );
  h.client.user = h.client.users.get(ME);
  h.client.revealPreProtectRows(CH, REVEAL);
  h.client.revealPreProtectRows(CH2, REVEAL);

  h.local.add(OLD_LOCAL);
  h.serve([
    row(OLD, CH),
    row(OLD2, CH),
    row(OLD_ENC, CH, { encrypted: ENCRYPTED }),
    row(OLD_LOCAL, CH),
    row(NEW, CH),
  ]);
  await h.client.channels.get(CH)!.fetchMessages();
  h.serve([row(OLD_OTHER, CH2)]);
  await h.client.channels.get(CH2)!.fetchMessages();

  h.emitted.length = 0;
  return h;
}

function cachedIds(client: StoatClient): string[] {
  return [...client.messages.keys()].sort();
}

// --- hydration ------------------------------------------------------------

for (const [name, wire, want] of [
  ["none", WIRE_NONE, NONE],
  ["requested", WIRE_REQUESTED, REQUESTED],
  ["done", WIRE_DONE, DONE],
] as const) {
  test(`protected_history: the backend JSON with wipe ${name} hydrates as channel.protectedHistory`, async () => {
    const h = setup();
    await h.fire(
      ready([
        textChannel(CH, {
          protected: true,
          protected_history: JSON.parse(wire),
        }),
      ]),
    );

    assert.deepEqual(historyOf(h.client, CH), want);
    assert.deepEqual(parseChannelProtectedHistory(JSON.parse(wire)), want);
    // Still an ordinary protected channel in every other respect
    assert.equal(h.client.channels.get(CH)!.isProtected, true);
  });
}

test("protected_history: a channel without the field has no protectedHistory", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));

  assert.equal(h.client.channels.get(CH)!.protectedHistory, undefined);
  assert.equal(h.client.protectedHistory.isWiped(CH), false);
});

const MALFORMED: [string, unknown][] = [
  ["a capitalised state", { boundary: B, wipe: { state: "None" } }],
  ["an unknown state", { boundary: B, wipe: { state: "pending" } }],
  ["an empty wipe", { boundary: B, wipe: {} }],
  ["no wipe", { boundary: B }],
  ["a wipe that is a string", { boundary: B, wipe: "done" }],
  ["a null wipe", { boundary: B, wipe: null }],
  ["a missing boundary", { wipe: { state: "none" } }],
  ["an empty boundary", { boundary: "", wipe: { state: "none" } }],
  ["a boundary that is a number", { boundary: 5, wipe: { state: "none" } }],
  ["an empty object", {}],
  ["null", null],
  ["a string", "none"],
  ["an array", [B, "none"]],
  [
    "requested without by",
    { boundary: B, wipe: { state: "requested", at: AT } },
  ],
  [
    "requested without at",
    { boundary: B, wipe: { state: "requested", by: ME } },
  ],
  ["done without a count", { boundary: B, wipe: { state: "done", at: AT } }],
  [
    "done with a string count",
    { boundary: B, wipe: { state: "done", at: AT, count: "12" } },
  ],
  [
    "done with a negative count",
    { boundary: B, wipe: { state: "done", at: AT, count: -1 } },
  ],
  [
    "done with a fractional count",
    { boundary: B, wipe: { state: "done", at: AT, count: 1.5 } },
  ],
  ["done without at", { boundary: B, wipe: { state: "done", count: 12 } }],
];

test("protected_history: a malformed value hydrates as undefined and never throws", async () => {
  for (const [name, raw] of MALFORMED) {
    assert.equal(parseChannelProtectedHistory(raw), undefined, name);

    const h = setup();
    await assert.doesNotReject(
      h.fire(
        ready([textChannel(CH, { protected: true, protected_history: raw })]),
      ),
      name,
    );
    assert.equal(h.client.channels.get(CH)!.protectedHistory, undefined, name);
    assert.equal(h.client.channels.get(CH)!.isProtected, true, name);
    assert.equal(h.client.protectedHistory.isWiped(CH), false, name);
  }
});

test("protected_history: only the known fields are kept", () => {
  assert.deepEqual(
    parseChannelProtectedHistory({
      boundary: B,
      extra: TEXT,
      wipe: { state: "none", at: AT, by: ME, count: 3, extra: TEXT },
    }),
    NONE,
  );
  assert.deepEqual(
    parseChannelProtectedHistory({
      boundary: B,
      wipe: { state: "done", at: AT, by: ME, count: 0, extra: TEXT },
    }),
    { boundary: B, wipe: { state: "done", at: AT, count: 0 } },
  );
});

test("protected_history: ignored on a channel that is not a server text channel", async () => {
  const h = setup();
  await h.fire(
    ready([
      {
        _id: GROUP,
        channel_type: "Group",
        name: "group",
        owner: ME,
        recipients: [ME],
        protected_history: JSON.parse(WIRE_DONE),
      },
    ]),
  );
  h.client.messages.getOrCreate(OLD, row(OLD, GROUP) as never);

  assert.equal(h.client.channels.get(GROUP)!.protectedHistory, undefined);
  assert.equal(h.client.protectedHistory.isWiped(GROUP), false);

  await h.fire(
    update(GROUP, { protected_history: JSON.parse(WIRE_REQUESTED) }),
  );

  assert.equal(h.client.channels.get(GROUP)!.protectedHistory, undefined);
  assert.equal(h.client.protectedHistory.isWiped(GROUP), false);
  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.deepEqual(h.bulks, []);
});

// --- a full object that arrives already wiped -----------------------------

for (const [name, wire] of [
  ["requested", WIRE_REQUESTED],
  ["done", WIRE_DONE],
] as const) {
  test(`a channel that arrives in Ready with the wipe ${name} is wiped: a reveal does nothing`, async () => {
    const h = setup();
    await h.fire(
      ready([
        textChannel(CH, {
          protected: true,
          protected_history: JSON.parse(wire),
        }),
      ]),
    );

    assert.equal(h.client.protectedHistory.isWiped(CH), true);

    h.client.revealPreProtectRows(CH, REVEAL);
    h.serve([row(OLD, CH)]);
    await h.client.channels.get(CH)!.fetchMessages();
    assert.deepEqual(state(h.client, OLD), STRIPPED);
  });
}

test("a channel that arrives in Ready with the wipe none is not wiped", async () => {
  const h = await populated(JSON.parse(WIRE_NONE));

  assert.equal(h.client.protectedHistory.isWiped(CH), false);
  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.deepEqual(h.bulks, []);
});

test("a fetched channel that arrives already wiped is marked wiped", async () => {
  const h = setup();
  await h.fire(ready([]));
  h.serve(
    textChannel(CH, {
      protected: true,
      protected_history: JSON.parse(WIRE_DONE),
    }),
  );

  const channel = await h.client.channels.fetch(CH);

  assert.deepEqual(historyOf(h.client, CH), DONE);
  assert.equal(channel.isProtected, true);
  assert.equal(h.client.protectedHistory.isWiped(CH), true);
});

test("ChannelCreate and ServerCreate objects that arrive already wiped are marked wiped", async () => {
  const h = setup();
  await h.fire(ready([]));

  await h.fire({
    type: "ChannelCreate",
    ...textChannel(CH, {
      protected: true,
      protected_history: JSON.parse(WIRE_REQUESTED),
    }),
  });
  assert.deepEqual(historyOf(h.client, CH), REQUESTED);
  assert.equal(h.client.protectedHistory.isWiped(CH), true);

  await h.fire({
    type: "ServerCreate",
    id: SERVER,
    server: {
      _id: SERVER,
      owner: OTHER,
      name: "server",
      channels: [CH2],
      default_permissions: 0,
    },
    channels: [
      textChannel(CH2, {
        protected: true,
        protected_history: JSON.parse(WIRE_DONE),
      }),
    ],
    emojis: [],
  });
  assert.deepEqual(historyOf(h.client, CH2), DONE);
  assert.equal(h.client.protectedHistory.isWiped(CH2), true);
});

test("a second Ready that reports a wipe purges the rows still cached", async () => {
  const h = await populated(JSON.parse(WIRE_NONE));
  // The unread sync of the second Ready reads through the same stub
  h.serve([]);

  await h.fire(
    ready([
      textChannel(CH, {
        protected: true,
        protected_history: JSON.parse(WIRE_DONE),
      }),
      textChannel(CH2, { protected: true }),
    ]),
  );

  assert.deepEqual(historyOf(h.client, CH), DONE);
  assert.equal(h.client.protectedHistory.isWiped(CH), true);
  assert.deepEqual(
    cachedIds(h.client),
    [OLD_ENC, OLD_LOCAL, OLD_OTHER, NEW].sort(),
  );
  assert.deepEqual(h.bulks, [{ ids: [OLD, OLD2].sort(), channelId: CH }]);
});

// --- ChannelUpdate: the wipe purge ----------------------------------------

test("ChannelUpdate with the wipe requested removes the cached plaintext rows at or below the boundary of that channel only, and announces them", async () => {
  const h = await populated();
  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.deepEqual(state(h.client, OLD_OTHER), REVEALED);

  await h.fire(update(CH, { protected_history: JSON.parse(WIRE_REQUESTED) }));

  // Plaintext rows at or below the boundary are gone; the row that carries
  // `encrypted`, the local encrypted row, the row above the boundary and
  // the other channel's row stay
  assert.deepEqual(
    cachedIds(h.client),
    [OLD_ENC, OLD_LOCAL, OLD_OTHER, NEW].sort(),
  );
  assert.deepEqual(state(h.client, OLD_OTHER), REVEALED);
  assert.deepEqual(state(h.client, NEW), STRIPPED);
  assert.notEqual(
    h.client.messages.getUnderlyingObject(OLD_ENC).encrypted,
    undefined,
  );

  assert.deepEqual(h.bulks, [{ ids: [OLD, OLD2].sort(), channelId: CH }]);
  assert.deepEqual(h.emitted, ["messageDeleteBulk", "channelUpdate"]);

  assert.deepEqual(historyOf(h.client, CH), REQUESTED);
  assert.equal(h.client.protectedHistory.isWiped(CH), true);
  assert.equal(h.client.protectedHistory.isWiped(CH2), false);
  assert.equal(h.client.channels.get(CH2)!.protectedHistory, undefined);
});

test("ChannelUpdate with the wipe done after requested replaces the value and purges rows cached in between", async () => {
  const h = await populated();
  await h.fire(update(CH, { protected_history: JSON.parse(WIRE_REQUESTED) }));

  // The job has not deleted the rows yet: a fetch still returns one. It is
  // stored stripped (the channel is wiped) and goes with the next update
  h.serve([row(OLD, CH)]);
  await h.client.channels.get(CH)!.fetchMessages();
  assert.deepEqual(state(h.client, OLD), STRIPPED);
  h.bulks.length = 0;

  await h.fire(update(CH, { protected_history: JSON.parse(WIRE_DONE) }));

  assert.deepEqual(historyOf(h.client, CH), DONE);
  assert.equal(h.client.messages.has(OLD), false);
  assert.deepEqual(h.bulks, [{ ids: [OLD], channelId: CH }]);
});

test("ChannelUpdate with the wipe none lands the value and removes nothing", async () => {
  const h = await populated();
  const before = cachedIds(h.client);

  await h.fire(update(CH, { protected_history: JSON.parse(WIRE_NONE) }));

  assert.deepEqual(historyOf(h.client, CH), NONE);
  assert.deepEqual(cachedIds(h.client), before);
  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.equal(h.client.protectedHistory.isWiped(CH), false);
  assert.deepEqual(h.bulks, []);
  assert.deepEqual(h.emitted, ["channelUpdate"]);
});

test("ChannelUpdate without protected_history changes nothing about it", async () => {
  const h = await populated(JSON.parse(WIRE_NONE));
  const before = cachedIds(h.client);

  await h.fire(update(CH, { name: "renamed" }));

  assert.equal(h.client.channels.get(CH)!.name, "renamed");
  assert.deepEqual(historyOf(h.client, CH), NONE);
  assert.deepEqual(cachedIds(h.client), before);
  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.equal(h.client.protectedHistory.isWiped(CH), false);
  assert.deepEqual(h.bulks, []);
  assert.deepEqual(h.emitted, ["channelUpdate"]);
});

test("ChannelUpdate with a malformed protected_history keeps the value held and removes nothing", async () => {
  const h = await populated(JSON.parse(WIRE_NONE));
  const before = cachedIds(h.client);

  for (const [name, raw] of MALFORMED) {
    await assert.doesNotReject(
      h.fire(update(CH, { protected_history: raw })),
      name,
    );
    assert.deepEqual(historyOf(h.client, CH), NONE, name);
    assert.deepEqual(cachedIds(h.client), before, name);
    assert.equal(h.client.protectedHistory.isWiped(CH), false, name);
  }
  assert.deepEqual(h.bulks, []);
});

test("ChannelUpdate that protects and wipes at once strips the rows above the boundary and removes the rest", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH)]));
  h.client.user = h.client.users.get(ME);
  h.serve([row(OLD, CH), row(NEW, CH)]);
  await h.client.channels.get(CH)!.fetchMessages();
  assert.deepEqual(state(h.client, NEW), REVEALED);

  await h.fire(
    update(CH, {
      protected: true,
      protected_history: JSON.parse(WIRE_REQUESTED),
    }),
  );

  assert.deepEqual(cachedIds(h.client), [NEW]);
  assert.deepEqual(state(h.client, NEW), STRIPPED);
  assert.deepEqual(h.bulks, [{ ids: [OLD], channelId: CH }]);
  // Nothing of the channel is revealed afterwards
  h.client.revealPreProtectRows(CH, { boundary: NEW, timeLimit: T + 1000 });
  assert.deepEqual(state(h.client, NEW), STRIPPED);
});

test("ChannelUpdate with a wipe for a channel that is not cached still purges its rows", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH)]));
  h.client.messages.getOrCreate(OLD, row(OLD, UNCACHED) as never);
  h.client.messages.getOrCreate(OLD2, row(OLD2, CH) as never);

  await h.fire(
    update(UNCACHED, { protected_history: JSON.parse(WIRE_REQUESTED) }),
  );

  assert.deepEqual(cachedIds(h.client), [OLD2]);
  assert.deepEqual(h.bulks, [{ ids: [OLD], channelId: undefined }]);
  assert.equal(h.client.protectedHistory.isWiped(UNCACHED), true);
  assert.equal(h.client.channels.has(UNCACHED), false);
});

// --- live rows (R-W4-17) --------------------------------------------------

test("a live row with a pre-boundary id is never revealed: stored stripped, no text in messageCreate, nothing stashed", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));
  h.client.user = h.client.users.get(ME);
  h.client.revealPreProtectRows(CH, REVEAL);
  // The reveal would cover this row had it come from a fetch
  assert.equal(
    h.client.protectedHistory.covers(CH, { id: OLD, encrypted: false }),
    true,
  );

  await h.fire({ type: "Message", ...row(OLD, CH) });

  assert.deepEqual(state(h.client, OLD), STRIPPED);
  assert.deepEqual(h.created, [{ id: OLD, content: "" }]);
  assert.equal(h.client.messages.get(OLD)!.mentioned, false);
  assert.equal(h.client.protectedHistory.hasStash(OLD), false);
  assert.deepEqual(h.liveRows, [OLD]);

  // A later reveal pass (the time limit moves) restores nothing for it
  h.client.revealPreProtectRows(CH, { boundary: B, timeLimit: T + 1 });
  assert.deepEqual(state(h.client, OLD), STRIPPED);
});

test("a live row that arrives before the reveal is not revealed by it either", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));
  h.client.user = h.client.users.get(ME);

  await h.fire({ type: "Message", ...row(OLD, CH) });
  assert.equal(h.client.protectedHistory.hasStash(OLD), false);

  h.client.revealPreProtectRows(CH, REVEAL);

  assert.deepEqual(state(h.client, OLD), STRIPPED);
  assert.equal(h.client.protectedHistory.stashSize, 0);
});

test("a live row whose flags are not a number keeps none of them", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));
  h.client.user = h.client.users.get(ME);
  h.client.revealPreProtectRows(CH, REVEAL);

  await h.fire({ type: "Message", ...row(OLD, CH, { flags: "12" }) });

  assert.equal(h.client.messages.getUnderlyingObject(OLD).flags, undefined);
  assert.equal(h.client.messages.get(OLD)!.mentioned, false);
});

test("a live ephemeral row with a pre-boundary id is never revealed", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));
  h.client.user = h.client.users.get(ME);
  h.client.revealPreProtectRows(CH, REVEAL);

  await h.fire({ type: "InteractionEphemeralMessage", message: row(OLD, CH) });

  assert.deepEqual(state(h.client, OLD), STRIPPED);
  assert.deepEqual(h.created, [{ id: OLD, content: "" }]);
  assert.equal(h.client.protectedHistory.hasStash(OLD), false);
});

test("control: the same row from a fetch is revealed, and a live row of an ordinary channel keeps its text", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true }), textChannel(CH2)]));
  h.client.user = h.client.users.get(ME);
  h.client.revealPreProtectRows(CH, REVEAL);

  h.serve([row(OLD, CH)]);
  await h.client.channels.get(CH)!.fetchMessages();
  assert.deepEqual(state(h.client, OLD), REVEALED);

  await h.fire({ type: "Message", ...row(OLD2, CH2) });
  assert.deepEqual(state(h.client, OLD2), REVEALED);
  assert.deepEqual(h.created, [{ id: OLD2, content: TEXT }]);
});

test("a live row that carries encrypted is stored stripped with its payload and goes to the adapter", async () => {
  const h = setup();
  await h.fire(ready([textChannel(CH, { protected: true })]));
  h.client.user = h.client.users.get(ME);
  h.client.revealPreProtectRows(CH, REVEAL);

  await h.fire({
    type: "Message",
    ...row(OLD, CH, { encrypted: ENCRYPTED }),
  });

  assert.deepEqual(state(h.client, OLD), STRIPPED);
  assert.notEqual(
    h.client.messages.getUnderlyingObject(OLD).encrypted,
    undefined,
  );
  assert.equal(h.client.protectedHistory.hasStash(OLD), false);
  assert.deepEqual(h.liveRows, [OLD]);
});

// --- relay, audit actions, root exports -----------------------------------

test("ProtectedChannelChanged with scope history relays to the adapter unchanged", async () => {
  const h = await populated();
  const wire = `{"type":"ProtectedChannelChanged","id":"${CH}","scope":["history"]}`;
  const event = JSON.parse(wire) as ServerEvent;
  const before = cachedIds(h.client);

  await h.fire(event);

  assert.equal(h.relayed.length, 1);
  assert.equal(h.relayed[0], event, "the same object, not a copy");
  assert.equal(JSON.stringify(h.relayed[0]), wire);
  // A refetch hint only: no purge, no reveal change, nothing emitted
  assert.deepEqual(h.emitted, []);
  assert.deepEqual(cachedIds(h.client), before);
  assert.deepEqual(state(h.client, OLD), REVEALED);
  assert.equal(h.client.protectedHistory.isWiped(CH), false);
});

test("audit log: channel_protect and channel_history_wipe are known actions", () => {
  assert.deepEqual(AUDIT_LOG_ACTIONS.slice(-2), [
    "channel_protect",
    "channel_history_wipe",
  ]);
  assert.equal(new Set(AUDIT_LOG_ACTIONS).size, AUDIT_LOG_ACTIONS.length);
  // S4 stays strict (W4 addendum 9, item 4): the two S2 actions are not
  // added here
  const actions: readonly string[] = AUDIT_LOG_ACTIONS;
  assert.equal(actions.includes("protected_seats_update"), false);
  assert.equal(actions.includes("protected_seat_release"), false);
});

test("the package root exports the pre-protect reveal helpers", async () => {
  const root = await loadSrc<RootModule>("index.ts");

  assert.equal(typeof root.ulidTimeMs, "function");
  assert.equal(root.ulidTimeMs(B), T);
  assert.equal(typeof root.preProtectRevealed, "function");
  assert.equal(typeof root.ProtectedHistoryState, "function");
  assert.equal(root.PRE_PROTECT_STASH_LIMIT, 2000);
});
