# Registre des anomalies — Replay V5.1 du 11 juin 2026

## Périmètre

- `backtest_id` : `replay_2026-06-11_full_day_5m_2d1b5b62bfcf`
- Release observée : `2026.08.02-engine-v5-1-hold.22`
- Objectif : consigner les défauts constatés pendant le run sans modifier son comportement, puis préparer un correctif groupé après sa terminaison.
- Règle d'observation : ne pas interrompre ni réparer rétroactivement le run en cours. Chaque correctif devra être vérifié par un nouveau replay comparable du 11 juin.

## F-001 — Perte des conditions fraîches après un retest pourtant validé

- Statut : `OPEN`
- Sévérité : `CRITICAL`
- Domaine : moteur déterministe de conditions / déclenchement des setups
- Impact : opportunité LONG valide non exécutée ; résultat du run sous-estimé d'environ `+2 R`.

### Setup concerné

- Direction : `LONG MNQ`
- Validité : `02:00–05:00` Paris
- Zone d'entrée : `28 462–28 472`
- Prix d'exécution prévu : `28 472`
- Stop : `28 392`
- Objectif : `28 632`

### Preuves

1. `candidate_2_break_above_28470` est passé à `SATISFIED` à `02:16`, avec une clôture observée à `28 514,25`.
2. `candidate_2_break_retest_28470` est passé à `SATISFIED` à `02:26`, avec une clôture observée à `28 484,25`.
3. La même bougie de `02:26` a touché la zone d'entrée avec un plus bas à `28 468`, puis clôturé au-dessus de `28 470`.
4. Malgré cela, à `03:09` :
   - `candidate_2_zone_touch_fresh` restait `PENDING` ;
   - `candidate_2_rejection_fresh` restait `PENDING` ;
   - le setup restait `ARMED_CONDITIONAL` avec `CANONICAL_TRIGGER_DATA_MISSING` ;
   - seulement deux des quatre conditions obligatoires étaient comptées comme satisfaites.
5. Après l'entrée théorique de `02:26`, le stop n'a pas été touché et l'objectif `28 632` a été atteint à `03:04`.

### Cause probable à confirmer

Le prédicat composite `BREAK_RETEST_SEQUENCE` mémorise correctement la satisfaction avec `LATCH_UNTIL_TRIGGER`, tandis que les prédicats redondants de contact et de rejet utilisent une sémantique fraîche de type `LATEST_ONLY`. Ils redeviennent ou restent `PENDING` lorsque la bougie suivante arrive, alors que l'événement atomique de `02:26` avait déjà satisfait le scénario attendu.

Le compilateur impose ensuite simultanément le prédicat composite et ses deux composantes comme conditions obligatoires, ce qui rend le setup impossible à déclencher après la bougie de retest.

### Correctif attendu après le run

1. Rendre atomique la détection `cassure → retest → contact de zone → rejet`.
2. Persister l'heure et la preuve de chaque événement satisfait.
3. Lorsqu'un `BREAK_RETEST_SEQUENCE` valide déjà le contact et le rejet :
   - soit faire hériter/latcher les prédicats composants ;
   - soit ne pas les compiler une seconde fois comme conditions obligatoires indépendantes.
4. Réserver `LATEST_ONLY` aux confirmations réellement exigées sur la dernière bougie, sans effacer un événement séquencé déjà validé.
5. Empêcher `CANONICAL_TRIGGER_DATA_MISSING` lorsque les données M1 nécessaires ont été lues et ont déjà permis de valider le prédicat composite.

### Critères de non-régression

- Sur les bougies canoniques du 11 juin :
  - cassure détectée à `02:16` ;
  - retest/contact/rejet détectés à `02:26` ;
  - déclenchement LONG à `28 472` ;
  - sortie à l'objectif `28 632` à `03:04` ;
  - résultat déterministe attendu : `+2 R`, hors règles de gestion supplémentaires.
- Aucun déclenchement ne doit être permis si le contact ou le rejet n'a réellement pas eu lieu.
- Le résultat doit être identique en Replay et en LIVE pour une séquence de bougies M1 identique.

