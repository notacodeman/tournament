// watch.html: the viewer page for a live tournament. Polls the room every POLL_MS and redraws what changed.
// The race clock runs from the room's shared timer, corrected for the difference between this device's clock and
// the server's, so every viewer sees the same time.

import { $, el, ago, formatLine } from './util.js';
import { formatTime, formatGap } from '../lib/time.js';
import { overall, eventKey } from '../lib/standings.js';
import { roundName, champion } from '../lib/bracket.js';
import { clockText } from './timer.js';
import { POLL_MS, getRoom, cleanCode, prettyCode } from './room.js';

const BOARD_ROWS = 12;          // standings rows shown
const FEED_ROWS = 8;            // latest times shown
const NEW_FOR_MS = 60000;       // how long a time is marked NEW

const q = new URLSearchParams(location.search);
const code = cleanCode(q.get('code'));
if (q.get('tv') === '1') document.body.classList.add('tv');

let version = 0;
let serverOffset = 0;           // server clock minus this device's clock
let room = null;
let lastTotals = new Map();     // racer → total, to flash rows that changed

async function poll(first = false) {
  try {
    const res = await getRoom(code, { since: first ? 0 : version });
    serverOffset = res.server_now - Date.now();
    $('#wUpdated').textContent = 'updated just now';
    if (res.unchanged) return;
    version = res.version;
    room = res;
    render();
  } catch (err) {
    if (first) {
      $('#wMsg').replaceChildren(el('div.message.error', {}, err.message));
      $('#wJoin').hidden = false;
    } else {
      $('#wUpdated').textContent = 'reconnecting…';
    }
  }
}

function render() {
  const data = room.data;
  const t = data.tournament;
  document.title = `${t.name} · Watch`;
  $('#wBody').hidden = false;
  $('#wJoin').hidden = true;
  $('#wMsg').replaceChildren();
  $('#wLive').hidden = false;
  $('#wLive').className = `chip ${room.live ? 'live' : 'finished'}`;
  $('#wLive').textContent = room.live ? 'Live' : 'Final';
  $('#wCode').textContent = prettyCode(room.code);
  $('#wBadges').replaceChildren(el('span.chip.game', {}, t.preset === 'pgrc' ? 'PGRC' : (t.game || 'Custom')));
  $('#wName').textContent = t.name;
  $('#wMeta').textContent = [t.game, formatLine(t)].filter(Boolean).join(' · ');

  const a = room.announce;
  $('#wAnnounce').hidden = !a;
  if (a) $('#wAnnounce').replaceChildren(el('span.announce-text', {}, a.text), el('span.small', {}, ago(a.at, room.server_now)));

  const s = overall(t, data.runs);
  renderBoard(t, s);
  renderFeed(t, data.runs);
  renderLeaders(t, s);
  renderBracket(t.bracket);
  $('#wClockBox').hidden = !room.timer;
}

function renderBoard(t, s) {
  const points = t.scoring === 'points';
  $('#wBoardNote').textContent = s.rows.length > BOARD_ROWS ? `Top ${BOARD_ROWS} of ${s.rows.length}` : `${s.rows.length} racers`;
  const totals = new Map();
  $('#wBoard').replaceChildren(...(s.rows.length ? s.rows.slice(0, BOARD_ROWS).map(r => {
    const value = points ? r.points : r.total;
    totals.set(r.id, value);
    const changed = lastTotals.size && lastTotals.get(r.id) !== value;
    const gap = r.pos === 1 ? 'Leader' : points ? `−${r.gapLead}` : r.complete ? formatGap(r.gapLead) : `${r.done}/${s.eventCount} events`;
    return el(`li.board-row${changed ? '.flash' : ''}`, {},
      el(`span.pos.p${r.pos}`, {}, String(r.pos).padStart(2, '0')),
      el('span.board-name', {}, el('span.name', {}, r.name), el('span.sub', {}, r.platforms.join(', '))),
      el('span.board-time.mono', {}, points ? `${r.points} pts` : formatTime(r.total), el('span.sub', {}, gap)));
  }) : [el('li.muted.empty', {}, 'No times yet. They’ll show up here as they come in.')]));
  lastTotals = totals;
}

