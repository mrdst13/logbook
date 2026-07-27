// ═══════════════════════════════════════════════════════════════════
//  NIGHT RECHECK — repair the day/night split on flights already logged
// ═══════════════════════════════════════════════════════════════════
// Two defects, both fixed on 2026-07-26, had already written values into
// the logbook:
//
//   1. The block-off anchor. This feed puts the CHECK-IN in DTSTART and
//      Cumulo read it as the departure. On the first leg of a duty that
//      is a full hour early (PD589: DTSTART/CI 1000Z against STD 1100Z),
//      so the RAC 101.01 split was computed over the wrong window.
//   2. calculateDayNightSplit charged the final partial minute twice, so
//      night was overstated by up to a minute on any leg whose block is
//      not a whole number of minutes, and a leg flown entirely at night
//      came out with a NEGATIVE day figure.
//
// This is the only code in Cumulo that REWRITES values already in the
// logbook, so it is built as a review screen, not a migration. The first
// version of it was taken apart by an adversarial review on 2026-07-26
// which found fourteen defects; the rules below are what came out of it.
//
//   AUTHORSHIP. A stored split may be corrected only when it is
//   reproducible as this app's own output: the OLD algorithm or the
//   CURRENT one, at the stored anchor or at the roster anchor. Anything
//   else was set by the pilot and is left alone. Testing only the old
//   algorithm made the tool accuse him of hand-entering the values it had
//   itself written one run earlier.
//
//   IDENTITY. Rows are addressed by id, never by array index, and their
//   current values are re-checked at write time. A cloud pull can delete
//   a row while the panel is open, and index-based writing then landed a
//   correction, and an invented departure time, on a completely different
//   flight.
//
//   EVERY COLUMN WRITTEN IS A COLUMN SHOWN. Cross-country hours get the
//   same authorship test as the main pair and appear in the table when
//   they will change. The first version mirrored the split into
//   cross-country without checking or displaying it.
//
//   NEVER INVENT AN ANCHOR. The correct one is the leg's STD, which the
//   logbook does not store, so the roster is re-read and matched on the
//   roster's own UID. If the roster cannot be read at all, Apply is
//   refused rather than writing a value derived from the anchor known to
//   be wrong.
//
// Nothing is written until Apply, and a snapshot is taken first.

const NIGHT_RECHECK_STEP_MS = 60000;
const NIGHT_RECHECK_EPS = 0.005;

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

// Every split this app could have produced for a leg, across both
// algorithms and both plausible anchors. A stored pair matching any of
// them is app output and may be corrected; anything else is the pilot's.
function _nightRecheckAppOutputs(anchors, block, depCoords, arrCoords) {
  const out = [];
  for (const a of anchors) {
    if (!a) continue;
    const on = new Date(a.getTime() + block * 3600000);
    out.push(_legacyDayNightSplit(a, on, depCoords, arrCoords));
    out.push(calculateDayNightSplit(a, on, depCoords, arrCoords));
  }
  return out;
}

function _nightRecheckMatches(day, night, candidates) {
  return candidates.some(c =>
    Math.abs(day - c.dayHours) <= NIGHT_RECHECK_EPS &&
    Math.abs(night - c.nightHours) <= NIGHT_RECHECK_EPS);
}

