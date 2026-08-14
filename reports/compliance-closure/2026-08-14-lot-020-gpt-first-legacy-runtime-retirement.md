# Lot 020 — GPT-first / Legacy Runtime Retirement

Date: 2026-08-14

## Verdict

Statut final: PARTIEL.

Le repository prouve que les chemins legacy/GPT-first ne sont plus autorisés à créer ou envoyer un ordre broker par défaut. Le retrait complet GPT-first/legacy reste cependant bloqué tant que les slices MCP legacy et workflows de compatibilité ne sont pas remplacés, observés, puis explicitement approuvés pour retrait.

## Ce qui a été corrigé dans ce lot

`gpt_first_retirement_plan_v1` bloque maintenant explicitement les familles de bypass directes :

- LLM direct order path ;
- MCP direct order path ;
- frontend direct order path ;
- script direct order path.

Preuve code:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/runtime-cutover-governance-v1.js:65`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/runtime-cutover-governance-v1.js:71`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/runtime-cutover-governance-v1.js:72`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/runtime-cutover-governance-v1.js:73`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/runtime-cutover-governance-v1.js:74`
- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/runtime-cutover-governance-v1.js:90`

Preuve test:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/test/runtime-cutover-governance-v1.test.js:87`

Documentation:

- `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/docs/engineering/runtime-cutover-governance-v1.md:61`

## Preuves de non-bypass d'ordre

### 1. Legacy position execution fail-closed

Le chemin historique `desk_positions -> trade_decision -> order_intent` est désactivé par défaut.

- Barrière: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/broker-order-intent-authority.js:1`
- Erreur explicite `LEGACY_POSITION_EXECUTION_DISABLED`: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/broker-order-intent-authority.js:4`
- Test fail-closed materialization: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/test/broker_execution_service.test.js:39`
- Test fail-closed evaluateDecision: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/test/broker_execution_service.test.js:50`

### 2. Broker submission exige une preuve Portfolio/Risk

- Barrière `assertBrokerOrderIntentAuthority`: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/broker-order-intent-authority.js:10`
- Schéma requis `portfolio_order_intent_v1`: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/broker-order-intent-authority.js:37`
- Source obligatoire `TARGET_POSITION`: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/broker-order-intent-authority.js:40`
- Risk decisions obligatoires: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/broker-order-intent-authority.js:41`
- Candidate allocations obligatoires: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/broker-order-intent-authority.js:43`
- Direct LLM order interdit: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/broker-order-intent-authority.js:45`
- Netting engine obligatoire: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/src/broker-order-intent-authority.js:46`

### 3. Config release fail-closed

- VPS template:
  - `DESK_BROKER_EXECUTION_ENABLED=false`: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/deploy/templates/desk.vps.env.example:111`
  - `DESK_NINJA_KILL_SWITCH=true`: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/deploy/templates/desk.vps.env.example:120`
  - `DESK_NINJA_ALLOW_LIVE_ACCOUNT=false`: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/deploy/templates/desk.vps.env.example:123`
  - `DESK_LEGACY_POSITION_EXECUTION_ENABLED=false`: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/deploy/templates/desk.vps.env.example:124`
- Script Sim101:
  - `DESK_LEGACY_POSITION_EXECUTION_ENABLED=false`: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/deploy/windows/Enable-DeskSim101Environment.ps1:32`

## Tests exécutés

```text
node --test packages/desk-domain/test/runtime-cutover-governance-v1.test.js
8 pass / 0 fail
```

```text
npm run guard:mcp-slices
ok=true, actual_tools=117, assigned_tools=117, slice_count=10
```

```text
npm run guard:architecture
ok=true, checked_files=391
```

```text
npm run guard:jarvis-authority
ok=true, matrixRows=123, violations=0
```

```text
node --test mcp_gpt_desk/test/broker_execution_service.test.js packages/desk-domain/test/broker-execution.test.js
57 pass / 0 fail
```

## Inventaire legacy restant

Le guard MCP slices confirme que la surface legacy n'est pas supprimée :

- `backtest.legacy`: 8 outils internes legacy ;
- `analysis.legacy-documents`: 9 outils internes legacy ;
- `desk-jobs.legacy`: 5 outils internes legacy ;
- autres slices avec compatibilité interne legacy.

Ces outils restent classés comme compatibilité/rollback et ne doivent pas être supprimés tant que leurs remplaçants ne sont pas prouvés en production contrôlée.

## Requirement matrix

| Requirement | Current status | Gap | Implementation | Tests | Runtime proof | Final status |
|---|---:|---|---|---|---|---:|
| Retirer GPT-first uniquement quand remplaçants validés | PARTIEL | Slices MCP legacy encore présentes | `planGptFirstLegacyRetirementV1` | runtime cutover test | Observation runtime externe nécessaire | PARTIEL |
| Ancien runtime incapable d'envoyer directement un ordre | FAIT | Aucun gap local prouvé | `assertBrokerOrderIntentAuthority` | broker execution tests | N/A domaine/test | FAIT |
| Front/Jarvis sans effet broker direct | FAIT | Aucun gap local prouvé | authority matrix | `guard:jarvis-authority` | N/A guard | FAIT |
| MCP surface inventoriée par ownership/slice | FAIT | Retrait physique non fait | MCP tool slices | `guard:mcp-slices` | N/A guard | FAIT |
| Rollback legacy explicitement gouverné | PARTIEL | Le flag existe encore et doit rester réservé au rollback | config fail-closed + plan de retrait | broker tests | Nécessite procédure opérateur en incident | PARTIEL |

## Blockers / travaux restants

1. Observer le nouveau runtime sur fenêtre réelle minimale.
2. Démontrer une couverture de remplacement complète des workflows legacy.
3. Mettre `active_legacy_workflow_count=0` sur vraie prod contrôlée.
4. Prouver rollback legacy.
5. Obtenir approbation opérateur `APPROVE_GPT_FIRST_RETIREMENT`.
6. Seulement ensuite retirer les slices legacy et le flag rollback.

## Résultat de lot

- FAIT gagnés: bypass LLM/MCP/front/scripts ajouté comme condition bloquante du retrait GPT-first ; non-bypass d'ordre prouvé par tests.
- PARTIEL restant: retrait physique GPT-first/MCP legacy.
- NON FAIT: aucun nouveau.
- NON PROUVÉ: observation runtime réelle.
- BLOQUÉ EXTERNE: observation prod/PAPER et décision opérateur.

## Prochain lot

LOT 021 — Legacy DB / Dead Path Cleanup.

Objectif: inventorier les tables, scripts et chemins morts, distinguer données à archiver/rétention de ce qui est encore requis, puis produire un plan de suppression non destructif et vérifiable.
