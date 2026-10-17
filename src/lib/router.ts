import { useCallback, useSyncExternalStore } from "react";
import { parseMatchRoute, type MatchRoute } from "./route";

/**
 * Everything the app can show, besides a match: the browse surfaces. The
 * match deep link keeps its own shape (see route.ts) because it mirrors the
 * source network's URLs; all other paths are this app's own.
 */
export type BrowseRoute =
  | { kind: "home" }
  | { kind: "live" }
  | { kind: "sport"; slug: string }
  | { kind: "leagues"; leagueId: string | null }
  | { kind: "tables"; code: string | null }
  | { kind: "search"; query: string }
  | { kind: "link"; code: string };

export type Route = BrowseRoute | { kind: "match"; match: MatchRoute; href: string };

/**
 * Per-entry navigation state kept in history.state so a back/forward
 * restores it. `origin` names the card the watch screen should morph out of
 * (its shared layoutId); `autoplay` says the user explicitly asked to watch,
 * so the embed may start without a second click.
 */
export type NavState = { idx: number; origin?: string; autoplay?: boolean };

export type Location = { path: string; search: string; state: NavState; route: Route };

export const parseRoute = (pathname: string, search: string): Route => {
  const match = parseMatchRoute(pathname);
  if (match !== null) return { kind: "match", match, href: pathname };
  const segments = pathname.split("/").filter(Boolean);
  const [head, tail] = segments;
  if (head === undefined) return { kind: "home" };
  if (head === "live") return { kind: "live" };
  if (head === "sport" && tail) return { kind: "sport", slug: decodeURIComponent(tail) };
  if (head === "leagues") return { kind: "leagues", leagueId: tail ? decodeURIComponent(tail) : null };
  if (head === "tables") return { kind: "tables", code: tail ? decodeURIComponent(tail) : null };
  if (head === "search") return { kind: "search", query: new URLSearchParams(search).get("q") ?? "" };
  if (head === "link") return { kind: "link", code: new URLSearchParams(search).get("code") ?? "" };
  return { kind: "home" };
};

export const browsePath = (route: BrowseRoute): string => {
  switch (route.kind) {
    case "home":
      return "/";
    case "live":
      return "/live";
    case "sport":
      return `/sport/${encodeURIComponent(route.slug)}`;
    case "leagues":
      return route.leagueId === null ? "/leagues" : `/leagues/${encodeURIComponent(route.leagueId)}`;
    case "tables":
      return route.code === null ? "/tables" : `/tables/${encodeURIComponent(route.code)}`;
    case "search":
      return route.query ? `/search?q=${encodeURIComponent(route.query)}` : "/search";
    case "link":
      return route.code ? `/link?code=${encodeURIComponent(route.code)}` : "/link";
  }
};

// ---------- store ----------

const listeners = new Set<() => void>();
/** Window scroll per history index, so going back lands where the user left. */
const scrollByIdx = new Map<number, number>();

const readState = (): NavState => {
  const raw = window.history.state as Partial<NavState> | null;
  return { idx: raw?.idx ?? 0, origin: raw?.origin, autoplay: raw?.autoplay };
};

const read = (): Location => ({
  path: window.location.pathname,
  search: window.location.search,
  state: readState(),
  route: parseRoute(window.location.pathname, window.location.search),
});

let snapshot: Location = read();

// The first entry needs an index too, otherwise the first back() cannot
// tell whether it is leaving the app.
if ((window.history.state as Partial<NavState> | null)?.idx === undefined) {
  window.history.replaceState({ idx: 0 } satisfies NavState, "", window.location.href);
  snapshot = read();
}

const emit = () => {
  snapshot = read();
  for (const listener of listeners) listener();
};

window.addEventListener("popstate", () => {
  emit();
  // Browser-driven moves restore the scroll the app saved for that entry.
  const saved = scrollByIdx.get(snapshot.state.idx);
  requestAnimationFrame(() => window.scrollTo({ top: saved ?? 0 }));
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export type NavigateOptions = { replace?: boolean; origin?: string; autoplay?: boolean; keepScroll?: boolean };

export const navigate = (to: string, options: NavigateOptions = {}): void => {
  const current = readState();
  const url = new URL(to, window.location.origin);
  if (url.pathname + url.search === snapshot.path + snapshot.search && !options.replace) return;
  scrollByIdx.set(current.idx, window.scrollY);
  const next: NavState = {
    idx: options.replace ? current.idx : current.idx + 1,
    origin: options.origin,
    autoplay: options.autoplay,
  };
  if (options.replace) window.history.replaceState(next, "", url);
  else window.history.pushState(next, "", url);
  if (!options.keepScroll) window.scrollTo({ top: 0 });
  emit();
};

/**
 * Goes back through the app's own history when there is some, otherwise to
 * the fallback path: a deep-linked first visit must not pop out to a blank
 * tab or the previous site.
 */
export const back = (fallback = "/"): void => {
  if (readState().idx > 0) window.history.back();
  else navigate(fallback, { replace: true });
};

export const useLocation = (): Location => useSyncExternalStore(subscribe, () => snapshot);

export const useNavigate = () => useCallback(navigate, []);
