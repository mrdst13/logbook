// ─────────────────────────────────────────────────────────────────
// Cloudflare Turnstile — invisible bot gate for the paid AI import path.
// getTurnstileToken() renders the (invisible) widget once, then returns a FRESH
// token per call. Resolves to '' when Turnstile isn't configured (empty site
// key / library not loaded) — the worker treats a missing token as a no-op
// until TURNSTILE_SECRET is provisioned, so this is safe to ship inert.
// Spec: private/SPEC-ANTI-ABUS-2026-06-27.md (layer A).
// ─────────────────────────────────────────────────────────────────
// Turnstile anti-abuse stub removed 2026-08-02: personal tool, endpoint
// gone with the paid AI path. (Martin’s go on the audit suggestions.)

// ─────────────────────────────────────────────────────────────────
// IMPORT PAGE — recent-imports strip
// Renders a small banner at the top of the Import page showing the most
// recent import activity (Navblue iCal sync OR PDF/CSV import audit log,
// whichever is fresher). Gives the page visible state so it doesn't
// look identical before vs after an import.
// ─────────────────────────────────────────────────────────────────
function renderImportRecentStrip() {
  const strip = document.getElementById('importRecentStrip');
  if (!strip) return;
  const summaryEl = document.getElementById('importRecentSummary');
  const whenEl = document.getElementById('importRecentWhen');

  let bestTs = 0;
  let bestSummary = '';

  // Navblue iCal last sync timestamp
  try {
    const navTs = +localStorage.getItem('cumulo_navblue_last_sync') || 0;
    if (navTs > bestTs) {
      bestTs = navTs;
      bestSummary = t('undo.op.sync');
    }
  } catch {}

  // PDF / CSV audit log (last entry = most recent)
  try {
    const log = JSON.parse(localStorage.getItem('cumulo_import_log_v1') || '[]');
    if (Array.isArray(log) && log.length > 0) {
      const last = log[log.length - 1];
      const ts = last.timestamp ? new Date(last.timestamp).getTime() : 0;
      if (ts > bestTs) {
        bestTs = ts;
        const n = last.flightCount || last.imported || last.count || 0;
        const src = last.source || last.importType || t('import.recent.fileSrc');
        bestSummary = n > 0
          ? t('import.recent.fromSrc', { n, w: n !== 1 ? t('word.flights') : t('word.flight'), src })
          : t('undo.op.import', { source: src });
      }
    }
  } catch {}

  if (bestTs === 0) {
    strip.style.display = 'none';
    return;
  }

  if (summaryEl) summaryEl.textContent = bestSummary;
  if (whenEl) whenEl.textContent = '· ' + _importRelTime(bestTs);
  strip.style.display = 'flex';
}

// Relative-time helper for the import strip — bilingual.
function _importRelTime(ts) {
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1)    return fr ? "à l'instant" : 'just now';
  if (mins < 60)   return fr ? `il y a ${mins} min` : `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return fr ? `il y a ${hrs} h` : `${hrs} h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30)   return fr ? `il y a ${days} jour${days !== 1 ? 's' : ''}` : `${days} day${days !== 1 ? 's' : ''} ago`;
  return new Date(ts).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─────────────────────────────────────────────────────────────────
