# ADR-0007 — Passage PAPER→LIVE : garde technique obligatoire, jamais de promotion automatique par seuil seul

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : INV-5 (`01` §3)

## Contexte

L'errata de sûreté a explicitement signalé le risque qu'un futur ticket de « promotion automatique de stratégie basée sur des critères de performance chiffrés » soit interprété comme autorisant une bascule PAPER→LIVE entièrement automatique dès que les métriques dépassent un seuil. Ce risque est amplifié par le fait que le ticket de correction de concurrence de position (anciennement 1.5) touchait initialement des gates broker-facing réels (`NO_DUPLICATE_POSITION`, vérification AddOn flat, correspondance exacte de quantité, `CLOSEPOSITION` par instrument) — une combinaison qui aurait pu, sans garde explicite, activer prématurément une exécution réelle stratégie-consciente.

## Décision

La transition `PAPER → LIVE` d'une Strategy Instance (`05-DOMAIN-MODEL-AND-STATE-MACHINES.md` §2.3, axe B) exige **toujours** une action opérateur explicite et tracée, quelle que soit la satisfaction des critères chiffrés de sortie de phase. Ceci est implémenté comme une **garde technique** (un contrôle dans le code, pas seulement une procédure documentée) : aucune fonction du Live Strategy Runtime ne peut effectuer cette transition sans un jeton d'approbation opérateur horodaté et audité. Un test négatif dédié doit prouver qu'aucune combinaison de métriques, seule, ne peut déclencher la transition.

## Alternatives rejetées

- **Promotion automatique dès seuils atteints, avec notification opérateur a posteriori** : rejetée — viole INV-5 et le principe fail-closed (`01` §4) ; une notification a posteriori ne permet pas d'empêcher une exécution réelle non désirée.
- **Approbation opérateur seulement documentée en procédure, sans garde dans le code** : rejetée — une procédure non appliquée techniquement peut être contournée par erreur humaine ou par un futur ticket qui l'ignore sans le savoir.

## Conséquences

- Le Ticket concerné (`17-EXECUTABLE-BACKLOG.md`, Ticket 1.6 restreint) exclut explicitement les 4 fichiers broker-facing réels de son périmètre, et n'implémente que la correction de concurrence côté PAPER uniquement.
- Tout futur ticket touchant à la promotion de mode d'exécution doit référencer cet ADR et inclure le test négatif correspondant.

## Preuve AS-IS

`packages/desk-domain/src/broker-execution.js:420-450`, confirmant que `NO_DUPLICATE_POSITION` est évalué en phase `BROKER_SUBMIT` réelle (pas simulation) — vérifié par lecture directe. Voir `02` §3, `03` §5.
