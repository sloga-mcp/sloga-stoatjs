/**
 * The protected-channels S2 server events reach the E2EE adapter unchanged.
 *
 * S2 adds `ProtectedChannelChanged` (design 7.5: a seats / Text group change
 * on a protected channel's topic), the Text join fields `generation` and
 * `issued_at` on `MlsJoinRequested` and on a commit's rejoin intents, and the
 * server's advisory `removed_reasons` on a Text commit envelope. The SDK only
 * relays them: `handleEvent` hands each to `client.e2ee.onEvent` as the same
 * object, so no field is dropped before the native layer verifies it. These
 * cases pin that, against the exact JSON the backend serializes at 74390c37,
 * that an S1 join request still relays unchanged, that
 * `ProtectedChannelChanged` is a no-op without an adapter, and that it reaches
 * no other adapter hook and no message path. Each typed literal below also
 * matches the backend JSON byte for byte, so the `E2EEServerEvent` shapes stay
 * in step with the wire.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/protectedS2.test.ts
 *
 * To run the same cases against another `src/` tree, set `STOATJS_SRC`
 * (see loadSrc.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { E2EEServerEvent } from "../src/classes/E2EE.ts";

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

const ME = "01K6S000000000000000000001";
const SERVER = "01K6S000000000000000000002";
const MSG = "01K6S000000000000000000003";

// Backend 74390c37 (archive /home/mcp/pc-logs/s2/w4/be-74390c37). EventV1 is
// `#[serde(tag = "type")]` (crates/core/database/src/events/client.rs:58), so
// `type` comes first and a newtype variant (MlsCommit(E2EEMessage)) inlines
// the envelope's fields after it.

// client.rs:473-476 (variant), :1272 (exact wire test)
const CHANGED_SEATS_ID = "01J9Z3K4M5N6P7Q8R9S0T1V2W3";
const CHANGED_SEATS = `{"type":"ProtectedChannelChanged","id":"01J9Z3K4M5N6P7Q8R9S0T1V2W3","scope":["seats"]}`;

// client.rs:1288 (both scopes, in order)
const CHANGED_BOTH = `{"type":"ProtectedChannelChanged","id":"C","scope":["seats","text_group"]}`;

// client.rs:1301 JOIN_REQUESTED_S1, exactly as an S1 build sends it
const JOIN_S1 = `{"type":"MlsJoinRequested","group_id":"G","channel_id":"C","user_id":"U","device_id":"D","key_package_ref":"a3ByZWY","signature":"c2ln","rejoin":false}`;

// client.rs:836-857 (generation/issued_at: skip_serializing_if none, after
// `rejoin`), values from the round-trip test :1326-1336
const JOIN_S2 = `{"type":"MlsJoinRequested","group_id":"G","channel_id":"C","user_id":"U","device_id":"D","key_package_ref":"a3ByZWY","signature":"c2ln","rejoin":true,"generation":3,"issued_at":1790812800000}`;

// crates/core/models/src/v0/e2ee.rs:315 CALL_COMMIT_AT_996641F1 (E2EEMessage
// :255-303, content_type snake_case :8), as the body of an MlsCommit event
const CALL_COMMIT = `{"id":"01JA0000000000000000000ENV","recipient_user_id":"01JA00000000000000000USERB","recipient_device_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","sender_user_id":"01JA00000000000000000USERA","sender_device_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","protocol_version":1,"sequence":0,"ciphertext":"Y29tbWl0","content_type":"mls_commit","group_id":"0000000000000000000000000000000000000000000000000000000000000001","epoch":4}`;

/** An MlsCommit event: `type` first, then the envelope's fields */
function commitEvent(envelope: string, extra = ""): string {
  return `{"type":"MlsCommit",${envelope.slice(1, -1)}${extra}}`;
}

