/**
 * Server message events never touch an end-to-end encrypted row.
 *
 * An inbound encrypted row is injected locally by the E2EE layer under the
 * server's envelope id, so the server knows that id. `handleEvent` used to
 * apply MessageUpdate, MessageAppend, MessageDelete, MessageReact,
 * MessageUnreact, MessageRemoveReaction and BulkMessageDelete to any cached
 * id, which let a compromised server rewrite, delete or react to a message
 * still shown under the lock. These cases pin that every such event aimed at
 * an encrypted row is ignored without an emit, while a plaintext row, or a
 * client with no E2EE adapter, behaves as before.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/encryptedRowEvents.test.ts
 *
 * To run the same cases against another `src/` tree, such as a known-bad
 * control exported from an older commit, set `STOATJS_SRC` to its absolute
 * path. The tree needs a sibling `node_modules` symlink (see loadSrc.ts).
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

const ME = "01K6E000000000000000000001";
const OTHER = "01K6E000000000000000000002";
const DM = "01K6E000000000000000000003";

// The encrypted row and an ordinary plaintext row in the same DM
const ENC = "01K6E000000000000000000004";
const PLAIN = "01K6E000000000000000000005";

// Custom emoji ids, so no non-ASCII appears in this file
const E1 = "01K6E000000000000000000006";
const E2 = "01K6E000000000000000000007";

const SEEDED = "seeded";
const FORGED = "forged";

// Every emit a message event may produce
const MESSAGE_EVENTS = [
  "messageUpdate",
  "messageDelete",
  "messageDeleteId",
  "messageDeleteBulk",
  "messageReactionAdd",
  "messageReactionRemove",
  "messageReactionRemoveEmoji",
];

type ServerEvent = { type: string } & Record<string, unknown>;

type Harness = {
  client: StoatClient;
  emitted: string[];
  fire: (event: ServerEvent) => Promise<void>;
};

function noop(): void {}

/**
 * A fresh offline client with a DM holding ENC and PLAIN, each with content,
 * one embed and one reaction from OTHER. With `encrypted` set, the E2EE
 * adapter stub reports ENC (only) as encrypted; otherwise there is none.
 */
function setup(encrypted: boolean): Harness {
  globalThis.fetch = (() => new Promise<never>(noop)) as never;

  const client = new Client({ autoReconnect: false }, CONFIG as never);

  for (const id of [ME, OTHER, DM, ENC, PLAIN, E1, E2]) {
    assert.match(id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/, `${id} is not a ULID`);
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
    active: true,
    recipients: [ME, OTHER],
  } as never);

  for (const id of [ENC, PLAIN]) {
    client.messages.getOrCreate(id, {
      _id: id,
      channel: DM,
      author: OTHER,
      content: SEEDED,
      embeds: [{ type: "None" }],
      reactions: { [E1]: [OTHER] },
    } as never);
  }

  if (encrypted) {
    const ids = new Set([ENC]);
    (client as unknown as { e2ee: unknown }).e2ee = {
      isEncryptedMessage: (id: string) => ids.has(id),
    };
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

  // Hydration drops a misspelled key with only a console.debug, so check the
  // seed landed before any case relies on it
  for (const id of [ENC, PLAIN]) {
    assert.deepEqual(snapshot(client, id), {
      exists: true,
      content: SEEDED,
      edited: false,
      embeds: 1,
      reactions: { [E1]: [OTHER] },
    });
  }
  assert.equal(client.channels.get(DM)?.type, "DirectMessage");

  return {
    client,
    emitted,
    fire: (event) => handleEvent(client, event as never, noop as never),
  };
}

/** Everything a message event could change on a row */
function snapshot(client: StoatClient, id: string) {
  const message = client.messages.get(id);
  if (!message) return { exists: false };

  const reactions: Record<string, string[]> = {};
  for (const [emoji, users] of message.reactions) {
    reactions[emoji] = [...users].sort();
  }

  return {
    exists: true,
    content: message.content,
    edited: message.editedAt !== undefined,
    embeds: message.embeds?.length ?? 0,
    reactions,
  };
}

function messageEvents(emitted: string[]): string[] {
  return emitted.filter((name) => MESSAGE_EVENTS.includes(name));
}

type Case = {
  name: string;
  event: (id: string) => ServerEvent;
  /** The row after the event when it is applied */
  applied: ReturnType<typeof snapshot>;
  /** The emits when it is applied */
  emits: string[];
};

