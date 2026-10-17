import { useConvexAuth } from "convex/react";
import { lazy, Suspense, useEffect, useRef } from "react";

const SignInModal = lazy(() => import("./SignInModal"));

/**
 * The hard gate. A signed-out visitor sees the screen they opened, dimmed
 * under a black scrim, with the sign-in modal on top; a successful sign-in
 * simply lifts the gate, so a deep link lands on the screen it opened.
 * Nothing here blurs: the frame-wide no-blur rule (base.css) stands.
 *
 * The page behind is made inert instead of unmounted, so it stays visible
 * but can neither be clicked nor tabbed into. This is a front-end gate for
 * accounts and alerts, not protection for the feed.
 */
export const AuthGate = () => {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const up = !isLoading && !isAuthenticated;
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
        <SignInModal />
      </Suspense>
    </div>
  );
};
