'use strict';

const { getFreshFileInfo } = require('./notion');
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
  // 1. Recipe text — disable preview so the Notion edit-link footer
  // doesn't unfurl into a giant card under every reply. HTML parse
  // mode is more forgiving than Markdown — only <, >, & need escaping,
  // and stray '_' or '*' in recipe text (e.g. Notion trailing
  // underscores) don't trigger parse-entity errors.
  try {
    await bot.telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (err) {
    // Last-ditch fallback: send as plain text so the recipe still
    // arrives even if HTML parsing fails for some unexpected char.
    console.error(`⚠️  HTML send failed for ${recipeId}, falling back to plain:`, err.message);
    const plain = text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    await bot.telegram.sendMessage(chatId, plain, { disable_web_page_preview: true });
  }

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
      const info = await getFreshFileInfo(recipe[blockKey]);
      if (!info?.url) return;

      // External URLs (YouTube, Vimeo, etc.) can't be ingested by
      // Telegram's sendVideo / sendPhoto — it expects a direct file URL.
      // For videos we fall back to a plain text link so the kitchen
      // can still open the clip in their browser.
      if (info.isExternal && type === 'video') {
        await bot.telegram.sendMessage(chatId, `🎥 <b>Video:</b> ${info.url}`, {
          parse_mode: 'HTML',
        });
        return;
      }

      sent = await sendFn(chatId, { url: info.url });
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
    // For videos that Telegram rejects (e.g. format not supported)
    // also offer the URL as a fallback so the kitchen sees something.
    if (type === 'video') {
      try {
        const info = await getFreshFileInfo(recipe[blockKey]);
        if (info?.url) {
          await bot.telegram.sendMessage(chatId, `🎥 <b>Video:</b> ${info.url}`, {
            parse_mode: 'HTML',
          });
        }
      } catch { /* swallow */ }
    }
  }
}

module.exports = { sendRecipe };
