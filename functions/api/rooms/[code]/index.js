// GET /api/rooms/<code>[?since=<version>]: a live tournament. <code> is its viewer, participant or mod code;
// the X-Host-Key header makes it the host. With ?since and nothing new, returns { unchanged: true } (cheap polling).

import { json, fail } from '../../../../lib/api.js';
import { findRoom } from '../../../../lib/room.js';
import { overLimit, limitMessage } from '../../../../lib/limits.js';

export async function onRequestGet({ env, request, params }) {
  const { room, role } = await findRoom(env, request, params.code);
  if (!room) {
    // only wrong codes count here, so polling a real room is never limited but guessing codes is
    if (await overLimit(env, request, 'roomMiss')) return fail(limitMessage('roomMiss'), 429);
    return fail('No live tournament with that code. Check it and try again.', 404);
  }
  const since = Number(new URL(request.url).searchParams.get('since'));
  const now = Date.now();
  if (since && since === room.version) return json({ ok: true, unchanged: true, version: room.version, server_now: now });
  return json({
    ok: true, role, version: room.version, live: !!room.live, server_now: now,
    code: room.code,
    // the codes a role may hand out: mods and the host see all three, participants and viewers only the viewer code
    edit_code: role === 'host' || role === 'mod' ? room.edit_code : undefined,
    mod_code: role === 'host' || role === 'mod' ? room.mod_code : undefined,
    data: JSON.parse(room.data),
    timer: room.timer ? JSON.parse(room.timer) : null,
    announce: room.announce ? JSON.parse(room.announce) : null,
    updated_at: room.updated_at,
  });
}
