# Registre réglementaire — Cumulo

**Règle dure :** aucun chiffre, seuil ou définition réglementaire ne va dans le code
ou le texte de l'app **sans une entrée ici**, avec **citation exacte + lien source +
date de vérification**. Si on ne peut pas citer la source, on ne l'écrit pas : on
demande ou on laisse vide. On **consulte ce registre** avant d'écrire/modifier une
règle — on ne re-devine jamais de mémoire.

Source primaire = laws-lois.justice.gc.ca (CARs SOR/96-433) et tc.canada.ca (Standards/CASS).

## 🔤 GLOSSAIRE TERMINOLOGIQUE FR (termes officiels — copier VERBATIM)
Règle : pour un terme d'aviation FR, **copier le terme officiel ci-dessous mot pour mot**.
Interdit de substituer un terme informel « pour la cohérence » ou de « standardiser plus tard ».
Si le terme n'est pas ici, le vérifier (laws-lois/tc.canada.ca) PUIS l'ajouter ici AVANT de l'écrire dans le code.

| Concept (EN) | Terme officiel FR | Source | Bannis (ne jamais utiliser) |
|---|---|---|---|
| Hood / view-limiting device | **dispositif limitant la vue** | CI 401-004 ; RAC DORS/96-433 (laws-lois, vérifié 2026-06-25) | ❌ « cagoule » (= masque de voleur), ❌ « capot »/« sous capot » (informel) |
| Night | nuit (fin du crépuscule civil → début du crépuscule civil) | CAR/RAC 101.01 | — |
| Flight time | **temps de vol** — au Canada = **block-à-block** (« du 1er mouvement par ses propres moyens pour décoller jusqu'à l'arrêt à la fin du vol »). Donc « flight time » = « block time » (même chiffre, contrairement aux É.-U.). | CAR/RAC 101.01 (laws-lois, WebFetch vérifié 2026-07-01) — texte EN : « the time from the moment an aircraft first moves under its own power for the purpose of taking off until the moment it comes to rest at the end of the flight » | ❌ ne plus afficher « Block Hours / Heures bloc » dans l'UI de résumé (décision Martin 2026-07-01 : dire **« Flight Time / Temps de vol »**). ✅ GARDER « off-block/on-block UTC », « signature blocks » (vrais termes distincts) |
| Cross-country | **vol-voyage** (le temps = « temps de vol en voyage », RAC 101.01) ; abréviation **XC** conservée | RAC 101.01 + guides de test en vol / AIM de TC (terme employé par TC en français) — vérifié 2026-06-26 | ❌ « cross-country » dans le FR (anglicisme), ❌ « voyage » seul |
| Full Flight Simulator (FFS) | **Simulateur de vol complet** (acronyme FFS conservé) | TC TP 9685 « Aeroplane and Rotorcraft Simulator Manual » / TP 9685F (tc.canada.ca) — vérifié 2026-07-01 | — |
| Flight Training Device (FTD) | **Dispositif d'entraînement de vol** (acronyme FTD conservé) | TC TP 13799 « Dispositifs d'entraînement de vol » (tc.canada.ca) — vérifié 2026-07-01 | — |
| Pilot Proficiency Check (PPC) | **Contrôle de compétence pilote** (acronyme PPC conservé) | RAC 705.113 + terme déjà fixé dans l'app (`profile.ppc.hint`) | ⚠️ ne pas introduire de 2e variante : TC emploie aussi « Contrôle de la compétence du pilote (CCP) » (Std 724) et « Vérification de compétence pilote » (TP 14727) — l'app est fixée sur « Contrôle de compétence pilote » |
| IPC / FNPT / BITD / LOFT | **pas de terme TC officiel FR** → gardés **TELS QUELS** (anglais, non traduits) | décision Martin 2026-07-01 | ❌ ne pas traduire ni fabriquer un terme FR ; TC n'a pas de traduction officielle claire (variance/classes EASA-ICAO) |

