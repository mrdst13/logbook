// ═══════════════════════════════════════════════════════════════════
// DAILY MAX FDP CALCULATOR TEST (page-duty, RAC 700.28 + 700.50)
//
// Drives the REAL integrated calculator (27-fdp-calc.js) inside the built
// logbook.html: sets the inputs, calls fdpCompute(), reads the painted result.
// Verifies the verified 700.28 table, the time-zone conversion (700.19(2)),
// the split extension (700.50), and the 18h ceiling (700.62).
//
// Run:  node test/fdp-calc.mjs   (also part of `npm test`)
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

// Toronto = city index 4, Vancouver = 12 (per FDP_CITIES order).
w.eval('initFdpCalc()');
function calc(o) {
  const hm = o.report.split(':');
  return JSON.parse(w.eval(`(function(){
    var g=function(id){return document.getElementById(id);};
    g('fdp-report-h').value='${+hm[0]}'; g('fdp-report-m').value='${+hm[1]}';
    g('fdp-station').value='${o.station}';
    g('fdp-acclim').value='${o.acclim}';
    g('fdp-dur').value='${o.dur}';
    g('fdp-legs').value='${o.legs}';
    g('fdp-split').checked=${!!o.split};
    g('fdp-brk').value='${o.brk || 0}';
    g('fdp-night').checked=${!!o.night};
    fdpCompute();
    return JSON.stringify({out:g('fdp-out').textContent, end:g('fdp-end').textContent, conv:g('fdp-conv').textContent, cell:g('fdp-cell').textContent});
  })()`));
}

// 1. Base case — report 07:00, ≥50 min, 2 flights, acclimatized where you are (no conversion).
const d = calc({ report: '07:00', station: 4, acclim: 4, dur: 'ge50', legs: 2 });
chk('base: 07:00 ge50 2 flights → 13 h 00', d.out === '13 h 00');
chk('base: latest end 20:00 (Toronto)', d.end.indexOf('20:00') === 0);
chk('base: no cross-zone conversion note', d.conv.indexOf('=') === -1);

// 2. Time-zone conversion — 07:00 in Vancouver, acclimatized to Toronto → read at 10:00 Eastern → 13:00.
const c = calc({ report: '07:00', station: 12, acclim: 4, dur: 'ge50', legs: 2 });
chk('conv: base still 13 h 00 (10:00 Eastern row)', c.out === '13 h 00');
chk('conv: latest end 20:00 in Vancouver local', c.end.indexOf('20:00') === 0);
chk('conv: note shows both cities + converted time', c.conv.indexOf('Vancouver') >= 0 && c.conv.indexOf('Toronto') >= 0 && c.conv.indexOf('10:00') >= 0);

// 3. Split at night — 180 min break, night → (180−45)×100% = +2:15 → 15:15.
const s = calc({ report: '07:00', station: 4, acclim: 4, dur: 'ge50', legs: 2, split: true, brk: 180, night: true });
chk('split night 180 min → 15 h 15', s.out === '15 h 15');

// 4. Split by day — 60 min break, day → (60−45)×50% = +7.5 min → 13:08 (rounded).
const sd = calc({ report: '07:00', station: 4, acclim: 4, dur: 'ge50', legs: 2, split: true, brk: 60, night: false });
chk('split day 60 min → 13 h 08', sd.out === '13 h 08');

// 4b. Break UNDER the 60-min legal minimum → NO extension (RAC 700.50), base stays.
const short = calc({ report: '07:00', station: 4, acclim: 4, dur: 'ge50', legs: 2, split: true, brk: 59, night: true });
chk('split 59 min (< 60) → no extension, stays 13 h 00', short.out === '13 h 00');

// 5. Absolute ceiling — huge split cannot exceed 18 h (700.62).
const cap = calc({ report: '07:00', station: 4, acclim: 4, dur: 'ge50', legs: 1, split: true, brk: 360, night: true });
chk('cap: capped at 18 h 00', cap.out === '18 h 00');
chk('cap: cell notes the 18 h cap', cap.cell.indexOf('18') >= 0);

// 6. Late start + more flights — 23:30, ≥50 min, 6 flights → column B (5–6) of row 23:00–23:59 → 9:00.
const late = calc({ report: '23:30', station: 4, acclim: 4, dur: 'ge50', legs: 6 });
chk('late 23:30 · 6 flights → 9 h 00', late.out === '9 h 00');

// 7. Decimal cell — 13:30 start, <30 min avg, 2 flights → 12.5 h → 12:30.
const dec = calc({ report: '13:30', station: 4, acclim: 4, dur: 'lt30', legs: 2 });
chk('13:30 lt30 → 12 h 30 (decimal 12.5 h, never shown as a decimal)', dec.out === '12 h 30');

// 8. Minute-precision entry — 07:23 still reads the 07:00–12:59 row, and the
// latest end reflects the exact minute (07:23 + 13:00 = 20:23).
const prec = calc({ report: '07:23', station: 4, acclim: 4, dur: 'ge50', legs: 2 });
chk('07:23 → 13 h 00, latest end 20:23 (minute precision)', prec.out === '13 h 00' && prec.end.indexOf('20:23') === 0);

if (failures.length) { console.error('fdp-calc FAIL:', failures); process.exit(1); }
console.log('fdp-calc: all checks passed (700.28 table, tz conversion, split 700.50, 18h ceiling)');
process.exit(0);
