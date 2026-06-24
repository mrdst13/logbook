// ═══════════════════════════════════════════
// PILOT PROFILE TYPES (Feature 3)
// ═══════════════════════════════════════════
function setProfileType(type) {
  const p = DB.loadProfile();
  const previousType = p.pilotType;
  p.pilotType = type;
  DB.saveProfile(p);
  highlightProfileTypeCard(type);
  // Auto-apply matching column preset on type change (or first save) so the
  // table immediately reflects what this persona scans for. User can still
  // override via the Columns picker afterward. Non-destructive if they had
  // a custom set — they re-toggle in the picker.
  if (previousType !== type && typeof presetForPilotType === 'function' && typeof applyColumnPreset === 'function') {
    applyColumnPreset(presetForPilotType(type));
  }
  if (typeof adaptFormToProfile === 'function') adaptFormToProfile(type);
  showToast(t('toast.profileTypeSaved'), 'success');
}

function highlightProfileTypeCard(type) {
  ['airline705', 'private', 'student', 'helicopter', 'instructor'].forEach(t => {
    const card = document.getElementById('pt-' + t);
    if (card) card.classList.toggle('active', t === type);
  });
}

function adaptFormToProfile(type) {
  const show = id => { const el = document.getElementById(id); if (el) el.style.display = ''; };
  const hide = id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };

  // PPC field: relevant for 705 line pilots only. Other profile types
  // (private/student/helicopter solo/instructor) don't have a Company
  // PPC under CASS 725.106, so we hide it rather than show a confusing
  // blank field.
  const showPPC = (type === 'airline705');
  if (showPPC) show('p-ppc-wrap');
  else        hide('p-ppc-wrap');
  const setLbl = (inputId, text) => {
    const el = document.getElementById(inputId);
    if (!el) return;
    const lbl = el.closest('.form-group')?.querySelector('label');
    if (lbl) lbl.textContent = text;
  };

  // Reset everything to default (airline705) first
  ['fg-block', 'fg-duty', 'fg-me-day-cop', 'fg-me-night-cop', 'fg-picus'].forEach(show);
  setLbl('f-pic',          t('flight.pic'));
  setLbl('f-copilot',      t('flight.copilot'));
  setLbl('f-me-day-pic',   t('flight.meDayPic'));
  setLbl('f-me-night-pic', t('flight.meNightPic'));
  setLbl('f-me-day-dual',  t('flight.meDayDual'));
  setLbl('f-me-night-dual',t('flight.meNightDual'));

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
    setLbl('f-pic',          t('flight.studentInstructor'));
    setLbl('f-copilot',      t('flight.studentName'));
    setLbl('f-me-day-pic',   t('flight.meDaySolo'));
    setLbl('f-me-night-pic', t('flight.meNightSolo'));
    setLbl('f-me-day-dual',  t('flight.meDayDualInstr'));
    setLbl('f-me-night-dual',t('flight.meNightDualInstr'));
  } else if (type === 'instructor') {
    // CFI / flight instructor mode: dual-given is the primary credit
    // (CAR 421.34 ATPL submission). Hide airline columns; relabel.
    hide('fg-duty');
    hide('fg-me-day-cop');
    hide('fg-me-night-cop');
    hide('fg-picus');
    setLbl('f-pic',          t('flight.instructorYou'));
    setLbl('f-copilot',      t('flight.studentName'));
    setLbl('f-me-day-pic',   t('flight.meDayPicSoloEval'));
    setLbl('f-me-night-pic', t('flight.meNightPicSoloEval'));
    setLbl('f-me-day-dual',  t('flight.meDayDualReceived'));
    setLbl('f-me-night-dual',t('flight.meNightDualReceived'));
  } else if (type === 'helicopter') {
    // Heli ops: hide ME airline labels which contaminate stats; rotorcraft
    // hours live in the dedicated Heli columns (heliDayPic/heliNightPic
    // etc.) which the table picker exposes by default for this type.
    hide('fg-me-day-cop');
    hide('fg-me-night-cop');
    hide('fg-picus');
  }

  // Rank override for Airline 705 Captains: a Captain logs PIC time, not
  // Co-Pilot time. ME Day/Night Co-Pilot fields are irrelevant for them
  // and just create noise. The PICUS field also doesn't apply (PICUS is a
  // co-pilot acting as PIC under supervision — not a Captain).
  if (type === 'airline705') {
    const p = (typeof DB !== 'undefined' && DB.loadProfile) ? DB.loadProfile() : {};
    const rank = (p.rank || '').toLowerCase();
    const isCaptain = rank === 'cpt.' || rank === 'cpt' || rank === 'captain' || rank === 'pic';
    if (isCaptain) {
      hide('fg-me-day-cop');
      hide('fg-me-night-cop');
      hide('fg-picus');
      setLbl('f-copilot', t('flight.copilotFO'));
    }
  }

  // Q4 — profile-driven default state for the advanced fields wrapper.
  // For an Airline 705 pilot, ME Day/Night PIC (or Co-Pilot) + Instrument
  // are EVERY-FLIGHT fields. Hiding them behind a "Show advanced" toggle
  // adds friction to the daily log. So: open by default + hide the toggle.
  //
  // For private/student/helicopter/instructor the wrapper stays collapsed
  // by default (their core fields live outside) but the toggle remains so
  // they can pull in extra breakdowns when needed.
  const advWrap = document.getElementById('advancedFormFields');
  const advBtn  = document.getElementById('formAdvancedToggle');
  if (advWrap && advBtn) {
    if (type === 'airline705') {
      advWrap.style.display = '';
      advBtn.style.display = 'none';
    } else {
      // Only force collapsed state when we're not currently editing — the
      // edit flow may have legitimately expanded the wrapper to show data.
      if (typeof editingId === 'undefined' || !editingId) {
        advWrap.style.display = 'none';
      }
      advBtn.style.display = '';
    }
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
  sv('p-fname', p.fname || '');
  sv('p-lname', p.lname || '');
  document.getElementById('p-rank').value = p.rank || 'F/O';
  // Airline: try to pre-select the dropdown if the saved value matches a known option.
  // Case-insensitive matching + partial (e.g. "Porter" matches "Porter Airlines|PD").
  const airlineName = (p.airline || '').trim();
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
  sv('p-ecg', p.ecg);
  // Profile fields default to EMPTY — never inject Porter / YOW / E195-E2 / PD
  // defaults. Cumulo serves pilots at all Canadian operators (and private/VFR
  // pilots with no operator at all), so pre-filling with one airline's
  // particulars sends the wrong product positioning signal.
  sv('p-base', p.base || '');
  sv('p-fleet', p.fleet || '');
  sv('p-operatorCodes', p.operatorCodes || '');
  // PPC (705 line ops). The wrapper is hidden by adaptFormToProfile()
  // when the pilot type doesn't use it (private / student / helicopter / instructor).
  // LOFT is intentionally NOT a separate field — operators define how LOFT
  // relates to PPC currency in their approved training program. When a LOFT
  // happens, the pilot updates the PPC date if their operator's program
  // says it does (Porter or otherwise).
  sv('p-ppc', p.ppcDueDate);
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
    // Persist on change — this is a PIPEDA consent control and lives on the
    // Privacy tab, which has no Save button. Saving only via the Profile tab's
    // Save button silently lost the user's choice. Now it saves immediately,
    // like the hide-empty-columns toggle below.
    consentCb.onchange = () => {
      consentCb.closest('label').classList.toggle('is-on', consentCb.checked);
      const prof = DB.loadProfile();
      prof.consentCaptainNames = !!consentCb.checked;
      DB.saveProfile(prof);
      if (typeof showToast === 'function') {
        showToast(t('toast.saved') || (getLang && getLang() === 'fr' ? 'Enregistré' : 'Saved'), 'success');
      }
    };
  }
  // Hide-empty-columns toggle: screen-only filtering. Persists + re-renders live.
  // Never affects the TC PDF export (always 38 columns for ramp-check compliance).
  const hideZeroCb = document.getElementById('p-hideZeroColumns');
  if (hideZeroCb) {
    hideZeroCb.checked = !!p.hideZeroColumns;
    hideZeroCb.closest('label').classList.toggle('is-on', hideZeroCb.checked);
    hideZeroCb.onchange = () => {
      hideZeroCb.closest('label').classList.toggle('is-on', hideZeroCb.checked);
      const prof = DB.loadProfile();
      prof.hideZeroColumns = !!hideZeroCb.checked;
      DB.saveProfile(prof);
      if (typeof renderLogbook === 'function') renderLogbook(typeof filterVal !== 'undefined' ? filterVal : '');
    };
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
    ecg: gv('p-ecg'),
    base: gv('p-base'),
    fleet: gv('p-fleet'),
    operatorCodes: (gv('p-operatorCodes') || '').toUpperCase().replace(/\s/g, ''),
    autoCountIFR: !!document.getElementById('p-autoCountIFR')?.checked,
    consentCaptainNames: !!document.getElementById('p-consentCaptainNames')?.checked,
    hideZeroColumns: !!document.getElementById('p-hideZeroColumns')?.checked,
    acConfigs: [...document.querySelectorAll('#p-acConfigs input[type=checkbox]:checked')].map(cb => cb.value),
    pilotType: existing.pilotType || 'airline705',
    // CASS 725.106 PPC (705 line ops). Empty string = not tracking for now,
    // not "expired today". LOFT is intentionally not a separate field; see
    // loadProfile() for rationale.
    ppcDueDate: gv('p-ppc'),
  };
  DB.saveProfile(p);
  updateProfileDisplay(p);
  // Note: we no longer sweep+anonymize local
  // flights when the toggle flips ON→OFF. Under the new model, full names
  // ALWAYS stay on the user's device — anonymization only happens at egress
  // (cloud sync, shareable PDF export). Flipping the toggle is non-destructive.
  showToast(t('toast.profileSaved'), 'success');
}

function updateProfileDisplay(p) {
  const name = `${p.rank||'F/O'} ${p.fname||''} ${p.lname||''}`.trim();
  document.getElementById('profileNameDisp').textContent = name;
  // Show the user's airline if set, otherwise their rank (no Porter default —
  // a private pilot with no operator should see "Private Pilot", not Porter).
  document.getElementById('profileRoleDisp').textContent = p.airline || p.rank || 'Pilot';
  document.querySelector('.pilot-name').textContent = name;
  // Avatar letter — first initial of fname, then lname, then fallback "P".
  // The old hardcoded "P" survived since the first Cumulo build; with the
  // de-Porterise pass we want every user's profile to feel personal, not
  // like a generic "Pilot" badge.
  const avatarEl = document.getElementById('profileAvatarLetter');
  if (avatarEl) {
    const initial = ((p.fname || '').trim()[0]
                  || (p.lname || '').trim()[0]
                  || 'P').toUpperCase();
    avatarEl.textContent = initial;
  }
}

// ═══════════════════════════════════════════
// NAVBLUE iCal AUTO-SYNC
