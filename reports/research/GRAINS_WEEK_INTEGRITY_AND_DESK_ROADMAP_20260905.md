# Grains — vérité de la semaine, intégrité du backtest et trajectoire du Desk

Audit du 5 septembre 2026. Semaine examinée : **31 août–4 septembre 2026**, ZW et ZC uniquement.

## 1. Conclusion exécutive

**La semaine négative n'est pas explicable proprement par la seule variance de la stratégie. Des défauts d'exploitation et de méthode sont démontrés.** Leur contribution exacte au résultat ne peut pas encore être chiffrée sans replay causal complet de la même cohorte et des mêmes gates.

- Le registre VPS contient **28 signaux publiés, 10 OrderIntents canoniques, 6 positions théoriques clôturées : −0,82857143 R**, avec 2 gains et 4 pertes. Ce n'est pas du PnL broker ni un résultat d'exécution humaine.
- Mardi–jeudi : **18 signaux publiés, aucun OrderIntent**. Dernière décision persistée : 17 WAIT pour contexte partiel/périmé et 1 rejet de zone. L'absence de positions ne signifie donc pas absence de détection.
- Trois OrderIntents de vendredi sont expirés sans événement de suivi théorique. Le chemin SQL de sélection des entrées exclut les dossiers que le nettoyage du Human Gate vient d'expirer.
- Le résultat historique précis **+116,4145 R / 578 sélectionnés / 313 remplis**, du **6 avril au 21 août 2026**, est reproduit exactement. Il est cependant **non certifiable comme résultat live équivalent** : contexte de fin de journée utilisé plus tôt, entrées antérieures à la clôture M5 et simulateur différent du suivi live.
- Une semaine à six trades ne suffit pas à conclure qu'une stratégie est bonne ou mauvaise. Inversement, le chiffre historique positif ne permet plus de conclure qu'elle est validée.

**Décision recommandée : corriger la causalité et l'équivalence de mesure avant de modifier les critères de sélection des trades.** Aucun réglage n'a été optimisé pour rendre cette semaine positive pendant cet audit.

## 2. Baseline, périmètre et sûreté

| Élément | Observation |
|---|---|
| Dépôt de travail | `C:/Users/CES/Desktop/TV_Automation_LIVE_FOCUS_VNEXT` |
| Base Git | `main`, `3ed9f242c640e6b0885f5523ba2349c3203ca94a`, propre avant audit |
| Branche de cet audit | `codex/grains-week-integrity` |
| Release VPS réellement servie | `live-focus-dashboard-20260905.2`, vérifiée sur `/healthz` et jonction de release |
| Export PostgreSQL VPS | 2026-09-05T08:32:35.245Z, transaction REPEATABLE READ READ ONLY, terminée par ROLLBACK |
| Export historique local | 2026-09-05T08:37:12.263Z, transaction READ ONLY |
| Politique BFF observée | `autoExecutionEnabled=false`, `physicalLiveEnabled=false`, `humanGateRequired=true` |
| Instances grains déclarées | 8 `running/shadow`, 4 familles × 2 instruments ; ce statut ne prouve pas une analyse fraîche |
| Mutations produit/VPS | Aucune ; pas de confirmation humaine, ordre, tâche IA, import, restart ou modification de données |

Le champ `live:true` de `/healthz` est une réponse de liveness, **pas** une autorisation de trading LIVE. Aucune réactivation MNQ, MES, BTC ou SOL n'a été effectuée.

L'inspection porte sur la stratégie grains, ses données, sa publication, son filtrage, les dossiers canoniques, le suivi théorique et les chiffres BFF. **Ce n'est pas encore une nouvelle certification générale de tous les écrans, ni la réalisation complète de la roadmap.**

## 3. Ce qui s'est réellement passé cette semaine

