import { useEffect } from "react";

/**
 * D-pad navigation for the app chrome: arrow keys move focus, Enter
 * activates, exactly like a TV remote expects (2026-10-17: TV browsers - and
 * Android WebView shells like TVBro in particular - do not ship spatial
 * navigation, so with a remote the app is otherwise pointer-only). Mounted
 * in App, gated on TV Mode (lib/tvmode.ts), so off-mode browsers keep their
 * native arrow behaviour (scrolling).
 *
 * Three ways to move, picked by what currently owns the remote:
 *
 * - An open modal dialog (`aria-modal="true"`, the topmost one) traps the
 *   remote: geometric moves among its own controls only.
 * - A remote scope (`data-tv-scope`, the innermost rendered one - the watch
 *   screen, or the fullscreen bar inside it) moves by explicit rows
 *   (`data-tv-row`, in DOM order): Up/Down step between rows, landing on
 *   the item last focused there or the one nearest horizontally, and
 *   Left/Right walk the row in visual order, stopping at its ends. Nothing
 *   outside the scope is reachable, and elements outside every row (the
 *   player frame, the source link) are never visited. The watch screen
 *   needs this because its layout - a fixed toolbar floating over a
 *   scrolling shelf, an iframe in the middle, the sidebar beside it -
 *   defeats geometry (2026-10-23 repro: Down bounced toolbar/shelf, Up
 *   walked into the sidebar, one Up from Servers was "Turn TV Mode off").
 * - Anywhere else, geometry: every arrow press looks at the focused
 *   element's box and focuses the nearest rendered control in the pressed
 *   direction - near on the direction axis, with a strong penalty for
 *   sideways drift, so Left/Right walk a row and Up/Down jump between rows.
 *
 * Enter then activates natively and :focus-visible repaints the ring, so the
 * remote never needs a cursor. Inside a text field Left/Right stay with the
 * caret and Up/Down leave the field (a search box must never be a dead
 * end). A key a component already handled (`defaultPrevented`, e.g. the
 * open server menu) is left alone.
 */

const DIRECTIONS = {
  ArrowUp: { primary: "y", sign: -1 },
  ArrowDown: { primary: "y", sign: 1 },
  ArrowLeft: { primary: "x", sign: -1 },
  ArrowRight: { primary: "x", sign: 1 },
} as const;

type Direction = (typeof DIRECTIONS)[keyof typeof DIRECTIONS];

const CANDIDATES = "button:not([disabled]), a[href], input:not([disabled]), select, [tabindex]:not([tabindex='-1'])";
const MODAL = '[aria-modal="true"]';
const SCOPE = "[data-tv-scope]";
const ROW = "[data-tv-row]";

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
  // visibility: hidden (the collapsed "More sports" extras) still lays out
  // boxes, so client rects alone pass them: the picker must not walk focus
  // into rows the visitor cannot see. Computed visibility inherits, so the
  // check on the element itself covers hidden ancestors too.
  if (getComputedStyle(element).visibility === "hidden") return false;
  // offsetParent is null for fixed-position elements, which is exactly what
  // the toolbar is - getClientRects is the rendered test that covers both.
  return element.getClientRects().length > 0;
};

/** Rendered and outside inert subtrees (which cannot take focus at all). */
const isLive = (element: HTMLElement) => isRendered(element) && element.closest("[inert]") === null;

const candidatesIn = (root: ParentNode): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(CANDIDATES)].filter(isLive);

const rendered = (selector: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(selector)].filter(isLive);

type Owner = { kind: "modal" | "scope"; root: HTMLElement } | null;

/** What owns the remote right now: the topmost modal, else the innermost scope. */
const currentOwner = (): Owner => {
  const modals = rendered(MODAL);
  const modal = modals[modals.length - 1];
  if (modal !== undefined) return { kind: "modal", root: modal };
  const scopes = rendered(SCOPE);
  const innermost = scopes.find((scope) => !scopes.some((other) => other !== scope && scope.contains(other)));
  return innermost === undefined ? null : { kind: "scope", root: innermost };
};

type Row = { element: HTMLElement; items: HTMLElement[] };

/** The scope's rows in DOM order, each with its live, non-skipped items. */
const rowsOf = (scope: HTMLElement): Row[] => {
  const elements = [scope, ...scope.querySelectorAll<HTMLElement>(ROW)].filter((element) => element.matches(ROW));
  return elements
    .map((element) => ({
      element,
      items: candidatesIn(element).filter(
        (item) => item.closest(ROW) === element && !item.hasAttribute("data-tv-skip"),
      ),
    }))
    .filter((row) => row.items.length > 0);
};

/** The last item focused in each row, so returning to a row restores it. */
const lastInRow = new WeakMap<HTMLElement, HTMLElement>();

const moveFocus = (target: HTMLElement) => {
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
};

/**
 * The control a remote scope offers first: an explicit `data-tv-default`,
 * else the first item of the first row. Exported for screens that must put
 * the highlight back (arrival, remounts, a stolen focus).
 */
