/**
 * `ProtTankUpdate` and `Client.setProtTank` keep the newest summary of a
 * channel's fuel tank in `Client.protTanks`.
 *
 * Events and REST reads can arrive out of order, so a summary of the same
 * tank replaces the stored one only if its `(version, balance_version)` is
 * lexicographically equal or newer; an older one is dropped (and the event is
 * not emitted). An absent tank removes the entry. A summary of a different
 * tank (another `tank_id`) always replaces the stored one, because a
 * channel's replacement tank starts again at version 0.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/protTankUpdate.test.ts
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
type ProtTankSummary = import("../src/types/prot.ts").ProtTankSummary;

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
  /** Every protTankUpdate emitted, as [channelId, tank] */
  emitted: [string, ProtTankSummary | undefined][];
  fire: (event: ServerEvent) => Promise<void>;
};

function noop(): void {}

/**
 * A fresh offline client that records every protTankUpdate it emits
 */
function setup(): Harness {
  globalThis.fetch = (() => new Promise<never>(noop)) as never;

  const client = new Client({ autoReconnect: false }, CONFIG as never);

  const emitted: [string, ProtTankSummary | undefined][] = [];
  client.on("protTankUpdate", (channelId, tank) =>
    emitted.push([channelId, tank]),
  );

  return {
    client,
    emitted,
    fire: (event) => handleEvent(client, event as never, noop as never),
  };
}

function summary(
  version: number,
  balanceVersion: number,
  overrides: Partial<ProtTankSummary> = {},
): ProtTankSummary {
  return {
    tank_id: "01TANK",
    channel_id: "01CHANNEL",
    stage: "Active",
    slot_tier: 10,
    daily_cost: 40,
    balance: 1200,
    protected_until: 1_800_000_000_000,
    version,
    balance_version: balanceVersion,
    ...overrides,
  };
}

function update(tank?: ProtTankSummary, channel = "01CHANNEL"): ServerEvent {
  return tank
    ? { type: "ProtTankUpdate", channel, tank }
    : { type: "ProtTankUpdate", channel };
}

test("a fresh client knows no tank", () => {
  const { client, emitted } = setup();

  assert.equal(client.protTanks.size, 0);
  assert.equal(client.protTanks.get("01CHANNEL"), undefined);
  assert.deepEqual(emitted, []);
});

test("an update stores the tank and is emitted with it", async () => {
  const { client, emitted, fire } = setup();
  const tank = summary(2, 5);

  await fire(update(tank));

  assert.equal(client.protTanks.get("01CHANNEL"), tank);
  assert.deepEqual(emitted, [["01CHANNEL", tank]]);
});

test("an older version of the same tank is dropped and not emitted", async () => {
  const { client, emitted, fire } = setup();
  const newer = summary(4, 1);

  await fire(update(newer));
  // A lower version wins nothing, even with a higher balance version
  await fire(update(summary(3, 9, { stage: "Grace", balance: -40 })));
  await fire(update(summary(0, 0)));

  assert.equal(client.protTanks.get("01CHANNEL"), newer);
  assert.deepEqual(emitted, [["01CHANNEL", newer]]);
});

test("an older balance version at the same version is dropped", async () => {
  const { client, emitted, fire } = setup();
  const newer = summary(4, 7);

  await fire(update(newer));
  await fire(update(summary(4, 6, { balance: 900 })));

  assert.equal(client.protTanks.get("01CHANNEL"), newer);
  assert.deepEqual(emitted, [["01CHANNEL", newer]]);
});

test("an equal (version, balance_version) replaces the stored tank", async () => {
  const { client, emitted, fire } = setup();
  const first = summary(4, 7);
  const again = summary(4, 7, { protected_until: 1_800_086_400_000 });

  await fire(update(first));
  await fire(update(again));

  assert.equal(client.protTanks.get("01CHANNEL"), again);
  assert.deepEqual(emitted, [
    ["01CHANNEL", first],
    ["01CHANNEL", again],
  ]);
});

