import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { matchLabel, type Match } from "../domain/match";
import { canWatch } from "../lib/route";
import { formatShortDate, formatTime, relativeDayLabel } from "../lib/format";
import { Crest } from "./ui";

// ---------- status ----------

export const StatusBadge = ({ match }: { match: Match }) => {
  const { status } = match;
  if (status.kind === "live")
    return (
      <span className="badge badge-live">
        <span className="live-dot" aria-hidden />
        LIVE{status.label !== "LIVE" ? ` · ${status.label}` : ""}
      </span>
    );
  if (status.kind === "finished") return <span className="badge">{status.label}</span>;
  if (status.kind === "postponed") return <span className="badge badge-warning">{status.label}</span>;
  return null;
};

export const kickoffLabel = (match: Match, withDay = false): string => {
  if (!match.kickoff) return "Time TBD";
  const time = formatTime(match.kickoff);
  if (!withDay) return time;
  const relative = relativeDayLabel(match.kickoff);
  const day = ["Today", "Tomorrow", "Yesterday"].includes(relative) ? relative : formatShortDate(match.kickoff);
  return `${day} · ${time}`;
};

const hasScore = (match: Match) =>
  match.homeScore !== null && match.awayScore !== null && match.status.kind !== "upcoming";

// ---------- artwork ----------

