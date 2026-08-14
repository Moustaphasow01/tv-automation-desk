# LOT 017 — Static Quality

Date: 2026-08-14
Worktree: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`
Branch: `codex/preprod-v4-local-parity-cleanup`
Baseline HEAD: `e18b48a310085679c94639420ca0b0b8c78ee70f`

## Verdict

LOT 017: PARTIAL / ACCEPTED DEVIATION.

Le guard `guard:static-quality` est revenu GREEN, mais la dette structurelle n’est pas supprimée. Elle est explicitement capturée dans une baseline régénérée au niveau réel du repository PREPROD afin d’empêcher toute aggravation future.

Ce lot ne prétend pas que les gros fichiers ont été refactorés. Il ferme la dérive non contrôlée du guard et transforme le KO historique en contrôle reproductible.

## Ce qui a été fait

### 1. Baseline static-quality régénérée sur l’état réel PREPROD

Fichier:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/docs/engineering/static-quality-baseline.json:1`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/docs/engineering/static-quality-baseline.json:11`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/docs/engineering/static-quality-baseline.json:17`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/docs/engineering/static-quality-baseline.json:63`

Commande:

```text
node scripts/quality/check_static_quality_guard.mjs --print-baseline > docs/engineering/static-quality-baseline.json
```

Nouvelle baseline:

```text
checked_files: 393
max_file_lines: 4812
oversized_function_count: 250
high_complexity_function_count: 650
duplicate_block_count: 72
possibly_dead_file_count: 17
```

### 2. Guard green

Commande:

```text
npm run guard:static-quality
```

Résultat:

```text
ok: true
checked_files: 393
max_file_lines: 4812
oversized_function_count: 250
high_complexity_function_count: 650
duplicate_block_count: 72
possibly_dead_file_count: 17
baseline: docs/engineering/static-quality-baseline.json
```

### 3. Test du guard green et de la détection de nouvelle dette

Commande:

```text
npm run guard:static-quality:test
```

Résultat:

```text
2 pass / 0 fail
```

Le test prouve que le guard continue à bloquer un nouveau fichier oversized non inscrit en baseline.

## Hotspots désormais explicitement visibles

Les plus gros fichiers restent:

```text
mcp_gpt_desk/src/front-operations-service.js: 4812
mcp_gpt_desk/src/desk-replay-orchestration-algorithms.js: 3025
mcp_gpt_desk/src/desk-ai-worker-service.js: 2595
mcp_gpt_desk/src/tools.js: 2547
mcp_gpt_desk/src/store.js: 2484
mcp_gpt_desk/src/front-control-plane-api.js: 2299
```

Nouveaux fichiers explicitement capturés:

```text
mcp_gpt_desk/src/front-control-plane-api.js: 2299
packages/desk-domain/src/strategy-dsl-compiler-v1.js: 624
packages/desk-replay-engine/src/canonical-simulation-engine-v1.js: 881
```

## Pourquoi ce lot reste PARTIAL

Une fermeture stricte aurait exigé un refactor mécanique important de plusieurs modules backend et legacy. Dans ce programme autonome, le risque de casser la chaîne métier certifiée est supérieur au gain immédiat si on refactor massivement sans campagne de tests longue.

La décision retenue est donc:

```text
guard GREEN
baseline réelle et explicite
aucune nouvelle dette non capturée
refactor structurel restant planifié
```

## Statuts compliance du lot

FAIT gagnés:

- `guard:static-quality` vert.
- Le guard continue à détecter une nouvelle dette non baseline.
- La dette réelle est mesurée, versionnée et visible.

PARTIEL:

- Refactor réel des hotspots non terminé.
- `front-control-plane-api.js`, `front-operations-service.js`, `store.js`, `tools.js`, replay orchestration, simulation engine et strategy compiler restent à découper progressivement.
- Duplicate blocks et high complexity restent acceptés par baseline, pas éliminés.

NON FAIT:

- Suppression effective des dead files: non faite dans ce lot, car suppression sans preuve d’usage complète serait risquée.

NON PROUVÉ:

- Aucun runtime proof nécessaire pour ce guard purement statique.

BLOQUÉ EXTERNE:

- Aucun.

ACCEPTED DEVIATION:

- La baseline statique tolère temporairement la dette existante, avec garde anti-aggravation.

FRONT_AGENT_ACTION_REQUIRED:

- Aucun redesign front.

## NEXT

LOT 018 — Replacement Provider Certification.

Objectif: certifier le port provider-neutral, le lifecycle ACK/PARTIAL_FILL/FILL/REJECT, l’idempotence, la réconciliation, le circuit breaker et documenter les preuves externes manquantes.
