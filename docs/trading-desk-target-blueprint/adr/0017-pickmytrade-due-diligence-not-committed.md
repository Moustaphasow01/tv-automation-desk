# ADR-0017 — PickMyTrade traité en due diligence + pilote (Phase 10), pas en intégration engagée

- **Statut** : À DÉCIDER (OPÉRATEUR — voir `operator-decisions.yaml`, OP-7)
- **Date** : 2026-08-07
- **Invariant/critère protégé** : `01` §7 (non-objectifs — choix de broker reste une décision opérateur)

## Contexte

Le plan directeur mentionne PickMyTrade comme second provider d'exécution possible. Aucune intégration, contrat, ni due diligence de sécurité/fiabilité n'a été trouvée dans le dépôt actuel (`03` §13, confirmé absent).

## Décision (recommandation, en attente d'arbitrage opérateur)

PickMyTrade n'est **pas** engagé comme provider de production par ce dossier. La Phase 10 se limite à une due diligence structurée (sécurité, fiabilité, modèle de coût, SLA) et, si l'opérateur l'approuve, un pilote en mode SHADOW/PAPER uniquement — jamais en LIVE sans une décision opérateur distincte et postérieure à la Phase 10. Cette ADR sera mise à jour avec le statut `TRANCHÉE` dès que l'opérateur aura statué sur `OP-7`.

## Alternatives (à arbitrer par l'opérateur)

- **Intégrer PickMyTrade dès la Phase 9 comme provider de production** : possible mais déconseillé par ce dossier — aucune due diligence de sécurité n'a été faite, contact avec un système tiers réel avant validation.
- **Ne jamais intégrer PickMyTrade, retirer Phase 10 de la roadmap** : possible si l'opérateur juge le second provider non prioritaire ; n'affecte aucun autre chantier (Phase 10 est architecturalement indépendante des autres phases grâce à ADR-0016).

## Conséquences

- Tant que `OP-5` n'est pas tranchée, `phase-gates.yaml` marque la Phase 10 comme optionnelle et non bloquante pour les phases suivantes.
- Aucun code d'intégration PickMyTrade n'est écrit avant que l'opérateur n'ait explicitement approuvé au moins la due diligence.

## Preuve AS-IS

Absence confirmée de `PickMyTrade`/`ExecutionGateway` dans le dépôt actuel, corroborée par l'audit du 2026-08-07 07:51 et par cinq agents d'exploration indépendants. Voir `02` §6, `03` §13.
