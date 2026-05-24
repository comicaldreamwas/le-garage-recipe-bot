'use strict';

// PM2 ecosystem for two single-codebase bot processes:
//   - recipe-bot       Le Garage (multi-restaurant mode by default;
//                      respects user-preferences.json per Telegram user)
//   - recipe-bot-boho  Boho Cafe (single-restaurant mode; everyone gets
//                      Boho regardless of /restaurant or preferences)
//
// Both processes share /opt/le-garage-recipe-bot/recipes-cache.json and
// listen for cache changes via lib/cache.js watchCache. Cache-builder
// is run once and populates both restaurant slots.
//
// Start both:
//   pm2 reload /opt/le-garage-recipe-bot/ecosystem.config.js
//
// node_args / cwd / script paths are intentionally minimal so the same
// file works locally for testing and on the VPS where /opt/... is the
// canonical project root.

module.exports = {
  apps: [
    {
      name: 'recipe-bot',
      script: 'bot.js',
      cwd: '/opt/le-garage-recipe-bot',
      env_file: '.env',           // Le Garage — RESTAURANT_MODE unset or 'multi'
      out_file: '/root/.pm2/logs/recipe-bot-out.log',
      error_file: '/root/.pm2/logs/recipe-bot-error.log',
      max_memory_restart: '300M',
    },
    {
      name: 'recipe-bot-boho',
      script: 'bot.js',
      cwd: '/opt/le-garage-recipe-bot',
      env_file: '.env.boho',      // RESTAURANT_MODE=boho + Boho bot token
      out_file: '/root/.pm2/logs/recipe-bot-boho-out.log',
      error_file: '/root/.pm2/logs/recipe-bot-boho-error.log',
      max_memory_restart: '300M',
    },
  ],
};
