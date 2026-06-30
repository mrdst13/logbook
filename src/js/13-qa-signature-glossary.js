// ═══════════════════════════════════════════
// FEATURE 12 — Q&A SECTION (bilingual EN + FR)
// ═══════════════════════════════════════════
// Static FAQ list. Each entry has q/a (English) and qFr/aFr (French).
// Aviation acronyms (PIC, F/O, ICAO, CAR, RAC, ATPL, IFR, IPC, FFS, NM, BLH,
// MCC, ICAO, etc.) are kept as-is in French prose — they are language-neutral
// in Canadian aviation usage. Only the prose around them is translated.
const FAQS = [
 // ── Currency & recency ────────────────────────────────────────────
 {
 q: 'How many landings do I need to stay current as PIC?',
 a: 'Under CAR 401.05(2), to act as PIC carrying passengers you need at least 5 take-offs and 5 landings in the same category and class within the preceding 6 months. For night currency under CAR 401.05(2), you need 5 take-offs and 5 landings at night within the preceding 6 months.',
 qFr: 'Combien d\'atterrissages me faut-il pour rester valide comme PIC ?',
 aFr: 'Selon RAC 401.05(2), pour agir comme PIC avec passagers, il vous faut au moins 5 décollages et 5 atterrissages dans la même catégorie et classe durant les 6 mois précédents. Pour la validité de nuit selon RAC 401.05(2), il vous faut 5 décollages et 5 atterrissages de nuit dans les 6 mois précédents.'
 },
 {
 q: 'What is IFR recency and how long is it valid?',
 a: 'Under CAR 401.05(3.1), to act as PIC under IFR you must, within the preceding 6 months, have acquired 6 hours of instrument time AND completed 6 instrument approaches — in actual or simulated IMC in an aircraft, or in an approved simulator. The 6 months is a rolling window — counted backward from the day you want to fly IFR.',
 qFr: 'Qu\'est-ce que la validité IFR et combien de temps est-elle bonne ?',
 aFr: 'Selon RAC 401.05(3.1), pour agir comme PIC en IFR, vous devez, dans les 6 mois précédents, avoir accumulé 6 heures de temps aux instruments ET effectué 6 approches aux instruments — en IMC réelle ou simulée en aéronef, ou en simulateur approuvé. La fenêtre de 6 mois est glissante — comptée à rebours à partir du jour où vous voulez voler en IFR.'
 },
 {
 q: 'What are the currency rules for helicopter pilots?',
 a: 'Helicopter currency under CAR 401.05 mirrors fixed-wing: 5 take-offs and 5 landings in the preceding 6 months in the same category and class to carry passengers, plus 5 night TO/LDG in 6 months for night currency. Helicopter operations may also require additional currency for external load (CAR 702.21) and autorotation training, depending on operator and class of operation.',
 qFr: 'Quelles sont les règles de validité pour les pilotes d\'hélicoptère ?',
 aFr: 'La validité hélicoptère selon RAC 401.05 est calquée sur l\'aile fixe : 5 décollages et 5 atterrissages dans les 6 mois précédents dans la même catégorie et classe pour porter des passagers, plus 5 T/O et LDG de nuit en 6 mois pour la validité de nuit. Les opérations hélicoptère peuvent aussi exiger une validité additionnelle pour charge externe (RAC 702.21) et entraînement à l\'autorotation, selon l\'opérateur et la classe d\'opération.'
 },
 {
 q: 'How often do I need to recur on type (PPC / IPC)?',
 a: 'Under CAR 705, air carrier operations require a valid Pilot Proficiency Check (PPC). Its validity expires on the first day of the 7th month after the check (about 6 months), and extends to the first day of the 13th month (about 12 months) if you complete the approved six-month recurrent training under the Commercial Air Service Standards (CAR 705.113). Some operations may differ — your operator\'s approved training program governs. CAR 605.97 covers general IPC requirements. Many 705 operators check both during the same recurrent training event. Log every PPC / IPC in the Simulator section with the appropriate Session Type tag.',
 qFr: 'À quelle fréquence dois-je faire mon PPC / IPC sur type ?',
 aFr: 'Selon RAC 705, les opérations de transporteur aérien exigent un PPC (Pilot Proficiency Check) valide. Sa validité expire le 1er jour du 7e mois suivant le contrôle (environ 6 mois), et s\'étend au 1er jour du 13e mois (environ 12 mois) si vous complétez la formation périodique semestrielle approuvée selon les Normes de service aérien commercial (RAC 705.113). Certaines exploitations peuvent différer — le programme de formation approuvé de votre exploitant fait foi. RAC 605.97 couvre les exigences IPC générales. Plusieurs exploitants 705 effectuent les deux pendant le même entraînement récurrent. Enregistrez chaque PPC / IPC dans la section Simulateur avec le bon Session Type.'
 },

 // ── Logging conventions ───────────────────────────────────────────
 {
 q: 'How do I count block time vs. flight time?',
 a: 'Block time (BLH) starts when the aircraft moves under its own power (chocks out / brakes released) and ends when it comes to rest at the gate (chocks in). Flight time starts at first movement for takeoff and ends at landing rollout. For airline operations, Transport Canada generally accepts block time for logbook purposes under CAR 401.08.',
 qFr: 'Comment compter le block time vs. flight time ?',
 aFr: 'Le block time (BLH) commence quand l\'aéronef bouge sous sa propre puissance (chocks out / freins relâchés) et se termine quand il s\'immobilise au stationnement (chocks in). Le flight time commence au premier mouvement pour décollage et se termine à la fin du roulage d\'atterrissage. Pour les opérations de transporteur aérien, Transports Canada accepte généralement le block time pour le carnet selon RAC 401.08.'
 },
 {
 q: 'What is PICUS and when can I log it?',
 a: 'PICUS (Pilot in Command Under Supervision) is time logged by a co-pilot (F/O) when acting in the role of PIC under the supervision of a qualified captain. In Canada, this is recognized under CAR 401.08 and can be credited toward ATPL minimums. You may log PICUS only when you are the actual decision-maker for the flight under direct supervision.',
 qFr: 'Qu\'est-ce que le PICUS et quand puis-je l\'enregistrer ?',
 aFr: 'PICUS (Pilot in Command Under Supervision) est du temps enregistré par un copilote (F/O) quand il agit dans le rôle de PIC sous la supervision d\'un commandant qualifié. Au Canada, c\'est reconnu selon RAC 401.08 et peut être crédité vers les minimums ATPL. Vous ne pouvez enregistrer du PICUS que si vous êtes le décideur réel du vol sous supervision directe.'
 },
 {
 q: 'What counts as "cross-country" time?',
 a: 'CAR 101.01 defines cross-country (XC) flight time as time on a flight to a point at least 25 nautical miles from the point of departure. Cumulo automatically credits XC time when both departure and arrival ICAO codes are known and the great-circle distance is at least 25 NM. Shorter hops (under 25 NM) are correctly NOT credited as XC, even if they cross other airports en route.',
 qFr: 'Qu\'est-ce qui compte comme temps « vol-voyage » (XC) ?',
 aFr: 'RAC 101.01 définit le temps de vol en voyage (XC) comme le temps sur un vol vers un point à au moins 25 milles nautiques du point de départ. Cumulo crédite automatiquement le temps XC quand les codes ICAO de départ et d\'arrivée sont connus et que la distance orthodromique est d\'au moins 25 NM. Les vols plus courts (moins de 25 NM) ne sont correctement PAS crédités comme XC, même s\'ils survolent d\'autres aéroports en route.'
 },
 {
 q: 'How do I log Multi-Crew time (MCC) for ATPL submission?',
 a: 'Multi-Crew time is flight time on aircraft that are certified for and operated with a minimum crew of two pilots (Q400, E195, A320, B737, etc.). For ATPL submission, multi-crew time is tracked as a separate credit — refer to the ATPL experience requirements in Standard 421 and Transport Canada\'s guidance. Cumulo automatically flags multi_crew = true on any flight where you logged both PIC and SIC hours on the same leg, or imported from a 705-operator roster.',
 qFr: 'Comment enregistrer le temps Multi-Crew (MCC) pour la soumission ATPL ?',
 aFr: 'Le Multi-Crew time est du temps de vol sur des aéronefs certifiés et opérés avec un équipage minimal de deux pilotes (Q400, E195, A320, B737, etc.). Pour la soumission ATPL, le temps multi-équipage est suivi comme un crédit séparé — référez-vous aux exigences d\'expérience ATPL du Standard 421 et aux directives de Transports Canada. Cumulo marque automatiquement multi_crew = true sur tout vol où vous avez enregistré à la fois des heures PIC et SIC sur le même segment, ou importé depuis un horaire d\'exploitant 705.'
 },
 {
 q: 'How is Dual Given time credited for an instructor ATPL?',
 a: 'A flight instructor may count dual-given time toward the experience required for the ATPL, within the limits set out in Standard 421 — refer to it (and Transport Canada) for the current hour limits that apply to instruction time. Cumulo tracks Dual Given Day + Dual Given Night separately; the PDF cover page now shows a cumulative Dual Given total when you have any hours in those columns.',
 qFr: 'Comment le Dual Given est-il crédité pour un ATPL d\'instructeur ?',
 aFr: 'Un instructeur de vol peut compter le temps dual-given vers l\'expérience requise pour l\'ATPL, dans les limites prévues au Standard 421 — référez-vous-y (et à Transports Canada) pour les limites d\'heures en vigueur applicables au temps d\'instruction. Cumulo suit Dual Given Day + Dual Given Night séparément ; la page couverture du PDF montre maintenant un total cumulatif Dual Given quand vous avez des heures dans ces colonnes.'
 },

 // ── Medical & licensing ────────────────────────────────────────────
 {
 q: 'What medical class do airline pilots need and how often must I renew?',
 a: 'ATPL holders operating under CAR 705 (air carrier) require a Category 1 Medical Certificate. Under CAR 404.04, a Category 1 is valid for 12 months, reduced to 6 months once you turn 60 — or at 40 and older if you fly single-pilot with passengers. Age is assessed at the date of the exam. Transport Canada medical exams are conducted by designated Aviation Medical Examiners (AMEs).',
 qFr: 'Quelle catégorie médicale est requise pour un pilote de ligne et à quelle fréquence renouveler ?',
 aFr: 'Les titulaires d\'ATPL opérant selon RAC 705 (transporteur aérien) doivent détenir un Certificat médical de Catégorie 1. Selon RAC 404.04, un Catégorie 1 est valide 12 mois, réduit à 6 mois dès 60 ans — ou à 40 ans et plus si vous volez en monopilote avec passagers. L\'âge est évalué à la date de l\'examen. Les examens médicaux de Transports Canada sont effectués par des médecins-examinateurs de l\'aviation civile (MEAC).'
 },
 {
 q: 'When do I need an ECG for my medical?',
 a: 'An ECG is part of the Transport Canada Category 1 medical standard, and how often you need one is age-related and set by that standard — your Civil Aviation Medical Examiner (CAME) will tell you when your next ECG is due. Cumulo lets you record that due date in Profile and will alert you in the dashboard 60 days before it expires.',
 qFr: 'Quand ai-je besoin d\'un ECG pour mon médical ?',
 aFr: 'Un ECG fait partie de la norme médicale de Catégorie 1 de Transports Canada, et sa fréquence dépend de l\'âge et est fixée par cette norme — votre médecin-examinateur de l\'aviation civile (MEAC) vous indiquera la date de votre prochain ECG. Cumulo permet d\'enregistrer cette date d\'échéance dans Profile et vous avertit sur le tableau de bord 60 jours avant l\'expiration.'
 },

 // ── Simulator ──────────────────────────────────────────────────────
 {
 q: 'Can I count simulator time toward my ATPL hours?',
 a: 'Yes, but with limits. Approved flight simulator time may be credited toward the ATPL experience requirement, up to a maximum set out in Standard 421 — refer to it (and Transport Canada) for the current limits, which differ for aeroplanes and helicopters. The simulator must be approved by Transport Canada. All simulator time should be logged under the Simulator (SIM) column, not as flight time.',
 qFr: 'Puis-je compter le temps simulateur vers mes heures ATPL ?',
 aFr: 'Oui, avec des limites. Le temps de simulateur de vol approuvé peut être crédité vers l\'exigence d\'expérience ATPL, jusqu\'à un maximum prévu au Standard 421 — référez-vous-y (et à Transports Canada) pour les limites en vigueur, qui diffèrent pour les avions et les hélicoptères. Le simulateur doit être approuvé par Transports Canada. Tout le temps simulateur doit être enregistré sous la colonne Simulateur (SIM), pas comme temps de vol.'
 },
 {
 q: 'What are FFS, FTD, FNPT, and BITD?',
 a: 'These are simulator levels. FFS (Full Flight Simulator) is the highest fidelity — full motion, full cockpit. FTD (Flight Training Device) has no motion but a high-fidelity cockpit. FNPT (Flight & Navigation Procedures Trainer) is generic flight controls with realistic instruments. BITD (Basic Instrument Training Device) is the lowest level, often used for PPL/CPL instrument training. Simulator credit rules differ by device level — check with Transport Canada and your operator.',
 qFr: 'C\'est quoi FFS, FTD, FNPT et BITD ?',
 aFr: 'Ce sont des niveaux de simulateur. FFS (Full Flight Simulator) est la plus haute fidélité — mouvement complet, cockpit complet. FTD (Flight Training Device) n\'a pas de mouvement mais un cockpit haute fidélité. FNPT (Flight & Navigation Procedures Trainer) a des commandes de vol génériques avec des instruments réalistes. BITD (Basic Instrument Training Device) est le niveau le plus bas, souvent utilisé pour l\'entraînement aux instruments PPL/CPL. Les règles de crédit diffèrent par niveau de dispositif — vérifiez avec Transports Canada et votre exploitant.'
 },

 // ── Privacy & compliance ──────────────────────────────────────────
 {
 q: 'How does Cumulo handle the OTHER pilot\'s name (captain or F/O)?',
 a: 'The rule is symmetric — whether you\'re F/O (the captain is the third party) or you\'re PIC (the F/O is the third party), the OTHER pilot is treated identically. Cumulo stores full names locally on your device — your logbook works exactly like a paper logbook (PIPEDA s.4(2)(b) and Loi 25 art. 1 personal-use exceptions). Anonymization to initials (e.g. "M.D.") only happens when data leaves your device: cloud sync, shareable exports, JSON backups. TC PDF exports always include full names — required for ramp checks under CAR 401.08 and permitted under PIPEDA s.7(3)(c.1)(i). Self-references (your own name, or the literal text "self" / "moi" — which TP 14052 explicitly accepts) are NEVER anonymized: they are not third-party data. Control via Profile → "Keep full crew names when syncing or sharing" (default OFF).',
 qFr: 'Comment Cumulo gère-t-il le nom de l\'AUTRE pilote (commandant ou F/O) ?',
 aFr: 'La règle est symétrique — que vous soyez F/O (le commandant est le tiers) ou PIC (le F/O est le tiers), l\'AUTRE pilote est traité identiquement. Cumulo stocke les noms complets localement sur votre appareil — votre carnet fonctionne exactement comme un carnet papier (LPRPDE art. 4(2)b) et Loi 25 art. 1 exceptions d\'usage personnel). L\'anonymisation en initiales (ex. « M.D. ») arrive seulement quand les données quittent votre appareil : synchro infonuagique, exports partageables, backups JSON. Les exports PDF pour TC contiennent toujours les noms complets — requis pour les contrôles au sol selon RAC 401.08 et permis selon LPRPDE art. 7(3)c.1)(i). Les auto-références (votre propre nom, ou le mot « self » / « moi » — que TP 14052 accepte explicitement) ne sont JAMAIS anonymisées : ce ne sont pas des données de tiers. Contrôle via Profile → « Keep full crew names when syncing or sharing » (par défaut OFF).'
 },
 {
 q: 'Does iCal auto-sync capture crew names, or do I have to upload a PDF?',
 a: 'The iCal sync attempts to extract crew names (whoever flew the other seat with you — captain if you\'re F/O, F/O if you\'re captain) directly from the DESCRIPTION field of each VEVENT — no separate PDF upload required. Whether crew names actually appear depends on what your airline includes in its iCal feed: some carriers include the full crew list in the description, others ship the iCal stripped down. After the first sync, check your Logbook page: if the PIC / Co-pilot columns show names for recent flights, the iCal feed contains them. If they\'re empty, fall back to the monthly PDF roster import (Import → a monthly PDF schedule).',
 qFr: 'La synchro iCal capture-t-elle les noms d\'équipage, ou dois-je téléverser un PDF ?',
 aFr: 'La synchro iCal tente d\'extraire les noms d\'équipage (qui que ce soit dans l\'autre siège — commandant si vous êtes F/O, F/O si vous êtes commandant) directement du champ DESCRIPTION de chaque VEVENT — pas besoin de téléversement PDF séparé. Que les noms apparaissent ou non dépend de ce que votre compagnie inclut dans son flux iCal : certains transporteurs incluent toute la liste d\'équipage dans la description, d\'autres envoient l\'iCal dépouillé. Après la première synchro, vérifiez votre page Logbook : si les colonnes PIC / Co-pilote montrent des noms pour les vols récents, le flux iCal les contient. Sinon, utilisez l\'import mensuel du PDF d\'horaire (Importer → un horaire PDF mensuel).'
 },
 {
 q: 'How long must I keep my logbook records?',
 a: 'CAR 401.08(5) requires that a personal logbook be retained for at least 5 years after the date of the last entry. For ATPL holders submitting an experience claim, all relevant entries must be available to TC inspectors on request. Cumulo backs up your data in localStorage and (once Supabase is wired) in the cloud — but a periodic PDF export to your own files is still recommended as a paper trail.',
 qFr: 'Combien de temps dois-je conserver mes enregistrements de carnet ?',
 aFr: 'RAC 401.08(5) exige qu\'un carnet personnel soit conservé au moins 5 ans après la date de la dernière entrée. Pour les titulaires d\'ATPL qui soumettent une demande d\'expérience, toutes les entrées pertinentes doivent être disponibles aux inspecteurs TC sur demande. Cumulo sauvegarde vos données dans localStorage et (une fois Supabase câblé) dans l\'infonuagique — mais un export PDF périodique vers vos propres fichiers reste recommandé comme trace papier.'
 },
 {
 q: 'What will a TC ramp inspector want to see in my logbook?',
 a: 'A TC inspector will check that your logbook is current, complete, and matches the format described in CAR 401.08 + TP 14052. Specifically: chronological entries with date, aircraft type, registration, departure/arrival, flight time, PIC/SIC time, night time, IFR time, simulator time clearly separated, cumulative totals, and pilot signature. Cumulo\'s PDF export is designed to match this format exactly, with a cover page that includes your name, license number, medical expiry, and a signature line.',
 qFr: 'Qu\'est-ce qu\'un inspecteur TC au sol va vouloir voir dans mon carnet ?',
 aFr: 'Un inspecteur TC vérifiera que votre carnet est à jour, complet, et correspond au format décrit dans RAC 401.08 + TP 14052. Spécifiquement : entrées chronologiques avec date, type d\'aéronef, immatriculation, départ/arrivée, temps de vol, temps PIC/SIC, temps de nuit, temps IFR, temps simulateur clairement séparé, totaux cumulatifs, et signature du pilote. L\'export PDF de Cumulo est conçu pour correspondre exactement à ce format, avec une page couverture qui inclut votre nom, numéro de licence, expiration médicale, et une ligne de signature.'
 },

 // ── Importing from other airlines ─────────────────────────────────
 {
 q: 'My airline\'s roster isn\'t auto-detected — can I still import?',
 a: 'Yes — you\'re never blocked. iCal auto-sync works with any airline that publishes a webcal:// roster feed, and the monthly PDF roster reader currently handles one airline format. If yours isn\'t auto-detected, two self-serve paths cover every case: (1) import a CSV from your previous logbook — 5 built-in parsers (ForeFlight, LogTen Pro, MyFlightbook, Logbook Pro, Safelog) plus a column-mapping wizard that reads any other CSV; (2) log flights manually with auto-complete on aircraft type and crew names. We add new formats over time.',
 qFr: 'L’horaire de ma compagnie n’est pas détecté automatiquement — puis-je quand même l’importer ?',
 aFr: 'Oui — vous n’êtes jamais bloqué. La synchro iCal automatique fonctionne avec toute compagnie qui publie un flux d’horaire webcal://, et le lecteur de PDF mensuel prend en charge un format de compagnie pour l’instant. Si votre compagnie n’est pas détectée automatiquement, vous avez deux options : (1) importer un CSV exporté depuis votre ancien logiciel de carnet — 5 parseurs natifs (ForeFlight, LogTen Pro, MyFlightbook, Logbook Pro, Safelog) plus un assistant de correspondance de colonnes pour tout autre CSV ; (2) saisir vos vols manuellement avec auto-complétion du type d’aéronef et des noms d’équipage. Nous ajoutons de nouveaux formats au fil du temps.'
 }
];

