# Adaptateur de compatibilité legacy — spécification V1

## Statut

- Version de l’adaptateur : `1.0.0`
- Portée : lecture et adaptation en mémoire uniquement
- Écriture ou réécriture de données : aucune
- Branchement au store, aux services LIVE ou Replay : aucun
- Modification des contrats et du codegen : aucune

Le module concerné est
`mcp_gpt_desk/src/legacy-compatibility-adapter.js`.

## Objectif

Les historiques du Desk contiennent plusieurs générations de vocabulaire :

- états setup en minuscules, états métier V2/V3 et verbes GPT ;
- états de thèse, événements de transformation et états de position mélangés ;
- décisions analytiques et événements d’orchestration dans les champs
  `action` ou `decision` ;
- directions libres ou composées ;
- score de déclenchement exprimé tantôt en ratio, tantôt en pourcentage ;
- conditions issues de formats anglais, français et structurés partiellement.

L’adaptateur fournit une frontière explicite entre ces données historiques et
le modèle courant. Il ne modifie jamais son entrée. Il retourne :

```json
{
  "ok": true,
  "canonical": {},
  "audit": {
    "adapter": "legacy_compatibility_adapter",
    "adapter_version": "1.0.0",
    "entity_type": "setup",
    "source_version": "legacy_unversioned",
    "target_model_version": "deterministic_setup_storage_v1",
    "aliases": [],
    "conflicts": [],
    "warnings": [],
    "changed": true,
    "requires_review": false,
    "counts": {
      "aliases": 0,
      "conflicts": 0,
      "warnings": 0
    }
  }
}
```

`ok=false` signifie qu’au moins un conflit de sévérité `review` existe. Cela
ne signifie pas que l’objet source est perdu : ses champs sont conservés dans
`canonical`, mais il ne doit pas être utilisé pour une exécution automatique.

## Types couverts

| Type | Modèle cible de l’adaptateur |
|---|---|
| `setup` | `deterministic_setup_storage_v1` |
| `condition` | `deterministic_execution_condition_v3` |
| `thesis` | `active_thesis_v1` |
| `position` | `position_continuity_v3` |
| `monitor_decision` | `monitor_decision_compat_v1` |
| `unknown` | source conservée, revue obligatoire |

Ces marqueurs décrivent les projections de compatibilité. Ils ne remplacent
pas les versions officielles des contrats.

## Règles de sécurité

### Setup

- `TRIGGER_GO` devient `ARMED_CONDITIONAL`.
- `TRIGGERED` ou `OPEN` n’est conservé que si une preuve backend existe :
  `status_authority=backend`, `trigger_source=backend_immutable_interval`,
  `execution_status=POSITION_CREATED` ou `linked_position_id`.
- Sans cette preuve, le setup est ramené à `PRE_ARMED` et reçoit le conflit
  `UNPROVEN_TRIGGERED_STATUS`.
- Un setup armé sans instrument, direction, entrée, stop, cible ou conditions
  est ramené à `PRE_ARMED`.
- Une valeur de statut inconnue devient `WAIT_NO_SETUP`, jamais un état
  exécutable.

### Conditions

- Un `HARD_BLOCKER` est toujours normalisé avec :
  - `role=VETO` ;
  - `effect=BLOCK_IF_TRUE` ;
  - `required_for_trigger=false` ;
  - `memory_policy=INVALIDATE_TERMINAL`.
- L’adaptateur ne peut pas deviner la polarité économique d’un prédicat.
  Par exemple, il ne transforme pas automatiquement un `CLOSE_BELOW` en
  `CLOSE_ABOVE`. Une incohérence de ce type doit être traitée par l’audit
  stratégique ou contractuel.
- `NON_VALIDEE`, `NOT_VALIDATED`, `NOT_CONFIRMED` et les états partiels restent
  `PENDING`. Ils ne sont jamais convertis en échec dur sans preuve explicite.

### Position

Le moteur courant utilise des états majuscules. Les principaux alias sont :

| Legacy | Canonique |
|---|---|
| `active`, `OPEN` | `OPEN` |
| `protected` | `PROTECTED` |
| `partial_taken`, `partial` | `PARTIAL_TAKEN` |
| `closed` | `CLOSED` |
| `cancelled`, `canceled` | `CANCELLED` |
| `STOP_LOSS_HIT` | `CLOSED` + `exit_reason=STOP_LOSS_HIT` |
| `TAKE_PROFIT_1_HIT` | `CLOSED` + motif correspondant |

`PENDING` et `RUNNING` sont historiquement ambigus : l’adaptateur les projette
sur `OPEN`, mais impose une revue avec
`WORKFLOW_STATUS_USED_AS_POSITION_STATUS`.

### Thèse

- `ACTIVE_WAIT` est interprété en fonction du payload :
  - preuves conditionnelles présentes : `THESIS_CONDITIONAL` ;
  - sinon : `WAIT_MONITORED`.
- `SCENARIO_TRANSFORMED` et `SETUP_CANDIDATE` sont des événements historiques,
  pas des états de thèse. Ils sont conservés sous
  `legacy_transition_event`, avec une projection prudente vers
  `THESIS_CONDITIONAL`.
- Les directions composées comme `NEUTRAL_BULLISH_WAIT` sont conservées dans
  `legacy_bias_direction` et ramenées à `neutral` pour le champ direction.

