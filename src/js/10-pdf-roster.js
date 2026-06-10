// ═══════════════════════════════════════════
// NAVBLUE PDF ROSTER PARSER — captain name capture
// ═══════════════════════════════════════════
// Parses an HrRosterReport PDF entirely client-side using pdf.js.
// Extracts flight legs + crew names, then merges PIC name into existing
// logbook entries (matched on date + flight#).
// Zero data leaves the browser.

function handleRosterDrop(event) {
  event.preventDefault();
  const dz = document.getElementById('rosterDropZone');
  if (dz) dz.classList.remove('dragover');
  const file = event.dataTransfer && event.dataTransfer.files[0];
  if (file) handleRosterFile(file);
}

async function handleRosterFile(file) {
  if (!file) return;
  if (typeof pdfjsLib === 'undefined') {
    showToast(t('toast.pdfLibNotLoaded'), 'error');
    return;
  }
  const details = document.getElementById('rosterDetails');
  details.style.display = 'block';
  details.innerHTML = `Reading <strong>${esc(file.name)}</strong>…`;

  try {
    // Read the file as ArrayBuffer (client-side, no upload)
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    details.innerHTML = `Parsing ${pdf.numPages} page${pdf.numPages !== 1 ? 's' : ''}…`;

    // Extract all text from all pages, page by page, preserving structure
    let allText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Group items by Y position to approximate text lines
      const lines = groupTextByLines(content.items);
      allText += lines.join('\n') + '\n';
    }

    console.log('[Roster] First 1500 chars of extracted text:\n' + allText.substring(0, 1500));

    // Detect TimeMode header (Navblue PDFs can be downloaded in Local or UTC).
    // We extract ATD/ATA verbatim; if Local mode, the user should re-download
    // the PDF in UTC to avoid timezone conversion. We refuse to silently
    // approximate (cf. feedback_never_approximate_certifiable_data.md).
    const timeModeMatch = allText.match(/TimeMode\s+(Local time|UTC|Zulu)/i);
    const pdfTimeMode = timeModeMatch ? timeModeMatch[1].toLowerCase() : 'unknown';
    const isLocalTime = pdfTimeMode.includes('local');

    // Parse the text to extract flight legs with their crew AND ATD/ATA actuals
    const extracted = parseNavblueRosterText(allText);
    console.log(`[Roster] Extracted ${extracted.length} flights from PDF (TimeMode: ${pdfTimeMode})`);

    if (extracted.length === 0) {
      details.innerHTML = `<span style="color:var(--danger);">No flight legs detected in this PDF. Make sure it's a Navblue HrRosterReport (not a different report).</span>`;
      showToast(t('toast.noFlightsInPdf'), 'error');
      return;
    }

    // SNAPSHOT before bulk modification (zero-data-loss policy)
    snapshotBeforeOperation('Crew names enrichment from PDF');
    updateUndoButton();

    // PIPEDA: read consent toggle BEFORE looping so we apply the same policy
    // to every captain name in this import batch.
    const rosterProfile = DB.loadProfile();

    // Merge crew names + ATD/ATA actuals into existing flights.
    // Strict rule (2026-05-14): only write atd_utc/ata_utc when (a) the PDF
    // is in UTC TimeMode and (b) the values are non-zero. Local-time PDFs
    // are NOT silently converted — we refuse to approximate.
    let matched = 0, alreadyHad = 0, noMatch = 0, atdAdded = 0;
    const stillMissing = [];
    extracted.forEach(item => {
      // Find existing flight : exact match on date + flightNum
      const idx = flights.findIndex(f =>
        f.date === item.date &&
        (f.flightNum === item.flightNum || (f.route && f.route.toUpperCase() === item.route))
      );
      if (idx === -1) { noMatch++; stillMissing.push(item); return; }
      const existing = flights[idx];
      const merged = { ...existing };
      let changed = false;
      // Captain name — don't overwrite if user already has one
      if (item.pic && (!existing.pic || !existing.pic.trim() || existing.pic === '—')) {
        merged.pic = item.pic;
        changed = true;
        matched++;
      } else if (item.pic) {
        alreadyHad++;
      }
      // ATD/ATA — only if PDF is in UTC mode AND values are non-zero AND
      // the flight doesn't already have manually-entered actuals.
      if (!isLocalTime && item.atd_utc && item.atd_utc !== '0000' && !existing.atd_utc) {
        merged.atd_utc = item.atd_utc;
        changed = true;
        atdAdded++;
      }
      if (!isLocalTime && item.ata_utc && item.ata_utc !== '0000' && !existing.ata_utc) {
        merged.ata_utc = item.ata_utc;
        changed = true;
      }
      if (changed) flights[idx] = merged;
    });

    if (matched > 0 || atdAdded > 0) {
      DB.save(flights);
      renderDashboard();
    }

    const detailLines = [
      `<strong>${extracted.length}</strong> flight legs extracted from PDF`,
      `<strong style="color:var(--success);">${matched}</strong> captain name${matched !== 1 ? 's' : ''} added to existing flights`,
    ];
    if (atdAdded > 0) {
      detailLines.push(`<strong style="color:var(--success);">${atdAdded}</strong> ATD/ATA actual time${atdAdded !== 1 ? 's' : ''} captured from PDF`);
    }
    if (isLocalTime) {
      detailLines.push(`<span style="color:var(--warning);">⚠ PDF is in <strong>Local time</strong> mode — ATD/ATA were NOT imported to avoid timezone-conversion approximation. Re-download in <strong>UTC / Zulu</strong> TimeMode for actual times.</span>`);
    } else if (pdfTimeMode === 'unknown') {
      detailLines.push(`<span style="color:var(--text-muted);">PDF TimeMode not detected — ATD/ATA captured as-is.</span>`);
    }
    if (alreadyHad > 0) detailLines.push(`<span>${alreadyHad} flights already had a PIC (not overwritten)</span>`);
    if (noMatch > 0) detailLines.push(`<span style="color:var(--warning);">${noMatch} legs not found in your logbook (older than iCal window?)</span>`);
    details.innerHTML = detailLines.join('<br>');

    if (matched > 0) {
      showToast(t(matched === 1 ? 'toast.captainsAdded' : 'toast.captainsAddedPl', { n: matched }), 'success');
    } else if (alreadyHad === extracted.length) {
      showToast(t('toast.allHadPic'));
    } else {
      showToast(t('toast.noCaptainsAdded'), 'error');
    }
  } catch (e) {
    console.error('[Roster] Parse error:', e);
    details.innerHTML = `<span style="color:var(--danger);">Error: ${esc(e.message)}</span>`;
    showToast(t('toast.pdfParseFailed', { err: e.message }), 'error');
  }
}

