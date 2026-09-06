# Calendrier grains — correction et rejeu comparatif, 6 septembre 2026

## Résultat et périmètre

TD2-426 / TD2-427. Branche `codex/grains-week-integrity`, baseline de ce lot `878adf488d527b682a10d3556b6a894e961bdee3`.

Le calendrier n'impose plus un WAIT systématique faute d'un ancien téléchargement local. Une reconstruction documentaire explicite est désormais possible, avec sources, empreintes, dates, périmètre et réserves conservés. **Ce n'est pas une preuve que le VPS possédait ces informations à l'époque.**

Deux replays réels PostgreSQL, sur bases locales jetables, ont été terminés pour le **31 août–4 septembre 2026**, avec exactement le même code et les mêmes bougies. Sans calendrier versionné : 100 signaux / 100 WAIT contexte. Avec le calendrier reconstruit : **100 signaux / 90 ADMISSIBLE / 10 REJECT / 0 WAIT contexte**.

**Aucun ordre n'atteint encore le Human Gate.** Les 90 signaux admissibles sont ensuite refusés par le portefeuille : la proposition de 1 contrat devient 0 après multiplication contextuelle et arrondi inférieur. Il n'y a ni évaluation Risk individuelle, ni TargetPosition, ni OrderIntent, ni trade théorique. Un résultat en R n'est donc pas évaluable sur cette chaîne ; le zéro trade ne prouve ni rentabilité ni absence de setups.

Aucun changement des formules de stratégie, des plans proposés, de la quantité proposée, des règles Portfolio/Risk ou des limites. Aucun worker IA, broker, Telegram réel, service VPS ou migration VPS activé/modifié. Aucun déploiement dans ce lot.

## Causes corrigées

| Constat | Correction | Preuve |
|---|---|---|
| La date de récupération était assimilée à l'unique date possible de connaissance | Séparer récupération, publication, archive observée et révision déclarée par la source | Import historique daté récupéré ultérieurement accepté ; preuve future/refus de hash testés |
| Couverture sans périmètre ou déduite d'un simple nombre d'événements | Exiger trois sources requises, fenêtre explicite et portée ZC/ZW | Source manquante, doublon ambigu, instrument/période incomplets restent UNKNOWN_COVERAGE |
| Une source optionnelle ou l'absence d'événements pouvait contaminer la qualification | Évaluer les sources requises ; calendrier prouvé vide distinct d'un calendrier inconnu | Test de calendrier courant complet vide AVAILABLE ; optionnel non bloquant |
| Projection susceptible de réhabiliter un état source dégradé | Conserver les états persistés UNAVAILABLE/STALE/UNKNOWN ; seule une source AVAILABLE qualifiée reste AVAILABLE | Tests réels du ledger |
| Rejeu multi-version susceptible d'appliquer la dernière version au début | Lire la projection canonique aux changements de connaissance et ne retenir les signaux que dans leur intervalle | Test avec signaux non vides avant/après changement ; mêmes IDs bruts |
| Rapport propre au maïs risquant d'affecter le blé | Conserver `commodity_codes` et appliquer la pertinence instrument au contexte | Grain Crushings concerne ZC, pas ZW |
| Résultats d'annonces pouvant fuiter avant publication | L'import de planning refuse actual/result/forecast ; la projection du ledger masque les résultats avant leur disponibilité et exige une version qui pouvait les connaître | Tests PostgreSQL avant/après publication |

Le collecteur courant ne devient pas AVAILABLE simplement parce qu'une requête HTTP réussit. Ses endpoints non encore parsés/qualifiés restent explicitement insuffisants.

## Sources et niveau de preuve

Manifeste versionné : [USDA_GRAINS_CALENDAR_WEEK_20260831.json](USDA_GRAINS_CALENDAR_WEEK_20260831.json).

