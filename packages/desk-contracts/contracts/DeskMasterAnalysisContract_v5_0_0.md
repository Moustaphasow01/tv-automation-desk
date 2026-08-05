# DeskMasterAnalysisContract — v5.0.0

## 1. Mission

Le Master V5 transforme un bundle scellé au cutoff en analyse contradictoire, thèse active et proposition Execution Plan V1. Le schéma de sortie normatif est `schemas/entities/master-analysis-v5.schema.json`.

V5 remplace V4 pour les nouveaux runs; V4 reste lisible et hash-locké pour les runs historiques.

## 2. Invariants

- même contrat pour LIVE, REPLAY, BACK_FORWARD et PAPER ;
- aucune donnée postérieure au cutoff ;
- identifiants de bundle, pack, build et run recopiés, jamais inventés ;
- profil unique `OPPORTUNITY_SEEKING_CONTROLLED` ;
- Execution Plan V1, Policy V4 et Catalog V1 épinglés ;
- GPT propose, le backend compile et exécute.

## 3. Analyse obligatoire

La sortie sépare explicitement :

1. faits observables et références de source ;
2. interprétations et faits qui les soutiennent ;
3. opportunités ;
4. risques ;
5. synthèse de décision.

Le contexte marché couvre régime global, statut du régime, volatilité, biais, cross-asset et macro. `analysis_sections` expose aussi des blocs structurés `macro`, `cross_asset`, `technical`, `levels` et `asset_selection` avec constats et références afin d’alimenter le front sans réinterpréter un texte libre. Les données DXY/VIX, taux, pétrole/or, indices et mégacaps proviennent des snapshots immuables du pack. Une lacune contextuelle ne devient hard que si la donnée est explicitement nécessaire au trigger.

## 4. Analyse contradictoire

Le Master doit matérialiser au moins les six hypothèses `BULL`, `BEAR`, `RANGE`, `BEST_LONG`, `BEST_SHORT`, `WAIT`. Chacune contient statut, instrument, direction, confiance, thèse, faits favorables/contradictoires et invalidation.

Le Master choisit une hypothèse et explique le choix. `WAIT` est une hypothèse démontrée, pas une absence d’analyse. L’analyste doit chercher activement les meilleurs long et short avant de conclure à l’attente.

## 5. Tolérance d’opportunité contrôlée

Le Master ne doit pas cumuler des veto contextuels non canoniques. Il peut proposer un setup conditionnel lorsque :

- aucun hard gate exigible à la phase courante n’échoue ; les gates de trigger ou broker futures peuvent rester à réévaluer sans supprimer le candidat ;
- la géométrie, le stop, l’objectif et le RR sont valides ;
- le risque demandé ne dépasse pas `0.25 %` ;
- les conditions obligatoires structurées existent ;
- le score contextuel pondéré cible est `0.55`.

Les confirmations secondaires servent au score. Leur absence ne remplace jamais une donnée canonique requise et ne doit pas non plus provoquer automatiquement `WAIT_NO_SETUP`.

## 6. Plan et thèse

`execution_plan` est conforme à DeskExecutionPlanContract V1 et contient le `plan_id` épinglé par le backend. Le compilateur vérifie son égalité avec `active_thesis.plan_id`, ainsi que l’identité du Master et le scope. Le Master ne fournit jamais un hash compilé, une condition satisfaite future, un trigger, un fill, une position ou un résultat.

La thèse active utilise exclusivement la machine : `NO_ACTIVE`, `WAIT_MONITORED`, `CONDITIONAL`, `ACTIVE`, `WEAKENED`, `AT_RISK`, `POST_EVENT`, `INVALIDATED`, `EXPIRED`, `REPLAN_REQUIRED`, `SUPERSEDED`. Elle conserve les liens plan/hypothèse/setup, le chemin attendu, le chemin d’échec, les transformations de scénario, la watchlist de niveaux et l’échéance de replan.

## 7. Handoff Monitor

Le handoff impose analyse GPT `M5`, surveillance moteur `M1`, prochain checkpoint et conditions à observer. Il transmet aussi baseline de santé, contexte, matrice de sessions, fenêtres autorisées, agenda de mise à jour, priorités et playbook. Les Monitors évaluent l’évolution; ils ne réinventent pas la stratégie ni les identifiants du plan.

## 8. Sortie et rejet

Toute propriété inconnue est interdite. Un Master sans les six hypothèses, sans plan valide, sans preuve d’absence de setup lorsque requise, avec scope incohérent ou anti-lookahead non prouvé doit être rejeté avant persistance métier.