// e2ee.rs:373-430 text_commit_envelope_carries_the_declarations: every
// declaration, ending in `removed_reasons` (e2ee.rs:299-302; the reason
// enum is snake_case, crates/core/models/src/v0/mls.rs:153-174; the entry
// is MlsRemovedReasonInfo, mls.rs:177-184)
const COMMIT_REASONS = commitEvent(
  CALL_COMMIT,
  `,"committer":{"user_id":"01JA00000000000000000USERA","device_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"added":[{"user_id":"01JA00000000000000000USERC","device_id":"cccccccccccccccccccccccccccccccc"}],"removed":[{"user_id":"01JA00000000000000000USERB","device_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}],"rejoin_intents":[{"group_id":"0000000000000000000000000000000000000000000000000000000000000001","channel_id":"01JA0000000000000000CHANNEL","user_id":"01JA00000000000000000USERB","device_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","key_package_ref":"a3ByZWY","signature":"c2ln"}],"removed_reasons":[{"user_id":"01JA00000000000000000USERB","device_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","reason":"rejoin"}]`,
);

// e2ee.rs:435-457 text_commit_envelope_carries_text_join_fields: a rejoin
// intent signed over the Text join payload (MlsRejoinIntentInfo, mls.rs:126-145)
const COMMIT_JOIN_FIELDS = commitEvent(
  CALL_COMMIT,
  `,"rejoin_intents":[{"group_id":"0000000000000000000000000000000000000000000000000000000000000001","channel_id":"01JA0000000000000000CHANNEL","user_id":"01JA00000000000000000USERB","device_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","key_package_ref":"a3ByZWY","signature":"c2ln","generation":65535,"issued_at":1760000000000}]`,
);

// mls.rs:600-603: a reason this build does not know (the native layer maps
// it to Unknown), next to the S2 `pending_device` reason (mls.rs:167)
const COMMIT_FUTURE_REASON = commitEvent(
  CALL_COMMIT,
  `,"removed":[{"user_id":"01JA00000000000000000USERB","device_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},{"user_id":"01JA00000000000000000USERC","device_id":"cccccccccccccccccccccccccccccccc"}],"removed_reasons":[{"user_id":"01JA00000000000000000USERB","device_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","reason":"from_the_future"},{"user_id":"01JA00000000000000000USERC","device_id":"cccccccccccccccccccccccccccccccc","reason":"pending_device"}]`,
);

const A32 = "a".repeat(32);
const B32 = "b".repeat(32);
const C32 = "c".repeat(32);
const GROUP = `${"0".repeat(63)}1`;
const USER_A = "01JA00000000000000000USERA";
const USER_B = "01JA00000000000000000USERB";
const USER_C = "01JA00000000000000000USERC";

const CALL_COMMIT_FIELDS = {
  id: "01JA0000000000000000000ENV",
  recipient_user_id: USER_B,
  recipient_device_id: B32,
  sender_user_id: USER_A,
  sender_device_id: A32,
  protocol_version: 1,
  sequence: 0,
  ciphertext: "Y29tbWl0",
  content_type: "mls_commit",
  group_id: GROUP,
  epoch: 4,
} as const;

const REJOIN_INTENT = {
  group_id: GROUP,
  channel_id: "01JA0000000000000000CHANNEL",
  user_id: USER_B,
  device_id: B32,
  key_package_ref: "a3ByZWY",
  signature: "c2ln",
};

type Case = {
  name: string;
  /** The backend JSON */
  wire: string;
  /** The same event as an `E2EEServerEvent` literal */
  typed: E2EEServerEvent;
};

