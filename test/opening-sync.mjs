// ═══════════════════════════════════════════════════════════════════
// OPENING-BALANCES (BROUGHT-FORWARD) CROSS-DEVICE SYNC TEST
//
// Root cause found 2026-07-09: the `opening_balances` table was never created
// in ANY migration — schema.sql only created profiles / flights /
// trusted_devices. So every pushOpeningBalances() upsert hit a non-existent
// relation, failed silently, and the paper-logbook brought-forward hours NEVER
// reached a 2nd device (Martin's 2781 h lived on his computer; his iPhone showed
// only its logged flights). The table is now in schema.sql + a run-once
// migration.
//
// This drives the REAL Sync module against an in-memory Supabase mock and proves
// the round-trip the missing table used to break:
//   - a device holding the attestation PUSHES it to the cloud, columns mapped
//   - an EMPTY device never blanks the cloud row (push guard)
//   - an empty 2nd device PULLS and adopts the attestation, columns mapped back
//   - a device that already has balances is never overwritten (fill-empty pull)
//
// Run:  node test/opening-sync.mjs   (also part of `npm test`)
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM(readFileSync(join(root, 'logbook.html'), 'utf8'), {
  runScripts: 'dangerously', url: 'https://logbook-cxy.pages.dev/', virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    const c = function () { return { destroy() {}, update() {}, resize() {} }; }; c.register = () => {}; w.Chart = c;
    if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    w.scrollTo = () => {};
  },
});
const w = dom.window;
const failures = [];
const chk = (label, cond) => { if (!cond) failures.push(label); };
const KEY = 'cumulo_opening_balances_v1';

// In-memory cloud keyed by table name. Models Supabase upsert(onConflict:user_id)
// and select('*').eq('user_id', …): select() is awaitable AND chainable via .eq().
w.eval(`
  window.__cloud = { opening_balances: [] };
  Auth.isAuthenticated = () => true;
  Auth.currentUserId = () => 'user-1';
  Auth.client = {
    from: (table) => ({
      upsert: async (row) => {
        const arr = window.__cloud[table] || (window.__cloud[table] = []);
        const i = arr.findIndex(r => r.user_id === row.user_id);
        if (i >= 0) arr[i] = row; else arr.push(row);
        return { error: null };
      },
      select: () => {
        const data = window.__cloud[table] || [];
        const p = Promise.resolve({ data, error: null });
        p.eq = (col, val) => Promise.resolve({ data: data.filter(r => r[col] === val), error: null });
        return p;
      },
    }),
  };
`);

const cloudRows = () => w.eval('window.__cloud.opening_balances.slice()');
const localRec = () => JSON.parse(w.localStorage.getItem(KEY) || 'null');

// ── 1. Device A holds an attested brought-forward → push uploads it ──
w.eval(`localStorage.setItem('${KEY}', JSON.stringify({
  balances: { total: 2781 }, cutoffDate: '2025-11-27',
  attestedBy: 'Test Pilot', attestedAt: '2026-07-07T00:00:00Z', hash: 'seal-abc'
}));`);
await w.eval('Sync.pushOpeningBalances()');
const pushed = cloudRows();
chk('push uploads the attestation', pushed.length === 1 && pushed[0].balances && pushed[0].balances.total === 2781);
chk('push maps cutoff_date / attested_at / hash / user_id to columns',
  pushed[0].cutoff_date === '2025-11-27' && pushed[0].attested_at === '2026-07-07T00:00:00Z' &&
  pushed[0].hash === 'seal-abc' && pushed[0].user_id === 'user-1');

// ── 2. An EMPTY device must never clobber the cloud attestation ──
w.eval(`localStorage.removeItem('${KEY}');`);
await w.eval('Sync.pushOpeningBalances()');
chk('empty local never blanks the cloud row', cloudRows().length === 1 && cloudRows()[0].balances.total === 2781);

// ── 3. Device B (empty local) pulls → adopts the attestation ──
w.eval(`localStorage.removeItem('${KEY}');`);
await w.eval('Sync.pullOpeningBalances()');
const b = localRec();
chk('empty device pulls the cloud attestation', !!b && b.balances && b.balances.total === 2781);
chk('pull maps columns back to the local record',
  !!b && b.cutoffDate === '2025-11-27' && b.attestedAt === '2026-07-07T00:00:00Z' && b.hash === 'seal-abc');

// ── 4. A device that ALREADY has balances is never overwritten (fill-empty) ──
w.eval(`localStorage.setItem('${KEY}', JSON.stringify({ balances: { total: 999 }, cutoffDate: '2020-01-01', attestedAt: '2020-01-01T00:00:00Z', hash: 'local' }));`);
await w.eval('Sync.pullOpeningBalances()');
chk('non-empty local is never overwritten by the cloud', localRec().balances.total === 999);

if (failures.length) {
  console.error(`\n✗ opening-balances sync test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ opening-balances sync passed — attestation round-trips push→pull; empty push and fill-empty pull never clobber');
process.exit(0);
