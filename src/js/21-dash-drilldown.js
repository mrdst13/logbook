// ═══════════════════════════════════════════════════════════════════
// DASHBOARD DRILL-DOWN PANELS
// ─────────────────────────────────────────────────────────────────
// Every tile on the Dashboard is clickable. Click → modal opens
// showing the SOURCE data behind the number (which flights, which
// dates, which profile fields). Each panel also offers a one-click
// path to the page where the data is actually edited (Settings →
// Profile for the medical, Logbook for the flight list, etc.).
//
// Design intent: the Dashboard is a SUMMARY. Pilots want to know
// "where does that number come from?" — and the answer should be
// one tap away, not buried in a settings page or a debugger.
// ═══════════════════════════════════════════════════════════════════

function openDashDrill(key) {
  const overlay = document.getElementById('dashDrillOverlay');
  if (!overlay) return;
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const titleEl = document.getElementById('dashDrillTitle');
  const eyebrowEl = document.getElementById('dashDrillEyebrow');
  const bodyEl = document.getElementById('dashDrillBody');
  const footEl = document.getElementById('dashDrillFoot');

  const ctx = _dashDrillBuild(key, fr);
  if (!ctx) return;

  if (eyebrowEl) eyebrowEl.textContent = ctx.eyebrow;
  if (titleEl)   titleEl.textContent   = ctx.title;
  if (bodyEl)    bodyEl.innerHTML      = ctx.body;
  if (footEl)    footEl.innerHTML      = ctx.foot || '';

  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeDashDrill() {
  const overlay = document.getElementById('dashDrillOverlay');
  if (overlay) overlay.classList.remove('show');
  document.body.style.overflow = '';
}

// Build the eyebrow / title / body HTML for each drill-down key.
// Returns { eyebrow, title, body, foot } or null if key unknown.
function _dashDrillBuild(key, fr) {
  const rawS = (typeof calcStats === 'function') ? calcStats() : {};
  const s = (typeof totalsWithOpening === 'function') ? totalsWithOpening(rawS) : rawS;
  const profile = (typeof DB !== 'undefined' && DB.loadProfile) ? DB.loadProfile() : {};

  const F = (typeof fmt === 'function') ? fmt : (x => (Math.round((+x||0)*10)/10).toFixed(1));
  const settingsBtn = (label) => `<button class="btn btn-ghost" onclick="closeDashDrill();showPage('backup');setTimeout(()=>{if(typeof showSettingsTab==='function')showSettingsTab('profile');},0);">${label}</button>`;
  const logbookBtn = (label) => `<button class="btn btn-ghost" onclick="closeDashDrill();showPage('logbook');">${label}</button>`;
  const addBtn = (label) => `<button class="btn btn-primary" onclick="closeDashDrill();showPage('add');">${label}</button>`;

  switch (key) {
    case 'hero': return _drillHero(s, rawS, profile, F, fr, logbookBtn, settingsBtn);
    case 'ifr': return _drillIFR(fr, addBtn, logbookBtn);
    case 'ppc': return _drillPPC(profile, fr, settingsBtn);
    case 'recency': return _drillRecency(fr, addBtn, logbookBtn);
    case 'medical': return _drillMedical(profile, fr, settingsBtn);
    case 'milestone': return _drillMilestone(s, profile, fr, F);
    case 'pic':   return _drillStripHours('pic',   s.pic,   fr, profile, F, logbookBtn);
    case 'sic':   return _drillStripHours('sic',   s.sic,   fr, profile, F, logbookBtn);
    case 'night': return _drillStripHours('night', s.night, fr, profile, F, logbookBtn);
    case 'multi': return _drillStripHours('multi', s.me,    fr, profile, F, logbookBtn);
    case 'xc':    return _drillStripHours('xc',    s.xc,    fr, profile, F, logbookBtn);
    case 'ldg':   return _drillLanding(s, fr, addBtn);
    default: return null;
  }
}

// ─── PPC drill-down (705 line ops — CASS 725.106) ──────────────────
function _drillPPC(profile, fr, settingsBtn) {
  const ppcDate = profile.ppcDueDate || '';
  const today = new Date().toISOString().slice(0, 10);

  let ppcDays = null;
  if (ppcDate) {
    const ms = (new Date(ppcDate).getTime() - new Date(today).getTime()) / 86400000;
    ppcDays = Math.round(ms);
  }

  const statusLabel = ppcDays === null ? (fr ? 'NON DÉFINI' : 'NOT SET')
    : ppcDays > 60 ? (fr ? 'À JOUR' : 'CURRENT')
    : ppcDays > 0 ? (fr ? 'BIENTÔT' : 'EXPIRES SOON')
    : (fr ? 'EXPIRÉ' : 'EXPIRED');

  const statusClass = ppcDays === null ? 'warn'
    : ppcDays > 60 ? 'ok' : ppcDays > 0 ? 'warn' : 'bad';

  const rows = [
    { k: fr ? 'PPC dû' : 'PPC due',
      v: esc(ppcDate || (fr ? 'non défini' : 'not set')) },
    { k: fr ? 'Jours restants' : 'Days remaining',
      v: ppcDays === null ? '—' : (ppcDays > 0 ? ppcDays : (fr ? 'expiré' : 'expired')) },
    { k: 'Status',
      v: `<span class="dash-drill-pill ${statusClass}">${statusLabel}</span>` },
  ];

  return {
    eyebrow: fr ? 'CASS 725.106 · MULTI-PILOT 705' : 'CASS 725.106 · MULTI-PILOT 705',
    title: fr ? 'Pilot Proficiency Check (PPC)' : 'Pilot Proficiency Check (PPC)',
    body: _drillRowsHtml(rows) + `<div class="dash-drill-note">${fr
      ? 'Le PPC est le contrôle de compétence requis sous CASS 725.106 pour les opérations 705 multi-pilotes. Cumulo l\'affiche comme la validité principale au lieu du compteur d\'approches générique IFR. Comment le PPC interagit avec les autres règles de validité (CAR 401.05, IPC, formation récurrente) : référez-vous à votre programme de formation approuvé par votre opérateur.'
      : 'The PPC is the proficiency check required under CASS 725.106 for multi-pilot 705 operations. Cumulo surfaces it as your primary validity instead of the generic IFR-approach counter. How the PPC interacts with other currency rules (CAR 401.05, IPC, recurrent training) is defined by your operator\'s approved training program — refer to it for the specifics.'}</div>`,
    foot: settingsBtn(fr ? 'Modifier dans Profil' : 'Update in Profile')
  };
}

// LOFT panel intentionally removed — see _drillPPC() and feedback file for
// why LOFT isn't a separate Cumulo field. Operators define how training
// events relate to PPC currency in their approved training program.

// ─── Hero (career total) drill-down ────────────────────────────────
function _drillHero(s, rawS, profile, F, fr, logbookBtn, settingsBtn) {
  const hasBF = (typeof hasOpeningBalances === 'function') && hasOpeningBalances();
  const bfTotal = (() => {
    if (!hasBF || typeof loadOpeningBalances !== 'function') return 0;
    const ob = loadOpeningBalances();
    return (+ob.balances.total || +ob.balances.block || 0);
  })();
  const loggedHere = Math.max(0, (s.block || s.total || 0) - bfTotal);
  const flightCount = Array.isArray(flights) ? flights.length : 0;

  const rows = [
    { k: fr ? 'Total carrière (bloc)'        : 'Career total (block)',         v: `<strong>${F(s.block || s.total)}</strong> hrs` },
    { k: fr ? 'dont reportées (papier)'      : 'of which brought-forward',     v: hasBF ? `${F(bfTotal)} hrs` : '—' },
    { k: fr ? 'dont enregistrées dans Cumulo': 'of which logged in Cumulo',    v: `${F(loggedHere)} hrs (${flightCount} ${fr ? 'vol' : 'flight'}${flightCount !== 1 ? 's' : ''})` },
    { k: fr ? 'Dernier 30 jours'             : 'Last 30 days',                 v: `${F(rawS.block30 || 0)} hrs` },
  ];

  return {
    eyebrow: fr ? 'TOTAL CARRIÈRE · DÉTAIL' : 'CAREER TOTAL · BREAKDOWN',
    title: fr ? 'D’où vient ce chiffre ?' : 'Where does this number come from?',
    body: _drillRowsHtml(rows) + (hasBF
      ? `<div class="dash-drill-note">${fr
          ? 'Heures reportées de votre carnet papier — attestation conservée (CAR 401.08(2)(h)).'
          : 'Carried over from your paper logbook — attestation kept on file (CAR 401.08(2)(h)).'}</div>`
      : `<div class="dash-drill-note">${fr
          ? 'Vous n’avez pas déclaré d’heures reportées. Si vous avez un carnet papier, déclarez vos totaux une fois dans Profil → Heures reportées.'
          : 'No brought-forward hours declared. If you have a paper logbook, declare cumulative totals once in Profile → Brought-forward.'}</div>`),
    foot: `${logbookBtn(fr ? 'Voir tous les vols' : 'See all flights')} ${settingsBtn(fr ? 'Heures reportées' : 'Brought-forward')}`
  };
}

// ─── IFR currency drill-down ───────────────────────────────────────
function _drillIFR(fr, addBtn, logbookBtn) {
  const count = (typeof _dashApproachesIn6mo === 'function') ? _dashApproachesIn6mo() : 0;
  const need = Math.max(0, 6 - count);
  const status = count >= 6
    ? (fr ? 'À JOUR' : 'CURRENT')
    : count >= 4 ? (fr ? 'BIENTÔT' : 'EXPIRES SOON') : (fr ? 'EXPIRÉ' : 'NOT CURRENT');

  // Last 6 months of approaches, grouped by date — gives the pilot a visual
  // confirmation of which flights count toward the 6-in-6 minimum.
  const cutoff = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  const contributing = (Array.isArray(flights) ? flights : [])
    .filter(f => f.date >= cutoff && (+f.approaches || 0) > 0)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 10);

  const rows = [
    { k: fr ? 'Approches IFR dans 6 mois' : 'IFR approaches in 6 months', v: `<strong>${count}</strong> / 6` },
    { k: fr ? 'Manquantes pour ÷à jour'    : 'Needed to be current',       v: need > 0 ? `${need}` : (fr ? 'aucune' : 'none') },
    { k: 'Status', v: `<span class="dash-drill-pill ${count >= 6 ? 'ok' : count >= 4 ? 'warn' : 'bad'}">${status}</span>` },
  ];

  let list = '';
  if (contributing.length) {
    list = `<div class="dash-drill-sub">${fr ? 'Vols qui comptent (10 plus récents)' : 'Contributing flights (most recent 10)'}</div>
      <ul class="dash-drill-list">${contributing.map(f =>
        `<li>${esc(f.date || '—')} · ${esc(f.flightNum || '')} · ${esc(f.route || '—')} · <span class="mono">${+f.approaches || 0} appr.</span></li>`
      ).join('')}</ul>`;
  } else {
    list = `<div class="dash-drill-note">${fr
      ? 'Aucune approche logguée dans les 6 derniers mois.'
      : 'No approaches logged in the past 6 months.'}</div>`;
  }

  return {
    eyebrow: fr ? 'CAR 401.05(2) · INSTRUMENTS' : 'CAR 401.05(2) · INSTRUMENTS',
    title: fr ? 'Validité IFR' : 'IFR Currency',
    body: _drillRowsHtml(rows) + list + `<div class="dash-drill-note">${fr
      ? 'Règle : 6 approches IFR (ILS / RNAV / VOR / visuelle après IAP) dans les 6 derniers mois.'
      : 'Rule: 6 IFR approaches (ILS / RNAV / VOR / visual after IAP) in the past 6 months.'}</div>`,
    foot: `${logbookBtn(fr ? 'Voir le carnet' : 'See logbook')} ${addBtn(fr ? 'Enregistrer un vol' : 'Log a flight')}`
  };
}

