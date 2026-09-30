// GET /api/admin/players?t=<tournament id>: the tournament's players in seed order.
// PUT /api/admin/players { tournament_id, players: [{ name, team, platform }] }: replaces the whole list; the order
//     sent is the seed order. Protected by Cloudflare Access.

import { json, fail, audit, actor, readJson } from '../../../lib/api.js';

const MAX_PLAYERS = 256;

export async function onRequestGet({ env, request, data }) {
  const tournamentId = Number(new URL(request.url).searchParams.get('t'));
  if (!tournamentId) return fail('Pick a tournament.');
  const { results } = await env.DB.prepare('SELECT name, team, platform, seed FROM players WHERE tournament_id = ? ORDER BY seed')
    .bind(tournamentId).all();
  return json({ ok: true, players: results });
}

export async function onRequestPut({ env, request, data }) {
  const body = await readJson(request);
  const tournamentId = Number(body?.tournament_id);
  const t = tournamentId && await env.DB.prepare('SELECT id FROM tournaments WHERE id = ?').bind(tournamentId).first();
  if (!t) return fail('No tournament with that id.', 404);
  if (!Array.isArray(body.players) || body.players.length > MAX_PLAYERS) return fail(`Send up to ${MAX_PLAYERS} players.`);

  const seen = new Set();
  const players = [];
  for (const p of body.players) {
    const name = String(p?.name || '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    if (name.length > 32) return fail(`"${name}" is over 32 characters.`);
    if (seen.has(name.toLowerCase())) return fail(`"${name}" is in the list twice.`);
    seen.add(name.toLowerCase());
    players.push({ name, team: String(p.team || '').trim().slice(0, 40), platform: String(p.platform || '').trim().slice(0, 20) });
  }

  const before = (await env.DB.prepare('SELECT name, team, platform FROM players WHERE tournament_id = ? ORDER BY seed').bind(tournamentId).all()).results;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM players WHERE tournament_id = ?').bind(tournamentId),
    ...players.map((p, i) => env.DB.prepare('INSERT INTO players (tournament_id, name, team, platform, seed) VALUES (?, ?, ?, ?, ?)')
      .bind(tournamentId, p.name, p.team, p.platform, i + 1)),
    audit(env, { tournamentId, action: 'players', by: actor(request, data), detail: `Player list saved (${players.length})`, before, after: players }),
  ]);
  return json({ ok: true, count: players.length });
}
