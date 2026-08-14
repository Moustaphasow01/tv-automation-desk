# PR governance — Trading Desk

> Statut : normatif pour les tickets de transformation V2.

Ce dépôt n'accepte pas une modification structurante sans compte rendu
architectural. Le template PR impose les questions minimales déjà exigées par
`AGENTS.md` : placement, responsabilité, consommateurs, alternatives, tests,
rollback et dette réduite.

## Ce que le guard vérifie

`npm run guard:pr-governance` contrôle automatiquement :

- la présence de `.github/CODEOWNERS` ;
- la présence de `.github/pull_request_template.md` ;
- la couverture CODEOWNERS des surfaces principales du monorepo ;
- la présence des sections PR obligatoires ;
- la présence des validations minimales dans le template ;
- l'intégration du guard dans `package.json` et dans la certification globale.

## Ownership logique

Les propriétaires `@trading-desk/...` sont des équipes logiques. Elles peuvent
être mappées à des équipes GitHub réelles pendant la mise en place CI complète.
Le point important dès maintenant : chaque zone a un propriétaire visible, même
si le dépôt reste en préproduction locale.

## Règle de Done

Un ticket Jira ne doit pas passer `Done` sans commentaire de preuve :

1. fichiers modifiés ;
2. responsabilité et placement ;
3. validations exécutées ;
4. impact dette avant/après ;
5. rollback ou limite connue.

Cette règle vaut aussi pour Codex : le commentaire Jira est ajouté avant la
transition Done.
