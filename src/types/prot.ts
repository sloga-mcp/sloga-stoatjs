/**
 * Currency of a Prot ledger row; only Prot today
 */
export type ProtCurrency = "Prot";

/**
 * Kind of a Prot ledger row, serialized as the variant name
 */
export type ProtEntryKind =
  | "Purchase"
  | "CipherFounding"
  | "CipherUpgrade"
  | "Contribution"
  | "TierUpgrade"
  | "PledgeHold"
  | "PledgeCapture"
  | "PledgeReturn"
  | "PledgeWithdraw"
  | "LaunchReturn"
  | "Burn"
  | "Settlement"
  | "WriteOff"
  | "Clawback"
  | "ClawbackHold"
  | "Forfeit"
  | "ForfeitHold"
  | "ForfeitTank"
  | "AdminAdjust";

/**
 * What a Prot payment order buys; `prot` and `cents` are stamped by the server
 */
export type ProtSku =
  | { type: "ProtPack"; pack: string; prot: number; cents: number }
  | { type: "ProtExact"; prot: number };

/**
 * The session user's unfinished Prot checkout
 */
export type ProtPendingView = {
  /** Id of the payment order */
  order_id: string;
  /** What the order buys */
  sku: ProtSku;
  /** Epoch ms after which the checkout page expires */
  expires_at: number;
};

/**
 * One ledger row as the wallet owner sees it
 */
export type ProtLedgerView = {
  /** Ledger row id (ULID) */
  id: string;
  /** Kind of the row */
  kind: ProtEntryKind;
  /** Signed from the wallet's side: + credited to it, - debited from it */
  amount: number;
  /** Epoch ms the row was written */
  created_at: number;
  /** Payment order the row belongs to, if any */
  order_id?: string;
};

/**
 * GET /payments/prot/@me
 */
export type ProtMe = {
  /** Wallet balance */
  balance: number;
  /** Part of `balance` under the purchase hold */
  held: number;
  /** Wallet account version when read (0 = no account yet) */
  version: number;
  /** Unfinished checkout, if any */
  pending_order?: ProtPendingView;
  /** Newest first, at most 20 */
  recent: ProtLedgerView[];
};

/**
 * One Prot pack on sale, as advertised in the root config
 */
export type ProtPackView = {
  /** Pack id from the config */
  id: string;
  /** Price in US cents */
  cents: number;
  /** Prot credited (bonus included) */
  prot: number;
};

/**
 * Prot configuration advertised in the root config (`features.prot`)
 */
export type ProtFeature = {
  enabled: boolean;
  self_serve_enabled: boolean;
  sales_open: boolean;
  cipher_grants_enabled: boolean;
  packs: ProtPackView[];
  exact_min_cents: number;
  exact_max_cents: number;
  wallet_cap: number;
  /**
   * Tank rules the client previews prices with (the server computes every
   * price). Absent from servers older than fuel tanks.
   */
  tank?: ProtTankFeature;
};

/**
 * Start a Prot checkout: exactly one of `pack` / `exact_cents`
 */
export type DataProtCheckout = {
  /** Pack id to buy */
  pack?: string;
  /** Pay-exact amount in US cents (1 Prot per cent) */
  exact_cents?: number;
  /** Where the buyer is sent after checkout */
  return_to: "web" | "shell";
};

/**
 * Fuel tank rules advertised in the root config (`features.prot.tank`). A
 * config the server would refuse is advertised as zeros and false with no
 * tier costs; `min_contribution: 0` means contributing is unavailable.
 */
export type ProtTankFeature = {
  /** Prot per day for a protected channel, keyed by slot tier ("10".."100") */
  channel_daily_cost: Record<string, number>;
  /** Smallest contribution or pledge, in Prot */
  min_contribution: number;
  min_launch_goal_days: number;
  max_launch_goal_days: number;
  launch_goal_deadline_days: number;
  withdraw_cutoff_hours: number;
  /** Prot bought in the last this many hours can't go into a tank or pledge */
  contribute_hold_hours: number;
  grace_days: number;
  freeze_days: number;
  /** Whether a channel whose tank stays empty past its freeze is deleted */
  deletion_enabled: boolean;
};

/**
 * Stage of a fuel tank, serialized as the variant name
 */
export type ProtTankStage =
  | "Launching"
  | "Active"
  | "Grace"
  | "Frozen"
  | "Settling"
  | "Deleted"
  | "Terminated";

/**
 * State of a funding goal
 */
export type ProtGoalState =
  | "Funding"
  | "Funded"
  | "Launching"
  | "Launched"
  | "Applied"
  | "Expired"
  | "Cancelled";

/**
 * What a funding goal pays for
 */
export type ProtGoalKind = "Launch" | "Upgrade";

/**
 * State of a pledge; `ClawedBack` is a pledge a clawback drained to 0
 */
