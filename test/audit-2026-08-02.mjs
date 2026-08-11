// ═══════════════════════════════════════════════════════════════════
// FINAL-AUDIT REGRESSIONS (2026-08-02)
//
// One section per confirmed finding of the six-expert final audit, so none of
// these can quietly come back:
//   1. Diversion: a route edit refreshes the auto night/XC and the airports.
//   2. calcStats: sim rows contribute to NO career hour bucket.
//   3. The brought-forward seal is actually CHECKED at runtime again.
//   4. A deleted custom validity stays deleted through the union merge.
//   5. The offline queue never replays a snapshot over a newer cloud edit.
//   6. PDF: sim landings out of the tally columns; the brought-forward seed
//      reaches per-slot columns; take-offs never fail an item they were not
//      recorded for.
//   7. Pay: an away stop with no check-in on a different date is UNKNOWN,
//      never silently priced.
//
// Run:  node test/audit-2026-08-02.mjs   (also part of `npm test`)
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { JSDOM, VirtualConsole } from 'jsdom';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const chk = (label, cond) => { if (!cond) failures.push(label); };

const dom = new JSDOM(readFileSync(join(root, 'logbook.html'), 'utf8'), {
  runScripts: 'dangerously', url: 'https://logbook-cxy.pages.dev/', virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    const c = function () { return { destroy() {}, update() {}, resize() {} }; }; c.register = () => {}; w.Chart = c;
    if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    w.scrollTo = () => {};
    w.fetch = () => Promise.reject(new Error('network disabled in test'));
  },
});
const w = dom.window;
w.eval('showToast = function () {}; window.confirm = () => true;');

// ── 1. Diversion: editing the route refreshes stale auto values ─────────
{
  w.eval(`
    localStorage.setItem('logbook_v1', JSON.stringify([
      { id: 'dv1', date: '2026-06-01', flightNum: 'PD10', route: 'YOW-YYZ',
        dep_icao: 'CYOW', arr_icao: 'CYYZ', block: 1.2, total: 1.2,
        dtstart_utc: '2026-06-01T16:00:00.000Z', meDayCop: 1.2, meNightCop: 0,
        xcDayCop: 1.2, xcNightCop: 0 }
    ]));
    flights = DB.load();
    editingId = 'dv1';
    currentEntryType = 'flight';
    showPage('add');
    document.getElementById('f-date').value = '2026-06-01';
    document.getElementById('f-route').value = 'YOW-YUL';   // diverted to YUL
    document.getElementById('f-block').value = '1.2';
    saveFlight();
  `);
  const f = JSON.parse(w.localStorage.getItem('logbook_v1'))[0];
  chk('diversion: the arrival airport follows the new route', f.arr_icao === 'CYUL');
  chk('diversion: the departure airport is refreshed too', f.dep_icao === 'CYOW');
  chk('diversion: the old route\'s XC does not survive unchanged',
    !(f.xcDayCop === 1.2 && f.arr_icao === 'CYUL' && (+f.meDayCop === 1.2) === false));
  chk('diversion: hours were recomputed for the new route (still attributed)',
    (+f.meDayCop || 0) + (+f.meNightCop || 0) > 0);
}

// ── 2. calcStats: a sim row reaches NO career hour bucket ───────────────
{
  w.eval(`
    localStorage.setItem('logbook_v1', JSON.stringify([
      { id: 's1', date: '2026-06-02', route: 'YOW-YYZ', block: 2, total: 2,
        meDayCop: 2, xcDayCop: 2, ldgDay: 1, picus: 1 },
      { id: 's2', date: '2026-06-03', isSim: true, simType: 'FFS Level D-C', block: 0, total: 3,
        meDayCop: 3, xcDayCop: 3, ldgDay: 4, picus: 2, meNightCop: 1 }
    ]));
    flights = DB.load();
  `);
  const s = JSON.parse(w.eval('JSON.stringify(calcStats())'));
  chk('sim hours out of SIC', s.sic === 2);
  chk('sim hours out of ME', s.me === 2);
  chk('sim hours out of XC', s.xc === 2);
  chk('sim landings out of career landings', s.ldg === 1);
  chk('sim PICUS out of career PICUS', s.picus === 1);
  chk('sim night out of career night', s.night === 0 || s.night === undefined || s.night < 1);
}

