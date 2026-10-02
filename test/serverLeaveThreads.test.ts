/**
 * Leaving or losing a server purges everything cached under it.
 *
 * `Server.$delete` used to delete only `channelIds`, the channels the server
 * was hydrated with. Threads, forum posts and channels created later stayed
 * in `client.channels`, and every message in every channel stayed in
 * `client.messages`, after the server itself was gone. These cases pin the
 * sweep: every channel pointing at the server goes, with its messages, while
 * other servers, DMs and unread rows are left alone, and nothing is fetched
 * or emitted per item.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/serverLeaveThreads.test.ts
 *
 * To run the same cases against another `src/` tree, such as a known-bad
 * control exported from an older commit, set `STOATJS_SRC` to its absolute
 * path. The tree needs a sibling `node_modules` symlink (see loadSrc.ts):
 *
 *   STOATJS_SRC=/abs/path/to/ctl/src \
 *     node --test --conditions=browser test/serverLeaveThreads.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSrc } from "./loadSrc.ts";

type ClientModule = typeof import("../src/Client.ts");
type EventsModule = typeof import("../src/events/v1.ts");
type StoatClient = InstanceType<ClientModule["Client"]>;

const { Client } = await loadSrc<ClientModule>("Client.ts");
const { handleEvent } = await loadSrc<EventsModule>("events/v1.ts");

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

// Users
const ME = "01K6A000000000000000000001";
const OTHER = "01K6A000000000000000000002";

// Server A: a text channel with a thread, a forum with a post, and a thread
// whose parent channel is not cached
const A = "01K6A000000000000000000003";
const CH = "01K6A000000000000000000004";
const F = "01K6A000000000000000000005";
const TH = "01K6A000000000000000000006";
const P = "01K6A000000000000000000007";
const TO = "01K6A000000000000000000008";
const TO_PARENT = "01K6A000000000000000000009";

// Server B, which must survive A's sweep
const B = "01K6A00000000000000000000A";
const BCH = "01K6A00000000000000000000B";
const BTH = "01K6A00000000000000000000C";

// A direct message, which belongs to no server
const DM = "01K6A00000000000000000000D";

// One message per channel
const M_CH = "01K6A00000000000000000000E";
const M_TH = "01K6A00000000000000000000F";
const M_P = "01K6A00000000000000000000G";
const M_TO = "01K6A00000000000000000000H";
const M_BCH = "01K6A00000000000000000000J";
const M_BTH = "01K6A00000000000000000000K";
const M_DM = "01K6A00000000000000000000M";

// Never seeded anywhere
const UNKNOWN_SERVER = "01K6A00000000000000000000N";

const A_CHANNELS: Record<string, string> = { CH, F, TH, P, TO };
const A_MESSAGES: Record<string, string> = { M_CH, M_TH, M_P, M_TO };

// Per-item events the sweep must never emit: the app reacts to the single
// serverDelete instead
const PER_ITEM_EVENTS = [
  "serverLeave",
  "channelDelete",
  "messageDelete",
  "messageDeleteBulk",
  "threadMemberLeave",
];

type ServerEvent = { type: string } & Record<string, unknown>;

type Harness = {
  client: StoatClient;
  emitted: string[];
  fetched: string[];
  fire: (event: ServerEvent) => Promise<void>;
};

function noop(): void {}

/**
 * A fresh offline client seeded with servers A and B and a DM, so every case
 * starts from the same state and none depends on another's events.
 */
