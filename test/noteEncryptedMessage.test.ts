/**
 * Encrypted messages order and badge their conversation, and acking one pads
 * its id.
 *
 * The server never sees an end-to-end encrypted message as a message, so it
 * never moves a channel's last message or unread state for one.
 * `Channel.noteEncryptedMessage` is the only place those move for encrypted
 * traffic: every origin moves the last message forward, `incoming` counts
 * toward the badge when the message sits past the read pointer, `own` marks
 * the channel read (and with `serverAck` tells the server), and `restored`
 * only orders the channel. The id is an envelope id the server chose, so one
 * that is not a plausible ULID is dropped (`isPlausibleMessageUlid`).
 *
 * `Channel.ack` stores and sends `encryptedAckId(id)` for an encrypted id:
 * its first 10 characters (the millisecond) padded with `Z`, the highest id
 * in that millisecond, so reading one device's copy of a send clears every
 * device's copy. The accepted cost is that a later message in the same
 * millisecond is read along with it; the "same millisecond" cases pin that.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/noteEncryptedMessage.test.ts
 *
 * To run the same cases against another `src/` tree, such as a known-bad
 * control exported from an older commit, set `STOATJS_SRC` to its absolute
 * path. The tree needs a sibling `node_modules` symlink (see loadSrc.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeTime, ulid } from "ulid";

import { loadSrc } from "./loadSrc.ts";

type ClientModule = typeof import("../src/Client.ts");
type EventsModule = typeof import("../src/events/v1.ts");
type HelpersModule = typeof import("../src/lib/encryptedMessage.ts");
type StoatClient = InstanceType<ClientModule["Client"]>;
type StoatChannel = NonNullable<ReturnType<StoatClient["channels"]["get"]>>;

const { Client } = await loadSrc<ClientModule>("Client.ts");
const { handleEvent } = await loadSrc<EventsModule>("events/v1.ts");

// A tree without the helpers fails the cases that need them one by one,
// instead of failing the whole file at load
const HELPERS = await loadSrc<HelpersModule>("lib/encryptedMessage.ts").catch(
  () => undefined,
);

function helpers(): HelpersModule {
  assert.ok(HELPERS, "src/lib/encryptedMessage.ts did not load");
  return HELPERS;
}

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
const OTHER = "01K6E000000000000000000002";
const DM = "01K6E000000000000000000003";
const GROUP = "01K6E00000000000000000000A";
const SYSTEM = "00000000000000000000000000";

// Distinct milliseconds (the first 10 characters), ascending
const M1 = "01K6E10000" + "0000000000000001";
const M2 = "01K6E20000" + "0000000000000001";
const M3 = "01K6E30000" + "0000000000000001";
// Same millisecond as M2, later random part
const R2 = "01K6E20000" + "00000000000000AB";
// Earlier millisecond than M2
const R1 = "01K6E10000" + "00000000000000CD";
// The first id of the millisecond after M2
const NEXT = "01K6E20001" + "0000000000000000";

const RE_ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** Expected padded ack id, computed here rather than by the code under test */
const pad = (id: string) => id.slice(0, 10) + "ZZZZZZZZZZZZZZZZ";

const ackPath = (channel: string, id: string) =>
  `/channels/${channel}/ack/${id}`;

function noop(): void {}

type Harness = {
  client: StoatClient;
  dm: StoatChannel;
  group: StoatChannel;
  /** Every `PUT` path, in order */
  puts: string[];
  /** The stored read pointer of a channel */
  pointer: (channel: string) => string | undefined;
  /** The stored unread count, ignoring whether the channel reads as unread */
  rawCount: (channel: string) => number;
};

/**
 * A fresh offline client with unread sync on, an open (or closed) DM and a
 * group, both with OTHER, and `api.put` recorded.
 * @param opts.dmActive Whether the DM starts open, defaults to true
 * @param opts.encrypted Ids the stub E2EE adapter reports as encrypted, or
 *   `undefined` for a client with no adapter at all
 */
