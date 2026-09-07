# Grains — temps réel et horloge du journal

## Mandat et baseline

Lot autorisé par « go next chantier », 7 septembre 2026. Tickets **TD2-433**, **TD2-435**, et dépendance de sécurité découverte **TD2-437**. Ce rapport complète `GRAINS_CONTEXT_RESUMPTION_20260907.md` sans remplacer ses résultats historiques.

- Branche : `codex/grains-week-integrity`, HEAD initial `ed2f400f074c49cf944e1cc9eaec353993715bd0`.
- Worktree : `TV_Automation_LIVE_FOCUS_VNEXT`, aucun changement suivi initial ; `mcp_gpt_desk/nul` et `output/` non suivis préexistants conservés.
- VPS vérifié à **16:58:48 UTC** : `grains-context-resumption-20260907.2`, source `ba4e78730c1c885bfd59fa7fc065c7d87a98e434`, migration `067_portfolio_administrative_reservation_cancellation`.
- Onze services Running/Automatic. Calendrier AVAILABLE : 74 événements, trois sources, publication 16:39:19.671 UTC, échéance de fraîcheur 22:39:19.671 UTC, cadence 30 minutes autonome VPS.
- Risque inchangé : 500 USD/position, 2 000/jour, 4 000/semaine. AUTO/LIVE physiques OFF, aucun ordre ni confirmation Human Gate autorisés par cette recette. Analyste grains existant consultatif ; aucune activation d'un autre worker.
- Preuve : `output/research/grains-realtime-ledger-20260907/baseline-runtime-policy.json`.

## Slice, placement et alternatives

1. **Adaptateur de persistance audit/outbox** : comparer le curseur événementiel directement dans PostgreSQL, sans conversion intermédiaire vers une date JavaScript qui perd les microsecondes. Consommateur : BFF SSE. Pas de nouvel événement métier ni d'une autre machine d'état provider.
2. **Présentation temps réel/cache** : invalider les clés réellement utilisées, y compris Live Focus isolé ; dédupliquer avant les effets secondaires ; reprendre les lectures après déconnexion. Consommateurs : vues existantes. Pas de modification graphique, de calcul métier, de permissions ni de reload global.
3. **Persistance portfolio et projection d'exposition** : distinguer l'heure métier causale de l'heure technique d'enregistrement. Consommateurs : même runtime live et replay. Ne pas rendre les résultats reproductibles en masquant des différences significatives dans le comparateur.
4. **Admission des tâches pendant déploiement** : le claim Agent Runtime doit partager le verrou `producer_hold`, puis le drain doit attendre les tâches avant d'arrêter les services. Les contrôles legacy `live/replay=PAUSED` restent indépendants et inchangés. Le superviseur Research ACTIVE/NO_WORK préexistant n'est pas basculé arbitrairement en shadow.

Alternatives écartées : accélérer le polling pour cacher la panne SSE ; dédupliquer seulement l'affichage ; arrondir arbitrairement le curseur ; supprimer toutes les dates du replay ; recalibrer stratégie/risque sur vendredi.

## Contrat opérateur et traçabilité

Objectif : un nouveau brief publié doit devenir visible dans le panneau existant sans attendre le polling, déplacer la lecture ou faire passer une source ancienne pour fraîche. Le backend demeure l'autorité de toutes les valeurs et actions.

| Besoin | Source et chemin | État | Preuve attendue |
| --- | --- | --- | --- |
| Nouveau brief visible | Persistance contexte → outbox → SSE → cache scoped → vue BFF Focus → panneau | Publié, daté ; sans mutation optimiste | Même identifiant depuis événement jusqu'au rendu avant prochain polling |
| Éviter une boucle de rafraîchissements | Curseur DB natif + IDs reçus + reducer/cache | Doublon compté, pas de nouvelle commande/refetch | Microsecondes PostgreSQL, pagination, déduplication QueryClient |
| Reprendre une connexion | Curseur → snapshot canonique → queries réellement montées | Déconnecté/reconnexion/ancien état explicites | Coupure et reprise ; lecture sûre si panne persistante |
| Journal causal reproductible | Cutoff injecté → lineage/exposition → décision portfolio | Heure métier séparée de la persistance technique | Deux runs figés sous horloges différentes, comparaison des champs significatifs |

