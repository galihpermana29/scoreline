# Stream-quality measurement rig

Measures the real decoded quality (`videoWidth`/`videoHeight` + frame rate over time)
of the source's per-match stream servers, inside the same embed geometry the app
uses. The measured facts feed `src/domain/streamQuality.ts`; the findings log
with the full evidence of the 2026-10-18 run lives in `.scratch/quality/findings.md`
(raw run JSONs stay under `.scratch/`).

Everything here is host-free: the target URLs come from `.env` and the dev
server at run time, never from this folder.

## Running it

1. Launch Brave with a CDP port and a throwaway profile:

```bash
"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  --remote-debugging-port=9222 \
  --user-data-dir="$PWD/.scratch/brave-quality" \
  --autoplay-policy=no-user-gesture-required \
  --no-first-run --no-default-browser-check about:blank
```

Google Chrome is not installed on this machine and Playwright's Chromium cannot
decode H.264, hence Brave. Launch it as a background process, not inside a
one-shot shell call.

2. Serve this folder from any localhost port (localhost is in their referrer
allowlist):

```bash
python3 -m http.server 5199 --bind 127.0.0.1
```

Also a background process.

3. Get a live match's page URL and server list. In the dev server's browser
console (port 5188):

```js
const live = await import("/src/api/aelive.ts");
const streams = await import("/src/api/streams.ts");
const options = await streams.fetchMatchStreams(matchId, sportType);
```

The entry origin is `.env`'s `SCORELINE_ENTRY_HOSTS`, first value; the match
page URL is `{origin}/{matchHref}`.

4. Run the probe against the harness. The harness embeds the match page with
the app's sandbox and page-embed crop geometry (`mode=crop`) and exposes
`window.__switch(si)`, which posts the same evType 104 message as the app's
`postStreamSwitch`:

```bash
node scripts/stream-quality/probe.mjs \
  --url "http://127.0.0.1:5199/harness.html?src=<encoded match url>&mode=crop&w=1600" \
  --secs 240 --out .scratch/quality/run-<matchid>.json \
  --switch '<json array of {streamId,sportType,name,siteType,oriName}>' \
  --switchEvery 35
```

The probe auto-attaches CDP into every nested frame (mirror -> player), clicks
`.xgplayer-start` inside the player, samples the `<video>` elements every 5s,
records every playlist body, and steps through the server list. Frame rate is
computed from `getVideoPlaybackQuality().totalVideoFrames` over playback time.

`peek.mjs` evaluates an expression in one frame of a running page, for
scratch debugging.

5. Shut Brave and the harness server down when done.

## Growing the table

- Measure at least four or five more matches across different leagues and
  kick-off times before widening any entry to a family pattern.
- Every new measured row lands in `src/domain/streamQuality.ts` with the date
  and match it was measured on, and as a dated fact in `AGENTS.md`.
- Frame rate only shows in a badge when it is a smooth one (>30).