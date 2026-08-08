# Contracts — Index

18 contrats cibles introduits par ce dossier, chacun correspondant à une entité de `05-DOMAIN-MODEL-AND-STATE-MACHINES.md`. Chaque fichier contient : le but du contrat, ses champs clés, un exemple JSON concret. Ces contrats sont des **propositions de forme**, pas des schémas figés — ils suivent le style déjà en usage dans `packages/desk-contracts/schemas/entities/*.schema.json` (JSON Schema), à formaliser précisément au moment de l'implémentation du ticket concerné.

Les contrats déjà existants et **non modifiés** par ce dossier (Order Intent, Position, et les 7 contrats scellés de `packages/desk-contracts` — `DeskMasterAnalysisContract`, `DeskExecutionPlanContract`, etc.) ne sont **pas** dupliqués ici — voir `02-VERIFIED-AS-IS-SUMMARY.md` §3 pour leur inventaire.

| # | Contrat | Entité (`05`) | Fichier |
|---|---|---|---|
| 1 | Strategy Definition | §2.1 | [01-strategy-definition.md](01-strategy-definition.md) |
| 2 | Strategy Version | §2.2 | [02-strategy-version.md](02-strategy-version.md) |
| 3 | Strategy Instance | §2.3 | [03-strategy-instance.md](03-strategy-instance.md) |
| 4 | Dataset | §3.1 | [04-dataset.md](04-dataset.md) |
| 5 | Run | §3.2 | [05-run.md](05-run.md) |
| 6 | Experiment | §3.3 | [06-experiment.md](06-experiment.md) |
| 7 | Feature Definition | §8 (#8) | [07-feature-definition.md](07-feature-definition.md) |
| 8 | Data Source | §8 (#10) | [08-data-source.md](08-data-source.md) |
| 9 | Agent | §4.1 | [09-agent.md](09-agent.md) |
| 10 | Mission | §4.2 | [10-mission.md](10-mission.md) |
| 11 | Task | §4.4 | [11-task.md](11-task.md) |
| 12 | Batch | §4.5 | [12-batch.md](12-batch.md) |
| 13 | Event Envelope | §4.6 | [13-event-envelope.md](13-event-envelope.md) |
| 14 | Signal | §5.1 | [14-signal.md](14-signal.md) |
| 15 | AI Context Advisory | §5.2 | [15-ai-context-advisory.md](15-ai-context-advisory.md) |
| 16 | Candidate Allocation | §6.1 | [16-candidate-allocation.md](16-candidate-allocation.md) |
| 17 | Risk Decision | §6.2 | [17-risk-decision.md](17-risk-decision.md) |
| 18 | Target Position | §6.3 | [18-target-position.md](18-target-position.md) |
