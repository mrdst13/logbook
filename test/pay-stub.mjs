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

// 11. Checksum (review 2026-07-15): amounts summing to "Earnings This Period" → ok;
//     a mis-read → not ok, so the UI can warn instead of asserting a wrong figure.
const okStub = ps.parsePayStub([
  'PERIOD ENDING: 30-Jun-2026',
  '001 Regular Earnings 38.75 100.00 3,000.00 40,000.00',
  '252 Per Diem CDN ( 80.00 4.25 340.00 3,000.00',
  'Earnings This Period 3,340.00 Deductions This Period 0.00'
].join('\n'));
chk('checksum ok when amounts sum to Earnings This Period', !!okStub.checksum && okStub.checksum.ok === true);
const badStub = ps.parsePayStub([
  'PERIOD ENDING: 30-Jun-2026',
  '001 Regular Earnings 38.75 100.00 3,000.00 40,000.00',
  'Earnings This Period 7,000.00 Deductions This Period 0.00'
].join('\n'));
chk('checksum flags a mis-read (sum != Earnings This Period)', !!badStub.checksum && badStub.checksum.ok === false);

// 12. Split-thousands repair: pdf.js may emit "4,680.28" as "4, 680.28" → read as 4680.28.
const split = ps.parsePayStub('001 Regular Earnings 38.75 100.00 4, 680.28 47,517.92');
chk('split thousands repaired to 4680.28', near(split.earnings[0].amount, 4680.28));

// 13. Duplicate code across a YTD recap page → first-wins keeps the PERIOD figure.
const dup = ps.parsePayStub([
  '001 Regular Earnings 38.75 100.00 3,000.00 40,000.00',
  '001 Regular Earnings 0.00 0.00 0.00 40,000.00'
].join('\n'));
chk('duplicate code first-wins (period 3000, not recap 0)', near(ps.payStubBuckets(dup).regular.amount, 3000.00));

// 14. YTD-only US per diem → bucket amount stays null (render shows "—", never $0.00).
chk('US YTD-only → bucket amount null', ps.payStubBuckets(ps.parsePayStub('250 Per Diem US ( 208.85')).perDiemUs.amount === null);

// 15. Anti-hang: a degenerate 3000-char line is skipped, doesn't throw or freeze.
chk('over-long line skipped (no hang/throw)', ps.parsePayStub('001 ' + '1'.repeat(3000)).earnings.length === 0);

// 16. Semi-monthly period range from the "PERIOD ENDING" date (standard 1–15 / 16–end).
chk('period ending 30 → 16–30', (() => { const r = ps.payStubPeriodRange('30-Jun-2026'); return !!r && r.start === '2026-06-16' && r.end === '2026-06-30'; })());
chk('period ending 15 → 1–15', (() => { const r = ps.payStubPeriodRange('15-Jun-2026'); return !!r && r.start === '2026-06-01' && r.end === '2026-06-15'; })());
chk('period ending 31 → 16–31', (() => { const r = ps.payStubPeriodRange('31-Jul-2026'); return !!r && r.start === '2026-07-16' && r.end === '2026-07-31'; })());
chk('unparseable period → null', ps.payStubPeriodRange('nope') === null);

// 17. Stub totals for the pay feature: deductions this period + YTD totals + line YTD.
const totals = ps.parsePayStub([
  'PERIOD ENDING: 30-Jun-2026',
  '001 Regular Earnings 38.75 100.00 3,000.00 40,000.00 501 Canada Pension 300.00 3,282.00',
  'Earnings This Period 3,000.00 Deductions This Period 1,941.47',
  'Taxable Earnings YTD 56,560.00 Deductions Year to Date 19,780.70'
].join('\n'));
chk('deductions this period parsed', near(totals.deductionsThisPeriod, 1941.47));
chk('taxable YTD parsed', near(totals.taxableYtd, 56560.00));
chk('deductions YTD parsed', near(totals.deductionsYtd, 19780.70));
chk('deduction line YTD parsed (501)', near((totals.deductions.find(d => d.code === '501') || {}).ytd, 3282.00));
// Deduction-only row (blank earnings column) must be captured, not dropped.
const dedOnly = ps.parsePayStub('587 ALPA Union Dues 97.91 1,046.38');
chk('deduction-only row captured', dedOnly.deductions.some(d => d.code === '587' && near(d.amount, 97.91) && near(d.ytd, 1046.38)));
chk('deduction-only row not counted as an earning', dedOnly.earnings.length === 0);

if (failures.length) { console.error('pay-stub FAIL:', failures); process.exit(1); }
console.log('pay-stub: all checks passed (metadata, 2-decimal columns, label digits, YTD-only, negatives, per-diem, earning/deduction split, buckets, robustness, checksum, split-thousands, dedup, US-null, anti-hang)');
process.exit(0);
