'use strict';

// DOTENV_PATH lets the PM2 ecosystem point each process at its own env file
// (.env for Le Garage / multi, .env.boho for the Boho-only process). PM2's
// ecosystem options have no `env_file` directive — what looked like one was
// silently ignored, so both processes loaded the same .env. Routing through
// dotenv's `path` option is the supported way.
require('dotenv').config({ path: process.env.DOTENV_PATH || '.env' });

const fs = require('fs');
const { Telegraf, Markup } = require('telegraf');
const { loadCache, watchCache, getRestaurantRecipes, getSearchableRecipes, RESTAURANTS } = require('./lib/cache');
const { searchRecipe, suggestRecipes } = require('./lib/search');
const { searchArabic, arabicNameOf, hasArabic } = require('./lib/arabicSearch');
const { formatRecipe, formatSuggestions, formatBrokenReport, NOT_FOUND_MESSAGE } = require('./lib/format');
const { sendRecipe } = require('./lib/telegram');
const { verifyInBackground } = require('./lib/verify');
const { fetchPageBlocks } = require('./lib/notion');
const { parseRecipe, hashRecipeFields } = require('./lib/parser');
const { rebuildAutoTerms, autoStats } = require('./lib/autoTerms');
const { getUserRestaurant, setUserRestaurant, getOrDefaultRestaurant, updateLastActive } = require('./lib/preferences');

// ── Validate env ─────────────────────────────────────────────────────────────
const required = ['TELEGRAM_BOT_TOKEN', 'NOTION_TOKEN'];
for (const key of required) {
  if (!process.env[key]) { console.error(`❌ Missing env variable: ${key}`); process.exit(1); }
}

// ── Restaurant mode ──────────────────────────────────────────────────────────
// RESTAURANT_MODE:
//   'multi'      (default) — bot lets each Telegram user pick a
//                            restaurant; serves both le_garage and boho
//                            slots out of the shared cache.
//   'le_garage'  — single-restaurant mode, always le_garage. No picker.
//   'boho'       — single-restaurant mode, always boho. No picker.
//
// Set in .env.boho for a dedicated Boho bot process. Le Garage's
// existing .env leaves it unset → defaults to 'multi' so legacy
// behaviour is preserved.
const MODE = (process.env.RESTAURANT_MODE || 'multi').toLowerCase();
if (!['multi', 'le_garage', 'boho'].includes(MODE)) {
  console.error(`❌ Invalid RESTAURANT_MODE=${MODE}; expected multi|le_garage|boho`);
  process.exit(1);
}
const SINGLE_MODE = MODE !== 'multi';
const FIXED_RESTAURANT = SINGLE_MODE ? MODE : null;
console.log(`🏪 Restaurant mode: ${MODE}`);

