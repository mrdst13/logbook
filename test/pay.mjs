// ═══════════════════════════════════════════════════════════════════
// PAY RECONCILIATION TEST (src/js/28-pay.js)
//
// Pure calc functions: pairing grouping, per diem (CDN + US layover split),
// daily credit rig (max flight / duty÷2 / 4:00), and base-pay + overtime.
//
// Run:  node test/pay.mjs   (also part of `npm test`)
// ═══════════════════════════════════════════════════════════════════
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pay = require('../src/js/28-pay.js');

const failures = [];
const chk = (label, cond) => { if (!cond) failures.push(label); };
const near = (a, b, tol = 0.01) => Math.abs((+a || 0) - (+b || 0)) <= tol;

// Synthetic 2-day pairing with a US layover: YOW→BOS (overnight)→YOW.
const flights = [
  { date: '2026-07-01', dep_icao: 'CYOW', arr_icao: 'KBOS', dtstart_utc: '2026-07-01T13:00:00.000Z',
    block: 1.5, duty: 3.0, ci_utc: '1215', co_utc: '1445' },
  { date: '2026-07-02', dep_icao: 'KBOS', arr_icao: 'CYOW', dtstart_utc: '2026-07-02T14:00:00.000Z',
    block: 1.5, duty: 3.0, ci_utc: '1315', co_utc: '1545' },
];

// 1. Pairing grouping — the two legs form ONE pairing (leave YOW → return YOW).
const pairings = pay.groupPairings(flights, 'CYOW');
chk('one pairing from YOW out-and-back', pairings.length === 1 && pairings[0].length === 2);

// 2. Per diem split. away = 07-01 12:15Z → 07-02 15:45Z = 27.5 h.
//    US layover (BOS) = CO of inbound (14:45Z 07-01) → CI of outbound (13:15Z 07-02) = 22.5 h.
//    CDN = 27.5 − 22.5 = 5.0 h.
const pd = pay.computePerDiem(flights, 'CYOW', { cdn: 4.25, usUsd: 4.25, fx: 1.37 });
chk('per diem: away 27.5 h', near(pd.awayHours, 27.5));
chk('per diem: US layover 22.5 h', near(pd.usHours, 22.5));
chk('per diem: CDN 5.0 h', near(pd.cdnHours, 5.0));
chk('per diem: CDN amount 5×4.25 = 21.25', near(pd.cdnAmount, 21.25));
chk('per diem: US amount 22.5×4.25×1.37 = 131.01', near(pd.usAmount, 131.01, 0.02));
chk('per diem: total = CDN + US', near(pd.total, 21.25 + pd.usAmount, 0.02));

// 3. No US legs → all CDN, US = 0.
const cdnOnly = pay.computePerDiem([
  { date: '2026-05-05', dep_icao: 'CYOW', arr_icao: 'CYYZ', dtstart_utc: '2026-05-05T13:00:00.000Z', block: 1.0, duty: 2.0, ci_utc: '1230', co_utc: '1415' },
  { date: '2026-05-05', dep_icao: 'CYYZ', arr_icao: 'CYOW', dtstart_utc: '2026-05-05T18:00:00.000Z', block: 1.0, duty: 2.0, ci_utc: '1730', co_utc: '1915' },
], 'CYOW', { cdn: 4.25, usUsd: 4.25, fx: 1.37 });
chk('domestic pairing: US hours = 0', near(cdnOnly.usHours, 0));
chk('domestic pairing: all away is CDN', near(cdnOnly.cdnHours, cdnOnly.awayHours));

// 4. Daily credit rig = max(flight time, duty÷2, 4:00). One day per branch.
const cr = pay.computeCredits([
  { date: '2026-07-10', block: 2.0, duty: 3.0 },   // max(2, 1.5, 4) = 4  (4:00 minimum wins)
  { date: '2026-07-11', block: 5.0, duty: 12.0 },  // max(5, 6, 4) = 6    (duty÷2 wins)
  { date: '2026-07-12', block: 6.5, duty: 8.0 },   // max(6.5, 4, 4) = 6.5 (flight time wins)
]);
chk('credit day 1 (4:00 min) = 4', near(cr.days.find(d => d.date === '2026-07-10').credit, 4));
chk('credit day 2 (duty/2) = 6', near(cr.days.find(d => d.date === '2026-07-11').credit, 6));
chk('credit day 3 (flight) = 6.5', near(cr.days.find(d => d.date === '2026-07-12').credit, 6.5));
chk('total credit = 16.5', near(cr.creditHours, 16.5));

