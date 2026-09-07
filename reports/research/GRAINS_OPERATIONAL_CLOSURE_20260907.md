# Clôture opérationnelle grains — sept chantiers

Statut : **CALENDRIER AUTONOME VPS OPÉRATIONNEL — release .5 déployée ; programme global non clôturé**. Suivi Jira : TD2-426 / TD2-429.
Autorisation utilisateur du 7 septembre 2026 : calendrier automatique, corrections historiques,
plafonds 500/2 000/4 000 USD, chaîne théorique/Telegram/Focus, parité et robustesse,
déploiement et dépendances.

## Dernier état vérifié — 7 septembre, 14:48 UTC / 16:48 Paris

Cette section prévaut sur les journaux datés ci-dessous.

- Release servie `grains-operations-closure-20260907.5`, code
  `0909742e7de4c7e9c9819d9755dec7c6b1bcca2d`, migration 067. Déploiement normal
  `deploy-20260907T144052Z-d568a333` terminé `verified` à 14:45:03 UTC.
  Onze services Running, maintien du mode semi-manuel et des six protections
  d'exécution physique. Plafonds USD 500/position, 2 000/jour, 4 000/semaine inchangés.
  Identifiants des onze processus inchangés entre 14:46 et 14:48 ; heartbeat du suivi
  théorique healthy à 14:48:14 UTC, erreur nulle. Trois cycles grains autonomes
  post-reprise observés jusqu'à 14:47:57 UTC, huit instances évaluées à chaque cycle.
- **Déclenchement autonome réellement observé** : tâche Windows à 14:45:55 UTC,
  fin à 14:45:59, résultat 0, sans `Start-ScheduledTask` après cette release.
  74 événements, trois sources, version connue à `14:45:58.814Z`, fraîche jusqu'à
  `20:45:58.814Z`. Prochaine exécution déclarée à 15:15:55 UTC. Répétition PT30M,
  reprise après indisponibilité activée, chevauchement interdit. Le cycle récurrent
  suivant de 30 minutes n'a pas encore été observé dans cette recette.
- NASS et WASDE officiels restent obligatoires. FAS renvoie toujours HTTP 403 depuis
  le VPS ; la politique explicite `GRAINS_CALENDAR_SOURCE_POLICY_V2_DORMAN_FAS403`
  permet alors Dorman, identifié comme **source secondaire**, avec reçus et documents
  archivés. 27 reçus et documents vérifiés par SHA256. Aucune dépendance PC, aucun
  relais local, aucune date récurrente reconstruite par hypothèse.
- **Chaîne réellement raccordée** : `loadGrainRuntimeMarketInputs`,
  `loadCurrentGrainsCalendar` et le BFF Live Focus retournent `AVAILABLE`, sans
  reason code, sur la même empreinte
  `sha256:64746f1f644b630b877dfb13907a0a1cf2ac64a749783d0d6829bcc270eeb473`.
  Huit événements sont exposés dans leur fenêtre de lecture, sur 74 archivés.
  Le navigateur a reçu la nouvelle empreinte à 14:46:45 UTC, sans action métier.
- Surveillance Windows toutes les cinq minutes : santé locale `ok=true`,
  `degraded=false`. Les tests de calendrier absent, indisponible, mal configuré,
  réception trop ancienne et expiration passent. Alerte diagnostique après 60 minutes
  sans collecte ; connaissance courante périmée après six heures et refus de nouvelles
  admissions sur ce contexte. Aucun délai augmenté pour masquer la panne.
- Le collecteur fournit **dates et horaires de publications**, pas les chiffres
  effectivement publiés. Les huit événements lus n'ont pas de résultat chiffré. La
  collecte actuelle ne devient jamais une preuve de connaissance disponible avant
  sa réception ; le trou historique strict reste à qualifier pour les backtests.
- Neutralité des clôtures autorisées revérifiée après .5 : huit adjudications +
  49 clôtures administratives, zéro candidat restant sur ces 57 dossiers, aucune
  commande provider, aucun trade/fill ni événement manuel ajouté sur ce périmètre.
  Les neuf événements théoriques préexistants sont inchangés. Empreinte des six
  corrections monétaires toujours
  `9e23d1ec9e28d448cd354053f01ecc7935594d6c2dbd7634085a4b840282a8a4`.

### Correction, tests et sécurité de livraison

- Module propriétaire : adapter PostgreSQL des données marché. Fichiers modifiés
  dans ce dernier correctif :
  `mcp_gpt_desk/src/persistence/postgres-grains-calendar-ledger.js` et
  `mcp_gpt_desk/test/grains_calendar_version_ledger_postgres.test.js`.
  Les quatre dates PostgreSQL sont converties en ISO avant requalification :
  `Date.parse(Date)` supprimait les millisecondes alors que les reçus JSON les
  conservaient. Ni le domaine de preuve ni la stratégie ne sont modifiés.
