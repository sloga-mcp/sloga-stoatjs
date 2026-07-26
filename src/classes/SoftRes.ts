/**
 * Soft-reserve sheet types (local definitions — stoat-api 0.13.5 predates
 * soft reserves, so every route goes through raw `apiReq`, same as polls,
 * threads and calendar events).
 *
 * A sheet's IMMUTABLE creation-time definition arrives embedded in its
 * message (`softres` field + server-set SoftRes flag); the MUTABLE state
 * (reserves / counts / lock) is fetched and pushed separately so reserves
 * never republish the message. The dynamic wire model also carries the
 * sheet's CURRENT definition — settings edits leave the embedded copy
 * stale by design, so once state is hydrated the fresh copy wins.
 */

/** A World of Warcraft class, in Gargul's lowercase wire form */
export type WowClass =
  | "warrior"
  | "paladin"
  | "hunter"
  | "rogue"
  | "priest"
  | "shaman"
  | "mage"
  | "warlock"
  | "druid"
  /** Wrath sheets only — the class does not exist in Classic/TBC */
  | "deathknight";

/**
 * An item the leader took off the table before reserves opened
 * (loot-council / guild-bank items). Soft reserves on hard-reserved items
 * are rejected server-side.
 */
export type HardReserveData = {
  item_id: number;
  /** Who or what the item is reserved for (1..=50) */
  reserved_for: string;
  note?: string;
};

/**
 * A sheet's definition and settings (wire shape). Arrives in two places:
 * embedded in the carrying message (creation-time snapshot, cold render
 * only) and on the dynamic state model (current values — prefer these
 * once hydrated).
 */
export type SoftResDefinitionData = {
  /** Sheet id */
  id: string;
  title: string;
  /** Game edition every raid belongs to ("classic" | "tbc" | "wrath") */
  edition: string;
  /** Catalog raid ids in scope (1..=4, single edition) */
  raids: string[];
  /** How many items each raider may reserve (1..=10) */
  reserves_per_user: number;
  /** Cap on distinct raiders per item, when set (1..=20) */
  per_item_cap?: number;
  allow_duplicates?: boolean;
  /** Whether items are restricted to classes that can use them */
  class_restriction?: boolean;
  /** Whether reserves are hidden from non-managers until export */
  hidden?: boolean;
  /** Whether the sheet locks when its linked event starts */
  lock_at_event_start?: boolean;
  note?: string;
  hard_reserves?: HardReserveData[];
};

/** One raider's reservation row (wire shape) */
export type SoftResReserveData = {
  /** Reserving user's id (platform identity bound to the row) */
  user_id: string;
  /** Self-reported character name (2..=12, letters only) */
  character_name: string;
  /** Self-reported class */
  class: WowClass;
  /** Reserved item ids (1..=reserves_per_user) */
  items: number[];
  /** Optional note to the loot master */
  note?: string;
  /** +1 attendance bonus (always 0 in v1; omitted when 0) */
  plus_ones?: number;
  /** When this row was last written (ms since epoch, UTC) */
  edited_at: number;
};

/**
 * Dynamic sheet state (wire shape of `GET /channels/:id/softres/:sheet`).
 *
 * `reserves` / `item_counts` are omitted on hidden sheets unless the
 * requester is the creator or has ManageMessages — enforced server-side.
 * `my_reserve` is the requester's own row and is always present when they
 * have one (own data is never hidden from its owner).
 */
export type SoftResData = {
  _id: string;
  /** The sheet's CURRENT definition/settings (fresh, unlike the message-embedded snapshot) */
  definition: SoftResDefinitionData;
  message_id: string;
  channel_id: string;
  /** Id of the linked calendar event, when linked */
  event_id?: string;
  creator_id: string;
  /** Locked (manual, event cancellation, or `locks_at` passed — pre-resolved server-side) */
  locked?: boolean;
  /** When the sheet auto-locks (ms since epoch, UTC) */
  locks_at?: number;
  /** Number of reserve rows (raiders, not item picks) */
  total_reserves: number;
  reserves?: SoftResReserveData[];
  /** Aggregate reserve count per stringified item id; zero-count items omitted */
  item_counts?: Record<string, number>;
  my_reserve?: SoftResReserveData;
};

/** Local (hydrated) dynamic sheet state stored on the message */
export type SoftResState = {
  /**
   * The sheet's current definition/settings — prefer over the
   * message-embedded snapshot, which settings edits leave stale
   */
  definition?: SoftResDefinitionData;
  creatorId?: string;
  /** Linked calendar event id, if any */
  eventId?: string;
  /**
   * Whether the sheet is locked as of the last server contact. The card
   * must ADDITIONALLY flip on `locksAt` client-side — no WS event fires
   * at event start (lazy lock).
   */
  locked: boolean;
  /** When the sheet auto-locks (ms since epoch, UTC) */
  locksAt?: number;
  /** Number of reserve rows (raiders, not item picks) */
  totalReserves: number;
  /** All reserve rows — undefined while hidden from this viewer */
  reserves?: SoftResReserveData[];
  /** Per-item aggregate counts — undefined while hidden from this viewer */
  itemCounts?: Record<string, number>;
  /** This user's own reservation row, if they reserved */
  myReserve?: SoftResReserveData;
  /** Whether state has been fetched at least once (vs. definition-only) */
  hydrated: boolean;
};

