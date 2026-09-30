// The tournament view on index.html: header, live strip, stats, and the Overall / By track / Bracket / Players /
// Activity / Wheel / Rules tabs, plus the floating timer. It shows one of:
//   site  a tournament run from the admin page (read-only here, refreshed every REFRESH_MS)
//   local a tournament saved in this browser; the host edits it right here, and can put it live
//   room  a live tournament joined with a participant code (enter your own times) or a mod code (run the tournament)
// A local tournament that's live is a room too: changes go to the site's database and it checks for others' changes
// every POLL_MS, keeping a copy in this browser. Standings are worked out in the browser with lib/standings.js.

import { $, el, api, me, store, toast, fitRows, formatDate, dateRange, ago, formatLine, downloadCsv, STATUS_LABEL, VISIBLE_ROWS } from './util.js';
import { formatTime, formatGap } from '../lib/time.js';
import { overall, eventKey, racerKey } from '../lib/standings.js';
import { roundName, champion } from '../lib/bracket.js';
import { mountWheel } from './wheel.js';
import { floatingTimer, timer } from './timer.js';
import { local, viewData } from './local.js';
import { toCsv, toJson } from './files.js';
import { formDialog, confirmDialog, playersDialog, addTimeDialog, newBracketDialog, matchDialog } from './editors.js';
import { POLL_MS, startRoom, getRoom, sendOp, stripRoom, prettyCode, watchUrl, joinUrl } from './room.js';

const REFRESH_MS = 15000;
const TABS = ['overall', 'track', 'bracket', 'players', 'activity', 'wheel', 'rules'];

let source = null;       // { kind: 'site', slug } | { kind: 'local', id } | { kind: 'room', code, name, role }
let roomRecord = null;   // the live tournament as the server keeps it (mods build whole-tournament changes from it)
let data = null;         // what's shown, in the API's shape; data.room is set for live rooms
let version = 0;         // last room version seen
let state = { tab: 'overall', event: 0, platform: '', open: null };
let pollTimer = null;
let wheelMountedFor = null;
let floating = null;

// ---------- Who can do what ----------
const localRecord = () => (source?.kind === 'local' ? local.get(source.id) : null);
// the live room behind what's shown: { code, hostKey, role } or null
function room() {
  if (source?.kind === 'room') return { code: source.code, role: data?.room?.role || source.role || 'participant' };
  const rec = localRecord();
  return rec?.room ? { code: rec.room.code, hostKey: rec.room.host_key, role: 'host' } : null;
}
// isHost: the tournament is saved in this browser (download it, put it live, change its codes)
// canManage: host or mod: any time, bracket, players, timer, messages, end/reopen
// canEdit: anyone who can enter times (participants only their own)
const isHost = () => source?.kind === 'local';
const isParticipant = () => source?.kind === 'room' && room()?.role === 'participant';
const canManage = () => isHost() || (source?.kind === 'room' && room()?.role === 'mod');
const canEdit = () => canManage() || isParticipant();
const byName = () => (source?.kind === 'room' ? source.name : isHost() ? 'host' : '');
const ownRun = run => !isParticipant() || run.racer.toLowerCase() === String(source.name || '').toLowerCase();

// ---------- URL state (shareable views) ----------
function readUrl() {
  const q = new URLSearchParams(location.search);
  state.tab = TABS.includes(q.get('tab')) ? q.get('tab') : 'overall';
  state.event = Math.max(0, Number(q.get('event')) || 0);
  state.platform = q.get('platform') || '';
  state.open = null;
}
function writeUrl() {
  const base = source.kind === 'site' ? { t: source.slug } : source.kind === 'local' ? { local: source.id } : { room: source.code };
  const q = new URLSearchParams(base);
  if (state.tab !== 'overall') q.set('tab', state.tab);
  if (state.tab === 'track' && state.event) q.set('event', state.event);
  if (state.platform) q.set('platform', state.platform);
  history.replaceState(null, '', `?${q}`);
}

// ---------- Loading ----------
export async function openTournament(src) {
  source = src;
  data = null;
  version = 0;
  readUrl();
  wheelMountedFor = null;
  $('#tMain').replaceChildren(el('p.muted', {}, 'Loading…'));
  $('#tSide').replaceChildren();
  $('#tLiveStrip').replaceChildren();
  await load();
  if (floating?.wasOpen()) floating.open();
  schedule();
}

function schedule() {
  clearInterval(pollTimer);
  if (!source) return;
  const every = room() ? POLL_MS : source.kind === 'site' ? REFRESH_MS : 0;
  if (every) pollTimer = setInterval(() => { if (!document.hidden && !$('#view').hidden) load(true); }, every);
}

export function closeTournament() {
  clearInterval(pollTimer);
  floating?.close();
  data = null;
  source = null;
}

