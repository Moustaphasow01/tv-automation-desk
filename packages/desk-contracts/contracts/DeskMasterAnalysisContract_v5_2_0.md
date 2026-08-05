# DeskMasterAnalysisContract — v5.2.0

## 1. Mission

Le Master V5.2 transforme un bundle scellé au cutoff en analyse contradictoire, thèse active et proposition Execution Plan V1.2. Le schéma de sortie normatif est `schemas/entities/master-analysis-v5-2.schema.json`.

V5.2 remplace V5.1 pour les nouveaux runs; V5.1, V5.0 et V4 restent lisibles et hash-lockés pour les runs historiques.

## 2. Invariants

- même contrat pour LIVE, REPLAY, BACK_FORWARD et PAPER ;
- aucune donnée postérieure au cutoff ;
- identifiants de bundle, pack, build et run recopiés, jamais inventés ;
- profil unique `OPPORTUNITY_SEEKING_CONTROLLED` ;
- Execution Plan V1.2, Policy V4.2 et Catalog V1.2 épinglés ;
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

Le Master peut classer de zéro à cinq candidats réellement distincts, avec des rangs uniques `1..5`. Il ne remplit jamais artificiellement le portefeuille : chaque candidat doit représenter un scénario plausible, complet et indépendant. Un candidat secondaire incomplet ne doit pas annuler un candidat principal valide : il est omis ou conservé à un état non exécutable autorisé par le plan. À l’inverse, une incohérence de scope, d’identité, de cutoff ou d’anti-lookahead invalide atomiquement tout le document.

La tolérance concerne la recherche d’opportunités, jamais le budget de risque. `risk_pct_requested` reste `> 0` et `<= 0.25 %` de la `NET_EQUITY`, le stop est obligatoire et le RR recalculé reste `>= 2`. Les contrats futures sont entiers et dimensionnés par arrondi supérieur côté broker. L’excédent d’arrondi doit rester inférieur ou égal au `max_rounding_excess_pct` de la policy broker ; au-delà, `BROKER_SUBMIT` est refusé. GPT ne calcule ni la quantité finale ni cet excédent.

## 6. Plan et thèse

`execution_plan` est conforme à DeskExecutionPlanContract V1.2 et contient le `plan_id` épinglé par le backend. Le compilateur vérifie son égalité avec `active_thesis.plan_id`, ainsi que l’identité du Master et le scope. Le Master ne fournit jamais un hash compilé, une condition satisfaite future, un trigger, un fill, une position ou un résultat.

Les champs de prose (`rationale`, résumés, constats) ne sont jamais exécutables. Toute logique exécutable utilise uniquement les enums du Catalog V1.2 et les `parameters` typés attendus. Une condition atomique `BREAK_RETEST_SEQUENCE` absorbe ses preuves redondantes de zone et de rejet : celles-ci restent auditables mais ne peuvent plus bloquer séparément après confirmation de la séquence. Chaque setup fournit toutes ses cibles et leurs actions (`PARTIAL_CLOSE`, `MOVE_STOP_BE`, `TRAIL`, `FULL_CLOSE`, `RUNNER`), sa gestion, ses preuves et sa validité. Une confirmation entraîne une exécution au plus tôt sur la bougie M1 fermée suivante selon `entry_mode`; si le prix quitte puis réintègre la zone, une réacquisition doit être prouvée par des conditions machine réévaluées, jamais déduite d’un texte.

Mémoire normative : `role=VETO` désigne un blocage temporaire (notamment `EVENT_BLACKOUT`, fenêtre horaire, intermarket ou volatilité) et impose `effect=BLOCK_IF_TRUE`, `memory_policy=LATEST_ONLY`, `required_for_trigger=false`, `weight=0`. Il bloque seulement l’entrée tant qu’il est vrai, se lève lorsqu’il redevient faux et impose alors une confirmation fraîche sur M1 fermée. `role=INVALIDATION` est réservé à une rupture structurelle explicite et impose `memory_policy=INVALIDATE_TERMINAL`. `LATCH_UNTIL_TRIGGER` est interdit à tout `BLOCK_IF_TRUE`; il reste réservé aux activations/confirmations `REQUIRE_TRUE`.

Les effets de soft gate ne sont jamais des règles backend cachées. `REQUIRE_CONFIRMATION` devient exécutable uniquement si GPT ajoute au setup une condition explicite du Catalog V1 avec tous ses `parameters`, son poids et sa règle temporelle; sinon il reste audit/advisory. `REDUCE_RISK` devient exécutable uniquement si un Master ou replan abaisse explicitement `execution_plan.risk.risk_pct_requested` avant compilation, puis le setup compilé hérite de cette valeur. Un Monitor ne peut pas modifier silencieusement le risque du plan : sans nouveau plan, l’effet reste advisory; sur une position ouverte, `management_request.type=REDUCE_RISK` est une demande distincte `GPT_REQUEST_ONLY`. Aucun de ces effets ne devient un veto implicite.

La thèse active utilise exclusivement la machine : `NO_ACTIVE`, `WAIT_MONITORED`, `CONDITIONAL`, `ACTIVE`, `WEAKENED`, `AT_RISK`, `POST_EVENT`, `INVALIDATED`, `EXPIRED`, `REPLAN_REQUIRED`, `SUPERSEDED`. Elle conserve les liens plan/hypothèse/setup, le chemin attendu, le chemin d’échec, les transformations de scénario, la watchlist de niveaux et l’échéance de replan.

## 7. Handoff Monitor

Le handoff impose analyse GPT `M5`, surveillance moteur `M1`, prochain checkpoint et conditions à observer. Il transmet aussi baseline de santé, contexte, matrice de sessions, fenêtres autorisées, agenda de mise à jour, priorités et playbook. Les Monitors évaluent l’évolution; ils ne réinventent pas la stratégie ni les identifiants du plan.

Les gates sont conservées avec leur phase. Une fenêtre événementielle requise mais indisponible reste `UNKNOWN` et bloque seulement `ENTRY_TRIGGER`; elle ne supprime pas le candidat aux phases antérieures. Une donnée contextuelle facultative absente reste soft. LIVE et REPLAY utilisent exactement ce même contrat; seule l’acquisition temporelle des données diffère.

## 8. Sortie et rejet

Toute propriété inconnue est interdite. Un Master sans les six hypothèses, sans plan valide, sans preuve d’absence de setup lorsque requise, avec scope incohérent ou anti-lookahead non prouvé doit être rejeté avant persistance métier.
