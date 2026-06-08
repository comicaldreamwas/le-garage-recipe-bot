'use strict';

require('dotenv').config();

const fs = require('fs');
const { Client } = require('@notionhq/client');

const { fetchAllRecipes, fetchPageBlocks } = require('./lib/notion');
const { parseRecipe, missingFields, missingCritical, isEmpty, isReady, isUsable } = require('./lib/parser');
const { loadCache, saveCache } = require('./lib/cache');

const CACHE_STALE_DAYS = 7;
const NOTION_DELAY_MS = 250; // stay under Notion's 3 req/sec rate limit
const REPORT_PATH = '/tmp/recipe-report.txt';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function isFresh(recipe) {
  if (!recipe?.cached_at) return false;
  return Date.now() - new Date(recipe.cached_at).getTime() < CACHE_STALE_DAYS * 24 * 60 * 60 * 1000;
}

function slugKey(url) {
  try {
    const p = new URL(url).pathname.split('/').pop() || '';
    return p.replace(/-?[0-9a-f]{32}$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  } catch { return ''; }
}

function parseArg(name, def) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : def;
}

async function main() {
  if (!process.env.NOTION_TOKEN) {
    console.error('❌ Missing env variable: NOTION_TOKEN');
    process.exit(1);
  }
  const target = parseArg('restaurant', 'all');
  if (!['le_garage', 'boho', 'all'].includes(target)) {
    console.error(`❌ Unknown --restaurant=${target}; use le_garage | boho | all`);
    process.exit(1);
  }

  console.log(`🚀 Cache builder starting — target=${target}\n`);
  const cache = loadCache();
  console.log(`📦 Loaded existing cache: ${Object.keys(cache.le_garage.recipes).length} le_garage + ${Object.keys(cache.boho.recipes).length} boho recipes\n`);

  if (target === 'le_garage' || target === 'all') await buildLeGarage(cache);
  if (target === 'boho'      || target === 'all') await buildBoho(cache);
}

// ─────────────────────────────────────────────────────────────────────────────
// LE GARAGE  (existing logic, untouched except for cache shape)
// ─────────────────────────────────────────────────────────────────────────────

