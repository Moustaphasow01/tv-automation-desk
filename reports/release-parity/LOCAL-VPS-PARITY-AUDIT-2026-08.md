# TD2-421 — Audit complet de parité Local ↔ VPS

Date de capture : 2026-08-14
Mode : read-only VPS strict
Politique conservée : `AUTO_EXECUTION=OFF`, `LIVE=OFF`, `SEMI_MANUAL/SHADOW`
VPS : `vps-6d6969db.vps.ovh.net` / `145.239.73.250`

## Verdict

TD2-421 produit une matrice exploitable pour lancer TD2-422, mais la parité Local↔VPS n'est pas démontrée.

Le VPS tourne correctement sur une release traçable, mais cette release n'embarque pas tout le niveau fonctionnel local actuel :

- même commit Git déclaré : `e18b48a310085679c94639420ca0b0b8c78ee70f` ;
- release VPS actuelle : `preprod-robustness-oos-20260813.101000` ;
- release VPS packagée avec `dirty=true` ;
- local actuel : même SHA, mais worktree encore `dirty` avec `143` fichiers suivis modifiés et `502` non suivis ;
- migrations PostgreSQL locales : `054_data_engine_extended_point_in_time_features.sql` ;
- migrations packagées sur le VPS : seulement jusqu'à `047_manual_and_theoretical_execution.sql` ;
- Front VNext local existe sous `apps/desk-control-plane`, mais le VPS sert un front packagé différent sous `C:\DeskFutures\current\front` ;
- endpoint BFF `/front-api/v1/views/command-center` OK sur VPS ;
- endpoint BFF `/front-api/v1/capabilities` attendu par le front local, mais répond `404` sur VPS ;
- workers VPS actifs, mais en mode SHADOW/STANDBY ou semi-manuel ; aucune activation AUTO/LIVE constatée.

Conclusion : TD2-422 peut commencer, mais uniquement par une normalisation de release candidate + R0/R1. Un déploiement direct depuis le worktree dirty serait non conforme.

## Preuves collectées

### Local release state

| Élément | Valeur |
|---|---|
| Répertoire | `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD` |
| Branche | `codex/preprod-v4-local-parity-cleanup` |
| HEAD | `e18b48a310085679c94639420ca0b0b8c78ee70f` |
| Commit message | `docs: require complete architecture convergence` |
| Tags sur HEAD | aucun tag retourné |
| Dirty tracked | `143` |
| Untracked | `502` |
| Total dirty entries baseline | `645` |
| Node local | `v20.20.2` |
| npm local | `10.8.2` |
| Docker local | `28.5.1` |
| Docker Compose local | `v2.40.3-desktop.1` |
| Migrations locales | `54` |
| Dernière migration locale | `054_data_engine_extended_point_in_time_features.sql` |
| Tables détectées statiquement | `124` |
| Index détectés statiquement | `230` |
| Enums détectés statiquement | `79` |
| PostgreSQL runtime local | `not_configured` dans la baseline read-only |

Top dirty/untracked local :

| Dossier | Nombre |
|---|---:|
| `mcp_gpt_desk` | 186 |
| `docs` | 150 |
| `packages` | 131 |
| `scripts` | 57 |
| `src` | 47 |
| `infra` | 39 |
| `deploy` | 13 |

### VPS release state

| Élément | Valeur |
|---|---|
| Hostname Windows | `WIN-7DCAP4LELPI` |
| OS | Microsoft Windows Server 2025 Standard |
| OS version/build | `10.0.26100` / `26100` |
| Node VPS | `v24.18.0` |
| npm VPS | `11.16.0` |
| Git VPS | `2.55.0.windows.3` |
| Docker VPS | non détecté dans baseline |
| PostgreSQL service | `postgresql-x64-16`, Running, Automatic |
| PostgreSQL listener | `127.0.0.1:5432` |
| HTTPS gateway | `DeskFuturesCaddy`, Running, ports `80/443` |
| Release courante | `C:\DeskFutures\releases\preprod-robustness-oos-20260813.101000` |
| Release précédente | `C:\DeskFutures\releases\preprod-robustness-oos-20260813.092501` |
| Release manifest schema | `desk_windows_release_v1` |
| Release manifest SHA256 lu | `894770782b36f4b8ef85b1438bdb598501dda1c5c2c215ce44fc36a704931496` |
| Release manifest Git commit | `e18b48a310085679c94639420ca0b0b8c78ee70f` |
| Release manifest dirty | `true` |
| Fichiers dans manifest | `4940` |
| Migrations packagées | `47` |
| Dernière migration packagée | `047_manual_and_theoretical_execution.sql` |

