/** The slice of a feed row alert matching reads. A AlertRow satisfies it, and so does what Convex stores and passes around. */
export type AlertRow = {
  matchId: number;
  sportId: number;
  kickoffMs: number | null;
  statusCode: number | null;
  competition: { id: number | null; name: string | null } | null;
  title: string | null;
  teams: readonly { id: number | null; name: string }[];
  slugs: { match: string; competition: string } | null;
};

/**
 * What a viewer can ask to be mailed about, and how a feed row is matched to
 * those choices. Shared by the picker (client) and the cron (Convex), so the
 * two cannot disagree about what "Liverpool" or "Motorsport" means.
 * Every fact here was verified live on 2026-10-17 (docs/match-alerts.md).
 */

export type Club = {
  id: string;
  name: string;
  /** Feed team id, read from the source's own league standings. Clubs match on this only, never on names. */
  teamId: number;
  /** The league whose standings list this team, for the daily team-id check. */
  leagueId: number;
};

export const CLUBS: readonly Club[] = [
  { id: "arsenal", name: "Arsenal", teamId: 206665, leagueId: 4356 },
  { id: "chelsea", name: "Chelsea", teamId: 206661, leagueId: 4356 },
  { id: "liverpool", name: "Liverpool", teamId: 206651, leagueId: 4356 },
  { id: "man-united", name: "Manchester United", teamId: 206653, leagueId: 4356 },
  { id: "man-city", name: "Manchester City", teamId: 206662, leagueId: 4356 },
  { id: "tottenham", name: "Tottenham Hotspur", teamId: 206664, leagueId: 4356 },
  { id: "real-madrid", name: "Real Madrid", teamId: 206725, leagueId: 4400 },
  { id: "barcelona", name: "FC Barcelona", teamId: 206768, leagueId: 4400 },
  { id: "atletico", name: "Atlético Madrid", teamId: 206707, leagueId: 4400 },
  { id: "psg", name: "Paris Saint-Germain", teamId: 206822, leagueId: 4426 },
  { id: "bayern", name: "Bayern München", teamId: 206764, leagueId: 4411 },
];

export const clubById = (id: string): Club | undefined => CLUBS.find((club) => club.id === id);

export type AlertSport = "badminton" | "f1" | "motogp";

export const ALERT_SPORTS: readonly { id: AlertSport; name: string; hint: string }[] = [
  { id: "badminton", name: "Badminton", hint: "Every match that streams" },
  { id: "f1", name: "Formula 1", hint: "Practice, qualifying, sprint and race" },
  { id: "motogp", name: "MotoGP", hint: "Practice, qualifying, sprint and race" },
];

export const alertSportName = (sport: AlertSport): string =>
  ALERT_SPORTS.find((entry) => entry.id === sport)?.name ?? sport;

/** Feed sport ids the cron fetches for each kind of choice. */
export const FOOTBALL_SPORT_ID = 1;
export const MOTORSPORT_SPORT_ID = 7;
export const BADMINTON_SPORT_ID = 12;

export const feedSportForAlertSport = (sport: AlertSport): number =>
  sport === "badminton" ? BADMINTON_SPORT_ID : MOTORSPORT_SPORT_ID;

/**
 * Competition ids for the two motorsport series. Neither had a session in the
 * 2026-10-17 window, so they are not pinned yet: until each is, the name rule
 * below decides, and the cron logs every match with its competition id so the
 * id can be pinned after the first race weekend (then delete the name rule).
 */
const PINNED_COMPETITION_IDS: Record<"f1" | "motogp", readonly number[]> = { f1: [], motogp: [] };

/** Never the session title: "Grand Prix of Italy" turned out to be powerboat racing. */
const COMPETITION_NAME_RULE: Record<"f1" | "motogp", RegExp> = {
  f1: /^(formula\s*1|f1)\b/i,
  motogp: /\bmotogp\b/i,
};

const SMALL_CLASS = /\bmoto\s*[23]\b/i;

const motorsportSeries = (row: AlertRow, series: "f1" | "motogp"): boolean => {
  const competition = row.competition;
  if (competition === null) return false;
  const pinned = PINNED_COMPETITION_IDS[series];
  const matches =
    pinned.length > 0
      ? competition.id !== null && pinned.includes(competition.id)
      : COMPETITION_NAME_RULE[series].test(competition.name ?? "");
  if (!matches) return false;
  // Moto2 and Moto3 run inside the MotoGP competition; only the premier class mails.
  return series !== "motogp" || !SMALL_CLASS.test(row.title ?? "");
};

/**
 * Every alert choice a row satisfies, as club ids and sports. A row that
 * hits two chosen clubs (Liverpool vs Chelsea) returns both.
 */
export const matchingChoices = (row: AlertRow): { clubs: string[]; sports: AlertSport[] } => {
  const clubs: string[] = [];
  const sports: AlertSport[] = [];
  if (row.sportId === FOOTBALL_SPORT_ID) {
    const teamIds = row.teams.slice(0, 2).flatMap((team) => (team.id === null ? [] : [team.id]));
    for (const club of CLUBS) if (teamIds.includes(club.teamId)) clubs.push(club.id);
  }
  if (row.sportId === BADMINTON_SPORT_ID) sports.push("badminton");
  if (row.sportId === MOTORSPORT_SPORT_ID) {
    if (motorsportSeries(row, "f1")) sports.push("f1");
    if (motorsportSeries(row, "motogp")) sports.push("motogp");
  }
  return { clubs, sports };
};

/** Field 4 codes after which a match is never a "live now" mail: finished, then cancelled/cut/TBD/suspended/postponed. */
const CLOSED_STATUS_CODES: ReadonlySet<number> = new Set([100, 10000, 10001, 10002, 10101, 10102, 10103]);

export const isClosedStatus = (code: number | null): boolean => code !== null && CLOSED_STATUS_CODES.has(code);

/** A match is open for a mail for 45 minutes after it starts (rule 5). */
export const ALERT_WINDOW_MS = 45 * 60 * 1000;

/** The "Live now" mail subject and body label for a row. */
export const alertTitle = (row: AlertRow): string => {
  if (row.teams.length >= 2) return `${row.teams[0]!.name} vs ${row.teams[1]!.name}`;
  const series = row.sportId === MOTORSPORT_SPORT_ID ? seriesLabel(row) : null;
  const title = row.title ?? row.teams[0]?.name ?? "Live session";
  return series === null ? title : `${series} - ${title}`;
};

const seriesLabel = (row: AlertRow): string | null => {
  if (motorsportSeries(row, "f1")) return "Formula 1";
  if (motorsportSeries(row, "motogp")) return "MotoGP";
  return row.competition?.name ?? null;
};
