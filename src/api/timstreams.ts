import { timApiOrigins } from "./source-sites";

/**
 * The tim-streams second source (docs/tim-extra-streams.md, verified live
 * 2026-10-18, investigation notes in AGENTS.md dated facts).
 *
 * A small, independently operated US-facing site that curates 1-3 stream
 * channels for roughly the same fixtures our source lists. This module is
 * purely additive: it fetches and normalizes their live+upcoming list so
 * the watch screen can offer those channels as extra server-menu entries,
 * and it never participates in the app's own match listing.
 *
 * Differences from the source network that shape the design:
 *
 * - CORS is fully open (their API reflects any origin), so a plain browser
 *   fetch works - no middleware, no probing, no bot-stub games.
 * - There is no discovery chain: no entry page reveals these hosts, so the
 *   env-seeded list from `/api/config` is the whole truth. Without it (and
 *   without a cached list) the tim feature resolves to zero channels,
 *   never to an error - matches with no tim counterpart are the norm.
 * - Their host family is stable-in-practice but not rot-proof either, so
 *   the fetched list is cached with the same 10-minute TTL pattern as the
 *   resolvers in source-sites.ts, and a failed refresh keeps the stale
 *   list: the last thing that provably worked.
 */

/** The endpoint we need; relative to one of the configured API origins. */
const LIVE_UPCOMING_PATH = "/api/live-upcoming";

const TIM_EVENTS_CACHE_KEY = "scoreline:tim-events";
const CACHE_TTL_MS = 10 * 60_000;

type Cached<T> = { at: number; value: T };

const readCache = <T>(key: string, fresh: (age: number) => boolean): T | null => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const entry = JSON.parse(raw) as Partial<Cached<T>>;
    if (entry.value === undefined || typeof entry.at !== "number") return null;
    if (!fresh(Date.now() - entry.at)) return null;
    return entry.value;
  } catch {
    return null;
  }
};

const writeCache = <T>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), value } satisfies Cached<T>));
  } catch {
    // Storage unavailable (private mode): the list just runs uncached.
  }
};

/**
 * Tim `genre` to our feed `sportId` (both verified 2026-10-18; tim's 8 and
 * 9 are American Football and Baseball respectively - the pair that is easy
 * to swap by mistake). Deliberately unmapped: 2 Motorsport and 3-6 combat/
 * wrestling (their titles are not team pairs, and the matcher needs a team
 * pair), plus 12 Darts, 17 Live Shows, 18 Other - no feed counterpart.
 */
const GENRE_TO_SPORT: Readonly<Record<number, number>> = {
  1: 1, // Soccer -> Football
  7: 2, // Basketball
  8: 9, // American Football
  9: 4, // Baseball
  10: 3, // Tennis
  11: 11, // Hockey -> Ice Hockey (+ curling on our side)
  13: 6, // Cricket
  14: 15, // Cycling
  15: 8, // Rugby
  16: 8, // Rugby
};

/**
 * Their event times are New York wall clock ("YYYY-MM-DDTHH:mm", ET/EDT -
 * verified live across fixtures with known local times 2026-10-18).
 * DST-aware conversion via an Intl round trip: read what New York's clock
 * shows at the instant the naive interpretation claims, and offset by the
 * difference. No hard-coded +4h anywhere, so the November DST flip cannot
 * silently shift every match by an hour.
 */
const newYorkOffsetMs = (utcMs: number): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  const asUtc = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
  return asUtc - utcMs;
};

/** Eastern wall-clock string to epoch ms, or null when unparseable. */
const easternEpochMs = (time: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(time);
  if (match === null) return null;
  const asIfUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  if (Number.isNaN(asIfUtc)) return null;
  return asIfUtc - newYorkOffsetMs(asIfUtc);
};

/** One playable channel of a tim event, e.g. {name: "English", url}. */
export type TimStream = {
  name: string;
  /** The bare player page on their rotating host; iframe it directly. */
  url: string;
};

/** A watch-screen tim channel: one of an event's streams, with provenance. */
export type TimChannel = TimStream & {
  /** The tim event's id, for provenance only (event slug's trailing number). */
  eventId: string;
};

/** One normalized live/upcoming event of the tim list. */
export type TimEvent = {
  /** Trailing numeric id of the event slug, kept as a string. */
  id: string;
  /** Full slug, as their watch route needs it. */
  url: string;
  /** "Away @ Home" display name (US convention, away first). */
  name: string;
  /** Our feed sport id, or null when the genre is deliberately unmapped. */
  sportId: number | null;
  /** Kick-off as epoch ms (their ET times converted), or null when bad. */
  startsAtMs: number | null;
  streams: readonly TimStream[];
};

type RawJson = Record<string, unknown>;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const parseStreams = (value: unknown): TimStream[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): TimStream[] => {
    if (entry === null || typeof entry !== "object") return [];
    const record = entry as RawJson;
    // vip channels sit behind their login and are skipped outright.
    if (record.vip === true) return [];
    const name = asString(record.name);
    const url = asString(record.url);
    if (name === null || url === null) return [];
    return [{ name, url }];
  });
};

const parseEvent = (value: unknown): TimEvent | null => {
  if (value === null || typeof value !== "object") return null;
  const record = value as RawJson;
  const url = asString(record.url);
  const name = asString(record.name);
  if (url === null || name === null) return null;
  const id = url.match(/(\d+)\D*$/)?.[1] ?? url;
  const genre = asNumber(record.genre);
  const time = asString(record.time);
  // A vip event is invisible to us entirely.
  if (record.vip === true) return null;
  return {
    id,
    url,
    name,
    sportId: genre === null ? null : (GENRE_TO_SPORT[genre] ?? null),
    startsAtMs: time === null ? null : easternEpochMs(time),
    streams: parseStreams(record.streams),
  };
};

const parseEvents = (value: unknown): readonly TimEvent[] => {
  if (value === null || typeof value !== "object") return [];
  const events = (value as RawJson).events;
  if (!Array.isArray(events)) return [];
  return events.flatMap((event): readonly TimEvent[] => {
    const parsed = parseEvent(event);
    return parsed === null || parsed.streams.length === 0 ? [] : [parsed];
  });
};

let inflight: Promise<readonly TimEvent[]> | null = null;

/**
 * The tim live+upcoming list, normalized. Never throws: every path
 * degrades to the stale cache and finally to an empty list - the watch
 * screen then simply shows no extra channels.
 */
export const fetchTimEvents = async (fresh = false): Promise<readonly TimEvent[]> => {
  if (!fresh) {
    const cached = readCache<readonly TimEvent[]>(TIM_EVENTS_CACHE_KEY, (age) => age < CACHE_TTL_MS);
    if (cached !== null) return cached;
    if (inflight !== null) return inflight;
  }
  inflight = (async () => {
    try {
      for (const origin of await timApiOrigins()) {
        try {
          const response = await fetch(`${origin}${LIVE_UPCOMING_PATH}`, { cache: "no-store" });
          if (!response.ok) throw new Error(`Tim API answered ${response.status}.`);
          // A shape drift parses as zero events; the cache TTL bounds how
          // long that wrong answer sticks, same trade as everywhere else.
          const events = parseEvents(await response.json());
          writeCache(TIM_EVENTS_CACHE_KEY, events);
          return events;
        } catch {
          // Origin dead or blocked: the next candidate.
        }
      }
      // Every origin failed: keep the last list that provably worked.
      return readCache<readonly TimEvent[]>(TIM_EVENTS_CACHE_KEY, () => true) ?? [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
};