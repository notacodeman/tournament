// Host editing dialogs shared by the admin page (tournaments on the site) and the tournament view (tournaments saved
// in this browser): the player list, adding a time, and building or scoring a bracket.
// Each takes the current values and an async onSave; a thrown error is shown in the dialog.

import { el } from './util.js';
import { parseTime, formatTime } from '../lib/time.js';
import { createBracket, setResult, clearResult, roundName } from '../lib/bracket.js';

// A modal <dialog> with a form. build(form) adds the fields; submit(form) returns a promise; dialog closes on success.
export function formDialog(title, build, submit, { saveLabel = 'Save', danger = false } = {}) {
  const error = el('div');
  const form = el('form', { method: 'dialog' });
  const dialog = el('dialog', { 'aria-label': title }, el('h2', {}, title), form);
  build(form);
  const save = el(`button.btn.${danger ? 'danger' : 'primary'}`, { type: 'submit' }, saveLabel);
  form.append(error, el('div.foot', {}, el('button.btn', { type: 'button', onclick: () => dialog.close() }, 'Cancel'), save));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    save.disabled = true;
    error.replaceChildren();
    try {
      await submit(form);
      dialog.close();
    } catch (err) {
      error.replaceChildren(el('div.message.error', {}, err.message));
    } finally {
      save.disabled = false;
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

export const confirmDialog = (title, text, onYes, label = 'Delete') =>
  formDialog(title, f => f.append(el('p', {}, text)), async () => onYes(), { saveLabel: label, danger: true });

// ---------- Players ----------
// players: [{ name, team, platform }] → onSave(list) with the same shape, in the new order.
export function playersDialog(players, onSave) {
  formDialog('Players', form => {
    const text = players.map(p => [p.name, p.team, p.platform].filter((v, i) => v || i === 0).join(', ').replace(/(, )+$/, '')).join('\n');
    form.append(
      el('p.note', {}, 'One player per line: name, team, platform. Team and platform are optional. The order is the seed order (top seed first).'),
      el('label.field', {}, 'Player list', el('textarea', { name: 'list', rows: 12, spellcheck: 'false', placeholder: 'driftking, Team Level P1, Steam\nska_wheel, , Switch' }, text)),
      el('p.note', {}, 'When a tournament has a player list, only these names can have times.'));
  }, async form => {
    const seen = new Set();
    const list = [];
    for (const [i, line] of form.elements.list.value.split('\n').entries()) {
      if (!line.trim()) continue;
      const [name, team = '', platform = ''] = line.split(',').map(s => s.trim());
      if (!name) throw new Error(`Line ${i + 1} has no name.`);
      if (name.length > 32) throw new Error(`"${name}" is over 32 characters.`);
      if (seen.has(name.toLowerCase())) throw new Error(`"${name}" is in the list twice.`);
      seen.add(name.toLowerCase());
      list.push({ name, team, platform });
    }
    await onSave(list);
  });
}

// ---------- Add a time ----------
// onSave({ racer, platform, track, cls, time_ms, penalty_ms, penalty_note })
export function addTimeDialog(tournament, players, onSave, preset = {}) {
  formDialog('Add a time', form => {
    // preset.lockRacer: a participant entering their own time, so the racer is fixed
    const racer = preset.lockRacer
      ? el('input', { type: 'text', name: 'racer', readonly: true, value: preset.racer || '' })
      : players.length
      ? el('select', { name: 'racer', required: true }, el('option', { value: '' }, 'Pick a racer'),
        ...players.map(p => el('option', { value: p.name, selected: p.name === preset.racer }, p.team ? `${p.name} (${p.team})` : p.name)))
      : el('input', { type: 'text', name: 'racer', required: true, maxlength: 32, value: preset.racer || '', autocomplete: 'off' });
    const platform = el('select', { name: 'platform' }, el('option', { value: '' }, '—'),
      ...tournament.platforms.map(p => el('option', { value: p }, p)));
    const fillPlatform = () => {
      const p = players.find(x => x.name.toLowerCase() === racer.value.toLowerCase());
      if (p?.platform) platform.value = p.platform;
    };
    racer.addEventListener('change', fillPlatform);
    fillPlatform();
    form.append(el('div.form-grid', {},
      el('label.field', {}, 'Racer', racer),
      el('label.field', {}, 'Platform', platform),
      el('label.field.wide', {}, 'Track and class', el('select', { name: 'event' },
        ...tournament.events.map(([t, c], i) => el('option', { value: i, selected: preset.event === i }, `${t} · ${c}`)))),
      el('label.field', {}, 'Time', el('input.mono', { type: 'text', name: 'time', required: true, placeholder: '1:04.777', inputmode: 'decimal' })),
      el('label.field', {}, 'Penalty (seconds)', el('input', { type: 'number', name: 'penalty', min: 0, step: 0.001, placeholder: '0' })),
      el('label.field.wide', {}, 'Penalty note', el('input', { type: 'text', name: 'note', maxlength: 200, placeholder: 'Optional, e.g. wall skip at turn 4' }))));
  }, async form => {
    const f = form.elements;
    const time = parseTime(f.time.value);
    if (!f.racer.value.trim()) throw new Error('Pick or type the racer.');
    if (!time) throw new Error('Write the time like 1:04.777.');
    const penalty = f.penalty.value ? Math.round(Number(f.penalty.value) * 1000) : 0;
    if (!Number.isFinite(penalty) || penalty < 0) throw new Error('The penalty has to be 0 or more seconds.');
    const [track, cls] = tournament.events[Number(f.event.value)];
    await onSave({ racer: f.racer.value.trim(), platform: f.platform.value, track, cls, time_ms: time, penalty_ms: penalty, penalty_note: f.note.value.trim() });
  }, { saveLabel: 'Add time' });
}

// ---------- Bracket ----------
// New bracket: pick players or teams and how to seed. standingsNames = names in current standings order.
export function newBracketDialog(players, standingsNames, onSave) {
  const teams = [...new Set(players.map(p => p.team).filter(Boolean))];
  formDialog('Create a bracket', form => {
    form.append(
      el('label.field', {}, 'Bracket of', el('select', { name: 'kind' },
        el('option', { value: 'players' }, `Players (${players.length || standingsNames.length})`),
        teams.length >= 2 ? el('option', { value: 'teams' }, `Teams (${teams.length})`) : '')),
      el('label.field', {}, 'Seeding', el('select', { name: 'seeding' },
        el('option', { value: 'list' }, 'Player list order (top seed first)'),
        el('option', { value: 'standings' }, 'Current standings'),
        el('option', { value: 'random' }, 'Random draw'))),
      el('p.note', {}, 'Single elimination. When the count isn’t 4, 8, 16… the top seeds get a bye in round one. Creating a new bracket replaces the old one.'));
  }, async form => {
    const kind = form.elements.kind.value;
    const seeding = form.elements.seeding.value;
    let names;
    if (kind === 'teams') {
      const order = seeding === 'standings'
        ? [...new Set(standingsNames.map(n => players.find(p => p.name.toLowerCase() === n.toLowerCase())?.team).filter(Boolean)), ...teams]
        : teams;
      names = [...new Set(order)];
    } else {
      const list = players.length ? players.map(p => p.name) : standingsNames;
      names = seeding === 'standings' ? [...new Set([...standingsNames.filter(n => !players.length || list.includes(n)), ...list])] : list;
    }
    if (seeding === 'random') {
      names = [...names];
      for (let i = names.length - 1; i > 0; i--) {
        const j = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 * (i + 1));
        [names[i], names[j]] = [names[j], names[i]];
      }
    }
    await onSave(createBracket(names, kind));
  }, { saveLabel: 'Create bracket' });
}

// Record a match: times for each side and/or the winner. onSave(nextBracket, { round, index, a_ms, b_ms, winner | clear }).
export function matchDialog(bracket, round, index, onSave) {
  const m = bracket.rounds[round][index];
  formDialog(`${roundName(round, bracket.rounds.length)} · ${m.a} vs ${m.b}`, form => {
    const side = s => el('div.match-side', {},
      el('label.field', {}, `${m[s]} time`, el('input.mono', { type: 'text', name: `${s}_time`, value: m[`${s}_ms`] ? formatTime(m[`${s}_ms`]) : '', placeholder: '1:04.777' })),
      el('label.check', {}, el('input', { type: 'radio', name: 'winner', value: s, checked: m.winner === s }), el('span', {}, `${m[s]} won`)));
    form.append(el('div.form-grid', {}, side('a'), side('b')),
      el('label.check', {}, el('input', { type: 'radio', name: 'winner', value: '', checked: !m.winner }), el('span', {}, 'Decide by the times (faster wins)')),
      el('p.note', {}, 'Leave the times empty to just pick the winner (a DNF, a forfeit). Changing a result clears the matches it fed into.'),
      el('button.btn.small', { type: 'button', onclick: async e => { const d = e.target.closest('dialog'); await onSave(clearResult(bracket, round, index), { round, index, clear: true }); d.close(); } }, 'Clear this result'));
  }, async form => {
    const f = form.elements;
    const read = v => { if (!v.trim()) return null; const ms = parseTime(v); if (!ms) throw new Error(`"${v}" isn't a time.`); return ms; };
    const a_ms = read(f.a_time.value);
    const b_ms = read(f.b_time.value);
    const winner = f.winner.value || null;
    if (!winner && !(a_ms && b_ms)) throw new Error('Enter both times, or pick who won.');
    if (!winner && a_ms === b_ms) throw new Error('The times are tied. Pick who won.');
    await onSave(setResult(bracket, round, index, { a_ms, b_ms, winner }), { round, index, a_ms, b_ms, winner });
  }, { saveLabel: 'Save result' });
}
