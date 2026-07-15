// ═══════════════════════════════════════════════════════════════════
//  PORTER PAY-STUB PDF PARSER (page-pay)
//
//  Martin's flow: drop the Porter "Statement of Earnings and Deductions"
//  PDF → parse it ENTIRELY client-side (pdf.js, same pipeline as the roster
//  import — zero data leaves the device) → feed the parsed line items into the
//  reconciliation (28-pay.js) so the analysis is automatic, no manual typing.
//
//  Layout (y-grouped text): two columns per row — an EARNING (codes 0xx–3xx) on
//  the left, a DEDUCTION (codes 5xx–9xx) on the right. Figures below are ILLUSTRATIVE
//  (never a real pilot's numbers):
//      001 Regular Earnings  00.00  000.00  0,000.00  00,000.00   501 Canada Pension 000.00 0,000.00
//      252 Per Diem CDN (     00.00   0.00    000.00   0,000.00    587 ALPA Union Dues 00.00 0,000.00
//  Columns: Code · Units · Type · Rate · Amount · YTD. The label can itself hold
//  a number ("Overtime 1.0", "Passport 10 yr", "Vacation 2026"), so a COLUMN
//  value is recognised ONLY as a figure with exactly TWO decimals (+ optional
//  trailing "-" for negatives, e.g. "90.63-"). That cleanly excludes the label's
//  "1.0"/"1.5"/"2026"/"10". Amount = 2nd-last column value, YTD = last.
//  Never fabricates: a value that can't be read stays null. (2026-07-15)
// ═══════════════════════════════════════════════════════════════════

// A pay-stub column value: digits (with optional thousands commas) and EXACTLY
// two decimals, optionally suffixed with "-" (Porter's negative notation).
const _PS_COL = /-?\d[\d,]*\.\d{2}-?/g;

function _psNum(s) {
  if (s == null) return null;
  const str = String(s).trim();
  const neg = /^-/.test(str) || /-$/.test(str);      // leading OR trailing minus
  const v = parseFloat(str.replace(/,/g, '').replace(/-/g, ''));
  return isNaN(v) ? null : (neg ? -v : v);
}