// 5. Base pay + OT. 90 credits, rate 120.79, MMG 77.5, OT threshold 85.
const bp = pay.computeBasePay(90, { rate: 120.79, mmg: 77.5, otThreshold: 85, otMult: 1.5 });
chk('base: straight capped at 85', near(bp.straightHours, 85));
chk('base: OT = 90−85 = 5', near(bp.otHours, 5));
chk('base: OT amount = 5×120.79×1.5', near(bp.otAmount, 5 * 120.79 * 1.5));
chk('base: total straight + OT', near(bp.total, 85 * 120.79 + 5 * 120.79 * 1.5));

// 5b. Summer LOA at 2.0×.
const bpLoa = pay.computeBasePay(90, { rate: 120.79, mmg: 77.5, otThreshold: 85, otMult: 2.0 });
chk('LOA: OT at 2.0× = 5×120.79×2', near(bpLoa.otAmount, 5 * 120.79 * 2));

// 5c. Guarantee floor — below MMG pays 77.5, no OT.
const bpGuar = pay.computeBasePay(70, { rate: 120.79, mmg: 77.5, otThreshold: 85, otMult: 1.5 });
chk('guarantee: straight = 77.5 floor', near(bpGuar.straightHours, 77.5));
chk('guarantee: no OT below threshold', near(bpGuar.otHours, 0) && bpGuar.guaranteeApplied === true);

// 6. Summer-LOA window.
chk('LOA window: 2026-07-01 inside', pay.isSummerLOA('2026-07-01') === true);
chk('LOA window: 2026-05-31 outside', pay.isSummerLOA('2026-05-31') === false);
chk('LOA window: 2026-09-01 outside', pay.isSummerLOA('2026-09-01') === false);

// 7. Hourly rate by seat year — ONLY verified rates are mapped (Year 3 = 120.79,
//    matches Martin's stub). An unmapped year returns 0, never a guessed number.
chk('rate year 3 = 120.79', near(pay.payRateForYear(3), 120.79));
chk('rate year 3 (string) = 120.79', near(pay.payRateForYear('3'), 120.79));
chk('rate unmapped year → 0 (never guessed)', pay.payRateForYear(2) === 0);
chk('rate empty year → 0', pay.payRateForYear('') === 0);

// 8. US per-diem USD→CAD rate derived from the stub (Martin's choice 2026-07-14).
//    22.5 US h × $4.25 × fx = $131.01 → fx ≈ 1.3700.
chk('derive fx from stub ≈ 1.37', near(pay.deriveUsFx(131.01, 22.5, 4.25), 1.37, 0.001));
chk('derive fx: no stub → 0', pay.deriveUsFx(0, 22.5, 4.25) === 0);
chk('derive fx: no US hours → 0', pay.deriveUsFx(131.01, 0, 4.25) === 0);
chk('derive fx: no rate → 0', pay.deriveUsFx(131.01, 22.5, 0) === 0);
// Round-trip: US hours × rate × derived fx == stub → the US line mirrors the stub.
const rtFx = pay.deriveUsFx(131.01, 22.5, 4.25);
chk('US per diem round-trips to the stub', near(22.5 * 4.25 * rtFx, 131.01, 0.01));

// 9. Per-US-day breakdown — one entry per US layover (KBOS, 22.5 h); domestic → none.
const usd = pay.usPerDiemDays(flights, 'CYOW');
chk('one US layover day (KBOS)', usd.length === 1 && usd[0].icao === 'KBOS');
chk('US layover day = 22.5 h', near(usd[0].hours, 22.5));
const usdDom = pay.usPerDiemDays([
  { date: '2026-05-05', dep_icao: 'CYOW', arr_icao: 'CYYZ', dtstart_utc: '2026-05-05T13:00:00.000Z', block: 1.0, duty: 2.0, ci_utc: '1230', co_utc: '1415' },
  { date: '2026-05-05', dep_icao: 'CYYZ', arr_icao: 'CYOW', dtstart_utc: '2026-05-05T18:00:00.000Z', block: 1.0, duty: 2.0, ci_utc: '1730', co_utc: '1915' },
], 'CYOW');
chk('domestic → no US days', usdDom.length === 0);

