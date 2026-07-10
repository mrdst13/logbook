// ═══════════════════════════════════════════
// LOGBOOK TABLE
// ═══════════════════════════════════════════
let filterVal = '';

function renderLogbook(filter='') {
  filterVal = filter;
  const s = calcStats();
  const sMerged = (typeof totalsWithOpening === 'function') ? totalsWithOpening(s) : s;
  const lang = (typeof getLang === 'function') ? getLang() : 'en';
  const fr = lang === 'fr';

  // ─── Page-sub: current date in mono (matches Dashboard greeting style) ───
  const sub = document.getElementById('logbookSub');
  if (sub) {
    const now = new Date();
    const wday = now.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { weekday: 'long' }).toUpperCase();
    const date = now.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase().replace('.', '');
    sub.textContent = `${wday} · ${date}`;
  }

  // ─── Q9-style summary card ──────────────────────────────────────────
  // Updates with the active filter so the count reflects what's in the table.
  _renderLogbookSummary(s, sMerged, filter, fr);

  let list = [...flights].sort((a,b) => b.date.localeCompare(a.date));
  if (filter) {
    const q = filter.toLowerCase();
    list = list.filter(f =>
      (f.flightNum||'').toLowerCase().includes(q) ||   // "PD428" now finds the flight
      (f.date||'').includes(q) ||                      // "2026-01" or "2026-01-06" narrows by date
      (f.route||'').toLowerCase().includes(q) ||
      (f.reg||'').toLowerCase().includes(q) ||
      (f.pic||'').toLowerCase().includes(q) ||
      (f.type||'').toLowerCase().includes(q)
    );
  }

  const tbody = document.getElementById('logbookTbody');
  const thead = document.getElementById('logbookThead');
  const cols = getVisibleColumns('table');

  // Render thead dynamically based on user column preferences.
  // The trailing "actions" column was removed — clicking a row opens the
  // detail panel which already exposes Edit + Delete. Less visual noise.
  // data-col-key lets Q3 mobile CSS show/hide specific columns by key
  // rather than nth-child (which would break when column order changes).
  if (thead) {
    thead.innerHTML = '<tr>' +
      cols.map(c => `<th scope="col" data-col-key="${esc(c.key)}" style="text-align:${c.align||'left'};">${esc(colLabel(c))}</th>`).join('') +
    '</tr>';
  }

  if (!list.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols.length}">${esc(t('logbook.noFlights'))}</td></tr>`;
    return;
  }

  // Render rows dynamically — only the user-selected columns show.
  // Click row → opens full detail panel (see openFlightDetail).
  tbody.innerHTML = list.map(f => {
    const cells = cols.map(c => {
      const v = computeCellValue(f, c.key);
      const isMuted = (v === undefined || v === null || v === '' || (c.decimal && (+v === 0)));
      let display;
      if (isMuted) {
        display = '<span class="cell-num muted">—</span>';
      } else if (c.key === 'reg') {
        display = `<span class="reg-tag">${esc(v)}</span>${f.isSim ? ' <span class="sim-badge">SIM</span>' : ''}`;
      } else if (c.key === 'route') {
        display = `<span class="route-tag">${esc(v)}</span>`;
      } else if (c.key === 'date') {
        display = `<span class="cell-date">${esc(v)}</span>`;
      } else if (c.key === 'total') {
        display = `<strong>${fmt(v)}</strong>`;
      } else if (c.decimal) {
        display = `<span class="hrs">${fmt(v)}</span>`;
      } else if (typeof v === 'number') {
        display = `<span class="cell-num">${v}</span>`;
      } else {
        display = esc(v);
      }
      const tdClass = c.decimal ? 'hrs' : '';
      return `<td data-label="${esc(colShort(c))}" data-col-key="${esc(c.key)}" class="${tdClass}" style="text-align:${c.align||'left'};">${display}</td>`;
    }).join('');

    const fid = esc(f.id);
    // Accessible name for keyboard / screen-reader users: date + route so the
    // row is meaningful when focused (a bare "open details" would read the same
    // on every row). Falls back to em-dash when a field is empty (e.g. sim).
    const dateStr = String(computeCellValue(f, 'date') || '').trim() || '—';
    const routeStr = String(computeCellValue(f, 'route') || '').trim() || '—';
    const rowLabel = esc(t('logbook.rowAria', { date: dateStr, route: routeStr }));
    return `
    <tr onclick="openFlightDetail('${fid}')" class="row-clickable" tabindex="0" role="button" aria-label="${rowLabel}">
      ${cells}
    </tr>`;
  }).join('');

  // Keyboard activation for the clickable rows: Enter / Space open the detail
  // panel, matching the mouse click. Bound once per tbody (guarded flag) so
  // repeated renders don't stack duplicate listeners.
  if (tbody && !tbody._kbBound) {
    tbody.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      const row = e.target.closest && e.target.closest('tr.row-clickable');
      if (!row) return;
      e.preventDefault(); // stop Space from scrolling the page
      row.click();
    });
    tbody._kbBound = true;
  }

  // ── Render totals footer (sum of all visible flights for each numeric column) ──
  // When NO filter is active, fold brought-forward (opening balances) into the
  // totals so the row matches the cumulative shown on Dashboard hero and TC PDF
  // cover. When a filter is active, the totals are filter-local; brought-forward
  // is NOT added (it would mix cumulative paper-logbook hours with a filtered subset).
  const tfoot = document.getElementById('logbookTfoot');
  if (tfoot) {
    const includeOpening = !filter && typeof getOpening === 'function';
    const totals = {};
    cols.forEach(c => {
      if (c.decimal) {
        totals[c.key] = list.reduce((s, f) => s + (+computeCellValue(f, c.key) || 0), 0);
        if (includeOpening) totals[c.key] += getOpening(c.key);
      } else if (['ldgDay','ldgNight','approaches','toDay','toNight'].includes(c.key)) {
        totals[c.key] = list.reduce((s, f) => s + (+f[c.key] || 0), 0);
        if (includeOpening) totals[c.key] += getOpening(c.key);
      }
    });

    const broughtFwdNote = (includeOpening && typeof hasOpeningBalances === 'function' && hasOpeningBalances())
      ? ` <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);letter-spacing:0.04em;">${esc(t('logbook.inclBf'))}</span>`
      : '';

    const totalCells = cols.map((c, i) => {
      let display = '';
      if (i === 0) {
        display = `<strong>${esc(t('logbook.totalsLabel'))}</strong> · ${list.length} ${esc(list.length === 1 ? t('word.flight') : t('word.flights'))}${broughtFwdNote}`;
      } else if (totals.hasOwnProperty(c.key)) {
        const v = totals[c.key];
        display = c.decimal ? `<strong>${fmt(v)}</strong>` : `<strong>${v}</strong>`;
      }
      return `<td class="totals-cell" style="text-align:${c.align||'left'};">${display}</td>`;
    }).join('');

    tfoot.innerHTML = `<tr class="totals-row">${totalCells}</tr>`;
  }
}

