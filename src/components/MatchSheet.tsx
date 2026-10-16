import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { Fragment, useEffect, useRef } from "react";
import type { Match } from "../domain/match";
import { matchLabel } from "../domain/match";
import { canWatch } from "../lib/route";
import { formatLongDate, formatTime } from "../lib/format";
import { useMediaQuery, DESKTOP_QUERY } from "../lib/useMediaQuery";
import { StatusBadge } from "./tv";
import { Crest } from "./ui";
import { Icon } from "./icons";
import { downloadCalendarEvent } from "../lib/calendar";

const SHEET_SPRING = { type: "spring", bounce: 0, duration: 0.42 } as const;

export const MatchSheet = ({
  match,
  onClose,
  onWatch,
}: {
  match: Match | null;
  onClose: () => void;
  onWatch: (match: Match) => void;
}) => {
  const desktop = useMediaQuery(DESKTOP_QUERY);

  useEffect(() => {
    if (!match) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [match, onClose]);

  return (
    <AnimatePresence>
      {match ? (
        <motion.div
          key="scrim"
          className="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={onClose}
        />
      ) : null}
      {match ? (
        desktop ? (
          <motion.div
            key={`dialog-${match.id}`}
            className="dialog"
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label={matchLabel(match)}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", bounce: 0, duration: 0.3 }}
          >
            <SheetBody match={match} onClose={onClose} onWatch={onWatch} />
          </motion.div>
        ) : (
          <PhoneSheet key={`sheet-${match.id}`} match={match} onClose={onClose} onWatch={onWatch} />
        )
      ) : null}
    </AnimatePresence>
  );
};

const PhoneSheet = ({
  match,
  onClose,
  onWatch,
}: {
  match: Match;
  onClose: () => void;
  onWatch: (match: Match) => void;
}) => {
  const controls = useDragControls();
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 140 || info.velocity.y > 600) onClose();
  };
  return (
    <motion.div
      className="sheet"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label={matchLabel(match)}
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={SHEET_SPRING}
      drag="y"
      dragListener={false}
      dragControls={controls}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.05, bottom: 0.9 }}
      onDragEnd={onDragEnd}
    >
      <div className="sheet-grabber-area" onPointerDown={(event) => controls.start(event)}>
        <span className="sheet-grabber" />
      </div>
      <SheetBody match={match} onClose={onClose} onWatch={onWatch} onHeaderPointerDown={(event) => controls.start(event)} />
    </motion.div>
  );
};

const SheetBody = ({
  match,
  onClose,
  onWatch,
  onHeaderPointerDown,
}: {
  match: Match;
  onClose: () => void;
  onWatch: (match: Match) => void;
  onHeaderPointerDown?: (event: React.PointerEvent) => void;
}) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.closest<HTMLElement>("[role=dialog]")?.focus({ preventScroll: true });
  }, []);
  const scored = match.homeScore !== null && match.awayScore !== null && match.status.kind !== "upcoming";
  const upcoming = match.status.kind === "upcoming";
  const backdrop = match.thumb;

  return (
    <div ref={bodyRef} className="sheet-body">
      <div className="detail-hero" onPointerDown={onHeaderPointerDown}>
        {backdrop ? <img className="detail-hero-art" src={backdrop} alt="" aria-hidden /> : null}
        <div className="detail-hero-scrim" aria-hidden />
        <button className="close-button" onClick={onClose} aria-label="Close">
          <Icon name="close" size={14} />
        </button>
        <div className="detail-hero-content">
          <div className="hero-eyebrow">
            <Crest src={match.league.badge} name={match.league.name} size={18} />
            {match.league.name}
          </div>
          <div className="scoreboard">
            {match.titleOnly ? (
              <div className="scoreboard-session">
                <div className="session-title" lang="en">
                  {softBreaks(match.home.name)}
                </div>
                <div className="scoreboard-center">
                  {scored ? (
                    <div className="big-score">
                      {match.homeScore}
                      <span className="big-score-divider">–</span>
                      {match.awayScore}
                    </div>
                  ) : (
                    <div className="big-time">{match.kickoff ? formatTime(match.kickoff) : "TBD"}</div>
                  )}
                  <StatusBadge match={match} />
                </div>
              </div>
            ) : (
              <>
                <TeamColumn name={match.home.name} badge={match.home.badge} side="Home" />
                <div className="scoreboard-center">
                  {scored ? (
                    <div className="big-score">
                      {match.homeScore}
                      <span className="big-score-divider">–</span>
                      {match.awayScore}
                    </div>
                  ) : (
                    <div className="big-time">{match.kickoff ? formatTime(match.kickoff) : "TBD"}</div>
                  )}
                  <StatusBadge match={match} />
                </div>
                <TeamColumn name={match.away.name} badge={match.away.badge} side="Away" />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="detail-content">
        {canWatch(match) || upcoming ? (
          <div className="detail-actions">
            {canWatch(match) ? (
              <button className="button-primary" onClick={() => onWatch(match)}>
                <Icon name="play" size={14} />
                Watch Stream
              </button>
            ) : null}
            {upcoming && match.kickoff ? (
              <button className="button-tinted" onClick={() => downloadCalendarEvent(match)}>
                <Icon name="calendar" size={16} />
                Add to Calendar
              </button>
            ) : null}
          </div>
        ) : null}

        <h3 className="detail-heading">Information</h3>
        <dl className="info-grid">
          {match.kickoff ? <Detail label="Kick-off" value={`${formatLongDate(match.kickoff)}, ${formatTime(match.kickoff)}`} /> : null}
          {match.round ? <Detail label="Round" value={match.round} /> : null}
          {match.venue ? <Detail label="Venue" value={match.venue} /> : null}
          {match.country ? <Detail label="Country" value={match.country} /> : null}
          {match.odds ? <Detail label="Odds" value={match.odds.join(" · ")} /> : null}
          <Detail label="Sport" value={match.sport} />
        </dl>
      </div>
    </div>
  );
};

const TeamColumn = ({ name, badge, side }: { name: string; badge: string | null; side: string }) => (
  <div className="team-column">
    <Crest src={badge} name={name} size={72} />
    <span className={`team-column-name${name.length > 12 ? " is-long" : ""}`} lang="en">
      {softBreaks(name)}
    </span>
    <span className="team-column-side">{side}</span>
  </div>
);

/** Lets run-together names like "OrangeAcademy" wrap at their capital letters. */
const softBreaks = (name: string) =>
  name.split(/(?<=\p{Ll})(?=\p{Lu})/u).map((part, index) => (
    <Fragment key={index}>
      {index > 0 ? <wbr /> : null}
      {part}
    </Fragment>
  ));

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div className="info-cell">
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);
