// ═══════════════════════════════════════════════════════════════════
// SYNC DIRTY-SET TEST
//
// Audit item 7: auto-sync used to re-push the ENTIRE table on every local
// save, re-stamping every row's updated_at. A device adding one flight would
// re-push its stale copies of flights another device had just corrected —
// overwriting those corrections (cross-device data loss). pushAllFlights now
// pushes ONLY rows whose content changed since we last synced them.
//
// Drives the real Sync module against a mocked Supabase client (Auth is
// declared unconditionally, so we can stub Auth.client) and proves:
//   - an unchanged table pushes nothing
//   - adding one flight pushes ONLY that flight (never re-pushes the rest)
//   - editing a flight pushes exactly it
//   - a pull that returns FULL cloud rows (all schema columns, zero-defaults)
//     for flights whose local copy OMITS its empty slots does NOT then make
//     every flight look dirty and re-push it — the regression an adversarial
//     review caught (push omits undefined keys, Postgres returns them as 0).
//
// Run:  node test/sync.mjs   (also part of `npm test`)
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

const X = '11111111-1111-4111-8111-111111111111';
const Y = '22222222-2222-4222-8222-222222222222';

w.eval(`
  window.__pushed = [];
  window.__pullData = [];
  Auth.isAuthenticated = () => true;
  Auth.currentUserId = () => 'user-1';
  Auth.client = {
    from: () => ({
      upsert: async (rowsOrRow) => {
        (Array.isArray(rowsOrRow) ? rowsOrRow : [rowsOrRow]).forEach(r => window.__pushed.push(r.id));
        return { error: null };
      },
      select: async () => ({ data: window.__pullData, error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
  localStorage.removeItem('cumulo_synced_sig_v1');
  flights = [ { id: '${X}', date: '2026-01-01', block: 1.0, total: 1.0, route: 'YOW-YYZ' } ];
`);
const pushedIds = () => w.eval('window.__pushed.slice()');
const reset = () => w.eval('window.__pushed.length = 0');

// 1. First sync uploads X.
await w.eval('Sync.pushAllFlights()');
chk('first push uploads X', JSON.stringify(pushedIds()) === JSON.stringify([X]));

// 2. Nothing changed → second push uploads nothing.
reset();
await w.eval('Sync.pushAllFlights()');
chk('unchanged table re-pushes nothing', pushedIds().length === 0);

// 3. Add Y → ONLY Y is pushed (X, possibly corrected elsewhere, is NOT re-pushed).
reset();
w.eval(`flights.push({ id: '${Y}', date: '2026-01-02', block: 2.0, total: 2.0, route: 'YYZ-YUL' });`);
await w.eval('Sync.pushAllFlights()');
chk('adding a flight pushes only the new one (never re-pushes X)', JSON.stringify(pushedIds()) === JSON.stringify([Y]));

// 4. Edit X → exactly X is pushed.
reset();
w.eval(`flights[0].block = 1.5; flights[0].total = 1.5;`);
await w.eval('Sync.pushAllFlights()');
chk('editing a flight pushes exactly it', JSON.stringify(pushedIds()) === JSON.stringify([X]));

// 5. REGRESSION (adversarial review): a pull returning FULL cloud rows — every
//    schema column present, empty slots as 0 / "0.00" strings — for flights
//    whose LOCAL copy omits those keys must NOT poison the fingerprint baseline
//    and re-push the whole table. Same real content, older updated_at (no
//    adoption): the sig must still match so nothing is re-pushed.
w.eval(`
  const full = (id, block, route) => ({
    id, date: id === '${X}' ? '2026-01-01' : '2026-01-02', route,
    block: block, total: block, user_id: 'user-1',
    updated_at: '2000-01-01T00:00:00Z', client_updated_at: '2000-01-01T00:00:00Z',
    hover_time: 0, me_day_pic: 0, me_night_pic: 0, me_day_cop: 0, se_day: 0,
    approaches: 0, ldg_day: 0, ldg_night: 0, picus: 0, inst_actual: 0,
    xc_day_pic: 0, remarks: '', pic: '', copilot: ''
  });
  window.__pullData = [ full('${X}', '1.50', 'YOW-YYZ'), full('${Y}', '2.00', 'YYZ-YUL') ];
`);
await w.eval('Sync.pullFlights()');
reset();
await w.eval('Sync.pushAllFlights()');
chk('full cloud rows (zero-columns) do not make omitted-slot flights look dirty', pushedIds().length === 0);

if (failures.length) {
  console.error(`\n✗ sync test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ sync test passed — dirty-set pushes only changed rows, symmetric fingerprint, never re-pushes over another device');
process.exit(0);
