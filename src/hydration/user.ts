import type {
  File as APIFile,
  User as APIUser,
  BotInformation,
  RelationshipStatus,
  UserStatus,
} from "stoat-api";

import type { Client } from "../Client.js";
import { File } from "../classes/File.js";
import type { NameStyle } from "../types/perks.js";

import type { Hydrate } from "./index.js";

/**
 * A linked streaming channel (Twitch / YouTube / Kick), public by design.
 * Newer than the published stoat-api types.
 */
export type UserConnection = {
  platform: "Twitch" | "YouTube" | "Kick";
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
 * `relationship_note` (note attached to an incoming friend request; only
 * ever present for the receiving session user) and `profile_visibility`
 * (self-only profile privacy setting) are newer than the published types.
 * `name_style` (already filtered by the server to what the user's perks
 * allow), `perks` (bitfield, skipped when 0; normally only sent for the
 * session user, though editing another account as staff or as its bot owner
 * returns that account's value) and `custom_badge` are likewise newer than
 * the published types.
 */
type APIUserExt = APIUser & {
  e2ee_enabled?: boolean;
  connections?: UserConnection[];
  relationship_note?: string;
  profile_visibility?: ProfileVisibility;
  /** Pronouns are also newer than the published types; absent = unset. */
  pronouns?: string;
  name_style?: NameStyle;
  perks?: number;
  custom_badge?: { image: APIFile; label: string };
};

/** Who may fetch the user's profile page */
export type ProfileVisibility = "Everyone" | "Friends";

export type HydratedUser = {
  id: string;
  username: string;
  discriminator: string;
  displayName?: string;
  pronouns?: string;
  relationship: RelationshipStatus;
  relationshipNote?: string;
  relations: null;

  online: boolean;
  privileged: boolean;
  e2eeEnabled: boolean;
  profileVisibility: ProfileVisibility;

  badges: UserBadges;
  flags: UserFlags;

  avatar?: File;
  status?: UserStatus & {
    activity?: { name: string; started_at?: string } | null;
  };
  bot?: BotInformation;
  connections: UserConnection[];

  nameStyle?: NameStyle;
  perks: number;
  customBadge?: { image: File; label: string };
};

export const userHydration: Hydrate<APIUserExt, HydratedUser> = {
  keyMapping: {
    _id: "id",
    display_name: "displayName",
    e2ee_enabled: "e2eeEnabled",
    relationship_note: "relationshipNote",
    profile_visibility: "profileVisibility",
    name_style: "nameStyle",
    custom_badge: "customBadge",
  },
  functions: {
    id: (user) => user._id,
    username: (user) => user.username,
    discriminator: (user) => user.discriminator,
    displayName: (user) => user.display_name!,
    pronouns: (user) => user.pronouns,
    relationship: (user) => user.relationship!,
    // No default: an explicit undefined must CLEAR a stale note when the
    // relationship leaves the pending state (see the UserRelationship
    // handler, which forwards the key unconditionally)
    relationshipNote: (user) => user.relationship_note,
    relations: () => null,

    online: (user) => user.online!,
    privileged: (user) => user.privileged,
    // Serialized only when true (server skips false), so absence = false
    e2eeEnabled: (user) => user.e2ee_enabled ?? false,
    // Only ever serialized on the session user's own object
    profileVisibility: (user) => user.profile_visibility ?? "Everyone",

    badges: (user) => user.badges!,
    flags: (user) => user.flags!,

    avatar: (user, ctx) => new File(ctx as Client, user.avatar!),
    status: (user) => user.status!,
    bot: (user) => user.bot!,
    // Serialized only when non-empty, so absence = none
    connections: (user) => user.connections ?? [],

    nameStyle: (user) => user.name_style,
    // Only runs when the key is present, so a partial update without it
    // keeps the known value. Normally only sent for the session user (an
    // edit of another account also returns that account's value), and the
    // session user's own updates carry an explicit 0 when the last perk is
    // lost
    perks: (user) => user.perks ?? 0,
    customBadge: (user, ctx) =>
      user.custom_badge && {
        image: new File(ctx as Client, user.custom_badge.image),
        label: user.custom_badge.label,
      },
  },
  initialHydration: () => ({
    relationship: "None",
    e2eeEnabled: false,
    profileVisibility: "Everyone",
    connections: [],
    // Skipped by the server when 0 and normally only sent for the session
    // user
    perks: 0,
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
  // 2048 is reserved
  /** Joined through a friend's referral */
  Welcomed = 4096,
  /** Referred friends to Sloga */
  Recruiter = 8192,
  /** Referred many friends to Sloga */
  RecruiterElite = 16384,
  /** Made a major donation to support Sloga */
  Patron = 32768,
}

/**
 * Flags attributed to users
 */
export enum UserFlags {
  Suspended = 1,
  Deleted = 2,
  Banned = 4,
}
