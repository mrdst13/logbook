// ═══════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────
//  SHARED night/day totals — the SINGLE source of truth for how many
//  night (and day) hours a flight contributes, across EVERY aircraft
//  class (multi-engine + helicopter + single-engine) and EVERY role
//  (PIC / dual / SIC). Before this existed, calcStats, the Recap, the
//  certifiable PDF/logbook column, the drill-down and the opening
//  balances each summed a DIFFERENT subset — so a helicopter or student
//  pilot saw 0h of night on one screen and real hours on another.
//  (Audit panel 2026-06-25, must-fix #1.) Use these everywhere.
// ─────────────────────────────────────────────────────────────────
function nightHoursOf(f) {
  return (+f.meNightPic||0) + (+f.meNightDual||0) + (+f.meNightCop||0)
       + (+f.heliNightPic||0) + (+f.heliNightDual||0) + (+f.heliNightCop||0)
       + (+f.seNight||0) + (+f.seNightDual||0);
}
function dayHoursOf(f) {
  return (+f.meDayPic||0) + (+f.meDayDual||0) + (+f.meDayCop||0)
       + (+f.heliDayPic||0) + (+f.heliDayDual||0) + (+f.heliDayCop||0)
       + (+f.seDay||0) + (+f.seDayDual||0);
}

// SINGLE definition of the recency window. The regulation (CAR 401.05(2)) is
// 6 CALENDAR months, not a fixed 180 days. Some screens used 180*86400000 and
// others setMonth(-6), so the dashboard, drill-down and PDF could disagree on
// the same day about whether a pilot was current. (Audit panel 2026-06-25.)
function sixMonthCutoffStr() {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
}

// CAR 401.05(2)(b): the take-offs and landings for passenger recency may be
// done "in the same category and class of aircraft ... or in a Level B, C or D
// full-flight simulator of the same category and class as the aircraft."
// So a full-flight simulator (FFS) DOES count; a basic device (FTD / FNPT /
// BITD) does NOT. The sim form captures simType — only the FFS levels qualify.
// (Verified against laws-lois.justice.gc.ca SOR-96-433 s.401.05, 2026-06-25.)
const RECENCY_FFS_TYPES = new Set(['FFS', 'FFS-C']);
function countsTowardRecency(f) {
  return !f.isSim || RECENCY_FFS_TYPES.has(f.simType);
}

// ─────────────────────────────────────────────────────────────────
//  flightTimeOf — the ONE definition of a flight's flight time.
//  Flight time == block-to-block in Canada (CAR/RAC 101.01). `total` is the
//  editable flight-time field; `block` is the legacy/import field. They are
//  normally the same number (the form + imports fill total from block), and
//  differ only if the pilot manually edited total — in which case total (the
//  pilot's explicit entry) wins, with block as the fallback when total is
//  empty. Every career/monthly flight-time sum reads through this helper so
//  the hero, its drill-down, the monthly charts, the logbook footer and the
//  PDF can never disagree (audit item 11: they used to — total-first here,
//  block-first there — showing four different career numbers).
// ─────────────────────────────────────────────────────────────────
function flightTimeOf(f) {
  return +f.total || +f.block || 0;
}

// ─────────────────────────────────────────────────────────────────
//  Import merge — one place, TWO deliberate fill-empty policies.
//  Every import path (photo OCR, iCal roster, CSV) enriches an existing
//  matched flight by filling ONLY its blanks, never overwriting a value the
//  pilot already has. The two policies used to be duplicated across three
//  files with drifting field lists; they now live here (audit item 12):
//   • fillEmptyStrict — a slot is empty only when undefined/null/''. An
//     explicit 0 the pilot recorded is a REAL value and is kept (e.g.
//     multiCrew=0 must not be clobbered to the iCal default of 1).
//   • fillEmptyNumeric — for hour buckets, 0 means "not logged", so a
//     positive incoming value fills a 0-or-empty slot.
//  Both mutate `existing` in place and return whether anything changed.
// ─────────────────────────────────────────────────────────────────
const IMPORT_MERGE_FIELDS = ['dtstart_utc','atd_utc','ata_utc','co_utc','ci_utc',
  'dep_icao','arr_icao','reg','type','flightNum','multiCrew',
  'pic','copilot','crewPosition'];

function fillEmptyStrict(existing, incoming, keys) {
  let changed = false;
  keys.forEach(k => {
    const empty = existing[k] === undefined || existing[k] === null || existing[k] === '';
    const present = incoming[k] !== undefined && incoming[k] !== null && incoming[k] !== '';
    if (empty && present) { existing[k] = incoming[k]; changed = true; }
  });
  return changed;
}

