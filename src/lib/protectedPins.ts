/**
 * Client-wide, one-way set of channel ids this device has seen protected
 * (plan D9a). A pin keeps a channel protected client-side even when the
 * server later omits or lowers the flag, so the send arm, the D25 strip and
 * the shield keep working. There is deliberately no `remove`.
 *
 * Persisted per user in `localStorage` under
 * `protected-channel-pins:<userId>`. Every storage access is guarded: an
 * unreadable or corrupt store leaves an in-memory set and `loadFailed`.
 *
 * S4 (design 9.4 "S4"): a pin also holds the channel's pre-protect history
 * `{ boundary, wiped }`, written by the E2EE bridge from native verified
 * state only. It lives under a SECOND key,
 * `protected-channel-history:<userId>`, as a JSON object keyed by channel
 * id; the id list and its format are untouched, so an older build still
 * reads its pins. The boundary is set once and `wiped` only goes to true.
 */
import { ReactiveMap } from "@solid-primitives/map";
import { ReactiveSet } from "@solid-primitives/set";

import { ulidTimeMs } from "./protectedHistory.js";

/**
 * The slice of the Web Storage API the pin set uses.
 */
export type ProtectedPinStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * Storage key for a user's pins.
 * @param userId User id
 */
export function protectedPinsKey(userId: string): string {
  return `protected-channel-pins:${userId}`;
}

/**
 * Parse a stored pin list. Returns the valid ids and whether anything was
 * unreadable (not JSON, not an array, or a non-string entry).
 * @param raw Stored value
 */
export function parseProtectedPins(raw: string | null): {
  ids: string[];
  corrupt: boolean;
} {
  if (raw === null) return { ids: [], corrupt: false };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ids: [], corrupt: true };
  }

  if (!Array.isArray(value)) return { ids: [], corrupt: true };

  const ids = value.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  return { ids, corrupt: ids.length !== value.length };
}

/**
 * A pinned channel's pre-protect history: the id of the last message
 * written before it was protected, and whether those messages were wiped.
 */
export type ProtectedPinHistory = { boundary: string; wiped: boolean };

/**
 * Storage key for the pre-protect history of a user's pins.
 * @param userId User id
 */
export function protectedHistoryKey(userId: string): string {
  return `protected-channel-history:${userId}`;
}

function validPinHistory(value: unknown): value is ProtectedPinHistory {
  if (typeof value !== "object" || value === null) return false;
  const { boundary, wiped } = value as Record<string, unknown>;
  return (
    typeof boundary === "string" &&
    ulidTimeMs(boundary) !== null &&
    typeof wiped === "boolean"
  );
}

/**
 * Parse a stored history map. Returns the valid entries and whether
 * anything was unreadable (not JSON, not a plain object, or an entry that
 * is not `{ boundary: ULID, wiped: boolean }`).
 * @param raw Stored value
 */
export function parseProtectedHistory(raw: string | null): {
  entries: [string, ProtectedPinHistory][];
  corrupt: boolean;
} {
  if (raw === null) return { entries: [], corrupt: false };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { entries: [], corrupt: true };
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { entries: [], corrupt: true };
  }

  const all = Object.entries(value as Record<string, unknown>);
  const entries: [string, ProtectedPinHistory][] = [];
  for (const [id, history] of all) {
    if (id.length && validPinHistory(history)) {
      entries.push([id, { boundary: history.boundary, wiped: history.wiped }]);
    }
  }
  return { entries, corrupt: entries.length !== all.length };
}

