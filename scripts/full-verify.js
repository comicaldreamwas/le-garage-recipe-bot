'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const { loadCache } = require(path.resolve(__dirname, '..', 'lib', 'cache'));
const { fetchPageBlocks } = require(path.resolve(__dirname, '..', 'lib', 'notion'));
const { parseRecipe, hashOf } = require(path.resolve(__dirname, '..', 'lib', 'parser'));

const REPORT_PATH = '/tmp/full-verify-report.md';
const NOTION_DELAY_MS = 250;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log('🛡 FULL CACHE VERIFICATION\n');
  const cache = loadCache();
  const entries = Object.entries(cache.recipes || {});
  console.log(`Cached: ${entries.length} recipes`);
  console.log(`updated_at: ${cache.updated_at}\n`);

  const matches = [];
  const partials = [];
  const totals  = [];
  const errors  = [];

  let i = 0;
  for (const [id, cached] of entries) {
    i++;
    const label = (cached.name || '(no name)').slice(0, 50);
    process.stdout.write(`[${String(i).padStart(3)}/${entries.length}] ${label.padEnd(52)} `);

    try {
      await sleep(NOTION_DELAY_MS);
      const blocks = await fetchPageBlocks(id);
      const fresh = await parseRecipe({
        id,
        url: cached.url,
        properties: {},
        parent: {},
        database_id: null,
        database_label: cached.restaurant === 'el_gouna' ? 'El Gouna'
                       : cached.restaurant === 'cairo'    ? 'Cairo'
                       : null,
        last_edited_time: null,
      }, blocks);

      const freshHashes = {
        name: hashOf(fresh.name),
        ingredients_en: hashOf(fresh.ingredients_en),
        ingredients_ar: hashOf(fresh.ingredients_ar),
        prep_en: hashOf(fresh.prep_en),
        prep_ar: hashOf(fresh.prep_ar),
      };
      const cachedHashes = cached.hashes || {
        name: hashOf(cached.name),
        ingredients_en: hashOf(cached.ingredients_en),
        ingredients_ar: hashOf(cached.ingredients_ar),
        prep_en: hashOf(cached.prep_en),
        prep_ar: hashOf(cached.prep_ar),
      };

      const fields = ['name', 'ingredients_en', 'ingredients_ar', 'prep_en', 'prep_ar'];
      const drift = fields.filter((f) => cachedHashes[f] !== freshHashes[f]);

      if (drift.length === 0) {
        matches.push({ id, name: cached.name });
        console.log('✅');
        continue;
      }

      const diffPayload = { id, name: cached.name, url: cached.url, drift, samples: {} };
      for (const f of drift) {
        const cs = new Set((cached[f] || '').split('\n').map((s) => s.trim()).filter(Boolean));
        const fs2 = new Set((fresh[f] || '').split('\n').map((s) => s.trim()).filter(Boolean));
        const added   = [...fs2].filter((x) => !cs.has(x)).slice(0, 5);
        const removed = [...cs].filter((x) => !fs2.has(x)).slice(0, 5);
        diffPayload.samples[f] = { added, removed };
      }

      if (drift.length === fields.length) {
        totals.push(diffPayload);
        console.log('❌ TOTAL');
      } else {
        partials.push(diffPayload);
        console.log(`⚠️  partial (${drift.join(',')})`);
      }
    } catch (err) {
      errors.push({ id, name: cached.name, url: cached.url, error: err.message });
      console.log(`🚫 ${err.message}`);
    }
  }

  const lines = [];
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  lines.push('═══════════════════════════════════════');
  lines.push('# 🛡 FULL CACHE VERIFICATION REPORT');
  lines.push(`Generated: ${stamp}`);
  lines.push('═══════════════════════════════════════');
  lines.push('');
  lines.push('## 📊 SUMMARY');
  lines.push('');
  lines.push(`- Total recipes in cache: ${entries.length}`);
  lines.push(`- ✅ Perfect match (all hashes): ${matches.length}`);
  lines.push(`- ⚠️  Partial mismatch: ${partials.length}`);
  lines.push(`- ❌ Total mismatch: ${totals.length}`);
  lines.push(`- 🚫 Could not verify (Notion error): ${errors.length}`);
  lines.push('');

  if (partials.length) {
    lines.push('## ⚠️  PARTIAL MISMATCHES');
    lines.push('Hash drift in some fields — cache likely stale vs current Notion content.');
    lines.push('');
    for (const p of partials) {
      lines.push(`### ${p.name}`);
      lines.push(`URL: ${p.url}`);
      lines.push(`Fields out of sync: ${p.drift.join(', ')}`);
      for (const [f, s] of Object.entries(p.samples)) {
        if (s.added.length) for (const a of s.added) lines.push(`   + [${f}] ${a}`);
        if (s.removed.length) for (const r of s.removed) lines.push(`   - [${f}] ${r}`);
      }
      lines.push('Action: re-run `node cache-builder.js`');
      lines.push('');
    }
  }

  if (totals.length) {
    lines.push('## ❌ TOTAL MISMATCHES');
    lines.push('Every field differs — investigate (possibly wrong dedupe winner).');
    lines.push('');
    for (const t of totals) {
      lines.push(`### ${t.name}`);
      lines.push(`URL: ${t.url}`);
      for (const [f, s] of Object.entries(t.samples)) {
        if (s.added.length) for (const a of s.added) lines.push(`   + [${f}] ${a}`);
        if (s.removed.length) for (const r of s.removed) lines.push(`   - [${f}] ${r}`);
      }
      lines.push('');
    }
  }

  if (errors.length) {
    lines.push('## 🚫 VERIFICATION FAILED');
    lines.push('');
    for (const e of errors) {
      lines.push(`- ${e.name}  (${e.error})`);
      lines.push(`  ${e.url}`);
    }
    lines.push('');
  }

  lines.push('═══════════════════════════════════════');
  lines.push('## 🔧 RECOMMENDED ACTIONS');
  lines.push('═══════════════════════════════════════');
  lines.push('');
  let step = 1;
  if (partials.length || totals.length) {
    lines.push(`${step}. Re-run \`node cache-builder.js\` to refresh ${partials.length + totals.length} drifted entries.`);
    step++;
  }
  if (errors.length) {
    lines.push(`${step}. Investigate ${errors.length} verification error(s) above.`);
    step++;
  }
  if (step === 1) {
    lines.push('All entries match. Cache is current. ✅');
  }
  lines.push('');

  const report = lines.join('\n');
  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  console.log(`\n📄 Report → ${REPORT_PATH}`);
  console.log(`\nSummary: ${matches.length} ✅ / ${partials.length} ⚠️ / ${totals.length} ❌ / ${errors.length} 🚫`);
}

main().catch((e) => { console.error('💥', e.message); process.exit(1); });
