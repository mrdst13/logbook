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
  if (!date) { showToast(t('toast.dateRequired'), 'error'); return; }

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
    // UTC times. ATD/ATA = actual (preferred for night/XC recalc).
    // STD/STA = scheduled (from Navblue roster sync). User can override either.
    atd_utc: (gv('f-atd-utc') || '').trim(),
    ata_utc: (gv('f-ata-utc') || '').trim(),
    std_utc: (gv('f-std-utc') || '').trim(),
    sta_utc: (gv('f-sta-utc') || '').trim(),
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
  showToast(t('toast.flightSaved'), 'success');
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
  sv('f-atd-utc', f.atd_utc || ''); sv('f-ata-utc', f.ata_utc || '');
  sv('f-std-utc', f.std_utc || ''); sv('f-sta-utc', f.sta_utc || '');
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
  if (!confirm(t('confirm.deleteFlightShort'))) return;
  flights = flights.filter(f => f.id !== id);
  DB.save(flights);
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

