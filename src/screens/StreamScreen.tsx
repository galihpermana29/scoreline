import { AnimatePresence, motion } from "motion/react";
import { useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Match } from "../domain/match";
import { matchLabel } from "../domain/match";
import { formatLongDate, formatTime } from "../lib/format";
import { MORPH_SPRING, MatchCard, Shelf, StatusBadge, kickoffLabel, type OpenMatch } from "../components/tv";
import { Icon } from "../components/icons";
import { Crest, Notice } from "../components/ui";
import { parseMatchRoute, sourceUrl } from "../lib/route";
import { cachedPlaySiteDomains, isEmbedOriginAllowlisted } from "../api/source-sites";
import { useEntryOrigin } from "../lib/useEntryOrigin";
import { pickPlayerUrl } from "../api/player";
import { pickNoAdMirrorUrl } from "../api/no-ad-mirror";
import { fetchMatchStreams, postStreamSwitch, type StreamOption } from "../api/streams";
import { fetchTimEvents, type TimChannel } from "../api/timstreams";
import { timChannelsFor } from "../domain/timMatch";
import { bestMeasured, compareQuality, streamQuality } from "../domain/streamQuality";
import { ServerMenu } from "../components/ServerMenu";
import { SignInButton } from "../auth/SignInButton";
import { usePlayerSnap } from "../lib/usePlayerSnap";
import { WatchLayerScrollContext } from "./WatchLayer";
import { usePlayerHosts } from "../lib/usePlayerHosts";
import { useNoAdMirrors } from "../lib/useNoAdMirrors";
import { downloadCalendarEvent } from "../lib/calendar";
import { useTvMode } from "../lib/tvmode";
import { focusTvHome, isBackKey, tvFocusIsHome } from "../lib/tvnav";
import { useIdleChrome } from "../lib/useIdleChrome";
import { useTvFocusGuard } from "../lib/useTvFocusGuard";

/**
 * The watch screen. It mirrors the feed's own deep-link shape
 * (/{lang}/{sport}/{competitionSlug}-{id}/{matchSlug}.html). The simulated
 * player is the default view; pressing play mounts the real stream from the
 * source site as a sandboxed iframe. Sandboxing allows scripts and
 * same-origin storage so the player boots, but withholds top-navigation and
 * popups so the source site's ads cannot hijack this tab. Stopping unmounts
 * the frame, which also tears down the stream.
 *
 * Two embed modes, switchable on the toolbar (2026-10-16):
 *
 * - "page" (default) embeds the full match page, which still hands itself
 *   off to the live mirror and player client-side. Their player page runs a
 *   client-side Referer check: document.referrer's domain must be in the
 *   params API's `playSiteDomains` allowlist (the operator's own mirror
 *   fronts; "localhost" is in it, so dev sees the clean player), and a
 *   referer-less load gets 403 from their edge. A foreign origin like a
 *   vercel.app deployment can never satisfy that list, so the full page -
 *   whose nested player iframe carries their own domain as the Referer - is
 *   the only embed that works everywhere. The page's video is zoom-cropped
 *   to fill the frame (the PAGE_EMBED_* constants below), cropping their
 *   banners out of view; a toolbar toggle returns to the whole page. What
 *   still shows by default are the ads that drift into the crop and the
 *   ones they float inside the video - the visitor consented to them as
 *   the default state - and a separate opt-in "Hide ads" toolbar toggle
 *   masks the drifting bands black for visitors who prefer that trade.
 * - "player" embeds their dedicated bare player page directly, skipping the
 *   match page and its banner ads entirely - the player gets every pixel of
 *   the frame. The URL is constructed here (see src/api/player.ts): mdata is
 *   the base64 of {matchId}_{sportType}, and the host list comes live from
 *   their params API (see src/api/source-sites.ts). Before mounting, each
 *   candidate URL is probed server-side exactly as the iframe will request
 *   it (see src/api/probe.ts) and the first host that provably serves the
 *   page is the one embedded - a cross-origin iframe fires its load event
 *   for a 401 text page as happily as for the real player, so without the
 *   probe a tightened gate or a dead host would look exactly like a healthy
 *   embed. Note the probe cannot see the Referer allowlist: the page answers
 *   200 to a server-side fetch from any origin and the refusal happens in
 *   the player's own JS. When every listed host refuses or none answers,
 *   this mode falls back to their own match page on its own and says so
 *   instead of showing a blank frame. The toggle is only offered when the
 *   params allowlist (playSiteDomains) accepts this app's own hostname - dev
 *   is allowlisted, a production deployment is not, and there the page mode
 *   is the only embed shown.
 *
 * A second source (2026-10-18, docs/tim-extra-streams.md): the server menu
 * can also offer tim-streams channels for the watched match, listed first -
 * matched by sport, kick-off window and team-name score against their
 * curated list. Clicking one swaps the whole stage to that channel's own
 * player in a separate iframe, sandboxed with the source frame's own
 * tokens, which passes their guard cross-origin and blocks their ad
 * popups (docs/tim-ad-popups.md); a quiet affordance offers remounting
 * "with their ads" if the sandboxed player will not play, and that
 * fallback mount alone is unsandboxed and carries the ad-tab warning.
 * Clicking a source server swaps back: the
 * source embed remounts fresh, and the picked server is delivered once
 * the mirror settles. Purely additive - a match with no counterpart shows
 * exactly the UI it had before.
 *
 * Fullscreen is ours, not theirs (verified 2026-10-16): the embedded player's
 * own fullscreen button calls requestFullscreen() from inside a nested
 * cross-origin frame (ours -> their player or mirror chain), a request
 * Chrome treats per-origin and can prompt for or silently block. This screen
 * instead fullscreens its own .player-shell from the top document, which
 * needs no permission delegation at all, so the control works no matter how
 * the source site re-wires its own embed.
 *
 * Mobile (2026-10-17): iPhone Safari ships no element fullscreen at all -
 * its API is video-only, and the video lives inside the cross-origin embed,
 * beyond reach - so when the native request is missing (every iOS browser
 * is WebKit) or refused, the shell maximizes as a fixed full-viewport
 * overlay with the same in-shell control bar: "faux fullscreen". Desktop
 * and Android keep the real thing; iOS gets the closest a browser tab can
 * offer, with a rotate hint in portrait.
 *
 * Rotation resilience (2026-10-16): no embedded origin is hardcoded -
 * useEntryOrigin resolves the live entry generation and usePlayerHosts the
 * live player hosts, both at runtime. A mounted embed that never signals
 * load within the watchdog window is treated as a mid-session rotation:
 * both are re-resolved from scratch and the frame remounted once; a second
 * stall swaps the frame for an explicit retry notice instead of spinning
 * forever. Player-host rotation inside the "page" mode needs no handling
 * here: their own page embeds the live player host client-side.
 *
 * Layout: the frame is the screen. It takes the full content width (capped
 * by the viewport height so it never scrolls off), and everything else -
 * title, status, toolbar, details, related fixtures - sits below it. The
 * shell shares `layoutId` with the card that opened it, so arriving here
 * reads as that card growing into the player rather than a page swap.
 */

/** How long the embed may stay silent after mounting before it counts as stalled. */
const EMBED_LOAD_TIMEOUT_MS = 15_000;

/**
 * The page embed's zoom crop. Verified live 2026-10-16 on the mirror page
 * the match URL hands itself off to: at any viewport >= their player width
 * the player iframe is 750px wide (16:9), horizontally centred, at a fixed
 * 80px from the top; below that width it goes fluid (full width, same top).
 * Rendering the embedded page at exactly 750px wide therefore pins the
 * video box at (0, 80, 750, 750*9/16) on the frame, and scaling the frame
 * about that box fills the shell with the video alone - a uniform scale, so
 * the stream's ratio never changes - while their header, banner ads, mirror
 * link and tabs fall outside the visible crop.
 *
 * The base height deliberately starves the embedded page of any scrollable
 * overflow: their ad scripts inject banners below the video (embedded doc
 * measured ~3200px at 750 wide, 2026-10-16, vs 1249 clean) and then
 * scroll-centre their banners, sliding the video out of the crop
 * (scrolling="no" does NOT stop programmatic scrolling in Chromium - verified
 * live; a 3000px frame was still shorter than the ad-inflated document and
 * the scroll still happened). 10000px clears the document by several banner
 * rounds, which kills that scroll path entirely - verified: at 10000 the big
 * ~200px displacement is gone.
 *
 * What starvation alone could not fix, and the kick now does (verified live
 * 2026-10-16 evening): a fresh mount could land with the crop transform
 * provably absent - the frame stayed shell-sized and showed their whole
 * page (video at the top, URL strip and banners below), while an applied
 * transform would instead show the whole document squashed to a sliver, so
 * the style itself was missing, not merely misplaced. A manual Zoom
 * off/on round trip repaired it. The screen now runs that repair itself
 * (PAGE_EMBED_KICK_DELAY_MS below): the frame mounts shell-sized and
 * jumps to the crop geometry once its load events go quiet, behind an
 * opaque cover that doubles as the reveal. Verified live 2026-10-16 late
 * evening: a cold reload lands the centered video-only crop with no
 * toolbar interaction, and holds it.
 *
 * Residual drift (2026-10-16 late evening, re-measured): even after the
 * kick the framed layout is not frozen - within ~2 minutes their scripts
 * slide the video anchor ~50px up the page (video-space), so the video's
 * own chrome row settles at ~88% of the crop instead of at its bottom
 * edge, and their URL strip plus banner leak into the crop's bottom band.
 * The rest of their floating ad overlays sit inside the stream area where
 * no crop can reach them. No constant can track a moving anchor, so the
 * app does not try: the leak is theirs to show by default (the visitor
 * consented to the source's ads the moment they opened a mirrored
 * stream). Ads guard (2026-10-18) prefers a mirror whose `common:ad`
 * object is empty, cropped with PAGE_EMBED_VIDEO_CLEAN because that page
 * has no banner strip above the video. When no such mirror answers, the
 * guard falls back to this page and the PAGE_EMBED_MASK bars.
 */