async function load(quiet = false) {
  if (!source) return;
  const r = room();
  if (r) return loadRoom(r, quiet);
  if (source.kind === 'local') {
    const record = localRecord();
    if (!record) { $('#tMain').replaceChildren(el('div.message.error', {}, 'That tournament isn’t saved in this browser any more.')); return; }
    data = viewData(record);
    render();
    return;
  }
  try {
    const fresh = await api(`/api/tournaments/${encodeURIComponent(source.slug)}`);
    const same = data && JSON.stringify({ ...fresh, now: 0 }) === JSON.stringify({ ...data, now: 0 });
    data = fresh;
    if (!quiet || !same) render();
  } catch (err) {
    if (!quiet) $('#tMain').replaceChildren(el('div.message.error', {}, err.message));
  }
}

async function loadRoom(r, quiet) {
  let res;
  try {
    res = await getRoom(r.code, { since: quiet ? version : 0, hostKey: r.hostKey });
  } catch (err) {
    if (/No live tournament/.test(err.message) && r.role === 'host') {
      // the room is gone from the site: carry on with the copy in this browser
      const rec = localRecord();
      delete rec.room;
      local.save(rec);
      toast('That live session no longer exists on the site. The tournament is still saved here.', 'error');
      schedule();
      return load();
    }
    if (/No live tournament/.test(err.message) && source.kind === 'room') {
      // the host ended the room, or made a new code / turned this one off
      clearInterval(pollTimer);
      $('#tLiveStrip').replaceChildren();
      $('#tMain').replaceChildren(el('div.message.error', {}, 'This code doesn’t work any more. The host may have made a new one: ask them for it and join again.'));
      $('#tSide').replaceChildren();
      return;
    }
    if (!quiet) $('#tMain').replaceChildren(el('div.message.error', {}, err.message));
    return;
  }
  if (res.unchanged) return;
  version = res.version;
  if (source.kind === 'room' && res.role !== 'host' && res.role !== source.role) {
    if (res.role === 'viewer') { location.href = `watch?code=${res.code}`; return; }   // the code was turned off
    source.role = res.role;
  }
  roomRecord = res.data;
  const liveInfo = { code: res.code, edit_code: res.edit_code, mod_code: res.mod_code, role: res.role, live: res.live, timer: res.timer, announce: res.announce };
  if (r.role === 'host') {
    // keep this browser's copy in step, so it survives if the room is ended or lost
    const rec = localRecord();
    Object.assign(rec, stripRoom(res.data), { id: rec.id, room: { code: rec.room.code, host_key: rec.room.host_key } });
    local.save(rec);
  }
  data = {
    ok: true, tournament: { ...res.data.tournament, accepts_runs: false }, runs: res.data.runs, players: res.data.players,
    pending: 0, activity: res.data.activity || [], now: new Date(res.server_now).toISOString(), room: liveInfo,
  };
  render();
}

// ---------- Changes (host, participants) ----------
// Every edit goes through here: to this browser's record for a local tournament, to the room when it's live.
const actions = {
  async addTime(run) {
    if (room()) return op({ op: 'add_time', ...run });
    saveLocal(rec => { rec.runs.push({ ...run, id: Math.max(0, ...rec.runs.map(x => x.id)) + 1, status: 'verified', submitted_at: new Date().toISOString() }); },
      `${run.racer}: ${formatTime(run.time_ms)} on ${run.track} · ${run.cls} added`);
  },
  async removeTime(run) {
    if (room()) return op({ op: 'remove_time', id: run.id });
    saveLocal(rec => { rec.runs = rec.runs.filter(x => x.id !== run.id); }, `${run.racer}: ${formatTime(run.time_ms)} on ${run.track} · ${run.cls} removed`);
  },
  async saveMatch(next, detail) {
    if (room()) return op(detail.clear ? { op: 'clear_match', round: detail.round, index: detail.index } : { op: 'match_result', ...detail });
    saveLocal(rec => { rec.tournament.bracket = next; }, 'Bracket result saved');
  },
  // host and mods: whole-tournament changes
  async saveBracket(next, line) { return hostChange(rec => { rec.tournament.bracket = next; }, line); },
  async savePlayers(list) { return hostChange(rec => { rec.players = list.map((p, i) => ({ ...p, seed: i + 1 })); }, `Player list saved (${list.length})`); },
};

async function op(body) {
  const r = room();
  await sendOp(r.code, { by: byName(), ...body }, r.hostKey);
  await load();
}

async function hostChange(change, line) {
  if (!room()) return saveLocal(change, line);
  const rec = source.kind === 'room' ? structuredClone(roomRecord) : localRecord();
  change(rec);
  await op({ op: 'replace', record: stripRoom(rec), note: line });
}

function saveLocal(change, logLine) {
  const record = localRecord();
  change(record);
  if (logLine) local.log(record, logLine);
  local.save(record);
  data = viewData(record);
  wheelMountedFor = null;
  render();
}

