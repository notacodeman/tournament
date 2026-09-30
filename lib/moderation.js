// The blocked-word check for public text. Used by the Functions (the real check) and by the setup guide in the page
// (so people hear about a problem before they send anything). Like any word list it can be dodged by someone
// determined; the admin page can delete anything that gets through.

import { ANYWHERE, WHOLE, ALLOWED } from './blocked-words.js';

// l33t and look-alike characters → letters
const LOOKALIKE = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't', '€': 'e', '¡': 'i' };

function normalize(text) {
  return String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')      // é → e
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')                               // zero-width characters
    .toLowerCase()
    .replace(/[01345789@$!|+€¡]/g, c => LOOKALIKE[c] ?? c);
}

// each letter may repeat: "niiigger" still matches
const pattern = word => word.split('').map(c => `${c}+`).join('');

let compiled = null;
function lists(extra = '') {
  const extraWords = String(extra).split(',').map(w => normalize(w.trim())).filter(w => w.length > 2);
  const key = extraWords.join(',');
  if (compiled?.key === key) return compiled;
  const anywhere = [...ANYWHERE, ...extraWords.filter(w => w.length >= 5)];
  const whole = [...WHOLE, ...extraWords.filter(w => w.length < 5)];
  compiled = {
    key,
    anywhere: new RegExp(anywhere.map(pattern).join('|')),
    // with the gaps between letters removed, only the long words: short ones turn up by chance across word breaks
    squashed: new RegExp(anywhere.filter(w => w.length >= 6).map(pattern).join('|')),
    whole: new RegExp(`(?:^|[^a-z])(?:${whole.map(pattern).join('|')})(?:$|[^a-z])`),
    allowed: new RegExp(ALLOWED.join('|'), 'g'),
  };
  return compiled;
}

// The first blocked word found in the text, or null.
export function blockedWord(text, extra = '') {
  if (!text) return null;
  const l = lists(extra);
  const norm = normalize(text).replace(l.allowed, ' ');
  const words = norm.replace(/[^a-z]+/g, ' ');           // "n.i.g" style separators become spaces
  const squashed = norm.replace(/[^a-z]/g, '');           // and are removed entirely for the long words
  const hit = words.match(l.anywhere) || squashed.match(l.squashed) || ` ${words} `.match(l.whole);
  return hit ? hit[0].trim() : null;
}

// Checks several labelled texts; returns an error message for the first one with a blocked word, or null.
export function checkTexts(fields, extra = '') {
  for (const [label, value] of fields) {
    const list = Array.isArray(value) ? value : [value];
    for (const v of list) {
      if (blockedWord(v, extra)) return `${label} contains a word that isn't allowed here. Please change it.`;
    }
  }
  return null;
}
