// ═══════════════════════════════════════════
//  SCHEDULE (page-schedule) — the published roster on a month calendar
//
//  Martin, 2026-08-01: "peux-tu ajouter schedule aussi dans la barre quelque
//  part donc je peux voir ma schedule sur un calendrier type Apple iPhone ou
//  Google Calendar."
//
//  Reads cumulo_roster_calendar_v1, written by syncNavblueNow from the SAME
//  fetch that feeds everything else — no extra network call, no second source
//  of truth. That cache holds every roster event, not just the pilot's own
//  flights, because a roster is also days off, ground duty and standby.
//
//  THIS IS THE PUBLISHED SCHEDULE, NEVER THE LOGBOOK. Nothing on this page is
//  flight time, nothing here is counted, and the page says so.
//
//  TIMES ARE THE STATION'S LOCAL CLOCK, READ FROM THE FEED. This shipped in Zulu
//  first, on the reasoning that converting would mean guessing a timezone per
//  station. Martin, 2026-08-02: "en heure zulu ça fuck les jours de congé, ça dit
//  que j'ai des vols et congé en même temps". He was right, and the premise was
//  wrong: the feed prints both clocks side by side ("CI 1430Z / 1030L"), so the
//  local time is published, not guessed — and reading it also puts each event on
//  the calendar day the pilot would point at. An event that publishes no local
//  time falls back to this device's clock and is counted out loud in the footer.
// ═══════════════════════════════════════════

let _schedMonth = null;   // {y, m} — the month on screen; null = current month

function loadRosterCalendar() {
  try {
    const raw = localStorage.getItem(CUMULO_CALENDAR_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return (o && Array.isArray(o.events)) ? o : null;
  } catch (e) { return null; }
}

// The instant, shifted onto the clock the ROSTER prints for that event.
//
// `offMin` is read from the feed's own "1430Z / 1030L" pairs (see
// icalPublishedLocalOffsetMin), so this is the operator's own local time, not a
// conversion Cumulo invented. When an event publishes no local time we fall
// back to this device's clock, which is right for anything at the pilot's base
// and is the only honest option left.
function _schedAtLocal(ev) {
  const d = new Date(ev && ev.start);
  if (isNaN(d.getTime())) return null;
  if (ev && typeof ev.offMin === 'number') {
    // Shift the instant, then read it in UTC: that yields the station's wall
    // clock without dragging the device's own timezone into it.
    return { d: new Date(d.getTime() + ev.offMin * 60000), published: true };
  }
  return { d: d, published: false };
}

// Local calendar date, as YYYY-MM-DD. The grid is a wall calendar, so an event
// belongs to the day the pilot would point at on his own roster.
function _schedLocalDay(ev) {
  const at = _schedAtLocal(ev);
  if (!at) return null;
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  return at.published
    ? at.d.getUTCFullYear() + '-' + p2(at.d.getUTCMonth() + 1) + '-' + p2(at.d.getUTCDate())
    : at.d.getFullYear() + '-' + p2(at.d.getMonth() + 1) + '-' + p2(at.d.getDate());
}

function _schedHHMM(ev) {
  const at = _schedAtLocal(ev);
  if (!at) return '';
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  return at.published
    ? p2(at.d.getUTCHours()) + p2(at.d.getUTCMinutes())
    : p2(at.d.getHours()) + p2(at.d.getMinutes());
}

// Classify a roster line for colour only. Anything unrecognised stays neutral
// and keeps its own wording — the feed's text is never rewritten.
//
// The operator's own expansion wins over the code. "GD" was being read as
// ground duty and painted as work; Porter spells it out as "GD (Guaranteed Day
// off)", which is the exact opposite. Codes are a fallback for feeds that
// publish no expansion, never the first source. (Martin 2026-08-02.)
function _schedKind(ev) {
  const s = ((ev && ev.summary) || '').toUpperCase();
  const note = ((ev && ev.note) || '').toUpperCase();
  if (note) {
    if (/\bDAY OFF\b|\bDAYS OFF\b|\bVACATION\b|\bREST\b|\bCONG/.test(note)) return 'off';
    if (/\bSTAND ?BY\b|\bRESERVE\b/.test(note)) return 'standby';
    if (/\bHOTEL\b/.test(note)) return 'hotel';
    if (/\bTRAINING\b|\bSIMULATOR\b|\bMEETING\b|\bGROUND\b/.test(note)) return 'ground';
  }
  if (/^(SDO|DO|OFF|RD|VAC)\b/.test(s)) return 'off';
  // APS = Airport Standby (Martin, 2026-08-02: paid the original credit of
  // the day). SNG (Show No Go) stays neutral on purpose: it is neither a day
  // off nor standby, and its own wording says what it is.
  if (/\bSTBY|STANDBY|RESERVE|RES\b|^APS\b/.test(s)) return 'standby';
  if (/^HTL\b/.test(s)) return 'hotel';
  if (/^(GND|TRG|TRAINING|SIM|CBT|MTG)\b/.test(s)) return 'ground';
  if (/\b[A-Z]{3}-[A-Z]{3}\b/.test(s)) return 'flight';
  return 'other';
}

// Events grouped by the local day they start on.
function _schedByDay(events) {
  const map = new Map();
  for (const e of (events || [])) {
    const day = _schedLocalDay(e);
    if (!day) continue;
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(e);
  }
  for (const list of map.values()) list.sort((a, b) => (a.start < b.start ? -1 : 1));
  return map;
}

function scheduleShiftMonth(delta) {
  const base = _schedMonth || (() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; })();
  let y = base.y, m = base.m + delta;
  while (m < 0) { m += 12; y--; }
  while (m > 11) { m -= 12; y++; }
  _schedMonth = { y, m };
  renderSchedule();
}

