import { useSyncExternalStore } from "react";

/**
 * Whether the viewer asked to sign in (the Sign in button). The alerts
 * bell is separate: it has its own flag, and the gate treats either ask
 * as a reason to show the modal while signed out.
 */
let open = false;
const listeners = new Set<() => void>();

const set = (next: boolean) => {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
};

export const openSignIn = () => set(true);
export const closeSignIn = () => set(false);

export const useSignInRequested = (): boolean =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
  );
