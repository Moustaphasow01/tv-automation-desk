# Strategy Kernel SQL foundation

Date: 2026-08-09
Tickets: TD2-100, TD2-102, TD2-103, TD2-104, TD2-105, TD2-300

## Décision

Le socle relationnel Strategy Kernel est introduit de façon additive avec trois agrégats distincts :

- `strategy_definitions` : identité stable d’une idée de stratégie.
- `strategy_versions` : révision figée/testable d’une définition.
- `strategy_instances` : exécution paramétrée d’une version, avec état runtime et mode d’exécution séparés.

Cette migration ne branche pas encore le runtime V5 actif. Elle prépare uniquement la persistance cible pour les tickets suivants.

## Invariants SQL protégés

- `strategy_versions.strategy_definition_id` référence `strategy_definitions`.
- `strategy_instances.strategy_version_id` référence `strategy_versions`.
- `strategy_version_status`, `strategy_instance_runtime_state` et `strategy_instance_execution_mode` sont trois enums séparés.
- Une Strategy Version `published` ou `deprecated` ne peut plus modifier son DSL, ses artefacts, ses hashes, son bundle runtime ou ses métadonnées.
- Plusieurs instances `shadow`/`paper` peuvent coexister.
- Plusieurs instances `live` sur le même compte ne sont pas autorisées sans `triple_lock_validated=true`.
- `ACTIVE_STRATEGY_RUNTIME_VERSIONS` reste orthogonal et singulier : la migration ne le lit pas, ne l’étend pas et ne le remplace pas.

## Portée volontairement exclue

- Pas de seed métier.
- Pas de repository/service.
- Pas d’API REST.
- Pas de backfill `trades.strategy_instance_id`.
- Pas de modification du chemin Live/Replay V5.

Ces éléments sont couverts par les tickets TD2-101 à TD2-106.

## Addendum TD2-102 — repository, service et audit

TD2-102 ajoute une couche applicative sans brancher encore le runtime Live/Replay :

- `mcp_gpt_desk/src/strategy-kernel-repository.js` mappe les enums domaine en enums SQL et fournit le repository Postgres.
- `mcp_gpt_desk/src/strategy-kernel-service.js` applique les validateurs du package domaine avant toute écriture.
- `strategy_kernel_audit_events` trace les créations, idempotences et transitions de Definition, Version et Instance.

Invariants ajoutés :

- chaque mutation passe par une transaction verrouillée par agrégat ;
- une commande rejouée avec le même contenu reste idempotente ;
- une transition invalide est refusée avant persistance ;
- `runtime_state` et `execution_mode` restent indépendants ;
- `PAPER -> LIVE` exige une approbation opérateur ;
- un conflit de compte live exige la triple-lock.

Cette couche prépare TD2-103, qui exposera les API REST Strategy v2. Elle ne modifie toujours pas le chemin V5 actuel.

## Addendum TD2-103 — API REST Strategy v2

TD2-103 expose le Strategy Kernel par une surface REST versionnée sans remplacer l’ancien endpoint `/api/v1/strategies` :

- `GET/POST /api/v1/strategy-v2/definitions`
- `GET /api/v1/strategy-v2/definitions/{strategyDefinitionId}`
- `GET/POST /api/v1/strategy-v2/versions`
- `GET /api/v1/strategy-v2/versions/{strategyVersionId}`
- `POST /api/v1/strategy-v2/versions/{strategyVersionId}/actions`
- `GET/POST /api/v1/strategy-v2/instances`
- `GET /api/v1/strategy-v2/instances/{strategyInstanceId}`
- `POST /api/v1/strategy-v2/instances/{strategyInstanceId}/actions`
- `GET /api/v1/strategy-v2/audit`

Principes :

- les mutations restent protégées par le même mécanisme opérateur `desk.write` que les autres routes sensibles ;
- les payloads sont validés dans `front-operations-api.js` avant délégation ;
- les créations et transitions passent par `StrategyKernelService`, jamais directement par le repository ;
- cette API ne branche pas encore les instances au runtime Live/Replay V5.

## Addendum TD2-104 — projection BFF et écrans transitoires

TD2-104 ajoute une projection opérateur au-dessus de la surface REST granulaire :