// ── Whitelist ────────────────────────────────────────────────────────────────
const allowedIds = (process.env.ALLOWED_USER_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
function isAllowed(userId) {
  if (allowedIds.length === 0) return true;
  return allowedIds.includes(userId);
}
function isAdmin(userId) {
  const id = process.env.ADMIN_USER_ID;
  return id && String(userId) === String(id);
}
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Cache (v4.2 — food + drinks) ─────────────────────────────────────────────
let cache = loadCache();

// Memoised per-restaurant SEARCH view: food slot merged with its drink
// slot(s). Stable object identity per cache version so the auto-dictionary
// only rebuilds on an actual cache reload, not on every query. Used for all
// user-facing search; admin/maintenance paths keep the food-only view.
let searchable = {};
function rebuildSearchable() {
  searchable = {};
  for (const r of RESTAURANTS) searchable[r] = getSearchableRecipes(cache, r);
}
rebuildSearchable();

function refreshAutoTermsAll() {
  for (const r of RESTAURANTS) rebuildAutoTerms(searchable[r], r);
}
refreshAutoTermsAll();
function drinkCounts() {
  const lgd = Object.keys(getRestaurantRecipes(cache, 'le_garage_drinks')).length
            + Object.keys(getRestaurantRecipes(cache, 'le_garage_drinks_cairo')).length;
  const bhd = Object.keys(getRestaurantRecipes(cache, 'boho_drinks')).length;
  return { lgd, bhd };
}
function logCacheSummary() {
  const lg = Object.keys(getRestaurantRecipes(cache, 'le_garage')).length;
  const bh = Object.keys(getRestaurantRecipes(cache, 'boho')).length;
  const { lgd, bhd } = drinkCounts();
  console.log(`📦 Cache loaded: ${lg} le_garage (+${lgd} drinks) + ${bh} boho (+${bhd} drinks)`);
  for (const r of RESTAURANTS) {
    const s = autoStats(r);
    console.log(`🧠 Auto-terms[${r}]: ${s.words} words, ${s.phrases} phrases`);
  }
}
logCacheSummary();

watchCache((fresh) => {
  cache = fresh;
  rebuildSearchable();
  refreshAutoTermsAll();
  const lg = Object.keys(getRestaurantRecipes(cache, 'le_garage')).length;
  const bh = Object.keys(getRestaurantRecipes(cache, 'boho')).length;
  const { lgd, bhd } = drinkCounts();
  console.log(`🔄 Cache reloaded: ${lg} le_garage (+${lgd} drinks) + ${bh} boho (+${bhd} drinks)`);
});

// ── Pending query (used when a brand-new user types a dish BEFORE
// picking a restaurant — we ask them to pick, then auto-run the
// pending query after they tap a button). 5-minute TTL.
const PENDING_TTL_MS = 5 * 60 * 1000;
const pendingQueries = new Map();
function setPending(userId, query) { pendingQueries.set(String(userId), { query, ts: Date.now() }); }
function popPending(userId) {
  const p = pendingQueries.get(String(userId));
  pendingQueries.delete(String(userId));
  if (p && Date.now() - p.ts < PENDING_TTL_MS) return p.query;
  return null;
}

// ── Bot setup ────────────────────────────────────────────────────────────────
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

function restaurantKeyboard() {
  return Markup.inlineKeyboard([[
    Markup.button.callback('🍔 Le Garage', 'select_le_garage'),
    Markup.button.callback('☕ Boho Cafe', 'select_boho'),
  ]]);
}

bot.start(async (ctx) => {
  if (SINGLE_MODE) {
    const label = FIXED_RESTAURANT === 'le_garage' ? '🍔 Le Garage' : '☕ Boho Cafe';
    await ctx.reply(
      `👋 <b>Welcome to ${label} recipe bot!</b>\n\nType any dish name to search — English or Arabic.\n\n<b>Examples:</b>\n• <code>caesar salad</code>\n• <code>صلصة الترفل</code>`,
      { parse_mode: 'HTML' },
    );
    return;
  }
  const userId = ctx.from.id;
  const current = getUserRestaurant(userId);
  if (current) {
    const label = current === 'le_garage' ? '🍔 Le Garage' : '☕ Boho Cafe';
    await ctx.reply(
      `👋 Welcome back!\n\nYour restaurant: <b>${label}</b>\n\nType any dish name to search.\nUse <code>/restaurant</code> to switch.`,
      { parse_mode: 'HTML' },
    );
    return;
  }
  await ctx.reply(
    '👋 <b>Welcome to Recipe Bot!</b>\n\nPlease pick your restaurant:',
    { parse_mode: 'HTML', ...restaurantKeyboard() },
  );
});

bot.command('restaurant', async (ctx) => {
  if (SINGLE_MODE) {
    const label = FIXED_RESTAURANT === 'le_garage' ? '🍔 Le Garage' : '☕ Boho Cafe';
    await ctx.reply(
      `This bot serves <b>${label}</b> only.\nJust type a dish name.`,
      { parse_mode: 'HTML' },
    );
    return;
  }
  const userId = ctx.from.id;
  const current = getUserRestaurant(userId);
  const label = current === 'le_garage' ? '🍔 Le Garage'
              : current === 'boho'      ? '☕ Boho Cafe'
              : '(not selected)';
  await ctx.reply(
    `Current restaurant: <b>${label}</b>\n\nSwitch to:`,
    { parse_mode: 'HTML', ...restaurantKeyboard() },
  );
});

bot.action(/^select_(le_garage|boho)$/, async (ctx) => {
  if (SINGLE_MODE) { await ctx.answerCbQuery('Single-restaurant bot'); return; }
  const restaurant = ctx.match[1];
  const userId = ctx.from.id;
  setUserRestaurant(userId, restaurant);
  await ctx.answerCbQuery('✅ Selected');
  const label = restaurant === 'le_garage' ? '🍔 Le Garage' : '☕ Boho Cafe';
  const pending = popPending(userId);
  if (pending) {
    try {
      await ctx.editMessageText(`✅ <b>${label}</b> selected.\nSearching for: <i>${esc(pending)}</i>…`, { parse_mode: 'HTML' });
    } catch { /* ignore edit failures */ }
    await handleSearch(ctx, pending, restaurant);
    return;
  }
  try {
    await ctx.editMessageText(
      `✅ Your restaurant: <b>${label}</b>\n\nType any dish name to search.\nUse <code>/restaurant</code> to switch.`,
      { parse_mode: 'HTML' },
    );
  } catch {
    await ctx.reply(
      `✅ Your restaurant: <b>${label}</b>\n\nType any dish name to search.`,
      { parse_mode: 'HTML' },
    );
  }
});

// A "did you mean" name button was tapped → serve that exact recipe.
bot.action(/^r_([0-9a-f]{32})$/, async (ctx) => {
  const userId = ctx.from.id;
  if (!isAllowed(userId)) { await ctx.answerCbQuery('🚫'); return; }
  const restaurant = SINGLE_MODE ? FIXED_RESTAURANT : getOrDefaultRestaurant(userId);
  const id = redashId(ctx.match[1]);
  const recipe = searchable[restaurant]?.[id];
  if (!recipe) { await ctx.answerCbQuery('Try searching again 🔄'); return; }
  await ctx.answerCbQuery();
  try {
    const text = formatRecipe(recipe, { restaurant, singleMode: SINGLE_MODE });
    await sendRecipe(bot, ctx.chat.id, text, recipe, id, cache);
    console.log(`   ✅ [${restaurant}] (picked) ${recipe.name}`);
    verifyInBackground(bot, { ...recipe, source_page_id: id }, '(picked)', userId);
  } catch (err) {
    console.error(`   💥 pick error: ${err.message}`);
  }
});

bot.help(async (ctx) => {
  await ctx.reply(
    '📖 <b>How to use</b>\n\n' +
    'Just type the dish name — no commands needed.\nTypos are OK; the bot will try to figure it out.\n\n' +
    '<b>Languages:</b> 🇬🇧 English · 🇪🇬 العربية\n\n' +
    '<b>Commands:</b>\n' +
    '<code>/restaurant</code> — switch restaurant\n' +
    '<code>/broken</code> — admin: list recipes that need fixing in Notion',
    { parse_mode: 'HTML' },
  );
});

bot.command('broken', async (ctx) => {
  if (!isAllowed(ctx.from.id)) { await ctx.reply('🚫 Not authorized.'); return; }
  const restaurant = getOrDefaultRestaurant(ctx.from.id);
  const recipes = getRestaurantRecipes(cache, restaurant);
  const messages = formatBrokenReport(recipes);
  for (const m of messages) await ctx.reply(m, { parse_mode: 'HTML', disable_web_page_preview: true });
});
bot.command('incomplete', async (ctx) => {
  if (!isAllowed(ctx.from.id)) { await ctx.reply('🚫 Not authorized.'); return; }
  const restaurant = getOrDefaultRestaurant(ctx.from.id);
  const recipes = getRestaurantRecipes(cache, restaurant);
  const messages = formatBrokenReport(recipes);
  for (const m of messages) await ctx.reply(m, { parse_mode: 'HTML', disable_web_page_preview: true });
});

bot.command('verify', async (ctx) => {
  if (!isAdmin(ctx.from.id)) { await ctx.reply('🚫 Admin only.'); return; }
  const arg = ctx.message.text.replace(/^\/verify(@\w+)?\s*/, '').trim();
  if (arg === '--all' || arg === '-a') {
    await ctx.reply('🛡 Full verification: run on shell — <code>node scripts/full-verify.js</code>', { parse_mode: 'HTML' });
    return;
  }
  if (!arg) {
    await ctx.reply('Usage:\n<code>/verify &lt;recipe name&gt;</code>\n<code>/verify --all</code>', { parse_mode: 'HTML' });
    return;
  }
  // Search current admin's selected restaurant (food + drinks)
  const restaurant = getOrDefaultRestaurant(ctx.from.id);
  const recipes = searchable[restaurant];
  const match = searchRecipe(arg, recipes, restaurant);
  if (!match) { await ctx.reply(`🔍 No cached ${restaurant} recipe matched "${esc(arg)}".`, { parse_mode: 'HTML' }); return; }
  const cached = match.recipe;
  try {
    const blocks = await fetchPageBlocks(match.id);
    const fresh = await parseRecipe({
      id: match.id, url: cached.url, properties: {}, parent: {},
      database_id: null,
      database_label: cached.restaurant === 'el_gouna' ? 'El Gouna'
                    : cached.restaurant === 'cairo'    ? 'Cairo'
                    : cached.restaurant === 'boho'     ? 'Boho'
                    : null,
      last_edited_time: null,
    }, blocks);
    const cH = cached.hashes || hashRecipeFields(cached);
    const fH = hashRecipeFields(fresh);
    const fields = ['name', 'ingredients_en', 'ingredients_ar', 'prep_en', 'prep_ar'];
    const drift = fields.filter((f) => cH[f] !== fH[f]);
    const cn = (s) => (s || '').split('\n').filter(Boolean).length;
    const lines = [
      `📋 <b>VERIFY:</b> ${esc(cached.name)}  (${restaurant})`,
      `<a href="${esc(cached.url)}">Open in Notion</a>`, '',
      '<b>CACHE</b>',
      `🇬🇧 ingredients: ${cn(cached.ingredients_en)} lines`,
      `🇪🇬 ingredients: ${cn(cached.ingredients_ar)} lines`,
      `🇬🇧 prep: ${cn(cached.prep_en)} lines`,
      `🇪🇬 prep: ${cn(cached.prep_ar)} lines`, '',
      '<b>NOTION (live)</b>',
      `🇬🇧 ingredients: ${cn(fresh.ingredients_en)} lines`,
      `🇪🇬 ingredients: ${cn(fresh.ingredients_ar)} lines`,
      `🇬🇧 prep: ${cn(fresh.prep_en)} lines`,
      `🇪🇬 prep: ${cn(fresh.prep_ar)} lines`, '',
      drift.length === 0 ? '✅ <b>Cache matches Notion.</b>' : `⚠️ <b>Drift in:</b> <code>${drift.join(', ')}</code>`,
    ];
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (err) {
    await ctx.reply(`💥 Verify failed: ${esc(err.message)}`, { parse_mode: 'HTML' });
  }
});

// ── Maintenance ──────────────────────────────────────────────────────────────
const MAINTENANCE_FLAG = '/tmp/maintenance.flag';
function inMaintenance() { try { fs.accessSync(MAINTENANCE_FLAG); return true; } catch { return false; } }

// ── Text handler ─────────────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const query = ctx.message.text.trim();
  if (query.startsWith('/')) return; // commands handled above
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || String(userId);
  console.log(`\n📩 [${new Date().toISOString()}] @${username} (${userId}): "${query}"`);

  if (inMaintenance()) {
    await ctx.reply('🔧 Under maintenance. Please try again in a few minutes.\n🔧 صيانة. يرجى المحاولة بعد دقائق.');
    return;
  }
  if (!isAllowed(userId)) {
    console.log('   🚫 Blocked (not in whitelist)');
    await ctx.reply('🚫 Not authorized.');
    return;
  }

  // Single-restaurant bots skip user-preference lookup entirely and
  // serve everyone from the fixed slot. In multi mode, existing users
  // who never explicitly picked a restaurant get auto-defaulted to
  // le_garage so the v4 rollout didn't interrupt anyone's workflow.
  const restaurant = SINGLE_MODE ? FIXED_RESTAURANT : getOrDefaultRestaurant(userId);
  await handleSearch(ctx, query, restaurant);
});

