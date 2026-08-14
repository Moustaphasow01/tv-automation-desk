# Audit technique, fonctionnel et architectural du Trading Desk — index

Date : 2026-08-07. Mode : lecture seule, aucune modification de code fonctionnel,
aucune connexion broker réelle, aucun ordre déclenché.

## Pourquoi ce dossier existe

La mission confiée était : auditer l'existant en profondeur pour préparer le
terrain à une future intervention de Codex, sans rien implémenter des
évolutions décrites dans un document directeur (« plan directeur » ci-après —
la vision « architecture data-driven, multi-agent, scalable et event-driven »
fournie en fin de mission). Le plan directeur devait servir de boussole
stratégique, pas de description fiable de l'état actuel du code.

## Découverte préalable — un audit de convergence existe déjà, daté d'aujourd'hui

Avant d'écrire quoi que ce soit, l'exploration a trouvé
[`docs/TARGET_ARCHITECTURE_CONVERGENCE_AUDIT_2026-08-07.md`](../TARGET_ARCHITECTURE_CONVERGENCE_AUDIT_2026-08-07.md)
(418 lignes, écrit le jour même à 07:51, avant le début de cette session
d'audit). Ce document audite déjà le dépôt au regard du même plan directeur,
avec citations `fichier:ligne`, interrogation directe de la base de
production sur le VPS, et une conclusion centrale : **le desk a déjà franchi
la séparation « LLM propose un plan typé » / « moteur déterministe évalue et
exécute »** — le plan directeur sous-estime la maturité déterministe déjà
présente.

Conformément à la consigne « ne pas se fier aux anciens documents, comparer
systématiquement la documentation au comportement réel du code », ce document
existant a été traité comme une hypothèse à vérifier, pas comme une vérité
acquise. Cinq agents d'exploration indépendants ont été dispatchés en
parallèle sur des périmètres disjoints (inventaire backend, moteur
déterministe/contrats, service Windows/réveil des workers, chemin d'exécution
NinjaTrader, moteur de replay/backtest + couche de données), plus une lecture
directe de plusieurs fichiers pivots par l'auditeur lui-même
(`codex-exec-adapter.js`, `run_desk_ai_worker.mjs`).

**Résultat de la vérification : aucune divergence significative trouvée.**
Chaque affirmation testable de l'audit du 07:51 (mécanisme Codex CLI en
sous-processus, LISTEN/NOTIFY Postgres, contrat `DeskDeterministicExecutionPolicy`,
absence de `PickMyTrade`/`ExecutionGateway`, protection après fill non
vérifiée, réconciliation jamais déclenchée, verrou de version de stratégie
unique) a été retrouvée indépendamment, avec les mêmes fichiers et parfois les
mêmes numéros de ligne. Ce dossier **s'appuie donc sur cet audit existant au
lieu de le dupliquer**, l'étend là où il est moins détaillé (inventaire complet
des services/outils MCP, schéma Postgres table par table, distinction précise
entre les deux mécanismes de « replay »), et fournit le livrable qui manquait
explicitement à la mission : un **plan d'évolution séquencé, jusqu'au niveau
ticket**, avec dépendances et critères d'acceptation.

## Divergences documentation ↔ code trouvées

1. **Le plan directeur lui-même (prémisse §1.1)** décrit une architecture
   antérieure au cutover « Deterministic Strategy V5.1 » du 2026-08-01 : il
   suppose que tout le déterminisme reste à construire. Le code montre un
   moteur déterministe substantiel déjà en place (catalogue de 11 prédicats /
   12 hard gates / 10 soft gates, compilateurs de plan, moteur M1, garde
   anti-look-ahead). **CONFIRMÉ** — voir `01-CARTOGRAPHIE-ET-FLUX.md` §2.
2. **`docs/archive/2026-07-15/AUDIT_ARCHITECTURE_NETTOYAGE_2026-07-15.md`**
   (un audit antérieur, conservé en archive) décrit une architecture GCP/
   Firebase avec un moteur Python legacy (`committee_v2`, `scanner/`) tournant
   encore en shadow. **Cet état n'existe plus** : Firebase/Firestore a été
   entièrement retiré du runtime applicatif (test de régression dédié,
   `mcp_gpt_desk/test/document_collections.test.js:25-32`, qui fait échouer le
   build si du code Firebase est réintroduit), confirmé par
   `docs/MIGRATION_OVH_2026-07-15.md`. Le document d'archive est correctement
   étiqueté comme obsolète dans son propre en-tête ; aucune action requise,
   simple confirmation que la bascule a eu lieu.
