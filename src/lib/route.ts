import type { Match } from "../domain/match";

/**
 * Static sportId -> path segment map, mirroring the feed's own routing scheme
 * (1 football, 2 basketball, 3 tennis, 4 baseball, 11 hockey, 12 badminton,
 * 13 volleyball, 16 handball, 90 everything else). Extensions beyond the
 * verified set use the obvious english sport name so simulated paths read well.
 */
const SPORT_PATH: Record<number, string> = {
  1: "football",
  2: "basketball",
  3: "tennis",
  4: "baseball",
  6: "cricket",
  8: "rugby",
  9: "american-football",
  10: "aussie-rules",
  11: "hockey",
  12: "badminton",
  13: "volleyball",
  14: "combat-sports",
  16: "handball",
  90: "others",
};

/** The feed is consumed in Indonesian, matching the source site's default. */
const ROUTE_LANG = "id";

/**
 * The real site's entry origin is not hardcoded anywhere: the operator
 * rotates generations (***REMOVED***17.lol -> ***REMOVED***18.casa, observed
 * 2026-10-16), so every consumer resolves the live origin through
 * src/api/source-sites.ts and passes it in here. Deep links are served from
 * any live generation, so resolving a route against the resolved origin
 * lands on a working page regardless of which generation a bookmark came
 * from.
 */
/** Absolute URL of a route path on the given source-site origin. */
export const sourceUrl = (routePath: string, origin: string): string => `${origin}${routePath}`;

export type MatchRoute = {
  lang: string;
  sportPath: string;
  competitionSlug: string;
  matchSlug: string;
  matchId: number;
};

const stripId = (match: Match): number => {
  const suffix = Number(match.id.split("-").at(-1));
  return Number.isFinite(suffix) ? suffix : 0;
};

/**
 * Build the internal simulated player path for a match:
 * /{lang}/{sport}/{competitionSlug}-{matchId}/{matchSlug}.html
 * Returns null when the feed didn't ship the SEO slugs for this match.
 */
export const matchHref = (match: Match): string | null => {
  if (match.sportId === undefined || !match.slugs) return null;
  const sportPath = SPORT_PATH[match.sportId] ?? "others";
  const id = stripId(match);
  if (id === 0) return null;
  return `/${ROUTE_LANG}/${sportPath}/${match.slugs.competition}-${id}/${match.slugs.match}.html`;
};

/** True when a match has everything needed to open the simulated stream. */
export const canWatch = (match: Match): boolean => matchHref(match) !== null;

const MATCH_ROUTE = /^\/(\w+)\/([\w-]+)\/([\w-]+)-(\d+)\/([\w-]+)\.html$/;

/**
 * Recognise a deep link of the form
 * /{lang}/{sport}/{competitionSlug}-{matchId}/{matchSlug}.html
 * anywhere under this origin. Returns null for normal app paths.
 */
export const parseMatchRoute = (pathname: string): MatchRoute | null => {
  const hit = MATCH_ROUTE.exec(pathname);
  if (hit === null) return null;
  const [lang, sportPath, competitionSlug, idText, matchSlug] = hit.slice(1);
  if (!lang || !sportPath || !competitionSlug || !idText || !matchSlug) return null;
  return { lang, sportPath, competitionSlug, matchId: Number(idText), matchSlug };
};