/**
 * Client for the redirect resolver (see the plugin in vite.config.ts).
 *
 * Why a resolver exists at all: browsers deliberately hide cross-origin
 * redirect chains from page JavaScript. Performance Navigation zeroes
 * redirectCount/redirectStart/redirectEnd when the chain crosses origins
 * (verified live on 2026-10-16: a 301 hop from
 * the previous generation reports redirectCount 0), a cross-origin fetch of the old
 * domain is either CORS-blocked or returns an opaque response whose url is
 * empty, and an iframe's final location is unreadable across origins. So the
 * hop chain is walked outside the browser and exposed same-origin at
 * /api/resolve-redirect. In dev that endpoint is the Vite middleware; in
 * production it has to be a real endpoint (server route or function)
 * returning the same shape.
 */

export type RedirectHop = {
  /** URL requested at this hop. */
  url: string;
  /** HTTP status the server answered with (301, 200, ...). */
  status: number;
  /** Absolute Location header, or null when the chain ended here. */
  location: string | null;
};

export type RedirectResolution = {
  /** The URL passed in, echoed back. */
  input: string;
  /** Every hop in order, including the final non-redirecting response. */
  hops: RedirectHop[];
  /** Where the chain actually lands. */
  finalUrl: string;
  /** True when at least one redirect hop happened. */
  redirected: boolean;
};

/** Resolves a URL's server-side redirect chain. Throws on invalid input. */
export const resolveRedirect = async (url: string): Promise<RedirectResolution> => {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs can be resolved.");
  }

  const response = await fetch(`/api/resolve-redirect?url=${encodeURIComponent(url)}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Redirect resolver returned ${response.status}.`);
  }
  return (await response.json()) as RedirectResolution;
};
