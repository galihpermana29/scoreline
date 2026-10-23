# TV D-pad on the watch screen - a remote-first contract

A build brief for an agent with an empty context window.
Read `AGENTS.md` first, in particular the 2026-10-17 TV Mode, TVBro and BrowseHere dated facts and the 2026-10-23 D-pad repro fact.
Scope is TV Mode (`html[data-tv="on"]`) and the watch screen first; two browse-surface traps are included at the end because the same viewer hits them on the way in.
Nothing changes when TV Mode is off: pointer and keyboard visitors on desktop and phone keep today's behaviour exactly.

## Status (2026-10-23)

Built and verified on the rig (`.scratch/dpad/verify.mjs`, 41 checks on trusted keys, all passing twice in a row); the on-TV checks at the end are still open.
Where the build differs from the brief below:

- The focus guard is `src/lib/useTvFocusGuard.ts`; besides the blur check it re-checks every 400ms, because a focused control that unmounts (Stop, a dismissed notice) drops focus to `body` with no blur.
- The toolbar still floats (section 5 asked for reserved height), and the shelf keeps `scroll-padding` so a focused card never sits under the toolbar.
  Focus reaching the controls or Back scrolls the watch layer back to the top, so the picture returns when the viewer comes back up from Also Live.
- The 56px labelled controls of section 5 shipped and were then reverted at the user's request (same day): they forced a frame cap that made the picture smaller than in normal mode.
  The TV toolbar is now the normal-mode toolbar (53px at 1280x720, frame at full width), and only the filled focus pill is TV-specific.
- The toolbar and the fullscreen bar fade out after 40s without any interaction, in both modes (`src/lib/useIdleChrome.ts`), so the picture is left clear.
  Any pointer move, press, wheel, touch or key brings them back; the press that wakes them only shows them (an arrow or OK is swallowed, a click is swallowed), so a hidden control is never moved to or pressed blind.
  An open server menu, an open dialog or a pointer resting on the toolbar holds them up; Back is not swallowed and still steps back.
  The pointer over the video itself is never seen (the frame is cross-origin), so the mouse wakes them from the chrome around it, including the toolbar's own spot.
- Mechanism: `data-tv-scope` (no value) on the watch root and on the fullscreen bar, `data-tv-row` on top, stage notices, controls, related and fullscreen, `data-tv-default` on Servers, Play Live and (while maximized) the fullscreen button, `data-tv-skip` on card More buttons and shelf arrows.
- Back is `Escape`, `GoBack` or `BrowserBack` (`isBackKey` in `tvnav.ts`); what the user's TV app actually sends is not recorded yet.
- Two additions: leaving a match puts focus back on the card that opened it, and the watch layer is `inert` during its exit animation so its guard cannot pull focus back into a layer that is going away.

On the TV (same evening, `adb shell input keyevent` against production):
the app is `sbs.scoreline.tv`, a full-screen WebView on the live site with `ScorelineTV/` in its user agent (TV Mode now defaults on there).
Arrival focus, the guard, row navigation and the menu all held.
Back never reached the page: the app took `KEYCODE_BACK` and went back in history, so an open menu left the match; the app now offers Back to the page as an `Escape` keydown first and only goes back when the page does not `preventDefault`.
The auto-start was dropped once on the slow WebView (posted before their player listened; the same pick by hand started it), so in TV Mode the pick is re-sent until their player takes focus, the only playback signal the frame gives.

## Who this is for

The real user is a viewer in her 50s on a TV app that forwards the remote's arrows and OK as key events (unlike TVBro and the TCL browser, where the remote drives a cursor and no key ever reaches the page).
She cannot see small icons from the sofa, does not know what a focus ring is, and gives up the moment the highlight disappears.
So the bar is: open a match, the video starts by itself, the highlight is always visible, every press moves it somewhere predictable, and nothing one press away can strand her.

## What happens today (reproduced 2026-10-23)

Rig: the dev app on port 5188 in Brave at 1280x720 with TV Mode on, driven only by trusted CDP key events (`Input.dispatchKeyEvent` arrows and Enter), logging `document.activeElement`, `document.hasFocus()` and which keys our window received after every press.
Scripts: `.scratch/dpad/dpad-probe.mjs`, `menu-probe.mjs` (add `--guard` to test the fix below), `sidebar-probe.mjs`, `reclaim-probe.mjs`; screenshots beside them.
These reproduce the user's report exactly ("order is weird", "after I pick a server the D-pad disappears", "left/right fast-forwards the video").

1. **Nothing is focused on arrival.**
   The watch screen opens with focus on `body`, so the first press lands wherever the geometric picker guesses.