function setup(
  opts: { dmActive?: boolean; encrypted?: string[] } = {},
): Harness {
  globalThis.fetch = (() => new Promise<never>(noop)) as never;

  const client = new Client(
    { autoReconnect: false, syncUnreads: true },
    CONFIG as never,
  );
  assert.equal(client.options.syncUnreads, true);

  for (const id of [ME, OTHER, DM, GROUP, M1, M2, M3, R2, R1, NEXT]) {
    assert.match(id, RE_ULID, `${id} is not a ULID`);
  }

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
    active: opts.dmActive ?? true,
    recipients: [ME, OTHER],
  } as never);
  client.channels.getOrCreate(GROUP, {
    _id: GROUP,
    channel_type: "Group",
    name: "g",
    owner: ME,
    recipients: [ME, OTHER],
  } as never);

  if (opts.encrypted) {
    const ids = new Set(opts.encrypted);
    client.e2ee = {
      isEncryptedMessage: (id: string) => ids.has(id),
    } as never;
  } else {
    assert.equal(client.e2ee, undefined);
  }

  const puts: string[] = [];
  (client.api as unknown as { put: unknown }).put = (path: string) => {
    puts.push(path);
    return Promise.resolve();
  };

  const dm = client.channels.get(DM)!;
  const group = client.channels.get(GROUP)!;
  assert.equal(dm.type, "DirectMessage");
  assert.equal(group.type, "Group");

  return {
    client,
    dm,
    group,
    puts,
    pointer: (id) => client.channelUnreads.get(id)?.lastMessageId,
    rawCount: (id) => client.channelUnreads.get(id)?.unreadCount ?? 0,
  };
}

// isPlausibleMessageUlid and encryptedAckId, against the ulid package the
// client already ships

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The 10-character timestamp part of a ULID for `t` milliseconds */
function encTime(t: number): string {
  let s = "";
  for (let i = 0; i < 10; i++) {
    s = CROCKFORD[t % 32] + s;
    t = Math.floor(t / 32);
  }
  return s;
}

// A fixed clock (2026-10) for the helper cases
const NOW = 1_791_700_000_000;
const SUFFIX = "7K3M9QX2BDFGHJNP";
const VALID = encTime(NOW) + SUFFIX;

test("the reference encoder agrees with the ulid package", () => {
  assert.equal(decodeTime(VALID), NOW);
  assert.equal(decodeTime(encTime(2 ** 48 - 1) + SUFFIX), 2 ** 48 - 1);
});

test("isPlausibleMessageUlid accepts a ULID up to now + 10 minutes", () => {
  const { isPlausibleMessageUlid } = helpers();
  assert.equal(isPlausibleMessageUlid(VALID, NOW), true);
  assert.equal(isPlausibleMessageUlid(encTime(0) + SUFFIX, NOW), true);
  assert.equal(isPlausibleMessageUlid(ulid(NOW), NOW), true);
  assert.equal(isPlausibleMessageUlid(ulid(NOW - 86_400_000), NOW), true);
  assert.equal(
    isPlausibleMessageUlid(encTime(NOW + 600_000) + SUFFIX, NOW),
    true,
  );
});

test("isPlausibleMessageUlid rejects a timestamp past now + 10 minutes", () => {
  const { isPlausibleMessageUlid } = helpers();
  assert.equal(
    isPlausibleMessageUlid(encTime(NOW + 600_001) + SUFFIX, NOW),
    false,
  );
  assert.equal(
    isPlausibleMessageUlid(encTime(NOW + 86_400_000) + SUFFIX, NOW),
    false,
  );
  assert.equal(isPlausibleMessageUlid(ulid(NOW + 3_600_000), NOW), false);
});

test("isPlausibleMessageUlid decodes the timestamp exactly", () => {
  const { isPlausibleMessageUlid } = helpers();
  for (const t of [0, 1, 31, 32, 1_000_000_007, NOW, 2 ** 48 - 1]) {
    const id = encTime(t) + SUFFIX;
    assert.equal(isPlausibleMessageUlid(id, t - 600_000), true, `t=${t} edge`);
    assert.equal(
      isPlausibleMessageUlid(id, t - 600_001),
      false,
      `t=${t} past the edge`,
    );
  }
});

test("isPlausibleMessageUlid defaults now to Date.now()", () => {
  const { isPlausibleMessageUlid } = helpers();
  assert.equal(isPlausibleMessageUlid(ulid()), true);
  assert.equal(isPlausibleMessageUlid(ulid(Date.now() + 3_600_000)), false);
});

