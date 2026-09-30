// Runs before every /api/admin/* route, after /api/_middleware.js. Only the emails in ADMIN_EMAILS, signed in through
// Cloudflare Access, get past it (lib/access.js checks the signed token). Changes must also come from this site's own
// pages (Origin check), so another site can't make a signed-in browser send them.

import { fail } from '../../../lib/api.js';
import { checkAdmin } from '../../../lib/access.js';

export async function onRequest({ request, env, next, data }) {
  const who = await checkAdmin(request, env);
  if (who.error) return fail(who.error, who.status);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('Origin');
    if (!origin || new URL(origin).host !== new URL(request.url).host) return fail('Admin changes have to come from the admin page itself.', 403);
  }
  data.adminEmail = who.email;
  return next();
}