test("the comparison is lexicographic: version first, then balance version", async () => {
  const { client, emitted, fire } = setup();
  const first = summary(4, 7);
  const moreFuel = summary(4, 8, { balance: 1600 });
  // A newer tank document wins even though its balance version is lower
  const frozen = summary(5, 2, { stage: "Frozen", balance: -120 });

  await fire(update(first));
  await fire(update(moreFuel));
  await fire(update(frozen));

  assert.equal(client.protTanks.get("01CHANNEL"), frozen);
  assert.deepEqual(emitted, [
    ["01CHANNEL", first],
    ["01CHANNEL", moreFuel],
    ["01CHANNEL", frozen],
  ]);
});

test("an update without a tank removes it and is emitted", async () => {
  const { client, emitted, fire } = setup();
  const tank = summary(3, 3);

  await fire(update(tank));
  await fire(update(undefined));

  assert.equal(client.protTanks.has("01CHANNEL"), false);
  assert.deepEqual(emitted, [
    ["01CHANNEL", tank],
    ["01CHANNEL", undefined],
  ]);

  // After the removal any version of a tank is stored again
  const relaunched = summary(0, 0, { stage: "Launching" });
  await fire(update(relaunched));
  assert.equal(client.protTanks.get("01CHANNEL"), relaunched);
});

test("an update without a tank for an unknown channel is still emitted", async () => {
  const { client, emitted, fire } = setup();

  await fire(update(undefined, "01OTHER"));

  assert.equal(client.protTanks.size, 0);
  assert.deepEqual(emitted, [["01OTHER", undefined]]);
});

test("a different tank replaces the stored one at any version", async () => {
  const { client, emitted, fire } = setup();
  const old = summary(9, 9, { stage: "Launching" });
  // The removal of `old` was missed (offline); its replacement restarts at 0
  const replacement = summary(0, 0, {
    tank_id: "01TANK2",
    stage: "Launching",
  });

  await fire(update(old));
  await fire(update(replacement));

  assert.equal(client.protTanks.get("01CHANNEL"), replacement);
  assert.deepEqual(emitted, [
    ["01CHANNEL", old],
    ["01CHANNEL", replacement],
  ]);
});

test("channels are kept apart", async () => {
  const { client, fire } = setup();
  const a = summary(8, 8);
  const b = summary(1, 1, { tank_id: "01TANKB", channel_id: "01CHANNELB" });

  await fire(update(a));
  await fire(update(b, "01CHANNELB"));
  await fire(update(undefined, "01CHANNELB"));

  assert.equal(client.protTanks.get("01CHANNEL"), a);
  assert.equal(client.protTanks.has("01CHANNELB"), false);
});

test("out-of-order updates in a Bulk keep only the newest", async () => {
  const { client, emitted, fire } = setup();
  const v2 = summary(2, 1);
  const v3 = summary(3, 1);

  await fire({
    type: "Bulk",
    v: [update(v2), update(summary(1, 4)), update(v3), update(summary(2, 9))],
  });

  assert.equal(client.protTanks.get("01CHANNEL"), v3);
  assert.deepEqual(emitted, [
    ["01CHANNEL", v2],
    ["01CHANNEL", v3],
  ]);
});

test("a REST read through setProtTank obeys the same version rule", async () => {
  const { client, emitted, fire } = setup();
  const live = summary(6, 4);

  await fire(update(live));

  // A read that started before the event and answered after it is dropped
  client.setProtTank("01CHANNEL", summary(5, 9));
  assert.equal(client.protTanks.get("01CHANNEL"), live);

  // A newer read replaces it
  const read = summary(6, 5, { balance: 1500 });
  client.setProtTank("01CHANNEL", read);
  assert.equal(client.protTanks.get("01CHANNEL"), read);

  // An event older than the read is then dropped too
  await fire(update(summary(6, 4)));
  assert.equal(client.protTanks.get("01CHANNEL"), read);

  // A NotFound read removes the tank
  client.setProtTank("01CHANNEL", undefined);
  assert.equal(client.protTanks.has("01CHANNEL"), false);

  // setProtTank itself emits nothing; only the event does
  assert.deepEqual(emitted, [["01CHANNEL", live]]);
});

test("a REST read stores a tank on a client that had none", () => {
  const { client } = setup();
  const read = summary(0, 0, { stage: "Grace", balance: -40 });

  client.setProtTank("01CHANNEL", read);

  assert.equal(client.protTanks.get("01CHANNEL"), read);
});
