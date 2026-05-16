'use strict';

const { fetchBlockChildren } = require('./notion');

// Section header keywords. We detect section switches by prefix-matching
// the start of a heading or paragraph line. `\b` in JS regex doesn't
// recognise Arabic letters as word characters, so we use plain
// startsWith() checks against a list of normalized keyword prefixes.
const INGREDIENTS_PREFIXES = ['ingredients', 'مكونات', 'المكونات', 'المقادير', 'مقادير'];
const PREP_PREFIXES = [
  'how to', 'preparation', 'method', 'steps', 'step ', 'instructions',
  'directions', 'procedure',
  'طريقة التحضير', 'طريقة الإعداد', 'طريقه التحضير', 'الطريقة', 'التحضير', 'طريقة',
];
const SKIP_PREFIXES = [
  'waiter', 'chef', 'quality check', 'plating', 'service note', 'note', 'notes',
  'presentation', 'yield', 'portion', 'storage', 'shelf life', 'allergen',
  'ملاحظ', 'الكمية', 'التقديم', 'تقديم', 'حفظ', 'تخزين',
];

const ARABIC_RE = /[؀-ۿݐ-ݿ]/;
const LATIN_RE = /[A-Za-z]/;

function richTextToPlain(rich) {
  if (!Array.isArray(rich)) return '';
  return rich.map((t) => t?.plain_text || '').join('');
}

function startsWithAny(text, prefixes) {
  for (const p of prefixes) {
    if (text.startsWith(p)) return true;
  }
  return false;
}