- Comparaison production en lecture seule, **même version et même hash** : ancien
  lecteur `UNKNOWN_COVERAGE`, nouveau `AVAILABLE`. Test PostgreSQL isolé : cutoff
  `.533Z` refuse une version connue `.534Z`, puis `.534Z` l'accepte ; dates de
  couverture et reçus persistés restent exacts et inchangés. Dette réduite : quatre
  conversions temporelles implicites supprimées et une régression réelle enrichie.
- Validation .5 : PostgreSQL complet **61/61**, zéro skip ; tests ciblés calendrier
  **8/8 PG** et **11/11 evidence/freshness**. Build Windows : frontend historique
  **75/75**, VNext **311/311**, backend **1 509 réussis / 0 échec / 42 conditionnels
  ignorés**, ces tests PG étant exécutés séparément. 5 413 fichiers vérifiés.
  Contre-relecture indépendante sans bloquant. Les tests visuels et de transactions
  E2E globaux n'ont pas été intégralement rejoués pour cette correction d'adapter ;
  navigateur réel, lecture BFF et capture du Focus vérifiés sans confirmation.
- Aucune migration, aucun changement de contrat public, aucun changement frontend,
  aucun dégel IA ni exécution broker. Rejetées : suppression des millisecondes dans
  les preuves, affaiblissement du validateur, backdating, relais PC, faux statut vert.
  Pas de nouvel ADR nécessaire pour cette réparation de conversion à la frontière.
- ZIP .5 SHA256 `e0540c5e6976bcd943fcc1533465c5bfa6c40841fb067e13defd7d4f391f94ac`.
  Sauvegardes pré-bascule : DB `desk-native-20260907T143109Z.dump`, SHA256
  `d38656c07f70c859f9832e292efdbd99460edd8ca485e57892dc9dcf578fe44b` ; objets
  `desk-objects-20260907T143838Z.tar.gz`, SHA256
  `e5c3630c43fb53c75f985d3274b998ef285ec1c658bc1356ff079a0d642414a6`.
  Sauvegardes, drain, canary, reprise et contrôles habituels exécutés sans bypass.
  Le rollback logiciel .4 réintroduirait le refus du calendrier : garder alors
  l'admission fermée ; ne pas restaurer une ancienne base pour annuler le code.

### Limites et prochains chantiers — ne pas confondre avec le calendrier

- Le **brief et le contexte analytiques restent STALE**. Les files IA live et replay
  étaient PAUSED avant maintenance et sont restées PAUSED. Les services Windows
  démarrés ne signifient donc pas que les workers Codex effectuent des analyses.
  Les catalyseurs du brief peuvent être vides : cette propriété vient du brief,
  distinct de la source calendrier désormais disponible. Le calendrier de référence
  affiché dans un ancien brief ne doit pas être pris pour un nouveau brief.
- Huit instances grains tournent et leurs évaluations sont persistées ; le cutoff
  de bougies observé reste le 4 septembre à 18:20 UTC. Ce n'est **pas** une preuve
  de nouveaux signaux tradables ni d'un marché frais aujourd'hui. La santé technique
  verte n'efface pas ces états de données et de contexte.
- Restent distincts : le dossier théorique MNQ réservant 235 USD, hors des 57
  autorisations ; qualification de la fraîcheur marché et reprise cadrée du contexte ;
  preuve hors échantillon avec calendrier historiquement connu ; observation complète
  Telegram/positions sur un nouveau cycle réel. Le replay figé précédent reste
  conditionnel, pas une certification de rentabilité.
- Aucune conclusion générale « tout le desk est prêt à trader » n'est tirée de ce
  succès calendrier. TD2-426 et TD2-429 restent En cours pour leurs critères restants.

Preuves sous `output/research/grains-closure-20260907/` :
`runtime-release5-natural.json`, `calendar-live-input-release5-natural.json`,
`calendar-release5-scheduled-natural.json`, `calendar-release5-archives.json`,
`calendar-live-input-release4-same-version.json`,
`calendar-live-input-release5-same-version-candidate.json`,
`administrative-release5-after.json`, `release5-deployment-final.json`,
`runtime-release5-stable.json`, `theoretical-service-release5-stable.json`,
`calendar-release5-stable.json`,
`postgres-release5-root.log`, `build-release5-vps.log`, `deploy-release5-vps.log`.
Navigateur : `output/playwright/live-focus-readonly-20260907/release5-calendar-bff-natural.json`
et `release5-calendar-focus.png`. Aucun secret ni session navigateur annexé au rapport.

## Journal — 7 septembre, 14:24 UTC

État historique avant correction de relecture et déploiement .5.

- Release `.4` / `546d4b515ff157da8b02c5180e3532f27a99d711` installée ; reprise
  `VERIFIED_OPEN` à14:19:25UTC après quatre contrôles de santé espacés sur60s.
  Onze services Running, heartbeat broker_management healthy14:23:12UTC.
  Le timeout est corrigé : requête réelle historique48candidats2,984s, contre
  >45s avant. Aucun timeout relevé artificiellement, aucun candidat supprimé.
- Sauvegardes fraîches post-clôtures : DB14:00:58UTC SHA256
  `8641b61805a89d8cf1c7d9edf5623f88dc6c6c623ad7b98348cd6a9caa2cebc7` ; objets
  14:08:28UTC SHA256 `0a5618e2eacbf3b34b6bad6b6b7a35c8e7fbe84d6ecf4f9a239f3ddcaac60ed9`.
