import { useEffect, type RefObject } from "react";
import { TABLET_UP_QUERY, useMediaQuery } from "./useMediaQuery";

/**
 * After an upward scroll settles, if this downward trip actually left the
 * player and the shell is now at least 40% back inside the watch layer,
 * scroll the layer so the player's top edge sits at the top of the layer's
 * viewport. Phone widths stay as they are: the hook no-ops below the
 * existing 740px split, including a tablet rotating into portrait.
 *
 * "Left the player" means the shell was fully off-screen, or the layer was
 * scrolled to its end while the shell was already under 40% visible. The
 * full-bleed player is often taller than the content below it, so a trip
 * to the bottom never clears the shell entirely (about a quarter of it
 * remains on an 800px-tall layer). Requiring a fully hidden shell would
 * make the snap unreachable there. Nudges around the 40% line still do
 * not arm, because they neither clear the shell nor reach the end.
 *
 * `scrollend` is the settle signal (it waits out trackpad and wheel
 * momentum). Safari gained it in 18; older Safari and TV WebViews lack it,
 * and those fall back to 120ms after the last scroll event - momentum keeps
 * emitting scroll events, so the timer does not fire mid-flick.
 *
 * Reduced motion jumps instead of smoothing. Skipping the snap would leave
 * the player cut at the 40% line, which is the state this exists to finish;
 * an instant jump still completes it without the motion.
 *
 * The shell's top lands flush with the layer (`TOP_GAP` is 0). Checked live
 * at 1280x800: the header scrolls away and the picture meets the top edge.
 * The 16px corner radius cuts a small wedge of page background, which reads
 * as the shell's own shape rather than a cramped crop, so there is no inset.
 */

const TOP_GAP = 0;

const VISIBLE_ENOUGH = 0.4;
const SETTLE_MS = 120;

const intersectionRatio = (layer: HTMLElement, target: HTMLElement): number => {
  const layerRect = layer.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const width = Math.max(0, Math.min(layerRect.right, targetRect.right) - Math.max(layerRect.left, targetRect.left));
  const height = Math.max(0, Math.min(layerRect.bottom, targetRect.bottom) - Math.max(layerRect.top, targetRect.top));
  const area = targetRect.width * targetRect.height;
  if (area === 0) return 0;
  return (width * height) / area;
};

/**
 * True when snapping would carry the TV-focused control out of the layer.
 * D-pad moves call scrollIntoView; snapping on top of that would pull the
 * focused row back off screen and the next arrow would scroll it back.
 * The floating toolbar is position:fixed, so the layer's scroll does not
 * move it and it must not block the snap.
 */
const snapHidesTvFocus = (layer: HTMLElement, nextTop: number): boolean => {
  if (document.documentElement.dataset.tv !== "on") return false;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (!layer.contains(active)) return false;
  if (active.closest(".watch-toolbar, .watch-toolbar-lane") !== null) return false;
  const layerRect = layer.getBoundingClientRect();
  const rect = active.getBoundingClientRect();
  const shift = layer.scrollTop - nextTop;
  const top = rect.top + shift;
  const bottom = rect.bottom + shift;
  return bottom <= layerRect.top + 1 || top >= layerRect.bottom - 1;
};

export const usePlayerSnap = (
  layerRef: RefObject<HTMLElement | null> | null,
  targetRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void => {
  const wide = useMediaQuery(TABLET_UP_QUERY);
  const active = enabled && wide;

  useEffect(() => {
    if (!active || layerRef === null) return;
    const layer = layerRef.current;
    const target = targetRef.current;
    if (layer === null || target === null) return;

    // Feature-detect per element. `"onscrollend" in window` is true from
    // Safari 18; older WebViews keep the debounce path.
    const supportsScrollEnd = "onscrollend" in layer;

    let ratio = intersectionRatio(layer, target);
    let armed = false;
    let direction: "up" | "down" | null = null;
    let lastTop = layer.scrollTop;
    let programmatic = false;
    let settleTimer = 0;

    const shellTop = () => {
      const layerRect = layer.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      return targetRect.top - layerRect.top + layer.scrollTop - TOP_GAP;
    };

    const noteDeparture = (nextRatio: number) => {
      const maxTop = layer.scrollHeight - layer.clientHeight;
      const atEnd = layer.scrollTop >= maxTop - 2;
      if (nextRatio < 0.01 || (atEnd && nextRatio < VISIBLE_ENOUGH)) armed = true;
    };

    const consider = () => {
      if (programmatic) {
        programmatic = false;
        lastTop = layer.scrollTop;
        direction = null;
        return;
      }
      ratio = intersectionRatio(layer, target);
      noteDeparture(ratio);
      // Subpixel error keeps a fully-on-screen shell a hair under 1.
      if (ratio >= 0.995) armed = false;
      if (direction !== "up" || !armed) return;
      if (ratio >= 0.995 || ratio < VISIBLE_ENOUGH) return;
      const maxTop = Math.max(0, layer.scrollHeight - layer.clientHeight);
      const nextTop = Math.min(maxTop, Math.max(0, shellTop()));
      if (Math.abs(layer.scrollTop - nextTop) < 2) return;
      if (snapHidesTvFocus(layer, nextTop)) return;
      armed = false;
      direction = null;
      programmatic = true;
      const motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      layer.scrollTo({ top: nextTop, behavior: motion });
      // A jump, or a target we were already on, never schedules scrollend.
      // Leaving the flag set would swallow the next real gesture.
      if (motion === "auto" || Math.abs(layer.scrollTop - nextTop) < 1) {
        programmatic = false;
        lastTop = layer.scrollTop;
      }
    };

    const onScroll = () => {
      if (programmatic) {
        if (!supportsScrollEnd) {
          window.clearTimeout(settleTimer);
          settleTimer = window.setTimeout(consider, SETTLE_MS);
        }
        return;
      }
      const next = layer.scrollTop;
      const delta = next - lastTop;
      lastTop = next;
      if (delta > 0) {
        direction = "down";
        // Arm while direction is still down. The observer callback can
        // land a frame later, after an upward reversal has already
        // flipped direction.
        noteDeparture(intersectionRatio(layer, target));
      } else if (delta < 0) {
        direction = "up";
      }
      if (!supportsScrollEnd) {
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(consider, SETTLE_MS);
      }
    };

    const onScrollEnd = () => {
      window.clearTimeout(settleTimer);
      consider();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry === undefined) return;
        if (!entry.isIntersecting) armed = true;
      },
      { root: layer, threshold: [0, VISIBLE_ENOUGH, 1] },
    );
    observer.observe(target);

    layer.addEventListener("scroll", onScroll, { passive: true });
    if (supportsScrollEnd) layer.addEventListener("scrollend", onScrollEnd);

    return () => {
      window.clearTimeout(settleTimer);
      observer.disconnect();
      layer.removeEventListener("scroll", onScroll);
      if (supportsScrollEnd) layer.removeEventListener("scrollend", onScrollEnd);
      // Rotation under 740, or the shell maximizing, must drop a smooth
      // snap that is still in flight rather than finish it off-policy.
      if (programmatic) layer.scrollTo({ top: layer.scrollTop });
    };
  }, [active, layerRef, targetRef]);
};