// ─── Recency drill-down (5 landings / 6 months) ────────────────────
function _drillRecency(fr, addBtn, logbookBtn) {
  const count = (typeof _dashLandingsIn6mo === 'function') ? _dashLandingsIn6mo() : 0;
  const need = Math.max(0, 5 - count);
  const status = count >= 5 ? (fr ? 'À JOUR' : 'CURRENT')
                : count >= 3 ? (fr ? 'BIENTÔT' : 'EXPIRES SOON')
                : (fr ? 'EXPIRÉ' : 'NOT CURRENT');

  const cutoff = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  const contributing = (Array.isArray(flights) ? flights : [])
    .filter(f => f.date >= cutoff && ((+f.ldgDay || 0) + (+f.ldgNight || 0)) > 0)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 10);

  const rows = [
    { k: fr ? 'Atterrissages dans 6 mois' : 'Landings in 6 months', v: `<strong>${count}</strong> / 5` },
    { k: fr ? 'Manquants pour à jour'      : 'Needed to be current',  v: need > 0 ? `${need}` : (fr ? 'aucun' : 'none') },
    { k: 'Status', v: `<span class="dash-drill-pill ${count >= 5 ? 'ok' : count >= 3 ? 'warn' : 'bad'}">${status}</span>` },
  ];

  let list = '';
  if (contributing.length) {
    list = `<div class="dash-drill-sub">${fr ? 'Vols qui comptent' : 'Contributing flights'}</div>
      <ul class="dash-drill-list">${contributing.map(f => {
        const d = +f.ldgDay || 0, n = +f.ldgNight || 0;
        return `<li>${esc(f.date || '—')} · ${esc(f.flightNum || '')} · ${esc(f.route || '—')} · <span class="mono">${d}D ${n}N</span></li>`;
      }).join('')}</ul>`;
  }

  return {
    eyebrow: fr ? 'CAR 401.05(1) · ATTERRISSAGES' : 'CAR 401.05(1) · LANDINGS',
    title: fr ? 'Validité décollages / atterrissages' : 'Takeoff / Landing Recency',
    body: _drillRowsHtml(rows) + list + `<div class="dash-drill-note">${fr
      ? 'Règle : 5 décollages + 5 atterrissages dans les 6 derniers mois pour transporter des passagers.'
      : 'Rule: 5 takeoffs + 5 landings in the past 6 months to carry passengers.'}</div>`,
    foot: `${logbookBtn(fr ? 'Voir le carnet' : 'See logbook')} ${addBtn(fr ? 'Enregistrer un vol' : 'Log a flight')}`
  };
}

