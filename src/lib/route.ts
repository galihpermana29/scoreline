import { matchPath } from "../../shared/route";
import type { Match } from "../domain/match";

/**
 * The real site's entry origin is not hardcoded anywhere: the operator
 * rotates generations (one host generation rotating to the next, observed
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
 * The internal simulated player path for a match (see matchPath in
 * shared/route.ts). Returns null when the feed didn't ship the SEO slugs.
 */
export const matchHref = (match: Match): string | null => {
  if (match.sportId === undefined || !match.slugs) return null;
  return matchPath(match.sportId, match.slugs, stripId(match));
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