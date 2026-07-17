// ─────────────────────────────────────────────────────────────────
// Cloudflare Turnstile — invisible bot gate for the paid AI import path.
// getTurnstileToken() renders the (invisible) widget once, then returns a FRESH
// token per call. Resolves to '' when Turnstile isn't configured (empty site
// key / library not loaded) — the worker treats a missing token as a no-op
// until TURNSTILE_SECRET is provisioned, so this is safe to ship inert.
// Spec: private/SPEC-ANTI-ABUS-2026-06-27.md (layer A).
// ─────────────────────────────────────────────────────────────────
const TURNSTILE_SITE_KEY = ''; // ← Martin: paste the Turnstile SITE key here to activate
let _tsWidgetId = null;
function getTurnstileToken() {
  return new Promise((resolve) => {
    if (!TURNSTILE_SITE_KEY || typeof window === 'undefined' || !window.turnstile) return resolve('');
    try {
      if (_tsWidgetId === null) {
        let host = document.getElementById('cf-turnstile-host');
        if (!host) {
          host = document.createElement('div');
          host.id = 'cf-turnstile-host';
          host.style.display = 'none';
          document.body.appendChild(host);
        }
        _tsWidgetId = window.turnstile.render(host, {
          sitekey: TURNSTILE_SITE_KEY, size: 'invisible',
          callback: () => {}, 'error-callback': () => {}
        });
      } else {
        window.turnstile.reset(_tsWidgetId);
      }
      window.turnstile.execute(_tsWidgetId).then(resolve).catch(() => resolve(''));
    } catch (_) { resolve(''); }
  });
}

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

  if (!hasFlights || !hasICalUrl) {
    // Fresh install or pilot hasn't set up iCal yet → initial import path.
    console.log('[ImportRouter] Monthly PDF → initial import (parseNavbluePDF)');
    const inputEl = document.getElementById('navbluePdf');
    if (inputEl) {
      const dt = new DataTransfer();
      dt.items.add(file);
      inputEl.files = dt.files;
      parseNavbluePDF(inputEl);
    }
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

async function parseNavbluePDF(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const box = document.getElementById('aiBox');
  const msg = document.getElementById('aiMsg');
  box.classList.add('show');
  msg.textContent = t('import.aiBox.reading');

  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  try {
    msg.textContent = t('import.aiBox.extracting');
    // Layer A (anti-abuse): attach a fresh Turnstile token. '' when Turnstile
    // isn't configured yet → the worker no-ops, so this changes nothing today.
    const turnstileToken = await getTurnstileToken();
    const resp = await fetch('https://logbook-api.martindaoust33.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8000,
        turnstileToken,
        // Note: the system prompt is pinned server-side in the worker
        // (data-extraction-API persona) — anything sent here is ignored.
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
            { type: 'text', text: `This is an airline crew roster (e.g. Navblue HrRosterReport) PDF. Extract ONLY the real flight legs the pilot operated as crew.

SKIP these — the pilot did NOT operate them:
- Activity codes (not flights): VAC, GD, SDO, REAX, HTL, PER, LM, BO, DH, DHD, RDG, PAX.
- Positioning: P##### (P followed by 5 digits).
- ANY leg the pilot DEADHEADS (rides as a passenger, does not operate) — even when it carries a normal revenue flight number (e.g. PD167, PD163). A deadhead is shown by a "D" deadhead designator in the leftmost activity/designator column of that row, AND/OR the pilot's crew function marked "(D)" in the crew list (e.g. "FO(D): Daoust, Martin"). If the pilot's own role on a leg is a deadhead, DO NOT extract it, whatever the flight number.

KEEP only revenue flights (airline-prefix + 2-4 digit number, e.g. PD###, AC###, WS###) that the pilot OPERATED — i.e. their crew function is FO or CA WITHOUT a "(D)" deadhead marker.

Output a JSON array. If nothing to extract, output [].
One object per leg with EXACTLY these fields:
{"date":"YYYY-MM-DD","flightNum":"PD150","type":"E195-E2","reg":"C-XXXX","pic":"Captain name or empty","copilot":"F/O name or empty","route":"YOW-YYZ","block":1.10,"duty":1.50,"atd_utc":"1230","sta_utc":"1345","ldg":1}

RULES:
- Only completed flights (date <= today).
- block = BLH column, HH:MM → decimal (e.g. 4:30 → 4.50).
- atd_utc = ACTUAL off-blocks time in UTC as 4-digit "HHMM" (e.g. "1230"). If the document shows ONLY a scheduled/planned time (not the actual), leave atd_utc as "" — never put a scheduled time in atd_utc. sta_utc = ACTUAL arrival UTC "HHMM" if shown, else "" (same rule — no scheduled times).
- route = departure-arrival as 3-letter IATA (e.g. "YOW-YYZ").
- ldg = number of landings ONLY if the document explicitly states it; otherwise omit the field entirely. Never assume or default to 1 (a multi-crew F/O does not land every leg).
- type: "E195-E2" for 295, "DH4" for Dash 8 Q400.
- DO NOT compute day vs night, PIC vs SIC, or cross-country — leave those out entirely. The app computes them from the real UTC times and the pilot's own profile (never assumed).` }
          ]
        }]
      })
    });

    const rawText = await resp.text();
    console.log('[Navblue] Worker HTTP status:', resp.status);
    console.log('[Navblue] Worker raw response (first 500 chars):', rawText.substring(0, 500));

    // Parse first so a normalized capacity / daily-cap signal is caught even on
    // a non-2xx status: the worker returns 503 + {error:{code:'capacity'}} when
    // Anthropic is rate-limited / overloaded / at the spend cap. Detect it
    // BEFORE the generic !resp.ok throw so the pilot gets a graceful fallback
    // (their hours aren't lost) instead of a raw "extraction failed".
    let data = null;
    try { data = JSON.parse(rawText); } catch (e) { /* non-JSON handled below */ }

    if (data && data.error && (data.error.code === 'capacity' || data.error.code === 'daily_cap')) {
      box.classList.remove('show');
      showImportFallback(data.error.code);
      return;
    }

    if (!resp.ok) {
      throw new Error(`Worker error ${resp.status}: ${rawText.substring(0, 200)}`);
    }
    if (!data) {
      throw new Error('Worker did not return JSON. Response: ' + rawText.substring(0, 200));
    }

    // Anthropic API error inside the worker response?
    if (data.error) {
      throw new Error(`Anthropic API error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const text = data.content?.map(c => c.text || '').join('') || '';
    console.log('[Navblue] AI response text (first 800 chars):', text.substring(0, 800));

    if (!text.trim()) {
      throw new Error('AI returned empty response. Check worker logs / API key.');
    }

    // Strip markdown fences if present
    const clean = text.replace(/```(?:json)?/gi, '').trim();

    // Find a JSON array — prefer the largest [...] block (handles nested objects)
    let match = clean.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!match) match = clean.match(/\[\s*\]/);  // empty array fallback
    if (!match) {
      // The AI replied with text instead of JSON — surface what it said
      throw new Error(`AI did not return JSON. It said: "${clean.substring(0, 250)}"`);
    }

    let extracted;
    try { extracted = JSON.parse(match[0]); } catch(e) {
      throw new Error('Malformed JSON from AI: ' + match[0].substring(0, 200));
    }

    if (!Array.isArray(extracted) || extracted.length === 0) {
      box.classList.remove('show');
      showToast(t('import.ai.noFlights'), 'error');
      return;
    }

    // Local civil date — the UTC date (toISOString) reads tomorrow in the
    // evening, which would let today's in-progress flight slip through.
    const today = localTodayStr();
    // Strict: only flights from BEFORE today (today's flight may still be in progress)
    const filtered = extracted.filter(f => f.date && f.date < today && f.block > 0);
    console.log(`[Navblue] Extracted ${extracted.length} entries, ${filtered.length} after filtering completed flights (date < today, block > 0).`);

    if (filtered.length === 0) {
      box.classList.remove('show');
      showToast(t('import.ai.noFlights'), 'error');
      return;
    }

    // Compute the REAL day/night/XC split + role attribution from the actual
    // UTC times and the pilot's profile — never fabricated from the landing.
    // Legs the app can't anchor (unknown airport / no usable time) are left
    // empty and flagged so the preview shows "night to confirm" instead of
    // silently logging 0. (Audit panel 2026-06-25 must-fix #3 + #5.)
    const processed = filtered.map(f => {
      const flight = { ...f };
      if (!(+flight.total) && +flight.block) flight.total = +flight.block;
      if (flight.atd_utc != null && flight.atd_utc !== '') {
        flight.atd_utc = String(flight.atd_utc).replace(/\D/g, '').padStart(4, '0').slice(0, 4);
      }
      const out = (typeof recalculateFlightDayNightXC === 'function')
        ? recalculateFlightDayNightXC(flight, { skipLandingFill: true }) : flight;
      const attributed = (typeof nightHoursOf === 'function')
        && (nightHoursOf(out) > 0 || dayHoursOf(out) > 0);
      if (!attributed && (+out.block > 0)) out._needsDayNight = true;
      return out;
    });

    box.classList.remove('show');
    showImportPreview(processed, t('import.preview.subtitle', { n: processed.length }));
  } catch(e) {
    box.classList.remove('show');
    showToast(t('import.ai.failed'), 'error');
    console.error('[Roster] Error:', e);
  }
}

