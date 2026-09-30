// POST /api/tournaments/<slug>/submit (multipart form): a racer submits a time for review.
// Fields: racer, platform, track, cls, time, video_url, no_cheats, screenshot (image file), turnstile.
// The screenshot goes into the PROOF R2 bucket. Returns a token for the racer's "check my run" link.
// Checks: rate limit, Turnstile (when set up), the word filter, and that the screenshot really is an image.

import { json, fail, audit, tournamentOut, acceptsRuns, rosterName } from '../../../../lib/api.js';
import { parseTime, formatTime } from '../../../../lib/time.js';
import { overLimit, limitMessage } from '../../../../lib/limits.js';
import { verifyTurnstile, TURNSTILE_FAILED } from '../../../../lib/turnstile.js';
import { checkTexts } from '../../../../lib/moderation.js';

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_URL = 300;

// The first bytes of each allowed image type. The browser's claimed type isn't trusted: a file must start with one of
// these, so nothing else (an HTML page, a script) can be stored and served as "proof".
const IMAGE_SIGNATURES = [
  { ext: 'png', type: 'image/png', test: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', type: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', type: 'image/webp', test: b => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP' },
];

export async function onRequestPost({ request, env, params }) {
  if (await overLimit(env, request, 'submit')) return fail(limitMessage('submit'), 429);
  const row = await env.DB.prepare("SELECT * FROM tournaments WHERE slug = ? AND status != 'draft'").bind(params.slug).first();
  if (!row) return fail('No tournament with that link.', 404);
  const t = tournamentOut(row);
  if (!acceptsRuns(t)) return fail("This tournament isn't taking times right now.", 409);

  const form = await request.formData().catch(() => null);
  if (!form) return fail('Expected a form submission.');
  const field = (name, max = 200) => String(form.get(name) ?? '').trim().slice(0, max);
  if (!await verifyTurnstile(request, env, field('turnstile', 2048))) return fail(TURNSTILE_FAILED, 403);

  let racer = field('racer', 64).replace(/\s+/g, ' ');
  const platform = field('platform', 20);
  const track = field('track', 60);
  const cls = field('cls', 40);
  const timeMs = parseTime(field('time', 20));
  const videoUrl = field('video_url', MAX_VIDEO_URL + 1);
  const screenshot = form.get('screenshot');
  const hasScreenshot = screenshot && typeof screenshot === 'object' && screenshot.size > 0;

  if (!racer || racer.length > 32) return fail('Enter your racer name (up to 32 characters).');
  const bad = checkTexts([['Your racer name', racer]], env.BLOCKED_WORDS);
  if (bad) return fail(bad);
  racer = await rosterName(env, t.id, racer);
  if (!racer) return fail("That name isn't on this tournament's player list. Pick your name from the list, or ask the organizer to add you.");
  if (t.platforms.length && !t.platforms.includes(platform)) return fail('Pick your platform.');
  if (!t.events.some(([et, ec]) => et === track && ec === cls)) return fail("That track and class don't count in this tournament.");
  if (!timeMs) return fail('Enter the time as m:ss.mmm, for example 1:04.777.');
  if (videoUrl && (videoUrl.length > MAX_VIDEO_URL || !/^https:\/\/[^\s<>"']+$/i.test(videoUrl))) return fail('The video link has to be a normal https:// address.');
  if (t.no_cheats && form.get('no_cheats') !== 'on') return fail('Confirm that no cheat codes were active.');
  if (t.proof === 'screenshot' && !hasScreenshot) return fail('Add a screenshot of the results screen.');
  if (t.proof === 'any' && !hasScreenshot && !videoUrl) return fail('Add a screenshot or a video link as proof.');

  let image = null;
  if (hasScreenshot) {
    if (screenshot.size > MAX_SCREENSHOT_BYTES) return fail('The screenshot is over 5 MB. Crop it or save it as JPG.');
    if (!env.PROOF) return fail('Screenshot uploads are not set up on this site yet. Use a video link for now.', 500);
    const bytes = new Uint8Array(await screenshot.arrayBuffer());
    const kind = IMAGE_SIGNATURES.find(sig => sig.test(bytes));
    if (!kind) return fail('The screenshot has to be a PNG, JPG or WebP image.');
    image = { bytes, kind };
  }

  let proofKey = null;
  if (image) {
    proofKey = `proof/${t.slug}/${crypto.randomUUID()}.${image.kind.ext}`;
    await env.PROOF.put(proofKey, image.bytes, { httpMetadata: { contentType: image.kind.type } });
  }

  const token = crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`INSERT INTO runs (tournament_id, racer, platform, track, cls, time_ms, proof_key, video_url,
      token, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(t.id, racer, platform, track, cls, timeMs, proofKey, videoUrl || null, token, now).run();
  const runId = result.meta.last_row_id;
  await audit(env, { tournamentId: t.id, runId, action: 'submitted', by: racer,
    detail: `${racer} submitted ${formatTime(timeMs)} on ${track} · ${cls}` }).run();

  return json({ ok: true, id: runId, token });
}