- Barrière de maintenance restaurée OPEN sous son propriétaire exact ; files IA
  live/replay antérieurement PAUSED conservées. Six protections physiques intactes,
  budgets500/2000/4000USD inchangés. Aucune confirmation HumanGate.
- Neutralité57 revérifiée : zéro candidat restant, zéro commande/provider/trade/fill
  sur ce périmètre ; neuf événements théoriques préexistants inchangés. Empreinte
  des six résultats corrigés identique :
  `9e23d1ec9e28d448cd354053f01ecc7935594d6c2dbd7634085a4b840282a8a4`.
- CollecteV2 via tâche Windows amorcée pour recette à14:20:02UTC, terminée
 14:20:06UTC : AVAILABLE74événements/3sources ; cadence30min activée, échéance
  naturelle14:49:05UTC. 17reçus/documents archivés vérifiés par SHA, échecFAS403
  conservé, Dorman explicitement secondaire. Ce succès de collecte **ne prouve
  pas encore l'admission runtime**.
- Défaut détecté par la preuve bout-en-bout : les lecteurs runtime/opérateur
  retournent UNKNOWN_COVERAGE/CALENDAR_SECONDARY_SOURCE_RECEIPTS_REQUIRED.
  La reconstruction passe des objets Date PostgreSQL à Date.parse, perdant les
  millisecondes ; les reçus JSON conservent leur précision et paraissent futurs.
  Correction adapter + régression PostgreSQL en cours, sans relâcher la preuve.
- Deux cycles de tâche grains réussis ; huit instances évaluées,16NO_SIGNAL,
  sourceDataCutoff04/09 18:20UTC. Ce heartbeat ne prouve pas des données marché
  fraîches aujourd'hui. Pas de signal/trade fictif généré pour la recette.
- Browser pendant interruption : dernière projection conservée, avertissement et
  commandes bloquées. Après reprise GET LiveFocus200, avertissement réseau disparu.
  La sémantique du bandeau « cherche un setup » mérite encore une qualification
  distincte des blocages de contexte/fraîcheur ; aucune refonte ajoutée ici.
- Tests .4 : domaine531/531, PostgreSQL61/61 sans skip, buildWindows et5413fichiers
  vérifiés. Replay figé .3/.4 identique105signaux/24HumanGates/7trades/+3,0444R,
  **régression conditionnelle seulement**, pas une certification de rentabilité OOS.

Preuves : `release4-recovery-receipt.json`, `runtime-release4-first.json`,
`calendar-live-input-release4-qualified-first.json`, `calendar-release4-archives.json`,
`calendar-release4-scheduled-proof.json`, `administrative-release4-after.json`,
`theoretical-service-release4-stable.json` dans `output/research/grains-closure-20260907/`.

## Journal — 7 septembre, 13:46 UTC

Cette section conserve l'état historique avant la reprise .4.

- Release VPS `.3`, code `b2363ce9f68e74c5a8fcb255312d70baa8820f2c`,
  migrations066/067 : installation vérifiée à13:26:51UTC. Ne pas confondre ce
  contrôle initial avec la stabilité du service après plusieurs cycles.
- Sauvegarde pré-release DB réelle à13:11UTC, SHA256
  `39cd180190740cb08cc6534dd591f794979dc7b1abb8e8392aaa0f0c1ba55bd2` ;
  archive objets SHA256 `61a69e524ffefd297796bc4ea07742ea5f4cf485bf43dd34ecb880771f0fcbff`.
- Huit clôtures appliquées13:31:06UTC, puis49 à13:31:08UTC. Vérification PostgreSQL :
  **57 réservations en attente avant → 0 après** ; plus aucun de ces57 candidats.
  Résultats corrigés, trades, fills et événements inchangés. Les consultations
  antérieures à la clôture conservent les réserves. Manifeste de maintenance rangé
  sous `incoming`, car les rapports source ne font pas partie de l'application
  déployée ; l'essai initial avait échoué en lecture seule avant toute mutation.
- Les six corrections monétaires et budgets500/2000/4000USD sont en place.
  **235USD restent réservés par UN AUTRE trade théorique MNQ**, hors des57 :
  `trade_portfolio_order_intent_a056d3b3696a71192b2a6484`, quantité2 ouverte.
  Ancien planSHORT attaché à une cible netteLONG ; aucun résultat ni clôture
  ajouté. Une décision opérateur distincte est nécessaire pour son traitement.
- Incident de reprise : `DeskFuturesBrokerManagement` tombe après30s,
  `Query read timeout` dans la sélection des candidats portfolio. Vérification
  READ ONLY : ancienne requête legacy3,95ms, requête portfolio toujours >45s,
  y compris JIT désactivé et après rafraîchissement des statistiques SQL.
  Aucun délai augmenté, aucun faux résultat vide substitué. Optimisation en cours.
