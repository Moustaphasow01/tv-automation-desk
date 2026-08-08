# Contract — Target Position

- **But** : position nette cible par instrument et compte, remplace l'agrégation actuelle buguée (ADR-0003).
- **Producteur** : Broker Netting Engine (`11`).
- **Consommateurs** : Execution Gateway (`13`), en amont d'`evaluateBrokerPolicy`.
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `instrument` | string | oui | Instrument concerné |
| `account_id` | string | oui | Compte broker réel concerné |
| `net_target_size` | number | oui | Position nette cible, tous comptes/stratégies confondus |
| `derived_from_risk_decision_ids` | array[uuid] | oui | Traçabilité vers les Risk Decision d'origine |

## Exemple JSON

```json
{
  "id": "e1f2a3b4-c5d6-4e7f-8091-426374859607",
  "instrument": "ES",
  "account_id": "live-account-001",
  "net_target_size": 1,
  "derived_from_risk_decision_ids": ["d0e1f2a3-b4c5-4d6e-7f80-914263748596"]
}
```
