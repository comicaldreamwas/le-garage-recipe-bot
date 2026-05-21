'use strict';

const { distance } = require('fastest-levenshtein');

const { DICTIONARY, OPPOSITES } = require('./dictionary');
const { normalizeText } = require('./normalize');
const { fuzzyMatchKeyword } = require('./fuzzy');
const {
  rebuildAutoTerms,
  getAutoWordCode,
  getAutoPhrases,
  getAutoPhraseCode,
  allAutoWords,
} = require('./autoTerms');

// Multi-word phrases sorted longest first so "goat cheese" wins over a
// later lone "cheese" hit on the same text.
const PHRASES = Object.keys(DICTIONARY)
  .filter((k) => k.includes(' '))
  .sort((a, b) => b.length - a.length);

// Fuzzy fallback for words that aren't in DICTIONARY but match a token
// from a recipe name (auto-dictionary). Conservative threshold so we
// don't pull in random typos that happen to look like a recipe word.
function fuzzyAutoMatch(word, restaurant) {
  if (!word) return null;
  if (word.length < 4) return null;
  const limit = word.length <= 5 ? 1 : 2;
  let bestKey = null;
  let bestDist = Infinity;
  for (const key of allAutoWords(restaurant)) {
    if (Math.abs(key.length - word.length) > limit) continue;
    const d = distance(word, key);
    if (d < bestDist && d <= limit) {
      bestDist = d;
      bestKey = key;
      if (d === 0) break;
    }
  }
  return bestKey ? getAutoWordCode(bestKey, restaurant) : null;
}

/**
 * Extract a set of keyword codes from raw user text.
 *
 *   "🍕 mushroom sauce please" → ['MUSHROOM', 'SAUCE']
 *   "chiken alfedo"            → ['CHICKEN', 'ALFREDO']  (typo-tolerant)
 *   "chicken in e basket"       → ['CHICKEN', 'BASKET']  (auto-dictionary)
 *   "صلصة الترفل"              → ['SAUCE', 'TRUFFLE']
 *
 * Steps:
 *   1. Normalize (strip emoji, punctuation, stop words; lowercase).
 *   2. Match multi-word phrases — DICTIONARY first, then auto-dictionary
 *      n-grams derived from recipe names.
 *   3. For each remaining word: DICTIONARY exact/fuzzy, then
 *      auto-dictionary exact/fuzzy.
 *   4. Deduplicate.
 */
// When a multi-word phrase resolves to a hyphenated code (CAESAR-DRESSING,
// PANNA-COTTA, …), the code only matches recipe slugs that contain the
// phrase as a contiguous substring. Real slugs often interleave extra
// words — "Caesar-salad-dressing" between CAESAR and DRESSING, or
// "Boho-Style-Caesar" with no SALAD at all. Component-wise singles
// keep the bot finding the dish even when the slug deviates from the
// query's exact phrasing.
function addPhraseComponentSingles(phrase, foundSet, restaurant) {
  for (const w of phrase.split(/\s+/).filter(Boolean)) {
    if (w.length < 2) continue;
    if (DICTIONARY[w])                 { foundSet.add(DICTIONARY[w]); continue; }
    const exactAuto = getAutoWordCode(w, restaurant);
    if (exactAuto)                     { foundSet.add(exactAuto); continue; }
  }
}

