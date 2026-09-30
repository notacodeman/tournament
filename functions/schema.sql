-- D1 schema for tournament.codeman.club. Paste into the D1 database's Console and run it once.

CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,              -- used in links: /tournament?t=<slug>
  name TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT '',
  preset TEXT NOT NULL DEFAULT 'custom',  -- 'pgrc' or 'custom'
  description TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'registration', 'live', 'finished')),
  scoring TEXT NOT NULL DEFAULT 'time' CHECK (scoring IN ('time', 'points')),
  points TEXT NOT NULL DEFAULT '[]',      -- JSON: points for 1st, 2nd… per event
  tracks TEXT NOT NULL DEFAULT '[]',      -- JSON: track or level names
  classes TEXT NOT NULL DEFAULT '[]',     -- JSON: car classes or categories
  events TEXT NOT NULL DEFAULT '[]',      -- JSON: [[track, class], …] that count
  platforms TEXT NOT NULL DEFAULT '[]',   -- JSON: platforms racers pick from
  proof TEXT NOT NULL DEFAULT 'screenshot' CHECK (proof IN ('screenshot', 'any', 'none')),
  no_cheats INTEGER NOT NULL DEFAULT 0,   -- 1: racers confirm no cheat codes were used
  starts_at TEXT,                         -- ISO time, UTC; optional
  ends_at TEXT,
  bracket TEXT,                           -- JSON: single-elimination bracket (lib/bracket.js), or NULL
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  racer TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  track TEXT NOT NULL,
  cls TEXT NOT NULL,
  time_ms INTEGER NOT NULL,
  penalty_ms INTEGER NOT NULL DEFAULT 0,
  penalty_note TEXT NOT NULL DEFAULT '',
  proof_key TEXT,                         -- screenshot in the PROOF R2 bucket
  video_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  reject_reason TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL UNIQUE,             -- secret for the racer's "check my run" link
  ip_hash TEXT NOT NULL DEFAULT '',       -- for rate limiting only
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT
);
CREATE INDEX IF NOT EXISTS runs_by_tournament ON runs (tournament_id, status);
CREATE INDEX IF NOT EXISTS runs_by_ip ON runs (ip_hash, submitted_at);

-- Who is playing. When a tournament has players, submissions must use one of these names.
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  name TEXT NOT NULL COLLATE NOCASE,
  team TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  seed INTEGER NOT NULL,                  -- order in the list, 1 = top seed
  UNIQUE (tournament_id, name)
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER,
  run_id INTEGER,
  action TEXT NOT NULL,                   -- submitted, verified, rejected, edited, penalty, reopened, entered, tournament
  detail TEXT NOT NULL DEFAULT '',
  by TEXT NOT NULL DEFAULT '',
  before TEXT,
  after TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_by_tournament ON audit (tournament_id, id);

-- Live rooms: a tournament from someone's browser, shared with a short code while it's being played.
-- data is the whole tournament record (same shape the page keeps in the browser); every change bumps version.
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,              -- viewer code, 6 characters
  edit_code TEXT UNIQUE,                  -- participant code, 8 characters; NULL when participants can't edit
  host_hash TEXT NOT NULL,                -- SHA-256 of the host key kept in the host's browser
  data TEXT NOT NULL,
  timer TEXT,                             -- JSON: shared race clock
  announce TEXT,                          -- JSON: { text, at } shown to viewers (wheel picks, "now racing")
  live INTEGER NOT NULL DEFAULT 1,        -- 0 once the host ends it; viewers still see the final standings
  version INTEGER NOT NULL DEFAULT 1,
  ip_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rooms_by_ip ON rooms (ip_hash, created_at);

-- Rate limits (lib/limits.js): a counter per hashed connection per time window.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window INTEGER NOT NULL,                -- unix seconds at the start of the window
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window)
);

-- Small settings the site keeps for itself, e.g. when old tournaments were last cleared out (lib/cleanup.js).
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rooms_by_updated ON rooms (updated_at);
