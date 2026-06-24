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
    // PIC includes single-engine time (seDay/seNight): per Transport Canada,
    // PIC is PIC regardless of engine count. The app has a single SE bucket
    // (no SE PIC/dual split), so SE time is treated as PIC per the app's model.
    pic += (+f.meDayPic||0) + (+f.meNightPic||0) + (+f.heliDayPic||0) + (+f.heliNightPic||0)
         + (+f.seDay||0) + (+f.seNight||0);
    sic += (+f.meDayCop||0) + (+f.meNightCop||0) + (+f.heliDayCop||0) + (+f.heliNightCop||0);
    // Night = all night flying, every aircraft class (ME + heli + single-engine).
    night += (+f.meNightPic||0) + (+f.meNightDual||0) + (+f.meNightCop||0)
           + (+f.heliNightPic||0) + (+f.heliNightDual||0) + (+f.heliNightCop||0)
           + (+f.seNight||0);
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
//  Compute Night / XC / landings for a flight that was missing them.
//
//  STRICT POLICY (TC CAR 401.08 contemporaneous-record protection):
//  this function NEVER overwrites a value the pilot has already entered.
//  It only fills empty slots — for the role detected on the flight, and
//  only for slots that are currently 0/undefined. If every role-relevant
//  slot is already populated, the function returns the flight unchanged.
//
//  Old behavior (pre-2026-05-26): the function unconditionally wrote the
//  great-circle result into the role's day/night/XC slots, which would
//  overwrite a manually-typed value. That was unsafe and the sync UI
//  reporting it as "Night/XC recalculated" sounded like falsification.
//  Removed.
//
//  Returns either the same `f` (if no change is safe), or a NEW object
//  with only the empty slots filled in.
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

  // Detect role from the flight's existing data. If the pilot has typed
  // a value in any role's day/night/XC slots, that role is "active" and
  // we never touch it again. Default to cop (F/O) for typical Porter use.
  let role = 'cop';
  if ((+f.meDayPic||0) + (+f.meNightPic||0) > 0) role = 'pic';
  else if ((+f.meDayDual||0) + (+f.meNightDual||0) > 0) role = 'dual';

  // Build a CANDIDATE output, then conditionally apply only-empty fills.
  // Pre-existing role-relevant values block the fill for that slot entirely.
  const out = { ...f };
  out.dep_icao = depICAO;
  out.arr_icao = arrICAO;

  // _isEmpty: true iff the slot has NEVER been populated.
  //
  // STRICT — undefined / null only. An explicit 0 is treated as "the pilot
  // (or a prior fill) has already recorded a valid value for this slot,
  // which happens to be zero". This matters because:
  //
  //   - navblueEventToFlight() returns a flight with explicit 0 values in
  //     slots that don't apply to the role (e.g. xcDayPic = 0 for a cop
  //     flight). Those are correct values, not gaps.
  //   - After the first post-sync fill, a daytime-only flight has
  //     meNightCop = 0 (correct — no night). If we treated 0 as empty,
  //     every subsequent sync would re-touch the same 16 flights with the
  //     same zero, inflating "X flights filled in" forever.
  //   - A pilot who deliberately entered 0 (e.g. F/O on a vol they were
  //     pure SIC on, so no PIC time) MUST have that value preserved.
  //
  // Strict check fixes all three. The only case it can't handle: a pilot
  // who entered partial data with literal "—" or empty string. Those are
  // edge cases that should be cleaned up at the form layer, not here.
  const _isEmpty = (v) => v === undefined || v === null;
  let touched = false;

  if (role === 'cop') {
    if (_isEmpty(f.meDayCop))   { out.meDayCop   = split.dayHours;             touched = true; }
    if (_isEmpty(f.meNightCop)) { out.meNightCop = split.nightHours;           touched = true; }
    if (_isEmpty(f.xcDayCop))   { out.xcDayCop   = isXC ? split.dayHours   : 0; touched = true; }
    if (_isEmpty(f.xcNightCop)) { out.xcNightCop = isXC ? split.nightHours : 0; touched = true; }
  } else if (role === 'pic') {
    if (_isEmpty(f.meDayPic))   { out.meDayPic   = split.dayHours;             touched = true; }
    if (_isEmpty(f.meNightPic)) { out.meNightPic = split.nightHours;           touched = true; }
    if (_isEmpty(f.xcDayPic))   { out.xcDayPic   = isXC ? split.dayHours   : 0; touched = true; }
    if (_isEmpty(f.xcNightPic)) { out.xcNightPic = isXC ? split.nightHours : 0; touched = true; }
  } else { // dual
    if (_isEmpty(f.meDayDual))   { out.meDayDual   = split.dayHours;             touched = true; }
    if (_isEmpty(f.meNightDual)) { out.meNightDual = split.nightHours;           touched = true; }
    if (_isEmpty(f.xcDayDual))   { out.xcDayDual   = isXC ? split.dayHours   : 0; touched = true; }
    if (_isEmpty(f.xcNightDual)) { out.xcNightDual = isXC ? split.nightHours : 0; touched = true; }
  }

  // Landing day/night based on arrival — same only-fill-empty rule.
  // The OLD behavior reset ldgDay/ldgNight to {0,1} or {1,0} regardless of
  // existing values; that could erase a pilot's manual entry. Now we only
  // fill if both landing slots are currently empty.
  if (_isEmpty(f.ldgDay) && _isEmpty(f.ldgNight)) {
    if (isNightUTC(blockOn, arrCoords.lat, arrCoords.lon)) {
      out.ldgNight = 1; out.ldgDay = 0;
    } else {
      out.ldgDay = 1; out.ldgNight = 0;
    }
    touched = true;
  }

  // If nothing was actually changed (all role-relevant slots were already
  // populated), return the original reference so the caller's "did this
  // change?" check stays accurate.
  return touched ? out : f;
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
  if (min < 1) return t('age.justNow');
  if (min < 60) return t('age.min', { n: min });
  if (min < 1440) return t('age.hour', { n: Math.floor(min / 60) });
  return t('age.day', { n: Math.floor(min / 1440) });
}

