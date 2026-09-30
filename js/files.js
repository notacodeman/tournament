// Tournament files: reading an uploaded .csv or .json, writing a tournament back out, and the downloadable templates.
//
// JSON: { format, id, name, game, preset, scoring, points, rules, description, platforms, tracks, classes, events,
//         players: [{ name, team, platform }], times: [{ racer, platform, track, class, time, penalty_s, note }],
//         bracket: null | 'players' | 'teams' | { kind, entrants, rounds } }
// CSV: one sheet, one row per thing, the kind of row in the first column (see CSV_COLUMNS and the template).

import { parseTime, formatTime } from '../lib/time.js';
import { PRESETS, DEFAULT_POINTS } from '../lib/presets.js';
import { createBracket, setResult, checkBracket } from '../lib/bracket.js';

export const FILE_FORMAT = 'tournament.codeman.club/1';
export const CSV_COLUMNS = ['row_type', 'key', 'value', 'racer', 'team', 'platform', 'track', 'class', 'time', 'penalty_s', 'note', 'opponent', 'opponent_time'];
const SETTING_KEYS = ['id', 'name', 'game', 'preset', 'scoring', 'points', 'platforms', 'rules', 'description', 'bracket', 'bracket_order'];

// ---------- CSV ----------
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';' && !text.slice(0, 200).includes(',')) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

