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
// Field schema mirrors TC paper logbook TP 13076 (Personal Pilot
// Logbook). Pilots think in terms of "PIC carrière · SIC carrière ·
// Night carrière" — not "ME Day PIC" et al. (those are per-flight
// breakdowns derived from each leg). So the modal asks for the
// AGGREGATE totals the pilot already keeps as running figures, stores
// them under the same keys calcStats() produces (pic, sic, night, xc,
// total, etc), and totalsWithOpening() just adds them straight in.
//
// Storage keys (localStorage):
//   cumulo_opening_balances_v1  → { balances, attestedAt, hash }
//   cumulo_opening_attest_log_v1 → append-only array of attestations
// ═══════════════════════════════════════════════════════════════════

const OPENING_BALANCES_KEY = 'cumulo_opening_balances_v1';
const OPENING_ATTEST_LOG_KEY = 'cumulo_opening_attest_log_v1';

// ─── Field schema (in user-meaningful order) ─────────────────────────
// Each entry uses AGGREGATE storage keys that match calcStats() output.
// `hero: true` means it gets a bigger input (the Total carrière).
// `integer: true` means count, not hours (landings, take-offs, approaches).
// `desc{En,Fr}` is rendered as help-text under each group.
function _bfGroups() {
  return [
    {
      id: 'main',
      titleEn: 'Career flight time',
      titleFr: 'Temps de vol — carrière',
      descEn: 'The single biggest number in your paper logbook: total flight time as of today. This is what TC inspectors look at first.',
      descFr: 'Le plus gros chiffre de votre carnet papier : temps de vol total à ce jour. C\'est ce que TC regarde en premier.',
      fields: [
        { key: 'total', labelEn: 'Total Flight Time', labelFr: 'Temps de vol total', hero: true },
      ],
    },
    {
      id: 'crew',
      titleEn: 'By crew position',
      titleFr: 'Par position d\'équipage',
      descEn: 'How most pilots actually track their hours — PIC, SIC, instruction received, instruction given.',
      descFr: 'Comment les pilotes calculent leurs heures dans la vraie vie — PIC, SIC, instruction reçue, instruction donnée.',
      fields: [
        { key: 'pic',       labelEn: 'PIC — Pilot in Command',           labelFr: 'PIC — Pilote aux commandes' },
        { key: 'sic',       labelEn: 'SIC — Co-Pilot / Second',          labelFr: 'SIC — Co-pilote / Second' },
        { key: 'picus',     labelEn: 'PICUS — PIC under supervision',    labelFr: 'PICUS — PIC sous supervision' },
        { key: 'dualGiven', labelEn: 'Dual Given (instructor)',          labelFr: 'Instruction donnée (CFI)' },
      ],
    },
    {
      id: 'cond',
      titleEn: 'Conditions',
      titleFr: 'Conditions de vol',
      descEn: 'Night and cross-country are tracked as separate cumulatives in every TC logbook.',
      descFr: 'Nuit et voyage sont suivis comme totaux séparés dans tout carnet TC.',
      fields: [
        { key: 'night', labelEn: 'Night',         labelFr: 'Nuit' },
        { key: 'xc',    labelEn: 'Cross-Country', labelFr: 'Voyage (XC)' },
      ],
    },
    {
      id: 'inst',
      titleEn: 'Instrument time',
      titleFr: 'Temps aux instruments',
      descEn: 'Time on instruments only. Brought-forward IFR time does NOT affect your 6-approaches-in-6-months currency — only flights logged in Cumulo count for that.',
      descFr: 'Temps aux instruments uniquement. Le temps IFR reporté n\'affecte PAS votre validité 6-approches-en-6-mois — seuls les vols enregistrés dans Cumulo comptent.',
      fields: [
        { key: 'instActual', labelEn: 'Actual (IMC)',                    labelFr: 'Réel (IMC)' },
        { key: 'instHood',   labelEn: 'Hood (in flight, view-limiting)', labelFr: 'Cagoule (en vol)' },
        { key: 'instSim',    labelEn: 'FFS / FTD (ground simulator)',    labelFr: 'FFS / FTD (simulateur sol)' },
      ],
    },
    {
      id: 'tol',
      titleEn: 'Take-offs & Landings',
      titleFr: 'Décollages & atterrissages',
      descEn: 'Count, not hours. Brought-forward landings do NOT affect 5-in-6-month recency.',
      descFr: 'Compte, pas heures. Les atterrissages reportés n\'affectent PAS la validité 5/6mois.',
      fields: [
        { key: 'toDay',    labelEn: 'T/O — Day',    labelFr: 'Déc. — Jour',  integer: true },
        { key: 'toNight',  labelEn: 'T/O — Night',  labelFr: 'Déc. — Nuit',  integer: true },
        { key: 'ldgDay',   labelEn: 'Landings — Day',   labelFr: 'Att. — Jour',  integer: true },
        { key: 'ldgNight', labelEn: 'Landings — Night', labelFr: 'Att. — Nuit',  integer: true },
      ],
    },
    {
      id: 'class',
      titleEn: 'Aircraft class (optional)',
      titleFr: 'Classe d\'aéronef (optionnel)',
      descEn: 'Fill these ONLY if your paper logbook tracked Multi-Engine, Helicopter, or Hover time as separate cumulatives. Leave blank otherwise — most ATPL pilots already have ME captured via PIC + SIC above.',
      descFr: 'Remplir SEULEMENT si votre carnet papier suivait Multi-moteur, Hélicoptère ou Vol stationnaire comme totaux distincts. Sinon laisser vide — la plupart des pilotes ATPL ont déjà leur ME dans PIC + SIC ci-dessus.',
      collapsed: true,
      fields: [
        { key: 'me',    labelEn: 'Multi-Engine — all positions',  labelFr: 'Multi-moteur — toutes positions' },
        { key: 'heli',  labelEn: 'Helicopter — all positions',    labelFr: 'Hélicoptère — toutes positions' },
        { key: 'hover', labelEn: 'Hover Time (helicopter only)',  labelFr: 'Vol stationnaire' },
      ],
    },
  ];
}

