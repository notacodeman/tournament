// admin.html, for the site owner only (Cloudflare Access plus lib/access.js on the API):
//   Live tournaments  every live tournament anyone started, with a delete button (they're also deleted
//                     automatically a week after their last change)
//   Site tournaments  tournaments run on the site: verification queue, every run, players, bracket, settings, audit log

import { $, el, api, store, toast, fitRows, formatDate, ago, VISIBLE_ROWS } from './util.js';
import { parseTime, formatTime } from '../lib/time.js';
import { PRESETS, DEFAULT_POINTS } from '../lib/presets.js';
import { overall } from '../lib/standings.js';
import { roundName } from '../lib/bracket.js';
import { formDialog, confirmDialog, playersDialog, addTimeDialog, newBracketDialog, matchDialog } from './editors.js';

const TABS = ['queue', 'runs', 'players', 'bracket', 'settings', 'audit'];
let tournaments = [];
let current = null;            // the picked tournament
let tab = 'queue';
let queueIndex = 0;
let runFilter = { status: 'all', q: '' };
let mode = 'rooms';             // 'rooms' (live tournaments) or 'site'
let roomFilter = '';

const say = (kind, text) => $('#aMsg').replaceChildren(text ? el(`div.message.${kind}`, {}, text) : '');

// ---------- Start ----------
async function start() {
  try {
    const who = await api('/api/admin/whoami');
    $('#who').textContent = `Signed in as ${who.email}`;
  } catch (err) {
    say('error', err.message);
  }
  const q = new URLSearchParams(location.search);
  mode = q.get('mode') === 'site' ? 'site' : 'rooms';
  tab = TABS.includes(q.get('tab')) ? q.get('tab') : 'queue';
  await loadList(Number(q.get('t')) || store.get('adminPick'));
  if (mode === 'site' && !tournaments.length) { tab = 'settings'; editTournament(null); }
}

async function loadList(pickId) {
  try {
    tournaments = (await api('/api/admin/tournaments')).tournaments;
  } catch (err) {
    say('error', err.message);
    return;
  }
  // the one asked for, else the one with the most to review, else a live one
  const busiest = [...tournaments].sort((a, b) => b.pending - a.pending)[0];
  current = tournaments.find(t => t.id === pickId) || (busiest?.pending ? busiest : null)
    || tournaments.find(t => t.status === 'live') || tournaments[0] || null;
  $('#pick').replaceChildren(...tournaments.map(t => el('option', { value: t.id, selected: t === current },
    `${t.name}${t.pending ? ` (${t.pending} to review)` : ''} · ${t.status}`)));
  $('#pick').hidden = !tournaments.length;
  render();
}

