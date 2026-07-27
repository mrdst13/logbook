// ═══════════════════════════════════════════════════════════════════
// NIGHT RECHECK TEST
//
// This is the only code in Cumulo that REWRITES values already sitting in
// the logbook, so the tests are about what it REFUSES to do.
//
// The first version was taken apart by an adversarial review on
// 2026-07-26 which confirmed fourteen defects. Every one of them that
// could touch data has a case below:
//  - it wrote by array index, so a cloud pull deleting a row while the
//    panel was open landed a correction, and an invented departure time,
//    on a completely different flight;
//  - it mirrored the split into the cross-country columns without ever
//    checking whether the pilot had set them, and without showing them;
//  - it only recognised the OLD algorithm as its own output, so on the
//    second run it reported the rows it had just written as values the
//    pilot had hand-entered;
//  - it offered Apply with the roster unreadable, writing a figure from
//    the anchor known to be wrong and locking the row out of the real fix;
//  - it counted a recorded actual departure as a pilot edit of the hours.
//
// Run:  node test/night-recheck.mjs   (also part of `npm test`)
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
const evalJSON = (expr) => JSON.parse(w.eval(`JSON.stringify(${expr})`));

// PD478 YTZ-YOW on 15 Jan, BLH 00:52, check-in 21:45Z for a 22:45Z
// departure. Chosen because the hour between them straddles the end of
// civil twilight, so all three values are DIFFERENT and each assertion
// can only pass for the right reason:
//   stored (old code at the check-in) 0.68 day / 0.19 night
//   arithmetic fixed at the check-in  0.70 / 0.17
//   fully fixed at the departure      0.00 / 0.87
const CI = '2026-01-15T21:45:00.000Z';
const STD = '2026-01-15T22:45:00.000Z';
const BLOCK = 0.87;
const UID = 'u-478';

const splitAt = (fn, iso) => evalJSON(`(function(){
  const off = new Date(${JSON.stringify(iso)});
  const on = new Date(off.getTime() + ${BLOCK} * 3600000);
  return ${fn}(off, on, AIRPORT_COORDS['CYTZ'], AIRPORT_COORDS['CYOW']);
})()`);
const legacyCI = splitAt('_legacyDayNightSplit', CI);
const fixedSTD = splitAt('calculateDayNightSplit', STD);
const fixedCI = splitAt('calculateDayNightSplit', CI);

// The arithmetic defect, on a leg flown entirely at night: the old code
// produced a negative day figure.
const legacyAllNight = splitAt('_legacyDayNightSplit', '2026-01-15T01:30:00.000Z');
const fixedAllNight = splitAt('calculateDayNightSplit', '2026-01-15T01:30:00.000Z');
chk('the legacy split really was broken (negative day on an all-night leg)', legacyAllNight.dayHours < 0);
chk('the corrected split fixes it', fixedAllNight.dayHours === 0);
chk('the corrected split is never negative', fixedSTD.dayHours >= 0);
chk('the corrected split sums back to the block', Math.abs((fixedSTD.dayHours + fixedSTD.nightHours) - BLOCK) < 0.011);
chk('the two anchors really do give different hours', fixedSTD.nightHours !== fixedCI.nightHours || fixedSTD.dayHours !== fixedCI.dayHours);

const mk = (over) => Object.assign({
  id: 'f1', date: '2026-01-15', flightNum: 'PD478', route: 'YTZ-YOW',
  dep_icao: 'CYTZ', arr_icao: 'CYOW', block: BLOCK, total: BLOCK,
  dtstart_utc: CI, atd_utc: '', ata_utc: '', navblueUid: UID,
  meDayPic: 0, meNightPic: 0, meDayCop: legacyCI.dayHours, meNightCop: legacyCI.nightHours,
  xcDayCop: legacyCI.dayHours, xcNightCop: legacyCI.nightHours
}, over || {});

const plan = (fl, map) => evalJSON(`(function(){
  flights = ${JSON.stringify(fl)};
  return buildNightRecheckPlan(${JSON.stringify(map || {})});
})()`);
const ROSTER = {}; ROSTER[UID] = STD;

// ── 1. The stale row is found and correctly described ──────────────
const p1 = plan([mk()], ROSTER);
chk('the stale row is listed', p1.rows.length === 1);
chk('the roster departure time is used', p1.rows[0] && p1.rows[0].anchorFixed === true);
chk('the proposed hours match the corrected calculation',
  p1.rows[0] && p1.rows[0].toDay === fixedSTD.dayHours && p1.rows[0].toNight === fixedSTD.nightHours);
