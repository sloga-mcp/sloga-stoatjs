/**
 * Sends to a Protected channel never reach the plaintext message route
 * (plan 4.1, D9b).
 *
 * `Channel.sendMessage` hands every send to a protected or pinned text
 * channel to `e2ee.handleProtectedSend`, which encrypts or throws. These
 * cases pin that with no adapter (the web) the send throws
 * `ProtectedChannelUnavailable`, that an adapter failure surfaces as a
 * rejection, that no request at all is made by the SDK (no `/messages` POST
 * and no `Idempotency-Key` header: the adapter owns retries with the key),
 * and that attachments, stickers, embeds, masquerade and interactions are
 * refused with `ProtectedFieldRefusedClient` rather than stripped. An
 * ordinary text channel still sends in plaintext, which also proves the
 * fetch spy sees that route.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/protectedSend.test.ts
 *
 * To run the same cases against another `src/` tree, set `STOATJS_SRC`
 * (see loadSrc.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSrc } from "./loadSrc.ts";

type ClientModule = typeof import("../src/Client.ts");
type ProtectedModule = typeof import("../src/lib/protected.ts");
type StoatClient = InstanceType<ClientModule["Client"]>;
type StoatChannel = ReturnType<StoatClient["channels"]["getOrCreate"]>;

const { Client } = await loadSrc<ClientModule>("Client.ts");
const {
  PROTECTED_REFUSED_SEND_FIELDS,
  ProtectedChannelUnavailable,
  ProtectedFieldRefusedClient,
} = await loadSrc<ProtectedModule>("lib/protected.ts");

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

const ME = "01K6Q000000000000000000001";
const OTHER = "01K6Q000000000000000000002";
const SERVER = "01K6Q000000000000000000003";
const PROTECTED = "01K6Q000000000000000000004";
const PINNED = "01K6Q000000000000000000005";
const PLAIN = "01K6Q000000000000000000006";
const DM = "01K6Q000000000000000000007";
const SENT = "01K6Q000000000000000000008";
const KEY = "01K6Q000000000000000000009";

type FetchCall = { method: string; url: string; headers: string };

type Harness = {
  client: StoatClient;
  fetches: FetchCall[];
  channel: (id: string) => StoatChannel;
};

function headerText(headers: unknown): string {
  if (!headers) return "";
  if (headers instanceof Headers) {
    return JSON.stringify([...headers.entries()]);
  }
  return JSON.stringify(headers);
}

/**
 * A fresh offline client whose `fetch` records every request and answers a
 * message POST with a row, holding a protected server channel, a pinned
 * (server-unflagged) server channel, a plain server channel and a DM that
 * the server claims is protected.
 */