| Date | Signaux publiés | OrderIntents après gates | Positions clôturées | R théorique clôturé |
|---|---:|---:|---:|---:|
| Lundi 31/08 | 3 | 3 | 3 | −0,42857143 |
| Mardi 01/09 | 7 | 0 | 0 | 0 |
| Mercredi 02/09 | 6 | 0 | 0 | 0 |
| Jeudi 03/09 | 5 | 0 | 0 | 0 |
| Vendredi 04/09 | 7 | 7 | 3 | −0,40000000 |
| **Total** | **28** | **10** | **6** | **−0,82857143** |

Les 10 dossiers portent une décision Risk `PASS`, une quantité absolue de 1 et un lineage vers signal, allocation et Risk. Aucun n'a de `confirmed_at_utc`. Le suivi théorique n'exige justement pas une confirmation humaine.

Répartition des 10 dossiers : 6 entrés et clôturés, 1 `entry_expired`, 3 sans événement théorique. Les 18 autres signaux publiés se répartissent en 17 WAIT et 1 REJECT selon la dernière décision persistée, triée par `decided_at_utc`. Les 42 enregistrements de préfiltre incluent des réévaluations : ils ne sont pas 42 signaux distincts.

### Les six positions, heures Europe/Paris

| Date | Instrument / sens | Heure signal* | Entrée théorique | Sortie | Entry / stop / TP1 | Issue | R |
|---|---|---|---|---|---|---|---:|
| 31/08 | ZW vente | 17:55 | 18:17 | 19:04 | 759,25 / 762 / 755,25 | Stop | −1 |
| 31/08 | ZC achat | 19:35 | 19:47 | 19:54 | 538,75 / 537,75 / 540,25 | Stop | −1 |
| 31/08 | ZW achat | 19:40 | 20:01 | 20:13 | 769,25 / 767,5 / 772 | Objectif | +1,57142857 |
| 04/09 | ZC achat | 16:35 | 17:19 | 17:28 | 539 / 537,75 / 541 | Objectif | +1,6 |
| 04/09 | ZC achat | 17:05 | 17:37 | 17:58 | 539 / 537,75 / 541 | Stop | −1 |
| 04/09 | ZC achat | 18:30 | 18:47 | 18:48 | 539 / 538 / 540,5 | Stop | −1 |

\* Heure actuellement enregistrée comme génération, correspondant au début de la bougie M5, pas à sa disponibilité complète. C'est précisément l'un des défauts temporels identifiés.

Win rate : **33,33 %**. Profit factor en R : **0,79285714**. Moyenne : environ **−0,1381 R par position**. Les frais persistés sont nuls ; ne pas présenter ces valeurs comme une espérance nette de coûts réels.

Le mois de septembre exclut le lundi 31 août : **−0,40 R mois** et **−0,83 R semaine** peuvent donc être simultanément corrects. La comparaison doit conserver la population grains et la date de clôture, sans mélanger anciens MNQ/MES, signaux non remplis et positions réalisées.

## 4. Le +116,4145 R retrouvé et reproduit

Rapport original :
`C:/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/reports/grains/us-grains-replay-suite-2026-04-06_2026-08-21.json`

| Mesure | Original | Reproduction sans changement de paramètres |
|---|---:|---:|
| Signaux bruts de la suite | 1 851 | 1 851 |
| Acceptés par son contexte embarqué | 1 643 | 1 643 |
| Rejetés par ce contexte | 208 | 208 |
| Sélectionnés après son espacement/suivi simulé | 578 | 578 |
| Entrées simulées | 313 | 313 |
| Gains / pertes / flat | 184 / 119 / 10 | 184 / 119 / 10 |
| R | +116,4145 | +116,4145 |

Données : 88 799 ZW M1, 20 335 ZW M5, 78 305 ZC M1, 19 889 ZC M5, 28 événements agricoles. Les mêmes nombres sont retrouvés dans l'export local. Aucun téléchargement complémentaire ni ajustement de paramètres.

La suite source est identique dans la copie historique, la branche courante et sur le VPS. **Même code ne signifie pas mêmes informations disponibles à chaque instant, ni même chaîne d'exécution.**

### Défaut A : le contexte voit la suite de la journée

