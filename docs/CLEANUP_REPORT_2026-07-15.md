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

Troisième lot — 16 juillet 2026 :

- extraction de la file Replay, des claims, leases, récupérations et de l'autopilot dans `DeskReplayService` ;
- extraction du cycle transactionnel des curseurs Live dans `DeskLiveService` ;
- extraction des projections frontend, des commandes opérateur, du calendrier macro et du snapshot marché dans `DeskFrontService` ;
- conservation des noms et payloads publics de `PersistentDeskStore`, qui reste la façade MCP ;
- suppression de dix helpers privés dont la définition était la seule référence statique, et de deux imports devenus inaccessibles ;
- réduction de `store.js` de 10 667 à 9 605 lignes sur ce lot, soit 1 062 lignes sorties ou supprimées du monolithe ;
- aucun changement appliqué au dépôt original, à Firebase, à Google Cloud ou au futur environnement OVH.

Quatrième lot — orchestration Replay :

- déplacement dans `DeskReplayService` de la création des runs, de la préparation et lecture des bundles Master/Monitor, des sauvegardes GPT, de l'horloge, de l'application des résultats et de la simulation ;
- déplacement de la boucle autopilot et de la sélection explicite des cadences `15m`, `30m` et `60m` ;
- déplacement des primitives de mutation Replay : révisions, préconditions, idempotence et commit transactionnel ;
- maintien temporaire des algorithmes purs de construction de bundle derrière `replayOrchestrationPort`, sans dépendance circulaire ;
- suppression de deux anciens constructeurs de bundles Live devenus inaccessibles et de leur helper de projection ;
- réduction de `store.js` de 9 605 à 8 893 lignes sur ce lot ;
- suite MCP complète validée à 219 tests sur 219.

Cinquième lot — marché et moteur de features, 16 juillet 2026 :

- extraction dans `DeskMarketFeatureService` des fenêtres brutes, snapshots de session, niveaux, événements techniques, deltas cross-asset et statuts de conditions ;
- déplacement des exécutions déterministes du moteur de features et des lectures marché utilisées pour préparer les setups Replay ;
- maintien temporaire des algorithmes purs de sélection, normalisation et calcul derrière le port explicite `marketFeaturePort` ;
- suppression de l'ancien wrapper automatisé du moteur de features devenu inutile ;
- réduction de `store.js` de 8 893 à 8 711 lignes sur ce lot ;
- suite MCP complète validée à 219 tests sur 219 ;
- aucun changement appliqué au dépôt original, à Firebase, à Google Cloud ou au futur environnement OVH.

Sixième lot — stratégie NY Open et audit, 16 juillet 2026 :

- extraction dans `DeskStrategyAuditService` de l'état NY Open, du calendrier, des détails journaliers et de la timeline Live ;
- déplacement du calcul et de la persistance des performances, des événements opérateur audités et du replay strict selon les trois modes de pricing ;
- déplacement de l'agrégation d'audit des contrats, données, features, jobs et erreurs backend ;
- maintien temporaire des calculs purs de projection et de performance derrière le port explicite `strategyAuditPort` ;
- suppression des trois anciennes méthodes privées d'orchestration stratégie dans `PersistentDeskStore` ;
- réduction de `store.js` de 8 711 à 8 564 lignes sur ce lot ; aucun helper de premier niveau laissé sans appel par le scan statique ;
- suite MCP complète validée à 219 tests sur 219 ;
- aucun changement appliqué au dépôt original, à Firebase, à Google Cloud ou au futur environnement OVH.

Septième lot — extraction des algorithmes purs, 16 juillet 2026 :

- déplacement de 187 fonctions de sélection, normalisation, projection et calcul dans `desk-market-feature-algorithms.js` et `desk-strategy-audit-algorithms.js` ;
- mutualisation de huit utilitaires réellement partagés, importés par le domaine stratégie sans duplication ;
- suppression complète des ports transitoires `marketFeaturePort` et `strategyAuditPort` ; les services importent désormais directement leurs algorithmes ;
- conservation dans `store.js` des seuls imports encore nécessaires aux workflows transversaux Replay et Live ;
- réduction de `store.js` de 8 564 à 5 429 lignes sur ce lot, soit 3 135 lignes sorties du monolithe ;
- aucun import inutilisé ni helper interne orphelin détecté dans les cinq fichiers concernés ;
- stabilisation de la suite MCP à quatre workers et mesure du benchmark Replay en temps CPU afin d'éviter les faux échecs liés à la contention WSL ;
- 29 tests ciblés puis suite MCP complète validée à 219 tests sur 219 ;
- aucun changement appliqué au dépôt original, à Firebase, à Google Cloud ou au futur environnement OVH.

Huitième lot — extraction de l'orchestration Replay, 16 juillet 2026 :

- déplacement de la fermeture complète de 73 fonctions Replay dans `desk-replay-orchestration-algorithms.js` : construction des runs et bundles, anti-lookahead, transitions, simulations, sélections et projections ;
- exposition d'un registre immuable de 39 opérations consommé directement par `DeskReplayService` ;
- suppression complète de `replayOrchestrationPort` et du paramètre d'injection transitoire associé ;
- conservation dans `store.js` de la seule coordination transverse, avec imports explicites des helpers encore partagés ;
- suppression de tous les imports devenus inutilisés et normalisation des grands blocs vides laissés par les extractions successives ;
- réduction de `store.js` de 5 429 à 3 391 lignes sur ce lot, soit 2 038 lignes sorties ou nettoyées du monolithe ;
- contrôles de syntaxe, chargement ESM et scan statique des imports validés sans dépendance manquante ;
- 35 tests ciblés puis suite MCP complète validée à 219 tests sur 219 ;
- aucun changement appliqué au dépôt original, à Firebase, à Google Cloud ou au futur environnement OVH.