const csvCell = v => (/[",\n\r]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const csvLine = values => values.map(csvCell).join(',');

// ---------- Reading ----------
// Returns { model } or { errors: [...] }. The model is the JSON shape above with times already in milliseconds.
export function readFile(name, text) {
  const isJson = /\.json$/i.test(name) || /^\s*[{[]/.test(text);
  try {
    return isJson ? fromJson(JSON.parse(text)) : fromCsv(text);
  } catch (err) {
    return { errors: [isJson ? `That JSON file couldn't be read: ${err.message}` : `That CSV file couldn't be read: ${err.message}`] };
  }
}

function fromJson(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { errors: ['The JSON file should hold one tournament object.'] };
  const times = (obj.times || []).map((t, i) => ({ ...t, cls: t.class ?? t.cls, where: `times[${i}]` }));
  return buildModel({ ...obj, times, players: obj.players || [] });
}

function fromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { errors: ['The CSV file is empty.'] };
  const header = rows[0].map(h => h.trim().toLowerCase());
  if (!header.includes('row_type')) return { errors: ['The CSV needs a header row with a row_type column. Download the template to see the layout.'] };
  const col = name => header.indexOf(name);
  const get = (row, name) => (col(name) >= 0 ? String(row[col(name)] ?? '').trim() : '');
  const model = { players: [], times: [], events: [], tracks: [], classes: [], matches: [] };
  const errors = [];
  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const type = get(row, 'row_type').toLowerCase();
    if (!type || type.startsWith('#')) return;
    if (type === 'setting') {
      const key = get(row, 'key').toLowerCase();
      if (!SETTING_KEYS.includes(key)) { errors.push(`Row ${line}: unknown setting "${key}".`); return; }
      model[key] = get(row, 'value');
    } else if (type === 'track') model.tracks.push(get(row, 'track') || get(row, 'value'));
    else if (type === 'class') model.classes.push(get(row, 'class') || get(row, 'value'));
    else if (type === 'event') model.events.push([get(row, 'track'), get(row, 'class')]);
    else if (type === 'player') model.players.push({ name: get(row, 'racer'), team: get(row, 'team'), platform: get(row, 'platform') });
    else if (type === 'time') {
      model.times.push({ racer: get(row, 'racer'), platform: get(row, 'platform'), track: get(row, 'track'), cls: get(row, 'class'),
        time: get(row, 'time'), penalty_s: get(row, 'penalty_s'), note: get(row, 'note'), where: `Row ${line}` });
    } else if (type === 'match') {
      model.matches.push({ key: get(row, 'key'), a: get(row, 'racer'), a_time: get(row, 'time'), b: get(row, 'opponent'),
        b_time: get(row, 'opponent_time'), winner: get(row, 'value'), where: `Row ${line}` });
    } else errors.push(`Row ${line}: unknown row_type "${type}". Use setting, track, class, event, player, time or match.`);
  });
  if (errors.length) return { errors };
  if (model.points) model.points = model.points.split(/[,\s]+/).filter(Boolean).map(Number);
  if (model.platforms) model.platforms = model.platforms.split(',').map(s => s.trim()).filter(Boolean);
  if (!model.tracks.length) delete model.tracks;
  if (!model.classes.length) delete model.classes;
  if (!model.events.length) delete model.events;
  return buildModel(model);
}

// Shared checks for both formats (and the setup guide); fills gaps from the preset. Returns { model } or { errors }.
export function buildModel(raw) {
  const errors = [];
  const preset = PRESETS[raw.preset] ? raw.preset : 'custom';
  const p = PRESETS[preset];
  const name = String(raw.name || '').trim();
  if (!name) errors.push('The tournament needs a name (setting "name").');

  let events = Array.isArray(raw.events) && raw.events.length ? raw.events.map(e => [String(e[0] || '').trim(), String(e[1] || '').trim()]) : null;
  if (!events) events = preset === 'custom' ? [] : p.events;
  events = events.filter(([t, c]) => t && c);
  if (!events.length) errors.push('Add at least one event: a track and class that count (row_type "event").');
  const uniq = list => [...new Set(list.map(s => String(s).trim()).filter(Boolean))];
  const tracks = uniq([...(raw.tracks || (preset !== 'custom' && !raw.events ? p.tracks : [])), ...events.map(e => e[0])]);
  const classes = uniq([...(raw.classes || (preset !== 'custom' && !raw.events ? p.classes : [])), ...events.map(e => e[1])]);
  const platforms = uniq(raw.platforms || p.platforms);
  const scoring = raw.scoring === 'points' ? 'points' : 'time';
  const points = Array.isArray(raw.points) && raw.points.length ? raw.points.map(Number).filter(n => Number.isFinite(n) && n >= 0) : DEFAULT_POINTS;

  const players = [];
  const seen = new Set();
  for (const pl of raw.players || []) {
    const n = String(pl.name || '').trim();
    if (!n) continue;
    if (seen.has(n.toLowerCase())) { errors.push(`Player "${n}" is listed twice.`); continue; }
    seen.add(n.toLowerCase());
    players.push({ name: n, team: String(pl.team || '').trim(), platform: String(pl.platform || '').trim() });
  }
  const eventSet = new Set(events.map(e => e.join('\u0000')));
  const times = [];
  for (const t of raw.times || []) {
    const where = t.where || 'A time';
    const racer = String(t.racer || '').trim();
    const ms = typeof t.time === 'number' ? Math.round(t.time) : parseTime(t.time);
    const pen = t.penalty_s === '' || t.penalty_s == null ? 0 : Math.round(Number(t.penalty_s) * 1000);
    if (!racer) { errors.push(`${where}: no racer name.`); continue; }
    if (players.length && !seen.has(racer.toLowerCase())) { errors.push(`${where}: "${racer}" isn't in the player list.`); continue; }
    if (!eventSet.has(`${String(t.track).trim()}\u0000${String(t.cls).trim()}`)) { errors.push(`${where}: ${t.track} · ${t.cls} isn't one of the events.`); continue; }
    if (!ms) { errors.push(`${where}: "${t.time}" isn't a time. Write it like 1:04.777.`); continue; }
    if (!Number.isFinite(pen) || pen < 0) { errors.push(`${where}: the penalty has to be 0 or more seconds.`); continue; }
    const canonical = players.find(pl => pl.name.toLowerCase() === racer.toLowerCase())?.name || racer;
    times.push({ racer: canonical, platform: String(t.platform || '').trim(), track: String(t.track).trim(), cls: String(t.cls).trim(),
      time_ms: ms, penalty_ms: pen, penalty_note: String(t.note || '').trim() });
  }

  // bracket: a full object (JSON), or a kind to build from the players, plus match results (CSV)
  let bracket = null;
  if (raw.bracket && typeof raw.bracket === 'object') {
    const problem = checkBracket(raw.bracket);
    if (problem) errors.push(`Bracket: ${problem}`); else bracket = raw.bracket;
  } else if (raw.bracket === 'players' || raw.bracket === 'teams') {
    const order = raw.bracket_order ? String(raw.bracket_order).split('|').map(s => s.trim()).filter(Boolean)
      : raw.bracket === 'teams' ? uniq(players.map(pl => pl.team)) : players.map(pl => pl.name);
    try {
      bracket = createBracket(order, raw.bracket);
      for (const m of raw.matches || []) {
        const [r, i] = String(m.key).split('.').map(n => Number(n) - 1);
        const match = bracket.rounds[r]?.[i];
        if (!match) { errors.push(`${m.where}: there's no match ${m.key} (round.match, e.g. 1.2).`); continue; }
        if (match.a !== m.a || match.b !== m.b) { errors.push(`${m.where}: match ${m.key} is ${match.a || 'TBD'} vs ${match.b || 'TBD'}, not ${m.a} vs ${m.b}.`); continue; }
        const winner = m.winner ? (m.winner === m.a ? 'a' : m.winner === m.b ? 'b' : null) : null;
        if (m.winner && !winner) { errors.push(`${m.where}: the winner has to be ${m.a} or ${m.b}.`); continue; }
        if (match.a && match.b) setResult(bracket, r, i, { a_ms: parseTime(m.a_time), b_ms: parseTime(m.b_time), winner });
      }
    } catch (err) { errors.push(`Bracket: ${err.message}`); }
  } else if (raw.bracket) errors.push('Setting "bracket" must be players or teams (or left empty).');

  if (errors.length) return { errors };
  return {
    model: {
      id: raw.id ? String(raw.id).trim() : null, name, game: String(raw.game || p.game || '').trim(), preset,
      scoring, points, rules: String(raw.rules || (preset !== 'custom' ? p.rules : '') || ''), description: String(raw.description || ''),
      platforms, tracks, classes, events, players, times, bracket,
    },
  };
}

// ---------- Writing ----------
export function toJson(record) {
  const t = record.tournament;
  return JSON.stringify({
    format: FILE_FORMAT, id: record.id, name: t.name, game: t.game, preset: t.preset, scoring: t.scoring, points: t.points,
    rules: t.rules, description: t.description, platforms: t.platforms, tracks: t.tracks, classes: t.classes, events: t.events,
    players: record.players.map(p => ({ name: p.name, team: p.team, platform: p.platform })),
    times: record.runs.map(r => ({ racer: r.racer, platform: r.platform, track: r.track, class: r.cls, time: formatTime(r.time_ms),
      penalty_s: r.penalty_ms / 1000, note: r.penalty_note || '' })),
    bracket: t.bracket || null,
  }, null, 2);
}

export function toCsv(record) {
  const t = record.tournament;
  const line = obj => csvLine(CSV_COLUMNS.map(c => obj[c] ?? ''));
  const lines = [csvLine(CSV_COLUMNS)];
  const setting = (key, value) => lines.push(line({ row_type: 'setting', key, value }));
  setting('id', record.id);
  setting('name', t.name);
  setting('game', t.game);
  setting('preset', t.preset);
  setting('scoring', t.scoring);
  setting('points', t.points.join(' '));
  setting('platforms', t.platforms.join(', '));
  setting('description', t.description);
  setting('rules', t.rules);
  if (t.bracket) {
    setting('bracket', t.bracket.kind);
    setting('bracket_order', t.bracket.entrants.join(' | '));
  }
  const counted = new Set(t.events.map(e => e[0]));
  for (const track of t.tracks) if (!counted.has(track)) lines.push(line({ row_type: 'track', track }));
  const countedCls = new Set(t.events.map(e => e[1]));
  for (const cls of t.classes) if (!countedCls.has(cls)) lines.push(line({ row_type: 'class', class: cls }));
  for (const [track, cls] of t.events) lines.push(line({ row_type: 'event', track, class: cls }));
  for (const p of record.players) lines.push(line({ row_type: 'player', racer: p.name, team: p.team, platform: p.platform }));
  for (const r of record.runs) {
    lines.push(line({ row_type: 'time', racer: r.racer, platform: r.platform, track: r.track, class: r.cls, time: formatTime(r.time_ms),
      penalty_s: r.penalty_ms ? r.penalty_ms / 1000 : '', note: r.penalty_note }));
  }
  if (t.bracket) {
    t.bracket.rounds.forEach((round, ri) => round.forEach((m, mi) => {
      if (!m.a || !m.b || (!m.winner && !m.a_ms && !m.b_ms)) return;
      lines.push(line({ row_type: 'match', key: `${ri + 1}.${mi + 1}`, racer: m.a, time: m.a_ms ? formatTime(m.a_ms) : '',
        opponent: m.b, opponent_time: m.b_ms ? formatTime(m.b_ms) : '', value: m.winner === 'a' ? m.a : m.winner === 'b' ? m.b : '' }));
    }));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---------- Templates ----------
// A small Parking Garage Rally Circuit example: every row type, ready to edit and upload.
export function templateRecord() {
  const events = [['US Track 1', 'Heavy'], ['US Track 2', 'Heavy'], ['US Track 3', 'Heavy']];
  const players = [
    { name: 'Racer One', team: 'Team Level P1', platform: 'Steam' },
    { name: 'Racer Two', team: 'Team Level P1', platform: 'Switch' },
    { name: 'Racer Three', team: 'Team Exit Only', platform: 'Steam' },
    { name: 'Racer Four', team: 'Team Exit Only', platform: 'DX' },
  ];
  const times = [
    ['Racer One', 'US Track 1', '1:04.777'], ['Racer Two', 'US Track 1', '1:05.120'], ['Racer Three', 'US Track 1', '1:06.004'],
    ['Racer One', 'US Track 2', '0:58.310'],
  ];
  return {
    id: 'my-tournament',
    tournament: {
      name: 'My PGRC Tournament', game: 'Parking Garage Rally Circuit', preset: 'pgrc', scoring: 'time', points: DEFAULT_POINTS,
      rules: PRESETS.pgrc.rules, description: 'Replace these example rows with your own.', platforms: PRESETS.pgrc.platforms,
      tracks: events.map(e => e[0]), classes: ['Heavy'], events, bracket: null,
    },
    players,
    runs: times.map(([racer, track, time]) => ({ racer, platform: players.find(p => p.name === racer).platform, track, cls: 'Heavy',
      time_ms: parseTime(time), penalty_ms: 0, penalty_note: '' })),
  };
}

export function templateCsv() {
  const csv = toCsv(templateRecord()).replace(/^﻿/, '').split('\r\n');
  // explain each row type in comment rows (row_type starting with #), which the importer skips
  const notes = [
    '# setting rows: key = id / name / game / preset (pgrc or custom) / scoring (time or points) / points / platforms / rules / description / bracket (players or teams)',
    '# event rows: a track and class that count. With preset pgrc and no event rows, all 8 US tracks in Heavy count.',
    '# player rows: who is playing (racer, team, platform). Leave them out to let any name be used.',
    '# time rows: racer, platform, track, class, time as m:ss.mmm, penalty_s optional, note optional',
    '# match rows (bracket results): key = round.match (1.1 = round 1 match 1), racer + time vs opponent + opponent_time, value = winner',
  ].map(n => csvLine([n]));
  return '﻿' + [csv[0], ...notes, ...csv.slice(1)].join('\r\n');
}
export const templateJson = () => toJson(templateRecord());
