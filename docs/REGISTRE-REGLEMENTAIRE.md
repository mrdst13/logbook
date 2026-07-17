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
- **Règle (CAR 401.05(3.1))** : dans les **6 mois**, « *acquired six hours of instrument time* » **ET** « *completed six instrument approaches in an aircraft in actual or simulated instrument meteorological conditions, or in a Level B, C or D simulator **or an approved flight training device configured for the same category as the aircraft*** ».
- 🛑 **CORRIGÉ 2026-07-17 — la citation ci-dessus était TRONQUÉE depuis le 2026-06-25, et le CODE agissait sur la troncature.** Les mots « or an approved flight training device configured for the same category as the aircraft » manquaient. Conséquence réelle : `_dashApproachesIn6mo` filtrait par `countsTowardRecency` (le filtre des ATTERRISSAGES, 401.05(2)b), qui n'admet que FFS B/C/D) et jetait les approches faites sur FTD → **récence IFR sous-comptée**. Corrigé par un prédicat distinct `approachCountsTowardIFR` (FFS, FFS-C, FTD). **La règle des approches (3.1)b) est PLUS LARGE que celle des atterrissages (2)b) : ne JAMAIS réutiliser le même filtre pour les deux.**
- Le texte exige « approved » et « configured for the same category » : l'app ne peut vérifier ni l'un ni l'autre ⇒ elle compte le FTD et laisse ce jugement au pilote, plutôt que de jeter silencieusement une approche légitime.
- **Relu au texte BRUT (curl, PAS WebFetch) le 2026-07-17** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-401.05.html
- 🛑 **LEÇON DE MÉTHODE (2026-07-17)** : **WebFetch PARAPHRASE le texte de loi** (constaté : paraphrase de 700.27, et traduction FR→EN présentée comme du verbatim). **Toute entrée de ce registre marquée « vérifié » AVANT le 2026-07-17 vient de WebFetch et n'a pas été re-testée au texte brut** — la traiter comme « à re-tester », pas comme acquise. Transcrire depuis le HTML/XML brut (curl), deux extractions concordantes.
- **« instrument time » (CAR 101.01)** : « *(a) instrument ground time, (b) actual instrument flight time, or (c) simulated instrument flight time* » → le temps en **simulateur compte**.
- **Implémentation** : `_dashIFRCurrency()` exige `approaches ≥ 6` **ET** `instrumentTime ≥ 6 h` ; temps = `instActual + instHood + instSim`. Anneau + carte statut + drilldown affichent le facteur limitant. [src/js/02-data.js](../src/js/02-data.js), [src/js/21-dash-drilldown.js](../src/js/21-dash-drilldown.js)
- **Source** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-401.05-20251217.html + .../section-101.01.html
- **Vérifié** : 2026-06-25 ✓ (unit-testé : 6appr/4h→non à jour, 6appr/6h(sim)→à jour, 3appr/7h→non à jour).

## ✅ Récence passagers — NUIT
- **Règle (CAR 401.05(2)(b)(i)(B))** : 5 décollages de nuit + 5 atterrissages de nuit dans les 6 mois si le vol est « *five night take-offs and five night landings, if the flight is conducted wholly or partly by night* » (aéronef ou FFS niveau B/C/D). NB : exemption existante pour certaines exploitations.
- **Implémentation** : drilldown « Expérience récente » affiche jour ET nuit. Nuit = somme `toNight` / `ldgNight` des vols admissibles (jamais inféré — un décollage de jour peut précéder un atterrissage de nuit) ; sim limité aux FFS via `countsTowardRecency`. Présenté comme indicateur informatif (pas un blocage) + note exemption « référez-vous à votre exploitant ». [src/js/21-dash-drilldown.js](../src/js/21-dash-drilldown.js)
- **Source** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-401.05-20251217.html
- **Vérifié** : 2026-06-25 ✓ (donnée décollages jour/nuit ajoutée au formulaire le même jour).

## ✅ Fenêtres 401.05 — décision d'implémentation « date civile LOCALE » (2026-07-17)
- **Contexte** : même famille de bogue que la page Service (§700.27, décision 2026-07-16) — `toISOString()` donne la date **UTC**, qui bascule au lendemain en soirée à Toronto, décalant chaque coupure d'un jour.
- **Décision** : toutes les fenêtres de récence 401.05 (6 mois passagers/IFR, 12 mois d'inférence IFR) sont ancrées sur la **date civile locale** (`localTodayStr()`, getFullYear/getMonth/getDate — jamais `toISOString()`), puis l'arithmétique se fait en UTC pur sur la chaîne YYYY-MM-DD (`shiftDateStr` / `shiftMonthsStr`), insensible à l'heure d'été.
- **Bornes 6/12 mois (inchangées, seulement fiabilisées)** : coupure = même quantième N mois en arrière, **inclus** (`date >= cutoff`) — sémantique `setMonth` conservée telle que vérifiée 2026-06-25 ; un quantième inexistant roule vers l'avant (31 mai − 6 mois → « 31 nov. » → 1er déc.), la fenêtre ne s'élargit jamais. Ce n'est **pas** une interprétation réglementaire nouvelle : le texte dit « within the six months preceding the flight », la coupure exacte au quantième reste la convention d'implémentation existante.
- **Borne haute = aujourd'hui (local)** : un vol daté dans le futur n'est pas « within the preceding … months » → exclu de tous les compteurs (`date <= today`), comme au §700.27.
- **Item PDF « 90-day recency » (Operator best practice, PAS un texte réglementaire)** : aligné sur la convention §700.27 — 90 jours = **exactement 90 dates civiles locales** `[aujourd'hui − 89 … aujourd'hui]`.
- **Implémentation** : `localTodayStr` / `shiftDateStr` / `shiftMonthsStr` + `sixMonthCutoffStr()` (source unique, anneau = alertes = carte = PDF) dans [src/js/02-data.js](../src/js/02-data.js) ; consommateurs [src/js/03-dashboard.js](../src/js/03-dashboard.js) et [src/js/12-pdf-export.js](../src/js/12-pdf-export.js). Pinné par `test/currency-windows.mjs` (soirée locale → coupures du bon jour ; quantième inclus ; vol futur exclu ; 90 dates exactement).

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
- **Règle (CAR 700.27, SOR/2018-269)** : le temps de vol d'un membre d'équipage de conduite ne doit pas dépasser **112 h en 28 jours consécutifs** · **300 h en 90 jours consécutifs** · **1000 h en 365 jours consécutifs** · **8 h en 24 h consécutives (aéronef utilisé par un seul pilote seulement — texte exact à l'alinéa ci-dessous)**. Le temps de vol inclut celui accumulé dans d'autres exploitations. S'applique aux exploitations commerciales (Subpartie 700 : 705/704/703).
- ⚠️ **CAR 700.15 est RÉSERVÉ** (ancien article, remplacé par les règles de fatigue 2018) → citer **700.27**, JAMAIS 700.15.
- **Alinéa 8 h/24 h — texte officiel FR transcrit mot à mot (vérifié 2026-07-16)** : « d) dans le cas d'un aéronef utilisé par un seul pilote, 8 heures par période de 24 heures consécutives. » (RAC 700.27(1)d)). Ni « monopilote » ni « IFR »/« règles de vol aux instruments » n'apparaissent dans l'article : la condition exacte est **aéronef utilisé par un seul pilote**, pas « exploitations monopilotes » en général ni « IFR monopilote ». Source FR : https://laws-lois.justice.gc.ca/fra/reglements/DORS-96-433/section-700.27.html (WebFetch 2026-07-16, version EN concordante, deux transcriptions concordantes).
- **Alinéa 8 h/24 h — texte officiel EN transcrit mot à mot (vérifié 2026-07-16)** : « (d) in the case of a single-pilot operation, 8 hours in any 24 consecutive hours. » (CAR 700.27(1)(d)). Ni « IFR » ni « instrument » n'apparaissent dans l'article ; la locution exacte est **single-pilot operation**. Source EN : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-700.27.html (WebFetch 2026-07-16, deux extractions concordantes). Utilisé verbatim dans `private/mockups/duty-final-en.html`.
- **Source primaire** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-700.27.html (WebFetch, 2026-06-30) + confirmé section 700.15 « [Reserved, SOR/2018-269, s. 13] ».
- **🛑 700.27(2) — DEUX alinéas, pas un (corrigé 2026-07-17)** : le registre ne consignait que le a) et le présentait comme si (2) n'avait qu'un alinéa. Texte intégral du (2), transcrit du XML officiel (deux chemins concordants : section HTML + `/fra/XML/DORS-96-433.xml`) :
  - **FR** : « (2) Pour l'application du paragraphe (1), le temps de vol du membre d'équipage de conduite comprend : a) d'une part, le temps de vol accumulé lors d'autres opérations aériennes; b) d'autre part, le temps de vol total d'un vol avec un équipage de conduite renforcé. »
  - **EN** : « (2) For the purpose of subsection (1), a flight crew member's flight time includes (a) the flight time accumulated from other flight operations; and (b) the total flight time of a flight with an augmented flight crew. »
