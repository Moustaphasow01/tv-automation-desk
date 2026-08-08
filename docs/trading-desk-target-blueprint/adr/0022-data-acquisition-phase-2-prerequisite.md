# ADR-0022 — Data Acquisition & Provenance introduit en Phase 2, prérequis à un Simulation Engine reproductible

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : SC-3 (`01` §5)

## Contexte

L'AS-IS actuel ne dispose d'aucun composant formalisé de provenance des données de marché (`03` §6, écart `ABSENT`). Sans traçabilité de la source et de la version des données utilisées par un run de simulation, il devient impossible de garantir la reproductibilité bit-à-bit exigée par SC-3 — deux runs annoncés comme « identiques » pourraient en réalité avoir consommé des données subtilement différentes (ex. une source de marché mise à jour entre les deux runs sans que cela soit tracé).

## Décision

La Data Acquisition & Provenance Layer est positionnée en **Phase 2**, avant la Phase 3 (Simulation Engine), et non en chantier parallèle non ordonné comme le suggérait la première version du plan d'évolution. Tout Dataset consommé par un Run de simulation (`05` §3.1-3.2) doit référencer une provenance tracée (source, horodatage d'ingestion, version de schéma) produite par cette couche.

## Alternatives rejetées

- **Traiter Data Acquisition comme un chantier parallèle non bloquant pour la Simulation Engine** : rejetée — c'était l'approche de la première version du plan ; elle permettrait techniquement de construire un Simulation Engine fonctionnel mais dont la reproductibilité ne serait pas garantie, un défaut découvert seulement plus tard, potentiellement après que des décisions de stratégie s'appuient déjà sur des résultats non reproductibles.
- **Différer la provenance et l'ajouter après coup au Simulation Engine** : rejetée — ajouter la provenance a posteriori sur des Datasets déjà utilisés pour valider des Strategy Versions publiées invaliderait rétroactivement la confiance dans ces validations.

## Conséquences

- La roadmap (`16-END-TO-END-MIGRATION-ROADMAP.md`) place explicitement la Phase 2 avant la Phase 3, avec une porte de sortie vérifiant que la provenance est opérationnelle avant le démarrage de la Phase 3.
- `06-DATA-ACQUISITION-FEATURES-AND-PROVENANCE.md` développe le détail de cette couche.

## Preuve AS-IS

Absence confirmée de composant de provenance formalisé dans le dépôt actuel — les données de marché alimentent directement les pipelines existants sans registre dédié (`03` §6).
