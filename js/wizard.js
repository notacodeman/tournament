// The setup guide on index.html: creates a tournament step by step, no file needed. Builds the same data a tournament
// file would (js/files.js buildModel checks it), saves it in this browser, and can put it live straight away.

import { $, el, toast } from './util.js';
import { PRESETS, DEFAULT_POINTS } from '../lib/presets.js';
import { checkTexts } from '../lib/moderation.js';
import { buildModel } from './files.js';
import { local, recordFromModel } from './local.js';
import { startRoom } from './room.js';

const STEPS = ['Game', 'Tracks', 'What counts', 'Scoring', 'Players', 'Finish'];
const lines = text => [...new Set(String(text).split('\n').map(s => s.trim()).filter(Boolean))];

let step = 0;
let draft = null;
let onDone = null;

function freshDraft() {
  const p = PRESETS.pgrc;
  return {
    preset: 'pgrc', game: p.game,
    tracks: p.tracks.join('\n'), classes: p.classes.join('\n'),
    events: new Set(p.events.map(e => e.join('\u0000'))),
    scoring: 'time', points: DEFAULT_POINTS.join(' '),
    players: '', platforms: p.platforms.join(', '),
    name: '', description: '', rules: p.rules,
    goLive: false, participants: false,
  };
}

export function openWizard(done) {
  onDone = done;
  draft = freshDraft();
  step = 0;
  render();
}

// ---------- Steps ----------
const choice = (name, value, checked, title, text) => el('label.choice', {},
  el('input', { type: 'radio', name, value, checked }), el('span', {}, el('b', {}, title), el('span.note', {}, text)));

