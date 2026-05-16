'use strict';

// Telegram's hard limit on a sendMessage is 4096 chars. We aim for 3900 to
// leave headroom for Markdown escapes and the dish-name header.
const TELEGRAM_LIMIT = 3900;

/**
 * Render a cache entry into a Telegram-ready Markdown string.
 * Layout: dish name → ingredients (EN + AR) → preparation (EN + AR).
 * Sections are emitted only when their underlying field has content.
 *
 * If the bilingual output overflows TELEGRAM_LIMIT, falls back to
 * Arabic-only output so kitchen staff (primary audience) still get the
 * recipe. If even that overflows, hard-truncates.
 *
 * @param {object} recipe - cache entry
 * @returns {string}
 */
function formatRecipe(recipe) {
  const full = buildFull(recipe);
  if (full.length <= TELEGRAM_LIMIT) return full;

  const arOnly = buildArabicOnly(recipe);
  if (arOnly.length <= TELEGRAM_LIMIT) return arOnly;

  return arOnly.slice(0, TELEGRAM_LIMIT);
}

function buildFull(recipe) {
  const lines = [];
  lines.push(`🍽 *${recipe.name || 'Recipe'}*`);
  lines.push('');

  if (recipe.ingredients_en || recipe.ingredients_ar) {
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('📋 *INGREDIENTS / المكونات*');
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('');

    if (recipe.ingredients_en) {
      lines.push('🇬🇧 *English:*');
      lines.push(recipe.ingredients_en);
      lines.push('');
    }
    if (recipe.ingredients_ar) {
      lines.push('🇪🇬 *عربي:*');
      lines.push(recipe.ingredients_ar);
      lines.push('');
    }
  }

  if (recipe.prep_en || recipe.prep_ar) {
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('👨‍🍳 *PREPARATION / طريقة التحضير*');
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('');

    if (recipe.prep_en) {
      lines.push('🇬🇧 *English:*');
      lines.push(recipe.prep_en);
      lines.push('');
    }
    if (recipe.prep_ar) {
      lines.push('🇪🇬 *عربي:*');
      lines.push(recipe.prep_ar);
    }
  }

  return lines.join('\n').trimEnd();
}

function buildArabicOnly(recipe) {
  const lines = [];
  lines.push(`🍽 *${recipe.name || 'Recipe'}*`);
  lines.push('');

  if (recipe.ingredients_ar) {
    lines.push('📋 *المكونات*');
    lines.push('');
    lines.push(recipe.ingredients_ar);
    lines.push('');
  }

  if (recipe.prep_ar) {
    lines.push('👨‍🍳 *طريقة التحضير*');
    lines.push('');
    lines.push(recipe.prep_ar);
  }

  return lines.join('\n').trimEnd();
}

/**
 * Build the "Did you mean" suggestion message shown when search returns null.
 *
 * @param {Array<{recipe: object, id: string, score: number}>} suggestions
 * @returns {string}
 */
function formatSuggestions(suggestions) {
  const lines = [
    '🔍 Recipe not found.',
    '',
    '*Did you mean / هل تقصد:*',
  ];
  for (const s of suggestions) {
    lines.push(`• ${s.recipe.name || s.recipe.url}`);
  }
  lines.push('');
  lines.push('_Try one of these names / جرّب أحد هذه الأسماء_');
  return lines.join('\n');
}

const NOT_FOUND_MESSAGE =
  '🤷 Recipe not found. Try another name.\n' +
  'لم يتم العثور على الوصفة، جرب اسمًا آخر.';

module.exports = {
  formatRecipe,
  formatSuggestions,
  NOT_FOUND_MESSAGE,
  TELEGRAM_LIMIT,
};