test("isPlausibleMessageUlid rejects lowercase", () => {
  const { isPlausibleMessageUlid } = helpers();
  assert.equal(isPlausibleMessageUlid(VALID.toLowerCase(), NOW), false);
  const oneLower = VALID.slice(0, 20) + "k" + VALID.slice(21);
  assert.equal(isPlausibleMessageUlid(oneLower, NOW), false);
});

test("isPlausibleMessageUlid rejects I, L, O, U and other characters", () => {
  const { isPlausibleMessageUlid } = helpers();
  // E with an acute accent, built from its code so the file stays ASCII
  const accented = String.fromCharCode(0xc9);
  for (const ch of ["I", "L", "O", "U", "-", " ", "_", accented, "*"]) {
    for (const pos of [0, 5, 9, 10, 25]) {
      const bad = VALID.slice(0, pos) + ch + VALID.slice(pos + 1);
      assert.equal(bad.length, 26);
      assert.equal(isPlausibleMessageUlid(bad, NOW), false, `${ch}@${pos}`);
    }
  }
  assert.equal(isPlausibleMessageUlid(VALID + "\n", NOW), false);
  assert.equal(isPlausibleMessageUlid("\n" + VALID.slice(1), NOW), false);
});

test("isPlausibleMessageUlid rejects wrong lengths", () => {
  const { isPlausibleMessageUlid } = helpers();
  assert.equal(isPlausibleMessageUlid("", NOW), false);
  assert.equal(isPlausibleMessageUlid(VALID.slice(0, 25), NOW), false);
  assert.equal(isPlausibleMessageUlid(VALID + "0", NOW), false);
  assert.equal(isPlausibleMessageUlid(VALID + VALID, NOW), false);
});

test("isPlausibleMessageUlid rejects a first character above 7", () => {
  const { isPlausibleMessageUlid } = helpers();
  // Past 48 bits; the clock is moved out of the way so only the shape decides
  for (const ch of ["8", "9", "A", "Z"]) {
    const id = ch + "0".repeat(25);
    assert.equal(
      isPlausibleMessageUlid(id, Number.MAX_SAFE_INTEGER),
      false,
      ch,
    );
  }
  assert.equal(isPlausibleMessageUlid("7" + "Z".repeat(25), 2 ** 48), true);
});

test("isPlausibleMessageUlid rejects non-strings without throwing", () => {
  const { isPlausibleMessageUlid } = helpers();
  for (const v of [null, undefined, 123, {}, [], Symbol("x")] as unknown[]) {
    assert.equal(isPlausibleMessageUlid(v as string, NOW), false);
  }
});

test("encryptedAckId pads the millisecond with Z", () => {
  const { encryptedAckId, isPlausibleMessageUlid } = helpers();
  const ack = encryptedAckId(VALID);
  assert.equal(ack, pad(VALID));
  assert.equal(ack.length, 26);
  assert.equal(isPlausibleMessageUlid(ack, NOW), true);
  assert.equal(encryptedAckId(ack), ack);
});

test("encryptedAckId sorts at or after its millisecond, before the next", () => {
  const { encryptedAckId } = helpers();
  const prefix = encTime(NOW);
  const nextMs = encTime(NOW + 1) + "0".repeat(16);
  const sameMs = [
    VALID,
    prefix + "0".repeat(16),
    prefix + "Z".repeat(16),
    prefix + "ZZZZZZZZZZZZZZZY",
    ulid(NOW),
    ulid(NOW),
  ];
  for (const id of sameMs) {
    const ack = encryptedAckId(id);
    assert.equal(ack >= id, true, `${ack} >= ${id}`);
    assert.equal(ack < nextMs, true, `${ack} < ${nextMs}`);
    assert.equal(ack < ulid(NOW + 1), true);
  }
  // Every device's copy of one send acks to the same pointer
  assert.equal(new Set(sameMs.map(encryptedAckId)).size, 1);
});

// Channel.noteEncryptedMessage

