// Runs before every /api/* route. Turns a missing database or bucket setup into a message the pages can show,
// instead of Cloudflare's bare 500 page.

import { fail } from '../../lib/api.js';

export async function onRequest({ env, next, request }) {
  const path = new URL(request.url).pathname;
  if (!path.endsWith('/whoami') && !env.DB) {
    return fail('The site has no D1 database bound as DB. In the Pages project: Settings → Bindings → add a D1 ' +
      'database binding named DB, then redeploy.', 500);
  }
  try {
    return await next();
  } catch (err) {
    const message = String(err && err.message || err);
    if (/no such table/i.test(message)) {
      return fail(`The database has no tables yet. Paste functions/schema.sql into the D1 database's Console and run it. (${message})`, 500);
    }
    return fail(message, 500);
  }
}