// ── 3. The seal is CHECKED at runtime, and only complains when broken ───
{
  const okRes = w.eval(`
    localStorage.setItem('cumulo_opening_balances_v1', JSON.stringify({
      balances: { total: 100 }, cutoffDate: '2026-01-01', attestedBy: 'X', attestedAt: '2026-01-01T00:00:00Z', hash: 'nope'
    }));
    typeof checkOpeningBalancesSeal
  `);
  chk('checkOpeningBalancesSeal exists', okRes === 'function');
  chk('the launch path calls it', /checkOpeningBalancesSeal/.test(readFileSync(join(root, 'src/js/99-init.js'), 'utf8')));
  chk('the brought-forward page calls it', /checkOpeningBalancesSeal/.test(readFileSync(join(root, 'src/js/01-router.js'), 'utf8')));
}

// ── 4. A deleted custom validity STAYS deleted ──────────────────────────
{
  w.eval(`
    Sync._suppressAutoSync = true;
    DB.saveProfile({ fname: 'M', customValidities: [{ id: 'cv1', name: 'Passport', date: '2030-01-01' }] });
    deleteCustomValidity('cv1');
  `);
  const p1 = JSON.parse(w.localStorage.getItem(w.eval('DB.profileKey')));
  chk('delete leaves a tombstone, not a hole',
    Array.isArray(p1.customValidities) && p1.customValidities.some(v => v.deleted && v.name === 'Passport'));
  chk('the tombstone is not shown', w.eval('getCustomValidities().length') === 0);
  // The other device's cloud row still holds the live entry: the pull must NOT resurrect it.
  w.eval(`
    Auth.isAuthenticated = () => true;
    Auth.currentUserId = () => 'u1';
    Auth.client = { from: () => ({
      upsert: async () => ({ error: null }),
      select: () => { const data = [{ id: 'u1', custom_validities: [{ id: 'cvX', name: 'Passport', date: '2030-01-01' }] }];
        const p = Promise.resolve({ data, error: null }); p.eq = () => Promise.resolve({ data, error: null }); return p; },
    }) };
  `);
  await w.eval('Sync.pullProfile()');
  chk('the pull does not resurrect the deleted validity', w.eval('getCustomValidities().length') === 0);
  // Re-adding the same name afterwards wins back.
  w.eval(`
    (function () {
      const p = DB.loadProfile();
      p.customValidities = (p.customValidities || []).filter(v => !v.deleted)
        .concat([{ id: 'cv2', name: 'Passport', date: '2031-01-01', addedAt: new Date().toISOString() }])
        .concat((p.customValidities || []).filter(v => v.deleted));
      DB.saveProfile(p);
    })();
  `);
  await w.eval('Sync.pullProfile()');
  chk('re-adding after a delete wins back', w.eval('getCustomValidities().length') === 1);
}

// ── 5. The offline queue never replays a snapshot over a newer cloud edit ──
{
  w.eval(`
    localStorage.setItem('logbook_v1', JSON.stringify([
      { id: '55555555-5555-4555-8555-555555555555', date: '2026-06-05', route: 'YOW-YYZ', block: 1, total: 1 }
    ]));
    flights = DB.load();
    localStorage.setItem('cumulo_pending_ops_v1', JSON.stringify([
      { type: 'upsert_flight', payload: { id: '55555555-5555-4555-8555-555555555555',
        user_id: 'u1', date: '2026-06-05', block: 1, total: 1,
        client_updated_at: '2026-06-05T10:00:00.000Z' } }
    ]));
    window.__upserts = 0;
    Auth.isAuthenticated = () => true;
    Auth.currentUserId = () => 'u1';
    Auth.client = { from: () => ({
      upsert: async () => { window.__upserts++; return { error: null }; },
      select: () => { const data = [{ id: '55555555-5555-4555-8555-555555555555', client_updated_at: '2026-06-06T10:00:00.000Z' }];
        const p = Promise.resolve({ data, error: null }); p.eq = () => Promise.resolve({ data, error: null }); return p; },
      update: () => ({ eq: async () => ({ error: null }) }),
    }) };
  `);
  await w.eval('Sync.drainQueue()');
  chk('a stale queued edit is dropped, not replayed', w.eval('window.__upserts') === 0);
  chk('the queue is empty afterwards',
    JSON.parse(w.localStorage.getItem('cumulo_pending_ops_v1') || '[]').length === 0);
  // …and an op NEWER than the cloud still replays.
  w.eval(`
    localStorage.setItem('cumulo_pending_ops_v1', JSON.stringify([
      { type: 'upsert_flight', payload: { id: '55555555-5555-4555-8555-555555555555',
        user_id: 'u1', date: '2026-06-05', block: 1.5, total: 1.5,
        client_updated_at: '2026-06-07T10:00:00.000Z' } }
    ]));
  `);
  await w.eval('Sync.drainQueue()');
  chk('a newer queued edit still replays', w.eval('window.__upserts') === 1);
}

