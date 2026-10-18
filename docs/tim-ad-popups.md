# Tim ad popups - investigation and proposed fix

A proposal for an agent with an empty context window, written after a live investigation on 2026-10-18 (night).
Read `AGENTS.md` first, in particular the 2026-10-18 evening tim-streams facts and the night correction that follows them.
Scope is the tim channel mount on the watch screen (`src/screens/StreamScreen.tsx`), nothing else.

## TL;DR

Shipped 2026-10-18 late evening (branch `cursor/tim-ad-sandbox`); the dated fact in `AGENTS.md` records the live result.
The original proposal reads on unchanged below.

The shipped handling (`docs/tim-extra-streams.md`, mount rules and ad notice) rested on one claim that turned out to be false: "sandboxing the frame kills tim's player outright".
Live, a tim frame mounted with `sandbox="allow-scripts allow-same-origin"` (the exact attribute our source frame already carries) plays at 1920x1080, is never killed, and opens **zero** ad tabs across 11 clicks and 3 minutes of watching.
The same stream unsandboxed opened **10 ad tabs from 11 clicks**, and the player never received one of those clicks.
Proposal: mount the tim frame with the same sandbox as the source frame, and drop the ad notice.

## What the visitor experiences today (measured)

The rig is a harness page on `localhost` that mounts a live tim stream URL with a configurable sandbox, driven by trusted CDP mouse input (real user activation), counting new tabs by opener.
Its files are `.scratch/tim-streams/tim-harness.html` and `tim-probe.mjs`, with raw runs in `run-*.json` and screenshots in `shot-*.png`.
The stream was a Sky Sports Main Event channel for Leeds v Manchester United; every sandboxed and unsandboxed run used the same URL back to back.

Unsandboxed (shipped today):

- Click 1 opens an ad tab and is swallowed; the player stays idle.
- Click 2 starts playback (1920x1080).
- Every later click on the video, at least 10 seconds after the previous ad, opens another ad tab and is swallowed again, so pause, resume and controls effectively never work.
  In a 2.5-minute soak, 11 clicks spaced 15 seconds apart produced 10 ad tabs; the player kept playing throughout because no click reached it.
- In a separate 3-minute run with no clicks after playback started, their page paused the video and opened an ad tab on its own at about 177 seconds into playback.

The shipped notice ("the first play click may open an ad tab") therefore undersells it: it is every click, plus occasional unprompted ones.

## How the ad works (decoded)

The play page runs an Adsterra-family SDK (raw and beautified under `.scratch/tim-streams/adscript*`).
Its zone config is ciphered inline; `.scratch/tim-streams/decode-adconfig.mjs` decodes it with the substitution key that sits right after the blob (a 72-character string, plain alphabet in the first half, cipher alphabet in the second).
The decoded values that explain the behaviour:

| Key | Value | Effect |
|---|---|---|
| `pop_type` | `tabup` | A new foreground tab with the ad |
| `frequency` / `capping` | 1 / 10 min | Nominal cap, but see `every_page` |
| `every_page` | true | The cap key includes the page URL, and every play URL carries a fresh one-time JWT, so the cap never holds across loads |
| `other_click_if_close` | true | Closing the ad tab re-arms the next click |
| `interval_between_ads_seconds` | 10 | The re-arm delay |
| `video_pops_buttons` | `f`, `jl`, `k`, `lr`, `m`, `space`, `ud` | Keyboard keys on the video trigger the ad too |
| `disable_auto_pops` | false | Unprompted pops are allowed |
| `devtools_protection` | true | Devtools in the frame interferes; the rig never enables Runtime inside it |

The opener tries a hidden form submit with `target=_blank` (when its bait-div adblock check fires), then `window.open`, then a scratch iframe's `contentWindow.open`.
Every one of these is a popup in the HTML sandbox sense, so a sandbox without `allow-popups` blocks all three.
The "tabunder" variants navigate `top`/`parent` instead, which a sandbox without `allow-top-navigation` also blocks (and the zone uses `tabup` anyway).
Brave Shields and TV browsers do not stop it because it fires on a trusted user gesture, which popup blockers deliberately allow.

## Why the "sandbox kills it" claim was wrong

Their anti-embed guard (`.scratch/tim-streams/embed-script-5.js`, decoded) kills the player on any of:

1. `window.frameElement && window.frameElement.hasAttribute('sandbox')`
2. An http(s) page whose `window.origin` is `"null"` (opaque origin)
3. `localStorage`/`sessionStorage` `setItem`/`removeItem` of a probe key throwing
4. An empty `document.referrer`

Check 1 can only fire when the play page is same-origin with its parent: `frameElement` is `null` for a cross-origin frame by spec.
Our app and the tim play host are always cross-origin, so check 1 is dead code for us.
Checks 2 and 3 fire only when the sandbox omits `allow-same-origin`, and check 4 only with a no-referrer policy.
`allow-scripts allow-same-origin` passes all four, which the live runs confirm (`killed: false` in every sample).

The player bundle (`.scratch/tim-streams/embed-player.js`) has a second, softer detector: inside its ad-zone callback it calls `window.open` and immediately closes the result.
A `null` result sets an internal `isSandboxed` flag, cached for one hour in their storage.
The only consumer found is a query flag appended to the stream request URL; the server still served 1080p with it set.
So today the operator can see that a viewer is sandboxed, but does nothing about it.

