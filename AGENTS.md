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
The HTML answers 200 to a server-side fetch from any origin, so the probe pipeline cannot see this refusal - the direct player only works from allowlisted origins. The app reads `playSiteDomains` from the same params decode as the player hosts (cache key `scoreline:play-site-domains`) and hides the direct-player toggle when its own hostname is not allowlisted; production embeds default to the "page" mode (its nested player carries their own domain as Referer and passes).
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
| Everything redirects / entry unreachable | Generation burn: old hosts 301 to a new generation without CORS headers | The 301 chains are only walkable server-side (`/api/resolve-redirect`, dev middleware). Find the new entry host by hand (their socials/redirect targets), verify it serves `/id` with 200 + ACAO, then add it to `SCORELINE_ENTRY_HOSTS` in `.env` |
| Watchdog loops: "reconnecting" then retry notice | Whole network down from this machine, or mid-rotation while you watch | Check basic reachability first (curl an entry host). If truly down, wait - the feed reloads every 60s and retry re-resolves everything |
| Player hosts resolve but stale / wrong | Cache poisoning or the params union scan picked up junk | Hosts are unioned from any `iframePlayerDomains` key anywhere in the params tree; inspect the decoded params (see playbook) for a renamed/moved list |

After any fix, run `npm run typecheck`, then re-verify the whole chain live end to end (open a live match, press play, confirm the iframe src and the "Live player" flag).
Synthetic clicks cannot start the actual video - browsers require user activation - so "video did not autoplay" is not a bug; verifying means the player chrome renders and no ads appear.

## The escalation ladder (planned response if the embeds get shut out)

The player gate moved twice within a single day (2026-10-16), so this section pre-plans the response instead of leaving the next agent to improvise.
Climb one rung only when the rung below is provably dead, and always with live evidence first (open their real page in a browser, read what their JS now requires).

**Rung 0 - already self-healing, never code against it:**
host rotation, cipher shifts, key renames, dead player hosts, and allowlist changes.
The resolver chain, the all-shift decoder, the naming-tolerant matchers, the probe pipeline and the watchdog absorb all of these without code changes.
The direct-player toggle already reacts to `playSiteDomains` on its own: it reappears if the operator ever loosens the allowlist and stays hidden when they tighten it.

**Rung 1 - the current production embed ("page" mode) and why it holds:**
the full match page runs the source's own code for the player handoff, so breaking it means breaking their own site.
Frame-busting already fails against it: the watch screen's iframe sandbox withholds top-navigation, so their own `top.location = self` code silently throws and the frame stays put.
What *would* break it: `X-Frame-Options` / `frame-ancestors` added to the match page, or a referer gate on the match page itself (both are iframe concepts; neither exists as of 2026-10-16).

**Rung 2 - open-on-source escape hatch (build when page mode provably dies):**
a watch-screen button that opens the resolved match URL in a new tab.
Top-level navigation ignores every framing rule - `X-Frame-Options`, `frame-ancestors`, and referer allowlists regulate iframe embedding, not normal page visits, so visitors arriving from anywhere cannot be gated this way.
Works as long as their site works in a normal browser; the cost is leaving the app UI, which is why it is a fallback and deliberately not built yet.

**Rung 3 - same-origin proxy shim (last resort, arms race):**
route the match page through a server function that rewrites its links to stay inside the proxy and injects a script that redefines `document.referrer` (Object.defineProperty on the document instance) before their JS reads it - possible only because the proxied page is then same-origin to the app.
It works, but every change to their player JS starts a new round, so this is monthly maintenance and must never be built preemptively.

