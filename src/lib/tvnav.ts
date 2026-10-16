import { useEffect } from "react";

/**
 * D-pad (spatial) navigation for the app chrome: arrow keys move focus
 * geometrically, Enter activates, exactly like a TV remote expects
 * (2026-10-17: TV browsers - and Android WebView shells like TVBro in
 * particular - do not ship spatial navigation, so with a remote the app
 * is otherwise pointer-only). Mounted in App, gated on TV Mode
 * (lib/tvmode.ts): the sidebar and browse surface answer the remote too,
 * while off-mode browsers keep their native arrow behaviour (scrolling).
 *
 * How it works: every arrow keypress looks at the currently focused
 * element's box, gathers every rendered focusable control outside inert
 * subtrees, and focuses the one nearest in the pressed direction - near
 * on the direction axis, with a strong penalty for sideways drift, so
 * Left/Right walk a row and Up/Down jump between rows (the floating
 * toolbar, the back pill, the play button, the related-match cards).
 * Enter then activates natively and :focus-visible repaints the ring, so
 * the remote never needs a cursor. When no candidate sits in that
 * direction the keypress is left alone: native behaviour (page scroll)
 * keeps working. Inputs are excluded so typed text never leaks arrows.
 *
 * Scope note: while the watch layer is open the browse surface is inert,
 * and programmatically focusing an element inside an inert subtree is a
 * no-op by spec - the `closest('[inert]')` filter just avoids wasting the
 * pick on them. The hook is mounted app-wide (App passes TV Mode as the
 * gate, so a pointer-driven browser keeps its native arrow behaviour:
 * scrolling), and the inert filter keeps it out of the hidden surface
 * meanwhile.
 */

const DIRECTIONS = {
  ArrowUp: { primary: "y", sign: -1 },
  ArrowDown: { primary: "y", sign: 1 },
  ArrowLeft: { primary: "x", sign: -1 },
  ArrowRight: { primary: "x", sign: 1 },
} as const;

type Direction = (typeof DIRECTIONS)[keyof typeof DIRECTIONS];

const CANDIDATES = "button:not([disabled]), a[href], input:not([disabled]), select, [tabindex]:not([tabindex='-1'])";

/** A tiny tolerance so a 0-gap row still counts as "in that direction". */
const EPSILON = 2;
/**
 * How far a candidate must sit in the pressed direction before it counts at
 * all: sub-pixel vertical jitter inside one row (adjacent buttons rarely
 * render at exactly identical `top`s) must never read as "up" or "down" -
 * the first live test moved focus sideways on ArrowUp for exactly this
 * reason. Rows have real gaps; this floor is far below any of them.
 */
const MIN_DIRECTION = 8;

const centerOf = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

const isRendered = (element: HTMLElement) => {
  if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
  // offsetParent is null for fixed-position elements, which is exactly what
  // the toolbar is - getClientRects is the rendered test that covers both.
  return element.getClientRects().length > 0;
};

/**
 * Focus the nearest candidate in the pressed direction. Returns whether a
 * target was found (and the keypress therefore consumed).
 */
const focusNearest = (direction: Direction): boolean => {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const anchorRect =
    active !== null && isRendered(active)
      ? active.getBoundingClientRect()
      : // Nothing focusable yet: anchor at the viewport's centre so the
        // first arrow press reaches into the page instead of scrolling it.
        new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
  const anchor = centerOf(anchorRect);

  // Which axis the direction runs on, and which it crosses.
  const axis = direction.primary; // "x" | "y"
  const cross = axis === "x" ? "y" : "x";
  const forward = direction.sign;
  const anchorFar = axis === "x" ? anchorRect.right : anchorRect.bottom;
  const anchorNear = axis === "x" ? anchorRect.left : anchorRect.top;

  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const element of document.querySelectorAll<HTMLElement>(CANDIDATES)) {
    if (element === active) continue;
    if (!isRendered(element)) continue;
    // Inert subtrees (the browse surface while watching) cannot receive
    // focus at all; skip them before geometry so they never win a pick.
    if (element.closest("[inert]") !== null) continue;
    const rect = element.getBoundingClientRect();
    const center = centerOf(rect);
    const far = axis === "x" ? rect.right : rect.bottom;
    const near = axis === "x" ? rect.left : rect.top;
    // The candidate must genuinely lie in the pressed direction: its near
    // edge past the anchor's far edge by a real gap (rows like toolbar
    // buttons), or at least its centre well ahead of the anchor's.
    const beyondEdge = forward > 0 ? far : near;
    const edgeOk = forward > 0 ? beyondEdge > anchorFar + MIN_DIRECTION : beyondEdge < anchorNear - MIN_DIRECTION;
    const centreDelta = (center[axis] - anchor[axis]) * forward;
    if (!edgeOk && centreDelta <= MIN_DIRECTION) continue;
    // Distance along the direction axis, from the anchor's facing edge.
    const primary = forward > 0 ? Math.max(near - anchorFar, EPSILON) : Math.max(anchorNear - far, EPSILON);
    // Sideways drift costs double, and cross-axis overlap is free: that
    // is what makes Left/Right walk a row before it climbs out of it.
    const overlaps =
      axis === "x"
        ? rect.bottom > anchorRect.top && rect.top < anchorRect.bottom
        : rect.right > anchorRect.left && rect.left < anchorRect.right;
    const crossCenter = Math.abs(center[cross] - anchor[cross]);
    const drift = overlaps ? 0 : crossCenter;
    const score = primary + drift * 2 + crossCenter * 0.1;
    if (score < bestScore) {
      bestScore = score;
      best = element;
    }
  }

  if (best === null) return false;
  best.focus({ preventScroll: true });
  best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
  return true;
};

/** Activates D-pad navigation for as long as the calling layer is mounted. */
export const useTvNavigation = (enabled = true) => {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = DIRECTIONS[event.key as keyof typeof DIRECTIONS];
      if (direction === undefined) return;
      // Modifier combos belong to the browser (and nobody on a remote
      // presses them); typing contexts keep their arrows.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      // Inside iframes (the stream embed) the keys belong to the source's
      // own player controls, not to our navigation.
      if (target instanceof HTMLElement && target.tagName === "IFRAME") return;
      if (!focusNearest(direction)) return;
      // Focus moved: swallow the key so the page does not also scroll
      // underneath the move.
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
};