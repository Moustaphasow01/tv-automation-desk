# Front API v2 catalog

Ticket : TD2-1000.

## Objectif

Le front actuel continue de consommer les routes `/api/v1/*`. Le futur front V3 a besoin d'une carte stable, orientée métier, qui évite de reconstruire son parcours utilisateur à partir d'identifiants techniques ou de détails internes.

Le catalogue v2 expose cette carte sur :

- `/api/v2/catalog.json`

Il ne remplace pas `/api/v1/openapi.json`. Il le projette en contrats consommables :

- domaine métier ;
- nom métier lisible ;
- méthode et route technique ;
- schémas de requête/réponse ;
- audience cible ;
- scope requis ;
- scopes opérateur fins ;
- politique d'écriture ;
- empreinte de compatibilité.

## Politique de compatibilité

- Les suppressions, renommages de route, changements de méthode, changement de schéma principal ou changement de scope sont interdits sans version majeure.
- Les ajouts sont autorisés s'ils restent backward-compatible.
- Les routes historiques restent servies tant que le front actuel les consomme.
- Les futures routes V3 doivent être ajoutées au catalogue avant d'être utilisées par l'interface.

## Domaines métier

Les routes sont classées dans les domaines suivants :

- Aujourd'hui ;
- Opérations ;
- Performance ;
- Stratégies ;
- Recherche ;
- Fondation données ;
- Exécution ;
- Gouvernance.

Cette classification est volontairement métier : le futur front doit construire ses menus et zooms depuis ces domaines, pas depuis la structure interne du backend.

## Permissions

Chaque opération publie `operatorScopes`, dérivé de `operator_access_policy_v1`.

La valeur `access` reste volontairement compatible (`desk.read` / `desk.write`), tandis que `operatorScopes.requiredScopes` expose la granularité cible :

- `desk.automation.read/write` pour workflows, replays, incidents et stratégies ;
- `desk.execution.read/write` pour console broker, bridge et AddOn ;
- `desk.admin` comme super-scope.

## Garde-fou

Le test `mcp_gpt_desk/test/front_api_v2_catalog.test.js` vérifie que :

- chaque route OpenAPI existante est classée dans un domaine ;
- aucun nom métier n'expose de placeholder technique ;
- les écritures sont marquées `desk.write` avec politique opérateur/idempotence ;
- l'empreinte de compatibilité est déterministe.
