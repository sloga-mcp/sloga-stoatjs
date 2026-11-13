/**
 * `Channel.joinCall` ring options and `Channel.declineCall`, as they go out on
 * the wire.
 *
 * `joinCall` takes a 6th parameter `opts` with two ring signals, `answer` and
 * `video`. Each is put in the `join_call` body only when it is exactly `true`,
 * the same way the 5th parameter `rejoin` is, so a join without `opts` sends
 * the body it always did. `declineCall` issues a bodiless
 * `PUT /channels/<id>/decline_call` and rejects with the server's typed error
 * object.
 *
 * The cases read the request off `fetch`, below both the typed client and
 * `apiReq`, so a key that either of them dropped on the way would fail here.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/joinCallOptions.test.ts
 *
 * To run the same cases against another `src/` tree, such as a known-bad
 * control, set `STOATJS_SRC` to its absolute path. The tree needs a sibling
 * `node_modules` symlink (see loadSrc.ts).
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { loadSrc } from "./loadSrc.ts";

type ClientModule = typeof import("../src/Client.ts");
type StoatClient = InstanceType<ClientModule["Client"]>;
type StoatChannel = ReturnType<StoatClient["channels"]["getOrCreate"]>;

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

const BASE = "http://127.0.0.1:9/api";

const ME = "01K6R000000000000000000001";
const OTHER = "01K6R000000000000000000002";
const DM = "01K6R000000000000000000003";

const JOIN_PATH = `/api/channels/${DM}/join_call`;
const DECLINE_PATH = `/api/channels/${DM}/decline_call`;

type Call = {
  method: string;
  url: string;
  path: string;
  body: string | undefined;
  headers: string;
};

type Harness = {
  channel: StoatChannel;
  /** Every request made to `path`, in order */
  calls: (path: string) => Call[];
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * A fresh offline client holding one DM, whose `fetch` records every request
 * and answers it with `status` and `payload` (no body at all for a 204).
 */
function setup(status = 200, payload: unknown = { token: "t", url: "u" }) {
  const all: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    all.push({
      method: String(init?.method ?? "GET"),
      url,
      path: new URL(url).pathname,
      body: init?.body as string | undefined,
      headers: JSON.stringify(init?.headers ?? {}),
    });
    return new Response(status === 204 ? null : JSON.stringify(payload), {
      status,
      headers: status === 204 ? {} : { "Content-Type": "application/json" },
    });
  }) as never;

  const client = new Client(
    { autoReconnect: false, baseURL: BASE },
    CONFIG as never,
  );
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

  const harness: Harness = {
    channel,
    calls: (path) => all.filter((call) => call.path === path),
  };
  return harness;
}

/** The one `join_call` request made, with its body parsed. */
function joinRequest(h: Harness): {
  raw: string;
  body: Record<string, unknown>;
} {
  const calls = h.calls(JOIN_PATH);
  assert.equal(calls.length, 1, "expected exactly one join_call request");
  assert.equal(calls[0].method.toUpperCase(), "POST");
  assert.equal(typeof calls[0].body, "string", "join_call carries a body");
  const raw = calls[0].body as string;
  return { raw, body: JSON.parse(raw) as Record<string, unknown> };
}

