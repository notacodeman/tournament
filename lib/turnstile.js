// Cloudflare Turnstile: an invisible check that a request came from a person's browser, not a script.
// Used when starting a live tournament and when submitting a time. Off until TURNSTILE_SECRET is set (and
// TURNSTILE_SITE_KEY, which the pages read from /api/config).

export async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', String(token).slice(0, 2048));
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const out = await res.json().catch(() => ({}));
  return !!out.success;
}

export const TURNSTILE_FAILED = 'The “are you a person” check didn’t pass. Reload the page and try again.';
