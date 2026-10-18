import { useEffect, useId, useRef, useState } from "react";
import type { TimChannel } from "../api/timstreams";
import type { StreamOption } from "../api/streams";
import { bestMeasured, qualityBadge, streamQuality } from "../domain/streamQuality";
import { Icon } from "./icons";

/**
 * The page-embed server list, as a toolbar menu. Two sources, one list:
 * the tim-streams second source's channels come first, at the very top
 * (docs/tim-extra-streams.md), with the source's own channels below a
 * divider. A second-source entry swaps the whole stage to a separate
 * embed; it never gets a quality badge (nothing is measured for it) and
 * the `TS` tag tells the two sources apart. The menu opens upward
 * because the toolbar is pinned to the bottom of the layer.
 */
export const ServerMenu = ({
  options,
  activeStreamId,
  onChoose,
  timChannels = [],
  activeTimUrl = null,
  onChooseTim,
}: {
  options: readonly StreamOption[];
  activeStreamId: number | null;
  onChoose: (stream: StreamOption) => void;
  /** The match's tim-streams channels, if any were matched. */
  timChannels?: readonly TimChannel[];
  /** The currently mounted tim channel's url, if one is on stage. */
  activeTimUrl?: string | null;
  onChooseTim?: (channel: TimChannel) => void;
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const best = bestMeasured(options);
  const activeSource = options.find((stream) => stream.streamId === activeStreamId) ?? null;
  const activeTim = timChannels.find((channel) => channel.url === activeTimUrl) ?? null;
  const active = activeSource ?? activeTim;
  const activeQuality = activeSource === null ? null : streamQuality(activeSource.name);
  const hasTimEntries = timChannels.length > 0 && onChooseTim !== undefined;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const caption = active === null ? "Servers" : active.name;
  const ariaLabel =
    active === null
      ? "Stream servers"
      : activeTim === active
        ? `Stream servers, ${active.name} (second source)`
        : `Stream servers, ${active.name}`;

  return (
    <div className="server-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="server-menu-trigger"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={listId}
        aria-label={ariaLabel}
        title={active === null ? "Choose a stream server" : `Stream server ${active.name}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="server-menu-trigger-name">{caption}</span>
        {activeTim !== null ? <span className="watch-server-tag">TS</span> : null}
        {activeQuality !== null ? (
          <span
            className={`watch-server-quality${best?.stream === activeSource ? " watch-server-quality-best" : ""}`}
          >
            {qualityBadge(activeQuality)}
          </span>
        ) : null}
        <Icon className="server-menu-chevron" name="chevron-down" size={14} />
      </button>
      {open ? (
        <div className="server-menu-list" id={listId} role="group" aria-label="Stream servers">
          {/* The second source sits at the very top of the list: its
              channels are whole-stage swaps, not in-frame switches, and
              the visitor scanning the list should meet them first. */}
          {hasTimEntries ? (
            <>
              <div className="server-menu-divider" role="separator" aria-label="Second-source channels">
                External
              </div>
              {timChannels.map((channel) => {
                const selected = activeTimUrl === channel.url;
                return (
                  <button
                    key={channel.url}
                    type="button"
                    className={`watch-server${selected ? " watch-server-on" : ""}`}
                    onClick={() => {
                      onChooseTim?.(channel);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    aria-pressed={selected}
                    title={
                      selected
                        ? `Second-source channel ${channel.name} (on stage)`
                        : `Swap the whole stage to second-source channel ${channel.name} - a different player, no crop or ads guard`
                    }
                  >
                    <span>{channel.name}</span>
                    <span className="watch-server-tag" aria-label="Second source">
                      TS
                    </span>
                  </button>
                );
              })}
            </>
          ) : null}
          {/* The source divider only exists to close the second-source
              group above; without tim entries the list stays exactly what
              it always was. */}
          {hasTimEntries ? (
            <div className="server-menu-divider" role="separator" aria-label="Live source servers">
              Source
            </div>
          ) : null}
          {options.map((stream) => {
            const quality = streamQuality(stream.name);
            const isBestKnown = best?.stream === stream;
            const selected = activeStreamId === stream.streamId;
            const baseTitle = selected
              ? `Stream server ${stream.name}`
              : `Switch the live stream to server ${stream.name}`;
            const title = quality
              ? `${baseTitle} - measured ${qualityBadge(quality)}${isBestKnown ? ", best measured server" : ""}`
              : baseTitle;
            return (
              <button
                key={stream.streamId}
                type="button"
                className={`watch-server${selected ? " watch-server-on" : ""}`}
                onClick={() => {
                  onChoose(stream);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                aria-pressed={selected}
                title={title}
              >
                <span>{stream.name}</span>
                {quality !== null ? (
                  <span className={`watch-server-quality${isBestKnown ? " watch-server-quality-best" : ""}`}>
                    {qualityBadge(quality)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};