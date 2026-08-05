# @tv-automation/desk-contracts

Source unique des contrats du desk TV Automation.

Ce package contient uniquement :

- des JSON Schema versionnés ;
- les enums de production, conservées telles quelles ;
- le registry actif des contrats Master/Monitor et le lifecycle des contrats entité V2 ;
- les contrats markdown versionnés et hashés ;
- les types TypeScript générés depuis les JSON Schema ;
- les schémas nécessaires au runtime MCP. Les validateurs Zod comportementaux restent hand-portés côté MCP quand le comportement ne peut pas être exprimé en JSON Schema (`transform`, `refine`, `passthrough`, defaults).

Il ne dépend pas de Firebase, OpenAI, MCP runtime, React ou du dashboard.

## Contrat anti-lookahead : `DeskDecisionAuditContract` (T04)

`schemas/entities/decision-audit.schema.json` (v1.0.0) est l'enveloppe d'audit attachée à **chaque décision** (mission section 7). Elle enregistre ce que le modèle voyait, le cutoff appliqué, et si des données futures ont fuité.

Champs requis : `decision_timestamp_paris`, `data_cutoff_paris`, `available_data_until`, `future_data_used`, `entry_sl_tp_frozen`, `datasets_used`, `macro_actuals_visible`, `macro_actuals_blocked`, `source_pack_id`. Optionnels : `simulation_id`, `mission_id`, `decision_id`, `thesis_id`, miroirs `*_utc` (forward-compat T05), `notes`.

Invariant : le champ `future_data_used` reste un booléen (une violation doit pouvoir être **enregistrée et affichée** dans le dashboard, EX-2) ; le gate DecisionAudit M7.3 rejette une décision persistable dont `future_data_used` est `true`. `entry_sl_tp_frozen` encode la règle « entry/SL/TP figés avant replay outcome ».

Exemple : `examples/decision-audit.example.json`. Tests de validation (ajv 2020-12) : `mcp_gpt_desk/test/decision_audit_contract.test.js`. Tests de gate MCP : `mcp_gpt_desk/test/decision_audit_gate.test.js`.

## Fondation V2 : registry et contrats entité

`registry.json` expose deux couches :

- `active_contracts` : la matrice runtime immuable Master `5.1.0`, Monitor `2.1.0`, Plan/Command/Catalog `1.1.0`, Policy `4.1.0` et FrontProjection `1.0.0` ;
- `legacy_contracts` : les chaînes historiques complètes et hash-lockées, conservées en lecture sans réinterprétation par le runtime courant ;
- `entity_contracts` : les contrats entité V2 définis dans le package, avec statut `active` lorsque leur schema, exemple et tests de validation sont branchés. `runtime_exposed: false` reste volontaire pour les entités : le package expose leurs schemas pour validation, pas des outils runtime d'execution.

Contrats entité M7.2 :

- `DeskDecisionAuditContract` (`schemas/entities/decision-audit.schema.json`) ;
- `DeskSimulationRun` (`schemas/entities/simulation-run.schema.json`) ;
- `DeskSimulationStep` (`schemas/entities/simulation-step.schema.json`) ;
- `DeskWorkerMission` (`schemas/entities/worker-mission.schema.json`) ;
- `DeskDashboardState` (`schemas/entities/dashboard-state.schema.json`).
- `DeskFrontProjectionContract` (`schemas/entities/desk-front-projection.schema.json`), projection de présentation versionnée et matérialisable par les écritures Master/Monitor.

## Projection du nouveau front

`DeskFrontProjectionContract v1.0.0` est optionnel dans les payloads Master et
Monitor afin de préserver la compatibilité des producteurs existants. Lorsqu'il
est fourni, le runtime valide sa forme, son identité de source, son scope, sa
séquence et sa révision avant de matérialiser l'état courant, un snapshot et un
événement. Les projections rejetées sont auditées séparément et ne remplacent
jamais le dernier état courant valide.

Les contrats entité actifs sont découvrables côté runtime package via `listActiveEntityContracts()` et `getEntityContractDefinition(...)`. Le check `node scripts/quality/check_contracts_finalization.mjs` refuse tout contrat entité resté non promu, tout schema ou exemple manquant, et tout écart entre `registry.json` et `generated/runtime-data.js`.

La fondation contracts ne lance ni simulation, ni worker, ni dashboard runtime. Elle stabilise uniquement les formes de donnees et leur cycle de vie.

## Protocole analytique progressif v1

`DeskAnalyticalResearchProgressContract v1.0.0` formalise la projection de
progrès backend du parcours analytique commun LIVE/REPLAY. Il épingle les dix
phases ordonnées, leurs six états, la couverture, les evidence receipts
backend, l'anti-lookahead, le scope du claim et l'allowlist d'outils de
contexte read-only.

- contrat : `contracts/DeskAnalyticalResearchProgressContract_v1_0_0.md` ;
- schema : `schemas/entities/analytical-research-progress-v1.schema.json` ;
- exemple : `examples/analytical-research-progress.example.json` ;
- tests : `npm --prefix packages/desk-contracts run test:analytical-progress`.

Le schema est inclus automatiquement dans `generated/runtime-data.js` et
accessible via `getEntitySchema(...)`. Il reste volontairement hors
`registry.entity_contracts` tant que le producteur worker, le validateur et le
gate de finalisation ne sont pas promus ensemble. Cette absence du registry
évite d'annoncer prématurément une surface runtime exécutable.

## Gate DecisionAudit M7.3

Les tool inputs `save_desk_decision` et `save_desk_analysis.executable_decision` exigent maintenant `decision_audit`.

Le schema entite `DecisionAudit` reste capable de representer une violation (`future_data_used: true`) pour audit/reporting. En revanche, le gate des decisions persistables impose :

- `future_data_used: false` ;
- `entry_sl_tp_frozen: true` ;
- au moins un dataset dans `datasets_used` ;
- `available_data_until <= data_cutoff_paris` ;
- aucun macro actual visible publie apres `data_cutoff_paris`.

## Génération

```bash
npm --prefix packages/desk-contracts run generate
```

Sorties :

- `generated/ts/index.ts`

## Garde-fou generated

```bash
npm --prefix packages/desk-contracts run check:generated
```

La commande régénère les types puis échoue si un diff apparaît dans `generated/`.

## Règle runtime

Les JSON Schema sont la source de vérité de la forme contractuelle.
Les validateurs Zod du MCP restent comportementaux et sont portés à l'identique pour préserver :

- les transformations de `analysisSchema` ;
- les `.refine()` cross-champs des outils ;
- les `.passthrough()` ;
- les `.default()`.
