import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchLiveExtraSports, fetchLivePopular } from "./api/aelive";
import { AlertsHost } from "./alerts/AlertsHost";
import { AuthGate } from "./auth/AuthGate";
import { SignInButton } from "./auth/SignInButton";
import { MatchSheet } from "./components/MatchSheet";
import { Sidebar, TabBar } from "./components/Sidebar";
import { EASE_OUT, type OpenMatch } from "./components/tv";
import { TOP_CATEGORIES, byPriority, categoryForSlug } from "./domain/categories";
import { byKickoff, type Match } from "./domain/match";
import { canWatch, matchHref } from "./lib/route";
import { navigate, useLocation, type BrowseRoute, type Route } from "./lib/router";
import { useAsync } from "./lib/useAsync";
import { useMediaQuery } from "./lib/useMediaQuery";
import { useTvMode } from "./lib/tvmode";
import { useTvNavigation } from "./lib/tvnav";
import { CategoryScreen } from "./screens/CategoryScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { LeaguesScreen } from "./screens/LeaguesScreen";
import { LinkScreen } from "./screens/LinkScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { StreamScreen, StreamSkeleton, StreamUnavailable } from "./screens/StreamScreen";
import { TablesScreen } from "./screens/TablesScreen";
import { WatchLayer } from "./screens/WatchLayer";

const PHONE_QUERY = "(max-width: 739px)";
const TABLET_QUERY = "(min-width: 740px) and (max-width: 1099px)";
const SIDEBAR_KEY = "scoreline:sidebar-collapsed";

const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
};

const writeCollapsed = (value: boolean) => {
  try {
    localStorage.setItem(SIDEBAR_KEY, value ? "1" : "0");
  } catch {
    // Private mode or quota: the preference just does not persist.
  }
};

/**
 * Sidebar width is user-controlled while browsing (persisted), forced to
 * the icon rail on tablets, and auto-collapsed on every watch screen so
 * the frame gets the width. Expanding it mid-watch is remembered for that
 * match only; the next stream collapses it again.
 */
const useSidebarRail = (tablet: boolean, watchingHref: string | null) => {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [expandedFor, setExpandedFor] = useState<string | null>(null);

  const rail = tablet || (watchingHref !== null ? expandedFor !== watchingHref : collapsed);
  const toggle = useCallback(() => {
    if (watchingHref !== null) {
      setExpandedFor((current) => (current === watchingHref ? null : watchingHref));
      return;
    }
    setCollapsed((current) => {
      writeCollapsed(!current);
      return !current;
    });
  }, [watchingHref]);

  // The browse surface keeps the user's width even while a stream is on
  // top: it is covered anyway, and reflowing it there would compete with
  // the card -> frame morph for the main thread.
  return { rail, browseRail: tablet || collapsed, toggle: tablet ? undefined : toggle };
};

/**
 * The live feed is the app's single data source. The curated popular set
 * loads immediately (one request); extra sports are hydrated in the
 * background with spaced requests to stay under the Cloudflare rate limit.
 *
 * `paused` (any watch session, since 2026-10-17) stops both pollers:
 * no background requests, and no re-render of whatever shows the data while
 * the visitor watches. Resuming catches up in the background immediately
 * (see useAsync), so a long pause never leaves stale scores on screen for a
 * full interval afterwards.
 */
const useLiveFeed = (paused: boolean) => {
  const { state: core, reload } = useAsync("live-core", fetchLivePopular, 60_000, paused);
  const { state: extras } = useAsync("live-extras", fetchLiveExtraSports, 180_000, paused);

  const matches = useMemo(() => {
    const coreMatches = core.status === "ready" ? core.data : [];
    const extraMatches = extras.status === "ready" ? extras.data : [];
    const byId = new Map<string, Match>();
    for (const match of [...coreMatches, ...extraMatches]) byId.set(match.id, match);
    return [...byId.values()].sort(byKickoff);
  }, [core, extras]);

  return {
    matches,
    loading: (core.status === "loading" || extras.status === "loading") && matches.length === 0,
    error: core.status === "error" && matches.length === 0 ? core.message : null,
    reload,
  };
};

/** A stable key per browse surface, so switching sections re-runs the enter animation. */
const browseKey = (route: BrowseRoute): string => {
  switch (route.kind) {
    case "home":
      return "home";
    case "live":
      return "live";
    case "sport":
      return `sport:${route.slug}`;
    case "leagues":
      return `leagues:${route.leagueId ?? ""}`;
    case "tables":
      return "tables";
    case "search":
      return "search";
    case "link":
      return "link";
  }
};

