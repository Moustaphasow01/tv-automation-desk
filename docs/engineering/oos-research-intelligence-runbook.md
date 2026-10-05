# Desk Intelligence — activation isolée et orchestration

## État réel de livraison

Le lot implémente observation → diagnostic → familles → hypothèses → recherche de contre-exemples → critique indépendante → dossier de recherche/protocole. Le service poursuit ensuite la recherche globale et sélectionne automatiquement des expériences audit-only depuis les publications ENGINE existantes. Il n'exécute pas encore de nouveau moteur challenger/replay, ne promeut aucun challenger et ne modifie aucun champion.

**VPS activé et vérifié sur la release 39425885c379ba9d8be7c71b2a908864df12b3f4 avant le durcissement de la file scientifique.** Migrations additives 075/076 : 14 tables et 35 indexes research. Catalogue HTTPS public : 53 outils, dont six research. DCR, PKCE S256, scopes read/write et refus des droits insuffisants ont été testés réellement. Le quota est réellement lisible avec le profil Codex autorisé (16 % utilisés lors du contrôle du 05/10). L'audit LLM exhaustif juillet–août n'est pas encore achevé.

Acceptance réelle : 02/07 comporte 33 scénarios et 38 attempts, énumérés depuis le forensic index. Les 38 audits factuels et l'audit de plan sont persistés ; les premières reviews Astra/xhigh sont persistées. Le test E2E a injecté une panne après réception de la réponse modèle, rouvert le host, repris automatiquement et persisté la review sans seconde inférence. Un audit factuel n'est pas une review LLM : ne pas annoncer 38 reviews achevées. Le service automatique DeskOosResearch a été installé et lancé réellement ; sa file durable contient les 44 journées existantes de juillet–août.

## Intégration et fichiers

| Propriétaire | Fichiers | Rôle |
|---|---|---|
| research/domain | `packages/desk-oos-research/src/domain/*.js` | preuves, audits A–G, cinq couches, features disponibles, familles structurelles, cohortes, gates walk-forward, schémas de sorties et hash canonique |
| research/application | `packages/desk-oos-research/src/application/*.js` | observation paginée, cycle/reprises, appels modèle comptabilisés, hypothèses/critique/protocoles, API et runner borné |
| research/adapter | `packages/desk-oos-research/src/adapter/postgres-research-memory.js` | transactions, révisions, snapshots immuables, pagination, verrou exclusif de cycle |
| research/storage | `infra/postgres/init/075_oos_research_memory.sql` | 11 tables additives ; triggers d'immutabilité ; aucun changement OOS |
| research/storage | `infra/postgres/init/076_oos_research_task_queue.sql` | tasks durables, leases fencing, workers et incidents ; permissions UPDATE limitées aux checkpoints techniques |
| host | `mcp_gpt_desk/src/oos-research-{host,runtime,model,capabilities,tools}.js` | composition, deux credentials DB, découverte réelle des modèles, transport subprocess sans outils métier, OAuth scopes existants |
| host | `mcp_gpt_desk/src/oos-mcp-server.js`, `oos-http-server.js`, `scripts/serve_oos.mjs` | enregistrement et activation optionnels, aucune mutation des contrats OOS |
| operations | `mcp_gpt_desk/scripts/run_oos_research.mjs` | start/advance/run/status/artifacts/scorecard/experiment, sans TradingView |
| operations | `run_oos_research_scheduler.mjs`, `Install-OosResearchScheduler.ps1` | service Windows distinct, redémarrage automatique, heartbeat et queue PostgreSQL ; concurrence physique 1 |
| operations | `Update-OosResearch.ps1`, `configure_oos_research.mjs` | backup PostgreSQL, hashes métier avant/après, migration additive et credentials isolés |
| operations | `restart_oos_research_scheduler.mjs` | maintenance par drain d'admission PostgreSQL ; fin de l'inférence active attendue avant restart/stop ; persistance des cycles comparée |
| quality | nouveaux tests du package et `mcp_gpt_desk/test/oos_research_*.test.js` | preuves, contre-revue, transport MCP, permissions et sélection de modèles |

