# TD2-418 — Desk Cold Start Control Plane

Date: 2026-08-14  
Repository: `TV_Automation_PREPROD`  
Scope: premier lot backend/BFF pour piloter `status`, `doctor`, `start`, `stop`, `restart` du desk depuis le control-plane opérateur, sans ouvrir d'exécution broker implicite.

## Résultat

Statut du ticket: **FAIT pour le périmètre TD2-418 safe-control-plane runtime**.

Ce lot ajoute un control-plane opérationnel audité et fail-closed. Les commandes existent dans `/front-api/v1/commands`, sont idempotentes via le mécanisme existant de commandes front, publient un résultat structuré, et ne peuvent pas activer le broker, le live ou l'auto-exécution.

La preuve VPS runtime est fermée sur la release:

```text
preprod-v2-convergence-20260814.4-td2-418-runtime-proof
```

Important: l'actuator Windows réel existe et est testé, mais le BFF reste volontairement en `PLAN_ONLY_FAIL_CLOSED` par défaut. Le test réel VPS exécuté est un `START` idempotent/no-op: tous les services étaient déjà `Running`, donc aucune mutation Windows n'a été nécessaire. Les chemins `STOP` / `RESTART` réels restent à rejouer uniquement en fenêtre de maintenance, car leur exécution muterait réellement le desk.

## Implémentation

### State machine opérationnelle

Fichier:

- `mcp_gpt_desk/src/desk-operational-control-service.js`

États ajoutés:

- `STOPPED`
- `STARTING`
- `DEGRADED`
- `READY_SHADOW`
- `READY_SEMI_MANUAL`
- `PAPER_READY`
- `STOPPING`
- `FAILED`

Preuves:

- `mcp_gpt_desk/src/desk-operational-control-service.js:3`
- `mcp_gpt_desk/src/desk-operational-control-service.js:14`
- `mcp_gpt_desk/src/desk-operational-control-service.js:27`
- `mcp_gpt_desk/src/desk-operational-control-service.js:46`
- `mcp_gpt_desk/src/desk-operational-control-service.js:102`
- `mcp_gpt_desk/src/desk-operational-control-service.js:126`

La dérivation d'état vérifie notamment:

- API prête;
- PostgreSQL source de vérité;
- données live fraîches ou marché fermé;
- exécution broker fermée / semi-manuelle;
- Telegram trading prêt ou explicitement optionnel;
- heartbeats des services critiques;
- stale heartbeat avec seuils déterministes.

### Commandes BFF ajoutées

Fichier:

- `mcp_gpt_desk/src/front-control-plane-command.js`

Commandes ajoutées au catalogue:

- `desk.status`
- `desk.doctor`
- `desk.start`
- `desk.stop`
- `desk.restart`

Preuves:

- `mcp_gpt_desk/src/front-control-plane-command.js:1`
- `mcp_gpt_desk/src/front-control-plane-command.js:11`
- `mcp_gpt_desk/src/front-control-plane-command.js:17`
- `mcp_gpt_desk/src/front-control-plane-command.js:23`
- `mcp_gpt_desk/src/front-control-plane-command.js:29`
- `mcp_gpt_desk/src/front-control-plane-command.js:35`
- `mcp_gpt_desk/src/front-control-plane-command.js:155`
- `mcp_gpt_desk/src/front-control-plane-command.js:169`
- `mcp_gpt_desk/src/front-control-plane-command.js:286`

Toutes ces commandes:

- exigent un opérateur `desk.write`;
- sont refusées en environnement `LIVE`;
- persistent leur commande/audit/event via le mécanisme front-control-plane existant;
- utilisent l'aggregate stable `desk:operational-control`;
- exposent `broker_execution=false`;
- exposent `order_submission_enabled=false`.

### Fail-closed start/stop/restart

Par défaut, `desk.start`, `desk.stop` et `desk.restart` retournent un plan audité en `PLAN_ONLY_FAIL_CLOSED`.

La commande ne déclenche aucun effet de bord tant que:

```text
DESK_OPERATIONAL_CONTROL_ACTUATOR=windows_service
```

n'est pas explicitement configuré et certifié dans un lot séparé.

Cela empêche une simple commande front ou BFF de redémarrer des services, d'ouvrir le broker ou d'activer l'exécution automatique.

Preuves:

- `mcp_gpt_desk/src/desk-operational-control-service.js:217`
- `mcp_gpt_desk/src/desk-operational-control-service.js:232`
- `mcp_gpt_desk/src/desk-operational-control-service.js:240`
- `mcp_gpt_desk/test/desk_operational_control_service.test.js:48`
- `mcp_gpt_desk/test/front_control_plane_api.test.js:431`

### Actuator Windows certifié

Fichier:

- `mcp_gpt_desk/src/desk-windows-service-actuator.js`

Propriétés certifiées:

- allowlist stricte des services;
- ordre de dépendance `START`;
- ordre rollback `STOP`;
- dry-run par défaut;
- timeout borné;
- contrôle des services manquants;
- no-op idempotent si le service est déjà dans l'état attendu;
- aucun flag `broker_execution`, `live_execution`, `auto_execution` ou `provider_command_allowed`.

Preuves code/tests:

- `mcp_gpt_desk/src/desk-windows-service-actuator.js:5`
- `mcp_gpt_desk/src/desk-windows-service-actuator.js:25`
- `mcp_gpt_desk/src/desk-windows-service-actuator.js:36`
- `mcp_gpt_desk/src/desk-windows-service-actuator.js:82`
- `mcp_gpt_desk/src/desk-windows-service-actuator.js:101`
- `mcp_gpt_desk/src/desk-windows-service-actuator.js:124`
- `mcp_gpt_desk/test/desk_windows_service_actuator.test.js:12`
- `mcp_gpt_desk/test/desk_windows_service_actuator.test.js:28`
- `mcp_gpt_desk/test/desk_windows_service_actuator.test.js:37`
- `mcp_gpt_desk/test/desk_windows_service_actuator.test.js:46`
- `mcp_gpt_desk/test/desk_windows_service_actuator.test.js:59`
- `mcp_gpt_desk/test/desk_windows_service_actuator.test.js:70`

Preuve runtime VPS réelle:

```text
2026-08-14T15:17:31Z
Services inspectés: 12
Services existants: 12
Services Running: 12
Services manquants: 0

2026-08-14T15:18:20Z
executeWindowsServiceActuator({ action: "start", dryRun: false })
status: PASSED
dry_run: false
operation_count: 9
mutated_count: 0
missing_services: []
failures: []
broker_execution: false
live_execution: false
auto_execution: false
provider_command_allowed: false
```

### Panneau VNext Command Center

Fichiers:

- `apps/desk-control-plane/src/pages/CommandCenterPage.tsx`
- `apps/desk-control-plane/src/design-system/styles.css`

Le Command Center expose maintenant un panneau compact `Contrôle du desk` avec:

- `Status`;
- `Doctor`;
- `Start plan`;
- `Stop plan`;
- `Restart plan`;
- affichage de la dernière commande BFF;
- affichage `state`, `outcome`, blockers, warnings;
- désactivation si les capabilities BFF ne l'autorisent pas;
- rappel explicite que broker/live/auto restent fermés.

Le panneau utilise le transport réel `submitCommand` / `/front-api/v1/commands` et ne parle jamais directement à un provider/broker.

Preuves:

- `apps/desk-control-plane/src/pages/CommandCenterPage.tsx:1`
- `apps/desk-control-plane/src/pages/CommandCenterPage.tsx:18`
- `apps/desk-control-plane/src/pages/CommandCenterPage.tsx:24`
- `apps/desk-control-plane/src/pages/CommandCenterPage.tsx:31`
- `apps/desk-control-plane/src/pages/CommandCenterPage.tsx:99`
- `apps/desk-control-plane/src/pages/CommandCenterPage.tsx:207`
- `apps/desk-control-plane/src/pages/CommandCenterPage.tsx:221`
- `apps/desk-control-plane/src/pages/CommandCenterPage.tsx:250`
- `apps/desk-control-plane/src/pages/CommandCenterPage.tsx:284`
- `apps/desk-control-plane/src/design-system/styles.css:3868`

