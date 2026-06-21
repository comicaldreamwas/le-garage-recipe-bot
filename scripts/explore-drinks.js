'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 of v4.2.0 — Drinks integration.
// Read-only exploration: find the Notion databases / pages that hold drinks
// (cocktails / beverages) for each restaurant, count them, sample a few, and
// group by restaurant via the parent chain so Anton can confirm which node is
// "primary" for Le Garage vs Boho before any parsing work begins.
//
// Nothing is written to the cache or to Notion. Safe to run repeatedly.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// Known FOOD database parents (from .env on VPS / lib/notion.js defaults).
// Used to (a) recognise restaurants by parent chain and (b) flag a drinks node
// that happens to live *inside* one of these instead of standing alone.
const KNOWN = {
  '2ad2c25ecb5d8134b661e0323e39fb72': 'Le Garage / Cairo (food DB)',
  '2ad2c25ecb5d81498303f983d1aebced': 'Le Garage / El Gouna (food DB)',
  '2ad2c25ecb5d812abc52f3eb7111add6': 'Boho (food DB)',
};

// Drink-related search terms across the languages used in this workspace.
const TERMS = ['drink', 'drinks', 'cocktail', 'cocktails', 'beverage', 'beverages', 'напої', 'مشروبات'];

function norm(id) {
  return (id || '').replace(/-/g, '').toLowerCase();
}
function dashed(id) {
  const n = norm(id);
  return n.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

function titleOf(obj) {
  // Works for both databases (obj.title) and pages (a title-typed property).
  if (Array.isArray(obj.title) && obj.title.length) {
    return obj.title.map((x) => x.plain_text).join('') || '(empty)';
  }
  const props = obj.properties || {};
  for (const k of Object.keys(props)) {
    if (props[k].type === 'title') {
      return (props[k].title || []).map((x) => x.plain_text).join('') || '(empty)';
    }
  }
  return '(no title)';
}

async function searchAll(query, objectType) {
  const out = [];
  let cursor;
  do {
    const r = await notion.search({
      query,
      filter: { property: 'object', value: objectType },
      page_size: 100,
      start_cursor: cursor,
    });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function listAllDatabases() {
  const out = [];
  let cursor;
  do {
    const r = await notion.search({
      filter: { property: 'object', value: 'database' },
      page_size: 100,
      start_cursor: cursor,
    });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function countRows(databaseId) {
  let count = 0;
  let cursor;
  do {
    const r = await notion.databases.query({ database_id: databaseId, page_size: 100, start_cursor: cursor });
    count += r.results.length;
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return count;
}

// Walk parents upward to build a human-readable breadcrumb + detect restaurant.
async function parentChain(obj, depth = 0) {
  const p = obj.parent;
  if (!p || depth > 6) return [];
  if (p.type === 'workspace') return ['workspace'];
  const id = p.page_id || p.database_id || p.block_id;
  if (!id) return [p.type];
  const known = KNOWN[norm(id)];
  let label;
  let nextObj = null;
  try {
    if (p.type === 'database_id') {
      const d = await notion.databases.retrieve({ database_id: id });
      label = `db:${titleOf(d)}`;
      nextObj = d;
    } else {
      // page_id or block_id — retrieve as page (blocks that are child pages work too)
      const pg = await notion.pages.retrieve({ page_id: id }).catch(() => null);
      if (pg) { label = `page:${titleOf(pg)}`; nextObj = pg; }
      else { label = `${p.type}:${dashed(id)}`; }
    }
  } catch {
    label = `${p.type}:${dashed(id)}`;
  }
  if (known) label += `  «${known}»`;
  const up = nextObj ? await parentChain(nextObj, depth + 1) : [];
  return [label, ...up];
}

function looksLikeDrinks(name) {
  return /drink|cocktail|beverage|напо|مشروب|bar\b|juice|smoothie|coffee|tea\b/i.test(name || '');
}

(async () => {
  console.log('🍹  DRINKS EXPLORATION (read-only)\n');
  console.log('Terms:', TERMS.join(', '), '\n');

  // ── 1. Keyword search across pages + databases, deduped ────────────────────
  const hitsById = new Map();
  for (const term of TERMS) {
    for (const objType of ['database', 'page']) {
      let res = [];
      try { res = await searchAll(term, objType); } catch (e) { console.log(`  (search "${term}"/${objType} failed: ${e.message})`); }
      for (const r of res) {
        if (!hitsById.has(r.id)) hitsById.set(r.id, { obj: r, terms: new Set() });
        hitsById.get(r.id).terms.add(term);
      }
    }
  }

  const dbHits = [...hitsById.values()].filter((h) => h.obj.object === 'database');
  const pageHits = [...hitsById.values()].filter((h) => h.obj.object === 'page');

  console.log(`✅ keyword hits — databases: ${dbHits.length}, pages: ${pageHits.length}\n`);

  // ── 2. Enumerate ALL databases (catches drinks DBs whose name is non-EN) ───
  const allDbs = await listAllDatabases();
  console.log(`📊 Integration sees ${allDbs.length} database(s) total. Listing all:\n`);
  console.log('━━━━━━━━━━━━━━━━ ALL DATABASES ━━━━━━━━━━━━━━━━');
  for (const d of allDbs) {
    const title = titleOf(d);
    let rows = '?';
    try { rows = await countRows(d.id); } catch {}
    const chain = await parentChain(d);
    const flag = looksLikeDrinks(title) ? '  🍹 DRINKS?' : '';
    const self = KNOWN[norm(d.id)] ? `  «${KNOWN[norm(d.id)]}»` : '';
    console.log('---');
    console.log(`🗄  ${title}${flag}${self}`);
    console.log(`    id          : ${dashed(d.id)}`);
    console.log(`    rows        : ${rows}`);
    console.log(`    last_edited : ${d.last_edited_time || '?'}`);
    console.log(`    parent      : ${chain.join('  ▸  ') || d.parent?.type}`);
    console.log(`    url         : ${d.url}`);
    if (looksLikeDrinks(title)) {
      try {
        const sample = await notion.databases.query({ database_id: d.id, page_size: 5 });
        for (const row of sample.results) console.log(`      • ${titleOf(row)}`);
      } catch {}
    }
  }

  // ── 3. Keyword-matched PAGES that aren't database rows (standalone pages) ───
  console.log('\n━━━━━━━━━━━━ KEYWORD-MATCHED PAGES ━━━━━━━━━━━━');
  const interestingPages = pageHits.filter((h) => looksLikeDrinks(titleOf(h.obj)));
  if (!interestingPages.length) console.log('  (none whose title looks drink-related)');
  for (const h of interestingPages) {
    const p = h.obj;
    const chain = await parentChain(p);
    console.log('---');
    console.log(`📄  ${titleOf(p)}   [matched: ${[...h.terms].join(', ')}]`);
    console.log(`    id          : ${dashed(p.id)}`);
    console.log(`    parent type : ${p.parent?.type}`);
    console.log(`    last_edited : ${p.last_edited_time || '?'}`);
    console.log(`    parent      : ${chain.join('  ▸  ')}`);
    console.log(`    url         : ${p.url}`);
    // If this standalone page contains child databases/pages, list them — the
    // drinks might be rows inside a DB that sits on this page.
    try {
      const kids = await notion.blocks.children.list({ block_id: p.id, page_size: 100 });
      const childDbs = kids.results.filter((b) => b.type === 'child_database');
      const childPages = kids.results.filter((b) => b.type === 'child_page');
      if (childDbs.length) {
        console.log(`    child DBs   :`);
        for (const c of childDbs) {
          let rows = '?';
          try { rows = await countRows(c.id); } catch {}
          console.log(`      🗄 ${c.child_database?.title || '(db)'}  (${dashed(c.id)})  rows=${rows}`);
        }
      }
      if (childPages.length) {
        console.log(`    child pages : ${childPages.length} (${childPages.slice(0, 6).map((c) => c.child_page?.title).join(', ')})`);
      }
    } catch {}
  }

  console.log('\n━━━━━━━━━━━━━━━━━━ DONE ━━━━━━━━━━━━━━━━━━');
  console.log('Look for nodes flagged 🍹 DRINKS? above and note their id + restaurant.');
})().catch((e) => { console.error('ERR:', e.stack || e.message); process.exit(1); });