// MONTHLY PDF ROSTER — unified handler
// One drop zone, two code paths. The wrapper picks based on context:
//   - If the pilot has zero flights yet, OR no iCal URL configured →
//     treat as initial import → parseNavbluePDF()
//   - If there's at least one flight tagged as Navblue-iCal-sourced →
//     treat as crew-name backfill → handleRosterFile()
//   - Otherwise (mixed state — has flights but none from iCal): default
//     to crew-backfill (the more common case once a pilot has been using
//     the app for a while) but log so we can tune later.
//
// Why a wrapper instead of asking the pilot to pick: Martin found the
// old two-button layout confusing. The two intents live in the same
// PDF, so the app should figure out which one the pilot needs. The
// wrapper logs its decision to console so any wrong routing is debuggable.
// ─────────────────────────────────────────────────────────────────
function handleMonthlyRosterPDF(file) {
  if (!file) return;
  const hasFlights = Array.isArray(flights) && flights.length > 0;
  const hasICalSourced = hasFlights && flights.some(f =>
    Array.isArray(f.sources) && f.sources.includes('navblue-ics')
  );
  const hasICalUrl = (() => {
    try { return !!localStorage.getItem('cumulo_navblue_url'); }
    catch { return false; }
  })();

  // The paid AI extraction path (parseNavbluePDF + worker round trip) was
  // removed 2026-08-02 on Martin's go: the client-side parser reads the same
  // Porter PDF locally, backfills crew and OFFERS missing legs in the shared
  // preview (test/pdf-roster-add.mjs), fresh install included — and it costs
  // nothing and sends nothing anywhere.
  if (!hasFlights || !hasICalUrl) {
    console.log('[ImportRouter] Monthly PDF → client-side parse (fresh install)');
    handleRosterFile(file);
    return;
  }

  if (hasICalSourced) {
    console.log('[ImportRouter] Monthly PDF → crew-name backfill (handleRosterFile)');
    handleRosterFile(file);
    return;
  }

  // Pilot has flights but none from iCal — could be a CSV-imported user
  // adding a PDF. Default to backfill (most common in this state) but log
  // it so we can revisit if the heuristic is wrong.
  console.log('[ImportRouter] Monthly PDF → crew-name backfill (default for mixed state)');
  handleRosterFile(file);
}

// Photo-OCR import (handlePhotoImport) + its drag-drop helper (handleDrop)
// were removed 2026-06-24 (Martin's call). Paper-logbook hours now go
// through Brought-forward (Profile). PDF roster (parseNavbluePDF below) and
// CSV import remain. The shared preview UI (showImportPreview) is untouched.

// parseNavbluePDF (the paid AI extraction round trip) removed 2026-08-02 —
// handleRosterFile (10-pdf-roster.js) parses the same PDF locally.

function showImportPreview(list, subtitle, opts) {
  // Flag every entry that already exists in the logbook so we never silently
  // create a duplicate. Duplicates start UNSELECTED; genuinely new flights start
  // selected. This is the dedup gate for the PDF roster / photo / CSV imports
  // (the iCal sync path has its own gate). See findMatchingExistingFlight() and
  // feedback_never_duplicate_flights.
  // opts.selectNone: nothing is preselected. Used for legs the app has NOT
  // proven complete (today's roster legs with no actual arrival time), so
  // no entry can reach the logbook without a deliberate tick.
  const selectNone = !!(opts && opts.selectNone);
  pendingImport = list.map(f => {
    const dup = (typeof findMatchingExistingFlight === 'function') && !!findMatchingExistingFlight(f);
    // _unproven legs are never preticked, whatever else is in the list: the
    // app has no proof they are on the ground, so reaching the logbook has
    // to cost a deliberate tick. Proven and past-dated legs still arrive
    // ticked, so a mixed list behaves correctly row by row.
    return { ...f, selected: !dup && !selectNone && !f._unproven, _dup: dup };
  });
  const dupN = pendingImport.filter(f => f._dup).length;
  const newN = pendingImport.length - dupN;
  const sub = document.getElementById('importSubtitle');
  if (sub) {
    sub.textContent = dupN > 0
      ? t('import.preview.newVsDup', { newN, dupN })
      : (subtitle || t('import.preview.flightsFound', { n: list.length }));
  }
  renderImportPreview();
  const overlay = document.getElementById('importPreview');
  // Restore the Import action. showNavblueDiagnostic() borrows this same
  // modal and reassigns the button's onclick to its "Copy all" handler,
  // which otherwise sticks: the next import preview would copy JSON
  // instead of importing. Reassigning here makes the modal safe to share.
  const confirmBtn = document.getElementById('importConfirmBtn');
  if (confirmBtn) confirmBtn.onclick = () => confirmImport();
  overlay.classList.add('show');
  // Lock body scroll while modal is open
  document.body.style.overflow = 'hidden';
}

