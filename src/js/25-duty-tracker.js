// ═══════════════════════════════════════════
//  FLIGHT-TIME LIMITS TRACKER (page-duty)
//  Rolling-window flight time vs the CAR 700.27 maximums (SOR/2018-269),
//  verified against laws-lois and consigned to docs/REGISTRE-REGLEMENTAIRE.md
//  (2026-06-30):
//     112 h / 28 days · 300 h / 90 days · 1000 h / 365 days
//     (8 h / 24 h applies only "in the case of a single-pilot operation",
//     CAR 700.27(1)(d) verbatim — see docs/REGISTRE-REGLEMENTAIRE.md 2026-07-16)
//  Applies to commercial operations (Subpart 700). Simulator time is NOT flight
//  time and is excluded. The per-DAY ceiling for multi-crew is the flight duty
//  period (FDP) table, not a simple flight-time number — so the tracker shows
//  the three cumulative limits + a note pointing to the daily FDP calculator.
//  Numbers are never fabricated (see registre).
//
//  RENDER LAYER v2 (2026-07-16): matches the approved mockups
//  private/mockups/duty-final.html + duty-final-en.html — amber forecast
//  notice up top, three flat windows with severity-tinted linear gauges
//  (70% / 90% visual thresholds), and an INLINE 28-day drill-down (daily
//  bars + rolling-total curve + counted-flights list). The calculation
//  engines below (projectRollingWindow, computeDutyProjection,
//  _dutyFlightTimeInDays) are unchanged.
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

// ─── Shared render formatters (locale-true, real data only) ──────────────────