Les manifests, plans, captures, ENGINE, parser SMC3, résultats et anciens prompts analytiques ne sont pas édités. Les sorties de tests sont synthétiques et ne deviennent jamais données de marché.

## Configuration avant activation

1. Appliquer 075/076 par l'activation dédiée, après sauvegarde. Les migrations sont additives et rejouables.
2. Provisionner les rôles selon les permissions commentées dans 075. Le lecteur a SELECT sur le corpus OOS, aucun INSERT/UPDATE/DELETE. Le writer n'a que SELECT/INSERT recherche et UPDATE limité aux colonnes de checkpoint des cycles. Aucun superuser, CREATEROLE, ownership de tables métier ou rôle hérité permettant de modifier OOS.
3. Injecter les secrets uniquement par environnement : `OOS_RESEARCH_DATABASE_URL`, `OOS_FORENSIC_DATABASE_URL`. Ne pas réutiliser l'identité DB d'exécution.
4. Indiquer `archive_root`, `index_root` (défaut : `archive_root/forensic-index-v2`) et `model.codex_bin`. La découverte utilise initialize → initialized → model/list ; elle ne lance aucune inférence. Astra est préféré s'il est réellement disponible avec xhigh ; sinon une préférence explicitement configurée doit être disponible.
5. Pour le serveur existant, `research_enabled=true` et `research.model` activent les tools. Sans ce flag, aucun changement de catalogue. Aucun nouveau service obligatoire ni endpoint REST.

Exemple de configuration non secrète pour le CLI :

```json
{
  "archive_root": "/chemin/du/corpus/oos",
  "model": {
    "codex_bin": "/chemin/codex",
    "timeout_ms": 780000,
    "discovery_timeout_ms": 60000,
    "model_priority": ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol"]
  }
}
```

Une preuve de capabilities datée peut encore être fournie via `model.capabilities_file`, option contrôlée par exploitation. Sans fichier, la découverte est automatique. Une preuve périmée, mal datée ou un catalogue incomplet bloque. Le classement est une préférence explicite, pas une mesure scientifique des performances des modèles. Les métadonnées du transport CLI identifient le modèle demandé, pas une attestation du modèle interne du fournisseur.

## Lancement et reprise

`OOS_RESEARCH_CONFIG` désigne cette configuration. Après installation des dépendances du host :

```bash
node mcp_gpt_desk/scripts/run_oos_research.mjs start '{"dates":["2026-07-02"],"budget":{"maximum_model_calls":50}}'
node mcp_gpt_desk/scripts/run_oos_research.mjs run '{"cycle_id":"<SHA-256 retourné>","maximum_steps":1000,"maximum_cases":1}'
node mcp_gpt_desk/scripts/run_oos_research.mjs status '{"cycle_id":"<SHA-256 retourné>"}'
node mcp_gpt_desk/scripts/run_oos_research.mjs artifacts '{"cycle_id":"<SHA-256 retourné>","kind":"scenario_audit","limit":50}'
```

Choisir le budget en connaissant le nombre total de tentatives : tous les scénarios sont conservés. Les limites portent sur les appels par lot, jamais sur le nombre de scénarios du plan. La comparaison inter-cas est chunkée, chaque proposition est ensuite confrontée à tous les audits du cycle, y compris les contre-exemples. Le runner termine au dossier COMPLETED, à son budget technique ou à un blocage ; jamais de retry infini.

Tools ajoutés si activation explicite :

- `start_research_cycle` — desk.write ; définition/pins de recherche.
- `advance_research_cycle` — desk.write ; étape bornée, éventuellement inférence payée.
- `get_research_status` — desk.read ; checkpoint, budget et nombre de propositions, y compris sans support.
- `get_research_artifacts` — desk.read ; audits, findings, familles, hypothèses, critiques, protocoles paginés.
- `get_research_scorecard` — desk.read ; agrégats de REAL publiés et cohortes descriptives.
- `register_research_experiment` — desk.write ; protocole seulement, aucune exécution.

Le READ corpus est limité à huit fonctions forensic publiques. Aucun objet de commandes OOS n'est transmis au domaine/application. Les événements portent le namespace T3_RESEARCH et restent dans ces tables, pas dans le bus métier.

