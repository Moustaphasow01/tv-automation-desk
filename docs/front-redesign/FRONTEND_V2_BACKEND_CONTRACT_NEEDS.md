# Front V2 — Besoins de contrat backend

Les besoins ci-dessous complètent les contrats existants ; ils ne demandent aucune duplication de la logique domaine dans le Front.

## CN-LIVE-010

```text
CONTRACT NEED
ID: CN-LIVE-010
Screen: Live Trading / graphique de marché
Purpose: publier la série OHLCV seule sans recharger la projection complète du dossier opérateur.

Backend object: market-series BFF view
Required fields: instrument, timeframe, points[], source, asOf, availability, reason, supportedInstruments[], supportedTimeframes[]
Required statuses: états de disponibilité déjà publiés par le BFF
Required allowedActions: aucune
Realtime requirement: événement marché ciblé ou polling borné ; reprise sur la dernière série valide
Security requirement: lecture opérateur, aucune API provider/broker exposée
Frontend behavior if unavailable: cache chart isolé, dernière série datée conservée, polling 15 secondes ; aucune invalidation par les événements métier ordinaires
Blocking: NO pour la présente release ; YES pour réduire durablement le volume réseau
```

## CN-EXE-001

```text
CONTRACT NEED
ID: CN-EXE-001
Screen: Live, OrderIntent Detail, Execution, Command Center
Purpose: distinguer le mode d'exécution autoritaire de l'environnement.

Backend object: execution policy snapshot
Required fields: executionMode, autoExecutionEnabled, source, asOf, revision
Required statuses: SHADOW, SEMI_MANUAL, PAPER, LIVE ou enums publiés
Required allowedActions: aucun pour la lecture ; action dédiée si une mutation certifiée existe
Realtime requirement: invalidation lors d'un changement de policy
Security requirement: mutation fail-closed et step-up selon policy
Frontend behavior if unavailable: UNKNOWN / UNAVAILABLE, jamais SEMI_MANUAL par défaut
Blocking: YES pour afficher un mode autoritaire
```

## CN-EXE-002

```text
CONTRACT NEED
ID: CN-EXE-002
Screen: OrderIntent Detail
Purpose: fournir le dossier canonique Risk → TargetPosition → OrderIntent.

Backend object: portfolio_order_intent detail projection
Required fields: IDs et versions strategy/signal/context/arbitration/risk/target/intent ; instrument, side, account, authorizedQuantity, entry, stop, targets ; decisions/reasonCodes ; riskPolicy/version ; createdAt/expiresAt ; source/asOf/revision/correlationId
Required statuses: enums domaine exacts
Required allowedActions: resource.allowedActions
Realtime requirement: invalidation par aggregateId/revision
Security requirement: lecture scoppée au compte ; aucune donnée provider secrète
Frontend behavior if unavailable: sections explicitement UNAVAILABLE, projection broker existante conservée
Blocking: YES pour le dossier canonique complet
```

## CN-EXE-003

```text
CONTRACT NEED
ID: CN-EXE-003
Screen: Human Execution Gate
Purpose: confirmer ou rejeter sans déduire une permission côté client.

Backend object: human_execution_gate + command catalog
Required fields: gateId, status, expectedRevision, impactPreview, reasonRequired, confirmationRequired, stepUpRequired, allowedActions[] avec actionId/commandType/environment/capability
Required statuses: enums de human_execution_gates
Required allowedActions: CONFIRM, REJECT et EXPIRE uniquement si exposé
Realtime requirement: terminal command puis refetch du dossier
Security requirement: permission, step-up, idempotency, If-Match et audit receipt côté backend
Frontend behavior if unavailable: boutons absents ou désactivés avec raison
Blocking: YES pour toute action opérateur
```

## CN-EXE-004

