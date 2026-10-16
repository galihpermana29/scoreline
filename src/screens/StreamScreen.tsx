import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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
import { usePlayerHosts } from "../lib/usePlayerHosts";
import { downloadCalendarEvent } from "../lib/calendar";

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
 * Fullscreen is ours, not theirs (verified 2026-10-16): the embedded player's
 * own fullscreen button calls requestFullscreen() from inside a nested
 * cross-origin frame (ours -> their player or mirror chain), a request
 * Chrome treats per-origin and can prompt for or silently block. This screen
 * instead fullscreens its own .player-shell from the top document, which
 * needs no permission delegation at all, so the control works no matter how
 * the source site re-wires its own embed.
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
 * stream), and the optional "Hide ads" toolbar toggle opts into the
 * PAGE_EMBED_MASK overlays - plain black bars over the drift band - at
 * the price of cropping those strips off the picture too. The choice is
 * remembered per browser.
 */
const PAGE_EMBED_BASE = { width: 750, height: 10000 } as const;
const PAGE_EMBED_VIDEO = { x: 0, y: 80, w: 750, h: (750 * 9) / 16 } as const;
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
  title: "Selamat menonton di Scoreline!",
  body:
    "Perhatian: Iklan masih akan ditampilkan, namun dalam jumlah yang sangat terbatas. Untuk menghilangkannya, silakan klik iklan tersebut atau gunakan fitur Ads Guard yang tersedia di toolbar.",
  cta: "Mulai menonton",
} as const;

const kickHint = (match: Match): string =>
  match.status.kind === "live" ? "In progress" : match.status.kind === "upcoming" ? "Kick-off" : "Final";