Le service `DeskOosResearch` utilise `C:\ProgramData\DeskOos\config\oos.research.env`, séparé de l'environnement opérateur : aucun secret OOS operator/admin. Les rôles research/forensic ont subi une tentative contrôlée d'UPDATE OOS dans une transaction annulée : refus PostgreSQL 42501. L'environnement, les backups et les sorties provider sont privés (SYSTEM/Administrators).

Le scheduler sélectionne automatiquement le pilote puis les dates COMPLETED juillet–août. Il suit les tâches persistantes ; chaque étape de diagnostic, discovery ou critique est bornée. Après tous les dossiers journaliers COMPLETED, la comparaison globale réutilise les reviews hashées au lieu de payer une seconde analyse de chaque scénario. Un dossier BLOCKED n'est jamais silencieusement omis. Les hypothèses récurrentes conservent leur définition originale et reçoivent une projection de preuves par cycle.

Le lot scientifique possède un domaine pur `published-counterfactual-experiment.js` et une application `research-scientific-loop.js`, dans le même namespace isolé. Le coordinateur global appelle cette application après le dossier inter-journées, sans attendre une confirmation owner. Les consommateurs sont le scheduler et les six outils research existants (lecture de protocoles/résultats). Le registre d'expériences legacy n'est pas réutilisé : il ne possède pas cette frontière de publications immuables et de promotion interdite. Aucun nouveau service ni nouvelle migration.

Le dossier scientifique devient son propre cycle hashé `SCIENTIFIC_EXPERIMENTS`, référencé au dossier global immuable. Il utilise la même file PostgreSQL, le même heartbeat/fencing et les mêmes reports de ressources que T3, pas une boucle d'appels payés hors file. Sa reprise ne modifie pas le statut/revision du dossier global. Les quotas atteints reportent la tâche jusqu'au reset autoritatif sans consommer un retry. La scorecard du cycle scientifique pointe explicitement sur le champion REAL du dossier source ; les résultats audit-only sont des findings séparés.

Pour une hypothèse avec critique indépendante favorable, le designer choisit le plus petit test disponible ou signale explicitement `NEEDS_ISOLATED_RUNTIME`. Seul un audit de management utilisant BE0.5/BE1/BE1.5/P1@1R déjà publiés est exécutable dans cet adapter. Il ne transforme pas une hypothèse de confirmation/entrée en une règle BE. Le designer ne reçoit pas les profits des variantes ; le protocole fixe échantillon complet éligible, hashes des publications, mécanisme, seuils, risques et limites avant la comparaison. Une reprise relit le protocole gelé et ne paie pas un second design.

REAL et contre-factuel sont comparés sur les mêmes trades publiés. Une publication absente reste NOT_PERSISTED, jamais zéro. Les runners dégradés sont listés, avec provenance. Les timestamps de sorties, USD, fills et DD portfolio d'une nouvelle stratégie ne sont jamais copiés des résultats REAL ni inférés. Les conclusions sont REJECTED_DEVELOPMENT_AUDIT, INCOMPLETE_EVIDENCE ou DEVELOPMENT_AUDIT_SUPPORTED ; aucune ne signifie validation/holdout ni promotion. Les hypothèses rejetées, non testables et résultats incomplets sont mémorisés, puis la suivante est choisie. Un compteur de tests exécutés est distingué du nombre de propositions/associations.

`verify_oos_research_science.mjs` teste ce transport sur les publications réelles 02/07 et 08/07, dans un cycle TECHNICAL_ACCEPTANCE_ONLY séparé. Ce n'est pas une sélection de stratégie ni un nouvel OOS. Il vérifie freeze/read-back, redémarrage du host, idempotence, provenance et invariance du corpus, sans appeler de modèle ou rejouer le marché.

Acceptance VPS réellement PASS : trois publications pairées disponibles, aucune absente ; protocole hashé `9b8c9e93a92f44786cfb7e988ee88d33307bf25d06f472ce3702b80a64e7b493`, résultat technique hashé `97246e7d7ff53e9746b931ae0b8693057d232d7cc59226394b292efb5cd345c7`. Zéro modèle/replay/capture/source modifiée ; aucune validation d'edge revendiquée.

