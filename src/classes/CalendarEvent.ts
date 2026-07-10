import type { EventCollection } from "../collections/EventCollection.js";

import type { Channel } from "./Channel.js";
import type { Server } from "./Server.js";

// ----- Wire types -------------------------------------------------------------
// stoat-api (upstream-generated) has no calendar types, so we declare the wire
// shapes here to match the Rust `v0` models exactly (serde: `_id`, snake_case).

export type RsvpStatus = "Pending" | "Going" | "NotGoing";

export type Frequency = "Daily" | "Weekly" | "Monthly";

export type Weekday =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export type RecurrenceEnd =
  | { type: "Count"; count: number }
  | { type: "Until"; timestamp: number };

export interface RecurrenceRuleData {
  freq: Frequency;
  interval: number;
  /** Weekly only; empty ⇒ the same weekday as `start`. */
  by_weekday: Weekday[];
  end: RecurrenceEnd;
  /** Occurrence-start instants (ms epoch) that are skipped. */
  exceptions: number[];
}

/** Serialized `v0::Event`. */
export interface EventData {
  _id: string;
  server: string;
  channel?: string;
  creator: string;
  title: string;
  description?: string;
  location?: string;
  start: number;
  end?: number;
  all_day: boolean;
  timezone: string;
  recurrence?: RecurrenceRuleData;
  color?: string;
  cancelled: boolean;
  created_at: number;
  edited_at?: number;
}

/** Serialized `v0::EventRsvp` (note: no `created_at` on the wire). */
export interface EventRsvpData {
  user: string;
  event: string;
  status: RsvpStatus;
  invited_by: string;
  had_accepted: boolean;
  responded_at?: number;
}

export interface AttendeeCounts {
  going: number;
  pending: number;
  not_going: number;
}

/** `GET /events/event/<id>` — event + caller RSVP + tallies. */
export interface EventWithContext {
  event: EventData;
  my_rsvp?: EventRsvpData;
  counts: AttendeeCounts;
}

/** `GET /events/event/<id>/attendees` — the array is wrapped. */
export interface AttendeesResponse {
  attendees: EventRsvpData[];
}

/** `GET /events/server/<id>` — a series plus its in-window occurrence starts. */
export interface EventWithOccurrences {
  event: EventData;
  occurrences: number[];
}

export type FieldsEvent =
  | "Channel"
  | "Description"
  | "Location"
  | "End"
  | "Recurrence"
  | "Color";

/** `POST /events/server/<id>` body. */
export interface DataCreateEvent {
  title: string;
  description?: string;
  location?: string;
  start: number;
  end?: number;
  all_day?: boolean;
  timezone: string;
  recurrence?: RecurrenceRuleData;
  color?: string;
  channel?: string;
}

/** `PATCH /events/event/<id>` body. */
export interface DataEditEvent {
  title?: string;
  description?: string;
  location?: string;
  start?: number;
  end?: number;
  all_day?: boolean;
  timezone?: string;
  recurrence?: RecurrenceRuleData;
  color?: string;
  remove?: FieldsEvent[];
}

/** `POST /events/event/<id>/invites` result (slice F: counts, was 204). */
export interface InviteResultData {
  /** Genuinely-new invitees (RSVP rows created). */
  invited: number;
  /** Skipped: non-members, non-viewers, or users who already had a row. */
  skipped: number;
}

/** `POST /events/server/<id>/import` result (legacy tag import, design §11). */
export interface ImportResultData {
  imported: number;
  skipped_duplicates: number;
  skipped_invalid: number;
  scanned: number;
  /** True when the scan stopped at the message cap before exhausting history. */
  truncated: boolean;
}

// ----- Class ------------------------------------------------------------------

/**
 * Calendar Event.
 *
 * Named `CalendarEvent` (not `Event`) to avoid shadowing the DOM `Event` global
 * in the JSX-heavy client. Reachable as `client.calendarEvents`.
 */
export class CalendarEvent {
  readonly #collection: EventCollection;
  readonly id: string;

  constructor(collection: EventCollection, id: string) {
    this.#collection = collection;
    this.id = id;
  }

  /**
   * Whether this object exists
   */
  get $exists(): boolean {
    return !!this.#collection.getUnderlyingObject(this.id).id;
  }

  get serverId(): string {
    return this.#collection.getUnderlyingObject(this.id).serverId;
  }

  get server(): Server | undefined {
    return this.#collection.client.servers.get(this.serverId);
  }

