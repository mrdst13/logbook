// ═══════════════════════════════════════════════════════════════════
//  PAY RECONCILIATION (page-pay) — find errors in Porter pay
//
//  Computes what SHOULD be paid, from the logged roster + Porter's rules,
//  next to what the stub actually paid. PURE calculation functions only
//  (no DOM) so they can be unit-tested in isolation.
//
//  Rules (Porter FOAG 15.1 + ALPA LOAs, per Martin's own documents 2026-07-13):
//   - Per diem (4.2.27): from scheduled report (check-in) at home base to actual
//     release (check-out / arrival +15) at home base, per hour to the minute,
//     for time away from base. CDN $4.25/h (since 1 Jul 2025). US layover (LOA #3,
//     since 1 Jan 2026): from the check-OUT of the flight arriving at the US
//     destination to the check-IN of the flight departing it, at $4.25 USD × the
//     quarterly Bank-of-Canada exchange rate.
//   - Daily credit = the GREATER of flight time, duty ÷ 2, or 4:00 (min/day).
//   - Minimum Monthly Guarantee = 77.5 h. Overtime for credits above 85:00 / bid
//     period at 1.5× (2.0× during the summer LOA, 1 Jun–31 Aug 2026).
//
//  The pilot's ACTUAL figures (entered rate, per diems, stub amounts) are LOCAL
//  settings (loadPaySettings) — never synced, never bundled. As a convenience,
//  payRateForYear may SEED the rate from the PUBLISHED, non-confidential ALPA
//  scale — only values verified against the pilot's own stub are included, and
//  unmapped years fill nothing (empty > guessed).
// ═══════════════════════════════════════════════════════════════════

// ── time helpers ────────────────────────────────────────────────────
function _payHHMMtoMin(s) { s = String(s || ''); return s.length === 4 ? (+s.slice(0, 2)) * 60 + (+s.slice(2)) : NaN; }

// Off-block instant (ms) for a flight. Prefer the full ISO (dtstart_utc / atd);
// fall back to date + STD-less anchor. Returns NaN when unknown.
function _payOffMs(f) {
  if (f.dtstart_utc) { const t = Date.parse(f.dtstart_utc); if (!isNaN(t)) return t; }
  if (f.atd_utc && f.date) { const m = _payHHMMtoMin(f.atd_utc); if (!isNaN(m)) return Date.UTC(+f.date.slice(0, 4), +f.date.slice(5, 7) - 1, +f.date.slice(8, 10), 0, m); }
  if (f.date) return Date.UTC(+f.date.slice(0, 4), +f.date.slice(5, 7) - 1, +f.date.slice(8, 10), 12, 0);
  return NaN;
}
// Place an "HHMM" on the UTC day of refMs, shifting a day so it sits on the
// correct side of ref (a report is BEFORE its off-block; a release is AFTER its
// on-block) — this keeps times that cross UTC midnight on the right day.
function _payPlaceNear(refMs, hhmm, preferBefore) {
  const m = _payHHMMtoMin(hhmm); if (isNaN(refMs) || isNaN(m)) return NaN;
  const d = new Date(refMs);
  let cand = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, m);
  const DAY = 86400000;
  if (preferBefore && cand > refMs) cand -= DAY;
  if (!preferBefore && cand < refMs) cand += DAY;
  return cand;
}
function _payReportMs(f) {  // scheduled report = check-in; fallback ≈ 60 min before off-block
  const off = _payOffMs(f);
  return f.ci_utc ? _payPlaceNear(off, f.ci_utc, true) : (isNaN(off) ? NaN : off - 60 * 60000);
}
function _payReleaseMs(f) { // actual release = check-out; fallback = on-block + 15 min
  const off = _payOffMs(f);
  const on = isNaN(off) ? NaN : off + (+f.block || +f.total || 0) * 3600000;
  return f.co_utc ? _payPlaceNear(on, f.co_utc, false) : (isNaN(on) ? NaN : on + 15 * 60000);
}
const _payIsUS = icao => /^K/i.test(String(icao || ''));   // US airports = ICAO "K…"

// ── pairings: leave base → return to base ───────────────────────────
function groupPairings(flights, baseIcao) {
  const base = String(baseIcao || '').toUpperCase();
  const legs = (flights || []).filter(f => f.dep_icao && f.arr_icao && !isNaN(_payOffMs(f)))
    .slice().sort((a, b) => _payOffMs(a) - _payOffMs(b));
  const pairings = []; let cur = [];
  for (const f of legs) {
    cur.push(f);
    if (String(f.arr_icao).toUpperCase() === base) { pairings.push(cur); cur = []; }  // back at base → close
  }
  if (cur.length) pairings.push(cur);   // still-open pairing (not yet returned to base)
  return pairings;
}

// ── per diem for one pairing ────────────────────────────────────────
// Returns { awayHours, usHours, cdnHours }. US = ground time at US layovers.
function pairingPerDiem(pairing) {
  if (!pairing || !pairing.length) return { awayHours: 0, usHours: 0, cdnHours: 0 };
  const report = _payReportMs(pairing[0]);
  const release = _payReleaseMs(pairing[pairing.length - 1]);
  let awayMin = (isNaN(report) || isNaN(release)) ? 0 : Math.max(0, (release - report) / 60000);
  let usMin = 0;
  for (let i = 0; i < pairing.length - 1; i++) {
    if (_payIsUS(pairing[i].arr_icao)) {                 // layover at a US airport
      const start = _payReleaseMs(pairing[i]);           // check-out of the flight into the US
      const end = _payReportMs(pairing[i + 1]);          // check-in of the flight out of the US
      if (!isNaN(start) && !isNaN(end)) usMin += Math.max(0, (end - start) / 60000);
    }
  }
  usMin = Math.min(usMin, awayMin);
  return { awayHours: awayMin / 60, usHours: usMin / 60, cdnHours: (awayMin - usMin) / 60 };
}

// Per diem for a whole set of flights (a pay period), in dollars.
// rates = { cdn, usUsd, fx } → CDN $/h, US $USD/h, USD→CAD exchange.
function computePerDiem(flights, baseIcao, rates) {
  const r = rates || {};
  const cdnRate = +r.cdn || 0, usUsd = +r.usUsd || 0, fx = +r.fx || 1;
  let awayH = 0, usH = 0, cdnH = 0;
  const pairings = groupPairings(flights, baseIcao);
  pairings.forEach(p => { const d = pairingPerDiem(p); awayH += d.awayHours; usH += d.usHours; cdnH += d.cdnHours; });
  const round2 = n => Math.round(n * 100) / 100;
  return {
    pairings: pairings.length,
    awayHours: round2(awayH), cdnHours: round2(cdnH), usHours: round2(usH),
    cdnAmount: round2(cdnH * cdnRate),
    usAmount: round2(usH * usUsd * fx),
    total: round2(cdnH * cdnRate + usH * usUsd * fx)
  };
}

// ── credit hours: daily = max(flight time, duty/2, 4:00) ────────────
function computeCredits(flights) {
  const byDay = {};
  (flights || []).forEach(f => {
    if (f.isSim) return;
    const d = f.date; if (!d) return;
    if (!byDay[d]) byDay[d] = { flight: 0, duty: 0 };
    byDay[d].flight += (+f.total || +f.block || 0);
    byDay[d].duty += (+f.duty || 0);
  });
  let credit = 0; const days = [];
  Object.keys(byDay).sort().forEach(d => {
    const c = Math.max(byDay[d].flight, byDay[d].duty / 2, 4);
    credit += c; days.push({ date: d, flight: byDay[d].flight, duty: byDay[d].duty, credit: c });
  });
  return { creditHours: Math.round(credit * 100) / 100, days: days };
}

// ── expected base pay + overtime for a bid period ───────────────────
// creditHours from computeCredits; rate = hourly; mmg 77.5; otThreshold 85;
// otMult = 1.5 normally, 2.0 during the summer LOA. TRANSPARENT: returns the
// components so the UI shows the working, never asserts a single "owed" figure.
function computeBasePay(creditHours, opts) {
  const o = opts || {};
  const rate = +o.rate || 0, mmg = +o.mmg || 77.5, otThresh = +o.otThreshold || 85, otMult = +o.otMult || 1.5;
  const straight = Math.min(Math.max(creditHours, mmg), otThresh);   // guaranteed floor, up to OT threshold
  const otHours = Math.max(0, creditHours - otThresh);
  const round2 = n => Math.round(n * 100) / 100;
  return {
    creditHours: round2(creditHours), guaranteeApplied: creditHours < mmg,
    straightHours: round2(straight), otHours: round2(otHours), otMult: otMult,
    straightAmount: round2(straight * rate),
    otAmount: round2(otHours * rate * otMult),
    total: round2(straight * rate + otHours * rate * otMult)
  };
}

// Is a date (YYYY-MM-DD) inside the summer LOA window (1 Jun–31 Aug 2026)?
function isSummerLOA(dateStr) { return dateStr >= '2026-06-01' && dateStr <= '2026-08-31'; }

// ── Hourly rate by seat year (E195 F/O) ─────────────────────────────
// PUBLISHED ALPA scale, "Appendix B: Pay Scales" (E195-E2 First Officer column),
// dated 1 Jan 2025. The scale rises 1.5% each January starting 1 Jan 2026, so the
// rate for a given calendar year = base × 1.015^(year − 2025). Year 3 in 2026 =
// 119.00 × 1.015 = 120.79, which matches the real stub. Sourced, not guessed.
const E195_FO_SCALE_2025 = { 1: 89.23, 2: 101.50, 3: 119.00, 4: 127.00, 5: 138.00, 6: 143.00, 7: 147.00, 8: 149.00, 9: 151.00, 10: 154.00 };
function payRateForYear(seatYear, calYear) {
  const base = E195_FO_SCALE_2025[+seatYear];
  if (!base) return 0;
  const y = +calYear || (new Date()).getFullYear();
  const bumps = Math.max(0, y - 2025);            // +1.5% each January since 1 Jan 2026
  // +1e-9 nudge = FP-safe round-half-up so 119×1.015 = 120.785 lands on 120.79
  // (the stub value), not 120.78 (floating-point 120.78499999…).
  return Math.round((base * Math.pow(1.015, bumps) + 1e-9) * 100) / 100;
}

// ── US per-diem exchange, DERIVED from the pilot's own stub ─────────
// Martin's choice (2026-07-14): don't make him type a USD→CAD rate. Instead
// back it out of the US per-diem amount Porter actually paid, so the US line
// mirrors the stub exactly (he trusts Porter's US figure; the error-hunting is
// on hours / credits / base pay). fx = stubUS$ ÷ (US hours × US $/h). Returns 0
// when it can't be derived (no stub amount, no US hours, or no rate) so callers
// can show a prompt / anomaly instead of a bogus number.
function deriveUsFx(stubUsAmount, usHours, usUsdRate) {
  const amt = +stubUsAmount, h = +usHours, r = +usUsdRate;
  if (!(amt > 0) || !(h > 0) || !(r > 0)) return 0;
  return Math.round((amt / (h * r)) * 10000) / 10000;
}

// Per-US-layover breakdown (for the "daily" view Martin asked for): one entry
// per US layover = check-OUT of the arriving flight → check-IN of the departing
// flight, at a US ("K…") airport. Hours to the minute; sorted by date.
function usPerDiemDays(flights, baseIcao) {
  const out = [];
  groupPairings(flights, baseIcao).forEach(p => {
    for (let i = 0; i < p.length - 1; i++) {
      if (!_payIsUS(p[i].arr_icao)) continue;
      const start = _payReleaseMs(p[i]);       // check-out of the flight into the US
      const end = _payReportMs(p[i + 1]);       // check-in of the flight out of the US
      if (isNaN(start) || isNaN(end)) continue;
      const h = Math.max(0, (end - start) / 60000) / 60;
      if (h > 0) out.push({ icao: String(p[i].arr_icao).toUpperCase(), date: p[i].date || (p[i + 1] && p[i + 1].date) || '', hours: Math.round(h * 100) / 100 });
    }
  });
  out.sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
  return out;
}

// Legs of the pairings ASSIGNED to month `ym` (YYYY-MM), where a pairing is
// assigned by its first leg's date. Grouped from the FULL flight list so a trip
// that straddles a month boundary (e.g. a US layover on the 31st) stays whole
// and its US/away hours are counted once, in the month it started — instead of
// being cut in two by a raw calendar-month leg filter. (review 2026-07-14)
function _payMonthPairingLegs(allFlights, baseIcao, ym) {
  const out = [];
  groupPairings(allFlights, baseIcao).forEach(p => {
    const first = p[0];
    const m = (first && first.date) ? first.date.slice(0, 7) : '';
    if (m === ym) for (const leg of p) out.push(leg);
  });
  return out;
}

