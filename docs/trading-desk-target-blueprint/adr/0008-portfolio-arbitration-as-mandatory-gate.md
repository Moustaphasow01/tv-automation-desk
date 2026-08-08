# ADR-0008 — Portfolio Arbitration + Global Risk + Broker Netting positionnés en verrou avant toute activation réelle multi-stratégie

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : SC-5 (`01` §5), §11 de `03-AS-IS-TO-TARGET-GAP-MAP.md`

## Contexte

Le plan directeur initial ne positionnait pas explicitement ces trois composants comme un verrou temporel obligatoire — ils pouvaient être lus comme un chantier parmi d'autres, sans séquencement strict par rapport à l'activation LIVE multi-stratégie. L'addendum de passation a corrigé ce point : sans consolidation de portefeuille, deux stratégies individuellement conformes à leurs propres limites de risque peuvent, ensemble, dépasser une limite de risque de portefeuille qu'aucune n'aurait dépassée seule.

## Décision

Portfolio Arbitration Engine, Global Risk Engine et Broker Netting Engine (`04-TARGET-SYSTEM-ARCHITECTURE.md` §2, couche Arbitrage) constituent un **verrou architectural obligatoire** : aucune Strategy Instance ne peut passer en mode LIVE aux côtés d'une autre Strategy Instance déjà LIVE tant que ces trois composants ne sont pas actifs et testés (Phase 7). L'activation LIVE d'une seule et unique Strategy Instance à la fois reste possible sans ce verrou, car il n'y a alors rien à arbitrer — mais le passage à un deuxième LIVE simultané est techniquement bloqué tant que la Phase 7 n'est pas complète.

## Alternatives rejetées

- **Traiter l'arbitrage de portefeuille comme une amélioration optionnelle post-lancement multi-stratégie** : rejetée — expose directement à un dépassement de risque consolidé non détecté, contraire au principe fail-closed.
- **Implémenter une limite de risque globale approximative sans moteur dédié, en attendant** : rejetée — une approximation non testée donnerait une fausse assurance de sécurité, pire qu'une absence de fonctionnalité clairement documentée comme bloquante.

## Conséquences

- `phase-gates.yaml` encode ce verrou comme une porte bloquante explicite avant toute Strategy Instance additionnelle en LIVE.
- La roadmap (`16-END-TO-END-MIGRATION-ROADMAP.md`) place la Phase 7 avant toute activation réelle multi-stratégie, jamais en parallèle non gouverné.

## Preuve AS-IS

Absence confirmée de tout composant équivalent dans le code actuel (`03` §11, écart `ABSENT`) — décision de conception pure motivée par un risque identifié, pas une correction d'un composant existant.