// Group pdf.js text items by Y coordinate → approximate visual lines
function groupTextByLines(items) {
  const lines = {};
  items.forEach(item => {
    if (!item.str || !item.str.trim()) return;
    const y = Math.round(item.transform[5]);  // Y position
    const x = item.transform[4];               // X position
    if (!lines[y]) lines[y] = [];
    lines[y].push({ x, text: item.str });
  });
  // Sort each line by X position then join with spaces
  return Object.keys(lines)
    .sort((a, b) => +b - +a)  // top to bottom (PDF Y is inverted)
    .map(y => lines[y].sort((a, b) => a.x - b.x).map(i => i.text).join(' '));
}

// Parse the extracted text to find flight legs, crew names, AND actual times.
// Navblue HrRosterReport format (confirmed against Porter sample 2026-05-14):
//   Header: Date  Des. Code Req LE  CI   Dep STD  Arr STA  CO   AC  WA Func Rank ATD   ATA   BLH   Credit Pairing
//   Row:    01 Fri        PD448         1055 YYJ 1155 YOW 1933 2002 295               FO   12:07 19:47 04:40 04:40 O3049
//
// Key observations:
//   - CI/STD/STA/CO use HHMM format (no separator) — these are schedule
//   - ATD/ATA use HH:MM format (colon separator) — these are ACTUAL times
//   - 4 HH:MM values appear after rank (FO/CA): ATD, ATA, BLH, Credit
//   - "00:00" in ATD/ATA = not flown yet (future flight) — skip
//   - TimeMode is in the PDF header (Local or UTC); caller decides import policy
function parseNavblueRosterText(text) {
  const flights = [];
  const lines = text.split(/\r?\n/);

  // Strategy : sliding window across lines. For each line containing PD\d{2,4},
  // look for a date (YYYY-MM-DD or DD-MMM-YYYY or DDMMM) nearby, plus capital-name
  // patterns ("LASTNAME, F" or "LASTNAME F").
  // Crew names in Navblue PDFs : usually uppercase last name + first initial.

  // Build a date map : line index → ISO date (for any line that mentions a date)
  const dateOnLine = {};
  for (let i = 0; i < lines.length; i++) {
    const d = extractDate(lines[i]);
    if (d) dateOnLine[i] = d;
  }

  // Build airline-flight regex from profile operator codes
  const profile = DB.loadProfile();
  const codes = (profile.operatorCodes || 'PD').split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
  const codesPattern = codes.length > 0 ? codes.join('|') : 'PD';
  const flightNumRegex = new RegExp(`\\b((?:${codesPattern})\\d{2,4})\\b`, 'gi');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Find airline flight numbers in this line (per user's operator codes)
    const flightMatches = [...line.matchAll(flightNumRegex)];
    if (flightMatches.length === 0) continue;

    flightMatches.forEach(m => {
      const flightNum = m[1];

      // Find a date — look on this line, then walk backwards up to 5 lines
      let date = dateOnLine[i];
      if (!date) {
        for (let back = 1; back <= 5 && !date; back++) {
          date = dateOnLine[i - back];
        }
      }
      if (!date) return;  // can't anchor without a date

      // Find route (YOW-YYZ, YYJ-YOW, etc.) — 3-letter IATAs near the flight number
      const routeMatch = line.match(/\b([A-Z]{3})\s*[-\/]\s*([A-Z]{3})\b/) ||
                         line.match(/\b([A-Z]{3})\s+([A-Z]{3})\b/);
      const route = routeMatch ? `${routeMatch[1]}-${routeMatch[2]}` : '';

      // Find crew names — look on this line + next 2 lines
      // Pattern: LASTNAME, F  or  LASTNAME F.  or  Lastname Firstname
      const window = lines.slice(i, i + 3).join(' ');
      const crewMatches = [...window.matchAll(/\b([A-Z][A-Z\-']{1,30})(?:,\s*|\s+)([A-Z](?:\.|\b))/g)];
      // First crew name = captain (Navblue convention), second = F/O
      let pic = '';
      if (crewMatches.length >= 1) {
        pic = `${crewMatches[0][1]}, ${crewMatches[0][2].replace('.', '')}`;
        // Title Case the last name
        pic = pic.replace(/([A-Z])([A-Z]+)/, (_, h, t) => h + t.toLowerCase());
      }

      // Extract ATD/ATA actual times from the same row. Pattern: after
      // the rank token (FO / CA / CP) there are 4 HH:MM values =
      // ATD, ATA, BLH, Credit. The schedule times before (CI/STD/STA/CO)
      // are HHMM-no-colon, so the colon-separated values are unambiguous.
      let atd_utc = '', ata_utc = '';
      const timeMatches = [...line.matchAll(/(\d{2}):(\d{2})/g)];
      // We expect at least 2 HH:MM matches (ATD then ATA); BLH/Credit follow.
      if (timeMatches.length >= 2) {
        const atdRaw = timeMatches[0][1] + timeMatches[0][2]; // HHMM
        const ataRaw = timeMatches[1][1] + timeMatches[1][2];
        // "0000" = not flown yet (future flight) — skip rather than store zeros.
        // STRICT: never write a value that's not a real actual time.
        if (atdRaw !== '0000') atd_utc = atdRaw;
        if (ataRaw !== '0000') ata_utc = ataRaw;
      }

      if (pic || atd_utc || ata_utc) {
        flights.push({ date, flightNum, route, pic, atd_utc, ata_utc });
      }
    });
  }

  // Dedupe (same flight may appear on multiple lines)
  const seen = new Set();
  return flights.filter(f => {
    const key = `${f.date}|${f.flightNum}|${f.route}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Extract an ISO date from a line of text. Handles many Navblue date formats.
function extractDate(line) {
  // YYYY-MM-DD
  let m = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD-MMM-YYYY (eg 12-Apr-2026 or 12APR2026)
  m = line.match(/\b(\d{1,2})[\s\-]?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[\s\-]?(\d{2,4})\b/i);
  if (m) {
    const day = m[1].padStart(2, '0');
    const month = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' }[m[2].toUpperCase()];
    let year = m[3]; if (year.length === 2) year = '20' + year;
    return `${year}-${month}-${day}`;
  }
  // DD/MM/YYYY
  m = line.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}

function loadNavblueUI() {
  const url = localStorage.getItem(NAVBLUE_URL_KEY);
  const input = document.getElementById('navblueUrl');
  if (input && url) input.value = url;
  updateNavblueStatus();
  updateUndoButton();
  renderColumnPicker();
}