chk('the row carries an id, not a position', p1.rows[0] && p1.rows[0].id === 'f1');
chk('nothing is miscounted as pilot-set', p1.skipped.pilotSet === 0);

// ── 2. Idempotence: the tool must recognise its OWN output ─────────
// Regression: it only knew the old algorithm, so after one run it
// reported the rows it had just written as hand-entered values.
const corrected = mk({ dtstart_utc: STD, meDayCop: fixedSTD.dayHours, meNightCop: fixedSTD.nightHours,
                       xcDayCop: fixedSTD.dayHours, xcNightCop: fixedSTD.nightHours });
const p2 = plan([corrected], ROSTER);
chk('a row this tool already corrected is not listed again', p2.rows.length === 0);
chk('a row this tool already corrected is NOT called pilot-set', p2.skipped.pilotSet === 0);

// Same for a row corrected with arithmetic only, before the roster came back.
const arithApplied = mk({ meDayCop: fixedCI.dayHours, meNightCop: fixedCI.nightHours,
                          xcDayCop: fixedCI.dayHours, xcNightCop: fixedCI.nightHours });
const p2b = plan([arithApplied], ROSTER);
chk('an arithmetic-only row stays repairable, not locked out', p2b.rows.length === 1);
chk('an arithmetic-only row is never called pilot-set', p2b.skipped.pilotSet === 0);

// ── 3. Pilot values are never touched, and are described honestly ──
const p3 = plan([mk({ meDayCop: 0.5, meNightCop: 0.37 })], ROSTER);
chk('a hand-set split is not listed', p3.rows.length === 0);
chk('a hand-set split is counted as pilot-set', p3.skipped.pilotSet === 1);

// A recorded actual departure is its own case, NOT "you set the hours".
const p3b = plan([mk({ atd_utc: '0215' })], ROSTER);
chk('a row with a recorded actual departure is left alone', p3b.rows.length === 0);
chk('a recorded actual departure is counted separately from a pilot edit',
  p3b.skipped.hasActual === 1 && p3b.skipped.pilotSet === 0);

// ── 4. Cross-country: guarded, and shown when it will be written ───
const p4 = plan([mk({ xcDayCop: 0.40, xcNightCop: 0.47 })], ROSTER);
chk('a hand-set cross-country pair does not block the main correction', p4.rows.length === 1);
chk('a hand-set cross-country pair is NOT rewritten', p4.rows[0] && p4.rows[0].touchesXc === false);
chk('and the row says it is being kept', p4.rows[0] && p4.rows[0].xcKept === true);
const p4b = plan([mk()], ROSTER);
chk('an app-written cross-country pair IS rewritten', p4b.rows[0] && p4b.rows[0].touchesXc === true);
chk('and its before values are carried for display',
  p4b.rows[0] && p4b.rows[0].fromXcDay === legacyCI.dayHours && p4b.rows[0].fromXcNight === legacyCI.nightHours);

// ── 5. The anchor comparison is on instants, not strings ───────────
// A row pulled from Supabase comes back in the offset form; the same
// instant used to read as a changed departure time.
// Already anchored on the departure, but stored the way Supabase returns
// it. Only the arithmetic is out of date, so the row must be listed with
// anchorFixed FALSE, not relabelled as a departure-time correction.
const stdOffsetForm = '2026-01-15T22:45:00+00:00';
const legacySTD = splitAt('_legacyDayNightSplit', STD);
chk('fixture: the arithmetic alone still changes this row',
  legacySTD.dayHours !== fixedSTD.dayHours || legacySTD.nightHours !== fixedSTD.nightHours);
const p5 = plan([mk({ dtstart_utc: stdOffsetForm,
                      meDayCop: legacySTD.dayHours, meNightCop: legacySTD.nightHours,
                      xcDayCop: 0, xcNightCop: 0 })], ROSTER);
chk('a row already on the departure anchor is still listed for the arithmetic', p5.rows.length === 1);
chk('the same instant in offset form is not reported as a changed departure time',
  p5.rows[0] && p5.rows[0].anchorFixed === false);

// ── 6. Rows the tool cannot judge are excluded and counted ─────────
const p6 = plan([
  mk({ id: 'a', dtstart_utc: '' }),
  mk({ id: 'b', dep_icao: 'ZZZZ', arr_icao: 'ZZZZ' }),
  mk({ id: 'c', block: 0, total: 0 }),
  mk({ id: 'd', isSim: true })
], ROSTER);
chk('a row with no anchor is skipped', p6.skipped.noAnchor === 1);
chk('a row with unknown airports is skipped', p6.skipped.noCoords === 1);
chk('a row with no block is skipped', p6.skipped.noBlock === 1);
chk('a simulator row is never listed', p6.rows.length === 0);

