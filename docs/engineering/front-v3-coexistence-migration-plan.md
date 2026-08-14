# Front V3 — Plan de coexistence et migration écran par écran

Ticket : TD2-1005.

## Décision

Le Front V3 cohabite avec le front actuel. Aucune bascule globale n'est autorisée.

Chaque écran migré possède :

- un flag de migration désactivé par défaut ;
- un chemin courant de rollback ;
- une cible V3 `global`, `zoom` ou `detail` ;
- une liste explicite d'endpoints API consommés ;
- un propriétaire métier V3.

Le manifeste runtime est `src/features/front-migration/manifest.ts`. Il est importé par `src/navigation.ts` afin que la navigation actuelle reste liée au plan de migration.

## Règles de coexistence

1. Le front actuel reste le chemin par défaut.
2. Le shell V3 ne peut être exposé que via `front.v3.shell.enabled`.
3. Les espaces V3 sont activés indépendamment.
4. Un écran V3 ne change pas le contrat API existant.
5. Le rollback consiste à désactiver le flag concerné.
6. Les pages zoom V3 ouvrent une route dédiée, pas un panneau permanent qui remplace le contenu global.
7. Les identifiants techniques restent dans un inspecteur replié.
8. Les états `loading`, `empty`, `degraded`, `stale`, `disconnected` et `permission denied` restent obligatoires.

## Flags de migration

| Flag | Défaut | Propriétaire | Rollback |
|---|---|---|---|
| `front.v3.shell.enabled` | disabled | Gouvernance | désactiver le flag |
| `front.v3.today.enabled` | disabled | Aujourd'hui | désactiver le flag |
| `front.v3.replay.enabled` | disabled | Replay | désactiver le flag |
| `front.v3.performance.enabled` | disabled | Performance | désactiver le flag |
| `front.v3.operations.enabled` | disabled | Opérations | désactiver le flag |
| `front.v3.execution.enabled` | disabled | Exécution | désactiver le flag |
| `front.v3.strategy.enabled` | disabled | Stratégies | désactiver le flag |
| `front.v3.research.enabled` | disabled | Research | désactiver le flag |
| `front.v3.data.enabled` | disabled | Données | désactiver le flag |
| `front.v3.governance.enabled` | disabled | Gouvernance | désactiver le flag |

## Plan par espace

| Espace actuel | Cibles V3 | Pilote | Flag principal | Fallback |
|---|---|---:|---|---|
| Aujourd'hui | Aujourd'hui | non | `front.v3.today.enabled` | `/live` |
| Replay | Replay | oui | `front.v3.replay.enabled` | `/replay` |
| Performance | Performance | non | `front.v3.performance.enabled` | `/performance/analysis` |
| Opérations | Opérations, Gouvernance | oui | `front.v3.operations.enabled` | `/operations` |
| Exécution | Exécution | non | `front.v3.execution.enabled` | `/operations/execution` |
| Réglages | Stratégies, Research, Données, Gouvernance | non | `front.v3.governance.enabled` | `/strategies` |

## Écrans pilotes

### Replay

Replay est pilote parce qu'il bénéficie déjà des endpoints de runs, d'avancement, de performance et d'événements.

Séquence :

1. migrer `/replay` vers `/v3/replay` en vue globale ;
2. migrer `/replay/runs/:runId` vers `/v3/replay/runs/:runId` en zoom dédié ;
3. garder `/replay/compare` en coexistence jusqu'à stabilisation des comparaisons ;
4. vérifier que les résultats R et timelines viennent des endpoints réels, sans recalcul front officiel.

### Opérations

Opérations est pilote parce que les écrans ont déjà besoin d'un modèle global → zoom → détail.

Séquence :

1. migrer `/operations` vers `/v3/operations` en vue globale ;
2. migrer les incidents vers une page zoom dédiée ;
3. brancher SSE `/api/v1/events` avec reprise par curseur ;
4. garder runbooks et notifications sous fallback tant que les actions opérateur ne sont pas totalement permissionnées.

## Rollback

Rollback visuel :

- désactiver le flag de l'espace ;
- renvoyer l'opérateur vers `fallbackSpacePath` ;
- conserver les endpoints API v1/v2 inchangés.

Rollback fonctionnel :

- aucune mutation V3 ne doit écrire directement dans PostgreSQL ;
- toute action sensible reste routée par les endpoints existants et leurs `operatorScopes` ;
- si un écran V3 ne peut pas afficher un état fiable, il doit afficher `degraded` ou `disconnected`, jamais masquer l'anomalie.

## Compatibilité API

Le plan s'appuie sur :

- `/api/v2/catalog.json` pour route, domaine, stabilité et `operatorScopes` ;
- `/api/v1/events` pour l'activité temps réel avec reprise par curseur ;
- les endpoints BFF v1 existants pour la donnée métier.

Le guard `npm run guard:api-compatibility` protège les opérations critiques.

## Critères d'acceptation

- le front actuel reste utilisable sans flag V3 ;
- chaque espace de navigation actuel possède un plan V3 ;
- chaque écran migrable possède un rollback par chemin courant ;
- chaque écran migrable déclare au moins une dépendance API ;
- Replay et Opérations sont identifiés comme pilotes ;
- la navigation runtime expose le manifeste de migration ;
- les tests front prouvent la couverture du manifeste.