Services Windows `DeskFutures*` observés en Running/Automatic :

- `DeskFuturesApi`
- `DeskFuturesLiveRuntime`
- `DeskFuturesReplayPreparation`
- `DeskFuturesBrokerManagement`
- `DeskFuturesTelegram`
- `DeskFuturesAgentRuntimeSupervisor`
- `DeskFuturesAgentRuntimeResearch`
- `DeskFuturesCodexLive01`
- `DeskFuturesCodexLive02`
- `DeskFuturesCodexReplay01`
- `DeskFuturesCaddy`

Endpoints VPS observés :

| Endpoint | Statut | Note |
|---|---:|---|
| `/healthz` | HTTP 200 | `release_version=preprod-robustness-oos-20260813.101000`, `ok=true` |
| `/status` | HTTP 200 | `mode=postgres`, data readiness `ready`, DB `desk` |
| `/readyz` | HTTP 200 | idem status/readiness |
| `/front-api/v1/views/command-center` | HTTP 200 | BFF réel, permissions read-only visibles |
| `/front-api/v1/capabilities` | HTTP 404 | drift contractuel avec le front local |

État runtime notable côté `/status` :

- Agent runtime supervisor live : `healthy`, lane `live`, mode `shadow`, `SHADOW_NO_CLAIM`.
- Agent runtime supervisor research : `healthy`, mode `active`, `NO_WORK`.
- Codex workers live/replay : `healthy`, `SHADOW_STANDBY`.
- Telegram : `healthy`, worker enabled, admin/trading configurés.
- Broker management : `healthy`, `manual_telegram_execution_enabled=true`, `submission_possible=false`, `addon_connected=false`, `command_enabled=false`, `kill_switch_released=false`.
- Live runtime scheduler : `degraded`, cause observée sur dépendances externes news/macro `429`, moteur cadence `60s`, GPT cadence `900s`.

## Matrice de parité

