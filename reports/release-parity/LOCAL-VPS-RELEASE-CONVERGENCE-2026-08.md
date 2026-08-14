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
| R0 RC clean | NON FAIT | Rehearsal OK, RC final bloqué par dirty/untracked à normaliser |
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

Le blocker n'est pas technique runtime ; il est de gouvernance release :

> Impossible de déployer proprement tant que le périmètre dirty/untracked n'est pas normalisé et qu'un artefact `dirty=false` n'est pas produit.

Ce blocage est volontairement fail-closed.
