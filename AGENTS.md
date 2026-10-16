# Scoreline - agent guide

A local React mirror-client for a pirate sports-streaming network (Indonesian-facing; the network family is deliberately unnamed in this repo).
The app mirrors their match listings from the protobuf feed and embeds their actual video streams.
There is no backend - only Vite dev-server middleware - and every domain the source network uses is a time bomb that rotates as it gets blocked.
This guide is written for an agent with an empty context window: read it top to bottom before touching the streaming pipeline.

- Stack: Vite + React 19 + TypeScript + `motion`. No test suite; `npm run typecheck` is the gate.
- Dev server: `npm run dev`, port 5188, strict - if the port is taken, find and kill the stale process rather than changing the port (the probe middleware derives its Referer from it, see below).
- Working agreement: never commit or push unless the user explicitly says so in that message.

## The one rule that outranks everything else

Every fact about the source network below was **verified live on a specific date**, and the operator rotates domains, ciphers, and keys without notice.
Before diagnosing anything, re-verify the specific fact you are about to rely on, using the playbook commands in this file.
A fact that was true last month is a hypothesis, not a fact.
When you verify something new, update the dated facts in this file so the next agent inherits the truth, and keep raw investigation notes in `.scratch/` (gitignored) instead of bloating this file.

## The source network map

Three host families, each rotating independently.

| Family | What it serves | Discovered from | Resolver |
|---|---|---|---|
| Entry hosts | The full site: match pages, deep links, client-side handoff to the live mirror and player | Candidate lists served by `/api/config` from `.env`, plus 301 walks from old-generation hosts | `resolveEntryOrigin` in `src/api/source-sites.ts` |
| Data hosts | The protobuf feed (`/sfver%3Ctoken%3E/api/match/live?...`) and the params API (`/api/common/params`) | An inline config block on the entry page (slashes escaped as `\u002F`) | `resolveApiHosts` in `src/api/source-sites.ts` |
| Player hosts | The bare player page (`/{lang}/player.html?mdata={base64}&ilang={lang}`) - the whole stream, no ads | The params API's `iframePlayerDomains` lists, unioned from anywhere in its tree | `resolvePlayerHosts` in `src/api/source-sites.ts` |

The hosts themselves live only in the gitignored `.env` (`SCORELINE_ENTRY_HOSTS`, `SCORELINE_REDIRECTING_ENTRY_HOSTS`, `SCORELINE_API_HOSTS`, `SCORELINE_PLAYER_HOSTS`; copy `.env.example`). They are served to the app through the `/api/config` dev middleware and are never compiled into the client bundle or named anywhere in the repo.

The chain is: entry origin → api hosts → params → player hosts.
Each stage is cached in localStorage (10-minute TTL, keys `scoreline:entry-origin`, `scoreline:api-hosts`, `scoreline:player-hosts`), falls back to the stale cache, and finally to compiled-in defaults verified on the date in this file.
No host list is ever compiled into the client; the env-seeded defaults are last-resort only - discovery is the real path.

## The direct player contract

The watch screen (`src/screens/StreamScreen.tsx`) has two embed modes.

- **"player" (default)**: embeds the bare player page directly - no banner ads, full frame.
  The URL is built in `src/api/player.ts`: `mdata` is just the base64 of `{matchId}_{sportType}`, constructible straight from the feed's own match data.
- **"page" (fallback)**: embeds their full match page, which still hands itself off to the live mirror and player client-side, whatever they change.

The player gate changed shape during 2026-10-16 (morning -> afternoon).
By afternoon the page's own JS checks `document.referrer`'s domain against the params API's `playSiteDomains` allowlist (the operator's mirror fronts; `localhost` is in the list, so dev sees the clean player) and renders a code-100/icode-201 error stub for foreign embedders; a referer-less load gets 403 from their edge WAF.
The HTML answers 200 to a server-side fetch from any origin, so the probe pipeline cannot see this refusal - the direct player only works from allowlisted origins, and production embeds default to the "page" mode (its nested player carries their own domain as Referer and passes).
An expired/unknown mdata shows the same stub family client-side - a garbage mdata still answers 200 (verified twice).

## The probe pipeline (how the app adapts on change)

The load event of a cross-origin iframe cannot tell a healthy player from a 401 text page - both fire `onLoad`.
So the watch screen never mounts the direct player blind.