## Tests ajoutés

### Service opérationnel

Fichier:

- `mcp_gpt_desk/test/desk_operational_control_service.test.js`

Cas couverts:

- état `PAPER_READY` lorsque le desk est sain et en semi-manuel;
- fail-closed `FAILED` lorsque PostgreSQL n'est pas la source de vérité;
- `desk.start` audité en plan-only sans side effects;
- `desk.doctor` dégradé lorsque la data live est stale, sans ouvrir l'exécution.

Preuves:

- `mcp_gpt_desk/test/desk_operational_control_service.test.js:12`
- `mcp_gpt_desk/test/desk_operational_control_service.test.js:30`
- `mcp_gpt_desk/test/desk_operational_control_service.test.js:48`
- `mcp_gpt_desk/test/desk_operational_control_service.test.js:72`

### API/BFF front-control-plane

Fichier:

- `mcp_gpt_desk/test/front_control_plane_api.test.js`

Cas couverts:

- catalogue capabilities publie les commandes `desk.*`;
- `desk.status` passe par `/front-api/v1/commands`;
- `desk.start` passe par le même chemin audité;
- résultat `PAPER_READY`;
- start reste `PLAN_ONLY_FAIL_CLOSED`;
- aucun `broker_execution`;
- aucun `order_submission_enabled`.

Preuves:

- `mcp_gpt_desk/test/front_control_plane_api.test.js:43`
- `mcp_gpt_desk/test/front_control_plane_api.test.js:389`
- `mcp_gpt_desk/test/front_control_plane_api.test.js:423`
- `mcp_gpt_desk/test/front_control_plane_api.test.js:446`
- `mcp_gpt_desk/test/front_control_plane_api.test.js:453`

## Commandes exécutées

### Tests ciblés

```text
node --test mcp_gpt_desk/test/desk_windows_service_actuator.test.js mcp_gpt_desk/test/desk_operational_control_service.test.js mcp_gpt_desk/test/front_control_plane_api.test.js
```

Résultat:

```text
30 pass / 0 fail
```

### Suite MCP complète

```text
npm --prefix mcp_gpt_desk test
```

Résultat:

```text
1100 pass / 0 fail
```

Note: la suite complète a été exécutée avant le dernier durcissement du script de certification; les tests ciblés TD2-418 ont ensuite été rejoués et passent.

### Guards

```text
npm run --silent guard:architecture
npm run --silent guard:runtime-safety
npm run --silent guard:mcp-slices
npm run --silent guard:jarvis-authority
npm run --silent guard:problem-details
npm run --silent guard:sql-migrations
npm run --silent guard:windows-deployment
npm run --silent guard:static-quality
npm run --silent guard:front-architecture
npm run --silent guard:front-vnext-data-mode
npm run --silent guard:front-vnext-legacy
npm run --silent guard:browser-secrets
npm run --silent guard:api-compatibility
```

Résultats:

```text
guard:architecture        OK
guard:runtime-safety      OK
guard:mcp-slices          OK
guard:jarvis-authority    OK
guard:problem-details     OK
guard:sql-migrations      OK
guard:windows-deployment  OK
guard:static-quality      OK
guard:front-architecture  OK
guard:front-vnext-data-mode OK
guard:front-vnext-legacy  OK
guard:browser-secrets     OK
guard:api-compatibility   OK
```

Preuve spécifique Jarvis/security:

```text
frontCommands=9
violations=0
desk.status/doctor/start/stop/restart => NO_DIRECT_BROKER_EFFECT
```

Preuve static-quality:

```text
high_complexity_function_count=650
allowed=650
```

Le lot n'augmente donc pas la dette static-quality.

### Front VNext