// 10. deriveUsFx guards a negative stub amount → 0 (never a negative rate). [review]
chk('derive fx: negative stub → 0', pay.deriveUsFx(-50, 22.5, 4.25) === 0);

// 11. usPerDiemDays with TWO US layovers in one pairing → two entries, date order.
const twoUs = pay.usPerDiemDays([
  { date: '2026-09-01', dep_icao: 'CYOW', arr_icao: 'KBOS', dtstart_utc: '2026-09-01T13:00:00.000Z', block: 1.5, ci_utc: '1215', co_utc: '1445' },
  { date: '2026-09-02', dep_icao: 'KBOS', arr_icao: 'KEWR', dtstart_utc: '2026-09-02T14:00:00.000Z', block: 1.0, ci_utc: '1315', co_utc: '1500' },
  { date: '2026-09-03', dep_icao: 'KEWR', arr_icao: 'CYOW', dtstart_utc: '2026-09-03T14:00:00.000Z', block: 1.5, ci_utc: '1315', co_utc: '1545' },
], 'CYOW');
chk('two US layovers → two entries in date order', twoUs.length === 2 && twoUs[0].icao === 'KBOS' && twoUs[1].icao === 'KEWR');

// 12. usPerDiemDays date fallback: arriving US leg has no `date` → uses next leg's.
const noDate = pay.usPerDiemDays([
  { dep_icao: 'CYOW', arr_icao: 'KBOS', dtstart_utc: '2026-10-01T13:00:00.000Z', block: 1.5, ci_utc: '1215', co_utc: '1445' },
  { date: '2026-10-02', dep_icao: 'KBOS', arr_icao: 'CYOW', dtstart_utc: '2026-10-02T14:00:00.000Z', block: 1.5, ci_utc: '1315', co_utc: '1545' },
], 'CYOW');
chk('US-day date falls back to next leg', noDate.length === 1 && noDate[0].date === '2026-10-02');

// 13. Month-straddling pairing stays WHOLE, assigned to its first leg's month, so
//     the US layover is NOT lost at the boundary. [review — the false-'0 US h?' bug]
const straddle = [
  { date: '2026-07-31', dep_icao: 'CYOW', arr_icao: 'KBOS', dtstart_utc: '2026-07-31T22:00:00.000Z', block: 1.5, ci_utc: '2115', co_utc: '2345' },
  { date: '2026-08-01', dep_icao: 'KBOS', arr_icao: 'CYOW', dtstart_utc: '2026-08-01T14:00:00.000Z', block: 1.5, ci_utc: '1315', co_utc: '1545' },
];
const julLegs = pay._payMonthPairingLegs(straddle, 'CYOW', '2026-07');
const augLegs = pay._payMonthPairingLegs(straddle, 'CYOW', '2026-08');
chk('straddling pairing assigned wholly to July', julLegs.length === 2);
chk('nothing leaks into August', augLegs.length === 0);
chk('straddling US layover hours preserved (>0)', pay.computePerDiem(julLegs, 'CYOW', { cdn: 4.25, usUsd: 4.25, fx: 1 }).usHours > 0);
// A raw calendar-month leg filter (the old bug) would give July usHours = 0:
chk('control: month-filtered legs LOSE the US layover', pay.computePerDiem(straddle.filter(f => f.date.slice(0,7) === '2026-07'), 'CYOW', { cdn: 4.25, usUsd: 4.25, fx: 1 }).usHours === 0);

if (failures.length) { console.error('pay FAIL:', failures); process.exit(1); }
console.log('pay: all checks passed (pairings, per diem CDN/US split, credit rig, base pay + OT, guarantee, LOA, seat-year rate, derived US fx, per-US-day, negative-fx guard, multi-US-day, date fallback, month-straddle pairing)');
process.exit(0);