// All keys the modal can write to. Used by commitOpeningBalances when
// collecting values back from the form.
function _bfAllKeys() {
  const out = [];
  _bfGroups().forEach(g => g.fields.forEach(f => out.push(f.key)));
  return out;
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
    balances: clean,
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
  const lang = (typeof getLang === 'function') ? getLang() : 'en';
  const dateStr = attestedAt
    ? new Date(attestedAt).toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';
  return lang === 'fr'
    ? `${fmtted} hrs reportées · attestées ${dateStr}`
    : `${fmtted} hrs carried forward · attested ${dateStr}`;
}

// ───────────────────────────────────────────────────────────────────
// UI — Settings section + editor modal
// ───────────────────────────────────────────────────────────────────

// Render the Brought-forward section inside Settings → Profile pane.
function renderOpeningBalancesSection(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const hasAny = hasOpeningBalances();
  const summary = openingBalanceSummary();

  const summaryHtml = hasAny
    ? `<div style="font-size:13px;color:var(--text);"><strong>${esc(summary)}</strong></div>
       <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${
         fr
           ? 'Modifier exige une nouvelle attestation. L\'ancienne est archivée dans le journal d\'audit.'
           : 'Editing requires a new attestation. The previous one is archived in the audit log.'
       }</div>`
    : `<div style="font-size:13px;color:var(--text-secondary);line-height:1.55;">${
         fr
           ? 'Aucun total reporté déclaré. Si vous avez un carnet papier ou un ancien système électronique, déclarez vos totaux ici. Ils s\'ajouteront aux vols Cumulo sur le Tableau de bord, le Carnet et l\'export PDF TC.'
           : 'No brought-forward totals declared. If you have a paper logbook or a prior electronic system, declare your cumulative totals here. They\'ll be added to in-Cumulo flights on the Dashboard, Logbook table and TC PDF export.'
       }</div>`;

  const ctaLabel = hasAny
    ? (fr ? 'Modifier les heures reportées' : 'Edit brought-forward totals')
    : (fr ? 'Déclarer les heures reportées'  : 'Declare brought-forward totals');
  const ctaClass = hasAny ? 'btn btn-outline' : 'btn btn-primary';
  const cardTitle = fr ? 'Heures reportées (carnet papier)' : 'Brought-forward hours (paper logbook)';

  el.innerHTML = `
    <div class="form-card-title">${esc(cardTitle)}</div>
    ${summaryHtml}
    <div style="display:flex;gap:var(--s-2);margin-top:var(--s-4);flex-wrap:wrap;">
      <button class="${ctaClass}" onclick="openOpeningBalancesEditor()">${esc(ctaLabel)}</button>
    </div>
  `;
}