function extractKeywords(text, restaurant) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  let remaining = ' ' + normalized + ' '; // pad so word-boundary replacement works
  const found = new Set();

  // Pass 1: multi-word phrases — hand-curated first
  for (const phrase of PHRASES) {
    const needle = ' ' + phrase + ' ';
    if (remaining.includes(needle)) {
      found.add(DICTIONARY[phrase]);
      addPhraseComponentSingles(phrase, found, restaurant);
      remaining = remaining.split(needle).join(' ');
    }
  }
  // Pass 1b: auto-dictionary phrases derived from recipe names
  for (const phrase of getAutoPhrases(restaurant)) {
    const needle = ' ' + phrase + ' ';
    if (remaining.includes(needle)) {
      const code = getAutoPhraseCode(phrase, restaurant);
      if (code) found.add(code);
      addPhraseComponentSingles(phrase, found, restaurant);
      remaining = remaining.split(needle).join(' ');
    }
  }

  // Pass 2: remaining single words. Exact matches always win first
  // (DICTIONARY carries AR translations, auto carries recipe-name
  // tokens — both equally authoritative for exact). For fuzzy,
  // prefer auto-dictionary over hand-curated DICTIONARY because
  // recipe-name tokens are what the kitchen actually wants to hit;
  // DICTIONARY fuzzy can accidentally land on a synonym ("cordn"
  // shouldn't become CORN when CORDON exists in a recipe name).
  for (const word of remaining.split(/\s+/).filter(Boolean)) {
    if (DICTIONARY[word]) { found.add(DICTIONARY[word]); continue; }
    const exactAuto = getAutoWordCode(word, restaurant);
    if (exactAuto) { found.add(exactAuto); continue; }
    const fuzzyAuto = fuzzyAutoMatch(word, restaurant);
    if (fuzzyAuto) { found.add(fuzzyAuto); continue; }
    const code = fuzzyMatchKeyword(word);
    if (code) found.add(code);
  }

  return [...found];
}

/**
 * Score a single recipe against the keyword set.
 *
 * Score = number of keywords whose code appears in the recipe slug.
 * If an opposites pair is violated (query has A but recipe has only B,
 * or vice versa), score is forced to -1 so it's filtered out.
 */
// Used as a tie-breaker: when two recipes have the same keyword score,
// prefer the one with more populated fields so an empty placeholder
// page can't win over a real recipe.
function completenessScore(recipe) {
  const c = recipe.completeness;
  if (!c) {
    return (recipe.ingredients_en ? 1 : 0)
      + (recipe.ingredients_ar ? 1 : 0)
      + (recipe.prep_en ? 1 : 0)
      + (recipe.prep_ar ? 1 : 0);
  }
  return (c.has_ingredients_en ? 1 : 0)
    + (c.has_ingredients_ar ? 1 : 0)
    + (c.has_prep_en ? 1 : 0)
    + (c.has_prep_ar ? 1 : 0);
}

function scoreRecipe(recipe, keywords) {
  // Recipes with no ingredient lines in EITHER language are useless
  // to the kitchen — even if their slug happens to match a query
  // keyword. Exclude them so a draft or low-structure placeholder
  // (e.g. Boho "Panna Cotta" with no extracted body) can't outscore
  // the real recipe ("Breakfast Panna Cotta" with 9 lines).
  if (!recipe.ingredients_en && !recipe.ingredients_ar) return -1;

  const haystack = (recipe.url || '').toUpperCase();
  // Strip hyphens too so a keyword like "TARTAR" matches the slug
  // "Tar-Tar" (which has the two halves split by a hyphen).
  const stripped = haystack.replace(/-/g, '');
  let score = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw) || stripped.includes(kw.replace(/-/g, ''))) score++;
  }

  for (const [a, b] of OPPOSITES) {
    const queryHasA = keywords.includes(a);
    const queryHasB = keywords.includes(b);
    const recipeHasA = haystack.includes(a);
    const recipeHasB = haystack.includes(b);

    if (queryHasA && recipeHasB && !recipeHasA) return -1;
    if (queryHasB && recipeHasA && !recipeHasB) return -1;
  }

  return score;
}

// Count tokens in the recipe's URL slug — used as a tiebreak so that
// when two recipes match the same number of keywords, the one whose
// slug is more "about" those keywords wins. E.g. for query "burger":
//   "FISH-BURGER"            → 2 tokens, 1 matched, coverage 50%
//   "BLACK-BURGER-BUN"       → 3 tokens, 1 matched, coverage 33%
// prefer FISH-BURGER. For "le garage sauce" → ["LE-GARAGE", "SAUCE"]:
//   "LE-GARAGE-SAUCE"        → 4 tokens, all matched, coverage 100%
//   "PONZU-SAUCE"            → 2 tokens, 1 matched, coverage 50%
// LE-GARAGE-SAUCE wins because more of its slug is the query's keywords.
function slugTokenCoverage(recipe, keywords) {
  try {
    const path = new URL(recipe.url).pathname.split('/').pop() || '';
    const cleaned = path.replace(/-?[0-9a-f]{32}$/i, '');
    const tokens = cleaned.split('-').filter(Boolean).map((t) => t.toUpperCase());
    if (tokens.length === 0) return 0;
    let matched = 0;
    for (const t of tokens) {
      if (keywords.some((kw) => kw.includes(t) || t.includes(kw))) matched++;
    }
    return matched / tokens.length;
  } catch {
    return 0;
  }
}

