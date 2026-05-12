// ═══════════════════════════════════════════
// XSS escape helper — every value interpolated into innerHTML must go
// through this. Most sensitive sources: Navblue iCal parser (captain
// names from rosters), Anthropic OCR output (photo logbook imports),
// PDF roster parser (captain names + flight numbers), JSON backup
// restore (entire flight payload). Failure mode: a single hostile
// backup file or roster image runs arbitrary JS in the pilot's
// browser and exfiltrates localStorage.
// ═══════════════════════════════════════════
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ═══════════════════════════════════════════
// DATA LAYER
// ═══════════════════════════════════════════
const DB = {
  key: 'logbook_v1',
  profileKey: 'logbook_profile_v1',

  load() {
    try { return JSON.parse(localStorage.getItem(this.key) || '[]'); }
    catch { return []; }
  },
  save(flights) {
    localStorage.setItem(this.key, JSON.stringify(flights));
  },
  loadProfile() {
    try { return JSON.parse(localStorage.getItem(this.profileKey) || '{}'); }
    catch { return {}; }
  },
  saveProfile(p) {
    localStorage.setItem(this.profileKey, JSON.stringify(p));
  }
};

let flights = DB.load();
let pendingImport = [];
let editingId = null;

// ═══════════════════════════════════════════
// MOBILE NAVIGATION
// Pattern: shadcn/ui Sheet / Material-UI Drawer style.
//
//   - Real <button> elements with data-page attributes (no <div role=button>)
//   - Single delegated 'click' listener on <nav> (no touchend, no
//     belt-and-suspenders; click fires reliably on <button> in iOS Safari)
//   - Scroll lock via body.nav-open { overflow:hidden } — no touch-action
//     fiddling with <main> (that was breaking taps on the drawer)
//   - Overlay swallows touchmove to prevent scroll-chaining into <main>
//   - aria-expanded on hamburger reflects state for a11y
// ═══════════════════════════════════════════
function openMobileNav() {
  document.body.classList.add('nav-open');
  const hb = document.getElementById('hamburger');
  if (hb) hb.setAttribute('aria-expanded', 'true');
}

function closeMobileNav() {
  document.body.classList.remove('nav-open');
  const hb = document.getElementById('hamburger');
  if (hb) hb.setAttribute('aria-expanded', 'false');
}

function toggleMobileNav() {
  if (document.body.classList.contains('nav-open')) {
    closeMobileNav();
  } else {
    openMobileNav();
  }
}

function wireNav() {
  // Hamburger
  const hb = document.getElementById('hamburger');
  if (hb) hb.addEventListener('click', toggleMobileNav);

  // Overlay click-to-close
  const ov = document.getElementById('navOverlay');
  if (ov) {
    ov.addEventListener('click', closeMobileNav);
    // Prevent touchmove on overlay from scroll-chaining to <main>.
    // passive:false so preventDefault() is honoured on iOS.
    ov.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
  }

  // Delegated nav-item clicks. One listener on <nav> covers every item.
  // Survives re-renders (not that we have any) and is the most reliable
  // mechanism on iOS Safari for <button> children.
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-item');
      if (!btn || !sidebar.contains(btn)) return;
      const page = btn.dataset.page;
      if (!page) return;
      showPage(page);
    });
  }

  // ESC closes drawer (desktop / iPad keyboard users)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('nav-open')) {
      closeMobileNav();
    }
  });
}

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const target = document.getElementById('page-' + id);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.dataset.page === id) n.classList.add('active');
  });

  // Close mobile nav whenever a page is selected
  closeMobileNav();

  if (id === 'dashboard') renderDashboard();
  if (id === 'logbook') renderLogbook();
  if (id === 'profile') { loadProfile(); setTimeout(initSignature, 50); }
  if (id === 'backup') {
    const toggle = document.getElementById('darkModeToggle');
    if (toggle) toggle.checked = localStorage.getItem('logbook_dark') === '1';
  }
  if (id === 'recap') { initRecapYears(); renderRecap(); }
  if (id === 'glossary') renderGlossary();
  if (id === 'qa') renderQA();
  if (id === 'add' && !editingId) {
    document.getElementById('formTitle').textContent = 'Log a Flight';
    clearForm();
    document.getElementById('f-date').value = new Date().toISOString().split('T')[0];
    setEntryType('flight');   // default to flight when entering a new entry
  }
  if (id === 'add') {
    adaptFormToProfile(DB.loadProfile().pilotType || 'airline705');
  }
}

// ═══════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════
function calcStats() {
  let total=0, pic=0, sic=0, night=0, ldg=0, me=0, xc=0, block=0, block30=0;
  const now = new Date();
  const cutoff30 = new Date(now); cutoff30.setDate(cutoff30.getDate() - 30);
  flights.forEach(f => {
    total += +f.total || 0;
    pic += (+f.meDayPic||0) + (+f.meNightPic||0);
    sic += (+f.meDayCop||0) + (+f.meNightCop||0);
    night += (+f.meNightPic||0) + (+f.meNightDual||0) + (+f.meNightCop||0);
    ldg += (+f.ldgDay||0) + (+f.ldgNight||0);
    me += (+f.meDayPic||0)+(+f.meDayDual||0)+(+f.meDayCop||0)+(+f.meNightPic||0)+(+f.meNightDual||0)+(+f.meNightCop||0);
    xc += (+f.xcDayPic||0)+(+f.xcDayDual||0)+(+f.xcNightPic||0)+(+f.xcNightDual||0)
        + (+f.xcDayCop||0)+(+f.xcNightCop||0);
    block += +f.block || 0;
    if (f.date && new Date(f.date) >= cutoff30) block30 += +f.block || 0;
  });
  return {total,pic,sic,night,ldg,me,xc,block,block30,entries:flights.length};
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
  //   1. dtstart_utc (full ISO, never ambiguous) — preferred
  //   2. buildUTCDateTime(date, std_utc) — only as a fallback when dtstart_utc absent
  // Reconstruction can drift across UTC midnight for late-local departures.
  let blockOff = null;
  if (f.dtstart_utc) {
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
    showToast('No snapshot to restore — Cumulo only saves snapshots before bulk operations.', 'error');
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
  if (!history[index]) { showToast('Snapshot not found', 'error'); return; }
  const snap = history[index];

  if (!confirm(`Restore logbook to state before "${snap.operation}" (${ageString(Date.now() - snap.timestamp)})?\n\nCurrent: ${flights.length} flights\nSnapshot: ${snap.flightCount} flights\n\nThe current state will be saved as a new snapshot — you can always undo again.`)) return;

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
  showToast(`Restored ${snap.flightCount} flights from ${ageString(Date.now() - snap.timestamp)} state`, 'success');
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

// Re-process ALL existing flights and persist. Reports skips with reasons.
function recalculateAllFlights() {
  if (!confirm('Recalculate night-time and cross-country for all imported flights?\n\nThis will overwrite existing day/night splits using astronomical sunrise/sunset.\n\nA snapshot will be saved automatically — you can undo this from Settings if needed.')) return;
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
    if (!f.std_utc || f.std_utc.length !== 4) { skippedNoUTC++; return f; }
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
  const s = calcStats();
  document.getElementById('s-total').textContent = fmt(s.total);
  document.getElementById('s-pic').textContent = fmt(s.pic);
  document.getElementById('s-night').textContent = fmt(s.night);
  document.getElementById('s-ldg').textContent = s.ldg;
  document.getElementById('s-me').textContent = fmt(s.me);
  document.getElementById('s-xc').textContent = fmt(s.xc);
  document.getElementById('s-block').textContent = fmt(s.block);
  document.getElementById('s-entries').textContent = s.entries;
  document.getElementById('headerHours').textContent = fmt(s.total) + ' hrs total';
  document.getElementById('dashDate').textContent = new Date().toLocaleDateString('en-CA', {weekday:'long', year:'numeric', month:'long', day:'numeric'});

  // Hero card (v3a signature element)
  const heroTotal = document.getElementById('hero-total');
  if (heroTotal) {
    heroTotal.textContent = fmt(s.block || s.total);
    document.getElementById('hero-delta-value').textContent = fmt(s.block30);
    setMini('hero-pic', s.pic);
    setMini('hero-sic', s.sic);
    setMini('hero-night', s.night);
    // Hide delta block if no flights last 30 days
    const delta = document.getElementById('hero-delta');
    delta.style.display = s.block30 > 0 ? 'inline-flex' : 'none';
  }

  renderAlerts();
  renderCurrencyCard();
  renderChart();
  const recent = [...flights].sort((a,b) => b.date.localeCompare(a.date)).slice(0,8);
  const tbody = document.getElementById('recentTbody');
  if (!recent.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No flights yet — add your first entry above ✈</td></tr>';
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

// ═══════════════════════════════════════════
// FEATURE 5 — MEDICAL & RECENCY ALERTS
// ═══════════════════════════════════════════
function renderAlerts() {
  const section = document.getElementById('alertsSection');
  if (!section) return;
  const p = DB.loadProfile();
  const today = new Date(); today.setHours(0,0,0,0);
  const alerts = [];

  // Show alerts ONLY when there's something the pilot needs to act on.
  // Green / "all good" states are hidden — no clutter on the dashboard.

  // Medical expiry — only show if expired or expiring soon (<60 days)
  if (p.medical) {
    const exp = new Date(p.medical); exp.setHours(0,0,0,0);
    const days = Math.round((exp - today) / 86400000);
    if (days < 0) {
      alerts.push({ level:'red', icon:'🏥', title:'Medical EXPIRED', sub:`Expired ${Math.abs(days)} day${Math.abs(days)!==1?'s':''} ago` });
    } else if (days <= 60) {
      alerts.push({ level:'yellow', icon:'🏥', title:`Medical expires in ${days} day${days!==1?'s':''}`, sub:`Expiry: ${exp.toLocaleDateString('en-CA')}` });
    }
    // > 60 days = current = no alert shown
  }

  // Landing currency — only show if NOT current (<3 in 90 days)
  const cutoff90 = new Date(today); cutoff90.setDate(cutoff90.getDate() - 90);
  const cut90str = cutoff90.toISOString().split('T')[0];
  const recentLdg = flights
    .filter(f => f.date >= cut90str)
    .reduce((sum, f) => sum + (+f.ldgDay||0) + (+f.ldgNight||0), 0);
  if (recentLdg < 3) {
    alerts.push({ level: recentLdg > 0 ? 'yellow' : 'red', icon:'🛬', title:`Landing currency: ${recentLdg}/3 landings in last 90 days`, sub:'3 landings required within 90 days — CAR 401.05' });
  }

  // IFR currency — only show if NOT current (<6 approaches in 6 months).
  // CAR 401.05 requires 6 instrument approaches in the preceding 6 months.
  // Counter is approaches only (integer count) — NOT instrument hours.
  const cutoff6m = new Date(today); cutoff6m.setMonth(cutoff6m.getMonth() - 6);
  const cut6mStr = cutoff6m.toISOString().split('T')[0];
  const appCount = flights
    .filter(f => f.date >= cut6mStr)
    .reduce((sum, f) => sum + (+f.approaches||0), 0);
  if (appCount < 6) {
    alerts.push({ level: appCount > 0 ? 'yellow' : 'red', icon:'🌫', title:`IFR currency: ${appCount}/6 approaches in last 6 months`, sub:'6 approaches required within 6 months — CAR 401.05' });
  }

  if (!alerts.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  section.innerHTML = alerts.map(a => `
    <div class="alert-bar ${a.level}">
      <div class="alert-icon">${a.icon}</div>
      <div class="alert-text">
        ${a.title}
        <div class="alert-sub">${a.sub}</div>
      </div>
    </div>`).join('');
}

// ═══════════════════════════════════════════
// IFR CURRENCY CARD (CAR 401.05 — always-visible dashboard status)
// ═══════════════════════════════════════════
function renderCurrencyCard() {
  const card = document.getElementById('currencyCard');
  if (!card) return;

  const today = new Date(); today.setHours(0,0,0,0);
  const cutoff6m = new Date(today); cutoff6m.setMonth(cutoff6m.getMonth() - 6);
  const cut6mStr = cutoff6m.toISOString().split('T')[0];
  const recent6m = flights.filter(f => f.date && f.date >= cut6mStr);

  const approachCount = recent6m.reduce((s, f) => s + (+f.approaches || 0), 0);
  const instHours = recent6m.reduce((s, f) => s + (+f.instActual || 0) + (+f.instHood || 0) + (+f.instSim || 0), 0);

  const setStatus = (elId, ok, low) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.classList.remove('ok','low','bad');
    if (ok)       { el.classList.add('ok');  el.textContent = 'Current'; }
    else if (low) { el.classList.add('low'); el.textContent = 'Low';     }
    else          { el.classList.add('bad'); el.textContent = 'Expired'; }
  };

  document.getElementById('cur-app-count').textContent = approachCount;
  setStatus('cur-app-status', approachCount >= 6, approachCount > 0);
  document.getElementById('cur-app-sub').textContent =
    recent6m.length === 0
      ? 'No flights logged in last 6 months'
      : `Across ${recent6m.length} flight${recent6m.length !== 1 ? 's' : ''}. Toggle auto-count in Profile → IFR Approach Auto-Count.`;

  document.getElementById('cur-hrs-count').textContent = instHours.toFixed(1);
  setStatus('cur-hrs-status', instHours >= 6, instHours > 0);
  document.getElementById('cur-hrs-sub').textContent = 'Actual + hood + approved sim';
}

// ═══════════════════════════════════════════
// FEATURE 4 — MONTHLY CHART
// ═══════════════════════════════════════════
let monthlyChartInst = null;

function renderChart() {
  const canvas = document.getElementById('monthlyChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const now = new Date();
  const labels = [], data = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toISOString().substring(0, 7);
    labels.push(d.toLocaleDateString('en-CA', { month: 'short', year: '2-digit' }));
    const hrs = flights.filter(f => f.date && f.date.startsWith(key))
                       .reduce((sum, f) => sum + (+f.block || 0), 0);
    data.push(parseFloat(hrs.toFixed(1)));
  }
  if (monthlyChartInst) { monthlyChartInst.destroy(); monthlyChartInst = null; }
  monthlyChartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Block Hours',
        data,
        backgroundColor: 'rgba(61,123,196,0.72)',
        borderColor: 'rgba(61,123,196,1)',
        borderWidth: 1.5,
        borderRadius: 5,
      }]
    },
    options: {
      responsive: true,
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ctx.parsed.y.toFixed(1) + ' hrs' } }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { font: { family: "'JetBrains Mono', ui-monospace, monospace", size: 10 }, color: '#6b7fa3' }
        },
        x: {
          grid: { display: false },
          ticks: { font: { family: "'JetBrains Mono', ui-monospace, monospace", size: 10 }, color: '#6b7fa3' }
        }
      }
    }
  });
}

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

  // Render thead dynamically based on user column preferences
  if (thead) {
    thead.innerHTML = '<tr>' +
      cols.map(c => `<th style="text-align:${c.align||'left'};">${c.label}</th>`).join('') +
      '<th style="text-align:right; width:80px;"></th>' +
    '</tr>';
  }

  if (!list.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols.length + 1}">No flights found ✈</td></tr>`;
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
      <td data-label="" class="row-actions" onclick="event.stopPropagation()">
        <button class="btn btn-ghost btn-sm" onclick="editFlight('${fid}')" title="Edit">✏</button>
        <button class="btn btn-sm" style="background:var(--danger-soft);color:var(--danger);margin-left:4px" onclick="deleteFlight('${fid}')" title="Delete">🗑</button>
      </td>
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

    tfoot.innerHTML = `<tr class="totals-row">${totalCells}<td class="totals-cell"></td></tr>`;
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
    ['STD UTC', f.std_utc],
    ['STA UTC', f.sta_utc],
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

// ═══════════════════════════════════════════
// FORM — SAVE / EDIT / DELETE
// ═══════════════════════════════════════════
function gv(id) { return document.getElementById(id).value; }
function sv(id, val) { document.getElementById(id).value = val || ''; }

// ═══════════════════════════════════════════
// AIRCRAFT DROPDOWN (Feature 2)
// ═══════════════════════════════════════════
const AIRCRAFT_RATINGS = {
  'E195-E2': 'E195',
  'Q400':    'DH4',
};

function onAircraftSelect() {
  const sel    = document.getElementById('f-type-select');
  const custom = document.getElementById('f-type-custom');
  const rating = document.getElementById('f-rating');

  if (sel.value === 'custom') {
    custom.style.display = 'block';
    custom.value = '';
    custom.focus();
    if (rating) rating.value = '';
  } else {
    custom.style.display = 'none';
    custom.value = sel.value;
    if (rating && AIRCRAFT_RATINGS[sel.value]) {
      rating.value = AIRCRAFT_RATINGS[sel.value];
    }
  }
}

function getAircraftType() {
  const sel = document.getElementById('f-type-select');
  if (!sel) return '';
  return sel.value === 'custom'
    ? (document.getElementById('f-type-custom').value || '')
    : sel.value;
}

function setAircraftTypeField(val) {
  const sel    = document.getElementById('f-type-select');
  const custom = document.getElementById('f-type-custom');
  if (!sel) return;

  const known = ['E195-E2', 'Q400'];
  if (!val) {
    sel.value = '';
    custom.style.display = 'none';
    custom.value = '';
  } else if (known.includes(val)) {
    sel.value = val;
    custom.style.display = 'none';
    custom.value = val;
  } else {
    sel.value = 'custom';
    custom.style.display = 'block';
    custom.value = val;
  }
}

let currentEntryType = 'flight';   // 'flight' or 'sim'

function setEntryType(type) {
  currentEntryType = type;
  document.getElementById('entryTypeFlight').classList.toggle('is-active', type === 'flight');
  document.getElementById('entryTypeSim').classList.toggle('is-active', type === 'sim');
  document.getElementById('simFields').style.display = type === 'sim' ? 'block' : 'none';
  // Update form title
  const ft = document.getElementById('formTitle');
  if (ft && !editingId) ft.textContent = type === 'sim' ? 'Log a Simulator Session' : 'Log a Flight';
}

