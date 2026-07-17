// ═══════════════════════════════════════════════════════════════════
// CAR 401.05 CURRENCY-WINDOW TEST — local civil date, never the UTC date
//
// Fix 2026-07-17 (same family as the duty-tracker bug Martin caught in prod
// 2026-07-16): every 401.05 recency cutoff was derived via toISOString(),
// which is the UTC date — in the evening in Toronto it already reads
// tomorrow, so the 6-month cutoff (ring, alert bar, currency card, PDF) and
// the 12-month IFR inference each shifted one day late every evening. This
// pins the corrected engine (docs/REGISTRE-REGLEMENTAIRE.md §401.05,
// décision 2026-07-17):
//   • localTodayStr        — LOCAL calendar date (getFullYear/getMonth/getDate)
//   • shiftDateStr         — dateStr ± n days, pure UTC string math (DST-proof)
//   • shiftMonthsStr       — dateStr ± n calendar months, setMonth roll-forward
//        semantics kept (May 31 − 6 mo → "Nov 31" → Dec 1: never widens)
//   • sixMonthCutoffStr    — shiftMonthsStr(localTodayStr(), −6); same-numbered
//        day INCLUDED (date >= cutoff), unchanged since the 2026-06-25 audit
//   • _dash*In6mo counters — bounded ABOVE by local today: a future-dated
//        flight is not "within the preceding six months"
//   • needsIFRTracking     — 12-month inference window, same rules
//   • renderCurrencyCard   — reads the same single source as the counters
//
// TZ is pinned to America/Toronto (before any Date use) so the evening-flip
// assertions discriminate old-vs-new code even on a UTC CI runner. On
// runtimes that ignore TZ (e.g. some Windows setups) the assertions remain
// valid — they just no longer distinguish the old UTC-based code.
//
// The PDF currency page (12-pdf-export.js) now consumes these exact helpers;
// jsPDF is not loadable under jsdom, so the helpers are the pinned surface.
//
// Run:  node test/currency-windows.mjs   (also part of `npm test`)
// ═══════════════════════════════════════════════════════════════════
process.env.TZ = 'America/Toronto';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM(readFileSync(join(root, 'logbook.html'), 'utf8'), {
  runScripts: 'dangerously', url: 'https://logbook-cxy.pages.dev/', virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    const c = function () { return { destroy() {}, update() {}, resize() {} }; }; c.register = () => {};
    w.Chart = c;
    if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    w.scrollTo = () => {};
  },
});
const w = dom.window;
const failures = [];
const eq = (label, got, want) => { if (got !== want) failures.push(`${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`); };

// ── Pure date-string helpers (no wall clock involved) ────────────────
eq('shiftDateStr −89 from 2026-07-17', w.eval("shiftDateStr('2026-07-17', -89)"), '2026-04-19');
eq('shiftDateStr +1 wraps month end', w.eval("shiftDateStr('2026-06-30', 1)"), '2026-07-01');
eq('shiftDateStr −7 across DST spring-forward (2026-03-08)', w.eval("shiftDateStr('2026-03-15', -7)"), '2026-03-08');
eq('90-day window = EXACTLY 90 local dates',
  w.eval("(function(){ let d = shiftDateStr('2026-07-17', -89), n = 1; while (d < '2026-07-17') { d = shiftDateStr(d, 1); n++; } return n; })()"), 90);
eq('shiftMonthsStr −6', w.eval("shiftMonthsStr('2026-07-17', -6)"), '2026-01-17');
eq('shiftMonthsStr −12', w.eval("shiftMonthsStr('2026-07-17', -12)"), '2025-07-17');
eq('shiftMonthsStr rolls a missing day FORWARD (May 31 − 6 mo)', w.eval("shiftMonthsStr('2026-05-31', -6)"), '2025-12-01');
eq('shiftMonthsStr rolls Feb overflow forward (Mar 31 − 1 mo)', w.eval("shiftMonthsStr('2026-03-31', -1)"), '2026-03-03');

// ── Freeze the window's clock at 2026-07-17 23:30 LOCAL time ─────────
// In America/Toronto (UTC−4) toISOString() already reads 2026-07-18 at that
// instant, so the old UTC-based cutoffs would fail everything below.
const fixedMs = new Date(2026, 6, 17, 23, 30).getTime();
w.eval(`
  window.__RealDate = Date;
  (function () {
    const Real = Date;
    function FakeDate(a, b, c, d2, e, f2, g) {
      if (arguments.length === 0) return new Real(${fixedMs});
      switch (arguments.length) {
        case 1: return new Real(a);
        case 2: return new Real(a, b);
        case 3: return new Real(a, b, c);
        case 4: return new Real(a, b, c, d2);
        case 5: return new Real(a, b, c, d2, e);
        case 6: return new Real(a, b, c, d2, e, f2);
        default: return new Real(a, b, c, d2, e, f2, g);
      }
    }
    FakeDate.prototype = Real.prototype;
    FakeDate.UTC = Real.UTC;
    FakeDate.parse = Real.parse;
    FakeDate.now = function () { return ${fixedMs}; };
    Date = FakeDate;
  })();
`);

