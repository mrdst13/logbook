// ═══════════════════════════════════════════
// FEATURE 5 — MEDICAL & RECENCY ALERTS
// ═══════════════════════════════════════════
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
      alerts.push({ level:'red', icon:'🏥', title: t('alert.medicalExpired'), sub: t(absDays === 1 ? 'alert.medicalExpiredSub' : 'alert.medicalExpiredSubPl', { n: absDays }) });
    } else if (days <= 60) {
      alerts.push({ level:'yellow', icon:'🏥', title: t(days === 1 ? 'alert.medicalSoon2' : 'alert.medicalSoon2Pl', { n: days }), sub: t('alert.medicalExpiry', { date: exp.toLocaleDateString(getLang() === 'fr' ? 'fr-CA' : 'en-CA') }) });
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
      alerts.push({ level:'red', icon:'❤️', title: t('alert.ecgExpired'), sub: t(absDays === 1 ? 'alert.ecgExpiredSub' : 'alert.ecgExpiredSubPl', { n: absDays }) });
    } else if (days <= 60) {
      alerts.push({ level:'yellow', icon:'❤️', title: t(days === 1 ? 'alert.ecgSoon' : 'alert.ecgSoonPl', { n: days }), sub: t('alert.ecgExpiry', { date: exp.toLocaleDateString(getLang() === 'fr' ? 'fr-CA' : 'en-CA') }) });
    }
  }

  // Landing currency — only show if NOT current (<3 in 90 days)
  const cutoff90 = new Date(today); cutoff90.setDate(cutoff90.getDate() - 90);
  const cut90str = cutoff90.toISOString().split('T')[0];
  const recentLdg = flights
    .filter(f => f.date >= cut90str)
    .reduce((sum, f) => sum + (+f.ldgDay||0) + (+f.ldgNight||0), 0);
  if (recentLdg < 3) {
    alerts.push({ level: recentLdg > 0 ? 'yellow' : 'red', icon:'🛬', title: t('alert.landingCurrency', { n: recentLdg }), sub: t('alert.landingCurrencySub') });
  }

  // IFR currency — only show if NOT current (<6 approaches in 6 months).
  // CAR 401.05 requires 6 instrument approaches in the preceding 6 months.
  // Counter is approaches only (integer count) — NOT instrument hours.
  const cutoff6m = new Date(today); cutoff6m.setMonth(cutoff6m.getMonth() - 6);
  const cut6mStr = cutoff6m.toISOString().split('T')[0];
  const appCount = flights
    .filter(f => f.date >= cut6mStr)
    .reduce((sum, f) => sum + (+f.approaches||0), 0);
  if (appCount < 6) {
    alerts.push({ level: appCount > 0 ? 'yellow' : 'red', icon:'🌫', title: t('alert.ifrCurrency', { n: appCount }), sub: t('alert.ifrCurrencySub') });
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

  const today = new Date(); today.setHours(0,0,0,0);
  const cutoff6m = new Date(today); cutoff6m.setMonth(cutoff6m.getMonth() - 6);
  const cut6mStr = cutoff6m.toISOString().split('T')[0];
  const recent6m = flights.filter(f => f.date && f.date >= cut6mStr);

  const approachCount = recent6m.reduce((s, f) => s + (+f.approaches || 0), 0);
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
    const key = d.toISOString().substring(0, 7);
    labels.push(d.toLocaleDateString('en-CA', { month: 'short', year: '2-digit' }));
    const hrs = flights.filter(f => f.date && f.date.startsWith(key))
                       .reduce((sum, f) => sum + (+f.block || 0), 0);
    data.push(parseFloat(hrs.toFixed(1)));
  }
  if (monthlyChartInst) { monthlyChartInst.destroy(); monthlyChartInst = null; }
  monthlyChartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Block Hours',
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
        tooltip: { callbacks: { label: ctx => ctx.parsed.y.toFixed(1) + ' hrs' } }
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

