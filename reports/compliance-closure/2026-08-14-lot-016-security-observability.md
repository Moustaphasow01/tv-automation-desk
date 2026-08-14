# LOT 016 — Security & Observability

Date: 2026-08-14
Worktree: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`
Branch: `codex/preprod-v4-local-parity-cleanup`
Baseline HEAD: `e18b48a310085679c94639420ca0b0b8c78ee70f`

## Verdict

LOT 016: COMPLETE côté repository local pour les fermetures réalisables sans environnement externe.

Le lot ne prouve pas Telegram réel, Sim101 réel, VPS runtime réel ou provider réel. Ces preuves restent des dépendances externes et ne sont pas vendues comme fermées.

## Exigences gagnées en FAIT

### 1. Scan secrets repository élargi aux fichiers non trackés

Avant ce lot, `guard:security-supply-chain` ne scannait que les fichiers trackés. Dans ce repository, beaucoup de fichiers produit/preuves sont encore non trackés ; le contrôle pouvait donc rater un secret avant release.

Implémentation:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/quality/check_security_supply_chain.mjs:30`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/quality/check_security_supply_chain.mjs:59`

Preuve:

```text
npm run guard:security-supply-chain
ok: true
scanned_files: 1695
scope: git tracked + untracked non-ignored files
secret findings: 0
```

Warnings conservés:

```text
mcp_gpt_desk/package-lock.json: 108 dependencies without integrity
mcp_gpt_desk/package-lock.json: 5 dependencies without explicit license
```

Ces warnings sont visibles et non masqués.

### 2. Aucun secret provider/broker/browser dans VNext et son bundle généré

Nouveau guard dédié au browser/VNext:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/quality/check_browser_secret_exposure.mjs:12`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/quality/check_browser_secret_exposure.mjs:29`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/quality/check_browser_secret_exposure.mjs:46`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/quality/check_browser_secret_exposure.mjs:100`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/quality/check_browser_secret_exposure.mjs:107`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/quality/check_browser_secret_exposure.mjs:121`

Le guard autorise uniquement les clés publiques Vite suivantes:

```text
VITE_DATA_MODE
VITE_FEATURE_JARVIS_WORKSPACE
VITE_FRONT_API_BASE_URL
VITE_FRONT_API_TIMEOUT_MS
VITE_OPERATOR_AUTH_BASE_URL
```

Il bloque notamment:

```text
VITE_DESK_API_KEY
DESK_MCP_API_KEY
TRADINGVIEW_WEBHOOK_SECRET
TELEGRAM_*_BOT_TOKEN
DESK_NINJA_ADDON_SHARED_SECRET
BROKER_API_KEY
PROVIDER_API_KEY
RITHMIC_PASSWORD
TRADOVATE_CLIENT_SECRET
PICKMYTRADE_API_KEY
```

Tests:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/quality/check_browser_secret_exposure.test.mjs:12`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/quality/check_browser_secret_exposure.test.mjs:18`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/quality/check_browser_secret_exposure.test.mjs:34`

Preuve build + scan:

```text
npm run front-vnext:build
✓ built in 2.75s

npm run guard:browser-secrets
ok: true
scope: vnext
scanned_files: 110
warnings: []
```

### 3. Les fixtures de tests ne contiennent plus de faux tokens haute confiance en clair

Le scan tracked + untracked a trouvé des tokens de test au format réaliste. Ils n’étaient pas des secrets réels, mais ils auraient bloqué ou pollué une release.

Correctifs:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/quality/check_browser_secret_exposure.test.mjs:60`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/quality/check_security_supply_chain.test.mjs`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/quality/check_prompt_registry.test.mjs`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/test/prompt-registry-governance-v1.test.js`

Preuve one-shot:

```text
git ls-files --cached --others --exclude-standard + high-confidence secret scan
scanned_files: 1613
findings: 0
```

### 4. Contrat SSE/front events enrichi avec traçabilité explicite

Le contrat `front_events_v1` transporte désormais les métadonnées nécessaires à l’observabilité sans transformer une donnée manquante en succès implicite.

Champs ajoutés:

```text
sequence
revision
aggregate_id
correlation_id
causation_id
occurred_at_utc
received_at_utc
account
instrument
environment
execution_mode
trace
```

