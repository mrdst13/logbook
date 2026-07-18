// ═══════════════════════════════════════════════════════════════════
// PDF EXPORT — BROUGHT-FORWARD CARRY-OVER TEST (12-pdf-export.js)
//
// The log-page "CUMULATIVE TOTALS — CARRIED FORWARD" row must reflect the
// pilot's WHOLE career: brought-forward (paper-logbook) hours + Cumulo
// flights. The bug (Martin 2026-07-18): the running totals were initialised
// to zero and never seeded from the brought-forward balances, so a pilot with
// ~2781 h carried forward + ~400 h logged saw only ~430 h at the bottom of the
// PDF log pages — the "missing reported hours".
//
// jsPDF does not load under jsdom, so we do NOT render a PDF. Instead we drive
// the extracted pure helpers openingSeedForCumulative() + _isCumulativePdfCol()
// (globals in the built logbook.html) with fake columns and balances, and
// reproduce the exact runTotals recipe the exporter uses (zero-init, then merge
// the brought-forward seed). This is the seam the fix lives on: pre-fix code has
// no such helper, so this file fails on the old code.
//
// Run:  node test/pdf-carryover.mjs   (also part of `npm test`)
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
const near = (a, b) => Math.abs((+a || 0) - (+b || 0)) < 0.02;

// The fix = the extracted pure helpers. On pre-fix code they don't exist, so
// this gate (and every numeric assertion below) fails on the old code. The seed
// helpers close the "missing reported hours" bug; pdfCellValue keeps the two
// flight-time columns (block/total) and the cover hero identical (defects #1/#4).
const hasFix = w.eval("typeof openingSeedForCumulative === 'function' && typeof _isCumulativePdfCol === 'function' && typeof pdfCellValue === 'function'");
chk('fix present: openingSeedForCumulative + _isCumulativePdfCol + pdfCellValue defined (fails on pre-fix code)', hasFix);

// Typical PDF column set: one text column (excluded from totals) + the cumulative
// hour/tally columns. 'vfr' is cumulative but has NO brought-forward balance.
const cols = [
  { key: 'date',     align: 'left' },
  { key: 'block',    decimal: true },   // Flight Time — the number Martin missed
  { key: 'total',    decimal: true },   // Total
  { key: 'night',    decimal: true },
  { key: 'meDayCop', decimal: true },
  { key: 'ldgDay' },                    // integer tally — cumulative
  { key: 'ldgNight' },
  { key: 'approaches' },
  { key: 'vfr',      decimal: true },   // cumulative, no BF balance -> stays 0
];

// Build runTotals exactly as _generatePDF does: zero-init every cumulative
// column via the real _isCumulativePdfCol, then merge the brought-forward seed.
function buildRunTotals(seed) {
  return JSON.parse(w.eval(`(function(){
    var cols = ${JSON.stringify(cols)};
    var seed = ${JSON.stringify(seed)};
    var rt = {};
    cols.forEach(function(c){ if (_isCumulativePdfCol(c)) rt[c.key] = 0; });
    Object.assign(rt, openingSeedForCumulative(cols, seed));
    return JSON.stringify(rt);
  })()`));
}