| Source | Preuve retenue | Limite |
|---|---|---|
| [NASS, calendrier annuel 2026](https://data.nass.usda.gov/Publications/Calendar/2026/2026ReleaseCalendar_12Months_11x17_Color.pdf) | PDF original vérifié visuellement ; ModDate 29 janvier 2026 20:08:49Z et Last-Modified officiel 20:24:34Z ; octets, en-têtes et extraction des métadonnées liés par SHA-256 | Métadonnées déclarées par la source, plus faibles qu'une archive indépendante. Pas de reçu local de janvier ; une modification ultérieure non reflétée n'est pas absolument exclue |
| [WASDE de février 2026](https://esmis.nal.usda.gov/sites/default/release-files/795765/wasde0226.pdf) | Publication datée du 10 février ; planning annuel page 6 : 12 août puis 11 septembre ; borne conservatrice au 11 février 00:00Z | Prouve le planning WASDE, pas tous les événements agricoles |
| [FAS Export Sales, fiche datée de 2019](https://apps.fas.usda.gov/info/factsheets/expsls.pdf) | Règle hebdomadaire jeudi 08:30 ET ; événement du 3 septembre dérivé de cette règle dans une semaine sans jour férié pertinent | Horaire attendu, pas avis spécifique 2026 archivé ; une dérogation ponctuelle n'est pas absolument exclue |

Une ancienne page FAS contenant un calendrier dynamique actuel n'a **pas** été utilisée comme preuve que son contenu actuel était déjà connu à sa date d'origine. Les publications ultérieures corroborent seulement les dates, sans injecter leurs chiffres dans le replay.

Le niveau de preuve et les réserves sont dans `sources[].metadata.review` et `historical_evidence` du ledger immuable. Les libellés internes AVAILABLE/PROVEN_HISTORICAL désignent ici la qualification documentaire selon cette taxonomie, pas une réception live démontrée. La projection publique ne remonte pas encore toutes ces réserves : la lire avec ce manifeste, sans la présenter comme une certification d'ingestion historique.

### Événements importés

| Date/heure UTC | Publication | Portée |
|---|---|---|
| 31 août, 19:00 | Agricultural Prices | ZC/ZW |
| 31 août, 20:00 | Crop Progress | ZC/ZW |
| 1 septembre, 19:00 | Grain Crushings mensuel et synthèse annuelle, même horaire regroupé | ZC |
| 3 septembre, 12:30 | Weekly Export Sales, horaire attendu d'après règle publiée | ZC/ZW |

Pas de WASDE prévu dans cette fenêtre selon le document. La qualification couvre les **trois familles de publications programmées retenues**, pas l'intégralité des nouvelles, ventes export quotidiennes non programmées, météo, surprises macro ou résultats des rapports. Aucun résultat économique futur n'a été importé. `knownAtUtc` agrégé = 11 février 2026 00:00Z ; récupération réelle = 6 septembre 2026 02:04Z.

## Comparaison contrôlée

| Journée | Signaux bruts, identiques | Ancien input : WAIT contexte | Calendrier qualifié : admis | Rejetés contexte | Refus portefeuille après contexte | Human Gate |
|---|---:|---:|---:|---:|---:|---:|
| 31/08 | 11 | 11 | 7 | 4 | 7 | 0 |
| 01/09 | 16 | 16 | 16 | 0 | 16 | 0 |
| 02/09 | 31 | 31 | 26 | 5 | 26 | 0 |
| 03/09 | 21 | 21 | 20 | 1 | 20 | 0 |
| 04/09 | 21 | 21 | 21 | 0 | 21 | 0 |
| **Total** | **100** | **100** | **90** | **10** | **90** | **0** |

Après correction : 55 exécutions de portefeuille pour 90 signaux distincts, tous avec `SIGNAL_SIZE_NOT_POSITIVE` et `CONTEXT_RISK_MULTIPLIER_ZERO_SIZE`. Ne pas compter ces deux motifs comme 180 signaux. Ne pas compter un statut agrégé Risk PASS sans allocation comme une autorisation de trade : **0 décision Risk individuelle**, 0 TargetPosition, 0 OrderIntent, 0 Human Gate, 0 fill, 0 outcome, 0 commande provider.

Origine vérifiée dans le code inchangé :

- `mcp_gpt_desk/src/us-grains-signal-proposal.js` : `proposed_size: 1`.
- `mcp_gpt_desk/src/strategy-signal-decision-pipeline-service.js` : transmet le multiplicateur contextuel avec sa provenance.
- `packages/desk-domain/src/portfolio-candidate-allocation-v1.js`, `contextSizingResult` : mode `REQUESTED_QUANTITY_CAP`, `Math.floor(requestedSize * multiplier)`. Avec 1 × 0,85, 0,65 ou 0,5, la taille entière est 0.
- Le mode `MONETARY_RISK_BUDGET` existe déjà et traite le budget monétaire dans Global Risk ; il n'a pas été activé pour modifier cette comparaison.

C'est une incompatibilité entre proposition minimale et policy locale de réduction, pas une erreur d'arrondi JavaScript ni la preuve que ces signaux seraient perdants. Les paramètres locaux sont explicitement marqués `LOCAL_PIPELINE_DEFAULTS_NOT_VPS_POLICY_CERTIFIED` : aucune conclusion automatique sur la configuration actuelle du VPS.

### Invariants et artefacts

Tous les artefacts bruts sont sous `output/research/grains-calendar-20260906/` (locaux, ignorés par Git). Les entrées précédentes ne sont pas réécrites.

- Ancien fichier complet : `output/research/grains-week-20260905/vps-week-ledger.json`, SHA-256 `8417abff18e08015cd58460dc1cfee312ceca360e8eff34e26bc5c3d0450bdf6`.
- Nouveau fichier augmenté : `week-with-calendar.json`, SHA-256 `8e7d878c6b29dff2333157892cf669a7dbb9735d3fdf96a4abd0636963492495`.
- **17 044 bougies strictement identiques**, empreinte JSON des bougies : `4b6955a53630716eb84507cdcafbeb9b8fa77ae73c15a0c990130ee76df537f5`.
- **100 IDs bruts et plans proposés identiques** : instrument, sens, quantité, génération, expiration, entry, stop et targets ; empreinte `bd5beb1c3a1d5ecee490e7cf32a8c4bd68e28fddfda6c7a7a99a663fa58df522`.
- **603 empreintes de code identiques** entre `replay-baseline-final.json` et `replay-qualified-final.json`, contrôlées avant/après chaque run.
- `comparison.json` contient les comptes par jour, refus uniques, couvertures et invariants.
- `calendar-import.json` conserve la version importée, la provenance et l'empreinte de l'entrée originale.

Mode `MODE_CAUSAL_PRECOMPUTED` : détection causale préparée, puis publication et traitement chronologiques dans les services PostgreSQL canoniques. Pas de nouveau moteur parallèle, pas de worker IA réel. Les heures de réception historiques des bougies restent non certifiées. Ce test isole le calendrier ; il n'établit ni performance économique, ni parité des policies VPS, ni robustesse hors échantillon.

## Architecture et fichiers

- `src/grains-calendar-evidence.js` : politique pure market-data, sans PostgreSQL/HTTP.
- `src/adapters/grains-calendar-evidence-import.js` : validation des documents examinés et construction d'une version canonique.
- `src/persistence/postgres-grains-calendar-ledger.js` : stockage et lecture canonique as-of ; réutilise les tables de la migration 063 déjà créée au lot précédent.
- `src/adapters/usda-grains-calendar-collector.js` : utilise le même qualificateur pour les collectes courantes, sans antidater la réception.
- `src/grains-calendar-detection.js` : orchestration du détecteur existant par intervalle de connaissance du calendrier.
- `scripts/import_grains_calendar_evidence.mjs` : import dans de nouveaux artefacts uniquement, refuse collisions/écrasements/calendriers préexistants et chemins documentaires hors racine.
- `scripts/extract_grains_calendar_pdf_evidence.py` : extraction hors runtime des métadonnées PDF, dépendance explicite `pypdf`.
- `scripts/compare_grains_calendar_replays.mjs` : comparaison des comptes et assertions d'identité, sans calculer un résultat de trading de remplacement. Son contrôle des plans exige une seule version connue par run, comme ici.

Les chemins ci-dessus sont relatifs à `mcp_gpt_desk/`. Aucun fichier frontend, contrat d'exécution, schéma SQL nouveau ou domaine Risk modifié dans ce lot. La dette de taille du script replay touché a été réduite en séparant le rendu de preuve de l'orchestration ; le qualificateur est partagé au lieu de dupliquer sa logique dans le collector et SQL.

## Validation exécutée

| Contrôle | Résultat |
|---|---|
| Backend complet, état final | **1 422 PASS, 26 SKIP conditionnels, 0 FAIL** (1 448 tests) |
| Domaine | **491/491 PASS** |
| PostgreSQL réel ciblé : runtime inputs, ledger, bus/chaîne, replay | **12/12 PASS**, aucun skip |
| Tests calendrier ciblés | **33/33 PASS** (`calendar-unit-final.log`) ; inclus dans le backend complet |
| Régression génération d'artefact replay | **1/1 PASS** ; incluse dans le backend complet |
| Deux replays canoniques de cinq jours | Terminés, zéro commande provider |
| Comparaison candles/plans/code | PASS |
| Architecture, migrations, sûreté runtime | PASS |
| Qualité statique globale | **FAIL historique inchangé** : 270 fonctions longues / 250, 720 complexes / 650, 95 duplications / 72 |

Aucun seuil baissé. Tests frontend/visuels non relancés : aucun changement frontend. Une première tentative de génération de rapport a révélé une référence manquante après extraction ; corrigée et couverte par test. Une exécution intermédiaire a ensuite été refusée par le contrôle de gel du code. Seuls les deux artefacts **final** ci-dessus servent aux conclusions ; les logs d'échec sont conservés.

### Reproduction

Depuis la racine du worktree, avec Node et PostgreSQL local déjà configurés selon le dépôt :

```sh
node mcp_gpt_desk/scripts/import_grains_calendar_evidence.mjs --manifest reports/research/USDA_GRAINS_CALENDAR_WEEK_20260831.json --document-dir output/research/grains-calendar-20260906/documents --retrieved-at 2026-09-06T02:04:00Z --output output/research/grains-calendar-20260906/calendar-import-new.json --base-input output/research/grains-week-20260905/vps-week-ledger.json --replay-input output/research/grains-calendar-20260906/week-with-calendar-new.json
node mcp_gpt_desk/scripts/replay_us_grains_causal_postgres.mjs --input output/research/grains-week-20260905/vps-week-ledger.json --output output/research/grains-calendar-20260906/baseline-new.json --start 2026-08-31 --end 2026-09-04 --as-of 2026-09-04T23:59:59.999Z
node mcp_gpt_desk/scripts/replay_us_grains_causal_postgres.mjs --input output/research/grains-calendar-20260906/week-with-calendar-new.json --output output/research/grains-calendar-20260906/qualified-new.json --start 2026-08-31 --end 2026-09-04 --as-of 2026-09-04T23:59:59.999Z
node mcp_gpt_desk/scripts/compare_grains_calendar_replays.mjs output/research/grains-calendar-20260906/baseline-new.json output/research/grains-calendar-20260906/qualified-new.json output/research/grains-calendar-20260906/comparison-new.json
npm run test:grains:calendar
npm run test:grains:calendar-artifact
node --input-type=module -e "process.env.RUN_POSTGRES_TESTS='1'; for (const name of ['grains_runtime_inputs_postgres','grains_calendar_version_ledger_postgres','grains_causal_pipeline_postgres','us_grains_causal_postgres_replay']) await import('./mcp_gpt_desk/test/'+name+'.test.js');"
```

Exécuté ici avec `node.exe` pour utiliser PostgreSQL Windows. Les guards utilisent Node Linux dans WSL. L'appel direct `npm.cmd` depuis bash n'est pas utilisable ; le script package calendrier a été exécuté via Node Windows avec les mêmes arguments, sans modifier le script.

L'import exige les **documents originaux et en-têtes sauvegardés**, pas juste le manifeste. Ils sont locaux, non livrés par un clone Git seul. Un nouveau téléchargement dont les en-têtes/dates/hash diffèrent nécessite un nouveau manifeste examiné et un nouvel instant réel de récupération ; ne pas réutiliser artificiellement la date ci-dessus. L'extracteur `python .../extract_grains_calendar_pdf_evidence.py document.pdf metadata-new.json` exige `pypdf` et refuse d'écraser une sortie existante. Archiver le lot documentaire avec les preuves de la future release.

## Suite, sans modifier ce comparatif

1. **TD2-425/429 — sizing** : capturer les policies et références de capital effectives VPS ; établir le mode de sizing voulu. Appliquer une réduction contextuelle au budget monétaire, si ce mode est retenu, puis laisser Risk décider si au moins un contrat reste autorisé. Réutiliser la capacité existante. Jamais arrondir artificiellement à 1, relever les tailles par défaut ou contourner Risk pour obtenir des trades.
2. **TD2-426 — prospective** : préparer et qualifier les trois sources pour la prochaine fenêtre, append-only, avant ouverture. Le collecteur courant reste insuffisant tant que les plannings FAS/WASDE ne sont pas parsés ou importés après examen. Pas de tâche automatique complète ni calendrier futur déclaré alimenté dans ce lot. Archiver chaque collecte et vérifier la couverture effective à l'instant T ; absence de source pertinente => WAIT explicite.
3. **TD2-427 — validation** : nouveau run sous policy explicitement figée, puis passage Risk → Target → Intent → Human Gate → suivi théorique ; comparer à ce témoin. Pas d'objectif de nombre de trades imposé.
4. **TD2-428 — release** : conserver la retenue actuelle tant que ces dépendances, la dette statique TD2-431 et la recette VPS ne sont pas closes. Migration 063 toujours locale ; aucune affirmation de disponibilité live issue de ces tests.

Ce rapport remplace le verdict technique courant du rapport du 5 septembre pour la question « peut-on qualifier une reconstruction documentaire ? ». Il ne réécrit pas le constat historique : le premier run n'avait pas de version calendaire exploitable.