function setup(): Harness {
  const fetched: string[] = [];
  globalThis.fetch = ((url: unknown) => {
    fetched.push(String(url));
    return new Promise<never>(noop);
  }) as never;

  const client = new Client({ autoReconnect: false }, CONFIG as never);

  const emitted: string[] = [];
  const emit = client.emit.bind(client) as (
    name: string,
    ...args: unknown[]
  ) => unknown;
  (client as unknown as { emit: typeof emit }).emit = (name, ...args) => {
    emitted.push(name);
    return emit(name, ...args);
  };

  const ids = [
    ME,
    OTHER,
    A,
    CH,
    F,
    TH,
    P,
    TO,
    TO_PARENT,
    B,
    BCH,
    BTH,
    DM,
    M_CH,
    M_TH,
    M_P,
    M_TO,
    M_BCH,
    M_BTH,
    M_DM,
    UNKNOWN_SERVER,
  ];
  for (const id of ids) {
    assert.match(id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/, `${id} is not a ULID`);
  }
  assert.equal(new Set(ids).size, ids.length, "seed ids must be distinct");

  client.user = client.users.getOrCreate(ME, {
    _id: ME,
    username: "me",
    discriminator: "0001",
    relationship: "User",
    online: true,
  } as never);

  // Channels first, then the server, in the order ServerCreate applies them
  client.channels.getOrCreate(CH, {
    _id: CH,
    channel_type: "TextChannel",
    server: A,
    name: "general",
  } as never);
  client.channels.getOrCreate(F, {
    _id: F,
    channel_type: "Forum",
    server: A,
    name: "forum",
  } as never);
  client.servers.getOrCreate(A, {
    _id: A,
    owner: ME,
    name: "a",
    channels: [CH, F],
    roles: {},
    default_permissions: 0,
  } as never);

  // Threads and posts arrive later and are never added to channelIds
  client.channels.getOrCreate(TH, {
    _id: TH,
    channel_type: "Thread",
    server: A,
    parent_channel: CH,
    name: "thread",
    creator: ME,
  } as never);
  client.channels.getOrCreate(P, {
    _id: P,
    channel_type: "Thread",
    server: A,
    parent_channel: F,
    name: "post",
    creator: ME,
  } as never);
  client.channels.getOrCreate(TO, {
    _id: TO,
    channel_type: "Thread",
    server: A,
    parent_channel: TO_PARENT,
    name: "orphan",
    creator: ME,
  } as never);
  client.channels.get(TH)!.threadMembers.add(ME);

  client.channels.getOrCreate(BCH, {
    _id: BCH,
    channel_type: "TextChannel",
    server: B,
    name: "b-general",
  } as never);
  client.servers.getOrCreate(B, {
    _id: B,
    owner: OTHER,
    name: "b",
    channels: [BCH],
    roles: {},
    default_permissions: 0,
  } as never);
  client.channels.getOrCreate(BTH, {
    _id: BTH,
    channel_type: "Thread",
    server: B,
    parent_channel: BCH,
    name: "b-thread",
    creator: OTHER,
  } as never);

  client.channels.getOrCreate(DM, {
    _id: DM,
    channel_type: "DirectMessage",
    active: true,
    recipients: [ME, OTHER],
  } as never);

  const messages: [string, string][] = [
    [M_CH, CH],
    [M_TH, TH],
    [M_P, P],
    [M_TO, TO],
    [M_BCH, BCH],
    [M_BTH, BTH],
    [M_DM, DM],
  ];
  for (const [id, channel] of messages) {
    client.messages.getOrCreate(id, {
      _id: id,
      channel,
      author: ME,
      content: `in ${channel}`,
    } as never);
  }

  client.channelUnreads.getOrCreate(TH, {
    _id: { channel: TH, user: ME },
    last_id: M_TH,
    mentions: [],
  });
  client.channelUnreads.getOrCreate(CH, {
    _id: { channel: CH, user: ME },
    last_id: M_CH,
    mentions: [],
  });

  // Gives the non-self leave something to act on, so that case cannot pass
  // by the event being ignored outright
  client.serverMembers.getOrCreate({ server: A, user: OTHER }, {
    _id: { server: A, user: OTHER },
    joined_at: "2026-01-01T00:00:00.000Z",
    roles: [],
  } as never);

  // Hydration drops a misspelled key with only a console.debug, so check the
  // seed landed before any case relies on it
  assert.equal(client.user?.id, ME);
  assert.ok(client.servers.has(A));
  assert.ok(client.servers.has(B));
  assert.ok(client.servers.get(A)!.channelIds.has(CH));
  assert.ok(client.servers.get(A)!.channelIds.has(F));
  assert.ok(client.servers.get(B)!.channelIds.has(BCH));
  for (const [id, server] of [
    [CH, A],
    [F, A],
    [TH, A],
    [P, A],
    [TO, A],
    [BCH, B],
    [BTH, B],
  ]) {
    assert.equal(client.channels.get(id)?.serverId, server, `${id} serverId`);
  }
  assert.ok(client.channels.has(DM));
  assert.equal(client.channels.get(DM)!.serverId, undefined);
  assert.ok(client.channels.get(F)!.isForum);
  assert.ok(client.channels.get(TH)!.isThread);
  assert.ok(client.channels.get(P)!.isForumPost);
  assert.equal(client.channels.has(TO_PARENT), false);
  assert.equal(client.channels.get(TO)!.parentChannelId, TO_PARENT);
  assert.ok(client.channels.get(TH)!.threadMembers.has(ME));
  for (const [id, channel] of messages) {
    assert.equal(client.messages.get(id)?.channelId, channel, `${id} channel`);
  }
  assert.equal(client.channelUnreads.get(TH)?.lastMessageId, M_TH);
  assert.equal(client.channelUnreads.get(CH)?.lastMessageId, M_CH);
  assert.ok(client.serverMembers.hasByKey({ server: A, user: OTHER }));
  assert.deepEqual(emitted, [], "seeding must not emit");

  return {
    client,
    emitted,
    fetched,
    fire: (event) => handleEvent(client, event as never, noop as never),
  };
}

