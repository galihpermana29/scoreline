import type { TimChannel, TimEvent } from "../api/timstreams";
import type { Match } from "./match";

/**
 * The tim-streams event <-> feed match matcher (docs/tim-extra-streams.md).
 *
 * Verified head-to-head against the live feed 2026-10-18 (raw run notes in
 * AGENTS.md dated facts): a sport gate, a +-20-minute kick-off window, and
 * the unordered two-team name-pair score matched 22 of the tim list's 40
 * events to the right feed row, every true pair scoring at or above 0.52 -
 * including a same-hour Premier League trio each picking its own row, and
 * Italianized feed spellings like "Palazzo di Cristallo" vs "Crystal
 * Palace" surviving on the pair score. Tim names are US-convention
 * "Away @ Home"; feed names are home-first and partly localized, so the
 * pair score is deliberately unordered: each tim side scores its best
 * similarity against either feed team, and the mean must clear the gate.
 *
 * No stream counterpart existing for a feed row is the normal case (the
 * tim list is ~40 curated events) and yields an empty channel list, never
 * an error. False-positive pairing inside a tight window is the only real
 * risk, and two 1:1 guards cover it:
 *
 * - one tim event binds at most one row, and one row takes at most one
 *   event: highest pair score wins, nearest kick-off breaks ties (an MLB
 *   doubleheader would otherwise take the wrong game's row);
 * - when the caller can supply the peer feed rows, the binding must be
 *   mutual - the row must also be the event's best row in the window -
 *   so one event cannot claim two rows.
 */

/** Kick-off window: tim times are ET, feed kick-offs UTC, both converted. */
const KICKOFF_WINDOW_MS = 20 * 60_000;
/** Pair-score gate: verified true pairs land 0.52+, so 0.45 leaves margin. */
const PAIR_SCORE_GATE = 0.45;

/**
 * Club-suffix noise both conventions carry. Dropping these tokens keeps
 * "Leeds Uniti FC" scoring against "Leeds" and hurts nothing visible;
 * city words like "City"/"United" stay - they are load-bearing ("Manchester
 * City" vs "Manchester United" must not score as each other).
 */
const STOP_TOKENS = new Set([
  "fc",
  "cf",
  "sc",
  "ac",
  "afc",
  "bfc",
  "cfc",
  "if",
  "bk",
  "fk",
  "sk",
  "cd",
  "nda",
  "club",
  "clubs",
  "de",
  "del",
  "di",
  "da",
  "do",
  "the",
  "calcio",
]);

/** Classic edit distance; names are short so the matrix is cheap. */
const levenshtein = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      const up = previous[j] ?? 0;
      const left = current[j - 1] ?? 0;
      const diagonal = previous[j - 1] ?? 0;
      current[j] = Math.min(left + 1, up + 1, diagonal + cost);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
};

const ratio = (a: string, b: string): number =>
  a === b ? 1 : a.length + b.length === 0 ? 0 : 1 - (2 * levenshtein(a, b)) / (a.length + b.length);

/**
 * Normalizes a display name: lowercase, strip accents, tokenize, drop club
 * suffixes. Accents matter here - the feed's Italianizations ("Reale
 * Madrid") and US spellings must meet on the same ground.
 */
const normalizeTokens = (name: string): readonly string[] =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== "" && !STOP_TOKENS.has(token));

/** Token similarity: exact, or the edit-distance ratio for fuzzier forms. */
const tokenSimilarity = (a: string, b: string): number => (a === b ? 1 : ratio(a, b));

/** Symmetric best-match mean over token sets. */
const tokenScore = (a: readonly string[], b: readonly string[]): number => {
  if (a.length === 0 || b.length === 0) return 0;
  let fromA = 0;
  for (const tokenA of a) {
    let best = 0;
    for (const tokenB of b) best = Math.max(best, tokenSimilarity(tokenA, tokenB));
    fromA += best;
  }
  let fromB = 0;
  for (const tokenB of b) {
    let best = 0;
    for (const tokenA of a) best = Math.max(best, tokenSimilarity(tokenA, tokenB));
    fromB += best;
  }
  return (fromA / a.length + fromB / b.length) / 2;
};

