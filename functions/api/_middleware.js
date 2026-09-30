// Runs before every /api/* route:
// - refuses request bodies over MAX_BODY_BYTES (MAX_UPLOAD_BYTES for a time submission with a screenshot),
// - turns a missing database setup into a message the pages can show, instead of Cloudflare's bare 500 page,
// - hides internal error details from the public (the admin page still sees them),
// - starts the hourly clear-out of tournaments untouched for a week (lib/cleanup.js), after the response is sent.

import { fail } from '../../lib/api.js';
import { maybeSweep } from '../../lib/cleanup.js';

const MAX_BODY_BYTES = 600 * 1024;
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

export async function onRequest({ env, next, request, waitUntil }) {
  const path = new URL(request.url).pathname;
  const isAdmin = path.startsWith('/api/admin/');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const limit = /\/submit$/.test(path) ? MAX_UPLOAD_BYTES : MAX_BODY_BYTES;
    // browsers always send Content-Length for these bodies; lib/api.js readJson re-checks the real size
    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > limit) return fail(`That request is too big (limit ${Math.round(limit / 1024)} KB).`, 413);
  }
  if (!env.DB) {
    return fail('The site has no D1 database bound as DB. In the Pages project: Settings → Bindings → add a D1 ' +
      'database binding named DB, then redeploy.', 500);
  }
  try {
    const response = await next();
    waitUntil(maybeSweep(env).catch(err => console.error('sweep failed', err)));
    return response;
  } catch (err) {
    const message = String(err && err.message || err);
    console.error(path, message);
    if (/no such table/i.test(message)) {
      return fail(`The database is missing tables. Paste functions/schema.sql into the D1 database's Console and run it. (${message})`, 500);
    }
    return fail(isAdmin ? message : 'Something went wrong on the server. Try again in a moment.', 500);
  }
}
