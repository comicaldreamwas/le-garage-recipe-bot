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
 * Fetch all recipe pages from Notion workspace using /v1/search.
 * Paginates automatically (100 per request) until all pages are fetched.
 * Returns array of { id, url } objects.
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
        results.push({ id: page.id, url: page.url });
      }
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return results;
}

/**
 * Fetch the top-level blocks of a page.
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
 * Fetch children of a single block (used for toggle/table blocks).
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
 * Fetch a single block by ID to get a fresh (non-expired) file URL.
 */
async function fetchBlock(blockId) {
  const client = getClient();
  return await client.blocks.retrieve({ block_id: blockId });
}

/**
 * Extract plain text from a rich_text array.
 */
function richTextToPlain(richTextArr) {
  if (!richTextArr || !Array.isArray(richTextArr)) return '';
  return richTextArr.map((t) => t.plain_text || '').join('');
}

/**
 * Recursively convert Notion blocks to a plain text string suitable for OpenAI.
 * Resolves children for toggles and tables.
 * Skips "Waiters Training Guide" sections.
 *
 * Returns { text, photoBlockId, videoBlockId }
 */
async function blocksToText(blocks, depth = 0) {
  const lines = [];
  let photoBlockId = null;
  let videoBlockId = null;

  let skipSection = false; // flag to skip Waiters Training Guide

  for (const block of blocks) {
    const type = block.type;
    const data = block[type];

    // Detect Waiters Training Guide heading and skip everything under it
    if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
      const heading = richTextToPlain(data?.rich_text).toLowerCase();
      if (heading.includes('waiters') || heading.includes('waiter')) {
        skipSection = true;
      } else {
        skipSection = false;
        lines.push(`\n### ${richTextToPlain(data?.rich_text)}`);
      }
      continue;
    }

    if (skipSection) continue;

    if (type === 'paragraph') {
      const text = richTextToPlain(data?.rich_text);
      if (text) lines.push(text);

    } else if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
      const text = richTextToPlain(data?.rich_text);
      const prefix = type === 'numbered_list_item' ? '1.' : '-';
      if (text) lines.push(`${'  '.repeat(depth)}${prefix} ${text}`);

    } else if (type === 'toggle') {
      const label = richTextToPlain(data?.rich_text);
      lines.push(`\n[${label}]`);
      // Fetch toggle children (Notion doesn't include them in parent list)
      if (block.has_children) {
        const children = await fetchBlockChildren(block.id);
        const inner = await blocksToText(children, depth + 1);
        lines.push(inner.text);
        if (!photoBlockId && inner.photoBlockId) photoBlockId = inner.photoBlockId;
        if (!videoBlockId && inner.videoBlockId) videoBlockId = inner.videoBlockId;
      }

    } else if (type === 'table') {
      if (block.has_children) {
        const rows = await fetchBlockChildren(block.id);
        for (const row of rows) {
          if (row.type === 'table_row') {
            const cells = row.table_row?.cells || [];
            const rowText = cells.map((cell) => richTextToPlain(cell)).join(' | ');
            lines.push(`| ${rowText} |`);
          }
        }
      }

    } else if (type === 'image') {
      if (!photoBlockId) photoBlockId = block.id;

    } else if (type === 'video') {
      if (!videoBlockId) videoBlockId = block.id;

    } else if (type === 'divider') {
      lines.push('---');

    } else if (type === 'callout') {
      const text = richTextToPlain(data?.rich_text);
      if (text) lines.push(`📌 ${text}`);

    } else if (type === 'quote') {
      const text = richTextToPlain(data?.rich_text);
      if (text) lines.push(`> ${text}`);

    } else if (block.has_children && !skipSection) {
      // Generic block with children — recurse
      const children = await fetchBlockChildren(block.id);
      const inner = await blocksToText(children, depth);
      if (inner.text) lines.push(inner.text);
      if (!photoBlockId && inner.photoBlockId) photoBlockId = inner.photoBlockId;
      if (!videoBlockId && inner.videoBlockId) videoBlockId = inner.videoBlockId;
    }
  }

  return {
    text: lines.filter(Boolean).join('\n'),
    photoBlockId,
    videoBlockId,
  };
}

/**
 * Get a fresh file URL from a block (image or video).
 * Notion signed URLs expire after ~1 hour so we always re-fetch.
 */
async function getFreshFileUrl(blockId) {
  const block = await fetchBlock(blockId);
  const type = block.type;
  const data = block[type];

  if (data?.file?.url) return data.file.url;
  if (data?.external?.url) return data.external.url;
  return null;
}

module.exports = {
  fetchAllRecipes,
  fetchPageBlocks,
  fetchBlockChildren,
  blocksToText,
  getFreshFileUrl,
};
