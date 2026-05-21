'use strict';

const { distance } = require('fastest-levenshtein');

const { DICTIONARY } = require('./dictionary');

// Length-based max-edit thresholds. Kitchen staff type fast on phones,
// so we accept up to 2 edits once the word is long enough to make false
// positives unlikely.
//
// Arabic short words need a tighter cap: مل/كل/قل, موس/موز (mousse vs
// banana), دل/فل, etc. are pairs that differ by a single letter and
// would otherwise fuzzy-match wildly. Restrict short Arabic tokens
// (≤4 chars) to exact matches only — they have to be in DICTIONARY
// or arabic-aliases verbatim to count.
function maxEditsFor(word) {
  const len = word.length;
  if (len < 3) return 0;            // too short — false positives explode
  const isArabic = /[؀-ۿ]/.test(word);
  if (isArabic && len <= 4) return 0; // short AR: exact only
  if (len < 5) return 1;             // 3-4 chars Latin: 1 edit
  return 2;                           // 5+ chars: 2 edits (handles "mushrum" → "mushroom")
}

// Arabic definite article. Stripping it as a prefix lets queries like
// "الترفل" hit the "ترفل" entry without needing both spellings in DICTIONARY.
function stripArabicArticle(word) {
  if (word.startsWith('ال') && word.length > 3) return word.slice(2);
  return word;
}

// Pre-compute the list of dictionary keys grouped by first character so the
// O(N) Levenshtein scan is bounded to plausible candidates. This is a cheap
// optimization but on a 200-key dictionary the full scan is also fine.
const DICTIONARY_KEYS = Object.keys(DICTIONARY);

/**
 * Resolve a single normalized word to a dictionary code.
 *   1. Exact match → return the code.
 *   2. Otherwise, scan the dictionary for the closest key by Levenshtein
 *      distance, with the per-length threshold applied.
 *   3. Return null if nothing is close enough.
 *
 * @param {string} word - already lower-cased and stripped
 * @returns {string|null} dictionary code or null
 */
function fuzzyMatchKeyword(word) {
  if (!word) return null;

  // Exact hit
  if (DICTIONARY[word]) return DICTIONARY[word];

  // Arabic article fallback — "الترفل" → "ترفل" → TRUFFLE
  const stripped = stripArabicArticle(word);
  if (stripped !== word && DICTIONARY[stripped]) return DICTIONARY[stripped];

  const limit = maxEditsFor(word);
  if (limit === 0) return null;

  let bestKey = null;
  let bestDist = Infinity;

  for (const key of DICTIONARY_KEYS) {
    // Multi-word entries are handled by the phrase pass in search.js
    if (key.includes(' ')) continue;

    // Cheap length filter: if abs diff exceeds limit, distance does too
    if (Math.abs(key.length - word.length) > limit) continue;

    const d = distance(word, key);
    if (d < bestDist && d <= limit) {
      bestDist = d;
      bestKey = key;
      if (d === 0) break; // can't do better than exact
    }
  }

  return bestKey ? DICTIONARY[bestKey] : null;
}

module.exports = { fuzzyMatchKeyword, maxEditsFor };
