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
  // Probe the video block once up front so we know whether it's a
  // Notion-hosted file (sendVideo plays inline) or an external link
  // (YouTube / Vimeo — sendVideo can't ingest those; the kitchen
  // gets a "🎥 Watch Video" inline-keyboard button instead). The
  // probe also gives us the URL to attach to the button without a
  // second Notion call later in sendMedia.
  let probedVideo = null;
  if (recipe.video_block_id && !recipe.video_file_id) {
    try {
      const info = await getFreshFileInfo(recipe.video_block_id);
      if (info?.url) probedVideo = info;
    } catch { /* swallow — sendMedia will retry if it matters */ }
  }

  // Build the inline keyboard: Edit-in-Notion always (when we have
  // a URL), Watch-Video only when the recipe links to an external
  // host. Two buttons side-by-side; one alone takes the full row.
  const row = [];
  if (recipe.url) row.push({ text: '📝 Edit in Notion', url: recipe.url });
  if (probedVideo?.isExternal && probedVideo.url) {
    row.push({ text: '🎥 Watch Video', url: probedVideo.url });
  }
  const reply_markup = row.length ? { inline_keyboard: [row] } : undefined;

  // 1. Recipe text. HTML parse mode is more forgiving than Markdown —
  // only <, >, & need escaping, so stray '_' or '*' from Notion
  // ("٥٠ جرام_") don't trigger parse-entity errors. Preview disabled
  // so any in-text link doesn't unfurl into a giant card.
  try {
    await bot.telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup,
    });
  } catch (err) {
    // Last-ditch fallback: strip HTML so the recipe still arrives
    // even if parsing fails for an unexpected char. Keep the keyboard.
    console.error(`⚠️  HTML send failed for ${recipeId}, falling back to plain:`, err.message);
    const plain = text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    await bot.telegram.sendMessage(chatId, plain, {
      disable_web_page_preview: true,
      reply_markup,
    });
  }

  // 2. Photo
  if (recipe.photo_block_id) {
    await sendMedia(bot, chatId, 'photo', recipe, recipeId, cache);
  }

  // 3. Video — only when it's a Notion-hosted file. External video
  // links are surfaced through the inline keyboard button above, so
  // we don't emit a separate URL message that would unfurl into a
  // big preview card.
  const videoIsExternal = probedVideo?.isExternal === true;
  if (recipe.video_block_id && !videoIsExternal) {
    await sendMedia(bot, chatId, 'video', recipe, recipeId, cache, probedVideo);
  }
}

/**
 * Photo and video share the same flow: try cached file_id first, fall back
 * to a freshly-signed Notion URL, then persist the returned Telegram file_id
 * back to cache so the next send is instant.
 *
 * For video, sendRecipe may pass an already-probed `probedInfo`
 * ({ url, isExternal }) so we don't refetch from Notion. External
 * video URLs are filtered out by sendRecipe before this is reached.
 */
async function sendMedia(bot, chatId, type, recipe, recipeId, cache, probedInfo) {
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
      const info = probedInfo || await getFreshFileInfo(recipe[blockKey]);
      if (!info?.url) return;
      if (info.isExternal) return; // external URLs handled by inline keyboard
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
    // No URL fallback — the inline keyboard already carries an
    // "Edit in Notion" button so the kitchen has a way through.
  }
}

module.exports = { sendRecipe };
