# LOT 003 — Persistance canonique Portfolio/Risk/Target + branchement runtime

Date: 2026-08-13
Repository: `TV_Automation_PREPROD`
Scope: fermeture progressive des écarts liés à la persistance canonique de la chaîne `StrategySignal → Portfolio Arbitration → Global Risk → TargetPosition → OrderIntent`.

## Décision d'architecture

Le bounded context propriétaire des nouveaux agrégats persistés est `portfolio-risk`.

Le lot ne déplace pas encore la table historique `trade_order_intents`, qui reste dans le bounded context `execution`. Le pont ajouté est volontairement un lien de lineage optionnel depuis `portfolio_order_intent_lineage.trade_order_intent_id` vers `trade_order_intents(order_intent_id)`.

Ce choix respecte l'ADR d'extraction progressive:

- `portfolio-risk` possède les allocations candidates, décisions risk, target positions et preuves de lineage.
- `execution` reste responsable des commandes provider et événements broker.
- `mcp_gpt_desk` reste un host/adaptateur de transition, pas le propriétaire métier.

Migration appliquée en mode expand-only: aucune suppression, aucun remapping destructif, aucun drop legacy.

## Implémentation

### SQL canonique PostgreSQL

Migration ajoutée:

- `infra/postgres/init/048_portfolio_risk_runtime_lineage.sql`

Tables ajoutées:

- `portfolio_arbitration_runs`
- `portfolio_candidate_allocations`
- `portfolio_risk_decisions`
- `portfolio_target_positions`
- `portfolio_target_position_allocations`
- `portfolio_target_position_risk_decisions`
- `portfolio_order_intent_lineage`

Invariants principaux:

- `idempotency_key` unique au niveau `portfolio_arbitration_runs`.
- décisions risk limitées à `APPROVED / REDUCED / REJECTED`.
- statuts risk limités à `PASS / REDUCE / BLOCK`.
- directions nettes limitées à `LONG / SHORT / FLAT`.
- `risk_approved_net_size` persiste la taille approuvée par Risk dans la TargetPosition.
- hashes SHA-256 obligatoires pour les payloads, plans, targets et order intents.
- liens relationnels allocation → risk → target → order intent.
- lien optionnel vers `trade_order_intents` sans transférer la propriété execution vers portfolio-risk.

Preuves:

- `infra/postgres/init/048_portfolio_risk_runtime_lineage.sql:1`
- `infra/postgres/init/048_portfolio_risk_runtime_lineage.sql:29`
- `infra/postgres/init/048_portfolio_risk_runtime_lineage.sql:54`
- `infra/postgres/init/048_portfolio_risk_runtime_lineage.sql:80`
- `infra/postgres/init/048_portfolio_risk_runtime_lineage.sql:104`
- `infra/postgres/init/048_portfolio_risk_runtime_lineage.sql:114`
- `infra/postgres/init/048_portfolio_risk_runtime_lineage.sql:124`

### Ownership SQL

Le registre de politique SQL reconnaît maintenant le bounded context `portfolio-risk`.

Preuve:

- `docs/engineering/sql-migration-policy.json`

### Repository runtime

Ajout:

- `mcp_gpt_desk/src/portfolio-risk-runtime-repository.js`

Fonctions prouvées:

- transaction PostgreSQL `BEGIN → inserts lineage → COMMIT`;
- rollback sur erreur;
- idempotence par `portfolio_arbitration_runs.idempotency_key`;
- lecture de lineage depuis `portfolio_order_intent_lineage`;
- repository mémoire pour tests sans déplacer la source de vérité cible;
- fail-closed si le repository PostgreSQL n'est pas disponible;
- fail-closed si `as_of_utc` est absent.

Preuves:

- `mcp_gpt_desk/src/portfolio-risk-runtime-repository.js:3`
- `mcp_gpt_desk/src/portfolio-risk-runtime-repository.js:16`
- `mcp_gpt_desk/src/portfolio-risk-runtime-repository.js:21`
- `mcp_gpt_desk/src/portfolio-risk-runtime-repository.js:27`
- `mcp_gpt_desk/src/portfolio-risk-runtime-repository.js:33`
- `mcp_gpt_desk/src/portfolio-risk-runtime-repository.js:35`
- `mcp_gpt_desk/src/portfolio-risk-runtime-repository.js:43`
- `mcp_gpt_desk/src/portfolio-risk-runtime-repository.js:228`

### Service runtime

Ajout:

- `mcp_gpt_desk/src/portfolio-risk-runtime-service.js`

Le service exécute la chaîne:

`StrategySignal → CandidateAllocation → GlobalRisk → TargetPosition → OrderIntent → Persistance`.

Fonctions prouvées:

- orchestration par `buildCandidateAllocationPortfolioV1`;
- passage obligatoire par `evaluatePortfolioRiskBudgetV1`;
- TargetPosition produite par `buildPortfolioTargetPositionPlanV1`;
- OrderIntent produit par `buildPortfolioOrderIntentPlanV1`;
- consommation du Strategy Signal Bus seulement après persistance réussie;
- horloge injectable via `SystemClock`.

Preuves:

- `mcp_gpt_desk/src/portfolio-risk-runtime-service.js:10`
- `mcp_gpt_desk/src/portfolio-risk-runtime-service.js:17`
- `mcp_gpt_desk/src/portfolio-risk-runtime-service.js:20`
- `mcp_gpt_desk/src/portfolio-risk-runtime-service.js:28`
- `mcp_gpt_desk/src/portfolio-risk-runtime-service.js:35`
- `mcp_gpt_desk/src/portfolio-risk-runtime-service.js:42`
- `mcp_gpt_desk/src/portfolio-risk-runtime-service.js:49`
- `mcp_gpt_desk/src/portfolio-risk-runtime-service.js:63`

## Tests ajoutés

### Service runtime

Fichier:

- `mcp_gpt_desk/test/portfolio_risk_runtime_service.test.js`

Cas prouvés:

- persistance ACCEPT complète jusqu'à OrderIntent;
- fail-closed sans Global Risk;
- idempotence de commande runtime;
- consommation du Signal Bus uniquement après persistance;
- ordre transactionnel PostgreSQL.

Preuves:

- `mcp_gpt_desk/test/portfolio_risk_runtime_service.test.js:12`
- `mcp_gpt_desk/test/portfolio_risk_runtime_service.test.js:30`
- `mcp_gpt_desk/test/portfolio_risk_runtime_service.test.js:45`
- `mcp_gpt_desk/test/portfolio_risk_runtime_service.test.js:58`
- `mcp_gpt_desk/test/portfolio_risk_runtime_service.test.js:71`

### Schema SQL

Fichier:

- `mcp_gpt_desk/test/portfolio_risk_runtime_sql_schema.test.js`

Cas prouvés:

- création des tables canoniques;
- lineage allocation → risk → target → order intent;
- invariants relationnels et hashés;
- ownership `portfolio-risk`.

Preuves:

- `mcp_gpt_desk/test/portfolio_risk_runtime_sql_schema.test.js:12`
- `mcp_gpt_desk/test/portfolio_risk_runtime_sql_schema.test.js:20`
- `mcp_gpt_desk/test/portfolio_risk_runtime_sql_schema.test.js:29`
- `mcp_gpt_desk/test/portfolio_risk_runtime_sql_schema.test.js:37`

## Matrice de conformité du lot

