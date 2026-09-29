// GET /api/tournaments: every tournament that isn't a draft, with racer and run counts, for the splash page.
// Racers = the player list when there is one, else everyone with a verified time.

import { json, tournamentOut } from '../../../lib/api.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM players p WHERE p.tournament_id = t.id) AS player_count,
      (SELECT COUNT(DISTINCT lower(trim(racer))) FROM runs r WHERE r.tournament_id = t.id AND r.status = 'verified') AS racer_count,
      (SELECT COUNT(*) FROM runs r WHERE r.tournament_id = t.id AND r.status = 'verified') AS run_count
    FROM tournaments t
    WHERE t.status != 'draft'
    ORDER BY CASE t.status WHEN 'live' THEN 0 WHEN 'registration' THEN 1 ELSE 2 END, COALESCE(t.ends_at, t.updated_at) DESC
  `).all();
  const tournaments = results.map(row => ({ ...tournamentOut(row), racer_count: row.player_count || row.racer_count, run_count: row.run_count }));
  return json({ ok: true, tournaments });
}
