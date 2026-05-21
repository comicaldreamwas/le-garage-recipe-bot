'use strict';

// Phase 2 of v4.0.0 Boho integration.
// Parses every page of the Boho Cafe Notion database THROUGH the existing
// lib/parser.js — but ONLY in RAM. Does NOT touch recipes-cache.json.
//
// Output:
//   - per-recipe progress to stdout
//   - aggregate stats at the end
//   - full payload to /tmp/boho-dry-run.json so we can re-inspect later

require('dotenv').config({ path: '/opt/le-garage-recipe-bot/.env' });
const fs   = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');
const { fetchPageBlocks } = require(path.resolve('/opt/le-garage-recipe-bot/lib/notion'));
const { parseRecipe }     = require(path.resolve('/opt/le-garage-recipe-bot/lib/parser'));

const BOHO_DB = process.env.NOTION_PARENT_BOHO;
if (!BOHO_DB) { console.error('NOTION_PARENT_BOHO not set in .env'); process.exit(1); }
console.log(`Boho DB: ${BOHO_DB}\n`);

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const NOTION_DELAY_MS = 250;
const REPORT_PATH = '/tmp/boho-dry-run.json';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function linesOf(text) { return (text || '').split('\n').filter(Boolean); }

(async () => {
  // 1. Fetch all 132 pages
  console.log('🔍 Fetching Boho database pages…');
  const pages = [];
  let cursor;
  do {
    const r = await notion.databases.query({
      database_id: BOHO_DB,
      page_size: 100,
      start_cursor: cursor,
    });
    pages.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  console.log(`✅ Fetched ${pages.length} pages\n`);

  const stats   = { total: pages.length, complete: 0, incomplete: 0, empty: 0, error: 0 };
  const samples = [];
  const errors  = [];
  const allParsed = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const url  = page.url || '(no url)';
    const label = `[${String(i + 1).padStart(3)}/${pages.length}]`;

    try {
      await sleep(NOTION_DELAY_MS);
      const blocks = await fetchPageBlocks(page.id);
      const parsed = await parseRecipe({
        id:               page.id,
        url:              page.url,
        properties:       page.properties || {},
        parent:           page.parent     || {},
        database_id:      BOHO_DB,
        database_label:   'Boho',
        last_edited_time: page.last_edited_time,
      }, blocks);

      const hasIngEn = !!parsed.ingredients_en;
      const hasIngAr = !!parsed.ingredients_ar;
      const hasIng   = hasIngEn || hasIngAr;
      const hasPrep  = !!parsed.prep_en || !!parsed.prep_ar;

      let status;
      if (hasIng && hasPrep) status = 'complete';
      else if (hasIng || hasPrep) status = 'incomplete';
      else status = 'empty';
      stats[status]++;

      const ingEn = linesOf(parsed.ingredients_en);
      const ingAr = linesOf(parsed.ingredients_ar);
      const prEn  = linesOf(parsed.prep_en);
      const prAr  = linesOf(parsed.prep_ar);

      allParsed.push({
        id:    page.id,
        url:   page.url,
        name:  parsed.name,
        status,
        ing_en_n: ingEn.length, ing_ar_n: ingAr.length,
        prep_en_n: prEn.length, prep_ar_n: prAr.length,
      });

      // First 10 COMPLETE for visual confirm
      if (status === 'complete' && samples.length < 10) {
        samples.push({
          name: parsed.name,
          url:  page.url,
          ing_en_n: ingEn.length, first_ing_en: ingEn[0] || '',
          ing_ar_n: ingAr.length, first_ing_ar: ingAr[0] || '',
          prep_en_n: prEn.length, first_prep_en: prEn[0] || '',
          prep_ar_n: prAr.length, first_prep_ar: prAr[0] || '',
        });
      }

      process.stdout.write(`${label} ${status.padEnd(10)} ${String(parsed.name || '').slice(0, 50).padEnd(52)}\n`);
    } catch (err) {
      stats.error++;
      errors.push({ url, id: page.id, error: err.message });
      process.stdout.write(`${label} ERROR      ${err.message}\n`);
    }
  }

  // Report
  console.log('\n══════════════════════════');
  console.log('📊 BOHO DRY-RUN STATS');
  console.log('══════════════════════════');
  console.log(`Total:      ${stats.total}`);
  console.log(`✅ Complete: ${stats.complete}`);
  console.log(`🟡 Incomplete: ${stats.incomplete}`);
  console.log(`🔴 Empty:    ${stats.empty}`);
  console.log(`❌ Errors:   ${stats.error}`);

  console.log('\n══════════════════════════');
  console.log('📋 SAMPLE 10 COMPLETE');
  console.log('══════════════════════════');
  samples.forEach((s, i) => {
    console.log(`\n${i + 1}. ${s.name}`);
    console.log(`   URL: ${s.url}`);
    console.log(`   EN ing: ${s.ing_en_n} lines | first: "${s.first_ing_en.slice(0, 80)}"`);
    console.log(`   AR ing: ${s.ing_ar_n} lines | first: "${s.first_ing_ar.slice(0, 80)}"`);
    console.log(`   EN prep: ${s.prep_en_n} steps | first: "${s.first_prep_en.slice(0, 80)}"`);
    console.log(`   AR prep: ${s.prep_ar_n} steps | first: "${s.first_prep_ar.slice(0, 80)}"`);
  });

  if (errors.length > 0) {
    console.log('\n══════════════════════════');
    console.log('❌ ERRORS (first 5)');
    console.log('══════════════════════════');
    errors.slice(0, 5).forEach((e) => console.log(`  ${e.url}\n    → ${e.error}`));
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify({ stats, samples, errors, allParsed }, null, 2));
  console.log(`\nFull report: ${REPORT_PATH}`);
  console.log('NO cache writes performed.');
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