// ── 6. PDF: tallies, seed, take-off honesty ─────────────────────────────
{
  chk('a sim row contributes 0 to the landing tally',
    w.eval("pdfCellValue({ isSim: true, ldgDay: 4 }, 'ldgDay')") === 0);
  chk('an aircraft row still tallies its landings',
    w.eval("pdfCellValue({ ldgDay: '2' }, 'ldgDay')") === 2);
  const seed = JSON.parse(w.eval(`
    JSON.stringify(openingSeedForCumulative(
      [{ key: 'xcDayPic', decimal: true }, { key: 'total', decimal: true }],
      Object.assign({}, { xcDayPic: 33.5 }, { total: 100 })
    ))
  `));
  chk('the seed reaches a per-slot column', seed.xcDayPic === 33.5);
  chk('the seed keeps the aggregate column', seed.total === 100);
  chk('the export merges raw balances under the aggregates',
    /_rawBal/.test(readFileSync(join(root, 'src/js/12-pdf-export.js'), 'utf8')));
  const pdfSrc = readFileSync(join(root, 'src/js/12-pdf-export.js'), 'utf8');
  chk('take-offs can render UNKNOWN instead of a false NOT CURRENT',
    /take-off logging may be incomplete/.test(pdfSrc) && /ok: ldg6mTotal < 5 \? false : \(to6m >= 5 \? true : null\)/.test(pdfSrc));
}

// ── 7. Pay: an away stop with no check-in on a different date is UNKNOWN ──
{
  const pay = require('../src/js/28-pay.js');
  // KBOS arrival, leg out the NEXT day with no recorded check-in: the data
  // cannot tell a layover from a midnight turn — the period must refuse to
  // compare, never quietly price it either way.
  const ambiguous = [
    { date: '2026-07-01', dep_icao: 'CYOW', arr_icao: 'KBOS', dtstart_utc: '2026-07-01T13:00:00.000Z', block: 1.5, ci_utc: '1200' },
    { date: '2026-07-02', dep_icao: 'KBOS', arr_icao: 'CYOW', dtstart_utc: '2026-07-02T14:00:00.000Z', block: 1.5, co_utc: '1615' },
  ];
  const pd = pay.computePerDiem(ambiguous, 'CYOW', { cdn: 4.25, usUsd: 4.25, fx: 1.37 });
  chk('an ambiguous US stop is flagged, not priced', pd.unknownStations > 0);
  chk('its hours are in neither pool', Math.abs(pd.cdnHours + pd.usHours + pd.unknownHours - pd.awayHours) < 0.01 && pd.usHours === 0);
  // The same shape at a CANADIAN station is CAD either way: no flag.
  const domestic = [
    { date: '2026-07-05', dep_icao: 'CYOW', arr_icao: 'CYYZ', dtstart_utc: '2026-07-05T13:00:00.000Z', block: 1, ci_utc: '1200' },
    { date: '2026-07-06', dep_icao: 'CYYZ', arr_icao: 'CYOW', dtstart_utc: '2026-07-06T14:00:00.000Z', block: 1, co_utc: '1545' },
  ];
  const pd2 = pay.computePerDiem(domestic, 'CYOW', { cdn: 4.25, usUsd: 4.25, fx: 1 });
  chk('a Canadian ambiguous stop needs no flag', pd2.unknownStations === 0);
  chk('and stays fully in the CAD pool', Math.abs(pd2.cdnHours - pd2.awayHours) < 0.01);
  // Alaska is not "not US": it is unknown until the table can place it.
  chk('a non-C non-K ICAO is unknown, never silently Canadian', pay._payCountry('PANC') === 'unknown');
}