// Build the UID -> block-off map from the live roster feed. `ok` is false
// on any failure, and the caller then refuses to write rather than
// deriving hours from an anchor it knows to be wrong.
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
  // Counted separately so each can be described honestly. Lumping them
  // together produced a panel that told him he had hand-entered hours he
  // had never touched.
  const skipped = { pilotSet: 0, hasActual: 0, signed: 0, noAnchor: 0, noCoords: 0, noBlock: 0 };
  if (!Array.isArray(flights)) return { rows, skipped };

  for (let i = 0; i < flights.length; i++) {
    const f = flights[i];
    if (!f || f.isSim) continue;
    // A signed row is an attestation over the numbers as they stood when
    // it was signed. Changing them underneath it would leave a signature
    // covering figures that are no longer the ones signed for, so those
    // rows are reported and left as they are.
    if (f.signedBy || f.signedAt) { skipped.signed++; continue; }
    const block = +f.block || +f.total || 0;
    if (block <= 0) { skipped.noBlock++; continue; }
    const storedAnchor = f.dtstart_utc ? new Date(f.dtstart_utc) : null;
    if (!storedAnchor || isNaN(storedAnchor.getTime())) { skipped.noAnchor++; continue; }
    // A recorded actual departure is a better anchor than anything this
    // tool has, and rebuilding the split from it is a different job.
    if (f.atd_utc) { skipped.hasActual++; continue; }
    const depCoords = AIRPORT_COORDS[f.dep_icao];
    const arrCoords = AIRPORT_COORDS[f.arr_icao];
    if (!depCoords || !arrCoords) { skipped.noCoords++; continue; }
    const cols = _nightRecheckColumns(f);
    if (!cols) { skipped.noBlock++; continue; }

    const uid = f.navblueUid ? String(f.navblueUid) : '';
    const freshIso = uid && map[uid] ? map[uid] : '';
    const rosterAnchor = freshIso ? new Date(freshIso) : null;
    const anchor = rosterAnchor || storedAnchor;
    // Instants, not strings: the same moment comes back from Supabase in
    // the offset form and would otherwise read as a change.
    const anchorFixed = !!freshIso && Date.parse(freshIso) !== Date.parse(f.dtstart_utc);

    const candidates = _nightRecheckAppOutputs([storedAnchor, rosterAnchor], block, depCoords, arrCoords);
    const curDay = +f[cols.day] || 0;
    const curNight = +f[cols.night] || 0;
    if (!_nightRecheckMatches(curDay, curNight, candidates)) { skipped.pilotSet++; continue; }

    const blockOn = new Date(anchor.getTime() + block * 3600000);
    const fixed = calculateDayNightSplit(anchor, blockOn, depCoords, arrCoords);

    // Cross-country gets its own authorship test. It is only rewritten
    // when the app wrote it too, and only then is it shown.
    const curXcDay = +f[cols.xcDay] || 0;
    const curXcNight = +f[cols.xcNight] || 0;
    const hasXc = (curXcDay + curXcNight) > 0;
    const xcIsAppWritten = hasXc && _nightRecheckMatches(curXcDay, curXcNight, candidates);
    const xcChanges = xcIsAppWritten &&
      (Math.abs(fixed.dayHours - curXcDay) > NIGHT_RECHECK_EPS ||
       Math.abs(fixed.nightHours - curXcNight) > NIGHT_RECHECK_EPS);

    const meChanges = Math.abs(fixed.dayHours - curDay) > NIGHT_RECHECK_EPS ||
                      Math.abs(fixed.nightHours - curNight) > NIGHT_RECHECK_EPS;
    if (!meChanges && !xcChanges && !anchorFixed) continue;
    if (!meChanges && !xcChanges) continue;

    rows.push({
      id: f.id,
      date: f.date,
      flightNum: f.flightNum || '',
      route: f.route || '',
      block: block,
      // The INPUTS the proposed hours were computed from. Re-checking only
      // the values being written was not enough: a block corrected on the
      // other device while the panel was open left day and night that no
      // longer belonged to the flight at all.
      dep: f.dep_icao || '', arr: f.arr_icao || '',
      oldAnchor: f.dtstart_utc || '',
      hasXc: hasXc,
      cols: cols,
      fromDay: curDay, fromNight: curNight,
      toDay: fixed.dayHours, toNight: fixed.nightHours,
      touchesXc: xcChanges,
      fromXcDay: curXcDay, fromXcNight: curXcNight,
      xcKept: hasXc && !xcIsAppWritten,
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
  // Apply is only offered when the roster was actually read. Writing an
  // arithmetic-only value derived from the known-wrong anchor would look
  // like a repair while leaving the real error in place.
  _nightRecheckPlan = anchors.ok ? plan.rows : null;
  if (btn) { btn.disabled = false; btn.textContent = t('nightRecheck.btn'); }

  const overlay = document.getElementById('importPreview');
  if (!overlay) { showToast(t('nightRecheck.noUi'), 'error'); return; }

  const anchorNote = anchors.ok ? t('nightRecheck.rosterRead') : t('nightRecheck.rosterMissed');
  const fixedAnchors = plan.rows.filter(r => r.anchorFixed).length;
  const netNight = plan.rows.reduce((s, r) => s + (r.toNight - r.fromNight), 0);
  const one = plan.rows.length === 1;

  // With the roster unreadable nothing can be written, so the panel must
  // not invite him to press Apply or quote a movement in night hours that
  // is never going to happen. It shows what it FOUND, and says so.
  const introKey = !anchors.ok ? 'nightRecheck.introBlocked' : (one ? 'nightRecheck.introOne' : 'nightRecheck.intro');
  const head = plan.rows.length === 0
    ? `<p style="font-size:14px; line-height:1.6;">${esc(anchors.ok ? t('nightRecheck.nothing') : t('nightRecheck.nothingOffline'))}</p>`
    : `<p style="font-size:13px; color:var(--text-secondary); line-height:1.6; margin-bottom:var(--s-3);">
         ${esc(t(introKey, {
           n: plan.rows.length, anchors: fixedAnchors,
           night: (netNight >= 0 ? '+' : '') + netNight.toFixed(2)
         }))}
       </p>`;

  const table = plan.rows.length === 0 ? '' : `
      <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-family:var(--font-mono); font-size:11px;">
        <thead><tr style="text-align:left; color:var(--text-muted);">
          <th style="padding:6px 8px;">${esc(t('nightRecheck.colFlight'))}</th>
          <th style="padding:6px 8px;">${esc(t('nightRecheck.colDay'))}</th>
          <th style="padding:6px 8px;">${esc(t('nightRecheck.colNight'))}</th>
          <th style="padding:6px 8px;">${esc(t('nightRecheck.colXc'))}</th>
          <th style="padding:6px 8px;">${esc(t('nightRecheck.colWhy'))}</th>
        </tr></thead>
        <tbody>
        ${plan.rows.map(r => `
          <tr style="border-top:1px solid var(--border);">
            <td style="padding:6px 8px;">${esc(r.date)} ${esc(r.flightNum)} ${esc(r.route)}</td>
            <td style="padding:6px 8px;">${r.fromDay.toFixed(2)} &rarr; <strong>${r.toDay.toFixed(2)}</strong></td>
            <td style="padding:6px 8px;">${r.fromNight.toFixed(2)} &rarr; <strong>${r.toNight.toFixed(2)}</strong></td>
            <td style="padding:6px 8px;">${r.touchesXc
              ? `${r.fromXcDay.toFixed(2)}/${r.fromXcNight.toFixed(2)} &rarr; <strong>${r.toDay.toFixed(2)}/${r.toNight.toFixed(2)}</strong>`
              : (r.xcKept ? esc(t('nightRecheck.xcKept'))
                          : (r.hasXc ? `${r.fromXcDay.toFixed(2)}/${r.fromXcNight.toFixed(2)} ${esc(t('nightRecheck.xcUnchanged'))}`
                                     : esc(t('nightRecheck.xcNone'))))}</td>
            <td style="padding:6px 8px; color:var(--text-secondary);">${esc(r.anchorFixed ? t('nightRecheck.whyAnchor') : t('nightRecheck.whyMinute'))}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;

  const notes = [];
  notes.push(anchorNote);
  const pluralKey = (base, n) => (n === 1 ? base + 'One' : base);
  if (skippedCount(plan.skipped.pilotSet)) notes.push(t(pluralKey('nightRecheck.skippedPilot', plan.skipped.pilotSet), { n: plan.skipped.pilotSet }));
  if (skippedCount(plan.skipped.hasActual)) notes.push(t(pluralKey('nightRecheck.skippedActual', plan.skipped.hasActual), { n: plan.skipped.hasActual }));
  if (skippedCount(plan.skipped.signed)) notes.push(t(pluralKey('nightRecheck.skippedSigned', plan.skipped.signed), { n: plan.skipped.signed }));
  const notesHtml = `<div style="font-size:12px; color:var(--text-secondary); line-height:1.6; margin-top:var(--s-3);">${
    notes.map(n => `<p style="margin:0 0 6px 0;">${esc(n)}</p>`).join('')}</div>`;

  document.getElementById('importSubtitle').textContent = t('nightRecheck.subtitle');
  document.getElementById('extractedList').innerHTML = head + table + notesHtml;

  const canApply = anchors.ok && plan.rows.length > 0;
  const confirmBtn = document.getElementById('importConfirmBtn');
  confirmBtn.textContent = canApply
    ? t(one ? 'nightRecheck.applyOne' : 'nightRecheck.apply', { n: plan.rows.length })
    : t('nightRecheck.close');
  confirmBtn.disabled = false;
  confirmBtn.onclick = () => (canApply ? applyNightRecheck() : closeImportOverlay());
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function skippedCount(n) { return (+n || 0) > 0; }

// Is this row still exactly the row that was reviewed? Every value the
// write will touch, every input those values were computed from, and
// every precondition that let the row into the plan.
function _nightRecheckStillValid(f, r) {
  if (Math.abs((+f[r.cols.day] || 0) - r.fromDay) > NIGHT_RECHECK_EPS) return false;
  if (Math.abs((+f[r.cols.night] || 0) - r.fromNight) > NIGHT_RECHECK_EPS) return false;
  if (r.touchesXc &&
      (Math.abs((+f[r.cols.xcDay] || 0) - r.fromXcDay) > NIGHT_RECHECK_EPS ||
       Math.abs((+f[r.cols.xcNight] || 0) - r.fromXcNight) > NIGHT_RECHECK_EPS)) return false;
  // Inputs: hours computed from a block or a pair of airports that have
  // since changed do not belong to this flight any more.
  if (Math.abs((+f.block || +f.total || 0) - r.block) > NIGHT_RECHECK_EPS) return false;
  if ((f.dep_icao || '') !== r.dep || (f.arr_icao || '') !== r.arr) return false;
  // The anchor is written too, so it gets the same treatment as the rest.
  if (Date.parse(f.dtstart_utc || '') !== Date.parse(r.oldAnchor || '')) return false;
  // Preconditions that let the row into the plan.
  if (f.atd_utc || f.signedBy || f.signedAt) return false;
  return true;
}

function applyNightRecheck() {
  const rows = _nightRecheckPlan || [];
  if (!rows.length) { closeImportOverlay(); return; }

  // Decide what is still writable BEFORE touching anything. Snapshotting
  // first burned one of the ten recovery points even on a run that turned
  // out to write nothing.
  const writable = [];
  let dropped = 0;
  for (const r of rows) {
    // By id, never by index: a cloud pull can remove a row while the
    // panel is open, and every later index then shifts by one.
    const f = r.id ? flights.find(x => x && x.id === r.id) : null;
    if (!f || !_nightRecheckStillValid(f, r)) { dropped++; continue; }
    writable.push({ f: f, r: r });
  }
  if (!writable.length) {
    _nightRecheckPlan = null;
    closeImportOverlay();
    showToast(t('nightRecheck.noneLeft'), 'error');
    return;
  }

  // No undo point, no rewrite. This is the only tool that overwrites
  // hours already in the logbook, so without a stored "before" state the
  // previous figures would exist nowhere.
  if (typeof snapshotBeforeOperation !== 'function' || snapshotBeforeOperation('Night recheck') !== true) {
    showToast(t('nightRecheck.noSnapshot'), 'error');
    return;
  }

  const touched = [];
  for (const { f, r } of writable) {
    f[r.cols.day] = r.toDay;
    f[r.cols.night] = r.toNight;
    if (r.touchesXc) {
      f[r.cols.xcDay] = r.toDay;
      f[r.cols.xcNight] = r.toNight;
    }
    if (r.anchorFixed && r.newAnchor) f.dtstart_utc = r.newAnchor;
    if (f.id) touched.push(f.id);
  }
  DB.save(flights);
  // Mark them dirty for the cloud. A device whose fingerprint map is
  // empty treats every row as already synced on the next push, which
  // would leave these corrections local and let the other device's copy
  // win the next pull, undoing them.
  try {
    if (typeof Sync !== 'undefined' && Sync._loadSyncedSig && Sync._saveSyncedSig) {
      const sm = Sync._loadSyncedSig();
      let n = 0;
      for (const id of touched) { if (id in sm) { delete sm[id]; n++; } }
      if (n > 0) Sync._saveSyncedSig(sm);
    }
  } catch (e) { /* non-fatal: the row still pushes on its next change */ }
  if (typeof Sync !== 'undefined' && Sync.pushAllFlights) {
    try { Sync.pushAllFlights(); } catch (e) { /* offline: queued for later */ }
  }
  _nightRecheckPlan = null;
  closeImportOverlay();
  if (typeof updateUndoButton === 'function') updateUndoButton();
  if (typeof renderDashboard === 'function') renderDashboard();
  const changed = writable.length;
  showToast(dropped > 0
    ? t(dropped === 1 ? 'nightRecheck.donePartialOne' : 'nightRecheck.donePartial',
        { n: changed, w: t(changed === 1 ? 'word.flight' : 'word.flights'), dropped: dropped })
    : t(changed === 1 ? 'nightRecheck.doneOne' : 'nightRecheck.done', { n: changed }), 'success');
}
