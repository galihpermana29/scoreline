# Tim extra streams - a second source's channels in the server menu

A build brief for an agent with an empty context window.
Read `AGENTS.md` top to bottom first, in particular the four 2026-10-18 evening dated facts about the tim-streams second source: its API map, its embed contract, its popup contract, and the matching layer.
Scope is the **watch screen only**: the match lists and card screens never fetch tim data.
This is a source addition, not a replacement: every existing core feature must work exactly as before, and a match with no tim counterpart must look exactly as it does today.

## Why

The source's own channel list for a match can be short, region-locked, or low quality.
Tim-streams is an independently operated site that carries 1-3 curated channels for roughly the same fixtures.
Adding those channels as extra menu entries gives the visitor more choice at watch time, with no listing changes and no new duplicate cards anywhere.
The full live-verified facts (API shape, CORS, the unsandboxed-iframe requirement, the ad popup, matching quality) live in `AGENTS.md` dated facts and are not repeated here; re-verify anything you are about to rely on.

## What to build

### 1. Host list and API client

New module `src/api/timstreams.ts`:

- Tim API hosts live in `.env` as `SCORELINE_TIM_API_HOSTS` (full origins, comma-separated), served to the client through `/api/config` exactly like the source's host lists: extend `ServerDefaults` in `src/api/source-sites.ts` and the `configEndpoint` in `server/endpoints.ts` with a `timApiHosts` field, and export an accessor for the client.
 The browser bundle must contain no tim hostname: with no config and no cache the feature silently produces no channels.
- `fetchTimEvents(fresh?)` fetches `GET <origin>/api/live-upcoming`, trying the candidates in order.
 CORS is fully open (verified), so a plain browser fetch works with no middleware.
- Normalize events into a small `TimEvent` type: `id` (the trailing numeric id of the slug, kept as a string), `url` (the full slug), `name`, `sportId` (via the genre map below, `null` when unmapped), `startsAtMs` (epoch, see the time rule), and `streams` (`{name, url}` list, `vip` entries dropped).
 Skip a whole event when it is `vip: true`.
- Cache the parsed list in localStorage under `scoreline:tim-events` with the same 10-minute TTL pattern as the source resolvers; a failed refresh keeps the stale list, and an empty config list means no channels.
- Times are Eastern: `"YYYY-MM-DDTHH:mm"` strings in `America/New_York`, DST-aware.
 Convert with `Intl.DateTimeFormat` round-tripping (never a hard-coded +4h offset), so a November DST flip cannot shift every match by an hour.
- Genre map (tim `genre` number to our feed `sportId`), verified 2026-10-18 and easy to get wrong: 1 Soccer -> 1, 7 Basketball -> 2, 8 American Football -> 9, 9 Baseball -> 4, 10 Tennis -> 3, 11 Hockey -> 11, 13 Cricket -> 6, 14 Cycling -> 15, 15 and 16 Rugby -> 8.
 Deliberately unmapped for v1: 2 Motorsport and 3-6 combat/wrestling (their titles are not team pairs), plus 12 Darts, 17 Live Shows, 18 Other.

### 2. The matcher

New module `src/domain/timMatch.ts`, everything from the verified 2026-10-18 prototype:

