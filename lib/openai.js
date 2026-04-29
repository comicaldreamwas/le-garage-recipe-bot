'use strict';

const OpenAI = require('openai');

let openaiClient;

function getClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt 1: Find a recipe ID from user query
// ─────────────────────────────────────────────────────────────────────────────

const SEARCH_SYSTEM_PROMPT = `Return Notion page ID for the dish user asked.

RECIPES (URL = ID):
{RECIPES_LIST}

───────────────────────────
TRANSLATION DICTIONARY:
───────────────────────────
MEATS:
- chicken / курица / курка / دجاج / فراخ → CHICKEN
- beef / говядина / لحم / لحمة → BEEF
- fish / риба / Сиба / سمك → FISH
- shrimp / креветки / جمبري → SHRIMP
- salmon / лосось / سلمون → SALMON
- lamb / حلو → LAMB

VEGGIES:
- mushroom / гриб / грибний / فطر / مشروم → MUSHROOM
- pumpkin / гарбуз / قطقوط / قرع → PUMPKIN
- avocado / авокадо / أفوكادو → AVOCADO
- carrot / морква / جزر → CARROT
- ginger / імбир / زنجبيل → GINGER
- lentil / сочевиця / عدس → LENTIL
- tomato / помідор / طماطم → TOMATO
- onion / цибуля / بصل → ONION

DISHES:
- soup / суп / شوربة → SOUP
- salad / салат / سلطة → SALAD
- pasta / паста / مكرونة → PASTA
- pizza / піца / بيتزا → PIZZA
- burger / бургер → BURGER
- sandwich / сандвіч / ساندويتش → SANDWICH
- steak / стейк → STEAK
- fillet / філе / فيليه → FILLET
- nachos / начос → NACHOS
- omelette / омлет / عجة → OMELETTE
- toast / тост / توست → TOAST

CHEESES:
- cheese / сир / سير / جبنة → CHEESE
- goat cheese / козячий сир / جبنة ماعز → GOAT-CHEESE
- blue cheese / блю / blue → BLUE-CHEESE
- halloumi / حلومي → HALLOUMI
- mozzarella / моцарелла → MOZZARELLA
- parmesan / пармезан → PARMESAN

SAUCES/OILS:
- sauce / соус / صوصة → SAUCE
- oil / олія / زيت → OIL (NEVER confuse with SAUCE!)
- butter / масло / زبدة → BUTTER
- mayo / mayonnaise → MAYO

OTHER:
- bread / хліб / خبز / عيش → BREAD
- cream / крем → CREAM
- truffle / трюфель / كمأة → TRUFFLE
- buffalo → BUFFALO
- alfredo → ALFREDO
- tartar → TARTAR
- cordon bleu → CORDON-BLEU
- schnitzel / шніцель → SCHNITZEL
- nuggets → NUGGETS
- kebab → KEBAB
- bolognese → BOLOGNESE
- caesar / цезар → CAESAR
- benedict / бенедікт → BENEDICT
- panna cotta / панакота → PANNA-COTTA
- lava cake → LAVA-CAKE
- crumble → CRUMBLE

RULES:
1. URL contains dish name in CAPITAL-DASHES.
2. Translate user input using dictionary.
3. Score each URL by keyword matches.
4. CRITICAL OPPOSITES — never substitute:
   - SAUCE ≠ OIL
   - SALAD ≠ SOUP
   - CHICKEN ≠ BEEF
   - SOUP ≠ SAUCE
5. Typos OK.
6. If best match has only 1 of 2 keywords — return NONE.
7. Skip generic pages (just "Le-Garage" with no dish).

OUTPUT: ONLY 36-char ID with dashes, OR word NONE.`;

/**
 * Find the Notion page ID for a dish from user query.
 * @param {string} userMessage - raw user input (any language)
 * @param {string} recipesList - newline-separated "url = id" pairs from cache
 * @returns {string|null} recipe ID or null if not found
 */
async function findRecipeId(userMessage, recipesList) {
  const client = getClient();

  const systemPrompt = SEARCH_SYSTEM_PROMPT.replace('{RECIPES_LIST}', recipesList);

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 50,
    temperature: 0,
  });

  const result = response.choices[0]?.message?.content?.trim();
  if (!result || result === 'NONE') return null;

  // Validate UUID format: 8-4-4-4-12
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(result)) return null;

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt 2: Format recipe blocks into Telegram-ready text
// ─────────────────────────────────────────────────────────────────────────────

const FORMAT_SYSTEM_PROMPT = `You are a COPY-PASTE recipe formatter for KITCHEN STAFF in Egypt. ARABIC IS PRIORITY.

SOURCE:
{SOURCE}

───────────────────────────
FIRST: VALIDATE SOURCE
───────────────────────────
If source has NO real ingredients AND NO real preparation steps → output: SKIP_RECIPE

───────────────────────────
NEVER include:
───────────────────────────
✗ Waiters Training Guide
✗ Dish Description / Service Notes / Plating Guide
✗ Anything about waiters or guest service

───────────────────────────
INCLUDE:
───────────────────────────
✓ Real dish name (extract from source heading)
✓ Real ingredients (En and/or Ar)
✓ Real preparation (En and/or Ar)
✓ Real quality checkpoints (if present)

───────────────────────────
LANGUAGE PRIORITY:
───────────────────────────
Egyptian kitchen → ARABIC IS PRIORITY.
If too long → cut English first, keep Arabic.
NEVER cut Arabic.

───────────────────────────
ABSOLUTE RULES:
───────────────────────────
1. COPY EXACTLY every quantity, step, ingredient. NO shortening.
2. NO INVENTION — never invent quantities or steps.
3. NEVER USE PLACEHOLDERS like "[DISH NAME]", "FULL step", "item – qty". If section has no real data → OMIT entire section.
4. EN: digits 0-9 + g/ml/kg/tsp/tbsp. AR: digits ٠-٩ + جم/مل/كجم. NEVER mix.
5. Skip empty subsections.
6. Under 3800 chars (Telegram limit is 4096).

───────────────────────────
OUTPUT TEMPLATE:
───────────────────────────

🍽 *[REAL DISH NAME]*

────────────────────
🧾 *INGREDIENTS / المكونات*
────────────────────

🇬🇧 *English:*
• [real ingredient – real qty]

🇪🇬 *عربي:*
• [real ingredient AR – real qty AR]

────────────────────
👨‍🍳 *PREPARATION / طريقة التحضير*
────────────────────

🇬🇧 *English:*
1. [real step]

🇪🇬 *عربي:*
١. [real step AR]

CRITICAL: If no real recipe data → output SKIP_RECIPE. Never output template with placeholders.`;

/**
 * Format raw Notion block text into a Telegram-ready recipe message.
 * @param {string} sourceText - raw text extracted from Notion blocks
 * @returns {string|null} formatted recipe text or null if recipe should be skipped
 */
async function formatRecipe(sourceText) {
  const client = getClient();

  const systemPrompt = FORMAT_SYSTEM_PROMPT.replace('{SOURCE}', sourceText);

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Format this recipe.' },
    ],
    max_tokens: 2000,
    temperature: 0.1,
  });

  const result = response.choices[0]?.message?.content?.trim();
  if (!result || result === 'SKIP_RECIPE') return null;

  return result;
}

module.exports = { findRecipeId, formatRecipe };
