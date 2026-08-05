# Suivi post-canari V5.3 → V5.4 / M15

Le canari V5.3 ayant exposé les défauts de cycle de vie, il a été arrêté et
conservé comme preuve :

- `backtest_id` : `replay_2026-06-11_full_day_15m_2b6ddd190eab`
- release : `2026.08.03-engine-v5-3-m15.1`
- arrêt : `CANCELLED` à `10:15`, progression `46 %`

La matrice corrigée est déployée par la release
`2026.08.03-engine-v5-4-m15.3` :

- Master V5.4 ;
- Monitor V2.4 ;
- Policy 4.3 ;
- Plan et Command 1.4 ;
- Catalog 1.2 ;
- analyse GPT planifiée M15 ;
- surveillance déterministe M1 ;
- conversation Codex bornée et continue au sein d'un même run.

Canari propre actif :

- `backtest_id` :
  `replay_2026-06-11_full_day_15m_3e77dc947852` ;
- `config_id` :
  `replay_autopilot__2026_06_11__full_day__3e77dc947852` ;
- release : `2026.08.03-engine-v5-4-m15.3`.

Le LIVE et l'exécution broker restent gelés jusqu'au verdict du canari et de la
campagne hebdomadaire.

## Validation initiale de la release `.3`

Le passage Master → Monitor a été validé sur le canari propre :

- Master terminé en `442 402 ms`, avec trois scénarios produits ;
- premier Monitor terminé en `320 957 ms` et sauvegardé ;
- prochain Monitor réclamé `3,103 s` après la fin du précédent ;
- effort Codex : `xhigh` sur les deux analyses ;
- thread Master : `019fc94f-f155-7113-a3f2-dee1014d1a2b` ;
- thread Monitor : identique, avec `conversation_mode=RESUMED` ;
- compteur de conversation passé de 1 à 2 ;
- matrice Master et Monitor chargée une fois par type de contrat, puis
  réutilisable au sein de la conversation bornée ;
- aucune fuite vers la lane LIVE et aucune activation du broker.

Les phases Macro et News du Monitor de `00:30` sont `UNAVAILABLE`, ce qui est
cohérent avec l'absence de contenu publié à ce cutoff prémarché. Elles restent
non bloquantes : le Monitor a été sauvegardé et le run a avancé à `00:45`.

## Corrections V5.4 livrées

- [x] Expiration exacte au cutoff et matérialisation persistante `EXPIRED`.
- [x] Remplacement atomique avec nouveaux `setup_id` et `setup_record_id`.
- [x] Portefeuille actif borné à cinq setups.
- [x] Échec terminal projeté `BLOCKED` avec horodatage et action opérateur.
- [x] Suppression des confirmations redondantes autour de
  `BREAK_RETEST_SEQUENCE`.
- [x] Parité de cycle de vie Live/Replay dans le moteur M1.
- [x] Policy et contrats immuables alignés sur GPT M15 + événements critiques.
- [x] Effort Codex `xhigh` conservé depuis le réglage opérateur.
- [x] Conversation Codex continue par run, bornée à 12 tours, avec rebase.
- [x] Changement Master → Monitor dans le même thread, mais chargement intégral
  du contrat Monitor lors de sa première utilisation.
- [x] Suite backend complète : `766/766`.
- [x] Release `.3` certifiée : 4 263 fichiers, SHA-256
  `fbc4c7c83e8e356087955793dad54729fcb102f8039931d58be541b63eb48ded`.

## P0 — À exécuter dès la fin du canari

- [x] Conserver le canari arrêté comme preuve :
  `CANCELLED` à `10:15`, progression `46 %`, 45 analyses terminées,
  39 Monitors, 40 simulations M1 et aucune position.
- [ ] Sur le prochain canari corrigé, capturer le reçu `DAY_END` et figer les
  identifiants, versions, hashes, pack et source evidence du run.
- [ ] Calculer la performance définitive : R net, R réalisé, drawdown, nombre
  de positions, taux de réussite, expectancy, durée moyenne et exposition.
- [ ] Auditer tous les setups : proposés, compilés, pré-armés, armés,
  déclenchés, invalidés, expirés, remplacés et manqués.
- [ ] Rejouer contrefactuellement chaque opportunité non prise afin de séparer
  erreur analyste, condition trop stricte, erreur moteur et absence réelle
  d'opportunité.
- [x] Vérifier l'anomalie observée pendant le canari : les setups expirés à
  `02:00` restent projetés `PRE_ARMED` après création des remplaçants.
