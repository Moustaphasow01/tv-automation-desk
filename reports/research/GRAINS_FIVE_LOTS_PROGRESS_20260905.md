# Desk grains — cinq lots et revue Live Focus

> État courant : voir [GRAINS_FINALIZATION_20260905.md](GRAINS_FINALIZATION_20260905.md). Le contenu ci-dessous est l'historique de la tranche 56b0b4a, avant migration 063, intégration visuelle et nouveaux tests. Il ne constitue plus le dernier état de livraison.

Date : 5 septembre 2026. Branche de travail : `codex/grains-week-integrity`.
Baseline du présent lot : `16f6c16a44a8e5f489776270f54193a67f910809`.
Correctifs et outils locaux versionnés : `56b0b4a` (pas de merge main ni de déploiement).
Pilotage/revue : agent principal ; exécution technique et contre-lecture déléguées à Terra/Luna.
Ce document distingue les corrections locales des fonctions qualifiées en production. Aucun résultat positif n'est une condition permettant d'abaisser un filtre.

## Statut et décision de release

| Lot | État | Condition restante |
|---|---|---|
| 1. Contexte macro causal | Collecteur et garde de couverture testés localement | Version historique complète et datée des calendriers NASS/WASDE/FAS ; manifeste courant exploitable sans faux AVAILABLE |
| 2. Chaîne canonique et exposition | Correctifs locaux revus ; parcours positif et concurrence PostgreSQL testés | Projection des pertes jour/semaine et compatibilité des policies VPS encore à qualifier |
| 3. Requalification comparable | Replay canonique PostgreSQL exécuté sur la semaine | Les 100 détections attendent une preuve macro ; aucune qualification de performance possible sur ce run |
| 4. Vérité front/Telegram | 15 tests Focus et 14 tests Telegram passent ; deux analyses et plan ciblé livrés | Intégration visuelle du nouveau ledger et livraison Telegram VPS non certifiées ; aucun redesign livré |
| 5. Merge/release/shadow | Non autorisé par les preuves actuelles | Conditions précédentes, canary, rollback et observation en marché ouvert |

**Pas de déploiement de cette tranche à ce stade.** AUTO/LIVE physiques non activés, aucun ordre broker, aucune confirmation humaine réelle. Les tests PostgreSQL créent leurs propres bases locales puis les suppriment. Aucun historique VPS n'est réécrit.

## 1. Calendrier agricole : connaissance, et non simple présence de lignes

Le collecteur officiel NASS a effectivement récupéré **58 événements**. Artefact généré : `output/research/grains-week-20260905/usda-nass-calendar-current.json`. Le texte source, son empreinte, sa date de récupération, la timezone et les identifiants d'événement y sont conservés.

Les heures flottantes du calendrier NASS sont interprétées en heure de l'Est ; midi correspond à 17 h UTC en hiver et 16 h UTC en été. Les heures invalides, ambiguës, documents HTML/HTTP en erreur et collisions d'identifiants sont refusés. `CROP_PRODUCTION` n'est pas confondu avec `CROP_PROGRESS`.

Cette collecte **ne certifie pas** la connaissance passée de la totalité des événements agricoles. Elle ne couvre pas à elle seule tous les calendriers NASS/WASDE/FAS. Les métadonnées ICS CREATED/DTSTAMP ne sont pas utilisées pour antidater la connaissance. Le résultat reste `UNKNOWN_COVERAGE`, motif explicite, pas un calendrier réputé vide.

Sources lues en contre-expertise :

- Calendrier officiel actuel : https://www.nass.usda.gov/Publications/Calendar/2026/NassReleases2026.ics
- Publication WASDE du 12 janvier 2026 : https://esmis.nal.usda.gov/publication/world-agricultural-supply-and-demand-estimates/2026-01-12
- Texte officiel correspondant : https://esmis.nal.usda.gov/sites/default/release-files/795722/wasde0126.txt
- Texte WASDE du 10 mars 2026 : https://esmis.nal.usda.gov/sites/default/release-files/795813/wasde0326.txt
- Rapport exportations du 29 janvier 2026 : https://apps.fas.usda.gov/export-sales/Year2026/CAM%201-29-26.pdf

Les publications datées établissent leur propre disponibilité ; elles ne prouvent pas une version annuelle exhaustive du calendrier futur. La cadence habituelle du jeudi n'établit pas les exceptions de jours fériés.

### Placement et contrat

