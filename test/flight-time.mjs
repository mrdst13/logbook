// ═══════════════════════════════════════════════════════════════════
// FLIGHT-TIME CONSISTENCY TEST
//
// Audit item 11: a flight's flight time used to be computed four different
// ways (total||0, block||0, total||block, block||total), so the hero card,
// its drill-down, the monthly charts and the logbook footer could each show
// a different career number when total ≠ block. They now all read through
// flightTimeOf(f) = total || block || 0. This test pins that contract:
//   - total wins when set; block is the fallback; both empty → 0
//   - calcStats().total equals the per-flight flightTimeOf sum
//
// Run:  node test/flight-time.mjs   (also part of `npm test`)
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'logbook.html'), 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://logbook-cxy.pages.dev/', virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    const c = function () { return { destroy() {}, update() {}, resize() {} }; }; c.register = () => {}; w.Chart = c;
    if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    w.scrollTo = () => {};
  },
});
const w = dom.window;
const failures = [];
const eq = (label, got, want) => { if (got !== want) failures.push(`${label}: got ${got}, expected ${want}`); };

// ── flightTimeOf contract ──
eq('flightTimeOf total-first', w.eval('flightTimeOf({total:2, block:1.5})'), 2);
eq('flightTimeOf block fallback', w.eval("flightTimeOf({total:'', block:1.5})"), 1.5);
eq('flightTimeOf both empty', w.eval('flightTimeOf({})'), 0);
eq('flightTimeOf zero total → block', w.eval('flightTimeOf({total:0, block:3})'), 3);

// ── calcStats career total == per-flight flightTimeOf sum ──
// Mix: total≠block, block-only (no total), and total==block.
w.eval("flights = [" +
  "{id:'a', date:'2026-01-05', total:2, block:1.5}," +   // total wins → 2
  "{id:'b', date:'2026-01-06', total:'', block:3}," +    // block fallback → 3
  "{id:'c', date:'2026-02-01', total:4, block:4}" +      // equal → 4
"];");
const career = w.eval('calcStats().total');
const expected = w.eval('flights.reduce((s,f)=>s+flightTimeOf(f),0)');
eq('calcStats().total uses flightTimeOf', career, expected);
eq('calcStats().total value', career, 9);

if (failures.length) {
  console.error(`\n✗ flight-time consistency: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ flight-time consistency passed — one flightTimeOf, career total = Σ flightTimeOf');
process.exit(0);