function defaultStorage(): ProtectedPinStorage | undefined {
  try {
    const storage = (globalThis as { localStorage?: ProtectedPinStorage })
      .localStorage;
    return storage ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * One-way pin set (see module comment).
 */
export class ProtectedPinSet {
  readonly #ids = new ReactiveSet<string>();
  readonly #history = new ReactiveMap<string, ProtectedPinHistory>();
  readonly #storage: () => ProtectedPinStorage | undefined;
  #userId: string | undefined;
  #loadFailed = false;

  /**
   * @param storage Storage to persist into; defaults to `localStorage`,
   *   resolved lazily on each use
   */
  constructor(storage?: ProtectedPinStorage) {
    this.#storage = storage ? () => storage : defaultStorage;
  }

  /**
   * Whether the last `loadFor` could not read the store (unavailable,
   * corrupt, or partly unreadable). The set then holds what was readable
   * plus what was added in memory.
   */
  get loadFailed(): boolean {
    return this.#loadFailed;
  }

  /**
   * Whether a channel is pinned protected (reactive).
   * @param id Channel id
   */
  has(id: string): boolean {
    return this.#ids.has(id);
  }

  /**
   * Every pinned channel id.
   */
  all(): string[] {
    return [...this.#ids];
  }

  /**
   * Pin a channel (one-way) and persist the set for the loaded user.
   * @param id Channel id
   */
  add(id: string): void {
    if (typeof id !== "string" || !id.length) return;
    if (this.#ids.has(id)) return;
    this.#ids.add(id);
    this.#persist();
  }

  /**
   * The pre-protect history stored with a pin, if any (reactive).
   * @param id Channel id
   */
  historyOf(id: string): ProtectedPinHistory | undefined {
    const history = this.#history.get(id);
    return history ? { ...history } : undefined;
  }

  /**
   * Store a pinned channel's pre-protect history and persist it. Only the
   * E2EE bridge calls this, from native verified state. One-way: the
   * boundary is set once and `wiped` only goes from false to true.
   *
   * Returns false, changing nothing, when the id is not pinned, the value
   * is not `{ boundary: ULID, wiped: boolean }`, the boundary differs from
   * the stored one, or it would lower a stored `wiped`. The caller treats
   * false as a mismatch with what this device saw before.
   * @param id Channel id
   * @param history Boundary and wipe state
   */
  setHistory(id: string, history: ProtectedPinHistory): boolean {
    if (!this.#ids.has(id) || !validPinHistory(history)) return false;

    // Another tab may have stored this channel's history first
    this.#mergeStoredHistory();

    const held = this.#history.get(id);
    if (held) {
      if (held.boundary !== history.boundary) return false;
      if (held.wiped && !history.wiped) return false;
      if (held.wiped === history.wiped) return true;
    }

    this.#history.set(id, {
      boundary: history.boundary,
      wiped: history.wiped,
    });
    this.#persistHistory();
    return true;
  }

  /**
   * Load the pins for a user, merging them into the set. Call at the top of
   * Ready, before the channel loop. Pins added before the first load are
   * kept and written to this user's store; switching to a different user
   * starts from that user's store alone.
   * @param userId User id
   */
  loadFor(userId: string): void {
    if (this.#userId !== undefined && this.#userId !== userId) {
      this.#ids.clear();
      this.#history.clear();
    }
    this.#userId = userId;
    this.#loadFailed = false;

    const storage = this.#storage();
    if (!storage) {
      this.#loadFailed = true;
      return;
    }

    let raw: string | null;
    try {
      raw = storage.getItem(protectedPinsKey(userId));
    } catch {
      this.#loadFailed = true;
      return;
    }

    const { ids, corrupt } = parseProtectedPins(raw);
    if (corrupt) this.#loadFailed = true;

    for (const id of ids) this.#ids.add(id);

    // Write back pins added before this load, or rewrite a corrupt store
    if (corrupt || this.#ids.size !== new Set(ids).size) {
      this.#persist();
    }

    // The history of the pins; a corrupt store loads as empty
    let rawHistory: string | null;
    try {
      rawHistory = storage.getItem(protectedHistoryKey(userId));
    } catch {
      this.#loadFailed = true;
      return;
    }

    const stored = parseProtectedHistory(rawHistory);
    if (stored.corrupt) this.#loadFailed = true;
    const before = this.#history.size;
    this.#adoptHistory(stored.entries);

    // Write back history set before this load
    if (before > 0) this.#persistHistory();
  }

  /**
   * Take stored history entries this set does not hold yet, for pinned ids
   * only; for an id it holds with the same boundary, a stored `wiped`
   * raises it. A held boundary is never replaced.
   */
  #adoptHistory(entries: [string, ProtectedPinHistory][]): void {
    for (const [id, history] of entries) {
      if (!this.#ids.has(id)) continue;
      const held = this.#history.get(id);
      if (!held) {
        this.#history.set(id, history);
      } else if (
        held.boundary === history.boundary &&
        history.wiped &&
        !held.wiped
      ) {
        this.#history.set(id, { boundary: held.boundary, wiped: true });
      }
    }
  }

  /**
   * Merge what the store holds now into the history map (another tab may
   * have written it).
   */
  #mergeStoredHistory(): void {
    if (this.#userId === undefined) return;
    const storage = this.#storage();
    if (!storage) return;

    try {
      this.#adoptHistory(
        parseProtectedHistory(
          storage.getItem(protectedHistoryKey(this.#userId)),
        ).entries,
      );
    } catch {
      // Unreadable store: the in-memory map decides
    }
  }

  /**
   * Write the history map, over the readable entries the store holds for
   * other ids, under the loaded user's second key. The id list key is not
   * touched.
   */
  #persistHistory(): void {
    if (this.#userId === undefined) return;
    const storage = this.#storage();
    if (!storage) return;

    const key = protectedHistoryKey(this.#userId);
    try {
      const stored = parseProtectedHistory(storage.getItem(key)).entries;
      storage.setItem(
        key,
        JSON.stringify(Object.fromEntries([...stored, ...this.#history])),
      );
    } catch {
      // Quota or access failure: the in-memory map still holds it
    }
  }

  /**
   * Write the set, unioned with whatever the store holds now (another tab
   * may have added pins), under the loaded user's key.
   */
  #persist(): void {
    if (this.#userId === undefined) return;
    const storage = this.#storage();
    if (!storage) return;

    const key = protectedPinsKey(this.#userId);
    try {
      const stored = parseProtectedPins(storage.getItem(key)).ids;
      for (const id of stored) this.#ids.add(id);
      storage.setItem(key, JSON.stringify([...this.#ids]));
    } catch {
      // Quota or access failure: the in-memory set still holds the pin
    }
  }
}
