/**
 * `Message.mentioned` reads the server's mass-mention flags at their bit
 * positions.
 *
 * The server stores MentionsEveryone at bit 2 (value 4) and MentionsOnline at
 * bit 3 (value 8), while SuppressNotifications is the mask 1. `mentioned` used
 * to test `flags & 2` and `flags & 3`, so a silent message (flags 1) read as
 * mentioning every reader and a real @everyone (flags 4) read as no mention.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/messageMentioned.test.ts
 *
 * To run the same cases against another `src/` tree, such as a known-bad
 * control exported from an older commit, set `STOATJS_SRC` to its absolute
 * path (see loadSrc.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSrc } from "./loadSrc.ts";

type ClientModule = typeof import("../src/Client.ts");
type StoatClient = InstanceType<ClientModule["Client"]>;

const { Client } = await loadSrc<ClientModule>("Client.ts");

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

const ME = "01K6B000000000000000000001";
const OTHER = "01K6B000000000000000000002";
const CHANNEL = "01K6B000000000000000000003";

// Server-side flag values (bit positions shifted, except the silent mask)
const SILENT = 1;
const EVERYONE = 1 << 2;
const ONLINE = 1 << 3;
// Every other flag the server sets: DiceRoll, Interaction, Poll,
// Crossposted, IsCrosspost, SoftRes
const OTHER_SERVER_FLAGS = [4, 5, 6, 7, 8, 9].map((bit) => 1 << bit);

let seq = 0;

function setup(): StoatClient {
  const client = new Client({ autoReconnect: false }, CONFIG as never);
  client.user = client.users.getOrCreate(ME, {
    _id: ME,
    username: "me",
    discriminator: "0001",
    relationship: "User",
    online: true,
  } as never);
  return client;
}

/** A message from someone else with the given flags and user mentions. */
function message(flags: number | undefined, mentions?: string[]) {
  const client = setup();
  const id = `01K6B1${String(seq++).padStart(20, "0")}`;
  return client.messages.getOrCreate(id, {
    _id: id,
    channel: CHANNEL,
    author: OTHER,
    content: "hello",
    ...(flags === undefined ? {} : { flags }),
    ...(mentions ? { mentions } : {}),
  } as never);
}

const CASES: [name: string, flags: number | undefined, mentioned: boolean][] = [
  ["absent flags", undefined, false],
  ["flags 0", 0, false],
  ["silent only (1)", SILENT, false],
  ["bit 1 alone (2), unused by the server", 2, false],
  ["silent | bit 1 (3), the old MentionsOnline mask", 3, false],
  ["@everyone (bit 2 = 4)", EVERYONE, true],
  ["@online (bit 3 = 8)", ONLINE, true],
  ["@everyone | @online (12)", EVERYONE | ONLINE, true],
  ["silent | @everyone (5)", SILENT | EVERYONE, true],
  ["silent | @online (9)", SILENT | ONLINE, true],
];

for (const [name, flags, mentioned] of CASES) {
  test(`mentioned: ${name} -> ${mentioned}`, () => {
    assert.equal(message(flags).mentioned, mentioned);
  });
}

test("mentioned: no other server-set flag reads as a mention", () => {
  for (const flag of OTHER_SERVER_FLAGS) {
    assert.equal(message(flag).mentioned, false, `flags=${flag}`);
    assert.equal(message(SILENT | flag).mentioned, false, `flags=1|${flag}`);
  }
  const all = OTHER_SERVER_FLAGS.reduce((acc, flag) => acc | flag, SILENT);
  assert.equal(message(all).mentioned, false, `flags=${all}`);
  assert.equal(message(all | EVERYONE).mentioned, true, `flags=${all}|4`);
});

test("mentioned: a silent message that names us is still a mention", () => {
  assert.equal(message(SILENT, [ME]).mentioned, true);
  assert.equal(message(0, [ME]).mentioned, true);
});

test("mentioned: a silent message that names someone else is not", () => {
  assert.equal(message(SILENT, [OTHER]).mentioned, false);
  assert.equal(message(0, [OTHER]).mentioned, false);
});

test("isSuppressed and mentioned read separate bits", () => {
  const silentEveryone = message(SILENT | EVERYONE);
  assert.equal(silentEveryone.isSuppressed, true);
  assert.equal(silentEveryone.mentioned, true);

  const everyone = message(EVERYONE);
  assert.equal(everyone.isSuppressed, false);
  assert.equal(everyone.mentioned, true);

  const silent = message(SILENT);
  assert.equal(silent.isSuppressed, true);
  assert.equal(silent.mentioned, false);
});