function saveFlight() {
  const date = gv('f-date');
  if (!date) { showToast('Date is required', 'error'); return; }

  const isSim = currentEntryType === 'sim';

  const flight = {
    id: editingId || Date.now().toString(),
    date,
    type: getAircraftType(),
    reg: isSim ? (gv('f-simRegistration') || 'SIM') : gv('f-reg'),
    rating: gv('f-rating'),
    acConfig: gv('f-acConfig') || 'wheels',
    pic: gv('f-pic'),
    copilot: gv('f-copilot'),
    route: gv('f-route'),
    remarks: gv('f-remarks'),
    block: isSim ? 0 : gv('f-block'),     // sim has no block time (not actual flight)
    duty: gv('f-duty'),
    total: gv('f-total'),
    meDayDual: gv('f-me-day-dual'),
    meDayPic: gv('f-me-day-pic'),
    meDayCop: gv('f-me-day-cop'),
    meNightDual: gv('f-me-night-dual'),
    meNightPic: gv('f-me-night-pic'),
    meNightCop: gv('f-me-night-cop'),
    xcDayDual: gv('f-xc-day-dual'),
    xcDayPic: gv('f-xc-day-pic'),
    xcNightDual: gv('f-xc-night-dual'),
    xcNightPic: gv('f-xc-night-pic'),
    ldgDay: isSim ? 0 : gv('f-ldg-day'),
    ldgNight: isSim ? 0 : gv('f-ldg-night'),
    instActual: gv('f-inst-actual'),
    instHood: gv('f-inst-hood'),
    instSim: isSim ? (gv('f-total') || gv('f-inst-sim')) : gv('f-inst-sim'),
    picus: gv('f-picus'),
    // Simulator fields (per CAR 401.08 — separate from flight time)
    isSim,
    simType: isSim ? gv('f-simType') : '',
    simSession: isSim ? gv('f-simSession') : '',
    simRegistration: isSim ? gv('f-simRegistration') : '',
    simInstructor: isSim ? gv('f-simInstructor') : '',
  };

  if (editingId) {
    const idx = flights.findIndex(f => f.id === editingId);
    if (idx !== -1) flights[idx] = flight;
    editingId = null;
  } else {
    flights.push(flight);
  }

  DB.save(flights);
  showToast('Flight saved ✓', 'success');
  showPage('logbook');
}

function editFlight(id) {
  const f = flights.find(x => x.id === id);
  if (!f) return;
  editingId = id;
  document.getElementById('formTitle').textContent = f.isSim ? 'Edit Simulator Session' : 'Edit Flight';
  setEntryType(f.isSim ? 'sim' : 'flight');
  sv('f-date', f.date); setAircraftTypeField(f.type); sv('f-reg', f.reg);
  sv('f-rating', f.rating);
  if (document.getElementById('f-acConfig')) document.getElementById('f-acConfig').value = f.acConfig || 'wheels';
  sv('f-pic', f.pic); sv('f-copilot', f.copilot);
  sv('f-route', f.route); sv('f-remarks', f.remarks);
  sv('f-block', f.block); sv('f-duty', f.duty); sv('f-total', f.total);
  sv('f-me-day-dual', f.meDayDual); sv('f-me-day-pic', f.meDayPic); sv('f-me-day-cop', f.meDayCop);
  sv('f-me-night-dual', f.meNightDual); sv('f-me-night-pic', f.meNightPic); sv('f-me-night-cop', f.meNightCop);
  sv('f-xc-day-dual', f.xcDayDual); sv('f-xc-day-pic', f.xcDayPic);
  sv('f-xc-night-dual', f.xcNightDual); sv('f-xc-night-pic', f.xcNightPic);
  sv('f-ldg-day', f.ldgDay); sv('f-ldg-night', f.ldgNight);
  sv('f-inst-actual', f.instActual); sv('f-inst-hood', f.instHood); sv('f-inst-sim', f.instSim);
  sv('f-picus', f.picus);
  if (f.isSim) {
    if (document.getElementById('f-simType')) document.getElementById('f-simType').value = f.simType || 'FFS';
    if (document.getElementById('f-simSession')) document.getElementById('f-simSession').value = f.simSession || 'Recurrent';
    sv('f-simRegistration', f.simRegistration);
    sv('f-simInstructor', f.simInstructor);
  }
  showPage('add');
}

function deleteFlight(id) {
  if (!confirm('Delete this flight entry?')) return;
  flights = flights.filter(f => f.id !== id);
  DB.save(flights);
  showToast('Flight deleted', 'error');
  renderLogbook(filterVal);
}

function clearForm() {
  // Reset aircraft dropdown and hide custom input
  const sel = document.getElementById('f-type-select');
  const custom = document.getElementById('f-type-custom');
  if (sel) sel.value = '';
  if (custom) { custom.value = ''; custom.style.display = 'none'; }

  ['f-date','f-reg','f-rating','f-pic','f-copilot','f-route','f-remarks',
   'f-block','f-duty','f-total','f-me-day-dual','f-me-day-pic','f-me-day-cop',
   'f-me-night-dual','f-me-night-pic','f-me-night-cop','f-xc-day-dual','f-xc-day-pic',
   'f-xc-night-dual','f-xc-night-pic','f-ldg-day','f-ldg-night',
   'f-inst-actual','f-inst-hood','f-inst-sim','f-picus'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function cancelForm() {
  editingId = null;
  showPage('logbook');
}

// ═══════════════════════════════════════════
// IMPORT — PHOTO (AI)
// ═══════════════════════════════════════════
async function handlePhotoImport(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const box = document.getElementById('aiBox');
  const msg = document.getElementById('aiMsg');
  box.classList.add('show');
  msg.textContent = 'READING LOGBOOK IMAGE...';

  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  try {
    msg.textContent = 'AI EXTRACTING FLIGHT DATA...';
    const resp = await fetch('https://logbook-api.martindaoust33.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: b64 } },
            { type: 'text', text: `This is a page from a Canadian ICAO pilot logbook. Extract ALL flight entries visible.
RESPOND WITH ONLY A JSON ARRAY. NO TEXT BEFORE OR AFTER. START WITH [ END WITH ].
[{"date":"YYYY-MM-DD","type":"","reg":"","pic":"","copilot":"","route":"","total":0,"meDayPic":0,"meNightPic":0,"meDayDual":0,"meNightDual":0,"meDayCop":0,"meNightCop":0,"xcDayPic":0,"xcNightPic":0,"xcDayDual":0,"xcNightDual":0,"ldgDay":0,"ldgNight":0,"instActual":0,"picus":0,"block":0}]
Use 0 for empty fields. Infer year from context if not explicit.` }
          ]
        }]
      })
    });

    const data = await resp.json();
    const text = data.content?.map(c => c.text || '').join('') || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const extracted = JSON.parse(clean);
    box.classList.remove('show');
    showImportPreview(extracted, `${extracted.length} flight${extracted.length !== 1 ? 's' : ''} extracted from photo — review before import`);
  } catch(e) {
    box.classList.remove('show');
    showToast('Could not parse image — try a clearer photo', 'error');
    console.error(e);
  }
}

function toggleNavbluePanel() {
  const p = document.getElementById('navbluePanel');
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
}

async function parseNavbluePDF(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  document.getElementById('navbluePanel').style.display = 'none';

  const box = document.getElementById('aiBox');
  const msg = document.getElementById('aiMsg');
  box.classList.add('show');
  msg.textContent = 'READING NAVBLUE ROSTER PDF...';

  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  try {
    msg.textContent = 'AI EXTRACTING FLIGHTS...';
    const resp = await fetch('https://logbook-api.martindaoust33.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8000,
        system: 'You are a data extraction API. You ONLY output valid JSON arrays. Never include explanations, markdown, or text outside the JSON array. If you cannot extract anything, return [].',
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
            { type: 'text', text: `This is a Porter Airlines Navblue HrRosterReport PDF. Extract ONLY real flight legs Martin Daoust operated as F/O.

SKIP these activity codes (NOT flights): VAC, GD, SDO, REAX, HTL, PER, LM, BO, DH, RDG, P32### (P followed by 5 digits = deadhead positioning).

KEEP only PD### flights (Porter mainline) where Martin was crew operating.

Output a JSON array. If nothing to extract, output [].
Format per flight:
{"date":"YYYY-MM-DD","flightNum":"PD150","type":"E195-E2","reg":"C-XXXX","pic":"Captain Name","copilot":"M. Daoust","route":"YOW-YYZ","block":1.10,"duty":1.50,"total":1.10,"meDayCop":1.10,"meNightCop":0,"meDayPic":0,"meNightPic":0,"meDayDual":0,"meNightDual":0,"xcDayPic":0,"xcNightPic":0,"xcDayDual":0,"xcNightDual":0,"ldgDay":1,"ldgNight":0,"instActual":0,"picus":0}

RULES:
- Only completed flights (date <= today)
- BLH column = block hours (convert HH:MM to decimal, e.g. 4:30 → 4.50)
- Pilot is F/O (SIC): put block into meDayCop (day landings) or meNightCop (night landings)
- ldgDay/ldgNight: 1 per leg landing during day/night
- type: "E195-E2" for 295, "DH4" for Dash 8 Q400` }
          ]
        }]
      })
    });

    const rawText = await resp.text();
    console.log('[Navblue] Worker HTTP status:', resp.status);
    console.log('[Navblue] Worker raw response (first 500 chars):', rawText.substring(0, 500));

    if (!resp.ok) {
      throw new Error(`Worker error ${resp.status}: ${rawText.substring(0, 200)}`);
    }

    let data;
    try { data = JSON.parse(rawText); } catch(e) {
      throw new Error('Worker did not return JSON. Response: ' + rawText.substring(0, 200));
    }

    // Anthropic API error inside the worker response?
    if (data.error) {
      throw new Error(`Anthropic API error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const text = data.content?.map(c => c.text || '').join('') || '';
    console.log('[Navblue] AI response text (first 800 chars):', text.substring(0, 800));

    if (!text.trim()) {
      throw new Error('AI returned empty response. Check worker logs / API key.');
    }

    // Strip markdown fences if present
    const clean = text.replace(/```(?:json)?/gi, '').trim();

    // Find a JSON array — prefer the largest [...] block (handles nested objects)
    let match = clean.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!match) match = clean.match(/\[\s*\]/);  // empty array fallback
    if (!match) {
      // The AI replied with text instead of JSON — surface what it said
      throw new Error(`AI did not return JSON. It said: "${clean.substring(0, 250)}"`);
    }

    let extracted;
    try { extracted = JSON.parse(match[0]); } catch(e) {
      throw new Error('Malformed JSON from AI: ' + match[0].substring(0, 200));
    }

    if (!Array.isArray(extracted) || extracted.length === 0) {
      throw new Error('AI found no flights to import in this PDF.');
    }

    const today = new Date().toISOString().split('T')[0];
    // Strict: only flights from BEFORE today (today's flight may still be in progress)
    const filtered = extracted.filter(f => f.date && f.date < today && f.block > 0);
    console.log(`[Navblue] Extracted ${extracted.length} entries, ${filtered.length} after filtering completed flights (date < today, block > 0).`);

    if (filtered.length === 0) {
      throw new Error(`AI extracted ${extracted.length} entries but none are completed (date must be before today and block > 0).`);
    }

    box.classList.remove('show');
    showImportPreview(filtered, `${filtered.length} flight${filtered.length !== 1 ? 's' : ''} extracted from Navblue PDF — review before import`);
  } catch(e) {
    box.classList.remove('show');
    showToast(e.message || 'Could not parse PDF', 'error');
    console.error('[Navblue] Error:', e);
  }
}

function handleDrop(event, type) {
  event.preventDefault();
  document.getElementById(type+'Zone').classList.remove('dragover');
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (type === 'photo') {
    const dt = new DataTransfer(); dt.items.add(file);
    document.getElementById('photoInput').files = dt.files;
    handlePhotoImport(document.getElementById('photoInput'));
  }
}

function showImportPreview(list, subtitle) {
  // Each entry gets a `selected` flag (default true)
  pendingImport = list.map(f => ({ ...f, selected: true }));
  const sub = document.getElementById('importSubtitle');
  if (sub) sub.textContent = subtitle || `${list.length} flight${list.length !== 1 ? 's' : ''} found — select what to import`;
  renderImportPreview();
  const overlay = document.getElementById('importPreview');
  overlay.classList.add('show');
  // Lock body scroll while modal is open
  document.body.style.overflow = 'hidden';
}

function renderImportPreview() {
  const container = document.getElementById('extractedList');
  if (!pendingImport.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-family:var(--font-mono);font-size:12px">No flights found.</p>';
    updateImportButton();
    return;
  }
  container.innerHTML = `
    <div class="import-bulk-bar">
      <span class="eyebrow" id="importCount">0 of 0 selected</span>
      <div style="display:flex; gap:8px;">
        <button type="button" class="btn btn-ghost btn-sm" onclick="toggleAllImport(true)">Select all</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick="toggleAllImport(false)">Deselect all</button>
      </div>
    </div>
    ${pendingImport.map((f, i) => `
      <label class="review-item ${f.selected ? 'is-selected' : 'is-deselected'}" for="imp-${i}">
        <input type="checkbox" id="imp-${i}" class="review-check"
               ${f.selected ? 'checked' : ''}
               onchange="toggleImportItem(${i}, this.checked)">
        <div class="review-body">
          <div class="review-item-header">#${i+1} · ${esc(f.date)} · ${esc(f.flightNum || f.reg || '?')} · ${esc(f.route || '?')}</div>
          <div class="review-fields">
            <div class="review-field"><span>Total</span> ${+f.total||0}h</div>
            <div class="review-field"><span>Block</span> ${+f.block || 0}h</div>
            <div class="review-field"><span>PIC Day</span> ${+f.meDayPic || 0}h</div>
            <div class="review-field"><span>PIC Night</span> ${+f.meNightPic || 0}h</div>
            ${(f.meDayCop || f.meNightCop) ? `<div class="review-field"><span>SIC</span> ${((+f.meDayCop||0)+(+f.meNightCop||0)).toFixed(2)}h</div>` : ''}
            <div class="review-field"><span>Ldg</span> ${(+f.ldgDay || 0) + (+f.ldgNight || 0)}</div>
            ${f.pic ? `<div class="review-field"><span>PIC</span> ${esc(f.pic)}</div>` : ''}
          </div>
        </div>
      </label>`).join('')}
  `;
  updateImportButton();
}

function toggleImportItem(idx, checked) {
  if (pendingImport[idx]) pendingImport[idx].selected = checked;
  // Toggle visual class on the label without full re-render (keeps scroll position)
  const el = document.querySelector(`label[for="imp-${idx}"]`);
  if (el) {
    el.classList.toggle('is-selected', checked);
    el.classList.toggle('is-deselected', !checked);
  }
  updateImportButton();
}

function toggleAllImport(checked) {
  pendingImport.forEach(f => f.selected = checked);
  renderImportPreview();
}

function updateImportButton() {
  const selected = pendingImport.filter(f => f.selected).length;
  const total = pendingImport.length;
  const counter = document.getElementById('importCount');
  if (counter) counter.textContent = `${selected} of ${total} selected`;
  const btn = document.getElementById('importConfirmBtn');
  if (btn) {
    btn.textContent = selected > 0 ? `✅ Import ${selected} flight${selected !== 1 ? 's' : ''}` : 'Nothing to import';
    btn.disabled = selected === 0;
  }
}

function confirmImport() {
  const toImport = pendingImport.filter(f => f.selected);
  const count = toImport.length;
  if (count === 0) {
    showToast('Nothing selected to import', 'error');
    return;
  }
  toImport.forEach(f => {
    const { selected, ...flightData } = f;  // strip the selected flag
    flights.push({ ...flightData, id: Date.now().toString() + Math.random() });
  });
  DB.save(flights);
  pendingImport = [];
  closeImportOverlay();
  showToast(count + ' flight' + (count !== 1 ? 's' : '') + ' imported ✓', 'success');
  showPage('logbook');
}

function cancelImport() {
  pendingImport = [];
  closeImportOverlay();
}

function closeImportOverlay() {
  const overlay = document.getElementById('importPreview');
  if (overlay) overlay.classList.remove('show');
  document.body.style.overflow = '';
}

// Close modals on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const importOverlay = document.getElementById('importPreview');
    if (importOverlay && importOverlay.classList.contains('show')) { cancelImport(); return; }
    const detailOverlay = document.getElementById('flightDetailOverlay');
    if (detailOverlay && detailOverlay.classList.contains('show')) closeFlightDetail();
  }
});

// ═══════════════════════════════════════════
// PILOT PROFILE TYPES (Feature 3)
// ═══════════════════════════════════════════
function setProfileType(type) {
  const p = DB.loadProfile();
  p.pilotType = type;
  DB.saveProfile(p);
  highlightProfileTypeCard(type);
  showToast('Profile type saved ✓', 'success');
}

function highlightProfileTypeCard(type) {
  ['airline705', 'private', 'student'].forEach(t => {
    const card = document.getElementById('pt-' + t);
    if (card) card.classList.toggle('active', t === type);
  });
}

function adaptFormToProfile(type) {
  const show = id => { const el = document.getElementById(id); if (el) el.style.display = ''; };
  const hide = id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
  const setLbl = (inputId, text) => {
    const el = document.getElementById(inputId);
    if (!el) return;
    const lbl = el.closest('.form-group')?.querySelector('label');
    if (lbl) lbl.textContent = text;
  };

  // Reset everything to default (airline705) first
  ['fg-block', 'fg-duty', 'fg-me-day-cop', 'fg-me-night-cop', 'fg-picus'].forEach(show);
  setLbl('f-pic',          'Pilot in Command');
  setLbl('f-copilot',      'Co-Pilot / Passenger');
  setLbl('f-me-day-pic',   'ME Day — PIC');
  setLbl('f-me-night-pic', 'ME Night — PIC');
  setLbl('f-me-day-dual',  'ME Day — Dual');
  setLbl('f-me-night-dual','ME Night — Dual');

  if (type === 'private') {
    hide('fg-duty');
    hide('fg-me-day-cop');
    hide('fg-me-night-cop');
    hide('fg-picus');
  } else if (type === 'student') {
    hide('fg-block');
    hide('fg-duty');
    hide('fg-me-day-cop');
    hide('fg-me-night-cop');
    hide('fg-picus');
    setLbl('f-pic',          'Instructor');
    setLbl('f-copilot',      'Student Name');
    setLbl('f-me-day-pic',   'ME Day — Solo');
    setLbl('f-me-night-pic', 'ME Night — Solo');
    setLbl('f-me-day-dual',  'ME Day — Dual (Instruction)');
    setLbl('f-me-night-dual','ME Night — Dual (Instruction)');
  }
}

