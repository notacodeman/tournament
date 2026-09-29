# Tournament

Timed game tournaments: standings, brackets, a picking wheel and a race timer, with a preset for
Parking Garage Rally Circuit. Live at **https://tournament.codeman.club**.

## How it works

There are two kinds of tournament.

**Hosted from a file (in your browser).** Download a template from the start page, fill it in (CSV in a
spreadsheet, or JSON), and drop it on the page. The tournament is saved in that browser and listed on the start
page for next time. The host can add times, edit players and build and score a bracket right on the page, and
**Download file** gives it back as CSV or JSON to edit and upload again (the `id` setting decides which tournament
an upload replaces).

**Go live** shares a hosted tournament under a short viewer code (like `K7M-2QX`). Viewers get `watch?code=…`, a
page that updates by itself every few seconds: standings, the race clock, the host's messages and wheel picks, the
latest times, fastest per track, and the bracket. Ticking *Let participants edit* makes a second, separate
8-character code; people who join with it can add times and record bracket results, and every change is logged with
their name. Only the host (who holds a secret key kept in their browser) can change players, rebuild the bracket,
turn the participant code on or off, or end it.

**Run on the site (organizer page).** For open time attacks where anyone can submit: create the tournament on
`/admin`, racers send times with a screenshot or video from `submit?t=…`, the organizer verifies or rejects each one,
and the standings only count verified times. Racers get a private link to check on their run.

Both kinds show the same tournament page: Overall, By track, Bracket, Players, Activity, Wheel and Rules tabs, plus a
floating race timer (stopwatch with laps, or countdown) that can be dragged around or popped out into its own window
(`timer`, with `?clean=1` for a clock-only OBS capture).

## Files

Plain HTML, CSS and JavaScript (ES modules) with no build step.

| File | What's in it |
|---|---|
| `index.html` | Start page (upload, join with a code, lists) and the tournament view |
| `watch.html` | Viewer page for a live tournament |
| `submit.html` | Submit a time to a tournament on the site |
| `run.html` | A racer's private link to one submitted run |
| `overlay.html` | Top-N stream overlay for a tournament on the site (`?t=…&n=10`, `&bg=dark` for a solid background) |
| `timer.html` | The race timer in its own window |
| `admin.html` | Organizer page: queue, all runs, players, bracket, settings, audit log |
| `css/style.css` | All styles |
| `js/util.js` | DOM helper, API calls, browser storage, scroll boxes, dates, CSV download |
| `js/app.js` | Start page: upload, join, lists, switching to the tournament view |
| `js/view.js` | The tournament view and its tabs; site, local and live tournaments |
| `js/files.js` | Reading and writing tournament CSV/JSON files, and the templates |
| `js/local.js` | Tournaments saved in this browser |
| `js/room.js` | Talking to live rooms |
| `js/editors.js` | Dialogs: players, add a time, create a bracket, record a match |
| `js/wheel.js` | The picking wheel |
| `js/timer.js` | The race timer, shared between the page and the pop-out window |
| `js/watch.js` | The viewer page |
| `js/submit.js` | The submit form |
| `js/admin.js` | The organizer page |
| `lib/time.js` | Reading and writing times (whole milliseconds) |
| `lib/standings.js` | Standings from runs: best per event, totals or points, gaps |
| `lib/bracket.js` | Single-elimination brackets: seeding, byes, results |
| `lib/presets.js` | Game presets (Parking Garage Rally Circuit, custom) |
| `lib/room.js` | Live rooms: codes, roles, and the changes each role may make |
| `lib/api.js`, `lib/tournament-input.js` | Helpers and input checks for the Functions |
| `functions/schema.sql` | The D1 database tables |
| `functions/api/…` | Cloudflare Pages Functions (below) |

`lib/` is shared by the pages and the Functions, so a time or a standing is worked out the same way everywhere.

### API

| Route | Who | What |
|---|---|---|
| `GET /api/tournaments` | anyone | Tournaments on the site (not drafts) |
| `GET /api/tournaments/<slug>` | anyone | One tournament, its players, verified runs and activity |
| `POST /api/tournaments/<slug>/submit` | anyone | Submit a time (form data with an optional screenshot) |
| `GET /api/runs/<token>` | the racer | One run, from their private link |
| `GET /api/proof/<key>` | anyone | A proof screenshot from R2 |
| `POST /api/rooms` | anyone | Put a tournament live; returns the codes and the host key |
| `GET /api/rooms/<code>` | code holders | A live tournament (`?since=<version>` for cheap polling) |
| `POST /api/rooms/<code>/ops` | participants, host | One change (see `lib/room.js`) |
| `/api/admin/*` | Cloudflare Access | Tournaments, runs, players, bracket, audit log |

## Setting it up on Cloudflare

1. **Pages project** from this GitHub repo: no build command, build output directory `/`. Custom domain
   `tournament.codeman.club`.
2. **D1 database**: create one (e.g. `tournament`), paste `functions/schema.sql` into its Console and run it. In the
   Pages project, Settings → Bindings → add a D1 binding named **`DB`**.
3. **R2 bucket** for proof screenshots: create one (e.g. `tournament-proof`) and add an R2 binding named **`PROOF`**.
   Without it, racers can still send video links.
4. **Cloudflare Access**: an application covering `tournament.codeman.club/admin*` and
   `tournament.codeman.club/api/admin/*`, allowing only your email (the same way as the headphone and Steam Replay
   admin pages). The code doesn't check sign-in itself; Access does.
5. Redeploy so the bindings apply.

To change the database later, add the new `CREATE TABLE`/`ALTER TABLE` lines to `schema.sql` and run just those in
the D1 Console.

## Running it locally

`npx wrangler pages dev . --d1 DB=<database id> --r2 PROOF` serves the site with the Functions. Apply the schema to the
local database first with `npx wrangler d1 execute <database name> --local --file functions/schema.sql`. Locally there's
no Cloudflare Access, so the admin API accepts anyone and logs changes as `admin`.

## Notes

- Live rooms poll every 3 seconds (`POLL_MS` in `js/room.js`); an unchanged room answers with a tiny
  `{ unchanged: true }`, so a room with a few dozen viewers stays well inside D1's free limits.
- Rooms aren't deleted automatically. To clear old ones: `DELETE FROM rooms WHERE updated_at < '2026-01-01';`
- The Parking Garage Rally Circuit track names in `lib/presets.js` are placeholders (`US Track 1` …); rename them in
  a file or the organizer page.

Not affiliated with Walaber Entertainment.
