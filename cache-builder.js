'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { fetchAllRecipes, fetchPageBlocks } = require('./lib/notion');
const { parseRecipe, missingFields, isEmpty, isComplete } = require('./lib/parser');
const { loadCache, saveCache } = require('./lib/cache');

const CACHE_STALE_DAYS = 7;
const NOTION_DELAY_MS = 250; // stay under Notion's 3 req/sec rate limit
const REPORT_PATH = '/tmp/recipe-report.txt';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFresh(recipe) {
  if (!recipe?.cached_at) return false;
  const age = Date.now() - new Date(recipe.cached_at).getTime();
  return age < CACHE_STALE_DAYS * 24 * 60 * 60 * 1000;
}

async function main() {
  console.log('🚀 Cache builder starting...\n');

  if (!process.env.NOTION_TOKEN) {
    console.error('❌ Missing env variable: NOTION_TOKEN');
    process.exit(1);
  }

  const cache = loadCache();
  const existingCount = Object.keys(cache.recipes).length;
  console.log(`📦 Loaded existing cache: ${existingCount} recipes\n`);

  console.log('🔍 Fetching recipe list from Notion...');
  const pages = await fetchAllRecipes();
  console.log(`✅ Found ${pages.length} pages in Notion\n`);

  const processed = [];   // every recipe (complete + incomplete)
  let skipped = 0;
  let failed = 0;
  let emptyCount = 0;
  let completeCount = 0;
  let incompleteCount = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const progress = `[${String(i + 1).padStart(3)}/${pages.length}]`;
    const slugLabel = page.url.split('/').pop().replace(/-[0-9a-f]{32}$/i, '');

    if (isFresh(cache.recipes[page.id])) {
      console.log(`${progress} ⏭  ${cache.recipes[page.id].name} (fresh)`);
      skipped++;
      processed.push(cache.recipes[page.id]);
      continue;
    }

    try {
      await sleep(NOTION_DELAY_MS);
      const topBlocks = await fetchPageBlocks(page.id);
      const parsed = await parseRecipe(page, topBlocks);

      // Always store — even empty pages — so owner sees them in /broken.
      const previous = cache.recipes[page.id] || {};
      cache.recipes[page.id] = {
        ...parsed,
        photo_file_id: previous.photo_file_id || '',
        video_file_id: previous.video_file_id || '',
        cached_at: new Date().toISOString(),
      };
      const stored = cache.recipes[page.id];
      processed.push(stored);

      if (isEmpty(stored)) {
        console.log(`${progress} ⚠️  ${slugLabel} — empty (only title)`);
        emptyCount++;
      } else if (isComplete(stored)) {
        console.log(`${progress} ✅ ${stored.name}`);
        completeCount++;
      } else {
        const miss = missingFields(stored).join(', ');
        console.log(`${progress} ⚠️  ${stored.name} — missing: ${miss}`);
        incompleteCount++;
      }

      cache.updated_at = new Date().toLocaleString('uk-UA', { timeZone: 'Africa/Cairo' });
      saveCache(cache);

    } catch (err) {
      console.error(`${progress} ❌ ${slugLabel} — ${err.message}`);
      failed++;
    }

    await sleep(NOTION_DELAY_MS);
  }

  cache.updated_at = new Date().toLocaleString('uk-UA', { timeZone: 'Africa/Cairo' });
  saveCache(cache);

  writeReport(processed);
  printReport({
    total: pages.length,
    complete: completeCount,
    incomplete: incompleteCount,
    empty: emptyCount,
    skipped,
    failed,
    cacheSize: Object.keys(cache.recipes).length,
    processed,
  });
}

function writeReport(processed) {
  const broken = processed
    .filter((r) => !isComplete(r))
    .map((r) => ({ recipe: r, miss: isEmpty(r) ? ['ALL FIELDS'] : missingFields(r) }));

  const lines = ['=== INCOMPLETE RECIPES ===', `Generated: ${new Date().toISOString()}`, ''];
  for (const { recipe, miss } of broken) {
    lines.push(recipe.name || '(no name)');
    lines.push(`URL: ${recipe.url}`);
    lines.push(`Missing: ${miss.join(', ')}`);
    lines.push('---');
  }

  try {
    fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  } catch (err) {
    console.warn(`⚠️  Could not write ${REPORT_PATH}: ${err.message}`);
  }
}

function printReport({ total, complete, incomplete, empty, skipped, failed, cacheSize, processed }) {
  const counts = countMissing(processed);
  const pct = (n) => total ? Math.round((n / total) * 100) : 0;

  console.log('\n═══════════════════════════════════');
  console.log('📊 CACHE BUILD REPORT');
  console.log('═══════════════════════════════════');
  console.log(`Total recipes  : ${total}`);
  console.log(`✅ Complete    : ${complete} (${pct(complete)}%)`);
  console.log(`⚠️  Incomplete  : ${incomplete} (${pct(incomplete)}%)`);
  console.log(`⚠️  Empty       : ${empty} (${pct(empty)}%)`);
  console.log(`⏭  Skipped     : ${skipped}`);
  console.log(`❌ Failed      : ${failed}`);
  console.log(`📦 Cache total : ${cacheSize}`);

  if (incomplete + empty > 0) {
    console.log('\nPROBLEMS TO FIX IN NOTION:');
    if (counts.ingredients_en) console.log(`  - ${counts.ingredients_en} recipes missing ingredients_en`);
    if (counts.ingredients_ar) console.log(`  - ${counts.ingredients_ar} recipes missing ingredients_ar`);
    if (counts.prep_en)        console.log(`  - ${counts.prep_en} recipes missing prep_en`);
    if (counts.prep_ar)        console.log(`  - ${counts.prep_ar} recipes missing prep_ar`);
    if (counts.photo)          console.log(`  - ${counts.photo} recipes missing photo`);
    if (counts.video)          console.log(`  - ${counts.video} recipes missing video`);
    if (counts.allEmpty)       console.log(`  - ${counts.allEmpty} recipes are completely empty`);
    console.log(`\nSee ${REPORT_PATH} for full list with Notion URLs`);
  }

  // Format breakdown — which Notion layout each recipe used.
  const fmtCounts = {};
  for (const r of processed) {
    const f = r.format || 'empty';
    fmtCounts[f] = (fmtCounts[f] || 0) + 1;
  }
  console.log('\nFormat breakdown:');
  const order = ['toggle', 'toggle+mixed', 'table', 'list', 'mixed', 'paragraph', 'empty'];
  const labels = {
    toggle: 'Toggle-based',
    'toggle+mixed': 'Toggle + table/list',
    table: 'Header + table',
    list: 'Header + list',
    mixed: 'Header + list & table',
    paragraph: 'Paragraph-only',
    empty: 'No content detected',
  };
  for (const k of order) {
    if (fmtCounts[k]) console.log(`  - ${labels[k]}: ${fmtCounts[k]} recipes`);
  }

  console.log('═══════════════════════════════════\n');
}

function countMissing(processed) {
  const counts = {
    ingredients_en: 0, ingredients_ar: 0,
    prep_en: 0, prep_ar: 0,
    photo: 0, video: 0,
    allEmpty: 0,
  };
  for (const r of processed) {
    if (isEmpty(r)) {
      counts.allEmpty++;
      continue;
    }
    const miss = missingFields(r);
    for (const f of miss) {
      if (counts[f] !== undefined) counts[f]++;
    }
  }
  return counts;
}

main().catch((err) => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