- `adapters/usda-grains-calendar-collector.js` : acquisition et normalisation de la source externe ; le CLI produit un artefact, sans connexion à la base du desk.
- `grains-calendar-coverage.js` : contrôle partagé de preuve disponible à l'instant du signal, réutilisant le domaine agricole existant.
- `persistence/postgres-grains-runtime-inputs.js` : projection SQL bornée aux bougies closes et aux événements/manifeste déjà connus.
- Détecteur → bus : tous les signaux bruts continuent d'être produits. Contexte/préfiltre → `WAIT` si la preuve macro manque ; aucun forçage d'admission.
- Le replay/audit de préfixes transporte la même couverture, au lieu de l'oublier dans un mapper.

Le schéma existant de couverture conserve une ligne par source : il ne fournit pas à lui seul un historique immuable de toutes les versions. Les manifestes des replays devront donc fournir une provenance historique authentifiée ; un hash arbitraire n'est pas un substitut à une preuve documentaire.

### Tests vérifiés par l'agent principal

| Commande | Résultat |
|---|---|
| `node.exe --test mcp_gpt_desk/test/usda_grains_calendar_collector.test.js` | 7/7 passent |
| Tests `grains_calendar_coverage` + `grains_causal_detection_audit` | 14/14 passent |
| `RUN_POSTGRES_TESTS=1` + `grains_runtime_inputs_postgres` | 2/2 passent, aucune exclusion conditionnelle |
| Collecte officielle réelle par CLI Node Linux | 58 événements ; UNKNOWN_COVERAGE honnête |
| `node.exe scripts/quality/check_architecture_boundaries.mjs` | PASS, 468 fichiers au dernier contrôle |
| `git.exe diff --check` | PASS au moment du contrôle |

La suite causale élargie a d'abord révélé un lien d'installation Windows invalide (`desk-replay-engine` → `desk-domain`). Le lien généré dans `node_modules` a été réparé, sans changer les dépendances produit. Les tests ont ensuite été relancés avec succès. Ce premier échec n'est pas comptabilisé comme une réussite.

## 2. Risque et exposition : défauts identifiés

- Une position ou intention théorique d'un lot précédent doit consommer le budget du suivant, y compris entre ZC et ZW.
- Deux décisions concurrentes doivent partager un verrou de compte et lire un état cohérent avant persistance.
- Un Human Gate expiré ne libère pas arbitrairement un suivi théorique encore en cours ou indéterminé.
- Un refus Risk ne doit pas devenir un ordre de clôture implicite de la position existante.
- Une réduction de 0,85 appliquée à une proposition d'un contrat ne permet pas d'autoriser un contrat entier. Le refus de taille minimale doit rester explicite, sans gonfler la quantité pour produire un trade.
- Les limites de pertes jour/semaine ne peuvent pas consommer un zéro implicite parce que la projection des résultats clôturés manque.

Quatre tests PostgreSQL réels ont été relancés indépendamment et passent : concurrence opposée, réservation UNKNOWN malgré expiration humaine, limite de compte commune ZC/ZW et non-requalification d'un signal dans un lot ultérieur. La revue du code a imposé un seul snapshot SQL pour lire positions, réservations et signaux déjà qualifiés ; le verrou de compte est pris avant les verrous plus fins. Il ne s'agit pas d'une preuve expérimentale supplémentaire d'un fill concurrent MVCC. La dernière revue a aussi trouvé puis corrigé une préparation de gate manquante dans le test UNKNOWN : le service crée désormais réellement le gate, le repository d'expiration en expire exactement un, le SELECT confirme une ligne EXPIRED, et l'état UNKNOWN est persisté avant le snapshot. Relance finale par l'agent principal : 4/4, sans exclusion (`five-lots-exposure-postgres-final.log`).

Les quantités inconnues ne sont pas converties en zéro. Un mode physique/inconnu et une demande de statut historique non versionné sont explicitement refusés. Une position existante réserve l'instrument, dans les deux sens : pas de pyramiding ou de réduction implicite de position par un nouveau signal.

**Limite restante :** la projection `loss_usage_availability` est UNAVAILABLE. Si une policy demande un plafond de perte quotidien/hebdomadaire, le service bloque avec `LOSS_USAGE_UNAVAILABLE` ; il ne prétend pas que la perte vaut zéro. Le replay CLI utilise les paramètres par défaut du service local et ne certifie pas la policy VPS. De plus, 0,85 × une proposition d'un contrat conduit désormais à zéro contrat autorisable : c'est une conséquence explicite de l'indivisibilité, pas une raison pour augmenter artificiellement la proposition.

## 3. Mesures de performance : pas de chiffre de remplacement artificiel

L'ancien +116,4145 R reste non causal et non certifié comme résultat de chaîne complète. Le replay contextuel précédent n'était pas une preuve Portfolio/Risk/Human Gate. Les données avril–septembre déjà consultées ne deviennent pas un holdout vierge.

