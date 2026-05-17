'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { Client } = require('@notionhq/client');

const MASTER_PARENT_ID_RAW = '24e30eca-90bc-80de-8c59-e3c7db23fb60';

function dashed(id) {
  return id.replace(/-/g, '').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function countRows(databaseId) {
  let count = 0;
  let cursor;
  do {
    const res = await notion.databases.query({ database_id: databaseId, page_size: 100, start_cursor: cursor });
    count += res.results.length;
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return count;
}

async function listAllDatabases() {
  const out = [];
  let cursor;
  do {
    const res = await notion.search({
      filter: { value: 'database', property: 'object' },
      page_size: 100,
      start_cursor: cursor,
    });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function listChildPagesOf(pageId) {
  const out = [];
  let cursor;
  try {
    do {
      const res = await notion.blocks.children.list({ block_id: pageId, page_size: 100, start_cursor: cursor });
      for (const b of res.results) {
        if (b.type === 'child_page') {
          out.push({ id: b.id, title: b.child_page?.title || '(no title)' });
        } else if (b.type === 'child_database') {
          out.push({ id: b.id, title: b.child_database?.title || '(database)', isDb: true });
        }
      }
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
  } catch (e) {
    return { error: e.message };
  }
  return out;
}

(async () => {
  console.log('📂 SCANNING NOTION WORKSPACE FOR RESTAURANTS\n');

  // ──── 1. Try the master parent ──────────────────────────────────────────
  console.log(`▸ Probing master parent ${MASTER_PARENT_ID_RAW}…`);
  const masterChildren = await listChildPagesOf(MASTER_PARENT_ID_RAW);
  if (Array.isArray(masterChildren)) {
    console.log(`  ✓ accessible — ${masterChildren.length} direct child blocks`);
    for (const c of masterChildren) {
      console.log(`    • ${c.isDb ? '🗄 DB ' : '📄 page'}  ${c.title.padEnd(40)} ${c.id}`);
    }
  } else {
    console.log(`  ✗ inaccessible: ${masterChildren.error}`);
  }
  console.log();

  // ──── 2. List every database the integration can see ────────────────────
  console.log('▸ Enumerating ALL databases shared with the integration…');
  const databases = await listAllDatabases();
  console.log(`  ${databases.length} database(s) visible:\n`);
  for (const db of databases) {
    const title = (db.title || []).map((t) => t.plain_text).join('') || '(no title)';
    const dashId = dashed(db.id);
    let rowCount = '?';
    try { rowCount = await countRows(db.id); } catch {}
    const parent = db.parent?.type === 'page_id'
      ? `page:${dashed(db.parent.page_id)}`
      : db.parent?.type === 'block_id'
        ? `block:${dashed(db.parent.block_id)}`
        : db.parent?.type || 'workspace';
    console.log(`  🗄 ${title}`);
    console.log(`     id      : ${dashId}`);
    console.log(`     parent  : ${parent}`);
    console.log(`     rows    : ${rowCount}`);
    console.log(`     url     : ${db.url}`);
    console.log();
  }

  // ──── 3. List every top-level page the integration can see ──────────────
  console.log('▸ Enumerating Le-Garage-named pages via search…');
  const pagesRes = await notion.search({
    query: 'Le Garage',
    filter: { value: 'page', property: 'object' },
    page_size: 50,
  });
  const lg = pagesRes.results.filter((p) => {
    const title = (p.properties?.title?.title || []).map((t) => t.plain_text).join('')
               || (p.properties?.Name?.title || []).map((t) => t.plain_text).join('')
               || '';
    return /le\s*garage/i.test(title) && p.parent?.type !== 'database_id';
  });
  console.log(`  ${lg.length} page(s) named "Le Garage…" (not database rows):\n`);
  for (const p of lg.slice(0, 20)) {
    const title = (p.properties?.title?.title || p.properties?.Name?.title || [])
      .map((t) => t.plain_text).join('') || '(no title)';
    console.log(`  📄 ${title}`);
    console.log(`     id  : ${p.id}`);
    console.log(`     url : ${p.url}`);
    console.log();
  }

  // ──── 4. Summary recommendation ─────────────────────────────────────────
  const cairoDb = databases.find((db) => {
    const t = (db.title || []).map((x) => x.plain_text).join('').toLowerCase();
    return t.includes('cairo');
  });
  const gounaDb = databases.find((db) => {
    const t = (db.title || []).map((x) => x.plain_text).join('').toLowerCase();
    return t.includes('gouna') || t.includes('el gouna');
  });

  console.log('═══════════════════════════════════════════');
  console.log('📋 RECOMMENDED .env ENTRIES');
  console.log('═══════════════════════════════════════════');
  if (cairoDb) {
    console.log(`NOTION_PARENT_CAIRO=${dashed(cairoDb.id)}`);
  } else {
    console.log('# NOTION_PARENT_CAIRO=<paste Cairo database id from above>');
  }
  if (gounaDb) {
    console.log(`NOTION_PARENT_EL_GOUNA=${dashed(gounaDb.id)}`);
  } else {
    console.log('# NOTION_PARENT_EL_GOUNA=<paste El Gouna database id from above>');
  }
  console.log();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
