import { motion, useDragControls, useMotionValue, useTransform, type PanInfo } from "motion/react";
import type { ReactNode } from "react";
import { useTvNavigation } from "../lib/tvnav";

/**
 * The watch screen's container. It floats above the browse surface so
 * going back is instant - the page underneath is still there, scroll and
 * all - and so the player can morph out of the card that opened it.
 *
 * Desktop: the backdrop fades in while the shared-element shell travels;
 * nothing else slides. Phone: an iOS push - the layer slides in from the
 * right, and a swipe from the left edge drags it back out, tracking the
 * finger 1:1 and finishing on a velocity-aware spring. The edge, not the
 * whole surface, starts the drag so horizontal shelves and the embed keep
 * their own gestures. The scrim behind derives from the same x, so it is
 * always exactly as faded as the layer is dismissed, mid-gesture included.
 */
export const WatchLayer = ({ phone, onDismiss, children }: { phone: boolean; onDismiss: () => void; children: ReactNode }) => {
  // The watch layer is where a remote replaces the mouse: arrow keys carry
  // a D-pad, so geometric focus navigation lives exactly here and nowhere
  // else (see lib/tvnav.ts). Hook order still rules - it is called before
  // the phone branch returns.
  useTvNavigation();

  const controls = useDragControls();
  const x = useMotionValue(0);
  const width = typeof window === "undefined" ? 480 : window.innerWidth;
  const scrimOpacity = useTransform(x, [0, width], [0.55, 0]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > 110 || info.velocity.x > 550) onDismiss();
  };

  if (phone)
    return (
      <>
        <motion.div className="watch-scrim" style={{ opacity: scrimOpacity }} aria-hidden />
        <motion.div
          className="watch-layer watch-layer-phone"
          style={{ x }}
          initial={{ x: width }}
          animate={{ x: 0 }}
          exit={{ x: width }}
          transition={{ type: "spring", bounce: 0, duration: 0.45 }}
          drag="x"
          dragListener={false}
          dragControls={controls}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={{ left: 0, right: 1 }}
          dragMomentum={false}
          onDragEnd={onDragEnd}
        >
          <div className="watch-edge" onPointerDown={(event) => controls.start(event)} aria-hidden />
          {children}
        </motion.div>
      </>
    );

  return (
    <div className="watch-layer">
      <motion.div
        className="watch-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.16 } }}
        transition={{ duration: 0.28 }}
        aria-hidden
      />
      {children}
    </div>
  );
};
