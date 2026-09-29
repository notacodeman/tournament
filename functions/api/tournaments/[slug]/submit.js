// POST /api/tournaments/<slug>/submit (multipart form): a racer submits a time for review.
// Fields: racer, platform, track, cls, time, video_url, no_cheats, screenshot (image file).
// The screenshot goes into the PROOF R2 bucket. Returns a token for the racer's "check my run" link.

import { json, fail, audit, tournamentOut, acceptsRuns, rosterName } from '../../../../lib/api.js';
import { parseTime, formatTime } from '../../../../lib/time.js';

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
// at most this many submissions from one connection per tournament in RATE_WINDOW_MINUTES
const RATE_LIMIT = 8;
const RATE_WINDOW_MINUTES = 10;

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env, params }) {
  const row = await env.DB.prepare("SELECT * FROM tournaments WHERE slug = ? AND status != 'draft'").bind(params.slug).first();
  if (!row) return fail('No tournament with that link.', 404);
  const t = tournamentOut(row);
  if (!acceptsRuns(t)) return fail("This tournament isn't taking times right now.", 409);

  const form = await request.formData().catch(() => null);
  if (!form) return fail('Expected a form submission.');
  const field = name => String(form.get(name) ?? '').trim();

  let racer = field('racer').replace(/\s+/g, ' ');
  const platform = field('platform');
  const track = field('track');
  const cls = field('cls');
  const timeMs = parseTime(field('time'));
  const videoUrl = field('video_url');
  const screenshot = form.get('screenshot');
  const hasScreenshot = screenshot && typeof screenshot === 'object' && screenshot.size > 0;

  if (!racer || racer.length > 32) return fail('Enter your racer name (up to 32 characters).');
  racer = await rosterName(env, t.id, racer);
  if (!racer) return fail("That name isn't on this tournament's player list. Pick your name from the list, or ask the organizer to add you.");
  if (t.platforms.length && !t.platforms.includes(platform)) return fail('Pick your platform.');
  if (!t.events.some(([et, ec]) => et === track && ec === cls)) return fail("That track and class don't count in this tournament.");
  if (!timeMs) return fail('Enter the time as m:ss.mmm, for example 1:04.777.');
  if (videoUrl && !/^https:\/\/\S+$/i.test(videoUrl)) return fail('The video link has to start with https://');
  if (t.no_cheats && form.get('no_cheats') !== 'on') return fail('Confirm that no cheat codes were active.');
  if (t.proof === 'screenshot' && !hasScreenshot) return fail('Add a screenshot of the results screen.');
  if (t.proof === 'any' && !hasScreenshot && !videoUrl) return fail('Add a screenshot or a video link as proof.');
  if (hasScreenshot) {
    if (!IMAGE_TYPES[screenshot.type]) return fail('The screenshot has to be a PNG, JPG or WebP image.');
    if (screenshot.size > MAX_SCREENSHOT_BYTES) return fail('The screenshot is over 5 MB. Crop it or save it as JPG.');
    if (!env.PROOF) return fail('Screenshot uploads are not set up on this site yet (no R2 bucket bound as PROOF). Use a video link for now.', 500);
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ipHash = await sha256(`${ip}|${t.id}`);
  const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60000).toISOString();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE ip_hash = ? AND submitted_at > ?').bind(ipHash, since).first();
  if (recent.n >= RATE_LIMIT) return fail(`Too many submissions in a row. Try again in ${RATE_WINDOW_MINUTES} minutes.`, 429);

  let proofKey = null;
  if (hasScreenshot) {
    proofKey = `proof/${t.slug}/${crypto.randomUUID()}.${IMAGE_TYPES[screenshot.type]}`;
    await env.PROOF.put(proofKey, screenshot.stream(), { httpMetadata: { contentType: screenshot.type } });
  }

  const token = crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`INSERT INTO runs (tournament_id, racer, platform, track, cls, time_ms, proof_key, video_url,
      token, ip_hash, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(t.id, racer, platform, track, cls, timeMs, proofKey, videoUrl || null, token, ipHash, now).run();
  const runId = result.meta.last_row_id;
  await audit(env, { tournamentId: t.id, runId, action: 'submitted', by: racer,
    detail: `${racer} submitted ${formatTime(timeMs)} on ${track} · ${cls}` }).run();

  return json({ ok: true, id: runId, token });
}
