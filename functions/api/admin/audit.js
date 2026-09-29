// GET /api/admin/audit?t=<tournament id>: the last 300 changes to a tournament and its runs, newest first.
// Protected by Cloudflare Access. View-only: nothing edits or deletes the log.

import { json, fail } from '../../../lib/api.js';

export async function onRequestGet({ env, request }) {
  const tournamentId = Number(new URL(request.url).searchParams.get('t'));
  if (!tournamentId) return fail('Pick a tournament.');
  const { results } = await env.DB.prepare('SELECT * FROM audit WHERE tournament_id = ? ORDER BY id DESC LIMIT 300')
    .bind(tournamentId).all();
  return json({ ok: true, rows: results });
}