function setup(): Harness {
  const fetches: FetchCall[] = [];
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    fetches.push({
      method: String(init?.method ?? "GET").toUpperCase(),
      url: String(url),
      headers: headerText(init?.headers),
    });
    return Promise.resolve(
      new Response(
        JSON.stringify({ _id: SENT, channel: PLAIN, author: ME, content: "x" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }) as never;

  const client = new Client({ autoReconnect: false }, CONFIG as never);
  client.user = client.users.getOrCreate(ME, {
    _id: ME,
    username: "me",
    discriminator: "0001",
    relationship: "User",
    online: true,
  } as never);

  for (const [id, flag] of [
    [PROTECTED, true],
    [PINNED, undefined],
    [PLAIN, undefined],
  ] as const) {
    client.channels.getOrCreate(id, {
      _id: id,
      channel_type: "TextChannel",
      server: SERVER,
      name: id,
      ...(flag ? { protected: true } : {}),
    } as never);
  }
  client.protectedPins.add(PINNED);

  client.channels.getOrCreate(DM, {
    _id: DM,
    channel_type: "DirectMessage",
    active: true,
    recipients: [ME, OTHER],
    protected: true,
  } as never);

  return {
    client,
    fetches,
    channel: (id) => client.channels.get(id)!,
  };
}

type SendCall = { channelId: string; data: unknown; key: string };

/** An adapter stub; `send` decides what handleProtectedSend does. */
function adapter(
  client: StoatClient,
  send?: (call: SendCall) => Promise<unknown>,
): SendCall[] {
  const calls: SendCall[] = [];
  client.e2ee = {
    isEncryptedMessage: () => false,
    handleDirectMessageSend: () => Promise.resolve(null),
    handleGroupMessageSend: () => Promise.resolve(null),
    ...(send
      ? {
          handleProtectedSend: (
            channel: { id: string },
            data: unknown,
            key: string,
          ) => {
            const call = { channelId: channel.id, data, key };
            calls.push(call);
            return send(call);
          },
        }
      : {}),
  } as never;
  return calls;
}

/** Settle a promise within `ms`, so a send stuck on a request still fails. */
async function settle<T>(
  promise: Promise<T>,
  ms = 500,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("send did not settle")), ms);
  });
  try {
    return { ok: true, value: await Promise.race([promise, timeout]) };
  } catch (error) {
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

function assertNoPlaintext(fetches: FetchCall[]): void {
  assert.deepEqual(
    fetches.filter((call) => call.url.includes("/messages")),
    [],
    "no request may reach the message route",
  );
  assert.deepEqual(
    fetches.filter((call) => /idempotency-key/i.test(call.headers)),
    [],
    "no request may carry an Idempotency-Key",
  );
}

test("control: a plain server channel sends in plaintext with an Idempotency-Key", async () => {
  const { channel, fetches, client } = setup();
  const calls = adapter(client, () => Promise.reject(new Error("unused")));

  const result = await settle(channel(PLAIN).sendMessage("hello", KEY));
  assert.equal(result.ok, true);
  assert.equal(calls.length, 0);

  const posts = fetches.filter(
    (call) => call.method === "POST" && call.url.includes("/messages"),
  );
  assert.equal(posts.length, 1);
  assert.match(posts[0].headers, /Idempotency-Key/i);
  assert.match(posts[0].headers, new RegExp(KEY));
});

test("no adapter: a protected send throws and never falls through to plaintext", async () => {
  for (const id of [PROTECTED, PINNED]) {
    const { channel, fetches, client } = setup();
    assert.equal(client.e2ee, undefined);

    const result = await settle(channel(id).sendMessage("secret", KEY));
    assert.equal(result.ok, false, `${id} must reject`);
    assert.ok(
      !result.ok && result.error instanceof ProtectedChannelUnavailable,
      `expected ProtectedChannelUnavailable, got ${!result.ok && String(result.error)}`,
    );
    assertNoPlaintext(fetches);
  }
});

test("an adapter without the protected arm throws ProtectedChannelUnavailable", async () => {
  const { channel, fetches, client } = setup();
  adapter(client);

  const result = await settle(channel(PROTECTED).sendMessage("secret"));
  assert.ok(!result.ok && result.error instanceof ProtectedChannelUnavailable);
  assertNoPlaintext(fetches);
});

test("an adapter failure rejects the send and nothing else is sent", async () => {
  const { channel, fetches, client } = setup();
  const failure = new Error("FeatureDisabled");
  const calls = adapter(client, () => Promise.reject(failure));

  const result = await settle(channel(PROTECTED).sendMessage("secret", KEY));
  assert.ok(!result.ok && result.error === failure);
  assert.equal(calls.length, 1);
  assertNoPlaintext(fetches);
});

test("a protected send goes to the adapter with the key and makes no request", async () => {
  for (const id of [PROTECTED, PINNED]) {
    const { channel, fetches, client } = setup();
    const echo = { id: SENT };
    const calls = adapter(client, () => Promise.resolve(echo));

    const result = await settle(channel(id).sendMessage("@silent secret", KEY));
    assert.ok(result.ok && result.value === (echo as never));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].channelId, id);
    assert.equal(calls[0].key, KEY);
    assert.deepEqual(calls[0].data, { content: "secret", flags: 1 });
    assert.deepEqual(fetches, [], "the SDK makes no request of its own");
  }
});

