// ═══════════════════════════════════════════════════════════════════
// YEAR-RECAP "MOST VISITED AIRPORTS" TEST
//
// Bug (Martin 2026-07-10): the recap split each route ("YOW-LIR") and counted
// BOTH endpoints, so a round trip (YOW-LIR then LIR-YOW) counted LIR twice —
// 5 trips showed as "10 visits". A visit = a LANDING, so _recapAirportVisits
// now counts only the ARRIVAL airport of each leg (the route destination).
//
// Run:  node test/recap-airports.mjs   (also part of `npm test`)
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
const visits = (arr) => JSON.parse(w.eval(`JSON.stringify(_recapAirportVisits(${JSON.stringify(arr)}))`));

// ── One round trip: each airport counted ONCE (the landing), not twice ──
let v = visits([{ route: 'YOW-LIR' }, { route: 'LIR-YOW' }]);
chk('round trip: LIR counted once', v.LIR === 1);
chk('round trip: YOW counted once (the return landing)', v.YOW === 1);

// ── Martin's real case: 5 round trips to LIR → 5, not 10 ──
const rt5 = [];
for (let i = 0; i < 5; i++) { rt5.push({ route: 'YOW-LIR' }); rt5.push({ route: 'LIR-YOW' }); }
v = visits(rt5);
chk('5 round trips → LIR = 5 (not 10)', v.LIR === 5);
chk('5 round trips → YOW = 5', v.YOW === 5);

// ── Multi-leg day (YOW→YWG→YYZ→YOW): each destination once ──
v = visits([{ route: 'YOW-YWG' }, { route: 'YWG-YYZ' }, { route: 'YYZ-YOW' }]);
chk('multi-leg: YWG once', v.YWG === 1);
chk('multi-leg: YYZ once', v.YYZ === 1);
chk('multi-leg: YOW once (final landing)', v.YOW === 1);
chk('multi-leg: exactly 3 airports (no dep double-count)', Object.keys(v).length === 3);

// ── ICAO 4-letter routes also supported ──
v = visits([{ route: 'CYOW-CYLW' }]);
chk('ICAO route: destination CYLW counted', v.CYLW === 1 && v.CYOW === undefined);

// ── Empty / malformed routes ignored, never crash ──
v = visits([{ route: '' }, { route: null }, {}, { route: 'YOW' }]);
chk('empty/single-token routes produce no phantom airports', Object.keys(v).length === 1 && v.YOW === 1);

if (failures.length) {
  console.error(`\n✗ recap-airports test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ recap-airports passed — a visit = a landing; round trips count each airport once, not twice');
process.exit(0);