// ---------- Rendering ----------
function render() {
  if (!data) return;
  const t = data.tournament;
  document.title = `${t.name} · Tournament`;
  const scrollY = window.scrollY;
  renderHead(t);
  renderLiveStrip();
  const bracketTab = document.querySelector('.tabs [data-tab="bracket"]');
  bracketTab.hidden = !t.bracket && !canManage();
  if (state.tab === 'bracket' && bracketTab.hidden) state.tab = 'overall';
  writeUrl();
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  const main = $('#tMain');
  const side = $('#tSide');
  $('#tBody').classList.toggle('single', state.tab === 'wheel' || state.tab === 'bracket');
  if (state.tab === 'wheel') {
    // mount once per tournament so a refresh doesn't interrupt a spin
    if (wheelMountedFor !== t.slug) {
      const names = data.players.length ? data.players.map(p => p.name) : standings().rows.map(r => r.name);
      const teams = [...new Set(data.players.map(p => p.team).filter(Boolean))];
      mountWheel(main, t, names, teams, pick => {
        if (room() && canManage() && !liveEnded()) op({ op: 'announce', text: `Wheel: ${pick}` }).catch(err => toast(err.message, 'error'));
      });
      wheelMountedFor = t.slug;
    }
    side.replaceChildren();
  } else {
    wheelMountedFor = null;
    const views = { overall: renderOverall, track: renderTrack, bracket: renderBracket, players: renderPlayers, activity: renderActivity, rules: renderRules };
    main.replaceChildren(...views[state.tab]());
    side.replaceChildren(...(state.tab === 'bracket' ? [] : [renderGrid(t), state.tab !== 'activity' ? renderActivityShort() : '']));
    main.querySelectorAll('.rows').forEach(box => fitRows(box, VISIBLE_ROWS));
  }
  window.scrollTo(0, scrollY);
}

function renderHead(t) {
  const live = data.room;
  $('#tBadges').replaceChildren(
    el('span.chip.game', {}, t.preset === 'pgrc' ? 'PGRC' : (t.game || 'Custom')),
    live ? el(`span.chip.${live.live ? 'live' : 'finished'}`, {}, live.live ? 'Live' : 'Ended')
      : source.kind === 'local' ? el('span.chip.local', {}, 'Saved in this browser')
        : el(`span.chip.${t.status}`, {}, STATUS_LABEL[t.status]),
    live && live.role === 'participant' ? el('span', {}, `You’re racing as ${source.name}`) : '',
    live && live.role === 'mod' ? el('span', {}, `You’re a mod as ${source.name}`) : '',
    t.ends_at ? el('span', {}, `${t.starts_at ? formatDate(t.starts_at) + ' – ' : ''}ends ${formatDate(t.ends_at, true)}`) : dateRange(t) ? el('span', {}, dateRange(t)) : '');
  $('#tName').textContent = t.name;
  const bits = [t.game, formatLine(t)];
  if (t.no_cheats) bits.push('cheat codes banned');
  if (source.kind === 'site' && t.proof !== 'none') bits.push(t.proof === 'screenshot' ? 'screenshot proof' : 'proof required');
  $('#tMeta').textContent = bits.filter(Boolean).join(' · ');
  const submit = $('#tSubmit');
  submit.href = `submit?t=${encodeURIComponent(t.slug)}`;
  submit.hidden = source.kind !== 'site' || !t.accepts_runs;
  $('#tOverlay').hidden = source.kind !== 'site' && !live;
  $('#tOverlay').href = live ? `watch?code=${live.code}` : `overlay?t=${encodeURIComponent(t.slug)}`;
  $('#tOverlay').textContent = live ? 'Viewer page' : 'Stream overlay';
  $('#tDownload').hidden = !isHost();
  $('#tLive').hidden = !isHost() || !!live;

  const s = standings();
  const leader = s.rows[0];
  $('#tStats').replaceChildren(
    stat(data.players.length ? 'Players' : 'Racers', data.players.length || s.rows.length),
    stat(source.kind === 'site' ? 'Verified runs' : 'Times', data.runs.length),
    source.kind === 'site' ? stat('Awaiting review', data.pending, data.pending ? 'warn' : '') : stat('Events', t.events.length),
    stat(t.scoring === 'points' ? 'Leader points' : 'Leader total', leader ? (t.scoring === 'points' ? leader.points : formatTime(leader.total)) : '—'),
  );
}
const stat = (label, value, cls = '') => el(`div${cls ? '.' + cls : ''}`, {}, el('span', {}, label), el('b', {}, value));