```text
CONTRACT NEED
ID: CN-EXE-004
Screen: Provider Lifecycle Timeline
Purpose: distinguer commande, claim, ACK, partial fill, fill et rejet.

Backend object: provider command lifecycle projection
Required fields: commandId, providerId, eventId, eventType, rawStatus, occurredAt, receivedAt, source, actor, entity, correlationId, causationId, sequence, revision, details
Required statuses: enums provider exacts
Required allowedActions: backend-driven seulement
Realtime requirement: événements ordonnés, dédupliqués et reprenables
Security requirement: aucune credential/provider payload sensible
Frontend behavior if unavailable: historique broker existant + avertissement PARTIAL
Blocking: NO pour la lecture actuelle, YES pour certification lifecycle
```

## CN-EXE-005

```text
CONTRACT NEED
ID: CN-EXE-005
Screen: OrderIntent Detail / Reconciliation
Purpose: comparer l'état attendu au broker sans déclarer un PASS implicite.

Backend object: order-intent reconciliation projection
Required fields: reconciliationId, status, checkedAt, expected{}, broker{}, mismatches[], source, revision
Required statuses: PASS, FILL_INCOMPLETE, CONTROLLED_DIVERGENCE, NO_ACTIVITY ou enums publiés
Required allowedActions: aucune déduite ; remédiations explicites seulement
Realtime requirement: mismatch persistant jusqu'à résolution backend
Security requirement: données scoppées au compte
Frontend behavior if unavailable: NOT_RUN / UNAVAILABLE, jamais MATCHED
Blocking: YES pour certification de fin de cycle
```

## CN-EXE-006

```text
CONTRACT NEED
ID: CN-EXE-006
Screen: Execution Mode / Human Gate / Providers
Purpose: expliquer pourquoi l'exécution est disponible ou bloquée.

Backend object: provider route + circuit breaker snapshot
Required fields: providerId, connectivity, circuitState, routeStatus, lastHeartbeatAt, lastKnownAt, reasonCodes, revision
Required statuses: CLOSED, HALF_OPEN, OPEN et routes exactes du domaine
Required allowedActions: resource.allowedActions
Realtime requirement: invalidation immédiate du gate lors d'une ouverture
Security requirement: fail-closed
Frontend behavior if unavailable: DEGRADED READ-ONLY et actions sensibles indisponibles
Blocking: YES pour Confirm
```

## CN-EXE-007

```text
CONTRACT NEED
ID: CN-EXE-007
Screen: toutes les vues temps réel du dossier
Purpose: reprise SSE, déduplication, ordre et détection des gaps.

Backend object: event envelope
Required fields: eventId, aggregateId, aggregateType, sequence, eventType, occurredAt, receivedAt, source, correlationId, causationId, revision, payload
Required statuses: n/a
Required allowedActions: n/a
Realtime requirement: cursor reprenable et séquence monotone par aggregate
Security requirement: payload filtré par capacité
Frontend behavior if unavailable: reconnect et déduplication existants ; aucun numéro de séquence inventé
Blocking: NO pour lecture, YES pour certification realtime
```

## CN-EXE-008

```text
CONTRACT NEED
ID: CN-EXE-008
Screen: Human Execution Gate
Purpose: appliquer la policy de step-up aux commandes critiques.

Backend object: session capability + step-up challenge
Required fields: required, method, challengeId, expiresAt, verifiedAt, allowedActionId
Required statuses: policy/auth enums exacts
Required allowedActions: action autorisée après preuve backend uniquement
Realtime requirement: invalidation à expiration
Security requirement: aucun MFA simulé ou secret stocké dans le Front
Frontend behavior if unavailable: action step-up bloquée et expliquée
Blocking: YES lorsque l'action exige un step-up
```

## CN-EXE-009

**État observé le 2026-08-16 :** le repository lit désormais le schéma canonique et les tests BFF passent. Le snapshot local ne remonte plus `SQLSTATE 42703`, mais la source `execution` est actuellement `UNAVAILABLE` pour timeout de connexion. La correction de schéma est donc intégrée ; la certification opérationnelle reste à refaire lorsque PostgreSQL est stable.

