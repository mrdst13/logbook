// ═══════════════════════════════════════════
// FEATURE 9 — YEAR RECAP
// ═══════════════════════════════════════════
let recapChartInst = null;

function initRecapYears() {
  const sel = document.getElementById('recapYear');
  if (!sel) return;
  const years = [...new Set(flights.map(f => f.date&&f.date.substring(0,4)).filter(Boolean))].sort().reverse();
  const thisYear = new Date().getFullYear().toString();
  if (!years.includes(thisYear)) years.unshift(thisYear);
  sel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
}

function renderRecap() {
  const sel = document.getElementById('recapYear');
  if (!sel) return;
  const year = sel.value;
  const yFlights = flights.filter(f => f.date && f.date.startsWith(year));

  // Stats
  const total = yFlights.reduce((s,f) => s + (+f.total||0), 0);
  const block = yFlights.reduce((s,f) => s + (+f.block||0), 0);
  const ldg   = yFlights.reduce((s,f) => s + (+f.ldgDay||0) + (+f.ldgNight||0), 0);
  // Night = all night flying (ME + heli + single-engine) — matches calcStats().night
  // so the Recap and the Dashboard never disagree for heli/SE pilots.
  const night = yFlights.reduce((s,f) => s
    + (+f.meNightPic||0) + (+f.meNightDual||0) + (+f.meNightCop||0)
    + (+f.heliNightPic||0) + (+f.heliNightDual||0) + (+f.heliNightCop||0)
    + (+f.seNight||0), 0);
  document.getElementById('recapStats').innerHTML = [
    [t('recap.totalHoursLbl'), fmt(total), t('recap.hoursUnit')],
    [t('recap.blockHoursLbl'), fmt(block), t('recap.hoursUnit')],
    [t('recap.nightTimeLbl'),  fmt(night), t('recap.hoursUnit')],
    [t('recap.landingsLbl'),   ldg,        t('recap.totalUnit')],
  ].map(([lbl,val,unit]) => `
    <div class="stat-card">
      <div class="stat-label">${lbl}</div>
      <div class="stat-value">${val}</div>
      <div class="stat-unit">${unit}</div>
    </div>`).join('');

  // Monthly chart
  const locale = (typeof getLang === 'function' && getLang() === 'fr') ? 'fr-CA' : 'en-CA';
  const months = Array.from({length:12}, (_,i) => {
    const key = `${year}-${String(i+1).padStart(2,'0')}`;
    const d = new Date(+year, i, 1);
    return {
      label: d.toLocaleDateString(locale,{month:'short'}),
      val: parseFloat(yFlights.filter(f=>f.date&&f.date.startsWith(key)).reduce((s,f)=>s+(+f.block||0),0).toFixed(1))
    };
  });

  const canvas = document.getElementById('recapChart');
  if (canvas && typeof Chart !== 'undefined') {
    if (recapChartInst) { recapChartInst.destroy(); recapChartInst = null; }
    recapChartInst = new Chart(canvas, {
      type:'bar',
      data:{
        labels: months.map(m=>m.label),
        datasets:[{
          label:t('chart.blockHours'),data:months.map(m=>m.val),
          backgroundColor:'rgba(61,123,196,0.72)',borderColor:'rgba(61,123,196,1)',borderWidth:1.5,borderRadius:4
        }]
      },
      options:{
        responsive:true,animation:{duration:600},
        plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>ctx.parsed.y.toFixed(1)+' '+t('hero.unitHours')}}},
        scales:{y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.05)'},ticks:{font:{family:"var(--font-mono)",size:10},color:'#6b7fa3'}},
                x:{grid:{display:false},ticks:{font:{family:"var(--font-mono)",size:10},color:'#6b7fa3'}}}
      }
    });
  }

  // Fun facts — pilot's year in relatable units
  const ff = document.getElementById('recapFunFacts');
  if (ff) {
    if (total <= 0) {
      ff.innerHTML = '';
    } else {
      // Real great-circle distance — NO invented cruise-speed constant.
      // Sum the actual route distance of every flight whose dep + arr
      // airports are in AIRPORT_COORDS. Flights with unknown airports are
      // skipped (not estimated) so the number is honest, never fabricated.
      // (Rule: never assume/invent numbers — empty/partial > guessed.)
      let km = 0, measured = 0, unmeasured = 0;
      const haveGeo = (typeof haversineKM === 'function') && (typeof AIRPORT_COORDS !== 'undefined');
      if (haveGeo) {
        yFlights.forEach(f => {
          const depICAO = f.dep_icao || (typeof iataToIcao === 'function' ? iataToIcao((f.route||'').split('-')[0]) : null);
          const arrICAO = f.arr_icao || (typeof iataToIcao === 'function' ? iataToIcao((f.route||'').split('-')[1]) : null);
          const dep = depICAO && AIRPORT_COORDS[depICAO];
          const arr = arrICAO && AIRPORT_COORDS[arrICAO];
          if (dep && arr) { km += haversineKM(dep.lat, dep.lon, arr.lat, arr.lon); measured++; }
          else { unmeasured++; }
        });
      }
      const earthCircum = 40075;
      const earthTours = km / earthCircum;
      // Derived facts use BLOCK time (= Transport Canada flight time, CAR 101.01),
      // matching the dashboard hero and the monthly chart.
      const daysAir = block / 24;
      // "Different aircraft" = distinct REGISTRATIONS (tails), not types — a pilot
      // flying many tails of one type should not see "1 aircraft".
      const acRegs = [...new Set(yFlights.map(f => (f.reg || '').trim().toUpperCase()).filter(Boolean))];
      const flightsCount = yFlights.length;
      const avgLen = flightsCount > 0 ? block / flightsCount : 0;
      const kmFmt = Math.round(km).toLocaleString(locale);
      // Sub line is transparent : if some legs couldn't be measured (unknown
      // airport), say so rather than implying the figure covers everything.
      const earthSub = unmeasured > 0
        ? t('recap.fun.earthSubPartial', { km: kmFmt, measured, total: flightsCount })
        : t('recap.fun.earthSub', { km: kmFmt });
      const facts = [];
      // Only show the Earth-tours fact when we actually measured distance.
      if (measured > 0) {
        facts.push({ emoji: '🌍', text: t('recap.fun.earth', { n: earthTours.toFixed(2) }), sub: earthSub });
      }
      facts.push(
        { emoji: '⏱',  text: t('recap.fun.days',     { n: daysAir.toFixed(1) }),    sub: t('recap.fun.daysSub') },
        { emoji: '🛬', text: t('recap.fun.flights',  { n: flightsCount }),          sub: t('recap.fun.flightsSub',  { avg: avgLen.toFixed(1) }) },
        { emoji: '✈️', text: t('recap.fun.aircraft', { n: acRegs.length }),        sub: t('recap.fun.aircraftSub') }
      );
      ff.innerHTML = facts.map(f => `
        <div class="recap-fun-item">
          <div class="recap-fun-emoji">${f.emoji}</div>
          <div class="recap-fun-text">${esc(f.text)}</div>
          <div class="recap-fun-sub">${esc(f.sub)}</div>
        </div>`).join('');
    }
  }

  // Top airports (from routes)
  const airports = {};
  yFlights.forEach(f => {
    (f.route||'').split(/[\s\-\/]+/).forEach(a => {
      a = a.trim().toUpperCase();
      if (a.length===3 || a.length===4) airports[a] = (airports[a]||0) + 1;
    });
  });
  const topAirports = Object.entries(airports).sort((a,b)=>b[1]-a[1]).slice(0,8);
  document.getElementById('recapAirports').innerHTML = topAirports.length
    ? topAirports.map(([a,n]) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-family:var(--font-mono);font-weight:600;color:var(--navy)">${esc(a)}</span>
        <span style="color:var(--text-muted);font-size:12px">${esc(t(n === 1 ? 'recap.visit' : 'recap.visitPl', { n }))}</span>
      </div>`).join('')
    : `<p style="color:var(--text-muted);font-family:var(--font-mono);font-size:12px">${esc(t('recap.noAirports'))}</p>`;

  // Top routes
  const routes = {};
  yFlights.forEach(f => {
    const r = (f.route||'').trim().toUpperCase();
    if (r) routes[r] = (routes[r]||0) + 1;
  });
  const topRoutes = Object.entries(routes).sort((a,b)=>b[1]-a[1]).slice(0,10);
  document.getElementById('recapRoutes').innerHTML = topRoutes.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:8px">${topRoutes.map(([r,n]) =>
        `<div style="background:var(--bg-subtle);border-radius:6px;padding:5px 12px;font-family:var(--font-mono);font-size:11px;color:var(--navy)">
          ${esc(r)} <span style="color:var(--accent);margin-left:4px">×${n}</span>
        </div>`).join('')}</div>`
    : `<p style="color:var(--text-muted);font-family:var(--font-mono);font-size:12px">${esc(t('recap.noRoutes'))}</p>`;
}

