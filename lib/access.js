'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Staff whitelist — who may ask this bot for recipes.
 *
 * Lives next to recipes-cache.json and user-preferences.json: outside git
 * (see .gitignore) so `git pull` during a deploy never overwrites it, and
 * outside .env so granting or revoking access needs no SSH and no PM2
 * restart.
 *
 * Shape:
 *   {
 *     "boho":      { "583920144": { name, username, added_at, added_by, last_seen } },
 *     "le_garage": { "771203344": { ... } }
 *   }
 *
 * Scoped per restaurant because Le Garage and Boho are separate PM2
 * processes (separate bot tokens) sharing this one file. A Boho employee
 * belongs in the Boho section only — and revoking them there must not
 * touch the Le Garage roster.
 */

// Overridable so tests never touch the live roster.
const ACCESS_PATH = process.env.ALLOWED_USERS_PATH
  || path.join(__dirname, '..', 'allowed-users.json');
const VALID_SCOPES = new Set(['le_garage', 'boho']);

// A recipe lookup shouldn't cost a disk write. last_seen is only persisted
// once the stored value is this stale.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

let store = null;    // parsed file contents, or null before first read
let stamp = null;    // disk signature of the copy sitting in `store`

function assertScope(scope) {
  if (!VALID_SCOPES.has(scope)) throw new Error('invalid scope: ' + scope);
}

/**
 * mtime alone can miss two writes landing in the same millisecond, so the
 * signature also carries the size. Cheap, and a same-ms write that also
 * keeps the byte count identical would have to be a no-op anyway.
 */
function diskStamp() {
  try {
    const st = fs.statSync(ACCESS_PATH);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return 'absent';
  }
}

function readFromDisk() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ACCESS_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.error('[ACCESS] allowed-users.json is not an object — treating as empty');
      return {};
    }
    return parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // A corrupt file must NOT silently open the bot up: an unreadable
      // whitelist stays an empty whitelist, which denies rather than allows.
      console.error('[ACCESS] load failed:', err.message);
    }
    return {};
  }
}

/**
 * Re-read whenever the file changed underneath us. The two bot processes
 * share this file, so an /adduser or /deluser in one is visible to the
 * other without a restart — a revoked employee is locked out on their very
 * next message.
 */
function ensureFresh() {
  const current = diskStamp();
  if (store === null || current !== stamp) {
    store = readFromDisk();
    stamp = current;
  }
}

function persist() {
  const tmp = ACCESS_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, ACCESS_PATH);
    stamp = diskStamp(); // adopt our own write instead of re-reading it back
    return true;
  } catch (err) {
    console.error('[ACCESS] save failed:', err.message);
    return false;
  }
}

/**
 * Pull in the other process's writes, apply ours, write the whole file back.
 * Without the re-read, the Boho bot saving its section would clobber a
 * Le Garage entry added seconds earlier by the other process.
 */
function mutate(fn) {
  ensureFresh();
  const result = fn();
  persist();
  return result;
}

function section(scope) {
  assertScope(scope);
  ensureFresh();
  return store[scope] || {};
}

function isAllowed(userId, scope) {
  return Object.prototype.hasOwnProperty.call(section(scope), String(userId));
}

function count(scope) {
  return Object.keys(section(scope)).length;
}

