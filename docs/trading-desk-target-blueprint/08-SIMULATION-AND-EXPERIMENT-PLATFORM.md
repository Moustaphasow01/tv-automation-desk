# 08 — Simulation and Experiment Platform

- **Titre** : Plateforme de simulation et registre d'expériences
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : `01`, `03` §8, ADR-0006, ADR-0023
- **Documents supersédés** : aucun
- **Dernière vérification code** : `packages/desk-replay-engine` confirmé réutilisable, voir `02` §5
- **Portée** : architecture cible des Phases 3 (Simulation Engine) et 4 (Experiment Registry). Arborescence indicative, non engagée.

---

## 1. Rôle dans l'architecture cible

Permet de valider une Strategy Version sur données historiques avant toute promotion vers SHADOW/PAPER/LIVE (SC-4 de `01`), avec des résultats reproductibles bit-à-bit (SC-3) et comparables entre eux (Experiment Registry).

## 2. Composants — Simulation Engine (Phase 3)

### 2.1 Dataset Builder

- Réutilise directement les `Dataset` produits par la Data Acquisition Layer (`06`). Aucune logique de construction de dataset dupliquée dans le Simulation Engine lui-même.

### 2.2 Event-Driven Simulator

- **RECOMMANDATION D'ARCHITECTURE** : étend `packages/desk-replay-engine` (déterministe, zéro LLM, ADR-0006) pour rejouer un `Dataset` événement par événement à travers le Canonical Runtime (`07`), produisant les mêmes décisions que produirait le moteur en conditions réelles sur les mêmes données.
- **CIBLE REQUISE** : le simulateur ne doit avoir aucune fuite d'information du futur (« look-ahead ») — le garde anti-look-ahead déjà présent dans le moteur actuel (`02` §3) est directement réutilisé, pas réimplémenté.

### 2.3 Order/Portfolio/Risk Simulator

- Simule l'exécution d'un `Order Intent` (sans jamais contacter un broker réel) et le suivi de portefeuille simulé qui en résulte, en réutilisant les mêmes state machines de Position (`05` §7.2) que la production, en mode simulé.
- **CIBLE REQUISE** : le simulateur d'ordres applique un modèle de slippage/latence configurable et documenté, jamais un remplissage instantané irréaliste par défaut — sans quoi les métriques de performance simulées seraient systématiquement optimistes par rapport au réel.

### 2.4 Metrics Engine

- Calcule les métriques de sortie de phase (win rate, drawdown, ratio de Sharpe/Sortino ou équivalent, nombre de trades — voir `01` §6) à partir des résultats d'un run.
- **CIBLE REQUISE** : les définitions exactes de chaque métrique sont versionnées elles-mêmes (une métrique de « drawdown » calculée différemment entre deux versions de l'outil doit être distinguable).

### 2.5 Run Registry (Phase 3, pas Phase 4 — voir ADR-0023)

- Persiste chaque `Run` (`05` §3.2) avec son `parameters_hash`, sa `reproducibility_seed`, son statut, sa référence vers les métriques produites.
- **CIBLE REQUISE** : deux `Run` avec les mêmes `(strategy_version_id, dataset_id, parameters_hash, reproducibility_seed)` produisent des métriques identiques bit-à-bit — c'est le test qui valide directement SC-3.

## 3. Composants — Experiment Registry (Phase 4)

### 3.1 Experiment

- Regroupe plusieurs `Run` (`05` §3.3) pour comparaison — ex. comparer 5 variantes de paramètres d'une même Strategy Version, ou comparer 2 Strategy Versions différentes sur le même Dataset.
- **RECOMMANDATION D'ARCHITECTURE** : l'Experiment Registry est une couche de requêtage/comparaison au-dessus du Run Registry, pas un nouveau système de persistance des résultats bruts.

### 3.2 Sélection de gagnant

- **DÉCISION OPÉRATEUR** : les critères exacts de sélection d'un `winner_run_id` au sein d'un Experiment (quelle métrique prime, quels seuils minimaux) doivent être définis par l'opérateur avant la Phase 4 — ce dossier propose une métrique composite par défaut (à documenter dans `operator-decisions.yaml`) mais ne l'impose pas.

## 4. Arborescence indicative (non engagée)

```
packages/desk-simulation/
  src/
    dataset-adapter/       # pont vers desk-data (06)
    simulator/               # extension de desk-replay-engine
    order-portfolio-sim/     # simulation d'exécution, sans broker réel
    metrics/                  # Metrics Engine, versionné
    run-registry/             # persistance des Run
  test/

packages/desk-experiments/
  src/
    registry/                # Experiment, comparaison de Run
  test/
```

## 5. Critères de sortie de phase

**Phase 3** : un `Run` complet exécuté de bout en bout (Dataset → simulation → métriques → Run Registry), rejoué une seconde fois avec les mêmes paramètres, produisant des métriques identiques bit-à-bit.

**Phase 4** : un `Experiment` comparant au moins 2 `Run` existants, avec sélection de gagnant selon un critère documenté et approuvé par l'opérateur.

## 6. Relation avec le replay orchestré GPT existant

Rappel explicite (ADR-0006) : le replay orchestré GPT-in-the-loop (`desk-replay-orchestration-algorithms.js`/`desk-replay-service.js`) n'est **pas** une dépendance de ce chantier. Il reste un outil du Research Lab (`09`) pour l'analyse qualitative post-hoc, hors du chemin critique de validation de Strategy Version.
