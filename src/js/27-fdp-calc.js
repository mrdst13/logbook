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
function _fdpRowLabel(row) { return _fdpClock(row.s) + ' – ' + _fdpClock(row.e); }
// Duration display per the approved mockups (duty-final.html): "13 h" and
// "12 h 30" (never "12,5"); the hero result always carries minutes ("13 h 00").
// NBSP keeps the unit glued to the number. Same notation FR and EN.
function _fdpHLabel(dec, forceMin) {
  const t = Math.round((+dec || 0) * 60);
  const h = Math.floor(t / 60), m = t % 60;
  return (forceMin || m) ? (h + ' h ' + String(m).padStart(2, '0')) : (h + ' h');
}
// Flight-count column label per the mockups: "1 à 4 vols" · "5 ou 6 vols" ·
// "7 vols ou plus" (EN: "1 to 4 flights" · "5 or 6 flights" · "7 flights or more").
function _fdpColRange(band, col, fr) {
  const th = FDP_COLS[band];
  const lo = [1, th[0] + 1, th[1] + 1][col];
  const hi = [th[0], th[1], null][col];
  if (hi === null) return fr ? (lo + ' vols ou plus') : (lo + ' flights or more');
  if (lo === hi) return fr ? (lo + ' vol' + (lo > 1 ? 's' : '')) : (lo + ' flight' + (lo > 1 ? 's' : ''));
  if (hi === lo + 1) return fr ? (lo + ' ou ' + hi + ' vols') : (lo + ' or ' + hi + ' flights');
  return fr ? (lo + ' à ' + hi + ' vols') : (lo + ' to ' + hi + ' flights');
}
// Average-flight-duration wording used in the result breakdown line.
function _fdpBandLabel(band, fr) {
  if (band === 'vfr') return fr ? 'VFR de jour' : 'day VFR';
  if (band === 'lt30') return fr ? 'vols de moins de 30 min' : 'flights under 30 min';
  if (band === '30to50') return fr ? 'vols de 30 à moins de 50 min' : 'flights 30 to under 50 min';
  return fr ? 'vols de 50 min et plus' : 'flights 50 min and more';
}

// Read the inputs, compute the max FDP, and paint the result. Called on page
// entry (router), on any input change, and on language switch (setLang).
function fdpCompute() {
  const g = id => document.getElementById(id);
  if (!g('fdp-report-h')) return;                    // page not present
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const T = (typeof t === 'function') ? t : ((k, v) => k);

  // Report time comes from two selects (hour + minute) — reliable on every
  // browser, unlike the native <input type=time> picker that misbehaved on
  // desktop. Both always carry a valid value, so there is no blank case.
  const reportMin = (parseInt(g('fdp-report-h').value, 10) || 0) * 60 + (parseInt(g('fdp-report-m').value, 10) || 0);
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

  g('fdp-out').textContent = _fdpHLabel(total, true);
  g('fdp-end').textContent = _fdpClock(reportMin + total * 60);
  const endTz = g('fdp-end-tz');
  if (endTz) endTz.textContent = fr ? (', heure de ' + st.n) : (', ' + st.n + ' time');

  const conv = g('fdp-conv');
  if (conv) {
    conv.textContent = (stOff !== acOff)
      ? T('fdp.conv', { a: _fdpClock(reportMin), sa: st.n, b: _fdpClock(acclimMin), sb: ac.n })
      : T('fdp.convSame', { a: _fdpClock(reportMin) });
  }

  // Breakdown line, mockup copy: "Présentation entre 07:00 et 12:59 · 1 à 4
  // vols · vols de 50 min et plus → 13 h" (same shape in EN).
  const rowPart = fr
    ? 'Présentation entre ' + _fdpClock(row.s) + ' et ' + _fdpClock(row.e)
    : 'Report between ' + _fdpClock(row.s) + ' and ' + _fdpClock(row.e);
  const parts = [rowPart];
  if (band !== 'vfr') parts.push(_fdpColRange(band, col, fr));
  parts.push(_fdpBandLabel(band, fr));
  const cell = g('fdp-cell');
  if (cell) cell.textContent = parts.join(' · ') + ' → ' + _fdpHLabel(baseH) + (capped ? T('fdp.capped') : '');

  const si = g('fdp-splitInfo');
  if (si) { si.style.display = split ? 'block' : 'none'; if (split) si.textContent = extNote; }

  _fdpRenderBand(reportMin, total, st, fr);
  _fdpRenderRefTable(band, row, col, acclimMin, fr);
}