const SUGGEST_HEADER =
  '🔍 <b>Можливо, ви мали на увазі / هل تقصد:</b>\n' +
  '<i>Натисніть назву / اضغط على الاسم 👇</i>';

// 32-hex Notion id (callback-safe) → dashed cache key.
function redashId(id) {
  return id.includes('-') ? id : id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

// Merge candidate sources into a deduped, ordered list for the picker:
// Arabic-name hits first (the worker typed Arabic), then English-slug
// suggestions, then the weak English fallback. Capped at 6.
function gatherCandidates({ query, recipes, restaurant, arabic, weak }) {
  const seen = new Set();
  const out = [];
  const add = (id, recipe) => {
    if (id && recipe && !seen.has(id)) { seen.add(id); out.push({ id, recipe }); }
  };
  for (const c of (arabic?.candidates || [])) add(c.id, c.recipe);
  for (const s of suggestRecipes(query, recipes, 5, restaurant)) add(s.id, s.recipe);
  if (weak) add(weak.id, weak.recipe);
  return out.slice(0, 6);
}

// Inline keyboard of candidate NAMES. When the query was Arabic we lead with
// the Arabic name so the worker recognises it. callback_data = r_<id32>.
function suggestionKeyboard(cands, arabicQuery) {
  const rows = cands.map((c) => {
    const ar = arabicNameOf(c.recipe);
    const label = arabicQuery && ar
      ? `${ar} — ${c.recipe.name}`
      : (ar ? `${c.recipe.name} — ${ar}` : c.recipe.name);
    return [{ text: label.slice(0, 60), callback_data: 'r_' + c.id.replace(/-/g, '') }];
  });
  return { reply_markup: { inline_keyboard: rows } };
}

async function serveMatch(ctx, restaurant, recipe, id, query, userId, startTime) {
  const text = formatRecipe(recipe, { restaurant, singleMode: SINGLE_MODE });
  await sendRecipe(bot, ctx.chat.id, text, recipe, id, cache);
  console.log(`   ✅ [${restaurant}] ${recipe.name} (${Date.now() - startTime}ms)`);
  verifyInBackground(bot, { ...recipe, source_page_id: id }, query, userId);
}

async function handleSearch(ctx, query, restaurant) {
  const startTime = Date.now();
  const userId = ctx.from.id;
  // Food + this restaurant's drinks, merged. Cross-restaurant isolation is
  // preserved: searchable[le_garage] never contains Boho rows and vice versa.
  const recipes = searchable[restaurant];

  if (!recipes || Object.keys(recipes).length === 0) {
    await ctx.reply(`❌ ${restaurant} cache is empty. Tell the admin to run cache-builder.`);
    return;
  }

  const statusMsg = await ctx.reply('⏳ Searching... / جاري البحث...');
  try {
    const arabicQ = hasArabic(query);
    const match = searchRecipe(query, recipes, restaurant);
    // Confident = the English/dictionary path met its own keyword threshold.
    const enConfident = match && match.score >= Math.min(match.keywords.length, 2);
    // IDF-ranked Arabic NAME search — authoritative for Arabic queries so the
    // English dictionary can't hijack them via a single generic keyword
    // (برجر → "Burger Plate Preparation", بطاطس → "Sweet Potato Fries").
    const arabic = arabicQ ? searchArabic(query, recipes) : { candidates: [], confident: false };
    try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}

    const offerOrServe = async (cands) => {
      if (cands.length === 1) {
        await serveMatch(ctx, restaurant, cands[0].recipe, cands[0].id, query, userId, startTime);
      } else if (cands.length > 1) {
        await ctx.reply(SUGGEST_HEADER, { parse_mode: 'HTML', ...suggestionKeyboard(cands, arabicQ) });
        console.log(`   🔀 Offered ${cands.length} options in ${restaurant} (${Date.now() - startTime}ms)`);
      } else {
        await ctx.reply(NOT_FOUND_MESSAGE);
        console.log(`   ❌ Not found in ${restaurant} (${Date.now() - startTime}ms)`);
      }
    };

    // Arabic query that produced NAME matches → the IDF engine decides.
    if (arabicQ && arabic.candidates.length) {
      if (arabic.confident) {
        const top = arabic.candidates[0];
        await serveMatch(ctx, restaurant, top.recipe, top.id, query, userId, startTime);
        return;
      }
      await offerOrServe(gatherCandidates({ query, recipes, restaurant, arabic, weak: null }));
      return;
    }

    // English query (or Arabic with no name match) → curated dictionary path.
    if (enConfident) {
      await serveMatch(ctx, restaurant, match.recipe, match.id, query, userId, startTime);
      return;
    }
    await offerOrServe(gatherCandidates({ query, recipes, restaurant, arabic, weak: match }));
  } catch (err) {
    console.error(`   💥 Error: ${err.message}`);
    try { await ctx.reply('😔 Something went wrong. Please try again.\nحدث خطأ ما، يرجى المحاولة مرة أخرى.'); } catch {}
  }
}