// The strip under the header while a tournament is live: codes to hand out, and the host's controls.
function renderLiveStrip() {
  const box = $('#tLiveStrip');
  const live = data.room;
  if (!live) { box.replaceChildren(); return; }
  // don't rebuild while someone is typing a message in it
  if (box.contains(document.activeElement) && document.activeElement.matches('input')) return;
  const host = live.role === 'host';
  const copy = (text, what) => el('button.btn.small', { type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch (_) { toast(text); }
  } }, `Copy ${what.toLowerCase()}`);
  const announceInput = el('input', { type: 'text', maxlength: 120, placeholder: 'e.g. Now racing: Heat 3 · US Track 2', 'aria-label': 'Message for viewers' });
  const shareBox = el('input', { type: 'checkbox', checked: store.get('shareTimer', true) });
  shareBox.addEventListener('change', () => { store.set('shareTimer', shareBox.checked); if (shareBox.checked) pushTimer(); });
  const guard = fn => () => fn().catch(err => toast(err.message, 'error'));
  const manage = host || live.role === 'mod';
  // a code box: the code, its link and (for the host) making a new one or turning it off
  const codeBox = (which, code, label, blurb, url) => el('div.code-box', {},
    el('span.label', {}, label),
    code ? el(`span.code${{ viewer: '', participant: '.edit', mod: '.mod' }[which]}`, {}, prettyCode(code)) : el('p.note', {}, 'Off. Nobody can join with this kind of code.'),
    code ? el('span.link', {}, url) : '',
    el('span.small.muted', {}, blurb),
    el('div.row-btns', {},
      code ? copy(url, `${label.replace(' code', '')} link`) : '',
      which === 'viewer' && code ? el('a.btn.small', { href: `watch?code=${code}`, target: '_blank', rel: 'noopener' }, 'Open viewer page') : '',
      host && which !== 'viewer' ? el('button.btn.small', { type: 'button', onclick: () => confirmDialog(code ? `New ${label.toLowerCase()}?` : `Turn on a ${label.toLowerCase()}?`,
        code ? 'The old code stops working at once. Anyone who joined with it has to join again with the new one.' : 'Makes a fresh code to hand out.',
        () => op({ op: 'codes', which, action: 'new' }), code ? 'Make new code' : 'Turn on') }, code ? 'New code' : 'Turn on') : '',
      host && which !== 'viewer' && code ? el('button.btn.small.danger', { type: 'button', onclick: () => confirmDialog(`Turn off the ${label.toLowerCase()}?`,
        'It stops working at once; anyone using it drops to viewing. You can turn a new one on any time.', () => op({ op: 'codes', which, action: 'off' }), 'Turn off') }, 'Turn off') : ''));
  const boxes = [codeBox('viewer', live.code, 'Viewer code', 'Watch only: standings, clock, bracket and messages.', watchUrl(live.code))];
  if (manage) {
    boxes.push(codeBox('participant', live.edit_code, 'Participant code', 'For racers: they pick their name and enter or remove their own times.', live.edit_code ? joinUrl(live.edit_code) : ''));
    boxes.push(codeBox('mod', live.mod_code, 'Mod code', 'For people helping you run it: any time, bracket, players, timer, messages, end. Only you can change codes.', live.mod_code ? joinUrl(live.mod_code) : ''));
  }
  const announceForm = manage ? el('form.code-box', { onsubmit: e => {
    e.preventDefault();
    op({ op: 'announce', text: announceInput.value }).then(() => toast(announceInput.value ? 'Shown to viewers' : 'Message cleared')).catch(err => toast(err.message, 'error'));
  } },
    el('span.label', {}, 'Message for viewers'),
    live.announce ? el('span.small', {}, `Showing: ${live.announce.text}`) : el('span.small.muted', {}, 'Nothing showing'),
    el('div.announce-row', {}, announceInput, el('button.btn.small.teal', { type: 'submit', disabled: !live.live }, 'Show')),
    el('label.check.small', {}, shareBox, el('span', {}, 'Share my timer with viewers'))) : '';
  const manageBar = manage ? el('div.live-host', {},
    el('span.note', {}, live.live ? 'Changes save to the site; everyone sees them within a few seconds.' : 'Ended. Viewers see the final standings.'),
    live.live
      ? el('button.btn.small.danger', { type: 'button', onclick: () => confirmDialog('End the live tournament?', 'Viewers keep seeing the final standings, and nobody can change it until a host or mod reopens it.', () => op({ op: 'end' }), 'End') }, 'End live')
      : el('button.btn.small.teal', { type: 'button', onclick: guard(() => op({ op: 'reopen' })) }, 'Reopen'))
    : el('div.live-host', {}, el('span.note', {}, live.live ? `You can enter and remove your own times as ${source.name}. Everyone sees them within a few seconds.` : 'Ended. The host or a mod can reopen it.'));
  box.replaceChildren(el('div.wrap', {}, el('div.panel.live-panel', {},
    el('div.live-grid', {}, ...boxes, announceForm), manageBar)));
}

function filteredRuns() {
  return state.platform ? data.runs.filter(r => r.platform === state.platform) : data.runs;
}
function standings() {
  return overall(data.tournament, filteredRuns());
}

function platformFilter() {
  const platforms = data.tournament.platforms;
  if (platforms.length < 2) return '';
  return el('select', { 'aria-label': 'Platform', onchange: e => { state.platform = e.target.value; state.open = null; render(); } },
    el('option', { value: '' }, 'All platforms'),
    ...platforms.map(p => el('option', { value: p, selected: state.platform === p }, p)));
}

// editing tools above a tab (hosts and participants)
function hostBar(note, ...buttons) {
  return canEdit() ? el('div.host-bar', {}, el('span.note', {}, note), ...buttons) : '';
}
const liveEnded = () => !!(data?.room && !data.room.live);
const addTimeButton = (preset = {}) => el('button.btn.small', { type: 'button', disabled: liveEnded(), onclick: () =>
  addTimeDialog(data.tournament, data.players, run => actions.addTime(run), isParticipant() ? { ...preset, racer: source.name, lockRacer: true } : preset) },
  isParticipant() ? '+ Add my time' : '+ Add a time');

