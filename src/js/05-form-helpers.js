// ═══════════════════════════════════════════
// FORM — SAVE / EDIT / DELETE
// ═══════════════════════════════════════════
function gv(id) { return document.getElementById(id).value; }
function sv(id, val) { document.getElementById(id).value = val || ''; }

// ═══════════════════════════════════════════
// AIRCRAFT DROPDOWN (Feature 2)
// ═══════════════════════════════════════════
// Map Aircraft Type → TC Type Rating. Only type-rated aircraft are listed
// (per CAR Standard 421: jets and turbines > 5,700 kg, plus designated
// aircraft like Q400). Light singles / twins below the threshold don't
// require a type rating — they're omitted on purpose so the field stays
// blank for those (the pilot's licence covers them via class rating).
const AIRCRAFT_RATINGS = {
  // Embraer
  'E195-E2': 'E190/E195',
  'E190':    'E190/E195',
  // Airbus
  'A220':    'A220',
  'A319':    'A320',
  'A320':    'A320',
  'A321':    'A320',
  'A330':    'A330',
  // Boeing
  'B737-700':   'B737',
  'B737-800':   'B737',
  'B737 MAX 8': 'B737',
  'B767':       'B767',
  'B777':       'B777',
  'B787':       'B787',
  // Bombardier / De Havilland
  'CRJ-200': 'CRJ',
  'CRJ-700': 'CRJ',
  'CRJ-900': 'CRJ',
  'Q400':              'DH4',
  'DHC-8-100':         'DH8',
  'DHC-8-200':         'DH8',
  'DHC-8-300':         'DH8',
  // ATR
  'ATR-42': 'ATR42/72',
  'ATR-72': 'ATR42/72',
  // Other commuters
  'SAAB 340':         'SF34',
  'Beechcraft 1900':  'BE1900',
  'DHC-6 Twin Otter': 'DHC-6',
  'Pilatus PC-12':    'PC12',
  'King Air 200':     'BE20',
  'King Air 350':     'BE30',
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
  if (ft && !editingId) ft.textContent = type === 'sim' ? t('form.title.logSim') : t('form.title.logFlight');
}