## F-002 — Collision et mutation d'identifiant entre deux setups

- Statut : `OPEN`
- Sévérité : `CRITICAL`
- Domaine : identité canonique / persistance / continuité des setups
- Impact : un Monitor ou le moteur peut lire, modifier ou clôturer le mauvais setup ; les projections front et les résultats deviennent potentiellement incohérents.

### Preuves

Deux documents ayant des `setup_record_id` différents exposent désormais le même `setup_id` :

`setup_plan_replay_2026_06_11_full_day_5m_2d1b5b62bfcf_step_0023_master_2026_06_11T02_0_candidate_2`

1. Document LONG :
   - record : setup issu du Master de `02:00` ;
   - direction : `long` ;
   - statut : `EXPIRED` ;
   - dernière mise à jour replay : `05:00`.
2. Document SHORT :
   - record physique toujours rattaché au candidat SHORT du Master initial de `00:15` ;
   - champ `setup_id` muté vers l'identifiant du LONG de `02:00` ;
   - direction : `short` ;
   - statut : `EXPIRED`.

Le problème ne vient donc pas d'un simple doublon d'affichage : l'identité métier stockée dans le document SHORT a été remplacée par celle d'un autre setup.

### Cause probable à confirmer

Une mutation de lifecycle ou une transition Monitor fusionne un payload contenant un autre `setup_id` dans un document identifié par son ancien `setup_record_id`. La persistance avec fusion conserve la clé physique du document mais remplace son identité métier.

### Correctif attendu après le run

1. Rendre `setup_id` et `setup_record_id` immuables après création.
2. Refuser toute fusion lorsque l'identité entrante ne correspond pas à l'identité du document cible.
3. Séparer explicitement :
   - `source_setup_id` ;
   - `replaces_setup_id` ;
   - `target_setup_id` ;
   - identité du document muté.
4. Ajouter une contrainte d'unicité logique sur `(backtest_id, setup_id)`.
5. Auditer toutes les mutations Master/Monitor et réparer les documents historiques touchés avant le calcul final des performances.

### Critères de non-régression

- Deux setups différents ne peuvent jamais partager le même `setup_id` dans un même replay.
- Une transition dirigée vers un setup B ne peut jamais modifier le champ identitaire d'un setup A.
- Toute tentative de fusion contradictoire doit échouer avec une erreur déterministe et auditable.

## F-003 — Timeout Codex de 12 minutes récupéré

- Statut : `OBSERVED`
- Sévérité : `MEDIUM`
- Domaine : performance et résilience du worker IA
- Impact observé : ralentissement important du replay, sans arrêt définitif.

### Preuves

- Work item : séquence `78`, `REPLAY_MONITOR`.
- Erreur conservée : `CODEX_TIMEOUT`.
- Limite atteinte : `720 000 ms`.
- L'erreur était marquée `retryable=true`.
- Le work item est finalement passé à `COMPLETED` ; le run a donc récupéré automatiquement.

### Point à vérifier après le run

Déterminer si le timeout provenait :

- d'un contexte analytique trop volumineux ;
- d'appels de recherche trop nombreux ;
- d'une commande Codex restée active sans heartbeat ;
- ou d'une limite trop basse par rapport au niveau de raisonnement demandé.

Le correctif ne devra pas simplement augmenter la durée maximale : il devra conserver un budget borné, des heartbeats et une reprise idempotente.

## F-004 — Setup devenu déclenchable juste avant son expiration, mais jamais exécuté

- Statut : `TEMPORAL_SEMANTICS_REVIEW`
- Sévérité : `HIGH`
- Domaine : ordre des transitions / frontière d'expiration / exécution M1
- Impact : setup SHORT entièrement validé mais sans instant d'exécution causal disponible avant son expiration.

### Preuves

Le SHORT issu du Master initial, valide de `00:15` à `02:00`, a obtenu :