`mcp_gpt_desk/src/us-grains-strategy-suite.js:41`, `:62`, `:104`, `:257` : une frame quotidienne reçoit toutes les M5 du jour, calcule biais/régime/retour du marché et du pair, puis ce contexte est utilisé pour juger les signaux antérieurs. La confiance et certaines métadonnées du signal dépendent aussi de cette frame.

Contre-épreuve : conserver chaque proposition originale et les mêmes règles, mais retirer du contexte toutes les bougies postérieures à l'heure du signal.

- Historique : **290 décisions différentes**, dont **140 changements acceptation/rejet**, sur 1 851 signaux.
- Semaine : **28 décisions différentes**, dont **14 changements acceptation/rejet**, sur 100 candidats de la suite.

Ce contrôle garde la bougie M5 du signal et sa convention temporelle actuelle : il isole les données ultérieures, **sans prétendre être un nouveau backtest causal complet**. Il ne mesure pas encore le nouveau R et ne recalcule pas les propositions avec une confiance causalement corrigée.

### Défaut B : des entrées précèdent la disponibilité du signal

`us-grains-strategy-suite.js:225` affecte à la génération le timestamp d'ouverture M5, alors que les conditions emploient son close. `us-grains-strategy-engine.js:327` autorise une entrée M1 dès un timestamp supérieur à cette ouverture.

- **207 des 313 entrées historiques** se produisent avant `ouverture M5 + 5 minutes`.
- **9 des 11 entrées** du replay hebdomadaire présentent ce défaut.

Exemple réel de la cohorte live : signal ZW du 31/08, M5 15:55 UTC. Replay : fill 15:56 UTC. Live : signal persisté à 16:00:32 UTC, fill théorique 16:17 UTC. Le fill 15:56 ne pouvait pas utiliser une bougie clôturant à 16:00.

### Défaut C : ce rapport ne traverse pas les gates canoniques

La sélection à 578 utilise `processCandidates()`, son contexte embarqué, son simulateur et son cooldown. Elle ne matérialise pas les décisions Portfolio, Global Risk, TargetPosition, OrderIntent et Human Gate du Desk.

Le terme « tradable » du rapport n'est donc pas une preuve que ces 578 signaux auraient passé les gates de production. Les anciens contrôles de séparation train/test ne détectent pas une fuite d'information *à l'intérieur* de chaque journée. Nos validations précédentes étaient insuffisantes sur ce point.

## 5. Défauts d'exploitation et de parité

### P0 — Données retardées en entrée

Pour les bougies M5 portant les signaux publiés, délais médians en minutes **après clôture M5**, et non après son ouverture :

| Jour | Clôture → première importation en base | Clôture → publication du signal |
|---|---:|---:|
| 31/08 | 0,04 | 0,89 |
| 01/09 | 0,09 | 0,61 |
| 02/09 | 10,12 | 10,63 |
| 03/09 | 10,07 | 10,96 |
| 04/09 | 10,12 | 11,17 |

Les deux premiers signaux du vendredi sont publiés environ 26,76 minutes après clôture de leur M5. Il existe donc un retard d'alimentation mesuré, plus parfois du retard de traitement. **La cause fournisseur/alerte/réception du délai de dix minutes n'est pas encore attribuée** ; ne pas accuser un abonnement TradingView sans vérifier les métadonnées et les logs de réception.

Les timestamps d'import d'une base corrigée ne reconstruisent pas à eux seuls toutes les versions historiques : conserver un journal d'arrivée immuable pour la prochaine preuve.

### P0 — Contexte instable et chaîne différente selon les jours

- Lundi : décisions Context TAKE avec `NO_BINDING_CONTEXT_FILTER_ACTIVE`.
- Mardi–jeudi : contexte partiel/périmé bloque 17 signaux, une zone en rejette 1.
- Vendredi : 7 signaux passent par `US_GRAINS_EMBEDDED_CONTEXT_GATE_TRUTH`.