function renderImportPreview() {
  const container = document.getElementById('extractedList');
  if (!pendingImport.length) {
    container.innerHTML = `<p style="color:var(--text-muted);font-family:var(--font-mono);font-size:12px">${t('import.preview.noFlights')}</p>`;
    updateImportButton();
    return;
  }
  container.innerHTML = `
    <div class="import-bulk-bar">
      <span class="eyebrow" id="importCount">${t('import.preview.selectedCount', { selected: 0, total: 0 })}</span>
      <div style="display:flex; gap:8px;">
        <button type="button" class="btn btn-ghost btn-sm" onclick="toggleAllImport(true)">${t('import.preview.selectAll')}</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick="toggleAllImport(false)">${t('import.preview.deselectAll')}</button>
      </div>
    </div>
    ${pendingImport.map((f, i) => `
      <label class="review-item ${f.selected ? 'is-selected' : 'is-deselected'}" for="imp-${i}">
        <input type="checkbox" id="imp-${i}" class="review-check"
               ${f.selected ? 'checked' : ''}
               onchange="toggleImportItem(${i}, this.checked)">
        <div class="review-body">
          <div class="review-item-header">#${i+1} · ${esc(f.date)} · ${esc(f.flightNum || f.reg || '?')} · ${esc(f.route || '?')}${f._dup ? ` <span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:600;letter-spacing:.03em;background:var(--warning-soft,rgba(200,140,0,.12));color:var(--warning-text,#8a6d00);vertical-align:middle;">${esc(t('import.preview.dupBadge'))}</span>` : ''}${f._flownToday ? ` <span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:600;letter-spacing:.03em;background:${f._unproven ? 'var(--warning-soft,rgba(200,140,0,.12))' : 'var(--success-soft,rgba(0,140,90,.12))'};color:${f._unproven ? 'var(--warning-text,#8a6d00)' : 'var(--success-text,#0a6b47)'};vertical-align:middle;">${esc(t(f._unproven ? 'import.preview.todayCheckBadge' : 'import.preview.todayBadge'))}</span>` : ''}</div>
          <div class="review-fields">
            <div class="review-field"><span>${t('import.preview.fieldTotal')}</span> ${+f.total||0}h</div>
            <div class="review-field"><span>${t('import.preview.fieldBlock')}</span> ${+f.block || 0}h</div>
            <div class="review-field"><span>${t('import.preview.fieldPicDay')}</span> ${+f.meDayPic || 0}h</div>
            <div class="review-field"><span>${t('import.preview.fieldPicNight')}</span> ${+f.meNightPic || 0}h</div>
            ${(f.meDayCop || f.meNightCop) ? `<div class="review-field"><span>${t('import.preview.fieldSic')}</span> ${((+f.meDayCop||0)+(+f.meNightCop||0)).toFixed(2)}h</div>` : ''}
            <div class="review-field"><span>${t('import.preview.fieldLdg')}</span> ${(+f.ldgDay || 0) + (+f.ldgNight || 0)}</div>
            ${f.pic ? `<div class="review-field"><span>${t('import.preview.fieldPic')}</span> ${esc(f.pic)}</div>` : ''}
            ${f._needsDayNight ? `<div class="review-field" style="color:var(--warning)"><span>⚠︎</span> ${esc(t('import.preview.nightToConfirm'))}</div>` : ''}
            ${f._proof === 'actual-arrival' ? `<div class="review-field"><span>${t('import.preview.fieldProof')}</span> ${esc(t('import.preview.proofArrival'))}</div>` : ''}
            ${f._unproven ? `<div class="review-field" style="color:var(--warning)"><span>⚠︎</span> ${esc(t((f._signal === 'block-revised' || f._signal === 'block-changed') ? 'import.preview.unprovenChanged' : 'import.preview.unproven'))}</div>` : ''}
          </div>
        </div>
      </label>`).join('')}
  `;
  updateImportButton();
}

