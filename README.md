# 🍽 Le Garage Recipe Bot — v2 (no AI)

Telegram bot for kitchen staff at **Le Garage restaurant (Cairo)**. Staff send a dish name in English or Arabic, and the bot replies with the full recipe (ingredients + preparation steps), plus the dish photo and video.

**Speed:** 1–2 s response. **Cost:** zero — no AI APIs.

Recipes come straight from Notion. The bot uses a hand-curated translation dictionary plus Levenshtein fuzzy matching to map free-form input to the right recipe slug.

---

## Why no AI?

The previous version called Groq/LLaMA for both search and bilingual formatting. That worked, but:

- API calls add 2–5 s of latency per request.
- LLMs occasionally rewrite quantities (a kitchen disaster).
- Rate limits and token costs creep up at scale.

This version is fully deterministic. Add a new recipe to Notion → run `cache-builder.js` → it appears in the bot exactly as written.

---

## Architecture

```
le-garage-recipe-bot/
├── lib/
│   ├── dictionary.js   — EN+AR translation map + opposites
│   ├── normalize.js    — strip emoji, punctuation, stop words
│   ├── fuzzy.js        — Levenshtein-based typo tolerance
│   ├── search.js       — keyword extraction + opposites scoring + suggestions
│   ├── format.js       — static recipe template (EN + AR)
│   ├── parser.js       — Notion blocks → structured cache entry
│   ├── notion.js       — Notion API helpers
│   ├── cache.js        — atomic load/save + hot-reload watcher
│   └── telegram.js     — send recipe text + photo + video
├── bot.js              — Telegram bot (PM2-managed in prod)
├── cache-builder.js    — rebuilds recipes-cache.json from Notion
├── .env.example
└── recipes-cache.json  — generated, gitignored
```

### How search works

1. Normalize: lower-case, strip emoji and punctuation, drop EN+AR stop words (`please`, `من فضلك`, …).
2. Multi-word phrases first (e.g. `goat cheese` → `GOAT-CHEESE`), then individual words.
3. Each word goes through exact-match → Arabic-article strip (`الترفل` → `ترفل`) → Levenshtein fuzzy match (1 edit for 3–4 chars, 2 edits for 5+).
4. Score every cached recipe by how many keywords its URL slug contains.
5. Reject candidates that violate `OPPOSITES` pairs (`SAUCE`≠`OIL`, `SALAD`≠`SOUP`, `CHICKEN`≠`BEEF`, `BURGER`≠`SANDWICH`).
6. Return the highest score, or `null` if nothing meets the minimum.
7. On `null`, send a "Did you mean / هل تقصد:" list of recipes that share at least one keyword.

To support a new dish keyword, just add its English and Arabic spellings to [lib/dictionary.js](lib/dictionary.js).

---

## Setup

### Requirements

- Node.js 20+
- A Notion integration with access to your recipe workspace
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### Install

```bash
git clone https://github.com/comicaldreamwas/le-garage-recipe-bot.git
cd le-garage-recipe-bot
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `NOTION_TOKEN` | Notion integration token (`ntn_...`) |
| `NOTION_PARENT_ID` | Parent page that scopes which recipes are loaded. Default = Le Garage Menu Cairo. |
| `ALLOWED_USER_IDS` | Comma-separated Telegram user IDs. Empty = open access. |

To find your Telegram user ID, message [@userinfobot](https://t.me/userinfobot).

### Build the cache

```bash
node cache-builder.js
```

Fetches every recipe page from Notion, parses each into `{ ingredients_en, ingredients_ar, prep_en, prep_ar, photo_block_id, video_block_id }`, and writes `recipes-cache.json`. First run takes ~10 min for ~190 recipes; subsequent runs skip pages cached within the last 7 days.

### Start the bot

```bash
node bot.js
```

You should see `✅ Bot is running on @YourBotName`.

---

## Multi-restaurant Notion setup

This Notion integration can be shared by multiple restaurant workspaces.
The bot filters recipe pages by parent: only pages that descend from
`NOTION_PARENT_ID` end up in the cache. Default is **Le Garage Menu Cairo**
(`24e30eca-90bc-80de-8c59-e3c7db23fb60`).

To point the bot at a different restaurant, change `NOTION_PARENT_ID` in
`.env` and re-run `node cache-builder.js`. Without this filter, recipes
with the same name (e.g. "Mushroom Sauce") in different restaurants
would conflict.

---

## Production deployment (VPS)

Tested on Ubuntu 22.04.

```bash
git clone https://github.com/comicaldreamwas/le-garage-recipe-bot.git /opt/le-garage-recipe-bot
cd /opt/le-garage-recipe-bot
npm install --omit=dev
cp .env.example .env && nano .env
node cache-builder.js

npm install -g pm2
pm2 start bot.js --name recipe-bot
pm2 save
pm2 startup     # follow the printed command to enable auto-start
```

### Weekly cache refresh

```bash
crontab -e
```

```
0 3 * * 0 cd /opt/le-garage-recipe-bot && /usr/bin/node cache-builder.js >> cache.log 2>&1
```

This rebuilds the cache every Sunday at 03:00. The bot hot-reloads it automatically.

### Auto-deploy on git push

This repo ships [.github/workflows/deploy.yml](.github/workflows/deploy.yml). Pushing to `master` SSHes into the VPS, pulls, reinstalls, and restarts PM2. Requires the GitHub secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`.

---

## Usage

Send any dish name to the bot:

| Input | Result |
|---|---|
| `mushroom sauce` | Mushroom Sauce recipe |
| `chicken alfredo` | Chicken Alfredo Pasta |
| `mushrum sauce` (typo) | Mushroom Sauce — fuzzy matched |
| `🍕 pizza please` | Pizza — emoji & stop words stripped |
| `صلصة الترفل` | Truffle Sauce |
| `xyz` | "Did you mean…" suggestions if any keyword overlaps |

The bot replies with the recipe in Arabic + English, plus photo and video. First send fetches media URLs from Notion (~2 s); subsequent sends use the cached Telegram `file_id` and are instant.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Telegram bot token |
| `NOTION_TOKEN` | ✅ | Notion integration token |
| `ALLOWED_USER_IDS` | optional | Comma-separated user IDs. Empty = open access. |

No `OPENAI_API_KEY` — the bot does not call any AI service.

---

## License

MIT