// Open a side-panel / modal with the FULL detail of a flight.
function openFlightDetail(id) {
  const f = flights.find(x => x.id === id);
  if (!f) return;
  const detail = document.getElementById('flightDetailOverlay');
  if (!detail) return;
  const fmtCell = (v) => (v === undefined || v === null || v === '' || v === 0) ? '—' : (typeof v === 'number' ? fmt(v) : v);
  const fields = [
    [t('flight.date'), f.date],
    [t('flight.flightNum'), f.flightNum],
    [t('flight.aircraftType'), f.type],
    [t('flight.aircraftReg'), f.reg],
    [t('flight.route'), f.route],
    [t('detail.depIcao'), f.dep_icao],
    [t('detail.arrIcao'), f.arr_icao],
    [t('detail.crewPosition'), (() => {
      // Prefer the explicitly logged crew position. Only fall back to the legacy
      // "a PIC name is present ⇒ logged as SIC" heuristic when crewPosition was
      // never recorded — otherwise a captain (crewPosition='PIC') wrongly showed
      // as SIC just because the other pilot's name was stored.
      const pos = f.crewPosition || (f.pic ? 'SIC' : 'PIC');
      if (pos === 'SIC') return f.pic ? t('detail.crewPosSic', { pic: f.pic }) : 'SIC';
      return 'PIC';
    })()],
    [t('flight.pic'), f.pic],
    [t('detail.copilot'), f.copilot],
    [t('detail.atdUtc'), f.atd_utc],
    [t('detail.ataUtc'), f.ata_utc],
    [t('detail.checkInUtc'), f.ci_utc],
    [t('detail.checkOutUtc'), f.co_utc],
    [],
    [t('detail.flightTimeDecimal'), fmtCell(+f.total || +f.block)],
    [t('flight.block'), fmtCell(+f.block)],
    [t('flight.duty'), fmtCell(+f.duty)],
    [],
    [t('flight.meDayPic'), fmtCell(+f.meDayPic)],
    [t('flight.meNightPic'), fmtCell(+f.meNightPic)],
    [t('flight.meDayCop'), fmtCell(+f.meDayCop)],
    [t('flight.meNightCop'), fmtCell(+f.meNightCop)],
    [t('flight.meDayDual'), fmtCell(+f.meDayDual)],
    [t('flight.meNightDual'), fmtCell(+f.meNightDual)],
    [],
    [t('flight.xcDay'), fmtCell((+f.xcDayPic||0)+(+f.xcDayCop||0)+(+f.xcDayDual||0))],
    [t('flight.xcNight'), fmtCell((+f.xcNightPic||0)+(+f.xcNightCop||0)+(+f.xcNightDual||0))],
    [t('flight.ldgDay'), f.ldgDay || 0],
    [t('flight.ldgNight'), f.ldgNight || 0],
    [t('flight.instActual'), fmtCell(+f.instActual)],
    [t('flight.instHood'), fmtCell(+f.instHood)],
    [t('flight.approaches'), f.approaches || 0],
    [t('flight.picus'), fmtCell(+f.picus)],
    [t('flight.multiCrew'), f.multiCrew ? t('common.yes') : '—']
  ];
  const rows = fields.map(([k, v]) => {
    if (!k) return '<div class="detail-sep"></div>';
    return `<div class="detail-row"><div class="detail-key">${esc(k)}</div><div class="detail-val">${esc(v || '—')}</div></div>`;
  }).join('');
  document.getElementById('flightDetailTitle').textContent = `${f.date} · ${f.flightNum || ''} ${f.route || ''}`.trim();
  document.getElementById('flightDetailBody').innerHTML = rows;
  document.getElementById('flightDetailEditBtn').onclick = () => { closeFlightDetail(); editFlight(id); };
  document.getElementById('flightDetailDeleteBtn').onclick = () => { closeFlightDetail(); deleteFlight(id); };
  detail.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeFlightDetail() {
  const detail = document.getElementById('flightDetailOverlay');
  if (detail) detail.classList.remove('show');
  document.body.style.overflow = '';
}

function filterTable(val) { renderLogbook(val); }

// ─── Logbook Q9-style summary card ──────────────────────────────────
// Reuses .dash-card + .dash-hero-num + sparkline from the Dashboard so the
// visual language matches across pages. Updates with the active filter:
// the displayed count + sparkline reflect what's in the table below.
function _renderLogbookSummary(s, sMerged, filter, fr) {
  // Resolve which flights to summarize. With filter active, summarize the
  // filtered subset (so the big number always matches the table rows).
  let list = flights;
  if (filter) {
    const q = filter.toLowerCase();
    list = flights.filter(f =>
      (f.route || '').toLowerCase().includes(q) ||
      (f.reg   || '').toLowerCase().includes(q) ||
      (f.pic   || '').toLowerCase().includes(q) ||
      (f.type  || '').toLowerCase().includes(q)
    );
  }

  const count = list.length;
  const totalHrs = list.reduce((sum, f) => sum + flightTimeOf(f), 0);
  // Career hours include brought-forward; filter view stays subset-only.
  const careerHrs = filter ? totalHrs : (sMerged && sMerged.total) || totalHrs;

  // Hero count + unit
  const countEl = document.getElementById('lbSummaryCount');
  const unitEl  = document.getElementById('lbSummaryUnit');
  if (countEl) countEl.textContent = String(count);
  if (unitEl) {
    unitEl.textContent = fr
      ? (count === 1 ? 'vol' : 'vols')
      : (count === 1 ? 'flight' : 'flights');
  }

  // Eyebrow — "FILTERED RESULTS" when search is active, else "FLIGHTS · CAREER"
  const eyebrowEl = document.getElementById('lbSummaryEyebrow');
  if (eyebrowEl) {
    eyebrowEl.textContent = filter
      ? (fr ? `RÉSULTATS · FILTRÉ « ${filter.toUpperCase()} »` : `RESULTS · FILTERED "${filter.toUpperCase()}"`)
      : (fr ? 'VOLS · CARRIÈRE' : 'FLIGHTS · CAREER');
  }

  // Meta sub-line: hours total · this month · last flight
  const metaEl = document.getElementById('lbSummaryMeta');
  if (metaEl) {
    const monthCount = _lbCurrentMonthCount(list);
    const lastDate = _lbLastFlightDate(list);
    const parts = [];
    parts.push(fr
      ? `<strong>${_lbFmt(careerHrs)}</strong> hrs ${filter ? 'filtrées' : 'au total'}`
      : `<strong>${_lbFmt(careerHrs)}</strong> hrs ${filter ? 'filtered' : 'total'}`);
    if (!filter && monthCount > 0) {
      parts.push(fr
        ? `<strong>${monthCount}</strong> ce mois-ci`
        : `<strong>${monthCount}</strong> this month`);
    }
    if (lastDate) {
      const d = new Date(lastDate + 'T12:00:00');
      const fmtted = d.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short', year: 'numeric' });
      parts.push(fr ? `Dernier vol · ${fmtted}` : `Last flight · ${fmtted}`);
    }
    metaEl.innerHTML = parts.join(' · ');
  }

  // Sparkline — monthly distribution of the (filtered) flight subset's
  // BLOCK hours over the last 12 months.
  _renderLbSparkline('lbSparklineSvg', list);

  // Spark labels — first/last month of the 12-month window
  const labels = _lbMonthLabels(12, fr);
  const startEl = document.getElementById('lbSparkStart');
  const endEl   = document.getElementById('lbSparkEnd');
  if (startEl) startEl.textContent = labels[0];
  if (endEl)   endEl.textContent   = labels[labels.length - 1];
}

function _lbFmt(n) {
  return (typeof fmt === 'function') ? fmt(n) : (Math.round(n * 10) / 10).toFixed(1);
}

function _lbCurrentMonthCount(list) {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return list.filter(f => f.date && f.date.startsWith(ym)).length;
}

function _lbLastFlightDate(list) {
  if (!list.length) return null;
  return list.filter(f => f.date).map(f => f.date).sort((a, b) => b.localeCompare(a))[0] || null;
}

function _lbMonthLabels(months, fr) {
  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    out.push(d.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { month: 'short', year: '2-digit' }).toUpperCase().replace('.', ''));
  }
  return out;
}