// ═══════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════
// 705 operators (CAR Subpart 705 — Airline Operations).
// Used to auto-enable the "1 IFR approach per flight" toggle.
// Kept in sync with the #p-airlineSelect 705 optgroup.
const AIRLINES_705 = [
  'Air Canada',
  'Air Canada Express / Jazz',
  'WestJet',
  'WestJet Encore',
  'Air Transat',
  'Porter Airlines',
  'Flair Airlines',
  'Canadian North'
];
function isAirline705(airlineName) {
  return AIRLINES_705.includes((airlineName || '').trim());
}

function loadProfile() {
  const p = DB.loadProfile();
  sv('p-fname', p.fname || 'Martin');
  sv('p-lname', p.lname || 'Daoust');
  document.getElementById('p-rank').value = p.rank || 'F/O';
  // Airline: try to pre-select the dropdown if the saved value matches a known option.
  // Case-insensitive matching + partial (e.g. "Porter" matches "Porter Airlines|PD").
  const airlineName = (p.airline || 'Porter Airlines').trim();
  const sel = document.getElementById('p-airlineSelect');
  if (sel) {
    const lower = airlineName.toLowerCase();
    const matchOpt = [...sel.options].find(o => {
      if (!o.value || o.value === 'other' || o.value === 'none') return false;
      const optName = o.value.split('|')[0].toLowerCase();
      return optName === lower || optName.includes(lower) || lower.includes(optName);
    });
    if (matchOpt) {
      sel.value = matchOpt.value;
      document.getElementById('p-airline-custom-wrap').style.display = 'none';
    } else if (airlineName) {
      sel.value = 'other';
      document.getElementById('p-airline-custom-wrap').style.display = 'block';
      sv('p-airline', airlineName);
    }
  }
  sv('p-license', p.license);
  sv('p-medical', p.medical);
  sv('p-base', p.base || 'YOW');
  sv('p-fleet', p.fleet || 'E195-E2');
  sv('p-operatorCodes', p.operatorCodes || 'PD');
  // IFR approach auto-count: default ON when the saved airline is a 705 operator,
  // OFF otherwise. Once the user explicitly saves a value, that value sticks.
  const autoCb = document.getElementById('p-autoCountIFR');
  if (autoCb) {
    const inferred = isAirline705(p.airline);
    autoCb.checked = (p.autoCountIFR !== undefined) ? !!p.autoCountIFR : inferred;
    autoCb.closest('label').classList.toggle('is-on', autoCb.checked);
    autoCb.onchange = () => autoCb.closest('label').classList.toggle('is-on', autoCb.checked);
  }
  // Aircraft configurations checkboxes
  const acConfigs = p.acConfigs || ['wheels'];
  document.querySelectorAll('#p-acConfigs input[type=checkbox]').forEach(cb => {
    cb.checked = acConfigs.includes(cb.value);
    cb.closest('label').classList.toggle('is-on', cb.checked);
    cb.onchange = () => cb.closest('label').classList.toggle('is-on', cb.checked);
  });
  highlightProfileTypeCard(p.pilotType || 'airline705');
  updateProfileDisplay(p);
}

function onAirlineSelectChange() {
  const sel = document.getElementById('p-airlineSelect');
  const customWrap = document.getElementById('p-airline-custom-wrap');
  const v = sel.value;
  if (v === 'other') {
    customWrap.style.display = 'block';
    sv('p-airline', '');
    return;
  }
  if (v === 'none' || v === '') {
    customWrap.style.display = 'none';
    sv('p-airline', '');
    return;
  }
  // Selected airline format = "Name|CODE"
  const [name, code] = v.split('|');
  customWrap.style.display = 'none';
  sv('p-airline', name);
  // Auto-fill the operator codes input (if user wants to override, they still can)
  const codesInput = document.getElementById('p-operatorCodes');
  if (codesInput && code) {
    const existing = (codesInput.value || '').toUpperCase().replace(/\s/g, '');
    if (!existing.split(',').includes(code)) {
      // Append code if not already in the list
      codesInput.value = existing ? `${existing},${code}` : code;
    }
  }
  // Auto-set the IFR approach auto-count toggle based on operator category.
  // 705 ops → ON (every flight has an IAP). 704 / 703 / Other → OFF (manual per flight).
  const autoCb = document.getElementById('p-autoCountIFR');
  if (autoCb) {
    const opt = sel.options[sel.selectedIndex];
    const grp = opt && opt.parentElement && opt.parentElement.tagName === 'OPTGROUP' ? opt.parentElement : null;
    autoCb.checked = grp && grp.label && grp.label.startsWith('705');
    autoCb.closest('label').classList.toggle('is-on', autoCb.checked);
  }
}

function saveProfile() {
  const existing = DB.loadProfile();
  const sel = document.getElementById('p-airlineSelect');
  let airline = '';
  if (sel.value === 'other') {
    airline = gv('p-airline');
  } else if (sel.value && sel.value !== 'none' && sel.value !== '') {
    airline = sel.value.split('|')[0];
  }
  const p = {
    fname: gv('p-fname'),
    lname: gv('p-lname'),
    rank: gv('p-rank'),
    airline: airline,
    license: gv('p-license'),
    medical: gv('p-medical'),
    base: gv('p-base'),
    fleet: gv('p-fleet'),
    operatorCodes: (gv('p-operatorCodes') || 'PD').toUpperCase().replace(/\s/g, ''),
    autoCountIFR: !!document.getElementById('p-autoCountIFR')?.checked,
    acConfigs: [...document.querySelectorAll('#p-acConfigs input[type=checkbox]:checked')].map(cb => cb.value),
    pilotType: existing.pilotType || 'airline705',
  };
  DB.saveProfile(p);
  updateProfileDisplay(p);
  showToast('Profile saved ✓', 'success');
}

function updateProfileDisplay(p) {
  const name = `${p.rank||'F/O'} ${p.fname||''} ${p.lname||''}`.trim();
  document.getElementById('profileNameDisp').textContent = name;
  document.getElementById('profileRoleDisp').textContent = p.airline || 'Porter Airlines';
  document.querySelector('.pilot-name').textContent = name;
}

// ═══════════════════════════════════════════
// NAVBLUE iCal AUTO-SYNC
// ═══════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────
//  LOGBOOK COLUMNS — defined per Transport Canada CAR 401.08(2)
//  + Standard 421 (experience categories needed for ATPL / currency).
//  Each column has:
//    key       — field name in the flight object
//    label     — display name (TC official terminology)
//    short     — compact label for narrow columns
//    group     — section grouping for the Settings UI
//    width     — relative width hint (pdf + table)
//    align     — left | right | center
//    decimal   — hours field (rendered as 0.1h)
//    default   — whether shown by default
//    role      — only relevant for which pilot type
// ─────────────────────────────────────────────────────────────────
const LOGBOOK_COLUMNS = [
  // Identification (CAR 401.08(2)(a)(b)(c)(e)(f))
  { key: 'date',         label: 'Date',                short: 'Date',     group: 'Identification', width: 18, align: 'left',   default: true },
  { key: 'flightNum',    label: 'Flight #',            short: 'Flt#',     group: 'Identification', width: 14, align: 'left',   default: false },
  { key: 'type',         label: 'A/C Type',            short: 'Type',     group: 'Identification', width: 16, align: 'left',   default: true },
  { key: 'reg',          label: 'Registration',        short: 'Reg',      group: 'Identification', width: 16, align: 'left',   default: true },
  { key: 'dep_icao',     label: 'From',                short: 'From',     group: 'Identification', width: 12, align: 'left',   default: false },
  { key: 'via',          label: 'Via (intermediate)',  short: 'Via',      group: 'Identification', width: 14, align: 'left',   default: false },
  { key: 'arr_icao',     label: 'To',                  short: 'To',       group: 'Identification', width: 12, align: 'left',   default: false },
  { key: 'route',        label: 'Route',               short: 'Route',    group: 'Identification', width: 18, align: 'left',   default: true },
  { key: 'pic',          label: 'Pilot in Command',    short: 'PIC',      group: 'Identification', width: 22, align: 'left',   default: true },
  { key: 'copilot',      label: 'Co-pilot',            short: 'Cop',      group: 'Identification', width: 22, align: 'left',   default: false },
  { key: 'crewPosition', label: 'Crew Position',       short: 'Position', group: 'Identification', width: 14, align: 'left',   default: false },

  // Flight conditions (CAR 401.08(2)(d))
  { key: 'day',          label: 'Day',                 short: 'Day',      group: 'Conditions',     width: 10, align: 'right', decimal: true, default: false },
  { key: 'night',        label: 'Night',               short: 'Night',    group: 'Conditions',     width: 10, align: 'right', decimal: true, default: true },
  { key: 'vfr',          label: 'VFR',                 short: 'VFR',      group: 'Conditions',     width: 10, align: 'right', decimal: true, default: false },
  { key: 'ifr',          label: 'IFR',                 short: 'IFR',      group: 'Conditions',     width: 10, align: 'right', decimal: true, default: false },

  // Times (CAR 401.08(2)(g))
  { key: 'block',        label: 'Flight Time',         short: 'Flt Time', group: 'Times',          width: 12, align: 'right', decimal: true, default: true },
  { key: 'duty',         label: 'Duty Time',           short: 'Duty',     group: 'Times',          width: 10, align: 'right', decimal: true, default: false },

  // Engine class (Standard 421)
  { key: 'seDay',        label: 'SE Day',              short: 'SE Day',   group: 'Engine class',   width: 10, align: 'right', decimal: true, default: false },
  { key: 'seNight',      label: 'SE Night',            short: 'SE Ngt',   group: 'Engine class',   width: 10, align: 'right', decimal: true, default: false },
  { key: 'meDayPic',     label: 'ME Day PIC',          short: 'MED PIC',  group: 'Engine class',   width: 11, align: 'right', decimal: true, default: false },
  { key: 'meNightPic',   label: 'ME Night PIC',        short: 'MEN PIC',  group: 'Engine class',   width: 11, align: 'right', decimal: true, default: false },
  { key: 'meDayCop',     label: 'ME Day SIC',          short: 'MED SIC',  group: 'Engine class',   width: 11, align: 'right', decimal: true, default: true },
  { key: 'meNightCop',   label: 'ME Night SIC',        short: 'MEN SIC',  group: 'Engine class',   width: 11, align: 'right', decimal: true, default: true },
  { key: 'meDayDual',    label: 'ME Day Dual',         short: 'MED Dual', group: 'Engine class',   width: 11, align: 'right', decimal: true, default: false },
  { key: 'meNightDual',  label: 'ME Night Dual',       short: 'MEN Dual', group: 'Engine class',   width: 11, align: 'right', decimal: true, default: false },

  // Cross-country (Standard 421, CAR 401.34)
  { key: 'xcDay',        label: 'XC Day',              short: 'XC Day',   group: 'Cross-country',  width: 10, align: 'right', decimal: true, default: false },
  { key: 'xcNight',      label: 'XC Night',            short: 'XC Ngt',   group: 'Cross-country',  width: 10, align: 'right', decimal: true, default: false },

  // Instrument (Standard 421 — split per inspector best practice)
  { key: 'instActual',   label: 'Inst Actual',         short: 'InstA',    group: 'Instrument',     width: 10, align: 'right', decimal: true, default: false },
  { key: 'instHood',     label: 'Inst Hood',           short: 'InstH',    group: 'Instrument',     width: 10, align: 'right', decimal: true, default: false },
  { key: 'instSim',      label: 'Inst Sim/FSTD',       short: 'InstSim',  group: 'Instrument',     width: 11, align: 'right', decimal: true, default: false },
  { key: 'approaches',   label: 'Approaches',          short: 'App',      group: 'Instrument',     width: 9,  align: 'right', default: false },

  // Take-offs & Landings (CAR 401.05 currency)
  { key: 'toDay',        label: 'T/O Day',             short: 'T/O D',    group: 'Landings',       width: 9,  align: 'right', default: false },
  { key: 'toNight',      label: 'T/O Night',           short: 'T/O N',    group: 'Landings',       width: 9,  align: 'right', default: false },
  { key: 'ldgDay',       label: 'LDG Day',             short: 'L Day',    group: 'Landings',       width: 9,  align: 'right', default: false },
  { key: 'ldgNight',     label: 'LDG Night',           short: 'L Ngt',    group: 'Landings',       width: 9,  align: 'right', default: false },

  // Simulator (CAR 401.08 + Standard 421 — sim time must be separate from flight time)
  { key: 'isSim',        label: 'Simulator',           short: 'SIM',      group: 'Simulator',      width: 9,  align: 'center', default: false },
  { key: 'simType',      label: 'Sim Type (FFS/FTD)',  short: 'SimType',  group: 'Simulator',      width: 14, align: 'left',   default: false },
  { key: 'simSession',   label: 'Session Type',        short: 'Session',  group: 'Simulator',      width: 16, align: 'left',   default: false },
  { key: 'simRegistration', label: 'Sim Device ID',    short: 'Device',   group: 'Simulator',      width: 14, align: 'left',   default: false },

  // Other
  { key: 'picus',        label: 'PICUS',               short: 'PICUS',    group: 'Other',          width: 10, align: 'right', decimal: true, default: false },
  { key: 'multiCrew',    label: 'Multi-Crew',          short: 'MC',       group: 'Other',          width: 9,  align: 'center', default: false },
  { key: 'remarks',      label: 'Remarks',             short: 'Remarks',  group: 'Other',          width: 24, align: 'left',  default: false },

  // Computed total (always shown)
  { key: 'total',        label: 'Total',               short: 'Total',    group: 'Times',          width: 12, align: 'right', decimal: true, default: true }
];

const COLUMN_PREFS_KEY = 'cumulo_column_prefs_v1';