// ---------- Overall ----------
function renderOverall() {
  const t = data.tournament;
  const s = standings();
  const myKey = me.get().name ? racerKey(me.get().name) : null;
  const points = t.scoring === 'points';
  const table = el('div.table', { style: { '--cols': '56px minmax(0,1fr) 120px 110px 110px 150px', '--cols-phone': '40px minmax(0,1fr) auto' } },
    el('div.thead', {}, el('span', {}, 'Pos'), el('span', {}, 'Racer'), el('span.r', {}, points ? 'Points' : 'Total'),
      el('span.r.wide', {}, points ? 'Behind' : 'To leader'), el('span.r.wide', {}, 'To next'), el('span.wide', {}, 'Events')));
  const rows = el('div.rows');
  if (!s.rows.length) rows.append(el('div.empty', {}, state.platform ? 'No times on this platform yet.' : canEdit() ? 'No times yet. Add one above.' : 'No verified times yet.'));
  for (const r of s.rows) {
    const open = state.open === r.id;
    const gapText = v => points ? (v ? `−${v}` : '—') : formatGap(v);
    const row = el(`div.row.clickable${open ? '.open' : ''}${r.id === myKey ? '.me' : ''}`, {
      role: 'button', tabindex: '0', 'aria-expanded': String(open),
      onclick: () => { state.open = open ? null : r.id; render(); },
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } },
    },
      el(`span.pos.p${r.pos}`, {}, String(r.pos).padStart(2, '0')),
      el('span', {}, el('span.name', {}, r.name),
        el('span.sub', {}, [r.platforms.join(', '), el('span.phone-only', {}, ` · ${r.done}/${s.eventCount} events`)])),
      el('span.r', {}, el('span.time', {}, points ? String(r.points) : formatTime(r.total)),
        el('span.sub.phone-only', {}, r.pos === 1 ? 'leader' : r.complete || points ? gapText(r.gapLead) : 'incomplete')),
      el('span.r.gap.mono.wide', {}, r.pos === 1 ? '—' : gapText(r.gapLead)),
      el('span.r.gap.mono.wide', {}, r.pos === 1 ? '—' : gapText(r.gapNext)),
      el('span.wide', {}, el('span.pips', {}, Array.from({ length: Math.min(s.eventCount, 16) }, (_, i) => el(`i${i < r.done ? '.on' : ''}`))),
        el('span.small.muted', {}, `${r.done}/${s.eventCount}`)));
    rows.append(row);
    if (open) rows.append(el('div.detail', {}, eventTimes(r)));
  }
  table.append(rows);
  return [
    el('div.section-head', {}, el('h2', {}, 'Overall standings'),
      el('div.toolbar', {}, platformFilter(), source.kind === 'site' ? el('span.small.muted', {}, `Refreshes every ${REFRESH_MS / 1000} s · verified times only`) : '')),
    hostBar(isHost() ? 'You’re the host: add times here, or edit your file and upload it again.' : isParticipant() ? `Enter your times as ${source.name}.` : 'You’re a mod: add or remove anyone’s times.', addTimeButton()),
    table,
    el('p.small.muted', {}, points
      ? `Points per place in each event: ${t.points.join(', ')}. Ties go to more events done, then lower total time.`
      : s.eventCount > 1 ? `Racers missing an event are ranked after everyone who has all ${s.eventCount}, by events done, then total.` : ''),
  ];
}

// a racer's time in every counted event, shown when their row is opened
function eventTimes(r) {
  const t = data.tournament;
  const manyClasses = new Set(t.events.map(e => e[1])).size > 1;
  return el('div.event-times', {}, t.events.map(([track, cls]) => {
    const row = r.events.get(eventKey(track, cls));
    return el('div', {}, el('span', {}, manyClasses ? `${track} · ${cls}` : track),
      row ? el('span.mono', {}, `${formatTime(row.time)} `, el('span.muted', {}, `(${row.pos}${row.run.penalty_ms ? `, incl. +${row.run.penalty_ms / 1000} s` : ''})`))
        : el('span.muted', {}, '—'));
  }));
}