// ─── Medical drill-down ─────────────────────────────────────────────
function _drillMedical(profile, fr, settingsBtn) {
  const med = profile.medical || '';
  const ecg = profile.ecg || '';
  const today = new Date().toISOString().slice(0, 10);

  let medDays = null;
  if (med) {
    const ms = (new Date(med).getTime() - new Date(today).getTime()) / 86400000;
    medDays = Math.round(ms);
  }
  let ecgDays = null;
  if (ecg) {
    const ms = (new Date(ecg).getTime() - new Date(today).getTime()) / 86400000;
    ecgDays = Math.round(ms);
  }

  const statusLabel = medDays === null ? (fr ? 'NON DÉFINI' : 'NOT SET')
    : medDays > 60 ? (fr ? 'À JOUR' : 'CURRENT')
    : medDays > 0 ? (fr ? 'BIENTÔT' : 'EXPIRES SOON')
    : (fr ? 'EXPIRÉ' : 'EXPIRED');

  const statusClass = medDays === null ? 'warn'
    : medDays > 60 ? 'ok' : medDays > 0 ? 'warn' : 'bad';

  const rows = [
    { k: fr ? 'Date d’expiration' : 'Expiry date', v: esc(med || (fr ? 'non définie' : 'not set')) },
    { k: fr ? 'Jours restants'     : 'Days remaining', v: medDays === null ? '—' : (medDays > 0 ? medDays : (fr ? 'expiré' : 'expired')) },
    { k: 'Status', v: `<span class="dash-drill-pill ${statusClass}">${statusLabel}</span>` },
    { k: fr ? 'ECG dû'             : 'ECG due', v: ecg ? `${esc(ecg)}${ecgDays !== null ? ` (${ecgDays > 0 ? ecgDays + (fr ? ' j' : ' d') : (fr ? 'dépassé' : 'overdue')})` : ''}` : '—' },
  ];

  return {
    eyebrow: fr ? 'CERTIFICAT MÉDICAL · TC' : 'TRANSPORT CANADA · CAT 1',
    title: fr ? 'Validité médicale' : 'Medical Validity',
    body: _drillRowsHtml(rows) + `<div class="dash-drill-note">${fr
      ? 'CAT 1 (vol commercial) : 12 mois si < 40 ans, 6 mois ensuite. L’ECG accompagne le médical à intervalles définis par TC.'
      : 'Category 1 (commercial flight): 12 months if under 40, 6 months thereafter. ECG accompanies the medical at TC-defined intervals.'}</div>`,
    foot: settingsBtn(fr ? 'Mettre à jour dans Profil' : 'Update in Profile')
  };
}

