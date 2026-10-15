import { useMemo } from "react";
import { Hero, MatchCard, Shelf, ShelfSkeleton, pickFeatured } from "../components/tv";
import { Notice } from "../components/ui";
import { SPORT_ICON, byKickoff, type Match } from "../domain/match";

type ShelfSpec = { title: string; matches: Match[] };

const shelvesFor = (sorted: readonly Match[]): ShelfSpec[] =>
  [
    { title: "Live Now", matches: sorted.filter((match) => match.status.kind === "live") },
    { title: "Coming Up", matches: sorted.filter((match) => match.status.kind === "upcoming") },
    {
      title: "Results",
      matches: [...sorted.filter((match) => match.status.kind === "finished")].reverse(),
    },
  ].filter((shelf) => shelf.matches.length > 0);

export const MatchesScreen = ({
  matches,
  loading,
  error,
  onRetry,
  sport,
  onSportChange,
  onSelect,
  onWatch,
}: {
  matches: readonly Match[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  sport: string;
  onSportChange: (sport: string) => void;
  onSelect: (match: Match) => void;
  onWatch: (match: Match) => void;
}) => {
  const sports = useMemo(() => {
    const counts = new Map<string, number>();
    for (const match of matches) counts.set(match.sport, (counts.get(match.sport) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);
  }, [matches]);

  const visible = useMemo(
    () => [...matches].filter((match) => sport === "all" || match.sport === sport).sort(byKickoff),
    [matches, sport],
  );
  const featured = useMemo(() => pickFeatured(visible), [visible]);
  const shelves = useMemo(() => shelvesFor(visible), [visible]);

  return (
    <div className="screen">
      {featured.length > 0 ? (
        <Hero matches={featured} onSelect={onSelect} onWatch={onWatch} />
      ) : (
        <div className="hero hero-placeholder" aria-hidden>
          <div className="hero-scrim" />
        </div>
      )}

      <div className="filters">
        <div className="pill-row" role="tablist" aria-label="Sport">
          <button
            role="tab"
            aria-selected={sport === "all"}
            className={`pill pill-quiet${sport === "all" ? " is-selected" : ""}`}
            onClick={() => onSportChange("all")}
          >
            All Sports
          </button>
          {sports.map((option) => (
            <button
              key={option}
              role="tab"
              aria-selected={sport === option}
              className={`pill pill-quiet${sport === option ? " is-selected" : ""}`}
              onClick={() => onSportChange(option)}
            >
              <span aria-hidden>{SPORT_ICON[option] ?? "🏆"}</span>
              {option}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <>
          <ShelfSkeleton />
          <ShelfSkeleton />
        </>
      ) : null}
      {error !== null ? (
        <Notice icon="⚠️" title="Couldn't load the live feed" body={error} action={{ label: "Try Again", onClick: onRetry }} />
      ) : null}
      {!loading && error === null && visible.length === 0 ? (
        <Notice icon="📅" title="Nothing on right now" body="No live matches in the feed at this moment - it refreshes every minute." />
      ) : null}

      {shelves.map((shelf) => (
        <Shelf key={shelf.title} title={shelf.title} count={shelf.matches.length}>
          {shelf.matches.map((match) => (
            <MatchCard key={match.id} match={match} onSelect={onSelect} />
          ))}
        </Shelf>
      ))}

      <p className="footnote">
        Live scores and odds from a real-time feed across every sport, refreshed every minute. Times shown in your time
        zone.
      </p>
    </div>
  );
};