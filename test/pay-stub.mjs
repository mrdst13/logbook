// ═══════════════════════════════════════════════════════════════════
// PORTER PAY-STUB PARSER TEST (src/js/29-pay-stub.js)
//
// SYNTHETIC stub text — the real Porter layout, but every dollar figure is
// made up (never a real pilot's numbers). Locks in: two-decimal column rule,
// label digits ("Overtime 1.0", "Passport 10 yr", "E195") NOT read as columns,
// negatives ("20.00-"), YTD-only lines (amount stays null), and the earning /
// deduction split on a shared row.
//
// Run:  node test/pay-stub.mjs   (part of `npm test`)
// ═══════════════════════════════════════════════════════════════════
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ps = require('../src/js/29-pay-stub.js');

const failures = [];
const chk = (label, cond) => { if (!cond) failures.push(label); };
const near = (a, b, tol = 0.005) => Math.abs((+a || 0) - (+b || 0)) <= tol;

const TEXT = [
  'STATEMENT OF EARNINGS AND DEDUCTIONS CONFIDENTIAL',
  'Porter Airlines Inc Some Pilot PERIOD ENDING: 31-May-2026',
  'Billy Bishop Toronto City 000000000 DEPOSIT DATE: 15-Jun-2026',
  'Toronto, ON CAN A1A 1A1 First Officer E195 YYZ TOTAL DEPOSIT 1,111.11',
  'Code Units Type Rate Amount YTD Code Amount YTD',
  '001 Regular Earnings 38.75 100.00 3,875.00 40,000.00 501 Canada Pension 300.00 3,000.00',
  '005 Overtime 1.0 4.00 100.00 600.00 900.00 511 Employment Insurance 80.00 900.00',
  '030 Draft Pay - SDO 1.5 1,000.00 521 Income Tax 1,000.00 10,000.00',
  '098 Retroactive Pay 2.00 -10.00 20.00- 20.00- 530 RRSP / DPSP 200.00 2,000.00',
  '250 Per Diem US ( 150.00 587 ALPA Union Dues 90.00 1,000.00',
  '252 Per Diem CDN ( 80.00 4.25 340.00 3,000.00 600 Basic Life 3.00 40.00',
  '253 Footwear Allowance 8.00 100.00 620 LTD 50.00 500.00',
  '257 Passport 10 yr 1.00 12.00',
  'Earnings This Period 5,485.00 Deductions This Period 1,723.00'
].join('\n');

const p = ps.parsePayStub(TEXT);
const by = {}; p.earnings.forEach(e => { by[e.code] = e; });

// 1. Metadata.
chk('period', p.period === '31-May-2026');
chk('deposit date', p.deposit === '15-Jun-2026');
chk('position keeps aircraft (E195 not truncated)', p.position === 'First Officer E195 YYZ');
chk('total deposit', near(p.totalDeposit, 1111.11));
chk('earnings this period', near(p.earningsThisPeriod, 5485.00));
chk('month key', ps.payStubMonth(p.period) === '2026-05');

// 2. Full earnings row → units, rate, amount, ytd all correct.
chk('001 units', near(by['001'].units, 38.75));
chk('001 rate', near(by['001'].rate, 100.00));
chk('001 amount', near(by['001'].amount, 3875.00));
chk('001 ytd', near(by['001'].ytd, 40000.00));

// 3. Label multiplier "1.0" is NOT read as a column value.
chk('005 label keeps 1.0', by['005'].label === 'Overtime 1.0');
chk('005 amount (not 1.0)', near(by['005'].amount, 600.00));
chk('005 units 4.00', near(by['005'].units, 4.00));

// 4. YTD-only line (single column value) → amount stays null (never guessed).
chk('030 amount null (YTD only)', by['030'].amount === null);
chk('030 ytd', near(by['030'].ytd, 1000.00));
chk('250 US amount null', by['250'].amount === null);
chk('250 US ytd', near(by['250'].ytd, 150.00));

// 5. Negative ("20.00-") parsed as negative.
chk('098 negative amount', near(by['098'].amount, -20.00));

// 6. Per diem CDN full row (stray "(" dropped).
chk('252 CDN units', near(by['252'].units, 80.00));
chk('252 CDN rate', near(by['252'].rate, 4.25));
chk('252 CDN amount', near(by['252'].amount, 340.00));

// 7. Label digits ("10 yr") not read as a column; 2-number allowance → amount/ytd.
chk('257 label keeps 10 yr', by['257'].label === 'Passport 10 yr');
chk('257 amount', near(by['257'].amount, 1.00));
chk('257 ytd', near(by['257'].ytd, 12.00));

// 8. Earning / deduction split on shared rows.
chk('deductions captured', ['501', '511', '521', '530', '587', '600', '620'].every(c => p.deductions.some(d => d.code === c)));
chk('deduction 501 amount', near((p.deductions.find(d => d.code === '501') || {}).amount, 300.00));
chk('earnings not polluted by deduction codes', p.earnings.every(e => +e.code < 500));

// 9. Reconciliation buckets.
const b = ps.payStubBuckets(p);
chk('bucket regular amount', near(b.regular.amount, 3875.00));
chk('bucket overtime = 005 + 030(null) = 600', near(b.overtime.amount, 600.00));
chk('bucket perDiemCdn units', near(b.perDiemCdn.units, 80.00));
chk('bucket perDiemUs amount null', b.perDiemUs.amount === null);

// 10. Empty / garbage input never throws.
chk('empty text → empty result', ps.parsePayStub('').earnings.length === 0);
chk('garbage text → no throw', ps.parsePayStub('hello world 123').earnings.length === 0);

if (failures.length) { console.error('pay-stub FAIL:', failures); process.exit(1); }
console.log('pay-stub: all checks passed (metadata, 2-decimal columns, label digits, YTD-only, negatives, per-diem, earning/deduction split, buckets, robustness)');
process.exit(0);