// Translate a stored (English) snapshot operation label to the current language
// at DISPLAY time, so persisted snapshots stay stable across language switches.
function _snapOpLabel(op) {
  if (!op) return '';
  if (op.indexOf('Import from ') === 0) return t('undo.op.import', { source: op.slice(12) });
  if (op.indexOf('before undo of "') === 0) return t('undo.op.beforeUndo', { op: _snapOpLabel(op.slice(16, -1)) });
  const map = {
    'Navblue iCal sync': 'undo.op.sync',
    'Crew names enrichment from PDF': 'undo.op.enrich',
    'Cloud migration to Supabase': 'undo.op.migration',
    'delete-flight': 'undo.op.deleteFlight',
  };
  return map[op] ? t(map[op]) : op;
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

  if (!confirm(t('confirm.restoreSnapshot', { op: _snapOpLabel(snap.operation), age: ageString(Date.now() - snap.timestamp), curN: flights.length, snapN: snap.flightCount }))) return;

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
  const _dateLocale = (typeof getLang === 'function' && getLang() === 'fr') ? 'fr-CA' : 'en-CA';
  document.getElementById('importSubtitle').textContent = history.length === 1
    ? t('snap.modal.subtitleOne')
    : t('snap.modal.subtitleMany', { n: history.length });
  document.getElementById('extractedList').innerHTML = `
    <p style="margin-bottom:var(--s-3); font-size:13px; color:var(--text-secondary);">
      ${esc(t('snap.modal.intro'))}
    </p>
    ${history.map((s, i) => `
      <div class="review-item is-selected" style="cursor:pointer;" onclick="restoreSnapshot(${i}); cancelImport();">
        <div class="review-body">
          <div class="review-item-header" style="font-weight:600;">${esc(_snapOpLabel(s.operation))}</div>
          <div class="review-fields">
            <div class="review-field"><span>${esc(t('snap.modal.when'))}</span> ${ageString(Date.now() - s.timestamp)}</div>
            <div class="review-field"><span>${esc(t('snap.modal.flights'))}</span> ${s.flightCount}</div>
            <div class="review-field"><span>${esc(t('snap.modal.date'))}</span> ${new Date(s.timestamp).toLocaleString(_dateLocale)}</div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); restoreSnapshot(${i}); cancelImport();">${esc(t('btn.restore'))}</button>
      </div>
    `).join('')}
  `;
  // Override confirm button to close (no bulk action)
  document.getElementById('importConfirmBtn').textContent = t('btn.close');
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
    btn.textContent = t('undo.none');
    return;
  }
  const snap = history[0];
  const label = history.length > 1
    ? t('undo.multi', { n: history.length })
    : t('undo.single', { op: _snapOpLabel(snap.operation), age: ageString(Date.now() - snap.timestamp) });
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

// Hero number count-up animation removed 2026-05-26 — Martin found the
// numbers-running-up effect distracting. Hero now sets to target instantly.
// Pattern lesson: motion that re-runs on every Dashboard re-render (after
// every save/sync) is noisy; if we ever bring this back, gate it to ONCE
// per page session AND don't re-fire on routine data refreshes.

// ═══════════════════════════════════════════
// DASHBOARD — Q9 2026 hero direction
// (design handoff 2026-05-25, q9-2026-direction.jsx)
// ═══════════════════════════════════════════
function renderDashboard() {
  const sRaw = calcStats();
  // Brought-forward (opening balances from a paper logbook) is folded into
  // cumulative figures. sRaw.block30 + sRaw.entries stay flight-only — they
  // are activity/currency metrics, not career totals.
  const s = (typeof totalsWithOpening === 'function') ? totalsWithOpening(sRaw) : sRaw;

  // Q2 — Empty-state ghosting. When the pilot has no flights AND no opening
  // balances declared, paint the dashboard in a muted variant so it doesn't
  // look like "you've flown 0 hours forever" (which would feel broken).
  // The .no-data class on body lets CSS desaturate values, ghost the sparkline,
  // mute the validity rings (no expiry to alarm about yet), and dashed-border
  // the cards. Removed automatically as soon as one flight is logged.
  const hasFlights = Array.isArray(flights) && flights.length > 0;
  const hasOpening = (typeof hasOpeningBalances === 'function') && hasOpeningBalances();
  document.body.classList.toggle('no-data', !hasFlights && !hasOpening);

  // Discovery banner — only brand-new users see it.
  const bfBanner = document.getElementById('broughtForwardBanner');
  if (bfBanner) {
    const isBrandNew = !hasFlights && !hasOpening;
    bfBanner.style.display = isBrandNew ? 'flex' : 'none';
  }

  // (3) Greeting bar — time-aware salutation + activity sub
  _dashRenderGreeting();

  // (4a) Hero card: 88px career number + sparkline + delta pill
  const heroNumEl = document.getElementById('dashHeroNum');
  if (heroNumEl) heroNumEl.textContent = fmt(s.block || s.total);
  const delta = document.getElementById('dashHeroDelta');
  const deltaVal = document.getElementById('dashHeroDeltaVal');
  if (delta && deltaVal) {
    if (sRaw.block30 > 0) {
      const last30 = (typeof t === 'function') ? t('hero.last30') : 'last 30 days';
      deltaVal.textContent = `+${fmt(sRaw.block30)} hrs · ${last30}`;
      delta.style.display = 'inline-flex';
    } else {
      delta.style.display = 'none';
    }
  }
  const monthly = _dashMonthlyBlockTotals(12);
  _dashRenderSparkline('dashSparklineSvg', monthly);
  const labels = _dashMonthLabels(12);
  const startEl = document.getElementById('dashSparkStart');
  const endEl = document.getElementById('dashSparkEnd');
  if (startEl) startEl.textContent = labels[0];
  if (endEl) endEl.textContent = labels[labels.length - 1];

  // (4b) Validity rings: IFR / Recency / Medical
  _dashRenderValidityRings();

  // (5a) Recent legs typographic list
  _dashRenderLegs();

  // (5b) Next column — proactive cards (next flight, expiring, milestone)
  _dashRenderNextColumn();

  // (6) Compact stat strip
  _dashSetStripVal('dashStripPIC',   fmt(s.pic),   'hrs');
  _dashSetStripVal('dashStripSIC',   fmt(s.sic),   'hrs');
  _dashSetStripVal('dashStripNIGHT', fmt(s.night), 'hrs');
  _dashSetStripVal('dashStripMULTI', fmt(s.me),    'hrs');
  _dashSetStripVal('dashStripXC',    fmt(s.xc),    'hrs');
  _dashSetStripVal('dashStripLDG',   '' + s.ldg);

  // Adapt visible KPIs to the pilot's actual work (hide SIC for solo pilots,
  // hide MULTI for SE-only pilots, etc.). Runs after values are set so the
  // hidden items keep correct data behind the scenes for future use.
  _dashAdaptStripToPilotType(s);

  // Top-level alerts (medical expiring, currency lapsed, etc.) still useful
  renderAlerts();
}