const CASES: Case[] = [
  {
    name: "ProtectedChannelChanged seats",
    wire: CHANGED_SEATS,
    typed: {
      type: "ProtectedChannelChanged",
      id: CHANGED_SEATS_ID,
      scope: ["seats"],
    } satisfies E2EEServerEvent,
  },
  {
    name: "ProtectedChannelChanged seats and text_group",
    wire: CHANGED_BOTH,
    typed: {
      type: "ProtectedChannelChanged",
      id: "C",
      scope: ["seats", "text_group"],
    } satisfies E2EEServerEvent,
  },
  {
    name: "MlsJoinRequested with generation and issued_at",
    wire: JOIN_S2,
    typed: {
      type: "MlsJoinRequested",
      group_id: "G",
      channel_id: "C",
      user_id: "U",
      device_id: "D",
      key_package_ref: "a3ByZWY",
      signature: "c2ln",
      rejoin: true,
      generation: 3,
      issued_at: 1790812800000,
    } satisfies E2EEServerEvent,
  },
  {
    name: "MlsJoinRequested from an S1 build",
    wire: JOIN_S1,
    typed: {
      type: "MlsJoinRequested",
      group_id: "G",
      channel_id: "C",
      user_id: "U",
      device_id: "D",
      key_package_ref: "a3ByZWY",
      signature: "c2ln",
      rejoin: false,
    } satisfies E2EEServerEvent,
  },
  {
    name: "MlsCommit envelope with removed_reasons",
    wire: COMMIT_REASONS,
    typed: {
      type: "MlsCommit",
      ...CALL_COMMIT_FIELDS,
      committer: { user_id: USER_A, device_id: A32 },
      added: [{ user_id: USER_C, device_id: C32 }],
      removed: [{ user_id: USER_B, device_id: B32 }],
      rejoin_intents: [REJOIN_INTENT],
      removed_reasons: [{ user_id: USER_B, device_id: B32, reason: "rejoin" }],
    } satisfies E2EEServerEvent,
  },
  {
    name: "MlsCommit envelope with a Text rejoin intent",
    wire: COMMIT_JOIN_FIELDS,
    typed: {
      type: "MlsCommit",
      ...CALL_COMMIT_FIELDS,
      rejoin_intents: [
        { ...REJOIN_INTENT, generation: 65535, issued_at: 1760000000000 },
      ],
    } satisfies E2EEServerEvent,
  },
  {
    name: "MlsCommit envelope with an unknown removal reason",
    wire: COMMIT_FUTURE_REASON,
    typed: {
      type: "MlsCommit",
      ...CALL_COMMIT_FIELDS,
      removed: [
        { user_id: USER_B, device_id: B32 },
        { user_id: USER_C, device_id: C32 },
      ],
      removed_reasons: [
        { user_id: USER_B, device_id: B32, reason: "from_the_future" },
        { user_id: USER_C, device_id: C32, reason: "pending_device" },
      ],
    } satisfies E2EEServerEvent,
  },
];

type ServerEvent = { type: string } & Record<string, unknown>;

type Harness = {
  client: StoatClient;
  /** Every adapter hook called, in order, with its first argument */
  hooks: { hook: string; arg: unknown }[];
  emitted: string[];
  fire: (event: ServerEvent) => Promise<void>;
};

function noop(): void {}

// Every hook an adapter may implement; the stub records a call to any of them
const ADAPTER_HOOKS = [
  "handleDirectMessageSend",
  "fetchLocalHistory",
  "isEncryptedMessage",
  "prepareDraftAttachments",
  "handleGroupMessageSend",
  "onEvent",
  "handleProtectedSend",
  "onProtectedMessage",
  "decryptProtectedHistory",
  "onProtectedFlagStripped",
  "onChannelProtected",
];

/**
 * A fresh offline client holding a protected server channel with one row.
 * With `adapter` set, an E2EE adapter stub records every hook called;
 * otherwise there is none.
 */
