'use strict';

const { getFreshFileUrl } = require('./notion');
const { saveFileId, saveCache } = require('./cache');

/**
 * Send a recipe to a Telegram chat: text + photo + video.
 * Handles Telegram's MarkdownV2 quirks by using HTML parse mode instead.
 *
 * @param {import('telegraf').Telegraf} bot
 * @param {string|number} chatId
 * @param {object} recipe  - cache entry { formatted_text, photo_block_id, video_block_id, photo_file_id, video_file_id }
 * @param {string} recipeId - Notion page ID (for saving file_id back to cache)
 * @param {object} cache   - full cache object (mutated + saved after file_id update)
 */
async function sendRecipe(bot, chatId, recipe, recipeId, cache) {
  const { formatted_text, photo_block_id, video_block_id } = recipe;
  let { photo_file_id, video_file_id } = recipe;

  // ── 1. Send recipe text ──────────────────────────────────────────────────
  await bot.telegram.sendMessage(chatId, formatted_text, {
    parse_mode: 'Markdown',
  });

  // ── 2. Send photo ────────────────────────────────────────────────────────
  if (photo_block_id) {
    try {
      let sentPhoto;

      if (photo_file_id) {
        // Use cached Telegram file_id — instant
        sentPhoto = await bot.telegram.sendPhoto(chatId, photo_file_id);
      } else {
        // Fetch fresh URL from Notion (URLs expire after 1h)
        const url = await getFreshFileUrl(photo_block_id);
        if (url) {
          sentPhoto = await bot.telegram.sendPhoto(chatId, { url });
        }
      }

      // Save the returned file_id so next send is instant
      if (sentPhoto && !photo_file_id) {
        const newFileId =
          sentPhoto.photo?.[sentPhoto.photo.length - 1]?.file_id;
        if (newFileId) {
          saveFileId(cache, recipeId, 'photo', newFileId);
          saveCache(cache);
        }
      }
    } catch (err) {
      console.error(`⚠️  Failed to send photo for ${recipeId}:`, err.message);
    }
  }

  // ── 3. Send video ────────────────────────────────────────────────────────
  if (video_block_id) {
    try {
      let sentVideo;

      if (video_file_id) {
        sentVideo = await bot.telegram.sendVideo(chatId, video_file_id);
      } else {
        const url = await getFreshFileUrl(video_block_id);
        if (url) {
          sentVideo = await bot.telegram.sendVideo(chatId, { url });
        }
      }

      if (sentVideo && !video_file_id) {
        const newFileId = sentVideo.video?.file_id;
        if (newFileId) {
          saveFileId(cache, recipeId, 'video', newFileId);
          saveCache(cache);
        }
      }
    } catch (err) {
      console.error(`⚠️  Failed to send video for ${recipeId}:`, err.message);
    }
  }
}

/**
 * Escape special characters for Telegram MarkdownV2.
 * (kept for reference; we use plain Markdown in sendRecipe above)
 */
function escapeMarkdownV2(text) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

module.exports = { sendRecipe, escapeMarkdownV2 };
