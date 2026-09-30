// GET /api/admin/rooms: every live tournament (room), newest change first, with when it will be deleted automatically.

import { json } from '../../../../lib/api.js';
import { RETENTION_DAYS } from '../../../../lib/cleanup.js';

export async function onRequestGet({ env }) {
  const days = Number(env.RETENTION_DAYS) || RETENTION_DAYS;
  const { results } = await env.DB.prepare(`SELECT code, edit_code, live, created_at, updated_at, length(data) AS bytes,
      json_extract(data, '$.tournament.name') AS name, json_extract(data, '$.tournament.game') AS game,
      json_array_length(data, '$.players') AS players, json_array_length(data, '$.runs') AS runs
    FROM rooms ORDER BY updated_at DESC LIMIT 500`).all();
  return json({
    ok: true, retention_days: days,
    rooms: results.map(r => ({ ...r, live: !!r.live, participants: !!r.edit_code, edit_code: undefined,
      deletes_at: new Date(new Date(r.updated_at).getTime() + days * 86400000).toISOString() })),
  });
}
