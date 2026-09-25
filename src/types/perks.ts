import type { DataEditUser, FieldsUser } from "stoat-api";

/**
 * Font used to render a user's name
 */
export type NameFont = "Serif" | "Mono" | "Rounded" | "Script" | "Pixel";

/**
 * Animated effect applied to a user's name
 */
export type NameEffect = "Shimmer" | "Glow" | "Rainbow";

/**
 * Personal name style; the server only sends the parts the user's perks allow
 */
export type NameStyle = {
  /** Name color, in the same format as role colors; absent = default color */
  colour?: string;
  /** Name font; absent = default font */
  font?: NameFont;
  /** Animated name effect; absent = none */
  effect?: NameEffect;
};

/**
 * Body of PATCH /users/:id, including fields newer than the published API types
 */
export type DataEditUserExt = Omit<DataEditUser, "remove"> & {
  /**
   * Personal name style, merged with the stored style one part at a time.
   * A part the user holds the perk for is set from the request, or cleared if
   * absent. A part the user lacks the perk for (e.g. a lapsed perk) keeps its
   * stored value; omitting it or resending that value is fine, but any other
   * value fails with PerkRequired. So `{}` clears only the parts the user holds
   * the perk for, and a style left with no parts is cleared entirely.
   * `remove: ["NameStyle"]` clears every part, locked or not; sent together with
   * `name_style`, the stored style is dropped first, so only parts the user
   * holds the perk for can be set.
   */
  name_style?: NameStyle;
  /** Fields to remove; Connections (unlink instead) and CustomBadge are not removable here */
  remove?: (
    | FieldsUser
    | "StatusActivity"
    | "ProfileLinks"
    | "Pronouns"
    | "NameStyle"
  )[];
};

/**
 * Perk bitfield, sent to the session user only
 */
export enum UserPerks {
  /** May set a custom name color */
  NameColour = 1,
  /** May set a custom name font */
  NameFont = 2,
  /** May set an animated name effect */
  NameEffect = 4,
  /** Raised file upload size limit */
  UploadPerk = 8,
  /** May set a custom profile badge */
  CustomBadge = 16,
}

/**
 * Reward unlocked at a referral tier
 */
export type ReferralReward =
  | "Badge"
  | "NameColour"
  | "BetterBadge"
  | "NameFont"
  | "NameEffect"
  | "UploadPerk"
  | "CustomBadge";

/**
 * One rung of the referral ladder
 */
export type ReferralTier = {
  /** Number of qualified referrals required */
  count: number;
  /** Reward unlocked at this count */
  reward: ReferralReward;
};

/**
 * The session user's referral code and progress
 */
export type ReferralSummary = {
  /** Bare referral code */
  code: string;
  /** Referral code as shown to users */
  display_code: string;
  /** Shareable referral link */
  link: string;
  /** Number of referrals that have qualified */
  qualified: number;
  /** Number of referrals still waiting to qualify */
  pending: number;
  /** Number of referrals that expired before qualifying */
  expired: number;
  /** Qualified referral count needed for the next tier; absent once every tier is reached */
  next_tier?: number;
  /** Every tier of the referral ladder, in order; absent = empty */
  tiers?: ReferralTier[];
};

/**
 * A user reached a new referral milestone
 */
export type ReferralMilestone = {
  /** Id of the user who reached the milestone */
  user_id: string;
  /** Qualified referral count they reached */
  referral_count: number;
};

/**
 * Reward unlocked at a donation tier
 */
export type DonationReward =
  | "SupporterBadge"
  | "NameColour"
  | "NameFont"
  | "NameEffect"
  | "PatronBadge";

/**
 * One rung of the donation ladder
 */
export type DonationTier = {
  /** Lifetime donation total required, in US cents */
  cents: number;
  /** Reward unlocked at this total */
  reward: DonationReward;
};

/**
 * The session user's donation standing and progress
 */
export type SupporterSummary = {
  /** Lifetime total of claimed donations, in US cents */
  lifetime_usd_cents: number;
  /** Whether a monthly donation is currently active; absent = false */
  monthly_active?: boolean;
  /** Epoch ms until which the monthly donation counts as active */
  monthly_until?: number;
  /** Whether supporter badges are shown on the profile; absent = false */
  show_badges?: boolean;
  /** Lifetime total needed for the next tier, in US cents; absent once every tier is reached */
  next_tier_cents?: number;
  /** Every tier of the donation ladder, in order; absent = empty */
  tiers?: DonationTier[];
  /** Ko-fi page to donate through */
  kofi_url: string;
};

/**
 * One-time code the user includes with a donation to link it to their account
 */
export type SupporterClaimCode = {
  /** Claim code */
  code: string;
  /** Epoch ms after which this code can no longer be used */
  expires_at: number;
};

/**
 * Outcome of claiming a donation
 */
export type ClaimOutcome = "Claimed" | "NeedsReview";

/**
 * Result of claiming a donation
 */
export type SupporterClaimResult = {
  /** Claimed = linked to the account; NeedsReview = awaits staff review */
  outcome: ClaimOutcome;
};

/**
 * Claim a donation by its Ko-fi transaction id
 */
export type DataSupporterClaim = {
  /** Ko-fi transaction id */
  transaction_id: string;
};

/**
 * Change the session user's supporter preferences
 */
export type DataEditSupporter = {
  /** Whether supporter badges are shown on the profile; required */
  show_badges: boolean;
};

/**
 * Privileged: set another user's custom profile badge
 */
export type DataSetCustomBadge = {
  /** File id of the badge image, uploaded with the `icons` tag */
  image: string;
  /** Badge label shown on hover */
  label: string;
};

/**
 * Privileged: assign an unclaimed donation to a user
 */
export type DataAssignDonation = {
  /** Id of the user receiving the donation */
  user: string;
  /** Amount in US cents to count in place of the recorded amount; absent = recorded amount */
  usd_cents?: number;
};
