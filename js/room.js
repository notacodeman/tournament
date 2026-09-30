// Talking to live rooms (functions/api/rooms): start one, read it, send changes. Rooms live in the site's D1
// database; the host key that proves you're the host stays in this browser, inside the tournament's local record.
// Codes: viewer (6 characters, watch), participant (8, enter your own times), mod (10, run the tournament).

import { api, store } from './util.js';
import { turnstileToken } from './turnstile.js';

export const POLL_MS = 3000;          // how often an open room checks for changes
// K7M-2QX (viewer) · ABCD-EFGH (participant) · ABCDE-FGHJK (mod)
export const prettyCode = code => (code && [6, 8, 10].includes(code.length) ? `${code.slice(0, code.length / 2)}-${code.slice(code.length / 2)}` : code || '');
export const cleanCode = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const headers = hostKey => (hostKey ? { 'X-Host-Key': hostKey } : {});

export const startRoom = async record =>
  api('/api/rooms', { json: { record: stripRoom(record), turnstile: await turnstileToken() } });

export const getRoom = (code, { since, hostKey } = {}) =>
  api(`/api/rooms/${encodeURIComponent(code)}${since ? `?since=${since}` : ''}`, { headers: headers(hostKey) });

export const sendOp = (code, body, hostKey) =>
  api(`/api/rooms/${encodeURIComponent(code)}/ops`, { method: 'POST', json: body, headers: headers(hostKey) });

// the record without its own room details (never send the host key inside the data)
export function stripRoom(record) {
  const { room, ...rest } = record;
  return rest;
}

// Rooms this browser joined with a participant or mod code: [{ code, name, role, tournament }], newest first.
export const joined = {
  get: () => store.get('joinedRooms', []),
  add: entry => store.set('joinedRooms', [entry, ...joined.get().filter(j => j.code !== entry.code)].slice(0, 10)),
};

export const watchUrl = code => new URL(`watch?code=${code}`, location.href).href;
export const joinUrl = code => new URL(`./?join=${code}`, location.href).href;