Sources lues : AGENTS, standards d'ingénierie, catalogue/glossaire, ADR 0009/0010/0024, Page Operating Contract Live, spécification Focus, protocole et extensions UI/UX, chapitres 25/35/40/46/47.

Règles applicables : **UXR-0481/0482/0486/0487/0489/0500**, **0681/0682/0683/0687/0688/0689/0697/0699/0700**, **0784/0785/0786/0793/0797/0798/0800**, **0903/0904/0908/0909/0914/0915/0920**. Sélection contextuelle exécutée avant code. Aucune dérogation P0 nouvelle ; le scanner seul ne certifie pas le respect du référentiel.

## Critères de validation et limites

- Tests ciblés puis régressions frontend/backend, vrais tests PostgreSQL et guards architecturaux.
- Même vendredi gelé : mêmes données, version de stratégie, politique et population. Les horodatages métier significatifs ne sont pas supprimés du comparatif.
- Recette navigateur et déploiement versionné avec sauvegarde/drain/canary si le lot est validé ; recontrôle des sécurités et de l'analyste après release.
- Le vendredi historique reste **conditionnel**, avec trous OHLC/provenance/calendrier connus. Ce lot ne certifie ni PIT historique ni rentabilité hors échantillon.
- L'ordre du curseur `(created_at_utc, id)` ne constitue pas un ordre de commit total : les transactions tardives doivent être distinguées de la correction de précision. Ne pas déclarer une livraison SSE exactement une fois.

## Résultats vérifiés

| Contrôle | Résultat | Preuve locale |
| --- | --- | --- |
| Frontend Windows Vitest complet | 323/323, 64 fichiers, après test de réponses lentes | `output/research/grains-realtime-ledger-20260907/frontend-validation.md` |
| Cache/SSE ciblé + vrai montage React | 22/22 ciblés, montage 1/1 ; TypeScript et ESLint ciblé verts | Même relevé ; commandes exactes et limites |
| Curseur PostgreSQL + frontière HTTP SSE réelle | 2/2, microsecondes et retour aux heartbeats après quatre publications | `outbox-http-final-postgres-tests.log` dans le même dossier de preuves |
| Outbox/BFF unitaires | 57/57 | `outbox-bff-unit-tests.log` |
| Première régression backend complète | 1 547 réussis, 48 skips, 0 échec / 1 595 tests | `backend-regression.log` |
| Construction isolée Windows, installation propre | 323/323 frontend VNext ; 75/75 frontend historique ; backend 1 549 réussis, 49 skips, 0 échec / 1 598 tests ; build et archive vérifiés | `build-release-vps-v2.log` |
| Suite PostgreSQL complète, source gelée corrigée | 69/69, 0 échec, 0 skip, 720,5 s | `grains-postgres-frozen.log` ; première exécution 68/69 conservée dans `grains-postgres-final.log` avec l'échec de fixture expliqué ci-dessous |
| Admission Agent Runtime | 28/28 unitaires et 2/2 PostgreSQL réels ; deux sens du verrou claim/pause | `deployment-validation.md` |
| Déploiement Windows natif | 109 fichiers, drain/tâches/reprise verts ; première bascule avec `RequireEmptyAgentQueue` après sauvegardes | `deployment-validation.md`, `windows-guard-direct.log` |
| Architecture backend/frontend et compatibilité API | Verts | `architecture-guard.log`, `front-architecture-guard.log`, `api-compatibility.log` |
| Isolation legacy et mode données réelles | Verts | `front-legacy-isolation.log`, `front-data-mode.log` |
| Rulebook | 1 000 règles valides, tests sélecteur/scanner verts | `uiux-rulebook-tests.log` |
| Scanner heuristique final du lot | 0 erreur, 883 avertissements / 203 fichiers ; pas une certification exhaustive | `uiux-audit-frozen.json` |
| Contrôle qualité statique global | Rouge préexistant, mêmes écarts sur HEAD initial exporté sans modifications | `static-quality.log` et `static-quality-baseline.log` |

