# LOT 002 — Global Risk obligatoire end-to-end

Date: 2026-08-13
Repository: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`
Objectif: prouver qu'aucune exposition physique MNQ/MES ne peut atteindre un `OrderIntent` exécutable sans passer par `StrategySignal -> Portfolio Arbitration -> Global Risk -> TargetPosition -> OrderIntent -> Execution Gateway`.

## Résultat court

Statut du lot: PARTIEL -> MAJORITAIREMENT FERMÉ côté domaine, encore PARTIEL côté persistance PostgreSQL.

Ce lot ferme deux bypass critiques détectés dans le domaine:

1. `TargetPosition` pouvait être construite sans évaluation Global Risk exploitable.
2. `OrderIntent` pouvait être construit à partir d'une TargetPosition arbitraire ou mutée après validation risk.

Après correction, le domaine refuse fail-closed:

- allocation exposante sans Global Risk;
- décision risk manquante ou indisponible;
- target sans lineage Portfolio;
- target sans lineage Risk;
- target dont la taille a été modifiée après approbation risk;
- duplicate intent sur même clé d'idempotence.

## Chaîne autorisée

```text
StrategySignal
  -> CandidateAllocation / Portfolio Arbitration
  -> Global Risk Budget Evaluation
  -> TargetPosition
  -> OrderIntent
  -> ExecutionProviderCommand
  -> Provider adapter
```

Un `OrderIntent` exécutable doit maintenant porter:

- `target_position_id`;
- `source.target_position_id`;
- `source.risk_decision_ids`;
- `source.candidate_allocation_ids`;
- `risk_approved_net_size` côté TargetPosition;
- `order_intent_hash`;
- `idempotency_key`.

## Audit des chemins d'exposition

| Chemin | Classification | Décision |
|---|---:|---|
| `StrategySignal -> buildCandidateAllocationPortfolioV1 -> evaluatePortfolioRiskBudgetV1 -> buildPortfolioTargetPositionPlanV1 -> buildPortfolioOrderIntentPlanV1 -> buildExecutionProviderCommandV1` | AUTHORIZED | Chemin cible validé par tests E2E domaine. |
| Ancien chemin `desk_positions -> trade_decision -> broker execution service -> trade_order_intents` | LEGACY_BLOCKED | Bloqué par défaut par l'autorité Lot 001; rollback seulement avec flag explicite sécurisé. |
| Bridge/AddOn qui claim des outbox legacy | LEGACY_BLOCKED | Tests broker prouvent le blocage si l'intent n'a pas la preuve Portfolio/Risk. |
| Scripts Ninja/ATI de matrice | TEST_ONLY | Usage test/démo uniquement, gardé hors chemin métier. |
| Management reduce/close/break-even | EMERGENCY_PATH / RISK_REDUCING | Existe pour réduire le risque; reste à harmoniser avec le registre TargetPosition/Risk canonique. |
| Theoretical/manual execution | TEST_ONLY / PAPER_THEORETICAL | Ne doit pas être assimilé à un fill broker; tests confirment la séparation manual/theoretical. |
| `ExecutionProviderPort` | AUTHORIZED | Ne produit une commande provider que depuis un `portfolio_order_intent_v1` submittable et idempotent. |

## Implémentation réalisée

### Global Risk Evaluation

Fichier: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/portfolio-risk-budget-v1.js`

Preuves:

- lignes 29-49: `evaluatePortfolioRiskBudgetV1` produit une évaluation canonique avec `allocation_evaluations`, `gate` et `evaluation_hash`;
- lignes 51-78: chaque allocation reçoit `risk_decision_id`, `decision`, `reason_codes`, `approved_size`;
- lignes 55-63: limites portefeuille, compte, instrument, corrélation, stratégie, perte journalière et hebdomadaire;
- lignes 158-162: mapping fermé `PASS -> APPROVED`, `REDUCE -> REDUCED`, sinon `REJECTED`.

### TargetPosition fail-closed