- [x] Corriger la sélection `selectActiveReplaySetups` : elle ne doit pas
  considérer actif un setup dont `expires_at_paris <= current_replay_time`.
- [x] Matérialiser atomiquement `EXPIRED` au cutoff exact, avant toute
  simulation, tout nouveau Master ou toute commande Monitor.
- [x] Lors d'un replan, terminaliser ou superseder explicitement les setups
  précédents avant d'ajouter leurs remplaçants.
- [x] Garantir que le portefeuille actif ne dépasse jamais cinq scénarios ;
  les setups historiques restent auditables mais sortent de la collection
  logique active.
- [x] Déterminer si cette anomalie vient de la machine d'état, de la
  terminalisation persistée ou uniquement de la projection front.
- [x] Corriger le blocage observé à `10:15` :
  `SETUP_ID_IMMUTABLE`. Une commande Monitor de remplacement ne doit jamais
  réutiliser le `setup_record_id` de l'ancien setup avec un nouveau
  `setup_id`.
- [x] Pour `REPLACE`, imposer un nouveau `setup_id` et un nouveau
  `setup_record_id`, conserver l'ancien dans `replaces_setup_id` et
  `replaces_setup_record_id`, puis écrire les deux transitions dans la même
  transaction.
- [x] Rejeter avant la transaction toute commande où l'identité du record et
  l'identité logique ciblent deux setups différents.
- [x] Ajouter un test d'intégration PostgreSQL reproduisant exactement
  `SETUP_ID_IMMUTABLE`, ainsi que les variantes replay et live.
- [x] Une erreur de commande analytique non retryable ne doit pas laisser le
  run projeté `WAITING_GPT_MONITOR` : exposer `BLOCKED`/`FAILED` avec l'erreur,
  l'heure du blocage et l'action opérateur attendue.
- [x] Corriger `completedAt` des processus GPT échoués : le canari exposait
  l'heure du premier Master au lieu de l'heure réelle de l'échec.
- [x] Décider la politique de résilience : une commande setup invalide doit
  préserver atomiquement le dernier état valide, produire une dead-letter
  exploitable et permettre un replan contrôlé sans mutation partielle.
- [ ] Mesurer les latences : pack → work ready, ready → claim, claim → save,
  save → complete et complete → prochain checkpoint.
- [ ] Mesurer la consommation IA par Master et Monitor : input, output,
  reasoning, durée et taux d'échec/retry.
- [ ] Comparer le run M15 aux runs M5 de référence sans réinterpréter les runs
  historiques avec les nouveaux contrats.
- [ ] Auditer l'absence de trade : identifier pour chaque setup si la cassure,
  le retest, le rejet, la présence en zone, la confirmation secondaire ou une
  règle de validité a empêché le trigger.
- [x] Supprimer les confirmations obligatoires redondantes lorsqu'un
  `BREAK_RETEST_SEQUENCE` porte déjà la cassure, le retest et le rejet.
- [ ] Vérifier que les fenêtres fixes de deux heures ont une justification de
  marché et ne provoquent pas des replans artificiels et coûteux.
- [ ] Produire un verdict formel : `PASS`, `PASS_WITH_FINDINGS` ou `FAIL`.

## P0 — Cohérence contractuelle

- [x] Ne pas modifier rétroactivement la Policy V4.2 hash-lockée.
- [x] Créer une nouvelle version immuable de la Policy déterministe corrigeant
  la section de cadence encore renseignée M5 et les références aux anciens
  contrats.
- [x] Épingler explicitement dans cette nouvelle Policy : Master V5.4,
  Monitor V2.4, Plan V1.4, Command V1.4, Catalog V1.2, GPT M15, moteur M1 et
  Monitors événementiels critiques.
- [x] Mettre à jour registry, schemas, locks, guards, prompts, frontend et kit
  de déploiement dans une release atomique.
- [x] Ajouter un test de cohérence inter-contrats empêchant qu'une Policy
  active annonce une cadence différente du Master, du Monitor ou du runtime.
- [x] Réduire le transport et les lectures IA répétitives sans supprimer le
  contexte analytique : manifest structuré, lectures ciblées, cache de
  sections immuables et continuité contrôlée.
- [ ] Mesurer la nouvelle solution contre la télémétrie du canari
  (Master ≈ 1,26 M tokens cumulés ; premier Monitor ≈ 1,07 M) avant de valider
  toute optimisation.

## P1 — Campagne de validation sur une semaine

- [ ] Sélectionner cinq séances consécutives avec une couverture de données
  comparable et documenter les éventuelles lacunes par journée.
- [ ] Préparer cinq packs immuables et cinq configurations indépendantes,
  toutes épinglées à la même matrice contractuelle.
