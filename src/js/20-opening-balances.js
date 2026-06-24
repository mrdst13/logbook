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
// Storage: keys match either calcStats() aggregate output keys (pic,
// sic, night, xc, me, heli, dualGiven, total, block …) OR raw
// LOGBOOK_COLUMNS per-flight keys (meDayPic, meNightPic, …). The
// totalsWithOpening() function handles both: aggregate keys are added
// directly; raw column keys also feed the derived aggregates so the
// Dashboard and TC PDF stay accurate even when only the detailed
// breakdown is entered.
//
// Storage keys (localStorage):
//   cumulo_opening_balances_v1  → { balances, attestedAt, hash }
//   cumulo_opening_attest_log_v1 → append-only array of attestations
// ═══════════════════════════════════════════════════════════════════

const OPENING_BALANCES_KEY = 'cumulo_opening_balances_v1';
const OPENING_ATTEST_LOG_KEY = 'cumulo_opening_attest_log_v1';

// ─── Page field schema ────────────────────────────────────────────
// Mirrors LOGBOOK_COLUMNS groups + adds top-level career aggregates.
// Pilot opens only the groups that match their paper logbook.
// key       → stored in balances{}; matched against calcStats() keys
//             or LOGBOOK_COLUMNS raw keys
// hero      → larger input (total flight time)
// integer   → count, not hours (landings, approaches)
// aggregate → this key maps directly to a calcStats() output key,
//             so totalsWithOpening() adds it directly without deriving
function _bfPageGroups() {
  return [
    // ── Top: career aggregates (most pilots fill only this section) ──
    {
      id: 'career',
      titleEn: 'Career totals',
      titleFr: 'Totaux carrière',
      descEn: 'The running totals from the bottom of your paper logbook. Fill these if you track PIC / SIC / Night as career aggregates. Leave blank if you prefer to fill the detailed breakdown below.',
      descFr: 'Les totaux cumulatifs du bas de votre carnet papier. Remplissez si vous suivez PIC / SIC / Nuit comme totaux carrière. Laissez vide si vous préférez le détail ci-dessous.',
      open: true,
      fields: [
        { key: 'total',      labelEn: 'Total Flight Time',         labelFr: 'Temps de vol total',        hero: true,  aggregate: true },
        { key: 'block',      labelEn: 'Block Time',                labelFr: 'Temps bloc',                             aggregate: true },
        { key: 'pic',        labelEn: 'PIC — Pilot in Command',    labelFr: 'PIC — Pilote aux commandes',             aggregate: true },
        { key: 'sic',        labelEn: 'SIC — Co-Pilot / Second',  labelFr: 'SIC — Co-pilote / Second',               aggregate: true },
        { key: 'picus',      labelEn: 'PICUS — PIC under supervision', labelFr: 'PICUS — PIC sous supervision',       aggregate: true },
        { key: 'night',      labelEn: 'Night',                     labelFr: 'Nuit',                                   aggregate: true },
        { key: 'xc',         labelEn: 'Cross-Country (XC)',        labelFr: 'Voyage (XC)',                            aggregate: true },
        { key: 'me',         labelEn: 'Multi-Engine',              labelFr: 'Multi-moteur',                           aggregate: true },
        { key: 'heli',       labelEn: 'Helicopter',                labelFr: 'Hélicoptère',                            aggregate: true },
        { key: 'dualGiven',  labelEn: 'Dual Given (instructor)',  labelFr: 'Instruction donnée (CFI)',                aggregate: true },
      ],
    },
    // ── Conditions ──
    {
      id: 'conditions',
      titleEn: 'Flight conditions',
      titleFr: 'Conditions de vol',
      descEn: 'Day / Night / VFR / IFR totals. Only fill if your paper logbook tracked these separately from the crew-position breakdown above.',
      descFr: 'Totaux Jour / Nuit / VFR / IFR. Remplir seulement si votre carnet papier les suivait séparément du détail position ci-dessus.',
      open: false,
      fields: [
        { key: 'day',        labelEn: 'Day',        labelFr: 'Jour' },
        // NOTE: 'night' intentionally lives ONLY in the Career-totals group
        // above. It used to be duplicated here, producing two inputs with the
        // same id="ob-night" — the value typed here was silently dropped on
        // save (getElementById returned the Career input). One field, one id.
        { key: 'vfr',        labelEn: 'VFR',        labelFr: 'VFR' },
        { key: 'ifr',        labelEn: 'IFR',        labelFr: 'IFR' },
        { key: 'duty',       labelEn: 'Duty Time',  labelFr: 'Temps de service' },
      ],
    },
    // ── Engine class (Standard 421) ──
    {
      id: 'engine',
      titleEn: 'Engine class',
      titleFr: 'Classe moteur',
      descEn: 'Per-position ME / SE breakdown (Standard 421). Use this if your previous logbook tracked ME Day PIC, ME Night SIC, etc. individually.',
      descFr: 'Détail ME / SE par position (Norme 421). Utilisez si votre carnet précédent distinguait ME Jour PIC, ME Nuit SIC, etc.',
      open: false,
      fields: [
        { key: 'seDay',       labelEn: 'SE Day',         labelFr: 'SE Jour' },
        { key: 'seNight',     labelEn: 'SE Night',       labelFr: 'SE Nuit' },
        { key: 'meDayPic',    labelEn: 'ME Day PIC',     labelFr: 'ME Jour PIC' },
        { key: 'meNightPic',  labelEn: 'ME Night PIC',   labelFr: 'ME Nuit PIC' },
        { key: 'meDayCop',    labelEn: 'ME Day SIC',     labelFr: 'ME Jour SIC' },
        { key: 'meNightCop',  labelEn: 'ME Night SIC',   labelFr: 'ME Nuit SIC' },
        { key: 'meDayDual',   labelEn: 'ME Day Dual',    labelFr: 'ME Jour Dual' },
        { key: 'meNightDual', labelEn: 'ME Night Dual',  labelFr: 'ME Nuit Dual' },
      ],
    },
    // ── Helicopter ──
    {
      id: 'heli',
      titleEn: 'Helicopter',
      titleFr: 'Hélicoptère',
      descEn: 'Rotorcraft time. Hover time is separate from total heli time.',
      descFr: 'Temps voilure tournante. Le vol stationnaire est distinct du total hélico.',
      open: false,
      fields: [
        { key: 'heliDayPic',    labelEn: 'Heli Day PIC',    labelFr: 'Heli Jour PIC' },
        { key: 'heliNightPic',  labelEn: 'Heli Night PIC',  labelFr: 'Heli Nuit PIC' },
        { key: 'heliDayCop',    labelEn: 'Heli Day SIC',    labelFr: 'Heli Jour SIC' },
        { key: 'heliNightCop',  labelEn: 'Heli Night SIC',  labelFr: 'Heli Nuit SIC' },
        { key: 'heliDayDual',   labelEn: 'Heli Day Dual',   labelFr: 'Heli Jour Dual' },
        { key: 'heliNightDual', labelEn: 'Heli Night Dual', labelFr: 'Heli Nuit Dual' },
        { key: 'hoverTime',     labelEn: 'Hover Time',      labelFr: 'Vol stationnaire' },
      ],
    },
    // ── Cross-country ──
    {
      id: 'xc',
      titleEn: 'Cross-country',
      titleFr: 'Voyage (XC)',
      descEn: 'XC Day and XC Night totals (Standard 421 / CAR 401.34). Only needed if your logbook tracked day/night XC separately.',
      descFr: 'Totaux XC Jour et XC Nuit (Norme 421 / CAR 401.34). Seulement si votre carnet distinguait XC jour/nuit.',
      open: false,
      fields: [
        { key: 'xcDay',   labelEn: 'XC Day',   labelFr: 'XC Jour' },
        { key: 'xcNight', labelEn: 'XC Night', labelFr: 'XC Nuit' },
      ],
    },
    // ── Instrument ──
    {
      id: 'instrument',
      titleEn: 'Instrument time',
      titleFr: 'Temps aux instruments',
      descEn: 'Brought-forward IFR time does NOT affect your 6-approaches-in-6-months currency — only flights logged in Cumulo count for that.',
      descFr: 'Le temps IFR reporté n\'affecte PAS votre validité 6-approches-en-6-mois — seuls les vols Cumulo comptent.',
      open: false,
      fields: [
        { key: 'instActual',  labelEn: 'Actual (IMC)',              labelFr: 'Réel (IMC)' },
        { key: 'instHood',    labelEn: 'Hood (view-limiting)',      labelFr: 'Cagoule (en vol)' },
        { key: 'instSim',     labelEn: 'FFS / FTD (simulator)',     labelFr: 'FFS / FTD (simulateur)' },
        { key: 'approaches',  labelEn: 'Approaches',                labelFr: 'Approches', integer: true },
      ],
    },
    // ── Take-offs & Landings ──
    {
      id: 'tol',
      titleEn: 'Take-offs & Landings',
      titleFr: 'Décollages & atterrissages',
      descEn: 'Count, not hours. Brought-forward landings do NOT affect 5-in-6-month recency — only Cumulo-logged flights count for currency.',
      descFr: 'Compte, pas heures. Les atterrissages reportés n\'affectent PAS la validité 5/6mois — seuls les vols Cumulo comptent.',
      open: false,
      fields: [
        { key: 'toDay',    labelEn: 'T/O — Day',        labelFr: 'Déc. — Jour',  integer: true },
        { key: 'toNight',  labelEn: 'T/O — Night',      labelFr: 'Déc. — Nuit',  integer: true },
        { key: 'ldgDay',   labelEn: 'Landings — Day',   labelFr: 'Att. — Jour',  integer: true },
        { key: 'ldgNight', labelEn: 'Landings — Night', labelFr: 'Att. — Nuit',  integer: true },
      ],
    },
    // ── Dual Given ──
    {
      id: 'dualGiven',
      titleEn: 'Dual Given',
      titleFr: 'Instruction donnée',
      descEn: 'CFI / instructor time (CAR 421.34 ATPL credit). Day and night totals.',
      descFr: 'Temps instructeur (CAR 421.34 crédit ATPL). Totaux jour et nuit.',
      open: false,
      fields: [
        { key: 'dualGivenDay',   labelEn: 'Dual Given — Day',   labelFr: 'Instruction — Jour' },
        { key: 'dualGivenNight', labelEn: 'Dual Given — Night', labelFr: 'Instruction — Nuit' },
      ],
    },
  ];
}