La semaine n'a pas appliqué une politique homogène. La branche actuelle possède un chemin explicite de contexte grains embarqué dans `mcp_gpt_desk/src/market-context-prefilter-service.js:102` ; cela ne rend pas rétroactivement équivalentes les journées antérieures.

Le registre des tâches grains montre 1 013 DONE, 122 ERROR, 4 762 CANCELLED et 1 READY dans l'export. **Les annulations de tâches remplacées ne sont pas toutes des erreurs.** Exemples d'erreurs persistées : `Cannot access 'OUTPUT_SCHEMA' before initialization`, `CODEX_EXEC_FAILED`. Dernier DONE observé : 02/09 à 23:01:34 UTC. La cause actuelle de l'absence de nouveau DONE et la fraîcheur d'un worker réellement relancé restent à vérifier séparément.

### P0 — Expiration humaine couplée à tort au suivi théorique

`broker-theoretical-execution-service.js:21` expire les gates avant de rechercher les entrées. `broker-theoretical-execution-repository.js:133` passe aussi le lineage à EXPIRED. Sa requête d'entrée, ligne 113 environ, n'accepte que `l.status='READY'`.

Trois dossiers observés sont exclus sans événement terminal théorique :

- `portfolio_order_intent_b0d533eb2ecf6e635a03cb4f`
- `portfolio_order_intent_3746a9c932c0f810092cde98`
- `portfolio_order_intent_d32c58021a7a01da90d135a0`

L'exclusion SQL est vérifiée. Une reproduction transactionnelle PostgreSQL dédiée et la correction du rattrapage restent à implémenter. Ne pas transformer arbitrairement ces absences en 0 R ou en fill. Dans le simulateur historique, ces trois propositions finissent sans fill ; cela n'est pas une réparation de leur historique canonique.

### P0 — Deux politiques de simulation différentes

| Dimension | Backtest historique | Suivi théorique live |
|---|---|---|
| Point de départ | Timestamp d'ouverture M5 | Dossier effectivement disponible |
| Fill limit | Entry comprise entre low et high | Déclenchement LIMIT du simulateur canonique, avec politique de gap |
| Fin de validité | Coupe aussi le suivi d'une position remplie | TTL appliquée à l'entrée ; position remplie suivie jusqu'à sortie |
| Position sans sortie dans les données fournies | Mark-to-market à la dernière ligne disponible | Reste ouverte / attente des données suivantes |
| Intrabar stop et target | Priorité stop dans le simulateur historique | `REVIEW_REQUIRED` dans la politique canonique |
| Gates | Sélection locale de la suite | Pipeline canonique persisté |

Conséquence : un même plan peut avoir des heures et résultats différents. Exemples : ZW lundi est flat dans l'ancien simulateur à 16:40 UTC mais finit réellement en stop théorique à 17:04 ; ZC vendredi 15:05 UTC est gagnant dans l'ancien simulateur, mais son arrivée tardive conduit au fill live 15:37 puis stop 15:58.

La réutilisation de la suite batch dans le runner live peut aussi utiliser des clôtures simulées provisoires pour son cooldown. `us-grains-live-signal-publisher.js:8` consomme par défaut `accepted_signals`, pas tous les candidats bruts. Il faut rendre explicite la séparation demandée : détecteur → publication → contexte → allocation, sans sélection cachée par un résultat simulé.

### P0 — Montants monétaires faux quand le contrat broker manque

`mcp_gpt_desk/src/broker-trade-outcome-repository.js:4` lit le point value uniquement via `broker_contracts`, puis ligne 22 utilise `Number(trade.point_value || 1)`.

Pour les six trades étudiés, cette jointure ne résout pas le contrat. Exemple ZW : risque enregistré **2,75**, alors que le plan canonique publie point value **50** et risque **137,50 USD**. Le défaut affecte la valeur monétaire ; le ratio R reste numériquement identique ici parce que numérateur et dénominateur utilisent le même facteur erroné et que les frais sont nuls.