Le nouveau replay doit compter séparément : détections, décisions de contexte, arbitrages, Risk, TargetPositions, OrderIntents, Human Gates, fills théoriques, expirations prouvées et résultats indéterminés. Sans couverture documentaire disponible à la date testée, un `WAIT` est une limite de données, pas la preuve que la stratégie ne détectait rien ni qu'elle était rentable.

### Replay réellement exécuté : 31 août–4 septembre

Artefact final : `output/research/grains-week-20260905/canonical-postgres-week-safety-final.json`.

Empreinte SHA-256 de l'artefact : `ced4ebd5c880f3aafef8c6ce9e8cbe464f26fe77af83da40a2211b6b67ac3b02`.

Entrée : `vps-week-ledger.json`, 17 044 bougies, SHA-256 `8417abff18e08015cd58460dc1cfee312ceca360e8eff34e26bc5c3d0450bdf6`. Le manifeste final couvre 572 fichiers source/contrats/dépendances déclarées/migrations. Ses empreintes ont été revérifiées après le run ; le CLI refuse également un changement du code pendant l'exécution.

| Journée | Signaux publiés | Contexte WAIT | Human Gates | Fills théoriques |
|---|---:|---:|---:|---:|
| 31 août | 11 | 11 | 0 | 0 |
| 1 septembre | 16 | 16 | 0 | 0 |
| 2 septembre | 31 | 31 | 0 | 0 |
| 3 septembre | 21 | 21 | 0 | 0 |
| 4 septembre | 21 | 21 | 0 | 0 |
| Total | 100 | 100 | 0 | 0 |

Motif exact des 100 WAIT : `AGRI_CALENDAR_KNOWLEDGE_UNPROVEN`. À la fin de leur fenêtre, les 100 entrées de bus sont `cancelled` par expiration. Il n'y a aucune allocation Portfolio, décision Risk, TargetPosition, OrderIntent ou position. **R clôturé : non applicable, pas un rendement de 0 R.** Zéro commande provider, zéro message Telegram, aucune confirmation humaine.

Ce replay traverse réellement le bus/service canonique et persiste les décisions en PostgreSQL ; il ne fabrique pas les lignes refusées. Il contient 4 180 instants de contrôle et 108 lots de décision. Le suivi théorique précède la nouvelle décision au même instant, et ne lit que les bougies déjà closes. Les décisions sont rejouées aux publications, expirations et cutoff final ; ce mode pré-calculé causal ne prétend pas reproduire les latences réseau ni de futurs réveils de workers.

Les identités UUID valides sont conservées ; les identités non UUID sont remappées explicitement pour le bootstrap isolé. Les versions de stratégie du seed sont des références de bootstrap, pas une certification d'artefact VPS. Les doublons OHLC/volume/état contradictoires sont refusés, les doublons identiques dédupliqués. Sans heure de réception d'origine, le seed conserve UNKNOWN en provenance et sa propre heure d'import, sans antidater la réception au début de bougie. Un échec de nettoyage de la base remonte une erreur, il n'est pas masqué.

Une précédente répétition avec le même ledger a produit les mêmes 100 identités/sémantiques de signaux ; l'optimisation de l'import n'a pas changé ces sorties. Le manifeste final reste la référence, pas celui des runs intermédiaires. La comparaison avec la semaine live est limitée ici aux détections brutes ; ce n'est pas une preuve d'égalité des ordres ou des policies.

### Parcours positif contrôlé, distinct de la performance historique

Le test PostgreSQL de bout en bout injecte un jeu de contrôle identifié comme fixture : deux signaux opposés, un rejeté par le contexte, l'autre autorisé par Risk, un OrderIntent et un Human Gate non confirmé. Le moteur théorique commun détecte ensuite l'entrée limite après création puis le target. Aucune commande broker. Cela vérifie le câblage et la sémantique, **pas la rentabilité d'une stratégie sur des données de marché**.

## 4. Live Focus et Telegram

Les 14 tests existants Telegram ont été exécutés : format, séparation théorique/broker, expiration avant livraison et non-envoi d'un ordre expiré passent. **Aucun message réel n'a été envoyé** : ces tests ne prouvent pas la livraison VPS jusqu'au téléphone.

Deux analyses indépendantes de Live Focus, puis un plan de cinq corrections sont disponibles :

- `LIVE_FOCUS_DESIGN_ASSESSMENT_20260905.md`
- `LIVE_FOCUS_TECHNICAL_ASSESSMENT_20260905.md`
- `LIVE_FOCUS_REFINEMENT_PLAN_20260905.md`

