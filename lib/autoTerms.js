'use strict';

const { DICTIONARY } = require('./dictionary');

// Words that appear in recipe names but shouldn't become search
// keywords. Stop words are grammatical glue; service words are
// kitchen-system labels ("PF" = prefab, "Mix" = pre-mix component)
// that don't help disambiguate one dish from another.
const STOP_WORDS = new Set([
  'and', 'with', 'for', 'the', 'a', 'an', 'of', 'in', 'on', 'at', 'by',
  'to', 'is', 'are', 'or', 'le', 'la', 'el', 'new', 'old',
]);
const SERVICE_WORDS = new Set([
  'pf', 'prep', 'recipe', 'mix', 'style', 'kids', 'card', 'sop',
]);

// One slot per restaurant. The bot has two caches (le_garage, boho)
// and serves each user from the slot matching their preference, so
// the auto-dictionary is built per-restaurant too — a Le Garage user
// shouldn't hit a Boho recipe word and vice versa.
//   indices['le_garage'] = { words: Map, phrases: [], phraseCodes: Map, ref: <object identity> }
const indices = new Map();

function tokenizeName(name) {
  if (!name) return [];
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) =>
      w.length > 2 &&
      !STOP_WORDS.has(w) &&
      !SERVICE_WORDS.has(w),
    );
}

function emptyIndex() { return { words: new Map(), phrases: [], phraseCodes: new Map(), ref: null }; }
function getIndex(restaurant) { return indices.get(restaurant || 'default') || emptyIndex(); }

/**
 * Build (or refresh) the per-restaurant auto-dictionary. Memoized by
 * the identity of the `recipes` object so repeated calls within the
 * same cache load are O(1).
 *
 * @param {object} recipes — { id → recipe } for ONE restaurant
 * @param {string} restaurant — 'le_garage' | 'boho' | 'default'
 */
function rebuildAutoTerms(recipes, restaurant) {
  const key = restaurant || 'default';
  const existing = indices.get(key);
  if (existing && existing.ref === recipes) return;

  const words = new Map();
  const phraseCodes = new Map();

  for (const r of Object.values(recipes || {})) {
    const tokens = tokenizeName(r?.name);
    if (tokens.length === 0) continue;

    for (const t of tokens) {
      if (DICTIONARY[t]) continue;            // don't shadow curated entries
      if (!words.has(t)) words.set(t, t.toUpperCase());
    }

    for (let n = 2; n <= 3 && n <= tokens.length; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const phrase = tokens.slice(i, i + n).join(' ');
        const code   = tokens.slice(i, i + n).join('-').toUpperCase();
        if (!DICTIONARY[phrase] && !phraseCodes.has(phrase)) {
          phraseCodes.set(phrase, code);
        }
      }
    }
  }

  indices.set(key, {
    words,
    phraseCodes,
    phrases: [...phraseCodes.keys()].sort((a, b) => b.length - a.length),
    ref: recipes,
  });
}

function getAutoWordCode(word, restaurant)   { return getIndex(restaurant).words.get(word)   || null; }
function getAutoPhrases(restaurant)          { return getIndex(restaurant).phrases; }
function getAutoPhraseCode(phrase, restaurant){ return getIndex(restaurant).phraseCodes.get(phrase) || null; }
function allAutoWords(restaurant)            { return getIndex(restaurant).words.keys(); }
function autoStats(restaurant) {
  const i = getIndex(restaurant);
  return { words: i.words.size, phrases: i.phrases.length };
}

module.exports = {
  rebuildAutoTerms,
  getAutoWordCode,
  getAutoPhrases,
  getAutoPhraseCode,
  allAutoWords,
  autoStats,
  tokenizeName,
  STOP_WORDS,
  SERVICE_WORDS,
};
