import { useEffect, useId, useRef, useState } from "react";
import type { StreamOption } from "../api/streams";
import { bestMeasured, qualityBadge, streamQuality } from "../domain/streamQuality";
import { Icon } from "./icons";

/**
 * The page-embed server list, as a toolbar menu. Same choices as the old
 * chip row: each entry posts the source's own server-switch message, the
 * measured-quality badge is unchanged, and the pressed entry is the last
 * choice made from here. The menu opens upward because the toolbar is
 * pinned to the bottom of the layer.
 */
export const ServerMenu = ({
  options,
  activeStreamId,
  onChoose,
}: {
  options: readonly StreamOption[];
  activeStreamId: number | null;
  onChoose: (stream: StreamOption) => void;
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const best = bestMeasured(options);
  const active = options.find((stream) => stream.streamId === activeStreamId) ?? null;
  const activeQuality = active === null ? null : streamQuality(active.name);

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

  return (
    <div className="server-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="server-menu-trigger"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={listId}
        aria-label={active === null ? "Stream servers" : `Stream servers, ${active.name}`}
        title={active === null ? "Choose a stream server" : `Stream server ${active.name}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="server-menu-trigger-name">{active === null ? "Servers" : active.name}</span>
        {activeQuality !== null ? (
          <span
            className={`watch-server-quality${best?.stream === active ? " watch-server-quality-best" : ""}`}
          >
            {qualityBadge(activeQuality)}
          </span>
        ) : null}
        <Icon className="server-menu-chevron" name="chevron-down" size={14} />
      </button>
      {open ? (
        <div className="server-menu-list" id={listId} role="group" aria-label="Stream servers">
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
