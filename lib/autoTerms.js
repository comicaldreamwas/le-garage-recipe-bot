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

// Runtime-built dictionary derived from cached recipe names. Kept
// separate from the hand-curated DICTIONARY so we can rebuild without
// touching the source-controlled file when cache changes.
let AUTO_WORDS = new Map();    // lowercase token → UPPER-CASE code
let AUTO_PHRASES = [];         // ['chicken in basket', ...] longest first
let AUTO_PHRASE_CODES = new Map(); // lowercase phrase → code
let _indexedRecipesRef = null; // identity sentinel so rebuilds are cheap

// Pull tokens out of a recipe name. Recipe names are mostly Latin but
// some carry Arabic too (kitchen sometimes writes the dish name in
// both scripts). We keep letters of any script + digits, strip the
// rest, then filter stop/service words and very short fragments.
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

/**
 * Rebuild the runtime auto-dictionary from the current cache. Idempotent
 * and cheap (O(recipes × tokens-per-name)). Called from bot.js after
 * loadCache() and from the watchCache callback after a cache rewrite.
 *
 * @param {object} recipes - cache.recipes (id → recipe)
 */
function rebuildAutoTerms(recipes) {
  if (recipes === _indexedRecipesRef) return; // same object, skip
  const words = new Map();
  const phraseCodes = new Map();

  for (const r of Object.values(recipes || {})) {
    const tokens = tokenizeName(r?.name);
    if (tokens.length === 0) continue;

    for (const t of tokens) {
      // Don't shadow a hand-curated DICTIONARY entry — that one may
      // carry the AR translation too. Auto-add only NEW words.
      if (DICTIONARY[t]) continue;
      if (!words.has(t)) words.set(t, t.toUpperCase());
    }

    // Capture useful bi-/tri-grams from the name so multi-word
    // phrases ("le garage", "chicken basket") get a dedicated code.
    // Skip if the n-gram contains any stop word — those phrases are
    // grammatical noise. We do this on the FILTERED tokens directly.
    for (let n = 2; n <= 3 && n <= tokens.length; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const phrase = tokens.slice(i, i + n).join(' ');
        const code = tokens.slice(i, i + n).join('-').toUpperCase();
        if (!DICTIONARY[phrase] && !phraseCodes.has(phrase)) {
          phraseCodes.set(phrase, code);
        }
      }
    }
  }

  AUTO_WORDS = words;
  AUTO_PHRASE_CODES = phraseCodes;
  AUTO_PHRASES = [...phraseCodes.keys()].sort((a, b) => b.length - a.length);
  _indexedRecipesRef = recipes;
}

function getAutoWordCode(word) {
  return AUTO_WORDS.get(word) || null;
}

function getAutoPhrases() {
  return AUTO_PHRASES;
}

function getAutoPhraseCode(phrase) {
  return AUTO_PHRASE_CODES.get(phrase) || null;
}

// Read-only view for stats / tests.
function autoStats() {
  return {
    words: AUTO_WORDS.size,
    phrases: AUTO_PHRASES.length,
  };
}

// Iterable of all auto-words (used by fuzzy fallback in search.js).
function allAutoWords() {
  return AUTO_WORDS.keys();
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
