import { ReactiveSet } from "@solid-primitives/set";
import type { ChannelUnread } from "stoat-api";

import type { Merge } from "../lib/merge.js";

import type { Hydrate } from "./index.js";

/**
 * Ceiling the server counts to, mirrored here so live increments saturate at
 * the same place a fresh connect does. Rendered as "99+".
 */
export const UNREAD_COUNT_CAP = 100;

/**
 * Wire shape of an unread row, plus the unread-tail summary the server stamps
 * on: how many messages sit after the read pointer (saturating at 100) and
 * whether any of them carries an attachment. Both are omitted when empty, and
 * `stoat-api` 0.13.5 predates them, so they are declared here.
 */
export type APIChannelUnread = ChannelUnread & {
  count?: number;
  attachments?: boolean;
};

export type HydratedChannelUnread = {
  id: string;
  lastMessageId?: string;
  messageMentionIds: ReactiveSet<string>;
  unreadCount: number;
  unreadHasAttachments: boolean;
};

export const channelUnreadHydration: Hydrate<
  Merge<APIChannelUnread>,
  HydratedChannelUnread
> = {
  keyMapping: {
    _id: "id",
    last_id: "lastMessageId",
    mentions: "messageMentionIds",
    count: "unreadCount",
    attachments: "unreadHasAttachments",
  },
  functions: {
    id: (unread) => unread._id.channel,
    lastMessageId: (unread) => unread.last_id!,
    messageMentionIds: (unread) => new ReactiveSet(unread.mentions!),
    unreadCount: (unread) => unread.count ?? 0,
    unreadHasAttachments: (unread) => unread.attachments ?? false,
  },
  initialHydration: () => ({
    messageMentionIds: new ReactiveSet(),
    unreadCount: 0,
    unreadHasAttachments: false,
  }),
};
