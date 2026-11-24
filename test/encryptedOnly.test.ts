/**
 * Encrypted-only chats: the user and group flags, the plain-write guard and
 * the settings route.
 *
 * - `e2ee_only` on a user hydrates to `e2eeOnly` (absent = false), an update
 *   carrying an explicit `false` clears it, and Ready refreshes that one
 *   field on a user the client already holds.
 * - `e2ee_only` on a group is one-way: `true` lands from any object, nothing
 *   lowers it, and other channel types never carry it.
 * - `client.plainWriteGuard` runs before the request of every plain write
 *   and before a channel-bound upload; a throw means no request. A send the
 *   E2EE adapter handled never reaches it. Unset, requests go out as before.
 * - `client.setEncryptedOnly` sends `PUT /e2ee/only` with the MFA ticket.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/encryptedOnly.test.ts
 *
 * To run the same cases against another `src/` tree, set `STOATJS_SRC`
 * (see loadSrc.ts). New modules are loaded inside the cases that need them,
 * so an older tree fails case by case instead of at import.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSrc } from "./loadSrc.ts";

type ClientModule = typeof import("../src/Client.ts");
type EventsModule = typeof import("../src/events/v1.ts");
type InteractionModule = typeof import("../src/classes/Interaction.ts");
type StoatClient = InstanceType<ClientModule["Client"]>;
type StoatChannel = ReturnType<StoatClient["channels"]["getOrCreate"]>;

const { Client } = await loadSrc<ClientModule>("Client.ts");
const { handleEvent } = await loadSrc<EventsModule>("events/v1.ts");
const { respondToInteraction } = await loadSrc<InteractionModule>(
  "classes/Interaction.ts",
);

// Passing a configuration stops the constructor fetching `/` for one
const CONFIG = {
  revolt: "test",
  features: {
    autumn: { enabled: true, url: "http://autumn.test" },
    january: { enabled: false, url: "" },
  },
  ws: "ws://127.0.0.1:9",
  app: "",
  vapid: "",
  build: {},
};

const ME = "01K7E000000000000000000001";
const PEER = "01K7E000000000000000000002";
const SERVER = "01K7E000000000000000000003";
const DM = "01K7E000000000000000000004";
const GROUP = "01K7E000000000000000000005";
const MARKED = "01K7E000000000000000000006";
const TEXT = "01K7E000000000000000000007";
const MSG = "01K7E000000000000000000008";
const SENT = "01K7E000000000000000000009";
const POLL = "01K7E00000000000000000000A";
const SHEET = "01K7E00000000000000000000B";
const KEY = "01K7E00000000000000000000C";

type FetchCall = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

type GuardCall = { channelId: string; kind: string; fetchesBefore: number };

type ServerEvent = { type: string } & Record<string, unknown>;

type Harness = {
  client: StoatClient;
  fetches: FetchCall[];
  channel: (id: string) => StoatChannel;
  fire: (event: ServerEvent) => Promise<void>;
  /** Install a guard that records each call and throws when `refuse`. */
  guard: (refuse?: boolean) => GuardCall[];
};

class Refused extends Error {}

function headerRecord(headers: unknown): Record<string, string> {
  if (!headers) return {};
  const entries =
    headers instanceof Headers
      ? [...headers.entries()]
      : Object.entries(headers as Record<string, string>);
  return Object.fromEntries(
    entries.map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
}

function noop(): void {}

const ME_USER = {
  _id: ME,
  username: "me",
  discriminator: "0001",
  relationship: "User",
  online: true,
};

function peerUser(extra: Record<string, unknown> = {}) {
  return {
    _id: PEER,
    username: "peer",
    discriminator: "0002",
    relationship: "Friend",
    online: true,
    ...extra,
  };
}

function group(id: string, extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    channel_type: "Group",
    name: `group-${id}`,
    owner: ME,
    recipients: [ME, PEER],
    ...extra,
  };
}

