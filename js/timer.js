// The race timer: a stopwatch with laps, or a countdown. Its state lives in localStorage and is broadcast to other
// windows, so the floating panel on the tournament page and the popped-out window (timer.html) show the same clock.
// The clock is worked out from timestamps, never counted up by a ticking interval, so every window agrees.

import { el, store } from './util.js';

const KEY = 'timer';
const POS_KEY = 'timerPos';
const DEFAULT_COUNTDOWN_MS = 10 * 60 * 1000;
const MAX_LAPS = 50;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('tournament-timer') : null;

const blank = () => ({ mode: 'stopwatch', running: false, startedAt: null, base: 0, duration: DEFAULT_COUNTDOWN_MS, laps: [], label: '' });
let state = { ...blank(), ...store.get(KEY, {}) };
const listeners = new Set();

function commit(next) {
  state = { ...state, ...next };
  store.set(KEY, state);
  channel?.postMessage(state);
  listeners.forEach(fn => fn(state));
}
channel?.addEventListener('message', e => { state = e.data; listeners.forEach(fn => fn(state)); });
// windows without BroadcastChannel still hear about changes through storage events
window.addEventListener('storage', e => {
  if (e.key === KEY && e.newValue) { state = JSON.parse(e.newValue); listeners.forEach(fn => fn(state)); }
});

export const timer = {
  get: () => state,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  elapsed: (s = state, now = Date.now()) => s.base + (s.running ? now - s.startedAt : 0),
  remaining(s = state, now = Date.now()) { return Math.max(0, s.duration - timer.elapsed(s, now)); },
  start() { if (!state.running && !(state.mode === 'countdown' && timer.remaining() === 0)) commit({ running: true, startedAt: Date.now() }); },
  pause() { if (state.running) commit({ running: false, base: timer.elapsed(), startedAt: null }); },
  toggle() { state.running ? timer.pause() : timer.start(); },
  reset() { commit({ running: false, base: 0, startedAt: null, laps: [] }); },
  lap() { if (state.running && state.mode === 'stopwatch') commit({ laps: [timer.elapsed(), ...state.laps].slice(0, MAX_LAPS) }); },
  setMode(mode) { commit({ mode, running: false, base: 0, startedAt: null, laps: [] }); },
  setDuration(ms) { if (ms > 0) commit({ duration: ms, running: false, base: 0, startedAt: null }); },
  setLabel(label) { commit({ label: String(label).slice(0, 60) }); },
  // called by whichever window notices a countdown reaching zero; harmless if two do
  finish() { if (state.running) commit({ running: false, base: state.duration, startedAt: null }); },
};

