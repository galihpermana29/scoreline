import { motion } from "motion/react";
import type { StandingsTable as Table, TableSpec } from "../api/standings";
import { Crest } from "./ui";
import { EASE_OUT } from "./tv";

/**
 * One league table in the reference's card style: crest and name on top,
 * tabular figures, a coloured marker beside the rank where the source
 * annotates a qualification zone, and the legend underneath. `limit` trims
 * it to a preview (the home page shows the top five of two leagues).
 */
export const StandingsTable = ({
  spec,
  table,
  limit,
  onOpen,
}: {
  spec: TableSpec;
  table: Table;
  limit?: number;
  onOpen?: () => void;
}) => {
  const rows = limit === undefined ? table.rows : table.rows.slice(0, limit);
  return (
    <section className="standings" aria-label={`${spec.name} standings`}>
      <header className="standings-head">
        <Crest src={spec.crest} name={spec.name} size={22} />
        <h3 className="standings-name">{spec.name}</h3>
        {onOpen ? (
          <button className="standings-open" onClick={onOpen}>
            Full table
          </button>
        ) : null}
      </header>
      <table className="standings-table">
        <thead>
          <tr>
            <th scope="col" className="col-rank" aria-label="Position" />
            <th scope="col" className="col-club">
              Club
            </th>
            <th scope="col" abbr="Games played">
              GP
            </th>
            <th scope="col" abbr="Wins">
              W
            </th>
            <th scope="col" abbr="Draws">
              D
            </th>
            <th scope="col" abbr="Losses">
              L
            </th>
            <th scope="col" abbr="Goal difference" className="col-wide">
              GD
            </th>
            <th scope="col" abbr="Points" className="col-pts">
              PTS
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <motion.tr
              key={row.team.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT, delay: Math.min(index, 12) * 0.025 }}
            >
              <td className="col-rank">
                <span className="rank-mark" style={row.note ? { background: row.note.color } : undefined} aria-hidden />
                {row.rank}
              </td>
              <td className="col-club">
                <Crest src={row.team.logo} name={row.team.name} size={22} />
                <span className="club-name">{row.team.name}</span>
                <span className="club-short">{row.team.short}</span>
              </td>
              <td>{row.played}</td>
              <td>{row.won}</td>
              <td>{row.drawn}</td>
              <td>{row.lost}</td>
              <td className="col-wide">{row.goalDiff}</td>
              <td className="col-pts">{row.points}</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
      {table.notes.length > 0 && limit === undefined ? (
        <ul className="standings-legend">
          {table.notes.map((note) => (
            <li key={note.description}>
              <span className="rank-mark" style={{ background: note.color }} aria-hidden />
              {note.description}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};

export const StandingsSkeleton = ({ rows = 10 }: { rows?: number }) => (
  <section className="standings standings-skeleton" aria-busy="true" aria-label="Loading table">
    <header className="standings-head">
      <span className="skeleton" style={{ width: 22, height: 22, borderRadius: 11 }} />
      <span className="skeleton" style={{ width: 160, height: 16 }} />
    </header>
    <div className="standings-skeleton-rows">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="skeleton" style={{ height: 36 }} />
      ))}
    </div>
  </section>
);