Le contrôle global signale : `packages/desk-domain/index.js` 601 lignes pour 600 ; 271 fonctions surdimensionnées pour 250 ; 722 complexités élevées pour 650 ; 97 duplications pour 72. Aucun seuil n'est abaissé. Dette ciblée supprimée : huit branches de clés de cache écrites directement dans RealtimeProvider → zéro, politique centralisée testée. Les horloges d'ingestion demeurent auditables ; elles ne sont plus utilisées comme dates métier dans les réservations concernées.

### Contre-revues intégrées

- Une rafale d'événements distincts pouvait annuler indéfiniment des lectures lentes. Le correctif attend la lecture en vol, accumule les vues concernées et effectue une relecture de rattrapage, sans annulations successives. Test différé : huit invalidations, zéro abandon, un rattrapage et dernière donnée affichée.
- L'état courant provider ne peut être qualifié par n'importe quel ancien événement : preuve de transition compatible au lifecycle, timestamps causaux claim/dispatch et statut de commande concordant requis. Un état BLOCKED silencieux ou un LEASED ancien sans preuve reste PARTIAL. Les millisecondes des Date PostgreSQL sont conservées.
- La première suite PostgreSQL a révélé une fixture incohérente : cible/gate reculés au 1er septembre, mais demande toujours au 4. Le helper recale désormais aussi la demande ; l'attendu KNOWN est conservé et le test ciblé repasse. Aucune donnée métier réelle n'a été changée pour faire passer le test.
- La première construction isolée a révélé `happy-dom` présent localement mais non déclaré pour le test de montage React. La release `.1` a échoué et n'a pas été déployée. Le commit `ce196015fbd2df991a36c2260531496847be3f9d` ajoute uniquement `happy-dom 20.10.6` et son lock. Installation propre Linux : dix tests ciblés et build verts, audit npm sans vulnérabilité ; nouvelle construction Windows `.2` complète verte. Aucun test supprimé ou ignoré pour résoudre l'échec.
- La première bascule depuis `ba4e787` exige la file Agent Runtime entièrement vide après Pause, pas seulement un ancien préflight avant sauvegardes. Le flag transitoire compte cinq états non terminaux et conserve DRAIN en cas d'échec. Les futures releases gardées peuvent conserver leurs tâches READY en attente. Aucune création opérateur/externe n'est autorisée pendant cette fenêtre ; il ne s'agit pas d'une barrière contre un administrateur écrivant hors protocole.

## Observations VPS avant livraison

- Navigateur réel 17:04–17:06 UTC : 65 événements reçus pour 28 IDs distincts. Les quatre événements de publication contexte ont chacun été reçus trois fois. Le brief a fini par apparaître via les lectures BFF, ce qui ne prouvait pas son rafraîchissement SSE.
- Un appel Focus 503 transitoire a été observé ; lectures suivantes 200. Ne pas déclarer une baseline réseau sans erreur.
- À 17:20:56 UTC : aucun Agent Runtime READY/PENDING/CLAIMED/RUNNING en attente ; uniquement anciennes erreurs terminales. `producer_hold=OPEN`, zéro commande provider et zéro confirmation humaine pendant le lot. Preuve `agent-drain-preflight.json`.
- **TD2-436, backlog distinct non corrigé ici** : plusieurs réveils contextuels sur un même choc ZW et des bougies arrêtées au 4 septembre, alors que la session du 7 est fériée. Les briefs reconnaissent la fermeture ; aucun ordre n'en résulte. Réveils observés 16:45 et 17:00 ; suppression des réveils redondants à traiter séparément sans modifier la détection des setups.

## Double replay PostgreSQL local

