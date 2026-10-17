# Stream quality - badge the servers and start on the best one

A build brief for an agent with an empty context window.
Read `AGENTS.md` top to bottom first, in particular the dated facts on the per-match server list and switch contract (2026-10-17 evening and late evening) and the video-quality fact (2026-10-18 early morning).
Scope is the **page embed mode** only - the mode production runs. The direct player mode is out of scope.

## Why

Video quality is fixed per stream server, not chosen by their player and not reduced by our embed.
Measured live on 2026-10-18 (SC Telstar v Feyenoord, six servers; raw runs and notes in `.scratch/quality/findings.md`):

| Server | Decoded | fps |
|---|---|---|
| 1X (their default, first in the list) | 960x540 | 25 |
| Mo TH | 960x540 | 25 |
| DZ FR | 1280x720 | 25 |
| DZ PT | 1280x720 | 25 |
| TyR | 1280x720 | 25 |
| ESPN MX | 1280x720 | 60 |

Facts behind it:

- Their player is xgplayer over hls.js 1.6.16, and every server answers one MEDIA playlist - no master playlist, no renditions, no adaptive bitrate. There is nothing to tune inside their player.
- The 750px page-embed crop costs no resolution: the bare player at 1600x900 still decoded 1X at 960x540.
- The mirror starts on the first server in the list, which was the worst one here.
- The video sits in a cross-origin frame, so the app can never read a server's quality at watch time. The only source of quality knowledge is our own measurements.

So the whole win is: show the visitor which servers are better, and start them on the best known one.

## What to build

Three parts, one bead.

### 1. A measured quality table

A new module `src/domain/streamQuality.ts`:

- A `StreamQuality` type: decoded height plus frame rate (for example `{ height: 720, fps: 60 }`).
- A table of label families to measured quality, each entry carrying the date and match it was measured on. Match labels case-insensitively after trimming. Start with exact labels; widen an entry to a family pattern (for example every `DZ xx` label) only when at least two different labels of that family measured the same.
- `streamQuality(label)` returns the known quality or `null` - unknown is a first-class answer, never a guess.
- A `compareQuality` ordering: height first, then fps.
- Keep the table honest: one row per measured fact, no entry without a measurement behind it.

Seed it with the six rows above.

### 2. Quality badges on the server chips

The chip row is in `src/screens/StreamScreen.tsx` (`.watch-servers`, `.watch-server`, styles in `src/styles/watch.css`).

- A known server gets a small badge inside its chip: `720p60`, `720p`, `540p`. Unknown servers get no badge.
- iOS style like the rest of the app, small and quiet; the best known server's badge may read slightly stronger, never loud.
- No `backdrop-filter` anywhere (the app-wide no-blur rule in `src/styles/base.css` kills it anyway, for TV performance); solid or alpha fills only.
- Check the phone layout contract: the servers row keeps its `padding-inline: var(--gutter)` inset; badges must not wrap chips onto a second line at 390px wide more than they already do.
- The chip `title` should mention the quality for known servers.

### 3. Start on the best known server

Once per embed mount, switch the stream to the best known server, using the existing `postStreamSwitch` (`src/api/streams.ts`) and the existing chip highlight state (`activeStreamId`).

Rules:

- Only in page mode, while playing, once the server list has loaded and the zoom kick has landed (the mirror and its nested player exist then).
- Only when the visitor has not picked a server themselves on this mount.
- Only when it is a provable improvement: the first server in the list (their default) has a known quality, and the best known server is strictly better. If the first server is unknown, do nothing - it might be good.
- Only once per mount; a remount (mode switch, watchdog, retry, stop/play) re-arms it, matching how the chip state already resets on `embedEpoch` / `embedMode`. Note the existing gap: the chip reset effect does not run on stop/play; fix that while here.
- Highlight the chosen chip, so the visitor sees what happened and can pick another.

## Open questions to settle live before shipping part 3

These decide whether part 3 works at all; verify each with the rig below and record the answer in `AGENTS.md` dated facts.

1. **Switch before the in-video play click.** The visitor still has to press play inside their player (user activation). Does a switch posted before that click make the click start the chosen server, or is it ignored or reverted? If ignored, part 3 must wait until playback has started - and since the app cannot see playback inside the frame, the fallback is to not auto-switch and ship parts 1 and 2 alone.
2. **Dead best server.** If the chosen server is down for this match, does their player fall over to another server by itself (their `loadNextCsi` flow), or does it spin? If it spins, part 3 needs a softer rule (for example only auto-switch to servers that were also listed with stream entries in the live feed) or must be dropped.
3. **Default is the first entry.** Confirm on at least two more matches that the mirror starts on the first server of the match/detail list.

## The measurement rig (also how the table grows)

The rig from the 2026-10-18 run is promoted to `scripts/stream-quality/` as part of this work: `harness.html`, `probe.mjs`, `peek.mjs`, plus a README with the run commands.
It stays free of source host names (it reads hosts from `.env` at run time and takes URLs as arguments); raw run JSONs and the findings log stay in `.scratch/quality/` (gitignored).

How it works:

- Launch Brave (Google Chrome is not installed; Playwright's Chromium cannot decode H.264) with a throwaway profile and a CDP port:

```bash
"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" --remote-debugging-port=9222 \
  --user-data-dir="$PWD/.scratch/brave-quality" --autoplay-policy=no-user-gesture-required \
  --no-first-run --no-default-browser-check about:blank
```

- Serve the harness from any localhost port (localhost is in their referrer allowlist): `python3 -m http.server 5199 --bind 127.0.0.1` from the rig folder. Launch both as background processes, not inside a one-shot shell call, or they die with it.
- The harness embeds a match page with the app's own sandbox and crop geometry (`mode=crop`), and exposes `window.__switch(si)` which posts the same evType 104 message as `postStreamSwitch`.
- The probe auto-attaches CDP sessions into every nested frame, clicks `.xgplayer-start` inside the player frame, samples `video.videoWidth/videoHeight` and `getVideoPlaybackQuality()` every 5s, records every playlist body, and can step through a server list (`--switch '<json array of StreamOption + oriName>' --switchEvery 35`). Frame rate is computed from total frames over playback time.
- Get a live match and its server list from the app's own modules in the dev server's browser console (`import('/src/api/aelive.ts')`, `import('/src/api/streams.ts')` then `fetchMatchStreams(matchId, sportType)`), and the entry origin from `.env` (`SCORELINE_ENTRY_HOSTS`, first value).

Measure at least four or five more matches across different leagues and kick-off times before widening any table entry to a family.
Shut Brave and the harness server down when done.

## Verification

- `npm run typecheck`.
- In the real app (dev server, port 5188; sign in through the auth gate - `MAIL_DRY_RUN=1` in the Convex env prints the code to the Convex logs), open a live match with several servers and press play:
  - badges render on known chips, none on unknown ones, at desktop width and at 390px phone width (pixel-check the row alignment against the `--gutter` inset);
  - if part 3 ships: the best known chip lights up on its own once the crop lands, and the probe (attached to the app tab instead of the harness) shows the player decoding that server's measured size;
  - picking another chip by hand still works and the auto-switch does not fight it.
- Re-check the stop/play chip reset fix.

## Rules

- Do not commit or push; the user reviews and lands every change.
- Never name a source host in the repo; hosts live only in `.env`.
- Update `AGENTS.md` dated facts with every newly verified fact (the open questions above, new table rows), and keep raw runs in `.scratch/`.
- Never use the em dash; one sentence per line in long Markdown.