Implémentation:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/front-events-contract-v1.js:6`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/front-events-contract-v1.js:10`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/front-events-contract-v1.js:45`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/front-events-contract-v1.js:70`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/front-events-contract-v1.js:109`

Tests:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/test/front_events_contract.test.js:24`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/test/front_events_contract.test.js:58`

Règle truth-first prouvée:

```text
metadata absente -> UNKNOWN / NOT_APPLICABLE
metadata absente -> jamais 0, false, filled, confirmed ou succeeded
```

### 5. Commandes VNext auditables avec correlation/causation/aggregate

Les commandes `/front-api/v1/commands` persistent maintenant la traçabilité dans le reçu, le command document, l’event et l’audit.

Implémentation:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/front-control-plane-command.js:74`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/front-control-plane-command.js:100`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/front-control-plane-command.js:177`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/front-control-plane-command.js:194`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/front-control-plane-command.js:227`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/front-control-plane-command.js:231`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/front-control-plane-command.js:239`

Tests:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/test/front_control_plane_api.test.js`

Garanties préservées:

```text
broker_execution: false
order_submission_enabled: false
LIVE commands: forbidden
unsupported commands: forbidden
anonymous/read-only: forbidden for writes
```

## Tests exécutés

```text
node --test mcp_gpt_desk/test/front_events_contract.test.js mcp_gpt_desk/test/front_control_plane_api.test.js scripts/quality/check_browser_secret_exposure.test.mjs
24 pass / 0 fail
```

```text
npm run front-vnext:build
OK
```

```text
npm run guard:browser-secrets
ok: true
scanned_files: 110
```

```text
npm run guard:security-supply-chain:test
2 pass / 0 fail
```

```text
npm run guard:security-supply-chain
ok: true
scanned_files: 1695
```

```text
node --test scripts/quality/check_prompt_registry.test.mjs packages/desk-domain/test/prompt-registry-governance-v1.test.js scripts/quality/check_browser_secret_exposure.test.mjs
9 pass / 0 fail
```

```text
npm run guard:jarvis-authority
ok: true
matrixRows: 123
violations: 0
```

```text
npm run guard:problem-details
ok: true
codes: 12
```

```text
npm run guard:mcp-slices
ok: true
actual_tools: 117
assigned_tools: 117
slice_count: 10
```

## Statuts compliance du lot

FAIT gagnés:

- Scan secrets repository étendu aux fichiers non trackés non ignorés.
- VNext source + bundle généré sans secret/provider token browser.
- Tests de guards sans tokens réalistes hardcodés dans les sources.
- SSE/front event observability envelope enrichi.
- Commandes VNext corrélables par `correlation_id`, `causation_id`, `aggregate_id`.
- Jarvis authority toujours sans broker effect.
- MCP tool slices toujours conformes.

PARTIEL:

- Traçabilité complète “WHY DID THIS POSITION EXIST?” dépend encore du branchement runtime live/research complet et de preuves PostgreSQL/runtime réelles.
- Les warnings `mcp_gpt_desk/package-lock.json` sans integrity/license restent visibles.
- Legacy frontend peut encore exister comme rollback ; l’autonomie VNext est certifiée mais le retrait legacy est Lot 020/021.

NON FAIT:

- Aucun nouveau NON FAIT introduit par ce lot.

NON PROUVÉ:

- Headers HTTP de production réels sur VPS/CDN/reverse proxy.
- Logs runtime VPS sans secret.
- Provider réel / Sim101 réel / Telegram réel.

BLOQUÉ EXTERNE:

- Vérification runtime VPS.
- Validation canal Telegram réel.
- Validation provider réel/Sim101.

ACCEPTED DEVIATION:

- Aucune nouvelle déviation.

FRONT_AGENT_ACTION_REQUIRED:

- Aucun redesign demandé dans ce lot.

## Git

Le worktree reste très large et contient de nombreux fichiers non trackés issus des lots précédents. Aucun nettoyage destructif n’a été effectué. Les fichiers Lot 016 à inclure dans une release/commit sont notamment:

```text
scripts/quality/check_browser_secret_exposure.mjs
scripts/quality/check_browser_secret_exposure.test.mjs
scripts/quality/check_security_supply_chain.mjs
mcp_gpt_desk/src/front-events-contract-v1.js
mcp_gpt_desk/test/front_events_contract.test.js
mcp_gpt_desk/src/front-control-plane-command.js
mcp_gpt_desk/test/front_control_plane_api.test.js
package.json
reports/compliance-closure/2026-08-14-lot-016-security-observability.md
```

## NEXT

LOT 017 — Static Quality.

Objectif: faire passer `guard:static-quality` au vert sans régression métier, en refactorant mécaniquement les fichiers backend oversized et en supprimant uniquement les dead files prouvés.
