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
    if (!best || score > best.score || (score === best.score && completenessScore(recipe) > completenessScore(best.recipe))) {
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
    return completenessScore(b.recipe) - completenessScore(a.recipe);
  });
  return scored.slice(0, limit);
}

module.exports = { searchRecipe, suggestRecipes, extractKeywords };
