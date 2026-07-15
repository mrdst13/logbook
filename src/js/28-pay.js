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
// Values are from the PUBLISHED ALPA E195 F/O scale (not confidential, earned by
// every pilot at that seat year) — never a guessed number, no pilot's name here.
// Year 3 = 2025 scale $119.00 × 1.015 (Jan-2026 +1.5%) = $120.79. Other years are
// intentionally absent until the full published scale is added (an unmapped year
// fills nothing, so a pilot with no scale set sees an empty rate — defaults empty).
const E195_FO_RATES = { 3: 120.79 };
function payRateForYear(year) { const y = +year; return E195_FO_RATES[y] || 0; }

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
  const months = _payMonths(all);
  const prev = sel.value;
  sel.innerHTML = months.length ? months.map(m => `<option value="${m}">${m}</option>`).join('') : '<option value="">—</option>';
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

function payRender() {
  const host = document.getElementById('pay-computed');
  if (!host) return;
  if (typeof payStubInitDropzone === 'function') payStubInitDropzone();   // (re)wire the PDF drop zone
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const T = (typeof t === 'function') ? t : (k => k);
  const st = loadPaySettings();
  const sel = document.getElementById('pay-period');
  const ym = sel ? sel.value : '';
  const allFls = (typeof flights !== 'undefined' ? flights : []);
  const fls = allFls.filter(f => f.date && f.date.slice(0, 7) === ym);
  // Sign OUTSIDE the $ so a shortfall reads "-$31.00", not "$-31.00".
  const money = n => { const v = Math.round((+n || 0) * 100) / 100; return (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString(fr ? 'fr-CA' : 'en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const h1 = n => (Math.round((+n || 0) * 10) / 10);
  const fx4 = n => (Math.round((+n || 0) * 10000) / 10000).toLocaleString(fr ? 'fr-CA' : 'en-CA', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

  // Paid side = the parsed pay stub (read from the dropped PDF, never typed).
  const parsed = (typeof loadParsedStub === 'function') ? loadParsedStub(ym) : null;
  const bk = (parsed && typeof payStubBuckets === 'function') ? payStubBuckets(parsed) : null;
  const stub = bk ? {
    perDiemCdn: bk.perDiemCdn ? bk.perDiemCdn.amount : null,
    perDiemUs: bk.perDiemUs ? bk.perDiemUs.amount : null,   // null stays null (never assert $0.00) — matches the CDN row
    regular: bk.regular ? bk.regular.amount : null,
    ot: bk.overtime ? bk.overtime.amount : null
  } : {};
  const has = k => stub[k] != null && stub[k] !== '';

  if (!ym) { host.innerHTML = `<p class="fdp-foot">${fr ? 'Choisis un mois, ou dépose ton talon PDF ci-dessus.' : 'Pick a month, or drop your pay PDF above.'}</p>`; return; }

  // Header for the parsed stub (or a nudge to drop one).
  const stubHead = parsed
    ? `<div class="pay-stubhead"><div><b>${fr ? 'Talon' : 'Stub'} ${parsed.period || ''}</b>${parsed.position ? ' · ' + parsed.position : ''}</div>` +
      `<div style="color:var(--text-muted)">${parsed.deposit ? (fr ? 'Dépôt ' : 'Deposit ') + parsed.deposit : ''}${parsed.totalDeposit != null ? ' · ' + (fr ? 'total ' : 'total ') + money(parsed.totalDeposit) : ''}` +
      ` · <a href="#" onclick="if(typeof clearParsedStub==='function'){clearParsedStub('${ym}');} payRender(); return false;">${fr ? 'retirer' : 'remove'}</a></div></div>`
    : `<p class="fdp-cell" style="color:var(--text-muted)">${fr ? 'Dépose ton talon Porter (PDF) ci-dessus — l’app le lit et compare à ton horaire. Rien n’est tapé, rien n’est téléversé.' : 'Drop your Porter pay PDF above — the app reads it and compares to your roster. Nothing typed, nothing uploaded.'}</p>`;

  // Honest safeguard: if the parsed line amounts don't sum to the stub's own
  // "Earnings This Period", a figure was mis-read — warn, never present it as sound.
  const checksumWarn = (parsed && parsed.checksum && !parsed.checksum.ok)
    ? `<p class="fdp-cell" style="color:var(--danger);font-weight:600;margin-top:8px">${fr
      ? 'Lecture à vérifier : les montants lus totalisent ' + money(parsed.checksum.got) + ' mais le talon indique ' + money(parsed.checksum.expected) + ' (« Earnings This Period »). Un montant a pu être mal lu — vérifie le détail avant de t’y fier.'
      : 'Read to verify: parsed amounts total ' + money(parsed.checksum.got) + ' but the stub says ' + money(parsed.checksum.expected) + ' (“Earnings This Period”). A figure may be mis-read — check the detail before relying on it.'}</p>`
    : '';

  // Analysis needs logged flights for the computed side.
  if (!fls.length) {
    host.innerHTML = stubHead + checksumWarn + `<p class="fdp-foot" style="margin-top:10px">${fr ? 'Aucun vol enregistré ce mois pour comparer — synchronise ou importe ton horaire.' : 'No flights logged this month to compare — sync or import your roster.'}</p>` + payStubBreakdown(parsed, fr, money);
    return;
  }

  // Per diem uses WHOLE pairings assigned to this month (keeps month-straddling
  // US layovers intact); daily credits stay per calendar day. (review 2026-07-14)
  const pdLegs = _payMonthPairingLegs(allFls, st.base, ym);
  const pd = computePerDiem(pdLegs, st.base, { cdn: st.cdn, usUsd: st.usUsd, fx: 1 });   // fx=1: US $ DERIVED from the stub below
  const cr = computeCredits(fls);
  const inLoa = /^2026-(06|07|08)/.test(ym);
  const bp = computeBasePay(cr.creditHours, { rate: st.rate, mmg: st.mmg, otThreshold: st.otThreshold, otMult: inLoa ? 2.0 : 1.5 });

  const paidCell = k => has(k) ? money(stub[k]) : '<span style="color:var(--text-muted)">—</span>';
  // v1: the stub is semi-monthly but "Computed" is a full calendar month, so a
  // dollar diff would be a false alarm. Show the two side by side as reference
  // (no red diff) until Martin gives his pay-period dates; then we scope the
  // roster to the exact period and flag real per-diem/hour gaps. (2026-07-15)
  const usDays = usPerDiemDays(pdLegs, st.base);
  const row = (label, computed, key) =>
    `<tr><td>${label}</td><td class="pay-num" style="color:var(--text-muted)">${money(computed)}</td><td class="pay-num">${paidCell(key)}</td></tr>`;

  const loaNote = inLoa ? (fr ? ' · LOA été 2,0×' : ' · summer LOA 2.0×') : '';
  const usDaysHtml = usDays.length
    ? `<p class="fdp-cell" style="color:var(--text-muted);margin-top:2px">${fr ? 'Jours US (horaire)' : 'US days (roster)'}: ${usDays.map(d => `${d.icao} ${d.date} (${h1(d.hours)} h)`).join(' · ')}</p>` : '';
  const periodAsk = `<p class="fdp-cell" style="color:var(--text-muted)">${fr
    ? '« Calculé » couvre le mois civil complet, mais ton talon Porter est semi-mensuel — donc pas de comparaison $ directe pour l’instant. Donne-moi les dates exactes de tes périodes de paie et je compare à l’heure près (per diems, crédits) pour faire ressortir les vraies erreurs.'
    : '“Computed” is a full calendar month, but your Porter stub is semi-monthly — so no direct $ comparison yet. Give me your exact pay-period dates and I’ll compare to the hour (per diems, credits) to surface real errors.'}</p>`;
  const rateWarn = !st.rate ? (fr ? ' · ⚠ choisis ton année d’échelon ou entre ton taux' : ' · ⚠ pick your seat year or enter your rate') : '';
  const rateChk = (rateOk, paid, expected, label) =>
    `<span>${label}: <b>${money(paid)}</b> · ${fr ? 'attendu' : 'expected'} ${money(expected)} ${rateOk ? '<span style="color:var(--success)">✓</span>' : '<span style="color:var(--danger)">' + (fr ? '≠ vérifie' : '≠ check') + '</span>'}</span>`;
  const checks = [];
  if (parsed && bk.regular && bk.regular.rate != null && st.rate) checks.push(rateChk(Math.abs(bk.regular.rate - st.rate) < 0.005, bk.regular.rate, st.rate, fr ? 'Taux horaire' : 'Hourly rate'));
  if (parsed && bk.perDiemCdn && bk.perDiemCdn.rate != null) checks.push(rateChk(Math.abs(bk.perDiemCdn.rate - st.cdn) < 0.005, bk.perDiemCdn.rate, st.cdn, fr ? 'Taux per diem CDN' : 'CDN per diem rate'));
  const rateCheck = checks.length ? `<p class="fdp-cell" style="color:var(--text-muted)">${checks.join(' &nbsp;·&nbsp; ')}</p>` : '';

  host.innerHTML = stubHead + checksumWarn + `
    <table class="pay-table" style="margin-top:10px">
      <thead><tr><th>${fr ? 'Élément' : 'Item'}</th><th style="text-align:right">${fr ? 'Calculé (mois)' : 'Computed (month)'}</th><th style="text-align:right">${fr ? 'Payé (talon)' : 'Paid (stub)'}</th></tr></thead>
      <tbody>
        ${row('Per diem CDN · ' + h1(pd.cdnHours) + ' h', pd.cdnAmount, 'perDiemCdn')}
        <tr><td>Per diem US · ${h1(pd.usHours)} h</td><td class="pay-num" style="color:var(--text-muted)">—</td><td class="pay-num">${paidCell('perDiemUs')}</td></tr>
        ${row((fr ? 'Paie de base · ' : 'Base pay · ') + bp.straightHours + ' h', bp.straightAmount, 'regular')}
        ${row((fr ? 'Temps supp. · ' : 'Overtime · ') + bp.otHours + ' h ×' + bp.otMult + loaNote, bp.otAmount, 'ot')}
      </tbody>
    </table>
    ${usDaysHtml}${rateCheck}${periodAsk}
    <p class="fdp-cell" style="color:var(--text-muted)">${fr ? 'Crédits du mois' : 'Month credits'}: <b>${cr.creditHours} h</b> · ${fr ? 'garantie' : 'guarantee'} ${st.mmg} h${bp.guaranteeApplied ? (fr ? ' (appliquée)' : ' (applied)') : ''} · ${pd.pairings} pairing(s) · ${fr ? 'temps loin base' : 'time away'} ${h1(pd.awayHours)} h${rateWarn}</p>
    ${payStubBreakdown(parsed, fr, money)}`;
}

// Collapsible full breakdown of the parsed stub (every earning line, read-only).
function payStubBreakdown(parsed, fr, money) {
  if (!parsed || !parsed.earnings || !parsed.earnings.length) return '';
  const rows = parsed.earnings.map(e => {
    const val = e.amount != null ? money(e.amount) : (e.ytd != null ? '<span style="color:var(--text-muted)">' + (fr ? 'cumul. ' : 'YTD ') + money(e.ytd) + '</span>' : '');
    return `<tr><td style="color:var(--text-muted)">${e.code}</td><td>${e.label || ''}</td><td class="pay-num">${val}</td></tr>`;
  }).join('');
  return `<details class="pay-details" style="margin-top:12px"><summary style="cursor:pointer;color:var(--text-muted)">${fr ? 'Détail du talon lu' : 'Parsed stub detail'}</summary>` +
    `<table class="pay-table" style="margin-top:8px"><tbody>${rows}</tbody></table></details>`;
}

// Node test harness export (ignored in the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { groupPairings, pairingPerDiem, computePerDiem, computeCredits, computeBasePay, isSummerLOA, payRateForYear, deriveUsFx, usPerDiemDays, _payMonthPairingLegs };
}
