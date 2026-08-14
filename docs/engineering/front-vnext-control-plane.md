# Front VNext Control Plane — socle TD2-165

## Décision

Le nouveau front est créé comme une application indépendante dans `apps/desk-control-plane`.

Ce choix respecte le mandat TD2-165 : repartir from scratch, sans bricoler le front existant, tout en gardant une coexistence sûre avec l’application actuelle pendant la transition.

## Frontières

- Le front VNext ne lit pas directement PostgreSQL, Firestore, le MCP ou les modules de stratégie.
- Le point de contact métier cible est le BFF `/front-api/v1`.
- Les vues métier seront construites autour d’endpoints de projection :
  - `/views/command-center`
  - `/views/research-lab`
  - `/views/strategy-center`
  - `/views/live-trading`
  - `/views/portfolio`
  - `/views/jarvis-workspace`
- Les décisions de trading, le risk, les calculs de PnL/R, les validations broker et les règles de stratégie restent côté backend.

## Isolation legacy

Le guard `scripts/quality/check_front_vnext_legacy_isolation.mjs` interdit les imports relatifs sortant de `apps/desk-control-plane`.

Il empêche notamment la reprise silencieuse de :

- composants historiques ;
- pages historiques ;
- hooks historiques ;
- CSS global historique ;
- routeur ou stores du front actuel.

## Gate G0

G0 est considéré validable uniquement si :

1. l’application VNext build seule ;
2. les tests VNext passent ;
3. le guard anti-legacy passe ;
4. le test du guard prouve qu’un import legacy injecté échoue.

Après G0, les golden slices peuvent être construites dans l’ordre Jira, en connectant progressivement les endpoints BFF réels.