1. `pickPlayerUrl` (`src/api/player.ts`) probes each listed host's exact embed URL, in epoch-rotated order.
2. Each probe goes through `/api/probe-player?url=...`, which fetches the URL server-side with the app's own Referer plus real iframe `Sec-Fetch` metadata - exactly what the browser's iframe navigation will send. One implementation lives in `server/endpoints.ts`, served by the Vite middleware in dev and by the thin Vercel Edge functions in `api/` in production.
3. The first host that answers 2xx is the one mounted; a 401/403 means refused, anything else means unreachable.
4. If every host refuses or none answers, the screen auto-falls back to the "page" embed with a notice, instead of showing a blank frame that claims to be healthy.
5. If the middleware is absent (a static production build), the client classifies probes as "unknown" and embeds the first candidate as before - absence of evidence is not failure, and the load watchdog (`EMBED_LOAD_TIMEOUT_MS`, 15s) still judges the mounted frame: first stall re-resolves everything fresh and remounts once, second stall shows the retry notice.
6. Any remount (watchdog, mode switch, retry) bumps an epoch, which re-runs the probe with the freshly resolved host list; the candidate order rotates with the epoch so a dead host is not retried first forever.

The probe client contract lives in `src/api/probe.ts`: 200-with-status is definitive, 502 means the transport failed (host unreachable from this machine), 404 means no middleware deployed, anything else is "unknown".
Only definitive signals are acted on.

## The params cipher

The params API answers operator config as JSON, scrambled with a printable-ASCII rotation: code points 33..126 rotate by a shift inside the 94-wide window, everything else passes through.
The shift was 47 when verified (2026-10-16), but the decoder does not trust it: `decodePlayerHosts` in `src/api/source-sites.ts` tries shift 47, then 0 (plain JSON), then all 94 shifts, and accepts the first shift that both parses as JSON and yields at least one player host.
A wrong shift scrambles the JSON's structural characters too, so a false positive is vanishingly unlikely and harmless anyway (it would find nothing and the next shift would be tried).
The player-host key match is also naming-tolerant: `/iframe[_-]?player[_-]?domains/i`.
If discovery suddenly returns only the compiled-in defaults, the cipher or the key name drifted - see the playbook below.

A bare curl to the params API with no Referer or Sec-Fetch headers gets an HTML bot stub, not JSON.
A normal browser fetch always carries both, so the app needs no spoofing - but a debugging curl does (see playbook).

## Failure catalog: symptom → cause → navigation

When "the stream is broken", identify the symptom first, then follow its row.
Run the playbook commands under "Live diagnosis" before changing any code.

| Symptom | Likely cause | Navigate |
|---|---|---|
| Match list empty / feed errors | Data hosts rotated, or the entry-page config block changed shape | Check `localStorage['scoreline:api-hosts']`; curl the entry page and grep it for `apis-data` URLs (unescaped first); if the host family renamed, update the regex in `resolveApiHosts` after verifying which host actually serves the protobuf feed now |
| Direct player falls back to page embed with "refused" notice | The gate tightened (Referer/Sec-Fetch mix changed) or the mdata shape changed in a detectable way | Reproduce the gate with the curl below; if 401 comes back with a Referer, compare against what their own match page constructs for its player iframe (Page mode works because it uses their code) |
| Direct player falls back with "no host answered" notice | Player hosts rotated faster than the 10-minute cache, or all dead | Clear `scoreline:player-hosts`, reload, check the params API still lists hosts; the notice self-clears in 6s and retry re-probes |
| Player embed mounts but no video boots | mdata shape changed - **undetectable from outside**: a garbage mdata still answers 200 because their player parses it client-side | This is the one failure no probe can see. Verify by switching to Page mode: if their own page still plays, the mdata construction in `playerUrl` needs re-reverse-engineering from their current player.js |
| Everything redirects / entry unreachable | Generation burn: old hosts 301 to a new generation without CORS headers | The 301 chains are only walkable server-side (`/api/resolve-redirect`, dev middleware). Find the new entry host by hand (their socials/redirect targets), verify it serves `/id` with 200 + ACAO, then add it to `DIRECT_ENTRY_HOSTS` |
| Watchdog loops: "reconnecting" then retry notice | Whole network down from this machine, or mid-rotation while you watch | Check basic reachability first (curl an entry host). If truly down, wait - the feed reloads every 60s and retry re-resolves everything |
| Player hosts resolve but stale / wrong | Cache poisoning or the params union scan picked up junk | Hosts are unioned from any `iframePlayerDomains` key anywhere in the params tree; inspect the decoded params (see playbook) for a renamed/moved list |

After any fix, run `npm run typecheck`, then re-verify the whole chain live end to end (open a live match, press play, confirm the iframe src and the "Live player" flag).
Synthetic clicks cannot start the actual video - browsers require user activation - so "video did not autoplay" is not a bug; verifying means the player chrome renders and no ads appear.

## Live diagnosis playbook

All commands verified working 2026-10-16.
Replace the ids with a match that is actually live at the time - grab one from the feed or the app's match list.

### The gate, reproduced server-side

```bash
# PLAYER: any host from SCORELINE_PLAYER_HOSTS in .env (-f2-: values contain = in the scheme)
PLAYER="$(grep '^SCORELINE_PLAYER_HOSTS=' .env | cut -d= -f2- | cut -d, -f1)/id/player.html"
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
# With Referer + iframe metadata: expect 200 text/html
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' "$PLAYER?mdata=$(printf '4513837_1' | base64)&ilang=id" \
  -H "User-Agent: $UA" -H 'Referer: http://localhost:5188/' \
  -H 'Sec-Fetch-Dest: iframe' -H 'Sec-Fetch-Mode: navigate' -H 'Sec-Fetch-Site: cross-site' -H 'Accept: text/html'
# Same without Referer: expect 401 (this is the gate)
```

