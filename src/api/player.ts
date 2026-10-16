import { probePlayerUrl } from "./probe";

/**
 * Direct bare-player embedding (reverse-engineered 2026-10-16).
 *
 * Their mirror pages do not stream anything themselves: each one embeds a
 * dedicated player page at
 * `https://{playerHost}/{lang}/player.html?mdata={base64}&ilang={lang}`,
 * discovered live from the params API (see resolvePlayerHosts in
 * source-sites.ts). That player page is the whole stream - an xgplayer shell
 * that fetches the stream list itself - without the match page's banner ads,
 * so embedding it directly is the clean path to a full-size player.
 *
 * Both facts below were verified live against a football (4439092_1) and a
 * basketball (2244615_2) match:
 *
 * - `mdata` is just the base64 of `{matchId}_{sportType}`, so it is
 *   constructible straight from the feed's own match data.
 * - The player page's gate is not a domain whitelist: it 401s only when the
 *   request lacks a Referer (re-verified 2026-10-16: a server-side request
 *   with any Referer, even without Sec-Fetch metadata, gets the 200 the
 *   browser gets). A browser embedding this URL as an iframe sends a Referer
 *   automatically - this app's own localhost origin passes - and the
 *   response carries no X-Frame-Options or frame-ancestors at all, so any
 *   origin may frame it. The iframe below must therefore never set
 *   referrerpolicy="no-referrer".
 *
 * One failure stays invisible from the outside (verified live): a malformed
 * `mdata` still answers 200, because the player shell parses it client-side.
 * So no external probe can tell a good mdata from a broken one; if the
 * operator ever changes the mdata shape, the page will mount and their own
 * player script will fail to boot. The prober below catches gate and host
 * failures, and the watch screen's page-embed fallback is the honest answer
 * for a mdata change, since their own match page constructs its embed with
 * their current code.
 */

export type PlayerSource = {
  /** Bare player host, from resolvePlayerHosts. */
  host: string;
  /** Language segment shared with the mirror routing, e.g. "id". */
  lang: string;
  /** Numeric feed match id, e.g. 2244615. */
  matchId: number;
  /** Numeric feed sport id, e.g. 2 for basketball. */
  sportType: number;
};

/** Absolute URL of the bare player page for one match. */
export const playerUrl = ({ host, lang, matchId, sportType }: PlayerSource): string => {
  const mdata = btoa(`${matchId}_${sportType}`);
  return `https://${host}/${lang}/player.html?mdata=${mdata}&ilang=${lang}`;
};

/** What pickPlayerUrl decided for one match. */
export type PlayerPick =
  | { kind: "embed"; url: string }
  | { kind: "refused"; hosts: readonly string[] }
  | { kind: "unreachable"; hosts: readonly string[] };

/**
 * Picks the first listed player host that provably serves this match's
 * player page, by probing each candidate URL exactly as the iframe will
 * request it (server-side; see src/api/probe.ts) before anything mounts.
 *
 * - The first "reachable" host wins, so a dead listed host never costs a
 *   watchdog round-trip - the frame mounts only on verified ground.
 * - "unknown" (no prober deployed) embeds the first candidate as before:
 *   absence of evidence is not failure, and the load watchdog still judges
 *   the mounted frame.
 * - Every host refused (401/403): the gate turned against this embed, and
 *   no host will serve it - reported so the caller falls back to their full
 *   match page instead of mounting a blank frame that claims to be healthy.
 * - No host answered at all: reported the same way; their match page is the
 *   remaining path to the stream.
 */
export const pickPlayerUrl = async (
  hosts: readonly string[],
  source: Omit<PlayerSource, "host">,
): Promise<PlayerPick> => {
  const candidates = hosts; // resolvePlayerHosts already degrades to env-seeded defaults.
  let refused = false;
  for (const host of candidates) {
    const url = playerUrl({ ...source, host });
    const probe = await probePlayerUrl(url);
    if (probe.kind === "reachable" || probe.kind === "unknown") return { kind: "embed", url };
    if (probe.kind === "refused") refused = true;
    // Unreachable: this host is not serving the page; try the next listed.
  }
  return refused
    ? { kind: "refused", hosts: candidates }
    : { kind: "unreachable", hosts: candidates };
};
