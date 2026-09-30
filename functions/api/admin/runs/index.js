// GET  /api/admin/runs?t=<tournament id>&status=pending|verified|rejected|all: runs for the verification queue and
//      the All runs tab, oldest first for pending (the queue order), newest first otherwise.
// POST /api/admin/runs: the organizer enters a time directly (a live event, or one read off a stream). It's verified
//      straight away. Protected by Cloudflare Access.

import { json, fail, audit, actor, runOut, tournamentOut, rosterName, readJson } from '../../../../lib/api.js';
import { parseTime, formatTime } from '../../../../lib/time.js';

export async function onRequestGet({ env, request, data }) {
  const url = new URL(request.url);
  const tournamentId = Number(url.searchParams.get('t'));
  const status = url.searchParams.get('status') || 'pending';
  if (!tournamentId) return fail('Pick a tournament.');
  const where = status === 'all' ? '' : 'AND status = ?';
  const order = status === 'pending' ? 'submitted_at ASC' : 'submitted_at DESC';
  const stmt = env.DB.prepare(`SELECT * FROM runs WHERE tournament_id = ? ${where} ORDER BY ${order} LIMIT 1000`);
  const { results } = await (status === 'all' ? stmt.bind(tournamentId) : stmt.bind(tournamentId, status)).all();
  // the racer's previous verified best on the same event, to show next to a pending time
  const best = await env.DB.prepare(`SELECT lower(trim(racer)) AS rk, track, cls, MIN(time_ms + penalty_ms) AS best
    FROM runs WHERE tournament_id = ? AND status = 'verified' GROUP BY rk, track, cls`).bind(tournamentId).all();
  const bests = new Map(best.results.map(b => [`${b.rk}|${b.track}|${b.cls}`, b.best]));
  return json({
    ok: true,
    runs: results.map(r => ({ ...runOut(r), reviewed_by: r.reviewed_by,
      previous_best: bests.get(`${r.racer.trim().toLowerCase()}|${r.track}|${r.cls}`) ?? null })),
  });
}

export async function onRequestPost({ request, env, data }) {
  const body = await readJson(request);
  if (!body) return fail('Expected the run as JSON.');
  const row = await env.DB.prepare('SELECT * FROM tournaments WHERE id = ?').bind(Number(body.tournament_id)).first();
  if (!row) return fail('No tournament with that id.', 404);
  const t = tournamentOut(row);
  let racer = String(body.racer || '').trim().replace(/\s+/g, ' ');
  const timeMs = parseTime(body.time);
  const penaltyMs = Math.round(Number(body.penalty_s || 0) * 1000);
  if (!racer || racer.length > 32) return fail('Enter the racer name (up to 32 characters).');
  racer = await rosterName(env, t.id, racer);
  if (!racer) return fail("That racer isn't on the player list. Add them on the Players tab first.");
  if (!t.events.some(([et, ec]) => et === body.track && ec === body.cls)) return fail("That track and class don't count in this tournament.");
  if (!timeMs) return fail('Enter the time as m:ss.mmm, for example 1:04.777.');
  if (!Number.isFinite(penaltyMs) || penaltyMs < 0) return fail('The penalty has to be 0 or more seconds.');

  const by = actor(request, data);
  const now = new Date().toISOString();
  const token = crypto.randomUUID().replace(/-/g, '');
  const result = await env.DB.prepare(`INSERT INTO runs (tournament_id, racer, platform, track, cls, time_ms, penalty_ms, penalty_note,
      video_url, status, token, submitted_at, reviewed_at, reviewed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?)`)
    .bind(t.id, racer, String(body.platform || ''), body.track, body.cls, timeMs, penaltyMs, String(body.penalty_note || ''),
      body.video_url || null, token, now, now, by).run();
  const runId = result.meta.last_row_id;
  await audit(env, { tournamentId: t.id, runId, action: 'entered', by,
    detail: `${racer}: ${formatTime(timeMs)} on ${body.track} · ${body.cls} entered by the organizer` }).run();
  return json({ ok: true, id: runId });
}
