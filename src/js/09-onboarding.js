// ═══════════════════════════════════════════
// ONBOARDING WIZARD — first launch experience
// Triggered when no profile name is set. Skippable.
//
// Step sequence (internal indices 1-6):
//   1. Welcome           — what Cumulo is. No inputs.
//   2. Identity          — name, rank, airline, base, operator codes.
//   3. Pilot type        — Airline 705 / Private / Student / Instructor / Helicopter.
//   4. License + medical — license #, medical expiry, ECG, primary fleet.
//   5. Navblue iCal      — ONLY shown when airline contains "Porter".
//   6. Column preset     — Compact / ATPL / All.
//
// Non-Porter pilots see 5 steps (5 skipped). Porter pilots see 6. The
// displayed step counter ("Step X of N") reflects what the pilot actually
// walks through, not the internal index.
// ═══════════════════════════════════════════
const ONBOARDING_KEY = 'cumulo_onboarded_v1';
const ONB_TOTAL_INTERNAL_STEPS = 6;
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

async function skipOnboarding() {
  if (!await confirmDialog({
    title: t('onb.skipConfirm.title'),
    body: t('onb.skipConfirm'),
    cancelLabel: t('onb.skipConfirm.cancel'),
    confirmLabel: t('onb.skipConfirm.confirm')
  })) return;
  localStorage.setItem(ONBOARDING_KEY, 'skipped');
  document.getElementById('onboardingOverlay').classList.remove('show');
  document.body.style.overflow = '';
}

function finishOnboarding() {
  localStorage.setItem(ONBOARDING_KEY, 'done');
  document.getElementById('onboardingOverlay').classList.remove('show');
  document.body.style.overflow = '';
  renderDashboard();
  showToast(t('onb.complete'), 'success');
}

// True when this internal step is part of the user's path. Navblue (step 5)
// is skipped unless the airline picked at step 2 is Porter.
function _onbIsStepShown(step) {
  if (step === 5) {
    return (onbData.airline || '').toLowerCase().includes('porter');
  }
  return true;
}

function _onbVisibleStepCount() {
  let n = 0;
  for (let s = 1; s <= ONB_TOTAL_INTERNAL_STEPS; s++) if (_onbIsStepShown(s)) n++;
  return n;
}

// 1-indexed position of the current step among visible steps (for display).
function _onbDisplayStepNumber() {
  let n = 0;
  for (let s = 1; s <= onbStep; s++) if (_onbIsStepShown(s)) n++;
  return n;
}

function onboardingBack() {
  let prev = onbStep - 1;
  while (prev >= 1 && !_onbIsStepShown(prev)) prev--;
  if (prev >= 1) { onbStep = prev; renderOnboardingStep(); }
}

// Show/hide the custom airline text field based on dropdown choice.
function onOnbAirlineChange() {
  const sel = document.getElementById('onb-airline-select');
  const custom = document.getElementById('onb-airline-custom');
  if (!sel || !custom) return;
  custom.style.display = sel.value === 'other' ? 'block' : 'none';
  // If user picks a known airline, auto-fill the operator codes field.
  if (sel.value && sel.value !== 'other' && sel.value !== 'none') {
    const [, code] = sel.value.split('|');
    const codesEl = document.getElementById('onb-codes');
    if (codesEl && !codesEl.value.trim() && code) codesEl.value = code;
  }
}

// Pilot-type card click — updates the selected card visually and captures the value.
function onOnbPilotType(type) {
  onbData.pilotType = type;
  document.querySelectorAll('[data-onb-pilot-type]').forEach(card => {
    card.classList.toggle('active', card.dataset.onbPilotType === type);
  });
}