Neuvième lot — audit final du store et des points d'entrée, 16 juillet 2026 :

- audit du graphe d'imports des 53 modules et scripts JavaScript initiaux ; les trois modules de schémas initialement isolés sont des réexports actifs de `schemas.js` ; après extraction, les 57 fichiers du graphe runtime sont tous atteignables depuis un point d'entrée déclaré ;
- vérification des cinq scripts restants : chacun est déclaré comme commande npm ou gate locale et conserve une responsabilité opérationnelle actuelle ; aucun script n'a donc été supprimé sans preuve ;
- déplacement des 84 dernières fonctions de premier niveau de `store.js` dans quatre modules propriétaires : état Live/Front, backtest, bundles Live et utilitaires documentaires ;
- conservation dans `PersistentDeskStore` de la façade MCP, des délégations de services et des coordinations de persistance transverses ;
- réduction de `store.js` de 3 391 à 1 300 lignes, soit 2 091 lignes sorties du dernier bloc monolithique ;
- aucun import inutilisé, identifiant non lié ou algorithme interne orphelin détecté dans les cinq fichiers concernés ;
- contrôles de syntaxe et de chargement ESM validés, puis 53 tests ciblés et suite MCP complète validée à 219 tests sur 219 ;
- aucun changement appliqué au dépôt original, à Firebase, à Google Cloud ou au futur environnement OVH.

Dixième lot — audit final du frontend, 16 juillet 2026 :

- audit du graphe d'imports des 27 modules de production React : toutes les pages, composants, hooks, contextes, clients API et styles sont atteignables depuis `src/main.tsx` ; les cinq fichiers restants sont exclusivement des tests ou fixtures ;
- vérification des douze routes `live`, `sessions`, `master`, `monitors`, `thesis`, `setup`, `news`, `performance`, `timeline`, `audit`, `alerts` et `more` dans le navigateur local, sans erreur de chargement ni erreur console ;
- suppression des hooks historiques `useSessionSummaries` et `useSessionOverviewDetail`, ainsi que de leurs clés React Query, méthodes clientes, endpoints frontend et types devenus sans consommateur ; les endpoints serveur ne sont pas supprimés par ce lot ;
- réduction de la surface publique de trois helpers opérateur et de deux types internes qui n'étaient importés par aucun autre module ;
- suppression de 97 classes CSS historiques sans élément React associé : anciens onglets, cartes Master/Monitor/Audit, listes de niveaux, sélecteur de session manuel, toast et variantes remplacées ; feuille réduite de 85 605 à 71 255 octets et de 1 073 à 909 lignes ;
- correction du sélecteur automatique latéral, passé de l'ancien ciblage de deux boutons à une grille réelle de trois phases `ASIA`, `LONDON` et `NY` ;
- remise en état des tests E2E : API simulée uniquement dans Playwright, service worker bloqué pendant l'interception et clé opérateur de test limitée au build E2E ; aucune écriture n'est envoyée à PostgreSQL ;
- aucun package de production ou fichier entier supprimé sans preuve d'inaccessibilité, et aucun changement appliqué au dépôt original ou à un environnement cloud.

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
- MCP/API : 219 tests sur 219 validés après les extractions contrats, packs, Replay, Live, Front, marché, features, stratégie et audit, incluant intégrité, store persistant, transactions, projections et webhook ;
- packages métier : 66 tests domaine, 8 tests replay, 8 tests audit et 6 tests temps validés ;
- frontend : typecheck validé, 13 tests React sur 13 et 3 scénarios Playwright sur 3 validés, puis build de production ;
- bundle frontend nettoyé : 282,24 Ko de JavaScript et 61,46 Ko de CSS avant compression, sans chemin mock de production ;
- dépendances MCP réinstallées depuis le lockfile : aucun package Firebase/Google Cloud et aucune vulnérabilité npm signalée ;
- contrats générés et finalisés : 5 contrats actifs, aucune violation ; couverture domaine à 94,9 % des lignes et 97,46 % des fonctions ;
- scan du runtime : aucune dépendance ou référence active à Firebase, Firestore, Cloud Run ou GCloud ;
- conteneurs PostgreSQL, API/MCP et frontend construits, démarrés et sains ; ports exposés uniquement sur `127.0.0.1` ;
- PostgreSQL réel : schéma initialisé, contrats seedés et écritures JSONB contrôlées ;
- webhook TradingView : acceptation locale en 202, rejet d'un mauvais secret en 401, secret absent des documents persistés ;
- MCP HTTP via Nginx : négociation `2025-03-26` réussie avec session MCP ;
- navigateur Firefox Playwright : les douze routes du Desk sont rendues, les appels API passent en 200 et aucune erreur ou alerte console n'est émise ; grille automatique à trois phases vérifiée après reconstruction Docker.
- CI locale renforcée : contrats, finalisation, couverture domaine et tests des quatre packages métier sont maintenant des gates explicites.

## Dette volontairement conservée

- les exporteurs Pine batch M1/M5/M15/H1/H4 restent conservés : leur usage peut vivre directement dans les alertes TradingView et ne peut pas être prouvé uniquement par le graphe d'import du dépôt ;
- le rapport d'audit cloud initial reste archivé comme trace de décision, sans être une configuration exécutable.
