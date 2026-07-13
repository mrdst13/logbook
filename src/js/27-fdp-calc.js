// ═══════════════════════════════════════════
//  DAILY MAXIMUM FLIGHT DUTY PERIOD CALCULATOR (page-duty)
//  Mirrors the "Max Duty" app: report time + number of flights + average flight
//  duration + split + time-zone (acclimatization) → maximum FDP.
//
//  The numbers below are the RAC 700.28 table, VERIFIED cell-for-cell against
//  laws-lois (SOR/96-433, current to 2026-05-26) by two independent adversarial
//  passes and consigned to docs/REGISTRE-REGLEMENTAIRE.md (2026-07-13). Split
//  extension = RAC 700.50; absolute ceiling 18 h = RAC 700.62. NEVER edit these
//  numbers from memory — update the register first (see the guard).
// ═══════════════════════════════════════════

// 700.28 max-FDP hours by acclimatized start-time band. The three columns' HOUR
// values are IDENTICAL across the three average-flight-duration tables
// (700.28(2)/(3)/(4)); only the flight-count column thresholds differ (FDP_COLS).
const FDP_ROWS = [
  { s: 0,    e: 239,  h: [9, 9, 9] },
  { s: 240,  e: 299,  h: [10, 9, 9] },
  { s: 300,  e: 359,  h: [11, 10, 9] },
  { s: 360,  e: 419,  h: [12, 11, 10] },
  { s: 420,  e: 779,  h: [13, 12, 11] },
  { s: 780,  e: 1019, h: [12.5, 11.5, 10.5] },
  { s: 1020, e: 1319, h: [12, 11, 10] },
  { s: 1320, e: 1379, h: [11, 10, 9] },
  { s: 1380, e: 1439, h: [10, 9, 9] }
];
// Flight-count column thresholds per average-flight-duration band.
const FDP_COLS = { lt30: [11, 17], '30to50': [7, 11], ge50: [4, 6] };
// Places we fly to (ANY zone — not tied to any base): Canada + US + Mexico.
const FDP_CITIES = [
  { n: "St. John's",      tz: 'America/St_Johns' },
  { n: 'Halifax',         tz: 'America/Halifax' },
  { n: 'Ottawa',          tz: 'America/Toronto' },
  { n: 'Montréal',        tz: 'America/Toronto' },
  { n: 'Toronto',         tz: 'America/Toronto' },
  { n: 'Boston',          tz: 'America/New_York' },
  { n: 'New York',        tz: 'America/New_York' },
  { n: 'Winnipeg',        tz: 'America/Winnipeg' },
  { n: 'Chicago',         tz: 'America/Chicago' },
  { n: 'Cancún',          tz: 'America/Cancun' },
  { n: 'Calgary',         tz: 'America/Edmonton' },
  { n: 'Puerto Vallarta', tz: 'America/Bahia_Banderas' },
  { n: 'Vancouver',       tz: 'America/Vancouver' }
];

