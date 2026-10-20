/**
 * `User.cipher` follows the server's user object end to end.
 *
 * The public Cipher membership is newer than the published stoat-api types,
 * so it lives only in the local hydration. These cases pin that it is read
 * from the initial user object (absent = none), set and replaced by a
 * UserUpdate, kept across a partial UserUpdate that does not carry it, and
 * dropped by a UserUpdate that clears "Cipher".
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/userCipher.test.ts
 *
 * To run the same cases against another `src/` tree, such as a known-bad
 * control, set `STOATJS_SRC` to its absolute path. The tree needs a sibling
 * `node_modules` symlink (see loadSrc.ts).
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

const ME = "01K6E000000000000000000001";
const MEMBER = "01K6E000000000000000000002";
const PLAIN = "01K6E000000000000000000003";

type ServerEvent = { type: string } & Record<string, unknown>;

type Harness = {
  client: StoatClient;
  updates: string[];
  fire: (event: ServerEvent) => Promise<void>;
};

function noop(): void {}

/**
 * A fresh offline client holding MEMBER (a T149 Cipher member, #42) and PLAIN
 * (no membership), both hydrated from server user objects.
 */
function setup(): Harness {
  globalThis.fetch = (() => new Promise<never>(noop)) as never;

  const client = new Client({ autoReconnect: false }, CONFIG as never);

  for (const id of [ME, MEMBER, PLAIN]) {
    assert.match(id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/, `${id} is not a ULID`);
  }

  client.user = client.users.getOrCreate(ME, {
    _id: ME,
    username: "me",
    discriminator: "0001",
    relationship: "User",
    online: true,
  } as never);

  client.users.getOrCreate(MEMBER, {
    _id: MEMBER,
    username: "member",
    discriminator: "0002",
    relationship: "None",
    online: true,
    cipher: { number: 42, tier: "T149" },
  } as never);

  client.users.getOrCreate(PLAIN, {
    _id: PLAIN,
    username: "plain",
    discriminator: "0003",
    relationship: "None",
    online: true,
  } as never);

  const updates: string[] = [];
  client.on("userUpdate", (user) => updates.push(user.id));

  return {
    client,
    updates,
    fire: (event) => handleEvent(client, event as never, noop as never),
  };
}

function cipherOf(client: StoatClient, id: string) {
  const user = client.users.get(id);
  assert.ok(user, `${id} is not cached`);
  return user.cipher;
}

test("initial hydration reads cipher from the user object", () => {
  const { client } = setup();

  assert.deepEqual(cipherOf(client, MEMBER), { number: 42, tier: "T149" });
  assert.equal(cipherOf(client, PLAIN), undefined);
  assert.equal(cipherOf(client, ME), undefined);
});

test("UserUpdate sets cipher on a user who had none", async () => {
  const { client, updates, fire } = setup();

  await fire({
    type: "UserUpdate",
    id: PLAIN,
    data: { cipher: { number: 7, tier: "T99" } },
  });

  assert.deepEqual(cipherOf(client, PLAIN), { number: 7, tier: "T99" });
  assert.deepEqual(updates, [PLAIN]);
});

test("UserUpdate replaces cipher on an upgrade", async () => {
  const { client, fire } = setup();

  await fire({
    type: "UserUpdate",
    id: MEMBER,
    data: { cipher: { number: 42, tier: "T299" } },
  });

  assert.deepEqual(cipherOf(client, MEMBER), { number: 42, tier: "T299" });
});

test("a partial UserUpdate without cipher keeps the known value", async () => {
  const { client, fire } = setup();

  await fire({
    type: "UserUpdate",
    id: MEMBER,
    data: { display_name: "Renamed" },
  });

  assert.equal(client.users.get(MEMBER)?.displayName, "Renamed");
  assert.deepEqual(cipherOf(client, MEMBER), { number: 42, tier: "T149" });
});

test('UserUpdate clearing "Cipher" removes it', async () => {
  const { client, updates, fire } = setup();

  await fire({
    type: "UserUpdate",
    id: MEMBER,
    data: {},
    clear: ["Cipher"],
  });

  assert.equal(cipherOf(client, MEMBER), undefined);
  assert.deepEqual(updates, [MEMBER]);

  // Other members are untouched
  await fire({
    type: "UserUpdate",
    id: PLAIN,
    data: { cipher: { number: 9, tier: "T99" } },
  });
  assert.deepEqual(cipherOf(client, PLAIN), { number: 9, tier: "T99" });
  assert.equal(cipherOf(client, MEMBER), undefined);
});

test("hydrate, update, then clear in sequence", async () => {
  const { client, fire } = setup();

  assert.deepEqual(cipherOf(client, MEMBER), { number: 42, tier: "T149" });

  await fire({
    type: "UserUpdate",
    id: MEMBER,
    data: { cipher: { number: 42, tier: "T299" } },
  });
  assert.deepEqual(cipherOf(client, MEMBER), { number: 42, tier: "T299" });

  await fire({
    type: "UserUpdate",
    id: MEMBER,
    data: {},
    clear: ["Cipher"],
  });
  assert.equal(cipherOf(client, MEMBER), undefined);

  // A later partial update without the key does not bring it back
  await fire({
    type: "UserUpdate",
    id: MEMBER,
    data: { display_name: "Renamed" },
  });
  assert.equal(cipherOf(client, MEMBER), undefined);

  await fire({
    type: "UserUpdate",
    id: MEMBER,
    data: { cipher: { number: 42, tier: "T99" } },
  });
  assert.deepEqual(cipherOf(client, MEMBER), { number: 42, tier: "T99" });
});
