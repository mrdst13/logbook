// ═══════════════════════════════════════════════════════════════════
// OPENING BALANCES (brought-forward hours from a paper logbook)
// ═══════════════════════════════════════════════════════════════════
// Standard aviation pattern: a pilot transitioning from a paper logbook
// to an electronic one declares their cumulative totals as a starting
// balance, attests once that the totals match their paper book, then
// logs new flights forward. The Dashboard, Logbook table footer, and
// TC PDF cover all show "brought forward + Cumulo flights = cumulative".
//
// TC compliance: TP 14052 explicitly supports "brought forward" /
// "previous balance" entries. CAR 401.08(2)(h) requires the pilot to
// attest the entries. We persist the attestation timestamp + a SHA-256
// hash of the values for integrity; any change to the balances requires
// a new attestation, and the prior one is archived in an append-only
// audit log.
//
// Storage keys (localStorage):
//   cumulo_opening_balances_v1  → { balances, attestedAt, hash }
//   cumulo_opening_attest_log_v1 → append-only array of attestations
// ═══════════════════════════════════════════════════════════════════

const OPENING_BALANCES_KEY = 'cumulo_opening_balances_v1';
const OPENING_ATTEST_LOG_KEY = 'cumulo_opening_attest_log_v1';

// Which logbook columns are numeric and accumulate (i.e. can have a
// brought-forward value). Excludes text fields (date, reg, pic, etc.),
// booleans (isSim, multiCrew), and config strings (simType, acConfig).
function getOpeningBalanceColumns() {
  if (typeof LOGBOOK_COLUMNS === 'undefined') return [];
  const integerCounters = new Set(['ldgDay', 'ldgNight', 'approaches', 'toDay', 'toNight']);
  return LOGBOOK_COLUMNS.filter(c => c.decimal === true || integerCounters.has(c.key));
}

// Load the current opening-balances record. Always returns a valid shape.
function loadOpeningBalances() {
  try {
    const raw = localStorage.getItem(OPENING_BALANCES_KEY);
    if (!raw) return { balances: {}, attestedAt: null, hash: null };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.balances) {
      return { balances: {}, attestedAt: null, hash: null };
    }
    return parsed;
  } catch {
    return { balances: {}, attestedAt: null, hash: null };
  }
}

// Quick accessor: how much was brought-forward for a given column key.
// Returns 0 if not set. Safe to call before any opening balance is declared.
function getOpening(key) {
  const { balances } = loadOpeningBalances();
  return +balances[key] || 0;
}

// True if the pilot has declared at least one non-zero opening balance.
function hasOpeningBalances() {
  const { balances } = loadOpeningBalances();
  return Object.values(balances).some(v => +v > 0);
}

