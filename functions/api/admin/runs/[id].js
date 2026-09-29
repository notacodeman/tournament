// POST /api/admin/runs/<id> { action, … }: act on one run. Protected by Cloudflare Access.
//   verify  { time?, penalty_s?, penalty_note? }  correct the time or add a penalty while verifying
//   reject  { reason }                            the racer sees the reason on their run link
//   reopen  {}                                    back to pending
//   update  { time?, penalty_s?, penalty_note?, racer?, platform? }  fix a run without changing its status
// Every change is written to the audit log with the values before and after.

import { json, fail, audit, actor } from '../../../../lib/api.js';
import { parseTime, formatTime } from '../../../../lib/time.js';

const EDITABLE = ['time_ms', 'penalty_ms', 'penalty_note', 'racer', 'platform'];

export async function onRequestPost({ request, env, params }) {
  const run = await env.DB.prepare('SELECT * FROM runs WHERE id = ?').bind(Number(params.id)).first();
  if (!run) return fail('No run with that id.', 404);
  const body = await request.json().catch(() => null);
  if (!body) return fail('Expected JSON.');
  const by = actor(request);
  const now = new Date().toISOString();

  // field changes shared by verify and update
  const changes = {};
  if (body.time !== undefined && body.time !== '') {
    const ms = parseTime(body.time);
    if (!ms) return fail('Enter the time as m:ss.mmm, for example 1:04.777.');
    changes.time_ms = ms;
  }
  if (body.penalty_s !== undefined && body.penalty_s !== '') {
    const ms = Math.round(Number(body.penalty_s) * 1000);
    if (!Number.isFinite(ms) || ms < 0) return fail('The penalty has to be 0 or more seconds.');
    changes.penalty_ms = ms;
  }
  if (body.penalty_note !== undefined) changes.penalty_note = String(body.penalty_note).trim().slice(0, 200);
  if (body.racer !== undefined) {
    const racer = String(body.racer).trim().replace(/\s+/g, ' ');
    if (!racer || racer.length > 32) return fail('Racer names are 1–32 characters.');
    changes.racer = racer;
  }
  if (body.platform !== undefined) changes.platform = String(body.platform).trim();
  for (const key of Object.keys(changes)) if (String(changes[key]) === String(run[key])) delete changes[key];

  let status = run.status;
  let reason = run.reject_reason;
  if (body.action === 'verify') status = 'verified';
  else if (body.action === 'reopen') status = 'pending';
  else if (body.action === 'reject') {
    reason = String(body.reason || '').trim().slice(0, 300);
    if (!reason) return fail('Say why the run is rejected; the racer sees it.');
    status = 'rejected';
  } else if (body.action !== 'update') return fail('Unknown action.');
  if (body.action === 'update' && !Object.keys(changes).length) return fail('Nothing changed.');
  if (body.action !== 'reject') reason = status === 'rejected' ? reason : '';

  const next = { ...run, ...changes, status, reject_reason: reason };
  await env.DB.prepare(`UPDATE runs SET ${EDITABLE.map(c => `${c} = ?`).join(', ')}, status = ?, reject_reason = ?,
      reviewed_at = ?, reviewed_by = ? WHERE id = ?`)
    .bind(...EDITABLE.map(c => next[c]), status, reason, now, by, run.id).run();

  const label = `${next.racer}: ${formatTime(next.time_ms)} on ${run.track} · ${run.cls}`;
  const entries = [];
  const before = Object.fromEntries(Object.keys(changes).map(k => [k, run[k]]));
  if (changes.penalty_ms !== undefined && changes.penalty_ms > 0) {
    entries.push(['penalty', `${next.racer}: +${(changes.penalty_ms / 1000).toFixed(3)} s penalty on ${run.track} · ${run.cls}` +
      (next.penalty_note ? ` (${next.penalty_note})` : '')]);
  }
  const otherChanges = Object.keys(changes).filter(k => k !== 'penalty_ms' && k !== 'penalty_note');
  if (otherChanges.length) entries.push(['edited', `${label}: organizer changed ${otherChanges.join(', ').replace('time_ms', 'time')}`]);
  if (status !== run.status) {
    const action = { verified: 'verified', rejected: 'rejected', pending: 'reopened' }[status];
    entries.push([action, status === 'rejected' ? `${label} rejected: ${reason}` : `${label} ${action}`]);
  }
  if (entries.length) {
    await env.DB.batch(entries.map(([action, detail]) => audit(env, {
      tournamentId: run.tournament_id, runId: run.id, action, detail, by,
      before: { ...before, status: run.status }, after: { ...changes, status },
    })));
  }
  return json({ ok: true, status });
}
