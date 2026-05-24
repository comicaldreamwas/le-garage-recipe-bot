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

// Recipe lines from Pattern-1 Boho pages arrive as raw paragraphs
// without bullet prefixes. Make every non-empty line look like a
// bullet so the visual format matches Pattern-2 recipes parsed from
// Notion bullet lists. Existing "•" / "1." prefixes are preserved.
function bulletize(text) {
  if (!text) return text;
  return text
    .split('\n')
    .map((line) => {
      const t = line.trimEnd();
      if (!t) return '';
      if (/^[••\-*]\s/.test(t)) return t;          // already bullet
      if (/^(\d+|[٠-٩]+)[.)]\s/.test(t)) return t;     // numbered step
      return '• ' + t;
    })
    .join('\n');
}

const RESTAURANT_LABELS = {
  le_garage: '🍔 Le Garage',
  boho:      '☕ Boho Cafe',
};

function buildRestaurantFooter(restaurant, singleMode) {
  if (!restaurant) return '';
  const label = RESTAURANT_LABELS[restaurant] || restaurant;
  let footer = `\n\n🏪 <b>${label}</b>`;
  // Single-restaurant bots (one PM2 process per restaurant via
  // RESTAURANT_MODE) skip the "/restaurant" hint — that command is a
  // no-op there and pointing at it would only confuse the kitchen.
  if (singleMode) return footer;
  if (restaurant === 'le_garage') {
    footer += '\n<i>💡 Tip: Boho recipes — use /restaurant</i>';
  } else if (restaurant === 'boho') {
    footer += '\n<i>💡 Tip: Le Garage recipes — use /restaurant</i>';
  }
  return footer;
}

/**
 * Render a cache entry into a Telegram-ready HTML string.
 * The Edit-in-Notion link is delivered as an inline keyboard button by
 * lib/telegram.js rather than an in-text footer, so this output is the
 * recipe content only.
 *
 * @param {object} recipe
 * @param {object} [options]
 * @param {string} [options.restaurant] — appended as a "🏪 Le Garage" /
 *        "☕ Boho Cafe" footer plus a one-line tip pointing to /restaurant.
 */
function formatRecipe(recipe, options = {}) {
  const footer = buildRestaurantFooter(options.restaurant, options.singleMode);
  if (isEmpty(recipe)) return buildEmpty(recipe) + footer;

  // Only critical gaps (ingredients) warrant a top-of-message warning.
  const criticalGaps = missingCritical(recipe);
  const warning = criticalGaps.length ? buildWarning(criticalGaps) : '';

  const full = warning + buildFull(recipe) + footer;
  if (full.length <= TELEGRAM_LIMIT) return full;

  // Overflow — drop English to keep Arabic intact (kitchen primary language).
  const arOnly = warning + buildArabicOnly(recipe) + footer;
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

  // Pick a section header style. When only one language is present
  // we drop the bilingual flag headers ("🇬🇧 English:") because they
  // imply a missing-companion section the user would expect to see
  // populated. Pattern-1 Boho recipes (paragraph-only, EN-only) and
  // any other single-language entries get a cleaner one-language
  // layout.
  const hasIngBoth  = !!recipe.ingredients_en && !!recipe.ingredients_ar;
  const hasPrepBoth = !!recipe.prep_en && !!recipe.prep_ar;

  if (recipe.ingredients_en || recipe.ingredients_ar) {
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('📋 <b>INGREDIENTS / المكونات</b>');
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('');

    if (recipe.ingredients_en) {
      if (hasIngBoth) lines.push('🇬🇧 <b>English:</b>');
      lines.push(esc(bulletize(recipe.ingredients_en)));
      lines.push('');
    }
    if (recipe.ingredients_ar) {
      if (hasIngBoth) lines.push('🇪🇬 <b>عربي:</b>');
      lines.push(esc(bulletize(recipe.ingredients_ar)));
      lines.push('');
    }
  }

  if (recipe.prep_en || recipe.prep_ar) {
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('👨‍🍳 <b>PREPARATION / طريقة التحضير</b>');
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('');

    if (recipe.prep_en) {
      if (hasPrepBoth) lines.push('🇬🇧 <b>English:</b>');
      lines.push(esc(bulletize(recipe.prep_en)));
      lines.push('');
    }
    if (recipe.prep_ar) {
      if (hasPrepBoth) lines.push('🇪🇬 <b>عربي:</b>');
      lines.push(esc(bulletize(recipe.prep_ar)));
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
    lines.push(esc(bulletize(recipe.ingredients_ar)));
    lines.push('');
  }

  if (recipe.prep_ar) {
    lines.push('👨‍🍳 <b>طريقة التحضير</b>');
    lines.push('');
    lines.push(esc(bulletize(recipe.prep_ar)));
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