function loadColumnPrefs() {
  try {
    const raw = localStorage.getItem(COLUMN_PREFS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveColumnPrefs(prefs) {
  localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(prefs));
}

function getVisibleColumns(context = 'table') {
  // context: 'table' (logbook page) or 'pdf' (export)
  const prefs = loadColumnPrefs() || {};
  const visible = LOGBOOK_COLUMNS.filter(c => {
    const pref = prefs[c.key];
    return pref === undefined ? c.default : pref === true;
  });
  // Always include 'total' as final column
  if (!visible.find(c => c.key === 'total')) {
    visible.push(LOGBOOK_COLUMNS.find(c => c.key === 'total'));
  }
  return visible;
}

// Compute derived fields on the fly (sum aggregates)
function computeCellValue(f, key) {
  switch (key) {
    case 'day':         return ((+f.meDayPic||0)+(+f.meDayCop||0)+(+f.meDayDual||0)+(+f.seDay||0));
    case 'night':       return ((+f.meNightPic||0)+(+f.meNightCop||0)+(+f.meNightDual||0)+(+f.seNight||0));
    case 'ifr':         return ((+f.instActual||0)+(+f.instHood||0));
    case 'vfr':         {
      const total = +f.total || +f.block || 0;
      const ifr = (+f.instActual||0)+(+f.instHood||0);
      return Math.max(0, total - ifr);
    }
    case 'xcDay':       return ((+f.xcDayPic||0)+(+f.xcDayCop||0)+(+f.xcDayDual||0));
    case 'xcNight':     return ((+f.xcNightPic||0)+(+f.xcNightCop||0)+(+f.xcNightDual||0));
    case 'crewPosition': {
      if ((+f.meDayPic||0)+(+f.meNightPic||0)+(+f.seDay||0) > 0) return 'PIC';
      if ((+f.meDayDual||0)+(+f.meNightDual||0) > 0) return 'Dual';
      if ((+f.meDayCop||0)+(+f.meNightCop||0) > 0) return 'SIC';
      return '—';
    }
    case 'multiCrew':   return f.multiCrew ? '✓' : '—';
    case 'toDay':       return f.toDay !== undefined ? f.toDay : (f.ldgDay || 0);
    case 'toNight':     return f.toNight !== undefined ? f.toNight : (f.ldgNight || 0);
    default:            return f[key];
  }
}

const NAVBLUE_URL_KEY = 'cumulo_navblue_url';
const NAVBLUE_LAST_SYNC_KEY = 'cumulo_navblue_last_sync';
const WORKER_URL = 'https://logbook-api.martindaoust33.workers.dev';

// ─────────────────────────────────────────────────────────────────
//  AIRPORT COORDS — needed for night-time (RAC 101.01) and
//  cross-country (CAR 401.34) calculations
// ─────────────────────────────────────────────────────────────────
const AIRPORT_COORDS = {
  // Canada
  CYOW: { lat: 45.3225, lon: -75.6692, name: 'Ottawa' },
  CYYZ: { lat: 43.6777, lon: -79.6248, name: 'Toronto Pearson' },
  CYYC: { lat: 51.1140, lon: -114.0203, name: 'Calgary' },
  CYVR: { lat: 49.1939, lon: -123.1844, name: 'Vancouver' },
  CYYJ: { lat: 48.6469, lon: -123.4258, name: 'Victoria' },
  CYHZ: { lat: 44.8808, lon: -63.5089, name: 'Halifax' },
  CYEG: { lat: 53.3097, lon: -113.5800, name: 'Edmonton' },
  CYYT: { lat: 47.6186, lon: -52.7519, name: "St. John's" },
  CYTZ: { lat: 43.6275, lon: -79.3961, name: 'Toronto Billy Bishop' },
  CYQB: { lat: 46.7911, lon: -71.3933, name: 'Quebec City' },
  CYUL: { lat: 45.4706, lon: -73.7408, name: 'Montreal' },
  CYHM: { lat: 43.1731, lon: -79.9347, name: 'Hamilton' },
  CYQT: { lat: 48.3717, lon: -89.3239, name: 'Thunder Bay' },
  CYQR: { lat: 50.4319, lon: -104.6660, name: 'Regina' },
  CYXE: { lat: 52.1708, lon: -106.6997, name: 'Saskatoon' },
  CYQM: { lat: 46.1122, lon: -64.6786, name: 'Moncton' },
  CYWG: { lat: 49.9100, lon: -97.2398, name: 'Winnipeg' },
  CYFB: { lat: 63.7564, lon: -68.5558, name: 'Iqaluit' },
  CYYG: { lat: 46.2900, lon: -63.1211, name: 'Charlottetown' },
  CYQX: { lat: 48.9369, lon: -54.5681, name: 'Gander' },
  CYDF: { lat: 49.2108, lon: -57.3914, name: 'Deer Lake' },
  CYQY: { lat: 46.1614, lon: -60.0478, name: 'Sydney' },
  CYSJ: { lat: 45.3161, lon: -65.8903, name: 'Saint John' },
  CYQI: { lat: 43.8269, lon: -66.0881, name: 'Yarmouth' },
  CYZF: { lat: 62.4628, lon: -114.4403, name: 'Yellowknife' },
  CYXY: { lat: 60.7095, lon: -135.0672, name: 'Whitehorse' },
  CYXX: { lat: 49.0252, lon: -122.3611, name: 'Abbotsford' },
  CYLW: { lat: 49.9561, lon: -119.3778, name: 'Kelowna' },
  CYKA: { lat: 50.7022, lon: -120.4444, name: 'Kamloops' },
  CYXS: { lat: 53.8894, lon: -122.6789, name: 'Prince George' },
  // USA
  KBOS: { lat: 42.3656, lon: -71.0096, name: 'Boston' },
  KJFK: { lat: 40.6398, lon: -73.7789, name: 'New York JFK' },
  KLGA: { lat: 40.7772, lon: -73.8726, name: 'New York LaGuardia' },
  KEWR: { lat: 40.6925, lon: -74.1687, name: 'Newark' },
  KPHL: { lat: 39.8729, lon: -75.2437, name: 'Philadelphia' },
  KDCA: { lat: 38.8521, lon: -77.0377, name: 'Washington Reagan' },
  KIAD: { lat: 38.9531, lon: -77.4565, name: 'Washington Dulles' },
  KMIA: { lat: 25.7959, lon: -80.2870, name: 'Miami' },
  KMCO: { lat: 28.4312, lon: -81.3081, name: 'Orlando' },
  KFLL: { lat: 26.0726, lon: -80.1527, name: 'Fort Lauderdale' },
  KTPA: { lat: 27.9755, lon: -82.5332, name: 'Tampa' },
  KLAX: { lat: 33.9416, lon: -118.4085, name: 'Los Angeles' },
  KSFO: { lat: 37.6213, lon: -122.3790, name: 'San Francisco' },
  KLAS: { lat: 36.0840, lon: -115.1537, name: 'Las Vegas' },
  KORD: { lat: 41.9742, lon: -87.9073, name: "Chicago O'Hare" },
  KMDW: { lat: 41.7868, lon: -87.7522, name: 'Chicago Midway' },
  KDEN: { lat: 39.8561, lon: -104.6737, name: 'Denver' },
  KPHX: { lat: 33.4373, lon: -112.0078, name: 'Phoenix' },
  // Mexico, Caribbean
  MMUN: { lat: 21.0365, lon: -86.8771, name: 'Cancun' },
  MMPR: { lat: 20.6801, lon: -105.2542, name: 'Puerto Vallarta' },
  MMSD: { lat: 23.1518, lon: -109.7211, name: 'San Jose del Cabo' },
  MYNN: { lat: 25.0390, lon: -77.4661, name: 'Nassau' },
  MDPC: { lat: 18.5675, lon: -68.3634, name: 'Punta Cana' },
  MDPP: { lat: 19.7579, lon: -70.5700, name: 'Puerto Plata' },
  MKJS: { lat: 18.5037, lon: -77.9134, name: 'Montego Bay' },
  TBPB: { lat: 13.0746, lon: -59.4925, name: 'Bridgetown' },
  TNCA: { lat: 12.5014, lon: -70.0152, name: 'Aruba' }
};

// ─────────────────────────────────────────────────────────────────
//  GEO / DISTANCE — Haversine + Cross-Country detection
//  CAR 401.34 : cross-country = straight-line distance > 25 NM (46.3 km)
// ─────────────────────────────────────────────────────────────────
function haversineKM(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2
          + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180)
          * Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function isCrossCountry(depICAO, arrICAO) {
  if (!depICAO || !arrICAO || depICAO === arrICAO) return false;
  const dep = AIRPORT_COORDS[depICAO];
  const arr = AIRPORT_COORDS[arrICAO];
  if (!dep || !arr) {
    // Unknown airports — conservative: assume XC if ICAO codes differ
    return depICAO !== arrICAO;
  }
  return haversineKM(dep.lat, dep.lon, arr.lat, arr.lon) > 46.3;
}

// ─────────────────────────────────────────────────────────────────
//  SUNRISE / SUNSET — NOAA solar position algorithm
//  Returns { sunriseUTC, sunsetUTC, polar } for the given UTC date + coords
// ─────────────────────────────────────────────────────────────────
function calcSunriseSunset(date, lat, lon) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const startUTC = Date.UTC(y, 0, 1);
  const dayOfYear = Math.floor((Date.UTC(y, m-1, d) - startUTC) / 86400000) + 1;

  const gamma = 2 * Math.PI / 365 * (dayOfYear - 1);
  const decl = 0.006918 - 0.399912*Math.cos(gamma) + 0.070257*Math.sin(gamma)
             - 0.006758*Math.cos(2*gamma) + 0.000907*Math.sin(2*gamma)
             - 0.002697*Math.cos(3*gamma) + 0.00148*Math.sin(3*gamma);
  const eot = 229.18 * (0.000075 + 0.001868*Math.cos(gamma) - 0.032077*Math.sin(gamma)
            - 0.014615*Math.cos(2*gamma) - 0.040849*Math.sin(2*gamma));

  const solarNoonMin = 720 - 4*lon - eot;

  const latRad = lat * Math.PI / 180;
  const zenith = 90.833 * Math.PI / 180;
  const cosH = (Math.cos(zenith) - Math.sin(latRad)*Math.sin(decl))
             / (Math.cos(latRad) * Math.cos(decl));

  if (cosH > 1)  return { sunriseUTC: null, sunsetUTC: null, polar: 'night' };
  if (cosH < -1) return { sunriseUTC: null, sunsetUTC: null, polar: 'day' };

  const H_min = Math.acos(cosH) * 180 / Math.PI * 4;
  const sunriseMin = solarNoonMin - H_min;
  const sunsetMin  = solarNoonMin + H_min;

  const dayStart = Date.UTC(y, m-1, d);
  return {
    sunriseUTC: new Date(dayStart + sunriseMin * 60000),
    sunsetUTC:  new Date(dayStart + sunsetMin * 60000),
    polar: null
  };
}

// "Is this UTC time considered night under RAC 101.01 at this location?"
// Night = from 30 min after sunset to 30 min before sunrise.
function isNightUTC(utcTime, lat, lon) {
  const ss = calcSunriseSunset(utcTime, lat, lon);
  if (ss.polar === 'night') return true;
  if (ss.polar === 'day')   return false;
  const halfHour = 30 * 60 * 1000;
  const nightStart = new Date(ss.sunsetUTC.getTime() + halfHour);
  const nightEndMorning = new Date(ss.sunriseUTC.getTime() - halfHour);
  // RAC night spans midnight: it's night either after nightStart (today)
  // or before nightEndMorning (today, early hours).
  return utcTime >= nightStart || utcTime <= nightEndMorning;
}

// Calculate the day/night split (in hours) of a flight given its
// UTC block-off / block-on times and dep/arr coords.
// Sampling at 1-minute resolution (max 360 samples for a 6h flight = fast).
function calculateDayNightSplit(blockOffUTC, blockOnUTC, depCoords, arrCoords) {
  const totalMs = blockOnUTC.getTime() - blockOffUTC.getTime();
  if (totalMs <= 0) return { dayHours: 0, nightHours: 0 };
  const totalHours = totalMs / 3600000;

  // Use midpoint coords (good enough for non-polar flights up to 6h)
  const lat = (depCoords.lat + arrCoords.lat) / 2;
  const lon = (depCoords.lon + arrCoords.lon) / 2;

  const stepMs = 60000;
  let nightMs = 0;
  for (let t = blockOffUTC.getTime(); t < blockOnUTC.getTime(); t += stepMs) {
    if (isNightUTC(new Date(t), lat, lon)) nightMs += stepMs;
  }
  // Account for the final partial minute
  const remainder = (blockOnUTC.getTime() - blockOffUTC.getTime()) % stepMs;
  if (remainder > 0 && isNightUTC(new Date(blockOnUTC.getTime() - 1), lat, lon)) {
    nightMs += remainder;
  }
  const nightHours = +(nightMs / 3600000).toFixed(2);
  const dayHours = +(totalHours - nightHours).toFixed(2);
  return { dayHours, nightHours };
}

// Build a UTC Date from a flight date "YYYY-MM-DD" + UTC time "HHMM"
function buildUTCDateTime(yyyyMmDd, hhmm) {
  if (!yyyyMmDd || !hhmm || hhmm.length !== 4) return null;
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const hh = +hhmm.substring(0, 2);
  const mm = +hhmm.substring(2, 4);
  if (isNaN(y) || isNaN(hh)) return null;
  return new Date(Date.UTC(y, m-1, d, hh, mm));
}

// IATA → ICAO map for destinations Porter operates.
// For unknown IATA codes starting with Y (typically Canadian), we prefix with "C".
const IATA_TO_ICAO = {
  // Canada (most Porter routes — preserving full ICAO)
  YOW:'CYOW', YYZ:'CYYZ', YYC:'CYYC', YVR:'CYVR', YYJ:'CYYJ', YHZ:'CYHZ',
  YEG:'CYEG', YYT:'CYYT', YTZ:'CYTZ', YQB:'CYQB', YUL:'CYUL', YHM:'CYHM',
  YQT:'CYQT', YQR:'CYQR', YXE:'CYXE', YQM:'CYQM', YWG:'CYWG', YFB:'CYFB',
  YYG:'CYYG', YQX:'CYQX', YDF:'CYDF', YQY:'CYQY', YSJ:'CYSJ', YQI:'CYQI',
  YZF:'CYZF', YXY:'CYXY', YXX:'CYXX', YLW:'CYLW', YKA:'CYKA', YXS:'CYXS',
  YBR:'CYBR', YPR:'CYPR', YZT:'CYZT', YOJ:'CYOJ',
  // USA (Porter International)
  BOS:'KBOS', JFK:'KJFK', LGA:'KLGA', EWR:'KEWR', PHL:'KPHL', DCA:'KDCA',
  IAD:'KIAD', MIA:'KMIA', MCO:'KMCO', FLL:'KFLL', TPA:'KTPA', LAX:'KLAX',
  SFO:'KSFO', LAS:'KLAS', ORD:'KORD', MDW:'KMDW', DEN:'KDEN', PHX:'KPHX',
  // Mexico, Caribbean
  CUN:'MMUN', PVR:'MMPR', SJD:'MMSD', NAS:'MYNN', POP:'MDPP', PUJ:'MDPC',
  MBJ:'MKJS', BGI:'TBPB', AUA:'TNCA'
};

function iataToIcao(iata) {
  if (!iata) return '';
  const u = iata.toUpperCase().trim();
  if (u.length === 4) return u;  // already ICAO
  if (IATA_TO_ICAO[u]) return IATA_TO_ICAO[u];
  // Canadian fallback: prefix with C if 3 letters starting with Y
  if (u.length === 3 && u[0] === 'Y') return 'C' + u;
  return u;  // unknown — leave as-is
}

// Parse ICS text (handles RFC 5545 line-folding: continuation lines start with space/tab)
function parseICS(text) {
  // Unfold continuation lines
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') current = {};
    else if (line === 'END:VEVENT') { if (current) events.push(current); current = null; }
    else if (current) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const keyPart = line.substring(0, colon);
      const value = line.substring(colon + 1);
      const key = keyPart.split(';')[0];  // strip params like ;VALUE=DATE
      current[key] = value;
    }
  }
  return events;
}

// "HH:MM" → decimal hours (e.g. "4:30" → 4.50). Returns 0 if invalid.
function hhmmToDecimal(s) {
  if (!s) return 0;
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return +m[1] + (+m[2] / 60);
}

// "YYYYMMDD" or "YYYYMMDDTHHMMSSZ" → "YYYY-MM-DD" (UTC date)
function icsDate(dtstart) {
  if (!dtstart) return '';
  const m = dtstart.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

// "YYYYMMDDTHHMMSSZ" → Date object (UTC, never ambiguous)
// This is the SOURCE OF TRUTH for time calculations — always parse the full DTSTART
// instead of reconstructing from date + HHMM (which can drift across UTC midnight
// for flights departing late local time, e.g. CYYC 21:00L → 04:00Z next day).
function icsDateTime(dtstart) {
  if (!dtstart) return null;
  const m = dtstart.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]));
}

// Build the airline-flight regex from the user's profile operatorCodes
function getOperatorFlightRegex() {
  const p = DB.loadProfile();
  const codes = (p.operatorCodes || 'PD').split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0) return /^PD\d+\s/;
  // Build /^(PD|AC|QK|...)\d+\s/
  const pattern = codes.map(c => c.replace(/[^A-Z0-9]/g, '')).join('|');
  return new RegExp(`^(?:${pattern})\\d+\\s`, 'i');
}

// Convert one Navblue VEVENT into a Cumulo flight object.
// Returns null if it's not a real flight.
// Now performs proper RAC 101.01 night calculation + CAR 401.34 XC detection.
// Supports multi-airline via the user's operatorCodes profile setting.
function navblueEventToFlight(ev, isFO, autoCountIFR) {
  const summary = (ev.SUMMARY || '').trim();
  const desc = (ev.DESCRIPTION || '').trim();

  // Filter: only flights from the airlines the pilot operates (per profile)
  // Default = PD (Porter). Configurable in Profile > Operator Codes.
  if (!getOperatorFlightRegex().test(summary)) return null;
  if (summary.includes('(D)')) return null;

  // Parse SUMMARY: "PD274 YYC-YOW"
  const parts = summary.split(/\s+/);
  const flightNum = parts[0];
  const routeRaw = parts[1] || '';
  const [depIATA, arrIATA] = routeRaw.split('-');
  if (!depIATA || !arrIATA) return null;

  // Parse DESCRIPTION fields
  const blhMatch = desc.match(/BLH:\s*(\d{1,2}:\d{2})/);
  const durMatch = desc.match(/Duration:\s*(\d{1,2}:\d{2})/);
  const stdMatch = desc.match(/STD\s+(\d{4})Z/);
  const staMatch = desc.match(/STA\s+(\d{4})Z/);
  const coMatch  = desc.match(/CO\s+(\d{4})Z/);
  const ciMatch  = desc.match(/CI\s+(\d{4})Z/);
  const acftMatch = desc.match(/Aircraft:\s*([^\s-]+)/);
  const regMatch  = desc.match(/(C-[A-Z]{4})/);

  const block = blhMatch ? +hhmmToDecimal(blhMatch[1]).toFixed(2) : 0;
  const duty  = durMatch ? +hhmmToDecimal(durMatch[1]).toFixed(2) : 0;
  if (block <= 0) return null;  // skip flights without block hours (future or in-progress)

  // Aircraft type mapping
  let acftType = '';
  if (acftMatch) {
    const code = acftMatch[1];
    if (code === '295' || code.startsWith('295')) acftType = 'E195-E2';
    else if (code === 'DH4' || code.startsWith('DH4')) acftType = 'DH4';
    else acftType = code;
  }

  const depICAO = iataToIcao(depIATA);
  const arrICAO = iataToIcao(arrIATA);
  const dateStr = icsDate(ev.DTSTART);

  // ── Block-off / Block-on UTC times ──
  // SOURCE OF TRUTH = DTSTART (full ISO UTC, no ambiguity).
  // Falls back to buildUTCDateTime(date, STD) only if DTSTART is malformed.
  const depCoords = AIRPORT_COORDS[depICAO];
  const arrCoords = AIRPORT_COORDS[arrICAO];
  const blockOffUTC = icsDateTime(ev.DTSTART)
                  || (stdMatch ? buildUTCDateTime(dateStr, stdMatch[1]) : null);
  const blockOnUTC = blockOffUTC ? new Date(blockOffUTC.getTime() + block * 3600000) : null;

  // ── Day/Night split (RAC 101.01) ──
  let dayHours = block, nightHours = 0;
  if (depCoords && arrCoords && blockOffUTC && blockOnUTC) {
    const split = calculateDayNightSplit(blockOffUTC, blockOnUTC, depCoords, arrCoords);
    dayHours = split.dayHours;
    nightHours = split.nightHours;
  }

  // ── Cross-Country detection (CAR 401.34: > 25 NM) ──
  const isXC = isCrossCountry(depICAO, arrICAO);

  // ── Landing day/night based on arrival UTC time + arrival airport coords ──
  let ldgDay = 1, ldgNight = 0;
  if (arrCoords && blockOnUTC && isNightUTC(blockOnUTC, arrCoords.lat, arrCoords.lon)) {
    ldgDay = 0; ldgNight = 1;
  }

  // F/O: block goes to SIC columns. Split into day/night, and XC variants.
  const role = isFO ? 'cop' : 'pic';
  const meDayPic    = role === 'pic' ? dayHours   : 0;
  const meNightPic  = role === 'pic' ? nightHours : 0;
  const meDayCop    = role === 'cop' ? dayHours   : 0;
  const meNightCop  = role === 'cop' ? nightHours : 0;
  const xcDayPic    = isXC && role === 'pic' ? dayHours   : 0;
  const xcNightPic  = isXC && role === 'pic' ? nightHours : 0;
  const xcDayCop    = isXC && role === 'cop' ? dayHours   : 0;
  const xcNightCop  = isXC && role === 'cop' ? nightHours : 0;

  return {
    date: dateStr,
    flightNum,
    type: acftType,
    reg: regMatch ? regMatch[1] : '',
    pic: '',
    copilot: 'M. Daoust',
    route: `${depIATA}-${arrIATA}`,
    dep_icao: depICAO,
    arr_icao: arrICAO,
    // dtstart_utc = full ISO timestamp (source of truth for all time math)
    dtstart_utc: blockOffUTC ? blockOffUTC.toISOString() : '',
    std_utc: stdMatch ? stdMatch[1] : '',
    sta_utc: staMatch ? staMatch[1] : '',
    co_utc:  coMatch  ? coMatch[1]  : '',
    ci_utc:  ciMatch  ? ciMatch[1]  : '',
    block,
    duty,
    total: block,
    meDayPic, meNightPic,
    meDayDual: 0, meNightDual: 0,
    meDayCop, meNightCop,
    xcDayPic, xcNightPic,
    xcDayDual: 0, xcNightDual: 0,
    xcDayCop, xcNightCop,
    ldgDay, ldgNight,
    instActual: 0, instHood: 0, instSim: 0,
    // CAR 401.05 currency: at 705, virtually every flight terminates with an IAP.
    // Profile toggle `autoCountIFR` controls this default. User can edit per-flight.
    approaches: autoCountIFR ? 1 : 0,
    picus: 0,
    multiCrew: 1,           // 705 ops are always multi-crew
    remarks: '',
    source: 'navblue-ics',
    navblueUid: ev.UID || ''
  };
}