- **🛑 700.27(2)a) — limite d'exhaustivité (vérifié 2026-07-17)** : le cumul légal **inclut le temps de vol accumulé lors d'AUTRES opérations aériennes**, que Cumulo **ne connaît que si Martin l'a saisi**. ⇒ **un « OK » de l'app n'est JAMAIS une preuve de légalité** sur les 112/300/1000 h. Dépassement détecté = fiable ; non-dépassement = ne prouve rien. Voir **PRINCIPE D'ASYMÉTRIE**.
- **🛑 700.27(2)b) — équipage de conduite renforcé (ajouté 2026-07-17)** : le **temps de vol TOTAL** d'un vol avec équipage renforcé compte au cumul 112/300/1000 h, **sans réduction**, même si le membre s'est reposé en vol. ⚠️ Ne pas confondre avec **700.60** (équipage renforcé = FDP plus long) : le renfort allonge le FDP permis mais **n'allège PAS** le compteur de temps de vol. Deux régimes opposés, à ne jamais mélanger. Terme FR officiel = « équipage de conduite **renforcé** » (⚠️ le titre de 700.60 emploie le même mot ; le registre écrivait « augmenté » dans la section 700.28, calque de « augmented » : garder « renforcé » pour toute nouvelle chaîne FR). Portée pratique : hors scénario Porter v1 (F/O non renforcé), consigné pour fermer l'article.
- **Textes désignés (annexe de la sous-partie 700, vérifié 2026-07-17)** : **700.27(1) = 5 000 $ / 25 000 $** (personne physique / personne morale). Le **(2) n'est PAS désigné** (c'est une règle d'interprétation, pas une interdiction).
- **🛑 700.27(1)d) ne s'applique PAS à Martin (vérifié 2026-07-17)** : « aéronef utilisé par un seul pilote » / « single-pilot operation ». **Aucune mention d'« IFR » dans l'article.** E195 multi-équipage 705 ⇒ le **8 h / 24 h ne doit jamais être compté contre lui**.
- **700.27(1) LIE LE MEMBRE** : formule « et à un membre d'équipage de conduite d'accepter une telle assignation » **présente** (vérifié par contraste sur le texte brut, 2026-07-17). Infraction personnelle de Martin s'il accepte au-delà ⇒ un dépassement détecté déclenche aussi l'obligation d'aviser de **700.26(4)**.
- **« Par jour » multi-équipage** : pour un pilote 705 multi-équipage, PAS de limite simple de temps de vol par jour — le plafond quotidien est la **période de service de vol (FDP)** (table selon heure de présentation + nb de vols, 700.28+). ⇒ le tracker affiche les 3 limites cumulatives (28/90/365 j) + note renvoyant au programme de l'exploitant ; le 8 h/24 h ne vaut que monopilote. Ne PAS coder de limite FDP quotidienne de mémoire.
- **Implémentation** : `25-duty-tracker.js` somme le temps de vol (hors sim) dans les fenêtres glissantes 28/90/365 j vs 112/300/1000 h ; vert / ambre (≥75 %) / rouge (≥100 %).
- **Fenêtre glissante : décision d'implémentation (2026-07-16)** : « toute période de 28 jours consécutifs » (700.27) = **exactement N dates civiles LOCALES incluant aujourd'hui**. Bornes : cutoff = aujourd'hui − (N−1) ; sélection = cutoff ≤ date ≤ aujourd'hui (la borne haute exclut tout vol daté dans le futur). Idem 90 j (90 dates) et 365 j (365 dates). « Aujourd'hui » = date civile locale (getFullYear/getMonth/getDate), JAMAIS `toISOString()` (= date UTC, qui bascule au lendemain en soirée à Toronto). Raison : bogue attrapé par Martin en prod le 2026-07-16 — la page Service affichait « June 18 to July 17 inclusive, 30 dates » (cutoff inclusif à aujourd'hui − N = 29 dates, plus « aujourd'hui » calculé en UTC = 30e date et projection démarrée au mauvais jour). Correctif : `_dutyLocalToday()` + bornes N−1 dans `25-duty-tracker.js`, pinné par `test/duty-projection.mjs` (fenêtre = exactement 28 dates ; 29e jour exclu ; vol daté demain exclu ; projection part d'aujourd'hui local).

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
- **Vols à très longue distance — RAC 700.62** (titre officiel FR ; EN « Ultra Long-range Flights ». ⚠️ le registre disait « Plafonds absolus » : étiquette **inventée**, corrigée 2026-07-17, voir la section 700.62) : 700.62(1) **FDP** jamais > **18 h** ; 700.62(2) temps de vol prévu **D'UN VOL** jamais > **16 h** (⚠️ **un vol, pas le FDP** : ne jamais sommer les vols d'un FDP pour ce seuil).
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

## ✅ Nombre maximal d'heures de travail (RAC/CAR 700.29) — vérifié 2026-07-17
- **Numéro** : RAC 700.29 / CAR 700.29. **Titre FR** : « Nombre maximal d'heures de travail ». **Titre EN** : « Maximum Number of Hours of Work ».
- **Historique (CORRIGÉ 2026-07-17 — il porte DEUX entrées, pas une)** : **DORS/2018-269, art. 13** ET **DORS/2022-246, art. 17** (EN : **SOR/2018-269, s. 13** + **SOR/2022-246, s. 17**). Le registre n'en consignait qu'une. Confirmé sur le XML officiel (bloc `HistoricalNote` de l'article). Texte consolidé DORS/SOR-96-433, à jour 2026-05-26, dernière modification 2026-01-05.
- **Source FR** : https://laws-lois.justice.gc.ca/fra/reglements/DORS-96-433/section-700.29.html
- **Source EN** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-700.29.html
- **Vérifié** : 2026-07-17 (deux extractions concordantes depuis le XML/HTML brut : section HTML + `/fra/XML/DORS-96-433.xml` et `/eng/XML/SOR-96-433.xml`).
- **Chiffres vérifiés** : **2 200 h par 365 jours consécutifs** · **192 h par 28 jours consécutifs** · **60 h par 7 jours consécutifs** si l'exploitant a accordé au membre **1 journée ISOLÉE sans service en 168 heures consécutives** ET **4 journées ISOLÉES sans service par période de 672 heures consécutives** ; **OU 70 h par 7 jours consécutifs** si l'exploitant a accordé **une période sans service de 120 heures consécutives, qui comprend 5 nuits de repos locales CONSÉCUTIVES, en 504 heures consécutives**, aux trois conditions cumulatives de 700.29(1)d) : (i) aucune assignation à un service de début de journée, de fin de journée ou de nuit ; (ii) aucune assignation à une PSV de plus de 12 heures ; (iii) le nombre maximal d'heures de travail du membre est de 24 heures par période de 48 heures consécutives.
- **🛑 DÉRIVE DE PARAPHRASE CORRIGÉE 2026-07-17 — « journée ISOLÉE sans service »** : le registre écrivait « 1 journée sans service » / « 4 journées sans service ». Le texte dit « **1 journée isolée sans service** » / « **4 journées isolées sans service** » (EN : « **single day free from duty** »). Le mot « isolée » n'est pas un ornement : **« journée isolée sans service » est un TERME DÉFINI à 700.01** (voir la section DÉFINITIONS ci-dessous), et sa définition est bâtie sur « nuit de repos locale », elle-même ancrée à l'endroit d'acclimatation. Laisser tomber « isolée » faisait lire l'unité de compte comme une simple journée de congé au calendrier : **faux**, et c'est exactement l'erreur qui rendrait un compteur hebdo plausible mais inventé. Citer au mot près, toujours.
- **700.29(2) (vérifié 2026-07-17)** : lie **l'EXPLOITANT seulement** (« L'exploitant aérien qui a assigné... veille à ce que »). Après un dépassement du 60 h de l'alinéa (1)c), l'exploitant doit fournir 120 h consécutives sans service incluant 5 nuits de repos locales consécutives avant d'assigner un nouveau dépassement de cet alinéa. Obligation de Porter, pas de Martin.
- **Textes désignés (annexe de la sous-partie 700, vérifié 2026-07-17)** : **700.29(1) = 5 000 $ / 25 000 $** · **700.29(2) = 3 000 $ / 15 000 $** (personne physique / personne morale). Le **(3) n'est PAS désigné**.
- **LIE LE MEMBRE** : oui. L'article interdit à l'exploitant d'assigner **et au membre d'équipage de conduite d'accepter une telle assignation** (même forme liante que 700.27(1) et 700.28(1)). C'est donc une infraction PERSONNELLE de Martin s'il accepte au-delà.
- **🛑 CRUCIAL — « heures de travail » / « hours of work » n'est PAS un terme défini au RAC** : **re-vérifié 2026-07-17 par une méthode reproductible** (recherche des balises `<DefinedTermFr>heures de travail</DefinedTermFr>` et `<DefinedTermEn>hours of work</DefinedTermEn>` dans le XML complet des deux langues : **0 occurrence** comme terme défini, dans TOUT le règlement, pas seulement 101.01). Idem « **période sans service** » / « **time free from duty** » : **0 occurrence** comme terme défini. **700.29(3) n'énumère que des INCLUSIONS** (réserve comptée à **33 %** du temps en période de disponibilité en réserve, attente comptée à **100 %**) : c'est une liste d'inclusions, **PAS une définition exhaustive**. On ne peut donc pas savoir ce qui compose le total complet.
- **Plafond hebdomadaire INDÉTERMINÉ pour Cumulo — DOUBLE motif (précisé 2026-07-17)** : (1) 60 h vs 70 h dépend de ce que **l'exploitant a accordé** (journées isolées sans service / 120 h + 5 nuits de repos locales), et Cumulo n'a aucune visibilité sur ce que Porter a accordé ; (2) **plus profond** : l'**unité de compte elle-même n'est pas définie**. « Journée isolée sans service » (700.01) est bâtie sur « période sans service », terme **jamais défini**, et sur « nuit de repos locale », ancrée à l'endroit d'acclimatation (inconnu). ⇒ indéterminé **par manque de définition**, pas seulement par manque de données. Aucune quantité de données Porter ne débloquerait ce calcul.
- **Implémentation — calculable = NON.** Ce que l'app **ne peut PAS** faire : afficher un plafond hebdomadaire (ni 60, ni 70) ; afficher un total d'heures de travail présenté comme **complet** ; présenter un total sous 192 h ou 2 200 h comme « conforme ». Ce que l'app **peut** faire, au mieux : un **PLANCHER** honnête, étiqueté comme tel (« au moins X h connues », jamais « X h travaillées »). Toute détection positive de dépassement reste fiable (asymétrie) ; l'absence de détection n'est PAS un feu vert.

## ✅ Périodes de service de vol consécutives (RAC/CAR 700.51) — vérifié 2026-07-17
- **Numéro** : RAC 700.51 / CAR 700.51. **Titre FR** : « Périodes de service de vol consécutives ». **Titre EN** : « Consecutive Flight Duty Periods ».
- **Historique** : DORS/2018-269, art. 13 (FR) / SOR/2018-269, s. 13 (EN).
- **Source FR** : https://laws-lois.justice.gc.ca/fra/reglements/DORS-96-433/section-700.51.html
- **Source EN** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-700.51.html
- **Vérifié** : 2026-07-17 (deux extractions concordantes, texte brut).
- **Citation FR verbatim** :
  > « 700.51 (1) Il est interdit à l'exploitant aérien d'assigner au membre d'équipage de conduite plus de trois périodes de service de vol consécutives si une partie de celles-ci tombe entre 2 h et 5 h 59, à moins qu'il ne lui accorde une nuit de repos locale à la fin de la troisième période de service de vol.
  >
  > (2) Il peut toutefois lui assigner jusqu'à cinq périodes de service de vol consécutives même si une partie de celles-ci tombe entre 2 h et 5 h 59 s'il lui accorde :
  >
  > a) une période de repos de trois heures dans un poste de repos approprié au cours de chaque période de service de vol;
  >
  > b) une période sans service de 56 heures consécutives à la fin de la dernière des périodes de service de vol consécutives. »