export const tvDefaultTarget = (): HTMLElement | null => {
  const owner = currentOwner();
  if (owner === null) return null;
  const explicit = candidatesIn(owner.root).find((element) => element.hasAttribute("data-tv-default"));
  if (explicit !== undefined) return explicit;
  if (owner.kind === "scope") return rowsOf(owner.root)[0]?.items[0] ?? null;
  return candidatesIn(owner.root)[0] ?? null;
};

/** Whether focus currently sits on a live control the remote owner can reach. */
export const tvFocusIsHome = (): boolean => {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body || !isLive(active)) return false;
  if (active.tagName === "IFRAME") return false;
  const owner = currentOwner();
  return owner === null || owner.root.contains(active);
};

/**
 * Put the highlight back on `preferred` when the remote can still reach it,
 * else on the owner's default control. Returns whether anything took focus.
 */
export const focusTvHome = (preferred: HTMLElement | null = null): boolean => {
  const owner = currentOwner();
  const reachable =
    preferred !== null && preferred.isConnected && isLive(preferred) && (owner === null || owner.root.contains(preferred));
  const target = reachable ? preferred : tvDefaultTarget();
  if (target === null) return false;
  target.focus({ preventScroll: true });
  return true;
};

const focusRow = (direction: Direction, scope: HTMLElement, active: HTMLElement | null): boolean => {
  const rows = rowsOf(scope);
  const current = active === null ? -1 : rows.findIndex((row) => row.items.includes(active));
  if (active === null || current === -1) {
    const fallback = tvDefaultTarget();
    if (fallback === null) return false;
    moveFocus(fallback);
    return true;
  }
  const row = rows[current];
  if (row === undefined) return false;
  if (direction.primary === "x") {
    const ordered = [...row.items].sort(
      (a, b) => centerOf(a.getBoundingClientRect()).x - centerOf(b.getBoundingClientRect()).x,
    );
    const next = ordered[ordered.indexOf(active) + direction.sign];
    // The row's ends are walls: the key is still consumed, so the page
    // underneath never scrolls instead.
    if (next !== undefined) moveFocus(next);
    return true;
  }
  const target = rows[current + direction.sign];
  if (target === undefined) return true;
  const remembered = lastInRow.get(target.element);
  if (remembered !== undefined && target.items.includes(remembered)) {
    moveFocus(remembered);
    return true;
  }
  const anchorX = centerOf(active.getBoundingClientRect()).x;
  const nearest = target.items.reduce((best, item) =>
    Math.abs(centerOf(item.getBoundingClientRect()).x - anchorX) <
    Math.abs(centerOf(best.getBoundingClientRect()).x - anchorX)
      ? item
      : best,
  );
  moveFocus(nearest);
  return true;
};

/**
 * Focus the nearest candidate in the pressed direction among `candidates`.
 * Returns whether a target was found (and the keypress therefore consumed).
 */
const focusNearest = (direction: Direction, candidates: readonly HTMLElement[], active: HTMLElement | null): boolean => {
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

  for (const element of candidates) {
    if (element === active) continue;
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
  moveFocus(best);
  return true;
};

const navigateFrom = (direction: Direction): boolean => {
  const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement
    : null;
  const owner = currentOwner();
  if (owner === null) return focusNearest(direction, candidatesIn(document), active);
  const inside = active !== null && owner.root.contains(active) ? active : null;
  if (owner.kind === "scope" && rowsOf(owner.root).length > 0) return focusRow(direction, owner.root, inside);
  if (inside === null) {
    const fallback = tvDefaultTarget();
    if (fallback === null) return false;
    moveFocus(fallback);
    return true;
  }
  return focusNearest(direction, candidatesIn(owner.root), inside);
};

/** Activates D-pad navigation for as long as the calling layer is mounted. */
export const useTvNavigation = (enabled = true) => {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = DIRECTIONS[event.key as keyof typeof DIRECTIONS];
      if (direction === undefined) return;
      if (event.defaultPrevented) return;
      // Modifier combos belong to the browser (and nobody on a remote
      // presses them).
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (typing && direction.primary === "x") return;
      // Inside iframes (the stream embed) the keys belong to the source's
      // own player controls, not to our navigation.
      if (target instanceof HTMLElement && target.tagName === "IFRAME") return;
      if (!navigateFrom(direction)) return;
      // Focus moved: swallow the key so the page does not also scroll
      // underneath the move.
      event.preventDefault();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      const row = event.target.closest<HTMLElement>(ROW);
      if (row !== null) lastInRow.set(row, event.target);
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [enabled]);
};

/**
 * The remote's Back. Escape on keyboards; TV apps that forward Back as a key
 * send one of the browser-navigation keys instead (Android WebView maps
 * KEYCODE_BACK to `GoBack` where it forwards it at all).
 */
export const isBackKey = (event: KeyboardEvent): boolean =>
  event.key === "Escape" || event.key === "GoBack" || event.key === "BrowserBack";