// ─── Stat strip pilot-type adaptation ──────────────────────────
// Pilot type drives which of the 6 stat-strip cards make sense:
//   PIC    — universal (all pilots)
//   SIC    — only meaningful in two-crew ops (airline 705)
//   NIGHT  — universal
//   MULTI  — only meaningful if pilot flies ME aircraft
//   XC     — universal (every pilot cares about cross-country experience)
//   LDG    — universal
//
// Decisions deliberately conservative: hide ONLY when 100 % certain the
// metric is irrelevant. A bush pilot might still hop onto a Twin Otter
// (multi-engine!) once a year, so we don't hide MULTI unless their entire
// history has zero ME hours.
function _dashAdaptStripToPilotType(stats) {
  const p = (typeof DB !== 'undefined') ? (DB.loadProfile() || {}) : {};
  const pilotType = p.pilotType || 'airline705';

  const setStripItemVisible = (valId, visible) => {
    const el = document.getElementById(valId);
    if (!el) return;
    const item = el.closest('.dash-strip-item');
    if (item) item.style.display = visible ? '' : 'none';
  };

  // SIC: hide for solo-pilot operations (private, student, helicopter
  // solo, instructor, anything that's not airline 705)
  const showSIC = (pilotType === 'airline705');

  // MULTI: hide ONLY if zero ME hours in the pilot's entire history.
  // Airline pilots always see MULTI even when current company is SE.
  const meTotal = (stats && +stats.me) || 0;
  const showMULTI = (pilotType === 'airline705') || meTotal > 0;

  setStripItemVisible('dashStripSIC', showSIC);
  setStripItemVisible('dashStripMULTI', showMULTI);
  // PIC / NIGHT / XC / LDG stay visible for every pilot type.
}

// ─── Greeting bar ──────────────────────────────────────────────
function _dashRenderGreeting() {
  const lang = (typeof getLang === 'function') ? getLang() : 'en';
  const p = (typeof DB !== 'undefined') ? (DB.loadProfile() || {}) : {};
  const now = new Date();

  // Date line
  const dateEl = document.getElementById('dashGreetingDate');
  if (dateEl) {
    const wday = now.toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', { weekday: 'long' }).toUpperCase();
    const date = now.toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase().replace('.', '');
    const week = _isoWeek(now);
    const weekLabel = lang === 'fr' ? 'SEMAINE' : 'WEEK';
    dateEl.textContent = `${wday} · ${date} · ${weekLabel} ${week}`;
  }

  // Greeting line
  const helloEl = document.getElementById('dashGreetingHello');
  if (helloEl) {
    const h = now.getHours();
    const fr = lang === 'fr';
    let greet;
    if (h < 5)       greet = fr ? 'Bonsoir' : 'Good evening';
    else if (h < 12) greet = fr ? 'Bonjour' : 'Good morning';
    else if (h < 18) greet = fr ? 'Bon après-midi' : 'Good afternoon';
    else             greet = fr ? 'Bonsoir' : 'Good evening';
    const name = (p.fname || '').trim() || (fr ? 'Pilote' : 'Pilot');
    helloEl.textContent = `${greet}, ${name}.`;
  }

  // Sub line: flights this month + next primary-validity renewal.
  //
  // Profile-driven, matching the validity rings logic:
  //   - airline 705 line pilots → PPC days (CASS 725.106)
  //   - everyone else            → IFR approaches days (CAR 401.05(2))
  //
  // The "Next X renewal in Y days" copy adapts to whichever validity
  // is primary for this pilot. PPC for an airline pilot is the actual
  // calendar deadline they care about; the IFR-6mo rule doesn't apply
  // the same way when a Company PPC covers it.
  const subEl = document.getElementById('dashGreetingSub');
  if (subEl) {
    const fr = lang === 'fr';
    const monthCount = _dashCurrentMonthFlights();
    const is705ForGreet = (p.pilotType || 'airline705') === 'airline705';
    // tracksIFR = does this pilot actually fly instruments? Bush / float /
    // private VFR / student pilots see no "Next IFR renewal" line.
    const tracksIFR = is705ForGreet ||
      (typeof needsIFRTracking === 'function' && needsIFRTracking(p));
    const primaryDays = is705ForGreet
      ? _dashPPCDaysRemaining(p)
      : (tracksIFR ? _dashIFRDaysRemaining() : null);
    const primaryLabel = is705ForGreet ? 'PPC' : 'IFR';
    const parts = [];
    if (monthCount > 0) {
      parts.push(fr
        ? `Vous avez fait <strong>${monthCount} vol${monthCount !== 1 ? 's' : ''}</strong> ce mois-ci.`
        : `You've logged <strong>${monthCount} flight${monthCount !== 1 ? 's' : ''}</strong> this month.`);
    } else if (flights.length > 0) {
      parts.push(fr ? 'Aucun vol enregistré ce mois-ci.' : 'No flights logged this month yet.');
    }
    if (primaryDays !== null) {
      if (primaryDays > 30) {
        parts.push(fr
          ? `Prochain renouvellement ${primaryLabel} dans <strong>${primaryDays} jours</strong>.`
          : `Next ${primaryLabel} renewal in <strong>${primaryDays} days</strong>.`);
      } else if (primaryDays > 0) {
        parts.push(fr
          ? `Prochain renouvellement ${primaryLabel} dans <span class="dash-warn-amber">${primaryDays} jours</span>.`
          : `Next ${primaryLabel} renewal in <span class="dash-warn-amber">${primaryDays} days</span>.`);
      } else {
        parts.push(fr
          ? `<span class="dash-warn-amber">Validité ${primaryLabel} expirée.</span>`
          : `<span class="dash-warn-amber">${primaryLabel} currency expired.</span>`);
      }
    } else if (is705ForGreet) {
      // 705 pilot but no PPC date entered yet — quiet nudge to fill it in.
      parts.push(fr
        ? `Définissez votre date PPC dans Profil pour suivre l'échéance.`
        : `Set your PPC date in Profile to track renewal.`);
    }
    subEl.innerHTML = parts.join(' ');
  }
}