// extractKeywords emits keywords in a meaningful order:
//   1. multi-word phrase codes first  (CAESAR-SALAD)
//   2. then the single-word components in phrase order (CAESAR, SALAD)
//   3. then standalone single-word keywords from the remaining text
// So the EARLIEST keyword index that matches a recipe's slug is a
// strong proxy for "which word did the user lead with". When two
// recipes both score a single keyword hit, the one whose match comes
// at a smaller index in the kws array should win — it aligns with
// the user's primary intent. This makes "caesar salad" prefer
// "Boho Style Caesar" (matches CAESAR @ index 1) over "Calamari
// Salad" (matches SALAD @ index 2).
function firstMatchedKeywordIndex(recipe, keywords) {
  const haystack = (recipe.url || '').toUpperCase();
  const stripped = haystack.replace(/-/g, '');
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    if (haystack.includes(kw) || stripped.includes(kw.replace(/-/g, ''))) return i;
  }
  return Infinity;
}

// "Modifier" tokens — words that recipes use to describe component
// variants (a Caesar Salad DRESSING is not the same as a Caesar Salad
// dish). When the user didn't include such a modifier in their query
// but a candidate slug does, penalise it.
const MODIFIER_TOKENS = new Set([
  'SAUCE', 'DRESSING', 'OIL', 'BUTTER', 'PATTY', 'DOUGH', 'MARINADE',
  'MIX', 'PF', 'BUN', 'BUNS', 'PASTE', 'POWDER', 'TOPPING', 'BATTER',
]);
// Position of the first keyword inside the slug. Lower = the slug
// leads with the matched term, so the recipe is "about" the keyword
// rather than mentioning it incidentally. "CAESAR-SALAD-LE-GARAGE-STYLE"
// matches at position 0; "Chicken-fillet-Caesar-salad" at position 16.
function firstMatchPosition(recipe, keywords) {
  const haystack = (recipe.url || '').toUpperCase();
  const stripped = haystack.replace(/-/g, '');
  let best = Infinity;
  for (const kw of keywords) {
    const i = haystack.indexOf(kw);
    if (i >= 0 && i < best) best = i;
    const j = stripped.indexOf(kw.replace(/-/g, ''));
    if (j >= 0 && j < best) best = j;
  }
  return best === Infinity ? 9999 : best;
}

function modifierPenalty(recipe, keywords) {
  try {
    const path = new URL(recipe.url).pathname.split('/').pop() || '';
    const cleaned = path.replace(/-?[0-9a-f]{32}$/i, '');
    const tokens = cleaned.split('-').filter(Boolean).map((t) => t.toUpperCase());
    const kwTokens = new Set();
    for (const kw of keywords) {
      for (const t of kw.split('-')) kwTokens.add(t);
    }
    let pen = 0;
    for (const t of tokens) {
      if (MODIFIER_TOKENS.has(t) && !kwTokens.has(t)) pen++;
    }
    return pen;
  } catch {
    return 0;
  }
}

/**
 * Find the best-matching recipe for a user query.
 *
 * @param {string} query - raw user input
 * @param {object} recipes - cache.recipes (id → recipe object with .url)
 * @returns {{recipe: object, id: string, score: number, keywords: string[]} | null}
 */