function _dutyFh(n, fr) { return (+n || 0).toLocaleString(fr ? 'fr-CA' : 'en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function _dutyFL(n, fr) { return (+n || 0).toLocaleString(fr ? 'fr-CA' : 'en-CA'); }
function _dutyDT(dateStr) { const p = String(dateStr).split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)); }
// FR dates follow the SAME convention as the Pay page (28-pay.js): "1er" for the
// first of the month and the mockup abbreviations (jan, fév, …, juil, août);
// Intl fr-CA renders "1 août" / "2 juill.", which matches neither the approved
// mockups nor the Pay page. The month arrays live in 28-pay.js (same bundle);
// Intl stays the fallback if they are unavailable (e.g. partial test harness).
function _dutyMoFr(monthIdx0, short) {
  try { return (short ? _PAY_MO_FR_S : _PAY_MO_FR)[monthIdx0] || null; } catch (e) { return null; }
}
function _dutyFmtLong(dateStr, fr) {
  if (!dateStr) return '–';
  if (fr) {
    const p = String(dateStr).split('-').map(Number);
    const mo = _dutyMoFr(p[1] - 1, false);
    if (mo) return (p[2] === 1 ? '1er' : p[2]) + ' ' + mo;
  }
  try { return _dutyDT(dateStr).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { month: 'long', day: 'numeric', timeZone: 'UTC' }); }
  catch (e) { return dateStr; }
}
function _dutyFmtShort(dateStr, fr) {
  if (!dateStr) return '–';
  if (fr) {
    const p = String(dateStr).split('-').map(Number);
    const mo = _dutyMoFr(p[1] - 1, true);
    if (mo) return (p[2] === 1 ? '1er' : p[2]) + ' ' + mo;
  }
  try { return _dutyDT(dateStr).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  catch (e) { return dateStr; }
}

// Icons from the approved mockups (stroke = currentColor, tinted by CSS).
const DUTY_CHEV = '<svg class="chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DUTY_IC_WARN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.7 2.6 20h18.8L12 3.7Z"/><path d="M12 10v4.2"/><circle cx="12" cy="17.4" r=".5" fill="currentColor"/></svg>';
const DUTY_IC_WARN_SM = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2.7 20h18.6L12 4Z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg>';
const DUTY_IC_INFO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="7.5" r=".5" fill="currentColor"/></svg>';

// ─── Page render ─────────────────────────────────────────────────────────────

function renderDutyTracker() {
  const host = document.getElementById('dutyTracker');
  if (!host) return;
  const fr = (typeof getLang === 'function') && getLang() === 'fr';

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

  const wins = DUTY_LIMITS.map(function (lim, i) {
    const have = _dutyFlightTimeInDays(lim.days);
    const proj = (typeof computeDutyProjection === 'function') ? computeDutyProjection(lim.days, lim.limit) : null;
    return { lim: lim, have: have, ratio: lim.limit > 0 ? have / lim.limit : 0, proj: proj, featured: i === 0 };
  });
  const hit = wins.find(function (w) { return w.proj && w.proj.hitDate; }) || null;
  const hasForecast = wins.some(function (w) { return w.proj && w.proj.forecastCount > 0; });

  _dutyRenderNotice(hit, hasForecast, fr);

  // Section note under the heading (spec: duty-final.html §4 sec-note).
  const note = document.getElementById('dutyCumNote');
  if (note) {
    const over = wins.find(function (w) { return w.have >= w.lim.limit; });
    let s = over
      ? (fr ? 'La fenêtre de ' + over.lim.fr + ' atteint ou dépasse la limite.' : 'The ' + over.lim.days + '-day window is at or over the limit.')
      : (fr ? 'Les trois fenêtres sont sous la limite.' : 'All three windows are under the limit.');
    if (hit) {
      s += fr
        ? ' Selon ton horaire, la fenêtre de ' + hit.lim.fr + ' atteindrait ' + _dutyFL(hit.lim.limit, fr) + ' h le ' + _dutyFmtLong(hit.proj.hitDate, fr) + '.'
        : ' Based on your schedule, the ' + hit.lim.days + '-day window would reach ' + _dutyFL(hit.lim.limit, fr) + ' h on ' + _dutyFmtLong(hit.proj.hitDate, fr) + '.';
    }
    s += fr ? ' Calculé sur tes vols enregistrés, avion seulement.' : ' Calculated from your recorded flights, aeroplane only.';
    note.textContent = s;
  }

  const winsHtml = wins.map(function (w) { return _dutyWinHtml(w, fr); }).join('');
  const legend =
    '<ul class="legend" aria-label="' + (fr ? 'Lecture des teintes de jauge' : 'Reading the gauge shades') + '">' +
    '<li><span class="dot ok" aria-hidden="true"></span>' + (fr ? 'De la marge (moins de 70 %)' : 'Room to spare (under 70%)') + '</li>' +
    '<li><span class="dot watch" aria-hidden="true"></span>' + (fr ? 'À surveiller (70 à 90 %)' : 'Worth watching (70 to 90%)') + '</li>' +
    '<li><span class="dot over" aria-hidden="true"></span>' + (fr ? 'Proche de la limite (90 % et plus)' : 'Close to the limit (90% or more)') + '</li></ul>' +
    '<p class="legend-cap">' + (fr
      ? 'Teinte selon la part de la limite utilisée : un repère visuel de lecture. Les traits fins sur chaque piste marquent les seuils de 70 % et 90 %.'
      : 'Shade reflects the share of the limit used: a visual reading cue. The thin ticks on each track mark the 70% and 90% thresholds.') + '</p>';

  host.innerHTML =
    '<div class="windows" role="group" aria-label="' + (fr ? 'Fenêtres glissantes de temps de vol' : 'Rolling flight time windows') + '">' + winsHtml + '</div>' +
    legend +
    _dutyDetailHtml(wins[0], fr);
}

// One flat window: label + gauge tinted by severity (share of the limit used).
// Thresholds 70% / 90% are a visual reading cue, not regulatory.
function _dutyWinHtml(w, fr) {
  const lim = w.lim;
  const pct = Math.min(100, w.ratio * 100);
  const sev = pct >= 90 ? 'over' : (pct >= 70 ? 'watch' : 'ok');
  const sevTxt = fr
    ? (sev === 'over' ? 'proche de la limite' : sev === 'watch' ? 'à surveiller' : 'de la marge')
    : (sev === 'over' ? 'close to the limit' : sev === 'watch' ? 'getting close' : 'room to spare');
  const cls = w.have > 0 ? sev : '';                 // 0 flights: neutral track, no severity tint
  const remain = Math.max(0, lim.limit - w.have);
  const label = fr ? (lim.days + ' derniers jours') : ('Last ' + lim.days + ' days');
  const limitTxt = fr ? ('Limite ' + _dutyFL(lim.limit, fr) + ' h') : (_dutyFL(lim.limit, fr) + ' h limit');
  const gaugeAria = fr
    ? Math.round(pct) + ' pour cent de la limite de ' + _dutyFL(lim.limit, fr) + ' heures utilisée : ' + sevTxt
    : Math.round(pct) + ' percent of the ' + _dutyFL(lim.limit, fr) + '-hour limit used: ' + sevTxt;
  const projNote = (w.proj && w.proj.hitDate)
    ? '<div class="win-note num"><span class="wn-ic" aria-hidden="true">' + DUTY_IC_WARN_SM + '</span>' +
      (fr ? 'Selon ton horaire : ' + _dutyFL(lim.limit, fr) + ' h seraient atteintes le ' + _dutyFmtLong(w.proj.hitDate, fr)
          : 'Based on your schedule: ' + _dutyFL(lim.limit, fr) + ' h would be reached on ' + _dutyFmtLong(w.proj.hitDate, fr)) + '</div>'
    : '';
  return '<article class="win' + (w.featured ? ' featured' : '') + '" id="duty-win-' + lim.days + '" aria-labelledby="duty-w' + lim.days + '-title">' +
    '<div class="win-top"><span class="win-label" id="duty-w' + lim.days + '-title">' + label + '</span>' +
    '<span class="win-limit num">' + limitTxt + '</span></div>' +
    '<div class="win-val num">' + _dutyFh(w.have, fr) + ' h <span class="of">/ ' + _dutyFL(lim.limit, fr) + ' h</span></div>' +
    '<div class="gauge" role="img" aria-label="' + gaugeAria + '"><span class="' + cls + '" style="width:' + pct.toFixed(1) + '%"></span></div>' +
    '<div class="win-rest num">' + (fr ? 'Il reste ' + _dutyFh(remain, fr) + ' h' : _dutyFh(remain, fr) + ' h remaining') + '</div>' +
    projNote + '</article>';
}

// Forecast notice up top (#dutyNotice): AMBER heads-up when the published
// roster would fill a window (prediction, not an exceedance in progress);
// neutral variant when no schedule/forecast exists; nothing when the forecast
// exists and stays under every limit.
function _dutyRenderNotice(hit, hasForecast, fr) {
  const box = document.getElementById('dutyNotice');
  if (!box) return;
  if (hit) {
    const lim = hit.lim;
    const remain = Math.max(0, lim.limit - hit.have);
    const d = _dutyFmtLong(hit.proj.hitDate, fr);
    const fL = function (n) { return _dutyFL(n, fr); };
    const fh = function (n) { return _dutyFh(n, fr); };
    box.innerHTML = '<div class="notice" role="status">' +
      '<span class="n-ic" aria-hidden="true">' + DUTY_IC_WARN + '</span>' +
      '<div class="n-txt"><div class="n-title">' + (fr ? 'À surveiller' : 'Getting close') + '</div>' +
      '<div class="n-body num">' + (fr
        ? 'Tu es à <strong>' + fh(hit.have) + ' h</strong> sur ' + fL(lim.limit) + ' h (' + lim.days + ' jours) : il te reste <strong>' + fh(remain) + ' h</strong>. En volant tout ce qui est à ton horaire, ton cumul atteindrait ' + fL(lim.limit) + ' h le <strong>' + d + '</strong>. Dépasser ' + fL(lim.limit) + ' h sur ' + lim.days + ' jours n’est pas permis (RAC 700.27). On te le montre d’avance pour que tu puisses le signaler à l’horaire au besoin.'
        : 'You’re at <strong>' + fh(hit.have) + ' h</strong> of ' + fL(lim.limit) + ' h (' + lim.days + ' days): you have <strong>' + fh(remain) + ' h</strong> left. If you fly everything on your schedule, your total would reach ' + fL(lim.limit) + ' h on <strong>' + d + '</strong>. Exceeding ' + fL(lim.limit) + ' h in ' + lim.days + ' days is not permitted (CAR 700.27). We show you ahead of time so you can flag it to scheduling if needed.') +
      '<br><a href="#duty-win-' + lim.days + '" onclick="var el=document.getElementById(\'duty-win-' + lim.days + '\');if(el)el.scrollIntoView({behavior:\'smooth\',block:\'start\'});return false;">' +
      (fr ? 'Voir la fenêtre de ' + lim.days + ' jours' : 'See the ' + lim.days + '-day window') + '</a></div></div></div>';
  } else if (!hasForecast) {
    // Two honest cases, never conflated (guarantee restored 2026-07-16): a pilot
    // whose iCal IS connected but whose published roster has no upcoming flight
    // must never be told to "import" it: offer a manual sync instead.
    if (_navblueConfigured()) {
      box.innerHTML = '<div class="notice neutral" role="status">' +
        '<span class="n-ic" aria-hidden="true">' + DUTY_IC_INFO + '</span>' +
        '<div class="n-txt"><div class="n-title">' + (fr ? 'Aucun vol à venir' : 'No upcoming flights') + '</div>' +
        '<div class="n-body">' + (fr
          ? 'Ton horaire est connecté, mais aucun vol à venir n’est détecté. Les trois fenêtres ci-dessous restent calculées sur tes vols enregistrés.'
          : 'Your schedule is connected, but no upcoming flight was detected. The three windows below stay calculated from your recorded flights.') +
        '<br><a href="#" onclick="if(typeof syncNavblueNow===\'function\'){Promise.resolve(syncNavblueNow()).catch(function(){}).finally(function(){if(typeof renderDutyTracker===\'function\')renderDutyTracker();});}return false;">' +
        (fr ? 'Synchroniser maintenant' : 'Sync now') + '</a></div></div></div>';
    } else {
      box.innerHTML = '<div class="notice neutral" role="status">' +
        '<span class="n-ic" aria-hidden="true">' + DUTY_IC_INFO + '</span>' +
        '<div class="n-txt"><div class="n-title">' + (fr ? 'Aucune prévision' : 'No forecast') + '</div>' +
        '<div class="n-body">' + (fr
          ? 'Importe ton horaire pour voir quand une fenêtre se remplirait. Les trois fenêtres ci-dessous restent calculées sur tes vols enregistrés.'
          : 'Import your schedule to see when a window would fill. The three windows below stay calculated from your recorded flights.') +
        '<br><a href="#" onclick="showPage(\'backup\');setTimeout(function(){if(typeof showSettingsTab===\'function\')showSettingsTab(\'sync\');},60);return false;">' +
        (fr ? 'Importer mon horaire' : 'Import my schedule') + '</a></div></div></div>';
    }
  } else {
    box.innerHTML = '';
  }
}

// ─── Drill-down data (mirrors computeDutyProjection's assembly, read-only) ───

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
    out.push({ date: f.date, num: f.flightNum || '', route: f.route || '', type: f.type || '', hrs: hrs });
  }
  out.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });  // most recent first
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