function fillEmptyNumeric(existing, incoming, keys) {
  let changed = false;
  keys.forEach(k => {
    if ((+existing[k] || 0) === 0 && (+incoming[k] || 0) > 0) { existing[k] = incoming[k]; changed = true; }
  });
  return changed;
}

function calcStats() {
  let total=0, pic=0, sic=0, night=0, ldg=0, me=0, xc=0, block=0, block30=0;
  let heli=0, hover=0, dualGiven=0, picus=0, dualRcvd=0;
  const now = new Date();
  const cutoff30 = new Date(now); cutoff30.setDate(cutoff30.getDate() - 30);
  flights.forEach(f => {
    total += flightTimeOf(f);
    // PIC includes single-engine time (seDay/seNight): per Transport Canada,
    // PIC is PIC regardless of engine count. The app has a single SE bucket
    // (no SE PIC/dual split), so SE time is treated as PIC per the app's model.
    pic += (+f.meDayPic||0) + (+f.meNightPic||0) + (+f.heliDayPic||0) + (+f.heliNightPic||0)
         + (+f.seDay||0) + (+f.seNight||0);
    sic += (+f.meDayCop||0) + (+f.meNightCop||0) + (+f.heliDayCop||0) + (+f.heliNightCop||0);
    // Night = all night flying, every aircraft class/role — shared helper.
    night += nightHoursOf(f);
    // Career landing total = aircraft landings only. Sim landings are recorded
    // for recency (CAR 401.05(2)(b)) but are not real-aircraft landings.
    if (!f.isSim) ldg += (+f.ldgDay||0) + (+f.ldgNight||0);
    me += (+f.meDayPic||0)+(+f.meDayDual||0)+(+f.meDayCop||0)+(+f.meNightPic||0)+(+f.meNightDual||0)+(+f.meNightCop||0);
    heli += (+f.heliDayPic||0)+(+f.heliDayDual||0)+(+f.heliDayCop||0)
          + (+f.heliNightPic||0)+(+f.heliNightDual||0)+(+f.heliNightCop||0);
    hover += +f.hoverTime || 0;
    dualGiven += (+f.dualGivenDay||0) + (+f.dualGivenNight||0);
    // Dual RECEIVED (student's own instruction) — every *Dual bucket. Surfaced
    // so students/PPL see their hours (their PIC total is ~0 early on).
    dualRcvd += (+f.seDayDual||0) + (+f.seNightDual||0)
              + (+f.meDayDual||0) + (+f.meNightDual||0)
              + (+f.heliDayDual||0) + (+f.heliNightDual||0);
    // PICUS (PIC under supervision) — its own ATPL-creditable total. Collected
    // and stored but previously never summed, so it vanished from career
    // figures. Kept SEPARATE from PIC, never folded in. (Opus audit.)
    picus += +f.picus || 0;
    xc += (+f.xcDayPic||0)+(+f.xcDayDual||0)+(+f.xcNightPic||0)+(+f.xcNightDual||0)
        + (+f.xcDayCop||0)+(+f.xcNightCop||0);
    block += +f.block || 0;
    if (f.date && new Date(f.date) >= cutoff30) block30 += +f.block || 0;
  });
  return {total,pic,sic,night,ldg,me,heli,hover,dualGiven,dualRcvd,picus,xc,block,block30,entries:flights.length};
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
function recalculateFlightDayNightXC(f, opts = {}) {
  // opts.skipLandingFill — set by every IMPORT path (PDF/CSV roster + the
  // bulk "Recalculate" button). A roster can't know whether a multi-crew F/O
  // actually performed the landing (PF/PM alternate), so auto-crediting one
  // landing per flight would fabricate passenger-currency data. Only a
  // manually-entered single flight keeps the 1-landing convenience.
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

  // Engine-class family + role come from the pilot profile + existing data —
  // NEVER a blind "multi-engine SIC" default, which fabricated engine class and
  // seat for single-engine and helicopter pilots. (Opus audit C2.)
  const _prof = (typeof DB !== 'undefined' && DB.loadProfile) ? (DB.loadProfile() || {}) : {};
  const _pilotType = _prof.pilotType || 'airline705';
  const _rank = (_prof.rank || '').toLowerCase();
  const _sum = (...ks) => ks.reduce((s, k) => s + (+f[k] || 0), 0);
  // Family: helicopter profile -> heli; airline705 -> me; else infer from any
  // existing typed values; otherwise unknown -> do NOT auto-fill the split.
  let family = null;
  if (_pilotType === 'helicopter') family = 'heli';
  else if (_pilotType === 'airline705') family = 'me';
  else if (_sum('meDayPic','meNightPic','meDayCop','meNightCop','meDayDual','meNightDual') > 0) family = 'me';
  else if (_sum('heliDayPic','heliNightPic','heliDayCop','heliNightCop','heliDayDual','heliNightDual') > 0) family = 'heli';
  // Single-engine family (private / student / instructor, or any flight that
  // already has SE time typed). Without this, auto day/night/XC never ran for
  // the PPL/bush clientele even on a known airport. (Audit panel 2026-06-25.)
  else if (_sum('seDay','seNight','seDayDual','seNightDual') > 0) family = 'se';
  else if (_pilotType === 'private' || _pilotType === 'student' || _pilotType === 'instructor') family = 'se';
  // Role: existing typed values first, then profile rank; never blind-default.
  let role = null;
  if (family === 'me') {
    if (_sum('meDayPic','meNightPic') > 0) role = 'pic';
    else if (_sum('meDayDual','meNightDual') > 0) role = 'dual';
  } else if (family === 'heli') {
    if (_sum('heliDayPic','heliNightPic') > 0) role = 'pic';
    else if (_sum('heliDayDual','heliNightDual') > 0) role = 'dual';
  } else if (family === 'se') {
    if (_sum('seDay','seNight') > 0) role = 'pic';
    else if (_sum('seDayDual','seNightDual') > 0) role = 'dual';
  }
  if (!role) {
    if (/(cpt|capt|cdb|\bpic\b|command)/.test(_rank)) role = 'pic';
    else if (/(f\/o|\bfo\b|sic|copil|first)/.test(_rank)) role = 'cop';
    else if (_pilotType === 'student') role = 'dual';
    else if (_pilotType === 'airline705') role = 'cop';
    else if (_pilotType === 'private' || _pilotType === 'instructor') role = 'pic';
  }

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

  // Only auto-fill the class-specific day/night + XC split when BOTH the engine
  // family and the role are known. If either is unknown (e.g. an engine-
  // ambiguous private/student flight), fill nothing here — empty > guessed.
  if (family && role) {
    let dayK, nightK, xcDayK, xcNightK;
    if (family === 'se') {
      // Single-engine has no SIC seat: PIC -> seDay/seNight, dual -> seDayDual/
      // seNightDual. XC reuses the shared role-based xc buckets.
      const isDual = role === 'dual';
      dayK   = isDual ? 'seDayDual'   : 'seDay';
      nightK = isDual ? 'seNightDual' : 'seNight';
      xcDayK   = isDual ? 'xcDayDual'   : 'xcDayPic';
      xcNightK = isDual ? 'xcNightDual' : 'xcNightPic';
    } else {
      const pre = family; // 'me' or 'heli' bucket prefix
      const cap = role === 'pic' ? 'Pic' : role === 'dual' ? 'Dual' : 'Cop';
      dayK = pre + 'Day' + cap; nightK = pre + 'Night' + cap;
      xcDayK = 'xcDay' + cap; xcNightK = 'xcNight' + cap;
    }
    if (_isEmpty(f[dayK]))     { out[dayK]     = split.dayHours;              touched = true; }
    if (_isEmpty(f[nightK]))   { out[nightK]   = split.nightHours;            touched = true; }
    if (_isEmpty(f[xcDayK]))   { out[xcDayK]   = isXC ? split.dayHours   : 0; touched = true; }
    if (_isEmpty(f[xcNightK])) { out[xcNightK] = isXC ? split.nightHours : 0; touched = true; }
  }

  // Landing day/night based on arrival — only-fill-empty, and NEVER on an
  // import path (opts.skipLandingFill). Crediting a landing the pilot may not
  // have performed inflates passenger recency (CAR 401.05(2)); imports leave
  // landings empty for the pilot to confirm. Empty > guessed.
  if (!opts.skipLandingFill && _isEmpty(f.ldgDay) && _isEmpty(f.ldgNight)) {
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
    // Deep-copy the live array — never store by reference, or later in-place
    // mutations (recalc, Object.assign, merge) would silently corrupt the
    // "before" state and defeat the undo guarantee. (Opus audit C5.)
    flights: JSON.parse(JSON.stringify(flights)),
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

  // Push current state as new snapshot (so user can undo this undo) — deep copy.
  const currentSnap = {
    flights: JSON.parse(JSON.stringify(flights)),
    timestamp: Date.now(),
    operation: `before undo of "${snap.operation}"`,
    flightCount: flights.length
  };
  // Remove the snapshot we're restoring from history, add current as new
  history.splice(index, 1);
  history.unshift(currentSnap);
  saveSnapshots(history);

  // Deep-copy on restore too, so the live array is never aliased to the
  // snapshot object (otherwise later edits would mutate history). (Opus C5.)
  flights = JSON.parse(JSON.stringify(snap.flights));
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
  const normRoute = r => (r || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normFn    = n => (n || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Tier 1 — exact: date + flightNum + route. Block is deliberately NOT in the
  // key, so a re-import with a corrected/actual block still matches when these
  // three agree.
  const exactKey = `${incoming.date}|${incoming.flightNum}|${incoming.route}`;
  const exact = flights.findIndex(f =>
    `${f.date}|${f.flightNum || ''}|${f.route || ''}` === exactKey
  );
  if (exact >= 0) return { idx: exact, matchType: 'exact' };

  // Tier 2 — same DATE + FLIGHT NUMBER. A roster flight number is unique per day
  // for an operator, so this is the SAME leg even when the block differs
  // (scheduled block in the existing row vs actual block in the PDF) or the
  // route is written differently (IATA "YOW-YYZ" vs ICAO "CYOW-CYYZ"). This is
  // what stops duplicates when re-importing a Navblue PDF that overlaps flights
  // already logged. Only applies when the incoming flight actually has a number.
  const incFn = normFn(incoming.flightNum);
  if (incFn) {
    const byFn = flights.findIndex(f => f.date === incoming.date && normFn(f.flightNum) === incFn);
    if (byFn >= 0) return { idx: byFn, matchType: 'date-flightnum' };
  }

  // Tier 3 — same DATE + ROUTE with a close block (±0.15h = 9 min). Route-anchored
  // so two DIFFERENT legs the same day never collide. Catches same-leg re-imports
  // that carry no flight number.
  const incRouteNorm = normRoute(incoming.route);
  const incBlock = +incoming.block || 0;
  if (incRouteNorm) {
    for (let i = 0; i < flights.length; i++) {
      const f = flights[i];
      if (f.date !== incoming.date) continue;
      if (normRoute(f.route) !== incRouteNorm) continue;
      const fBlock = +f.block || 0;
      if (Math.abs(fBlock - incBlock) > 0.15) continue;
      return { idx: i, matchType: 'fuzzy' };
    }
  }

  // Tier 4 — same DATE + block close, no route to compare (legacy rows missing
  // both flight number and route). Requires BOTH blocks to be > 0 so two
  // distinct same-day flights that simply lack block data are never merged.
  if (incBlock > 0) {
    for (let i = 0; i < flights.length; i++) {
      const f = flights[i];
      if (f.date !== incoming.date) continue;
      const fBlock = +f.block || 0;
      if (fBlock > 0 && Math.abs(fBlock - incBlock) <= 0.15) {
        return { idx: i, matchType: 'date-block' };
      }
    }
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
    // Bulk recalc backfills Night/XC on many flights at once — it cannot know
    // real landing counts, so it never fabricates them (skipLandingFill).
    const recalc = recalculateFlightDayNightXC(f, { skipLandingFill: true });
    if (recalc !== f) updated++;
    return recalc;
  });
  return { updated, skippedNoUTC, skippedNoCoords, skippedNoBlock };
}

function fmt(n) { return (+n).toFixed(1); }

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

  // Brought-forward banner — three states (attested seal with hidden integrity
  // fingerprint / unsigned draft / brand-new invitation). See 20-opening-balances.js.
  if (typeof _dashRenderBfBanner === 'function') _dashRenderBfBanner(hasFlights);

  // (3) Greeting bar — time-aware salutation + activity sub
  _dashRenderGreeting();

  // (4a) Hero card: 88px career number + sparkline + delta pill
  const heroNumEl = document.getElementById('dashHeroNum');
  // Prefer flight time (`total`) over `block`; in Canada they are the same
  // number (CAR/RAC 101.01 flight time = block-to-block), and pilots fill
  // `total` far more often than the per-flight `block` field. Reading `block`
  // first made the career number read low / "not move" when only total was
  // filled (Martin 2026-07-01). Matches the duty tracker + brought-forward
  // preview, so all surfaces agree.
  if (heroNumEl) heroNumEl.textContent = fmt(s.total || s.block);
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
  _dashSetStripVal('dashStripHELI',  fmt(s.heli),     'hrs');
  _dashSetStripVal('dashStripDUAL',  fmt(s.dualRcvd), 'hrs');

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

  // HELI: show for helicopter pilots or anyone with logged heli time — without
  // it a helicopter pilot saw none of their primary hours. DUAL (dual received):
  // show for students/instructors or anyone with dual time, so an early-career
  // pilot whose PIC is ~0 still sees their real hours. (Audit panel 2026-06-25.)
  const heliTotal = (stats && +stats.heli) || 0;
  const dualTotal = (stats && +stats.dualRcvd) || 0;
  const showHELI = (pilotType === 'helicopter') || heliTotal > 0;
  const showDUAL = (pilotType === 'student') || (pilotType === 'instructor') || dualTotal > 0;
  setStripItemVisible('dashStripHELI', showHELI);
  setStripItemVisible('dashStripDUAL', showDUAL);
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
function _dashRenderValidityRings() { return _dashRenderValidities(); }

// Tiny hex→rgba helper for the ghost (track) ring colour.
function _dashHexA(h, a) {
  const n = parseInt(h.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

// ─── Validités — adaptive status cards (redesign 2026-06-25) ────────────────
// Replaces the old fixed PPC/REC/MED rings. Each validity is an autonomous
// card: a STATUS-colour ring (green current / amber due-soon / red expired /
// dashed grey not-set), the ring fill = time remaining (fuller = further from
// renewal), then the metric name, a status WORD and a human, localised date.
// NO regulatory codes on the dashboard surface — those stay in the drill-down.
// The expiry/currency maths come from the already-verified helpers; the only
// new constants are the ADVISORY due-soon warning windows (60 d / 90 d), which
// are display preferences, not Transport Canada limits.
//
// The SET of validities adapts to the pilot type:
//   airline 705  → PPC, Medical            (PPC supersedes the IFR window;
//                                            passenger recency is always met)
//   everyone else → Recent experience, Medical (+ IFR if they fly instruments)
// A trailing "+ Add" card lets a pilot track operator / personal validities.
function _dashRenderValidities() {
  const grid = document.getElementById('dashValiditiesGrid');
  if (!grid) return;
  const fr = ((typeof getLang === 'function') ? getLang() : 'en') === 'fr';
  const profile = (typeof DB !== 'undefined' && DB.loadProfile) ? (DB.loadProfile() || {}) : {};
  const pilotType = profile.pilotType || 'airline705';
  const is705 = pilotType === 'airline705';
  // First-launch guard: with zero flights logged we cannot assess count-based
  // currency (recent experience / IFR), so show "not set" (dashed grey) — never
  // a red "Expired" on a brand-new logbook. (Validity-review fix.)
  const hasFlights = Array.isArray(flights) && flights.length > 0;

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  // Advisory display status from days-remaining (NOT a regulatory definition).
  const dateStatus = (days, soonDays) => {
    if (days === null || days === undefined) return 'notset';
    if (days <= 0) return 'expired';
    if (days <= soonDays) return 'soon';
    return 'current';
  };

  const items = [];
  if (is705) {
    const ppc = _dashPPCDaysRemaining(profile);
    items.push({ drill: 'ppc', edit: 'ppc', label: 'PPC', status: dateStatus(ppc, 60), days: ppc, window: 365, sub: fmtDate(profile.ppcDueDate) });
  } else {
    const recTO = _dashTakeoffsIn6mo();
    const recLdg = _dashLandingsIn6mo();
    const rec = Math.min(recTO, recLdg);
    items.push({
      drill: 'recency',
      label: fr ? 'Expérience récente' : 'Recent experience',
      // 5 take-offs AND 5 landings within 6 months are required to be current
      // (CAR 401.05(2)); 1-4 is NOT current — show it as such, never "due soon".
      status: !hasFlights ? 'notset' : (rec >= 5 ? 'current' : 'expired'),
      fill: Math.min(1, rec / 5),
      sub: fr ? (recTO + ' décol. · ' + recLdg + ' atterr.') : (recTO + ' T/O · ' + recLdg + ' ldg')
    });
    if (typeof needsIFRTracking === 'function' && needsIFRTracking(profile)) {
      const ifr = _dashIFRCurrency();
      items.push({
        drill: 'ifr', label: 'IFR',
        status: !hasFlights ? 'notset' : (ifr.current ? 'current' : 'expired'),
        fill: ifr.pct / 100,
        sub: ifr.approaches + ' / 6 appr.'
      });
    }
  }
  const med = _dashMedicalDaysRemaining();
  items.push({ drill: 'medical', edit: 'medical', label: fr ? 'Médical' : 'Medical', status: dateStatus(med, 90), days: med, window: 365, sub: fmtDate(profile.medical) });

  // Pilot-defined validities (date-based, editable). Stored on the profile so
  // they persist locally; each is edited in place via editValidity('custom:id').
  const _customVals = (typeof getCustomValidities === 'function')
    ? getCustomValidities()
    : (Array.isArray(profile.customValidities) ? profile.customValidities : []);
  _customVals.forEach(v => {
    if (!v || !v.id) return;
    const cd = v.date ? new Date(v.date + 'T12:00:00') : null;
    const cDays = (cd && !isNaN(cd.getTime())) ? Math.ceil((cd.getTime() - Date.now()) / 86400000) : null;
    items.push({
      edit: 'custom:' + v.id,
      label: v.name || (fr ? 'Validité' : 'Validity'),
      status: dateStatus(cDays, 60), days: cDays, window: 365, sub: fmtDate(v.date)
    });
  });

  const COLOR = { current: '#0EA371', soon: '#E8920F', expired: '#E24B4A', notset: '#CBD0DA' };
  const WORD = {
    current: fr ? 'À jour' : 'Current',
    soon: fr ? 'Bientôt dû' : 'Due soon',
    expired: fr ? 'Expiré' : 'Expired',
    notset: fr ? 'Non renseigné' : 'Not set'
  };

  const ringSvg = (status, fillFrac) => {
    const size = 64, sw = 6, r = (size - sw) / 2, c = 2 * Math.PI * r, cx = size / 2;
    if (status === 'notset') {
      return '<svg viewBox="0 0 ' + size + ' ' + size + '"><circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="#CBD0DA" stroke-width="' + sw + '" stroke-dasharray="5 6"/></svg>';
    }
    const col = COLOR[status];
    const f = Math.max(0, Math.min(1, fillFrac == null ? 1 : fillFrac));
    const off = (c * (1 - f)).toFixed(2);
    const ghost = (status === 'expired') ? 'rgba(226,75,74,.20)' : _dashHexA(col, 0.16);
    const prog = (status === 'expired') ? '' :
      '<circle class="dash-ring-progress" cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off + '" transform="rotate(-90 ' + cx + ' ' + cx + ')"/>';
    return '<svg viewBox="0 0 ' + size + ' ' + size + '"><circle class="dash-ring-track" cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="' + ghost + '" stroke-width="' + sw + '"/>' + prog + '</svg>';
  };

  const fillOf = (it) => (it.fill != null) ? it.fill : ((it.days == null || !it.window) ? 1 : Math.max(0, Math.min(1, it.days / it.window)));

  let html = items.map((it) => {
    const kd = esc(it.drill || '');
    // Date-based validities (PPC / Medical / custom) open the in-place date
    // editor; count-based ones (recency / IFR) open the info drill-down.
    const action = it.edit ? ("editValidity('" + it.edit + "')") : ("openDashDrill('" + kd + "')");
    return '' +
      '<div class="dash-val dash-clickable" onclick="' + action + '" role="button" tabindex="0" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + action + ';}">' +
        '<div class="dash-val-ring">' + ringSvg(it.status, fillOf(it)) + '</div>' +
        '<div class="dash-val-name">' + esc(it.label) + '</div>' +
        '<div class="dash-val-status dash-val-' + it.status + '"><span class="dash-val-dot"></span>' + esc(WORD[it.status]) + '</div>' +
        '<div class="dash-val-sub">' + esc(it.sub || '') + '</div>' +
      '</div>';
  }).join('');

  html += '' +
    '<div class="dash-val dash-val-add" onclick="dashAddValidity()" role="button" tabindex="0" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();dashAddValidity();}">' +
      '<div class="dash-val-add-plus">+</div>' +
      '<div class="dash-val-add-txt">' + esc(fr ? 'Ajouter une validité' : 'Add a validity') + '</div>' +
    '</div>';

  grid.innerHTML = html;

  const personaEl = document.getElementById('dashValPersona');
  if (personaEl) {
    const LBL = {
      airline705: fr ? 'Pilote de ligne' : 'Airline pilot',
      helicopter: fr ? 'Hélicoptère' : 'Helicopter',
      instructor: fr ? 'Instructeur' : 'Instructor',
      student: fr ? 'Élève-pilote' : 'Student',
      private: fr ? 'Pilote privé' : 'Private pilot'
    };
    personaEl.textContent = (fr ? 'Profil · ' : 'Profile · ') + (LBL[pilotType] || (fr ? 'Pilote' : 'Pilot'));
  }
}

// "+ Add a validity" card → Settings → Profile, with the validity-date fields
// (Medical / PPC) brought into view and focused. This is the SAME handler on
// desktop and mobile: the old onclick was showPage('backup'), which dropped the
// user on whichever Settings tab was last active (usually Sync) — a dead end with
// no validity UI. We route through showPage('profile') (the router's back-compat
// redirect lands on Settings → Profile tab), then scroll to the first applicable
// validity date so the pilot arrives exactly where these are set, not at the top
// of a long profile form. (Bug reported by Martin 2026-06-26 — web + mobile.)
function dashAddValidity() {
  // New behaviour (2026-07-01): open the picker of things to track, then let the
  // pilot set a date — instead of dumping them in the Settings profile form.
  if (typeof openValidityPicker === 'function') return openValidityPicker();
  // Fallback if the validities module isn't loaded: old Settings → Profile route.
  if (typeof showPage === 'function') showPage('profile');
}

function _dashApproachesIn6mo() {
  if (!Array.isArray(flights)) return 0;
  const cutoff = sixMonthCutoffStr();
  // CAR 401.05(3.1): the six approaches must be flown in an aircraft (actual or
  // simulated IMC) or a Level B, C or D full-flight simulator — a basic training
  // device (FTD/FNPT/BITD) does NOT qualify, exactly like landings/take-offs.
  // Filter by countsTowardRecency so a basic-sim approach never inflates IFR
  // currency. Verified laws-lois SOR-96-433 s.401.05(3.1); see registre.
  return flights.filter(f => f.date >= cutoff && countsTowardRecency(f))
    .reduce((sum, f) => sum + (+f.approaches || 0), 0);
}

// Instrument time in the last 6 months. CAR 101.01: "instrument time means
// (a) instrument ground time, (b) actual instrument flight time, or
// (c) simulated instrument flight time" — so simulator time DOES count. We sum
// instActual (actual IFT) + instHood (simulated IFT) + instSim (ground/sim).
// Verified laws-lois SOR-96-433 s.101.01, 2026-06-25. See registre.
function _dashInstrumentTimeIn6mo() {
  if (!Array.isArray(flights)) return 0;
  const cutoff = sixMonthCutoffStr();
  return flights.filter(f => f.date >= cutoff)
    .reduce((sum, f) => sum + (+f.instActual || 0) + (+f.instHood || 0) + (+f.instSim || 0), 0);
}

// IFR recency (CAR 401.05(3.1)): within 6 months, the holder must have BOTH
// (a) six hours of instrument time AND (b) six instrument approaches. Returns
// both counts, the limiting progress ratio, and whether the pilot is current.
function _dashIFRCurrency() {
  const approaches = _dashApproachesIn6mo();
  const hours = _dashInstrumentTimeIn6mo();
  const ratio = Math.min(approaches / 6, hours / 6);
  return {
    approaches,
    hours,
    current: approaches >= 6 && hours >= 6,
    pct: Math.min(100, ratio * 100),
    // The binding constraint, for a compact "X / 6" sub-label.
    limiting: (hours / 6 < approaches / 6) ? 'hours' : 'approaches',
  };
}

function _dashLandingsIn6mo() {
  if (!Array.isArray(flights)) return 0;
  const cutoff = sixMonthCutoffStr();
  // Aircraft landings + qualifying full-flight-sim landings count (CAR
  // 401.05(2)(b)); a basic training device does not. See countsTowardRecency.
  return flights.filter(f => f.date >= cutoff && countsTowardRecency(f))
    .reduce((sum, f) => sum + (+f.ldgDay || 0) + (+f.ldgNight || 0), 0);
}

// Take-offs in the last 6 months for CAR 401.05(2) recent experience.
// Use recorded take-offs (toDay+toNight) when the pilot entered them; a
// training flight can have many circuits (e.g. 8 landings = 8 take-offs),
// which the old leg-count (1 per flight) under-counted — making the app tell
// a current pilot they were NOT current. When no T/O is recorded, a real
// flight has at least as many take-offs as landings (and at least 1), so we
// never report fewer take-offs than landings. A basic training device is
// excluded; a Level B/C/D full-flight simulator counts (CAR 401.05(2)(b)) —
// see countsTowardRecency. (Audit panel 2026-06-25 must-fix #2.)
function _dashTakeoffsIn6mo() {
  if (!Array.isArray(flights)) return 0;
  const cutoff = sixMonthCutoffStr();
  return flights.filter(f => f.date >= cutoff && countsTowardRecency(f))
    .reduce((sum, f) => {
      const to  = (+f.toDay || 0) + (+f.toNight || 0);
      // Sim (a qualifying FFS, already filtered): count ONLY the take-offs the
      // pilot explicitly entered — never assume a number for a sim session.
      if (f.isSim) return sum + to;
      const ldg = (+f.ldgDay || 0) + (+f.ldgNight || 0);
      return sum + (to > 0 ? to : Math.max(1, ldg));
    }, 0);
}

// Days until the 6th most recent approach drops out of the 6-calendar-month
// window. If < 6 approaches in window, returns 0 (already not current).
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
  expiry.setMonth(expiry.getMonth() + 6);
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
      <span class="dash-leg-hours">${fmt(flightTimeOf(f))}</span>
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
      title: fr ? 'Connecter la synchro' : 'Connect roster sync',
      sub: fr ? 'Synchro iCal pour voir vos prochains vols' : 'iCal sync to see your upcoming flights',
      chip: 'iCal',
      onclick: "showPage('backup');setTimeout(()=>showSettingsTab&&showSettingsTab('sync'),60);"
    });
  } else {
    // Navblue connected — show activity insight instead.
    const daysSinceLast = _dashDaysSinceLastFlight();
    const flightsThisWeek = _dashFlightsThisWeek();
    const hoursThisWeek = _dashHoursThisWeek();
    if (flightsThisWeek > 0) {
      cards.push({
        tone: 'primary',
        kicker: fr ? 'CETTE SEMAINE' : 'THIS WEEK',
        title: fr
          ? `${flightsThisWeek} vol${flightsThisWeek !== 1 ? 's' : ''} enregistré${flightsThisWeek !== 1 ? 's' : ''}`
          : `${flightsThisWeek} flight${flightsThisWeek !== 1 ? 's' : ''} logged`,
        sub: (function(s){ return fr ? (s.replace('.', ',') + ' h cette semaine') : (s + ' h this week'); })((typeof fmt === 'function') ? fmt(hoursThisWeek) : (Math.round(hoursThisWeek * 10) / 10).toFixed(1)),
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
        title: fr ? 'Synchro horaire active' : 'Roster sync active',
        sub: fr ? 'Roster auto-sync configuré' : 'Auto-sync configured',
        chip: 'iCal',
        onclick: "showPage('backup');setTimeout(()=>showSettingsTab&&showSettingsTab('sync'),60);"
      });
    }
  }

  // ─── Card 2: STATUS — most concerning currency ────────────
  const medDays = _dashMedicalDaysRemaining();
  const ifr = _dashIFRCurrency();         // {approaches, hours, current} — CAR 401.05(3.1)
  const ifrCount = ifr.approaches;
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
  } else if (!is705ForStatus && !ifr.current) {
    // IFR recency only matters for non-705 pilots (no Company PPC to supersede).
    // CAR 401.05(3.1) needs BOTH 6 approaches AND 6 h instrument time — surface
    // whichever is short.
    const needAppr = Math.max(0, 6 - ifr.approaches);
    const needHrs = Math.max(0, 6 - ifr.hours);
    const subFr = needAppr > 0 && needHrs > 0
      ? `${needAppr} appr. + ${needHrs.toFixed(1)} h à faire · RAC 401.05(3.1)`
      : needAppr > 0
        ? `${needAppr} approche${needAppr !== 1 ? 's' : ''} restante${needAppr !== 1 ? 's' : ''} · RAC 401.05(3.1)`
        : `${needHrs.toFixed(1)} h instrument à faire · RAC 401.05(3.1)`;
    const subEn = needAppr > 0 && needHrs > 0
      ? `${needAppr} appr + ${needHrs.toFixed(1)} h to go · CAR 401.05(3.1)`
      : needAppr > 0
        ? `${needAppr} approach${needAppr !== 1 ? 'es' : ''} to go · CAR 401.05(3.1)`
        : `${needHrs.toFixed(1)} h instrument to go · CAR 401.05(3.1)`;
    cards.push({ tone: 'warning', kicker: fr ? 'À RENOUVELER' : 'TO RENEW',
      title: fr ? `Validité IFR · ${ifr.approaches}/6 appr · ${ifr.hours.toFixed(1)}/6 h` : `IFR currency · ${ifr.approaches}/6 appr · ${ifr.hours.toFixed(1)}/6 h`,
      sub: fr ? subFr : subEn,
      chip: 'IFR',
      onclick: "openDashDrill('ifr')" });
  } else if (ldgCount < 5) {
    const need = 5 - ldgCount;
    cards.push({ tone: 'warning', kicker: fr ? 'À RENOUVELER' : 'TO RENEW',
      title: fr ? `Validité passagers · ${ldgCount}/5 att.` : `Passenger recency · ${ldgCount}/5 ldg`,
      sub: fr ? `${need} atterrissage${need !== 1 ? 's' : ''} restant${need !== 1 ? 's' : ''} · RAC 401.05(2)` : `${need} landing${need !== 1 ? 's' : ''} to go · CAR 401.05(2)`,
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
        'xc':    fr ? 'vol-voyage'      : 'cross-country',
        'me':    fr ? 'multimoteur'     : 'multi-engine',
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

// Block hours flown this week (same Monday-start window as _dashFlightsThisWeek).
// Sums the per-flight block time (falls back to total) — the same field the
// recent-legs list shows — so the "This week" card states a real figure, never a slogan.
function _dashHoursThisWeek() {
  if (!Array.isArray(flights)) return 0;
  const now = new Date();
  const monday = new Date(now);
  const day = monday.getDay() || 7;
  monday.setDate(monday.getDate() - (day - 1));
  monday.setHours(0, 0, 0, 0);
  const cutoff = monday.toISOString().slice(0, 10);
  return flights.filter(f => f.date && f.date >= cutoff)
    .reduce((s, f) => s + flightTimeOf(f), 0);
}

// ─── Stat strip cell helper ────────────────────────────────────
function _dashSetStripVal(id, val, unit) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = esc(String(val)) + (unit ? `<span class="dash-strip-unit">${esc(unit)}</span>` : '');
}

