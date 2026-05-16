'use strict';

const { getFreshFileUrl } = require('./notion');
const { saveFileId, saveCache } = require('./cache');

/**
 * Send a recipe to a Telegram chat: text + photo + video.
 *
 * @param {import('telegraf').Telegraf} bot
 * @param {string|number} chatId
 * @param {string} text - already formatted via lib/format.js
 * @param {object} recipe - cache entry for this recipe
 * @param {string} recipeId - Notion page ID (used to persist file_id back to cache)
 * @param {object} cache - full cache object, mutated then saved after file_id update
 */
async function sendRecipe(bot, chatId, text, recipe, recipeId, cache) {
  // 1. Recipe text
  await bot.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });

  // 2. Photo
  if (recipe.photo_block_id) {
    await sendMedia(bot, chatId, 'photo', recipe, recipeId, cache);
  }

  // 3. Video
  if (recipe.video_block_id) {
    await sendMedia(bot, chatId, 'video', recipe, recipeId, cache);
  }
}

/**
 * Photo and video share the same flow: try cached file_id first, fall back
 * to a freshly-signed Notion URL, then persist the returned Telegram file_id
 * back to cache so the next send is instant.
 */
async function sendMedia(bot, chatId, type, recipe, recipeId, cache) {
  const blockKey = `${type}_block_id`;
  const fileIdKey = `${type}_file_id`;
  const sendFn = type === 'photo'
    ? bot.telegram.sendPhoto.bind(bot.telegram)
    : bot.telegram.sendVideo.bind(bot.telegram);

  try {
    let sent;
    if (recipe[fileIdKey]) {
      sent = await sendFn(chatId, recipe[fileIdKey]);
    } else {
      const url = await getFreshFileUrl(recipe[blockKey]);
      if (!url) return;
      sent = await sendFn(chatId, { url });
    }

    if (!sent || recipe[fileIdKey]) return;

    // Extract the Telegram file_id from the response and persist it.
    let newFileId;
    if (type === 'photo') {
      const sizes = sent.photo || [];
      newFileId = sizes[sizes.length - 1]?.file_id;
    } else {
      newFileId = sent.video?.file_id;
    }

    if (newFileId) {
      saveFileId(cache, recipeId, type, newFileId);
      saveCache(cache);
    }
  } catch (err) {
    console.error(`⚠️  Failed to send ${type} for ${recipeId}:`, err.message);
  }
}

module.exports = { sendRecipe };