2. **The video cannot be started with the remote.**
   Their play button lives inside the cross-origin embed, which our navigation can never reach.
   The only remote path that starts playback is opening the server menu and picking a server: the stream switch we post makes their player start on its own.
   The existing auto-start (`StreamScreen.tsx`, the effect around line 750) only fires when a measured server beats the first listed one, so on most matches (an unmeasured single server, here `TyR 720p`) nothing starts.
3. **Focus theft after a server pick (the "D-pad disappears" bug).**
   Focus returns to the Servers button for about a second, then their player takes it when playback starts: `document.activeElement` becomes the `IFRAME` and our window stops receiving keys entirely.
   From then on every arrow goes to their player (Left/Right seek, Up/Down volume), no focus ring is drawn anywhere in our chrome, and no key brings it back.
   It happened once per playback start; a second pick on an already-playing player did not steal.
4. **The server menu is not a menu for the remote.**
   Enter opens the list but focus stays on the trigger; Up reaches the first item, and one more Up leaves the open list for the sidebar (in the run, the dark-mode toggle, which the next Enter flipped while the menu stayed open).
5. **The sidebar is live under the watch screen.**
   Up from the toolbar or the Also Live cards walks into the left rail; Enter there leaves the match (Tables), flips dark mode, or turns TV Mode off ("Turn TV Mode off" was one Up from the Servers button).
6. **Down bounces between two rows.**
   The floating toolbar sits on top of the Also Live shelf, so Down alternates toolbar button, card, toolbar button, card, because their boxes overlap vertically.
7. **Targets are too small and unlabelled for a TV.**
   Toolbar buttons are 30-36 CSS px icons with no text at 720p; the focus ring is a thin outline that disappears over their bright ad banner, which the floating toolbar overlaps.
8. **Home: the search field is a dead end.**
   Up from the top of the home screen lands in the search input, and no arrow leaves it again (`tvnav.ts` returns early for inputs).

## What to build

All behaviour below is gated on TV Mode; nothing is device-sniffed.

### 1. The video starts by itself

In TV Mode the auto-start always runs once the embed has settled (the same `embedSettled` gate): pick the best measured server if any, otherwise the first listed server, and deliver it through the existing `chooseStream(..., "auto")`.
This is exactly the switch her manual pick sends, and it was verified live to start playback with no click inside the frame.
Outside TV Mode the current best-beats-first rule stays as it is.
A visitor pick still always wins (`visitorPickedRef`), and a tim channel on stage never auto-starts (unchanged).

### 2. Our chrome never loses focus to an embed

In TV Mode, while the watch screen is mounted, guard against embeds taking focus:
on `window` `blur`, on the next tick, if `document.activeElement` is an `IFRAME` (the source frame or the tim frame), focus the last focused control in our chrome (tracked via `focusin`, ignoring iframes), falling back to the primary control from section 3, with `preventScroll`.
Verified live: the parent can take focus back from the cross-origin player with a plain `.focus()`, the guard caught the one steal per playback start (`menu-probe.mjs --guard`, `steals=1`), focus stayed on the Servers button, keys reached our window again, and the video kept playing.
The trade is deliberate: in TV Mode their in-player keyboard shortcuts are unreachable, which is the point (seeking a live stream by accident is the bug).
It also keeps the tim ad SDK's keyboard triggers (`video_pops_buttons` in `docs/tim-ad-popups.md`) from ever firing on the fallback mount.
Put the guard in its own small hook (for example `src/lib/useFocusGuard.ts`) mounted by `StreamScreen`, not inside `tvnav.ts`.

### 3. An explicit focus map instead of geometry

The geometric picker (`src/lib/tvnav.ts`) stays for the browse surface, but the watch screen gets explicit rows, because its layout (fixed floating toolbar over a scrolling shelf, iframe in the middle, rail on the left) defeats geometry.

- Rows, top to bottom: **top** (Back, and Sign in if shown), **controls** (the toolbar), **Also Live** (the shelf cards).
  The player frame is not a row; it is never focusable.
- Up/Down move between rows, landing on the item in the target row nearest horizontally to the current one (remember the last item per row so returning to a row restores it).
- Left/Right move within a row and stop at its ends: no wrap, no escape into the sidebar.
- On arrival, and whenever a remount clears focus, focus the Servers button (or Back when there is no Servers button yet).
- Mechanism suggestion: mark rows with a data attribute (for example `data-tv-row="controls"`) and a scope on the watch screen root (`data-tv-scope="watch"`); `tvnav.ts` checks for an active scope and uses row navigation inside it, geometry elsewhere.
- The sidebar must be unreachable while the watch layer is open in TV Mode: `inert` on the sidebar, matching how the browse surface is already inert under the watch layer.

### 4. The server menu behaves like a menu