- **Citation EN verbatim** :
  > « 700.51 (1) An air operator shall not assign to a flight crew member more than three consecutive flight duty periods if any part of those periods falls between 02:00 and 05:59, unless the air operator provides the member with one local night's rest at the end of the third flight duty period.
  >
  > (2) However, an air operator may assign to a flight crew member up to five consecutive flight duty periods even if any part of those periods falls between 02:00 and 05:59 if the member is provided with
  >
  > (a) a rest period of three hours in suitable accommodation during each flight duty period; and
  >
  > (b) 56 consecutive hours free from duty at the end of the last consecutive flight duty period. »
- **🛑 NE LIE PAS LE MEMBRE — c'est l'infraction de PORTER, pas celle de Martin (re-confirmé 2026-07-17)** : le texte dit « Il est interdit à **L'EXPLOITANT AÉRIEN** d'assigner » et **s'arrête là**. Il n'ajoute **JAMAIS** « et à un membre d'équipage de conduite d'accepter une telle assignation ». **Vérifié par contraste sur le texte brut** (voir la liste **non exhaustive** au PRINCIPE D'ASYMÉTRIE). 700.51(1) est un texte désigné (**5 000 $** personne physique / **25 000 $** personne morale ; le **(2) n'est PAS désigné**), mais **seule la partie visée par l'interdiction peut y contrevenir** : la désignation vise l'exploitant qui assigne. ⇒ **Accepter l'échange n'est PAS une infraction de Martin sous 700.51. C'est celle de Porter.** Conséquences, non négociables : le simulateur ne doit **jamais** dire à Martin « tu ne peux pas accepter » au nom de 700.51, ni présenter 700.51 comme une raison **pour lui** de refuser, ni lui attribuer un risque d'amende sous cet article. La seule utilité de 700.51 pour lui est **informative** : savoir quelle question poser au scheduler (voir ci-dessous).
- **🚨 CORRECTION 2026-07-17 — « poste de repos approprié » EST DÉFINI (la faute la plus grave du registre)** : ce registre affirmait que « poste de repos approprié / suitable accommodation » était « employé 22 fois dans le RAC, **JAMAIS défini** : vérifié, zéro entrée définitionnelle ». **C'était FAUX**, et le mot « vérifié » était accolé à une affirmation que personne n'avait vérifiée. **Le terme EST défini à 101.01** (voir la section DÉFINITIONS ci-dessous pour le verbatim FR et EN complet, transcrit du XML officiel). ⇒ Ce n'est **pas** une donnée manquante par absence de définition : la définition existe et elle est **qualitative** (chambre pour une personne, bruit minimal, ventilée, contrôle température/lumière, ou local approprié au lieu et à la saison). Ce que Cumulo n'a pas, c'est le **FAIT** de savoir si le local fourni y répond : Cumulo ne voit pas la chambre. La conclusion opérationnelle (ne rien inférer d'un hôtel) est **inchangée** ; c'est le MOTIF qui était faux.
- **Données que Cumulo n'a pas** (chaque chemin vers une conclusion bute sur l'une d'elles) : bornes de PSV (présentation/libération) pour **chaque** période consécutive (le roster PDF les donne parfois, l'iCal non) ; **fuseau de référence du créneau « 2 h à 5 h 59 » de 700.51 : voir la nuance ci-dessous, l'ambiguïté est réelle mais elle était SURESTIMÉE** ; définition de « **consécutives** » (le règlement ne dit pas ce qui BRISE une chaîne de PSV) ; conformité **factuelle** du « poste de repos approprié » fourni (terme défini à 101.01, mais fait non observable par Cumulo) ; repos réellement **accordé** ; **période sans service de 56 h** (exige le roster FUTUR complet après le dernier PSV, souvent inconnu au téléphone) ; **programme approuvé / pratiques de Porter**.
- **⚖️ AMBIGUÏTÉ DU CRÉNEAU 2 h à 5 h 59 — caractérisation CORRIGÉE 2026-07-17 (nuancée, toujours PAS tranchée)** : le registre disait le fuseau « non tranché par le règlement, à ne pas combler par supposition », **sans mentionner que le RAC définit un créneau identique**. Fait vérifié : **« phase de dépression circadienne » / « window of circadian low » est défini à 700.01** comme « Période commençant à **2 h** et se terminant à **5 h 59** à l'endroit où le membre d'équipage de conduite est **acclimaté** » : **exactement le même créneau**, explicitement ancré à l'endroit d'acclimatation. C'est un argument sérieux pour lire 700.51 de la même façon. **MAIS l'argument contraire est au moins aussi fort, et il est structurel** : 700.51 **n'emploie PAS** le terme défini, il écrit le créneau en clair, **alors que le législateur emploie bel et bien le terme défini quand il le veut** (vérifié 2026-07-17 : **700.61** dit « pendant la **phase de dépression circadienne** du membre » / « within the member's **window of circadian low** »). Un rédacteur qui dispose du terme défini et choisit de ne pas s'en servir à 700.51 n'est pas présumé dire la même chose. ⇒ **L'ambiguïté RESTE OUVERTE. Ne pas la trancher, ne pas la coder comme acquise.** Question à poser à Martin / TC, jamais une supposition affichée comme un fait.
- **Implémentation — calculable = NON.** Aucun verdict possible. **Usage légitime unique** : un **drapeau de SENSIBILISATION**, jamais un verdict, jamais bloquant, **SI et SEULEMENT SI** le roster fournit présentation/libération ET que **4 PSV consécutifs ou plus** semblent toucher le créneau 2 h à 5 h 59, **en affichant explicitement le fuseau retenu comme HYPOTHÈSE non tranchée par le règlement**. Forme : « Cet échange pourrait porter à 4+ tes PSV consécutifs touchant 2 h à 5 h 59. RAC 700.51 encadre ça : c'est l'obligation de l'exploitant, pas la tienne. Question à poser au scheduler : nuit de repos locale prévue après le 3e ? » ⇒ ça donne à Martin une **question à poser au téléphone**, pas une décision.
- **🛑 À NE JAMAIS FAIRE** : afficher « conforme » / « OK » ; **trancher** le fuseau du créneau 2 h à 5 h 59 (l'ambiguïté est réelle, voir ci-dessus : le RAC définit le même créneau à 700.01 mais 700.51 n'emploie pas le terme défini) ; inférer qu'un hôtel **satisfait** la définition de « poste de repos approprié » de 101.01 (le terme **est** défini, mais Cumulo ne voit pas la chambre : c'est un fait non observable, pas une définition manquante) ; présumer les 56 h à partir d'un roster incomplet ; présenter 700.51 comme une raison pour Martin de **refuser** ou comme **son** infraction.

## ✅ Aptitude au travail (RAC/CAR 700.26) — vérifié 2026-07-17
- **Numéro** : RAC 700.26 / CAR 700.26. **Titre FR** : « Aptitude au travail ». **Titre EN** : « Fitness for Duty ». ⚠️ **C'est le SOUS-TITRE couvrant TOUT l'article 700.26, PAS le titre du paragraphe (4)** : ne pas conflater les deux (le (4) ne parle ni de fatigue ni d'aptitude subjective).
- **Historique** : DORS/2018-269, art. 13 (FR) / SOR/2018-269, s. 13 (EN). Règlement à jour 2026-05-26 ; dernière modification 2026-01-05. **700.22 à 700.25 réservés** ; 700.23 « [Réservé, DORS/2018-269, art. 13] ».
- **Textes désignés (annexe de la sous-partie 700, vérifié 2026-07-17)** — personne physique / personne morale : **700.26(1) = 5 000 $ / 25 000 $** (l'amende la plus lourde de l'article vise **l'EXPLOITANT** qui laisse partir un membre qui l'a avisé qu'il n'est pas apte) · **700.26(2) = 1 000 $ / 5 000 $** · **700.26(3) = 1 000 $ / 5 000 $** · **700.26(4) = 1 000 $ / 5 000 $** · **700.26(5) = 1 000 $ / 5 000 $**. ⚠️ Lecture à retenir : **manquer à l'obligation d'aviser du (4) est un texte désigné qui vise Martin personnellement (1 000 $)**. Ça reste **une obligation de PARLER**, jamais une interdiction d'accepter : ne pas la présenter comme un pouvoir de refus.
- **Source FR** : https://laws-lois.justice.gc.ca/fra/reglements/DORS-96-433/section-700.26.html
- **Source EN** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-700.26.html
- **Vérifié** : 2026-07-17 (deux extractions concordantes, texte brut).
- **Citation FR verbatim** :
  > « Aptitude au travail
  >
  > 700.26 (1) Il est interdit à l'exploitant aérien de permettre à un membre d'équipage de conduite de commencer une période de service de vol si, avant le début de celle-ci, le membre l'avise qu'il est fatigué au point de ne pas être apte au travail.
  >
  > (2) Le membre d'équipage de conduite avise tout autre membre d'équipage de conduite ainsi que l'exploitant aérien dès qu'il se rend compte au cours d'une période de service de vol qu'il est fatigué au point de ne pas être apte au travail.
  >
  > (3) Lorsqu'un seul membre d'équipage de conduite est à bord d'un aéronef et qu'il se rend compte au cours d'une période de service de vol qu'il est fatigué au point de ne pas être apte au travail, il en avise l'exploitant aérien immédiatement ou, si l'aéronef est en vol, dès que possible après l'atterrissage.
  >
  > (4) Lorsqu'une personne chargée par l'exploitant aérien d'agir en qualité de membre d'équipage de conduite ou toute autre personne se rend compte que l'affectation entraînerait le dépassement du temps de vol maximal, de la période maximale de service de vol ou du nombre maximal d'heures de travail, le membre ou l'autre personne en informe l'exploitant aérien dès que possible.
  >
  > (5) Lorsqu'un membre d'équipage de conduite ou toute autre personne se rend compte que le membre ne s'est pas vu accorder une période de repos ou une période sans service, le membre ou l'autre personne en avise l'exploitant aérien dès que possible.
  >
  > DORS/2018-269, art. 13 »
- **Citation EN verbatim** :
  > « Fitness for Duty
  >
  > 700.26 (1) An air operator shall not allow a flight crew member to begin a flight duty period if, before the beginning of the period, the member advises the air operator that they are fatigued to the extent that they are not fit for duty.
  >
  > (2) A flight crew member shall advise every other flight crew member and the air operator as soon as the member becomes aware that they have become fatigued during a flight duty period to the extent that they are not fit for duty.
  >
  > (3) If there is only one flight crew member on board the aircraft, and the member becomes aware during a flight duty period that they have become fatigued to the extent that they are not fit for duty, they shall advise the air operator immediately or, if the aircraft is in flight, as soon as possible after the aircraft has landed.
  >
  > (4) If a person who is assigned by an air operator to act as a flight crew member, or any other person, becomes aware that the assignment would result in the maximum flight time, maximum flight duty period or maximum number of hours of work being exceeded, the member or other person shall advise the air operator as soon as possible.
  >
  > (5) If a flight crew member or any other person becomes aware that the member was not granted their rest period or time free from duty, the member or other person shall advise the air operator as soon as possible.
  >
  > SOR/2018-269, s. 13 »
- **Qui est lié (lecture du texte brut)** :
  - **(1)** lie l'**EXPLOITANT** seulement (« Il est interdit à l'exploitant aérien de permettre... »). Le déclencheur = **Martin avise**. Son **levier**, pas son infraction.
  - **(2)** et **(3)** lient le **MEMBRE** (« Le membre... avise »). Fatigue survenant **PENDANT** la PSV. **(3) = pilote seul à bord ⇒ NE S'APPLIQUE PAS à Martin** (705 multi-équipage E195).
  - **(4)** et **(5)** lient le **MEMBRE** (« le membre ou l'autre personne en informe/avise l'exploitant aérien dès que possible »).
  - **Différence de FORME avec 700.27(1)** : 700.27 interdit d'**ACCEPTER** (« et à un membre d'équipage de conduite d'accepter une telle assignation »). **700.26(4) n'interdit rien** : c'est une **OBLIGATION POSITIVE DE PARLER**. Ce n'est donc pas un 2e « non » : c'est ce qui oblige Martin à **ouvrir la bouche** au téléphone.