- [ ] Conserver une seule journée par run, un `run_family_id` par date et des
  groupes de workers isolés.
- [ ] Commencer avec deux workers Replay parallèles maximum.
- [ ] Vérifier l'absence de double claim, fuite de scope, collision de lease,
  mélange de pack ou partage de position entre les journées.
- [ ] N'augmenter la concurrence qu'après validation de deux journées
  simultanées sans incident.
- [ ] Budget temporel attendu avec le débit du canari :
  - un worker : environ 35 heures, marge prudente 30–45 heures ;
  - deux workers : environ 18–22 heures ;
  - trois workers : environ 12–15 heures ;
  - cinq workers : environ 7–9 heures, uniquement après validation de charge.
- [ ] Comparer les cinq journées sur les mêmes métriques de stratégie,
  moteur, résilience, latence et consommation IA.
- [ ] Contrôler la stabilité des choix de niveaux, tolérances, validités,
  risques et conditions d'un Master à l'autre.

## P2 — Décision de passage LIVE

- [ ] Prouver la parité LIVE/REPLAY sur contrats, compilateur, catalogue,
  machines d'état, outcome et gestion de position.
- [ ] Exécuter un canari LIVE en compte simulé avec moteur M1, GPT M15 et
  Monitors événementiels.
- [ ] Vérifier l'expiration et le remplacement des setups en temps réel.
- [ ] Vérifier la taille entière des contrats, le risque net-equity, les
  arrondis, les stops, les objectifs et la réconciliation NinjaTrader.
- [ ] Ne déverrouiller l'exécution broker qu'après un verdict explicite.
- [ ] Conserver un rollback atomique vers lanes gelées et broker verrouillé.

## Validation runtime data — release `2026.08.03-engine-v5-4-m15.4`

- [x] Dériver les timeframes fermés M5/M15/H1/H4 depuis les M1 immuables
  lorsque le dataset direct n'existe pas, sans lookahead.
- [x] Résoudre les instruments logiques `NQ` et `ES` depuis les flux
  exécutables `MNQ_M1` et `MES_M1`, tout en conservant l'instrument logique
  dans l'évaluation.
- [x] Appliquer la même résolution dans Replay et LIVE.
- [x] Remplacer les faux motifs `CANONICAL_TRIGGER_DATA_MISSING` par le motif
  déterministe réel de l'évaluation.
- [x] Passer la suite MCP complète sur la release finale :
  `770 pass / 0 fail` ; domaine : `194 pass / 0 fail`.
- [x] Déployer la release atomique sur le VPS avec sauvegarde PostgreSQL et
  objets préalable.
- [x] Lancer un nouveau run isolé du 11 juin :
  `replay_2026-06-11_full_day_15m_69603aa6c984`.
- [x] Vérifier sur le run VPS que la confirmation logique `NQ` est évaluée
  depuis `MNQ_M1` et peut passer à `PASSED`.
- [x] Vérifier la continuité de conversation Codex : Master créé puis
  Monitors repris dans la même session.
- [x] Observer une entrée déterministe : le setup short a été confirmé puis
  déclenché à `01:07` sur le run `69603aa6c984`.
- [x] Corriger l'anomalie découverte après l'entrée :
  `FULL_CLOSE + close_fraction=0.5` plaçait la position en
  `TARGET_PLAN_INVALID`. La frontière runtime force désormais
  `FULL_CLOSE.close_fraction=1`, sans modifier le compilateur V1.4 ni son
  lock immuable.
- [x] Annuler le run invalide à 5 % et déployer la release
  `2026.08.03-engine-v5-4-m15.5` après sauvegarde PostgreSQL/objets.
- [x] Lancer le run propre
  `replay_2026-06-11_full_day_15m_edb1ee435f86`.
- [x] Vérifier les deux plans de cible persistés sur le run propre :
  `PARTIAL_CLOSE=0.5`, puis `FULL_CLOSE=1`.
- [ ] Observer la sortie déterministe sur le run propre, puis
  réconcilier le résultat R.

## Critères minimaux de sortie

La campagne n'est validée que si :

- aucun mélange de scope ou de pack n'est observé ;
- aucun setup expiré ne reste éligible au trigger ;
- chaque résultat R est calculé automatiquement et réconcilié ;
- aucun ordre n'est soumis sans trigger backend et broker gates valides ;
- les cinq runs atteignent `DAY_END` sans intervention manuelle ;
- les écarts de performance sont explicables par le marché ou les décisions,
  et non par une différence de moteur entre LIVE et REPLAY.
