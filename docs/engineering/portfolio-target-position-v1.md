# Portfolio Target Position V1

TD2-702 transforme les allocations approuvées ou réduites en positions cibles nettes.

## Objectif

Le desk ne doit pas envoyer plusieurs intentions incohérentes pour le même compte/instrument.

Le contrat `portfolio_target_position_plan_v1` produit une seule `Target Position` par clé :

```text
account_id + instrument
```

Les contributions par `Strategy Instance` restent conservées dans `strategy_breakdown`.

## Entrées

- `candidate_allocations[]` issues de TD2-700 ;
- `risk_budget_evaluation` issue de TD2-701 ;
- `current_positions[]` optionnelles pour calculer le delta à exécuter.

## Sortie

Chaque `target_position_v1` contient :

- `account_id` ;
- `instrument` ;
- `net_target_size` ;
- `net_direction` ;
- `current_net_size` ;
- `delta_size` ;
- `derived_from_risk_decision_ids` ;
- `candidate_allocation_ids` ;
- `strategy_breakdown`.

## Règles

- `PASS` garde la taille demandée.
- `REDUCE` utilise `approved_size`.
- `BLOCK` produit une cible `FLAT` de taille `0`.
- Plusieurs allocations sur le même compte/instrument sont nettées ensemble.
- Le même instrument sur deux comptes produit deux Target Positions distinctes.

## Hors périmètre

TD2-702 ne génère pas encore d’`OrderIntent`.

La conversion Target Position → ordre déterministe est TD2-703.
