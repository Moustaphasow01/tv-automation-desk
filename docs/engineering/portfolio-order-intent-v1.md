# Portfolio Order Intent V1

TD2-703 transforme les `Target Position` nettes en intentions d’ordre provider-neutral.

## Objectif

Le desk ne doit jamais créer un ordre broker directement depuis un LLM, un `Signal` ou une recommandation.

Le contrat `portfolio_order_intent_plan_v1` impose la chaîne :

```text
Candidate Allocation → Risk Budget → Target Position → OrderIntent
```

## Entrées

- `target_positions[]` ou `target_position_plan.target_positions[]` issus de TD2-702 ;
- `existing_order_intents[]` pour l’idempotence et l’anti-double envoi ;
- `provider_contracts` optionnels pour associer un instrument à un symbole provider ;
- `default_protection_plan` ou `target.protection_plan` pour autoriser la soumission.

## Sortie

Chaque `portfolio_order_intent_v1` contient :

- `target_position_id` ;
- `account_id` / `broker_account_id` ;
- `instrument` ;
- `provider_contract_ref` ;
- `action` (`BUY` ou `SELL`) ;
- `quantity` ;
- `lifecycle_action` (`OPEN`, `INCREASE`, `REDUCE`, `CLOSE`, `REVERSE`, `CANCEL_REPLACE`) ;
- `current_net_size`, `target_net_size`, `delta_size` ;
- `closing_size`, `opening_size` ;
- `protection` ;
- `idempotency_key`.

## Règles déterministes

- `delta_size > 0` produit `BUY`.
- `delta_size < 0` produit `SELL`.
- `delta_size = 0` ne produit aucun nouvel intent.
- Une cible déjà représentée par un intent actif identique est ignorée avec `DUPLICATE_INTENT_EXISTS`.
- Un intent actif différent sur le même `account_id + instrument` produit un `cancel_replace_request` si la politique l’autorise.
- `broker_submission_allowed` reste faux tant que les protections requises sont absentes.
- La quantité est arrondie au supérieur, avec audit `quantity_rounding`.

## Garanties

- Provider-neutral : aucune dépendance directe NinjaTrader dans ce contrat.
- Idempotent : le hash inclut target, compte, instrument, delta, quantité, contrat provider et politique d’exécution.
- Auditable : `source.risk_decision_ids`, `source.candidate_allocation_ids` et `audit.direct_llm_order=false`.

## Hors périmètre

TD2-703 ne soumet pas l’ordre au broker.

La concurrence broker, les fills, redémarrages et divergences sont couverts par `portfolio_execution_reconciliation_v1` livré en TD2-704.
