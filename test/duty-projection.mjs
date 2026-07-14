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
//
// All dates are passed in explicitly (no wall-clock dependency) so the test is
// stable on any day it runs.
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

if (failures.length) {
  console.error(`\n✗ duty-projection: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ duty-projection passed — block estimation, roster forecast extraction, rolling-window peak/breach, actuals+forecast merge & dedup');
process.exit(0);
