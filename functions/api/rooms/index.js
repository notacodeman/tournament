// POST /api/rooms { record, participants }: puts a tournament from the host's browser live under a short code.
// Returns { code, edit_code, host_key }. The host key is only ever returned here; the host's browser keeps it.

import { json, fail } from '../../../lib/api.js';
import { makeCode, sha256, checkRecord, VIEW_CODE_LENGTH, EDIT_CODE_LENGTH, MAX_DATA_BYTES } from '../../../lib/room.js';

// rooms one connection can open per hour
const ROOMS_PER_HOUR = 10;

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const error = checkRecord(body?.record);
  if (error) return fail(error);
  const data = JSON.stringify(body.record);
  if (data.length > MAX_DATA_BYTES) return fail('That tournament is too big to share (over 512 KB).');

  const ipHash = await sha256(`rooms|${request.headers.get('CF-Connecting-IP') || ''}`);
  const since = new Date(Date.now() - 3600000).toISOString();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM rooms WHERE ip_hash = ? AND created_at > ?').bind(ipHash, since).first();
  if (recent.n >= ROOMS_PER_HOUR) return fail('Too many live tournaments started from here in the last hour. Try again later.', 429);

  const hostKey = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  // codes are random; on the rare clash, try again
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode(VIEW_CODE_LENGTH);
    const editCode = body.participants ? makeCode(EDIT_CODE_LENGTH) : null;
    try {
      await env.DB.prepare(`INSERT INTO rooms (code, edit_code, host_hash, data, ip_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(code, editCode, await sha256(hostKey), data, ipHash, now, now).run();
      return json({ ok: true, code, edit_code: editCode, host_key: hostKey });
    } catch (err) {
      if (!/unique/i.test(String(err.message))) throw err;
    }
  }
  return fail('Couldn’t make a free code. Try again.', 500);
}