test("refused fields throw ProtectedFieldRefusedClient and are never stripped", async () => {
  const values: Record<string, unknown> = {
    attachments: ["01K6Q00000000000000000000A"],
    e2eeAttachments: ["local-1"],
    sticker_ids: ["01K6Q00000000000000000000B"],
    embeds: [{ title: "t" }],
    masquerade: {},
    interactions: { reactions: ["x"] },
  };
  assert.deepEqual(
    Object.keys(values).sort(),
    [...PROTECTED_REFUSED_SEND_FIELDS].sort(),
  );

  for (const field of PROTECTED_REFUSED_SEND_FIELDS) {
    const { channel, fetches, client } = setup();
    const calls = adapter(client, () => Promise.resolve({ id: SENT }));

    const result = await settle(
      channel(PROTECTED).sendMessage({
        content: "secret",
        [field]: values[field],
      } as never),
    );
    assert.equal(result.ok, false, `${field} must be refused`);
    assert.ok(
      !result.ok &&
        result.error instanceof ProtectedFieldRefusedClient &&
        result.error.field === field,
      `${field}: got ${!result.ok && String(result.error)}`,
    );
    assert.equal(calls.length, 0, `${field}: the adapter is never reached`);
    assertNoPlaintext(fetches);
  }
});

test("absent, null and empty-array fields carry nothing and pass", async () => {
  const { channel, client } = setup();
  const calls = adapter(client, () => Promise.resolve({ id: SENT }));

  const result = await settle(
    channel(PROTECTED).sendMessage({
      content: "secret",
      attachments: [],
      embeds: null,
      masquerade: undefined,
    } as never),
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});

test("poll, soft-reserve and scheduled routes refuse a protected channel before any request", async () => {
  const routes: [string, (ch: StoatChannel) => Promise<unknown>][] = [
    [
      "createPoll",
      (ch) => ch.createPoll({ question: "q", answers: ["a"] } as never),
    ],
    ["createSoftRes", (ch) => ch.createSoftRes({ title: "t" } as never)],
    [
      "scheduleMessage",
      (ch) => ch.scheduleMessage({ content: "secret" }, Date.now() + 60_000),
    ],
  ];
  for (const [name, run] of routes) {
    for (const id of [PROTECTED, PINNED]) {
      const { channel, fetches } = setup();
      const result = await settle(run(channel(id)));
      assert.ok(
        !result.ok && result.error instanceof ProtectedChannelUnavailable,
        `${name} on ${id}: got ${!result.ok && String(result.error)}`,
      );
      assert.deepEqual(fetches, [], `${name} on ${id} made a request`);
    }
  }

  // Control: the same route on a plain channel does reach fetch
  const { channel, fetches } = setup();
  await settle(
    channel(PLAIN).createPoll({ question: "q", answers: ["a"] } as never),
  );
  assert.ok(fetches.some((call) => call.url.includes("/polls")));
});

test("createThread refuses a protected or pinned channel before any request (W4d F#1)", async () => {
  for (const anchor of [undefined, SENT]) {
    for (const id of [PROTECTED, PINNED]) {
      const { channel, fetches } = setup();
      const result = await settle(
        channel(id).createThread({ name: "secret title" } as never, anchor),
      );
      assert.ok(
        !result.ok && result.error instanceof ProtectedChannelUnavailable,
        `createThread(${anchor}) on ${id}: got ${!result.ok && String(result.error)}`,
      );
      assert.deepEqual(fetches, [], `createThread on ${id} made a request`);
    }
  }

  // Control: the same route on a plain channel does reach fetch
  const { channel, fetches } = setup();
  await settle(channel(PLAIN).createThread({ name: "title" } as never));
  assert.ok(fetches.some((call) => call.url.includes("/threads")));
});

/** Plaintext routes the SDK refuses on a protected or pinned channel. */
const GUARDED: [string, (ch: StoatChannel) => Promise<unknown>, string][] = [
  ["createWebhook", (ch) => ch.createWebhook("hook"), "/webhooks"],
  ["search", (ch) => ch.search({ query: "secret" } as never), "/search"],
  [
    "searchWithUsers",
    (ch) => ch.searchWithUsers({ query: "secret" } as never),
    "/search",
  ],
  [
    "createInteraction",
    (ch) => ch.createInteraction(KEY, { arg: "secret" }),
    "/interactions",
  ],
  [
    "interactWithMessage",
    (ch) => ch.interactWithMessage(SENT, "button"),
    "/interact",
  ],
  ["follow", (ch) => ch.follow(SERVER, PLAIN), "/follow"],
  ["crosspostMessage", (ch) => ch.crosspostMessage(SENT), "/crosspost"],
  ["sendCaption", (ch) => ch.sendCaption("secret", "en"), "/captions"],
];

test("text-carrying and refused server routes throw before any request on a protected or pinned channel (W4d)", async () => {
  for (const [name, run] of GUARDED) {
    for (const id of [PROTECTED, PINNED]) {
      const { channel, fetches } = setup();
      const result = await settle(run(channel(id)));
      assert.ok(
        !result.ok && result.error instanceof ProtectedChannelUnavailable,
        `${name} on ${id}: got ${!result.ok && String(result.error)}`,
      );
      assert.deepEqual(fetches, [], `${name} on ${id} made a request`);
    }
  }

  // Control: every route reaches fetch from a plain channel
  for (const [name, run, route] of GUARDED) {
    const { channel, fetches } = setup();
    await settle(run(channel(PLAIN)));
    assert.ok(
      fetches.some((call) => call.url.includes(route)),
      `${name} on a plain channel never reached ${route}`,
    );
  }
});

test("follow refuses a protected or pinned target channel before any request (W4d)", async () => {
  for (const target of [PROTECTED, PINNED]) {
    const { channel, fetches } = setup();
    const result = await settle(channel(PLAIN).follow(SERVER, target));
    assert.ok(
      !result.ok && result.error instanceof ProtectedChannelUnavailable,
      `follow into ${target}: got ${!result.ok && String(result.error)}`,
    );
    assert.deepEqual(fetches, [], `follow into ${target} made a request`);
  }
});

test("forwardTo refuses a protected or pinned source or destination before any request (W4d)", async () => {
  const row = (client: StoatClient, channelId: string) =>
    client.messages.getOrCreate(SENT, {
      _id: SENT,
      channel: channelId,
      author: OTHER,
      content: "secret",
    } as never);

  const cases: [string, string, (h: Harness) => string | StoatChannel][] = [];
  for (const id of [PROTECTED, PINNED]) {
    cases.push([`into ${id} (id)`, PLAIN, () => id]);
    cases.push([`into ${id} (channel)`, PLAIN, (h) => h.channel(id)]);
    cases.push([`from ${id}`, id, () => PLAIN]);
  }
  for (const [name, source, destination] of cases) {
    const h = setup();
    const result = await settle(
      row(h.client, source).forwardTo(destination(h), KEY),
    );
    assert.ok(
      !result.ok && result.error instanceof ProtectedChannelUnavailable,
      `forward ${name}: got ${!result.ok && String(result.error)}`,
    );
    assert.deepEqual(h.fetches, [], `forward ${name} made a request`);
  }

  // Control: a plain-to-plain forward reaches the route
  const h = setup();
  await settle(row(h.client, PLAIN).forwardTo(PLAIN, KEY));
  assert.ok(h.fetches.some((call) => call.url.includes("/forward")));
});

test("the pinned listing (search without a query) still requests on a protected or pinned channel (W4d)", async () => {
  for (const id of [PROTECTED, PINNED]) {
    for (const method of ["search", "searchWithUsers"] as const) {
      const { channel, fetches } = setup();
      await settle(channel(id)[method]({ pinned: true } as never));
      assert.ok(
        fetches.some(
          (call) => call.method === "POST" && call.url.includes("/search"),
        ),
        `${method} pinned listing on ${id} made no request`,
      );
    }
  }
});

test("a DM the server flags protected keeps the DM path", async () => {
  const { channel, client } = setup();
  assert.equal(client.isProtectedChannel(DM), false);
  const dmSends: string[] = [];
  const calls = adapter(client, () => Promise.resolve({ id: SENT }));
  (client.e2ee as unknown as Record<string, unknown>).handleDirectMessageSend =
    (ch: { id: string }) => {
      dmSends.push(ch.id);
      return Promise.resolve({ id: SENT });
    };

  const result = await settle(channel(DM).sendMessage("hi"));
  assert.equal(result.ok, true);
  assert.deepEqual(dmSends, [DM]);
  assert.equal(calls.length, 0);
});
