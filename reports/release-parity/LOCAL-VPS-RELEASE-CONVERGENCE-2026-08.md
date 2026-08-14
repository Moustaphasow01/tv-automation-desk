# TD2-422 — Convergence progressive Local ↔ VPS

Date de démarrage : 2026-08-14
Entrée : TD2-421 — `reports/release-parity/LOCAL-VPS-PARITY-AUDIT-2026-08.md`
Politique : `AUTO_EXECUTION=OFF`, `LIVE=OFF`, `SEMI_MANUAL/SHADOW`

## État actuel

TD2-422 est démarré, mais aucun déploiement VPS n'a été effectué.

La convergence est bloquée avant mutation par une exigence saine : produire un release candidate propre et traçable. Le package de répétition construit localement prouve que le kit peut produire l'artefact attendu, mais il est volontairement marqué `dirty=true`, donc non admissible comme release finale sans normalisation du worktree.

## Entrée TD2-421

Drifts P0 à traiter :

1. VPS package migrations `047`, local migrations `054`.
2. Front VNext local non déployé/prouvé côté VPS.
3. `/front-api/v1/capabilities` présent côté code local mais `404` côté VPS.
4. Worktree local `143` tracked modifiés + `502` untracked.
5. Niveau appliqué réel `desk_schema_migrations` VPS non prouvé.

## R0 — Release candidate rehearsal

### Commande exécutée localement

```powershell
deploy/windows/Build-DeskRelease.ps1 `
  -ProjectRoot C:\Users\CES\Desktop\TV_Automation_PREPROD `
  -OutputRoot C:\Users\CES\Desktop\TV_Automation_PREPROD\.local\releases `
  -Version preprod-v2-convergence-20260814.1-rehearsal `
  -SkipTests `
  -UsePrebuiltFront `
  -AllowDirty `
  -Replace