- **Implémentation — calculable = NON.** 700.26 ne contient **aucun chiffre, aucune table, aucun seuil** : Cumulo ne peut rien calculer **à partir de** 700.26. **MAIS le DÉCLENCHEUR du (4) est déjà calculé ailleurs** : « temps de vol maximal » = **700.27** (112/300/1000/8 h) · « période maximale de service de vol » = **700.28 + 700.62/700.63** · « nombre maximal d'heures de travail » = **700.29**. ⇒ 700.26(4) ne s'implémente pas comme un calcul : il s'**ACCROCHE en aval** des calculs existants.
- **Respect de l'asymétrie (point clé)** : 700.26(4) ne survit à l'asymétrie que dans le **sens POSITIF**. Quand Cumulo dit « ça dépasse », le (4) transforme ce résultat en **devoir juridique personnel** : informer Porter dès que possible (côté « non » de l'asymétrie, renforcé). Quand Cumulo ne détecte rien, le (4) **ne se déclenche PAS pour autant** : la condition légale est « **se rend compte** », pas « Cumulo a détecté ». L'absence de détection n'est ni un feu vert ni une absence d'obligation (Martin peut se rendre compte autrement : temps de vol d'autres opérations aériennes au sens de **700.27(2)a)**, planification décrite de vive voix par scheduling, etc.). **NE JAMAIS afficher « aucune obligation d'aviser ».**
- **Affichage — trois traitements distincts, ne pas les mélanger** :
  1. **(4)** ⇒ **PAS un calcul**, mais une **CONSÉQUENCE attachée à chaque verdict de dépassement déjà produit** (700.27/700.28/700.29). Quand un dépassement est détecté, ajouter au verdict : « Tu dois en informer l'exploitant dès que possible (RAC 700.26(4)). » Seule partie de 700.26 à brancher à la logique.
  2. **(1)(2)** ⇒ **RAPPEL PUR, jamais un calcul.** L'aptitude/fatigue est un état **subjectif** que Cumulo ne peut ni mesurer, ni inférer, ni contredire (aucune donnée : pas de sommeil, pas d'état ressenti, pas de PGRF Porter). **Ressort EXCLUSIF de Martin.** Rappel discret suffisant : « la légalité des heures ne dit rien de ton aptitude ; RAC 700.26(1) te permet de refuser en avisant que tu n'es pas apte ». **Ne JAMAIS écrire « tu es apte »** ni laisser un écran vert le sous-entendre : **piège d'asymétrie le plus dangereux de tout le simulateur**, parce qu'un « rien à signaler » sur les heures peut se lire comme un feu vert sur la fatigue.
  3. **(5)** ⇒ rappel, partiellement adossé aux données d'horaire (repos / période sans service). Même asymétrie : détection positive = obligation d'aviser ; silence ≠ repos accordé.
  4. **(3)** ⇒ **NE PAS afficher** (pilote seul à bord, hors scénario Martin). L'afficher = bruit réglementaire.
- **Donnée manquante** : aptitude/fatigue subjective (700.26(1)(2)) : Cumulo n'a **AUCUNE** donnée. Non mesurable, non inférable.

## ✅ Périodes de repos et articles réservés (Sous-partie 700, Division III) — vérifié 2026-07-17
- **700.30 à 700.35 = RÉSERVÉS** (pas « n'existent pas ») : aucun texte, **rien à citer**. Ne jamais y renvoyer dans le copy ni dans le code.
- **Les périodes de repos vivent à 700.40 à 700.43** : **700.40** généralités · **700.41** horaires perturbateurs · **700.42** décalage horaire · **700.43** mise en place.
- **700.40 ne lie PAS le membre** (vérifié par contraste sur le texte brut : pas de formule « et à un membre d'équipage de conduite d'accepter une telle assignation »).
- **⏳ Verbatim EN de 700.40 à obtenir avant tout affichage EN** : non transcrit à ce jour, **NE PAS l'inventer ni le traduire**. Idem 700.41 / 700.43 (700.42(1)(a) = 11 h et (1)(b) = 14 h déjà confirmés byte-stable, voir section 700.28).
- **Source FR** : https://laws-lois.justice.gc.ca/fra/reglements/DORS-96-433/section-700.40.html · **EN** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-700.40.html

## ✅ Vols à très longue distance (RAC/CAR 700.62) — titre et (2) corrigés 2026-07-17
- **Numéro** : RAC 700.62 / CAR 700.62. **Titre FR officiel** : « **Vols à très longue distance** ». **Titre EN officiel** : « **Ultra Long-range Flights** ».
- **🛑 TITRE CORRIGÉ 2026-07-17 — le registre avait INVENTÉ « Plafonds absolus »** : aucun titre de ce nom n'existe au règlement ; c'était une étiquette maison, forgée pour décrire l'effet de l'article, puis écrite comme si elle venait du texte. ⚠️ **La correction demandée proposait « Vols ultra-long-courriers » comme titre FR : c'est FAUX AUSSI** (calque de l'anglais). Le titre FR officiel, vérifié par **deux chemins indépendants** (XML complet `/fra/XML/DORS-96-433.xml`, bloc `Heading` précédant l'article + table des matières du texte consolidé FR), est « **Vols à très longue distance** ». Les deux chemins concordent. Ne jamais reprendre « Plafonds absolus » ni « Vols ultra-long-courriers ».
- **Historique** : DORS/2018-269, art. 13 (FR) / SOR/2018-269, s. 13 (EN). Une seule entrée (vérifié).
- **Source FR** : https://laws-lois.justice.gc.ca/fra/reglements/DORS-96-433/section-700.62.html · **EN** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-700.62.html
- **Vérifié** : 2026-07-17 (deux extractions concordantes : section HTML brute + XML complet, les deux langues).
- **Citation FR verbatim** :
  > « 700.62 (1) Il est interdit à l'exploitant aérien d'assigner une période de service de vol de plus de 18 heures à un membre d'équipage de conduite et au membre d'accepter une telle assignation.
  >
  > (2) Il est interdit à l'exploitant aérien d'assigner un vol dont le temps de vol prévu est de plus de 16 heures à un membre d'équipage de conduite et au membre d'accepter une telle assignation. »
- **Citation EN verbatim** :
  > « 700.62 (1) An air operator shall not assign a flight duty period of more than 18 hours to a flight crew member and a member shall not accept such an assignment.
  >
  > (2) An air operator shall not assign a flight crew member to a flight with a scheduled flight time of more than 16 hours, and a member shall not accept such an assignment. »
- **700.62 LIE LE MEMBRE** : oui, **aux deux paragraphes** (« et au membre d'accepter une telle assignation » / « and a member shall not accept such an assignment »). Infraction personnelle de Martin s'il accepte au-delà.
- **🛑 SUR-INTERPRÉTATION CORRIGÉE 2026-07-17 — le (2) vise UN VOL, PAS le FDP** : le registre écrivait que « le 16 h prévu est calculable dès que le roster fournit le temps de vol prévu **DU FDP** ». **Faux.** Le texte vise « **un vol** dont le temps de vol prévu est de plus de 16 heures » / « **a flight** with a scheduled flight time of more than 16 hours ». **Un FDP n'est pas un vol** : un FDP peut contenir plusieurs vols et totaliser plus de 16 h de temps de vol prévu **sans qu'aucun vol** ne dépasse 16 h. Additionner les vols d'un FDP pour les comparer au 16 h **fabriquerait un dépassement qui n'existe pas** au sens du (2). ⇒ le seuil se compare **vol par vol**, jamais à une somme. C'est **exactement la même erreur de type que « IFR monopilote » à 700.27(1)d)** : lire dans le texte une portée qu'il n'a pas. Le (1), lui, vise bien le **FDP**. Deux unités différentes dans le même article : ne pas les mélanger.
- **Textes désignés (annexe de la sous-partie 700, vérifié 2026-07-17)** : **700.62(1) = 5 000 $ / 25 000 $** · **700.62(2) = 5 000 $ / 25 000 $** (personne physique / personne morale).
- **Portée réelle pour Martin** : **quasi nulle en pratique** (E195 court/moyen-courrier : aucun vol prévu de plus de 16 h, aucun FDP de plus de 18 h). Consigné pour l'exactitude et parce que l'article **le lie personnellement**, pas parce qu'il risque de se déclencher. Ne pas encombrer l'UI avec.
- **Implémentation** : **(2) calculable UNIQUEMENT vol par vol**, si et seulement si le roster fournit le temps de vol **prévu d'un vol donné** ; jamais sur une somme de vols, jamais sur un total de FDP. **(1)** se compare au FDP prévu, avec toutes les réserves de 101.01 sur la PSV (début = plancher, fin = arrêt des moteurs ≠ on-block). Détection positive = verdict fiable + obligation d'aviser (700.26(4)). Silence ≠ feu vert.

## ✅ DÉFINITIONS — DEUX DOMICILES : 700.01 et 101.01 (vérifié 2026-07-17)
- **🛑 CORRECTION STRUCTURELLE** : 700.01 **n'est PAS** le domicile de tout le régime fatigue. **« période de service de vol », « poste de repos approprié », « période de repos », « mise en place » et « membre d'équipage de conduite en attente » vivent à 101.01.** Deux domiciles, pas un. Chercher au mauvais endroit = conclure à tort qu'un terme n'est « jamais défini » (c'est exactement ce qui a produit la faute « suitable accommodation »).
- **Méthode de vérification (reproductible)** : XML officiel complet des deux langues (`https://laws-lois.justice.gc.ca/fra/XML/DORS-96-433.xml` · `https://laws-lois.justice.gc.ca/eng/XML/SOR-96-433.xml`), recherche sur les balises `<DefinedTermFr>` / `<DefinedTermEn>` (et **non** sur le texte rendu), croisée avec les pages `section-700.01.html` / `section-101.01.html` brutes. **Deux chemins concordants pour chaque entrée ci-dessous.**
- **Statut commun à TOUTES les définitions** : une définition **n'interdit rien et ne lie personne** (zéro formule liante, absente de l'annexe des textes désignés). **Jamais citable seule comme motif.** Elle **alimente** les articles liants (700.27 / 700.28 / 700.29 / 700.61 / 700.62).
- **URL** : 700.01 → https://laws-lois.justice.gc.ca/fra/reglements/DORS-96-433/section-700.01.html · https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-700.01.html · 101.01 → https://laws-lois.justice.gc.ca/fra/reglements/DORS-96-433/section-101.01.html · https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-101.01.html

### RAC/CAR 700.01 — structure de l'article
- **Titre FR** : « **Définitions** » (⚠️ **PLURIEL** : ne pas écrire « Définition »). **Titre EN** : « **Interpretation** ». Chapeau FR : « Les définitions qui suivent s'appliquent à la présente partie. » / EN : « In this Part, ». Partie VII (Services aériens commerciaux), Section I (Généralités).
- **Historique** : DORS/2003-121 art. 1 ; DORS/2009-152 art. 2 ; DORS/2018-269 art. 10 ; DORS/2025-98 art. 15 ; DORS/2025-226 art. 8 (EN : SOR/2003-121 s. 1 ; SOR/2009-152 s. 2 ; SOR/2018-269 s. 10 ; SOR/2025-98 s. 15 ; SOR/2025-226 s. 8). Section `lastAmendedDate` = 2025-11-19. **26 définitions** (compte identique FR/EN, apparié 1:1).

### 🔑 acclimaté / acclimatized (700.01) — LE VERROU CENTRAL
- **FR** : « **acclimaté** Se dit du membre d'équipage de conduite dont le biorythme est en phase avec l'heure locale. (acclimatized) »
- **EN** : « **acclimatized** describes a flight crew member whose biorhythm is aligned with local time; (acclimaté) »
- **Historique** : DORS/2018-269 art. 10 (SOR/2018-269 s. 10), en vigueur 2020-12-12, édictée 2018-12-07.
- **Calculable par Cumulo : NON.** Définition **purement qualitative**, aucun chiffre. Les chiffres vivent à **700.28(5)** (72 h / 96 h / 24 h par heure d'écart) et exigent « les repos requis fournis », que Cumulo ne connaît pas. Confirme mot à mot ce que le registre disait déjà (section 700.28).
- **⇒ C'EST LE VERROU** : **6 des termes ci-dessous** (phase de dépression circadienne, nuit de repos locale, journée isolée sans service, service de début de journée, de fin de journée, de nuit) sont ancrés « **à l'endroit où le membre est acclimaté** ». Tant que l'acclimatation n'est pas établie, **aucun ne se calcule**. **Ne JAMAIS présumer « Martin est acclimaté à CYOW / Eastern » parce que sa base est CYOW : la base n'est pas l'acclimatation.**

### phase de dépression circadienne / window of circadian low (700.01)
- **FR** : « **phase de dépression circadienne** Période commençant à 2 h et se terminant à 5 h 59 à l'endroit où le membre d'équipage de conduite est acclimaté. (window of circadian low) »
- **EN** : « **window of circadian low** means the period that begins at 02:00 and ends at 05:59 at the location where the flight crew member is acclimatized. (phase de dépression circadienne) »
- **Historique** : DORS/2018-269 art. 10 (SOR/2018-269 s. 10), en vigueur 2020-12-12.
- **Calculable : NON** (bloqué sur « acclimaté »).
- **🔎 Rapport avec 700.51 — NE PAS TRANCHER** : même créneau **2 h à 5 h 59**, ici explicitement ancré à l'endroit d'acclimatation. **Mais 700.51 n'emploie PAS le terme défini**, il écrit le créneau en clair, **alors que 700.61 emploie bel et bien le terme défini**. ⇒ l'ambiguïté de 700.51 **reste ouverte**. Voir la section 700.51. À poser à Martin/TC, jamais à coder comme acquis.
- **Employé par** : **700.61** (article **liant le membre**).

### nuit de repos locale / local night's rest (700.01)
- **FR** : « **nuit de repos locale** Période de repos d'au moins neuf heures qui a lieu entre 22 h 30 et 9 h 30 à l'endroit où le membre d'équipage de conduite est acclimaté. (local night's rest) »
- **EN** : « **local night's rest** means a rest period of at least nine hours that takes place between 22:30 and 09:30 at the location where the flight crew member is acclimatized; (nuit de repos locale) »
- **Historique** : DORS/2018-269 art. 10 (SOR/2018-269 s. 10), en vigueur 2020-12-12.
- **Calculable : NON.** Terme **composite** : dépend de « période de repos » (101.01) **ET** de « acclimaté ». Double blocage. « Période de repos » **EXCLUT le temps de déplacement** vers/depuis le poste de repos approprié : Cumulo ne connaît jamais ce trajet ⇒ l'écart libération→présentation suivante est un **PLAFOND**, pas la période de repos réelle.
- **💡 EXPLOITATION ASYMÉTRIQUE VALIDE** : si ce **plafond** est déjà **< 9 h**, la vraie période de repos l'est aussi ⇒ on peut **PROUVER l'ABSENCE** d'une nuit de repos locale (jamais sa présence). Utile pour désamorcer un drapeau 700.51 sans jamais dire « conforme ».
- **Alimente** : 700.29(1)d) (5 nuits locales / 504 h) et 700.51(1).

### journée isolée sans service / single day free from duty (700.01)
- **FR** : « **journée isolée sans service** Période sans service comprise entre le début de la première nuit de repos locale et la fin de la nuit de repos locale suivante. (single day free from duty) »
- **EN** : « **single day free from duty** means time free from duty from the beginning of the first local night's rest until the end of the following local night's rest; (journée isolée sans service) »
- **Historique** : DORS/2018-269 art. 10 (SOR/2018-269 s. 10), en vigueur 2020-12-12.
- **🛑 DÉFINITION EN CASCADE SUR DU VIDE. Calculable : NON**, et **pas seulement par manque de données : par manque de définition.** Elle est bâtie sur « **période sans service** » / « **time free from duty** », terme **JAMAIS DÉFINI** dans tout le règlement (vérifié 2026-07-17 : **0 occurrence** comme terme défini, XML des deux langues), **ET** sur « nuit de repos locale » (elle-même non calculable).
- **Portée** : c'est le terme qui **commande le choix 60 h vs 70 h** de 700.29(1). ⇒ **confirme et EXPLIQUE** le « plafond hebdo indéterminé » déjà consigné à 700.29 : indéterminé non pas seulement parce que Porter ne dit pas ce qu'il a accordé, mais parce que **l'unité de compte elle-même n'est pas définie**.

### service de début de journée / early duty (700.01)
- **FR** : « **service de début de journée** S'entend des heures de travail qui commencent entre 2 h et 6 h 59 à l'endroit où le membre d'équipage de conduite est acclimaté. (early duty) »
- **EN** : « **early duty** means hours of work that begin between 02:00 and 06:59 at the location where the flight crew member is acclimatized; (service de début de journée) »
- **Historique** : DORS/2018-269 art. 10 (SOR/2018-269 s. 10), en vigueur 2020-12-12.
- **🛑 DÉFINI SUR UN TERME NON DÉFINI. Calculable : NON.** « **heures de travail** » / « **hours of work** » n'existe **nulle part** comme définition (vérifié 2026-07-17, XML des deux langues, 0 occurrence comme terme défini). Une PSV commence à la présentation, **mais rien ne dit que les « heures de travail » commencent au même instant** : 700.29(3) **n'ÉNUMÈRE QUE des inclusions** (réserve 33 %, attente 100 %), ce n'est pas une définition exhaustive.
- **⇒ Ne JAMAIS étiqueter un vol « service de début de journée » à partir de l'heure de présentation** : ce serait une approximation présentée comme un fait.
- **Alimente** : 700.29(1)d)(i) et 700.41 (horaires perturbateurs).

### service de fin de journée / late duty (700.01)
- **FR** : « **service de fin de journée** S'entend des heures de travail qui se terminent entre minuit et 1 h 59 à l'endroit où le membre d'équipage de conduite est acclimaté. (late duty) »
- **EN** : « **late duty** means hours of work that end between midnight and 01:59 at the location where the flight crew member is acclimatized; (service de fin de journée) »
- **Historique** : DORS/2018-269 art. 10 (SOR/2018-269 s. 10), en vigueur 2020-12-12.
- **Calculable : NON.** Même double blocage qu'« early duty » (« heures de travail » non défini + ancrage « acclimaté »).
- **⚠️ BORNE EXACTE** : « **entre minuit et 1 h 59** » / « between **midnight** and 01:59 ». Le FR dit « **minuit** », **PAS « 0 h » ni « 24 h »**. Ne pas normaliser en « 00:00 » dans le copy FR sans le signaler. ⚠️ Noter que la table 700.28 emploie, elle, « 24:00–03:59 » : conventions différentes selon l'article, ne pas uniformiser de sa propre initiative.
- **Alimente** : 700.29(1)d)(i) et 700.41.

