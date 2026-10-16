import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Match } from "../domain/match";
import { matchLabel } from "../domain/match";
import { formatLongDate, formatTime } from "../lib/format";
import { MORPH_SPRING, MatchCard, Shelf, StatusBadge, kickoffLabel, type OpenMatch } from "../components/tv";
import { Icon } from "../components/icons";
import { Crest, Notice } from "../components/ui";
import { parseMatchRoute, sourceUrl } from "../lib/route";
import { useEntryOrigin } from "../lib/useEntryOrigin";
import { pickPlayerUrl } from "../api/player";
import { usePlayerHosts } from "../lib/usePlayerHosts";
import { downloadCalendarEvent } from "../lib/calendar";

/**
 * The watch screen. It mirrors the feed's own deep-link shape
 * (/{lang}/{sport}/{competitionSlug}-{id}/{matchSlug}.html). The simulated
 * player is the default view; pressing play mounts the real stream from the
 * source site as a sandboxed iframe. Sandboxing allows scripts and
 * same-origin storage so the player boots, but withholds top-navigation and
 * popups so the source site's ads cannot hijack this tab. Stopping unmounts
 * the frame, which also tears down the stream.
 *
 * Two embed modes, switchable on the toolbar (2026-10-16):
 *
 * - "page" (default) embeds the full match page, which still hands itself
 *   off to the live mirror and player client-side. Their player page runs a
 *   client-side Referer check: document.referrer's domain must be in the
 *   params API's `playSiteDomains` allowlist (the operator's own mirror
 *   fronts; "localhost" is in it, so dev sees the clean player), and a
 *   referer-less load gets 403 from their edge. A foreign origin like a
 *   vercel.app deployment can never satisfy that list, so the full page -
 *   whose nested player iframe carries their own domain as the Referer - is
 *   the only embed that works everywhere.
 * - "player" embeds their dedicated bare player page directly, skipping the
 *   match page and its banner ads entirely - the player gets every pixel of
 *   the frame. The URL is constructed here (see src/api/player.ts): mdata is
 *   the base64 of {matchId}_{sportType}, and the host list comes live from
 *   their params API (see src/api/source-sites.ts). Before mounting, each
 *   candidate URL is probed server-side exactly as the iframe will request
 *   it (see src/api/probe.ts) and the first host that provably serves the
 *   page is the one embedded - a cross-origin iframe fires its load event
 *   for a 401 text page as happily as for the real player, so without the
 *   probe a tightened gate or a dead host would look exactly like a healthy
 *   embed. Note the probe cannot see the Referer allowlist: the page answers
 *   200 to a server-side fetch from any origin and the refusal happens in
 *   the player's own JS. When every listed host refuses or none answers,
 *   this mode falls back to their own match page on its own and says so
 *   instead of showing a blank frame.
 *
 * Fullscreen is ours, not theirs (verified 2026-10-16): the embedded player's
 * own fullscreen button calls requestFullscreen() from inside a nested
 * cross-origin frame (ours -> their player or mirror chain), a request
 * Chrome treats per-origin and can prompt for or silently block. This screen
 * instead fullscreens its own .player-shell from the top document, which
 * needs no permission delegation at all, so the control works no matter how
 * the source site re-wires its own embed.
 *
 * Rotation resilience (2026-10-16): no embedded origin is hardcoded -
 * useEntryOrigin resolves the live entry generation and usePlayerHosts the
 * live player hosts, both at runtime. A mounted embed that never signals
 * load within the watchdog window is treated as a mid-session rotation:
 * both are re-resolved from scratch and the frame remounted once; a second
 * stall swaps the frame for an explicit retry notice instead of spinning
 * forever. Player-host rotation inside the "page" mode needs no handling
 * here: their own page embeds the live player host client-side.
 *
 * Layout: the frame is the screen. It takes the full content width (capped
 * by the viewport height so it never scrolls off), and everything else -
 * title, status, toolbar, details, related fixtures - sits below it. The
 * shell shares `layoutId` with the card that opened it, so arriving here
 * reads as that card growing into the player rather than a page swap.
 */

