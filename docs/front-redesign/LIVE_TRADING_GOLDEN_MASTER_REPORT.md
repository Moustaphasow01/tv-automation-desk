# Live Trading VNext — Golden Master Report

**Statut technique :** prêt pour revue produit, intégration réelle fail-closed.
**Ticket :** [TD2-423](https://grouptopicone.atlassian.net/browse/TD2-423)
**Branche :** `codex/preprod-v4-local-parity-cleanup`
**SHA de départ :** `d492b548a3eed53825bcc27de42c518214ecb246`

## Périmètre livré

Le seul écran construit dans cette tranche est Live Trading. Le Command Center n'est pas redessiné et reste protégé par sa golden QA.

Composants principaux :

- `LiveTradingPage` et mapper `LiveTradingModel` ;
- header, recherche, environnement, horloge et identity ;
- policy strip backend-driven ;
- Market Context, Strategy Instances et Macro/Session ;
- chart principal et états de série ;
- Strategy Signal, AI Context/Portfolio/Risk, TargetPosition/OrderIntent ;
- Human Execution Gate fail-closed ;
- Provider Runtime, Reconciliation, Timeline, Performance et Jarvis ;
- layout workstation 4 colonnes et reflow 1440/1280/mobile.

## Fichiers applicatifs du slice

- `apps/desk-control-plane/src/pages/LiveTradingPage.tsx`
- `apps/desk-control-plane/src/features/live-trading/{model,mapper,LiveTradingHeader,LiveTradingPanels,LiveHumanGate}.tsx|ts`
- `apps/desk-control-plane/src/features/live-trading/live-trading.css`
- `apps/desk-control-plane/src/domains/front-api/viewModels.ts`
- `apps/desk-control-plane/src/shell/DeskShell.tsx`
- `apps/desk-control-plane/src/mocks/canonicalDataset.ts` — fixture de test uniquement
- `apps/desk-control-plane/src/test/liveTradingGoldenMaster.test.ts`
- `apps/desk-control-plane/scripts/audit-live-trading-visual.mjs`
- `apps/desk-control-plane/package.json`

Le worktree contenait déjà les changements du Command Center. Aucun reset, stage, commit, déploiement ou action provider n'a été exécuté.

## Données et endpoints

- Snapshot unique : `GET /front-api/v1/views/live-trading`.
- Le Front valide le DTO, le mappe et affiche disponibilité, source, asOf et révision lorsqu'ils existent.
- Mode observé : environnement `PAPER`, exécution `SEMI_MANUAL`, AUTO et exécution physique OFF, Human Gate requis, ACK ≠ fill.
- La projection locale est actuellement `PARTIAL/STALE` à cause de timeouts de sources ; l'UI le montre et ferme les actions.
- Aucun appel navigateur vers NinjaTrader, PickMyTrade, Tradovate, Rithmic, PostgreSQL, MCP ou bridge provider.

## États indisponibles et blockers backend

- OHLCV/VWAP : contrat déclaré, route/points paginés absents (`LT-DATA-001`).
- Reconciliation expected vs broker : absente du snapshot Live (`LT-EXE-001`).
- Performance R live officielle : série absente (`LT-PERF-001`).
- Sequencing/gap/resume realtime : contrat à certifier (`LT-RT-001`).
- `CN-EXE-009` n'est plus reproduit comme SQLSTATE ; la source execution reste à revalider hors timeout.
- `CN-DATA-001` ne se reproduit plus : l'état observé est correctement `STALE`.

Le Front affiche `UNAVAILABLE` pour ces zones. Il ne fabrique ni chandeliers, ni niveau zéro, ni PnL/R, ni position broker, ni réconciliation PASS.

## Sûreté opérateur

- Confirm/Reject résultent uniquement de l'intersection capability ressource × Human Gate et sont retirés si le snapshot est stale.
- Les termes post-Risk sont strictement read-only.
- Confirmation humaine, commande ACCEPTED, ACK, partial fill et fill restent distincts.
- Jarvis est marqué `ADVISORY ONLY` et ne peut déclencher aucune action.
- Le test BFF confirme que Human Gate passe par le broker service sans exécution provider directe.

## Vérifications

| Contrôle | Résultat |
| --- | --- |
| Front Vitest | `37 files / 166 tests` PASS |
| BFF focused | `26/26` PASS |
| Build production | PASS |
| Playwright real-stack | `2/2` scénarios exécutables PASS ; scénario mutation opérateur SKIPPED faute de `DESK_OPERATOR_ADMIN_PIN` dans l'environnement |
| Visual Live | `5/5` PASS |
| Command Center golden non-régression | `5/5` PASS |
| Axe | `2 audits`, `0 serious/critical` |
| BFF Live, 20 échantillons | P50 `3,90 ms`, P75 `4,44 ms`, P95 `9,88 ms`, max `54,13 ms` |
| Post-Risk editable controls | `0` |
| Browser console errors | `0` |
| Nouveau `!important` | `0` ; total historique inchangé `61` |

## Rulebook

La sélection P0/P1 a été exécutée avant le slice. Le scanner informatif final analyse 120 fichiers et publie 298 signaux : 92 P0 heuristiques et 206 warnings P1. Les 51 détections `UXR-0161` du Live sont couvertes par la dérogation bornée `OV-LT-001`, imposée par la maquette compacte et compensée par reflow, zoom préservé, Axe et drill-down ; les 38 du Command Center sont couvertes par `OV-CC-001`. La détection `UXR-0283` introduite sur la recherche a été corrigée avec un focus visible. Trois P0 historiques restent dans `design-system/styles.css` (deux `UXR-0161`, un `UXR-0283`) et ne sont pas déclarés conformes par cette tranche. Les warnings P1 de palette sont documentés ; les tokens Live sont localisés au scope de la page et ne modifient pas le golden Command Center.

Le détecteur de finition signale uniquement l'emploi d'Inter comme police très répandue. Ce warning n'est pas corrigé : Inter est expressément la police normative de la spécification Live Trading.

## Décision

Le shell, l'UX fail-closed, le responsive et la présentation des projections réelles sont prêts pour validation. Le ticket ne doit pas être considéré comme une certification de trading live : les données chart/reconciliation/performance et le realtime certifiable dépendent encore des contrats backend listés ci-dessus.