const CASES: Case[] = [
  {
    name: "MessageUpdate",
    event: (id) => ({
      type: "MessageUpdate",
      id,
      channel: DM,
      data: { content: FORGED },
    }),
    applied: {
      exists: true,
      content: FORGED,
      edited: true,
      embeds: 1,
      reactions: { [E1]: [OTHER] },
    },
    emits: ["messageUpdate"],
  },
  {
    name: "MessageAppend",
    event: (id) => ({
      type: "MessageAppend",
      id,
      channel: DM,
      append: { embeds: [{ type: "None" }] },
    }),
    applied: {
      exists: true,
      content: SEEDED,
      edited: false,
      embeds: 2,
      reactions: { [E1]: [OTHER] },
    },
    emits: ["messageUpdate"],
  },
  {
    name: "MessageDelete",
    event: (id) => ({ type: "MessageDelete", id, channel: DM }),
    applied: { exists: false },
    emits: ["messageDeleteId", "messageDelete"],
  },
  {
    name: "MessageReact",
    event: (id) => ({
      type: "MessageReact",
      id,
      channel_id: DM,
      user_id: ME,
      emoji_id: E2,
    }),
    applied: {
      exists: true,
      content: SEEDED,
      edited: false,
      embeds: 1,
      reactions: { [E1]: [OTHER], [E2]: [ME] },
    },
    emits: ["messageReactionAdd"],
  },
  {
    name: "MessageUnreact",
    event: (id) => ({
      type: "MessageUnreact",
      id,
      channel_id: DM,
      user_id: OTHER,
      emoji_id: E1,
    }),
    applied: {
      exists: true,
      content: SEEDED,
      edited: false,
      embeds: 1,
      reactions: {},
    },
    emits: ["messageReactionRemove"],
  },
  {
    name: "MessageRemoveReaction",
    event: (id) => ({
      type: "MessageRemoveReaction",
      id,
      channel_id: DM,
      emoji_id: E1,
    }),
    applied: {
      exists: true,
      content: SEEDED,
      edited: false,
      embeds: 1,
      reactions: {},
    },
    emits: ["messageReactionRemoveEmoji"],
  },
];

for (const { name, event, applied, emits } of CASES) {
  test(`${name}: an encrypted row is left unchanged and nothing is emitted`, async () => {
    const { client, emitted, fire } = setup(true);
    const before = snapshot(client, ENC);

    await fire(event(ENC));

    assert.deepEqual(snapshot(client, ENC), before);
    assert.deepEqual(messageEvents(emitted), []);
    assert.deepEqual(snapshot(client, PLAIN), before, "PLAIN untouched");
  });

  test(`${name}: a plaintext row next to an encrypted one is applied`, async () => {
    const { client, emitted, fire } = setup(true);
    const encBefore = snapshot(client, ENC);

    await fire(event(PLAIN));

    assert.deepEqual(snapshot(client, PLAIN), applied);
    assert.deepEqual(messageEvents(emitted), emits);
    assert.deepEqual(snapshot(client, ENC), encBefore, "ENC untouched");
  });

  test(`${name}: without an E2EE adapter every row is applied`, async () => {
    for (const id of [ENC, PLAIN]) {
      const { client, emitted, fire } = setup(false);

      await fire(event(id));

      assert.deepEqual(snapshot(client, id), applied, id);
      assert.deepEqual(messageEvents(emitted), emits, id);
    }
  });
}

test("BulkMessageDelete: encrypted ids are skipped, the rest are deleted", async () => {
  const { client, emitted, fire } = setup(true);
  const encBefore = snapshot(client, ENC);
  const bulk: unknown[][] = [];
  client.on("messageDeleteBulk", (...args: unknown[]) => bulk.push(args));

  await fire({ type: "BulkMessageDelete", channel: DM, ids: [ENC, PLAIN] });

  assert.deepEqual(snapshot(client, ENC), encBefore);
  assert.deepEqual(snapshot(client, PLAIN), { exists: false });
  assert.deepEqual(messageEvents(emitted), ["messageDeleteBulk"]);
  assert.equal(bulk.length, 1);
  const [messages] = bulk[0] as [{ id: string }[]];
  assert.deepEqual(
    messages.map((message) => message.id),
    [PLAIN],
  );
});

test("BulkMessageDelete: only encrypted ids deletes nothing", async () => {
  const { client, fire } = setup(true);
  const encBefore = snapshot(client, ENC);
  const bulk: unknown[][] = [];
  client.on("messageDeleteBulk", (...args: unknown[]) => bulk.push(args));

  await fire({ type: "BulkMessageDelete", channel: DM, ids: [ENC] });

  assert.deepEqual(snapshot(client, ENC), encBefore);
  assert.equal(bulk.length, 1);
  assert.deepEqual(bulk[0][0], []);
});

test("BulkMessageDelete: without an E2EE adapter every id is deleted", async () => {
  const { client, fire } = setup(false);

  await fire({ type: "BulkMessageDelete", channel: DM, ids: [ENC, PLAIN] });

  assert.deepEqual(snapshot(client, ENC), { exists: false });
  assert.deepEqual(snapshot(client, PLAIN), { exists: false });
});

test("Bulk: a wrapped forged update still leaves the encrypted row alone", async () => {
  const { client, emitted, fire } = setup(true);
  const before = snapshot(client, ENC);

  await fire({
    type: "Bulk",
    v: [
      {
        type: "MessageUpdate",
        id: ENC,
        channel: DM,
        data: { content: FORGED },
      },
      { type: "MessageDelete", id: ENC, channel: DM },
    ],
  });

  assert.deepEqual(snapshot(client, ENC), before);
  assert.deepEqual(messageEvents(emitted), []);
});