Vendredi **4 septembre 2026**, deux bases locales isolées, source métier exacte **`3b55ef5c95e3ef72245484a7a893ed744bf0f6b1`**, mêmes données, politiques et cutoffs. Le commit de packaging `ce19601` ne modifie aucun fichier métier : diff limité aux deux fichiers package frontend. Pas d'appel Codex dans ces replays déterministes.

| Étape | Run 1 | Run 2 |
| --- | ---: | ---: |
| Signaux / décisions contexte | 22 / 22 | 22 / 22 |
| Runs portefeuille / décisions risque | 14 / 10 | 14 / 10 |
| Targets / OrderIntents / Human Gates | 6 / 6 / 6 | 6 / 6 / 6 |
| États d'exécution / événements théoriques | 6 / 9 | 6 / 9 |
| Trades / outcomes | 3 / 3 | 3 / 3 |
| Commandes provider | 0 | 0 |
| Résultat théorique | +2,04444444 R / +200 USD nets | +2,04444444 R / +200 USD nets |

Les trois résultats unitaires sont `+1,6 R`, `+1,44444444 R`, `−1 R`. Les 14 identifiants portefeuille et la projection causale sont identiques ; les six dates techniques d'ingestion diffèrent effectivement. Les événements techniques à identifiant aléatoire restent dans les fichiers bruts ; le comparateur ne les assimile pas à une différence de décision.

- Données : 17 445 bougies, 27 lots, 227 cutoffs ; SHA256 `685700061e3cbb9ea414b8ddc1ac1c08ebdfed7985a0d6690ddec8ba3e6c52ee`.
- Politique : SHA256 `5ade16bf4ed7448b6951839b8ecf2ac6c6fa20dbe50536d280c5120ca300e8a8`.
- Projection causale : SHA256 `2d45e1e943f0cd4c61cb50862aa69b14482b874c2405dad76343932ac709ac8b`.
- Statut du comparateur : `CAUSAL_LEDGER_IDENTICAL_TECHNICAL_INGESTION_DISTINCT`, égalité des empreintes de code également vérifiée.
- Fichiers : `output/research/grains-context-resumption-20260907/conditional-replay-20260904-td2-433-3b55ef5-{run1,run2,comparison}.json`.

**Limite** : résultat CONDITIONNEL, pas OOS ni certification de rentabilité. Deux trous M1 et un trou M5 par instrument, reçus historiques importés le 6 septembre, absence de preuve PIT calendrier à chaque cutoff ; les journaux de statut courant non versionnés restent une limite de reconstruction historique.

## Livraison VPS vérifiée

- Version : `grains-realtime-ledger-20260907.2`.
- Source : `ce196015fbd2df991a36c2260531496847be3f9d`, source métier replay inchangée depuis `3b55ef5`.
- Archive SHA256 : `2df63d78408691d7521456faf5ee5656206883e00079bf31e33b4c6fc01bd847` ; 5 420 fichiers vérifiés.
- Runtime Windows réellement observé : Node `24.18.0`. Tests locaux PostgreSQL sous Node `22.22.3` ; installation propre de dépendance sous Node `20.20.2`.
- Préflight 17:49 UTC : ancien VPS toujours `ba4e787`, onze services Running/Automatic, calendrier AVAILABLE actualisé à 17:39:22 UTC (74 événements, trois sources), prochaine collecte 18:09 UTC, aucune tâche non terminale à cet instant. Cette observation ne remplace pas le drain après sauvegardes.
- Sauvegarde DB fraîche `desk-native-20260907T175431Z.dump`, SHA256 `9873aed456e8b7311e4d9e4928de764d4ceddca9ea425205a3658b316b520f5f` ; fichiers immuables `desk-objects-20260907T180139Z.tar.gz`, SHA256 `121712e56c10cd2643ac538b050cf326eb05cfbb04990c4a40f29dead1e5cc5b`.
- Premier drain réel : `deploy-20260907T180349Z-64b6572c`, file non terminale intégralement vide après Pause, puis arrêt des services. L'analyste `3dad3b81-ef48-4344-a474-ae68753416de` était encore CLAIMED à 18:03:16 ; aucune tâche active n'est ignorée au passage du drain.
- Cet analyste est passé DONE à **18:03:27.855 UTC**, avant Pause à 18:03:49. Collecte 18:04:14 : DRAIN avec propriétaire exact, aucune tâche non terminale, zéro commande provider/confirmation humaine pendant le lot (`agent-drain-held.json`).
- Canary loopback réussi, schéma 067 actuel (aucune nouvelle migration appliquée), archive vérifiée ; contrôles publics frontend/health/readiness/OAuth 200 et rejet du webhook sans secret. Reprise canonique terminée à 18:07 UTC : `RELEASE_DEPLOYED_SAFETY_PRESERVED` dans `deploy-release-vps.log`.
- Collecte stable **18:07:55 UTC** : manifeste actif `ce19601`, onze services Running/Automatic, santé `ok=true`, `degraded=false`, risque 500/2 000/4 000 USD et broker OFF conservés (`runtime-postdeploy.json`). Ne pas confondre avec `runtime-during-switch.json`, capturé au milieu de la bascule.
- Scope analyste conservé : `LIVE_US_GRAINS_MARKET_CONTEXT_*` seul, lane/pool live, concurrence 1, runner exact, superviseur ACTIVE, ordonnanceur générique disabled. Research reste ACTIVE préexistant ; workers legacy shadow et lanes live/replay PAUSED inchangés (`context-postdeploy.json`).
- Après reprise : nouveau worker réel `33598162-8d0d-46fb-8306-33ca42491a30` CLAIMED à 18:08:30, hold OPEN. Aucun réveil manuel ni faux événement pour la recette (`agent-after-resume.json`).