- `GET /api/v1/strategy-v2/overview` agrège Definitions, Versions, Instances et Audit dans une seule réponse front.
- L’overview calcule les compteurs de publication, d’instances `SHADOW`/`PAPER`/`LIVE`, les statuts runtime et la prochaine étape opérateur.
- Le front `/strategies` utilise maintenant Strategy v2 comme source canonique de gouvernance.
- L’ancien endpoint `/api/v1/strategies` reste consommé uniquement comme fallback de performance historique et comparaison legacy.
- Le détail `/strategies/{strategyDefinitionId}` expose versions, instances et audit récent sans inventer de stratégie quand le registry v2 est vide.

Cette étape reste transitoire : elle rend le nouveau kernel observable par l’opérateur avant le branchement runtime TD2-106+.

## Addendum TD2-105 — lien nullable trades vers Strategy Instance

TD2-105 prépare l’attribution déterministe des trades au futur Strategy Kernel sans réinterpréter l’historique :

- `trades.strategy_instance_id` est ajouté en colonne `uuid` nullable.
- La colonne référence `strategy_instances(strategy_instance_id)` avec `ON DELETE SET NULL`.
- Un index partiel couvre uniquement les lignes renseignées.
- `trades.strategy_id` reste le champ legacy historique et n’est pas renommé, converti, ni utilisé comme source de backfill.

Invariant non négociable :

- aucune ligne historique ne doit être déduite depuis `strategy_id` ;
- une ligne existante reste lisible avec `strategy_instance_id IS NULL` ;
- seules les nouvelles écritures runtime pourront renseigner explicitement une Strategy Instance valide.

## Addendum TD2-106 — compilation `BREAKOUT_RETEST`

TD2-106 ajoute le premier vertical slice Strategy Kernel réellement compilable :

- `packages/desk-domain/src/strategy-dsl-compiler-v1.js` compile une Strategy Version `BREAKOUT_RETEST`.
- La compilation prend explicitement deux entrées séparées :
  - la DSL versionnée de stratégie ;
  - les `runtime_bindings` de marché nécessaires à une opportunité précise : niveau de cassure, zone de retest, stop, objectif, validité.
- La sortie est un artefact `strategy_compiled_artifact_v1` contenant un `deterministic_execution_plan_v1_4` produit par le compilateur existant.
- Les exemples canonisés sont disponibles dans :
  - `packages/desk-contracts/examples/strategy-breakout-retest-dsl-v1.example.json` ;
  - `packages/desk-contracts/examples/strategy-breakout-retest-runtime-bindings.example.json`.

Garde-fous :

- une DSL absente, non JSON ou au hash divergent est rejetée avant compilation ;
- des bindings runtime incomplets sont rejetés avant artefact, sans fabrication de prix ;
- `strategy-runtime-versioning.js` n’est pas modifié ;
- le chemin Live/Replay V5 actif n’est pas automatiquement branché sur cette Strategy Version.

## Addendum TD2-300 — compilation opérable depuis Strategy Kernel

TD2-300 raccorde le compilateur DSL existant à la couche applicative :

- `StrategyKernelService.compileVersion` charge la Definition et la Version, puis compile le `dsl_source` fourni avec les `runtime_bindings` et le `scope`.
- `POST /api/v1/strategy-v2/versions/{strategyVersionId}/actions` accepte maintenant `action="compile_dsl"`.
- Une compilation acceptée retourne `COMPILED`, l’artefact `strategy_compiled_artifact_v1`, le `deterministic_execution_plan_v1_4` et les hashes d’évidence.
- Une compilation refusée retourne `REJECTED` avec les raisons déterministes, sans exception runtime et avec audit `STRATEGY_VERSION_COMPILE_REJECTED`.

Invariant conservé :

- l’action ne mute pas encore `compiled_artifact_hash` dans `strategy_versions`, car ce champ est immuable dans le registre actuel ; la persistance/versioning d’artefact reste le chantier suivant.

## Addendum TD2-600 — scheduler par Strategy Instance

TD2-600 ajoute le premier scheduler déterministe du runtime cible sans migration SQL additionnelle :

- `packages/desk-domain/src/strategy-instance-scheduler-v1.js` calcule les ticks dus par `Strategy Instance`.
- `StrategyKernelService.planInstanceSchedulerCycle` lit les instances, applique la politique et écrit un audit `STRATEGY_INSTANCE_SCHEDULER_TICK_DUE`.
- La priorité est `LIVE` > `PAPER` > `SHADOW`.
- Les instances `PAUSED` ou non exécutables sont supprimées du cycle sans changer leur `execution_mode`.
- La clé `scheduler_run_key` rend le cycle idempotent après redémarrage.

