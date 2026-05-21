'use strict';

// Dumps the raw Notion block tree for a handful of Boho recipes so we
// can see the actual document structure — sections, lists, tables,
// toggles. Read-only.

require('dotenv').config({ path: '/opt/le-garage-recipe-bot/.env' });
const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_TOKEN });

const BOHO_DB = process.env.NOTION_PARENT_BOHO;

function richText(rt) { return (rt || []).map((x) => x.plain_text).join(''); }

async function describeBlock(b, depth) {
  const t = b.type;
  const indent = '  '.repeat(depth);
  let text = '';
  if (b[t]?.rich_text) text = richText(b[t].rich_text);
  else if (t === 'table_row') text = (b.table_row.cells || []).map((c) => richText(c)).join(' | ');
  else if (t === 'image' || t === 'video' || t === 'file' || t === 'embed') text = `(${t} — ${b[t]?.type || 'unknown'})`;
  else if (t === 'divider') text = '---';
  else if (t === 'table') text = `(table ${b.table?.table_width || '?'} cols)`;
  else if (t === 'column_list') text = '(column_list)';
  else if (t === 'column') text = '(column)';
  console.log(`${indent}[${t}] ${text.slice(0, 200)}`);

  if (b.has_children) {
    const kids = await notion.blocks.children.list({ block_id: b.id, page_size: 100 });
    for (const k of kids.results) {
      await describeBlock(k, depth + 1);
    }
  }
}

async function pickRecipe(slugContains) {
  const r = await notion.databases.query({
    database_id: BOHO_DB,
    page_size: 100,
  });
  for (const row of r.results) {
    if ((row.url || '').toLowerCase().includes(slugContains.toLowerCase())) {
      return row;
    }
  }
  return null;
}

(async () => {
  const targets = [
    'Mashed-potatoes',
    'NAPOLEON-CAKE',
    'Chicken-Alfredo-Pasta',
    'Boho-Breakfast',
    'Avocado-Toast',
    'Ceasar-dressing',  // earlier we saw this one specifically
  ];

  for (const slug of targets) {
    const recipe = await pickRecipe(slug);
    if (!recipe) { console.log(`\n══ ${slug} — NOT FOUND in DB`); continue; }
    console.log(`\n══════════════════════════════════════════════════════`);
    console.log(`Recipe URL: ${recipe.url}`);
    console.log(`Page ID:    ${recipe.id}`);
    console.log(`Last edit:  ${recipe.last_edited_time}`);
    console.log(`══════════════════════════════════════════════════════`);
    const top = await notion.blocks.children.list({ block_id: recipe.id, page_size: 100 });
    for (const b of top.results) {
      await describeBlock(b, 0);
    }
  }
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