| Component | Local | VPS | Classification | Risk | Required Action | Release Wave |
|---|---|---|---|---|---|---|
| Git commit | `e18b48a...` | `e18b48a...` dans manifest | MATCH | LOW | Conserver comme base historique | R0 |
| Release artifact | pas encore figé pour état local actuel | `preprod-robustness-oos-20260813.101000`, `dirty=true` | LOCAL_AHEAD | HIGH | Créer RC reproductible, sans worktree arbitrairement dirty | R0 |
| Worktree local | `143` tracked modifiés + `502` untracked | package VPS déjà dirty mais non équivalent | LOCAL_AHEAD | HIGH | Classer `TRACKED/UNTRACKED_REQUIRED/GENERATED/LOCAL_ONLY/SECRET_RISK` | R0 |
| Node/npm runtime | Node `20.20.2`, npm `10.8.2` | Node `24.18.0`, npm `11.16.0` | CONFIG_DRIFT | MEDIUM | Valider compatibilité ou aligner runtime de release | R0/R5 |
| Docker | Docker/Compose disponibles localement | Docker non détecté sur VPS | EXPECTED_ENVIRONMENT_DIFFERENCE | LOW | VPS Windows services natifs, documenter comme choix d'exploitation | R0 |
| PostgreSQL static migrations | `54`, latest `054` | package release `47`, latest `047` | LOCAL_AHEAD | HIGH | Packager/appliquer migrations `048→054` via procédure versionnée | R1 |
| PostgreSQL applied level | local runtime non configuré | VPS applied level non observable sans URL DB read-only | VERSION_UNKNOWN | HIGH | Ajouter/faire tourner une preuve read-only du niveau `desk_schema_migrations` | R1 |
| PostgreSQL service | n/a local baseline | `postgresql-x64-16` Running | VPS_AHEAD | LOW | Écart d'environnement attendu | R0 |
| API health | code local présent | `/healthz` OK release `preprod-robustness-oos-20260813.101000` | MATCH partiel | LOW | Rejouer après RC | R2 |
| `/status` / `/readyz` | code local présent | HTTP 200, `mode=postgres`, readiness ready | MATCH partiel | LOW | Rejouer après R1/R2 | R2 |
| BFF `/front-api/v1/views/command-center` | code local + tests | HTTP 200, permissions read-only | MATCH partiel | MEDIUM | Rejouer contrat complet après RC | R2 |
| BFF `/front-api/v1/capabilities` | route localement définie | HTTP 404 | LOCAL_AHEAD ou CONFIG_DRIFT | HIGH | Déployer route/correct proxy/package ; test obligatoire car front local l'appelle | R2 |
| BFF allowedActions/permissions | présents dans view envelopes et tests locaux | permissions visibles dans `command-center` | MATCH partiel | MEDIUM | Contract test complet sur VPS | R2 |
| SSE `/front-api/v1/events` | code local présent | non certifié dans cette passe | VERSION_UNKNOWN | MEDIUM | Smoke SSE cursor/resume après R2 | R2 |
| Front legacy | local `dist/` présent | VPS `front/index.html` + 2 assets | CONFIG_DRIFT | MEDIUM | Conserver comme rollback jusqu'à cutover | R4 |
| Front VNext | local `apps/desk-control-plane/dist` multi-assets | pas de marker `apps/desk-control-plane` dans package VPS | MISSING_ON_VPS | HIGH | Déployer VNext compatible en parallèle/feature flag | R4 |
| VNext isolation guards | OK local | non prouvé VPS | LOCAL_AHEAD | MEDIUM | Rejouer `front-vnext-*` après déploiement | R4 |
| Windows service kit | scripts/templates présents localement | services installés et Running | MATCH partiel | MEDIUM | Vérifier definitions exactes après RC | R5 |
| Runtime workers | code/scripts locaux | services workers Running | MATCH partiel | MEDIUM | Comparer versions/heartbeats après R3 | R3 |
| Live runtime | local moteur cadence 60s attendu | service Running mais `degraded` news/macro 429 | CONFIG_DRIFT / EXTERNAL_MANUAL | MEDIUM | Ne pas bloquer trading core si optionnel ; traiter providers news/macro | R3/R6 |
| Agent live/replay | local runtime/policies | VPS `SHADOW_STANDBY`, `SHADOW_NO_CLAIM` | MATCH | LOW | Conserver SHADOW jusqu'aux validations | R3 |
| Research runtime | local programme research | VPS research supervisor `NO_WORK` | MATCH partiel | MEDIUM | Rejouer vertical slice après convergence | R3 |
| Telegram | local service/scripts | VPS Telegram healthy, commands enabled | MATCH partiel | MEDIUM | Tester notification non sensible après R6 | R6 |
| Broker management | local semi-manual/human gate | VPS semi-manual, submission impossible, no addon connection | MATCH / EXTERNAL_MANUAL | LOW | Conforme à `AUTO_EXECUTION=OFF`; test opérateur requis | R6 |
| NinjaTrader/AddOn | local adapters | VPS addon not connected | EXTERNAL_MANUAL | LOW | Maintenir semi-manual ; ne pas activer provider direct | R6 |
| TradingView durable | local scripts/config | VPS data readiness ready, durable feeds count 4 | MATCH partiel | MEDIUM | Tester webhook/freshness post-release | R6 |
| News/macro | local code présent | VPS 429 sur news/macro provider | EXTERNAL_MANUAL | MEDIUM | Ajouter fallback/limite ou accepter degradation non bloquante | R6 |
| Release rollback | scripts `Rollback-Desk.ps1` + previous release | `previous-release.txt` vers release précédente | MATCH partiel | MEDIUM | Avant mutation, capturer backup DB + tester rollback procedure sans rollback destructif | R0 |
| Security browser secrets | guard local OK | non prouvé via build VPS | LOCAL_AHEAD | MEDIUM | Rejouer guard/build après VNext deploy | R4 |
| Jarvis authority | guard local OK | non prouvé sur VPS runtime | LOCAL_AHEAD | MEDIUM | Rejouer smoke read-only après R2/R4 | R2/R4 |
| Static quality | guard local OK | non applicable runtime | MATCH local | LOW | Conserver dans RC gates | R0 |

## Regroupement par classification

### MATCH / MATCH partiel

