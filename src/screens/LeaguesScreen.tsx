import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { Artwork, MatchCard, Shelf } from "../components/tv";
import { Chevron, Crest, Notice } from "../components/ui";
import { groupByLeague, byKickoff, sportThumb, type League, type Match } from "../domain/match";

const FADE = { duration: 0.3, ease: [0.23, 1, 0.32, 1] } as const;

type LeagueGroup = { league: League; matches: Match[] };

export const LeaguesScreen = ({
  matches,
  league,
  onOpenLeague,
  onSelect,
}: {
  matches: readonly Match[];
  league: League | null;
  onOpenLeague: (league: League | null) => void;
  onSelect: (match: Match) => void;
}) => (
  <AnimatePresence mode="wait" initial={false}>
    <motion.div
      key={league?.id ?? "list"}
      initial={{ opacity: 0, scale: 0.99 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.01 }}
      transition={FADE}
    >
      {league ? (
        <LeagueDetail league={league} matches={matches} onBack={() => onOpenLeague(null)} onSelect={onSelect} />
      ) : (
        <LeagueGrid matches={matches} onOpen={onOpenLeague} />
      )}
    </motion.div>
  </AnimatePresence>
);

const LeagueGrid = ({ matches, onOpen }: { matches: readonly Match[]; onOpen: (league: League) => void }) => {
  const groups = useMemo(() => {
    const bySport = new Map<string, LeagueGroup[]>();
    for (const group of groupByLeague(matches)) {
      const sport = group.matches[0]?.sport ?? "Other";
      const shelf = bySport.get(sport) ?? [];
      shelf.push(group);
      bySport.set(sport, shelf);
    }
    return [...bySport.entries()];
  }, [matches]);

  return (
    <div className="screen screen-padded">
      <h1 className="page-title">Leagues</h1>
      {groups.length === 0 ? (
        <Notice icon="📅" title="No leagues on right now" body="The live feed refreshes every minute." />
      ) : null}
      {groups.map(([sport, leagues]) => (
        <Shelf key={sport} title={sport} count={leagues.length}>
          {leagues.map((group) => {
            const country = group.matches.find((match) => match.country)?.country ?? null;
            const sportId = group.matches[0]?.sportId;
            return (
              <Tile
                key={group.league.id}
                title={group.league.name}
                subtitle={country ?? sport}
                badge={group.league.badge}
                thumb={sportId !== undefined ? sportThumb(sportId) : null}
                onClick={() => onOpen(group.league)}
              />
            );
          })}
        </Shelf>
      ))}
    </div>
  );
};

const Tile = ({
  title,
  subtitle,
  badge,
  thumb,
  onClick,
}: {
  title: string;
  subtitle: string;
  badge: string | null;
  thumb: string | null;
  onClick: () => void;
}) => (
  <div className="card-cell">
    <button className="card tile" onClick={onClick} aria-label={title}>
      <span className="card-surface">
        {/* Same artwork family as the match cards: the sport's hero art
            behind the league crest, falling back to the blurred-badge look
            when there is no art for the sport or the file fails. */}
        <Artwork
          src={thumb}
          fallback={badge ? <img className="tile-backdrop" src={badge} alt="" aria-hidden loading="lazy" /> : null}
        />
        <span className="card-scrim" aria-hidden />
        <span className="tile-badge">
          <Crest src={badge} name={title} size={96} />
        </span>
        <span className="card-shine" aria-hidden />
      </span>
    </button>
    <div className="card-caption">
      <div className="card-title">{title}</div>
      <div className="card-meta">{subtitle}</div>
    </div>
  </div>
);

const LeagueDetail = ({
  league,
  matches,
  onBack,
  onSelect,
}: {
  league: League;
  matches: readonly Match[];
  onBack: () => void;
  onSelect: (match: Match) => void;
}) => {
  const all = useMemo(() => [...matches].filter((match) => match.league.id === league.id).sort(byKickoff), [matches, league]);
  const live = all.filter((match) => match.status.kind === "live");
  const upcoming = all.filter((match) => match.status.kind === "upcoming");
  const finished = [...all.filter((match) => match.status.kind === "finished")].reverse();
  const sportId = all[0]?.sportId;

  return (
    <div className="screen">
      <section className="league-hero">
        {/* The sport's hero art full-bleed, like the main hero; the blurred
            league badge stays as the fallback when no art applies. */}
        <Artwork
          src={sportId !== undefined ? sportThumb(sportId) : null}
          eager
          fallback={
            league.badge ? <img className="league-hero-backdrop" src={league.badge} alt="" aria-hidden /> : null
          }
        />
        <div className="hero-scrim" aria-hidden />
        <button className="back-pill" onClick={onBack}>
          <Chevron direction="left" />
          Leagues
        </button>
        <div className="league-hero-content">
          <Crest src={league.badge} name={league.name} size={112} />
          <div>
            <div className="hero-eyebrow">
              {all[0]?.sport ?? "Live"} · {all.length} match{Math.abs(all.length) === 1 ? "" : "es"}
            </div>
            <h1 className="hero-title">{league.name}</h1>
          </div>
        </div>
      </section>

      {live.length ? (
        <Shelf title="Live" count={live.length}>
          {live.map((match) => (
            <MatchCard key={match.id} match={match} onSelect={onSelect} />
          ))}
        </Shelf>
      ) : null}
      {upcoming.length ? (
        <Shelf title="Up Next" count={upcoming.length}>
          {upcoming.map((match) => (
            <MatchCard key={match.id} match={match} onSelect={onSelect} />
          ))}
        </Shelf>
      ) : null}
      {finished.length ? (
        <Shelf title="Latest Results" count={finished.length}>
          {finished.map((match) => (
            <MatchCard key={match.id} match={match} onSelect={onSelect} />
          ))}
        </Shelf>
      ) : null}
      {all.length === 0 ? <Notice icon="🗓️" title="No matches for this league right now." /> : null}
    </div>
  );
};