3. **La documentation runtime la plus fraîche** (`docs/CODEX_WINDOWS_AI_WORKERS_RUNBOOK.md`,
   `docs/DETERMINISTIC_STRATEGY_V5_1_CUTOVER_2026-08-01.md`) décrit un système
   sous gel volontaire (`ENGINE_V5_VALIDATION_HOLD`) depuis le 2026-08-01, avec
   les workers IA et les lanes LIVE/Replay arrêtés par défaut. **Ceci n'est pas
   une divergence** mais un état opérationnel daté à vérifier avant toute
   décision — le statut exact du hold (levé ou non, quelles lanes actives) doit
   être confirmé auprès de l'opérateur avant de planifier quoi que ce soit qui
   suppose un service actif.

## Méthode appliquée

- Code et schéma comme source de vérité ; documentation comme hypothèse à
  vérifier, jamais comme preuve suffisante seule.
- Statuts utilisés pour chaque constat : **CONFIRMÉ** (démontré par le code),
  **INFÉRÉ** (déduction logique non garantie), **INCERTAIN** (information
  incomplète ou contradictoire), **ABSENT** (recherché, non trouvé).
- Citations `fichier:ligne` systématiques. Aucun comportement n'a été inventé
  pour combler une zone inconnue — les zones inconnues sont marquées comme
  telles.
- Cinq agents d'exploration indépendants ont couvert : inventaire complet du
  backend `mcp_gpt_desk/` ; moteur déterministe et système de contrats ;
  mécanisme de service Windows et réveil des workers ; chemin d'exécution
  NinjaTrader ; moteur de replay/backtest et couche de données. Chaque agent a
  travaillé sans connaissance des résultats des autres, ce qui permet une
  triangulation : les points où plusieurs agents convergent indépendamment
  sur le même fichier/ligne sont rapportés avec un niveau de confiance
  particulièrement élevé.
- Aucune commande nécessitant des identifiants réels, une connexion broker ou
  un environnement de production n'a été exécutée. Là où une vérification
  aurait nécessité cela (ex. interroger directement le VPS), la limitation est
  documentée plutôt que contournée — sauf pour les faits déjà vérifiés sur le
  VPS par l'audit du 07:51 lui-même (ex. dernière bougie capturée,
  dimensionnement machine), repris ici par citation avec attribution.

## Sommaire des documents

- [`01-CARTOGRAPHIE-ET-FLUX.md`](01-CARTOGRAPHIE-ET-FLUX.md) — cartographie
  complète des composants, des trois flux principaux (analyse marché,
  réveil des workers, exécution broker), inventaire des services Windows,
  des outils MCP, du schéma Postgres, des contrats.
- [`02-REPONSES-SECTION-31.md`](02-REPONSES-SECTION-31.md) — réponses
  directes aux 27 questions du plan directeur, avec statut et citation pour
  chacune.
- [`03-PLAN-EVOLUTION.md`](03-PLAN-EVOLUTION.md) — le plan d'évolution
  concret, séquencé, jusqu'au niveau ticket, avec dépendances et critères
  d'acceptation.
- [`04-ADDENDUM-PASSATION.md`](04-ADDENDUM-PASSATION.md) — addendum de
  passation (2026-08-07, validé comme base de travail) : correction de la
  nature d'`ACTIVE_STRATEGY_RUNTIME_VERSIONS` (Runtime Contract Bundle, pas
  une stratégie métier — annule et remplace l'ancien Ticket 1.3 du plan
  ci-dessus), Phase -1 de baseline, révision du ticket de collision `Map`,
  nouveaux chantiers (Run Registry, Live Strategy Runtime, migration du
  rôle du LLM, Portfolio Arbitration en verrou, Data Acquisition), registre
  des risques, ADR ouverts, graphe de dépendances.
- [`05-CODEX-HANDOFF.md`](05-CODEX-HANDOFF.md) — le point d'entrée
  opérationnel final, limité aux Phases -1, 0 et 1 : ordre exact des
  tickets, fichiers concernés et à ne pas toucher, tests à écrire avant
  changement, critères de passage, risques, rollback, décisions opérateur
  bloquantes. **C'est le livrable principal pour démarrer.**