| Requirement | Current status | Gap initial | Implementation | Tests | Runtime proof | Final status |
|---|---:|---|---|---|---|---:|
| PostgreSQL persiste les objets Portfolio/Risk/Target | PARTIEL | Objets domaine testés mais non matérialisés en tables dédiées | Migration `048_portfolio_risk_runtime_lineage.sql` | `portfolio_risk_runtime_sql_schema.test.js` | Preuve SQL + guard migration, pas encore apply DB réel dans cette distro | FAIT côté schema / NON PROUVÉ côté DB runtime réel |
| TargetPosition conserve la lineage Global Risk | PARTIEL | TargetPosition pouvait être prouvée domaine mais pas reliée en base aux décisions Risk | Tables `portfolio_target_position_risk_decisions` et `risk_approved_net_size` | SQL schema + service tests | Test fake-pool PostgreSQL transactionnel | FAIT côté repo |
| OrderIntent conserve la lineage Target/Risk/Allocation | PARTIEL | OrderIntent domaine sans persistance canonique dédiée | `portfolio_order_intent_lineage` + lien optionnel `trade_order_intents` | SQL schema + service tests | Test fake-pool PostgreSQL transactionnel | FAIT côté repo |
| Chaîne Signal Bus → Portfolio/Risk → Target → OrderIntent | PARTIEL | Aucun service applicatif ne liait Signal Bus et pipeline Portfolio/Risk persistant | `PortfolioRiskRuntimeService.processPendingSignals` | service test | Repository mémoire + fake Signal Bus | FAIT pour slice applicative testée |
| Idempotence runtime Portfolio/Risk | PARTIEL | Idempotence prouvée domaine, pas sur persistance du run | `portfolio_arbitration_runs.idempotency_key UNIQUE` + repository idempotent | service test | Test memory + SQL inspection | FAIT |
| Fail-closed sans Global Risk | PARTIEL | Lot 002 prouvait domaine; Lot 003 devait prouver absence de Target/Intent persisté | service + repository ne persistent aucun target/intent quand Risk est indisponible | service test | Test memory | FAIT |
| Full live runtime branché sur DB réelle | NON PROUVÉ | Le scheduler/live existant ne passe pas encore explicitement par ce service en production | Non traité dans ce lot | Aucun test real-stack | Docker indisponible dans WSL local | PARTIEL / NON PROUVÉ |
| Prop firm/trailing DD dans Risk obligatoire persistant | PARTIEL | Domaine existant ailleurs, non intégré comme verrou global obligatoire dans ce service | Non traité dans ce lot | Non | Non | PARTIEL |
| Kill switch global explicite dans ce pipeline | PARTIEL | Des protections existent ailleurs, pas encore table/config Risk globale branchée ici | Non traité dans ce lot | Non | Non | PARTIEL |

## Commandes exécutées

### Syntax check

```text
node --check mcp_gpt_desk/src/portfolio-risk-runtime-repository.js
node --check mcp_gpt_desk/src/portfolio-risk-runtime-service.js
node --check mcp_gpt_desk/test/portfolio_risk_runtime_service.test.js
node --check mcp_gpt_desk/test/portfolio_risk_runtime_sql_schema.test.js
```

Résultat: OK.

### Tests ciblés Lot 003

```text
node --test mcp_gpt_desk/test/portfolio_risk_runtime_sql_schema.test.js mcp_gpt_desk/test/portfolio_risk_runtime_service.test.js
```

Résultat:

```text
tests 9
pass 9
fail 0
duration_ms 3365.281833
```

### Suite domaine

```text
npm --prefix packages/desk-domain test
```

Résultat:

```text
tests 449
suites 60
pass 449
fail 0
duration_ms 16287.847629
```

### Suite MCP complète

```text
npm --prefix mcp_gpt_desk test
```

Résultat final après correction clock:

```text
tests 1025
suites 12
pass 1025
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 188613.32869
```

### Guards

```text
npm run guard:sql-migrations:test
npm run guard:sql-migrations
```

Résultat:

```text
guard:sql-migrations:test OK
guard:sql-migrations OK
owners.portfolio-risk = 7
```

Warnings SQL restants: uniquement des tables préexistantes sans index secondaire, sans warning sur les nouvelles tables `portfolio_*`.

```text
npm run guard:architecture
```

Résultat:

```text
ok true
checked_files 381
```

```text
npm run guard:runtime-safety
```

Résultat après correction:

```text
ok true
direct_clock_usages 130
direct_clock_budget 130
```

