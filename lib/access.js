// Checking that an admin request really comes from an allowed person through Cloudflare Access.
//
// Access puts a signed token (a JWT) on every request it lets through. We check its signature against the team's
// public keys, that it was made for this application (AUD), that it hasn't expired, and that its email is on the
// ADMIN_EMAILS list. So a missed path in the Access app, the pages.dev address, or a faked header can't get in.
//
// Environment variables (Pages project → Settings → Variables and secrets):
//   ACCESS_TEAM_DOMAIN  e.g. codeman.cloudflareaccess.com (Zero Trust → Settings → Custom Pages shows the team name)
//   ACCESS_AUD          the Access application's "Application Audience (AUD) Tag"
//   ADMIN_EMAILS        comma-separated, e.g. codemanj94@gmail.com
//   DEV_ADMIN_EMAIL     local development only (.dev.vars): skips the check and acts as this email

const KEYS_TTL_MS = 60 * 60 * 1000;
let keyCache = { domain: null, at: 0, keys: [] };

const b64urlBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const b64urlJson = s => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function teamKeys(domain, force = false) {
  if (!force && keyCache.domain === domain && Date.now() - keyCache.at < KEYS_TTL_MS) return keyCache.keys;
  const res = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Couldn't load the Access signing keys from ${domain} (${res.status}).`);
  const { keys } = await res.json();
  keyCache = { domain, at: Date.now(), keys };
  return keys;
}

function tokenFrom(request) {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header;
  const cookie = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get('Cookie') || '');
  return cookie ? cookie[1] : null;
}

// Returns { email } for an allowed admin, or { error, status } explaining what's wrong.
export async function checkAdmin(request, env) {
  if (env.DEV_ADMIN_EMAIL) return { email: env.DEV_ADMIN_EMAIL };
  const domain = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const allowed = String(env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!domain || !env.ACCESS_AUD || !allowed.length) {
    return { status: 500, error: 'The admin check isn’t set up: add ACCESS_TEAM_DOMAIN, ACCESS_AUD and ADMIN_EMAILS in the Pages project’s variables, then redeploy.' };
  }
  const token = tokenFrom(request);
  if (!token) return { status: 403, error: 'Not signed in through Cloudflare Access.' };
  const parts = token.split('.');
  if (parts.length !== 3) return { status: 403, error: 'That sign-in token is malformed.' };
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch (_) { return { status: 403, error: 'That sign-in token is malformed.' }; }
  if (header.alg !== 'RS256') return { status: 403, error: 'Unexpected sign-in token type.' };

  let keys = await teamKeys(domain);
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { keys = await teamKeys(domain, true); jwk = keys.find(k => k.kid === header.kid); }  // keys rotate
  if (!jwk) return { status: 403, error: 'The sign-in token was signed by an unknown key.' };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) return { status: 403, error: 'The sign-in token’s signature doesn’t match.' };

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return { status: 403, error: 'The sign-in token is for a different Access application.' };
  if (payload.iss !== `https://${domain}`) return { status: 403, error: 'The sign-in token came from a different Access team.' };
  if (!payload.exp || payload.exp < now) return { status: 403, error: 'Your sign-in has expired. Reload the page to sign in again.' };
  const email = String(payload.email || '').toLowerCase();
  if (!allowed.includes(email)) return { status: 403, error: `${email || 'This account'} isn’t allowed to use the admin page.` };
  return { email };
}