If the first command stops returning 200, the gate moved - that is the signal to re-derive what their player page now requires.

### The probe middleware, directly

```bash
curl -sS -G 'http://localhost:5188/api/probe-player' \
  --data-urlencode "url=$PLAYER?mdata=NDUxMzgzN18x&ilang=id"
# Expect {"url":...,"status":200,"ok":true}; a dead host returns 502 with a message
```

### The params API (cipher and key drift)

Fetch it from the browser console (a curl without browser-ish headers gets an HTML bot stub):

```js
// API_HOST: any host from SCORELINE_API_HOSTS in .env
fetch(`https://${API_HOST}/api/common/params`, { cache: "no-store" })
  .then(r => r.text())
  .then(t => console.log(t.slice(0, 400))) // scrambled JSON: expect ]C3EGA=FD-ish garbage that decodes at shift 47
```

Then check the decoded tree still contains an `iframePlayerDomains`-shaped key: paste the response through the app's own decoder from the dev console, or eyeball the shift-47 decode in any REPL.
If no shift yields player hosts, re-reverse-engineer: pull their match page HTML in a browser, find where its JS gets the player host, and follow that endpoint instead.

### The entry page (api-host discovery)

```bash
curl -sS "$(grep '^SCORELINE_ENTRY_HOSTS=' .env | cut -d= -f2- | cut -d, -f1)/id" | grep -o 'https:\\u002F\\u002Fapis-data[a-z0-9.-]*' | head
# After unescaping \u002F -> /, these are the feed hosts the entry page itself ships
```

### What the app currently believes

In the app tab's console:

```js
JSON.parse(localStorage.getItem('scoreline:player-hosts'))
JSON.parse(localStorage.getItem('scoreline:api-hosts'))
JSON.parse(localStorage.getItem('scoreline:entry-origin'))
```

Each entry is `{at: <epoch ms>, value: ...}`; `at` older than 10 minutes means the cache is stale (served, but re-resolved in the background).

## Dated verified facts

The full log of what was true when; re-verify before relying on any of it.

- 2026-10-16: the host lists (5 direct entry hosts, 4 redirecting old-generation hosts, 2 data hosts, 3 player hosts) moved into `.env`; this file no longer names any of them.
- 2026-10-16: old-generation entry hosts 301 to the current generation without ACAO - only walkable server-side.
- 2026-10-16: feed path `/sfver%3Ctoken%3E/api/match/live` - the token placeholder is ignored by the backend, only the host moves.
- 2026-10-16: params cipher shift 47, key `iframePlayerDomains` under brand-digit keys (`snd`, `trd`, `foth`, ...), sometimes nested one level deep as JSON strings.
- 2026-10-16 (morning): player gate Referer-based (401 without Referer, 200 with any Referer); no X-Frame-Options, no frame-ancestors.
- 2026-10-16 (afternoon): the gate moved into their player JS - `document.referrer` domain must be in the params `playSiteDomains` list (localhost included), referer-less loads get 403 from the edge; production embeds default to page mode. Params also expose `playSiteDomainsToB` (blocked list) and `blackDomains`.
- 2026-10-16: mdata = base64 of `{matchId}_{sportType}` - verified for football `4513837_1` and basketball `2244615_2`.
- 2026-10-16: a garbage mdata still answers 200 (player parses it client-side) - mdata drift is externally undetectable.
- 2026-10-16: feed sport ids: 1 football, 2 basketball, 3 tennis, 4 baseball, 6 cricket, 7 Motorsport, 8 rugby, 9 american football, 10 aussie rules, 11 ice hockey (+ curling), 12 badminton, 13 volleyball, 14 combat sports, 15 Cycling, 16 handball, 90 horse racing.

## Environment quirks that look like bugs but are not

- Video start requires a real user click: synthetic (CDP) clicks lack user activation, so automated verification ends at "player chrome renders, no ads".
- The three endpoints (`/api/config`, `/api/probe-player`, `/api/resolve-redirect`) are Vite middlewares in dev and Vercel Edge functions in production, both delegating to `server/endpoints.ts`. The Vercel project must have the `SCORELINE_*` env vars set in its settings; without them the app runs discovery-only, and a cold visitor with empty caches sees an empty feed.
- Screenshots taken right after navigation race lazy image loads and look like placeholders; wait a beat before judging the UI.
- The watch screen's overlay view-state can flap while the feed refreshes under it; re-snapshot before concluding a UI bug.
- The feed only covers a window around kick-off; a deep link to an old match legitimately shows "Stream unavailable".