function _isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function _dashCurrentMonthFlights() {
  if (!Array.isArray(flights)) return 0;
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return flights.filter(f => f.date && f.date.startsWith(ym)).length;
}

// ─── Sparkline (last N months of block hours) ──────────────────
function _dashMonthlyBlockTotals(months) {
  const result = new Array(months).fill(0);
  if (!Array.isArray(flights)) return result;
  const now = new Date();
  const buckets = {};
  flights.forEach(f => {
    if (!f.date) return;
    const ym = f.date.slice(0, 7);
    buckets[ym] = (buckets[ym] || 0) + (+f.block || 0);
  });
  // index 0 = oldest, index N-1 = current month
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    result[i] = buckets[ym] || 0;
  }
  return result;
}

function _dashMonthLabels(months) {
  const lang = (typeof getLang === 'function') ? getLang() : 'en';
  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    out.push(d.toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', { month: 'short', year: '2-digit' }).toUpperCase().replace('.', ''));
  }
  return out;
}

function _dashRenderSparkline(svgId, data) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  const w = 300, h = 70;
  if (!Array.isArray(data) || data.length === 0 || data.every(v => !v)) {
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

// ─── Validity rings (profile-driven) ─────────────────────────
// For airline 705 line pilots (multi-pilot ops): PPC | REC | MED
//   PPC is the primary currency check under CASS 725.106 — it supersedes
//   the generic 6-IFR-approaches/6-months rule (CAR 401.05(2)) which is
//   intended for private/CPL pilots without a Company PPC.
// For non-705 pilots (private/student/instructor/helicopter): IFR | REC | MED
//   The generic CAR 401.05(2) rule applies; show the approach count.
function _dashRenderValidityRings() {
  const lang = (typeof getLang === 'function') ? getLang() : 'en';
  const profile = (typeof DB !== 'undefined' && DB.loadProfile) ? DB.loadProfile() : {};
  const is705 = (profile.pilotType || 'airline705') === 'airline705';

  // Update the first ring's click handler to point at the correct drill-down
  // panel ('ppc' for 705 line pilots, 'ifr' for everyone else). The ring's
  // HTML is rendered once with onclick='openDashDrill("ifr")'; we patch it
  // here so the route matches what the ring actually displays.
  const ring1Block = document.getElementById('dashRingIFR')?.parentElement;
  if (ring1Block) {
    const targetKey = is705 ? 'ppc' : 'ifr';
    ring1Block.setAttribute('onclick', `openDashDrill('${targetKey}')`);
    ring1Block.setAttribute('onkeydown',
      `if(event.key==='Enter'||event.key===' '){event.preventDefault();openDashDrill('${targetKey}');}`);
  }

  if (is705) {
    // ── PPC ring (replaces IFR for 705 line pilots) ──
    const ppcDays = _dashPPCDaysRemaining(profile);
    if (ppcDays === null) {
      _dashRenderRing('dashRingIFR', 0, '#7C8497', 'PPC');
      const sub = document.getElementById('dashRingIFRSub');
      if (sub) sub.textContent = lang === 'fr' ? 'non défini' : 'not set';
    } else {
      // PPC validity: typically 6 months for multi-pilot 705. Treat 180 days
      // as full ring; green > 60d, amber > 0, red ≤ 0 / overdue.
      const ppcPct = Math.max(0, Math.min(100, (ppcDays / 180) * 100));
      const ppcColor = ppcDays > 60 ? '#10A37F' : (ppcDays > 0 ? '#B87C0C' : '#DC2A2A');
      _dashRenderRing('dashRingIFR', ppcPct, ppcColor, 'PPC');
      const sub = document.getElementById('dashRingIFRSub');
      if (sub) sub.textContent = ppcDays > 0
        ? `${ppcDays} ${lang === 'fr' ? 'j' : 'd'}`
        : (lang === 'fr' ? 'Expiré' : 'Expired');
    }
    // Update the cap label (was "6 MOS" for IFR, change to "CASS 725")
    const capEl = document.querySelector('#dashRingIFR ~ .dash-ring-cap, #dashRingIFR + .dash-ring-sub + .dash-ring-cap');
    // (DOM order is .dash-ring → .dash-ring-sub → .dash-ring-cap — easier
    // to update via the parent block.)
    const blockEl = document.getElementById('dashRingIFR')?.parentElement;
    if (blockEl) {
      const cap = blockEl.querySelector('.dash-ring-cap');
      if (cap) cap.textContent = 'CASS 725';
    }
  } else {
    // ── IFR ring (generic CAR 401.05(2) for non-705 pilots) ──
    const ifrCount = _dashApproachesIn6mo();
    const ifrPct = Math.min(100, (ifrCount / 6) * 100);
    const ifrColor = ifrCount >= 6 ? '#10A37F' : (ifrCount >= 4 ? '#B87C0C' : '#DC2A2A');
    _dashRenderRing('dashRingIFR', ifrPct, ifrColor, 'IFR');
    const ifrSub = document.getElementById('dashRingIFRSub');
    if (ifrSub) ifrSub.textContent = `${ifrCount} / 6 ${lang === 'fr' ? 'appr.' : 'appr.'}`;
    const blockEl = document.getElementById('dashRingIFR')?.parentElement;
    if (blockEl) {
      const cap = blockEl.querySelector('.dash-ring-cap');
      if (cap) cap.textContent = '6 MOS';
    }
  }

  // Recency: 5 landings in last 6 months (CAR 401.05(2))
  const ldgCount = _dashLandingsIn6mo();
  const recPct = Math.min(100, (ldgCount / 5) * 100);
  const recColor = ldgCount >= 5 ? '#10A37F' : (ldgCount >= 3 ? '#B87C0C' : '#DC2A2A');
  _dashRenderRing('dashRingREC', recPct, recColor, 'REC');
  const recSub = document.getElementById('dashRingRECSub');
  if (recSub) recSub.textContent = `${ldgCount} / 5 ${lang === 'fr' ? 'att.' : 'ldg'}`;

  // Medical
  const medDays = _dashMedicalDaysRemaining();
  const medBlock = document.getElementById('dashRingMedBlock');
  if (medDays === null) {
    if (medBlock) medBlock.style.display = 'none';
  } else {
    if (medBlock) medBlock.style.display = '';
    const medPct = Math.max(0, Math.min(100, (medDays / 180) * 100));
    const medColor = medDays > 60 ? '#10A37F' : (medDays > 0 ? '#B87C0C' : '#DC2A2A');
    _dashRenderRing('dashRingMED', medPct, medColor, 'MED');
    const medSub = document.getElementById('dashRingMEDSub');
    if (medSub) medSub.textContent = medDays > 0
      ? `${medDays} ${lang === 'fr' ? 'j' : 'd'}`
      : (lang === 'fr' ? 'Expiré' : 'Expired');
  }
}

function _dashRenderRing(containerId, pct, color, label) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const size = 64, stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  // Classed circles (.dash-ring-track / .dash-ring-progress) so the
  // empty-state CSS variant (body.no-data) can desaturate without
  // touching the JS color logic.
  el.innerHTML = `
    <svg width="${size}" height="${size}">
      <circle class="dash-ring-track" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="#E1E5EC" stroke-width="${stroke}"/>
      <circle class="dash-ring-progress" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" stroke-linecap="round"/>
    </svg>
    <div class="dash-ring-label">${esc(label)}</div>
  `;
}

