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
