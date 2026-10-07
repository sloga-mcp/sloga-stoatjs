/**
 * Deleting or leaving a server must only purge what belongs to that server.
 *
 * `Server.$delete` builds its purge set from `channelIds`, which is taken
 * from the server's own payload. A listed id whose cached channel is a DM,
 * group, saved messages or another server's channel is not part of this
 * server, so neither that channel nor its messages may be removed. Decrypted
 * end-to-end encrypted rows exist only on this device and are never server
 * messages, so the message purge always leaves them alone. A normal server's
 * own channels and messages, and listed ids that are not cached, are still
 * swept as before.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/serverDeleteEncryptedRows.test.ts
 *
 * To run the same cases against another `src/` tree, such as a known-bad
 * control exported from an older commit, set `STOATJS_SRC` to its absolute
 * path. The tree needs a sibling `node_modules` symlink (see loadSrc.ts):
 *
 *   STOATJS_SRC=/abs/path/to/ctl/src \
 *     node --test --conditions=browser test/serverDeleteEncryptedRows.test.ts
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
const ME = "01K6B000000000000000000001";
const OTHER = "01K6B000000000000000000002";

// Server S, whose channel list names its own channels, an id that is not
// cached, and channels that belong elsewhere
const S = "01K6B000000000000000000003";
const CH = "01K6B000000000000000000004";
const CH2 = "01K6B000000000000000000005";
const UNCACHED = "01K6B000000000000000000006";

// Server B, whose channel S also lists
const B = "01K6B000000000000000000007";
const BCH = "01K6B000000000000000000008";

// Channels with no server
const DM = "01K6B000000000000000000009";
const GRP = "01K6B00000000000000000000A";
const SAVED = "01K6B00000000000000000000B";

// Messages: one plain row per channel, plus a decrypted row in the DM and
// one in a server channel
const M_CH = "01K6B00000000000000000000C";
const M_CH_E2EE = "01K6B00000000000000000000D";
const M_CH2 = "01K6B00000000000000000000E";
const M_UNCACHED = "01K6B00000000000000000000F";
const M_BCH = "01K6B00000000000000000000G";
const M_DM = "01K6B00000000000000000000H";
const M_DM_E2EE = "01K6B00000000000000000000J";
const M_GRP = "01K6B00000000000000000000K";
const M_SAVED = "01K6B00000000000000000000M";

const FOREIGN_CHANNELS: Record<string, string> = { BCH, DM, GRP, SAVED };
const FOREIGN_MESSAGES: Record<string, string> = {
  M_BCH,
  M_DM,
  M_DM_E2EE,
  M_GRP,
  M_SAVED,
};

// Rows the native layer decrypted on this device
const ENCRYPTED = new Set([M_CH_E2EE, M_DM_E2EE]);

type ServerEvent = { type: string } & Record<string, unknown>;

type Harness = {
  client: StoatClient;
  fire: (event: ServerEvent) => Promise<void>;
};

function noop(): void {}

/**
 * A fresh offline client seeded with servers S and B, a DM, a group and
 * saved messages. With `e2ee` set, an adapter stub reports the rows in
 * ENCRYPTED as decrypted local rows
 */