## Recette navigateur réelle après livraison

Session Chromium dédiée, VPS authentifié, route `/#/live?instrument=ZW&focus=1`, viewport **1 366 × 768**, zoom normal. Aucun événement synthétique, ordre, confirmation, lecture de secret dans les preuves ou modification de données métier pour provoquer les événements.

| Contrôle | Observation | Qualification |
| --- | --- | --- |
| Build réellement rendu | `index--2PyYewc.js`, CSS `index-CNeeGDsH.css` et `LiveTradingPage-C0iOtZK5.css` | Release `.2`, pas le serveur local |
| Précision du curseur | 18:08:50–18:19:30 : **93 événements, 93 IDs distincts, zéro doublon observé** ; baseline : 65 reçus/28 distincts | Correction observée ; ce n'est pas une garantie de livraison exactement une fois |
| Invalidation scoped | Événements stratégie reçus à 18:09:24.812, lecture Focus débutée à 18:09:24.918, réponse 200 à 18:09:32.257 | Lecture déclenchée après événement, sans attendre 60 s ni recharger la page ; latence BFF encore élevée |
| Coupure transport | Passage offline puis arrêt réel des requêtes réseau via `Page.stopLoading` à 18:11:29.682 ; dernière lecture datée conservée | Offline seul n'avait pas fermé le SSE existant ; cette première tentative n'est pas considérée probante |
| Reconnexion | Reprises à +1/+2/+4/+8 s avec le même curseur `domain_evt_cbb34647577fb8c9b376d596` ; connexion reprise après retour online | Reconnexion réelle, pas d'événement simulé |
| Rattrapage contexte | Publication backend `ca708f8184f3d66f5fc08280` à 18:11:36.438 ; quatre événements contexte/brief reçus une seule fois à 18:11:57.223–226 ; mêmes IDs dans BFF et rendu | Nouvelle analyse réellement produite par Codex et récupérée |
| Attribution exacte au SSE | Premier rendu du nouveau brief 18:11:56.305 via refetch au retour online ; nouveau GET après SSE à 18:11:57.381, terminé 18:11:57.736 | Ne pas attribuer le premier rendu uniquement au SSE : onlineManager avait aussi relancé une lecture. Recette publication purement online à compléter |
| Réouverture du navigateur | Curseur persisté `domain_evt_5b17f2a5b0035cdb644e8c9a`, réutilisé dans GET SSE à 18:20:01.757 ; BFF et DOM retrouvent le brief `ca708…` à 18:20:13 | Reprise sans remise à zéro du curseur ; authentification privée nettoyée après recette |
| Intégrité visuelle du lot | Largeur document 1 351, hauteur 985, pas de débordement horizontal ; aucun changement de disposition/CSS ; scroll général disponible | Contrôle ponctuel, pas une certification a11y/responsive complète |