// Current signed UTC offset (minutes) for an IANA zone — DST-aware via Intl.
function _fdpOffMin(tz) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date());
    const v = (p.find(x => x.type === 'timeZoneName') || {}).value || 'GMT+0';
    const m = v.match(/GMT([+-]?)(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * ((+m[2]) * 60 + (+(m[3] || 0)));
  } catch (e) { return 0; }
}
function _fdpOffLabel(mins) {
  const sign = mins < 0 ? '−' : '+';   // U+2212 minus
  const a = Math.abs(mins), h = Math.floor(a / 60), mm = a % 60;
  return 'UTC' + sign + h + (mm ? (':' + String(mm).padStart(2, '0')) : '');
}
function _fdpHM(dec) { const t = Math.round(dec * 60); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
function _fdpClock(m) { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function _fdpColIndex(band, flights) {
  if (band === 'vfr') return 0;                     // 700.28(9) single column = column-2 values
  const th = FDP_COLS[band]; return flights <= th[0] ? 0 : (flights <= th[1] ? 1 : 2);
}
function _fdpRowLabel(row) { return _fdpClock(row.s) + '–' + _fdpClock(row.e); }
function _fdpColLabel(band, col, fr) {
  const th = FDP_COLS[band];
  const ranges = ['1–' + th[0], (th[0] + 1) + '–' + th[1], (th[1] + 1) + '+'];
  return ranges[col] + ' ' + (fr ? 'vols' : 'flights');
}

// Read the inputs, compute the max FDP, and paint the result. Called on page
// entry (router), on any input change, and on language switch (setLang).
function fdpCompute() {
  const g = id => document.getElementById(id);
  if (!g('fdp-report')) return;                     // page not present
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const T = (typeof t === 'function') ? t : ((k, v) => k);

  const repVal = (g('fdp-report').value || '').trim();
  const rep = repVal.split(':');
  const reportMin = (+rep[0]) * 60 + (+rep[1]);
  // Blank / unparseable report time → show nothing, not a number derived from a
  // missing input. A certifiable tool must never hand out a false maximum.
  if (!/^\d{1,2}:\d{2}$/.test(repVal) || isNaN(reportMin)) {
    g('fdp-out').textContent = '—';
    g('fdp-end').textContent = '—';
    if (g('fdp-conv')) g('fdp-conv').textContent = '';
    if (g('fdp-cell')) g('fdp-cell').textContent = '';
    if (g('fdp-splitInfo')) g('fdp-splitInfo').style.display = 'none';
    const dt = g('fdp-split-detail'); if (dt) dt.style.display = g('fdp-split').checked ? 'grid' : 'none';
    return;
  }
  const st = FDP_CITIES[+g('fdp-station').value] || FDP_CITIES[0];
  const ac = FDP_CITIES[+g('fdp-acclim').value] || st;
  const stOff = _fdpOffMin(st.tz), acOff = _fdpOffMin(ac.tz);
  // Report time expressed at the acclimatization location (RAC 700.19(2)) —
  // that is the time the 700.28 start-time row is read against.
  const acclimMin = ((reportMin + (acOff - stOff)) % 1440 + 1440) % 1440;
  const row = FDP_ROWS.find(r => acclimMin >= r.s && acclimMin <= r.e) || FDP_ROWS[0];
  const band = g('fdp-dur').value;
  const legs = Math.max(1, parseInt(g('fdp-legs').value, 10) || 1);
  const col = _fdpColIndex(band, legs);
  const baseH = row.h[col];

  // Split (RAC 700.50): break of >=60 min, reduced by 45 min, then 100% (night
  // 24:00-05:59) or 50% (day) of the remainder is added to the max FDP.
  let ext = 0, extNote = '';
  const split = g('fdp-split').checked;
  const detail = g('fdp-split-detail');
  if (detail) detail.style.display = split ? 'grid' : 'none';
  if (split) {
    const brk = Math.max(0, parseInt(g('fdp-brk').value, 10) || 0);
    const night = g('fdp-night').checked;
    // RAC 700.50: the break must be AT LEAST 60 consecutive minutes to qualify.
    // Below 60 min there is NO extension — never over-state the maximum.
    const credit = brk >= 60 ? Math.max(0, brk - 45) : 0;
    ext = credit * (night ? 1 : 0.5) / 60;
    extNote = brk < 60
      ? T('fdp.splitTooShort')
      : T('fdp.splitInfo', {
          brk: brk, credit: credit,
          pct: night ? (fr ? '100 % (nuit)' : '100% (night)') : (fr ? '50 % (jour)' : '50% (day)'),
          ext: _fdpHM(ext)
        });
  }
  let total = baseH + ext, capped = false;
  if (total > 18) { total = 18; capped = true; }    // RAC 700.62 absolute ceiling

  g('fdp-out').textContent = _fdpHM(total);
  g('fdp-end').textContent = _fdpClock(reportMin + total * 60) + ' (' + st.n + ')';

  const conv = g('fdp-conv');
  if (conv) {
    conv.textContent = (stOff !== acOff)
      ? T('fdp.conv', { a: _fdpClock(reportMin), sa: st.n, b: _fdpClock(acclimMin), sb: ac.n })
      : T('fdp.convSame', { a: _fdpClock(reportMin) });
  }

  const bandName = band === 'vfr'
    ? (fr ? 'VFR de jour · 700.28(9)' : 'day VFR · 700.28(9)')
    : ((fr ? 'durée ' : 'avg ') + (band === 'lt30' ? '< 30 min · 700.28(2)' : band === '30to50' ? '30–50 min · 700.28(3)' : '≥ 50 min · 700.28(4)'));
  const colName = band === 'vfr' ? (fr ? 'colonne unique' : 'single column') : _fdpColLabel(band, col, fr);
  const cell = g('fdp-cell');
  if (cell) cell.textContent = T('fdp.cell', { row: _fdpRowLabel(row), col: colName, band: bandName, h: _fdpHM(baseH) }) + (capped ? T('fdp.capped') : '');

  const si = g('fdp-splitInfo');
  if (si) { si.style.display = split ? 'block' : 'none'; if (split) si.textContent = extNote; }
}

// Populate the two location selects (once), wire listeners, run first compute.
// Called by the router each time the Duty page is shown.
function initFdpCalc() {
  const stSel = document.getElementById('fdp-station');
  const acSel = document.getElementById('fdp-acclim');
  if (!stSel || !acSel) return;
  if (!stSel.options.length) {
    FDP_CITIES.forEach((c, i) => {
      const lbl = c.n + ' (' + _fdpOffLabel(_fdpOffMin(c.tz)) + ')';
      const o1 = document.createElement('option'); o1.value = i; o1.textContent = lbl; stSel.appendChild(o1);
      const o2 = document.createElement('option'); o2.value = i; o2.textContent = lbl; acSel.appendChild(o2);
    });
    stSel.value = 4; acSel.value = 4;   // default: Toronto / Toronto — same zone, no conversion (normal case)
  }
  ['fdp-report', 'fdp-station', 'fdp-acclim', 'fdp-dur', 'fdp-legs', 'fdp-brk'].forEach(id => {
    const el = document.getElementById(id); if (el) { el.oninput = fdpCompute; el.onchange = fdpCompute; }
  });
  ['fdp-split', 'fdp-night'].forEach(id => { const el = document.getElementById(id); if (el) el.onchange = fdpCompute; });
  fdpCompute();
}
