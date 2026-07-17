// ═══════════════════════════════════════════
// ALERT GLYPHS — line-art SVGs to replace emoji chrome
// Per brand: no emoji in chrome. currentColor inherits the alert tint
// (red / amber / green via .alert-bar.{red,yellow,green}).
// ═══════════════════════════════════════════
const ICON_LANDING_GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M2.5 13.5l8 2.5 4-9 3 .5 1.5 4-5 1.5-2.5 1z"/></svg>';
const ICON_IFR_GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12a4 4 0 0 1 4-4 5 5 0 0 1 10 1 3.5 3.5 0 0 1 0 7H6a3 3 0 0 1-1-4z"/><path d="M6 18h12M8 21h8"/></svg>';

// ═══════════════════════════════════════════
// PILOT-TYPE ADAPTATION
// Bush / float / private VFR / student pilots don't fly IFR. The
// "0 / 6 approaches" alert + IFR currency renewal line are noise for
// them. This helper returns true ONLY if the pilot actually flies
// instruments — either because they're a 705 line pilot (every flight
// shoots an approach) OR because they have a real IFR history.
// ═══════════════════════════════════════════
function needsIFRTracking(profile) {
  const p = profile || (typeof DB !== 'undefined' ? DB.loadProfile() : {}) || {};
  const pilotType = p.pilotType || 'airline705';

  // 705 line pilots always need it — every flight under 705 ops is
  // typically IFR, and approaches feed the CAR 401.05 currency counter.
  if (pilotType === 'airline705') return true;

  // For everyone else, infer from actual history: any approach or
  // instrument time logged in the last 12 months = pilot is doing IFR
  // and wants to track currency.
  if (!Array.isArray(flights)) return false;
  // Local civil date, never toISOString (= UTC date, reads tomorrow in the
  // evening in Toronto). Future-dated flights are not history — excluded.
  const today = localTodayStr();
  const cutoffStr = shiftMonthsStr(today, -12);
  return flights.some(f =>
    f && f.date && f.date >= cutoffStr && f.date <= today &&
    ((+f.approaches || 0) > 0 ||
     (+f.instActual || 0) > 0 ||
     (+f.instHood   || 0) > 0 ||
     (+f.instSim    || 0) > 0)
  );
}

// ═══════════════════════════════════════════
// FEATURE 5 — MEDICAL & RECENCY ALERTS
// ═══════════════════════════════════════════
// Medical / ECG alert glyphs — line-art, no emoji in chrome (brand rule;
// Martin 2026-06-25: emoji read as childish). currentColor inherits the
// alert tint via .alert-bar.{red,yellow}.
const ICON_MEDICAL_GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z"/></svg>';
const ICON_ECG_GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l2 5 4-10 2 5h6"/></svg>';