// AI "Ask a Question" feature removed — askQuestion() and renderQAHistory()
// previously lived here. See git history at commit aedca46 for the implementation.
// Re-introduce as a premium / authenticated feature once Cumulo has Supabase auth
// and bilingual EN/FR support.

let faqFilter = '';

function renderQA() {
 const s = document.getElementById('faqSearch');
 if (s) s.value = '';
 faqFilter = '';
 _renderFaqList();
}

function filterFaq(val) {
 faqFilter = (val || '').toLowerCase();
 _renderFaqList();
}

function _renderFaqList() {
 const faqList = document.getElementById('faqList');
 if (!faqList) return;
 const isFr = (typeof getLang === 'function') && getLang() === 'fr';
 const filtered = FAQS.map((f, i) => ({ f, i })).filter(({ f }) => {
   if (!faqFilter) return true;
   const q = isFr && f.qFr ? f.qFr : f.q;
   const a = isFr && f.aFr ? f.aFr : f.a;
   return (q + ' ' + a).toLowerCase().includes(faqFilter);
 });
 if (!filtered.length) {
   const noResults = isFr ? 'Aucune question trouvée.' : 'No questions found.';
   faqList.innerHTML = `<div class="faq-item"><div class="faq-q"><span style="color:var(--text-muted)">${noResults}</span></div></div>`;
   return;
 }
 faqList.innerHTML = filtered.map(({ f, i }) => {
   const q = isFr && f.qFr ? f.qFr : f.q;
   const a = isFr && f.aFr ? f.aFr : f.a;
   return `
   <div class="faq-item" id="faq-${i}">
   <div class="faq-q" onclick="toggleFaq(${i})">
   <span>${q}</span>
   <span class="faq-chevron">▼</span>
   </div>
   <div class="faq-a">${a}</div>
   </div>`;
 }).join('');
}

