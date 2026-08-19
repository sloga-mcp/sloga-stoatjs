/**
 * Watch-together wire types (server `v0::WatchSession` et al.). Sloga
 * carries only this control state; the media itself never touches a Sloga
 * server — each viewer's client fetches it from the provider.
 */

export type WatchMediaData =
  | {
      provider: "youtube";
      /** 11-character YouTube video id */
      video_id: string;
      title?: string;
    }
  | {
      provider: "jellyfin";
      server_url: string;
      server_id: string;
      item_id: string;
      item_name: string;
      item_kind: string;
      runtime_ms: number;
    };

export interface WatchSessionData {
  /** Session id (ulid) — key `last_seen_seq` by it */
  id: string;
  channel_id: string;
  /** The only user whose control writes are accepted (plus channel managers) */
  host_id: string;
  media: WatchMediaData;
  playing: boolean;
  /** Host position (ms) that was true at `position_at` */
  position_ms: number;
  /** SERVER unix-ms when `position_ms` was stamped */
  position_at: number;
  /** Thousandths — 1000 = 1.0× */
  rate_permille: number;
  /** Monotonic per channel; drop anything ≤ the last applied for this `id` */
  seq: number;
  started_at: number;
}

export interface WatchSessionResponse {
  session: WatchSessionData;
  /** Server unix-ms at response time — derive the clock offset from it */
  server_now: number;
}

/** Host control write AND heartbeat: always the FULL host-owned state. */
export interface DataWatchUpdate {
  playing: boolean;
  position_ms: number;
  rate_permille: number;
  media?: WatchMediaData;
}

/** Result of a watch route call: the body, or the API error id. */
export type WatchResult =
  | { ok: true; body: WatchSessionResponse; /** local ms when the request was sent / answered */ sentAt: number; receivedAt: number }
  | { ok: false; status: number; error: string };
