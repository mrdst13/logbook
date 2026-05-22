// ═══════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════
function calcStats() {
  let total=0, pic=0, sic=0, night=0, ldg=0, me=0, xc=0, block=0, block30=0;
  let heli=0, hover=0, dualGiven=0;
  const now = new Date();
  const cutoff30 = new Date(now); cutoff30.setDate(cutoff30.getDate() - 30);
  flights.forEach(f => {
    total += +f.total || 0;
    pic += (+f.meDayPic||0) + (+f.meNightPic||0) + (+f.heliDayPic||0) + (+f.heliNightPic||0);
    sic += (+f.meDayCop||0) + (+f.meNightCop||0) + (+f.heliDayCop||0) + (+f.heliNightCop||0);
    night += (+f.meNightPic||0) + (+f.meNightDual||0) + (+f.meNightCop||0)
           + (+f.heliNightPic||0) + (+f.heliNightDual||0) + (+f.heliNightCop||0);
    ldg += (+f.ldgDay||0) + (+f.ldgNight||0);
    me += (+f.meDayPic||0)+(+f.meDayDual||0)+(+f.meDayCop||0)+(+f.meNightPic||0)+(+f.meNightDual||0)+(+f.meNightCop||0);
    heli += (+f.heliDayPic||0)+(+f.heliDayDual||0)+(+f.heliDayCop||0)
          + (+f.heliNightPic||0)+(+f.heliNightDual||0)+(+f.heliNightCop||0);
    hover += +f.hoverTime || 0;
    dualGiven += (+f.dualGivenDay||0) + (+f.dualGivenNight||0);
    xc += (+f.xcDayPic||0)+(+f.xcDayDual||0)+(+f.xcNightPic||0)+(+f.xcNightDual||0)
        + (+f.xcDayCop||0)+(+f.xcNightCop||0);
    block += +f.block || 0;
    if (f.date && new Date(f.date) >= cutoff30) block30 += +f.block || 0;
  });
  return {total,pic,sic,night,ldg,me,heli,hover,dualGiven,xc,block,block30,entries:flights.length};
}

// ─────────────────────────────────────────────────────────────────
//  Re-calculate night/XC for an existing flight using known coords + STD time.
//  Returns a new flight object with the updated fields, or the original if
//  we don't have enough info to compute.
// ─────────────────────────────────────────────────────────────────
function recalculateFlightDayNightXC(f) {
  // Need ICAO codes + a UTC departure time + block hours
  const depICAO = f.dep_icao || iataToIcao((f.route||'').split('-')[0]);
  const arrICAO = f.arr_icao || iataToIcao((f.route||'').split('-')[1]);
  const block = +f.block || 0;
  if (!depICAO || !arrICAO || block <= 0) return f;

  const depCoords = AIRPORT_COORDS[depICAO];
  const arrCoords = AIRPORT_COORDS[arrICAO];
  if (!depCoords || !arrCoords) return f;  // unknown airports

  // SOURCE OF TRUTH for the UTC instant of block-off:
  //   1. atd_utc (Actual Time of Departure — Cumulo's only time concept)
  //   2. dtstart_utc (full ISO from Navblue iCal — fallback when ATD empty)
  //   3. legacy std_utc (pre-2026-05-14 imports — migrated to atd_utc at
  //      app init but kept as a final fallback for stale in-memory copies)
  // Scheduled times are not a Cumulo concept — they only appear as
  // legacy data being read in for migration.
  let blockOff = null;
  if (f.atd_utc && f.atd_utc.length === 4) {
    blockOff = buildUTCDateTime(f.date, f.atd_utc);
  }
  if (!blockOff && f.dtstart_utc) {
    blockOff = new Date(f.dtstart_utc);
    if (isNaN(blockOff.getTime())) blockOff = null;
  }
  if (!blockOff && f.std_utc && f.std_utc.length === 4) {
    blockOff = buildUTCDateTime(f.date, f.std_utc);
  }
  if (!blockOff) return f;  // no UTC time to anchor the calc

  const blockOn = new Date(blockOff.getTime() + block * 3600000);
  const split = calculateDayNightSplit(blockOff, blockOn, depCoords, arrCoords);
  const isXC = isCrossCountry(depICAO, arrICAO);

  // Detect role: if existing has any meDayPic/meNightPic > 0 OR meDayDual > 0 it's PIC/Dual,
  // otherwise default to F/O (cop). Override with role-detection: if pic name field present and meDayPic was set, keep.
  let role = 'cop';
  if ((+f.meDayPic||0) + (+f.meNightPic||0) > 0) role = 'pic';
  else if ((+f.meDayDual||0) + (+f.meNightDual||0) > 0) role = 'dual';

  const out = { ...f };
  out.dep_icao = depICAO;
  out.arr_icao = arrICAO;

  if (role === 'cop') {
    out.meDayCop = split.dayHours; out.meNightCop = split.nightHours;
    out.meDayPic = 0; out.meNightPic = 0;
    out.xcDayCop = isXC ? split.dayHours : 0;
    out.xcNightCop = isXC ? split.nightHours : 0;
    out.xcDayPic = 0; out.xcNightPic = 0;
  } else if (role === 'pic') {
    out.meDayPic = split.dayHours; out.meNightPic = split.nightHours;
    out.xcDayPic = isXC ? split.dayHours : 0;
    out.xcNightPic = isXC ? split.nightHours : 0;
  } else {
    out.meDayDual = split.dayHours; out.meNightDual = split.nightHours;
    out.xcDayDual = isXC ? split.dayHours : 0;
    out.xcNightDual = isXC ? split.nightHours : 0;
  }

  // Landing day/night based on arrival
  if (isNightUTC(blockOn, arrCoords.lat, arrCoords.lon)) {
    out.ldgDay = 0; out.ldgNight = (+f.ldgNight || +f.ldgDay || 1);
  } else {
    out.ldgNight = 0; out.ldgDay = (+f.ldgDay || +f.ldgNight || 1);
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────
//  ZERO-DATA-LOSS SYSTEM (multi-snapshot history)
//
//  Policy : Cumulo never deletes a flight without explicit per-flight
//  user confirmation. Every bulk operation (sync, recalc) snapshots
//  the entire logbook to localStorage BEFORE running.
//
//  We keep the LAST 10 snapshots (rolling history) — pilot can roll
//  back several steps if needed.
// ─────────────────────────────────────────────────────────────────
const SNAPSHOTS_KEY = 'cumulo_snapshots_v2';   // v2 = array of snapshots
const SNAPSHOT_KEY_LEGACY = 'cumulo_snapshot_v1';  // v1 = single snapshot (auto-migrated)
const MAX_SNAPSHOTS = 10;

function loadSnapshots() {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    if (raw) return JSON.parse(raw);
    // Migrate from v1 legacy single-snapshot
    const legacy = localStorage.getItem(SNAPSHOT_KEY_LEGACY);
    if (legacy) {
      const snap = JSON.parse(legacy);
      const arr = [snap];
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(arr));
      localStorage.removeItem(SNAPSHOT_KEY_LEGACY);
      return arr;
    }
    return [];
  } catch { return []; }
}

