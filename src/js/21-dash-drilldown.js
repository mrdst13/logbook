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
    case 'recency': return _drillRecency(fr, addBtn, logbookBtn);
    case 'medical': return _drillMedical(profile, fr, settingsBtn);
    case 'pic':   return _drillStripHours('pic',   s.pic,   fr, profile, F, logbookBtn);
    case 'sic':   return _drillStripHours('sic',   s.sic,   fr, profile, F, logbookBtn);
    case 'night': return _drillStripHours('night', s.night, fr, profile, F, logbookBtn);
    case 'multi': return _drillStripHours('multi', s.me,    fr, profile, F, logbookBtn);
    case 'xc':    return _drillStripHours('xc',    s.xc,    fr, profile, F, logbookBtn);
    case 'ldg':   return _drillLanding(s, fr, addBtn);
    default: return null;
  }
}

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
    { k: fr ? 'Date d’expiration' : 'Expiry date', v: med || (fr ? 'non définie' : 'not set') },
    { k: fr ? 'Jours restants'     : 'Days remaining', v: medDays === null ? '—' : (medDays > 0 ? medDays : (fr ? 'expiré' : 'expired')) },
    { k: 'Status', v: `<span class="dash-drill-pill ${statusClass}">${statusLabel}</span>` },
    { k: fr ? 'ECG dû'             : 'ECG due', v: ecg ? `${ecg}${ecgDays !== null ? ` (${ecgDays > 0 ? ecgDays + (fr ? ' j' : ' d') : (fr ? 'dépassé' : 'overdue')})` : ''}` : '—' },
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

// ─── Stat strip hours drill-down (PIC / SIC / Night / Multi / XC) ──
function _drillStripHours(kind, value, fr, profile, F, logbookBtn) {
  const labels = {
    pic:   { fr: 'Heures PIC',         en: 'PIC hours',         desc: { fr: 'Pilote aux commandes — capitaine pour 705, instructeur pour FTO, vol solo pour student.', en: 'Pilot-in-command time — captain for 705 ops, instructor for FTO, solo for student.' } },
    sic:   { fr: 'Heures SIC',         en: 'SIC hours',         desc: { fr: 'Co-pilote / Second-In-Command — F/O pour 705.', en: 'Second-in-command / co-pilot time — F/O for 705 ops.' } },
    night: { fr: 'Heures de nuit',     en: 'Night hours',       desc: { fr: 'Temps de vol après l’heure officielle de coucher du soleil (RAC 101.01).', en: 'Flight time after official sunset (CAR 101.01).' } },
    multi: { fr: 'Heures multi-moteur',en: 'Multi-engine hours',desc: { fr: 'Temps de vol sur avion multi-moteur (ME). Toutes catégories : PIC + SIC + Dual.', en: 'Flight time on multi-engine aircraft. All categories: PIC + SIC + Dual.' } },
    xc:    { fr: 'Heures voyage',      en: 'Cross-country hours', desc: { fr: 'Vol > 50 NM depuis le point de départ (CAR 401.34). Calculé automatiquement.', en: 'Flight > 50 NM from departure point (CAR 401.34). Auto-calculated.' } },
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
      case 'pic':   hrs = (+f.meDayPic||0)+(+f.meNightPic||0)+(+f.heliDayPic||0)+(+f.heliNightPic||0)+(+f.seDay||0); break;
      case 'sic':   hrs = (+f.meDayCop||0)+(+f.meNightCop||0)+(+f.heliDayCop||0)+(+f.heliNightCop||0)+(+f.picus||0); break;
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