// Flat list of all keys the page can write.
function _bfAllKeys() {
  const out = [];
  _bfPageGroups().forEach(g => g.fields.forEach(f => out.push(f.key)));
  return [...new Set(out)];
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
  const clean = {};
  Object.keys(balances).forEach(k => {
    const v = +balances[k];
    if (v > 0) clean[k] = v;
  });
  const hash = await _hashBalances(clean);
  const attestedAt = new Date().toISOString();
  const record = { balances: clean, attestedAt, hash };
  localStorage.setItem(OPENING_BALANCES_KEY, JSON.stringify(record));

  let log = [];
  try { log = JSON.parse(localStorage.getItem(OPENING_ATTEST_LOG_KEY) || '[]'); } catch { log = []; }
  if (!Array.isArray(log)) log = [];
  log.push({ timestamp: attestedAt, hash, action: log.length === 0 ? 'attest' : 're-attest', balances: clean });
  try { localStorage.setItem(OPENING_ATTEST_LOG_KEY, JSON.stringify(log)); } catch {}

  return record;
}

// ─── totalsWithOpening ───────────────────────────────────────────
// Merge opening balances into a totals object (Dashboard, Logbook footer).
// Handles BOTH aggregate keys (pic, sic, night, xc, me, heli, dualGiven)
// stored directly AND raw column keys (meDayPic, meNightPic, …) from
// which the aggregates are derived on the fly.
// Returns a NEW object — never mutates input.
function totalsWithOpening(flightsTotals) {
  const { balances } = loadOpeningBalances();
  const merged = { ...flightsTotals };

  // Step 1 — add every stored key directly to merged.
  Object.keys(balances).forEach(key => {
    merged[key] = (+merged[key] || 0) + (+balances[key] || 0);
  });

  // Step 2 — derive aggregate keys from raw column keys when the
  // aggregate was not stored as its own key. This handles pilots who
  // filled the detailed Engine class / Helicopter / etc. breakdown
  // instead of the career-summary section.
  //
  // Guard: only derive when the aggregate key itself was NOT present
  // in balances (to prevent double-counting).

  if (!balances.pic) {
    // Single-engine time (seDay/seNight) counts as PIC — same rule as the
    // live stats in 02-data.js. Matters for bush/float/ski pilots who logged
    // their early-career single-engine PIC hours as brought-forward.
    const d = (+balances.meDayPic||0)+(+balances.meNightPic||0)
            + (+balances.heliDayPic||0)+(+balances.heliNightPic||0)
            + (+balances.seDay||0)+(+balances.seNight||0);
    if (d) merged.pic = (+merged.pic||0) + d;
  }
  if (!balances.sic) {
    const d = (+balances.meDayCop||0)+(+balances.meNightCop||0)
            + (+balances.heliDayCop||0)+(+balances.heliNightCop||0);
    if (d) merged.sic = (+merged.sic||0) + d;
  }
  if (!balances.night) {
    // Night = all night flying, every aircraft class (ME + heli + single-engine).
    const d = (+balances.meNightPic||0)+(+balances.meNightCop||0)+(+balances.meNightDual||0)
            + (+balances.heliNightPic||0)+(+balances.heliNightCop||0)+(+balances.heliNightDual||0)
            + (+balances.seNight||0);
    if (d) merged.night = (+merged.night||0) + d;
  }
  if (!balances.me) {
    const d = (+balances.meDayPic||0)+(+balances.meDayCop||0)+(+balances.meDayDual||0)
            + (+balances.meNightPic||0)+(+balances.meNightCop||0)+(+balances.meNightDual||0);
    if (d) merged.me = (+merged.me||0) + d;
  }
  if (!balances.heli) {
    const d = (+balances.heliDayPic||0)+(+balances.heliDayCop||0)+(+balances.heliDayDual||0)
            + (+balances.heliNightPic||0)+(+balances.heliNightCop||0)+(+balances.heliNightDual||0);
    if (d) merged.heli = (+merged.heli||0) + d;
  }
  if (!balances.xc) {
    const d = (+balances.xcDay||0)+(+balances.xcNight||0);
    if (d) merged.xc = (+merged.xc||0) + d;
  }
  if (!balances.dualGiven) {
    const d = (+balances.dualGivenDay||0)+(+balances.dualGivenNight||0);
    if (d) merged.dualGiven = (+merged.dualGiven||0) + d;
  }
  if (!balances.ldg) {
    const d = (+balances.ldgDay||0)+(+balances.ldgNight||0);
    if (d) merged.ldg = (+merged.ldg||0) + d;
  }
  // Mirror total ↔ block when only one is present.
  if (!balances.total && (+balances.block||0) > 0) {
    merged.total = (+merged.total||0) + (+balances.block||0);
  }
  if (!balances.block && (+balances.total||0) > 0) {
    merged.block = (+merged.block||0) + (+balances.total||0);
  }

  return merged;
}