Avant le clustering, chaque review reçoit une audit séparée et immuable, référencée par le hash du finding original. Les interprétations substantielles passent par une nouvelle session du rôle critique. Si les sept réponses sont UNKNOWN et aucune hypothèse n'est formulée, le contrôle technique conserve UNKNOWN sans prétendre à une inférence indépendante. NEEDS_CORRECTION n'écrase jamais la review initiale. Les critiques de scénarios sont comptées séparément des critiques d'hypothèses.

## Sémantique scientifique

- Chaque scénario et chaque attempt est audité, même sans confirmation ; absence d'événement n'est pas preuve de condition fausse.
- Les questions A–G sont obligatoires. HTF/biais/rationale historiques non persistés restent NOT_PERSISTED, pas reconstruits a posteriori.
- Features dérivées uniquement de records/événements publiés. Une hypothèse ne peut injecter ses propres cas ni remplacer les trades.
- Supports/contre-exemples/winners sont des IDs citables ; corrélation dans la même journée visible. Les winners exposés à un prédicat ne sont pas déclarés supprimés par un challenger non exécuté.
- No-trade n'est pas classé GOOD_SELECTIVITY sans preuve. Un loser n'est pas automatiquement management failure.
- Les familles sont des signatures structurelles exactes, pas une équivalence causale entre opportunités.
- Juillet–août déjà étudié = DISCOVERY. Validation/test doivent être ultérieurs, disjoints et absents du corpus exposé.
- Le protocole préenregistre métrique, arrêt, contrôle de multiplicité. Aucune p-value ou validation d'edge n'est calculée dans ce lot. Une critique favorable autorise au plus la préparation d'une expérience.
- Expectancy/PF/distribution et DD de trades clôturés agrègent REAL publié. Les sorties absentes ne valent pas zéro ; métriques incomplètes explicitement marquées. Coût d'opportunité, DD d'equity, catégories de régime et PATH_ALIGNMENT_SCORE restent indisponibles sans données/rubrique préalable.

## Blocages et traitement

| Code | Comportement |
|---|---|
| RESEARCH_CORPUS_DRIFT / RESEARCH_MODEL_DRIFT | arrêt ; nouvelle version/cycle requis, aucun mélange |
| RESEARCH_MODEL_NOT_CONFIGURED / DISCOVERY_UNAVAILABLE | données persistées conservées ; config manquante visible |
| RESEARCH_BUDGET_EXHAUSTED | arrêt ; pas de nouvel appel payé automatique |
| RESEARCH_MODEL_REQUEST_INDETERMINATE | arrêt fail-closed ; inspecter le request journal, ne pas payer deux fois un résultat incertain |
| RESEARCH_SOURCE_INTEGRITY_FAILED / EPISODE_COVERAGE_MISMATCH | ne pas produire un audit complet fictif |
| RESEARCH_HOLDOUT_CONTAMINATED | protocole refusé, aucune adaptation pour transformer discovery en OOS |
| RESEARCH_DATABASE_ROLE_NOT_ISOLATED | activation refusée avant toute recherche |

Une réponse effectivement reçue est désormais journalisée avant validation/persistence de la review ; après crash elle est réutilisée sans seconde inférence. Une requête envoyée mais sans réponse persistée demeure INDETERMINATE : jamais de retry payé aveugle. Deux tentatives bornées sont possibles seulement pour une réponse reçue mais non conforme, avec conservation des deux traces.

Le VISUAL_EVIDENCE_ROUTER charge sélectivement des PNG existants, vérifie SHA-256 et transmet les pixels au provider via des fichiers privés. Le finding conserve refs, claims et confiance. Aucune capture TradingView nouvelle. Les budgets de contexte et profondeurs sont actuellement des métadonnées de routage, pas encore des limites de tokens garanties par le provider. Le modèle réel utilisé est Astra/xhigh ; l'identifiant demandé est vérifié dans le transport, sans attestation du modèle interne du fournisseur.