function renderFeed(t, runs) {
  const recent = [...runs].sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at))).slice(0, FEED_ROWS);
  const now = Date.now() + serverOffset;
  $('#wFeed').replaceChildren(...(recent.length ? recent.map(r => {
    const isNew = now - new Date(r.submitted_at).getTime() < NEW_FOR_MS;
    return el(`li${isNew ? '.new' : ''}`, {},
      el('span', {}, el('b', {}, r.racer), el('span.sub', {}, `${r.track} · ${r.cls}`)),
      el('span.mono', {}, formatTime(r.time_ms + (r.penalty_ms || 0)), isNew ? el('span.chip.live.new-chip', {}, 'New') : ''));
  }) : [el('li.muted', {}, 'Nothing yet.')]));
}

function renderLeaders(t, s) {
  $('#wLeadersBox').hidden = t.events.length < 2;
  $('#wLeaders').replaceChildren(...t.events.map(([track, cls]) => {
    const top = s.boards.get(eventKey(track, cls))?.[0];
    return el('div.leader-card', {},
      el('span.label', {}, new Set(t.events.map(e => e[1])).size > 1 ? `${track} · ${cls}` : track),
      top ? el('span.leader-time.mono', {}, formatTime(top.time)) : el('span.leader-time.muted', {}, '—'),
      el('span.sub', {}, top ? top.run.racer : 'No time yet'));
  }));
}

function renderBracket(b) {
  $('#wBracketBox').hidden = !b;
  $('#wNextBox').hidden = true;
  if (!b) return;
  const winner = champion(b);
  $('#wChampion').replaceChildren(winner ? el('div.champion', {}, el('span', {}, 'Champion'), el('b', {}, winner)) : '');
  $('#wBracketNote').textContent = `${b.entrants.length} ${b.kind} · single elimination`;
  const slot = (m, side, r) => el(`div.slot${m.winner === side ? '.won' : ''}${m.winner && m.winner !== side ? '.lost' : ''}${m[side] ? '' : '.tbd'}`, {},
    el('span.slot-name', {}, m[side] || (r === 0 && (m.a || m.b) ? 'bye' : 'TBD')),
    el('span.slot-time.mono', {}, m[`${side}_ms`] ? formatTime(m[`${side}_ms`]) : ''));
  $('#wBracket').style.setProperty('--rounds', b.rounds.length);
  $('#wBracket').replaceChildren(...b.rounds.map((round, r) => el('div.round', {},
    el('div.round-name', {}, roundName(r, b.rounds.length)),
    el('div.round-matches', {}, round.map(m => el('div.match', {}, slot(m, 'a', r), slot(m, 'b', r)))))));
  // matches ready to race: both sides known, no result yet
  const next = [];
  b.rounds.forEach((round, r) => round.forEach(m => { if (m.a && m.b && !m.winner) next.push({ m, r }); }));
  $('#wNextBox').hidden = !next.length;
  $('#wNext').replaceChildren(...next.slice(0, 4).map(({ m, r }) =>
    el('li', {}, el('span.sub', {}, roundName(r, b.rounds.length)), el('b', {}, m.a), el('span.vs', {}, 'vs'), el('b', {}, m.b))));
}

// the shared race clock, redrawn every frame from the room's timer
function tickClock() {
  const tm = room?.timer;
  if (tm) {
    const now = Date.now() + serverOffset;
    const elapsed = tm.elapsed_ms + (tm.running ? now - tm.server_at : 0);
    const state = { mode: tm.mode, running: false, base: Math.max(0, elapsed), duration: tm.duration };
    const clock = $('#wClock');
    clock.textContent = clockText(state);
    const remaining = tm.duration - elapsed;
    clock.classList.toggle('done', tm.mode === 'countdown' && remaining <= 0);
    clock.classList.toggle('low', tm.mode === 'countdown' && remaining > 0 && remaining <= 10000);
    $('#wClockLabel').textContent = tm.label || (tm.running ? 'running' : 'paused');
  }
  requestAnimationFrame(tickClock);
}

// ---------- Start ----------
$('#wFull').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
});
$('#wJoin').addEventListener('submit', e => {
  e.preventDefault();
  const c = cleanCode($('#wJoinCode').value);
  if (c) location.search = `?code=${c}`;
});
if (!code) {
  $('#wJoin').hidden = false;
} else {
  poll(true);
  setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
  requestAnimationFrame(tickClock);
}