## The proposal

### Change

In `src/screens/StreamScreen.tsx`, the tim iframe gains `sandbox="allow-scripts allow-same-origin"`, the same tokens as the source frame.
Keep `allow="autoplay; encrypted-media; picture-in-picture; fullscreen"` and the default referrer policy unchanged; both are still load-bearing (guard checks 2-4 and autoplay).
Do not add `allow-popups`, `allow-popups-to-escape-sandbox`, `allow-top-navigation` or `allow-forms`: none is needed by the player, and the first three are exactly what the ads use.
Fullscreen does not need a sandbox token; it is granted by the `allow` attribute, and our own shell fullscreen wraps the frame anyway.

Then:

- The default sandboxed mount shows no ad notice; the existing `player-tim-notice` block and its CSS move to the fallback below (they are its warning, not deleted).
- Rewrite the mount comment above the tim iframe: the constraint worth stating is "no `allow-popups`, keep `allow-same-origin` and the default referrer, or their guard kills the player".
- Update `docs/tim-extra-streams.md` mount rules (the "no `sandbox` attribute at all" bullet and the "Ad popup notice" bullet) to the new contract.

### What it does not fix

- The occasional self-pause: their page paused the video once unprompted in the unsandboxed control; sandboxed, one run paused once at about 88 seconds and a second 3-minute run never did.
  If it happens, a click resumes playback (resume jumps to the live edge, which is normal for a live stream).
- In-player overlays, if they ever add any: a sandbox only stops new browsing contexts, not what they draw in their own frame.
  None were seen in the screenshots.

### Risk: they can detect it

The operator already computes `isSandboxed` and reports it to their stream server.
If they start acting on it (refusing the stream, or killing the player when `window.open` returns `null`), a sandboxed tim frame fails silently: it is cross-origin, so the parent cannot see a kill message, and `onLoad` still fires.
Both of these are part of the build:

1. **The "load with their ads" fallback (required, build it):** while a tim channel is mounted sandboxed, show a small quiet affordance in the tim notice slot (label along the lines of "Not playing? Load with their ads") that remounts the current tim channel unsandboxed (the exact attribute set shipped today) for this mount only, with the existing ad-tab warning notice shown on that mount.
   The default stays sandboxed: picking another channel, swapping back to a source server, stop/play and retry all return to the sandboxed default, and nothing is persisted.
   It appears on every device, TV Mode included (the user accepted ad tabs on TV as the cost of opting in).
   Keep the affordance keyboard- and pointer-reachable like the other stage controls, and inside the phone per-child-inset contract.
2. **Re-verify on change:** the rig re-runs in about a minute (`tim-probe.mjs --watch 90` sandboxed against a current stream URL); if a future run shows `killed: true` or no playback, flip the default back and record a dated fact.

Do not go further than this.
A proxy that strips the ad script is rung-3 territory (`AGENTS.md` escalation ladder) and must not be built preemptively.

## Verification for the build

- `npm run typecheck`.
- In the dev app (port 5188), open a match with tim channels, pick a TS entry:
  the frame boots JWPlayer, a real click starts video, further clicks pause and resume, and no new tab ever opens (watch the browser's tab strip for at least two minutes and ten clicks).
- Swap back to a source server and forward again to confirm the remount carries the sandbox each time.
- Press the fallback: the frame remounts without a sandbox, the ad warning shows, and the first click opens an ad tab (expected); switching channel or stop/play returns to the sandboxed default with no warning.
- Check iOS Safari once by hand if a device is available: their guard skips iOS entirely, and WebKit honours the same sandbox popup rule, so it should behave the same, but this was not measured.
- Record the result as a dated fact in `AGENTS.md`.

## Rules

- Never commit or push unless the user explicitly asks in that message.
- Never name a source or tim host in the repo; hosts live only in `.env`.
- `npm run typecheck` is the gate; there is no test suite.
- Never use the em dash; one sentence per line in long Markdown.

## Evidence index

All under `.scratch/tim-streams/` (gitignored):

| Run | Sandbox | Clicks | Ad tabs | Player |
|---|---|---|---|---|
| `run-none-quiet.json` | none | 3 | 2 | Click 1 swallowed, plays from click 2 |
| `run-none-soak.json` | none | 11 | 10 | Plays from click 2, no later click reaches it |
| `run-none-watch.json` | none | 2 then 3 min idle | 3 | One unprompted pause and ad at about 177 s |
| `run-sb-nopopups.json` | `allow-scripts allow-same-origin allow-forms allow-presentation` | 3 | 0 | Click 1 plays, clicks toggle pause |
| `run-sb-source.json` | `allow-scripts allow-same-origin` | 3 | 0 | Same |
| `run-sb-soak.json` | `allow-scripts allow-same-origin` | 11 | 0 | Never killed, every click toggles |
| `run-sb-watch.json` | `allow-scripts allow-same-origin` | 1 then 90 s idle | 0 | Real-time playback, one pause at about 88 s |
| `run-sb-watch2.json` | `allow-scripts allow-same-origin` | 1 then 3 min idle | 0 | Real-time playback, no pause |
