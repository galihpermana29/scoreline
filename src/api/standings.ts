/**
 * League tables for the five men's football competitions the Tables screen
 * shows. Source: ESPN's public site API (verified 2026-10-16: open CORS,
 * no auth, JSON). It is unofficial and could change shape; every field is
 * parsed defensively and a table with no readable rows is reported as an
 * error rather than rendered empty. Responses are cached for ten minutes in
 * memory and localStorage - tables move at most a few times a day.
 */

export type TableCode = "pl" | "laliga" | "ucl" | "seriea" | "bundesliga";

export type TableSpec = {
  code: TableCode;
  name: string;
  short: string;
  region: string;
  /** ESPN league slug. */
  espn: string;
  /** League crest from ESPN's CDN (same host family as the team logos). */
  crest: string;
  accent: string;
};

export const TABLES: readonly TableSpec[] = [
  {
    code: "pl",
    name: "Premier League",
    short: "PL",
    region: "England",
    espn: "eng.1",
    crest: "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png",
    accent: "#3d195b",
  },
  {
    code: "laliga",
    name: "LALIGA",
    short: "LaLiga",
    region: "Spain",
    espn: "esp.1",
    crest: "https://a.espncdn.com/i/leaguelogos/soccer/500/15.png",
    accent: "#ee8707",
  },
  {
    code: "ucl",
    name: "Champions League",
    short: "UCL",
    region: "Europe",
    espn: "uefa.champions",
    crest: "https://a.espncdn.com/i/leaguelogos/soccer/500/2.png",
    accent: "#0a1c4a",
  },
  {
    code: "seriea",
    name: "Serie A",
    short: "Serie A",
    region: "Italy",
    espn: "ita.1",
    crest: "https://a.espncdn.com/i/leaguelogos/soccer/500/12.png",
    accent: "#024494",
  },
  {
    code: "bundesliga",
    name: "Bundesliga",
    short: "Bundesliga",
    region: "Germany",
    espn: "ger.1",
    crest: "https://a.espncdn.com/i/leaguelogos/soccer/500/10.png",
    accent: "#d20515",
  },
];

export const tableSpec = (code: string): TableSpec | null => TABLES.find((table) => table.code === code) ?? null;

export type StandingNote = { color: string; description: string };

export type StandingRow = {
  rank: number;
  team: { id: string; name: string; short: string; logo: string | null };
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Already signed by the source ("+11"). */
  goalDiff: string;
  points: number;
  note: StandingNote | null;
};

export type StandingsTable = {
  code: TableCode;
  seasonName: string;
  rows: StandingRow[];
  /** Distinct qualification notes in rank order, for the legend. */
  notes: StandingNote[];
  fetchedAt: number;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const cacheKey = (code: TableCode) => `scoreline:standings:${code}`;
const memory = new Map<TableCode, StandingsTable>();

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const statValue = (stats: unknown, name: string): { value: number | null; display: string | null } => {
  if (!Array.isArray(stats)) return { value: null, display: null };
  const hit = stats.find((stat) => isRecord(stat) && stat.name === name);
  if (!isRecord(hit)) return { value: null, display: null };
  return { value: asNumber(hit.value), display: asString(hit.displayValue) };
};

const parseRow = (entry: unknown): StandingRow | null => {
  if (!isRecord(entry) || !isRecord(entry.team)) return null;
  const team = entry.team;
  const id = asString(team.id);
  const name = asString(team.displayName) ?? asString(team.name);
  if (id === null || name === null) return null;
  const logos = Array.isArray(team.logos) ? team.logos : [];
  const logo = logos.map((logo) => (isRecord(logo) ? asString(logo.href) : null)).find((href) => href !== null) ?? null;

  const stat = (statName: string) => statValue(entry.stats, statName);
  const rank = stat("rank").value;
  const played = stat("gamesPlayed").value;
  const points = stat("points").value;
  if (rank === null || played === null || points === null) return null;

  const note = isRecord(entry.note)
    ? (() => {
        const color = asString(entry.note.color);
        const description = asString(entry.note.description);
        return color !== null && description !== null ? { color, description } : null;
      })()
    : null;

  return {
    rank,
    team: { id, name, short: asString(team.shortDisplayName) ?? name, logo },
    played,
    won: stat("wins").value ?? 0,
    drawn: stat("ties").value ?? 0,
    lost: stat("losses").value ?? 0,
    goalsFor: stat("pointsFor").value ?? 0,
    goalsAgainst: stat("pointsAgainst").value ?? 0,
    goalDiff: stat("pointDifferential").display ?? String(stat("pointDifferential").value ?? 0),
    points,
    note,
  };
};

const parseTable = (code: TableCode, payload: unknown): StandingsTable => {
  if (!isRecord(payload) || !Array.isArray(payload.children)) throw new Error("Standings response has no table.");
  // Domestic leagues ship one child; UCL ships its league phase as the
  // first. Either way the first child is the overall table.
  const child = payload.children.find(isRecord);
  const standings = child !== undefined && isRecord(child.standings) ? child.standings : null;
  if (standings === null || !Array.isArray(standings.entries)) throw new Error("Standings response has no entries.");
  const rows = standings.entries
    .map(parseRow)
    .flatMap((row) => (row ? [row] : []))
    .sort((a, b) => a.rank - b.rank);
  if (rows.length === 0) throw new Error("Standings response had no readable rows.");
  const notes: StandingNote[] = [];
  for (const row of rows) {
    if (row.note && !notes.some((note) => note.description === row.note?.description)) notes.push(row.note);
  }
  return {
    code,
    seasonName: asString(standings.seasonDisplayName) ?? asString(child?.name) ?? "",
    rows,
    notes,
    fetchedAt: Date.now(),
  };
};

const readCache = (code: TableCode): StandingsTable | null => {
  const hit = memory.get(code);
  if (hit) return hit;
  try {
    const raw = localStorage.getItem(cacheKey(code));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as StandingsTable;
    if (!Array.isArray(parsed.rows) || typeof parsed.fetchedAt !== "number") return null;
    memory.set(code, parsed);
    return parsed;
  } catch {
    return null;
  }
};

const writeCache = (table: StandingsTable) => {
  memory.set(table.code, table);
  try {
    localStorage.setItem(cacheKey(table.code), JSON.stringify(table));
  } catch {
    // Storage full or disabled: the in-memory copy still serves this session.
  }
};

export const fetchStandings = async (code: TableCode): Promise<StandingsTable> => {
  const cached = readCache(code);
  if (cached !== null && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;
  const spec = tableSpec(code);
  if (spec === null) throw new Error(`Unknown table ${code}.`);
  try {
    const response = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${spec.espn}/standings`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Standings source answered ${response.status}.`);
    const table = parseTable(code, await response.json());
    writeCache(table);
    return table;
  } catch (error) {
    // A stale table beats an error screen while the source hiccups.
    if (cached !== null) return cached;
    throw error;
  }
};