function classifyHeader(text) {
  if (!text) return null;
  // Strip leading markdown-ish bullets and trailing punctuation we expect
  // to see in section headers ("Ingredients:", "المكونات (تجهيز كمية):").
  const cleaned = text
    .trim()
    .replace(/^[#>*\-•]+\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .trim();
  const lower = cleaned.toLowerCase();
  if (startsWithAny(lower, SKIP_PREFIXES) || startsWithAny(cleaned, SKIP_PREFIXES)) return 'skip';
  if (startsWithAny(lower, INGREDIENTS_PREFIXES) || startsWithAny(cleaned, INGREDIENTS_PREFIXES)) return 'ingredients';
  if (startsWithAny(lower, PREP_PREFIXES) || startsWithAny(cleaned, PREP_PREFIXES)) return 'prep';
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
    const out = [];
    for (const r of rows) {
      if (r.type !== 'table_row') continue;
      const cells = (r.table_row?.cells || []).map(richTextToPlain);
      const split = cells.map(splitBilingualCell);

      // If any cell is a bilingual pair, the row is a bilingual ingredient
      // row. Latin-only cells (qty / unit columns like "10,000 g") should
      // appear in both the EN and AR row renderings — promote them.
      const isBilingualRow = split.some((s) => s.en && s.ar);
      if (isBilingualRow) {
        for (let i = 0; i < split.length; i++) {
          const s = split[i];
          const cell = cells[i].trim();
          if (cell && !s.en && !s.ar) {
            // Pure punctuation cell — already empty in both
          } else if (cell && !s.ar && !hasArabic(cell)) {
            // Latin-only cell next to a bilingual one — share it
            split[i] = { en: s.en, ar: s.en };
          } else if (cell && !s.en && !hasLatin(cell)) {
            split[i] = { en: s.ar, ar: s.ar };
          }
        }
      }

      const enRow = split.map((s) => s.en).join(' | ').replace(/\s*\|\s*$/, '').trim();
      const arRow = split.map((s) => s.ar).join(' | ').replace(/\s*\|\s*$/, '').trim();
      if (enRow && /\S/.test(enRow.replace(/[\|\s]/g, ''))) out.push('__EN__' + enRow);
      if (arRow && /\S/.test(arRow.replace(/[\|\s]/g, ''))) out.push('__AR__' + arRow);
    }
    return out.join('\n');
  }
  return '';
}

// Cell value like "Fresh Mushrooms / مشروم فريش" or "10,000 g" or
// "مرقة دجاج" → { en, ar }. A single language stays in its own bucket;
// numeric-only cells appear in both.
function splitBilingualCell(cell) {
  const c = cell.trim();
  if (!c) return { en: '', ar: '' };
  if (c.includes('/') && hasArabic(c) && hasLatin(c)) {
    const parts = c.split('/').map((p) => p.trim());
    const en = parts.filter((p) => hasLatin(p) && !hasArabic(p)).join(' / ');
    const ar = parts.filter((p) => hasArabic(p) && !hasLatin(p)).join(' / ');
    return { en, ar };
  }
  if (hasArabic(c) && !hasLatin(c)) return { en: '', ar: c };
  // Quantity-like cell ("10,000 g", "200 ml", "1 pc") — only short Latin
  // unit symbols, dominated by digits. Show in both languages so quantities
  // appear next to the ingredient in either column.
  if (/^[\d.,\s]+\s*[a-zA-Z%]{0,4}\s*(?:\([^)]+\))?$/.test(c)) {
    return { en: c, ar: c };
  }
  if (hasLatin(c) && !hasArabic(c)) return { en: c, ar: '' };
  // Pure punctuation / digits
  return { en: c, ar: c };
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
      // and isn't a media-label heading ("Video", "فيديو", etc.).
      if (!out.name && t.startsWith('heading_') && !classifyHeader(text)) {
        const lower = text.toLowerCase();
        const isMediaLabel =
          lower.startsWith('video') || lower.startsWith('photo') ||
          lower.startsWith('image') || text.startsWith('فيديو') ||
          text.startsWith('صورة');
        if (!isMediaLabel) out.name = text;
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

      // Non-header paragraph — content if we're inside a section.
      // Some recipes prefix the AR companion line with "/ " — strip it.
      if (section) {
        const stripped = text.replace(/^\s*\/\s*/, '');
        if (hasArabic(stripped)) out[section + '_ar'].push(stripped);
        else if (hasLatin(stripped)) out[section + '_en'].push(stripped);
      }
      continue;
    }

    // Content blocks
    if (!section) continue;
    const rendered = await renderBlock(block, counters);
    if (!rendered) continue;

    // Tables and other multi-line outputs: route each line by language
    for (const raw of rendered.split('\n')) {
      const tr = raw.trim();
      if (!tr) continue;

      // Tagged table rows from splitBilingualCell()
      if (raw.startsWith('__EN__')) {
        out[section + '_en'].push(raw.slice(6));
        continue;
      }
      if (raw.startsWith('__AR__')) {
        out[section + '_ar'].push(raw.slice(6));
        continue;
      }

      // Strip a leading "/ " separator that some recipes use on the AR
      // companion paragraph (e.g. "/ نظّف المشروم...").
      const stripped = raw.replace(/^\s*\/\s*/, '');

      if (hasArabic(stripped)) out[section + '_ar'].push(stripped);
      else if (hasLatin(stripped)) out[section + '_en'].push(stripped);
      else {
        out[section + '_en'].push(stripped);
        out[section + '_ar'].push(stripped);
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

  recipe.completeness = computeCompleteness(recipe);
  return recipe;
}

function computeCompleteness(recipe) {
  return {
    has_ingredients_en: Boolean(recipe.ingredients_en),
    has_ingredients_ar: Boolean(recipe.ingredients_ar),
    has_prep_en: Boolean(recipe.prep_en),
    has_prep_ar: Boolean(recipe.prep_ar),
    has_photo: Boolean(recipe.photo_block_id),
    has_video: Boolean(recipe.video_block_id),
  };
}

/**
 * Return an array of missing field names. Helpers for the cache-builder
 * report and the bot's /broken command.
 */
function missingFields(recipe) {
  const c = recipe.completeness || computeCompleteness(recipe);
  const missing = [];
  if (!c.has_ingredients_en) missing.push('ingredients_en');
  if (!c.has_ingredients_ar) missing.push('ingredients_ar');
  if (!c.has_prep_en) missing.push('prep_en');
  if (!c.has_prep_ar) missing.push('prep_ar');
  if (!c.has_photo) missing.push('photo');
  if (!c.has_video) missing.push('video');
  return missing;
}

/** All four content fields empty? */
function isEmpty(recipe) {
  const c = recipe.completeness || computeCompleteness(recipe);
  return !c.has_ingredients_en && !c.has_ingredients_ar
      && !c.has_prep_en && !c.has_prep_ar;
}

/** No missing fields (counts media too)? */
function isComplete(recipe) {
  return missingFields(recipe).length === 0;
}

module.exports = {
  parseRecipe,
  nameFromUrl,
  computeCompleteness,
  missingFields,
  isEmpty,
  isComplete,
};
