# Contract — Order Intent

- **But** : intention d’ordre dérivée d’une `Target Position`, avant soumission à l’Execution Gateway.
- **Producteur** : Broker Netting Engine / Order Intent Builder.
- **Consommateurs** : Execution Gateway, provider adapters, audit, front exécution.
- **Invariant** : aucun LLM, `Signal` ou `AI Context Advisory` ne peut créer directement cet objet.

## Champs clés

| Champ | Type | Requis | Notes |
|---|---:|---:|---|
| `schema_version` | string | oui | `portfolio_order_intent_v1` |
| `order_intent_id` | string | oui | Dérivé de l’idempotency key |
| `target_position_id` | string | oui | Source immédiate obligatoire |
| `account_id` | string | oui | Compte logique desk |
| `broker_account_id` | string | oui | Compte provider ciblé |
| `instrument` | string | oui | Instrument canonique |
| `provider_id` | string | oui | Provider neutral |
| `provider_contract_ref` | object | oui | Référence contrat provider |
| `action` | enum | oui | `BUY` ou `SELL` |
| `quantity` | integer | oui | Contrats, arrondi supérieur |
| `order_type` | enum | oui | Par défaut `MARKET` |
| `time_in_force` | enum | oui | Par défaut `DAY` |
| `lifecycle_action` | enum | oui | `OPEN`, `INCREASE`, `REDUCE`, `CLOSE`, `REVERSE`, `CANCEL_REPLACE` |
| `current_net_size` | number | oui | Position courante nette |
| `target_net_size` | number | oui | Position cible nette |
| `delta_size` | number | oui | Cible - courant |
| `closing_size` | number | oui | Taille fermée par l’intent |
| `opening_size` | number | oui | Taille ouverte par l’intent |
| `protection` | object | oui | Stop/target/slippage/OCO |
| `broker_submission_allowed` | boolean | oui | Faux si protections absentes |
| `idempotency_key` | string | oui | Anti-double envoi |
| `source` | object | oui | Risk decisions + allocations sources |
| `audit` | object | oui | `direct_llm_order=false` |

## Addendum TD2-704

Avant toute soumission provider, les intents actifs passent par `portfolio_execution_reconciliation_v1`.

Ce contrôle détecte doublons d’idempotence, fills partiels, redémarrages et divergences broker/desk.

## Exemple

```json
{
  "schema_version": "portfolio_order_intent_v1",
  "order_intent_id": "portfolio_order_intent_abc123",
  "target_position_id": "targetpos:abc",
  "account_id": "paper-sim101",
  "broker_account_id": "paper-sim101",
  "instrument": "MNQ",
  "provider_id": "provider-neutral",
  "provider_contract_ref": {
    "provider_id": "provider-neutral",
    "provider_contract_id": "cme:mnq",
    "provider_symbol": "MNQ SEP26",
    "instrument": "MNQ"
  },
  "action": "BUY",
  "quantity": 2,
  "order_type": "MARKET",
  "time_in_force": "DAY",
  "lifecycle_action": "OPEN",
  "current_net_size": 0,
  "target_net_size": 2,
  "delta_size": 2,
  "closing_size": 0,
  "opening_size": 2,
  "status": "READY",
  "broker_submission_allowed": false,
  "protection": {
    "required": true,
    "ready": true,
    "missing": [],
    "stop_price": 27900,
    "target_price": 28100,
    "max_slippage_ticks": 4,
    "oco_required": true
  },
  "idempotency_key": "sha256-like-canonical-key",
  "source": {
    "kind": "TARGET_POSITION",
    "target_position_id": "targetpos:abc",
    "risk_decision_ids": ["risk-a"],
    "candidate_allocation_ids": ["alloc-a"]
  },
  "audit": {
    "direct_llm_order": false,
    "derived_from_netting_engine": true,
    "quantity_rounding": {
      "mode": "ceil",
      "raw_quantity": 2,
      "quantity": 2,
      "rounding_excess": 0
    }
  }
}
```