function listUsers(scope) {
  return Object.entries(section(scope))
    .map(([userId, entry]) => ({ userId, ...entry }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function getUser(userId, scope) {
  const entry = section(scope)[String(userId)];
  return entry ? { userId: String(userId), ...entry } : null;
}

function addUser(userId, scope, { name = '', username = '', addedBy = '' } = {}) {
  assertScope(scope);
  const id = String(userId);
  if (!/^\d+$/.test(id)) throw new Error('invalid telegram id: ' + userId);
  return mutate(() => {
    if (!store[scope]) store[scope] = {};
    const existing = store[scope][id];
    const entry = {
      name: String(name || existing?.name || '').trim(),
      username: String(username || existing?.username || '').replace(/^@/, ''),
      added_at: existing?.added_at || new Date().toISOString(),
      added_by: existing?.added_by || String(addedBy || ''),
      last_seen: existing?.last_seen || null,
    };
    store[scope][id] = entry;
    return { userId: id, ...entry, alreadyPresent: Boolean(existing) };
  });
}

function removeUser(userId, scope) {
  assertScope(scope);
  const id = String(userId);
  return mutate(() => {
    const entry = store[scope]?.[id];
    if (!entry) return null;
    delete store[scope][id];
    return { userId: id, ...entry };
  });
}

/**
 * Resolve what an admin typed into whitelist entries. When someone leaves
 * the job you rarely have their numeric id to hand — "/deluser @ahmed_k" or
 * "/deluser Ahmed" has to work off what was recorded when they were added.
 * Returns every match so an ambiguous name can be reported rather than
 * guessed at.
 */
function findUsers(query, scope) {
  const q = String(query || '').trim();
  if (!q) return [];
  const users = listUsers(scope);

  if (/^\d+$/.test(q)) {
    return users.filter((u) => u.userId === q);
  }

  // An empty handle would otherwise match every entry that has no username —
  // "/deluser @" must not resolve to a real person.
  const handle = q.replace(/^@/, '').toLowerCase();
  if (handle) {
    const byUsername = users.filter((u) => String(u.username || '').toLowerCase() === handle);
    if (byUsername.length) return byUsername;
  }

  // A leading @ is an explicit username lookup — don't fall through to
  // name matching and delete the wrong person.
  if (q.startsWith('@')) return [];

  const lower = q.toLowerCase();
  const exact = users.filter((u) => String(u.name || '').toLowerCase() === lower);
  if (exact.length) return exact;
  return users.filter((u) => String(u.name || '').toLowerCase().includes(lower));
}

/**
 * Record activity, but only write when the stored value is genuinely stale.
 * Every persisted write bumps the file signature and makes the *other* bot
 * process re-read, so touching on each message would have the two bots
 * reloading each other constantly for no benefit.
 */
function touch(userId, scope, username = '') {
  const id = String(userId);
  const entry = section(scope)[id];
  if (!entry) return;

  const handle = String(username || '').replace(/^@/, '');
  const handleChanged = handle && handle !== entry.username;
  const last = entry.last_seen ? Date.parse(entry.last_seen) : 0;
  const stale = !Number.isFinite(last) || Date.now() - last > TOUCH_INTERVAL_MS;
  if (!stale && !handleChanged) return;

  mutate(() => {
    const live = store[scope]?.[id];
    if (!live) return; // revoked by the other process between our read and now
    live.last_seen = new Date().toISOString();
    if (handle) live.username = handle;
  });
}

/**
 * Seed the whitelist from user-preferences.json — everyone who ever used the
 * bot while access was open. Used once by /import so switching enforcement on
 * doesn't lock out the whole kitchen mid-shift; the admin then prunes with
 * /deluser. Existing entries are left untouched.
 */
function importUsers(candidates, scope, addedBy = '') {
  assertScope(scope);
  return mutate(() => {
    if (!store[scope]) store[scope] = {};
    const added = [];
    for (const c of candidates) {
      const id = String(c.userId);
      if (!/^\d+$/.test(id) || store[scope][id]) continue;
      store[scope][id] = {
        name: String(c.name || '').trim(),
        username: String(c.username || '').replace(/^@/, ''),
        added_at: new Date().toISOString(),
        added_by: String(addedBy || ''),
        last_seen: c.last_active || null,
      };
      added.push({ userId: id, ...store[scope][id] });
    }
    return added;
  });
}

/** Test seam — drops the cached copy so the next call re-reads the file. */
function _reset() {
  store = null;
  stamp = null;
}

module.exports = {
  isAllowed, addUser, removeUser, findUsers, getUser, listUsers, count,
  touch, importUsers, ACCESS_PATH, VALID_SCOPES, _reset,
};
