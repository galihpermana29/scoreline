import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { otherThumb } from "../domain/artwork";
import { thumbPlan } from "../domain/cardart";
import { matchLabel, type League, type Match } from "../domain/match";
import { canWatch } from "../lib/route";
import { formatShortDate, formatTime, relativeDayLabel } from "../lib/format";
import { useTvMode } from "../lib/tvmode";
import { Icon } from "./icons";
import { ScorelineBadge } from "./Logo";
import { Crest } from "./ui";

/** Card click: open the match (watch when possible), morphing out of `layoutId`. */
export type OpenMatch = (match: Match, layoutId: string) => void;

export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** Shared-element morphs: critically damped, long enough for a big element to travel. */
export const MORPH_SPRING = { type: "spring", bounce: 0, duration: 0.55 } as const;

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

/** Short "MON 03.30"-style date chip, as on the wide feature cards. */
export const dateChip = (match: Match): string => {
  if (!match.kickoff) return "TBD";
  const relative = relativeDayLabel(match.kickoff);
  if (relative === "Today" || relative === "Tomorrow") return `${relative} ${formatTime(match.kickoff)}`;
  return `${formatShortDate(match.kickoff)} ${formatTime(match.kickoff)}`;
};

export const hasScore = (match: Match) =>
  match.homeScore !== null && match.awayScore !== null && match.status.kind !== "upcoming";

// ---------- artwork ----------

/** Deterministic hue per id, for tiles and fallbacks without artwork. */
export const hueFor = (seed: string): number => {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
};

const fallbackGradient = (match: Match): string => {
  const hue = hueFor(match.home.id + match.away.id);
  return `radial-gradient(120% 140% at 0% 0%, hsl(${hue} 55% 34%), transparent 60%), radial-gradient(120% 140% at 100% 100%, hsl(${(hue + 140) % 360} 50% 28%), transparent 60%), #15151a`;
};

/**
 * One shared artwork layer: the image fades in on load and falls back to
 * whatever the caller renders when there is no src or the image fails.
 */
export const Artwork = ({
  src,
  fallback,
  eager = false,
  position,
}: {
  src: string | null;
  fallback: ReactNode;
  eager?: boolean;
  position?: string;
}) => {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (src !== null && !failed)
    return (
      <img
        className={`art${loaded ? " is-loaded" : ""}`}
        src={src}
        alt=""
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        style={position ? { objectPosition: position } : undefined}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    );
  return <>{fallback}</>;
};

export const MatchArtwork = ({
  match,
  size,
  position,
}: {
  match: Match;
  size: "medium" | "full";
  position?: string;
}) => (
  <Artwork
    src={match.thumb}
    eager={size === "full"}
    position={position}
    fallback={
      <div className="art art-fallback" style={{ background: fallbackGradient(match) }}>
        <Crest src={match.home.badge} name={match.home.name} size={size === "full" ? 120 : 64} />
        <span className="art-vs">vs</span>
        <Crest src={match.away.badge} name={match.away.name} size={size === "full" ? 120 : 64} />
      </div>
    }
  />
);

/**
 * The flat CSS thumbnail: one solid colour field, a capitalized identity
 * line, and a small uppercase caption. Sizing is
 * container-relative (`cqw` of the card itself, with px fallbacks in the CSS
 * for browsers without container units), so the same component fits every
 * card width the shelves use. Overlays (status badge, score pill, play) sit
 * on top of this exactly as they do on photos.
 */
