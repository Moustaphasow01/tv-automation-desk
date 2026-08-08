# AGENTS.md — Trading Desk

## Instructions obligatoires

Avant toute modification :

1. Lire `docs/engineering/TRADING_DESK_ENGINEERING_STANDARDS.md` intégralement.
2. Lire `docs/engineering/module-catalog.md` et `docs/engineering/naming-glossary.md`.
3. Lire les ADR pertinents dans `docs/trading-desk-target-blueprint/adr/`.
4. Identifier le bounded context propriétaire et la couche correcte.
5. Examiner le code voisin et rechercher une capacité existante avant de créer une abstraction.
6. Présenter le placement, la responsabilité, les consommateurs et les alternatives écartées.
7. Développer une tranche verticale réelle : domaine, application, adapter/API, projection front et tests lorsque concernés.
8. Exécuter les validations réelles du dépôt avant de déclarer la tâche terminée.

## Architecture

- Le desk converge vers un monolithe modulaire Node.js/PostgreSQL organisé par domaines métier.
- Les dépendances suivent `adapter -> application -> domain`; les ports publics sont minimaux.
- Le domaine ne dépend jamais de PostgreSQL, HTTP, MCP, React, NinjaTrader, PickMyTrade, Codex ou d'un autre fournisseur.
- Un module ne lit ni n'écrit directement les tables ou internals d'un autre module.
- Les interactions utilisent API publique, événement/outbox ou projection approuvée.
- Les use cases de commande possèdent la transaction, l'idempotence, l'audit et l'optimistic locking.
- Le frontend ne contient aucune règle de trading officielle ni donnée métier simulée en production.
- PostgreSQL reste la source de vérité ; Git reste la source de vérité des contrats, standards et seeds publiés.

## Création de code

Avant de créer une fonction, classe, service ou fichier, répondre :

- Quel concept représente-t-il ?
- Quel module le possède ?
- Quelle couche ?
- Quelle est sa raison principale de changer ?
- Qui le consomme ?
- Pourquoi l'élément existant ne convient-il pas ?
- Quel test prouvera sa responsabilité ?
- Quelle règle automatique empêchera son mauvais usage ?

Interdits sans dérogation approuvée :

- noms vagues `Manager`, `Helper`, `Utils`, `Common`, `Generic`, `BaseService`, `Processor`, `Coordinator` ou `Facade` ;
- nouveau fichier de production écrit à la main de plus de 600 lignes ;
- nouvelle fonction de plus de 60 lignes ;
- cinq paramètres ou plus sans command/query/value object ;
- paramètre booléen qui change le comportement ;
- logique métier dans route/controller, mapper SQL, composant React ou script de seed ;
- accès cross-module direct ;
- dépendance ou technologie ajoutée sans justification et ADR lorsque structurante ;
- `desk_documents`/JSONB utilisé pour un modèle métier relationnel connu ;
- TODO sans ticket, propriétaire et échéance.

Les violations historiques listées dans `docs/engineering/exception-register.md` sont tolérées temporairement, mais ne doivent jamais être aggravées. Tout fichier legacy touché doit rester stable ou converger vers les seuils.

## Validation minimale

Inspecter d'abord les scripts réels du dépôt. Selon le périmètre :

```bash
npm run typecheck
npm run test:react
npm run build
npm run test:e2e
npm run test:stack
npm --prefix packages/desk-domain run coverage:gate
npm --prefix mcp_gpt_desk test
docker compose config --quiet
```

Ajouter les guards d'architecture, sécurité, migrations, contrats et déploiement concernés. Ne jamais inventer une commande absente.

## Compte rendu obligatoire

À la fin, indiquer :

- fichiers modifiés ;
- module et choix de placement ;
- responsabilité ajoutée ;
- alternatives écartées ;
- migrations, contrats et compatibilité ;
- tests exécutés et résultats ;
- observabilité, sécurité et rollback ;
- limites ou dette restante ;
- ADR ou dérogation créée.

Une tâche n'est pas terminée sans preuve de validation.