function setup(adapter: boolean): Harness {
  globalThis.fetch = (() => new Promise<never>(noop)) as never;

  const client = new Client({ autoReconnect: false }, CONFIG as never);
  client.user = client.users.getOrCreate(ME, {
    _id: ME,
    username: "me",
    discriminator: "0001",
    relationship: "User",
    online: true,
  } as never);

  client.channels.getOrCreate(CHANGED_SEATS_ID, {
    _id: CHANGED_SEATS_ID,
    channel_type: "TextChannel",
    server: SERVER,
    name: "protected",
    protected: true,
  } as never);
  client.messages.getOrCreate(MSG, {
    _id: MSG,
    channel: CHANGED_SEATS_ID,
    author: ME,
  } as never);

  const hooks: { hook: string; arg: unknown }[] = [];
  if (adapter) {
    const stub: Record<string, (arg: unknown) => unknown> = {};
    for (const hook of ADAPTER_HOOKS) {
      stub[hook] = (arg) => {
        hooks.push({ hook, arg });
        return hook === "isEncryptedMessage" ? false : undefined;
      };
    }
    (client as unknown as { e2ee: unknown }).e2ee = stub;
  } else {
    assert.equal(client.e2ee, undefined);
  }

  const emitted: string[] = [];
  const emit = client.emit.bind(client) as (
    name: string,
    ...args: unknown[]
  ) => unknown;
  (client as unknown as { emit: typeof emit }).emit = (name, ...args) => {
    emitted.push(name);
    return emit(name, ...args);
  };

  return {
    client,
    hooks,
    emitted,
    fire: (event) => handleEvent(client, event as never, noop as never),
  };
}

/** What a message-path handler could change for the seeded channel */
function channelState(client: StoatClient) {
  return {
    messages: client.messages.size(),
    row: client.messages.has(MSG),
    lastMessageId: client.channels.get(CHANGED_SEATS_ID)?.lastMessageId,
    protected: client.channels.get(CHANGED_SEATS_ID)?.isProtected,
  };
}

for (const { name, wire, typed } of CASES) {
  test(`${name}: the backend JSON relays to the adapter unchanged`, async () => {
    // The typed shape is the backend JSON, key for key and in order
    assert.equal(JSON.stringify(typed), wire);

    const { hooks, fire } = setup(true);
    const event = JSON.parse(wire) as ServerEvent;

    await fire(event);

    assert.deepEqual(
      hooks.map(({ hook }) => hook),
      ["onEvent"],
    );
    assert.equal(hooks[0].arg, event, "the same object, not a copy");
    assert.equal(JSON.stringify(hooks[0].arg), wire);
    assert.deepEqual(hooks[0].arg, JSON.parse(wire));
  });
}

test("ProtectedChannelChanged: an unknown scope item is relayed as it is", async () => {
  // The SDK does not filter `scope`; the adapter ignores unknown items
  const { hooks, fire } = setup(true);
  const wire = `{"type":"ProtectedChannelChanged","id":"C","scope":["text_group","from_the_future"]}`;
  const event = JSON.parse(wire) as ServerEvent;

  await fire(event);

  assert.deepEqual(
    hooks.map(({ hook }) => hook),
    ["onEvent"],
  );
  assert.equal(JSON.stringify(hooks[0].arg), wire);
});

test("ProtectedChannelChanged: without an E2EE adapter it is a no-op", async () => {
  const { client, emitted, fire } = setup(false);
  const before = channelState(client);

  await assert.doesNotReject(fire(JSON.parse(CHANGED_SEATS) as ServerEvent));

  assert.deepEqual(emitted, []);
  assert.deepEqual(channelState(client), before);
});

test("ProtectedChannelChanged: no other adapter hook and no message path", async () => {
  // The event names a cached protected channel with a stored row: only
  // onEvent sees it, nothing is emitted, and the channel and row are as
  // they were
  const { client, hooks, emitted, fire } = setup(true);
  const before = channelState(client);

  await fire(JSON.parse(CHANGED_SEATS) as ServerEvent);

  assert.deepEqual(
    hooks.map(({ hook }) => hook),
    ["onEvent"],
  );
  assert.deepEqual(emitted, []);
  assert.deepEqual(channelState(client), before);
});

test("Bulk: a wrapped ProtectedChannelChanged relays unchanged", async () => {
  const { hooks, fire } = setup(true);

  await fire({ type: "Bulk", v: [JSON.parse(CHANGED_BOTH)] });

  assert.deepEqual(
    hooks.map(({ hook }) => hook),
    ["onEvent"],
  );
  assert.equal(JSON.stringify(hooks[0].arg), CHANGED_BOTH);
});
