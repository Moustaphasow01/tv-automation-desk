# Architecture Boundary Guard

Ce guard matérialise `TD2-ARCH-004` : empêcher les imports interdits, les accès directs cross-module et les cycles entre propriétaires de code.

Commande :

```bash
npm run guard:architecture
```

Self-test du guard :

```bash
npm run guard:architecture:test
```

## Propriétaires contrôlés

- `front` : `src/`, front React de transition. Il consomme les API/BFF, pas les internals backend.
- `legacy-mcp-host` : `mcp_gpt_desk/src/`, host legacy toléré comme caller transitoire.
- packages `@tv-automation/*` : modules métier/exécutables avec exports publics.

## Règles bloquantes

- Un package ne peut pas importer `mcp_gpt_desk/src` ou `src`.
- Un package ne peut pas atteindre un autre package par chemin relatif ou sous-chemin non exporté.
- Le front ne peut pas atteindre les internals backend ou packages.
- Le host MCP doit consommer les packages via leurs exports publics.
- Les dépendances package-to-package doivent être explicitement autorisées.
- Les cycles entre propriétaires sont bloquants.
- Les couches futures `domain`, `application`, `api`, `adapter` respectent la direction `adapter -> application/api -> domain`.
- Les packages purs ne peuvent pas importer React, PostgreSQL, MCP SDK ou fournisseurs d'infrastructure.

## Dépendances package autorisées

- `@tv-automation/desk-domain -> @tv-automation/desk-audit`
- `@tv-automation/desk-replay-engine -> @tv-automation/desk-domain` : requis par `TD2-301` pour que le Simulation Engine réutilise les prédicats, gates, politiques et hashes du runtime canonique, sans second moteur.

## Dérogations legacy suivies

Le guard n'excuse pas la dette historique ; il la borne. Les tailles et noms legacy restent suivis dans :

- `docs/engineering/legacy-baseline-2026-08-08.md`
- `docs/engineering/exception-register.md`

Le host MCP reste toléré comme zone d'assemblage legacy jusqu'à extraction verticale (`TD2-ARCH-006`). Toute zone touchée applique `touch-and-improve`.