// Open the editor modal. Renders the bf field schema grouped by section,
// with values pre-filled from the current record.
function openOpeningBalancesEditor() {
  const { balances } = loadOpeningBalances();
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const profile = (typeof DB !== 'undefined' && DB.loadProfile) ? DB.loadProfile() : {};
  const pilotType = profile.pilotType || 'airline705';

  // Helicopter section default-expanded when the pilot is a heli pilot
  // OR they've already declared heli hours (so editing finds them visible).
  const heliRelevant = pilotType === 'helicopter'
    || (+balances.heli || 0) > 0 || (+balances.hover || 0) > 0;

  const groupsHtml = _bfGroups().map(g => {
    const title = fr ? g.titleFr : g.titleEn;
    const desc  = fr ? g.descFr  : g.descEn;
    // Force-expand the "class" group when heli is relevant; otherwise honor g.collapsed.
    const collapsed = g.collapsed && !(g.id === 'class' && heliRelevant);
    const fieldsHtml = g.fields.map(f => {
      const label = fr ? f.labelFr : f.labelEn;
      const step  = f.integer ? '1' : '0.1';
      const ph    = f.integer ? '0' : '0.0';
      const value = balances[f.key] != null ? balances[f.key] : '';
      const heroCls = f.hero ? ' bf-hero-input' : '';
      return `
        <div class="form-group bf-field${f.hero ? ' bf-hero-field' : ''}">
          <label for="ob-${f.key}">${esc(label)}</label>
          <input type="number" id="ob-${esc(f.key)}" min="0" step="${step}"
                 value="${esc(value)}" placeholder="${ph}" inputmode="decimal"
                 class="bf-input${heroCls}" />
        </div>`;
    }).join('');

    const descHtml = desc
      ? `<div class="bf-group-desc">${esc(desc)}</div>`
      : '';

    return `
      <details class="bf-group" ${collapsed ? '' : 'open'}>
        <summary class="bf-group-summary">
          <span class="bf-group-title">${esc(title)}</span>
          <svg class="bf-group-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </summary>
        ${descHtml}
        <div class="bf-fields-grid${g.id === 'main' ? ' bf-fields-hero' : ''}">${fieldsHtml}</div>
      </details>`;
  }).join('');

  const profileName = `${profile.fname || ''} ${profile.lname || ''}`.trim();
  const todayStr = new Date().toLocaleDateString(fr ? 'fr-CA' : 'en-CA',
    { year: 'numeric', month: 'long', day: 'numeric' });

  const overlay = document.createElement('div');
  overlay.className = 'import-overlay show';
  overlay.id = '_obEditorOverlay';
  overlay.innerHTML = `
    <div class="import-modal bf-modal" style="max-width:780px;">
      <div class="import-modal-head">
        <div>
          <div class="eyebrow" style="margin-bottom:4px;">${esc(fr ? 'CARNET PAPIER · CAR 401.08(2)(H)' : 'PAPER LOGBOOK · CAR 401.08(2)(H)')}</div>
          <div class="t-title-2">${esc(fr ? 'Déclarer vos heures reportées' : 'Declare your brought-forward hours')}</div>
          <div style="font-size:12.5px;color:var(--text-secondary);margin-top:6px;line-height:1.5;max-width:560px;">
            ${esc(fr
              ? 'Entrez seulement les totaux que vous suiviez dans votre carnet papier. Laissez vide ce qui ne s\'applique pas — le total brut suffit pour la plupart des pilotes. Les vols Cumulo s\'ajoutent par-dessus.'
              : 'Enter only the totals you actually tracked in your paper logbook. Leave anything that doesn\'t apply blank — the raw total is enough for most pilots. Cumulo flights add on top.')}
          </div>
        </div>
        <button class="icon-btn" onclick="document.getElementById('_obEditorOverlay').remove()" aria-label="Close" title="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="import-modal-body">
        ${groupsHtml}
        <div class="bf-attest">
          <div class="bf-attest-title">${esc(fr ? 'Attestation (CAR 401.08(2)(h))' : 'Attestation (CAR 401.08(2)(h))')}</div>
          <div class="bf-attest-desc">
            ${fr
              ? `En cochant, vous confirmez que ces totaux reflètent fidèlement votre carnet papier au <strong>${esc(todayStr)}</strong>. Stocké localement avec un hash SHA-256 pour l\'intégrité. Modifier exigera une nouvelle attestation ; l\'ancienne sera archivée dans le journal d\'audit.`
              : `By attesting, you confirm these totals accurately reflect your paper logbook as of <strong>${esc(todayStr)}</strong>. Stored locally with a SHA-256 hash for integrity. Editing later requires a new attestation; the prior one is archived in the audit log.`}
          </div>
          <label class="col-option" style="margin:var(--s-3) 0;">
            <input type="checkbox" id="ob-attest-chk" />
            <span class="col-option-label">${esc(fr
              ? 'J\'atteste que ces totaux correspondent à mon carnet papier au jour d\'aujourd\'hui.'
              : 'I attest these totals match my paper logbook as of today.')}</span>
          </label>
          <div class="form-group">
            <label for="ob-attest-name">${esc(fr ? 'Nom complet (signature dactylographiée)' : 'Full name (typed signature)')}</label>
            <input type="text" id="ob-attest-name" placeholder="${esc(profileName || (fr ? 'Tapez votre nom complet' : 'Type your full name'))}" style="font-family:var(--font-mono);" />
          </div>
        </div>
      </div>
      <div class="import-modal-foot">
        <button class="btn btn-ghost" onclick="document.getElementById('_obEditorOverlay').remove()">${esc(fr ? 'Annuler' : 'Cancel')}</button>
        <button class="btn btn-primary" onclick="commitOpeningBalances()">${esc(fr ? 'Sauvegarder & attester' : 'Save & attest')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

// Validate attestation, collect inputs, persist + audit. Called from the modal Save button.
async function commitOpeningBalances() {
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const attest = document.getElementById('ob-attest-chk');
  const nameEl = document.getElementById('ob-attest-name');
  if (!attest || !attest.checked) {
    if (typeof showToast === 'function') showToast(
      fr ? 'Cochez la case d\'attestation pour confirmer que ces totaux correspondent à votre carnet papier.'
         : 'Check the attestation box to confirm these totals match your paper logbook.',
      'error');
    return;
  }
  const typedName = (nameEl && nameEl.value || '').trim();
  if (!typedName) {
    if (typeof showToast === 'function') showToast(
      fr ? 'Tapez votre nom complet pour signer l\'attestation.'
         : 'Type your full name to sign the attestation.',
      'error');
    return;
  }
  const profile = (typeof DB !== 'undefined' && DB.loadProfile) ? DB.loadProfile() : {};
  const expectedName = `${profile.fname || ''} ${profile.lname || ''}`.trim();
  if (expectedName && typedName.toLowerCase() !== expectedName.toLowerCase()) {
    const msg = fr
      ? `Le nom saisi ("${typedName}") ne correspond pas à votre profil ("${expectedName}"). Enregistrer quand même ?`
      : `The name you typed ("${typedName}") doesn't match your profile name ("${expectedName}"). Save anyway?`;
    if (!confirm(msg)) return;
  }

  // Collect values from each input. Zero / empty → not persisted (sparse).
  const balances = {};
  _bfAllKeys().forEach(k => {
    const el = document.getElementById('ob-' + k);
    if (!el) return;
    const v = +el.value || 0;
    if (v > 0) balances[k] = v;
  });
  // Mirror Total → Block so the Logbook table footer's "Flight Time" column
  // and the Dashboard hero (which prefers s.block) both reflect brought-forward.
  // The two are equivalent for career-totals purposes (pilots write a single
  // running total in their paper logbook — they don't track block separately
  // until they fly the next leg in Cumulo).
  if ((+balances.total || 0) > 0 && !(+balances.block || 0)) {
    balances.block = balances.total;
  }

  try {
    await saveOpeningBalances(balances);
  } catch (e) {
    console.error('[OpeningBalances] save failed:', e);
    if (typeof showToast === 'function') showToast(
      fr ? 'Échec de la sauvegarde. Voir la console.' : 'Could not save brought-forward totals. Check the console.',
      'error');
    return;
  }

  const ov = document.getElementById('_obEditorOverlay');
  if (ov) ov.remove();
  if (typeof showToast === 'function') showToast(
    fr ? 'Totaux reportés attestés et sauvegardés.' : 'Brought-forward totals attested and saved.',
    'success');

  // Refresh visible surfaces that show these totals.
  if (typeof renderDashboard === 'function') renderDashboard();
  if (typeof renderLogbook === 'function') renderLogbook(typeof filterVal !== 'undefined' ? (filterVal || '') : '');
  renderOpeningBalancesSection('openingBalancesSection');
}
