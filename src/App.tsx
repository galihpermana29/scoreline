import { LayoutGroup, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchLiveExtraSports, fetchLivePopular } from "./api/aelive";
import { MatchSheet } from "./components/MatchSheet";
import { byKickoff, type League, type Match } from "./domain/match";
import { matchHref, parseMatchRoute, type MatchRoute } from "./lib/route";
import { useAsync } from "./lib/useAsync";
import { LeaguesScreen } from "./screens/LeaguesScreen";
import { MatchesScreen } from "./screens/MatchesScreen";
import { StreamScreen, StreamSkeleton, StreamUnavailable } from "./screens/StreamScreen";

type Tab = "matches" | "leagues";

const TABS: readonly { value: Tab; label: string }[] = [
  { value: "matches", label: "Matches" },
  { value: "leagues", label: "Leagues" },
];

/**
 * The live feed is the app's single data source. The curated popular set
 * loads immediately (one request); extra sports are hydrated in the
 * background with spaced requests to stay under the Cloudflare rate limit.
 */
const useLiveFeed = () => {
  const { state: core, reload } = useAsync("live-core", fetchLivePopular, 60_000);
  const { state: extras } = useAsync("live-extras", fetchLiveExtraSports, 180_000);

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

export const App = () => {
  const [tab, setTab] = useState<Tab>("matches");
  const [sport, setSport] = useState<string>("all");
  const [league, setLeague] = useState<League | null>(null);
  const [selected, setSelected] = useState<Match | null>(null);
  const [scrolled, setScrolled] = useState(false);
  // A deep link (/id/{sport}/{competitionSlug}-{id}/{matchSlug}.html) boots the
  // app straight into the simulated stream page for that match.
  const [route, setRoute] = useState<MatchRoute | null>(() => parseMatchRoute(window.location.pathname));
  const closeSheet = useCallback(() => setSelected(null), []);
  const feed = useLiveFeed();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parseMatchRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Opens the simulated stream page in a new tab; the feed powers its scoreboard. */
  const watchMatch = useCallback((match: Match) => {
    const href = matchHref(match);
    if (href !== null) window.open(href, "_blank", "noopener,noreferrer");
  }, []);

  /** Leaves the simulated stream and restores the normal app at "/". */
  const exitStream = useCallback(() => {
    if (parseMatchRoute(window.location.pathname) !== null) window.history.pushState({}, "", "/");
    setRoute(null);
  }, []);

  const openTab = (next: Tab) => {
    if (next === "leagues") setLeague(null);
    setTab(next);
    window.scrollTo({ top: 0 });
  };

  if (route !== null) {
    const streamMatch = feed.matches.find((candidate) => candidate.id === `ae-${route.matchId}`) ?? null;
    return (
      <MotionConfig reducedMotion="user">
        {streamMatch !== null ? (
          <StreamScreen key={streamMatch.id} match={streamMatch} href={window.location.pathname} onExit={exitStream} />
        ) : feed.loading ? (
          <StreamSkeleton />
        ) : (
          <StreamUnavailable onExit={exitStream} />
        )}
      </MotionConfig>
    );
  }

  const openLeague = (next: League | null) => {
    setLeague(next);
    window.scrollTo({ top: 0 });
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <header className={`topbar${scrolled ? " is-scrolled" : ""}`}>
          <div className="brand">
            <span className="brand-mark" aria-hidden>
              ▶
            </span>
            Scoreline
          </div>
          <LayoutGroup id="nav">
            <nav className="nav-pill" aria-label="Sections">
              {TABS.map((option) => {
                const active = option.value === tab;
                return (
                  <button
                    key={option.value}
                    className={`nav-item${active ? " is-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => openTab(option.value)}
                  >
                    {active ? (
                      <motion.span
                        layoutId="nav-thumb"
                        className="nav-thumb"
                        transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                      />
                    ) : null}
                    <span className="nav-label">{option.label}</span>
                  </button>
                );
              })}
            </nav>
          </LayoutGroup>
          <div className="topbar-end" />
        </header>

        <main className="main">
          {tab === "matches" ? (
            <MatchesScreen
              matches={feed.matches}
              loading={feed.loading}
              error={feed.error}
              onRetry={feed.reload}
              sport={sport}
              onSportChange={setSport}
              onSelect={setSelected}
              onWatch={watchMatch}
            />
          ) : (
            <LeaguesScreen matches={feed.matches} league={league} onOpenLeague={openLeague} onSelect={setSelected} />
          )}
        </main>

        <MatchSheet match={selected} onClose={closeSheet} onWatch={watchMatch} />
      </div>
    </MotionConfig>
  );
};