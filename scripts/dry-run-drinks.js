'use strict';

// Phase 2 of v4.2.0 — Drinks dry-run.
// Parses every row of the three DRINK databases THROUGH the existing
// lib/parser.js, in RAM only. Does NOT touch recipes-cache.json.
//
// Drinks DBs (discovered + confirmed in Phase 1):
//   le_garage : El Gouna bar  2ad2c25e-cb5d-81cb-9724-ca67b91f5e68  (70, primary)
//               Cairo bar     2ad2c25e-cb5d-81e5-bede-d6075a989272  (44, fallback)
//   boho      : Boho bar      35d2c25e-cb5d-805c-ad58-e1c72ade31fb  (33)
//
// Output: per-row status, per-DB + per-restaurant aggregates, samples,
// and a full payload to C:/tmp/drinks-dry-run.json for later inspection.

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs   = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');
const { fetchPageBlocks } = require(path.resolve(__dirname, '..', 'lib', 'notion'));
const { parseRecipe }     = require(path.resolve(__dirname, '..', 'lib', 'parser'));

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const NOTION_DELAY_MS = 220;
const REPORT_PATH = 'C:/tmp/drinks-dry-run.json';

// label drives parser behaviour: 'Boho' enables the low-structure flag;
// 'El Gouna'/'Cairo' keep the bilingual (————) food-style handling.
const DBS = [
  { key: 'le_garage', role: 'primary',  label: 'El Gouna', id: '2ad2c25e-cb5d-81cb-9724-ca67b91f5e68', menu: 'EL GOUNA BAR' },
  { key: 'le_garage', role: 'fallback', label: 'Cairo',    id: '2ad2c25e-cb5d-81e5-bede-d6075a989272', menu: 'CAIRO BAR' },
  { key: 'boho',      role: 'primary',  label: 'Boho',     id: '35d2c25e-cb5d-805c-ad58-e1c72ade31fb', menu: 'BOHO BAR' },
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function linesOf(t) { return (t || '').split('\n').filter(Boolean); }

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
  const perDb = [];
  const allParsed = [];

  for (const db of DBS) {
    console.log(`\n╔══════════════════════════════════════════════════════════`);
    console.log(`║ ${db.menu}  (${db.label} / ${db.key} / ${db.role})`);
    console.log(`║ ${db.id}`);
    console.log(`╚══════════════════════════════════════════════════════════`);
    const rows = await queryAll(db.id);
    console.log(`Fetched ${rows.length} rows\n`);

    const stat = {
      menu: db.menu, key: db.key, role: db.role, label: db.label, id: db.id,
      total: rows.length,
      ready: 0,        // ingredients in BOTH languages
      ing_any: 0,      // ingredients in at least one language
      with_prep: 0,    // has any prep steps
      empty: 0,        // no ingredients AND no prep
      error: 0,
    };
    const samples = [];

    for (let i = 0; i < rows.length; i++) {
      const page = rows[i];
      const label = `[${String(i + 1).padStart(3)}/${rows.length}]`;
      try {
        await sleep(NOTION_DELAY_MS);
        const blocks = await fetchPageBlocks(page.id);
        const parsed = await parseRecipe({
          id: page.id, url: page.url,
          properties: page.properties || {}, parent: page.parent || {},
          database_id: db.id, database_label: db.label,
          last_edited_time: page.last_edited_time,
        }, blocks);

        const ingEn = linesOf(parsed.ingredients_en);
        const ingAr = linesOf(parsed.ingredients_ar);
        const prEn  = linesOf(parsed.prep_en);
        const prAr  = linesOf(parsed.prep_ar);
        const hasIngEn = ingEn.length > 0, hasIngAr = ingAr.length > 0;
        const hasIng = hasIngEn || hasIngAr;
        const hasPrep = prEn.length > 0 || prAr.length > 0;

        if (hasIngEn && hasIngAr) stat.ready++;
        if (hasIng) stat.ing_any++;
        if (hasPrep) stat.with_prep++;
        if (!hasIng && !hasPrep) stat.empty++;

        let status;
        if (hasIngEn && hasIngAr) status = 'ready';
        else if (hasIng) status = 'partial-ing';
        else if (hasPrep) status = 'prep-only';
        else status = 'EMPTY';

        allParsed.push({
          menu: db.menu, key: db.key, name: parsed.name, status,
          ing_en_n: ingEn.length, ing_ar_n: ingAr.length,
          prep_en_n: prEn.length, prep_ar_n: prAr.length,
          format: parsed.format, low_structure: parsed.low_structure,
          section_headers: parsed.section_headers,
        });

        if (samples.length < 6) {
          samples.push({
            name: parsed.name, status, format: parsed.format,
            ing_en: ingEn.slice(0, 3), ing_ar: ingAr.slice(0, 3),
            prep_en: prEn.slice(0, 2), prep_ar: prAr.slice(0, 2),
            ing_en_n: ingEn.length, ing_ar_n: ingAr.length,
            prep_en_n: prEn.length, prep_ar_n: prAr.length,
          });
        }

        process.stdout.write(`${label} ${status.padEnd(11)} ${String(parsed.name || '').slice(0, 46).padEnd(48)} en=${ingEn.length} ar=${ingAr.length} prep=${prEn.length}/${prAr.length}\n`);
      } catch (err) {
        stat.error++;
        process.stdout.write(`${label} ERROR       ${err.message}\n`);
      }
    }

    perDb.push({ stat, samples });
  }

  // ── Aggregate report ──────────────────────────────────────────────────────
  console.log('\n\n══════════════════════════════════════════════════════════');
  console.log('📊 DRINKS DRY-RUN — PER DATABASE');
  console.log('══════════════════════════════════════════════════════════');
  for (const { stat } of perDb) {
    console.log(`\n${stat.menu}  (${stat.key} / ${stat.role})`);
    console.log(`  Total:          ${stat.total}`);
    console.log(`  ✅ Ready (EN+AR ingredients): ${stat.ready}`);
    console.log(`  🟡 Ingredients (≥1 lang):     ${stat.ing_any}`);
    console.log(`  🍳 With prep steps:           ${stat.with_prep}`);
    console.log(`  🔴 Empty:                     ${stat.empty}`);
    console.log(`  ❌ Errors:                    ${stat.error}`);
  }

  // Per-restaurant rollup
  const byRest = {};
  for (const { stat } of perDb) {
    const r = byRest[stat.key] || (byRest[stat.key] = { total: 0, ready: 0, ing_any: 0, with_prep: 0, empty: 0, error: 0 });
    for (const k of ['total', 'ready', 'ing_any', 'with_prep', 'empty', 'error']) r[k] += stat[k];
  }
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('📊 PER RESTAURANT (merged, pre-dedupe)');
  console.log('══════════════════════════════════════════════════════════');
  for (const [k, r] of Object.entries(byRest)) {
    console.log(`\n${k}:  total=${r.total}  ready=${r.ready}  ing_any=${r.ing_any}  with_prep=${r.with_prep}  empty=${r.empty}  err=${r.error}`);
  }

  // ── Samples ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('📋 SAMPLES (up to 6 per database)');
  console.log('══════════════════════════════════════════════════════════');
  for (const { stat, samples } of perDb) {
    console.log(`\n──── ${stat.menu} ────`);
    samples.forEach((s, i) => {
      console.log(`\n${i + 1}. ${s.name}   [${s.status}, format=${s.format}]`);
      console.log(`   ING EN (${s.ing_en_n}): ${s.ing_en.join('  |  ') || '—'}`);
      console.log(`   ING AR (${s.ing_ar_n}): ${s.ing_ar.join('  |  ') || '—'}`);
      if (s.prep_en_n || s.prep_ar_n) {
        console.log(`   PREP EN (${s.prep_en_n}): ${s.prep_en.join('  |  ') || '—'}`);
        console.log(`   PREP AR (${s.prep_ar_n}): ${s.prep_ar.join('  |  ') || '—'}`);
      }
    });
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify({ perDb, allParsed }, null, 2));
  console.log(`\n\nFull report: ${REPORT_PATH}`);
  console.log('NO cache writes performed. ✅');
})().catch((e) => { console.error('💥', e.stack || e.message); process.exit(1); });