// Read-only mirror of computeDutyProjection's data assembly, split so the
// render layer can draw the flown daily bars, the planned blocks and the
// rolling totals from the exact same inputs. Never mutates anything.
function _dutyDrillData(days) {
  const today = new Date().toISOString().split('T')[0];
  const cut = _dutyWindowCutoff(days);
  const daily = {};        // logged hours per date, window only (bars + solid line)
  const combined = {};     // all logged + future forecast (rolling totals)
  const loggedKeys = new Set();
  if (Array.isArray(flights)) {
    for (const f of flights) {
      if (f.isSim || !f.date) continue;
      const h = (+f.total || +f.block || 0);
      if (h <= 0) continue;
      combined[f.date] = (combined[f.date] || 0) + h;
      loggedKeys.add(f.date + '|' + (f.flightNum || ''));
      if (f.date >= cut && f.date <= today) daily[f.date] = (daily[f.date] || 0) + h;
    }
  }
  const cache = loadRosterForecast();
  const forecast = cache ? cache.flights : [];
  const planned = {};      // forecast hours per future date
  let horizon = today;
  for (const g of forecast) {
    if (!g.date || g.date < today) continue;
    if (loggedKeys.has(g.date + '|' + (g.flightNum || ''))) continue;
    const h = +g.block || 0;
    if (h <= 0) continue;
    combined[g.date] = (combined[g.date] || 0) + h;
    planned[g.date] = (planned[g.date] || 0) + h;
    if (g.date > horizon) horizon = g.date;
  }
  return { today: today, cut: cut, daily: daily, combined: combined, planned: planned, horizon: horizon };
}

// Rolling window total at date D — same [D-days … D] semantics as the engine.
function _dutyRollAt(combined, days, D) {
  const cut = _dutyShiftDate(D, -days);
  let s = 0;
  for (const d in combined) { if (d >= cut && d <= D) s += combined[d]; }
  return Math.round(s * 100) / 100;
}

// Inclusive date sequence [a … b] (safety-capped).
function _dutyDateSeq(a, b) {
  const out = [];
  let d = a, guard = 0;
  while (d <= b && guard < 800) { out.push(d); d = _dutyShiftDate(d, 1); guard++; }
  return out;
}

