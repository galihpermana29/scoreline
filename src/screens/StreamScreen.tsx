import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Match } from "../domain/match";
import { matchLabel } from "../domain/match";
import { formatLongDate, formatTime } from "../lib/format";
import { StatusBadge } from "../components/tv";
import { Crest, Notice } from "../components/ui";
import { parseMatchRoute, sourceUrl } from "../lib/route";
import { useEntryOrigin } from "../lib/useEntryOrigin";
import { pickPlayerUrl } from "../api/player";
import { usePlayerHosts } from "../lib/usePlayerHosts";

/**
 * Simulated watch page. It mirrors the feed's own deep-link shape
 * (/{lang}/{sport}/{competitionSlug}-{id}/{matchSlug}.html). The simulated
 * player is the default view; pressing play mounts the real stream from the
 * source site as a sandboxed iframe. Sandboxing allows scripts and
 * same-origin storage so the player boots, but withholds top-navigation and
 * popups so the source site's ads cannot hijack this tab. Stopping unmounts
 * the frame, which also tears down the stream.
 *
 * Two embed modes, switchable on the live bar (2026-10-16):
 *
 * - "player" (default) embeds their dedicated bare player page directly,
 *   skipping the match page and its banner ads entirely - the player gets
 *   every pixel of the frame. The URL is constructed here (see
 *   src/api/player.ts): mdata is the base64 of {matchId}_{sportType}, and
 *   the host list comes live from their params API (see
 *   src/api/source-sites.ts). Before mounting, each candidate URL is probed
 *   server-side exactly as the iframe will request it (see src/api/probe.ts)
 *   and the first host that provably serves the page is the one embedded -
 *   a cross-origin iframe fires its load event for a 401 text page as
 *   happily as for the real player, so without the probe a tightened gate or
 *   a dead host would look exactly like a healthy embed. When every listed
 *   host refuses or none answers, this mode falls back to their own match
 *   page on its own, which still hands itself off to the live player
 *   client-side, and says so instead of showing a blank frame. The player
 *   page's gate was verified to accept any Referer as long as the load is a
 *   real iframe load, which a browser satisfies natively; the frame
 *   therefore never sets a no-referrer policy.
 * - "page" embeds the full match page as before, kept as the fallback for
 *   the day the direct player's gate or layout changes - their own page
 *   still hands itself off to the live mirror and player client-side.
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
 */

/** How long the embed may stay silent after mounting before it counts as stalled. */
const EMBED_LOAD_TIMEOUT_MS = 15_000;
const kickHint = (match: Match): string =>
  match.status.kind === "live"
    ? "In progress"
    : match.status.kind === "upcoming"
      ? "Kick-off"
      : "Final";

