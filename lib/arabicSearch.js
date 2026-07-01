'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Arabic-name search for recipes (food + drinks) — ranked by MEANING, not by
// shared letters. A worker types a dish/drink name in Arabic; we match it
// against curated translations (lib/arabic-recipe-names.js) and, for drinks,
// an authentic in-body Arabic name.
//
// Ranking uses IDF weighting: a distinctive token like "كارباتشيو" (carpaccio,
// in ~1 recipe) counts far more than a generic one like "صوص" (sauce, in ~39).
// So "بيف كارباتشيو" resolves to Beef Carpaccio, not to some other beef dish.
// Synonyms + light clitic stemming collapse spelling variants (بيف↔لحم,
// دجاج↔فراخ, بال/ال/و prefixes) so the same concept always lands on one token.
// ─────────────────────────────────────────────────────────────────────────────

const { distance } = require('fastest-levenshtein');
const { ARABIC_NAMES } = require('./arabic-recipe-names');
const { SYNONYMS: RAW_SYN } = require('./arabic-synonyms');

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

// Normalise Arabic: strip tashkeel/tatweel, unify alef/yaa/waw-hamza/taa-marbuta,
// drop non-Arabic, collapse spaces.
function normalizeArabic(s) {
  if (!s) return '';
  let out = String(s);
  out = out.replace(/[ً-ْٰـ]/g, '');
  out = out.replace(/[آأإ]/g, 'ا');
  out = out.replace(/[ىئ]/g, 'ي');
  out = out.replace(/ؤ/g, 'و');
  out = out.replace(/ة/g, 'ه');
  out = out.replace(/[^؀-ۿ\s]/g, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

// Synonym table normalised to the same letter forms as tokens (so ة/ى variants
// in the seed still match). variant → canonical.
const SYN = {};
for (const [k, v] of Object.entries(RAW_SYN)) {
  const nk = normalizeArabic(k).replace(/\s+/g, '');
  const nv = normalizeArabic(v).replace(/\s+/g, '');
  if (nk) SYN[nk] = nv || nk;
}

// Light clitic stemming: strip leading و/ف, then بال/كال/لل, then ال, then a
// bare preposition ب/ك/ل — but never down to nothing. Then map through
// synonyms so every spelling of a concept collapses to one canonical token.
function canonToken(t) {
  let s = t;
  s = s.replace(/^(و|ف)(?=.{3,})/, '');
  s = s.replace(/^(بال|كال|لل)(?=.{2,})/, '');
  s = s.replace(/^ال(?=.{2,})/, '');
  s = s.replace(/^(ب|ك|ل)(?=.{3,})/, '');
  return SYN[s] || SYN[t] || s;
}

function tokens(str) {
  return normalizeArabic(str).split(' ').filter(Boolean).map(canonToken).filter(Boolean);
}

// First "bare" Arabic line of ingredients_ar = a drink's Arabic name.
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

// Raw Arabic alias strings for a recipe: curated translations + body name.
function aliasStrings(recipe) {
  const out = [];
  const tr = ARABIC_NAMES[normEn(recipe?.name)];
  if (tr) out.push(...tr);
  const body = bodyArabicName(recipe);
  if (body) out.push(body);
  return out;
}

// Best Arabic name to DISPLAY: authentic body name (drinks) else first translation.
function arabicNameOf(recipe) {
  const body = bodyArabicName(recipe);
  if (body) return body;
  const tr = ARABIC_NAMES[normEn(recipe?.name)];
  return tr && tr.length ? tr[0] : null;
}

// Per-restaurant IDF index, memoised by the identity of the recipes object.
const _cache = new WeakMap();
function getIndex(recipes) {
  let idx = _cache.get(recipes);
  if (idx) return idx;
  const entries = [];
  const df = new Map();
  let N = 0;
  for (const [id, recipe] of Object.entries(recipes || {})) {
    if (!recipe.ingredients_en && !recipe.ingredients_ar) continue; // unserveable
    const union = new Set();
    for (const a of aliasStrings(recipe)) for (const t of tokens(a)) union.add(t);
    if (!union.size) continue;
    entries.push({ id, recipe, union });
    N++;
    for (const t of union) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = new Map();
  for (const [t, f] of df) idf.set(t, Math.log((N + 1) / (f + 0.5)));
  idx = { entries, idf, N, unknownIdf: Math.log((N + 1) / 0.5) };
  _cache.set(recipes, idx);
  return idx;
}

/**
 * Search recipes by Arabic name, ranked by IDF-weighted token coverage.
 * @returns {{ candidates: Array<{id,recipe,score}>, confident: boolean }}
 *   `confident` = a single clear winner that matched the query's most
 *   distinctive word; ties (generic queries like "موهيتو") stay non-confident
 *   so the bot offers a pick list instead of guessing.
 */
function searchArabic(query, recipes) {
  const idx = getIndex(recipes);
  const qtok = [...new Set(tokens(query))];
  if (!qtok.length) return { candidates: [], confident: false };

  const w = qtok.map((t) => (idx.idf.has(t) ? idx.idf.get(t) : idx.unknownIdf));
  const totalW = w.reduce((a, b) => a + b, 0) || 1;
  let maxi = 0;
  for (let i = 1; i < w.length; i++) if (w[i] > w[maxi]) maxi = i;
  const distinctive = qtok[maxi];

  const scored = [];
  for (const e of idx.entries) {
    let hit = 0;
    let hasDistinct = false;
    for (let i = 0; i < qtok.length; i++) {
      const qt = qtok[i];
      let q = 0;
      if (e.union.has(qt)) q = 1;
      else if (qt.length >= 4) {
        for (const at of e.union) {
          if (Math.abs(at.length - qt.length) <= 1 && distance(qt, at) === 1) { q = 0.9; break; }
        }
      }
      if (q > 0) { hit += w[i] * q; if (qt === distinctive) hasDistinct = true; }
    }
    if (hit <= 0) continue;
    let score = Math.round((hit / totalW) * 100);
    // Matched only generic words (not the distinctive one) → can't be a strong hit.
    if (!hasDistinct) score = Math.min(score, 55);
    if (score >= 45) scored.push({ id: e.id, recipe: e.recipe, score, hasDistinct });
  }
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  const second = scored[1];
  const confident = !!top && top.score >= 80 && top.hasDistinct &&
    (!second || top.score - second.score >= 12);

  return { candidates: scored.slice(0, 6), confident };
}

module.exports = {
  searchArabic, arabicNameOf, bodyArabicName,
  normalizeArabic, hasArabic, normEn, tokens, canonToken,
};