const PAGE_EMBED_BASE = { width: 750, height: 10000 } as const;
const PAGE_EMBED_VIDEO = { x: 0, y: 80, w: 750, h: (750 * 9) / 16 } as const;
/**
 * Crop for a quiet mirror. Measured 2026-10-18 on an empty-ad brand: the
 * video iframe sits at the top of the 750-wide column, (0, 0, 750, 422),
 * with the URL strip and server row below it. The ad-bearing mirror's 80px
 * strip is absent there. One brand family, one match - if a later empty-ad
 * brand grows a header, re-measure before trusting this anchor for it.
 */
const PAGE_EMBED_VIDEO_CLEAN = { x: 0, y: 0, w: 750, h: (750 * 9) / 16 } as const;
/**
 * Opt-in black bars over the post-kick drift band. In video-box px.
 * Bottom 40 (user-tuned 2026-10-16 late evening, from a leak-sized 48
 * then a too-thin 8): covers most of the drifted URL strip that settles
 * into the crop's bottom band; the leak has measured ~50 video-box px,
 * so a small sliver can remain when their inventory stacks taller that
 * day - re-measure and confirm with the user before resizing. Top 16:
 * shaves the floating top ad strip's top edge.
 */
const PAGE_EMBED_MASK = { top: 16, bottom: 40 } as const;
/**
 * The zoom kick: a fresh page-embed mount could land with the crop
 * transform provably absent - the frame stayed shell-sized showing their
 * whole page, where an applied transform would show the document squashed
 * to a sliver (verified live 2026-10-16 evening; the manual Zoom off/on
 * round trip repaired it every time). Root cause was inconclusive at the
 * time, so the kick makes the sequence independent of it: while the crop
 * is wanted, the frame mounts shell-sized, and on each of its load events
 * (the entry -> mirror handoff hops documents) it collapses back to shell
 * size and re-arms; the crop lands this many ms after the latest load,
 * behind an opaque cover that hides the whole dance and doubles as the
 * reveal. A toolbar zoom flip pre-completes the kick, so the crop snaps
 * on the click instead of re-running the dance.
 */
const PAGE_EMBED_KICK_DELAY_MS = 900;
/** When the TV Mode auto pick is re-sent until playback is seen (ms after the first send). */
const AUTO_START_RETRY_MS = [4000, 10000, 18000, 30000];
const PAGE_ZOOM_KEY = "scoreline:page-zoom";
const HIDE_ADS_KEY = "scoreline:hide-ads";

/**
 * The one-time welcome note shown before the first watch (the modal itself
 * is near the JSX at the bottom of this file). Set the moment the visitor
 * confirms, not when the modal first shows - closing it without watching
 * leaves it unseen, so a first-timer who backed out still gets the ad
 * explainer on their next try.
 */
const WATCH_INTRO_KEY = "scoreline:watch-intro";
const WATCH_INTRO_COPY = {
  title: "Enjoy the match on Scoreline",
  body:
    "Note: the source page shows ads. Ads Guard in the toolbar loads a mirror with no banners. If that mirror does not answer, black bars cover the ad bands.",
  cta: "Start watching",
} as const;

const kickHint = (match: Match): string =>
  match.status.kind === "live" ? "In progress" : match.status.kind === "upcoming" ? "Kick-off" : "Final";

