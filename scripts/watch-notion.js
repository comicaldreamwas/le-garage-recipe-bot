'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Near-instant Notion → cache sync.
//
// Polls every DB (food + drinks) for pages edited since we last looked, and
// pushes ONLY those changed pages into recipes-cache.json. The bots watch the
// cache file (lib/cache.watchCache) and reload within a second, so a Notion
// edit shows up in the bot in ~POLL_MS + a moment.
//
// This is the fast path. The hourly cache-rebuild cron stays as a safety net
// that also handles deletions and cross-DB slug dedupe.
//
// Run under PM2 (see ecosystem.config.js → recipe-sync). Cheap: a handful of
// tiny "what changed?" queries per cycle.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: process.env.DOTENV_PATH || require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');
const { fetchPageBlocks } = require(path.resolve(__dirname, '..', 'lib', 'notion'));
const { parseRecipe, isUsable } = require(path.resolve(__dirname, '..', 'lib', 'parser'));
const { loadCache, saveCache } = require(path.resolve(__dirname, '..', 'lib', 'cache'));

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const POLL_MS = Number(process.env.SYNC_POLL_MS || 30000);
const STATE_PATH = path.resolve(__dirname, '..', '.notion-sync-state.json');
const MAINT_FLAG = '/tmp/maintenance.flag';

const norm = (id) => (id || '').replace(/-/g, '').toLowerCase();
const EL_GOUNA = process.env.NOTION_PARENT_EL_GOUNA || '2ad2c25e-cb5d-8149-8303-f983d1aebced';
const CAIRO    = process.env.NOTION_PARENT_CAIRO    || '2ad2c25e-cb5d-8134-b661-e0323e39fb72';
const BOHO     = process.env.NOTION_PARENT_BOHO     || '2ad2c25e-cb5d-812a-bc52-f3eb7111add6';

// slot = where in the cache; label = drives parser; kind = food|drink.
const DBS = [
  { id: EL_GOUNA, slot: 'le_garage', label: 'El Gouna', kind: 'food' },
  { id: CAIRO,    slot: 'le_garage', label: 'Cairo',    kind: 'food' },
  { id: BOHO,     slot: 'boho',      label: 'Boho',     kind: 'food' },
  { id: '2ad2c25e-cb5d-81cb-9724-ca67b91f5e68', slot: 'le_garage_drinks',       label: 'El Gouna', kind: 'drink' },
  { id: '2ad2c25e-cb5d-81e5-bede-d6075a989272', slot: 'le_garage_drinks_cairo', label: 'Cairo',    kind: 'drink' },
  { id: '35d2c25e-cb5d-805c-ad58-e1c72ade31fb', slot: 'boho_drinks',            label: 'Boho',     kind: 'drink' },
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function log(...a) { console.log(`[sync ${new Date().toISOString()}]`, ...a); }

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(state) {
  const tmp = STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_PATH);
}

// Pages edited after `since` (ISO). NOTE: Notion ignores last_edited_time
// SORTS on these databases (verified — descending returns unsorted), so we
// never rely on result order; the caller advances the high-water mark by the
// MAX timestamp it sees. The `after` FILTER itself is reliable.
async function changedSince(dbId, since) {
  const out = [];
  let cursor;
  do {
    const r = await notion.databases.query({
      database_id: dbId,
      filter: { timestamp: 'last_edited_time', last_edited_time: { after: since } },
      page_size: 100,
      start_cursor: cursor,
    });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function applyPage(cache, db, page) {
  const blocks = await fetchPageBlocks(page.id);
  const parsed = await parseRecipe({
    id: page.id, url: page.url,
    properties: page.properties || {}, parent: page.parent || {},
    database_id: db.id, database_label: db.label,
    last_edited_time: page.last_edited_time,
  }, blocks);

  const slotRecipes = cache[db.slot].recipes;
  if (db.kind === 'drink') {
    // Strict: only keep drinks with ingredients; drop if it became empty.
    if (!isUsable(parsed)) {
      if (slotRecipes[page.id]) { delete slotRecipes[page.id]; return 'removed'; }
      return 'skipped-empty';
    }
    const prev = slotRecipes[page.id] || {};
    slotRecipes[page.id] = { ...parsed, type: 'drink', photo_file_id: prev.photo_file_id || '', video_file_id: prev.video_file_id || '', cached_at: new Date().toISOString() };
    return 'drink';
  }
  const prev = slotRecipes[page.id] || {};
  slotRecipes[page.id] = { ...parsed, photo_file_id: prev.photo_file_id || '', video_file_id: prev.video_file_id || '', cached_at: new Date().toISOString() };
  return 'food';
}

async function cycle(state) {
  if (fs.existsSync(MAINT_FLAG)) { return; } // full rebuild in progress — skip

  // Gather changes across all DBs first, so we saveCache at most once.
  let cache = null;
  let touched = 0;
  const newState = { ...state };

  const nowIso = new Date().toISOString();
  for (const db of DBS) {
    const key = norm(db.id);
    try {
      // First sight → watermark = now; only react to edits made from here on.
      if (!state[key]) { newState[key] = nowIso; continue; }
      const changed = await changedSince(db.id, state[key]);
      if (!changed.length) continue;
      if (!cache) cache = loadCache();
      let maxTs = state[key];
      for (const page of changed) {
        if (page.last_edited_time > maxTs) maxTs = page.last_edited_time; // order not guaranteed
        try {
          const what = await applyPage(cache, db, page);
          const name = page.url ? page.url.split('/').pop().replace(/-[0-9a-f]{32}$/i, '') : page.id;
          log(`${db.slot} ${what}: ${name}`);
          touched++;
        } catch (e) { log(`  ✗ page ${page.id}: ${e.message}`); }
      }
      newState[key] = maxTs;
    } catch (e) {
      log(`DB ${db.label}/${db.kind} query failed: ${e.message}`);
    }
  }

  if (cache && touched) {
    for (const slot of ['le_garage', 'boho', 'le_garage_drinks', 'le_garage_drinks_cairo', 'boho_drinks']) {
      if (cache[slot]) cache[slot].updated_at = new Date().toLocaleString('uk-UA', { timeZone: 'Africa/Cairo' });
    }
    saveCache(cache);
    log(`✅ applied ${touched} change(s) → cache saved (bots reload automatically)`);
  }
  saveState(newState);
}

(async () => {
  if (!process.env.NOTION_TOKEN) { console.error('❌ NOTION_TOKEN missing'); process.exit(1); }
  log(`starting — polling ${DBS.length} DBs every ${POLL_MS / 1000}s`);
  // cycle() persists advanced state to disk each pass; we reload it after.
  for (;;) {
    try { await cycle(loadState()); }
    catch (e) { log('cycle error:', e.message); }
    await sleep(POLL_MS);
  }
})();
