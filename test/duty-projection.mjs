// ═══════════════════════════════════════════════════════════════════
// DUTY CUMULATIVE-LIMIT PROJECTION TEST
//
// Feature (Martin 2026-07-14): the Duty page's 28/90/365-day flight-time
// windows are tappable (counted flights) and carry a FORECAST — "if you fly
// your published roster, when would you reach the CAR 700.27 limit?". This
// pins the engine:
//   • scheduledBlockHours  — STA−STD as decimal hours, midnight-wrap, garbage→0
//   • rosterForecastFromEvents — future PD flights only; deadhead / wrong
//        airline / past excluded; block from BLH, else estimated from STD/STA
//   • projectRollingWindow — peak + first breach date; stale flights drop out
//        of the rolling window
//   • computeDutyProjection — actuals + forecast merged, breach detected,
//        forecast flights already logged are not double-counted
//   • WINDOW SEMANTICS (2026-07-16, bug caught by Martin in prod): an N-day
//        window is EXACTLY N local calendar dates — cutoff = today − (N−1),
//        selection = cutoff <= date <= today. The 29th day back is NOT
//        counted, a flight dated tomorrow is NOT counted, and "today" is the
//        LOCAL date (_dutyLocalToday), never the UTC toISOString date.
//
// All dates are passed in explicitly (no wall-clock dependency) so the test is
// stable on any day it runs. The local-today tests stub the window's Date at a
// fixed local-evening instant instead.
//
// Run:  node test/duty-projection.mjs   (also part of `npm test`)
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
const eq = (label, got, want) => { if (got !== want) failures.push(`${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`); };
const J = o => JSON.stringify(o);

// Guard: Intl time zones must work, else icsLocalDate silently mis-dates and the
// forecast test would be meaningless.
const intlOk = w.eval(`(function(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto'}).format(new Date(0));}catch(e){return 'ERR';}})()`);
if (intlOk === 'ERR') failures.push('Intl timeZone unsupported in runtime — cannot validate forecast');

// ── scheduledBlockHours ──────────────────────────────────────────────
eq('block 14:00→15:45 = 1.75', w.eval("scheduledBlockHours('1400','1545')"), 1.75);
eq('block midnight wrap 23:00→00:30 = 1.5', w.eval("scheduledBlockHours('2300','0030')"), 1.5);
eq('block garbage → 0', w.eval("scheduledBlockHours('nope','1200')"), 0);
eq('block zero span → 0', w.eval("scheduledBlockHours('1200','1200')"), 0);
eq('block absurd (>16h) → 0', w.eval("scheduledBlockHours('0000','1700')"), 0);

// ── rosterForecastFromEvents (today = 2026-07-14) ─────────────────────
const events = [
  { SUMMARY: 'PD100 YYZ-YOW', DESCRIPTION: 'BLH: 1:30 STD 1400Z STA 1530Z', DTSTART: '20260720T140000Z' }, // future, BLH 1.5
  { SUMMARY: 'PD200 YOW-YYZ', DESCRIPTION: 'STD 1600Z STA 1730Z',           DTSTART: '20260720T160000Z' }, // future, no BLH → est 1.5
  { SUMMARY: 'PD999 YYZ-YOW (D)', DESCRIPTION: 'BLH: 1:00',                  DTSTART: '20260721T140000Z' }, // deadhead → excluded
  { SUMMARY: 'AC300 YYZ-YVR', DESCRIPTION: 'BLH: 5:00',                      DTSTART: '20260722T140000Z' }, // wrong airline → excluded
  { SUMMARY: 'PD050 YYZ-YOW', DESCRIPTION: 'BLH: 1:20',                      DTSTART: '20260101T140000Z' }, // past → excluded
];
const fc = JSON.parse(w.eval(`JSON.stringify(rosterForecastFromEvents(${J(events)}, '2026-07-14'))`));
eq('forecast keeps 2 flights', fc.length, 2);
eq('forecast[0] PD100 block 1.5', fc[0] && `${fc[0].flightNum}:${fc[0].block}:${fc[0].estimated}`, 'PD100:1.5:false');
eq('forecast[1] PD200 estimated 1.5', fc[1] && `${fc[1].flightNum}:${fc[1].block}:${fc[1].estimated}`, 'PD200:1.5:true');

