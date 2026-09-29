// Turning verified runs into standings. Runs in the browser from the runs the API returns, so the tournament page,
// the overlay and the admin page all rank the same way.
//
// A run: { id, racer, platform, track, cls, time_ms, penalty_ms, submitted_at }.
// An event is one [track, class] pair that counts in the tournament.

export const eventKey = (track, cls) => `${track}\u0000${cls}`;
export const racerKey = name => String(name).trim().toLowerCase();

const effective = run => run.time_ms + (run.penalty_ms || 0);

// Faster first; on a tie, whoever submitted first.
const byTime = (a, b) => effective(a) - effective(b) || String(a.submitted_at).localeCompare(String(b.submitted_at));

// Each racer's best run per event, and a leaderboard per event.
export function eventBoards(tournament, runs) {
  const counted = new Set(tournament.events.map(([t, c]) => eventKey(t, c)));
  const best = new Map(); // eventKey → Map(racerKey → run)
  for (const run of runs) {
    const key = eventKey(run.track, run.cls);
    if (!counted.has(key)) continue;
    if (!best.has(key)) best.set(key, new Map());
    const perRacer = best.get(key);
    const current = perRacer.get(racerKey(run.racer));
    if (!current || byTime(run, current) < 0) perRacer.set(racerKey(run.racer), run);
  }
  const boards = new Map();
  for (const [track, cls] of tournament.events) {
    const key = eventKey(track, cls);
    const rows = [...(best.get(key)?.values() || [])].sort(byTime);
    boards.set(key, rows.map((run, i) => ({
      pos: i + 1, run, time: effective(run),
      gapLead: i ? effective(run) - effective(rows[0]) : 0,
    })));
  }
  return boards;
}

// Overall standings. Scoring 'time': lowest total of best times; racers who haven't done every event come after
// everyone who has, by events done, then total. Scoring 'points': points per event place, summed, ties broken by
// events done and then total time.
export function overall(tournament, runs) {
  const boards = eventBoards(tournament, runs);
  const eventCount = tournament.events.length;
  const points = tournament.points || [];
  const racers = new Map();
  for (const [key, rows] of boards) {
    for (const row of rows) {
      const id = racerKey(row.run.racer);
      if (!racers.has(id)) racers.set(id, { id, name: row.run.racer, platforms: new Set(), done: 0, total: 0, points: 0, events: new Map() });
      const r = racers.get(id);
      r.platforms.add(row.run.platform);
      r.done += 1;
      r.total += row.time;
      r.points += points[row.pos - 1] || 0;
      r.events.set(key, row);
    }
  }
  const list = [...racers.values()].map(r => ({ ...r, platforms: [...r.platforms].filter(Boolean), complete: r.done === eventCount }));
  if (tournament.scoring === 'points') {
    list.sort((a, b) => b.points - a.points || b.done - a.done || a.total - b.total);
  } else {
    list.sort((a, b) => (b.complete - a.complete) || b.done - a.done || a.total - b.total);
  }
  const leader = list[0];
  list.forEach((r, i) => {
    r.pos = i + 1;
    if (tournament.scoring === 'points') {
      r.gapLead = leader && i ? leader.points - r.points : 0;
      r.gapNext = i ? list[i - 1].points - r.points : 0;
    } else {
      // time gaps only mean something between racers who finished every event
      r.gapLead = r.complete && leader.complete && i ? r.total - leader.total : null;
      r.gapNext = r.complete && i && list[i - 1].complete ? r.total - list[i - 1].total : null;
    }
  });
  return { rows: list, boards, eventCount };
}
