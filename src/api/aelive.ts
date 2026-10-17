import type { Match, MatchStatus, Team } from "../domain/match";
import { sportThumb } from "../domain/artwork";
import { parseFeed, type RawRow } from "../../shared/feed";
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

/**
 * Localisation asked of every data-host endpoint (free-text names come back
 * partly Italian on their side, 2026-10-17). Exported for streams.ts, which
 * rides the same endpoints as the feed.
 */
export const LANGUAGE = 8;

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

/**
 * Raw protobuf bytes from the rotating data-host family, with the sticky
 * host preference and last-resort re-discovery that the live feed rides.
 * The stream-list reader in streams.ts fetches the same family (verified
 * live 2026-10-17: /api/match/detail answers on the feed's hosts with the
 * same open CORS), so a data-host rotation heals both without code changes.
 */
export const fetchDataHostBytes = async (path: string, query: string): Promise<Uint8Array> => {
  const hosts = preferredHosts ?? (await resolveApiHosts());
  let lastError: unknown = null;
  for (const host of hosts) {
    try {
      const response = await fetch(`https://${host}${path}?${query}`);
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
  throw lastError instanceof Error ? lastError : new Error("No data host responded.");
};

/** Live matches for one sport: one feed request, no spacing needed. */
const fetchPayload = async (sportType: number): Promise<Uint8Array> =>
  fetchDataHostBytes(FEED_PATH, `sportType=${sportType}&language=${LANGUAGE}&stream=false`);

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

const parseMatch = (row: RawRow): Match => {
  const { matchId, sportId, competition, title } = row;
  const kickoff = row.kickoffMs === null ? null : new Date(row.kickoffMs);
  const slugs = row.slugs ?? undefined;

  // Row order is the dependable signal: first team row is home, second is away.
  // The feed's own side markers are unreliable (duplicated 1s, or absent).
  const teams: Team[] = row.teams.map((team) => ({ id: String(team.id ?? team.name), name: team.name, badge: team.badge }));
  const homeTeam = teams[0] ?? titleFallback(title).home;
  const awayTeam = teams[1] ?? titleFallback(title).away;
  const artHint = [title, homeTeam.name, awayTeam.name, competition?.name].filter(Boolean).join(" ");

  const base = {
    id: `ae-${matchId}`,
    sport: sportLabel(sportId),
    league: {
      id: String(competition?.id ?? matchId),
      name: competition?.name ?? "Live match",
      badge: competition?.badge ?? null,
    },
    kickoff,
    status: parseStatus(row.statusCode, kickoff),
    venue: null,
    country: competition?.country ?? null,
    round: null,
    thumb: sportThumb(sportId, String(matchId), artHint),
    sportId,
    slugs,
    odds: row.odds.length > 0 ? row.odds : undefined,
  };

  // Session-style entries have no team rows. The title becomes the event
  // label and is never split into two fake opponents.
  if (teams.length === 0) {
    const name = title ?? "Live session";
    const team = { id: name, name, badge: null };
    return { ...base, home: team, away: team, homeScore: null, awayScore: null, titleOnly: true } satisfies Match;
  }

  return {
    ...base,
    home: homeTeam,
    away: awayTeam,
    homeScore: row.score?.home ?? null,
    awayScore: row.score?.away ?? null,
  } satisfies Match;
};

const parsePayload = (payload: Uint8Array): Match[] => parseFeed(payload).rows.map(parseMatch);

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