// ── projectRollingWindow ─────────────────────────────────────────────
// Breach: four 30 h days inside a 28-day window → 120 ≥ 112 on the last one.
const hb = { '2026-07-05': 30, '2026-07-10': 30, '2026-07-15': 30, '2026-07-20': 30 };
const pBreach = JSON.parse(w.eval(`JSON.stringify(projectRollingWindow(${J(hb)}, 28, 112, '2026-07-01', '2026-07-31'))`));
eq('breach peak 120', pBreach.peak, 120);
eq('breach date = 2026-07-20', pBreach.hitDate, '2026-07-20');

// No breach: same spacing at 20 h/day → 80 h peak, never hits 112.
const hb2 = { '2026-07-05': 20, '2026-07-10': 20, '2026-07-15': 20, '2026-07-20': 20 };
const pOk = JSON.parse(w.eval(`JSON.stringify(projectRollingWindow(${J(hb2)}, 28, 112, '2026-07-01', '2026-07-31'))`));
eq('no-breach peak 80', pOk.peak, 80);
eq('no-breach hitDate null', pOk.hitDate, null);

// Rolling drop-off: a 100 h day in January is outside the 28-day window in July,
// so it must NOT contribute to a July window.
const hb3 = { '2026-01-01': 100, '2026-07-20': 50 };
const pDrop = JSON.parse(w.eval(`JSON.stringify(projectRollingWindow(${J(hb3)}, 28, 112, '2026-07-01', '2026-07-31'))`));
eq('stale flight excluded → peak 50', pDrop.peak, 50);
eq('stale flight excluded → no hit', pDrop.hitDate, null);

// ── computeDutyProjection (actuals + forecast, fixed today) ───────────
// Logged actuals: 60 h in the recent window. Forecast: 60 h upcoming → 120 ≥ 112.
w.eval("flights = [" +
  "{date:'2026-07-10', flightNum:'PD1', total:30}," +
  "{date:'2026-07-12', flightNum:'PD2', total:30}" +
"];");
w.eval("localStorage.setItem('cumulo_roster_forecast_v1', JSON.stringify({ts:1, today:'2026-07-14', flights:[" +
  "{date:'2026-07-16', flightNum:'PD3', route:'YYZ-YOW', block:30, estimated:false}," +
  "{date:'2026-07-18', flightNum:'PD4', route:'YOW-YYZ', block:30, estimated:false}" +
"]}));");
const cp = JSON.parse(w.eval(`JSON.stringify(computeDutyProjection(28, 112, '2026-07-14'))`));
eq('proj forecastCount 2', cp.forecastCount, 2);
eq('proj peak 120', cp.peak, 120);
eq('proj hitDate 2026-07-18', cp.hitDate, '2026-07-18');
eq('proj names hit flight PD4', cp.hitFlight && cp.hitFlight.flightNum, 'PD4');

// Dedup: a forecast flight already logged (same date + flightNum) is not counted twice.
w.eval("localStorage.setItem('cumulo_roster_forecast_v1', JSON.stringify({ts:1, today:'2026-07-14', flights:[" +
  "{date:'2026-07-12', flightNum:'PD2', route:'YYZ-YOW', block:30, estimated:false}" +  // already in flights
"]}));");
const cpDedup = JSON.parse(w.eval(`JSON.stringify(computeDutyProjection(28, 112, '2026-07-14'))`));
eq('dedup drops already-logged forecast', cpDedup.forecastCount, 0);

// ── Window = EXACTLY N dates (2026-07-16 fix, bug caught by Martin in prod) ──
// (a) 28-day window ending 2026-07-16 = the 28 dates 2026-06-19 … 2026-07-16.
eq('cutoff = today − 27', w.eval("_dutyWindowCutoff(28, '2026-07-16')"), '2026-06-19');
eq('window holds exactly 28 dates',
  w.eval("_dutyDateSeq(_dutyWindowCutoff(28, '2026-07-16'), '2026-07-16').length"), 28);

