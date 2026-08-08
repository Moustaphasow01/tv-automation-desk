# 21 — Cutover and GPT-First Decommission

- **Titre** : Bascule de production et sortie du pipeline GPT-first
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : `01` (INV-4, SC-8), ADR-0020
- **Documents supersédés** : aucun
- **Dernière vérification code** : n/a — trajectoire future, pas un constat AS-IS
- **Portée** : architecture cible et gates des Phases 11 (Production Cutover) et 12 (GPT-First Decommission). Pas de détail fichier — ces phases sont trop lointaines et dépendent de l'état du système à l'issue des Phases 1-10.

---

## 1. Principe directeur

Le pipeline GPT-first actuel reste la source de vérité opérationnelle jusqu'à ce que **toutes** les Phases 1 à 9 soient `PASSED` (voir `phase-gates.yaml`) — jamais une bascule anticipée sur la base d'un sous-ensemble de composants prêts (ADR-0020). Le cutover est un événement gouverné, pas une conséquence automatique de l'avancement du développement.

## 2. Phase 11 — Production Cutover

### 2.1 Pré-requis

- **CIBLE REQUISE** : toutes les phases 1-9 marquées `PASSED` dans `phase-gates.yaml`.
- **CIBLE REQUISE** : un exercice de bascule/rollback chronométré, conduit en environnement de simulation (pas en production), avec un temps de rollback mesuré et inférieur au délai maximal fixé par l'opérateur.
- **DÉCISION OPÉRATEUR** : le délai maximal acceptable de rollback (ex. « moins de 15 minutes ») n'est pas fixé par ce dossier — à définir avant l'entrée en Phase 11.

### 2.2 Déroulement recommandé

- **RECOMMANDATION D'ARCHITECTURE** : bascule progressive par flag (`cutover.gpt_first_disabled`, voir `phase-gates.yaml`), jamais un remplacement direct de code en production. La bascule active le nouveau chemin (Live Strategy Runtime → Arbitrage → Execution Gateway) pour un sous-ensemble croissant de décisions, en parallèle du pipeline GPT-first qui continue de tourner en mode d'observation (SHADOW) jusqu'à confiance complète.
- **CIBLE REQUISE** : à tout instant pendant cette phase, désactiver le flag revient instantanément et sans perte au comportement du pipeline GPT-first inchangé.

### 2.3 Critères de sortie de phase

- Le nouveau chemin (Phases 1-9) produit, sur une période d'observation définie par l'opérateur, des décisions au moins aussi bonnes que le pipeline GPT-first sur les mêmes critères de succès (`01` §5-6), sans incident de sûreté (aucune violation des invariants INV-1 à INV-8).
- L'exercice de rollback (§2.1) a été conduit avec succès au moins une fois avant le basculement réel.

## 3. Phase 12 — GPT-First Decommission

### 3.1 Pré-requis

- **CIBLE REQUISE** : la Phase 11 est `PASSED` et le nouveau chemin tourne en production depuis une période d'observation jugée suffisante par l'opérateur (**DÉCISION OPÉRATEUR**, durée non fixée par ce dossier).

### 3.2 Déroulement recommandé

- **RECOMMANDATION D'ARCHITECTURE** : retrait progressif suivant la même discipline expand/contract que les migrations de schéma (ADR-0019) appliquée ici au code plutôt qu'aux données — le pipeline GPT-first est d'abord mis en mode passif (n'exécute plus, reste déployable en urgence), puis retiré définitivement seulement après une nouvelle période d'observation sans besoin de rollback.
- **CIBLE REQUISE (SC-8 de `01`)** : le plan de rollback vers le pipeline legacy reste testé et documenté jusqu'au retrait définitif — pas seulement jusqu'à la mise en mode passif.

### 3.3 Critères de sortie de phase

- Le pipeline GPT-first legacy est retiré, sans perte de capacité de trading mesurée sur les critères de succès de `01`.
- Le plan de rollback a été exercé avec succès en environnement de simulation avant le retrait définitif, dans le délai fixé par l'opérateur.

## 4. Ce que ce chantier ne fait PAS

- Il ne fixe aucune date de cutover — entièrement conditionné par l'atteinte des critères de sortie des phases précédentes, jamais par un calendrier.
- Il ne préjuge pas de la durée d'observation nécessaire avant décommission — décision opérateur explicite à chaque étape.
- Il ne supprime aucune donnée historique produite par le pipeline GPT-first — seul le code d'exécution est retiré, les données restent dans leur table historique (`strategy_id` legacy compris, cohérent avec ADR-0004).