function onboardingNext() {
  // ─── Capture current step ─────────────────────────────────────────
  if (onbStep === 1) {
    // Welcome — no inputs, nothing to capture.
  } else if (onbStep === 2) {
    onbData.fname = document.getElementById('onb-fname')?.value?.trim() || '';
    onbData.lname = document.getElementById('onb-lname')?.value?.trim() || '';
    onbData.rank = document.getElementById('onb-rank')?.value || 'F/O';
    // Operator codes are auto-derived from the airline choice — pilots don't
    // know what "IATA carrier codes" mean on day 1, asking them is pure friction.
    // They can edit codes later via Settings → Profile → Operational.
    const airSel = document.getElementById('onb-airline-select');
    const airVal = airSel?.value || '';
    if (airVal === 'other') {
      onbData.airline = document.getElementById('onb-airline-custom')?.value?.trim() || '';
      onbData.operatorCodes = '';   // user fills in Settings later
    } else if (airVal && airVal !== 'none') {
      const [name, code] = airVal.split('|');
      onbData.airline = name || '';
      onbData.operatorCodes = code || '';
    } else {
      onbData.airline = '';
      onbData.operatorCodes = '';
    }
    onbData.base = document.getElementById('onb-base')?.value?.trim() || '';
    if (!onbData.fname || !onbData.lname) {
      showToast(t('onb.nameRequired'), 'error');
      return;
    }
  } else if (onbStep === 3) {
    // Pilot type MUST be chosen explicitly — never silently assume airline705,
    // which gave bush / private / helicopter pilots the wrong form and wrong
    // auto-calculations. (Audit panel 2026-06-25 must-fix #5.)
    if (!onbData.pilotType) {
      showToast(t('onb.pilotTypeRequired'), 'error');
      return;
    }
  } else if (onbStep === 4) {
    onbData.license = document.getElementById('onb-license')?.value?.trim() || '';
    onbData.medical = document.getElementById('onb-medical')?.value || '';
    onbData.ecg = document.getElementById('onb-ecg')?.value || '';
    onbData.fleet = document.getElementById('onb-fleet')?.value?.trim() || '';
  } else if (onbStep === 5) {
    onbData.navblueUrl = document.getElementById('onb-navblue')?.value?.trim() || '';
  } else if (onbStep === 6) {
    onbData.columnPreset = document.querySelector('input[name="onb-preset"]:checked')?.value || 'compact';
  }

  // ─── Advance to next visible step, or finish ──────────────────────
  let next = onbStep + 1;
  while (next <= ONB_TOTAL_INTERNAL_STEPS && !_onbIsStepShown(next)) next++;

  if (next <= ONB_TOTAL_INTERNAL_STEPS) {
    onbStep = next;
    renderOnboardingStep();
    return;
  }

  // ─── Final save ──────────────────────────────────────────────────
  const profile = {
    fname: onbData.fname,
    lname: onbData.lname,
    rank: onbData.rank,
    airline: onbData.airline,
    base: onbData.base,
    license: onbData.license,
    medical: onbData.medical,
    ecg: onbData.ecg,
    fleet: onbData.fleet,
    operatorCodes: onbData.operatorCodes || '',
    pilotType: onbData.pilotType || 'airline705'
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
  // Step counter — display position among visible steps, total = visible count.
  document.getElementById('onbStepNum').textContent = _onbDisplayStepNumber();
  const totalEl = document.getElementById('onbStepTotal');
  if (totalEl) totalEl.textContent = _onbVisibleStepCount();

  // Progress bar — visual feedback. Each step except step 1 (Welcome)
  // counts as progress. The bar fills from 0% at step 1 to 100% at finish.
  const progressFill = document.getElementById('onbProgressFill');
  if (progressFill) {
    const cur = _onbDisplayStepNumber();
    const total = _onbVisibleStepCount();
    const pct = total > 1 ? Math.round(((cur - 1) / (total - 1)) * 100) : 0;
    progressFill.style.width = pct + '%';
  }

  const titleKeys = {
    1: 'onb.step1.title',  // Welcome
    2: 'onb.step2.title',  // Identity
    3: 'onb.step3.title',  // Pilot type
    4: 'onb.step4.title',  // License + medical
    5: 'onb.step5.title',  // Navblue
    6: 'onb.step6.title'   // Column preset
  };
  document.getElementById('onbStepTitle').textContent = t(titleKeys[onbStep]);

  const body = document.getElementById('onbBody');
  const backBtn = document.getElementById('onbBackBtn');
  const nextBtn = document.getElementById('onbNextBtn');
  backBtn.style.display = onbStep > 1 ? 'inline-flex' : 'none';
  backBtn.textContent = t('onb.back');
  // Compute next-visible step to know if this is the last step.
  let peek = onbStep + 1;
  while (peek <= ONB_TOTAL_INTERNAL_STEPS && !_onbIsStepShown(peek)) peek++;
  const isLast = peek > ONB_TOTAL_INTERNAL_STEPS;
  nextBtn.textContent = onbStep === 1 ? t('onb.getStarted') : (isLast ? t('onb.finish') : t('onb.continue'));

  // ─── Step 1: Welcome ──────────────────────────────────────────────
  // Restructured for mobile readability — bigger font, punchier copy,
  // regulation citations moved to a collapsible details block instead of
  // dominating the first impression. Confident "what you get" framing
  // beats defensive "here's how we comply with everything" framing.
  if (onbStep === 1) {
    body.innerHTML = `
      <p class="onb-welcome-intro">
        ${esc(t('onb.welcome.intro'))}
      </p>
      <div class="onb-welcome-items">
        <div class="onb-welcome-item">
          <div class="onb-welcome-item-title">${t('onb.welcome.bullet1Html')}</div>
        </div>
        <div class="onb-welcome-item">
          <div class="onb-welcome-item-title">${t('onb.welcome.bullet2Html')}</div>
        </div>
        <div class="onb-welcome-item">
          <div class="onb-welcome-item-title">${t('onb.welcome.bullet3Html')}</div>
        </div>
        <div class="onb-welcome-item">
          <div class="onb-welcome-item-title">${t('onb.welcome.bullet4Html')}</div>
        </div>
      </div>
      <p class="onb-welcome-footer">
        ${esc(t('onb.welcome.footer'))}
      </p>
    `;
  }

  // ─── Step 2: Identity ─────────────────────────────────────────────
  else if (onbStep === 2) {
    body.innerHTML = `
      <p style="font-size:14px; color:var(--text-secondary); margin-bottom:var(--s-4); line-height:1.55;">
        ${esc(t('onb.step2.intro'))}
      </p>
      <div class="form-grid" style="gap:var(--s-3);">
        <div class="form-group">
          <label>${esc(t('onb.step2.fname'))}</label>
          <input type="text" id="onb-fname" placeholder="${esc(t('onb.step2.fname'))}" autofocus />
        </div>
        <div class="form-group">
          <label>${esc(t('onb.step2.lname'))}</label>
          <input type="text" id="onb-lname" placeholder="${esc(t('onb.step2.lname'))}" />
        </div>
        <div class="form-group">
          <label>${esc(t('onb.step2.rank'))}</label>
          <select id="onb-rank">
            <option value="F/O">${esc(t('onb.rank.fo'))}</option>
            <option value="Cpt.">${esc(t('onb.rank.capt'))}</option>
            <option value="SIC">${esc(t('onb.rank.sic'))}</option>
            <option value="PIC">${esc(t('onb.rank.pic'))}</option>
            <option value="Student">${esc(t('onb.rank.student'))}</option>
            <option value="Instructor">${esc(t('onb.rank.instructor'))}</option>
          </select>
        </div>
        <div class="form-group">
          <label>${esc(t('onb.step2.base'))}</label>
          <input type="text" id="onb-base" placeholder="${esc(t('onb.step2.basePlaceholder'))}" maxlength="4" style="text-transform:uppercase;" />
        </div>
        <div class="form-group col-span-2">
          <label>${esc(t('onb.step2.airline'))}</label>
          <select id="onb-airline-select" onchange="onOnbAirlineChange()">
            <option value="">— ${esc(t('profile.airline.select'))} —</option>
            <optgroup label="${esc(t('onb.airline.group705'))}">
              <option value="Air Canada|AC">Air Canada (AC)</option>
              <option value="Air Canada Express / Jazz|QK">Air Canada Express / Jazz (QK)</option>
              <option value="WestJet|WS">WestJet (WS)</option>
              <option value="WestJet Encore|WR">WestJet Encore (WR)</option>
              <option value="Air Transat|TS">Air Transat (TS)</option>
              <option value="Porter Airlines|PD">Porter Airlines (PD)</option>
              <option value="Flair Airlines|F8">Flair Airlines (F8)</option>
              <option value="Canadian North|5T">Canadian North (5T)</option>
            </optgroup>
            <optgroup label="${esc(t('onb.airline.group704'))}">
              <option value="PAL Airlines|PB">PAL Airlines (PB)</option>
              <option value="Pacific Coastal Airlines|8P">Pacific Coastal Airlines (8P)</option>
              <option value="Bearskin Airlines|JV">Bearskin Airlines (JV)</option>
              <option value="Air Inuit|3H">Air Inuit (3H)</option>
              <option value="Calm Air|MO">Calm Air (MO)</option>
              <option value="Central Mountain Air|9M">Central Mountain Air (9M)</option>
              <option value="North Star Air|NSA">North Star Air (NSA)</option>
              <option value="Air Tindi|8T">Air Tindi (8T)</option>
              <option value="Kenn Borek Air|KBA">Kenn Borek Air (KBA)</option>
              <option value="Air Creebec|YN">Air Creebec (YN)</option>
            </optgroup>
            <optgroup label="${esc(t('onb.airline.group703'))}">
              <option value="Buffalo Airways|BFL">Buffalo Airways</option>
              <option value="Wasaya Airways|WT">Wasaya Airways (WT)</option>
              <option value="Summit Air|SUT">Summit Air</option>
              <option value="Keewatin Air|FK">Keewatin Air (FK)</option>
            </optgroup>
            <optgroup label="${esc(t('onb.airline.group702'))}">
              <option value="Canadian Helicopters|CHL">Canadian Helicopters (CHL)</option>
              <option value="CHC Helicopter|CHC">CHC Helicopter (CHC)</option>
              <option value="Helijet International|HEJ">Helijet International</option>
              <option value="Ascent Helicopters|ASC">Ascent Helicopters</option>
              <option value="Yellowhead Helicopters|YHL">Yellowhead Helicopters</option>
              <option value="Great Slave Helicopters|GSH">Great Slave Helicopters</option>
              <option value="Heli-One|HO">Heli-One</option>
            </optgroup>
            <optgroup label="${esc(t('onb.airline.groupFTO'))}">
              <option value="Mount Royal Aviation|MRU">Mount Royal Aviation</option>
              <option value="Confederation College Aviation|CCA">Confederation College</option>
              <option value="Brampton Flight Centre|BFC">Brampton Flight Centre</option>
              <option value="Moncton Flight College|MFC">Moncton Flight College</option>
              <option value="Seneca Aviation|SEN">Seneca Aviation</option>
              <option value="Cargair|CGR">Cargair</option>
              <option value="Other FTO|FTO">${esc(t('onb.airline.otherFto'))}</option>
            </optgroup>
            <optgroup label="${esc(t('onb.airline.groupOther'))}">
              <option value="other">— ${esc(t('profile.airline.other'))} —</option>
              <option value="none">${esc(t('profile.airline.none'))}</option>
            </optgroup>
          </select>
          <input type="text" id="onb-airline-custom" placeholder="${esc(t('onb.airline.customPlaceholder'))}" style="display:none;margin-top:6px;" />
        </div>
      </div>
      <p style="font-size:12px; color:var(--text-muted); margin-top:var(--s-3); line-height:1.5;">
        ${esc(t('onb.step2.codesAutoHint'))}
      </p>
    `;
    if (onbData.fname) document.getElementById('onb-fname').value = onbData.fname;
    if (onbData.lname) document.getElementById('onb-lname').value = onbData.lname;
    if (onbData.rank) document.getElementById('onb-rank').value = onbData.rank;
    if (onbData.base) document.getElementById('onb-base').value = onbData.base;
    if (onbData.airline) {
      const sel = document.getElementById('onb-airline-select');
      const lower = onbData.airline.toLowerCase();
      const match = [...sel.options].find(o => o.value && o.value !== 'other' && o.value !== 'none' && o.value.split('|')[0].toLowerCase() === lower);
      if (match) {
        sel.value = match.value;
      } else {
        sel.value = 'other';
        const custom = document.getElementById('onb-airline-custom');
        custom.style.display = 'block';
        custom.value = onbData.airline;
      }
    }
  }

  // ─── Step 3: Pilot type ───────────────────────────────────────────
  else if (onbStep === 3) {
    // No pre-selection — the pilot must actively pick (no card starts active).
    const selected = onbData.pilotType || null;
    const card = (type, name, desc) => `
      <div class="profile-type-card ${type === selected ? 'active' : ''}"
           data-onb-pilot-type="${type}"
           onclick="onOnbPilotType('${type}')"
           role="button" tabindex="0" aria-pressed="${type === selected}"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();onOnbPilotType('${type}');}"
           style="cursor:pointer;">
        <div class="pt-name">${esc(name)}</div>
        <div class="pt-desc">${esc(desc)}</div>
      </div>`;
    body.innerHTML = `
      <p style="font-size:14px; color:var(--text-secondary); margin-bottom:var(--s-4); line-height:1.55;">
        ${esc(t('onb.step3.intro'))}
      </p>
      <div class="profile-type-grid">
        ${card('airline705',  t('profile.type.airline'),    t('profile.type.airlineDesc'))}
        ${card('private',     t('profile.type.private'),    t('profile.type.privateDesc'))}
        ${card('student',     t('profile.type.student'),    t('profile.type.studentDesc'))}
        ${card('instructor',  t('profile.type.instructor'), t('profile.type.instructorDesc'))}
        ${card('helicopter',  t('profile.type.helicopter'), t('profile.type.helicopterDesc'))}
      </div>
    `;
    // Intentionally NO default here — the Next handler blocks advancing until
    // the pilot picks a type. (Audit panel 2026-06-25 must-fix #5.)
  }

  // ─── Step 4: License + medical ────────────────────────────────────
  else if (onbStep === 4) {
    body.innerHTML = `
      <p style="font-size:14px; color:var(--text-secondary); margin-bottom:var(--s-4); line-height:1.55;">
        ${esc(t('onb.step4.intro'))}
      </p>
      <div class="form-grid" style="gap:var(--s-3);">
        <div class="form-group col-span-2">
          <label>${esc(t('onb.step4.license'))}</label>
          <input type="text" id="onb-license" placeholder="${esc(t('onb.step4.licensePlaceholder'))}" style="font-family:var(--font-mono);" />
        </div>
        <div class="form-group">
          <label>${esc(t('onb.step4.medical'))}</label>
          <input type="date" id="onb-medical" />
        </div>
        <div class="form-group">
          <label>${esc(t('onb.step4.ecg'))}</label>
          <input type="date" id="onb-ecg" />
        </div>
        <div class="form-group">
          <label>${esc(t('onb.step4.fleet'))}</label>
          <input type="text" id="onb-fleet" placeholder="${esc(t('onb.step4.fleetPlaceholder'))}" />
        </div>
      </div>
      <p style="font-size:12px; color:var(--text-muted); margin-top:var(--s-3); line-height:1.5;">
        ${esc(t('onb.step4.optional'))}
      </p>
    `;
    if (onbData.license) document.getElementById('onb-license').value = onbData.license;
    if (onbData.medical) document.getElementById('onb-medical').value = onbData.medical;
    if (onbData.ecg) document.getElementById('onb-ecg').value = onbData.ecg;
    if (onbData.fleet) document.getElementById('onb-fleet').value = onbData.fleet;
  }

  // ─── Step 5: Navblue iCal (conditional — Porter only) ─────────────
  else if (onbStep === 5) {
    body.innerHTML = `
      <p style="font-size:14px; color:var(--text-secondary); margin-bottom:var(--s-4); line-height:1.55;">
        ${t('onb.step5.introHtml')}
      </p>
      <div class="form-group">
        <label>${esc(t('onb.step5.url'))}</label>
        <input type="url" id="onb-navblue"
               placeholder="${esc(t('onb.step5.urlPlaceholder'))}"
               style="font-family:var(--font-mono); font-size:12px; height:44px;" />
        <div style="font-size:11px; color:var(--text-muted); margin-top:4px; line-height:1.5;">
          ${t('onb.step5.urlHintHtml')}
        </div>
      </div>
      <div style="margin-top:var(--s-4); padding:var(--s-3); background:var(--bg-subtle); border-radius:var(--r-sm); font-size:12px; color:var(--text-secondary); line-height:1.6;">
        ${t('onb.step5.howtoHtml')}
      </div>
    `;
    if (onbData.navblueUrl) document.getElementById('onb-navblue').value = onbData.navblueUrl;
  }

  // ─── Step 6: Column preset ────────────────────────────────────────
  else if (onbStep === 6) {
    body.innerHTML = `
      <p style="font-size:14px; color:var(--text-secondary); margin-bottom:var(--s-4); line-height:1.55;">
        ${esc(t('onb.step6.intro'))}
      </p>
      <div style="display:flex; flex-direction:column; gap:var(--s-2);">
        <label class="col-option is-on" style="padding:var(--s-4); display:flex; gap:var(--s-3); align-items:flex-start;">
          <input type="radio" name="onb-preset" value="compact" checked
                 style="appearance:none;-webkit-appearance:none;width:18px;height:18px;border:1.5px solid var(--accent);border-radius:50%;flex-shrink:0;margin-top:2px;background:radial-gradient(circle, var(--accent) 0% 50%, transparent 50%);" />
          <div>
            <div style="font-weight:600; font-size:14px;">${esc(t('onb.step6.compact'))}</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${esc(t('onb.step6.compactDesc'))}</div>
          </div>
        </label>
        <label class="col-option" style="padding:var(--s-4); display:flex; gap:var(--s-3); align-items:flex-start;">
          <input type="radio" name="onb-preset" value="atpl"
                 style="appearance:none;-webkit-appearance:none;width:18px;height:18px;border:1.5px solid var(--border-strong);border-radius:50%;flex-shrink:0;margin-top:2px;" />
          <div>
            <div style="font-weight:600; font-size:14px;">${esc(t('onb.step6.atpl'))}</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${esc(t('onb.step6.atplDesc'))}</div>
          </div>
        </label>
        <label class="col-option" style="padding:var(--s-4); display:flex; gap:var(--s-3); align-items:flex-start;">
          <input type="radio" name="onb-preset" value="all"
                 style="appearance:none;-webkit-appearance:none;width:18px;height:18px;border:1.5px solid var(--border-strong);border-radius:50%;flex-shrink:0;margin-top:2px;" />
          <div>
            <div style="font-weight:600; font-size:14px;">${esc(t('onb.step6.all'))}</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${esc(t('onb.step6.allDesc'))}</div>
          </div>
        </label>
      </div>
    `;
    if (onbData.columnPreset) {
      const r = document.querySelector(`input[name="onb-preset"][value="${onbData.columnPreset}"]`);
      if (r) r.checked = true;
    }
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