// (b)+(c) The 29th day back is NOT counted; a flight dated tomorrow is NOT counted.
w.eval("flights = [" +
  "{date:'2026-06-19', flightNum:'PDA', total:10}," +   // 28th date back → counted
  "{date:'2026-06-18', flightNum:'PDB', total:100}," +  // 29th date back → NOT counted
  "{date:'2026-07-16', flightNum:'PDC', total:2}," +    // today → counted
  "{date:'2026-07-17', flightNum:'PDD', total:50}" +    // tomorrow → NOT counted
"];");
eq('window total = 28 dates only (no 29th day, no tomorrow)',
  w.eval("_dutyFlightTimeInDays(28, '2026-07-16')"), 12);
eq('flights-in-window list matches the same bounds',
  w.eval("_dutyFlightsInWindow(28, '2026-07-16').map(function(f){return f.num;}).sort().join(',')"), 'PDA,PDC');

// Same boundary inside the projection engine: a flight on the 28th date back
// counts toward the window at D; one on the 29th does not.
const pIn = JSON.parse(w.eval(`JSON.stringify(projectRollingWindow(${J({ '2026-06-19': 60, '2026-07-16': 60 })}, 28, 112, '2026-07-01', '2026-07-31'))`));
eq('engine: 28th date back counted → 120, hit', `${pIn.peak}:${pIn.hitDate}`, '120:2026-07-16');
const pOut = JSON.parse(w.eval(`JSON.stringify(projectRollingWindow(${J({ '2026-06-18': 60, '2026-07-16': 60 })}, 28, 112, '2026-07-01', '2026-07-31'))`));
eq('engine: 29th date back NOT counted → peak 60, no hit', `${pOut.peak}:${pOut.hitDate}`, '60:null');

// ── PEAK ON A DAY OFF: fromDate must be evaluated even with no hours ────────
// (2026-07-17) projectRollingWindow only iterated Object.keys(hoursByDate), so
// on a day off — no flight logged, no block planned TODAY — the window total at
// `fromDate` was never evaluated and `peak` reported only the FUTURE maximum.
// With heavy days aging out of the trailing window and a light roster ahead the
// window can only FALL, so the true peak IS today; the old code announced the
// far lower future max, i.e. FAR more room than really exists — the permissive
// direction on a hard CAR 700.27 limit.
// Window today = [2026-06-20 … 2026-07-17] = 25+25+24+24 = 98 h. It only falls
// after that: by 07-20 the three oldest days have aged out (24 + 3 planned = 27).
const hbOff = { '2026-06-20': 25, '2026-06-21': 25, '2026-06-22': 24, '2026-06-23': 24, '2026-07-20': 3, '2026-07-23': 3.5 };
const pOff = JSON.parse(w.eval(`JSON.stringify(projectRollingWindow(${J(hbOff)}, 28, 112, '2026-07-17', '2026-07-23'))`));
eq('day off: peak = window at fromDate, not the future max', `${pOff.peak}:${pOff.peakDate}`, '98:2026-07-17');
eq('day off: no false breach', pOff.hitDate, null);
// The engine must agree with _dutyRollAt, which the chart's tooltips use: one
// question ("how close am I?"), one answer.
eq('day off: engine peak === _dutyRollAt at today',
  pOff.peak, w.eval(`_dutyRollAt(${J(hbOff)}, 28, '2026-07-17')`));
// Continuity: 0.1 h flown today must not move the announced margin by 71 h.
const hbOff2 = Object.assign({}, hbOff, { '2026-07-17': 0.1 });
const pOff2 = JSON.parse(w.eval(`JSON.stringify(projectRollingWindow(${J(hbOff2)}, 28, 112, '2026-07-17', '2026-07-23'))`));
eq('day off + 0.1 h today: peak moves by 0.1, not by 71', `${pOff2.peak}:${pOff2.peakDate}`, '98.1:2026-07-17');
// A breach ON fromDate is likewise found even when fromDate carries no hours.
const hbOverToday = { '2026-06-20': 60, '2026-06-21': 60 };
const pOverToday = JSON.parse(w.eval(`JSON.stringify(projectRollingWindow(${J(hbOverToday)}, 28, 112, '2026-07-17', '2026-07-23'))`));
eq('day off: window already over the limit today → hitDate = today', pOverToday.hitDate, '2026-07-17');
// fromDate must not be double-counted when it DOES carry hours (peak stays exact).
const pDup = JSON.parse(w.eval(`JSON.stringify(projectRollingWindow(${J({ '2026-07-17': 5 })}, 28, 112, '2026-07-17', '2026-07-20'))`));
eq('fromDate carrying hours is counted exactly once', `${pDup.peak}:${pDup.peakDate}`, '5:2026-07-17');

