import { useEffect, useRef } from "react";
import { focusTvHome, tvFocusIsHome } from "./tvnav";

/** How often the guard re-checks that the highlight still exists. */
const CHECK_MS = 400;

/**
 * Keeps the remote's highlight inside our chrome while a TV Mode watch screen
 * is mounted (docs/tv-dpad.md section 2).
 *
 * The embedded players take focus when playback starts (2026-10-23 repro:
 * about a second after a server pick, `document.activeElement` became the
 * IFRAME and our window received no keys at all - the remote's Left/Right
 * then seeked their player and no ring was drawn anywhere). The parent can
 * take focus back with a plain `.focus()`, so on every window blur the guard
 * checks, a tick later, whether the blur went into a frame and returns focus
 * to the last control the viewer had. Their in-player keyboard shortcuts are
 * unreachable in TV Mode as a result, which is the point.
 *
 * The interval is the net for the cases no event reports: a focused control
 * that unmounts (Stop, a dismissed notice) leaves focus on `body` without a
 * blur, and the highlight must reappear without the viewer pressing a key.
 * It only acts while this document has focus, so another app in front is
 * never fought.
 */
export const useTvFocusGuard = (enabled: boolean, onFrameFocus?: () => void) => {
  // Their player taking focus is the only sign of playback a cross-origin
  // frame gives us; the watch screen uses it to stop retrying its auto-start.
  const onFrameFocusRef = useRef(onFrameFocus);
  onFrameFocusRef.current = onFrameFocus;
  useEffect(() => {
    if (!enabled) return;
    let last: HTMLElement | null = null;
    let pending = 0;

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.tagName !== "IFRAME") last = target;
    };
    const check = () => {
      if (document.activeElement?.tagName === "IFRAME") onFrameFocusRef.current?.();
      if (!document.hasFocus() || tvFocusIsHome()) return;
      focusTvHome(last);
    };
    const onBlur = () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(check, 0);
    };

    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("blur", onBlur);
    const interval = window.setInterval(check, CHECK_MS);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("blur", onBlur);
      window.clearTimeout(pending);
      window.clearInterval(interval);
    };
  }, [enabled]);
};