```text
npm --prefix apps/desk-control-plane run typecheck
npm --prefix apps/desk-control-plane test
npm --prefix apps/desk-control-plane run build
```

Résultats:

```text
typecheck OK
35 test files passed
161 tests passed
vite build OK
```

## Matrice d'exigences TD2-418

| Requirement | Current status | Gap initial | Implementation | Tests | Runtime proof | Final status |
|---|---:|---|---|---|---|---:|
| Exposer `desk.status` côté BFF | PARTIEL | Pas de commande opérateur stable pour status cold-start | Catalogue `desk.status` + service état | `front_control_plane_api.test.js` | VPS: `ACCEPTED` → `SUCCEEDED` → persistence/audit/idempotence | FAIT |
| Exposer `desk.doctor` côté BFF | PARTIEL | Diagnostic dispersé dans health/readiness | `desk.doctor` retourne checks/remediations | `desk_operational_control_service.test.js` | VPS: `ACCEPTED` → `SUCCEEDED` → persistence/audit/idempotence | FAIT |
| Exposer `desk.start/stop/restart` côté BFF | PARTIEL | Pas de commande opérateur dédiée | Commandes catalogue + plan idempotent | `front_control_plane_api.test.js` | VPS: 3 commandes `ACCEPTED` → `SUCCEEDED`, `PLAN_ONLY_FAIL_CLOSED` | FAIT |
| Empêcher tout effet broker/live/auto | PARTIEL | Un start opérationnel pourrait devenir dangereux sans garde explicite | `broker_execution=false`, `live_execution=false`, `auto_execution=false`, actuator off par défaut | service + API tests | VPS: 0 delta broker/provider/outbox/order queues | FAIT |
| Fail-closed si PostgreSQL n'est pas source de vérité | PARTIEL | Aucun état cold-start centralisé | check `api.postgres_mode` → `FAILED` | service test | test `mode=memory` | FAIT |
| Vérifier données live, services et Telegram | PARTIEL | Readiness éclatée | checks `data.live_fresh`, services, telegram | service tests | doctor output | FAIT pour backend |
| Actuator Windows DRY-RUN | NON PROUVÉ | Pas d'allowlist/order/rollback certifiés | `desk-windows-service-actuator.js` | actuator unit tests | VPS: `DRY_RUN_PASSED`, 12 services, 18 ops, 0 missing | FAIT |
| START Windows réel idempotent | NON PROUVÉ | Pas de preuve runtime réelle | `executeWindowsServiceActuator({action:"start", dryRun:false})` | actuator unit tests | VPS: `PASSED`, 9 NOOP, `mutated_count=0` | FAIT |
| STOP/RESTART Windows réel mutatif | NON PROUVÉ | Leur exécution coupe/redémarre des services | Implémenté et testé par fake runner | actuator unit tests | Non exécuté en prod hors fenêtre maintenance | BLOQUÉ EXTERNE |
| Runtime services/workers observables | PARTIEL | Heartbeats runtime non prouvés sur VPS | `desk_service_heartbeats` + services Windows | admin/runtime tests | VPS: 9/9 heartbeats frais, max 12s | FAIT |
| Event-driven worker wake | PARTIEL | Eventing réel non prouvé | trigger `desk_agent_runtime_ready` | SQL + supervisor tests | VPS: NOTIFY reçu sur tâche certif | FAIT |
| Lease / double ownership | PARTIEL | Anti double-worker non prouvé runtime | `PostgresAgentRuntimeRepository.claimNextTask` | domain/repository tests | VPS: 1 claim, second claim returns null | FAIT |
| DLQ/recovery/idempotence | PARTIEL | Recovery non prouvée runtime | `failTaskWithRecovery`, `requeueDeadLetter` | admin/runtime tests | VPS: DLQ OPEN puis requeue idempotent même recovery task | FAIT |
| Worker crash / expired lease recovery | PARTIEL | Reprise après worker mort non prouvée runtime | expired lease reclaim via repository | domain tests | VPS: task reclaimed by new worker, attempt_count=2, final DONE | FAIT |
| Research autonome complet | PARTIEL | Generic runtime prouvé, mais pas campagne Research réelle | Runtime agent/research existe | tests existants | Nécessite campagne Research réelle TD2-420 | PARTIEL |
| Boutons front VNext start/stop/status/doctor | PARTIEL | BFF prêt mais UI non branchée | Panneau Command Center `Contrôle du desk` | Vitest + typecheck + build | Déployé dans release VPS `.4`; preuve navigateur dédiée reste à faire côté TD2-419/VNext | PARTIEL |