/**
 * Name similarity: the best of whole-string ratio and the token score -
 * "token-overlap or SequenceMatcher" from the verified prototype, with the
 * whole-string form keeping shortened forms ("Leeds" vs "Leeds Uniti") in
 * play.
 */
const nameSimilarity = (a: string, b: string): number => {
  const tokensA = normalizeTokens(a);
  const tokensB = normalizeTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  return Math.max(ratio(tokensA.join(" "), tokensB.join(" ")), tokenScore(tokensA, tokensB));
};

/**
 * Tim's display convention is "Away @ Home" (away first). Sides with no "@"
 * are title-shaped specials (motorsport sessions, cards) - not team pairs,
 * outside the matcher's scope.
 */
const timSides = (name: string): readonly [string, string] | null => {
  const parts = name.split("@");
  if (parts.length !== 2) return null;
  const away = parts[0]?.trim();
  const home = parts[1]?.trim();
  if (away === undefined || home === undefined || away === "" || home === "") return null;
  return [away, home];
};

type Scored = {
  score: number;
  deltaMs: number;
};

/**
 * The unordered pair score: each tim side's best similarity against either
 * feed team, averaged. Deliberately not forced diagonal - the verified
 * prototype's forgiving form, safe because the 1:1 guards below decide
 * between near candidates and undefined peers score it 0 anyway.
 */
const pairScore = (match: Match, sides: readonly [string, string]): number => {
  const feedNames = [match.home.name, match.away.name];
  const maxOf = (side: string): number =>
    Math.max(...feedNames.map((feed) => nameSimilarity(side, feed)));
  return (maxOf(sides[0]) + maxOf(sides[1])) / 2;
};

const scoreCandidate = (match: Match, event: TimEvent, sides: readonly [string, string]): Scored | null => {
  if (match.sportId === undefined || event.sportId !== match.sportId) return null;
  if (match.kickoff === null || event.startsAtMs === null) return null;
  const deltaMs = Math.abs(match.kickoff.getTime() - event.startsAtMs);
  if (deltaMs > KICKOFF_WINDOW_MS) return null;
  const score = pairScore(match, sides);
  if (score < PAIR_SCORE_GATE) return null;
  return { score, deltaMs };
};

/**
 * The tim channels for one feed match: the streams of the one event bound
 * to it, or an empty list. `peers` are the other feed rows the caller
 * already has in memory (the watch screen receives the feed list); they
 * power the mutual-binding guard. Without peers the guard degrades to the
 * per-row ordering only (highest score, then nearest kick-off).
 */
export const timChannelsFor = (
  match: Match,
  events: readonly TimEvent[],
  peers: readonly Match[] = [],
): readonly TimChannel[] => {
  // Title-only rows have no team pair to score against.
  if (match.titleOnly === true) return [];

  const candidates: { event: TimEvent; scored: Scored }[] = [];
  for (const event of events) {
    const sides = timSides(event.name);
    if (sides === null) continue;
    const scored = scoreCandidate(match, event, sides);
    if (scored !== null) candidates.push({ event, scored });
  }
  // Highest score wins; nearest kick-off breaks ties (sort is stable, so
  // equal scores keep the delta order from the comparator).
  candidates.sort(
    (a, b) => b.scored.score - a.scored.score || a.scored.deltaMs - b.scored.deltaMs,
  );

  const rows = [match, ...peers.filter((peer) => peer.id !== match.id && peer.titleOnly !== true)];

  for (const candidate of candidates) {
    if (rows.length <= 1) return channelsOf(candidate.event);
    // Mutual binding: among the rows this event could claim, ours must be
    // the best one too, otherwise the event belongs to a different row
    // (the doubleheader case) and the next candidate gets its turn.
    let best: { row: Match; scored: Scored } | null = null;
    for (const row of rows) {
      const sides = timSides(candidate.event.name);
      if (sides === null) continue;
      const scored = scoreCandidate(row, candidate.event, sides);
      if (scored === null) continue;
      if (best === null || scored.score > best.scored.score || (scored.score === best.scored.score && scored.deltaMs < best.scored.deltaMs)) {
        best = { row, scored };
      }
    }
    if (best !== null && best.row.id === match.id) return channelsOf(candidate.event);
  }
  return [];
};

const channelsOf = (event: TimEvent): readonly TimChannel[] =>
  event.streams.map((stream) => ({ ...stream, eventId: event.id }));