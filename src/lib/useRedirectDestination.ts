import { resolveRedirect, type RedirectResolution } from "../api/redirect";
import { useAsync, type AsyncState } from "./useAsync";

/**
 * Resolves where `url` finally lands after any server-side redirects - for
 * example the operator's generation rotation (one host generation rotating to the next,
 * observed 2026-10-16 as a path-preserving Cloudflare 301). The chain itself
 * is invisible to page JS cross-origin, so this goes through the dev-server
 * resolver; the hook just consumes its hop list.
 *
 * Re-resolves when `url` changes; no auto-refresh (mirrors rotate slowly and
 * each resolution costs real outbound requests).
 */
export const useRedirectDestination = (
  url: string,
): { state: AsyncState<RedirectResolution>; reload: () => void } =>
  useAsync(url, () => resolveRedirect(url));
