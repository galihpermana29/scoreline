import { useMemo } from "react";
import { fetchStandings, tableSpec } from "../api/standings";
import { BellButton } from "../alerts/BellButton";
import { StandingsSkeleton, StandingsTable } from "../components/StandingsTable";
import { Hero, LeagueTile, MatchCard, PromoBanner, Shelf, ShelfSkeleton, WideCard, type OpenMatch } from "../components/tv";
import { Icon } from "../components/icons";
import { Notice } from "../components/ui";
import { TOP_CATEGORIES, byPriority, extraCategories, footballLeagueTier, inCategory, matchBand, sportPriority } from "../domain/categories";
import { SPORT_ICON, byKickoff, groupByLeague, isWomens, type Match } from "../domain/match";
import { SearchBox } from "../components/SearchBox";
import { ThemeToggle } from "../components/ThemeToggle";
import { browsePath, navigate, type Route } from "../lib/router";
import { useAsync } from "../lib/useAsync";

/** Live first, then the next kick-offs; within each, the pinned sports lead, and inside football the tier leagues lead. */
export const pickFeatured = (matches: readonly Match[], limit = 5): Match[] => {
  const rank = (match: Match) =>
    (match.status.kind === "live" ? 0 : match.status.kind === "upcoming" ? 1 : 2) * 10 + matchBand(match);
  return [...matches]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        footballLeagueTier(a) - footballLeagueTier(b) ||
        (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0),
    )
    .slice(0, limit);
};

const PREVIEW_TABLES = ["pl", "laliga"] as const;

const StandingsPreview = () => {
  const { state: first } = useAsync(`standings-${PREVIEW_TABLES[0]}`, () => fetchStandings(PREVIEW_TABLES[0]));
  const { state: second } = useAsync(`standings-${PREVIEW_TABLES[1]}`, () => fetchStandings(PREVIEW_TABLES[1]));
  const states = [first, second];
  if (states.every((state) => state.status === "error")) return null;
  return (
    <section className="home-standings">
      <h2 className="shelf-title">
        <button className="shelf-link" onClick={() => navigate(browsePath({ kind: "tables", code: null }))}>
          League Standings
          <Icon name="chevron-right" size={14} />
        </button>
      </h2>
      <div className="home-standings-grid">
        {PREVIEW_TABLES.map((code, index) => {
          const spec = tableSpec(code);
          const state = states[index];
          if (spec === null || state === undefined || state.status === "error") return null;
          return state.status === "ready" ? (
            <StandingsTable
              key={code}
              spec={spec}
              table={state.data}
              limit={5}
              onOpen={() => navigate(browsePath({ kind: "tables", code }))}
            />
          ) : (
            <StandingsSkeleton key={code} rows={5} />
          );
        })}
      </div>
    </section>
  );
};

/** Horizontal category chips for phones, where the sidebar is not there to carry them. */
export const CategoryChips = ({ matches }: { matches: readonly Match[] }) => {
  const extras = extraCategories(matches);
  return (
    <div className="chips" role="list" aria-label="Sports">
      {[...TOP_CATEGORIES, ...extras].map((category) => (
        <button
          key={category.slug}
          role="listitem"
          className="chip"
          onClick={() =>
            navigate(category.slug === "live" ? browsePath({ kind: "live" }) : browsePath({ kind: "sport", slug: category.slug }))
          }
        >
          {category.slug === "live" ? (
            <span className="live-dot chip-dot" aria-hidden />
          ) : (
            <span aria-hidden>{SPORT_ICON[category.sport ?? ""] ?? "🏆"}</span>
          )}
          {category.label}
        </button>
      ))}
    </div>
  );
};

