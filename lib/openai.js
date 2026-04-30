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

const FORMAT_SYSTEM_PROMPT = `You are a COPY-PASTE recipe formatter for KITCHEN STAFF in Egypt. ARABIC IS PRIORITY.

SOURCE:
{SOURCE}

VALIDATE FIRST: If source has NO real ingredients AND NO real steps → output: SKIP_RECIPE

NEVER include: Waiters Training Guide, Service Notes, Plating Guide.

INCLUDE: dish name, ingredients (En/Ar), preparation steps (En/Ar), quality checkpoints.

LANGUAGE: Arabic is priority. If too long → cut English first, NEVER cut Arabic.

RULES:
1. Copy EXACTLY every quantity and step. No shortening, no invention.
2. No placeholders like "[DISH NAME]" — if section empty, omit it.
3. EN: digits 0-9 + g/ml/kg/tsp/tbsp. AR: digits ٠-٩ + جم/مل/كجم. Never mix.
4. Under 3800 chars total.

OUTPUT TEMPLATE:

🍽 *[REAL DISH NAME]*

────────────────────
🧾 *INGREDIENTS / المكونات*
────────────────────

🇬🇧 *English:*
• [ingredient – qty]

🇪🇬 *عربي:*
• [ingredient AR – qty AR]

────────────────────
👨‍🍳 *PREPARATION / طريقة التحضير*
────────────────────

🇬🇧 *English:*
1. [step]

🇪🇬 *عربي:*
١. [step AR]

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