function saveSnapshots(arr) {
  // Trim to MAX_SNAPSHOTS most recent (LIFO — newest first)
  const trimmed = arr.slice(0, MAX_SNAPSHOTS);
  try {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('[Snapshot] localStorage full — trimming further:', e);
    // Quota exceeded — keep only 3 most recent
    try { localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(arr.slice(0, 3))); }
    catch { localStorage.removeItem(SNAPSHOTS_KEY); }
  }
}

function snapshotBeforeOperation(operationName) {
  const snapshot = {
    flights: flights,
    timestamp: Date.now(),
    operation: operationName,
    flightCount: flights.length
  };
  const history = loadSnapshots();
  history.unshift(snapshot);  // newest first
  saveSnapshots(history);
  console.log(`[Snapshot] Saved before "${operationName}" — ${flights.length} flights · ${history.length} snapshots in history`);
  return true;
}

function ageString(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}

function undoLastOperation() {
  const history = loadSnapshots();
  if (history.length === 0) {
    showToast(t('toast.noSnapshot'), 'error');
    return;
  }
  // If multiple snapshots, let the user pick one
  if (history.length > 1) {
    showSnapshotHistoryModal();
    return;
  }
  // Single snapshot — quick restore
  restoreSnapshot(0);
}

function restoreSnapshot(index) {
  const history = loadSnapshots();
  if (!history[index]) { showToast(t('toast.snapshotNotFound'), 'error'); return; }
  const snap = history[index];

  if (!confirm(t('confirm.restoreSnapshot', { op: snap.operation, age: ageString(Date.now() - snap.timestamp), curN: flights.length, snapN: snap.flightCount }))) return;

  // Push current state as new snapshot (so user can undo this undo)
  const currentSnap = {
    flights: flights,
    timestamp: Date.now(),
    operation: `before undo of "${snap.operation}"`,
    flightCount: flights.length
  };
  // Remove the snapshot we're restoring from history, add current as new
  history.splice(index, 1);
  history.unshift(currentSnap);
  saveSnapshots(history);

  flights = snap.flights;
  DB.save(flights);
  renderDashboard();
  updateUndoButton();
  showToast(t('toast.snapshotRestored', { n: snap.flightCount, age: ageString(Date.now() - snap.timestamp) }), 'success');
}

