'use strict';

const { missingFields, missingCritical, isEmpty, isUsable } = require('./parser');

// Telegram's hard limit on a sendMessage is 4096 chars. We aim for 3900 to
// leave headroom for Markdown escapes and the "edit in Notion" footer.
const TELEGRAM_LIMIT = 3900;

/**
 * Render a cache entry into a Telegram-ready Markdown string.
 * Always includes an "Edit in Notion" footer. If the recipe is
 * incomplete, prepends a missing-fields warning at the top.
 * Empty recipes get a placeholder instead of the full template.
 */
function formatRecipe(recipe) {
  if (isEmpty(recipe)) return buildEmpty(recipe);

  // Only critical gaps (ingredients) warrant a top-of-message warning.
  // Missing prep / photo / video are nice-to-have and shouldn't clutter
  // the recipe view for kitchen staff.
  const criticalGaps = missingCritical(recipe);
  const warning = criticalGaps.length ? buildWarning(criticalGaps) : '';
  const footer = buildFooter(recipe);

  const full = warning + buildFull(recipe) + footer;
  if (full.length <= TELEGRAM_LIMIT) return full;

  // Overflow — drop English to keep Arabic intact (kitchen primary language).
  const arOnly = warning + buildArabicOnly(recipe) + footer;
  if (arOnly.length <= TELEGRAM_LIMIT) return arOnly;

  return arOnly.slice(0, TELEGRAM_LIMIT - 30) + '\n…(truncated)';
}

function buildWarning(miss) {
  // Friendlier copy now that the warning only ever fires for missing
  // ingredients — those are actually blocking for the kitchen.
  const label = miss.length === 2
    ? 'English & Arabic ingredients'
    : (miss[0] === 'ingredients_en' ? 'English ingredients' : 'Arabic ingredients');
  return (
    `⚠️ *${label} missing in Notion*\n\n`
  );
}

function buildFooter(recipe) {
  if (!recipe.url) return '';
  return `\n\n📝 [Edit in Notion](${recipe.url})`;
}

function buildEmpty(recipe) {
  return (
    `🍽 *${recipe.name || 'Empty Recipe'}*\n\n` +
    '⚠️ This recipe has no content in Notion yet.\n\n' +
    `📝 [Add content here](${recipe.url || ''})`
  );
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
 * "Did you mean" suggestions when search returns null.
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

/**
 * /broken summary: list every recipe that has critical gaps (missing
 * ingredients) and every fully-empty page. Missing prep/photo/video
 * are tracked separately but no longer appear here — they're nice-to-
 * haves, not blockers for kitchen use.
 */
function formatBrokenReport(recipes) {
  const broken = [];
  for (const [id, r] of Object.entries(recipes)) {
    if (isEmpty(r)) {
      broken.push({ recipe: r, miss: ['ALL'] });
      continue;
    }
    const miss = missingCritical(r);
    if (miss.length) broken.push({ recipe: r, miss });
  }

  if (broken.length === 0) {
    return ['✅ All recipes have ingredients!'];
  }

  const header = `⚠️ *Recipes missing ingredients:* ${broken.length}\n\n`;
  const messages = [];
  let current = header;

  for (const { recipe, miss } of broken) {
    const entry =
      `• [${recipe.name || '(no name)'}](${recipe.url})\n` +
      `  _Missing:_ ${miss.join(', ')}\n\n`;
    if ((current + entry).length > TELEGRAM_LIMIT) {
      messages.push(current.trimEnd());
      current = entry;
    } else {
      current += entry;
    }
  }
  if (current.trim()) messages.push(current.trimEnd());
  return messages;
}

module.exports = {
  formatRecipe,
  formatSuggestions,
  formatBrokenReport,
  NOT_FOUND_MESSAGE,
  TELEGRAM_LIMIT,
};