```text
CONTRACT NEED
ID: CN-EXE-009
Screen: Command Center / OrderIntent / Human Gate / Provider Runtime
Purpose: rendre la projection d'exécution compatible avec le schéma PostgreSQL canonique réellement déployé.

Backend object: broker execution overview repository
Required fields: colonnes canoniques portfolio_risk_decisions (requested_size, approved_size, reason_codes, limits_applied, risk_budget_id, risk_rule_set_version, risk_evaluation_hash, payload)
Required statuses: enums domaine exacts
Required allowedActions: inchangé ; backend-driven seulement
Realtime requirement: aucun besoin supplémentaire
Security requirement: aucune synthèse locale de Risk ou d'allowedActions pour contourner l'échec
Frontend behavior if unavailable: Execution Mode, Human Gate et Provider restent UNKNOWN / UNAVAILABLE et non actionnables
Blocking: YES pour la certification du cycle semi-manuel
Observed failure: SQLSTATE 42703 ; la requête lit des colonnes historiques absentes (requested, authorized, trade_risk, portfolio_before/after, limits, nearest_limit, breaches, risk_economics)
```

## CN-DATA-001

**État observé le 2026-08-16 :** la projection Live publie `marketData=STALE`, `meta.stale=true` et un `asOf` cohérent. L'incohérence `FRESH` avec âge très ancien n'est pas reproduite. Le besoin reste surveillé comme garde de non-régression.

```text
CONTRACT NEED
ID: CN-DATA-001
Screen: Command Center / Market & Data Freshness
Purpose: garantir qu'un statut FRESH reste cohérent avec l'âge réel des flux centraux.

Backend object: market data readiness projection
Required fields: status, asOf, ageSeconds, thresholdSeconds, reasonCodes, source
Required statuses: FRESH, STALE, UNAVAILABLE ou enums publiés
Required allowedActions: aucun
Realtime requirement: invalidation lors du franchissement du seuil
Security requirement: n/a
Frontend behavior if unavailable: UNAVAILABLE ; le frontend ne recalcule pas une fraîcheur officielle
Blocking: YES pour afficher FRESH comme vérité opérateur
Observed inconsistency: statut FRESH publié alors que l'âge des flux centraux dépasse 220 000 secondes dans l'environnement local observé.
```

## LT-DATA-001

```text
FRONT CONTRACT QUESTION
ID: LT-DATA-001
Screen: Live Trading
Section: Instrument Chart / Market Context
User question: quelles séries réelles doivent alimenter les chandeliers, VWAP, volume, niveaux et sparklines ?

Backend object: paged canonical market time series
Endpoint: à publier sous /front-api/v1, référencé par timeSeriesContracts.seriesId=market.ohlcv et market.vwap
Fields found: seriesId, availability, source, unit, sampling, granularity, maxPoints, cursor, schema
Missing field: endpoint/route résoluble, points[], nextCursor, instrument, timeframe, sourceAsOf, sourceRevision
Expected enum: availability existante et timeframes backend
AllowedActions: aucune
Realtime requirement: invalidation ou append avec eventId/sequence/cursor ; resync en cas de gap
Frontend behavior if unavailable: chart quadrillé avec UNAVAILABLE, raison/source/asOf ; aucun chandelier, niveau ou sparkline à zéro
Blocking: NO pour la sûreté du cockpit ; YES pour le chart live fonctionnel
```

## LT-EXE-001

```text
FRONT CONTRACT QUESTION
ID: LT-EXE-001
Screen: Live Trading
Section: Position Reconciliation
User question: la position théorique correspond-elle à la position broker et quelles divergences restent ouvertes ?

Backend object: live order-intent reconciliation projection
Endpoint: GET /front-api/v1/views/live-trading ou drill-down canonique lié à l'OrderIntent
Fields found: contrat générique CN-EXE-005 ; aucune projection expected vs broker dans le snapshot Live courant
Missing field: reconciliationId, status, expected{}, broker{}, mismatches[], checkedAt, source, revision, correlationId
Expected enum: enums backend exacts ; UNKNOWN_STATUS toléré côté Front
AllowedActions: remédiations explicites backend uniquement
Realtime requirement: mismatch persistant jusqu'à événement de résolution et refetch
Frontend behavior if unavailable: colonnes THEORETICAL/BROKER et résultat marqués UNAVAILABLE ; jamais IN SYNC par défaut
Blocking: YES pour certifier la fin du lifecycle provider
```