// ─── Inline drill-down: 28-day window detail (spec: duty-final.html §4c) ────

function _dutyDetailHtml(w, fr) {
  const days = w.lim.days, limit = w.lim.limit;
  const dd = _dutyDrillData(days);
  const range = fr
    ? _dutyFmtLong(dd.cut, fr) + ' au ' + _dutyFmtLong(dd.today, fr)
    : _dutyFmtLong(dd.cut, fr) + ' to ' + _dutyFmtLong(dd.today, fr);
  const title = fr
    ? 'Détail : fenêtre de ' + days + ' jours · ' + range
    : 'Detail: ' + days + '-day window · ' + range;

  // Honest window bounds: the engine's cutoff (today − days, INCLUSIVE) is
  // conservative: it covers one calendar date more than "the last `days`
  // days", so the range above and the tables below list days+1 dates. Say so
  // plainly instead of pretending the listed dates are exactly `days`.
  // (Engine semantics unchanged, never understates the CAR 700.27 total.)
  const nDates = _dutyDateSeq(dd.cut, dd.today).length;
  const boundsNote = fr
    ? 'Fenêtre affichée : du ' + _dutyFmtLong(dd.cut, fr) + ' au ' + _dutyFmtLong(dd.today, fr) + ' inclusivement, soit ' + nDates + ' dates. Par prudence, les bornes sont inclusives : le calcul peut couvrir un peu plus que les ' + days + ' derniers jours et ne sous-estime jamais ton cumul (RAC 700.27).'
    : 'Window shown: ' + _dutyFmtLong(dd.cut, fr) + ' to ' + _dutyFmtLong(dd.today, fr) + ' inclusive, ' + nDates + ' dates. To stay conservative, the bounds are inclusive: the calculation may cover slightly more than the last ' + days + ' days and never understates your running sum (CAR 700.27).';

  const counted = _dutyFlightsInWindow(days);
  let body;
  if (!counted.length) {
    // Degraded state (spec b): 0 flights in the window.
    body = '<p class="tbl-note">' + (fr
      ? 'Aucun vol enregistré dans la fenêtre. Importe ton horaire.'
      : 'No flight recorded in the window. Import your schedule.') + '</p>' + _dutyRegFootnote(fr, boundsNote);
  } else {
    body = _dutyCumeBlock(dd, days, limit, w.have, w.proj, range, fr) +
      _dutyDaysBlock(dd, limit, w.have, fr) +
      _dutyFlightsBlock(counted, days, limit, w.have, fr) +
      _dutyRegFootnote(fr, boundsNote);
  }
  return '<details class="detail" open><summary>' + title + DUTY_CHEV + '</summary><div class="fold-body">' + body + '</div></details>';
}