test("incoming past the read pointer counts and bumps", () => {
  const { dm, puts } = setup();
  assert.equal(dm.noteEncryptedMessage(M1, "incoming"), true);
  assert.equal(dm.lastMessageId, M1);
  assert.equal(dm.unread, true);
  assert.equal(dm.unreadCount, 1);
  assert.equal(dm.unreadHasAttachments, false);

  assert.equal(
    dm.noteEncryptedMessage(M2, "incoming", { hasAttachments: true }),
    true,
  );
  assert.equal(dm.unreadCount, 2);
  assert.equal(dm.unreadHasAttachments, true);
  assert.deepEqual(puts, []);
});

test("incoming counts even when the last message did not move", () => {
  const { dm } = setup();
  // A seed from local history got there first
  assert.equal(dm.noteEncryptedMessage(M2, "restored"), true);
  assert.equal(dm.unreadCount, 0, "restored never counts");
  assert.equal(dm.noteEncryptedMessage(M2, "incoming"), false);
  assert.equal(dm.lastMessageId, M2);
  assert.equal(dm.unreadCount, 1);
  // Older than the last message, but still past the read pointer
  assert.equal(dm.noteEncryptedMessage(M1, "incoming"), false);
  assert.equal(dm.lastMessageId, M2, "never moves backwards");
  assert.equal(dm.unreadCount, 2);
});

test("incoming at or before the read pointer does not count", () => {
  const { client, dm, rawCount } = setup();
  client.channelUnreads.acknowledge(DM, M2);
  assert.equal(dm.noteEncryptedMessage(M1, "incoming"), true);
  assert.equal(rawCount(DM), 0);
  assert.equal(dm.noteEncryptedMessage(M2, "incoming"), true);
  assert.equal(rawCount(DM), 0);
  assert.equal(dm.noteEncryptedMessage(M3, "incoming"), true);
  assert.equal(rawCount(DM), 1);
});

test("repeated incoming past the read pointer counts every call", () => {
  // Documented: the count is not idempotent, so the caller notes each
  // decrypted message exactly once
  const { dm } = setup();
  assert.equal(dm.noteEncryptedMessage(M2, "incoming"), true);
  assert.equal(dm.noteEncryptedMessage(M2, "incoming"), false);
  assert.equal(dm.unreadCount, 2);
});

test("restored only orders the channel", () => {
  const { dm, rawCount, pointer, puts } = setup({ dmActive: false });
  assert.equal(
    dm.noteEncryptedMessage(M1, "restored", {
      reopen: true,
      hasAttachments: true,
      serverAck: true,
      receiptId: R2,
    }),
    true,
  );
  assert.equal(dm.lastMessageId, M1);
  assert.equal(rawCount(DM), 0);
  assert.equal(dm.active, false);
  assert.equal(pointer(DM), undefined);
  assert.deepEqual(puts, []);
  assert.equal(dm.noteEncryptedMessage(M1, "restored"), false);
});

test("an implausible id is ignored by every origin", () => {
  const { dm, rawCount, pointer, puts } = setup({ dmActive: false });
  for (const bad of [
    "not-a-ulid",
    "",
    "01k6e10000000000000000000a", // lowercase
    "01K6E1000000000000000000I1", // I is not Crockford base32
    "8ZZZZZZZZZZZZZZZZZZZZZZZZZ", // timestamp overflow
    "7ZZZZZZZZZZZZZZZZZZZZZZZZZ", // far future
  ]) {
    for (const origin of ["incoming", "own", "restored"] as const) {
      assert.equal(
        dm.noteEncryptedMessage(bad, origin, {
          reopen: true,
          receiptId: R2,
          serverAck: true,
        }),
        false,
        `${bad} ${origin}`,
      );
    }
  }
  assert.equal(dm.lastMessageId, undefined);
  assert.equal(rawCount(DM), 0);
  assert.equal(pointer(DM), undefined);
  assert.equal(dm.active, false);
  assert.deepEqual(puts, []);
});

test("reopen shows a closed DM only for incoming, and only when asked", () => {
  const a = setup({ dmActive: false });
  a.dm.noteEncryptedMessage(M1, "incoming");
  assert.equal(a.dm.active, false, "no reopen without the option");
  a.dm.noteEncryptedMessage(M2, "incoming", { reopen: true });
  assert.equal(a.dm.active, true);

  const b = setup({ dmActive: false });
  b.dm.noteEncryptedMessage(M1, "own", { reopen: true });
  assert.equal(b.dm.active, false, "own never reopens");

  const c = setup();
  assert.equal(
    c.group.noteEncryptedMessage(M1, "incoming", { reopen: true }),
    true,
  );
  assert.equal(c.group.unreadCount, 1);
});

