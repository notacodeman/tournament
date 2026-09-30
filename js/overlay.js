// overlay.html: top-N stream overlay for a tournament on the site (overlay?t=<slug>&n=10, &bg=dark for a solid background).

import { $, el, api } from './util.js';
import { formatTime, formatGap } from '../lib/time.js';
import { overall } from '../lib/standings.js';
const REFRESH_MS = 15000;
const q = new URLSearchParams(location.search);
const slug = q.get('t');
const count = Math.min(30, Math.max(3, Number(q.get('n')) || 10));
if (q.get('bg') === 'dark') document.body.classList.add('solid');
async function draw() {
  try {
    const data = await api(`/api/tournaments/${encodeURIComponent(slug)}`);
    const t = data.tournament;
    const s = overall(t, data.runs);
    const points = t.scoring === 'points';
    $('#ov').replaceChildren(el('div.ov-card', {},
      el('div.ov-title', {}, t.name),
      el('ol.ov-rows', {}, s.rows.slice(0, count).map(r => el('li', {},
        el(`span.pos.p${r.pos}`, {}, String(r.pos)),
        el('span.ov-name', {}, r.name),
        el('span.ov-time.mono', {}, points ? `${r.points}` : formatTime(r.total)),
        el('span.ov-gap.mono', {}, r.pos === 1 ? '' : points ? `−${r.gapLead}` : r.complete ? formatGap(r.gapLead) : `${r.done}/${s.eventCount}`))))));
  } catch (err) {
    $('#ov').replaceChildren(el('div.ov-card', {}, err.message));
  }
}
draw();
setInterval(draw, REFRESH_MS);
