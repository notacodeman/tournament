// Tournaments made from an uploaded file, saved in this browser. Each is stored as one record:
// { id, created_at, updated_at, tournament: {…same fields as the API…}, players, runs, activity }
// so the tournament view can show it exactly like one from the site.

import { store } from './util.js';

const INDEX = 'local:index';
const key = id => `local:${id}`;

export const local = {
  list: () => store.get(INDEX, []),                    // [{ id, name, game, updated_at, players, runs }], newest first
  get: id => store.get(key(id), null),
  save(record) {
    record.updated_at = new Date().toISOString();
    store.set(key(record.id), record);
    const entry = { id: record.id, name: record.tournament.name, game: record.tournament.game, updated_at: record.updated_at,
      players: record.players.length, runs: record.runs.length, live: record.room?.code || null };
    store.set(INDEX, [entry, ...local.list().filter(e => e.id !== record.id)]);
    return record;
  },
  remove(id) {
    try { localStorage.removeItem(key(id)); } catch (_) { /* blocked */ }
    store.set(INDEX, local.list().filter(e => e.id !== id));
  },
  log(record, detail) {
    record.activity = [{ action: 'local', detail, at: new Date().toISOString() }, ...(record.activity || [])].slice(0, 100);
  },
};

const slugify = text => String(text).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'tournament';

// A record from a file model (js/files.js). Keeps the id from the file so uploading an edited file replaces the old one.
export function recordFromModel(model) {
  const existing = model.id && local.get(slugify(model.id));
  let id = model.id ? slugify(model.id) : slugify(model.name);
  if (!model.id) { let n = 2; const base = id; while (local.get(id)) id = `${base}-${n++}`; }
  const now = new Date().toISOString();
  const record = {
    id,
    created_at: existing?.created_at || now,
    updated_at: now,
    tournament: {
      slug: id, name: model.name, game: model.game, preset: model.preset, description: model.description, rules: model.rules,
      status: 'live', scoring: model.scoring, points: model.points, tracks: model.tracks, classes: model.classes, events: model.events,
      platforms: model.platforms, proof: 'none', no_cheats: false, starts_at: null, ends_at: null, bracket: model.bracket,
    },
    players: model.players.map((p, i) => ({ ...p, seed: i + 1 })),
    runs: model.times.map((t, i) => ({ id: i + 1, ...t, status: 'verified', proof_key: null, video_url: null, submitted_at: now, reviewed_at: now })),
    activity: existing?.activity || [],
  };
  local.log(record, existing ? `Replaced from an uploaded file (${record.runs.length} times, ${record.players.length} players)`
    : `Created from an uploaded file (${record.runs.length} times, ${record.players.length} players)`);
  return { record, replaced: !!existing };
}

// The shape the tournament view expects, from a local record.
export function viewData(record) {
  return {
    ok: true,
    local: true,
    tournament: { ...record.tournament, accepts_runs: false },
    runs: record.runs,
    players: record.players,
    pending: 0,
    activity: record.activity || [],
    now: new Date().toISOString(),
  };
}
