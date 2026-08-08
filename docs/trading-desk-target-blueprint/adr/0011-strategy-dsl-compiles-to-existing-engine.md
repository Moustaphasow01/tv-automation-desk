# ADR-0011 — Strategy DSL compile vers le moteur déterministe existant, pas de second moteur d'exécution

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : SC-3 (`01` §5), cohérent avec ADR-0010

## Contexte

Le plan directeur envisage un DSL déclaratif permettant à un chercheur d'écrire une stratégie sans passer par le format de plan typé produit par le LLM. Introduit naïvement, un tel DSL pourrait être accompagné de son propre interpréteur/moteur d'exécution, dupliquant la logique déjà présente dans `packages/desk-domain`.

## Décision

Le Strategy DSL (`07-STRATEGY-DSL-AND-CANONICAL-RUNTIME.md`) est une couche de **compilation**, pas un second moteur. Le compilateur DSL cible produit en sortie la même représentation intermédiaire (plan typé / structure de conditions) que celle déjà consommée par les compilateurs de plan existants et le moteur M1. Le DSL remplace uniquement l'origine de cette représentation (texte déclaratif écrit par un chercheur plutôt que sortie du LLM), pas ce qui la consomme.

## Alternatives rejetées

- **DSL avec interpréteur dédié indépendant** : rejetée — directement contraire à ADR-0010 (un seul moteur canonique), réintroduirait un risque de divergence simulation/exécution.
- **DSL généré uniquement via LLM, sans forme textuelle éditable directement** : rejetée — reviendrait à ne pas résoudre le besoin identifié (permettre à un chercheur d'itérer sans dépendre d'un appel LLM par itération), contraire à SC-9 (réduction de coût par migration).

## Conséquences

- Le format de sortie du compilateur DSL doit rester strictement compatible avec le format déjà accepté par `packages/desk-domain` — toute évolution de ce format est gouvernée par le même processus de versionning de contrat que l'existant (`packages/desk-contracts`).
- Un chercheur peut valider une stratégie DSL directement via le Simulation Engine, sans appel LLM dans la boucle.

## Preuve AS-IS

Compilateurs de plan et moteur M1 confirmés existants dans `packages/desk-domain` (`02` §3) — le DSL cible s'appuie explicitement sur cette base plutôt que de la contourner.
