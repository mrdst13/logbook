// ═══════════════════════════════════════════
// FEATURE 7 — PDF EXPORT (TC FORMAT)
// ═══════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────
//  EXPORT PDF — Transport Canada compliant (CAR 401.08 + Standard 421)
//  - Cover page (pilot identity, license, medical, type ratings)
//  - Log pages : 22 flights/page, page totals + cumulative running totals
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
function pdfCellValue(f, key) {
  if (key === 'total' || key === 'block') {
    return (typeof flightTimeOf === 'function') ? flightTimeOf(f) : (+f.total || +f.block || 0);
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
    return Object.keys(groups).map(group => `
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
    // Save as prefs (so the Logbook table updates too — consistent)
    saveColumnPrefs(selected);
    if (typeof renderLogbook === 'function') renderLogbook(filterVal || '');
    closeImportOverlay();
    _generatePDF();
  };
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function _generatePDF() {
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

  const cols = getVisibleColumns('pdf');
  const sorted = [...flights].sort((a,b) => (a.date || '').localeCompare(b.date || ''));

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

    // Pilot identity card (centered, large)
    const cardX = 30, cardY = 50, cardW = W - 60, cardH = 110;
    doc.setDrawColor(...border);
    doc.setLineWidth(0.3);
    doc.roundedRect(cardX, cardY, cardW, cardH, 3, 3, 'S');

    // Left column : photo placeholder + name
    doc.setTextColor(...textPrimary);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(fullTitle, cardX + 15, cardY + 22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...muted);
    doc.text(`${airline} · Base ${base}`, cardX + 15, cardY + 30);

    // Identity grid
    const idGridY = cardY + 50;
    const labelColor = muted, valueColor = textPrimary;
    const fields = [
      ['License Number', license],
      ['Medical Expiry', medical],
      ['Booklet Expiry', bookletExp],
      ['Type Rating(s)', fleet],
      ['Total Entries',  String(flights.length)],
    ];
    fields.forEach((row, i) => {
      const x = cardX + 15 + (i % 2) * ((cardW - 30) / 2);
      const y = idGridY + Math.floor(i / 2) * 20;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...labelColor);
      doc.text(row[0].toUpperCase(), x, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(...valueColor);
      doc.text(row[1], x, y + 6);
    });

    // ── Q6 — Hero career total + headline grid ─────────────────────
    // Cover-page hierarchy goes from largest (career total in big numerals)
    // down to the breakdown grid. Attestation legalese is demoted to the
    // footer band so the inspector reads identity → totals first, fine print
    // last (TP 14052 §6.3 — totals must be conspicuous on the cover sheet).
    const rawTotals = calcStats();
    const totals = (typeof totalsWithOpening === 'function') ? totalsWithOpening(rawTotals) : rawTotals;
    const hasBF = (typeof hasOpeningBalances === 'function') && hasOpeningBalances();

    // Hero block: starts a bit higher to make room for the breakdown grid.
    const heroY = H - 70;
    doc.setFillColor(...light);
    doc.rect(cardX, heroY, cardW, 40, 'F');

    // Eyebrow + giant total on the left third
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    const eyebrow = 'CAREER FLIGHT TIME · AS OF ' + new Date().toLocaleDateString('en-CA').toUpperCase();
    doc.text(eyebrow, cardX + 6, heroY + 7);

    // The "48px hero" — at 1pt ≈ 0.353mm, ~30pt PDF font reads visually
    // like 48px on screen. Bold helvetica + tabular feel via monospace
    // letter-tracking from jsPDF defaults.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(30);
    doc.setTextColor(...textPrimary);
    doc.text(`${fmt(totals.total || totals.block)} hrs`, cardX + 6, heroY + 24);

    // Breakdown line under the hero — shows brought-forward + logged-in-Cumulo
    // composition. Inspector sees instantly where the cumulative comes from.
    let breakdown;
    if (hasBF && typeof loadOpeningBalances === 'function') {
      const ob = loadOpeningBalances();
      const bfTotal = (+ob.balances.total || +ob.balances.block || 0);
      const loggedHere = Math.max(0, (totals.total || totals.block || 0) - bfTotal);
      breakdown = `+ ${fmt(bfTotal)} brought-forward (paper)   ·   + ${fmt(loggedHere)} logged in Cumulo`;
    } else {
      breakdown = `${flights.length} flight${flights.length !== 1 ? 's' : ''} logged in Cumulo`;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(breakdown, cardX + 6, heroY + 32);

    // Headline breakdown grid — six columns on the right side of the hero.
    // PIC / SIC / Night / Multi-Engine / Cross-Country / Landings.
    // Heli + Dual Given inserted only when > 0 (avoids diluting line-pilot
    // covers with empty-zero columns).
    const breakdownCols = [
      ['PIC',           fmt(totals.pic)],
      ['SIC',           fmt(totals.sic)],
      ['Night',         fmt(totals.night)],
      ['Multi-Engine',  fmt(totals.me)],
    ];
    if ((totals.heli || 0) > 0)      breakdownCols.push(['Helicopter',  fmt(totals.heli)]);
    if ((totals.dualGiven || 0) > 0) breakdownCols.push(['Dual Given',  fmt(totals.dualGiven)]);
    breakdownCols.push(['Cross-Country', fmt(totals.xc)]);
    breakdownCols.push(['Landings',      String(totals.ldg)]);

    // Lay grid in the right ~58% of the hero band.
    const gridStartX = cardX + cardW * 0.42;
    const gridW = cardW - (gridStartX - cardX) - 6;
    const slotW = gridW / breakdownCols.length;
    breakdownCols.forEach((h, i) => {
      const x = gridStartX + i * slotW;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...muted);
      doc.text(h[0].toUpperCase(), x, heroY + 14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(...textPrimary);
      doc.text(h[1], x, heroY + 24);
    });

    // Footer (cover) — includes import provenance notice if any flights
    // came from a CSV import. CAR 401.08(2)(h) requires an attestation
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
    // hero hierarchy stays clean). CAR 401.08(2)(h) is still satisfied —
    // the same pilot attestation appears below, just at footer weight.
    let attestationLines = [];
    if (hasBF && typeof loadOpeningBalances === 'function') {
      const ob = loadOpeningBalances();
      const bfTotal = (+ob.balances.total || +ob.balances.block || 0);
      const bfDate = ob.attestedAt ? ob.attestedAt.slice(0, 10) : '—';
      attestationLines.push(
        `Brought-forward attestation: ${fmt(bfTotal)} hrs declared on ${bfDate} by ${fullTitle} (CAR 401.08(2)(h))`
      );
    }
    if (importedSet.size > 0) {
      [...importedSet.values()].forEach(e => {
        attestationLines.push(
          `Imported ${e.count} flight${e.count !== 1 ? 's' : ''} from ${e.source}${e.signedBy ? ' · certified by ' + e.signedBy : ''}${e.firstAt ? ' · ' + e.firstAt.slice(0, 10) : ''}`
        );
      });
    }

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
  const _openingSeed = (_pdfHasBF && typeof totalsWithOpening === 'function') ? totalsWithOpening({}) : {};
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
    doc.setFontSize(6);
    let x = tableMargin;
    cols.forEach((c, i) => {
      const tx = c.align === 'right' ? x + colWidths[i] - 1
              : c.align === 'center' ? x + colWidths[i] / 2
              : x + 1;
      doc.text(c.short.toUpperCase(), tx, y + 4, { align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' });
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
    doc.setFontSize(6.5);
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
          display = String(v).substring(0, 22);
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
    doc.setFontSize(6);
    // Same ASCII rule the data cells use: jsPDF's Helvetica renders an em-dash
    // as a garbage glyph, so the "CUMULATIVE TOTALS — CARRIED FORWARD" label
    // would print a stray character. Normalise em-/en-dashes to a hyphen here so
    // any label passed to this row is safe.
    const safeLabel = String(label).replace(/[–—]/g, '-');
    let x = tableMargin;
    cols.forEach((c, i) => {
      if (i === 0) {
        doc.text(safeLabel, x + 1, y + 4);
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

    const recent90 = flights.filter(f => f.date && f.date >= cutoff90Str && f.date <= todayStr);
    const recent6m = flights.filter(f => f.date && f.date >= cutoff6mStr && f.date <= todayStr);

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
    // CAR 401.05: 6 instrument approaches in 6 months. Counter is approaches only.
    const approaches6m = recent6m.reduce((s, f) => s + (+f.approaches || 0), 0);
    const instHours6m = recent6m.reduce((s, f) => s + (+f.instActual || 0) + (+f.instHood || 0) + (+f.instSim || 0), 0);

    const items = [
      {
        title: 'Passenger-carrying currency (Day)',
        reg: 'CAR 401.05(2)(a)',
        requirement: '5 take-offs and 5 landings within preceding 6 months',
        current: `${to6m} take-off${to6m !== 1 ? 's' : ''} · ${ldg6mTotal} landing${ldg6mTotal !== 1 ? 's' : ''} in last 6 months`,
        ok: to6m >= 5 && ldg6mTotal >= 5
      },
      {
        title: 'Passenger-carrying currency (Night)',
        reg: 'CAR 401.05(2)(b)',
        requirement: '5 night take-offs and 5 night landings within preceding 6 months',
        current: `${to6mNight} night take-off${to6mNight !== 1 ? 's' : ''} · ${ldg6mNight} night landing${ldg6mNight !== 1 ? 's' : ''} in last 6 months`,
        ok: to6mNight >= 5 && ldg6mNight >= 5
      },
      {
        title: 'IFR currency — approaches',
        reg: 'CAR 401.05',
        requirement: '6 instrument approaches within preceding 6 months (PIC or required pilot)',
        current: `${Math.floor(approaches6m)} approach${approaches6m !== 1 ? 'es' : ''} logged in last 6 months`,
        ok: approaches6m >= 6
      },
      {
        title: 'IFR currency — instrument time',
        reg: 'CAR 401.05',
        requirement: '6 hours instrument time within preceding 6 months (actual + hood + approved sim)',
        current: `${instHours6m.toFixed(1)} hrs instrument time logged in last 6 months`,
        ok: instHours6m >= 6
      },
      {
        title: 'Medical certificate',
        reg: 'CAR 404',
        requirement: 'Valid Category 1 or 3 medical for commercial operations',
        current: p.medical ? `Expires ${new Date(p.medical).toLocaleDateString('en-CA')}` : 'Not set in profile',
        ok: p.medical ? (new Date(p.medical) >= today) : null
      },
      {
        title: 'ECG due date',
        reg: 'TC Cat 1 standard',
        requirement: 'Under 40: at first issuance · 40-65: every 24 months · 65+: annual',
        current: p.ecg ? `Next due ${new Date(p.ecg).toLocaleDateString('en-CA')}` : 'Not set in profile',
        ok: p.ecg ? (new Date(p.ecg) >= today) : null
      },
      {
        title: '90-day recency',
        reg: 'Operator best practice',
        requirement: 'Recent flying activity',
        current: `${recent90.length} flight${recent90.length !== 1 ? 's' : ''} in last 90 days`,
        ok: recent90.length > 0
      }
    ];

    items.forEach(item => {
      const statusColor = item.ok === null ? muted : item.ok ? [16, 163, 127] : [220, 42, 42];
      const statusText = item.ok === null ? 'UNKNOWN' : item.ok ? 'CURRENT' : 'NOT CURRENT';

      doc.setDrawColor(...border);
      doc.setLineWidth(0.3);
      doc.roundedRect(tableMargin, y, W - 2 * tableMargin, 22, 2, 2, 'S');

      // Left bar (color-coded status)
      doc.setFillColor(...statusColor);
      doc.rect(tableMargin, y, 2, 22, 'F');

      // Title + reg
      doc.setTextColor(...textPrimary);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(item.title, tableMargin + 6, y + 6);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...muted);
      doc.text(item.reg, tableMargin + 6, y + 11);

      // Requirement + current state
      doc.setFontSize(8);
      doc.setTextColor(...textPrimary);
      doc.text('Requirement: ' + item.requirement, tableMargin + 6, y + 16);
      doc.setTextColor(...muted);
      doc.text('Current: ' + item.current, tableMargin + 6, y + 20);

      // Status badge (right)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...statusColor);
      doc.text(statusText, W - tableMargin - 4, y + 13, { align: 'right' });

      y += 26;
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
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.text('Pilot Signature', tableMargin, y + 3);
    doc.text('Date', tableMargin + 90, y + 3);
  }

  doc.save(`logbook_${name.replace(/\s+/g,'_')}_${localTodayStr()}.pdf`);
  showToast(t('toast.pdfExportedPages', { pages: totalPages + 2 }), 'success');
}