// SHA-256 hex digest of the canonical JSON form of the balances object.
// Canonical = keys sorted alphabetically, no whitespace. Used for integrity.
async function _hashBalances(balances) {
  const sortedKeys = Object.keys(balances).sort();
  const canonical = JSON.stringify(balances, sortedKeys);
  const buf = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Persist the balances + attestation metadata + append to audit log.
async function saveOpeningBalances(balances) {
  // Strip zero values — sparse storage. Pilot saw "0" and didn't fill = noop.
  const clean = {};
  Object.keys(balances).forEach(k => {
    const v = +balances[k];
    if (v > 0) clean[k] = v;
  });
  const hash = await _hashBalances(clean);
  const attestedAt = new Date().toISOString();
  const record = { balances: clean, attestedAt, hash };
  localStorage.setItem(OPENING_BALANCES_KEY, JSON.stringify(record));

  // Append to audit log (immutable history of every attestation)
  let log = [];
  try { log = JSON.parse(localStorage.getItem(OPENING_ATTEST_LOG_KEY) || '[]'); } catch { log = []; }
  if (!Array.isArray(log)) log = [];
  log.push({
    timestamp: attestedAt,
    hash,
    action: log.length === 0 ? 'attest' : 're-attest',
    balances: clean
  });
  try { localStorage.setItem(OPENING_ATTEST_LOG_KEY, JSON.stringify(log)); } catch {}

  return record;
}

// Merge opening balances into a totals object (Dashboard hero, Logbook footer).
// Returns a NEW object — never mutates input.
function totalsWithOpening(flightsTotals) {
  const { balances } = loadOpeningBalances();
  const merged = { ...flightsTotals };
  Object.keys(balances).forEach(key => {
    merged[key] = (+merged[key] || 0) + (+balances[key] || 0);
  });
  return merged;
}

// Returns a short human-readable string describing the opening balance,
// e.g. "1,234.5 hrs total carried forward — last attested 2026-05-21".
// Used on Dashboard hero sub-line + Settings section summary.
function openingBalanceSummary() {
  const { balances, attestedAt } = loadOpeningBalances();
  const total = +balances.total || +balances.block || 0;
  if (total <= 0) return null;
  const fmtted = typeof fmt === 'function' ? fmt(total) : total.toFixed(1);
  const dateStr = attestedAt
    ? new Date(attestedAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';
  return `${fmtted} hrs carried forward · attested ${dateStr}`;
}

// ───────────────────────────────────────────────────────────────────
// UI — Settings section + editor modal
// ───────────────────────────────────────────────────────────────────

// Render the Brought-forward section inside Settings → Profile pane.
function renderOpeningBalancesSection(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const { attestedAt } = loadOpeningBalances();
  const hasAny = hasOpeningBalances();
  const summary = openingBalanceSummary();

  const summaryHtml = hasAny
    ? `<div style="font-size:13px;color:var(--text);"><strong>${esc(summary)}</strong></div>
       <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Editing requires a new attestation. The previous attestation is archived in the audit log.</div>`
    : `<div style="font-size:13px;color:var(--text-secondary);line-height:1.5;">No brought-forward totals declared. If you have prior flight time from a paper logbook (or another electronic system you're migrating from), declare the cumulative totals here. They'll be added to in-app flights on the Dashboard, Logbook table, and TC PDF export.</div>`;

  const ctaLabel = hasAny ? 'Edit brought-forward totals' : 'Declare brought-forward totals';
  const ctaClass = hasAny ? 'btn btn-outline' : 'btn btn-primary';

  el.innerHTML = `
    <div class="form-card-title" data-i18n="profile.section.opening">Brought-forward hours (paper logbook)</div>
    ${summaryHtml}
    <div style="display:flex;gap:var(--s-2);margin-top:var(--s-4);flex-wrap:wrap;">
      <button class="${ctaClass}" onclick="openOpeningBalancesEditor()">${esc(ctaLabel)}</button>
    </div>
  `;
}

// Open the editor modal. Renders the full numeric-column form grouped by
// LOGBOOK_COLUMNS.group, with values pre-filled from the current record.
function openOpeningBalancesEditor() {
  const { balances } = loadOpeningBalances();
  const cols = getOpeningBalanceColumns();
  const groups = {};
  cols.forEach(c => {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });

  const groupsHtml = Object.entries(groups).map(([group, cs]) => `
    <div style="margin-bottom:var(--s-5);">
      <div class="eyebrow" style="margin-bottom:var(--s-2);">${esc(group)}</div>
      <div class="form-grid" style="gap:var(--s-3);">
        ${cs.map(c => `
          <div class="form-group">
            <label for="ob-${c.key}">${esc(c.label)}</label>
            <input type="number" id="ob-${c.key}" min="0" step="${c.decimal ? '0.1' : '1'}"
                   value="${balances[c.key] != null ? balances[c.key] : ''}" placeholder="0" inputmode="decimal"
                   style="font-family:var(--font-mono); text-align:right;" />
          </div>`).join('')}
      </div>
    </div>
  `).join('');

  const profile = (typeof DB !== 'undefined' && DB.loadProfile) ? DB.loadProfile() : {};
  const profileName = `${profile.fname || ''} ${profile.lname || ''}`.trim();
  const todayStr = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  const overlay = document.createElement('div');
  overlay.className = 'import-overlay show';
  overlay.id = '_obEditorOverlay';
  overlay.innerHTML = `
    <div class="import-modal" style="max-width:880px;">
      <div class="import-modal-head">
        <div>
          <div class="t-headline">Brought-forward hours</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;line-height:1.5;">
            Declare your cumulative totals from a paper logbook. Leave a field empty (or 0) if not applicable. Saved values are added to Cumulo flights on the Dashboard, Logbook, and TC PDF export.
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('_obEditorOverlay').remove()">Close</button>
      </div>
      <div class="import-modal-body">
        ${groupsHtml}
        <div class="form-card" style="padding:var(--s-5);background:var(--bg-subtle);border:1px solid var(--accent);">
          <div class="t-headline" style="margin-bottom:var(--s-3);">Attestation (CAR 401.08(2)(h))</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:var(--s-3);line-height:1.5;">
            By attesting, you confirm these brought-forward totals accurately reflect the entries in your prior paper logbook as of <strong>${esc(todayStr)}</strong>. This attestation is stored locally with a SHA-256 hash for integrity. Editing later requires a new attestation; the prior one is archived in the audit log.
          </div>
          <label class="col-option" style="margin-bottom:var(--s-3);">
            <input type="checkbox" id="ob-attest-chk" />
            <span class="col-option-label">I attest these totals match my paper logbook as of today.</span>
          </label>
          <div class="form-group">
            <label for="ob-attest-name">Full name (typed signature)</label>
            <input type="text" id="ob-attest-name" placeholder="${esc(profileName || 'Type your full name')}" style="font-family:var(--font-mono);" />
          </div>
        </div>
      </div>
      <div class="import-modal-foot">
        <button class="btn btn-ghost" onclick="document.getElementById('_obEditorOverlay').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="commitOpeningBalances()">Save &amp; attest</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

// Validate attestation, collect inputs, persist + audit. Called from the modal Save button.
async function commitOpeningBalances() {
  const attest = document.getElementById('ob-attest-chk');
  const nameEl = document.getElementById('ob-attest-name');
  if (!attest || !attest.checked) {
    if (typeof showToast === 'function') showToast('Check the attestation box to confirm these totals match your paper logbook.', 'error');
    return;
  }
  const typedName = (nameEl && nameEl.value || '').trim();
  if (!typedName) {
    if (typeof showToast === 'function') showToast('Type your full name to sign the attestation.', 'error');
    return;
  }
  const profile = (typeof DB !== 'undefined' && DB.loadProfile) ? DB.loadProfile() : {};
  const expectedName = `${profile.fname || ''} ${profile.lname || ''}`.trim();
  if (expectedName && typedName.toLowerCase() !== expectedName.toLowerCase()) {
    if (!confirm(`The name you typed ("${typedName}") doesn't match your profile name ("${expectedName}"). Save anyway?`)) return;
  }

  // Collect values from each input. Zero / empty → not persisted (sparse).
  const cols = getOpeningBalanceColumns();
  const balances = {};
  cols.forEach(c => {
    const v = +(document.getElementById('ob-' + c.key) || {}).value || 0;
    if (v > 0) balances[c.key] = v;
  });

  try {
    await saveOpeningBalances(balances);
  } catch (e) {
    console.error('[OpeningBalances] save failed:', e);
    if (typeof showToast === 'function') showToast('Could not save brought-forward totals. Check the console.', 'error');
    return;
  }

  const ov = document.getElementById('_obEditorOverlay');
  if (ov) ov.remove();
  if (typeof showToast === 'function') showToast('Brought-forward totals attested and saved.', 'success');

  // Refresh visible surfaces that show these totals.
  if (typeof renderDashboard === 'function') renderDashboard();
  if (typeof renderLogbook === 'function') renderLogbook(typeof filterVal !== 'undefined' ? (filterVal || '') : '');
  renderOpeningBalancesSection('openingBalancesSection');
}
