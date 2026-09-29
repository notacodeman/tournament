// Reading and writing race times. Times are always whole milliseconds (integers), never floats.
// Shared by the pages and the API, so a time typed in the browser is read the same way the server checks it.

// Accepts 1:02.345, 62.345, 62, 1:02:03.4 (hours for endurance runs) and a comma as the decimal mark.
// A fraction shorter than 3 digits is read as tenths/hundredths: 62.3 is 62.300. Returns null when it isn't a time.
export function parseTime(text) {
  const clean = String(text ?? '').trim().replace(',', '.');
  const match = /^(?:(?:(\d+):)?(\d{1,2}):)?(\d{1,2}|\d+)(?:\.(\d{1,3}))?$/.exec(clean);
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  // with minutes given, seconds must be under 60
  if (minutes !== undefined && Number(seconds) > 59) return null;
  if (hours !== undefined && Number(minutes) > 59) return null;
  const ms = ((Number(hours || 0) * 60 + Number(minutes || 0)) * 60 + Number(seconds)) * 1000
    + Number((fraction || '').padEnd(3, '0'));
  return ms > 0 ? ms : null;
}

// 64777 → "1:04.777"; an hour or more → "1:02:03.456".
export function formatTime(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const total = Math.round(ms);
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor(total / 60000) % 60;
  const seconds = Math.floor(total / 1000) % 60;
  const rest = String(total % 1000).padStart(3, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}.${rest}` : `${minutes}:${ss}.${rest}`;
}

// A difference between two times: +1.748, or +1:02.300 past a minute.
export function formatGap(ms) {
  if (ms == null) return '—';
  if (ms === 0) return '—';
  return '+' + (ms < 60000 ? (ms / 1000).toFixed(3) : formatTime(ms));
}