eq('local today at 23:30 local = 2026-07-17 (never the UTC date)', w.eval('localTodayStr()'), '2026-07-17');
eq('6-month cutoff anchored on LOCAL today', w.eval('sixMonthCutoffStr()'), '2026-01-17');

// ── Window bounds on the 401.05 counters ─────────────────────────────
// Cutoff day included · day before cutoff excluded · today included ·
// tomorrow (future-dated flight) excluded.
// The FTD row is the interesting one: CAR 401.05 states TWO different device
// rules, and conflating them under-counted IFR recency until 2026-07-17.
//   401.05(2)(b)   landings/take-offs: "Level B, C or D full-flight simulator"
//                  → an FTD does NOT count.
//   401.05(3.1)(b) approaches: "a Level B, C or D simulator OR AN APPROVED
//                  FLIGHT TRAINING DEVICE configured for the same category"
//                  → an FTD DOES count.
// So the same FTD row must be counted for approaches and dropped for landings.
w.eval("flights = [" +
  "{date:'2026-01-16', approaches:9, instActual:9,   ldgDay:9, toDay:9}," +                     // day before cutoff → OUT
  "{date:'2026-01-17', approaches:1, instActual:1.5, ldgDay:2, toDay:2}," +                     // cutoff day → IN
  "{date:'2026-07-17', approaches:2, instHood:2,     ldgDay:3, toDay:3}," +                     // today → IN
  "{date:'2026-07-18', approaches:9, instSim:9,      ldgDay:9, toDay:9}," +                     // tomorrow → OUT
  "{date:'2026-07-01', isSim:true, simType:'FTD', approaches:9, ldgDay:9, toDay:9}," +          // FTD → IN for approaches, OUT for landings
  "{date:'2026-07-02', isSim:true, simType:'BITD', approaches:4, ldgDay:4, toDay:4}" +          // basic trainer → OUT everywhere
"];");
// 1 (cutoff day) + 2 (today) + 9 (approved FTD) = 12. Would be 3 before the fix.
eq('approaches: window bounds, and an approved FTD counts (401.05(3.1)(b))', w.eval('_dashApproachesIn6mo()'), 12);
eq('instrument time: cutoff day + today only', w.eval('_dashInstrumentTimeIn6mo()'), 3.5);
// Same FTD row, dropped here: the landing rule is narrower. Guards the conflation.
eq('landings: FTD does NOT count (401.05(2)(b) is narrower)', w.eval('_dashLandingsIn6mo()'), 5);
eq('take-offs: FTD does NOT count (401.05(2)(b) is narrower)', w.eval('_dashTakeoffsIn6mo()'), 5);
eq('a BITD counts for nothing', w.eval("approachCountsTowardIFR({isSim:true, simType:'BITD'})"), false);

// ── Currency card reads the same single source ───────────────────────
// #currencyCard is not in the current dashboard DOM (legacy card, kept
// callable via the i18n refresh) — inject its nodes so the function's
// window math runs for real instead of early-returning.
w.eval(`document.body.insertAdjacentHTML('beforeend',
  '<div id="currencyCard">' +
  '<span id="cur-app-count"></span><span id="cur-app-status"></span><span id="cur-app-sub"></span>' +
  '<span id="cur-hrs-count"></span><span id="cur-hrs-status"></span><span id="cur-hrs-sub"></span>' +
  '</div>');`);
w.eval('renderCurrencyCard()');
eq('card approach count matches the shared counter',
  w.eval("document.getElementById('cur-app-count').textContent"), '12');
eq('card instrument hours from the same bounded window',
  w.eval("document.getElementById('cur-hrs-count').textContent"), '3.5');

// ── needsIFRTracking: 12-month LOCAL window, future flights are not history ──
eq('705 line pilot always tracks IFR', w.eval("needsIFRTracking({pilotType:'airline705'})"), true);
w.eval("flights = [{date:'2025-07-17', approaches:1}];");   // exactly 12 months back → counted
eq('inference: approach exactly 12 months ago counts', w.eval("needsIFRTracking({pilotType:'bush'})"), true);
w.eval("flights = [{date:'2025-07-16', approaches:1}];");   // one day beyond the window
eq('inference: approach 12 months + 1 day ago does not', w.eval("needsIFRTracking({pilotType:'bush'})"), false);
w.eval("flights = [{date:'2026-07-18', approaches:5}];");   // future-dated
eq('inference: a future-dated approach is not history', w.eval("needsIFRTracking({pilotType:'bush'})"), false);

w.eval('Date = window.__RealDate;');

if (failures.length) {
  console.error(`\n✗ currency-windows: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ currency-windows passed — local civil today (never UTC), 6/12-month cutoffs on the local date, same-numbered day included, future flights excluded, 90-day item = exactly 90 dates, card = shared counters');
process.exit(0);