// Rolling-total curve: solid = recorded flights (running total of the current
// window); dashed = projection from the planned blocks (projectRollingWindow
// semantics). The crossing with the limit is labelled with the date from
// computeDutyProjection. No forecast → no dashed segment + an honest note.
function _dutyCumeBlock(dd, days, limit, have, proj, range, fr) {
  const fh = function (n) { return _dutyFh(n, fr); };
  const fL = function (n) { return _dutyFL(n, fr); };
  const past = _dutyDateSeq(dd.cut, dd.today);
  const hasFc = !!(proj && proj.forecastCount > 0 && dd.horizon > dd.today);
  const endDate = hasFc ? (proj.hitDate || proj.horizonEnd || dd.horizon) : dd.today;
  const future = hasFc ? _dutyDateSeq(_dutyShiftDate(dd.today, 1), endDate) : [];
  const all = past.concat(future);
  const n = all.length;

  let cum = 0;
  const solidVals = past.map(function (d) { cum += (dd.daily[d] || 0); return Math.round(cum * 100) / 100; });
  const futVals = future.map(function (D) { return _dutyRollAt(dd.combined, days, D); });
  // Blocks still PLANNED for today (on the schedule, not yet flown/logged): the
  // engine projection counts them at today (combined = logged + planned), so the
  // transparency table and the dashed line must too, otherwise today's planned
  // block appears in NO row while inflating the next row's rolling total, and
  // the table's own equation stops adding up. (review 2026-07-16)
  const todayPlanned = Math.round((dd.planned[dd.today] || 0) * 100) / 100;
  const todayRoll = _dutyRollAt(dd.combined, days, dd.today);

  const x0 = 46, x1 = 696, yBase = 170, yTop = 30;
  const xOf = function (i) { return x0 + (n <= 1 ? 0 : (i / (n - 1)) * (x1 - x0)); };
  const yOf = function (v) { return yBase - (Math.max(0, Math.min(v, limit)) / limit) * (yBase - yTop); };
  const r1 = function (v) { return (Math.round(v * 100) / 100).toFixed(2); };
  const jIdx = past.length - 1;

  const solidPts = solidVals.map(function (v, i) { return r1(xOf(i)) + ',' + r1(yOf(v)); }).join(' ');
  let dashPts = '';
  if (hasFc) {
    // The projection starts at TODAY'S projected rolling total (recorded +
    // planned-today), not at the recorded-only solid endpoint.
    const pts = [[xOf(jIdx), yOf(todayPlanned > 0 ? todayRoll : (solidVals[jIdx] || 0))]];
    futVals.forEach(function (v, k) { pts.push([xOf(jIdx + 1 + k), yOf(v)]); });
    dashPts = pts.map(function (p) { return r1(p[0]) + ',' + r1(p[1]); }).join(' ');
  }

  const step = limit >= 1000 ? 250 : (limit >= 300 ? 100 : 40);
  let grid = '', gLabels = '';
  for (let v = step; v < limit; v += step) {
    grid += '<line x1="46" y1="' + r1(yOf(v)) + '" x2="696" y2="' + r1(yOf(v)) + '"/>';
    gLabels += '<text x="42" y="' + r1(yOf(v) + 3) + '">' + fL(v) + ' h</text>';
  }
  gLabels += '<text x="42" y="173">0</text>';
  const jLine = hasFc ? '<line x1="' + r1(xOf(jIdx)) + '" y1="30" x2="' + r1(xOf(jIdx)) + '" y2="170" stroke="var(--v2-hair)" stroke-width="1"/>' : '';

  const tickIdx = [];
  [0, Math.round(jIdx / 2), jIdx, hasFc ? jIdx + Math.round(future.length / 2) : -1, hasFc ? n - 1 : -1]
    .forEach(function (i) { if (i >= 0 && i < n && tickIdx.indexOf(i) === -1) tickIdx.push(i); });
  const xLabels = tickIdx.map(function (i) {
    return '<text x="' + r1(xOf(i)) + '" y="190">' + esc(_dutyFmtShort(all[i], fr)) + '</text>';
  }).join('');

  const midPast = Math.round(jIdx * 0.45);
  const segLabels =
    '<text x="' + r1(xOf(midPast)) + '" y="' + r1(Math.min(160, yOf(solidVals[midPast] || 0) + 24)) + '" font-size="10.5" font-weight="500" fill="var(--v2-muted)">' + (fr ? 'Vols enregistrés' : 'Recorded flights') + '</text>' +
    (hasFc
      ? '<text x="' + r1(xOf(jIdx + Math.max(1, Math.round(future.length * 0.35)))) + '" y="' + r1(Math.max(44, Math.min(160, yOf(futVals[Math.max(0, Math.round(future.length * 0.35) - 1)] || 0) + 28))) + '" font-size="10.5" font-weight="500" fill="var(--v2-muted)">' + (fr ? 'Projection (horaire prévu)' : 'Projection (planned schedule)') + '</text>'
      : '');

  const hitMark = (hasFc && proj.hitDate)
    ? '<circle cx="' + r1(xOf(n - 1)) + '" cy="' + r1(yOf(limit)) + '" r="3.5" fill="var(--v2-danger)"/>' +
      '<text x="' + r1(xOf(n - 1) - 6) + '" y="16" font-size="11" font-weight="600" fill="var(--v2-danger-ink)" text-anchor="end">' + esc(_dutyFmtShort(proj.hitDate, fr)) + '</text>'
    : '';

  const endV = solidVals[jIdx] || 0;
  let aria = fr
    ? 'Cumul glissant de la fenêtre de ' + days + ' jours, du ' + _dutyFmtLong(dd.cut, fr) + ' au ' + _dutyFmtLong(endDate, fr) + '. Trait plein : cumul des vols enregistrés de la fenêtre courante, de ' + fh(solidVals[0] || 0) + ' heures le ' + _dutyFmtLong(dd.cut, fr) + ' à ' + fh(endV) + ' heures le ' + _dutyFmtLong(dd.today, fr) + '.'
    : 'Rolling ' + days + '-day window total, ' + _dutyFmtLong(dd.cut, fr) + ' to ' + _dutyFmtLong(endDate, fr) + '. Solid line: running total of the recorded flights in the current window, from ' + fh(solidVals[0] || 0) + ' hours on ' + _dutyFmtLong(dd.cut, fr) + ' to ' + fh(endV) + ' hours on ' + _dutyFmtLong(dd.today, fr) + '.';
  if (hasFc) {
    aria += fr
      ? ' Trait tireté : projection du total glissant sur ' + days + ' jours selon les blocs prévus à l’horaire.'
      : ' Dashed line: projection of the ' + days + '-day rolling total based on the block times planned on the schedule.';
    if (proj.hitDate) {
      aria += fr
        ? ' Il atteint la limite de ' + fL(limit) + ' heures le ' + _dutyFmtLong(proj.hitDate, fr) + '.'
        : ' It reaches the ' + fL(limit) + '-hour limit on ' + _dutyFmtLong(proj.hitDate, fr) + '.';
    }
    aria += fr
      ? ' Les valeurs sont listées dans « Données du graphique : cumul glissant » sous le graphique.'
      : ' The values are listed in “Chart data: rolling total” below the chart.';
  }

  const chartTitle = fr
    ? 'Cumul glissant sur ' + days + ' jours : vécu' + (hasFc ? ' et projection' : '')
    : days + '-day rolling total: flown' + (hasFc ? ' and projected' : '');

  const svg = '<svg class="w-cume" viewBox="0 0 720 200" role="img" aria-label="' + esc(aria) + '">' +
    '<title>' + (fr ? 'Cumul glissant de la fenêtre de ' + days + ' jours' : 'Rolling ' + days + '-day window total') + '</title>' +
    '<g stroke="var(--v2-hair)" stroke-width="1">' + grid + '</g>' + jLine +
    '<line x1="46" y1="170" x2="696" y2="170" stroke="var(--v2-hair-strong)" stroke-width="1"/>' +
    '<g font-size="10" fill="var(--v2-muted)" text-anchor="end">' + gLabels + '</g>' +
    '<line x1="46" y1="' + r1(yOf(limit)) + '" x2="696" y2="' + r1(yOf(limit)) + '" stroke="var(--v2-danger)" stroke-width="1" stroke-opacity=".45"/>' +
    '<text x="46" y="21" font-size="10.5" font-weight="600" fill="var(--v2-danger-ink)">' + (fr ? 'Limite ' + fL(limit) + ' h' : fL(limit) + ' h limit') + '</text>' +
    '<polyline fill="none" stroke="var(--v2-accent-data)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="' + solidPts + '"/>' +
    (hasFc ? '<polyline fill="none" stroke="var(--v2-accent-data)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="6 5" points="' + dashPts + '"/>' : '') +
    hitMark + segLabels +
    '<g font-size="9.5" fill="var(--v2-muted)" text-anchor="middle">' + xLabels + '</g>' +
    '</svg>';

  let note = fr
    ? 'Trait plein : cumul des vols enregistrés de la fenêtre courante (' + range + '). Chaque point est la somme des heures quotidiennes listées plus bas.'
    : 'Solid line: running total of the recorded flights in the current window (' + range + '). Each point is the sum of the daily hours listed below.';
  if (hasFc) {
    note += fr
      ? ' Trait tireté : projection du total glissant sur ' + days + ' jours selon les blocs prévus à ton horaire. Le total redescend quand une grosse journée sort de la fenêtre.'
      : ' Dashed line: projection of the ' + days + '-day rolling total based on the block times planned on your schedule. The total dips when a big day drops out of the window.';
    if (proj.hitDate) {
      note += fr
        ? ' Selon ton horaire, ' + fL(limit) + ' h seraient atteintes le ' + _dutyFmtLong(proj.hitDate, fr) + '.'
        : ' Based on your schedule, ' + fL(limit) + ' h would be reached on ' + _dutyFmtLong(proj.hitDate, fr) + '.';
    } else {
      note += fr
        ? ' Selon ton horaire, la fenêtre reste sous ' + fL(limit) + ' h jusqu’au ' + _dutyFmtLong(dd.horizon, fr) + '.'
        : ' Based on your schedule, the window stays under ' + fL(limit) + ' h through ' + _dutyFmtLong(dd.horizon, fr) + '.';
    }
    if (proj.estimatedCount > 0) {
      note += fr
        ? ' (' + proj.estimatedCount + ' vol(s) au bloc estimé d’après STD/STA.)'
        : ' (' + proj.estimatedCount + ' flight(s) with block estimated from STD/STA.)';
    }
  } else if (proj && proj.forecastCount > 0) {
    // A schedule IS imported, but its remaining flights are all today or
    // earlier (horizon <= today): never claim no schedule was imported.
    note += fr
      ? ' Horaire importé : plus aucun vol prévu après aujourd’hui, pas de courbe de projection.'
      : ' Schedule imported: no flight planned after today, so no projection curve.';
  } else {
    note += fr
      ? ' Aucun horaire importé : pas de projection affichée.'
      : ' No schedule imported: no projection shown.';
  }

  let fold = '';
  if (hasFc) {
    let rows = '<tr><th scope="row" class="num">' + esc(_dutyFmtShort(dd.today, fr)) + (fr ? ' (aujourd’hui)' : ' (today)') + '</th><td class="r num">' + (todayPlanned > 0 ? fh(todayPlanned) : '–') + '</td><td class="r num">–</td><td class="r num">' + fh(todayPlanned > 0 ? todayRoll : have) + '</td></tr>';
    future.forEach(function (D, k) {
      const leaving = dd.combined[_dutyShiftDate(D, -(days + 1))] || 0;
      rows += '<tr' + (proj.hitDate === D ? ' class="row-total"' : '') + '><th scope="row" class="num">' + esc(_dutyFmtShort(D, fr)) + '</th>' +
        '<td class="r num">' + fh(dd.planned[D] || 0) + '</td>' +
        '<td class="r num">' + fh(leaving) + '</td>' +
        '<td class="r num">' + fh(futVals[k]) + '</td></tr>';
    });
    fold = '<details class="fold"><summary>' + DUTY_CHEV + (fr ? 'Données du graphique : cumul glissant' : 'Chart data: rolling total') + '</summary>' +
      '<div class="fold-body tbl-wrap"><table><thead><tr>' +
      '<th scope="col">Date</th>' +
      '<th class="r" scope="col">' + (fr ? 'Bloc prévu (h)' : 'Planned block (h)') + '</th>' +
      '<th class="r" scope="col">' + (fr ? 'Heures qui sortent de la fenêtre (h)' : 'Hours leaving the window (h)') + '</th>' +
      '<th class="r" scope="col">' + (fr ? 'Total glissant (h)' : 'Rolling total (h)') + '</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="footnote">' + (fr
        ? 'Chaque ligne : total glissant = total de la veille + bloc prévu à l’horaire − heures du jour qui sort de la fenêtre (' + days + ' jours plus tôt). La partie vécue du trait plein se recalcule avec le tableau « Données du graphique : heures par jour » ci-dessous.'
        : 'Each row: rolling total = previous day’s total + block planned on the schedule − hours from the day leaving the window (' + (days + 1) + ' days earlier). The flown part of the solid line can be recalculated from the “Chart data: hours by day” table below.') +
      (todayPlanned > 0 ? (fr
        ? ' La ligne « aujourd’hui » inclut le bloc encore prévu à ton horaire aujourd’hui : ' + fh(have) + ' h enregistrées + ' + fh(todayPlanned) + ' h prévues = ' + fh(todayRoll) + ' h.'
        : ' The “today” row includes the block still planned on your schedule today: ' + fh(have) + ' h recorded + ' + fh(todayPlanned) + ' h planned = ' + fh(todayRoll) + ' h.') : '') + '</p>' +
      '</div></details>';
  }

  return '<p class="chart-title">' + chartTitle + '</p>' +
    '<div class="chart-wrap">' + svg + '</div>' +
    '<p class="chart-note num">' + note + '</p>' + fold;
}