// Parse one earning/deduction segment ("<code> <label> <cols...>") into a record.
function _psLineItem(segment) {
  const seg = String(segment || '');
  if (seg.length > 2000) return null;   // anti-hang: the 2-decimal regex is superlinear on a degenerate megabyte "line"
  const m = seg.match(/^(\d{3})\s+(.+)$/);
  if (!m) return null;
  const code = m[1];
  const body = m[2].replace(/\(/g, ' ').replace(/\s+/g, ' ').trim();   // drop stray "(" annotations
  const cols = (body.match(_PS_COL) || []).map(_psNum).filter(v => v != null);
  // Label = body with its trailing run of column values stripped off.
  const label = body.replace(/(\s*-?\d[\d,]*\.\d{2}-?)+\s*$/, '').trim();
  const rec = { code: code, label: label, units: null, rate: null, amount: null, ytd: null };
  if (cols.length) rec.ytd = cols[cols.length - 1];
  if (cols.length >= 2) rec.amount = cols[cols.length - 2];   // this-period amount
  if (cols.length >= 4) { rec.units = cols[0]; rec.rate = cols[1]; }   // full earnings row
  return rec;
}

// Parse the whole stub text (from pdf.js) into structured data.
function parsePayStub(text) {
  const lines = String(text || '').split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    // Repair a thousands value pdf.js may split into two text runs: "4, 680.28" → "4,680.28".
    .map(l => l.replace(/(\d),\s(\d{3})(?=\D|$)/g, '$1,$2'))
    .filter(Boolean);
  const out = { period: '', deposit: '', position: '', totalDeposit: null, earningsThisPeriod: null, deductionsThisPeriod: null, taxableYtd: null, deductionsYtd: null, earnings: [], deductions: [], checksum: null };
  let mm;
  for (const l of lines) {
    if (l.length > 2000) continue;   // anti-hang: skip a degenerate single-line PDF before the superlinear regex
    if (mm = l.match(/PERIOD ENDING:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i)) out.period = mm[1];
    if (mm = l.match(/DEPOSIT DATE:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i)) out.deposit = mm[1];
    if (!out.position && (mm = l.match(/\b(First Officer|Captain|F\/O)\s+([A-Z][A-Z0-9]{1,4})\s+([A-Z]{3,4})\b/i))) out.position = (mm[1] + ' ' + mm[2] + ' ' + mm[3]).replace(/\s+/g, ' ').trim();
    if (mm = l.match(/TOTAL DEPOSIT\s+(-?\d[\d,]*\.\d{2}-?)/i)) out.totalDeposit = _psNum(mm[1]);
    if (mm = l.match(/Earnings This Period\s+(-?\d[\d,]*\.\d{2}-?)/i)) out.earningsThisPeriod = _psNum(mm[1]);
    if (mm = l.match(/Deductions This Period\s+(-?\d[\d,]*\.\d{2}-?)/i)) out.deductionsThisPeriod = _psNum(mm[1]);
    if (mm = l.match(/Taxable Earnings YTD\s+(-?\d[\d,]*\.\d{2}-?)/i)) out.taxableYtd = _psNum(mm[1]);
    if (mm = l.match(/Deductions Year to Date\s+(-?\d[\d,]*\.\d{2}-?)/i)) out.deductionsYtd = _psNum(mm[1]);

    // A row may carry an EARNING (0xx–3xx) on the left, a DEDUCTION (5xx–9xx) on
    // the right, or a deduction ALONE (blank earnings column). Handle all three.
    const startsEarn = /^[0-3]\d\d\s/.test(l);
    const startsDed = /^[5-9]\d\d\s/.test(l);
    if (!startsEarn && !startsDed) continue;
    if (startsEarn) {
      let earnSeg = l, dedSeg = '';
      const dc = l.search(/\s[5-9]\d\d\s/);              // a deduction code later on the row
      if (dc >= 0) { earnSeg = l.slice(0, dc).trim(); dedSeg = l.slice(dc).trim(); }
      const e = _psLineItem(earnSeg); if (e) out.earnings.push(e);
      const d = _psLineItem(dedSeg); if (d) out.deductions.push(d);
    } else {
      const d = _psLineItem(l); if (d) out.deductions.push(d);   // deduction-only row (blank earnings column)
    }
  }
  // Self-check: the this-period earning amounts must sum to "Earnings This Period".
  // A mismatch means a figure was mis-read (e.g. a split thousands value slipped
  // through) — the UI warns instead of presenting a wrong number as authoritative.
  if (out.earningsThisPeriod != null) {
    const sum = out.earnings.reduce((s, e) => s + (+e.amount || 0), 0);
    out.checksum = { expected: out.earningsThisPeriod, got: Math.round(sum * 100) / 100, ok: Math.abs(sum - out.earningsThisPeriod) <= 0.02 };
  }
  return out;
}

// Roll the parsed earnings up into the four reconciliation buckets the pay page
// compares against the schedule. Draft/premium OT (030) folds into overtime.
// Values are the THIS-PERIOD amounts (null when the stub didn't show one).
function payStubBuckets(parsed) {
  const p = parsed || {};
  const by = {};
  // First-wins: the this-period earnings block precedes any YTD recap section, so
  // a repeated code on a later page never overwrites the period figure with a recap.
  (p.earnings || []).forEach(e => { if (!by[e.code]) by[e.code] = e; });
  const amt = c => (by[c] && by[c].amount != null) ? by[c].amount : null;
  const sum = (a, b) => (a == null && b == null) ? null : (+(a || 0) + +(b || 0));
  return {
    period: p.period || '',
    regular: by['001'] ? { amount: by['001'].amount, units: by['001'].units, rate: by['001'].rate } : null,
    overtime: { amount: sum(amt('005'), amt('030')), ot10: amt('005'), draft: amt('030') },
    perDiemCdn: by['252'] ? { amount: by['252'].amount, units: by['252'].units, rate: by['252'].rate } : null,
    perDiemUs: by['250'] ? { amount: by['250'].amount, units: by['250'].units } : null,
    totalDeposit: p.totalDeposit != null ? p.totalDeposit : null
  };
}

// Semi-monthly pay-period date range from the stub's "PERIOD ENDING" date, using
// the standard airline split: 1st–15th and 16th–end of month. "30-Jun-2026" →
// { start:'2026-06-16', end:'2026-06-30' }. This is an ASSUMPTION (the common
// convention) — the per-diem HOURS match confirms or denies it, so it is never
// presented as certain. Returns null on an unparseable date.
function payStubPeriodRange(periodEnding) {
  const m = String(periodEnding || '').match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const mo = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }[m[2].toLowerCase()];
  if (!mo) return null;
  const y = m[3], mm = String(mo).padStart(2, '0'), day = +m[1];
  const startDay = day <= 15 ? 1 : 16;   // standard 1–15 / 16–end split
  return { start: y + '-' + mm + '-' + String(startDay).padStart(2, '0'), end: y + '-' + mm + '-' + String(day).padStart(2, '0'), half: startDay === 1 ? 'first' : 'second' };
}

