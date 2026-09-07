# Reprise contrôlée du contexte grains — TD2-432

## Périmètre et état de recette

Chantier autorisé par le GO du 7 septembre 2026, lié à TD2-426 et TD2-429.
Baseline locale : `codex/grains-week-integrity`,
`1f4fe327c55eaba793ba663ff630384a3d594884`.
Baseline VPS vérifiée : `grains-operations-closure-20260907.5`,
`0909742e7de4c7e9c9819d9755dec7c6b1bcca2d`, migration 067.
Cette section décrit le candidat ; seule une preuve de livraison ci-dessous
pourra attester sa présence sur le VPS. Aucun changement de stratégie, aucun
nouveau backtest optimisé, aucune confirmation humaine ni commande broker.

## Diagnostic fondé sur la production

- Calendrier autonome : deux cycles naturels réussis à 14:45 et 15:15 UTC,
  74 événements, trois sources. À 15:15:59.480, la version
  `f698d0d8-75d3-42a4-b9f6-ff7b08fc6c1f` est AVAILABLE jusqu'à 21:15:59.480.
  NASS et WASDE restent obligatoires ; le refus FAS 403 et le recours qualifié
  à Dorman sont conservés avec leurs reçus. Aucun relais PC ni déclenchement
  manuel de ces deux cycles. Le calendrier fournit les dates et horaires,
  pas les chiffres effectivement publiés ni une connaissance historique rétroactive.
- Analyste : superviseur Windows Running mais `shadow/SHADOW_NO_CLAIM` ;
  un READY, dernier brief du 2 septembre. Les anciennes files IA PAUSED ne
  sont pas consultées par ce superviseur générique : elles ne sont pas la cause
  de ce blocage. L'installation réécrivait son mode en shadow à chaque release.
- Temporalité : le calendrier et la validité du brief étaient évalués au vieux
  timestamp d'ouverture des prix. Un brief créé lundi pouvait donc être déjà
  expiré. Les prix et la connaissance analytique nécessitent deux horloges.
- Données : dix feeds grains activés, derniers M1 et M5 clôturés vendredi
  4 septembre à 18:20 UTC. Vendredi, par instrument : M1 288/290
  (trous 14:24 et 16:18), M5 57/58 (trou 14:20). Dernières réceptions
  observées environ +10/+11 minutes, une réception par timestamp. Ces lignes
  sont legacy, sans event_id ni timing_provenance_version : observation,
  pas preuve certifiée du délai causal. Le délai webhook configuré est 1 200 s
  pour les cinq timeframes ; il n'est pas augmenté par ce chantier.

## Corrections et responsabilité des modules

| Module | Responsabilité et preuve attendue |
|---|---|
| Domaine market-context | Contrat additif `analysisAsOfUtc` / `marketDataCutoffUtc`, causalité et publication contrôlées ; ancien contrat conservé. |
| Scheduler grains | Calendrier/session lus à l'analyse, bougies fermées au cutoff prix commun ; anciennes tâches READY superseded par le contrat V2. |
| Runner Codex | Contexte consultatif ; refuse les anciens bundles et les analyses terminées après leur échéance ; conserve la conversation gérée par le runtime. |
| Repository PostgreSQL | Dates conservées à la milliseconde ; couverture requalifiée à son data_cutoff, pas à la date d'observation. |
| Calendrier RTH grains / data health | Fermeture Labor Day bornée, dernière clôture exigée, attente explicite des premières bougies à la réouverture. |
| Projection BFF Live Focus | Le libellé existant « données arrêtées à » reçoit le cutoff prix ; le snapshot conserve les deux horloges. Aucun redesign frontend. |
| Installation Windows | Préserve seulement un superviseur déjà autorisé, même runner/pool/périmètre/concurrence ; nouveau déploiement inconnu en shadow, désactivation explicite prioritaire. |

`sourceDataCutoff` du nouveau snapshot reste l'horloge de connaissance ; OHLCV
est vérifié au `marketDataCutoffUtc`. La couverture des prix n'est jamais étendue
artificiellement jusqu'à lundi. `validFrom` commence à publication et `validUntil`
reste analyse + 30 minutes en OPEN / 60 sinon. Une normalisation répétée conserve
les valeurs nulles, sans les transformer en faux zéros.

