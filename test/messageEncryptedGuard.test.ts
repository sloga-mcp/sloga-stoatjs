/**
 * Server actions refuse end-to-end encrypted messages.
 *
 * An encrypted message is a local row the native layer decrypted and
 * injected; the server never stored it. Editing one used to PATCH the new
 * text to the server in plaintext (and 404), reacting sent the emoji, and
 * "Mark unread" stored the local id as the server read pointer. Every server
 * action on `Message` now returns a rejected Promise carrying
 * `EncryptedMessageServerAction` without making a request, and `ack` does
 * nothing. Plaintext messages, and clients with no E2EE adapter, are
 * unchanged.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/messageEncryptedGuard.test.ts
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
type StoatMessage = ReturnType<StoatClient["messages"]["getOrCreate"]>;

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

const ME = "01K6C000000000000000000001";
const OTHER = "01K6C000000000000000000002";
const DM = "01K6C000000000000000000003";
const DEST = "01K6C000000000000000000004";
const FORWARDED = "01K6C000000000000000000005";
const POLL = "01K6C000000000000000000006";
const SOFTRES = "01K6C000000000000000000007";

const ERROR = { name: "Error", message: "EncryptedMessageServerAction" };

type Harness = {
  client: StoatClient;
  /** Every request or spied channel call, as "<kind> <path or id>" */
  calls: string[];
};

function noop(): void {}

let seq = 0;

/**
 * A fresh offline client with a DM channel, every request path stubbed to
 * record and resolve, and `channel.ack` / `channel.crosspostMessage` spied
 * (so the real 1.5 s ack timer never runs).
 * @param encrypted Ids the stub E2EE adapter reports as encrypted, or
 *   `undefined` for a client with no adapter at all
 */
function setup(encrypted: Set<string> | undefined): Harness {
  const calls: string[] = [];
  globalThis.fetch = ((url: unknown) => {
    calls.push(`fetch ${String(url)}`);
    return new Promise<never>(noop);
  }) as never;

  const client = new Client({ autoReconnect: false }, CONFIG as never);
  client.user = client.users.getOrCreate(ME, {
    _id: ME,
    username: "me",
    discriminator: "0001",
    relationship: "User",
    online: true,
  } as never);

  if (encrypted) {
    client.e2ee = {
      isEncryptedMessage: (id: string) => encrypted.has(id),
    } as never;
  }

  const api = client.api as unknown as Record<string, unknown>;
  for (const verb of ["get", "post", "put", "patch", "delete"]) {
    api[verb] = (path: string) => {
      calls.push(`${verb.toUpperCase()} ${path}`);
      return Promise.resolve(undefined);
    };
  }

  (client.channels as unknown as { apiReq: unknown }).apiReq = (
    method: string,
    path: string,
  ) => {
    calls.push(`${method} ${path}`);
    return Promise.resolve(
      path.endsWith("/forward")
        ? { _id: FORWARDED, channel: DEST, author: ME, content: "" }
        : { users: [] },
    );
  };

  const channel = client.channels.getOrCreate(DM, {
    _id: DM,
    channel_type: "DirectMessage",
    recipients: [ME, OTHER],
    active: true,
  } as never);
  const spied = channel as unknown as Record<string, unknown>;
  spied.ack = (message?: { id: string } | string) => {
    calls.push(
      `ack ${typeof message === "object" ? message.id : String(message)}`,
    );
    return Promise.resolve();
  };
  spied.crosspostMessage = (messageId: string) => {
    calls.push(`crosspost ${messageId}`);
    return Promise.resolve();
  };

  return { client, calls };
}

/** A DM message of our own carrying a poll and a soft-reserve sheet. */
function message(client: StoatClient, id = nextId()): StoatMessage {
  const msg = client.messages.getOrCreate(id, {
    _id: id,
    channel: DM,
    author: ME,
    content: "hello",
    poll: {
      id: POLL,
      question: "q",
      answers: [{ id: 0, text: "a" }],
      expires_at: 0,
    },
    softres: { id: SOFTRES },
  } as never);
  assert.ok(msg.channel, "the DM channel must resolve");
  return msg;
}

function nextId(): string {
  return `01K6C1${String(seq++).padStart(20, "0")}`;
}

/**
 * Every server action on `Message`, with minimal valid arguments and the
 * request (or spied channel call) it makes for a plaintext message.
 */
