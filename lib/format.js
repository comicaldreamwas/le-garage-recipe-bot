'use strict';

const { missingFields, missingCritical, isEmpty, isUsable } = require('./parser');

// Telegram's hard limit on a sendMessage is 4096 chars. We aim for 3900 to
// leave headroom for HTML tags and the "edit in Notion" footer.
const TELEGRAM_LIMIT = 3900;

// Escape HTML special chars in user-content. Telegram's HTML parse mode only
// treats <, >, & as syntax — much smaller surface than Markdown which trips
// on stray underscores and asterisks inside recipe text (e.g. "٥٠ جرام_").
function esc(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Render a cache entry into a Telegram-ready HTML string.
 * The Edit-in-Notion link is delivered as an inline keyboard button by
 * lib/telegram.js rather than an in-text footer, so this output is the
 * recipe content only.
 */
function formatRecipe(recipe) {
  if (isEmpty(recipe)) return buildEmpty(recipe);

  // Only critical gaps (ingredients) warrant a top-of-message warning.
  const criticalGaps = missingCritical(recipe);
  const warning = criticalGaps.length ? buildWarning(criticalGaps) : '';

  const full = warning + buildFull(recipe);
  if (full.length <= TELEGRAM_LIMIT) return full;

  // Overflow — drop English to keep Arabic intact (kitchen primary language).
  const arOnly = warning + buildArabicOnly(recipe);
  if (arOnly.length <= TELEGRAM_LIMIT) return arOnly;

  return arOnly.slice(0, TELEGRAM_LIMIT - 30) + '\n…(truncated)';
}

function buildWarning(miss) {
  const label = miss.length === 2
    ? 'English &amp; Arabic ingredients'
    : (miss[0] === 'ingredients_en' ? 'English ingredients' : 'Arabic ingredients');
  return `⚠️ <b>${label} missing in Notion</b>\n\n`;
}

function buildEmpty(recipe) {
  return (
    `🍽 <b>${esc(recipe.name || 'Empty Recipe')}</b>\n\n` +
    '⚠️ This recipe has no content in Notion yet.'
  );
}

function buildFull(recipe) {
  const lines = [];
  lines.push(`🍽 <b>${esc(recipe.name || 'Recipe')}</b>`);
  lines.push('');

  if (recipe.ingredients_en || recipe.ingredients_ar) {
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('📋 <b>INGREDIENTS / المكونات</b>');
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('');

    if (recipe.ingredients_en) {
      lines.push('🇬🇧 <b>English:</b>');
      lines.push(esc(recipe.ingredients_en));
      lines.push('');
    }
    if (recipe.ingredients_ar) {
      lines.push('🇪🇬 <b>عربي:</b>');
      lines.push(esc(recipe.ingredients_ar));
      lines.push('');
    }
  }

  if (recipe.prep_en || recipe.prep_ar) {
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('👨‍🍳 <b>PREPARATION / طريقة التحضير</b>');
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('');

    if (recipe.prep_en) {
      lines.push('🇬🇧 <b>English:</b>');
      lines.push(esc(recipe.prep_en));
      lines.push('');
    }
    if (recipe.prep_ar) {
      lines.push('🇪🇬 <b>عربي:</b>');
      lines.push(esc(recipe.prep_ar));
    }
  }

  return lines.join('\n').trimEnd();
}

function buildArabicOnly(recipe) {
  const lines = [];
  lines.push(`🍽 <b>${esc(recipe.name || 'Recipe')}</b>`);
  lines.push('');

  if (recipe.ingredients_ar) {
    lines.push('📋 <b>المكونات</b>');
    lines.push('');
    lines.push(esc(recipe.ingredients_ar));
    lines.push('');
  }

  if (recipe.prep_ar) {
    lines.push('👨‍🍳 <b>طريقة التحضير</b>');
    lines.push('');
    lines.push(esc(recipe.prep_ar));
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
    '<b>Did you mean / هل تقصد:</b>',
  ];
  for (const s of suggestions) {
    lines.push(`• ${esc(s.recipe.name || s.recipe.url)}`);
  }
  lines.push('');
  lines.push('<i>Try one of these names / جرّب أحد هذه الأسماء</i>');
  return lines.join('\n');
}

const NOT_FOUND_MESSAGE =
  '🤷 Recipe not found. Try another name.\n' +
  'لم يتم العثور على الوصفة، جرب اسمًا آخر.';

/**
 * /broken summary: list every recipe that has critical gaps (missing
 * ingredients) and every fully-empty page.
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

  const header = `⚠️ <b>Recipes missing ingredients:</b> ${broken.length}\n\n`;
  const messages = [];
  let current = header;

  for (const { recipe, miss } of broken) {
    const entry =
      `• <a href="${esc(recipe.url)}">${esc(recipe.name || '(no name)')}</a>\n` +
      `  <i>Missing:</i> ${esc(miss.join(', '))}\n\n`;
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
