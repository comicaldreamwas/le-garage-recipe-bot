'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, '..', 'recipes-cache.json');
const CACHE_TMP_PATH = CACHE_PATH + '.tmp';

const SCHEMA_VERSION = 'v4.0.0';
const RESTAURANTS = ['le_garage', 'boho'];

function emptyRestaurant() {
  return { updated_at: null, recipes_count: 0, recipes: {} };
}

function emptyCache() {
  return {
    version: SCHEMA_VERSION,
    le_garage: emptyRestaurant(),
    boho:      emptyRestaurant(),
  };
}

/**
 * Convert legacy v3 cache (recipes at top level) to v4 multi-restaurant
 * shape. Le Garage owned the whole cache pre-v4, so its recipes move
 * under `le_garage`; the Boho slot is initialised empty.
 */
function migrate(parsed) {
  if (parsed?.version === SCHEMA_VERSION
      && parsed.le_garage?.recipes
      && parsed.boho?.recipes) {
    return parsed;
  }
  // Legacy v3: { updated_at, recipes_count, recipes }
  if (parsed?.recipes && !parsed?.le_garage) {
    return {
      version: SCHEMA_VERSION,
      le_garage: {
        updated_at: parsed.updated_at || null,
        recipes_count: parsed.recipes_count || Object.keys(parsed.recipes).length,
        recipes: parsed.recipes,
      },
      boho: emptyRestaurant(),
    };
  }
  // Partially-formed v4 (one slot missing) — fill the gap.
  const out = {
    version: SCHEMA_VERSION,
    le_garage: parsed?.le_garage || emptyRestaurant(),
    boho:      parsed?.boho      || emptyRestaurant(),
  };
  for (const r of RESTAURANTS) {
    if (!out[r].recipes) out[r].recipes = {};
  }
  return out;
}

function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    return migrate(JSON.parse(raw));
  } catch (err) {
    if (err.code === 'ENOENT') return emptyCache();
    throw err;
  }
}

/**
 * Save the whole v4 cache atomically (tmp file + rename) so a kill
 * mid-write can't corrupt the JSON.
 */
function saveCache(cache) {
  for (const r of RESTAURANTS) {
    if (!cache[r]) cache[r] = emptyRestaurant();
    cache[r].recipes_count = Object.keys(cache[r].recipes || {}).length;
  }
  cache.version = SCHEMA_VERSION;
  fs.writeFileSync(CACHE_TMP_PATH, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(CACHE_TMP_PATH, CACHE_PATH);
}

function getRestaurantRecipes(cache, restaurant) {
  return cache?.[restaurant]?.recipes || {};
}

function watchCache(callback) {
  try {
    fs.watch(CACHE_PATH, { persistent: false }, (eventType) => {
      if (eventType !== 'change' && eventType !== 'rename') return;
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
 * Update the Telegram file_id for a recipe's photo or video. Searches
 * across both restaurant slots so callers don't need to know which
 * one owns the recipe id.
 */
function saveFileId(cache, recipeId, type, fileId) {
  const key = type === 'photo' ? 'photo_file_id' : 'video_file_id';
  for (const r of RESTAURANTS) {
    const entry = cache?.[r]?.recipes?.[recipeId];
    if (entry) { entry[key] = fileId; return; }
  }
}

module.exports = {
  loadCache, saveCache, watchCache, saveFileId,
  getRestaurantRecipes,
  CACHE_PATH, SCHEMA_VERSION, RESTAURANTS,
};
