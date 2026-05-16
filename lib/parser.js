'use strict';

const { fetchBlockChildren } = require('./notion');

// ─────────────────────────────────────────────────────────────────────────────
// Section keywords. CONTAINS-based (not startsWith) so headers like
// "Ingredients & Measurements / المكونات والمقادير" match.
// ─────────────────────────────────────────────────────────────────────────────

const INGREDIENTS_TERMS = [
  'ingredient', 'ingredients', 'measurement', 'measurements',
  'component', 'components',
  'مكون', 'مكونات', 'مكوّن', 'مقادير', 'المكونات', 'المقادير',
];

const PREP_TERMS = [
  'preparation', 'how to', 'method', 'instructions', 'step', 'steps',
  'directions', 'cooking', 'procedure',
  'طريقة', 'تحضير', 'خطوات', 'العمل', 'الطريقة', 'التحضير',
];

// Skip checked first so "Cooking for Service" (contains both 'cooking' and
// 'service') is excluded, not treated as prep.
const SKIP_TERMS = [
  'waiter', 'training', 'description', 'service', 'plating',
  'presentation', 'wine pairing', 'allergen', 'storage', 'shelf life',
  'chef\'s note', 'quality check', 'yield', 'portion',
  'نادل', 'تدريب', 'وصف', 'خدمة', 'تقديم', 'ملاحظ',
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ARABIC_LETTER_RE = /[؀-ۿݐ-ݿ]/g;
const LATIN_LETTER_RE = /[A-Za-z]/;
const ANY_LETTER_RE = /\p{L}/gu;

function richTextToPlain(rich) {
  if (!Array.isArray(rich)) return '';
  return rich.map((t) => t?.plain_text || '').join('');
}

function hasArabic(s) { return /[؀-ۿ]/.test(s); }
function hasLatin(s) { return LATIN_LETTER_RE.test(s); }

// Arabic-dominant if ≥30% of LETTERS are Arabic. Numbers and units are
// ignored. Used to route each rendered line into EN or AR bucket.
function isArabicDominant(text) {
  if (!text) return false;
  const arLen = (text.match(ARABIC_LETTER_RE) || []).length;
  const letters = (text.match(ANY_LETTER_RE) || []).length;
  if (letters === 0) return false;
  return arLen / letters >= 0.3;
}

// Strip emoji, decorative chars, and leading punctuation so "🧾 Ingredients"
// or "── Ingredients ──" still match keyword lookups.
const HEADER_DECOR_RE = /[\s\p{Extended_Pictographic}\p{Emoji_Presentation}#>*•⦁🇬🇧🇪🇬–—\-_=]+/gu;
function stripHeaderDecor(text) {
  return text.replace(HEADER_DECOR_RE, ' ').replace(/\s+/g, ' ').trim();
}

function classifySection(text) {
  if (!text) return null;
  const cleaned = stripHeaderDecor(text);
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();

  // Ingredients first — a table-column header like
  // "المكون الكمية الملاحظات" ("Ingredient | Quantity | Notes") contains
  // the skip-term 'ملاحظ' (notes) but is really an ingredients heading.
  // Checking INGREDIENTS before SKIP keeps that classification correct
  // while still routing "Cooking for Service" (matches SKIP 'service'
  // but NOT INGREDIENTS) to skip.
  for (const term of INGREDIENTS_TERMS) {
    if (lower.includes(term) || cleaned.includes(term)) return 'ingredients';
  }
  for (const term of SKIP_TERMS) {
    if (lower.includes(term) || cleaned.includes(term)) return 'skip';
  }
  for (const term of PREP_TERMS) {
    if (lower.includes(term) || cleaned.includes(term)) return 'prep';
  }
  return null;
}

// Sub-section labels common in multi-variant pages ("CHICKEN:", "SHRIMP:",
// "VEGGIE FILLING:", "BBQ STYLE:") and their Arabic equivalents. We keep
// these as visible dividers inside the current section bucket.
const EN_SUBSECTION_RE = /^[A-Z][A-Z0-9\s/&'’()\-]{1,40}:\s*$/;
const AR_SUBSECTION_RE = /^[؀-ۿ\s]{2,40}:\s*$/;
function isSubsectionLabel(text) {
  return EN_SUBSECTION_RE.test(text) || AR_SUBSECTION_RE.test(text);
}

function isContentBlock(type) {
  return type === 'bulleted_list_item' || type === 'numbered_list_item'
      || type === 'to_do' || type === 'table' || type === 'paragraph';
}

// Treat heading_1/2/3, callout, and toggle as headers always. A paragraph
// becomes a header if it's short and ends with ":". This catches
// "Ingredients:", "المكونات:", "CHICKEN:" patterns common in non-toggle
// recipe layouts.
function getHeaderText(block) {
  const t = block.type;
  const d = block[t];
  if (t === 'heading_1' || t === 'heading_2' || t === 'heading_3'
      || t === 'callout' || t === 'toggle') {
    return richTextToPlain(d?.rich_text).trim();
  }
  if (t === 'paragraph') {
    const text = richTextToPlain(d?.rich_text).trim();
    if (!text || text.length > 80) return null;
    // Classic "Label:" header
    if (/:\s*$/.test(text)) return text;
    // Emoji-prefixed labels like "📏 المكونات لكل حصة" or
    // "👨‍🍳 خطوات التحضير" — short paragraphs that classify into a
    // section by keyword count as headers even without trailing colon.
    if (classifySection(text)) return text;
  }
  return null;
}

// Some recipes pack an entire section ("Ingredients:\n⦁ A\n⦁ B\n⦁ C") into
// a single paragraph block with embedded newlines. We split such blocks
// into virtual sub-blocks so the header line and each bullet line are
// evaluated independently.
function preprocessBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type !== 'paragraph') { out.push(b); continue; }
    const text = richTextToPlain(b.paragraph?.rich_text || []);
    if (!text.includes('\n')) { out.push(b); continue; }
    for (const line of text.split('\n')) {
      const tr = line.trim();
      if (!tr) continue;
      // Lines that begin with ⦁ or • are inline-bulleted content — keep
      // them as bulleted_list_item virtuals so the renderer prefixes a •.
      const m = tr.match(/^[⦁•]\s*(.*)$/);
      if (m) {
        out.push({
          type: 'bulleted_list_item',
          __virtual: true,
          bulleted_list_item: { rich_text: [{ plain_text: m[1] }] },
        });
      } else {
        out.push({
          type: 'paragraph',
          __virtual: true,
          paragraph: { rich_text: [{ plain_text: tr }] },
        });
      }
    }
  }
  return out;
}

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

