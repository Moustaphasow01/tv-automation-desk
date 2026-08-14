# Market data coverage audit

Ticket source : `TD2-010`.

## Objectif

Le desk doit savoir si les données nécessaires au moteur V5 sont disponibles, fraîches et utilisables avant de préparer ou rejouer des analyses.

Ce contrôle ne remplace pas l'ingestion TradingView existante. Il ajoute une preuve opérable de couverture par :

- dataset ;
- symbole/feed ;
- granularité ;
- rôle métier ;
- criticité ;
- fraîcheur.

## Commandes

Résumé opérateur :

```bash
npm run coverage:market-data
```

Rapport détaillé côté MCP :

```bash
npm --prefix mcp_gpt_desk run data:coverage
```

Avec PostgreSQL réel :

```bash
DESK_POSTGRES_URL="postgres://..." npm run coverage:market-data
```

En mode bloquant pour CI/release :

```bash
DESK_POSTGRES_URL="postgres://..." DESK_COVERAGE_FAIL_ON_BLOCKING=1 npm --prefix mcp_gpt_desk run data:coverage -- --summary
```

## Profil couvert

Le contrôle lit le profil canonique :

```text
mcp_gpt_desk/src/v5-replay-data-profile.js
```

Il couvre 20 datasets :

- requis / bloquants : `MNQ_M1`, `MES_M1`, `MNQ_M5`, `MES_M5` ;
- optionnels / dégradants : confirmations `NQ/ES`, HTF, taux, DXY, pétrole, or, VIX, indices Europe/Asie, mégacaps.

`MNQ_M5` et `MES_M5` sont évalués comme datasets dérivés de `MNQ_M1` et `MES_M1`, conformément au mode canonique `derived_from_m1`.

## Seuils de fraîcheur par rôle

| Rôle | Seuil |
|---|---:|
| `execution` | 3 min |
| `trigger` | 8 min |
| `confirmation` | 45 min |
| `context` | 1440 min |

## États

- `ready` : source provider fraîche.
- `ready_derived` : dataset dérivé disponible car sa source canonique est fraîche.
- `stale` : source présente mais trop ancienne pour son rôle.
- `missing` : feed absent, désactivé ou sans dernier timestamp.

Les sources requises manquantes ou stale bloquent `execution_allowed`. Les sources optionnelles manquantes dégradent le contexte mais ne bloquent pas par elles-mêmes.

## Composants

- Service pur : `mcp_gpt_desk/src/market-data-coverage-service.js`.
- CLI : `mcp_gpt_desk/scripts/audit_market_data_coverage.mjs`.
- Tests : `mcp_gpt_desk/test/market_data_coverage_service.test.js`.

## Complément TD2-206

La couverture répond à la question : “peut-on exécuter/rejouer maintenant sans feed requis manquant ou stale ?”.

Le profilage TD2-206 répond à la question complémentaire : “quelle profondeur historique et quelles capacités fines sont réellement disponibles par feed ?”.

Voir `docs/engineering/market-data-capability-profiling.md` pour l’audit tick/bid/ask/open interest, les recommandations de stockage et l’endpoint `/api/v1/data-foundation/market-data-profiles`.

## Résultat local sans DB exposée

Si aucune URL PostgreSQL n'est présente dans l'environnement, le rapport retourne :

```json
{
  "database_status": "not_configured",
  "execution_allowed": false,
  "status": "blocked"
}
```

C'est volontaire : le desk ne fabrique jamais un état de couverture quand il ne peut pas lire la base.