// ---------- By track ----------
function renderTrack() {
  const t = data.tournament;
  const s = standings();
  state.event = Math.min(state.event, t.events.length - 1);
  const [track, cls] = t.events[state.event];
  const board = s.boards.get(eventKey(track, cls)) || [];
  const myKey = me.get().name ? racerKey(me.get().name) : null;
  const select = el('select', { 'aria-label': 'Event', onchange: e => { state.event = Number(e.target.value); render(); } },
    ...t.events.map(([tr, c], i) => el('option', { value: i, selected: i === state.event }, `${tr} · ${c}`)));
  const edit = canEdit();
  const table = el('div.table', { style: { '--cols': `56px minmax(0,1fr) 120px 100px 110px ${edit ? '48px' : '110px'}`, '--cols-phone': `40px minmax(0,1fr) auto${edit ? ' 44px' : ''}` } },
    el('div.thead', {}, el('span', {}, 'Pos'), el('span', {}, 'Racer'), el('span.r', {}, 'Time'), el('span.r.wide', {}, 'Gap'),
      el('span.wide', {}, 'Proof'), edit ? el('span', {}, '') : el('span.wide', {}, 'Verified')));
  const rows = el('div.rows');
  if (!board.length) rows.append(el('div.empty', {}, 'No times on this event yet.'));
  for (const b of board) {
    const run = b.run;
    const proof = run.proof_key ? el('a', { href: `/api/proof/${run.proof_key}`, target: '_blank', rel: 'noopener' }, 'Screenshot')
      : run.video_url ? el('a', { href: run.video_url, target: '_blank', rel: 'noopener noreferrer' }, 'Video') : el('span.muted', {}, run.by || (source.kind === 'site' ? 'Organizer' : 'Host'));
    rows.append(el(`div.row${racerKey(run.racer) === myKey ? '.me' : ''}`, {},
      el(`span.pos.p${b.pos}`, {}, String(b.pos).padStart(2, '0')),
      el('span', {}, el('span.name', {}, run.racer), el('span.sub', {}, run.platform,
        run.penalty_ms ? el('span.flag', {}, ` · +${(run.penalty_ms / 1000).toFixed(3)} s penalty${run.penalty_note ? ` (${run.penalty_note})` : ''}`) : '')),
      el('span.r', {}, el('span.time', {}, formatTime(b.time)), el('span.sub.phone-only', {}, b.pos === 1 ? 'fastest' : formatGap(b.gapLead))),
      el('span.r.gap.mono.wide', {}, formatGap(b.gapLead)),
      el('span.wide', {}, proof),
      edit
        ? (ownRun(run) ? el('button.del-btn', { type: 'button', disabled: liveEnded(), 'aria-label': `Remove ${run.racer}'s time`, title: 'Remove this time', onclick: () =>
          confirmDialog('Remove this time?', `${run.racer}: ${formatTime(run.time_ms)} on ${track} · ${cls}. Their next-best time on this event counts instead.`,
            () => actions.removeTime(run), 'Remove') }, '✕') : el('span', {}, ''))
        : el('span.wide.small.muted', {}, formatDate(run.reviewed_at || run.submitted_at))));
  }
  table.append(rows);
  return [el('div.section-head', {}, el('h2', {}, `${track} · ${cls}`), el('div.toolbar', {}, select, platformFilter())),
    hostBar('Only each racer’s best time here counts.', addTimeButton({ event: state.event })),
    table];
}

// ---------- Bracket ----------
function renderBracket() {
  const t = data.tournament;
  const b = t.bracket;
  const standingsNames = () => standings().rows.map(r => r.name);
  const createBtn = canManage() ? el('button.btn.small', { type: 'button', disabled: liveEnded(), onclick: () => {
    if (data.players.length + standingsNames().length < 2) { toast('Add at least two players (Players tab) or two racers with times first.', 'error'); return; }
    newBracketDialog(data.players, standingsNames(), next => actions.saveBracket(next, `Bracket created (${next.entrants.length} ${next.kind})`));
  } }, b ? 'New bracket' : 'Create a bracket') : '';
  if (!b) {
    return [el('div.section-head', {}, el('h2', {}, 'Bracket')),
      canManage() ? hostBar('Build a single-elimination bracket from your players or teams.', createBtn) : '',
      el('div.panel.panel-pad', {}, el('p.muted', {}, 'No bracket yet.'))];
  }
  const myKey = me.get().name ? racerKey(me.get().name) : null;
  const myTeam = myKey && data.players.find(p => racerKey(p.name) === myKey)?.team;
  const mine = name => name && (b.kind === 'teams' ? myTeam && name === myTeam : racerKey(name) === myKey);
  const slot = (m, s, r) => {
    const name = m[s];
    const ms = m[`${s}_ms`];
    const won = m.winner === s;
    return el(`div.slot${won ? '.won' : ''}${m.winner && !won ? '.lost' : ''}${mine(name) ? '.me' : ''}${name ? '' : '.tbd'}`, {},
      el('span.slot-name', {}, name || (r === 0 && (m.a || m.b) ? 'bye' : 'TBD')),
      el('span.slot-time.mono', {}, ms ? formatTime(ms) : ''));
  };
  const rounds = b.rounds.map((round, r) => el('div.round', {},
    el('div.round-name', {}, roundName(r, b.rounds.length)),
    el('div.round-matches', {}, round.map((m, i) => (canManage() && !liveEnded() && m.a && m.b
      ? el('button.match', { type: 'button', 'aria-label': `${m.a} vs ${m.b}: record result`,
        onclick: () => matchDialog(structuredClone(b), r, i, (next, detail) => actions.saveMatch(next, detail)) }, slot(m, 'a', r), slot(m, 'b', r))
      : el('div.match', {}, slot(m, 'a', r), slot(m, 'b', r)))))));
  const winner = champion(b);
  return [
    el('div.section-head', {}, el('h2', {}, 'Bracket'),
      el('span.small.muted', {}, `${b.entrants.length} ${b.kind} · single elimination · faster time wins each match`)),
    canManage() ? hostBar('Click a match to enter times or pick the winner. Winners move on automatically.', createBtn,
      canManage() ? el('button.btn.small.danger', { type: 'button', disabled: liveEnded(), onclick: () => confirmDialog('Remove the bracket?', 'All match results in it are lost.', () => actions.saveBracket(null, 'Bracket removed'), 'Remove') }, 'Remove bracket') : '') : '',
    winner ? el('div.champion', {}, el('span', {}, 'Champion'), el('b', {}, winner)) : '',
    el('div.bracket-scroll', {}, el('div.bracket', { style: { '--rounds': b.rounds.length } }, rounds)),
  ];
}

