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
| Cross-country | **vol-voyage** (le temps = « temps de vol en voyage », RAC 101.01) ; abréviation **XC** conservée | RAC 101.01 + guides de test en vol / AIM de TC (terme employé par TC en français) — vérifié 2026-06-26 | ❌ « cross-country » dans le FR (anglicisme), ❌ « voyage » seul |

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
- **Périodes (404.04(6)/(6.1)/(6.2))** : non-commercial <40 ans = 60 mois (PPL/récréatif/ballon ; planeur/ultraléger 60) ; 40+ = 24 mois (planeur/ultraléger restent 60). Commercial (CPL/MCPL-avion/ATPL contre rémunération) = **12 mois**, réduit à **6 mois** si 40+ en monopilote avec passagers OU 60 ans et +. Âge évalué à la **date de l'examen**.
- **🆕 Calcul de l'échéance (404.04(8), en vigueur 2026-06-17, Gazette II 2025-12-17)** : fin de validité calculée à partir de (a) la fin de la période précédente si l'examen est ≤ 90 jours avant cette fin ; (b) **le 1er jour du mois suivant l'examen** si l'examen est > 90 jours avant. (Avant : lié à la date d'examen.)
- **Source** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-404.04.html (article ATAC = source secondaire qui a alerté).
- **Impact Cumulo** : AUCUNE casse — l'app utilise l'échéance **saisie par le pilote** (`profile.medical`), pas un calcul ; le pilote saisit la date de son certificat (déjà conforme). **Opportunité** : un calculateur/vérificateur d'échéance dans la vue détail Médical (âge + type de licence + opération + règle (8)) — à concevoir avec la refonte, soigneusement (certifiable). NE PAS auto-coder sans validation Martin.

## ✅ Validité du PPC — contrôle de compétence pilote (CAR 705.113) — vérifié 2026-06-27
- **Règle (705.113(2))** : la validité du PPC expire **(a)** le 1er jour du **7e mois** suivant le mois du contrôle (≈ **6 mois**) ; **(b)** le 1er jour du **13e mois** (≈ **12 mois**) si le pilote réussit la **formation périodique semestrielle approuvée par le ministre** selon les CASS ; **(c)** option de programme de qualification avancée (AQP). **705.113(4)** : renouvellement dans les **90 derniers jours** de validité → prolongé de 6 ou 12 mois selon le cas.
- **Source primaire** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-705.113.html (WebFetch direct, 2026-06-27).
- **Implémentation** : Q&R + glossaire mis à jour (6 mois base / 12 mois avec formation approuvée, cite 705.113). La date d'échéance reste **saisie par le pilote** (`ppcDueDate`) — aucune donnée calculée/inventée. 705.106 = exige un PPC valide ; **705.113 = la période de validité**.
- ⏳ Reste cosmétique : l'échelle de l'anneau PPC (365 j) → à régler à ~180 j. Exemptions possibles par exploitation → la Q&R renvoie aussi au programme de l'exploitant.

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

> Tenir à jour : toute nouvelle règle réglementaire ajoutée au code DOIT apparaître ici
> avec sa source vérifiée le jour où elle est écrite.
