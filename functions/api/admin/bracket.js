// PUT /api/admin/bracket { tournament_id, bracket }: saves the tournament's bracket (built and scored on the admin
// page with lib/bracket.js). bracket: null removes it. Protected by Cloudflare Access.

import { json, fail, audit, actor, readJson } from '../../../lib/api.js';
import { checkBracket, propagate, champion } from '../../../lib/bracket.js';

export async function onRequestPut({ env, request, data }) {
  const body = await readJson(request);
  const tournamentId = Number(body?.tournament_id);
  const t = tournamentId && await env.DB.prepare('SELECT id, bracket FROM tournaments WHERE id = ?').bind(tournamentId).first();
  if (!t) return fail('No tournament with that id.', 404);

  let bracket = null;
  if (body.bracket !== null) {
    const error = checkBracket(body.bracket);
    if (error) return fail(error);
    // settle it server-side too, so a hand-edited request can't leave winners that don't follow from results
    bracket = propagate(body.bracket);
  }
  const text = bracket ? JSON.stringify(bracket) : null;
  if (text === t.bracket) return json({ ok: true, unchanged: true });
  await env.DB.batch([
    env.DB.prepare('UPDATE tournaments SET bracket = ?, updated_at = ? WHERE id = ?').bind(text, new Date().toISOString(), tournamentId),
    audit(env, { tournamentId, action: 'bracket', by: actor(request, data),
      detail: !bracket ? 'Bracket removed' : !t.bracket ? `Bracket created (${bracket.entrants.length} ${bracket.kind})`
        : champion(bracket) ? `Bracket updated · champion ${champion(bracket)}` : 'Bracket updated' }),
  ]);
  return json({ ok: true, bracket });
}
