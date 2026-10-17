import { useSyncExternalStore } from "react";

/**
 * Whether the viewer asked for the alerts picker (the bell, or the mail's
 * "Manage alerts" link). The first-sign-in prompt is separate: it is derived
 * from the account itself and needs no flag (see AlertsHost).
 */
let open = false;
const listeners = new Set<() => void>();

const set = (next: boolean) => {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
};

export const openAlerts = () => set(true);
export const closeAlerts = () => set(false);

export const useAlertsRequested = (): boolean =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
  );
