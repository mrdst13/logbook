// ═══════════════════════════════════════════
//  FLIGHT-TIME LIMITS TRACKER (page-duty)
//  Rolling-window flight time vs the CAR 700.27 maximums (SOR/2018-269),
//  verified against laws-lois and consigned to docs/REGISTRE-REGLEMENTAIRE.md
//  (2026-06-30):
//     112 h / 28 days · 300 h / 90 days · 1000 h / 365 days
//     (8 h / 24 h applies to SINGLE-PILOT operations only)
//  Applies to commercial operations (Subpart 700). Simulator time is NOT flight
//  time and is excluded. The per-DAY ceiling for multi-crew is the flight duty
//  period (FDP) table, not a simple flight-time number — so the tracker shows
//  the three cumulative limits + a note pointing to the operator's program for
//  the daily FDP. Numbers are never fabricated (see registre).
// ═══════════════════════════════════════════

const DUTY_LIMITS = [
  { days: 28,  limit: 112,  fr: '28 jours',  en: '28 days' },
  { days: 90,  limit: 300,  fr: '90 jours',  en: '90 days' },
  { days: 365, limit: 1000, fr: '365 jours', en: '365 days' }
];

// Guard so the self-healing forecast sync fires at most once per page render cycle.
let _dutyForecastSyncing = false;
function _navblueConfigured() { try { return !!localStorage.getItem('cumulo_navblue_url'); } catch (e) { return false; } }
function _forecastCached() { try { return !!localStorage.getItem('cumulo_roster_forecast_v1'); } catch (e) { return false; } }

// Flight time (not sim) in the last N days, from logged flights.
function _dutyFlightTimeInDays(days) {
  if (!Array.isArray(flights)) return 0;
  const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - days);
  const cutStr = cutoff.toISOString().split('T')[0];
  return flights.reduce(function (sum, f) {
    if (f.isSim) return sum;                      // simulator time is not flight time
    if (!f.date || f.date < cutStr) return sum;
    return sum + (+f.total || +f.block || 0);
  }, 0);
}