// ─── Milestone drill-down — typed personal career goal ──────────
// Pilots care about SPECIFIC milestones, not just total hours.
// E.g. Martin's case: "1500 hrs on E195-E2" — that's the upgrade-to-
// captain threshold at Porter. Generic "1500 hrs total" misses
// what actually matters.
//
// Goal data model (profile fields):
//   personalGoalHrs:     numeric target (e.g. 1500)
//   personalGoalKind:    one of 'total' | 'pic' | 'sic' | 'night' |
//                        'xc' | 'me' | 'aircraft'
//   personalGoalContext: aircraft type string when kind === 'aircraft'
//                        (e.g. 'E195-E2', 'B737'). Empty for other kinds.
//
// Progress is computed against the matching counter — so a "1500 hrs
// on E195-E2" goal accumulates only flights where flight.type matches
// the context (case-insensitive substring).
function _drillMilestone(s, profile, fr, F) {
  const totalHrs       = +s.total || +s.block || 0;
  const currentGoal    = +profile.personalGoalHrs || 0;
  const currentKind    = profile.personalGoalKind || 'total';
  const currentContext = profile.personalGoalContext || '';

  // Compute "achieved hours" for the chosen kind
  const achieved = _dashGoalAchievedHours(currentKind, currentContext, s);

  const defaultMilestones = [50, 100, 250, 500, 750, 1000, 1500, 2500, 5000, 10000, 15000, 20000];
  const nextAuto = defaultMilestones.find(m => totalHrs < m) || (defaultMilestones[defaultMilestones.length - 1] + 5000);

  // Active target: personal goal if set + ahead of achieved, else auto
  const activeTarget = (currentGoal > achieved) ? currentGoal : nextAuto;
  const activeAchieved = (currentGoal > 0) ? achieved : totalHrs;
  const remain = Math.max(0, activeTarget - activeAchieved);
  const pct = activeTarget > 0 ? Math.min(100, (activeAchieved / activeTarget) * 100) : 0;

  // Friendly category labels
  const kindLabel = (k) => ({
    'total':    fr ? 'Total carrière'    : 'Career total',
    'pic':      fr ? 'PIC seulement'     : 'PIC only',
    'sic':      fr ? 'SIC seulement'     : 'SIC only',
    'night':    fr ? 'Nuit seulement'    : 'Night only',
    'xc':       fr ? 'Voyage seulement'  : 'Cross-country only',
    'me':       fr ? 'Multi-moteur'      : 'Multi-engine',
    'aircraft': fr ? 'Par aéronef'       : 'By aircraft type',
  })[k] || k;

  const goalDisplay = currentGoal > 0
    ? `${currentGoal.toLocaleString()} hrs · ${kindLabel(currentKind)}${currentKind === 'aircraft' && currentContext ? ` (${esc(currentContext)})` : ''}`
    : (fr ? 'non défini' : 'not set');

  const rows = [
    { k: fr ? 'Heures dans la catégorie' : 'Hours in this category',
      v: `<strong>${F(activeAchieved)}</strong> hrs` },
    { k: fr ? 'Objectif personnel' : 'Personal goal', v: goalDisplay },
    { k: fr ? 'Restant pour la cible' : 'Remaining to target', v: `${F(remain)} hrs` },
    { k: fr ? 'Progression' : 'Progress', v: `<strong>${pct.toFixed(0)}%</strong>` },
  ];

  const kindOptions = [
    ['total',    fr ? 'Heures totales (carrière)'         : 'Total hours (career)'],
    ['pic',      fr ? 'Heures PIC seulement'              : 'PIC hours only'],
    ['sic',      fr ? 'Heures SIC seulement'              : 'SIC hours only'],
    ['night',    fr ? 'Heures de nuit seulement'          : 'Night hours only'],
    ['xc',       fr ? 'Heures voyage seulement'           : 'Cross-country hours only'],
    ['me',       fr ? 'Heures multi-moteur'               : 'Multi-engine hours'],
    ['aircraft', fr ? 'Heures sur un type d’aéronef'      : 'Hours on a specific aircraft type'],
  ].map(([v, lbl]) => `<option value="${v}" ${v === currentKind ? 'selected' : ''}>${esc(lbl)}</option>`).join('');

  const editor = `
    <div class="dash-drill-sub">${esc(fr ? 'Fixer un objectif personnel' : 'Set a personal goal')}</div>
    <div style="display:flex; flex-direction:column; gap:var(--s-2);">
      <select id="dashGoalKind" onchange="(function(){const ac=document.getElementById('dashGoalContextWrap');ac.style.display=document.getElementById('dashGoalKind').value==='aircraft'?'block':'none';})()" style="height:38px; padding:0 12px; font-size:14px; border:1px solid var(--border); border-radius:var(--r-sm); background:var(--bg-surface); color:var(--text);">
        ${kindOptions}
      </select>
      <div id="dashGoalContextWrap" style="display:${currentKind === 'aircraft' ? 'block' : 'none'};">
        <input type="text" id="dashGoalContext" placeholder="${esc(fr ? 'p.ex. E195-E2, B737, DH4' : 'e.g. E195-E2, B737, DH4')}"
               value="${esc(currentContext)}"
               style="width:100%; height:38px; padding:0 12px; font-family:var(--font-mono); font-size:14px; border:1px solid var(--border); border-radius:var(--r-sm); background:var(--bg-surface); color:var(--text);" />
      </div>
      <div style="display:flex; gap:var(--s-2); align-items:center;">
        <input type="number" id="dashGoalInput" min="0" step="50"
               placeholder="${esc(fr ? 'Heures cible · p.ex. 1500' : 'Target hours · e.g. 1500')}"
               value="${currentGoal || ''}"
               style="flex:1; height:38px; padding:0 12px; font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-size:14px; text-align:right; border:1px solid var(--border); border-radius:var(--r-sm); background:var(--bg-surface); color:var(--text);" />
        <button class="btn btn-primary btn-sm" onclick="saveMilestoneGoal()">${esc(fr ? 'Enregistrer' : 'Save')}</button>
        ${currentGoal > 0 ? `<button class="btn btn-ghost btn-sm" onclick="clearMilestoneGoal()">${esc(fr ? 'Effacer' : 'Clear')}</button>` : ''}
      </div>
    </div>
    <div class="dash-drill-note" style="margin-top:var(--s-2);padding-top:var(--s-2);border-top:none;">${
      fr
        ? 'Exemple : <strong>1500 hrs sur E195-E2</strong> — minimum pour upgrade capitaine sur ce type. Cumulo compte les heures bloc des vols dont le type contient « E195-E2 » (insensible à la casse).'
        : 'Example: <strong>1500 hrs on E195-E2</strong> — minimum for captain upgrade on that type. Cumulo counts block hours from flights whose aircraft type contains "E195-E2" (case-insensitive match).'
    }</div>
  `;

  return {
    eyebrow: fr ? 'JALON · OBJECTIF' : 'MILESTONE · GOAL',
    title: fr ? 'Votre prochain jalon' : 'Your next milestone',
    body: _drillRowsHtml(rows) + editor,
    foot: ''
  };
}

