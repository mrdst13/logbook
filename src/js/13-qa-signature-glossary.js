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
 a: 'Under CAR 401.05(2), to act as PIC carrying passengers you need at least 5 take-offs and 5 landings in the same category and class within the preceding 6 months. For night currency under CAR 401.05(3), you need 5 take-offs and 5 landings at night within the preceding 6 months.',
 qFr: 'Combien d\'atterrissages me faut-il pour rester valide comme PIC ?',
 aFr: 'Selon CAR 401.05(2), pour agir comme PIC avec passagers, il vous faut au moins 5 décollages et 5 atterrissages dans la même catégorie et classe durant les 6 mois précédents. Pour la validité de nuit selon CAR 401.05(3), il vous faut 5 décollages et 5 atterrissages de nuit dans les 6 mois précédents.'
 },
 {
 q: 'What is IFR recency and how long is it valid?',
 a: 'Under CAR 401.05(5), to act as PIC under IFR you must have completed at least 6 instrument approaches in the preceding 6 months, either in an aircraft or approved simulator. The 6 months is a rolling window — counted backward from the day you want to fly IFR.',
 qFr: 'Qu\'est-ce que la validité IFR et combien de temps est-elle bonne ?',
 aFr: 'Selon CAR 401.05(5), pour agir comme PIC en IFR, vous devez avoir effectué au moins 6 approches aux instruments dans les 6 mois précédents, en aéronef ou en simulateur approuvé. La fenêtre de 6 mois est glissante — comptée à rebours à partir du jour où vous voulez voler en IFR.'
 },
 {
 q: 'What are the currency rules for helicopter pilots?',
 a: 'Helicopter currency under CAR 401.05 mirrors fixed-wing: 5 take-offs and 5 landings in the preceding 6 months in the same category and class to carry passengers, plus 5 night TO/LDG in 6 months for night currency. Helicopter operations may also require additional currency for external load (CAR 702.21) and autorotation training, depending on operator and class of operation.',
 qFr: 'Quelles sont les règles de validité pour les pilotes d\'hélicoptère ?',
 aFr: 'La validité hélicoptère selon CAR 401.05 est calquée sur l\'aile fixe : 5 décollages et 5 atterrissages dans les 6 mois précédents dans la même catégorie et classe pour porter des passagers, plus 5 T/O et LDG de nuit en 6 mois pour la validité de nuit. Les opérations hélicoptère peuvent aussi exiger une validité additionnelle pour charge externe (CAR 702.21) et entraînement à l\'autorotation, selon l\'opérateur et la classe d\'opération.'
 },
 {
 q: 'How often do I need to recur on type (PPC / IPC)?',
 a: 'Under CAR 705.106, a Pilot Proficiency Check (PPC) is required every 12 months for air carrier operations, with an Instrument Proficiency Check (IPC) also normally on a 12-month cycle. CAR 605.97 governs general IPC requirements. Many 705 operators check both during the same recurrent training event. Log every PPC / IPC in the Simulator section with the appropriate Session Type tag.',
 qFr: 'À quelle fréquence dois-je faire mon PPC / IPC sur type ?',
 aFr: 'Selon CAR 705.106, un PPC (Pilot Proficiency Check) est requis chaque 12 mois pour les opérations de transporteur aérien, avec un IPC (Instrument Proficiency Check) aussi normalement sur un cycle de 12 mois. CAR 605.97 régit les exigences IPC générales. Plusieurs opérateurs 705 effectuent les deux pendant le même entraînement récurrent. Enregistrez chaque PPC / IPC dans la section Simulateur avec le bon Session Type.'
 },

 // ── Logging conventions ───────────────────────────────────────────
 {
 q: 'How do I count block time vs. flight time?',
 a: 'Block time (BLH) starts when the aircraft moves under its own power (chocks out / brakes released) and ends when it comes to rest at the gate (chocks in). Flight time starts at first movement for takeoff and ends at landing rollout. For airline operations, Transport Canada generally accepts block time for logbook purposes under CAR 401.08.',
 qFr: 'Comment compter le block time vs. flight time ?',
 aFr: 'Le block time (BLH) commence quand l\'aéronef bouge sous sa propre puissance (chocks out / freins relâchés) et se termine quand il s\'immobilise au stationnement (chocks in). Le flight time commence au premier mouvement pour décollage et se termine à la fin du roulage d\'atterrissage. Pour les opérations de transporteur aérien, Transports Canada accepte généralement le block time pour le carnet selon CAR 401.08.'
 },
 {
 q: 'What is PICUS and when can I log it?',
 a: 'PICUS (Pilot in Command Under Supervision) is time logged by a co-pilot (F/O) when acting in the role of PIC under the supervision of a qualified captain. In Canada, this is recognized under CAR 401.08 and can be credited toward ATPL minimums. You may log PICUS only when you are the actual decision-maker for the flight under direct supervision.',
 qFr: 'Qu\'est-ce que le PICUS et quand puis-je l\'enregistrer ?',
 aFr: 'PICUS (Pilot in Command Under Supervision) est du temps enregistré par un copilote (F/O) quand il agit dans le rôle de PIC sous la supervision d\'un commandant qualifié. Au Canada, c\'est reconnu selon CAR 401.08 et peut être crédité vers les minimums ATPL. Vous ne pouvez enregistrer du PICUS que si vous êtes le décideur réel du vol sous supervision directe.'
 },
 {
 q: 'What counts as "cross-country" time?',
 a: 'CAR 401.34 defines cross-country (XC) as a flight to a point more than 25 nautical miles from the departure aerodrome. Cumulo automatically credits XC time when both departure and arrival ICAO codes are known and the great-circle distance exceeds 25 NM. Short hops (< 25 NM) are correctly NOT credited as XC, even if they cross other airports en route.',
 qFr: 'Qu\'est-ce qui compte comme temps « voyage » (XC) ?',
 aFr: 'CAR 401.34 définit le voyage (XC) comme un vol vers un point à plus de 25 milles nautiques de l\'aérodrome de départ. Cumulo crédite automatiquement le temps XC quand les codes ICAO de départ et d\'arrivée sont connus et que la distance orthodromique dépasse 25 NM. Les vols courts (< 25 NM) ne sont correctement PAS crédités comme XC, même s\'ils survolent d\'autres aéroports en route.'
 },
 {
 q: 'How do I log Multi-Crew time (MCC) for ATPL submission?',
 a: 'Multi-Crew time is flight time on aircraft that are certified for and operated with a minimum crew of two pilots (Q400, E195, A320, B737, etc.). For ATPL submission under CAR 421.34, MCC time is a separate credit. Cumulo automatically flags multi_crew = true on any flight where you logged both PIC and SIC hours on the same leg, or imported from a 705-operator roster.',
 qFr: 'Comment enregistrer le temps Multi-Crew (MCC) pour la soumission ATPL ?',
 aFr: 'Le Multi-Crew time est du temps de vol sur des aéronefs certifiés et opérés avec un équipage minimal de deux pilotes (Q400, E195, A320, B737, etc.). Pour la soumission ATPL selon CAR 421.34, le MCC est un crédit séparé. Cumulo marque automatiquement multi_crew = true sur tout vol où vous avez enregistré à la fois des heures PIC et SIC sur le même segment, ou importé depuis un horaire d\'opérateur 705.'
 },
 {
 q: 'How is Dual Given time credited for an instructor ATPL?',
 a: 'CAR 421.34(b) lets a flight instructor count dual-given time toward the 1,500 hours required for the ATPL — up to 1,200 of those hours can be flight-instruction time. Cumulo tracks Dual Given Day + Dual Given Night separately; the PDF cover page now shows a cumulative Dual Given total when you have any hours in those columns.',
 qFr: 'Comment le Dual Given est-il crédité pour un ATPL d\'instructeur ?',
 aFr: 'CAR 421.34(b) permet à un instructeur de vol de compter le dual-given vers les 1 500 heures requises pour l\'ATPL — jusqu\'à 1 200 de ces heures peuvent être du temps d\'instruction. Cumulo suit Dual Given Day + Dual Given Night séparément ; la page couverture du PDF montre maintenant un total cumulatif Dual Given quand vous avez des heures dans ces colonnes.'
 },

 // ── Medical & licensing ────────────────────────────────────────────
 {
 q: 'What medical class do airline pilots need and how often must I renew?',
 a: 'ATPL holders operating under CAR 705 (air carrier) require a Category 1 Medical Certificate. For pilots under 40, it is valid for 12 months. For pilots 40 and older, it must be renewed every 6 months. Transport Canada medical exams are conducted by designated Aviation Medical Examiners (AMEs).',
 qFr: 'Quelle catégorie médicale est requise pour un pilote de ligne et à quelle fréquence renouveler ?',
 aFr: 'Les titulaires d\'ATPL opérant selon CAR 705 (transporteur aérien) doivent détenir un Certificat médical de Catégorie 1. Pour les pilotes de moins de 40 ans, il est valide 12 mois. Pour les pilotes de 40 ans et plus, il doit être renouvelé chaque 6 mois. Les examens médicaux de Transports Canada sont effectués par des médecins-examinateurs de l\'aviation civile (MEAC).'
 },
 {
 q: 'When do I need an ECG for my medical?',
 a: 'Per the TC Category 1 medical standard, an ECG is required at the initial issuance of a Category 1 medical for pilots under 40, then every 24 months between the ages of 40 and 65, and annually once you turn 65. Cumulo lets you record your next ECG due date in Profile and will alert you in the dashboard 60 days before it expires.',
 qFr: 'Quand ai-je besoin d\'un ECG pour mon médical ?',
 aFr: 'Selon la norme médicale TC Catégorie 1, un ECG est requis à l\'émission initiale d\'un médical Catégorie 1 pour les pilotes de moins de 40 ans, puis chaque 24 mois entre 40 et 65 ans, et annuellement à partir de 65 ans. Cumulo permet d\'enregistrer la date d\'échéance de votre prochain ECG dans Profile et vous avertit sur le tableau de bord 60 jours avant l\'expiration.'
 },

 // ── Simulator ──────────────────────────────────────────────────────
 {
 q: 'Can I count simulator time toward my ATPL hours?',
 a: 'Yes, but with limits. Under CAR 401.73, a maximum of 25 hours of approved flight simulator time may be credited toward the 1,500-hour ATPL requirement (200 hours for multi-engine helicopter). The simulator must be approved by Transport Canada. All simulator time should be logged under the Simulator (SIM) column, not as flight time.',
 qFr: 'Puis-je compter le temps simulateur vers mes heures ATPL ?',
 aFr: 'Oui, avec des limites. Selon CAR 401.73, un maximum de 25 heures de temps de simulateur de vol approuvé peut être crédité vers les 1 500 heures requises pour l\'ATPL (200 heures pour hélicoptère multimoteur). Le simulateur doit être approuvé par Transports Canada. Tout le temps simulateur doit être enregistré sous la colonne Simulateur (SIM), pas comme temps de vol.'
 },
 {
 q: 'What are FFS, FTD, FNPT, and BITD?',
 a: 'These are simulator levels. FFS (Full Flight Simulator) is the highest fidelity — full motion, full cockpit. FTD (Flight Training Device) has no motion but a high-fidelity cockpit. FNPT (Flight & Navigation Procedures Trainer) is generic flight controls with realistic instruments. BITD (Basic Instrument Training Device) is the lowest level, often used for PPL/CPL instrument training. CAR 401.73 credit rules differ by device level — check with TC and your operator.',
 qFr: 'C\'est quoi FFS, FTD, FNPT et BITD ?',
 aFr: 'Ce sont des niveaux de simulateur. FFS (Full Flight Simulator) est la plus haute fidélité — mouvement complet, cockpit complet. FTD (Flight Training Device) n\'a pas de mouvement mais un cockpit haute fidélité. FNPT (Flight & Navigation Procedures Trainer) a des commandes de vol génériques avec des instruments réalistes. BITD (Basic Instrument Training Device) est le niveau le plus bas, souvent utilisé pour l\'entraînement aux instruments PPL/CPL. Les règles de crédit CAR 401.73 diffèrent par niveau — vérifiez avec TC et votre opérateur.'
 },

 // ── Privacy & compliance ──────────────────────────────────────────
 {
 q: 'How does Cumulo handle the OTHER pilot\'s name (captain or F/O)?',
 a: 'The rule is symmetric — whether you\'re F/O (the captain is the third party) or you\'re PIC (the F/O is the third party), the OTHER pilot is treated identically. Cumulo stores full names locally on your device — your logbook works exactly like a paper logbook (PIPEDA s.4(2)(b) and Loi 25 art. 1 personal-use exceptions). Anonymization to initials (e.g. "M.D.") only happens when data leaves your device: cloud sync, shareable exports, JSON backups. TC PDF exports always include full names — required for ramp checks under CAR 401.08 and permitted under PIPEDA s.7(3)(c.1)(i). Self-references (your own name, or the literal text "self" / "moi" — which TP 14052 explicitly accepts) are NEVER anonymized: they are not third-party data. Control via Profile → "Keep full crew names when syncing or sharing" (default OFF).',
 qFr: 'Comment Cumulo gère-t-il le nom de l\'AUTRE pilote (commandant ou F/O) ?',
 aFr: 'La règle est symétrique — que vous soyez F/O (le commandant est le tiers) ou PIC (le F/O est le tiers), l\'AUTRE pilote est traité identiquement. Cumulo stocke les noms complets localement sur votre appareil — votre carnet fonctionne exactement comme un carnet papier (LPRPDE art. 4(2)b) et Loi 25 art. 1 exceptions d\'usage personnel). L\'anonymisation en initiales (ex. « M.D. ») arrive seulement quand les données quittent votre appareil : synchro infonuagique, exports partageables, backups JSON. Les exports PDF pour TC contiennent toujours les noms complets — requis pour les contrôles au sol selon CAR 401.08 et permis selon LPRPDE art. 7(3)c.1)(i). Les auto-références (votre propre nom, ou le mot « self » / « moi » — que TP 14052 accepte explicitement) ne sont JAMAIS anonymisées : ce ne sont pas des données de tiers. Contrôle via Profile → « Keep full crew names when syncing or sharing » (par défaut OFF).'
 },
 {
 q: 'Does the Navblue auto-sync capture captain names, or do I have to upload a PDF?',
 a: 'As of the 2026-05-14 update, the Navblue iCal sync attempts to extract crew names (captain + F/O) directly from the DESCRIPTION field of each VEVENT — no separate PDF upload required. Whether crew names actually appear depends on what your airline\'s Navblue tenant includes in the iCal feed: some carriers include "CAPT Smith, John / F/O Brown, Sarah" in the description, others ship the iCal stripped down. After the first sync, check your Logbook page: if the PIC column shows captain names for recent flights, the iCal feed contains them. If the PIC column is still empty, fall back to the monthly PDF roster import (Import → Photo / PDF). The dev console logs raw DESCRIPTION samples on any sync where crew extraction failed — paste one of those lines into a feedback ticket and the regex will be refined.',
 qFr: 'La synchro automatique Navblue capture-t-elle les noms de commandants, ou dois-je uploader un PDF ?',
 aFr: 'Depuis la mise à jour 2026-05-14, la synchro iCal Navblue tente d\'extraire les noms d\'équipage (commandant + F/O) directement du champ DESCRIPTION de chaque VEVENT — pas besoin d\'upload PDF séparé. Que les noms apparaissent ou non dépend de ce que le tenant Navblue de votre compagnie inclut dans le flux iCal : certains transporteurs incluent « CAPT Smith, John / F/O Brown, Sarah » dans la description, d\'autres envoient l\'iCal dépouillé. Après la première synchro, vérifiez votre page Logbook : si la colonne PIC montre les noms pour les vols récents, le flux iCal les contient. Si la colonne PIC reste vide, utilisez l\'import mensuel du PDF roster (Import → Photo / PDF). La console dev affiche des échantillons DESCRIPTION bruts sur chaque synchro où l\'extraction a échoué — collez une de ces lignes dans un ticket de feedback et la regex sera raffinée.'
 },
 {
 q: 'How long must I keep my logbook records?',
 a: 'CAR 401.08(5) requires that a personal logbook be retained for at least 5 years after the date of the last entry. For ATPL holders submitting an experience claim, all relevant entries must be available to TC inspectors on request. Cumulo backs up your data in localStorage and (once Supabase is wired) in the cloud — but a periodic PDF export to your own files is still recommended as a paper trail.',
 qFr: 'Combien de temps dois-je conserver mes enregistrements de carnet ?',
 aFr: 'CAR 401.08(5) exige qu\'un carnet personnel soit conservé au moins 5 ans après la date de la dernière entrée. Pour les titulaires d\'ATPL qui soumettent une demande d\'expérience, toutes les entrées pertinentes doivent être disponibles aux inspecteurs TC sur demande. Cumulo sauvegarde vos données dans localStorage et (une fois Supabase câblé) dans l\'infonuagique — mais un export PDF périodique vers vos propres fichiers reste recommandé comme trace papier.'
 },
 {
 q: 'What will a TC ramp inspector want to see in my logbook?',
 a: 'A TC inspector will check that your logbook is current, complete, and matches the format described in CAR 401.08 + TP 14052. Specifically: chronological entries with date, aircraft type, registration, departure/arrival, flight time, PIC/SIC time, night time, IFR time, simulator time clearly separated, cumulative totals, and pilot signature. Cumulo\'s PDF export is designed to match this format exactly, with a cover page that includes your name, license number, medical expiry, and a signature line.',
 qFr: 'Qu\'est-ce qu\'un inspecteur TC au sol va vouloir voir dans mon carnet ?',
 aFr: 'Un inspecteur TC vérifiera que votre carnet est à jour, complet, et correspond au format décrit dans CAR 401.08 + TP 14052. Spécifiquement : entrées chronologiques avec date, type d\'aéronef, immatriculation, départ/arrivée, temps de vol, temps PIC/SIC, temps de nuit, temps IFR, temps simulateur clairement séparé, totaux cumulatifs, et signature du pilote. L\'export PDF de Cumulo est conçu pour correspondre exactement à ce format, avec une page couverture qui inclut votre nom, numéro de licence, expiration médicale, et une ligne de signature.'
 },

 // ── Importing from other airlines ─────────────────────────────────
 {
 q: 'I don\'t fly for Porter — can I still import my roster?',
 a: 'Yes. Cumulo\'s automatic iCal sync is set up for Navblue (used by Porter), but pilots at other carriers can import via PDF roster (the PDF parser is multi-airline, supporting Jazz CrewTrac, WestJet Sabre, Air Canada AIMS, regional ops, etc.) or via CSV from your previous logbook software (5 native importers: ForeFlight, LogTen Pro, MyFlightbook, Logbook Pro, Safelog — plus a generic CSV column-mapper). Open the Import menu and pick whichever matches your source.',
 qFr: 'Je ne vole pas pour Porter — puis-je quand même importer mon horaire ?',
 aFr: 'Oui. La synchro iCal automatique de Cumulo est configurée pour Navblue (utilisé par Porter), mais les pilotes des autres transporteurs peuvent importer via PDF roster (le parser PDF est multi-compagnies, supportant Jazz CrewTrac, WestJet Sabre, Air Canada AIMS, opérations régionales, etc.) ou via CSV depuis votre ancien logiciel de carnet (5 importeurs natifs : ForeFlight, LogTen Pro, MyFlightbook, Logbook Pro, Safelog — plus un mapper de colonnes CSV générique). Ouvrez le menu Import et choisissez la source qui correspond.'
 }
];