Les horloges serveur, CDP et navigateur présentent un léger écart ; les latences inter-machines ne sont pas une mesure synchronisée. Deux navigations de démarrage sont enregistrées, aucune navigation/recharge complète ultérieure pendant la première observation. L'observateur n'a capturé aucune erreur JavaScript applicative ; les erreurs réseau volontairement provoquées ne sont pas dissimulées.

Preuves : `output/playwright/grains-realtime-ledger-20260907/final-browser-evidence.log`, `browser-reopen-proof.log`, `context-publication-observation.log`, `offline-abort-observation.log`, `online-recovery-observation.log` ; capture `output/playwright/grains-realtime-ledger-20260907-after.png`.

### Défaut BFF découvert : TD2-438 — P0, non corrigé

**Le brief peut encore disparaître : il existe en base, mais une erreur de lecture est présentée comme une absence métier.**

- À **18:17:35.901 UTC**, HTTP 200 mais `meta.availability=PARTIAL`, `stale=true`, `latencyMs=7422`, source `market-context=UNAVAILABLE` et warning exact `market-context:timeout exceeded when trying to connect`. Corrélation `corr_front_view_live-focus_e9555b1a1d4f`.
- Le brief `market-brief-ca708f8184f3d66f5fc08280`, publié à 18:11:36.438 et valide jusqu'à 19:08:28.832, devient pourtant « Analyse de contexte non publiée », accompagné de **0 succès/0 échec** et d'un calendrier non publié. Il réapparaît ensuite sans nouvelle publication.
- Même symptôme à 18:10:59 et 18:13:30, avant ajout de la capture des warnings ; ne pas attribuer avec certitude la même erreur SQL à ces deux occurrences. Autres réponses PARTIAL avec `ai-context`, `live-session` ou `front-news:FRONT_SOURCE_TIMEOUT`.
- Cause confirmée pour 18:17 : expiration de la **file d'acquisition pg-pool**, message émis par `pg-pool/index.js:199-225`, distinct du timeout TCP. Les paramètres par défaut du code sont max 10/délai 5 s ; ce n'est pas une lecture des valeurs configurées actives.
- `front-control-plane-api.js:288-386,2175-2187` lance 14 sources, capture l'erreur et retourne null. `market-context-repository.js:18-72` groupe sept souslectures dans un Promise.all indivisible. `front-live-focus-projection.js:9-35,234-236` convertit le null en absence de publication et faux zéros. Les requêtes responsables de la contention restent à mesurer ; aucune fuite de connexion n'est affirmée sans preuve.
- Correction proposée : lecture principale snapshot/brief cohérente et peu coûteuse, enrichissements indépendants à concurrence bornée, états erreur/absence distincts, compteurs inconnus null. Conserver une ancienne donnée seulement si explicitement datée et dégradée, sans lui donner une autorité Risk. Ne pas résoudre par augmentation aveugle du pool ou du timeout.
- Tests attendus : pool max 1/client retenu, erreur d'enrichissement avec contexte principal valide, absence réelle, erreur principale, retour à AVAILABLE, limite de concurrence, cohérence snapshot/brief, aucune fuite de message SQL/secret.