if (hasFix) {
  // ── (a) Direct seed — brought-forward total maps onto the flight-time columns.
  // openingSeed is already in calcStats key space (what totalsWithOpening({}) returns).
  const seed = { total: 2781.0, block: 2781.0, night: 315.1, meDayCop: 1880.3, ldgDay: 42 };
  const rt = buildRunTotals(seed);
  chk('(a) Flight Time (block) running total starts at 2781, not 0', near(rt.block, 2781.0));
  chk('(a) Total column running total starts at 2781, not 0',        near(rt.total, 2781.0));
  chk('(a) Night seeded from brought-forward',                       near(rt.night, 315.1));
  chk('(a) ME SIC (meDayCop) seeded from brought-forward',           near(rt.meDayCop, 1880.3));
  chk('(a) landings tally (ldgDay) seeded from brought-forward',     rt.ldgDay === 42);

  // ── (b) After summing this-page flights totalling 400.8 h, cumulative = 3181.8.
  rt.block += 200.4; rt.block += 200.4;
  rt.total += 200.4; rt.total += 200.4;
  chk('(b) block cumulative after 400.8 h of flights = 3181.8', near(rt.block, 3181.8));
  chk('(b) total cumulative after 400.8 h of flights = 3181.8', near(rt.total, 3181.8));

  // ── (c) No brought-forward hours -> every cumulative column starts at 0 (no regression).
  const rt0 = buildRunTotals({});
  chk('(c) no BF: block starts at 0',      rt0.block === 0);
  chk('(c) no BF: total starts at 0',      rt0.total === 0);
  chk('(c) no BF: night starts at 0',      rt0.night === 0);
  chk('(c) no BF: meDayCop starts at 0',   rt0.meDayCop === 0);
  chk('(c) no BF: approaches starts at 0', rt0.approaches === 0);

  // ── (d) A cumulative column with no matching brought-forward balance stays 0,
  // and non-cumulative (text) columns are never seeded.
  chk('(d) vfr cumulative with no BF balance starts at 0', rt.vfr === 0);
  chk('(d) non-cumulative text column (date) not seeded',  !('date' in rt));

  // ── (e) Integration — the real derivation chain for Martin's grid-only pilot.
  // Filling ONLY the detailed engine-class grid (no Total/Block entered) must
  // still seed the flight-time columns to 2781 (totalsWithOpening derives it
  // from the day/night x role partition). This is the exact 2026-07-08 scenario.
  w.eval(`localStorage.setItem('cumulo_opening_balances_v1', JSON.stringify({
    balances: { seDay:415.8, seNight:5.0, seDayDual:132.1, seNightDual:7.1,
                meDayCop:1880.3, meNightCop:299.6, meDayDual:37.7, meNightDual:3.4 },
    cutoffDate:'2025-11-27', attestedAt:'2025-11-27T12:00:00Z', hash:'x' }))`);
  const derivedSeed = JSON.parse(w.eval('JSON.stringify(totalsWithOpening({}))'));
  chk('(e) totalsWithOpening derives total=2781 from the detail grid', near(derivedSeed.total, 2781.0));
  const rtE = buildRunTotals(derivedSeed);
  chk('(e) block running total seeded to 2781 from grid-only balances', near(rtE.block, 2781.0));
  chk('(e) meDayCop running total seeded to 1880.3 from grid',          near(rtE.meDayCop, 1880.3));

  // ── (f) Defect #2 — totalsWithOpening derives 'day' symmetric to 'night', so a
  // grid-only pilot's PDF Day column seeds correctly and Day + Night reconcile to
  // Total on the cumulative row (still using the (e) grid-only balances above).
  chk('(f) day derived from the detail grid (was 0 pre-fix)', near(derivedSeed.day, 2465.9));
  chk('(f) day + night reconcile to total on the cumulative row',
      near((+derivedSeed.day || 0) + (+derivedSeed.night || 0), derivedSeed.total));
  w.eval("localStorage.removeItem('cumulo_opening_balances_v1')");

  // ── (g) Defects #1 + #4 — the two flight-time columns can never diverge. Both
  // 'block' (labelled "Flight Time") and 'total' (labelled "Total") read through
  // flightTimeOf, so a row carrying only ONE of block/total still counts in BOTH
  // columns and both equal the cover-page hero (fmt(totals.total || totals.block)).
  const cell = (f, k) => +w.eval(`pdfCellValue(${JSON.stringify(f)}, ${JSON.stringify(k)})`);
  // Normal row (total === block): unchanged.
  chk('(g) normal row: total column = 5.4', near(cell({ total: 5.4, block: 5.4 }, 'total'), 5.4));
  chk('(g) normal row: block column = 5.4', near(cell({ total: 5.4, block: 5.4 }, 'block'), 5.4));
  // block-only row (e.g. a row missing total): "Total" column falls back to block.
  const blockOnly = { block: 5.8 };
  chk('(g) block-only row: total column falls back to block (5.8, not 0)', near(cell(blockOnly, 'total'), 5.8));
  chk('(g) block-only row: total column == block column',                  near(cell(blockOnly, 'total'), cell(blockOnly, 'block')));
  // total-only row (the generic CSV wizard maps a single "Total", leaving block
  // empty): "Flt Time" column falls back to total instead of undercounting.
  const totalOnly = { total: 5.4 };
  chk('(g) total-only row: block column falls back to total (5.4, not 0)', near(cell(totalOnly, 'block'), 5.4));
  chk('(g) total-only row: block column == total column',                  near(cell(totalOnly, 'block'), cell(totalOnly, 'total')));
  // Non-flight-time column is untouched (still routed through computeCellValue).
  chk('(g) non-flight-time column unaffected: ldgDay = 2', cell({ ldgDay: 2 }, 'ldgDay') === 2);
}

if (failures.length) {
  console.error('pdf-carryover: FAIL\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('pdf-carryover: all assertions passed');
