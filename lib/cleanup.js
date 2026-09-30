// Deleting tournaments: by the admin page, and automatically once nothing has changed for RETENTION_DAYS.
// Pages Functions can't run on a schedule, so the automatic sweep runs at most once every SWEEP_EVERY_MS, started by
// ordinary requests (functions/api/_middleware.js) and finished in the background after the response is sent.

export const RETENTION_DAYS = 7;
const SWEEP_EVERY_MS = 60 * 60 * 1000;

// Removes a site tournament with its runs, players, audit log and proof screenshots.
export async function deleteTournament(env, t) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM runs WHERE tournament_id = ?').bind(t.id),
    env.DB.prepare('DELETE FROM players WHERE tournament_id = ?').bind(t.id),
    env.DB.prepare('DELETE FROM audit WHERE tournament_id = ?').bind(t.id),
    env.DB.prepare('DELETE FROM tournaments WHERE id = ?').bind(t.id),
  ]);
  await deleteProofs(env, `proof/${t.slug}/`);
}

export async function deleteProofs(env, prefix) {
  if (!env.PROOF) return;
  let cursor;
  do {
    const page = await env.PROOF.list({ prefix, cursor });
    const keys = page.objects.map(o => o.key);
    if (keys.length) await env.PROOF.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

// The sweep: rooms and site tournaments untouched for RETENTION_DAYS, and old rate-limit counters.
export async function sweep(env) {
  const days = Number(env.RETENTION_DAYS) || RETENTION_DAYS;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  await env.DB.prepare('DELETE FROM rooms WHERE updated_at < ?').bind(cutoff).run();
  const { results } = await env.DB.prepare(`SELECT id, slug FROM tournaments t WHERE t.updated_at < ?1
      AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.tournament_id = t.id AND (r.submitted_at >= ?1 OR r.reviewed_at >= ?1))`)
    .bind(cutoff).all();
  for (const t of results) await deleteTournament(env, t);
  await env.DB.prepare('DELETE FROM rate_limits WHERE window < ?').bind(Math.floor(Date.now() / 1000) - 86400).run();
  return { rooms_cutoff: cutoff, tournaments: results.length };
}

// Starts a sweep if the last one was long enough ago. Claims the slot first so two requests don't both sweep.
export async function maybeSweep(env) {
  const now = Date.now();
  const claimed = await env.DB.prepare(`INSERT INTO meta (key, value) VALUES ('last_sweep', ?1)
      ON CONFLICT (key) DO UPDATE SET value = ?1 WHERE CAST(meta.value AS INTEGER) < ?2 RETURNING value`)
    .bind(String(now), now - SWEEP_EVERY_MS).first();
  if (claimed) await sweep(env);
}
