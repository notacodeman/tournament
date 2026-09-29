// submit.html: a racer submits a time to a tournament on the site, with a screenshot or video as proof.
// Remembers the racer's name and platform, and keeps a link to each submission's status in this browser.

import { $, el, api, me, myRuns, toast } from './util.js';
import { parseTime, formatTime } from '../lib/time.js';
import { PRESETS } from '../lib/presets.js';

const MAX_SCREENSHOT_MB = 5;
const slug = new URLSearchParams(location.search).get('t') || '';
let t = null;
let cls = null;

const fail = message => $('#msg').replaceChildren(el('div.message.error', {}, message));

async function start() {
  $('#back').href = `./?t=${encodeURIComponent(slug)}`;
  let data;
  try {
    data = await api(`/api/tournaments/${encodeURIComponent(slug)}`);
  } catch (err) {
    fail(err.message);
    return;
  }
  t = data.tournament;
  $('#tName').textContent = `${t.name} · ${t.game}`;
  if (!t.accepts_runs) { fail("This tournament isn't taking times right now."); return; }

  const mine = me.get();
  $('#racer').value = mine.name;
  if (data.players.length) {
    $('#roster').replaceChildren(...data.players.map(p => el('option', { value: p.name })));
    $('#racerNote').textContent = 'Pick your name from the player list.';
  }
  $('#platformField').hidden = !t.platforms.length;
  $('#platform').replaceChildren(...t.platforms.map(p => el('option', { value: p, selected: p === mine.platform }, p)));
  $('#racer').addEventListener('change', () => {
    const p = data.players.find(x => x.name.toLowerCase() === $('#racer').value.trim().toLowerCase());
    if (p?.platform && t.platforms.includes(p.platform)) $('#platform').value = p.platform;
  });

  // only tracks with a counted event, and for the chosen track only its counted classes
  const tracks = [...new Set(t.events.map(e => e[0]))];
  $('#track').replaceChildren(...tracks.map(tr => el('option', { value: tr }, tr)));
  $('#track').addEventListener('change', renderClasses);
  renderClasses();

  $('#shotField').hidden = t.proof === 'none';
  $('#videoField').hidden = t.proof === 'none';
  $('#cheatField').hidden = !t.no_cheats;
  $('#proofHint').textContent = (PRESETS[t.preset] || PRESETS.custom).proofHint;
  $('#form').hidden = false;
}

function renderClasses() {
  const counted = t.events.filter(e => e[0] === $('#track').value).map(e => e[1]);
  if (!counted.includes(cls)) cls = counted[0];
  const box = $('#classes');
  box.style.setProperty('--n', t.classes.length);
  box.replaceChildren(...t.classes.map(c => el('button', {
    type: 'button', 'aria-pressed': String(c === cls), disabled: !counted.includes(c),
    onclick: () => { cls = c; renderClasses(); },
  }, c)));
  $('#classNote').textContent = counted.length === 1 ? `This track only counts in ${counted[0]}.` : '';
}

// live check of the typed time
$('#time').addEventListener('input', () => {
  const ms = parseTime($('#time').value);
  $('#timeNote').textContent = !$('#time').value ? 'm:ss.mmm. Pasting 64.777 works too.' : ms ? `Reads as ${formatTime(ms)}` : 'Not a time yet. Write it like 1:04.777.';
});

// screenshot picker with preview; the whole box is the button
const drop = $('#drop');
const shot = $('#shot');
drop.addEventListener('click', () => shot.click());
drop.setAttribute('role', 'button');
drop.setAttribute('tabindex', '0');
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); shot.click(); } });
['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(type => drop.addEventListener(type, () => drop.classList.remove('over')));
drop.addEventListener('drop', e => {
  e.preventDefault();
  const dt = new DataTransfer();
  if (e.dataTransfer.files[0]) dt.items.add(e.dataTransfer.files[0]);
  shot.files = dt.files;
  preview();
});
shot.addEventListener('change', preview);
function preview() {
  const file = shot.files[0];
  if (!file) return;
  if (file.size > MAX_SCREENSHOT_MB * 1024 * 1024) { toast(`That image is over ${MAX_SCREENSHOT_MB} MB. Crop it or save it as JPG.`, 'error'); shot.value = ''; return; }
  const img = el('img', { src: URL.createObjectURL(file), alt: 'Your screenshot' });
  drop.replaceChildren(img, el('span.note', {}, `${file.name} · tap to change`));
}

$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = new FormData($('#form'));
  form.set('cls', cls);
  if (!parseTime(form.get('time'))) { fail('Write the time like 1:04.777.'); $('#time').focus(); return; }
  $('#send').disabled = true;
  $('#msg').replaceChildren();
  try {
    const res = await api(`/api/tournaments/${encodeURIComponent(slug)}/submit`, { method: 'POST', body: form });
    const time = formatTime(parseTime(form.get('time')));
    me.set({ name: String(form.get('racer')).trim(), platform: String(form.get('platform') || '') });
    myRuns.add({ token: res.token, slug, tournament: t.name, track: form.get('track'), cls, time, at: new Date().toISOString() });
    const link = new URL(`run?id=${res.token}`, location.href).href;
    $('#form').hidden = true;
    $('#done').hidden = false;
    $('#done').replaceChildren(
      el('span', {}, el('span.chip.pending', {}, 'Waiting for review')),
      el('div.time.mono', { style: { fontSize: '40px', fontWeight: 700, color: 'var(--teal)' } }, time),
      el('p', { style: { margin: 0 } }, `${form.get('track')} · ${cls}. An organizer checks it next. Keep this link to see when it's verified, or why it wasn't:`),
      el('a.link', { href: link }, link),
      el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        el('a.btn.primary', { href: `./?t=${encodeURIComponent(slug)}` }, 'Back to the standings'),
        el('a.btn', { href: location.href }, 'Submit another')));
  } catch (err) {
    fail(err.message);
    $('#send').disabled = false;
  }
});

start();
