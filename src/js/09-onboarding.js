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
  if (!confirm(t('onb.skipConfirm'))) return;
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
      showToast(t('onb.nameRequired'), 'error');
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
  const titleKeys = {
    1: 'onb.step1.title',
    2: 'onb.step2.title',
    3: 'onb.step3.title',
    4: 'onb.step4.title'
  };
  document.getElementById('onbStepTitle').textContent = t(titleKeys[onbStep]);

  const body = document.getElementById('onbBody');
  const backBtn = document.getElementById('onbBackBtn');
  const nextBtn = document.getElementById('onbNextBtn');
  backBtn.style.display = onbStep > 1 ? 'inline-flex' : 'none';
  backBtn.textContent = t('onb.back');
  nextBtn.textContent = onbStep < 4 ? t('onb.continue') : t('onb.finish');

  if (onbStep === 1) {
    body.innerHTML = `
      <p style="font-size:14px; color:var(--text-secondary); margin-bottom:var(--s-4); line-height:1.55;">
        ${esc(t('onb.step1.intro'))}
      </p>
      <div class="form-grid" style="gap:var(--s-3);">
        <div class="form-group">
          <label>${esc(t('onb.step1.fname'))}</label>
          <input type="text" id="onb-fname" placeholder="Martin" autofocus />
        </div>
        <div class="form-group">
          <label>${esc(t('onb.step1.lname'))}</label>
          <input type="text" id="onb-lname" placeholder="Daoust" />
        </div>
        <div class="form-group">
          <label>${esc(t('onb.step1.rank'))}</label>
          <select id="onb-rank">
            <option value="F/O">${esc(t('onb.rank.fo'))}</option>
            <option value="Capt">${esc(t('onb.rank.capt'))}</option>
            <option value="SIC">${esc(t('onb.rank.sic'))}</option>
            <option value="PIC">${esc(t('onb.rank.pic'))}</option>
            <option value="Student">${esc(t('onb.rank.student'))}</option>
            <option value="Instructor">${esc(t('onb.rank.instructor'))}</option>
          </select>
        </div>
        <div class="form-group">
          <label>${esc(t('onb.step1.base'))}</label>
          <input type="text" id="onb-base" placeholder="YOW" maxlength="4" style="text-transform:uppercase;" />
        </div>
        <div class="form-group col-span-2">
          <label>${esc(t('onb.step1.airline'))}</label>
          <input type="text" id="onb-airline" placeholder="Porter Airlines" />
        </div>
        <div class="form-group col-span-2">
          <label>${esc(t('onb.step1.codes'))}</label>
          <input type="text" id="onb-codes" placeholder="PD" value="PD" style="font-family:var(--font-mono);text-transform:uppercase;" />
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
            ${t('onb.step1.codesHintHtml')}
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
        ${esc(t('onb.step2.intro'))}
      </p>
      <div class="form-grid" style="gap:var(--s-3);">
        <div class="form-group col-span-2">
          <label>${esc(t('onb.step2.license'))}</label>
          <input type="text" id="onb-license" placeholder="A123456" style="font-family:var(--font-mono);" />
        </div>
        <div class="form-group">
          <label>${esc(t('onb.step2.medical'))}</label>
          <input type="date" id="onb-medical" />
        </div>
        <div class="form-group">
          <label>${esc(t('onb.step2.fleet'))}</label>
          <input type="text" id="onb-fleet" placeholder="E195-E2" />
        </div>
      </div>
      <p style="font-size:12px; color:var(--text-muted); margin-top:var(--s-3); line-height:1.5;">
        ${esc(t('onb.step2.optional'))}
      </p>
    `;
    if (onbData.license) document.getElementById('onb-license').value = onbData.license;
    if (onbData.medical) document.getElementById('onb-medical').value = onbData.medical;
    if (onbData.fleet) document.getElementById('onb-fleet').value = onbData.fleet;
  } else if (onbStep === 3) {
    body.innerHTML = `
      <p style="font-size:14px; color:var(--text-secondary); margin-bottom:var(--s-4); line-height:1.55;">
        ${t('onb.step3.introHtml')}
      </p>
      <div class="form-group">
        <label>${esc(t('onb.step3.url'))}</label>
        <input type="url" id="onb-navblue"
               placeholder="webcal://poe.noc.vmc.navblue.cloud/RaidoMobile/RosterCalendarDownloader.ashx?Id=..."
               style="font-family:var(--font-mono); font-size:11px;" />
      </div>
      <div style="margin-top:var(--s-4); padding:var(--s-3); background:var(--bg-subtle); border-radius:var(--r-sm); font-size:12px; color:var(--text-secondary); line-height:1.6;">
        ${t('onb.step3.howtoHtml')}
      </div>
    `;
    if (onbData.navblueUrl) document.getElementById('onb-navblue').value = onbData.navblueUrl;
  } else if (onbStep === 4) {
    body.innerHTML = `
      <p style="font-size:14px; color:var(--text-secondary); margin-bottom:var(--s-4); line-height:1.55;">
        ${esc(t('onb.step4.intro'))}
      </p>
      <div style="display:flex; flex-direction:column; gap:var(--s-2);">
        <label class="col-option is-on" style="padding:var(--s-4); display:flex; gap:var(--s-3); align-items:flex-start;">
          <input type="radio" name="onb-preset" value="compact" checked
                 style="appearance:none;-webkit-appearance:none;width:18px;height:18px;border:1.5px solid var(--accent);border-radius:50%;flex-shrink:0;margin-top:2px;background:radial-gradient(circle, var(--accent) 0% 50%, transparent 50%);" />
          <div>
            <div style="font-weight:600; font-size:14px;">${esc(t('onb.step4.compact'))}</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${esc(t('onb.step4.compactDesc'))}</div>
          </div>
        </label>
        <label class="col-option" style="padding:var(--s-4); display:flex; gap:var(--s-3); align-items:flex-start;">
          <input type="radio" name="onb-preset" value="atpl"
                 style="appearance:none;-webkit-appearance:none;width:18px;height:18px;border:1.5px solid var(--border-strong);border-radius:50%;flex-shrink:0;margin-top:2px;" />
          <div>
            <div style="font-weight:600; font-size:14px;">${esc(t('onb.step4.atpl'))}</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${esc(t('onb.step4.atplDesc'))}</div>
          </div>
        </label>
        <label class="col-option" style="padding:var(--s-4); display:flex; gap:var(--s-3); align-items:flex-start;">
          <input type="radio" name="onb-preset" value="all"
                 style="appearance:none;-webkit-appearance:none;width:18px;height:18px;border:1.5px solid var(--border-strong);border-radius:50%;flex-shrink:0;margin-top:2px;" />
          <div>
            <div style="font-weight:600; font-size:14px;">${esc(t('onb.step4.all'))}</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${esc(t('onb.step4.allDesc'))}</div>
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