Direction retenue : conserver le cockpit compact et les tickets verticaux à droite, réduire les effets décoratifs concurrents, hiérarchiser action/expiration/prix, regrouper les statuts et clarifier le parcours de qualification. Ce sont des propositions fondées sur le code ; elles n'ont pas été validées par de nouvelles captures navigateur et ne constituent pas un redesign livré.

Les modèles Focus/dashboard/plan de trade et le contrat Live Focus ont été testés : 15/15 passent. Les warnings SSR `useLayoutEffect` existants sont distincts des assertions passantes. Aucun fichier applicatif frontend n'a été modifié dans cette tranche. La méthode Impeccable/Operate a structuré les deux contre-lectures et le plan ciblé, sans imposer une nouvelle identité graphique. Une nouvelle tentative du navigateur par l'agent principal a échoué avant bootstrap (`sandboxCwd is not a local file URI`) ; aucun résultat visuel ne peut en être déduit.

## Validation finale locale

| Commande / preuve | Résultat |
|---|---|
| `node.exe --test mcp_gpt_desk/test/*.test.js` | 1 389 tests : 1 374 passent, 0 échec, 15 exclusions conditionnelles ; log `five-lots-backend-tests-final.log` |
| `node.exe --test packages/desk-domain/test/*.test.js` | 486/486 passent ; un ancien test attendait une cible FLAT sur Risk BLOCK, il vérifie maintenant l'absence de cible/ordre |
| PostgreSQL adapter + replay, `RUN_POSTGRES_TESTS=1` | 8/8 passent, aucune exclusion ; log `five-lots-replay-postgres-final.log` |
| Suite `test:grains:postgres` complète activée | 34/34 passent, aucune exclusion ; log `five-lots-all-postgres-final.log`. Après correction de la préparation du gate : 4/4 exposition relancés indépendamment |
| PostgreSQL exposition + pipeline positif | 4/4 + 1/1 passent indépendamment |
| Audit causal + replay contextuel après extraction | 12/12 passent |
| Budget Risk après extraction | 8/8 passent |
| Tests Focus ciblés / Telegram | 15/15 / 14/14 passent, pas de livraison réelle ni capture visuelle |
| Architecture / migrations SQL / diff | PASS ; 468 fichiers / 62 migrations et 143 tables / aucun whitespace invalide |
| Garde statique global | FAIL : fonctions longues 271/250, complexité 722/650, doublons 104/72, fichiers possiblement morts 29/17, autres grands fichiers historiques listés dans `five-lots-static-final.log` |
| Garde runtime global | FAIL : 133 usages directs d'horloge pour un budget de 130 ; dette non masquée |

Les 15 exclusions de la suite générale ne sont pas comptées comme des validations PostgreSQL. Les commandes PostgreSQL séparées activent explicitement ces tests. Aucun plafond, contrôle P0 ou baseline de dette n'a été baissé/relevé pour obtenir une CI verte.

## Conditions restantes avant de fermer les cinq lots

1. Obtenir/archiver une couverture agricole complète avec versions réellement connues aux dates évaluées ; préparer aussi la couverture prospective. Les 58 événements NASS actuels seuls ne suffisent pas.
2. Qualifier les budgets de perte sur le ledger as-of, les règles de taille minimale et les paramètres réellement utilisés sur VPS ; distinguer le budget de risque monétaire de la proposition de contrats avant dimensionnement, sans compenser un refus en forçant des quantités.
3. Rejouer la chaîne complète avec ces données/policies figées, produire le bilan par gate/jour/instrument puis les tests de robustesse. Aucune optimisation au holdout déjà consulté.
4. Implémenter et vérifier visuellement le plan Live Focus, puis vérifier la cohérence avec les projections et la livraison Telegram réelle en test identifié.
5. Résorber les écarts qualité bloquants, préparer le merge/release avec rollback, vérifier le canary et observer le flux en marché ouvert. Le retard de réception M1/M5 constaté auparavant n'est pas déclaré résolu par ce replay local.

## Dette, compatibilité et rollback

Pas de migration ni de dépendance produit ajoutée pour le garde macro. Le contrat d'entrée s'enrichit de `agriCalendarCoverage` ; une ancienne entrée sans preuve devient explicitement WAIT. Cette différence de comportement exige une nouvelle qualification avant production. La stratégie brute n'est pas retouchée pour rendre les résultats positifs.

Le retour arrière est celui de la future release versionnée, pas une suppression de lignes historiques. Tant que la qualification n'est pas complète, conserver la release VPS existante et l'état de sûreté, sans déclarer le desk prêt sur la seule base des tests locaux.
