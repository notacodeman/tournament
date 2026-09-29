// Small helpers shared by every page: DOM building, the API, browser storage, scroll boxes, dates.

// Rows shown in a scroll box before it scrolls; the box is cut halfway through the next row so it's clear there's more.
export const VISIBLE_ROWS = 15;
export const VISIBLE_ROWS_SIDE = 10;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// el('div.row', { onclick }, child, 'text', …): builds an element. Strings become text nodes, so names are never HTML.
export function el(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'style' && typeof value === 'object') {
      // custom properties (--cols) need setProperty; plain assignment ignores them
      for (const [prop, v] of Object.entries(value)) prop.startsWith('--') ? node.style.setProperty(prop, v) : (node.style[prop] = v);
    }
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// fetch JSON from the API; throws an Error carrying the API's own message.
export async function api(path, options = {}) {
  const init = { ...options };
  if (options.json !== undefined) {
    init.method = init.method || 'POST';
    init.headers = { ...(options.headers || {}), 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.json);
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch (_) {
    throw new Error("Couldn't reach the site. Check your connection and try again.");
  }
  const body = await response.json().catch(() => null);
  if (response.status === 404 && !body) throw new Error(`${path} returned 404: the site's Functions aren't deployed.`);
  if (!body) throw new Error(`${path} returned ${response.status} without a JSON body.`);
  if (!body.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

// localStorage that never throws (private windows, blocked storage).
export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (_) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* storage blocked: fine */ }
  },
};

// The racer's own details, remembered between visits: { name, platform }.
export const me = {
  get: () => store.get('racer', { name: '', platform: '' }),
  set: value => store.set('racer', value),
};

// Runs this browser submitted: [{ token, slug, tournament, track, cls, time, at }], newest first.
export const myRuns = {
  get: () => store.get('myRuns', []),
  add: run => store.set('myRuns', [run, ...myRuns.get()].slice(0, 30)),
};

// Keeps a scroll box a fixed number of rows tall, cut halfway through the next row, never taller than 80% of the
// window. Refits only when the width changes, since row heights only change with the width.
export function fitRows(box, rows = VISIBLE_ROWS) {
  const fit = () => {
    const items = [...box.children].filter(c => c.classList.contains('row'));
    if (items.length <= rows) { box.style.maxHeight = ''; return; }
    const top = box.getBoundingClientRect().top;
    const cut = items[rows].getBoundingClientRect();
    const height = cut.top - top + cut.height / 2;
    box.style.maxHeight = Math.min(height, window.innerHeight * 0.8) + 'px';
  };
  fit();
  if (!box._observer) {
    let lastWidth = box.clientWidth;
    box._observer = new ResizeObserver(() => {
      if (box.clientWidth !== lastWidth) { lastWidth = box.clientWidth; box._fit(); }
    });
    box._observer.observe(box);
  }
  box._fit = fit;
}

// "Oct 31", "Oct 31, 2027" (another year), with the time when asked. Shown in the viewer's own time zone.
export function formatDate(iso, withTime = false) {
  if (!iso) return '';
  const d = new Date(iso);
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  if (withTime) Object.assign(opts, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleString(undefined, opts);
}

export function dateRange(t) {
  if (t.starts_at && t.ends_at) return `${formatDate(t.starts_at)} – ${formatDate(t.ends_at)}`;
  if (t.ends_at) return `Ends ${formatDate(t.ends_at)}`;
  if (t.starts_at) return `Starts ${formatDate(t.starts_at)}`;
  return '';
}

// "2 min ago", "3 h ago", or a date past a day
export function ago(iso, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return formatDate(iso, true);
}

export const STATUS_LABEL = { draft: 'Draft', registration: 'Upcoming', live: 'Live', finished: 'Finished' };

export function formatLine(t) {
  const events = t.events.length;
  const classes = [...new Set(t.events.map(e => e[1]))];
  const parts = [
    `${events} ${events === 1 ? 'event' : 'events'}${classes.length === 1 ? ` · ${classes[0]}` : ''}`,
    t.scoring === 'points' ? 'points per place' : events > 1 ? 'lowest total time' : 'best time',
  ];
  return parts.join(' · ');
}

export function toast(message, kind = 'ok') {
  let box = document.getElementById('toast');
  if (!box) { box = el('div', { id: 'toast', role: 'status' }); document.body.append(box); }
  box.replaceChildren(el(`div.message.${kind}`, {}, message));
  clearTimeout(box._timer);
  box._timer = setTimeout(() => box.replaceChildren(), kind === 'error' ? 8000 : 3500);
}

// A CSV file download from rows of values.
export function downloadCsv(filename, rows) {
  const cell = v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
  const blob = new Blob([rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