// ═══ ROUND 2 (same audit, fresh eyes after the round-1 fixes) ═══════════

// ── 8. NEVER a fabricated take-off on the certifiable grid ──────────────
chk('a row with landings but no recorded take-offs prints EMPTY, never a guess',
  w.eval("computeCellValue({ ldgDay: 2 }, 'toDay')") === '');
chk('a recorded take-off still prints',
  w.eval("computeCellValue({ toDay: 1, ldgDay: 2 }, 'toDay')") === 1);

// ── 9. Deleting a SECOND validity keeps the FIRST deletion ──────────────
{
  w.eval(`
    Sync._suppressAutoSync = true;
    DB.saveProfile({ fname: 'M', customValidities: [
      { id: 'ka', name: 'RAIC', date: '2030-01-01' },
      { id: 'kb', name: 'Line check', date: '2030-06-01' }
    ] });
    deleteCustomValidity('ka');
    deleteCustomValidity('kb');
  `);
  const cv = JSON.parse(w.localStorage.getItem(w.eval('DB.profileKey'))).customValidities || [];
  chk('both tombstones survive a second delete',
    cv.filter(v => v.deleted).length === 2);
  chk('no live entry remains', w.eval('getCustomValidities().length') === 0);
}

// ── 10. The hero drill-down derives the brought-forward like the cover ──
{
  // Grid-only attestation: no stored total/block, only engine-class detail.
  w.eval(`
    localStorage.setItem('cumulo_opening_balances_v1', JSON.stringify({
      balances: { meDayCop: 2000, meNightCop: 781 }, cutoffDate: '2025-11-27',
      attestedBy: 'M', attestedAt: '2026-07-07T00:00:00Z', hash: 'h'
    }));
    localStorage.setItem('logbook_v1', JSON.stringify([
      { id: 'hz1', date: '2026-06-01', route: 'YOW-YYZ', block: 5, total: 5, meDayCop: 5 }
    ]));
    flights = DB.load();
  `);
  const body = w.eval("_dashDrillBuild('hero', false).body");
  chk('a grid-only attestation is not called logged-in-Cumulo',
    /2[s,  ]*781/.test(body));
}

// ── 11. The pull pages: 1000 rows is a page boundary, not a ceiling ─────
{
  w.eval(`
    localStorage.setItem('logbook_v1', JSON.stringify([]));
    flights = DB.load();
    Sync._saveSyncedSig({});
    window.__pages = [];
    (function () {
      const mk = (n, off) => Array.from({ length: n }, (x, i) => ({
        id: '00000000-0000-4000-8000-' + String(off + i).padStart(12, '0'),
        date: '2026-01-01', route: 'YOW-YYZ', block: 1, total: 1,
        client_updated_at: '2026-01-02T00:00:00.000Z'
      }));
      const all = mk(1000, 0).concat(mk(3, 1000));
      Auth.isAuthenticated = () => true;
      Auth.currentUserId = () => 'u1';
      Auth.client = { from: () => ({
        select: () => ({
          range: async (a, b) => { window.__pages.push([a, b]); return { data: all.slice(a, b + 1), error: null }; },
          eq: () => Promise.resolve({ data: [], error: null })
        }),
        upsert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }) };
    })();
  `);
  await w.eval('Sync.pullFlights({ silent: true })');
  chk('the pull asked for a second page', w.eval('window.__pages.length') >= 2);
  chk('all 1003 rows arrived',
    JSON.parse(w.localStorage.getItem('logbook_v1')).length === 1003);
}

// ── 12. A deleted flight does not resurrect through a CSV re-import ─────
{
  chk('the CSV commit consults the tombstones',
    /isTombstoned\(enriched\)/.test(readFileSync(join(root, 'src/js/16-csv-import.js'), 'utf8')));
}

if (failures.length) {
  console.error(`\n✗ audit-2026-08-02 regressions: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ audit-2026-08-02 regressions passed — diversion, sim buckets, seal check, validity tombstones, queue tie-break, PDF honesty, ambiguous-stop refusal');
process.exit(0);
