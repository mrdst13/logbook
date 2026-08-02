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
//  flight time, nothing here is counted, and the page says so. Times are shown
//  in UTC because that is exactly what the feed publishes: converting them to
//  a local clock would mean guessing a timezone per station, and a guessed
//  time on a pilot's schedule is worse than an honest Z.
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

// Local calendar date of an instant, as YYYY-MM-DD. The grid is a wall
// calendar, so an event belongs to the day the pilot would point at.
function _schedLocalDay(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

function _schedHHMMz(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  return p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + 'Z';
}

// Classify a roster line for colour only. Anything unrecognised stays neutral
// and keeps its own wording — the feed's text is never rewritten.
function _schedKind(summary) {
  const s = (summary || '').toUpperCase();
  if (/^(SDO|DO|OFF|RD)\b/.test(s)) return 'off';
  if (/\bSTBY|STANDBY|RESERVE|RES\b/.test(s)) return 'standby';
  if (/^(GD|GND|TRG|TRAINING|SIM|CBT|MTG)\b/.test(s)) return 'ground';
  if (/\b[A-Z]{3}-[A-Z]{3}\b/.test(s)) return 'flight';
  return 'other';
}

// Events grouped by the local day they start on.
function _schedByDay(events) {
  const map = new Map();
  for (const e of (events || [])) {
    const day = _schedLocalDay(e.start);
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
    const chips = items.map(function (e) {
      const kind = _schedKind(e.summary);
      const time = (kind === 'off') ? '' : _schedHHMMz(e.start);
      return '<div class="sched-chip sched-' + kind + '" title="' + esc(e.summary) + '">' +
        (time ? '<span class="sched-t">' + time + '</span> ' : '') + esc(e.summary) + '</div>';
    }).join('');
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
    foot.textContent = (fr
      ? shown + ' élément' + (shown === 1 ? '' : 's') + ' à ton horaire ce mois-ci. Heures en UTC, telles que publiées. Horaire publié, pas ton carnet.'
      : shown + ' item' + (shown === 1 ? '' : 's') + ' on your roster this month. Times in UTC, exactly as published. This is the published schedule, not your logbook.') +
      (readAt ? (fr ? ' Lu le ' + readAt + '.' : ' Read ' + readAt + '.') : '');
  }
}
