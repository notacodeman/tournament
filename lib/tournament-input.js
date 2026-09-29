// Checking a tournament sent from the admin page before it's saved. Returns { error } or { values } ready for SQL.

const STATUSES = ['draft', 'registration', 'live', 'finished'];
const PROOF = ['screenshot', 'any', 'none'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;

const names = list => Array.isArray(list)
  ? [...new Set(list.map(v => String(v).trim()).filter(Boolean))]
  : [];

export function readTournament(body) {
  if (!body || typeof body !== 'object') return { error: 'Expected the tournament as JSON.' };
  const name = String(body.name || '').trim();
  const slug = String(body.slug || '').trim().toLowerCase();
  const tracks = names(body.tracks);
  const classes = names(body.classes);
  const platforms = names(body.platforms);
  const events = Array.isArray(body.events)
    ? body.events.filter(e => Array.isArray(e) && tracks.includes(e[0]) && classes.includes(e[1]))
    : [];
  const points = Array.isArray(body.points) ? body.points.map(Number).filter(n => Number.isFinite(n) && n >= 0) : [];

  if (!name || name.length > 80) return { error: 'Give the tournament a name (up to 80 characters).' };
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug)) return { error: 'The link name can use a–z, 0–9 and dashes (2–49 characters).' };
  if (!tracks.length) return { error: 'Add at least one track or level.' };
  if (!classes.length) return { error: 'Add at least one class or category.' };
  if (!events.length) return { error: 'Tick at least one track and class in the event grid.' };
  if (!STATUSES.includes(body.status)) return { error: 'Pick a status.' };
  if (!['time', 'points'].includes(body.scoring)) return { error: 'Pick how the tournament is scored.' };
  if (body.scoring === 'points' && !points.length) return { error: 'Enter the points for each place.' };
  if (!PROOF.includes(body.proof)) return { error: 'Pick what proof racers must add.' };
  for (const key of ['starts_at', 'ends_at']) {
    if (body[key] && !ISO.test(body[key])) return { error: `${key === 'starts_at' ? 'Start' : 'End'} date is not a valid time.` };
  }
  if (body.starts_at && body.ends_at && body.ends_at <= body.starts_at) return { error: 'The end has to be after the start.' };

  return {
    values: {
      slug, name,
      game: String(body.game || '').trim().slice(0, 80),
      preset: body.preset === 'pgrc' ? 'pgrc' : 'custom',
      description: String(body.description || '').trim().slice(0, 1000),
      rules: String(body.rules || '').trim().slice(0, 4000),
      status: body.status, scoring: body.scoring,
      points: JSON.stringify(points), tracks: JSON.stringify(tracks), classes: JSON.stringify(classes),
      events: JSON.stringify(events), platforms: JSON.stringify(platforms),
      proof: body.proof, no_cheats: body.no_cheats ? 1 : 0,
      starts_at: body.starts_at || null, ends_at: body.ends_at || null,
    },
  };
}