// ── 7. THE RACE: the logbook changes while the panel is open ───────
// A cloud pull removing a row used to shift every later index, so Apply
// wrote onto a different flight and stamped it with a departure time
// invented for another leg.
const race = evalJSON(`(function(){
  const stale = ${JSON.stringify(mk({ id: 'stale' }))};
  const typed = ${JSON.stringify(mk({ id: 'typed', date: '2026-01-16', navblueUid: 'other', meDayCop: 1.4, meNightCop: 0, xcDayCop: 0, xcNightCop: 0, dtstart_utc: '2026-01-16T12:00:00.000Z' }))};
  flights = [{ id: 'gone', date: '2026-01-10', block: 1, total: 1, meDayCop: 1, meNightCop: 0 }, stale, typed];
  const p = buildNightRecheckPlan(${JSON.stringify(ROSTER)});
  _nightRecheckPlan = p.rows;
  // the app's own line, from Sync.pullFlights, adopting a remote delete
  flights = flights.filter(function (f) { return f.id !== 'gone'; });
  applyNightRecheck();
  return flights.map(function (f) { return { id: f.id, d: f.meDayCop, n: f.meNightCop, anchor: f.dtstart_utc }; });
})()`);
const raceStale = race.find(x => x.id === 'stale');
const raceTyped = race.find(x => x.id === 'typed');
chk('after a row is deleted mid-review, the reviewed flight still gets its correction',
  raceStale && raceStale.d === fixedSTD.dayHours && raceStale.n === fixedSTD.nightHours);
chk('and the untouched flight keeps its own hours', raceTyped && raceTyped.d === 1.4 && raceTyped.n === 0);
chk('and no departure time is stamped onto it', raceTyped && raceTyped.anchor === '2026-01-16T12:00:00.000Z');

// A row whose values changed under the panel is skipped, not overwritten.
const moved = evalJSON(`(function(){
  flights = [${JSON.stringify(mk({ id: 'm1' }))}];
  const p = buildNightRecheckPlan(${JSON.stringify(ROSTER)});
  _nightRecheckPlan = p.rows;
  flights[0].meDayCop = 0.99; flights[0].meNightCop = 0.01;   // edited elsewhere
  applyNightRecheck();
  return { d: flights[0].meDayCop, n: flights[0].meNightCop };
})()`);
chk('a row edited while the panel was open is not overwritten', moved.d === 0.99 && moved.n === 0.01);

// ── 7b. The same race on the CROSS-COUNTRY pair ────────────────────
// Second review finding: the write-time guard covered day and night but
// not cross-country, so a hand-set XC figure arriving from the other
// device while the panel was open was overwritten with a value never
// displayed.
const xcRace = evalJSON(`(function(){
  flights = [${JSON.stringify(mk({ id: 'x1' }))}];
  const p = buildNightRecheckPlan(${JSON.stringify(ROSTER)});
  _nightRecheckPlan = p.rows;
  // verbatim the line Sync.pullFlights uses when adopting a remote row
  Object.assign(flights[0], { xcDayCop: 0.40, xcNightCop: 0.47 });
  applyNightRecheck();
  return { d: flights[0].meDayCop, n: flights[0].meNightCop, xd: flights[0].xcDayCop, xn: flights[0].xcNightCop };
})()`);
chk('a cross-country value arriving mid-review is not overwritten',
  xcRace.xd === 0.40 && xcRace.xn === 0.47);
chk('and the row is dropped whole rather than half-written',
  xcRace.d === legacyCI.dayHours && xcRace.n === legacyCI.nightHours);

// ── 7c. A signature is never written under ─────────────────────────
const signedPlan = plan([mk({ id: 's1', signedBy: 'M. Daoust', signedAt: '2026-02-01T00:00:00.000Z' })], ROSTER);
chk('a signed row is never listed', signedPlan.rows.length === 0);
chk('a signed row is counted on its own', signedPlan.skipped.signed === 1 && signedPlan.skipped.pilotSet === 0);
const signedRace = evalJSON(`(function(){
  flights = [${JSON.stringify(mk({ id: 's2' }))}];
  const p = buildNightRecheckPlan(${JSON.stringify(ROSTER)});
  _nightRecheckPlan = p.rows;
  flights[0].signedAt = '2026-02-01T00:00:00.000Z';   // signed while the panel was open
  applyNightRecheck();
  return { d: flights[0].meDayCop, n: flights[0].meNightCop };
})()`);
chk('a row signed while the panel was open is not written',
  signedRace.d === legacyCI.dayHours && signedRace.n === legacyCI.nightHours);