// saveFlight(options) — when options.addAnother === true, stay on the form
// after save and reset for the next leg (Porter F/Os fly 4-6 legs/day).
// Keeps Date (same day), Aircraft Type and Registration (same plane in
// most cases) pre-filled so the pilot only types what actually changed.
function saveFlight(options) {
  const opts = (options && typeof options === 'object') ? options : {};
  const date = gv('f-date');
  if (!date) { showToast(t('toast.dateRequired'), 'error'); return; }

  const isSim = currentEntryType === 'sim';

  const flight = {
    id: editingId || (typeof newUUID === 'function' ? newUUID() : Date.now().toString()),
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
    // UTC times. Only actual times exist in Cumulo — schedule times are
    // irrelevant for a logbook. Navblue iCal pre-fills atd_utc / ata_utc
    // with the roster time as a starting point; user edits if delayed.
    atd_utc: (gv('f-atd-utc') || '').trim(),
    ata_utc: (gv('f-ata-utc') || '').trim(),
    meDayDual: gv('f-me-day-dual'),
    meDayPic: gv('f-me-day-pic'),
    meDayCop: gv('f-me-day-cop'),
    meNightDual: gv('f-me-night-dual'),
    meNightPic: gv('f-me-night-pic'),
    meNightCop: gv('f-me-night-cop'),
    xcDayDual: gv('f-xc-day-dual'),
    xcDayPic: gv('f-xc-day-pic'),
    xcDayCop: gv('f-xc-day-cop'),
    xcNightDual: gv('f-xc-night-dual'),
    xcNightPic: gv('f-xc-night-pic'),
    xcNightCop: gv('f-xc-night-cop'),
    // Take-offs + landings. Recorded for SIM too (manual entry, never assumed):
    // a Level B/C/D full-flight-sim session counts toward recency under
    // CAR 401.05(2)(b). Career landing totals still exclude sim (calcStats).
    toDay: gv('f-to-day'),
    toNight: gv('f-to-night'),
    ldgDay: gv('f-ldg-day'),
    ldgNight: gv('f-ldg-night'),
    approaches: gv('f-approaches'),
    instActual: gv('f-inst-actual'),
    instHood: gv('f-inst-hood'),
    instSim: isSim ? (gv('f-total') || gv('f-inst-sim')) : gv('f-inst-sim'),
    picus: gv('f-picus'),
    // Single-engine (seDay/seNight = PIC buckets; *Dual = instruction received)
    // and helicopter + hover. Empty unless the pilot-type form shows them.
    seDay: isSim ? '' : gv('f-se-day'),
    seNight: isSim ? '' : gv('f-se-night'),
    seDayDual: isSim ? '' : gv('f-se-day-dual'),
    seNightDual: isSim ? '' : gv('f-se-night-dual'),
    heliDayPic: isSim ? '' : gv('f-heli-day-pic'),
    heliNightPic: isSim ? '' : gv('f-heli-night-pic'),
    heliDayCop: isSim ? '' : gv('f-heli-day-cop'),
    heliNightCop: isSim ? '' : gv('f-heli-night-cop'),
    heliDayDual: isSim ? '' : gv('f-heli-day-dual'),
    heliNightDual: isSim ? '' : gv('f-heli-night-dual'),
    hoverTime: isSim ? '' : gv('f-hover'),
    dualGivenDay: isSim ? '' : gv('f-dualgiven-day'),
    dualGivenNight: isSim ? '' : gv('f-dualgiven-night'),
    // Simulator fields (per CAR 401.08 — separate from flight time)
    isSim,
    simType: isSim ? gv('f-simType') : '',
    simSession: isSim ? gv('f-simSession') : '',
    simRegistration: isSim ? gv('f-simRegistration') : '',
    simInstructor: isSim ? gv('f-simInstructor') : '',
  };

  // Safety net: if Total was left blank but Block is logged, Total = Block.
  // The Block->Total auto-sync flag (f-total.dataset.autoFromBlock) can get
  // stuck at '0' across the "add another leg" flow, so a later leg could be
  // submitted with Total empty while Block > 0 — understating logged time.
  // (Opus audit — Block/Total auto-sync edge case.) Only fills a BLANK total;
  // an explicit 0 the pilot typed is respected.
  if (!isSim && (flight.total === '' || flight.total === undefined || flight.total === null)
      && (+flight.block || 0) > 0) {
    flight.total = flight.block;
  }

  // Normalize empty form values to undefined BEFORE recalc, so the
  // recalc fill-empty logic (which strict-checks undefined/null) actually
  // fires. Form inputs return '' for unfilled fields ; that '' was getting
  // recorded as a "pilot value" and blocking the XC + Night auto-fill.
  // Audit 2026-05-29 : Martin reported XC never calculated on his flights.
  const AUTO_SLOTS = ['meDayDual','meDayPic','meDayCop','meNightDual','meNightPic','meNightCop',
                      'xcDayDual','xcDayPic','xcDayCop','xcNightDual','xcNightPic','xcNightCop'];
  AUTO_SLOTS.forEach(k => {
    if (flight[k] === '' || flight[k] === undefined || flight[k] === null) {
      delete flight[k];   // mark empty so recalculateFlightDayNightXC() fills it
    }
  });
  // Manually-entered class fields (SE / helicopter / hover): drop empties so a
  // blank field never stores '' and, on edit, never clobbers an existing value
  // through the merge in saveFlight (these are not auto-filled by recalc).
  ['seDay','seNight','seDayDual','seNightDual',
   'heliDayPic','heliNightPic','heliDayCop','heliNightCop','heliDayDual','heliNightDual',
   'hoverTime','dualGivenDay','dualGivenNight','toDay','toNight'].forEach(k => {
    if (flight[k] === '' || flight[k] === undefined || flight[k] === null) delete flight[k];
  });

  // Diversion handling : if the pilot edited the route on an existing
  // flight, the old XC/Night auto-values were computed for the old route
  // and are now stale. Clear them so the recalc can refill with the new
  // route's coordinates. We preserve any value that DIFFERS from the
  // existing flight's stored value (treat as explicit pilot edit).
  if (editingId) {
    const existing = flights.find(f => f.id === editingId);
    if (existing && existing.route !== flight.route) {
      // Route changed (e.g. diversion YYZ-YYT → YYZ-YOW). Drop the cached
      // ICAO codes and the auto-calculated XC/Night slots so the new route
      // drives the next recalc pass.
      delete flight.dep_icao;
      delete flight.arr_icao;
      AUTO_SLOTS.forEach(k => { if (flight[k] === undefined) delete flight[k]; });
    }
  }

  // Auto-fill XC + Night from the route's ICAO coordinates. Returns the
  // same object if nothing was filled (no coords / no UTC anchor / no
  // block) — safe to call unconditionally.
  const finalFlight = (typeof recalculateFlightDayNightXC === 'function')
    ? recalculateFlightDayNightXC(flight)
    : flight;

  if (editingId) {
    const idx = flights.findIndex(f => f.id === editingId);
    if (idx !== -1) {
      // MERGE onto the existing row — do NOT replace it. The form only reads
      // ~30 fields; a full replacement silently dropped every field with no
      // form input (approaches, xc*Cop, se*, heli*, hoverTime, dualGiven*,
      // to*, flightNum, via, crewPosition, multiCrew, dtstart_utc, source…).
      // An F/O editing an imported flight was losing IFR approaches + XC.
      // (Opus audit C3, 2026-06-24.) Form + recalc values overlay on top.
      const existingRow = flights[idx] || {};
      flights[idx] = { ...existingRow, ...finalFlight };
    }
    editingId = null;
  } else {
    flights.push(finalFlight);
  }

  DB.save(flights);

  // Warn (never fabricate) when block time was logged but NO creditable class/
  // role time could be attributed — e.g. an F/O who entered block without a UTC
  // time and didn't expand the ME fields. The flight is still saved (total is
  // kept), but the pilot is told their PIC/SIC/day/night breakdown is empty so
  // they can add a UTC time or fill the fields, rather than silently banking 0h
  // of creditable time. (Audit panel 2026-06-25 must-fix #4.)
  const _attributed = (typeof dayHoursOf === 'function')
    ? (dayHoursOf(finalFlight) + nightHoursOf(finalFlight)) : 1;
  if (!isSim && (+finalFlight.block || 0) > 0 && _attributed === 0) {
    showToast(t('toast.timeUnattributed'), 'warning');
  } else {
    showToast(t('toast.flightSaved'), 'success');
  }

  if (opts.addAnother) {
    // Stay on Add Flight. Reset most fields but keep Date / Aircraft type / Reg
    // (those are usually the same across legs of the same duty day).
    const keep = {
      date: gv('f-date'),
      type: getAircraftType(),
      reg: gv('f-reg'),
      rating: gv('f-rating'),
    };
    clearForm();
    sv('f-date', keep.date);
    setAircraftTypeField(keep.type);
    sv('f-reg', keep.reg);
    sv('f-rating', keep.rating);
    // Focus the next-likely-changed field (Route) so the pilot can type immediately.
    setTimeout(() => document.getElementById('f-route')?.focus(), 30);
    return;
  }

  showPage('logbook');
}