Fichier: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/portfolio-target-position-v1.js`

Preuves:

- lignes 10-14: TargetPosition est construite à partir d'allocations + `risk_budget_evaluation`;
- lignes 26-49: chaque allocation exposante est jointe avec sa décision risk;
- lignes 61-79: TargetPosition porte `schema_version`, `derived_from_risk_decision_ids`, `risk_decision_statuses`, `risk_rule_set_versions`, `risk_evaluation_hashes`, `risk_approved_net_size`, `candidate_allocation_ids`;
- lignes 109-120: normalisation du Global Risk et détection d'indisponibilité;
- lignes 151-159: fail-closed si Global Risk absent, indisponible, en erreur, ou décision manquante.

### OrderIntent verrouillé par Portfolio/Risk

Fichier: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/portfolio-order-intent-v1.js`

Preuves:

- lignes 50-58: un target non autoritaire est skipped avant construction d'intent;
- lignes 63-99: `OrderIntent` porte `schema_version`, `order_intent_id`, `target_position_id`, `idempotency_key`, `source`, `audit`;
- lignes 87-92: source auditable TargetPosition + risk decisions + candidate allocations;
- lignes 197-208: blocage de target sans schema canonique, sans id, sans Portfolio lineage, sans Risk lineage, sans taille approuvée risk, ou mutée après validation risk;
- lignes 154-156 et 35-43: protection contre les intents actifs/duplicates.

## Tests ajoutés ou renforcés

Fichier: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/test/global-risk-mandatory-pipeline-v1.test.js`

Cas couverts:

- lignes 13-27: ACCEPT, le chemin complet produit un intent exécutable;
- lignes 29-43: REDUCE, Risk réduit +10 à +4 avant OrderIntent;
- lignes 45-57: REJECT, un blocage risk produit zéro intent exécutable;
- lignes 59-76: CONFLICT, deux stratégies opposées sont nettées en une cible physique;
- lignes 78-93: DUPLICATE, replay d'une cible approuvée ne crée pas de deuxième intent;
- lignes 95-117: FAIL-CLOSED, Risk indisponible bloque TargetPosition et OrderIntent;
- lignes 146-157: assertion de lineage `allocation -> risk decision -> target -> intent`.

Autres tests renforcés:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/test/portfolio-target-position-v1.test.js`: ajout du cas sans Global Risk.
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/test/portfolio-order-intent-v1.test.js`: target sans lineage et target mutée après risk.
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/test/portfolio-execution-reconciliation-v1.test.js`: fixtures alignées avec le nouveau contrat TargetPosition.

## Preuve de lineage générée

Commande exécutée:

```bash
node --input-type=module -e '... buildCandidateAllocationPortfolioV1 -> evaluatePortfolioRiskBudgetV1 -> buildPortfolioTargetPositionPlanV1 -> buildPortfolioOrderIntentPlanV1 ...'
```

Sortie représentative:

```json
{
  "signal_id": "sig-lineage-demo",
  "candidate_allocation_id": "candalloc:90c24a1c9e9beb85f7a2ae84aac4c1343520d5f685abc0f2e1c0c56adb5d5f6e",
  "risk_decision_id": "portfoliorisk:c9721e2be7b8c65667e16d2e",
  "risk_status": "PASS",
  "risk_decision": "APPROVED",
  "target_position_id": "targetpos:58623bcdd8cc87ae9be80b8a4ae9c705be5060495124a5405965640dc551a4ce",
  "target_schema_version": "target_position_v1",
  "risk_approved_net_size": 2,
  "order_intent_id": "portfolio_order_intent_9949191c308e375a1ca5587a",
  "idempotency_key": "9949191c308e375a1ca5587af878f8ee2c0b5b55882a6c14b1b2f00d3804f689"
}
```

L'objet `OrderIntent.source` contient:

