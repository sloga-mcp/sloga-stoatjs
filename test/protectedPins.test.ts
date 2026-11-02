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

const { ProtectedPinSet, protectedPinsKey, parseProtectedPins } =
  await loadSrc<PinsModule>("lib/protectedPins.ts");

const U1 = "01K6P000000000000000000001";
const U2 = "01K6P000000000000000000002";
const C1 = "01K6P000000000000000000003";
const C2 = "01K6P000000000000000000004";
const C3 = "01K6P000000000000000000005";

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
