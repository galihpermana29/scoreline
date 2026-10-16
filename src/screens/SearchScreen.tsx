import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { SearchBox } from "../components/SearchBox";
import { LeagueTile, MatchCard, EASE_OUT, type OpenMatch } from "../components/tv";
import { Notice } from "../components/ui";
import { TOP_CATEGORIES, byPriority } from "../domain/categories";
import { SPORT_ICON, groupByLeague, type Match } from "../domain/match";
import { browsePath, navigate, type Route } from "../lib/router";

const normalise = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const haystack = (match: Match) =>
  normalise([match.home.name, match.away.name, match.league.name, match.sport, match.country ?? ""].join(" "));

/** Every whitespace-separated term must appear somewhere in the fixture. */
const matchesQuery = (match: Match, terms: readonly string[]) => {
  const text = haystack(match);
  return terms.every((term) => text.includes(term));
};

export const SearchScreen = ({
  route,
  matches,
  onOpen,
  onMore,
}: {
  route: Route;
  matches: readonly Match[];
  onOpen: OpenMatch;
  onMore: (match: Match) => void;
}) => {
  const query = route.kind === "search" ? route.query : "";
  const terms = useMemo(() => normalise(query).split(/\s+/).filter(Boolean), [query]);
  const hits = useMemo(
    () =>
      terms.length === 0
        ? []
        : matches
            .filter((match) => matchesQuery(match, terms))
            .sort((a, b) => (a.status.kind === "live" ? 0 : 1) - (b.status.kind === "live" ? 0 : 1) || byPriority(a, b)),
    [matches, terms],
  );
  const leagues = useMemo(() => (terms.length === 0 ? [] : groupByLeague(hits).slice(0, 12)), [hits, terms]);

  return (
    <div className="screen screen-padded search">
      <header className="page-head">
        <h1 className="page-title">Search</h1>
        <SearchBox route={route} className="search-field-page" autoFocus />
      </header>

      <AnimatePresence mode="popLayout" initial={false}>
        {terms.length === 0 ? (
          <motion.div
            key="suggestions"
            className="search-suggest"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
          >
            <h2 className="shelf-title">Browse by sport</h2>
            <div className="chips chips-wrap">
              {TOP_CATEGORIES.map((category) => (
                <button
                  key={category.slug}
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
          </motion.div>
        ) : (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
          >
            {hits.length === 0 ? (
              <Notice icon="🔍" title={`No results for “${query}”`} body="Try a team, a league or a sport name - the feed only covers events around their start time." />
            ) : (
              <>
                {leagues.length > 0 ? (
                  <section className="grid-section">
                    <h2 className="shelf-title">
                      Leagues <span className="shelf-count">{leagues.length}</span>
                    </h2>
                    <div className="tile-grid">
                      {leagues.map((group) => (
                        <LeagueTile
                          key={group.league.id}
                          league={group.league}
                          subtitle={group.matches[0]?.sport ?? ""}
                          count={group.matches.filter((match) => match.status.kind === "live").length}
                          onClick={() => navigate(browsePath({ kind: "leagues", leagueId: group.league.id }))}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}
                <section className="grid-section">
                  <h2 className="shelf-title">
                    Matches <span className="shelf-count">{hits.length}</span>
                  </h2>
                  <div className="card-grid">
                    {hits.map((match) => (
                      <MatchCard key={match.id} match={match} layoutId={`art-search-${match.id}`} onOpen={onOpen} onMore={onMore} />
                    ))}
                  </div>
                </section>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
