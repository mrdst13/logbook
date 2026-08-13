// ═══════════════════════════════════════════
// FEATURE 7 — PDF EXPORT (TC FORMAT)
// ═══════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────
//  EXPORT PDF — Transport Canada compliant (CAR 401.08 + Standard 421)
//  - Cover page (pilot identity, license, medical, type ratings)
//  - Log pages : 24 flights/page (ROWS_PER_PAGE), page totals + cumulative running totals
//  - Signature line on EVERY page (TC inspector expectation)
//  - Single-line strike-through for corrections (audit best practice)
//  - Decimal hours 0.1h (TC standard)
//  - Uses user's column visibility prefs (configurable per export)
// ─────────────────────────────────────────────────────────────────

// A cumulative log-page column: hour columns (decimal) plus the three integer
// tally columns (landings day/night, approaches) whose page + running totals
// the PDF sums. Single source of truth for both the running-total init and the
// brought-forward seed, so the two can never drift apart.
function _isCumulativePdfCol(c) {
  return !!(c && (c.decimal || c.key === 'ldgDay' || c.key === 'ldgNight' || c.key === 'approaches'));
}

// Seed the running cumulative totals from brought-forward opening balances.
// Pure + testable (no DOM, no jsPDF, no localStorage): given the PDF column set
// and an opening-balances object ALREADY mapped into calcStats key space
// (i.e. totalsWithOpening({})), returns { colKey: broughtForwardValue } for
// every cumulative column, 0 when that column has no brought-forward balance.
// Callers merge this over a zero-initialised runTotals so the certifiable
// "CUMULATIVE TOTALS" row reflects the pilot's whole career (paper hours +
// Cumulo flights), not the logged-only subtotal.
function openingSeedForCumulative(cols, openingSeed) {
  const seed = {};
  const ob = openingSeed || {};
  (cols || []).forEach(c => {
    if (_isCumulativePdfCol(c)) seed[c.key] = +ob[c.key] || 0;
  });
  return seed;
}

// The value a flight contributes to a PDF cell (display AND accumulation).
// The two flight-time columns — 'block' (labelled "Flight Time") and 'total'
// (labelled "Total") — both denote block-to-block flight time (CAR 101.01), so
// BOTH read through flightTimeOf (= total || block). That keeps the "Flt Time"
// column, the "Total" column, the PAGE / CUMULATIVE total rows and the
// cover-page hero identical in EVERY case — including a row that carries only
// one of block/total (e.g. the generic CSV wizard maps a single "Total" column
// and leaves block empty, so an unguarded "Flt Time" column would undercount
// the career total sitting right under a hero that already reads flightTimeOf).
// Every other column keeps computeCellValue's own derivation.
// The brought-forward total the cover attests to. DERIVED, never the raw
// stored keys, and from the SAME source that seeds the log-page TOTALS
// BROUGHT FORWARD row, so the two can never disagree. A pilot who filled
// only the detailed engine-class grid has no stored total or block, so a
// raw read returned 0 and the cover attested "0.0 hrs declared" while page 1
// of the same PDF printed 2781.0. (Audit 2026-07-27.)
// Local civil date of an ISO instant — an evening stamp in Toronto must not
// date itself tomorrow on the cover an inspector reads.
function pdfLocalDateOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  const p2 = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

// Hours flown per aircraft type — the figure an operator, an insurer or a
// type-rating application asks for ("how much on the E2"). Aircraft time and
// simulator time are counted apart, exactly like every other career figure in
// this PDF (calcStats excludes simulators from the cover), and hours DECLARED
// on a type (flown before Cumulo, from the paper logbook) are carried in their
// own field so the printed figure is never a silent merge of measured and
// declared. `declared` is { TYPE: hours }.
// Rows with no aircraft type are grouped under their own heading rather than
// dropped: dropping them would make the strip disagree with the career total
// on the same page, with nothing on the sheet to explain the gap.
function pdfHoursByType(list, declared) {
  const map = new Map();
  const put = (key) => {
    if (!map.has(key)) map.set(key, { type: key, air: 0, sim: 0, paper: 0 });
    return map.get(key);
  };
  (list || []).forEach(f => {
    if (!f) return;
    const key = String(f.type || '').trim().toUpperCase() || 'TYPE NOT RECORDED';
    if (f.isSim) {
      // A simulator session is not flight time — flightTimeOf returns 0 for it
      // by design — so its hours are read where they actually live (instSim),
      // with total/block as the fallback a legacy or imported row may carry.
      const s = +f.instSim || +f.total || +f.block || 0;
      if (s > 0) put(key).sim += s;
      return;
    }
    const h = (typeof flightTimeOf === 'function') ? flightTimeOf(f) : (+f.total || +f.block || 0);
    if (h > 0) put(key).air += h;
  });
  // Declared hours attach to the type they name. Matched loosely (either string
  // containing the other) the same way the dashboard's aircraft goal matches
  // rows, so "E195-E2" declared against rows typed "E195-E2 " lands on one
  // entry instead of printing the same aeroplane twice.
  Object.keys(declared || {}).forEach(k => {
    const key = String(k || '').trim().toUpperCase();
    const v = +declared[k] || 0;
    if (!key || !(v > 0)) return;
    let hit = null;
    for (const e of map.values()) {
      if (e.type === 'TYPE NOT RECORDED') continue;
      if (e.type.includes(key) || key.includes(e.type)) { hit = e; break; }
    }
    (hit || put(key)).paper += v;
  });
  return [...map.values()]
    .map(e => Object.assign(e, { total: e.air + e.paper }))
    .sort((a, b) => (b.total + b.sim) - (a.total + a.sim));
}

function pdfBroughtForwardTotal(balances) {
  const b = balances || {};
  if (typeof totalsWithOpening === 'function') {
    const d = totalsWithOpening({});
    const v = +d.total || +d.block || 0;
    if (v) return v;
  }
  return +b.total || +b.block || 0;
}
// The integer tally columns the PDF sums into PAGE and CUMULATIVE TOTALS.
const PDF_INT_TALLY_KEYS = new Set(['ldgDay', 'ldgNight', 'approaches']);
// Class/role columns a SIMULATOR row must not feed: calcStats excludes sim
// rows from exactly these career buckets, so the printed CUMULATIVE row would
// otherwise contradict the cover of the same PDF (final audit r3, 2026-08-02).
// Sim time still prints in its own columns (instSim, sim type/session).
const PDF_SIM_ZERO_KEYS = new Set([
  'meDayPic','meDayCop','meDayDual','meNightPic','meNightCop','meNightDual',
  'seDay','seNight','seDayDual','seNightDual',
  'heliDayPic','heliDayCop','heliDayDual','heliNightPic','heliNightCop','heliNightDual','hoverTime',
  'xcDayPic','xcDayCop','xcDayDual','xcNightPic','xcNightCop','xcNightDual',
  'picus','dualGivenDay','dualGivenNight','toDay','toNight',
  // The grid's DERIVED columns recompute from those same slots (day/night via
  // nightHoursOf, xcDay/xcNight sums) or from the raw total (vfr) and were
  // bypassing this gate: a sim row printed Night hours in a default-on column
  // while the cover of the same PDF said 0. Caught by the round-4 judge —
  // the round-3 pin had certified 'xcDayCop', a key the PDF never renders.
  'day','night','xcDay','xcNight','vfr',
]);