// ---------- Players ----------
function renderPlayers() {
  const players = data.players;
  const s = standings();
  const byRacer = new Map(s.rows.map(r => [r.id, r]));
  const myKey = me.get().name ? racerKey(me.get().name) : null;
  const editBtn = canManage() ? el('button.btn.small', { type: 'button', disabled: liveEnded(), onclick: () => playersDialog(players, async list => {
    const names = new Set(list.map(p => p.name.toLowerCase()));
    const orphaned = [...new Set(data.runs.filter(r => !names.has(r.racer.toLowerCase())).map(r => r.racer))];
    if (list.length && orphaned.length) throw new Error(`${orphaned.join(', ')} ${orphaned.length === 1 ? 'has times but isn’t' : 'have times but aren’t'} in the list. Add them, or remove their times first.`);
    await actions.savePlayers(list);
  }) }, players.length ? 'Edit players' : 'Add players') : '';
  const bar = canManage() ? hostBar('Who’s playing, in seed order. Brackets and the wheel use this list.', editBtn) : '';
  if (!players.length) {
    return [el('div.section-head', {}, el('h2', {}, 'Players')), bar,
      el('div.panel.panel-pad', {}, el('p.muted', {}, source.kind === 'site'
        ? 'This tournament has no player list, so anyone can submit a time. Everyone with a verified time is on the Overall tab.'
        : 'No player list yet, so any name can have a time.'))];
  }
  const hasTeams = players.some(p => p.team);
  const table = el('div.table', { style: { '--cols': `56px minmax(0,1fr) ${hasTeams ? 'minmax(0,1fr) ' : ''}110px 120px`, '--cols-phone': '40px minmax(0,1fr) auto' } },
    el('div.thead', {}, el('span', {}, 'Seed'), el('span', {}, 'Player'), hasTeams ? el('span.wide', {}, 'Team') : '',
      el('span.wide', {}, 'Platform'), el('span.r', {}, 'Standing')));
  const rows = el('div.rows');
  for (const p of players) {
    const r = byRacer.get(racerKey(p.name));
    rows.append(el(`div.row${racerKey(p.name) === myKey ? '.me' : ''}`, {},
      el('span.pos', {}, String(p.seed).padStart(2, '0')),
      el('span', {}, el('span.name', {}, p.name), el('span.sub.phone-only', {}, [p.team, p.platform].filter(Boolean).join(' · '))),
      hasTeams ? el('span.wide', {}, p.team || el('span.muted', {}, '—')) : '',
      el('span.wide', {}, p.platform || el('span.muted', {}, '—')),
      el('span.r', {}, r ? `#${r.pos}` : el('span.muted', {}, 'no time yet'))));
  }
  table.append(rows);
  const teams = [...new Set(players.map(p => p.team).filter(Boolean))];
  return [
    el('div.section-head', {}, el('h2', {}, 'Players'),
      el('span.small.muted', {}, `${players.length} players${teams.length ? ` · ${teams.length} teams` : ''}${source.kind === 'site' ? ' · only these names can submit times' : ''}`)),
    bar, table,
  ];
}

// ---------- Activity ----------
function activityItems(list) {
  const now = new Date(data.now).getTime();
  return list.map(a => el('li', {}, a.detail, el('span.when', {}, ago(a.at, now))));
}
function renderActivity() {
  return [el('div.section-head', {}, el('h2', {}, 'Activity')),
    el('div.panel.panel-pad', {}, data.activity.length ? el('ul.activity', {}, activityItems(data.activity)) : el('p.muted', {}, 'Nothing yet.'))];
}
function renderActivityShort() {
  if (!data.activity.length) return '';
  return el('div.panel.panel-pad', {}, el('h3', {}, 'Recent activity'), el('ul.activity', {}, activityItems(data.activity.slice(0, 5))));
}

// ---------- Rules ----------
function renderRules() {
  const t = data.tournament;
  const proof = source.kind === 'site' ? { screenshot: 'A screenshot is required with every time.', any: 'A screenshot or a video link is required with every time.', none: 'No proof is required.' }[t.proof] : '';
  return [el('div.section-head', {}, el('h2', {}, 'Rules')),
    el('div.panel.panel-pad.rules', {},
      t.description ? el('p', {}, t.description) : '',
      t.rules ? el('p', {}, t.rules) : el('p.muted', {}, isHost() ? 'No rules yet. Add a "rules" setting row to your file.' : 'No rules written yet.'),
      proof ? el('p', {}, proof) : '',
      t.no_cheats ? el('p', {}, 'Cheat codes must not be active.') : '',
      el('p', {}, t.scoring === 'points'
        ? `Scoring: points for each place in each event (${t.points.join(', ')}), added up.`
        : t.events.length > 1 ? 'Scoring: best time in each event, added up. Lowest total wins.' : 'Scoring: best time wins.'),
      t.starts_at || t.ends_at ? el('p', {}, `Times count from ${t.starts_at ? formatDate(t.starts_at, true) : 'the start'} until ${t.ends_at ? formatDate(t.ends_at, true) : 'the organizer closes it'} (your time zone).`) : '')];
}

