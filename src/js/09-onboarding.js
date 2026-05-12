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