// Compute how many hours the pilot has accumulated in the goal category.
// `s` is the totalsWithOpening object (Dashboard already merges brought-
// forward into the aggregate keys). For 'aircraft' goals we iterate
// flights because there's no per-type aggregate in s.
function _dashGoalAchievedHours(kind, context, s) {
  if (!kind || kind === 'total') return +s.total || +s.block || 0;
  if (kind === 'pic')   return +s.pic   || 0;
  if (kind === 'sic')   return +s.sic   || 0;
  if (kind === 'night') return +s.night || 0;
  if (kind === 'xc')    return +s.xc    || 0;
  if (kind === 'me')    return +s.me    || 0;
  if (kind === 'aircraft') {
    if (!context || !Array.isArray(flights)) return 0;
    const needle = context.toUpperCase().trim();
    return flights.reduce((sum, f) => {
      const type = (f.type || '').toUpperCase();
      return type.includes(needle) ? sum + (+f.block || 0) : sum;
    }, 0);
  }
  return 0;
}

// Save handler — called from the milestone drill-down editor.
function saveMilestoneGoal() {
  const valEl  = document.getElementById('dashGoalInput');
  const kindEl = document.getElementById('dashGoalKind');
  const ctxEl  = document.getElementById('dashGoalContext');
  if (!valEl) return;
  const v       = +valEl.value || 0;
  const kind    = (kindEl && kindEl.value) || 'total';
  const context = kind === 'aircraft' ? (ctxEl ? ctxEl.value.trim() : '') : '';
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  if (kind === 'aircraft' && !context) {
    if (typeof showToast === 'function') {
      showToast(fr ? 'Indiquez le type d\'aéronef (ex. E195-E2)' : 'Enter the aircraft type (e.g. E195-E2)', 'error');
    }
    return;
  }
  const profile = DB.loadProfile();
  profile.personalGoalHrs = v > 0 ? v : 0;
  profile.personalGoalKind = v > 0 ? kind : 'total';
  profile.personalGoalContext = v > 0 ? context : '';
  DB.saveProfile(profile);
  if (typeof showToast === 'function') {
    const label = kind === 'aircraft' && context ? ` ${fr ? 'sur' : 'on'} ${context}` : '';
    showToast(v > 0
      ? (fr ? `Objectif : ${v.toLocaleString()} hrs${label}` : `Goal set: ${v.toLocaleString()} hrs${label}`)
      : (fr ? 'Objectif effacé' : 'Goal cleared'),
      'success');
  }
  closeDashDrill();
  if (typeof renderDashboard === 'function') renderDashboard();
}