```json
{
  "kind": "TARGET_POSITION",
  "target_position_id": "targetpos:58623bcdd8cc87ae9be80b8a4ae9c705be5060495124a5405965640dc551a4ce",
  "risk_decision_ids": ["portfoliorisk:c9721e2be7b8c65667e16d2e"],
  "candidate_allocation_ids": ["candalloc:90c24a1c9e9beb85f7a2ae84aac4c1343520d5f685abc0f2e1c0c56adb5d5f6e"]
}
```

## Migrations et persistance

Prouvé existant:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/infra/postgres/init/003_trade_automation_schema.sql`: `trade_order_intents`, `trade_risk_checks`, approvals/fills historiques.
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/infra/postgres/init/044_strategy_signal_bus.sql`: `strategy_signal_outbox`.
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/infra/postgres/init/045_execution_provider_port.sql`: `broker_provider_commands`, `broker_provider_events`.

Gap restant:

- pas encore de migration dédiée et prouvée pour persister canoniquement `CandidateAllocation`, `PortfolioDecision`, `GlobalRiskDecision`, `TargetPosition` avec la lineage complète.

Statut persistance Lot 002: PARTIEL.

## Commandes exécutées

### Domaine complet

```bash
npm --prefix packages/desk-domain test
```

Résultat:

```text
tests 449
suites 60
pass 449
fail 0
duration_ms 31039.929767
```

### Broker / Execution ciblé

```bash
node --test packages/desk-domain/test/broker-execution.test.js packages/desk-domain/test/broker-position-management.test.js packages/desk-domain/test/execution-provider-port-v1.test.js packages/desk-domain/test/execution-provider-circuit-breaker-v1.test.js packages/desk-domain/test/execution-provider-multi-provider-contract-v1.test.js packages/desk-domain/test/execution-provider-shadow-cutover-v1.test.js packages/desk-domain/test/portfolio-execution-reconciliation-v1.test.js packages/desk-domain/test/ninjatrader-provider-adapter-v1.test.js packages/desk-domain/test/ninja-ati.test.js packages/desk-domain/test/ninja-addon-protocol.test.js mcp_gpt_desk/test/broker_execution_service.test.js mcp_gpt_desk/test/broker_execution_repository.test.js mcp_gpt_desk/test/front_execution_api.test.js mcp_gpt_desk/test/live_paper_execution.test.js mcp_gpt_desk/test/theoretical_execution_service.test.js mcp_gpt_desk/test/ninjatrader_execution_parity.test.js
```

Résultat:

```text
tests 148
suites 6
pass 148
fail 0
duration_ms 10882.239598
```

### Guards

```bash
npm run guard:architecture
```

Résultat: OK, `checked_files=379`.

```bash
npm run guard:runtime-safety
```

Résultat: OK, `direct_clock_usages=129`, budget `130`.

```bash
npm run guard:mcp-slices
```

Résultat: OK, `actual_tools=117`, `assigned_tools=117`, `slice_count=10`.

```bash
npm run guard:windows-deployment
```

Résultat: OK, `files=87`, `env_tokens=12`.

```bash
npm run guard:static-quality
```

Résultat: KO connu, non masqué:

```text
[static-quality-guard] FAILED
- mcp_gpt_desk/src/front-control-plane-api.js has 645 lines; allowed 600
- mcp_gpt_desk/src/store.js has 2488 lines; allowed 2485
- packages/desk-domain/src/strategy-dsl-compiler-v1.js has 624 lines; allowed 600
- packages/desk-replay-engine/src/canonical-simulation-engine-v1.js has 881 lines; allowed 600
- high complexity functions: 602; allowed 592
- duplicate blocks: 73; allowed 50
- possibly dead files: 16; allowed 14
Baseline: docs/engineering/static-quality-baseline.json
```

## Matrice de fermeture

| Requirement | Current status | Gap | Implementation | Tests | Runtime proof | Final status |
|---|---:|---|---|---|---|---:|
| OrderIntent ne peut pas être produit sans TargetPosition canonique | PARTIEL | Target arbitraire accepté | `targetAuthorityIssues()` impose schema/id/lineage | `portfolio-order-intent-v1.test.js`, full domain | Node lineage demo | FAIT |
| TargetPosition ne peut pas être produite sans Global Risk pour exposition | PARTIEL | fallback PASS implicite | `normalizeRiskBudgetEvaluation()` + `riskDecisionIssue()` | `portfolio-target-position-v1.test.js`, pipeline fail-closed | Full domain 449/0 | FAIT |
| ACCEPT produit un OrderIntent exécutable | PARTIEL | pas de preuve end-to-end dédiée | test pipeline ACCEPT | `global-risk-mandatory-pipeline-v1.test.js` | order intent demo | FAIT |
| REDUCE réduit la taille avant OrderIntent | PARTIEL | taille risk pas prouvée dans target | `risk_approved_net_size` + mutation guard | pipeline REDUCE | full domain | FAIT |
| REJECT ne produit aucun ordre physique | PARTIEL | reject risk pas prouvé à travers Target/Intent | Risk BLOCK -> target flat -> no delta | pipeline REJECT | full domain | FAIT |
| CONFLICT arbitré avant target physique | PARTIEL | conflit multi-strategy non prouvé dans le lot | candidate allocation netting | pipeline CONFLICT | full domain | FAIT |
| DUPLICATE ne double-send pas | PARTIEL | duplication target/order pas prouvée dans le lot | idempotency duplicate skip | pipeline DUPLICATE + broker tests | broker tests 148/0 | FAIT |
| Lineage complète signal -> allocation -> risk -> target -> intent | PARTIEL | risk id absent ou optionnel | `risk_decision_id`, `source.risk_decision_ids` | `assertLineage()` | node lineage demo | FAIT |
| Persistence PostgreSQL de GlobalRiskDecision/TargetPosition | PARTIEL | tables canoniques manquantes | non fait dans ce lot | non applicable | migrations inspectées | PARTIEL |
| Prop firm/trailing DD intégré au Global Risk obligatoire | PARTIEL | module séparé, pas encore fusionné dans `evaluatePortfolioRiskBudgetV1` | aucun changement dans ce lot | `prop-firm-account-risk-v1.test.js` dans full domain | domaine uniquement | PARTIEL |
| Kill switch global explicite dans Portfolio Risk | PARTIEL | blocage drawdown prouvé, kill switch opérateur global pas encore champ dédié | daily/weekly loss gates existants | pipeline REJECT | full domain | PARTIEL |
| Static quality guard vert | PARTIEL | dette existante taille/complexité/duplication | non corrigé dans ce lot | guard exécuté | KO documenté | PARTIEL |

## Blockers production restants

1. P0 — Persister les objets canoniques Portfolio/Risk/Target:
   - `portfolio_candidate_allocations`;
   - `portfolio_risk_decisions`;
   - `portfolio_target_positions`;
   - liens vers `trade_order_intents` / `broker_provider_commands`.
2. P0 — Brancher le chemin domain canonique dans le backend live/research, pas uniquement en tests domaine.
3. P0 — Ajouter un kill switch global explicite dans le `PortfolioRiskBudget` et prouver qu'il bloque `TargetPosition/OrderIntent`.
4. P1 — Intégrer `prop-firm-account-risk-v1` au pipeline obligatoire ou documenter son rôle exact comme gate additionnel.
5. P1 — Nettoyer ou relever explicitement le baseline `guard:static-quality`; le guard est encore rouge.
6. P1 — Les fichiers Lot 002 sont actuellement non trackés dans cette copie PREPROD; ils doivent être inclus explicitement dans le prochain commit/release.

## Conclusion Lot 002

Le verrou métier central est en place côté domaine: un `OrderIntent` physique ne peut plus être construit depuis une cible non passée par Portfolio Arbitration et Global Risk.

Ce n'est pas encore une fermeture production totale, parce que la persistance PostgreSQL et le branchement runtime complet du nouveau pipeline restent à certifier. Le prochain lot P0 doit donc être:

```text
LOT 003 — Persistance canonique Portfolio/Risk/Target + branchement backend runtime
```
