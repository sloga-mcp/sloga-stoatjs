/**
 * `ProtBalanceUpdate` emits `protBalanceUpdate` only for a newer version.
 *
 * Two ledger postings can publish their updates out of order, so the client
 * keeps the newest wallet account `version` it has seen
 * (`Client.protBalanceVersion`, 0 = none) and drops any update whose version
 * is equal or lower. These cases pin that an update is emitted with its
 * balance and version, that an equal or older version after it is dropped,
 * and that a newer one is still emitted afterwards.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/protBalanceUpdate.test.ts
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

type ServerEvent = { type: string } & Record<string, unknown>;

type Harness = {
  client: StoatClient;
  /** Every protBalanceUpdate emitted, as [balance, version] */
  emitted: [number, number][];
  fire: (event: ServerEvent) => Promise<void>;
};

function noop(): void {}

/**
 * A fresh offline client that records every protBalanceUpdate it emits
 */
function setup(): Harness {
  globalThis.fetch = (() => new Promise<never>(noop)) as never;

  const client = new Client({ autoReconnect: false }, CONFIG as never);

  const emitted: [number, number][] = [];
  client.on("protBalanceUpdate", (balance, version) =>
    emitted.push([balance, version]),
  );

  return {
    client,
    emitted,
    fire: (event) => handleEvent(client, event as never, noop as never),
  };
}

function update(balance: number, version: number): ServerEvent {
  return { type: "ProtBalanceUpdate", balance, version };
}

test("a fresh client has seen no version", () => {
  const { client, emitted } = setup();

  assert.equal(client.protBalanceVersion, 0);
  assert.deepEqual(emitted, []);
});

test("an update is emitted with its balance and version", async () => {
  const { client, emitted, fire } = setup();

  await fire(update(2600, 3));

  assert.deepEqual(emitted, [[2600, 3]]);
  assert.equal(client.protBalanceVersion, 3);
});

test("an update with an equal version after it is dropped", async () => {
  const { client, emitted, fire } = setup();

  await fire(update(2600, 3));
  await fire(update(1200, 3));

  assert.deepEqual(emitted, [[2600, 3]]);
  assert.equal(client.protBalanceVersion, 3);
});

test("an update with a lower version after it is dropped", async () => {
  const { client, emitted, fire } = setup();

  await fire(update(2600, 5));
  await fire(update(1200, 4));
  await fire(update(900, 1));

  assert.deepEqual(emitted, [[2600, 5]]);
  assert.equal(client.protBalanceVersion, 5);
});

test("a newer update after a dropped one is still emitted", async () => {
  const { client, emitted, fire } = setup();

  await fire(update(2600, 5));
  await fire(update(1200, 4));
  await fire(update(-250, 7));

  // The balance is passed through as sent, even when negative
  assert.deepEqual(emitted, [
    [2600, 5],
    [-250, 7],
  ]);
  assert.equal(client.protBalanceVersion, 7);
});

test("an update at version 0 is dropped (0 = none seen)", async () => {
  const { client, emitted, fire } = setup();

  await fire(update(100, 0));

  assert.deepEqual(emitted, []);
  assert.equal(client.protBalanceVersion, 0);
});

test("out-of-order updates in a Bulk keep only the newer ones", async () => {
  const { client, emitted, fire } = setup();

  await fire({
    type: "Bulk",
    v: [update(500, 2), update(400, 1), update(700, 3), update(600, 3)],
  });

  assert.deepEqual(emitted, [
    [500, 2],
    [700, 3],
  ]);
  assert.equal(client.protBalanceVersion, 3);
});