const ACTIONS: [
  name: string,
  run: (msg: StoatMessage) => unknown,
  expected: (msg: StoatMessage) => string,
][] = [
  [
    "edit",
    (m) => m.edit({ content: "x" }),
    (m) => `PATCH /channels/${DM}/messages/${m.id}`,
  ],
  [
    "delete",
    (m) => m.delete(),
    (m) => `DELETE /channels/${DM}/messages/${m.id}`,
  ],
  [
    "react",
    (m) => m.react("e"),
    (m) => `PUT /channels/${DM}/messages/${m.id}/reactions/e`,
  ],
  [
    "unreact",
    (m) => m.unreact("e"),
    (m) => `DELETE /channels/${DM}/messages/${m.id}/reactions/e`,
  ],
  [
    "clearReactions",
    (m) => m.clearReactions(),
    (m) => `DELETE /channels/${DM}/messages/${m.id}/reactions`,
  ],
  ["pin", (m) => m.pin(), (m) => `POST /channels/${DM}/messages/${m.id}/pin`],
  [
    "unpin",
    (m) => m.unpin(),
    (m) => `DELETE /channels/${DM}/messages/${m.id}/pin`,
  ],
  ["publish", (m) => m.publish(), (m) => `crosspost ${m.id}`],
  [
    "forwardTo",
    (m) => m.forwardTo(DEST),
    (m) => `POST /channels/${DM}/messages/${m.id}/forward`,
  ],
  [
    "fetchPoll",
    (m) => m.fetchPoll(),
    () => `GET /channels/${DM}/polls/${POLL}`,
  ],
  [
    "votePoll",
    (m) => m.votePoll([0]),
    () => `PUT /channels/${DM}/polls/${POLL}/vote`,
  ],
  [
    "removePollVote",
    (m) => m.removePollVote(),
    () => `DELETE /channels/${DM}/polls/${POLL}/vote`,
  ],
  [
    "endPoll",
    (m) => m.endPoll(),
    () => `POST /channels/${DM}/polls/${POLL}/end`,
  ],
  [
    "fetchPollVoters",
    (m) => m.fetchPollVoters(0),
    () => `GET /channels/${DM}/polls/${POLL}/voters`,
  ],
  [
    "fetchSoftRes",
    (m) => m.fetchSoftRes(),
    () => `GET /channels/${DM}/softres/${SOFTRES}`,
  ],
  [
    "reserveSoftRes",
    (m) => m.reserveSoftRes({} as never),
    () => `PUT /channels/${DM}/softres/${SOFTRES}/reserve`,
  ],
  [
    "retractSoftRes",
    (m) => m.retractSoftRes(),
    () => `DELETE /channels/${DM}/softres/${SOFTRES}/reserve`,
  ],
  [
    "editSoftRes",
    (m) => m.editSoftRes({} as never),
    () => `PATCH /channels/${DM}/softres/${SOFTRES}`,
  ],
  [
    "lockSoftRes",
    (m) => m.lockSoftRes(true),
    () => `POST /channels/${DM}/softres/${SOFTRES}/lock`,
  ],
  [
    "exportSoftRes",
    (m) => m.exportSoftRes("json" as never),
    () => `GET /channels/${DM}/softres/${SOFTRES}/export`,
  ],
];

/** Let any request a method started after its first await land. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

for (const [name, run] of ACTIONS) {
  test(`encrypted: ${name} rejects without a request`, async () => {
    const id = nextId();
    const { client, calls } = setup(new Set([id]));
    const msg = message(client, id);

    let result: unknown;
    assert.doesNotThrow(() => {
      result = run(msg);
    }, "must never throw synchronously");
    assert.ok(result instanceof Promise, "must return a Promise");
    await assert.rejects(result as Promise<unknown>, ERROR);

    await settle();
    assert.deepEqual(calls, []);
  });
}

test("encrypted: ack does nothing", async () => {
  const id = nextId();
  const { client, calls } = setup(new Set([id]));
  const msg = message(client, id);

  assert.equal(msg.ack(), undefined);
  assert.equal(msg.ack(true, false, true), undefined);

  await settle();
  assert.deepEqual(calls, []);
});

for (const [name, run, expected] of ACTIONS) {
  test(`plaintext: ${name} still reaches the server`, async () => {
    // The adapter is present and knows another encrypted id, so this
    // proves the lookup is per message
    const { client, calls } = setup(new Set([nextId()]));
    const msg = message(client);

    await run(msg);
    assert.deepEqual(calls, [expected(msg)]);
  });
}

test("plaintext: ack still acks the channel", () => {
  const { client, calls } = setup(new Set([nextId()]));
  const msg = message(client);

  msg.ack();
  assert.deepEqual(calls, [`ack ${msg.id}`]);
});

const NO_ADAPTER = new Set([
  "edit",
  "delete",
  "react",
  "unreact",
  "pin",
  "unpin",
  "publish",
  "forwardTo",
  "votePoll",
  "reserveSoftRes",
]);

for (const [name, run, expected] of ACTIONS) {
  if (!NO_ADAPTER.has(name)) continue;
  test(`no E2EE adapter: ${name} still reaches the server`, async () => {
    const { client, calls } = setup(undefined);
    assert.equal(client.e2ee, undefined);
    const msg = message(client);

    await run(msg);
    assert.deepEqual(calls, [expected(msg)]);
  });
}

test("no E2EE adapter: ack still acks the channel", () => {
  const { client, calls } = setup(undefined);
  const msg = message(client);

  msg.ack();
  assert.deepEqual(calls, [`ack ${msg.id}`]);
});
