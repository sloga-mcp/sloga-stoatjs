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
   * Roles recreated. Discord's `@everyone` is NOT counted here — it is not a
   * role on Sloga, its permissions become the server's default permissions.
   *
   * Optional on the wire: a job written before slice 1 has no such field, and
   * the server defaults it to 0 rather than rewriting old rows.
   */
  roles_created?: number;
  /** Roles in the template that were not recreated (cap, or failed insert) */
  roles_skipped?: number;
  /**
   * Free-text server-generated notes ("3 threads skipped", …). English only —
   * these are NOT translated, by design (they are generated server-side and
   * carry no message ids). Render verbatim.
   */
  notes: string[];
};

/**
 * An import job as the API returns it.
 *
 * This mirrors delta's `ImportJobResponse` DTO, **not** the stored
 * `DiscordImportJob` model. The DTO renames `_id` → `job_id` and deliberately
 * omits `user_id` and `template_code`, so this type must not claim them: a
 * field named here but absent on the wire is silently `undefined`, and the
 * store compares job ids to decide whether an update belongs to the import it
 * is tracking. Getting that comparison wrong makes every fetched row look like
 * a foreign job and quietly disables the summary, the poll fallback and resume.
 */
export type DiscordImportJobData = {
  job_id: string;
  status: DiscordImportStatus;
  /**
   * Current progress stage.
   *
   * **Deliberately typed as an opaque `string`, not a union.** Slice 0 emitted
   * `Fetching | Server | Channels | Membership | Invite | Done`, slice 1 added
   * `Roles`, and later slices add more. A deployed client must render an
   * unknown stage gracefully instead of showing "undefined" from an exhaustive
   * lookup.
   */
  stage: string;
  /** Items completed within the current stage (may legitimately be 0) */
  done: number;
  /** Items in the current stage; **0 while the stage is indeterminate** */
  total: number;
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