export const HomeScreen = ({
  matches,
  loading,
  error,
  onRetry,
  onOpen,
  onMore,
  phone,
  route,
}: {
  matches: readonly Match[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: OpenMatch;
  onMore: (match: Match) => void;
  phone: boolean;
  route: Route;
}) => {
  const sorted = useMemo(() => [...matches].sort(byKickoff), [matches]);
  const featured = useMemo(() => pickFeatured(sorted), [sorted]);
  const live = useMemo(() => sorted.filter((match) => match.status.kind === "live").sort(byPriority), [sorted]);
  const upcoming = useMemo(() => sorted.filter((match) => match.status.kind === "upcoming"), [sorted]);
  const results = useMemo(() => [...sorted.filter((match) => match.status.kind === "finished")].reverse(), [sorted]);

  // Headline fixtures for the wide cards: pinned sports first, live before
  // upcoming, men's only, skipping whatever the hero already leads with.
  const headline = useMemo(() => {
    const heroIds = new Set(featured.slice(0, 1).map((match) => match.id));
    return [...live, ...[...upcoming].sort(byPriority)]
      .filter((match) => !heroIds.has(match.id) && !match.titleOnly && !isWomens(match))
      .slice(0, 4);
  }, [featured, live, upcoming]);

  const sportShelves = useMemo(
    () =>
      TOP_CATEGORIES.filter((category) => category.sport !== null)
        .map((category) => ({
          category,
          matches: sorted
            .filter((match) => inCategory(match, category) && match.status.kind !== "finished")
            .sort(
              (a, b) =>
                (a.status.kind === "live" ? 0 : 1) - (b.status.kind === "live" ? 0 : 1) ||
                Number(isWomens(a)) - Number(isWomens(b)) ||
                footballLeagueTier(a) - footballLeagueTier(b) ||
                byKickoff(a, b),
            )
            .slice(0, 14),
        }))
        .filter((shelf) => shelf.matches.length > 0),
    [sorted],
  );

  const leagues = useMemo(
    () =>
      groupByLeague(sorted)
        .sort((a, b) => sportPriority(a.matches[0]?.sportId) - sportPriority(b.matches[0]?.sportId) || b.matches.length - a.matches.length)
        .slice(0, 14),
    [sorted],
  );

  const otherUpcoming = useMemo(
    () => upcoming.filter((match) => sportPriority(match.sportId) > TOP_CATEGORIES.length).slice(0, 20),
    [upcoming],
  );

  return (
    <div className="screen home">
      <div className="home-search">
        <SearchBox route={route} className="search-field-floating" />
        {phone ? (
          <>
            <BellButton variant="pill" />
            <ThemeToggle variant="pill" />
          </>
        ) : null}
      </div>
      {featured.length > 0 ? (
        <Hero matches={featured} onOpen={onOpen} onMore={onMore} />
      ) : (
        <div className="hero hero-placeholder" aria-hidden>
          <div className="hero-scrim" />
        </div>
      )}

      {phone ? <CategoryChips matches={matches} /> : null}

      {loading ? (
        <>
          <ShelfSkeleton />
          <ShelfSkeleton />
        </>
      ) : null}
      {error !== null ? (
        <Notice icon="⚠️" title="Couldn't load the live feed" body={error} action={{ label: "Try Again", onClick: onRetry }} />
      ) : null}
      {!loading && error === null && sorted.length === 0 ? (
        <Notice icon="📅" title="Nothing on right now" body="No live matches in the feed at this moment - it refreshes every minute." />
      ) : null}

      {live.length > 0 ? (
        <Shelf title="Live Now" count={live.length} onSeeAll={() => navigate(browsePath({ kind: "live" }))}>
          {live.slice(0, 16).map((match) => (
            <MatchCard key={match.id} match={match} layoutId={`art-live-${match.id}`} onOpen={onOpen} onMore={onMore} />
          ))}
        </Shelf>
      ) : null}

      {headline.length > 0 ? (
        <section className="wide-grid-section">
          <h2 className="shelf-title">Headline Fixtures</h2>
          <div className="wide-grid">
            {headline.map((match) => (
              <WideCard key={match.id} match={match} layoutId={`art-wide-${match.id}`} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ) : null}

      {sorted.length > 0 ? <PromoBanner onAction={() => navigate(browsePath({ kind: "live" }))} /> : null}

      {sportShelves.map(({ category, matches: shelfMatches }) => (
        <Shelf
          key={category.slug}
          title={category.title}
          count={shelfMatches.length}
          onSeeAll={() => navigate(browsePath({ kind: "sport", slug: category.slug }))}
        >
          {shelfMatches.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              layoutId={`art-${category.slug}-${match.id}`}
              onOpen={onOpen}
              onMore={onMore}
            />
          ))}
        </Shelf>
      ))}

      {leagues.length > 0 ? (
        <Shelf title="Leagues" variant="tiles" onSeeAll={() => navigate(browsePath({ kind: "leagues", leagueId: null }))}>
          {leagues.map((group) => (
            <LeagueTile
              key={group.league.id}
              league={group.league}
              subtitle={group.matches[0]?.sport ?? ""}
              count={group.matches.filter((match) => match.status.kind === "live").length}
              onClick={() => navigate(browsePath({ kind: "leagues", leagueId: group.league.id }))}
            />
          ))}
        </Shelf>
      ) : null}

      {sorted.length > 0 ? <StandingsPreview /> : null}

      {otherUpcoming.length > 0 ? (
        <Shelf title="Coming Up" count={otherUpcoming.length}>
          {otherUpcoming.map((match) => (
            <MatchCard key={match.id} match={match} layoutId={`art-upcoming-${match.id}`} onOpen={onOpen} onMore={onMore} />
          ))}
        </Shelf>
      ) : null}

      {results.length > 0 ? (
        <Shelf title="Results" count={results.length}>
          {results.slice(0, 20).map((match) => (
            <MatchCard key={match.id} match={match} layoutId={`art-results-${match.id}`} onOpen={onOpen} onMore={onMore} />
          ))}
        </Shelf>
      ) : null}

      <p className="footnote">
        Live scores and odds from a real-time feed across every sport, refreshed every minute. Times shown in your time
        zone.
      </p>
    </div>
  );
};
