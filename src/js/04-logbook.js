// ═══════════════════════════════════════════
// LOGBOOK TABLE
// ═══════════════════════════════════════════
let filterVal = '';

function renderLogbook(filter='') {
  filterVal = filter;
  const s = calcStats();
  document.getElementById('logbookSub').textContent = flights.length + ' entries · ' + fmt(s.total) + ' hrs total';

  let list = [...flights].sort((a,b) => b.date.localeCompare(a.date));
  if (filter) {
    const q = filter.toLowerCase();
    list = list.filter(f =>
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
  if (thead) {
    thead.innerHTML = '<tr>' +
      cols.map(c => `<th style="text-align:${c.align||'left'};">${c.label}</th>`).join('') +
    '</tr>';
  }

  if (!list.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols.length}">No flights found.</td></tr>`;
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
      return `<td data-label="${esc(c.short)}" class="${tdClass}" style="text-align:${c.align||'left'};">${display}</td>`;
    }).join('');

    const fid = esc(f.id);
    return `
    <tr onclick="openFlightDetail('${fid}')" class="row-clickable">
      ${cells}
    </tr>`;
  }).join('');

  // ── Render totals footer (sum of all visible flights for each numeric column) ──
  const tfoot = document.getElementById('logbookTfoot');
  if (tfoot) {
    const totals = {};
    cols.forEach(c => {
      if (c.decimal) {
        totals[c.key] = list.reduce((s, f) => s + (+computeCellValue(f, c.key) || 0), 0);
      } else if (['ldgDay','ldgNight','approaches','toDay','toNight'].includes(c.key)) {
        totals[c.key] = list.reduce((s, f) => s + (+f[c.key] || 0), 0);
      }
    });

    const totalCells = cols.map((c, i) => {
      let display = '';
      if (i === 0) {
        display = `<strong>TOTALS</strong> · ${list.length} flight${list.length !== 1 ? 's' : ''}`;
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
    ['Date', f.date],
    ['Flight Number', f.flightNum],
    ['Aircraft Type', f.type],
    ['Registration', f.reg],
    ['Route', f.route],
    ['Departure (ICAO)', f.dep_icao],
    ['Arrival (ICAO)', f.arr_icao],
    ['Crew Position', f.pic ? 'SIC (PIC: ' + f.pic + ')' : 'PIC'],
    ['Pilot in Command', f.pic],
    ['Co-pilot', f.copilot],
    ['ATD UTC', f.atd_utc],
    ['ATA UTC', f.ata_utc],
    ['Check-In UTC', f.ci_utc],
    ['Check-Out UTC', f.co_utc],
    [],
    ['Flight Time (decimal)', fmtCell(+f.total || +f.block)],
    ['Block Time', fmtCell(+f.block)],
    ['Duty Time', fmtCell(+f.duty)],
    [],
    ['ME Day PIC', fmtCell(+f.meDayPic)],
    ['ME Night PIC', fmtCell(+f.meNightPic)],
    ['ME Day SIC', fmtCell(+f.meDayCop)],
    ['ME Night SIC', fmtCell(+f.meNightCop)],
    ['ME Day Dual', fmtCell(+f.meDayDual)],
    ['ME Night Dual', fmtCell(+f.meNightDual)],
    [],
    ['XC Day', fmtCell((+f.xcDayPic||0)+(+f.xcDayCop||0)+(+f.xcDayDual||0))],
    ['XC Night', fmtCell((+f.xcNightPic||0)+(+f.xcNightCop||0)+(+f.xcNightDual||0))],
    ['Day Landings', f.ldgDay || 0],
    ['Night Landings', f.ldgNight || 0],
    ['IFR Actual', fmtCell(+f.instActual)],
    ['IFR Hood', fmtCell(+f.instHood)],
    ['Approaches', f.approaches || 0],
    ['PICUS', fmtCell(+f.picus)],
    ['Multi-Crew', f.multiCrew ? 'Yes' : '—']
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

