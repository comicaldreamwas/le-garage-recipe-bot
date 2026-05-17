'use strict';

const { DICTIONARY, OPPOSITES } = require('./dictionary');
const { normalizeText } = require('./normalize');
const { fuzzyMatchKeyword } = require('./fuzzy');

// Multi-word phrases sorted longest first so "goat cheese" wins over a
// later lone "cheese" hit on the same text.
const PHRASES = Object.keys(DICTIONARY)
  .filter((k) => k.includes(' '))
  .sort((a, b) => b.length - a.length);

/**
 * Extract a set of dictionary codes from raw user text.
 *
 *   "🍕 mushroom sauce please" → ['MUSHROOM', 'SAUCE']
 *   "chiken alfedo"            → ['CHICKEN', 'ALFREDO']  (typo-tolerant)
 *   "صلصة الترفل"              → ['SAUCE', 'TRUFFLE']
 *
 * Steps:
 *   1. Normalize (strip emoji, punctuation, stop words; lowercase).
 *   2. Match multi-word phrases first; remove matched text.
 *   3. For each remaining word, run fuzzyMatchKeyword (exact then Levenshtein).
 *   4. Deduplicate.
 */
function extractKeywords(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  let remaining = ' ' + normalized + ' '; // pad so word-boundary replacement works
  const found = new Set();

  // Pass 1: multi-word phrases
  for (const phrase of PHRASES) {
    const needle = ' ' + phrase + ' ';
    if (remaining.includes(needle)) {
      found.add(DICTIONARY[phrase]);
      remaining = remaining.split(needle).join(' ');
    }
  }

  // Pass 2: remaining single words with fuzzy fallback
  for (const word of remaining.split(/\s+/).filter(Boolean)) {
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
  const haystack = (recipe.url || '').toUpperCase();
  let score = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) score++;
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

// "Modifier" tokens — words that recipes use to describe component
// variants (a Caesar Salad DRESSING is not the same as a Caesar Salad
// dish). When the user didn't include such a modifier in their query
// but a candidate slug does, penalise it.
const MODIFIER_TOKENS = new Set([
  'SAUCE', 'DRESSING', 'OIL', 'BUTTER', 'PATTY', 'DOUGH', 'MARINADE',
  'MIX', 'PF', 'BUN', 'BUNS', 'PASTE', 'POWDER', 'TOPPING', 'BATTER',
]);
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
function searchRecipe(query, recipes) {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return null;

  let best = null;
  for (const [id, recipe] of Object.entries(recipes)) {
    const score = scoreRecipe(recipe, keywords);
    if (score <= 0) continue;
    if (!best) { best = { recipe, id, score, keywords }; continue; }
    // Primary: more keyword hits
    if (score > best.score) { best = { recipe, id, score, keywords }; continue; }
    if (score < best.score) continue;
    // Tiebreak 1: prefer slug whose tokens are mostly the query keywords
    const cov = slugTokenCoverage(recipe, keywords);
    const bcov = slugTokenCoverage(best.recipe, keywords);
    if (cov > bcov) { best = { recipe, id, score, keywords }; continue; }
    if (cov < bcov) continue;
    // Tiebreak 2: prefer slug WITHOUT extra modifier tokens the user
    // didn't ask for ("Caesar Salad" should beat "Caesar Salad
    // Dressing" when the query is just "caesar salad").
    const pen = modifierPenalty(recipe, keywords);
    const bpen = modifierPenalty(best.recipe, keywords);
    if (pen < bpen) { best = { recipe, id, score, keywords }; continue; }
    if (pen > bpen) continue;
    // Tiebreak 3: more complete recipe wins
    if (completenessScore(recipe) > completenessScore(best.recipe)) {
      best = { recipe, id, score, keywords };
    }
  }

  if (!best) return null;

  // Require at least 2 keyword matches when the query had >= 2 keywords;
  // otherwise a single match is enough.
  const minScore = Math.min(keywords.length, 2);
  if (best.score < minScore) return null;

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
function suggestRecipes(query, recipes, limit = 5) {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  const scored = [];
  for (const [id, recipe] of Object.entries(recipes)) {
    const score = scoreRecipe(recipe, keywords);
    if (score > 0) scored.push({ recipe, id, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const cb = slugTokenCoverage(b.recipe, keywords);
    const ca = slugTokenCoverage(a.recipe, keywords);
    if (cb !== ca) return cb - ca;
    const pa = modifierPenalty(a.recipe, keywords);
    const pb = modifierPenalty(b.recipe, keywords);
    if (pa !== pb) return pa - pb;
    return completenessScore(b.recipe) - completenessScore(a.recipe);
  });
  return scored.slice(0, limit);
}

module.exports = { searchRecipe, suggestRecipes, extractKeywords };
