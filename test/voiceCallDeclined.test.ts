/**
 * `VoiceCallDeclined` emits `voiceCallDeclined` and changes no state.
 *
 * The server sends the event to every session of the user who declined a
 * ringing call, and in a direct message to the channel as well, so the
 * caller sees the decline. The client only passes it on: it emits
 * `voiceCallDeclined` with the channel, the user who declined and the call
 * id, in that order, when it knows the channel. These cases pin that order,
 * that an unknown channel emits nothing and does not throw, and that the
 * event leaves the channel's `voiceParticipants` alone, since declining a
 * call is not leaving it.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/voiceCallDeclined.test.ts
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
type StoatChannel = NonNullable<ReturnType<StoatClient["channels"]["get"]>>;

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

const ME = "01K6V000000000000000000001";
const OTHER = "01K6V000000000000000000002";
const DM = "01K6V000000000000000000003";
const UNKNOWN = "01K6V000000000000000000004";
const CALL = "01K6V000000000000000000005";
const CALL_2 = "01K6V000000000000000000006";

// Every emit a voice roster change may produce
const ROSTER_EVENTS = ["voiceChannelJoin", "voiceChannelLeave"];

type ServerEvent = { type: string } & Record<string, unknown>;

type Listenable = {
  on: (name: string, listener: (...args: unknown[]) => void) => unknown;
};

type Harness = {
  client: StoatClient;
  channel: StoatChannel;
  /** Every voiceCallDeclined emitted, with its arguments as received */
  declined: unknown[][];
  /** Names of the roster events emitted, in order */
  roster: string[];
  fire: (event: ServerEvent) => Promise<void>;
};

function noop(): void {}

/**
 * A fresh offline client signed in as ME, with a direct message to OTHER,
 * that records every voiceCallDeclined and roster event it emits
 */
function setup(): Harness {
  globalThis.fetch = (() => new Promise<never>(noop)) as never;

  const client = new Client({ autoReconnect: false }, CONFIG as never);

  for (const id of [ME, OTHER, DM, UNKNOWN, CALL, CALL_2]) {
    assert.match(id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/, `${id} is not a ULID`);
  }

  client.user = client.users.getOrCreate(ME, {
    _id: ME,
    username: "me",
    discriminator: "0001",
    relationship: "User",
    online: true,
  } as never);

  const channel = client.channels.getOrCreate(DM, {
    _id: DM,
    channel_type: "DirectMessage",
    active: true,
    recipients: [ME, OTHER],
  } as never);

  // Listen by plain name with rest arguments, so an argument added or
  // dropped later is recorded as sent instead of being cut to three
  const listen = client as unknown as Listenable;

  const declined: unknown[][] = [];
  listen.on("voiceCallDeclined", (...args) => declined.push(args));

  const roster: string[] = [];
  for (const name of ROSTER_EVENTS) {
    listen.on(name, () => roster.push(name));
  }

  return {
    client,
    channel,
    declined,
    roster,
    fire: (event) => handleEvent(client, event as never, noop as never),
  };
}

function decline(
  channelId: string,
  userId: string,
  callId: string,
): ServerEvent {
  return {
    type: "VoiceCallDeclined",
    channel_id: channelId,
    call_id: callId,
    user_id: userId,
  };
}

function join(channelId: string, userId: string): ServerEvent {
  return {
    type: "VoiceChannelJoin",
    id: channelId,
    state: {
      id: userId,
      joined_at: 1,
      is_receiving: true,
      is_publishing: true,
      screensharing: false,
      camera: false,
    },
  };
}

test("a known channel emits once, as (channel, userId, callId)", async () => {
  const { channel, declined, fire } = setup();

  await fire(decline(DM, OTHER, CALL));

  assert.equal(declined.length, 1);
  assert.equal(declined[0].length, 3);
  // The cached channel object itself, not a copy or its id
  assert.equal(declined[0][0], channel);
  assert.equal(declined[0][1], OTHER);
  assert.equal(declined[0][2], CALL);
});

test("the signed-in user's own decline is emitted the same way", async () => {
  const { channel, declined, fire } = setup();

  await fire(decline(DM, ME, CALL));

  assert.equal(declined.length, 1);
  assert.equal(declined[0][0], channel);
  assert.equal(declined[0][1], ME);
  assert.equal(declined[0][2], CALL);
});

test("each decline in a Bulk is emitted, in order", async () => {
  const { channel, declined, fire } = setup();

  await fire({
    type: "Bulk",
    v: [decline(DM, ME, CALL), decline(DM, OTHER, CALL_2)],
  });

  assert.deepEqual(
    declined.map(([c, userId, callId]) => [c === channel, userId, callId]),
    [
      [true, ME, CALL],
      [true, OTHER, CALL_2],
    ],
  );
});

test("an unknown channel emits nothing and does not throw", async () => {
  const { client, declined, fire } = setup();

  assert.equal(client.channels.has(UNKNOWN), false);

  await assert.doesNotReject(fire(decline(UNKNOWN, OTHER, CALL)));

  assert.deepEqual(declined, []);
  // Nothing was cached for it either
  assert.equal(client.channels.has(UNKNOWN), false);
});

test("a decline leaves voiceParticipants untouched", async () => {
  const { channel, declined, roster, fire } = setup();

  // Both users on the roster, so a handler that removed the declining user
  // the way VoiceChannelLeave does would be caught for either id
  await fire(join(DM, ME));
  await fire(join(DM, OTHER));

  const before = new Map(channel.voiceParticipants);
  assert.deepEqual([...before.keys()], [ME, OTHER]);
  roster.length = 0;

  await fire(decline(DM, ME, CALL));
  await fire(decline(DM, OTHER, CALL));

  // The event was handled, so the checks below are not passing on a no-op
  assert.equal(declined.length, 2);

  assert.deepEqual([...channel.voiceParticipants.keys()], [ME, OTHER]);
  // The same participant objects, not rebuilt ones
  assert.equal(channel.voiceParticipants.get(ME), before.get(ME));
  assert.equal(channel.voiceParticipants.get(OTHER), before.get(OTHER));
  assert.deepEqual(roster, []);
});

test("a decline on an empty roster leaves it empty", async () => {
  const { channel, declined, roster, fire } = setup();

  assert.equal(channel.voiceParticipants.size, 0);

  await fire(decline(DM, OTHER, CALL));

  assert.equal(declined.length, 1);
  assert.equal(channel.voiceParticipants.size, 0);
  assert.deepEqual(roster, []);
});
