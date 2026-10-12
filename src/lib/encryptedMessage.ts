/**
 * Helpers for end-to-end encrypted message ids. The native layer decrypts
 * these rows and injects them locally; their ids are envelope ids chosen by
 * the server, so nothing here may assume they are well formed.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * 26 uppercase Crockford base32 characters. A first character above `7`
 * would overflow the 48-bit timestamp.
 */
const RE_ULID = /^[0-7][0-9ABCDEFGHJKMNPQRSTVWXYZ]{25}$/;

/** How far past the local clock an id's timestamp may sit (10 minutes) */
const FUTURE_WINDOW_MS = 600_000;

/**
 * Whether an encrypted message id is a ULID that is safe to order by.
 *
 * A malformed envelope id would throw from `decodeTime` in the conversation
 * sort, and one stamped far in the future would pin its conversation to the
 * top of the list. Accepts only a well-formed ULID whose millisecond
 * timestamp (the first 10 characters) is no later than `now` plus ten
 * minutes.
 * @param id Candidate message id
 * @param now Current time in milliseconds, defaults to `Date.now()`
 */
export function isPlausibleMessageUlid(id: string, now?: number): boolean {
  if (typeof id !== "string" || !RE_ULID.test(id)) return false;

  let time = 0;
  for (let i = 0; i < 10; i++) {
    time = time * 32 + CROCKFORD.indexOf(id[i]);
  }

  return time <= (now ?? Date.now()) + FUTURE_WINDOW_MS;
}

/**
 * Read pointer to store and send when acking an encrypted message.
 *
 * Each device gets its own envelope, with its own id, for one send. The
 * server mints all of them from one instant, so they share their first 10
 * characters (the timestamp), and padding the rest with `Z` gives the highest
 * id in that millisecond: an ack from one device sorts at or after every
 * device's copy of the message.
 * @param id Encrypted message id
 */
export function encryptedAckId(id: string): string {
  return id.slice(0, 10) + "Z".repeat(16);
}
