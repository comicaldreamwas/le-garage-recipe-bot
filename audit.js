'use strict';

require('dotenv').config();

const fs = require('fs');
const { Client } = require('@notionhq/client');

const { fetchPageBlocks, fetchBlockChildren, ALLOWED_DATABASE_IDS } = require('./lib/notion');
const { parseRecipe } = require('./lib/parser');
const { loadCache } = require('./lib/cache');

const REPORT_PATH = '/tmp/audit-report.md';
const NOTION_DELAY_MS = 250;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function normalizeId(id) { return (id || '').replace(/-/g, '').toLowerCase(); }

// Normalise a slug or page name into a duplicate-detection key.
//   "Caesar-salad-dressing"        → "caesarsaladdressing"
//   "🥗 Caesar Salad Dressing"     → "caesarsaladdressing"
function dupKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function slugFromUrl(url) {
  try {
    const path = new URL(url).pathname.split('/').pop() || '';
    return path.replace(/-?[0-9a-f]{32}$/i, '');
  } catch {
    return '';
  }
}

let notion;
function getClient() {
  if (!notion) notion = new Client({ auth: process.env.NOTION_TOKEN });
  return notion;
}

// Full search returning last_edited_time alongside parent/url/properties.
async function fetchAllLeGaragePages() {
  const client = getClient();
  const allowed = ALLOWED_DATABASE_IDS;
  const out = [];
  let cursor;
  do {
    const res = await client.search({
      filter: { value: 'page', property: 'object' },
      page_size: 100,
      start_cursor: cursor,
    });
    for (const p of res.results) {
      if (p.object !== 'page' || !p.url) continue;
      const dbId = p.parent?.database_id ? normalizeId(p.parent.database_id) : null;
      if (!allowed.includes(dbId)) continue;
      out.push({
        id: p.id,
        url: p.url,
        properties: p.properties,
        parent: p.parent,
        database_id: dbId,
        last_edited_time: p.last_edited_time,
      });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

// Cheap "block count" approximation — used to rank duplicates by content depth.
async function countNotionBlocks(pageId) {
  let total = 0;
  let hasPhoto = false;
  let hasVideo = false;
  const blocks = await fetchPageBlocks(pageId);
  for (const b of blocks) {
    total += 1;
    if (b.type === 'image') hasPhoto = true;
    if (b.type === 'video') hasVideo = true;
    if (b.has_children && b.type !== 'table') {
      try {
        const kids = await fetchBlockChildren(b.id);
        total += kids.length;
        for (const k of kids) {
          if (k.type === 'image') hasPhoto = true;
          if (k.type === 'video') hasVideo = true;
        }
      } catch { /* ignore */ }
    }
  }
  return { total, hasPhoto, hasVideo };
}

function countLines(s) {
  return (s || '').split('\n').filter((l) => l.trim()).length;
}

async function main() {
  console.log('🔍 Loading cache…');
  const cache = loadCache();
  const cachedById = cache.recipes || {};
  const cachedCount = Object.keys(cachedById).length;
  console.log(`   Cached recipes: ${cachedCount}`);
  console.log(`   Cache updated_at: ${cache.updated_at}`);

  console.log('\n🔍 Fetching all Le Garage pages from Notion (with last_edited_time)…');
  const pages = await fetchAllLeGaragePages();
  console.log(`   Found ${pages.length} pages`);

  // ─────────────────────── 1. Duplicate detection ─────────────────────────
  console.log('\n🔎 Scanning for duplicates…');
  const groups = new Map();
  for (const p of pages) {
    const key = dupKey(slugFromUrl(p.url));
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const duplicates = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const enriched = [];
    for (const p of group) {
      await sleep(NOTION_DELAY_MS);
      const meta = await countNotionBlocks(p.id);
      enriched.push({ page: p, ...meta });
    }
    enriched.sort((a, b) => {
      // Recommend the more-complete OR more-recently-edited copy
      if (b.total !== a.total) return b.total - a.total;
      return new Date(b.page.last_edited_time) - new Date(a.page.last_edited_time);
    });
    duplicates.push({ key, copies: enriched });
  }
  console.log(`   Duplicate groups: ${duplicates.length}`);

  // ─────────────────────── 2. Cache vs Notion compare ─────────────────────
  console.log('\n🔎 Comparing each cached recipe against live Notion content…');
  const mismatches = [];
  const stale = [];
  const empty = [];
  let ok = 0;

  let processed = 0;
  for (const p of pages) {
    processed++;
    const cached = cachedById[p.id];
    if (!cached) continue; // dedupe drop or new page since last build
    if (processed % 25 === 0) {
      console.log(`   [${processed}/${pages.length}] checking…`);
    }

    try {
      await sleep(NOTION_DELAY_MS);
      const blocks = await fetchPageBlocks(p.id);
      const live = await parseRecipe(p, blocks);

      const cEn = countLines(cached.ingredients_en);
      const cAr = countLines(cached.ingredients_ar);
      const lEn = countLines(live.ingredients_en);
      const lAr = countLines(live.ingredients_ar);
      const cPep = countLines(cached.prep_en);
      const cPap = countLines(cached.prep_ar);
      const lPep = countLines(live.prep_en);
      const lPap = countLines(live.prep_ar);

      if (cEn === 0 && cAr === 0 && cPep === 0 && cPap === 0) {
        empty.push({ id: p.id, name: cached.name, url: p.url });
        continue;
      }

      if (cEn !== lEn || cAr !== lAr || cPep !== lPep || cPap !== lPap) {
        mismatches.push({
          id: p.id,
          name: cached.name,
          url: p.url,
          cache: { ing_en: cEn, ing_ar: cAr, prep_en: cPep, prep_ar: cPap },
          live:  { ing_en: lEn, ing_ar: lAr, prep_en: lPep, prep_ar: lPap },
        });
        continue;
      }

      if (cache.updated_at && p.last_edited_time) {
        const cacheT = new Date(cache.updated_at);
        const notionT = new Date(p.last_edited_time);
        if (notionT > cacheT) {
          stale.push({ id: p.id, name: cached.name, url: p.url, edited: p.last_edited_time });
          continue;
        }
      }

      ok++;
    } catch (err) {
      mismatches.push({ id: p.id, name: cached?.name, url: p.url, error: err.message });
    }
  }
  console.log(`   Compared: ${processed} pages | ok=${ok} | mismatches=${mismatches.length} | stale=${stale.length} | empty=${empty.length}`);

  // ─────────────────────────── 3. Build report ────────────────────────────
  const lines = [];
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  lines.push('═══════════════════════════════════');
  lines.push('# 📊 AUDIT REPORT');
  lines.push(`Generated: ${stamp}`);
  lines.push('═══════════════════════════════════');
  lines.push('');
  lines.push('## 📈 SUMMARY');
  lines.push('');
  lines.push(`- Total cached recipes: ${cachedCount}`);
  lines.push(`- Pages on Notion (Le Garage): ${pages.length}`);
  lines.push(`- Duplicate groups in Notion: ${duplicates.length}`);
  lines.push(`- Cache-vs-Notion mismatches: ${mismatches.length}`);
  lines.push(`- Stale (Notion newer than cache): ${stale.length}`);
  lines.push(`- Empty (cached but no content): ${empty.length}`);
  lines.push(`- ✅ Valid and current: ${ok}`);
  lines.push('');

  if (mismatches.length) {
    lines.push('## 🔴 CRITICAL — Cache content differs from Notion');
    lines.push('Kitchen will see WRONG quantities/ingredients for these.');
    lines.push('');
    for (const m of mismatches) {
      lines.push(`### ${m.name || '(no name)'}`);
      lines.push(`URL: ${m.url}`);
      if (m.error) {
        lines.push(`Error: ${m.error}`);
      } else {
        lines.push(`Cache  → ing_en=${m.cache.ing_en} | ing_ar=${m.cache.ing_ar} | prep_en=${m.cache.prep_en} | prep_ar=${m.cache.prep_ar}`);
        lines.push(`Notion → ing_en=${m.live.ing_en} | ing_ar=${m.live.ing_ar} | prep_en=${m.live.prep_en} | prep_ar=${m.live.prep_ar}`);
        const diffs = [];
        if (m.cache.ing_en !== m.live.ing_en) diffs.push(`ing_en (${m.cache.ing_en} → ${m.live.ing_en})`);
        if (m.cache.ing_ar !== m.live.ing_ar) diffs.push(`ing_ar (${m.cache.ing_ar} → ${m.live.ing_ar})`);
        if (m.cache.prep_en !== m.live.prep_en) diffs.push(`prep_en (${m.cache.prep_en} → ${m.live.prep_en})`);
        if (m.cache.prep_ar !== m.live.prep_ar) diffs.push(`prep_ar (${m.cache.prep_ar} → ${m.live.prep_ar})`);
        lines.push(`Diffs  → ${diffs.join(', ')}`);
      }
      lines.push('Action: re-run `node cache-builder.js`');
      lines.push('');
    }
  }

  if (duplicates.length) {
    lines.push('## ⚠️  DUPLICATES — Multiple Notion pages with the same slug');
    lines.push('Pick one canonical page and delete/archive the others in Notion.');
    lines.push('');
    for (const d of duplicates) {
      lines.push(`### "${d.key}"`);
      for (let i = 0; i < d.copies.length; i++) {
        const c = d.copies[i];
        const marker = i === 0 ? '✅ KEEP' : '❌ DELETE';
        lines.push(`${marker}  ${c.page.url}`);
        lines.push(`        edited: ${c.page.last_edited_time}  blocks: ${c.total}  photo: ${c.hasPhoto ? '✓' : '✗'}  video: ${c.hasVideo ? '✓' : '✗'}`);
      }
      lines.push('Action: delete or archive the non-kept copies in Notion');
      lines.push('');
    }
  }

  if (stale.length) {
    lines.push('## 🟡 STALE — Cache older than Notion edit');
    lines.push('Cache built before these were edited in Notion. Re-run cache-builder.');
    lines.push('');
    for (const s of stale) {
      lines.push(`- ${s.name}  (edited ${s.edited})`);
      lines.push(`  ${s.url}`);
    }
    lines.push('');
    lines.push('Action: `node cache-builder.js`');
    lines.push('');
  }

  if (empty.length) {
    lines.push('## 📝 EMPTY — Cached as placeholder, no content in Notion');
    lines.push('');
    for (const e of empty) {
      lines.push(`- ${e.name || '(no name)'}`);
      lines.push(`  ${e.url}`);
    }
    lines.push('');
    lines.push('Action: add content in Notion or delete the page');
    lines.push('');
  }

  lines.push('═══════════════════════════════════');
  lines.push('## 🔧 RECOMMENDED ACTIONS');
  lines.push('═══════════════════════════════════');
  lines.push('');
  let step = 1;
  if (duplicates.length) {
    lines.push(`${step}. Delete ${duplicates.length} duplicate group(s) in Notion — keep the version marked ✅, archive/delete the others.`);
    step++;
  }
  if (empty.length) {
    lines.push(`${step}. Fix or delete ${empty.length} empty page(s) in Notion.`);
    step++;
  }
  if (mismatches.length || stale.length) {
    lines.push(`${step}. Re-run \`node cache-builder.js\` to refresh ${mismatches.length + stale.length} stale/mismatched entries.`);
    step++;
  }
  lines.push(`${step}. Re-run \`node audit.js\` to confirm everything is clean.`);
  step++;
  lines.push(`${step}. Start the bot: \`pm2 start recipe-bot\` (or it auto-starts on next deploy).`);
  lines.push('');

  const report = lines.join('\n');
  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  console.log(`\n📄 Report written to ${REPORT_PATH}`);
  console.log(`\n${report}`);
}

main().catch((err) => {
  console.error('💥 Audit failed:', err);
  process.exit(1);
});