// ── 8. Apply writes exactly what was reviewed, and persists it ─────
const applied = evalJSON(`(function(){
  flights = [${JSON.stringify(mk())}, ${JSON.stringify(mk({ id: 'f2', meDayCop: 0.5, meNightCop: 0.37 }))}];
  const p = buildNightRecheckPlan(${JSON.stringify(ROSTER)});
  _nightRecheckPlan = p.rows;
  applyNightRecheck();
  return flights.map(function (f) { return { id: f.id, d: f.meDayCop, n: f.meNightCop, xd: f.xcDayCop, xn: f.xcNightCop, anchor: f.dtstart_utc }; });
})()`);
chk('apply writes the corrected day and night', applied[0].d === fixedSTD.dayHours && applied[0].n === fixedSTD.nightHours);
chk('apply mirrors into cross-country only where it said it would',
  applied[0].xd === fixedSTD.dayHours && applied[0].xn === fixedSTD.nightHours);
chk('apply stores the corrected departure time', applied[0].anchor === STD);
chk('apply leaves the hand-set row untouched', applied[1].d === 0.5 && applied[1].n === 0.37);
chk('apply leaves the hand-set row anchor untouched', applied[1].anchor === CI);

const persisted = evalJSON(`(function(){ return DB.load().map(function(f){ return { id: f.id, d: f.meDayCop }; }); })()`);
chk('the correction is persisted, not just held in memory',
  persisted.length === 2 && persisted[0].d === fixedSTD.dayHours && persisted[1].d === 0.5);
const hasSnapshot = w.eval(`(function(){ try { const s = JSON.parse(localStorage.getItem('cumulo_snapshots_v2') || '[]'); return Array.isArray(s) && s.length > 0; } catch (e) { return false; } })()`);
chk('a snapshot was taken before writing', hasSnapshot === true);
chk('the snapshot label is translated, not raw English',
  w.eval(`(function(){ setLang('fr'); return _snapOpLabel('Night recheck'); })()`) === 'Revérification jour et nuit');
w.eval(`setLang('en')`);

// ── 9. No roster, no writing ───────────────────────────────────────
// Applying from the check-in anchor would look like a repair while
// leaving the real error in place, so Apply is not offered at all.
// Drive the real entry point with the roster unreachable, so this tests
// what openNightRecheck actually arms rather than what the test set.
const offline = JSON.parse(await (async () => {
  w.eval(`
    flights = [${JSON.stringify(mk())}];
    _nightRecheckPlan = 'sentinel';
    window.fetch = function () { return Promise.reject(new Error('offline')); };
  `);
  await w.eval('openNightRecheck()');
  return w.eval(`JSON.stringify({
    armed: _nightRecheckPlan === null,
    btn: document.getElementById('importConfirmBtn').textContent,
    body: document.getElementById('extractedList').textContent
  })`);
})());
chk('with no roster nothing is armed for writing', offline.armed === true);
chk('with no roster the button is Close, not Apply', /close/i.test(offline.btn));
chk('with no roster the panel says the roster could not be read', /roster could not be read/i.test(offline.body));
chk('with no roster the panel does NOT invite him to press Apply', !/press Apply/i.test(offline.body));
chk('with no roster the panel does NOT promise a movement in night hours', !/Night hours would move/i.test(offline.body));
chk('with no roster the panel says it is a report only', /report only/i.test(offline.body));
w.eval('closeImportOverlay()');

// And the plan itself still reports what it can see.
const offlinePlan = plan([mk()], {});
chk('with no roster the plan still reports what it can see', offlinePlan.rows.length === 1);
chk('with no roster the row does not claim a departure-time fix', offlinePlan.rows[0].anchorFixed === false);
const noopApply = evalJSON(`(function(){
  flights = [${JSON.stringify(mk())}];
  _nightRecheckPlan = null;
  applyNightRecheck();
  return { d: flights[0].meDayCop, n: flights[0].meNightCop };
})()`);
chk('and apply with nothing armed writes nothing',
  noopApply.d === legacyCI.dayHours && noopApply.n === legacyCI.nightHours);

if (failures.length) {
  console.error(`\n✗ night-recheck test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ night-recheck passed — writes by id not position, guards cross-country, recognises its own output, refuses to write without the roster, never touches a pilot value');
process.exit(0);
