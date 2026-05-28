// ═══════════════════════════════════════════
// FEATURE 9 — YEAR RECAP · Wrapped flow
// ═══════════════════════════════════════════
//
// Spotify-Wrapped-style annual summary. Replaces the old grid layout
// with a vertical scroll-snap carousel of 10 full-bleed cards.
//
// Cards (in order):
//   1. Title (year hero)
//   2. Total Hours (big number + monthly sparkline)
//   3. Top Aircraft (most-flown type + breakdown)
//   4. Top Route (busiest origin↔destination pair)
//   5. Night Flying (% of year after civil twilight)
//   6. Peak Month
//   7. Top 5 Airports
//   8. Milestone (only if pilot crossed a career threshold this year)
//   9. VS Last Year (only if there were flights in year-1)
//   10. Share (4-stat summary + share button)
//
// Cards 8 + 9 are conditional. Pilots with sparse data still get a
// coherent flow.
//
// Data: pulled from the global `flights` array via standard accessors.
// No new schema fields required.

function initRecapYears() {
  const sel = document.getElementById('recapYear');
  if (!sel) return;
  const years = [...new Set(flights.map(f => f.date && f.date.substring(0, 4)).filter(Boolean))].sort().reverse();
  const thisYear = new Date().getFullYear().toString();
  if (!years.includes(thisYear)) years.unshift(thisYear);
  sel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
}

// ─── Stat computation ──────────────────────────────────────────
function computeRecapStats(yFlights, prevFlights, year) {
  const num = (f, k) => +f[k] || 0;

  const total   = yFlights.reduce((s, f) => s + num(f, 'total'), 0);
  const block   = yFlights.reduce((s, f) => s + num(f, 'block'), 0);
  const night   = yFlights.reduce((s, f) =>
    s + num(f, 'meNightPic') + num(f, 'meNightDual') + num(f, 'meNightCop'), 0);
  const ldg     = yFlights.reduce((s, f) =>
    s + num(f, 'ldgDay') + num(f, 'ldgNight'), 0);

  // Aircraft type breakdown
  const acMap = {};
  yFlights.forEach(f => {
    const k = (f.type || '').trim() || '(none)';
    acMap[k] = (acMap[k] || 0) + num(f, 'total');
  });
  const acList = Object.entries(acMap)
    .map(([type, hours]) => ({ type, hours }))
    .filter(a => a.hours > 0)
    .sort((a, b) => b.hours - a.hours);
  const totalAc = acList.reduce((s, a) => s + a.hours, 0) || 1;
  acList.forEach(a => { a.pct = Math.round(a.hours / totalAc * 100); });
  const topAircraft = acList[0] || null;

  // Routes (normalize dep-arr)
  const routeMap = {};
  yFlights.forEach(f => {
    const r = (f.route || '').trim().toUpperCase().replace(/\s+/g, '');
    if (r) routeMap[r] = (routeMap[r] || 0) + 1;
  });
  const routeList = Object.entries(routeMap).sort((a, b) => b[1] - a[1]);
  const topRoute = routeList.length
    ? { route: routeList[0][0], count: routeList[0][1] }
    : null;

  // Airports (split route on dash/slash/space)
  const airMap = {};
  yFlights.forEach(f => {
    (f.route || '').split(/[\s\-\/→↔]+/).forEach(a => {
      a = a.trim().toUpperCase();
      if (a.length === 3 || a.length === 4) airMap[a] = (airMap[a] || 0) + 1;
    });
  });
  const topAirports = Object.entries(airMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code, visits]) => ({ code, visits }));

  // Monthly bars
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    return yFlights.filter(f => f.date && f.date.startsWith(key))
      .reduce((s, f) => s + num(f, 'block'), 0);
  });
  const peakIdx = monthly.indexOf(Math.max(...monthly));
  const peakHours = monthly[peakIdx];
  const peakFlights = yFlights.filter(f =>
    f.date && f.date.startsWith(`${year}-${String(peakIdx + 1).padStart(2, '0')}`)
  ).length;
  const fr = (typeof getLang === 'function' && getLang() === 'fr');
  const monthsFR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const monthsEN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const peakMonthName = (fr ? monthsFR : monthsEN)[peakIdx];

  // Milestone — crossed a career threshold this year?
  // Compute career total before this year vs after
  const thresholds = [100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 5000, 7500, 10000];
  const careerBefore = flights
    .filter(f => f.date && f.date < `${year}-01-01`)
    .reduce((s, f) => s + num(f, 'total'), 0);
  const careerAfter = careerBefore + total;
  let milestone = null;
  for (const m of thresholds) {
    if (careerBefore < m && careerAfter >= m) {
      milestone = { hours: m };
      break;
    }
  }

  // VS last year
  let vsLast = null;
  if (prevFlights.length) {
    const lastTotal = prevFlights.reduce((s, f) => s + num(f, 'total'), 0);
    if (lastTotal > 0) {
      const delta = Math.round((total - lastTotal) / lastTotal * 100);
      vsLast = { thisYear: total, lastYear: lastTotal, delta };
    }
  }

  return {
    total, block, night, ldg,
    flights: yFlights.length,
    topAircraft, acList,
    topRoute,
    topAirports,
    monthly, peakIdx, peakHours, peakFlights, peakMonthName,
    nightPct: total > 0 ? Math.round(night / total * 100) : 0,
    milestone,
    vsLast,
  };
}

