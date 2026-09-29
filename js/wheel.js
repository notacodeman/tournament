// The picking wheel on the tournament page's Wheel tab: type entries (tracks, racers, car classes…) or fill them from
// the tournament, spin, and the wheel lands on one. Entries and pick history are kept in this browser per tournament.

import { el, store } from './util.js';

const SPIN_MS = 5200;          // length of a normal spin
const SPIN_MS_REDUCED = 900;   // with "reduce motion" turned on
const EXTRA_TURNS = 6;         // full turns before it settles
const MAX_ENTRIES = 64;
// segment colours, cycled; text colour picked per segment for contrast
const SEGMENTS = [
  ['#FF9F1C', '#1A1206'], ['#18202B', '#F3F6FA'], ['#2EE6D6', '#04201D'], ['#243041', '#F3F6FA'],
  ['#FFD166', '#1A1206'], ['#121821', '#2EE6D6'],
];
const RIM = '#34445A';
const HUB = '#0B0E13';

const randomUnit = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

// onPick(pick) is called after each spin (a live tournament shows it to viewers).
export function mountWheel(root, tournament, racerNames, teamNames = [], onPick = null) {
  const key = `wheel:${tournament.slug}`;
  const saved = store.get(key, { entries: [], history: [], removeWinner: false });
  let angle = 0;         // current rotation in radians
  let spinning = false;

  const fills = {
    Tracks: [...new Set(tournament.events.map(e => e[0]))],
    Classes: [...new Set(tournament.events.map(e => e[1]))],
    Events: tournament.events.map(([t, c]) => `${t} · ${c}`),
    Racers: racerNames,
    Teams: teamNames,
  };

  const canvas = el('canvas', { width: 560, height: 560, 'aria-hidden': 'true' });
  const result = el('div.wheel-result', { 'aria-live': 'polite' }, saved.history[0] ? saved.history[0].pick : 'Spin to pick');
  const spinBtn = el('button.btn.primary.spin', { type: 'button' }, 'Spin');
  const textarea = el('textarea', { id: 'wheelEntries', rows: 10, spellcheck: 'false', placeholder: 'One entry per line' });
  textarea.value = (saved.entries.length ? saved.entries : [...new Set(tournament.events.map(e => e[0]))]).join('\n');
  const count = el('span.note');
  const removeBox = el('input', { type: 'checkbox', id: 'wheelRemove' });
  removeBox.checked = !!saved.removeWinner;
  const historyList = el('ol.wheel-history');

  const entries = () => textarea.value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, MAX_ENTRIES);
  const save = () => store.set(key, { entries: entries(), history: saved.history, removeWinner: removeBox.checked });

  function draw() {
    const ctx = canvas.getContext('2d');
    const list = entries();
    const size = canvas.width;
    const r = size / 2 - 8;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    if (!list.length) {
      ctx.fillStyle = '#18202B';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8796A8'; ctx.font = '600 22px "IBM Plex Sans", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Add entries to spin', 0, 8);
      ctx.restore();
      return;
    }
    const step = (Math.PI * 2) / list.length;
    const fontSize = Math.max(12, Math.min(26, 360 / list.length + 8));
    list.forEach((entry, i) => {
      // with an odd count the last segment would match the first; skip a colour there
      const colour = SEGMENTS[(i === list.length - 1 && i % SEGMENTS.length === 0 && i) ? 2 : i % SEGMENTS.length];
      const start = angle + i * step - Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, start, start + step); ctx.closePath();
      ctx.fillStyle = colour[0]; ctx.fill();
      ctx.strokeStyle = HUB; ctx.lineWidth = 2; ctx.stroke();
      ctx.save();
      ctx.rotate(start + step / 2);
      ctx.fillStyle = colour[1];
      ctx.font = `italic 700 ${fontSize}px "Chakra Petch", sans-serif`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      let label = entry.toUpperCase();
      while (ctx.measureText(label).width > r - 50 && label.length > 3) label = label.slice(0, -2) + '…';
      ctx.fillText(label, r - 16, 0);
      ctx.restore();
    });
    // hub
    ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fillStyle = HUB; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fillStyle = '#FF9F1C'; ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = RIM;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // which entry sits under the pointer at the top for a given rotation
  function indexAt(a, n) {
    const step = (Math.PI * 2) / n;
    const turned = ((-a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(turned / step) % n;
  }

  function spin() {
    const list = entries();
    if (spinning || list.length < 2) {
      if (list.length < 2) result.textContent = 'Add at least two entries';
      return;
    }
    spinning = true;
    spinBtn.disabled = true;
    textarea.disabled = true;
    // pick the winner first, fairly, then aim the wheel at a random spot inside its segment
    const n = list.length;
    const winner = Math.floor(randomUnit() * n);
    const step = (Math.PI * 2) / n;
    const inside = (0.15 + 0.7 * randomUnit()) * step;
    const current = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const target = -(winner * step + inside);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const turns = reduced ? 1 : EXTRA_TURNS;
    const startAngle = angle;
    const delta = ((target - current) % (Math.PI * 2) - Math.PI * 2) % (Math.PI * 2) - turns * Math.PI * 2;
    const duration = reduced ? SPIN_MS_REDUCED : SPIN_MS;
    const t0 = performance.now();
    result.textContent = 'Spinning…';
    result.classList.remove('won');
    const frame = now => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 4); // fast start, long slow finish
      angle = startAngle + delta * eased;
      draw();
      if (t < 1) { requestAnimationFrame(frame); return; }
      const pick = list[indexAt(angle, n)];
      result.textContent = pick;
      result.classList.add('won');
      saved.history.unshift({ pick, at: new Date().toISOString() });
      saved.history = saved.history.slice(0, 50);
      if (removeBox.checked) {
        const rest = [...list];
        rest.splice(rest.indexOf(pick), 1);
        textarea.value = rest.join('\n');
      }
      onPick?.(pick);
      spinning = false;
      spinBtn.disabled = false;
      textarea.disabled = false;
      save();
      refresh();
    };
    requestAnimationFrame(frame);
  }

  function refresh() {
    const n = entries().length;
    count.textContent = `${n} ${n === 1 ? 'entry' : 'entries'}${n >= MAX_ENTRIES ? ` (max ${MAX_ENTRIES})` : ''}`;
    historyList.replaceChildren(...saved.history.slice(0, 12).map(h =>
      el('li', {}, h.pick, el('span.note', {}, new Date(h.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })))));
    historyList.parentElement?.toggleAttribute('hidden', !saved.history.length);
    draw();
  }

  textarea.addEventListener('input', () => { save(); refresh(); });
  removeBox.addEventListener('change', save);
  spinBtn.addEventListener('click', spin);
  canvas.addEventListener('click', spin);

  const fillButtons = Object.entries(fills).filter(([, list]) => list.length).map(([label, list]) =>
    el('button.pill', { type: 'button', onclick: () => { if (spinning) return; textarea.value = list.join('\n'); save(); refresh(); } }, label));

  root.replaceChildren(
    el('div.section-head', {}, el('h2', {}, 'Picking wheel'),
      el('span.note', {}, 'Picks are made in your browser. In a live tournament you run, each pick is shown to viewers.')),
    el('div.wheel-layout', {},
      el('div.wheel-stage', {},
        el('div.wheel-pointer', { 'aria-hidden': 'true' }),
        canvas,
        result,
        spinBtn),
      el('div.panel.panel-pad.wheel-side', {},
        el('label.field', { for: 'wheelEntries' }, 'Entries', el('span.note', {}, 'Maps, racers, car classes, anything. One per line.')),
        el('div.pills', {}, el('span.note.fill-label', {}, 'Fill from this tournament:'), ...fillButtons),
        textarea,
        count,
        el('label.check', {}, removeBox, el('span', {}, 'Take the winner off the wheel after each spin (for picking an order)')),
        el('div', { hidden: true }, el('h3', {}, 'Picked'), historyList),
        el('button.btn.small', { type: 'button', onclick: () => { saved.history = []; save(); refresh(); } }, 'Clear picks'))),
  );
  refresh();
}
