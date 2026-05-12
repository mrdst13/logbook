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
  // Captain-name PIPEDA toggle: default OFF (anonymize). User explicitly opts in
  // if they have crew consent or accept responsibility for third-party data.
  const consentCb = document.getElementById('p-consentCaptainNames');
  if (consentCb) {
    consentCb.checked = !!p.consentCaptainNames; // explicit false when missing
    consentCb.closest('label').classList.toggle('is-on', consentCb.checked);
    consentCb.onchange = () => consentCb.closest('label').classList.toggle('is-on', consentCb.checked);
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
    consentCaptainNames: !!document.getElementById('p-consentCaptainNames')?.checked,
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