function renderDutyTracker() {
  const host = document.getElementById('dutyTracker');
  if (!host) return;
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const fh = function (n) { return (Math.round((+n || 0) * 10) / 10).toLocaleString(fr ? 'fr-CA' : 'en-CA'); };

  // Self-heal: the forecast cache is written only by a sync on this (or a newer)
  // build. If the roster IS configured but the cache was never built — e.g. the
  // last sync ran on an older build, or the anti-spam gate skipped auto-sync —
  // force one silent sync so the forecast populates itself instead of telling the
  // pilot "no roster connected". Guarded to fire once, then re-render. (2026-07-14)
  if (_navblueConfigured() && !_forecastCached() && !_dutyForecastSyncing && typeof syncNavblueNow === 'function') {
    _dutyForecastSyncing = true;
    Promise.resolve(syncNavblueNow({ silent: true }))
      .catch(function () {})
      .finally(function () { renderDutyTracker(); });   // _dutyForecastSyncing stays true → no loop; cache now exists (even if empty)
  }

  const bars = DUTY_LIMITS.map(function (lim) {
    const have = _dutyFlightTimeInDays(lim.days);
    const ratio = lim.limit > 0 ? have / lim.limit : 0;
    const pctW = Math.min(100, Math.round(ratio * 100));
    const cls = ratio >= 1 ? ' lic-over' : (ratio >= 0.75 ? ' lic-near' : '');
    const spanCls = ratio >= 1 ? 'danger' : (ratio >= 0.75 ? 'warn' : '');
    const remain = Math.max(0, lim.limit - have);
    const foot = ratio >= 1
      ? (fr ? 'Limite atteinte ou dépassée' : 'At or over the limit')
      : (fr ? ('Il reste ' + fh(remain) + ' h avant la limite') : (fh(remain) + ' h before the limit'));
    const name = (fr ? 'Temps de vol · ' + lim.fr : 'Flight time · ' + lim.en);
    const aria = fr ? 'Voir les vols comptés et la prévision' : 'See the counted flights and the forecast';
    return '<div class="lic-req lic-clickable' + cls + '" role="button" tabindex="0"' +
      ' onclick="openDutyDrill(' + lim.days + ')"' +
      ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openDutyDrill(' + lim.days + ')}"' +
      ' aria-label="' + aria + '">' +
      '<div class="lic-top"><div class="lic-name">' + name +
      '</div><div class="lic-val"><b>' + fh(have) + '</b> <span class="lic-of">/ ' + fh(lim.limit) + ' h</span></div></div>' +
      '<div class="lic-bar"><span class="' + spanCls + '" style="width:' + pctW + '%"></span></div>' +
      '<div class="lic-foot"><span class="lic-togo">' + foot + '</span><span class="lic-pct">' + Math.round(ratio * 100) + '%</span></div></div>';
  }).join('');

  // Forward-looking warning banner: only shown when the pilot's PUBLISHED roster
  // would push a rolling window to/over its limit. No breach ⇒ no banner (keeps
  // the page uncluttered). Detail lives one tap away in the drill-down.
  let forecastBanner = '';
  if (typeof computeDutyProjection === 'function') {
    for (const lim of DUTY_LIMITS) {
      const proj = computeDutyProjection(lim.days, lim.limit);
      if (proj && proj.hitDate) {
        const d = _dutyFmtDate(proj.hitDate, fr);
        const win = fr ? lim.fr : lim.en;
        forecastBanner = '<div class="tc-note duty-forecast-warn">' +
          '<span>' + (fr
            ? '<b>Selon ton horaire :</b> la limite ' + win + ' (' + fh(lim.limit) + ' h) serait atteinte le <b>' + d + '</b>. Touche la barre pour le détail.'
            : '<b>Per your roster:</b> the ' + win + ' limit (' + fh(lim.limit) + ' h) would be reached on <b>' + d + '</b>. Tap the bar for detail.') +
          '</span></div>';
        break;   // surface the soonest/most-binding one only
      }
    }
  }

  const lede = fr
    ? 'Votre temps de vol sur des fenêtres glissantes, comparé aux maximums de Transport Canada (RAC 700.27). Calculé à partir de vos vols enregistrés — le temps sur simulateur ne compte pas.'
    : 'Your flight time over rolling windows, against the Transport Canada maximums (CAR 700.27). Computed from your logged flights — simulator time does not count.';
  const dayNote = fr
    ? '<b>Limite quotidienne :</b> pour un équipage multi-pilote, il n’y a pas de limite simple de temps de vol par jour — le plafond quotidien est la <b>période de service de vol</b> (selon l’heure de présentation et le nombre de vols). Référez-vous au programme approuvé de votre exploitant. La limite de 8 h par 24 h ne s’applique qu’aux exploitations monopilote.'
    : '<b>Daily limit:</b> for a multi-crew flight crew there is no simple per-day flight-time limit — the daily ceiling is the <b>flight duty period</b> (based on report time and number of flights). Refer to your operator’s approved program. The 8 h / 24 h limit applies only to single-pilot operations.';
  const scope = fr
    ? 'S’applique aux exploitations commerciales (Subpartie 700). Source : RAC 700.27 (SOR/2018-269).'
    : 'Applies to commercial operations (Subpart 700). Source: CAR 700.27 (SOR/2018-269).';

  const tapHint = fr
    ? 'Touchez une fenêtre pour voir les vols comptés et une prévision selon votre horaire.'
    : 'Tap a window to see the counted flights and a forecast from your roster.';

  host.innerHTML =
    '<p class="lic-lede">' + lede + ' <span class="lic-note">' + tapHint + '</span></p>' +
    forecastBanner +
    '<div class="lic-reqs" style="margin-top:18px">' + bars + '</div>' +
    '<div class="tc-note">' + dayNote + '</div>' +
    '<p class="lic-endnote">' + scope + '</p>';
}

