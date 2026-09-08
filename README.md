# TV Automation — Trading Desk VNext

Le code canonique est publié sur
[`Moustaphasow01/tv-automation-desk`](https://github.com/Moustaphasow01/tv-automation-desk).
Le Desk est déployé sur un VPS Windows OVH en mode SHADOW / semi-manuel ;
l'exécution physique broker reste désactivée par défaut. Pour reprendre le
développement depuis un poste neuf, commencer par le
[guide de reprise du poste](docs/WORKSTATION_RECOVERY_HANDOFF_2026-09-08.md).

Cette copie est un projet indépendant du dépôt Firebase/Google Cloud d'origine. Son runtime cible est entièrement local :

- frontend React servi par Nginx ;
- API et serveur MCP Node.js ;
- PostgreSQL 16 dans Docker ;
- webhook TradingView local ;
- volumes Docker pour les données et objets locaux.

Aucune commande de déploiement Firebase, Firestore, Cloud Run ou GCloud n'est incluse dans le démarrage local.
Le frontend utilise toujours l'API locale : aucun mode mock n'est compilé dans le bundle de production.

Le dépôt contient le kit utilisé pour installer et mettre à jour le VPS Windows :
PostgreSQL natif, Caddy, services Node.js, sauvegardes, rollback et NinjaTrader
Sim101. Voir
[la readiness pré-VPS](docs/VPS_WINDOWS_READINESS_2026-07-23.md) et
[le runbook de cutover](docs/VPS_WINDOWS_CUTOVER_RUNBOOK_2026-07-23.md).

## Démarrage

1. Copier `.env.preprod.example` vers `.env.preprod` et changer les secrets locaux.
2. Démarrer Docker Desktop.
3. Exécuter :

```bash
docker compose --env-file .env.preprod up --build -d
docker compose --env-file .env.preprod run --rm api npm run seed:contracts
```

Le Desk est ensuite disponible sur `http://localhost:8080`, l'API sur `http://localhost:8787/status` et le MCP sur `http://localhost:8787/mcp`.

Espaces ajoutés :

- `http://localhost:8080/#/operations` : cockpit de tous les workflows automatisés ;
- `http://localhost:8080/#/replay` : Replay Lab, journées, sessions, variantes, timeline et GPT ;
- `http://localhost:8080/#/performance/analysis` : performance et ventilations ;
- `http://localhost:8080/#/history` : historique navigable ;
- `http://localhost:8080/#/strategies` : configurations et versions.

L'architecture et les endpoints M0 à M17 sont détaillés dans [docs/OPERATIONS_REPLAY_LAB_ARCHITECTURE.md](docs/OPERATIONS_REPLAY_LAB_ARCHITECTURE.md). La carte officielle des fichiers actifs/support est dans [docs/PREPROD_PROJECT_MANIFEST.md](docs/PREPROD_PROJECT_MANIFEST.md).

Le chantier de redesign Front V2 dispose d'un kit de passation séparant la direction de design Claude de l'implémentation Codex :

- [point d'entrée du kit](docs/front-redesign/README.md) ;
- [manifeste de mission](docs/front-redesign/MANIFEST.md) ;
- [prompt prêt à transmettre à Claude](docs/front-redesign/PROMPT.md) ;
- [contexte complet avec inventaire des écrans, code et CSS](docs/front-redesign/HANDOFF.md).

Le handoff peut être actualisé après une évolution du frontend avec `npm run handoff:claude`.

Webhook TradingView local :

```text
POST http://localhost:8787/api/v1/webhooks/tradingview?token=<TRADINGVIEW_WEBHOOK_SECRET>
```

En mode public, le secret en query string est volontairement refusé. TradingView
doit alors envoyer le secret dans le payload JSON, afin qu'il n'apparaisse pas
dans les journaux d'accès.

Les scripts Pine maintenus sont dans `tradingview/` : exporteur webhook unitaire, exporteur Volume Profile et exporteurs batch M1/M5/M15/H1/H4. Les fichiers batch sont conservés car leurs alertes peuvent être configurées directement dans TradingView, hors du graphe d'import de l'application.

Readiness LIVE V4 locale, sans claim GPT ni ordre broker :

```bash
npm --prefix mcp_gpt_desk run live:shadow-readiness -- \
  --trading-date 2026-07-20 --session asia_open \
  --checkpoint-paris 2026-07-20T12:00:00+02:00
```

Tick de continuité setup/position paper sur bougies closes :

```bash
npm --prefix mcp_gpt_desk run live:paper-tick -- \
  --trading-date 2026-07-20 --session asia_open \
  --timestamp-paris 2026-07-20T12:05:00+02:00
```

Voir `docs/AUTOPILOT_V4_LIVE_PREPROD_READINESS_2026-07-20.md`.

## Arrêt

```bash
docker compose --env-file .env.preprod down
```

Ajouter `--volumes` supprime aussi les données PostgreSQL locales ; ne l'utiliser que pour repartir volontairement de zéro.

## Validation

```bash
npm run typecheck
npm run test:react
cd mcp_gpt_desk && npm test
```

Gates du packaging Windows :

```bash
npm run guard:strategy-contracts
npm run guard:windows-deployment
npm run benchmark:local
```

Pour l'acceptation complète contre les conteneurs réels Nginx, API et PostgreSQL :

```bash
npm run test:stack
```

Ce test utilise uniquement des fixtures PostgreSQL temporaires et les supprime automatiquement. Il ne remplace jamais l'API par un mock.