La configuration reste dans `strategy_instances.metadata.scheduler` pour éviter une table prématurée avant TD2-601/TD2-604.

Référence détaillée : `docs/engineering/strategy-instance-scheduler-v1.md`.

## Addendum TD2-601 — Signal Bus outbox notify et polling

TD2-601 ajoute le transport durable des signaux produits par le futur Live Strategy Runtime :

- `strategy_signal_outbox` stocke chaque signal normalisé avec payload hash, fenêtre de validité, statut et clé de déduplication.
- `StrategySignalBusService.publishSignal` publie un signal dans l’outbox sans l’envoyer directement au broker.
- PostgreSQL émet `desk_strategy_signal_ready` pour réveiller rapidement les consommateurs.
- Le polling `pending` non expiré reste le fallback obligatoire si la notification est perdue.
- `markConsumed` ferme explicitement un item d’outbox après traitement par un consommateur aval.

Invariant conservé :

- le Signal Bus transporte une intention stratégique standardisée ;
- la décision portfolio/risk/broker reste hors TD2-601 et arrive dans les tickets P8.

Référence détaillée : `docs/engineering/strategy-signal-bus-v1.md`.

## Addendum TD2-602 — preuve de parité Simulation / SHADOW

TD2-602 ajoute une preuve domaine sans nouvelle migration SQL :

- `buildStrategyShadowParityReportV1` compare une sortie Simulation et une sortie SHADOW sur le même scénario figé.
- La comparaison accepte deux `signal_id` techniques différents, mais exige la même sémantique : instrument, direction, fenêtre de validité, corrélation, payload métier et Strategy Version.
- Les no-op d’expiration sont comparables explicitement sans publier de signal.
- Une preuve incomplète ou invalide retourne `PARITY_INVALID`, jamais un succès implicite.

Cette étape ne remplace pas le futur Simulation Engine portefeuille : elle fixe le contrat minimal que TD2-603+ et P8 devront conserver.

Référence détaillée : `docs/engineering/strategy-shadow-parity-v1.md`.

## Addendum TD2-603 — promotion manuelle SHADOW / PAPER

TD2-603 durcit la transition d’exécution des `Strategy Instance` :

- `SHADOW → PAPER` exige désormais un `operator_approval_id` explicite.
- Un agent de métriques ou de recherche ne peut plus promouvoir une instance seulement parce qu’un seuil est bon.
- `PAPER → SHADOW` exige une raison opérateur auditée et efface l’approbation paper active.
- Aucun nouveau chemin vers `LIVE` n’est ajouté.

Référence détaillée : `docs/engineering/strategy-instance-promotion-v1.md`.

## Addendum TD2-604 — front transitoire Instances et Signal Bus

TD2-604 expose le runtime Strategy V2 dans le front actuel :

- `/api/v1/strategy-v2/signals` lit la file réelle `strategy_signal_outbox` via le store Strategy Signal Bus.
- `/api/v1/strategy-v2/signals/{signalOutboxId}/actions` permet uniquement de consommer un signal existant.
- `/strategies` affiche les instances persistées, les modes `SHADOW/PAPER/LIVE`, les états runtime, les approvals et les signaux pending.
- La création de signaux reste interdite côté front : elle appartient au runtime stratégie.
- Le front affiche une erreur explicite si le bus est indisponible, sans fallback mock.

Référence détaillée : `docs/engineering/strategy-front-instances-signals-v1.md`.

## Addendum TD2-605 — dérive de performance live

TD2-605 ajoute une preuve déterministe de dérive Strategy Instance :

- `buildStrategyLivePerformanceDriftReportV1` compare baseline validée et observations runtime.
- Le statut est normalisé : `OK`, `WATCH`, `DRIFT`, `BASELINE_MISSING`, `INSUFFICIENT_DATA`.
- La page `/strategies` affiche la dérive par instance dans la vue runtime.
- En transition, les métriques peuvent vivre dans `strategy_versions.metadata` et `strategy_instances.metadata`; le front affiche explicitement les données manquantes au lieu de fabriquer un résultat.
- Une dérive critique recommande une pause/revue, mais ne supprime pas l’instance automatiquement.

