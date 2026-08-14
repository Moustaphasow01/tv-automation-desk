# Market Data Capability Profiling — TD2-206

TD2-206 ajoute un audit de profondeur historique et de capacités fines des flux marché.

L’objectif n’est pas de bloquer le desk parce qu’un flux ne fournit pas encore toute la microstructure. L’objectif est de rendre visible, stockable et interrogeable ce que chaque feed sait réellement fournir :

- OHLCV et volume ;
- ticks ;
- bid / ask ;
- open interest ;
- profondeur historique ;
- trous de bougies ;
- recommandation de stockage chaud/froid.

## Commandes

Résumé opérateur sans écriture :

```bash
npm run profile:market-data
```

Depuis le package MCP :

```bash
npm --prefix mcp_gpt_desk run data:capabilities -- --summary
```

Avec PostgreSQL réel :

```bash
DESK_POSTGRES_URL="postgres://..." npm run profile:market-data
```

Persister le résultat dans PostgreSQL :

```bash
DESK_POSTGRES_URL="postgres://..." npm --prefix mcp_gpt_desk run data:capabilities -- --persist --summary
```

Dry-run transactionnel :

```bash
DESK_POSTGRES_URL="postgres://..." npm --prefix mcp_gpt_desk run data:capabilities -- --persist --dry-run --summary
```

Mode CI/release bloquant :

```bash
DESK_POSTGRES_URL="postgres://..." DESK_CAPABILITY_FAIL_ON_BLOCKING=1 npm --prefix mcp_gpt_desk run data:capabilities -- --summary
```

## Tables

- `market_data_capability_profile_runs` : un run d’audit complet, avec date, provider, environnement, version de profil et rapport JSON.
- `market_data_capability_profiles` : un profil par feed/instrument/timeframe/provider/environnement.

## États

| État | Sens |
|---|---|
| `MEASURED` | OHLCV/volume mesurés ; les manques éventuels sont non bloquants pour V5. |
| `PARTIAL` | Historique présent mais capacité partielle, par exemple volume absent ou bid/ask asymétrique. |
| `MISSING` | Feed absent ou sans historique mesurable. |
| `UNAVAILABLE` | Réservé aux cas provider/stockage explicitement indisponibles. |

## Bloquant vs non bloquant

Pour la stratégie V5 actuelle, les capacités OHLCV et volume des feeds requis `MNQ/MES` restent bloquantes.

Les manques tick/bid/ask/open interest sont tracés comme non bloquants pour V5 tant qu’ils ne sont pas promus dans le contrat d’exécution. On veut les voir clairement pour préparer NinjaTrader/API broker, les coûts et les futures stratégies microstructure, sans dégrader artificiellement les replays actuels.

## Stockage recommandé

- `HOT_SERIES` : séries OHLCV courtes/fréquentes utilisées par live/replay.
- `COLD_RAW` : historique plus lourd peu sollicité en direct.
- `HOT_AND_COLD` : données microstructure/tick/bid/ask/open interest utiles en chaud et à archiver brut.
- `IGNORE` : feed absent ou non utile à stocker.

## API contrôlée

Les profils sont exposés par l’API Data Foundation :

```text
GET /api/v1/data-foundation/market-data-profiles
```

Filtres supportés :

- `source_key`
- `instrument_code`
- `timeframe`
- `status`
- `blocking_classification`
- `audience`
- `limit`

Comme les autres endpoints Data Foundation, l’API reste read-only et annonce explicitement `direct_table_access=false`.
