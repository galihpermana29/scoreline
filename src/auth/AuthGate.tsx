import { useConvexAuth } from "convex/react";
import { lazy, Suspense, useEffect, useRef } from "react";
import { closeAlerts, useAlertsRequested } from "../alerts/alertsUi";
import { closeSignIn, useSignInRequested } from "./signInUi";

const SignInModal = lazy(() => import("./SignInModal"));

/**
 * Sign-in only when the visitor asks. Every screen, including a watch
 * URL, works for a guest. The Sign in button and the alerts bell (alerts
 * belong to an account) are what raise this modal. Not now dismisses it
 * and leaves them on the screen they already opened. A successful sign-in
 * lifts it, so a deep link stays on the watch screen it opened. Nothing
 * here blurs: the frame-wide no-blur rule (base.css) stands.
 *
 * The page behind is made inert instead of unmounted, so it stays visible
 * but can neither be clicked nor tabbed into while the modal is up. This
 * is a front-end prompt for accounts and alerts, not protection for the feed.
 */
export const AuthGate = () => {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const alertsRequested = useAlertsRequested();
  const signInRequested = useSignInRequested();
  const up = !isLoading && !isAuthenticated && (signInRequested || alertsRequested);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAuthenticated) closeSignIn();
  }, [isAuthenticated]);

  const leave = () => {
    closeSignIn();
    closeAlerts();
  };

  useEffect(() => {
    const gate = ref.current;
    if (!up || gate === null) return;
    const behind = [...(gate.parentElement?.children ?? [])].filter(
      (element): element is HTMLElement => element !== gate && element instanceof HTMLElement && !element.inert,
    );
    for (const element of behind) element.inert = true;
    document.body.classList.add("scoreline-auth-lock");
    return () => {
      for (const element of behind) element.inert = false;
      document.body.classList.remove("scoreline-auth-lock");
    };
  }, [up]);

  if (!up) return null;
  return (
    <div ref={ref} className="gate">
      <div className="gate-scrim" aria-hidden />
      <Suspense fallback={null}>
        <SignInModal leaveLabel="Not now" onLeave={leave} />
      </Suspense>
    </div>
  );
};
