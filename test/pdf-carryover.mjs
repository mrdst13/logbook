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

// ── Audit 2026-07-27 ────────────────────────────────────────────────
// (h) A flight typed into the form stores landings and approaches as
// STRINGS. The totals accumulator adds with +, so those rows contributed
// nothing: every hand-entered landing vanished from the certifiable
// CUMULATIVE row while still printing on its own line.
{
  const cell = (f, k) => +w.eval(`pdfCellValue(${JSON.stringify(f)}, ${JSON.stringify(k)})`);
  const typed = { ldgDay: '2', ldgNight: '1', approaches: '1' };
  const rawCell = (f, k) => JSON.parse(w.eval(`JSON.stringify(pdfCellValue(${JSON.stringify(f)}, ${JSON.stringify(k)}))`));
  chk('(h) a hand-entered tally is returned as a NUMBER, not a string', typeof rawCell(typed, 'ldgDay') === 'number');
  chk('(h) hand-entered landings count as numbers, not strings', cell(typed, 'ldgDay') === 2);
  chk('(h) hand-entered night landings count', cell(typed, 'ldgNight') === 1);
  chk('(h) hand-entered approaches count', cell(typed, 'approaches') === 1);
  chk('(h) an imported numeric row is unchanged', cell({ ldgDay: 2 }, 'ldgDay') === 2);
}

// (i) A simulator session is not flight time. Its block used to be added
// to career flight time on the dashboard and the PDF cover, while the
// PDF's own column note says sim time stays separate.
{
  const cell = (f, k) => +w.eval(`pdfCellValue(${JSON.stringify(f)}, ${JSON.stringify(k)})`);
  chk('(i) a simulator row contributes no flight time', cell({ isSim: true, block: 4, total: 4 }, 'total') === 0);
  chk('(i) a real flight is unaffected', near(cell({ block: 1.2, total: 1.2 }, 'total'), 1.2));
}

// (j) The cover attestation must read the DERIVED brought-forward total.
// Martin's record is the detailed engine-class grid with no stored total,
// so a raw read returned 0 and the cover attested "0.0 hrs declared"
// while page 1 of the same PDF printed 2781.0.
{
  w.eval(`localStorage.setItem('cumulo_opening_balances_v1', JSON.stringify({
    balances: { seDay:415.8, seNight:5.0, seDayDual:132.1, seNightDual:7.1,
                meDayCop:1880.3, meNightCop:299.6, meDayDual:37.7, meNightDual:3.4 },
    cutoff: '2025-11-27', signedBy: 'F/O Martin Daoust' }))`);
  const derived = JSON.parse(w.eval(
    '(function(){ const t = totalsWithOpening({}); ' +
    'return JSON.stringify({ total: +t.total || +t.block || 0, ' +
    'raw: +(loadOpeningBalances().balances.total || 0) }); })()'
  ));
  chk('(j) the raw stored key really is 0 on this record shape', derived.raw === 0);
  chk('(j) the derived brought-forward total is 2781.0', near(derived.total, 2781.0));
  const coverBf = +w.eval(`pdfBroughtForwardTotal(loadOpeningBalances().balances)`);
  chk('(j) the cover attests the same 2781.0, not 0', near(coverBf, 2781.0));
}

// (k) The PDF currency page must apply the same device filters as the
// dashboard. An FTD session used to badge passenger recency CURRENT off
// nothing but simulator landings. CAR 401.05(2)(b) admits only an aircraft
// or a Level B/C/D full-flight simulator; 401.05(3.1)(b) is BROADER and does
// admit an approved flight training device, so the two rules keep separate
// predicates.
{
  const ftd = { date: '2026-07-15', isSim: true, simType: 'FTD', instSim: 4, toDay: 6, ldgDay: 6, approaches: 6 };
  chk('(k) an FTD session does not count toward landing recency',
    w.eval(`countsTowardRecency(${JSON.stringify(ftd)})`) === false);
  chk('(k) but it DOES count toward IFR approach recency',
    w.eval(`approachCountsTowardIFR(${JSON.stringify(ftd)})`) === true);
  const ffs = Object.assign({}, ftd, { simType: 'FFS' });
  chk('(k) a Level B/C/D full-flight simulator counts for landings',
    w.eval(`countsTowardRecency(${JSON.stringify(ffs)})`) === true);
}

// (l) Every surface that shows career or period hours reads flightTimeOf, so
// none can contradict the one printed beside it. The sparkline was repaired
// last, after calcStats: it is drawn by its own aggregator.
{
  const today = new Date().toISOString().slice(0, 10);
  const agg = JSON.parse(w.eval(`(function(){
    flights = [{ id: 'a', date: ${JSON.stringify(today)}, total: 2, block: 2, meDayCop: 2 },
               { id: 's', date: ${JSON.stringify(today)}, isSim: true, simType: 'FFS', total: 1.5, block: 1.5, instSim: 1.5 },
               { id: 't', date: ${JSON.stringify(today)}, total: 3, block: '', meDayCop: 3 }];
    const s = calcStats();
    const spark = _dashMonthlyBlockTotals(1);
    return JSON.stringify({ hero: s.total, block: s.block, block30: s.block30, spark: Object.values(spark) });
  })()`));
  chk('(l) hero excludes the simulator and counts a total-only row', agg.hero === 5);
  chk('(l) the block aggregate agrees with the hero', agg.block === 5);
  chk('(l) the 30-day delta agrees with the hero', agg.block30 === 5);
  chk('(l) the sparkline agrees with the hero', agg.spark.every(function (v) { return v === 5; }));
}

