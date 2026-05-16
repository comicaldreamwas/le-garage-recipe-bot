'use strict';

const { fetchBlockChildren } = require('./notion');

// Section header patterns. Notion recipes don't use toggles — they use
// inline paragraph/heading lines like "Ingredients (Bulk Prep):" then
// bullet lists. We detect a section by matching the header line, then
// route subsequent content into the appropriate field by per-line
// language detection.
const INGREDIENTS_RE = /^(ingredients|المكونات|المقادير)\b/i;
const PREP_RE = /^(how\s*to|preparation(?:\s*method)?|method|steps?|instructions|directions|الطريقة|طريقة\s*التحضير|التحضير|طريقة)\b/i;

// Sections we never want to surface to the kitchen bot.
const SKIP_RE = /^(waiters?\b|chef'?s?\s+notes?|ملاحظات|quality\s*check|plating\s*guide|service\s*notes?|notes?\b|الكمية|yield|portion|presentation|التقديم)/i;

// Character-class detection for routing bilingual content.
const ARABIC_RE = /[؀-ۿݐ-ݿ]/;
const LATIN_RE = /[A-Za-z]/;

function richTextToPlain(rich) {
  if (!Array.isArray(rich)) return '';
  return rich.map((t) => t?.plain_text || '').join('');
}

function classifyHeader(text) {
  const t = text.trim().replace(/^[#>*\-•]+\s*/, '');
  if (!t) return null;
  if (SKIP_RE.test(t)) return 'skip';
  if (INGREDIENTS_RE.test(t)) return 'ingredients';
  if (PREP_RE.test(t)) return 'prep';
  return null;
}

function hasArabic(s) { return ARABIC_RE.test(s); }
function hasLatin(s) { return LATIN_RE.test(s); }

/**
 * Pretty-print a Notion URL slug as a dish name when the page itself
 * has no useful title. CHICKEN-ALFREDO-PASTA-2ad… → "Chicken Alfredo Pasta".
 */
function nameFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const slug = parts[parts.length - 1] || '';
    const cleaned = slug.replace(/-?[0-9a-f]{32}$/i, '') || slug;
    return cleaned
      .split('-')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  } catch {
    return '';
  }
}

/**
 * Render one Notion block as a string suitable for pushing into a
 * section. Multi-line output (tables) is allowed; callers split by
 * newline before language routing.
 *
 * Numbered list items aren't auto-numbered here — the caller increments
 * separate EN / AR counters per section so the output reads sequentially
 * in each language.
 */
async function renderBlock(block, counters) {
  const type = block.type;
  const data = block[type];

  if (type === 'paragraph' || type === 'callout' || type === 'quote') {
    return richTextToPlain(data?.rich_text);
  }
  if (type === 'bulleted_list_item' || type === 'to_do') {
    const t = richTextToPlain(data?.rich_text);
    return t ? '• ' + t : '';
  }
  if (type === 'numbered_list_item') {
    const t = richTextToPlain(data?.rich_text);
    if (!t) return '';
    const lang = hasArabic(t) ? 'ar' : 'en';
    const n = ++counters[lang];
    const digit = lang === 'ar' ? toArabicDigits(n) : String(n);
    return `${digit}. ${t}`;
  }
  if (type === 'table' && block.has_children) {
    const rows = await fetchBlockChildren(block.id);
    return rows
      .filter((r) => r.type === 'table_row')
      .map((r) => (r.table_row?.cells || []).map(richTextToPlain).join(' | ').trim())
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
function toArabicDigits(n) {
  return String(n).split('').map((c) => ARABIC_DIGITS[Number(c)] ?? c).join('');
}

/**
 * Parse a Notion recipe page into the structured cache schema.
 *
 *   {
 *     url, name,
 *     ingredients_en, ingredients_ar,
 *     prep_en, prep_ar,
 *     photo_block_id, video_block_id,
 *   }
 *
 * Returns null when the page yielded no usable content in any field.
 */
async function parseRecipe(page, topBlocks) {
  const out = {
    url: page.url,
    name: '',
    ingredients_en: [],
    ingredients_ar: [],
    prep_en: [],
    prep_ar: [],
    photo_block_id: null,
    video_block_id: null,
  };

  let section = null; // 'ingredients' | 'prep' | null
  let counters = { en: 0, ar: 0 };

  // Page title from properties (rare but sometimes set)
  const titleProp = page?.properties?.title?.title || page?.properties?.Name?.title;
  if (Array.isArray(titleProp) && titleProp.length) {
    out.name = richTextToPlain(titleProp);
  }

  for (const block of topBlocks) {
    const t = block.type;
    const d = block[t];

    // Media — first image / video wins
    if (t === 'image' && !out.photo_block_id) {
      out.photo_block_id = block.id;
      continue;
    }
    if (t === 'video' && !out.video_block_id) {
      out.video_block_id = block.id;
      continue;
    }

    if (t === 'divider') continue;

    // Heading or paragraph: may be a section switch, dish name, or content
    if (t.startsWith('heading_') || t === 'paragraph') {
      const text = richTextToPlain(d?.rich_text).trim();
      if (!text) continue;

      // Dish name: first non-empty heading that isn't a section header
      if (!out.name && t.startsWith('heading_') && !classifyHeader(text)) {
        out.name = text;
      }

      const cls = classifyHeader(text);
      if (cls === 'skip') {
        section = null;
        continue;
      }
      if (cls === 'ingredients' || cls === 'prep') {
        section = cls;
        counters = { en: 0, ar: 0 };
        continue; // header itself isn't content
      }

      // Non-header paragraph — content if we're inside a section
      if (section) {
        if (hasArabic(text)) out[section + '_ar'].push(text);
        else if (hasLatin(text)) out[section + '_en'].push(text);
      }
      continue;
    }

    // Content blocks
    if (!section) continue;
    const rendered = await renderBlock(block, counters);
    if (!rendered) continue;

    // Tables and other multi-line outputs: route each line by language
    for (const line of rendered.split('\n')) {
      const tr = line.trim();
      if (!tr) continue;
      if (hasArabic(tr)) out[section + '_ar'].push(line);
      else if (hasLatin(tr)) out[section + '_en'].push(line);
      else {
        // Pure digits / punctuation — duplicate to both languages so it
        // appears in whichever section the reader sees.
        out[section + '_en'].push(line);
        out[section + '_ar'].push(line);
      }
    }
  }

  if (!out.name) out.name = nameFromUrl(page.url);

  const flat = (arr) => arr.join('\n').trim();
  const recipe = {
    url: page.url,
    name: out.name,
    ingredients_en: flat(out.ingredients_en),
    ingredients_ar: flat(out.ingredients_ar),
    prep_en: flat(out.prep_en),
    prep_ar: flat(out.prep_ar),
    photo_block_id: out.photo_block_id,
    video_block_id: out.video_block_id,
  };

  if (!recipe.ingredients_en && !recipe.ingredients_ar
      && !recipe.prep_en && !recipe.prep_ar) {
    return null;
  }
  return recipe;
}

module.exports = { parseRecipe, nameFromUrl };
