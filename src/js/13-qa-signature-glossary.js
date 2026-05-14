// ═══════════════════════════════════════════
// FEATURE 12 — Q&A SECTION
// ═══════════════════════════════════════════
// Static FAQ list. Each entry is a real question a Canadian pilot might
// have about logbook compliance / currency / TC regulations. Grouped
// loosely by topic; rendered in order.
const FAQS = [
  // ── Currency & recency ────────────────────────────────────────────
  {
    q: 'How many landings do I need to stay current as PIC?',
    a: 'Under CAR 401.05(2), to act as PIC carrying passengers you need at least 5 take-offs and 5 landings in the same category and class within the preceding 6 months. For night currency under CAR 401.05(3), you need 5 take-offs and 5 landings at night within the preceding 6 months.'
  },
  {
    q: 'What is IFR recency and how long is it valid?',
    a: 'Under CAR 401.05(5), to act as PIC under IFR you must have completed at least 6 instrument approaches in the preceding 6 months, either in an aircraft or approved simulator. The 6 months is a rolling window — counted backward from the day you want to fly IFR.'
  },
  {
    q: 'What are the currency rules for helicopter pilots?',
    a: 'Helicopter currency under CAR 401.05 mirrors fixed-wing: 5 take-offs and 5 landings in the preceding 6 months in the same category and class to carry passengers, plus 5 night TO/LDG in 6 months for night currency. Helicopter operations may also require additional currency for external load (CAR 702.21) and autorotation training, depending on operator and class of operation.'
  },
  {
    q: 'How often do I need to recur on type (PPC / IPC)?',
    a: 'Under CAR 705.106, a Pilot Proficiency Check (PPC) is required every 12 months for air carrier operations, with an Instrument Proficiency Check (IPC) also normally on a 12-month cycle. CAR 605.97 governs general IPC requirements. Many 705 operators check both during the same recurrent training event. Log every PPC / IPC in the Simulator section with the appropriate Session Type tag.'
  },

  // ── Logging conventions ───────────────────────────────────────────
  {
    q: 'How do I count block time vs. flight time?',
    a: 'Block time (BLH) starts when the aircraft moves under its own power (chocks out / brakes released) and ends when it comes to rest at the gate (chocks in). Flight time starts at first movement for takeoff and ends at landing rollout. For airline operations, Transport Canada generally accepts block time for logbook purposes under CAR 401.08.'
  },
  {
    q: 'What is PICUS and when can I log it?',
    a: 'PICUS (Pilot in Command Under Supervision) is time logged by a co-pilot (F/O) when acting in the role of PIC under the supervision of a qualified captain. In Canada, this is recognized under CAR 401.08 and can be credited toward ATPL minimums. You may log PICUS only when you are the actual decision-maker for the flight under direct supervision.'
  },
  {
    q: 'What counts as "cross-country" time?',
    a: 'CAR 401.34 defines cross-country (XC) as a flight to a point more than 25 nautical miles from the departure aerodrome. Cumulo automatically credits XC time when both departure and arrival ICAO codes are known and the great-circle distance exceeds 25 NM. Short hops (< 25 NM) are correctly NOT credited as XC, even if they cross other airports en route.'
  },
  {
    q: 'How do I log Multi-Crew time (MCC) for ATPL submission?',
    a: 'Multi-Crew time is flight time on aircraft that are certified for and operated with a minimum crew of two pilots (Q400, E195, A320, B737, etc.). For ATPL submission under CAR 421.34, MCC time is a separate credit. Cumulo automatically flags multi_crew = true on any flight where you logged both PIC and SIC hours on the same leg, or imported from a 705-operator roster.'
  },
  {
    q: 'How is Dual Given time credited for an instructor ATPL?',
    a: 'CAR 421.34(b) lets a flight instructor count dual-given time toward the 1,500 hours required for the ATPL — up to 1,200 of those hours can be flight-instruction time. Cumulo tracks Dual Given Day + Dual Given Night separately; the PDF cover page now shows a cumulative Dual Given total when you have any hours in those columns.'
  },

  // ── Medical & licensing ────────────────────────────────────────────
  {
    q: 'What medical class do airline pilots need and how often must I renew?',
    a: 'ATPL holders operating under CAR 705 (air carrier) require a Category 1 Medical Certificate. For pilots under 40, it is valid for 12 months. For pilots 40 and older, it must be renewed every 6 months. Transport Canada medical exams are conducted by designated Aviation Medical Examiners (AMEs).'
  },
  {
    q: 'When do I need an ECG for my medical?',
    a: 'Per the TC Category 1 medical standard, an ECG is required at the initial issuance of a Category 1 medical for pilots under 40, then every 24 months between the ages of 40 and 65, and annually once you turn 65. Cumulo lets you record your next ECG due date in Profile and will alert you in the dashboard 60 days before it expires.'
  },

  // ── Simulator ──────────────────────────────────────────────────────
  {
    q: 'Can I count simulator time toward my ATPL hours?',
    a: 'Yes, but with limits. Under CAR 401.73, a maximum of 25 hours of approved flight simulator time may be credited toward the 1,500-hour ATPL requirement (200 hours for multi-engine helicopter). The simulator must be approved by Transport Canada. All simulator time should be logged under the Simulator (SIM) column, not as flight time.'
  },
  {
    q: 'What are FFS, FTD, FNPT, and BITD?',
    a: 'These are simulator levels. FFS (Full Flight Simulator) is the highest fidelity — full motion, full cockpit. FTD (Flight Training Device) has no motion but a high-fidelity cockpit. FNPT (Flight & Navigation Procedures Trainer) is generic flight controls with realistic instruments. BITD (Basic Instrument Training Device) is the lowest level, often used for PPL/CPL instrument training. CAR 401.73 credit rules differ by device level — check with TC and your operator.'
  },

  // ── Privacy & compliance ──────────────────────────────────────────
  {
    q: 'How does Cumulo handle captain names from my roster?',
    a: 'Cumulo stores full captain names locally on your device — your logbook works exactly like a paper logbook (you see who you flew with). This is permitted under PIPEDA s.4(2)(b) and Loi 25 art. 1 (personal-use exception). Anonymization to initials (e.g. "M.D.") only happens when data leaves your device: cloud sync, shareable exports, JSON backups. TC PDF exports always include full names — required for ramp checks under CAR 401.08 and permitted under PIPEDA s.7(3)(c.1)(i) (regulatory disclosure). You control whether full names go to the cloud via Profile → "Keep full captain names when syncing or sharing" (default OFF = anonymize at egress). This was validated by a 4-expert panel (PIPEDA lawyer + Loi 25 lawyer + retired TC inspector + UX designer) on 2026-05-13.'
  },
  {
    q: 'How long must I keep my logbook records?',
    a: 'CAR 401.08(5) requires that a personal logbook be retained for at least 5 years after the date of the last entry. For ATPL holders submitting an experience claim, all relevant entries must be available to TC inspectors on request. Cumulo backs up your data in localStorage and (once Supabase is wired) in the cloud — but a periodic PDF export to your own files is still recommended as a paper trail.'
  },
  {
    q: 'What will a TC ramp inspector want to see in my logbook?',
    a: 'A TC inspector will check that your logbook is current, complete, and matches the format described in CAR 401.08 + TP 14052. Specifically: chronological entries with date, aircraft type, registration, departure/arrival, flight time, PIC/SIC time, night time, IFR time, simulator time clearly separated, cumulative totals, and pilot signature. Cumulo\'s PDF export is designed to match this format exactly, with a cover page that includes your name, license number, medical expiry, and a signature line.'
  },

  // ── Importing from other airlines ─────────────────────────────────
  {
    q: 'I don\'t fly for Porter — can I still import my roster?',
    a: 'Yes. Cumulo\'s automatic iCal sync is set up for Navblue (used by Porter), but pilots at other carriers can import via PDF roster (the PDF parser is multi-airline, supporting Jazz CrewTrac, WestJet Sabre, Air Canada AIMS, regional ops, etc.) or via CSV from your previous logbook software (5 native importers: ForeFlight, LogTen Pro, MyFlightbook, Logbook Pro, Safelog — plus a generic CSV column-mapper). Open the Import menu and pick whichever matches your source.'
  }
];

