# Live Trading VNext — baseline d'intégration

- Timestamp : `2026-08-16T00:05:26+02:00`
- Worktree : `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`
- Branche : `codex/preprod-v4-local-parity-cleanup`
- SHA : `d492b548a3eed53825bcc27de42c518214ecb246`
- Ticket Jira : [TD2-423](https://grouptopicone.atlassian.net/browse/TD2-423)
- Endpoint d'autorité : `GET /front-api/v1/views/live-trading`
- Mode courant observé : `PAPER` / `SEMI_MANUAL`, exécution automatique et physique désactivées, Human Gate requis.

## État Git avant le slice

Le worktree contient le slice Command Center approuvé en cours de finalisation. Il est conservé tel quel et sert de non-régression. Aucun reset, checkout destructif, stage ou commit n'est effectué par ce chantier.

```text
 M apps/desk-control-plane/index.html
 M apps/desk-control-plane/package.json
 M apps/desk-control-plane/scripts/audit-a11y.mjs
 M apps/desk-control-plane/src/design-system/styles.css
 M apps/desk-control-plane/src/domains/front-api/viewModels.ts
 M apps/desk-control-plane/src/mocks/canonicalDataset.ts
 M apps/desk-control-plane/src/pages/CommandCenterPage.tsx
 M apps/desk-control-plane/src/shell/DeskShell.tsx
 M apps/desk-control-plane/vite.config.ts
 M docs/front-redesign/FRONTEND_V2_BACKEND_CONTRACT_NEEDS.md
 M docs/front-redesign/FRONTEND_V2_IMPLEMENTATION_PROGRESS.md
 M docs/ui-ux/PROJECT_OVERRIDES.md
?? apps/desk-control-plane/scripts/audit-command-center-visual.mjs
?? apps/desk-control-plane/src/features/command-center/
?? apps/desk-control-plane/src/test/commandCenterGoldenMaster.test.ts
?? design-qa.md
?? docs/front-redesign/FRONTEND_VNEXT_REDESIGN_BASELINE.md
?? reports/visual-references/
```

## Baseline vérifiée avant modification applicative

| Contrôle | Résultat |
| --- | --- |
| BFF/PostgreSQL `node --test test/front_control_plane_api.test.js` | `26/26` |
| Front Live contract + Command Center golden master | `6/6` |
| Command Center visual QA connue | `5/5` |
| Axe Command Center connu | `0 serious / 0 critical` |
| `!important` existants dans `apps/desk-control-plane/src` | `61` — dette historique, aucun ajout autorisé |

## Runtime local observé

- Front Vite source : `http://127.0.0.1:8190`
- BFF source : `http://127.0.0.1:8790`
- PostgreSQL Docker : port `5432`, healthy au baseline.
- L'endpoint Live répond en `PARTIAL` et `stale=true` lorsque les sources canoniques expirent. Le Front doit conserver cet état de vérité et ne jamais le remplacer par une donnée décorative.

## Cible visuelle

- Maquette approuvée reçue : `1536 × 864 px`.
- Viewport contractuel de certification : `1672 × 941 px`.
- Copies de référence conservées dans `reports/visual-references/` avec leurs dimensions d'origine ; aucune donnée de la maquette n'est utilisée comme fixture runtime.
