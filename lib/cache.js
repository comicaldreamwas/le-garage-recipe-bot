'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, '..', 'recipes-cache.json');
const CACHE_TMP_PATH = CACHE_PATH + '.tmp';

const EMPTY_CACHE = {
  updated_at: null,
  recipes_count: 0,
  recipes: {},
};

/**
 * Load cache from disk. Returns the empty structure if the file doesn't
 * exist yet (first run before cache-builder).
 */
function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.recipes) parsed.recipes = {};
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ...EMPTY_CACHE, recipes: {} };
    }
    throw err;
  }
}

/**
 * Save cache to disk atomically (tmp file + rename) so a kill mid-write
 * can't corrupt the JSON.
 */
function saveCache(cache) {
  cache.recipes_count = Object.keys(cache.recipes || {}).length;
  const json = JSON.stringify(cache, null, 2);
  fs.writeFileSync(CACHE_TMP_PATH, json, 'utf8');
  fs.renameSync(CACHE_TMP_PATH, CACHE_PATH);
}

/**
 * Watch the cache file and invoke callback with the fresh contents
 * when it changes. Used by bot.js to hot-reload after cache-builder runs.
 */
function watchCache(callback) {
  try {
    fs.watch(CACHE_PATH, { persistent: false }, (eventType) => {
      if (eventType !== 'change' && eventType !== 'rename') return;
      // Small delay so the rename + flush completes before we re-read.
      setTimeout(() => {
        try {
          const fresh = loadCache();
          callback(fresh);
        } catch (err) {
          console.error('⚠️  Failed to reload cache after file change:', err.message);
        }
      }, 500);
    });
  } catch {
    // Cache file doesn't exist yet — nothing to watch
  }
}

/**
 * Update the Telegram file_id for a recipe's photo or video so subsequent
 * sends can skip the Notion URL refresh entirely.
 *
 * Callers should saveCache() after this to persist.
 */
function saveFileId(cache, recipeId, type, fileId) {
  const entry = cache.recipes?.[recipeId];
  if (!entry) return;
  const key = type === 'photo' ? 'photo_file_id' : 'video_file_id';
  entry[key] = fileId;
}

module.exports = { loadCache, saveCache, watchCache, saveFileId, CACHE_PATH };