Référence détaillée : `docs/engineering/strategy-live-performance-drift-v1.md`.

## Addendum TD2-700 — Candidate Allocation et portefeuille virtuel

TD2-700 ouvre la phase P8 avec une couche portefeuille avant le risque global :

- `buildCandidateAllocationPortfolioV1` agrège les signaux actifs par instrument.
- La politique V1 neutralise les directions opposées via `NET_BY_DIRECTION`.
- Les allocations `FLAT` à taille `0` restent auditables au lieu de disparaître.
- `buildVirtualStrategyPortfolioV1` calcule exposition et résultat R virtuel par `Strategy Instance`.
- Aucun ordre broker ou target position n’est produit dans ce ticket.

Référence détaillée : `docs/engineering/portfolio-candidate-allocation-v1.md`.

## Addendum TD2-701 — budgets de risque globaux

TD2-701 ajoute la première évaluation budgétaire de portefeuille :

- `normalizePortfolioRiskBudgetV1` normalise les limites compte, instrument, Strategy Instance, groupe corrélé, pertes journalières et hebdomadaires.
- `evaluatePortfolioRiskBudgetV1` compare les Candidate Allocations au portefeuille virtuel courant.
- Le moteur retourne `PASS`, `REDUCE`, `BLOCK` ou `CONFIG_MISSING`.
- `CONFIG_MISSING` est fail-closed : les valeurs `OP-8` ne sont jamais inventées par le code.
- La taille approuvable est calculée, mais la Target Position nette reste TD2-702.

Référence détaillée : `docs/engineering/portfolio-risk-budget-v1.md`.

## Addendum TD2-702 — Target Position nette

TD2-702 ajoute le premier Broker Netting Engine déterministe :

- `buildPortfolioTargetPositionPlanV1` consomme Candidate Allocations + Risk Budget Evaluation.
- La clé de target est `account_id + instrument`.
- Les allocations opposées sont nettées en une seule Target Position.
- `current_net_size` et `delta_size` préparent TD2-703.
- Les contributions par Strategy Instance restent auditables.
- Aucun `OrderIntent` n’est généré dans ce ticket.

Référence détaillée : `docs/engineering/portfolio-target-position-v1.md`.

## Addendum TD2-703 — OrderIntent déterministe

TD2-703 ajoute la conversion provider-neutral Target Position → OrderIntent :

- `buildPortfolioOrderIntentPlanV1` consomme les Target Positions de TD2-702.
- Les intents portent `idempotency_key`, `lifecycle_action`, protections requises et audit de source.
- Les cas `REDUCE`, `REVERSE` et `CANCEL_REPLACE` sont couverts par test.
- Aucun intent n’est considéré soumissible si les protections exigées sont absentes.

Référence détaillée : `docs/engineering/portfolio-order-intent-v1.md`.

## Addendum TD2-704 — réconciliation exécution

TD2-704 ajoute `evaluatePortfolioExecutionReconciliationV1` :

- détection de doublons d’idempotence actifs ;
- redémarrage sans double ordre via les intents existants ;
- audit des fills partiels et quantités restantes ;
- divergence broker/desk en état contrôlé avec `HALT_BROKER_SUBMIT`.

Référence détaillée : `docs/engineering/portfolio-execution-reconciliation-v1.md`.

## Addendum TD2-706 — PnL virtuel et similarité

TD2-706 ajoute `buildPortfolioVirtualPnlAttributionV1` :

- attribution `total_r`, `expectancy_r`, `win_rate` par Strategy Instance ;
- lecture de l’exposition virtuelle par instance ;
- réutilisation de la similarité génomique TD2-507 ;
- génération d’`allocation_impacts[]` pour les stratégies trop proches.

Référence détaillée : `docs/engineering/portfolio-virtual-pnl-attribution-v1.md`.

## Addendum TD2-707 — contraintes prop firm multi-compte

TD2-707 ajoute `evaluatePropFirmAccountRiskV1` :

- calcul du plancher trailing drawdown ;
- buffer disponible et risque approuvable ;
- blocage/réduction selon limites prop firm ;
- routes séparées par `account_id + instrument`.

Référence détaillée : `docs/engineering/prop-firm-account-risk-v1.md`.
