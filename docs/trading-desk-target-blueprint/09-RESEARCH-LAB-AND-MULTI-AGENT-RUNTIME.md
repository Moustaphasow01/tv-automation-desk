# 09 — Research Lab and Multi-Agent Runtime

- **Titre** : Laboratoire de recherche et runtime multi-agent généralisé
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : `01`, `02` §4, `03` §9, ADR-0013, ADR-0014, ADR-0015
- **Documents supersédés** : aucun
- **Dernière vérification code** : `codex-exec-adapter.js`, `run_desk_ai_worker.mjs` — lus intégralement, voir `02` §4, §9
- **Portée** : architecture cible des Phases 4 (volet Research Lab) et 5 (Multi-Agent Runtime généralisé). Détaille la migration des 3 pipelines LLM existants avec leurs métriques de valeur ajoutée, comme exigé explicitement par le donneur d'ordre.

---

## 1. Rôle dans l'architecture cible

Ce chantier généralise l'infrastructure d'orchestration LLM existante (aujourd'hui 3 intégrations point-à-point avec `CodexExecAdapter`) en un runtime multi-agent réutilisable, sans changer la valeur métier produite par chacun des 3 pipelines identifiés.

## 2. Entités du Multi-Agent Runtime (rappel, détail en `05` §4)

Agent, Mission, Conversation, Task, Batch, Event, Lease, Lock. Voir `05-DOMAIN-MODEL-AND-STATE-MACHINES.md` §4 pour les machines à états complètes. `CodexExecAdapter` reste le mécanisme d'invocation sous-jacent (ADR-0013) — il est encapsulé, pas remplacé.

## 3. Migration des 3 pipelines LLM existants

### 3.1 Pipeline « Analyse de marché horaire »

- **AS-IS** : invocation directe périodique de `CodexExecAdapter.analyze()`, produisant un plan typé consommé par le moteur déterministe. **CONFIRMÉ**.
- **CIBLE** : devient un `Agent` de type `market-analysis`, invoqué via une `Mission` créée par un scheduler (réutilisant le mécanisme de réveil existant, `run_desk_ai_worker.mjs`). Politique de batch : `ALL` (une analyse de marché incomplète ne doit pas être utilisée partiellement — contrairement au moniteur de thèse, voir §3.2) — **RECOMMANDATION D'ARCHITECTURE**, à confirmer avec l'opérateur si un mode dégradé partiel est acceptable.
- **Métrique de valeur ajoutée** : coût en tokens par analyse produite, stabilité du format de sortie (taux de plans typés valides sans retry), latence bout-en-bout. Comparée avant/après migration sur un échantillon d'au moins 20 cycles.

### 3.2 Pipeline « Moniteur de thèse horaire »

- **AS-IS** : invocation directe, haute fréquence. **CONFIRMÉ** (contrat `DeskHourlyThesisMonitorContract` existant, `02` §3).
- **CIBLE** : devient un `Agent` de type `thesis-monitor`. Politique de batch : `TIMEOUT_WITH_PARTIAL_RESULTS` (ADR-0014) — sa fréquence élevée justifie de préférer un résultat partiel à un blocage.
- **Métrique de valeur ajoutée** : taux de cycles complétés dans le budget de temps imparti (avant migration : mesuré implicitement par les timeouts actuels s'ils existent ; après migration : mesuré explicitement par le taux de `TIMEOUT_WITH_PARTIAL_RESULTS` déclenché), coût en tokens par thèse réévaluée.

### 3.3 Pipeline « Orchestration de replay GPT-in-the-loop »

- **AS-IS** : invocation par étape rejouée, coût proportionnel au nombre d'étapes (`02` §5). **CONFIRMÉ**.
- **CIBLE** : devient un `Agent` de type `replay-orchestrator`, explicitement positionné comme outil du Research Lab pour analyse qualitative post-hoc — **pas** migré vers le Simulation Engine (voir ADR-0006, `08` §6). Politique de batch : `QUORUM` ou `ANY` selon le nombre d'épisodes analysés en parallèle — **À REVALIDER À L'ENTRÉE DE PHASE** selon le volume d'usage réel observé.
- **Métrique de valeur ajoutée** : ce pipeline n'a pas vocation à réduire son coût par appel (il reste un outil d'analyse profonde, pas un pipeline haute fréquence) — sa métrique de valeur est plutôt la traçabilité gagnée (chaque épisode analysé référence désormais un `correlation_id` permettant de relier l'analyse à la Mission et à l'Event Envelope, ce qui n'existe pas dans l'AS-IS).

## 4. Ordre de migration recommandé

**RECOMMANDATION D'ARCHITECTURE** : migrer d'abord le pipeline le moins critique en fréquence et en impact (orchestration de replay, §3.3, déjà hors du chemin réel) pour valider l'infrastructure du Multi-Agent Runtime à faible risque, puis le moniteur de thèse (§3.2), puis l'analyse de marché (§3.1) en dernier, car c'est celui dont la sortie alimente le plus directement des décisions ensuite évaluées par le moteur déterministe.

## 5. Arborescence indicative (non engagée)

```
packages/desk-agent-runtime/
  src/
    entities/          # Agent, Mission, Conversation, Task, Batch
    events/             # Event Envelope, correlation_id/causation_id
    coordination/        # Lease, Lock (généralisation de pg_try_advisory_lock)
    adapters/
      codex-adapter/     # encapsule codex-exec-adapter.js existant, inchangé
  test/
```

## 6. Critères de sortie de phase

**Phase 4 (Research Lab, volet outillage)** : le pipeline « orchestration de replay » migré et fonctionnellement équivalent (mêmes résultats sur un scénario de test fixé), avec traçabilité `correlation_id` désormais présente.

**Phase 5 (Multi-Agent Runtime généralisé)** : les 3 pipelines migrés, chacun avec sa métrique de valeur ajoutée mesurée avant/après, aucune régression de résultat métier observée sur un jeu de scénarios de non-régression dédié par pipeline.

## 7. Ce que ce chantier ne fait PAS

- Il ne modifie pas `codex-exec-adapter.js` dans son mécanisme d'invocation (sandbox, allowlist, `resume <thread_id>`) — il l'encapsule.
- Il ne donne à aucun `Agent` la capacité de produire directement un `Order Intent` — cette frontière reste strictement gardée par les couches Arbitrage et Exécution (`04` §2), cohérent avec INV-1 de `01`.