// ---------- Event grid (side panel) ----------
function renderGrid(t) {
  const counted = new Set(t.events.map(([a, b]) => eventKey(a, b)));
  const usedTracks = new Set(t.events.map(e => e[0]));
  const grid = el('div.grid-table', { style: { '--n': t.classes.length } },
    el('span.h', {}, 'Track'), ...t.classes.map(c => el('span.h', {}, c)));
  for (const track of t.tracks) {
    grid.append(el(`span${usedTracks.has(track) ? '' : '.t-off'}`, {}, track),
      ...t.classes.map(c => {
        const on = counted.has(eventKey(track, c));
        return el(`span.cell${on ? '.on' : ''}`, { 'aria-label': `${track} ${c}: ${on ? 'counts' : 'does not count'}` }, on ? '✓' : '');
      }));
  }
  return el('div.panel.panel-pad', {},
    el('div.section-head', {}, el('h3', {}, 'Event grid'), el('span.small.muted', {}, `${t.events.length} of ${t.tracks.length * t.classes.length} count`)),
    grid);
}

// ---------- Timer sharing ----------
// When you run the timer in a live tournament you host or help run, viewers see the same clock.
let pushQueued = null;
function pushTimer() {
  const r = room();
  if (!r || !canManage() || !store.get('shareTimer', true) || liveEnded()) return;
  clearTimeout(pushQueued);
  pushQueued = setTimeout(() => {
    const s = timer.get();
    sendOp(r.code, { op: 'timer', by: byName(), state: { mode: s.mode, running: s.running, elapsed_ms: timer.elapsed(), duration: s.duration, label: s.label } }, r.hostKey)
      .catch(err => toast(`Timer not shared: ${err.message}`, 'error'));
  }, 150);
}

// ---------- Going live ----------
function goLiveDialog() {
  formDialog('Go live', form => form.append(
    el('p', {}, 'Puts this tournament on tournament.codeman.club with three codes to hand out:'),
    el('ul.small', {},
      el('li', {}, el('b', {}, 'Viewer code: '), 'watch the standings, bracket, timer and your messages update live.'),
      el('li', {}, el('b', {}, 'Participant code: '), 'racers enter and remove their own times.'),
      el('li', {}, el('b', {}, 'Mod code: '), 'helpers run it with you: any time, bracket, players, timer, messages.')),
    el('p.note', {}, 'Only you can make new codes or turn the participant and mod codes off.'),
    el('p.note', {}, 'The tournament stays saved in this browser too, and keeps updating while it’s live.')),
  async form => {
    const rec = localRecord();
    const res = await startRoom(rec);
    rec.room = { code: res.code, host_key: res.host_key };
    local.log(rec, `Went live with code ${prettyCode(res.code)}`);
    local.save(rec);
    version = 0;
    schedule();
    await load();
    pushTimer();
  }, { saveLabel: 'Go live' });
}

// ---------- Header buttons and tabs ----------
export function wireView() {
  floating = floatingTimer('timer');
  const timerBtn = $('#tTimer');
  const panel = document.querySelector('.timer-float');
  timerBtn.addEventListener('click', () => floating.toggle());
  new MutationObserver(() => timerBtn.setAttribute('aria-pressed', String(!panel.hidden))).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  timer.subscribe(() => pushTimer());

  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    state.open = null;
    render();
  }));
  $('#tLive').addEventListener('click', goLiveDialog);
  $('#tCsv').addEventListener('click', () => {
    if (!data) return;
    const t = data.tournament;
    const s = standings();
    const head = ['Position', 'Racer', 'Platforms', t.scoring === 'points' ? 'Points' : 'Total', 'Events done', ...t.events.map(([a, b]) => `${a} · ${b}`)];
    const rows = s.rows.map(r => [r.pos, r.name, r.platforms.join(' / '), t.scoring === 'points' ? r.points : formatTime(r.total), r.done,
      ...t.events.map(([a, b]) => { const e = r.events.get(eventKey(a, b)); return e ? formatTime(e.time) : ''; })]);
    downloadCsv(`${t.slug}-standings.csv`, [head, ...rows]);
  });
  $('#tDownload').addEventListener('click', () => {
    const record = localRecord();
    if (!record) return;
    const plain = stripRoom(record);
    formDialog('Download file', f => f.append(
      el('p', {}, 'Get this tournament as a file to edit and upload again. Keep the id setting so the upload replaces this one.'),
      el('div.form-grid', {},
        el('button.btn', { type: 'button', onclick: () => download(`${record.id}.csv`, toCsv(plain), 'text/csv') }, 'CSV (spreadsheet)'),
        el('button.btn', { type: 'button', onclick: () => download(`${record.id}.json`, toJson(plain), 'application/json') }, 'JSON'))),
    async () => {}, { saveLabel: 'Done' });
  });
}

export function download(filename, text, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
