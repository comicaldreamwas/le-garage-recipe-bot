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

  // Inline keyboard: Watch-Video only when the recipe links to an
  // external host (YouTube / Vimeo — sendVideo can't ingest those).
  // The "📝 Edit in Notion" button was removed in v4.1.3: the kitchen
  // doesn't edit Notion from Telegram and the row added visual noise.
  const row = [];
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

  // Hold the signed URL outside the try so the catch can re-use it
  // as a fallback (videos too large for Telegram's 20 MB inline cap).
  let mediaUrl = null;

  try {
    let sent;
    if (recipe[fileIdKey]) {
      try {
        sent = await sendFn(chatId, recipe[fileIdKey]);
      } catch (err) {
        // Telegram file_ids are bot-scoped. When the dedicated Boho
        // process replays a file_id that was originally captured by
        // @resLeGarage_bot (back when it served boho too), Telegram
        // responds with "wrong file identifier". Treat that as a
        // cache-miss: drop the stale id and fall through to the
        // signed-URL path. The next sendFn response will yield a
        // file_id valid for *this* bot, which we then persist below.
        if (/wrong file identifier|file_id/i.test(err.message || '')) {
          console.error(`⚠️  Stale ${type}_file_id for ${recipeId} (cross-bot mismatch) — refetching from Notion`);
          recipe[fileIdKey] = '';
          sent = null;
        } else {
          throw err;
        }
      }
    }
    if (!sent) {
      const info = probedInfo || await getFreshFileInfo(recipe[blockKey]);
      if (!info?.url) return;
      if (info.isExternal) return; // external URLs handled by inline keyboard
      mediaUrl = info.url;
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
    // Telegram's sendVideo via URL caps at ~20 MB; many recipe clips
    // exceed that. When inline playback isn't possible, surface the
    // signed Notion URL through a Watch-Video inline-keyboard button
    // so the kitchen can still open the clip. The URL has a 60-min
    // expiry, which is plenty since the user just sent the query.
    if (type === 'video' && mediaUrl) {
      try {
        await bot.telegram.sendMessage(
          chatId,
          '🎥 <i>Video too large to play inline — tap to watch:</i>',
          {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [[{ text: '🎥 Watch Video', url: mediaUrl }]],
            },
          },
        );
      } catch (e2) {
        // Last-resort fallback if Telegram rejects the button URL
        // (e.g. it's longer than the 1500-char button limit) — send
        // the URL as plain text. disable_web_page_preview keeps it
        // from unfurling into a big card.
        console.error(`⚠️  Watch-Video button failed for ${recipeId}: ${e2.message} — falling back to plain link`);
        try {
          await bot.telegram.sendMessage(chatId, `🎥 ${mediaUrl}`, {
            disable_web_page_preview: true,
          });
        } catch { /* give up */ }
      }
    }
  }
}

module.exports = { sendRecipe };
