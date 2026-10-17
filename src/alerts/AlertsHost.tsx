import { useConvexAuth, useQuery } from "convex/react";
import { AnimatePresence } from "motion/react";
import { lazy, Suspense, useEffect } from "react";
import { api } from "../../convex/_generated/api";
import { navigate, useLocation } from "../lib/router";
import { closeAlerts, openAlerts, useAlertsRequested } from "./alertsUi";

// The picker is a lazy chunk: nobody pays for it until it first opens.
const AlertPicker = lazy(() => import("./AlertPicker"));

/**
 * Decides when the alerts picker is up:
 * - right after an account's very first sign-in (it has never been prompted),
 *   deferred while the viewer is on a watch screen so it never covers a stream;
 * - when the viewer asks (the bell, or the mail's `/?alerts=1` link).
 */
export const AlertsHost = ({ watching }: { watching: boolean }) => {
  const { isAuthenticated } = useConvexAuth();
  const mine = useQuery(api.alerts.mine, isAuthenticated ? {} : "skip");
  const requested = useAlertsRequested();
  const location = useLocation();

  // `/?alerts=1` opens the picker once, then the param is dropped so a reload does not reopen it.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("alerts") !== "1") return;
    params.delete("alerts");
    openAlerts();
    const rest = params.toString();
    navigate(location.path + (rest ? `?${rest}` : ""), { replace: true, keepScroll: true });
  }, [location.path, location.search]);

  const first = isAuthenticated && mine != null && !mine.prompted && !watching;
  const open = isAuthenticated && mine != null && (first || requested);

  return (
    <AnimatePresence>
      {open ? (
        <Suspense key="picker" fallback={null}>
          <AlertPicker key="picker" mode={mine.prompted ? "manage" : "first"} initial={mine} onClose={closeAlerts} />
        </Suspense>
      ) : null}
    </AnimatePresence>
  );
};
