/**
 * Client-wide, one-way set of channel ids this device has seen protected
 * (plan D9a). A pin keeps a channel protected client-side even when the
 * server later omits or lowers the flag, so the send arm, the D25 strip and
 * the shield keep working. There is deliberately no `remove`.
 *
 * Persisted per user in `localStorage` under
 * `protected-channel-pins:<userId>`. Every storage access is guarded: an
 * unreadable or corrupt store leaves an in-memory set and `loadFailed`.
 */
import { ReactiveSet } from "@solid-primitives/set";

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
   * Load the pins for a user, merging them into the set. Call at the top of
   * Ready, before the channel loop. Pins added before the first load are
   * kept and written to this user's store; switching to a different user
   * starts from that user's store alone.
   * @param userId User id
   */
  loadFor(userId: string): void {
    if (this.#userId !== undefined && this.#userId !== userId) {
      this.#ids.clear();
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
