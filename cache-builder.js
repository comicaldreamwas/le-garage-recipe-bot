'use strict';

require('dotenv').config();

const { fetchAllRecipes, fetchPageBlocks } = require('./lib/notion');
const { parseRecipe } = require('./lib/parser');
const { loadCache, saveCache } = require('./lib/cache');

const CACHE_STALE_DAYS = 7;
const NOTION_DELAY_MS = 250; // stay under Notion's 3 req/sec rate limit

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

  // ── Validate env ─────────────────────────────────────────────────────────
  if (!process.env.NOTION_TOKEN) {
    console.error('❌ Missing env variable: NOTION_TOKEN');
    process.exit(1);
  }

  // ── Load existing cache ──────────────────────────────────────────────────
  const cache = loadCache();
  const existingCount = Object.keys(cache.recipes).length;
  console.log(`📦 Loaded existing cache: ${existingCount} recipes\n`);

  // ── Fetch all recipe pages from Notion ───────────────────────────────────
  console.log('🔍 Fetching recipe list from Notion...');
  const pages = await fetchAllRecipes();
  console.log(`✅ Found ${pages.length} pages in Notion\n`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let empty = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const progress = `[${String(i + 1).padStart(3)}/${pages.length}]`;

    // Smart skip: already cached and fresh
    if (isFresh(cache.recipes[page.id])) {
      console.log(`${progress} ⏭  Skipping (fresh): ${cache.recipes[page.id].name}`);
      skipped++;
      continue;
    }

    console.log(`${progress} 🔄 Processing: ${page.url.split('/').pop()}`);

    try {
      await sleep(NOTION_DELAY_MS);
      const topBlocks = await fetchPageBlocks(page.id);
      const parsed = await parseRecipe(page, topBlocks);

      if (!parsed) {
        console.log('         ⚠️  Empty content — skipping');
        empty++;
        continue;
      }

      // Preserve previously-cached Telegram file_ids so the bot still serves
      // photo/video instantly after the rebuild.
      const previous = cache.recipes[page.id] || {};
      cache.recipes[page.id] = {
        ...parsed,
        photo_file_id: previous.photo_file_id || '',
        video_file_id: previous.video_file_id || '',
        cached_at: new Date().toISOString(),
      };

      console.log(`         ✅ ${parsed.name}`);
      processed++;

      // Atomic save after each recipe — progress survives a crash.
      cache.updated_at = new Date().toLocaleString('uk-UA', { timeZone: 'Africa/Cairo' });
      saveCache(cache);

    } catch (err) {
      console.error(`         ❌ Failed: ${err.message}`);
      failed++;
    }

    await sleep(NOTION_DELAY_MS);
  }

  // ── Final summary ────────────────────────────────────────────────────────
  cache.updated_at = new Date().toLocaleString('uk-UA', { timeZone: 'Africa/Cairo' });
  saveCache(cache);

  console.log('\n══════════════════════════════');
  console.log('📊 Cache build complete:');
  console.log(`   ✅ Processed : ${processed}`);
  console.log(`   ⏭  Skipped   : ${skipped} (fresh)`);
  console.log(`   ⚠️  Empty     : ${empty}`);
  console.log(`   ❌ Failed    : ${failed}`);
  console.log(`   📦 Total     : ${Object.keys(cache.recipes).length} recipes in cache`);
  console.log('══════════════════════════════\n');
}

main().catch((err) => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
