// GET /api/runs/<token>: one run, for the racer's private "check my run" link. Includes the reject reason.

import { json, fail, runOut } from '../../../lib/api.js';

export async function onRequestGet({ env, params }) {
  if (!/^[0-9a-f]{32}$/.test(params.token)) return fail('That link is not valid.', 404);
  const run = await env.DB.prepare(`SELECT r.*, t.slug, t.name AS tournament_name FROM runs r
    JOIN tournaments t ON t.id = r.tournament_id WHERE r.token = ?`).bind(params.token).first();
  if (!run) return fail('No run with that link.', 404);
  return json({ ok: true, run: { ...runOut(run), slug: run.slug, tournament_name: run.tournament_name } });
}
