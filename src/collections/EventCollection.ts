import {
  CalendarEvent,
  type DataCreateEvent,
  type EventData,
  type EventWithContext,
  type EventWithOccurrences,
  type ImportResultData,
} from "../classes/CalendarEvent.js";
import type { HydratedEvent } from "../hydration/event.js";
import { hydrate } from "../hydration/index.js";

import { ClassCollection } from "./Collection.js";

/**
 * An event series projected onto a query window: the reactive `CalendarEvent`
 * plus its occurrence-start instants (ms epoch, UTC) inside that window. The
 * occurrences are window-scoped and therefore NOT stored on the event.
 */
export type EventOccurrences = {
  event: CalendarEvent;
  occurrences: number[];
};

/**
 * Optional wire fields that must be present (as `undefined`) on a store write so
 * a merge clears a field the server has removed (the wire omits `None`s).
 */
const OPTIONAL_KEYS = [
  "channelId",
  "description",
  "location",
  "end",
  "recurrence",
  "color",
  "attachments",
  "editedAt",
] as const;

/**
 * Collection of calendar events.
 */
export class EventCollection extends ClassCollection<
  CalendarEvent,
  HydratedEvent
> {
  /**
   * Get or create — create-if-absent only (does not refresh an existing event).
   * Use {@link upsert} to also refresh cached field values.
   */
  getOrCreate(id: string, data: EventData): CalendarEvent {
    if (this.has(id)) {
      return this.get(id)!;
    } else {
      const instance = new CalendarEvent(this, id);
      this.create(id, "event", instance, this.client, data);
      return instance;
    }
  }

  /**
   * Create-or-refresh an event from wire data. Writes a COMPLETE hydrated object
   * (optional fields normalized to `undefined`) so a store merge clears any
   * field the server removed, while preserving the non-wire `myRsvp`/`counts`.
   */
  upsert(data: EventData): CalendarEvent {
    const instance = this.getOrCreate(data._id, data);

    const hydrated = hydrate("event", data, this.client, false);
    const complete = { ...hydrated } as Record<string, unknown>;
    for (const key of OPTIONAL_KEYS) {
      if (!(key in complete)) complete[key] = undefined;
    }
    this.updateUnderlyingObject(data._id, complete as never);

    return instance;
  }

  /**
   * Fetch a single event with the caller's RSVP + authoritative attendee counts.
   */
  async fetchWithContext(id: string): Promise<CalendarEvent> {
    const data = (await this.apiReq(
      "GET",
      `/events/event/${id}`,
    )) as EventWithContext;

    const event = this.upsert(data.event);
    this.updateUnderlyingObject(data.event._id, {
      myRsvp: data.my_rsvp?.status,
      counts: data.counts,
    } as never);
    return event;
  }

  /**
   * Create an event in a server.
   */
  async createForServer(
    serverId: string,
    data: DataCreateEvent,
  ): Promise<CalendarEvent> {
    const event = (await this.apiReq("POST", `/events/server/${serverId}`, {
      body: data,
    })) as EventData;
    return this.upsert(event);
  }

  /**
   * List a server's events overlapping `[from, to]` (ms epoch). Upserts every
   * event (fresh field values) and returns each with its in-window occurrence
   * starts (server-expanded — no client-side recurrence math).
   */
  async listForServer(
    serverId: string,
    from: number,
    to: number,
  ): Promise<EventOccurrences[]> {
    const rows = (await this.apiReq("GET", `/events/server/${serverId}`, {
      query: { from, to },
    })) as EventWithOccurrences[];

    return rows.map((row) => ({
      event: this.upsert(row.event),
      occurrences: row.occurrences,
    }));
  }

  /**
   * Import legacy `[ACUTEST_EVENT]:`-tagged messages from a channel into real
   * events (manager-triggered, slice F). Dedup by source message id makes
   * re-running safe.
   */
  async importLegacy(
    serverId: string,
    channelId: string,
  ): Promise<ImportResultData> {
    return (await this.apiReq("POST", `/events/server/${serverId}/import`, {
      body: { channel: channelId },
    })) as ImportResultData;
  }

  /**
   * Raw request against a custom `/events` route.
   *
   * stoat-api's typed client silently drops the body AND query of routes missing
   * from its generated tables, so every calendar route goes through `fetch`.
   * Reads `baseURL`/`auth` from the `API` object the client already holds (the
   * `auth` getter recomputes the session header after a re-auth swap).
   */
  async apiReq(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, unknown> | undefined;
    },
  ): Promise<unknown> {
    const api = this.client.api as unknown as {
      baseURL: string;
      auth: Record<string, string>;
    };

    let qs = "";
    if (options?.query) {
      // Drop undefined/null so we never emit `?before=undefined`.
      const pairs = Object.entries(options.query)
        .filter(([, value]) => value != null)
        .map(([key, value]) => [key, String(value)] as [string, string]);
      if (pairs.length) qs = "?" + new URLSearchParams(pairs).toString();
    }

    const response = await fetch(api.baseURL + path + qs, {
      method,
      headers: {
        ...api.auth,
        ...(options?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      // Surface the typed error object when the body is JSON, else the raw text.
      let error: unknown = text;
      try {
        error = JSON.parse(text);
      } catch {
        /* keep the raw text */
      }
      throw error;
    }

    return response.status === 204 ? null : response.json();
  }
}
