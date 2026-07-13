/**
 * Poll types (local definitions — stoat-api 0.13.5 predates polls, so the
 * poll routes go through `ChannelCollection.apiReq`, same as threads and
 * calendar events).
 *
 * A poll's IMMUTABLE definition (question / answers / multiselect / expiry)
 * arrives embedded in its message; the MUTABLE state (counts / closed) is
 * fetched and pushed separately so votes never republish the message.
 */

/** One answer on a poll (wire shape) */
export type PollAnswerData = {
  id: number;
  text: string;
  emoji?: string;
};

/** The immutable poll definition embedded in the message (wire shape) */
export type PollDefinitionData = {
  id: string;
  question: string;
  answers: PollAnswerData[];
  allow_multiselect?: boolean;
  /** ms since epoch, UTC */
  expires_at: number;
};

/** Aggregate votes for one answer (wire shape) */
export type PollAnswerCountData = {
  answer_id: number;
  count: number;
};

/**
 * Dynamic poll state (wire shape of `GET /channels/:id/polls/:poll`).
 *
 * `counts` / `total_votes` are present only when the server let this user
 * see them: they voted, they authored the poll, they moderate the channel,
 * or the poll is closed. This gate is enforced server-side.
 */
export type PollData = {
  _id: string;
  message_id: string;
  channel_id: string;
  author_id: string;
  closed?: boolean;
  /** ms since epoch, UTC */
  expires_at: number;
  counts?: PollAnswerCountData[];
  total_votes?: number;
  my_votes?: number[];
};

/** Local (hydrated) dynamic poll state stored on the message */
export type PollState = {
  /** Aggregate counts per answer — undefined while hidden-until-vote */
  counts?: PollAnswerCountData[];
  /** Number of ballots cast — undefined while hidden-until-vote */
  totalVotes?: number;
  /** Whether the poll is closed (final results) */
  closed: boolean;
  /** This user's own ballot (answer ids), if they voted */
  myVotes?: number[];
  /** Whether state has been fetched at least once (vs. definition-only) */
  hydrated: boolean;
};

/** Data for creating a poll */
export type DataPollCreate = {
  question: string;
  answers: { text: string; emoji?: string }[];
  allow_multiselect?: boolean;
  /** 1..=768, default 24 */
  duration_hours?: number;
  nonce?: string;
};

/** Map the wire poll state onto the local hydrated shape */
export function pollStateFromWire(poll: PollData): PollState {
  return {
    counts: poll.counts,
    totalVotes: poll.total_votes,
    closed: poll.closed ?? false,
    myVotes: poll.my_votes,
    hydrated: true,
  };
}