### Monitor

Les espaces de noms sont séparés :

- décision analytique : `WAIT_MORE`, `ARM_SETUP`, `REPLAN_FULL`,
  `EXIT_POSITION`, etc. ;
- événement d’orchestration : `WAITING_GPT_MONITOR`, `ADVANCE_5M`,
  `SIMULATE_INTERVAL`, etc. ;
- instruction libre opérateur : texte naturel.

Un événement d’orchestration trouvé dans `monitor_decision.action` n’est pas
converti en `WAIT_MORE`. Il produit `action=null`,
`legacy_orchestration_action=<valeur>` et
`ACTION_NAMESPACE_MISMATCH`.

Un texte libre produit `action=null`, est conservé sous
`operator_instruction` et nécessite une revue.

## Aliases structurants

### Statut setup

- `CANDIDATE` → `SETUP_CANDIDATE`
- `PREARMED`, `PRE_ARM`, `PRE-ARMED` → `PRE_ARMED`
- `ACTIVE`, `READY`, `EXECUTABLE`, `ARMED`, `ARM_SETUP` →
  `ARMED_CONDITIONAL`
- `CANCELED` → `CANCELLED`
- `INVALID` → `INVALIDATED`

### Direction

- `buy`, `bull`, `bullish`, `up`, `haussier` → `long`
- `sell`, `bear`, `bearish`, `down`, `baissier` → `short`
- directions neutres composées → `neutral`

### Score

- `[0, 1]` : conservé ;
- `]1, 100]` : divisé par 100 ;
- hors plage ou non numérique : `0.65` avec conflit.

## Conflits

Un conflit signale qu’une décision automatique serait dangereuse. Exemples :

- plusieurs colonnes de statut donnent des états canoniques différents ;
- `TRIGGERED` ne possède aucune preuve backend ;
- action d’orchestration stockée comme décision analytique ;
- action libre non reconnue ;
- symbole de trade inconnu ;
- score hors plage ;
- plusieurs valeurs de `result_r` se contredisent.

La valeur source reste toujours présente. La résolution indiquée dans l’audit
est une projection de lecture, pas une réécriture de la base.

## Stratégie de déploiement future

Ce lot ne réalise aucune de ces étapes. La trajectoire recommandée est :

1. **Shadow read**
   - appeler l’adaptateur après la lecture de données legacy ;
   - ne pas utiliser sa sortie pour exécuter ;
   - mesurer aliases, conflits et valeurs inconnues.
2. **Certification du corpus**
   - compléter le corpus avec les familles de runs historiques ;
   - fixer un taux de conflits attendu par version de source ;
   - examiner manuellement tous les conflits liés à l’exécution.
3. **Dual read**
   - garder la source brute comme autorité historique ;
   - utiliser la projection canonique uniquement pour le front et les audits ;
   - afficher clairement `adapted_from_legacy`.
4. **Activation contrôlée**
   - autoriser les objets sans conflit de revue pour les calculs non
     destructifs ;
   - maintenir `backend_can_trigger=false` pour toute adaptation ambiguë.
5. **Migration éventuelle**
   - produire de nouveaux enregistrements versionnés au lieu d’écraser les
     anciens ;
   - conserver `source_record_id`, `source_hash`, version d’adaptateur et audit ;
   - ne jamais recalculer ou rejouer une journée implicitement.

## Versionnage

- Les règles d’une version publiée sont immuables.
- Un nouvel alias ou une nouvelle résolution sémantique exige une nouvelle
  version de l’adaptateur.
- Le numéro de version doit être attaché à toute projection matérialisée dans
  le futur.
- Les tests du corpus doivent être exécutés pour chaque version.
- Les contrats et leur code généré restent une source séparée et ne doivent pas
  être modifiés par l’adaptateur.

## Observabilité recommandée lors d’un futur branchement

Compteurs :

- `legacy_adapter_records_total{entity_type,source_version}`
- `legacy_adapter_aliases_total{code_or_rule,entity_type}`
- `legacy_adapter_conflicts_total{code,entity_type}`
- `legacy_adapter_review_required_total{entity_type}`
- `legacy_adapter_unknown_values_total{field,entity_type}`

Échantillons audités :

- identifiant de l’objet source ;
- type détecté ;
- version source et cible ;
- codes de conflit ;
- aucune donnée de secret ou de credential.

Seuils de sécurité :

- tout conflit d’exécution bloque l’activation ;
- toute valeur inconnue reste visible ;
- aucune diminution artificielle du nombre de conflits pour atteindre un KPI.

## Tests

Le corpus se trouve dans
`mcp_gpt_desk/test/fixtures/legacy-compatibility-corpus.js`.

Les tests se trouvent dans
`mcp_gpt_desk/test/legacy_compatibility_adapter.test.js`.

Ils couvrent notamment :

- les valeurs rencontrées dans les replays de juin ;
- le score `70` ;
- les HARD_BLOCKER historiques ;
- les déclenchements GPT non prouvés ;
- les statuts de position en minuscules ;
- `ACTIVE_WAIT` et `SCENARIO_TRANSFORMED` ;
- les actions d’orchestration mélangées aux décisions ;
- les actions libres en français ;
- la non-mutation et le déterminisme de l’adaptateur.
