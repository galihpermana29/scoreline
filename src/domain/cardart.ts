import type { Match } from "./match";

/**
 * Flat CSS thumbnails for match cards - the "ARSENAL / PREMIER LEAGUE" style
 * (agreed 2026-10-17): a solid colour field with a big identity line and a
 * small context line, rendered as DOM instead of an image. Hero, jumbotron,
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
 *   Racing" label, so a golf round in that bucket reads HORSE RACING here.
 * - Type: the big line's size ceiling is the "MANCHESTER CITY" card, per the
 *   user (2026-10-17) - short names render that size, long names step down.
 * - Colour: twelve club themes (background, title ink, subtitle ink, and an
 *   optional accent bar), sampled from the user's reference cards in
 *   public/football/primary-thumbnails/. A popular club always wears its
 *   own theme; every other card rolls one of the twelve once per page load,
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

const THEMES = {
  arsenal: { bg: "#ef0107", ink: "#ffffff", sub: "#fab3b5" },
  chelsea: { bg: "#034694", ink: "#ffffff", sub: "#b4c8df" },
  liverpool: { bg: "#c8102e", ink: "#ffffff", sub: "#efb8c1", bar: "#f6eb61" },
  manUnited: { bg: "#111111", ink: "#da291c", sub: "#b8b8b8", bar: "#fbe122" },
  manCity: { bg: "#6cabdd", ink: "#1c2c5b", sub: "#345282" },
  tottenham: { bg: "#f4f3ef", ink: "#132257", sub: "#7c7c7a" },
  realMadrid: { bg: "#3d195b", ink: "#febe10", sub: "#c5bace" },
  barcelona: { bg: "#a50044", ink: "#edbb00", sub: "#e4b3c7" },
  atletico: { bg: "#272e61", ink: "#e03a3e", sub: "#bfc1d0" },
  psg: { bg: "#004170", ink: "#ffffff", sub: "#b3c6d4", bar: "#da291c" },
  bayern: { bg: "#dc052d", ink: "#ffffff", sub: "#f5b4c0", bar: "#ffffff" },
  other: { bg: "#1f2933", ink: "#ffffff", sub: "#bcbfc2" },
} as const satisfies Record<string, ThumbTheme>;

/** Hue-alternating order, so the four reds never land side by side. */
const THEME_ROTATION: readonly ThumbTheme[] = [
  THEMES.manCity,
  THEMES.arsenal,
  THEMES.chelsea,
  THEMES.barcelona,
  THEMES.tottenham,
  THEMES.liverpool,
  THEMES.realMadrid,
  THEMES.manUnited,
  THEMES.psg,
  THEMES.bayern,
  THEMES.other,
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