// (d) "Today" is the LOCAL calendar date, and the projection starts there.
// Stub the window's Date at a fixed instant: 2026-07-16 23:30 LOCAL time. In
// any timezone west of UTC (e.g. America/Toronto) toISOString() already reads
// 2026-07-17, so the old UTC-based code would fail these assertions.
const fixedMs = new Date(2026, 6, 16, 23, 30).getTime();
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
eq('local today at 23:30 local = 2026-07-16', w.eval('_dutyLocalToday()'), '2026-07-16');
eq('default window total = override(local today) total',
  w.eval('_dutyFlightTimeInDays(28)'), w.eval("_dutyFlightTimeInDays(28, '2026-07-16')"));
w.eval("flights = []; localStorage.removeItem('cumulo_roster_forecast_v1');");
const cpToday = JSON.parse(w.eval('JSON.stringify(computeDutyProjection(28, 112))'));
eq('projection starts at local today (horizonEnd)', cpToday.horizonEnd, '2026-07-16');
const ddToday = JSON.parse(w.eval('JSON.stringify(_dutyDrillData(28))'));
eq('drill-down today = local today', ddToday.today, '2026-07-16');
eq('drill-down cut = today − 27', ddToday.cut, '2026-06-19');
w.eval('Date = window.__RealDate;');

// ── RENDER LAYER: the chart must answer "where will I be on the 21st?" ──────
// Martin (2026-07-17): "je peux pas voir comment proche je vais etre le 21
// juillet". The curve now carries the figures, so these pin that what it SAYS
// matches what the engine computes and what the folded table lists.
const T = '2026-07-17';
const cume = (fr) => w.eval(`_dutyCumeBlock(_dutyDrillData(28,'${T}'), 28, 112, _dutyFlightTimeInDays(28,'${T}'), computeDutyProjection(28,112,'${T}'), 'range', ${!!fr})`);
const setUp = (fl, fc) => {
  w.eval(`flights = ${J(fl)};`);
  w.eval(`localStorage.setItem('cumulo_roster_forecast_v1', ${J(JSON.stringify({ ts: 1, today: T, flights: fc }))});`);
};
const shift = (d) => w.eval(`_dutyShiftDate('${T}', ${d})`);

// (1) Day off + falling window: the "Peak" label must name the visible summit
// of the curve — max(todayRoll, ...futVals) — never a point below it.
setUp(
  [[-27, 25], [-26, 25], [-25, 24], [-24, 24]].map(([d, h], i) => ({ date: shift(d), flightNum: 'PH' + i, total: h })),
  [{ date: shift(3), flightNum: 'PX1', route: 'YYZ-YOW', block: 3.0, estimated: false },
   { date: shift(6), flightNum: 'PX2', route: 'YOW-YYZ', block: 3.5, estimated: false }]
);
const hOff = cume(false);
eq('day off: peak label names today at the real window total',
  (hOff.match(/>(Peak: [^<]*)</) || [])[1], 'Peak: Jul 17 · 98.0 h (14.0 h left)');
// The label and today's tooltip are two renderings of the SAME question.
const offTitles = [...hOff.matchAll(/<title>(July 17[^<]*)<\/title>/g)].map(m => m[1]);
eq('day off: today tooltip agrees with the peak label',
  offTitles[offTitles.length - 1], 'July 17: 98.0 h of 112 h · 14.0 h left');
// Pin the invariant itself: label total === max of the values actually plotted.
const ddOff = JSON.parse(w.eval(`JSON.stringify(_dutyDrillData(28, '${T}'))`));
const projOff = JSON.parse(w.eval(`JSON.stringify(computeDutyProjection(28, 112, '${T}'))`));
const plotted = [w.eval(`_dutyRollAt(${J(ddOff.combined)}, 28, '${T}')`)];
for (let k = 1; ; k++) {
  const D = shift(k);
  if (D > (projOff.hitDate || projOff.horizonEnd)) break;
  plotted.push(w.eval(`_dutyRollAt(${J(ddOff.combined)}, 28, '${D}')`));
}
eq('peak label total === max of the plotted curve values',
  Math.round(projOff.peak * 10) / 10, Math.round(Math.max(...plotted) * 10) / 10);