// AI "Ask a Question" feature removed — askQuestion() and renderQAHistory()
// previously lived here. See git history at commit aedca46 for the implementation.
// Re-introduce as a premium / authenticated feature once Cumulo has Supabase auth
// and bilingual EN/FR support.

function renderQA() {
  // FAQ accordion (static, no AI)
  const faqList = document.getElementById('faqList');
  if (faqList && !faqList.children.length) {
    faqList.innerHTML = FAQS.map((f, i) => `
      <div class="faq-item" id="faq-${i}">
        <div class="faq-q" onclick="toggleFaq(${i})">
          <span>${f.q}</span>
          <span class="faq-chevron">▼</span>
        </div>
        <div class="faq-a">${f.a}</div>
      </div>`).join('');
  }
}

function toggleFaq(i) {
  const el = document.getElementById('faq-' + i);
  if (el) el.classList.toggle('open');
}

// ═══════════════════════════════════════════
// FEATURE 11 — ELECTRONIC SIGNATURE
// ═══════════════════════════════════════════
let sigDrawing = false, sigCtx = null, sigCanvas = null;

function initSignature() {
  sigCanvas = document.getElementById('sigCanvas');
  if (!sigCanvas) return;
  sigCanvas.width = sigCanvas.offsetWidth || 600;
  sigCtx = sigCanvas.getContext('2d');
  sigCtx.strokeStyle = '#0f2044';
  sigCtx.lineWidth = 2.2;
  sigCtx.lineCap = 'round';
  sigCtx.lineJoin = 'round';

  // Load saved signature
  const saved = localStorage.getItem('logbook_signature');
  if (saved) {
    const img = new Image();
    img.onload = () => sigCtx.drawImage(img, 0, 0, sigCanvas.width, sigCanvas.height);
    img.src = saved;
    document.getElementById('sigStatus').textContent = '✓ Signature saved';
  }

  const getPos = e => {
    const r = sigCanvas.getBoundingClientRect();
    const scaleX = sigCanvas.width / r.width;
    const scaleY = sigCanvas.height / r.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * scaleX, y: (src.clientY - r.top) * scaleY };
  };

  sigCanvas.addEventListener('mousedown',  e => { sigDrawing=true; const p=getPos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x,p.y); });
  sigCanvas.addEventListener('mousemove',  e => { if(!sigDrawing) return; const p=getPos(e); sigCtx.lineTo(p.x,p.y); sigCtx.stroke(); });
  sigCanvas.addEventListener('mouseup',    () => sigDrawing=false);
  sigCanvas.addEventListener('mouseleave', () => sigDrawing=false);
  sigCanvas.addEventListener('touchstart', e => { e.preventDefault(); sigDrawing=true; const p=getPos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x,p.y); }, {passive:false});
  sigCanvas.addEventListener('touchmove',  e => { e.preventDefault(); if(!sigDrawing) return; const p=getPos(e); sigCtx.lineTo(p.x,p.y); sigCtx.stroke(); }, {passive:false});
  sigCanvas.addEventListener('touchend',   () => sigDrawing=false);
}

