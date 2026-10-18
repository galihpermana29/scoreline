import type { Match } from "./match";

/**
 * Flat CSS thumbnails for match cards. The big line is capitalized
 * ("Arsenal", "Basketball") and the small line stays uppercase
 * ("PREMIER LEAGUE"), rendered as DOM instead of an image. Hero, jumbotron,
 * watch backdrops and the promo slot keep the photo pools (`artwork.ts`);
 * this module only powers the 16:9 shelf cards.
 *
 * Content rules:
 * - Football: a popular club (exact feed-team-id match, home side first)
 *   shows the club's canonical spelling big; otherwise the home side's feed
 *   name. The small line is the competition, canonical for the mapped top
 *   leagues so cards read "PREMIER LEAGUE" instead of the feed's Italianised
 *   "Liga Utama Inggris".
 * - Other sports: the sport label big, the fixture (or session title) small.
 *   Residual: sport 90 is the feed's whole misc bucket behind the "Horse
 *   Racing" label, so a golf round in that bucket reads "Horse Racing" here.
 * - Type: the big line's size ceiling is the "MANCHESTER CITY" card, per the
 *   user (2026-10-17) - short names render that size, long names step down.
 * - Colour: the finish swatches on the iPhone lineup cards at
 *   apple.com/id/iphone (sampled 2026-10-18). Light finishes take Apple's
 *   dark label pair, dark finishes the light pair. A popular club always
 *   wears the same finish; every other card rolls one once per page load,
 *   spread per match - the same card keeps its colours across the 60s feed
 *   re-renders, and a hard refresh re-rolls everything (the same feel the
 *   photo pools already have via artwork's LOAD_SEED).
 */

export type ThumbTheme = {
  bg: string;
  /** The big line. */
  ink: string;
  /** The small line - each theme's own muted tone, not an opacity. */
  sub: string;
  /** Short rule between the two lines, on the themes that carry one. */
  bar?: string;
};

/** Apple's label pair on a light tile, and the light pair on a dark tile. */
const ON_LIGHT = { ink: "#1d1d1f", sub: "#6e6e73" } as const;
const ON_DARK = { ink: "#f5f5f7", sub: "#86868b" } as const;

const light = (bg: string): ThumbTheme => ({ bg, ...ON_LIGHT });
const dark = (bg: string): ThumbTheme => ({ bg, ...ON_DARK });

/**
 * Finishes from the lineup cards, in the order their swatches appear.
 * Ultramarine, iPhone 18 Pro red, sage, iPhone Duo night sky, pink,
 * iPhone Air black, teal, graphite, mist blue, 17e blush, lavender, Air gold.
 */
const THEMES = {
  arsenal: dark("#4d1821"),
  chelsea: light("#93a5eb"),
  liverpool: light("#eda8d5"),
  manUnited: dark("#394452"),
  manCity: light("#8ca6c9"),
  tottenham: light("#fffcf2"),
  realMadrid: light("#dac9e6"),
  barcelona: light("#fce7e6"),
  atletico: dark("#353839"),
  psg: light("#abcfcd"),
  bayern: light("#a4b084"),
  other: dark("#000000"),
} as const satisfies Record<string, ThumbTheme>;

/** Light and dark finishes alternate, so two pale cards never sit together. */
const THEME_ROTATION: readonly ThumbTheme[] = [
  THEMES.chelsea,
  THEMES.arsenal,
  THEMES.bayern,
  THEMES.manUnited,
  THEMES.liverpool,
  THEMES.other,
  THEMES.psg,
  THEMES.atletico,
  THEMES.manCity,
  THEMES.arsenal,
  THEMES.realMadrid,
  THEMES.manUnited,
  THEMES.barcelona,
  THEMES.other,
  THEMES.tottenham,
  THEMES.atletico,
];

/** Verified stable feed team ids (2026-10-17, see AGENTS.md dated facts). */
const POPULAR_CLUBS: Record<string, { name: string; theme: ThumbTheme }> = {
  "206665": { name: "Arsenal", theme: THEMES.arsenal },
  "206661": { name: "Chelsea", theme: THEMES.chelsea },
  "206651": { name: "Liverpool", theme: THEMES.liverpool },
  "206653": { name: "Manchester United", theme: THEMES.manUnited },
  "206662": { name: "Manchester City", theme: THEMES.manCity },
  "206664": { name: "Tottenham Hotspur", theme: THEMES.tottenham },
  "206725": { name: "Real Madrid", theme: THEMES.realMadrid },
  "206768": { name: "FC Barcelona", theme: THEMES.barcelona },
  "206707": { name: "Atlético Madrid", theme: THEMES.atletico },
  "206822": { name: "Paris Saint-Germain", theme: THEMES.psg },
  "206764": { name: "Bayern München", theme: THEMES.bayern },
};

/** The top league ids already keyed for live ordering (`categories.ts`). */
const LEAGUE_NAMES: Record<string, string> = {
  "4356": "Premier League",
  "4400": "LALIGA",
  "4387": "Serie A",
  "4411": "Bundesliga",
  "4426": "Ligue 1",
  "5078": "UEFA Champions League",
};

/** Rolled once per page load; a hard refresh re-rolls every card's colour. */
const LOAD_SEED = Math.floor(Math.random() * THEME_ROTATION.length);

/**
 * Themes are dealt in the order matches are first drawn, which is shelf
 * order, so neighbouring cards always differ (a hash clustered several
 * same-red cards together). Remembered per match id, so a fixture keeps
 * its colour in every shelf and across feed re-renders for the session.
 */
const dealt = new Map<string, ThumbTheme>();

const rotationTheme = (matchId: string): ThumbTheme => {
  const known = dealt.get(matchId);
  if (known !== undefined) return known;
  const theme = THEME_ROTATION[(LOAD_SEED + dealt.size) % THEME_ROTATION.length] ?? THEMES.other;
  dealt.set(matchId, theme);
  return theme;
};

/**
 * Font-size tier for the big line: the user-set ceiling is the size the
 * "MANCHESTER CITY" card renders at (verified screenshot 2026-10-17), so no
 * card ever goes bigger - short names use it, long names step down so a
 * single word never wrapping stays guaranteed. Multi-word names wrap on
 * spaces only, never mid-word.
 */
const tierFor = (text: string): "md" | "sm" => (text.toUpperCase().length <= 16 ? "md" : "sm");

export type ThumbPlan = {
  theme: ThumbTheme;
  /** Big identity line: club, or sport, or home side. */
  big: string;
  /** Small context line: competition, or fixture, defined as-is. */
  small: string;
  /** Typography tier for `big` - the CSS owns the actual sizes. */
  tier: "md" | "sm";
};

const stripClubSuffix = (name: string): string => name.replace(/\s+(FC|CF|SC|AC|AFC)\b/gi, "").trim();

/**
 * What one match's card shows. Same match, same plan for the whole session
 * (the rotated colour is dealt once and remembered), so a fixture reads
 * identically in every shelf.
 */
export const thumbPlan = (match: Match): ThumbPlan => {
  if (match.sportId === 1) {
    const club = POPULAR_CLUBS[match.home.id] ?? POPULAR_CLUBS[match.away.id];
    const big = club?.name ?? (stripClubSuffix(match.home.name) || match.home.name);
    const small = LEAGUE_NAMES[match.league.id] ?? match.league.name;
    return { theme: club?.theme ?? rotationTheme(match.id), big, small, tier: tierFor(big) };
  }
  const big = match.sport;
  const small = match.titleOnly === true ? match.home.name : `${match.home.name} vs ${match.away.name}`;
  return { theme: rotationTheme(match.id), big, small, tier: tierFor(big) };
};