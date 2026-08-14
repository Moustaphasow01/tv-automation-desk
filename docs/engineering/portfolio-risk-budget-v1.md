# Portfolio Risk Budget V1

TD2-701 ajoute le socle de budgets globaux avant toute exécution multi-stratégie.

## Objectif

Une Candidate Allocation peut être correcte isolément, mais dangereuse au niveau portefeuille. Le budget global sert à répondre à une question simple :

> “Si j’ajoute cette allocation au portefeuille virtuel courant, est-ce que je reste dans les limites opérateur ?”

## Contrat domaine

Implémentation : `packages/desk-domain/src/portfolio-risk-budget-v1.js`.

Exports :

- `normalizePortfolioRiskBudgetV1(input)` ;
- `evaluatePortfolioRiskBudgetV1(input)`.

Schémas :

- `portfolio_risk_budget_v1` ;
- `portfolio_risk_budget_evaluation_v1`.

## Budgets supportés

| Budget | Exemple |
|---|---|
| Portefeuille global | `max_portfolio_abs_size` |
| Compte | `max_account_abs_size["paper-sim101"]` |
| Instrument | `max_instrument_abs_size["MNQ"]` |
| Strategy Instance | `max_strategy_abs_size["inst-a"]` |
| Groupe corrélé | `max_correlation_group_abs_size["equity_index"]` |
| Perte journalière | `max_daily_loss_r` |
| Perte hebdomadaire | `max_weekly_loss_r` |

Les groupes de corrélation par défaut couvrent :

- `equity_index` : `MES`, `ES`, `MNQ`, `NQ`, `MYM`, `YM`, `M2K`, `RTY` ;
- `energy_crude` : `MCL`, `CL` ;
- `metals` : `MGC`, `GC`, `SIL`, `SI`.

## Statuts

| Statut | Sens |
|---|---|
| `PASS` | Allocation possible |
| `REDUCE` | Allocation possible seulement avec taille réduite |
| `BLOCK` | Allocation annulée par une limite déjà saturée ou un kill budget |
| `CONFIG_MISSING` | Aucun budget numérique configuré : fail-closed |

## Invariant de sécurité

Sans budget numérique, le moteur ne passe jamais en `PASS`.

Cela respecte `OP-8` : les valeurs de limites dépendent de l’opérateur et ne doivent pas être inventées par le code.

## Hors périmètre

TD2-701 ne produit pas encore :

- `Target Position` nette ;
- `OrderIntent` ;
- écriture SQL dédiée ;
- cockpit front budget.

Ces étapes arrivent dans TD2-702 à TD2-705.
