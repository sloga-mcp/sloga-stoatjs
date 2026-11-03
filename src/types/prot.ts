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
