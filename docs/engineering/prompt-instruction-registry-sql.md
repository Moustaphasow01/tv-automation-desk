# Prompt & Instruction Registry SQL

> Ticket : `TD2-PRM-002`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

Le schéma PostgreSQL du Prompt & Instruction Registry rend les prompts opérationnels durables, versionnés, composables et auditables.

Migration :

- `infra/postgres/init/036_prompt_instruction_registry.sql`.

## Tables

- `prompt_definitions` : identité métier stable du prompt.
- `prompt_versions` : texte/version immuable et hashée.
- `instruction_definitions` : identité métier des instructions réutilisables.
- `instruction_versions` : instruction versionnée et hashée.
- `prompt_compositions` : composition publiée d'un prompt et de ses modules.
- `prompt_composition_items` : ordre déterministe des éléments.
- `agent_prompt_bindings` : binding agent/mission/lane/environnement.
- `prompt_deployments` : shadow, canary, active, rollback et révocation.
- `prompt_evaluations` : qualité, sécurité, régression, coût et latence.
- `prompt_render_snapshots` : rendu exact envoyé au modèle avec variables redacted.
- `prompt_audit_events` : audit append-only des actions sensibles.

## Invariants

- Un couple définition + version est unique.
- Les hashes suivent `sha256:<64 hex>`.
- Une version `APPROVED`, `PUBLISHED`, `DEPRECATED` ou `REVOKED` ne peut plus changer son texte, ses variables ni son hash.
- Une composition publiée ne peut plus changer de prompt racine ni de hash rendu.
- Un binding actif pointe une composition explicite et peut référencer un `last_known_good_composition_id`.
- Un rollback est traçable via `rollback_of_deployment_id`.

## Portée

Ce ticket pose le stockage. Le renderer déterministe, les seeds Live/Replay et les guards anti-contournement sont livrés dans les tickets suivants de P2A.