function scheduleToday() { _schedMonth = null; renderSchedule(); }

function renderSchedule() {
  const host = document.getElementById('scheduleGrid');
  if (!host) return;
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const cache = loadRosterCalendar();
  const notice = document.getElementById('scheduleNotice');

  // Three honest states, exactly like the Duty page: no feed connected, a feed
  // that has never been read on this device, and a feed we have read.
  const configured = (function () { try { return !!localStorage.getItem(NAVBLUE_URL_KEY); } catch (e) { return false; } })();
  if (notice) {
    if (!configured) {
      notice.innerHTML = '<div class="sched-note">' + (fr
        ? 'Aucun horaire connecté. Ajoute ton flux iCal dans Paramètres, Synchro pour voir ton horaire ici.'
        : 'No schedule connected. Add your iCal feed under Settings, Sync to see your roster here.') +
        ' <a href="#" onclick="showPage(\'backup\');setTimeout(function(){if(typeof showSettingsTab===\'function\')showSettingsTab(\'sync\');},60);return false;">' +
        (fr ? 'Ouvrir les réglages' : 'Open settings') + '</a></div>';
    } else if (!cache) {
      notice.innerHTML = '<div class="sched-note">' + (fr
        ? 'Ton horaire est connecté mais n’a pas encore pu être lu sur cet appareil.'
        : 'Your schedule is connected but has not been read on this device yet.') +
        ' <a href="#" onclick="if(typeof syncNavblueNow===\'function\'){Promise.resolve(syncNavblueNow()).catch(function(){}).finally(function(){renderSchedule();});}return false;">' +
        (fr ? 'Synchroniser maintenant' : 'Sync now') + '</a></div>';
    } else {
      notice.innerHTML = '';
    }
  }

  const now = new Date();
  const cur = _schedMonth || { y: now.getFullYear(), m: now.getMonth() };
  const byDay = _schedByDay(cache && cache.events);

  const monthNames = fr
    ? ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
    : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = fr ? ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
                      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const label = document.getElementById('scheduleMonthLabel');
  if (label) label.textContent = monthNames[cur.m] + ' ' + cur.y;

  const first = new Date(cur.y, cur.m, 1);
  const lead = first.getDay();                       // Sunday-first, like the phone
  const daysInMonth = new Date(cur.y, cur.m + 1, 0).getDate();
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  const todayKey = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate());

  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<div class="sched-cell sched-cell-empty" aria-hidden="true"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const key = cur.y + '-' + p2(cur.m + 1) + '-' + p2(d);
    const items = byDay.get(key) || [];
    const isToday = key === todayKey;
    // A flight on a day off is OVERTIME, not a contradiction to hide.
    // Martin, 2026-08-02, verbatim: "gd est un day off et sdo aussi mais si je
    // vol sur un gdo ou sdo ces de lovertime". So the day off keeps its normal
    // weight, the flight keeps its own, and the DAY is flagged — which is worth
    // seeing twice over: either he was paid overtime, or his roster is still
    // publishing a day off that scheduling took back.
    //
    // Flagged, never claimed. The page says what the roster shows and what that
    // combination means; it never asserts he was actually paid, which is the
    // Pay page's business and needs his stub.
    const isOvertime = items.some(function (e) { return _schedKind(e) === 'flight'; }) &&
                       items.some(function (e) { return _schedKind(e) === 'off'; });
    const chips = items.map(function (e) {
      const kind = _schedKind(e);
      const time = (kind === 'off') ? '' : _schedHHMM(e);
      const tip = e.note ? (e.summary + ' — ' + e.note) : e.summary;
      return '<div class="sched-chip sched-' + kind + '" title="' + esc(tip) + '">' +
        (time ? '<span class="sched-t">' + time + '</span> ' : '') + esc(e.summary) + '</div>';
    }).join('') + (isOvertime
      ? '<div class="sched-ot" title="' + esc(fr
          ? 'Ton horaire publie un vol sur un jour de congé. Voler sur un GD ou un SDO, c’est du temps supplémentaire.'
          : 'Your roster publishes a flight on a day off. Flying on a GD or an SDO is overtime.') + '">' +
        (fr ? 'Vol sur congé' : 'Flight on a day off') + '</div>'
      : '');
    cells += '<div class="sched-cell' + (isToday ? ' is-today' : '') + '">' +
      '<div class="sched-daynum">' + d + '</div>' + chips + '</div>';
  }

  host.innerHTML =
    '<div class="sched-head">' + dayNames.map(function (n) { return '<div class="sched-dow">' + n + '</div>'; }).join('') + '</div>' +
    '<div class="sched-body">' + cells + '</div>';

  const foot = document.getElementById('scheduleFoot');
  if (foot) {
    const shown = (function () { let n = 0; byDay.forEach(function (v, k) { if (k.slice(0, 7) === cur.y + '-' + p2(cur.m + 1)) n += v.length; }); return n; })();
    const when = (cache && cache.ts) ? new Date(cache.ts) : null;
    const readAt = when ? (when.getFullYear() + '-' + p2(when.getMonth() + 1) + '-' + p2(when.getDate()) + ' ' + p2(when.getHours()) + ':' + p2(when.getMinutes())) : null;
    // Count anything shown on this device's clock because the roster gave no
    // local time for it, and say so rather than let it pass as station time.
    let guessed = 0;
    byDay.forEach(function (v, k) {
      if (k.slice(0, 7) !== cur.y + '-' + p2(cur.m + 1)) return;
      v.forEach(function (e) { if (typeof e.offMin !== 'number') guessed++; });
    });
    let otDays = 0;
    byDay.forEach(function (v, k) {
      if (k.slice(0, 7) !== cur.y + '-' + p2(cur.m + 1)) return;
      const f = v.some(function (e) { return _schedKind(e) === 'flight'; });
      const o = v.some(function (e) { return _schedKind(e) === 'off'; });
      if (f && o) otDays++;
    });
    foot.textContent = (fr
      ? shown + ' élément' + (shown === 1 ? '' : 's') + ' à ton horaire ce mois-ci. Heures locales de chaque escale, telles que ton horaire les publie. Horaire publié, pas ton carnet.'
      : shown + ' item' + (shown === 1 ? '' : 's') + ' on your roster this month. Local time at each station, exactly as your roster publishes it. This is the published schedule, not your logbook.') +
      (guessed > 0 ? (fr
        ? ' ' + guessed + ' élément' + (guessed === 1 ? ' n’indique' : 's n’indiquent') + ' pas d’heure locale : affiché sur l’heure de cet appareil.'
        : ' ' + guessed + ' item' + (guessed === 1 ? ' publishes' : 's publish') + ' no local time: shown on this device’s clock.') : '') +
      (otDays > 0 ? (fr
        ? (otDays === 1
          ? ' 1 jour porte un vol sur un congé, donc du temps supplémentaire.'
          : ' ' + otDays + ' jours portent un vol sur un congé, donc du temps supplémentaire.') +
          ' Si tu n’en as pas fait, ton horaire publie encore un congé qui t’a été repris.'
        : (otDays === 1
          ? ' 1 day carries a flight on a day off, so overtime.'
          : ' ' + otDays + ' days carry a flight on a day off, so overtime.') +
          ' If you did not fly overtime, your roster is still publishing a day off that was taken back.') : '') +
      (readAt ? (fr ? ' Lu le ' + readAt + '.' : ' Read ' + readAt + '.') : '');
  }
}
