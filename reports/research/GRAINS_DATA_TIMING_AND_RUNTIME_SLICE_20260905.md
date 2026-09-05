# Grains — première tranche de fiabilité et sûreté du runtime

Date : 5 septembre 2026. Epic TD2-424 ; tickets TD2-426 et TD2-429 en cours.
Branche locale : `codex/grains-week-integrity`. Baseline de cette tranche : `fe6b79f17024f1dcfd3cf2278268b176cd1ae6f0`.

## Résultat et limites

Les correctifs locaux distinguent clôture de bougie, réception backend et première insertion de l’événement. Ils empêchent le lanceur grains de réactiver une instance en pause et rendent ses modes dry-run/no-publish non mutateurs.

Ce n’est **pas** une requalification des stratégies, un nouveau résultat en R ou une correction de toute la roadmap. Les conditions de détection et de filtrage sont inchangées. Le +116,4145 R historique reste non certifié causal. Aucun ordre broker, confirmation Human Gate, import, changement de service ou déploiement VPS n’a été effectué dans cette tranche.

## Organisation réellement utilisée

Le pilote garde architecture, choix de périmètre, critères d’acceptation, revue des diffs, tests d’intégration et Jira. Deux exécutants Terra traitent ingestion/sûreté du runtime et santé des données ; un exécutant Luna traite le diagnostic historique reproductible. Ils ne committent ni ne déploient séparément.

La revue a demandé plusieurs corrections avant acceptation : rapprochement réel M1→M5, doublons contradictoires, numériques PostgreSQL en chaînes, métadonnées de réception non falsifiables, lien exact à l’événement courant et test concurrent de pause/publication. Les tests sont ensuite relancés par le pilote. Aucun gain de quota n’est présenté comme mesuré par modèle.

## Observations VPS, en lecture seule

Release répondant à /healthz : `live-focus-dashboard-20260905.2`. Lecture SQL à 2026-09-05T10:31:46.573Z, transaction `BEGIN READ ONLY`, délai SQL maximal 15 s, `ROLLBACK`. Huit instances grains sont `running/shadow` ; cela ne prouve pas qu’elles produisent des signaux à marché fermé.

Les dates ci-dessous sont des dates **UTC explicites**, pas des dates SQL converties silencieusement par le fuseau Windows. Population : événements webhook grains M5, toutes heures, et non seulement bougies ayant produit un signal.

| Date UTC | Symbole | Événements | Clôture → première insertion événement, médiane min | Clôture → received_at legacy, médiane min |
|---|---|---:|---:|---:|
| 2026-08-31 | ZC1! | 207 | 0.090 | 0.090 |
| 2026-08-31 | ZW1! | 207 | 0.090 | 0.090 |
| 2026-09-01 | ZC1! | 209 | 0.115 | 0.114 |
| 2026-09-01 | ZW1! | 209 | 0.115 | 0.114 |
| 2026-09-02 | ZC1! | 203 | 0.204 | 0.203 |
| 2026-09-02 | ZW1! | 203 | 0.204 | 0.203 |
| 2026-09-03 | ZC1! | 205 | 10.118 | 10.117 |
| 2026-09-03 | ZW1! | 205 | 10.118 | 10.117 |
| 2026-09-04 | ZC1! | 206 | 10.122 | 10.122 |
| 2026-09-04 | ZW1! | 206 | 10.122 | 10.122 |

Toutes ces lignes sont legacy : `received_at` pouvait être réécrit lors d’un doublon ; `imported_at` est une première insertion, pas la visibilité après commit ni la date d’une correction OHLC. Ces observations convergent vers un retard présent avant le calcul des stratégies, mais **ne prouvent pas** sa cause amont : source différée, configuration de l’alerte, transport ou autre cause restent à vérifier.

Le 2 septembre contient aussi 28 événements M5 de secours par instrument, avec une médiane de première insertion environ 43,25 min après clôture. Ils ne doivent pas être mélangés aux alertes durables. Le 4 septembre en contient trois par instrument.

### Journaux HTTP disponibles

Sept fichiers Caddy présents ont été lus ; aucune ligne JSON illisible. Extraction bornée au chemin webhook, sans paramètres URL, en-têtes, secrets ou corps de requêtes. Les statuts 0 ne sont **pas** classés comme des succès.

| Date UTC | Requêtes | 202 | Statut 0 | 401 | 422 | 502 | p95 s | max s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 31/08 | 1304 | 1189 | 108 | 3 | 0 | 4 | 2,489 | 2,699 |
| 01/09 | 1296 | 1129 | 143 | 10 | 0 | 14 | 2,540 | 2,698 |
| 02/09 | 1298 | 1158 | 55 | 1 | 77 | 7 | 1,856 | 2,698 |
| 03/09 | 1273 | 1054 | 118 | 13 | 87 | 1 | 2,527 | 2,698 |
| 04/09 | 1302 | 1124 | 97 | 11 | 69 | 1 | 2,358 | 3,627 |