export const StreamScreen = ({ match, href, onExit }: { match: Match; href: string; onExit: () => void }) => {
  const scored = match.homeScore !== null && match.awayScore !== null && match.status.kind !== "upcoming";
  const live = match.status.kind === "live";
  // The live embed only exists while playing; stopped means fully unmounted,
  // so the stream and its bandwidth stop too.
  const [playing, setPlaying] = useState(false);
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
  const [mode, setMode] = useState<"player" | "page">(canPlayer ? "player" : "page");
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

  return (
    <div className="stream">
      <header className="stream-top">
        <button className="stream-back" onClick={onExit}>
          <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
            <path d="M7 1L3 5.5 7 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Scoreline
        </button>
        <span
          className="stream-flag"
          title={
            playing
              ? embedFailures >= 2
                ? "The live source is not answering; retrying is available below the player"
                : embedMode === "player"
                  ? "The source site's bare player page is embedded directly, on the first listed player host that provably serves it"
                  : "The source site's full match page is embedded, on its currently resolved domain"
              : "This page plays no video - it is a local simulation"
          }
        >
          {playing
            ? embedFailures >= 2
              ? "Source unreachable"
              : embedMode === "player"
                ? "Live player"
                : "Live page embed"
            : "Simulated stream"}
        </span>
      </header>

      <h1 className="stream-title">{matchLabel(match)}</h1>
      <p className="stream-subtitle">
        {match.sport} · {match.league.name}
      </p>

      <div className="player-shell" ref={shellRef}>
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
            <div className="player-embed-bar">
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
                className="player-embed-fullscreen"
                onClick={toggleFullscreen}
                title={
                  isFullscreen
                    ? "Leave fullscreen"
                    : "Fullscreen the live embed (uses this page, not the player's own button)"
                }
              >
                <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
                  {isFullscreen ? (
                    <path
                      d="M4 1v3H1M8 1v3h3M4 11V8H1M8 11V8h3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : (
                    <path
                      d="M1 4V1h3M11 4V1H8M1 8v3h3M11 8v3H8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </svg>
                {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              </button>
              <button
                className="player-embed-stop"
                onClick={stopEmbed}
                title="Stop the live embed and return to the simulated player"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                  <rect x="1" y="1" width="8" height="8" rx="1.5" fill="currentColor" />
                </svg>
                Stop embed
              </button>
            </div>
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
              <svg width="18" height="18" viewBox="0 0 14 14" aria-hidden>
                <path d="M3.5 2.2 11.8 7 3.5 11.8z" fill="currentColor" />
              </svg>
            </button>

            <div className="player-status">
              {live ? (
                <span className="badge-live">
                  <span className="live-dot" />
                  LIVE
                </span>
              ) : (
                <StatusBadge match={match} />
              )}
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
                    <span className="player-side-name" lang="en">{match.home.name}</span>
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
                    <span className="player-side-name" lang="en">{match.away.name}</span>
                  </div>
                </>
              )}
            </div>

            <div className="player-controls" aria-hidden>
              <span className="player-control-icon">
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <path d="M3 2h3v10H3zM8 2h3v10H8z" fill="currentColor" />
                </svg>
              </span>
              <span className="player-timeline">
                <span className="player-timeline-live" />
              </span>
              <span className="player-control-icon player-control-mute">
                <svg width="15" height="15" viewBox="0 0 15 15">
                  <path d="M2 5h3l4-3v11L5 10H2z" fill="currentColor" />
                  <path d="M11 5c1.2 1.4 1.2 3.6 0 5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                </svg>
              </span>
              <span className="player-quality">{live ? "1080p" : "—"}</span>
              <span className="player-control-icon">
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <path d="M1 4l6 4 6-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <rect x="1" y="5" width="12" height="7" rx="1.5" fill="currentColor" />
                </svg>
              </span>
            </div>

            <div className="player-note">
              <span className="player-note-dot" />
              Simulated feed - no video is streamed here
            </div>
          </>
        )}
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
        <div className="stream-meta-cell">
          <dt>Route</dt>
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
    </div>
  );
};

/** Player-shaped skeleton shown while the deep-linked match is still loading from the feed. */
export const StreamSkeleton = () => (
  <div className="stream">
    <header className="stream-top">
      <span className="stream-back stream-back-skeleton" aria-hidden />
    </header>
    <div className="stream-skeleton-title" aria-hidden />
    <div className="player-shell player-shell-skeleton" aria-label="Loading match">
      <div className="player-art" aria-hidden />
      <motion.div
        className="stream-skeleton-bar"
        initial={{ opacity: 0.4 }}
        animate={{ opacity: 1 }}
        transition={{ repeat: Infinity, repeatType: "reverse", duration: 1 }}
      />
    </div>
  </div>
);

/** Shown when the deep link doesn't match anything in the current live window. */
export const StreamUnavailable = ({ onExit }: { onExit: () => void }) => (
  <div className="stream">
    <header className="stream-top">
      <button className="stream-back" onClick={onExit}>
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
          <path d="M7 1L3 5.5 7 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Scoreline
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