### service de nuit / night duty (700.01)
- **FR** : « **service de nuit** S'entend des heures de travail qui commencent entre 13 h et 1 h 59 et qui se terminent après 1 h 59 à l'endroit où le membre d'équipage de conduite est acclimaté. (night duty) »
- **EN** : « **night duty** means hours of work that begin between 13:00 and 01:59 and that end after 01:59 at a location where the flight crew member is acclimatized; (service de nuit) »
- **Historique** : DORS/2018-269 art. 10 (SOR/2018-269 s. 10), en vigueur 2020-12-12.
- **Calculable : NON** (« heures de travail » non défini + « acclimaté »).
- **⚠️ PIÈGE DE VOCABULAIRE À NE JAMAIS CONFONDRE** : « **service de nuit** » (700.01) n'a **AUCUN** rapport avec « **nuit** » au sens **101.01** (crépuscule civil, déjà au registre) qui sert au **jour/nuit du CARNET**. **Deux termes « nuit » distincts, deux régimes.** Si l'UI affiche les deux, les distinguer explicitement.
- **Alimente** : 700.29(1)d)(i) et 700.50(3) (prolongation max 3 nuits consécutives).

### membre d'équipage de conduite en réserve / flight crew member on reserve (700.01)
- **FR** : « **membre d'équipage de conduite en réserve** Membre d'équipage de conduite que l'exploitant aérien a désigné pour être disponible pour se présenter au travail pour le service de vol à plus d'une heure de préavis. (flight crew member on reserve) »
- **EN** : « **flight crew member on reserve** means a flight crew member who has been designated by an air operator to be available to report for flight duty on notice of more than one hour; (membre d'équipage de conduite en réserve) »
- **Historique** : définition **plus ancienne que le régime fatigue 2018** : en vigueur 2009-05-28 (DORS/2009-152 art. 2 / SOR/2009-152 s. 2).
- **Calculable : NON.** Critère = **DÉSIGNATION par l'exploitant** + préavis **> 1 h**. Cumulo n'a aucune donnée sur la désignation Porter (l'iCal ne la porte pas).
- **⚠️ CHARNIÈRE AVEC 700.29(3)** : réserve = **33 %** des heures de travail ; **attente** (101.01) = **100 %**. Le partage tient à **UN SEUL critère** : préavis **> 1 h** (réserve) vs **≤ 1 h** (attente). **Cumulo ne peut pas trancher ⇒ ne jamais convertir un bloc de réserve en heures de travail, dans un sens ou dans l'autre.**

### période de disponibilité en réserve / reserve availability period (700.01)
- **FR** : « **période de disponibilité en réserve** Période comprise dans une période de 24 heures consécutives au cours de laquelle le membre d'équipage de conduite en réserve est disponible pour se présenter au travail pour le service de vol. (reserve availability period) »
- **EN** : « **reserve availability period** means the period in any period of 24 consecutive hours during which a flight crew member on reserve is available to report for flight duty; (période de disponibilité en réserve) »
- **Historique** : DORS/2018-269 art. 10 (SOR/2018-269 s. 10), en vigueur 2020-12-12.
- **Calculable : NON.** Dépend de « membre d'équipage de conduite en réserve » (désignation inconnue) ; Cumulo ne voit pas les créneaux de disponibilité Porter. **Alimente 700.52** (réserve), article dont le registre a déjà établi qu'il **NE LIE PAS** le membre.

### période de service en réserve / reserve duty period (700.01)
- **FR** : « **période de service en réserve** Période commençant au moment où le membre d'équipage de conduite en réserve est disponible pour se présenter au travail pour le service de vol et se terminant au moment où la période de service de vol prend fin. (reserve duty period) »
- **EN** : « **reserve duty period** means the period that begins at the time that a flight crew member on reserve is available to report for flight duty and ends at the time that the flight duty period ends; (période de service en réserve) »
- **Historique** : DORS/2018-269 art. 10 (SOR/2018-269 s. 10), en vigueur 2020-12-12.
- **Calculable : NON.** Double dépendance : « en réserve » (inconnu) + « période de service de vol » (101.01, plancher seulement).
- **⚠️ Elle ENGLOBE la PSV** : elle court de la disponibilité jusqu'à la **FIN de la PSV**, donc toujours **≥ la PSV**. **Ne pas la confondre avec la PSV dans le calculateur.**

### poste de repos de classe 1 / 2 / 3 — class 1 / 2 / 3 rest facility (700.01)
- **FR** : « **poste de repos de classe 1** Couchette ou autre surface horizontale située dans un endroit qui : a) est isolé du poste de pilotage et de la cabine passagers; b) est doté d'un dispositif de contrôle de la température et de la lumière; c) est exposé à un bruit minimal et à un dérangement minimal. (class 1 rest facility) » · « **poste de repos de classe 2** Siège qui permet de dormir à l'horizontale dans un endroit qui : a) est isolé des passagers par un rideau ou une autre forme de séparation qui atténue la lumière et le bruit; b) est équipé d'un équipement d'oxygène portatif; c) minimise le dérangement par les passagers ou les membres d'équipage. (class 2 rest facility) » · « **poste de repos de classe 3** Siège inclinable à au moins 40 degrés par rapport à la verticale et doté d'un appui pour les jambes et les pieds. (class 3 rest facility) »
- **EN** : « **class 1 rest facility** means a bunk or other horizontal surface located in an area that (a) is separated from the flight deck and passenger cabin; (b) has devices to control the temperature and light; and (c) is subject to a minimal level of noise and other disturbances; (poste de repos de classe 1) » · « **class 2 rest facility** means a seat that allows for a horizontal sleeping position in an area that (a) is separated from passengers by a curtain or other means of separation that reduces light and sound; (b) is equipped with portable oxygen equipment; and (c) minimizes disturbances by passengers and crew members; (poste de repos de classe 2) » · « **class 3 rest facility** means a seat that reclines at least 40° from vertical and that has leg and foot support; (poste de repos de classe 3) »
- **Historique** : DORS/2018-269 art. 10 (SOR/2018-269 s. 10).
- **Calculable : NON.** Faits **PHYSIQUES** sur l'aéronef, non inférables.
- **⚠️ Typographie** : le EN dit « reclines at least **40°** from vertical », le FR « inclinable à au moins **40 degrés** par rapport à la verticale ». **Garder « ° » en EN et « degrés » en FR, ne pas uniformiser.**
- **Portée** : servent **uniquement** à **700.60** (équipage **renforcé**) = **HORS PORTÉE du cas Martin** (F/O non renforcé), déjà noté au registre. Consignés pour **fermer le domicile définitionnel**, **PAS pour affichage**.