function render() {
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  document.querySelectorAll('.site-only').forEach(n => { n.hidden = mode !== 'site'; });
  if (mode === 'rooms') {
    history.replaceState(null, '', '?mode=rooms');
    $('#aTitle').textContent = 'Live tournaments';
    renderRooms();
    return;
  }
  history.replaceState(null, '', `?${new URLSearchParams({ mode, ...(current ? { t: current.id } : {}), tab })}`);
  document.querySelectorAll('.admin-tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('#aTitle').textContent = current ? current.name : 'Tournaments';
  $('#viewLink').href = current ? `./?t=${encodeURIComponent(current.slug)}` : './';
  $('#viewLink').hidden = !current || current.status === 'draft';
  if (!current && tab !== 'settings') { $('#aBody').replaceChildren(el('div.panel.panel-pad', {}, el('p', {}, 'No tournaments yet. Make one with + New tournament.'))); return; }
  ({ queue: renderQueue, runs: renderRuns, players: renderPlayers, bracket: renderBracket, settings: () => editTournament(current), audit: renderAudit })[tab]();
}

// ---------- Live tournaments (rooms) ----------
async function renderRooms() {
  const body = $('#aBody');
  body.replaceChildren(el('p.muted', {}, 'Loading…'));
  const { rooms, retention_days } = await api('/api/admin/rooms');
  const search = el('input', { type: 'search', placeholder: 'Name, game or code', value: roomFilter, 'aria-label': 'Search live tournaments' });
  const table = el('div.table', { style: { '--cols': 'minmax(0,1.6fr) 100px 110px 110px 150px 200px', '--cols-phone': 'minmax(0,1fr) auto' } },
    el('div.thead', {}, el('span', {}, 'Tournament'), el('span.wide', {}, 'Code'), el('span.wide', {}, 'Players · times'),
      el('span.wide', {}, 'Last change'), el('span.wide', {}, 'Auto-deletes'), el('span.r', {}, '')));
  const rows = el('div.rows');
  table.append(rows);
  const draw = () => {
    const q = roomFilter.trim().toLowerCase();
    const list = rooms.filter(r => !q || `${r.name} ${r.game} ${r.code}`.toLowerCase().includes(q));
    rows.replaceChildren(...(list.length ? list.map(r => el('div.row', {},
      el('span', {}, el('span.name', {}, r.name || '(no name)'),
        el('span.sub', {}, [r.game, r.live ? 'live' : 'ended', r.participants ? 'helpers can edit' : '', `${Math.round(r.bytes / 1024)} KB`].filter(Boolean).join(' · ')),
        el('span.sub.phone-only', {}, `${r.code} · ${r.players} players · ${r.runs} times · deletes ${formatDate(r.deletes_at)}`)),
      el('span.wide.mono', {}, r.code),
      el('span.wide', {}, `${r.players} · ${r.runs}`),
      el('span.wide.small', {}, ago(r.updated_at)),
      el('span.wide.small.muted', {}, formatDate(r.deletes_at, true)),
      el('span.r.row-actions', {},
        el('a.btn.small', { href: `watch?code=${r.code}`, target: '_blank', rel: 'noopener' }, 'Watch'),
        el('button.btn.small.danger', { type: 'button', onclick: () => confirmDialog(`Delete “${r.name}”?`,
          'It’s removed from the site now: its viewer and helper codes stop working. The host still has their own copy in their browser.',
          async () => { await api(`/api/admin/rooms/${r.code}`, { method: 'DELETE' }); toast('Deleted'); renderRooms(); }) }, 'Delete')))) : [el('div.empty', {}, rooms.length ? 'No live tournaments match.' : 'No live tournaments right now.')]));
    rows.scrollTop = 0;
    fitRows(rows, VISIBLE_ROWS);
  };
  search.addEventListener('input', () => { roomFilter = search.value; draw(); });
  body.replaceChildren(
    el('div.section-head', {}, el('h2', {}, `${rooms.length} live ${rooms.length === 1 ? 'tournament' : 'tournaments'}`), el('div.toolbar', {}, search)),
    el('p.note', {}, `Anyone can start one from the start page. Each is deleted automatically ${retention_days} days after its last change; delete one here to remove it now.`),
    table);
  draw();
}

// ---------- Queue ----------
async function renderQueue() {
  const body = $('#aBody');
  body.replaceChildren(el('p.muted', {}, 'Loading…'));
  const { runs } = await api(`/api/admin/runs?t=${current.id}&status=pending`);
  queueIndex = Math.min(queueIndex, Math.max(0, runs.length - 1));
  const addBtn = el('button.btn.small', { type: 'button', onclick: () => addTime() }, '+ Enter a time');
  if (!runs.length) {
    body.replaceChildren(el('div.host-bar', {}, el('span.note', {}, 'Nothing waiting for review.'), addBtn));
    return;
  }
  const run = runs[queueIndex];
  const list = el('div.panel.queue-list', {}, runs.map((r, i) => el('button.pick', {
    type: 'button', role: 'radio', 'aria-checked': String(i === queueIndex), onclick: () => { queueIndex = i; renderQueue(); },
  }, el('span.name', {}, r.racer), el('span.mono', {}, formatTime(r.time_ms)),
    el('span.sub', {}, `${r.track} · ${r.cls}${r.platform ? ' · ' + r.platform : ''} · ${ago(r.submitted_at)}`))));
  const timeIn = el('input.mono', { type: 'text', value: formatTime(run.time_ms), 'aria-label': 'Time' });
  const penIn = el('input', { type: 'number', min: 0, step: 0.001, placeholder: '0', 'aria-label': 'Penalty seconds' });
  const noteIn = el('input', { type: 'text', maxlength: 200, placeholder: 'e.g. wall skip at turn 4', 'aria-label': 'Penalty note' });
  const act = async (action, extra = {}) => {
    try {
      await api(`/api/admin/runs/${run.id}`, { json: { action, ...extra } });
      toast(action === 'verify' ? 'Verified' : 'Rejected');
      await loadList(current.id);
    } catch (err) { toast(err.message, 'error'); }
  };
  const better = run.previous_best && run.time_ms < run.previous_best;
  body.replaceChildren(el('div.host-bar', {}, el('span.note', {}, `${runs.length} waiting · oldest first`), addBtn),
    el('div.queue', {}, list,
      el('div.panel.queue-detail', {},
        el('div.proof', {}, run.proof_key
          ? el('a', { href: `/api/proof/${run.proof_key}`, target: '_blank', rel: 'noopener' }, el('img', { src: `/api/proof/${run.proof_key}`, alt: `Proof screenshot from ${run.racer}` }))
          : el('p.muted', {}, 'No screenshot.'),
          run.video_url ? el('a', { href: run.video_url, target: '_blank', rel: 'noopener noreferrer' }, 'Open the video ↗') : ''),
        el('div.queue-form', {},
          el('div', {}, el('div.small.muted', {}, `${run.racer} submitted`), el('div.big-time.mono', {}, formatTime(run.time_ms)),
            el('div.small.muted', {}, `${run.track} · ${run.cls}${run.platform ? ' · ' + run.platform : ''} · ${formatDate(run.submitted_at, true)}`),
            el('div.small', {}, run.previous_best ? `Their best here so far: ${formatTime(run.previous_best)}${better ? ' (this is faster)' : ' (this is slower, so it won’t change the standings)'}` : 'Their first verified time here.')),
          el('label.field', {}, 'Correct the time if it doesn’t match the proof', timeIn),
          el('div.form-grid', {}, el('label.field', {}, 'Penalty (seconds)', penIn), el('label.field', {}, 'Penalty note', noteIn)),
          el('div.form-grid', {},
            el('button.btn.good', { type: 'button', onclick: () => {
              const ms = parseTime(timeIn.value);
              if (!ms) { toast('Write the time like 1:04.777.', 'error'); return; }
              act('verify', { time: ms !== run.time_ms ? timeIn.value : undefined, penalty_s: penIn.value || undefined, penalty_note: noteIn.value || undefined });
            } }, 'Verify'),
            el('button.btn.danger', { type: 'button', onclick: () => rejectDialog(r => act('reject', { reason: r })) }, 'Reject…')),
          el('p.note', {}, 'The racer sees a reject reason on their run link. Every action here goes in the audit log.')))));
}

function rejectDialog(onReason) {
  formDialog('Reject this run', f => f.append(
    el('label.field', {}, 'Reason (the racer sees this)', el('input', { type: 'text', name: 'reason', required: true, maxlength: 300, placeholder: 'e.g. The screenshot doesn’t show the class' }))),
  async f => { if (!f.elements.reason.value.trim()) throw new Error('Give a reason.'); await onReason(f.elements.reason.value.trim()); }, { saveLabel: 'Reject', danger: true });
}

async function addTime() {
  const { players } = await api(`/api/admin/players?t=${current.id}`);
  addTimeDialog(current, players, async run => {
    await api('/api/admin/runs', { json: { tournament_id: current.id, racer: run.racer, platform: run.platform, track: run.track, cls: run.cls,
      time: formatTime(run.time_ms), penalty_s: run.penalty_ms / 1000, penalty_note: run.penalty_note } });
    toast('Time entered and verified');
    render();
  });
}

// ---------- All runs ----------
async function renderRuns() {
  const body = $('#aBody');
  const { runs } = await api(`/api/admin/runs?t=${current.id}&status=all`);
  const status = el('select', { 'aria-label': 'Status', onchange: e => { runFilter.status = e.target.value; renderRuns(); } },
    ...['all', 'pending', 'verified', 'rejected'].map(s => el('option', { value: s, selected: runFilter.status === s }, s === 'all' ? 'All statuses' : s)));
  const search = el('input', { type: 'search', placeholder: 'Racer or track', value: runFilter.q, 'aria-label': 'Search runs' });
  search.addEventListener('input', () => { runFilter.q = search.value; draw(); });
  const table = el('div.table', { style: { '--cols': 'minmax(0,1fr) 120px minmax(0,1fr) 110px 120px', '--cols-phone': 'minmax(0,1fr) auto' } },
    el('div.thead', {}, el('span', {}, 'Racer'), el('span.r', {}, 'Time'), el('span.wide', {}, 'Track · class'), el('span', {}, 'Status'), el('span.wide', {}, 'Submitted')));
  const rows = el('div.rows');
  table.append(rows);
  function draw() {
    const q = runFilter.q.trim().toLowerCase();
    const list = runs.filter(r => (runFilter.status === 'all' || r.status === runFilter.status)
      && (!q || `${r.racer} ${r.track} ${r.cls}`.toLowerCase().includes(q)));
    rows.replaceChildren(...(list.length ? list.map(r => el('div.row.clickable', { role: 'button', tabindex: '0', onclick: () => runDialog(r),
      onkeydown: e => { if (e.key === 'Enter') runDialog(r); } },
      el('span', {}, el('span.name', {}, r.racer), el('span.sub', {}, r.platform)),
      el('span.r.mono', {}, formatTime(r.time_ms + r.penalty_ms)),
      el('span.wide', {}, `${r.track} · ${r.cls}`),
      el('span', {}, el(`span.chip.${r.status}`, {}, r.status)),
      el('span.wide.small.muted', {}, formatDate(r.submitted_at, true)))) : [el('div.empty', {}, 'No runs match.')]));
    rows.scrollTop = 0;
    fitRows(rows, VISIBLE_ROWS);
  }
  body.replaceChildren(el('div.section-head', {}, el('h2', {}, 'All runs'), el('div.toolbar', {}, status, search)), table);
  draw();
}

function runDialog(run) {
  formDialog(`${run.racer} · ${run.track} · ${run.cls}`, f => f.append(
    el('p', {}, el(`span.chip.${run.status}`, {}, run.status), run.reject_reason ? ` Reason: ${run.reject_reason}` : ''),
    el('div.form-grid', {},
      el('label.field', {}, 'Racer', el('input', { type: 'text', name: 'racer', value: run.racer, maxlength: 32 })),
      el('label.field', {}, 'Time', el('input.mono', { type: 'text', name: 'time', value: formatTime(run.time_ms) })),
      el('label.field', {}, 'Penalty (seconds)', el('input', { type: 'number', name: 'penalty', min: 0, step: 0.001, value: run.penalty_ms / 1000 })),
      el('label.field', {}, 'Penalty note', el('input', { type: 'text', name: 'note', value: run.penalty_note, maxlength: 200 })),
      el('label.field.wide', {}, 'Status after saving', el('select', { name: 'action' },
        el('option', { value: 'update' }, `Keep: ${run.status}`),
        run.status !== 'verified' ? el('option', { value: 'verify' }, 'Verify') : '',
        run.status !== 'pending' ? el('option', { value: 'reopen' }, 'Back to pending') : '',
        run.status !== 'rejected' ? el('option', { value: 'reject' }, 'Reject') : '')),
      el('label.field.wide', {}, 'Reject reason (only when rejecting)', el('input', { type: 'text', name: 'reason', maxlength: 300 }))),
    el('button.btn.small.danger', { type: 'button', onclick: e => { e.target.closest('dialog').close(); confirmDialog('Delete this run?',
      `${run.racer}: ${formatTime(run.time_ms)} on ${run.track} · ${run.cls}, with its screenshot. The audit log keeps a line saying it was deleted.`,
      async () => { await api(`/api/admin/runs/${run.id}`, { method: 'DELETE' }); toast('Run deleted'); await loadList(current.id); }); } }, 'Delete run')),
  async f => {
    const v = f.elements;
    const body = { action: v.action.value, racer: v.racer.value, time: v.time.value, penalty_s: v.penalty.value, penalty_note: v.note.value, reason: v.reason.value };
    if (body.action === 'update' && body.racer === run.racer && parseTime(body.time) === run.time_ms && Number(body.penalty_s) * 1000 === run.penalty_ms && body.penalty_note === run.penalty_note) return;
    await api(`/api/admin/runs/${run.id}`, { json: body });
    toast('Saved');
    await loadList(current.id);
  });
}

// ---------- Players ----------
async function renderPlayers() {
  const { players } = await api(`/api/admin/players?t=${current.id}`);
  const edit = el('button.btn.small', { type: 'button', onclick: () => playersDialog(players, async list => {
    await api('/api/admin/players', { method: 'PUT', json: { tournament_id: current.id, players: list } });
    toast('Players saved');
    await loadList(current.id);
  }) }, players.length ? 'Edit players' : 'Add players');
  const table = el('div.table', { style: { '--cols': '56px minmax(0,1fr) minmax(0,1fr) 120px', '--cols-phone': '40px minmax(0,1fr)' } },
    el('div.thead', {}, el('span', {}, 'Seed'), el('span', {}, 'Player'), el('span.wide', {}, 'Team'), el('span.wide', {}, 'Platform')),
    el('div.rows', {}, players.length ? players.map(p => el('div.row', {}, el('span.pos', {}, String(p.seed).padStart(2, '0')),
      el('span.name', {}, p.name), el('span.wide', {}, p.team || '—'), el('span.wide', {}, p.platform || '—'))) : el('div.empty', {}, 'No player list: anyone can submit a time.')));
  $('#aBody').replaceChildren(el('div.host-bar', {}, el('span.note', {}, 'When a tournament has a player list, only these names can submit. Order = seed order.'), edit), table);
}

// ---------- Bracket ----------
async function renderBracket() {
  const b = current.bracket;
  const save = async (next, msg) => {
    await api('/api/admin/bracket', { method: 'PUT', json: { tournament_id: current.id, bracket: next } });
    toast(msg);
    await loadList(current.id);
  };
  const create = el('button.btn.small', { type: 'button', onclick: async () => {
    const [{ players }, pub] = await Promise.all([api(`/api/admin/players?t=${current.id}`),
      current.status === 'draft' ? Promise.resolve({ runs: [] }) : api(`/api/tournaments/${encodeURIComponent(current.slug)}`)]);
    const names = overall(current, pub.runs).rows.map(r => r.name);
    if (players.length + names.length < 2) { toast('Add players first (Players tab).', 'error'); return; }
    newBracketDialog(players, names, next => save(next, 'Bracket created'));
  } }, b ? 'New bracket' : 'Create a bracket');
  const remove = b ? el('button.btn.small.danger', { type: 'button', onclick: () => confirmDialog('Remove the bracket?', 'All match results in it are lost.', () => save(null, 'Bracket removed'), 'Remove') }, 'Remove bracket') : '';
  if (!b) { $('#aBody').replaceChildren(el('div.host-bar', {}, el('span.note', {}, 'No bracket yet.'), create)); return; }
  const slot = (m, s, r) => el(`div.slot${m.winner === s ? '.won' : ''}${m.winner && m.winner !== s ? '.lost' : ''}${m[s] ? '' : '.tbd'}`, {},
    el('span.slot-name', {}, m[s] || (r === 0 && (m.a || m.b) ? 'bye' : 'TBD')), el('span.slot-time.mono', {}, m[`${s}_ms`] ? formatTime(m[`${s}_ms`]) : ''));
  $('#aBody').replaceChildren(el('div.host-bar', {}, el('span.note', {}, 'Click a match to record it. Winners move on automatically.'), create, remove),
    el('div.bracket-scroll', {}, el('div.bracket', { style: { '--rounds': b.rounds.length } }, b.rounds.map((round, r) => el('div.round', {},
      el('div.round-name', {}, roundName(r, b.rounds.length)),
      el('div.round-matches', {}, round.map((m, i) => (m.a && m.b
        ? el('button.match', { type: 'button', onclick: () => matchDialog(structuredClone(b), r, i, next => save(next, 'Result saved')) }, slot(m, 'a', r), slot(m, 'b', r))
        : el('div.match', {}, slot(m, 'a', r), slot(m, 'b', r))))))))));
}

// ---------- Settings (create and edit) ----------
const toLocalInput = iso => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const fromLocalInput = v => (v ? new Date(v).toISOString().replace(/\.\d{3}Z$/, 'Z') : null);

function editTournament(t) {
  const isNew = !t;
  const base = t || { name: '', slug: '', status: 'draft', scoring: 'time', points: DEFAULT_POINTS, preset: 'pgrc', ...structuredClone(PRESETS.pgrc), description: '', starts_at: null, ends_at: null };
  let events = new Set(base.events.map(e => e.join('\u0000')));
  const f = el('form.panel.panel-pad.settings');
  const field = (label, input, note, wide) => el(`label.field${wide ? '.wide' : ''}`, {}, label, input, note ? el('span.note', {}, note) : '');
  const inp = (name, value, attrs = {}) => el('input', { type: 'text', name, value: value ?? '', ...attrs });
  const sel = (name, options, value) => el('select', { name }, options.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
  const tracksBox = el('textarea', { name: 'tracks', rows: 8 }, base.tracks.join('\n'));
  const classesBox = el('textarea', { name: 'classes', rows: 4 }, base.classes.join('\n'));
  const grid = el('div.grid-table.edit-grid');
  function drawGrid() {
    const tracks = tracksBox.value.split('\n').map(s => s.trim()).filter(Boolean);
    const classes = classesBox.value.split('\n').map(s => s.trim()).filter(Boolean);
    grid.style.setProperty('--n', classes.length);
    grid.replaceChildren(el('span.h', {}, 'Track'), ...classes.map(c => el('span.h', {}, c)),
      ...tracks.flatMap(tr => [el('span', {}, tr), ...classes.map(c => {
        const key = `${tr}\u0000${c}`;
        return el(`button.cell${events.has(key) ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(events.has(key)), 'aria-label': `${tr} ${c}`,
          onclick: () => { events.has(key) ? events.delete(key) : events.add(key); drawGrid(); } }, events.has(key) ? '✓' : '');
      })]));
  }
  tracksBox.addEventListener('input', drawGrid);
  classesBox.addEventListener('input', drawGrid);
  const nameIn = inp('name', base.name, { maxlength: 80, required: true });
  const slugIn = inp('slug', base.slug, { maxlength: 49, pattern: '[a-z0-9][a-z0-9-]+' });
  nameIn.addEventListener('input', () => { if (isNew) slugIn.value = nameIn.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 49); });
  const presetSel = sel('preset', Object.entries(PRESETS).map(([k, p]) => [k, p.label]), base.preset);
  const applyPreset = el('button.btn.small', { type: 'button', onclick: () => {
    const p = PRESETS[presetSel.value];
    f.elements.game.value = p.game;
    tracksBox.value = p.tracks.join('\n');
    classesBox.value = p.classes.join('\n');
    f.elements.platforms.value = p.platforms.join(', ');
    f.elements.proof.value = p.proof;
    f.elements.no_cheats.checked = p.noCheats;
    if (!f.elements.rules.value) f.elements.rules.value = p.rules;
    events = new Set(p.events.map(e => e.join('\u0000')));
    drawGrid();
  } }, 'Fill from preset');
  f.append(
    el('div.section-head', {}, el('h2', {}, isNew ? 'New tournament' : 'Settings')),
    el('div.form-grid', {},
      field('Name', nameIn),
      field('Link name', slugIn, 'Used in its address: ?t=link-name'),
      field('Preset', el('div.announce-row', {}, presetSel, applyPreset)),
      field('Game', inp('game', base.game, { maxlength: 80 })),
      field('Status', sel('status', [['draft', 'Draft (hidden)'], ['registration', 'Upcoming'], ['live', 'Live: taking times'], ['finished', 'Finished']], base.status)),
      field('Scoring', sel('scoring', [['time', 'Lowest total time'], ['points', 'Points per place']], base.scoring)),
      field('Points for 1st, 2nd…', inp('points', (base.points?.length ? base.points : DEFAULT_POINTS).join(' ')), 'Only used with points scoring'),
      field('Proof', sel('proof', [['screenshot', 'Screenshot required'], ['any', 'Screenshot or video'], ['none', 'None']], base.proof)),
      field('Starts', el('input', { type: 'datetime-local', name: 'starts_at', value: toLocalInput(base.starts_at) }), 'Your time zone; optional'),
      field('Ends', el('input', { type: 'datetime-local', name: 'ends_at', value: toLocalInput(base.ends_at) }), 'Times after this are refused'),
      field('Platforms', inp('platforms', base.platforms.join(', ')), 'Comma-separated', true),
      field('Tracks / levels', tracksBox, 'One per line'),
      field('Classes / categories', classesBox, 'One per line'),
      el('div.field.wide', {}, el('span', {}, 'Event grid ', el('span.note', {}, 'Tick the track and class pairs that count.')), grid),
      el('label.check.wide', {}, el('input', { type: 'checkbox', name: 'no_cheats', checked: !!(base.no_cheats ?? base.noCheats) }), el('span', {}, 'Racers must confirm no cheat codes were active')),
      field('Description', el('textarea', { name: 'description', rows: 3 }, base.description || ''), '', true),
      field('Rules', el('textarea', { name: 'rules', rows: 5 }, base.rules || ''), '', true)),
    el('div.foot', {},
      isNew ? '' : el('button.btn.danger', { type: 'button', onclick: () => confirmDialog(`Delete “${t.name}”?`,
        'Deletes the tournament with all its runs, players, screenshots and audit log. This can’t be undone.',
        async () => { await api(`/api/admin/tournaments/${t.id}`, { method: 'DELETE' }); toast('Tournament deleted'); tab = 'queue'; await loadList(null); }, 'Delete') }, 'Delete tournament'),
      el('button.btn.primary', { type: 'submit' }, isNew ? 'Create tournament' : 'Save changes')));
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const v = f.elements;
    const tracks = tracksBox.value.split('\n').map(s => s.trim()).filter(Boolean);
    const classes = classesBox.value.split('\n').map(s => s.trim()).filter(Boolean);
    const body = {
      name: v.name.value, slug: v.slug.value, game: v.game.value, preset: v.preset.value, status: v.status.value, scoring: v.scoring.value,
      points: v.points.value.split(/[\s,]+/).filter(Boolean).map(Number), proof: v.proof.value, no_cheats: v.no_cheats.checked,
      starts_at: fromLocalInput(v.starts_at.value), ends_at: fromLocalInput(v.ends_at.value),
      platforms: v.platforms.value.split(',').map(s => s.trim()).filter(Boolean), tracks, classes,
      events: tracks.flatMap(tr => classes.filter(c => events.has(`${tr}\u0000${c}`)).map(c => [tr, c])),
      description: v.description.value, rules: v.rules.value,
    };
    try {
      const res = isNew ? await api('/api/admin/tournaments', { json: body }) : await api(`/api/admin/tournaments/${t.id}`, { method: 'PUT', json: body });
      toast(isNew ? 'Tournament created' : res.changed?.length ? `Saved: ${res.changed.join(', ')}` : 'No changes');
      if (isNew) tab = 'queue';
      await loadList(isNew ? res.id : t.id);
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#aBody').replaceChildren(f);
  drawGrid();
}

// ---------- Audit log ----------
async function renderAudit() {
  const { rows } = await api(`/api/admin/audit?t=${current.id}`);
  $('#aBody').replaceChildren(el('div.section-head', {}, el('h2', {}, 'Audit log'), el('span.small.muted', {}, 'Newest first · view only')),
    el('div.panel.panel-pad', {}, rows.length ? el('ul.activity', {}, rows.map(r => el('li', {},
      el('span.chip.draft', {}, r.action), ' ', r.detail,
      el('span.when', {}, `${formatDate(r.at, true)}${r.by ? ' · ' + r.by : ''}`)))) : el('p.muted', {}, 'Nothing yet.')));
}

// ---------- Wiring ----------
document.querySelectorAll('.admin-tabs [data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.mode;
  if (mode === 'site' && !tournaments.length) { render(); tab = 'settings'; editTournament(null); return; }
  render();
}));
$('#pick').addEventListener('change', e => {
  current = tournaments.find(t => t.id === Number(e.target.value));
  store.set('adminPick', current.id);
  queueIndex = 0;
  render();
});
$('#newT').addEventListener('click', () => { tab = 'settings'; document.querySelectorAll('.admin-tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === 'settings'))); editTournament(null); });
window.addEventListener('unhandledrejection', e => say('error', e.reason?.message || String(e.reason)));
start();