function toggleImportItem(idx, checked) {
  if (pendingImport[idx]) pendingImport[idx].selected = checked;
  // Toggle visual class on the label without full re-render (keeps scroll position)
  const el = document.querySelector(`label[for="imp-${idx}"]`);
  if (el) {
    el.classList.toggle('is-selected', checked);
    el.classList.toggle('is-deselected', !checked);
  }
  updateImportButton();
}

function toggleAllImport(checked) {
  pendingImport.forEach(f => f.selected = checked);
  renderImportPreview();
}

function updateImportButton() {
  const selected = pendingImport.filter(f => f.selected).length;
  const total = pendingImport.length;
  const counter = document.getElementById('importCount');
  if (counter) counter.textContent = t('import.preview.selectedCount', { selected, total });
  const btn = document.getElementById('importConfirmBtn');
  if (btn) {
    btn.textContent = selected > 0 ? t('import.preview.importBtn', { n: selected }) : t('import.preview.nothingToImport');
    btn.disabled = selected === 0;
  }
}

function confirmImport() {
  const toImport = pendingImport.filter(f => f.selected);
  if (toImport.length === 0) {
    showToast(t('toast.nothingSelected'), 'error');
    return;
  }
  // Snapshot so the whole import (new rows + any enrichment) is one undo step.
  if (typeof snapshotBeforeOperation === 'function') snapshotBeforeOperation('Import');
  if (typeof updateUndoButton === 'function') updateUndoButton();
  // PIPEDA model: store full names locally.
  // Anonymization happens at egress (cloud sync, shareable PDF), not at
  // import. The user retains the ability to see who they flew with in
  // their own logbook — personal-use exception under PIPEDA s.4(2)(b)
  // and Loi 25 art. 1.
  //
  // ALSO (2026-05-13 soir 5): resolve self-references. Paper logbooks
  // write "self" / "moi" / the pilot's own name in the PIC field when
  // the user was the captain — we translate that into crewPosition='PIC'
  // and clear the redundant self-reference. A real third-party name
  // remains untouched and crewPosition defaults to 'SIC'.
  const importProfile = DB.loadProfile();
  // Enrich an existing matched flight by filling only its blanks — shared
  // fillEmptyStrict + IMPORT_MERGE_FIELDS (mirrors the iCal sync gate).
  // Track the new flight IDs so we can offer quick crew-fill after save
  // for any of them that landed crewless (typical for iCal-only imports).
  const newIds = [];
  let imported = 0, skipped = 0, skippedTombstoned = 0;
  // Clicking Import IS accepting these rows. One instant for the whole batch so
  // every row the pilot accepted in this click carries the same stamp.
  const _acceptedAt = new Date().toISOString();
  toImport.forEach(f => {
    // Strip UI-only flags. Every one of them is underscore-prefixed by
    // convention (_dup, _needsDayNight, _flownToday, _proof), and no real
    // logbook field starts with an underscore, so strip the whole family
    // rather than naming them one by one: _needsDayNight used to survive
    // this line and get written into the saved flight.
    const flightData = {};
    for (const k of Object.keys(f)) {
      if (k === 'selected' || k.charAt(0) === '_') continue;
      flightData[k] = f[k];
    }
    // A flight the pilot deliberately DELETED must not come back through this
    // path. The iCal sync already consults the tombstones before building its
    // preview; the PDF and photo paths land here without that check, so a
    // deleted leg arrived PRESELECTED and one confirm resurrected it.
    // (Final audit 2026-08-02.) Manual re-entry through the form stays
    // possible on purpose — the tombstone only suppresses imports.
    if (typeof isTombstoned === 'function' && isTombstoned(flightData)) {
      skippedTombstoned++;
      return;
    }
    // Belt-and-suspenders dedup: even if the pilot manually re-checked a flight
    // that already exists, NEVER create a duplicate (a single duplicate makes a
    // certifiable logbook invalid). Enrich the existing row's empty fields and
    // skip the push instead. See feedback_never_duplicate_flights.
    const match = (typeof findMatchingExistingFlight === 'function')
      ? findMatchingExistingFlight(flightData) : null;
    if (match) {
      const e = flights[match.idx];
      const merged = { ...e };
      const changed = fillEmptyStrict(merged, flightData, IMPORT_MERGE_FIELDS);
      if (changed) {
        if (typeof stampFlightAccepted === 'function') stampFlightAccepted(merged, _acceptedAt, importProfile);
        flights[match.idx] = merged;
      }
      skipped++;
      return;
    }
    const resolved = (typeof resolveSelfReferences === 'function')
      ? resolveSelfReferences(flightData, importProfile)
      : flightData;
    const newId = (typeof newUUID === 'function') ? newUUID() : (Date.now().toString() + Math.random());
    const withId = { ...resolved, id: newId };
    // Auto-fill XC + Night before push. Without this, every flight
    // imported via the preview modal (iCal fresh, PDF roster, photo OCR,
    // CSV) shipped with empty XC fields. Audit 2026-05-29.
    const enriched = (typeof recalculateFlightDayNightXC === 'function')
      ? recalculateFlightDayNightXC(withId, { skipLandingFill: true })
      : withId;
    if (typeof stampFlightAccepted === 'function') stampFlightAccepted(enriched, _acceptedAt, importProfile);
    flights.push(enriched);
    newIds.push(newId);
    imported++;
  });
  DB.save(flights);
  pendingImport = [];
  closeImportOverlay();
  // The dashboard carries the "roster flights to review" card, which is
  // derived from `flights`. Importing from that card normally opens the
  // quick crew-fill next (iCal legs arrive crewless), which skips the
  // navigation to the logbook, so nothing re-rendered the dashboard and
  // the card kept counting legs he had just imported. Any path that
  // mutates `flights` re-renders it.
  if (typeof renderDashboard === 'function') renderDashboard();
  showToast(
    skipped > 0
      ? t('toast.importedWithDups', { count: imported, dups: skipped })
      : t(imported === 1 ? 'toast.flightsImportedCount' : 'toast.flightsImportedCountPl', { count: imported }),
    'success'
  );
  // A deliberately deleted flight held back here is NOT "already in your
  // logbook" — saying so was a falsehood the CSV path was fixed to avoid.
  if (skippedTombstoned > 0) {
    const frT = (typeof getLang === 'function') && getLang() === 'fr';
    showToast(frT
      ? skippedTombstoned + ' vol' + (skippedTombstoned === 1 ? '' : 's') + ' que vous aviez supprimé' + (skippedTombstoned === 1 ? '' : 's') + ' n’' + (skippedTombstoned === 1 ? 'a' : 'ont') + ' pas été réimporté' + (skippedTombstoned === 1 ? '' : 's') + '. Saisissez-le' + (skippedTombstoned === 1 ? '' : 's') + ' à la main pour le' + (skippedTombstoned === 1 ? '' : 's') + ' rétablir.'
      : skippedTombstoned + ' flight' + (skippedTombstoned === 1 ? '' : 's') + ' you had deleted ' + (skippedTombstoned === 1 ? 'was' : 'were') + ' not re-imported. Add ' + (skippedTombstoned === 1 ? 'it' : 'them') + ' by hand to restore.');
  }

  // Quick crew-fill — opens automatically if any of the new flights lack
  // crew names. Returns true if it opened the modal (which navigates the
  // user to the logbook page itself after save). Otherwise we navigate now.
  const opened = (typeof openQuickCrewFill === 'function') && openQuickCrewFill(newIds);
  if (!opened) showPage('logbook');
}

function cancelImport() {
  pendingImport = [];
  closeImportOverlay();
}

function closeImportOverlay() {
  const overlay = document.getElementById('importPreview');
  if (overlay) overlay.classList.remove('show');
  document.body.style.overflow = '';
}

// Close modals on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const importOverlay = document.getElementById('importPreview');
    if (importOverlay && importOverlay.classList.contains('show')) { cancelImport(); return; }
    const detailOverlay = document.getElementById('flightDetailOverlay');
    if (detailOverlay && detailOverlay.classList.contains('show')) closeFlightDetail();
  }
});

