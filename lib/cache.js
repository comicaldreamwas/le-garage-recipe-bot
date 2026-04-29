'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, '..', 'recipes-cache.json');
const CACHE_TMP_PATH = CACHE_PATH + '.tmp';

const EMPTY_CACHE = {
  updated_at: null,
  recipes_text: '',
  recipes: {},
};

/**
 * Load cache from disk. Returns empty cache structure if file doesn't exist.
 */
function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ...EMPTY_CACHE, recipes: {} };
    }
    throw err;
  }
}

/**
 * Save cache to disk atomically (write tmp → rename).
 * This prevents corruption if the process is killed mid-write.
 */
function saveCache(cache) {
  const json = JSON.stringify(cache, null, 2);
  fs.writeFileSync(CACHE_TMP_PATH, json, 'utf8');
  fs.renameSync(CACHE_TMP_PATH, CACHE_PATH);
}

/**
 * Watch cache file for changes and call callback when it changes.
 * Used by bot.js to hot-reload cache after cache-builder runs.
 */
function watchCache(callback) {
  try {
    fs.watch(CACHE_PATH, { persistent: false }, (eventType) => {
      if (eventType === 'change' || eventType === 'rename') {
        // Small delay to let the write fully flush
        setTimeout(() => {
          try {
            const fresh = loadCache();
            callback(fresh);
          } catch (err) {
            console.error('⚠️  Failed to reload cache after file change:', err.message);
          }
        }, 500);
      }
    });
  } catch (err) {
    // Cache file doesn't exist yet; nothing to watch
  }
}

/**
 * Save a Telegram file_id back to cache for a given recipe and media type.
 * type = 'photo' | 'video'
 */
function saveFileId(cache, recipeId, type, fileId) {
  if (!cache.recipes[recipeId]) return;
  const key = type === 'photo' ? 'photo_file_id' : 'video_file_id';
  cache.recipes[recipeId][key] = fileId;
}

module.exports = { loadCache, saveCache, watchCache, saveFileId, CACHE_PATH };