- cassure sous `28 358` à `00:56` ;
- retest séquencé à `01:01` ;
- contact frais et rejet à `01:59` ;
- quatre conditions obligatoires sur quatre en `SATISFIED` ;
- score `0,90` pour un minimum de `0,55` ;
- état calculé `TRIGGERABLE`.

À l'évaluation suivante, au cutoff de `02:00`, le moteur a appliqué `SETUP_EXPIRED_AFTER_INTERVAL_EVALUATION` sans matérialiser la position signalée par la bougie M1 de `01:59`.

L'audit contrefactuel montre toutefois qu'une exécution à `28 350` n'est possible qu'en réutilisant la bougie de confirmation de `01:59`. Cette hypothèse donne `-1 R`, mais elle n'est pas strictement causale. Aucune nouvelle bougie ne remplit l'entrée avant l'expiration de `02:00`.

### Cause probable à confirmer

L'expiration est appliquée avant la matérialisation d'un trigger découvert dans le dernier intervalle M1 précédant la frontière. Une cadence Replay M5 évalue la fenêtre `01:55–02:00`, détecte correctement le signal de `01:59`, mais le setup est déjà considéré expiré au moment d'exécuter la transition.

### Correctif attendu après le run

1. Évaluer tous les événements M1 strictement antérieurs à `expires_at_paris`.
2. Ne jamais exécuter rétroactivement dans une bougie dont la clôture a servi à confirmer le signal.
3. Définir explicitement les intervalles comme `[from, to)` et la politique d'entrée au prochain tick ou à la prochaine bougie.
4. Expirer proprement le setup lorsqu'aucune exécution causale n'est possible après la confirmation.
5. Ajouter un test où le trigger intervient une minute avant l'expiration.

## F-005 — Gates d'entrée bloquées en UNKNOWN malgré des conditions obligatoires satisfaites

- Statut : `OPEN`
- Sévérité : `HIGH`
- Domaine : disponibilité des données canoniques / macro / compilation des gates
- Impact : plusieurs setups restent `ARMED_CONDITIONAL` ou expirent sans pouvoir entrer.

### Preuves

Le LONG du Master de `08:00`, valide jusqu'à `10:00`, présente à `09:40` :

- cassure au-dessus de `28 765` : `SATISFIED` à `08:18` ;
- retest de `28 765` : `SATISFIED` à `08:54` ;
- clôture au-dessus de `28 775` : `SATISFIED` à `09:39` ;
- trois conditions obligatoires sur trois satisfaites ;
- aucun hard blocker de prix actif.

Pourtant, le résultat reste :

- `ARMED_CONDITIONAL` ;
- `triggerable=false` ;
- raison `CANONICAL_TRIGGER_DATA_MISSING`.

Deux sources de blocage UNKNOWN sont récurrentes :

1. l'invalidation structurelle backend retourne `CONDITION_DATA_UNAVAILABLE` alors que les bougies MNQ M1 sont présentes ;
2. `MAJOR_EVENT_ENTRY_BLOCK` reste `UNKNOWN` parce que le calendrier macro historique est absent.

Le même motif apparaît sur plusieurs setups précédents.

L'audit contrefactuel précise que le LONG de `08:00` ne retrouve pas son prix d'entrée `28 780` après la dernière confirmation enregistrée. Le gate UNKNOWN reste une anomalie d'intégrité, mais aucune position profitable manquée n'est démontrée pour ce setup.

### Correctif attendu après le run

1. Inclure dans chaque pack Replay les données nécessaires à toutes les conditions de veto, pas uniquement aux conditions d'activation.
2. Évaluer les invalidations déterministes depuis les mêmes bougies canoniques M1 utilisées par le moteur de lifecycle.
3. Préparer un calendrier macro historique borné au cutoff, avec un état explicite et vérifiable.
4. Conserver le fail-closed de sécurité lorsque les données sont réellement indispensables, mais distinguer :
   - absence réelle ;
   - source non applicable ;
   - panne de projection ;
   - aucune annonce dans la fenêtre.
5. Interdire un résumé incohérent où toutes les conditions obligatoires sont satisfaites tandis que `triggerable=false` sans gate bloquante précisément identifiée.
