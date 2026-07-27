// ═══════════════════════════════════════════════════════════════════
// NIGHT RECHECK TEST
//
// Two defects fixed on 2026-07-26 had already written day/night values
// into the logbook: the block-off anchor read the CHECK-IN instead of the
// departure, and the split charged the final partial minute twice. This
// tool repairs those rows, and the whole point is that it repairs ONLY
// what the app itself wrote.
//
// Proves:
//  - a row carrying the old app-computed split is detected and corrected;
//  - a row the pilot edited himself is recognised and left alone;
//  - a row already correct is not listed;
//  - the roster anchor is used when the feed still publishes the leg, and
//    the tool falls back to arithmetic-only when it does not, saying so;
//  - Apply writes exactly the reviewed values, takes a snapshot, and
//    never touches a skipped row;
//  - a flight with no anchor, no coordinates or no block is left out.
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

// ── A flight as the OLD code would have written it ──────────────────
// PD478 YTZ-YOW on 15 Jan, check-in 0130Z, STD 0215Z, BLH 00:52. The old
// anchor was the check-in and the old arithmetic double-counted the tail,
// which is what produced negative day figures.
const CI_ANCHOR = '2026-01-15T01:30:00.000Z';
const STD_ANCHOR = '2026-01-15T02:15:00.000Z';
const BLOCK = 0.87;

const legacyAt = (isoAnchor) => evalJSON(`(function(){
  const off = new Date(${JSON.stringify(isoAnchor)});
  const on = new Date(off.getTime() + ${BLOCK} * 3600000);
  return _legacyDayNightSplit(off, on, AIRPORT_COORDS['CYTZ'], AIRPORT_COORDS['CYOW']);
})()`);
const fixedAt = (isoAnchor) => evalJSON(`(function(){
  const off = new Date(${JSON.stringify(isoAnchor)});
  const on = new Date(off.getTime() + ${BLOCK} * 3600000);
  return calculateDayNightSplit(off, on, AIRPORT_COORDS['CYTZ'], AIRPORT_COORDS['CYOW']);
})()`);

const legacy = legacyAt(CI_ANCHOR);
const fixed = fixedAt(STD_ANCHOR);
chk('the legacy split really was broken on this leg (negative day)', legacy.dayHours < 0);
chk('the corrected split is never negative', fixed.dayHours >= 0);
chk('the corrected split sums back to the block',
  Math.abs((fixed.dayHours + fixed.nightHours) - BLOCK) < 0.011);

const mkFlight = (over) => Object.assign({
  id: 'f1', date: '2026-01-15', flightNum: 'PD478', route: 'YTZ-YOW',
  dep_icao: 'CYTZ', arr_icao: 'CYOW', block: BLOCK, total: BLOCK,
  dtstart_utc: CI_ANCHOR, atd_utc: '', ata_utc: '', navblueUid: 'u-478',
  meDayPic: 0, meNightPic: 0, meDayCop: legacy.dayHours, meNightCop: legacy.nightHours,
  xcDayCop: legacy.dayHours, xcNightCop: legacy.nightHours
}, over || {});

const planWith = (fl, anchorMap) => evalJSON(`(function(){
  flights = ${JSON.stringify(fl)};
  return buildNightRecheckPlan(${JSON.stringify(anchorMap || {})});
})()`);

// ── 1. App-written row, roster still publishes the leg ──────────────
const p1 = planWith([mkFlight()], { 'u-478': STD_ANCHOR });
chk('the stale row is listed', p1.rows.length === 1);
chk('the correction uses the roster departure time', p1.rows[0] && p1.rows[0].anchorFixed === true);
chk('the proposed day matches the corrected calculation', p1.rows[0] && p1.rows[0].toDay === fixed.dayHours);
chk('the proposed night matches the corrected calculation', p1.rows[0] && p1.rows[0].toNight === fixed.nightHours);
chk('no row is silently counted as edited', p1.skipped.edited === 0);

// ── 2. Roster no longer has the leg: arithmetic only ────────────────
const arithOnly = fixedAt(CI_ANCHOR);
const p2 = planWith([mkFlight()], {});
chk('without the roster the row is still listed', p2.rows.length === 1);
chk('without the roster the departure time is NOT claimed as fixed', p2.rows[0] && p2.rows[0].anchorFixed === false);
chk('without the roster the correction is the arithmetic one', p2.rows[0] && p2.rows[0].toDay === arithOnly.dayHours);

