// Single-elimination brackets. Used by the admin page to build and score a bracket, by the API to check one before
// saving it, and by the tournament page to draw it.
//
// A bracket: { kind: 'players' | 'teams', entrants: [names in seed order], rounds: [[match, …], …] }
// A match:   { a, b, a_ms, b_ms, winner }  a/b are names (null = bye or not decided yet), a_ms/b_ms optional race
//            times, winner 'a' | 'b' | null.

export const MAX_ENTRANTS = 128;

// Seed order for a bracket of `size` slots, so 1 meets `size` in round one and 1 and 2 can only meet in the final.
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap(s => [s, n - s]);
  }
  return order;
}

// A new bracket from entrants in seed order. Top seeds get byes when the count isn't a power of two.
export function createBracket(entrants, kind = 'players') {
  const names = [...new Set(entrants.map(e => String(e).trim()).filter(Boolean))].slice(0, MAX_ENTRANTS);
  if (names.length < 2) throw new Error('A bracket needs at least two entrants.');
  let size = 2;
  while (size < names.length) size *= 2;
  const order = seedOrder(size);
  const first = [];
  for (let i = 0; i < size; i += 2) {
    first.push(match(names[order[i] - 1] ?? null, names[order[i + 1] - 1] ?? null));
  }
  const rounds = [first];
  for (let n = size / 4; n >= 1; n /= 2) rounds.push(Array.from({ length: n }, () => match(null, null)));
  return propagate({ kind, entrants: names, rounds });
}

const match = (a, b) => ({ a, b, a_ms: null, b_ms: null, winner: null });

export const winnerOf = m => (m.winner === 'a' ? m.a : m.winner === 'b' ? m.b : null);

// Fills later rounds from earlier winners and settles byes. Call after any change to a match.
// A changed slot clears that match's result, so a corrected early result can't leave a stale winner downstream.
export function propagate(bracket) {
  const rounds = bracket.rounds;
  // round one: a lone entrant against a bye goes through
  for (const m of rounds[0]) {
    if (m.a && !m.b) m.winner = 'a';
    else if (!m.a && m.b) m.winner = 'b';
  }
  for (let r = 1; r < rounds.length; r++) {
    rounds[r].forEach((m, i) => {
      const a = winnerOf(rounds[r - 1][i * 2]);
      const b = winnerOf(rounds[r - 1][i * 2 + 1]);
      if (m.a !== a || m.b !== b) Object.assign(m, { a, b, a_ms: null, b_ms: null, winner: null });
    });
  }
  return bracket;
}

// Records a result: times (either may be null) and/or a winner. With both times and no winner given, the faster wins.
export function setResult(bracket, round, index, { a_ms = null, b_ms = null, winner = null }) {
  const m = bracket.rounds[round]?.[index];
  if (!m || !m.a || !m.b) throw new Error('That match has no two entrants yet.');
  m.a_ms = Number.isFinite(a_ms) ? a_ms : null;
  m.b_ms = Number.isFinite(b_ms) ? b_ms : null;
  if (!winner && m.a_ms && m.b_ms && m.a_ms !== m.b_ms) winner = m.a_ms < m.b_ms ? 'a' : 'b';
  m.winner = winner === 'a' || winner === 'b' ? winner : null;
  return propagate(bracket);
}

export function clearResult(bracket, round, index) {
  const m = bracket.rounds[round]?.[index];
  if (m && m.a && m.b) Object.assign(m, { a_ms: null, b_ms: null, winner: null });
  return propagate(bracket);
}

export function roundName(round, count) {
  const fromEnd = count - 1 - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round of ${2 ** (fromEnd + 1)}`;
}

export const champion = bracket => winnerOf(bracket.rounds[bracket.rounds.length - 1][0]);

// Checks a bracket sent by the admin page: right shape, names from its own entrant list. Returns an error or null.
export function checkBracket(b) {
  if (!b || typeof b !== 'object') return 'Expected a bracket.';
  if (!['players', 'teams'].includes(b.kind)) return 'Bracket kind must be players or teams.';
  if (!Array.isArray(b.entrants) || b.entrants.length < 2 || b.entrants.length > MAX_ENTRANTS) return 'A bracket needs 2–128 entrants.';
  if (!Array.isArray(b.rounds) || !b.rounds.length) return 'The bracket has no rounds.';
  const names = new Set(b.entrants);
  let expected = 2 ** (b.rounds.length - 1);
  for (const round of b.rounds) {
    if (!Array.isArray(round) || round.length !== expected) return 'The bracket rounds are the wrong size.';
    for (const m of round) {
      for (const side of ['a', 'b']) if (m[side] != null && !names.has(m[side])) return `"${m[side]}" isn't one of the bracket's entrants.`;
      if (m.winner != null && !['a', 'b'].includes(m.winner)) return 'A match winner must be a or b.';
      for (const t of ['a_ms', 'b_ms']) if (m[t] != null && !(Number.isInteger(m[t]) && m[t] > 0)) return 'Match times must be whole milliseconds.';
    }
    expected /= 2;
  }
  return null;
}
