'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, '..', 'recipes-cache.json');
const CACHE_TMP_PATH = CACHE_PATH + '.tmp';

const SCHEMA_VERSION = 'v4.2.0';

// Food slots (unchanged from v4.0.0). RESTAURANTS is kept as an alias so
// existing callers (bot.js auto-terms loop, food cache-builder) keep working.
const FOOD_SLOTS = ['le_garage', 'boho'];
const RESTAURANTS = FOOD_SLOTS;

// v4.2.0 — drinks live in their own slots so the food build path stays
// completely untouched. Cairo bar is kept SEPARATE from El Gouna (owner's
// choice B) — no cross-dedupe between them.
const DRINK_SLOTS = ['le_garage_drinks', 'le_garage_drinks_cairo', 'boho_drinks'];
const ALL_SLOTS = [...FOOD_SLOTS, ...DRINK_SLOTS];

// Which drink slots merge into each restaurant's search view. A Le Garage
// query searches food + El Gouna bar + Cairo bar; a Boho query searches
// food + Boho bar. Cross-restaurant isolation is preserved.
const DRINK_SLOTS_FOR = {
  le_garage: ['le_garage_drinks', 'le_garage_drinks_cairo'],
  boho:      ['boho_drinks'],
};

function emptyRestaurant() {
  return { updated_at: null, recipes_count: 0, recipes: {} };
}

function emptyCache() {
  const out = { version: SCHEMA_VERSION };
  for (const slot of ALL_SLOTS) out[slot] = emptyRestaurant();
  return out;
}

/**
 * Normalise any on-disk cache to the current full shape, PRESERVING all
 * existing data. Handles:
 *   - legacy v3 (recipes at top level)         → moved under le_garage
 *   - v4.0.0 (le_garage + boho only)           → drink slots added empty
 *   - v4.2.0 (food + drink slots)              → passed through
 * Every food and drink slot present in the input is carried over verbatim;
 * missing slots are initialised empty. Nothing is ever dropped.
 */
function migrate(parsed) {
  // Legacy v3: { updated_at, recipes_count, recipes }
  if (parsed?.recipes && !parsed?.le_garage) {
    parsed = {
      le_garage: {
        updated_at: parsed.updated_at || null,
        recipes_count: parsed.recipes_count || Object.keys(parsed.recipes).length,
        recipes: parsed.recipes,
      },
    };
  }

  const out = { version: SCHEMA_VERSION };
  for (const slot of ALL_SLOTS) {
    const src = parsed?.[slot];
    out[slot] = src && src.recipes ? src : emptyRestaurant();
    if (!out[slot].recipes) out[slot].recipes = {};
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
 * Save the whole cache atomically (tmp file + rename) so a kill mid-write
 * can't corrupt the JSON. recipes_count is recomputed for every slot.
 */
function saveCache(cache) {
  for (const slot of ALL_SLOTS) {
    if (!cache[slot]) cache[slot] = emptyRestaurant();
    if (!cache[slot].recipes) cache[slot].recipes = {};
    cache[slot].recipes_count = Object.keys(cache[slot].recipes).length;
  }
  cache.version = SCHEMA_VERSION;
  fs.writeFileSync(CACHE_TMP_PATH, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(CACHE_TMP_PATH, CACHE_PATH);
}

function getRestaurantRecipes(cache, slot) {
  return cache?.[slot]?.recipes || {};
}

/**
 * The recipes a restaurant's bot should SEARCH: its food slot merged with
 * its drink slot(s). Drink rows carry distinct Notion page ids, so the
 * merge can't collide with food ids. Returns a fresh flat {id → recipe}.
 */
function getSearchableRecipes(cache, restaurant) {
  const out = { ...getRestaurantRecipes(cache, restaurant) };
  for (const ds of (DRINK_SLOTS_FOR[restaurant] || [])) {
    Object.assign(out, getRestaurantRecipes(cache, ds));
  }
  return out;
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
 * across ALL slots (food + drinks) so callers don't need to know which
 * one owns the recipe id.
 */
function saveFileId(cache, recipeId, type, fileId) {
  const key = type === 'photo' ? 'photo_file_id' : 'video_file_id';
  for (const slot of ALL_SLOTS) {
    const entry = cache?.[slot]?.recipes?.[recipeId];
    if (entry) { entry[key] = fileId; return; }
  }
}

module.exports = {
  loadCache, saveCache, watchCache, saveFileId,
  getRestaurantRecipes, getSearchableRecipes,
  CACHE_PATH, SCHEMA_VERSION,
  RESTAURANTS, FOOD_SLOTS, DRINK_SLOTS, ALL_SLOTS, DRINK_SLOTS_FOR,
};
