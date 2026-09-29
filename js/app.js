// index.html startup: the splash (upload a tournament file, or pick one saved in this browser or on the site) and
// switching to the tournament view.

import { $, $$, el, api, me, myRuns, store, fitRows, dateRange, formatLine, formatDate, STATUS_LABEL, VISIBLE_ROWS_SIDE } from './util.js';
import { openTournament, closeTournament, wireView, download } from './view.js';
import { readFile, templateCsv, templateJson } from './files.js';
import { local, recordFromModel } from './local.js';
import { confirmDialog } from './editors.js';
import { getRoom, joined, cleanCode, prettyCode } from './room.js';

let siteTournaments = [];
let show = 'open';          // site list filter: 'open' (live and upcoming) or 'finished'
let selected = null;        // { kind: 'site', slug } | { kind: 'local', id }

const same = (a, b) => a && b && a.kind === b.kind && (a.slug || a.id || a.code) === (b.slug || b.id || b.code);

// ---------- Splash lists ----------
function renderLocal() {
  const list = local.list();
  $('#mineBlock').hidden = !list.length;
  const box = $('#localList');
  box.replaceChildren(...list.map(entry => {
    const src = { kind: 'local', id: entry.id };
    return el('div.local-row.row', {},
      el('button.pick', { type: 'button', role: 'radio', 'aria-checked': String(same(selected, src)), onclick: () => select(src), ondblclick: () => { select(src); open(); } },
        el('span.name', {}, entry.name),
        entry.live ? el('span.chip.live', {}, `Live · ${prettyCode(entry.live)}`) : '',
        el('span.sub', {}, [entry.game, `${entry.players} players`, `${entry.runs} times`, `updated ${formatDate(entry.updated_at, true)}`].filter(Boolean).join(' · '))),
      el('button.del-btn', { type: 'button', 'aria-label': `Delete ${entry.name} from this browser`, title: 'Delete from this browser',
        onclick: () => confirmDialog('Delete this tournament?', `“${entry.name}” is removed from this browser. Download its file first if you want to keep it.`, () => {
          local.remove(entry.id);
          if (same(selected, src)) selected = null;
          renderAll();
        }) }, '✕'));
  }));
  fitRows(box, 6);
}

function renderSite() {
  $('#siteBlock').hidden = !siteTournaments.length;
  $$('[data-show]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.show === show)));
  const list = siteTournaments.filter(t => show === 'finished' ? t.status === 'finished' : t.status !== 'finished');
  const box = $('#pickList');
  if (!list.length) {
    box.replaceChildren(el('p.empty', {}, show === 'finished' ? 'No finished tournaments yet.' : 'Nothing live or upcoming right now.'));
    return;
  }
  box.replaceChildren(...list.map(t => {
    const src = { kind: 'site', slug: t.slug };
    return el('button.pick.row', { type: 'button', role: 'radio', 'aria-checked': String(same(selected, src)), onclick: () => select(src), ondblclick: () => { select(src); open(); } },
      el('span.name', {}, t.name),
      el(`span.chip.${t.status}`, {}, STATUS_LABEL[t.status]),
      el('span.sub', {}, [t.game, formatLine(t), dateRange(t), `${t.racer_count} ${t.racer_count === 1 ? 'racer' : 'racers'}`].filter(Boolean).join(' · ')));
  }));
  fitRows(box, VISIBLE_ROWS_SIDE);
}

function renderForm() {
  const site = selected?.kind === 'site' ? siteTournaments.find(t => t.slug === selected.slug) : null;
  $('#racerForm').hidden = !site;
  $('#go').hidden = !selected;
  $('#go').textContent = selected?.kind === 'local' ? 'Open tournament' : 'Show the standings';
  if (site) {
    $('#platformField').hidden = site.platforms.length < 2;
    const mine = me.get();
    $('#racerPlatform').replaceChildren(...site.platforms.map(p => el('option', { value: p, selected: p === mine.platform }, p)));
  }
}

function renderMine() {
  const runs = myRuns.get();
  $('#mine').hidden = !runs.length;
  $('#mineList').replaceChildren(...runs.slice(0, 5).map(r => el('li', {},
    el('span', {}, `${r.time} · ${r.track} · ${r.cls}`, el('span.sub', {}, r.tournament)),
    el('a', { href: `run?id=${r.token}` }, 'Status'))));
}

function renderAll() { renderLocal(); renderSite(); renderForm(); renderMine(); }

function select(src) {
  selected = src;
  renderLocal();
  renderSite();
  renderForm();
}

async function loadSite() {
  try {
    siteTournaments = (await api('/api/tournaments')).tournaments;
  } catch (_) {
    siteTournaments = [];  // the site's list is optional here; uploads work without it
  }
  const q = new URLSearchParams(location.search);
  if (!selected) {
    const slug = q.get('t');
    const found = siteTournaments.find(t => t.slug === slug);
    if (found) { selected = { kind: 'site', slug }; show = found.status === 'finished' ? 'finished' : 'open'; }
  }
  renderAll();
}

// ---------- Upload ----------
function message(kind, ...content) {
  $('#startMsg').replaceChildren(content.length ? el(`div.message.${kind}`, {}, ...content) : '');
}

async function handleFile(file) {
  if (!file) return;
  if (!/\.(csv|json)$/i.test(file.name)) { message('error', 'Pick a .csv or .json file.'); return; }
  if (file.size > 2 * 1024 * 1024) { message('error', 'That file is over 2 MB, which is more than a tournament needs. Is it the right file?'); return; }
  const { model, errors } = readFile(file.name, await file.text());
  if (errors) {
    message('error', el('b', {}, `${file.name} couldn’t be used:`),
      el('ul', {}, errors.slice(0, 8).map(e => el('li', {}, e)), errors.length > 8 ? el('li', {}, `…and ${errors.length - 8} more.`) : ''));
    return;
  }
  const { record, replaced } = recordFromModel(model);
  local.save(record);
  message('ok', replaced ? `Updated “${record.tournament.name}” from ${file.name}.` : `Added “${record.tournament.name}”.`);
  selected = { kind: 'local', id: record.id };
  renderAll();
  open();
}

// ---------- Joining with a code ----------
let pendingJoin = null;   // { code, tournament } waiting for the participant's name

async function join(e) {
  e?.preventDefault();
  const code = cleanCode($('#joinCode').value);
  if (code.length < 6) { message('error', 'Codes are 6 or 8 letters and numbers, like K7M-2QX.'); return; }
  if (pendingJoin?.code === code) {
    const name = $('#joinName').value.trim().replace(/\s+/g, ' ');
    if (!name) { message('error', 'Enter your name so others can see who made each change.'); $('#joinName').focus(); return; }
    joined.add({ code, name, tournament: pendingJoin.tournament });
    selected = { kind: 'room', code, name };
    pendingJoin = null;
    open();
    return;
  }
  try {
    const room = await getRoom(code);
    if (room.role === 'viewer') { location.href = `watch?code=${code}`; return; }
    pendingJoin = { code, tournament: room.data.tournament.name };
    $('#joinNameField').hidden = false;
    $('#joinName').value = joined.get().find(j => j.code === code)?.name || me.get().name || '';
    message('ok', `Participant code for “${pendingJoin.tournament}”. Enter your name and press Join.`);
    $('#joinName').focus();
  } catch (err) {
    message('error', err.message);
  }
}

// ---------- Switching ----------
function sessionGet(key) { try { return sessionStorage.getItem(key); } catch (_) { return null; } }
function sessionSet(key, value) { try { value == null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); } catch (_) { /* blocked */ } }

