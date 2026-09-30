// Talking to live rooms (functions/api/rooms): start one, read it, send changes. Rooms live in the site's D1
// database; the host key that proves you're the host stays in this browser, inside the tournament's local record.

import { api, store } from './util.js';
import { turnstileToken } from './turnstile.js';

export const POLL_MS = 3000;          // how often an open room checks for changes
export const prettyCode = code => (code && code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code && code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code || '');
export const cleanCode = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const headers = hostKey => (hostKey ? { 'X-Host-Key': hostKey } : {});

export const startRoom = async (record, participants) =>
  api('/api/rooms', { json: { record: stripRoom(record), participants: !!participants, turnstile: await turnstileToken() } });

export const getRoom = (code, { since, hostKey } = {}) =>
  api(`/api/rooms/${encodeURIComponent(code)}${since ? `?since=${since}` : ''}`, { headers: headers(hostKey) });

export const sendOp = (code, body, hostKey) =>
  api(`/api/rooms/${encodeURIComponent(code)}/ops`, { method: 'POST', json: body, headers: headers(hostKey) });

// the record without its own room details (never send the host key inside the data)
export function stripRoom(record) {
  const { room, ...rest } = record;
  return rest;
}

// Rooms this browser joined as a participant: [{ code, name, tournament }], newest first.
export const joined = {
  get: () => store.get('joinedRooms', []),
  add: entry => store.set('joinedRooms', [entry, ...joined.get().filter(j => j.code !== entry.code)].slice(0, 10)),
};

export const watchUrl = code => new URL(`watch?code=${code}`, location.href).href;
export const joinUrl = code => new URL(`./?join=${code}`, location.href).href;