- Activation calendrierV2 annulée par sécurité après cet échec de santé.
  Le test réel autonomeVPS12:06 était AVAILABLE, **mais la production resteV1
  UNAVAILABLE/FAS403 à cet instant**. Deux tâches productrices désactivées et
  barrièreDRAIN conservée sous le propriétaire exact
  `administrative-grains-20260907T1329487517330Z`. API/front accessibles,
  10services en marche, suivi théorique arrêté. Aucun dégelAUTO/LIVE/IA.
- Tests et replay figé indiqués ci-dessous restent valides pour leurs périmètres,
  mais ne prouvent pas la stabilité sur la volumétrie VPS. La nouvelle recette
  doit mesurer le temps de la requête réelle et plusieurs cycles du service.

Preuves locales : `output/research/grains-closure-20260907/administrative-before.json`,
`administrative-after.json`, `runtime-policy-activation-status.json`,
`theoretical-candidates-plan.json`, `theoretical-candidates-estimates.json`,
`theoretical-candidates-jit-off.json`, `theoretical-candidates-after-statistics.json`,
`residual-reservation-235-readonly-report.md`. Aucun secret publié.

## Journal de livraison — 7 septembre, 13:14 UTC

Cette section prévaut sur les entrées datées du journal ci-dessous. Les états anciens
sont conservés pour expliquer les décisions, pas présentés comme l'état actuel.

- Candidat `b2363ce9f68e74c5a8fcb255312d70baa8820f2c`, branche
  `codex/grains-week-integrity`. Autres worktrees et fichier inconnu `mcp_gpt_desk/nul`
  préservés ; aucun reset, merge forcé ou modification de la branche de l'autre agent.
- Clôtures exactes huit + 49 implémentées après les deux autorisations utilisateur.
  Manifeste49 bytes `8676ffc864f7cba031376973f76e02945b833fd33fdb9d9034903a8aef9973ba`,
  hash canonique piné `ff288ef3b29008b8968d6e45e8dece5ece8fe51aa431bfda7427a3bfa20f455b`.
  Les 57 n'ont aucun lien `trade_order_intent_id` legacy, vérifié sur le VPS.
  Leur clôture est prospective, atomique par lot, rejouable, append-only, sans
  fill/expiration/PnL historique inventé. Elles ne sont pas encore appliquées à cet instant.
- Anti-résurrection : candidats exclus après date effective + connaissance, horloge
  du service conservée par la façade, relecture après verrou avant mutation et garde
  DB contre les writers retardés. Courses dans les deux sens testées. Périmètre et
  limite d'isolation explicités dans ADR0033 ; pas de garantie universelle hors des
  writers runtime READ COMMITTED et des deux lots qualifiés.
- Recette root finale : 28/28 unitaires ciblés, **61/61 PostgreSQL réels sans skip**,
  couvrant Risk, bus canonique, Intent/Human Gate, suivi, ledger calendrier, Telegram,
  adjudications concurrentes et arrêt des producteurs. Source mirror comparée sur
  81 fichiers runtime modifiés : aucune divergence avec le candidat.
- Build Windows complet : front historique75/75 ; VNext311/311 ; backend1509 réussis,
  aucun échec, 42 tests conditionnels ignorés dans ce lancement seulement. Le PG réel
  est exécuté séparément et possède désormais un job CI dédié. Build/typecheck et
  vérification5413fichiers réussis, aucune option SkipTests/SkipBackup.
- Archive release `.3` : SHA256
  `2d158e02304922c38ef30aa0407f3accc551a290f431cdda119329ea710016d9`.
  Déploiement lancé ; sauvegarde préalable en cours. Release servie encore `.2`
  lors du dernier healthz, ce champ `live:true` est la vivacité HTTP, pas LIVE broker.
- Replay final figé31/08–04/09 : mêmes données, mêmes105 IDs/payloads, résultats
  journaliers identiques. 94admissibles Context, 24Human Gates, 7trades, 17expirations,
  4TP/3SL, +3,0444R/+237,50USD frais0, drawdown2R/225USD, provider0. Le code n'est
  pas identique au premier run car les correctifs sont précisément l'objet du test.
  Artefact `replay-release3-final.json`, SHA256
  `9d5ac440540c40d45718368438e3b4898c4ca08143462f2dbad18931e57d7022`.
  Cela prouve la non-régression conditionnelle, **pas la rentabilité OOS/PIT**.
- Contre-revue opérations corrigée : statut rollback honnête, hash exact de config
  liant drain et deux applications, SHA d'archive fourni hors bande avant exécution,
  tâches réarmées derrière DRAIN, reprise après santé seulement. Syntaxe Windows
  native PS3/3 et Node2/2. Barrière seule root13/13 tests dont PG avec écriture retardée.
- Contrôles architecture/migrations67/runtime/supply-chain réussis. Lockfiles registry
  sans empreinte désormais bloquants ; zéro vulnérabilité déclarée par les audits du
  jour, pas une preuve d'absence générale de vulnérabilité. Dette statique globale
  préexistante toujours rouge : 270fonctions longues,720complexes,97duplications ;
  aucun plafond augmenté pour la masquer.

