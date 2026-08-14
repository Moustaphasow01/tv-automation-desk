# API compatibility and deprecation policy

Ticket : TD2-1003.

## Objectif

Protéger simultanément :

- le front actuel ;
- le futur front V3 ;
- les workers MCP ;
- les automatisations live/replay/research/execution.

## Guard CI

Commande :

```bash
npm run guard:api-compatibility
```

Test :

```bash
npm run guard:api-compatibility:test
```

Le guard vérifie :

- routes critiques OpenAPI présentes ;
- routes critiques présentes dans le catalogue Front API v2 ;
- politique de dépréciation appliquée aux opérations marquées `deprecated`;
- SSE avec cursor idempotent ;
- scopes opérateur granulaires ;
- surfaces MCP strictes sans fuite Live/Replay/Research/Execution.

## Routes critiques

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/live-desk/current` | session actuelle |
| GET | `/operations/summary` | cockpit opérations |
| GET/POST | `/replays` | ledger et création replay |
| GET | `/events` | SSE front |
| POST | `/execution/actions` | actions exécution opérateur |
| GET | `/strategy-v2/overview` | stratégies déterministes |
| GET | `/data-foundation/overview` | fondation données |
| GET | `/ai-context/overview` | contexte IA |
| GET | `/portfolio-risk/overview` | risque portefeuille |
| GET | `/openapi.json` | contrat OpenAPI courant |

## Dépréciation

Une opération OpenAPI ne peut être marquée `deprecated: true` que si elle fournit :

- `x-desk-sunset` : horizon de retrait ;
- `x-desk-replacement` : route ou contrat remplaçant.

Sans ces champs, le guard échoue.

## Règle de migration

- Ajouter une route backward-compatible : autorisé.
- Changer méthode, route, schéma principal ou scope : version majeure requise.
- Supprimer une route consommée par le front actuel : interdit avant migration complète et sunset documenté.
- Introduire un outil MCP worker : profil strict obligatoire.