Correction nécessaire : résoudre les unités depuis une référence économique canonique persistée, ou déclarer le calcul indisponible. Ne pas inventer un contrat broker ni modifier après coup les plans Risk.

### P1 — Cohérence M1/M5 moins bonne sur la semaine

Sur les fenêtres RTH complètes de cinq M1 : ZW **1 divergence OHLC sur 260**, ZC **13 sur 260**. Chaque instrument a 21 fenêtres M5 sans les cinq M1 correspondantes dans l'export. Ces fenêtres incluent potentiellement des frontières de session ; elles ne constituent pas toutes un trou d'ingestion.

Sur l'historique avril–août : 0 divergence sur 5 589 fenêtres ZW et 5 601 ZC complètes ; respectivement 37 et 25 fenêtres incomplètes.

Il reste à identifier quelle source et quelle convention sont justes pour chaque divergence. Ne pas écraser automatiquement la M5 par une M1 supposée meilleure.

## 6. Pourquoi le replay hebdomadaire positif ne réfute pas le live négatif

L'exécution inchangée de l'ancien batch sur les bougies VPS actuelles donne : **100 candidats, 78 acceptations de contexte, 28 sélectionnés, 11 fills, +3,035 R**.

Ce chiffre est un **diagnostic de divergence**, pas un résultat post-Human-Gate corrigé : neuf fills sont trop précoces, le contexte voit le futur, les gates et les conditions d'arrivée ne sont pas les mêmes. Tous les 28 IDs de signaux effectivement publiés se retrouvent parmi les 100 candidats batch ; cela prouve une correspondance des détecteurs, pas l'équivalence du workflow.

Je ne remplace donc pas le −0,83 R live par ce +3,035 R et je ne calcule pas un « manque à gagner » entre eux.

## 7. Roadmap de montée en maturité, grains d'abord

Identifiants ci-dessous : backlog local d'audit, **pas tickets Jira prétendument créés**. Les étapes sont ordonnées ; chaque certification doit être prouvée avant promotion.

| Étape | Livraison et propriétaire | Critère de sortie |
|---|---|---|
| 1 — Vérité de mesure | RESEARCH/BACKEND : registre complet, reproduction du résultat d'origine, causes séparées | Audit présent ; aucune confusion brut/sélectionné/post-gates/fill ni R/USD |
| 2 — Données ponctuelles | DATA/RUNTIME : arrivée, disponibilité, close M1/M5, délais, correction des divergences | Latence source/ingestion/runtime mesurée séparément ; données retardées identifiables ; causal cutoff contrôlé |
| 3 — Temps causal unique | DOMAIN/REPLAY : contexte calculé au cutoff, génération au close, calendrier Chicago/DST | Ajouter des bougies futures ne change aucune décision passée ; aucun fill avant disponibilité |
| 4 — Simulation canonique | DOMAIN/EXECUTION : même moteur entry/TTL/exit/coûts/gap/cooldown live et replay | Même flux et même policy → mêmes événements, prix et résultats ; TTL entrée distincte de fin de position |
| 5 — Contexte exploitable | CONTEXT/RUNTIME : une policy explicite et versionnée ; workers périodiques/événementiels avec coût borné | Analyse fraîche, provenance, expiry, déduplication ; pas de fallback silencieux ni avalanche de tâches |
| 6 — Dossiers sans orphelins | EXECUTION/RISK : suivi indépendant du Human Gate, point value canonique, lineage complet | 100 % des dossiers éligibles suivis jusqu'à une issue explicite ; unit economics et Risk réconciliés |
| 7 — Expériences contrôlées | RESEARCH : comparer sans contexte, déterministe puis IA, sur les mêmes données/stratégies/gates | Une seule variable change ; paramètres, prompts, modèles, cutoffs et tous les essais sont journalisés |
| 8 — Robustesse honnête | RESEARCH : walk-forward, coûts stressés, sensibilité, drawdown et concentration | Résultat net hors sélection documenté, stabilité par périodes/instruments/familles ; aucun seuil déplacé après observation |
| 9 — Front qui explique | FRONT/BFF : compteurs complets et cohortes, signal→blocage→ordre→fill, fraîcheur et théorie/broker distincts | Chiffres vérifiables contre SQL et même période ; aucun zéro de remplacement ; actions autorisées backend uniquement |
| 10 — Qualification opérationnelle | RELEASE/OPS : replay causal de plusieurs mois puis shadow prospectif | Parité intégrale, télémétrie, alertes Telegram, reprise/idempotence/rollback testés ; autorisation humaine avant toute exécution physique |