function clearMilestoneGoal() {
  const profile = DB.loadProfile();
  profile.personalGoalHrs = 0;
  profile.personalGoalKind = 'total';
  profile.personalGoalContext = '';
  DB.saveProfile(profile);
  if (typeof showToast === 'function') {
    const fr = (typeof getLang === 'function') && getLang() === 'fr';
    showToast(fr ? 'Objectif effacé · retour mode auto' : 'Goal cleared · back to auto mode', 'success');
  }
  closeDashDrill();
  if (typeof renderDashboard === 'function') renderDashboard();
}

// ─── Stat strip hours drill-down (PIC / SIC / Night / Multi / XC) ──
function _drillStripHours(kind, value, fr, profile, F, logbookBtn) {
  const labels = {
    pic:   { fr: 'Heures PIC',         en: 'PIC hours',         desc: { fr: 'Pilote aux commandes — capitaine pour 705, instructeur pour FTO, vol solo pour student.', en: 'Pilot-in-command time — captain for 705 ops, instructor for FTO, solo for student.' } },
    sic:   { fr: 'Heures SIC',         en: 'SIC hours',         desc: { fr: 'Co-pilote / Second-In-Command — F/O pour 705.', en: 'Second-in-command / co-pilot time — F/O for 705 ops.' } },
    night: { fr: 'Heures de nuit',     en: 'Night hours',       desc: { fr: 'Temps de vol après l’heure officielle de coucher du soleil (RAC 101.01).', en: 'Flight time after official sunset (CAR 101.01).' } },
    multi: { fr: 'Heures multi-moteur',en: 'Multi-engine hours',desc: { fr: 'Temps de vol sur avion multi-moteur (ME). Toutes catégories : PIC + SIC + Dual.', en: 'Flight time on multi-engine aircraft. All categories: PIC + SIC + Dual.' } },
    xc:    { fr: 'Heures voyage',      en: 'Cross-country hours', desc: { fr: 'Vol > 25 NM depuis le point de départ (CAR 401.34). Calculé automatiquement.', en: 'Flight > 25 NM from departure point (CAR 401.34). Auto-calculated.' } },
  };
  const meta = labels[kind] || { fr: kind, en: kind, desc: { fr: '', en: '' } };
  const title = fr ? meta.fr : meta.en;

  // Source flights: top 5 most recent flights contributing > 0 to this metric.
  const cont = _topContributing(kind, 8);

  const rows = [
    { k: fr ? 'Total carrière' : 'Career total', v: `<strong>${F(value)}</strong> hrs` },
  ];
  // Show brought-forward portion if any
  if (typeof getOpening === 'function') {
    const openingKey = kind === 'multi' ? null : kind;  // me/multi has no single opening key
    if (openingKey) {
      const op = getOpening(openingKey);
      if (op > 0) rows.push({ k: fr ? 'dont reportées' : 'of which brought-forward', v: `${F(op)} hrs` });
    }
  }

  let list = '';
  if (cont.length) {
    list = `<div class="dash-drill-sub">${fr ? 'Vols les plus récents qui contribuent' : 'Most recent contributing flights'}</div>
      <ul class="dash-drill-list">${cont.map(c =>
        `<li>${esc(c.date || '—')} · ${esc(c.label || '')} · <span class="mono">+${F(c.hrs)} hrs</span></li>`
      ).join('')}</ul>`;
  } else {
    list = `<div class="dash-drill-note">${fr ? 'Aucun vol ne contribue actuellement.' : 'No flights currently contribute.'}</div>`;
  }

  return {
    eyebrow: title.toUpperCase(),
    title: title,
    body: rows.length ? _drillRowsHtml(rows) + list + `<div class="dash-drill-note">${fr ? meta.desc.fr : meta.desc.en}</div>` : list,
    foot: logbookBtn(fr ? 'Voir le carnet' : 'See logbook')
  };
}