export const MatchThumb = ({ match }: { match: Match }) => {
  const { theme, big, small, tier } = thumbPlan(match);
  const colors = { "--thumb-bg": theme.bg, "--thumb-ink": theme.ink, "--thumb-sub": theme.sub } as CSSProperties;
  return (
    <div className="art art-thumb" style={colors} aria-hidden>
      <span className={`thumb-big thumb-${tier}`}>{big}</span>
      {theme.bar ? <span className="thumb-bar" style={{ background: theme.bar }} /> : null}
      <span className="thumb-small">{small}</span>
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
    node.style.setProperty("--rx", `${(0.5 - y) * 4}deg`);
    node.style.setProperty("--ry", `${(x - 0.5) * 5}deg`);
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

/**
 * The standard 16:9 card. The artwork stays clean: one small status badge,
 * a score pill only while a score exists, and the caption below the frame.
 * `layoutId` is unique per shelf and match so the same fixture in two
 * shelves never fights over one shared element; whichever card is clicked
 * is the one the player morphs out of.
 */
export const MatchCard = ({
  match,
  layoutId,
  onOpen,
  onMore,
}: {
  match: Match;
  layoutId: string;
  onOpen: OpenMatch;
  onMore: (match: Match) => void;
}) => {
  const tilt = useTilt();
  const watchable = canWatch(match);
  return (
    <div className="card-cell">
      <button
        ref={tilt.ref as React.RefObject<HTMLButtonElement>}
        className="card"
        onClick={() => onOpen(match, layoutId)}
        onPointerMove={tilt.onPointerMove}
        onPointerLeave={tilt.onPointerLeave}
        aria-label={`${watchable ? "Watch" : "Open"} ${matchLabel(match)}, ${match.league.name}`}
      >
        <motion.span className="card-surface" layoutId={layoutId} transition={MORPH_SPRING} style={{ borderRadius: 12 }}>
          <MatchThumb match={match} />
          <span className="card-top">
            <StatusBadge match={match} />
          </span>
          {hasScore(match) ? (
            <span className="card-score" aria-hidden>
              {match.homeScore}
              <span className="card-score-dash">–</span>
              {match.awayScore}
            </span>
          ) : null}
          {watchable ? (
            <span className="card-play" aria-hidden>
              <Icon name="play" size={18} />
            </span>
          ) : null}
          <span className="card-shine" aria-hidden />
        </motion.span>
      </button>
      <div className="card-caption">
        <div className="card-caption-text">
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
        <button
          className="card-more"
          aria-label={`More about ${matchLabel(match)}`}
          onClick={() => onMore(match)}
          data-tv-skip
        >
          <Icon name="more" size={16} />
        </button>
      </div>
    </div>
  );
};

/**
 * The wide feature card (roughly 2.4:1 on desktop): the artwork sits to the
 * right, the fixture stacks on the left over a scrim - a date chip, the two
 * crests with names, then the competition. Used for headline fixtures.
 */
export const WideCard = ({
  match,
  layoutId,
  onOpen,
  eyebrow,
}: {
  match: Match;
  layoutId: string;
  onOpen: OpenMatch;
  eyebrow?: string;
}) => (
  <button className="wide-card" onClick={() => onOpen(match, layoutId)} aria-label={`${matchLabel(match)}, ${match.league.name}`}>
    <motion.span className="wide-surface" layoutId={layoutId} transition={MORPH_SPRING} style={{ borderRadius: 16 }}>
      <MatchArtwork match={match} size="medium" />
      <span className="wide-scrim" aria-hidden />
      <span className="wide-content">
        <span className="wide-eyebrow">{eyebrow ?? match.sport}</span>
        <span className="wide-chip">
          {match.status.kind === "live" ? (
            <>
              <span className="live-dot" aria-hidden /> LIVE
            </>
          ) : (
            dateChip(match)
          )}
        </span>
        {match.titleOnly ? (
          <span className="wide-team">
            <span className="wide-team-name">{match.home.name}</span>
          </span>
        ) : (
          <>
            <span className="wide-team">
              <Crest src={match.home.badge} name={match.home.name} size={32} />
              <span className="wide-team-name">{match.home.name}</span>
              {hasScore(match) ? <span className="wide-team-score">{match.homeScore}</span> : null}
            </span>
            <span className="wide-team">
              <Crest src={match.away.badge} name={match.away.name} size={32} />
              <span className="wide-team-name">{match.away.name}</span>
              {hasScore(match) ? <span className="wide-team-score">{match.awayScore}</span> : null}
            </span>
          </>
        )}
        <span className="wide-league">
          <Crest src={match.league.badge} name={match.league.name} size={16} />
          <span className="wide-league-name">{match.league.name}</span>
        </span>
      </span>
    </motion.span>
  </button>
);

/** Square league tile: a flat team-colour field with the crest centred, name below. */
export const LeagueTile = ({
  league,
  subtitle,
  count,
  onClick,
}: {
  league: League;
  subtitle: string;
  count: number;
  onClick: () => void;
}) => {
  const hue = hueFor(league.id + league.name);
  return (
    <div className="tile-cell">
      <button
        className="tile"
        onClick={onClick}
        aria-label={count > 0 ? `${league.name}, ${count} live` : league.name}
        style={{ background: `linear-gradient(160deg, hsl(${hue} 42% 40%), hsl(${hue} 48% 26%))` }}
      >
        <span className="tile-crest">
          <Crest src={league.badge} name={league.name} size={96} />
        </span>
        {count > 0 ? <span className="tile-count">{count}</span> : null}
      </button>
      <div className="tile-caption">
        <div className="card-title">{league.name}</div>
        <div className="card-meta">{subtitle}</div>
      </div>
    </div>
  );
};

// ---------- shelf ----------

export const Shelf = ({
  title,
  count,
  onSeeAll,
  variant = "cards",
  children,
}: {
  title: string;
  count?: number;
  onSeeAll?: () => void;
  variant?: "cards" | "tiles";
  children: ReactNode;
}) => {
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
    <section className={`shelf shelf-${variant}`}>
      <h2 className="shelf-title">
        {onSeeAll ? (
          <button className="shelf-link" onClick={onSeeAll}>
            {title}
            <Icon name="chevron-right" size={14} />
          </button>
        ) : (
          title
        )}
        {count !== undefined ? <span className="shelf-count">{count}</span> : null}
      </h2>
      <div className="shelf-viewport">
        <div ref={track} className="shelf-track" onScroll={measure}>
          {children}
        </div>
        {!edges.start ? (
          <button
            className="shelf-arrow shelf-arrow-start"
            onClick={() => page(-1)}
            aria-label={`Scroll ${title} back`}
            data-tv-skip
          >
            <Icon name="chevron-left" />
          </button>
        ) : null}
        {!edges.end ? (
          <button
            className="shelf-arrow shelf-arrow-end"
            onClick={() => page(1)}
            aria-label={`Scroll ${title} forward`}
            data-tv-skip
          >
            <Icon name="chevron-right" />
          </button>
        ) : null}
      </div>
    </section>
  );
};

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

// ---------- promo / ad slot ----------

/**
 * The one advertising surface: a full-width banner between shelves, like
 * the sponsorship strip on the reference. Content is static for now; the
 * slot exists so a real campaign can drop in without touching the layout.
 */
export const PromoBanner = ({ onAction }: { onAction: () => void }) => (
  <section className="promo" aria-label="Sponsored">
    <div className="promo-copy">
      <span className="promo-brand">
        <span className="brand-mark" aria-hidden>
          <ScorelineBadge />
        </span>
        scoreline
      </span>
      <h3 className="promo-title">Every match. Every sport. One place.</h3>
      <p className="promo-sub">Live scores and streams across football, badminton, basketball, F1 and more - refreshed every minute.</p>
      <button className="button-primary promo-cta" onClick={onAction}>
        Browse Live
      </button>
      <span className="promo-tag">Ad</span>
    </div>
    <div className="promo-art" aria-hidden>
      <img src={otherThumb("promo")} alt="" loading="lazy" decoding="async" />
    </div>
  </section>
);

// ---------- hero carousel ----------

const HERO_INTERVAL_MS = 7000;

export const Hero = ({
  matches,
  onOpen,
  onMore,
  compact = false,
}: {
  matches: readonly Match[];
  onOpen: OpenMatch;
  onMore: (match: Match) => void;
  compact?: boolean;
}) => {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();
  const current = matches[index % Math.max(matches.length, 1)];
  const tv = useTvMode() === "on";
  // Each slide remounts its buttons, so a remote highlight on one would drop
  // to `body` when the slide changes. A focused hero holds still, and if the
  // slide changes anyway (the feed reset below) the highlight is carried to
  // the same action on the next slide. With a remote the hero's Watch Live
  // is also where the highlight starts on first load.
  const [focused, setFocused] = useState(false);
  const carryFocus = useRef<"watch" | "details" | null>(tv ? "watch" : null);
  const takeFocus = (action: "watch" | "details") => (element: HTMLButtonElement | null) => {
    if (element === null || carryFocus.current !== action) return;
    if (document.activeElement !== document.body || element.closest("[inert]") !== null) return;
    element.focus({ preventScroll: true });
  };

  useEffect(() => setIndex(0), [matches]);
  useEffect(() => {
    if (paused || focused || reduced || matches.length < 2) return;
    const timer = window.setTimeout(() => setIndex((value) => (value + 1) % matches.length), HERO_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [index, paused, focused, reduced, matches.length]);

  if (!current) return null;
  const layoutId = `art-hero-${current.id}`;
  return (
    <section
      className={`hero${compact ? " hero-compact" : ""}`}
      aria-roledescription="carousel"
      aria-label="Featured matches"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={(event) => {
        setFocused(true);
        carryFocus.current = event.target.classList.contains("button-tinted") ? "details" : "watch";
      }}
      onBlur={(event) => {
        // A null relatedTarget is the slide unmounting the button, not the
        // viewer leaving: keep the carry so the next slide takes focus.
        if (event.relatedTarget === null || event.currentTarget.contains(event.relatedTarget)) return;
        setFocused(false);
        carryFocus.current = null;
      }}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={current.id}
          className="hero-art"
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: EASE_OUT }}
        >
          <motion.div className="hero-art-frame" layoutId={layoutId} transition={MORPH_SPRING} style={{ borderRadius: 0 }}>
            <MatchArtwork match={current} size="full" />
          </motion.div>
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
          transition={{ duration: 0.4, ease: EASE_OUT }}
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
            <span className="hero-meta-dim">{current.sport}</span>
          </div>
          <div className="hero-actions">
            {canWatch(current) ? (
              <button className="button-primary" onClick={() => onOpen(current, layoutId)} ref={takeFocus("watch")}>
                <Icon name="play" size={14} />
                {current.status.kind === "live" ? "Watch Live" : "Open Stream"}
              </button>
            ) : null}
            <button className="button-tinted" onClick={() => onMore(current)} ref={takeFocus("details")}>
              Details
            </button>
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