// AI "Ask a Question" feature removed — askQuestion() and renderQAHistory()
// previously lived here. See git history at commit aedca46 for the implementation.
// Re-introduce as a premium / authenticated feature once Cumulo has Supabase auth
// and bilingual EN/FR support.

function renderQA() {
 const faqList = document.getElementById('faqList');
 if (!faqList) return;
 const isFr = (typeof getLang === 'function') && getLang() === 'fr';
 // Always re-render so language toggle updates immediately.
 faqList.innerHTML = FAQS.map((f, i) => {
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
 document.getElementById('sigStatus').textContent = 'Signature saved.';
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
 document.getElementById('sigStatus').textContent = 'Saved.';
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
 ['Block Time', 'Time from chocks-out (engine start / brake release) to chocks-in. Synonym: Flight Time per CAR 101.01', 'Temps de chocks-out (démarrage / freins relâchés) à chocks-in. Synonyme : Flight Time selon CAR 101.01'],
 ['BLH', 'Block Hours — synonym for Block Time / Flight Time', 'Block Hours — synonyme de Block Time / temps de vol'],
 ['Air Time', 'Time from wheels-up to wheels-down. Used for aircraft maintenance, NOT for the pilot logbook', 'Temps de wheels-up à wheels-down. Utilisé pour la maintenance, PAS pour le carnet du pilote'],
 ['Duty Time', 'Time on duty — typically check-in to check-out, broader than block time', 'Temps en service — typiquement check-in à check-out, plus large que le block time'],

 // Conditions (CAR 401.08(2)(d))
 ['Day', 'Daytime flight — sunrise to 30 min before sunset (varies by jurisdiction)', 'Vol de jour — lever du soleil à 30 min avant le coucher (varie par juridiction)'],
 ['Night', 'Per RAC 101.01 (Canada): from 30 min after sunset to 30 min before sunrise', 'Selon RAC 101.01 (Canada) : de 30 min après le coucher du soleil à 30 min avant le lever'],
 ['IFR', 'Instrument Flight Rules — flight conducted under instrument procedures', 'Instrument Flight Rules — vol selon les procédures aux instruments'],
 ['VFR', 'Visual Flight Rules — flight by visual reference', 'Visual Flight Rules — vol selon les références visuelles'],

 // Engine class (Standard 421)
 ['SE', 'Single-Engine — aircraft with one engine', 'Monomoteur — aéronef à un moteur'],
 ['ME', 'Multi-Engine — aircraft with more than one engine', 'Multimoteur — aéronef à plus d\'un moteur'],

 // Cross-country
 ['XC', 'Cross-Country — flight to an aerodrome more than 25 NM (46.3 km) from the point of departure (CAR 401.34)', 'Voyage — vol vers un aérodrome à plus de 25 NM (46,3 km) du point de départ (CAR 401.34)'],

 // Instrument
 ['Inst Actual', 'Instrument time in actual IMC (clouds, low vis)', 'Temps aux instruments en IMC réel (nuages, faible visibilité)'],
 ['Inst Hood', 'Instrument time under a view-limiting device (training)', 'Temps aux instruments sous capot (entraînement)'],
 ['Inst Sim/FSTD', 'Instrument time in a Flight Simulation Training Device — logged SEPARATELY from flight time', 'Temps aux instruments dans un Flight Simulation Training Device — enregistré SÉPARÉMENT du temps de vol'],
 ['Approach', 'An instrument approach to landing or missed approach (counts toward CAR 401.05 IFR currency: 6 in 6 months)', 'Une approche aux instruments à l\'atterrissage ou approche manquée (compte vers la validité IFR CAR 401.05 : 6 en 6 mois)'],

 // Landings & currency
 ['LDG', 'Landing', 'Atterrissage'],
 ['T/O', 'Take-off', 'Décollage'],

 // Simulator
 ['SIM', 'Simulator session — does NOT count as block time, logged separately per CAR 401.08', 'Session de simulateur — ne compte PAS comme block time, enregistré séparément selon CAR 401.08'],
 ['FFS', 'Full Flight Simulator — highest-fidelity (Level C/D) Approved Flight Simulator', 'Full Flight Simulator — simulateur approuvé haute fidélité (Niveau C/D)'],
 ['FTD', 'Flight Training Device — fixed-base sim, lower fidelity than FFS', 'Flight Training Device — sim à base fixe, fidélité inférieure au FFS'],
 ['FNPT', 'Flight & Navigation Procedures Trainer — basic flight trainer', 'Flight & Navigation Procedures Trainer — entraîneur de vol de base'],
 ['PPC', 'Pilot Proficiency Check — annual/biannual proficiency test (CAR 421.05)', 'Pilot Proficiency Check — test de compétence annuel/semestriel (CAR 421.05)'],
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
 ['GD', 'Guaranteed Day Off (Porter/Navblue roster code)', 'Guaranteed Day Off (code horaire Porter/Navblue)'],
 ['SDO', 'Scheduled Day Off (rest)', 'Jour de repos planifié'],
 ['HTL', 'Hotel / layover (roster code)', 'Hôtel / escale (code horaire)'],
 ['REAX', 'Reassignable Reserve (roster code)', 'Réserve réassignable (code horaire)'],
 ['VAC', 'Vacation', 'Vacances'],
 ['PER', 'Personal Day', 'Journée personnelle'],

 // Aircraft / aerodrome identifiers
 ['ICAO', '4-letter aerodrome identifier (e.g. CYOW, KBOS) used in flight plans and logbooks', 'Code aérodrome 4-lettres (ex. CYOW, KBOS) utilisé dans les plans de vol et carnets'],
 ['IATA', '3-letter airport code (e.g. YOW, BOS) — common in tickets and Navblue rosters', 'Code aéroport 3-lettres (ex. YOW, BOS) — courant dans les billets et horaires Navblue'],
 ['MTOW', 'Maximum Take-Off Weight (sometimes referenced for aircraft class)', 'Maximum Take-Off Weight — masse maximale au décollage (référencée pour la classe d\'aéronef)'],

 // Regulatory
 ['TC', 'Transport Canada — Canadian aviation regulatory authority', 'Transports Canada — autorité de réglementation de l\'aviation canadienne'],
 ['CAR', 'Canadian Aviation Regulations (SOR/96-433) — primary aviation regulation in Canada', 'Canadian Aviation Regulations (DORS/96-433) — réglementation aérienne principale au Canada'],
 ['RAC', 'Règlement de l\'aviation canadien — French name for the CAR', 'Règlement de l\'aviation canadien — nom français des CAR'],
 ['CAR 401.05', 'Recency requirements (5 landings 90 days · 6 IFR approaches 6 months)', 'Exigences de validité (5 atterrissages 90 jours · 6 approches IFR 6 mois)'],
 ['CAR 401.08', 'Personal Log requirements (the 9 mandatory fields per flight)', 'Exigences du carnet personnel (les 9 champs obligatoires par vol)'],
 ['CAR 401.34', 'Cross-country definition (> 25 NM)', 'Définition du voyage (> 25 NM)'],
 ['Standard 421', 'Personnel Licensing Standards — categories of experience for licence applications', 'Normes de délivrance des licences du personnel — catégories d\'expérience pour les demandes de licence'],
 ['CARS', 'Commercial Air Service Standards (CAR 700 series — operations like 705 airline)', 'Normes de service aérien commercial (série CAR 700 — opérations comme 705 transporteur aérien)'],
 ['705', 'Subpart 705 — Airline Operations under the CARs', 'Sous-partie 705 — Opérations de transporteur aérien selon les CAR'],
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
