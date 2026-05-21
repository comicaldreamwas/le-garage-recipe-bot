'use strict';

// Phase 1 of v4.0.0 Boho integration.
// Read-only exploration: discover the Boho parent (database or page),
// count recipes, and print a couple of sample pages so the owner can
// confirm we're targeting the right node before any parsing work begins.

require('dotenv').config({ path: '/opt/le-garage-recipe-bot/.env' });
const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_TOKEN });

function nameOf(obj) {
  const props = obj.properties || {};
  for (const k of Object.keys(props)) {
    if (props[k].type === 'title') {
      return (props[k].title || []).map((x) => x.plain_text).join('') || '(empty)';
    }
  }
  if (obj.title) return (obj.title || []).map((x) => x.plain_text).join('') || '(empty)';
  return '(no title)';
}

(async () => {
  console.log('🔍 Searching Notion for "Boho" (pages + databases)…\n');

  // 1. Search PAGES
  const pageHits = [];
  let cursor;
  do {
    const r = await notion.search({
      query: 'Boho',
      filter: { property: 'object', value: 'page' },
      start_cursor: cursor,
      page_size: 100,
    });
    pageHits.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);

  // 2. Search DATABASES
  const dbHits = [];
  cursor = undefined;
  do {
    const r = await notion.search({
      query: 'Boho',
      filter: { property: 'object', value: 'database' },
      start_cursor: cursor,
      page_size: 100,
    });
    dbHits.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);

  console.log(`✅ Pages matching "Boho": ${pageHits.length}`);
  console.log(`✅ Databases matching "Boho": ${dbHits.length}\n`);

  // ── DATABASES first (most likely the recipe source) ─────────────────────────
  console.log('━━━━━━━ DATABASES ━━━━━━━');
  for (const d of dbHits) {
    const title = (d.title || []).map((x) => x.plain_text).join('') || '(no title)';
    console.log('---');
    console.log(`DB Title  : ${title}`);
    console.log(`DB ID     : ${d.id}`);
    console.log(`URL       : ${d.url}`);
    console.log(`Parent    : ${d.parent?.type} -> ${d.parent?.page_id || d.parent?.workspace || ''}`);

    // Count rows
    let count = 0;
    let dbCursor;
    do {
      const q = await notion.databases.query({
        database_id: d.id,
        page_size: 100,
        start_cursor: dbCursor,
      });
      count += q.results.length;
      dbCursor = q.has_more ? q.next_cursor : undefined;
    } while (dbCursor);
    console.log(`Rows      : ${count}`);

    // Sample first 3 rows
    const sample = await notion.databases.query({ database_id: d.id, page_size: 3 });
    for (const row of sample.results) {
      console.log(`   • ${nameOf(row)}  →  ${row.url}`);
    }
  }

  // ── Group pages by parent so we see hierarchy ──────────────────────────────
  console.log('\n━━━━━━━ PAGES — TOP-LEVEL (parent = workspace/page) ━━━━━━━');
  const topLevel = pageHits.filter((p) => p.parent?.type === 'workspace');
  for (const p of topLevel) {
    console.log('---');
    console.log(`Title : ${nameOf(p)}`);
    console.log(`ID    : ${p.id}`);
    console.log(`URL   : ${p.url}`);
  }

  console.log('\n━━━━━━━ PAGES — children of a Boho top page ━━━━━━━');
  const byParent = {};
  for (const p of pageHits) {
    if (p.parent?.type === 'page_id') {
      const pid = p.parent.page_id;
      if (!byParent[pid]) byParent[pid] = [];
      byParent[pid].push(p);
    }
  }
  for (const [parentId, kids] of Object.entries(byParent)) {
    if (kids.length < 2) continue; // skip parents with just one child
    let parentTitle = '(unknown parent)';
    try {
      const p = await notion.pages.retrieve({ page_id: parentId });
      parentTitle = nameOf(p);
    } catch { /* ignore */ }
    console.log(`\nParent: ${parentTitle}  (${parentId})  — ${kids.length} children`);
    for (const k of kids.slice(0, 5)) console.log(`   • ${nameOf(k)}`);
    if (kids.length > 5) console.log(`   … +${kids.length - 5} more`);
  }

  // ── Distinct parent databases of all pages with "Boho" in name/match ───────
  console.log('\n━━━━━━━ DISTINCT DB-PARENTS of matched pages ━━━━━━━');
  const dbParents = new Set();
  for (const p of pageHits) {
    if (p.parent?.type === 'database_id') dbParents.add(p.parent.database_id);
  }
  for (const dbId of dbParents) {
    try {
      const d = await notion.databases.retrieve({ database_id: dbId });
      const title = (d.title || []).map((x) => x.plain_text).join('') || '(no title)';
      console.log(`• ${title}  (${dbId})`);
    } catch (e) {
      console.log(`• ${dbId}  — (could not fetch: ${e.message})`);
    }
  }

  console.log('\n━━━━━━━ DONE ━━━━━━━');
  console.log('Pick the right ID and put it in .env as:  NOTION_PARENT_BOHO=<id>');
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
