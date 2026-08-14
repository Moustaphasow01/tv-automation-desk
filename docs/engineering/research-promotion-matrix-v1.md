# Research Promotion Matrix V1

Statut : implémenté pour `TD2-503`.

## Rôle

`Research Promotion Matrix V1` décide si une candidate validée peut devenir `PROMOTION_READY`.

La matrice ne publie pas directement une stratégie. Elle produit un verdict auditable :

- `BLOCKED` si la validation contradictoire, la priorité, la référence de version ou le plan de rollback manquent ;
- `NEEDS_OPERATOR_APPROVAL` si les gates techniques passent mais que l'humain n'a pas explicitement approuvé ;
- `APPROVED_FOR_PROMOTION` si tous les gates passent ;
- `REJECT_PROMOTION` si l'opérateur refuse ou si la validation contradictoire rejette ;
- `RETIRE_CANDIDATE` pour un retrait explicite sans publication.

## Gates

- `Research Contradictory Validation Workflow V1` doit être `READY_FOR_PROMOTION_REVIEW`.
- `Research Coverage & Priority V1` ne doit pas être `DEFER` et doit respecter le seuil de priorité.
- `strategy_version_id` est obligatoire.
- `operator_approval` doit être `APPROVED`, avec `approval_id` et `operator_ref`.
- Un plan de rollback/retrait est produit et hashé.

## Sortie lifecycle

Quand la candidate est `UNDER_REVIEW` et que la matrice est `APPROVED_FOR_PROMOTION`, le workflow appelle le lifecycle candidat avec `MARK_PROMOTION_READY`.

La publication réelle `StrategyVersion VALIDATED/PUBLISHED` reste volontairement séparée.