À vérifier après installation : application57 et zéro réserve correspondante,
neutralité des six résultats corrigés, première publication V2 AVAILABLE dans le ledger,
planification autonome/fraîcheur, services et sécurité physique, recette navigateur.
La file IA live antérieurement PAUSED reste une question distincte : pas de dégel implicite.

## Journal de livraison — 7 septembre, 11:27 UTC

### Complément de contrôle — 12:03 UTC

- Calendrier V2 commité : `8d1352c`, `82b6504`. Vérification root : 44/44 tests
  calendrier, 18/18 tests d'archives/collecte et 8/8 tests PostgreSQL de ledger,
  aucun test ignoré. Préflight isolé sur VPS réussi à 12:06:51 UTC : AVAILABLE,
  couverture sept jours, 74 événements NASS/WASDE/ESR, reçu FAS403 immuable et
  source secondaire explicite. 35 archives, zéro incohérence SHA256. Ce préflight
  ne publie rien en PostgreSQL ; V2 n'est pas encore activée dans `current`.
- Audits de dépendances complets, backend / VNext / front historique : aucune
  vulnérabilité signalée le 7 septembre à 12:02 UTC. Le contrôle de chaîne
  d'approvisionnement relève des entrées sans empreinte. Correction `eb52ace` :
  102 empreintes registry rétablies depuis les métadonnées des versions exactes,
  sans changement de version ni de graphe. `npm ci` intégral réussi, six tests
  du guard passent. Les trois lockfiles sont désormais contrôlés et une empreinte
  registry manquante bloque ; les cinq liens workspace ne sont pas des archives
  registry. Ce succès n'est pas une certification de sécurité générale.
- L'examen des 49 réservations est terminé : trois fenêtres M1 complètes en base,
  une quatrième reconstruite avec un artefact natif scellé, 45 fenêtres
  indéterminées. Le statut `EXPIRED` seul n'est pas une preuve de non-fill.
  Détail : `GRAINS_49_RESERVATIONS_EVIDENCE_20260907.md`.
- **Nouvelle autorisation explicite reçue pour les 49** : aucun ordre manuel ni
  aucune position réelle correspondante encore ouvert, clôture administrative
  prospective autorisée, aucun résultat historique à inventer. Une extension
  distincte de la qualification `INVALID_ORIGIN` est en construction ; les 49
  n'ont pas été reclassées comme invalides et ne sont pas encore libérées.
- La contre-revue de déploiement impose de préserver les gels/kill-switchs plus
  récents, de contrôler propriétaire/révision lors de la reprise, et de refuser
  toute fausse réussite d'une transition n'ayant modifié aucune ligne.
  Une perte de connexion du verrou ne suffit pas à annuler une écriture déjà
  envoyée sur une autre connexion : la preuve PostgreSQL de l'arrêt ciblé des
  trois pools producteurs est exigée avant la release finale.

- Release réellement déployée : `grains-operations-closure-20260907.2`, commit
  `2d9f27f4b6bd0341c913553b35152390224447b3`, migrations 064/065. Pipeline normal
  sauvegarde/drain/migrations/canary/installation/santé et contrôles publics réussis.
  Aucun `SkipTests`, `SkipBackup`, activation AUTO ou ordre provider.
- Build Windows de cette release : frontend VNext 310/310, front historique 75/75,
  backend 1 474 réussis, aucun échec, 36 tests conditionnels ignorés dans ce lancement.
  Vérification de 5 230 fichiers. Les essais antérieurs restent identifiés ci-dessous.
- La sauvegarde pré-release a réellement été restaurée dans `desk_restore_check`,
  base distincte de production : 1 477 878 documents, 373 149 bougies et 63 migrations.
  L'archive d'objets a également passé son contrôle intégral. Ce test n'a pas restauré
  ni remplacé la base de production.
- Première activation des corrections historiques/plafonds interrompue **avant mutation** :
  Caddy est un service Windows dépendant de l'API et doit être arrêté avant elle.
  Configuration initiale et onze services rétablis, confirmé à 10:59 UTC.
  L'ordre d'arrêt/reprise du wrapper est corrigé. Le deuxième essai a réussi à
  11:19 UTC : six corrections, huit qualifications conservant les réserves,
  configuration monétaire 500/2 000/4 000 USD et reprise des onze services.
- Autorisation utilisateur reçue : aucun ordre ni position des huit dossiers anciens
  ne reste ouvert ; **clôture administrative prospective autorisée**. Un traitement
  append-only distinct est implémenté et commité (`3b56d75`, migration 066), avec
  18/18 tests unitaires/PostgreSQL réels réussis, sans skip. Il n'est pas encore
  déployé/appliqué. Ne pas confondre cette décision présente avec une preuve
  d'absence de fill dans le passé. Les requêtes antérieures à la date effective
  et à l'enregistrement de l'adjudication conservent les réserves historiques.
