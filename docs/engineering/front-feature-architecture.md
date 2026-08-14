# Front Feature Architecture

`TD2-ARCH-010` pose la convention transitoire du front actuel, en attendant la
refonte produit complète.

## Règle cible

Chaque écran métier converge vers :

1. `src/features/<feature>/dataAccess.ts` : accès API, clés de cache, merge de
   projections et politiques de rafraîchissement.
2. `src/features/<feature>/viewModel.ts` : transformation opérateur-friendly,
   labels, KPI, états vides/dégradés/chargement. Ce fichier reste sans React et
   sans client API.
3. `src/screens/<feature>/...` : rendu React uniquement.
4. `src/test/...` : tests du data-access et du ViewModel.

## Première slice : Live Desk

La feature `live-desk` porte maintenant :

- le merge des projections Live réelles ;
- les clés React Query et accès API associés ;
- le ViewModel de l'écran Live Desk ;
- les libellés opérateur pour le header, la file GPT et le processus live.

## Guard

`npm run guard:front-architecture` vérifie que :

- les fichiers de feature Live Desk existent ;
- `LiveDeskScreen` consomme son ViewModel ;
- le ViewModel ne dépend ni de React ni de l'API ;
- les écrans live ne réaffichent pas `strategyId` brut ;
- le runtime front ne contient pas de wording mock/demo/fixture.

Les fixtures restent autorisées uniquement sous `src/test/**`.
