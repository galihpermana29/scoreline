import type { Match, MatchStatus, Team } from "../domain/match";
import { sportThumb } from "../domain/artwork";
import { num, parseProto, sub, subs, text, texts, type ProtoField } from "../lib/protobuf";
import { FEED_PATH, resetApiHosts, resolveApiHosts } from "./source-sites";

/**
 * Client for the AE live-match feed, discovered by endpoint analysis
 * (2026-10-15). Plain HTTPS, no auth - the segment after `/sfver` is ignored
 * by the backend, so the literal placeholder from the discovered URL is kept
 * (see FEED_PATH in source-sites.ts). The feed host is NOT hardcoded: the
 * host family is discovered at runtime from the entry page and requests fail
 * over across it, so a host rotation keeps the feed alive. CORS is open and a
 * regular browser fetch passes the Cloudflare edge check.
 * Responses are binary protobuf (`PBMatchLiveResp`) with no published schema:
 * field numbers below were reconstructed from wire-format analysis.
 */
const LANGUAGE = 8;

/**
 * sportType=0 is a curated popular set that hides several live sports, so the
 * rest are fetched individually. Probed valid ids: 1-19 and 90; 5 and 20+ answer 400.
 */
const EXTRA_SPORT_IDS = [6, 7, 8, 9, 10, 14, 15, 17, 18, 19] as const;

/**
 * Cloudflare rate-limits bursts (429 after roughly ten rapid requests), so the
 * individual sport queries are spaced out.
 */
const REQUEST_SPACING_MS = 1600;

export const sportLabel = (sportId: number): string =>
  ({
    1: "Football",
    2: "Basketball",
    3: "Tennis",
    4: "Baseball",
    6: "Cricket",
    // Identified 2026-10-16 by probing the individual feeds: sportType 7 is
    // the motorsport bucket (WSBK, Grand Prix, RallyRACC, Nascar) and 15 is
    // the cycling bucket (UCI track, Eneco Tour, DAZN stage races). Curling
    // rides under 11 with the feed's ice-sports bucket. 17-19 answer empty.
    7: "Motorsport",
    8: "Rugby",
    9: "American Football",
    10: "Aussie Rules",
    11: "Ice Hockey",
    12: "Badminton",
    13: "Volleyball",
    14: "Combat Sports",
    15: "Cycling",
    16: "Handball",
    17: "Sport 17",
    18: "Sport 18",
    19: "Sport 19",
    90: "Horse Racing",
  })[sportId] ?? `Sport ${sportId}`;

/**
 * The most recently working feed host order, so a healthy session keeps
 * hitting one host instead of re-rotating every poll. Null means the last
 * list went entirely dead and the next call re-discovers it.
 */
let preferredHosts: readonly string[] | null = null;

