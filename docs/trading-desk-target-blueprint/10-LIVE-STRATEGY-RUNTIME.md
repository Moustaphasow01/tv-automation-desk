# 10 — Live Strategy Runtime

- **Titre** : Runtime d'exécution en direct des stratégies
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : `01`, `03` §10, `05` §2.3, ADR-0002, ADR-0007
- **Documents supersédés** : aucun
- **Dernière vérification code** : n/a — composant `ABSENT` de l'AS-IS, voir `03` §10
- **Portée** : architecture cible de la Phase 6. Arborescence indicative, non engagée.

---

## 1. Rôle dans l'architecture cible

Le Live Strategy Runtime exécute en continu chaque `Strategy Instance` (`05` §2.3) selon son mode d'exécution (SHADOW/PAPER/LIVE) et son état runtime, en isolant les pannes d'une instance des autres, et en publiant ses décisions sur le Standardized Signal Bus plutôt qu'en les exécutant directement.

## 2. Composants cibles

### 2.1 Instance Supervisor

- Gère le cycle de vie runtime (axe A, `05` §2.3) de chaque `Strategy Instance` : démarrage, pause, arrêt, redémarrage après erreur.
- **CIBLE REQUISE** : une erreur non récupérable (`ERRORED`) sur une instance ne doit jamais interrompre l'exécution des autres instances actives (isolation des pannes, §6 de `01`).

### 2.2 Signal Emitter

- Chaque `Strategy Instance` en mode SHADOW, PAPER ou LIVE calcule ses signaux via le Canonical Runtime (`07`) et les publie comme `Signal` (`05` §5.1) sur le Standardized Signal Bus.
- **CIBLE REQUISE** : le calcul de signal est **identique** quel que soit le mode d'exécution (SHADOW calcule exactement comme LIVE) — seule la suite donnée au signal diffère selon le mode. C'est ce qui permet à SHADOW de servir de validation continue sans risque.

### 2.3 Mode Gate (garde technique PAPER→LIVE)

- Implémente la garde technique exigée par ADR-0007 : aucune fonction du Live Strategy Runtime ne peut faire transitionner une instance de PAPER à LIVE sans un jeton d'approbation opérateur explicite, horodaté et audité.
- **CIBLE REQUISE** : un test négatif dédié doit prouver qu'aucune combinaison de métriques favorables, seule, ne peut déclencher cette transition automatiquement.

## 3. Standardized Signal Bus — contrat

- **CIBLE REQUISE** : un `Signal` porte au minimum `strategy_instance_id`, `instrument`, `direction`, `confidence`, `generated_at`, `expires_at`, `correlation_id` (`05` §5.1).
- **RECOMMANDATION D'ARCHITECTURE** : le Signal Bus est implémenté au-dessus du transport Event Envelope existant (`14`), pas comme un nouveau canal de transport séparé — cohérent avec ADR-0012.
- Un `Signal` émis en mode SHADOW ou PAPER porte l'information de son mode d'origine, permettant au Portfolio Arbitration Engine (`11`) de traiter différemment les signaux SHADOW (jamais consolidés vers une décision réelle), PAPER (consolidés vers un compte simulé), et LIVE (seuls candidats à l'exécution réelle).

## 4. Relation avec l'AI Context Gate

- L'AI Context Gate (`12`) opère en parallèle du Live Strategy Runtime, produisant des `AI Context Advisory` qui accompagnent un `Signal` sans jamais le remplacer ni forcer son exécution — voir ADR-0009. Le Live Strategy Runtime ne consomme jamais directement un avis de l'AI Context Gate pour décider d'émettre ou non un signal ; cette consommation se fait exclusivement en aval, au niveau du Portfolio Arbitration Engine.

## 5. Arborescence indicative (non engagée)

```
packages/desk-live-runtime/
  src/
    supervisor/          # Instance Supervisor, isolation des pannes
    signal-emitter/        # invoque le Canonical Runtime (07), publie sur le Signal Bus
    mode-gate/             # garde technique PAPER->LIVE (ADR-0007)
  test/
    mode-gate.negative.test.js   # preuve qu'aucune promotion auto n'est possible
```

## 6. Critères de sortie de phase (Phase 6)

- Au moins une `Strategy Instance` tournant en SHADOW, calculant des signaux en continu sans jamais produire d'action réelle, observable via dashboard opérateur (§6 de `01`).
- Une `Strategy Instance` en PAPER exécutant sur un compte simulé, avec isolation des pannes prouvée par test (arrêt forcé d'une instance sans effet sur une deuxième instance active).
- Le test négatif de la garde PAPER→LIVE (§2.3) passant, sans exception.

## 7. Ce que ce chantier ne fait PAS

- Il n'implémente aucune logique d'arbitrage multi-stratégies ni de gestion de risque de portefeuille — ces responsabilités appartiennent exclusivement à `11-PORTFOLIO-ARBITRATION-GLOBAL-RISK-AND-NETTING.md`, positionné en verrou après cette phase (ADR-0008).
- Il ne contacte jamais directement un broker réel — voir `04` §2, la couche Runtime s'arrête au Signal Bus.
