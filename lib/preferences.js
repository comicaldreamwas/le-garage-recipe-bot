'use strict';

const fs = require('fs');
const path = require('path');

// Lives next to the cache file so it survives deploys but isn't
// checked into git (see .gitignore).
const PREF_PATH = path.join(__dirname, '..', 'user-preferences.json');
const VALID_RESTAURANTS = new Set(['le_garage', 'boho']);

let prefs = {};
let loaded = false;

function load() {
  try {
    prefs = JSON.parse(fs.readFileSync(PREF_PATH, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[PREFS] load failed:', err.message);
    prefs = {};
  }
  loaded = true;
}

function ensureLoaded() { if (!loaded) load(); }

function save() {
  try {
    fs.writeFileSync(PREF_PATH + '.tmp', JSON.stringify(prefs, null, 2), 'utf8');
    fs.renameSync(PREF_PATH + '.tmp', PREF_PATH);
  } catch (err) {
    console.error('[PREFS] save failed:', err.message);
  }
}

function getUserRestaurant(userId) {
  ensureLoaded();
  return prefs[String(userId)]?.restaurant || null;
}

function setUserRestaurant(userId, restaurant) {
  if (!VALID_RESTAURANTS.has(restaurant)) {
    throw new Error('invalid restaurant: ' + restaurant);
  }
  ensureLoaded();
  const id = String(userId);
  const now = new Date().toISOString();
  prefs[id] = {
    restaurant,
    set_at: prefs[id]?.set_at || now,
    last_active: now,
  };
  save();
}

function updateLastActive(userId) {
  ensureLoaded();
  const id = String(userId);
  if (!prefs[id]) return;
  prefs[id].last_active = new Date().toISOString();
  save();
}

/**
 * Existing Le Garage users predate the multi-restaurant rollout. They
 * shouldn't see a "pick your restaurant" prompt when they next type a
 * dish — they should just keep getting Le Garage recipes. So the
 * first time we see a user without an explicit preference we silently
 * pin them to le_garage. They can switch later via /restaurant.
 */
function getOrDefaultRestaurant(userId) {
  ensureLoaded();
  const current = getUserRestaurant(userId);
  if (current) {
    updateLastActive(userId);
    return current;
  }
  setUserRestaurant(userId, 'le_garage');
  console.log(`[PREFS] auto-default le_garage for user ${userId}`);
  return 'le_garage';
}

function listUsers() {
  ensureLoaded();
  return Object.entries(prefs).map(([id, p]) => ({ userId: id, ...p }));
}

module.exports = {
  getUserRestaurant, setUserRestaurant, updateLastActive,
  getOrDefaultRestaurant, listUsers, PREF_PATH,
};
