// Live rooms (functions/api/rooms): codes, roles and the changes people can make to a shared tournament.
// The room's data is a tournament record in the same shape js/local.js keeps in the browser.

import { parseTime, formatTime } from './time.js';
import { setResult, clearResult, checkBracket } from './bracket.js';

// no 0/O, 1/I/L, so a code read off a stream is easy to type
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const VIEW_CODE_LENGTH = 6;
export const EDIT_CODE_LENGTH = 8;
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

// Which ops each role may send. Viewers send none.
export const ROLE_OPS = {
  participant: ['add_time', 'remove_time', 'match_result', 'clear_match', 'timer', 'announce'],
  host: ['add_time', 'remove_time', 'match_result', 'clear_match', 'timer', 'announce', 'replace', 'participants', 'end', 'reopen'],
};

// Checks a whole tournament record (upload, host edits). Returns an error message or null.
export function checkRecord(r) {
  const t = r?.tournament;
  if (!t || typeof t !== 'object') return 'Missing tournament.';
  if (!String(t.name || '').trim()) return 'The tournament needs a name.';
  for (const key of ['tracks', 'classes', 'events', 'platforms', 'points']) if (!Array.isArray(t[key])) return `tournament.${key} must be a list.`;
  if (!t.events.length) return 'The tournament needs at least one event.';
  if (!Array.isArray(r.players) || !Array.isArray(r.runs)) return 'players and runs must be lists.';
  if (r.runs.length > MAX_TIMES) return `Up to ${MAX_TIMES} times.`;
  for (const run of r.runs) {
    if (!Number.isInteger(run.time_ms) || run.time_ms <= 0) return 'Every time needs time_ms.';
    if (!String(run.racer || '').trim()) return 'Every time needs a racer.';
  }
  if (t.bracket) { const e = checkBracket(t.bracket); if (e) return `Bracket: ${e}`; }
  return null;
}

const log = (data, detail, by) => {
  data.activity = [{ action: 'room', detail: by ? `${detail} · ${by}` : detail, at: new Date().toISOString() }, ...(data.activity || [])].slice(0, 200);
};

// Applies one op to the room row's parsed parts. Returns { data?, timer?, announce?, live?, editCode? } to save,
// or throws an Error with a message for the person.
export function applyOp(parts, body, role) {
  const op = body.op;
  if (!ROLE_OPS[role]?.includes(op)) throw new Error(role === 'viewer' ? 'Viewers can’t change the tournament.' : 'Only the host can do that.');
  const by = String(body.by || '').trim().slice(0, 32) || (role === 'host' ? 'host' : 'a participant');
  const data = parts.data;
  const t = data.tournament;
  if (!parts.live && !['reopen', 'participants'].includes(op)) throw new Error('This tournament has ended. The host can reopen it.');

  if (op === 'add_time') {
    const racerIn = String(body.racer || '').trim().replace(/\s+/g, ' ');
    const time = typeof body.time_ms === 'number' ? Math.round(body.time_ms) : parseTime(body.time);
    const penalty = Math.round(Number(body.penalty_ms || 0));
    if (!racerIn || racerIn.length > 32) throw new Error('Enter the racer (up to 32 characters).');
    const racer = data.players.length ? data.players.find(p => p.name.toLowerCase() === racerIn.toLowerCase())?.name : racerIn;
    if (!racer) throw new Error(`${racerIn} isn't on the player list.`);
    if (!t.events.some(([a, c]) => a === body.track && c === body.cls)) throw new Error("That track and class don't count in this tournament.");
    if (!time) throw new Error('Write the time like 1:04.777.');
    if (!Number.isFinite(penalty) || penalty < 0) throw new Error('The penalty has to be 0 or more.');
    if (data.runs.length >= MAX_TIMES) throw new Error('This tournament has too many times.');
    const id = Math.max(0, ...data.runs.map(r => r.id || 0)) + 1;
    const now = new Date().toISOString();
    data.runs.push({ id, racer, platform: String(body.platform || '').slice(0, 20), track: body.track, cls: body.cls, time_ms: time,
      penalty_ms: penalty, penalty_note: String(body.penalty_note || '').slice(0, 200), status: 'verified', submitted_at: now, reviewed_at: now, by });
    log(data, `${racer}: ${formatTime(time + penalty)} on ${body.track} · ${body.cls}`, by);
    return { data };
  }
  if (op === 'remove_time') {
    const run = data.runs.find(r => r.id === Number(body.id));
    if (!run) throw new Error('That time is already gone.');
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
      label: String(s.label || '').slice(0, 60), server_at: Date.now(),
    } };
  }
  if (op === 'announce') {
    const text = String(body.text || '').trim().slice(0, 120);
    return { announce: text ? { text, at: new Date().toISOString(), by } : null };
  }
  if (op === 'replace') {
    const next = body.record;
    const error = checkRecord(next);
    if (error) throw new Error(error);
    next.activity = data.activity;
    log(next, String(body.note || 'Host updated the tournament').slice(0, 120));
    return { data: next };
  }
  if (op === 'participants') return { editCode: body.enabled ? makeCode(EDIT_CODE_LENGTH) : null };
  if (op === 'end') { log(data, 'Tournament ended'); return { data, live: 0 }; }
  if (op === 'reopen') { log(data, 'Tournament reopened'); return { data, live: 1 }; }
  throw new Error('Unknown change.');
}

// The room for a viewer or participant code, and the caller's role (the X-Host-Key header makes it the host).
export async function findRoom(env, request, rawCode) {
  const code = cleanCode(rawCode);
  if (!/^[A-Z0-9]{6,8}$/.test(code)) return {};
  const room = await env.DB.prepare('SELECT * FROM rooms WHERE code = ? OR edit_code = ?').bind(code, code).first();
  if (!room) return {};
  const hostKey = request.headers.get('X-Host-Key');
  let role = room.edit_code === code ? 'participant' : 'viewer';
  if (hostKey && await sha256(hostKey) === room.host_hash) role = 'host';
  return { room, role };
}

