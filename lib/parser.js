'use strict';

const { fetchBlockChildren } = require('./notion');

// Toggle / heading text patterns (case-insensitive, trimmed) routed to
// each of the four structured fields. Order matters only for clarity.
const INGREDIENTS_EN_PATTERNS = [
  /^ingredients\s*\(en\)$/i,
  /^ingredients\s*\(english\)$/i,
  /^ingredients$/i,
];
const INGREDIENTS_AR_PATTERNS = [
  /^ingredients\s*\(ar\)$/i,
  /^ingredients\s*\(arabic\)$/i,
  /^المكونات$/,
  /^المقادير$/,
];
const PREP_EN_PATTERNS = [
  /^how\s*to\s*\(en\)$/i,
  /^how\s*to\s*\(english\)$/i,
  /^preparation$/i,
  /^how\s*to$/i,
  /^method$/i,
  /^steps$/i,
];
const PREP_AR_PATTERNS = [
  /^how\s*to\s*\(ar\)$/i,
  /^how\s*to\s*\(arabic\)$/i,
  /^طريقة التحضير$/,
  /^التحضير$/,
];

// Sections to skip entirely (waiter / FOH content).
const SKIP_PATTERNS = [
  /waiters?\s*training/i,
  /waiters?\s*guide/i,
  /service\s*notes/i,
  /plating\s*guide/i,
];

function matchesAny(text, patterns) {
  return patterns.some((re) => re.test(text));
}

function richTextToPlain(rich) {
  if (!Array.isArray(rich)) return '';
  return rich.map((t) => t?.plain_text || '').join('');
}

/**
 * Walk a block tree and emit one line per renderable child.
 * Used for the contents of a single toggle (e.g. "Ingredients (En)").
 */
async function renderBlocks(blocks, depth = 0) {
  const lines = [];
  for (const block of blocks) {
    const type = block.type;
    const data = block[type];
    const indent = '  '.repeat(depth);

    if (type === 'paragraph') {
      const text = richTextToPlain(data?.rich_text);
      if (text) lines.push(indent + text);
    } else if (type === 'bulleted_list_item') {
      const text = richTextToPlain(data?.rich_text);
      if (text) lines.push(`${indent}• ${text}`);
    } else if (type === 'numbered_list_item') {
      const text = richTextToPlain(data?.rich_text);
      if (text) lines.push(`${indent}${text}`);  // numbers will be auto-applied below
    } else if (type === 'to_do') {
      const text = richTextToPlain(data?.rich_text);
      if (text) lines.push(`${indent}• ${text}`);
    } else if (type === 'quote' || type === 'callout') {
      const text = richTextToPlain(data?.rich_text);
      if (text) lines.push(indent + text);
    } else if (type === 'table' && block.has_children) {
      const rows = await fetchBlockChildren(block.id);
      for (const row of rows) {
        if (row.type !== 'table_row') continue;
        const cells = row.table_row?.cells || [];
        const rowText = cells.map(richTextToPlain).join(' | ').trim();
        if (rowText) lines.push(rowText);
      }
    } else if (type === 'toggle') {
      // Nested toggle inside a section — flatten its contents
      const label = richTextToPlain(data?.rich_text);
      if (label) lines.push(indent + label + ':');
      if (block.has_children) {
        const children = await fetchBlockChildren(block.id);
        const inner = await renderBlocks(children, depth + 1);
        if (inner) lines.push(inner);
      }
    } else if (block.has_children) {
      const children = await fetchBlockChildren(block.id);
      const inner = await renderBlocks(children, depth);
      if (inner) lines.push(inner);
    }
  }

  // Number consecutive numbered_list_item lines using ASCII digits.
  // (Arabic-digit numbering only happens when the source itself uses
  // them — we don't trans-numerate, we just keep the source.)
  return lines.join('\n');
}

/**
 * Render and number a section. For preparation sections we replace bare
 * lines with sequential numbering when the source had numbered_list_items.
 */
async function renderSection(blocks, opts = {}) {
  const raw = await renderBlocks(blocks);
  if (!raw) return '';

  if (!opts.numbered) return raw;

  // Walk lines and assign sequential numbers to lines that look like
  // unprefixed prep steps (i.e. no bullet, no existing number).
  const lines = raw.split('\n');
  let n = 1;
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (/^[•\-]/.test(trimmed)) return line; // already a bullet
      if (/^\d+\./.test(trimmed)) return line; // already numbered
      if (/^[٠-٩]+\./.test(trimmed)) return line; // already Arabic-numbered
      const out = line.replace(trimmed, `${n}. ${trimmed}`);
      n++;
      return out;
    })
    .join('\n');
}

// Extract a human name from the Notion page URL slug.
// e.g. https://www.notion.so/CHICKEN-ALFREDO-abc123 → "Chicken Alfredo"
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
 * Parse a recipe page's blocks into the structured cache schema.
 *
 * @param {object} page - { id, url, properties? } from Notion
 * @param {Array}  topBlocks - top-level blocks (from fetchPageBlocks)
 * @returns {Promise<object|null>} structured recipe or null if empty/skippable
 */
async function parseRecipe(page, topBlocks) {
  let name = '';

  // Try the page title first if present
  const titleProp = page?.properties?.title?.title
    || page?.properties?.Name?.title
    || page?.properties?.title?.title;
  if (Array.isArray(titleProp) && titleProp.length) {
    name = richTextToPlain(titleProp);
  }

  let ingredients_en = '';
  let ingredients_ar = '';
  let prep_en = '';
  let prep_ar = '';
  let photo_block_id = null;
  let video_block_id = null;

  let skipUntilNextHeading = false;

  for (const block of topBlocks) {
    const type = block.type;
    const data = block[type];

    // Headings can flip the skip flag (e.g. "Waiters Training Guide")
    if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
      const headingText = richTextToPlain(data?.rich_text);
      skipUntilNextHeading = matchesAny(headingText, SKIP_PATTERNS);
      if (!name && headingText && !skipUntilNextHeading) {
        name = headingText;
      }
      continue;
    }

    if (skipUntilNextHeading) continue;

    // Media — first seen wins
    if (type === 'image' && !photo_block_id) {
      photo_block_id = block.id;
      continue;
    }
    if (type === 'video' && !video_block_id) {
      video_block_id = block.id;
      continue;
    }

    if (type !== 'toggle') continue;

    const label = richTextToPlain(data?.rich_text).trim();
    if (!label) continue;
    if (matchesAny(label, SKIP_PATTERNS)) continue;
    if (!block.has_children) continue;

    const children = await fetchBlockChildren(block.id);

    if (matchesAny(label, INGREDIENTS_EN_PATTERNS)) {
      ingredients_en = await renderSection(children);
    } else if (matchesAny(label, INGREDIENTS_AR_PATTERNS)) {
      ingredients_ar = await renderSection(children);
    } else if (matchesAny(label, PREP_EN_PATTERNS)) {
      prep_en = await renderSection(children, { numbered: true });
    } else if (matchesAny(label, PREP_AR_PATTERNS)) {
      prep_ar = await renderSection(children, { numbered: true });
    }
    // Other toggles (Quality Check, etc.) are ignored — kitchen-only bot.
  }

  if (!name) name = nameFromUrl(page.url);

  // Validation — if nothing usable was extracted, signal skip.
  if (!ingredients_en && !ingredients_ar && !prep_en && !prep_ar) {
    return null;
  }

  return {
    url: page.url,
    name,
    ingredients_en,
    ingredients_ar,
    prep_en,
    prep_ar,
    photo_block_id,
    video_block_id,
  };
}

module.exports = { parseRecipe, nameFromUrl };
