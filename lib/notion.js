'use strict';

const { Client } = require('@notionhq/client');

let notion;

function getClient() {
  if (!notion) {
    notion = new Client({ auth: process.env.NOTION_TOKEN });
  }
  return notion;
}

/**
 * Fetch all recipe pages from the Notion workspace via /v1/search.
 * Paginates automatically (100 per request). Returns [{ id, url, properties }].
 */
async function fetchAllRecipes() {
  const client = getClient();
  const results = [];
  let cursor = undefined;

  do {
    const response = await client.search({
      filter: { value: 'page', property: 'object' },
      page_size: 100,
      start_cursor: cursor,
    });

    for (const page of response.results) {
      if (page.object === 'page' && page.url) {
        results.push({ id: page.id, url: page.url, properties: page.properties });
      }
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return results;
}

/**
 * Fetch the top-level blocks of a page (paginated).
 */
async function fetchPageBlocks(pageId) {
  const client = getClient();
  const blocks = [];
  let cursor = undefined;

  do {
    const response = await client.blocks.children.list({
      block_id: pageId,
      page_size: 100,
      start_cursor: cursor,
    });
    blocks.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return blocks;
}

/**
 * Fetch children of a single block (toggles, tables, callouts, etc).
 * Notion doesn't include toggle/table children in the parent listing.
 */
async function fetchBlockChildren(blockId) {
  const client = getClient();
  const blocks = [];
  let cursor = undefined;

  do {
    const response = await client.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    });
    blocks.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return blocks;
}

/**
 * Fetch a single block by ID, used to refresh signed file URLs which
 * Notion expires after ~1 hour. We cache the block_id, not the URL.
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
};
