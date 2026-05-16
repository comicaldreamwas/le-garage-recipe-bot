'use strict';

const { Client } = require('@notionhq/client');

// The Notion integration token has access to several restaurant databases:
//   - Boho Cafe menu       (2ad2c25e-cb5d-812a-bc52-f3eb7111add6)
//   - Le Garage El Gouna   (2ad2c25e-cb5d-8149-8303-f983d1aebced)
//   - Le Garage Menu Cairo (2ad2c25e-cb5d-8134-b661-e0323e39fb72)
//
// Recipes live as rows inside these databases (parent.type = 'database_id').
// By default we include both Le Garage locations and exclude Boho.
// Override via NOTION_DATABASE_IDS (comma-separated) in .env.
const DEFAULT_DATABASE_IDS = [
  '2ad2c25e-cb5d-8134-b661-e0323e39fb72', // Le Garage Menu Cairo
  '2ad2c25e-cb5d-8149-8303-f983d1aebced', // Le Garage El Gouna
];

const ALLOWED_DATABASE_IDS = (process.env.NOTION_DATABASE_IDS || DEFAULT_DATABASE_IDS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(normalizeId);

let notion;
function getClient() {
  if (!notion) notion = new Client({ auth: process.env.NOTION_TOKEN });
  return notion;
}

function normalizeId(id) {
  return (id || '').replace(/-/g, '').toLowerCase();
}

/**
 * True if the page is a direct row of one of the allowed restaurant
 * databases. Pages that live in subpages of database rows would be
 * filtered out — recipes are flat rows in these databases.
 */
function isAllowedRecipe(page) {
  const parent = page.parent;
  if (!parent || parent.type !== 'database_id') return false;
  return ALLOWED_DATABASE_IDS.includes(normalizeId(parent.database_id));
}

/**
 * Fetch all recipe pages from Notion, filter to the allowed databases,
 * and log the breakdown so it's easy to verify the filter is active.
 */
async function fetchAllRecipes() {
  const client = getClient();
  const allPages = [];
  let cursor;

  do {
    const response = await client.search({
      filter: { value: 'page', property: 'object' },
      page_size: 100,
      start_cursor: cursor,
    });
    for (const page of response.results) {
      if (page.object === 'page' && page.url) {
        allPages.push({
          id: page.id,
          url: page.url,
          properties: page.properties,
          parent: page.parent,
        });
      }
    }
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  const kept = allPages.filter(isAllowedRecipe);
  const skipped = allPages.length - kept.length;

  console.log(`🔍 Fetched ${allPages.length} pages from Notion total`);
  console.log(`✅ ${kept.length} belong to allowed databases (Le Garage)`);
  console.log(`⏭️  ${skipped} skipped (other restaurants / nested pages)`);
  console.log(`   Allowed DBs: ${ALLOWED_DATABASE_IDS.join(', ')}`);

  return kept;
}

async function fetchPageBlocks(pageId) {
  const client = getClient();
  const blocks = [];
  let cursor;
  do {
    const response = await client.blocks.children.list({
      block_id: pageId, page_size: 100, start_cursor: cursor,
    });
    blocks.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

async function fetchBlockChildren(blockId) {
  const client = getClient();
  const blocks = [];
  let cursor;
  do {
    const response = await client.blocks.children.list({
      block_id: blockId, page_size: 100, start_cursor: cursor,
    });
    blocks.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

async function getFreshFileUrl(blockId) {
  const client = getClient();
  const block = await client.blocks.retrieve({ block_id: blockId });
  const data = block[block.type];
  if (data?.file?.url) return data.file.url;
  if (data?.external?.url) return data.external.url;
  return null;
}

module.exports = {
  fetchAllRecipes,
  fetchPageBlocks,
  fetchBlockChildren,
  getFreshFileUrl,
  ALLOWED_DATABASE_IDS,
};