// ─── Card factory helpers ──────────────────────────────────────
function rcShell(idx, variant, inner) {
  return `<section class="recap-card rc-${variant}" data-card="${idx + 1}">
    <div class="rc-header">
      <span class="rc-idx">${String(idx + 1).padStart(2, '0')} / 10</span>
      <span class="rc-brand">${cumuloMarkSVG('rc-mark-white')} <span>cumulo</span></span>
    </div>
    <div class="rc-body">${inner}</div>
  </section>`;
}

function cumuloMarkSVG(cls) {
  return `<svg class="${cls}" viewBox="0 0 84 50" width="22" height="14" aria-hidden="true">
    <path d="M 7 32 C 7 6 25 0 42 0 C 59 0 77 6 77 32 L 7 32 Z" fill="currentColor"/>
    <rect x="0" y="40" width="84" height="6" fill="currentColor"/>
  </svg>`;
}

function monthsAbbrev() {
  const fr = (typeof getLang === 'function' && getLang() === 'fr');
  return fr
    ? ['jan','fév','mar','avr','mai','juin','juil','août','sep','oct','nov','déc']
    : ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
}

function fmtHours(n) {
  if (typeof fmt === 'function') return fmt(n);
  return (n || 0).toFixed(1).replace('.', ',');
}

// ─── Individual cards ──────────────────────────────────────────
function cardTitle(year) {
  return rcShell(0, 'title', `
    <div class="rc-huge">${year}</div>
    <div class="rc-eyebrow">${esc(t('recap.wrap.title'))}</div>
  `);
}

function cardTotalHours(s) {
  const max = Math.max(...s.monthly, 1);
  const bars = s.monthly.map(v => {
    const h = Math.max(4, (v / max) * 90);
    return `<div class="rc-bar" style="height:${h}px" title="${v.toFixed(1)} h"></div>`;
  }).join('');
  const labels = monthsAbbrev().map(m => `<span>${m}</span>`).join('');
  return rcShell(1, 'hours', `
    <div class="rc-eyebrow">${esc(t('recap.wrap.totalEyebrow'))}</div>
    <div class="rc-stat-big">${fmtHours(s.total)}</div>
    <div class="rc-sub">${esc(t('recap.wrap.hoursUnit'))}</div>
    <div class="rc-sub-soft">${esc(t('recap.wrap.aboveEarth'))}</div>
    <div class="rc-bars">${bars}</div>
    <div class="rc-bar-labels">${labels}</div>
  `);
}

function cardTopAircraft(s) {
  if (!s.topAircraft) return null;
  const list = s.acList.slice(0, 3).map((a, i) => `
    <div class="rc-row">
      <span class="rc-row-rank">${i + 1}</span>
      <span class="rc-row-key">${esc(a.type)}</span>
      <span class="rc-row-val">${fmtHours(a.hours)} h</span>
      <div class="rc-row-bar" style="width:${a.pct}%"></div>
    </div>
  `).join('');
  return rcShell(2, 'aircraft', `
    <div class="rc-eyebrow">${esc(t('recap.wrap.aircraftEyebrow'))}</div>
    <div class="rc-stat-mid">${esc(s.topAircraft.type)}</div>
    <div class="rc-sub-strong">${fmtHours(s.topAircraft.hours)} h · ${s.topAircraft.pct}%</div>
    <div class="rc-rows">${list}</div>
  `);
}

function cardTopRoute(s) {
  if (!s.topRoute) return null;
  // Try to split the route into two airport codes
  const parts = s.topRoute.route.split(/[-\/→↔]/).filter(Boolean);
  const left = parts[0] || s.topRoute.route;
  const right = parts.slice(1).join('-') || '';
  return rcShell(3, 'route', `
    <div class="rc-eyebrow">${esc(t('recap.wrap.routeEyebrow'))}</div>
    <div class="rc-route-pair">
      <div class="rc-route-code">${esc(left)}</div>
      ${right ? `<div class="rc-route-arrow">↕</div><div class="rc-route-code">${esc(right)}</div>` : ''}
    </div>
    <div class="rc-sub-strong">${s.topRoute.count} ${esc(t(s.topRoute.count === 1 ? 'recap.wrap.flightTimes' : 'recap.wrap.flightTimesPl'))}</div>
  `);
}

