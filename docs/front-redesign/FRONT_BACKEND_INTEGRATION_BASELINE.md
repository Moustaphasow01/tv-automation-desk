# Front ↔ Backend Integration Baseline

Baseline figée avant le vertical slice `TD2-416` — expérience d'exécution semi-manuelle.

| Élément | Valeur |
| --- | --- |
| Timestamp | `2026-08-14T03:16:36+02:00` |
| Worktree | `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD` |
| Branche | `codex/preprod-v4-local-parity-cleanup` |
| SHA | `e18b48a310085679c94639420ca0b0b8c78ee70f` |
| État Git | `DIRTY` avant ce slice : 610 entrées (`137 M`, `473 ??`) |
| Ticket Jira | `TD2-416` |

## Preuves exécutées avant modification applicative

```text
npm --prefix apps/desk-control-plane run typecheck
PASS

npm --prefix apps/desk-control-plane run test -- --reporter=dot
34 fichiers · 152/152 tests PASS

node --test mcp_gpt_desk/test/front_control_plane_api.test.js mcp_gpt_desk/test/postgres_schema_mode.test.js
20/20 tests PASS
```

Le worktree contenait déjà un volume important de changements non commités et de fichiers non suivis. Ils appartiennent aux chantiers précédents et concurrents : ce slice ne doit ni les nettoyer, ni les réécrire, ni les inclure implicitement dans une preuve de conformité.

## Périmètre de sûreté du slice

- propriétaire : `front-control-plane` ;
- consommateur : `/front-api/v1` uniquement ;
- lecture seule des bounded contexts `portfolio-risk`, `execution`, `reporting` et `audit` ;
- aucune modification de la décision Risk, du sizing, de la machine d'état provider ou de la réconciliation métier ;
- aucune activation implicite de `AUTO` ou `LIVE`.