async function buildLeGarage(cache) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🍔 Building Le Garage cache');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const recipes = cache.le_garage.recipes;

  console.log('🔍 Fetching recipe list from Notion...');
  const allPages = await fetchAllRecipes();
  console.log(`✅ Found ${allPages.length} pages in Notion\n`);

  // Dedupe groups by slug
  const slugGroups = new Map();
  for (const page of allPages) {
    const slug = slugKey(page.url);
    if (!slugGroups.has(slug)) slugGroups.set(slug, []);
    slugGroups.get(slug).push(page);
  }

  const pages = [];
  const duplicatesDropped = [];

  function scoreCandidate(parsed) {
    const c = parsed?.completeness || {};
    return (c.has_ingredients_en ? 2 : 0)
         + (c.has_ingredients_ar ? 2 : 0)
         + (c.has_prep_en ? 1 : 0)
         + (c.has_prep_ar ? 1 : 0)
         + (c.has_photo ? 1 : 0)
         + (c.has_video ? 1 : 0);
  }

  for (const [slug, group] of slugGroups) {
    if (!slug || group.length === 1) {
      pages.push(...group);
      continue;
    }
    console.log(`🔁 Resolving ${group.length} copies of '${slug}'…`);
    const scored = [];
    for (const g of group) {
      try {
        await sleep(NOTION_DELAY_MS);
        const blocks = await fetchPageBlocks(g.id);
        const parsed = await parseRecipe(g, blocks);
        scored.push({ page: g, parsed, score: scoreCandidate(parsed) });
      } catch {
        scored.push({ page: g, parsed: null, score: -1 });
      }
    }
    // Recency-primary (matches v3.0.2 behaviour)
    scored.sort((a, b) => {
      const ea = new Date(a.page.last_edited_time || 0).getTime();
      const eb = new Date(b.page.last_edited_time || 0).getTime();
      if (eb !== ea) return eb - ea;
      return b.score - a.score;
    });
    const winner = scored[0];
    pages.push(winner.page);
    winner._parsed = winner.parsed;
    recipes[winner.page.id] = {
      ...winner.parsed,
      photo_file_id: recipes[winner.page.id]?.photo_file_id || '',
      video_file_id: recipes[winner.page.id]?.video_file_id || '',
      cached_at: new Date().toISOString(),
    };
    for (let i = 1; i < scored.length; i++) {
      const loser = scored[i];
      duplicatesDropped.push({ slug, from: loser.page.database_label, kept: winner.page.database_label, score: loser.score, kept_score: winner.score, url: loser.page.url });
    }
    const wEdit = (winner.page.last_edited_time || '').slice(0, 10) || '?';
    const loseInfo = scored.slice(1).map((l) => `${l.page.database_label}@${(l.page.last_edited_time || '').slice(0, 10) || '?'}`).join(', ');
    console.log(`   → kept ${winner.page.database_label}@${wEdit} (score=${winner.score}) over ${loseInfo}`);
  }

  if (duplicatesDropped.length) console.log(`🔁 Deduplicated: ${duplicatesDropped.length} losers dropped\n`);

  // Drop entries that no longer match a slug we want
  const validIds = new Set(pages.map((p) => p.id));
  for (const id of Object.keys(recipes)) if (!validIds.has(id)) delete recipes[id];

  await processPages({
    pages, recipes, cache,
    restaurantSlot: 'le_garage',
    label: '🍔 Le Garage',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BOHO  (single-database, no cross-DB dedupe, low_structure skip baked into parser)
// ─────────────────────────────────────────────────────────────────────────────

async function buildBoho(cache) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('☕ Building Boho cache');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const BOHO_DB = process.env.NOTION_PARENT_BOHO;
  if (!BOHO_DB) {
    console.error('❌ NOTION_PARENT_BOHO not set in .env — skipping Boho build');
    return;
  }
  const notion = new Client({ auth: process.env.NOTION_TOKEN });
  const recipes = cache.boho.recipes;

  console.log('🔍 Fetching Boho database rows...');
  const rows = [];
  let cursor;
  do {
    const r = await notion.databases.query({ database_id: BOHO_DB, page_size: 100, start_cursor: cursor });
    rows.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  console.log(`✅ Found ${rows.length} pages\n`);

  // Wrap raw Notion rows into the same shape fetchAllRecipes returns.
  const pages = rows.map((p) => ({
    id: p.id,
    url: p.url,
    properties: p.properties || {},
    parent: p.parent || {},
    database_id: BOHO_DB,
    database_label: 'Boho',
    last_edited_time: p.last_edited_time,
  }));

  // Drop entries that no longer match a Boho page (cleanup)
  const validIds = new Set(pages.map((p) => p.id));
  for (const id of Object.keys(recipes)) if (!validIds.has(id)) delete recipes[id];

  await processPages({
    pages, recipes, cache,
    restaurantSlot: 'boho',
    label: '☕ Boho Cafe',
  });

  // Post-pass: low_structure pages (Boho Pattern 1, paragraph-only)
  // are kept ONLY if their dish name doesn't already appear in a
  // structured Boho entry. This catches drafts and superseded copies
  // ("Cheesecake mousse" draft vs "CHEESE CAKE MOUSSE" canonical)
  // while keeping legitimately-unique items ("Whipped Cream",
  // "Mashed Potatoes", marinades, stocks, etc.) accessible to the
  // kitchen.
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const structuredNames = new Set();
  for (const r of Object.values(recipes)) {
    if (!r.low_structure && r.name) structuredNames.add(norm(r.name));
  }
  let droppedDup = 0;
  let keptUnique = 0;
  let droppedEmpty = 0;
  for (const [id, r] of Object.entries(recipes)) {
    if (!r.low_structure) continue;
    const n = norm(r.name);
    // No-name drafts (Notion id as fallback name) → drop unconditionally.
    if (!n || /^[0-9a-f]{20,}$/.test(n.replace(/\s/g, ''))) {
      delete recipes[id];
      droppedDup++;
      console.log(`   [boho] drop noname: ${r.url}`);
      continue;
    }
    // Empty content even after Pattern-1 paragraph extraction means the
    // Notion page had no useful body at all. Don't pollute the cache —
    // a "Panna Cotta" with zero ingredients shouldn't outscore the
    // canonical "Breakfast Panna Cotta" in the kitchen's search.
    if (!r.ingredients_en && !r.ingredients_ar) {
      delete recipes[id];
      droppedEmpty++;
      console.log(`   [boho] drop empty Pattern-1: ${r.name}`);
      continue;
    }
    if (structuredNames.has(n)) {
      delete recipes[id];
      droppedDup++;
      console.log(`   [boho] drop duplicate-name: ${r.name}`);
    } else {
      keptUnique++;
      console.log(`   [boho] keep unique Pattern-1: ${r.name}`);
    }
  }
  if (droppedEmpty) console.log(`☕ Boho post-pass: dropped ${droppedEmpty} low_structure with 0 ingredients`);
  console.log(`\n☕ Boho post-pass: kept ${keptUnique} unique Pattern-1, dropped ${droppedDup} duplicates/no-name`);
  console.log(`☕ Boho final cache size: ${Object.keys(recipes).length}`);
  saveCache(cache);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared per-page processing loop
// ─────────────────────────────────────────────────────────────────────────────

async function processPages({ pages, recipes, cache, restaurantSlot, label }) {
  let skipped = 0, failed = 0, emptyCount = 0, completeCount = 0, incompleteCount = 0, skippedLow = 0;
  const processed = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const progress = `[${String(i + 1).padStart(3)}/${pages.length}]`;
    const slugLabel = page.url.split('/').pop().replace(/-[0-9a-f]{32}$/i, '');

    // Skip only if our cache is BOTH young (<7d) AND newer than the page's
    // last Notion edit. Previously we skipped any entry cached <7d ago,
    // which silently dropped edits made within that window — the reason
    // Notion changes didn't surface until the weekly full rebuild. Now an
    // edit (last_edited_time > cached_at) always forces a re-fetch.
    const cachedRec = recipes[page.id];
    const editedSinceCache = cachedRec?.cached_at && page.last_edited_time &&
      new Date(page.last_edited_time).getTime() > new Date(cachedRec.cached_at).getTime();
    if (cachedRec && isFresh(cachedRec) && !editedSinceCache) {
      console.log(`${progress} ⏭  ${cachedRec.name} (fresh)`);
      skipped++;
      processed.push(cachedRec);
      continue;
    }

    try {
      await sleep(NOTION_DELAY_MS);
      const topBlocks = await fetchPageBlocks(page.id);
      const parsed = await parseRecipe(page, topBlocks);

      // Self-verify hashes (catches non-determinism)
      const reparsed = await parseRecipe(page, topBlocks);
      const driftFields = [];
      for (const k of ['name', 'ingredients_en', 'ingredients_ar', 'prep_en', 'prep_ar']) {
        if (parsed.hashes?.[k] !== reparsed.hashes?.[k]) driftFields.push(k);
      }
      if (driftFields.length) console.warn(`         ⚠️  parser non-determinism on ${driftFields.join(',')} — keeping first parse`);

      const previous = recipes[page.id] || {};
      recipes[page.id] = {
        ...parsed,
        photo_file_id: previous.photo_file_id || '',
        video_file_id: previous.video_file_id || '',
        cached_at: new Date().toISOString(),
      };
      const stored = recipes[page.id];
      processed.push(stored);

      if (stored.low_structure) {
        skippedLow++;
        // Already logged by parser via [BOHO SKIP] line.
      } else {
        const media = (stored.photo_block_id ? '📷' : '· ') + (stored.video_block_id ? '🎥' : '· ');
        if (isEmpty(stored)) {
          console.log(`${progress} ⚠️  ${slugLabel} — empty (only title)`);
          emptyCount++;
        } else if (isReady(stored)) {
          const extra = [];
          if (!stored.prep_en) extra.push('prep_en');
          if (!stored.prep_ar) extra.push('prep_ar');
          if (!stored.photo_block_id) extra.push('photo');
          if (!stored.video_block_id) extra.push('video');
          const tag = extra.length ? ` (no ${extra.join(', ')})` : '';
          console.log(`${progress} ✅ ${media} ${stored.name}${tag}`);
          completeCount++;
        } else {
          const miss = missingCritical(stored).join(', ');
          console.log(`${progress} ⚠️  ${media} ${stored.name} — missing: ${miss}`);
          incompleteCount++;
        }
      }

      cache[restaurantSlot].updated_at = new Date().toLocaleString('uk-UA', { timeZone: 'Africa/Cairo' });
      saveCache(cache);
    } catch (err) {
      console.error(`${progress} ❌ ${slugLabel} — ${err.message}`);
      failed++;
    }

    await sleep(NOTION_DELAY_MS);
  }

  cache[restaurantSlot].updated_at = new Date().toLocaleString('uk-UA', { timeZone: 'Africa/Cairo' });
  saveCache(cache);

  printReport({
    label,
    total: pages.length,
    complete: completeCount,
    incomplete: incompleteCount,
    empty: emptyCount,
    skipped,
    skippedLow,
    failed,
    cacheSize: Object.keys(recipes).length,
    processed,
  });

  // Per-restaurant report
  writeReport(processed, restaurantSlot);
}

function writeReport(processed, slot) {
  const broken = processed
    .filter((r) => !r.low_structure && (isEmpty(r) || missingCritical(r).length))
    .map((r) => ({ recipe: r, miss: isEmpty(r) ? ['ALL FIELDS'] : missingCritical(r) }));
  const lines = [`=== ${slot.toUpperCase()} — RECIPES MISSING INGREDIENTS ===`, `Generated: ${new Date().toISOString()}`, ''];
  for (const { recipe, miss } of broken) {
    lines.push(recipe.name || '(no name)');
    lines.push(`URL: ${recipe.url}`);
    lines.push(`Missing: ${miss.join(', ')}`);
    lines.push('---');
  }
  try { fs.writeFileSync(`${REPORT_PATH}.${slot}`, lines.join('\n'), 'utf8'); }
  catch (err) { console.warn(`⚠️  Could not write report: ${err.message}`); }
}

function printReport({ label, total, complete, incomplete, empty, skipped, skippedLow, failed, cacheSize, processed }) {
  const counts = countMissing(processed);
  const pct = (n) => total ? Math.round((n / total) * 100) : 0;
  const ready = processed.filter((r) => !r.low_structure && isReady(r)).length;
  const usableOnlyOne = processed.filter((r) => !r.low_structure && isUsable(r) && !isReady(r)).length;
  const missingAllIng = processed.filter((r) => !r.low_structure && !isUsable(r) && !isEmpty(r)).length;

  console.log(`\n═══════════════════════════════════`);
  console.log(`📊 ${label} BUILD REPORT`);
  console.log(`═══════════════════════════════════`);
  console.log(`Total pages          : ${total}`);
  console.log(`🍳 Ready (EN+AR ing) : ${ready} (${pct(ready)}%)`);
  console.log(`🟡 One language only : ${usableOnlyOne} (${pct(usableOnlyOne)}%)`);
  console.log(`🔴 Missing ingredients: ${missingAllIng} (${pct(missingAllIng)}%)`);
  console.log(`⚠️  Empty (title only): ${empty} (${pct(empty)}%)`);
  console.log(`⏭  Skipped fresh     : ${skipped}`);
  console.log(`⏭  Low-structure skip: ${skippedLow}`);
  console.log(`❌ Failed            : ${failed}`);
  console.log(`📦 Cache slot total  : ${cacheSize}`);
  console.log(`═══════════════════════════════════\n`);
}

function countMissing(processed) {
  const counts = { ingredients_en: 0, ingredients_ar: 0, prep_en: 0, prep_ar: 0, photo: 0, video: 0, allEmpty: 0 };
  for (const r of processed) {
    if (r.low_structure) continue;
    if (isEmpty(r)) { counts.allEmpty++; continue; }
    const miss = missingFields(r);
    for (const f of miss) if (counts[f] !== undefined) counts[f]++;
  }
  return counts;
}

main().catch((err) => { console.error('💥 Fatal error:', err); process.exit(1); });
