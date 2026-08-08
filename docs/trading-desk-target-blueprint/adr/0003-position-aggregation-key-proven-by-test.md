# ADR-0003 — Clé d'agrégation de position étendue et prouvée par test avant connexion au chemin réel

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : INV-8 (`01` §3)

## Contexte

Le bug de collision confirmé (`02-VERIFIED-AS-IS-SUMMARY.md` §6) montre que les Maps `deskPositions`/`brokerPositions` sont indexées uniquement par `positionKey(instrument)`. Une première proposition de correction présumait que `instrument + strategy_id` serait la bonne clé composite cible — présomption explicitement rejetée par l'errata de sûreté reçu, car `strategy_id` s'est avéré être une clé de session/lane legacy, pas une identité canonique.

## Décision

La clé d'agrégation cible n'est pas fixée par hypothèse. Le ticket de correction (`17-EXECUTABLE-BACKLOG.md`, Ticket 0.4) doit d'abord écrire des tests de concurrence multi-instance qui **démontrent** quelle combinaison de champs élimine les collisions observées, avant d'implémenter la clé finale (candidat le plus probable : `instrument + strategy_instance_id`, à confirmer par le test, pas à supposer).

## Alternatives rejetées

- **Utiliser `instrument + strategy_id` directement** : rejetée — `strategy_id` n'est pas garanti unique par stratégie métier au sens cible, l'utiliser masquerait la collision plutôt que de la résoudre.
- **Corriger sans écrire de test de concurrence au préalable** : rejetée — violerait INV-8, qui exige une preuve de non-collision avant connexion à un chemin d'exécution réel.

## Conséquences

- Le Ticket 0.4 ne peut être considéré terminé sans un test de non-régression prouvant l'absence de collision sous accès concurrent multi-instance.
- La nouvelle clé, une fois prouvée, devient la base de l'entité `Target Position` (`05-DOMAIN-MODEL-AND-STATE-MACHINES.md` §6.3).

## Preuve AS-IS

`mcp_gpt_desk/src/broker-execution-service.js`, construction des Maps `deskPositions`/`brokerPositions` par `positionKey(instrument)` seul — vérifié par lecture directe. Voir `02` §6.
