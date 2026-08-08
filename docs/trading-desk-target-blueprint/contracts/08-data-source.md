# Contract — Data Source

- **But** : modéliser une source de données de marché ou alternative avec son SLA de fraîcheur attendu.
- **Producteur** : configuration opérateur.
- **Consommateurs** : Ingestion Layer (`06`).
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `name` | string | oui | Nom de la source |
| `format` | string | oui | Format des données |
| `frequency` | string | oui | Fréquence attendue |
| `status` | enum | oui | `ACTIVE`\|`DEPRECATED` |

## Exemple JSON

```json
{
  "id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "name": "tradingview-m1-es",
  "format": "OHLCV M1",
  "frequency": "PT1M",
  "status": "ACTIVE"
}
```
