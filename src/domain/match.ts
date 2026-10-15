export type MatchStatus =
  | { kind: "live"; label: string }
  | { kind: "upcoming" }
  | { kind: "finished"; label: string }
  | { kind: "postponed"; label: string }
  | { kind: "awaiting" };

export type Team = { id: string; name: string; badge: string | null };

export type League = { id: string; name: string; badge: string | null };

export type Match = {
  id: string;
  sport: string;
  league: League;
  home: Team;
  away: Team;
  homeScore: number | null;
  awayScore: number | null;
  kickoff: Date | null;
  status: MatchStatus;
  venue: string | null;
  country: string | null;
  round: string | null;
  thumb: string | null;
  /** Numeric feed sport id, e.g. 12 for badminton. Used for routing. */
  sportId?: number;
  /** Routing slugs the feed ships pre-made in its SEO block: match + competition. */
  slugs?: { match: string; competition: string };
  /** Decimal odds strings (home / draw / away) when the feed carries them. */
  odds?: readonly string[];
  /**
   * True for session-style feed entries (badminton courts, race meetings,
   * curling sessions) that list no sides, only a title. Rendered as a single
   * labelled event rather than a fabricated "X vs X" pairing.
   */
  titleOnly?: boolean;
};

/** Human label for a match: a pairing, or just the session title. */
export const matchLabel = (match: Match): string =>
  match.titleOnly ? match.home.name : `${match.home.name} vs ${match.away.name}`;

export const SPORT_ICON: Record<string, string> = {
  Football: "⚽",
  Basketball: "🏀",
  Baseball: "⚾",
  Cricket: "🏏",
  Tennis: "🎾",
  "American Football": "🏈",
  "Aussie Rules": "🏉",
  "Ice Hockey": "🏒",
  Badminton: "🏸",
  Volleyball: "🏐",
  "Combat Sports": "🥊",
  Handball: "🤾",
  "Horse Racing": "🐎",
  Rugby: "🏉",
};

export type MatchFilter = "all" | "live" | "upcoming" | "finished";

export const matchesFilter = (match: Match, filter: MatchFilter): boolean => {
  if (filter === "all") return true;
  if (filter === "live") return match.status.kind === "live";
  if (filter === "upcoming") return match.status.kind === "upcoming";
  return match.status.kind === "finished";
};

/** Groups matches by league, keeping leagues and matches in kickoff order. */
export const groupByLeague = (matches: readonly Match[]): { league: League; matches: Match[] }[] => {
  const groups = new Map<string, { league: League; matches: Match[] }>();
  for (const match of [...matches].sort(byKickoff)) {
    const group = groups.get(match.league.id) ?? { league: match.league, matches: [] };
    group.matches.push(match);
    groups.set(match.league.id, group);
  }
  return [...groups.values()];
};

export const byKickoff = (a: Match, b: Match): number =>
  (a.kickoff?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.kickoff?.getTime() ?? Number.MAX_SAFE_INTEGER);