test("own marks read up to max(message, padded receipt), no request", () => {
  const { dm, pointer, rawCount, puts } = setup();
  dm.noteEncryptedMessage(M1, "incoming");
  assert.equal(rawCount(DM), 1);

  assert.equal(dm.noteEncryptedMessage(M2, "own", { receiptId: R2 }), true);
  assert.equal(pointer(DM), pad(R2));
  assert.equal(dm.unread, false);
  assert.equal(rawCount(DM), 0);
  assert.deepEqual(puts, []);

  const b = setup();
  b.dm.noteEncryptedMessage(M2, "own", { receiptId: R1 });
  assert.equal(b.pointer(DM), M2, "padded R1 sorts before M2");

  const c = setup();
  c.dm.noteEncryptedMessage(M2, "own", { receiptId: "garbage" });
  assert.equal(c.pointer(DM), M2, "an implausible receipt id is ignored");

  const d = setup();
  d.dm.noteEncryptedMessage(M2, "own");
  assert.equal(d.pointer(DM), M2);
});

test("own serverAck sends the padded receipt and drops a covered ack", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { dm, puts } = setup();
  await dm.ack(M1); // debounced: M1 pending
  assert.deepEqual(puts, []);
  dm.noteEncryptedMessage(M2, "own", { receiptId: R2, serverAck: true });
  assert.deepEqual(puts, [ackPath(DM, pad(R2))], "sent right away");
  t.mock.timers.tick(1500);
  assert.deepEqual(puts, [ackPath(DM, pad(R2))], "pending M1 was dropped");
});

test("own serverAck sends nothing without a usable receipt", () => {
  // The message id may come from the local clock, so it never becomes the
  // server's pointer; the local acknowledge still happens
  const a = setup();
  a.dm.noteEncryptedMessage(M2, "own", { serverAck: true });
  assert.deepEqual(a.puts, []);
  assert.equal(a.pointer(DM), M2);

  const b = setup();
  b.dm.noteEncryptedMessage(M2, "own", { serverAck: true, receiptId: "x" });
  assert.deepEqual(b.puts, []);
  assert.equal(b.pointer(DM), M2);

  // The manual mark-unread is still cleared, so the next ack is sent
  const c = setup({ encrypted: [M2] });
  void c.dm.ack(M1, true, false, true);
  assert.deepEqual(c.puts, [ackPath(DM, M1)]);
  c.dm.noteEncryptedMessage(M2, "own", { serverAck: true });
  assert.deepEqual(c.puts, [ackPath(DM, M1)]);
  void c.dm.ack(undefined, true);
  assert.deepEqual(c.puts, [ackPath(DM, M1), ackPath(DM, pad(M2))]);
});

test("own serverAck leaves a newer pending ack in place", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { dm, puts } = setup();
  await dm.ack(M3); // M3 pending, newer than pad(R2)
  dm.noteEncryptedMessage(M2, "own", { receiptId: R2, serverAck: true });
  assert.deepEqual(puts, [ackPath(DM, pad(R2))]);
  t.mock.timers.tick(1500);
  assert.deepEqual(puts, [ackPath(DM, pad(R2)), ackPath(DM, M3)]);
});

test("own serverAck never sends below an ack already requested", () => {
  const { dm, puts } = setup();
  void dm.ack(M3, true);
  assert.deepEqual(puts, [ackPath(DM, M3)]);
  // A usable receipt, so only the requested-ack guard holds this back
  dm.noteEncryptedMessage(M2, "own", { receiptId: R2, serverAck: true });
  assert.deepEqual(puts, [ackPath(DM, M3)]);
});

test("own clears a manual mark-unread so the next ack is sent", () => {
  const { dm, pointer, puts } = setup({ encrypted: [M2] });
  void dm.ack(M1, true, false, true); // mark-unread sets the manual flag
  assert.deepEqual(puts, [ackPath(DM, M1)]);
  dm.noteEncryptedMessage(M2, "own");
  void dm.ack(undefined, true);
  assert.deepEqual(puts, [ackPath(DM, M1), ackPath(DM, pad(M2))]);
  assert.equal(pointer(DM), pad(M2));
});