const fetchPayload = async (sportType: number): Promise<Uint8Array> => {
  const hosts = preferredHosts ?? (await resolveApiHosts());
  let lastError: unknown = null;
  for (const host of hosts) {
    try {
      const response = await fetch(
        `https://${host}${FEED_PATH}?sportType=${sportType}&language=${LANGUAGE}&stream=false`,
      );
      if (!response.ok) throw new Error(`Live feed returned ${response.status}.`);
      // The host family also carries non-feed hosts (the apis-live* pair
      // answers a tiny text marker, verified 2026-10-16), so the content type
      // gates the host instead of a bare 200.
      const type = response.headers.get("content-type") ?? "";
      if (!type.includes("protobuf")) {
        throw new Error(`Live feed at ${host} returned ${type || "an unknown type"}.`);
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      // Move the winning host to the front so the next poll starts there.
      preferredHosts = [host, ...hosts.filter((other) => other !== host)];
      return buffer;
    } catch (error) {
      lastError = error;
    }
  }
  // Every host in the list failed: forget the order and drop the cached list
  // so the next poll re-discovers the family instead of retrying dead hosts.
  preferredHosts = null;
  resetApiHosts();
  throw lastError instanceof Error ? lastError : new Error("No live-feed host responded.");
};

/**
 * Field 4 status codes, decoded against the source's own web bundle
 * (statics f4e362bca14.js, verified 2026-10-16):
 * - FINISH is exactly codes 100 and 10000 - nothing else is ever terminal,
 *   and a row without a status code is NEVER finished on their site
 *   (it falls through to the All list with a VS display).
 * - ONGOING is per-sport live enums (football 101-105, basketball 200-214,
 *   tennis 300, ..., other 9000).
 * - COMING is 0 plus cancels/postponements (10001, 10002, 10101-10103).
 * The null-code rows the live feed still lists after kick-off are long
 * sessions still in progress (golf rounds, stage events) - their page shows
 * them as ongoing via the stream list, so they belong in our Live shelf.
 */
const parseStatus = (code: number | null, kickoff: Date | null): MatchStatus => {
  const started = kickoff !== null && kickoff.getTime() <= Date.now();
  if (code === 10000) return { kind: "finished", label: "FT" };
  if (code === null) return started ? { kind: "live", label: "LIVE" } : { kind: "upcoming" };
  return { kind: "live", label: "LIVE" };
};

/** Name message shape shared by competitions, teams, and countries: {2: name}. */
const nameOf = (message: ProtoField[] | null): string | null =>
  message === null ? null : text(sub(message, 3) ?? message, 2);

/**
 * One row of message field 30, observed shapes across sports:
 * - {2: title} - the match's display title
 * - {1: side?, 10: team} - team sports; only football carries an explicit side
 *   at the row level, and even that is unreliable (duplicated values).
 * - {20: player} - tennis ships players at field 20 with the same inner
 *   message shape {1: id, 3: {2: name}, 4: logo}.
 * Side markers are noise, so row order decides home/away.
 */
const teamFromRow = (row: ProtoField[]): Team | null => {
  const raw = sub(row, 10) ?? sub(row, 20);
  if (raw === null) return null;
  const name = nameOf(raw);
  if (name === null) return null;
  return { id: String(num(raw, 1) ?? name), name, badge: text(raw, 4) };
};

/** Splits a display title like "KuPs vs Trabzonspor" into two fallback teams. */
const titleFallback = (title: string | null): { home: Team; away: Team } => {
  if (title?.includes(" vs ")) {
    const [homeName = title, awayName = title] = title.split(" vs ");
    return {
      home: { id: homeName, name: homeName, badge: null },
      away: { id: awayName, name: awayName, badge: null },
    };
  }
  const name = title ?? "Live";
  return {
    home: { id: name, name, badge: null },
    away: { id: name, name, badge: null },
  };
};

/**
 * Each sport union member declares its SEO block at a different field number
 * (football pins at 150, most others 150 + sportId, the "everything else"
 * bucket sits at 200). The block ships pre-made slugs: 20 = match, 21 = competition.
 */
const seoCarrierFor = (sportId: number): number =>
  sportId === 1 ? 150 : sportId === 90 ? 200 : 150 + sportId;

const parseMatch = (message: ProtoField[], oddsById: Map<string, string[]>): Match | null => {
  const id = num(message, 1);
  const sportId = num(message, 2);
  if (id === null || sportId === null) return null;

  const kickoffMs = num(message, 3);
  const kickoff = kickoffMs !== null && kickoffMs > 0 ? new Date(kickoffMs) : null;

  const competition = sub(message, 10);
  const country = competition === null ? null : nameOf(sub(competition, 80));

  const seo = sub(message, seoCarrierFor(sportId));
  const matchSlug = seo === null ? null : text(seo, 20);
  const competitionSlug = seo === null ? null : text(seo, 21);
  const slugs =
    matchSlug !== null && competitionSlug !== null
      ? { match: matchSlug, competition: competitionSlug }
      : undefined;

  const rows = subs(message, 30);
  const titleRow = rows.find((row) => num(row, 1) === null);
  const titleText = titleRow === undefined ? null : text(titleRow, 2);

  const teams = rows.map(teamFromRow).flatMap((entry) => (entry ? [entry] : []));

  // Row order is the dependable signal: first team row is home, second is away.
  // The feed's own side markers are unreliable (duplicated 1s, or absent).
  const homeTeam = teams[0] ?? titleFallback(titleText).home;
  const awayTeam = teams[1] ?? titleFallback(titleText).away;
  const artHint = [titleText, homeTeam.name, awayTeam.name, nameOf(competition)].filter(Boolean).join(" ");

  // Session-style entries have no team rows. The title becomes the event
  // label and is never split into two fake opponents.
  if (teams.length === 0) {
    const name = titleText ?? "Live session";
    const team = { id: name, name, badge: null };
    return {
      id: `ae-${id}`,
      sport: sportLabel(sportId),
      league: {
        id: String((competition !== null ? num(competition, 1) : null) ?? id),
        name: nameOf(competition) ?? "Live match",
        badge: competition === null ? null : text(competition, 4),
      },
      home: team,
      away: team,
      homeScore: null,
      awayScore: null,
      kickoff,
      status: parseStatus(num(message, 4), kickoff),
      venue: null,
      country,
      round: null,
      thumb: sportThumb(sportId, String(id), artHint),
      sportId,
      slugs,
      odds: oddsById.get(String(id)) ?? undefined,
      titleOnly: true,
    } satisfies Match;
  }

  const brief = sub(message, 100);
  const scoreMessage = brief === null ? null : sub(brief, 2);
  const homeScore = scoreMessage === null ? null : num(scoreMessage, 10);
  const awayScore = scoreMessage === null ? null : num(scoreMessage, 11);

  return {
    id: `ae-${id}`,
    sport: sportLabel(sportId),
    league: {
      id: String((competition !== null ? num(competition, 1) : null) ?? id),
      name: nameOf(competition) ?? "Live match",
      badge: competition === null ? null : text(competition, 4),
    },
    home: homeTeam,
    away: awayTeam,
    homeScore,
    awayScore,
    kickoff,
    status: parseStatus(num(message, 4), kickoff),
    venue: null,
    country,
    round: null,
    thumb: sportThumb(sportId, String(id), artHint),
    sportId,
    slugs,
    odds: oddsById.get(String(id)) ?? undefined,
  } satisfies Match;
};

const parsePayload = (payload: Uint8Array): Match[] => {
  const root = parseProto(payload);
  if (root === null) throw new Error("Live feed returned bytes that are not protobuf.");
  const data = sub(root, 10);
  if (data === null) return [];

  // Message 10.3: betting odds, {2: sportId, 5: repeated decimal strings, 20: matchId}.
  const oddsById = new Map<string, string[]>();
  for (const row of subs(data, 3)) {
    const matchId = num(row, 20);
    const values = texts(row, 5);
    if (matchId !== null && values.length > 0) oddsById.set(String(matchId), values);
  }

  return subs(data, 1)
    .map((row) => parseMatch(row, oddsById))
    .flatMap((match) => (match ? [match] : []));
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Live matches across the curated popular set (one request, immediate). */
export const fetchLivePopular = async (): Promise<Match[]> => parsePayload(await fetchPayload(0));

/**
 * Live matches for the sports the popular set hides. Requests are spaced to
 * stay under the rate limit; a sport that fails is skipped until the next poll.
 */
export const fetchLiveExtraSports = async (): Promise<Match[]> => {
  const matches: Match[] = [];
  for (const [index, sportId] of EXTRA_SPORT_IDS.entries()) {
    if (index > 0) await sleep(REQUEST_SPACING_MS);
    try {
      matches.push(...parsePayload(await fetchPayload(sportId)));
    } catch {
      // Rate limit or transient failure: drop this sport for this cycle.
    }
  }
  return matches;
};