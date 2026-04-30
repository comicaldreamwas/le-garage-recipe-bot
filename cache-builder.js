'use strict';

require('dotenv').config();

const { fetchAllRecipes, fetchPageBlocks, blocksToText } = require('./lib/notion');
const { formatRecipe } = require('./lib/openai');
const { loadCache, saveCache } = require('./lib/cache');

const CACHE_STALE_DAYS = 7;
const NOTION_DELAY_MS = 250; // stay under Notion's 3 req/sec rate limit

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if a cached recipe entry is still fresh (< CACHE_STALE_DAYS old).
 */
function isFresh(recipe) {
  if (!recipe?.formatted_text || !recipe?.cached_at) return false;
  const age = Date.now() - new Date(recipe.cached_at).getTime();
  return age < CACHE_STALE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Extract a human-readable name from a Notion page URL.
 * e.g. "https://www.notion.so/CHICKEN-ALFREDO-abc123" → "CHICKEN-ALFREDO"
 */
function nameFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const slug = parts[parts.length - 1] || '';
    // Remove trailing UUID (last 32 hex chars)
    return slug.replace(/-?[0-9a-f]{32}$/i, '') || slug;
  } catch {
    return url;
  }
}

async function main() {
  console.log('🚀 Cache builder starting...\n');

  // ── Validate env ──────────────────────────────────────────────────────────
  const required = ['NOTION_TOKEN', 'OPENAI_API_KEY'];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`❌ Missing env variable: ${key}`);
      process.exit(1);
    }
  }

  // ── Load existing cache ───────────────────────────────────────────────────
  const cache = loadCache();
  const existingCount = Object.keys(cache.recipes).length;
  console.log(`📦 Loaded existing cache: ${existingCount} recipes\n`);

  // ── Fetch all recipe pages from Notion ────────────────────────────────────
  console.log('🔍 Fetching recipe list from Notion...');
  const pages = await fetchAllRecipes();
  console.log(`✅ Found ${pages.length} pages in Notion\n`);

  // Build the recipes_text string (used by bot for AI search)
  // Use short slug instead of full URL to stay within Groq token limits
  cache.recipes_text = pages.map((p) => `${nameFromUrl(p.url)} = ${p.id}`).join('\n');

  // ── Process each recipe ───────────────────────────────────────────────────
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < pages.length; i++) {
    const { id, url } = pages[i];
    const name = nameFromUrl(url);
    const progress = `[${String(i + 1).padStart(3)}/${pages.length}]`;

    // Smart skip: already cached and fresh
    if (isFresh(cache.recipes[id])) {
      console.log(`${progress} ⏭  Skipping (fresh): ${name}`);
      skipped++;
      continue;
    }

    console.log(`${progress} ⏳ Processing: ${name}`);

    try {
      // Fetch page blocks (top level)
      await sleep(NOTION_DELAY_MS);
      const blocks = await fetchPageBlocks(id);

      // Convert to text (auto-fetches toggle/table children)
      const { text: sourceText, photoBlockId, videoBlockId } = await blocksToText(blocks);

      if (!sourceText.trim()) {
        console.log(`         ⚠️  Empty content, skipping`);
        skipped++;
        continue;
      }

      // Format with OpenAI
      const formatted = await formatRecipe(sourceText);

      if (!formatted) {
        console.log(`         ⚠️  SKIP_RECIPE returned by OpenAI`);
        skipped++;
        continue;
      }

      // Save to cache (preserve existing file_ids if present)
      const existing = cache.recipes[id] || {};
      cache.recipes[id] = {
        formatted_text: formatted,
        photo_block_id: photoBlockId || null,
        video_block_id: videoBlockId || null,
        photo_file_id: existing.photo_file_id || '',
        video_file_id: existing.video_file_id || '',
        cached_at: new Date().toISOString(),
      };

      console.log(`         ✅ Done`);
      processed++;

      // Atomic save after each recipe so progress isn't lost on crash
      cache.updated_at = new Date().toLocaleString('uk-UA', { timeZone: 'Africa/Cairo' });
      saveCache(cache);

    } catch (err) {
      console.error(`         ❌ Failed: ${err.message}`);
      failed++;
      // Continue with next recipe — don't crash
    }

    // Extra delay between recipes to respect Notion rate limit
    await sleep(NOTION_DELAY_MS);
  }

  // ── Final save & summary ─────────────────────────────────────────────────
  cache.updated_at = new Date().toLocaleString('uk-UA', { timeZone: 'Africa/Cairo' });
  saveCache(cache);

  console.log('\n══════════════════════════════');
  console.log('📊 Cache build complete:');
  console.log(`   ✅ Processed : ${processed}`);
  console.log(`   ⏭  Skipped   : ${skipped}`);
  console.log(`   ❌ Failed    : ${failed}`);
  console.log(`   📦 Total     : ${Object.keys(cache.recipes).length} recipes in cache`);
  console.log('══════════════════════════════\n');
}

main().catch((err) => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
