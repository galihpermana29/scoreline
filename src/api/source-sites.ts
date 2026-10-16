import { resolveRedirect } from "./redirect";

/**
 * Runtime discovery of the source network's rotating hosts (2026-10-16).
 *
 * The operator rotates domains as they get blocked: the main entry domain
 * moves roughly one generation per burn (a path-preserving Cloudflare 301
 * to the next domain), and the protobuf feed host can move with it. Every hardcoded origin is therefore a time bomb, so nothing in
 * this app hardcodes one for actual use - everything resolves through here.
 *
 * Two rotation facts drive the design (both verified live 2026-10-16):
 *
 * - The family serves the same site from several hosts at once: several
 *   domains answer 200 directly with the same routing and the same content.
 *   A plain browser fetch can verify any of them - their pages send
 *   Access-Control-Allow-Origin: * - and for a same-site CORS response,
 *   response.url reports the final URL even after redirects.
 * - Old-generation hosts answer with 301s that do NOT carry ACAO, so the
 *   browser blocks the whole cross-origin chain on them. Only the
 *   server-side resolver (see the plugin in vite.config.ts) can walk those.
 *   It is a dev middleware today; in production the direct-serving hosts
 *   above are what keep the app alive, and the resolver becomes optional.
 *
 * Resolutions are cached in localStorage with a TTL so the happy path costs
 * nothing, and a stale entry is still preferred over the compiled-in default
 * because it is the last thing that provably worked.
 */

/**
 * Feed path on any data host. Stable across generations so far: the
 * `sfver%3Ctoken%3E` segment is ignored by the backend (the placeholder from
 * the originally discovered URL still answers today), so only the host moves.
 */
export const FEED_PATH = "/sfver%3Ctoken%3E/api/match/live";

/**
 * The last-resort fallback host lists, served by the dev middleware
 * (`/api/config`) out of the gitignored `.env`. The client bundle contains
 * no hostname at all: discovery from the entry page and the params API is
 * the real path, these lists only seed the very first resolution, and a
 * deployment without the middleware simply runs on discovery + caches.
 */
type ServerDefaults = {
  entryHosts: readonly string[];
  redirectingEntryHosts: readonly string[];
  apiHosts: readonly string[];
  playerHosts: readonly string[];
};

const EMPTY_DEFAULTS: ServerDefaults = { entryHosts: [], redirectingEntryHosts: [], apiHosts: [], playerHosts: [] };

let serverDefaults: Promise<ServerDefaults> | null = null;

