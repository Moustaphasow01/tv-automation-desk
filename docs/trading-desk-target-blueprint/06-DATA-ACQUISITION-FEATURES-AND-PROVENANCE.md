# 06 — Data Acquisition, Feature Engine and Provenance

- **Titre** : Acquisition des données, moteur de features, et provenance
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : `01`, `03` §6, ADR-0022
- **Documents supersédés** : aucun
- **Dernière vérification code** : voir `02` — absence confirmée de composant équivalent dans l'AS-IS
- **Portée** : architecture cible du chantier de Phase 2. Propose une arborescence indicative, pas engagée (voir règle `00` §7) ; à revalider à l'entrée de phase.

---

## 1. Rôle dans l'architecture cible

Data Acquisition & Provenance est le socle sur lequel repose la reproductibilité du Simulation Engine (Phase 3, SC-3 de `01`) et la cohérence des features consommées à la fois en simulation et en Live Strategy Runtime (Phase 6). Sans cette couche, deux runs identiques en apparence pourraient silencieusement consommer des données différentes.

## 2. Composants cibles

### 2.1 Data Source Registry

- Modélise chaque source de données (flux de marché, données alternatives, calendrier économique) comme une entité `Data Source` (`05` §8, entité #10) avec statut `ACTIVE`/`DEPRECATED`.
- **CIBLE REQUISE** : chaque source déclare son format, sa fréquence, sa fiabilité attendue (SLA de fraîcheur des données).

### 2.2 Ingestion Layer

- Produit des `Ingestion Batch` (`05` §8, entité #11) horodatés, chacun référençant sa `Data Source`, l'horodatage d'ingestion, et un hash de provenance du contenu ingéré.
- **RECOMMANDATION D'ARCHITECTURE** : l'ingestion reste un processus asynchrone découplé de la consommation — un Dataset de simulation ne lit jamais directement un flux live, il lit des `Ingestion Batch` déjà persistés et scellés.

### 2.3 Dataset Builder

- Assemble un ou plusieurs `Ingestion Batch` en un `Dataset` (`05` §3.1) figé, avec `provenance_hash` calculé sur l'ensemble, `time_range`, `schema_version`.
- **CIBLE REQUISE** : un `Dataset` une fois `READY` est immuable — toute correction de données produit un nouveau `Dataset`, jamais une édition en place (cohérent avec la discipline de contrats scellés déjà en usage, ADR-0025).

### 2.4 Feature Engine

- Calcule des features dérivées (indicateurs techniques, agrégats) à partir d'un `Dataset` ou d'un flux live, de façon **versionnée** : chaque `Feature Definition` (`05` §8, entité #8) a son propre cycle de version, analogue à celui d'une Strategy Version.
- **CIBLE REQUISE** : le même code de calcul de feature doit être invocable en mode simulation (sur un `Dataset` figé) et en mode live (sur un flux courant), garantissant qu'une feature calculée en backtest a la même définition qu'en production — extension directe du principe d'ADR-0010 (moteur canonique partagé) au calcul de features.
- **À REVALIDER À L'ENTRÉE DE PHASE** : le périmètre exact des features à migrer en premier (probablement `atr_14` et équivalents déjà utilisés par le moteur actuel, voir §11 de l'addendum de passation sur la contrainte de versionning `atr_14`/hash) doit être revérifié dans le code au moment de démarrer la Phase 2, car il peut avoir évolué depuis cet audit.

## 3. Ce qui est réutilisé (pas de duplication)

- Le calcul de features déjà implicite dans le moteur déterministe actuel (ex. `atr_14`) n'est pas dupliqué : la Phase 2 l'extrait dans le Feature Engine formalisé, avec le même résultat numérique, validé par test de non-régression comparant l'ancien et le nouveau calcul sur un jeu de données identique.

## 4. Arborescence indicative (non engagée)

```
packages/desk-data/
  src/
    sources/           # un module par Data Source
    ingestion/          # Ingestion Batch, scellement, hash de provenance
    datasets/           # Dataset Builder
    features/           # Feature Definition, calcul versionné
  test/
```

**À REVALIDER À L'ENTRÉE DE PHASE** : ce chemin est une proposition de nommage cohérente avec la convention `packages/desk-*` déjà en usage (`desk-domain`, `desk-contracts`, `desk-replay-engine`), pas un engagement — l'agent qui démarre la Phase 2 doit vérifier qu'aucun chemin conflictuel n'a été introduit entre-temps.

## 5. Critères de sortie de phase (Phase 2)

- Au moins une source de données réelle ingérée avec provenance tracée de bout en bout.
- Un `Dataset` reproductible : reconstruire deux fois le même `Dataset` à partir des mêmes `Ingestion Batch` produit le même `provenance_hash`.
- Au moins une `Feature Definition` migrée et validée par test de non-régression contre son équivalent actuel dans le moteur déterministe.

## 6. Risques spécifiques

Voir `20-RISK-REGISTER.md` pour l'entrée dédiée : risque de dérive silencieuse entre le calcul de feature en simulation et en live si le Feature Engine n'est pas strictement partagé (mitigé par le test de non-régression exigé en §5).