/** How long the embed may stay silent after mounting before it counts as stalled. */
const EMBED_LOAD_TIMEOUT_MS = 15_000;
const kickHint = (match: Match): string =>
  match.status.kind === "live" ? "In progress" : match.status.kind === "upcoming" ? "Kick-off" : "Final";

export const StreamScreen = ({
  match,
  href,
  layoutId,
  autoplay,
  related,
  onExit,
  onOpen,
  onMore,
}: {
  match: Match;
  href: string;
  /** Shared element id of the card this screen opened from, if any. */
  layoutId: string | null;
  /** The user explicitly asked to watch: start the live embed without a second click. */
  autoplay: boolean;
  related: readonly Match[];
  onExit: () => void;
  onOpen: OpenMatch;
  onMore: (match: Match) => void;
}) => {
  const scored = match.homeScore !== null && match.awayScore !== null && match.status.kind !== "upcoming";
  const live = match.status.kind === "live";
  // The live embed only exists while playing; stopped means fully unmounted,
  // so the stream and its bandwidth stop too. A click that asked to watch a
  // live match starts it straight away - that click is the user activation.
  const [playing, setPlaying] = useState(autoplay && live);
  const [embedReady, setEmbedReady] = useState(false);

  // Rotation resilience: the embedded origins come from runtime resolution,
  // and a stalled frame triggers a fresh re-resolution plus a remount (bumping
  // the epoch) rather than leaving a dead frame on screen. Failures counts
  // stalls since the last explicit start/retry: 0 healthy, 1 remounting, 2
  // gave up and shows the retry notice.
  const { origin, reload: reloadOrigin } = useEntryOrigin();
  const { hosts: playerHosts, reload: reloadPlayerHosts } = usePlayerHosts();
  const [embedEpoch, setEmbedEpoch] = useState(0);
  const [embedFailures, setEmbedFailures] = useState(0);

  // Embed mode: their bare player page directly (default), or their full
  // match page as the fallback. Both ride the runtime-resolved hosts. The
  // direct player needs the route's language and match id plus the feed's
  // numeric sport id to build mdata; without any of those the page mode is
  // the only constructible option.
  const route = parseMatchRoute(href);
  const canPlayer = route !== null && match.sportId !== undefined;
  const [mode, setMode] = useState<"player" | "page">("page");
  const embedMode = canPlayer ? mode : "page";
  const setEmbedMode = (next: "player" | "page") => {
    setMode(next);
    // A mode switch mid-play is a remount: it re-arms the load watchdog
    // instead of leaving a half-navigated frame.
    if (playing) {
      setEmbedReady(false);
      setEmbedEpoch((epoch) => epoch + 1);
    }
  };

  // The verified direct-player URL for the current embed epoch, or null
  // while the probe is still choosing (or the page mode is active). Keyed
  // by epoch + match + sport so every remount re-probes, a match switch
  // never replays the previous match's frame, and a background host-list
  // refresh mid-play never restarts a working frame.
  const [playerPick, setPlayerPick] = useState<{ key: string; url: string } | null>(null);
  // Set when the probe itself gave up on the direct player and this screen
  // fell back to the full page embed; cleared like fullscreenDenied.
  const [playerNotice, setPlayerNotice] = useState<string | null>(null);

  useEffect(() => {
    if (playerNotice === null) return;
    const timer = window.setTimeout(() => setPlayerNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [playerNotice]);

  // Direct-player selection: probe each listed host's exact embed URL
  // server-side (see pickPlayerUrl) and mount only the first one that
  // provably serves the page. Candidate order rotates with the epoch so a
  // remount does not retry the same dead host first.
  useEffect(() => {
    if (!playing || embedMode !== "player" || route === null || match.sportId === undefined) return;
    const key = `${embedEpoch}:${route.lang}:${route.matchId}:${match.sportId}`;
    if (playerPick !== null && playerPick.key === key) return;
    let cancelled = false;
    const source = { lang: route.lang, matchId: route.matchId, sportType: match.sportId };
    const rotateBy = embedEpoch % Math.max(playerHosts.length, 1);
    const candidates = [...playerHosts.slice(rotateBy), ...playerHosts.slice(0, rotateBy)];
    void pickPlayerUrl(candidates, source).then((pick) => {
      if (cancelled) return;
      if (pick.kind === "embed") {
        setPlayerPick({ key, url: pick.url });
        return;
      }
      // Every listed host refused the embed or none answered: the direct
      // player is done for now. Fall back to their own match page - which
      // still hands itself off to the live player client-side - and say
      // so, instead of mounting a frame that looks healthy while showing
      // nothing.
      setPlayerNotice(
        pick.kind === "refused"
          ? "The source refused the direct player - showing the full page embed instead"
          : "No direct player host answered - showing the full page embed instead",
      );
      setMode("page");
      setEmbedReady(false);
      setEmbedEpoch((epoch) => epoch + 1);
    });
    return () => {
      cancelled = true;
    };
    // playerHosts is read at pick time only: a mid-play list refresh must
    // not restart a mounted frame, and every epoch bump re-reads the fresh
    // list. playerPick is the guard that makes re-runs no-ops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, embedMode, embedEpoch, playerPick, route?.lang, route?.matchId, match.sportId]);

  const playerPickUrl = embedMode === "player" ? (playerPick?.url ?? null) : null;
  // The frame mounts only on verified ground in player mode; while the
  // probe is choosing, the loading overlay stands in for it.
  const embedMounted = embedMode === "page" || playerPickUrl !== null;
  const embedSrc = playerPickUrl !== null ? playerPickUrl : sourceUrl(href, origin);

  // Fullscreen state mirrors document.fullscreenElement so the control stays
  // in sync even when the browser exits fullscreen on its own (Esc key).
  const shellRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Set when the browser itself denies a requestFullscreen; browsers give no
  // event for this, so it is cleared on the next change or after a pause.
  const [fullscreenDenied, setFullscreenDenied] = useState(false);

  useEffect(() => {
    const sync = () => {
      setIsFullscreen(document.fullscreenElement !== null);
      setFullscreenDenied(false);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    if (!fullscreenDenied) return;
    const timer = setTimeout(() => setFullscreenDenied(false), 4000);
    return () => clearTimeout(timer);
  }, [fullscreenDenied]);

  const startEmbed = () => {
    setEmbedReady(false);
    setEmbedFailures(0);
    setPlaying(true);
  };
  const stopEmbed = () => {
    setPlaying(false);
    setEmbedReady(false);
    setEmbedFailures(0);
    // Leaving fullscreen on stop returns the page to its normal layout
    // instead of showing the simulated shell stretched over the screen.
    if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => {});
  };

  /**
   * Remounts the embed frame on freshly resolved hosts. Both reloads must
   * settle before the epoch bumps, otherwise the new frame would mount on a
   * stale origin or player host and never see the rotation.
   */
  const remountEmbed = (fresh: boolean) => {
    setEmbedReady(false);
    const reloads: Promise<unknown>[] = [
      // The page mode embeds the entry origin only, but reloading both costs
      // one extra request and keeps the player list warm for a mode switch.
      // Neither resolver throws by contract; the catches are hard guards.
      reloadOrigin(fresh).catch(() => undefined),
      reloadPlayerHosts(fresh).catch(() => undefined),
    ];
    void Promise.all(reloads).finally(() => setEmbedEpoch((epoch) => epoch + 1));
  };

  const retryEmbed = () => {
    setEmbedFailures(0);
    remountEmbed(true);
  };

  // Watchdog: a mounted frame that never signals load within the window is
  // treated as a dead or rotated host. First stall re-resolves the entry
  // origin and the player hosts from scratch and remounts once; a second
  // stall stops retrying on its own and swaps the frame for the explicit
  // retry notice.
  useEffect(() => {
    if (!playing || embedFailures >= 2 || embedReady) return;
    // Nothing to watch yet in player mode: the probe is still choosing the
    // host, and its own candidates carry the timeouts.
    if (embedMode === "player" && playerPickUrl === null) return;
    const timer = window.setTimeout(() => {
      if (embedFailures === 0) {
        setEmbedFailures(1);
        remountEmbed(true);
      } else {
        setEmbedFailures(2);
      }
    }, EMBED_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
    // reloadOrigin is a fresh closure each render but stable in behaviour;
    // epoch is included so a remount re-arms the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, embedReady, embedEpoch, embedFailures, reloadOrigin]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement !== null) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    shellRef.current?.requestFullscreen().catch(() => setFullscreenDenied(true));
  };

  const flag = playing
    ? embedFailures >= 2
      ? { label: "Source unreachable", tone: "warn" as const, title: "The live source is not answering; retrying is available below the player" }
      : embedMode === "player"
        ? { label: "Live player", tone: "live" as const, title: "The source site's bare player page is embedded directly, on the first listed player host that provably serves it" }
        : { label: "Live page embed", tone: "live" as const, title: "The source site's full match page is embedded, on its currently resolved domain" }
    : { label: "Simulated", tone: "idle" as const, title: "This frame plays no video until you press play - it is a local simulation" };

  const embedControls = (
    <>
      <div className="player-embed-mode" role="group" aria-label="Embed mode">
        <button
          className={embedMode === "player" ? "player-embed-mode-on" : undefined}
          onClick={() => setEmbedMode("player")}
          disabled={!canPlayer}
          title={
            canPlayer
              ? "Embed the source site's bare player page - no ads, full frame"
              : "Needs the feed's numeric match and sport ids for this match"
          }
        >
          Player
        </button>
        <button
          className={embedMode === "page" ? "player-embed-mode-on" : undefined}
          onClick={() => setEmbedMode("page")}
          title="Embed the source site's full match page - the fallback if the bare player ever stops working"
        >
          Page
        </button>
      </div>
      <button
        className="toolbar-button"
        onClick={toggleFullscreen}
        title={isFullscreen ? "Leave fullscreen" : "Fullscreen the live embed (uses this page, not the player's own button)"}
      >
        <Icon name={isFullscreen ? "fullscreen-exit" : "fullscreen"} size={16} />
        {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
      </button>
      <button className="toolbar-button" onClick={stopEmbed} title="Stop the live embed and return to the simulated player">
        <Icon name="stop" size={14} />
        Stop
      </button>
    </>
  );

  return (
    <div className="watch">
      <motion.header
        className="watch-top"
        initial={layoutId ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: layoutId ? 0.1 : 0 }}
      >
        <button className="back-pill back-pill-static" onClick={onExit} aria-label="Back">
          <Icon name="chevron-left" size={16} />
          <span className="back-pill-label">Back</span>
        </button>
        <span className="watch-top-title">{matchLabel(match)}</span>
        <span className={`stream-flag stream-flag-${flag.tone}`} title={flag.title}>
          {flag.label}
        </span>
      </motion.header>

      <div className="watch-stage">
        <motion.div
          className="player-shell"
          ref={shellRef}
          layoutId={layoutId ?? undefined}
          transition={MORPH_SPRING}
          style={{ borderRadius: 16 }}
        >
          {playing && embedFailures < 2 ? (
            <>
              {embedMounted ? (
                <iframe
                  key={`${embedMode}-${embedEpoch}`}
                  className="player-embed"
                  src={embedSrc}
                  title={
                    embedMode === "player"
                      ? "Live bare player embedded from the source site's player host, verified before mounting"
                      : "Live match page embedded from the source site"
                  }
                  sandbox="allow-scripts allow-same-origin"
                  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                  // Never no-referrer: the player page's gate 401s requests with
                  // no Referer, and the browser's default policy already sends
                  // this app's origin, which the gate was verified to accept.
                  referrerPolicy="no-referrer-when-downgrade"
                  onLoad={() => setEmbedReady(true)}
                />
              ) : null}
              {!embedReady ? (
                <div className="player-embed-loading" role="status">
                  <span className="player-note-dot" />
                  {embedMode === "player" && !embedMounted
                    ? "Verifying the live source…"
                    : embedFailures === 0
                      ? "Connecting to live source…"
                      : "Reconnecting to a fresh live source…"}
                </div>
              ) : null}
              {/* In fullscreen the toolbar below is off screen, so the
                  controls ride inside the frame for the duration. */}
              {isFullscreen ? <div className="player-embed-bar">{embedControls}</div> : null}
              {fullscreenDenied ? (
                <div className="player-embed-denied" role="status">
                  Fullscreen was blocked by the browser
                </div>
              ) : null}
              {playerNotice !== null ? (
                <div className="player-embed-denied" role="status">
                  {playerNotice}
                </div>
              ) : null}
            </>
          ) : playing ? (
            <div className="player-embed-failed">
              <Notice
                icon="📡"
                title="Live source unreachable"
                body="The source site did not answer even after a fresh domain lookup - the operator may be mid-rotation. The feed keeps updating in the background; retry in a moment."
                action={{ label: "Retry live source", onClick: retryEmbed }}
              />
            </div>
          ) : (
            <>
              <div className="player-art" aria-hidden />
              <div className="player-scanlines" aria-hidden />
              <div className="player-grid" aria-hidden />

              <button
                className="player-play"
                onClick={startEmbed}
                aria-label="Play the live match embed"
                title="Play the live match from the source site"
              >
                <Icon name="play" size={26} />
              </button>

              <div className="player-status">
                <StatusBadge match={match} />
              </div>

              <div className="player-score">
                {match.titleOnly ? (
                  <div className="player-event" lang="en">
                    {match.home.name}
                  </div>
                ) : (
                  <>
                    <div className="player-side">
                      <Crest src={match.home.badge} name={match.home.name} size={64} />
                      <span className="player-side-name" lang="en">
                        {match.home.name}
                      </span>
                    </div>
                    <div className="player-count">
                      {scored ? (
                        <div className="player-count-score">
                          {match.homeScore}
                          <span className="player-count-divider">–</span>
                          {match.awayScore}
                        </div>
                      ) : (
                        <div className="player-count-time">{match.kickoff ? formatTime(match.kickoff) : "TBD"}</div>
                      )}
                      <span className="player-count-hint">{kickHint(match)}</span>
                    </div>
                    <div className="player-side">
                      <Crest src={match.away.badge} name={match.away.name} size={64} />
                      <span className="player-side-name" lang="en">
                        {match.away.name}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="player-note">
                <span className="player-note-dot" />
                Simulated feed - press play for the live stream
              </div>
            </>
          )}
        </motion.div>
      </div>

      <motion.div
        className="watch-body"
        initial={layoutId ? { opacity: 0, y: 12 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1], delay: layoutId ? 0.12 : 0 }}
      >
        <div className="watch-headline">
          <div className="watch-headline-text">
            <div className="hero-eyebrow">
              <Crest src={match.league.badge} name={match.league.name} size={18} />
              {match.league.name} · {match.sport}
            </div>
            <h1 className="watch-title">{matchLabel(match)}</h1>
            <div className="hero-meta">
              <StatusBadge match={match} />
              {scored ? (
                <span className="hero-score">
                  {match.homeScore} – {match.awayScore}
                </span>
              ) : (
                <span>{kickoffLabel(match, true)}</span>
              )}
              {match.country ? <span className="hero-meta-dim">{match.country}</span> : null}
            </div>
          </div>
          <div className="watch-toolbar" role="toolbar" aria-label="Player controls">
            {playing ? (
              embedControls
            ) : (
              <>
                <button className="button-primary" onClick={startEmbed}>
                  <Icon name="play" size={14} />
                  {live ? "Play Live" : "Open Stream"}
                </button>
                {match.status.kind === "upcoming" && match.kickoff ? (
                  <button className="button-tinted" onClick={() => downloadCalendarEvent(match)}>
                    <Icon name="calendar" size={16} />
                    Add to Calendar
                  </button>
                ) : null}
                <button className="button-tinted" onClick={() => onMore(match)}>
                  Details
                </button>
              </>
            )}
          </div>
        </div>

        <dl className="stream-meta">
          {match.kickoff ? (
            <div className="stream-meta-cell">
              <dt>{live ? "Started" : "Kick-off"}</dt>
              <dd>{`${formatLongDate(match.kickoff)}, ${formatTime(match.kickoff)}`}</dd>
            </div>
          ) : null}
          {match.country ? (
            <div className="stream-meta-cell">
              <dt>Country</dt>
              <dd>{match.country}</dd>
            </div>
          ) : null}
          {match.odds ? (
            <div className="stream-meta-cell">
              <dt>Odds</dt>
              <dd>{match.odds.join(" · ")}</dd>
            </div>
          ) : null}
          <div className="stream-meta-cell stream-meta-cell-wide">
            <dt>Source</dt>
            <dd>
              <a
                className="stream-route"
                href={sourceUrl(href, origin)}
                target="_blank"
                rel="noopener noreferrer"
                title="Open the real match page on the source site (new tab)"
              >
                {href}
              </a>
            </dd>
          </div>
        </dl>

        {related.length > 0 ? (
          <Shelf title="Also Live" count={related.length}>
            {related.map((other) => (
              <MatchCard key={other.id} match={other} layoutId={`art-related-${other.id}`} onOpen={onOpen} onMore={onMore} />
            ))}
          </Shelf>
        ) : null}
      </motion.div>
    </div>
  );
};

/** Player-shaped skeleton shown while the deep-linked match is still loading from the feed. */
export const StreamSkeleton = ({ onExit }: { onExit: () => void }) => (
  <div className="watch">
    <header className="watch-top">
      <button className="back-pill back-pill-static" onClick={onExit} aria-label="Back">
        <Icon name="chevron-left" size={16} />
        <span className="back-pill-label">Back</span>
      </button>
    </header>
    <div className="watch-stage">
      <div className="player-shell player-shell-skeleton" aria-label="Loading match" style={{ borderRadius: 16 }}>
        <div className="player-art" aria-hidden />
        <motion.div
          className="stream-skeleton-bar"
          initial={{ opacity: 0.4 }}
          animate={{ opacity: 1 }}
          transition={{ repeat: Infinity, repeatType: "reverse", duration: 1 }}
        />
      </div>
    </div>
    <div className="watch-body">
      <div className="stream-skeleton-title" aria-hidden />
    </div>
  </div>
);

/** Shown when the deep link doesn't match anything in the current live window. */
export const StreamUnavailable = ({ onExit }: { onExit: () => void }) => (
  <div className="watch">
    <header className="watch-top">
      <button className="back-pill back-pill-static" onClick={onExit} aria-label="Back">
        <Icon name="chevron-left" size={16} />
        <span className="back-pill-label">Back</span>
      </button>
    </header>
    <div className="stream-unavailable">
      <Notice
        icon="📺"
        title="Stream unavailable"
        body="This match is no longer in the live feed - the feed only covers a window around kick-off. Head back to browse what's on right now."
        action={{ label: "Back to Scoreline", onClick: onExit }}
      />
    </div>
  </div>
);
