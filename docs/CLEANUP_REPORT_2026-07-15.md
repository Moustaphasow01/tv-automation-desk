# Rapport de nettoyage de la préproduction

Date : 2026-07-15  
Source : `/mnt/c/Users/CES/Desktop/TV_Automation` à la révision `38407bb6cf7cede134ffe22567ee9a6d0e29b513`, avec son working tree courant.  
Destination : `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`

## Isolation réalisée

- nouveau dépôt Git sans historique ni remote partagé ;
- secrets `.env`, configurations MCP privées, bases, caches, exports et données runtime exclus de la copie ;
- aucune commande de déploiement ou d'écriture cloud exécutée ;
- infrastructure locale regroupée dans `docker-compose.yml` et `infra/`.

## Suppressions réalisées dans la copie uniquement

- second frontend explicitement exclu du build TypeScript ;
- répertoire `legacy/` et rapports historiques ;
- Firebase Functions, règles, index, hosting et configuration projet ;
- adaptateur Firebase Admin et scripts de publication/backfill cloud ;
- scripts Cloud Run et schedulers ;
- moteur Python shadow, scanners, anciens dashboards et runners de recherche ;
- packages Node non atteints par le runtime actuel ;
- checkout MCP tiers embarqué et artefacts générés.

## Deuxième passe de nettoyage

- suppression du contrat frontend dupliqué `src/contracts/frontProjection.ts` ;
- suppression des anciens outils manuels d'audit/migration de l'isolation de stockage et de leur documentation devenue inexécutable ;
- suppression du CLI replay destiné aux ponts Python et de son test dédié ;
- suppression des alias de producteurs Python dans le modèle de décision et régénération des contrats ;
- suppression de la feuille CSS non importée et de deux sources Pine tierces non référencées ;
- retrait complet du mode mock du runtime React et de ses variables de build ; les données factices sont désormais des fixtures de test uniquement ;
- PostgreSQL devient l'unique store sélectionnable par le runtime ;
- absence de `DATABASE_URL` détectée au démarrage au lieu d'utiliser silencieusement une ancienne URL locale.

Cette passe retire plus de 3 400 lignes historiques ou inaccessibles, dont environ 110 Ko pour les seuls fichiers supprimés, sans compter la branche mock retirée de l'API frontend.

## Troisième passe de nettoyage

- remplacement des usages de `LocalDeskStore` dans les tests par `PersistentDeskStore` et un port `InMemoryDeskPersistence` partagé ;
- suppression complète de la classe fichier `LocalDeskStore`, soit près de 2 500 lignes supplémentaires ;
- suppression d'environ 300 lignes de scénarios de test devenues inaccessibles après des retours anticipés ;
- conversion des assertions basées sur les fichiers de sortie vers les documents réellement transmis au port de persistance ;
- correction du chargement du moteur de features persistant : sélection des datasets autorisés, filtrage par instrument et dérivation M15/H1/H4 depuis M5 lorsque nécessaire ;
- renommage du test historique `local_store` afin qu'il décrive le comportement réellement exercé.

Au total, les passes de nettoyage retirent désormais plus de 6 000 lignes historiques, dupliquées ou inaccessibles de cette copie de préproduction.

## Modularisation progressive

- création du commit Git de référence `3365f20` avant tout refactoring structurel ;
- isolation des changements sur la branche `codex/store-modularization` ;
- extraction du registre de contrats dans `DeskContractService` et des identifiants déterministes dans `desk-ids.js` ;
- conservation de `PersistentDeskStore` comme façade compatible avec les outils MCP ;
- correction du fallback des contrats actifs après activation d'une version non embarquée ;
- ajout de tests dédiés au chargement embarqué, à l'immutabilité des versions, à l'audit forcé, à l'activation et à l'archivage.

Deuxième lot :

- extraction des packs, builds immuables, datasets, niveaux, macro et news dans `DeskPackService` ;
- déplacement des erreurs et de la normalisation UTC partagées dans des modules dédiés ;
- centralisation de l'invalidation des builds compromis dans le service propriétaire ;
- conservation des snapshots PostgreSQL du marché live dans le store, en attente d'un domaine séparé ;
- réduction de `store.js` de 11 145 à 10 614 lignes ;
- ajout de tests dédiés à la sélection et au filtrage des packs, aux fallbacks macro/news, aux datasets interdits et aux manifests corrompus.

## Runtime conservé

- frontend React actuel ;
- serveur API/MCP actuel ;
- contrats, audit, domaine, replay engine et gestion du temps ;
- workflows live/replay actuels ;
- scripts de seed, checkpoint live et replay autopilot ;
- exports Pine TradingView encore utiles, hors exporteur nommé Firebase.

## Remplacements

- Firestore -> PostgreSQL JSONB ;
- Firebase Auth navigateur -> clé opérateur locale pour cette préproduction ;
- Firebase Function TradingView -> endpoint Node local ;
- Firebase Hosting -> Nginx ;
- Cloud Run -> services Docker Compose.

## État de validation

- configuration Docker Compose : valide ;
- MCP/API : 217 tests sur 217 validés après les extractions contrats et packs, incluant intégrité, store persistant, transactions, projections et webhook ;
- packages métier : 66 tests domaine, 8 tests replay, 8 tests audit et 6 tests temps validés ;
- frontend : 13 tests sur 13 validés, avec typecheck sans émission d'artefacts et build de production ;
- bundle frontend Docker : 282,82 Ko de JavaScript avant compression, sans marqueur du mode mock ;
- dépendances MCP réinstallées depuis le lockfile : aucun package Firebase/Google Cloud et aucune vulnérabilité npm signalée ;
- contrats générés et finalisés : 5 contrats actifs, aucune violation ; couverture domaine à 94,9 % des lignes et 97,46 % des fonctions ;
- scan du runtime : aucune dépendance ou référence active à Firebase, Firestore, Cloud Run ou GCloud ;
- conteneurs PostgreSQL, API/MCP et frontend construits, démarrés et sains ; ports exposés uniquement sur `127.0.0.1` ;
- PostgreSQL réel : schéma initialisé, contrats seedés et écritures JSONB contrôlées ;
- webhook TradingView : acceptation locale en 202, rejet d'un mauvais secret en 401, secret absent des documents persistés ;
- MCP HTTP via Nginx : négociation `2025-03-26` réussie avec session MCP ;
- navigateur Firefox Playwright : Desk rendu, navigation client validée, appels API en 200, aucune erreur ni alerte console.
- CI locale renforcée : contrats, finalisation, couverture domaine et tests des quatre packages métier sont maintenant des gates explicites.

## Dette volontairement conservée

- les exporteurs Pine batch M1/M5/M15/H1/H4 restent conservés : leur usage peut vivre directement dans les alertes TradingView et ne peut pas être prouvé uniquement par le graphe d'import du dépôt ;
- le rapport d'audit cloud initial reste archivé comme trace de décision, sans être une configuration exécutable.