function open() {
  if (!selected) return;
  if (selected.kind === 'site') {
    me.set({ name: $('#racerName').value.trim().replace(/\s+/g, ' '), platform: $('#racerPlatform').value || me.get().platform });
  }
  if (selected.kind !== 'room') store.set('lastPick', selected);
  sessionSet('viewing', JSON.stringify(selected));
  const q = selected.kind === 'site' ? `?t=${encodeURIComponent(selected.slug)}`
    : selected.kind === 'room' ? `?room=${selected.code}` : `?local=${encodeURIComponent(selected.id)}`;
  if (location.search !== q) history.pushState(null, '', q);
  message('ok');
  $('#intro').hidden = true;
  $('#view').hidden = false;
  $('#change').hidden = false;
  window.scrollTo(0, 0);
  openTournament(selected);
}

function showIntro() {
  closeTournament();
  sessionSet('viewing', null);
  $('#view').hidden = true;
  $('#intro').hidden = false;
  $('#change').hidden = true;
  document.title = 'Tournament · codeman.club';
  renderAll();
}

// ---------- Start ----------
const drop = $('#drop');
$('#file').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(type => drop.addEventListener(type, () => drop.classList.remove('over')));
drop.addEventListener('drop', e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); });
$('#joinForm').addEventListener('submit', join);
$('#tplCsv').addEventListener('click', () => download('tournament-template.csv', templateCsv(), 'text/csv'));
$('#tplJson').addEventListener('click', () => download('tournament-template.json', templateJson(), 'application/json'));

$('#racerName').value = me.get().name;
$$('[data-show]').forEach(b => b.addEventListener('click', () => { show = b.dataset.show; renderSite(); }));
$('#go').addEventListener('click', open);
$('#racerName').addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
$('#change').addEventListener('click', () => { history.pushState(null, '', location.pathname); showIntro(); });
window.addEventListener('popstate', () => {
  const q = new URLSearchParams(location.search);
  if (!$('#view').hidden && !q.get('t') && !q.get('local')) showIntro();
});
wireView();

// pick what to show first: the tournament in the link, else the last one opened
const q = new URLSearchParams(location.search);
const localId = q.get('local');
const roomCode = cleanCode(q.get('room'));
const joinCode = cleanCode(q.get('join'));
const rejoin = roomCode && joined.get().find(j => j.code === roomCode);
if (rejoin) selected = { kind: 'room', code: rejoin.code, name: rejoin.name };
else if (localId && local.get(localId)) selected = { kind: 'local', id: localId };
else {
  const last = store.get('lastPick');
  if (last?.kind === 'local' && local.get(last.id)) selected = last;
  else if (last?.kind === 'site') selected = last;
}
renderAll();
// reloading this tab while a tournament was open goes straight back to it, like following a direct link
const viewing = sessionGet('viewing');
if (selected?.kind === 'room') open();
else if (selected?.kind === 'local' && viewing && same(JSON.parse(viewing), selected)) open();
if (joinCode) { $('#joinCode').value = prettyCode(joinCode); join(); }
loadSite().then(() => {
  if (selected?.kind === 'site' && !siteTournaments.some(t => t.slug === selected.slug)) { selected = null; renderAll(); }
  if (selected?.kind === 'site' && viewing && same(JSON.parse(viewing), selected) && $('#view').hidden) open();
});
