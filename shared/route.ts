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
 * The app's own watch path for a match:
 * /{lang}/{sport}/{competitionSlug}-{matchId}/{matchSlug}.html
 * Shared so the alert mail's Watch now button and the app's cards build the
 * very same URL. Returns null for a match id that cannot form a route.
 */
export const matchPath = (
  sportId: number,
  slugs: { match: string; competition: string },
  matchId: number,
): string | null => {
  if (!Number.isFinite(matchId) || matchId === 0) return null;
  const sportPath = SPORT_PATH[sportId] ?? "others";
  return `/${ROUTE_LANG}/${sportPath}/${slugs.competition}-${matchId}/${slugs.match}.html`;
};
