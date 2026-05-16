'use strict';

const { Client } = require('@notionhq/client');

// The Notion integration token may have access to several restaurant
// workspaces. We only want recipes that descend from this specific parent
// page (Le Garage Menu Cairo). Switch restaurants by setting
// NOTION_PARENT_ID in .env.
const LE_GARAGE_PARENT_ID = process.env.NOTION_PARENT_ID
  || '24e30eca-90bc-80de-8c59-e3c7db23fb60';

let notion;
function getClient() {
  if (!notion) notion = new Client({ auth: process.env.NOTION_TOKEN });
  return notion;
}

function normalizeId(id) {
  return (id || '').replace(/-/g, '').toLowerCase();
}

const TARGET_ID = normalizeId(LE_GARAGE_PARENT_ID);

/**
 * Walk a page's parent chain (via byId map) and return true if any
 * ancestor matches the Le Garage parent. Stops on workspace_root,
 * database_id, missing parents, or a visited-cycle.
 */
function isDescendantOfLeGarage(page, byId) {
  const visited = new Set();
  let current = page;
  while (current) {
    const parent = current.parent;
    if (!parent || parent.type !== 'page_id') return false;
    const parentId = normalizeId(parent.page_id);
    if (parentId === TARGET_ID) return true;
    if (visited.has(parentId)) return false;
    visited.add(parentId);
    current = byId.get(parentId);
  }
  return false;
}

/**
 * Fetch all recipe pages from Notion, then filter to those that descend
 * from the Le Garage Menu Cairo parent page. Logs both the raw count
 * and the post-filter count so it's easy to confirm the filter works.
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

  // Build id→page map for parent-chain walking. Use the same normalized
  // form we compare against, so dashed/undashed IDs round-trip cleanly.
  const byId = new Map();
  for (const p of allPages) byId.set(normalizeId(p.id), p);

  const kept = allPages.filter((p) => isDescendantOfLeGarage(p, byId));
  const skipped = allPages.length - kept.length;

  console.log(`🔍 Fetched ${allPages.length} pages from Notion total`);
  console.log(`✅ ${kept.length} belong to Le Garage Menu Cairo`);
  console.log(`⏭️  ${skipped} skipped (other restaurants / unrelated pages)`);

  return kept;
}

/**
 * Fetch the top-level blocks of a page (paginated).
 */
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

/**
 * Fetch children of a single block (toggles, tables, callouts).
 */
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

/**
 * Fetch a single block by ID to refresh a signed Notion file URL
 * (they expire after ~1 hour).
 */
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
  LE_GARAGE_PARENT_ID,
};