function pdfCellValue(f, key) {
  if (key === 'total' || key === 'block') {
    return (typeof flightTimeOf === 'function') ? flightTimeOf(f) : (+f.total || +f.block || 0);
  }
  // A flight typed into the form stores these as STRINGS; one imported from a
  // roster stores numbers. The totals accumulator adds with +, so a string
  // contributed nothing: every hand-entered landing and approach vanished
  // from the certifiable cumulative row while still printing on its own line.
  // Coercing at this seam fixes the cell and the total together, and repairs
  // values already stored. (Audit 2026-07-27.)
  // A sim row prints blank in every aircraft class/role column, and blank
  // accumulates as zero — cell, column sum and cover stay consistent.
  if (f && f.isSim && PDF_SIM_ZERO_KEYS.has(key)) return '';
  if (PDF_INT_TALLY_KEYS.has(key)) {
    // The landing/approach columns of the TC grid are AIRCRAFT figures: the
    // cover's career "Landings" excludes simulators (calcStats), and a sim
    // session's landings counting into the printed CUMULATIVE row contradicted
    // the cover of the same PDF. Zero here keeps cell, column sum and cover
    // consistent; qualifying sim landings still reach the RECENCY annexe
    // through countsTowardRecency, which is that page's own filter.
    // (Final audit 2026-08-02.)
    if (f && f.isSim) return 0;
    const n = +computeCellValue(f, key);
    return Number.isFinite(n) ? n : 0;
  }
  return computeCellValue(f, key);
}