Standing rule for every rung: both gate changes observed on 2026-10-16 were answered by simplification (stop mounting what they refuse) rather than battle.
Expect the same next time: diagnose live, drop the broken embed, fall back to what still works - the ladder exists so falling back is a decision, not a scramble.

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
- 2026-10-16 (afternoon): feed status semantics, decoded from their own web bundle (their statics JS served off the same CDN family as the site, status table object `{'ONGOING': [...], 'FINISH': [...], 'COMING': [...]}`): FINISH is exactly codes {100, 10000} - nothing else is ever terminal; ONGOING is the per-sport live enums (football 100-105, basketball 200-214, tennis 300, baseball 400, cricket 600, motorsport 700, rugby 800, am. football 900, aussie rules 1000, ice hockey 1100, badminton 1200, volleyball 1300, combat 1400, cycling 1500, handball 1600, other 9000); COMING is {0, 10001 cancel, 10002 cut, 10101 TBD, 10102 suspend, 10103 postpone}. A null status code is never finished on their site - null rows the live feed still lists after kick-off (golf rounds, stage feeds, university sessions) are still in progress, so `parseStatus` maps them to live.
- 2026-10-16 (afternoon): the embedded mirror document grows to ~3200px tall at 750 wide once their ad scripts inject banners (~1249px clean); a 3000px zoom frame was still not enough to stop their scroll-centring (the video slid out of the crop - scrolling="no" does not stop programmatic scrolling in Chromium), so `PAGE_EMBED_BASE.height` is 10000: no scrollable overflow survives and their centring target flips negative.
- 2026-10-16 (afternoon): mirror-page layout, the anchor the page-embed zoom crop depends on - on the full mirror page (both loaded directly and reached via the entry handoff) at 750px viewport the player iframe (`iframe-di`) sits at exactly (0, 80, 750, 421.875) at mount, scrollY stays 0 (only a fixed 750x80 logo strip sits above). Below 750px viewport the page goes fluid full-width (and there the video starts at (0, 0, w, w*9/16), but an ~80px strip also appears above it within minutes - verified 2026-10-16 late afternoon at 654px viewport: `iframe-di` measured (0,0) at load, (0,80,654,367.875) after 5 min, with their BOLA808/Sloto88 banners stacked above and a second banner + URL strip below). The player page itself fills its whole iframe with the `<video>` element (0, 0, 750, 421.9 - verified booted with a 1280x720 stream), so a viewport-relative pan-scale crop of the embed at base width 750 shows video only. Floating ad overlays they render inside the player page (top banner, bottom-right square) are inside the stream area and no crop can remove them. These constants live in StreamScreen (`PAGE_EMBED_BASE` / `PAGE_EMBED_VIDEO`); if the crop drifts, re-measure before touching code.
- 2026-10-16 (late afternoon): the "never shifts" hope above is false under framing - once embedded, their layout reflows over the first minutes and the video container slides up the page past the 80px anchor; the worst measured leak was a ~110px band of share-strip/banners/url-strip inside the crop's bottom (session where the settled video top measured ~-30px page-space). No constant can track a moving anchor, so the app does not try: showing that leak is the default (the visitor consented to the source's ads by watching the mirror at all), and the toolbar's opt-in "Hide ads" toggle (localStorage `scoreline:hide-ads`, default off) lays the `PAGE_EMBED_MASK` black bars (top 16 / bottom 110 video-box px) over the drift band - cropping those strips off the picture as the price - remembered per browser. Flipping the toggle off returns to the unfiltered view.
- 2026-10-16 (afternoon): live priority - women's matches (detected by women/woman/ladies/wta/donne/femminil/female/putri markers or a trailing (w)/[w] in league/team names, `isWomens` in `src/domain/match.ts`) sort after every pinned sport (`matchBand` in `src/domain/categories.ts`), the watch hero and the Headline Fixtures shelf filter them out entirely, and pinned sport shelves push them below the men's matches of the same sport. Known residual: women's fixtures with no textual marker (e.g. "Samoa vs Francia" rugby world cup) pass as men's - the feed offers no better signal.

## Environment quirks that look like bugs but are not

- The Cursor IDE's embedded browser never delivers ResizeObserver callbacks (not even the initial observation) - any code relying on the observer alone sits stale there. Measure synchronously in the effect as well (StreamScreen's shell tracking does).

- Video start requires a real user click: synthetic (CDP) clicks lack user activation, so automated verification ends at "player chrome renders, no ads".
- The three endpoints (`/api/config`, `/api/probe-player`, `/api/resolve-redirect`) are Vite middlewares in dev and Vercel Edge functions in production, both delegating to `server/endpoints.ts`. The Vercel project must have the `SCORELINE_*` env vars set in its settings; without them the app runs discovery-only, and a cold visitor with empty caches sees an empty feed.
- Screenshots taken right after navigation race lazy image loads and look like placeholders; wait a beat before judging the UI.
- The watch screen's overlay view-state can flap while the feed refreshes under it; re-snapshot before concluding a UI bug.
- The feed only covers a window around kick-off; a deep link to an old match legitimately shows "Stream unavailable".