function _renderLbSparkline(svgId, list) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  const w = 300, h = 70;
  // Bucket by YYYY-MM, last 12 months
  const buckets = {};
  list.forEach(f => {
    if (!f.date) return;
    const ym = f.date.slice(0, 7);
    buckets[ym] = (buckets[ym] || 0) + flightTimeOf(f);
  });
  const data = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    data.push(buckets[ym] || 0);
  }
  if (data.every(v => !v)) {
    svg.innerHTML = `<text x="${w/2}" y="${h/2 + 4}" text-anchor="middle" fill="#5E6678" font-family="monospace" font-size="11">—</text>`;
    return;
  }
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = (max - min) || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return [x, y];
  });
  const path = pts.map((p, i) => (i === 0 ? `M${p[0].toFixed(1)},${p[1].toFixed(1)}` : `L${p[0].toFixed(1)},${p[1].toFixed(1)}`)).join(' ');
  const areaPath = `${path} L${w},${h} L0,${h} Z`;
  const last = pts[pts.length - 1];
  svg.innerHTML = `
    <defs>
      <linearGradient id="${svgId}-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3884FF" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#3884FF" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#${svgId}-grad)"/>
    <path d="${path}" fill="none" stroke="#3884FF" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5" fill="#3884FF" stroke="#FFFFFF" stroke-width="2"/>
  `;
}

