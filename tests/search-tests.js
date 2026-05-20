'use strict';

/**
 * Search test harness. Run against the REAL cache on the VPS:
 *
 *   cd /opt/le-garage-recipe-bot && node tests/search-tests.js
 *
 * Each case declares either:
 *   - expected: a recipe-name substring that must appear in the matched name
 *               (case-insensitive). Use this for typical positive cases.
 *   - expectedAny: array of substrings, at least one must match.
 *   - expectedNull: true if searchRecipe must return null for this input.
 *
 * The harness prints a per-case pass/fail line and a summary, then
 * exits non-zero if any test failed.
 */

const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
const { searchRecipe } = require(path.join(root, 'lib', 'search'));
const { rebuildAutoTerms, autoStats } = require(path.join(root, 'lib', 'autoTerms'));

// Prefer the real cache when present (VPS), fall back to the synthetic
// fixture for local runs without SSH.
const realPath = path.join(root, 'recipes-cache.json');
let cache;
if (fs.existsSync(realPath)) {
  cache = require(realPath);
  console.log(`📦 Using real cache from ${realPath}`);
} else {
  cache = require('./mock-cache');
  console.log('📦 Using synthetic mock cache (no recipes-cache.json found)');
}

rebuildAutoTerms(cache.recipes);
const stats = autoStats();
console.log(`🧠 Auto-terms: ${stats.words} words, ${stats.phrases} phrases`);
console.log(`📦 Cache:      ${Object.keys(cache.recipes).length} recipes\n`);

const CASES = [
  // ── Exact name matches ────────────────────────────────────────────────────
  { query: 'caesar salad dressing', expected: 'caesar salad dressing' },
  { query: 'chicken in the basket', expectedAny: ['chicken in the basket', 'chicken in basket'] },
  { query: 'lava cake', expected: 'lava cake' },
  { query: 'fish chips', expectedAny: ['fish chips', 'fish & chips', 'fish and chips'] },
  { query: 'french fries', expected: 'french fries' },
  { query: 'creme brule', expectedAny: ['creme brule', 'crème brûlée'] },
  { query: 'cordon bleu', expected: 'cordon bleu' },
  { query: 'beef carpaccio', expected: 'beef carpaccio' },

  // ── Typo tolerance ────────────────────────────────────────────────────────
  { query: 'chicken in e basket', expectedAny: ['chicken in the basket', 'chicken in basket'] },
  { query: 'chiken kebab', expected: 'chicken kebab' },
  { query: 'musrum sauce', expected: 'mushroom sauce' },
  { query: 'cesar dressing', expected: 'caesar salad dressing' },
  { query: 'cordn blue', expected: 'cordon bleu' },
  { query: 'frnch fries', expected: 'french fries' },

  // ── Word-order tolerance ──────────────────────────────────────────────────
  { query: 'dressing caesar', expected: 'caesar salad dressing' },
  { query: 'basket chicken', expectedAny: ['chicken in the basket', 'chicken in basket'] },
  { query: 'fries french', expected: 'french fries' },

  // ── Modifier discrimination (already tested behaviour) ────────────────────
  { query: 'caesar salad', expectedAny: ['caesar salad'], notExpected: 'dressing' },
  { query: 'le garage sauce', expected: 'le garage sauce' },
  { query: 'mushroom sauce', expected: 'mushroom sauce' },

  // ── Arabic ────────────────────────────────────────────────────────────────
  { query: 'صلصة الترفل', expectedAny: ['truffle sauce', 'truffle'] },
  { query: 'سيزر سلاد', expectedAny: ['caesar salad'] },
  { query: 'شوربة عدس', expectedAny: ['lentil soup', 'عدس'] },

  // ── Single-word queries ───────────────────────────────────────────────────
  { query: 'tartar', expected: 'tartar' },
  { query: 'kebab', expectedAny: ['kebab'] },
  { query: 'truffle', expectedAny: ['truffle'] },

  // ── Negative cases ────────────────────────────────────────────────────────
  { query: 'xyz random', expectedNull: true },
  { query: 'pizza', expectedNull: true },          // no pizza in this cache
  { query: '🍕🍕🍕', expectedNull: true },

  // ── Mixed punctuation / emoji noise ───────────────────────────────────────
  { query: '🍔 swiss burger please', expectedAny: ['swiss burger'] },
];

let passed = 0;
let failed = 0;
const failures = [];

for (const c of CASES) {
  const match = searchRecipe(c.query, cache.recipes);
  const matchedName = (match?.recipe?.name || '').toLowerCase();
  let ok = false;
  let reason = '';

  if (c.expectedNull) {
    ok = !match;
    reason = ok ? 'null as expected' : `got "${matchedName}"`;
  } else if (c.expected) {
    ok = matchedName.includes(c.expected.toLowerCase());
    reason = ok ? matchedName : `got "${matchedName}" (wanted to include "${c.expected}")`;
  } else if (c.expectedAny) {
    ok = c.expectedAny.some((e) => matchedName.includes(e.toLowerCase()));
    reason = ok ? matchedName : `got "${matchedName}" (wanted any of ${JSON.stringify(c.expectedAny)})`;
  }

  if (ok && c.notExpected && matchedName.includes(c.notExpected.toLowerCase())) {
    ok = false;
    reason = `got "${matchedName}" (must NOT include "${c.notExpected}")`;
  }

  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${c.query.padEnd(28)} → ${reason}`);
  if (ok) { passed++; } else { failed++; failures.push({ ...c, reason }); }
}

const total = passed + failed;
const pct = total ? Math.round((passed / total) * 100) : 0;
console.log(`\n📊 ${passed}/${total} passed (${pct}%)`);

if (failures.length) {
  console.log(`\nTop failures:`);
  for (const f of failures.slice(0, 8)) {
    console.log(`  - "${f.query}" — ${f.reason}`);
  }
}

process.exit(failed === 0 ? 0 : 1);
