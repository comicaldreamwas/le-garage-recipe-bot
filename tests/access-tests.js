'use strict';

/**
 * Staff-whitelist tests. Run anywhere — no Notion, no Telegram, no cache:
 *
 *   node tests/access-tests.js
 *
 * Every case works on a throwaway file under the OS temp dir via
 * ALLOWED_USERS_PATH, so the live allowed-users.json is never touched.
 *
 * Prints a per-case pass/fail line and exits non-zero if anything failed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), `access-tests-${process.pid}.json`);
process.env.ALLOWED_USERS_PATH = TMP;

const access = require(path.join(__dirname, '..', 'lib', 'access'));

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}\n       expected: ${e}\n       actual:   ${a}`);
  }
}

function fresh() {
  try { fs.unlinkSync(TMP); } catch { /* not there yet */ }
  access._reset();
}

/** Stand in for the other PM2 process writing the shared file behind our back. */
function otherProcessWrites(obj) {
  fs.writeFileSync(TMP, JSON.stringify(obj, null, 2), 'utf8');
}

// ── Closed by default ────────────────────────────────────────────────────────
console.log('\n▶ closed by default');
fresh();
check('missing file → nobody allowed', access.isAllowed('583920144', 'boho'), false);
check('missing file → empty roster', access.listUsers('boho'), []);
check('missing file → count 0', access.count('boho'), 0);

// ── Grant ────────────────────────────────────────────────────────────────────
console.log('\n▶ granting access');
fresh();
const added = access.addUser('583920144', 'boho', { name: 'Ahmed', addedBy: '11' });
check('addUser → allowed', access.isAllowed('583920144', 'boho'), true);
check('addUser → name stored', added.name, 'Ahmed');
check('addUser → not flagged as pre-existing', added.alreadyPresent, false);
check('numeric id works too', access.isAllowed(583920144, 'boho'), true);
check('someone else is still denied', access.isAllowed('999', 'boho'), false);
check('re-adding flags the duplicate', access.addUser('583920144', 'boho', { name: 'Ahmed K' }).alreadyPresent, true);
check('re-adding keeps one entry', access.count('boho'), 1);

let threw = false;
try { access.addUser('not-a-number', 'boho', {}); } catch { threw = true; }
check('non-numeric id rejected', threw, true);

threw = false;
try { access.addUser('123', 'kitchen', {}); } catch { threw = true; }
check('unknown scope rejected', threw, true);

// ── Revoke ───────────────────────────────────────────────────────────────────
console.log('\n▶ revoking access');
fresh();
access.addUser('583920144', 'boho', { name: 'Ahmed', username: 'ahmed_k' });
access.addUser('771203344', 'boho', { name: 'Mona' });
const removed = access.removeUser('583920144', 'boho');
check('removeUser returns the entry', removed.name, 'Ahmed');
check('revoked user is denied at once', access.isAllowed('583920144', 'boho'), false);
check('everyone else keeps access', access.isAllowed('771203344', 'boho'), true);
check('removing a stranger returns null', access.removeUser('404', 'boho'), null);

// ── Revoking by what the admin actually remembers ────────────────────────────
console.log('\n▶ resolving id / @username / name');
fresh();
access.addUser('583920144', 'boho', { name: 'Ahmed', username: 'ahmed_k' });
access.addUser('771203344', 'boho', { name: 'Mona Said', username: 'mona' });
access.addUser('690112877', 'boho', { name: 'Ahmed Zaki' });
check('by id', access.findUsers('771203344', 'boho').map((u) => u.name), ['Mona Said']);
check('by @username', access.findUsers('@ahmed_k', 'boho').map((u) => u.name), ['Ahmed']);
check('by username without @', access.findUsers('mona', 'boho').map((u) => u.name), ['Mona Said']);
check('exact name beats substring', access.findUsers('Ahmed', 'boho').map((u) => u.name), ['Ahmed']);
check('substring name → all matches', access.findUsers('ahmed z', 'boho').map((u) => u.name), ['Ahmed Zaki']);
check('unknown @handle matches nobody', access.findUsers('@ghost', 'boho'), []);
check('bare @ matches nobody', access.findUsers('@', 'boho'), []);
check('empty query matches nobody', access.findUsers('', 'boho'), []);