function editFlight(id) {
  const f = flights.find(x => x.id === id);
  if (!f) return;
  editingId = id;
  document.getElementById('formTitle').textContent = f.isSim ? t('form.title.editSim') : t('form.title.editFlight');
  setEntryType(f.isSim ? 'sim' : 'flight');
  sv('f-date', f.date); setAircraftTypeField(f.type); sv('f-reg', f.reg);
  sv('f-rating', f.rating);
  if (document.getElementById('f-acConfig')) document.getElementById('f-acConfig').value = f.acConfig || 'wheels';
  sv('f-pic', f.pic); sv('f-copilot', f.copilot);
  sv('f-route', f.route); sv('f-remarks', f.remarks);
  sv('f-block', f.block); sv('f-duty', f.duty); sv('f-total', f.total);
  // ATD/ATA are the only UTC time concept. Never auto-fill from std_utc
  // (schedule) — that's an approximation in a certifiable logbook.
  // If atd_utc is empty, the form shows empty. User must enter manually
  // or import from the PDF roster which has the actuals.
  sv('f-atd-utc', f.atd_utc || '');
  sv('f-ata-utc', f.ata_utc || '');
  sv('f-me-day-dual', f.meDayDual); sv('f-me-day-pic', f.meDayPic); sv('f-me-day-cop', f.meDayCop);
  sv('f-me-night-dual', f.meNightDual); sv('f-me-night-pic', f.meNightPic); sv('f-me-night-cop', f.meNightCop);
  sv('f-xc-day-dual', f.xcDayDual); sv('f-xc-day-pic', f.xcDayPic); sv('f-xc-day-cop', f.xcDayCop);
  sv('f-xc-night-dual', f.xcNightDual); sv('f-xc-night-pic', f.xcNightPic); sv('f-xc-night-cop', f.xcNightCop);
  sv('f-to-day', f.toDay); sv('f-to-night', f.toNight);
  sv('f-ldg-day', f.ldgDay); sv('f-ldg-night', f.ldgNight); sv('f-approaches', f.approaches);
  sv('f-se-day', f.seDay); sv('f-se-night', f.seNight);
  sv('f-se-day-dual', f.seDayDual); sv('f-se-night-dual', f.seNightDual);
  sv('f-heli-day-pic', f.heliDayPic); sv('f-heli-night-pic', f.heliNightPic);
  sv('f-heli-day-cop', f.heliDayCop); sv('f-heli-night-cop', f.heliNightCop);
  sv('f-heli-day-dual', f.heliDayDual); sv('f-heli-night-dual', f.heliNightDual);
  sv('f-hover', f.hoverTime);
  sv('f-dualgiven-day', f.dualGivenDay); sv('f-dualgiven-night', f.dualGivenNight);
  sv('f-inst-actual', f.instActual); sv('f-inst-hood', f.instHood); sv('f-inst-sim', f.instSim);
  sv('f-picus', f.picus);
  if (f.isSim) {
    if (document.getElementById('f-simType')) document.getElementById('f-simType').value = f.simType || 'FFS';
    if (document.getElementById('f-simSession')) document.getElementById('f-simSession').value = f.simSession || 'Recurrent';
    sv('f-simRegistration', f.simRegistration);
    sv('f-simInstructor', f.simInstructor);
  }
  showPage('add');
  if (typeof validateFlightForm === 'function') validateFlightForm();
}