test("incoming and restored leave a manual mark-unread in place", () => {
  const { dm, puts } = setup();
  void dm.ack(M1, true, false, true);
  dm.noteEncryptedMessage(M2, "incoming");
  dm.noteEncryptedMessage(M3, "restored");
  void dm.ack(undefined, true);
  assert.deepEqual(puts, [ackPath(DM, M1)], "the next ack is still swallowed");
});

// Channel.ack padding

test("ack pads an encrypted id for the read pointer and the request", () => {
  const { dm, pointer, puts } = setup({ encrypted: [M2] });
  void dm.ack(M2, true);
  assert.equal(pointer(DM), pad(M2));
  assert.deepEqual(puts, [ackPath(DM, pad(M2))]);
});

test("ack with no argument pads an encrypted last message", () => {
  const { dm, pointer, puts } = setup({ encrypted: [M2] });
  dm.noteEncryptedMessage(M2, "incoming");
  assert.equal(dm.unread, true);
  void dm.ack(undefined, true);
  assert.equal(pointer(DM), pad(M2));
  assert.equal(dm.unread, false);
  assert.deepEqual(puts, [ackPath(DM, pad(M2))]);
});

test("ack leaves a plaintext id alone, with and without an adapter", () => {
  const a = setup({ encrypted: [M2] });
  void a.dm.ack(M1, true);
  assert.equal(a.pointer(DM), M1);
  assert.deepEqual(a.puts, [ackPath(DM, M1)]);

  const b = setup();
  void b.dm.ack(M2, true);
  assert.equal(b.pointer(DM), M2);
  assert.deepEqual(b.puts, [ackPath(DM, M2)]);
});

// Accepted edge (plan A3): the padded pointer is the highest id in its
// millisecond, so a later message stamped in the same millisecond is read
// along with it. The first id of the next millisecond is not.

test("same millisecond: a group reply after my own send reads as read", () => {
  const { group, pointer, rawCount, puts } = setup();
  group.noteEncryptedMessage(M2, "own", { receiptId: M2, serverAck: true });
  assert.equal(pointer(GROUP), pad(M2));
  assert.deepEqual(puts, [ackPath(GROUP, pad(M2))]);

  // Another sender's message in the same millisecond still orders the group,
  // but is covered by the padded pointer: no count, no unread
  assert.equal(R2 > M2 && R2.slice(0, 10) === M2.slice(0, 10), true);
  assert.equal(group.noteEncryptedMessage(R2, "incoming"), true);
  assert.equal(group.lastMessageId, R2);
  assert.equal(rawCount(GROUP), 0);
  assert.equal(group.unread, false);

  assert.equal(group.noteEncryptedMessage(NEXT, "incoming"), true);
  assert.equal(rawCount(GROUP), 1);
  assert.equal(group.unread, true);
});

test("same millisecond: a message after an acked encrypted one reads as read", () => {
  const { dm, pointer, rawCount } = setup({ encrypted: [M2] });
  dm.noteEncryptedMessage(M2, "incoming");
  void dm.ack(M2, true);
  assert.equal(pointer(DM), pad(M2));

  assert.equal(dm.noteEncryptedMessage(R2, "incoming"), true);
  assert.equal(rawCount(DM), 0);
  assert.equal(dm.unread, false);

  assert.equal(dm.noteEncryptedMessage(NEXT, "incoming"), true);
  assert.equal(rawCount(DM), 1);
  assert.equal(dm.unread, true);
});

test("same millisecond: a plaintext system message is covered too", async () => {
  const { client, dm, pointer, rawCount } = setup({ encrypted: [M2] });
  dm.noteEncryptedMessage(M2, "incoming");
  void dm.ack(M2, true);
  assert.equal(pointer(DM), pad(M2));

  // A server system message delivered as an ordinary Message event
  await handleEvent(
    client,
    {
      type: "Message",
      _id: R2,
      channel: DM,
      author: SYSTEM,
      system: { type: "text", content: "system" },
    } as never,
    noop as never,
  );
  assert.equal(client.messages.has(R2), true);
  assert.equal(dm.lastMessageId, R2);
  assert.equal(rawCount(DM), 0);
  assert.equal(dm.unread, false);
});
