'use strict';

require('dotenv').config();

const { Telegraf } = require('telegraf');
const { loadCache, watchCache } = require('./lib/cache');
const { findRecipeId } = require('./lib/openai');
const { fetchPageBlocks, blocksToText } = require('./lib/notion');
const { formatRecipe } = require('./lib/openai');
const { sendRecipe } = require('./lib/telegram');

// ── Validate env ─────────────────────────────────────────────────────────────
const required = ['TELEGRAM_BOT_TOKEN', 'NOTION_TOKEN', 'OPENAI_API_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing env variable: ${key}`);
    process.exit(1);
  }
}

// ── Load cache (hot-reload on file change) ────────────────────────────────────
let cache = loadCache();
console.log(`📦 Cache loaded: ${Object.keys(cache.recipes).length} recipes`);

watchCache((fresh) => {
  cache = fresh;
  console.log(`🔄 Cache reloaded: ${Object.keys(cache.recipes).length} recipes`);
});

// ── Bot setup ─────────────────────────────────────────────────────────────────
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ── /start command ────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  await ctx.reply(
    '👨‍🍳 *Le Garage Recipe Bot*\n\n' +
    'Send me a dish name in any language:\n' +
    '• English: `truffle sauce`\n' +
    '• Українська: `грибний соус`\n' +
    '• عربي: `صوصة الترافل`\n\n' +
    "I'll find the recipe in seconds!",
    { parse_mode: 'Markdown' }
  );
});

// ── /help command ─────────────────────────────────────────────────────────────
bot.help(async (ctx) => {
  await ctx.reply(
    '📖 *How to use:*\n\n' +
    'Just type the dish name — no commands needed.\n\n' +
    '*Languages supported:*\n' +
    '🇬🇧 English\n🇺🇦 Ukrainian\n🇷🇺 Russian\n🇪🇬 Arabic\n\n' +
    '*Examples:*\n' +
    '• `chicken alfredo`\n' +
    '• `грибний суп`\n' +
    '• `شوربة عدس`',
    { parse_mode: 'Markdown' }
  );
});

// ── Main message handler ──────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const startTime = Date.now();
  const userQuery = ctx.message.text.trim();
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || userId;

  console.log(`\n📩 [${new Date().toISOString()}] @${username} (${userId}): "${userQuery}"`);

  // Instant feedback — psychological speed boost
  const statusMsg = await ctx.reply('⏳ Searching... / جاري البحث...');

  try {
    // ── Step 1: Find recipe ID via OpenAI ──────────────────────────────────
    if (!cache.recipes_text) {
      await editOrReply(ctx, statusMsg, '❌ Cache is empty. Run `node cache-builder.js` first.');
      return;
    }

    const recipeId = await findRecipeId(userQuery, cache.recipes_text);

    if (!recipeId) {
      await editOrReply(
        ctx,
        statusMsg,
        "🤷 Recipe not found.\n\nTry a different name or check the spelling.\nمش لاقي الوصفة، جرب تاني."
      );
      console.log(`   ❌ Not found (${Date.now() - startTime}ms)`);
      return;
    }

    console.log(`   🔍 Recipe ID: ${recipeId}`);

    // ── Step 2: Delete "Searching..." message ──────────────────────────────
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    } catch {
      // Ignore if message already gone
    }

    // ── Step 3: Look up recipe in cache ───────────────────────────────────
    const cached = cache.recipes[recipeId];

    if (cached?.formatted_text) {
      // Fast path: serve from cache
      await sendRecipe(bot, ctx.chat.id, cached, recipeId, cache);
      console.log(`   ✅ Served from cache (${Date.now() - startTime}ms)`);
    } else {
      // Slow path: fetch from Notion and format on the fly
      console.log(`   ⚠️  Not in cache, fetching from Notion...`);
      await ctx.reply('🔄 Fetching fresh from Notion, please wait ~10s...');

      const blocks = await fetchPageBlocks(recipeId);
      const { text: sourceText, photoBlockId, videoBlockId } = await blocksToText(blocks);

      if (!sourceText.trim()) {
        await ctx.reply('❌ Recipe page is empty in Notion.');
        return;
      }

      const formatted = await formatRecipe(sourceText);

      if (!formatted) {
        await ctx.reply('❌ Could not format this recipe. Try another dish.');
        return;
      }

      // Build a temporary recipe object for sending
      const tempRecipe = {
        formatted_text: formatted,
        photo_block_id: photoBlockId || null,
        video_block_id: videoBlockId || null,
        photo_file_id: '',
        video_file_id: '',
      };

      await sendRecipe(bot, ctx.chat.id, tempRecipe, recipeId, cache);
      console.log(`   ✅ Served from Notion fallback (${Date.now() - startTime}ms)`);
    }

  } catch (err) {
    console.error(`   💥 Error: ${err.message}`);
    try {
      await ctx.reply('😔 Something went wrong. Please try again.\nحاجة غلط، جرب تاني.');
    } catch {
      // Ignore reply errors
    }
  }
});

// ── Helper: edit status message or send new one ───────────────────────────────
async function editOrReply(ctx, statusMsg, text) {
  try {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      text
    );
  } catch {
    await ctx.reply(text);
  }
}

// ── Launch ────────────────────────────────────────────────────────────────────
bot.launch()
  .then(() => {
    const botInfo = bot.botInfo;
    console.log(`\n✅ Bot is running on @${botInfo?.username || 'unknown'}`);
    console.log(`   Cache: ${Object.keys(cache.recipes).length} recipes\n`);
  })
  .catch((err) => {
    console.error('💥 Failed to start bot:', err.message);
    process.exit(1);
  });

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
