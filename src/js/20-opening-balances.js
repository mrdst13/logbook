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
        { key: 'dualRcvd',   labelEn: 'Dual Received',            labelFr: 'Double reçu',                            aggregate: true },
        { key: 'picus',      labelEn: 'PICUS — PIC under supervision', labelFr: 'PICUS — PIC sous supervision',       aggregate: true },
        { key: 'night',      labelEn: 'Night',                     labelFr: 'Nuit',                                   aggregate: true },
        { key: 'xc',         labelEn: 'Cross-Country (XC)',        labelFr: 'Vol-voyage (XC)',                        aggregate: true },
        { key: 'me',         labelEn: 'Multi-Engine',              labelFr: 'Multimoteur',                            aggregate: true },
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
        { key: 'seDay',       labelEn: 'SE Day — PIC',     labelFr: 'SE Jour — PIC' },
        { key: 'seNight',     labelEn: 'SE Night — PIC',   labelFr: 'SE Nuit — PIC' },
        { key: 'seDayDual',   labelEn: 'SE Day — Dual',    labelFr: 'SE Jour — Double' },
        { key: 'seNightDual', labelEn: 'SE Night — Dual',  labelFr: 'SE Nuit — Double' },
        { key: 'meDayPic',    labelEn: 'ME Day PIC',     labelFr: 'ME Jour PIC' },
        { key: 'meNightPic',  labelEn: 'ME Night PIC',   labelFr: 'ME Nuit PIC' },
        { key: 'meDayCop',    labelEn: 'ME Day SIC',     labelFr: 'ME Jour SIC' },
        { key: 'meNightCop',  labelEn: 'ME Night SIC',   labelFr: 'ME Nuit SIC' },
        { key: 'meDayDual',   labelEn: 'ME Day Dual',    labelFr: 'ME Jour Double' },
        { key: 'meNightDual', labelEn: 'ME Night Dual',  labelFr: 'ME Nuit Double' },
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
        { key: 'heliDayPic',    labelEn: 'Heli Day PIC',    labelFr: 'Héli Jour PIC' },
        { key: 'heliNightPic',  labelEn: 'Heli Night PIC',  labelFr: 'Héli Nuit PIC' },
        { key: 'heliDayCop',    labelEn: 'Heli Day SIC',    labelFr: 'Héli Jour SIC' },
        { key: 'heliNightCop',  labelEn: 'Heli Night SIC',  labelFr: 'Héli Nuit SIC' },
        { key: 'heliDayDual',   labelEn: 'Heli Day Dual',   labelFr: 'Héli Jour Double' },
        { key: 'heliNightDual', labelEn: 'Heli Night Dual', labelFr: 'Héli Nuit Double' },
        { key: 'hoverTime',     labelEn: 'Hover Time',      labelFr: 'Vol stationnaire' },
      ],
    },
    // ── Cross-country ──
    {
      id: 'xc',
      titleEn: 'Cross-country',
      titleFr: 'Vol-voyage (XC)',
      descEn: 'XC Day and XC Night totals (Standard 421). Only needed if your logbook tracked day/night XC separately.',
      descFr: 'Totaux XC Jour et XC Nuit (Norme 421). Seulement si votre carnet distinguait XC jour/nuit.',
      open: false,
      fields: [
        { key: 'xcDayPic',    labelEn: 'XC Day — PIC',    labelFr: 'XC Jour — PIC' },
        { key: 'xcDayCop',    labelEn: 'XC Day — SIC',    labelFr: 'XC Jour — SIC' },
        { key: 'xcDayDual',   labelEn: 'XC Day — Dual',   labelFr: 'XC Jour — Double' },
        { key: 'xcNightPic',  labelEn: 'XC Night — PIC',  labelFr: 'XC Nuit — PIC' },
        { key: 'xcNightCop',  labelEn: 'XC Night — SIC',  labelFr: 'XC Nuit — SIC' },
        { key: 'xcNightDual', labelEn: 'XC Night — Dual', labelFr: 'XC Nuit — Double' },
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
        { key: 'instHood',    labelEn: 'Hood (view-limiting)',      labelFr: 'Dispositif limitant la vue' },
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
      descEn: 'CFI / instructor time (counts toward ATPL experience per Standard 421). Day and night totals.',
      descFr: 'Temps instructeur (compte vers l\'expérience ATPL selon la Norme 421). Totaux jour et nuit.',
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
    if (!raw) return { balances: {}, cutoffDate: null, attestedAt: null, hash: null };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.balances) {
      return { balances: {}, cutoffDate: null, attestedAt: null, hash: null };
    }
    // Migrate legacy aggregate XC keys (xcDay/xcNight) to the role-split PIC
    // keys so the new column grid shows them and they are never double-counted.
    const _b = parsed.balances;
    if (_b && _b.xcDay != null)   { _b.xcDayPic   = (+_b.xcDayPic||0)   + (+_b.xcDay||0);   delete _b.xcDay; }
    if (_b && _b.xcNight != null) { _b.xcNightPic = (+_b.xcNightPic||0) + (+_b.xcNight||0); delete _b.xcNight; }
    return parsed;
  } catch {
    return { balances: {}, cutoffDate: null, attestedAt: null, hash: null };
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
async function saveOpeningBalances(balances, cutoffDate) {
  const clean = {};
  Object.keys(balances).forEach(k => {
    const v = +balances[k];
    if (v > 0) clean[k] = v;
  });
  const hash = await _hashBalances(clean);
  const attestedAt = new Date().toISOString();
  // cutoffDate = the last date covered by the paper logbook (the period
  // boundary the attestation declares). Stored as metadata; the integrity
  // hash stays over the hour VALUES only (unchanged semantics).
  const record = { balances: clean, cutoffDate: cutoffDate || null, attestedAt, hash };
  localStorage.setItem(OPENING_BALANCES_KEY, JSON.stringify(record));

  let log = [];
  try { log = JSON.parse(localStorage.getItem(OPENING_ATTEST_LOG_KEY) || '[]'); } catch { log = []; }
  if (!Array.isArray(log)) log = [];
  log.push({ timestamp: attestedAt, hash, action: log.length === 0 ? 'attest' : 're-attest', cutoffDate: cutoffDate || null, balances: clean });
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
    // Night = all night flying — shared nightHoursOf() (balances use the same
    // field names as a flight) so opening balances agree with calcStats.
    const d = nightHoursOf(balances);
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
    const d = (+balances.xcDayPic||0)+(+balances.xcDayCop||0)+(+balances.xcDayDual||0)
            + (+balances.xcNightPic||0)+(+balances.xcNightCop||0)+(+balances.xcNightDual||0)
            + (+balances.xcDay||0)+(+balances.xcNight||0); // legacy aggregate keys (pre-migration)
    if (d) merged.xc = (+merged.xc||0) + d;
  }
  if (!balances.dualRcvd) {
    // Dual received = all instruction-received time across classes/conditions
    // (parallel to calcStats; orthogonal to me/heli/xc, with which it overlaps).
    const d = (+balances.seDayDual||0)+(+balances.seNightDual||0)
            + (+balances.meDayDual||0)+(+balances.meNightDual||0)
            + (+balances.heliDayDual||0)+(+balances.heliNightDual||0)
            + (+balances.xcDayDual||0)+(+balances.xcNightDual||0);
    if (d) merged.dualRcvd = (+merged.dualRcvd||0) + d;
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
  const { balances, attestedAt, cutoffDate } = loadOpeningBalances();
  const total = +balances.total || +balances.block || 0;
  if (total <= 0) return null;
  const fmtted = typeof fmt === 'function' ? fmt(total) : total.toFixed(1);
  const lang = (typeof getLang === 'function') ? getLang() : 'en';
  const fmtDate = (iso) => iso
    ? new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso).toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA',
        { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';
  const attDate = fmtDate(attestedAt);
  if (cutoffDate) {
    return lang === 'fr'
      ? `${fmtted} h déclarées (carnet papier) au ${fmtDate(cutoffDate)} · attestées ${attDate}`
      : `${fmtted} hrs declared (paper logbook) as of ${fmtDate(cutoffDate)} · attested ${attDate}`;
  }
  return lang === 'fr'
    ? `${fmtted} h reportées · attestées ${attDate}`
    : `${fmtted} hrs carried forward · attested ${attDate}`;
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

// Soft, non-blocking consistency checks shown before attestation. Amber, never
// hard blocks — the pilot may have a valid reason (e.g. SIC not yet entered).
// "An app that catches inconsistencies is an app that knows what it's doing."
function _bfCheckConsistency() {
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const v = (k) => { const n = document.getElementById('ob-' + k); return n ? (+n.value || 0) : 0; };
  const fmtH = (n) => (typeof fmt === 'function' ? fmt(n) : n.toFixed(1));
  const total = v('total') || v('block');
  const pic = v('pic'), night = v('night'), me = v('me'), picus = v('picus');
  // Live declared total — updates on every keystroke (Expert 2 "must").
  const liveEl = document.getElementById('bf-live-total');
  if (liveEl) liveEl.textContent = fmtH(total) + ' h';
  // Career-total reward — declared brought-forward + your in-Cumulo flights,
  // shown in accent so your full career lights up as you enter hours.
  const careerWrap = document.getElementById('bf-career-wrap');
  const careerEl = document.getElementById('bf-career-total');
  if (careerWrap && careerEl) {
    const cumulo = (Array.isArray(flights) ? flights : [])
      .reduce((s, f) => s + (+f.total || +f.block || 0), 0);
    if (total > 0 || cumulo > 0) {
      careerWrap.style.display = 'block';
      careerEl.textContent = fmtH(total + cumulo) + ' h';
    } else {
      careerWrap.style.display = 'none';
    }
  }
  const el = document.getElementById('bf-consistency');
  if (!el) return;
  const warns = [];
  if (total > 0 && pic > total) warns.push(fr
    ? `PIC (${fmtH(pic)} h) dépasse le temps de vol total (${fmtH(total)} h). C'est probablement une erreur de saisie — vérifiez vos totaux. Vous pouvez tout de même attester.`
    : `PIC (${fmtH(pic)} h) exceeds total flight time (${fmtH(total)} h). This is likely a data-entry error — check your totals. You can still attest.`);
  if (total > 0 && night > total) warns.push(fr
    ? `Nuit (${fmtH(night)} h) dépasse le temps de vol total (${fmtH(total)} h). Vérifiez vos totaux.`
    : `Night (${fmtH(night)} h) exceeds total flight time (${fmtH(total)} h). Check your totals.`);
  if (total > 0 && me > total) warns.push(fr
    ? `Multimoteur (${fmtH(me)} h) dépasse le temps de vol total (${fmtH(total)} h). Vérifiez vos totaux.`
    : `Multi-engine (${fmtH(me)} h) exceeds total flight time (${fmtH(total)} h). Check your totals.`);
  if (pic > 0 && picus > pic) warns.push(fr
    ? `Le PICUS (${fmtH(picus)} h) dépasse votre PIC (${fmtH(pic)} h). Le PICUS est inclus dans le PIC — vérifiez.`
    : `PICUS (${fmtH(picus)} h) exceeds your PIC (${fmtH(pic)} h). PICUS is part of PIC — verify.`);
  if (!warns.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = warns.map(w => `<div style="background:var(--warning-soft);border:0.5px solid var(--warning);border-radius:10px;padding:9px 12px;margin-bottom:8px;font-size:12px;color:var(--warning-text);line-height:1.5;">${esc(w)}</div>`).join('');
}

// ───────────────────────────────────────────────────────────────────
// UI — Full page renderer
// Called by showPage('bf') via the router hook in 01-router.js.
// ───────────────────────────────────────────────────────────────────
function renderBroughtForwardPage() {
  const container = document.getElementById('bf-page-body');
  if (!container) return;

  const _rec = loadOpeningBalances();
  const balances = _rec.balances;
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const profile = (typeof DB !== 'undefined' && DB.loadProfile) ? DB.loadProfile() : {};
  const pilotType = profile.pilotType || 'airline705';
  // Cut-off date (last date the paper logbook covers). Default to yesterday on
  // first visit; keep the pilot's saved value on return. Never re-default once set.
  const _todayISO = new Date().toISOString().slice(0, 10);
  const _yesterdayISO = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const cutoffDefault = _rec.cutoffDate || _yesterdayISO;

  // Auto-open helicopter group when pilot type is heli or has heli hours.
  const heliRelevant = pilotType === 'helicopter'
    || Object.keys(balances).some(k => k.startsWith('heli') && (+balances[k]||0) > 0);

  const groups = _bfPageGroups();

  // Render one group as the existing collapsible field grid (unchanged look).
  const renderGroup = (g) => {
    const title = fr ? g.titleFr : g.titleEn;
    const desc  = fr ? g.descFr  : g.descEn;
    const isOpen = g.open || (g.id === 'heli' && heliRelevant);
    const filledCount = g.fields.filter(f => (+balances[f.key]||0) > 0).length;
    const badge = filledCount > 0 ? `<span class="bf-group-badge">${filledCount}</span>` : '';
    const fieldsHtml = g.fields.map(f => `
        <div class="form-group bf-field${f.hero ? ' bf-hero-field' : ''}">
          <label for="ob-${f.key}">${esc(fr ? f.labelFr : f.labelEn)}</label>
          ${_bfInput(f.key, balances[f.key], f.integer, f.hero)}
        </div>`).join('');
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
  };

  // Two modes, same data. "My totals" = career aggregates. "Like my paper
  // logbook" = the detailed breakdown, with SE/ME/XC shown as the familiar
  // day/night-by-role column table. engine + xc keys live ONLY in that table
  // (no duplicate ids); every other key keeps its grid. Both modes stay in the
  // DOM (toggle is CSS show/hide), so commit reads every input — no value lost.
  const careerHtml = renderGroup(groups.find(g => g.id === 'career'));
  const detailGroupsHtml = groups
    .filter(g => !['career', 'engine', 'xc'].includes(g.id))
    .map(renderGroup).join('');
  const logbookTableHtml = _bfLogbookTableHtml(balances, fr);

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
    <style>
      .bf-mode-toggle{display:inline-flex;gap:4px;background:var(--surface-2,#e7eef6);border-radius:11px;padding:4px;margin:4px 0}
      .bf-mode-btn{appearance:none;border:0;background:transparent;font:inherit;font-weight:600;font-size:14px;color:var(--text-muted);padding:8px 16px;border-radius:8px;cursor:pointer}
      .bf-mode-btn.bf-on{background:var(--surface,#fff);color:var(--text)}
      .bf-mode-cap{font-size:12.5px;color:var(--text-muted);margin:6px 2px 14px}
      .bf-logbook{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;margin:0 0 14px}
      .bf-logbook th,.bf-logbook td{border:0.5px solid var(--border,rgba(20,40,70,.12));padding:6px 8px;text-align:center}
      .bf-logbook thead th{font-size:10.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--text-muted);font-weight:600;background:var(--surface-2,#f3f7fb)}
      .bf-logbook td:first-child,.bf-logbook th:first-child{text-align:left;font-weight:600;font-size:13px;white-space:nowrap}
      .bf-logbook input{width:100%;min-width:52px;border:0;background:transparent;font:inherit;font-weight:600;text-align:right;color:var(--text)}
      .bf-logbook input:focus{outline:none;background:var(--accent-soft,rgba(61,123,196,.10));border-radius:5px}
      .bf-lt-blank{color:var(--text-muted);opacity:.45}
    </style>
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

    <div class="form-card">
      <div class="form-group" style="max-width:340px;">
        <label for="ob-cutoff-date">${fr ? 'Dernière date de votre carnet papier' : 'Last date in your paper logbook'}</label>
        <input type="date" id="ob-cutoff-date" value="${esc(cutoffDefault)}" max="${esc(_todayISO)}" />
      </div>
      <div class="bf-group-desc" style="margin-top:8px;">${fr
        ? 'Utilisez la date de votre dernière inscription au carnet papier, même si c\'était il y a des semaines. En cas de doute, choisissez une date clairement avant votre arrivée sur Cumulo. Vous pourrez la modifier — une nouvelle attestation est générée automatiquement.'
        : 'Use the date of your last paper logbook entry, even if it was weeks ago. If unsure, pick a date clearly before you started using Cumulo. You can change it later — a new attestation is generated automatically.'}</div>
    </div>

    <div class="form-card" style="text-align:center;padding:18px 22px;">
      <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);">${fr ? 'Total de vol déclaré' : 'Declared total flight time'}</div>
      <div id="bf-live-total" style="font-family:var(--font-display);font-size:44px;font-weight:700;letter-spacing:-.03em;color:var(--text);margin-top:4px;font-variant-numeric:tabular-nums;">0,0 h</div>
      <div id="bf-career-wrap" style="margin-top:14px;padding-top:13px;border-top:0.5px solid rgba(120,140,170,.20);display:none;">
        <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);">${fr ? 'Total de carrière — avec vos vols Cumulo' : 'Career total — with your Cumulo flights'}</div>
        <div id="bf-career-total" style="font-family:var(--font-display);font-size:30px;font-weight:700;letter-spacing:-.02em;color:var(--accent);margin-top:2px;font-variant-numeric:tabular-nums;">0,0 h</div>
      </div>
    </div>

    <div class="bf-mode-toggle">
      <button type="button" id="bf-tab-totals" class="bf-mode-btn bf-on" onclick="_bfSetMode('totals')">${fr ? 'Mes totaux' : 'My totals'}</button>
      <button type="button" id="bf-tab-paper" class="bf-mode-btn" onclick="_bfSetMode('paper')">${fr ? 'Comme mon carnet papier' : 'Like my paper logbook'}</button>
    </div>
    <div class="bf-mode-cap" id="bf-mode-cap">${fr ? 'Saisie rapide : vos grands totaux par catégorie. La plupart des pilotes n\'ont besoin que de ça.' : 'Quick entry: your grand totals per category. Most pilots only need this.'}</div>

    <div id="bf-mode-totals" class="bf-groups-wrap">
      ${careerHtml}
    </div>
    <div id="bf-mode-paper" class="bf-groups-wrap" style="display:none">
      ${logbookTableHtml}
      ${detailGroupsHtml}
    </div>

    <div id="bf-consistency" style="margin:0 0 var(--s-4);display:none;"></div>

    <div class="form-card bf-attest-card" id="bf-attest-section">
      <div class="form-card-title">${fr ? 'Attestation du pilote' : 'Pilot attestation'}</div>
      <div class="bf-attest-desc">
        ${fr
          ? `En signant, vous confirmez que ces totaux reflètent fidèlement votre carnet papier à la <strong>date de coupure indiquée plus haut</strong>. Conservé localement avec une <span title="Empreinte cryptographique SHA-256">empreinte d'intégrité</span>. Toute modification exige une nouvelle attestation ; la précédente est archivée dans le journal d'audit.`
          : `By signing, you confirm these totals accurately reflect your paper logbook as of the <strong>cut-off date shown above</strong>. Stored locally with an <span title="SHA-256 cryptographic fingerprint">integrity fingerprint</span>. Any edit requires a new attestation; the prior one is archived in the audit log.`}
      </div>
      <div class="form-group" style="max-width:340px;">
        <label for="ob-attest-name">${fr ? 'Signez en tapant votre nom complet' : 'Sign by typing your full name'}</label>
        <input type="text" id="ob-attest-name"
               placeholder="${esc(profileName || (fr ? 'Tapez votre nom complet' : 'Type your full name'))}"
               autocomplete="name" style="font-family:var(--font-mono);" />
        <div id="ob-name-warning" style="display:none;margin-top:8px;font-size:11.5px;color:var(--warning-text);background:var(--warning-soft);border:0.5px solid var(--warning);border-radius:8px;padding:8px 10px;"></div>
      </div>
      <div style="display:flex;gap:var(--s-3);margin-top:var(--s-4);flex-wrap:wrap;align-items:center;">
        <button class="btn btn-primary" onclick="commitOpeningBalances()">${fr ? 'Attester' : 'Attest'}</button>
        <button class="btn btn-ghost" onclick="showPage('dash')">${fr ? 'Annuler' : 'Cancel'}</button>
      </div>
    </div>
  `;

  // Surface consistency warnings now and on every keystroke (oninput per field).
  if (typeof _bfCheckConsistency === 'function') _bfCheckConsistency();
}

// Input cell shared by the grid groups and the paper-logbook table — one place
// so both layouts stay identical (same id, same oninput, same parsing).
function _bfInput(key, value, integer, hero) {
  const v = (value != null && +value > 0) ? value : '';
  const step = integer ? '1' : '0.1';
  const ph = integer ? '0' : '0.0';
  return `<input type="number" id="ob-${esc(key)}" min="0" step="${step}" value="${esc(v)}" placeholder="${ph}" inputmode="decimal" oninput="if(typeof _bfCheckConsistency==='function')_bfCheckConsistency()" class="bf-input${hero ? ' bf-hero-input' : ''}" />`;
}

// "Like my paper logbook" view: SE / ME / XC as day/night-by-role columns,
// mirroring the bottom-totals row of a TC paper logbook. Same ob-<key> ids the
// grid would use, so values flow through the exact same save path.
function _bfLogbookTableHtml(balances, fr) {
  const cell = (k) => k ? `<td>${_bfInput(k, balances[k], false, false)}</td>` : `<td class="bf-lt-blank">—</td>`;
  // Day-major, Dual/PIC/Co order — mirrors a TC paper logbook page (Day {Dual,
  // PIC, Co} · Night {Dual, PIC, Co}). SE/XC have no Co-pilot column on the card.
  const row = (label, ks) => `<tr><td>${esc(label)}</td>${ks.map(cell).join('')}</tr>`;
  const dpc = fr ? ['Double', 'PIC', 'Copilote'] : ['Dual', 'PIC', 'Co-pilot'];
  return `
    <div class="bf-group-desc" style="margin:0 0 8px">${fr
      ? 'Reproduisez la dernière ligne de totaux de votre carnet papier de Transports Canada — mêmes colonnes, même ordre.'
      : 'Transcribe the bottom totals row of your Transport Canada paper logbook — same columns, same order.'}</div>
    <div style="overflow-x:auto"><table class="bf-logbook">
      <thead>
        <tr><th rowspan="2">${fr?'Catégorie':'Category'}</th><th colspan="3">${fr?'Jour':'Day'}</th><th colspan="3">${fr?'Nuit':'Night'}</th></tr>
        <tr><th>${dpc[0]}</th><th>${dpc[1]}</th><th>${dpc[2]}</th><th>${dpc[0]}</th><th>${dpc[1]}</th><th>${dpc[2]}</th></tr>
      </thead>
      <tbody>
        ${row(fr?'Monomoteur':'Single-engine', ['seDayDual','seDay',null,'seNightDual','seNight',null])}
        ${row(fr?'Multimoteur':'Multi-engine', ['meDayDual','meDayPic','meDayCop','meNightDual','meNightPic','meNightCop'])}
        ${row(fr?'Vol-voyage (XC)':'Cross-country (XC)', ['xcDayDual','xcDayPic','xcDayCop','xcNightDual','xcNightPic','xcNightCop'])}
      </tbody>
    </table></div>`;
}

// Toggle the two brought-forward modes (CSS show/hide — all inputs stay in the
// DOM so saving never drops a value).
function _bfSetMode(mode) {
  const paper = (mode === 'paper');
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const t = document.getElementById('bf-mode-totals');
  const p = document.getElementById('bf-mode-paper');
  const bt = document.getElementById('bf-tab-totals');
  const bp = document.getElementById('bf-tab-paper');
  const cap = document.getElementById('bf-mode-cap');
  if (t) t.style.display = paper ? 'none' : 'block';
  if (p) p.style.display = paper ? 'block' : 'none';
  if (bt) bt.classList.toggle('bf-on', !paper);
  if (bp) bp.classList.toggle('bf-on', paper);
  if (cap) cap.textContent = paper
    ? (fr ? 'Disposition miroir du carnet papier de Transport Canada — transcrivez vos colonnes telles quelles.' : 'Mirrors the Transport Canada paper logbook layout — transcribe your columns as they are.')
    : (fr ? 'Saisie rapide : vos grands totaux par catégorie. La plupart des pilotes n\'ont besoin que de ça.' : 'Quick entry: your grand totals per category. Most pilots only need this.');
}

// ───────────────────────────────────────────────────────────────────
// Validate, collect, persist. Called from the page Save button.
// ───────────────────────────────────────────────────────────────────
async function commitOpeningBalances() {
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const nameEl = document.getElementById('ob-attest-name');
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
    // Inline non-blocking warning instead of a native confirm() modal: the
    // first click surfaces the warning; a second click (warning visible) proceeds.
    const warnEl = document.getElementById('ob-name-warning');
    if (warnEl && warnEl.style.display === 'none') {
      warnEl.textContent = fr
        ? `Le nom saisi ne correspond pas à votre profil (« ${expectedName} »). S'il est exact, cliquez de nouveau sur « Attester ».`
        : `The name you typed doesn't match your profile ("${expectedName}"). If it's correct, click "Attest" again.`;
      warnEl.style.display = 'block';
      return;
    }
  }

  // Cut-off date is required: the attestation declares totals "as of" a date,
  // and without it the period boundary is legally ambiguous (CAR 401.08).
  const cutoffEl = document.getElementById('ob-cutoff-date');
  const cutoffDate = (cutoffEl && cutoffEl.value || '').trim();
  if (!cutoffDate) {
    if (typeof showToast === 'function') showToast(
      fr ? 'Indiquez la dernière date de votre carnet papier (date de coupure).'
         : 'Enter the last date in your paper logbook (cut-off date).',
      'error');
    return;
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
    await saveOpeningBalances(balances, cutoffDate);
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

  // Navigate to the Dashboard so the pilot sees their career total update with
  // the declared hours — that reveal IS the retention payoff. (Was Settings →
  // Profile, which buried the moment in a settings pane. Panel-flagged as the
  // single highest-impact fix on this page.)
  if (typeof showPage === 'function') showPage('dash');
}
