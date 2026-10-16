import { byKickoff, isWomens, type Match } from "./match";

/**
 * A browse category: either the live cross-sport view or one sport. The top
 * five are pinned in the sidebar and drive ordering everywhere - the live
 * shelf, the leagues browse, the featured picks - so the sports the app is
 * for always surface first. Everything else the feed carries is reachable
 * from "More sports", derived from the live data rather than listed here.
 */
export type Category = {
  slug: string;
  label: string;
  title: string;
  /** Null for the cross-sport live view. */
  sportId: number | null;
  /** The feed's own sport label, used to match rows (null for live). */
  sport: string | null;
  blurb: string;
};

export const TOP_CATEGORIES: readonly Category[] = [
  {
    slug: "live",
    label: "Live",
    title: "Live Now",
    sportId: null,
    sport: null,
    blurb: "Everything in play right now, across every sport in the feed.",
  },
  {
    slug: "football",
    label: "Football",
    title: "Football",
    sportId: 1,
    sport: "Football",
    blurb: "Leagues, cups and internationals from every corner of the game.",
  },
  {
    slug: "badminton",
    label: "Badminton",
    title: "Badminton",
    sportId: 12,
    sport: "Badminton",
    blurb: "World Tour sessions and championship courts, court by court.",
  },
  {
    slug: "basketball",
    label: "Basketball",
    title: "Basketball",
    sportId: 2,
    sport: "Basketball",
    blurb: "The NBA, EuroLeague and national leagues, tip-off to buzzer.",
  },
  {
    slug: "f1",
    label: "F1",
    title: "F1 & Motorsport",
    sportId: 7,
    sport: "Motorsport",
    blurb: "Grands Prix and the wider motorsport calendar the feed carries - the source groups them together.",
  },
];

const PRIORITY = new Map<number, number>(
  TOP_CATEGORIES.flatMap((category, index) => (category.sportId === null ? [] : [[category.sportId, index]])),
);

/** Lower is more important; sports outside the top five share one tail rank. */
export const sportPriority = (sportId: number | undefined): number =>
  sportId === undefined ? PRIORITY.size + 1 : (PRIORITY.get(sportId) ?? PRIORITY.size + 1);

/**
 * Priority band for shelf ordering. The front of the app is "top categories
 * + men's": a women's fixture never rides its sport's pinned band, whatever
 * the sport - it sinks to the shared tail with the unpinned sports and
 * orders by kick-off there. Narrow misses ("if it's women it's not priority")
 * are preferred to broad ones, so `isWomens` errs towards flagging.
 */
export const matchBand = (match: Match): number => (isWomens(match) ? PRIORITY.size + 1 : sportPriority(match.sportId));

/** Top-category men's first (in sidebar order), then everything else by kick-off. */
export const byPriority = (a: Match, b: Match): number =>
  matchBand(a) - matchBand(b) || byKickoff(a, b);

export const sportSlug = (sport: string): string =>
  sport
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Every sport in the feed that is not already a pinned category, as categories. */
export const extraCategories = (matches: readonly Match[]): Category[] => {
  const pinned = new Set(TOP_CATEGORIES.map((category) => category.sport));
  const seen = new Map<string, { sportId: number | undefined; count: number }>();
  for (const match of matches) {
    if (pinned.has(match.sport)) continue;
    const entry = seen.get(match.sport) ?? { sportId: match.sportId, count: 0 };
    entry.count += 1;
    seen.set(match.sport, entry);
  }
  return [...seen.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([sport, { sportId }]) => ({
      slug: sportSlug(sport),
      label: sport,
      title: sport,
      sportId: sportId ?? null,
      sport,
      blurb: `Every ${sport.toLowerCase()} event the feed is carrying right now.`,
    }));
};

/** Resolves a category slug against the pinned set first, then the feed's extra sports. */
export const categoryForSlug = (slug: string, matches: readonly Match[]): Category | null =>
  TOP_CATEGORIES.find((category) => category.slug === slug) ??
  extraCategories(matches).find((category) => category.slug === slug) ??
  null;

export const categoryForSport = (sport: string, matches: readonly Match[]): Category | null =>
  TOP_CATEGORIES.find((category) => category.sport === sport) ??
  extraCategories(matches).find((category) => category.sport === sport) ??
  null;

export const inCategory = (match: Match, category: Category): boolean =>
  category.sport === null ? match.status.kind === "live" : match.sport === category.sport;