export const App = () => {
  const location = useLocation();
  const phone = useMediaQuery(PHONE_QUERY);
  // TV Mode is the D-pad contract (see lib/tvmode.ts): the spatial
  // navigation mounts app-wide only while it is on, so a pointer-driven
  // browser keeps the native arrow behaviour (scrolling the page).
  const tv = useTvMode();
  useTvNavigation(tv === "on");
  // The match route riding on top of the browse surface, if any. Computed
  // up front because the watch-session feed pause depends on it.
  const watching = location.route.kind === "match" ? location.route : null;
  const feed = useLiveFeed(watching !== null);
  const [selected, setSelected] = useState<Match | null>(null);
  const closeSheet = useCallback(() => setSelected(null), []);

  /**
   * Closing the watch layer always lands on the homepage - a jump, not a
   * history walk, so a stream opened from any section (or from another
   * stream via the related shelf) exits straight to home instead of
   * popping back one URL at a time. Replacing (not pushing) drops the
   * stream URL from the stack, so the browser's back can never re-open
   * the stream, and keepScroll keeps the frozen document scroll so the
   * feed underneath is exactly where the user left it.
   */
  const exitWatch = useCallback(() => navigate("/", { replace: true, keepScroll: true }), []);

  // The browse surface stays mounted under the watch layer, so it needs to
  // remember which section it was showing when a match deep link is on top.
  const lastBrowse = useRef<BrowseRoute>(location.route.kind === "match" ? { kind: "home" } : location.route);
  if (location.route.kind !== "match") lastBrowse.current = location.route;
  const browseRoute = lastBrowse.current;
  const tablet = useMediaQuery(TABLET_QUERY);
  const sidebar = useSidebarRail(tablet, watching?.href ?? null);

  // Body scroll belongs to whichever surface is on top. A class, not an
  // inline overflow, so it cannot restore a stale "hidden" left by the gate.
  useEffect(() => {
    if (watching === null) return;
    document.body.classList.add("scoreline-watch-lock");
    return () => {
      document.body.classList.remove("scoreline-watch-lock");
    };
  }, [watching !== null]);

  useEffect(() => {
    if (watching === null) return;
    const onKey = (event: KeyboardEvent) => {
      // The watch screen's faux fullscreen (no-API phones and refused
      // requests) has no browser-level Esc handling, so it owns the first
      // Esc itself - the layer only closes once the shell has shrunk back.
      if (document.fullscreenElement === null && document.querySelector(".player-shell-fs") !== null) return;
      if (event.key === "Escape" && document.fullscreenElement === null && selected === null) exitWatch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [watching !== null, selected]);

  /**
   * Opening a match: watchable fixtures go straight to the watch screen in
   * this tab, morphing out of the card that was clicked; anything without a
   * stream route opens the detail sheet instead. A live match starts
   * playing on arrival - the click is the activation.
   */
  const openMatch = useCallback<OpenMatch>(
    (match, layoutId) => {
      const href = matchHref(match);
      if (href === null) {
        setSelected(match);
        return;
      }
      setSelected(null);
      navigate(href, { origin: phone ? undefined : layoutId, autoplay: true });
    },
    [phone],
  );

  /** The sheet's Watch button: same destination, no card to morph from. */
  const watchFromSheet = useCallback((match: Match) => {
    const href = matchHref(match);
    if (href === null) return;
    setSelected(null);
    navigate(href, { autoplay: true });
  }, []);

  const streamMatchLive =
    watching === null ? null : (feed.matches.find((candidate) => candidate.id === `ae-${watching.match.matchId}`) ?? null);
  // The live feed flaps one pass at a time: a transient "no data this tick"
  // (per-sport 499s with an empty body) parses as zero rows, the watched row
  // leaves `feed.matches` for exactly one render, and a StreamScreen mounted
  // on `key={streamMatch.id}` would unmount and remount - resetting `playing`
  // (deep-link arrivals carry no autoplay to recover it) and reloading the
  // embed mid-watch. Latch the last good row for the current route so a
  // mounted screen survives the flap; the latch is per-href, so a genuinely
  // absent match still renders StreamUnavailable on arrival, and any fresh
  // poll row replaces the latch the moment it exists again.
  const lastStreamMatch = useRef<{ href: string; match: Match } | null>(null);
  if (watching !== null && streamMatchLive !== null) {
    lastStreamMatch.current = { href: watching.href, match: streamMatchLive };
  }
  const streamMatch =
    watching === null
      ? null
      : lastStreamMatch.current !== null && lastStreamMatch.current.href === watching.href
        ? lastStreamMatch.current.match
        : streamMatchLive;
  const related = useMemo(
    () =>
      streamMatch === null
        ? []
        : feed.matches
            .filter((candidate) => candidate.id !== streamMatch.id && candidate.status.kind === "live" && canWatch(candidate))
            .sort((a, b) => {
              const sameSport = (match: Match) => (match.sport === streamMatch.sport ? 0 : 1);
              return sameSport(a) - sameSport(b) || byPriority(a, b);
            })
            .slice(0, 12),
    [feed.matches, streamMatch],
  );

  const browse = (() => {
    switch (browseRoute.kind) {
      case "home":
        return (
          <HomeScreen
            matches={feed.matches}
            loading={feed.loading}
            error={feed.error}
            onRetry={feed.reload}
            onOpen={openMatch}
            onMore={setSelected}
            phone={phone}
            route={browseRoute}
          />
        );
      case "live":
      case "sport": {
        const category =
          browseRoute.kind === "live" ? TOP_CATEGORIES[0] : categoryForSlug(browseRoute.slug, feed.matches);
        if (!category)
          return (
            <HomeScreen
              matches={feed.matches}
              loading={feed.loading}
              error={feed.error}
              onRetry={feed.reload}
              onOpen={openMatch}
              onMore={setSelected}
              phone={phone}
              route={browseRoute}
            />
          );
        return (
          <CategoryScreen category={category} matches={feed.matches} loading={feed.loading} onOpen={openMatch} onMore={setSelected} />
        );
      }
      case "leagues":
        return <LeaguesScreen matches={feed.matches} leagueId={browseRoute.leagueId} onOpen={openMatch} onMore={setSelected} />;
      case "tables":
        return <TablesScreen code={browseRoute.code} />;
      case "search":
        return <SearchScreen route={browseRoute} matches={feed.matches} onOpen={openMatch} onMore={setSelected} />;
      case "link":
        return <LinkScreen code={browseRoute.code} />;
    }
  })();

  // The browse surface unmounts while a stream is on top (2026-10-17):
  // an inert-but-mounted home page still costs the DOM tree, its images and
  // every feed-driven re-render, and a smart TV running everything in one
  // WebView process feels that cost as hour-two latency. Re-mounting on
  // close is a brief skeleton pass - the feed data is already cached.
  const showBrowse = watching === null;

  const shellRoute: Route = watching ?? browseRoute;

  return (
    <MotionConfig reducedMotion="always">
      <div
        className={[
          "frame",
          watching ? "is-watching" : "",
          !phone && sidebar.rail ? "is-rail" : "",
          !phone && sidebar.browseRail ? "is-rail-browse" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {phone ? null : <Sidebar route={shellRoute} matches={feed.matches} rail={sidebar.rail} onToggle={sidebar.toggle} />}

        <main className="content" inert={watching !== null ? true : undefined}>
          {showBrowse ? (
            <motion.div
              key={browseKey(browseRoute)}
              className="content-enter"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
            >
              {browse}
            </motion.div>
          ) : null}
        </main>

        {phone && watching === null ? <TabBar route={shellRoute} /> : null}
        {phone && watching === null && browseRoute.kind !== "home" ? <SignInButton variant="pill" className="signin-floating" /> : null}

        <AnimatePresence>
          {watching !== null ? (
            <WatchLayer key="watch" phone={phone} onDismiss={exitWatch}>
              {streamMatch !== null ? (
                <StreamScreen
                  key={streamMatch.id}
                  match={streamMatch}
                  href={watching.href}
                  layoutId={phone ? null : (location.state.origin ?? null)}
                  autoplay={location.state.autoplay === true}
                  related={related}
                  onExit={exitWatch}
                  onOpen={openMatch}
                  onMore={setSelected}
                />
              ) : feed.loading ? (
                <StreamSkeleton onExit={exitWatch} />
              ) : (
                <StreamUnavailable onExit={exitWatch} />
              )}
            </WatchLayer>
          ) : null}
        </AnimatePresence>

        <MatchSheet match={selected} onClose={closeSheet} onWatch={watchFromSheet} />
        <AlertsHost watching={watching !== null} />
        <AuthGate />
      </div>
    </MotionConfig>
  );
};