// Helper: pick the most-recent flights contributing > 0 to a given metric.
function _topContributing(kind, limit) {
  if (!Array.isArray(flights)) return [];
  const out = [];
  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i];
    let hrs = 0;
    switch (kind) {
      case 'pic':   hrs = (+f.meDayPic||0)+(+f.meNightPic||0)+(+f.heliDayPic||0)+(+f.heliNightPic||0)+(+f.seDay||0)+(+f.seNight||0); break;
      case 'sic':   hrs = (+f.meDayCop||0)+(+f.meNightCop||0)+(+f.heliDayCop||0)+(+f.heliNightCop||0); break;
      case 'night': hrs = (+f.meNightPic||0)+(+f.meNightCop||0)+(+f.meNightDual||0)+(+f.heliNightPic||0)+(+f.heliNightCop||0)+(+f.heliNightDual||0)+(+f.seNight||0); break;
      case 'multi': hrs = (+f.meDayPic||0)+(+f.meNightPic||0)+(+f.meDayCop||0)+(+f.meNightCop||0)+(+f.meDayDual||0)+(+f.meNightDual||0); break;
      case 'xc':    hrs = (+f.xcDayPic||0)+(+f.xcNightPic||0)+(+f.xcDayCop||0)+(+f.xcNightCop||0)+(+f.xcDayDual||0)+(+f.xcNightDual||0); break;
    }
    if (hrs > 0) {
      out.push({
        date: f.date,
        label: `${f.flightNum || ''} ${f.route || ''}`.trim() || (f.type || '—'),
        hrs
      });
      if (out.length >= limit) break;
    }
  }
  return out;
}