- Vérification supplémentaire des réserves : après qualification, 57 restent
  conservées. Les 49 hors autorisation ont toutes une économie monétaire connue
  et représentent 5 800,25 USD (MES 1 458,75 ; MNQ 3 954 ; ZW 387,50).
  Aucune ne relève de `INVALID_ORIGIN` ; leur statut EXPIRED ne suffit pas à
  prouver une absence de fill. Elles restent en cours d'examen en lecture seule.
  La libération administrative des huit rendra le montant calculable, mais ne
  suffira donc pas, à elle seule, à permettre de nouvelles admissions.
- Correctif Focus supplémentaire `29e60fc`, pas encore dans la release .2 : une
  erreur de projection d'exécution devient un HTTP 503 explicite. Le frontend conserve
  la dernière projection avec date/heure et avertissement, bloque les actions sensibles,
  et ne transforme plus un timeout en faux zéro. Tests frontend 311/311, build réussi ;
  tests backend ciblés 52/52. Aucun timeout augmenté pour masquer la cause.
- Calendrier V2 en cours : source Dorman explicitement secondaire, seulement en secours
  à un FAS HTTP 403, NASS et WASDE restant obligatoires. Politique versionnée distincte
  de USDA-direct, qui reste la valeur par défaut. Faisabilité vérifiée : 12 PDF 2026,
  53 dates Export Sales explicites, aucune récurrence calendaire extrapolée.
  **Ne pas lire ce point comme une autonomie déjà activée/certifiée en production.**
- Déploiement en revue : arrêt et désactivation des tâches grains/calendrier avant
  migration, enregistrement initial désactivé pendant installation, restauration de
  l'état antérieur après santé vérifiée. Les lancements CLI concurrents demandent en
  plus un protocole de verrou partagé avec le drain ; pas de fausse garantie via un
  simple SELECT préalable.
- Recette complémentaire root : PostgreSQL réel 56/56, sans skip, sur la source
  intégrant 066 et le correctif Focus mais avant calendrier V2/barrière finale.
  Plafonds domaine/configuration : 30/30. Projection explicite d'adjudication :
  7/7 unitaires/PG, sans skip (`9f1871e`). Ces résultats ne certifient pas encore
  les fichiers de calendrier/déploiement en cours de finalisation par les agents.
- Navigateur réel, release .2 : septembre −0,40 R sur trois clôtures ; total
  exposé −1,83 R sur sept clôtures, dont une antérieure au 31 août. Le détail
  publie +3,17 R objectifs, −4 R stops, −1 R autre clôture. Les périodes suivent
  la clôture, les tickets leur création ; le total est explicitement partiel.
- Contrôle workers IA : les services sont démarrés, mais la file `live` est
  encore `PAUSED / DEPLOYMENT_DRAIN` et le superviseur est `shadow` (observation).
  Le dernier brief IA réussi date du 2 septembre. Les 4 805 tâches CANCELLED
  sont principalement remplacées par une tâche plus récente, pas des milliers
  d'appels LLM actuellement en échec. Une tâche READY non réclamée est observée.
  Aucun réveil IA massif ni dégel implicite n'est déclenché pendant ce lot.
  Le runtime déterministe/calendrier possède ses propres tâches planifiées.

Preuves opérationnelles sous `output/research/grains-closure-20260907/` :
`build-release-vps-final.log`, `deploy-release-vps-final.log`,
`activate-grains-policy-vps.log` (échec récupéré), `runtime-after-activation-error.json`,
`activate-grains-policy-vps-retry.log` (succès),
`monetary-after-six-and-eight-qualification.json`, `runtime-after-approved-policy.json`.
Aucun secret dans ces rapports.

## Reprise des sept chantiers — 7 septembre

Contrôle VPS à 09:43 UTC : release précédente inchangée, onze services Running,
collecteur et tâche calendrier absents, registre canonique calendrier vide.
NASS/WASDE HTTP 200 ; FAS HTTP 403. Aucune dépendance PC installée.

- Replay figé après le premier durcissement : 105 signaux, 4 Human Gates, 2 trades,
  zéro provider ; 80 refus `PORTFOLIO_THEORETICAL_INTENT_RESERVED`.
  Cause prouvée : le moteur perdait la dernière bougie de la fenêtre M1 complète
  en matérialisant `entry_expired`. La projection conservait donc ces réserves.
  Le correctif transmet cette bougie réelle, sans relâcher le garde des anciens
  événements sans source. Tests agent : 29 unitaires et 18 PostgreSQL réussis.
  Replay de confirmation terminé à 10:04 UTC : mêmes données, 105 identifiants et
  payloads de signaux identiques, 24 gates, 7 trades, 17 expirations, 4 TP et 3 SL.
  Résultat identique à la référence : +3,0444 R / +237,50 USD, frais zéro,
  drawdown clôturé 2 R / 225 USD, aucun ordre provider. Le code diffère du baseline
  car il contient précisément le correctif : ne pas prétendre que le code est identique.
  La limite de provenance historique du calendrier reste applicable.
- Build candidat Windows refusé : deux tests CLI utilisaient `URL.pathname`
  comme chemin Windows. Remplacement par `fileURLToPath` ; les deux tests passent
  maintenant sur Linux et Windows VPS isolé, sans ignorer ni supprimer de tests.
  Suite Windows complète avec le runtime Python du build : 1 469 réussis,
  zéro échec, 35 tests conditionnels ignorés. Deux essais de lancement mal configurés
  (répertoire puis PATH Python) sont conservés comme erreurs de recette, pas masqués.