function toggleFaq(i) {
 const el = document.getElementById('faq-' + i);
 if (el) el.classList.toggle('open');
}

// ═══════════════════════════════════════════
// FEATURE 11 — ELECTRONIC SIGNATURE
// ═══════════════════════════════════════════
let sigDrawing = false, sigCtx = null, sigCanvas = null;

function _sizeSignatureCanvas() {
 if (!sigCanvas) return;
 const w = sigCanvas.offsetWidth || 600;
 // Preserve the existing stroke if there is one (resize would otherwise wipe it).
 const previous = sigCanvas.width && sigCanvas.height
   ? sigCanvas.toDataURL('image/png')
   : null;
 sigCanvas.width = w;
 sigCanvas.height = Math.round(w * 0.28);  // ~3.5:1 aspect — fits signature without distorting strokes
 if (sigCtx) {
   sigCtx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#0f2044';
   sigCtx.lineWidth = 2.2;
   sigCtx.lineCap = 'round';
   sigCtx.lineJoin = 'round';
 }
 if (previous) {
   const img = new Image();
   img.onload = () => { try { sigCtx.drawImage(img, 0, 0, sigCanvas.width, sigCanvas.height); } catch {} };
   img.src = previous;
 }
}

function initSignature() {
 sigCanvas = document.getElementById('sigCanvas');
 if (!sigCanvas) return;
 sigCtx = sigCanvas.getContext('2d');
 _sizeSignatureCanvas();
 // Re-size on orientation change or window resize so the strokes don't distort
 // when an iPad rotates between portrait/landscape on the flight deck.
 if (!window._sigResizeBound) {
   window._sigResizeBound = true;
   window.addEventListener('resize', () => { _sizeSignatureCanvas(); });
   window.addEventListener('orientationchange', () => { setTimeout(_sizeSignatureCanvas, 100); });
 }

 // Load saved signature
 const saved = localStorage.getItem('logbook_signature');
 if (saved) {
 const img = new Image();
 img.onload = () => sigCtx.drawImage(img, 0, 0, sigCanvas.width, sigCanvas.height);
 img.src = saved;
 document.getElementById('sigStatus').textContent = (typeof t === 'function') ? t('sig.statusLoaded') : 'Signature saved.';
 }

 const getPos = e => {
 const r = sigCanvas.getBoundingClientRect();
 const scaleX = sigCanvas.width / r.width;
 const scaleY = sigCanvas.height / r.height;
 const src = e.touches ? e.touches[0] : e;
 return { x: (src.clientX - r.left) * scaleX, y: (src.clientY - r.top) * scaleY };
 };

 sigCanvas.addEventListener('mousedown', e => { sigDrawing=true; const p=getPos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x,p.y); });
 sigCanvas.addEventListener('mousemove', e => { if(!sigDrawing) return; const p=getPos(e); sigCtx.lineTo(p.x,p.y); sigCtx.stroke(); });
 sigCanvas.addEventListener('mouseup', () => sigDrawing=false);
 sigCanvas.addEventListener('mouseleave', () => sigDrawing=false);
 sigCanvas.addEventListener('touchstart', e => { e.preventDefault(); sigDrawing=true; const p=getPos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x,p.y); }, {passive:false});
 sigCanvas.addEventListener('touchmove', e => { e.preventDefault(); if(!sigDrawing) return; const p=getPos(e); sigCtx.lineTo(p.x,p.y); sigCtx.stroke(); }, {passive:false});
 sigCanvas.addEventListener('touchend', () => sigDrawing=false);
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
 document.getElementById('sigStatus').textContent = (typeof t === 'function') ? t('sig.statusJustSaved') : 'Saved.';
 showToast(t('toast.signatureSaved'), 'success');
}

