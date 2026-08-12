# 🍽 Le Garage Recipe Bot

Telegram bot for kitchen staff at **Le Garage** restaurant (Cairo + El Gouna). Staff send a dish name in English or Arabic; the bot replies with the full recipe (ingredients + preparation), plus the dish photo and video.

**Speed:** 1–2 s response. **Cost:** zero — no AI APIs. Content comes verbatim from Notion through a deterministic parser; quantities are never rewritten.

---

## Setup

Requirements: Node.js 20+, a Notion integration with access to the recipe databases, a Telegram bot token from [@BotFather](https://t.me/BotFather).

```bash
git clone https://github.com/comicaldreamwas/le-garage-recipe-bot.git
cd le-garage-recipe-bot
npm install
cp .env.example .env   # fill in tokens + DB ids
node cache-builder.js  # ~10 min on first run
node bot.js
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | From @BotFather |
| `NOTION_TOKEN` | ✅ | Notion integration token (`ntn_...`) |
| `NOTION_PARENT_EL_GOUNA` | optional | El Gouna database ID (default baked in) |
| `NOTION_PARENT_CAIRO` | optional | Cairo database ID (default baked in) |
| `ALLOWED_USER_IDS` | dead | The old whitelist. Ignored entirely — never imported, so nobody is grandfathered in. See [Staff access](#staff-access) |
| `ADMIN_USER_ID` | optional | Receives drift alerts, unlocks `/verify`, and manages the staff whitelist. Defaults to the owner id in `bot.js` — set only to hand the bot to a different admin |
| `ADMIN_USERNAME` | optional | Handle shown to blocked users. Defaults to the owner handle in `bot.js` |

---

## Staff access

Only staff on the whitelist get recipes. The list lives in `allowed-users.json`
next to the cache — gitignored, so a deploy never overwrites it — and is managed
entirely from Telegram by `ADMIN_USER_ID`.

| Command | Result |
|---|---|
| `/users` | The roster: name, id, when added, when last seen |
| `/adduser <id> <name>` | Grant access, e.g. `/adduser 583920144 Ahmed (kitchen)` |
| `/deluser <id \| @username \| name>` | Revoke access |
| `/import` | One-off: seed the list from everyone who used the bot before it was closed |
| `/whoami` | Anyone's own Telegram id |

**Onboarding.** A new cook writes to the bot, gets `🚫 Access closed` with their
id, and forwards it to the manager, who runs `/adduser`.

**Offboarding.** `/deluser` takes effect on that person's very next message —
no restart, no deploy, and it propagates to the other bot process within one
message because both re-read the file when it changes. Recipes already sent
stay in their Telegram history; the bot cannot retract those.

**Scoped per restaurant.** `allowed-users.json` holds a `le_garage` and a `boho`
section, and each process only reads and writes its own — set by
`RESTAURANT_MODE`. Boho staff cannot use the Le Garage bot, and revoking someone
in one does not touch the other.

**The roster starts empty**, so on the first deploy everyone except the admin is
locked out at once and re-admitted deliberately via `/adduser`. `/import` exists
to carry the old open-access users over instead, but it was deliberately *not*
run here. Every blocked attempt is logged with id and handle, so
`pm2 logs recipe-bot-boho` doubles as the list of people waiting to be added.

---

## Commands

### Shell (operator)

| Command | Purpose |
|---|---|
| `node cache-builder.js` | Rebuild `recipes-cache.json` from Notion (skips entries fresher than 7 days) |
| `node scripts/full-verify.js` | Re-fetch every recipe and confirm cache hashes still match Notion |
| `node audit.js` | List duplicate slugs, empty placeholders, orphan pages |
| `node scripts/find-restaurants.js` | Print every database accessible to the integration with row counts |

### Telegram (admin-gated by `ADMIN_USER_ID`)

| Command | Result |
|---|---|
| `/verify <name>` | Side-by-side cache vs live Notion line count for one recipe |
| `/broken` | List recipes missing ingredients in either language |
| `/incomplete` | List recipes with partial content (no prep, no media, …) |

### Telegram (kitchen)

Just send the dish name in EN or AR:

| Input | Result |
|---|---|
| `mushroom sauce` | Mushroom Sauce |
| `chicken alfredo` | Chicken Alfredo Pasta |
| `mushrum sauce` (typo) | Mushroom Sauce — fuzzy matched |
| `🍕 pizza please` | Pizza — emoji + stop words stripped |
| `صلصة الترفل` | Truffle Sauce |
| `xyz` | "Did you mean…" suggestions if any keyword overlaps |

---

## Architecture

```
le-garage-recipe-bot/
├── bot.js              — Telegraf bot, hot-reloads cache, runs runtime verify
├── cache-builder.js    — fetches Notion, dedupes, parses, writes recipes-cache.json
├── audit.js            — duplicate / orphan / drift audit (offline)
├── scripts/
│   ├── full-verify.js  — full re-fetch + hash compare
│   └── find-restaurants.js
├── lib/
│   ├── notion.js       — Notion API helpers
│   ├── parser.js       — block tree → { ingredients_en, ingredients_ar, prep_en, prep_ar, hashes, … }
│   ├── search.js       — keyword extraction + opposites + slug scoring
│   ├── dictionary.js   — EN + AR translation map
│   ├── normalize.js    — emoji / stop-word stripping
│   ├── fuzzy.js        — Levenshtein typo tolerance
│   ├── format.js       — static bilingual recipe template
│   ├── cache.js        — atomic save + file watcher (hot-reload)
│   ├── verify.js       — non-blocking runtime drift verifier
│   └── telegram.js     — sendRecipe (text + photo + video, file_id cache)
└── recipes-cache.json  — generated, gitignored
```

### How a query is served

1. Normalize input (lower-case, strip emoji and stop words).
2. Match multi-word phrases first (`goat cheese` → `GOAT-CHEESE`), then single words. Each word: exact → Arabic-article strip → Levenshtein fuzzy.
3. Score every cached recipe by how many keywords its URL slug contains. Reject candidates that violate `OPPOSITES` (`SAUCE`≠`OIL`, `SALAD`≠`SOUP`, `CHICKEN`≠`BEEF`, `BURGER`≠`SANDWICH`).
4. Return highest score; on no match, send `Did you mean…` suggestions.
5. Bot reads the cached `recipe.ingredients_en`, `ingredients_ar`, `prep_en`, `prep_ar` and renders the static EN+AR template. Photo + video are fetched once and the resulting `file_id` is cached.
6. Asynchronously: re-fetch the same page from Notion, parse it, hash the fields, compare against cached hashes. Drift → log to `/tmp/runtime-mismatches.log` and DM the admin. TTL-limited to once per recipe per 10 min.

To add a new dish keyword, edit [lib/dictionary.js](lib/dictionary.js).

---

## Production deployment

Tested on Ubuntu 22.04 with PM2.

```bash
git clone https://github.com/comicaldreamwas/le-garage-recipe-bot.git /opt/le-garage-recipe-bot
cd /opt/le-garage-recipe-bot
npm install --omit=dev
cp .env.example .env && nano .env
node cache-builder.js
npm install -g pm2
pm2 start bot.js --name recipe-bot
pm2 save
pm2 startup
```

### Maintenance flag

Touch `/tmp/maintenance.flag` to pause the bot for users (it replies "🔧 Under maintenance") and to make `autodeploy.sh` skip its 5-minute cycle. Remove the file to resume.

### Auto-deploy (cron)

`/opt/autodeploy.sh` runs every 5 minutes from `crontab`: it git-pulls, `pm2 restart`s, and skips entirely while `/tmp/maintenance.flag` exists. Disable by commenting the line in `crontab -l`.

### Weekly cache rebuild

```
0 3 * * 0 cd /opt/le-garage-recipe-bot && node cache-builder.js >> /var/log/recipe-cache.log 2>&1
```

The bot hot-reloads `recipes-cache.json` automatically.

---

## License

MIT