function cardNight(s) {
  if (s.night <= 0) return null;
  // Sprinkle stars
  let stars = '';
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const sz = 1.5 + Math.random() * 2;
    const op = 0.4 + Math.random() * 0.6;
    stars += `<span class="rc-star" style="left:${x}%;top:${y}%;width:${sz}px;height:${sz}px;opacity:${op}"></span>`;
  }
  return rcShell(4, 'night', `
    <div class="rc-stars">${stars}</div>
    <div class="rc-eyebrow">${esc(t('recap.wrap.nightEyebrow'))}</div>
    <div class="rc-stat-big">${fmtHours(s.night)}</div>
    <div class="rc-sub">${esc(t('recap.wrap.hoursOfNight'))}</div>
    <div class="rc-sub-soft">${s.nightPct}${esc(t('recap.wrap.pctOfYear'))}</div>
  `);
}

function cardPeakMonth(s) {
  if (s.peakHours <= 0) return null;
  return rcShell(5, 'peak', `
    <div class="rc-eyebrow">${esc(t('recap.wrap.peakEyebrow'))}</div>
    <div class="rc-stat-mid">${esc(s.peakMonthName.toUpperCase())}</div>
    <div class="rc-sub-strong">${fmtHours(s.peakHours)} h · ${s.peakFlights} ${esc(t(s.peakFlights === 1 ? 'recap.wrap.flightTimes' : 'recap.wrap.flightTimesPl'))}</div>
    <div class="rc-sub-soft">${esc(t('recap.wrap.busiestMonth'))}</div>
  `);
}

function cardTopAirports(s) {
  if (!s.topAirports.length) return null;
  const max = s.topAirports[0].visits || 1;
  const rows = s.topAirports.map((a, i) => `
    <div class="rc-row">
      <span class="rc-row-rank">${i + 1}</span>
      <span class="rc-row-key">${esc(a.code)}</span>
      <span class="rc-row-val">${a.visits}</span>
      <div class="rc-row-bar" style="width:${Math.round(a.visits / max * 100)}%"></div>
    </div>
  `).join('');
  return rcShell(6, 'airports', `
    <div class="rc-eyebrow">${esc(t('recap.wrap.airportsEyebrow'))}</div>
    <div class="rc-stat-mid">${esc(t('recap.wrap.airportsTitle'))}</div>
    <div class="rc-rows">${rows}</div>
  `);
}

function cardMilestone(s) {
  if (!s.milestone) return null;
  return rcShell(7, 'milestone', `
    <div class="rc-eyebrow">${esc(t('recap.wrap.milestoneEyebrow'))}</div>
    <div class="rc-badge">✦</div>
    <div class="rc-stat-mid">${fmtHours(s.milestone.hours)} h</div>
    <div class="rc-sub-strong">${esc(t('recap.wrap.careerTotal'))}</div>
  `);
}

function cardVsLastYear(s) {
  if (!s.vsLast) return null;
  const sign = s.vsLast.delta >= 0 ? '+' : '';
  const max = Math.max(s.vsLast.thisYear, s.vsLast.lastYear) || 1;
  const hOld = Math.max(40, Math.round(s.vsLast.lastYear / max * 220));
  const hNew = Math.max(40, Math.round(s.vsLast.thisYear / max * 220));
  const yr = parseInt(document.getElementById('recapYear').value, 10);
  return rcShell(8, 'vs', `
    <div class="rc-eyebrow">${esc(t('recap.wrap.vsEyebrow'))}</div>
    <div class="rc-stat-big rc-stat-delta">${sign}${s.vsLast.delta} %</div>
    <div class="rc-sub">${esc(t(s.vsLast.delta >= 0 ? 'recap.wrap.moreThanLast' : 'recap.wrap.lessThanLast'))}</div>
    <div class="rc-vs-bars">
      <div class="rc-vs-col">
        <div class="rc-vs-bar rc-vs-bar-old" style="height:${hOld}px"></div>
        <div class="rc-vs-label">${yr - 1}</div>
        <div class="rc-vs-num">${fmtHours(s.vsLast.lastYear)} h</div>
      </div>
      <div class="rc-vs-col">
        <div class="rc-vs-bar rc-vs-bar-new" style="height:${hNew}px"></div>
        <div class="rc-vs-label rc-vs-label-strong">${yr}</div>
        <div class="rc-vs-num">${fmtHours(s.vsLast.thisYear)} h</div>
      </div>
    </div>
  `);
}