### 🔑 période de service de vol / flight duty period (PSV/FDP) — **101.01**, PAS 700.01
- **FR** : « **période de service de vol** Période qui commence lors de la première des éventualités ci-après à survenir et qui se termine à l'arrêt des moteurs ou des hélices à la fin d'un vol : a) le membre d'équipage de conduite effectue toute fonction assignée par l'exploitant privé ou l'exploitant aérien ou déléguée par le ministre avant de se présenter au travail pour un vol; b) il se présente au travail pour un vol ou, si la période de service de vol comprend plus d'un vol, pour le premier vol; c) il se présente pour la mise en place; d) il se présente à titre de membre d'équipage de conduite en attente. (flight duty period) »
- **EN** : « **flight duty period** means the period that begins when the earliest of the following events occurs and ends at engines off or rotors stopped at the end of a flight: (a) the flight crew member carries out any duties assigned by the private operator or the air operator or delegated by the Minister before reporting for a flight, (b) the member reports for a flight or, if there is more than one flight during the flight duty period, reports for the first flight, (c) the member reports for positioning, and (d) the member reports as a flight crew member on standby; (période de service de vol) »
- **Historique** : DORS/2018-269 art. 1 (SOR/2018-269 s. 1), définition en vigueur 2018-12-12. Article 101.01 `lastAmendedDate` = 2025-04-01.
- **🛑 DOMICILE = 101.01, PAS 700.01.** C'est **LA** définition qui commande toute la table **700.28**.
- **Calculable : NON — DEUX raisons de ne jamais la traiter comme calculable** :
  1. **DÉBUT = la PREMIÈRE de 4 éventualités**, dont a) « **toute fonction assignée AVANT de se présenter** ». La PSV peut donc **commencer AVANT la présentation**, et Cumulo ne le saura jamais ⇒ **toute PSV calculée depuis l'heure de présentation est un PLANCHER**.
  2. **FIN = « à l'arrêt des moteurs ou des hélices »**, ce qui **n'est PAS l'heure « on-block »** que Cumulo stocke. Proches, **jamais identiques** ⇒ approximation **interdite** (règle carnet certifiable).
