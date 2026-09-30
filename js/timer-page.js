// timer.html: the race timer in its own window, kept in sync with the timer on the tournament page.
// ?clean=1 shows only the clock and label (OBS window capture); ?bg=transparent drops the background.

import { mountTimer, timer } from './timer.js';

const q = new URLSearchParams(location.search);
if (q.get('clean') === '1') document.body.classList.add('clean');
if (q.get('bg') === 'transparent') document.body.classList.add('transparent');
mountTimer(document.getElementById('timer'));

document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); timer.toggle(); }
  else if (e.key.toLowerCase() === 'l') timer.lap();
  else if (e.key.toLowerCase() === 'r') timer.reset();
});