| Statut | Sens |
|---|---|
| ✅ vérifié | Cité, conforme au règlement, implémenté correctement |
| ⚠️ écart | Vérifié, mais le code ne correspond pas encore au règlement (à corriger) |
| ⏳ à vérifier | Présent dans le code, pas encore vérifié contre la source |

---

## ✅ Nuit (jour/nuit)
- **Règle (CAR 101.01)** : « *night means the time between the end of evening civil twilight and the beginning of morning civil twilight* ». Jour = entre le début du crépuscule civil du matin et la fin du crépuscule civil du soir.
- **Implémentation** : `isNightUTC()` / `calcSunriseSunset(...,96)` — crépuscule civil = soleil 6° sous l'horizon (zénith 96°). [src/js/08-flight-form.js:413](../src/js/08-flight-form.js)
- **Source** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-101.01.html
- **Vérifié** : 2026-06-25 ✓ conforme.

## ✅ Cross-country (XC)
- **Règle (CAR 101.01 — déf. « cross-country flight time »)** : route pré-planifiée vers une destination « *at least 25 nautical miles from the point of departure* » (≥ 25 NM).
- **Implémentation** : `isCrossCountry()` → distance haversine ≥ 46,3 km (= 25 NM). [src/js/08-flight-form.js:358](../src/js/08-flight-form.js)
- **Source** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-101.01.html
- **Vérifié** : 2026-06-25 ✓ (note : « at least » = ≥, code corrigé de `> 46.3` à `>= 46.3`).
- ⚠️ NB : la citation « CAR 401.34 » dans le code/glossaire est imprécise — la définition vit dans **101.01**. À harmoniser dans le copy.

## ✅ Récence passagers — jour (décollages/atterrissages)
- **Règle (CAR 401.05(2)(b))** : 5 décollages + 5 atterrissages dans les **6 mois** précédents, « *in the same category and class of aircraft ... or in a Level B, C or D full-flight simulator of the same category and class* ».
- **Implémentation** : `_dashTakeoffsIn6mo` / `_dashLandingsIn6mo` + `countsTowardRecency()` (FFS niveau B/C/D comptent ; FTD/FNPT/BITD non) + `sixMonthCutoffStr()` (6 mois calendaires). [src/js/02-data.js](../src/js/02-data.js)
- **Source** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-401.05-20251217.html
- **Vérifié** : 2026-06-25 ✓.

## ✅ Récence IFR (validité instrument)
- **Règle (CAR 401.05(3.1))** : dans les **6 mois**, « *acquired six hours of instrument time* » **ET** « *completed six instrument approaches in an aircraft in actual or simulated IMC, or in a Level B, C or D simulator* ».
- **« instrument time » (CAR 101.01)** : « *(a) instrument ground time, (b) actual instrument flight time, or (c) simulated instrument flight time* » → le temps en **simulateur compte**.
- **Implémentation** : `_dashIFRCurrency()` exige `approaches ≥ 6` **ET** `instrumentTime ≥ 6 h` ; temps = `instActual + instHood + instSim`. Anneau + carte statut + drilldown affichent le facteur limitant. [src/js/02-data.js](../src/js/02-data.js), [src/js/21-dash-drilldown.js](../src/js/21-dash-drilldown.js)
- **Source** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-401.05-20251217.html + .../section-101.01.html
- **Vérifié** : 2026-06-25 ✓ (unit-testé : 6appr/4h→non à jour, 6appr/6h(sim)→à jour, 3appr/7h→non à jour).