function _dashApproachesIn6mo() {
  if (!Array.isArray(flights)) return 0;
  const cutoff = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  return flights.filter(f => f.date >= cutoff)
    .reduce((sum, f) => sum + (+f.approaches || 0), 0);
}

function _dashLandingsIn6mo() {
  if (!Array.isArray(flights)) return 0;
  const cutoff = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  return flights.filter(f => f.date >= cutoff)
    .reduce((sum, f) => sum + (+f.ldgDay || 0) + (+f.ldgNight || 0), 0);
}

// Days until the 6th most recent approach drops out of the 180-day window.
// If < 6 approaches in window, returns 0 (already not current).
function _dashIFRDaysRemaining() {
  if (!Array.isArray(flights) || flights.length === 0) return null;
  const apps = [];
  flights.forEach(f => {
    const n = +f.approaches || 0;
    for (let i = 0; i < n; i++) apps.push(f.date);
  });
  apps.sort((a, b) => (b || '').localeCompare(a || ''));
  if (apps.length < 6) return 0;
  const sixth = apps[5];
  if (!sixth) return null;
  const expiry = new Date(sixth + 'T00:00:00');
  expiry.setDate(expiry.getDate() + 180);
  const days = Math.ceil((expiry - Date.now()) / 86400000);
  return Math.max(0, days);
}

function _dashMedicalDaysRemaining() {
  const p = (typeof DB !== 'undefined') ? (DB.loadProfile() || {}) : {};
  if (!p.medical) return null;
  const exp = new Date(p.medical + 'T00:00:00');
  if (isNaN(exp.getTime())) return null;
  return Math.ceil((exp - Date.now()) / 86400000);
}

// Days until PPC (Pilot Proficiency Check) expiry under CASS 725.106.
// Returns null when the pilot hasn't entered a date (= we don't know, not
// "expired today"). The caller decides how to display the unknown state.
function _dashPPCDaysRemaining(profile) {
  const p = profile || ((typeof DB !== 'undefined') ? (DB.loadProfile() || {}) : {});
  if (!p.ppcDueDate) return null;
  const exp = new Date(p.ppcDueDate + 'T00:00:00');
  if (isNaN(exp.getTime())) return null;
  return Math.ceil((exp - Date.now()) / 86400000);
}

// LOFT is intentionally not tracked as a separate Cumulo field — operators
// define in their approved training program whether/how a LOFT renews PPC
// currency. When a LOFT happens, the pilot updates ppcDueDate. No helper.