// ─── Drill-down: which flights + the forecast ───────────────────────────────

function _dutyFmtDate(dateStr, fr) {
  if (!dateStr) return '—';
  const p = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12));
  try { return dt.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  catch (e) { return dateStr; }
}

// Same trailing-window boundary the bars use (local midnight, N days back).
function _dutyWindowCutoff(days) {
  const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - days);
  return cutoff.toISOString().split('T')[0];
}

// Logged flights (actuals, non-sim) counted in the trailing window — the exact
// set summed by _dutyFlightTimeInDays. Most recent first.
function _dutyFlightsInWindow(days) {
  if (!Array.isArray(flights)) return [];
  const cutStr = _dutyWindowCutoff(days);
  const out = [];
  for (const f of flights) {
    if (f.isSim) continue;
    if (!f.date || f.date < cutStr) continue;
    const hrs = (+f.total || +f.block || 0);
    if (hrs <= 0) continue;
    const label = (`${f.flightNum || ''} ${f.route || ''}`.trim()) || (f.type || '—');
    out.push({ date: f.date, label, hrs });
  }
  out.sort((a, b) => a.date < b.date ? 1 : (a.date > b.date ? -1 : 0));  // most recent first
  return out;
}

function loadRosterForecast() {
  try {
    const raw = localStorage.getItem('cumulo_roster_forecast_v1');
    if (!raw) return null;
    const o = JSON.parse(raw);
    return (o && Array.isArray(o.flights)) ? o : null;
  } catch (e) { return null; }
}

function _dutyShiftDate(dateStr, deltaDays) {
  const p = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().split('T')[0];
}

// PURE projection core (unit-tested in test/duty-projection.mjs):
// given a map of date → flight-hours-that-day, roll a `days`-wide window across
// [fromDate … toDate] and report the peak window total and the first date the
// window reaches `limit`. Window(D) = sum of hours on dates in [D-days … D],
// matching the bars' trailing-window semantics.
function projectRollingWindow(hoursByDate, days, limit, fromDate, toDate) {
  const dates = Object.keys(hoursByDate).sort();
  let peak = 0, peakDate = null, hitDate = null;
  for (const D of dates) {
    if (D < fromDate || D > toDate) continue;
    const cut = _dutyShiftDate(D, -days);
    let sum = 0;
    for (const d of dates) { if (d >= cut && d <= D) sum += hoursByDate[d]; }
    sum = Math.round(sum * 100) / 100;
    if (sum > peak) { peak = sum; peakDate = D; }
    if (hitDate === null && sum >= limit) hitDate = D;
  }
  return { peak: peak, peakDate: peakDate, hitDate: hitDate };
}

// Combine certifiable actuals (logged) + roster forecast (future), then project.
// Forecast flights already logged (same date + flightNum) are dropped so they
// are never double-counted. Returns the peak, the first breach date (if any),
// and transparency counters for the drill-down.
function computeDutyProjection(days, limit, todayOverride) {
  const cache = loadRosterForecast();
  const forecast = cache ? cache.flights : [];
  const today = todayOverride || new Date().toISOString().split('T')[0];

  const hoursByDate = {};
  const loggedKeys = new Set();
  if (Array.isArray(flights)) {
    for (const f of flights) {
      if (f.isSim || !f.date) continue;
      const h = (+f.total || +f.block || 0);
      if (h <= 0) continue;
      hoursByDate[f.date] = (hoursByDate[f.date] || 0) + h;
      loggedKeys.add(f.date + '|' + (f.flightNum || ''));
    }
  }

  let forecastCount = 0, forecastHours = 0, estimatedCount = 0, horizonEnd = today;
  for (const g of forecast) {
    if (!g.date || g.date < today) continue;
    if (loggedKeys.has(g.date + '|' + (g.flightNum || ''))) continue;  // already flown & logged
    const h = +g.block || 0;
    if (h <= 0) continue;
    hoursByDate[g.date] = (hoursByDate[g.date] || 0) + h;
    forecastCount++; forecastHours += h;
    if (g.estimated) estimatedCount++;
    if (g.date > horizonEnd) horizonEnd = g.date;
  }

  const proj = projectRollingWindow(hoursByDate, days, limit, today, horizonEnd);
  const hitFlight = proj.hitDate ? (forecast.find(g => g.date === proj.hitDate) || null) : null;
  return {
    peak: proj.peak, peakDate: proj.peakDate,
    hitDate: proj.hitDate, hitFlight: hitFlight,
    forecastCount: forecastCount,
    forecastHours: Math.round(forecastHours * 10) / 10,
    estimatedCount: estimatedCount,
    horizonEnd: horizonEnd,
    forecastTs: cache ? cache.ts : null
  };
}