function saveNavblueUrl() {
  const input = document.getElementById('navblueUrl');
  let url = (input.value || '').trim();
  if (!url) { showToast('Enter a Navblue iCal URL first', 'error'); return; }
  // Normalize webcal:// → https://
  url = url.replace(/^webcal:\/\//i, 'https://');
  if (!/^https:\/\/[^/]*navblue\.cloud\//i.test(url)) {
    showToast('URL must be a Navblue domain (navblue.cloud)', 'error');
    return;
  }
  localStorage.setItem(NAVBLUE_URL_KEY, url);
  input.value = url;
  showToast('Navblue URL saved ✓', 'success');
  updateNavblueStatus();
}

function clearNavblueUrl() {
  if (!confirm('Remove the saved Navblue URL?')) return;
  localStorage.removeItem(NAVBLUE_URL_KEY);
  localStorage.removeItem(NAVBLUE_LAST_SYNC_KEY);
  document.getElementById('navblueUrl').value = '';
  document.getElementById('navblueDetails').style.display = 'none';
  updateNavblueStatus();
  showToast('Navblue URL cleared');
}

function updateNavblueStatus() {
  const status = document.getElementById('navblueStatus');
  if (!status) return;
  const url = localStorage.getItem(NAVBLUE_URL_KEY);
  const last = localStorage.getItem(NAVBLUE_LAST_SYNC_KEY);
  if (!url) { status.textContent = 'NOT CONFIGURED'; return; }
  if (!last) { status.textContent = 'NEVER SYNCED'; return; }
  const minutes = Math.floor((Date.now() - +last) / 60000);
  if (minutes < 1) status.textContent = 'JUST SYNCED';
  else if (minutes < 60) status.textContent = `${minutes}M AGO`;
  else if (minutes < 1440) status.textContent = `${Math.floor(minutes/60)}H AGO`;
  else status.textContent = `${Math.floor(minutes/1440)}D AGO`;
}

async function syncNavblueNow() {
  const url = localStorage.getItem(NAVBLUE_URL_KEY);
  if (!url) { showToast('Save a Navblue URL first', 'error'); return; }

  const btn = document.getElementById('syncNowBtn');
  const details = document.getElementById('navblueDetails');
  btn.disabled = true;
  btn.textContent = '⏳ Syncing...';

  try {
    const resp = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fetch-ics', url })
    });
    const rawText = await resp.text();
    if (!resp.ok) throw new Error(`Worker error ${resp.status}: ${rawText.substring(0, 200)}`);

    // Worker returns either raw ICS text or { ics: "..." } JSON
    let icsText = rawText;
    if (rawText.startsWith('{')) {
      try { const j = JSON.parse(rawText); icsText = j.ics || j.body || rawText; } catch {}
    }
    if (!icsText.includes('BEGIN:VCALENDAR')) {
      throw new Error('Response does not look like an iCal calendar. Worker may not support /fetch-ics yet.');
    }

    const events = parseICS(icsText);
    console.log(`[Navblue Sync] Parsed ${events.length} VEVENTs from iCal`);

    const syncProfile = DB.loadProfile();
    const isFO = (syncProfile.role || '').toLowerCase().includes('officer')
              || (syncProfile.role || '').toLowerCase().includes('fo')
              || true;  // default Martin = F/O
    // Per-profile toggle: when set, fresh imported flights default to 1 IFR approach.
    // Falls back to 705-airline inference for profiles saved before the field existed.
    const autoCountIFR = (syncProfile.autoCountIFR !== undefined)
      ? !!syncProfile.autoCountIFR
      : isAirline705(syncProfile.airline);

    const today = new Date().toISOString().split('T')[0];
    const mapped = events
      .map(ev => navblueEventToFlight(ev, isFO, autoCountIFR))
      .filter(f => f && f.date && f.date < today);

    console.log(`[Navblue Sync] ${mapped.length} flights eligible for import (date < today, block > 0)`);

    // SNAPSHOT before any modification — pilot data is precious
    snapshotBeforeOperation('Navblue iCal sync');
    updateUndoButton();

    // Smart matching :
    //   1. Try exact match (date + flightNum + route)
    //   2. Fall back to fuzzy match (date + route + block within 0.15h)
    //   3. Fall back to date+block match (PDF imports may have no flightNum/route)
    // Goal: NEVER duplicate a flight that already exists, even when imported via PDF.
    const fresh = [];
    let mergedCount = 0;
    const mergeFields = ['dtstart_utc','std_utc','sta_utc','co_utc','ci_utc',
                         'dep_icao','arr_icao','reg','type','flightNum','multiCrew'];
    mapped.forEach(f => {
      const match = findMatchingExistingFlight(f);
      if (!match) {
        fresh.push(f);
        return;
      }
      // Existing flight matched — enrich missing fields without overwriting user data.
      // Never overwrite: pic (capitaine), total, block (user may have corrected)
      const e = flights[match.idx];
      let changed = false;
      const merged = { ...e };
      mergeFields.forEach(k => {
        if ((merged[k] === undefined || merged[k] === '' || merged[k] === 0 || merged[k] === null) && f[k] !== undefined && f[k] !== '' && f[k] !== 0) {
          merged[k] = f[k];
          changed = true;
        }
      });
      // Mark source so we know this flight has been enriched from iCal
      if (!merged.sources) merged.sources = [];
      if (e.source && !merged.sources.includes(e.source)) merged.sources.push(e.source);
      if (!merged.sources.includes('navblue-ics')) {
        merged.sources.push('navblue-ics');
        changed = true;
      }
      if (changed) {
        flights[match.idx] = merged;
        mergedCount++;
        console.log(`[Sync] Merged ${match.matchType} match for ${f.date} ${f.flightNum} ${f.route}`);
      }
    });

    // Persist any merged changes (so the recalc below sees them)
    if (mergedCount > 0) DB.save(flights);

    // Auto-recalc night/XC for the now-enriched existing flights
    let recalcStats = { updated: 0, skippedNoUTC: 0, skippedNoCoords: 0, skippedNoBlock: 0 };
    if (mergedCount > 0 || fresh.length === 0) {
      recalcStats = recalculateAllFlightsInternal();
      DB.save(flights);
    }

    localStorage.setItem(NAVBLUE_LAST_SYNC_KEY, Date.now().toString());

    details.style.display = 'block';
    const detailLines = [
      `Calendar: <strong>${events.length}</strong> events · <strong>${mapped.length}</strong> completed flights`
    ];
    if (mergedCount > 0) detailLines.push(`<strong>${mergedCount}</strong> existing flight${mergedCount !== 1 ? 's' : ''} enriched with UTC times + coords`);
    if (recalcStats.updated > 0) detailLines.push(`<strong>${recalcStats.updated}</strong> flight${recalcStats.updated !== 1 ? 's' : ''} got Night/XC recalculated`);
    if (fresh.length > 0) detailLines.push(`<strong>${fresh.length}</strong> new flight${fresh.length !== 1 ? 's' : ''} ready to review`);
    if (fresh.length === 0 && mergedCount === 0) detailLines.push('Logbook is up to date.');
    details.innerHTML = detailLines.join('<br>');

    updateNavblueStatus();
    renderDashboard();

    if (fresh.length > 0) {
      showImportPreview(fresh, `${fresh.length} new Navblue flight${fresh.length !== 1 ? 's' : ''} found — select what to import`);
      showToast(`${fresh.length} new + ${mergedCount} enriched`);
    } else if (mergedCount > 0) {
      showToast(`${mergedCount} existing flights enriched + ${recalcStats.updated} recalculated ✓`, 'success');
    } else {
      showToast('Already up to date');
    }

  } catch(e) {
    console.error('[Navblue Sync] Error:', e);
    details.style.display = 'block';
    details.innerHTML = `<span style="color:var(--danger);">Error: ${e.message}</span>`;
    showToast(e.message || 'Sync failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Sync now';
  }
}

// ═══════════════════════════════════════════
// ONBOARDING WIZARD — first launch experience
// Triggered when no profile name is set. Skippable.
// ═══════════════════════════════════════════
const ONBOARDING_KEY = 'cumulo_onboarded_v1';
let onbStep = 1;
let onbData = {};

function shouldShowOnboarding() {
  if (localStorage.getItem(ONBOARDING_KEY)) return false;
  const p = DB.loadProfile();
  // Show if profile name is missing
  return !p.fname && !p.lname;
}