// 1:04.37 for the stopwatch; 9:59 for a countdown, with tenths in the last ten seconds.
export function clockText(s, now = Date.now()) {
  if (s.mode === 'countdown') {
    const ms = timer.remaining(s, now);
    const whole = Math.ceil(ms / 1000);
    if (ms < 10000 && ms > 0) return `0:0${Math.floor(ms / 1000)}.${Math.floor((ms % 1000) / 100)}`;
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }
  const ms = timer.elapsed(s, now);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const sec = Math.floor(ms / 1000) % 60;
  const cs = String(Math.floor((ms % 1000) / 10)).padStart(2, '0');
  return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(sec).padStart(2, '0')}.${cs}`;
}

// A short beep when a countdown ends. Needs a click on the page first (browsers block sound before that).
let audio = null;
function beep() {
  try {
    audio = audio || new AudioContext();
    [0, 0.35, 0.7].forEach(offset => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, audio.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + offset + 0.25);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + offset);
      osc.stop(audio.currentTime + offset + 0.3);
    });
  } catch (_) { /* no audio: fine */ }
}

const parseDuration = text => {
  const m = /^\s*(?:(\d+):)?(\d+)\s*$/.exec(text);
  if (!m) return null;
  return m[1] !== undefined ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : Number(m[2]) * 60000;
};
const durationText = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

// Builds the timer's controls into `root`. options.popout adds the Pop out button; options.onClose adds Close.
export function mountTimer(root, options = {}) {
  const display = el('div.clock', { 'aria-live': 'off' });
  const label = el('input.clock-label', { type: 'text', maxlength: 60, placeholder: 'Label, e.g. Heat 3 · US Track 2', 'aria-label': 'Timer label' });
  const startBtn = el('button.btn.primary', { type: 'button', onclick: () => { timer.toggle(); } });
  const lapBtn = el('button.btn', { type: 'button', onclick: () => timer.lap() }, 'Lap');
  const resetBtn = el('button.btn', { type: 'button', onclick: () => timer.reset() }, 'Reset');
  const modeBtns = ['stopwatch', 'countdown'].map(mode => el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { if (state.mode !== mode) timer.setMode(mode); } },
    mode === 'stopwatch' ? 'Stopwatch' : 'Countdown'));
  const durationInput = el('input', { type: 'text', inputmode: 'numeric', 'aria-label': 'Countdown length (minutes, or m:ss)', placeholder: '10:00' });
  const durationRow = el('label.duration', {}, 'Length', durationInput, el('span.note', {}, 'minutes, or m:ss'));
  const laps = el('ol.laps', { reversed: true });

  durationInput.addEventListener('change', () => {
    const ms = parseDuration(durationInput.value);
    if (ms) timer.setDuration(ms); else durationInput.value = durationText(state.duration);
  });
  label.addEventListener('input', () => timer.setLabel(label.value));

  const tools = [];
  if (options.popout) tools.push(el('button.btn.small', { type: 'button', onclick: options.popout, title: 'Open in its own window' }, 'Pop out ↗'));
  if (options.onClose) tools.push(el('button.btn.small.icon', { type: 'button', onclick: options.onClose, 'aria-label': 'Close timer' }, '✕'));

  root.replaceChildren(
    el('div.timer-head', { 'data-drag': '' }, el('span.timer-title', {}, 'Timer'), el('div.segmented.mini', { style: { '--n': 2 } }, ...modeBtns), ...tools),
    label, display,
    el('div.timer-buttons', {}, startBtn, lapBtn, resetBtn),
    durationRow, laps);

  let finishedAt = null;
  function update() {
    const s = state;
    const now = Date.now();
    display.textContent = clockText(s, now);
    const done = s.mode === 'countdown' && timer.remaining(s, now) === 0;
    display.classList.toggle('done', done);
    display.classList.toggle('low', s.mode === 'countdown' && !done && timer.remaining(s, now) <= 10000);
    if (done && s.running) {
      timer.finish();
      if (finishedAt !== s.startedAt) { finishedAt = s.startedAt; beep(); }
    }
    startBtn.textContent = s.running ? 'Pause' : timer.elapsed(s, now) > 0 && !done ? 'Resume' : 'Start';
    startBtn.disabled = done;
    lapBtn.hidden = s.mode !== 'stopwatch';
    lapBtn.disabled = !s.running;
    durationRow.hidden = s.mode !== 'countdown';
    if (document.activeElement !== durationInput) durationInput.value = durationText(s.duration);
    if (document.activeElement !== label) label.value = s.label || '';
    modeBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['stopwatch', 'countdown'][i] === s.mode)));
  }
  function renderLaps() {
    laps.replaceChildren(...state.laps.map((ms, i) => {
      const split = ms - (state.laps[i + 1] || 0);
      return el('li', {}, el('span', {}, `Lap ${state.laps.length - i}`),
        el('span.mono', {}, clockText({ ...state, mode: 'stopwatch', running: false, base: split })),
        el('span.mono.muted', {}, clockText({ ...state, mode: 'stopwatch', running: false, base: ms })));
    }));
    laps.hidden = !state.laps.length || state.mode !== 'stopwatch';
  }
  timer.subscribe(() => { update(); renderLaps(); });
  update();
  renderLaps();
  const tick = () => { update(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return { update };
}

// The floating, draggable timer panel on the tournament page. Returns show/hide controls.
export function floatingTimer(popoutUrl) {
  const panel = el('section.timer-float.panel', { 'aria-label': 'Timer', hidden: true });
  document.body.append(panel);
  const open = () => { panel.hidden = false; placeInView(); store.set('timerOpen', true); };
  const close = () => { panel.hidden = true; store.set('timerOpen', false); };
  mountTimer(panel, {
    onClose: close,
    popout: () => {
      window.open(popoutUrl, 'tournament-timer', 'popup,width=480,height=380');
      close();
    },
  });

  // dragging by the header; position kept between visits
  const pos = store.get(POS_KEY, null);
  if (pos) Object.assign(panel.style, { left: pos.x + 'px', top: pos.y + 'px', right: 'auto', bottom: 'auto' });
  function placeInView() {
    const r = panel.getBoundingClientRect();
    const x = Math.min(Math.max(8, r.left), window.innerWidth - r.width - 8);
    const y = Math.min(Math.max(8, r.top), window.innerHeight - Math.min(r.height, 120));
    if (panel.style.left) Object.assign(panel.style, { left: x + 'px', top: y + 'px' });
  }
  const head = panel.querySelector('[data-drag]');
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    const move = ev => {
      const x = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - r.width);
      const y = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 60);
      Object.assign(panel.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      const b = panel.getBoundingClientRect();
      store.set(POS_KEY, { x: Math.round(b.left), y: Math.round(b.top) });
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });
  window.addEventListener('resize', () => { if (!panel.hidden) placeInView(); });
  return { open, close, toggle: () => (panel.hidden ? open() : close()), wasOpen: () => store.get('timerOpen', false) };
}