// Signed tz offset (minutes) at an instant — DST-correct via Intl.
function _payTzOffMin(tz, ms) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date(ms));
    const v = (p.find(x => x.type === 'timeZoneName') || {}).value || 'GMT+0';
    const m = v.match(/GMT([+-]?)(\d{1,2})(?::(\d{2}))?/);
    return m ? (m[1] === '-' ? -1 : 1) * ((+m[2]) * 60 + (+(m[3] || 0))) : 0;
  } catch (e) { return 0; }
}
// UTC ms at which it is local midnight (base tz) on YYYY-MM-DD.
function _payLocalMidnightMs(ymd, tz) {
  const guess = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
  return guess - _payTzOffMin(tz, guess) * 60000;
}
function _payNextDay(ymd) { const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

// Per diem allocated by CLOCK to [startMs, endMs): each pairing's away interval
// (report→release) and each US-layover interval is CLIPPED to the window, so a
// pairing that straddles a pay-period boundary contributes only the hours inside
// the period. This is how Porter splits per diem at the period boundary — matches
// a real stub to the hour (verified 2026-07-15: 70 h in-period pairings + 19.6 h
// of an overnight's next-day portion = 89.6 h paid).
function computePerDiemInPeriod(flights, baseIcao, rates, startMs, endMs) {
  const r = rates || {};
  const cdnRate = +r.cdn || 0, usUsd = +r.usUsd || 0, fx = +r.fx || 1;
  const clip = (a, b) => (isNaN(a) || isNaN(b)) ? 0 : Math.max(0, Math.min(b, endMs) - Math.max(a, startMs));
  let awayMs = 0, usMs = 0, n = 0;
  groupPairings(flights, baseIcao).forEach(p => {
    const away = clip(_payReportMs(p[0]), _payReleaseMs(p[p.length - 1]));
    if (away <= 0) return;
    n++; awayMs += away;
    for (let i = 0; i < p.length - 1; i++) {
      if (_payIsUS(p[i].arr_icao)) usMs += clip(_payReleaseMs(p[i]), _payReportMs(p[i + 1]));
    }
  });
  const round2 = x => Math.round(x * 100) / 100;
  const awayH = awayMs / 3600000, usH = Math.min(usMs / 3600000, awayH), cdnH = awayH - usH;
  return { pairings: n, awayHours: round2(awayH), cdnHours: round2(cdnH), usHours: round2(usH),
    cdnAmount: round2(cdnH * cdnRate), usAmount: round2(usH * usUsd * fx), total: round2(cdnH * cdnRate + usH * usUsd * fx) };
}

// ── UI (browser only — never executed by the Node test) ─────────────
// Settings + entered stub figures live in localStorage ONLY (never synced to
// the cloud, never in the public bundle) — pay data stays on this device.
const PAY_SETTINGS_KEY = 'cumulo_pay_settings_v1';
const PAY_STUB_KEY = 'cumulo_pay_stub_v1';

function loadPaySettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(PAY_SETTINGS_KEY) || '{}'); } catch (e) {}
  const base = (typeof DB !== 'undefined' && DB.loadProfile) ? (DB.loadProfile().base || '') : '';
  // No fx here: the USD→CAD rate is DERIVED from the stub per period (deriveUsFx).
  const merged = Object.assign({ base: base || 'CYOW', seatYear: '', rate: '', mmg: 77.5, otThreshold: 85, cdn: 4.25, usUsd: 4.25 }, s);
  // A per-diem $/h of 0 is never legitimate — treat a blanked/zero rate as unset
  // so an entered US amount is never silently masked. (review 2026-07-14)
  if (!(+merged.cdn > 0)) merged.cdn = 4.25;
  if (!(+merged.usUsd > 0)) merged.usUsd = 4.25;
  // The persisted `rate` is the MANUAL override ONLY. The EFFECTIVE rate is that
  // manual value if present, else the seat-year grid rate. Keeping them separate
  // stops a stale auto-filled rate from surviving a seat-year change. (review 2026-07-14)
  const rateManual = (+merged.rate > 0) ? +merged.rate : '';
  merged.rateManual = rateManual;
  merged.rate = rateManual || payRateForYear(merged.seatYear) || '';
  return merged;
}
function _paySaveSettingsFromInputs() {
  const g = id => (document.getElementById(id) || {}).value;
  const rateEl = document.getElementById('pay-rate');
  // Persist ONLY a manual rate. An auto-filled rate (dataset.auto) is NOT saved,
  // so the effective rate always re-derives from the seat year. (review 2026-07-14)
  const rate = (rateEl && rateEl.dataset.auto === '1') ? '' : (+g('pay-rate') || 0);
  const s = { base: String(g('pay-base') || '').toUpperCase().trim(), seatYear: g('pay-year') || '', rate: rate, mmg: +g('pay-mmg') || 77.5,
    otThreshold: +g('pay-ot') || 85, cdn: +g('pay-cdn') || 0, usUsd: +g('pay-us') || 0 };
  try { localStorage.setItem(PAY_SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
}
function _payLoadStub(period) { let a = {}; try { a = JSON.parse(localStorage.getItem(PAY_STUB_KEY) || '{}'); } catch (e) {} return a[period] || {}; }
function _paySaveStub(period, data) { let a = {}; try { a = JSON.parse(localStorage.getItem(PAY_STUB_KEY) || '{}'); } catch (e) {} a[period] = data; try { localStorage.setItem(PAY_STUB_KEY, JSON.stringify(a)); } catch (e) {} }
function _payMonths(f) { const s = {}; (f || []).forEach(x => { if (x.date) s[x.date.slice(0, 7)] = true; }); return Object.keys(s).sort().reverse(); }

function payInit() {
  const sel = document.getElementById('pay-period');
  if (!sel) return;
  const all = (typeof flights !== 'undefined' ? flights : []);
  // Selectable periods = months with logged flights UNION months with a stored
  // stub, so an imported stub is never orphaned when its flights are missing
  // (the page then shows the honest "not compared" state instead of nothing).
  const stubMonths = (typeof loadAllParsedStubs === 'function') ? loadAllParsedStubs().map(e => e.ym) : [];
  const months = Array.from(new Set(_payMonths(all).concat(stubMonths))).sort().reverse();
  const prev = sel.value;
  sel.innerHTML = months.length ? months.map(m => `<option value="${m}">${m}</option>`).join('') : '<option value="">–</option>';
  if (prev && months.indexOf(prev) >= 0) sel.value = prev;
  const st = loadPaySettings();
  const setv = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v; };
  setv('pay-base', st.base); setv('pay-year', st.seatYear); setv('pay-rate', st.rate); setv('pay-mmg', st.mmg);
  setv('pay-ot', st.otThreshold); setv('pay-cdn', st.cdn); setv('pay-us', st.usUsd);
  // Mark the rate input auto-filled when the shown value came from the seat year
  // (no manual override), so it is never persisted as a manual rate.
  const rateEl = document.getElementById('pay-rate');
  if (rateEl) rateEl.dataset.auto = (!st.rateManual && st.rate) ? '1' : '';
  ['pay-base', 'pay-mmg', 'pay-ot', 'pay-cdn', 'pay-us'].forEach(id => {
    const el = document.getElementById(id); if (el) el.onchange = () => { _paySaveSettingsFromInputs(); payRender(); };
  });
  // Typing a rate makes it a manual override (clear the auto flag before saving).
  if (rateEl) rateEl.onchange = () => { rateEl.dataset.auto = ''; _paySaveSettingsFromInputs(); payRender(); };
  // Choosing a seat year fills the mapped E195 rate; an unmapped year CLEARS an
  // auto-filled rate (so it truly fills nothing) but never touches a manual one.
  const yearEl = document.getElementById('pay-year');
  if (yearEl) yearEl.onchange = () => {
    const r = payRateForYear(yearEl.value);
    if (rateEl) {
      if (r > 0) { rateEl.value = r; rateEl.dataset.auto = '1'; }
      else if (rateEl.dataset.auto === '1') { rateEl.value = ''; rateEl.dataset.auto = ''; }
    }
    _paySaveSettingsFromInputs(); payRender();
  };
  sel.onchange = payRender;
  payRender();
}

// ═══════════════════════════════════════════════════════════════════
//  RENDER LAYER (browser only) — v2 "doux Wealthsimple éditorial".
//  Spec: private/mockups/pay-final.html + pay-final-en.html (approved
//  2026-07-16). The calculation engines above are UNCHANGED: this layer
//  only formats and draws what they return. Every figure shown derives
//  from the pilot's real data (logged flights + parsed stubs + local
//  settings). A chart without enough data is hidden or replaced by an
//  honest note — nothing is ever invented.
// ═══════════════════════════════════════════════════════════════════

const _PAY_MO_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const _PAY_MO_FR_S = ['jan', 'fév', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
const _PAY_MO_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const _PAY_MO_EN_S = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _PAY_DASH = '–';   // short dash = "no data" marker (never an em dash)

// 'D-Mon-YYYY' (the stub's own date form) → { d, m: 1-12, y } or null.
function _payDMY(s) {
  const m = String(s || '').match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const mo = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }[m[2].toLowerCase()];
  return mo ? { d: +m[1], m: mo, y: +m[3] } : null;
}
// Day + month label: FR '30 juin' / '15 fév' (short), EN 'June 30' / 'Jun 30'.
function _payDayLabel(dmy, fr, short, withYear) {
  if (!dmy) return _PAY_DASH;
  if (fr) {
    const d = dmy.d === 1 ? '1er' : String(dmy.d);
    return d + ' ' + (short ? _PAY_MO_FR_S : _PAY_MO_FR)[dmy.m - 1] + (withYear ? ' ' + dmy.y : '');
  }
  return (short ? _PAY_MO_EN_S : _PAY_MO_EN)[dmy.m - 1] + ' ' + dmy.d + (withYear ? ', ' + dmy.y : '');
}
// Pay-period range label. FR '16 au 30 juin' (sup: '1<sup>er</sup> au 15 juin'),
// EN 'June 16–30'. Callers prepend 'du ' / append ' period' as context needs.
function _payRangeTxt(range, fr, withYear, sup) {
  if (!range) return '';
  const sd = +range.start.slice(8, 10), ed = +range.end.slice(8, 10);
  const mo = +range.start.slice(5, 7), y = range.start.slice(0, 4);
  if (fr) {
    const first = sd === 1 ? (sup ? '1<sup>er</sup>' : '1er') : String(sd);
    return first + ' au ' + ed + ' ' + _PAY_MO_FR[mo - 1] + (withYear ? ' ' + y : '');
  }
  return _PAY_MO_EN[mo - 1] + ' ' + sd + '–' + ed + (withYear ? ', ' + y : '');
}

function _payChev() {
  return '<svg class="chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

// One banner, four gravities. 'bad' / 'ok' use the verdict shape (mockup §3);
// 'neutral' / 'warn' use the shared notice shape. Green has no dedicated CSS
// class, so the ok variant carries its two token overrides inline.
function _payBanner(kind, title, body) {
  const icInfo = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.6v5"/><circle cx="12" cy="16.2" r=".5" fill="currentColor"/></svg>';
  const icOk = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.2 12.4l2.7 2.7 5-5.8"/></svg>';
  if (kind === 'bad' || kind === 'ok') {
    const ok = kind === 'ok';
    return '<div class="verdict"' + (ok ? ' style="background:var(--v2-success-tint);border-left-color:var(--v2-success)"' : ' role="alert"') + '>' +
      '<span class="v-ic"' + (ok ? ' style="color:var(--v2-success)"' : '') + ' aria-hidden="true">' + (ok ? icOk : icInfo) + '</span>' +
      '<div class="v-txt"><div class="v-title num"' + (ok ? ' style="color:var(--v2-success-ink)"' : '') + '>' + title + '</div>' +
      '<div class="v-body num">' + body + '</div></div></div>';
  }
  return '<div class="notice' + (kind === 'neutral' ? ' neutral' : '') + '">' +
    '<span class="n-ic" aria-hidden="true">' + icInfo + '</span>' +
    '<div><div class="n-title">' + title + '</div><div class="n-body num">' + body + '</div></div></div>';
}

// 22 px status icon for the checks list. Exact gravity labels only.
function _payCkIcon(status, fr) {
  const lbl = status === 'ok' ? (fr ? 'Conforme' : 'Pass') : (status === 'bad' ? (fr ? 'Problème' : 'Issue') : (fr ? 'À titre indicatif' : 'For reference'));
  let svg;
  if (status === 'ok') svg = '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="10.2" fill="var(--v2-success-tint)"/><path d="M6.8 11.4l2.8 2.8 5.6-6" fill="none" stroke="var(--v2-success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  else if (status === 'bad') svg = '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="10.2" fill="var(--v2-danger-tint-strong)"/><path d="M7.6 7.6l6.8 6.8M14.4 7.6l-6.8 6.8" fill="none" stroke="var(--v2-danger)" stroke-width="2" stroke-linecap="round"/></svg>';
  else svg = '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="10.2" fill="var(--v2-track)" stroke="var(--v2-hair-strong)" stroke-width="1.4"/><circle cx="11" cy="7.2" r="1.1" fill="var(--v2-muted)"/><path d="M11 10v5.4" stroke="var(--v2-muted)" stroke-width="1.8" stroke-linecap="round"/></svg>';
  return '<span class="ck-icon" role="img" aria-label="' + lbl + '">' + svg + '</span>';
}

// Two horizontal bars: per-diem hours computed from the roster vs paid on the
// stub, the difference as a bordered tint segment on the longer bar (mockup
// §5a, svg.w-compare). Scale computed from the real values; no fixed 80 h.
function _payCompareSvg(compH, paidH, gapTxt, fr, hL) {
  const maxV = Math.max(compH, paidH);
  if (!(maxV > 0)) return '';
  const steps = [1, 2, 5, 10, 20, 25, 50, 100];
  const step = steps.find(s => maxV / s <= 4) || 200;
  const top = Math.max(step, Math.ceil(maxV / step) * step);
  const X0 = 10, XW = 600;
  const x = v => X0 + (v / top) * XW;
  const r1 = v => Math.round(v * 10) / 10;
  const common = Math.min(compH, paidH);
  const gap = Math.abs(compH - paidH);
  let grid = '', axis = '<text x="10" y="140">0 h</text>';
  for (let v = step; v <= top; v += step) {
    grid += '<line x1="' + r1(x(v)) + '" y1="20" x2="' + r1(x(v)) + '" y2="124"/>';
    axis += '<text x="' + r1(x(v)) + '" y="140">' + hL(v) + ' h</text>';
  }
  const gapRect = (from, to, yy) => '<rect x="' + r1(x(from)) + '" y="' + yy + '" width="' + Math.max(1, r1(x(to) - x(from))) + '" height="24" rx="5" fill="var(--v2-danger-tint-strong)" stroke="var(--v2-danger)" stroke-width="1"/>';
  let bars = '<rect x="10" y="32" width="' + Math.max(1, r1(x(common) - X0)) + '" height="24" rx="5" fill="var(--v2-accent-data)"/>';
  if (compH > common) bars += gapRect(common, compH, 32);
  bars += '<rect x="10" y="88" width="' + Math.max(1, r1(x(common) - X0)) + '" height="24" rx="5" fill="var(--v2-accent)"/>';
  if (paidH > common) bars += gapRect(common, paidH, 88);
  let guide = '';
  if (gap > 0.049) {
    guide = '<line x1="' + r1(x(common)) + '" y1="26" x2="' + r1(x(common)) + '" y2="120" stroke="var(--v2-danger)" stroke-width="1.2" stroke-dasharray="4 4" opacity=".75"/>' +
      '<text x="710" y="75" font-size="12.5" font-weight="600" fill="var(--v2-danger-ink)" text-anchor="end">' + gapTxt + '</text>';
  }
  const aria = fr
    ? 'Comparaison des heures de per diem : ' + hL(compH) + ' heures selon l’horaire de vol contre ' + hL(paidH) + ' heures payées sur le talon, soit ' + hL(gap) + ' heures d’écart.'
    : 'Comparison of per diem hours: ' + hL(compH) + ' hours according to the flight schedule versus ' + hL(paidH) + ' hours paid on the stub, a ' + hL(gap) + '-hour difference.';
  return '<div class="chart-wrap"><svg class="w-compare" viewBox="0 0 720 150" role="img" aria-label="' + esc(aria) + '">' +
    '<title>' + (fr ? 'Per diem CDN : calculé contre payé' : 'Canadian per diem: calculated versus paid') + '</title>' +
    '<g stroke="var(--v2-hair)" stroke-width="1">' + grid + '</g>' +
    '<text x="10" y="24" font-size="12" font-weight="600" fill="var(--v2-muted)">' + (fr ? 'Selon l’horaire de vol' : 'According to the flight schedule') + '</text>' +
    '<text x="10" y="82" font-size="12" font-weight="600" fill="var(--v2-muted)">' + (fr ? 'Payé sur le talon' : 'Paid on the stub') + '</text>' +
    bars +
    '<text x="' + r1(x(compH) + 8) + '" y="49" font-size="13" font-weight="600" fill="var(--v2-ink-strong)">' + hL(compH) + ' h</text>' +
    '<text x="' + r1(x(paidH) + 8) + '" y="105" font-size="13" font-weight="600" fill="var(--v2-ink-strong)">' + hL(paidH) + ' h</text>' +
    guide +
    '<g font-size="10" fill="var(--v2-muted)" text-anchor="middle">' + axis + '</g>' +
    '</svg></div>';
}

// Net deposit per stored period, bar chart (mockup §7, svg.w-hist). Bars only
// for stubs whose deposit was actually read; the y-scale comes from the data.
function _payDepositsSvg(items, fr, money) {
  const withDep = items.filter(i => i.dep != null);
  if (!withDep.length) return '';
  const vals = withDep.map(i => i.dep);
  const maxV = Math.max.apply(null, vals), minV = Math.min.apply(null, vals);
  if (!(maxV > 0)) return '';
  const steps = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
  const step = steps.find(s => maxV / s <= 4) || 100000;
  const top = Math.ceil(maxV / step) * step;
  const y = v => 180 - (v / top) * 160;
  const r1 = v => Math.round(v * 10) / 10;
  const fmt0 = v => Math.round(v).toLocaleString(fr ? 'fr-CA' : 'en-CA');
  const n = items.length;
  const bw = Math.min(40, Math.max(8, Math.round((650 / n) * 0.72)));
  let grid = '', ylab = '<text x="42" y="183">0</text>';
  for (let v = step; v <= top; v += step) {
    grid += '<line x1="46" y1="' + r1(y(v)) + '" x2="696" y2="' + r1(y(v)) + '"/>';
    ylab += '<text x="42" y="' + r1(y(v) + 3) + '">' + fmt0(v) + '</text>';
  }
  let past = '', curBar = '', diamonds = '', vlab = '', xlab = '';
  const everyN = Math.max(1, Math.ceil(n / 13));
  items.forEach((it, i) => {
    if (it.dep != null) {
      const xb = r1(it.cx - bw / 2), yy = r1(y(it.dep)), hh = r1(180 - y(it.dep));
      const rect = '<rect x="' + xb + '" y="' + yy + '" width="' + bw + '" height="' + Math.max(1, hh) + '" rx="3"><title>' + esc(it.tipDep) + '</title></rect>';
      if (it.isCur) curBar += '<rect x="' + xb + '" y="' + yy + '" width="' + bw + '" height="' + Math.max(1, hh) + '" rx="3" fill="var(--v2-accent)"><title>' + esc(it.tipDep) + '</title></rect>';
      else past += rect;
      vlab += '<text x="' + r1(it.cx) + '" y="' + r1(Math.max(9, y(it.dep) - 5.1)) + '"' + (it.isCur ? ' font-weight="600" fill="var(--v2-ink-strong)"' : '') + '>' + fmt0(it.dep) + '</text>';
      if (it.ot != null) diamonds += '<rect x="-4" y="-4" width="8" height="8" transform="translate(' + r1(it.cx) + ',' + r1(y(it.dep) + 10) + ') rotate(45)" fill="var(--v2-ink-strong)"/>';
    }
    if (i % everyN === 0 || it.isCur) xlab += '<text x="' + r1(it.cx) + '" y="198"' + (it.isCur ? ' font-weight="600" fill="var(--v2-ink-strong)"' : '') + '>' + esc(it.short) + '</text>';
  });
  const cur = items.find(i => i.isCur && i.dep != null);
  const aria = fr
    ? 'Dépôts nets des ' + withDep.length + ' périodes de paie stockées, de ' + money(minV) + ' à ' + money(maxV) + '.' + (cur ? ' Période courante : ' + money(cur.dep) + '.' : '')
    : 'Net deposits for the ' + withDep.length + ' stored pay periods, from ' + money(minV) + ' to ' + money(maxV) + '.' + (cur ? ' Current period: ' + money(cur.dep) + '.' : '');
  return '<div class="chart-wrap"><svg class="w-hist" viewBox="0 0 720 214" role="img" aria-label="' + esc(aria) + '">' +
    '<title>' + (fr ? 'Dépôt net par période' : 'Net deposit per period') + '</title>' +
    '<g stroke="var(--v2-hair)" stroke-width="1">' + grid + '</g>' +
    '<line x1="46" y1="180" x2="696" y2="180" stroke="var(--v2-hair-strong)" stroke-width="1"/>' +
    '<g font-size="10" fill="var(--v2-muted)" text-anchor="end">' + ylab + '</g>' +
    '<g fill="var(--v2-accent-data)" fill-opacity=".3">' + past + '</g>' + curBar + diamonds +
    '<g font-size="10" fill="var(--v2-muted)" text-anchor="middle">' + vlab + '</g>' +
    '<g font-size="9.5" fill="var(--v2-muted)" text-anchor="middle">' + xlab + '</g>' +
    '</svg></div>';
}

// Per diem paid per period, sparkline (mockup §7). Needs 2+ stubs with a
// readable per-diem amount; otherwise it is simply not drawn.
function _paySparkSvg(items, fr, money) {
  const pts = items.filter(i => i.pdAmt != null);
  if (pts.length < 2) return '';
  const vals = pts.map(p => p.pdAmt);
  const minV = Math.min.apply(null, vals), maxV = Math.max.apply(null, vals);
  const span = (maxV - minV) || 1;
  const y = v => 88 - ((v - minV) / span) * 68;
  const r1 = v => Math.round(v * 10) / 10;
  const cX = v => Math.max(56, Math.min(664, v));
  const poly = pts.map(p => r1(p.cx) + ',' + r1(y(p.pdAmt))).join(' ');
  const minPt = pts.find(p => p.pdAmt === minV), maxPt = pts.find(p => p.pdAmt === maxV);
  const curPt = pts.find(p => p.isCur);
  let ann = '';
  if (minPt && minPt !== curPt) {
    ann += '<circle cx="' + r1(minPt.cx) + '" cy="' + r1(y(minV)) + '" r="2.5" fill="var(--v2-accent-data)"/>' +
      '<text x="' + r1(cX(minPt.cx)) + '" y="' + r1(Math.min(115, y(minV) + 15)) + '" font-size="10" fill="var(--v2-muted)" text-anchor="middle">' + money(minV) + ' · ' + esc(minPt.short) + '</text>';
  }
  if (maxPt && maxPt !== curPt && maxPt !== minPt) {
    ann += '<circle cx="' + r1(maxPt.cx) + '" cy="' + r1(y(maxV)) + '" r="2.5" fill="var(--v2-accent-data)"/>' +
      '<text x="' + r1(cX(maxPt.cx)) + '" y="' + r1(Math.max(9, y(maxV) - 11)) + '" font-size="10" fill="var(--v2-muted)" text-anchor="middle">' + money(maxV) + ' · ' + esc(maxPt.short) + '</text>';
  }
  if (curPt) {
    ann += '<circle cx="' + r1(curPt.cx) + '" cy="' + r1(y(curPt.pdAmt)) + '" r="3.5" fill="var(--v2-accent)"/>' +
      '<text x="' + r1(cX(curPt.cx)) + '" y="' + r1(Math.max(9, y(curPt.pdAmt) - 13)) + '" font-size="10" font-weight="600" fill="var(--v2-ink-strong)" text-anchor="middle">' + money(curPt.pdAmt) + '</text>' +
      '<text x="' + r1(cX(curPt.cx)) + '" y="112" font-size="9.5" font-weight="600" fill="var(--v2-ink-strong)" text-anchor="middle">' + esc(curPt.short) + '</text>';
  }
  const hover = pts.map(p => '<circle cx="' + r1(p.cx) + '" cy="' + r1(y(p.pdAmt)) + '" r="9"><title>' + esc(p.tipPd) + '</title></circle>').join('');
  const aria = fr
    ? 'Per diem payé par période, courbe des ' + pts.length + ' périodes : minimum ' + money(minV) + ', maximum ' + money(maxV) + '.' + (curPt ? ' Période courante : ' + money(curPt.pdAmt) + '.' : '')
    : 'Per diem paid per period, curve of the ' + pts.length + ' periods: minimum ' + money(minV) + ', maximum ' + money(maxV) + '.' + (curPt ? ' Current period: ' + money(curPt.pdAmt) + '.' : '');
  return '<div class="chart-wrap"><svg class="w-hist" viewBox="0 0 720 120" role="img" aria-label="' + esc(aria) + '">' +
    '<title>' + (fr ? 'Per diem payé par période' : 'Per diem paid per period') + '</title>' +
    '<polyline points="' + poly + '" fill="none" stroke="var(--v2-accent-data)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    ann +
    '<g fill="none" pointer-events="all">' + hover + '</g>' +
    '</svg></div>';
}

// Quick per-period verdict for the statement rows: the per-diem HOURS check
// (the error detector) run against a stored stub. 'none' = honestly not
// comparable (no readable paid hours, or no flights logged in that window).
function _payQuickCheck(stub, bkx, range, allFls, st) {
  if (!range) return 'none';
  const paidH = (bkx.perDiemCdn && bkx.perDiemCdn.units != null) ? bkx.perDiemCdn.units : null;
  if (paidH == null) return 'none';
  const baseTz = (typeof AIRPORT_TZ !== 'undefined' && AIRPORT_TZ[st.base]) || 'America/Toronto';
  const pdx = computePerDiemInPeriod(allFls || [], st.base, { cdn: st.cdn, usUsd: st.usUsd, fx: 1 },
    _payLocalMidnightMs(range.start, baseTz), _payLocalMidnightMs(_payNextDay(range.end), baseTz));
  const scoped = (allFls || []).filter(f => f.date && f.date >= range.start && f.date <= range.end);
  if (!scoped.length && !(pdx.awayHours > 0)) return 'none';
  return Math.abs(pdx.cdnHours - paidH) <= 1.0 ? 'ok' : 'issue';
}

function payRender() {
  const host = document.getElementById('pay-computed');
  if (!host) return;
  if (typeof payStubInitDropzone === 'function') payStubInitDropzone();   // (re)wire the PDF drop zone
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const st = loadPaySettings();
  const sel = document.getElementById('pay-period');
  const ym = sel ? sel.value : '';
  const allFls = (typeof flights !== 'undefined' ? flights : []);
  const loc = fr ? 'fr-CA' : 'en-CA';
  // The sign stays in FRONT of the "$": EN "−$12.34" (never "$−12.34"),
  // FR "−12,34 $" (comma decimals, non-breaking spaces).
  const money = n => {
    const v = Math.round((+n || 0) * 100) / 100;
    const a = Math.abs(v).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? '−' : '') + (fr ? a + ' $' : '$' + a);
  };
  const hL = n => (Math.round((+n || 0) * 10) / 10).toLocaleString(loc, { maximumFractionDigits: 1 });
  const C = fr ? ' :' : ':';   // FR: non-breaking space before a colon
  const DASH = _PAY_DASH;
  const all = (typeof loadAllParsedStubs === 'function') ? loadAllParsedStubs() : [];

  if (!ym) {
    host.innerHTML = _payBanner('neutral',
      fr ? 'Aucune période à afficher' : 'No period to show',
      fr ? 'Dépose ton talon Porter (PDF) ci-dessus, ou importe ton horaire pour commencer.'
        : 'Drop your Porter pay PDF above, or import your roster to get started.') +
      payStubHistory(all, ym, allFls, st, fr, money, hL, null);
    return;
  }

  const parsed = (typeof loadParsedStub === 'function') ? loadParsedStub(ym) : null;
  const bk = (parsed && typeof payStubBuckets === 'function') ? payStubBuckets(parsed) : null;
  // Scope to the SEMI-MONTHLY pay period from the stub's period-ending date
  // (standard 1–15 / 16–end split), else the calendar month. The per-diem
  // hours comparison confirms or denies the assumed split.
  const range = (parsed && parsed.period && typeof payStubPeriodRange === 'function') ? payStubPeriodRange(parsed.period) : null;
  const scoped = range
    ? allFls.filter(f => f.date && f.date >= range.start && f.date <= range.end)
    : allFls.filter(f => f.date && f.date.slice(0, 7) === ym);
  const baseTz = (typeof AIRPORT_TZ !== 'undefined' && AIRPORT_TZ[st.base]) || 'America/Toronto';
  const rates = { cdn: st.cdn, usUsd: st.usUsd, fx: 1 };
  // In a pay period, allocate per diem by CLOCK (clip straddling trips at the
  // base-local midnight boundary) — matches how Porter splits it.
  const pd = range
    ? computePerDiemInPeriod(allFls, st.base, rates, _payLocalMidnightMs(range.start, baseTz), _payLocalMidnightMs(_payNextDay(range.end), baseTz))
    : computePerDiem(_payMonthPairingLegs(allFls, st.base, ym), st.base, rates);
  const rosterHas = scoped.length > 0 || pd.awayHours > 0;
  const ymLabel = (fr ? _PAY_MO_FR : _PAY_MO_EN)[(+ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);

  // ── 0 stub for this period: honest neutral state ──────────────────
  if (!parsed) {
    let out;
    if (rosterHas) {
      out = _payBanner('neutral',
        fr ? 'Aucun talon pour cette période' : 'No stub for this period',
        fr ? 'Dépose ton talon Porter (PDF) ci-dessus : il est lu sur cet appareil seulement, puis comparé à ton horaire.'
          : 'Drop your Porter pay PDF above: it is read on this device only, then checked against your schedule.');
      out += '<section class="v2-card" style="margin-top:16px">' +
        '<p class="chart-title">' + (fr ? 'Calculé de ton horaire pour ' : 'Computed from your schedule for ') + esc(ymLabel) + '</p>' +
        '<div class="kv"><span class="k">Per diem CDN</span><span class="v num">' + hL(pd.cdnHours) + ' h · ' + money(pd.cdnAmount) + '</span></div>' +
        '<div class="kv"><span class="k">Per diem US</span><span class="v num">' + (pd.usHours > 0 ? hL(pd.usHours) + ' h' : DASH) + '</span></div>' +
        '<div class="kv"><span class="k">' + (fr ? 'Temps loin de la base' : 'Time away from base') + '</span><span class="v num">' + hL(pd.awayHours) + ' h · ' + pd.pairings + ' pairing' + (pd.pairings > 1 ? 's' : '') + '</span></div>' +
        '<p class="tbl-note">' + (fr ? 'Dès qu’un talon est importé, ces heures sont comparées au montant payé.' : 'Once a stub is imported, these hours are checked against what was paid.') + '</p>' +
        '</section>';
    } else {
      out = _payBanner('neutral',
        fr ? 'Rien à comparer pour cette période' : 'Nothing to compare for this period',
        fr ? 'Aucun vol enregistré et aucun talon importé. Synchronise ton horaire, ou dépose ton talon PDF ci-dessus.'
          : 'No flights logged and no stub imported. Sync your roster, or drop your pay PDF above.');
    }
    out += payStubHistory(all, ym, allFls, st, fr, money, hL, null);
    host.innerHTML = out;
    return;
  }

  // ── stub identity line + parse self-check ──────────────────────────
  const depDmy = _payDMY(parsed.deposit);
  const perDmy = _payDMY(parsed.period);
  const stubLine = '<p class="drop-status num" style="margin-top:16px">' +
    (fr ? 'Talon lu' : 'Stub read') + C + ' <b>' + esc(parsed.period || ym) + '</b>' +
    (parsed.position ? ' · ' + esc(parsed.position) : '') +
    (range ? ' · ' + (fr ? 'période du ' + _payRangeTxt(range, fr, false, false) : _payRangeTxt(range, fr, false, false) + ' period') : '') +
    ' · <a href="#" onclick="if(typeof clearParsedStub===\'function\'){clearParsedStub(\'' + esc(ym) + '\');}payRender();return false;">' + (fr ? 'retirer' : 'remove') + '</a></p>';
  const checksumWarn = (parsed.checksum && !parsed.checksum.ok)
    ? _payBanner('warn', fr ? 'Lecture à vérifier' : 'Read to verify',
      fr ? 'Les montants lus totalisent ' + money(parsed.checksum.got) + ' mais le talon indique ' + money(parsed.checksum.expected) + ' (« Earnings This Period »). Un montant a pu être mal lu : vérifie le détail du talon plus bas.'
        : 'Parsed amounts total ' + money(parsed.checksum.got) + ' but the stub says ' + money(parsed.checksum.expected) + ' (“Earnings This Period”). A figure may be mis-read: check the stub detail below.')
    : '';

  // ── the six canonical checks: ONE source, rendered as the list AND the
  //    folded table. Statuses: ok / bad / info — exact labels only. ────
  const paidCdnH = (bk.perDiemCdn && bk.perDiemCdn.units != null) ? bk.perDiemCdn.units : null;
  const paidCdnAmt = (bk.perDiemCdn && bk.perDiemCdn.amount != null) ? bk.perDiemCdn.amount : null;
  const stubRate = (bk.regular && bk.regular.rate != null) ? bk.regular.rate : null;
  const stubPdRate = (bk.perDiemCdn && bk.perDiemCdn.rate != null) ? bk.perDiemCdn.rate : null;
  const paidUsAmt = (bk.perDiemUs && bk.perDiemUs.amount != null) ? bk.perDiemUs.amount : null;
  const paidUsH = (bk.perDiemUs && bk.perDiemUs.units != null) ? bk.perDiemUs.units : null;
  const baseAmt = (bk.regular && bk.regular.amount != null) ? bk.regular.amount : null;
  const otAmt = (bk.overtime && bk.overtime.amount != null) ? bk.overtime.amount : null;

  const pill = s => s === 'ok'
    ? '<span class="pill-ok">' + (fr ? 'Conforme' : 'Pass') + '</span>'
    : '<span class="pill-info">' + (fr ? 'À titre indicatif' : 'Reference') + '</span>';
  const sgnH = v => (v < 0 ? '−' : '+') + hL(Math.abs(v)) + ' h';
  const sgn$ = v => (v > 0 ? '+' : '') + money(v);
  const tr = (label, tds, badRow) => '<tr' + (badRow ? ' class="row-bad"' : '') + '><td>' + label + '</td>' + tds + '</tr>';
  const tdN = v => '<td class="r num">' + v + '</td>';
  const tdM = v => '<td class="r muted">' + v + '</td>';
  const tdP = p => '<td class="r">' + p + '</td>';
  const tdBad = v => '<td class="r num"><span class="delta-bad">' + v + '</span></td>';

  const nonCompare = fr ? 'Non comparé : aucun vol enregistré pour cette période.' : 'Not compared: no flights logged for this period.';

  // 1. Per diem CDN — the error detector.
  const pdCheck = { id: 'perdiem', name: 'Per diem CDN', gapH: null, gapAmt: null };
  if (!fr) pdCheck.name = 'Canadian per diem';
  if (!rosterHas) {
    pdCheck.status = 'info';
    pdCheck.desc = nonCompare;
  } else if (paidCdnH == null && paidCdnAmt == null) {
    if (pd.cdnHours > 0.05) {
      pdCheck.status = 'bad';
      pdCheck.gapAmt = -pd.cdnAmount;
      pdCheck.desc = fr
        ? 'Ton horaire donne <strong>' + hL(pd.cdnHours) + ' h</strong> de per diem CDN (' + money(pd.cdnAmount) + '), mais le talon n’en montre aucun.'
        : 'Your schedule gives <strong>' + hL(pd.cdnHours) + ' h</strong> of Canadian per diem (' + money(pd.cdnAmount) + '), but the stub shows none.';
    } else {
      pdCheck.status = 'ok';
      pdCheck.desc = fr ? 'Rien d’attendu, rien de payé.' : 'Nothing expected, nothing paid.';
    }
  } else {
    const hOk = paidCdnH == null || Math.abs(pd.cdnHours - paidCdnH) <= 1.0;
    const aOk = paidCdnAmt == null || Math.abs(pd.cdnAmount - paidCdnAmt) < 0.02;
    if (hOk && aOk) {
      pdCheck.status = 'ok';
      pdCheck.desc = fr
        ? 'Heures et montant concordent' + C + ' ' + hL(pd.cdnHours) + ' h · ' + money(paidCdnAmt != null ? paidCdnAmt : pd.cdnAmount) + '.'
        : 'Hours and amount match: ' + hL(pd.cdnHours) + ' h · ' + money(paidCdnAmt != null ? paidCdnAmt : pd.cdnAmount) + '.';
    } else {
      pdCheck.status = 'bad';
      pdCheck.gapH = paidCdnH != null ? Math.round((paidCdnH - pd.cdnHours) * 100) / 100 : null;
      pdCheck.gapAmt = paidCdnAmt != null
        ? Math.round((paidCdnAmt - pd.cdnAmount) * 100) / 100
        : (pdCheck.gapH != null ? Math.round(pdCheck.gapH * st.cdn * 100) / 100 : null);
      if (paidCdnH != null) {
        pdCheck.desc = fr
          ? 'L’horaire donne <strong>' + hL(pd.cdnHours) + ' h</strong> de per diem, mais le talon en paie <strong>' + hL(paidCdnH) + ' h</strong>.' + (pdCheck.gapAmt != null ? ' À ' + money(st.cdn) + '/h, ces ' + hL(Math.abs(pdCheck.gapH)) + ' h représentent <strong>' + money(Math.abs(pdCheck.gapAmt)) + '</strong> d’écart entre ton horaire et le talon.' : '')
          : 'Your schedule gives <strong>' + hL(pd.cdnHours) + ' h</strong> of per diem, but the stub pays <strong>' + hL(paidCdnH) + ' h</strong>.' + (pdCheck.gapAmt != null ? ' At ' + money(st.cdn) + '/h, those ' + hL(Math.abs(pdCheck.gapH)) + ' h come to <strong>' + money(Math.abs(pdCheck.gapAmt)) + '</strong> of difference between your schedule and the stub.' : '');
      } else {
        pdCheck.desc = fr
          ? 'Calculé <strong>' + money(pd.cdnAmount) + '</strong>, payé <strong>' + money(paidCdnAmt) + '</strong>.'
          : 'Computed <strong>' + money(pd.cdnAmount) + '</strong>, paid <strong>' + money(paidCdnAmt) + '</strong>.';
      }
    }
  }
  {
    const hoursComp = rosterHas ? hL(pd.cdnHours) + ' h' : DASH;
    const hoursPaid = paidCdnH != null ? hL(paidCdnH) + ' h' : DASH;
    const amtComp = rosterHas ? money(pd.cdnAmount) : DASH;
    const amtPaid = paidCdnAmt != null ? money(paidCdnAmt) : DASH;
    const dH = pdCheck.status === 'bad' ? (pdCheck.gapH != null ? tdBad(sgnH(pdCheck.gapH)) : tdN(DASH)) : tdP(pill(pdCheck.status));
    const dA = pdCheck.status === 'bad' ? (pdCheck.gapAmt != null ? tdBad(sgn$(pdCheck.gapAmt)) : tdN(DASH)) : tdP(pill(pdCheck.status));
    pdCheck.rows = [
      tr(fr ? 'Per diem CDN (heures)' : 'Canadian per diem (hours)', tdN(hoursComp) + tdN(hoursPaid) + dH, pdCheck.status === 'bad'),
      tr(fr ? 'Per diem CDN (montant)' : 'Canadian per diem (amount)', tdN(amtComp) + tdN(amtPaid) + dA, pdCheck.status === 'bad')
    ];
  }

  // 2. Hourly rate.
  const rateCheck = { id: 'rate', name: fr ? 'Taux horaire' : 'Hourly rate' };
  if (stubRate != null && st.rate) {
    const ok = Math.abs(stubRate - st.rate) < 0.005;
    rateCheck.status = ok ? 'ok' : 'bad';
    rateCheck.desc = ok
      ? money(stubRate) + '/h' + (fr ? ', comme attendu' : ', as expected') + (st.seatYear ? (fr ? ' pour ton échelon (année ' + esc(st.seatYear) + ').' : ' for your step (year ' + esc(st.seatYear) + ').') : '.')
      : (fr ? 'Le talon montre ' + money(stubRate) + '/h mais tu attends ' + money(st.rate) + '/h. Vérifie ton échelon dans les réglages.'
        : 'The stub shows ' + money(stubRate) + '/h but you expect ' + money(st.rate) + '/h. Check your seat year in the settings.');
  } else if (stubRate == null) {
    rateCheck.status = 'info';
    rateCheck.desc = fr ? 'Taux non lu sur le talon.' : 'Rate not read from the stub.';
  } else {
    rateCheck.status = 'info';
    rateCheck.desc = fr ? 'Choisis ton année d’échelon ou entre ton taux dans les réglages pour comparer.' : 'Pick your seat year or enter your rate in the settings to compare.';
  }
  rateCheck.rows = [tr(rateCheck.name,
    tdN(st.rate ? money(st.rate) + '/h' : DASH) + tdN(stubRate != null ? money(stubRate) + '/h' : DASH) +
    (rateCheck.status === 'bad' ? tdBad(sgn$(Math.round((stubRate - st.rate) * 100) / 100)) : tdP(pill(rateCheck.status))),
    rateCheck.status === 'bad')];

  // 3. CDN per-diem rate.
  const pdRateCheck = { id: 'pdrate', name: fr ? 'Taux per diem CDN' : 'Canadian per diem rate' };
  if (stubPdRate != null && st.cdn) {
    const ok = Math.abs(stubPdRate - st.cdn) < 0.005;
    pdRateCheck.status = ok ? 'ok' : 'bad';
    pdRateCheck.desc = ok
      ? money(stubPdRate) + (fr ? '/h, comme attendu.' : '/h, as expected.')
      : (fr ? 'Le talon montre ' + money(stubPdRate) + '/h mais tu attends ' + money(st.cdn) + '/h.'
        : 'The stub shows ' + money(stubPdRate) + '/h but you expect ' + money(st.cdn) + '/h.');
  } else {
    pdRateCheck.status = 'info';
    pdRateCheck.desc = fr ? 'Taux non lu sur le talon.' : 'Rate not read from the stub.';
  }
  pdRateCheck.rows = [tr(pdRateCheck.name,
    tdN(st.cdn ? money(st.cdn) + '/h' : DASH) + tdN(stubPdRate != null ? money(stubPdRate) + '/h' : DASH) +
    (pdRateCheck.status === 'bad' ? tdBad(sgn$(Math.round((stubPdRate - st.cdn) * 100) / 100)) : tdP(pill(pdRateCheck.status))),
    pdRateCheck.status === 'bad')];

  // 4. US per diem (LOA #3): hours from the roster's US layovers vs the stub.
  const usCheck = { id: 'us', name: 'Per diem US' };
  if (!fr) usCheck.name = 'US per diem';
  const usFx = deriveUsFx(paidUsAmt, paidUsH != null ? paidUsH : pd.usHours, st.usUsd);
  if (!rosterHas) {
    usCheck.status = 'info';
    usCheck.desc = nonCompare;
  } else if (pd.usHours <= 0.05 && paidUsAmt == null) {
    usCheck.status = 'ok';
    usCheck.desc = fr ? 'Aucun layover US cette période : rien d’attendu, rien de payé.' : 'No US layover this period: nothing expected, nothing paid.';
  } else if (pd.usHours > 0.05 && paidUsAmt == null) {
    usCheck.status = 'bad';
    usCheck.desc = fr
      ? 'Ton horaire montre ' + hL(pd.usHours) + ' h de layover US, mais le talon ne paie aucun per diem US.'
      : 'Your schedule shows ' + hL(pd.usHours) + ' h of US layover, but the stub pays no US per diem.';
  } else if (pd.usHours <= 0.05 && paidUsAmt != null) {
    usCheck.status = 'bad';
    usCheck.desc = fr
      ? 'Le talon paie ' + money(paidUsAmt) + ' de per diem US, mais ton horaire ne montre aucun layover US.'
      : 'The stub pays ' + money(paidUsAmt) + ' of US per diem, but your schedule shows no US layover.';
  } else if (paidUsH != null) {
    const ok = Math.abs(pd.usHours - paidUsH) <= 1.0;
    usCheck.status = ok ? 'ok' : 'bad';
    usCheck.desc = ok
      ? (fr ? 'Heures US concordent' + C + ' ' + hL(pd.usHours) + ' h · ' + money(paidUsAmt) + (usFx > 0 ? ' (change dérivé ' + usFx.toLocaleString(loc, { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + ')' : '') + '.'
        : 'US hours match: ' + hL(pd.usHours) + ' h · ' + money(paidUsAmt) + (usFx > 0 ? ' (derived exchange ' + usFx.toLocaleString(loc, { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + ')' : '') + '.')
      : (fr ? 'Ton horaire donne ' + hL(pd.usHours) + ' h US, le talon en paie ' + hL(paidUsH) + ' h.'
        : 'Your schedule gives ' + hL(pd.usHours) + ' h of US layover, the stub pays ' + hL(paidUsH) + ' h.');
  } else {
    usCheck.status = 'info';
    usCheck.desc = fr
      ? hL(pd.usHours) + ' h US selon l’horaire · ' + money(paidUsAmt) + ' payés. Heures non lues sur le talon.'
      : hL(pd.usHours) + ' h US per the schedule · ' + money(paidUsAmt) + ' paid. Hours not read from the stub.';
  }
  {
    const compCell = rosterHas ? (pd.usHours > 0.05 ? tdN(hL(pd.usHours) + ' h') : tdM(fr ? 'aucun' : 'none')) : tdN(DASH);
    const paidCell = paidUsAmt != null ? tdN(money(paidUsAmt) + (paidUsH != null ? ' · ' + hL(paidUsH) + ' h' : '')) : tdM(fr ? 'aucun' : 'none');
    usCheck.rows = [tr(usCheck.name, compCell + paidCell + tdP(pill(usCheck.status === 'bad' ? 'info' : usCheck.status)), usCheck.status === 'bad')];
    if (usCheck.status === 'bad') usCheck.rows = [tr(usCheck.name, compCell + paidCell + tdBad(fr ? 'Problème' : 'Issue'), true)];
  }

  // 5. Recurring items — needs the previous stored stub (2+ stubs).
  const recurCheck = { id: 'recur', name: fr ? 'Items récurrents' : 'Recurring items' };
  {
    const idx = all.findIndex(x => x.ym === ym);
    const prior = (idx >= 0 && idx + 1 < all.length) ? all[idx + 1].stub : null;
    if (prior) {
      const RECUR = [['253', 'Footwear'], ['255', fr ? 'Nettoyage' : 'Cleaning'], ['256', fr ? 'Examen médical' : 'Annual medical'], ['587', fr ? 'Cotisations ALPA' : 'ALPA dues']];
      const paidIn = (s, code) => { const arr = (+code < 500 ? s.earnings : s.deductions) || []; const it = arr.find(x => x.code === code); return !!(it && it.amount != null && +it.amount !== 0); };
      const missing = RECUR.filter(r => paidIn(prior, r[0]) && !paidIn(parsed, r[0]));
      if (missing.length) {
        recurCheck.status = 'bad';
        recurCheck.desc = (fr ? 'Payé au talon précédent mais absent cette fois' + C + ' ' : 'Paid on the previous stub but missing this time: ') + missing.map(r => esc(r[1])).join(', ') + '.';
        recurCheck.rows = [tr(recurCheck.name, tdM(fr ? 'attendus' : 'expected') + tdM(fr ? 'manquants' : 'missing') + tdBad(fr ? 'Problème' : 'Issue'), true)];
      } else {
        recurCheck.status = 'ok';
        recurCheck.desc = fr ? 'Cotisations et allocations habituelles présentes sur le talon.' : 'Usual contributions and allowances present on the stub.';
        recurCheck.rows = [tr(recurCheck.name, tdM(fr ? 'attendus' : 'expected') + tdM(fr ? 'présents' : 'present') + tdP(pill('ok')), false)];
      }
    } else {
      recurCheck.status = 'info';
      recurCheck.desc = fr ? 'Comparaison possible dès un deuxième talon importé.' : 'Comparison starts once a second stub is imported.';
      recurCheck.rows = [tr(recurCheck.name, tdM(DASH) + tdM(DASH) + tdP(pill('info')), false)];
    }
  }

  // 6. Flight pay + overtime — for reference only (semi-monthly rules to confirm).
  const baseCheck = {
    id: 'base', status: 'info',
    name: fr ? 'Base et temps supplémentaire' : 'Flight pay and overtime',
    desc: fr ? 'À titre indicatif : les règles semi-mensuelles restent à confirmer.' : 'For reference: the semi-monthly rules remain to be confirmed.',
    rows: [
      tr((fr ? 'Base et temps supp. (base)' : 'Flight pay and overtime (flight pay)') + '<span class="sub">' + (fr ? 'Règles semi-mensuelles à confirmer' : 'Semi-monthly rules to confirm') + '</span>',
        tdM(DASH) + tdN(baseAmt != null ? money(baseAmt) : DASH) + tdP(pill('info')), false),
      tr(fr ? 'Base et temps supp. (temps supp.)' : 'Flight pay and overtime (overtime)',
        tdM(DASH) + tdN(otAmt != null ? money(otAmt) : DASH) + tdP(pill('info')), false)
    ]
  };

  const checks = [pdCheck, rateCheck, pdRateCheck, usCheck, recurCheck, baseCheck];
  const badChecks = checks.filter(c => c.status === 'bad');
  const okChecks = checks.filter(c => c.status === 'ok');
  const infoChecks = checks.filter(c => c.status === 'info');

  // ── verdict banner (mockup §3): red / green / neutral ──────────────
  let verdict;
  if (badChecks.length) {
    const others = badChecks.filter(c => c.id !== 'perdiem').map(c => c.name);
    let title;
    if (pdCheck.status === 'bad' && pdCheck.gapAmt != null) {
      title = fr ? 'Écart de ' + money(Math.abs(pdCheck.gapAmt)) + ' à vérifier sur ce talon'
        : 'A ' + money(Math.abs(pdCheck.gapAmt)) + ' discrepancy to check on this stub';
    } else {
      title = fr ? (badChecks.length > 1 ? badChecks.length + ' points à vérifier sur ce talon' : 'Un point à vérifier sur ce talon')
        : (badChecks.length > 1 ? badChecks.length + ' points to check on this stub' : 'One point to check on this stub');
    }
    let body;
    if (pdCheck.status === 'bad') {
      if (pdCheck.gapH != null) {
        const less = pdCheck.gapH < 0;
        body = fr
          ? 'Per diem CDN' + C + ' le talon paie <b>' + hL(Math.abs(pdCheck.gapH)) + ' h de ' + (less ? 'moins' : 'plus') + '</b> que ton horaire (<b>' + hL(paidCdnH) + ' h</b> au lieu de <b>' + hL(pd.cdnHours) + ' h</b>). '
          : 'Canadian per diem: the stub pays <b>' + hL(Math.abs(pdCheck.gapH)) + ' h ' + (less ? 'less' : 'more') + '</b> than your schedule (<b>' + hL(paidCdnH) + ' h</b> instead of <b>' + hL(pd.cdnHours) + ' h</b>). ';
      } else {
        body = fr
          ? 'Per diem CDN' + C + ' calculé <b>' + money(pd.cdnAmount) + '</b>, payé <b>' + (paidCdnAmt != null ? money(paidCdnAmt) : DASH) + '</b>. '
          : 'Canadian per diem: computed <b>' + money(pd.cdnAmount) + '</b>, paid <b>' + (paidCdnAmt != null ? money(paidCdnAmt) : DASH) + '</b>. ';
      }
      body += fr
        ? 'Trois causes possibles' + C + ' ta période de paie diffère, des vols manquent dans ton horaire, ou Porter s’est trompé.'
        : 'Three possible causes: your pay period differs, flights are missing from your schedule, or Porter made an error.';
      if (others.length) body += ' ' + (fr ? 'Aussi à vérifier' + C + ' ' : 'Also to check: ') + others.join(' · ') + '.';
      body += '<br><a class="v-link" href="#verif-perdiem">' + (fr ? 'Voir la vérification' : 'See the check') + '</a>';
    } else {
      body = (fr ? 'À vérifier' + C + ' ' : 'To check: ') + badChecks.map(c => c.name).join(' · ') + '.' +
        '<br><a class="v-link" href="#pay-checks">' + (fr ? 'Voir les vérifications' : 'See the checks') + '</a>';
    }
    verdict = _payBanner('bad', title, body);
  } else if (pdCheck.status === 'ok') {
    verdict = _payBanner('ok',
      fr ? 'Tout concorde sur ce talon' : 'Everything matches on this stub',
      (fr ? 'Vérifications conformes' + C + ' ' : 'Passing checks: ') + okChecks.map(c => c.name).join(' · ') + '.' +
      (infoChecks.length ? ' ' + infoChecks.length + (fr ? ' point' + (infoChecks.length > 1 ? 's' : '') + ' à titre indicatif.' : ' for reference.') : ''));
  } else {
    verdict = _payBanner('neutral',
      fr ? 'Talon lu, comparaison partielle' : 'Stub read, partial comparison',
      (fr ? 'Aucun vol enregistré pour cette période' + C + ' le per diem ne peut pas être comparé à ton horaire.'
        : 'No flights logged for this period: the per diem cannot be checked against your schedule.') +
      (okChecks.length ? ' ' + (fr ? 'Conformes' + C + ' ' : 'Passing: ') + okChecks.map(c => c.name).join(' · ') + '.' : ''));
  }

  // ── KPI row (mockup §4) ─────────────────────────────────────────────
  const idxCur = all.findIndex(x => x.ym === ym);
  const prevEntry = (idxCur >= 0 && idxCur + 1 < all.length) ? all[idxCur + 1] : null;
  const prevDep = (prevEntry && prevEntry.stub.totalDeposit != null) ? prevEntry.stub.totalDeposit : null;
  let heroSub = '';
  if (depDmy) heroSub += (fr ? 'Déposé le ' : 'Deposited ') + _payDayLabel(depDmy, fr, false, false);
  if (parsed.totalDeposit != null && prevDep != null) {
    const dv = Math.round((parsed.totalDeposit - prevDep) * 100) / 100;
    heroSub += (heroSub ? ' · ' : '') + (dv >= 0 ? '<span class="delta">+' + money(dv) + '</span>' : '<span>' + money(dv) + '</span>') +
      ' vs ' + _payDayLabel(_payDMY(prevEntry.stub.period), fr, false, false);
  }
  const year = perDmy ? perDmy.y : +ym.slice(0, 4);
  const kpi = (label, value, sub, cls) => '<div class="kpi' + (cls ? ' ' + cls : '') + '"><div class="kpi-label">' + label + '</div><div class="kpi-value num">' + value + '</div>' + (sub ? '<div class="kpi-sub num">' + sub + '</div>' : '') + '</div>';
  let gapKpi;
  if (pdCheck.status === 'bad') {
    gapKpi = kpi(fr ? 'Écart détecté' : 'Discrepancy detected',
      pdCheck.gapAmt != null ? money(pdCheck.gapAmt) : DASH,
      'Per diem CDN' + (pdCheck.gapH != null ? ' · ' + (fr ? 'écart de ' + hL(Math.abs(pdCheck.gapH)) + ' h' : hL(Math.abs(pdCheck.gapH)) + ' h gap') : ''),
      'kpi-alert');
  } else if (pdCheck.status === 'ok') {
    gapKpi = kpi(fr ? 'Écart détecté' : 'Discrepancy detected', money(0), fr ? 'Per diem CDN conforme' : 'Canadian per diem passes');
  } else {
    gapKpi = kpi(fr ? 'Écart détecté' : 'Discrepancy detected', DASH, fr ? 'Non comparé' : 'Not compared');
  }
  const kpis = '<section class="kpis" aria-label="' + (fr ? 'Indicateurs de la période' : 'Period indicators') + '">' +
    kpi(fr ? 'Dépôt de la période' : 'Period deposit', parsed.totalDeposit != null ? money(parsed.totalDeposit) : DASH, heroSub, 'kpi-hero') +
    kpi(fr ? 'Cumul ' + year + ' (imposable)' : 'Taxable earnings (' + year + ' YTD)',
      parsed.taxableYtd != null ? money(parsed.taxableYtd) : DASH,
      parsed.deductionsYtd != null ? (fr ? 'Déductions à ce jour' + C + ' ' : 'Deductions to date: ') + money(parsed.deductionsYtd) : '') +
    kpi(fr ? 'Per diem CDN attendu' : 'Expected Canadian per diem',
      rosterHas ? money(pd.cdnAmount) : DASH,
      rosterHas
        ? hL(pd.cdnHours) + ' h × ' + money(st.cdn) + '/h' + (paidCdnAmt != null ? ' · ' + money(paidCdnAmt) + (fr ? ' payés' : ' paid') : '')
        : (fr ? 'Aucun vol enregistré pour cette période' : 'No flights logged for this period')) +
    gapKpi + '</section>';

  // ── checks section (mockup §5): head + problem card + list ─────────
  const chips = [];
  if (okChecks.length) chips.push('<span class="chip-dot"><span class="dot dot-ok" aria-hidden="true"></span>' + okChecks.length + ' ' + (fr ? 'conforme' + (okChecks.length > 1 ? 's' : '') : 'passing') + '</span>');
  if (badChecks.length) chips.push('<span class="chip-dot"><span class="dot dot-bad" aria-hidden="true"></span>' + badChecks.length + ' ' + (fr ? 'problème' + (badChecks.length > 1 ? 's' : '') : 'issue' + (badChecks.length > 1 ? 's' : '')) + '</span>');
  if (infoChecks.length) chips.push('<span class="chip-dot"><span class="dot dot-info" aria-hidden="true"></span>' + infoChecks.length + ' ' + (fr ? 'à titre indicatif' : 'for reference') + '</span>');
  const checksHead = '<div class="section-head" id="pay-checks"><span class="microlabel">' + (fr ? 'Vérifications' : 'Checks') + '</span>' +
    '<h2>' + (fr ? 'Six points comparés' + C + ' ton horaire et le talon' : 'Six points compared: your schedule and the stub') + '</h2>' +
    (chips.length ? '<div class="head-chips">' + chips.join('') + '</div>' : '') + '</div>';

  let failCard = '';
  let listChecks = checks;
  if (pdCheck.status === 'bad') {
    listChecks = checks.filter(c => c !== pdCheck);
    const icX = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.4"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/></svg>';
    let chart = '', chartData = '';
    if (paidCdnH != null && rosterHas) {
      const gapTxt = hL(Math.abs(pdCheck.gapH)) + ' h ' + (fr ? 'd’écart' : 'difference') + (pdCheck.gapAmt != null ? ' = ' + money(Math.abs(pdCheck.gapAmt)) : '');
      chart = _payCompareSvg(pd.cdnHours, paidCdnH, gapTxt, fr, hL);
      chartData = '<details class="fold"><summary>' + _payChev() + (fr ? 'Données du graphique' + C + ' calculé vs payé' : 'Chart data: calculated vs paid') + '</summary>' +
        '<div class="fold-body tbl-wrap"><table><tbody>' +
        '<tr><th scope="row">' + (fr ? 'Selon l’horaire de vol' : 'According to the flight schedule') + '</th><td class="r num">' + hL(pd.cdnHours) + ' h</td></tr>' +
        '<tr><th scope="row">' + (fr ? 'Payé sur le talon' : 'Paid on the stub') + '</th><td class="r num">' + hL(paidCdnH) + ' h</td></tr>' +
        '<tr><th scope="row">' + (fr ? 'Écart' : 'Difference') + '</th><td class="r num">' + sgnH(pdCheck.gapH) + (pdCheck.gapAmt != null ? ' = ' + sgn$(pdCheck.gapAmt) : '') + '</td></tr>' +
        '</tbody></table></div></details>';
    }
    failCard = '<article class="check-fail" id="verif-perdiem" aria-labelledby="pay-perdiem-title">' +
      '<div class="check-fail-head"><span class="ic" aria-hidden="true">' + icX + '</span>' +
      '<div><h3 id="pay-perdiem-title">' + (fr ? 'Per diem CDN' + C + ' écart détecté' : 'Canadian per diem: discrepancy detected') + '</h3>' +
      '<p class="desc num">' + pdCheck.desc + '</p></div>' +
      (pdCheck.gapAmt != null ? '<span class="amount-pill num">' + money(pdCheck.gapAmt) + '</span>' : '') +
      '</div>' +
      '<div class="cause-box"><strong>' + (fr ? 'Trois causes possibles' + C : 'Three possible causes:') + '</strong> ' +
      (fr ? 'ta période de paie diffère, des vols manquent dans ton horaire, ou Porter s’est trompé.' : 'your pay period differs, flights are missing from your schedule, or Porter made an error.') + '</div>' +
      chart + chartData + '</article>';
  }
  const checksList = '<section class="v2-card checks-card" aria-label="' + (fr ? 'Vérifications' : 'Checks') + '"><ul class="check-list">' +
    listChecks.map(c => '<li>' + _payCkIcon(c.status, fr) + '<div><div class="ck-name">' + c.name + '</div><div class="ck-desc num">' + c.desc + '</div></div></li>').join('') +
    '</ul></section>';

  // ── this period (mockup §6): composition + folded detail table ─────
  const segs = [
    { v: baseAmt, lbl: fr ? 'Base de vol' : 'Flight pay', paint: 'class="seg-base"', sw: '<span class="sw sw-base"></span>',
      note: (bk.regular && bk.regular.units != null && bk.regular.rate != null) ? hL(bk.regular.units) + ' h ' + (fr ? 'créditées' : 'credited') + ' × ' + money(bk.regular.rate) : '' },
    { v: paidCdnAmt, lbl: 'Per diem CDN', paint: 'class="seg-pd"', sw: '<span class="sw sw-pd"></span>',
      note: (paidCdnH != null && stubPdRate != null) ? hL(paidCdnH) + ' h × ' + money(stubPdRate) : '' },
    { v: otAmt, lbl: fr ? 'Temps supp.' : 'Overtime', paint: 'style="background:var(--v2-accent-data)"', swPaint: 'background:var(--v2-accent-data)', note: '' },
    { v: paidUsAmt, lbl: fr ? 'Per diem US' : 'US per diem', paint: 'style="background:var(--v2-accent-band)"', swPaint: 'background:var(--v2-accent-band)', note: '' }
  ];
  if (!fr) segs[1].lbl = 'Canadian per diem';
  const totalPos = segs.reduce((s, x) => s + (x.v > 0 ? x.v : 0), 0);
  let compoBody = '';
  if (totalPos > 0) {
    const pct = v => Math.round((v / totalPos) * 1000) / 10;
    const ariaParts = segs.filter(s => s.v > 0).map(s => s.lbl + ' ' + money(s.v) + (fr ? ' soit ' : ' or ') + hL(pct(s.v)) + ' %');
    // Inline-painted segments need their paint merged into the width style.
    const barSafe = segs.filter(s => s.v > 0).map(s => {
      if (s.paint.indexOf('class=') === 0) return '<span ' + s.paint + ' style="width:' + pct(s.v) + '%"></span>';
      return '<span style="' + s.swPaint + ';width:' + pct(s.v) + '%"></span>';
    }).join('');
    compoBody += '<div class="stack-bar" role="img" aria-label="' + esc((fr ? 'Composition des gains de la période : ' : 'Breakdown of period earnings: ') + ariaParts.join(', ') + '.') + '">' + barSafe + '</div>';
  }
  compoBody += '<div class="stack-legend">' + segs.map(s => {
    const sw = s.v > 0 ? (s.sw || '<span class="sw" style="' + s.swPaint + '"></span>') : '<span class="sw sw-none"></span>';
    return '<div class="item">' + sw + '<span><span class="lbl">' + s.lbl + '</span><br><span class="val num">' + (s.v != null ? money(s.v) : DASH) + '</span>' + (s.note ? '<br><span class="note num">' + s.note + '</span>' : '') + '</span></div>';
  }).join('') + '</div>';
  const netBits = [];
  if (parsed.deductionsThisPeriod != null) netBits.push('<span>' + (fr ? 'Déductions de la période' + C + ' ' : 'Period deductions: ') + '<strong>' + money(-Math.abs(parsed.deductionsThisPeriod)) + '</strong></span>');
  if (parsed.totalDeposit != null) netBits.push('<span>' + (fr ? 'Dépôt net' + C + ' ' : 'Net deposit: ') + '<strong>' + money(parsed.totalDeposit) + '</strong></span>');
  if (netBits.length) compoBody += '<div class="compo-net num">' + netBits.join('') + '</div>';
  compoBody += '<details class="fold"><summary>' + _payChev() + (fr ? 'Tableau détaillé' + C + ' calculé vs payé' : 'Detailed table: calculated vs paid') + '</summary>' +
    '<div class="fold-body tbl-wrap"><table><thead><tr><th>' + (fr ? 'Élément' : 'Item') + '</th><th class="r">' + (fr ? 'Calculé (horaire)' : 'Calculated (schedule)') + '</th><th class="r">' + (fr ? 'Payé (talon)' : 'Paid (stub)') + '</th><th class="r">' + (fr ? 'Écart' : 'Difference') + '</th></tr></thead><tbody>' +
    checks.map(c => (c.rows || []).join('')).join('') +
    '</tbody></table></div></details>';
  const periodHead = '<div class="section-head"><span class="microlabel">' + (fr ? 'Cette période' : 'This period') + '</span><h2>' +
    (fr ? 'D’où vient ta paie ' + (range ? 'du ' + _payRangeTxt(range, fr, false, false) : 'de ' + esc(ymLabel))
      : 'Where your ' + (range ? _payRangeTxt(range, fr, false, false) : esc(ymLabel)) + ' pay comes from') + '</h2></div>';

  const curStatus = badChecks.length ? { status: 'issue', issues: badChecks.length } : { status: pdCheck.status === 'ok' ? 'ok' : 'none', issues: 0 };

  host.innerHTML = stubLine + verdict + checksumWarn + kpis +
    checksHead + failCard + checksList +
    periodHead + '<section class="v2-card">' + compoBody + '</section>' +
    payStubHistory(all, ym, allFls, st, fr, money, hL, curStatus) +
    payStubBreakdown(parsed, all, fr, money, hL, range, depDmy);
}

// ── Year-to-date panel + ranked deduction bars + stub-detail fold ────
// (mockup §8 + §9). Everything from the stub's own YTD columns and the
// stored stubs; the reconciliation equation shows ONLY when it balances.
function payStubBreakdown(parsed, all, fr, money, hL, range, depDmy) {
  if (!parsed) return '';
  const C = fr ? ' :' : ':';
  const DASH = _PAY_DASH;
  const dmy = _payDMY(parsed.period);
  const year = dmy ? dmy.y : null;
  // Semi-monthly period number inside the year (Jan 15 = 1, Jan 31 = 2, …).
  const perIdx = dmy ? (dmy.m - 1) * 2 + (dmy.d <= 15 ? 1 : 2) : null;
  const bk = (typeof payStubBuckets === 'function') ? payStubBuckets(parsed) : {};

  const dedBy = {};
  (parsed.deductions || []).forEach(d => { if (!dedBy[d.code]) dedBy[d.code] = d; });

  // ── YTD stats ──
  const stats = [];
  if (parsed.taxableYtd != null) stats.push({ l: fr ? 'Gains imposables' : 'Taxable earnings', v: parsed.taxableYtd, dim: false });
  if (parsed.deductionsYtd != null) stats.push({ l: fr ? 'Déductions totales' : 'Total deductions', v: parsed.deductionsYtd, dim: true });
  const sameYear = (all || []).filter(e => { const d = _payDMY(e.stub && e.stub.period); return d && year != null && d.y === year && e.stub.totalDeposit != null; });
  const depSum = Math.round(sameYear.reduce((s, e) => s + e.stub.totalDeposit, 0) * 100) / 100;
  if (sameYear.length) {
    const partial = perIdx != null && sameYear.length < perIdx;
    stats.push({
      l: (fr ? 'Total déposé' : 'Total deposited') + (partial ? ' (' + sameYear.length + ' ' + (fr ? 'talon' + (sameYear.length > 1 ? 's' : '') + ' importé' + (sameYear.length > 1 ? 's' : '') : 'stub' + (sameYear.length > 1 ? 's' : '') + ' imported') + ')' : ''),
      v: depSum, dim: false
    });
  }

  // ── reconciliation equation: shown only when it actually balances ──
  let eq = '';
  if (parsed.taxableYtd != null && parsed.deductionsYtd != null && perIdx != null && sameYear.length === perIdx) {
    let pdSum = 0;
    sameYear.forEach(e => {
      const b = payStubBuckets(e.stub);
      pdSum += ((b.perDiemCdn && b.perDiemCdn.amount) || 0) + ((b.perDiemUs && b.perDiemUs.amount) || 0);
    });
    pdSum = Math.round(pdSum * 100) / 100;
    const lhs = Math.round((parsed.taxableYtd - parsed.deductionsYtd + pdSum) * 100) / 100;
    if (Math.abs(lhs - depSum) <= 0.05) {
      eq = '<p class="ytd-equation num">' + (fr
        ? 'Gains imposables <strong>' + money(parsed.taxableYtd) + '</strong> − déductions <strong>' + money(parsed.deductionsYtd) + '</strong> + per diem non imposable <strong>' + money(pdSum) + '</strong> = total déposé <strong>' + money(depSum) + '</strong>.'
        : 'Taxable earnings <strong>' + money(parsed.taxableYtd) + '</strong> − deductions <strong>' + money(parsed.deductionsYtd) + '</strong> + non-taxable per diem <strong>' + money(pdSum) + '</strong> = total deposited <strong>' + money(depSum) + '</strong>.') + '</p>';
    }
  }

  // ── ranked deduction bars (YTD), RRSP in green: savings, not a cost ──
  const NAMED = [
    ['521', fr ? 'Impôt' : 'Income tax', false],
    ['501', fr ? 'RPC' : 'CPP', false],
    ['511', fr ? 'Assurance-emploi' : 'Employment Insurance', false],
    ['530', fr ? 'REER' : 'RRSP', true],
    ['587', 'ALPA', false]
  ];
  const items = [];
  let namedSum = 0;
  NAMED.forEach(nd => { const d = dedBy[nd[0]]; if (d && d.ytd != null && d.ytd > 0) { items.push({ n: nd[1], v: d.ytd, grn: nd[2] }); namedSum += d.ytd; } });
  if (parsed.deductionsYtd != null) {
    const rest = Math.round((parsed.deductionsYtd - namedSum) * 100) / 100;
    if (rest > 0.005) items.push({ n: fr ? 'Autres retenues' : 'Other deductions', v: rest, grn: false });
  }
  items.sort((a, b) => b.v - a.v);
  const maxD = items.length ? items[0].v : 0;
  const dedList = (items.length && maxD > 0)
    ? '<div class="ded-list">' + items.map(it =>
      '<div class="ded-row"><div class="top"><span class="name">' + esc(it.n) +
      (it.grn ? ' <span class="note-grn">' + (fr ? '(épargne qui te revient)' : '(savings that come back to you)') + '</span>' : '') +
      '</span><span class="amt num">' + money(it.v) + '</span></div>' +
      '<div class="bar' + (it.grn ? ' grn' : '') + '" style="width:' + Math.max(1, Math.round((it.v / maxD) * 1000) / 10) + '%"></div></div>').join('') + '</div>'
    : '';

  let ytdSection = '';
  if (stats.length || dedList) {
    ytdSection = '<div class="section-head"><span class="microlabel">' + (fr ? 'Cumul annuel' : 'Year-to-date') + (year != null ? ' ' + year : '') + '</span>' +
      '<h2>' + (perIdx != null
        ? (fr ? 'Où tu en es après ' + perIdx + ' période' + (perIdx > 1 ? 's' : '') : 'Where you stand after ' + perIdx + ' period' + (perIdx > 1 ? 's' : ''))
        : (fr ? 'Où tu en es cette année' : 'Where you stand this year')) + '</h2></div>' +
      '<section class="v2-card">' +
      (stats.length ? '<div class="ytd-stats">' + stats.map(s => '<div class="ytd-stat"><span class="microlabel">' + s.l + '</span><div class="big num' + (s.dim ? ' dim' : '') + '">' + money(s.v) + '</div></div>').join('') + '</div>' : '') +
      eq + dedList + '</section>';
  }

  // ── stub detail (fold, mockup §9) + every line read from the PDF ──
  const kv = (k, sub, v, total) => '<div class="kv' + (total ? ' total' : '') + '"><span class="k">' + k + (sub ? '<span class="sub num">' + sub + '</span>' : '') + '</span><span class="v num">' + v + '</span></div>';
  const baseAmt = (bk.regular && bk.regular.amount != null) ? bk.regular.amount : null;
  const otAmt = (bk.overtime && bk.overtime.amount != null) ? bk.overtime.amount : null;
  const pdCdnAmt = (bk.perDiemCdn && bk.perDiemCdn.amount != null) ? bk.perDiemCdn.amount : null;
  const pdUsAmt = (bk.perDiemUs && bk.perDiemUs.amount != null) ? bk.perDiemUs.amount : null;
  const left =
    '<div><h4>' + (fr ? 'Gains' : 'Earnings') + '</h4>' +
    kv(fr ? 'Base de vol' : 'Flight pay',
      (bk.regular && bk.regular.units != null && bk.regular.rate != null) ? hL(bk.regular.units) + ' h ' + (fr ? 'créditées' : 'credited') + ' × ' + money(bk.regular.rate) : '',
      baseAmt != null ? money(baseAmt) : DASH, false) +
    kv(fr ? 'Temps supplémentaire' : 'Overtime', '', otAmt != null ? money(otAmt) : DASH, false) +
    kv(fr ? 'Per diem CDN' : 'Canadian per diem',
      (bk.perDiemCdn && bk.perDiemCdn.units != null && bk.perDiemCdn.rate != null) ? hL(bk.perDiemCdn.units) + ' h × ' + money(bk.perDiemCdn.rate) : '',
      pdCdnAmt != null ? money(pdCdnAmt) : DASH, false) +
    kv(fr ? 'Per diem US' : 'US per diem', '', pdUsAmt != null ? money(pdUsAmt) : DASH, false) +
    kv(fr ? 'Gains de la période' : 'Period earnings', '', parsed.earningsThisPeriod != null ? money(parsed.earningsThisPeriod) : DASH, true) +
    '</div>';
  const right =
    '<div><h4>' + (fr ? 'Déductions et dépôt' : 'Deductions and deposit') + '</h4>' +
    kv(fr ? 'Déductions de la période' : 'Period deductions',
      fr ? 'Détail par retenue dans le cumul annuel' : 'Breakdown by deduction in the year-to-date',
      parsed.deductionsThisPeriod != null ? money(-Math.abs(parsed.deductionsThisPeriod)) : DASH, false) +
    kv((fr ? 'Dépôt net' : 'Net deposit') + (depDmy ? ' (' + _payDayLabel(depDmy, fr, false, true) + ')' : ''), '',
      parsed.totalDeposit != null ? money(parsed.totalDeposit) : DASH, true) +
    '</div>';
  const line = e => '<tr><td class="muted num">' + esc(e.code) + '</td><td>' + esc(e.label || '') + '</td>' +
    '<td class="r num">' + (e.amount != null ? money(e.amount) : DASH) + '</td>' +
    '<td class="r num">' + (e.ytd != null ? money(e.ytd) : DASH) + '</td></tr>';
  const lineHead = '<thead><tr><th>Code</th><th>' + (fr ? 'Élément' : 'Item') + '</th><th class="r">' + (fr ? 'Montant' : 'Amount') + '</th><th class="r">' + (fr ? 'Cumul' : 'YTD') + '</th></tr></thead>';
  const earnRows = (parsed.earnings || []).map(line).join('');
  const dedRows = (parsed.deductions || []).map(line).join('');
  let lines = '';
  if (earnRows) lines += '<p class="chart-title">' + (fr ? 'Gains' : 'Earnings') + '</p><div class="tbl-wrap"><table>' + lineHead + '<tbody>' + earnRows + '</tbody></table></div>';
  if (dedRows) lines += '<p class="chart-title">' + (fr ? 'Déductions' : 'Deductions') + '</p><div class="tbl-wrap"><table>' + lineHead + '<tbody>' + dedRows + '</tbody></table></div>';

  const detailFold = '<details class="fold-card"><summary>' + _payChev() +
    (fr ? 'Détail du talon' + C + ' ' : 'Stub detail: ') + (range ? _payRangeTxt(range, fr, true, false) : esc(parsed.period || '')) + '</summary>' +
    '<div class="fold-body"><div class="stub-cols">' + left + right + '</div>' + lines + '</div></details>';

  return ytdSection + detailFold;
}

// ── History across all stored stubs (mockup §7): deposits bar chart,
// per-diem sparkline (2+ readable stubs), shared data table, and the
// chronological period statement. Shows once there are 2+ stubs. ─────
function payStubHistory(all, curYm, allFls, st, fr, money, hL, cur) {
  if (!all || all.length < 2) return '';
  const C = fr ? ' :' : ':';
  const DASH = _PAY_DASH;
  const asc = all.slice().reverse();   // oldest → newest
  const n = asc.length, slot = 650 / n;
  const infos = asc.map((entry, i) => {
    const stub = entry.stub || {};
    const bkx = (typeof payStubBuckets === 'function') ? payStubBuckets(stub) : {};
    const range = (stub.period && typeof payStubPeriodRange === 'function') ? payStubPeriodRange(stub.period) : null;
    const dmy = _payDMY(stub.period);
    const dep = stub.totalDeposit != null ? stub.totalDeposit : null;
    const pdC = (bkx.perDiemCdn && bkx.perDiemCdn.amount != null) ? bkx.perDiemCdn.amount : null;
    const pdU = (bkx.perDiemUs && bkx.perDiemUs.amount != null) ? bkx.perDiemUs.amount : null;
    const pdAmt = (pdC == null && pdU == null) ? null : Math.round(((pdC || 0) + (pdU || 0)) * 100) / 100;
    const ot = (bkx.overtime && bkx.overtime.amount != null && bkx.overtime.amount > 0) ? bkx.overtime.amount : null;
    const isCur = entry.ym === curYm;
    const status = (isCur && cur) ? cur.status : _payQuickCheck(stub, bkx, range, allFls, st);
    const short = _payDayLabel(dmy, fr, true, false);
    const it = { ym: entry.ym, stub: stub, range: range, dmy: dmy, dep: dep, pdAmt: pdAmt, ot: ot, isCur: isCur, status: status, short: short, cx: 46 + slot * i + slot / 2 };
    it.tipDep = _payDayLabel(dmy, fr, false, false) + '. ' + (fr ? 'Dépôt ' : 'Deposit ') + (dep != null ? money(dep) : DASH) +
      (pdAmt != null ? ' · Per diem ' + money(pdAmt) : '') +
      (ot != null ? ' · ' + (fr ? 'Temps supp. ' : 'Overtime ') + money(ot) : '') +
      (isCur ? ' · ' + (fr ? 'Période courante' : 'Current period') : '');
    it.tipPd = _payDayLabel(dmy, fr, false, false) + '. Per diem ' + (pdAmt != null ? money(pdAmt) : DASH) +
      (isCur ? ' · ' + (fr ? 'Période courante' : 'Current period') : '');
    return it;
  });

  // Section head — counts and starting month come from the real data.
  const yearsSeen = {};
  infos.forEach(i => { if (i.dmy) yearsSeen[i.dmy.y] = 1; });
  const yrs = Object.keys(yearsSeen);
  const kicker = (fr ? 'Historique' : 'History') + (yrs.length === 1 ? ' ' + yrs[0] : '');
  const withDep = infos.filter(i => i.dep != null);
  const first = infos[0];
  const firstLbl = first.dmy ? ((fr ? _PAY_MO_FR : _PAY_MO_EN)[first.dmy.m - 1] + (yrs.length > 1 ? ' ' + first.dmy.y : '')) : '';
  const h2 = withDep.length >= 2
    ? (fr ? 'Tes ' + withDep.length + ' dépôts' + (firstLbl ? ' depuis ' + firstLbl : '') : 'Your ' + withDep.length + ' deposits' + (firstLbl ? ' since ' + firstLbl : ''))
    : (fr ? 'Tes talons importés' : 'Your imported stubs');

  const depositsSvg = _payDepositsSvg(infos, fr, money);
  const sparkSvg = _paySparkSvg(infos, fr, money);
  let body = '';
  if (depositsSvg) {
    body += '<p class="chart-title">' + (fr ? 'Dépôt net par période ($)' : 'Net deposit per period ($)') + '</p>' + depositsSvg;
    const otItems = infos.filter(i => i.ot != null && i.dep != null);
    body += '<div class="hist-legend">' +
      (infos.some(i => i.isCur && i.dep != null) ? '<span class="item"><span class="sw sw-cur"></span>' + (fr ? 'Période courante' : 'Current period') + '</span>' : '') +
      '<span class="item"><span class="sw sw-past"></span>' + (fr ? 'Périodes précédentes' : 'Previous periods') + '</span>' +
      (otItems.length ? '<span class="item"><span class="sw sw-ts"></span><span class="num">' + (fr ? 'Temps supp. (' : 'Overtime (') + otItems.map(i => esc(i.short) + C + ' ' + money(i.ot)).join(' · ') + ')</span></span>' : '') +
      '</div>';
  } else {
    body += '<p class="tbl-note">' + (fr ? 'Aucun dépôt lisible sur les talons stockés.' : 'No readable deposit on the stored stubs.') + '</p>';
  }
  if (sparkSvg) body += '<p class="chart-title">' + (fr ? 'Per diem payé par période ($)' : 'Per diem paid per period ($)') + '</p>' + sparkSvg;

  // Shared data table for both charts (each SVG's accessible data source).
  const dataRows = infos.slice().reverse().map(it =>
    '<tr' + (it.isCur ? ' class="row-active"' : '') + '><td class="num">' + _payDayLabel(it.dmy, fr, false, true) + '</td>' +
    '<td class="r num">' + (it.dep != null ? money(it.dep) : DASH) + '</td>' +
    '<td class="r num">' + (it.pdAmt != null ? money(it.pdAmt) : DASH) + '</td>' +
    '<td class="r num">' + (it.ot != null ? money(it.ot) : DASH) + '</td></tr>').join('');
  body += '<details class="fold"><summary>' + _payChev() + (fr ? 'Données des graphiques' + C + ' dépôts et per diem' : 'Chart data: deposits and per diem') + '</summary>' +
    '<div class="fold-body tbl-wrap"><table><thead><tr><th>' + (fr ? 'Période' : 'Period') + '</th><th class="r">' + (fr ? 'Dépôt net' : 'Net deposit') + '</th><th class="r">Per diem</th><th class="r">' + (fr ? 'Temps supp.' : 'Overtime') + '</th></tr></thead><tbody>' +
    dataRows + '</tbody></table></div></details>';

  // Chronological statement (mockup fold "Relevé des périodes").
  let rel = '', lastMonth = '';
  infos.slice().reverse().forEach(it => {   // newest first
    const mKey = it.dmy ? (it.dmy.y + '-' + it.dmy.m) : '';
    if (mKey !== lastMonth) {
      lastMonth = mKey;
      const ml = it.dmy ? ((fr ? _PAY_MO_FR : _PAY_MO_EN)[it.dmy.m - 1] + ' ' + it.dmy.y) : (fr ? 'Autres' : 'Other');
      rel += '<div class="month-label">' + (ml.charAt(0).toUpperCase() + ml.slice(1)) + '</div>';
    }
    const badges = [];
    if (it.isCur) badges.push('<span class="pill-now">' + (fr ? 'Courante' : 'Current') + '</span>');
    if (it.ot != null) badges.push('<span class="badge badge-neutral num">' + (fr ? 'Temps supp. ' : 'Overtime ') + money(it.ot) + '</span>');
    if (it.status === 'issue') {
      const nIss = (it.isCur && cur && cur.issues) ? cur.issues : 0;
      badges.push('<span class="badge badge-issue"><span class="bdot"></span>' +
        (nIss ? nIss + ' ' + (fr ? 'problème' + (nIss > 1 ? 's' : '') : 'issue' + (nIss > 1 ? 's' : '')) : (fr ? 'Écart per diem' : 'Per diem gap')) + '</span>');
    } else if (it.status === 'ok') {
      badges.push('<span class="badge badge-ok"><span class="bdot"></span>' + (fr ? 'Vérifié' : 'Verified') + '</span>');
    } else {
      badges.push('<span class="badge badge-neutral">' + (fr ? 'Non comparé' : 'Not compared') + '</span>');
    }
    const dLbl = _payDayLabel(it.dmy, fr, false, false) +
      (it.range ? ' (' + (fr ? 'période du ' + _payRangeTxt(it.range, fr, false, true) : _payRangeTxt(it.range, fr, false, false) + ' period') + ')' : '');
    const rLbl = (it.isCur && it.stub.deposit)
      ? '<span class="r">' + (fr ? 'Dépôt reçu le ' : 'Deposit received ') + _payDayLabel(_payDMY(it.stub.deposit), fr, false, true) + '</span>'
      : '';
    rel += '<div class="prow' + (it.status === 'issue' ? ' bad' : '') + (it.isCur && it.status === 'issue' ? ' current' : '') + '">' +
      '<span class="pw"><span class="d num">' + dLbl + '</span>' + rLbl + '</span>' +
      '<span class="p-badges">' + badges.join('') + '</span>' +
      '<span class="pa num">' + (it.dep != null ? money(it.dep) : DASH) + '</span></div>';
  });
  body += '<details class="fold"><summary>' + _payChev() + (fr ? 'Relevé des périodes' : 'Period statement') + '</summary>' +
    '<div class="fold-body"><div class="releve">' + rel + '</div></div></details>';

  return '<div class="section-head"><span class="microlabel">' + kicker + '</span><h2>' + h2 + '</h2></div>' +
    '<section class="v2-card">' + body + '</section>';
}

// Node test harness export (ignored in the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { groupPairings, pairingPerDiem, computePerDiem, computeCredits, computeBasePay, isSummerLOA, payRateForYear, deriveUsFx, usPerDiemDays, _payMonthPairingLegs, computePerDiemInPeriod, _payLocalMidnightMs, _payNextDay };
}