const views = [
  // 1 · Game
  () => [
    el('h2', {}, 'What are you playing?'),
    el('div.choices', {},
      choice('preset', 'pgrc', draft.preset === 'pgrc', 'Parking Garage Rally Circuit', '16 tracks (US and Europe), Light, Heavy and Ultra classes, filled in for you.'),
      choice('preset', 'custom', draft.preset === 'custom', 'Another game', 'Any game with a timer. You’ll name the tracks or levels next.')),
    el('label.field', { id: 'gameField', hidden: draft.preset === 'pgrc' }, 'Game name',
      el('input', { type: 'text', name: 'game', maxlength: 80, value: draft.preset === 'pgrc' ? '' : draft.game, placeholder: 'e.g. Trackmania' })),
  ],
  // 2 · Tracks and classes
  () => [
    el('h2', {}, 'Tracks and classes'),
    el('p.note', {}, draft.preset === 'pgrc'
      ? 'These are filled in from the game. The track names are placeholders, so rename them to match the game if you like.'
      : 'Tracks are the levels, maps or courses. Classes are how runs are split: car classes, categories like Any% and 100%, or just one.'),
    el('div.form-grid', {},
      el('label.field', {}, 'Tracks or levels', el('textarea', { name: 'tracks', rows: 10, placeholder: 'One per line' }, draft.tracks), el('span.note', {}, 'One per line')),
      el('label.field', {}, 'Classes or categories', el('textarea', { name: 'classes', rows: 10, placeholder: 'e.g. Any%' }, draft.classes), el('span.note', {}, 'One per line. Only one? Write Any%, or Open.'))),
  ],
  // 3 · What counts
  () => {
    const tracks = lines(draft.tracks);
    const classes = lines(draft.classes);
    const grid = el('div.grid-table.wiz-grid', { style: { '--n': classes.length } });
    const draw = () => {
      grid.replaceChildren(el('span.h', {}, 'Track'), ...classes.map(c => el('button.h.col-toggle', { type: 'button', title: `Toggle every track in ${c}`, onclick: () => {
        const keys = tracks.map(t => `${t}\u0000${c}`);
        const all = keys.every(k => draft.events.has(k));
        keys.forEach(k => (all ? draft.events.delete(k) : draft.events.add(k)));
        draw(); count();
      } }, c)),
      ...tracks.flatMap(t => [el('span', {}, t), ...classes.map(c => {
        const k = `${t}\u0000${c}`;
        const on = draft.events.has(k);
        return el(`button.cell${on ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(on), 'aria-label': `${t} in ${c}`,
          onclick: () => { on ? draft.events.delete(k) : draft.events.add(k); draw(); count(); } }, on ? '✓' : '');
      })]));
    };
    const counter = el('span.note');
    const count = () => { counter.textContent = `${[...draft.events].filter(k => { const [t, c] = k.split('\u0000'); return tracks.includes(t) && classes.includes(c); }).length} counted`; };
    draw(); count();
    return [
      el('h2', {}, 'Which ones count?'),
      el('p.note', {}, 'Tick each track and class that counts toward the standings. Each one is an event: racers set their best time on it. Click a class name to tick or untick its whole column.'),
      el('div.toolbar', {},
        el('button.btn.small', { type: 'button', onclick: () => { tracks.forEach(t => classes.forEach(c => draft.events.add(`${t}\u0000${c}`))); draw(); count(); } }, 'Everything'),
        el('button.btn.small', { type: 'button', onclick: () => { draft.events.clear(); draw(); count(); } }, 'Nothing'),
        counter),
      el('div.wiz-grid-wrap', {}, grid),
    ];
  },
  // 4 · Scoring
  () => [
    el('h2', {}, 'How does someone win?'),
    el('div.choices', {},
      choice('scoring', 'time', draft.scoring === 'time', 'Lowest total time', 'Each racer’s best time on every event, added up. Best for time attacks.'),
      choice('scoring', 'points', draft.scoring === 'points', 'Points per place', 'Points for 1st, 2nd, 3rd… on each event, added up. Racers who skip an event don’t lose everything.')),
    el('label.field', { id: 'pointsField', hidden: draft.scoring !== 'points' }, 'Points for 1st, 2nd, 3rd…',
      el('input', { type: 'text', name: 'points', value: draft.points }), el('span.note', {}, 'Separated by spaces. Places past the end get 0.')),
  ],
  // 5 · Players
  () => [
    el('h2', {}, 'Who’s playing?'),
    el('p.note', {}, 'Optional. With a player list, only these names can have times, and brackets and the wheel can use it. You can change it later.'),
    el('label.field', {}, 'Players', el('textarea', { name: 'players', rows: 9, spellcheck: 'false', placeholder: 'driftking, Team Level P1, Steam\nska_wheel, , Switch\nsaturn_kid' }, draft.players),
      el('span.note', {}, 'One per line: name, then team and platform if you want them. The order is the seed order.')),
    el('label.field', {}, 'Platforms', el('input', { type: 'text', name: 'platforms', value: draft.platforms, placeholder: 'e.g. Steam, Switch' }),
      el('span.note', {}, 'Comma-separated. Leave empty if it doesn’t matter.')),
  ],
  // 6 · Name, rules, go live
  () => {
    const tracks = lines(draft.tracks);
    const classes = lines(draft.classes);
    const events = [...draft.events].filter(k => { const [t, c] = k.split('\u0000'); return tracks.includes(t) && classes.includes(c); }).length;
    const players = lines(draft.players).length;
    return [
      el('h2', {}, 'Name it and finish'),
      el('label.field', {}, 'Tournament name', el('input', { type: 'text', name: 'name', maxlength: 80, required: true, value: draft.name, placeholder: 'e.g. Friday Night Heats' })),
      el('label.field', {}, 'Description', el('input', { type: 'text', name: 'description', maxlength: 300, value: draft.description, placeholder: 'Optional, one line' })),
      el('label.field', {}, 'Rules', el('textarea', { name: 'rules', rows: 5 }, draft.rules)),
      el('div.wiz-summary', {},
        el('span', {}, el('b', {}, draft.preset === 'pgrc' ? 'Parking Garage Rally Circuit' : (draft.game || 'Custom game'))),
        el('span', {}, `${events} ${events === 1 ? 'event' : 'events'}`),
        el('span', {}, draft.scoring === 'points' ? 'Points per place' : 'Lowest total time'),
        el('span', {}, players ? `${players} players` : 'No player list')),
      el('label.check', {}, el('input', { type: 'checkbox', name: 'goLive', checked: draft.goLive }),
        el('span', {}, el('b', {}, 'Go live now. '), 'Shares it under a short code so people can watch it update. You can also do this later.')),
      el('label.check', { id: 'partField', hidden: !draft.goLive }, el('input', { type: 'checkbox', name: 'participants', checked: draft.participants }),
        el('span', {}, el('b', {}, 'Let helpers edit. '), 'Makes a second code that lets others add times and bracket results.')),
      el('p.note', {}, 'Saved in this browser. A live copy is removed from the site a week after its last change.'),
    ];
  },
];

// ---------- Reading and checking each step ----------
function read() {
  const f = $('#wizForm').elements;
  const val = n => (f[n] ? f[n].value : undefined);
  if (step === 0) {
    const preset = [...f.preset].find(r => r.checked).value;
    if (preset !== draft.preset) {
      const p = PRESETS[preset];
      Object.assign(draft, { preset, tracks: preset === 'pgrc' ? p.tracks.join('\n') : '', classes: preset === 'pgrc' ? p.classes.join('\n') : 'Any%',
        events: new Set(preset === 'pgrc' ? p.events.map(e => e.join('\u0000')) : []), platforms: p.platforms.join(', '), rules: p.rules });
    }
    draft.game = preset === 'pgrc' ? PRESETS.pgrc.game : String(val('game') || '').trim();
  }
  if (step === 1) { draft.tracks = val('tracks'); draft.classes = val('classes'); }
  if (step === 3) { draft.scoring = [...f.scoring].find(r => r.checked).value; draft.points = val('points'); }
  if (step === 4) { draft.players = val('players'); draft.platforms = val('platforms'); }
  if (step === 5) {
    draft.name = String(val('name')).trim(); draft.description = val('description'); draft.rules = val('rules');
    draft.goLive = f.goLive.checked; draft.participants = f.participants.checked;
  }
}

function check() {
  const tracks = lines(draft.tracks);
  const classes = lines(draft.classes);
  if (step === 0 && draft.preset === 'custom' && !draft.game) return 'Enter the game’s name.';
  if (step === 1) {
    if (!tracks.length) return 'Add at least one track or level.';
    if (!classes.length) return 'Add at least one class. Only one? Write Any%.';
    if (tracks.length > 100 || classes.length > 20) return 'That’s more than 100 tracks or 20 classes.';
    // a brand-new custom list starts with everything ticked; later edits keep what was ticked
    if (!draft.events.size) tracks.forEach(t => classes.forEach(c => draft.events.add(`${t}\u0000${c}`)));
    return checkTexts([['A track name', tracks], ['A class name', classes], ['The game name', draft.game]]);
  }
  if (step === 2 && ![...draft.events].some(k => { const [t, c] = k.split('\u0000'); return tracks.includes(t) && classes.includes(c); })) return 'Tick at least one track and class.';
  if (step === 3 && draft.scoring === 'points' && !String(draft.points).split(/[\s,]+/).filter(Boolean).every(n => /^\d+$/.test(n))) return 'Points must be whole numbers, like 25 18 15.';
  if (step === 4) {
    const names = lines(draft.players).map(l => l.split(',')[0].trim());
    if (names.some(n => n.length > 32)) return 'Player names can be up to 32 characters.';
    if (new Set(names.map(n => n.toLowerCase())).size !== names.length) return 'A player is listed twice.';
    return checkTexts([['A player name', lines(draft.players)], ['A platform', draft.platforms.split(',')]]);
  }
  if (step === 5) {
    if (!draft.name) return 'Give the tournament a name.';
    return checkTexts([['The name', draft.name], ['The description', draft.description], ['The rules', draft.rules]]);
  }
  return null;
}

// ---------- Rendering ----------
function render() {
  $('#wizSteps').replaceChildren(...STEPS.map((label, i) => el(`li${i === step ? '.now' : i < step ? '.done' : ''}`, { 'aria-current': i === step ? 'step' : null }, el('span', {}, String(i + 1)), label)));
  $('#wizBody').replaceChildren(...views[step]());
  $('#wizMsg').replaceChildren();
  $('#wizBack').textContent = step ? 'Back' : 'Cancel';
  $('#wizNext').textContent = step === STEPS.length - 1 ? 'Create tournament' : 'Next';
  $('#wizCount').textContent = `Step ${step + 1} of ${STEPS.length}`;
  // show fields only when they apply
  $('#wizForm').querySelectorAll('input[name=preset]').forEach(r => r.addEventListener('change', () => { $('#gameField').hidden = r.value === 'pgrc' || !r.checked; }));
  $('#wizForm').querySelectorAll('input[name=scoring]').forEach(r => r.addEventListener('change', () => { $('#pointsField').hidden = r.value !== 'points' || !r.checked; }));
  const live = $('#wizForm').elements.goLive;
  live?.addEventListener('change', () => { $('#partField').hidden = !live.checked; });
  $('#wizBody').querySelector('input:not([type=radio]):not([type=checkbox]), textarea')?.focus({ preventScroll: true });
}

async function finish() {
  const raw = {
    name: draft.name, game: draft.game, preset: draft.preset, scoring: draft.scoring, description: draft.description, rules: draft.rules,
    points: String(draft.points).split(/[\s,]+/).filter(Boolean).map(Number),
    platforms: draft.platforms.split(',').map(s => s.trim()).filter(Boolean),
    tracks: lines(draft.tracks), classes: lines(draft.classes),
    events: lines(draft.tracks).flatMap(t => lines(draft.classes).filter(c => draft.events.has(`${t}\u0000${c}`)).map(c => [t, c])),
    players: lines(draft.players).map(l => { const [name, team = '', platform = ''] = l.split(',').map(s => s.trim()); return { name, team, platform }; }),
    times: [],
  };
  const { model, errors } = buildModel(raw);
  if (errors) throw new Error(errors[0]);
  const { record } = recordFromModel(model);
  local.save(record);
  if (draft.goLive) {
    try {
      const res = await startRoom(record, draft.participants);
      record.room = { code: res.code, host_key: res.host_key, edit_code: res.edit_code };
      local.save(record);
    } catch (err) {
      toast(`Saved, but it couldn’t go live: ${err.message} You can try again with Go live.`, 'error');
    }
  }
  onDone?.(record);
}

// ---------- Wiring ----------
$('#wizForm').addEventListener('input', () => $('#wizMsg').replaceChildren());
$('#wizForm').addEventListener('submit', async e => {
  e.preventDefault();
  read();
  const problem = check();
  if (problem) { $('#wizMsg').replaceChildren(el('div.message.error', {}, problem)); return; }
  if (step < STEPS.length - 1) { step += 1; render(); window.scrollTo(0, 0); return; }
  $('#wizNext').disabled = true;
  try { await finish(); } catch (err) { $('#wizMsg').replaceChildren(el('div.message.error', {}, err.message)); } finally { $('#wizNext').disabled = false; }
});
$('#wizBack').addEventListener('click', () => {
  if (!step) { onDone?.(null); return; }
  read();
  step -= 1;
  render();
});