// Short human-readable summary (Dashboard hero sub-line + Settings card).
function openingBalanceSummary() {
  const { balances, attestedAt } = loadOpeningBalances();
  const total = +balances.total || +balances.block || 0;
  if (total <= 0) return null;
  const fmtted = typeof fmt === 'function' ? fmt(total) : total.toFixed(1);
  const lang = (typeof getLang === 'function') ? getLang() : 'en';
  const dateStr = attestedAt
    ? new Date(attestedAt).toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA',
        { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';
  return lang === 'fr'
    ? `${fmtted} hrs reportées · attestées ${dateStr}`
    : `${fmtted} hrs carried forward · attested ${dateStr}`;
}

// ───────────────────────────────────────────────────────────────────
// UI — Settings section card (summary + "Open" button)
// ───────────────────────────────────────────────────────────────────
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

// Navigate to the brought-forward page (replaces the old modal).
function openOpeningBalancesEditor() {
  if (typeof showPage === 'function') showPage('bf');
}

// ───────────────────────────────────────────────────────────────────
// UI — Full page renderer
// Called by showPage('bf') via the router hook in 01-router.js.
// ───────────────────────────────────────────────────────────────────
function renderBroughtForwardPage() {
  const container = document.getElementById('bf-page-body');
  if (!container) return;

  const { balances } = loadOpeningBalances();
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const profile = (typeof DB !== 'undefined' && DB.loadProfile) ? DB.loadProfile() : {};
  const pilotType = profile.pilotType || 'airline705';

  // Auto-open helicopter group when pilot type is heli or has heli hours.
  const heliRelevant = pilotType === 'helicopter'
    || Object.keys(balances).some(k => k.startsWith('heli') && (+balances[k]||0) > 0);

  const groups = _bfPageGroups();

  const groupsHtml = groups.map(g => {
    const title = fr ? g.titleFr : g.titleEn;
    const desc  = fr ? g.descFr  : g.descEn;
    // Force-open heli group when relevant.
    const isOpen = g.open || (g.id === 'heli' && heliRelevant);

    const filledCount = g.fields.filter(f => (+balances[f.key]||0) > 0).length;
    const badge = filledCount > 0
      ? `<span class="bf-group-badge">${filledCount}</span>`
      : '';

    const fieldsHtml = g.fields.map(f => {
      const label = fr ? f.labelFr : f.labelEn;
      const step  = f.integer ? '1' : '0.1';
      const ph    = f.integer ? '0' : '0.0';
      const value = balances[f.key] != null && +balances[f.key] > 0 ? balances[f.key] : '';
      return `
        <div class="form-group bf-field${f.hero ? ' bf-hero-field' : ''}">
          <label for="ob-${f.key}">${esc(label)}</label>
          <input type="number" id="ob-${esc(f.key)}" min="0" step="${step}"
                 value="${esc(value)}" placeholder="${ph}" inputmode="decimal"
                 class="bf-input${f.hero ? ' bf-hero-input' : ''}" />
        </div>`;
    }).join('');

    return `
      <details class="bf-group" ${isOpen ? 'open' : ''}>
        <summary class="bf-group-summary">
          <svg class="bf-group-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          <span class="bf-group-title">${esc(title)}</span>
          ${badge}
        </summary>
        <div class="bf-group-desc">${esc(desc)}</div>
        <div class="bf-fields-grid${g.id === 'career' ? ' bf-fields-hero' : ''}">${fieldsHtml}</div>
      </details>`;
  }).join('');

  const profileName = `${profile.fname || ''} ${profile.lname || ''}`.trim();
  const todayStr = new Date().toLocaleDateString(fr ? 'fr-CA' : 'en-CA',
    { year: 'numeric', month: 'long', day: 'numeric' });

  const hasAny = hasOpeningBalances();
  const { attestedAt } = loadOpeningBalances();
  const attestedStr = attestedAt
    ? new Date(attestedAt).toLocaleDateString(fr ? 'fr-CA' : 'en-CA',
        { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  container.innerHTML = `
    <div class="bf-page-intro form-card">
      <div class="form-card-title">${fr ? 'Heures reportées — carnet papier' : 'Brought-forward hours — paper logbook'}</div>
      <div class="bf-intro-body">
        <p>${fr
          ? 'Déclarez les totaux cumulatifs de votre carnet papier ou système précédent. Ces heures s\'ajoutent à vos vols Cumulo sur le Tableau de bord, le Carnet et l\'export PDF TC.'
          : 'Declare your cumulative totals from your paper logbook or prior electronic system. These hours add on top of your in-Cumulo flights on the Dashboard, Logbook table, and TC PDF export.'}</p>
        <p class="bf-intro-tip"><strong>${fr ? 'Conseil' : 'Tip'}:</strong> ${fr
          ? 'La plupart des pilotes n\'ont besoin que de la section <em>Totaux carrière</em> ci-dessous. Les sections de détail sont optionnelles — ouvrez seulement ce que votre carnet papier suivait.'
          : 'Most pilots only need the <em>Career totals</em> section below. The detail sections are optional — only open what your paper logbook actually tracked.'}</p>
        ${hasAny && attestedStr ? `<div class="bf-attest-badge"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ${fr ? `Attestées le ${attestedStr}` : `Attested ${attestedStr}`}</div>` : ''}
      </div>
    </div>

    <div class="bf-groups-wrap">
      ${groupsHtml}
    </div>

    <div class="form-card bf-attest-card" id="bf-attest-section">
      <div class="form-card-title">${fr ? 'Attestation (CAR 401.08(2)(h))' : 'Attestation (CAR 401.08(2)(h))'}</div>
      <div class="bf-attest-desc">
        ${fr
          ? `En cochant, vous confirmez que ces totaux reflètent fidèlement votre carnet papier au <strong>${esc(todayStr)}</strong>. Stocké localement avec un hash SHA-256. Toute modification exigera une nouvelle attestation ; la précédente est archivée dans le journal d'audit.`
          : `By checking, you confirm these totals accurately reflect your paper logbook as of <strong>${esc(todayStr)}</strong>. Stored locally with a SHA-256 hash. Any edit requires a new attestation; the prior one is archived in the audit log.`}
      </div>
      <label class="col-option" style="margin:var(--s-3) 0;">
        <input type="checkbox" id="ob-attest-chk" />
        <span class="col-option-label">${fr
          ? 'J\'atteste que ces totaux correspondent à mon carnet papier au jour d\'aujourd\'hui.'
          : 'I attest these totals match my paper logbook as of today.'}</span>
      </label>
      <div class="form-group" style="max-width:320px;">
        <label for="ob-attest-name">${fr ? 'Nom complet (signature dactylographiée)' : 'Full name (typed signature)'}</label>
        <input type="text" id="ob-attest-name"
               placeholder="${esc(profileName || (fr ? 'Tapez votre nom complet' : 'Type your full name'))}"
               style="font-family:var(--font-mono);" />
      </div>
      <div style="display:flex;gap:var(--s-3);margin-top:var(--s-4);flex-wrap:wrap;align-items:center;">
        <button class="btn btn-primary" onclick="commitOpeningBalances()">${fr ? 'Sauvegarder & attester' : 'Save & attest'}</button>
        <button class="btn btn-ghost" onclick="showPage('backup')">${fr ? 'Annuler' : 'Cancel'}</button>
      </div>
    </div>
  `;
}

// ───────────────────────────────────────────────────────────────────
// Validate, collect, persist. Called from the page Save button.
// ───────────────────────────────────────────────────────────────────
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

  // Mirror Total → Block so Dashboard hero (prefers s.block) reflects BF.
  if ((+balances.total||0) > 0 && !(+balances.block||0)) {
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

  if (typeof showToast === 'function') showToast(
    fr ? 'Totaux reportés attestés et sauvegardés.' : 'Brought-forward totals attested and saved.',
    'success');

  // Refresh visible surfaces.
  if (typeof renderDashboard === 'function') renderDashboard();
  if (typeof renderLogbook === 'function') renderLogbook(typeof filterVal !== 'undefined' ? (filterVal || '') : '');
  renderOpeningBalancesSection('openingBalancesSection');

  // Navigate back to Settings → Profile so the updated summary is visible.
  if (typeof showPage === 'function') {
    showPage('backup');
    if (typeof showSettingsTab === 'function') setTimeout(() => showSettingsTab('profile'), 50);
  }
}
