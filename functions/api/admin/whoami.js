// GET /api/admin/whoami: who's signed in. /admin and /api/admin/* are protected by Cloudflare Access, which makes the
// visitor sign in and passes on their email. With ?next=/admin it sends the browser back there afterwards, which is
// how the admin page's Sign in button works.

import { json } from '../../../lib/api.js';

function tokenEmail(request) {
  try {
    const payload = request.headers.get('Cf-Access-Jwt-Assertion').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).email || null;
  } catch (_) {
    return null;
  }
}

export async function onRequestGet({ request }) {
  const email = request.headers.get('Cf-Access-Authenticated-User-Email') || tokenEmail(request);
  if (!email) {
    return json({
      ok: false,
      error: "This request didn't come through Cloudflare Access, so /api/admin/* isn't protected. Add /admin and " +
        '/api/admin/* to the Access application for tournament.codeman.club.',
    }, 403);
  }
  const url = new URL(request.url);
  const next = url.searchParams.get('next');
  if (next && /^\/(?!\/)/.test(next)) return Response.redirect(new URL(next, url).toString(), 302);
  return json({ ok: true, email });
}
