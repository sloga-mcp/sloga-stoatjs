/**
 * The protected pin set is one-way, per user, and survives a corrupt or
 * unavailable store (plan D9a).
 *
 * `client.protectedPins` keeps a channel protected client-side once this
 * device has seen it protected, so a server that later omits or lowers the
 * flag cannot reopen the plaintext send path or the server-text surfaces.
 * These cases pin that the set has no removal, persists under
 * `protected-channel-pins:<userId>` only, merges with other tabs, keeps
 * working in memory when the store is corrupt or throws, and reports that
 * through `loadFailed`.
 *
 * S4: a pin also holds `{ boundary, wiped }` under a second key,
 * `protected-channel-history:<userId>`. The boundary is set once, `wiped`
 * only goes to true, and the id list key keeps its format.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/protectedPins.test.ts
 *
 * To run the same cases against another `src/` tree, set `STOATJS_SRC`
 * (see loadSrc.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSrc } from "./loadSrc.ts";

type PinsModule = typeof import("../src/lib/protectedPins.ts");

const {
  ProtectedPinSet,
  protectedPinsKey,
  parseProtectedPins,
  protectedHistoryKey,
  parseProtectedHistory,
} = await loadSrc<PinsModule>("lib/protectedPins.ts");

const U1 = "01K6P000000000000000000001";
const U2 = "01K6P000000000000000000002";
const C1 = "01K6P000000000000000000003";
const C2 = "01K6P000000000000000000004";
const C3 = "01K6P000000000000000000005";
const B1 = "01K6P000000000000000000006";
const B2 = "01K6P000000000000000000007";

type MemoryStorage = {
  data: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function memory(seed: Record<string, string> = {}): MemoryStorage {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

function stored(storage: MemoryStorage, userId: string): unknown {
  const raw = storage.data.get(protectedPinsKey(userId));
  return raw === undefined ? undefined : JSON.parse(raw);
}

test("the storage key is per user", () => {
  assert.equal(protectedPinsKey(U1), `protected-channel-pins:${U1}`);
  assert.notEqual(protectedPinsKey(U1), protectedPinsKey(U2));
});

test("one-way: added pins stay and there is no way to remove one", () => {
  const storage = memory();
  const pins = new ProtectedPinSet(storage);
  pins.loadFor(U1);
  pins.add(C1);
  pins.add(C1);

  assert.equal(pins.has(C1), true);
  assert.deepEqual(pins.all(), [C1]);
  for (const name of ["remove", "delete", "clear"]) {
    assert.equal(
      (pins as unknown as Record<string, unknown>)[name],
      undefined,
      `ProtectedPinSet must not expose ${name}`,
    );
  }
  assert.deepEqual(stored(storage, U1), [C1]);

  // all() is a copy, so mutating it cannot unpin
  pins.all().pop();
  assert.equal(pins.has(C1), true);
});

test("pins persist under the user's key and reload in a fresh set", () => {
  const storage = memory();
  const first = new ProtectedPinSet(storage);
  first.loadFor(U1);
  first.add(C1);
  first.add(C2);

  const second = new ProtectedPinSet(storage);
  second.loadFor(U1);
  assert.equal(second.loadFailed, false);
  assert.deepEqual(second.all().sort(), [C1, C2].sort());
});

test("another user's pins are neither loaded nor written", () => {
  const storage = memory();
  const pins = new ProtectedPinSet(storage);
  pins.loadFor(U1);
  pins.add(C1);

  pins.loadFor(U2);
  assert.equal(pins.has(C1), false);
  pins.add(C2);

  assert.deepEqual(stored(storage, U1), [C1]);
  assert.deepEqual(stored(storage, U2), [C2]);
});

test("pins added before the first load are kept and written for that user", () => {
  const storage = memory({ [protectedPinsKey(U1)]: JSON.stringify([C1]) });
  const pins = new ProtectedPinSet(storage);
  pins.add(C2);
  assert.equal(storage.data.size, 1, "nothing is written before a user");

  pins.loadFor(U1);
  assert.deepEqual(pins.all().sort(), [C1, C2].sort());
  assert.deepEqual((stored(storage, U1) as string[]).sort(), [C1, C2].sort());
});

test("a write unions with pins another tab stored meanwhile", () => {
  const storage = memory();
  const pins = new ProtectedPinSet(storage);
  pins.loadFor(U1);
  pins.add(C1);

  // Another tab adds C2 directly to the store
  storage.setItem(protectedPinsKey(U1), JSON.stringify([C1, C2]));
  pins.add(C3);

  assert.deepEqual(
    (stored(storage, U1) as string[]).sort(),
    [C1, C2, C3].sort(),
  );
  assert.equal(pins.has(C2), true);
});

test("a corrupt store sets loadFailed and the set keeps working in memory", () => {
  for (const raw of ["{not json", '{"a":1}', "42", "null"]) {
    const storage = memory({ [protectedPinsKey(U1)]: raw });
    const pins = new ProtectedPinSet(storage);
    pins.loadFor(U1);

    assert.equal(pins.loadFailed, true, `loadFailed for ${raw}`);
    assert.deepEqual(pins.all(), []);
    pins.add(C1);
    assert.equal(pins.has(C1), true);
    assert.deepEqual(stored(storage, U1), [C1], `rewritten after ${raw}`);
  }
});

test("a partly corrupt list keeps the readable ids and flags loadFailed", () => {
  const storage = memory({
    [protectedPinsKey(U1)]: JSON.stringify([C1, 7, null, "", C2]),
  });
  const pins = new ProtectedPinSet(storage);
  pins.loadFor(U1);

  assert.equal(pins.loadFailed, true);
  assert.deepEqual(pins.all().sort(), [C1, C2].sort());
  assert.deepEqual(parseProtectedPins(JSON.stringify([C1])), {
    ids: [C1],
    corrupt: false,
  });
});

test("a store that throws leaves an in-memory set and loadFailed", () => {
  const throwing = {
    getItem(): string | null {
      throw new Error("SecurityError");
    },
    setItem(): void {
      throw new Error("QuotaExceededError");
    },
  };
  const pins = new ProtectedPinSet(throwing);
  pins.loadFor(U1);

  assert.equal(pins.loadFailed, true);
  assert.doesNotThrow(() => pins.add(C1));
  assert.equal(pins.has(C1), true);
});

test("no localStorage at all leaves an in-memory set and loadFailed", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError");
    },
  });
  try {
    const pins = new ProtectedPinSet();
    pins.loadFor(U1);
    assert.equal(pins.loadFailed, true);
    pins.add(C1);
    assert.equal(pins.has(C1), true);
  } finally {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

// --- S4: the pre-protect history of a pin --------------------------------

function storedHistory(storage: MemoryStorage, userId: string): unknown {
  const raw = storage.data.get(protectedHistoryKey(userId));
  return raw === undefined ? undefined : JSON.parse(raw);
}

function pinned(storage: MemoryStorage, ...ids: string[]) {
  const pins = new ProtectedPinSet(storage);
  pins.loadFor(U1);
  for (const id of ids) pins.add(id);
  return pins;
}

test("pin history: stored under a second per-user key, and the id list key keeps its format", () => {
  assert.equal(protectedHistoryKey(U1), `protected-channel-history:${U1}`);
  assert.notEqual(protectedHistoryKey(U1), protectedPinsKey(U1));

  const storage = memory();
  const pins = pinned(storage, C1, C2);
  const listBefore = storage.data.get(protectedPinsKey(U1));
  assert.equal(pins.historyOf(C1), undefined);

  assert.equal(pins.setHistory(C1, { boundary: B1, wiped: false }), true);

  assert.deepEqual(pins.historyOf(C1), { boundary: B1, wiped: false });
  assert.equal(pins.historyOf(C2), undefined);
  assert.deepEqual(storedHistory(storage, U1), {
    [C1]: { boundary: B1, wiped: false },
  });
  // The id list is byte-for-byte what it was: an older build reads it
  assert.equal(storage.data.get(protectedPinsKey(U1)), listBefore);
  assert.deepEqual(stored(storage, U1), [C1, C2]);
  assert.equal(storage.data.size, 2);
});

test("pin history: only a pinned id takes one, and only a ULID boundary with a boolean wiped", () => {
  const storage = memory();
  const pins = pinned(storage, C1);

  assert.equal(pins.setHistory(C2, { boundary: B1, wiped: false }), false);
  assert.equal(pins.historyOf(C2), undefined);
  assert.equal(pins.has(C2), false, "setHistory never pins");

  for (const history of [
    { boundary: "", wiped: false },
    { boundary: B1.toLowerCase(), wiped: false },
    { boundary: B1.slice(0, 25), wiped: false },
    { boundary: 7, wiped: false },
    { boundary: B1, wiped: "false" },
    { boundary: B1 },
    null,
    undefined,
  ]) {
    assert.equal(pins.setHistory(C1, history as never), false);
  }
  assert.equal(pins.historyOf(C1), undefined);
  assert.equal(storedHistory(storage, U1), undefined);
});

test("pin history: the boundary is set once and a different one is refused", () => {
  const storage = memory();
  const pins = pinned(storage, C1);
  assert.equal(pins.setHistory(C1, { boundary: B1, wiped: false }), true);

  assert.equal(pins.setHistory(C1, { boundary: B2, wiped: false }), false);
  assert.equal(pins.setHistory(C1, { boundary: B2, wiped: true }), false);

  assert.deepEqual(pins.historyOf(C1), { boundary: B1, wiped: false });
  assert.deepEqual(storedHistory(storage, U1), {
    [C1]: { boundary: B1, wiped: false },
  });
  // The same boundary again is accepted and changes nothing
  assert.equal(pins.setHistory(C1, { boundary: B1, wiped: false }), true);
});

test("pin history: wiped only goes from false to true, never back", () => {
  const storage = memory();
  const pins = pinned(storage, C1);
  pins.setHistory(C1, { boundary: B1, wiped: false });

  assert.equal(pins.setHistory(C1, { boundary: B1, wiped: true }), true);
  assert.deepEqual(pins.historyOf(C1), { boundary: B1, wiped: true });

  assert.equal(pins.setHistory(C1, { boundary: B1, wiped: false }), false);
  assert.deepEqual(pins.historyOf(C1), { boundary: B1, wiped: true });
  assert.deepEqual(storedHistory(storage, U1), {
    [C1]: { boundary: B1, wiped: true },
  });
  assert.equal(pins.setHistory(C1, { boundary: B1, wiped: true }), true);

  // A returned history is a copy: mutating it lowers nothing
  pins.historyOf(C1)!.wiped = false;
  pins.historyOf(C1)!.boundary = B2;
  assert.deepEqual(pins.historyOf(C1), { boundary: B1, wiped: true });
  for (const name of ["clearHistory", "removeHistory", "deleteHistory"]) {
    assert.equal(
      (pins as unknown as Record<string, unknown>)[name],
      undefined,
      `ProtectedPinSet must not expose ${name}`,
    );
  }
});

test("pin history: survives a reload and stays one-way in the fresh set", () => {
  const storage = memory();
  const first = pinned(storage, C1, C2);
  first.setHistory(C1, { boundary: B1, wiped: true });
  first.setHistory(C2, { boundary: B2, wiped: false });

  const second = new ProtectedPinSet(storage);
  second.loadFor(U1);
  assert.equal(second.loadFailed, false);
  assert.deepEqual(second.historyOf(C1), { boundary: B1, wiped: true });
  assert.deepEqual(second.historyOf(C2), { boundary: B2, wiped: false });

  assert.equal(second.setHistory(C1, { boundary: B1, wiped: false }), false);
  assert.equal(second.setHistory(C2, { boundary: B1, wiped: false }), false);
  assert.deepEqual(second.historyOf(C1), { boundary: B1, wiped: true });
  assert.deepEqual(second.historyOf(C2), { boundary: B2, wiped: false });
});

test("pin history: an old store with only the id list still parses, with no history", () => {
  const storage = memory({ [protectedPinsKey(U1)]: JSON.stringify([C1, C2]) });
  const pins = new ProtectedPinSet(storage);
  pins.loadFor(U1);

  assert.equal(pins.loadFailed, false);
  assert.deepEqual(pins.all().sort(), [C1, C2].sort());
  assert.equal(pins.historyOf(C1), undefined);
  assert.equal(storage.data.size, 1, "loading writes no history key");
});

test("pin history: a corrupt history store loads as empty and sets loadFailed, the pins still load", () => {
  for (const raw of ["{not json", "[]", `["${C1}"]`, "42", "null", '"x"']) {
    const storage = memory({
      [protectedPinsKey(U1)]: JSON.stringify([C1]),
      [protectedHistoryKey(U1)]: raw,
    });
    const pins = new ProtectedPinSet(storage);
    pins.loadFor(U1);

    assert.equal(pins.loadFailed, true, `loadFailed for ${raw}`);
    assert.equal(pins.has(C1), true);
    assert.equal(pins.historyOf(C1), undefined);
    assert.deepEqual(parseProtectedHistory(raw), {
      entries: [],
      corrupt: true,
    });

    assert.equal(pins.setHistory(C1, { boundary: B1, wiped: false }), true);
    assert.deepEqual(storedHistory(storage, U1), {
      [C1]: { boundary: B1, wiped: false },
    });
  }
});

test("pin history: a partly corrupt store keeps the readable entries and flags loadFailed", () => {
  const storage = memory({
    [protectedPinsKey(U1)]: JSON.stringify([C1, C2, C3]),
    [protectedHistoryKey(U1)]: JSON.stringify({
      [C1]: { boundary: B1, wiped: true },
      [C2]: { boundary: "not a ulid", wiped: false },
      [C3]: { boundary: B2, wiped: 1 },
    }),
  });
  const pins = new ProtectedPinSet(storage);
  pins.loadFor(U1);

  assert.equal(pins.loadFailed, true);
  assert.deepEqual(pins.historyOf(C1), { boundary: B1, wiped: true });
  assert.equal(pins.historyOf(C2), undefined);
  assert.equal(pins.historyOf(C3), undefined);
});

test("pin history: a stored entry for an id that is not pinned is not loaded", () => {
  const storage = memory({
    [protectedPinsKey(U1)]: JSON.stringify([C1]),
    [protectedHistoryKey(U1)]: JSON.stringify({
      [C2]: { boundary: B1, wiped: false },
    }),
  });
  const pins = new ProtectedPinSet(storage);
  pins.loadFor(U1);

  assert.equal(pins.historyOf(C2), undefined);
  assert.equal(pins.has(C2), false);
});

test("pin history: another user's history is neither loaded nor written", () => {
  const storage = memory();
  const pins = pinned(storage, C1);
  pins.setHistory(C1, { boundary: B1, wiped: false });

  pins.loadFor(U2);
  assert.equal(pins.historyOf(C1), undefined);
  pins.add(C1);
  assert.equal(pins.setHistory(C1, { boundary: B2, wiped: true }), true);

  assert.deepEqual(storedHistory(storage, U1), {
    [C1]: { boundary: B1, wiped: false },
  });
  assert.deepEqual(storedHistory(storage, U2), {
    [C1]: { boundary: B2, wiped: true },
  });
});

test("pin history: a boundary another tab stored first wins, and its wiped is taken", () => {
  const storage = memory();
  const pins = pinned(storage, C1, C2);

  // Another tab stores the history of C1 and wipes C2 meanwhile
  pins.setHistory(C2, { boundary: B2, wiped: false });
  storage.setItem(
    protectedHistoryKey(U1),
    JSON.stringify({
      [C1]: { boundary: B1, wiped: false },
      [C2]: { boundary: B2, wiped: true },
    }),
  );

  assert.equal(pins.setHistory(C1, { boundary: B2, wiped: false }), false);
  assert.deepEqual(pins.historyOf(C1), { boundary: B1, wiped: false });
  assert.equal(pins.setHistory(C2, { boundary: B2, wiped: false }), false);
  assert.deepEqual(pins.historyOf(C2), { boundary: B2, wiped: true });
});

test("pin history: a store that throws keeps the history in memory, still one-way", () => {
  const throwing = {
    getItem(): string | null {
      throw new Error("SecurityError");
    },
    setItem(): void {
      throw new Error("QuotaExceededError");
    },
  };
  const pins = new ProtectedPinSet(throwing);
  pins.loadFor(U1);
  pins.add(C1);

  assert.doesNotThrow(() => pins.setHistory(C1, { boundary: B1, wiped: true }));
  assert.deepEqual(pins.historyOf(C1), { boundary: B1, wiped: true });
  assert.equal(pins.setHistory(C1, { boundary: B2, wiped: true }), false);
  assert.equal(pins.setHistory(C1, { boundary: B1, wiped: false }), false);
});