// Open the shared drill-down overlay with this window's counted flights + forecast.
function openDutyDrill(days) {
  const overlay = document.getElementById('dashDrillOverlay');
  if (!overlay) return;
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const lim = DUTY_LIMITS.find(l => l.days === days) || DUTY_LIMITS[0];
  const fh = n => (Math.round((+n || 0) * 10) / 10).toLocaleString(fr ? 'fr-CA' : 'en-CA');
  const winName = fr ? lim.fr : lim.en;
  const u = fr ? 'h' : 'hrs';

  const have = _dutyFlightTimeInDays(lim.days);
  const remain = Math.max(0, lim.limit - have);

  const counted = _dutyFlightsInWindow(lim.days);
  let list;
  if (counted.length) {
    list = '<div class="dash-drill-sub">' + (fr ? 'Vols comptés dans cette fenêtre' : 'Flights counted in this window') + '</div>' +
      '<ul class="dash-drill-list">' + counted.map(c =>
        '<li>' + esc(c.date) + ' · ' + esc(c.label) + ' · <span class="mono">+' + fh(c.hrs) + ' ' + u + '</span></li>'
      ).join('') + '</ul>';
  } else {
    list = '<div class="dash-drill-note">' + (fr ? 'Aucun vol dans cette fenêtre.' : 'No flights in this window.') + '</div>';
  }

  const rows = [
    { k: fr ? 'Cumul actuel' : 'Current total', v: '<strong>' + fh(have) + '</strong> / ' + fh(lim.limit) + ' h' },
    { k: fr ? 'Marge restante' : 'Remaining', v: fh(remain) + ' h' }
  ];

  const proj = computeDutyProjection(lim.days, lim.limit);
  let forecastHtml;
  if (proj && proj.forecastCount > 0) {
    const peakTxt = (fr ? 'Sommet projeté : <b>' : 'Projected peak: <b>') + fh(proj.peak) + ' h</b> '
      + (fr ? 'le ' : 'on ') + _dutyFmtDate(proj.peakDate, fr);
    let verdict;
    if (proj.hitDate) {
      const after = proj.hitFlight ? (' (' + esc((proj.hitFlight.flightNum || '') + ' ' + (proj.hitFlight.route || '')).trim() + ')') : '';
      verdict = '<div class="dash-drill-note duty-drill-over">' + (fr
        ? 'Tu atteindrais ou dépasserais la limite de ' + fh(lim.limit) + ' h le <b>' + _dutyFmtDate(proj.hitDate, fr) + '</b>' + after + '.'
        : 'You would reach or exceed the ' + fh(lim.limit) + ' h limit on <b>' + _dutyFmtDate(proj.hitDate, fr) + '</b>' + after + '.') + '</div>';
    } else {
      const margin = Math.max(0, lim.limit - proj.peak);
      verdict = '<div class="dash-drill-note duty-drill-ok">' + (fr
        ? 'Tu restes sous la limite — marge minimale de ' + fh(margin) + ' h.'
        : 'You stay under the limit — minimum margin ' + fh(margin) + ' h.') + '</div>';
    }
    const est = proj.estimatedCount > 0
      ? (fr ? ' (dont ' + proj.estimatedCount + ' vol(s) au bloc estimé d’après STD/STA)' : ' (incl. ' + proj.estimatedCount + ' flight(s) with block estimated from STD/STA)')
      : '';
    forecastHtml =
      '<div class="dash-drill-sub" style="margin-top:16px">' + (fr ? 'Prévision selon ton horaire' : 'Forecast from your roster') + '</div>' +
      '<div class="dash-drill-note">' + (fr
        ? 'Basée sur <b>' + proj.forecastCount + '</b> vol(s) planifié(s) (' + fh(proj.forecastHours) + ' h) jusqu’au ' + _dutyFmtDate(proj.horizonEnd, fr) + '.' + est
        : 'Based on <b>' + proj.forecastCount + '</b> planned flight(s) (' + fh(proj.forecastHours) + ' h) through ' + _dutyFmtDate(proj.horizonEnd, fr) + '.' + est) + '</div>' +
      '<div class="dash-drill-note">' + peakTxt + '</div>' + verdict +
      '<div class="tc-note" style="margin-top:12px">' + (fr
        ? 'Prévision basée sur les blocs <b>planifiés</b> de ton horaire, pas des heures réelles. À titre indicatif — tes heures réelles peuvent différer.'
        : 'Forecast based on the <b>scheduled</b> block times in your roster, not actual hours. Indicative only — your actual hours may differ.') + '</div>';
  } else {
    // Distinguish "roster not connected" from "connected but nothing upcoming yet",
    // so a configured pilot is never wrongly told their iCal isn't connected.
    const configured = _navblueConfigured();
    const msg = configured
      ? (fr ? 'Ton horaire est connecté, mais aucun vol à venir n’a encore été détecté. Si ton prochain voyage n’apparaît pas, force une synchro.'
            : 'Your roster is connected, but no upcoming flights have been detected yet. If your next trip is missing, force a sync.')
      : (fr ? 'Connecte ton horaire Porter dans Réglages pour activer la prévision.'
            : 'Connect your Porter roster in Settings to enable the forecast.');
    const syncBtn = configured
      ? '<button class="btn btn-ghost" style="margin-top:10px" onclick="(async function(){ if(typeof syncNavblueNow===\'function\'){ try{ await syncNavblueNow(); }catch(e){} } if(typeof renderDutyTracker===\'function\') renderDutyTracker(); if(typeof openDutyDrill===\'function\') openDutyDrill(' + days + '); })()">' + (fr ? 'Synchroniser maintenant' : 'Sync now') + '</button>'
      : '';
    forecastHtml =
      '<div class="dash-drill-sub" style="margin-top:16px">' + (fr ? 'Prévision selon ton horaire' : 'Forecast from your roster') + '</div>' +
      '<div class="dash-drill-note">' + msg + '</div>' + syncBtn;
  }

  const eyebrowEl = document.getElementById('dashDrillEyebrow');
  const titleEl = document.getElementById('dashDrillTitle');
  const bodyEl = document.getElementById('dashDrillBody');
  const footEl = document.getElementById('dashDrillFoot');
  if (eyebrowEl) eyebrowEl.textContent = fr ? 'LIMITE DE TEMPS DE VOL' : 'FLIGHT-TIME LIMIT';
  if (titleEl) titleEl.textContent = (fr ? 'Temps de vol · ' + winName : 'Flight time · ' + winName);
  if (bodyEl) bodyEl.innerHTML = _drillRowsHtml(rows) + list + forecastHtml;
  if (footEl) footEl.innerHTML = '<button class="btn btn-ghost" onclick="closeDashDrill();showPage(\'logbook\');">' + (fr ? 'Voir le carnet' : 'See logbook') + '</button>';

  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}
