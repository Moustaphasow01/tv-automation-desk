# Desk Control Plane VNext

Nouvelle application frontend pour l’épic Jira TD2-165.

Ce workspace est volontairement isolé du front historique :

- aucune importation depuis `src/`, `src/components`, `src/pages`, `src/hooks` ou les fichiers CSS historiques ;
- aucun refactor ou habillage de l’application existante ;
- communication prévue via le BFF `/front-api/v1` uniquement ;
- mode de données réel par défaut via le BFF `/front-api/v1`.
- fixtures disponibles dans les tests uniquement ; elles ne constituent jamais un mode runtime de l’application.

## Scripts

```bash
npm --prefix apps/desk-control-plane run dev
npm --prefix apps/desk-control-plane run build
npm --prefix apps/desk-control-plane run test
node scripts/quality/check_front_vnext_legacy_isolation.mjs
```

## Routes socle

La Wave 0 expose les routes demandées par TD2-165/TD2-185. La préprod et le build Docker utilisent le BFF réel par défaut ; aucun écran opérateur ne doit dépendre silencieusement des fixtures mock.
