# Scoreline

A local mirror-client for a live sports-streaming network.
It mirrors the network's live match listings across every sport it carries, and embeds its actual video streams directly, without the ad-wrapped pages.

This is a personal reverse-engineering and interoperability project, built to understand how a heavily rotating pirate sports network keeps itself alive, and to mirror it cleanly.
It serves no content of its own: every score, team, and video frame comes from the source network at runtime, and the app deliberately adapts to that network's constant domain and config rotation instead of pinning anything down.

## What it does

- **Live scores across the network's full sport range** - football, basketball, tennis, baseball, cricket, motorsport, rugby, american football, aussie rules, ice hockey, badminton, volleyball, combat sports, cycling, handball, and horse racing - refreshed every minute.
- **Leagues browse** with per-sport artwork and live league tables.
- **Deep links** in the source network's own URL shape, so a match page here mirrors a match page there.
- **Direct ad-free player embeds** - the network's bare player page, mounted in the full frame with no banners, probed and verified server-side before anything mounts.
- **Rotation resilience as a first-class feature** - no embedded origin is hardcoded for actual use.
  Entry domains, feed hosts, and player hosts are all discovered at runtime, cached briefly, re-resolved on failure, and probed before use; when the direct player stops being served, the app falls back to the network's own match page automatically and says so.

## How it works

The app is a Vite + React 19 + TypeScript frontend with no backend of its own.
Two dev-server middlewares stand in where the browser is deliberately blind:

- `/api/resolve-redirect` walks server-side redirect chains (old-generation hosts 301 to the current one without CORS headers, invisible to page JavaScript).
- `/api/probe-player` requests a player embed URL exactly as the browser's iframe navigation will, so a refused or dead embed is detected before a blank frame ever mounts.

Everything else is client-side:

- `src/api/source-sites.ts` - the runtime discovery chain: entry origin, feed hosts, and the player-host list decoded out of the network's scrambled params API.
- `src/api/aelive.ts` - the protobuf feed client and its per-request host failover.
- `src/api/player.ts` / `src/api/probe.ts` - the direct-player URL contract and the probe-based host picker.
- `src/screens/StreamScreen.tsx` - the watch screen: probe-then-mount, load watchdog, epoch-rotated retries, and the automatic page-embed fallback.
- `src/lib/route.ts` - the deep-link shape shared with the source network.

The full map of the network, its verified behaviors with dates, and the symptom-by-symptom failure catalog live in [AGENTS.md](AGENTS.md).
That file is the real documentation of this project - start there.

## Getting started

Requires Node 18+ (18.17 or newer for Vite) and npm.

```bash
npm install
npm run dev        # serves on http://localhost:5188 (strict port)
```

Open `http://localhost:5188` and pick a live match.

The dev port is fixed at 5188 because the probe middleware derives its Referer from it.
If the port is taken, kill the stale process rather than changing the config.

```bash
npm run typecheck  # the code-quality gate; there is no test suite yet
```

## How to contribute

Read [AGENTS.md](AGENTS.md) first, especially "The one rule that outranks everything else".
Every fact about the source network in this repo was verified live on a specific date, and the operator rotates domains, ciphers, and keys without notice.
Before diagnosing or changing anything in the streaming pipeline, re-verify the specific fact you are relying on, using the playbook commands in that file.

Ground rules:

- Run `npm run typecheck` before proposing anything; it must pass.
- No source-network host may be hardcoded for actual use.
  Discovery, cache, and fallback paths exist so nothing needs to be; a new host only ever lands in the compiled-in candidate lists, next to its verification date.
- Comments in this codebase explain **why**, not what.
  Look at any existing module before writing new one - the reasoning behind every design decision is documented in place, and new code is expected to keep that standard.
- If you verify a new behavior of the source network (a moved gate, a changed cipher, a new host family), update the dated facts in `AGENTS.md` as part of your change.
- Keep raw investigation notes and throwaway scripts out of the repo - `.scratch/` is gitignored for exactly that.

Especially welcome contributions:

- Coverage for failure modes not yet in the catalog (something the network did that the app handled badly).
- Improvements to discovery resilience - the whole point of the architecture is that the network changes and the app does not care.
- UI polish on the match cards, league browse, and watch screen.

Open a pull request with a description of what you verified and how.
For anything touching the reverse-engineered contracts, describe the live verification you performed - date, commands, results - because "it worked on my machine" does not apply to a network that rotates under you.

## Legal

This project embeds and mirrors content that belongs entirely to the original network and its broadcasters.
It is a personal research tool with no warranty, no availability guarantees, and no content of its own.
Do not use it to redistribute anything, and check what accessing this network means where you live.