- `Set-DeskGrainsRiskPolicy.ps1` prépare uniquement la configuration approuvée
  500/2 000/4 000 USD, avec aperçu par défaut, contrôle d'empreinte, audit,
  sauvegarde et préservation de la politique physique. Aucun redémarrage caché,
  aucun réglage calendrier ou sélection modifié. Test Windows VPS isolé réussi.
  Le statut distingue configuration écrite et activation runtime encore à vérifier.
- Le wrapper de release conserve le domaine et le contact TLS de la configuration
  Caddy existante au lieu d'injecter une valeur d'exemple.
- Recette Focus précédente : pas d'overflow horizontal à 1366/1920/390 px,
  mais quatre défauts de libellés/temps et une intermittence de liste à vérifier.
  Lot de corrections ciblées confié à un agent, aucune nouvelle refonte.

Placement : `execution` possède la preuve d'expiration, `portfolio-risk` conserve
l'autorité des réserves ; `operations` livre les cinq paramètres monétaires sans
recalculer le sizing. Alternative refusée : supprimer la garde de provenance pour
retrouver artificiellement les anciens résultats. Aucun montant, date, fill ou
résultat historique n'est reconstruit sans preuve.

## Baseline et frontières

- Source : `codex/grains-week-integrity`, `592e0e4806ba49971a9df77070d8949e6e7c1430`.
- VPS contrôlé à 07:43:50 UTC : `grains-risk-integrity-20260906.1`, code `c1a72133d0b2db344c43c8b2d01a2c6d98d383d8`, migration 063, onze services démarrés.
- AUTO/physical broker OFF ; aucun ordre provider ni confirmation humaine de test autorisés.
- Plafonds approuvés, encore absents de la configuration VPS à cette baseline.
- Pas de modification des moteurs de stratégie pour optimiser les jours de recette.

## 0 — Calendrier automatique

Placement : `market-data`. Application `refresh-grains-calendar` avec ports collecte,
archives, publication canonique, verrou et statut. Adapters USDA/archives et ledger PostgreSQL.
Opérations : tâche Windows `DeskFutures-GrainsCalendarRefresh`, toutes les 30 minutes,
limite d'exécution cinq minutes, verrou PostgreSQL interprocessus, activation explicite.

Sources : NASS annuel ICS, dates WASDE officielles, calendrier FAS avec dates/heures
explicites. Aucun jeudi ou jour férié inventé. NASS/WASDE/FAS reçus et parsés en local ;
FAS refuse encore les requêtes depuis le VPS (HTTP 403), y compris dans Edge natif.
**Ce blocage externe n'est pas résolu.** L'utilisateur refuse un relais local : aucun
collecteur ni tâche planifiée sur son PC. Un alias Azure accessible a été écarté faute
de preuve officielle USDA ; l'API ESMIS consultée n'expose pas les prochaines publications ESR.

Correctif `e676de7` : les documents NASS/WASDE effectivement reçus sont archivés,
parsés et persistés même lorsque FAS échoue. La nouvelle version canonique est
explicitement `UNAVAILABLE`, avec sources reçues et raison FAS 403 ; elle ne prolonge
ni le dernier succès ni la fraîcheur. Le pipeline peut expliquer les données partielles
sans accepter de trades sur une couverture incomplète. Après intégration, 30 tests
calendrier/expirations dont PostgreSQL réel passent, sans aucun skip.

L'heure de connaissance est celle de fin de réception réelle, jamais le début de requête,
la date de l'événement ou une date historique choisie. Les documents bruts et reçus sont
archivés par empreinte avant publication. Une source incomplète n'est pas publiée comme
couverture valide. Un échec ne prolonge pas le dernier succès. Une version automatisée
expire après six heures ; le runtime passe alors en état périmé et n'admet pas de nouveaux
trades sur ce contexte. Les snapshots historiques qualifiés gardent leur sémantique figée.

Alternatives écartées : remplir la base avec un calendrier supposé ; antidater les
réceptions ; mettre à jour silencieusement la table événementielle historique ; allonger
une fraîcheur à chaque erreur ; appeler Internet pendant la transaction SQL d'append.

Tests locaux : 17 tests refresh réussis (publication, provenance, archives immuables,
échec partiel, horloge, fraîcheur, désactivation, secrets, idempotence et libération du verrou).
Validation PostgreSQL réelle : 8/8 tests ledger et runtime réussis, aucun skip. Le timeout
initial a été rejoué après désaturation de l'environnement ; les deux preuves sont conservées.

## 1 — Résultats et suivis anciens

Audit VPS en lecture seule : six outcomes finaux révision 1 ont `point_value=1`, alors
que le plan canonique autorisé porte 50. Correction attendue via révision, pas suppression
de l'ancienne valeur. ZC : total -1,25 USD enregistré, -62,50 USD après application de
l'économie canonique. ZW : deux résultats -137,50/+137,50 USD, total nul mais erreurs
individuelles bien présentes. Les R et mouvements de prix ne sont pas multipliés par 50.

