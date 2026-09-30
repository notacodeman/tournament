// Words that can't be used in public text (tournament and player names, messages, rules). Checked by lib/moderation.js
// after undoing common disguises (l33t spelling, repeated letters, spaces or dots between letters).
// Add more here, or without a deploy through the BLOCKED_WORDS variable (comma-separated).
//
// ANYWHERE: long, unambiguous slurs, blocked even inside other words or spelled with gaps.
// WHOLE:    short words that are also parts of normal words (so "spice" and "raccoon" stay allowed).
// ALLOWED:  real words that contain an ANYWHERE entry.

export const ANYWHERE = [
  'nigger', 'nigga', 'faggot', 'fagot', 'kike', 'wetback', 'towelhead', 'raghead', 'sandnigger', 'tranny', 'trannie',
  'chingchong', 'spearchucker', 'porchmonkey', 'junglebunny', 'beaner', 'gypsie', 'shemale', 'retarded',
];

export const WHOLE = [
  'fag', 'fags', 'spic', 'spics', 'chink', 'chinks', 'gook', 'gooks', 'coon', 'coons', 'dyke', 'dykes', 'kyke',
  'paki', 'pakis', 'retard', 'retards', 'nazi', 'heil', 'cunt', 'cunts', 'whore', 'rape', 'rapist',
];

export const ALLOWED = ['snigger', 'sniggers', 'sniggering', 'kikeriki'];