export type ProtPledgeState =
  | "Held"
  | "Captured"
  | "Returned"
  | "Withdrawn"
  | "Forfeited"
  | "ClawedBack";

/**
 * The tank state every viewer of the channel may see (banner, shield, panel)
 */
export type ProtTankSummary = {
  tank_id: string;
  channel_id: string;
  stage: ProtTankStage;
  /** 10 | 25 | 50 | 100 */
  slot_tier: number;
  pending_slot_tier?: number;
  daily_cost: number;
  /** May be negative in Grace (borrowed grace) */
  balance: number;
  /** Active only: epoch ms the tank runs out (a UTC midnight) */
  protected_until?: number;
  /** Grace only: epoch ms the grace period ends */
  grace_ends_at?: number;
  /**
   * Grace / Frozen, and only while deletion is enabled: epoch ms of the
   * earliest deletion (it may be postponed). Absent = no deletion date is
   * promised.
   */
  deletes_at?: number;
  launched_at?: number;
  /**
   * The tank document's version; with `balance_version`, clients keep the
   * lexicographically newest (version, balance_version) of a tank
   */
  version: number;
  /** The tank account's version */
  balance_version: number;
};

/**
 * One contributor line. `user_id` is absent for a hidden contributor
 * ("Anonymous", hidden even from the owner) and for a deleted user
 * ("Deleted user", `deleted: true`)
 */
export type ProtContributorView = {
  user_id?: string;
  /** Net Prot (after returns); > 0 */
  amount: number;
  hidden: boolean;
  deleted: boolean;
  /** This line is the caller (also when hidden) */
  you: boolean;
};

/**
 * One of the caller's pledges to a goal
 */
export type ProtPledgeView = {
  id: string;
  goal_id: string;
  amount: number;
  remaining: number;
  state: ProtPledgeState;
  created_at: number;
};

/**
 * A funding goal (launch or upgrade)
 */
export type ProtGoalView = {
  id: string;
  kind: ProtGoalKind;
  server_id: string;
  channel_id?: string;
  tank_id?: string;
  slots: number;
  /** Launch goals only */
  days?: number;
  daily_cost: number;
  target_prot: number;
  pledged_total: number;
  state: ProtGoalState;
  deadline_at: number;
  /** `deadline_at` minus the withdraw cutoff */
  withdraw_until: number;
  funded_at?: number;
  launch_deadline_at?: number;
  launched_at?: number;
  contributors: ProtContributorView[];
  your_pledges: ProtPledgeView[];
  /** Verbatim seat notice */
  notice: string;
};

/**
 * GET /prot/channels/:id/tank
 */
export type ProtTankView = {
  tank: ProtTankSummary;
  contributors: ProtContributorView[];
  /** Open goals of this tank (Upgrade), and the Launching launch goal if any */
  goals: ProtGoalView[];
  /** What the caller contributed net (0 if nothing) */
  you_contributed: number;
  /** The caller may contribute now and the stage takes top-ups */
  can_contribute: boolean;
  /** The caller is the server owner */
  is_owner: boolean;
  /** Slots in use (active + cooling) */
  seats_used: number;
  notice: string;
};

/**
 * POST /prot/channels/:id/contribute and POST /prot/goals/:id/pledges
 */
export type DataProtContribute = {
  /** 1..=1_000_000 (the server checks the minimum contribution) */
  amount: number;
  /** Client ULID; scopes the idempotency key (1-64 chars) */
  nonce: string;
};

/**
 * Create a launch goal
 */
export type DataProtLaunchGoal = {
  slots: number;
  days: number;
  /** Client ULID (1-64 chars) */
  nonce: string;
};

/**
 * Create an upgrade goal
 */
export type DataProtUpgradeGoal = {
  slots: number;
  /** Client ULID (1-64 chars) */
  nonce: string;
};

/**
 * Launch a funded launch goal into a channel
 */
export type DataProtGoalLaunch = {
  /** 1-64 chars */
  channel_id: string;
};

/**
 * Change a tank's slot tier
 */
export type DataProtTier = {
  slots: number;
  /** Client ULID (1-64 chars) */
  nonce: string;
};

/**
 * PUT /prot/servers/:id/contributor: hide or show the caller's name on this
 * server's tanks and goals (one setting per server; hidden even from the
 * owner)
 */
export type DataProtContributorPrefs = {
  hidden: boolean;
};

/**
 * Response to a contribution or top-up
 */
export type ProtContributionResponse = {
  entry_id: string;
  tank: ProtTankSummary;
  /** Wallet after the posting */
  balance: number;
  already_applied: boolean;
  notice: string;
};

/**
 * Response to a pledge
 */
export type ProtPledgeResponse = {
  pledge: ProtPledgeView;
  goal: ProtGoalView;
  /** Wallet after the posting */
  balance: number;
  already_applied: boolean;
  notice: string;
};
