'use strict';

const fs = require('fs');
const { fetchPageBlocks } = require('./notion');
const { parseRecipe, hashRecipeFields } = require('./parser');

const RUNTIME_LOG = '/tmp/runtime-mismatches.log';
const TTL_MS = 10 * 60 * 1000;       // re-verify each recipe at most every 10 minutes
const CONCURRENCY_LIMIT = 3;          // max in-flight Notion fetches

const recent = new Map();             // recipe_id → timestamp of last verify
let inFlight = 0;

/**
 * Compare a cached recipe against live Notion content without blocking
 * the user. Returns immediately. Mismatches are logged to
 * /tmp/runtime-mismatches.log and (optionally) pushed to an admin
 * Telegram chat.
 *
 * @param {object} bot     telegraf instance — used for admin alerts
 * @param {object} recipe  the cached recipe object from searchRecipe
 * @param {string} query   raw user input (for context in alerts)
 * @param {string|number} userId  user that triggered the lookup
 */
function verifyInBackground(bot, recipe, query, userId) {
  if (!recipe || !recipe.source_page_id) return;
  // TTL: don't re-verify the same recipe more than once per 10 minutes
  const last = recent.get(recipe.source_page_id);
  if (last && Date.now() - last < TTL_MS) return;
  if (inFlight >= CONCURRENCY_LIMIT) return;

  inFlight++;
  recent.set(recipe.source_page_id, Date.now());

  (async () => {
    try {
      const blocks = await fetchPageBlocks(recipe.source_page_id);
      const fresh = await parseRecipe({
        id: recipe.source_page_id,
        url: recipe.url,
        properties: {},
        parent: {},
        database_id: null,
        database_label: recipe.restaurant === 'el_gouna' ? 'El Gouna'
                       : recipe.restaurant === 'cairo' ? 'Cairo' : null,
        last_edited_time: null,
      }, blocks);

      const cachedH = recipe.hashes || hashRecipeFields(recipe);
      const freshH  = hashRecipeFields(fresh);
      const fields  = ['name', 'ingredients_en', 'ingredients_ar', 'prep_en', 'prep_ar'];
      const drift   = fields.filter((f) => cachedH[f] !== freshH[f]);
      if (drift.length === 0) return;

      const payload = {
        timestamp: new Date().toISOString(),
        user: userId,
        query,
        recipe: recipe.name,
        source_url: recipe.url,
        drift,
        cache: {
          ingredients_en_lines: (recipe.ingredients_en || '').split('\n').filter(Boolean).length,
          ingredients_ar_lines: (recipe.ingredients_ar || '').split('\n').filter(Boolean).length,
          prep_en_lines:        (recipe.prep_en || '').split('\n').filter(Boolean).length,
          prep_ar_lines:        (recipe.prep_ar || '').split('\n').filter(Boolean).length,
        },
        fresh: {
          ingredients_en_lines: (fresh.ingredients_en || '').split('\n').filter(Boolean).length,
          ingredients_ar_lines: (fresh.ingredients_ar || '').split('\n').filter(Boolean).length,
          prep_en_lines:        (fresh.prep_en || '').split('\n').filter(Boolean).length,
          prep_ar_lines:        (fresh.prep_ar || '').split('\n').filter(Boolean).length,
        },
      };
      try { fs.appendFileSync(RUNTIME_LOG, JSON.stringify(payload) + '\n'); } catch {}

      const adminId = process.env.ADMIN_USER_ID;
      if (bot && adminId) {
        const text =
          '⚠️ <b>Cache mismatch detected</b>\n' +
          `Recipe: <b>${escapeHtml(recipe.name || '')}</b>\n` +
          `User: <code>${userId}</code> asked "<i>${escapeHtml(query)}</i>"\n` +
          `Drift: <code>${drift.join(', ')}</code>\n` +
          `Cache lines: ing_en=${payload.cache.ingredients_en_lines} | ing_ar=${payload.cache.ingredients_ar_lines} | prep_en=${payload.cache.prep_en_lines} | prep_ar=${payload.cache.prep_ar_lines}\n` +
          `Notion lines: ing_en=${payload.fresh.ingredients_en_lines} | ing_ar=${payload.fresh.ingredients_ar_lines} | prep_en=${payload.fresh.prep_en_lines} | prep_ar=${payload.fresh.prep_ar_lines}\n` +
          `<a href="${escapeHtml(recipe.url)}">Open in Notion</a>\n` +
          'Action: <code>node cache-builder.js</code>';
        try {
          await bot.telegram.sendMessage(adminId, text, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          });
        } catch { /* ignore admin DM failures */ }
      }
    } catch { /* swallow — runtime verify is best-effort */ }
    finally { inFlight--; }
  })();
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { verifyInBackground };