function startOnboarding() {
  onbStep = 1;
  onbData = {};
  document.getElementById('onboardingOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
  renderOnboardingStep();
}

function skipOnboarding() {
  if (!confirm('Skip the setup wizard? You can always access these settings later from the Settings page.')) return;
  localStorage.setItem(ONBOARDING_KEY, 'skipped');
  document.getElementById('onboardingOverlay').classList.remove('show');
  document.body.style.overflow = '';
}

function finishOnboarding() {
  localStorage.setItem(ONBOARDING_KEY, 'done');
  document.getElementById('onboardingOverlay').classList.remove('show');
  document.body.style.overflow = '';
  renderDashboard();
  showToast('Setup complete — welcome aboard ✈', 'success');
}

function onboardingBack() {
  if (onbStep > 1) { onbStep--; renderOnboardingStep(); }
}

function onboardingNext() {
  // Capture current step inputs
  if (onbStep === 1) {
    onbData.fname = document.getElementById('onb-fname')?.value?.trim() || '';
    onbData.lname = document.getElementById('onb-lname')?.value?.trim() || '';
    onbData.rank = document.getElementById('onb-rank')?.value || 'F/O';
    onbData.airline = document.getElementById('onb-airline')?.value?.trim() || '';
    onbData.base = document.getElementById('onb-base')?.value?.trim() || '';
    onbData.operatorCodes = document.getElementById('onb-codes')?.value?.trim().toUpperCase().replace(/\s/g, '') || 'PD';
    if (!onbData.fname || !onbData.lname) {
      showToast('Please enter your first and last name', 'error');
      return;
    }
  } else if (onbStep === 2) {
    onbData.license = document.getElementById('onb-license')?.value?.trim() || '';
    onbData.medical = document.getElementById('onb-medical')?.value || '';
    onbData.fleet = document.getElementById('onb-fleet')?.value?.trim() || '';
  } else if (onbStep === 3) {
    onbData.navblueUrl = document.getElementById('onb-navblue')?.value?.trim() || '';
  } else if (onbStep === 4) {
    onbData.columnPreset = document.querySelector('input[name="onb-preset"]:checked')?.value || 'compact';
  }

  if (onbStep < 4) {
    onbStep++;
    renderOnboardingStep();
    return;
  }

  // Final step → save everything
  const profile = {
    fname: onbData.fname,
    lname: onbData.lname,
    rank: onbData.rank,
    airline: onbData.airline,
    base: onbData.base,
    license: onbData.license,
    medical: onbData.medical,
    fleet: onbData.fleet,
    operatorCodes: onbData.operatorCodes || 'PD',
    pilotType: 'airline705'
  };
  DB.saveProfile(profile);
  updateProfileDisplay(profile);

  if (onbData.navblueUrl) {
    let url = onbData.navblueUrl.replace(/^webcal:\/\//i, 'https://');
    if (/^https:\/\/[^/]*navblue\.cloud\//i.test(url)) {
      localStorage.setItem(NAVBLUE_URL_KEY, url);
    }
  }

  applyColumnPreset(onbData.columnPreset || 'compact');
  finishOnboarding();
}

function renderOnboardingStep() {
  document.getElementById('onbStepNum').textContent = onbStep;
  const titles = {
    1: 'Welcome — tell us about you',
    2: 'License & aircraft',
    3: 'Connect Navblue (optional)',
    4: 'Choose your default view'
  };
  document.getElementById('onbStepTitle').textContent = titles[onbStep];

  const body = document.getElementById('onbBody');
  const backBtn = document.getElementById('onbBackBtn');
  const nextBtn = document.getElementById('onbNextBtn');
  backBtn.style.display = onbStep > 1 ? 'inline-flex' : 'none';
  nextBtn.textContent = onbStep < 4 ? 'Continue →' : '✓ Finish setup';

  if (onbStep === 1) {
    body.innerHTML = `
      <p style="font-size:14px; color:var(--text-secondary); margin-bottom:var(--s-4); line-height:1.55;">
        Cumulo is your personal pilot logbook. Let's set up your profile (you can change everything later).
      </p>
      <div class="form-grid" style="gap:var(--s-3);">
        <div class="form-group">
          <label>First name</label>
          <input type="text" id="onb-fname" placeholder="Martin" autofocus />
        </div>
        <div class="form-group">
          <label>Last name</label>
          <input type="text" id="onb-lname" placeholder="Daoust" />
        </div>
        <div class="form-group">
          <label>Rank</label>
          <select id="onb-rank">
            <option value="F/O">First Officer (F/O)</option>
            <option value="Capt">Captain</option>
            <option value="SIC">Second-in-Command (SIC)</option>
            <option value="PIC">Pilot-in-Command (PIC)</option>
            <option value="Student">Student Pilot</option>
            <option value="Instructor">Instructor</option>
          </select>
        </div>
        <div class="form-group">
          <label>Base (ICAO or IATA)</label>
          <input type="text" id="onb-base" placeholder="YOW" maxlength="4" style="text-transform:uppercase;" />
        </div>
        <div class="form-group col-span-2">
          <label>Airline / Operator</label>
          <input type="text" id="onb-airline" placeholder="Porter Airlines" />
        </div>
        <div class="form-group col-span-2">
          <label>Operator codes (comma-separated)</label>
          <input type="text" id="onb-codes" placeholder="PD" value="PD" style="font-family:var(--font-mono);text-transform:uppercase;" />
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
            IATA codes for the airlines you fly with. <strong>PD</strong>=Porter · <strong>AC</strong>=Air Canada · <strong>QK</strong>=Jazz · <strong>WS</strong>=WestJet · <strong>WR</strong>=WestJet Encore · <strong>TS</strong>=Transat · <strong>F8</strong>=Flair · <strong>5T</strong>=Canadian North · <strong>PB</strong>=PAL · <strong>8P</strong>=Pacific Coastal
          </div>
        </div>
      </div>
    `;
    // Pre-fill if user came back
    if (onbData.fname) document.getElementById('onb-fname').value = onbData.fname;
    if (onbData.lname) document.getElementById('onb-lname').value = onbData.lname;
    if (onbData.rank) document.getElementById('onb-rank').value = onbData.rank;
    if (onbData.base) document.getElementById('onb-base').value = onbData.base;
    if (onbData.airline) document.getElementById('onb-airline').value = onbData.airline;
    if (onbData.operatorCodes) document.getElementById('onb-codes').value = onbData.operatorCodes;
  } else if (onbStep === 2) {
    body.innerHTML = `
      <p style="font-size:14px; color:var(--text-secondary); margin-bottom:var(--s-4); line-height:1.55;">
        These appear on your printed logbook PDF and help track currency.
      </p>
      <div class="form-grid" style="gap:var(--s-3);">
        <div class="form-group col-span-2">
          <label>Transport Canada license number</label>
          <input type="text" id="onb-license" placeholder="A123456" style="font-family:var(--font-mono);" />
        </div>
        <div class="form-group">
          <label>Medical expiry date</label>
          <input type="date" id="onb-medical" />
        </div>
        <div class="form-group">
          <label>Primary aircraft type</label>
          <input type="text" id="onb-fleet" placeholder="E195-E2" />
        </div>
      </div>
      <p style="font-size:12px; color:var(--text-muted); margin-top:var(--s-3); line-height:1.5;">
        All fields are optional. Cumulo will show alerts if your medical is expiring soon.
      </p>
    `;
    if (onbData.license) document.getElementById('onb-license').value = onbData.license;
    if (onbData.medical) document.getElementById('onb-medical').value = onbData.medical;
    if (onbData.fleet) document.getElementById('onb-fleet').value = onbData.fleet;
  } else if (onbStep === 3) {
    body.innerHTML = `
      <p style="font-size:14px; color:var(--text-secondary); margin-bottom:var(--s-4); line-height:1.55;">
        If your airline uses <strong>Navblue N-OC</strong> (Porter, WestJet Encore, Jazz, etc.), paste your roster subscription URL.
        Cumulo will fetch your flights automatically.
      </p>
      <div class="form-group">
        <label>Navblue iCal URL (optional)</label>
        <input type="url" id="onb-navblue"
               placeholder="webcal://poe.noc.vmc.navblue.cloud/RaidoMobile/RosterCalendarDownloader.ashx?Id=..."
               style="font-family:var(--font-mono); font-size:11px;" />
      </div>
      <div style="margin-top:var(--s-4); padding:var(--s-3); background:var(--bg-subtle); border-radius:var(--r-sm); font-size:12px; color:var(--text-secondary); line-height:1.6;">
        <strong>How to get this URL :</strong><br>
        1. Log into Navblue → Roster → Subscribe to calendar<br>
        2. Copy the <code>webcal://</code> link<br>
        3. Paste it above (or skip and add it later in Settings)
      </div>
    `;
    if (onbData.navblueUrl) document.getElementById('onb-navblue').value = onbData.navblueUrl;
  } else if (onbStep === 4) {
    body.innerHTML = `
      <p style="font-size:14px; color:var(--text-secondary); margin-bottom:var(--s-4); line-height:1.55;">
        Choose which columns appear by default in your logbook table and PDF export. You can change this anytime in Settings.
      </p>
      <div style="display:flex; flex-direction:column; gap:var(--s-2);">
        <label class="col-option is-on" style="padding:var(--s-4); display:flex; gap:var(--s-3); align-items:flex-start;">
          <input type="radio" name="onb-preset" value="compact" checked
                 style="appearance:none;-webkit-appearance:none;width:18px;height:18px;border:1.5px solid var(--accent);border-radius:50%;flex-shrink:0;margin-top:2px;background:radial-gradient(circle, var(--accent) 0% 50%, transparent 50%);" />
          <div>
            <div style="font-weight:600; font-size:14px;">Compact (F/O airline 705)</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">8 essential columns: Date, Aircraft, Reg, Route, PIC, Night, Flight Time. Recommended for daily use.</div>
          </div>
        </label>
        <label class="col-option" style="padding:var(--s-4); display:flex; gap:var(--s-3); align-items:flex-start;">
          <input type="radio" name="onb-preset" value="atpl"
                 style="appearance:none;-webkit-appearance:none;width:18px;height:18px;border:1.5px solid var(--border-strong);border-radius:50%;flex-shrink:0;margin-top:2px;" />
          <div>
            <div style="font-weight:600; font-size:14px;">ATPL preparation</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">~22 columns covering all Standard 421 experience categories. For pilots preparing their ATPL application.</div>
          </div>
        </label>
        <label class="col-option" style="padding:var(--s-4); display:flex; gap:var(--s-3); align-items:flex-start;">
          <input type="radio" name="onb-preset" value="all"
                 style="appearance:none;-webkit-appearance:none;width:18px;height:18px;border:1.5px solid var(--border-strong);border-radius:50%;flex-shrink:0;margin-top:2px;" />
          <div>
            <div style="font-weight:600; font-size:14px;">All columns (38)</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Show everything. Best for detailed audit or recurrent training.</div>
          </div>
        </label>
      </div>
    `;
    // Pre-select
    if (onbData.columnPreset) {
      const r = document.querySelector(`input[name="onb-preset"][value="${onbData.columnPreset}"]`);
      if (r) r.checked = true;
    }
    // Sync visual selected state on click
    document.querySelectorAll('input[name="onb-preset"]').forEach(input => {
      input.addEventListener('change', () => {
        document.querySelectorAll('label.col-option').forEach(l => l.classList.remove('is-on'));
        input.closest('label').classList.add('is-on');
        document.querySelectorAll('input[name="onb-preset"]').forEach(i => {
          i.style.background = i.checked ? 'radial-gradient(circle, var(--accent) 0% 50%, transparent 50%)' : '';
          i.style.borderColor = i.checked ? 'var(--accent)' : 'var(--border-strong)';
        });
      });
    });
  }
}

// ═══════════════════════════════════════════
// NAVBLUE PDF ROSTER PARSER — captain name capture
// ═══════════════════════════════════════════
// Parses an HrRosterReport PDF entirely client-side using pdf.js.
// Extracts flight legs + crew names, then merges PIC name into existing
// logbook entries (matched on date + flight#).
// Zero data leaves the browser.

function handleRosterDrop(event) {
  event.preventDefault();
  const dz = document.getElementById('rosterDropZone');
  if (dz) dz.classList.remove('dragover');
  const file = event.dataTransfer && event.dataTransfer.files[0];
  if (file) handleRosterFile(file);
}

async function handleRosterFile(file) {
  if (!file) return;
  if (typeof pdfjsLib === 'undefined') {
    showToast('PDF parser library not loaded yet — refresh the page and retry.', 'error');
    return;
  }
  const details = document.getElementById('rosterDetails');
  details.style.display = 'block';
  details.innerHTML = `Reading <strong>${file.name}</strong>…`;

  try {
    // Read the file as ArrayBuffer (client-side, no upload)
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    details.innerHTML = `Parsing ${pdf.numPages} page${pdf.numPages !== 1 ? 's' : ''}…`;

    // Extract all text from all pages, page by page, preserving structure
    let allText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Group items by Y position to approximate text lines
      const lines = groupTextByLines(content.items);
      allText += lines.join('\n') + '\n';
    }

    console.log('[Roster] First 1500 chars of extracted text:\n' + allText.substring(0, 1500));

    // Parse the text to extract flight legs with their crew
    const extracted = parseNavblueRosterText(allText);
    console.log(`[Roster] Extracted ${extracted.length} flights from PDF`);

    if (extracted.length === 0) {
      details.innerHTML = `<span style="color:var(--danger);">No flight legs detected in this PDF. Make sure it's a Navblue HrRosterReport (not a different report).</span>`;
      showToast('No flights found in this PDF', 'error');
      return;
    }

    // SNAPSHOT before bulk modification (zero-data-loss policy)
    snapshotBeforeOperation('Crew names enrichment from PDF');
    updateUndoButton();

    // Merge captain names into existing flights — match by date + flight number
    let matched = 0, alreadyHad = 0, noMatch = 0;
    const stillMissing = [];
    extracted.forEach(item => {
      // Find existing flight : exact match on date + flightNum
      const idx = flights.findIndex(f =>
        f.date === item.date &&
        (f.flightNum === item.flightNum || (f.route && f.route.toUpperCase() === item.route))
      );
      if (idx === -1) { noMatch++; stillMissing.push(item); return; }
      const existing = flights[idx];
      if (existing.pic && existing.pic.trim() && existing.pic !== '—') {
        // Don't overwrite an existing PIC name
        alreadyHad++;
        return;
      }
      flights[idx] = { ...existing, pic: item.pic };
      matched++;
    });

    if (matched > 0) {
      DB.save(flights);
      renderDashboard();
    }

    const detailLines = [
      `<strong>${extracted.length}</strong> flight legs extracted from PDF`,
      `<strong style="color:var(--success);">${matched}</strong> captain name${matched !== 1 ? 's' : ''} added to existing flights`,
    ];
    if (alreadyHad > 0) detailLines.push(`<span>${alreadyHad} flights already had a PIC (not overwritten)</span>`);
    if (noMatch > 0) detailLines.push(`<span style="color:var(--warning);">${noMatch} legs not found in your logbook (older than iCal window?)</span>`);
    details.innerHTML = detailLines.join('<br>');

    if (matched > 0) {
      showToast(`✓ ${matched} captain name${matched !== 1 ? 's' : ''} added`, 'success');
    } else if (alreadyHad === extracted.length) {
      showToast('All flights already had a PIC');
    } else {
      showToast('No new captains added — check console for details', 'error');
    }
  } catch (e) {
    console.error('[Roster] Parse error:', e);
    details.innerHTML = `<span style="color:var(--danger);">Error: ${e.message}</span>`;
    showToast('Failed to parse PDF: ' + e.message, 'error');
  }
}

// Group pdf.js text items by Y coordinate → approximate visual lines
function groupTextByLines(items) {
  const lines = {};
  items.forEach(item => {
    if (!item.str || !item.str.trim()) return;
    const y = Math.round(item.transform[5]);  // Y position
    const x = item.transform[4];               // X position
    if (!lines[y]) lines[y] = [];
    lines[y].push({ x, text: item.str });
  });
  // Sort each line by X position then join with spaces
  return Object.keys(lines)
    .sort((a, b) => +b - +a)  // top to bottom (PDF Y is inverted)
    .map(y => lines[y].sort((a, b) => a.x - b.x).map(i => i.text).join(' '));
}

// Parse the extracted text to find flight legs + crew names.
// Navblue HrRosterReport format varies but generally each flight leg row contains:
//   FLIGHT_NUMBER  DATE  STD_TIME  STA_TIME  DEP_AIRPORT  ARR_AIRPORT  A/C  CAPT_NAME  FO_NAME ...
// We look for : PD\d+ pattern (Porter mainline) and surrounding date + crew section.
function parseNavblueRosterText(text) {
  const flights = [];
  const lines = text.split(/\r?\n/);

  // Strategy : sliding window across lines. For each line containing PD\d{2,4},
  // look for a date (YYYY-MM-DD or DD-MMM-YYYY or DDMMM) nearby, plus capital-name
  // patterns ("LASTNAME, F" or "LASTNAME F").
  // Crew names in Navblue PDFs : usually uppercase last name + first initial.

  // Build a date map : line index → ISO date (for any line that mentions a date)
  const dateOnLine = {};
  for (let i = 0; i < lines.length; i++) {
    const d = extractDate(lines[i]);
    if (d) dateOnLine[i] = d;
  }

  // Build airline-flight regex from profile operator codes
  const profile = DB.loadProfile();
  const codes = (profile.operatorCodes || 'PD').split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
  const codesPattern = codes.length > 0 ? codes.join('|') : 'PD';
  const flightNumRegex = new RegExp(`\\b((?:${codesPattern})\\d{2,4})\\b`, 'gi');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Find airline flight numbers in this line (per user's operator codes)
    const flightMatches = [...line.matchAll(flightNumRegex)];
    if (flightMatches.length === 0) continue;

    flightMatches.forEach(m => {
      const flightNum = m[1];

      // Find a date — look on this line, then walk backwards up to 5 lines
      let date = dateOnLine[i];
      if (!date) {
        for (let back = 1; back <= 5 && !date; back++) {
          date = dateOnLine[i - back];
        }
      }
      if (!date) return;  // can't anchor without a date

      // Find route (YOW-YYZ, YYJ-YOW, etc.) — 3-letter IATAs near the flight number
      const routeMatch = line.match(/\b([A-Z]{3})\s*[-\/]\s*([A-Z]{3})\b/) ||
                         line.match(/\b([A-Z]{3})\s+([A-Z]{3})\b/);
      const route = routeMatch ? `${routeMatch[1]}-${routeMatch[2]}` : '';

      // Find crew names — look on this line + next 2 lines
      // Pattern: LASTNAME, F  or  LASTNAME F.  or  Lastname Firstname
      const window = lines.slice(i, i + 3).join(' ');
      const crewMatches = [...window.matchAll(/\b([A-Z][A-Z\-']{1,30})(?:,\s*|\s+)([A-Z](?:\.|\b))/g)];
      // First crew name = captain (Navblue convention), second = F/O
      let pic = '';
      if (crewMatches.length >= 1) {
        pic = `${crewMatches[0][1]}, ${crewMatches[0][2].replace('.', '')}`;
        // Title Case the last name
        pic = pic.replace(/([A-Z])([A-Z]+)/, (_, h, t) => h + t.toLowerCase());
      }

      if (pic) {
        flights.push({ date, flightNum, route, pic });
      }
    });
  }

  // Dedupe (same flight may appear on multiple lines)
  const seen = new Set();
  return flights.filter(f => {
    const key = `${f.date}|${f.flightNum}|${f.route}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Extract an ISO date from a line of text. Handles many Navblue date formats.
function extractDate(line) {
  // YYYY-MM-DD
  let m = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD-MMM-YYYY (eg 12-Apr-2026 or 12APR2026)
  m = line.match(/\b(\d{1,2})[\s\-]?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[\s\-]?(\d{2,4})\b/i);
  if (m) {
    const day = m[1].padStart(2, '0');
    const month = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' }[m[2].toUpperCase()];
    let year = m[3]; if (year.length === 2) year = '20' + year;
    return `${year}-${month}-${day}`;
  }
  // DD/MM/YYYY
  m = line.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}

function loadNavblueUI() {
  const url = localStorage.getItem(NAVBLUE_URL_KEY);
  const input = document.getElementById('navblueUrl');
  if (input && url) input.value = url;
  updateNavblueStatus();
  updateUndoButton();
  renderColumnPicker();
}

// ═══════════════════════════════════════════
// COLUMN PICKER (Settings → Visible Columns)
// ═══════════════════════════════════════════
function renderColumnPicker() {
  const container = document.getElementById('columnPicker');
  if (!container) return;
  const prefs = loadColumnPrefs() || {};

  // Group columns by section
  const groups = {};
  LOGBOOK_COLUMNS.forEach(c => {
    if (c.key === 'total') return;  // always shown, no toggle
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });

  const html = Object.keys(groups).map(group => `
    <div class="col-group">
      <div class="col-group-title">${group}</div>
      <div class="col-group-grid">
        ${groups[group].map(c => {
          const checked = prefs[c.key] !== undefined ? prefs[c.key] : c.default;
          return `
          <label class="col-option ${checked ? 'is-on' : ''}">
            <input type="checkbox" ${checked ? 'checked' : ''}
                   onchange="toggleColumn('${c.key}', this.checked)" />
            <span class="col-option-label">${c.label}</span>
          </label>`;
        }).join('')}
      </div>
    </div>
  `).join('');

  container.innerHTML = `
    <div style="display:flex; gap:var(--s-2); flex-wrap:wrap; align-items:center; margin-bottom:var(--s-3); padding-bottom:var(--s-3); border-bottom:1px solid var(--border);">
      <button class="btn btn-ghost btn-sm" onclick="applyColumnPreset('all')" type="button">✓ Select all</button>
      <button class="btn btn-ghost btn-sm" onclick="applyColumnPreset('none')" type="button">✗ Deselect all</button>
      <span style="width:1px; height:20px; background:var(--border);"></span>
      <span class="eyebrow">Presets:</span>
      <button class="btn btn-ghost btn-sm" onclick="applyColumnPreset('compact')" type="button">Compact F/O 705</button>
      <button class="btn btn-ghost btn-sm" onclick="applyColumnPreset('atpl')" type="button">ATPL prep</button>
    </div>
    ${html}
  `;
}

function toggleColumn(key, checked) {
  const prefs = loadColumnPrefs() || {};
  prefs[key] = checked;
  saveColumnPrefs(prefs);
  renderColumnPicker();
  // Live-refresh the logbook table if user is looking at it
  if (typeof renderLogbook === 'function') renderLogbook(filterVal || '');
}

function toggleColumnMenu() {
  const menu = document.getElementById('columnMenu');
  if (!menu) return;
  const isOpen = menu.classList.toggle('show');
  if (isOpen) {
    renderColumnPicker();  // refresh checkboxes state
    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', closeColumnMenuOnOutside);
    }, 50);
  }
}
function closeColumnMenuOnOutside(e) {
  const menu = document.getElementById('columnMenu');
  const btn = document.getElementById('columnMenuBtn');
  if (menu && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
    menu.classList.remove('show');
    document.removeEventListener('click', closeColumnMenuOnOutside);
  }
}

function resetColumnPrefs() {
  if (!confirm('Reset all column visibility to defaults? Your data is not affected.')) return;
  localStorage.removeItem(COLUMN_PREFS_KEY);
  renderColumnPicker();
  if (typeof renderLogbook === 'function') renderLogbook(filterVal || '');
  showToast('Column visibility reset to defaults');
}

function applyColumnPreset(preset) {
  const prefs = {};
  if (preset === 'compact') {
    // F/O 705 essentials
    ['date','type','reg','route','pic','night','block','total'].forEach(k => prefs[k] = true);
    LOGBOOK_COLUMNS.forEach(c => { if (prefs[c.key] === undefined) prefs[c.key] = false; });
  } else if (preset === 'atpl') {
    // ATPL preparation: all categories needed for the experience demo
    ['date','type','reg','route','pic','crewPosition','block','duty',
     'day','night','meDayPic','meNightPic','meDayCop','meNightCop',
     'xcDay','xcNight','instActual','instSim','approaches',
     'ldgDay','ldgNight','picus','total'].forEach(k => prefs[k] = true);
    LOGBOOK_COLUMNS.forEach(c => { if (prefs[c.key] === undefined) prefs[c.key] = false; });
  } else if (preset === 'all') {
    LOGBOOK_COLUMNS.forEach(c => { prefs[c.key] = true; });
  } else if (preset === 'none') {
    LOGBOOK_COLUMNS.forEach(c => { prefs[c.key] = false; });
  }
  saveColumnPrefs(prefs);
  renderColumnPicker();
  if (typeof renderLogbook === 'function') renderLogbook(filterVal || '');
  showToast(`Preset "${preset}" applied`);
}

// ═══════════════════════════════════════════
// BACKUP / RESTORE
// ═══════════════════════════════════════════
function backupData() {
  const data = { flights, profile: DB.loadProfile(), exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'logbook_backup_' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
  showToast('Backup downloaded ✓', 'success');
}

function restoreData(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.flights) { flights = data.flights; DB.save(flights); }
      if (data.profile) { DB.saveProfile(data.profile); }
      showToast(flights.length + ' flights restored ✓', 'success');
      renderDashboard();
    } catch { showToast('Invalid backup file', 'error'); }
  };
  r.readAsText(file);
  input.value = '';
}

function clearAll() {
  if (!confirm('Delete ALL flights? This cannot be undone.')) return;
  flights = [];
  DB.save(flights);
  showToast('All data cleared', 'error');
  renderDashboard();
}

// ═══════════════════════════════════════════
// FEATURE 7 — PDF EXPORT (TC FORMAT)
// ═══════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────
//  EXPORT PDF — Transport Canada compliant (CAR 401.08 + Standard 421)
//  - Cover page (pilot identity, license, medical, type ratings)
//  - Log pages : 22 flights/page, page totals + cumulative running totals
//  - Signature line on EVERY page (TC inspector expectation)
//  - Single-line strike-through for corrections (audit best practice)
//  - Decimal hours 0.1h (TC standard)
//  - Uses user's column visibility prefs (configurable per export)
// ─────────────────────────────────────────────────────────────────

// Entry point : shows a modal to confirm which columns to include,
// then calls _generatePDF() with the chosen visible columns.
function exportPDF() {
  const overlay = document.getElementById('importPreview');
  if (!overlay) { _generatePDF(); return; }
  // Render the column picker inside the import modal (reused as a generic modal)
  document.getElementById('importSubtitle').textContent = 'Choose which columns to include in your printed PDF';
  // Read current prefs to seed the picker
  const html = (function() {
    const prefs = loadColumnPrefs() || {};
    const groups = {};
    LOGBOOK_COLUMNS.forEach(c => {
      if (c.key === 'total') return;
      if (!groups[c.group]) groups[c.group] = [];
      groups[c.group].push(c);
    });
    return Object.keys(groups).map(group => `
      <div class="col-group">
        <div class="col-group-title">${group}</div>
        <div class="col-group-grid">
          ${groups[group].map(c => {
            const checked = prefs[c.key] !== undefined ? prefs[c.key] : c.default;
            return `
              <label class="col-option ${checked ? 'is-on' : ''}">
                <input type="checkbox" data-col-key="${c.key}" ${checked ? 'checked' : ''}
                       onchange="this.closest('label').classList.toggle('is-on', this.checked)" />
                <span class="col-option-label">${c.label}</span>
              </label>`;
          }).join('')}
        </div>
      </div>
    `).join('') + `
      <div style="margin-top:var(--s-3); padding:var(--s-3); background:var(--bg-subtle); border-radius:var(--r-sm); font-size:12px; color:var(--text-secondary); line-height:1.5;">
        <strong>Tip:</strong> Picking fewer columns gives more space per row in landscape. Picking many makes the table denser. The cover page + currency annexe always print.
      </div>
    `;
  })();
  document.getElementById('extractedList').innerHTML = html;
  // Configure the confirm button
  const confirmBtn = document.getElementById('importConfirmBtn');
  confirmBtn.textContent = '📄 Generate PDF';
  confirmBtn.disabled = false;
  confirmBtn.onclick = function() {
    // Read selected columns
    const selected = {};
    document.querySelectorAll('#extractedList input[type="checkbox"][data-col-key]').forEach(input => {
      selected[input.getAttribute('data-col-key')] = input.checked;
    });
    // Save as prefs (so the Logbook table updates too — consistent)
    saveColumnPrefs(selected);
    if (typeof renderLogbook === 'function') renderLogbook(filterVal || '');
    closeImportOverlay();
    _generatePDF();
  };
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function _generatePDF() {
  if (typeof window.jspdf === 'undefined') { showToast('PDF library loading, try again', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const p = DB.loadProfile();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
  const W = 279, H = 216;
  // Color palette (subtle, neutral — looks like a real logbook, not a marketing brochure)
  const navy = [22, 33, 62], accent = [46, 99, 216], muted = [120, 130, 150],
        white = [255, 255, 255], light = [248, 249, 252], border = [200, 208, 220],
        textPrimary = [10, 14, 26];

  const name = `${p.fname||'Martin'} ${p.lname||'Daoust'}`.trim();
  const fullTitle = `${p.rank||'F/O'} ${name}`.trim();
  const license = p.license || '—';
  const airline = p.airline || 'Porter Airlines';
  const base = p.base || 'YOW';
  const medical = p.medical || '—';
  const fleet = p.fleet || '—';

  const cols = getVisibleColumns('pdf');
  const sorted = [...flights].sort((a,b) => (a.date || '').localeCompare(b.date || ''));

  // ════════════════════════════════════════════
  // PAGE 1 — COVER (pilot identity)
  // ════════════════════════════════════════════
  drawCoverPage();

  function drawCoverPage() {
    // Title block (top)
    doc.setFillColor(...navy);
    doc.rect(0, 0, W, 28, 'F');
    doc.setTextColor(...white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('Pilot Logbook', 18, 16);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Personal log maintained pursuant to CAR 401.08', 18, 22);

    // Pilot identity card (centered, large)
    const cardX = 30, cardY = 50, cardW = W - 60, cardH = 110;
    doc.setDrawColor(...border);
    doc.setLineWidth(0.3);
    doc.roundedRect(cardX, cardY, cardW, cardH, 3, 3, 'S');

    // Left column : photo placeholder + name
    doc.setTextColor(...textPrimary);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(fullTitle, cardX + 15, cardY + 22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...muted);
    doc.text(`${airline} · Base ${base}`, cardX + 15, cardY + 30);

    // Identity grid
    const idGridY = cardY + 50;
    const labelColor = muted, valueColor = textPrimary;
    const fields = [
      ['License Number', license],
      ['Medical Expiry', medical],
      ['Type Rating(s)', fleet],
      ['Total Entries', String(flights.length)],
    ];
    fields.forEach((row, i) => {
      const x = cardX + 15 + (i % 2) * ((cardW - 30) / 2);
      const y = idGridY + Math.floor(i / 2) * 20;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...labelColor);
      doc.text(row[0].toUpperCase(), x, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(...valueColor);
      doc.text(row[1], x, y + 6);
    });

    // Cumulative totals summary (right block — gives the headline numbers)
    const totals = calcStats();
    const sumY = H - 50;
    doc.setFillColor(...light);
    doc.rect(cardX, sumY, cardW, 28, 'F');
    doc.setTextColor(...textPrimary);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('CAREER TOTALS (as of ' + new Date().toLocaleDateString('en-CA') + ')', cardX + 5, sumY + 6);

    const headlineCols = [
      ['Flight Time',     fmt(totals.total)],
      ['PIC',             fmt(totals.pic)],
      ['SIC',             fmt(totals.sic)],
      ['Night',           fmt(totals.night)],
      ['Multi-Engine',    fmt(totals.me)],
      ['Cross-Country',   fmt(totals.xc)],
      ['Landings',        String(totals.ldg)],
    ];
    const slotW = cardW / headlineCols.length;
    headlineCols.forEach((h, i) => {
      const x = cardX + i * slotW;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...muted);
      doc.text(h[0].toUpperCase(), x + 5, sumY + 14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...textPrimary);
      doc.text(h[1], x + 5, sumY + 22);
    });

    // Footer (cover)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...muted);
    doc.text('Generated by Cumulo · ' + new Date().toISOString().slice(0, 10), W / 2, H - 8, { align: 'center' });
  }

  // ════════════════════════════════════════════
  // LOG PAGES — paginated, with running totals
  // ════════════════════════════════════════════
  if (sorted.length === 0) {
    doc.setFontSize(14); doc.setTextColor(...textPrimary);
    doc.text('No flights logged yet.', W/2, H/2, { align: 'center' });
    doc.save(`logbook_${name.replace(/\s+/g,'_')}_${new Date().toISOString().split('T')[0]}.pdf`);
    showToast('PDF exported ✓', 'success');
    return;
  }

  // Compute table column widths to fit the page (W minus left/right margin)
  const tableMargin = 8;
  const tableW = W - 2 * tableMargin;
  const totalWidthUnits = cols.reduce((sum, c) => sum + (c.width || 12), 0);
  const widthScale = tableW / totalWidthUnits;
  const colWidths = cols.map(c => (c.width || 12) * widthScale);

  // Running cumulative totals across pages
  const runTotals = {};
  cols.forEach(c => { if (c.decimal || c.key === 'ldgDay' || c.key === 'ldgNight' || c.key === 'approaches') runTotals[c.key] = 0; });

  const ROWS_PER_PAGE = 24;
  const totalPages = Math.ceil(sorted.length / ROWS_PER_PAGE);

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    doc.addPage();
    const rows = sorted.slice(pageIdx * ROWS_PER_PAGE, (pageIdx + 1) * ROWS_PER_PAGE);
    drawLogPage(rows, pageIdx + 1);
  }

  function drawLogPage(rows, pageNum) {
    // Header band
    doc.setFillColor(...navy);
    doc.rect(0, 0, W, 14, 'F');
    doc.setTextColor(...white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Pilot Logbook', tableMargin, 9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`${fullTitle} · License ${license} · ${airline}`, tableMargin + 50, 9);
    doc.text(`Page ${pageNum} of ${totalPages}`, W - tableMargin, 9, { align: 'right' });

    // Column headers row
    let y = 18;
    doc.setFillColor(...light);
    doc.rect(tableMargin, y, tableW, 6, 'F');
    doc.setDrawColor(...border);
    doc.line(tableMargin, y + 6, tableMargin + tableW, y + 6);
    doc.setTextColor(...muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    let x = tableMargin;
    cols.forEach((c, i) => {
      const tx = c.align === 'right' ? x + colWidths[i] - 1
              : c.align === 'center' ? x + colWidths[i] / 2
              : x + 1;
      doc.text(c.short.toUpperCase(), tx, y + 4, { align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' });
      x += colWidths[i];
    });
    y += 7;

    // Page totals (per page)
    const pageTotals = {};
    cols.forEach(c => { if (runTotals.hasOwnProperty(c.key)) pageTotals[c.key] = 0; });

    // Data rows
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    rows.forEach((f, i) => {
      if (i % 2 === 0) { doc.setFillColor(252, 253, 255); doc.rect(tableMargin, y - 3, tableW, 5.5, 'F'); }
      doc.setTextColor(...textPrimary);
      x = tableMargin;
      cols.forEach((c, ci) => {
        let v = computeCellValue(f, c.key);
        // Translate UI Unicode glyphs to ASCII for jsPDF Helvetica compatibility
        if (v === '✓') v = 'Yes';
        if (v === '—') v = '-';
        let display;
        if (v === undefined || v === null || v === '' || (c.decimal && (+v === 0)) || (!c.decimal && c.key !== 'multiCrew' && c.key !== 'remarks' && c.key !== 'crewPosition' && typeof v === 'number' && v === 0)) {
          display = '-';  // ASCII hyphen, not em-dash (em-dash renders as garbage in Helvetica)
        } else if (c.decimal) {
          display = fmt(v);
          if (runTotals.hasOwnProperty(c.key)) pageTotals[c.key] += +v;
        } else if (typeof v === 'number') {
          display = String(v);
          if (runTotals.hasOwnProperty(c.key)) pageTotals[c.key] += v;
        } else {
          display = String(v).substring(0, 22);
        }
        const tx = c.align === 'right' ? x + colWidths[ci] - 1
                : c.align === 'center' ? x + colWidths[ci] / 2
                : x + 1;
        doc.text(display, tx, y + 1, { align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' });
        x += colWidths[ci];
      });
      y += 5.5;
    });

    // Add running totals
    Object.keys(pageTotals).forEach(k => { runTotals[k] += pageTotals[k]; });

    // Totals rows : Page totals + Cumulative
    y += 2;
    drawTotalsRow('PAGE TOTALS', pageTotals, accent, white, y);
    y += 6.5;
    drawTotalsRow('CUMULATIVE TOTALS — CARRIED FORWARD', runTotals, navy, white, y);

    // Certification + signature line (EVERY page — TC inspector best practice)
    y += 14;
    doc.setDrawColor(...border);
    doc.setTextColor(...textPrimary);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.text('I certify that the entries on this page are true and correct.', tableMargin, y);
    y += 8;
    doc.setLineWidth(0.3);
    doc.line(tableMargin, y, tableMargin + 70, y);                // Signature
    doc.line(tableMargin + 90, y, tableMargin + 140, y);          // Date
    doc.line(tableMargin + 160, y, tableMargin + 220, y);         // License
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...muted);
    doc.text('Pilot Signature', tableMargin, y + 3);
    doc.text('Date', tableMargin + 90, y + 3);
    doc.text('License Number', tableMargin + 160, y + 3);
  }

  function drawTotalsRow(label, totals, bgColor, txtColor, y) {
    doc.setFillColor(...bgColor);
    doc.rect(tableMargin, y, tableW, 6, 'F');
    doc.setTextColor(...txtColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    let x = tableMargin;
    cols.forEach((c, i) => {
      if (i === 0) {
        doc.text(label, x + 1, y + 4);
      } else if (totals.hasOwnProperty(c.key)) {
        const display = c.decimal ? fmt(totals[c.key]) : String(Math.round(totals[c.key] * 100) / 100);
        const tx = c.align === 'right' ? x + colWidths[i] - 1
                : c.align === 'center' ? x + colWidths[i] / 2
                : x + 1;
        doc.text(display, tx, y + 4, { align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' });
      }
      x += colWidths[i];
    });
  }

  // ════════════════════════════════════════════
  // FINAL PAGE — CURRENCY STATUS (CAR 401.05)
  // ════════════════════════════════════════════
  doc.addPage();
  drawCurrencyPage();

  function drawCurrencyPage() {
    // Header band
    doc.setFillColor(...navy);
    doc.rect(0, 0, W, 14, 'F');
    doc.setTextColor(...white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Currency & Recency Status', tableMargin, 9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`${fullTitle} · ${new Date().toLocaleDateString('en-CA')}`, W - tableMargin, 9, { align: 'right' });

    let y = 28;
    const today = new Date(); today.setHours(0,0,0,0);

    // Title
    doc.setTextColor(...textPrimary);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Regulatory currency overview', tableMargin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    doc.text('Per Canadian Aviation Regulations (CAR 401.05). Status as of generation date.', tableMargin, y + 6);
    y += 18;

    // Compute currency stats
    const cutoff90 = new Date(today); cutoff90.setDate(cutoff90.getDate() - 90);
    const cutoff90Str = cutoff90.toISOString().split('T')[0];
    const cutoff6m = new Date(today); cutoff6m.setMonth(cutoff6m.getMonth() - 6);
    const cutoff6mStr = cutoff6m.toISOString().split('T')[0];
    const cutoff12m = new Date(today); cutoff12m.setMonth(cutoff12m.getMonth() - 12);
    const cutoff12mStr = cutoff12m.toISOString().split('T')[0];

    const recent90 = flights.filter(f => f.date && f.date >= cutoff90Str);
    const recent6m = flights.filter(f => f.date && f.date >= cutoff6mStr);
    const recent12m = flights.filter(f => f.date && f.date >= cutoff12mStr);

    const ldg90Day = recent90.reduce((s, f) => s + (+f.ldgDay || 0), 0);
    const ldg90Night = recent90.reduce((s, f) => s + (+f.ldgNight || 0), 0);
    const ldg90Total = ldg90Day + ldg90Night;
    // CAR 401.05: 6 instrument approaches in 6 months. Counter is approaches only.
    const approaches6m = recent6m.reduce((s, f) => s + (+f.approaches || 0), 0);
    const instHours6m = recent6m.reduce((s, f) => s + (+f.instActual || 0) + (+f.instHood || 0) + (+f.instSim || 0), 0);

    const items = [
      {
        title: 'Passenger-carrying currency (Day)',
        reg: 'CAR 401.05(2)(a)',
        requirement: '5 take-offs and 5 landings within preceding 6 months',
        current: `${recent6m.length} flight${recent6m.length !== 1 ? 's' : ''} in last 6 months · ${ldg90Total} landing${ldg90Total !== 1 ? 's' : ''} in last 90 days`,
        ok: recent6m.length >= 5 && ldg90Total >= 5
      },
      {
        title: 'Passenger-carrying currency (Night)',
        reg: 'CAR 401.05(2)(b)',
        requirement: '5 night take-offs and 5 night landings within preceding 6 months',
        current: `${ldg90Night} night landing${ldg90Night !== 1 ? 's' : ''} in last 90 days`,
        ok: ldg90Night >= 5
      },
      {
        title: 'IFR currency — approaches',
        reg: 'CAR 401.05',
        requirement: '6 instrument approaches within preceding 6 months (PIC or required pilot)',
        current: `${Math.floor(approaches6m)} approach${approaches6m !== 1 ? 'es' : ''} logged in last 6 months`,
        ok: approaches6m >= 6
      },
      {
        title: 'IFR currency — instrument time',
        reg: 'CAR 401.05',
        requirement: '6 hours instrument time within preceding 6 months (actual + hood + approved sim)',
        current: `${instHours6m.toFixed(1)} hrs instrument time logged in last 6 months`,
        ok: instHours6m >= 6
      },
      {
        title: 'Medical certificate',
        reg: 'CAR 404',
        requirement: 'Valid Category 1 or 3 medical for commercial operations',
        current: p.medical ? `Expires ${new Date(p.medical).toLocaleDateString('en-CA')}` : 'Not set in profile',
        ok: p.medical ? (new Date(p.medical) >= today) : null
      },
      {
        title: '90-day recency',
        reg: 'Operator best practice',
        requirement: 'Recent flying activity',
        current: `${recent90.length} flight${recent90.length !== 1 ? 's' : ''} in last 90 days`,
        ok: recent90.length > 0
      }
    ];

    items.forEach(item => {
      const statusColor = item.ok === null ? muted : item.ok ? [16, 163, 127] : [220, 42, 42];
      const statusText = item.ok === null ? 'UNKNOWN' : item.ok ? '✓ CURRENT' : '✗ NOT CURRENT';

      doc.setDrawColor(...border);
      doc.setLineWidth(0.3);
      doc.roundedRect(tableMargin, y, W - 2 * tableMargin, 22, 2, 2, 'S');

      // Left bar (color-coded status)
      doc.setFillColor(...statusColor);
      doc.rect(tableMargin, y, 2, 22, 'F');

      // Title + reg
      doc.setTextColor(...textPrimary);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(item.title, tableMargin + 6, y + 6);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...muted);
      doc.text(item.reg, tableMargin + 6, y + 11);

      // Requirement + current state
      doc.setFontSize(8);
      doc.setTextColor(...textPrimary);
      doc.text('Requirement: ' + item.requirement, tableMargin + 6, y + 16);
      doc.setTextColor(...muted);
      doc.text('Current: ' + item.current, tableMargin + 6, y + 20);

      // Status badge (right)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...statusColor);
      doc.text(statusText, W - tableMargin - 4, y + 13, { align: 'right' });

      y += 26;
    });

    // Disclaimer footer
    y += 8;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(...muted);
    doc.text('This summary is informational. The pilot remains solely responsible for verifying their currency before each flight in accordance with CAR 401.05 and the Operator Manual.', tableMargin, y, { maxWidth: W - 2 * tableMargin });

    // Signature line
    y += 16;
    doc.setLineWidth(0.3);
    doc.line(tableMargin, y, tableMargin + 70, y);
    doc.line(tableMargin + 90, y, tableMargin + 140, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.text('Pilot Signature', tableMargin, y + 3);
    doc.text('Date', tableMargin + 90, y + 3);
  }

  doc.save(`logbook_${name.replace(/\s+/g,'_')}_${new Date().toISOString().split('T')[0]}.pdf`);
  showToast(`PDF exported (${totalPages + 2} pages) ✓`, 'success');
}

// ═══════════════════════════════════════════
// FEATURE 12 — Q&A SECTION
// ═══════════════════════════════════════════
const FAQS = [
  {
    q: 'How many landings do I need to stay current as PIC?',
    a: 'Under CAR 401.05(2), to act as PIC carrying passengers you need at least 5 take-offs and 5 landings in the same category and class within the preceding 6 months. For night currency under CAR 401.05(3), you need 5 take-offs and 5 landings at night within the preceding 6 months.'
  },
  {
    q: 'What is IFR recency and how long is it valid?',
    a: 'Under CAR 401.05(5), to act as PIC under IFR you must have completed at least 6 instrument approaches in the preceding 6 months, either in an aircraft or approved simulator. The 6 months is a rolling window — counted backward from the day you want to fly IFR.'
  },
  {
    q: 'What is PICUS and when can I log it?',
    a: 'PICUS (Pilot in Command Under Supervision) is time logged by a co-pilot (F/O) when acting in the role of PIC under the supervision of a qualified captain. In Canada, this is recognized under CAR 401.08 and can be credited toward ATPL minimums. You may log PICUS only when you are the actual decision-maker for the flight under direct supervision.'
  },
  {
    q: 'How do I count block time vs. flight time?',
    a: 'Block time (BLH) starts when the aircraft moves under its own power (chocks out / brakes released) and ends when it comes to rest at the gate (chocks in). Flight time starts at first movement for takeoff and ends at landing rollout. For airline operations, Transport Canada generally accepts block time for logbook purposes under CAR 401.08.'
  },
  {
    q: 'What medical class do airline pilots need and how often must I renew?',
    a: 'ATPL holders operating under CAR 705 (air carrier) require a Category 1 Medical Certificate. For pilots under 40, it is valid for 12 months. For pilots 40 and older, it must be renewed every 6 months. Transport Canada medical exams are conducted by designated Aviation Medical Examiners (AMEs).'
  },
  {
    q: 'Can I count simulator time toward my ATPL hours?',
    a: 'Yes, but with limits. Under CAR 401.73, a maximum of 25 hours of approved flight simulator time may be credited toward the 1,500-hour ATPL requirement (200 hours for multi-engine helicopter). The simulator must be approved by Transport Canada. All simulator time should be logged under the Simulator (SIM) column, not as flight time.'
  },
];

// AI "Ask a Question" feature removed — askQuestion() and renderQAHistory()
// previously lived here. See git history at commit aedca46 for the implementation.
// Re-introduce as a premium / authenticated feature once Cumulo has Supabase auth
// and bilingual EN/FR support.

function renderQA() {
  // FAQ accordion (static, no AI)
  const faqList = document.getElementById('faqList');
  if (faqList && !faqList.children.length) {
    faqList.innerHTML = FAQS.map((f, i) => `
      <div class="faq-item" id="faq-${i}">
        <div class="faq-q" onclick="toggleFaq(${i})">
          <span>${f.q}</span>
          <span class="faq-chevron">▼</span>
        </div>
        <div class="faq-a">${f.a}</div>
      </div>`).join('');
  }
}

function toggleFaq(i) {
  const el = document.getElementById('faq-' + i);
  if (el) el.classList.toggle('open');
}

// ═══════════════════════════════════════════
// FEATURE 11 — ELECTRONIC SIGNATURE
// ═══════════════════════════════════════════
let sigDrawing = false, sigCtx = null, sigCanvas = null;

function initSignature() {
  sigCanvas = document.getElementById('sigCanvas');
  if (!sigCanvas) return;
  sigCanvas.width = sigCanvas.offsetWidth || 600;
  sigCtx = sigCanvas.getContext('2d');
  sigCtx.strokeStyle = '#0f2044';
  sigCtx.lineWidth = 2.2;
  sigCtx.lineCap = 'round';
  sigCtx.lineJoin = 'round';

  // Load saved signature
  const saved = localStorage.getItem('logbook_signature');
  if (saved) {
    const img = new Image();
    img.onload = () => sigCtx.drawImage(img, 0, 0, sigCanvas.width, sigCanvas.height);
    img.src = saved;
    document.getElementById('sigStatus').textContent = '✓ Signature saved';
  }

  const getPos = e => {
    const r = sigCanvas.getBoundingClientRect();
    const scaleX = sigCanvas.width / r.width;
    const scaleY = sigCanvas.height / r.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * scaleX, y: (src.clientY - r.top) * scaleY };
  };

  sigCanvas.addEventListener('mousedown',  e => { sigDrawing=true; const p=getPos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x,p.y); });
  sigCanvas.addEventListener('mousemove',  e => { if(!sigDrawing) return; const p=getPos(e); sigCtx.lineTo(p.x,p.y); sigCtx.stroke(); });
  sigCanvas.addEventListener('mouseup',    () => sigDrawing=false);
  sigCanvas.addEventListener('mouseleave', () => sigDrawing=false);
  sigCanvas.addEventListener('touchstart', e => { e.preventDefault(); sigDrawing=true; const p=getPos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x,p.y); }, {passive:false});
  sigCanvas.addEventListener('touchmove',  e => { e.preventDefault(); if(!sigDrawing) return; const p=getPos(e); sigCtx.lineTo(p.x,p.y); sigCtx.stroke(); }, {passive:false});
  sigCanvas.addEventListener('touchend',   () => sigDrawing=false);
}

function clearSignature() {
  if (!sigCtx || !sigCanvas) return;
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  document.getElementById('sigStatus').textContent = '';
}

function saveSignature() {
  if (!sigCanvas) return;
  const data = sigCanvas.toDataURL('image/png');
  localStorage.setItem('logbook_signature', data);
  document.getElementById('sigStatus').textContent = '✓ Saved';
  showToast('Signature saved ✓', 'success');
}

// ═══════════════════════════════════════════
// FEATURE 10 — AVIATION GLOSSARY
// ═══════════════════════════════════════════
// Logbook-only glossary : acronyms a pilot will actually see in their logbook,
// in TC regulations (CAR / RAC), or in Cumulo's import filters.
// We exclude general aviation terms (ATC, ILS, VOR, etc.) — they belong in
// an aviation reference, not a logbook tool.
const GLOSSARY = [
  // Pilot positions & roles
  ['PIC',    'Pilot in Command — the captain; legally responsible for the flight'],
  ['SIC',    'Second in Command — co-pilot / first officer role'],
  ['F/O',    'First Officer — co-pilot, second in command'],
  ['PICUS',  'Pilot in Command Under Supervision — co-pilot acting as PIC under captain supervision (counts toward PIC time)'],
  ['Dual',   'Flight time under instruction from a flight instructor'],
  ['Solo',   'Flight time without an instructor (typically student pilot)'],

  // Time columns (CAR 401.08)
  ['Block Time', 'Time from chocks-out (engine start / brake release) to chocks-in. Synonym: Flight Time per CAR 101.01'],
  ['BLH',    'Block Hours — synonym for Block Time / Flight Time'],
  ['Air Time', 'Time from wheels-up to wheels-down. Used for aircraft maintenance, NOT for the pilot logbook'],
  ['Duty Time', 'Time on duty — typically check-in to check-out, broader than block time'],

  // Conditions (CAR 401.08(2)(d))
  ['Day',    'Daytime flight — sunrise to 30 min before sunset (varies by jurisdiction)'],
  ['Night',  'Per RAC 101.01 (Canada): from 30 min after sunset to 30 min before sunrise'],
  ['IFR',    'Instrument Flight Rules — flight conducted under instrument procedures'],
  ['VFR',    'Visual Flight Rules — flight by visual reference'],

  // Engine class (Standard 421)
  ['SE',     'Single-Engine — aircraft with one engine'],
  ['ME',     'Multi-Engine — aircraft with more than one engine'],

  // Cross-country
  ['XC',     'Cross-Country — flight to an aerodrome more than 25 NM (46.3 km) from the point of departure (CAR 401.34)'],

  // Instrument
  ['Inst Actual', 'Instrument time in actual IMC (clouds, low vis)'],
  ['Inst Hood',   'Instrument time under a view-limiting device (training)'],
  ['Inst Sim/FSTD', 'Instrument time in a Flight Simulation Training Device — logged SEPARATELY from flight time'],
  ['Approach', 'An instrument approach to landing or missed approach (counts toward CAR 401.05 IFR currency: 6 in 6 months)'],

  // Landings & currency
  ['LDG',    'Landing'],
  ['T/O',    'Take-off'],

  // Simulator
  ['SIM',    'Simulator session — does NOT count as block time, logged separately per CAR 401.08'],
  ['FFS',    'Full Flight Simulator — highest-fidelity (Level C/D) Approved Flight Simulator'],
  ['FTD',    'Flight Training Device — fixed-base sim, lower fidelity than FFS'],
  ['FNPT',   'Flight & Navigation Procedures Trainer — basic flight trainer'],
  ['PPC',    'Pilot Proficiency Check — annual/biannual proficiency test (CAR 421.05)'],
  ['IPC',    'Instrument Proficiency Check — restores expired IFR rating'],
  ['LOFT',   'Line Oriented Flight Training — full-flight scenario training in sim'],

  // Licences
  ['PPL',    'Private Pilot Licence'],
  ['CPL',    'Commercial Pilot Licence'],
  ['ATPL',   'Airline Transport Pilot Licence — highest pilot certificate in Canada'],

  // Reference timestamps used in iCal / rosters
  ['STD',    'Scheduled Time of Departure (planned block-off)'],
  ['STA',    'Scheduled Time of Arrival (planned block-on)'],
  ['ATD',    'Actual Time of Departure (real block-off)'],
  ['ATA',    'Actual Time of Arrival (real block-on)'],
  ['CI/CO',  'Check-In / Check-Out — duty-day start and end (broader than block)'],

  // Roster activity codes (Navblue) — what Cumulo filters out of imports
  ['DH',     'Deadhead — crew travelling as passenger to position to another base (not loggable as PIC/SIC)'],
  ['GD',     'Guaranteed Day Off (Porter/Navblue roster code)'],
  ['SDO',    'Scheduled Day Off (rest)'],
  ['HTL',    'Hotel / layover (roster code)'],
  ['REAX',   'Reassignable Reserve (roster code)'],
  ['VAC',    'Vacation'],
  ['PER',    'Personal Day'],

  // Aircraft / aerodrome identifiers
  ['ICAO',   '4-letter aerodrome identifier (e.g. CYOW, KBOS) used in flight plans and logbooks'],
  ['IATA',   '3-letter airport code (e.g. YOW, BOS) — common in tickets and Navblue rosters'],
  ['MTOW',   'Maximum Take-Off Weight (sometimes referenced for aircraft class)'],

  // Regulatory
  ['TC',     'Transport Canada — Canadian aviation regulatory authority'],
  ['CAR',    'Canadian Aviation Regulations (SOR/96-433) — primary aviation regulation in Canada'],
  ['RAC',    'Règlement de l\'aviation canadien — French name for the CAR'],
  ['CAR 401.05', 'Recency requirements (5 landings 90 days · 6 IFR approaches 6 months)'],
  ['CAR 401.08', 'Personal Log requirements (the 9 mandatory fields per flight)'],
  ['CAR 401.34', 'Cross-country definition (> 25 NM)'],
  ['Standard 421', 'Personnel Licensing Standards — categories of experience for licence applications'],
  ['CARS', 'Commercial Air Service Standards (CAR 700 series — operations like 705 airline)'],
  ['705',  'Subpart 705 — Airline Operations under the CARs'],
].sort((a,b) => a[0].localeCompare(b[0]));

let glossaryFilter = '';

function renderGlossary() {
  filterGlossary('');
  const s = document.getElementById('glossarySearch');
  if (s) s.value = '';
}

function filterGlossary(val) {
  glossaryFilter = val.toLowerCase();
  const list = GLOSSARY.filter(([abbr, def]) =>
    abbr.toLowerCase().includes(glossaryFilter) || def.toLowerCase().includes(glossaryFilter)
  );
  const el = document.getElementById('glossaryList');
  if (!el) return;
  el.innerHTML = list.length
    ? list.map(([abbr, def]) => `
        <div class="glossary-item">
          <div class="glossary-abbr">${abbr}</div>
          <div class="glossary-def">${def}</div>
        </div>`).join('')
    : '<p style="padding:20px;color:var(--text-muted);font-family:var(--font-mono);font-size:12px">No results found.</p>';
}

// ═══════════════════════════════════════════
// FEATURE 9 — YEAR RECAP
// ═══════════════════════════════════════════
let recapChartInst = null;

function initRecapYears() {
  const sel = document.getElementById('recapYear');
  if (!sel) return;
  const years = [...new Set(flights.map(f => f.date&&f.date.substring(0,4)).filter(Boolean))].sort().reverse();
  const thisYear = new Date().getFullYear().toString();
  if (!years.includes(thisYear)) years.unshift(thisYear);
  sel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
}

function renderRecap() {
  const sel = document.getElementById('recapYear');
  if (!sel) return;
  const year = sel.value;
  const yFlights = flights.filter(f => f.date && f.date.startsWith(year));

  // Stats
  const total = yFlights.reduce((s,f) => s + (+f.total||0), 0);
  const block = yFlights.reduce((s,f) => s + (+f.block||0), 0);
  const ldg   = yFlights.reduce((s,f) => s + (+f.ldgDay||0) + (+f.ldgNight||0), 0);
  const night = yFlights.reduce((s,f) => s + (+f.meNightPic||0) + (+f.meNightDual||0) + (+f.meNightCop||0), 0);
  document.getElementById('recapStats').innerHTML = [
    ['Total Hours', fmt(total), 'hours'],
    ['Block Hours', fmt(block), 'hours'],
    ['Night Time',  fmt(night), 'hours'],
    ['Landings',    ldg,        'total'],
  ].map(([lbl,val,unit]) => `
    <div class="stat-card">
      <div class="stat-label">${lbl}</div>
      <div class="stat-value">${val}</div>
      <div class="stat-unit">${unit}</div>
    </div>`).join('');

  // Monthly chart
  const months = Array.from({length:12}, (_,i) => {
    const key = `${year}-${String(i+1).padStart(2,'0')}`;
    const d = new Date(+year, i, 1);
    return {
      label: d.toLocaleDateString('en-CA',{month:'short'}),
      val: parseFloat(yFlights.filter(f=>f.date&&f.date.startsWith(key)).reduce((s,f)=>s+(+f.block||0),0).toFixed(1))
    };
  });

  const canvas = document.getElementById('recapChart');
  if (canvas && typeof Chart !== 'undefined') {
    if (recapChartInst) { recapChartInst.destroy(); recapChartInst = null; }
    recapChartInst = new Chart(canvas, {
      type:'bar',
      data:{
        labels: months.map(m=>m.label),
        datasets:[{
          label:'Block Hours',data:months.map(m=>m.val),
          backgroundColor:'rgba(61,123,196,0.72)',borderColor:'rgba(61,123,196,1)',borderWidth:1.5,borderRadius:4
        }]
      },
      options:{
        responsive:true,animation:{duration:600},
        plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>ctx.parsed.y.toFixed(1)+' hrs'}}},
        scales:{y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.05)'},ticks:{font:{family:"var(--font-mono)",size:10},color:'#6b7fa3'}},
                x:{grid:{display:false},ticks:{font:{family:"var(--font-mono)",size:10},color:'#6b7fa3'}}}
      }
    });
  }

  // Top airports (from routes)
  const airports = {};
  yFlights.forEach(f => {
    (f.route||'').split(/[\s\-\/]+/).forEach(a => {
      a = a.trim().toUpperCase();
      if (a.length===3 || a.length===4) airports[a] = (airports[a]||0) + 1;
    });
  });
  const topAirports = Object.entries(airports).sort((a,b)=>b[1]-a[1]).slice(0,8);
  document.getElementById('recapAirports').innerHTML = topAirports.length
    ? topAirports.map(([a,n]) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-family:var(--font-mono);font-weight:600;color:var(--navy)">${a}</span>
        <span style="color:var(--text-muted);font-size:12px">${n} visit${n!==1?'s':''}</span>
      </div>`).join('')
    : '<p style="color:var(--text-muted);font-family:var(--font-mono);font-size:12px">No data for this year.</p>';

  // Top routes
  const routes = {};
  yFlights.forEach(f => {
    const r = (f.route||'').trim().toUpperCase();
    if (r) routes[r] = (routes[r]||0) + 1;
  });
  const topRoutes = Object.entries(routes).sort((a,b)=>b[1]-a[1]).slice(0,10);
  document.getElementById('recapRoutes').innerHTML = topRoutes.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:8px">${topRoutes.map(([r,n]) =>
        `<div style="background:var(--bg-subtle);border-radius:6px;padding:5px 12px;font-family:var(--font-mono);font-size:11px;color:var(--navy)">
          ${r} <span style="color:var(--accent);margin-left:4px">×${n}</span>
        </div>`).join('')}</div>`
    : '<p style="color:var(--text-muted);font-family:var(--font-mono);font-size:12px">No routes for this year.</p>';
}

// ═══════════════════════════════════════════
// FEATURE 6 — DARK MODE
// ═══════════════════════════════════════════
function toggleDarkMode(on) {
  setTheme(on ? 'dark' : 'light');
}

function setTheme(theme) {
  const on = theme === 'dark';
  document.body.classList.toggle('dark', on);
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('logbook_dark', on ? '1' : '0');
  // Sync topbar toggle buttons
  const btnLight = document.getElementById('themeBtnLight');
  const btnDark  = document.getElementById('themeBtnDark');
  if (btnLight && btnDark) {
    btnLight.classList.toggle('active', !on);
    btnDark.classList.toggle('active', on);
  }
  // Sync legacy checkbox in Settings page
  const cb = document.getElementById('darkModeToggle');
  if (cb) cb.checked = on;
  // Re-render chart so colors adapt
  if (typeof monthlyChartInst !== 'undefined' && monthlyChartInst) renderChart();
}

function applyDarkMode() {
  const on = localStorage.getItem('logbook_dark') === '1';
  setTheme(on ? 'dark' : 'light');
}

// ═══════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════
let toastTimer;
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
// Build version stamp — bump every push so user can verify fresh load
const BUILD_VERSION = 'v3a-2026-05-11-stacking-fix';

(function init() {
  applyDarkMode();
  // Visible version badge bottom-right — verifies fresh page load on iOS
  const vBadge = document.createElement('div');
  vBadge.id = 'buildVersion';
  vBadge.textContent = BUILD_VERSION;
  vBadge.style.cssText = 'position:fixed;bottom:6px;right:8px;z-index:9999;font-family:var(--font-mono);font-size:9px;color:rgba(120,120,120,0.6);pointer-events:none;letter-spacing:0.04em;';
  document.body.appendChild(vBadge);
  // Wire hamburger, overlay, and delegated nav-item clicks
  wireNav();
  const p = DB.loadProfile();
  if (p.fname) updateProfileDisplay(p);
  renderDashboard();
  document.getElementById('dashDate').textContent =
    new Date().toLocaleDateString('en-CA', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
  loadNavblueUI();
  // Update relative-time status every minute
  setInterval(updateNavblueStatus, 60000);
  // First-launch onboarding (only if no profile name set)
  if (shouldShowOnboarding()) {
    setTimeout(startOnboarding, 400);
  }
})();