- **⇒ ASYMÉTRIE** : un **plancher qui dépasse déjà** le max 700.28 = **dépassement PROUVÉ** (fiable, + obligation d'aviser 700.26(4)). Un plancher **sous** le max **ne prouve RIEN**.
- **Implémentation** : le calculateur `27-fdp-calc.js` prend la présentation en **SAISIE Martin** : **c'est correct**, mais l'étiqueter « **au moins** » et **jamais** « ta PSV sera de X ».
- **⚠️ Noter l'alinéa c)** : la **mise en place DÉCLENCHE** la PSV, alors que **700.28(6) l'EXCLUT du COMPTE de vols**. **Deux effets opposés, ne pas les mélanger.**

### 🚨 poste de repos approprié / suitable accommodation — **101.01** (la faute la plus grave, corrigée)
- **FR** : « **poste de repos approprié** Chambre pour une personne qui est exposée à un bruit minimal, bien ventilée et dotée de dispositifs de contrôle de la température et de la lumière ou, lorsqu'une telle chambre n'est pas disponible, local qui est approprié au lieu et à la saison, est exposé à un bruit minimal et offre un confort et une protection convenables contre les éléments. (suitable accommodation) »
- **EN** : « **suitable accommodation** means a single-occupancy bedroom that is subject to a minimal level of noise, is well ventilated and has facilities to control the levels of temperature and light or, where such a bedroom is not available, an accommodation that is suitable for the site and season, is subject to a minimal level of noise and provides adequate comfort and protection from the elements; (poste de repos approprié) »
- **Historique** : DORS/2018-269 art. 1 (SOR/2018-269 s. 1), définition en vigueur 2018-12-12.
- **🚨 CE QUI S'EST PASSÉ** : le registre affirmait, **avec le mot « vérifié »**, que ce terme n'était **JAMAIS défini** (« 22 fois employé, zéro entrée définitionnelle »). **FAUX.** Il **est** défini, **à 101.01**. La recherche avait été faite au mauvais domicile (700.01), et l'absence de résultat a été écrite comme un fait vérifié. Voir **LEÇON DE MÉTHODE**.
- **Calculable : NON — mais pour le BON motif** : la définition **existe** et elle est **qualitative**. Ce qui manque n'est pas la règle, c'est le **FAIT** : Cumulo **ne voit pas la chambre**. ⇒ **ne jamais inférer qu'un hôtel y répond**, ni l'inverse.
- **Employé par** : **700.50** (pause du service fractionné : « in suitable accommodation », **PAS** le standard plus élevé « for sleep »), **700.51(2)a)** (période de repos de 3 h), et la définition de « **période de repos minimale** » (101.01, « not less than eight consecutive hours of sleep in suitable accommodation, **time to travel to and from that accommodation** and time for personal hygiene and meals ») ⇒ c'est **ce trajet exclu** qui fait de l'écart libération→présentation un **PLAFOND** (voir « nuit de repos locale »).

---

## 💰 TEXTES DÉSIGNÉS — amendes maximales, sous-partie 700 (vérifié 2026-07-17)
- **Source** : annexe des textes désignés de la sous-partie 700, transcrite du **XML officiel** (`/eng/XML/SOR-96-433.xml`, tableau `Row`/`Entry`). **Colonnes : personne physique / personne morale.** Ces montants sont des **maximums**, pas des amendes automatiques.
- **⚠️ Une amende désignée ne dit PAS qui est lié** : elle dit ce que **la partie visée par l'interdiction** risque. **700.51(1) est désigné 5 000 $ / 25 000 $ mais vise l'EXPLOITANT** : Martin ne risque rien sous cet article. **Ne jamais afficher un montant à Martin sans avoir vérifié que l'article le lie, LUI** (voir PRINCIPE D'ASYMÉTRIE).

| Disposition | Personne physique | Personne morale | Lie le membre ? |
|---|---|---|---|
| 700.26(1) | 5 000 $ | 25 000 $ | Non (exploitant) |
| 700.26(2) | 1 000 $ | 5 000 $ | **Oui** (aviser) |
| 700.26(3) | 1 000 $ | 5 000 $ | **Oui**, mais **hors scénario Martin** (pilote seul à bord) |
| 700.26(4) | 1 000 $ | 5 000 $ | **Oui** (aviser) |
| 700.26(5) | 1 000 $ | 5 000 $ | **Oui** (aviser) |
| 700.27(1) | 5 000 $ | 25 000 $ | **Oui** (accepter) |
| 700.28(1) | 5 000 $ | 25 000 $ | **Oui** (accepter) |
| 700.29(1) | 5 000 $ | 25 000 $ | **Oui** (accepter) |
| 700.29(2) | 3 000 $ | 15 000 $ | Non (exploitant) |
| 700.51(1) | 5 000 $ | 25 000 $ | **Non** (exploitant) |
| 700.61 | 5 000 $ | 25 000 $ | **Oui** (accepter) |
| 700.62(1) | 5 000 $ | 25 000 $ | **Oui** (accepter) |
| 700.62(2) | 5 000 $ | 25 000 $ | **Oui** (accepter) |

