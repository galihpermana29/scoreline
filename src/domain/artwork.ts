/**
 * Sport artwork from public/: one folder of fifteen 16:9 Unsplash shots per
 * covered sport, plus `other/` for everything else. The live feed ships no
 * per-match thumbnails, so every match borrows its sport's pool.
 *
 * Which shot a match gets is decided once per page load (`LOAD_SEED`) and
 * spread per match, so a hard refresh re-rolls the whole app while, within
 * a session, a match keeps one image everywhere it appears (card, hero,
 * watch morph, sheet backdrop).
 */

const POOL_SIZE = 15;

const numbered = (folder: string): readonly string[] =>
  Array.from({ length: POOL_SIZE }, (_, index) => `/${folder}/${folder}-${String(index + 1).padStart(2, "0")}.jpg`);

const OTHER = [
  "motogp",
  "motogp",
  "boxing",
  "boxing",
  "sumo",
  "mma",
  "golf",
  "baseball",
  "hockey",
  "rugby",
  "cycling",
  "swimming",
  "athletics",
  "cricket",
  "americanfootball",
].map((name, index) => `/other/other-${String(index + 1).padStart(2, "0")}-${name}.jpg`);

const otherNamed = (...names: string[]): readonly string[] => OTHER.filter((path) => names.some((name) => path.endsWith(`-${name}.jpg`)));

/** Feed sport id → the shots that fit it. Unknown ids draw from all of `other/`. */
const POOLS: Record<number, readonly string[]> = {
  1: numbered("football"),
  2: numbered("nba"),
  3: numbered("tennis"),
  4: otherNamed("baseball"),
  6: otherNamed("cricket"),
  7: numbered("formula1"),
  8: otherNamed("rugby"),
  9: otherNamed("americanfootball"),
  11: otherNamed("hockey"),
  12: numbered("badminton"),
  13: numbered("volleyball"),
  14: otherNamed("boxing", "mma", "sumo"),
  15: otherNamed("cycling"),
};

/**
 * The feed's misc bucket (sport 90) mixes golf, table tennis, horse racing
 * and whatever else is on; a keyword in the fixture or competition name can
 * still steer it to a fitting `other/` shot.
 */
const HINTS: readonly [RegExp, readonly string[]][] = [
  [/\bgolf\b|\bl?pga\b|\bdp world tour\b|\basian tour\b/i, ["golf"]],
  [/\bmoto\s?gp\b|\bmoto[23]\b|\bsuperbike\b|\bsbk\b/i, ["motogp"]],
  [/\bboxing\b|\bpromotions\b|\bbkfc\b/i, ["boxing"]],
  [/\bmma\b|\bufc\b|\bfights?\b|\bknockout\b|\bmuay\b/i, ["mma", "boxing"]],
  [/\bsumo\b/i, ["sumo"]],
  [/\bswim/i, ["swimming"]],
  [/\bathletics\b|\bmarathon\b|\bdiamond league\b/i, ["athletics"]],
  [/\bhockey\b|\bnhl\b|\bkhl\b/i, ["hockey"]],
  [/\brugby\b|\bnpc\b|\bsuper rugby\b/i, ["rugby"]],
  [/\bcricket\b|\bt20\b|\bodi\b|\bipl\b/i, ["cricket"]],
  [/\bcycling\b|\buci\b|\btour de\b/i, ["cycling"]],
  [/\bbaseball\b|\bmlb\b|\bnpb\b|\bkbo\b/i, ["baseball"]],
  [/\bnfl\b|\bamerican football\b/i, ["americanfootball"]],
];

const hintedPool = (hint: string): readonly string[] | null => {
  const found = HINTS.find(([pattern]) => pattern.test(hint));
  return found === undefined ? null : otherNamed(...found[1]);
};

export const sportPool = (sportId: number, hint?: string): readonly string[] => {
  const pool = POOLS[sportId];
  if (pool !== undefined) return pool;
  return (hint === undefined ? null : hintedPool(hint)) ?? OTHER;
};

/** Rolled once per page load; a hard refresh gives every sport a new shot. */
const LOAD_SEED = Math.floor(Math.random() * POOL_SIZE);

/** Small string hash so matches of one sport spread across its pool. */
const hash = (key: string): number => {
  let value = 0;
  for (let index = 0; index < key.length; index += 1) value = (value * 31 + key.charCodeAt(index)) >>> 0;
  return value;
};

/**
 * Artwork for a sport. With a `key` (match id) the pick is spread across the
 * pool; without one it is the load's own shot - used for category banners.
 * `hint` (fixture + competition names) only matters for uncovered sports.
 */
export const sportThumb = (sportId: number, key?: string, hint?: string): string => {
  const pool = sportPool(sportId, hint);
  const offset = key === undefined ? 0 : hash(key);
  return pool[(LOAD_SEED + offset) % pool.length] ?? pool[0] ?? OTHER[0]!;
};

/** The multi-sport fallback for surfaces with no sport at all (promo slot, "Other" category). */
export const otherThumb = (key?: string): string => sportThumb(-1, key);
