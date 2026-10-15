import { resolveRedirect } from "./redirect";

/**
 * Runtime discovery of the source network's rotating hosts (2026-10-16).
 *
 * The operator rotates domains as they get blocked: the main entry domain
 * moves roughly one generation per burn (***REMOVED***17.lol -> ***REMOVED***18.casa
 * was a path-preserving Cloudflare 301), and the protobuf feed host can move
 * with it. Every hardcoded origin is therefore a time bomb, so nothing in
 * this app hardcodes one for actual use - everything resolves through here.
 *
 * Two rotation facts drive the design (both verified live 2026-10-16):
 *
 * - The family serves the same site from several hosts at once:
 *   www.***REMOVED***.io and www.rbtv77.ru answer 200 directly with the same
 *   routing and the same content, and the Superabbit77 twins serve from
 *   their own site04.* subdomains. A plain browser fetch can verify any of
 *   them - their pages send Access-Control-Allow-Origin: * - and for a
 *   same-site CORS response, response.url reports the final URL even after
 *   redirects.
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

/** Hosts verified serving the protobuf feed right now (2026-10-16). */
export const DEFAULT_API_HOSTS = ["apis-data10.***REMOVED***.ru", "apis-data-defra10.***REMOVED***.ru"] as const;

/**
 * Entry hosts that answer 200 directly (no redirect), verified 2026-10-16.
 * All serve the same site, the same deep-link routing, and CORS-open pages,
 * so a browser fetch both verifies the host and yields its final URL.
 */
const DIRECT_ENTRY_HOSTS = [
  "https://www.***REMOVED***18.casa",
  "https://www.***REMOVED***.io",
  "https://www.rbtv77.ru",
  "https://site04.***REMOVED***77hd.skin",
  "https://site04.***REMOVED***77.my",
] as const;

/**
 * Compiled-in fallback origin: the current generation at the time of the
 * last verification (2026-10-16). Only used before the first successful
 * resolution; after that the cache and discovery take over.
 */
export const DEFAULT_ENTRY_ORIGIN_FALLBACK: string = DIRECT_ENTRY_HOSTS[0];

/**
 * Old-generation entry hosts that answer 301 to the current generation. The
 * 301 responses carry no ACAO, so browsers refuse the cross-origin chain and
 * these can only be walked server-side (see the redirect resolver).
 */
const REDIRECTING_ENTRY_HOSTS = [
  "https://www.***REMOVED***17.lol",
  "https://www.***REMOVED***.com",
  "https://***REMOVED***77hd.skin",
  "https://***REMOVED***77.my",
] as const;

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
 * origin and finally to the compiled-in default, so callers always have a
 * usable string even while the network is down.
 */
export const resolveEntryOrigin = async (fresh = false): Promise<string> => {
  if (!fresh) {
    const cached = cachedEntryOrigin();
    if (cached !== null) return cached;
    if (entryResolution !== null) return entryResolution;
  }
  entryResolution = (async () => {
    // Stale cache first - it is the most likely host to still be alive -
    // then the direct-serving family hosts in generation order.
    const browserCandidates = [staleEntryOrigin(), ...DIRECT_ENTRY_HOSTS].flatMap((host) =>
      host === null ? [] : [host],
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
    const serverCandidates = [staleEntryOrigin(), ...REDIRECTING_ENTRY_HOSTS].flatMap((host) =>
      host === null ? [] : [host],
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

    // Nothing answered. Keep whatever last worked, else the compiled default.
    return staleEntryOrigin() ?? DIRECT_ENTRY_HOSTS[0];
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
 * Falls back to the last known host list and finally the verified defaults.
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
    return stale !== null && stale.length > 0 ? stale : DEFAULT_API_HOSTS;
  }
};

/** Drops the api-host cache so the next resolution re-reads the entry page. */
export const resetApiHosts = (): void => clearCache(API_HOSTS_CACHE_KEY);
