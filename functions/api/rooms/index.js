// POST /api/rooms { record, turnstile }: puts a tournament from the host's browser live. Returns its three codes
// (viewer, participant, mod) and the host key: { code, edit_code, mod_code, host_key }. The host key is only ever returned here; the host's browser keeps it.
// Checks: Turnstile (when set up), a rate limit per connection, and lib/room.js cleanRecord (shape, sizes, words).

import { json, fail, readJson } from '../../../lib/api.js';
import { makeCode, sha256, cleanRecord, VIEW_CODE_LENGTH, EDIT_CODE_LENGTH, MOD_CODE_LENGTH, MAX_DATA_BYTES } from '../../../lib/room.js';
import { overLimit, limitMessage } from '../../../lib/limits.js';
import { verifyTurnstile, TURNSTILE_FAILED } from '../../../lib/turnstile.js';

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return fail('Expected the tournament as JSON.');
  if (await overLimit(env, request, 'roomCreate')) return fail(limitMessage('roomCreate'), 429);
  if (!await verifyTurnstile(request, env, body.turnstile)) return fail(TURNSTILE_FAILED, 403);
  const { record, error } = cleanRecord(body.record, env.BLOCKED_WORDS);
  if (error) return fail(error);
  record.activity = [{ action: 'room', detail: 'Went live', at: new Date().toISOString() }];
  const data = JSON.stringify(record);
  if (data.length > MAX_DATA_BYTES) return fail('That tournament is too big to share (over 512 KB).');

  const hostKey = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  // codes are random; on the rare clash, try again
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode(VIEW_CODE_LENGTH);
    const editCode = makeCode(EDIT_CODE_LENGTH);
    const modCode = makeCode(MOD_CODE_LENGTH);
    try {
      await env.DB.prepare(`INSERT INTO rooms (code, edit_code, mod_code, host_hash, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(code, editCode, modCode, await sha256(hostKey), data, now, now).run();
      return json({ ok: true, code, edit_code: editCode, mod_code: modCode, host_key: hostKey, record });
    } catch (err) {
      if (!/unique/i.test(String(err.message))) throw err;
    }
  }
  return fail('Couldn’t make a free code. Try again.', 500);
}
