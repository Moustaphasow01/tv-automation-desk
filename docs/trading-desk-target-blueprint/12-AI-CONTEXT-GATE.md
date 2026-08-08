# 12 — AI Context Gate

- **Titre** : Porte de contexte IA — avis encadré, jamais décisionnel
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : `01` (INV-1, SC-6), `03` §12, ADR-0009
- **Documents supersédés** : aucun
- **Dernière vérification code** : n/a — composant `ABSENT` de l'AS-IS, voir `03` §12
- **Portée** : architecture cible de la Phase 8. C'est l'un des composants les plus sensibles du dossier au regard des invariants de sûreté — ce document est délibérément détaillé sur ses limites strictes.

---

## 1. Rôle dans l'architecture cible

L'AI Context Gate est le point d'entrée encadré par lequel un LLM peut apporter un avis contextuel (lecture de nouvelles, sentiment de marché, analyse qualitative) sur un `Signal` ou une position existante — **sans jamais** disposer du pouvoir de décider seul d'une action réelle. C'est la matérialisation directe de l'invariant INV-1 de `01` pour ce cas d'usage précis.

## 2. Ce que l'AI Context Gate PEUT faire

- **CIBLE REQUISE** : recevoir en entrée un `Signal` (`05` §5.1) ou une référence de position existante, accompagné du contexte pertinent (résumé de marché, actualités récentes, etc.).
- **CIBLE REQUISE** : produire en sortie une `AI Context Advisory` (`05` §5.2) avec exactement une valeur parmi `TAKE`/`TAKE_REDUCED`/`WAIT`/`REJECT`, une justification textuelle (`rationale`), une référence au modèle utilisé (`model_ref`), un horodatage.
- **CIBLE REQUISE** : cette `AI Context Advisory` est journalisée et consultable par l'opérateur, ainsi que consommée en **lecture seule** par le Portfolio Arbitration Engine (`11`).

## 3. Ce que l'AI Context Gate NE PEUT PAS faire

- **CIBLE REQUISE (garde structurelle, pas seulement procédurale)** : aucune relation de données, aucune fonction, aucun chemin de code ne permet à une `AI Context Advisory` de produire directement un `Order Intent`, une `Candidate Allocation`, ou toute autre entité de la couche Arbitrage ou Exécution (`04` §2).
- **CIBLE REQUISE** : une valeur `REJECT` de l'AI Context Gate n'est **pas** un veto bloquant au sens fort dans la version initiale (voir ADR-0009, alternative rejetée) — elle est un signal fort transmis au Portfolio Arbitration Engine, qui reste libre de sa politique de consommation (documentée en `11` §2.2), elle-même toujours soumise au Global Risk Engine.
- **CIBLE REQUISE** : l'AI Context Gate n'a aucun accès en écriture à un compte broker réel, à un identifiant, ou à une configuration d'exécution — cohérent avec `15` §1.2.

## 4. Preuve d'isolation exigée avant activation

- **CIBLE REQUISE** : avant toute activation de l'AI Context Gate en Phase 8, un test d'intégration dédié doit prouver qu'aucune combinaison de réponses de l'AI Context Gate (y compris des réponses malformées, contradictoires, ou répétées en boucle) ne peut, seule, produire un effet sur un compte réel — ce test fait partie des critères de sortie de phase (§6) et doit être listé explicitement dans `18-TEST-AND-VALIDATION-STRATEGY.md`.

## 5. Relation avec le Research Lab (`09`)

- **RECOMMANDATION D'ARCHITECTURE** : l'AI Context Gate peut être implémenté comme un `type` d'`Agent` supplémentaire au sein du Multi-Agent Runtime généralisé (`09`), réutilisant la même infrastructure d'invocation Codex CLI encapsulée que les 3 pipelines migrés — pas un mécanisme d'invocation LLM séparé et non contrôlé.

## 6. Critères de sortie de phase (Phase 8)

- Au moins un scénario de bout en bout où l'AI Context Gate produit une `AI Context Advisory` `REJECT` sur un `Signal` LIVE, et où le test d'intégration (§4) démontre qu'aucun `Order Intent` n'a pu en résulter directement.
- Le tableau de bord opérateur (`15` §2.2) affiche les `AI Context Advisory` récentes de façon consultable, distinctement des décisions réelles.

## 7. Décisions ouvertes

- **DÉCISION OPÉRATEUR** : la politique exacte de consommation d'une `AI Context Advisory` par le Portfolio Arbitration Engine (ignorée, pondérée, ou bloquante après une période d'observation prouvée) reste à l'appréciation de l'opérateur, à trancher avant l'activation de la Phase 8 — ce dossier ne fixe qu'un défaut sûr (consultative, jamais bloquante au lancement).
