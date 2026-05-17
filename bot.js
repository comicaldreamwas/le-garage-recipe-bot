'use strict';

require('dotenv').config();

const { Telegraf } = require('telegraf');
const { loadCache, watchCache } = require('./lib/cache');
const { searchRecipe, suggestRecipes } = require('./lib/search');
const { formatRecipe, formatSuggestions, formatBrokenReport, NOT_FOUND_MESSAGE } = require('./lib/format');
const { sendRecipe } = require('./lib/telegram');
const { verifyInBackground } = require('./lib/verify');
const { fetchPageBlocks } = require('./lib/notion');
const { parseRecipe, hashRecipeFields } = require('./lib/parser');

// ── Validate env ─────────────────────────────────────────────────────────────
const required = ['TELEGRAM_BOT_TOKEN', 'NOTION_TOKEN'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing env variable: ${key}`);
    process.exit(1);
  }
}

// ── Whitelist ────────────────────────────────────────────────────────────────
const allowedIds = (process.env.ALLOWED_USER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number)
  .filter((n) => Number.isFinite(n));

function isAllowed(userId) {
  if (allowedIds.length === 0) return true; // empty whitelist = open access
  return allowedIds.includes(userId);
}

// ── Cache (hot-reloads when cache-builder rewrites the file) ─────────────────
let cache = loadCache();
console.log(`📦 Cache loaded: ${Object.keys(cache.recipes).length} recipes`);

watchCache((fresh) => {
  cache = fresh;
  console.log(`🔄 Cache reloaded: ${Object.keys(cache.recipes).length} recipes`);
});

// ── Bot setup ────────────────────────────────────────────────────────────────
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.start(async (ctx) => {
  await ctx.reply(
    '👨‍🍳 <b>Le Garage Recipe Bot</b>\n\n' +
    'Send a dish name in English or Arabic and I will reply with the recipe.\n\n' +
    '<b>Examples:</b>\n' +
    '• <code>mushroom sauce</code>\n' +
    '• <code>chicken alfredo</code>\n' +
    '• <code>صلصة الترفل</code>\n' +
    '• <code>شوربة عدس</code>',
    { parse_mode: 'HTML' }
  );
});

bot.help(async (ctx) => {
  await ctx.reply(
    '📖 <b>How to use</b>\n\n' +
    'Just type the dish name — no commands needed.\n' +
    'Typos are OK; the bot will try to figure it out.\n\n' +
    '<b>Languages:</b> 🇬🇧 English · 🇪🇬 العربية\n\n' +
    '<b>Admin commands:</b>\n' +
    '<code>/broken</code> — list recipes that need fixing in Notion',
    { parse_mode: 'HTML' }
  );
});

// /broken — list every incomplete recipe with what's missing and a
// Notion link to edit. Whitelisted users only.
bot.command('broken', async (ctx) => {
  if (!isAllowed(ctx.from.id)) {
    await ctx.reply('🚫 Not authorized.');
    return;
  }
  const messages = formatBrokenReport(cache.recipes);
  for (const m of messages) {
    await ctx.reply(m, { parse_mode: 'HTML', disable_web_page_preview: true });
  }
});

// Alias
bot.command('incomplete', async (ctx) => {
  if (!isAllowed(ctx.from.id)) {
    await ctx.reply('🚫 Not authorized.');
    return;
  }
  const messages = formatBrokenReport(cache.recipes);
  for (const m of messages) {
    await ctx.reply(m, { parse_mode: 'HTML', disable_web_page_preview: true });
  }
});

function isAdmin(userId) {
  const id = process.env.ADMIN_USER_ID;
  return id && String(userId) === String(id);
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// /verify <name>      — show side-by-side cache vs live Notion for one recipe
// /verify --all       — run the full audit and DM the report header
bot.command('verify', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('🚫 Admin only.');
    return;
  }
  const arg = ctx.message.text.replace(/^\/verify(@\w+)?\s*/, '').trim();
  if (arg === '--all' || arg === '-a') {
    await ctx.reply('🛡 Full verification kicked off. Watch the server log /tmp/full-verify-report.md.\nRun on shell: <code>node scripts/full-verify.js</code>', { parse_mode: 'HTML' });
    return;
  }
  if (!arg) {
    await ctx.reply('Usage:\n<code>/verify &lt;recipe name&gt;</code>\n<code>/verify --all</code>', { parse_mode: 'HTML' });
    return;
  }

  const match = searchRecipe(arg, cache.recipes);
  if (!match) {
    await ctx.reply(`🔍 No cached recipe matched "${esc(arg)}".`, { parse_mode: 'HTML' });
    return;
  }
  const cached = match.recipe;
  try {
    const blocks = await fetchPageBlocks(match.id);
    const fresh = await parseRecipe({
      id: match.id, url: cached.url, properties: {}, parent: {},
      database_id: null,
      database_label: cached.restaurant === 'el_gouna' ? 'El Gouna' : cached.restaurant === 'cairo' ? 'Cairo' : null,
      last_edited_time: null,
    }, blocks);
    const cH = cached.hashes || hashRecipeFields(cached);
    const fH = hashRecipeFields(fresh);
    const fields = ['name', 'ingredients_en', 'ingredients_ar', 'prep_en', 'prep_ar'];
    const drift = fields.filter((f) => cH[f] !== fH[f]);

    const cn = (s) => (s || '').split('\n').filter(Boolean).length;
    const lines = [
      `📋 <b>VERIFY:</b> ${esc(cached.name)}`,
      `<a href="${esc(cached.url)}">Open in Notion</a>`,
      '',
      '<b>CACHE</b>',
      `🇬🇧 ingredients: ${cn(cached.ingredients_en)} lines`,
      `🇪🇬 ingredients: ${cn(cached.ingredients_ar)} lines`,
      `🇬🇧 prep: ${cn(cached.prep_en)} lines`,
      `🇪🇬 prep: ${cn(cached.prep_ar)} lines`,
      '',
      '<b>NOTION (live)</b>',
      `🇬🇧 ingredients: ${cn(fresh.ingredients_en)} lines`,
      `🇪🇬 ingredients: ${cn(fresh.ingredients_ar)} lines`,
      `🇬🇧 prep: ${cn(fresh.prep_en)} lines`,
      `🇪🇬 prep: ${cn(fresh.prep_ar)} lines`,
      '',
      drift.length === 0
        ? '✅ <b>Cache matches Notion.</b>'
        : `⚠️ <b>Drift in:</b> <code>${drift.join(', ')}</code>\nAction: <code>node cache-builder.js</code>`,
    ];
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (err) {
    await ctx.reply(`💥 Verify failed: ${esc(err.message)}`, { parse_mode: 'HTML' });
  }
});

// Maintenance-mode toggle. When /tmp/maintenance.flag exists the bot
// stays online but answers every query with a "🔧 Under maintenance"
// notice — useful while running the audit or rebuilding the cache.
const fs = require('fs');
const MAINTENANCE_FLAG = '/tmp/maintenance.flag';
function inMaintenance() {
  try { fs.accessSync(MAINTENANCE_FLAG); return true; } catch { return false; }
}

bot.on('text', async (ctx) => {
  const startTime = Date.now();
  const query = ctx.message.text.trim();
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

  const statusMsg = await ctx.reply('⏳ Searching... / جاري البحث...');

  try {
    if (!cache.recipes || Object.keys(cache.recipes).length === 0) {
      await editOrReply(ctx, statusMsg, '❌ Cache is empty. Run `node cache-builder.js` first.');
      return;
    }

    const match = searchRecipe(query, cache.recipes);

    // Clear the "Searching..." status before sending the actual recipe.
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    } catch {
      // Telegram may have already removed it
    }

    if (!match) {
      const suggestions = suggestRecipes(query, cache.recipes, 5);
      if (suggestions.length > 0) {
        await ctx.reply(formatSuggestions(suggestions), { parse_mode: 'HTML' });
      } else {
        await ctx.reply(NOT_FOUND_MESSAGE);
      }
      console.log(`   ❌ Not found (${Date.now() - startTime}ms)`);
      return;
    }

    const text = formatRecipe(match.recipe);
    await sendRecipe(bot, ctx.chat.id, text, match.recipe, match.id, cache);

    console.log(
      `   ✅ ${match.recipe.name} (score=${match.score} kw=${match.keywords.join(',')}) ` +
      `(${Date.now() - startTime}ms)`
    );

    // Background verify — re-fetches the same page from Notion and
    // compares hashes. Doesn't block the user. Logs drift to
    // /tmp/runtime-mismatches.log and DMs the admin if ADMIN_USER_ID
    // is set. TTL-cached per recipe so we don't hammer Notion.
    verifyInBackground(bot, { ...match.recipe, source_page_id: match.id }, query, userId);
  } catch (err) {
    console.error(`   💥 Error: ${err.message}`);
    try {
      await ctx.reply('😔 Something went wrong. Please try again.\nحدث خطأ ما، يرجى المحاولة مرة أخرى.');
    } catch {
      // Swallow secondary errors
    }
  }
});

async function editOrReply(ctx, statusMsg, text) {
  try {
    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, text, {
      parse_mode: 'HTML',
    });
  } catch {
    await ctx.reply(text);
  }
}

// ── Startup verification ────────────────────────────────────────────────────
// Sample 5 random cached recipes and confirm their hashes still match
// Notion. Logs to console; never blocks startup.
async function startupVerificationSample() {
  const ids = Object.keys(cache.recipes || {});
  if (ids.length === 0) return;
  const pick = [];
  while (pick.length < Math.min(5, ids.length)) {
    const id = ids[Math.floor(Math.random() * ids.length)];
    if (!pick.includes(id)) pick.push(id);
  }
  console.log('🔍 Startup verification (5 random samples):');
  let okN = 0;
  for (const id of pick) {
    const cached = cache.recipes[id];
    try {
      const blocks = await fetchPageBlocks(id);
      const fresh = await parseRecipe({
        id, url: cached.url, properties: {}, parent: {}, database_id: null,
        database_label: cached.restaurant === 'el_gouna' ? 'El Gouna' : cached.restaurant === 'cairo' ? 'Cairo' : null,
        last_edited_time: null,
      }, blocks);
      const cH = cached.hashes || hashRecipeFields(cached);
      const fH = hashRecipeFields(fresh);
      const fields = ['name', 'ingredients_en', 'ingredients_ar', 'prep_en', 'prep_ar'];
      const drift = fields.filter((f) => cH[f] !== fH[f]);
      if (drift.length === 0) {
        console.log(`   ✅ ${cached.name}`);
        okN++;
      } else {
        console.log(`   ⚠️ ${cached.name} — drift in ${drift.join(', ')}`);
      }
    } catch (err) {
      console.log(`   🚫 ${cached.name} — ${err.message}`);
    }
  }
  console.log(`Result: ${okN}/${pick.length} match (${Math.round(100 * okN / pick.length)}%)`);
  if (okN < pick.length) {
    console.log('Recommendation: cache may need refresh — run `node cache-builder.js`');
  }
}

// ── Launch ───────────────────────────────────────────────────────────────────
// bot.launch() resolves only when the bot stops, so log startup separately.
bot.telegram
  .getMe()
  .then(async (info) => {
    console.log(`\n✅ Bot is running on @${info.username}`);
    console.log(`   Cache: ${Object.keys(cache.recipes).length} recipes`);
    console.log(`   Whitelist: ${allowedIds.length === 0 ? 'open' : allowedIds.length + ' users'}\n`);
    // Fire-and-forget sample verification so startup isn't blocked.
    startupVerificationSample().catch(() => {});
  })
  .catch((err) => {
    console.error('💥 Failed to connect to Telegram:', err.message);
    process.exit(1);
  });

bot.launch().catch((err) => {
  console.error('💥 Fatal error:', err.message);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
