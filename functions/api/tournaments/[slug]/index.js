// GET /api/tournaments/<slug>: the tournament (with its bracket), its players, its verified runs (standings are worked out in the browser with
// lib/standings.js), how many runs wait for review, and recent public activity.

import { json, fail, tournamentOut, runOut, acceptsRuns } from '../../../../lib/api.js';

// Audit actions that show on the public Activity tab. Rejections stay between the racer and the organizer.
const PUBLIC_ACTIONS = ['submitted', 'verified', 'penalty', 'entered', 'edited', 'bracket'];

export async function onRequestGet({ env, params }) {
  const row = await env.DB.prepare("SELECT * FROM tournaments WHERE slug = ? AND status != 'draft'").bind(params.slug).first();
  if (!row) return fail('No tournament with that link.', 404);
  const [runs, pending, activity, players] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM runs WHERE tournament_id = ? AND status = 'verified'").bind(row.id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM runs WHERE tournament_id = ? AND status = 'pending'").bind(row.id),
    env.DB.prepare(`SELECT action, detail, at FROM audit WHERE tournament_id = ? AND action IN (${PUBLIC_ACTIONS.map(() => '?').join(',')})
      ORDER BY id DESC LIMIT 30`).bind(row.id, ...PUBLIC_ACTIONS),
    env.DB.prepare('SELECT name, team, platform, seed FROM players WHERE tournament_id = ? ORDER BY seed').bind(row.id),
  ]);
  const tournament = tournamentOut(row);
  return json({
    ok: true,
    tournament: { ...tournament, accepts_runs: acceptsRuns(tournament) },
    runs: runs.results.map(runOut),
    pending: pending.results[0].n,
    players: players.results,
    activity: activity.results,
    now: new Date().toISOString(),
  });
}