Les huit anciens plans et signaux sources ne possèdent pas d'entrée exploitable
(`entry.price=null`, économie indisponible). Une zone de setup ne permet pas de reconstruire
un prix officiel après coup. Quatre expirations ont été matérialisées au redémarrage sans
bougie source ; elles ne prouvent pas l'absence de fill historique. Une qualification
administrative append-only `INVALID_ORIGIN_PLAN / UNQUALIFIABLE` est implémentée.
Cette qualification ne fabrique pas un cycle d'exécution et ne libère pas les réserves.
Les expirations sans bougie ne peuvent plus être considérées comme preuve suffisante
de libération par la projection de risque. Ces six corrections et huit qualifications
ont été appliquées à 11:19 UTC : anciennes révisions conservées `void`, nouvelles
révisions `final`, point value 50 USD et R inchangés. L'adjudication administrative
prospective des huit, distincte de cette qualification, attend encore la release 066.

## 2 — Plafonds

Configuration VPS appliquée et relue à 11:19 UTC : `MONETARY_RISK_BUDGET`,
500 USD/position, 2 000 USD/jour, 4 000 USD/semaine, devise USD. L'admission reste
conditionnée à l'intégrité des résultats et aux réserves réellement en cours :
« configuré » ne signifie pas « nouvelles admissions possibles ». Les 49 autres
réserves anciennes exigent une preuve distincte. Aucune garantie contre le slippage.
Le suivi théorique et l'autorisation physique restent distincts.

## 3 et 4 — Chaîne et résultats

Frontend VNext : 308/308 tests, typecheck et build réussis. Front historique : 75/75 tests,
typecheck et build réussis avec le lockfile corrigé. Backend final : 1 470 réussis,
zéro échec, 34 tests PostgreSQL conditionnels non exécutés dans ce lancement.
PG historique final : 10/10 tests réels, zéro skip (correction, qualification et moteur).
Ils s'ajoutent aux huit tests PG calendrier/runtime cités plus haut.
Telegram trading : message de test non-ordre livré à 08:57:42 UTC, message 2580.
Configuration inchangée, aucun ordre ni confirmation Human Gate créés.

À effectuer après intégration finale : autres tests PostgreSQL de bout en bout,
recette visuelle du Focus, puis replay figé avec gates complets,
comparaison live et période hors échantillon. Aucun résultat brut de signal ne sera présenté
comme résultat de trade admis. Coûts, qualité M1/M5, dates de connaissance du calendrier et
concentration des gains doivent figurer dans le rapport final.
Le premier replay de ce lot a été invalidé par la protection d'empreinte du code pendant
la fin de synchronisation : aucun résultat retenu. Nouvelle exécution sur 621 fichiers figés.

Limite OOS : aucune fenêtre historique complète NASS/WASDE/FAS n'est actuellement
qualifiable sous la politique stricte de dates FAS explicites. La semaine du 31/08 au
04/09 contient une date ESR dérivée d'une règle de 2019 ; son replay peut servir à la
non-régression conditionnelle, pas à certifier une rentabilité hors échantillon. Les 42
événements legacy sans heure de connaissance ne sont pas promus en preuve historique.

## 5 — Déploiement et dépendances

Correctif Windows testé localement et sur le VPS en répertoire isolé : capture native
UTF-8, codes de sortie bloquants, reprise
de services indépendante d'une journalisation SQL défaillante, reprise de claims uniquement
après rollback compatible et santé vérifiée. Rollback sans redémarrage imbriqué,
respect de `KeepFrozen`. Aucun `SkipTests` prévu. La santé Windows expose désormais
séparément les dégradations du calendrier (dernier échec, cadence >60 min, expiration,
configuration invalide). Un FAS 403 ne déclenche pas à lui seul un rollback logiciel.

Audits npm complets, dépendances de build incluses : zéro vulnérabilité connue dans
les trois racines (racine historique, backend et VNext). Correctifs épinglés sans
changement majeur : `fast-uri` 3.1.6, `qs` 6.16.0, `nanoid` 3.3.18, `postcss` 8.5.23,
`undici` 7.29.0. La seule analyse production aurait manqué trois alertes du build.
Références : [fast-uri](https://github.com/advisories/GHSA-f65p-4m7j-42xc),
[qs](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g).

Contrôles architecture, migrations, runtime safety, compatibilité API, gouvernance PR,
exceptions et kit Windows réussis. Dette préexistante : qualité statique et scorecard
rouges déjà sur la source déployée. Mesure avant/après : fonctions longues 270/270,
complexité 720/719, duplications 95/95 ; aucun plafond augmenté pour obtenir du vert.

## Preuves

`output/research/grains-closure-20260907/` contient la nouvelle baseline VPS et l'audit
des dépendances. Les preuves précédentes restent dans `grains-risk-closure-20260906/`.
Aucun secret, PIN, cookie, URL de connexion ou donnée fictive n'est une preuve livrable.