Travaux P0 précis à ouvrir : AUD-GR-01 temps/context causal ; 02 suivi expirations indépendant ; 03 unités économiques ; 04 retard alimentation ; 05 simulation/gates communs ; 06 contexte runtime homogène. Les divergences de données et la qualité statique restent des travaux à traiter, pas à masquer.

### Règles R&D pour éviter l'overfit

1. Ne pas sélectionner une variante parce qu'elle répare les six trades de cette semaine.
2. Avril–août a déjà été analysé à plusieurs reprises : **ce n'est plus un holdout vierge**. Un walk-forward sur cet historique reste utile, mais ne doit pas être présenté comme une validation prospective indépendante.
3. Figer paramètres, univers, coûts, calendriers et critères avant chaque vraie validation ; conserver les variantes échouées dans le journal de recherche, pas seulement le gagnant.
4. Mesurer résultat net, intervalle d'incertitude, drawdown, exposition simultanée, contribution des meilleurs trades/jours, distributions mensuelles et sensibilité aux délais.
5. Comparer l'IA contextuelle sur les mêmes dates et les mêmes gates ; archiver prompts/réponses et dates de disponibilité des annonces. Aucun accès anticipé aux actuals macro.
6. Maintenir l'interdiction achat et vente simultanés du même instrument dans l'arbitrage canonique, pas par une suppression des signaux moteurs.
7. Une stratégie peut être honnêtement non retenue. La rentabilité ne peut pas être promise comme résultat automatique d'un chantier logiciel.