/** Deterministic two-tone gradient per fixture, for events without artwork. */
const fallbackGradient = (match: Match): string => {
  let hash = 0;
  for (const char of match.home.id + match.away.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `radial-gradient(120% 140% at 0% 0%, hsl(${hue} 55% 34%), transparent 60%), radial-gradient(120% 140% at 100% 100%, hsl(${(hue + 140) % 360} 50% 28%), transparent 60%), #15151a`;
};

const Artwork = ({ match, size }: { match: Match; size: "medium" | "full" }) => {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = match.thumb;
  if (src && !failed)
    return (
      <img
        className={`art${loaded ? " is-loaded" : ""}`}
        src={src}
        alt=""
        loading={size === "full" ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    );
  return (
    <div className="art art-fallback" style={{ background: fallbackGradient(match) }}>
      <Crest src={match.home.badge} name={match.home.name} size={size === "full" ? 120 : 64} />
      <span className="art-vs">vs</span>
      <Crest src={match.away.badge} name={match.away.name} size={size === "full" ? 120 : 64} />
    </div>
  );
};

// ---------- tilt (tvOS parallax focus) ----------

const finePointer = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

const useTilt = () => {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const onPointerMove = (event: React.PointerEvent) => {
    const node = ref.current;
    if (!node || reduced || !finePointer()) return;
    const rect = node.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    node.style.setProperty("--rx", `${(0.5 - y) * 7}deg`);
    node.style.setProperty("--ry", `${(x - 0.5) * 9}deg`);
    node.style.setProperty("--gx", `${x * 100}%`);
    node.style.setProperty("--gy", `${y * 100}%`);
  };
  const onPointerLeave = () => {
    const node = ref.current;
    if (!node) return;
    for (const property of ["--rx", "--ry"]) node.style.setProperty(property, "0deg");
  };
  return { ref, onPointerMove, onPointerLeave };
};

// ---------- cards ----------

export const MatchCard = ({ match, onSelect }: { match: Match; onSelect: (match: Match) => void }) => {
  const tilt = useTilt();
  return (
    <div className="card-cell">
      <button
        ref={tilt.ref as React.RefObject<HTMLButtonElement>}
        className="card"
        onClick={() => onSelect(match)}
        onPointerMove={tilt.onPointerMove}
        onPointerLeave={tilt.onPointerLeave}
        aria-label={`${matchLabel(match)}, ${match.league.name}`}
      >
        <span className="card-surface">
          <Artwork match={match} size="medium" />
          <span className="card-scrim" aria-hidden />
          <span className="card-top">
            <StatusBadge match={match} />
          </span>
          {hasScore(match) ? (
            <span className="card-score" aria-hidden>
              <Crest src={match.home.badge} name={match.home.name} size={26} />
              <span>
                {match.homeScore}
                <span className="card-score-dash">–</span>
                {match.awayScore}
              </span>
              <Crest src={match.away.badge} name={match.away.name} size={26} />
            </span>
          ) : null}
          <span className="card-shine" aria-hidden />
        </span>
      </button>
      <div className="card-caption">
        <div className="card-title">
          {match.titleOnly ? (
            match.home.name
          ) : (
            <>
              {match.home.name} <span className="card-title-vs">vs</span> {match.away.name}
            </>
          )}
        </div>
        <div className="card-meta">
          {match.league.name} · {match.status.kind === "upcoming" ? kickoffLabel(match, true) : match.sport}
        </div>
      </div>
    </div>
  );
};

export const Tile = ({
  title,
  subtitle,
  badge,
  onClick,
}: {
  title: string;
  subtitle: string;
  badge: string | null;
  onClick: () => void;
}) => {
  const tilt = useTilt();
  const art = badge;
  return (
    <div className="card-cell">
      <button
        ref={tilt.ref as React.RefObject<HTMLButtonElement>}
        className="card tile"
        onClick={onClick}
        onPointerMove={tilt.onPointerMove}
        onPointerLeave={tilt.onPointerLeave}
        aria-label={title}
      >
        <span className="card-surface">
          {art ? <img className="tile-backdrop" src={art} alt="" aria-hidden loading="lazy" /> : null}
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
};

// ---------- shelf ----------

export const Shelf = ({ title, count, children }: { title: string; count?: number; children: ReactNode }) => {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = () => {
    const node = track.current;
    if (!node) return;
    setEdges({ start: node.scrollLeft < 8, end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 8 });
  };
  useEffect(() => {
    measure();
    const node = track.current;
    if (!node) return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [children]);

  const page = (direction: 1 | -1) =>
    track.current?.scrollBy({ left: direction * track.current.clientWidth * 0.85, behavior: "smooth" });

  return (
    <motion.section
      className="shelf"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
    >
      <h2 className="shelf-title">
        {title}
        {count !== undefined ? <span className="shelf-count">{count}</span> : null}
      </h2>
      <div className="shelf-viewport">
        <div ref={track} className="shelf-track" onScroll={measure}>
          {children}
        </div>
        {!edges.start ? (
          <button className="shelf-arrow shelf-arrow-start" onClick={() => page(-1)} aria-label={`Scroll ${title} back`}>
            <Arrow direction="left" />
          </button>
        ) : null}
        {!edges.end ? (
          <button className="shelf-arrow shelf-arrow-end" onClick={() => page(1)} aria-label={`Scroll ${title} forward`}>
            <Arrow direction="right" />
          </button>
        ) : null}
      </div>
    </motion.section>
  );
};

const Arrow = ({ direction }: { direction: "left" | "right" }) => (
  <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden>
    <path
      d={direction === "right" ? "M2 2l8 8-8 8" : "M10 2L2 10l8 8"}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ShelfSkeleton = () => (
  <section className="shelf" aria-busy="true" aria-label="Loading">
    <div className="skeleton skeleton-title" />
    <div className="shelf-track">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="card-cell">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
        </div>
      ))}
    </div>
  </section>
);

// ---------- hero carousel ----------

const HERO_INTERVAL_MS = 7000;

/** Prefers live matches, then the next kick-offs, then anything with artwork. */
export const pickFeatured = (matches: readonly Match[], limit = 5): Match[] => {
  const rank = (match: Match) =>
    (match.status.kind === "live" ? 0 : match.status.kind === "upcoming" ? 1 : 2) * 10 + (match.thumb ? 0 : 5);
  return [...matches]
    .sort((a, b) => rank(a) - rank(b) || (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0))
    .slice(0, limit);
};

export const Hero = ({
  matches,
  onSelect,
  onWatch,
}: {
  matches: readonly Match[];
  onSelect: (match: Match) => void;
  onWatch: (match: Match) => void;
}) => {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();
  const current = matches[index % Math.max(matches.length, 1)];

  useEffect(() => setIndex(0), [matches]);
  useEffect(() => {
    if (paused || reduced || matches.length < 2) return;
    const timer = window.setTimeout(() => setIndex((value) => (value + 1) % matches.length), HERO_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [index, paused, reduced, matches.length]);

  if (!current) return null;
  return (
    <section
      className="hero"
      aria-roledescription="carousel"
      aria-label="Featured matches"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={current.id}
          className="hero-art"
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: [0.23, 1, 0.32, 1] }}
        >
          <Artwork match={current} size="full" />
        </motion.div>
      </AnimatePresence>
      <div className="hero-scrim" aria-hidden />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={current.id}
          className="hero-content"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        >
          <div className="hero-eyebrow">
            <Crest src={current.league.badge} name={current.league.name} size={20} />
            {current.league.name}
          </div>
          <h2 className="hero-title">
            {current.titleOnly ? (
              <span>{current.home.name}</span>
            ) : (
              <>
                <span>{current.home.name}</span>
                <span className="hero-vs">vs</span>
                <span>{current.away.name}</span>
              </>
            )}
          </h2>
          <div className="hero-meta">
            <StatusBadge match={current} />
            {hasScore(current) ? (
              <span className="hero-score">
                {current.homeScore} – {current.awayScore}
              </span>
            ) : (
              <span>{kickoffLabel(current, true)}</span>
            )}
            {current.venue ? <span className="hero-meta-dim">{current.venue}</span> : null}
          </div>
          <div className="hero-actions">
            <button className="button-primary" onClick={() => onSelect(current)}>
              {current.status.kind === "upcoming" ? "Match Details" : "View Match"}
            </button>
            {canWatch(current) ? (
              <button className="button-tinted" onClick={() => onWatch(current)}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden style={{ marginRight: 8 }}>
                  <path d="M2 1.5l10 5.5-10 5.5z" fill="currentColor" />
                </svg>
                Watch
              </button>
            ) : null}
          </div>
        </motion.div>
      </AnimatePresence>

      {matches.length > 1 ? (
        <div className="hero-dots" role="tablist" aria-label="Featured match">
          {matches.map((match, dot) => (
            <button
              key={match.id}
              role="tab"
              aria-selected={dot === index}
              aria-label={matchLabel(match)}
              className={`hero-dot${dot === index ? " is-active" : ""}`}
              onClick={() => setIndex(dot)}
            >
              {dot === index && !paused && !reduced ? (
                <span className="hero-dot-progress" style={{ animationDuration: `${HERO_INTERVAL_MS}ms` }} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
};