function showSnapshotHistoryModal() {
  const history = loadSnapshots();
  if (history.length === 0) return;
  const overlay = document.getElementById('importPreview');
  // Use the import-overlay as a generic modal
  document.getElementById('importSubtitle').textContent = `${history.length} snapshot${history.length !== 1 ? 's' : ''} available — pick one to restore`;
  document.getElementById('extractedList').innerHTML = `
    <p style="margin-bottom:var(--s-3); font-size:13px; color:var(--text-secondary);">
      Each snapshot was taken automatically before a bulk operation. The current state will be preserved when you restore.
    </p>
    ${history.map((s, i) => `
      <div class="review-item is-selected" style="cursor:pointer;" onclick="restoreSnapshot(${i}); cancelImport();">
        <div class="review-body">
          <div class="review-item-header" style="font-weight:600;">${s.operation}</div>
          <div class="review-fields">
            <div class="review-field"><span>When</span> ${ageString(Date.now() - s.timestamp)}</div>
            <div class="review-field"><span>Flights</span> ${s.flightCount}</div>
            <div class="review-field"><span>Date</span> ${new Date(s.timestamp).toLocaleString('en-CA')}</div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); restoreSnapshot(${i}); cancelImport();">Restore</button>
      </div>
    `).join('')}
  `;
  // Override confirm button to close (no bulk action)
  document.getElementById('importConfirmBtn').textContent = 'Close';
  document.getElementById('importConfirmBtn').onclick = () => cancelImport();
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function updateUndoButton() {
  const btn = document.getElementById('undoBtn');
  if (!btn) return;
  const history = loadSnapshots();
  if (history.length === 0) {
    btn.disabled = true;
    btn.textContent = '↩️ No snapshot';
    return;
  }
  const snap = history[0];
  const label = history.length > 1
    ? `↩️ Undo · ${history.length} snapshots`
    : `↩️ Undo "${snap.operation}" (${ageString(Date.now() - snap.timestamp)})`;
  btn.disabled = false;
  btn.textContent = label;
}

// ─────────────────────────────────────────────────────────────────
//  Smart matching : find the best existing flight that matches an
//  incoming Navblue iCal flight, even when the existing flight has
//  no flightNum (PDF import). Matches on date + route + block (±0.15h).
// ─────────────────────────────────────────────────────────────────
function findMatchingExistingFlight(incoming) {
  if (!incoming || !incoming.date) return null;
  // First try exact match: date + flightNum + route
  const exactKey = `${incoming.date}|${incoming.flightNum}|${incoming.route}`;
  const exact = flights.findIndex(f =>
    `${f.date}|${f.flightNum || ''}|${f.route || ''}` === exactKey
  );
  if (exact >= 0) return { idx: exact, matchType: 'exact' };

  // Fallback: match on date + route + block similar (within 0.15h = 9 min)
  const incomingRouteNorm = (incoming.route || '').toUpperCase().replace(/\s/g,'');
  const incomingBlock = +incoming.block || 0;
  for (let i = 0; i < flights.length; i++) {
    const f = flights[i];
    if (f.date !== incoming.date) continue;
    const fRouteNorm = (f.route || '').toUpperCase().replace(/\s/g,'');
    if (fRouteNorm !== incomingRouteNorm) continue;
    const fBlock = +f.block || 0;
    if (Math.abs(fBlock - incomingBlock) > 0.15) continue;
    return { idx: i, matchType: 'fuzzy' };
  }

  // Also try without route (some PDF imports may have route in different format)
  for (let i = 0; i < flights.length; i++) {
    const f = flights[i];
    if (f.date !== incoming.date) continue;
    const fBlock = +f.block || 0;
    if (Math.abs(fBlock - incomingBlock) > 0.15) continue;
    // Same date + same block → very likely the same flight
    return { idx: i, matchType: 'date-block' };
  }

  return null;
}

// Manual bulk-recalc removed (was a TC compliance risk: retroactive overwrite
// of pilot-logged values, breaks attestation→value binding under CAR 401.08).
// The internal function below is still called from the Navblue iCal sync
// AFTER existing flights are enriched with new UTC anchors — that's a
// defensible "fill what was previously uncalculable" path, not a bulk
// retroactive modification of pilot-confirmed values.
function recalculateAllFlights() {
  // Stub kept so any legacy onclick="recalculateAllFlights()" no-ops cleanly.
  // The Settings → Data UI no longer exposes this; sync calls
  // recalculateAllFlightsInternal() directly.
  console.warn('[Recalc] Manual bulk-recalc is disabled (TC compliance). Edit individual flights via Add/Edit instead.');
  return;
  // ─── former body (kept for git-blame reference only, never executes) ───
  snapshotBeforeOperation('Recalculate Night & XC');
  updateUndoButton();
  const result = recalculateAllFlightsInternal();
  DB.save(flights);
  renderDashboard();
  // Build honest detailed message
  const parts = [];
  parts.push(`${result.updated} recalculated`);
  if (result.skippedNoUTC) parts.push(`${result.skippedNoUTC} skipped (no UTC time — use "Clean & re-sync" below)`);
  if (result.skippedNoCoords) parts.push(`${result.skippedNoCoords} skipped (unknown airport coords)`);
  if (result.skippedNoBlock) parts.push(`${result.skippedNoBlock} skipped (zero block hours)`);
  const totalSkipped = result.skippedNoUTC + result.skippedNoCoords + result.skippedNoBlock;
  const toastType = result.updated > 0 && totalSkipped === 0 ? 'success'
                  : totalSkipped > 0 ? 'error' : 'success';
  showToast(parts.join(' · '), toastType);
  console.log('[Recalc] Details:', result, 'flights:', flights.length);
}

