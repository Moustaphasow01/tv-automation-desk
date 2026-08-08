# ADR-0013 — Les 3 pipelines LLM existants migrent vers un Multi-Agent Runtime générique sans perte de valeur métier

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : SC-9 (`01` §5)

## Contexte

Trois pipelines invoquant le LLM ont été confirmés dans l'AS-IS (`02` §4) : analyse de marché horaire, moniteur de thèse, orchestration de replay. Chacun est actuellement un appel point-à-point direct à `CodexExecAdapter`, sans registre générique d'agents/missions/tâches. Le plan directeur demande explicitement une migration du rôle du LLM vers une architecture multi-agent généralisée, avec des métriques de valeur ajoutée par pipeline migré.

## Décision

Chacun des 3 pipelines devient un `type` d'`Agent` (`05-DOMAIN-MODEL-AND-STATE-MACHINES.md` §4.1) dans le Multi-Agent Runtime générique, exécuté via `Mission`/`Task`/`Batch`. La logique métier de chaque pipeline (ce qu'il analyse, ce qu'il produit) est préservée à l'identique dans un premier temps — seule l'infrastructure d'orchestration (invocation, suivi, retry, traçabilité) migre. La migration se fait pipeline par pipeline, jamais en big-bang, avec mesure de coût/valeur avant/après pour chacun (`09-RESEARCH-LAB-AND-MULTI-AGENT-RUNTIME.md`).

## Alternatives rejetées

- **Migrer les 3 pipelines simultanément en un seul ticket** : rejetée — empêcherait d'isoler une régression à un pipeline spécifique, et rendrait la mesure de valeur ajoutée par pipeline (exigée par le plan directeur) impossible à établir proprement.
- **Réécrire la logique métier de chaque pipeline pendant la migration d'infrastructure** : rejetée — mélangerait changement d'infrastructure et changement de comportement métier dans un même changement, rendant tout problème post-migration ambigu quant à sa cause (YAGNI/étape unique, cohérent avec la méthode de `17`).

## Conséquences

- `09-RESEARCH-LAB-AND-MULTI-AGENT-RUNTIME.md` détaille, pour chacun des 3 pipelines, son état AS-IS, sa cible de migration, et sa métrique de valeur ajoutée spécifique.
- `CodexExecAdapter` (`codex-exec-adapter.js`) reste le mécanisme d'invocation Codex sous-jacent — il est encapsulé par le Multi-Agent Runtime, pas remplacé.

## Preuve AS-IS

3 pipelines confirmés par lecture directe et audit croisé (`02` §4) ; mécanisme d'invocation `CodexExecAdapter` lu intégralement (`codex-exec-adapter.js`).