// "30-Jun-2026" → "2026-06" (the pay-period month key the app groups flights by).
function payStubMonth(period) {
  const m = String(period || '').match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return '';
  const mo = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }[m[2].toLowerCase()];
  return mo ? (m[3] + '-' + mo) : '';
}

// ── Browser only: PDF upload → parse → store (local device only) ─────
// Parsed stubs live in localStorage ONLY — never synced, never in the bundle,
// never leave the device (same promise as the roster import). Keyed by month.
const PAY_STUB_PARSED_KEY = 'cumulo_pay_stub_parsed_v1';
function loadParsedStub(ym) { try { return (JSON.parse(localStorage.getItem(PAY_STUB_PARSED_KEY) || '{}'))[ym] || null; } catch (e) { return null; } }
function saveParsedStub(ym, parsed) { let a = {}; try { a = JSON.parse(localStorage.getItem(PAY_STUB_PARSED_KEY) || '{}'); } catch (e) {} a[ym] = parsed; try { localStorage.setItem(PAY_STUB_PARSED_KEY, JSON.stringify(a)); } catch (e) {} }
function clearParsedStub(ym) { let a = {}; try { a = JSON.parse(localStorage.getItem(PAY_STUB_PARSED_KEY) || '{}'); } catch (e) {} delete a[ym]; try { localStorage.setItem(PAY_STUB_PARSED_KEY, JSON.stringify(a)); } catch (e) {} }
// All stored stubs, newest month first — for the pay history / trend view.
function loadAllParsedStubs() {
  let a = {}; try { a = JSON.parse(localStorage.getItem(PAY_STUB_PARSED_KEY) || '{}'); } catch (e) {}
  return Object.keys(a).sort().reverse().map(ym => ({ ym: ym, stub: a[ym] }));
}

// Read a dropped/selected Porter pay PDF entirely in the browser (pdf.js), parse
// it, store it for its period, and re-render the analysis. No upload, no typing.
async function handlePayStubFile(file) {
  if (!file) return;
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const status = document.getElementById('pay-stub-status');
  const setStatus = (msg, cls) => { if (status) { status.textContent = msg; status.style.color = cls === 'danger' ? 'var(--danger)' : (cls === 'success' ? 'var(--success)' : 'var(--text-muted)'); } };
  if (typeof pdfjsLib === 'undefined') { setStatus(fr ? 'Lecteur PDF non chargé — recharge la page.' : 'PDF reader not loaded — reload the page.', 'danger'); return; }
  setStatus((fr ? 'Lecture de ' : 'Reading ') + (file.name || 'PDF') + '…');
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    const maxPages = Math.min(pdf.numPages, 25);   // a pay stub is 1–2 pages; cap guards a huge page tree
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const c = await page.getTextContent();
      const lines = (typeof groupTextByLines === 'function') ? groupTextByLines(c.items) : c.items.map(it => it.str);
      text += lines.join('\n') + '\n';
    }
    const parsed = parsePayStub(text);
    const ym = payStubMonth(parsed.period);
    if (!ym || !parsed.earnings.length) { setStatus(fr ? 'Impossible de lire ce PDF comme un talon Porter.' : 'Could not read this PDF as a Porter stub.', 'danger'); return; }
    saveParsedStub(ym, parsed);
    const sel = document.getElementById('pay-period');
    if (sel && [].some.call(sel.options, o => o.value === ym)) sel.value = ym;
    setStatus((fr ? 'Talon lu : ' : 'Stub read: ') + parsed.period + (fr ? ' · gardé sur cet appareil seulement.' : ' · kept on this device only.'), 'success');
    if (typeof payRender === 'function') payRender();
  } catch (e) {
    setStatus((fr ? 'Erreur de lecture : ' : 'Read error: ') + (e && e.message || e), 'danger');
  }
}

// Wire the drop zone + file input on the pay page (idempotent).
function payStubInitDropzone() {
  const zone = document.getElementById('pay-stub-drop');
  const input = document.getElementById('pay-stub-file');
  if (!zone || !input || zone.dataset.wired) return;
  zone.dataset.wired = '1';
  input.onchange = () => { if (input.files && input.files[0]) handlePayStubFile(input.files[0]); input.value = ''; };
  zone.onclick = () => input.click();
  zone.ondragover = e => { e.preventDefault(); zone.classList.add('drag'); };
  zone.ondragleave = () => zone.classList.remove('drag');
  zone.ondrop = e => { e.preventDefault(); zone.classList.remove('drag'); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handlePayStubFile(f); };
}

// Node test harness export (ignored in the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parsePayStub, payStubBuckets, payStubMonth, payStubPeriodRange, _psLineItem, _psNum };
}
