# Portfolio Candidate Allocation V1

TD2-700 ouvre la phase P8 : plusieurs stratégies ne doivent plus agir comme des îlots indépendants.

## Objectif

Le Strategy Runtime produit des signaux. Ces signaux ne doivent jamais devenir directement des ordres broker.

Le moteur `portfolio_candidate_allocation_plan_v1` ajoute une couche intermédiaire :

1. lire les signaux actifs ;
2. les agréger par instrument ;
3. résoudre les directions opposées par neutralisation nette ;
4. produire une `Candidate Allocation` auditée ;
5. calculer un portefeuille virtuel par `Strategy Instance`.

## Contrat domaine

Le domaine est dans `packages/desk-domain/src/portfolio-candidate-allocation-v1.js`.

Exports principaux :

- `buildCandidateAllocationPortfolioV1(input)` ;
- `buildVirtualStrategyPortfolioV1(input)`.

Le plan retourne :

- `schema_version = portfolio_candidate_allocation_plan_v1` ;
- `status = ALLOCATED | NO_ACTIVE_SIGNALS` ;
- `candidate_allocations[]` ;
- `rejected_signals[]` ;
- `virtual_portfolio` ;
- `plan_hash`.

## Politique V1

La politique par défaut est `NET_BY_DIRECTION`.

Exemple :

| Signal A | Signal B | Allocation résultante |
|---|---|---|
| `LONG 2 MNQ` | `SHORT 1 MNQ` | `LONG 1 MNQ` |
| `LONG 1 MNQ` | `SHORT 1 MNQ` | `FLAT 0 MNQ`, statut `NEUTRALIZED` |

La neutralisation reste auditée : même une allocation `FLAT` conserve les `signal_ids` et les contributions.

## Portefeuille virtuel

Le snapshot `virtual_strategy_portfolio_v1` agrège par `strategy_instance_id` :

- exposition proposée issue des signaux ;
- taille ouverte virtuelle ;
- exposition brute ;
- `unrealized_r` ;
- `realized_r` ;
- `total_r`.

Le calcul en R utilise :

```text
LONG  = (mark_price - entry_price) / initial_risk_points * size
SHORT = (entry_price - mark_price) / initial_risk_points * size
```

Si les champs de prix ou de risque sont absents, le moteur ne fabrique pas de PnL.

## Hors périmètre TD2-700

TD2-700 ne crée pas encore :

- budgets de risque globaux ;
- target position nette broker ;
- order intent ;
- cockpit front portfolio ;
- persistance SQL dédiée.

Ces sujets arrivent dans TD2-701 à TD2-705.
