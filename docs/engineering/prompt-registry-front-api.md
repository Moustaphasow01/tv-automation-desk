# Prompt Registry Front API

TD2-PRM-007 expose une première surface opérateur du Prompt & Instruction Registry.

## Endpoint

- `GET /api/v1/prompt-registry/overview`
- Contrat : `DeskPromptRegistryOverviewV1`
- Mode : lecture seule

L'API projette :

- prompts Live/Replay actifs ;
- version sémantique, composition et binding ;
- hash source, hash rendu et statut de parité ;
- consommateurs et contrats associés ;
- prompts dynamiques encore à remplacer ;
- état d'évaluation préparé par TD2-PRM-006.

## Front

- Page : `/prompt-registry`
- Fichier : `src/pages/PromptRegistryPage.tsx`
- Feature ViewModel : `src/features/prompt-registry/viewModel.ts`
- Navigation : espace `Réglages`

L'écran n'invente aucun état métier : il affiche la projection backend et garde les commandes verrouillées tant que TD2-PRM-008 n'a pas posé permissions, audit et garde secrets.

## Mutations

Les commandes de déploiement/rollback ne sont pas exposées dans ce ticket. La raison est volontaire : une mutation prompt peut changer le comportement des workers Live/Replay. Elle exige d'abord le garde-fou PRM-008.

## Validation

- `node --test mcp_gpt_desk/test/front_operations_api.test.js mcp_gpt_desk/test/prompt_registry_front_projection.test.js`
- `npx vitest run src/test/promptRegistryViewModel.test.ts --pool=threads --maxWorkers=1 --no-file-parallelism`
- `npm run typecheck`
