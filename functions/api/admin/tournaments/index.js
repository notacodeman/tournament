// GET  /api/admin/tournaments: every tournament, drafts included, with how many runs wait for review.
// POST /api/admin/tournaments: create one. Protected by Cloudflare Access.

import { json, fail, audit, actor, tournamentOut, readJson } from '../../../../lib/api.js';
import { readTournament } from '../../../../lib/tournament-input.js';

export async function onRequestGet({ env, data }) {
  const { results } = await env.DB.prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM runs r WHERE r.tournament_id = t.id AND r.status = 'pending') AS pending
    FROM tournaments t ORDER BY t.id DESC
  `).all();
  return json({ ok: true, tournaments: results.map(row => ({ ...tournamentOut(row), pending: row.pending })) });
}

export async function onRequestPost({ request, env, data }) {
  const { error, values } = readTournament(await readJson(request));
  if (error) return fail(error);
  const taken = await env.DB.prepare('SELECT id FROM tournaments WHERE slug = ?').bind(values.slug).first();
  if (taken) return fail(`The link name "${values.slug}" is already used by another tournament.`);
  const now = new Date().toISOString();
  const cols = Object.keys(values);
  const result = await env.DB.prepare(
    `INSERT INTO tournaments (${cols.join(', ')}, created_at, updated_at) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`
  ).bind(...Object.values(values), now, now).run();
  const id = result.meta.last_row_id;
  await audit(env, { tournamentId: id, action: 'tournament', by: actor(request, data), detail: `Created "${values.name}"`, after: values }).run();
  return json({ ok: true, id });
}