In TV Mode (keep the pointer behaviour the same everywhere):

- OK on the trigger opens the list and moves focus to the selected server, or the first entry when none is selected.
- Up/Down move within the list and clamp at its ends; dividers are skipped.
- OK picks, closes, and returns focus to the trigger (this already happens; the guard from section 2 keeps it there).
- Back/Escape, Left and Right close the list and return focus to the trigger.
- While the list is open nothing outside it is reachable.

### 5. Big, labelled, legible controls

Superseded in part: the size and label rules were reverted (see Status); the filled focus state stands.

In TV Mode only, the toolbar becomes a remote surface:

- Every control shows an icon and a word ("Servers", "Full screen", "Ads guard", "Refresh", ...), at least 56 CSS px tall at a 1280x720 viewport, with the label at the body type size or larger.
- The toolbar gets an opaque background in TV Mode, so neither the focus ring nor the labels sit over their ad banner.
- The focus state is a filled high-contrast pill (background change plus the existing ring), not an outline alone: it must read from three metres on a bright frame.
- The toolbar must not overlap the Also Live shelf in TV Mode: reserve its height in the layout (padding below the stage) instead of floating over content.
- The phone per-child-inset contract for `.watch` is untouched; TV Mode on a phone is not a goal.

### 6. Fewer choices on a TV

In TV Mode hide the controls a remote viewer should never need: the embed-mode pair (Player embed / Page embed) and Zoom (the default crop stays on).
Keep Servers, Full screen, Ads guard, Refresh and Stop.
Stop must ask nothing and lead somewhere obvious: after Stop, focus goes to the big Play button, and OK on it starts the stream again (the auto-start from section 1 then runs).

### 7. The Back key

The remote's Back key must do one predictable thing per press, in this order: close an open menu, then leave fullscreen (ours or faux), then leave the watch screen (the existing `exitWatch`).
Today only `Escape` is handled; the build must first find out what Back sends in the user's TV app (section "On the TV" below) and handle that too (commonly `Escape`, `GoBack`, `BrowserBack`, or a `history.back()` the app performs itself, in which case the route change is the signal).

### 8. Fullscreen

Entering fullscreen in TV Mode moves focus into the in-frame bar (`.player-embed-bar`, it already renders our controls while maximized), with the same row and label rules; leaving fullscreen returns focus to the Full screen button.
The focus guard keeps working in fullscreen.

### 9. Browse-surface traps (same viewer, on the way in)

- In TV Mode, Up/Down pressed inside a text input leave the input via the normal navigation; Left/Right stay with the caret.
- Focus landing on the sidebar search field must not navigate by itself; check the `onFocus` navigation in `Sidebar.tsx` `SearchField` under TV Mode and require OK to open search.

## Out of scope

- Controlling their player (pause, seek, volume) from our chrome: it is cross-origin and has no such message contract.
- Cursor-paradigm TV browsers (TVBro, the TCL browser): keys never reach the page there (`AGENTS.md` 2026-10-17); nothing in this spec helps or hurts them.
- Any change outside TV Mode.

## Verification

- `npm run typecheck`.
- Re-run the rig against the dev app (`node .scratch/dpad/verify.mjs` with Brave on the CDP port and exactly one tab open - a second tab on the app leaked stray keys into the run; launch flags as in `menu-probe.mjs`) and record that:
  arrival focus is the Servers button;
  the video starts without any key press on an unmeasured single-server match;
  after a pick `document.activeElement` is never the `IFRAME` and `keysSeenByApp` keeps logging every press;
  Up from the toolbar never reaches the sidebar; Down never bounces;
  the open menu clamps at both ends and closes on Left, Right and Escape.
- Screenshot the toolbar focus state over a bright banner frame and check it reads at a glance.
- Pointer regression on desktop with TV Mode off: menu, toolbar, shelf, sidebar and fullscreen behave exactly as before.

### On the TV

- Identify the user's installed app: `adb shell dumpsys window | grep mCurrentFocus` while it is in front (adb recipe in `AGENTS.md` 2026-10-17); record the package name in a dated fact.
- With a temporary keydown recorder (or the app's devtools socket if it exposes one), press every remote key once and record what reaches the page, Back in particular.
- Walk the real flow with the remote only: home, open a live match, video starts, pick another server, the highlight stays visible, Back leaves.
  Do it once with the user watching if possible; she is the acceptance test.
- Update `AGENTS.md` dated facts with what was verified.

## Rules

- Never commit or push unless the user explicitly asks in that message.
- Never use the em dash; one sentence per line in long Markdown.
- Never name a source or tim host in the repo; hosts live only in `.env`.
- `npm run typecheck` is the gate; there is no test suite.