- Git commit de base identique entre local et release VPS.
- Services Windows essentiels installés et actifs.
- `/healthz`, `/status`, `/readyz` répondent.
- BFF `command-center` répond avec données réelles et permissions read-only.
- Agents et workers sont en SHADOW/STANDBY, pas en LIVE/AUTO.
- Telegram et TradingView durable montrent des signes runtime positifs.

### LOCAL_AHEAD

- Worktree local contient des modifications et fichiers non suivis non représentés de manière prouvée dans le package VPS.
- Migrations `048→054` absentes du package VPS courant.
- Front VNext `apps/desk-control-plane` absent du package VPS observé.
- Plusieurs guards/contrats locaux ne sont pas encore prouvés sur VPS.
- `/front-api/v1/capabilities` existe côté code local mais pas côté endpoint VPS.

### VPS_AHEAD

- VPS dispose de services Windows natifs et d'une DB runtime active, normal pour l'environnement serveur.
- Pas de drift fonctionnel critique identifié comme `VPS_AHEAD` pur.

### MISSING_ON_VPS

- Front VNext packagé/déployé en tant que codebase séparé.
- Migrations packagées `048→054`.
- Preuve VPS du contrat capabilities global.

### CONFIG_DRIFT

- Node/npm local vs VPS : `20.20.2/10.8.2` contre `24.18.0/11.16.0`.
- Runtime live degraded par news/macro `429`.
- Front servi sur VPS ressemble à un build packagé legacy/compact différent du VNext local.

### VERSION_UNKNOWN / NON PROUVÉ

- Niveau réellement appliqué de `desk_schema_migrations` dans la DB VPS.
- Contrat SSE cursor/resume en runtime VPS.
- Hash exact d'équivalence source local actuel ↔ package VPS à cause du packaging dirty et de l'arborescence transformée.
- État précis des scheduled tasks hors services Windows.

### EXPECTED_ENVIRONMENT_DIFFERENCE

- Hostname, IP, certificat, chemins Windows.
- PostgreSQL natif VPS vs Docker/local.
- Docker absent du VPS car déploiement Windows services natifs.
- Secrets uniquement sous références serveur ; valeurs non inspectées.

### EXTERNAL_MANUAL

- NinjaTrader/AddOn/Sim101 non connecté.
- News/macro provider en 429.
- Toute activation opérateur step-up/PIN.
- Toute validation paper/semi-manual nécessitant action humaine.

## High-risk drifts

1. **Migrations locales 048→054 absentes du package VPS**
   Impact : les objets Portfolio/Risk/OrderIntent lineage, provider lifecycle, AI Context Gate, research promotion, data-engine PIT peuvent manquer côté VPS si non appliqués.

2. **Worktree local non normalisé**
   Impact : déployer tel quel empêcherait de savoir ce qui a été réellement livré.

3. **Front VNext non déployé comme codebase autonome**
   Impact : les validations front VNext/Jarvis/operator cockpit ne peuvent pas être fermées en VPS.

4. **BFF capabilities 404 sur VPS**
   Impact : le front local attend `/front-api/v1/capabilities`; risque de commandes/capabilities non chargées.

5. **DB applied migration level non prouvé**
   Impact : impossible de déclarer parité DB sans lecture `desk_schema_migrations`.

6. **Runtime live degraded sur news/macro 429**
   Impact : pas forcément bloquant pour semi-manual/shadow, mais doit être classé et surveillé.

## Release candidate local proposé

Un RC doit être créé pendant TD2-422, pas pendant TD2-421.

Nom proposé :

`preprod-v2-convergence-20260814.1`

Préconditions RC :

1. inventorier chaque fichier dirty/untracked ;
2. classer `TRACKED`, `UNTRACKED_REQUIRED`, `GENERATED`, `LOCAL_ONLY`, `IGNORED`, `SECRET_RISK` ;
3. intégrer tous les sources/tests/migrations/runbooks nécessaires ;
4. exclure secrets, dumps, caches, pièces personnelles ;
5. produire un manifest `desk_windows_release_v1` avec `dirty=false` si possible, ou un dirty manifest justifié fichier par fichier ;
6. exécuter les guards de release.

## Guards locaux exécutés pendant TD2-421

Tous les guards suivants sont passés :

- `npm run guard:architecture`
- `npm run guard:runtime-safety`
- `npm run guard:mcp-slices`
- `npm run guard:windows-deployment`
- `npm run guard:sql-migrations`
- `npm run guard:browser-secrets`
- `npm run guard:front-vnext-legacy`
- `npm run guard:front-vnext-data-mode`
- `npm run guard:api-compatibility`
- `npm run guard:prompt-registry`
- `npm run guard:jarvis-authority`
- `npm run guard:static-quality`