function searchRecipe(query, recipes, restaurant) {
  // Lazily refresh the auto-dictionary if the recipes object identity
  // has changed (bot.js also primes this on startup and cache reload).
  rebuildAutoTerms(recipes, restaurant);
  const keywords = extractKeywords(query, restaurant);
  if (keywords.length === 0) return null;

  let best = null;
  for (const [id, recipe] of Object.entries(recipes)) {
    const score = scoreRecipe(recipe, keywords);
    if (score <= 0) continue;
    if (!best) { best = { recipe, id, score, keywords }; continue; }
    // Primary: more keyword hits
    if (score > best.score) { best = { recipe, id, score, keywords }; continue; }
    if (score < best.score) continue;
    // Tiebreak 1: prefer slug WITHOUT extra modifier tokens the user
    // didn't ask for ("Caesar Salad" should beat "Caesar Salad
    // Dressing" when the query is just "caesar salad").
    const pen = modifierPenalty(recipe, keywords);
    const bpen = modifierPenalty(best.recipe, keywords);
    if (pen < bpen) { best = { recipe, id, score, keywords }; continue; }
    if (pen > bpen) continue;
    // Tiebreak 2: prefer the slug whose match comes EARLIEST in the
    // keyword array. extractKeywords emits the user's primary words
    // first (multi-word phrase, then its first component, then the
    // later components), so "caesar salad" lands CAESAR at index 1
    // and SALAD at index 2 — a recipe matching CAESAR (index 1)
    // should win over one only matching SALAD (index 2).
    const ki = firstMatchedKeywordIndex(recipe, keywords);
    const bki = firstMatchedKeywordIndex(best.recipe, keywords);
    if (ki < bki) { best = { recipe, id, score, keywords }; continue; }
    if (ki > bki) continue;
    // Tiebreak 3: prefer slug where the keyword appears earliest
    // ("Caesar-Salad-..." beats "Chicken-fillet-Caesar-salad").
    const pos = firstMatchPosition(recipe, keywords);
    const bpos = firstMatchPosition(best.recipe, keywords);
    if (pos < bpos) { best = { recipe, id, score, keywords }; continue; }
    if (pos > bpos) continue;
    // Tiebreak 3: prefer slug whose tokens are mostly the query keywords
    const cov = slugTokenCoverage(recipe, keywords);
    const bcov = slugTokenCoverage(best.recipe, keywords);
    if (cov > bcov) { best = { recipe, id, score, keywords }; continue; }
    if (cov < bcov) continue;
    // Tiebreak 4: more complete recipe wins
    if (completenessScore(recipe) > completenessScore(best.recipe)) {
      best = { recipe, id, score, keywords };
    }
  }

  if (!best) return null;

  // Require at least 2 keyword matches when the query had >= 2 keywords;
  // otherwise a single match is enough.
  const minScore = Math.min(keywords.length, 2);
  if (best.score >= minScore) return best;

  // No recipe scored ≥2 even though the query had ≥2 keywords. Some
  // dish names live at slugs that contain only one of the query terms
  // ("Tartar Sauce" lives at slug "Tar-Tar" — no SAUCE in the slug).
  // Fall back to the best single-keyword match so the bot still finds
  // *something* relevant instead of returning null. OPPOSITES still
  // applied via scoreRecipe = -1 already filtered out the wrong-side
  // candidates.
  return best;
}

/**
 * Build "Did you mean" suggestions when searchRecipe returns null.
 * Returns the top-N recipes that share at least one keyword.
 *
 * @param {string} query - raw user input
 * @param {object} recipes - cache.recipes
 * @param {number} limit  - max suggestions (default 5)
 * @returns {Array<{recipe, id, score}>}
 */
function suggestRecipes(query, recipes, limit = 5, restaurant) {
  rebuildAutoTerms(recipes, restaurant);
  const keywords = extractKeywords(query, restaurant);
  if (keywords.length === 0) return [];

  const scored = [];
  for (const [id, recipe] of Object.entries(recipes)) {
    const score = scoreRecipe(recipe, keywords);
    if (score > 0) scored.push({ recipe, id, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = modifierPenalty(a.recipe, keywords);
    const pb = modifierPenalty(b.recipe, keywords);
    if (pa !== pb) return pa - pb;
    const kiA = firstMatchedKeywordIndex(a.recipe, keywords);
    const kiB = firstMatchedKeywordIndex(b.recipe, keywords);
    if (kiA !== kiB) return kiA - kiB;
    const posA = firstMatchPosition(a.recipe, keywords);
    const posB = firstMatchPosition(b.recipe, keywords);
    if (posA !== posB) return posA - posB;
    const cb = slugTokenCoverage(b.recipe, keywords);
    const ca = slugTokenCoverage(a.recipe, keywords);
    if (cb !== ca) return cb - ca;
    return completenessScore(b.recipe) - completenessScore(a.recipe);
  });
  return scored.slice(0, limit);
}

module.exports = { searchRecipe, suggestRecipes, extractKeywords };