// Tombstones — signatures of deleted flights so the iCal sync never
// re-imports a flight the pilot deliberately removed (the "vols supprimés
// ressuscitent" bug). Mirrors findMatchingExistingFlight()'s exact key:
// date|flightNum|route, plus a date|block fallback for source variance.
const DELETED_TOMBSTONES_KEY = 'cumulo_deleted_tombstones_v1';

function loadTombstones() {
  try { return JSON.parse(localStorage.getItem(DELETED_TOMBSTONES_KEY) || '[]'); }
  catch { return []; }
}

function recordTombstone(f) {
  if (!f || !f.date) return;
  const tombs = loadTombstones();
  tombs.push({
    key: `${f.date}|${f.flightNum || ''}|${(f.route || '').toUpperCase().replace(/\s/g, '')}`,
    date: f.date,
    block: +f.block || 0,
    at: Date.now()
  });
  // Keep the list bounded (last 2000 deletions is plenty for any career).
  try { localStorage.setItem(DELETED_TOMBSTONES_KEY, JSON.stringify(tombs.slice(-2000))); }
  catch { /* storage full — non-fatal, sync will just risk re-import */ }
}

// True if an incoming sync flight matches a recorded deletion. Mirrors the
// exact + date-block match logic in findMatchingExistingFlight().
function isTombstoned(incoming) {
  if (!incoming || !incoming.date) return false;
  const tombs = loadTombstones();
  const key = `${incoming.date}|${incoming.flightNum || ''}|${(incoming.route || '').toUpperCase().replace(/\s/g, '')}`;
  const inBlock = +incoming.block || 0;
  // The loose date+block fallback catches a re-import whose flightNum/route
  // shifted slightly after a deletion — but it must NOT permanently suppress a
  // genuinely different flight flown on the same day with a similar block time.
  // So: strict key match suppresses forever; the loose match only applies for a
  // bounded window after the deletion. (Opus audit — tombstone over-suppression.)
  const LOOSE_TTL_MS = 60 * 24 * 3600 * 1000; // 60 days
  return tombs.some(t =>
    t.key === key ||
    (t.date === incoming.date &&
     Math.abs((t.block || 0) - inBlock) <= 0.15 &&
     (Date.now() - (t.at || 0)) <= LOOSE_TTL_MS)
  );
}

