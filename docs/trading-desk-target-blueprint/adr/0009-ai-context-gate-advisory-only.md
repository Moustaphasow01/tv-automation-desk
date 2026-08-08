# ADR-0009 — AI Context Gate limité à des sorties SHADOW/ADVISORY, jamais décisionnelles

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : INV-1, SC-6 (`01` §3, §5)

## Contexte

Le plan directeur envisage un rôle continu pour le LLM dans l'analyse contextuelle en direct (ex. lecture de nouvelles, sentiment de marché). Sans cloisonnement explicite, ce rôle pourrait dériver vers une influence directe sur la décision d'exécution réelle — exactement ce que la North Star interdit (INV-1).

## Décision

L'AI Context Gate ne peut produire que des `AI Context Advisory` (`05-DOMAIN-MODEL-AND-STATE-MACHINES.md` §5.2) avec une valeur parmi `TAKE`/`TAKE_REDUCED`/`WAIT`/`REJECT`, consommées en lecture seule par le Portfolio Arbitration Engine. Aucune relation de données ni aucun chemin de code ne permet à une `AI Context Advisory` de produire directement un `Order Intent`. Toute intégration plus profonde (ex. l'avis devient bloquant plutôt que consultatif) exige une nouvelle décision opérateur explicite et une revalidation de cet ADR — elle n'est pas acquise par défaut.

## Alternatives rejetées

- **Permettre à l'AI Context Gate de bloquer directement un ordre (veto fort)** : rejetée pour la version initiale — même un veto (plutôt qu'une initiation) déplacerait une partie du pouvoir de décision réelle vers le LLM ; commence en mode strictement consultatif, avec option de renforcement future sous décision opérateur distincte.
- **Ne pas cloisonner du tout, laisser l'intégration se faire au fil de l'eau** : rejetée — c'est exactement le schéma qui a motivé l'errata de sûreté sur d'autres points de ce dossier ; le cloisonnement doit être décidé à l'avance, pas découvert après coup.

## Conséquences

- `12-AI-CONTEXT-GATE.md` documente précisément l'interface de sortie et l'absence de tout chemin d'écriture vers l'exécution.
- Un test d'intégration dédié (voir `18-TEST-AND-VALIDATION-STRATEGY.md`) doit prouver qu'aucune combinaison de réponses de l'AI Context Gate ne peut, seule, produire un `Order Intent`.

## Preuve AS-IS

Aucun composant équivalent n'existe actuellement (`03` §12, écart `ABSENT`) — décision de conception préventive, motivée par l'invariant INV-1 plutôt que par une correction de code existant.