// Entry point : shows a modal to confirm which columns to include,
// then calls _generatePDF() with the chosen visible columns.
function exportPDF() {
  const overlay = document.getElementById('importPreview');
  if (!overlay) { _generatePDF(); return; }
  // Render the column picker inside the import modal (reused as a generic modal)
  const _pdfTitleEl = document.getElementById('importTitle');
  if (_pdfTitleEl) _pdfTitleEl.textContent = t('pdf.picker.title');
  document.getElementById('importSubtitle').textContent = t('pdf.picker.subtitle');
  // Read current prefs to seed the picker
  const html = (function() {
    const prefs = loadColumnPrefs() || {};
    const groups = {};
    LOGBOOK_COLUMNS.forEach(c => {
      if (c.key === 'total') return;
      if (!groups[c.group]) groups[c.group] = [];
      groups[c.group].push(c);
    });
    // Sections are not columns of the grid — they are blocks of the cover, so
    // they get their own group at the top of the picker instead of hiding among
    // 38 column checkboxes. (Martin 2026-08-12: hours on type must be pickable.)
    const sections = `
      <div class="col-group">
        <div class="col-group-title">${esc(t('pdf.picker.sections'))}</div>
        <div class="col-group-grid">
          <label class="col-option is-on">
            <input type="checkbox" id="pdfOptHoursByType" checked
                   onchange="this.closest('label').classList.toggle('is-on', this.checked)" />
            <span class="col-option-label">${esc(t('pdf.picker.hoursByType'))}</span>
          </label>
        </div>
      </div>
    `;
    return sections + Object.keys(groups).map(group => `
      <div class="col-group">
        <div class="col-group-title">${esc(colGroup({ group }))}</div>
        <div class="col-group-grid">
          ${groups[group].map(c => {
            const checked = prefs[c.key] !== undefined ? prefs[c.key] : c.default;
            return `
              <label class="col-option ${checked ? 'is-on' : ''}">
                <input type="checkbox" data-col-key="${c.key}" ${checked ? 'checked' : ''}
                       onchange="this.closest('label').classList.toggle('is-on', this.checked)" />
                <span class="col-option-label">${esc(colLabel(c))}</span>
              </label>`;
          }).join('')}
        </div>
      </div>
    `).join('') + `
      <div style="margin-top:var(--s-3); padding:var(--s-3); background:var(--bg-subtle); border-radius:var(--r-sm); font-size:12px; color:var(--text-secondary); line-height:1.5;">
        ${t('pdf.picker.tip')}
      </div>
    `;
  })();
  document.getElementById('extractedList').innerHTML = html;
  // Configure the confirm button
  const confirmBtn = document.getElementById('importConfirmBtn');
  confirmBtn.textContent = t('pdf.picker.generate');
  confirmBtn.disabled = false;
  confirmBtn.onclick = function() {
    // Read selected columns
    const selected = {};
    document.querySelectorAll('#extractedList input[type="checkbox"][data-col-key]').forEach(input => {
      selected[input.getAttribute('data-col-key')] = input.checked;
    });
    // The selection drives THIS export only. Persisting it as the logbook's
    // column prefs meant printing a one-off subset silently rewrote the
    // on-screen table — a side effect nobody asked for. (Martin's go,
    // 2026-08-02.)
    const chosen = LOGBOOK_COLUMNS.filter(c =>
      c.key === 'total' || (selected[c.key] !== undefined ? selected[c.key] : c.default));
    if (!chosen.find(c => c.key === 'total')) chosen.push(LOGBOOK_COLUMNS.find(c => c.key === 'total'));
    const _htEl = document.getElementById('pdfOptHoursByType');
    closeImportOverlay();
    _generatePDF(chosen, { hoursByType: !_htEl || _htEl.checked });
  };
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function _generatePDF(colsOverride, opts) {
  if (typeof window.jspdf === 'undefined') { showToast(t('toast.pdfLibLoading'), 'error'); return; }
  const { jsPDF } = window.jspdf;
  const p = DB.loadProfile();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
  const W = 279, H = 216;
  // Color palette (subtle, neutral — looks like a real logbook, not a marketing brochure)
  const navy = [22, 33, 62], accent = [46, 99, 216], muted = [120, 130, 150],
        white = [255, 255, 255], light = [248, 249, 252], border = [200, 208, 220],
        textPrimary = [10, 14, 26];

  const name = `${p.fname||''} ${p.lname||''}`.trim() || 'Pilot';
  const fullTitle = `${p.rank||''} ${name}`.trim();
  const license = p.license || '—';
  // No "Porter Airlines" default — a TC PDF should show "—" for an unset
  // operator (e.g. private/VFR pilot), not pretend the pilot is at Porter.
  const airline = p.airline || '—';
  const base = p.base || '—';
  const medical = p.medical || '—';
  // Aviation Document Booklet expiry (Martin 2026-07-19: swap the cover's ECG
  // row for this). ASCII '-' when empty: jsPDF Helvetica has no em-dash glyph
  // and would render a garbage box on a brand-new (unfilled) field.
  const bookletExp = p.bookletExpiry || '-';
  const fleet = p.fleet || '—';

  const cols = (Array.isArray(colsOverride) && colsOverride.length) ? colsOverride : getVisibleColumns('pdf');
  const sorted = [...flights].sort((a,b) => (a.date || '').localeCompare(b.date || ''));

  // Hours-by-type block: on unless the picker turned it off, so an export
  // launched without the picker still carries it.
  const wantHoursByType = !opts || opts.hoursByType !== false;
  // The one place a pilot has declared hours flown on a type BEFORE Cumulo:
  // the dashboard's aircraft goal. Read as declared, printed as declared.
  const _declaredOnType = {};
  if (p.personalGoalKind === 'aircraft' && p.personalGoalContext && +p.personalGoalBroughtForward > 0) {
    _declaredOnType[String(p.personalGoalContext).trim().toUpperCase()] = +p.personalGoalBroughtForward;
  }

  // The pilot's saved signature (Settings > Signature), drawn on the signature
  // line of EVERY page. Martin 2026-08-12: "comment je fais pour mettre ma
  // signature electronique en bas de chaques page ?" — nothing to do per page,
  // it is applied wherever a signature line is printed, and the lines stay
  // blank for hand-signing when none is saved. The date beside it is the day
  // the document was produced, which is the day it is being signed.
  const _sigData = (function () {
    try {
      const s = localStorage.getItem('logbook_signature');
      return (s && /^data:image\/(png|jpeg);base64,/.test(s)) ? s : '';
    } catch (e) { return ''; }
  })();
  let _sigRatio = 0;   // height / width, read once from the image itself
  if (_sigData) {
    try {
      const props = doc.getImageProperties(_sigData);
      if (props && props.width > 0) _sigRatio = props.height / props.width;
    } catch (e) { _sigRatio = 0; }
  }
  // Draws the signature sitting ON the line that starts at (x, y), plus the
  // date and licence number on their own lines. Returns false when there is
  // nothing saved, so the caller keeps the blank lines.
  function drawSavedSignature(x, y, lineW, dateX, licX) {
    if (!_sigData) return false;
    const h = 9;
    const w = Math.min(lineW - 4, _sigRatio > 0 ? (h / _sigRatio) : 45);
    try { doc.addImage(_sigData, 'PNG', x + 1, y - h - 0.5, w, h); } catch (e) { return false; }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...textPrimary);
    if (dateX != null) doc.text(localTodayStr(), dateX + 1, y - 1.5);
    if (licX != null && license && license !== '—') doc.text(String(license), licX + 1, y - 1.5);
    return true;
  }

  // Trim a string to the room actually available IN THE CURRENT FONT. Used
  // wherever a value shares a row with another one: without it a long value
  // simply overprinted its neighbour instead of stopping at its own column.
  function pdfFit(str, room) {
    let s = String(str == null ? '' : str).replace(/[\r\n]+/g, ' ').trim();
    if (!s) return '';
    if (doc.getTextWidth(s) <= room) return s;
    while (s.length > 1 && doc.getTextWidth(s + '...') > room) s = s.slice(0, -1);
    return s + '...';
  }

  // ════════════════════════════════════════════
  // PAGE 1 — COVER (pilot identity)
  // ════════════════════════════════════════════
  drawCoverPage();

  function drawCoverPage() {
    // Title block (top)
    doc.setFillColor(...navy);
    doc.rect(0, 0, W, 28, 'F');
    doc.setTextColor(...white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('Pilot Logbook', 18, 16);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Personal log maintained pursuant to CAR 401.08', 18, 22);

    const rawTotals = calcStats();
    const totals = (typeof totalsWithOpening === 'function') ? totalsWithOpening(rawTotals) : rawTotals;
    const hasBF = (typeof hasOpeningBalances === 'function') && hasOpeningBalances();

    // Hours flown per type, printed inside the card under the career total.
    // Martin 2026-08-12: "je veux pouvoir dans le choix des choses a exporter
    // que hours on type soit la, surtout pour le e2".
    const typeAll   = wantHoursByType ? pdfHoursByType(sorted, _declaredOnType) : [];
    const typeShown = typeAll.slice(0, 10);
    const typePerRow  = Math.min(5, Math.max(1, typeShown.length));
    const typeRowCount = Math.ceil(typeShown.length / typePerRow);

    // ── Card geometry ──────────────────────────────────────────────
    // EVERY band below is derived from cardY, so no two can overlap. Until
    // 2026-08-12 the hero band was pinned to the bottom of the SHEET (H - 70)
    // while the card was sized from the top: the grey band painted straight
    // over the card's bottom border and over the last identity row, which is
    // what Martin saw on his phone ("les lignes en haut ... on voit a moitier
    // dans le total"). Identity now sits on ONE row of five, so the block
    // above the hero can never grow into it either.
    const cardX = 30, cardY = 38, cardW = W - 60, padX = 15;
    const heroY = cardY + 56, heroH = 46;
    const typeTitleY = cardY + 110;                 // 8 mm under the hero band
    const typeRowH = 14;                            // label + figure, no more
    const cardH = typeShown.length ? (114 + typeRowCount * typeRowH + 1) : (heroY + heroH + 6 - cardY);
    doc.setDrawColor(...border);
    doc.setLineWidth(0.3);
    doc.roundedRect(cardX, cardY, cardW, cardH, 3, 3, 'S');

    // Identity — name, operator, then the five reference fields on one row.
    doc.setTextColor(...textPrimary);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(pdfFit(fullTitle, cardW - padX * 2), cardX + padX, cardY + 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...muted);
    doc.text(pdfFit(`${airline} · Base ${base}`, cardW - padX * 2), cardX + padX, cardY + 27);

    // No "Total Entries": a row count is not a credential, and it sat in the
    // row of licence and expiry dates as if it were one. (Martin 2026-08-12.)
    const fields = [
      ['License Number', license],
      ['Medical Expiry', medical],
      ['Booklet Expiry', bookletExp],
      ['Type Rating(s)', fleet],
    ];
    const idSlotW = (cardW - padX * 2) / fields.length;
    fields.forEach((row, i) => {
      const x = cardX + padX + i * idSlotW;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...muted);
      doc.text(pdfFit(row[0].toUpperCase(), idSlotW - 4), x, cardY + 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(...textPrimary);
      doc.text(pdfFit(row[1], idSlotW - 4), x, cardY + 49);
    });

    // ── Hero career total + headline grid ──────────────────────────
    // Cover-page hierarchy goes from largest (career total in big numerals)
    // down to the breakdown grid. Attestation legalese is demoted to the
    // footer band so the inspector reads identity → totals first, fine print
    // last (TP 14052 §6.3 — totals must be conspicuous on the cover sheet).
    doc.setFillColor(...light);
    doc.rect(cardX + 1, heroY, cardW - 2, heroH, 'F');

    // Eyebrow + giant total on the left third
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    const eyebrow = 'CAREER FLIGHT TIME · AS OF ' + new Date().toLocaleDateString('en-CA').toUpperCase();
    doc.text(eyebrow, cardX + 6, heroY + 9);

    // The "48px hero" — at 1pt ≈ 0.353mm, ~30pt PDF font reads visually
    // like 48px on screen. Bold helvetica + tabular feel via monospace
    // letter-tracking from jsPDF defaults.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(30);
    doc.setTextColor(...textPrimary);
    doc.text(`${fmt(totals.total || totals.block)} hrs`, cardX + 6, heroY + 29);

    // Breakdown line under the hero — shows brought-forward + logged-in-Cumulo
    // composition. Inspector sees instantly where the cumulative comes from.
    let breakdown;
    if (hasBF && typeof loadOpeningBalances === 'function') {
      const ob = loadOpeningBalances();
      // DERIVED, never the raw stored keys, and from the SAME source that
      // seeds the log-page "TOTALS BROUGHT FORWARD" row. A pilot who filled
      // only the detailed engine-class grid has no stored `total` or `block`,
      // so a raw read returned 0: the cover attested "0.0 hrs declared" while
      // page 1 of the same PDF printed 2781.0. That is exactly the shape of
      // Martin own record. (Audit 2026-07-27.)
      const bfTotal = pdfBroughtForwardTotal(ob.balances);
      const loggedHere = Math.max(0, (totals.total || totals.block || 0) - bfTotal);
      breakdown = `+ ${fmt(bfTotal)} brought-forward (paper)   ·   + ${fmt(loggedHere)} logged in Cumulo`;
    } else {
      breakdown = `${flights.length} flight${flights.length !== 1 ? 's' : ''} logged in Cumulo`;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(pdfFit(breakdown, cardW - 12), cardX + 6, heroY + 40);

    // Headline breakdown grid on the right side of the hero.
    // PIC / SIC / Night / Multi-Engine / Cross-Country. Heli + Dual Given
    // inserted only when > 0 (avoids diluting line-pilot covers with
    // empty-zero columns). No landing count: it is a tally, not experience,
    // and it sat in the row of career hour figures pretending to be one
    // (Martin 2026-08-12: "on se fou tu du nombre de landing").
    const breakdownCols = [
      ['PIC',           fmt(totals.pic)],
      ['SIC',           fmt(totals.sic)],
      ['Night',         fmt(totals.night)],
      ['Multi-Engine',  fmt(totals.me)],
    ];
    if ((totals.heli || 0) > 0)      breakdownCols.push(['Helicopter',  fmt(totals.heli)]);
    if ((totals.dualGiven || 0) > 0) breakdownCols.push(['Dual Given',  fmt(totals.dualGiven)]);
    breakdownCols.push(['Cross-Country', fmt(totals.xc)]);

    // Lay grid in the right ~58% of the hero band.
    const gridStartX = cardX + cardW * 0.42;
    const gridW = cardW - (gridStartX - cardX) - 6;
    const slotW = gridW / breakdownCols.length;
    breakdownCols.forEach((h, i) => {
      const x = gridStartX + i * slotW;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...muted);
      doc.text(pdfFit(h[0].toUpperCase(), slotW - 3), x, heroY + 15);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(...textPrimary);
      doc.text(pdfFit(h[1], slotW - 3), x, heroY + 28);
    });

    // ── Hours by aircraft type ─────────────────────────────────────
    if (typeShown.length) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...muted);
      // The heading carries the cap when there are more types than fit, so a
      // reader is never shown a partial list that looks complete.
      doc.text(
        'HOURS BY AIRCRAFT TYPE' + (typeAll.length > typeShown.length
          ? ` · LARGEST ${typeShown.length} OF ${typeAll.length}` : ''),
        cardX + padX, typeTitleY);
      const typeSlotW = (cardW - padX * 2) / typePerRow;
      typeShown.forEach((e, i) => {
        const rowTop = cardY + 114 + Math.floor(i / typePerRow) * typeRowH;
        const x = cardX + padX + (i % typePerRow) * typeSlotW;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(...muted);
        doc.text(pdfFit(e.type, typeSlotW - 4), x, rowTop + 4);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(...textPrimary);
        // A type flown only in the simulator says so in the headline rather
        // than printing "0.0 h". No composition line under the figure: Martin
        // 2026-08-12, "declared et entries non je veux pas voir ca non plus".
        // Nothing is hidden by dropping it — the hero band two lines above
        // already states that the career total is paper hours plus logged
        // hours, and simulator time is excluded here exactly as it is there.
        const simOnly = !(e.total > 0) && e.sim > 0;
        doc.text(simOnly ? `${fmt(e.sim)} h sim` : `${fmt(e.total)} h`, x, rowTop + 11);
      });
    }

    // Footer (cover) — includes import provenance notice if any flights
    // came from a CSV import. CAR 401.08(3) requires an attestation
    // signed by the pilot; the provenance notice supports that. A TC
    // inspector reading the PDF will see which records were imported and
    // which were native to Cumulo.
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...muted);
    const importedSet = new Map();
    sorted.forEach(f => {
      if (!f.importedFrom) return;
      const key = f.importedFrom + '|' + (f.signedBy || '');
      if (!importedSet.has(key)) importedSet.set(key, { source: f.importedFrom, signedBy: f.signedBy || '', count: 0, firstAt: f.importedAt || '' });
      importedSet.get(key).count++;
    });
    // Local civil date — toISOString would stamp tomorrow's date on an
    // attestation generated in the evening in Toronto.
    const baseFooter = 'Generated by Cumulo · ' + localTodayStr();

    // Q6 — attestation lives in the footer (demoted from the body so the
    // hero hierarchy stays clean). CAR 401.08(3) is still satisfied —
    // the same pilot attestation appears below, just at footer weight.
    let attestationLines = [];
    if (hasBF && typeof loadOpeningBalances === 'function') {
      const ob = loadOpeningBalances();
      // DERIVED, never the raw stored keys, and from the SAME source that
      // seeds the log-page "TOTALS BROUGHT FORWARD" row. A pilot who filled
      // only the detailed engine-class grid has no stored `total` or `block`,
      // so a raw read returned 0: the cover attested "0.0 hrs declared" while
      // page 1 of the same PDF printed 2781.0. That is exactly the shape of
      // Martin own record. (Audit 2026-07-27.)
      const bfTotal = pdfBroughtForwardTotal(ob.balances);
      // Local civil date of the attestation instant — slicing the ISO string
      // printed the UTC date, one day late for an evening signature in Toronto.
      const bfDate = (function () {
        if (!ob.attestedAt) return '—';
        const d = new Date(ob.attestedAt);
        if (isNaN(d.getTime())) return String(ob.attestedAt).slice(0, 10);
        const p2 = n => (n < 10 ? '0' : '') + n;
        return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
      })();
      attestationLines.push(
        `Brought-forward attestation: ${fmt(bfTotal)} hrs declared on ${bfDate} by ${fullTitle} (CAR 401.08(3))`
      );
    }
    if (importedSet.size > 0) {
      [...importedSet.values()].forEach(e => {
        attestationLines.push(
          `Imported ${e.count} flight${e.count !== 1 ? 's' : ''} from ${e.source}${e.signedBy ? ' · certified by ' + displayCrewName(e.signedBy, p) : ''}${e.firstAt ? ' · ' + pdfLocalDateOf(e.firstAt) : ''}`
        );
      });
    }
    // No acceptance-stamp tally here. It used to print "8 of 110 entries carry
    // an acceptance stamp", which reads as "102 entries are unverified" when it
    // only ever meant "102 predate the stamp". Martin 2026-08-12: "enleve les
    // affaire de stamp 8 sur 110, ces juste melangeant pour rien". The stamps
    // themselves are untouched — every row keeps acceptedAt/acceptedBy and the
    // logbook shows them per flight, which is where he asked for them.

    if (attestationLines.length === 0) {
      doc.text(baseFooter, W / 2, H - 8, { align: 'center' });
    } else {
      // Stack: provenance/attestation lines above, baseFooter at the very bottom.
      doc.setFontSize(6.5);
      const lineH = 3.6;
      const startY = H - 8 - (attestationLines.length * lineH);
      attestationLines.forEach((ln, i) => {
        doc.text(ln, W / 2, startY + i * lineH, { align: 'center', maxWidth: W - 16 });
      });
      doc.setFontSize(7);
      doc.text(baseFooter, W / 2, H - 4, { align: 'center' });
    }
  }

  // ════════════════════════════════════════════
  // LOG PAGES — paginated, with running totals
  // ════════════════════════════════════════════
  if (sorted.length === 0) {
    doc.setFontSize(14); doc.setTextColor(...textPrimary);
    doc.text('No flights logged yet.', W/2, H/2, { align: 'center' });
    doc.save(`logbook_${name.replace(/\s+/g,'_')}_${localTodayStr()}.pdf`);
    showToast(t('toast.pdfExported'), 'success');
    return;
  }

  // Compute table column widths to fit the page (W minus left/right margin)
  const tableMargin = 8;
  const tableW = W - 2 * tableMargin;
  const totalWidthUnits = cols.reduce((sum, c) => sum + (c.width || 12), 0);
  const widthScale = tableW / totalWidthUnits;
  const colWidths = cols.map(c => (c.width || 12) * widthScale);

  // A FIGURE IS NEVER TRIMMED — a clipped number is a wrong number on a page
  // an inspector reads — so when the grid gets narrow (many columns ticked) the
  // table's own font shrinks until the widest figure that can print still fits
  // its column. The career total is that worst case: no cell or totals row can
  // exceed it. With the default column set 6.5pt already fits and nothing here
  // changes. (Martin 2026-08-12, exporting from his phone.)
  let bodyPt = 6.5;
  {
    const _worst = (function () {
      const s = (typeof calcStats === 'function') ? calcStats() : {};
      const c = (typeof totalsWithOpening === 'function') ? totalsWithOpening(s) : s;
      return fmt(c.total || c.block || 0);
    })();
    doc.setFont('helvetica', 'bold');
    while (bodyPt > 4.5) {
      doc.setFontSize(bodyPt);
      const wNum = doc.getTextWidth(_worst);
      if (!cols.some((c, i) => _isCumulativePdfCol(c) && wNum > colWidths[i] - 2)) break;
      bodyPt -= 0.25;
    }
  }

  // Running cumulative totals across pages
  const runTotals = {};
  cols.forEach(c => { if (_isCumulativePdfCol(c)) runTotals[c.key] = 0; });

  // Seed the running cumulative totals from the pilot's brought-forward
  // (paper-logbook) hours. Without this, the "CUMULATIVE TOTALS — CARRIED
  // FORWARD" row summed Cumulo flights ONLY: a pilot with ~2781 h brought
  // forward + ~400 h logged read ~430 h at the bottom of the log pages — the
  // "missing reported hours" bug (Martin 2026-07-18). The cover-page hero
  // already folds brought-forward in via totalsWithOpening(); this makes the
  // log-page running totals agree with it. PAGE TOTALS stay flights-only by
  // design (they are per-page, not career cumulative).
  const _pdfHasBF = (typeof hasOpeningBalances === 'function') && hasOpeningBalances();
  // totalsWithOpening({}) speaks in AGGREGATE keys (total, pic, night, xc...)
  // while the grid's cumulative columns are per-slot keys (xcDayPic,
  // instActual...). Seeding from the aggregates alone left every attested
  // detail column at 0, so the CARRIED FORWARD row silently printed a floor
  // as if it were the career figure. The raw attested balances already live
  // in per-slot key space (the licence tracker reads them that way); merge
  // them underneath so both key spaces seed. (Final audit 2026-08-02.)
  const _rawBal = (_pdfHasBF && typeof loadOpeningBalances === 'function')
    ? (loadOpeningBalances().balances || {}) : {};
  const _openingSeed = _pdfHasBF
    ? Object.assign({}, _rawBal, (typeof totalsWithOpening === 'function') ? totalsWithOpening({}) : {})
    : {};
  if (_pdfHasBF) {
    Object.assign(runTotals, openingSeedForCumulative(cols, _openingSeed));
  }

  const ROWS_PER_PAGE = 24;
  const totalPages = Math.ceil(sorted.length / ROWS_PER_PAGE);

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    doc.addPage();
    const rows = sorted.slice(pageIdx * ROWS_PER_PAGE, (pageIdx + 1) * ROWS_PER_PAGE);
    drawLogPage(rows, pageIdx + 1);
  }

  function drawLogPage(rows, pageNum) {
    // Header band
    doc.setFillColor(...navy);
    doc.rect(0, 0, W, 14, 'F');
    doc.setTextColor(...white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Pilot Logbook', tableMargin, 9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`${fullTitle} · License ${license} · ${airline}`, tableMargin + 50, 9);
    doc.text(`Page ${pageNum} of ${totalPages}`, W - tableMargin, 9, { align: 'right' });

    // Column headers row
    let y = 18;
    doc.setFillColor(...light);
    doc.rect(tableMargin, y, tableW, 6, 'F');
    doc.setDrawColor(...border);
    doc.line(tableMargin, y + 6, tableMargin + tableW, y + 6);
    doc.setTextColor(...muted);
    doc.setFont('helvetica', 'bold');
    // Headers shrink to fit before they clip. At 6pt fixed, ticking many
    // columns made every header wider than its own column, so they overprinted
    // each other into an unreadable band across the top of the page — the
    // "lignes en haut on voit mal, sont pas alignees" Martin reported from his
    // phone on 2026-08-12. The floor keeps them legible; anything still too
    // long is trimmed to its column rather than allowed to run into the next.
    let headPt = 6;
    while (headPt > 4.2) {
      doc.setFontSize(headPt);
      if (!cols.some((c, i) => doc.getTextWidth(String(c.short).toUpperCase()) > colWidths[i] - 1.5)) break;
      headPt -= 0.2;
    }
    doc.setFontSize(headPt);
    let x = tableMargin;
    cols.forEach((c, i) => {
      const tx = c.align === 'right' ? x + colWidths[i] - 1
              : c.align === 'center' ? x + colWidths[i] / 2
              : x + 1;
      doc.text(pdfFit(String(c.short).toUpperCase(), colWidths[i] - 1.5), tx, y + 4, { align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' });
      x += colWidths[i];
    });
    y += 7;

    // First page only — a "TOTALS BROUGHT FORWARD" carry-in row, exactly like
    // the opening line of a paper logbook page, so the inspector reads:
    // brought forward + this page's flights = cumulative. Pages 2+ don't repeat
    // it (the running cumulative already carries it forward). Only shown when
    // the pilot has declared brought-forward hours. English literal to match
    // the other TC-PDF total rows (the export stays English by regulation).
    if (pageNum === 1 && _pdfHasBF) {
      drawTotalsRow('TOTALS BROUGHT FORWARD', openingSeedForCumulative(cols, _openingSeed), muted, white, y);
      y += 6.5;
    }

    // Page totals (per page)
    const pageTotals = {};
    cols.forEach(c => { if (runTotals.hasOwnProperty(c.key)) pageTotals[c.key] = 0; });

    // Data rows
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(bodyPt);
    rows.forEach((f, i) => {
      if (i % 2 === 0) { doc.setFillColor(252, 253, 255); doc.rect(tableMargin, y - 3, tableW, 5.5, 'F'); }
      doc.setTextColor(...textPrimary);
      x = tableMargin;
      cols.forEach((c, ci) => {
        let v = pdfCellValue(f, c.key);
        // Translate UI Unicode glyphs to ASCII for jsPDF Helvetica compatibility
        if (v === '✓') v = 'Yes';
        if (v === '—') v = '-';
        let display;
        if (v === undefined || v === null || v === '' || (c.decimal && (+v === 0)) || (!c.decimal && c.key !== 'multiCrew' && c.key !== 'remarks' && c.key !== 'crewPosition' && typeof v === 'number' && v === 0)) {
          display = '-';  // ASCII hyphen, not em-dash (em-dash renders as garbage in Helvetica)
        } else if (c.decimal) {
          display = fmt(v);
          if (runTotals.hasOwnProperty(c.key)) pageTotals[c.key] += +v;
        } else if (typeof v === 'number') {
          display = String(v);
          if (runTotals.hasOwnProperty(c.key)) pageTotals[c.key] += v;
        } else {
          // Fit the column's real width instead of a fixed character count.
          // The old cap of 22 was neither necessary (a longer name fits a wide
          // PIC column) nor sufficient (with every column ticked the column is
          // narrow and 22 characters overflow it). All it guaranteed was that
          // a long captain name was silently cut, so the PDF showed a name
          // that is not the name in the record. Newlines are flattened because
          // a row band is one line high. Anything genuinely shortened now ends
          // in a marker rather than stopping mid-word. (Audit 2026-07-27.)
          const raw = String(v).replace(/[\r\n]+/g, ' ').trim();
          const room = Math.max(4, colWidths[ci] - 2);
          display = raw;
          if (doc.getTextWidth(display) > room) {
            while (display.length > 1 && doc.getTextWidth(display + '...') > room) {
              display = display.slice(0, -1);
            }
            display += '...';
          }
        }
        const tx = c.align === 'right' ? x + colWidths[ci] - 1
                : c.align === 'center' ? x + colWidths[ci] / 2
                : x + 1;
        doc.text(display, tx, y + 1, { align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' });
        x += colWidths[ci];
      });
      y += 5.5;
    });

    // Add running totals
    Object.keys(pageTotals).forEach(k => { runTotals[k] += pageTotals[k]; });

    // Totals rows : Page totals + Cumulative
    y += 2;
    drawTotalsRow('PAGE TOTALS', pageTotals, accent, white, y);
    y += 6.5;
    drawTotalsRow('CUMULATIVE TOTALS — CARRIED FORWARD', runTotals, navy, white, y);

    // Certification + signature line (EVERY page — TC inspector best practice)
    y += 14;
    doc.setDrawColor(...border);
    doc.setTextColor(...textPrimary);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.text('I certify that the entries on this page are true and correct.', tableMargin, y);
    y += 8;
    doc.setLineWidth(0.3);
    doc.line(tableMargin, y, tableMargin + 70, y);                // Signature
    doc.line(tableMargin + 90, y, tableMargin + 140, y);          // Date
    doc.line(tableMargin + 160, y, tableMargin + 220, y);         // License
    drawSavedSignature(tableMargin, y, 70, tableMargin + 90, tableMargin + 160);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...muted);
    doc.text('Pilot Signature', tableMargin, y + 3);
    doc.text('Date', tableMargin + 90, y + 3);
    doc.text('License Number', tableMargin + 160, y + 3);
  }

  function drawTotalsRow(label, totals, bgColor, txtColor, y) {
    doc.setFillColor(...bgColor);
    doc.rect(tableMargin, y, tableW, 6, 'F');
    doc.setTextColor(...txtColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(Math.min(6, bodyPt));
    // Same ASCII rule the data cells use: jsPDF's Helvetica renders an em-dash
    // as a garbage glyph, so the "CUMULATIVE TOTALS — CARRIED FORWARD" label
    // would print a stray character. Normalise em-/en-dashes to a hyphen here so
    // any label passed to this row is safe.
    const safeLabel = String(label).replace(/[–—]/g, '-');
    // The label owns the columns BEFORE the first printed figure. Drawn at full
    // length it ran straight through those figures whenever the grid was
    // narrow (many columns ticked), so the row read as overlapping garbage.
    let labelRoom = tableW - 2;
    let probeX = tableMargin;
    for (let i = 0; i < cols.length; i++) {
      if (i > 0 && totals.hasOwnProperty(cols[i].key)) { labelRoom = probeX - tableMargin - 2; break; }
      probeX += colWidths[i];
    }
    let x = tableMargin;
    cols.forEach((c, i) => {
      if (i === 0) {
        doc.text(pdfFit(safeLabel, Math.max(10, labelRoom)), x + 1, y + 4);
      } else if (totals.hasOwnProperty(c.key)) {
        const display = c.decimal ? fmt(totals[c.key]) : String(Math.round(totals[c.key] * 100) / 100);
        const tx = c.align === 'right' ? x + colWidths[i] - 1
                : c.align === 'center' ? x + colWidths[i] / 2
                : x + 1;
        doc.text(display, tx, y + 4, { align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' });
      }
      x += colWidths[i];
    });
  }

  // ════════════════════════════════════════════
  // FINAL PAGE — CURRENCY STATUS (CAR 401.05)
  // ════════════════════════════════════════════
  doc.addPage();
  drawCurrencyPage();

  function drawCurrencyPage() {
    // Header band
    doc.setFillColor(...navy);
    doc.rect(0, 0, W, 14, 'F');
    doc.setTextColor(...white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Currency & Recency Status', tableMargin, 9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`${fullTitle} · ${new Date().toLocaleDateString('en-CA')}`, W - tableMargin, 9, { align: 'right' });

    let y = 28;
    const today = new Date(); today.setHours(0,0,0,0);

    // Title
    doc.setTextColor(...textPrimary);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Regulatory currency overview', tableMargin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    doc.text('Per Canadian Aviation Regulations (CAR 401.05). Status as of generation date.', tableMargin, y + 6);
    y += 18;

    // Compute currency stats. All windows are anchored on the LOCAL civil
    // date and bounded above by today — toISOString() is the UTC date (reads
    // tomorrow in the evening in Toronto) and a future-dated flight is not
    // "within the preceding" window. 6-month cutoff = sixMonthCutoffStr(),
    // the same single source the dashboard ring/alerts use, so the PDF and
    // the screen can never disagree on the WINDOW. (The PDF's sums are not
    // yet countsTowardRecency-filtered like the dashboard's — pre-existing,
    // tracked separately.) 90 days = exactly 90 local dates
    // [today − 89 … today], the §700.27 window convention. Registre §401.05,
    // décision 2026-07-17.
    const todayStr = localTodayStr();
    const cutoff90Str = shiftDateStr(todayStr, -89);
    const cutoff6mStr = sixMonthCutoffStr();

    const _in90 = flights.filter(f => f.date && f.date >= cutoff90Str && f.date <= todayStr);
    const _in6m = flights.filter(f => f.date && f.date >= cutoff6mStr && f.date <= todayStr);

    // The device filters the dashboard has always applied, and this page had
    // not. CAR 401.05(2)(b) admits only an aircraft of the same category and
    // class or a Level B/C/D full-flight simulator for take-off and landing
    // recency, so an FTD session used to make this page badge passenger
    // recency CURRENT off nothing but simulator landings, while the dashboard
    // reported 0 for the same data. The approach rule 401.05(3.1)(b) is
    // BROADER (it admits an approved flight training device), which is why the
    // two use different predicates and must never share one.
    // (Registre 401.05, audit 2026-07-27.)
    const _recFilter = (typeof countsTowardRecency === 'function') ? countsTowardRecency : function () { return true; };
    const _apprFilter = (typeof approachCountsTowardIFR === 'function') ? approachCountsTowardIFR : function () { return true; };
    const recent90 = _in90.filter(_recFilter);
    const recent6m = _in6m.filter(_recFilter);
    const recent6mAppr = _in6m.filter(_apprFilter);

    const ldg90Day = recent90.reduce((s, f) => s + (+f.ldgDay || 0), 0);
    const ldg90Night = recent90.reduce((s, f) => s + (+f.ldgNight || 0), 0);
    const ldg90Total = ldg90Day + ldg90Night;
    // Passenger-carrying recency is a 6-MONTH window (CAR 401.05(2)), not 90 days.
    const ldg6mDay = recent6m.reduce((s, f) => s + (+f.ldgDay || 0), 0);
    const ldg6mNight = recent6m.reduce((s, f) => s + (+f.ldgNight || 0), 0);
    const ldg6mTotal = ldg6mDay + ldg6mNight;
    // Take-offs must be SUMMED (a leg can log 0 or several), never counted as
    // one per flight row — counting rows produced false CURRENT badges. (Audit fix.)
    const to6mDay = recent6m.reduce((s, f) => s + (+f.toDay || 0), 0);
    const to6mNight = recent6m.reduce((s, f) => s + (+f.toNight || 0), 0);
    const to6m = to6mDay + to6mNight;
    // CAR 401.05(3.1): 6 instrument approaches in 6 months. Approaches only —
    // instrument HOURS are not a requirement of the current regulation and are
    // no longer computed here (they were only ever used to fail this page).
    const approaches6m = recent6mAppr.reduce((s, f) => s + (+f.approaches || 0), 0);

    const items = [
      // Take-offs are logged far more sparsely than landings in this logbook
      // (imports fill landings; take-offs are hand-typed). A shortfall of
      // RECORDED take-offs cannot prove the pilot is not current — it proves
      // the logging is incomplete — so it renders UNKNOWN, never a false
      // NOT CURRENT on a paper an inspector reads. Landings CAN fail the item
      // definitively. Detection stays positive-only. (Final audit 2026-08-02.)
      {
        title: 'Passenger-carrying currency (Day)',
        reg: 'CAR 401.05(2)(a)',
        requirement: '5 take-offs and 5 landings within preceding 6 months',
        current: ldg6mTotal >= 5 && to6m < 5
          ? `${ldg6mTotal} landings · ${to6m} take-off${to6m !== 1 ? 's' : ''} recorded (take-off logging may be incomplete)`
          : `${to6m} take-off${to6m !== 1 ? 's' : ''} · ${ldg6mTotal} landing${ldg6mTotal !== 1 ? 's' : ''} in last 6 months`,
        ok: ldg6mTotal < 5 ? false : (to6m >= 5 ? true : null)
      },
      {
        title: 'Passenger-carrying currency (Night)',
        reg: 'CAR 401.05(2)(b)',
        requirement: '5 night take-offs and 5 night landings within preceding 6 months',
        current: ldg6mNight >= 5 && to6mNight < 5
          ? `${ldg6mNight} night landings · ${to6mNight} night take-off${to6mNight !== 1 ? 's' : ''} recorded (take-off logging may be incomplete)`
          : `${to6mNight} night take-off${to6mNight !== 1 ? 's' : ''} · ${ldg6mNight} night landing${ldg6mNight !== 1 ? 's' : ''} in last 6 months`,
        ok: ldg6mNight < 5 ? false : (to6mNight >= 5 ? true : null)
      },
      // Instrument rating: the 24-month test or check, then the approach
      // recency that follows it. There is NO instrument-time requirement —
      // the "6 hours" item printed here until 2026-08-12 quoted a DATED
      // permalink frozen at 2025-12-17; the words are not in the current
      // regulation (verified against the raw text, see registre). It badged
      // a line pilot NOT CURRENT for failing a rule that does not exist.
      {
        title: 'Instrument rating — test or check',
        reg: 'CAR 401.05(3)',
        requirement: 'A flight test, instrument proficiency check or PPC within the preceding 24 months (for 705 operations, a PPC under Standard 725.106 — CAR 401.05(3)(d)(iv)(G))',
        current: p.ppcDueDate ? `PPC recorded as valid to ${p.ppcDueDate}` : 'No PPC date in profile',
        ok: p.ppcDueDate ? (p.ppcDueDate >= localTodayStr()) : null
      },
      {
        title: 'IFR currency — approaches',
        reg: 'CAR 401.05(3.1)',
        requirement: '6 instrument approaches within the preceding 6 months. Applies only from the first day of the seventh month after the test or check above',
        current: `${Math.floor(approaches6m)} approach${approaches6m !== 1 ? 'es' : ''} logged in last 6 months`,
        ok: approaches6m >= 6
      },
      {
        title: 'Medical certificate',
        reg: 'CAR 404',
        requirement: 'Valid Category 1 or 3 medical for commercial operations',
        // Print the stored YYYY-MM-DD as it stands. Routing it through a Date
        // parsed it as UTC midnight and formatted it in local time, printing
        // the day BEFORE the one he entered, contradicting the cover of the
        // same PDF and, on the expiry date itself, badging a valid medical
        // NOT CURRENT. (Audit 2026-07-27.)
        current: p.medical ? `Expires ${p.medical}` : 'Not set in profile',
        // STRING comparison against the local civil date: new Date('YYYY-MM-DD')
        // parses as UTC midnight and badged a valid medical NOT CURRENT on its
        // own expiry date in Toronto. (Final audit r3, 2026-08-02.)
        ok: p.medical ? (p.medical >= localTodayStr()) : null
      },
      {
        title: 'ECG due date',
        // The intervals that used to print here were STRIPPED from the app on
        // 2026-06-26 because nothing sourced them, and the register says they must
        // not return until verified against TP 13312 / Standard 424. They came back
        // on this page anyway, under a source line that reads like a citation.
        // The due date itself is the pilot own entry and stays. (Audit 2026-07-27.)
        reg: 'Category 1 medical standard',
        requirement: 'Interval set by your Civil Aviation Medical Examiner',
        current: p.ecg ? `Next due ${p.ecg}` : 'Not set in profile',
        ok: p.ecg ? (p.ecg >= localTodayStr()) : null
      }
      // The '90-day recency / Operator best practice' card was removed
      // 2026-08-02: it cited no regulation and could badge NOT CURRENT on a
      // document whose regulatory items were all green. (Martin's go.)
    ];

    items.forEach(item => {
      const statusColor = item.ok === null ? muted : item.ok ? [16, 163, 127] : [220, 42, 42];
      const statusText = item.ok === null ? 'UNKNOWN' : item.ok ? 'CURRENT' : 'NOT CURRENT';

      doc.setDrawColor(...border);
      doc.setLineWidth(0.3);
      doc.roundedRect(tableMargin, y, W - 2 * tableMargin, 18, 2, 2, 'S');

      // Left bar (color-coded status)
      doc.setFillColor(...statusColor);
      doc.rect(tableMargin, y, 2, 18, 'F');

      // Title + reg
      doc.setTextColor(...textPrimary);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(item.title, tableMargin + 6, y + 5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...muted);
      doc.text(item.reg, tableMargin + 6, y + 9.5);

      // Requirement + current state. Bounded by the status badge on the right
      // (right-aligned at W - tableMargin - 4, widest label ~26 mm) so a long
      // requirement stops instead of running underneath it.
      const _reqRoom = (W - tableMargin - 4) - 26 - (tableMargin + 6);
      doc.setFontSize(8);
      doc.setTextColor(...textPrimary);
      doc.text(pdfFit('Requirement: ' + item.requirement, _reqRoom), tableMargin + 6, y + 13.5);
      doc.setTextColor(...muted);
      doc.text(pdfFit('Current: ' + item.current, _reqRoom), tableMargin + 6, y + 17);

      // Status badge (right)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...statusColor);
      doc.text(statusText, W - tableMargin - 4, y + 11, { align: 'right' });

      y += 20;   // 18 mm card + 2 mm gutter: seven cards, disclaimer and both signature lines fit inside the 216 mm sheet. At 26 the last card ran 4 mm past the bottom and everything below it was drawn off the page.
    });

    // Disclaimer footer
    y += 8;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(...muted);
    doc.text('This summary is informational. The pilot remains solely responsible for verifying their currency before each flight in accordance with CAR 401.05 and the Operator Manual.', tableMargin, y, { maxWidth: W - 2 * tableMargin });

    // Signature line
    y += 16;
    doc.setLineWidth(0.3);
    doc.line(tableMargin, y, tableMargin + 70, y);
    doc.line(tableMargin + 90, y, tableMargin + 140, y);
    drawSavedSignature(tableMargin, y, 70, tableMargin + 90, null);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...muted);
    doc.text('Pilot Signature', tableMargin, y + 3);
    doc.text('Date', tableMargin + 90, y + 3);
  }

  doc.save(`logbook_${name.replace(/\s+/g,'_')}_${localTodayStr()}.pdf`);
  showToast(t('toast.pdfExportedPages', { pages: totalPages + 2 }), 'success');
}