async function deleteFlight(id) {
  const ok = await confirmDialog({
    title: t('confirm.deleteFlightTitle') || 'Delete flight',
    body: t('confirm.deleteFlight'),
    cancelLabel: t('btn.cancel') || 'Cancel',
    confirmLabel: t('btn.delete') || 'Delete',
    danger: true
  });
  if (!ok) return;
  // Snapshot first so the deletion is undoable from Settings → Data
  // (honors the promise in the confirm copy).
  if (typeof snapshotBeforeOperation === 'function') snapshotBeforeOperation('delete-flight');
  // Record a tombstone so the next iCal sync doesn't resurrect this flight.
  const deleted = flights.find(f => f.id === id);
  if (deleted) recordTombstone(deleted);
  flights = flights.filter(f => f.id !== id);
  DB.save(flights);
  // Propagate to the cloud as a soft delete so other devices don't
  // resurrect this flight on their next sync (audit 2026-06-09).
  // No-op while signed out / Supabase not configured.
  if (typeof Sync !== 'undefined' && typeof Auth !== 'undefined'
      && Auth.isAuthenticated && Auth.isAuthenticated()) {
    Sync.deleteFlight(id).catch(e => console.warn('[Sync] cloud delete failed:', e));
  }
  showToast(t('toast.flightDeleted'), 'error');
  renderLogbook(filterVal);
}

