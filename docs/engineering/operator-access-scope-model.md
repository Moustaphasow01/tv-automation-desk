# Operator access scope model

Ticket : TD2-1002.

## Objectif

Le desk doit distinguer :

- lecture simple ;
- lecture automation ;
- actions automation ;
- lecture exécution ;
- actions exécution ;
- administration.

Le modèle reste backward-compatible avec les deux scopes historiques :

- `desk.read` ;
- `desk.write`.

## Scopes supportés

| Scope | Usage |
|---|---|
| `desk.read` | Super-scope lecture historique, autorise aussi `desk.automation.read` et `desk.execution.read`. |
| `desk.write` | Super-scope écriture historique, autorise lecture, automation write et execution write. |
| `desk.automation.read` | Lecture workflows, replays, incidents, agent runtime, observabilité. |
| `desk.automation.write` | Actions workflow/replay/claim lanes/observabilité/stratégies. |
| `desk.execution.read` | Lecture exécution, intents, ordres, bridge/addon state. |
| `desk.execution.write` | Actions exécution, bridge/addon, réconciliation et snapshots broker. |
| `desk.admin` | Super-scope total. |

## Classification des routes front

- `/execution/*`
  - `GET` : `desk.execution.read` ;
  - écriture : `desk.execution.write`, risque `high`.
- `/operations`, `/workflows`, `/replays`, `/claim-lanes`, `/observability`, `/incidents`, `/notifications`, `/strategy-v2`, `/research`, `/simulation-runs`
  - `GET` : `desk.automation.read` ;
  - écriture : `desk.automation.write`, risque `elevated`.
- `/operator/*`
  - écriture : `desk.write`, risque `elevated`.
- autres lectures front
  - `desk.read`.

## Compatibilité

Le serveur actuel peut continuer à demander `desk.read` ou `desk.write` sans casser les clients existants. Les nouveaux scopes sont publiés par OAuth et par le catalogue `Front API v2` afin que :

- le front actuel puisse commencer à masquer/désactiver des actions ;
- le futur front V3 puisse construire ses permissions sans connaître les routes techniques ;
- les automatisations futures ne puissent pas contourner les permissions d'exécution.

## Garde-fou

Le test `mcp_gpt_desk/test/operator_access_policy.test.js` vérifie :

- la publication OAuth des nouveaux scopes ;
- l'implication `desk.read` / `desk.write` ;
- les refus entre automation et execution ;
- la classification des routes risquées.
