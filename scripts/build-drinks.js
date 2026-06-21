'use strict';

// Phase 5 of v4.2.0 — Drinks cache builder.
// Builds the three DRINK slots into recipes-cache.json, leaving the food
// slots (le_garage, boho) completely untouched. Run separately from the
// food cache-builder; both share lib/cache.js's atomic saveCache, and
// loadCache preserves every slot it doesn't write.
//
//   le_garage_drinks        ← El Gouna bar  (primary)
//   le_garage_drinks_cairo  ← Cairo bar     (kept separate, owner choice B)
//   boho_drinks             ← Boho bar
//
// Inclusion policy: STRICT — keep only rows with ingredients in ≥1 language
// (isUsable). Empty placeholders and pour-and-serve "prep-only" rows
// (juices, sodas, bottled wine/spirits) are excluded — search.js would
// score them -1 anyway. Pass --write to persist; without it, dry report only.

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const path = require('path');
const { Client } = require('@notionhq/client');
const { fetchPageBlocks } = require(path.resolve(__dirname, '..', 'lib', 'notion'));
const { parseRecipe, isUsable, isEmpty } = require(path.resolve(__dirname, '..', 'lib', 'parser'));
const { loadCache, saveCache, getRestaurantRecipes } = require(path.resolve(__dirname, '..', 'lib', 'cache'));

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const NOTION_DELAY_MS = 220;
const WRITE = process.argv.includes('--write');

// label drives parser behaviour: 'Boho' enables the low-structure flag;
// 'El Gouna'/'Cairo' keep the bilingual (————) food-style handling.
const DBS = [
  { slot: 'le_garage_drinks',       label: 'El Gouna', id: '2ad2c25e-cb5d-81cb-9724-ca67b91f5e68', menu: 'EL GOUNA BAR' },
  { slot: 'le_garage_drinks_cairo', label: 'Cairo',    id: '2ad2c25e-cb5d-81e5-bede-d6075a989272', menu: 'CAIRO BAR' },
  { slot: 'boho_drinks',            label: 'Boho',     id: '35d2c25e-cb5d-805c-ad58-e1c72ade31fb', menu: 'BOHO BAR' },
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function queryAll(databaseId) {
  const out = []; let cursor;
  do {
    const r = await notion.databases.query({ database_id: databaseId, page_size: 100, start_cursor: cursor });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

(async () => {
  if (!process.env.NOTION_TOKEN) { console.error('❌ NOTION_TOKEN missing'); process.exit(1); }
  console.log(`🍹 Drinks cache build — mode: ${WRITE ? 'WRITE' : 'DRY (no save)'}\n`);

  const cache = loadCache();
  console.log(`📦 Loaded cache: le_garage=${Object.keys(getRestaurantRecipes(cache, 'le_garage')).length} boho=${Object.keys(getRestaurantRecipes(cache, 'boho')).length}`);
  console.log(`   existing drink slots: ` + DBS.map((d) => `${d.slot}=${Object.keys(getRestaurantRecipes(cache, d.slot)).length}`).join(' ') + '\n');

  const summary = [];

  for (const db of DBS) {
    console.log(`━━━━ ${db.menu} (${db.slot}) ━━━━`);
    const rows = await queryAll(db.id);
    const recipes = cache[db.slot].recipes;

    let kept = 0, excludedEmpty = 0, excludedPrepOnly = 0, failed = 0;
    const keptIds = new Set();

    for (let i = 0; i < rows.length; i++) {
      const page = rows[i];
      try {
        await sleep(NOTION_DELAY_MS);
        const blocks = await fetchPageBlocks(page.id);
        const parsed = await parseRecipe({
          id: page.id, url: page.url,
          properties: page.properties || {}, parent: page.parent || {},
          database_id: db.id, database_label: db.label,
          last_edited_time: page.last_edited_time,
        }, blocks);

        if (!isUsable(parsed)) {
          if (isEmpty(parsed)) excludedEmpty++; else excludedPrepOnly++;
          // Ensure a previously-cached row that is now unusable is removed.
          continue;
        }

        const previous = recipes[page.id] || {};
        recipes[page.id] = {
          ...parsed,
          type: 'drink',
          photo_file_id: previous.photo_file_id || '',
          video_file_id: previous.video_file_id || '',
          cached_at: new Date().toISOString(),
        };
        keptIds.add(page.id);
        kept++;
      } catch (err) {
        failed++;
        console.log(`   ❌ ${page.url} — ${err.message}`);
      }
    }

    // Drop cached rows that no longer qualify (deleted, emptied, or now prep-only).
    let removed = 0;
    for (const id of Object.keys(recipes)) {
      if (!keptIds.has(id)) { delete recipes[id]; removed++; }
    }

    cache[db.slot].updated_at = new Date().toLocaleString('uk-UA', { timeZone: 'Africa/Cairo' });
    console.log(`   kept=${kept}  excluded(empty=${excludedEmpty}, prep-only=${excludedPrepOnly})  removed-stale=${removed}  failed=${failed}\n`);
    summary.push({ menu: db.menu, slot: db.slot, kept, excludedEmpty, excludedPrepOnly, failed });
  }

  console.log('══════════════════════════════════════');
  console.log('📊 DRINKS BUILD SUMMARY');
  console.log('══════════════════════════════════════');
  let total = 0;
  for (const s of summary) { console.log(`  ${s.menu.padEnd(14)} → ${s.slot.padEnd(24)} kept=${s.kept}`); total += s.kept; }
  console.log(`  TOTAL drinks: ${total}`);

  if (WRITE) {
    saveCache(cache);
    console.log(`\n✅ Saved. Food slots preserved: le_garage=${Object.keys(getRestaurantRecipes(cache, 'le_garage')).length} boho=${Object.keys(getRestaurantRecipes(cache, 'boho')).length}`);
    console.log(`   version now: ${require(path.resolve(__dirname, '..', 'recipes-cache.json')).version}`);
  } else {
    console.log('\n(DRY run — nothing saved. Re-run with --write to persist.)');
  }
})().catch((e) => { console.error('💥', e.stack || e.message); process.exit(1); });