// ── Startup verification ────────────────────────────────────────────────────
async function startupVerificationSample() {
  for (const restaurant of RESTAURANTS) {
    const recipes = getRestaurantRecipes(cache, restaurant);
    const ids = Object.keys(recipes);
    if (ids.length === 0) continue;
    const pick = [];
    while (pick.length < Math.min(3, ids.length)) {
      const id = ids[Math.floor(Math.random() * ids.length)];
      if (!pick.includes(id)) pick.push(id);
    }
    console.log(`🔍 Startup sample [${restaurant}] (${pick.length} random):`);
    let okN = 0;
    for (const id of pick) {
      const cached = recipes[id];
      try {
        const blocks = await fetchPageBlocks(id);
        const fresh = await parseRecipe({
          id, url: cached.url, properties: {}, parent: {}, database_id: null,
          database_label: cached.restaurant === 'el_gouna' ? 'El Gouna'
                        : cached.restaurant === 'cairo'    ? 'Cairo'
                        : cached.restaurant === 'boho'     ? 'Boho'
                        : null,
          last_edited_time: null,
        }, blocks);
        const cH = cached.hashes || hashRecipeFields(cached);
        const fH = hashRecipeFields(fresh);
        const fields = ['name', 'ingredients_en', 'ingredients_ar', 'prep_en', 'prep_ar'];
        const drift = fields.filter((f) => cH[f] !== fH[f]);
        if (drift.length === 0) { console.log(`   ✅ ${cached.name}`); okN++; }
        else                    { console.log(`   ⚠️ ${cached.name} — drift in ${drift.join(', ')}`); }
      } catch (err) {
        console.log(`   🚫 ${cached.name} — ${err.message}`);
      }
    }
    console.log(`   → ${okN}/${pick.length} match`);
  }
}

// ── Launch ───────────────────────────────────────────────────────────────────
bot.telegram.getMe().then(async (info) => {
  const lg = Object.keys(getRestaurantRecipes(cache, 'le_garage')).length;
  const bh = Object.keys(getRestaurantRecipes(cache, 'boho')).length;
  const { lgd, bhd } = drinkCounts();
  console.log(`\n✅ Bot is running on @${info.username}`);
  console.log(`   Cache: ${lg} le_garage (+${lgd} drinks) + ${bh} boho (+${bhd} drinks)`);
  console.log(`   Whitelist: ${allowedIds.length === 0 ? 'open' : allowedIds.length + ' users'}\n`);
  startupVerificationSample().catch(() => {});
}).catch((err) => {
  console.error('💥 Failed to connect to Telegram:', err.message);
  process.exit(1);
});

bot.launch().catch((err) => { console.error('💥 Fatal error:', err.message); process.exit(1); });
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
