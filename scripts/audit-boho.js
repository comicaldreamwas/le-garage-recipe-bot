'use strict';

// Phase 4 of v4.0.0 Boho integration.
// Audits the Boho database for:
//   - duplicates (same slug, multiple page IDs)
//   - empty pages (parser returned no ingredients AND no prep)
//   - low_structure skips (Pattern 1 — counted separately)
//   - stale (last_edited > 180 days)
//   - suspicious (<3 ingredient lines — possibly incomplete)
//
// Read-only. No writes to cache.

require('dotenv').config({ path: '/opt/le-garage-recipe-bot/.env' });
const fs   = require('fs');
const { Client } = require('@notionhq/client');
const { fetchPageBlocks } = require('/opt/le-garage-recipe-bot/lib/notion');
const { parseRecipe }     = require('/opt/le-garage-recipe-bot/lib/parser');

const BOHO_DB = process.env.NOTION_PARENT_BOHO;
if (!BOHO_DB) { console.error('NOTION_PARENT_BOHO not set'); process.exit(1); }

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const NOTION_DELAY_MS = 250;
const STALE_DAYS = 180;
const REPORT_PATH = '/tmp/boho-audit.md';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function slug(url) {
  if (!url) return '';
  const last = url.split('/').filter(Boolean).pop() || '';
  return last.replace(/-[0-9a-f]{32}$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function linesOf(text) { return (text || '').split('\n').filter(Boolean); }

(async () => {
  console.log('🔍 Auditing Boho database…');

  // 1. Fetch all pages
  const pages = [];
  let cursor;
  do {
    const r = await notion.databases.query({ database_id: BOHO_DB, page_size: 100, start_cursor: cursor });
    pages.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  console.log(`Fetched ${pages.length} pages\n`);

  const parsedAll = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    try {
      await sleep(NOTION_DELAY_MS);
      const blocks = await fetchPageBlocks(page.id);
      const parsed = await parseRecipe({
        id: page.id, url: page.url,
        properties: page.properties || {}, parent: page.parent || {},
        database_id: BOHO_DB, database_label: 'Boho',
        last_edited_time: page.last_edited_time,
      }, blocks);
      parsedAll.push({ page, parsed });
      if ((i + 1) % 20 === 0) console.log(`  parsed ${i + 1}/${pages.length}`);
    } catch (err) {
      parsedAll.push({ page, error: err.message });
    }
  }

  // 2. Categorize
  const dupGroups = new Map();
  const lowStruct = [];
  const empty     = [];
  const stale     = [];
  const suspicious = [];
  const usable   = [];
  const errors   = [];

  const now = Date.now();
  for (const x of parsedAll) {
    if (x.error) { errors.push(x); continue; }
    const r = x.parsed;
    const s = slug(r.url);
    if (s) {
      if (!dupGroups.has(s)) dupGroups.set(s, []);
      dupGroups.get(s).push(r);
    }
    const ingEn = linesOf(r.ingredients_en);
    const ingAr = linesOf(r.ingredients_ar);
    const totalIng = ingEn.length + ingAr.length;

    if (r.low_structure)          lowStruct.push(r);
    else if (totalIng === 0)      empty.push(r);
    else if (totalIng < 3 * 2)    suspicious.push(r); // <3 lines per language combined-ish (<6 lines total)
    else                          usable.push(r);

    const lastEdit = new Date(r.last_edited_time || 0).getTime();
    if (lastEdit && (now - lastEdit) > STALE_DAYS * 86400 * 1000) {
      stale.push(r);
    }
  }

  const duplicates = [];
  for (const [s, arr] of dupGroups) {
    if (arr.length > 1) duplicates.push({ slug: s, copies: arr });
  }

  // Render report
  const lines = [];
  lines.push('# 🔍 Boho audit report');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Boho DB: ${BOHO_DB}`);
  lines.push(`Pages: ${pages.length}`);
  lines.push('');
  lines.push('## 📊 Summary');
  lines.push(`- ✅ Usable (≥6 ingredient lines): ${usable.length}`);
  lines.push(`- 🟡 Suspicious (<6 lines): ${suspicious.length}`);
  lines.push(`- 🔴 Empty (0 ingredients after parse): ${empty.length}`);
  lines.push(`- ⏭ Low-structure skip (Pattern 1): ${lowStruct.length}`);
  lines.push(`- 🕰 Stale (>${STALE_DAYS} days): ${stale.length}`);
  lines.push(`- ⚠️  Duplicate slug groups: ${duplicates.length}`);
  lines.push(`- 🚫 Parse errors: ${errors.length}`);
  lines.push('');

  if (duplicates.length) {
    lines.push('## ⚠️ DUPLICATES (same slug, multiple Notion pages)');
    for (const d of duplicates) {
      lines.push(`### \`${d.slug}\``);
      for (const c of d.copies) {
        const ing = linesOf(c.ingredients_en).length + linesOf(c.ingredients_ar).length;
        lines.push(`- ${c.name} — ${c.url} — ${ing} ingredient lines, edited ${c.last_edited_time?.slice(0, 10)}`);
      }
      lines.push('');
    }
  }

  if (empty.length) {
    lines.push('## 🔴 EMPTY (parser returned no ingredients)');
    for (const r of empty) lines.push(`- ${r.name || '(no name)'} — ${r.url} — edited ${r.last_edited_time?.slice(0, 10)}`);
    lines.push('');
  }

  if (lowStruct.length) {
    lines.push('## ⏭ LOW-STRUCTURE SKIP (Pattern 1, only paragraphs)');
    lines.push('These are paragraph-only Notion pages — too ambiguous to parse reliably. Per project policy they are skipped.');
    lines.push('');
    for (const r of lowStruct) lines.push(`- ${r.name} — ${r.url} — edited ${r.last_edited_time?.slice(0, 10)}`);
    lines.push('');
  }

  if (suspicious.length) {
    lines.push('## 🟡 SUSPICIOUS (<6 total ingredient lines — possibly incomplete in Notion)');
    for (const r of suspicious) {
      const ingEn = linesOf(r.ingredients_en).length;
      const ingAr = linesOf(r.ingredients_ar).length;
      lines.push(`- ${r.name} — EN ${ingEn} / AR ${ingAr} — ${r.url}`);
    }
    lines.push('');
  }

  if (stale.length) {
    lines.push(`## 🕰 STALE (last edited > ${STALE_DAYS} days ago)`);
    for (const r of stale) {
      lines.push(`- ${r.name} — edited ${r.last_edited_time?.slice(0, 10)} — ${r.url}`);
    }
    lines.push('');
  }

  if (errors.length) {
    lines.push('## 🚫 ERRORS');
    for (const e of errors) lines.push(`- ${e.page.url || e.page.id} — ${e.error}`);
    lines.push('');
  }

  fs.writeFileSync(REPORT_PATH, lines.join('\n'));
  console.log('\n📄 Report:', REPORT_PATH);
  console.log(`\nUsable: ${usable.length} | Suspicious: ${suspicious.length} | Empty: ${empty.length} | Skip: ${lowStruct.length} | Dups: ${duplicates.length} | Stale: ${stale.length} | Errors: ${errors.length}`);
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