// ── 3. A value the pilot set himself is never touched ───────────────
const p3 = planWith([mkFlight({ meDayCop: 0.5, meNightCop: 0.37 })], { 'u-478': STD_ANCHOR });
chk('a hand-set split is not listed for correction', p3.rows.length === 0);
chk('a hand-set split is reported as left alone', p3.skipped.edited === 1);

// A pilot-supplied actual departure also wins: not this tool's business.
const p3b = planWith([mkFlight({ atd_utc: '0215' })], { 'u-478': STD_ANCHOR });
chk('a row with a pilot actual departure is left alone', p3b.rows.length === 0 && p3b.skipped.edited === 1);

// ── 4. Rows already correct are not listed ─────────────────────────
const p4 = planWith([mkFlight({ dtstart_utc: STD_ANCHOR, meDayCop: fixed.dayHours, meNightCop: fixed.nightHours })], { 'u-478': STD_ANCHOR });
chk('an already-correct row is not listed', p4.rows.length === 0);

// ── 5. Rows this tool cannot judge are left out, and counted ───────
const p5 = planWith([
  mkFlight({ id: 'a', dtstart_utc: '' }),                        // no anchor
  mkFlight({ id: 'b', dep_icao: 'ZZZZ', arr_icao: 'ZZZZ' }),     // unknown airports
  mkFlight({ id: 'c', block: 0, total: 0 }),                     // no block
  mkFlight({ id: 'd', isSim: true })                             // simulator
], { 'u-478': STD_ANCHOR });
chk('a row with no anchor is skipped', p5.skipped.noAnchor === 1);
chk('a row with unknown airports is skipped', p5.skipped.noCoords === 1);
chk('a row with no block is skipped', p5.skipped.noBlock === 1);
chk('a simulator row is never listed', p5.rows.length === 0);

// ── 6. Apply writes exactly what was reviewed, and nothing else ────
const applied = evalJSON(`(function(){
  flights = ${JSON.stringify([mkFlight(), mkFlight({ id: 'f2', meDayCop: 0.5, meNightCop: 0.37 })])};
  const plan = buildNightRecheckPlan(${JSON.stringify({ 'u-478': STD_ANCHOR })});
  _nightRecheckPlan = plan.rows;
  applyNightRecheck();
  return flights.map(function (f) { return { id: f.id, d: f.meDayCop, n: f.meNightCop, xd: f.xcDayCop, xn: f.xcNightCop, anchor: f.dtstart_utc }; });
})()`);
chk('apply writes the corrected day', applied[0].d === fixed.dayHours);
chk('apply writes the corrected night', applied[0].n === fixed.nightHours);
chk('apply mirrors the split into cross-country', applied[0].xd === fixed.dayHours && applied[0].xn === fixed.nightHours);
chk('apply stores the corrected departure time', applied[0].anchor === STD_ANCHOR);
chk('apply leaves the hand-set row untouched', applied[1].d === 0.5 && applied[1].n === 0.37);
chk('apply leaves the hand-set row anchor untouched', applied[1].anchor === CI_ANCHOR);

// The saved data must match what was written in memory.
const persisted = evalJSON(`(function(){ const s = DB.load(); return s.map(function(f){ return { id: f.id, d: f.meDayCop }; }); })()`);
chk('the correction is persisted, not just held in memory',
  persisted.length === 2 && persisted[0].d === fixed.dayHours && persisted[1].d === 0.5);

// A snapshot must exist so Undo works.
const hasSnapshot = w.eval(`(function(){ try { const s = JSON.parse(localStorage.getItem('cumulo_snapshots_v2') || '[]'); return Array.isArray(s) && s.length > 0; } catch (e) { return false; } })()`);
chk('a snapshot was taken before writing', hasSnapshot === true);

if (failures.length) {
  console.error(`\n✗ night-recheck test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ night-recheck passed — corrects only what the app itself wrote, uses the roster departure when published, never touches a pilot-set value, snapshots before writing');
process.exit(0);
