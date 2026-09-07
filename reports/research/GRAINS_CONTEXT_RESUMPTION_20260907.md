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
par le desk en live. Comparaison post-correctif à ajouter après gel du SHA.

## Validation, dette et limites

- Domaine complet : 537/537 ; deux horloges/causalité/normalisation : 12/12.
- Round trip PostgreSQL réel : 1/1, précision .533/.534/.535 et absence d'effet provider.
- Tests projection Focus : verts, dont deux nouveaux tests double/ancien cutoff.
- Tests session/data-health : 25/25 ; données grains 37/37 ; runtime grains 17/17.
- Contre-revue indépendante : a identifié l'ordre d'activation des anciennes
  tâches et le libellé du cutoff BFF ; compensations intégrées ci-dessus.
- Candidat final ciblé : 78/78 sans skip ni annulation ; API complète 52/52.
  Test PowerShell natif de conservation du superviseur : PASS ; garde du kit
  Windows : PASS, 107 fichiers. La suite backend complète et le build Windows
  seront consignés après achèvement. L'ancien test de timeout Linux (14 août)
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