// Daily bars over the trailing window: calm solid flats, zero days as small
// neutral ticks, folded data table underneath.
function _dutyDaysBlock(dd, limit, have, fr) {
  const fh = function (n) { return _dutyFh(n, fr); };
  const fL = function (n) { return _dutyFL(n, fr); };
  const dates = _dutyDateSeq(dd.cut, dd.today);
  const n = Math.max(1, dates.length);
  const vals = dates.map(function (d) { return dd.daily[d] || 0; });
  const maxV = vals.reduce(function (m, v) { return v > m ? v : m; }, 0);
  const top = Math.max(1, Math.ceil(maxV));
  const x0 = 46, plotW = 650, yBase = 118, hMax = 96;
  const pitch = plotW / n;
  const bw = Math.min(19, Math.max(4, pitch * 0.83));
  const r1 = function (v) { return (Math.round(v * 100) / 100).toFixed(2); };

  let zeroRects = '', barRects = '';
  dates.forEach(function (d, i) {
    const x = r1(x0 + pitch * i + (pitch - bw) / 2);
    const v = vals[i];
    const dLbl = esc(fr ? _dutyFmtLong(d, fr) : _dutyFmtShort(d, fr));
    if (v > 0) {
      const h = (v / top) * hMax;
      barRects += '<rect x="' + x + '" y="' + r1(yBase - h) + '" width="' + r1(bw) + '" height="' + r1(h) + '" rx="2.5"><title>' + dLbl + (fr ? ' : ' : ': ') + fh(v) + ' h</title></rect>';
    } else {
      zeroRects += '<rect x="' + x + '" y="115" width="' + r1(bw) + '" height="3" rx="1.5"><title>' + dLbl + (fr ? ' : aucun vol' : ': no flight') + (d === dd.today ? (fr ? ' à ce jour' : ' to date') : '') + '</title></rect>';
    }
  });

  const step = Math.max(1, Math.ceil(top / 3));
  let grid = '', gl = '';
  for (let v = step; v <= top; v += step) {
    const y = yBase - (v / top) * hMax;
    grid += '<line x1="46" y1="' + r1(y) + '" x2="696" y2="' + r1(y) + '"/>';
    gl += '<text x="42" y="' + r1(y + 3) + '">' + fL(v) + ' h</text>';
  }
  gl += '<text x="42" y="121">0</text>';

  const li = [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(3 * (n - 1) / 4), n - 1];
  const seen = {};
  const xl = li.filter(function (i) { return !seen[i] && (seen[i] = 1); }).map(function (i) {
    return '<text x="' + r1(x0 + pitch * (i + 0.5)) + '" y="134">' + esc(_dutyFmtShort(dates[i], fr)) + '</text>';
  }).join('');

  const aria = fr
    ? 'Heures de vol par jour du ' + _dutyFmtLong(dd.cut, fr) + ' au ' + _dutyFmtLong(dd.today, fr) + ', de 0 à ' + fh(maxV) + ' heures par jour, pour un total de ' + fh(have) + ' heures dans la fenêtre. Les valeurs quotidiennes sont listées dans « Données du graphique : heures par jour » sous le graphique.'
    : 'Flight hours by day from ' + _dutyFmtLong(dd.cut, fr) + ' to ' + _dutyFmtLong(dd.today, fr) + ', from 0 to ' + fh(maxV) + ' hours per day, totalling ' + fh(have) + ' hours in the window. The daily values are listed in “Chart data: hours by day” below the chart.';

  const svg = '<svg class="w-days" viewBox="0 0 720 150" role="img" aria-label="' + esc(aria) + '">' +
    '<title>' + (fr ? 'Barres quotidiennes : du ' + _dutyFmtLong(dd.cut, fr) + ' au ' + _dutyFmtLong(dd.today, fr) : 'Daily bars: ' + _dutyFmtLong(dd.cut, fr) + ' to ' + _dutyFmtLong(dd.today, fr)) + '</title>' +
    '<g stroke="var(--v2-hair)" stroke-width="1">' + grid + '</g>' +
    '<line x1="46" y1="118" x2="696" y2="118" stroke="var(--v2-hair-strong)" stroke-width="1"/>' +
    '<g font-size="10" fill="var(--v2-muted)" text-anchor="end">' + gl + '</g>' +
    '<g fill="var(--v2-hair-strong)">' + zeroRects + '</g>' +
    '<g fill="var(--v2-accent-data)">' + barRects + '</g>' +
    '<g font-size="9.5" fill="var(--v2-muted)" text-anchor="middle">' + xl + '</g>' +
    '</svg>';

  let rows = '';
  const zeroDates = [];
  dates.forEach(function (d, i) {
    if (vals[i] > 0) rows += '<tr><th scope="row" class="num">' + esc(_dutyFmtShort(d, fr)) + '</th><td class="r num">' + fh(vals[i]) + ' h</td></tr>';
    else zeroDates.push(d);
  });
  const zeroNote = _dutyZeroDaysNote(zeroDates, dd.today, fr);
  const fold = '<details class="fold"><summary>' + DUTY_CHEV + (fr ? 'Données du graphique : heures par jour' : 'Chart data: hours by day') + '</summary>' +
    '<div class="fold-body tbl-wrap"><table><thead><tr><th scope="col">Date</th><th class="r" scope="col">' + (fr ? 'Heures de vol' : 'Flight hours') + '</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '<tfoot><tr class="row-total"><th scope="row">' + (fr ? 'Total de la fenêtre' : 'Window total') + '</th><td class="r num">' + fh(have) + ' h</td></tr></tfoot>' +
    '</table>' + (zeroNote ? '<p class="footnote">' + zeroNote + '</p>' : '') + '</div></details>';

  return '<div class="hist-head"><p class="chart-title">' + (fr ? 'Heures de vol par jour' : 'Flight hours by day') + '</p>' +
    '<span class="meta num">' + (fr ? 'Fenêtre : ' : 'Window: ') + fh(have) + ' h ' + (fr ? 'sur' : 'of') + ' ' + fL(limit) + ' h</span></div>' +
    '<div class="chart-wrap">' + svg + '</div>' + fold;
}

