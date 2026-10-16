import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { TABLES, fetchStandings, tableSpec, type TableCode } from "../api/standings";
import { StandingsSkeleton, StandingsTable } from "../components/StandingsTable";
import { EASE_OUT } from "../components/tv";
import { Crest, Notice } from "../components/ui";
import { browsePath, navigate } from "../lib/router";
import { useAsync } from "../lib/useAsync";

const DEFAULT_CODE: TableCode = "pl";

/**
 * Men's football league tables for the five competitions people actually
 * ask for. A segmented control picks the league; the table crossfades with
 * a slight directional hint rather than sliding, since the two states are
 * structurally the same and a heavy slide would overstate the change.
 */
export const TablesScreen = ({ code }: { code: string | null }) => {
  const spec = (code !== null ? tableSpec(code) : null) ?? tableSpec(DEFAULT_CODE);
  if (spec === null) return null;
  return <TablesBody code={spec.code} />;
};

const TablesBody = ({ code }: { code: TableCode }) => {
  const spec = tableSpec(code);
  const { state, reload } = useAsync(`standings-${code}`, () => fetchStandings(code), 10 * 60_000);
  const index = TABLES.findIndex((table) => table.code === code);
  const activeRef = useRef<HTMLButtonElement>(null);

  // On phones the control scrolls; keep the chosen league in view (deep
  // links can land on the last one).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [code]);

  if (spec === null) return null;

  return (
    <div className="screen screen-padded">
      <header className="page-head">
        <h1 className="page-title">Tables</h1>
        <p className="page-sub">Men's league standings - Premier League, LALIGA, Champions League, Serie A and Bundesliga.</p>
      </header>

      <LayoutGroup id="tables">
        <div className="segmented" role="tablist" aria-label="Competition">
          {TABLES.map((table) => {
            const active = table.code === code;
            return (
              <button
                key={table.code}
                ref={active ? activeRef : undefined}
                role="tab"
                aria-selected={active}
                className={`segment${active ? " is-active" : ""}`}
                onClick={() => navigate(browsePath({ kind: "tables", code: table.code }), { replace: true, keepScroll: true })}
              >
                {active ? (
                  <motion.span layoutId="segment-thumb" className="segment-thumb" transition={{ type: "spring", bounce: 0, duration: 0.4 }} />
                ) : null}
                <span className="segment-label">
                  <Crest src={table.crest} name={table.name} size={18} />
                  <span className="segment-text">{table.short}</span>
                </span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      <AnimatePresence mode="wait" initial={false} custom={index}>
        <motion.div
          key={code}
          className="tables-stage"
          initial={{ opacity: 0, x: 10, filter: "blur(4px)" }}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, x: -10, filter: "blur(4px)", transition: { duration: 0.14 } }}
          transition={{ duration: 0.26, ease: EASE_OUT }}
        >
          {state.status === "loading" ? (
            <StandingsSkeleton rows={code === "ucl" ? 18 : 12} />
          ) : state.status === "error" ? (
            <Notice
              icon="📊"
              title="Couldn't load this table"
              body={state.message}
              action={{ label: "Try Again", onClick: reload }}
            />
          ) : (
            <>
              <StandingsTable spec={spec} table={state.data} />
              <p className="footnote tables-footnote">
                {state.data.seasonName}. Source: ESPN public standings. Updated{" "}
                {new Date(state.data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
              </p>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
