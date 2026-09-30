// PUT    /api/admin/tournaments/<id>: save changes to a tournament.
// DELETE /api/admin/tournaments/<id>: delete it with its runs, players, audit log and proof screenshots.
// Runs on tracks or classes that are renamed keep their old names; rename carefully once times are in.

import { json, fail, audit, actor, readJson } from '../../../../lib/api.js';
import { readTournament } from '../../../../lib/tournament-input.js';
import { deleteTournament } from '../../../../lib/cleanup.js';

export async function onRequestPut({ request, env, params, data }) {
  const id = Number(params.id);
  const before = await env.DB.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first();
  if (!before) return fail('No tournament with that id.', 404);
  const { error, values } = readTournament(await readJson(request));
  if (error) return fail(error);
  const taken = await env.DB.prepare('SELECT id FROM tournaments WHERE slug = ? AND id != ?').bind(values.slug, id).first();
  if (taken) return fail(`The link name "${values.slug}" is already used by another tournament.`);

  const cols = Object.keys(values);
  await env.DB.prepare(`UPDATE tournaments SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...Object.values(values), new Date().toISOString(), id).run();

  const changed = cols.filter(c => String(before[c] ?? '') !== String(values[c] ?? ''));
  if (changed.length) {
    await audit(env, { tournamentId: id, action: 'tournament', by: actor(request, data),
      detail: `Changed ${changed.join(', ')}`,
      before: Object.fromEntries(changed.map(c => [c, before[c]])),
      after: Object.fromEntries(changed.map(c => [c, values[c]])) }).run();
  }
  return json({ ok: true, changed });
}

export async function onRequestDelete({ env, params }) {
  const t = await env.DB.prepare('SELECT id, slug FROM tournaments WHERE id = ?').bind(Number(params.id)).first();
  if (!t) return fail('No tournament with that id.', 404);
  await deleteTournament(env, t);
  return json({ ok: true });
}
