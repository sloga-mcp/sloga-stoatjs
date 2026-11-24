/**
 * Encrypted-only chats: the plain-write kinds and the error an installed
 * guard throws to refuse one.
 *
 * Pure: no Client, Solid or storage imports, so specs load it directly.
 */

/**
 * What a plain (not end-to-end encrypted) write into a channel is about to
 * do. Passed to `Client.plainWriteGuard`.
 */
export type PlainWriteKind =
  | "send"
  | "edit"
  | "forward"
  | "schedule"
  | "poll"
  | "softres"
  | "interaction"
  | "roll"
  | "upload"
  | "captions"
  | "watch";

/**
 * Thrown by an installed `Client.plainWriteGuard` to refuse a plain write.
 * The SDK makes no request once it is thrown.
 */
export class EncryptedOnlyBlockedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "EncryptedOnlyBlockedError";
    this.reason = reason;
  }
}