// ─── Recent legs typographic list ─────────────────────────────
function _dashRenderLegs() {
  const el = document.getElementById('dashLegsList');
  if (!el) return;
  const lang = (typeof getLang === 'function') ? getLang() : 'en';
  const recent = [...flights].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5);
  if (recent.length === 0) {
    el.innerHTML = `<div class="dash-legs-empty">${esc(lang === 'fr' ? 'Aucun vol enregistré.' : 'No flights logged yet.')}</div>`;
    return;
  }
  el.innerHTML = recent.map(f => {
    const d = f.date ? new Date(f.date + 'T12:00:00') : null;
    const dateStr = d
      ? d.toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short' }).toUpperCase().replace('.', '')
      : '—';
    // Each leg is clickable — opens the same flight-detail modal used by
    // the Logbook table. Falls back to no-op if id is missing (shouldn't
    // happen in practice, but defensive in case of malformed data).
    const fid = esc(f.id || '');
    const clickAttr = fid
      ? ` onclick="openFlightDetail('${fid}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openFlightDetail('${fid}');}"`
      : '';
    return `
    <div class="dash-leg dash-clickable"${clickAttr}>
      <span class="dash-leg-date">${esc(dateStr)}</span>
      <span class="dash-leg-route">${esc(f.route || '—')}</span>
      <span class="dash-leg-reg">${esc(f.reg || '—')}</span>
      <span class="dash-leg-hours">${fmt(f.block || f.total)}</span>
    </div>`;
  }).join('');
}