## Preuves runtime VPS finales

### Release déployée

```text
release: preprod-v2-convergence-20260814.4-td2-418-runtime-proof
artifact_sha256: d2bdf100340b22461f825ce522fe7ed26247314459356124a93060b0886b8895
deploy_id: deploy-20260814T151128Z-f108a353
db_backup: desk-native-20260814T150854Z.dump
db_backup_sha256: 64af18d194c2f7d53ee592eb263f1fc3ea40a420a6526a70b27a7a3fd8e6517a
object_backup: desk-objects-20260814T151015Z.tar.gz
object_backup_sha256: 08752cbf59cda8d021cf2c78aba7d338b0962dff09b3e2750a92a1bdf3c71c84
```

### Endpoints VPS

```text
GET https://vps-6d6969db.vps.ovh.net/healthz
200 OK
release_version: preprod-v2-convergence-20260814.4-td2-418-runtime-proof

GET https://vps-6d6969db.vps.ovh.net/readyz
200 OK
ready: true
mode: postgres
data_readiness.ok: true

GET https://vps-6d6969db.vps.ovh.net/front-api/v1/capabilities
200 OK
actions: desk.status, desk.doctor, desk.start, desk.stop, desk.restart
front.command.allowed: false without operator session
```

### Certification BFF/session opérateur

Script:

- `mcp_gpt_desk/scripts/certify_td2_418_runtime.mjs`

Commande VPS:

```text
node.exe --env-file=C:\ProgramData\DeskFutures\config\desk.env C:\DeskFutures\current\app\mcp_gpt_desk\scripts\certify_td2_418_runtime.mjs --base-url=http://127.0.0.1:8787
```

Résultat:

```text
status: PASSED
operator_login: 200 authenticated
capabilities: desk.status, desk.doctor, desk.start, desk.stop, desk.restart

desk.status: ACCEPTED → SUCCEEDED, persisted=true, audited=true, idempotent=true
desk.doctor: ACCEPTED → SUCCEEDED, persisted=true, audited=true, idempotent=true
desk.start: ACCEPTED → SUCCEEDED, PLAN_ONLY_FAIL_CLOSED, persisted=true, audited=true, idempotent=true
desk.stop: ACCEPTED → SUCCEEDED, PLAN_ONLY_FAIL_CLOSED, persisted=true, audited=true, idempotent=true
desk.restart: ACCEPTED → SUCCEEDED, PLAN_ONLY_FAIL_CLOSED, persisted=true, audited=true, idempotent=true
```

Command IDs certifiés:

```text
desk.status:  cmd_front_fb3b0436f0cba2cd69c43a76
desk.doctor:  cmd_front_583d94a8f6d72abbb952d212
desk.start:   cmd_front_6d3dd3c64da83707722f057c
desk.stop:    cmd_front_5fe76a53c4402343426e7a27
desk.restart: cmd_front_7ebfa0938e3bd0d2cfc7838e
```

Side effects broker/provider:

```text
before == after
broker_provider_commands: 0
broker_provider_events: 0
broker_execution_outbox: 8
broker_management_outbox: 10
broker_orders: 15
trade_order_intents: 8
portfolio_order_intent_lineage: 0
```

### PLAN_ONLY_FAIL_CLOSED

Certifié sur VPS pour:

```text
desk.start
desk.stop
desk.restart
```

Chaque résultat conserve:

```text
broker_execution: false
live_execution: false
auto_execution: false
order_submission_enabled: false
```

### Actuator Windows

Dry-run VPS:

