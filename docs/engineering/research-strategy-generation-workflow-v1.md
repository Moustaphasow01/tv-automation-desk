# Research Strategy Generation Workflow V1 — TD2-501

## Objectif

`TD2-501` définit le chemin contrôlé qui transforme une idée en candidate testable. L’objectif n’est pas encore de lancer automatiquement tout le compute, mais de produire un plan auditable : hypothèse falsifiable, rôles IA, candidate, génome, novelty, mémoire d’échec, transition lifecycle et work items.

## Contrat domaine

Implémentation : `packages/desk-domain/src/research-strategy-generation-workflow-v1.js`.

Exports principaux :

- `buildResearchStrategyGenerationPolicyV1`
- `planResearchStrategyGenerationWorkflowV1`
- `buildResearchStrategyGenerationWorkItemsV1`

## Phases

Phases V1 :

- `INTAKE`
- `HYPOTHESIS_PROTOCOL`
- `ROLE_ASSIGNMENT`
- `CANDIDATE_DRAFT`
- `GENOME_NOVELTY`
- `FAILURE_MEMORY`
- `LIFECYCLE_START`

## Gates

Le workflow vérifie :

- hypothèse falsifiable via `TD2-506` ;
- rôles agents explicites via `TD2-505` ;
- candidate draftée mais non promue ;
- génome/novelty via `TD2-507` ;
- mémoire d’échec via `TD2-508` ;
- transition lifecycle contrôlée via `TD2-510`.

## Décisions

Décisions V1 :

- `READY_FOR_BASELINE`
- `NEEDS_REVISION`
- `BLOCKED_DUPLICATE`
- `BLOCKED_FAILURE_MEMORY`
- `INVALID_IDEA`

`READY_FOR_BASELINE` signifie que la candidate peut passer en `BASELINE_REQUIRED`. Cela ne veut pas dire publication live ou stratégie exécutable.

## Work items IA

Le plan génère des work items par rôle :

- `research_planner` : revue hypothèse, scope dataset, budget ;
- `strategy_builder` : draft DSL, plan déterministe, modèle de risque ;
- `research_reviewer` : novelty, mémoire d’échec, blockers.

Ces work items sont prêts à être mappés vers Agent Runtime sans donner aux agents de droits broker.

## Limites

La V1 reste un workflow de génération. La validation contradictoire complète est couverte par `TD2-502`; la promotion opérateur par `TD2-503`.