// ─── Next column (proactive copilot cards) ─────────────────────
// Always returns 3 cards with smart fallbacks so the right column never
// looks empty next to the recent-legs list. Card priority:
//   1. NEXT — Navblue CTA if not connected, else activity / next-flight stub
//   2. STATUS — most concerning currency (IFR / REC / MED) or all-current pill
//   3. MILESTONE — next career-hour threshold (always)
function _dashRenderNextColumn() {
  const el = document.getElementById('dashNextColumn');
  if (!el) return;
  const lang = (typeof getLang === 'function') ? getLang() : 'en';
  const fr = lang === 'fr';
  const cards = [];

  // ─── Card 1: NEXT FLIGHT / ACTIVITY ────────────────────────
  const navblueKey = (typeof NAVBLUE_URL_KEY !== 'undefined') ? NAVBLUE_URL_KEY : 'cumulo_navblue_url';
  const navblueUrl = (() => { try { return localStorage.getItem(navblueKey); } catch { return null; } })();
  if (!navblueUrl) {
    cards.push({
      tone: 'primary',
      kicker: fr ? 'PROCHAIN VOL' : 'NEXT FLIGHT',
      title: fr ? 'Connecter Navblue' : 'Connect Navblue',
      sub: fr ? 'Synchro iCal pour voir vos prochains vols' : 'iCal sync to see your upcoming flights',
      chip: 'iCal',
      onclick: "showPage('backup');setTimeout(()=>showSettingsTab&&showSettingsTab('sync'),60);"
    });
  } else {
    // Navblue connected — show activity insight instead.
    const daysSinceLast = _dashDaysSinceLastFlight();
    const flightsThisWeek = _dashFlightsThisWeek();
    if (flightsThisWeek > 0) {
      cards.push({
        tone: 'primary',
        kicker: fr ? 'CETTE SEMAINE' : 'THIS WEEK',
        title: fr
          ? `${flightsThisWeek} vol${flightsThisWeek !== 1 ? 's' : ''} enregistré${flightsThisWeek !== 1 ? 's' : ''}`
          : `${flightsThisWeek} flight${flightsThisWeek !== 1 ? 's' : ''} logged`,
        sub: fr ? 'Continuez la cadence.' : 'Keep the rhythm.',
        chip: 'ACT'
      });
    } else if (daysSinceLast !== null && daysSinceLast > 0) {
      cards.push({
        tone: 'quiet',
        kicker: fr ? 'DERNIER VOL' : 'LAST FLIGHT',
        title: fr ? `Il y a ${daysSinceLast} jour${daysSinceLast !== 1 ? 's' : ''}` : `${daysSinceLast} day${daysSinceLast !== 1 ? 's' : ''} ago`,
        sub: fr ? 'Inscrire un nouveau vol →' : 'Log a new flight →',
        chip: 'LOG',
        onclick: "showPage('add');"
      });
    } else {
      cards.push({
        tone: 'primary',
        kicker: fr ? 'PROCHAIN VOL' : 'NEXT FLIGHT',
        title: fr ? 'Synchro Navblue active' : 'Navblue sync active',
        sub: fr ? 'Roster auto-sync configuré' : 'Auto-sync configured',
        chip: 'iCal',
        onclick: "showPage('backup');setTimeout(()=>showSettingsTab&&showSettingsTab('sync'),60);"
      });
    }
  }

  // ─── Card 2: STATUS — most concerning currency ────────────
  const medDays = _dashMedicalDaysRemaining();
  const ifrCount = _dashApproachesIn6mo();
  const ifrDays = _dashIFRDaysRemaining();
  const ldgCount = _dashLandingsIn6mo();
  // PPC only matters for 705 line pilots (multi-pilot ops under CASS 725.106).
  const statusProfile = (typeof DB !== 'undefined' && DB.loadProfile) ? DB.loadProfile() : {};
  const is705ForStatus = (statusProfile.pilotType || 'airline705') === 'airline705';
  const ppcDays = is705ForStatus ? _dashPPCDaysRemaining(statusProfile) : null;

  // Priority order: expired/imminent first, then soft warnings, then OK pill.
  // Each STATUS card routes to its matching drill-down (medical / ppc / ifr /
  // recency) so the pilot can see the source data behind the warning.
  if (medDays !== null && medDays <= 0) {
    cards.push({ tone: 'warning', kicker: fr ? 'EXPIRÉ' : 'EXPIRED',
      title: fr ? 'Médical Catégorie 1' : 'Cat 1 Medical',
      sub: fr ? 'Doit être renouvelé' : 'Must be renewed', chip: 'MED',
      onclick: "openDashDrill('medical')" });
  } else if (ppcDays !== null && ppcDays <= 0) {
    cards.push({ tone: 'warning', kicker: fr ? 'EXPIRÉ' : 'EXPIRED',
      title: fr ? 'PPC · expiré' : 'PPC · expired',
      sub: fr ? 'Doit être renouvelé · CASS 725.106' : 'Must be renewed · CASS 725.106',
      chip: 'PPC',
      onclick: "openDashDrill('ppc')" });
  } else if (medDays !== null && medDays <= 30) {
    cards.push({ tone: 'warning', kicker: fr ? 'EXPIRE BIENTÔT' : 'EXPIRES SOON',
      title: fr ? 'Médical Catégorie 1' : 'Cat 1 Medical',
      sub: fr ? `Dans ${medDays} jours` : `In ${medDays} days`, chip: 'MED',
      onclick: "openDashDrill('medical')" });
  } else if (ppcDays !== null && ppcDays <= 30) {
    cards.push({ tone: 'warning', kicker: fr ? 'EXPIRE BIENTÔT' : 'EXPIRES SOON',
      title: fr ? `PPC dans ${ppcDays} j` : `PPC in ${ppcDays} days`,
      sub: fr ? 'CASS 725.106 · multi-pilot 705' : 'CASS 725.106 · multi-pilot 705',
      chip: 'PPC',
      onclick: "openDashDrill('ppc')" });
  } else if (!is705ForStatus && ifrCount < 6) {
    // IFR 6-in-6mo only matters for non-705 pilots (no Company PPC to supersede)
    const need = 6 - ifrCount;
    cards.push({ tone: 'warning', kicker: fr ? 'À RENOUVELER' : 'TO RENEW',
      title: fr ? `Validité IFR · ${ifrCount}/6 appr.` : `IFR currency · ${ifrCount}/6 appr.`,
      sub: fr ? `${need} approche${need !== 1 ? 's' : ''} restante${need !== 1 ? 's' : ''} · CAR 401.05` : `${need} approach${need !== 1 ? 'es' : ''} to go · CAR 401.05`,
      chip: 'IFR',
      onclick: "openDashDrill('ifr')" });
  } else if (ldgCount < 5) {
    const need = 5 - ldgCount;
    cards.push({ tone: 'warning', kicker: fr ? 'À RENOUVELER' : 'TO RENEW',
      title: fr ? `Validité passagers · ${ldgCount}/5 att.` : `Passenger recency · ${ldgCount}/5 ldg`,
      sub: fr ? `${need} atterrissage${need !== 1 ? 's' : ''} restant${need !== 1 ? 's' : ''} · CAR 401.05(2)` : `${need} landing${need !== 1 ? 's' : ''} to go · CAR 401.05(2)`,
      chip: 'REC',
      onclick: "openDashDrill('recency')" });
  } else if (medDays !== null && medDays <= 60) {
    cards.push({ tone: 'primary', kicker: fr ? 'À SURVEILLER' : 'WATCH',
      title: fr ? 'Médical · 60 jours' : 'Medical · 60 days',
      sub: fr ? `Renouvellement dans ${medDays} jours` : `Renewal in ${medDays} days`, chip: 'MED',
      onclick: "openDashDrill('medical')" });
  } else if (ppcDays !== null && ppcDays <= 60) {
    cards.push({ tone: 'primary', kicker: fr ? 'À SURVEILLER' : 'WATCH',
      title: fr ? `PPC · ${ppcDays} j` : `PPC · ${ppcDays} days`,
      sub: fr ? 'Renouvellement à planifier · CASS 725.106' : 'Plan renewal · CASS 725.106',
      chip: 'PPC',
      onclick: "openDashDrill('ppc')" });
  } else if (!is705ForStatus && ifrDays !== null && ifrDays > 0 && ifrDays <= 30) {
    cards.push({ tone: 'primary', kicker: fr ? 'À SURVEILLER' : 'WATCH',
      title: fr ? 'Validité IFR · 30 jours' : 'IFR currency · 30 days',
      sub: fr ? `Approche-limite expire dans ${ifrDays} jours` : `Window expires in ${ifrDays} days`, chip: 'IFR',
      onclick: "openDashDrill('ifr')" });
  } else {
    // All-current OK pill → open the drill-down for the closest-to-expiring
    // validity. For 705 line pilots, PPC + MED are the primary checks; for
    // others, IFR + MED.
    let target = 'medical';
    let minDays = medDays !== null ? medDays : Infinity;
    if (is705ForStatus) {
      if (ppcDays !== null && ppcDays >= 0 && ppcDays < minDays) { target = 'ppc'; minDays = ppcDays; }
    } else {
      if (ifrDays !== null && ifrDays >= 0 && ifrDays < minDays) { target = 'ifr'; minDays = ifrDays; }
    }
    const okSub = is705ForStatus
      ? (fr ? 'PPC · REC · MED — vérifié à l\'instant' : 'PPC · REC · MED — just verified')
      : (fr ? 'IFR · REC · MED — vérifié à l\'instant' : 'IFR · REC · MED — just verified');
    // Green/success treatment when everything's current — encourages the
    // pilot at a glance. Pattern from health/fitness apps where "all good"
    // gets a positive visual rather than a muted neutral tone.
    cards.push({ tone: 'success', kicker: fr ? 'STATUT' : 'STATUS',
      title: fr ? 'Toutes validités à jour' : 'All validities current',
      sub: okSub, chip: 'OK',
      onclick: `openDashDrill('${target}')` });
  }

  // ─── Card 3: MILESTONE (always) ────────────────────────────
  // Typed goal aware: pilots care about SPECIFIC milestones (e.g.
  // "1500 hrs on E195-E2" for captain upgrade), not just total career.
  // When personalGoalKind === 'aircraft', the achieved counter sums
  // block hours from flights matching the aircraft type substring.
  // Otherwise falls back to the aggregate counter for the chosen kind.
  const sRaw = calcStats();
  const sMerged = (typeof totalsWithOpening === 'function') ? totalsWithOpening(sRaw) : sRaw;
  const totalHrs = +sMerged.total || +sMerged.block || 0;
  const profileForMilestone = (typeof DB !== 'undefined' && DB.loadProfile) ? DB.loadProfile() : {};
  const personalGoal    = +profileForMilestone.personalGoalHrs || 0;
  const personalKind    = profileForMilestone.personalGoalKind || 'total';
  const personalContext = profileForMilestone.personalGoalContext || '';
  const milestones = [50, 100, 250, 500, 750, 1000, 1500, 2500, 5000, 10000, 15000, 20000];

  // Achieved hours in the relevant category — drives progress against
  // a typed goal. For auto-mode, this is just totalHrs.
  const achievedInCategory = personalGoal > 0
    ? (typeof _dashGoalAchievedHours === 'function'
        ? _dashGoalAchievedHours(personalKind, personalContext, sMerged)
        : totalHrs)
    : totalHrs;

  let next, prev, label, achievedForBar;
  if (personalGoal > 0 && personalGoal > achievedInCategory) {
    // Typed personal goal active — track THIS counter, not total
    next = personalGoal;
    prev = milestones.filter(m => m <= achievedInCategory).pop() || 0;
    achievedForBar = achievedInCategory;
    // Build a category-aware sub-label
    const kindWord = (k, ctx) => {
      if (k === 'aircraft' && ctx) return fr ? `sur ${ctx}` : `on ${ctx}`;
      return ({
        'pic':   fr ? 'PIC'             : 'PIC',
        'sic':   fr ? 'SIC'             : 'SIC',
        'night': fr ? 'de nuit'         : 'night',
        'xc':    fr ? 'voyage'          : 'cross-country',
        'me':    fr ? 'multi-moteur'    : 'multi-engine',
        'total': fr ? 'total'           : 'total',
      }[k]) || '';
    };
    label = `${next.toLocaleString()} hrs ${kindWord(personalKind, personalContext)}`.trim();
  } else {
    next = milestones.find(m => totalHrs < m) || (milestones[milestones.length - 1] + 5000);
    prev = milestones.filter(m => m < next && m <= totalHrs).pop() || 0;
    achievedForBar = totalHrs;
    label = `${next.toLocaleString()} hrs`;
  }
  const remain = Math.max(0, next - achievedForBar);
  // Progress within the current segment (prev → next). Clamps to [0, 100].
  const segmentPct = next > prev
    ? Math.max(0, Math.min(100, ((achievedForBar - prev) / (next - prev)) * 100))
    : 0;

  cards.push({
    tone: 'quiet',
    kicker: fr ? 'JALON' : 'MILESTONE',
    title: label,
    sub: fr ? `Plus que ${remain.toFixed(1)} hrs · ${segmentPct.toFixed(0)}%` : `${remain.toFixed(1)} hrs to go · ${segmentPct.toFixed(0)}%`,
    chip: personalGoal > 0 ? (fr ? 'OBJECTIF' : 'GOAL') : ('' + next),
    onclick: "openDashDrill('milestone')",
    progress: {
      pct: segmentPct,
      prev: prev,
      next: next,
      isPersonalGoal: (personalGoal > 0),
    },
  });

  // Always display — cards.length is guaranteed ≥3 by the priority chain.
  el.style.display = '';
  el.innerHTML = cards.map(c => {
    // Optional progress bar — only when card.progress is supplied (Milestone).
    const progressBar = c.progress
      ? `<div class="dash-next-progress" aria-hidden="true">
           <div class="dash-next-progress-fill" style="width:${c.progress.pct.toFixed(1)}%;"></div>
         </div>
         <div class="dash-next-progress-labels mono">
           <span>${c.progress.prev.toLocaleString()}</span>
           <span>${c.progress.next.toLocaleString()}</span>
         </div>`
      : '';
    const personalAttr = c.progress && c.progress.isPersonalGoal ? ' data-personal-goal="true"' : '';
    return `
      <div class="dash-next-card" data-tone="${esc(c.tone)}"${personalAttr}${c.onclick ? ` onclick="${c.onclick}" style="cursor:pointer"` : ''}>
        <div class="dash-next-head">
          <div class="eyebrow dash-next-kicker">${esc(c.kicker)}</div>
          ${c.chip ? `<span class="dash-next-chip">${esc(c.chip)}</span>` : ''}
        </div>
        <div class="dash-next-title">${esc(c.title)}</div>
        <div class="dash-next-sub">${esc(c.sub)}</div>
        ${progressBar}
      </div>
    `;
  }).join('');
}

function _dashDaysSinceLastFlight() {
  if (!Array.isArray(flights) || flights.length === 0) return null;
  const last = flights
    .filter(f => f.date)
    .map(f => f.date)
    .sort((a, b) => b.localeCompare(a))[0];
  if (!last) return null;
  const lastDate = new Date(last + 'T00:00:00');
  return Math.max(0, Math.floor((Date.now() - lastDate) / 86400000));
}

function _dashFlightsThisWeek() {
  if (!Array.isArray(flights)) return 0;
  const now = new Date();
  const monday = new Date(now);
  const day = monday.getDay() || 7;
  monday.setDate(monday.getDate() - (day - 1));
  monday.setHours(0, 0, 0, 0);
  const cutoff = monday.toISOString().slice(0, 10);
  return flights.filter(f => f.date && f.date >= cutoff).length;
}

// ─── Stat strip cell helper ────────────────────────────────────
function _dashSetStripVal(id, val, unit) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = esc(String(val)) + (unit ? `<span class="dash-strip-unit">${esc(unit)}</span>` : '');
}

