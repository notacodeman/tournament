// run.html: a racer's private link to one submitted run (run?id=<token>): verified, waiting, or rejected with the reason.

import { $, el, api, formatDate } from './util.js';
import { formatTime } from '../lib/time.js';
const token = new URLSearchParams(location.search).get('id') || '';
const label = { pending: 'Waiting for review', verified: 'Verified: it counts', rejected: 'Rejected' };
try {
  const { run } = await api(`/api/runs/${encodeURIComponent(token)}`);
  $('#out').replaceChildren(el('div.panel.panel-pad', { style: { display: 'grid', gap: '10px' } },
    el('span', {}, el(`span.chip.${run.status}`, {}, label[run.status])),
    el('div.time.mono', { style: { fontSize: '40px', fontWeight: 700, color: 'var(--teal)' } }, formatTime(run.time_ms)),
    el('div', {}, `${run.racer} · ${run.track} · ${run.cls}${run.platform ? ' · ' + run.platform : ''}`),
    run.penalty_ms ? el('div.flag', {}, `+${(run.penalty_ms / 1000).toFixed(3)} s penalty${run.penalty_note ? ': ' + run.penalty_note : ''}`) : '',
    run.status === 'rejected' ? el('div.message.error', {}, `Reason: ${run.reject_reason}`) : '',
    el('div.small.muted', {}, `Submitted ${formatDate(run.submitted_at, true)}${run.reviewed_at ? ' · reviewed ' + formatDate(run.reviewed_at, true) : ''}`),
    el('div', {}, el('a', { href: `./?t=${encodeURIComponent(run.slug)}` }, `See the ${run.tournament_name} standings`))));
} catch (err) {
  $('#out').replaceChildren(el('div.message.error', {}, err.message));
}
