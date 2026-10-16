import { useMemo } from "react";
import { Artwork, LeagueTile, MatchCard, Shelf, hueFor, type OpenMatch } from "../components/tv";
import { Icon } from "../components/icons";
import { Crest, Notice } from "../components/ui";
import { sportPriority } from "../domain/categories";
import { sportThumb } from "../domain/artwork";
import { groupByLeague, byKickoff, type League, type Match } from "../domain/match";
import { back, browsePath, navigate } from "../lib/router";

type LeagueGroup = { league: League; matches: Match[] };

export const LeaguesScreen = ({
  matches,
  leagueId,
  onOpen,
  onMore,
}: {
  matches: readonly Match[];
  leagueId: string | null;
  onOpen: OpenMatch;
  onMore: (match: Match) => void;
}) => {
  const league = useMemo(
    () => (leagueId === null ? null : (matches.find((match) => match.league.id === leagueId)?.league ?? null)),
    [matches, leagueId],
  );
  if (leagueId !== null && league === null)
    return (
      <div className="screen screen-padded">
        <Notice
          icon="🗓️"
          title="League not in the feed right now"
          body="The feed only lists competitions with events around their start time."
          action={{ label: "All leagues", onClick: () => navigate(browsePath({ kind: "leagues", leagueId: null })) }}
        />
      </div>
    );
  return league ? (
    <LeagueDetail league={league} matches={matches} onOpen={onOpen} onMore={onMore} />
  ) : (
    <LeagueGrid matches={matches} />
  );
};

/** Leagues grouped by sport, pinned sports first, as square tiles. */
const LeagueGrid = ({ matches }: { matches: readonly Match[] }) => {
  const groups = useMemo(() => {
    const bySport = new Map<string, { sportId: number | undefined; leagues: LeagueGroup[] }>();
    for (const group of groupByLeague(matches)) {
      const sport = group.matches[0]?.sport ?? "Other";
      const entry = bySport.get(sport) ?? { sportId: group.matches[0]?.sportId, leagues: [] };
      entry.leagues.push(group);
      bySport.set(sport, entry);
    }
    return [...bySport.entries()].sort(
      (a, b) => sportPriority(a[1].sportId) - sportPriority(b[1].sportId) || b[1].leagues.length - a[1].leagues.length,
    );
  }, [matches]);

  return (
    <div className="screen screen-padded">
      <header className="page-head">
        <h1 className="page-title">Leagues</h1>
        <p className="page-sub">Every competition in the feed right now, by sport.</p>
      </header>
      {groups.length === 0 ? (
        <Notice icon="📅" title="No leagues on right now" body="The live feed refreshes every minute." />
      ) : null}
      {groups.map(([sport, { leagues }]) => (
        <Shelf key={sport} title={sport} count={leagues.length} variant="tiles">
          {leagues.map((group) => {
            const country = group.matches.find((match) => match.country)?.country ?? null;
            return (
              <LeagueTile
                key={group.league.id}
                league={group.league}
                subtitle={country ?? sport}
                count={group.matches.filter((match) => match.status.kind === "live").length}
                onClick={() => navigate(browsePath({ kind: "leagues", leagueId: group.league.id }))}
              />
            );
          })}
        </Shelf>
      ))}
    </div>
  );
};

const LeagueDetail = ({
  league,
  matches,
  onOpen,
  onMore,
}: {
  league: League;
  matches: readonly Match[];
  onOpen: OpenMatch;
  onMore: (match: Match) => void;
}) => {
  const all = useMemo(() => [...matches].filter((match) => match.league.id === league.id).sort(byKickoff), [matches, league]);
  const live = all.filter((match) => match.status.kind === "live");
  const upcoming = all.filter((match) => match.status.kind === "upcoming");
  const finished = [...all.filter((match) => match.status.kind === "finished")].reverse();
  const sportId = all[0]?.sportId;
  const hue = hueFor(league.id + league.name);

  return (
    <div className="screen">
      <section className="league-hero" style={{ background: `hsl(${hue} 40% 22%)` }}>
        <Artwork src={sportId !== undefined ? sportThumb(sportId, league.id) : null} eager fallback={null} />
        <div className="hero-scrim" aria-hidden />
        <button className="back-pill" onClick={() => back(browsePath({ kind: "leagues", leagueId: null }))}>
          <Icon name="chevron-left" size={16} />
          Leagues
        </button>
        <div className="league-hero-content">
          <span className="league-hero-crest" style={{ background: `hsl(${hue} 42% 36%)` }}>
            <Crest src={league.badge} name={league.name} size={96} />
          </span>
          <div>
            <div className="hero-eyebrow">
              {all[0]?.sport ?? "Live"}
              {all[0]?.country ? ` · ${all[0].country}` : ""}
            </div>
            <h1 className="hero-title">{league.name}</h1>
            <div className="hero-meta">
              {live.length > 0 ? (
                <span className="badge badge-live">
                  <span className="live-dot" aria-hidden />
                  {live.length} live
                </span>
              ) : null}
              <span className="hero-meta-dim">
                {all.length} match{all.length === 1 ? "" : "es"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {live.length ? (
        <section className="grid-section">
          <h2 className="shelf-title">
            Live <span className="shelf-count">{live.length}</span>
          </h2>
          <div className="card-grid">
            {live.map((match) => (
              <MatchCard key={match.id} match={match} layoutId={`art-lg-live-${match.id}`} onOpen={onOpen} onMore={onMore} />
            ))}
          </div>
        </section>
      ) : null}
      {upcoming.length ? (
        <Shelf title="Up Next" count={upcoming.length}>
          {upcoming.map((match) => (
            <MatchCard key={match.id} match={match} layoutId={`art-lg-up-${match.id}`} onOpen={onOpen} onMore={onMore} />
          ))}
        </Shelf>
      ) : null}
      {finished.length ? (
        <Shelf title="Latest Results" count={finished.length}>
          {finished.map((match) => (
            <MatchCard key={match.id} match={match} layoutId={`art-lg-res-${match.id}`} onOpen={onOpen} onMore={onMore} />
          ))}
        </Shelf>
      ) : null}
      {all.length === 0 ? <Notice icon="🗓️" title="No matches for this league right now." /> : null}
    </div>
  );
};