function renderAlerts() {
  const section = document.getElementById('alertsSection');
  if (!section) return;
  const p = DB.loadProfile();
  const today = new Date(); today.setHours(0,0,0,0);
  const alerts = [];

  // Show alerts ONLY when there's something the pilot needs to act on.
  // Green / "all good" states are hidden — no clutter on the dashboard.

  // Medical expiry — only show if expired or expiring soon (<60 days)
  if (p.medical) {
    const exp = new Date(p.medical); exp.setHours(0,0,0,0);
    const days = Math.round((exp - today) / 86400000);
    const absDays = Math.abs(days);
    if (days < 0) {
      alerts.push({ level:'red', icon: ICON_MEDICAL_GLYPH, title: t('alert.medicalExpired'), sub: t(absDays === 1 ? 'alert.medicalExpiredSub' : 'alert.medicalExpiredSubPl', { n: absDays }) });
    } else if (days <= 60) {
      alerts.push({ level:'yellow', icon: ICON_MEDICAL_GLYPH, title: t(days === 1 ? 'alert.medicalSoon2' : 'alert.medicalSoon2Pl', { n: days }), sub: t('alert.medicalExpiry', { date: exp.toLocaleDateString(getLang() === 'fr' ? 'fr-CA' : 'en-CA') }) });
    }
    // > 60 days = current = no alert shown
  }

  // ECG due date — TC Cat 1 standard: at first issuance under 40, then every
  // 24 months between 40-65, annual at 65+. We let the pilot enter the next
  // due date manually and just alert when it approaches/passes.
  if (p.ecg) {
    const exp = new Date(p.ecg); exp.setHours(0,0,0,0);
    const days = Math.round((exp - today) / 86400000);
    const absDays = Math.abs(days);
    if (days < 0) {
      alerts.push({ level:'red', icon: ICON_ECG_GLYPH, title: t('alert.ecgExpired'), sub: t(absDays === 1 ? 'alert.ecgExpiredSub' : 'alert.ecgExpiredSubPl', { n: absDays }) });
    } else if (days <= 60) {
      alerts.push({ level:'yellow', icon: ICON_ECG_GLYPH, title: t(days === 1 ? 'alert.ecgSoon' : 'alert.ecgSoonPl', { n: days }), sub: t('alert.ecgExpiry', { date: exp.toLocaleDateString(getLang() === 'fr' ? 'fr-CA' : 'en-CA') }) });
    }
  }

  // Passenger-carrying recent experience (CAR 401.05(2)(a)): within the
  // preceding 6 MONTHS, at least 5 take-offs AND 5 landings — NOT the old
  // (non-existent) "3 landings in 90 days" rule. Each flight leg is one
  // take-off; landings come from the logged ldg counts.
  // Night passenger currency (5 night take-offs + 5 night landings,
  // CAR 401.05(2)(b)) needs per-flight night take-off data the manual form
  // doesn't yet capture — tracked as a separate item (see C4).
  // Use the SAME helpers as the validity ring (countsTowardRecency-filtered,
  // circuit-aware) so the alert bar and the ring can never disagree on the
  // same screen — one source of truth for recent experience.
  const toCount6 = _dashTakeoffsIn6mo();
  const ldgCount6 = _dashLandingsIn6mo();
  if (toCount6 < 5 || ldgCount6 < 5) {
    const shortfall = Math.min(toCount6, ldgCount6);
    alerts.push({ level: shortfall > 0 ? 'yellow' : 'red', icon: ICON_LANDING_GLYPH, title: t('alert.landingCurrency', { n: shortfall }), sub: t('alert.landingCurrencySub') });
  }

  // IFR currency — only show if NOT current (<6 approaches in 6 months).
  // CAR 401.05 requires 6 instrument approaches in the preceding 6 months.
  // Counter is approaches only (integer count) — NOT instrument hours.
  //
  // Hidden entirely for bush / private VFR / student / helicopter VFR
  // pilots who don't fly IFR (no history in last 12 months). They never
  // see "0 / 6 approaches" noise.
  if (needsIFRTracking(p)) {
    // Single source of truth: countsTowardRecency-filtered (CAR 401.05(3.1) —
    // basic training devices don't count toward the six approaches), shared with
    // the currency card and the validity ring so they can never disagree.
    const appCount = _dashApproachesIn6mo();
    if (appCount < 6) {
      alerts.push({ level: appCount > 0 ? 'yellow' : 'red', icon: ICON_IFR_GLYPH, title: t('alert.ifrCurrency', { n: appCount }), sub: t('alert.ifrCurrencySub') });
    }
  }

  if (!alerts.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  section.innerHTML = alerts.map(a => `
    <div class="alert-bar ${a.level}">
      <div class="alert-icon">${a.icon}</div>
      <div class="alert-text">
        ${a.title}
        <div class="alert-sub">${a.sub}</div>
      </div>
    </div>`).join('');
}

// ═══════════════════════════════════════════
// IFR CURRENCY CARD (CAR 401.05 — always-visible dashboard status)
// ═══════════════════════════════════════════
function renderCurrencyCard() {
  const card = document.getElementById('currencyCard');
  if (!card) return;

  // Same window as the alert bar and the validity ring: sixMonthCutoffStr()
  // (local civil date — see registre §401.05), bounded above by local today
  // so a future-dated flight never counts toward currency.
  const cut6mStr = sixMonthCutoffStr();
  const todayStr = localTodayStr();
  const recent6m = flights.filter(f => f.date && f.date >= cut6mStr && f.date <= todayStr);

  // Approaches: filtered to qualifying devices (CAR 401.05(3.1)) via the shared
  // helper, so the card matches the alert bar and the validity ring. Instrument
  // time is NOT device-filtered — CAR 101.01 counts simulated/ground instrument
  // time too (see _dashInstrumentTimeIn6mo + registre).
  const approachCount = _dashApproachesIn6mo();
  const instHours = recent6m.reduce((s, f) => s + (+f.instActual || 0) + (+f.instHood || 0) + (+f.instSim || 0), 0);

  const setStatus = (elId, ok, low) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.classList.remove('ok','low','bad');
    if (ok)       { el.classList.add('ok');  el.textContent = t('curr.statusCurrent'); }
    else if (low) { el.classList.add('low'); el.textContent = t('curr.statusLow');     }
    else          { el.classList.add('bad'); el.textContent = t('curr.statusExpired'); }
  };

  document.getElementById('cur-app-count').textContent = approachCount;
  setStatus('cur-app-status', approachCount >= 6, approachCount > 0);
  document.getElementById('cur-app-sub').textContent =
    recent6m.length === 0
      ? t('curr.noFlights6mo')
      : t(recent6m.length === 1 ? 'curr.acrossFlights' : 'curr.acrossFlightsPl', { n: recent6m.length });

  document.getElementById('cur-hrs-count').textContent = instHours.toFixed(1);
  setStatus('cur-hrs-status', instHours >= 6, instHours > 0);
  document.getElementById('cur-hrs-sub').textContent = t('curr.instTimeSub');
}

// ═══════════════════════════════════════════
// FEATURE 4 — MONTHLY CHART
// ═══════════════════════════════════════════
let monthlyChartInst = null;

function renderChart() {
  const canvas = document.getElementById('monthlyChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const now = new Date();
  const labels = [], data = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    // Month key from LOCAL components — toISOString on a local-midnight Date
    // reads the previous month east of UTC (same UTC-date bug family).
    const key = d.getFullYear() + '-' + ((d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1));
    labels.push(d.toLocaleDateString(getLang() === 'fr' ? 'fr-CA' : 'en-CA', { month: 'short', year: '2-digit' }));
    const hrs = flights.filter(f => f.date && f.date.startsWith(key))
                       .reduce((sum, f) => sum + flightTimeOf(f), 0);
    data.push(parseFloat(hrs.toFixed(1)));
  }
  if (monthlyChartInst) { monthlyChartInst.destroy(); monthlyChartInst = null; }
  monthlyChartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: t('chart.blockHours'),
        data,
        backgroundColor: 'rgba(61,123,196,0.72)',
        borderColor: 'rgba(61,123,196,1)',
        borderWidth: 1.5,
        borderRadius: 5,
      }]
    },
    options: {
      responsive: true,
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ctx.parsed.y.toFixed(1) + ' ' + t('hero.unitHours') } }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { font: { family: "'JetBrains Mono', ui-monospace, monospace", size: 10 }, color: '#6b7fa3' }
        },
        x: {
          grid: { display: false },
          ticks: { font: { family: "'JetBrains Mono', ui-monospace, monospace", size: 10 }, color: '#6b7fa3' }
        }
      }
    }
  });
}