fresh();
access.addUser('1', 'boho', { name: 'Sara Ali' });
access.addUser('2', 'boho', { name: 'Sara Nabil' });
check('ambiguous name returns every match', access.findUsers('sara', 'boho').length, 2);

// ── One file, two bots ───────────────────────────────────────────────────────
console.log('\n▶ scope isolation');
fresh();
access.addUser('583920144', 'boho', { name: 'Ahmed' });
check('Boho staff allowed in Boho', access.isAllowed('583920144', 'boho'), true);
check('Boho staff denied in Le Garage', access.isAllowed('583920144', 'le_garage'), false);
check('Le Garage roster untouched', access.count('le_garage'), 0);

console.log('\n▶ picking up the other process\'s writes');
fresh();
access.addUser('111', 'boho', { name: 'Ahmed' });
otherProcessWrites({ boho: { 111: { name: 'Ahmed' }, 222: { name: 'Mona' } } });
check('a grant made elsewhere is seen without a restart', access.isAllowed('222', 'boho'), true);
otherProcessWrites({ boho: { 222: { name: 'Mona' } } });
check('a revoke made elsewhere is seen without a restart', access.isAllowed('111', 'boho'), false);

console.log('\n▶ concurrent writes do not clobber');
fresh();
access.addUser('111', 'boho', { name: 'Ahmed' });          // this process
otherProcessWrites({                                        // the other process
  boho: { 111: { name: 'Ahmed' } },
  le_garage: { 777: { name: 'Mona' } },
});
access.addUser('333', 'boho', { name: 'Sara' });            // this process again
const onDisk = JSON.parse(fs.readFileSync(TMP, 'utf8'));
check('our own write survived', Object.keys(onDisk.boho).sort(), ['111', '333']);
check('the other section survived', Object.keys(onDisk.le_garage), ['777']);

// ── Failure modes must deny, never open up ───────────────────────────────────
console.log('\n▶ a broken file stays closed');
fresh();
fs.writeFileSync(TMP, '{ this is not json', 'utf8');
check('corrupt JSON → denied, no crash', access.isAllowed('583920144', 'boho'), false);
fresh();
fs.writeFileSync(TMP, '["array", "not", "object"]', 'utf8');
check('wrong shape → denied', access.isAllowed('583920144', 'boho'), false);
fresh();
fs.writeFileSync(TMP, '{}', 'utf8');
check('empty object → denied', access.isAllowed('583920144', 'boho'), false);

// ── Bootstrap import ─────────────────────────────────────────────────────────
console.log('\n▶ /import bootstrap');
fresh();
access.addUser('111', 'boho', { name: 'Ahmed' });
const imported = access.importUsers(
  [{ userId: '111' }, { userId: '222', last_active: '2026-07-01T10:00:00.000Z' }, { userId: 'junk' }],
  'boho', '11',
);
check('only genuinely new ids are added', imported.map((u) => u.userId), ['222']);
check('junk ids are skipped', access.count('boho'), 2);
check('an existing name is not overwritten', access.getUser('111', 'boho').name, 'Ahmed');
check('imported user gets access', access.isAllowed('222', 'boho'), true);
check('last_active carries over', access.getUser('222', 'boho').last_seen, '2026-07-01T10:00:00.000Z');

// ── touch ────────────────────────────────────────────────────────────────────
console.log('\n▶ last-seen tracking');
fresh();
access.addUser('111', 'boho', { name: 'Ahmed' });
check('starts unseen', access.getUser('111', 'boho').last_seen, null);
access.touch('111', 'boho', 'ahmed_k');
check('touch records the timestamp', typeof access.getUser('111', 'boho').last_seen, 'string');
check('touch backfills the username', access.getUser('111', 'boho').username, 'ahmed_k');
const seenAt = access.getUser('111', 'boho').last_seen;
access.touch('111', 'boho', 'ahmed_k');
check('a second touch is throttled, not rewritten', access.getUser('111', 'boho').last_seen, seenAt);
access.touch('999', 'boho', 'ghost');
check('touching a stranger adds nobody', access.count('boho'), 1);

// ── Summary ──────────────────────────────────────────────────────────────────
try { fs.unlinkSync(TMP); } catch { /* already gone */ }
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