  get channelId(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).channelId;
  }

  get channel(): Channel | undefined {
    const id = this.channelId;
    return id ? this.#collection.client.channels.get(id) : undefined;
  }

  get creatorId(): string {
    return this.#collection.getUnderlyingObject(this.id).creatorId;
  }

  get title(): string {
    return this.#collection.getUnderlyingObject(this.id).title;
  }

  get description(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).description;
  }

  get location(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).location;
  }

  /** First/only occurrence start, as a Date. */
  get start(): Date {
    return new Date(this.#collection.getUnderlyingObject(this.id).start);
  }

  /** Raw start (ms epoch, UTC) — use for occurrence bucketing. */
  get startAt(): number {
    return this.#collection.getUnderlyingObject(this.id).start;
  }

  get end(): Date | undefined {
    const end = this.#collection.getUnderlyingObject(this.id).end;
    return end !== undefined ? new Date(end) : undefined;
  }

  get endAt(): number | undefined {
    return this.#collection.getUnderlyingObject(this.id).end;
  }

  get allDay(): boolean {
    return this.#collection.getUnderlyingObject(this.id).allDay;
  }

  get timezone(): string {
    return this.#collection.getUnderlyingObject(this.id).timezone;
  }

  get recurrence(): RecurrenceRuleData | undefined {
    return this.#collection.getUnderlyingObject(this.id).recurrence;
  }

  get color(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).color;
  }

  get cancelled(): boolean {
    return this.#collection.getUnderlyingObject(this.id).cancelled;
  }

  get createdAt(): Date {
    return new Date(this.#collection.getUnderlyingObject(this.id).createdAt);
  }

  get editedAt(): Date | undefined {
    const at = this.#collection.getUnderlyingObject(this.id).editedAt;
    return at !== undefined ? new Date(at) : undefined;
  }

  /** The caller's own RSVP status, if they were invited. */
  get myRsvp(): RsvpStatus | undefined {
    return this.#collection.getUnderlyingObject(this.id).myRsvp;
  }

  /** Server-authoritative attendee tallies (from `fetchContext`). */
  get counts(): AttendeeCounts | undefined {
    return this.#collection.getUnderlyingObject(this.id).counts;
  }

  /**
   * Re-fetch the event with the caller's RSVP + authoritative counts.
   */
  fetchContext(): Promise<CalendarEvent> {
    return this.#collection.fetchWithContext(this.id);
  }

  /**
   * Edit this event. Time/recurrence changes recompute derived fields
   * server-side; the returned event replaces the cached one.
   */
  async edit(data: DataEditEvent): Promise<void> {
    const event = (await this.#collection.apiReq(
      "PATCH",
      `/events/event/${this.id}`,
      { body: data },
    )) as EventData;
    this.#collection.upsert(event);
  }

  /**
   * Soft-cancel this event (terminal). Optimistic with revert-on-failure; the
   * authoritative confirmation is the `CalendarEventUpdate{cancelled:true}` WS
   * event.
   */
  async cancel(): Promise<void> {
    const previous = this.cancelled;
    this.#collection.updateUnderlyingObject(this.id, {
      cancelled: true,
    } as never);
    try {
      await this.#collection.apiReq("DELETE", `/events/event/${this.id}`);
    } catch (error) {
      this.#collection.updateUnderlyingObject(this.id, {
        cancelled: previous,
      } as never);
      throw error;
    }
  }

  /**
   * Invite server members by user id and/or by role — each role's CURRENT
   * holders are expanded server-side (slice F, 0.1-A). Insert-if-absent:
   * already-answered or non-viewing members are skipped and counted.
   */
  async invite(users: string[], roles?: string[]): Promise<InviteResultData> {
    const body: { users?: string[]; roles?: string[] } = {};
    if (users.length) body.users = users;
    if (roles?.length) body.roles = roles;
    return (await this.#collection.apiReq(
      "POST",
      `/events/event/${this.id}/invites`,
      { body },
    )) as InviteResultData;
  }

  /**
   * Remove a user's invite/RSVP row.
   */
  async uninvite(userId: string): Promise<void> {
    await this.#collection.apiReq(
      "DELETE",
      `/events/event/${this.id}/invites/${userId}`,
    );
  }

  /**
   * Set the caller's RSVP (`Going` or `NotGoing`). Optimistically moves the
   * caller's status and the two affected count buckets, reconciles against the
   * authoritative response, and reverts both on failure.
   */
  async rsvp(status: RsvpStatus): Promise<EventRsvpData> {
    const previousStatus = this.myRsvp;
    const previousCounts = this.counts ? { ...this.counts } : undefined;

    this.#applyOptimisticRsvp(previousStatus, status);

    try {
      const rsvp = (await this.#collection.apiReq(
        "PUT",
        `/events/event/${this.id}/rsvp`,
        { body: { status } },
      )) as EventRsvpData;

      // Reconcile the caller's authoritative row (idempotent with the WS echo).
      this.#collection.updateUnderlyingObject(this.id, {
        myRsvp: rsvp.status,
      } as never);
      return rsvp;
    } catch (error) {
      this.#collection.updateUnderlyingObject(this.id, {
        myRsvp: previousStatus,
        counts: previousCounts,
      } as never);
      throw error;
    }
  }

  /**
   * Optimistic two-bucket count move + status set. `counts` may be undefined
   * (context not yet fetched); the status still updates.
   */
  #applyOptimisticRsvp(from: RsvpStatus | undefined, to: RsvpStatus): void {
    const bucket = (s: RsvpStatus): keyof AttendeeCounts =>
      s === "Going" ? "going" : s === "Pending" ? "pending" : "not_going";

    const counts = this.counts;
    let next: AttendeeCounts | undefined;
    if (counts) {
      next = { ...counts };
      if (from) next[bucket(from)] = Math.max(0, next[bucket(from)] - 1);
      next[bucket(to)] = next[bucket(to)] + 1;
    }

    this.#collection.updateUnderlyingObject(this.id, {
      myRsvp: to,
      counts: next,
    } as never);
  }

  /**
   * Fetch a page of RSVP rows. `before` is a FORWARD cursor: pass the LAST
   * returned row's `user` id to get the next page (rows come ascending by user
   * id; the server returns those strictly greater than the cursor).
   */
  async fetchAttendees(params?: {
    limit?: number;
    before?: string;
  }): Promise<EventRsvpData[]> {
    const response = (await this.#collection.apiReq(
      "GET",
      `/events/event/${this.id}/attendees`,
      { query: params },
    )) as AttendeesResponse;
    return response.attendees;
  }
}
