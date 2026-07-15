# Desk MCP local

Serveur Node.js unique pour l'API du Desk, le connecteur MCP, les workers live/replay et le webhook TradingView.

La préproduction utilise PostgreSQL via `DESK_GPT_MCP_STORE=postgres`. Les modes cloud ne sont pas disponibles dans ce projet.

## Exécution directe

```bash
npm install
cp .env.example .env
npm start
```

PostgreSQL doit être joignable par `DATABASE_URL`. Le démarrage Docker recommandé est documenté dans le `README.md` à la racine.

## Endpoints

- `GET /status` : santé de l'API et de PostgreSQL ;
- `POST /mcp` : transport MCP HTTP ;
- `GET /api/v1/live-desk/current` : projection principale du Desk ;
- `POST /api/v1/webhooks/tradingview` : ingestion locale TradingView ;
- `POST /tools/:toolName` : bridge REST vers les outils MCP.

Les écritures REST locales utilisent `DESK_MCP_API_KEY`. Le webhook utilise un secret distinct : `TRADINGVIEW_WEBHOOK_SECRET`.

## Tests

```bash
npm test
```
