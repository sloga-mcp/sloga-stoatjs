import type { Client } from "../Client.js";
import type {
  AttendeeCounts,
  EventData,
  RecurrenceRuleData,
  RsvpStatus,
} from "../classes/CalendarEvent.js";
import { File } from "../classes/File.js";

import type { Hydrate } from "./index.js";

/**
 * Hydrated representation of a calendar event.
 *
 * `myRsvp` / `counts` are the caller's RSVP context. They carry NO wire key and
 * are never produced by hydration — they are written only via
 * `updateUnderlyingObject` (by `fetchWithContext` and the RSVP handlers) and so
 * survive a store merge of new event fields.
 */
export type HydratedEvent = {
  id: string;
  serverId: string;
  channelId?: string;
  creatorId: string;
  title: string;
  description?: string;
  location?: string;
  start: number;
  end?: number;
  allDay: boolean;
  timezone: string;
  recurrence?: RecurrenceRuleData;
  color?: string;
  cancelled: boolean;
  attachments?: File[];
  createdAt: number;
  editedAt?: number;
  myRsvp?: RsvpStatus;
  counts?: AttendeeCounts;
};

export const eventHydration: Hydrate<EventData, HydratedEvent> = {
  keyMapping: {
    _id: "id",
    server: "serverId",
    channel: "channelId",
    creator: "creatorId",
    title: "title",
    description: "description",
    location: "location",
    start: "start",
    end: "end",
    all_day: "allDay",
    timezone: "timezone",
    recurrence: "recurrence",
    color: "color",
    cancelled: "cancelled",
    attachments: "attachments",
    created_at: "createdAt",
    edited_at: "editedAt",
  },
  functions: {
    id: (event) => event._id,
    serverId: (event) => event.server,
    channelId: (event) => event.channel,
    creatorId: (event) => event.creator,
    title: (event) => event.title,
    description: (event) => event.description,
    location: (event) => event.location,
    start: (event) => event.start,
    end: (event) => event.end,
    allDay: (event) => event.all_day,
    timezone: (event) => event.timezone,
    recurrence: (event) => event.recurrence,
    color: (event) => event.color,
    cancelled: (event) => event.cancelled,
    attachments: (event, ctx) =>
      event.attachments?.map((file) => new File(ctx as Client, file)),
    createdAt: (event) => event.created_at,
    editedAt: (event) => event.edited_at,
    // Never hydrated (no wire key); present only to satisfy the mapping type.
    myRsvp: () => undefined,
    counts: () => undefined,
  },
  initialHydration: () => ({}),
};
