import { num, parseProto, sub, subs, text, texts, type ProtoField } from "./protobuf";

/**
 * The pure half of the live-feed client: protobuf bytes in, raw rows out.
 * No browser or Convex dependencies, so the app and the alerts cron read the
 * feed through one parser. Field numbers were reconstructed from wire-format
 * analysis (see src/api/aelive.ts for the history); the app maps these rows
 * onto its own Match type, the cron matches them against alert choices.
 */

export type RawTeam = {
  /** Numeric feed team id; null when the row ships none (then it is not matchable). */
  id: number | null;
  name: string;
  badge: string | null;
};

export type RawCompetition = {
  id: number | null;
  name: string | null;
  badge: string | null;
  country: string | null;
};

export type RawRow = {
  matchId: number;
  sportId: number;
  kickoffMs: number | null;
  /** Field 4 untouched. The app folds it into a MatchStatus; the cron only checks it for finish/cancel codes. */
  statusCode: number | null;
  competition: RawCompetition | null;
  /** The display title row ({2: title}), when the feed ships one. */
  title: string | null;
  /** Team rows in feed order: first is home, second is away. */
  teams: RawTeam[];
  slugs: { match: string; competition: string } | null;
  score: { home: number | null; away: number | null } | null;
  odds: string[];
};

export type RawFeed = {
  rows: RawRow[];
  /** Match ids listed in the feed's stream list - the "a stream is up" signal. One entry per channel, so ids can repeat. */
  streamIds: number[];
};

/** Name message shape shared by competitions, teams, and countries: {2: name}. */
const nameOf = (message: ProtoField[] | null): string | null =>
  message === null ? null : text(sub(message, 3) ?? message, 2);

/**
 * One row of message field 30. Team sports carry {10: team}; tennis ships its
 * players at field 20 with the same inner message shape {1: id, 3: {2: name}, 4: logo}.
 */
const teamFromRow = (row: ProtoField[]): RawTeam | null => {
  const raw = sub(row, 10) ?? sub(row, 20);
  if (raw === null) return null;
  const name = nameOf(raw);
  if (name === null) return null;
  return { id: num(raw, 1), name, badge: text(raw, 4) };
};

/**
 * Each sport union member declares its SEO block at a different field number
 * (football pins at 150, most others 150 + sportId, the "everything else"
 * bucket sits at 200). The block ships pre-made slugs: 20 = match, 21 = competition.
 */
const seoCarrierFor = (sportId: number): number =>
  sportId === 1 ? 150 : sportId === 90 ? 200 : 150 + sportId;

const parseRow = (message: ProtoField[], oddsById: Map<number, string[]>): RawRow | null => {
  const matchId = num(message, 1);
  const sportId = num(message, 2);
  if (matchId === null || sportId === null) return null;

  const kickoffMs = num(message, 3);

  const competitionMessage = sub(message, 10);
  const competition: RawCompetition | null =
    competitionMessage === null
      ? null
      : {
          id: num(competitionMessage, 1),
          name: nameOf(competitionMessage),
          badge: text(competitionMessage, 4),
          country: nameOf(sub(competitionMessage, 80)),
        };

  const seo = sub(message, seoCarrierFor(sportId));
  const matchSlug = seo === null ? null : text(seo, 20);
  const competitionSlug = seo === null ? null : text(seo, 21);

  const rows = subs(message, 30);
  const titleRow = rows.find((row) => num(row, 1) === null);
  const brief = sub(message, 100);
  const scoreMessage = brief === null ? null : sub(brief, 2);

  return {
    matchId,
    sportId,
    kickoffMs: kickoffMs !== null && kickoffMs > 0 ? kickoffMs : null,
    statusCode: num(message, 4),
    competition,
    title: titleRow === undefined ? null : text(titleRow, 2),
    teams: rows.flatMap((row) => {
      const team = teamFromRow(row);
      return team === null ? [] : [team];
    }),
    slugs: matchSlug !== null && competitionSlug !== null ? { match: matchSlug, competition: competitionSlug } : null,
    score: scoreMessage === null ? null : { home: num(scoreMessage, 10), away: num(scoreMessage, 11) },
    odds: oddsById.get(matchId) ?? [],
  };
};

/** Decodes one `PBMatchLiveResp` payload. Throws when the bytes are not protobuf. */
export const parseFeed = (payload: Uint8Array): RawFeed => {
  const root = parseProto(payload);
  if (root === null) throw new Error("Live feed returned bytes that are not protobuf.");
  const data = sub(root, 10);
  if (data === null) return { rows: [], streamIds: [] };

  // Message 10.3: betting odds, {2: sportId, 5: repeated decimal strings, 20: matchId}.
  const oddsById = new Map<number, string[]>();
  for (const row of subs(data, 3)) {
    const matchId = num(row, 20);
    const values = texts(row, 5);
    if (matchId !== null && values.length > 0) oddsById.set(matchId, values);
  }

  // Message 10.2: the stream list, entries {2: 1, 5: 1, 50: matchId}.
  const streamIds = subs(data, 2).flatMap((entry) => {
    const matchId = num(entry, 50);
    return matchId === null ? [] : [matchId];
  });

  return {
    rows: subs(data, 1).flatMap((message) => {
      const row = parseRow(message, oddsById);
      return row === null ? [] : [row];
    }),
    streamIds,
  };
};

/**
 * True when the body is the backend's "no data for this sport right now"
 * answer: an empty PBMatchLiveResp serialized as XML (`<PBMatchLiveResp>...`),
 * sent with status 499 (verified 2026-10-17). It is not a host failure.
 */
export const isEmptyFeedAnswer = (status: number, body: string): boolean =>
  status === 499 && body.trimStart().startsWith("<PBMatchLiveResp");