export const StreamScreen = ({
  match,
  href,
  layoutId,
  autoplay,
  related,
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
  onExit: () => void;
  onOpen: OpenMatch;
  onMore: (match: Match) => void;
}) => {
  const scored = match.homeScore !== null && match.awayScore !== null && match.status.kind !== "upcoming";
  const live = match.status.kind === "live";
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
  const [embedEpoch, setEmbedEpoch] = useState(0);
  const [embedFailures, setEmbedFailures] = useState(0);

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
  // The frame mounts only on verified ground in player mode; while the
  // probe is choosing, the loading overlay stands in for it.
  const embedMounted = embedMode === "page" || playerPickUrl !== null;
  const embedSrc = playerPickUrl !== null ? playerPickUrl : sourceUrl(href, origin);

  // Fullscreen state mirrors document.fullscreenElement so the control stays
  // in sync even when the browser exits fullscreen on its own (Esc key).
  const shellRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Set when the browser itself denies a requestFullscreen; browsers give no
  // event for this, so it is cleared on the next change or after a pause.
  const [fullscreenDenied, setFullscreenDenied] = useState(false);

  useEffect(() => {
    const sync = () => {
      setIsFullscreen(document.fullscreenElement !== null);
      setFullscreenDenied(false);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    if (!fullscreenDenied) return;
    const timer = setTimeout(() => setFullscreenDenied(false), 4000);
    return () => clearTimeout(timer);
  }, [fullscreenDenied]);

  // The zoom crop's on/off: on by default, remembered across visits.
  const [zoom, setZoom] = useState(() => {
    try {
      return localStorage.getItem(PAGE_ZOOM_KEY) !== "0";
    } catch {
      return true;
    }
  });
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

  // The opt-in counterpart to the crop: by default the source's ads are
  // shown as-is (the visitor consented to them by watching this embed at
  // all), and only a visitor who flips this toggle gets the PAGE_EMBED_MASK
  // black bars over the bands their layout drifts into the crop.
  const [hideAds, setHideAds] = useState(() => {
    try {
      return localStorage.getItem(HIDE_ADS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleHideAds = () =>
    setHideAds((current) => {
      try {
        localStorage.setItem(HIDE_ADS_KEY, current ? "0" : "1");
      } catch {
        // Private mode: the preference just does not persist.
      }
      return !current;
    });

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
    const scale = Math.max(w / PAGE_EMBED_VIDEO.w, h / PAGE_EMBED_VIDEO.h);
    const tx = w / 2 - (PAGE_EMBED_VIDEO.x + PAGE_EMBED_VIDEO.w / 2) * scale;
    const ty = h / 2 - (PAGE_EMBED_VIDEO.y + PAGE_EMBED_VIDEO.h / 2) * scale;
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
      if (event.key === "Escape") setIntroOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [introOpen]);
  const stopEmbed = () => {
    setPlaying(false);
    setEmbedReady(false);
    setEmbedFailures(0);
    // Leaving fullscreen on stop returns the page to its normal layout
    // instead of showing the simulated shell stretched over the screen.
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
      // The page mode embeds the entry origin only, but reloading both costs
      // one extra request and keeps the player list warm for a mode switch.
      // Neither resolver throws by contract; the catches are hard guards.
      reloadOrigin(fresh).catch(() => undefined),
      reloadPlayerHosts(fresh).catch(() => undefined),
    ];
    void Promise.all(reloads).finally(() => setEmbedEpoch((epoch) => epoch + 1));
  };

  const retryEmbed = () => {
    setEmbedFailures(0);
    remountEmbed(true);
  };

  // Watchdog: a mounted frame that never signals load within the window is
  // treated as a dead or rotated host. First stall re-resolves the entry
  // origin and the player hosts from scratch and remounts once; a second
  // stall stops retrying on its own and swaps the frame for the explicit
  // retry notice.
  useEffect(() => {
    if (!playing || embedFailures >= 2 || embedReady) return;
    // Nothing to watch yet in player mode: the probe is still choosing the
    // host, and its own candidates carry the timeouts.
    if (embedMode === "player" && playerPickUrl === null) return;
    const timer = window.setTimeout(() => {
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
  }, [playing, embedReady, embedEpoch, embedFailures, reloadOrigin]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement !== null) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    shellRef.current?.requestFullscreen().catch(() => setFullscreenDenied(true));
  };

  const flag = playing
    ? embedFailures >= 2
      ? { label: "Source unreachable", tone: "warn" as const, title: "The live source is not answering; retrying is available below the player" }
      : embedMode === "player"
        ? { label: "Live player", tone: "live" as const, title: "The source site's bare player page is embedded directly, on the first listed player host that provably serves it" }
        : { label: "Live page embed", tone: "live" as const, title: "The source site's full match page is embedded, on its currently resolved domain" }
    : { label: "Simulated", tone: "idle" as const, title: "This frame plays no video until you press play - it is a local simulation" };

  // Icon-only controls (compact pill, one TV row; `title` carries the
  // tooltip on hover and `aria-label` keeps the names audible - the stopped
  // state's CTAs keep their words, these are settled muscle-memory pills).
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
          className={`toolbar-button${zoom ? " player-embed-mode-on" : ""}`}
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
          className={`toolbar-button${hideAds ? " player-embed-mode-on" : ""}`}
          onClick={toggleHideAds}
          aria-label="Ads guard"
          title={
            hideAds
              ? "Ads guard on: the banner bands that drift into the crop are masked black, at the price of cropping those strips off the picture - click to show the source's ads"
              : "Ads guard off - click to mask the banner bands that drift into the crop"
          }
        >
          <Icon name="shield" size={16} />
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
      <button
        className="toolbar-button"
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        title={isFullscreen ? "Leave fullscreen" : "Fullscreen the live embed (uses this page, not the player's own button)"}
      >
        <Icon name={isFullscreen ? "fullscreen-exit" : "fullscreen"} size={16} />
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

  return (
    <div className="watch">
      <motion.header
        className="watch-top"
        initial={layoutId ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: layoutId ? 0.1 : 0 }}
      >
        <button className="back-pill back-pill-static" onClick={onExit} aria-label="Back">
          <Icon name="chevron-left" size={16} />
          <span className="back-pill-label">Back</span>
        </button>
        <span className="watch-top-title">{matchLabel(match)}</span>
        <span className={`stream-flag stream-flag-${flag.tone}`} title={flag.title}>
          {flag.label}
        </span>
      </motion.header>

      <div className="watch-stage">
        <motion.div
          className="player-shell"
          ref={shellRef}
          layoutId={layoutId ?? undefined}
          transition={MORPH_SPRING}
          style={{ borderRadius: 16 }}
        >
          {playing && embedFailures < 2 ? (
            <>
              {embedMounted ? (
                <iframe
                  key={`${embedMode}-${embedEpoch}`}
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
                  not the frame's plain page. */}
              {embedMode === "page" && zoom ? (
                <div aria-hidden className={`player-embed-kick-cover${zoomKickDone ? " is-done" : ""}`} />
              ) : null}
              {pageZoomStyle !== undefined && embedMounted && hideAds ? (
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
                  {embedMode === "player" && !embedMounted
                    ? "Verifying the live source…"
                    : embedFailures === 0
                      ? "Connecting to live source…"
                      : "Reconnecting to a fresh live source…"}
                </div>
              ) : null}
              {/* In fullscreen the toolbar below is off screen, so the
                  controls ride inside the frame for the duration. */}
              {isFullscreen ? <div className="player-embed-bar">{embedControls}</div> : null}
              {fullscreenDenied ? (
                <div className="player-embed-denied" role="status">
                  Fullscreen was blocked by the browser
                </div>
              ) : null}
              {playerNotice !== null ? (
                <div className="player-embed-denied" role="status">
                  {playerNotice}
                </div>
              ) : null}
            </>
          ) : playing ? (
            <div className="player-embed-failed">
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
            <div className="watch-toolbar-lane">
              <motion.div
                className="watch-toolbar"
                role="toolbar"
                aria-label="Player controls"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", bounce: 0.16, duration: 0.55, delay: layoutId ? 0.22 : 0.05 }}
              >
            {playing ? (
              embedControls
            ) : (
              <>
                <button className="button-primary" onClick={startEmbed}>
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
          <Shelf title="Also Live" count={related.length}>
            {related.map((other) => (
              <MatchCard key={other.id} match={other} layoutId={`art-related-${other.id}`} onOpen={onOpen} onMore={onMore} />
            ))}
          </Shelf>
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