function setup(e2ee: boolean): Harness {
  globalThis.fetch = (() => new Promise<never>(noop)) as never;

  const client = new Client({ autoReconnect: false }, CONFIG as never);
  if (e2ee) {
    client.e2ee = {
      isEncryptedMessage: (id: string) => ENCRYPTED.has(id),
    } as never;
  }

  const ids = [
    ME,
    OTHER,
    S,
    CH,
    CH2,
    UNCACHED,
    B,
    BCH,
    DM,
    GRP,
    SAVED,
    M_CH,
    M_CH_E2EE,
    M_CH2,
    M_UNCACHED,
    M_BCH,
    M_DM,
    M_DM_E2EE,
    M_GRP,
    M_SAVED,
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

  client.channels.getOrCreate(DM, {
    _id: DM,
    channel_type: "DirectMessage",
    active: true,
    recipients: [ME, OTHER],
  } as never);
  client.channels.getOrCreate(GRP, {
    _id: GRP,
    channel_type: "Group",
    name: "group",
    owner: ME,
    recipients: [ME, OTHER],
  } as never);
  client.channels.getOrCreate(SAVED, {
    _id: SAVED,
    channel_type: "SavedMessages",
    user: ME,
  } as never);

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

  client.channels.getOrCreate(CH, {
    _id: CH,
    channel_type: "TextChannel",
    server: S,
    name: "general",
  } as never);
  client.channels.getOrCreate(CH2, {
    _id: CH2,
    channel_type: "TextChannel",
    server: S,
    name: "other",
  } as never);
  client.servers.getOrCreate(S, {
    _id: S,
    owner: OTHER,
    name: "s",
    channels: [CH, CH2, UNCACHED, BCH, DM, GRP, SAVED],
    roles: {},
    default_permissions: 0,
  } as never);

  const messages: [string, string][] = [
    [M_CH, CH],
    [M_CH_E2EE, CH],
    [M_CH2, CH2],
    [M_UNCACHED, UNCACHED],
    [M_BCH, BCH],
    [M_DM, DM],
    [M_DM_E2EE, DM],
    [M_GRP, GRP],
    [M_SAVED, SAVED],
  ];
  for (const [id, channel] of messages) {
    client.messages.getOrCreate(id, {
      _id: id,
      channel,
      author: ME,
      content: `in ${channel}`,
    } as never);
  }

  // Hydration drops a misspelled key with only a console.debug, so check the
  // seed landed before any case relies on it
  assert.equal(client.user?.id, ME);
  assert.ok(client.servers.has(S));
  assert.ok(client.servers.has(B));
  for (const id of [CH, CH2, UNCACHED, BCH, DM, GRP, SAVED]) {
    assert.ok(client.servers.get(S)!.channelIds.has(id), `S lists ${id}`);
  }
  for (const [id, server] of [
    [CH, S],
    [CH2, S],
    [BCH, B],
  ]) {
    assert.equal(client.channels.get(id)?.serverId, server, `${id} serverId`);
  }
  for (const id of [DM, GRP, SAVED]) {
    assert.ok(client.channels.has(id), `channel ${id}`);
    assert.equal(client.channels.get(id)!.serverId, undefined, `${id} server`);
  }
  assert.equal(client.channels.has(UNCACHED), false);
  for (const [id, channel] of messages) {
    assert.equal(client.messages.get(id)?.channelId, channel, `${id} channel`);
  }
  assert.equal(client.e2ee?.isEncryptedMessage(M_DM_E2EE) === true, e2ee);

  return {
    client,
    fire: (event) => handleEvent(client, event as never, noop as never),
  };
}

const DELETE_S: ServerEvent = { type: "ServerDelete", id: S };

function assertForeignKept(client: StoatClient): void {
  assert.ok(client.servers.has(B), "server B");
  for (const [name, id] of Object.entries(FOREIGN_CHANNELS)) {
    assert.ok(client.channels.has(id), `channel ${name}`);
  }
  for (const [name, id] of Object.entries(FOREIGN_MESSAGES)) {
    assert.ok(client.messages.has(id), `message ${name}`);
  }
}

function assertOwnPurged(client: StoatClient): void {
  assert.equal(client.servers.has(S), false, "server S");
  for (const [name, id] of Object.entries({ CH, CH2 })) {
    assert.equal(client.channels.has(id), false, `channel ${name}`);
  }
  for (const [name, id] of Object.entries({ M_CH, M_CH2, M_UNCACHED })) {
    assert.equal(client.messages.has(id), false, `message ${name}`);
  }
}

test("0 the seeded state hydrates as written", () => {
  setup(false);
  setup(true);
});

test("a1 ServerDelete keeps DM, group, saved and other-server channels the server listed, with their messages", async () => {
  const { client, fire } = setup(false);
  await fire(DELETE_S);
  assertForeignKept(client);
});

test("a2 the same holds with an E2EE adapter, decrypted DM row included", async () => {
  const { client, fire } = setup(true);
  await fire(DELETE_S);
  assertForeignKept(client);
  assert.ok(client.messages.has(M_DM_E2EE), "decrypted DM row");
});

test("a3 leaving the server keeps the listed foreign channels too", () => {
  const { client } = setup(true);
  client.servers.get(S)!.$delete(true);
  assertForeignKept(client);
  assertOwnPurged(client);
});

test("b a decrypted row in a server channel is skipped while a plain row beside it is deleted", async () => {
  const { client, fire } = setup(true);
  await fire(DELETE_S);
  assert.ok(client.messages.has(M_CH_E2EE), "decrypted row kept");
  assert.equal(client.messages.has(M_CH), false, "plain row deleted");
});

test("c1 the server's own channels and their messages are still purged, uncached listed id included", async () => {
  const { client, fire } = setup(false);
  await assert.doesNotReject(fire(DELETE_S));
  assertOwnPurged(client);
  assert.equal(client.messages.has(M_CH_E2EE), false, "no adapter: purged");
  assert.equal(client.channels.has(UNCACHED), false, "no partial created");
});

test("c2 the same purge runs with an E2EE adapter installed", async () => {
  const { client, fire } = setup(true);
  await assert.doesNotReject(fire(DELETE_S));
  assertOwnPurged(client);
});
