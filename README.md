# 🍽 Le Garage Recipe Bot

Telegram bot for kitchen staff at **Le Garage restaurant (Cairo)**. Staff send a dish name in any language — the bot replies with the full recipe (ingredients + preparation steps) in Arabic and English, plus a photo and video if available.

**Speed:** 2–5 seconds vs. 15–30 seconds with the previous Make.com integration.

---

## Features

- Accepts dish names in Arabic, English, Ukrainian, or Russian
- Returns formatted bilingual recipes (Arabic priority)
- Sends recipe photo and video from Notion
- User whitelist — only authorized staff can use it
- Weekly cache build — no live Notion API calls during normal use
- Auto-reloads cache when `cache-builder.js` updates it

---

## Project Structure

```
le-garage-recipe-bot/
├── lib/
│   ├── cache.js       — cache load/save/watch
│   ├── notion.js      — Notion API helpers (pages, blocks, file URLs)
│   ├── openai.js      — OpenAI helpers (recipe search + formatting)
│   └── telegram.js    — send recipe text + photo + video
├── bot.js             — main Telegram bot (runs continuously)
├── cache-builder.js   — builds recipes-cache.json from Notion
├── .env.example       — environment variable template
└── recipes-cache.json — generated cache (gitignored)
```

---

## Setup

### 1. Requirements

- Node.js 20+
- A Notion integration with access to the recipe workspace
- OpenAI API key (GPT-4o-mini for search, GPT-4o for formatting)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### 2. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/le-garage-recipe-bot.git
cd le-garage-recipe-bot
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
nano .env   # or use any editor
```

Fill in:

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `NOTION_TOKEN` | Notion integration secret (`ntn_...`) |
| `OPENAI_API_KEY` | OpenAI API key (`sk-...`) |
| `ALLOWED_USER_IDS` | Comma-separated Telegram user IDs |

To find your Telegram user ID, message [@userinfobot](https://t.me/userinfobot).

### 4. Build the cache

```bash
node cache-builder.js
```

This fetches all ~190 recipes from Notion, formats them with OpenAI, and saves to `recipes-cache.json`. Takes **15–20 minutes** on first run.

Subsequent runs skip recipes already cached (< 7 days old) and finish in **1–2 minutes**.

### 5. Start the bot

```bash
node bot.js
```

Console output: `✅ Bot is running on @YourBotName`

---

## Production Deployment (VPS)

Tested on Ubuntu 22.04. Recommended VPS region: Frankfurt or Amsterdam (low latency to Egypt + Notion US-West API).

### Install PM2

```bash
npm install -g pm2
```

### Start with PM2

```bash
pm2 start bot.js --name recipe-bot
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot
```

### Check logs

```bash
pm2 logs recipe-bot
pm2 status
```

### Weekly cache refresh (cron)

```bash
crontab -e
```

Add:
```
0 3 * * 0 cd /path/to/le-garage-recipe-bot && node cache-builder.js >> cache.log 2>&1
```

This runs every Sunday at 3:00 AM.

---

## Usage

Send any dish name to the bot:

| Language | Example |
|---|---|
| English | `truffle sauce` |
| Ukrainian | `грибний соус` |
| Russian | `грибной соус` |
| Arabic | `صوصة الترافل` |

The bot replies with the full recipe in Arabic + English, plus photo and video.

---

## How It Works

1. **Cache builder** (`cache-builder.js`) fetches all recipe pages from Notion, extracts block content (including toggle and table children), formats with OpenAI, and saves to `recipes-cache.json`.

2. **Bot** (`bot.js`) listens for messages, sends "⏳ Searching..." immediately, then uses OpenAI to find the recipe ID from the cached list. Serves formatted text + photo + video from cache. Falls back to live Notion fetch if recipe is missing from cache.

3. **Photo/video optimization**: first send uses Notion URL (~2s). Telegram returns a `file_id` which is saved to cache — subsequent sends use the `file_id` and are instant (<500ms).

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Telegram bot token |
| `NOTION_TOKEN` | ✅ | Notion integration token |
| `OPENAI_API_KEY` | ✅ | OpenAI API key |
| `ALLOWED_USER_IDS` | ✅ | Comma-separated allowed Telegram user IDs |

---

## License

MIT