La fermeture est **RTH_ONLY pour le 7 septembre 2026**, prochaine ouverture
8 septembre 13:30 UTC. Ce n'est pas une certification de tout le calendrier CME
ni une assertion de fermeture overnight. Sources :
[CME Holiday Schedule](https://www.cmegroup.com/trading-hours.html) et
[fiche horaires grains CME](https://www.cmegroup.com/trading/agricultural/files/grain-and-oilseed-futures-options-fact-card.pdf).
La vue produit Globex authentifiée n'a pas été obtenue (401).
Seules les clôtures M1/M5 du vendredi à 18:20 sont acceptées comme dernier état
connu ; jeudi ou vendredi tronqué restent stale. À la réouverture, l'attente
des premiers bars n'autorise rien (`ok=false`). Fin d'admission RTH exclusive
13:20 CT ; les prédicats historiques de stratégie ne sont pas modifiés ici.

## Autorités et sécurité

Le filtre validé des signaux grains reste le contexte déterministe causal
embarqué (`prefer_embedded_context_gate_decision`). L'analyste améliore le brief
et le contexte publié, sans remplacer ce filtre ni promettre une amélioration
du résultat financier. Pas de modèle par stratégie ni d'ouverture des files
recherche/replay/legacy.

Activation prévue : une seule tâche READY V2, zéro autre tâche contextuelle
active/ancienne claimable, mission ADVISORY_ONLY et concurrence 1 ; vérification
du SHA release et de l'empreinte XML avant l'actuateur existant. Repli ciblé
en shadow si l'activation échoue. Pas de transformation d'une ancienne tâche V1.
AUTO, LIVE physique et legacy execution restent OFF ; plafonds USD
500/position, 2 000/jour et 4 000/semaine inchangés. La réservation MNQ distincte
de 235 USD reste hors autorisation des 57 clôtures déjà effectuées.

## Replay de non-régression — ne pas confondre avec rentabilité prouvée

Vendredi 4 septembre, entrée et politique figées, moteur PostgreSQL canonique,
baseline détachée `1f4fe327` : 22 signaux bruts, 22 admissions contexte,
14 décisions portefeuille, 10 décisions Risk (6 acceptées / 4 rejetées),
6 TargetPositions / OrderIntents / Human Gates. Suivi : 3 fills,
3 expirations avant entrée, 2 targets, 1 stop, **+2,04444444 R conditionnels**.
Zéro provider et Telegram désactivé dans le replay isolé.

Artefact baseline SHA256 :
`f6590eab4cf121bd04b0b38fff8e276850fda87d38cc1f917b22f5cbc12047ed`.
17 445 bougies d'entrée figées. La voie stricte reste BLOCKED : trous de vendredi,
2 431 bougies du vendredi importées le 6 septembre (dont 696 RTH), provenance
de réception historique non établie et calendrier courant non rétrodaté.
Ce résultat n'est donc ni OOS certifié ni performance effectivement réalisée
par le desk en live.

Comparaison post-correctif `cd554226c409243987ac98db3d36faded876c738` exécutée
avec exactement les mêmes entrées et politique : mêmes chiffres, mêmes décisions
Context/Risk/Target/Human Gate, mêmes trades et outcomes. Empreinte sémantique
commune : `712de973ec83f5ea632004171907e6dfb22feb09f4f1415f2d52a2fc00b7d915`.
Artefact post-correctif SHA256 :
`bb70601e93824cf4cecf50c2334f46281996cd717972b61b4bb9b57730c826be`.

La comparaison a aussi révélé une anomalie indépendante, **TD2-433, ouverte** :
`pending_order_intents.created_at_utc` prend `DEFAULT now()` lorsque le repository
omet cette date ; la projection exposure réutilise cette horloge réelle dans
`positions.observed_at_utc` et cinq identifiants de runs Portfolio. Six dates
d'intents diffèrent entre deux replays identiques. Les résultats économiques
observés sont inchangés, mais l'impact causal potentiel interdit de certifier
une reproductibilité intégrale du ledger. Pas de correction ajoutée en cours
de déploiement. Correctif ciblé ReplayClock et double replay à prévoir avant
certification stricte ; aucun assouplissement de Risk ou de stratégie.

## Validation, dette et limites

- Domaine complet : 537/537 ; deux horloges/causalité/normalisation : 12/12.
- Round trip PostgreSQL réel : 1/1, précision .533/.534/.535 et absence d'effet provider.
- Tests projection Focus : verts, dont deux nouveaux tests double/ancien cutoff.
- Tests session/data-health : 25/25 ; données grains 37/37 ; runtime grains 17/17.
- Contre-revue indépendante : a identifié l'ordre d'activation des anciennes
  tâches et le libellé du cutoff BFF ; compensations intégrées ci-dessus.
- Candidat final ciblé : 78/78 sans skip ni annulation ; API complète 52/52.
  Test PowerShell natif de conservation du superviseur : PASS ; garde du kit
  Windows : PASS, 107 fichiers. Suite backend complète Linux : 1 570 tests,
  1 528 pass, 42 skips conditionnels, zéro échec/annulation. PostgreSQL réel
  ciblé : 17/17, sans skip (calendrier, causalité, runtime, horloges et
  persistance atomique signal → Risk → TargetPosition → OrderIntent → Human Gate).
  Build Windows : 1 570 tests backend, 1 527 pass, 43 skips conditionnels,
  zéro échec/annulation ; frontend historique 75/75, VNext 311/311.
  Archive vérifiée : 5 418 fichiers. L'ancien test de timeout Linux (14 août)
  utilisait une promesse sans handle actif ; double test-only corrigé, délai
  et assertions du BFF inchangés. Aucune annulation comptée comme réussite.
- Architecture : module session dédié, duplication de la logique grains retirée
  de data-quality/freshness ; deux conversions Date implicites et les faux zéros
  de renormalisation supprimés, tests de frontière ajoutés. Aucune migration,
  dépendance ajoutée ni affaiblissement des règles de preuve. ADR existants
  0009/0010/0013/0024/0032 applicables, pas de nouvelle autorité introduite.
- Qualité statique globale : dette préexistante encore rouge, non masquée.
  Le succès des tests ciblés ne vaut pas clôture de toute cette dette.
- À traiter séparément : preuve d'une journée avec reçus live nouveaux et
  calendrier historiquement connu, frontière bar-open/closed-bar historique,
  qualification des autres jours fériés et configuration multi-univers.

Preuves techniques locales sous
`output/research/grains-context-resumption-20260907/`. Aucun secret, cookie,
PIN, environnement complet ou état de session navigateur dans ce rapport.

## Livraison constatée le 7 septembre

- Release réellement servie : `grains-context-resumption-20260907.1`, source
  `cd554226c409243987ac98db3d36faded876c738`, migration 067 inchangée.
  Archive SHA256 `0a04727505c08bf9a85631d41e46b63a3e333ff0c1db85f9dac207001bda821b`.
- Déploiement normal `deploy-20260907T155121Z-b001c5a0`, terminé vérifié et
  rouvert vers 15:55 UTC : canary, santé locale, front/health/readiness publics,
  rejet webhook sans secret, restauration des contrôles et conservation des
  paramètres protégés. Aucun SkipBackup/SkipTests. Onze services Running,
  démarrage Automatic ; workers legacy en shadow, anciennes files PAUSED.
- Sauvegarde PostgreSQL `desk-native-20260907T154139Z.dump`, SHA256
  `8afd77c65ca2f655fc0813e3166def5959cc276be3b69acbc88ab1f9a035b977`.
  Objets `desk-objects-20260907T154909Z.tar.gz`, SHA256
  `b99dc784c1d0dce785622f95b5e9351efbecf618f276146d15a63163c45c779d`.
- Troisième cycle calendrier autonome observé à 15:45:59 UTC : 74 événements,
  trois sources, version `d05bb806-d43c-4723-afae-438d972362e4`, valable jusqu'à
  21:45:59 UTC. Tâche toujours activée et replanifiée après installation.
- Telegram : test idempotent distinct de tout trade envoyé à 15:56:41.849 UTC,
  delivery `telegram_delivery_acf49c62-ea9f-404f-96a9-f7324396392f`, message 2581,
  configuration inchangée. Cela prouve le transport du canal, pas un fill réel.
- Contrôle navigateur réel : premier accès après restart partiel avec timeout
  de connexion au contexte ; second accès à 15:57:44 UTC AVAILABLE sans warning,
  session HOLIDAY, prochaine session `2026-09-08T13:30:00Z`. Inspection PG : aucun
  verrou en attente. L'ancien brief reste STALE avant publication du worker.
- Préflight d'activation : refus correct tant qu'un READY ancien contrat coexiste
  avec le READY V2. La cadence est passée de 30 à 60 minutes : le vieux bucket
  15:30 dépasse le nouveau bucket 15:00 et n'est remplacé qu'au cycle 16:00.
  Aucun contournement, suppression ni activation forcée. Nettoyage naturel
  constaté à 16:00 ; préflight vert puis activation ciblée à 16:01:23 UTC,
  reçu `agent-runtime-supervisor-mode-20260907-160123.json`.
  Une tâche READY V2 `69ca47a5-17eb-4df0-b93b-332bf9d29aa4`, analyse
  `2026-09-07T16:00:10.218Z`, prix `2026-09-04T18:20:00Z`, session HOLIDAY.
- **TD2-434, ouvert, P1 proposé** : dissocier ordre de supersession et bucket de
  cadence. Contre-revue : un superviseur déjà actif aurait pris V1 d'abord,
  mais le runner la refuse avant LLM/persistance ; risque limité à une tâche
  terminale et un cycle perdu. Tests à ajouter pour cadence 30→60, cycle ancien
  contre tâche récente, et préservation des tâches CLAIMED/RUNNING.
- Trois nouvelles lectures navigateur à 15:59:59, 16:00:14 et 16:00:30 UTC :
  HTTP 200, AVAILABLE, aucun warning, HOLIDAY cohérent. Latences 7 379 / 4 889 /
  3 839 ms : pas de perte de données sur ces lectures, mais pas de certification
  de performance ni d'absence permanente de saturation.

### Échec réel du premier démarrage et correctif de recette

L'activation .1 ne vaut **pas** réussite du worker. Tâche prise à 16:01:24,
puis arrêt du lanceur avant Codex et aucune publication. Preuve Windows :
le chemin d'entrée `C:/DeskFutures/current/...` diffère de `import.meta.url`
résolu sous `C:/DeskFutures/releases/grains-context-resumption-20260907.1/...`.
Le guard CLI ajouté pour permettre l'import de tests renvoyait donc false
sous la jonction utilisée en production. La sortie précoce ferme stdin ;
le parent ne gérait pas l'erreur Socket `write EOF`, puis redémarrait en
laissant le bail CLAIMED. Les tests de santé ne détectaient pas ce cas.

Analyste remis en shadow à 16:06:31 (actuateur existant). Tâche exacte
`69ca47a5-17eb-4df0-b93b-332bf9d29aa4` récupérée par `repository.failTask`
à 16:08:49.697, code `AGENT_RUNNER_INPUT_EOF_OBSERVED`, événement TASK_FAILED,
état READY, retry après 16:09:49.697. Aucun faux succès, suppression ou écriture
SQL brute de l'état ; token de bail utilisé en mémoire, non publié.

Correctif candidat : résolution réelle des deux chemins, import inert,
validation d'entrée avant initialisation DB/LLM ; erreur stdin du processus
fils convertie en échec structuré récupérable du parent ; supersession TD2-434
fondée sur l'heure d'analyse et gardes de dates, pas le bucket.
Tests CLI via alias/jonction et fermeture anticipée ajoutés ; les deux tests
PostgreSQL d'horloge/supersession sont enregistrés dans `test:grains:postgres`.
Nouvelle livraison et vraie publication restent à attester : TD2-432 non clos.

Recette locale corrective : 26/26 tests ciblés sans skip ; PostgreSQL réel
3/3 (horloges et supersession), sans skip ; garde architecture verte. Une
première version du test CLI dépassait 10 secondes en chargeant les imports
du desk à vide. Les imports DB/LLM ont été différés après validation : le
test alias et le test import inert passent désormais en environ 0,4 seconde,
sans relâcher leur timeout. Aucune donnée marché ni stratégie modifiée.
Windows natif local (Node 24.11.1) : six tests de processus/CLI passent,
dont jonction réelle et EOF ; nouvelle vérification sous Node 22 prévue dans
le build Windows isolé. Les fichiers correctifs sont gelés avant ce build.
