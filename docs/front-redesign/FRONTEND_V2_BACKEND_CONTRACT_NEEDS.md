# Front V2 — Besoins de contrat backend

Les besoins ci-dessous complètent les contrats existants ; ils ne demandent aucune duplication de la logique domaine dans le Front.

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
