// DELETE /api/admin/rooms/<code>: deletes a live tournament from the site. Its viewers and participants lose it at once;
// the host keeps the copy saved in their own browser.

import { json, fail } from '../../../../lib/api.js';
import { cleanCode } from '../../../../lib/room.js';

export async function onRequestDelete({ env, params }) {
  const result = await env.DB.prepare('DELETE FROM rooms WHERE code = ?').bind(cleanCode(params.code)).run();
  if (!result.meta.changes) return fail('No room with that code.', 404);
  return json({ ok: true });
}
