// ═══════════════════════════════════════════════════════════════════
//  NIGHT RECHECK — repair the day/night split on flights already logged
// ═══════════════════════════════════════════════════════════════════
// Two defects, both fixed on 2026-07-26, both of which had already
// written values into the logbook:
//
//   1. The block-off anchor. This feed puts the CHECK-IN in DTSTART, and
//      Cumulo read it as the departure. On the first leg of a duty that
//      is a full hour early (PD589: DTSTART/CI 1000Z against STD 1100Z),
//      so the RAC 101.01 split was computed over the wrong window.
//   2. calculateDayNightSplit charged the final partial minute twice, so
//      night was overstated by up to a minute on any leg whose block is
//      not a whole number of minutes, and a leg flown entirely at night
//      came out with a NEGATIVE day figure.
//
// Repairing this cannot be done blind. Two rules govern it:
//
//   NEVER overwrite a value the pilot put there. For each flight the tool
//   recomputes what the OLD code would have produced. If the stored value
//   matches, the app wrote it and may be corrected. If it does not match,
//   he typed or edited it, and the row is left alone and reported as
//   such. See feedback_recalc_never_overwrites_pilot_values.
//
//   NEVER invent an anchor. The correct anchor is the leg's STD, which
//   the logbook does not store, so the tool re-reads the roster feed and
//   matches by the roster's own UID. A flight whose leg is no longer
//   published can only have the arithmetic corrected, and the report says
//   so per row rather than pretending the fix was complete.
//
// Nothing is written until the pilot presses Apply, and a snapshot is
// taken first so Undo works.

const NIGHT_RECHECK_STEP_MS = 60000;

// The day/night split EXACTLY as it was computed before 2026-07-26, kept
// only so the tool can recognise its own past output. Do not call it for
// anything else.
function _legacyDayNightSplit(blockOffUTC, blockOnUTC, depCoords, arrCoords) {
  const totalMs = blockOnUTC.getTime() - blockOffUTC.getTime();
  if (totalMs <= 0) return { dayHours: 0, nightHours: 0 };
  const totalHours = totalMs / 3600000;
  const lat = (depCoords.lat + arrCoords.lat) / 2;
  const lon = (depCoords.lon + arrCoords.lon) / 2;
  let nightMs = 0;
  for (let t = blockOffUTC.getTime(); t < blockOnUTC.getTime(); t += NIGHT_RECHECK_STEP_MS) {
    if (isNightUTC(new Date(t), lat, lon)) nightMs += NIGHT_RECHECK_STEP_MS;
  }
  const remainder = totalMs % NIGHT_RECHECK_STEP_MS;
  if (remainder > 0 && isNightUTC(new Date(blockOnUTC.getTime() - 1), lat, lon)) {
    nightMs += remainder;
  }
  const nightHours = +(nightMs / 3600000).toFixed(2);
  const dayHours = +(totalHours - nightHours).toFixed(2);
  return { dayHours, nightHours };
}

// Which day/night columns a flight uses depends on the seat it was flown
// in. Only the pair that carries the block is touched.
function _nightRecheckColumns(f) {
  const pic = (+f.meDayPic || 0) + (+f.meNightPic || 0);
  const cop = (+f.meDayCop || 0) + (+f.meNightCop || 0);
  if (cop > 0 && cop >= pic) return { day: 'meDayCop', night: 'meNightCop', xcDay: 'xcDayCop', xcNight: 'xcNightCop' };
  if (pic > 0) return { day: 'meDayPic', night: 'meNightPic', xcDay: 'xcDayPic', xcNight: 'xcNightPic' };
  return null;
}

// Build the UID -> block-off map from the live roster feed. Returns an
// empty map on any failure: the tool then reports "arithmetic only" per
// row instead of silently using a wrong anchor.
async function _nightRecheckFetchAnchors() {
  const url = localStorage.getItem(NAVBLUE_URL_KEY);
  if (!url) return { map: {}, ok: false, reason: 'no-url' };
  try {
    const resp = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fetch-ics', url })
    });
    const rawText = await resp.text();
    if (!resp.ok) return { map: {}, ok: false, reason: 'worker' };
    let icsText = rawText;
    if (rawText.startsWith('{')) {
      try { const j = JSON.parse(rawText); icsText = j.ics || j.body || rawText; } catch (e) { /* raw */ }
    }
    if (!icsText.includes('BEGIN:VCALENDAR')) return { map: {}, ok: false, reason: 'not-ical' };
    const map = {};
    for (const ev of parseICS(icsText)) {
      const uid = ev.UID ? String(ev.UID) : '';
      if (!uid) continue;
      const off = icalBlockOffUTC(ev);
      if (off) map[uid] = off.toISOString();
    }
    return { map, ok: true, reason: '' };
  } catch (e) {
    return { map: {}, ok: false, reason: 'offline' };
  }
}