/** Data for creating a soft-reserve sheet */
export type DataSoftResCreate = {
  title: string;
  /** Game edition ("classic" | "tbc" | "wrath") — must match every raid */
  edition: string;
  /** Catalog raid ids (1..=4, single edition) */
  raids: string[];
  /** 1..=10, default 1 */
  reserves_per_user?: number;
  /** 1..=20; absent = uncapped */
  per_item_cap?: number;
  allow_duplicates?: boolean;
  class_restriction?: boolean;
  hidden?: boolean;
  /** Requires `event_id` with a future, non-cancelled event */
  lock_at_event_start?: boolean;
  note?: string;
  /** ≤50; item ids must belong to the selected raids */
  hard_reserves?: HardReserveData[];
  /**
   * Calendar event to link (one sheet per event; requires event-manage
   * rights, non-recurring, non-cancelled)
   */
  event_id?: string;
  nonce?: string;
};

/** Data for setting (or replacing) the caller's reservation row */
export type DataSoftResReserve = {
  /** 2..=12, letters only (WoW name rules) */
  character_name: string;
  /** Validated against the sheet's edition (deathknight = wrath only) */
  class: WowClass;
  /** 1..=reserves_per_user item ids from the sheet's raids */
  items: number[];
  note?: string;
};

/** Sheet fields an edit can unset via `remove` */
export type FieldsSoftRes = "PerItemCap" | "Note";

/**
 * Data for editing a sheet's settings (raids are immutable post-create —
 * existing reserves reference them)
 */
export type DataSoftResEdit = {
  title?: string;
  reserves_per_user?: number;
  per_item_cap?: number;
  allow_duplicates?: boolean;
  class_restriction?: boolean;
  hidden?: boolean;
  lock_at_event_start?: boolean;
  note?: string;
  /** Full replacement of the hard-reserve list, when present */
  hard_reserves?: HardReserveData[];
  /** Fields to unset */
  remove?: FieldsSoftRes[];
};

/** Addon-importable export formats */
export type SoftResExportFormat = "gargul" | "raidres" | "csv";

/** Wire shape of `GET …/softres/:sheet/export` */
export type SoftResExportResponseData = {
  format: string;
  /** The rendered payload (base64 blob or CSV text) */
  payload: string;
};

/** One selectable game edition (wire shape) */
export type SoftResCatalogEditionData = {
  /** Stable edition id ("classic", "tbc", "wrath") */
  id: string;
  name: string;
  /** Display ordering (ascending) */
  sort: number;
  /** The edition's raids, in catalog order */
  raids: SoftResCatalogRaidData[];
};

/** One raid instance from the static catalog (wire shape) */
export type SoftResCatalogRaidData = {
  /** Stable raid id — a public contract (lands in Gargul exports) */
  id: string;
  /** Owning edition id */
  edition: string;
  name: string;
  /** Raid player count (display metadata) */
  slots: number;
  /** Wrath only: 10/25-player variant discriminator */
  size?: number;
  /** Wrath only: "normal" | "heroic" */
  difficulty?: string;
};

/** One reservable item of a raid's loot table (wire shape) */
export type SoftResCatalogItemData = {
  /** Item id (globally unique across editions) */
  id: number;
  name: string;
  /** Item quality (3 = rare, 4 = epic, 5 = legendary) */
  quality: number;
  /** Encounter attribution ("Ragnaros", "A / B", "Trash") */
  boss: string;
  /**
   * Lowercase class names allowed to use the item; absent when
   * unrestricted. Tier tokens legitimately carry several.
   */
  allowable_classes?: string[];
};

/** Wire shape of `GET /softres/catalog` */
export type SoftResCatalogResponse = {
  /** All editions ordered by `sort`, each with its raids */
  editions: SoftResCatalogEditionData[];
};

/** Wire shape of `GET /softres/catalog/:raid_id` */
export type SoftResRaidItemsResponse = {
  raid: SoftResCatalogRaidData;
  items: SoftResCatalogItemData[];
};

/**
 * Map the wire sheet state onto the local hydrated shape.
 *
 * Every key is set explicitly, so applying a full model is authoritative:
 * a retract clears `myReserve`, and hiding a sheet clears the cached
 * `reserves` / `itemCounts` (the server stopped sending them — rendering
 * a stale copy would defeat the gate).
 */
export function softresStateFromWire(sheet: SoftResData): SoftResState {
  return {
    definition: sheet.definition,
    creatorId: sheet.creator_id,
    eventId: sheet.event_id,
    locked: sheet.locked ?? false,
    locksAt: sheet.locks_at,
    totalReserves: sheet.total_reserves,
    reserves: sheet.reserves,
    itemCounts: sheet.item_counts,
    myReserve: sheet.my_reserve,
    hydrated: true,
  };
}
