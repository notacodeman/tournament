// Game presets the admin page offers when creating a tournament. A preset only fills in the form; everything it sets
// can be changed afterwards.

// Parking Garage Rally Circuit: 8 US garages in the base game and 8 European tracks in the European Tour DLC / DX
// edition, each raceable in three car classes. The in-game track names aren't listed anywhere we could check, so the
// tracks start with neutral names; rename them in the tournament form.
const pgrcTracks = [
  ...Array.from({ length: 8 }, (_, i) => `US Track ${i + 1}`),
  ...Array.from({ length: 8 }, (_, i) => `EU Track ${i + 1}`),
];

export const PRESETS = {
  pgrc: {
    label: 'Parking Garage Rally Circuit',
    game: 'Parking Garage Rally Circuit',
    tracks: pgrcTracks,
    classes: ['Light', 'Heavy', 'Ultra'],
    // default event: every US track in Heavy
    events: pgrcTracks.slice(0, 8).map(track => [track, 'Heavy']),
    platforms: ['Steam', 'Switch', 'DX'],
    proof: 'screenshot',
    noCheats: true,
    rules: 'Race the tracks and class shown in the event grid. Submit a screenshot of the results screen showing ' +
      'the track, class and time. Cheat codes (gravity codes, cheat cars, REVOLT and the like) are not allowed.',
    proofHint: 'The results screen, with track, class and time visible',
  },
  custom: {
    label: 'Custom game',
    game: '',
    tracks: ['Level 1'],
    classes: ['Any%'],
    events: [['Level 1', 'Any%']],
    platforms: ['PC'],
    proof: 'any',
    noCheats: false,
    rules: '',
    proofHint: 'A screenshot or video that shows the time',
  },
};

// Points for 1st, 2nd, 3rd… in each event when a tournament is scored by points.
export const DEFAULT_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