Preuve complète : `bff-diagnostics-compact.log` et `final-browser-evidence.log`. Ticket [TD2-438](https://grouptopicone.atlassian.net/browse/TD2-438), propriétaire **BACKEND/BFF + FRONT pour les états**, échéance : **avant clôture de TD2-435/recette globale TD2-420**.

### Défaut UX préexistant : TD2-416

Le transport reconnecte effectivement, mais Focus n'affiche pas de badge visible de coupure réseau navigateur. Les derniers contenus datés demeurent affichés avec l'état de leur source. Le mode marché fermé ne remplace pas un état de transport déconnecté. Ajout d'une preuve au ticket existant **TD2-416**, sans nouveau redesign ni fausse remontée de « healthy ». Ce point et TD2-438 empêchent une certification complète du mode dégradé.

## Dernier contrôle VPS et périmètre livré

À **18:20:01 UTC** : release `.2` / `ce19601`, onze services Running/Automatic, contrôle santé 18:18:21 `ok=true/degraded=false`. Cette santé globale ne certifie pas les lectures BFF intermittentes décrites plus haut.

Le collecteur calendrier a effectué une nouvelle exécution **autonome VPS** à 18:08:20, dernière publication 18:08:23.929, statut AVAILABLE, **74 événements/3 sources**, fraîcheur jusqu'au **8 septembre 00:08:23.716 UTC**, prochaine collecte 18:38:20. Version `c6d0fe3e-7df8-4213-9441-f79327a9db5a`. Aucun collecteur PC.

La tâche grains déterministe est activée à cadence d'une minute, dernière exécution 18:19:21/resultat 0. L'analyste réel post-reprise `33598162-8d0d-46fb-8306-33ca42491a30` est DONE depuis 18:11:36.582. À 18:18:32, hold OPEN, aucun task READY/CLAIMED/RUNNING, **zéro commande provider et zéro confirmation Human Gate pendant le lot**. Les anciennes lignes ERROR terminales sont conservées ; elles ne constituent pas une file active.

Plafonds **500/2 000/4 000 USD**, broker disabled, kill switch true, quantité physique maximale 0 et exécution legacy false inchangés. Aucune nouvelle notification de trading envoyée artificiellement ; livraison Telegram d'un nouveau signal non certifiée aujourd'hui, marché fermé.

### Fichiers, compatibilité et retour arrière

- Persistance/application backend : `domain-event-outbox-repository.js`, `portfolio-risk-runtime-repository.js`, `portfolio-theoretical-exposure-repository.js`, `persistence/postgres-grains-replay-ledger.js`, admission Agent Runtime et admission de déploiement.
- Présentation frontend : `domains/realtime/{RealtimeProvider,eventEnvelope,realtimeQuerySync}`, `domains/front-api/repositories.ts`, `shared/transport.ts` et tests associés. Aucun fichier d'écran ou style modifié.
- Exploitation : `deploy/windows/{Invoke-DeskDrain,Test-DeskAgentRuntimeDrain,Update-Desk}.ps1`, guard Windows, package scripts et CI native Windows. Dépendance de test `happy-dom` explicitée dans package/lock.
- Liste exhaustive : `git show --stat 3b55ef5` et `git show --stat ce19601`. Contrats API compatibles, aucun nouvel enum métier, aucune migration SQL, aucun changement de stratégie ou de niveau de risque.
- Retour arrière : utiliser la procédure de release avec ses sauvegardes, contrôles et restauration exacte des scopes ; ne pas rétablir naïvement l'ancienne version sans réintroduire une première bascule à file vide. Aucun rollback non nécessaire effectué.
- Commits propres sur **`codex/grains-week-integrity`** ; `main` et les branches de Claude ne sont pas modifiés par ce lot. Le commit de compte rendu suivant n'altère pas le build VPS `ce19601`.

## Avancement et non-certifications

**TD2-433 et TD2-437 : réalisés, testés et déployés**, avec commentaires de preuve avant clôture. **TD2-435 : code livré, recette en revue**, pas déclaré totalement clos : attribution de première publication uniquement au SSE à compléter, défaut de lecture **TD2-438** et présentation déconnectée **TD2-416** explicites. **TD2-436** demeure au backlog : éviter les analyses redondantes sur les mêmes bougies hors séance.

Le prochain lot prioritaire est TD2-438, puis la recette complète TD2-435/416. Les tests techniques et le résultat de replay conditionnel **+2,04444444 R / +200 USD** ne constituent ni une validation de rentabilité générale, ni une preuve hors échantillon, ni une certification live/backtest historique avec données manquantes. La dette qualité statique préexistante demeure non résolue ; aucun seuil abaissé, aucune conformité globale revendiquée.

## Clôture TD2-438 — résilience de lecture du contexte Live Focus

Le défaut P0 de disparition intermittente du brief est corrigé et déployé sans changement de stratégie, de politique Risk ni d'autorité d'exécution.

- Cause : une vue Live Focus lançait quatorze sources en parallèle, tandis que le dépôt de contexte ouvrait sept lectures PostgreSQL concurrentes et indivisibles. Une expiration d'acquisition `pg-pool` annulait alors toute la source ; la projection transformait cette erreur technique en faux « contexte non publié » et en compteurs `0/0`.
- Correction : un seul client PostgreSQL, transaction `REPEATABLE READ READ ONLY`, lecture atomique snapshot/brief, enrichissements séquentiels bornés par budget et savepoints, diagnostics partiels explicites, et valeurs inconnues `null` au lieu de faux zéros.
- Index 068 : brief par snapshot/date et décisions de préfiltre par univers/date.
- Contrat Front : une indisponibilité de lecture est distinguée d'une absence métier ; un enrichissement dégradé conserve le snapshot et le brief canoniques datés.

### Validation locale

- Backend complet : **1 606 tests**, **1 557 réussis**, zéro échec, 49 ignorés selon leurs préconditions.
- Frontend : **325/325** tests et build de production verts.
- Tests ciblés backend/BFF/projection : **71/71** ; résilience unitaire : **3/3**.
- PostgreSQL réel : le nouveau scénario pool `max=1` prouve échec borné puis récupération. La suite globale a passé 69/70 lors d'une exécution ; l'ancien scénario de perte de connexion n'a pas atteint son rendez-vous enfant à temps sous charge, puis a repassé **2/2** isolément. Aucun fichier concerné par ce scénario n'est modifié par TD2-438.
- Typecheck, architecture Front, sécurité supply-chain, secrets navigateur, kit Windows, contrats stratégie, migrations et runtime-safety : verts. Trois audits npm : zéro vulnérabilité.
- Qualité statique globale : dette préexistante inchangée, seuils non abaissés.

### Release et recette VPS

- Release : `grains-live-focus-read-resilience-20260907.1`.
- Commit source : `62d861f86e321513fe9e2cc4e139cf70002bef05`.
- Archive SHA256 : `5f0c966c71fba06499698335a97f3dc95afb9b608f6a26e2fcb210e8c6df8d06`, **5 421 fichiers** vérifiés.
- Sauvegardes fraîchement créées, drain avec zéro travail actif, migration 068 appliquée, canary et contrôles publics verts, reprise vérifiée.
- Onze services sur onze `Running` et `Automatic`. Risque **500/2 000/4 000 USD** conservé. AUTO et LIVE physiques `false`, bridge Ninja désactivé, kill switch `true`, maximum physique `0`, legacy `false`.
- Tâches autonomes `DeskFutures-GrainsCalendarRefresh` et `DeskFutures-UsGrainsShadowRuntime` présentes et prêtes.

Recette Chromium authentifiée sur `/#/live?instrument=ZW&focus=1` : brief réel visible, aucun faux « Analyse de contexte non publiée » ni « momentanément indisponible », largeur document 1 280 sans overflow horizontal. Après une rafale volontairement hors profil, le service a récupéré automatiquement en 3,8 s. Sur huit rafraîchissements réalistes espacés : **8/8 HTTP 200**, **8/8 market-context AVAILABLE**, **8/8 briefs disponibles**, zéro brief manquant et zéro faux « non publié ». Une réponse globale PARTIAL concernait uniquement les sources distinctes session/macro/news ; le brief contextuel est resté stable.

Capture : `output/playwright/td2-438/live-focus-after.png`. TD2-416 (badge visuel de transport déconnecté) et les timeouts des sources session/macro/news restent des lots séparés ; ils ne doivent pas être confondus avec la perte de contexte corrigée ici.