// ─── 24 h duty-window band (spec: duty-final.html §3, svg.w-band) ────────────
// Pale flat window (--v2-accent-band) with dark text over it; the area beyond
// the permitted end is a pale amber flat. No gradient, no shadow, no hatching.
// Every value shown derives from the calculator inputs above.
function _fdpRenderBand(reportMin, totalH, st, fr) {
  const host = document.getElementById('dutyDayChart');
  if (!host) return;
  const X0 = 36, XW = 664, X1 = X0 + XW;
  const xOf = m => X0 + (Math.max(0, Math.min(1440, m)) / 1440) * XW;
  const r1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const endAbs = reportMin + Math.round(totalH * 60);
  const wraps = endAbs > 1440;
  const endMin = ((endAbs % 1440) + 1440) % 1440;
  const durLabel = _fdpHLabel(totalH);
  const repClock = _fdpClock(reportMin), endClock = _fdpClock(endAbs);
  const city = esc(st.n);

  // Window segments (square, clipped by the rounded track) + amber "beyond".
  let winRects, amberRect, labelCx, labelW;
  if (!wraps) {
    winRects = '<rect x="' + r1(xOf(reportMin)) + '" y="46" width="' + r1(xOf(endAbs) - xOf(reportMin)) + '" height="16" fill="var(--v2-accent-band)"/>';
    amberRect = '<rect x="' + r1(xOf(endAbs)) + '" y="46" width="' + r1(X1 - xOf(endAbs)) + '" height="16" fill="var(--v2-warning)" fill-opacity=".12"/>';
    labelCx = (xOf(reportMin) + xOf(endAbs)) / 2; labelW = xOf(endAbs) - xOf(reportMin);
  } else {
    winRects = '<rect x="' + r1(xOf(reportMin)) + '" y="46" width="' + r1(X1 - xOf(reportMin)) + '" height="16" fill="var(--v2-accent-band)"/>' +
      '<rect x="' + X0 + '" y="46" width="' + r1(xOf(endMin) - X0) + '" height="16" fill="var(--v2-accent-band)"/>';
    amberRect = '<rect x="' + r1(xOf(endMin)) + '" y="46" width="' + r1(Math.max(0, xOf(reportMin) - xOf(endMin))) + '" height="16" fill="var(--v2-warning)" fill-opacity=".12"/>';
    const seg1 = X1 - xOf(reportMin), seg2 = xOf(endMin) - X0;
    if (seg1 >= seg2) { labelCx = (xOf(reportMin) + X1) / 2; labelW = seg1; }
    else { labelCx = (X0 + xOf(endMin)) / 2; labelW = seg2; }
  }
  const winLabel = labelW > 120
    ? '<text x="' + r1(labelCx) + '" y="58" font-size="12" font-weight="600" fill="var(--v2-ink-strong)" text-anchor="middle">' + durLabel + (fr ? ' de service max' : ' max duty') + '</text>'
    : '';

  const repX = xOf(reportMin), endX = xOf(endMin === 0 && wraps === false ? endAbs : (wraps ? endMin : endAbs));
  const repAnchor = repX > 540 ? 'end' : 'start';
  const endAnchor = endX < 180 ? 'start' : 'end';

  let ticks = '', axis = '';
  for (let hh = 0; hh <= 24; hh += 6) {
    const x = r1(xOf(hh * 60));
    ticks += '<line x1="' + x + '" y1="36" x2="' + x + '" y2="72"/>';
    axis += '<text x="' + x + '" y="90">' + String(hh % 24 === hh ? hh : 24).padStart(2, '0') + ':00</text>';
  }

  const ariaDur = durLabel.replace(/ /g, ' ');
  const aria = fr
    ? 'Bande de 24 heures : présentation à ' + repClock + ', service de vol maximal de ' + ariaDur + ', fin de service au plus tard à ' + endClock + ', heure de ' + city + '.'
    : '24-hour band: report at ' + repClock + ', maximum flight duty of ' + ariaDur + ', latest end of duty at ' + endClock + ', ' + city + ' time.';

  const chev = '<svg class="chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  host.innerHTML =
    '<p class="chart-title">' + (fr ? 'Ta journée : fenêtre de service maximale' : 'Your day: maximum duty window') + '</p>' +
    '<div class="chart-wrap">' +
    '<svg class="w-band" viewBox="0 0 720 100" role="img" aria-label="' + esc(aria) + '">' +
    '<title>' + (fr ? 'Journée de 24 heures, de la présentation à la fin de service' : '24-hour day, from report to end of duty') + '</title>' +
    '<defs><clipPath id="fdpBandClip"><rect x="36" y="46" width="664" height="16" rx="8"/></clipPath></defs>' +
    '<g stroke="var(--v2-hair)" stroke-width="1">' + ticks + '</g>' +
    '<rect x="36" y="46" width="664" height="16" rx="8" fill="var(--v2-track)"/>' +
    '<g clip-path="url(#fdpBandClip)">' + amberRect + winRects + '</g>' +
    winLabel +
    '<line x1="' + r1(repX) + '" y1="34" x2="' + r1(repX) + '" y2="70" stroke="var(--v2-ink-strong)" stroke-width="1.5"/>' +
    '<text x="' + r1(repX) + '" y="26" font-size="11.5" font-weight="600" fill="var(--v2-ink-strong)" text-anchor="' + repAnchor + '">' + (fr ? 'Présentation ' : 'Report ') + repClock + '</text>' +
    '<line x1="' + r1(endX) + '" y1="34" x2="' + r1(endX) + '" y2="70" stroke="var(--v2-warning)" stroke-width="1.5"/>' +
    '<text x="' + r1(endX) + '" y="26" font-size="11.5" font-weight="600" fill="var(--v2-warning-ink)" text-anchor="' + endAnchor + '">' + (fr ? 'Fin au plus tard ' : 'Latest end ') + endClock + '</text>' +
    '<g font-size="10" fill="var(--v2-muted)" text-anchor="middle">' + axis + '</g>' +
    '</svg></div>' +
    '<details class="fold"><summary>' + chev + (fr ? 'Données du graphique : fenêtre de service' : 'Chart data: duty window') + '</summary>' +
    '<div class="fold-body tbl-wrap"><table>' +
    '<tbody>' +
    '<tr><th scope="row">' + (fr ? 'Présentation' : 'Report') + '</th><td class="r num">' + repClock + '</td></tr>' +
    '<tr><th scope="row">' + (fr ? 'Service de vol maximum' : 'Maximum flight duty period') + '</th><td class="r num">' + durLabel + '</td></tr>' +
    '<tr><th scope="row">' + (fr ? 'Fin de service au plus tard' : 'Latest end of duty') + '</th><td class="r num">' + endClock + (fr ? ', heure de ' : ', ') + city + (fr ? '' : ' time') + '</td></tr>' +
    '</tbody></table></div></details>';
}

