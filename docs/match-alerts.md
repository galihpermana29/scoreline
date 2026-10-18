# Match alerts

Scoreline requires an account.
A signed-in viewer picks clubs and sports, and when one of those matches starts streaming, Scoreline emails them a link to that match's watch screen.
The mail goes out once per viewer per match, the moment the source feed lists a stream for it.

Every fact about the source feed below was verified live on 2026-10-17.
Re-verify before relying on one, per the rule at the top of `AGENTS.md`.

## Access

### Sign-in is optional

A guest can open every screen, including a watch URL, without an account.
The stream embed mounts for a guest the same way it does for a signed-in viewer.

A Sign in button opens the modal.
On a wide screen it is a sidebar row.
On a phone it sits with the home controls, floats on the other browse screens, and sits in the watch header.
Not now dismisses the modal and leaves the visitor on the screen they already opened.
The alerts bell opens the same modal while signed out, because alerts belong to an account.
After a successful sign-in from the bell, the alerts picker opens.

While the modal is up, the page behind stays visible under a black scrim at partial opacity and is inert.
There is no blur anywhere: the no-blur rule in `src/styles/base.css` stands, because a measured TV session showed backdrop blur degrading the whole UI over a long stream.
The modal is a front-end prompt for accounts and alerts, not protection for the feed.

Signing in on a watch URL keeps the visitor on that screen.

### One modal for login and signup

Signup and sign-in are the same step, so the modal has no tabs.
The visitor enters an email, Convex Auth emails a 6-digit code through Brevo, and they type it back.
The first success creates the account; every later success opens the same account.
A code expires after 10 minutes.

The layout follows the screen:

- Wide screens, including TV: the email form on the left, a pairing QR code on the right.
- Phones (the app's existing 739px breakpoint and below): the email form only, since a phone cannot scan its own screen.

### QR pairing

The QR lets a TV, or any wide screen, sign in by approving from a phone.

1. The modal creates a pairing in Convex: a short display code (for example `K7P-4QX`) and a secret that only this browser holds.
   A pairing expires after 5 minutes and is used once; the modal replaces an expired one on its own.
2. The QR encodes `{APP_ORIGIN}/link?code=K7P-4QX`, and the modal shows the code in text beside it.
3. The phone opens `/link` as a guest and shows "Sign in on your TV?" with the code and an Approve button.
   Approve asks them to sign in first if this phone is not already signed in.
   The code shown on both screens is what stops someone from tricking a viewer into approving a stranger's device.
4. Approve marks the pairing approved for the phone's user.
   The TV holds a live Convex query on its pairing, sees the approval immediately, and signs in through a custom Convex Auth credentials provider that checks the secret, the approval, the expiry, and that the pairing is unused.

Both paths reach the same account: one email is one user, whichever device typed it.

### Sessions

A session ends after 14 days without use, and every visit extends it.
A 90-day ceiling ends any session regardless, so a lost or shared device does not stay signed in forever.
These map to Convex Auth's inactivity and total session durations.

## Alert choices

### Where they are made

Right after an account's very first sign-in, the alerts picker opens.
Save stores the choices, Skip stores an empty choice, and either way the account is marked as prompted and the picker never opens on its own again.
A first sign-in that lands on a watch screen defers the picker until the viewer leaves that screen.

After that, a bell in the sidebar opens the picker.
A small dot on the bell shows that at least one alert is on.
The email's "Manage alerts" link opens the app with the picker open (`/?alerts=1`).

### What can be chosen

Three sections, every row a toggle:

- **Clubs**: the eleven below. Choosing a club is the football choice; there is no separate Football switch.
- **Badminton**: every badminton match that streams.
- **Motorsport**: Formula 1 and MotoGP as two separate toggles.

The club list is a source constant shared by the client and Convex, not a table and not something the viewer types.
Each club carries its feed team id, read from the source's own league standings on 2026-10-17:

| Club | Feed team id | Name in the feed (`language=8`) | League id |
| --- | --- | --- | --- |
| Arsenal | 206665 | Arsenal | 4356 |
| Chelsea | 206661 | Chelsea | 4356 |
| Liverpool | 206651 | Liverpool | 4356 |
| Manchester United | 206653 | Manchester United | 4356 |
| Manchester City | 206662 | Manchester City | 4356 |
| Tottenham Hotspur | 206664 | Tottenham Hotspur | 4356 |
| Real Madrid | 206725 | Reale Madrid | 4400 |
| FC Barcelona | 206768 | FC Barcelona | 4400 |
| Atlético Madrid | 206707 | Atlético Madrid | 4400 |
| Paris Saint-Germain | 206822 | Paris Saint-Germain | 4426 |
| Bayern München | 206764 | Fußball-Club Bayern München | 4411 |

Every choice records when it was turned on (`enabledAt` per club and per sport), which the send rules below depend on.

## When a mail is sent

A match mails a viewer once, on the first cron tick where all of these hold:

1. **The match streams**: its id is in the feed's stream list (see "The feed" below).
   This is the signal for "the link is ready" - streams appear at kickoff, sometimes earlier for ceremonies, and some live matches never get one.
2. **It is not over or called off**: field 4 is not a finish code (100, 10000) or a cancel/cut/TBD/suspend/postpone code (10001, 10002, 10101, 10102, 10103).
   This is the only use of the status code: a null or "coming" code does not block, because the stream list is the truth.
3. **The viewer chose it**: a chosen club's feed team id is the home or away team id, or the match belongs to a chosen sport (rules under "Matching rows").
4. **It started streaming after the choice was made**: the match's first appearance in the stream list is later than the `enabledAt` of the choice that matched it.
   This keeps silent a viewer who adds a club mid-match, and stops the first deploy from mailing every stream already running.
5. **It started less than 45 minutes ago**, measured from the earlier of its kickoff and its first appearance in the stream list (first appearance alone when the row has no kickoff).
   Past 45 minutes the match is closed for that viewer forever, mailed or not.
6. **There is no ledger row yet** for this viewer and this match, or the row is `failed` with retries left (see "Never twice").

One mail per viewer per match: a match that hits two chosen clubs (Liverpool vs Chelsea), or appears several times in the stream list (one entry per channel), still mails once.

## Matching rows

**Clubs** match on feed team id only, never on names.
The `language=8` feed localises names ("Reale Madrid", "Ipswich Città", "Newcastle Uniti", "Arsenal Donne" for the women's side) and reuses short names across countries (Liverpool of Montevideo, "Premier League" in five other countries), so any name rule would both miss and misfire.
The team id belongs to the team, not the competition, so league, cup and European matches all match.

**Badminton** is every row of `sportType` 12.

**Formula 1 and MotoGP** live inside `sportType` 7 alongside WSBK, WEC, NASCAR, rally, powerboats and more, each series with its own competition id.
Neither series had a session in the 2026-10-17 window, so their competition ids are not yet known.
Until they are pinned, the cron matches on the competition name only (never the session title, since "Grand Prix of Italy" turned out to be powerboat racing): `/^(formula\s*1|f1)\b/i` for F1 and `/\bmotogp\b/i` for MotoGP, and logs every match with its competition id.
After the first race weekend of each, the ids are pinned in the shared constant and the name rule is removed.
In the MotoGP competition, a session whose title names Moto2 or Moto3 is skipped.
Every session of both series mails: practice, qualifying, sprint and race.

## Never twice

The ledger holds one row per viewer per match, and only one cron tick can create it.

1. A mutation inserts the row as `sending`, or moves a `failed` row with fewer than 3 attempts back to `sending`.
   The insert is the claim: a concurrent tick finds the row and stops.
2. An action calls Brevo.
3. A 2xx answer marks the row `sent`.
4. A non-2xx answer means Brevo definitely did not send: the row becomes `failed` and its attempt count goes up.
   A later tick may retry it, but only while every send rule above still holds.
5. Anything else - the connection dies, the request times out, the action crashes - leaves the row `sending` forever.
   It is never retried, because the mail may have gone out.
   A lost mail is preferred over a duplicate.

A daily job counts rows stuck in `sending` and includes the count in the operator health mail if it is not zero.
The Brevo helper therefore has to keep the two failure kinds apart: "Brevo answered with an error" and "no answer" are different outcomes, not one thrown error.

## The email

Brevo delivers it from `admin@scoreline.sbs`, a domain authenticated in Brevo (verification code, both DKIM records and DMARC are in DNS as of 2026-10-17).
Sign-in codes come from the same sender.
`BREVO_API_KEY` lives in the Convex env, because Convex sends, not a Vercel route.

Content:

- **Subject**: "Live now: Liverpool vs Chelsea", or "Live now: Formula 1 - Qualifying" for a session.
- **Body**: competition, the two sides or the session title, kickoff in Asia/Jakarta labelled WIB, and a **Watch now** button.
- **Footer**: "Manage alerts" (`{APP_ORIGIN}/?alerts=1`) and "Turn off all alerts".

The Watch now button is `{APP_ORIGIN}{matchHref(match)}`, the app's own watch path (`matchHref` in `src/lib/route.ts`), never the source-site URL.
Every row of the four alert sports carried its SEO slugs on 2026-10-17, so `matchHref` should always resolve; if a row ever lacks them, the mail sends without the button.
A click after the row leaves the feed shows the existing "Stream unavailable" state, unchanged.

"Turn off all alerts" is a signed link to a Convex HTTP endpoint that clears every choice for that viewer without sign-in, then shows a one-line confirmation.
The same URL goes into the `List-Unsubscribe` header with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, so mail clients show their own unsubscribe button and the mail stays out of spam.
The signature is an HMAC of the user id with `UNSUBSCRIBE_SECRET`.

## The feed, from Convex

### What the cron fetches

A Convex cron action runs every minute.
It fetches only what somebody has chosen: `sportType` 1 when any club is chosen, 12 when anyone has Badminton, 7 when anyone has F1 or MotoGP.
Requests are spaced at least 1700ms apart, as the client does, to stay under the Cloudflare burst limit.
The path and parameters are the client's: `FEED_PATH`, `language=8`, `stream=false`.

The stream list is data field 2 of the same response the app already fetches (`PBMatchLiveResp`, root field 10, beside the match rows at field 1 and odds at field 3).
Each entry is `{2: 1, 5: 1, 50: matchId}`, one per channel.
`stream=true` changes nothing in the response; the list ships either way.

The cron records each match's first appearance in the stream list in a `streams` table (match id, sport, kickoff, `firstSeenAt`), which the send rules read.

### Answers and failures

- A 200 with a protobuf content type is data.
- A 499 whose body is an empty `PBMatchLiveResp` is the backend saying "no data for this sport right now": it came back for badminton on a day with nothing listed, and briefly for football before recovering.
  It is not a failure; that sport simply has nothing new this tick.
- A connection error, a non-protobuf answer, or any other status is a real failure.

### Host discovery

Host rotation must not silence alerts.
The cron discovers feed hosts the way `resolveApiHosts` does in the browser: it fetches an entry page from `SCORELINE_ENTRY_HOSTS` and extracts the `apis-data` hosts from its inline config block.
That is simpler on the server, since there is no CORS.
The working host order is cached in a Convex table instead of `localStorage`, and `SCORELINE_API_HOSTS` from the Convex env stays as the last-resort fallback.

### The health alarm

After 10 consecutive ticks in which every requested sport failed for real (499s do not count), Convex mails `OPERATOR_EMAIL` once.
When the feed answers again, it mails once more to say so.

Once a day the cron also reads the league standings (`/api/league/team/standing/list?leagueId=…&seasonId=…&language=8&sportType=1`, season ids from `/api/league/season/list?leagueId=…`) and checks that every club's team id is still in its league's table.
A missing id means the operator re-keyed teams, and the alarm says which club.

### Shared code

The feed parsing moves into a pure module with no browser dependencies, imported by both the app and Convex.
Today `parseMatch` in `src/api/aelive.ts` folds field 4 into a `MatchStatus` and discards it, and the file imports `source-sites.ts`, which uses `localStorage`.
The shared module returns raw rows: match id, sport, kickoff, the raw status code, numeric team ids (a team without a numeric id is not matchable), competition id and name, title, slugs, plus the stream list.
The app's `parseStatus` and `Match` mapping stay in the app on top of it.

## Convex

One Convex deployment beside the existing Vite app; the three Vercel endpoints stay as they are.

Tables:

- **Users and sessions**: Convex Auth's own.
- **Alert choices**: per user, the chosen club ids and sports, each with its `enabledAt`, and whether the first-sign-in picker has been shown.
- **Pairings**: display code, secret hash, status (pending, approved, used), approving user, expiry.
- **Streams**: per match, sport, kickoff, `firstSeenAt`.
- **Ledger**: user, match, watch path, status (`sending`, `sent`, `failed`), attempts, claimed time.
- **Feed state**: the discovered host order, the consecutive-failure count, and whether the alarm is raised.

Convex env: `BREVO_API_KEY`, `MAIL_FROM` (`admin@scoreline.sbs`), `APP_ORIGIN` (`https://scoreline.sbs`), `SCORELINE_ENTRY_HOSTS`, `SCORELINE_API_HOSTS`, `OPERATOR_EMAIL`, `UNSUBSCRIBE_SECRET`, plus Convex Auth's own keys.
Vercel env adds `VITE_CONVEX_URL`.

## UI and performance

Every new surface follows the app's current iOS style: its sheets, radii, type, and springs.
Modals sit on a black scrim at partial opacity and never use `backdrop-filter`.
Motion animates `transform` and `opacity` only and respects reduced motion.
The flows must feel immediate on a phone, a laptop, and the TV.

The watch screen is the performance priority:

- The embed does not mount behind the gate.
- Auth state is read only by the gate, the bell and the picker, so a session refresh never re-renders the stream screen.
- The Convex client connects at startup, because the gate needs the session state, but the sign-in form, the pairing UI and its QR encoder, and the alerts picker load as lazy chunks when first opened.
- Opening the bell during a stream adds a scrim and a sheet, nothing that repaints per frame.

## Verify before trusting

- **Convex can fetch the feed.** Vercel's servers got a 200 from both feed hosts on 2026-10-17, but a fetch from an actual Convex action is the first thing built, before anything depends on it.
- **F1 and MotoGP competition ids.** Pin them at each series' next race weekend and delete the name rule.
- **Streams before kickoff.** Watch whether a match enters the stream list before its kickoff (pre-match ceremonies), and note the lead time in `AGENTS.md`.
- **Badminton streams.** Confirm a live badminton match appears in the stream list, since its status code stays null while live.

## Build order

1. Shared pieces: the pure feed module (raw rows plus stream list) adopted by the app, and the club constant with team ids. Then a throwaway Convex action that fetches and parses the feed, proving reachability.
2. Access: Convex Auth with the Brevo email code and session durations, the gate modal with its per-screen layouts, the embed held back behind it, and QR pairing with the `/link` route.
3. Choices: the alert-choices table, the bell, the picker, and the first-sign-in prompt.
4. Alerts: the cron (discovery, spaced fetches, 499 handling, the streams table), the send rules, the ledger, the Brevo send with its two failure kinds, the email template, the unsubscribe endpoint, the health alarm, and the daily standings check.

`npm run typecheck` is the gate; there is no test suite.
Each step ends with live verification in the browser, phone and TV included for the access step.

## Out of scope

- Browsing or watching without an account.
- Password accounts and magic links.
- Clubs beyond the eleven, women's sides, and other sports.
- A digest or daily summary instead of per-match mail.
- Starting the embed from the email link: Play Live stays the viewer's own click.
- Changing the watch screen's "Stream unavailable" copy.
- A same-origin proxy of the player.