function clearForm() {
  // Reset aircraft dropdown and hide custom input
  const sel = document.getElementById('f-type-select');
  const custom = document.getElementById('f-type-custom');
  if (sel) sel.value = '';
  if (custom) { custom.value = ''; custom.style.display = 'none'; }

  ['f-date','f-reg','f-rating','f-pic','f-copilot','f-route','f-remarks',
   'f-block','f-duty','f-total','f-atd-utc','f-ata-utc',
   'f-me-day-dual','f-me-day-pic','f-me-day-cop',
   'f-me-night-dual','f-me-night-pic','f-me-night-cop','f-xc-day-dual','f-xc-day-pic',
   'f-xc-night-dual','f-xc-night-pic','f-xc-day-cop','f-xc-night-cop','f-approaches',
   'f-to-day','f-to-night','f-ldg-day','f-ldg-night',
   'f-se-day','f-se-night','f-se-day-dual','f-se-night-dual',
   'f-heli-day-pic','f-heli-night-pic','f-heli-day-cop','f-heli-night-cop',
   'f-heli-day-dual','f-heli-night-dual','f-hover','f-dualgiven-day','f-dualgiven-night',
   'f-inst-actual','f-inst-hood','f-inst-sim','f-picus'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  // Reset the Block->Total auto-sync flag so the NEXT leg auto-fills Total
  // again (it gets stuck at '0' once a pilot types Total on a prior leg).
  // (Opus audit — Block/Total auto-sync edge case.)
  const totalEl = document.getElementById('f-total');
  if (totalEl) totalEl.dataset.autoFromBlock = '1';

  // Clear any leftover validation messages.
  document.querySelectorAll('.field-error').forEach(e => e.classList.remove('show'));
  if (typeof validateFlightForm === 'function') validateFlightForm();
}

function cancelForm() {
  editingId = null;
  showPage('logbook');
}

// ═══════════════════════════════════════════
// HHMM TIME-INPUT MASK + FORM VALIDATION
// ═══════════════════════════════════════════
// A pilot who types "1235" should see "12:35" while the stored value
// stays "1235" (HHMM, no colon — same format Navblue / TC PDF use).
// Native HTML5 pattern only flags on submit; we want a live cue.

function _hhmmIsValid(s) {
  if (!s) return true;  // empty allowed (field is optional)
  if (!/^\d{4}$/.test(s)) return false;
  const h = +s.slice(0, 2), m = +s.slice(2);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function attachHHMMMask(input) {
  if (!input || input._hhmmBound) return;
  input._hhmmBound = true;

  // Display the colon visually but only store the 4-digit value.
  // We keep the underlying value as HHMM so saveFlight() / pdf-roster /
  // dtstart parsing don't have to special-case the colon.
  input.addEventListener('input', (e) => {
    const digitsOnly = (input.value || '').replace(/\D/g, '').slice(0, 4);
    input.value = digitsOnly;
  });

  input.addEventListener('blur', () => {
    const v = (input.value || '').trim();
    const errEl = input.parentElement.querySelector('.field-error');
    if (v && !_hhmmIsValid(v)) {
      if (!errEl) {
        const err = document.createElement('div');
        err.className = 'field-error show';
        err.textContent = t('form.err.invalidTime');
        input.parentElement.appendChild(err);
      } else {
        errEl.classList.add('show');
      }
      input.setAttribute('aria-invalid', 'true');
    } else {
      if (errEl) errEl.classList.remove('show');
      input.removeAttribute('aria-invalid');
    }
    validateFlightForm();
  });
}

// Render a summary above the save buttons; toggle Save disabled state.
function validateFlightForm() {
  const errSummary = document.getElementById('formErrorSummary');
  const saveBtn = document.getElementById('saveFlightBtn');
  const saveAddBtn = document.getElementById('saveAddAnotherBtn');
  if (!saveBtn) return;

  const errors = [];

  // Hard requirement: date present (matches saveFlight() check).
  const dateVal = (document.getElementById('f-date') || {}).value;
  if (!dateVal) errors.push(t('form.err.dateRequired'));

  // HHMM format checks (soft — only flagged if user typed something).
  ['f-atd-utc', 'f-ata-utc'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value && !_hhmmIsValid(el.value)) {
      const label = id === 'f-atd-utc' ? 'ATD (UTC)' : 'ATA (UTC)';
      errors.push(t('form.err.invalidHHMM', { label }));
    }
  });

  const hasErrors = errors.length > 0;
  if (errSummary) {
    if (hasErrors) {
      errSummary.innerHTML = `<strong>${esc(t('form.err.fixBeforeSaving'))}</strong><ul>` +
        errors.map(e => `<li>${esc(e)}</li>`).join('') + '</ul>';
      errSummary.classList.add('show');
    } else {
      errSummary.classList.remove('show');
      errSummary.innerHTML = '';
    }
  }
  [saveBtn, saveAddBtn].forEach(btn => {
    if (!btn) return;
    btn.disabled = hasErrors;
    btn.setAttribute('aria-disabled', String(hasErrors));
  });
}

// Wire validation listeners. Called from 99-init once on page load.
function wireFlightFormValidation() {
  const dateEl = document.getElementById('f-date');
  if (dateEl) {
    dateEl.addEventListener('input', validateFlightForm);
    dateEl.addEventListener('blur', validateFlightForm);
  }
  ['f-atd-utc', 'f-ata-utc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) attachHHMMMask(el);
  });
  // Initial state — disable Save until date is filled.
  validateFlightForm();
}

