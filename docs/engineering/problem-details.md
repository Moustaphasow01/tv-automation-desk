# Stable errors and Problem Details

> Statut : normatif pour API, MCP, front et workers.

Le ticket `TD2-ARCH-007` introduit une taxonomie d'erreurs stable afin que le
front n'affiche pas des IDs techniques bruts et que les logs conservent assez de
détails pour diagnostiquer.

## Source de vérité

Le registre est exposé par `@tv-automation/desk-domain` :

- `DESK_ERROR_REGISTRY` ;
- `problemDetailsFromError` ;
- `normalizeDeskErrorCode` ;
- `operatorMessageForProblem`.

## Format

Les réponses suivent l'esprit RFC 7807 avec des champs desk supplémentaires :

```json
{
  "schema_version": "desk_problem_details_v1",
  "type": "https://trading-desk.local/problems/desk-stale-data",
  "title": "Stale data",
  "status": 409,
  "detail": "Broker mark stale",
  "instance": "/api/v1/execution",
  "code": "DESK_STALE_DATA",
  "category": "data",
  "severity": "warning",
  "retryable": false,
  "operator_message": "Les données sont trop anciennes pour valider l'action.",
  "trace_id": "trace_..."
}
```

`technical_details` n'est présent que si le caller le demande explicitement.

## Règles

- Un code public est stable et commence par `DESK_`.
- Une erreur a toujours `category`, `severity`, `status`, `retryable` et
  `operator_message`.
- Le front affiche `operator_message`; les diagnostics profonds restent dans les
  logs ou dans `technical_details`.
- Les erreurs retryables doivent être distinctes des erreurs déterministes.