// ─── Reference table (spec: duty-final.html §5) ──────────────────────────────
// Built from FDP_ROWS/FDP_COLS (the register-verified single source of truth)
// with the active row and column highlighted. Units in every cell: "13 h",
// "12 h 30" (never a decimal).
function _fdpRenderRefTable(band, row, col, acclimMin, fr) {
  const tbl = document.getElementById('dutyRefTable');
  const note = document.getElementById('dutyRefNote');
  if (!tbl) return;
  const single = band === 'vfr';
  const cols = single ? [0] : [0, 1, 2];
  const heads = single
    ? [fr ? 'VFR de jour' : 'Day VFR']
    : cols.map(c => _fdpColRange(band, c, fr));
  const activeCol = single ? 0 : col;

  let html = '<table><thead><tr><th>' + (fr ? 'Présentation (heure acclimatée)' : 'Report (acclimatized time)') + '</th>';
  heads.forEach((h, c) => { html += '<th class="r' + (c === activeCol ? ' active-col' : '') + '">' + h + '</th>'; });
  html += '</tr></thead><tbody>';
  FDP_ROWS.forEach(r => {
    const active = r === row;
    html += '<tr' + (active ? ' class="row-active"' : '') + '><td class="num">' + _fdpRowLabel(r) + '</td>';
    cols.forEach(c => {
      html += '<td class="r num' + (active && c === activeCol ? ' cell-active' : '') + '">' + _fdpHLabel(r.h[c]) + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  tbl.innerHTML = html;

  if (note) {
    const durTxt = band === 'vfr' ? (fr ? 'VFR de jour' : 'day VFR')
      : band === 'lt30' ? '< 30 min'
      : band === '30to50' ? (fr ? '30 à < 50 min' : '30 to < 50 min')
      : (fr ? '50 min et plus' : '50 min and more');
    const yourBand = single
      ? (fr ? 'Ta bande : présentation à ' + _fdpClock(acclimMin) + '.' : 'Your row: report at ' + _fdpClock(acclimMin) + '.')
      : (fr ? 'Ta bande : présentation à ' + _fdpClock(acclimMin) + ', ' + _fdpColRange(band, col, fr) + '.'
            : 'Your row: report at ' + _fdpClock(acclimMin) + ', ' + _fdpColRange(band, col, fr) + '.');
    note.textContent = (fr
      ? 'Service maximum selon l’heure de présentation acclimatée et le nombre de vols. Durée moyenne : ' + durTxt + '. '
      : 'Maximum duty by acclimatized report time and the number of flights. Average length: ' + durTxt + '. ') + yourBand;
  }
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
  // Hour (00-23) + minute (00-59) selects — reliable on desktop AND mobile,
  // exact to the minute (the native time picker was unusable on desktop).
  const hSel = document.getElementById('fdp-report-h');
  const mSel = document.getElementById('fdp-report-m');
  if (hSel && mSel && !hSel.options.length) {
    for (let i = 0; i < 24; i++) { const o = document.createElement('option'); o.value = i; o.textContent = String(i).padStart(2, '0'); hSel.appendChild(o); }
    for (let i = 0; i < 60; i++) { const o = document.createElement('option'); o.value = i; o.textContent = String(i).padStart(2, '0'); mSel.appendChild(o); }
    hSel.value = 7; mSel.value = 0;     // default 07:00
  }
  ['fdp-report-h', 'fdp-report-m', 'fdp-station', 'fdp-acclim', 'fdp-dur', 'fdp-legs', 'fdp-brk'].forEach(id => {
    const el = document.getElementById(id); if (el) { el.oninput = fdpCompute; el.onchange = fdpCompute; }
  });
  ['fdp-split', 'fdp-night'].forEach(id => { const el = document.getElementById(id); if (el) el.onchange = fdpCompute; });
  // Average-flight-length segmented control (spec: duty-final.html §3a .seg):
  // the buttons drive the hidden #fdp-dur input that fdpCompute() reads, and
  // aria-pressed tracks the active segment. Idempotent (onclick reassigned).
  const durSeg = document.getElementById('fdp-dur-seg');
  const durIn = document.getElementById('fdp-dur');
  if (durSeg && durIn) {
    const btns = durSeg.querySelectorAll('button[data-dur]');
    btns.forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.dur === durIn.value ? 'true' : 'false');
      b.onclick = () => {
        btns.forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        durIn.value = b.dataset.dur;
        fdpCompute();
      };
    });
  }
  fdpCompute();
}
