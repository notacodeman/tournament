# Tournament

Timed game tournaments: standings, brackets, a picking wheel and a race timer, with a preset for
Parking Garage Rally Circuit. Live at **https://tournament.codeman.club**.

## How it works

There are two kinds of tournament.

**Hosted in your browser.** **Create a tournament** on the start page walks through it step by step: the game, the
tracks and classes that count, scoring, players, name and rules. (Or fill in a CSV/JSON template and drop it on the
page.) The tournament is saved in that browser and listed on the start
page for next time. The host can add times, edit players and build and score a bracket right on the page, and
**Download file** gives it back as CSV or JSON to edit and upload again (the `id` setting decides which tournament
an upload replaces).

**Go live** shares a hosted tournament under a short viewer code (like `K7M-2QX`). Viewers get `watch?code=…`, a
page that updates by itself every few seconds: standings, the race clock, the host's messages and wheel picks, the
latest times, fastest per track, and the bracket. Ticking *Let participants edit* makes a second, separate
8-character code; people who join with it can add times and record bracket results, and every change is logged with
their name. Only the host (who holds a secret key kept in their browser) can change players, rebuild the bracket,
turn the participant code on or off, or end it.

**Run on the site (admin page, owner only).** For open time attacks where anyone can submit: create the tournament on
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
| `admin.html` | Admin page (owner only): delete any live tournament; site tournaments' queue, runs, players, bracket, settings, audit log |
| `_headers` | Security headers for every page (Content-Security-Policy and friends) |
| `css/style.css` | All styles |
| `js/util.js` | DOM helper, API calls, browser storage, scroll boxes, dates, CSV download |
| `js/app.js` | Start page: create, upload, join, lists, switching to the tournament view |
| `js/wizard.js` | The step-by-step setup guide |
| `js/turnstile.js` | Gets a Turnstile token before going live or submitting a time |
| `js/run.js`, `js/overlay.js`, `js/timer-page.js` | Scripts for `run.html`, `overlay.html`, `timer.html` |
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
| `lib/room.js` | Live rooms: codes, roles, the changes each role may make, and `cleanRecord` (shape, sizes, words) |
| `lib/access.js` | Checks the Cloudflare Access sign-in token and the admin email list |
| `lib/limits.js` | Rate limits kept in D1 |
| `lib/turnstile.js` | Checks Turnstile tokens |
| `lib/moderation.js`, `lib/blocked-words.js` | The blocked-word filter and its list |
| `lib/cleanup.js` | Deleting tournaments, and the weekly automatic clear-out |
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
| `GET /api/config` | anyone | Public settings (the Turnstile site key) |
| `/api/admin/*` | owner (Access + email check) | Live tournaments (list, delete), site tournaments, runs, players, bracket, audit log |

## Setting it up on Cloudflare

1. **Pages project** from this GitHub repo: no build command, build output directory `/`. Custom domain
   `tournament.codeman.club`.
2. **D1 database**: create one (e.g. `tournament`), paste `functions/schema.sql` into its Console and run it. In the
   Pages project, Settings → Bindings → add a D1 binding named **`DB`**. Every statement is `IF NOT EXISTS`, so running
   the whole file again after an update only adds what's new.
3. **R2 bucket** for proof screenshots: create one (e.g. `tournament-proof`) and add an R2 binding named **`PROOF`**.
   Without it, racers can still send video links.
4. **Cloudflare Access**: a self-hosted application covering `admin` and `api/admin/*` on `tournament.codeman.club`,
   on `tournament-6ms.pages.dev`, and on `*.tournament-6ms.pages.dev` (preview deployments), allowing only your email.
5. **Variables** (Settings → Variables and secrets, for Production):

   | Name | Value |
   |---|---|
   | `ADMIN_EMAILS` | your email (comma-separate several) |
   | `ACCESS_TEAM_DOMAIN` | your Zero Trust team domain, e.g. `codeman.cloudflareaccess.com` |
   | `ACCESS_AUD` | the Access application's *Application Audience (AUD) Tag* (on its Overview/Basic information) |
   | `TURNSTILE_SITE_KEY` | optional: from Turnstile → Add site (hostname `tournament.codeman.club`) |
   | `TURNSTILE_SECRET` | optional, as a **Secret**: the same Turnstile site's secret key |
   | `BLOCKED_WORDS` | optional: extra blocked words, comma-separated |
   | `RETENTION_DAYS` | optional: days before an untouched tournament is deleted (default 7) |

   Without the first three, the admin API refuses everyone. Turnstile stays off until both of its keys are set.
6. Redeploy so the bindings and variables apply.

## Security and moderation

- **Admin**: Cloudflare Access signs you in, and the API also checks Access's signed token itself
  (`lib/access.js`: signature, application, expiry, email on `ADMIN_EMAILS`). A forgotten path in the Access app or a
  faked header can't get in. Admin changes must come from the admin page itself (Origin check).
- **Automatic deletion**: live tournaments and site tournaments are deleted 7 days after their last change, with their
  runs, players, audit log and screenshots. Pages Functions can't run on a timer, so the clear-out runs at most once an
  hour, started by ordinary visits. The copy in the host's own browser isn't touched.
- **Spam**: Turnstile on going live and on submitting a time; rate limits per connection (`lib/limits.js`: 10 live
  tournaments an hour, 120 changes a minute, 8 submissions per 10 minutes, 30 wrong codes per 10 minutes so codes
  can't be guessed); size limits (600 KB per request, 512 KB per tournament, 5 MB per screenshot, caps on every list
  and text field).
- **Words**: `lib/moderation.js` checks every public text (tournament, game, track, class, player, team and racer
  names, rules, messages, timer labels) against `lib/blocked-words.js`, after undoing l33t spelling, repeated letters
  and gaps. Word lists can be dodged by someone determined; delete anything that gets through from the admin page.
- **Input**: a shared tournament is rebuilt from known fields only (`cleanRecord`), so unexpected fields or types are
  never stored. Every SQL statement uses bound parameters. Screenshots must start with a real PNG/JPG/WebP signature
  and are served with `nosniff` and a sandboxing CSP.
- **Pages**: all text reaches the page as plain text (no `innerHTML`), and `_headers` sets a Content-Security-Policy
  that blocks inline and third-party scripts, plus `nosniff`, `X-Frame-Options` and a referrer policy.

## Running it locally

`npx wrangler pages dev . --d1 DB=<database id> --r2 PROOF` serves the site with the Functions. Apply the schema to the
local database first with `npx wrangler d1 execute <database name> --local --file functions/schema.sql`. Locally there's
no Cloudflare Access: put `DEV_ADMIN_EMAIL=you@example.com` in `.dev.vars` to use the admin page (never set it on the
real site).

## Notes

- Live rooms poll every 3 seconds (`POLL_MS` in `js/room.js`); an unchanged room answers with a tiny
  `{ unchanged: true }`, so a room with a few dozen viewers stays well inside D1's free limits.
- The Parking Garage Rally Circuit track names in `lib/presets.js` are placeholders (`US Track 1` …); rename them in
  a file or the organizer page.

Not affiliated with Walaber Entertainment.
