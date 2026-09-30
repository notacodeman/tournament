// Rate limits kept in D1: a counter per key per time window. Keys are hashed, so no IP addresses are stored.
// Every public write goes through one of these; see LIMITS for the numbers.

import { sha256 } from './room.js';

// [max requests, window in seconds] per connection
export const LIMITS = {
  roomCreate: [10, 3600],     // start a live tournament
  roomOp: [120, 60],          // changes to a live tournament
  roomMiss: [30, 600],        // looking up a code that doesn't exist (stops guessing codes)
  submit: [8, 600],           // submit a time to a site tournament
};

export async function ipKey(request, bucket) {
  return `${bucket}:${(await sha256(`${bucket}|${request.headers.get('CF-Connecting-IP') || ''}`)).slice(0, 32)}`;
}

// Counts this request and says whether it's over the limit.
export async function overLimit(env, request, bucket) {
  const [max, windowSec] = LIMITS[bucket];
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`INSERT INTO rate_limits (key, window, count) VALUES (?, ?, 1)
      ON CONFLICT (key, window) DO UPDATE SET count = count + 1 RETURNING count`)
    .bind(await ipKey(request, bucket), now - (now % windowSec)).first();
  return row.count > max;
}

export const limitMessage = bucket => {
  const minutes = Math.ceil(LIMITS[bucket][1] / 60);
  return `Too many requests from your connection. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
};