function count(emitted: string[], name: string): number {
  return emitted.filter((entry) => entry === name).length;
}

function assertAChannelsGone(client: StoatClient): void {
  assert.equal(client.servers.has(A), false, "server A");
  for (const [name, id] of Object.entries(A_CHANNELS)) {
    assert.equal(client.channels.has(id), false, `channel ${name}`);
  }
  assert.deepEqual(
    client.channels.filter((channel) => channel.serverId === A),
    [],
    "no cached channel may still point at A",
  );
}

function assertAMessagesGone(client: StoatClient): void {
  for (const [name, id] of Object.entries(A_MESSAGES)) {
    assert.equal(client.messages.has(id), false, `message ${name}`);
  }
  const channels = new Set(Object.values(A_CHANNELS));
  assert.deepEqual(
    client.messages.filter((message) => channels.has(message.channelId)),
    [],
    "no cached message may still sit in one of A's channels",
  );
}

function assertSweepEvents(harness: Harness): void {
  assert.equal(count(harness.emitted, "serverDelete"), 1, "serverDelete");
  for (const name of PER_ITEM_EVENTS) {
    assert.equal(count(harness.emitted, name), 0, name);
  }
  assert.deepEqual(harness.fetched, [], "the sweep must not fetch");
}

const SELF_LEAVE: ServerEvent = {
  type: "ServerMemberLeave",
  id: A,
  user: ME,
  reason: "Ban",
};
const DELETE_A: ServerEvent = { type: "ServerDelete", id: A };

test("0 the seeded state hydrates as written", () => {
  setup();
});

test("1a self ServerMemberLeave removes the server and every channel under it, threads and forum posts included", async () => {
  const { client, fire } = setup();
  await fire(SELF_LEAVE);
  assertAChannelsGone(client);
});

test("1b self ServerMemberLeave removes the messages in all of the server's channels", async () => {
  const { client, fire } = setup();
  await fire(SELF_LEAVE);
  assertAMessagesGone(client);
});

test("1c self ServerMemberLeave empties threadMembers on a thread instance held across the sweep", async () => {
  const { client, fire } = setup();
  const held = client.channels.get(TH)!;
  await fire(SELF_LEAVE);
  assert.equal(held.threadMembers.size, 0);
});

