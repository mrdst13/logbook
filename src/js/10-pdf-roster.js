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
  details.innerHTML = `Reading <strong>${file.name}</strong>…`;

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

    // Parse the text to extract flight legs with their crew
    const extracted = parseNavblueRosterText(allText);
    console.log(`[Roster] Extracted ${extracted.length} flights from PDF`);

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

    // Merge captain names into existing flights — match by date + flight number
    let matched = 0, alreadyHad = 0, noMatch = 0;
    const stillMissing = [];
    extracted.forEach(item => {
      // Find existing flight : exact match on date + flightNum
      const idx = flights.findIndex(f =>
        f.date === item.date &&
        (f.flightNum === item.flightNum || (f.route && f.route.toUpperCase() === item.route))
      );
      if (idx === -1) { noMatch++; stillMissing.push(item); return; }
      const existing = flights[idx];
      if (existing.pic && existing.pic.trim() && existing.pic !== '—') {
        // Don't overwrite an existing PIC name
        alreadyHad++;
        return;
      }
      // PIPEDA model (2026-05-13): store full name locally. Anonymization
      // happens at egress (cloud sync, shareable PDF export), never at import.
      flights[idx] = { ...existing, pic: item.pic };
      matched++;
    });

    if (matched > 0) {
      DB.save(flights);
      renderDashboard();
    }

    const detailLines = [
      `<strong>${extracted.length}</strong> flight legs extracted from PDF`,
      `<strong style="color:var(--success);">${matched}</strong> captain name${matched !== 1 ? 's' : ''} added to existing flights`,
    ];
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
    details.innerHTML = `<span style="color:var(--danger);">Error: ${e.message}</span>`;
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

// Parse the extracted text to find flight legs + crew names.
// Navblue HrRosterReport format varies but generally each flight leg row contains:
//   FLIGHT_NUMBER  DATE  STD_TIME  STA_TIME  DEP_AIRPORT  ARR_AIRPORT  A/C  CAPT_NAME  FO_NAME ...
// We look for : PD\d+ pattern (Porter mainline) and surrounding date + crew section.
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

      if (pic) {
        flights.push({ date, flightNum, route, pic });
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

