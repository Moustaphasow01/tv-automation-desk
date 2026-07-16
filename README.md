# TV Automation — préproduction locale

Cette copie est un projet indépendant du dépôt Firebase/Google Cloud d'origine. Son runtime cible est entièrement local :

- frontend React servi par Nginx ;
- API et serveur MCP Node.js ;
- PostgreSQL 16 dans Docker ;
- webhook TradingView local ;
- volumes Docker pour les données et objets locaux.

Aucune commande de déploiement Firebase, Firestore, Cloud Run ou GCloud n'est incluse dans le démarrage local.
Le frontend utilise toujours l'API locale : aucun mode mock n'est compilé dans le bundle de production.

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

L'architecture et les endpoints M0 à M11 sont détaillés dans [docs/OPERATIONS_REPLAY_LAB_ARCHITECTURE.md](docs/OPERATIONS_REPLAY_LAB_ARCHITECTURE.md).

Webhook TradingView local :

```text
POST http://localhost:8787/api/v1/webhooks/tradingview?token=<TRADINGVIEW_WEBHOOK_SECRET>
```

Les scripts Pine maintenus sont dans `tradingview/` : exporteur webhook unitaire, exporteur Volume Profile et exporteurs batch M1/M5/M15/H1/H4. Les fichiers batch sont conservés car leurs alertes peuvent être configurées directement dans TradingView, hors du graphe d'import de l'application.

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

Pour l'acceptation complète contre les conteneurs réels Nginx, API et PostgreSQL :

```bash
npm run test:stack
```

Ce test utilise uniquement des fixtures PostgreSQL temporaires et les supprime automatiquement. Il ne remplace jamais l'API par un mock.
