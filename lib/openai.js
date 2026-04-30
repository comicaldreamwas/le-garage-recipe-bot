'use strict';

const OpenAI = require('openai');

let openaiClient;

function getClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return openaiClient;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt 1: Find a recipe ID from user query
// ─────────────────────────────────────────────────────────────────────────────

const SEARCH_SYSTEM_PROMPT = `Match user dish query to recipe ID. User may write in English, Arabic, Ukrainian or Russian — translate mentally.

RECIPES (NAME = ID):
{RECIPES_LIST}

RULES:
- Names are ENGLISH-CAPITAL-DASHES. Match by keywords.
- Never substitute: SAUCE≠OIL, SALAD≠SOUP, CHICKEN≠BEEF.
- Typos OK. Skip generic names with no dish (e.g. "Le-Garage").
- No confident match → NONE.

OUTPUT: ONLY the 36-char UUID with dashes, or NONE.`;

/**
 * Find the Notion page ID for a dish from user query.
 * @param {string} userMessage - raw user input (any language)
 * @param {string} recipesList - newline-separated "slug = id" pairs from cache
 * @returns {string|null} recipe ID or null if not found
 */
async function findRecipeId(userMessage, recipesList) {
  const client = getClient();

  const systemPrompt = SEARCH_SYSTEM_PROMPT.replace('{RECIPES_LIST}', recipesList);

  const response = await client.chat.completions.create({
    model: 'llama-3.1-8b-instant',
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

const FORMAT_SYSTEM_PROMPT = `You are a COPY-PASTE recipe formatter for KITCHEN STAFF in Egypt.

SOURCE:
{SOURCE}

VALIDATE FIRST: If source has NO real ingredients AND NO real steps → output: SKIP_RECIPE

NEVER include: Waiters Training Guide, Service Notes, Plating Guide, anything about waiters or guests.

INCLUDE: dish name, ingredients, preparation steps, quality checkpoints.

CRITICAL LANGUAGE RULES:
- 🇬🇧 English sections: write ONLY in English (translate if source is Arabic).
- 🇪🇬 Arabic sections: write ONLY in Arabic (translate if source is English).
- If source has only one language, translate the other yourself.
- Arabic digits (٠١٢٣٤٥٦٧٨٩) in Arabic sections. Western digits (0123456789) in English sections. Never mix.
- If text is too long → cut English first, NEVER cut Arabic.

NUMBERING RULES:
- English steps: 1. 2. 3. 4. ... (sequential, never repeat)
- Arabic steps: ١. ٢. ٣. ٤. ... (sequential Arabic digits, never repeat)
- Bullet lists use • only (not numbers)

OTHER RULES:
1. Copy EXACTLY every quantity. No shortening, no invention.
2. No placeholders — if a section has no real data, omit it entirely.
3. Under 3800 chars total.

OUTPUT TEMPLATE:

🍽 *[DISH NAME IN BOTH: English / عربي]*

────────────────────
🧾 *INGREDIENTS / المكونات*
────────────────────

🇬🇧 *English:*
• [ingredient in English – qty in Western digits + g/ml/kg]

🇪🇬 *عربي:*
• [مكون بالعربي – كمية بأرقام عربية + جم/مل/كجم]

────────────────────
👨‍🍳 *PREPARATION / طريقة التحضير*
────────────────────

🇬🇧 *English:*
1. [step in English]
2. [step in English]

🇪🇬 *عربي:*
١. [خطوة بالعربي]
٢. [خطوة بالعربي]

CRITICAL: No real data → SKIP_RECIPE. Never use placeholders.`;

/**
 * Format raw Notion block text into a Telegram-ready recipe message.
 * @param {string} sourceText - raw text extracted from Notion blocks
 * @returns {string|null} formatted recipe text or null if recipe should be skipped
 */
async function formatRecipe(sourceText) {
  const client = getClient();

  const systemPrompt = FORMAT_SYSTEM_PROMPT.replace('{SOURCE}', sourceText);

  const response = await client.chat.completions.create({
    model: 'llama-3.1-8b-instant',
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