export const StreamScreen = ({
  match,
  href,
  layoutId,
  autoplay,
  related,
  peers = [],
  onExit,
  onOpen,
  onMore,
}: {
  match: Match;
  href: string;
  /** Shared element id of the card this screen opened from, if any. */
  layoutId: string | null;
  /** The user explicitly asked to watch: start the live embed without a second click. */
  autoplay: boolean;
  related: readonly Match[];
  /**
   * The other feed rows, for the tim-streams matcher's mutual-binding guard
   * (docs/tim-extra-streams.md). Already in memory - the watch screen itself
   * stays the only tim consumer.
   */
  peers?: readonly Match[];
  onExit: () => void;
  onOpen: OpenMatch;
  onMore: (match: Match) => void;
}) => {
  const scored = match.homeScore !== null && match.awayScore !== null && match.status.kind !== "upcoming";
  const live = match.status.kind === "live";
  // TV Mode is the remote contract (docs/tv-dpad.md): the video starts by
  // itself, the highlight never leaves our chrome, and the toolbar trims
  // to labelled controls a remote viewer needs.
  const tv = useTvMode() === "on";
  const playbackSeenRef = useRef(false);
  useTvFocusGuard(tv, () => {
    playbackSeenRef.current = true;
  });
  // The welcome note's seen flag lives above `playing` because the very
  // first watch usually arrives through autoplay (the Watch card click):
  // an unseen visitor gets the note instead of the stream, and
  // confirming is itself a click, so the embed still starts with user
  // activation.
  const [introSeen, setIntroSeen] = useState(() => {
    try {
      return localStorage.getItem(WATCH_INTRO_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [introOpen, setIntroOpen] = useState(false);
  // The live embed only exists while playing; stopped means fully unmounted,
  // so the stream and its bandwidth stop too. A click that asked to watch a
  // live match starts it straight away - that click is the user activation -
  // unless the one-time welcome note intervenes (then confirming is the
  // activation).
  const [playing, setPlaying] = useState(autoplay && live && introSeen);
  const [embedReady, setEmbedReady] = useState(false);

  // A watch request that arrived as autoplay (the card click that opened
  // this screen) opens the welcome note instead of starting silently.
  // Mount-only on purpose: the note opens exactly once per arrival.
  useEffect(() => {
    if (autoplay && live && !introSeen) setIntroOpen(true);
  }, []);

  // Rotation resilience: the embedded origins come from runtime resolution,
  // and a stalled frame triggers a fresh re-resolution plus a remount (bumping
  // the epoch) rather than leaving a dead frame on screen. Failures counts
  // stalls since the last explicit start/retry: 0 healthy, 1 remounting, 2
  // gave up and shows the retry notice.
  const { origin, reload: reloadOrigin } = useEntryOrigin();
  const { hosts: playerHosts, reload: reloadPlayerHosts } = usePlayerHosts();
  const { origins: noAdOrigins, resolving: noAdResolving, reload: reloadNoAd } = useNoAdMirrors();
  const [embedEpoch, setEmbedEpoch] = useState(0);
  const [embedFailures, setEmbedFailures] = useState(0);

  // The tim-streams second source (docs/tim-extra-streams.md): a small
  // independently operated site carrying 1-3 extra channels for roughly the
  // same fixtures. Purely additive: matched channels appear in the server
  // menu at the top, and clicking one swaps the whole stage to that
  // channel's own player. No postMessage contract exists into their player,
  // so the tim channel mounts in its own iframe and "switching back" remounts
  // the source embed fresh. That iframe is sandboxed with the source
  // frame's exact tokens (docs/tim-ad-popups.md; the night correction in
  // AGENTS.md dated facts): `allow-scripts allow-same-origin` passes every
  // check their guard actually runs against a cross-origin frame and blocks
  // their ad popups outright. A match with no counterpart renders exactly as
  // before; a failed fetch means "no extra channels", never an error.
  const [timChannels, setTimChannels] = useState<readonly TimChannel[]>([]);
  // The tim channel currently on stage, when one is.
  const [timChannel, setTimChannel] = useState<TimChannel | null>(null);
  // The "their ads" fallback for this mount only (docs/tim-ad-popups.md):
  // true means the current tim channel was remounted unsandboxed after the
  // sandboxed frame would not play. Never persisted, and every path that
  // changes the stage (another channel, swap back, stop/play, retry, mode
  // switch) returns to the sandboxed default.
  const [timFallback, setTimFallback] = useState(false);
  // While the sandboxed mount is on stage, the quiet "not playing?"
  // affordance that offers the fallback above. Dismissible, per mount.
  const [timHintOpen, setTimHintOpen] = useState(false);
  // The ad-tab warning for the fallback mount only (AGENTS.md dated facts:
  // unsandboxed, the first trusted play click opens an ad tab and every
  // re-armed later click too). Dismissible, shown on every fallback mount.
  const [timNoticeOpen, setTimNoticeOpen] = useState(false);
  // A source-server pick made while a tim channel is on stage. The
  // swap-back remounts the source embed, so the pick is held until the
  // mirror has settled and then delivered over the postMessage switch.
  const pendingSourceSwitchRef = useRef<StreamOption | null>(null);
  // The tim list is fetched once per screen - the watch screen is the only
  // consumer by design, and the 10-minute event cache dedupes anyway.
  const timStartedRef = useRef(false);
  useEffect(() => {
    if (!playing || timStartedRef.current) return;
    timStartedRef.current = true;
    let cancelled = false;
    void fetchTimEvents()
      .then((events) => {
        if (!cancelled) setTimChannels(timChannelsFor(match, events, peers));
      })
      .catch(() => {
        // Unreachable or a shape drift: no extra channels, silently.
      });
    return () => {
      cancelled = true;
    };
    // Match changes remount this screen (key={match.id} in App.tsx), so
    // playing plus the once-guard is the whole trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const timMounted = playing && timChannel !== null;
  const chooseTimChannel = (channel: TimChannel) => {
    // Swapping to or between tim channels is only a frame swap - none of
    // the source machinery (probe, crop, watchdog, ads guard) takes part.
    // Every new mount returns to the sandboxed default; the hint is the
    // first thing shown on it.
    setEmbedReady(false);
    setTimChannel(channel);
    setTimFallback(false);
    setTimHintOpen(true);
    setTimNoticeOpen(false);
  };
  // The "Load with their ads" affordance (docs/tim-ad-popups.md): their
  // player cannot be diagnosed across the origin boundary, so a silent
  // refusal is indistinguishable from a slow boot - the visible escape
  // hatch is remounting the same channel unsandboxed, which always plays
  // but brings their ad tabs back (the warning notice follows it).
  const useTimFallback = () => {
    setEmbedReady(false);
    setTimFallback(true);
    setTimHintOpen(false);
    setTimNoticeOpen(true);
  };
  const clearTimChannel = () => {
    setTimChannel(null);
    setTimFallback(false);
    setTimHintOpen(false);
    setTimNoticeOpen(false);
  };

  // Embed mode: their bare player page directly (default), or their full
  // match page as the fallback. Both ride the runtime-resolved hosts. The
  // direct player needs the route's language and match id plus the feed's
  // numeric sport id to build mdata; without any of those the page mode is
  // the only constructible option.
  // The play-site allowlist rides the same params decode as the player
  // hosts: the source's player page checks its referrer's domain against it
  // (see source-sites.ts), so the direct-player toggle only exists where it
  // can actually work. Unknown (null) is treated as allowed; the value is
  // re-read whenever the host list refreshes since one decode writes both.
  const [playSiteDomains, setPlaySiteDomains] = useState<readonly string[] | null>(() => cachedPlaySiteDomains());
  useEffect(() => {
    setPlaySiteDomains(cachedPlaySiteDomains());
    // playerHosts changes exactly when a fresh decode has been cached.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerHosts]);
  const directPlayerAllowed =
    playSiteDomains === null || isEmbedOriginAllowlisted(playSiteDomains, window.location.hostname);

  const route = parseMatchRoute(href);
  const canPlayer = route !== null && match.sportId !== undefined && directPlayerAllowed;
  const [mode, setMode] = useState<"player" | "page">("page");
  const embedMode = canPlayer ? mode : "page";
  const setEmbedMode = (next: "player" | "page") => {
    setMode(next);
    // A mode switch retires any second-source channel and any pick held
    // for the source pipeline - both are about the old embed.
    clearTimChannel();
    pendingSourceSwitchRef.current = null;
    // A mode switch mid-play is a remount: it re-arms the load watchdog
    // instead of leaving a half-navigated frame.
    if (playing) {
      setEmbedReady(false);
      setEmbedEpoch((epoch) => epoch + 1);
    }
  };

  // The verified direct-player URL for the current embed epoch, or null
  // while the probe is still choosing (or the page mode is active). Keyed
  // by epoch + match + sport so every remount re-probes, a match switch
  // never replays the previous match's frame, and a background host-list
  // refresh mid-play never restarts a working frame.
  const [playerPick, setPlayerPick] = useState<{ key: string; url: string } | null>(null);
  // Set when the probe itself gave up on the direct player and this screen
  // fell back to the full page embed; cleared like fullscreenDenied.
  const [playerNotice, setPlayerNotice] = useState<string | null>(null);

  useEffect(() => {
    if (playerNotice === null) return;
    const timer = window.setTimeout(() => setPlayerNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [playerNotice]);

  // Direct-player selection: probe each listed host's exact embed URL
  // server-side (see pickPlayerUrl) and mount only the first one that
  // provably serves the page. Candidate order rotates with the epoch so a
  // remount does not retry the same dead host first.
  useEffect(() => {
    if (!playing || embedMode !== "player" || route === null || match.sportId === undefined) return;
    const key = `${embedEpoch}:${route.lang}:${route.matchId}:${match.sportId}`;
    if (playerPick !== null && playerPick.key === key) return;
    let cancelled = false;
    const source = { lang: route.lang, matchId: route.matchId, sportType: match.sportId };
    const rotateBy = embedEpoch % Math.max(playerHosts.length, 1);
    const candidates = [...playerHosts.slice(rotateBy), ...playerHosts.slice(0, rotateBy)];
    void pickPlayerUrl(candidates, source).then((pick) => {
      if (cancelled) return;
      if (pick.kind === "embed") {
        setPlayerPick({ key, url: pick.url });
        return;
      }
      // Every listed host refused the embed or none answered: the direct
      // player is done for now. Fall back to their own match page - which
      // still hands itself off to the live player client-side - and say
      // so, instead of mounting a frame that looks healthy while showing
      // nothing.
      setPlayerNotice(
        pick.kind === "refused"
          ? "The source refused the direct player - showing the full page embed instead"
          : "No direct player host answered - showing the full page embed instead",
      );
      setMode("page");
      setEmbedReady(false);
      setEmbedEpoch((epoch) => epoch + 1);
    });
    return () => {
      cancelled = true;
    };
    // playerHosts is read at pick time only: a mid-play list refresh must
    // not restart a mounted frame, and every epoch bump re-reads the fresh
    // list. playerPick is the guard that makes re-runs no-ops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, embedMode, embedEpoch, playerPick, route?.lang, route?.matchId, match.sportId]);

  const playerPickUrl = embedMode === "player" ? (playerPick?.url ?? null) : null;

  // Ads guard. Off: the entry page, ads and all. On: a mirror whose banner
  // config is empty, probed before mount. A miss (no such brand, every
  // origin dead, or a redirect onto a different host) mounts the entry page
  // and the mask bars. A stall of a quiet frame drops it for this mount;
  // Retry and toggling the guard try the list again.
  const [hideAds, setHideAds] = useState(() => {
    try {
      return localStorage.getItem(HIDE_ADS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [noAdSuppressed, setNoAdSuppressed] = useState(false);
  const [noAdPick, setNoAdPick] = useState<{ key: string; url: string | null } | null>(null);
  const [quietNotice, setQuietNotice] = useState<string | null>(null);
  const noAdKey = `${embedEpoch}:${href}:${noAdOrigins.join("|")}`;
  useEffect(() => {
    setNoAdSuppressed(false);
  }, [href]);
  useEffect(() => {
    if (quietNotice === null) return;
    const timer = window.setTimeout(() => setQuietNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [quietNotice]);
  useEffect(() => {
    if (!playing || embedMode !== "page" || !hideAds) return;
    if (noAdPick !== null && noAdPick.key === noAdKey) return;
    if (noAdSuppressed) {
      setNoAdPick({ key: noAdKey, url: null });
      return;
    }
    if (noAdOrigins.length === 0) {
      if (noAdResolving) return;
      setNoAdPick({ key: noAdKey, url: null });
      return;
    }
    let cancelled = false;
    const rotateBy = embedEpoch % noAdOrigins.length;
    const candidates = [...noAdOrigins.slice(rotateBy), ...noAdOrigins.slice(0, rotateBy)];
    void pickNoAdMirrorUrl(candidates, href).then((pick) => {
      if (cancelled) return;
      if (pick.kind === "embed") {
        setNoAdPick({ key: noAdKey, url: pick.url });
        return;
      }
      setNoAdPick({ key: noAdKey, url: null });
      setQuietNotice("The quieter mirror did not answer - showing the usual page, with the banner bands masked.");
    });
    return () => {
      cancelled = true;
    };
    // noAdPick is the guard that makes a re-run for the same key a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, embedMode, hideAds, embedEpoch, href, noAdKey, noAdSuppressed, noAdResolving]);

  const noAdPending =
    playing && embedMode === "page" && hideAds && !noAdSuppressed && (noAdPick === null || noAdPick.key !== noAdKey);
  const noAdUrl =
    playing && embedMode === "page" && hideAds && !noAdPending && noAdPick !== null && noAdPick.key === noAdKey
      ? noAdPick.url
      : null;
  const toggleHideAds = () => {
    setNoAdSuppressed(false);
    setQuietNotice(null);
    setHideAds((current) => {
      try {
        localStorage.setItem(HIDE_ADS_KEY, current ? "0" : "1");
      } catch {
        // Private mode: the preference just does not persist.
      }
      return !current;
    });
    if (playing) {
      setEmbedReady(false);
      setEmbedEpoch((epoch) => epoch + 1);
    }
  };

  // The frame mounts only on verified ground in player mode, and only after
  // the quiet-mirror probe in page mode when Ads guard is on. While a probe
  // is choosing, the loading overlay stands in for the frame.
  const embedMounted = embedMode === "page" ? !noAdPending : playerPickUrl !== null;
  const embedSrc = playerPickUrl ?? noAdUrl ?? sourceUrl(href, origin);
  const pageVideo = noAdUrl !== null ? PAGE_EMBED_VIDEO_CLEAN : PAGE_EMBED_VIDEO;

  // The stream-server chips for the page embed. The list is their own data
  // (see src/api/streams.ts: /api/match/detail field-2 entries), and a chip
  // click posts their own server-switch message into the embed's frame tree - we
  // are the mirror's parent and the player's grandparent, but cross-origin
  // frame walking reaches the player all the same (verified live 2026-10-17).
  // The index of the chosen server: starts unset, and the mirror picks its own
  // default (the first entry of its list) on mount - nothing reports that
  // upward to us. Two things can light a chip from here: a visitor pick, and
  // the auto-start on the best measured server (docs/stream-quality.md),
  // which only fires when it provably beats their default. Their crop hides
  // the source's own server row inside the frame, so ours is the visible
  // selector while it is on.
  const embedFrameRef = useRef<HTMLIFrameElement>(null);
  const [streamOptions, setStreamOptions] = useState<readonly StreamOption[]>([]);
  const [activeStreamId, setActiveStreamId] = useState<number | null>(null);
  // True once the visitor picked a server themselves on this mount; the
  // auto-start below never overrides a choice it knows about.
  const visitorPickedRef = useRef(false);
  // A remount (mode switch, watchdog, retry) mounts a fresh mirror that
  // re-picks its own default channel, so any highlight from here is stale.
  // `playing` belongs in these deps too (the stop/play cycle unmounts and
  // remounts the same embedEpoch's frame): before it was missing here, a
  // stop/play round trip kept the old highlight and the reset never ran.
  useEffect(() => {
    setStreamOptions([]);
    setActiveStreamId(null);
    visitorPickedRef.current = false;
  }, [embedEpoch, embedMode, playing]);
  useEffect(() => {
    if (!playing || embedMode !== "page" || route === null || match.sportId === undefined) return;
    let cancelled = false;
    fetchMatchStreams(route.matchId, match.sportId)
      .then((options) => {
        if (!cancelled) setStreamOptions(options);
      })
      .catch(() => {
        // No chips on failure - the watch page works exactly as before; a
        // remount, mode flip, or refresh refetches the list.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, embedMode, embedEpoch, route?.matchId, match.sportId]);
  // The best measured server (`src/domain/streamQuality.ts` - measured
  // facts, never a guess). The toolbar menu badges the same table.
  const bestKnown = bestMeasured(streamOptions);
  const chooseStream = (stream: StreamOption, picked: "visitor" | "auto" = "visitor") => {
    if (timChannel !== null) {
      // A source pick from the menu while a second-source channel is on
      // stage: swap back now (the source remounts fresh) and hold the pick
      // until the mirror settles, then deliver it over the usual switch.
      // Marking the visitor pick now keeps the auto-start out of the way.
      pendingSourceSwitchRef.current = stream;
      if (picked === "visitor") visitorPickedRef.current = true;
      clearTimChannel();
      setEmbedReady(false);
      setEmbedEpoch((epoch) => epoch + 1);
      return true;
    }
    const frame = embedFrameRef.current;
    if (frame === null) return false;
    // No confirmation channel exists back to this app (page mode): success
    // is marked by whichever frame took the message - their own server row
    // re-highlights from the player's reply inside the frame. A miss (frame
    // swapped mid-walk) leaves the chip unmarked; the click simply retries.
    if (postStreamSwitch(frame, stream)) {
      if (picked === "visitor") visitorPickedRef.current = true;
      setActiveStreamId(stream.streamId);
      return true;
    }
    return false;
  };
  // The auto-start on the best known server lives further down, after the
  // zoom-kick state it waits on (`embedSettled`, below).

  // Fullscreen state mirrors document.fullscreenElement so the control stays
  // in sync even when the browser exits fullscreen on its own (Esc key).
  const shellRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Faux fullscreen (see the header comment): when the native API is missing
  // (iPhone Safari) or refuses the request, the shell maximizes as a fixed
  // full-viewport overlay instead. Esc leaves it on keyboards; the shell's
  // own control bar is the exit on touch screens.
  const [isFaux, setIsFaux] = useState(false);
  const shellMaximized = isFullscreen || isFaux;
  // Snap-back lives on the layer WatchLayer owns. Disabled while this shell
  // is maximized (native fullscreen or the faux overlay); the width gate
  // lives in the hook, on the same 740px split as the phone layout.
  const layerScrollRef = useContext(WatchLayerScrollContext);
  usePlayerSnap(layerScrollRef, shellRef, !shellMaximized);

  // The toolbar floats, so focusing it never scrolls: with a remote, the
  // highlight reaching the controls or Back brings the picture back into
  // view instead of leaving it scrolled away above the Also Live shelf.
  useEffect(() => {
    const layer = layerScrollRef?.current;
    if (!tv || layer == null) return;
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Element) || event.target.closest('[data-tv-row="controls"], [data-tv-row="top"]') === null) return;
      layer.scrollTo({ top: 0, behavior: "smooth" });
    };
    layer.addEventListener("focusin", onFocusIn);
    return () => layer.removeEventListener("focusin", onFocusIn);
  }, [tv, layerScrollRef]);

  // While maximized the shell must take every pixel - including the ones the
  // root-level sidebar (fixed, z 45) normally owns. The shell lives inside
  // the watch layer's stacking context (z 40), so no z on the shell itself
  // can cross that boundary; raise the whole layer instead (see
  // `.scoreline-shell-max` in watch.css). Native element fullscreen does not
  // need this (the top layer sits above everything), but it is harmless.
  useEffect(() => {
    document.body.classList.toggle("scoreline-shell-max", shellMaximized);
    return () => {
      document.body.classList.remove("scoreline-shell-max");
    };
  }, [shellMaximized]);

  useEffect(() => {
    const sync = () => {
      setIsFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // Back leaves a maximized shell before it leaves the screen: the faux
  // overlay on any keyboard, and native fullscreen too in TV Mode, where the
  // remote's Back may not be a key the browser itself exits fullscreen on.
  useEffect(() => {
    if (!shellMaximized) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isBackKey(event)) return;
      if (isFaux) {
        event.preventDefault();
        setIsFaux(false);
        return;
      }
      if (tv && document.fullscreenElement !== null) {
        event.preventDefault();
        void document.exitFullscreen().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shellMaximized, isFaux, tv]);

  // Remote focus follows the maximize switch: into the in-frame bar on the
  // way in (it is the only chrome on screen), back to the toolbar's
  // fullscreen button on the way out.
  const wasMaximizedRef = useRef(false);
  useEffect(() => {
    if (!tv || wasMaximizedRef.current === shellMaximized) return;
    const leaving = wasMaximizedRef.current;
    wasMaximizedRef.current = shellMaximized;
    const frame = window.requestAnimationFrame(() => {
      const exit = leaving ? document.querySelector<HTMLElement>(".watch-toolbar .toolbar-fullscreen") : null;
      focusTvHome(exit);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tv, shellMaximized]);

  // The zoom crop's on/off: on by default, remembered across visits. TV
  // Mode hides the toggle and always crops - a remembered "off" would
  // otherwise also hide the ads guard, which only exists on the crop.
  const [zoomPreference, setZoom] = useState(() => {
    try {
      return localStorage.getItem(PAGE_ZOOM_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const zoom = tv || zoomPreference;
  // The zoom kick (see PAGE_EMBED_KICK_DELAY_MS): while the crop is wanted,
  // the frame mounts shell-sized and jumps to the crop geometry once its
  // load events go quiet - the automatic version of the toolbar's Zoom
  // off/on round trip, which is what actually repairs their layout (the
  // frame's own viewport resize reaches their scripts; the transform does
  // not). Covered until the kick has landed
  const zoomCropWanted = zoom && embedMode === "page" && playing && embedFailures < 2;
  const [zoomKickDone, setZoomKickDone] = useState(false);
  const [embedLoads, setEmbedLoads] = useState(0);
  useEffect(() => {
    // A different frame mounts (epoch bump, mode switch, stop/play cycle):
    // fresh load counts, cover back up, kick re-armed.
    setEmbedLoads(0);
    setZoomKickDone(false);
  }, [embedEpoch, embedMode, playing]);
  useEffect(() => {
    if (embedLoads === 0) return;
    // A load event means a fresh document took over the frame (the
    // entry -> mirror handoff hops documents), and whatever crop state
    // it inherited was addressed to its predecessor - a document that
    // mounts straight into the 750x10000 crop geometry never lays its
    // video out correctly (verified live 2026-10-16 evening). So every
    // load collapses the frame back to shell size - itself a resize the
    // new document registers - and the kick re-arms: the crop is applied
    // a beat after the LATEST load, when the document that will actually
    // be cropped has settled. Only the last document in the chain ends
    // up cropped, and by resize rather than mount geometry, which is
    // the exact repair the toolbar's Zoom off/on round trip performs.
    setZoomKickDone(false);
    const timer = window.setTimeout(() => setZoomKickDone(true), PAGE_EMBED_KICK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [embedLoads]);
  // Start on the best known server, once per mount
  // (docs/stream-quality.md part 3). Quality is fixed per server and their
  // default pick (the first entry) is not their best one, so when we can
  // prove a better start we make it. The gate stays deliberately strict:
  // - page mode, playing, after the server list has loaded and the embed
  //   has settled - the zoom kick landed, or at least one load event when
  //   the crop is off - because the mirror's nested player exists then;
  // - never after the visitor picked a server on this mount;
  // - only a provable improvement: the first entry (their default) has a
  //   measured quality and the best measured is strictly better. Anything
  //   unknown stays untouched - it might be good.
  // TV Mode always starts (docs/tv-dpad.md section 1): their play button is
  // inside the cross-origin frame where a remote can never reach it, and
  // the posted switch is what starts their player - so the best measured
  // server is picked, else the first listed one.
  const autoStartedRef = useRef(false);
  const autoPickRef = useRef<StreamOption | null>(null);
  useEffect(() => {
    autoStartedRef.current = false;
    autoPickRef.current = null;
    playbackSeenRef.current = false;
  }, [embedEpoch, embedMode, playing]);
  const embedSettled = zoomCropWanted ? zoomKickDone : embedLoads > 0;
  useEffect(() => {
    // A source-server pick held from a second-source swap-back is delivered
    // before anything else, retried on every fresh document in the frame
    // chain (the entry -> mirror handoff hops documents) - the same retry
    // shape the auto-start below has. Until it lands, no auto-start runs.
    const pending = pendingSourceSwitchRef.current;
    if (pending !== null) {
      if (playing && embedMode === "page" && embedSettled && chooseStream(pending, "visitor")) {
        pendingSourceSwitchRef.current = null;
      }
      return;
    }
    // A tim channel on stage means the source pipeline is idle: nothing to
    // auto-start against (the swap-back path handles the return).
    if (timChannel !== null) return;
    if (autoStartedRef.current || visitorPickedRef.current || activeStreamId !== null) return;
    if (!playing || embedMode !== "page" || route === null) return;
    if (streamOptions.length === 0 || !embedSettled) return;
    const firstOption = streamOptions[0];
    if (firstOption === undefined) return;
    const best = bestKnown;
    if (!tv) {
      const first = streamQuality(firstOption.name);
      if (first === null || best === null) return;
      if (compareQuality(best.quality, first) <= 0) return;
    }
    // Highlight the chosen chip so the visitor sees what happened and can
    // pick another any time; their own server row inside the frame
    // re-syncs from the player's reply.
    const pick = best?.stream ?? firstOption;
    autoStartedRef.current = chooseStream(pick, "auto");
    if (autoStartedRef.current) autoPickRef.current = pick;
    // `embedLoads` re-runs this on every fresh document in the frame chain:
    // a switch posted to the entry page (no child frames yet) is not
    // delivered, and the attempt must re-arm when the mirror lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, embedMode, embedSettled, embedLoads, route?.matchId, streamOptions, activeStreamId, bestKnown, timChannel, tv]);

  // "Delivered" only means their player's frame existed. On the TV (slow
  // WebView, 2026-10-23) the auto pick was posted before their player
  // listened and was dropped: the video sat paused while the same pick made
  // by hand started it at once. With a remote nobody can press their play
  // button, so the pick is re-sent until their player takes focus - the one
  // sign of playback a cross-origin frame gives - or the viewer picks.
  useEffect(() => {
    const pick = autoPickRef.current;
    if (!tv || pick === null || activeStreamId !== pick.streamId) return;
    const timers = AUTO_START_RETRY_MS.map((delay) =>
      window.setTimeout(() => {
        const frame = embedFrameRef.current;
        if (playbackSeenRef.current || visitorPickedRef.current || frame === null) return;
        postStreamSwitch(frame, pick);
      }, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [tv, activeStreamId, embedEpoch]);
  const toggleZoom = () => {
    setZoom((current) => {
      try {
        localStorage.setItem(PAGE_ZOOM_KEY, current ? "0" : "1");
      } catch {
        // Private mode: the preference just does not persist.
      }
      return !current;
    });
    // Turning the crop back on by hand is itself a resize kick - the frame
    // jumps straight to its crop geometry with no cover in the way.
    setZoomKickDone(true);
  };

  // The shell's live size drives the crop's scale, so the video keeps
  // filling it through resizes and the fullscreen switch. The box is read
  // synchronously on mount - the shell already has its layout by the time
  // layout effects run - and the observers only carry later changes; some
  // embedded browsers throttle ResizeObserver delivery, and the crop must
  // not depend on it ever firing (verified 2026-10-16: the IDE's browser
  // never delivers even the initial observation).
  const [shellBox, setShellBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return;
    const read = () => setShellBox({ w: shell.clientWidth, h: shell.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(shell);
    window.addEventListener("resize", read);
    document.addEventListener("fullscreenchange", read);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", read);
      document.removeEventListener("fullscreenchange", read);
    };
  }, []);

  // The page-embed frame style: at base size, scaled about the measured
  // video box so it covers the whole shell (cover, never stretch: the
  // shell is 16:9 by design, so the crop is pixel-exact in practice).
  // Undefined until the zoom kick has landed, which is what carries the
  // frame from its shell-sized mount geometry to the crop geometry.
  const pageZoomStyle: CSSProperties | undefined = (() => {
    if (!zoomCropWanted || !zoomKickDone || shellBox === null) return undefined;
    const { w, h } = shellBox;
    const scale = Math.max(w / pageVideo.w, h / pageVideo.h);
    const tx = w / 2 - (pageVideo.x + pageVideo.w / 2) * scale;
    const ty = h / 2 - (pageVideo.y + pageVideo.h / 2) * scale;
    return {
      width: PAGE_EMBED_BASE.width,
      height: PAGE_EMBED_BASE.height,
      transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
      transformOrigin: "0 0",
    };
  })();

  // The embed start sits behind the one-time welcome note: both play paths
  // (the big centre button and the toolbar's Play Live) funnel through
  // startEmbed, so the note gates every first watch without the caller
  // knowing anything about it. Confirming marks it seen and starts; the
  // scrim or Escape dismisses it unseen, so a visitor who backed out still
  // gets the ad explainer next time. (The intro states live above `playing`
  // - the autoplay arrival path also reads them at mount.)
  const beginEmbed = () => {
    setEmbedReady(false);
    setEmbedFailures(0);
    setPlaying(true);
  };
  const startEmbed = () => {
    if (!introSeen) {
      setIntroOpen(true);
      return;
    }
    beginEmbed();
  };
  const confirmIntro = () => {
    try {
      localStorage.setItem(WATCH_INTRO_KEY, "1");
    } catch {
      // Private mode: this browser sees the note every session. Fine.
    }
    setIntroSeen(true);
    setIntroOpen(false);
    beginEmbed();
  };

  // Escape closes the welcome note (dismisses without starting - the
  // visitor simply stays on the simulated player).
  useEffect(() => {
    if (!introOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isBackKey(event)) return;
      event.preventDefault();
      setIntroOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [introOpen]);
  const stopEmbed = () => {
    setPlaying(false);
    setEmbedReady(false);
    setEmbedFailures(0);
    // Stopping retires any second-source stage and any held pick - a
    // restart begins from the source's own default channel.
    clearTimChannel();
    pendingSourceSwitchRef.current = null;
    // Leaving fullscreen on stop returns the page to its normal layout
    // instead of showing the simulated shell stretched over the screen.
    setIsFaux(false);
    if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => {});
  };

  /**
   * Remounts the embed frame on freshly resolved hosts. Both reloads must
   * settle before the epoch bumps, otherwise the new frame would mount on a
   * stale origin or player host and never see the rotation.
   */
  const remountEmbed = (fresh: boolean) => {
    setEmbedReady(false);
    const reloads: Promise<unknown>[] = [
      // Page mode may be on a quiet mirror or the entry origin. Reloading
      // all three costs one extra request and keeps every list warm.
      // None of the resolvers throw by contract; the catches are hard guards.
      reloadOrigin(fresh).catch(() => undefined),
      reloadPlayerHosts(fresh).catch(() => undefined),
      reloadNoAd(fresh).catch(() => undefined),
    ];
    void Promise.all(reloads).finally(() => setEmbedEpoch((epoch) => epoch + 1));
  };

  const retryEmbed = () => {
    setEmbedFailures(0);
    setNoAdSuppressed(false);
    pendingSourceSwitchRef.current = null;
    remountEmbed(true);
  };

  // Watchdog: a mounted frame that never signals load within the window is
  // treated as a dead or rotated host. A quiet mirror that stalls is dropped
  // for this mount and the entry page takes over (mask included); that does
  // not spend the entry page's own retry. Otherwise the first stall
  // re-resolves from scratch and remounts once, and a second stall stops
  // retrying and swaps the frame for the explicit retry notice.
  useEffect(() => {
    if (!playing || embedFailures >= 2 || embedReady) return;
    // A second-source channel on stage owns the frame window: the source
    // pipeline beneath is unmounted and idle, so its watchdog must not run
    // (a stalled tim frame is the visitor's swap-back, not a retry loop).
    if (timChannel !== null) return;
    // Nothing to watch yet while a probe is still choosing the host.
    if (embedMode === "player" && playerPickUrl === null) return;
    if (noAdPending) return;
    const timer = window.setTimeout(() => {
      if (noAdUrl !== null) {
        setQuietNotice("The quieter mirror did not answer - showing the usual page, with the banner bands masked.");
        setNoAdSuppressed(true);
        setEmbedReady(false);
        setEmbedEpoch((epoch) => epoch + 1);
        return;
      }
      if (embedFailures === 0) {
        setEmbedFailures(1);
        remountEmbed(true);
      } else {
        setEmbedFailures(2);
      }
    }, EMBED_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
    // reloadOrigin is a fresh closure each render but stable in behaviour;
    // epoch is included so a remount re-arms the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, embedReady, embedEpoch, embedFailures, reloadOrigin, noAdPending, noAdUrl, timChannel]);

  /**
   * Maximize the shell in the best mode the browser offers. Native first -
   * the real thing, browser chrome gone, via the unprefixed API or Safari's
   * WebKit-prefixed one. Missing API (iPhone Safari) or a refused request
   * falls back to faux fullscreen: the fixed full-viewport overlay, which
   * needs nothing from the browser.
   */
  const toggleFullscreen = () => {
    if (isFaux) {
      setIsFaux(false);
      return;
    }
    if (document.fullscreenElement !== null) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    const shell = shellRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => unknown }) | null;
    if (shell !== null) {
      try {
        if (typeof shell.requestFullscreen === "function") {
          void shell.requestFullscreen().catch(() => setIsFaux(true));
          return;
        }
        if (typeof shell.webkitRequestFullscreen === "function") {
          const outcome = shell.webkitRequestFullscreen();
          if (outcome instanceof Promise) outcome.catch(() => setIsFaux(true));
          return;
        }
      } catch {
        setIsFaux(true);
        return;
      }
    }
    setIsFaux(true);
  };

  // The remote's highlight on arrival and whenever the controls change shape
  // (play/stop swaps the toolbar, the server list arrives, a notice opens):
  // the default control (Servers while playing, Play Live while stopped)
  // takes focus unless the viewer already moved somewhere reachable - a
  // highlight this effect placed itself and the viewer never moved is
  // re-homed, so the Servers button arriving after the list loads wins over
  // the stopgap that had focus meanwhile. The focus guard is the net
  // between these moments.
  const hasServerMenu = playing && embedMode === "page" && (streamOptions.length > 0 || timChannels.length > 0);
  const autoFocusedRef = useRef<Element | null>(null);
  useEffect(() => {
    if (!tv) return;
    const frame = window.requestAnimationFrame(() => {
      const untouched = autoFocusedRef.current !== null && document.activeElement === autoFocusedRef.current;
      if (tvFocusIsHome() && !untouched) return;
      if (focusTvHome()) autoFocusedRef.current = document.activeElement;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tv, playing, hasServerMenu, introOpen, embedFailures >= 2]);

  const flag = playing
    ? timMounted
      ? { label: "TS stream", tone: "live" as const, title: "A channel from the tim-streams second source is on stage, in its own player" }
      : embedFailures >= 2
      ? { label: "Source unreachable", tone: "warn" as const, title: "The live source is not answering; retrying is available below the player" }
      : embedMode === "player"
        ? { label: "Live player", tone: "live" as const, title: "The source site's bare player page is embedded directly, on the first listed player host that provably serves it" }
        : { label: "Live page embed", tone: "live" as const, title: "The source site's full match page is embedded, on its currently resolved domain" }
    : { label: "Simulated", tone: "idle" as const, title: "This frame plays no video until you press play - it is a local simulation" };

  // Icon-only controls (compact pill, one TV row; `title` carries the
  // tooltip on hover and `aria-label` keeps the names audible - the stopped
  // state's CTAs keep their words, these are settled muscle-memory pills).
  // While a stream plays, the toolbar (and the in-frame bar in fullscreen)
  // fades out after a quiet spell and returns on the next interaction; an
  // open menu or dialog, or a pointer resting on the controls, keeps it up.
  const chromeIdle = useIdleChrome(
    playing,
    () => document.querySelector('.server-menu-list, [aria-modal="true"], .watch-toolbar:hover, .player-embed-bar:hover') !== null,
  );

  const embedControls = (
    <>
      <div className="player-embed-mode" role="group" aria-label="Embed mode">
        <button
          className={embedMode === "player" ? "player-embed-mode-on" : undefined}
          onClick={() => setEmbedMode("player")}
          disabled={!canPlayer}
          hidden={!directPlayerAllowed}
          aria-label="Player embed"
          title={
            directPlayerAllowed
              ? canPlayer
                ? "Embed the source site's bare player page - no ads, full frame"
                : "Needs the feed's numeric match and sport ids for this match"
              : "Not available: the source's player only accepts embeds from its own allowlisted domains"
          }
        >
          <Icon name="player" size={16} />
        </button>
        <button
          className={embedMode === "page" ? "player-embed-mode-on" : undefined}
          onClick={() => setEmbedMode("page")}
          aria-label="Page embed"
          title="Embed the source site's full match page - the fallback if the bare player ever stops working"
        >
          <Icon name="page" size={16} />
        </button>
      </div>
      {embedMode === "page" ? (
        <button
          className={`toolbar-button toolbar-zoom${zoom ? " player-embed-mode-on" : ""}`}
          onClick={toggleZoom}
          aria-label="Zoom"
          title={
            zoom
              ? "The video is scaled to fill the frame, cropping the source page's banners - click to show the whole page"
              : "Zoom the source page's video to fill the frame instead of showing the whole page"
          }
        >
          <Icon name="zoom" size={16} />
        </button>
      ) : null}
      {embedMode === "page" && zoom ? (
        <button
          className={`toolbar-button${hideAds ? " ads-guard-on" : ""}`}
          onClick={toggleHideAds}
          aria-pressed={hideAds}
          aria-label="Ads guard"
          title={
            hideAds
              ? "Ads guard on: prefers a mirror with no banner ads, and masks the usual page if that mirror is down - click to show the source's ads"
              : "Ads guard off - click to prefer a mirror with no banner ads"
          }
        >
          <Icon name={hideAds ? "shield-fill" : "shield"} size={16} />
        </button>
      ) : null}
      <button
        className="toolbar-button"
        onClick={() => window.location.reload()}
        aria-label="Refresh"
        title="Reload the whole page (feed, host lookups and the embed all start clean) - the TV-friendly way to refresh"
      >
        <Icon name="refresh" size={14} />
      </button>
      {/* Parked in the floating toolbar (watch.css .toolbar-fullscreen,
          2026-10-18): the embedded player now exposes its own fullscreen.
          The handler stays, and this same button is still the exit while
          our shell is already maximized. TV Mode shows it again: their
          player's own fullscreen is inside the frame, out of the remote's
          reach. */}
      <button
        className="toolbar-button toolbar-fullscreen"
        onClick={toggleFullscreen}
        data-tv-default={shellMaximized || undefined}
        aria-label={shellMaximized ? "Exit fullscreen" : "Fullscreen"}
        title={
          shellMaximized
            ? "Leave fullscreen"
            : "Fullscreen the live embed using this page, not the player's own button; where the browser has no fullscreen API (iPhone) it becomes a full-screen overlay"
        }
      >
        <Icon name={shellMaximized ? "fullscreen-exit" : "fullscreen"} size={16} />
      </button>
      <button
        className="toolbar-button"
        onClick={stopEmbed}
        aria-label="Stop"
        title="Stop the live embed and return to the simulated player"
      >
        <Icon name="stop" size={14} />
      </button>
    </>
  );

  // `data-tv-scope` / `data-tv-row` are the remote's map (lib/tvnav.ts):
  // top bar, stage notices, controls, Also Live - nothing else on this
  // screen (the player frame, the source link) is ever visited.
  return (
    <div className="watch" data-tv-scope>
      <motion.header
        className="watch-top"
        data-tv-row="top"
        initial={layoutId ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: layoutId ? 0.1 : 0 }}
      >
        <button className="back-pill back-pill-static" onClick={onExit} aria-label="Back">
          <Icon name="chevron-left" size={16} />
          <span className="back-pill-label">Back</span>
        </button>
        <span className="watch-top-title">{matchLabel(match)}</span>
        <SignInButton variant="pill" className="watch-signin" />
        <span className={`stream-flag stream-flag-${flag.tone}`} title={flag.title}>
          {flag.label}
        </span>
      </motion.header>

      <div className="watch-stage">
        <motion.div
          className={`player-shell${isFaux ? " player-shell-fs" : ""}`}
          ref={shellRef}
          layoutId={layoutId ?? undefined}
          transition={MORPH_SPRING}
          style={{ borderRadius: 16 }}
        >
          {playing && embedFailures < 2 ? (
            <>
              {timMounted && timChannel !== null ? (
                <iframe
                  key={`tim-${timChannel.url}-${timFallback ? "ads" : "sb"}`}
                  className="player-embed"
                  src={timChannel.url}
                  // The mount contract, corrected 2026-10-18 night
                  // (docs/tim-ad-popups.md, AGENTS.md dated facts): keep
                  // `allow-same-origin` and the DEFAULT referrer policy or
                  // their guard kills the player (opaque origin, storage
                  // throw, empty referrer), and never add `allow-popups` -
                  // that token is exactly what their ad script uses. The
                  // sandbox's frameElement check is dead code across
                  // origins, so the source frame's own tokens pass and the
                  // ad tabs are blocked outright. The fallback mount (the
                  // "Load with their ads" affordance) drops the sandbox for
                  // this mount only and shows the ad warning - their
                  // player may refuse to run sandboxed one day and the
                  // cross-origin refusal is a silent still frame.
                  sandbox={timFallback ? undefined : "allow-scripts allow-same-origin"}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  title={`Live channel ${timChannel.name} from the tim-streams second source, in its own player`}
                  onLoad={() => {
                    setEmbedReady(true);
                  }}
                />
              ) : embedMounted ? (
                <iframe
                  key={`${embedMode}-${embedEpoch}`}
                  ref={embedFrameRef}
                  className={`player-embed${pageZoomStyle !== undefined ? " player-embed-zoom" : ""}`}
                  style={pageZoomStyle}
                  // The crop is a viewport-relative pan: scrolling the embedded
                  // page inside the frame would slide the video out of it, so
                  // the frame is locked while zoomed (their own page has
                  // nothing worth scrolling to below the video anyway).
                  scrolling={pageZoomStyle !== undefined ? "no" : undefined}
                  src={embedSrc}
                  title={
                    embedMode === "player"
                      ? "Live bare player embedded from the source site's player host, verified before mounting"
                      : noAdUrl !== null
                        ? "Live match page from a mirror whose banner config is empty"
                        : "Live match page embedded from the source site"
                  }
                  sandbox="allow-scripts allow-same-origin"
                  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                  // Default policy sends our origin as Referer. The source's
                  // player JS allowlists referrer domains (params
                  // playSiteDomains; the direct-player toggle is hidden when
                  // we are not on it), and the page embed passes because its
                  // nested player carries the source's own domain instead.
                  referrerPolicy="no-referrer-when-downgrade"
                  onLoad={() => {
                    setEmbedLoads((count) => count + 1);
                    setEmbedReady(true);
                  }}
                />
              ) : null}
              {/* The kick cover: hides the shell-sized mount geometry and the
                  relayout tail until the crop has snapped in, then fades -
                  so the first thing the visitor sees is the centered video,
                  not the frame's plain page. Source embed only: a second-
                  source frame fills the shell as-is. */}
              {!timMounted && embedMode === "page" && zoom ? (
                <div aria-hidden className={`player-embed-kick-cover${zoomKickDone ? " is-done" : ""}`} />
              ) : null}
              {!timMounted && pageZoomStyle !== undefined && embedMounted && hideAds && noAdUrl === null ? (
                <>
                  {/* Opt-in drift covers: their framed layout can still
                      reflow the video anchor inside the crop after their
                      banners settle; sized to the residual drift band (see
                      PAGE_EMBED_MASK). Off by default - most visitors see
                      the source's ads rather than a cropped picture. */}
                  <div
                    aria-hidden
                    className="player-embed-mask"
                    style={{ top: 0, height: `${(PAGE_EMBED_MASK.top / PAGE_EMBED_VIDEO.h) * 100}%` }}
                  />
                  <div
                    aria-hidden
                    className="player-embed-mask"
                    style={{ bottom: 0, height: `${(PAGE_EMBED_MASK.bottom / PAGE_EMBED_VIDEO.h) * 100}%` }}
                  />
                </>
              ) : null}
              {!embedReady ? (
                <div className="player-embed-loading" role="status">
                  <span className="player-note-dot" />
                  {timMounted
                    ? "Connecting to the second source…"
                    : (embedMode === "player" && !embedMounted) || noAdPending
                    ? "Verifying the live source…"
                    : embedFailures === 0
                      ? "Connecting to live source…"
                      : "Reconnecting to a fresh live source…"}
                </div>
              ) : null}
              {/* In fullscreen the toolbar below is off screen, so the
                  controls ride inside the frame for the duration. The faux
                  overlay covers the toolbar's lane too, so it shares this. */}
              {shellMaximized ? (
                <div className={`player-embed-bar${chromeIdle ? " is-idle" : ""}`} data-tv-scope data-tv-row="fullscreen">
                  {embedControls}
                </div>
              ) : null}
              {/* The faux overlay on a portrait phone shows a landscape video
                  letterboxed; the hint hands the visitor the bigger picture. */}
              {isFaux ? (
                <div className="player-shell-rotate" aria-hidden>
                  Rotate for a bigger picture
                </div>
              ) : null}
              {playerNotice !== null ? (
                <div className="player-embed-denied" role="status">
                  {playerNotice}
                </div>
              ) : null}
              {quietNotice !== null ? (
                <div className="player-embed-denied" role="status">
                  {quietNotice}
                </div>
              ) : null}
              {/* The second source's stage notes, per docs/tim-ad-popups.md.
                  Default (sandboxed) mount: their ad tabs are blocked, but
                  their player cannot be probed across the origin boundary -
                  a silent refusal would look like a still frame - so a
                  quiet, dismissible affordance offers the one escape hatch:
                  remounting the same channel with their ads. Fallback
                  mount (this mount only): the ad-tab warning, because
                  unsandboxed their popunder eats the first trusted click
                  and every re-armed later one (AGENTS.md dated facts). */}
              {timMounted && !timFallback && timHintOpen ? (
                <div className="player-embed-denied player-tim-notice" role="status" data-tv-row="stage">
                  <span className="player-tim-notice-text">
                    Second-source stream with their ads blocked. Not playing?
                  </span>
                  <button
                    type="button"
                    className="player-tim-notice-action"
                    onClick={useTimFallback}
                  >
                    Load with their ads
                  </button>
                  <button
                    className="player-tim-notice-close"
                    onClick={() => setTimHintOpen(false)}
                    aria-label="Dismiss note"
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ) : null}
              {timMounted && timFallback && timNoticeOpen ? (
                <div className="player-embed-denied player-tim-notice" role="status" data-tv-row="stage">
                  <span className="player-tim-notice-text">
                    Second-source stream without the ad block: the first play click may open an ad tab. Close it and click play again.
                  </span>
                  <button
                    className="player-tim-notice-close"
                    onClick={() => setTimNoticeOpen(false)}
                    aria-label="Dismiss note"
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ) : null}
            </>
          ) : playing ? (
            <div className="player-embed-failed" data-tv-row="stage">
              <Notice
                icon="📡"
                title="Live source unreachable"
                body="The source site did not answer even after a fresh domain lookup - the operator may be mid-rotation. The feed keeps updating in the background; retry in a moment."
                action={{ label: "Retry live source", onClick: retryEmbed }}
              />
            </div>
          ) : (
            <>
              <div className="player-art" aria-hidden />
              <div className="player-scanlines" aria-hidden />
              <div className="player-grid" aria-hidden />

              <button
                className="player-play"
                onClick={startEmbed}
                aria-label="Play the live match embed"
                title="Play the live match from the source site"
              >
                <Icon name="play" size={26} />
              </button>

              <div className="player-status">
                <StatusBadge match={match} />
              </div>

              <div className="player-score">
                {match.titleOnly ? (
                  <div className="player-event" lang="en">
                    {match.home.name}
                  </div>
                ) : (
                  <>
                    <div className="player-side">
                      <Crest src={match.home.badge} name={match.home.name} size={64} />
                      <span className="player-side-name" lang="en">
                        {match.home.name}
                      </span>
                    </div>
                    <div className="player-count">
                      {scored ? (
                        <div className="player-count-score">
                          {match.homeScore}
                          <span className="player-count-divider">–</span>
                          {match.awayScore}
                        </div>
                      ) : (
                        <div className="player-count-time">{match.kickoff ? formatTime(match.kickoff) : "TBD"}</div>
                      )}
                      <span className="player-count-hint">{kickHint(match)}</span>
                    </div>
                    <div className="player-side">
                      <Crest src={match.away.badge} name={match.away.name} size={64} />
                      <span className="player-side-name" lang="en">
                        {match.away.name}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="player-note">
                <span className="player-note-dot" />
                Simulated feed - press play for the live stream
              </div>
            </>
          )}
        </motion.div>
      </div>

      <motion.div
        className="watch-body"
        initial={layoutId ? { opacity: 0, y: 12 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1], delay: layoutId ? 0.12 : 0 }}
      >
        <div className="watch-headline">
          <div className="watch-headline-text">
            <div className="hero-eyebrow">
              <Crest src={match.league.badge} name={match.league.name} size={18} />
              {match.league.name} · {match.sport}
            </div>
            <h1 className="watch-title">{matchLabel(match)}</h1>
            <div className="hero-meta">
              <StatusBadge match={match} />
              {scored ? (
                <span className="hero-score">
                  {match.homeScore} – {match.awayScore}
                </span>
              ) : (
                <span>{kickoffLabel(match, true)}</span>
              )}
              {match.country ? <span className="hero-meta-dim">{match.country}</span> : null}
            </div>
          </div>
          {/*
              The toolbar floats (see .watch-toolbar-lane in watch.css): a
              fixed lane centers the pill over the layer, always in reach
              without scrolling. Two plain layers on purpose - old TV
              WebViews resolve over-constrained fixed boxes differently,
              so the lane centers with flexbox and the pill sizes itself.
              The spring ride-in runs once on mount; the transform
              animations belong to motion. */
            }
            <div className={`watch-toolbar-lane${chromeIdle ? " is-idle" : ""}`}>
              <motion.div
                className="watch-toolbar"
                role="toolbar"
                aria-label="Player controls"
                data-tv-row="controls"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", bounce: 0.16, duration: 0.55, delay: layoutId ? 0.22 : 0.05 }}
              >
            {playing ? (
              <>
                {embedMode === "page" && (streamOptions.length > 0 || timChannels.length > 0) ? (
                  <ServerMenu
                    options={streamOptions}
                    activeStreamId={activeStreamId}
                    onChoose={chooseStream}
                    timChannels={timChannels}
                    activeTimUrl={timChannel?.url ?? null}
                    onChooseTim={chooseTimChannel}
                  />
                ) : null}
                {embedControls}
              </>
            ) : (
              <>
                <button className="button-primary" onClick={startEmbed} data-tv-default>
                  <Icon name="play" size={14} />
                  {live ? "Play Live" : "Open Stream"}
                </button>
                {match.status.kind === "upcoming" && match.kickoff ? (
                  <button className="button-tinted" onClick={() => downloadCalendarEvent(match)}>
                    <Icon name="calendar" size={16} />
                    Add to Calendar
                  </button>
                ) : null}
                <button className="button-tinted" onClick={() => onMore(match)}>
                  Details
                </button>
              </>
            )}
              </motion.div>
            </div>

            {/*
                The one-time welcome note (see WATCH_INTRO_KEY): the
                scrim itself is the flex layer that centres the card
                (plain flexbox - no transform fights with motion), the
                card carries the ad explainer. D-pad friendly: the
                action button takes focus on open, Enter confirms,
                Escape or the scrim dismisses.
              */}
            <AnimatePresence>
              {introOpen ? (
                <motion.div
                  key="watch-intro"
                  className="scrim watch-intro-layer"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  onClick={() => setIntroOpen(false)}
                >
                  <motion.div
                    className="watch-intro"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="watch-intro-title"
                    initial={{ opacity: 0, scale: 0.96, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: 8 }}
                    transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <h2 id="watch-intro-title">{WATCH_INTRO_COPY.title}</h2>
                    <p>{WATCH_INTRO_COPY.body}</p>
                    <button className="button-primary" autoFocus onClick={confirmIntro}>
                      <Icon name="play" size={14} />
                      {WATCH_INTRO_COPY.cta}
                    </button>
                  </motion.div>
                </motion.div>
              ) : null}
            </AnimatePresence>
        </div>

        <dl className="stream-meta">
          {match.kickoff ? (
            <div className="stream-meta-cell">
              <dt>{live ? "Started" : "Kick-off"}</dt>
              <dd>{`${formatLongDate(match.kickoff)}, ${formatTime(match.kickoff)}`}</dd>
            </div>
          ) : null}
          {match.country ? (
            <div className="stream-meta-cell">
              <dt>Country</dt>
              <dd>{match.country}</dd>
            </div>
          ) : null}
          {match.odds ? (
            <div className="stream-meta-cell">
              <dt>Odds</dt>
              <dd>{match.odds.join(" · ")}</dd>
            </div>
          ) : null}
          <div className="stream-meta-cell stream-meta-cell-wide">
            <dt>Source</dt>
            <dd>
              <a
                className="stream-route"
                href={sourceUrl(href, origin)}
                target="_blank"
                rel="noopener noreferrer"
                title="Open the real match page on the source site (new tab)"
              >
                {href}
              </a>
            </dd>
          </div>
        </dl>

        {related.length > 0 ? (
          <div data-tv-row="related">
            <Shelf title="Also Live" count={related.length}>
              {related.map((other) => (
                <MatchCard key={other.id} match={other} layoutId={`art-related-${other.id}`} onOpen={onOpen} onMore={onMore} />
              ))}
            </Shelf>
          </div>
        ) : null}
      </motion.div>
    </div>
  );
};

/** Player-shaped skeleton shown while the deep-linked match is still loading from the feed. */
export const StreamSkeleton = ({ onExit }: { onExit: () => void }) => (
  <div className="watch">
    <header className="watch-top">
      <button className="back-pill back-pill-static" onClick={onExit} aria-label="Back">
        <Icon name="chevron-left" size={16} />
        <span className="back-pill-label">Back</span>
      </button>
    </header>
    <div className="watch-stage">
      <div className="player-shell player-shell-skeleton" aria-label="Loading match" style={{ borderRadius: 16 }}>
        <div className="player-art" aria-hidden />
        <motion.div
          className="stream-skeleton-bar"
          initial={{ opacity: 0.4 }}
          animate={{ opacity: 1 }}
          transition={{ repeat: Infinity, repeatType: "reverse", duration: 1 }}
        />
      </div>
    </div>
    <div className="watch-body">
      <div className="stream-skeleton-title" aria-hidden />
    </div>
  </div>
);

/** Shown when the deep link doesn't match anything in the current live window. */
export const StreamUnavailable = ({ onExit }: { onExit: () => void }) => (
  <div className="watch">
    <header className="watch-top">
      <button className="back-pill back-pill-static" onClick={onExit} aria-label="Back">
        <Icon name="chevron-left" size={16} />
        <span className="back-pill-label">Back</span>
      </button>
    </header>
    <div className="stream-unavailable">
      <Notice
        icon="📺"
        title="Stream unavailable"
        body="This match is no longer in the live feed - the feed only covers a window around kick-off. Head back to browse what's on right now."
        action={{ label: "Back to Scoreline", onClick: onExit }}
      />
    </div>
  </div>
);