function recalculateAllFlightsInternal() {
  let updated = 0, skippedNoUTC = 0, skippedNoCoords = 0, skippedNoBlock = 0;
  flights = flights.map(f => {
    const block = +f.block || 0;
    if (block <= 0) { skippedNoBlock++; return f; }
    const depICAO = f.dep_icao || iataToIcao((f.route||'').split('-')[0]);
    const arrICAO = f.arr_icao || iataToIcao((f.route||'').split('-')[1]);
    if (!AIRPORT_COORDS[depICAO] || !AIRPORT_COORDS[arrICAO]) { skippedNoCoords++; return f; }
    // Need at least one usable UTC anchor: ATD or dtstart (legacy STD only
    // counted via the migration which runs at app init).
    const hasUTCAnchor = (f.atd_utc && f.atd_utc.length === 4)
                     || f.dtstart_utc
                     || (f.std_utc && f.std_utc.length === 4); // legacy fallback
    if (!hasUTCAnchor) { skippedNoUTC++; return f; }
    const recalc = recalculateFlightDayNightXC(f);
    if (recalc !== f) updated++;
    return recalc;
  });
  return { updated, skippedNoUTC, skippedNoCoords, skippedNoBlock };
}

function fmt(n) { return (+n).toFixed(1); }

function setMini(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = fmt(val);
  el.classList.toggle('zero', (+val) === 0);
}

function renderDashboard() {
  const sRaw = calcStats();
  // Merge brought-forward (opening balances from a paper logbook) into the
  // cumulative figures. s.block30 (last 30 days) and s.entries (in-app flight
  // count) intentionally stay as-flights only — currency + activity metrics,
  // not cumulative totals.
  const s = (typeof totalsWithOpening === 'function') ? totalsWithOpening(sRaw) : sRaw;
  document.getElementById('s-total').textContent = fmt(s.total);
  document.getElementById('s-pic').textContent = fmt(s.pic);
  document.getElementById('s-night').textContent = fmt(s.night);
  document.getElementById('s-ldg').textContent = s.ldg;
  document.getElementById('s-me').textContent = fmt(s.me);
  document.getElementById('s-xc').textContent = fmt(s.xc);
  document.getElementById('s-block').textContent = fmt(s.block);
  document.getElementById('s-entries').textContent = sRaw.entries;
  document.getElementById('headerHours').textContent = fmt(s.total) + ' hrs total';
  document.getElementById('dashDate').textContent = new Date().toLocaleDateString('en-CA', {weekday:'long', year:'numeric', month:'long', day:'numeric'});

  // Hero card
  const heroTotal = document.getElementById('hero-total');
  if (heroTotal) {
    heroTotal.textContent = fmt(s.block || s.total);
    document.getElementById('hero-delta-value').textContent = fmt(sRaw.block30);
    setMini('hero-pic', s.pic);
    setMini('hero-sic', s.sic);
    setMini('hero-night', s.night);
    // Hide delta block if no flights last 30 days
    const delta = document.getElementById('hero-delta');
    delta.style.display = sRaw.block30 > 0 ? 'inline-flex' : 'none';
  }

  renderAlerts();
  renderCurrencyCard();
  renderChart();
  const recent = [...flights].sort((a,b) => b.date.localeCompare(a.date)).slice(0,8);
  const tbody = document.getElementById('recentTbody');
  if (!recent.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No flights logged yet. Add your first flight to start tracking.</td></tr>';
    return;
  }
  tbody.innerHTML = recent.map(f => `
    <tr>
      <td>${esc(f.date)}</td>
      <td><span class="reg-tag">${esc(f.reg||'—')}</span></td>
      <td><span class="route-tag">${esc(f.route||'—')}</span></td>
      <td class="hrs">${fmt(f.block)}</td>
      <td class="hrs">${fmt(f.total)}</td>
      <td>${(+f.ldgDay||0)+(+f.ldgNight||0)}</td>
    </tr>`).join('');
}