- A tim event binds a feed match only when the genre-mapped sport matches, the kickoffs sit within ±20 minutes, and the unordered two-team name-pair score is at least **0.45**.
- Name similarity: normalize (lowercase, strip accents, tokenize, drop club-suffix stopwords like "fc"/"cf"/"sc"/"afc"/"club"), then per side take the best of token-pair similarity and whole-string Levenshtein ratio.
- The pair score is the mean of each tim side's best similarity against both feed team names - the deliberately unordered form that survived the same-hour Premier League trio and the Italianized spellings in the head-to-head run (all 22 real matches scored at or above 0.52).
- 1:1 guards:
 one tim event lists at most once for a match, highest pair score winning, nearest kickoff breaking ties (an MLB doubleheader would otherwise take the wrong game's row);
 and one tim event must not bind two different feed rows - when the caller can provide the peer rows, the bound (this match, event) pair must be mutual: the match must be the event's best-scoring row in the window and vice versa.
- Title-only feed rows (`titleOnly`) never match: they have no team pair.
- Output: the bound event's `streams` as `TimChannel`s (`{eventId, name, url}`), or an empty list.
 Unmatched is the normal case for most matches and is not an error.

The watch screen gets the peer rows for the second guard by receiving the already-fetched feed list as a prop (`feed.matches` in `App.tsx`): no extra fetching anywhere.

### 3. Watch-screen integration

All in `src/screens/StreamScreen.tsx`, additive:

- Fetch tim events once per screen while `playing` (first press of play) and match them for the current match; on any failure leave the list empty and show nothing.
- The existing `ServerMenu` (`src/components/ServerMenu.tsx`) grows an optional second-source section at the very top of the dropdown: a hairline divider, then one entry per tim channel, each labelled with its name plus a small quiet `TS` source tag distinguishing it from source servers, which sit below a `Source` divider.
 When the watched match has no tim counterpart, the menu is byte-for-byte what it is today.
 Source entries keep their measured-quality badges; tim entries never get quality badges (nothing is measured for them).
- Clicking a tim entry **swaps the whole stage** - there is no postMessage contract into tim's player.
 It unmounts the source embed and mounts the tim stream URL in its own iframe.
 Clicking a source entry swaps back: the source embed remounts fresh (same machinery as a mode switch, bumping `embedEpoch`), the clicked server is recorded as a pending choice and delivered via the existing `postStreamSwitch` once the mirror has settled (the `embedSettled` signal the auto-start already waits on).
- The tim iframe mount rules are hard requirements from their decoded guard, corrected 2026-10-18 night (`docs/tim-ad-popups.md`):
 `sandbox="allow-scripts allow-same-origin"` (the source frame's exact tokens - their guard's sandbox check reads `frameElement`, dead code across origins, and every check that does run passes with `allow-same-origin`), `allow="autoplay; encrypted-media; picture-in-picture; fullscreen"`, and the default referrer policy (never a no-referrer one - an empty `document.referrer` kills their player).
 Never add `allow-popups`, `allow-popups-to-escape-sandbox` or `allow-top-navigation` - those tokens are exactly what their ad script uses.
 Do not reuse the source iframe element; a separate mount is the whole point.
- The tim player fills its frame, so none of the page-mode machinery applies to it: no zoom crop, no kick cover, no mask bars, no ads-guard probe.
 Suppress the source load watchdog while the tim frame is on stage (its 15s stall logic would pointlessly remount the hidden source pipeline).
- State handling: stop, embed-mode switch and retry all drop a mounted tim channel; the auto-best-server logic stays source-only and never fires while a tim channel is mounted; the stream flag reads distinctly (for example label `TS stream`) so the visitor can tell what is on stage.
- Ad popups (`docs/tim-ad-popups.md`): the sandboxed default blocks every ad tab, and the cross-origin refusal their player could someday mount is a silent still frame - so while the sandboxed frame is on stage, show a quiet dismissible affordance ("Not playing? Load with their ads") that remounts the current channel unsandboxed for this mount only.
 That fallback mount alone is unsandboxed and carries the dismissible ad-tab warning (their popunder eats the first trusted click and every re-armed later one).
 Picking another channel, swapping back, stop/play and retry all return to the sandboxed default; nothing is persisted.
- The menu's phone behaviour stays inside the existing toolbar dropdown; no new sections may disturb the phone per-child-inset contract documented for `.watch`.

## Out of scope

- No home-screen or card-level indicators that a match has tim channels (phase 2).
- No motorsport/combat matching, no vip streams, no native stream extraction.
- No ads-guard equivalents for tim; the sandbox plus the fallback affordance is the handling (`docs/tim-ad-popups.md`).
- No changes to quality measurement, auto-start, or the Convex alert pipeline.

## Verification

- `npm run typecheck`.
- Add `SCORELINE_TIM_API_HOSTS` to local `.env` and to Vercel's project env; confirm `/api/config` returns it.
- In the dev app (port 5188), open a match with tim channels, pick a `TS` entry at the top of the menu:
 the frame boots JWPlayer, a real click starts video without opening any ad tab, further clicks pause and resume, and the quiet "Not playing?" affordance is there (watch the tab strip for at least two minutes and ten clicks);
  - the "Load with their ads" affordance remounts unsandboxed with the warning notice, the first click opens an ad tab (expected), and picking another channel or stop/play returns to the sandboxed default with no warning;
  - clicking a source entry swaps back, the source remounts, the pending server choice lands on the settled mirror, and the chip highlight and the in-frame server row agree;
  - an unmatched match shows no menu changes at all (no divider, no `TS` entries, no `Source` divider on a match that has source servers - the source list renders exactly as before);
  - stop/play, embed-mode toggle, zoom, ads guard, fullscreen and the auto-best start still behave exactly as before on a source-only match.
- Update `AGENTS.md` dated facts with anything newly verified during this build.

## Rules

- Committing and pushing the branch are authorized for this task (the user asked for PR links); the user reviews and merges the PR.
- Never name a source host in the repo; the source's and tim's hostnames live only in `.env` (the spec, `AGENTS.md` and all code refer to them structurally).
- `npm run typecheck` is the gate; there is no test suite.
- Never use the em dash; one sentence per line in long Markdown.