function cardShare(year, s) {
  return rcShell(9, 'share', `
    <div class="rc-eyebrow">${esc(t('recap.wrap.shareEyebrow'))} ${year}</div>
    <div class="rc-share-grid">
      <div class="rc-share-cell"><span class="rc-share-lbl">${esc(t('recap.wrap.hoursLbl'))}</span><span class="rc-share-val">${fmtHours(s.total)}</span></div>
      <div class="rc-share-cell"><span class="rc-share-lbl">${esc(t('recap.wrap.flightsLbl'))}</span><span class="rc-share-val">${s.flights}</span></div>
      <div class="rc-share-cell"><span class="rc-share-lbl">${esc(t('recap.wrap.acLbl'))}</span><span class="rc-share-val">${s.acList.length}</span></div>
      <div class="rc-share-cell"><span class="rc-share-lbl">${esc(t('recap.wrap.airportsLbl'))}</span><span class="rc-share-val">${s.topAirports.length}</span></div>
    </div>
    <div class="rc-share-brand">
      ${cumuloMarkSVG('rc-mark-share')}
      <span class="rc-share-wm">cumulo</span>
    </div>
    <button type="button" class="rc-share-btn" onclick="shareRecap()">${esc(t('recap.wrap.shareBtn'))}</button>
    <div class="rc-share-footer">#YearInTheAir · #CumuloWrapped</div>
  `);
}

function shareRecap() {
  const year = document.getElementById('recapYear').value;
  const yFlights = flights.filter(f => f.date && f.date.startsWith(year));
  const total = yFlights.reduce((s, f) => s + (+f.total || 0), 0);
  const text = (typeof getLang === 'function' && getLang() === 'fr')
    ? `Mon ${year} dans les airs : ${fmtHours(total)} heures · ${yFlights.length} vols. #CumuloWrapped`
    : `My ${year} in the air: ${fmtHours(total)} hours · ${yFlights.length} flights. #CumuloWrapped`;
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
    if (typeof showToast === 'function') showToast(t('recap.wrap.copied'), 'success');
  }
}

// ─── Main render ───────────────────────────────────────────────
function renderRecap() {
  const sel = document.getElementById('recapYear');
  const container = document.getElementById('recapCards');
  if (!sel || !container) return;
  const year = sel.value;
  const yFlights = flights.filter(f => f.date && f.date.startsWith(year));
  const prevFlights = flights.filter(f => f.date && f.date.startsWith(String(+year - 1)));

  if (!yFlights.length) {
    container.innerHTML = `<section class="recap-card rc-empty">
      <div class="rc-body">
        <div class="rc-eyebrow">${esc(t('recap.wrap.empty'))}</div>
        <p class="rc-empty-msg">${esc(t('recap.noFlights'))}</p>
      </div>
    </section>`;
    updateRecapProgress();
    return;
  }

  const stats = computeRecapStats(yFlights, prevFlights, +year);

  const cards = [
    cardTitle(year),
    cardTotalHours(stats),
    cardTopAircraft(stats),
    cardTopRoute(stats),
    cardNight(stats),
    cardPeakMonth(stats),
    cardTopAirports(stats),
    cardMilestone(stats),
    cardVsLastYear(stats),
    cardShare(year, stats),
  ].filter(Boolean);

  container.innerHTML = cards.join('');
  container.scrollTop = 0;
  setupRecapProgress();
}

// ─── Progress indicator ───────────────────────────────────────
function setupRecapProgress() {
  const container = document.getElementById('recapCards');
  if (!container) return;
  // Replace existing listener
  container.onscroll = updateRecapProgress;
  updateRecapProgress();
}

function updateRecapProgress() {
  const container = document.getElementById('recapCards');
  const progress = document.getElementById('recapProgress');
  if (!container || !progress) return;
  const cards = container.querySelectorAll('.recap-card');
  if (!cards.length) { progress.textContent = ''; return; }
  // Find the card most centered
  const containerMid = container.scrollTop + container.clientHeight / 2;
  let activeIdx = 0;
  let bestDist = Infinity;
  cards.forEach((card, i) => {
    const cardMid = card.offsetTop + card.offsetHeight / 2;
    const dist = Math.abs(containerMid - cardMid);
    if (dist < bestDist) { bestDist = dist; activeIdx = i; }
  });
  progress.textContent = `${activeIdx + 1} / ${cards.length}`;
}