// ─── Landings drill-down ────────────────────────────────────────────
function _drillLanding(s, fr, addBtn) {
  const day = (Array.isArray(flights) ? flights : []).reduce((a, f) => a + (+f.ldgDay || 0), 0);
  const night = (Array.isArray(flights) ? flights : []).reduce((a, f) => a + (+f.ldgNight || 0), 0);
  const opDay = (typeof getOpening === 'function') ? getOpening('ldgDay') : 0;
  const opNight = (typeof getOpening === 'function') ? getOpening('ldgNight') : 0;

  const rows = [
    { k: fr ? 'Atterrissages totaux'    : 'Total landings', v: `<strong>${s.ldg || 0}</strong>` },
    { k: fr ? 'Jour'                     : 'Day',           v: `${day + opDay}${opDay > 0 ? ` (${opDay} ${fr ? 'reportés' : 'brought-fwd'})` : ''}` },
    { k: fr ? 'Nuit'                     : 'Night',         v: `${night + opNight}${opNight > 0 ? ` (${opNight} ${fr ? 'reportés' : 'brought-fwd'})` : ''}` },
  ];

  return {
    eyebrow: fr ? 'ATTERRISSAGES' : 'LANDINGS',
    title: fr ? 'Atterrissages — détail' : 'Landings — breakdown',
    body: _drillRowsHtml(rows),
    foot: addBtn(fr ? 'Enregistrer un vol' : 'Log a flight')
  };
}

// ─── Shared HTML helpers ────────────────────────────────────────────
function _drillRowsHtml(rows) {
  return `<dl class="dash-drill-rows">${rows.map(r =>
    `<div class="dash-drill-row"><dt>${esc(r.k)}</dt><dd>${r.v}</dd></div>`
  ).join('')}</dl>`;
}

// Close on Escape — symmetric with flight-detail modal behavior.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const ov = document.getElementById('dashDrillOverlay');
  if (ov && ov.classList.contains('show')) closeDashDrill();
});
