// GET /api/config: public settings the pages need, e.g. the Turnstile site key (empty when Turnstile is off).

import { json } from '../../lib/api.js';

export async function onRequestGet({ env }) {
  return json({ ok: true, turnstile_site_key: env.TURNSTILE_SITE_KEY || '' }, 200, { 'Cache-Control': 'public, max-age=300' });
}
