# Protocole Codex — UI/UX & Frontend Product Engineering

**Statut :** obligatoire pour toute création ou modification d’interface.

## 1. Ordre de lecture

1. `AGENTS.md`
2. documents produit et architecture du projet
3. Page Operating Contract de l’écran
4. Screen Specification ou `CLAUDE_DESIGN.md`
5. `docs/ui-ux/UI_UX_FRONTEND_PRODUCT_ENGINEERING_RULEBOOK.md`
6. design system et catalogue de composants
7. code, API, tests et références visuelles existants

## 2. Stop conditions

Codex doit arrêter la conception ou le développement et rapporter le blocage lorsqu’au moins une condition est vraie :

- l’objectif, les utilisateurs ou les questions métier de l’écran sont inconnus ;
- une donnée nécessaire n’a ni contrat ni sémantique d’absence ;
- une action visible n’a pas de capability ou de résultat terminal réel ;
- la permission ou l’environnement autoritaire n’est pas déterminable ;
- un écran de détail ne reçoit pas un identifiant stable ;
- la solution exige d’inventer une capacité backend ;
- une règle P0 ne peut pas être respectée sans décision produit ou sécurité.

## 3. Phase A — audit avant code

Codex peut d’abord exécuter le sélecteur contextuel :

```bash
node docs/ui-ux/scripts/select-ui-ux-rules.mjs "<description complète de la tâche>" --priority P0,P1 --limit 80
```

La sélection aide au cadrage mais ne remplace pas la lecture des chapitres concernés. Codex doit ensuite produire :

```text
Objectif de la tâche
Utilisateurs et contexte
Questions métier
Sources de vérité lues
Fichiers inspectés
Données/API/commandes réelles
Permissions et environnements
États applicables
Règles UXR sélectionnées
Risques et inconnues
Vertical slice proposé
```

## 4. Phase B — matrice de traçabilité

Pour chaque capacité de l’écran :

```text
Besoin utilisateur
  → question métier
  → donnée/API ou commande
  → capability/permission
  → DTO + validation
  → mapper/view model
  → query/cache/URL state
  → composant
  → route/drill-down
  → états dégradés
  → responsive/a11y
  → test
  → preuve
```

## 5. Phase C — plan d’implémentation

Le plan doit :

- privilégier un vertical slice de bout en bout ;
- traiter Truth & Safety avant le polish ;
- éviter la refonte massive et l’abstraction prématurée ;
- indiquer les fichiers créés, modifiés et supprimés ;
- identifier les migrations, flags et rollback ;
- définir les critères de Done avant le premier changement.

## 6. Phase D — implémentation

Règles minimales :

- aucune donnée métier hardcodée comme production ;
- aucun calcul métier canonique dans un composant ;
- aucun bouton sans action réelle ;
- aucun fallback rassurant pour une donnée inconnue ;
- composants de feature séparés des primitives UI ;
- URL state pour filtres et navigation partageables ;
- server state dans la couche de query ;
- permissions et capabilities venant de l’autorité backend ;
- tous les états applicables construits avant la validation visuelle finale.

## 7. Phase E — contrôles

Exécuter selon la stack disponible :

```bash
node docs/ui-ux/scripts/select-ui-ux-rules.mjs "<tâche>" --priority P0,P1 --limit 80
node docs/ui-ux/scripts/ui-ux-audit.mjs <répertoire-source>
node docs/ui-ux/scripts/test-ui-ux-audit.mjs
# puis lint, typecheck, tests composants, Storybook/Axe,
# Playwright, visual regression et performance du projet.
```

Une réussite automatique ne remplace pas :

- la revue du contrat de page ;
- le parcours clavier manuel ;
- l’inspection avec données réelles et états dégradés ;
- la vérification aux viewports contractuels ;
- le jugement sur la hiérarchie, le contenu et la compréhension.

## 8. Phase F — auto-audit final

Codex doit répondre :

1. L’utilisateur comprend-il l’état, l’exception et la prochaine action en cinq secondes ?
2. Chaque donnée a-t-elle unité, période, source, fraîcheur et sémantique d’absence ?
3. Chaque action a-t-elle capability, permission, confirmation, terminal et audit applicables ?
4. Les niveaux overview, opérationnel, détail et analyse sont-ils correctement séparés ?
5. Les états loading, empty, partial, stale, disconnected, forbidden, conflict et error sont-ils honnêtes ?
6. Le clavier, le focus, la sémantique, le contraste et le zoom sont-ils vérifiés ?
7. Le mobile priorise-t-il la tâche au lieu de réduire le desktop ?
8. Les tests prouvent-ils le parcours contre une autorité réelle ?
9. Les règles UXR P0/P1 applicables sont-elles respectées ?
10. Tout contrôle non exécuté est-il déclaré ?

## 9. Format de sortie obligatoire

```markdown
# Résultat

## Résumé de l’implémentation
## Décisions UX et architecture
## Règles UXR appliquées
## Fichiers modifiés
## Données, permissions et commandes
## États et responsive
## Tests et commandes exécutées
## Captures / preuves
## Limites et contrôles non exécutés
## Risques et dérogations
## Prochaine validation humaine
```

Codex ne doit jamais remplacer un contrôle non exécuté par une affirmation de conformité.