Ce besoin de distinguer simulation et conditions réelles est également rappelé par la [NFA sur les résultats hypothétiques](https://www.nfa.futures.org/rulebooksql/rules.aspx?RuleID=9025&Section=9). La conclusion technique de ce rapport repose toutefois sur les données et le code inspectés, pas sur cette mise en garde générale.

**MNQ, MES, Bitcoin et Solana : différés**, conformément à la demande. Préparer leur extension signifie identifier contrats/unités, sessions, marché spot ou dérivé, sources et coûts ; aucune campagne ou activation de ces univers n'est lancée ici.

## 8. Livraisons de cet audit, tests et limites

Fichiers ajoutés, hors application de production :

- `mcp_gpt_desk/scripts/audit_us_grains_week.mjs` : relecture de données gelées, replay inchangé, détection de contexte futur, fills antérieurs au close M5, cohorte live et cohérence M1/M5 ; période explicite, hashes et absence de ledger déclarée.
- `mcp_gpt_desk/scripts/lib/grains-audit-metrics.mjs` : arithmétique de diagnostic seulement ; valeurs R inconnues conservées, sélection par date de clôture.
- `mcp_gpt_desk/test/grains_audit_metrics.test.js` : six tests de l'audit, dont valeur inconnue, borne de période, carry-in et dossier expiré sans suivi.
- Le présent rapport consolidé.
- `.gitignore` : exclusion limitée aux exports privés de cet audit, sans masquer d'autres campagnes.

Placement : outils RESEARCH/QA hors runtime, consommés par l'audit local. Alternative écartée : corriger directement la stratégie ou le BFF afin d'obtenir un meilleur résultat avant de prouver la cause. Aucun nouveau framework, migration, contrat public ou ADR métier n'est introduit.

Validation exécutée :

- **32/32 tests ciblés passent** : les 6 nouveaux, session grains, moteur théorique, service théorique, pipeline décision signal.
- Deux replays réels hors ligne : historique reproduit exactement et semaine VPS ; aucun faux jeu runtime.
- Guard architecture : PASS, 446 fichiers examinés.
- Guard qualité statique : **FAIL préexistant sur les sources de production non modifiées**, notamment repository théorique 1 026 lignes, front API 3 245, engine grains 729 ; 273 fonctions surdimensionnées contre budget 250. Aucun budget n'a été abaissé ou augmenté pour masquer la dette.
- Guard runtime safety : **non validé**, exécution interrompue car le processus Node Windows ne trouve pas `rg`. Cela ne vaut pas PASS.
- Pas de nouvelle recette navigateur, d'E2E transactionnel du correctif d'expiration ni de campagne IA dans cet audit. Aucune affirmation de correction/déploiement de ces défauts.

Les tests ciblés verts couvrent des comportements locaux. Ils ne couvrent pas les défauts de causalité et le cycle PostgreSQL qui viennent d'être constatés : **ils ne constituent pas une certification de stratégie**.

Réduction mesurable de dette de vérification : d'un résultat historique sans contrôle de causalité intra-journalière à un outil versionné mesurant 290 changements de décision et 207 fills précoces, plus six tests sur la fiabilité du bilan. La dette métier reste à corriger dans les étapes 2–6.

### Reproduction

Depuis la racine du worktree, avec Node installé et les dépendances existantes du dépôt :

```bash
node mcp_gpt_desk/scripts/audit_us_grains_week.mjs output/research/grains-week-20260905/vps-week-ledger.json output/research/grains-week-20260905/week-analysis.json 2026-08-31 2026-09-04
node mcp_gpt_desk/scripts/audit_us_grains_week.mjs output/research/grains-week-20260905/local-history.json output/research/grains-week-20260905/history-analysis.json 2026-04-06 2026-08-21
node --test mcp_gpt_desk/test/grains_audit_metrics.test.js mcp_gpt_desk/test/us_grains_session_state.test.js mcp_gpt_desk/test/theoretical_execution_engine.test.js mcp_gpt_desk/test/theoretical_execution_service.test.js mcp_gpt_desk/test/strategy_signal_decision_pipeline_service.test.js
```

Dans l'environnement WSL de cet audit, le binaire effectivement utilisé est `node.exe`. Les exports contiennent des données opérationnelles : ils sont conservés localement sous `output/research/grains-week-20260905/`, **pas ajoutés au commit ni à un frontend public**. Un autre poste devra recevoir ces exports gelés ou les extraire via un accès lecture seule autorisé ; un checkout Git seul ne contient pas les données privées.

| Preuve | SHA-256 |
|---|---|
| Export VPS | `8417abff18e08015cd58460dc1cfee312ceca360e8eff34e26bc5c3d0450bdf6` |
| Export historique local | `78e03803ff6b84b62f7afae53e1d15a78e4d0b476887c0e57076c6d0e3b445b9` |
| Suite stratégie courante/historique/VPS | `69f1630264dc8cd69e83cafa4fcd245b78fb1914ea55e02d6ac022c689d49f41` |
| Simulateur historique source | `b219afd9b77058ec02f07541c37c28bb0d7d28340d116ad6a0e7d1e8f67b088a` |

Les JSON d'analyse détaillent les IDs et les comparaisons champ par champ. Sources canoniques lues : `market_candles`, `market_agri_events`, `strategy_signal_outbox`, `market_context_prefilter_decisions`, `ai_context_gate_decisions`, `portfolio_order_intent_lineage`, `portfolio_target_positions`, `human_execution_gates`, `trades`, `trade_theoretical_execution_events`, `agent_tasks`, `market_context_snapshots`, `strategy_instances` et leurs définitions/versions.

Sûreté et rollback : aucun effet opérationnel à annuler ; la release et les données VPS sont inchangées. Les nouveaux fichiers sont des outils et un rapport, isolés sur la branche d'audit. **Le Desk n'est pas déclaré corrigé, rentable ou prêt à augmenter son risque à l'issue de cette seule phase.**
