# Contract — Data Source

- **But** : modéliser une source de données de marché ou alternative avec son SLA de fraîcheur attendu.
- **Producteur** : configuration opérateur.
- **Consommateurs** : Ingestion Layer (`06`).
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `source_key` | string | oui | Clé opérable unique, stable entre environnements si la source est la même |
| `name` | string | oui | Nom de la source |
| `kind` | enum | oui | `MARKET_OHLCV`\|`MARKET_TICK`\|`MACRO_CALENDAR`\|`NEWS`\|`BROKER_EXECUTION`\|`ALTERNATIVE`\|`MANUAL` |
| `provider` | string | oui | Provider ou système amont (`tradingview`, `gdelt`, `ninjatrader`, etc.) |
| `format` | string | oui | Format des données |
| `frequency` | string | oui | Fréquence attendue |
| `freshness_sla_seconds` | integer | oui | Délai maximal attendu avant que la source soit considérée stale |
| `status` | enum | oui | `ACTIVE`\|`DEPRECATED` |

## Exemple JSON

```json
{
  "id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "source_key": "tradingview.mnq.m1",
  "name": "tradingview-m1-es",
  "kind": "MARKET_OHLCV",
  "provider": "tradingview",
  "format": "OHLCV M1",
  "frequency": "PT1M",
  "freshness_sla_seconds": 180,
  "status": "ACTIVE"
}
```