// ═══════════════════════════════════════════
// FEATURE 10 — AVIATION GLOSSARY (bilingual EN + FR)
// ═══════════════════════════════════════════
// Logbook-only glossary : acronyms a pilot will actually see in their logbook,
// in TC regulations (CAR / RAC), or in Cumulo's import filters.
// Each entry: [abbr, defEn, defFr]. The abbr stays language-neutral (it's an
// acronym in both languages); only the definition is translated.
const GLOSSARY = [
 // Pilot positions & roles
 ['PIC', 'Pilot in Command — the captain; legally responsible for the flight', 'Commandant de bord — légalement responsable du vol'],
 ['SIC', 'Second in Command — co-pilot / first officer role', 'Second au commandement — rôle de copilote / premier officier'],
 ['F/O', 'First Officer — co-pilot, second in command', 'Premier officier — copilote, second au commandement'],
 ['PICUS', 'Pilot in Command Under Supervision — co-pilot acting as PIC under captain supervision (counts toward PIC time)', 'Pilot in Command Under Supervision — copilote agissant comme PIC sous supervision du commandant (compte vers le temps PIC)'],
 ['Dual', 'Flight time under instruction from a flight instructor', 'Temps de vol sous instruction d\'un instructeur'],
 ['Solo', 'Flight time without an instructor (typically student pilot)', 'Temps de vol sans instructeur (typiquement pilote en formation)'],

 // Time columns (CAR 401.08)
 ['Block Time', 'Time from chocks-out (engine start / brake release) to chocks-in. Transport Canada generally accepts block time for logbook flight time under CAR 401.08.', 'Temps de chocks-out (démarrage / freins relâchés) à chocks-in. Transports Canada accepte généralement le block time comme temps de vol au carnet selon le RAC 401.08.'],
 ['BLH', 'Block Hours — synonym for Block Time / Flight Time', 'Block Hours — synonyme de Block Time / temps de vol'],
 ['Air Time', 'Time from wheels-up to wheels-down. Used for aircraft maintenance, NOT for the pilot logbook', 'Temps de wheels-up à wheels-down. Utilisé pour la maintenance, PAS pour le carnet du pilote'],
 ['Duty Time', 'Time on duty — typically check-in to check-out, broader than block time', 'Temps en service — typiquement check-in à check-out, plus large que le block time'],

 // Conditions (CAR 401.08(2)(d))
 ['Day', 'Per CAR 101.01 (Canada): from the beginning of morning civil twilight to the end of evening civil twilight', 'Selon le RAC 101.01 (Canada) : du début du crépuscule civil du matin à la fin du crépuscule civil du soir'],
 ['Night', 'Per CAR 101.01 (Canada): from the end of evening civil twilight to the beginning of morning civil twilight', 'Selon le RAC 101.01 (Canada) : de la fin du crépuscule civil du soir au début du crépuscule civil du matin'],
 ['IFR', 'Instrument Flight Rules — flight conducted under instrument procedures', 'Instrument Flight Rules — vol selon les procédures aux instruments'],
 ['VFR', 'Visual Flight Rules — flight by visual reference', 'Visual Flight Rules — vol selon les références visuelles'],

 // Engine class (Standard 421)
 ['SE', 'Single-Engine — aircraft with one engine', 'Monomoteur — aéronef à un moteur'],
 ['ME', 'Multi-Engine — aircraft with more than one engine', 'Multimoteur — aéronef à plus d\'un moteur'],

 // Cross-country
 ['XC', 'Cross-Country — flight to a point at least 25 NM (46.3 km) from the point of departure (CAR 101.01)', 'Vol-voyage — vol vers un point à au moins 25 NM (46,3 km) du point de départ (RAC 101.01)'],

 // Instrument
 ['Inst Actual', 'Instrument time in actual IMC (clouds, low vis)', 'Temps aux instruments en IMC réel (nuages, faible visibilité)'],
 ['Inst Hood', 'Instrument time under a view-limiting device (training)', 'Temps aux instruments sous dispositif limitant la vue (entraînement)'],
 ['Inst Sim/FSTD', 'Instrument time in a Flight Simulation Training Device — logged SEPARATELY from flight time', 'Temps aux instruments dans un Flight Simulation Training Device — enregistré SÉPARÉMENT du temps de vol'],
 ['Approach', 'An instrument approach to landing or missed approach (counts toward CAR 401.05 IFR currency: 6 in 6 months)', 'Une approche aux instruments à l\'atterrissage ou approche manquée (compte vers la validité IFR RAC 401.05 : 6 en 6 mois)'],

 // Landings & currency
 ['LDG', 'Landing', 'Atterrissage'],
 ['T/O', 'Take-off', 'Décollage'],

 // Simulator
 ['SIM', 'Simulator session — does NOT count as block time, logged separately per CAR 401.08', 'Session de simulateur — ne compte PAS comme block time, enregistré séparément selon RAC 401.08'],
 ['FFS', 'Full Flight Simulator — highest-fidelity (Level C/D) Approved Flight Simulator', 'Full Flight Simulator — simulateur approuvé haute fidélité (Niveau C/D)'],
 ['FTD', 'Flight Training Device — fixed-base sim, lower fidelity than FFS', 'Flight Training Device — sim à base fixe, fidélité inférieure au FFS'],
 ['FNPT', 'Flight & Navigation Procedures Trainer — basic flight trainer', 'Flight & Navigation Procedures Trainer — entraîneur de vol de base'],
 ['PPC', 'Pilot Proficiency Check — recurrent type proficiency test (CAR 705; validity ~6 months, extends to ~12 with approved recurrent training — CAR 705.113)', 'Pilot Proficiency Check — test de compétence récurrent sur type (RAC 705; validité ~6 mois, prolongée à ~12 avec formation périodique approuvée — RAC 705.113)'],
 ['IPC', 'Instrument Proficiency Check — restores expired IFR rating', 'Instrument Proficiency Check — restaure une qualification IFR expirée'],
 ['LOFT', 'Line Oriented Flight Training — full-flight scenario training in sim', 'Line Oriented Flight Training — entraînement de scénario en simulateur'],

 // Licences
 ['PPL', 'Private Pilot Licence', 'Licence de pilote privé'],
 ['CPL', 'Commercial Pilot Licence', 'Licence de pilote professionnel'],
 ['ATPL', 'Airline Transport Pilot Licence — highest pilot certificate in Canada', 'Airline Transport Pilot Licence — plus haut certificat de pilote au Canada'],

 // Reference timestamps used in iCal / rosters
 ['STD', 'Scheduled Time of Departure (planned block-off)', 'Heure prévue de départ (block-off planifié)'],
 ['STA', 'Scheduled Time of Arrival (planned block-on)', 'Heure prévue d\'arrivée (block-on planifié)'],
 ['ATD', 'Actual Time of Departure (real block-off)', 'Heure réelle de départ (block-off réel)'],
 ['ATA', 'Actual Time of Arrival (real block-on)', 'Heure réelle d\'arrivée (block-on réel)'],
 ['CI/CO', 'Check-In / Check-Out — duty-day start and end (broader than block)', 'Check-In / Check-Out — début et fin de la journée de service (plus large que le block)'],

 // Roster activity codes (Navblue) — what Cumulo filters out of imports
 ['DH', 'Deadhead — crew travelling as passenger to position to another base (not loggable as PIC/SIC)', 'Deadhead — équipage voyageant comme passager pour repositionner vers une autre base (non enregistrable comme PIC/SIC)'],
 ['GD', 'Guaranteed Day Off (roster code)', 'Guaranteed Day Off (code d’horaire)'],
 ['SDO', 'Scheduled Day Off (rest)', 'Jour de repos planifié'],
 ['HTL', 'Hotel / layover (roster code)', 'Hôtel / escale (code horaire)'],
 ['REAX', 'Reassignable Reserve (roster code)', 'Réserve réassignable (code horaire)'],
 ['VAC', 'Vacation', 'Vacances'],
 ['PER', 'Personal Day', 'Journée personnelle'],

 // Aircraft / aerodrome identifiers
 ['ICAO', '4-letter aerodrome identifier (e.g. CYOW, KBOS) used in flight plans and logbooks', 'Code aérodrome 4-lettres (ex. CYOW, KBOS) utilisé dans les plans de vol et carnets'],
 ['IATA', '3-letter airport code (e.g. YOW, BOS)', 'Code aéroport à 3 lettres (ex. YOW, BOS)'],
 ['MTOW', 'Maximum Take-Off Weight (sometimes referenced for aircraft class)', 'Maximum Take-Off Weight — masse maximale au décollage (référencée pour la classe d\'aéronef)'],

 // Regulatory
 ['TC', 'Transport Canada — Canadian aviation regulatory authority', 'Transports Canada — autorité de réglementation de l\'aviation canadienne'],
 ['CAR', 'Canadian Aviation Regulations (SOR/96-433) — primary aviation regulation in Canada', 'Canadian Aviation Regulations (DORS/96-433) — réglementation aérienne principale au Canada'],
 ['RAC', 'Règlement de l\'aviation canadien — French name for the CAR', 'Règlement de l\'aviation canadien — nom français des CAR'],
 ['CAR 401.05', 'Recency requirements (5 take-offs/landings · 6 months; IFR: 6 approaches + 6h instrument · 6 months)', 'Exigences de validité (5 décollages/atterrissages · 6 mois; IFR : 6 approches + 6 h aux instruments · 6 mois)'],
 ['CAR 401.08', 'Personal Log requirements (the 9 mandatory fields per flight)', 'Exigences du carnet personnel (les 9 champs obligatoires par vol)'],
 ['CAR 101.01', 'Definitions — including cross-country flight time (a point at least 25 NM from departure) and day/night', 'Définitions — dont le temps de vol en voyage (un point à au moins 25 NM du départ) et jour/nuit'],
 ['Standard 421', 'Personnel Licensing Standards — categories of experience for licence applications', 'Normes de délivrance des licences du personnel — catégories d\'expérience pour les demandes de licence'],
 ['CARS', 'Commercial Air Service Standards (CAR 700 series — operations like 705 airline)', 'Normes de service aérien commercial (série RAC 700 — opérations comme 705 transporteur aérien)'],
 ['705', 'Subpart 705 — Airline Operations under the CARs', 'Sous-partie 705 — Opérations de transporteur aérien selon les RAC'],
].sort((a,b) => a[0].localeCompare(b[0]));

let glossaryFilter = '';

function renderGlossary() {
 filterGlossary('');
 const s = document.getElementById('glossarySearch');
 if (s) s.value = '';
}

function filterGlossary(val) {
 glossaryFilter = (val || '').toLowerCase();
 const isFr = (typeof getLang === 'function') && getLang() === 'fr';
 const list = GLOSSARY.filter(([abbr, defEn, defFr]) => {
   const def = isFr && defFr ? defFr : defEn;
   return abbr.toLowerCase().includes(glossaryFilter) || def.toLowerCase().includes(glossaryFilter);
 });
 const el = document.getElementById('glossaryList');
 if (!el) return;
 const noResults = isFr ? 'Aucun résultat.' : 'No results found.';
 el.innerHTML = list.length
 ? list.map(([abbr, defEn, defFr]) => {
     const def = isFr && defFr ? defFr : defEn;
     return `
     <div class="glossary-item">
     <div class="glossary-abbr">${abbr}</div>
     <div class="glossary-def">${def}</div>
     </div>`;
   }).join('')
 : `<p style="padding:20px;color:var(--text-muted);font-family:var(--font-mono);font-size:12px">${noResults}</p>`;
}