Les durées HTTP ne suffisent pas à expliquer un décalage de dix minutes. Elles ne mesurent pas le temps avant l’arrivée au proxy. Les logs regroupent tous les instruments/timeframes ; aucun lien par bougie n’est inféré. Les erreurs 401/422/502 et le statut 0 exigent une attribution dédiée ; les durées courtes ne signifient pas un flux intégralement sain.

## Qualité de l’échantillon figé

Entrée : `output/research/grains-week-20260905/vps-week-ledger.json`.
SHA-256 des **octets du fichier** : `8417abff18e08015cd58460dc1cfee312ceca360e8eff34e26bc5c3d0450bdf6`.
17 044 bougies exploitables, aucune ignorée ; 28 signaux reliés par feed + cutoff exact.

Sur 31 août–4 septembre, ZC et ZW réunis :
- 506 fenêtres M5 avec OHLC identiques à l’agrégation de cinq M1 ;
- 14 divergences OHLC, soit 14/520 fenêtres complètes (2,69 %) : 13 ZC, 1 ZW ;
- 56 fenêtres incomplètes en M1 ;
- 4 fenêtres avec M1 complètes mais M5 absente ;
- 10 fenêtres de bord de session classées séparément, sans les compter comme des trous complets.

La comparaison de volume est indépendante de celle des prix. Aucune source n’est remplacée automatiquement. Les trous sont ceux de l’export figé, pas une preuve de l’état actuel de chaque ligne VPS.

Le calendrier du diagnostic réutilise la session Chicago du projet (jours de semaine, 08:30–13:20, bord final séparé). Ce n’est pas un calendrier certifié des jours fériés/fermetures exceptionnelles de l’exchange. Une journée totalement absente de l’entrée n’est pas inventée par le diagnostic.

Le cutoff des 28 signaux historiques correspond à l’**ouverture** M5. La comparaison à sa clôture ajoute cinq minutes, sans renommer le champ source. Le champ explicite `published_at_utc` est absent/null dans cet échantillon : le rapport laisse la latence de publication indisponible. `created_at_utc` date l’enregistrement en outbox et ne doit pas être présenté comme un accusé de réception du bus. Les anciens chiffres appelés « publication » à partir de cette création doivent se lire comme « création/persistance du signal ».

## Correctifs et protections locales

| Sujet | Défaut | Correction / preuve attendue |
|---|---|---|
| Réception | Doublon pouvant modifier received_at | Première réception conservée ; corps client non autoritaire |
| Version OHLC | Première insertion de bougie confondue avec disponibilité de sa correction | Lien event_id propre à la version reçue ; ancienne preuve non réécrite |
| Source | Un autre événement au même timestamp peut masquer l’origine courante | Santé basée sur l’événement lié ; mismatch explicitement non durable |
| Fraîcheur | Bougie ouverte/future ou feed dupliqué pouvant fausser la lecture | Bornage à la clôture ; identité de chaque paire requise ; toutes les dates vérifiées |
| Hors session | Fermeture normale confondue avec panne | Dernier état connu distingué, sans masquer manquants/secours |
| Pause | Lanceur forçant shadow→running | Heartbeat des RUNNING uniquement ; aucun démarrage implicite |
| Simulation | dry-run écrivait heartbeat/évaluations/événements, voire DDL | Validation du schéma et lectures uniquement ; flags validés avant initialisation |
| Course opérateur | Pause entre sélection et publication | Vérification sous verrou PostgreSQL, sans supprimer un signal antérieur |
| Lot de signaux | Une pause tardive bloque le reste | Non-publication motivée du concerné, poursuite des instances encore actives |

Détail du contrat temporel : `docs/engineering/GRAINS_DATA_RELIABILITY_SLICE.md`.

## Vérification et livraison

Les résultats définitifs de la revue intégrée sont consignés dans le document de tranche et la roadmap. Les contrôles de qualité préexistants non verts ne sont pas désactivés. Le VPS reste sur sa release précédemment servie.

## Suite, sans fausse clôture

1. Attribuer précisément le retard amont et les refus HTTP ; mesurer prospectivement à marché ouvert après release.
2. Finir le moteur causal TD2-429 : préfixe disponible, clôture M5, calendrier as-of et une seule exécution live/replay ; publier les signaux détectés avant les filtres au bon endroit.
3. Vérifier contexte/worker sans bypass, puis chaîne canonique des gates.
4. Relancer mêmes données/même policy/version, publier les résultats et incertitudes ; ensuite robustesse sans ajustement au holdout déjà consulté.
5. Intégrer vérité produit, release/canary et observation shadow. Aucun passage Done global ni annonce de rentabilité avant ces preuves.
