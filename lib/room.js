// Live rooms (functions/api/rooms): codes, roles and the changes people can make to a shared tournament.
// The room's data is a tournament record in the same shape js/local.js keeps in the browser.

import { parseTime, formatTime } from './time.js';
import { setResult, clearResult, checkBracket } from './bracket.js';
import { checkTexts } from './moderation.js';

// no 0/O, 1/I/L, so a code read off a stream is easy to type
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const VIEW_CODE_LENGTH = 6;
export const EDIT_CODE_LENGTH = 8;   // participant code
export const MOD_CODE_LENGTH = 10;   // mod code
export const MAX_DATA_BYTES = 512 * 1024;
export const MAX_TIMES = 5000;

export function makeCode(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join('');
}
// "k7m-2qx " → "K7M2QX"
export const cleanCode = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Who may do what. Each live tournament has three codes plus the host key:
//   viewer code       watch only (sends no changes)
//   participant code  enter and remove their own times
//   mod code          run the tournament: any time, bracket, players, timer, messages, end/reopen
//   host key          everything a mod can, plus making new codes or turning them off
const MOD_OPS = ['add_time', 'remove_time', 'match_result', 'clear_match', 'timer', 'announce', 'replace', 'end', 'reopen'];
export const ROLE_OPS = {
  participant: ['add_time', 'remove_time'],
  mod: MOD_OPS,
  host: [...MOD_OPS, 'codes'],
};
const DENIED = {
  viewer: 'Viewers can’t change the tournament.',
  participant: 'Participants can only enter their own times.',
  mod: 'Only the host can do that.',
};
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Limits on a shared tournament. Anything bigger is refused, so one room can't fill the database.
export const CAPS = { name: 80, text: 4000, short: 40, tracks: 100, classes: 20, events: 500, platforms: 10, points: 64, players: 256, activity: 200 };

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const list = (v, maxItems, maxLen) => (Array.isArray(v) ? [...new Set(v.map(x => str(x, maxLen)).filter(Boolean))].slice(0, maxItems) : null);

// Rebuilds a tournament record from the fields we know, with every size capped and the word filter applied, so nothing
// unexpected (extra fields, huge strings, wrong types) is ever stored. Returns { record } or { error }.
export function cleanRecord(r, blocked = '') {
  const t = r?.tournament;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return { error: 'Missing tournament.' };
  const name = str(t.name, CAPS.name);
  if (!name) return { error: 'The tournament needs a name.' };
  const tracks = list(t.tracks, CAPS.tracks, 60);
  const classes = list(t.classes, CAPS.classes, CAPS.short);
  const platforms = list(t.platforms || [], CAPS.platforms, 20);
  if (!tracks?.length || !classes?.length) return { error: 'The tournament needs tracks and classes.' };
  const events = (Array.isArray(t.events) ? t.events : [])
    .filter(e => Array.isArray(e) && tracks.includes(e[0]) && classes.includes(e[1])).slice(0, CAPS.events).map(e => [e[0], e[1]]);
  if (!events.length) return { error: 'The tournament needs at least one event.' };
  const points = (Array.isArray(t.points) ? t.points : []).map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 1000).slice(0, CAPS.points);
  if (!Array.isArray(r.players) || !Array.isArray(r.runs)) return { error: 'players and runs must be lists.' };
  if (r.players.length > CAPS.players) return { error: `Up to ${CAPS.players} players.` };
  if (r.runs.length > MAX_TIMES) return { error: `Up to ${MAX_TIMES} times.` };
  const players = [];
  for (const p of r.players) {
    const pn = str(p?.name, 32);
    if (!pn || players.some(x => x.name.toLowerCase() === pn.toLowerCase())) continue;
    players.push({ name: pn, team: str(p.team, CAPS.short), platform: str(p.platform, 20), seed: players.length + 1 });
  }
  const eventSet = new Set(events.map(e => e.join('\u0000')));
  const runs = [];
  for (const run of r.runs) {
    const time = Number(run?.time_ms);
    const penalty = Number(run?.penalty_ms || 0);
    if (!Number.isInteger(time) || time <= 0 || time > 360000000) return { error: 'Every time needs a valid time_ms.' };
    if (!Number.isInteger(penalty) || penalty < 0 || penalty > 360000000) return { error: 'Penalties must be whole milliseconds.' };
    const racer = str(run.racer, 32);
    if (!racer) return { error: 'Every time needs a racer.' };
    if (!eventSet.has(`${run.track}\u0000${run.cls}`)) continue;
    const at = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(run.submitted_at) ? run.submitted_at : new Date().toISOString();
    runs.push({ id: runs.length + 1, racer, platform: str(run.platform, 20), track: run.track, cls: run.cls, time_ms: time, penalty_ms: penalty,
      penalty_note: str(run.penalty_note, 200), status: 'verified', submitted_at: at, reviewed_at: at, by: str(run.by, 32) });
  }
  let bracket = null;
  if (t.bracket) {
    const e = checkBracket(t.bracket);
    if (e) return { error: `Bracket: ${e}` };
    bracket = { kind: t.bracket.kind, entrants: t.bracket.entrants.map(x => str(x, 40)),
      rounds: t.bracket.rounds.map(round => round.map(m => ({ a: m.a ?? null, b: m.b ?? null, a_ms: m.a_ms ?? null, b_ms: m.b_ms ?? null, winner: m.winner ?? null }))) };
  }
  const tournament = {
    slug: str(t.slug, 60), name, game: str(t.game, CAPS.name), preset: t.preset === 'pgrc' ? 'pgrc' : 'custom',
    description: str(t.description, 1000), rules: str(t.rules, CAPS.text), status: 'live',
    scoring: t.scoring === 'points' ? 'points' : 'time', points, tracks, classes, events, platforms,
    proof: 'none', no_cheats: !!t.no_cheats, starts_at: null, ends_at: null, bracket,
  };
  const problem = checkTexts([
    ['The tournament name', name], ['The game name', tournament.game], ['The description', tournament.description],
    ['The rules', tournament.rules], ['A track name', tracks], ['A class name', classes], ['A platform name', platforms],
    ['A player name', players.map(p => p.name)], ['A team name', players.map(p => p.team)],
    ['A racer name', runs.map(x => x.racer)], ['A penalty note', runs.map(x => x.penalty_note)],
  ], blocked);
  if (problem) return { error: problem };
  const activity = (Array.isArray(r.activity) ? r.activity : []).slice(0, CAPS.activity)
    .map(a => ({ action: str(a?.action, 20), detail: str(a?.detail, 300), at: str(a?.at, 30) }));
  return { record: { id: str(r.id, 60), tournament, players, runs, activity } };
}