```text
status: DRY_RUN_PASSED
dry_run: true
service_count: 12
operation_count: 18
missing_services: []
broker_execution: false
live_execution: false
auto_execution: false
```

START réel VPS idempotent:

```text
status: PASSED
dry_run: false
action: start
service_count: 12
operation_count: 9
mutated_count: 0
missing_services: []
failures: []
```

### Agent Runtime / worker recovery

Script repository:

- `mcp_gpt_desk/scripts/certify_td2_418_worker_runtime.mjs`

Exécution VPS:

```text
release runtime cible: preprod-v2-convergence-20260814.4-td2-418-runtime-proof
mode: script temporaire exécuté depuis C:\DeskFutures\current\app\mcp_gpt_desk
schema: td2_418_worker_runtime_certification_v1
status: PASSED
checked_at_utc: 2026-08-14T15:28:06.798Z
run_id: td2-418-worker-1786721286798-1d5ca080
lane: td2_418_certification
```

Preuves fermées:

```text
agent_runtime.schema: OK
runtime.heartbeats: OK
expected heartbeats: 9
observed heartbeats: 9
max_observed_age_seconds: 12
missing: []
stale_expected: []

agent_runtime.eventing_notify: OK
notification channel: desk_agent_runtime_ready
payload schema: desk_agent_runtime_ready_v1
task_id: 9814bf8a-33af-449a-8d37-14d6b2418e2b
mission_id: d07d17e6-608a-467f-8483-e0c4a583823c

agent_runtime.claim_lease: OK
worker: td2-418-proof-worker-01
status: CLAIMED
lease token: redacted/protected

agent_runtime.double_claim_blocked: OK
second_claim_returned_task: false

agent_runtime.dead_letter: OK
dead_letter_id: ae31ab39-f5dd-4492-9eff-93e285362dda
error_code: TD2_418_CERTIFICATION_TERMINAL

agent_runtime.dlq_requeue_idempotent: OK
recovery_task_id: cb51da7b-690a-4aa6-ad09-495069cd0d01
same_recovery_task: true

agent_runtime.recovery_complete: OK
status: DONE

agent_runtime.expired_lease_recovery: OK
original_worker: td2-418-dead-worker
reclaim_worker: td2-418-proof-worker-04
attempt_count: 2
final_status: DONE

agent_runtime.persistence_audit: OK
tasks: 3
leases: 3
events: 8
metrics: 1
```

Side effects broker/provider:

```text
before == after
broker_provider_commands: 0
broker_provider_events: 0
broker_execution_outbox: 8
broker_management_outbox: 10
broker_orders: 15
trade_order_intents: 8
portfolio_order_intent_lineage: 0
```

Heartbeats runtime frais certifiés:

```text
agent_runtime_supervisor_live
agent_runtime_supervisor_research
broker_management
codex_live_worker_01
codex_live_worker_02
codex_replay_worker_01
live_runtime_scheduler
replay_preparation_worker
telegram_alert_worker
```

## Blockers restants / limites volontaires

1. `STOP` et `RESTART` Windows réels n'ont pas été exécutés sur le VPS en dehors d'une fenêtre de maintenance. Ils sont implémentés et testés par fake runner, mais leur preuve runtime mutative reste volontairement `BLOQUÉ EXTERNE`.

2. Le BFF reste en `PLAN_ONLY_FAIL_CLOSED` pour `desk.start/stop/restart`, par conception. Une activation de l'actuator réel via le BFF nécessitera une décision opérateur explicite et une fenêtre de maintenance.

3. La preuve Research autonome complète reste à faire au niveau TD2-420: campagne réelle sur Strategy_ID, workers de recherche, artifacts, gates, restart/recovery et verdict GO/NO-GO.

## Prochain lot recommandé

Passer à TD2-419:

1. prouver le chemin UI VNext contre BFF VPS;
2. fermer le mode dégradé/capabilities/allowedActions côté front;
3. conserver le rollback frontend et le feature flag tant que le cutover VNext n'est pas validé.
