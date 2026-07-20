import type {
  User as APIUser,
  BotInformation,
  RelationshipStatus,
  UserStatus,
} from "stoat-api";

import type { Client } from "../Client.js";
import { File } from "../classes/File.js";

import type { Hydrate } from "./index.js";

/**
 * A linked streaming channel (Twitch / YouTube), public by design.
 * Newer than the published stoat-api types.
 */
export type UserConnection = {
  platform: "Twitch" | "YouTube";
  handle: string;
  display_name: string;
  /** Serialized only when true */
  live?: boolean;
  live_title?: string;
  live_since?: string;
};

/**
 * `e2ee_enabled` is newer than the published stoat-api types. It is a UI /
 * discovery hint ONLY (invariant 2) — actual E2EE capability always derives
 * from a fetched, signature-verified key bundle, never from this flag.
 * `connections` (linked streaming channels) is likewise newer than the
 * published types; absent = none.
 */
type APIUserExt = APIUser & {
  e2ee_enabled?: boolean;
  connections?: UserConnection[];
};

export type HydratedUser = {
  id: string;
  username: string;
  discriminator: string;
  displayName?: string;
  relationship: RelationshipStatus;
  relations: null;

  online: boolean;
  privileged: boolean;
  e2eeEnabled: boolean;

  badges: UserBadges;
  flags: UserFlags;

  avatar?: File;
  status?: UserStatus & {
    activity?: { name: string; started_at?: string } | null;
  };
  bot?: BotInformation;
  connections: UserConnection[];
};

export const userHydration: Hydrate<APIUserExt, HydratedUser> = {
  keyMapping: {
    _id: "id",
    display_name: "displayName",
    e2ee_enabled: "e2eeEnabled",
  },
  functions: {
    id: (user) => user._id,
    username: (user) => user.username,
    discriminator: (user) => user.discriminator,
    displayName: (user) => user.display_name!,
    relationship: (user) => user.relationship!,
    relations: () => null,

    online: (user) => user.online!,
    privileged: (user) => user.privileged,
    // Serialized only when true (server skips false), so absence = false
    e2eeEnabled: (user) => user.e2ee_enabled ?? false,

    badges: (user) => user.badges!,
    flags: (user) => user.flags!,

    avatar: (user, ctx) => new File(ctx as Client, user.avatar!),
    status: (user) => user.status!,
    bot: (user) => user.bot!,
    // Serialized only when non-empty, so absence = none
    connections: (user) => user.connections ?? [],
  },
  initialHydration: () => ({
    relationship: "None",
    e2eeEnabled: false,
    connections: [],
  }),
};

/**
 * Badges available to users
 */
export enum UserBadges {
  Developer = 1,
  Translator = 2,
  Supporter = 4,
  ResponsibleDisclosure = 8,
  Founder = 16,
  PlatformModeration = 32,
  ActiveSupporter = 64,
  Paw = 128,
  EarlyAdopter = 256,
  ReservedRelevantJokeBadge1 = 512,
  ReservedRelevantJokeBadge2 = 1024,
}

/**
 * Flags attributed to users
 */
export enum UserFlags {
  Suspended = 1,
  Deleted = 2,
  Banned = 4,
}
