# Frontend VNext — avancement produit

## Golden masters

| Écran | Statut | Preuves | Jira |
| --- | --- | --- | --- |
| Command Center | gelé / non-régression verte | `reports/ui-ux/command-center/` | TD2-418 |
| Live Trading | implémenté, prêt pour revue produit | `reports/ui-ux/live-trading/` | [TD2-423](https://grouptopicone.atlassian.net/browse/TD2-423) |

## Live Trading — 2026-08-16

- Grille desktop 4 colonnes, sidebar 96 px, header 52 px et policy strip 32 px.
- Treize panneaux visibles au viewport normatif 1672 × 941.
- Responsive certifié aux cinq viewports demandés.
- BFF réel `/front-api/v1/views/live-trading`, aucun mock runtime et aucun accès provider depuis le navigateur.
- Human Gate fail-closed, post-Risk immutable, ACK distinct du fill.
- 166 tests Front, 26 tests BFF, build, Axe et deux golden matrices verts ; Playwright réel `2/2` scénarios exécutables, écriture opérateur non contournée et laissée en attente du PIN.
- Les écarts OHLCV, reconciliation, R-equity et SSE certifiable sont suivis par `LT-DATA-001`, `LT-EXE-001`, `LT-PERF-001`, `LT-RT-001`.

## Point d'arrêt

Conformément à la tranche écran par écran, aucun autre écran n'est engagé avant validation produit de Live Trading.
