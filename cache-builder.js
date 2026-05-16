'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { fetchAllRecipes, fetchPageBlocks } = require('./lib/notion');
const { parseRecipe, missingFields, missingCritical, isEmpty, isComplete, isReady, isUsable } = require('./lib/parser');
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

/**
 * Normalize a Notion URL slug into a dedupe key. Strips the trailing
 * 32-char page ID, lowercases, removes punctuation. Two pages with
 * identical canonical slugs (one in El Gouna, one in Cairo) collapse
 * to the same key.
 *
 *   /MUSHROOM-SAUCE-2ad2c25e... → "mushroomsauce"
 *   /Mushroom-sauce-3fd2c25e... → "mushroomsauce"
 */
function slugKey(url) {
  try {
    const path = new URL(url).pathname.split('/').pop() || '';
    const cleaned = path.replace(/-?[0-9a-f]{32}$/i, '');
    return cleaned.toLowerCase().replace(/[^a-z0-9]/g, '');
  } catch {
    return '';
  }
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
  const allPages = await fetchAllRecipes();
  console.log(`✅ Found ${allPages.length} pages in Notion\n`);

  // ── Dedupe across databases ────────────────────────────────────────────
  // Pages are already ordered: El Gouna (primary) first, then Cairo.
  // We keep the first occurrence of each normalized slug and skip the
  // rest so the kitchen sees one canonical version per dish.
  const seenSlugs = new Map(); // slug → label that first held it
  const pages = [];
  const duplicatesDropped = [];
  for (const page of allPages) {
    const slug = slugKey(page.url);
    if (slug && seenSlugs.has(slug)) {
      duplicatesDropped.push({
        slug,
        from: page.database_label,
        kept: seenSlugs.get(slug),
        url: page.url,
      });
      continue;
    }
    if (slug) seenSlugs.set(slug, page.database_label || '?');
    pages.push(page);
  }

  if (duplicatesDropped.length) {
    console.log(`🔁 Deduplicated: ${duplicatesDropped.length} duplicates skipped`);
    for (const d of duplicatesDropped.slice(0, 10)) {
      console.log(`   • ${d.slug} (kept ${d.kept}, dropped ${d.from})`);
    }
    if (duplicatesDropped.length > 10) {
      console.log(`   • …and ${duplicatesDropped.length - 10} more`);
    }
    console.log('');
  }

  // Also drop entries from the cache that match a slug we no longer want
  // (e.g. a Cairo copy that was previously cached before dedupe existed).
  const validIds = new Set(pages.map((p) => p.id));
  for (const id of Object.keys(cache.recipes)) {
    if (!validIds.has(id)) delete cache.recipes[id];
  }

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
      } else if (isReady(stored)) {
        // Has ingredients in BOTH languages — the only thing the
        // kitchen actually needs. prep / photo / video are bonuses.
        const extra = [];
        if (!stored.prep_en) extra.push('prep_en');
        if (!stored.prep_ar) extra.push('prep_ar');
        if (!stored.photo_block_id) extra.push('photo');
        if (!stored.video_block_id) extra.push('video');
        const tag = extra.length ? ` (no ${extra.join(', ')})` : '';
        console.log(`${progress} ✅ ${stored.name}${tag}`);
        completeCount++;
      } else {
        const miss = missingCritical(stored).join(', ');
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
  // Critical list = empty pages + pages missing one or both ingredient
  // languages. Other gaps (prep/photo/video) are nice-to-have and not
  // included in the punch list.
  const broken = processed
    .filter((r) => isEmpty(r) || missingCritical(r).length)
    .map((r) => ({ recipe: r, miss: isEmpty(r) ? ['ALL FIELDS'] : missingCritical(r) }));

  const lines = ['=== RECIPES MISSING INGREDIENTS ===', `Generated: ${new Date().toISOString()}`, ''];
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

  // "Ready" = both ingredient languages present. The bot's actual
  // success metric — prep/photo/video are optional.
  const readyCount = processed.filter((r) => isReady(r)).length;
  const usableOnlyOne = processed.filter((r) => isUsable(r) && !isReady(r)).length;
  const missingAllIng = processed.filter((r) => !isUsable(r) && !isEmpty(r)).length;

  console.log('\n═══════════════════════════════════');
  console.log('📊 CACHE BUILD REPORT');
  console.log('═══════════════════════════════════');
  console.log(`Total recipes        : ${total}`);
  console.log(`🍳 Ready (EN+AR ing) : ${readyCount} (${pct(readyCount)}%)`);
  console.log(`🟡 One language only : ${usableOnlyOne} (${pct(usableOnlyOne)}%)`);
  console.log(`🔴 Missing ingredients: ${missingAllIng} (${pct(missingAllIng)}%)`);
  console.log(`⚠️  Empty (title only): ${empty} (${pct(empty)}%)`);
  console.log(`⏭  Skipped           : ${skipped}`);
  console.log(`❌ Failed            : ${failed}`);
  console.log(`📦 Cache total       : ${cacheSize}`);

  if (counts.ingredients_en || counts.ingredients_ar || counts.allEmpty) {
    console.log('\n🔴 CRITICAL — ingredients to add in Notion:');
    if (counts.ingredients_en) console.log(`  - ${counts.ingredients_en} recipes missing ingredients_en`);
    if (counts.ingredients_ar) console.log(`  - ${counts.ingredients_ar} recipes missing ingredients_ar`);
    if (counts.allEmpty)       console.log(`  - ${counts.allEmpty} recipes are completely empty`);
    console.log(`\nSee ${REPORT_PATH} for full list with Notion URLs`);
  }

  if (counts.prep_en || counts.prep_ar || counts.photo || counts.video) {
    console.log('\n🟢 Nice-to-have gaps (not blocking):');
    if (counts.prep_en) console.log(`  - ${counts.prep_en} recipes missing prep_en`);
    if (counts.prep_ar) console.log(`  - ${counts.prep_ar} recipes missing prep_ar`);
    if (counts.photo)   console.log(`  - ${counts.photo} recipes missing photo`);
    if (counts.video)   console.log(`  - ${counts.video} recipes missing video`);
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
