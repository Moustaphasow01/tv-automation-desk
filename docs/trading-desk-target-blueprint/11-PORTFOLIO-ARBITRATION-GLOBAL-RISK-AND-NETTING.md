# 11 — Portfolio Arbitration, Global Risk Engine and Broker Netting

- **Titre** : Arbitrage de portefeuille, risque global et netting broker
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : `01`, `03` §11, ADR-0008, errata de sûreté (points sur le positionnement en verrou)
- **Documents supersédés** : aucun
- **Dernière vérification code** : n/a — composants `ABSENT` de l'AS-IS ; réutilise `evaluateBrokerPolicy` en aval sans le modifier (`02` §3, §6)
- **Portée** : architecture cible de la Phase 7, positionnée explicitement comme **verrou bloquant** avant toute activation réelle multi-stratégie (ADR-0008). C'est le chantier que le donneur d'ordre a demandé de détailler avec un contenu spécifique avant toute activation multi-stratégie réelle.

---

## 1. Pourquoi ce chantier est un verrou, pas une amélioration optionnelle

Rappel du raisonnement (ADR-0008, §16 de `03`) : sans consolidation de portefeuille, deux `Strategy Instance` individuellement conformes à leurs propres limites de risque peuvent, ensemble, dépasser une limite de risque de portefeuille qu'aucune n'aurait dépassée seule. C'est un mode de défaillance qui n'est **pas détecté** par le moteur `evaluateBrokerPolicy` existant, qui évalue chaque décision individuellement.

## 2. Portfolio Arbitration Engine

### 2.1 Entrée

- Consomme les `Signal` (`05` §5.1) publiés en mode LIVE par le Live Strategy Runtime (`10`) sur le Standardized Signal Bus, ainsi que les `AI Context Advisory` associées (`12`), en lecture seule.

### 2.2 Traitement

- **CIBLE REQUISE** : agrège tous les `Signal` LIVE actifs par instrument, résout les conflits directionnels entre stratégies (deux stratégies signalant des directions opposées sur le même instrument) selon une politique explicite et documentée — **DÉCISION OPÉRATEUR** : la politique par défaut proposée est la neutralisation (les signaux opposés s'annulent partiellement) plutôt que la priorité à la stratégie la plus ancienne ou la plus performante, sauf configuration contraire de l'opérateur.
- Produit une `Candidate Allocation` par instrument (`05` §6.1).

### 2.3 Sortie

- `Candidate Allocation` transmise au Global Risk Engine — jamais directement à l'Execution Gateway.

## 3. Global Risk Engine

### 3.1 Limites appliquées

- **CIBLE REQUISE**, contenu minimal exigé :
  - Exposition nette maximale par instrument (tous comptes/stratégies confondus).
  - Exposition nette maximale par classe d'actif ou secteur (si applicable).
  - Perte maximale journalière/hebdomadaire consolidée du portefeuille (kill-switch de portefeuille, distinct de tout kill-switch par stratégie individuelle déjà existant).
  - Nombre maximal de positions simultanées ouvertes, tous comptes confondus.
- **DÉCISION OPÉRATEUR** : les valeurs numériques exactes de ces limites (voir `operator-decisions.yaml`, entrée dédiée à créer à l'entrée de Phase 7) ne sont pas fixées par ce dossier — elles dépendent du capital réel engagé et de l'appétit au risque de l'opérateur.

### 3.2 Comportement en cas de dépassement

- **CIBLE REQUISE** : le Global Risk Engine réduit (`approved_size < proposed_size`) ou annule (`approved_size = 0`) une `Candidate Allocation` plutôt que de rejeter l'ensemble du cycle — cohérent avec le principe fail-closed appliqué au niveau le plus fin possible (réduire la taille plutôt que bloquer tout le portefeuille).
- Produit une `Risk Decision` (`05` §6.2) pour chaque `Candidate Allocation` traitée, y compris celles réduites à zéro — jamais de silence sur un rejet.

## 4. Broker Netting Engine

### 4.1 Rôle

- Résout, à partir de l'ensemble des `Risk Decision` approuvées, la **position nette cible** par instrument et par compte broker réel — c'est la sortie qui remplace directement, de façon prouvée par test, l'agrégation actuelle buguée (`03` §5, ADR-0003).

### 4.2 Relation avec le correctif de la Phase 0

- **CIBLE REQUISE** : le Broker Netting Engine réutilise la clé d'agrégation prouvée par test lors du Ticket 0.4 (`17`) comme fondation de son modèle de données `Target Position` (`05` §6.3) — pas une nouvelle clé introduite indépendamment en Phase 7.

## 5. Diagramme de flux (rappel de `04` §1, détaillé ici)

```mermaid
flowchart LR
    S1["Signal (Strategy Instance A, LIVE)"] --> PAE["Portfolio Arbitration Engine"]
    S2["Signal (Strategy Instance B, LIVE)"] --> PAE
    ADV["AI Context Advisory (lecture seule)"] -.avis seulement.-> PAE
    PAE --> CA["Candidate Allocation"]
    CA --> GRE["Global Risk Engine"]
    GRE --> RD["Risk Decision (approved_size <= proposed_size)"]
    RD --> BNE["Broker Netting Engine"]
    BNE --> TP["Target Position (clé d'agrégation prouvée, ADR-0003)"]
    TP --> EG["Execution Gateway (13)"]
```

## 6. Arborescence indicative (non engagée)

```
packages/desk-portfolio-risk/
  src/
    arbitration/         # Portfolio Arbitration Engine
    global-risk/           # Global Risk Engine, limites configurables
    netting/                # Broker Netting Engine, réutilise la clé ADR-0003
  test/
    multi-strategy-limit.test.js   # preuve qu'une limite de portefeuille bloque 2 stratégies conformes individuellement
```

## 7. Critères de sortie de phase (Phase 7)

- Test d'intégration : deux `Strategy Instance` LIVE simultanées, chacune conforme à ses propres limites individuelles, ne peuvent collectivement dépasser l'exposition nette de portefeuille configurée (SC-5 de `01`, preuve directe).
- Le Broker Netting Engine produit une `Target Position` correcte sous accès concurrent multi-instance, sans collision (réutilisant la preuve du Ticket 0.4).
- Aucune régression sur `evaluateBrokerPolicy` et ses gates existants — ce moteur reste invoqué en aval, inchangé (`04` §4).

## 8. Ce que ce chantier ne fait PAS

- Il ne remplace pas `evaluateBrokerPolicy` — il ajoute une étape de consolidation **avant** que cette fonction ne soit invoquée avec l'`Order Intent` final.
- Il n'autorise aucune activation réelle multi-stratégie tant que les critères de sortie ci-dessus ne sont pas tous satisfaits — voir `phase-gates.yaml`.