test("2 another server's channels, threads and messages, and DMs, survive the sweep", async () => {
  const { client, fire } = setup();
  await fire(SELF_LEAVE);
  assert.ok(client.servers.has(B), "server B");
  assert.ok(client.servers.get(B)!.channelIds.has(BCH), "B channelIds");
  for (const id of [BCH, BTH]) {
    assert.equal(client.channels.get(id)?.serverId, B, `channel ${id}`);
  }
  assert.ok(client.channels.has(DM), "DM channel");
  for (const id of [M_BCH, M_BTH, M_DM]) {
    assert.ok(client.messages.has(id), `message ${id}`);
  }
  assert.ok(client.users.has(ME), "own user");
});

test("3 unread rows for the swept channels are kept", async () => {
  const { client, fire } = setup();
  await fire(SELF_LEAVE);
  assert.equal(client.channelUnreads.get(TH)?.lastMessageId, M_TH, "TH row");
  assert.equal(client.channelUnreads.get(CH)?.lastMessageId, M_CH, "CH row");
});

test("4a ServerDelete removes the server and every channel under it", async () => {
  const { client, fire } = setup();
  await fire(DELETE_A);
  assertAChannelsGone(client);
});

test("4b ServerDelete removes the messages in all of the server's channels", async () => {
  const { client, fire } = setup();
  await fire(DELETE_A);
  assertAMessagesGone(client);
});

test("5 another member leaving sweeps nothing", async () => {
  const { client, emitted, fire } = setup();
  await fire({ type: "ServerMemberLeave", id: A, user: OTHER });

  // The event was handled, not ignored
  assert.equal(
    client.serverMembers.hasByKey({ server: A, user: OTHER }),
    false,
    "OTHER's member row",
  );
  assert.equal(count(emitted, "serverMemberLeave"), 1, "serverMemberLeave");

  assert.equal(count(emitted, "serverDelete"), 0, "serverDelete");
  assert.ok(client.servers.has(A), "server A");
  for (const [name, id] of Object.entries(A_CHANNELS)) {
    assert.ok(client.channels.has(id), `channel ${name}`);
  }
  for (const [name, id] of Object.entries(A_MESSAGES)) {
    assert.ok(client.messages.has(id), `message ${name}`);
  }
  assert.ok(client.channels.get(TH)!.threadMembers.has(ME), "TH members");
});

test("6a a repeat ServerDelete after the sweep is a no-op", async () => {
  const { client, emitted, fire } = setup();
  await fire(DELETE_A);
  await assert.doesNotReject(fire(DELETE_A));
  assert.equal(count(emitted, "serverDelete"), 1, "serverDelete");
  assert.ok(client.servers.has(B), "server B");
  assert.ok(client.channels.has(BCH), "channel BCH");
  assert.ok(client.messages.has(M_BCH), "message M_BCH");
});

test("6b a ServerDelete for an unknown server is a no-op", async () => {
  const { client, emitted, fetched, fire } = setup();
  await assert.doesNotReject(
    fire({ type: "ServerDelete", id: UNKNOWN_SERVER }),
  );
  assert.deepEqual(emitted, [], "nothing emitted");
  assert.deepEqual(fetched, [], "nothing fetched");
  assert.equal(client.servers.has(UNKNOWN_SERVER), false, "no partial");
  for (const id of [A, B]) {
    assert.ok(client.servers.has(id), `server ${id}`);
  }
  for (const [name, id] of Object.entries(A_CHANNELS)) {
    assert.ok(client.channels.has(id), `channel ${name}`);
  }
  for (const [name, id] of Object.entries(A_MESSAGES)) {
    assert.ok(client.messages.has(id), `message ${name}`);
  }
});

test("7a self ServerMemberLeave emits one serverDelete, no per-item events, and fetches nothing", async () => {
  const harness = setup();
  await harness.fire(SELF_LEAVE);
  assertSweepEvents(harness);
});

test("7b ServerDelete emits one serverDelete, no per-item events, and fetches nothing", async () => {
  const harness = setup();
  await harness.fire(DELETE_A);
  assertSweepEvents(harness);
});