// "Burger Patty / برجر باتي" → "Burger Patty" (EN side preferred for display).
function nameFromBilingualHeading(text) {
  if (!text) return null;
  if (text.includes('/') && hasArabic(text) && hasLatin(text)) {
    const parts = text.split('/').map((p) => p.trim());
    const enPart = parts.find((p) => hasLatin(p) && !hasArabic(p));
    if (enPart) return enPart;
  }
  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Table rendering — handles bilingual cells, header-row skipping, and the
// common "#  |  Ingredient / المكون  |  Quantity / الكمية" layout.
// ─────────────────────────────────────────────────────────────────────────────

const TABLE_HEADER_RE = /ingredient|quantity|measure|amount|qty|مكون|كمية|مقدار|عنصر/i;

async function renderTable(block) {
  const rows = await fetchBlockChildren(block.id);
  const lines = [];
  let isFirstNonEmpty = true;

  for (const row of rows) {
    if (row.type !== 'table_row') continue;
    const cells = (row.table_row?.cells || []).map(richTextToPlain);
    if (cells.every((c) => !c.trim())) continue;

    if (isFirstNonEmpty) {
      isFirstNonEmpty = false;
      const joined = cells.join(' ');
      if (TABLE_HEADER_RE.test(joined)) continue;
    }

    // Determine name/qty columns. If >=3 cells and first looks like a
    // serial number ("1", "01", "—"), drop it.
    let nameCell, qtyCell;
    if (cells.length >= 3) {
      const first = cells[0].trim();
      if (/^[\d.\s\-–—]*$/.test(first) && first.length <= 4) {
        nameCell = cells[1] || '';
        qtyCell = cells.slice(2).join(' ').trim();
      } else {
        nameCell = cells[0];
        qtyCell = cells.slice(1).join(' ').trim();
      }
    } else if (cells.length === 2) {
      nameCell = cells[0];
      qtyCell = cells[1];
    } else {
      nameCell = cells[0] || '';
      qtyCell = '';
    }

    const nameSplit = splitBilingualCell(nameCell);
    const qtySplit = splitBilingualCell(qtyCell);

    const enLine = composeRowLine(nameSplit.en, qtySplit.en);
    const arLine = composeRowLine(nameSplit.ar, qtySplit.ar);

    if (enLine) lines.push('__EN__' + enLine);
    if (arLine) lines.push('__AR__' + arLine);
  }
  return lines;
}

function composeRowLine(name, qty) {
  const n = (name || '').trim();
  const q = (qty || '').trim();
  if (!n && !q) return '';
  if (!q) return '• ' + n;
  if (!n) return '• ' + q;
  return `• ${n}: ${q}`;
}

function splitBilingualCell(cell) {
  const c = (cell || '').trim();
  if (!c) return { en: '', ar: '' };

  // "EN / AR" or "AR / EN" with explicit slash separator.
  if (c.includes('/') && hasArabic(c) && hasLatin(c)) {
    const parts = c.split('/').map((p) => p.trim());
    const en = parts.filter((p) => hasLatin(p) && !hasArabic(p)).join(' / ');
    const ar = parts.filter((p) => hasArabic(p) && !hasLatin(p)).join(' / ');
    if (en || ar) return { en, ar };
  }

  if (hasArabic(c) && !hasLatin(c)) return { en: '', ar: c };

  // Quantity-only cell ("10,000 g", "200 ml", "1 pc"). Shared across both
  // language buckets so the AR row keeps its measurement column.
  if (/^[\d.,\s]+\s*[a-zA-Z%]{0,4}\s*(?:\([^)]+\))?$/.test(c)) {
    return { en: c, ar: c };
  }

  // Latin-only ingredient name like "Meat (Beef)" — when it sits in a
  // bilingual row context, the table caller will still produce an AR row
  // (with whatever AR text was in other cells), so route to EN only here.
  if (hasLatin(c) && !hasArabic(c)) return { en: c, ar: '' };

  // Mixed AR+Latin without "/" — duplicate so it appears in both columns.
  return { en: c, ar: c };
}

