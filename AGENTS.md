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

Les violations historiques listées dans `docs/engineering/exception-register.md` sont tolérées uniquement pendant leur résorption. Elles ne constituent jamais un état cible.

Tout chantier doit appliquer la règle **touch-and-improve** : lorsqu'il touche une zone legacy, il réduit au moins une dette mesurable de cette zone — taille, complexité, responsabilité, duplication, nommage, frontière, typage ou couverture — sans en dégrader une autre. Une exception n'est admise que pour un correctif urgent de sûreté ou d'incident, avec justification, mesure compensatoire et ticket de résorption prioritaire.

La baseline et le registre de dérogations sont mis à jour au fil des tickets. Le dernier ticket de clôture du programme est bloqué tant que le dépôt n'est pas entièrement conforme aux standards ou qu'une dérogation reste ouverte.

## Validation minimale

Inspecter d'abord les scripts réels du dépôt. Selon le périmètre :

```bash
npm run typecheck
npm run test:react
npm run build
npm run test:e2e
npm run test:stack
npm run guard:architecture
npm run guard:static-quality
npm run guard:exceptions
npm run guard:architecture-scorecard
npm run guard:pr-governance
npm run guard:security-supply-chain
npm run guard:sql-migrations
npm run guard:problem-details
npm run guard:runtime-safety
npm run guard:mcp-slices
npm run guard:front-architecture
npm --prefix packages/desk-domain run coverage:gate
npm --prefix mcp_gpt_desk test
docker compose config --quiet
```

Ajouter les guards d'architecture, sécurité, migrations, contrats et déploiement concernés. Ne jamais inventer une commande absente.

## UI/UX & Frontend Product Engineering

Après les lectures générales obligatoires définies en tête de ce fichier, l'ordre de lecture spécifique à toute tâche frontend est :

1. les sources de vérité produit et architecture du projet ;
2. le Page Operating Contract et la Screen Specification de l'écran ;
3. `docs/ui-ux/UI_UX_FRONTEND_PRODUCT_ENGINEERING_RULEBOOK.md` ;
4. `docs/codex/CODEX_UI_UX_EXECUTION_PROTOCOL.md`.

Les documents produit, architecture, contrats actifs, ADR et standards d'ingénierie du projet restent prioritaires sur le référentiel UI/UX général. La hiérarchie détaillée et les extensions locales sont documentées dans `docs/ui-ux/PROJECT_OVERRIDES.md`.

Obligations :

- sélectionner et citer les règles `UXR-XXXX` applicables avant le code ;
- inspecter le repository et les contrats API avant de conclure ;
- ne jamais inventer donnée, capability, permission ou résultat ;
- traiter Truth & Safety et les états dégradés avant le polish ;
- ne jamais afficher un bouton sans action réelle ;
- séparer DTO, validation, mapper, view model, query, feature et primitive UI ;
- exécuter l'audit UI/UX, les tests, l'accessibilité et le visuel applicables ;
- déclarer tout contrôle non exécuté ;
- ne déclarer Done qu'après auto-audit UXR et Definition of Done.

Toute violation P0 bloque la tâche sans dérogation approuvée et datée. Le scanner statique reste heuristique : son succès ne constitue jamais une preuve de conformité complète.

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
- réduction de dette obtenue avec mesure avant/après ;
- ADR ou dérogation créée.

Une tâche n'est pas terminée sans preuve de validation.