## ✅ Récence passagers — NUIT
- **Règle (CAR 401.05(2)(b)(i)(B))** : 5 décollages de nuit + 5 atterrissages de nuit dans les 6 mois si le vol est « *five night take-offs and five night landings, if the flight is conducted wholly or partly by night* » (aéronef ou FFS niveau B/C/D). NB : exemption existante pour certaines exploitations.
- **Implémentation** : drilldown « Expérience récente » affiche jour ET nuit. Nuit = somme `toNight` / `ldgNight` des vols admissibles (jamais inféré — un décollage de jour peut précéder un atterrissage de nuit) ; sim limité aux FFS via `countsTowardRecency`. Présenté comme indicateur informatif (pas un blocage) + note exemption « référez-vous à votre exploitant ». [src/js/21-dash-drilldown.js](../src/js/21-dash-drilldown.js)
- **Source** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-401.05-20251217.html
- **Vérifié** : 2026-06-25 ✓ (donnée décollages jour/nuit ajoutée au formulaire le même jour).

---

## ✅ Validité du certificat médical (CAR 404.04) — vérifié 2026-06-25
- **Périodes (404.04(6)/(6.1)/(6.2))** : non-commercial <40 ans = 60 mois (PPL/récréatif/ballon ; planeur/ultraléger 60) ; 40+ = 24 mois (planeur/ultraléger restent 60). Commercial (CPL/MCPL-avion/ATPL contre rémunération) = **12 mois**, réduit à **6 mois** si 40+ en monopilote avec passagers OU 60 ans et +. La période de validité se **calcule à partir de la date de l'examen / déclaration médicale (404.04(7))** ; le texte n'affirme PAS explicitement que l'âge est « évalué » à cette date (corrigé 2026-06-30 — ne pas sur-interpréter). **Re-vérifié au texte primaire laws-lois 2026-06-30 : 404.04(6.1)/(6.2)/(7) — confirmé exact.**
- **🆕 Calcul de l'échéance (404.04(8), en vigueur 2026-06-17, Gazette II 2025-12-17)** : fin de validité calculée à partir de (a) la fin de la période précédente si l'examen est ≤ 90 jours avant cette fin ; (b) **le 1er jour du mois suivant l'examen** si l'examen est > 90 jours avant. (Avant : lié à la date d'examen.)
- **Source** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-404.04.html (article ATAC = source secondaire qui a alerté).
- **Impact Cumulo** : AUCUNE casse — l'app utilise l'échéance **saisie par le pilote** (`profile.medical`), pas un calcul ; le pilote saisit la date de son certificat (déjà conforme). **Opportunité** : un calculateur/vérificateur d'échéance dans la vue détail Médical (âge + type de licence + opération + règle (8)) — à concevoir avec la refonte, soigneusement (certifiable). NE PAS auto-coder sans validation Martin.

## ✅ Validité du PPC — contrôle de compétence pilote (CAR 705.113) — vérifié 2026-06-27
- **Règle (705.113(2))** : la validité du PPC expire **(a)** le 1er jour du **7e mois** suivant le mois du contrôle (≈ **6 mois**) ; **(b)** le 1er jour du **13e mois** (≈ **12 mois**) si le pilote réussit la **formation périodique semestrielle approuvée par le ministre** selon les CASS ; **(c)** option de programme de qualification avancée (AQP). **705.113(4)** : renouvellement dans les **90 derniers jours** de validité → prolongé de 6 ou 12 mois selon le cas.
- **Source primaire** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-705.113.html (WebFetch direct, 2026-06-27).
- **Implémentation** : Q&R + glossaire mis à jour (6 mois base / 12 mois avec formation approuvée, cite 705.113). La date d'échéance reste **saisie par le pilote** (`ppcDueDate`) — aucune donnée calculée/inventée. 705.106 = exige un PPC valide ; **705.113 = la période de validité**.
- ⏳ Reste cosmétique : l'échelle de l'anneau PPC (365 j) → à régler à ~180 j. Exemptions possibles par exploitation → la Q&R renvoie aussi au programme de l'exploitant.
- **Re-confirmé au texte primaire 2026-06-30** (laws-lois 705.113(2)(a)/(b)/(c)). **Note tracker (insight Martin, Porter)** : l'intervalle réel dépend du **programme approuvé de l'exploitant** — 705.113(2)(c) AQP couvre le cas « sim/6 mois, parfois LOFT au lieu de PPC ». ⇒ le tracker reste **piloté par la date saisie** (`ppcDueDate`) + renvoi au programme de l'exploitant ; **jamais un intervalle codé en dur**.

## ✅ Exigences de délivrance — licences & qualifications (pour le tracker de progression) — vérifié 2026-06-27, citation « nuit » confirmée 2026-06-30
Provenance : recherche `private/RECHERCHE-TC-2026-06-27.md` (agent source primaire + agent adversarial). ⚠️ **Citations vérifiées ; les CHIFFRES doivent être reconfirmés par Martin AVANT tout affichage dans le tracker** (« il te reste X h » = doit être exact). NE PAS coder le tracker sans son aval (sa formation = autorité finale).
- **PPL avion — Norme 421.26(4)** : 45 h tot · 17 h double (min 3 h XC + 5 h instr., max 3 h sol) · 12 h solo (min 5 h XC avec un vol ≥ 150 NM, 2 atterrissages ailleurs qu'au départ). Max 5 h sim homologué.
- **CPL avion — Norme 421.30(4)** : 200 h tot · 100 h PIC (dont 20 h XC PIC) · 65 h formation post-PPL (35 h double [5 h nuit dont 2 h XC, 5 h XC, 20 h instr. max 10 sim] ; 30 h solo [XC ≥ 300 NM / 3 aérodromes, 5 h nuit solo ≥ 10 décollages/circuits/atterrissages]).
- **ATPL avion — CAR 421.34(4)** (amendement en vigueur ~2026-01-05, Gazette II 2025-12-17) : 1500 h tot · 900 h min avion · 250 h PIC (100 h XC + 25 h XC nuit) · 100 h XC additionnelles OU 200 h copilote · 100 h nuit (min 30 h avion) · 75 h instr. (max 25 sim, max 35 hélico).
- **Qualif. IFR groupe 1 — Norme 421.46(2)** : 50 h XC en PIC · 40 h instr. (max 20 sol) dont 20 h double (5 h d'un instructeur + 15 h d'une personne qualifiée) · vol XC double ≥ 100 NM avec approches à 2 endroits.
- **Qualif. nuit avion — CAR 401.42 (règlement) / Norme 421.42 (exigences)** : 20 h tot · 10 h nuit (5 h double [dont 2 h XC] + 5 h solo [10 décollages/circuits/atterrissages]) · 10 h instr. en double. ✅ **Citation tranchée 2026-06-30** : CAR 401.42 accorde la qualif. ; les heures vivent à la **Norme 421.42** (l'ambiguïté 421.42/401.42 du doc de recherche est résolue) — confirmé via tc.canada.ca (Standard 421 + exemption TC « 421.42(1)(a) and (b) »).
- **Sources** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433 (CAR 401.42, 421.34) + https://tc.canada.ca/en/corporate-services/acts-regulations/list-regulations/canadian-aviation-regulations-sor-96-433/standards/standard-421-flight-crew-permits-licences-ratings (Normes 421.26 / 421.30 / 421.42 / 421.46).
- **Récence / médical / PPC** (le tracker « temps restant » s'en sert aussi) : déjà au registre — récence passagers **401.05(2)(b)**, récence IFR **401.05(3.1)**, médical **404.04**, PPC **705.113**.
- ⚠️ Ceci **résout** les notes « à vérifier avant de réintroduire » des chiffres ATPL/sim (corrections 2026-06-26, plus bas) et « CAR 401.34 / Standard 421.34 » ci-dessous.

## ✅ Limites de temps de vol (duty tracker) — CAR 700.27 — vérifié 2026-06-30
- **Règle (CAR 700.27, SOR/2018-269)** : le temps de vol d'un membre d'équipage de conduite ne doit pas dépasser **112 h en 28 jours consécutifs** · **300 h en 90 jours consécutifs** · **1000 h en 365 jours consécutifs** · **8 h en 24 h consécutives (exploitation MONOPILOTE seulement)**. Le temps de vol inclut celui accumulé dans d'autres exploitations. S'applique aux exploitations commerciales (Subpartie 700 : 705/704/703).
- ⚠️ **CAR 700.15 est RÉSERVÉ** (ancien article, remplacé par les règles de fatigue 2018) → citer **700.27**, JAMAIS 700.15.
- **Source primaire** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-700.27.html (WebFetch, 2026-06-30) + confirmé section 700.15 « [Reserved, SOR/2018-269, s. 13] ».
- **« Par jour » multi-équipage** : pour un pilote 705 multi-équipage, PAS de limite simple de temps de vol par jour — le plafond quotidien est la **période de service de vol (FDP)** (table selon heure de présentation + nb de vols, 700.28+). ⇒ le tracker affiche les 3 limites cumulatives (28/90/365 j) + note renvoyant au programme de l'exploitant ; le 8 h/24 h ne vaut que monopilote. Ne PAS coder de limite FDP quotidienne de mémoire.
- **Implémentation** : `25-duty-tracker.js` somme le temps de vol (hors sim) dans les fenêtres glissantes 28/90/365 j vs 112/300/1000 h ; vert / ambre (≥75 %) / rouge (≥100 %).

## ✅ Période de service de vol maximale — QUOTIDIEN (RAC 700.28) — vérifié 2026-07-13
- **Portée** : équipage NON augmenté, 705 multi-équipage (F/O Porter normal). Source : laws-lois RAC (DORS/96-433), Partie VII, Sous-partie 700, Division III « Gestion de la fatigue des membres d'équipage de conduite » (DORS/2018-269 art. 13). **À jour 2026-05-26 ; dern. mod. 2026-01-05.** URL : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-700.28.html — **table double-vérifiée cellule par cellule par 2 passes adversariales indépendantes (fetch + re-fetch), concordance totale.**
- ⚠️ **CORRECTION** : la table quotidienne est **700.28**, PAS 700.62. La note de version de l'app Max Duty citant « 700.62(1) 18 h » vise le **plafond absolu** (ULR), pas la table quotidienne.
- **700.28(1)** (interdiction) verbatim : « An air operator shall not assign a flight duty period to a flight crew member, and a flight crew member shall not accept such an assignment, if the flight duty period exceeds the maximum flight duty period set out in this section. »
- **Trois tables selon la durée moyenne de tous les vols prévus** : 700.28(2) < 30 min ; 700.28(3) 30 à < 50 min ; 700.28(4) ≥ 50 min. **Les heures max de FDP sont IDENTIQUES d'une table à l'autre, ligne pour ligne ; seuls les seuils de nombre de vols (en-têtes de colonnes) changent.** Table distincte VFR de jour = 700.28(9) (colonne unique = valeurs de la Col. 2). Maxima en **heures décimales** (12.5 h = 12:30 ; garder « 12.5 hours » comme chaîne source).

**Heures max de FDP par heure de début (identiques aux 3 tables) :**
| Col. 1 — Heure de début (réf. acclimatée) | Col. 2 | Col. 3 | Col. 4 |
|---|---|---|---|
| 24:00–03:59 | 9 | 9 | 9 |
| 04:00–04:59 | 10 | 9 | 9 |
| 05:00–05:59 | 11 | 10 | 9 |
| 06:00–06:59 | 12 | 11 | 10 |
| 07:00–12:59 | 13 | 12 | 11 |
| 13:00–16:59 | 12.5 | 11.5 | 10.5 |
| 17:00–21:59 | 12 | 11 | 10 |
| 22:00–22:59 | 11 | 10 | 9 |
| 23:00–23:59 | 10 | 9 | 9 |

Seuils des colonnes (nombre de vols prévus) : **700.28(2)** 1-11 / 12-17 / 18+ · **700.28(3)** 1-7 / 8-11 / 12+ · **700.28(4)** 1-4 / 5-6 / 7+ · VFR jour **700.28(9)** = colonne unique.
- **700.28(6)** : le positionnement (mise en place) N'EST PAS un vol dans le décompte — verbatim « positioning is not to be considered a flight ». **700.28(7)** : fuseaux canadiens (Pacific, Mountain, Central, Eastern, Atlantic incl. T.-N.-L.).
- **Acclimatation — 700.28(5) (RÈGLEMENT, PAS Advisory Circular)** : acclimaté si (a) écart de fuseau < 4 h ET repos requis fournis ET **72 h** dans le fuseau ; (b) écart ≥ 4 h ET repos fournis ET **96 h** ; (c) **24 h par heure d'écart**. La réf. de temps qui choisit la LIGNE = **700.19(2)** : acclimaté → heure locale de l'endroit actuel ; non acclimaté → heure locale du dernier endroit où le membre était acclimaté. Déf. « acclimatized » (700.01) = qualitative seulement (« biorhythm aligned with local time »), les chiffres vivent à 700.28(5).
- **Plafonds absolus — RAC 700.62** : 700.62(1) FDP jamais > **18 h** ; 700.62(2) temps de vol prévu jamais > **16 h**.
- **Prolongation par le CDB (circonstances imprévues) — RAC 700.63** : déclencheur = circonstance imprévue survenant **dans les 60 min du début du FDP**, après consultation de l'équipage. Au-delà du max de 700.28/700.60(1) : +1 h monopilote · **+2 h non augmenté (cas Porter, 700.63(1)(b)(ii))** · +3 h augmenté 1 vol · +2 h augmenté 2-3 vols. Repos suivant prolongé d'au moins autant (700.63(3)). ⇒ **note informative**, jamais ajoutée automatiquement au maximum.
- **700.60 (équipage augmenté, FDP max 14–18 h selon crew additionnel + classe d'installation de repos)** = hors portée du calculateur v1 (F/O non augmenté).
- **⏳ Reste paraphrasé (à re-lire avant toute citation)** : sous-alinéas 700.42(2) (« local night's rest », seuil 60 h) — NB **700.42 régit le REPOS qui SUIT un FDP après franchissement de fuseaux, il ne change PAS le chiffre du FDP quotidien**. Confirmés byte-stable : 700.42(1)(a) = 11 h ; (1)(b) = 14 h.
- **⏳ AVANT AFFICHAGE dans l'app** : Martin confirme les chiffres avec sa formation récurrente + vérifie si le **programme approuvé de Porter** est plus restrictif (peut réduire, jamais augmenter). Renvoi au programme de l'exploitant partout ; jamais un maximum codé en dur présenté comme vérité opérationnelle finale.
- **Implémentation** : calculateur quotidien façon Max Duty — PAS encore codé. Voir la fiche mémoire duty tracker.

## ✅ Service fractionné / « split » (RAC 700.50) — vérifié 2026-07-13
- Source : laws-lois RAC (DORS/96-433) 700.50. À jour 2026-05-26. URL : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-700.50.html — **double-vérifié (extraction + re-fetch adversarial), confiance haute, 0 écart.**
- **Déclencheur** : le FDP peut dépasser le max de 700.28 SI l'exploitant fournit une pause d'**au moins 60 minutes consécutives**, en **« suitable accommodation »** (⚠️ PAS le standard plus élevé « for sleep »), pendant le FDP.
- **Calcul de la prolongation** — **700.50(2)** : la durée de la pause est d'abord **RÉDUITE DE 45 MINUTES**, PUIS on applique le pourcentage de 700.50(1) :
  - **700.50(1)(a)** : pause pendant **24:00–05:59** → **100 %** de la (durée − 45).
  - **700.50(1)(b)** : pause pendant **06:00–23:59** → **50 %**.
  - **700.50(1)(c)** : circonstance imprévue (replanification après début du FDP) → 50 %.
  - ⇒ **Prolongation = (minutes de pause − 45) × %.** Ex. pause 60 min de jour → (60−45)×50 % = **+7,5 min** ; pause 180 min de nuit → (180−45)×100 % = **+135 min**.
- **700.50(3)** : en service de nuit, prolongation possible seulement **3 nuits consécutives**. **700.50(4)** : l'heure de (1)(a)/(b) se lit à l'**endroit d'acclimatation** (cohérent avec 700.19(2)). **700.50(5)** (réserve) : +2 h, ≤ 2 vols après la pause — hors portée v1.
- Verbatim clés : chapeau 700.50(1) « ...may exceed the maximum flight duty period set out in section 700.28 by the following amount of time, if the air operator provides the member with a break, in suitable accommodation, of at least 60 consecutive minutes during the flight duty period: » ; 700.50(2) « the duration of the break provided to the flight crew member is reduced by 45 minutes before the calculation is made. »
- **⏳ Avant affichage** : un œil humain sur la page live recommandé (extraction WebFetch, pas HTML brut) + Martin confirme.

## ⏳ À VÉRIFIER (présent dans le code, pas encore confirmé contre la source)
- **CAR 401.08 / 401.08(2)(h)** — contenu obligatoire du carnet (colonnes). [04-logbook, 12-pdf-export, 13-glossaire]
- ~~**CASS 725.106** — validité PPC~~ → **CONFIRMÉ 2026-06-27** au texte primaire **CAR 705.113** (voir la section ✅ ci-dessus : 6 mois base / 12 mois avec formation approuvée). Reste cosmétique : régler l'échelle de l'anneau PPC à ~180 j.
- **CAR 401.34 / Standard 421.34** — usage exact (vs 101.01 pour la déf. XC).
- **CAR 401.73** — récence/rafraîchissement (glossaire).
- **CAR 605.x** (605.97 etc.) — exigences carnet de route / documents (glossaire).
- **CAR 401.05(1)** — récence 5 ans / programme de formation.

---

## 📝 Corrections appliquées 2026-06-26 (glossaire + Q&R)
Re-vérifié sur laws-lois (section-401.05-20251217) + CAR 705.106 le **2026-06-26** :
- **Récence passagers** = 5 décollages + 5 atterrissages / **6 mois** (401.05(2)). Corrigé le glossaire « CAR 401.05 » qui disait « 90 jours » (= règle FAA FAR 61.57, erronée) → « 6 mois ». Citation nuit dans la Q&R : (3) → (2).
- **Récence IFR** = **6 h de temps aux instruments ET 6 approches** / 6 mois (401.05(**3.1**)). Q&R IFR corrigée (citait 401.05(5) + approches seules) → 401.05(3.1) + les deux exigences. ⇒ La ligne « 6 h » de l'export PDF est **CORRECTE** — NE PAS la retirer (l'audit se trompait).
- **« Jour »** (glossaire) = crépuscule civil (RAC 101.01), aligné sur « Nuit ». Retiré « lever du soleil à 30 min avant le coucher » (non réglementaire au Canada).
- **PPC** (glossaire) : citation CAR 421.05 → **CAR 705.106** (confirmé : 705.106 exige un PPC valide selon les CASS pour les ops 705). ⏳ Intervalle exact + cycle de l'anneau (180 j) = encore à confirmer (échelle d'anneau cosmétique pour l'instant ; la date d'échéance est saisie par le pilote).
- **🔎 Intervalle PPC — recherche 2026-06-26** : la **période de validité** du PPC vit dans **CASS 725.113** (pas 725.106). Une recherche web (résumé moteur + tc.canada.ca) indique « expire le **1er jour du 7e mois** suivant le mois du contrôle » ≈ **6 mois** pour le 705 multi-équipage. ⇒ l'aide app « tous les 6 mois » serait JUSTE et la Q&R « 12 mois » FAUSSE. ⚠️ **PAS confirmé du texte primaire 725.113** (page TC trop grosse pour l'extraction; exemptions possibles). NE PAS figer Q&R/aide/anneau avant confirmation (Martin connaît l'intervalle via sa formation récurrente). Si confirmé 6 mois → corriger Q&R (12→6), restaurer « 6 mois » dans l'aide PPC, régler l'anneau PPC à ~180 j.

## 📝 Corrections appliquées 2026-06-26 (passe exactitude TC — audit pré-push)
Principe appliqué : **retirer tout chiffre/règle non confirmé au registre** (les remplacer par un renvoi à la source ou à l'exploitant), jamais ajouter de nouveau chiffre non sourcé.
- **PPC (Q&R + glossaire)** : retiré « tous les 12 mois » → « l'intervalle dépend de votre exploitation / norme CASS / programme de formation de l'exploitant ». 705.106 (exige un PPC valide) conservé ; intervalle 725.113 toujours **non confirmé** (cf. note 2026-06-26 plus haut).
- **XC (Q&R + glossaire + brought-forward)** : « plus de 25 NM » (>) + citation « CAR 401.34 » → « au moins 25 NM (≥) » + **CAR/RAC 101.01** (déf. confirmée, cf. section XC). Entrée glossaire « CAR 401.34 » remplacée par « CAR 101.01 ». `20-opening-balances.js` : retiré « / CAR 401.34 », gardé « Standard 421 ».
- **Médical 705 (Q&R)** : « 40 ans et + = aux 6 mois » (trop large) → « 12 mois, réduit à 6 mois dès 60 ans, ou à 40+ en monopilote avec passagers » + **CAR 404.04** + âge évalué à la date de l'examen (cf. section médical, vérifié 2026-06-25).
- **ECG (Q&R)** : retiré les intervalles non sourcés (« 24 mois 40-65, annuel 65+ ») → renvoi à la norme médicale Cat 1 + au médecin-examinateur (MEAC/CAME). **Aucune entrée registre pour les intervalles ECG** — à vérifier (TP 13312 / Standard 424) avant de réintroduire un chiffre.
- **Chiffres ATPL/sim (Q&R + brought-forward)** : retiré « 1 500 h / 1 200 h / 25 h / 200 h » et les articles non vérifiés « CAR 401.73 / 421.34 » → renvoi au **Standard 421** + Transports Canada. À vérifier au texte primaire avant de réintroduire des chiffres.
- Termes FR : « opérateur » → « exploitant », « CAR 101.01 » → « RAC 101.01 » dans les nouvelles chaînes FR touchées.

## 📝 Traduction FR des menus déroulants simulateur — 2026-07-01 (couverture bilingue)
Les `<select id="f-simType">` / `<select id="f-simSession">` (formulaire d'ajout de vol) étaient en anglais dur. Rendus bilingues via `data-i18n` + clés `sim.type.*` / `sim.session.*` dans `17-i18n.js`. Choix des termes :
- **Vérifiés à la source TC** (2026-07-01) → traduits : FFS = « Simulateur de vol complet », FTD = « Dispositif d'entraînement de vol » (TP 9685 / TP 13799) ; PPC = « Contrôle de compétence pilote » (RAC 705.113, terme déjà fixé).
- **Pas de terme TC officiel FR → GARDÉS TELS QUELS (anglais, non traduits)** — **décision Martin 2026-07-01** : IPC, FNPT, BITD, LOFT. Règle générale actée : *si TC n'a pas de traduction officielle, on garde le terme tel quel — on ne traduit pas et on n'invente pas.*
- **Plain-language non réglementaire** (traduits) : « Renouvellement IFR », « Formation périodique », « Formation initiale », « Cours de qualification de type », « Autre » / « Autre formation ».

> Tenir à jour : toute nouvelle règle réglementaire ajoutée au code DOIT apparaître ici
> avec sa source vérifiée le jour où elle est écrite.