/**
 * Detect content lines that pack EN + AR halves separated by " / ":
 *   "Put oil in a large pot. / حط الزيت في حلة كبيرة."
 *   "• Cheddar cheese – 50g / جبنة شيدر – 50 جم"
 *
 * Returns { en, ar } when both halves contain real letters in the
 * expected script, otherwise null (so the caller falls back to its
 * usual single-language routing).
 *
 * Bullet/numbered prefixes ("• ", "1. ", "١. ") are preserved on the EN
 * side and re-emitted on the AR side as Arabic-style "• " bullet.
 */
function splitBilingualLine(line) {
  if (!line || !line.includes('/')) return null;
  if (!hasArabic(line) || !hasLatin(line)) return null;

  // Strip a leading bullet/number to compare halves on their own merit.
  const bulletMatch = line.match(/^([•\-]\s+|\d+[.)]\s+|[٠-٩]+[.)]\s+)/);
  const prefix = bulletMatch ? bulletMatch[0] : '';
  const body = bulletMatch ? line.slice(bulletMatch[0].length) : line;

  // Split on the FIRST " / " — recipes occasionally use multiple slashes
  // within a single half (e.g. "Tomato / Cherry / طماطم"). Walk and find
  // the slash that separates an EN-heavy half from an AR-heavy half.
  const slashIdx = body.indexOf('/');
  if (slashIdx === -1) return null;

  const left = body.slice(0, slashIdx).trim();
  const right = body.slice(slashIdx + 1).trim();
  if (!left || !right) return null;

  let en, ar;
  if (hasLatin(left) && !hasArabic(left) && hasArabic(right) && !hasLatin(right)) {
    en = left; ar = right;
  } else if (hasArabic(left) && !hasLatin(left) && hasLatin(right) && !hasArabic(right)) {
    en = right; ar = left;
  } else if (isArabicDominant(left) && !isArabicDominant(right)) {
    en = right; ar = left;
  } else if (!isArabicDominant(left) && isArabicDominant(right)) {
    en = left; ar = right;
  } else {
    return null; // can't cleanly split, let single-language routing handle it
  }

  return {
    en: prefix + en,
    ar: prefix.replace(/\d+/, (m) => toArabicDigits(Number(m))) + ar,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Content-block rendering (non-table)
// ─────────────────────────────────────────────────────────────────────────────

async function renderContentBlock(block) {
  const type = block.type;
  const data = block[type];

  if (type === 'paragraph' || type === 'quote') {
    const text = richTextToPlain(data?.rich_text).trim();
    return text ? [text] : [];
  }
  if (type === 'bulleted_list_item' || type === 'to_do') {
    const text = richTextToPlain(data?.rich_text).trim();
    return text ? ['• ' + text] : [];
  }
  if (type === 'numbered_list_item') {
    const text = richTextToPlain(data?.rich_text).trim();
    return text ? [{ numbered: true, text }] : [];
  }
  if (type === 'callout') {
    const text = richTextToPlain(data?.rich_text).trim();
    return text ? [text] : [];
  }
  if (type === 'table' && block.has_children) {
    return await renderTable(block);
  }
  return [];
}

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
function toArabicDigits(n) {
  return String(n).split('').map((c) => AR_DIGITS[Number(c)] ?? c).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Section-name heuristics: skip section headers like "Description" early
// so they don't accidentally win the recipe-name slot.
// ─────────────────────────────────────────────────────────────────────────────

function isMediaLabel(text) {
  const lower = text.toLowerCase();
  return /^(video|photo|image)/.test(lower) || /^(فيديو|صورة)/.test(text);
}

function isGenericGuideHeading(text) {
  const lower = text.toLowerCase();
  return (
    /^(cooking for|recipe card|service|item)/i.test(text) ||
    lower === 'recipe' || lower === 'menu item' ||
    /^(خطوات|التنفيذ|كارت وصفة)/.test(text) ||
    /(أثناء الخدمة|إعداد للخدمة)/.test(text) ||
    text === 'وصفة'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main parser
// ─────────────────────────────────────────────────────────────────────────────

async function parseRecipe(page, topBlocks) {
  const buckets = {
    ingredients_en: [], ingredients_ar: [],
    prep_en: [], prep_ar: [],
  };
  let photo_block_id = null;
  let video_block_id = null;
  let name = '';

  // Diagnostic info — what we found
  const sectionHeaders = [];
  const formats = new Set(); // 'toggle' | 'list' | 'table' | 'paragraph'

  // Page title from properties (rare, but Notion sometimes exposes it).
  const titleProp = page?.properties?.title?.title || page?.properties?.Name?.title;
  if (Array.isArray(titleProp) && titleProp.length) {
    name = richTextToPlain(titleProp);
  }

  // State: section = 'ingredients' | 'prep' | 'skip' | null
  let section = null;
  const prepCounters = { en: 0, ar: 0 };

  // Pre-process: many recipes pack "Ingredients:\n⦁ A\n⦁ B" into a single
  // paragraph. Split such blocks into virtual sub-blocks so each line is
  // evaluated independently.
  const blocks = preprocessBlocks(topBlocks);

  for (const block of blocks) {
    const type = block.type;

    // Media — first one wins.
    if (type === 'image' && !photo_block_id) { photo_block_id = block.id; continue; }
    if (type === 'video' && !video_block_id) { video_block_id = block.id; continue; }
    if (type === 'divider') continue;

    // Header detection covers heading_X, paragraph-with-colon, toggle, callout.
    const headerText = getHeaderText(block);
    if (headerText !== null) {
      const cls = classifySection(headerText);

      if (cls === 'skip') {
        section = 'skip';
        sectionHeaders.push(headerText);
        continue;
      }
      if (cls === 'ingredients' || cls === 'prep') {
        section = cls;
        sectionHeaders.push(headerText);
        prepCounters.en = 0;
        prepCounters.ar = 0;
        if (type === 'toggle') formats.add('toggle');
        continue;
      }

      // Subsection labels like "CHICKEN:", "SHRIMP:", "VEGGIE FILLING:"
      // — keep them as visible dividers inside the current section so the
      // kitchen sees the variant breakdown.
      if (isSubsectionLabel(headerText) && (section === 'ingredients' || section === 'prep')) {
        const bucket = hasArabic(headerText) ? section + '_ar' : section + '_en';
        buckets[bucket].push(headerText);
        continue;
      }

      // Not a section header. Could be a dish-name heading or just a
      // sub-divider like "CHICKEN:". Only consider heading_X for naming.
      if (!name && (type === 'heading_1' || type === 'heading_2' || type === 'heading_3')) {
        if (!isMediaLabel(headerText) && !isGenericGuideHeading(headerText)) {
          const slugUpper = nameFromUrl(page.url).toUpperCase();
          const slugTerms = slugUpper.split(/\s+/).filter((w) => w.length >= 3);
          if (slugTerms.length > 0) {
            const upper = headerText.toUpperCase();
            const hits = slugTerms.filter((t) => upper.includes(t)).length;
            const required = Math.min(slugTerms.length, 2);
            if (hits >= required) {
              name = nameFromBilingualHeading(headerText);
            }
          }
        }
      }

      // Toggles whose label didn't match a section keyword shouldn't dump
      // content into nowhere — descend into their children so we don't
      // lose data, but treat the toggle as transparent. Children flow
      // through the main loop on next iterations only if we explicitly
      // pull them out. To keep this simple, ignore unmatched toggle
      // contents (consistent with previous behaviour).
      continue;
    }

    // Headerless-page fallback: if a content block arrives before any
    // section header was set (very common for sauce / dough prep pages
    // that are just a bullet list), assume it's the ingredients section.
    if (!section && isContentBlock(type)) {
      section = 'ingredients';
    }

    // Content block — only consume when we're in a real section.
    if (!section || section === 'skip') continue;

    const items = await renderContentBlock(block);
    for (const item of items) {
      const isNumbered = typeof item === 'object' && item.numbered;
      const raw = isNumbered ? item.text : item;
      const tr = raw.trim();
      if (!tr) continue;

      // Tagged from table renderer
      if (raw.startsWith('__EN__')) {
        buckets[section + '_en'].push(raw.slice(6));
        formats.add('table');
        continue;
      }
      if (raw.startsWith('__AR__')) {
        buckets[section + '_ar'].push(raw.slice(6));
        formats.add('table');
        continue;
      }

      // Strip leading "/ " from AR companion paragraphs.
      const stripped = raw.replace(/^\s*\/\s*/, '');

      // Drop decoration-only lines ("————————", "***", lone "•").
      if (!/\p{L}/u.test(stripped) && !/\d/.test(stripped)) continue;

      // Single bullet/paragraph that packs BOTH languages as "EN / AR"
      // (common in recipe prep steps: "Put oil... / حط الزيت..."). Split
      // and route each half to its language bucket.
      const split = splitBilingualLine(stripped);
      if (split) {
        if (isNumbered) {
          const ne = ++prepCounters.en;
          const na = ++prepCounters.ar;
          buckets[section + '_en'].push(`${ne}. ${split.en}`);
          buckets[section + '_ar'].push(`${toArabicDigits(na)}. ${split.ar}`);
        } else {
          buckets[section + '_en'].push(split.en);
          buckets[section + '_ar'].push(split.ar);
        }
        formats.add(isNumbered ? 'list' : 'paragraph');
        continue;
      }

      const ar = isArabicDominant(stripped);
      if (isNumbered) {
        if (ar) {
          const n = ++prepCounters.ar;
          buckets[section + '_ar'].push(`${toArabicDigits(n)}. ${stripped}`);
        } else if (hasLatin(stripped)) {
          const n = ++prepCounters.en;
          buckets[section + '_en'].push(`${n}. ${stripped}`);
        }
        formats.add('list');
        continue;
      }

      if (ar) buckets[section + '_ar'].push(stripped);
      else if (hasLatin(stripped)) buckets[section + '_en'].push(stripped);
      else {
        buckets[section + '_en'].push(stripped);
        buckets[section + '_ar'].push(stripped);
      }

      if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
        formats.add('list');
      } else if (type === 'paragraph') {
        formats.add('paragraph');
      }
    }
  }

  if (!name) name = nameFromUrl(page.url);

  const flat = (arr) => arr.join('\n').trim();
  const recipe = {
    url: page.url,
    name,
    ingredients_en: flat(buckets.ingredients_en),
    ingredients_ar: flat(buckets.ingredients_ar),
    prep_en: flat(buckets.prep_en),
    prep_ar: flat(buckets.prep_ar),
    photo_block_id,
    video_block_id,
    format: pickFormatLabel(formats),
    section_headers: sectionHeaders,
  };
  recipe.completeness = computeCompleteness(recipe);
  return recipe;
}

function pickFormatLabel(formats) {
  const hasTable = formats.has('table');
  const hasList = formats.has('list');
  const hasPara = formats.has('paragraph');
  const hasToggle = formats.has('toggle');
  if (hasToggle && (hasTable || hasList)) return 'toggle+mixed';
  if (hasToggle) return 'toggle';
  if (hasTable && hasList) return 'mixed';
  if (hasTable) return 'table';
  if (hasList) return 'list';
  if (hasPara) return 'paragraph';
  return 'empty';
}

// ─────────────────────────────────────────────────────────────────────────────
// Completeness helpers
// ─────────────────────────────────────────────────────────────────────────────

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

function isEmpty(recipe) {
  const c = recipe.completeness || computeCompleteness(recipe);
  return !c.has_ingredients_en && !c.has_ingredients_ar
      && !c.has_prep_en && !c.has_prep_ar;
}

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
