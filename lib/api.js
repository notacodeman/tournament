// Helpers for the Pages Functions under functions/api. Kept outside functions/ so Pages doesn't turn it into a route.

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export const fail = (error, status = 400) => json({ ok: false, error }, status);

// A JSON body, refusing anything over maxBytes whatever the headers said. Returns null when it isn't valid JSON.
export async function readJson(request, maxBytes = 600 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch (_) {
    return null;
  }
}

// Who is signed in (admin routes only): the email functions/api/admin/_middleware.js verified.
export function actor(request, data) {
  if (data?.adminEmail) return data.adminEmail;
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (email) return email;
  try {
    const payload = request.headers.get('Cf-Access-Jwt-Assertion').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).email || 'admin';
  } catch (_) {
    return 'admin';
  }
}

// One line in the audit log. `detail` is shown as written; `before`/`after` keep the changed values.
export const audit = (env, { tournamentId, runId = null, action, detail = '', by = '', before = null, after = null }) =>
  env.DB.prepare('INSERT INTO audit (tournament_id, run_id, action, detail, by, before, after, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(tournamentId, runId, action, detail, by, before && JSON.stringify(before), after && JSON.stringify(after), new Date().toISOString());

// JSON columns of a tournament row, parsed. Used by every route that returns tournaments.
export function tournamentOut(row) {
  if (!row) return null;
  const parse = (v, d) => { try { return JSON.parse(v); } catch (_) { return d; } };
  return {
    id: row.id, slug: row.slug, name: row.name, game: row.game, preset: row.preset,
    description: row.description, rules: row.rules, status: row.status,
    scoring: row.scoring, points: parse(row.points, []),
    tracks: parse(row.tracks, []), classes: parse(row.classes, []), events: parse(row.events, []),
    platforms: parse(row.platforms, []), proof: row.proof, no_cheats: !!row.no_cheats,
    starts_at: row.starts_at, ends_at: row.ends_at, updated_at: row.updated_at,
    bracket: row.bracket ? parse(row.bracket, null) : null,
  };
}

// The fields of a run anyone may see. Leaves out the submitter's IP hash and status token.
export const runOut = r => ({
  id: r.id, racer: r.racer, platform: r.platform, track: r.track, cls: r.cls,
  time_ms: r.time_ms, penalty_ms: r.penalty_ms, penalty_note: r.penalty_note,
  proof_key: r.proof_key, video_url: r.video_url, status: r.status, reject_reason: r.reject_reason,
  submitted_at: r.submitted_at, reviewed_at: r.reviewed_at,
});

// The canonical name from the tournament's player list (matching ignores case), null when the list has players but
// not this one, or the name as given when the tournament has no list.
export async function rosterName(env, tournamentId, name) {
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM players WHERE tournament_id = ?').bind(tournamentId).first();
  if (!count.n) return name;
  const row = await env.DB.prepare('SELECT name FROM players WHERE tournament_id = ? AND name = ? COLLATE NOCASE').bind(tournamentId, name).first();
  return row ? row.name : null;
}

// Tournaments take submissions while live and inside their dates (dates are optional).
export function acceptsRuns(t, now = new Date().toISOString()) {
  if (t.status !== 'live') return false;
  if (t.starts_at && now < t.starts_at) return false;
  if (t.ends_at && now > t.ends_at) return false;
  return true;
}