// (2) Schedule imported, last remaining flight is TODAY (hasFc false): there is
// no dashed line and no table, so the dot and the tooltip must report what is
// RECORDED — never recorded+planned dressed up as fact (schedule ≠ actual).
setUp(
  [{ date: '2026-07-17', flightNum: 'PL1', total: 40 }],
  [{ date: '2026-07-17', flightNum: 'PL2', route: 'YYZ-YOW', block: 9.5, estimated: false }]
);
const hTod = cume(false);
eq('last flight today: no dashed projection curve', /stroke-dasharray/.test(hTod), false);
eq('last flight today: no rolling-total table', /Chart data: rolling total/.test(hTod), false);
const todTitles = [...hTod.matchAll(/<title>(July 17[^<]*)<\/title>/g)].map(m => m[1]);
eq('last flight today: tooltip reports RECORDED hours, matching the window card',
  todTitles[todTitles.length - 1], 'July 17: 40.0 h of 112 h · 72.0 h left');
// The dot must sit on the end of the solid line, not float above it.
const solidEnd = ((hTod.match(/stroke-width="2"[^>]*points="([^"]*)"/) || [])[1] || '').split(' ').pop();
const todDot = hTod.match(/<circle cx="([\d.]+)" cy="([\d.]+)" r="3"/);
eq('last flight today: dot sits on the solid line end',
  todDot && `${todDot[1]},${todDot[2]}`, solidEnd);

// (3) Every rendered caption stays inside the 720-wide viewBox. A clipped
// caption is unreadable AND, half off-canvas, a phantom obstacle that shoves
// the answer label around. Short horizons (incl. every over-limit render, since
// the chart stops at hitDate) put the Projection caption hard right.
const box = (x, y, text, size, anchor) => {
  const wd = String(text).length * size * 0.55 + 4;
  const bx = anchor === 'end' ? x - wd : (anchor === 'middle' ? x - wd / 2 : x);
  return { x0: bx, x1: bx + wd };
};
let clipped = 0, checked = 0;
for (const horizon of [1, 2, 3, 5, 8, 11, 20, 31]) {
  for (const fr of [true, false]) {
    setUp(
      Array.from({ length: 20 }, (_, i) => ({ date: shift(-i), flightNum: 'F' + i, total: 3.2 })),
      Array.from({ length: horizon }, (_, i) => ({ date: shift(i + 1), flightNum: 'G' + i, route: 'YYZ-YOW', block: 2.0, estimated: false }))
    );
    const h = cume(fr);
    // Segment captions are the only 10.5px / weight-500 texts (the limit caption
    // is weight 600, the axis labels are 10px).
    for (const m of h.matchAll(/<text\b([^>]*font-size="10\.5"[^>]*font-weight="500"[^>]*)>([^<]*)</g)) {
      const attrs = m[1];
      const raw = m[2].replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c)).replace(/&amp;/g, '&');
      const x = +(attrs.match(/\bx="([\d.]+)"/) || [])[1];
      const anchor = (attrs.match(/\btext-anchor="(\w+)"/) || [])[1] || 'start';
      checked++;
      const b = box(x, 0, raw, 10.5, anchor);
      if (b.x1 > 720 || b.x0 < 0) { clipped++; failures.push(`caption clipped (horizon ${horizon}, fr=${fr}): "${raw}" x=${x} anchor=${anchor} → [${b.x0.toFixed(1)}, ${b.x1.toFixed(1)}] outside [0, 720]`); }
    }
  }
}
eq('every segment caption measured', checked > 0, true);
eq('no segment caption is clipped by the viewBox', clipped, 0);

w.eval("flights = []; localStorage.removeItem('cumulo_roster_forecast_v1');");

if (failures.length) {
  console.error(`\n✗ duty-projection: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ duty-projection passed — block estimation, roster forecast extraction, rolling-window peak/breach, actuals+forecast merge & dedup, exact N-date window bounds, local-today (never UTC), peak on a day off (fromDate always evaluated), chart answers match the engine, schedule never shown as actual, no clipped caption');
process.exit(0);