## LT-PERF-001

```text
FRONT CONTRACT QUESTION
ID: LT-PERF-001
Screen: Live Trading
Section: Research / Performance (Today)
User question: quelle performance en R est officiellement publiée pour la séance et selon quelle nature de source ?

Backend object: paged live R-equity series
Endpoint: à publier sous /front-api/v1, référencé par timeSeriesContracts.seriesId=performance.r_equity
Fields found: contract schema timestamp/cumulativeR/drawdownR, availability, source
Missing field: points[], nature (RESEARCH/THEORETICAL/SHADOW/PAPER/BROKER_CONFIRMED), nextCursor, asOf, revision
Expected enum: nature de performance backend
AllowedActions: aucune
Realtime requirement: append ordonné et resync sur gap
Frontend behavior if unavailable: valeurs et courbe UNAVAILABLE ; aucun R calculé localement
Blocking: NO pour la sûreté ; YES pour la visualisation de performance live
```

## LT-RT-001

```text
FRONT CONTRACT QUESTION
ID: LT-RT-001
Screen: Live Trading
Section: Event Timeline / Provider Runtime
User question: comment reprendre sans perte ni doublon le lifecycle Signal → Reconciliation après une coupure SSE ?

Backend object: realtime event envelope
Endpoint: /front-api/v1/realtime
Fields found: cursor recovery existante et contrat général CN-EXE-007
Missing field: garantie publiée pour sequence monotone par aggregate, gap marker, aggregateId/type sur chaque événement Live
Expected enum: eventType backend exact ; code inconnu affiché comme UNKNOWN
AllowedActions: aucune
Realtime requirement: eventId, cursor, aggregateId, aggregateType, sequence, revision, occurredAt, receivedAt, correlationId, causationId
Frontend behavior if unavailable: snapshot/refetch, déduplication connue, état RECONNECTING ; aucune transition provider inventée
Blocking: NO pour lecture snapshot ; YES pour certification temps réel
```

## LT-SIGNAL-002

```text
CONTRACT NEED
ID: LT-SIGNAL-002
Screen: Live Trading / Inbox des signaux
Purpose: parcourir l'historique global multi-instruments sans limite implicite du catalogue courant.

Backend object: paged canonical StrategySignal projection
Required fields: signalId, strategyId/version/instance, instrument, direction, state, setup, confidence, proposedTradePlan, sourceDataCutoffAt, createdAt, expiresAt, lineage IDs
Required statuses: enums signal exacts
Required allowedActions: aucune ; les actions restent attachées au Human Gate
Realtime requirement: append par eventId/revision puis reprise par cursor
Security requirement: aucune logique Risk ou allowedActions synthétisée
Frontend behavior if unavailable: afficher la fenêtre publiée et sa limite, sans annoncer « tous les signaux »
Blocking: NO pour le cockpit courant ; YES pour l'historique exhaustif
```

## LT-TIMELINE-002

```text
CONTRACT NEED
ID: LT-TIMELINE-002
Screen: Live Trading / Graphique et parcours Signal → Human Gate
Purpose: positionner chaque étape sur le graphique sans l'inférer depuis un timestamp voisin.

Backend object: canonical signal lineage timeline
Required fields: entityId, entityType, eventType, occurredAt, source, correlationId, causationId, revision
Required statuses: enums domaine exacts
Required allowedActions: aucune
Realtime requirement: ordre et déduplication par enveloppe canonique
Security requirement: données d'audit filtrées selon la session
Frontend behavior if unavailable: ne pas dessiner les marqueurs Portfolio/Risk/Human Gate concernés
Blocking: NO pour les données ; YES pour déclarer la timeline graphique exhaustive
```