// Work out, without changing anything, what each flight's split should be.
function buildNightRecheckPlan(anchorMap) {
  const map = anchorMap || {};
  const rows = [];
  const skipped = { edited: 0, noAnchor: 0, noCoords: 0, noBlock: 0 };
  if (!Array.isArray(flights)) return { rows, skipped };

  for (let i = 0; i < flights.length; i++) {
    const f = flights[i];
    if (!f || f.isSim) continue;
    const block = +f.block || +f.total || 0;
    if (block <= 0) { skipped.noBlock++; continue; }
    // Only roster-derived rows: a hand-typed flight has no stored anchor
    // and nothing here can improve it.
    const storedAnchor = f.dtstart_utc ? new Date(f.dtstart_utc) : null;
    if (!storedAnchor || isNaN(storedAnchor.getTime())) { skipped.noAnchor++; continue; }
    // A pilot-supplied actual departure already wins over any roster
    // anchor elsewhere in the app, so those rows are not this tool's
    // business.
    if (f.atd_utc) { skipped.edited++; continue; }
    const depCoords = AIRPORT_COORDS[f.dep_icao];
    const arrCoords = AIRPORT_COORDS[f.arr_icao];
    if (!depCoords || !arrCoords) { skipped.noCoords++; continue; }
    const cols = _nightRecheckColumns(f);
    if (!cols) { skipped.noBlock++; continue; }

    // Did the app write this value, or did he?
    const legacyOn = new Date(storedAnchor.getTime() + block * 3600000);
    const legacy = _legacyDayNightSplit(storedAnchor, legacyOn, depCoords, arrCoords);
    const curDay = +f[cols.day] || 0;
    const curNight = +f[cols.night] || 0;
    if (Math.abs(curDay - legacy.dayHours) > 0.005 || Math.abs(curNight - legacy.nightHours) > 0.005) {
      skipped.edited++;
      continue;
    }

    // Correct anchor when the roster still publishes the leg.
    const uid = f.navblueUid ? String(f.navblueUid) : '';
    const freshAnchorIso = uid && map[uid] ? map[uid] : '';
    const anchor = freshAnchorIso ? new Date(freshAnchorIso) : storedAnchor;
    const anchorFixed = !!freshAnchorIso && freshAnchorIso !== f.dtstart_utc;
    const blockOn = new Date(anchor.getTime() + block * 3600000);
    const fixed = calculateDayNightSplit(anchor, blockOn, depCoords, arrCoords);

    if (Math.abs(fixed.dayHours - curDay) < 0.005 && Math.abs(fixed.nightHours - curNight) < 0.005) continue;

    rows.push({
      idx: i,
      date: f.date,
      flightNum: f.flightNum || '',
      route: f.route || '',
      block: block,
      cols: cols,
      fromDay: curDay, fromNight: curNight,
      toDay: fixed.dayHours, toNight: fixed.nightHours,
      anchorFixed: anchorFixed,
      newAnchor: anchorFixed ? anchor.toISOString() : ''
    });
  }
  return { rows, skipped };
}

let _nightRecheckPlan = null;