const loadServerDefaults = (): Promise<ServerDefaults> => {
  serverDefaults ??= fetch("/api/config", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Config endpoint answered ${response.status}.`);
      return response.json() as Promise<Partial<ServerDefaults>>;
    })
    .then((config): ServerDefaults => ({ ...EMPTY_DEFAULTS, ...config }))
    .catch(() => {
      // No middleware deployed (static build): discovery-only from here on.
      serverDefaults = null;
      return EMPTY_DEFAULTS;
    });
  return serverDefaults;
};

/** Path probed on entry hosts; any language root proves the site is served. */
const ENTRY_PROBE_PATH = "/id";

const ENTRY_CACHE_KEY = "scoreline:entry-origin";
const API_HOSTS_CACHE_KEY = "scoreline:api-hosts";
/** Cached resolutions stay fresh for 10 minutes; probes cost real requests. */
const CACHE_TTL_MS = 10 * 60_000;

type Cached<T> = { at: number; value: T };

const readCache = <T>(key: string, maxAge: (age: number) => boolean): T | null => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const entry = JSON.parse(raw) as Partial<Cached<T>>;
    if (entry.value === undefined || typeof entry.at !== "number") return null;
    if (!maxAge(Date.now() - entry.at)) return null;
    return entry.value;
  } catch {
    return null;
  }
};

const writeCache = <T>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), value } satisfies Cached<T>));
  } catch {
    // Storage unavailable (private mode): resolution just runs uncached.
  }
};

const clearCache = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Same as above - nothing to do.
  }
};

/** The cached entry origin if still fresh, null otherwise. */
export const cachedEntryOrigin = (): string | null => readCache<string>(ENTRY_CACHE_KEY, (age) => age < CACHE_TTL_MS);

/** The cached player-host list if still fresh, null otherwise. */
export const cachedPlayerHosts = (): readonly string[] | null =>
  readCache<string[]>(PLAYER_HOSTS_CACHE_KEY, (age) => age < CACHE_TTL_MS);

const staleEntryOrigin = (): string | null => readCache<string>(ENTRY_CACHE_KEY, () => true);

/**
 * Proves an entry host serves the site with a plain browser fetch. The fetch
 * follows redirects transparently; for a CORS-passed chain response.url is
 * the final URL, so a host that silently rotated (or a serving subdomain)
 * resolves to where it actually lands. The body is cancelled so the probe
 * costs one response header round-trip, not a page download.
 */
const probeEntryHost = async (origin: string): Promise<string | null> => {
  try {
    const response = await fetch(`${origin}${ENTRY_PROBE_PATH}`, { redirect: "follow", cache: "no-store" });
    const { url, ok } = response;
    await response.body?.cancel().catch(() => undefined);
    return ok ? new URL(url).origin : null;
  } catch {
    return null; // Network refusal or a CORS-blocked redirect chain: dead to us.
  }
};

/** In-flight resolution dedupe so parallel consumers trigger one probe set. */
let entryResolution: Promise<string> | null = null;

/**
 * The origin of the source site's entry pages, whichever generation is
 * currently alive. Never throws: every path degrades to the last known
 * origin and finally to the env-seeded default, so callers always have a
 * usable string even while the network is down.
 */
export const resolveEntryOrigin = async (fresh = false): Promise<string> => {
  if (!fresh) {
    const cached = cachedEntryOrigin();
    if (cached !== null) return cached;
    if (entryResolution !== null) return entryResolution;
  }
  entryResolution = (async () => {
    const defaults = await loadServerDefaults();
    // Stale cache first - it is the most likely host to still be alive -
    // then the direct-serving family hosts in generation order.
    const browserCandidates = [staleEntryOrigin(), ...defaults.entryHosts].flatMap((host) =>
      host === null || host === undefined || host === "" ? [] : [host],
    );
    for (const candidate of new Set(browserCandidates)) {
      const origin = await probeEntryHost(candidate);
      if (origin !== null) {
        writeCache(ENTRY_CACHE_KEY, origin);
        return origin;
      }
    }

    // Every directly served host is unreachable from here. Old-generation
    // hosts 301 to the current generation without ACAO, invisible to this
    // fetch, so walk them server-side where that redirect chain is visible.
    // The resolver is a dev middleware; when it is absent this simply skips.
    const serverCandidates = [staleEntryOrigin(), ...defaults.redirectingEntryHosts].flatMap((host) =>
      host === null || host === undefined || host === "" ? [] : [host],
    );
    for (const candidate of new Set(serverCandidates)) {
      try {
        const resolution = await resolveRedirect(`${candidate}${ENTRY_PROBE_PATH}`);
        const last = resolution.hops.at(-1);
        if (last !== undefined && last.status >= 200 && last.status < 300) {
          const origin = new URL(resolution.finalUrl).origin;
          writeCache(ENTRY_CACHE_KEY, origin);
          return origin;
        }
      } catch {
        // Host dead, timed out, or no resolver endpoint: try the next.
      }
    }

    // Nothing answered. Keep whatever last worked, else the env default
    // (empty when no config endpoint exists - the screen shows unavailable).
    return staleEntryOrigin() ?? defaults.entryHosts[0] ?? "";
  })();
  try {
    return await entryResolution;
  } finally {
    entryResolution = null;
  }
};

/**
 * The `apis-data*` hosts the entry page itself ships as its feed failover
 * list (an inline config block, observed 2026-10-16 as escaped URLs next to
 * LAN probe hosts). The entry page is CORS-open so the browser reads it
 * directly; slashes arrive escaped as \u002F and are normalised first.
 * Falls back to the last known host list and finally the env-seeded defaults.
 */
export const resolveApiHosts = async (fresh = false): Promise<readonly string[]> => {
  if (!fresh) {
    const cached = readCache<string[]>(API_HOSTS_CACHE_KEY, (age) => age < CACHE_TTL_MS);
    if (cached !== null && cached.length > 0) return cached;
  }
  try {
    const origin = await resolveEntryOrigin();
    const response = await fetch(`${origin}${ENTRY_PROBE_PATH}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Entry page returned ${response.status}.`);
    const pageText = await response.text();
    // The config block escapes slashes as \u002F; normalise first, then
    // collect the apis-data* feed hosts (the apis-live* pair in the same
    // block answers tiny text markers, not the protobuf feed).
    const urls =
      pageText.replace(/\\u002[fF]/g, "/").match(/https:\/\/apis-data[a-z0-9-]*(?:\.[a-z0-9-]+)+/g) ?? [];
    const hosts = [...new Set(urls.map((url) => new URL(url).host))];
    if (hosts.length === 0) throw new Error("The entry page no longer lists any apis-data host.");
    writeCache(API_HOSTS_CACHE_KEY, hosts);
    return hosts;
  } catch {
    // Entry page unreachable or its shape changed: keep what last worked,
    // else the verified default pair. Per-request failover (in aelive.ts)
    // rotates across whatever list this returns.
    const stale = readCache<string[]>(API_HOSTS_CACHE_KEY, () => true);
    if (stale !== null && stale.length > 0) return stale;
    return (await loadServerDefaults()).apiHosts;
  }
};

/** Drops the api-host cache so the next resolution re-reads the entry page. */
export const resetApiHosts = (): void => clearCache(API_HOSTS_CACHE_KEY);

/**
 * Common-params path on any data host (verified 2026-10-16): answers the
 * operator's runtime config as JSON, scrambled with a printable-ASCII
 * rotation and sent with Access-Control-Allow-Origin: *, so a plain browser
 * fetch reads it. Its `common:web:client` key carries the live list of bare
 * player hosts (under `iframePlayerDomains`), which is what lets this app
 * embed the player page directly instead of the ad-wrapped match page.
 * A bare fetch with no Referer or Sec-Fetch headers gets an HTML bot stub,
 * but a normal browser fetch always carries both, so no spoofing is needed.
 */
const PARAMS_PATH = "/api/common/params";

const PLAYER_HOSTS_CACHE_KEY = "scoreline:player-hosts";

/**
 * Unscrambles the params API's rotation: every code point in 33..126 moves
 * forward by a shift within that 94-code-point window, everything else
 * (newline, CJK, emoji) passes through (verified 2026-10-16: the ciphertext
 * a sample ciphertext decodes to the family's TLD at shift 47, whose direction is
 * irrelevant because a 47-step rotation inside a 94-wide window is its own
 * inverse). The shift itself is operator-chosen, so it is treated as
 * rotating too: nothing here trusts 47 staying current.
 */
const rotatePrintable = (text: string, shift: number): string => {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    out +=
      code !== undefined && code >= 33 && code <= 126
        ? String.fromCharCode(((code - 33 + shift) % 94 + 94) % 94 + 33)
        : ch;
  }
  return out;
};

/** Shifts to try, in order: the verified one, plain JSON, then everything. */
const SHIFT_CANDIDATES: readonly number[] = [
  47, // verified live 2026-10-16
  0, // in case the scramble is dropped entirely
  ...Array.from({ length: 94 }, (_, shift) => shift).filter((shift) => shift !== 47 && shift !== 0),
];

/** Key-matching for the player-host list, tolerant of naming drift. */
const isPlayerDomainsKey = (key: string): boolean => /iframe[_-]?player[_-]?domains/i.test(key);

/**
 * Collects every player-domain entry from anywhere in the decoded params
 * object. The operator files each brand's config under its own digit key
 * (`snd`, `trd`, `foth`, ...) and nests some values as JSON strings one
 * level deep, and which key belongs to which brand has already shifted once
 * during observation - so nothing here keys off the brand layout. The whole
 * tree is walked and every player host found anywhere is unioned; a
 * re-shuffled params response keeps resolving as long as the player-domain
 * key name survives. Depth is capped because the nested-JSON walk is
 * recursive.
 */
const collectPlayerHosts = (node: unknown, into: string[], depth: number): void => {
  if (depth > 4) return;
  if (typeof node === "string") {
    const first = node.charAt(0);
    if (first !== "{" && first !== "[") return;
    try {
      collectPlayerHosts(JSON.parse(node), into, depth + 1);
    } catch {
      // An ordinary string that merely looks structured: nothing to take.
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectPlayerHosts(item, into, depth);
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (isPlayerDomainsKey(key) && Array.isArray(value)) {
      for (const host of value) if (typeof host === "string") into.push(host);
    } else {
      collectPlayerHosts(value, into, depth);
    }
  }
};

/**
 * Decodes a params response into its player hosts without trusting the
 * exact cipher: each candidate shift is applied, parsed, and only counts
 * when the parse succeeds AND yields at least one player host. A wrong
 * shift scrambles the JSON's structural characters too, so a wrong-shift
 * parse is vanishingly unlikely - and requiring a host find on top of it
 * makes a false positive harmless (it would simply find nothing and the
 * next shift would be tried). Returns null when no shift decodes the
 * response into any player host.
 */
const decodePlayerHosts = (text: string): string[] | null => {
  for (const shift of SHIFT_CANDIDATES) {
    let params: unknown;
    try {
      params = JSON.parse(rotatePrintable(text, shift));
    } catch {
      continue;
    }
    const found: string[] = [];
    collectPlayerHosts(params, found, 0);
    if (found.length > 0) return [...new Set(found)];
  }
  return null;
};

/**
 * The live bare-player hosts, from the same data hosts the feed fails over
 * across. Never throws: every path degrades to the last known list and
 * finally to the env-seeded defaults, so the player screen always has a host
 * to try while the network is still resolving (an empty list when the config
 * middleware is absent; the caller then relies on their match page).
 */
export const resolvePlayerHosts = async (fresh = false): Promise<readonly string[]> => {
  if (!fresh) {
    const cached = readCache<string[]>(PLAYER_HOSTS_CACHE_KEY, (age) => age < CACHE_TTL_MS);
    if (cached !== null && cached.length > 0) return cached;
  }
  for (const apiHost of await resolveApiHosts(fresh)) {
    try {
      const response = await fetch(`https://${apiHost}${PARAMS_PATH}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Params answered ${response.status}.`);
      const hosts = decodePlayerHosts(await response.text());
      if (hosts === null) throw new Error("Params no longer decode to any player host.");
      writeCache(PLAYER_HOSTS_CACHE_KEY, hosts);
      return hosts;
    } catch {
      // Host dead, bot-stubbed, or the response shape changed: next host.
    }
  }
  const stale = readCache<string[]>(PLAYER_HOSTS_CACHE_KEY, () => true);
  if (stale !== null && stale.length > 0) return stale;
  return (await loadServerDefaults()).playerHosts;
};

/** Drops the player-host cache so the next resolution re-reads params. */
export const resetPlayerHosts = (): void => clearCache(PLAYER_HOSTS_CACHE_KEY);
