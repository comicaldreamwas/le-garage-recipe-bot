'use strict';

require('dotenv').config();

const { Telegraf } = require('telegraf');
const { loadCache, watchCache } = require('./lib/cache');
const { searchRecipe, suggestRecipes } = require('./lib/search');
const { formatRecipe, formatSuggestions, formatBrokenReport, NOT_FOUND_MESSAGE } = require('./lib/format');
const { sendRecipe } = require('./lib/telegram');

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

bot.on('text', async (ctx) => {
  const startTime = Date.now();
  const query = ctx.message.text.trim();
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || String(userId);

  console.log(`\n📩 [${new Date().toISOString()}] @${username} (${userId}): "${query}"`);

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

// ── Launch ───────────────────────────────────────────────────────────────────
// bot.launch() resolves only when the bot stops, so log startup separately.
bot.telegram
  .getMe()
  .then((info) => {
    console.log(`\n✅ Bot is running on @${info.username}`);
    console.log(`   Cache: ${Object.keys(cache.recipes).length} recipes`);
    console.log(`   Whitelist: ${allowedIds.length === 0 ? 'open' : allowedIds.length + ' users'}\n`);
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