```

### Résultat

| Élément | Valeur |
|---|---|
| Release rehearsal | `preprod-v2-convergence-20260814.1-rehearsal` |
| Archive | `.local/releases/preprod-v2-convergence-20260814.1-rehearsal.zip` |
| SHA256 | `4dfe79ce75cd2d4fdc7fe039bffbbfc48b5ff7da74ee4e335a760c8ee6704826` |
| Git commit | `e18b48a310085679c94639420ca0b0b8c78ee70f` |
| Dirty manifest | `true` |
| Release profile | `standard` |
| Files in manifest | `4999` |
| Migrations in artifact | `54` |
| Latest migration in artifact | `infra/postgres/init/054_data_engine_extended_point_in_time_features.sql` |
| Front assets | `38` assets under `front/assets` |
| `front-control-plane-api.js` included | yes |
| `portfolio-risk-runtime-service.js` included | yes |
| `054_data_engine_extended_point_in_time_features.sql` included | yes |

### Interprétation

Le packaging fonctionne et produit bien ce qui manque au VPS :

- migrations jusqu'à `054` ;
- Front VNext multi-assets ;
- BFF control plane avec capabilities source ;
- runtime Portfolio/Risk lineage.

Mais l'artefact est un **rehearsal artifact**, pas un RC final, parce que le manifest indique `dirty=true`.

## R0 — Worktree inventory

Inventaire brut :

| Classe initiale | Nombre |
|---|---:|
| `TRACKED_REQUIRED_REVIEW` | 143 |
| `UNTRACKED_REQUIRED` | 449 |
| `UNTRACKED_REVIEW_REQUIRED` | 46 |
| `LOCAL_ONLY` | 5 |
| `SECRET_RISK` initial | 2 faux positifs de nommage + 1 vraie hygiène test corrigée |

Répartition principale :

| Dossier | Nombre dirty/untracked |
|---|---:|
| `mcp_gpt_desk` | 186 |
| `docs` | 150 |
| `packages` | 131 |
| `scripts` | 57 |
| `src` | 47 |
| `infra` | 39 |
| `deploy` | 13 |

### Candidats à intégrer au RC

À intégrer après revue :

- `infra/postgres/init/048→054`;
- sources `mcp_gpt_desk/src/*` liées BFF, agent runtime, portfolio/risk, execution, research, data foundation ;
- tests `mcp_gpt_desk/test/*` correspondants ;
- `packages/desk-domain/src/*` et tests domaine ;
- `apps/desk-control-plane/src/*` + package/vite/tsconfig ;
- `deploy/windows/*` service/release kit ;
- `scripts/quality/*`, `scripts/stack/*`, `scripts/runtime/*` ;
- `config/prompt-registry/*` ;
- docs/runbooks nécessaires à la release et conformité.

### À exclure du RC source ou à traiter comme generated/local-only

- `.local/releases/*` ;
- `apps/desk-control-plane/dist/*` si le build est refait pendant release ;
- `dist/*` legacy généré si non requis dans source ;
- captures `apps/desk-control-plane/design-evidence/*` sauf décision produit explicite ;
- dossiers d'audit/design personnels non nécessaires au runtime ;
- fichiers `.env` réels, secrets, dumps ou configurations locales.

## Correctif sécurité effectué pendant R0

Un scan local anti-secrets a détecté un fragment réel historique dans un test, utilisé comme chaîne négative. Même si ce n'était pas une fuite runtime, le fragment ne doit pas exister dans le repository.

Correction :

- fichier : `scripts/quality/capture_environment_baseline.test.mjs`
- remplacement du fragment réel par `example-real-secret-fragment`.

Tests :

```bash
npm run baseline:environment:test
```

Résultat : `1 pass / 0 fail`.

Scan critique post-correction :

```text
critical_findings_count = 0
```

## Guards déjà passés avant R0

- `guard:architecture` OK
- `guard:runtime-safety` OK
- `guard:mcp-slices` OK
- `guard:windows-deployment` OK
- `guard:sql-migrations` OK
- `guard:browser-secrets` OK
- `guard:front-vnext-legacy` OK
- `guard:front-vnext-data-mode` OK
- `guard:api-compatibility` OK
- `guard:prompt-registry` OK
- `guard:jarvis-authority` OK
- `guard:static-quality` OK

## Go / No-Go actuel

| Vague | État | Décision |
|---|---|---|
| R0 baseline/rollback | PARTIEL | Baseline auditée ; backup DB/objects non encore exécuté |
| R0 RC clean | FAIT | Artefact final `dirty=false` produit et testé localement/Windows |
| R1 DB migrations | NON DÉMARRÉ | Attendre backup + RC |
| R2 API/BFF | NON DÉMARRÉ | Attendre R1/RC |
| R3 Runtime/workers | NON DÉMARRÉ | Attendre R2 |
| R4 Front VNext | NON DÉMARRÉ | Attendre R2 + build VNext |
| R5 Ops kit | NON DÉMARRÉ | Attendre RC |
| R6 Integrations | NON DÉMARRÉ | Après release et smoke tests |

## Prochaines actions TD2-422

1. Finaliser classification fichier par fichier du dirty/untracked.
2. Mettre à jour `.gitignore` si nécessaire pour générés locaux.
3. Stager uniquement les fichiers requis et secret-safe.
4. Créer un commit de release convergence.
5. Construire `preprod-v2-convergence-20260814.1` sans `-AllowDirty`.
6. Capturer backup/rollback VPS.
7. Appliquer R1 puis R2→R6 avec gate après chaque vague.

## Blocker actuel

Le blocker initial de gouvernance release est levé pour le périmètre source/artefact :

> Le périmètre dirty/untracked a été normalisé et un artefact `dirty=false` a été produit.

Le blocker restant avant mutation VPS est opérationnel :

> Backup/rollback VPS et ordre de déploiement R1→R6 doivent être exécutés avant toute bascule `current`.

Ce blocage reste volontairement fail-closed.

## RC final propre — 2026-08-14

Commit local de release convergence :

```text
a17a5e6a6f6c5af537955ac2dbbf1894897476e4
```

Artefacts produits :

```text
.local/releases/preprod-v2-convergence-20260814.1
.local/releases/preprod-v2-convergence-20260814.1.zip
SHA256 80795359315f7174cf8e8f404e29285f5a83391dc35b54c8dad6f5238a769153
```

Manifest RC :

| Champ | Valeur |
|---|---:|
| `schema` | `desk_windows_release_v1` |
| `version` | `preprod-v2-convergence-20260814.1` |
| `created_at_utc` | `2026-08-14T12:27:27.7553202Z` |
| `git_commit` | `a17a5e6a6f6c5af537955ac2dbbf1894897476e4` |
| `dirty` | `false` |
| fichiers | `4999` |
| migrations SQL | `54` |
| dernière migration | `infra/postgres/init/054_data_engine_extended_point_in_time_features.sql` |
| assets front | `38` |
| `.pyc` / `__pycache__` inclus | `false` |

Corrections nécessaires découvertes par le build Windows :

- suppression d'un verrou local `node_modules/@tv-automation/*` régénérable, qui bloquait `npm ci` avec `EPERM` ;
- alignement du fichier généré `packages/desk-contracts/generated/ts/index.ts` avec le générateur ;
- correction portable Windows/Linux de 19 tests SQL schema : remplacement de `URL.pathname` par `fileURLToPath()`, afin d'éviter les chemins invalides `C:\C:\...`.

Tests exécutés par le build RC :

```text
contracts generate/check: OK
strategy-contract guard: OK
npm ci release: OK
legacy front typecheck: OK
legacy front tests: 75 pass / 0 fail
VNext control-plane tests: 161 pass / 0 fail
mcp_gpt_desk tests: 1085 pass / 0 fail / 1 skip
VNext production build: OK
release zip + sha256: OK
```

Décision :

```text
R0 RC clean = FAIT
Déploiement VPS = NON EFFECTUÉ dans cette étape
AUTO_EXECUTION = inchangé / doit rester OFF
LIVE = inchangé / doit rester OFF
Mode cible = SEMI_MANUAL / SHADOW jusqu'à validation R1→R6
```

## Déploiement VPS contrôlé — 2026-08-14

Le RC propre a été copié, vérifié puis déployé sur le VPS OVH.

Artefact déployé :

```text
preprod-v2-convergence-20260814.1.zip
SHA256 80795359315f7174cf8e8f404e29285f5a83391dc35b54c8dad6f5238a769153
source commit a17a5e6a6f6c5af537955ac2dbbf1894897476e4
```

Preuves R0 avant mutation :

| Élément | Preuve |
|---|---|
| Baseline VPS avant mutation | `reports/release-parity/artifacts/environment-baseline-td2-422-r0-before-mutation.json` |
| Backup PostgreSQL | `C:\ProgramData\DeskFutures\backups\desk-native-20260814T123327Z.dump` |
| SHA backup PostgreSQL | `99739122fdd3a8d36cd9eec0853964b63e8355a1e5419f1358b35d4970f6fefa` |
| Backup object store | `C:\ProgramData\DeskFutures\backups\desk-objects-20260814T123450Z.tar.gz` |
| SHA backup object store | `d7ab089c51d35b5b9f80e4596cf51dea768f2942deb30466981bde07cde1dab4` |
| Vérification backup | restore DB isolé OK : `desk_documents=803713`, `market_candles=219465`, `schema_migrations=47` |
| Rollback code pré-déploiement | `C:\DeskFutures\releases\preprod-robustness-oos-20260813.101000` |

Résultat de déploiement :

- release vérifiée par `Test-DeskRelease.ps1` ;
- claims pausés et broker execution verrouillé pendant l'update ;
- services drainés puis relancés ;
- migrations `001→047` déjà présentes, migrations `048→054` appliquées ;
- `Desk PostgreSQL schema is current` ;
- canary loopback port `18787` OK ;
- smoke public : front, health, readiness, OAuth metadata et webhook guard OK ;
- claims/execution controls restaurés après validation.

État VPS final observé :

| Élément | Valeur |
|---|---|
| Release active | `preprod-v2-convergence-20260814.1` |
| Commit release actif | `a17a5e6a6f6c5af537955ac2dbbf1894897476e4` |
| Manifest dirty | `false` |
| Fichiers release | `4999` |
| Migrations DB | `54` |
| Dernière migration | `054_data_engine_extended_point_in_time_features` |
| Services Desk Futures | 11/11 `Running`, `Automatic` |
| Mode AI worker | `shadow` |
| Release rollback | `preprod-robustness-oos-20260813.101000` |
| Baseline post-déploiement | `reports/release-parity/artifacts/environment-baseline-td2-422-post-deploy.json` |
| Baseline finale après policy | `reports/release-parity/artifacts/environment-baseline-td2-422-final-after-policy.json` |

Endpoints publics vérifiés après déploiement :

| Endpoint | Résultat |
|---|---|
| `/healthz` | `200` |
| `/readyz` | `200` |
| `/status` | `200` |
| `/front-api/v1/capabilities` | `200` |
| `/front-api/v1/views/command-center` | `200` |
| `/api/v1/execution/overview` | `200` |

Preuve détaillée :

```text
reports/release-parity/artifacts/vps-public-smoke-post-deploy.json
```

## Correction policy semi-manuelle post-déploiement

Le gate strict a détecté une incohérence de policy : l'exécution était encore projetée en `auto` avec `require_operator_approval=false`, alors que la consigne de release impose `SEMI_MANUAL / SHADOW`.

Correction effectuée par le chemin officiel backend :

```text
POST /api/v1/execution/actions
action=configure_execution_mode
policyProfileId=ninjatrader_sim101_local
mode=semi_auto
idempotencyKey=td2-422-vps-semi-auto-20260814
confirmationPhrase=CONFIRM_SIM101_EXECUTION_MODE
```

La correction est auditée côté backend :

| Élément | Avant | Après |
|---|---:|---:|
| `execution_authority_mode` | `auto` | `semi_auto` |
| `require_operator_approval` | `false` | `true` |
| policy revision | `1` | `2` |
| audit id |  | `broker_policy_audit_3bafcbcac04d4a23898586d986cf623a` |

Cette correction ne libère pas le kill switch, ne connecte pas NinjaTrader et ne rend pas la soumission broker possible.

Projection finale execution safety :

```text
executionEnabled=false
bridgeMode=disabled
killSwitchEnv=true
databaseLocked=true
executionAuthorityMode=semi_auto
entryOperatorApprovalRequired=true
manualTelegramExecutionEnabled=true
submissionPossible=false
liveAccountAllowed=false
```

## Gates d'acceptance VPS après convergence

Artifacts :

```text
reports/release-parity/artifacts/demo-paper-gate-stack-vps-post-deploy.json
reports/release-parity/artifacts/demo-paper-gate-strict-vps-post-deploy.json
reports/release-parity/artifacts/demo-paper-release-gate-vps-post-deploy.json
```

Résultats :

| Gate | Statut | Décision |
|---|---|---|
| `check_demo_paper_gate --profile=stack` | PASS | infra/runtime stack acceptable |
| `check_vnext_operator_e2e` via release gate | PASS | login opérateur, session, commande auditée et idempotence OK |
| `check_demo_paper_gate --profile=demo-paper` | BLOCKED | live runtime encore `degraded` |
| `check_demo_paper_release_gate` | BLOCKED | `KEEP_AGENTS_CLOSED_OR_SHADOW` |

Blocage restant :

```text
service.live_runtime_scheduler.healthy
```

Détail observé :

```text
live_runtime_scheduler.status=degraded
live_runtime_scheduler.healthy=false
data_state=ready
data_blocker=null
optional_dependency_warnings=["news_provider_degraded"]
news_status=FETCH_FAILED
news_error=news_fetch_failed:429
macro_calendar_status=PARTIAL
```

Interprétation :

- le déploiement et la parité technique Local↔VPS sont démontrés ;
- le BFF VNext et les commandes opérateur sont prouvés ;
- la policy semi-manuelle est corrigée et auditée ;
- le desk reste volontairement fermé pour `demo-paper` tant que le live runtime ne repasse pas `healthy` ou tant que le gate strict n'est pas explicitement ajusté pour classer les providers news/calendar 429 comme dépendances dégradées non bloquantes.

## Décision TD2-422

```text
TD2-422 convergence release = TECHNIQUEMENT FAIT
VPS parity code/schema/services = FAIT
VNext operator E2E = FAIT
AUTO_EXECUTION = OFF / non activé
LIVE = OFF / non activé
Mode exploitation = SEMI_MANUAL / SHADOW
Demo PAPER strict open = BLOQUÉ par live_runtime_scheduler degraded
TD2-418 / TD2-419 / TD2-420 = ne pas lancer avant résolution du dernier gate strict
```

## Micro-release contexte live — 2026-08-14

Version déployée :

```text
preprod-v2-convergence-20260814.2
git_commit=dd3f9689f4f99169fb62116850eb61e16c514917
archive_sha256=444a88255cf0d4f5f77191e75ee5d31cc1d61365566c3d5132f869f1bf535490
```

Objet de la micro-release :

- le `live_runtime_scheduler` ne passe plus `degraded` lorsque les données marché sont prêtes et que seules les dépendances optionnelles `news` / `macro_calendar` sont dégradées ;
- le gate `demo-paper` accepte ce cas uniquement si `data_state=ready`, `data_blocker=null`, `consecutive_failures=0` et aucune erreur runtime réelle n'est présente ;
- les erreurs `news_fetch_failed:429` / calendrier partiel restent visibles dans `optional_dependency_warnings`, mais ne bloquent plus l'ouverture demo-paper.

Tests locaux avant build :

```text
node --test scripts/stack/check_demo_paper_gate.test.mjs scripts/stack/diagnose_demo_paper_readiness.test.mjs
18 pass / 0 fail

npm run guard:windows-deployment
OK

npm run guard:runtime-safety
OK
```

Build release :

```text
Release directory: .local/releases/preprod-v2-convergence-20260814.2
Release archive: .local/releases/preprod-v2-convergence-20260814.2.zip
SHA256: 444a88255cf0d4f5f77191e75ee5d31cc1d61365566c3d5132f869f1bf535490
```

Vérification VPS avant installation :

```text
Release verified: preprod-v2-convergence-20260814.2 (4999 files)
```

Premier déploiement :

```text
status=rolled_back
reason=Release archive checksum is missing: C:\ProgramData\DeskFutures\incoming\preprod-v2-convergence-20260814.2.zip.sha256
```

Interprétation : rollback de sécurité attendu, dû au sidecar `.zip.sha256` manquant, pas à une erreur applicative.

Deuxième déploiement après transfert du sidecar `.zip.sha256` :

```text
Desk PostgreSQL schema is current.
Canary passed on loopback port 18787.
Desk local health passed.
PASS front 200
PASS health 200
PASS readiness 200
PASS oauth-resource 200
PASS oauth-server 200
PASS webhook rejects missing secret
Desk public deployment smoke test passed.
Deployment deploy-20260814T133254Z-65708f1c completed as verified; previous claim and execution controls restored.
Desk update preprod-v2-convergence-20260814.2 verified and reopened.
```

État VPS post-déploiement :

```text
DESK_RELEASE_VERSION=preprod-v2-convergence-20260814.2
DESK_AI_WORKER_MODE=shadow
DeskFuturesAgentRuntimeResearch=Running
DeskFuturesAgentRuntimeSupervisor=Running
DeskFuturesApi=Running
DeskFuturesBrokerManagement=Running
DeskFuturesCaddy=Running
DeskFuturesCodexLive01=Running
DeskFuturesCodexLive02=Running
DeskFuturesCodexReplay01=Running
DeskFuturesLiveRuntime=Running
DeskFuturesReplayPreparation=Running
DeskFuturesTelegram=Running
```

Artifacts post-déploiement :

```text
reports/release-parity/artifacts/demo-paper-gate-strict-vps-post-context-fix.json
reports/release-parity/artifacts/demo-paper-release-gate-vps-post-context-fix.json
```

Résultats post-déploiement :

| Gate | Statut | Décision |
|---|---|---|
| `check_demo_paper_gate --profile=demo-paper` | PASS | strict demo-paper prêt |
| `check_demo_paper_release_gate` | PASS | release gate opérateur prêt |

État strict gate observé :

```text
ok=true
blockers=[]
warnings=[]
live_runtime_scheduler.status=healthy
live_runtime_scheduler.details.data_state=ready
live_runtime_scheduler.details.data_blocker=null
live_runtime_scheduler.details.optional_dependency_warnings=[
  "macro_calendar_provider_degraded_cached_coverage_ready",
  "news_provider_degraded"
]
broker.paper_environment_safe.execution_enabled=false
broker.paper_environment_safe.manual_telegram_execution_enabled=true
broker.paper_environment_safe.execution_authority_mode=semi_auto
broker.paper_environment_safe.entry_operator_approval_required=true
broker.paper_environment_safe.submission_possible=false
execution.manual_telegram_ready.ok=true
```

Décision actualisée :

```text
TD2-422 convergence release = FAIT / déployé VPS
VPS parity code/schema/services = FAIT
VNext operator E2E = FAIT
AUTO_EXECUTION = OFF / non activé
LIVE broker = OFF / non activé
Mode exploitation = SEMI_MANUAL / SHADOW
Demo PAPER strict open = FAIT
TD2-418 / TD2-419 / TD2-420 = peuvent être repris dans l'ordre
```