Résultats notables :

- architecture guard : OK, 391 fichiers.
- runtime safety : OK.
- MCP slices : OK, 117 outils assignés.
- SQL migrations : OK, 54 migrations, 124 tables.
- browser secrets : OK, VNext.
- API compatibility : OK, 106 opérations catalogue, fingerprint `b939c84547cacb1b403fc30a7e2275318e4e08eca7cb6cdf0bedb611e94017a3`.
- prompt registry : OK.
- jarvis authority : OK.
- static quality : OK via baseline.

## Proposed release waves

### R0 — Baseline VPS + rollback

- Reprendre une baseline juste avant mutation.
- Capturer release actuelle `preprod-robustness-oos-20260813.101000`.
- Capturer rollback target `preprod-robustness-oos-20260813.092501`.
- Capturer services Windows et ports.
- Capturer un backup DB/object store avec scripts existants.
- Ne pas continuer si rollback DB/code n'est pas documenté.

### R1 — PostgreSQL / schema

- Packager migrations `048→054`.
- Appliquer via `deploy/windows/database/Invoke-DeskSchema.ps1`.
- Lire `desk_schema_migrations` en read-only après application.
- Smoke DB via `Test-DeskDatabase.ps1`.

### R2 — Backend API / BFF

- Déployer API depuis RC.
- Vérifier `/healthz`, `/status`, `/readyz`.
- Vérifier `/front-api/v1/views/*`.
- Corriger/valider `/front-api/v1/capabilities`.
- Vérifier `/front-api/v1/commands` en fail-closed sans session opérateur.
- Vérifier SSE `/front-api/v1/events`.

### R3 — Runtime / workers

- Déployer services runtime depuis RC.
- Conserver SHADOW / semi-manual.
- Vérifier heartbeats, leases, queues, no direct broker execution.
- Vérifier Portfolio → Global Risk → Human Gate → Execution Gateway.

### R4 — Front VNext

- Déployer `apps/desk-control-plane` en parallèle du legacy.
- Conserver legacy comme rollback.
- Vérifier BFF réel, no mock runtime, no broker direct, no secrets browser.
- Rejouer smoke UI opérateur.

### R5 — Ops / deployment kit

- Aligner PowerShell, service templates, doctors, gates, runbooks.
- Vérifier service restart policy et logs.
- Vérifier runbook rollback.

### R6 — Integrations externes

- Tester TradingView durable sans secret.
- Tester Telegram notification non sensible.
- Tester operator step-up/PIN sans exposer la valeur.
- Garder NinjaTrader/AddOn en `EXTERNAL_MANUAL` tant que non certifié.

## Rollback requirements

Avant toute mutation TD2-422 :

1. backup DB via script versionné ;
2. backup object store si applicable ;
3. conserver `previous-release.txt` ;
4. valider présence de `Rollback-Desk.ps1`;
5. documenter que les migrations DB sont forward-only ;
6. définir décision rollback vs forward-fix après chaque vague ;
7. ne jamais activer `AUTO_EXECUTION` ou `LIVE` comme effet de bord.

## État TD2-421

Critères satisfaits :

- branch/SHA/build local identifiés ;
- release VPS identifiée ;
- dirty/untracked local inventorié ;
- migrations locales et packagées VPS comparées ;
- API/BFF endpoints principaux sondés ;
- Front VNext vs front VPS comparés au niveau artefact ;
- Windows services/workers comparés ;
- intégrations TradingView/Telegram/Ninja classées sans secret ;
- drift classé avec actions/waves ;
- aucune mutation VPS effectuée.

Critères avec preuve partielle ou inconnue assumée :

- PostgreSQL applied migration level VPS : `VERSION_UNKNOWN`, nécessite lecture read-only `desk_schema_migrations`.
- SSE cursor/resume VPS : `VERSION_UNKNOWN`, à certifier en R2.
- scheduled tasks détaillées : `VERSION_UNKNOWN`, à compléter en R0/R5.

TD2-421 peut passer en revue avec ce rapport. TD2-422 peut commencer par R0 + préparation RC, mais ne doit pas déployer tant que le RC n'est pas figé.
