import { isEmptyFeedAnswer, parseFeed, type RawFeed } from "../shared/feed";

/**
 * Server-side access to the source network: host discovery and the feed
 * fetch. Not a Convex function module - plain helpers the cron actions share.
 * The path and parameters are the client's (FEED_PATH, language=8, stream=false).
 */

export const FEED_PATH = "/sfver%3Ctoken%3E/api/match/live";
const LANGUAGE = 8;
const REQUEST_TIMEOUT_MS = 12_000;

/** Cloudflare rate-limits bursts, so requests to the feed are spaced at least this far apart. */
export const REQUEST_SPACING_MS = 1700;

/** The operator's hosts answer best to browser-like clients, so the cron identifies as a desktop browser. */
const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  accept: "*/*",
} as const;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const envList = (name: string): string[] =>
  (process.env[name] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

const bareHost = (entry: string): string => entry.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const originOf = (entry: string): string => (/^https?:\/\//.test(entry) ? entry.replace(/\/$/, "") : `https://${entry}`);

/** SCORELINE_API_HOSTS from the Convex env: the last-resort fallback when discovery has nothing. */
export const fallbackHosts = (): string[] => envList("SCORELINE_API_HOSTS").map(bareHost);

/**
 * Discovers the feed hosts the way `resolveApiHosts` does in the browser:
 * read an entry page from SCORELINE_ENTRY_HOSTS and extract the `apis-data`
 * hosts from its inline config block (slashes arrive escaped as /).
 * Returns null when no entry host yields any, so the caller keeps what it had.
 */
export const discoverHosts = async (): Promise<string[] | null> => {
  for (const entry of envList("SCORELINE_ENTRY_HOSTS")) {
    try {
      const response = await fetch(`${originOf(entry)}/id`, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const pageText = (await response.text()).replace(/\\u002[fF]/g, "/");
      const urls = pageText.match(/https:\/\/apis-data[a-z0-9-]*(?:\.[a-z0-9-]+)+/g) ?? [];
      const hosts = [...new Set(urls.map((url) => new URL(url).host))];
      if (hosts.length > 0) return hosts;
    } catch {
      // This entry host is down or rotated: try the next one.
    }
  }
  return null;
};

export type FeedResult =
  | { kind: "data"; feed: RawFeed; host: string }
  | { kind: "empty"; host: string }
  | { kind: "failed"; error: string };

/**
 * Fetches one sport's feed, failing over across the host list.
 * - 200 with a protobuf content type is data.
 * - 499 with an empty PBMatchLiveResp is "no data for this sport right now": not a failure.
 * - anything else (connection error, non-protobuf answer, other status) fails over to the next host.
 */
export const fetchFeed = async (hosts: readonly string[], sportType: number): Promise<FeedResult> => {
  let lastError = "No feed host configured.";
  for (const host of hosts) {
    try {
      const response = await fetch(`https://${host}${FEED_PATH}?sportType=${sportType}&language=${LANGUAGE}&stream=false`, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const type = response.headers.get("content-type") ?? "";
      if (response.status === 200 && type.includes("protobuf")) {
        return { kind: "data", feed: parseFeed(new Uint8Array(await response.arrayBuffer())), host };
      }
      if (response.status === 499 && isEmptyFeedAnswer(response.status, await response.text())) {
        return { kind: "empty", host };
      }
      lastError = `${host} answered ${response.status} ${type || "with an unknown type"}.`;
    } catch (error) {
      lastError = `${host}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return { kind: "failed", error: lastError };
};

/** A GET against the league endpoints, which answer plain protobuf to a browser-UA fetch. */
export const fetchLeagueBytes = async (hosts: readonly string[], path: string): Promise<Uint8Array | null> => {
  for (const host of hosts) {
    try {
      const response = await fetch(`https://${host}${path}`, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 200 && (response.headers.get("content-type") ?? "").includes("protobuf")) {
        return new Uint8Array(await response.arrayBuffer());
      }
    } catch {
      // Next host.
    }
  }
  return null;
};