- **Non désignés (vérifié)** : 700.27(2), 700.29(3), **700.51(2)**. Une règle d'interprétation ou d'inclusion n'est pas une interdiction : rien à sanctionner.
- **⏳ Relevés au passage, NON examinés quant à qui ils lient** (ne rien en dire avant vérification) : 700.40(1) 5 000/25 000 · 700.41(1) 5 000/25 000 · 700.42(1) et (2) 5 000/25 000 · **700.43(1) : voir l'anomalie ci-dessous** · 700.43(3) 3 000/15 000 · 700.52(4) 5 000/25 000 · 700.63(3) 5 000/25 000 · 700.70 et 700.71 (divers) 3 000/15 000 · 700.20(4) 1 000/5 000 · 700.21(3) 1 000/5 000 · 700.37 1 000/5 000.
- **🚩 ANOMALIE FR/EN RÉELLE — 700.43(1) (découverte 2026-07-17, NON résolue)** : les deux versions officielles **ne concordent PAS** sur l'amende « personne morale ». **EN** : « Subsection 700.43(1) | 5,000 | **55,000** ». **FR** : « Paragraphe 700.43(1) | 5 000 | **25 000** ». Transcrit **verbatim du XML officiel des deux langues** ; ce n'est **pas** une erreur de transcription de ma part (vérifié sur le XML brut, balises `<entry>` d'une même `<row>`, `lims:fid` 1279311 en EN / 1265455 en FR). Les deux versions font également autorité en droit canadien : **je ne tranche pas, je ne « corrige » pas le 55 000 vers 25 000 même si l'hypothèse de la coquille EN est plausible** (toutes les autres lignes à 5 000 côté personne physique portent 25 000 côté personne morale). **⛔ NE RIEN AFFICHER sur 700.43(1)** tant que ce n'est pas éclairci auprès de TC / Justice Canada. Sans portée pour le simulateur v1 (700.43 = mise en place), consigné pour ne pas le redécouvrir.

## 🛑 PRINCIPE D'ASYMÉTRIE (décision de conception — 2026-07-17)
**Cumulo peut prouver qu'un vol est ILLÉGAL. Cumulo ne peut JAMAIS prouver qu'un vol est LÉGAL.**
- Un « **rien à signaler** » **n'est JAMAIS un feu vert**.
- **⚖️ Un « non » est fiable — MAIS à une condition (nuance ajoutée 2026-07-17)** : le registre écrivait « un non est **fiable** », sans réserve. **Trop fort.** Un « non » n'est fiable **que si les heures saisies ne sont pas SUR-inclusives**. L'asymétrie ne tient que dans un sens : les données de Cumulo sont un **PLANCHER** (il manque toujours possiblement du temps de vol d'autres opérations au sens de 700.27(2)a), des fonctions assignées avant présentation au sens de 101.01, etc.). Un plancher **trop haut** casse la garantie : si une donnée est **comptée en trop** ou **comptée deux fois** (doublon iCal, vol dupliqué, sim compté comme temps de vol, mise en place comptée comme un vol contre 700.28 alors que 700.28(6) l'exclut), l'app peut annoncer un dépassement **qui n'existe pas**. ⇒ formulation exacte : **un « non » est fiable dans la mesure où chaque heure saisie est réellement imputable ET n'est comptée qu'une fois.** L'exactitude du carnet n'est donc pas seulement une question de certifiabilité : **c'est la condition de validité de l'asymétrie elle-même.** Un faux « non » a un coût réel (Martin refuse un vol légal, ou perd confiance dans l'outil) ; il est simplement **moins pire** qu'un faux « OK ».
- **Motif juridique** : **700.27(1)** et **700.29(1)** interdisent **NOMMÉMENT au membre d'accepter** une telle assignation (idem 700.28(1), 700.61, 700.62(1) et (2)). ⇒ une **fausse assurance** de l'app = **infraction personnelle de Martin**, pas seulement celle de Porter. Le coût d'un faux « OK » est asymétriquement pire que celui d'un silence.
- **Hiérarchie de pertinence pour le simulateur d'échange de vol** : les articles qui **lient personnellement le membre** priment.
  - **⚠️ LISTES NON EXHAUSTIVES — vérifiées SEULEMENT pour les articles listés (précisé 2026-07-17)** : ces deux listes étaient présentées comme si elles couvraient la sous-partie 700 au complet. **Elles ne la couvrent pas.** Elles sont exactes pour ce qu'elles nomment, muettes sur le reste.
  - **Formule liante PRÉSENTE** (vérifié par contraste sur le texte brut) : **700.27(1)**, **700.28(1)**, **700.29(1)**, **700.61** (ajouté 2026-07-17 : « et à un membre d'équipage de conduite d'accepter une telle assignation » — vérifié XML FR et EN), **700.62(1)** et **700.62(2)**, **700.26(2)(4)(5)** (obligations positives d'aviser, forme différente : voir 700.26).
  - **Formule liante ABSENTE** (vérifié) : **700.40**, **700.50**, **700.51**, **700.52**, **700.63**, **700.29(2)**, **700.26(1)** (= obligations de l'exploitant ; Cumulo ne doit pas les présenter à Martin comme des raisons de refuser, ni comme ses infractions).
  - **⏳ NON EXAMINÉS à ce jour — ne rien affirmer à leur sujet** : **700.20**, **700.41**, **700.70**, **700.71**, et le reste de la sous-partie. Leur absence de ces listes ne veut **rien** dire. À vérifier au texte brut avant tout usage.
- **Conséquences UI, non négociables** : jamais d'écran vert « conforme » / « OK » / « tu peux accepter » ; jamais « aucune obligation d'aviser » ; jamais un total présenté comme complet quand il ne peut pas l'être (voir 700.29) ; **un « OK » de l'app n'est jamais une preuve de légalité** (voir 700.27(2)a) ci-dessous). Le silence de Cumulo se dit explicitement : « rien détecté dans ce que je connais » — jamais « c'est bon ».

## 📝 LEÇON DE MÉTHODE (2026-07-17) — transcription du texte de loi
- **WebFetch PARAPHRASE le texte de loi** et, dans au moins un cas, **a traduit le FR en EN** (donc a produit un faux « verbatim EN »).
- ⇒ **Transcrire depuis le XML / HTML BRUT, jamais depuis une page rendue.**
- ⇒ **Deux extractions concordantes EXIGÉES** avant d'inscrire une citation au registre.
- ⇒ Si le verbatim d'une langue n'est pas obtenu, **l'écrire « verbatim à obtenir »** et **ne rien afficher** dans cette langue. Ne jamais traduire soi-même un texte réglementaire.
- **Texte consolidé de référence** : **DORS/SOR-96-433**, à jour **2026-05-26**, **dernière modification 2026-01-05**.
- **Chemins bruts qui fonctionnent** (relevés 2026-07-17, à réutiliser) : XML complet **FR** `https://laws-lois.justice.gc.ca/fra/XML/DORS-96-433.xml` · **EN** `https://laws-lois.justice.gc.ca/eng/XML/SOR-96-433.xml` (~4,5 Mo chacun) ; page de section brute `.../section-700.XX.html`. ⚠️ `TexteComplet.xml` / `FullText.xml` **n'existent pas** (renvoient une page d'erreur de ~3,7 Ko : **vérifier la TAILLE de ce qu'on télécharge**, une page d'erreur se transcrit très mal). ⚠️ Le texte des articles ne se cherche pas en texte plat dans le XML : les termes définis sont enveloppés (`<DefinedTermFr>`/`<DefinedTermEn>`) et les titres vivent dans un bloc `Heading` **hors** de l'article ; les pages `section-XXX.html` **ne portent pas le titre** de l'article (le prendre au XML ou à la table des matières).

## 🚨 LEÇON LA PLUS IMPORTANTE (2026-07-17) — le mot « vérifié » est un engagement, pas une formule
- **Ce qui s'est passé** : ce registre a affirmé « poste de repos approprié / suitable accommodation ... **JAMAIS défini : vérifié, zéro entrée définitionnelle** ». **C'était FAUX** : le terme est défini à **101.01**. La recherche avait été faite dans le **mauvais article** (700.01), et **l'absence de résultat a été écrite comme un fait vérifié**.
- **La mécanique de la faute, à reconnaître** : « j'ai cherché et je n'ai pas trouvé » **n'est pas** « ça n'existe pas ». Un **négatif** ne se prouve pas par une recherche dont on n'a pas établi la couverture. La faute n'était pas de se tromper : **c'était d'accoler « vérifié » à un négatif non couvert**, ce qui a **immunisé l'erreur contre la relecture** (personne ne re-vérifie une ligne marquée vérifiée).
- **Aggravant** : la conclusion opérationnelle (« ne rien inférer d'un hôtel ») était **juste**. Un bon réflexe appuyé sur un **motif faux** est **plus** dangereux qu'une erreur visible : il survit aux revues et se propage dans le copy.
- **Règles qui en découlent, sans exception** :
  1. **Si tu n'as pas lu, écris « non vérifié ».** Jamais « vérifié » par habitude de formulation.
  2. **Un négatif (« jamais défini », « n'apparaît nulle part ») exige une méthode de couverture EXPLICITE et reproductible**, consignée avec l'affirmation. Exemple acceptable, employé ici : « 0 occurrence de `<DefinedTermEn>hours of work</DefinedTermEn>` dans le XML complet des deux langues ». Exemple **inacceptable** : « j'ai regardé 700.01 ».
  3. **Vérifier le DOMICILE avant de conclure à l'absence** : le régime fatigue a **deux** domiciles définitionnels (**700.01** et **101.01**). Chercher dans un seul et conclure « jamais défini » = la faute exacte commise ici.
  4. **« Vérifié » se date et se source** ligne par ligne. Un « vérifié » sans URL ni méthode est à traiter comme **non vérifié** et à re-vérifier.
  5. **Se méfier des affirmations qui arrangent** : « jamais défini » renforçait joliment la thèse « Cumulo ne peut pas conclure ». Une affirmation qui va dans le sens de ce qu'on veut démontrer mérite **plus** de vérification, pas moins.
- **Portée** : cette leçon vaut **aussi pour les corrections reçues d'un agent de revue**. Le 2026-07-17, la correction demandée affirmait que le titre FR de 700.62 était « Vols ultra-long-courriers » : **faux aussi** (le titre officiel est « **Vols à très longue distance** »). **Une correction n'est pas une source.** Tout ce qui entre au registre se vérifie au texte primaire, **d'où que ça vienne**.

## ✅ CONFIRMATIONS 2026-07-17 (re-vérification adversariale)
- **Table 700.28(4)** (durée moyenne des vols **≥ 50 min**, cas Porter) **revérifiée cellule par cellule contre le XML officiel** : **9/9/9 · 10/9/9 · 11/10/9 · 12/11/10 · 13/12/11 · 12,5/11,5/10,5 · 12/11/10 · 11/10/9 · 10/9/9**. **AUCUN écart** avec la table déjà au registre (section 700.28).
- **700.27(1)d) ne mentionne NULLE PART « IFR »** : le texte est « dans le cas d'un aéronef utilisé par un seul pilote » / « in the case of a single-pilot operation ». ⇒ **Le 8 h / 24 h ne s'applique PAS à Martin** (E195 multi-équipage, 705). À noter explicitement partout où le 8 h/24 h apparaît, pour qu'il ne soit jamais compté contre lui.
- **700.27(2)a) — le cumul légal inclut le temps de vol accumulé lors d'AUTRES opérations aériennes**, que **Cumulo ne connaît que si Martin l'a saisi**. ⇒ **un « OK » de l'app n'est JAMAIS une preuve de légalité** sur les 112/300/1000 h. Un dépassement détecté reste fiable ; un non-dépassement ne prouve rien (asymétrie).

### Passe de correction 2026-07-17 (suite à revue adversariale) — ce qui a CHANGÉ
Toutes les entrées ci-dessous ont été **re-vérifiées au texte primaire par deux chemins indépendants** (section HTML brute + XML complet officiel des deux langues), **jamais depuis une page rendue ni depuis la correction reçue**.
- **⛔ FAUTE GRAVE corrigée** : « poste de repos approprié **jamais défini : vérifié** » = **FAUX**. Le terme **est défini à 101.01**. Mention « vérifié » **retirée**, verbatim FR/EN **ajouté**, motif d'incalculabilité **corrigé** (fait non observable, **pas** définition manquante). Voir **LEÇON LA PLUS IMPORTANTE**.
- **Historique 700.29 complété** : **DORS/2018-269 art. 13 + DORS/2022-246 art. 17** (le registre n'en portait qu'une).
- **Sur-interprétation 700.62(2) corrigée** : vise **UN VOL**, **pas le FDP** (erreur de type « IFR monopilote »). Ne jamais sommer les vols d'un FDP contre le 16 h.
- **Titre 700.62 corrigé DEUX FOIS** : « Plafonds absolus » était **inventé** par le registre ; « Vols ultra-long-courriers » (proposé par la revue) est **faux aussi**. Titre officiel : **« Vols à très longue distance »** / « Ultra Long-range Flights » (deux chemins concordants).
- **Ambiguïté 700.51 re-caractérisée (toujours PAS tranchée)** : la WOCL (700.01) emploie le **même créneau 2 h à 5 h 59** ancré à l'acclimatation, **mais 700.51 n'emploie pas le terme défini alors que 700.61 l'emploie**. Argument **des deux côtés** ⇒ ouverte.
- **Dérive de paraphrase 700.29(1)c)/d) corrigée** : « journée **ISOLÉE** sans service » (terme **défini** à 700.01), pas « journée sans service ».
- **700.27(2)b) ajouté** (le registre n'en consignait que le a)) : temps de vol **total** d'un vol avec **équipage de conduite renforcé**.
- **Asymétrie nuancée** : un « non » n'est fiable **que si les heures saisies ne sont pas sur-inclusives** (un doublon peut fabriquer un faux dépassement).
- **Listes « formule liante » marquées NON EXHAUSTIVES** + **700.61 ajouté aux articles qui LIENT le membre** (vérifié) ; **700.20 / 700.41 / 700.70 / 700.71 non examinés**.
- **Amendes des textes désignés consignées** (nouvelle section) + **anomalie FR/EN réelle découverte à 700.43(1)** (EN 55 000 vs FR 25 000), **non résolue, ne rien afficher**.
- **700.26** : le registre reflétait **déjà** correctement le sous-titre couvrant tout l'article, le (4) comme **obligation positive de parler** et le (3) **inapplicable** à Martin (multi-équipage) : **aucune correction de fond requise**, seules les amendes ont été ajoutées.
- **Définitions intégrées** (nouvelle section) : 700.01 (structure, acclimaté, WOCL, nuit de repos locale, journée isolée sans service, early/late/night duty, réserve, période de disponibilité en réserve, période de service en réserve, postes de repos classe 1/2/3) + **101.01** (période de service de vol, poste de repos approprié).

## ⏳ À VÉRIFIER (présent dans le code, pas encore confirmé contre la source)
- **CAR 401.08 / 401.08(2)(h)** — contenu obligatoire du carnet (colonnes). [04-logbook, 12-pdf-export, 13-glossaire]
- ~~**CASS 725.106** — validité PPC~~ → **CONFIRMÉ 2026-06-27** au texte primaire **CAR 705.113** (voir la section ✅ ci-dessus : 6 mois base / 12 mois avec formation approuvée). Reste cosmétique : régler l'échelle de l'anneau PPC à ~180 j.
- **CAR 401.34 / Standard 421.34** — usage exact (vs 101.01 pour la déf. XC).
- **CAR 401.73** — récence/rafraîchissement (glossaire).
- **CAR 605.x** (605.97 etc.) — exigences carnet de route / documents (glossaire).
- **CAR 401.05(1)** — récence 5 ans / programme de formation.
- **Borne du jour d'expiration médical/ECG/PPC** — le certificat est-il valide LE jour saisi ? Aujourd'hui l'app le montre expiré le jour même (comparaisons `new Date(dateSaisie)` vs minuit local, décalées d'un jour selon le fuseau) ; sémantique laissée telle quelle le 2026-07-17 (correctif fenêtres 401.05) pour ne rien changer sans vérifier 404.04(6)/(7) d'abord.

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