function showImportPreview(list, subtitle) {
  // Flag every entry that already exists in the logbook so we never silently
  // create a duplicate. Duplicates start UNSELECTED; genuinely new flights start
  // selected. This is the dedup gate for the PDF roster / photo / CSV imports
  // (the iCal sync path has its own gate). See findMatchingExistingFlight() and
  // feedback_never_duplicate_flights.
  pendingImport = list.map(f => {
    const dup = (typeof findMatchingExistingFlight === 'function') && !!findMatchingExistingFlight(f);
    return { ...f, selected: !dup, _dup: dup };
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
          <div class="review-item-header">#${i+1} · ${esc(f.date)} · ${esc(f.flightNum || f.reg || '?')} · ${esc(f.route || '?')}${f._dup ? ` <span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:600;letter-spacing:.03em;background:var(--warning-soft,rgba(200,140,0,.12));color:var(--warning-text,#8a6d00);vertical-align:middle;">${esc(t('import.preview.dupBadge'))}</span>` : ''}</div>
          <div class="review-fields">
            <div class="review-field"><span>${t('import.preview.fieldTotal')}</span> ${+f.total||0}h</div>
            <div class="review-field"><span>${t('import.preview.fieldBlock')}</span> ${+f.block || 0}h</div>
            <div class="review-field"><span>${t('import.preview.fieldPicDay')}</span> ${+f.meDayPic || 0}h</div>
            <div class="review-field"><span>${t('import.preview.fieldPicNight')}</span> ${+f.meNightPic || 0}h</div>
            ${(f.meDayCop || f.meNightCop) ? `<div class="review-field"><span>${t('import.preview.fieldSic')}</span> ${((+f.meDayCop||0)+(+f.meNightCop||0)).toFixed(2)}h</div>` : ''}
            <div class="review-field"><span>${t('import.preview.fieldLdg')}</span> ${(+f.ldgDay || 0) + (+f.ldgNight || 0)}</div>
            ${f.pic ? `<div class="review-field"><span>${t('import.preview.fieldPic')}</span> ${esc(f.pic)}</div>` : ''}
            ${f._needsDayNight ? `<div class="review-field" style="color:var(--warning)"><span>⚠︎</span> ${esc(t('import.preview.nightToConfirm'))}</div>` : ''}
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
  let imported = 0, skipped = 0;
  toImport.forEach(f => {
    const { selected, _dup, ...flightData } = f;  // strip UI-only flags
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
      if (changed) flights[match.idx] = merged;
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
    flights.push(enriched);
    newIds.push(newId);
    imported++;
  });
  DB.save(flights);
  pendingImport = [];
  closeImportOverlay();
  showToast(
    skipped > 0
      ? t('toast.importedWithDups', { count: imported, dups: skipped })
      : t(imported === 1 ? 'toast.flightsImportedCount' : 'toast.flightsImportedCountPl', { count: imported }),
    'success'
  );

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