// ═══════════════════════════════════════════════════════════════════
// (m) COVER PAGE — Martin 2026-08-12, generating the PDF on his phone:
//     "les lignes en haut on voit mal, sont pas aligner, on voit a moitier
//     dans le total en haut ... on se fou tu du nombre de landing ... enleve
//     les affaire de stamp 8 sur 110, ces juste melangeant pour rien."
//     jsPDF does not load under jsdom, so the drawing itself cannot be
//     rendered here; these pin the source facts that caused what he saw.
// ═══════════════════════════════════════════════════════════════════
{
  const src = readFileSync(join(root, 'src/js/12-pdf-export.js'), 'utf8');
  // The overlap: the hero band was pinned to the bottom of the SHEET while the
  // card was sized from the top, so the band painted over the card's bottom
  // border and over the last identity row.
  chk('(m) the hero band is no longer pinned to the sheet instead of the card',
    src.indexOf('const heroY = H - 70') === -1);
  chk('(m) every cover band is derived from the card', src.indexOf('const heroY = cardY + 56') !== -1);
  chk('(m) the card grows to fit what it contains', src.indexOf('const cardH = typeShown.length') !== -1);
  // Nothing on the cover may print past its own slot any more.
  chk('(m) the cover trims values to the room they have', src.indexOf('function pdfFit(str, room)') !== -1);
  chk('(m) log-page headers shrink before they collide', src.indexOf('let headPt = 6;') !== -1);
  chk('(m) the totals label stops before the first figure', src.indexOf('let labelRoom = tableW - 2;') !== -1);
  // Removed for good: the landing tally sitting in the row of career hour
  // figures, and the stamp count that read as "102 entries are unverified".
  chk('(m) no landing tally among the career hour figures', src.indexOf("['Landings',") === -1);
  chk('(m) no acceptance-stamp count on the cover',
    src.indexOf('${_accepted.length} of ${sorted.length}') === -1);
  // Two more the cover does not carry: a row count sitting among the licence
  // and expiry fields, and a composition line under each type figure.
  chk('(m) no entry count among the credentials', src.indexOf("['Total Entries'") === -1);
  chk('(m) no composition line under the type figures', src.indexOf('logged + ') === -1);
  // (o) CAR 401.05(3.1) — raw current text re-read 2026-08-12: SIX APPROACHES,
  // no instrument-time requirement. The old item badged a line pilot with 62
  // approaches NOT CURRENT because instrument HOURS, which no airline import
  // fills, read 0.0. The register entry it came from cited a DATED permalink
  // frozen at 2025-12-17.
  chk('(o) the phantom instrument-time requirement is gone from the annexe',
    src.indexOf('6 hours instrument time') === -1 && src.indexOf('instHours6m') === -1);
  chk('(o) the approach item cites the subsection it comes from',
    src.indexOf("reg: 'CAR 401.05(3.1)'") !== -1);
  chk('(o) the 24-month test or check is stated, with the 705 PPC path',
    src.indexOf("reg: 'CAR 401.05(3)'") !== -1 && src.indexOf('725.106') !== -1);
  // (p) The saved signature is applied wherever a signature line is printed.
  chk('(p) the saved signature reaches the page', src.indexOf('drawSavedSignature(') !== -1);
  chk('(p) a page with no saved signature keeps its blank line',
    src.indexOf("if (!_sigData) return false;") !== -1);
  const data02 = readFileSync(join(root, 'src/js/02-data.js'), 'utf8');
  chk('(o) IFR status is decided by approaches alone',
    data02.indexOf('current: approaches >= 6,') !== -1);
}

// (n) HOURS BY AIRCRAFT TYPE — the number he asked to be able to export
//     ("surtout pour le e2"). Measured and declared hours are counted apart,
//     simulator time never merges into aircraft time, and a row with no type
//     is still reported so the strip agrees with the career total.
{
  const rows = JSON.stringify([
    { id: '1', type: 'E195-E2', total: 2.5 },
    { id: '2', type: 'e195-e2', total: 1.5 },           // same type, other case
    { id: '3', type: 'E195-E2', isSim: true, total: 4 },// simulator, kept apart
    { id: '4', type: 'C172',    total: 1 },
    { id: '5', type: '',        total: 0.5 },           // no type recorded
  ]);
  const out = JSON.parse(w.eval(`JSON.stringify(pdfHoursByType(${rows}, { 'E195-E2': 782.7 }))`));
  const e2 = out.filter(e => e.type === 'E195-E2')[0] || {};
  chk('(n) the same type in another case is one entry', out.filter(e => e.type === 'E195-E2').length === 1);
  chk('(n) aircraft hours on type are summed', near(e2.air, 4));
  chk('(n) simulator time is reported apart, never merged', near(e2.sim, 4));
  chk('(n) declared paper hours are carried in their own field', near(e2.paper, 782.7));
  chk('(n) the printed total is measured + declared, and excludes the simulator', near(e2.total, 786.7));
  chk('(n) an untyped row is reported, not dropped',
    out.some(e => e.type === 'TYPE NOT RECORDED' && near(e.total, 0.5)));
  chk('(n) the biggest type is printed first', out[0] && out[0].type === 'E195-E2');
  chk('(n) declared hours for a type never flown still appear',
    (JSON.parse(w.eval("JSON.stringify(pdfHoursByType([], { 'DHC-8-400': 120 }))"))[0] || {}).total === 120);
  chk('(n) nothing is invented from an empty logbook',
    JSON.parse(w.eval('JSON.stringify(pdfHoursByType([], {}))')).length === 0);
}

if (failures.length) {
  console.error('pdf-carryover: FAIL\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('pdf-carryover: all assertions passed');
process.exit(0);   // jsdom leaves a setInterval alive; exit like the sibling tests so `npm test` never hangs