function ready(users: unknown[], channels: unknown[] = []): ServerEvent {
  return {
    type: "Ready",
    users,
    servers: [],
    channels,
    members: [],
    emojis: [],
  };
}

/**
 * A fresh offline client whose `fetch` records every request, holding this
 * user, a peer, a DM, a plain group, a marked group and a server channel.
 * `reply` is the JSON every request answers with.
 */
function setup(reply: unknown = { _id: SENT, channel: GROUP, author: ME }) {
  const fetches: FetchCall[] = [];
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        /* keep the raw text */
      }
    }
    fetches.push({
      method: String(init?.method ?? "GET").toUpperCase(),
      url: String(url),
      headers: headerRecord(init?.headers),
      body,
    });
    return Promise.resolve(
      new Response(JSON.stringify(reply), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as never;

  const client = new Client({ autoReconnect: false }, CONFIG as never);
  client.user = client.users.getOrCreate(ME, ME_USER as never);
  client.users.getOrCreate(PEER, peerUser() as never);

  client.channels.getOrCreate(DM, {
    _id: DM,
    channel_type: "DirectMessage",
    active: true,
    recipients: [ME, PEER],
  } as never);
  client.channels.getOrCreate(GROUP, group(GROUP) as never);
  client.channels.getOrCreate(
    MARKED,
    group(MARKED, { e2ee_only: true }) as never,
  );
  client.channels.getOrCreate(TEXT, {
    _id: TEXT,
    channel_type: "TextChannel",
    server: SERVER,
    name: "text",
  } as never);

  const harness: Harness = {
    client,
    fetches,
    channel: (id) => client.channels.get(id)!,
    fire: (event) => handleEvent(client, event as never, noop as never),
    guard: (refuse = false) => {
      const calls: GuardCall[] = [];
      (client as unknown as { plainWriteGuard: unknown }).plainWriteGuard = (
        channel: { id: string },
        kind: string,
      ) => {
        calls.push({
          channelId: channel.id,
          kind,
          fetchesBefore: fetches.length,
        });
        if (refuse) throw new Refused(kind);
      };
      return calls;
    },
  };
  return harness;
}

/** Settle a promise within `ms`, so a call stuck on a request still fails. */
async function settle<T>(
  run: () => Promise<T> | T,
  ms = 500,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("call did not settle")), ms);
  });
  try {
    // `run` is called inside the try so a synchronous throw counts too
    return { ok: true, value: await Promise.race([run(), timeout]) };
  } catch (error) {
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

function userFlag(client: StoatClient, id: string): unknown {
  return (client.users.get(id) as unknown as { e2eeOnly: unknown }).e2eeOnly;
}

function channelFlag(client: StoatClient, id: string): unknown {
  return (client.channels.get(id) as unknown as { e2eeOnly: unknown })
    .e2eeOnly;
}

function message(client: StoatClient, channelId: string) {
  return client.messages.getOrCreate(MSG, {
    _id: MSG,
    channel: channelId,
    author: ME,
    content: "x",
    poll: {
      id: POLL,
      question: "q",
      answers: [{ id: 0, text: "a" }],
      expires_at: 0,
    },
    softres: { id: SHEET, title: "t" },
  } as never);
}

// ----- user flag -------------------------------------------------------------

test("user: e2ee_only true hydrates to e2eeOnly, an absent key is false", () => {
  const { client } = setup();
  const OTHER = "01K7E00000000000000000000D";
  client.users.getOrCreate(
    OTHER,
    peerUser({ _id: OTHER, e2ee_only: true }) as never,
  );

  assert.equal(userFlag(client, OTHER), true);
  assert.equal(userFlag(client, PEER), false);
  assert.equal(userFlag(client, ME), false);
});

test("user: UserUpdate with an explicit false clears it, one without the key keeps it", async () => {
  const { client, fire } = setup();

  await fire({ type: "UserUpdate", id: PEER, data: { e2ee_only: true } });
  assert.equal(userFlag(client, PEER), true);

  await fire({ type: "UserUpdate", id: PEER, data: { username: "renamed" } });
  assert.equal(userFlag(client, PEER), true, "a partial without the key");
  assert.equal(client.users.get(PEER)!.username, "renamed");

  await fire({ type: "UserUpdate", id: PEER, data: { e2ee_only: false } });
  assert.equal(userFlag(client, PEER), false, "an explicit false");
});

test("user: Ready refreshes e2eeOnly on a known user and nothing else", async () => {
  const { client, fire } = setup();
  const peer = client.users.get(PEER)!;

  // Turned on while the socket was down
  await fire(
    ready([ME_USER, peerUser({ username: "changed", e2ee_only: true })]),
  );
  assert.equal(userFlag(client, PEER), true);
  assert.equal(client.users.get(PEER), peer, "the object is kept");
  assert.equal(peer.username, "peer", "no other field is refreshed");

  // Turned off while the socket was down: full objects omit a false flag
  await fire(ready([ME_USER, peerUser()]));
  assert.equal(userFlag(client, PEER), false);

  // The session user is refreshed the same way
  await fire(ready([{ ...ME_USER, e2ee_only: true }, peerUser()]));
  assert.equal(userFlag(client, ME), true);
  assert.equal(client.user, client.users.get(ME));
});

// ----- group flag ------------------------------------------------------------

test("group: e2ee_only hydrates on a group only", () => {
  const { client } = setup();
  assert.equal(channelFlag(client, MARKED), true);
  assert.equal(channelFlag(client, GROUP), false);

  const FLAGGED_DM = "01K7E00000000000000000000E";
  const FLAGGED_TEXT = "01K7E00000000000000000000F";
  client.channels.getOrCreate(FLAGGED_DM, {
    _id: FLAGGED_DM,
    channel_type: "DirectMessage",
    active: true,
    recipients: [ME, PEER],
    e2ee_only: true,
  } as never);
  client.channels.getOrCreate(FLAGGED_TEXT, {
    _id: FLAGGED_TEXT,
    channel_type: "TextChannel",
    server: SERVER,
    name: "t",
    e2ee_only: true,
  } as never);
  assert.equal(channelFlag(client, FLAGGED_DM), false);
  assert.equal(channelFlag(client, FLAGGED_TEXT), false);
});

test("group: an update sets the mark, and nothing lowers it", async () => {
  const { client, fire } = setup();

  await fire({ type: "ChannelUpdate", id: GROUP, data: { e2ee_only: true } });
  assert.equal(channelFlag(client, GROUP), true, "an update can set it");

  await fire({ type: "ChannelUpdate", id: GROUP, data: { name: "renamed" } });
  assert.equal(channelFlag(client, GROUP), true, "a partial without the key");
  assert.equal(client.channels.get(GROUP)!.name, "renamed");

  await fire({
    type: "ChannelUpdate",
    id: GROUP,
    data: { e2ee_only: false },
  });
  assert.equal(channelFlag(client, GROUP), true, "an explicit false");

  await fire(ready([ME_USER], [group(GROUP)]));
  assert.equal(channelFlag(client, GROUP), true, "a full object without it");

  // Not a group: the same update marks nothing
  await fire({ type: "ChannelUpdate", id: DM, data: { e2ee_only: true } });
  await fire({ type: "ChannelUpdate", id: TEXT, data: { e2ee_only: true } });
  assert.equal(channelFlag(client, DM), false);
  assert.equal(channelFlag(client, TEXT), false);
});

test("group: Ready and ChannelCreate mark a group the client already holds", async () => {
  for (const type of ["Ready", "ChannelCreate"]) {
    const { client, fire } = setup();
    assert.equal(channelFlag(client, GROUP), false);

    const full = group(GROUP, { e2ee_only: true });
    await fire(
      type === "Ready" ? ready([ME_USER], [full]) : { type, ...full },
    );
    assert.equal(channelFlag(client, GROUP), true, type);
  }
});

// ----- guard -----------------------------------------------------------------

test("guard: a plain send asks first, and a refusal makes no request", async () => {
  for (const id of [DM, GROUP, TEXT]) {
    const allowed = setup();
    const calls = allowed.guard();
    const sent = await settle(() => allowed.channel(id).sendMessage("hi", KEY));
    assert.equal(sent.ok, true, `${id} sends`);
    assert.deepEqual(calls, [
      { channelId: id, kind: "send", fetchesBefore: 0 },
    ]);
    assert.equal(allowed.fetches.length, 1);
    // The typed client leaves a bare `?` on a route without a query
    assert.match(allowed.fetches[0].url, /\/messages\??$/);

    const refused = setup();
    const refusedCalls = refused.guard(true);
    const result = await settle(() =>
      refused.channel(id).sendMessage("hi", KEY),
    );
    assert.ok(
      !result.ok && result.error instanceof Refused,
      `${id}: got ${JSON.stringify(result)}`,
    );
    assert.equal(refusedCalls.length, 1);
    assert.deepEqual(refused.fetches, [], `${id} made a request`);
  }
});

test("guard: a send the adapter handled never asks; a null answer does", async () => {
  for (const id of [DM, GROUP]) {
    // The adapter sent it encrypted
    const handled = setup();
    const calls = handled.guard(true);
    const echo = { id: SENT };
    handled.client.e2ee = {
      isEncryptedMessage: () => false,
      handleDirectMessageSend: () => Promise.resolve(echo),
      handleGroupMessageSend: () => Promise.resolve(echo),
    } as never;
    const sent = await settle(() => handled.channel(id).sendMessage("hi"));
    assert.ok(sent.ok && sent.value === (echo as never), `${id} handled`);
    assert.deepEqual(calls, [], `${id}: the guard was asked`);
    assert.deepEqual(handled.fetches, []);

    // The adapter answered "plaintext": the guard stands in the way
    const fallthrough = setup();
    const fallCalls = fallthrough.guard(true);
    fallthrough.client.e2ee = {
      isEncryptedMessage: () => false,
      handleDirectMessageSend: () => Promise.resolve(null),
      handleGroupMessageSend: () => Promise.resolve(null),
    } as never;
    const result = await settle(() =>
      fallthrough.channel(id).sendMessage("hi"),
    );
    assert.ok(!result.ok && result.error instanceof Refused, `${id} refused`);
    assert.deepEqual(
      fallCalls.map((call) => call.kind),
      ["send"],
    );
    assert.deepEqual(fallthrough.fetches, [], `${id} made a request`);
  }
});

test("guard: an edit asks first, and a refusal makes no request", async () => {
  const allowed = setup();
  const calls = allowed.guard();
  await settle(() => message(allowed.client, GROUP).edit({ content: "y" }));
  assert.deepEqual(calls, [
    { channelId: GROUP, kind: "edit", fetchesBefore: 0 },
  ]);
  assert.equal(allowed.fetches.length, 1);
  assert.equal(allowed.fetches[0].method, "PATCH");

  const refused = setup();
  refused.guard(true);
  const result = await settle(() =>
    message(refused.client, GROUP).edit({ content: "y" }),
  );
  assert.ok(!result.ok && result.error instanceof Refused);
  assert.deepEqual(refused.fetches, []);
});

test("guard: a channel-bound upload asks first, and a refusal uploads nothing", async () => {
  const file = new File(["plain"], "a.txt");
  type Upload = (
    tag: string,
    file: File,
    url?: string,
    channel?: StoatChannel,
  ) => Promise<string>;

  const allowed = setup({ id: "file-id" });
  const calls = allowed.guard();
  const upload = allowed.client.uploadFile.bind(allowed.client) as Upload;
  const done = await settle(() =>
    upload("attachments", file, undefined, allowed.channel(DM)),
  );
  assert.ok(done.ok && done.value === "file-id");
  assert.deepEqual(calls, [
    { channelId: DM, kind: "upload", fetchesBefore: 0 },
  ]);
  assert.equal(allowed.fetches[0].url, "http://autumn.test/attachments");

  const refused = setup({ id: "file-id" });
  refused.guard(true);
  const result = await settle(() =>
    (refused.client.uploadFile.bind(refused.client) as Upload)(
      "attachments",
      file,
      undefined,
      refused.channel(DM),
    ),
  );
  assert.ok(!result.ok && result.error instanceof Refused);
  assert.deepEqual(refused.fetches, []);

  // No channel (an avatar, a server icon): never asked
  const unbound = setup({ id: "file-id" });
  const unboundCalls = unbound.guard(true);
  const avatar = await settle(() =>
    unbound.client.uploadFile("avatars", file),
  );
  assert.equal(avatar.ok, true);
  assert.deepEqual(unboundCalls, []);
  assert.equal(unbound.fetches.length, 1);
});

/** Every other guarded writer: name, kind, channel asked about, call. */
const WRITERS: [string, string, string, (h: Harness) => unknown][] = [
  [
    "createPoll",
    "poll",
    GROUP,
    (h) => h.channel(GROUP).createPoll({ question: "q" } as never),
  ],
  [
    "createSoftRes",
    "softres",
    GROUP,
    (h) => h.channel(GROUP).createSoftRes({ title: "t" } as never),
  ],
  [
    "scheduleMessage",
    "schedule",
    GROUP,
    (h) => h.channel(GROUP).scheduleMessage({ content: "x" }, Date.now()),
  ],
  [
    "createInteraction",
    "interaction",
    GROUP,
    (h) => h.channel(GROUP).createInteraction(KEY, { arg: "x" }),
  ],
  [
    "interactWithMessage",
    "interaction",
    GROUP,
    (h) => h.channel(GROUP).interactWithMessage(MSG, "button"),
  ],
  [
    "respondToInteraction",
    "interaction",
    GROUP,
    (h) =>
      respondToInteraction(h.client, KEY, "token", "x", {
        channelId: GROUP,
      } as never),
  ],
  [
    "sendCaption",
    "captions",
    GROUP,
    (h) => h.channel(GROUP).sendCaption("x", "en"),
  ],
  [
    "startWatch",
    "watch",
    GROUP,
    (h) =>
      h.channel(GROUP).startWatch({
        provider: "youtube",
        video_id: "xxxxxxxxxxx",
      }),
  ],
  [
    "updateWatch with media",
    "watch",
    GROUP,
    (h) =>
      h.channel(GROUP).updateWatch({
        playing: true,
        position_ms: 0,
        rate_permille: 1000,
        media: { provider: "youtube", video_id: "xxxxxxxxxxx" },
      }),
  ],
  [
    "forwardTo (id)",
    "forward",
    GROUP,
    (h) => message(h.client, TEXT).forwardTo(GROUP, KEY),
  ],
  [
    "forwardTo (channel)",
    "forward",
    GROUP,
    (h) => message(h.client, TEXT).forwardTo(h.channel(GROUP), KEY),
  ],
  ["votePoll", "poll", GROUP, (h) => message(h.client, GROUP).votePoll([0])],
  [
    "reserveSoftRes",
    "softres",
    GROUP,
    (h) => message(h.client, GROUP).reserveSoftRes({ name: "x" } as never),
  ],
  [
    "editSoftRes",
    "softres",
    GROUP,
    (h) => message(h.client, GROUP).editSoftRes({ title: "x" } as never),
  ],
];

for (const [name, kind, channelId, run] of WRITERS) {
  test(`guard: ${name} asks with "${kind}" first, and a refusal makes no request`, async () => {
    const refused = setup();
    const calls = refused.guard(true);
    const result = await settle(() => run(refused) as Promise<unknown>);
    if (kind === "watch") {
      // Watch writes never reject: a refusal is a failed result
      assert.ok(result.ok, `got ${JSON.stringify(result)}`);
      assert.deepEqual((result as { value?: unknown }).value, {
        ok: false,
        status: 0,
        error: "EncryptionRequired",
      });
    } else {
      assert.ok(
        !result.ok && result.error instanceof Refused,
        `got ${JSON.stringify(result)}`,
      );
    }
    assert.deepEqual(calls, [{ channelId, kind, fetchesBefore: 0 }]);
    assert.deepEqual(refused.fetches, [], "a request was made");

    // Control: with no guard the same call reaches the network
    const open = setup();
    await settle(() => run(open) as Promise<unknown>);
    assert.equal(open.fetches.length, 1, "no request without a guard");
  });
}

test("guard: a watch heartbeat without media is not asked", async () => {
  const h = setup();
  const calls = h.guard(true);
  await settle(() =>
    h.channel(GROUP).updateWatch({
      playing: true,
      position_ms: 5,
      rate_permille: 1000,
    }),
  );
  assert.deepEqual(calls, []);
  assert.equal(h.fetches.length, 1);
});

test("guard absent: send, edit and upload go out as before", async () => {
  const h = setup({ _id: SENT, channel: GROUP, author: ME, id: "file-id" });
  assert.equal(
    (h.client as unknown as { plainWriteGuard: unknown }).plainWriteGuard,
    undefined,
  );

  const sent = await settle(() => h.channel(GROUP).sendMessage("hi", KEY));
  assert.equal(sent.ok, true);
  const edited = await settle(() =>
    message(h.client, GROUP).edit({ content: "y" }),
  );
  assert.equal(edited.ok, true);
  const uploaded = await settle(() =>
    h.client.uploadFile("attachments", new File(["x"], "a.txt")),
  );
  assert.equal(uploaded.ok, true);

  assert.deepEqual(
    h.fetches.map((call) => call.method),
    ["POST", "PATCH", "POST"],
  );
});

test("EncryptedOnlyBlockedError is exported with its name and reason", async () => {
  const index = await loadSrc<Record<string, unknown>>("index.ts");
  const Blocked = index.EncryptedOnlyBlockedError as new (
    reason: string,
  ) => Error & { reason: string };
  assert.equal(typeof Blocked, "function");

  const error = new Blocked("block-peer");
  assert.ok(error instanceof Error);
  assert.equal(error.name, "EncryptedOnlyBlockedError");
  assert.equal(error.reason, "block-peer");
});

// ----- settings route --------------------------------------------------------

test("setEncryptedOnly sends PUT /e2ee/only with the ticket and stores the reply", async () => {
  type SetOnly = (enabled: boolean, ticket: string) => Promise<boolean>;

  for (const enabled of [true, false]) {
    const h = setup({ e2ee_only: enabled });
    if (!enabled) {
      await h.fire({ type: "UserUpdate", id: ME, data: { e2ee_only: true } });
    }
    const setOnly = (
      h.client as unknown as { setEncryptedOnly: SetOnly }
    ).setEncryptedOnly.bind(h.client);

    const result = await settle(() => setOnly(enabled, "ticket-token"));
    assert.ok(result.ok && result.value === enabled, JSON.stringify(result));

    assert.equal(h.fetches.length, 1);
    const [call] = h.fetches;
    assert.equal(call.method, "PUT");
    assert.equal(call.url, "https://stoat.chat/api/e2ee/only");
    assert.equal(call.headers["x-mfa-ticket"], "ticket-token");
    assert.equal(call.headers["content-type"], "application/json");
    assert.deepEqual(call.body, { enabled });
    assert.equal(userFlag(h.client, ME), enabled);
  }
});

test("setEncryptedOnly rejects with the API error and leaves the flag alone", async () => {
  const h = setup();
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ type: "InvalidToken" }), { status: 401 }),
    )) as never;

  const result = await settle(() =>
    (
      h.client as unknown as {
        setEncryptedOnly: (e: boolean, t: string) => Promise<boolean>;
      }
    ).setEncryptedOnly(true, "bad"),
  );
  assert.ok(!result.ok);
  assert.deepEqual(!result.ok && result.error, { type: "InvalidToken" });
  assert.equal(userFlag(h.client, ME), false);
});