// "No flights: June 21, 25 and 29; July 2, 3 (to date)." — grouped by month,
// suffix only when today itself has no flight yet.
function _dutyZeroDaysNote(zeroDates, today, fr) {
  if (!zeroDates.length) return '';
  const groups = [];
  zeroDates.forEach(function (d) {
    const p = String(d).split('-').map(Number);
    let m;
    try { m = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { month: 'long', timeZone: 'UTC' }); }
    catch (e) { m = String(p[1]); }
    const last = groups[groups.length - 1];
    if (last && last.m === m) last.days.push(p[2]);
    else groups.push({ m: m, days: [p[2]] });
  });
  const joinDays = function (ds) {
    if (ds.length === 1) return String(ds[0]);
    return ds.slice(0, -1).join(', ') + (fr ? ' et ' : ' and ') + ds[ds.length - 1];
  };
  const parts = groups.map(function (g) { return fr ? (joinDays(g.days) + ' ' + g.m) : (g.m + ' ' + joinDays(g.days)); });
  const todayZero = zeroDates.indexOf(today) !== -1;
  return (fr ? 'Jours sans vol : ' : 'No flights: ') + parts.join(fr ? ' ; ' : '; ') +
    (todayZero ? (fr ? ' (à ce jour)' : ' (to date)') : '') + '.';
}