/** Await `promise` and return what it rejected with, or fail. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  let thrown: { value: unknown } | undefined;
  try {
    await promise;
  } catch (error) {
    thrown = { value: error };
  }
  assert.ok(thrown, "expected a rejection");
  return thrown.value;
}

test("no opts: the body has no answer or video key and is unchanged", async () => {
  const h = setup();

  const auth = await h.channel.joinCall();

  const { raw, body } = joinRequest(h);
  assert.equal("answer" in body, false);
  assert.equal("video" in body, false);
  assert.equal("rejoin" in body, false);
  // The whole body, byte for byte, as it was before `opts` existed.
  assert.equal(raw, '{"force_disconnect":true}');
  assert.deepEqual(auth, { token: "t", url: "u" });
});

test("{ answer: true } adds only answer: true", async () => {
  const h = setup();

  await h.channel.joinCall(undefined, true, undefined, undefined, undefined, {
    answer: true,
  });

  const { body } = joinRequest(h);
  assert.deepEqual(body, { force_disconnect: true, answer: true });
  assert.equal("video" in body, false);
});

test("{ video: true } adds only video: true", async () => {
  const h = setup();

  await h.channel.joinCall(undefined, true, undefined, undefined, undefined, {
    video: true,
  });

  const { body } = joinRequest(h);
  assert.deepEqual(body, { force_disconnect: true, video: true });
  assert.equal("answer" in body, false);
});

test("rejoin as the 5th argument still yields rejoin: true", async () => {
  const h = setup();

  await h.channel.joinCall(undefined, true, undefined, undefined, true);

  const { raw, body } = joinRequest(h);
  assert.deepEqual(body, { force_disconnect: true, rejoin: true });
  assert.equal(raw, '{"force_disconnect":true,"rejoin":true}');
});

test("{ answer: false, video: false } adds neither key", async () => {
  const h = setup();

  await h.channel.joinCall(undefined, true, undefined, undefined, undefined, {
    answer: false,
    video: false,
  });

  const { raw, body } = joinRequest(h);
  assert.equal("answer" in body, false);
  assert.equal("video" in body, false);
  assert.equal(raw, '{"force_disconnect":true}');
});

test("an empty opts object and undefined members add neither key", async () => {
  for (const opts of [{}, { answer: undefined, video: undefined }]) {
    const h = setup();

    await h.channel.joinCall(
      undefined,
      true,
      undefined,
      undefined,
      false,
      opts,
    );

    assert.equal(joinRequest(h).raw, '{"force_disconnect":true}');
  }
});

test("a truthy value that is not true adds no key", async () => {
  const h = setup();

  await h.channel.joinCall(undefined, true, undefined, undefined, undefined, {
    answer: 1,
    video: "yes",
  } as never);

  assert.equal(joinRequest(h).raw, '{"force_disconnect":true}');
});

test("every argument together: the first five keep their places and keys", async () => {
  const h = setup();

  await h.channel.joinCall("node-a", false, [OTHER], "device-1", true, {
    answer: true,
    video: true,
  });

  // `answer` is absent: an automatic rejoin is never an Answer, so `rejoin`
  // wins and the key is dropped.
  const { raw, body } = joinRequest(h);
  assert.deepEqual(body, {
    node: "node-a",
    recipients: [OTHER],
    force_disconnect: false,
    device_id: "device-1",
    rejoin: true,
    video: true,
  });
  // The new keys go after the existing ones, so the leading bytes match the
  // body the same five arguments produced before.
  assert.ok(
    raw.startsWith(
      `{"node":"node-a","recipients":["${OTHER}"],"force_disconnect":false,"device_id":"device-1","rejoin":true`,
    ),
    raw,
  );
});

test("declineCall issues a bodiless PUT /channels/<id>/decline_call", async () => {
  const h = setup(204);

  assert.equal(typeof h.channel.declineCall, "function");
  const result = await h.channel.declineCall();

  assert.equal(result, undefined);
  const calls = h.calls(DECLINE_PATH);
  assert.equal(calls.length, 1, "expected exactly one decline_call request");
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].url, `${BASE}/channels/${DM}/decline_call`);
  assert.equal(calls[0].body, undefined);
  assert.doesNotMatch(calls[0].headers, /content-type/i);
  // Declining never joins.
  assert.deepEqual(h.calls(JOIN_PATH), []);
});

test("declineCall rejects with the server's typed error object", async () => {
  const h = setup(400, { type: "NoEffect" });

  assert.equal(typeof h.channel.declineCall, "function");
  const error = await rejection(h.channel.declineCall());

  assert.deepEqual(error, { type: "NoEffect" });
  assert.equal(h.calls(DECLINE_PATH).length, 1);
});

test("answer without rejoin is sent; answer with rejoin is not", async () => {
  const plain = setup();
  await plain.channel.joinCall(undefined, true, undefined, undefined, false, {
    answer: true,
  });
  assert.equal(joinRequest(plain).body.answer, true);

  const rejoining = setup();
  await rejoining.channel.joinCall(
    undefined,
    true,
    undefined,
    undefined,
    true,
    { answer: true },
  );
  const { body } = joinRequest(rejoining);
  assert.equal("answer" in body, false);
  assert.equal(body.rejoin, true);
});