La gestion des ressources lit `account/rateLimits/read` du compte de service avant l'envoi, conserve la décision dans le journal et diffère jusqu'au reset autoritatif lorsque la limite est atteinte. Le report est effectué avant MODEL_REQUESTED, donc ne crée pas d'inférence incertaine ni de consommation du budget de retry technique. Quota inaccessible = UNKNOWN, pas zéro. Aucun achat, reset de crédit ni notification email fournisseur automatique. La concurrence reste 1 et le budget d'appels par cycle reste autoritatif.

## Validation exécutée

Tests dédiés : audit >5 scénarios/toutes tentatives, données inconnues, exclusion smoke/gap, absence de futurs prix, hash/idempotence (y compris ordre de clés JSON), budget/requêtes incertaines, modèle réellement exposé, critique séparée, protocoles sans exécuteur, cycle autonome borné complet. Tests MCP locaux : 47→53 uniquement si activation, scopes et champs inconnus rejetés. Tests PostgreSQL 16 réel en instance temporaire : migration rejouable, concurrence, rollback, immutabilité, rôles physiques (63 tests passés). Aucun serveur de marché ni replay n'est utilisé par ces tests.

Suite dédiée exécutée après ajout de la boucle scientifique et de sa file persistante : **134/134 PASS**, zéro skip, PostgreSQL 16 réel inclus. Dernier retest OOS + forensic/OAuth clients : **82/82 PASS** ; les lots antérieurs avaient aussi vérifié les autres tests MCP/OAuth. L'inférence de recherche Astra/xhigh et sa reprise ont été testées réellement sur VPS. Après refactor des nouvelles fonctions, le contrôle statique conserve exactement les comptes de dette historiques 271/727/97/6 ; aucune hausse introduite.

Diagnostic quota réel : le helper de sanitisation excluait CODEX_HOME si le caller ne lui passait pas explicitement le profil autorisé. Le transport CLI d'inférence le passait déjà ; la requête metadata ne le faisait pas. Le lecteur metadata doit utiliser le même profil service explicitement, sans hériter des credentials OOS. Test de non-régression dédié : home service conservé, token opérateur exclu.

Guards architecture et migrations PASS. Contrôle ciblé des nouveaux modules : aucun fichier >600 lignes, aucune fonction >60 lignes ou complexité >15. Guard statique global FAIL sur `front-session-projection.js` et budgets globaux du dépôt ; aucune baseline affaiblie, aucun fichier de trading modifié pour le contourner.

Baseline exacte comparée à ddd60841110bcf24cb20fe88b3282af77f88792b : 271 fonctions trop longues, 727 complexes, 97 duplications, 6 modules potentiellement morts ; valeurs identiques après 5829bac. `front-session-projection.js` : 1726 lignes pour allowance 1659, dette préexistante.

## Reste à livrer pour l'objectif 49–80 complet

| Lot | État |
|---|---|
| mémoire/audits/features accessibles/familles/cohortes/contre-exemples/critique/runner | implémenté et production activée ; full T3 non achevé |
| ingestion de la justification du Scenario Builder lors de prochains cycles | contrat de freeze/hash implémenté ; générateur challenger à raccorder ; aucune justification historique inventée |
| analyse visuelle des PREMARKET et panels par modèle | pixels existants raccordés sélectivement avec hashes et claims |
| temporalité détaillée, rearm, portfolio et qualité des données | partiellement accessible dans les snapshots, rubriques causales à étendre |
| régimes point-in-time / path score / graphe causal | bloqué sans définitions préenregistrées et données suffisantes ; pas d'estimation |
| lifecycle complet hypothèses VALIDATED/FAILED et findings résolus | versions/reviews à ajouter, pas de mutation historique |
| challenger scorecard / exécution SHADOW / walk-forward roulant | comparaison audit-only publiée implémentée ; véritable executor de copies research et jeux non contaminés encore requis |
| contrôle statistique des découvertes multiples | déclaration/comptage implémentés ; test statistique non implémenté |
| worker permanent supervisé / UI recherche / déploiement VPS | service automatique actif sur VPS, 44 tâches persistantes, progression pilote réelle ; supervision Codex heartbeat active ; UI recherche non réalisée |

Rollback : mettre `research_enabled=false`, arrêter le runner, conserver la mémoire. Ne jamais effacer les tables pour revenir au champion : celui-ci n'a pas changé. Rentabilité future non garantie.