// Counted-flights list: 10 most recent up front, the rest in a fold, and ONE
// single total row for the whole window.
function _dutyFlightsBlock(counted, days, limit, have, fr) {
  const fh = function (n) { return _dutyFh(n, fr); };
  const fL = function (n) { return _dutyFL(n, fr); };
  const recent = counted.slice(0, 10);
  const others = counted.slice(10);
  const row = function (c) {
    return '<tr><td class="num">' + esc(_dutyFmtShort(c.date, fr)) + '</td>' +
      '<td class="num">' + (c.num ? esc(c.num) : '–') + '</td>' +
      '<td>' + (c.route ? esc(c.route) : (c.type ? esc(c.type) : '–')) + '</td>' +
      '<td class="r num">' + fh(c.hrs) + ' h</td></tr>';
  };
  const head = '<thead><tr><th>Date</th><th>' + (fr ? 'Vol' : 'Flight') + '</th><th>' + (fr ? 'Trajet' : 'Route') + '</th><th class="r">' + (fr ? 'Bloc' : 'Block') + '</th></tr></thead>';

  let oRange = '';
  if (others.length) {
    oRange = fr
      ? _dutyFmtLong(others[others.length - 1].date, fr) + ' au ' + _dutyFmtLong(others[0].date, fr)
      : _dutyFmtLong(others[others.length - 1].date, fr) + ' to ' + _dutyFmtLong(others[0].date, fr);
  }
  let note;
  if (others.length > 1) {
    note = fr
      ? 'Tes 10 vols les plus récents. Les ' + others.length + ' autres vols de la fenêtre (' + oRange + ') se déplient sous le tableau. Tous sont comptés dans le total.'
      : 'Your 10 most recent flights. The other ' + others.length + ' flights in the window (' + oRange + ') unfold below the table. All are counted in the total.';
  } else if (others.length === 1) {
    note = fr
      ? 'Tes 10 vols les plus récents. L’autre vol de la fenêtre (' + oRange + ') se déplie sous le tableau. Tous sont comptés dans le total.'
      : 'Your 10 most recent flights. The other flight in the window (' + oRange + ') unfolds below the table. All are counted in the total.';
  } else {
    note = fr
      ? 'Tes vols de la fenêtre, du plus récent au plus ancien. Tous sont comptés dans le total.'
      : 'Your flights in the window, most recent first. All are counted in the total.';
  }

  const totalRow = '<tfoot><tr class="row-total"><td colspan="3">' +
    (fr ? 'Total sur ' + days + ' jours (' + counted.length + ' vols)' : days + '-day total (' + counted.length + ' flights)') +
    '</td><td class="r num">' + fh(have) + ' h <span class="of">/ ' + fL(limit) + ' h</span></td></tr></tfoot>';

  let html = '<p class="chart-title">' + (fr ? 'Vols comptés dans la fenêtre' : 'Flights counted in the window') + '</p>' +
    '<p class="tbl-note">' + note + '</p>' +
    '<div class="tbl-wrap"><table>' + head + '<tbody>' + recent.map(row).join('') + '</tbody>' + totalRow + '</table></div>';

  if (others.length) {
    const summary = others.length > 1
      ? (fr ? 'Voir les ' + others.length + ' autres vols (' + oRange + ')' : 'See the other ' + others.length + ' flights (' + oRange + ')')
      : (fr ? 'Voir l’autre vol (' + oRange + ')' : 'See the other flight (' + oRange + ')');
    html += '<details class="fold"><summary>' + DUTY_CHEV + summary + '</summary>' +
      '<div class="fold-body tbl-wrap"><table>' + head + '<tbody>' + others.map(row).join('') + '</tbody></table></div></details>';
  }
  return html;
}

// Regulatory footnote (register-verified wording — see the file header).
// boundsNote (optional) = the honest window-bounds line built by _dutyDetailHtml.
function _dutyRegFootnote(fr, boundsNote) {
  return '<div class="footnote">' + (boundsNote ? '<p class="num">' + boundsNote + '</p>' : '') + '<p>' + (fr
    ? 'Limite quotidienne : pour un équipage multipilote, il n’y a pas de limite simple de temps de vol par jour. Le plafond quotidien est la période de service de vol. La limite de 8 h par 24 h ne vise que « le cas d’un aéronef utilisé par un seul pilote » (RAC 700.27(1)d, texte officiel vérifié sur laws-lois.justice.gc.ca le 2026-07-16).'
    : 'Daily limit: for a multi-pilot crew, there is no simple daily flight time limit. The daily ceiling is the flight duty period. The 8 h per 24 h limit applies only “in the case of a single-pilot operation” (CAR 700.27(1)(d), official text verified on laws-lois.justice.gc.ca, 2026-07-16).') +
    '</p><p>' + (fr
    ? 'S’applique aux opérations commerciales (Sous-partie 700). Source : RAC 700.27.'
    : 'Applies to commercial operations (Subpart 700). Source: CAR 700.27.') + '</p></div>';
}
