import { useConvexAuth } from "convex/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

const SignInModal = lazy(() => import("./SignInModal"));

/**
 * Sign-in over the screen the visitor opened. Browse can be postponed for
 * this session (Later). The watch screen cannot: it stays covered until
 * they sign in, and the only way off it is Back to home. A successful
 * sign-in lifts the gate either way, so a deep link lands on the watch
 * screen it opened. Nothing here blurs: the frame-wide no-blur rule
 * (base.css) stands.
 *
 * The page behind is made inert instead of unmounted, so it stays visible
 * but can neither be clicked nor tabbed into. This is a front-end gate for
 * accounts and alerts, not protection for the feed.
 */
export const AuthGate = ({ hard, onLeave }: { hard: boolean; onLeave: () => void }) => {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const [postponed, setPostponed] = useState(false);
  const up = !isLoading && !isAuthenticated && (hard || !postponed);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const gate = ref.current;
    if (!up || gate === null) return;
    const behind = [...(gate.parentElement?.children ?? [])].filter(
      (element): element is HTMLElement => element !== gate && element instanceof HTMLElement && !element.inert,
    );
    for (const element of behind) element.inert = true;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      for (const element of behind) element.inert = false;
      document.body.style.overflow = overflow;
    };
  }, [up]);

  if (!up) return null;
  return (
    <div ref={ref} className="gate">
      <div className="gate-scrim" aria-hidden />
      <Suspense fallback={null}>
        <SignInModal leaveLabel={hard ? "Back to home" : "Later"} onLeave={hard ? onLeave : () => setPostponed(true)} />
      </Suspense>
    </div>
  );
};