async function openNightRecheck() {
  const btn = document.getElementById('nightRecheckBtn');
  if (btn) { btn.disabled = true; btn.textContent = t('nightRecheck.working'); }
  let anchors = { map: {}, ok: false, reason: 'no-url' };
  try { anchors = await _nightRecheckFetchAnchors(); } catch (e) { /* handled below */ }
  const plan = buildNightRecheckPlan(anchors.map);
  _nightRecheckPlan = plan.rows;
  if (btn) { btn.disabled = false; btn.textContent = t('nightRecheck.btn'); }

  const overlay = document.getElementById('importPreview');
  if (!overlay) { showToast(t('nightRecheck.noUi'), 'error'); return; }

  const anchorNote = anchors.ok
    ? t('nightRecheck.rosterRead')
    : t('nightRecheck.rosterMissed');
  const fixedAnchors = plan.rows.filter(r => r.anchorFixed).length;
  const netNight = plan.rows.reduce((s, r) => s + (r.toNight - r.fromNight), 0);

  const body = plan.rows.length === 0
    ? `<p style="font-size:14px; line-height:1.6;">${esc(t('nightRecheck.nothing'))}</p>`
    : `
      <p style="font-size:13px; color:var(--text-secondary); line-height:1.6; margin-bottom:var(--s-3);">
        ${esc(t('nightRecheck.intro', { n: plan.rows.length, anchors: fixedAnchors, night: (netNight >= 0 ? '+' : '') + netNight.toFixed(2) }))}
      </p>
      <p style="font-size:12px; color:var(--text-secondary); margin-bottom:var(--s-3);">${esc(anchorNote)}</p>
      <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-family:var(--font-mono); font-size:11px;">
        <thead><tr style="text-align:left; color:var(--text-muted);">
          <th style="padding:6px 8px;">${esc(t('nightRecheck.colFlight'))}</th>
          <th style="padding:6px 8px;">${esc(t('nightRecheck.colDay'))}</th>
          <th style="padding:6px 8px;">${esc(t('nightRecheck.colNight'))}</th>
          <th style="padding:6px 8px;">${esc(t('nightRecheck.colWhy'))}</th>
        </tr></thead>
        <tbody>
        ${plan.rows.map(r => `
          <tr style="border-top:1px solid var(--border);">
            <td style="padding:6px 8px;">${esc(r.date)} ${esc(r.flightNum)} ${esc(r.route)}</td>
            <td style="padding:6px 8px;">${r.fromDay.toFixed(2)} &rarr; <strong>${r.toDay.toFixed(2)}</strong></td>
            <td style="padding:6px 8px;">${r.fromNight.toFixed(2)} &rarr; <strong>${r.toNight.toFixed(2)}</strong></td>
            <td style="padding:6px 8px; color:var(--text-secondary);">${esc(r.anchorFixed ? t('nightRecheck.whyAnchor') : t('nightRecheck.whyMinute'))}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;

  const skippedNote = (plan.skipped.edited > 0)
    ? `<p style="font-size:12px; color:var(--text-secondary); margin-top:var(--s-3);">${esc(t('nightRecheck.skippedEdited', { n: plan.skipped.edited }))}</p>`
    : '';

  document.getElementById('importSubtitle').textContent = t('nightRecheck.subtitle');
  document.getElementById('extractedList').innerHTML = body + skippedNote;

  const confirmBtn = document.getElementById('importConfirmBtn');
  confirmBtn.textContent = plan.rows.length ? t('nightRecheck.apply', { n: plan.rows.length }) : t('nightRecheck.close');
  confirmBtn.disabled = false;
  confirmBtn.onclick = () => (plan.rows.length ? applyNightRecheck() : closeImportOverlay());
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function applyNightRecheck() {
  const rows = _nightRecheckPlan || [];
  if (!rows.length) { closeImportOverlay(); return; }
  if (typeof snapshotBeforeOperation === 'function') snapshotBeforeOperation('Night recheck');
  let changed = 0;
  for (const r of rows) {
    const f = flights[r.idx];
    if (!f) continue;
    f[r.cols.day] = r.toDay;
    f[r.cols.night] = r.toNight;
    // Cross-country mirrors the same split when the leg counts as XC.
    const xcTotal = (+f[r.cols.xcDay] || 0) + (+f[r.cols.xcNight] || 0);
    if (xcTotal > 0) {
      f[r.cols.xcDay] = r.toDay;
      f[r.cols.xcNight] = r.toNight;
    }
    if (r.anchorFixed && r.newAnchor) f.dtstart_utc = r.newAnchor;
    changed++;
  }
  DB.save(flights);
  _nightRecheckPlan = null;
  closeImportOverlay();
  if (typeof updateUndoButton === 'function') updateUndoButton();
  if (typeof renderDashboard === 'function') renderDashboard();
  showToast(t('nightRecheck.done', { n: changed }), 'success');
}
