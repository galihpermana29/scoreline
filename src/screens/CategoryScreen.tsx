import { useMemo } from "react";
import { Artwork, MatchCard, Shelf, type OpenMatch } from "../components/tv";
import { Notice } from "../components/ui";
import { byPriority, footballLeagueTier, inCategory, type Category } from "../domain/categories";
import { otherThumb, sportThumb } from "../domain/artwork";
import { byKickoff, type Match } from "../domain/match";

/**
 * One category - the cross-sport live view or a single sport. A banner
 * carries the sport's artwork; live and upcoming fixtures sit in grids so
 * the whole slate is visible at once, and results trail in a shelf.
 */
export const CategoryScreen = ({
  category,
  matches,
  loading,
  onOpen,
  onMore,
}: {
  category: Category;
  matches: readonly Match[];
  loading: boolean;
  onOpen: OpenMatch;
  onMore: (match: Match) => void;
}) => {
  const inScope = useMemo(() => matches.filter((match) => inCategory(match, category)), [matches, category]);
  const live = useMemo(() => inScope.filter((match) => match.status.kind === "live").sort(byPriority), [inScope]);
  const upcoming = useMemo(
    () =>
      inScope
        .filter((match) => match.status.kind === "upcoming")
        .sort((a, b) => footballLeagueTier(a) - footballLeagueTier(b) || byKickoff(a, b)),
    [inScope],
  );
  const results = useMemo(
    () => [...inScope.filter((match) => match.status.kind === "finished")].sort(byKickoff).reverse(),
    [inScope],
  );
  const art = category.sportId !== null ? sportThumb(category.sportId) : otherThumb(category.slug);

  return (
    <div className="screen">
      <section className="banner">
        <Artwork src={art} eager fallback={null} />
        <div className="banner-scrim" aria-hidden />
        <div className="banner-content">
          <h1 className="page-title">{category.title}</h1>
          <p className="banner-blurb">{category.blurb}</p>
          <div className="banner-stats">
            {live.length > 0 ? (
              <span className="badge badge-live">
                <span className="live-dot" aria-hidden />
                {live.length} live
              </span>
            ) : null}
            {upcoming.length > 0 ? <span className="badge">{upcoming.length} upcoming</span> : null}
          </div>
        </div>
      </section>

      {live.length > 0 ? (
        <section className="grid-section">
          <h2 className="shelf-title">
            Live Now <span className="shelf-count">{live.length}</span>
          </h2>
          <div className="card-grid">
            {live.map((match) => (
              <MatchCard key={match.id} match={match} layoutId={`art-cat-live-${match.id}`} onOpen={onOpen} onMore={onMore} />
            ))}
          </div>
        </section>
      ) : null}

      {upcoming.length > 0 ? (
        <section className="grid-section">
          <h2 className="shelf-title">
            Coming Up <span className="shelf-count">{upcoming.length}</span>
          </h2>
          <div className="card-grid">
            {upcoming.map((match) => (
              <MatchCard key={match.id} match={match} layoutId={`art-cat-up-${match.id}`} onOpen={onOpen} onMore={onMore} />
            ))}
          </div>
        </section>
      ) : null}

      {results.length > 0 ? (
        <Shelf title="Results" count={results.length}>
          {results.map((match) => (
            <MatchCard key={match.id} match={match} layoutId={`art-cat-res-${match.id}`} onOpen={onOpen} onMore={onMore} />
          ))}
        </Shelf>
      ) : null}

      {!loading && inScope.length === 0 ? (
        <Notice
          icon="📅"
          title={category.sport === null ? "Nothing live right now" : `No ${category.label} right now`}
          body="The feed only lists events around their start time - check back closer to kick-off."
        />
      ) : null}
    </div>
  );
};
