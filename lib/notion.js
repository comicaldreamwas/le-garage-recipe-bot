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
// Order matters: El Gouna is the canonical source (recipes shipped there
// first), Cairo only fills gaps. cache-builder dedupes by slug name and
// keeps the El Gouna copy when both exist.
// Defaults — overridden by NOTION_PARENT_EL_GOUNA / NOTION_PARENT_CAIRO
// or the legacy NOTION_DATABASE_IDS comma-list in .env.
const DEFAULT_EL_GOUNA = '2ad2c25e-cb5d-8149-8303-f983d1aebced';
const DEFAULT_CAIRO    = '2ad2c25e-cb5d-8134-b661-e0323e39fb72';

const EL_GOUNA_ID = process.env.NOTION_PARENT_EL_GOUNA || DEFAULT_EL_GOUNA;
const CAIRO_ID    = process.env.NOTION_PARENT_CAIRO    || DEFAULT_CAIRO;

// Order matters: El Gouna FIRST so cache-builder's slug-dedupe keeps the
// El Gouna copy when the same recipe exists in both restaurants.
const DEFAULT_DATABASE_IDS = [EL_GOUNA_ID, CAIRO_ID];

const DATABASE_LABELS = {
  [normalizeId(EL_GOUNA_ID)]: 'El Gouna',
  [normalizeId(CAIRO_ID)]:    'Cairo',
};

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
        const dbId = page.parent?.database_id
          ? normalizeId(page.parent.database_id)
          : null;
        allPages.push({
          id: page.id,
          url: page.url,
          properties: page.properties,
          parent: page.parent,
          database_id: dbId,
          database_label: dbId ? (DATABASE_LABELS[dbId] || dbId.slice(0, 8)) : null,
        });
      }
    }
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  const kept = allPages.filter(isAllowedRecipe);
  const skipped = allPages.length - kept.length;

  // Sort by the order pages appear in ALLOWED_DATABASE_IDS so the
  // primary database is processed first (matters for dedupe).
  kept.sort((a, b) => {
    const aIdx = ALLOWED_DATABASE_IDS.indexOf(a.database_id);
    const bIdx = ALLOWED_DATABASE_IDS.indexOf(b.database_id);
    return aIdx - bIdx;
  });

  const byDb = {};
  for (const p of kept) {
    const lbl = p.database_label || 'unknown';
    byDb[lbl] = (byDb[lbl] || 0) + 1;
  }

  console.log(`🔍 Fetched ${allPages.length} pages from Notion total`);
  console.log(`✅ ${kept.length} belong to allowed databases (Le Garage)`);
  console.log(`⏭️  ${skipped} skipped (other restaurants / nested pages)`);
  for (const [lbl, count] of Object.entries(byDb)) {
    console.log(`   • ${lbl}: ${count}`);
  }

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

/**
 * Refresh a media block's URL. Returns null when the block has no URL.
 * The legacy string return is preserved for callers that don't care
 * about the source type. New callers can use getFreshFileInfo() to
 * receive an object including `isExternal` so they can fall back to
 * a text link for YouTube/Vimeo videos that Telegram can't ingest.
 */
async function getFreshFileUrl(blockId) {
  const info = await getFreshFileInfo(blockId);
  return info?.url || null;
}

async function getFreshFileInfo(blockId) {
  const client = getClient();
  const block = await client.blocks.retrieve({ block_id: blockId });
  const data = block[block.type];
  if (data?.file?.url) return { url: data.file.url, isExternal: false };
  if (data?.external?.url) return { url: data.external.url, isExternal: true };
  return null;
}

module.exports = {
  fetchAllRecipes,
  fetchPageBlocks,
  fetchBlockChildren,
  getFreshFileUrl,
  getFreshFileInfo,
  ALLOWED_DATABASE_IDS,
};
