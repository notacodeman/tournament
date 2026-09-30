// POST /api/rooms/<code>/ops { op, by, … }: one change to a live tournament (lib/room.js lists them and who may
// send each). Retries when two people change it at the same moment, so neither change is lost.

import { json, fail, readJson } from '../../../../lib/api.js';
import { applyOp, findRoom, MAX_DATA_BYTES } from '../../../../lib/room.js';
import { overLimit, limitMessage } from '../../../../lib/limits.js';

const RETRIES = 4;

export async function onRequestPost({ env, request, params }) {
  const body = await readJson(request);
  if (!body?.op) return fail('Expected a change.');
  if (await overLimit(env, request, 'roomOp')) return fail(limitMessage('roomOp'), 429);
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const { room, role } = await findRoom(env, request, params.code);
    if (!room) return fail('No live tournament with that code.', 404);
    let change;
    try {
      change = applyOp({ data: JSON.parse(room.data), live: !!room.live }, body, role, env.BLOCKED_WORDS);
    } catch (err) {
      return fail(err.message, 403);
    }
    const data = change.data ? JSON.stringify(change.data) : room.data;
    if (data.length > MAX_DATA_BYTES) return fail('The tournament is too big (over 512 KB).');
    const next = {
      data,
      timer: 'timer' in change ? JSON.stringify(change.timer) : room.timer,
      announce: 'announce' in change ? (change.announce ? JSON.stringify(change.announce) : null) : room.announce,
      live: 'live' in change ? change.live : room.live,
      edit_code: 'editCode' in change ? change.editCode : room.edit_code,
    };
    const result = await env.DB.prepare(`UPDATE rooms SET data = ?, timer = ?, announce = ?, live = ?, edit_code = ?,
        version = version + 1, updated_at = ? WHERE id = ? AND version = ?`)
      .bind(next.data, next.timer, next.announce, next.live, next.edit_code, new Date().toISOString(), room.id, room.version).run();
    if (result.meta.changes) return json({ ok: true, version: room.version + 1, edit_code: role === 'host' ? next.edit_code : undefined });
  }
  return fail('Lots of changes at once. Try again.', 409);
}
