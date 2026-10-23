import { useEffect, useRef, useState } from "react";

/** How long the watch screen's controls stay up without any interaction. */
const IDLE_MS = 40_000;
const ACTIVITY = ["pointermove", "pointerdown", "wheel", "touchstart", "keydown"] as const;
/** Keys that would move the highlight or press a control. Back is not one: it still steps back. */
const ACTION_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "]);

/**
 * Idle state for the watch screen's controls: true after `IDLE_MS` without a
 * pointer move, press, wheel, touch or key, so the picture is left clear,
 * and false again on the next one. `holds` is asked when the timer runs out
 * and re-arms it instead (an open menu, a pointer resting on the toolbar).
 *
 * The interaction that wakes the controls only shows them: with nothing
 * visible, a remote press or a tap would otherwise move or press a control
 * the viewer cannot see. The listeners sit on `window` in the capture
 * phase, ahead of every key and click handler in the app. A pointer over
 * the video itself is never seen - the frame is cross-origin - so the mouse
 * wakes the controls from our own chrome, including the toolbar's spot.
 */
export const useIdleChrome = (enabled: boolean, holds: () => boolean): boolean => {
  const [idle, setIdle] = useState(false);
  const holdsRef = useRef(holds);
  holdsRef.current = holds;

  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    let isIdle = false;
    let swallowClick = false;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (holdsRef.current()) return arm();
        isIdle = true;
        setIdle(true);
      }, IDLE_MS);
    };
    const wake = (event: Event) => {
      if (event.type === "pointerdown" && !isIdle) swallowClick = false;
      if (isIdle) {
        isIdle = false;
        setIdle(false);
        if (event.type === "pointerdown" || event.type === "touchstart") swallowClick = true;
        if (event instanceof KeyboardEvent && ACTION_KEYS.has(event.key)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }
      arm();
    };
    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    for (const type of ACTIVITY) window.addEventListener(type, wake, { capture: true });
    window.addEventListener("click", onClick, { capture: true });
    arm();
    return () => {
      window.clearTimeout(timer);
      for (const type of ACTIVITY) window.removeEventListener(type, wake, { capture: true });
      window.removeEventListener("click", onClick, { capture: true });
    };
  }, [enabled]);

  return enabled && idle;
};