function clearSignature() {
  if (!sigCtx || !sigCanvas) return;
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  document.getElementById('sigStatus').textContent = '';
}

function saveSignature() {
  if (!sigCanvas) return;
  const data = sigCanvas.toDataURL('image/png');
  localStorage.setItem('logbook_signature', data);
  document.getElementById('sigStatus').textContent = '✓ Saved';
  showToast(t('toast.signatureSaved'), 'success');
}

// ═══════════════════════════════════════════
// FEATURE 10 — AVIATION GLOSSARY
// ═══════════════════════════════════════════
// Logbook-only glossary : acronyms a pilot will actually see in their logbook,
// in TC regulations (CAR / RAC), or in Cumulo's import filters.
// We exclude general aviation terms (ATC, ILS, VOR, etc.) — they belong in
// an aviation reference, not a logbook tool.
const GLOSSARY = [
  // Pilot positions & roles
  ['PIC',    'Pilot in Command — the captain; legally responsible for the flight'],
  ['SIC',    'Second in Command — co-pilot / first officer role'],
  ['F/O',    'First Officer — co-pilot, second in command'],
  ['PICUS',  'Pilot in Command Under Supervision — co-pilot acting as PIC under captain supervision (counts toward PIC time)'],
  ['Dual',   'Flight time under instruction from a flight instructor'],
  ['Solo',   'Flight time without an instructor (typically student pilot)'],

  // Time columns (CAR 401.08)
  ['Block Time', 'Time from chocks-out (engine start / brake release) to chocks-in. Synonym: Flight Time per CAR 101.01'],
  ['BLH',    'Block Hours — synonym for Block Time / Flight Time'],
  ['Air Time', 'Time from wheels-up to wheels-down. Used for aircraft maintenance, NOT for the pilot logbook'],
  ['Duty Time', 'Time on duty — typically check-in to check-out, broader than block time'],

  // Conditions (CAR 401.08(2)(d))
  ['Day',    'Daytime flight — sunrise to 30 min before sunset (varies by jurisdiction)'],
  ['Night',  'Per RAC 101.01 (Canada): from 30 min after sunset to 30 min before sunrise'],
  ['IFR',    'Instrument Flight Rules — flight conducted under instrument procedures'],
  ['VFR',    'Visual Flight Rules — flight by visual reference'],

  // Engine class (Standard 421)
  ['SE',     'Single-Engine — aircraft with one engine'],
  ['ME',     'Multi-Engine — aircraft with more than one engine'],

  // Cross-country
  ['XC',     'Cross-Country — flight to an aerodrome more than 25 NM (46.3 km) from the point of departure (CAR 401.34)'],

  // Instrument
  ['Inst Actual', 'Instrument time in actual IMC (clouds, low vis)'],
  ['Inst Hood',   'Instrument time under a view-limiting device (training)'],
  ['Inst Sim/FSTD', 'Instrument time in a Flight Simulation Training Device — logged SEPARATELY from flight time'],
  ['Approach', 'An instrument approach to landing or missed approach (counts toward CAR 401.05 IFR currency: 6 in 6 months)'],

  // Landings & currency
  ['LDG',    'Landing'],
  ['T/O',    'Take-off'],

  // Simulator
  ['SIM',    'Simulator session — does NOT count as block time, logged separately per CAR 401.08'],
  ['FFS',    'Full Flight Simulator — highest-fidelity (Level C/D) Approved Flight Simulator'],
  ['FTD',    'Flight Training Device — fixed-base sim, lower fidelity than FFS'],
  ['FNPT',   'Flight & Navigation Procedures Trainer — basic flight trainer'],
  ['PPC',    'Pilot Proficiency Check — annual/biannual proficiency test (CAR 421.05)'],
  ['IPC',    'Instrument Proficiency Check — restores expired IFR rating'],
  ['LOFT',   'Line Oriented Flight Training — full-flight scenario training in sim'],

  // Licences
  ['PPL',    'Private Pilot Licence'],
  ['CPL',    'Commercial Pilot Licence'],
  ['ATPL',   'Airline Transport Pilot Licence — highest pilot certificate in Canada'],

  // Reference timestamps used in iCal / rosters
  ['STD',    'Scheduled Time of Departure (planned block-off)'],
  ['STA',    'Scheduled Time of Arrival (planned block-on)'],
  ['ATD',    'Actual Time of Departure (real block-off)'],
  ['ATA',    'Actual Time of Arrival (real block-on)'],
  ['CI/CO',  'Check-In / Check-Out — duty-day start and end (broader than block)'],

  // Roster activity codes (Navblue) — what Cumulo filters out of imports
  ['DH',     'Deadhead — crew travelling as passenger to position to another base (not loggable as PIC/SIC)'],
  ['GD',     'Guaranteed Day Off (Porter/Navblue roster code)'],
  ['SDO',    'Scheduled Day Off (rest)'],
  ['HTL',    'Hotel / layover (roster code)'],
  ['REAX',   'Reassignable Reserve (roster code)'],
  ['VAC',    'Vacation'],
  ['PER',    'Personal Day'],

  // Aircraft / aerodrome identifiers
  ['ICAO',   '4-letter aerodrome identifier (e.g. CYOW, KBOS) used in flight plans and logbooks'],
  ['IATA',   '3-letter airport code (e.g. YOW, BOS) — common in tickets and Navblue rosters'],
  ['MTOW',   'Maximum Take-Off Weight (sometimes referenced for aircraft class)'],

  // Regulatory
  ['TC',     'Transport Canada — Canadian aviation regulatory authority'],
  ['CAR',    'Canadian Aviation Regulations (SOR/96-433) — primary aviation regulation in Canada'],
  ['RAC',    'Règlement de l\'aviation canadien — French name for the CAR'],
  ['CAR 401.05', 'Recency requirements (5 landings 90 days · 6 IFR approaches 6 months)'],
  ['CAR 401.08', 'Personal Log requirements (the 9 mandatory fields per flight)'],
  ['CAR 401.34', 'Cross-country definition (> 25 NM)'],
  ['Standard 421', 'Personnel Licensing Standards — categories of experience for licence applications'],
  ['CARS', 'Commercial Air Service Standards (CAR 700 series — operations like 705 airline)'],
  ['705',  'Subpart 705 — Airline Operations under the CARs'],
].sort((a,b) => a[0].localeCompare(b[0]));

let glossaryFilter = '';

function renderGlossary() {
  filterGlossary('');
  const s = document.getElementById('glossarySearch');
  if (s) s.value = '';
}

function filterGlossary(val) {
  glossaryFilter = val.toLowerCase();
  const list = GLOSSARY.filter(([abbr, def]) =>
    abbr.toLowerCase().includes(glossaryFilter) || def.toLowerCase().includes(glossaryFilter)
  );
  const el = document.getElementById('glossaryList');
  if (!el) return;
  el.innerHTML = list.length
    ? list.map(([abbr, def]) => `
        <div class="glossary-item">
          <div class="glossary-abbr">${abbr}</div>
          <div class="glossary-def">${def}</div>
        </div>`).join('')
    : '<p style="padding:20px;color:var(--text-muted);font-family:var(--font-mono);font-size:12px">No results found.</p>';
}

