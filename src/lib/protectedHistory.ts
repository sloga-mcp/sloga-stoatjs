/**
 * Protected channels (S4): the verified reveal of pre-protect rows.
 *
 * A message without `encrypted` in a protected or pinned channel is stored
 * without its server text (plan D25). S4 lets the rows written BEFORE the
 * channel was protected render as ordinary messages (design 9.5 arm 3), so
 * the strip gains one exception: a reveal, set only by the embedding app's
 * E2EE bridge from native verified state through
 * `Client.revealPreProtectRows`. Nothing a server sends sets, widens or
 * restores one, and it is not persisted: after a reload every plaintext row
 * is stripped again until the bridge reveals it again.
 *
 * No Client, solid-js or storage import, so specs load it directly. The
 * reactive collections only make the reads track in a Solid scope.
 */
import { ReactiveMap } from "@solid-primitives/map";
import { ReactiveSet } from "@solid-primitives/set";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_LENGTH = 26;
const ULID_TIME_LENGTH = 10;

/**
 * Millisecond timestamp of a ULID: 26 upper-case Crockford characters, the
 * first ten being the time. Anything else (another length, a lower-case or
 * excluded letter, a time above 48 bits, a non-string) is `null`.
 * @param id ULID
 */
export function ulidTimeMs(id: string): number | null {
  if (typeof id !== "string" || id.length !== ULID_LENGTH) return null;

  let time = 0;
  for (let i = 0; i < ULID_LENGTH; i++) {
    const digit = CROCKFORD.indexOf(id[i]);
    if (digit === -1) return null;
    if (i < ULID_TIME_LENGTH) time = time * 32 + digit;
  }

  // Ten characters hold 50 bits; a ULID time is 48
  if (id[0] > "7") return null;
  return time;
}

/**
 * What the bridge verified natively about a channel's pre-protect history:
 * the id of the last message written before it was protected and the
 * latest time such a message can carry.
 */
export type PreProtectReveal = { boundary: string; timeLimit: number };

/**
 * Whether a reveal is usable at all: a ULID boundary and a time limit that
 * is a safe non-negative integer.
 * @param reveal Reveal
 */
function validReveal(reveal: PreProtectReveal | undefined): boolean {
  return (
    typeof reveal === "object" &&
    reveal !== null &&
    ulidTimeMs(reveal.boundary) !== null &&
    Number.isSafeInteger(reveal.timeLimit) &&
    reveal.timeLimit >= 0
  );
}

/**
 * Whether a row of a protected or pinned channel may keep its server
 * fields. True only when the row carries no `encrypted`, a valid reveal
 * exists, the channel was not wiped, the row id is a ULID at or below the
 * boundary (byte order of the 26 characters) and its ULID time is at or
 * before the time limit. Every other input is false: the row stays
 * stripped.
 * @param row Row id and whether it carries `encrypted`
 * @param reveal The channel's reveal, if any
 * @param wiped Whether the channel's pre-protect history was wiped
 */
export function preProtectRevealed(
  row: { id: string; encrypted: boolean },
  reveal: PreProtectReveal | undefined,
  wiped: boolean,
): boolean {
  if (row.encrypted !== false) return false;
  if (wiped !== false) return false;
  if (!validReveal(reveal)) return false;

  const time = ulidTimeMs(row.id);
  if (time === null) return false;
  if (!(row.id <= reveal!.boundary)) return false;
  if (!(time <= reveal!.timeLimit)) return false;
  return true;
}

/**
 * Most rows whose stripped fields are kept for a later reveal.
 */
export const PRE_PROTECT_STASH_LIMIT = 2000;

/**
 * The stripped fields of one stored row, by hydrated key.
 */
export type PreProtectStashEntry = {
  channelId: string;
  fields: Record<string, unknown>;
};

/**
 * Per-client, in-memory state of the verified reveal (see module comment):
 * the reveal of each channel, the channels that can take none any more
 * (a conflict or a wipe, both one-way for the session) and the stash of
 * fields stripped from rows a later reveal may cover.
 *
 * The stash holds server text of rows that must not render. Its methods
 * are for the SDK's hydration and `Client` only: an app never reads it,
 * and sets a reveal through `Client.revealPreProtectRows`, never here.
 */
export class ProtectedHistoryState {
  readonly #reveals = new ReactiveMap<string, PreProtectReveal>();
  readonly #conflicted = new ReactiveSet<string>();
  readonly #wiped = new ReactiveSet<string>();
  readonly #stash = new Map<string, PreProtectStashEntry>();

  /**
   * The channel's reveal, if one is set (reactive).
   * @param channelId Channel id
   */
  revealOf(channelId: string): PreProtectReveal | undefined {
    const reveal = this.#reveals.get(channelId);
    return reveal ? { ...reveal } : undefined;
  }

