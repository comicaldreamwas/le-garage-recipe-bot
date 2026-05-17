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
// 'service') is excluded, not treated as prep. We avoid terms like
// 'portion' / 'storage' that substring-match useful words ("Portioning",
// "cold storage") in recipe step titles. containsWord uses Unicode
// letter boundaries so 'وصف' here does NOT match 'وصفة' (recipe).
const SKIP_TERMS = [
  // Service / FOH content
  'waiter', 'training', 'service notes', 'plating guide',
  'presentation', 'wine pairing', 'allergen', 'shelf life',
  // Description / notes
  'description', 'dish description', 'chef\'s note', 'chef notes',
  // End-of-recipe rollup sections that follow real prep steps
  'mistake', 'mistakes', 'critical mistakes', 'errors to avoid',
  'checklist', 'final check', 'final checklist',
  'standard', 'standards', 'le garage standard',
  'professionalism', 'quality check',
  // Yield / portion info — not ingredient lines
  'yield', 'serving size', 'portion size', 'portions',
  'total weight', 'final weight', 'net weight',
  // Tips / shortcuts / standards (end-of-recipe rollups)
  'tip', 'tips', 'success tips',
  'shortcut', 'shortcuts',
  // Recap / summary blocks ("✅ CORRECT WAY — NO MICROWAVE NEEDED:",
  // "QUICK RECAP:", "Key Points:") that repeat real prep at the end
  'correct way', 'recap', 'summary', 'overview', 'key point', 'key points',
  'quick recap', 'in short', 'in summary',
  // Metadata blocks (Dish Name / Category / Cooking Methods fields that
  // sit at the top of dish-card recipes — they aren't ingredients).
  'general information', 'general info', 'dish information', 'metadata',
  'category', 'cooking methods', 'cooking method',
  // Warnings / safety blocks that sometimes precede ingredients
  'critical warning', 'warning', 'safety warning', 'caution',
  // Sub-tier dividers in multi-part breakfast / dessert plates
  'upper tier', 'lower tier', 'middle tier',
  // Arabic equivalents
  'نادل', 'تدريب', 'ملاحظ',
  'وصف',                          // description (won't match 'وصفة' = recipe)
  'أخطاء',                       // mistakes / errors
  'قائمة',                       // checklist / list-of
  'معيار',                       // standard
  'ستاندرد',                     // standard (AR transliteration)
  'احترافي',                     // professional / احترافيتك = professionalism
  'نصائح',                       // tips / advice
  'الوزن النهائي',               // final weight
  'الوزن الكلي',                 // total weight
  'حجم الحصة',                   // serving size
  'المجموع',                     // total
  'مفيش طرق مختصرة',             // no shortcuts
  'الملخص',                      // summary
  'النقاط الأساسية',             // key points
  'الخلاصة',                     // conclusion / recap
  'معلومات عامة',                // general information
  'معلومات الطبق',               // dish information
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

// Whole-word containment: the term must appear bounded by non-letter
// characters (or the string boundary) on both sides. This prevents
// false positives like "portion" matching inside "Portioning",
// "step" matching inside "stepping", etc. Works for Latin and Arabic
// because we use the Unicode \p{L} class.
function containsWord(haystack, needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^\\p{L}])${escaped}(?:[^\\p{L}]|$)`, 'iu');
  if (re.test(haystack)) return true;
  // Arabic definite article "ال" attaches directly to nouns — "الأخطاء",
  // "المعيار", "القائمة", "الوصف" — so word-boundary detection fails.
  // For Arabic-script needles, also try the form with an attached "ال".
  // This still won't false-match "الوصفة" (recipe) against "وصف" because
  // the trailing letter ة keeps the boundary check failing on the right.
  if (/^[؀-ۿ]/.test(needle)) {
    const reAl = new RegExp(`(?:^|[^\\p{L}])ال${escaped}(?:[^\\p{L}]|$)`, 'iu');
    if (reAl.test(haystack)) return true;
  }
  return false;
}

function classifySection(text) {
  if (!text) return null;
  const cleaned = stripHeaderDecor(text);
  if (!cleaned) return null;

  // Media labels like "Video / فيديو طريقة التحضير" or "فيديو How to"
  // contain prep keywords ('how to', 'طريقة') but really just label an
  // embedded video. Don't classify them — the next real section header
  // will set state.
  const lower = cleaned.toLowerCase();
  if (/\b(video|photo|image)\b/.test(lower) || /(فيديو|صورة)/.test(cleaned)) return null;

  // Ingredients first — a table-column header like
  // "المكون الكمية الملاحظات" ("Ingredient | Quantity | Notes") contains
  // the skip-term 'ملاحظ' (notes) but is really an ingredients heading.
  // Checking INGREDIENTS before SKIP keeps that classification correct
  // while still routing "Cooking for Service" (matches SKIP 'service'
  // but NOT INGREDIENTS) to skip.
  for (const term of INGREDIENTS_TERMS) {
    if (containsWord(cleaned, term)) return 'ingredients';
  }
  for (const term of SKIP_TERMS) {
    if (containsWord(cleaned, term)) return 'skip';
  }
  for (const term of PREP_TERMS) {
    if (containsWord(cleaned, term)) return 'prep';
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
    // Numbered guide-step paragraphs ("1. Portioning & Frying",
    // "٣. التجهيز") are usually SUB-section markers inside the active
    // section — but they CAN be section-ending SKIP labels too:
    // "2. Cooking Standards", "3. Service & Upselling Standards".
    // We let numbered prefixes through only if they classify as SKIP;
    // ingredient/prep classifications stay rejected (would otherwise
    // flip section on every numbered step).
    if (/^(\d+|[٠-٩]+)[.)]/.test(text)) {
      if (classifySection(text) === 'skip') return text;
      return null;
    }
    // Classic "Label:" header
    if (/:\s*$/.test(text)) return text;
    // Emoji-prefixed labels like "📏 المكونات لكل حصة" or
    // "👨‍🍳 خطوات التحضير" — short paragraphs that classify into a
    // section by keyword count as headers even without trailing colon.
    // Only promote when the paragraph is genuinely a LABEL (≤30 chars),
    // not a sentence that incidentally contains the keyword. Without
    // this, "FISH & CHIPS – COOKING RECIPE (1 PORTION)" — content
    // sitting inside an "Ingredients (En)" toggle — would flip the
    // parser to PREP because it mentions 'cooking'.
    const cls = classifySection(text);
    if (text.length <= 30 && cls) return text;
    // SKIP signals can be longer — "⚠️ أخطاء حرجة لازم تتفاداها (مسؤولية الشيف)",
    // "Critical Mistakes to Avoid (Chef's Responsibility)", or
    // "Final Chef Checklist Before Sending Dish" all end the current
    // section. We're more permissive about length here because dropping
    // a SKIP marker is the conservative choice (worst case, some trailing
    // notes get skipped) compared to letting prep absorb them.
    if (cls === 'skip') return text;
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
// Also strips boilerplate prefixes like "Dish Name:" or "Recipe Name:" that
// sometimes wrap the actual title in metadata-heavy recipe templates.
function nameFromBilingualHeading(text) {
  if (!text) return null;
  let out = text;
  if (out.includes('/') && hasArabic(out) && hasLatin(out)) {
    const parts = out.split('/').map((p) => p.trim());
    const enPart = parts.find((p) => hasLatin(p) && !hasArabic(p));
    if (enPart) out = enPart;
  }
  // Strip leading metadata prefix: "Dish Name: Salmon Tartar" → "Salmon Tartar"
  out = out.replace(/^(dish\s*name|recipe\s*name|name|item|product)\s*[:：]\s*/i, '');
  return out.trim();
}

// True if a paragraph looks like a bilingual recipe title that should be
// taken as the dish name rather than ingredient content. Triggered for
// short bilingual paragraphs ("Chocolate Sauce / صوص الشوكولاتة") whose
// Latin half overlaps the URL slug.
function isBilingualTitleParagraph(text, url) {
  if (!text || text.length > 80) return false;
  if (!hasLatin(text) || !hasArabic(text)) return false;
  const slugUpper = nameFromUrl(url).toUpperCase();
  const slugTerms = slugUpper.split(/\s+/).filter((w) => w.length >= 3);
  if (slugTerms.length === 0) return false;
  const upper = text.toUpperCase();
  const hits = slugTerms.filter((t) => upper.includes(t)).length;
  return hits >= Math.min(slugTerms.length, 2);
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
    // serial number ("1", "01", "—"), drop it. We also handle the
    // common "EN_name | AR_name | qty" bilingual table — when cells[0]
    // is Latin-only and cells[1] is Arabic-only we treat them as the
    // two halves of a bilingual name rather than concatenating them
    // into a single "name" + "qty" merged blob.
    let nameCell, qtyCell, nameSplit, qtySplit;
    if (cells.length >= 3) {
      const first = cells[0].trim();
      const isSerial = /^[\d.\s\-–—#]*$/.test(first) && first.length <= 4;
      const startCol = isSerial ? 1 : 0;
      const a = cells[startCol] || '';
      const b = cells[startCol + 1] || '';
      const c = cells.slice(startCol + 2).join(' ').trim();

      const aOnlyEn = hasLatin(a) && !hasArabic(a);
      const bOnlyAr = hasArabic(b) && !hasLatin(b);
      if (aOnlyEn && bOnlyAr) {
        // "EN | AR | qty" pattern — feed split directly so each
        // language keeps its own name from its column.
        nameSplit = { en: a, ar: b };
        qtySplit = splitBilingualCell(c);
        nameCell = a; // for downstream pure-EN row detection
        qtyCell = c;
      } else {
        nameCell = a;
        qtyCell = cells.slice(startCol + 1).join(' ').trim();
        nameSplit = splitBilingualCell(nameCell);
        qtySplit = splitBilingualCell(qtyCell);
      }
    } else if (cells.length === 2) {
      nameCell = cells[0];
      qtyCell = cells[1];
      nameSplit = splitBilingualCell(nameCell);
      qtySplit = splitBilingualCell(qtyCell);
    } else {
      nameCell = cells[0] || '';
      qtyCell = '';
      nameSplit = splitBilingualCell(nameCell);
      qtySplit = splitBilingualCell(qtyCell);
    }

    // Only emit a row in the language whose NAME column has content
    // there. Otherwise a fully-AR table like Cordon Bleu's
    //   "صوص المشروم | 130g | سخن – بس لو الضيف طلب"
    // emits "• 130g سخن…" into ing_en because the Latin "130g" tricks
    // a naive hasLatin check on the composed row.
    const hasEnName = nameSplit.en && hasLatin(nameSplit.en);
    const hasArName = nameSplit.ar && hasArabic(nameSplit.ar);
    // Pure-EN monolingual table (no Arabic anywhere in row) — emit EN
    // row even though splitBilingualCell didn't mark a separate EN side.
    const monoEnRow = !hasArName && !cells.some(hasArabic) && hasLatin(cells.join(' '));

    if (hasEnName || monoEnRow) {
      const enLine = composeRowLine(nameSplit.en || nameCell, qtySplit.en || qtyCell);
      if (enLine) lines.push('__EN__' + enLine);
    }
    if (hasArName) {
      const arLine = composeRowLine(nameSplit.ar, qtySplit.ar);
      if (arLine) lines.push('__AR__' + arLine);
    }
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
  if (!line) return null;
  if (!hasArabic(line) || !hasLatin(line)) return null;
  // Recipes use either "/" or "|" as the EN/AR separator inside a single
  // bullet line. Pick whichever appears first.
  const sepMatch = line.match(/[\/|]/);
  if (!sepMatch) return null;

  // Strip a leading bullet/number to compare halves on their own merit.
  const bulletMatch = line.match(/^([•\-]\s+|\d+[.)]\s+|[٠-٩]+[.)]\s+)/);
  const prefix = bulletMatch ? bulletMatch[0] : '';
  const body = bulletMatch ? line.slice(bulletMatch[0].length) : line;

  // Find the first occurrence of either separator inside the body.
  const sepIdx = body.search(/[\/|]/);
  if (sepIdx === -1) return null;

  const left = body.slice(0, sepIdx).trim();
  const right = body.slice(sepIdx + 1).trim();
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

/**
 * Notion lets headings (heading_1/2/3) and many other blocks have
 * children — most notably "toggle headings" used as
 *   "Ingredients (En)"        ← heading_2 with has_children: true
 *      • bullet ... (actual EN content, hidden inside the toggle)
 *      • bullet ...
 * The default API listing doesn't include those children, so the
 * parser used to see only the empty header and report missing EN.
 *
 * flattenChildren recursively walks the block tree and emits a flat
 * list with each parent followed immediately by its children. Tables
 * are left untouched because their rows are handled separately by
 * renderTable().
 */
async function flattenChildren(blocks) {
  const out = [];
  for (const b of blocks) {
    out.push(b);
    if (!b.has_children) continue;
    if (b.type === 'table') continue;
    // Toggles render their label as a section header and their children
    // already flow correctly without splicing — but we ALSO splice them
    // so a parsed toggle body becomes available to the state machine.
    const kids = await fetchBlockChildren(b.id);
    const flatKids = await flattenChildren(kids);
    for (const k of flatKids) out.push(k);
  }
  return out;
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
  // Names captured during parsing (bilingual title paragraph halves,
  // dish-name headings). Used by the post-filter to drop lines that
  // simply repeat the title.
  const nameAliases = new Set();

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
  // Then flatten: Notion toggle-headings ("Ingredients (En)" with
  // has_children=true) hide their content as block-children. We
  // recursively splice those children inline so they flow through the
  // state machine just like top-level blocks would.
  const expanded = await flattenChildren(topBlocks);
  const blocks = preprocessBlocks(expanded);

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

    // Bilingual-title paragraph: a "Chocolate Sauce / صوص الشوكولاتة"
    // paragraph sitting at the very top of the page is the dish name,
    // not ingredient content. Capture both halves as name aliases so
    // the post-filter can also drop them from buckets if they leaked.
    if (!section && type === 'paragraph') {
      const titleText = richTextToPlain(block.paragraph?.rich_text || []).trim();
      if (titleText && isBilingualTitleParagraph(titleText, page.url)) {
        if (!name) name = nameFromBilingualHeading(titleText);
        for (const part of titleText.split('/')) {
          const p = part.trim();
          if (p) nameAliases.add(p.toLowerCase());
        }
        sectionHeaders.push(titleText);
        continue;
      }
    }

    // Headerless-page fallback: if a content block arrives before any
    // section header was set (very common for sauce / dough prep pages
    // that are just a bullet list), assume it's the ingredients section.
    if (!section && isContentBlock(type)) {
      section = 'ingredients';
    }

    // Reset numbered counters when a non-numbered content block
    // separates two numbered lists. Notion's UI auto-restarts numbering
    // at each new list, so without this the second list continues
    // 4, 5, 6... instead of 1, 2, 3...
    if (type !== 'numbered_list_item') {
      prepCounters.en = 0;
      prepCounters.ar = 0;
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

  // Filter out lines that just repeat the dish name. Some recipes have
  // the title written as a paragraph (not heading) at the top — like
  // "Chocolate Sauce / صوص الشوكولاتة" — which previously leaked into
  // ingredients_en + ingredients_ar via the bilingual splitter.
  const slug = nameFromUrl(page.url);
  const nameVariants = collectNameVariants(name, slug);
  // Add anything captured at parse-time (e.g. AR half of a bilingual
  // title paragraph like "Chocolate Sauce / صوص الشوكولاتة" → the AR
  // half "صوص الشوكولاتة" is added to nameAliases above).
  for (const alias of nameAliases) {
    nameVariants.add(normalizeForCompare(alias));
  }
  for (const key of ['ingredients_en', 'ingredients_ar', 'prep_en', 'prep_ar']) {
    buckets[key] = buckets[key].filter((line) => !isNameDuplicate(line, nameVariants));
  }

  // Drop yield / total-weight bullets that often live at the end of an
  // ingredients block ("• الوزن النهائي للمنتج: 900 g", "• Total: 24 L")
  // or sneak into the prep tail ("• Yield: Approx. 10–12 portions").
  // SKIP_TERMS only filter section HEADERS via classifySection; these
  // bullets arrive as ordinary content, so a per-line filter is needed.
  for (const key of ['ingredients_en', 'ingredients_ar', 'prep_en', 'prep_ar']) {
    buckets[key] = buckets[key].filter((l) => !isYieldLine(l));
  }

  // Drop content lines from INGREDIENTS that don't look like ingredients.
  // Real ingredient bullets always carry either a quantity digit or a
  // ":" / "–" / "—" separator ("Salt: 5 g", "Beef – 250g"). Pure
  // descriptive lines like a bilingual dish-name translation
  // ("سلطة سيزر بالفراخ") or a category label ("خبز – شواية – تجميع
  // الطبق") fail both checks and are dropped from the ingredients
  // buckets only (prep keeps its descriptive paragraphs).
  buckets.ingredients_en = buckets.ingredients_en.filter(looksLikeIngredient);
  buckets.ingredients_ar = buckets.ingredients_ar.filter(looksLikeIngredient);

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

function collectNameVariants(name, slug) {
  const out = new Set();
  const add = (s) => { if (s) out.add(normalizeForCompare(s)); };
  add(name);
  add(slug);
  // Bilingual name "Burger Patty / برجر باتي" — also add each half so
  // the EN half and AR half match their respective content lines.
  if (name && name.includes('/')) {
    for (const half of name.split('/')) add(half.trim());
  }
  return out;
}

function normalizeForCompare(s) {
  return s
    .replace(/[•\-–—*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isNameDuplicate(line, variants) {
  const n = normalizeForCompare(line);
  if (!n) return false;
  return variants.has(n);
}

// Drop ingredient bullets that are actually yield / total-weight info.
// Triggered after the bullet prefix and any leading emoji are stripped.
const YIELD_LINE_RE_AR = /^(الوزن\s*(النهائي|الكلي)|المجموع|الكمية\s*الكلية|حجم\s*الحصة|الحصة\s*الواحدة|إجمالي\s*الناتج)/;
const YIELD_LINE_RE_EN = /^(yield|total\s+weight|final\s+weight|net\s+weight|grand\s+total|total[:\s]|serving\s+size|portion\s+size|portions?\s*[:=])/i;
function isYieldLine(line) {
  const stripped = line.replace(/^[\s•⦁\-–—*✅❌⚠️]+/, '').trim();
  if (!stripped) return false;
  return YIELD_LINE_RE_AR.test(stripped) || YIELD_LINE_RE_EN.test(stripped);
}

/**
 * Real ingredient bullets always pair a name with a quantity. Lines
 * with no digit AND no ":"/"–"/"—" separator are almost always dish-
 * name translations, category labels, or stray descriptive paragraphs
 * that drifted into the ingredients section before any real header.
 *
 * Also rejects advisory bullets ("Warning: ...", "Note: ...",
 * "Tip: ..., "Caution: ...", "Important: ...") that carry digits or
 * colons but aren't actually ingredient quantities.
 */
function looksLikeIngredient(line) {
  const tr = line.replace(/^[\s•⦁\-*✅❌⚠️🇬🇧🇪🇬]+/, '').trim();
  if (!tr) return false;
  // Advisory prefixes — not ingredients.
  if (/^(critical\s+)?warning\s*[:：]/i.test(tr)) return false;
  if (/^(critical|important|safety)\s*[:：]/i.test(tr)) return false;
  if (/^(note|notes|tip|tips|caution|attention)\s*[:：]/i.test(tr)) return false;
  if (/^(تحذير|تنبيه|انتباه|مهم|ملاحظة)\s*[:：]/.test(tr)) return false;
  // Quantity digit (Western or Arabic) is the strongest signal.
  if (/[\d٠-٩]/.test(tr)) return true;
  // Otherwise require an explicit name/qty separator.
  return /[:：–—]/.test(tr);
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

/**
 * Only the *critical* gaps. Ingredients are required for the recipe to
 * be usable; prep, photo, and video are nice-to-have so missing them
 * doesn't merit a warning to the kitchen.
 */
function missingCritical(recipe) {
  const c = recipe.completeness || computeCompleteness(recipe);
  const missing = [];
  if (!c.has_ingredients_en) missing.push('ingredients_en');
  if (!c.has_ingredients_ar) missing.push('ingredients_ar');
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

/** Has ingredients in BOTH languages — the bot's "ready" state. */
function isReady(recipe) {
  const c = recipe.completeness || computeCompleteness(recipe);
  return c.has_ingredients_en && c.has_ingredients_ar;
}

/** Has at least one ingredients language — still serveable. */
function isUsable(recipe) {
  const c = recipe.completeness || computeCompleteness(recipe);
  return c.has_ingredients_en || c.has_ingredients_ar;
}

module.exports = {
  parseRecipe,
  nameFromUrl,
  computeCompleteness,
  missingFields,
  missingCritical,
  isEmpty,
  isComplete,
  isReady,
  isUsable,
};
