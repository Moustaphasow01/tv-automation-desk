# ADR-0017 — PickMyTrade traité en due diligence + pilote paper limité (Phase 10)

- **Statut** : TRANCHÉE POUR PILOTE PAPER LIMITÉ
- **Date** : 2026-08-07
- **Mise à jour** : 2026-08-10
- **Invariant/critère protégé** : `01` §7 (non-objectifs — choix de broker reste une décision opérateur)

## Contexte

Le plan directeur mentionne PickMyTrade comme second provider d'exécution possible. Aucune intégration, contrat, ni due diligence de sécurité/fiabilité n'a été trouvée dans le dépôt actuel (`03` §13, confirmé absent).

## Décision

PickMyTrade n'est **pas** engagé comme provider de production. L'opérateur approuve seulement un pilote `PAPER_ONLY` borné par l'Execution Gateway :

- adapter domaine pur ;
- aucune requête réseau depuis le domaine ;
- aucun secret dans les payloads domaine ;
- aucun mode live ;
- aucun remplacement de la réconciliation interne ;
- aucun passage provider primaire tant que callbacks, fills, positions, idempotence et rollback ne sont pas prouvés.

Le chemin principal du test ne passe pas par TradingView. TradingView peut rester une référence opérateur externe, pas le comparateur ni le contrôleur du desk.

## Alternatives (à arbitrer par l'opérateur)

- **Intégrer PickMyTrade dès la Phase 9 comme provider de production** : possible mais déconseillé par ce dossier — aucune due diligence de sécurité n'a été faite, contact avec un système tiers réel avant validation.
- **Ne jamais intégrer PickMyTrade, retirer Phase 10 de la roadmap** : possible si l'opérateur juge le second provider non prioritaire ; n'affecte aucun autre chantier (Phase 10 est architecturalement indépendante des autres phases grâce à ADR-0016).

## Conséquences

- Tant que `OP-5` n'est pas tranchée, `phase-gates.yaml` marque la Phase 10 comme optionnelle et non bloquante pour les phases suivantes.
- TD2-903 peut écrire un adapter PickMyTrade `PAPER_ONLY`.
- Toute activation live demande une nouvelle décision opérateur explicite.

## Preuve AS-IS

Absence confirmée de `PickMyTrade`/`ExecutionGateway` dans le dépôt actuel, corroborée par l'audit du 2026-08-07 07:51 et par cinq agents d'exploration indépendants. Voir `02` §6, `03` §13.
