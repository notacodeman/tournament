// GET /api/admin/whoami: who's signed in. functions/api/admin/_middleware.js has already checked the Access token and
// the email allowlist. With ?next=/admin it sends the browser back there afterwards (the admin page's Sign in button).

import { json } from '../../../lib/api.js';

export async function onRequestGet({ request, data }) {
  const url = new URL(request.url);
  const next = url.searchParams.get('next');
  if (next && /^\/(?!\/)/.test(next)) return Response.redirect(new URL(next, url).toString(), 302);
  return json({ ok: true, email: data.adminEmail });
}
