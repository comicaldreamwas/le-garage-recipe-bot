'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Arabic-name search for recipes (food + drinks). Workers type a dish/drink
// name in Arabic; we match it against:
//   1. curated translations (lib/arabic-recipe-names.js), keyed by EN name, and
//   2. a body-derived Arabic name for drinks (the first bare AR line of the
//      cached ingredients_ar — El Gouna / Cairo bars carry it).
//
// This complements lib/search.js (English slug + curated dictionary). The bot
// only falls back here when the English path isn't confident, so existing
// behaviour is unchanged for English queries.
// ─────────────────────────────────────────────────────────────────────────────

const { distance } = require('fastest-levenshtein');
const { ARABIC_NAMES } = require('./arabic-recipe-names');

const ARABIC_RE = /[؀-ۿ]/;
function hasArabic(s) { return ARABIC_RE.test(s || ''); }

// Normalise an English name the SAME way arabic-recipe-names.js keys are built.
function normEn(s) {
  return String(s || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{20E3}]/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalise Arabic text so spelling variants collapse:
//   - strip tashkeel (harakat), superscript alef, tatweel
//   - unify alef forms (أإآ→ا), yaa (ى/ئ→ي), waw-hamza (ؤ→و), taa marbuta (ة→ه)
//   - drop everything that isn't an Arabic letter or space
function normalizeArabic(s) {
  if (!s) return '';
  let out = String(s);
  out = out.replace(/[ً-ْٰـ]/g, ''); // harakat + superscript alef + tatweel
  out = out.replace(/[آأإ]/g, 'ا');  // آأإ → ا
  out = out.replace(/[ىئ]/g, 'ي');         // ى ئ → ي
  out = out.replace(/ؤ/g, 'و');                  // ؤ → و
  out = out.replace(/ة/g, 'ه');                  // ة → ه
  out = out.replace(/[^؀-ۿ\s]/g, ' ');           // keep only Arabic letters + space
  return out.replace(/\s+/g, ' ').trim();
}

// First "bare" Arabic line of ingredients_ar = the drink's Arabic name
// (no leading bullet, has Arabic, no quantity digit or colon).
function bodyArabicName(recipe) {
  const lines = (recipe?.ingredients_ar || '').split('\n');
  for (const l of lines) {
    const t = l.trim();
    if (!t) continue;
    if (/^[•\-]/.test(t)) continue;
    if (!hasArabic(t)) continue;
    if (/[0-9٠-٩]/.test(t)) continue;
    if (/[:：]/.test(t)) continue;
    return t.replace(/[^؀-ۿ\s]/g, '').trim();
  }
  return null;
}

// All Arabic aliases for a recipe (normalised), translations + body-derived.
function arabicAliases(recipe) {
  const out = new Set();
  const tr = ARABIC_NAMES[normEn(recipe?.name)];
  if (tr) for (const a of tr) { const n = normalizeArabic(a); if (n) out.add(n); }
  const body = bodyArabicName(recipe);
  if (body) { const n = normalizeArabic(body); if (n) out.add(n); }
  return [...out];
}

// Best Arabic name to DISPLAY for a recipe: prefer the authentic body-derived
// name (drinks), else the first curated translation. null when none.
function arabicNameOf(recipe) {
  const body = bodyArabicName(recipe);
  if (body) return body;
  const tr = ARABIC_NAMES[normEn(recipe?.name)];
  return tr && tr.length ? tr[0] : null;
}

// Strip the Arabic definite article "ال" so "السلمون" matches "سلمون".
function stripAl(t) { return t.length > 3 ? t.replace(/^ال/, '') : t; }

// Two tokens match if equal or within one edit (typo tolerance) once the
// definite article is stripped.
function tokenMatch(a, b) {
  a = stripAl(a); b = stripAl(b);
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && Math.abs(a.length - b.length) <= 1) {
    return distance(a, b) === 1;
  }
  return false;
}

// Score a normalised query (token list) against one recipe's aliases.
// Token-set based so word order and the definite article don't matter, and
// a short partial ("تارتار") can't outrank a full-name match ("تارتار سلمون").
function scoreAliases(qTokens, aliases) {
  let best = 0;
  for (const alias of aliases) {
    const aTokens = alias.split(' ').filter(Boolean);
    if (!aTokens.length) continue;
    let inter = 0;
    for (const qt of qTokens) {
      if (aTokens.some((at) => tokenMatch(qt, at))) inter++;
    }
    if (!inter) continue;
    const allQ = inter === qTokens.length;
    const allA = inter === aTokens.length;
    let score;
    if (allQ && allA) score = 100;          // every token matches both ways
    else if (allQ) score = 88;              // query fully inside a richer name
    else if (allA) score = 70;              // alias fully inside a longer query
    else {
      const cov = inter / Math.max(qTokens.length, aTokens.length);
      score = Math.round(40 + cov * 45);    // partial overlap → 40..85
    }
    if (score > best) best = score;
  }
  return best;
}

/**
 * Search recipes by Arabic name.
 * @returns {{ candidates: Array<{id,recipe,score}>, confident: boolean }}
 *   candidates sorted by score desc (score >= 45 kept). `confident` is true
 *   when the top hit is a strong (exact/substring) and clear winner.
 */
function searchArabic(query, recipes) {
  const qNorm = normalizeArabic(query);
  if (!qNorm) return { candidates: [], confident: false };
  const qTokens = qNorm.split(' ').filter(Boolean);

  const scored = [];
  for (const [id, recipe] of Object.entries(recipes || {})) {
    // Only consider serveable recipes (must have some ingredients).
    if (!recipe.ingredients_en && !recipe.ingredients_ar) continue;
    const aliases = arabicAliases(recipe);
    if (!aliases.length) continue;
    const score = scoreAliases(qTokens, aliases);
    if (score >= 45) scored.push({ id, recipe, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  const second = scored[1];
  const confident = !!top && top.score >= 85 &&
    (!second || top.score - second.score >= 15 || top.score === 100);

  return { candidates: scored.slice(0, 6), confident };
}

module.exports = {
  searchArabic, arabicNameOf, arabicAliases, normalizeArabic, bodyArabicName,
  hasArabic, normEn,
};