  /**
   * Set a channel's reveal. `same` when it equals the one held; `set` when
   * it is the first, or keeps the boundary and moves the time limit;
   * `conflict` when its boundary differs from the one held, when it is not
   * a valid reveal, or when the channel conflicted before: the reveal is
   * removed and the channel takes no reveal for the rest of the session.
   * @param channelId Channel id
   * @param reveal Reveal from native verified state
   */
  setReveal(
    channelId: string,
    reveal: PreProtectReveal,
  ): "set" | "same" | "conflict" {
    if (this.#conflicted.has(channelId)) return "conflict";

    const held = this.#reveals.get(channelId);
    if (!validReveal(reveal) || (held && held.boundary !== reveal.boundary)) {
      this.#reveals.delete(channelId);
      this.#conflicted.add(channelId);
      this.dropChannelStash(channelId);
      return "conflict";
    }

    if (held && held.timeLimit === reveal.timeLimit) return "same";

    this.#reveals.set(channelId, {
      boundary: reveal.boundary,
      timeLimit: reveal.timeLimit,
    });
    return "set";
  }

  /**
   * Whether a reveal conflict latched this channel (reactive).
   * @param channelId Channel id
   */
  isConflicted(channelId: string): boolean {
    return this.#conflicted.has(channelId);
  }

  /**
   * Record that the channel's pre-protect history was wiped. One-way: no
   * row of it is revealed again this session, and its stash is dropped.
   * @param channelId Channel id
   */
  markWiped(channelId: string): void {
    this.#wiped.add(channelId);
    this.dropChannelStash(channelId);
  }

  /**
   * Whether the channel's pre-protect history was wiped (reactive).
   * @param channelId Channel id
   */
  isWiped(channelId: string): boolean {
    return this.#wiped.has(channelId);
  }

  /**
   * Whether the channel can still take a reveal this session: neither
   * wiped nor conflicted. Stripped fields are stashed only while it can.
   * @param channelId Channel id
   */
  canReveal(channelId: string): boolean {
    return !this.#wiped.has(channelId) && !this.#conflicted.has(channelId);
  }

  /**
   * Whether the channel's reveal covers a row (reactive); see
   * {@link preProtectRevealed}.
   * @param channelId Channel id
   * @param row Row id and whether it carries `encrypted`
   */
  covers(channelId: string, row: { id: string; encrypted: boolean }): boolean {
    return preProtectRevealed(
      row,
      this.#reveals.get(channelId),
      this.#wiped.has(channelId) || this.#conflicted.has(channelId),
    );
  }

  /**
   * Number of rows in the stash.
   */
  get stashSize(): number {
    return this.#stash.size;
  }

  /**
   * Keep one stripped field of a row for a later reveal. Ignored for a
   * channel that can take no reveal. Past {@link PRE_PROTECT_STASH_LIMIT}
   * rows the oldest row is dropped.
   * @param channelId Channel id
   * @param id Message id
   * @param key Hydrated key
   * @param value Hydrated value
   */
  stashField(channelId: string, id: string, key: string, value: unknown): void {
    if (!this.canReveal(channelId)) return;

    let entry = this.#stash.get(id);
    if (!entry || entry.channelId !== channelId) {
      this.#stash.delete(id);
      entry = { channelId, fields: {} };
      this.#stash.set(id, entry);

      while (this.#stash.size > PRE_PROTECT_STASH_LIMIT) {
        const oldest = this.#stash.keys().next().value;
        if (oldest === undefined) break;
        this.#stash.delete(oldest);
      }
    }

    entry.fields[key] = value;
  }

  /**
   * Whether a row has stashed fields.
   * @param id Message id
   */
  hasStash(id: string): boolean {
    return this.#stash.has(id);
  }

  /**
   * Remove and return a row's stashed fields.
   * @param id Message id
   */
  takeStash(id: string): PreProtectStashEntry | undefined {
    const entry = this.#stash.get(id);
    this.#stash.delete(id);
    return entry;
  }

  /**
   * Drop a row's stashed fields.
   * @param id Message id
   */
  dropStash(id: string): void {
    this.#stash.delete(id);
  }

  /**
   * Ids of the rows of a channel that have stashed fields.
   * @param channelId Channel id
   */
  stashedIds(channelId: string): string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.#stash) {
      if (entry.channelId === channelId) ids.push(id);
    }
    return ids;
  }

  /**
   * Drop every stashed row of a channel.
   * @param channelId Channel id
   */
  dropChannelStash(channelId: string): void {
    for (const id of this.stashedIds(channelId)) this.#stash.delete(id);
  }
}