const log = (data, detail, by) => {
  data.activity = [{ action: 'room', detail: by ? `${detail} · ${by}` : detail, at: new Date().toISOString() }, ...(data.activity || [])].slice(0, 200);
};

// Applies one op to the room row's parsed parts. Returns { data?, timer?, announce?, live?, editCode? } to save,
// or throws an Error with a message for the person.
export function applyOp(parts, body, role, blocked = '') {
  const op = body.op;
  if (!ROLE_OPS[role]?.includes(op)) throw new Error(DENIED[role] || 'Not allowed.');
  const by = str(body.by, 32) || (role === 'host' ? 'host' : role === 'mod' ? 'a mod' : '');
  if (role === 'participant' && !by) throw new Error('Enter your racer name first.');
  const clean = (label, text) => { const e = checkTexts([[label, text]], blocked); if (e) throw new Error(e); return text; };
  clean('Your name', by);
  const data = parts.data;
  const t = data.tournament;
  if (!parts.live && !['reopen', 'codes'].includes(op)) throw new Error('This tournament has ended. The host can reopen it.');

  if (op === 'add_time') {
    // participants always enter times for themselves, whatever name the request says
    const racerIn = (role === 'participant' ? by : String(body.racer || '')).trim().replace(/\s+/g, ' ');
    const time = typeof body.time_ms === 'number' ? Math.round(body.time_ms) : parseTime(body.time);
    const penalty = Math.round(Number(body.penalty_ms || 0));
    if (!racerIn || racerIn.length > 32) throw new Error('Enter the racer (up to 32 characters).');
    const racer = data.players.length ? data.players.find(p => p.name.toLowerCase() === racerIn.toLowerCase())?.name : racerIn;
    if (!racer) throw new Error(`${racerIn} isn't on the player list.`);
    clean('The racer name', racer);
    clean('The penalty note', String(body.penalty_note || ''));
    if (!t.events.some(([a, c]) => a === body.track && c === body.cls)) throw new Error("That track and class don't count in this tournament.");
    if (!time) throw new Error('Write the time like 1:04.777.');
    if (!Number.isFinite(penalty) || penalty < 0) throw new Error('The penalty has to be 0 or more.');
    if (data.runs.length >= MAX_TIMES) throw new Error('This tournament has too many times.');
    const id = Math.max(0, ...data.runs.map(r => r.id || 0)) + 1;
    const now = new Date().toISOString();
    data.runs.push({ id, racer, platform: str(body.platform, 20), track: body.track, cls: body.cls, time_ms: time,
      penalty_ms: penalty, penalty_note: str(body.penalty_note, 200), status: 'verified', submitted_at: now, reviewed_at: now, by });
    log(data, `${racer}: ${formatTime(time + penalty)} on ${body.track} · ${body.cls}`, by);
    return { data };
  }
  if (op === 'remove_time') {
    const run = data.runs.find(r => r.id === Number(body.id));
    if (!run) throw new Error('That time is already gone.');
    if (role === 'participant' && !same(run.racer, by)) throw new Error('Participants can only remove their own times.');
    data.runs = data.runs.filter(r => r !== run);
    log(data, `Removed ${run.racer}: ${formatTime(run.time_ms)} on ${run.track} · ${run.cls}`, by);
    return { data };
  }
  if (op === 'match_result' || op === 'clear_match') {
    if (!t.bracket) throw new Error('There’s no bracket.');
    const r = Number(body.round), i = Number(body.index);
    const m = t.bracket.rounds[r]?.[i];
    if (!m || !m.a || !m.b) throw new Error('That match isn’t ready yet.');
    if (op === 'clear_match') {
      clearResult(t.bracket, r, i);
      log(data, `Bracket: cleared ${m.a} vs ${m.b}`, by);
    } else {
      const ms = v => (Number.isInteger(v) && v > 0 ? v : null);
      setResult(t.bracket, r, i, { a_ms: ms(body.a_ms), b_ms: ms(body.b_ms), winner: ['a', 'b'].includes(body.winner) ? body.winner : null });
      const w = m.winner === 'a' ? m.a : m.winner === 'b' ? m.b : null;
      log(data, w ? `Bracket: ${w} beat ${w === m.a ? m.b : m.a}` : `Bracket: ${m.a} vs ${m.b} times saved`, by);
    }
    return { data };
  }
  if (op === 'timer') {
    // stored against the server clock so every viewer's clock agrees whatever their own clock says
    const s = body.state || {};
    return { timer: {
      mode: s.mode === 'countdown' ? 'countdown' : 'stopwatch', running: !!s.running,
      elapsed_ms: Math.max(0, Math.round(Number(s.elapsed_ms) || 0)), duration: Math.max(1000, Math.round(Number(s.duration) || 600000)),
      label: clean('The timer label', str(s.label, 60)), server_at: Date.now(),
    } };
  }
  if (op === 'announce') {
    const text = clean('The message', str(body.text, 120));
    return { announce: text ? { text, at: new Date().toISOString(), by } : null };
  }
  if (op === 'replace') {
    const { record: next, error } = cleanRecord(body.record, blocked);
    if (error) throw new Error(error);
    next.activity = data.activity;
    log(next, str(body.note, 120) || 'Tournament updated', by);
    return { data: next };
  }
  if (op === 'codes') {
    // which: 'participant' | 'mod'; action: 'new' (replace it, so the old one stops working) | 'off'
    if (!['participant', 'mod'].includes(body.which) || !['new', 'off'].includes(body.action)) throw new Error('Unknown code change.');
    const code = body.action === 'new' ? makeCode(body.which === 'mod' ? MOD_CODE_LENGTH : EDIT_CODE_LENGTH) : null;
    log(data, `${body.which === 'mod' ? 'Mod' : 'Participant'} code ${code ? 'replaced' : 'turned off'}`);
    return body.which === 'mod' ? { data, modCode: code } : { data, editCode: code };
  }
  if (op === 'end') { log(data, 'Tournament ended'); return { data, live: 0 }; }
  if (op === 'reopen') { log(data, 'Tournament reopened'); return { data, live: 1 }; }
  throw new Error('Unknown change.');
}

// The room for a viewer or participant code, and the caller's role (the X-Host-Key header makes it the host).
export async function findRoom(env, request, rawCode) {
  const code = cleanCode(rawCode);
  if (!/^[A-Z0-9]{6,10}$/.test(code)) return {};
  const room = await env.DB.prepare('SELECT * FROM rooms WHERE code = ?1 OR edit_code = ?1 OR mod_code = ?1').bind(code).first();
  if (!room) return {};
  const hostKey = request.headers.get('X-Host-Key');
  let role = room.mod_code === code ? 'mod' : room.edit_code === code ? 'participant' : 'viewer';
  if (hostKey && await sha256(hostKey) === room.host_hash) role = 'host';
  return { room, role };
}