```text
npm run guard:mcp-slices
```

Résultat:

```text
ok true
actual_tools 117
assigned_tools 117
slice_count 10
```

```text
npm run guard:windows-deployment
```

Résultat:

```text
ok true
files 87
env_tokens 12
```

```text
npm run guard:exceptions
```

Résultat:

```text
ok true
active_exceptions 3
next_expiration 2026-12-31
```

```text
npm run guard:problem-details
```

Résultat:

```text
ok true
schema_version desk_problem_details_v1
codes 12
```

### Static quality

```text
npm run guard:static-quality
```

Résultat: KO connu, non masqué.

```text
front-control-plane-api.js has 1362 lines; allowed 600
store.js has 2488 lines; allowed 2485
strategy-dsl-compiler-v1.js has 624 lines; allowed 600
canonical-simulation-engine-v1.js has 881 lines; allowed 600
high complexity functions: 617; allowed 592
duplicate blocks: 73; allowed 50
possibly dead files: 17; allowed 14
```

### Docker / real stack

```text
docker compose config --quiet
```

Résultat: NON PROUVÉ localement.

Cause:

```text
The command 'docker' could not be found in this WSL 2 distro.
```

Action externe nécessaire: activer l'intégration Docker Desktop WSL ou exécuter la preuve real-stack depuis un environnement où Docker est disponible.

## État de fermeture

### FAIT gagnés dans ce lot

1. Tables PostgreSQL canoniques Portfolio/Risk/Target/OrderIntent lineage ajoutées.
2. Ownership SQL `portfolio-risk` déclaré.
3. Repository PostgreSQL transactionnel ajouté.
4. Idempotence persistée par clé métier.
5. Lineage allocation → risk → target → order intent persistable.
6. Service applicatif runtime ajouté au-dessus du domaine Lot 002.
7. Signal Bus consommé uniquement après persistance réussie.
8. Fail-closed prouvé quand Global Risk ne produit aucune décision exploitable.
9. Régression clock corrigée: pas de nouveau `new Date()` sans horloge injectée.

### Toujours PARTIEL

1. Branchement du scheduler/live réel vers `PortfolioRiskRuntimeService`.
2. Lien effectif `portfolio_order_intent_lineage → trade_order_intents → execution_provider_commands` en runtime réel.
3. Prop firm/trailing drawdown/multi-account dans le verrou global obligatoire.
4. Kill switch global explicite intégré dans ce pipeline.
5. Dette static-quality.

### NON PROUVÉ

1. Apply de la migration sur une vraie base PostgreSQL locale/VPS depuis cet environnement.
2. Cycle live DB réel complet `StrategySignal persisted → PortfolioRisk persisted → Execution command`.

### BLOQUÉ EXTERNE

1. Docker indisponible dans cette distro WSL pour preuve real-stack.

## Prochain lot recommandé

`LOT 004 — Branchage runtime réel et Execution Gateway depuis la lineage Portfolio/Risk`

Objectifs:

1. Appliquer la migration sur une vraie base PostgreSQL de test.
2. Brancher le scheduler/live/research sur `PortfolioRiskRuntimeService`.
3. Transformer uniquement les `portfolio_order_intent_lineage` autorisés en commandes `execution_provider_commands`.
4. Ajouter un test E2E DB réel prouvant:
   `StrategySignal → Portfolio/Risk persisted → TargetPosition persisted → OrderIntent lineage → ExecutionProviderCommand`.
5. Ajouter le kill switch global et les contraintes prop firm/trailing DD dans le chemin obligatoire.
6. Vérifier qu'aucun ancien chemin ne peut produire une commande provider sans lineage Portfolio/Risk.

## Note release

Les fichiers de Lot 002 et Lot 003 apparaissent dans un workspace très dirty/non tracké. Ils sont testés, mais devront être explicitement inclus dans le prochain commit/release. Ne pas faire de release partielle sans inclure les migrations, services, tests et rapports de conformité liés.
