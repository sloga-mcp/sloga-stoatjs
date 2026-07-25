/**
 * "Import from Discord" job types (slice 0 — guild-template import).
 *
 * The routes (`/import/discord/...`) are newer than the generated
 * `stoat-api` tables, so they go through the raw-fetch helper on
 * {@link Client} rather than the typed client — same reason polls,
 * threads and the calendar routes do.
 *
 * Jobs are owner-scoped: reads 404 for anyone but the initiating user.
 */

/** Lifecycle state of an import job. `Completed`/`Failed` are terminal. */
export type DiscordImportStatus = "Queued" | "Running" | "Completed" | "Failed";

/** What the import did and did not manage to bring over. */
export type DiscordImportSummary = {
  channels_created: number;
  categories_created: number;
  channels_skipped: number;
  /**
   * Free-text server-generated notes ("3 threads skipped", …). English only —
   * these are NOT translated, by design (they are generated server-side and
   * carry no message ids). Render verbatim.
   */
  notes: string[];
};

/** An import job row (wire shape, owner-private) */
export type DiscordImportJobData = {
  _id: string;
  /** Id of the user who started the import (and who will own the server) */
  user_id: string;
  /** The Discord guild-template code the job is importing */
  template_code: string;
  status: DiscordImportStatus;
  /**
   * Current progress stage.
   *
   * **Deliberately typed as an opaque `string`, not a union.** Slice 0 emits
   * `Fetching | Server | Channels | Membership | Invite | Done`, and later
   * slices add more (`Roles`, …). A deployed client must render an unknown
   * stage gracefully instead of showing "undefined" from an exhaustive lookup.
   */
  stage: string;
  /** Items completed within the current stage (may legitimately be 0) */
  done: number;
  /** Items in the current stage; **0 while the stage is indeterminate** */
  total: number;
  /** Worker heartbeat — the sweeper reaps jobs that stop bumping this */
  updated_at: string;
  /** Set once the Sloga server exists */
  server_id?: string;
  /** Set once the invite has been created */
  invite_code?: string;
  /** User-safe failure message (already sanitized server-side) */
  error?: string;
  summary?: DiscordImportSummary;
};

/**
 * Whether a job will never change again.
 * @param job Job row
 */
export function discordImportIsTerminal(job: DiscordImportJobData): boolean {
  return job.status === "Completed" || job.status === "Failed";
}
