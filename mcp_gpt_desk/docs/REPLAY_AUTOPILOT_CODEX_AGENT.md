# Replay Autopilot Codex Agent

Ce document décrit le pont automatisé Codex ↔ GPT pour rejouer une journée sans que l'opérateur copie/colle chaque prompt.

## Objectif

Codex reste l'orchestrateur backend :

- lit `get_replay_state` ;
- déclenche les transitions backend sûres via `driveReplayAutomation` ;
- laisse le backend préparer les bundles et les work items ;
- imprime le prompt exact que la tâche GPT doit suivre ;
- ne produit aucune analyse de marché à la place de GPT.

GPT reste le worker analyste :

- claim un seul work item ;
- lit le bundle Master ou Monitor ;
- produit l'analyse ;
- sauvegarde avec `save_replay_master_analysis` ou `save_replay_monitor` ;
- complète ou fail le work item.

## Commande Codex

Dry-run, pour afficher l'état et le prompt GPT sans écrire :

```bash
npm --prefix mcp_gpt_desk run replay:autopilot-codex -- --backtest-id replay_YYYY_MM_DD --prompt-only
```

Cycle exécutant les transitions backend jusqu'au prochain work GPT :

```bash
npm --prefix mcp_gpt_desk run replay:autopilot-codex -- --backtest-id replay_YYYY_MM_DD --execute --max-transitions 6 --worker-id gpt-replay-worker-a
```

## Cadence recommandée

Le backend expose maintenant `recommended_replay_cadence` dans `get_replay_state` et dans les bundles Monitor.

- `60 min` quand il n'y a ni setup ni position.
- `30 min` quand un setup candidat/pré-armé existe ou qu'une position est protégée.
- `15 min` quand un setup conditionnel est armé ou qu'une position ouverte doit être gérée.
- `0 min` quand un replan Master est obligatoire.

L'autopilot utilise cette cadence pour `advance_replay_clock`.

## Continuité setup/position

Les bundles Monitor contiennent désormais `replay_continuity` :

- `active_setup`
- `armed_setup`
- `active_setups`
- `active_position`
- `position_status`
- `thesis_health_score`
- `backend_can_simulate_between_monitors`

GPT ne doit donc plus écrire “s'il y a déjà un setup” au conditionnel : il doit lire ce bloc et agir selon l'état backend.

## Conditions structurées attendues côté GPT

Quand GPT veut laisser le backend déclencher un setup entre deux Monitors, il doit sauvegarder un objet structuré via `setup_candidate`, `setup_transition` ou `armed_setup`.

Chaque condition doit être classée :

- `HARD_BLOCKER`
- `MANDATORY`
- `PRIMARY`
- `SECONDARY`
- `OPTIONAL`
- `ADVISORY`

Une condition backend-évaluable doit contenir au minimum :

- `instrument`
- `field` (`close`, `high`, `low`, `open`)
- `operator` (`CLOSE_ABOVE`, `CLOSE_BELOW`, `TOUCH_ABOVE`, `TOUCH_BELOW`, etc.)
- `threshold`
- `importance`

Un setup déclenchable doit aussi contenir :

- `direction`
- `entry_price`
- `stop_loss`
- `take_profit_1`
- `expires_at_paris` si le setup est temporellement limité.

## Prompt à donner aux tâches GPT programmées

Utiliser le prompt imprimé par :

```bash
npm --prefix mcp_gpt_desk run replay:autopilot-codex -- --backtest-id replay_YYYY_MM_DD --prompt-only
```

Pour couvrir un rythme de 15 minutes malgré une limite d'une exécution par heure côté GPT, créer quatre tâches GPT identiques avec des déclenchements décalés :

- tâche A : minute 00 ;
- tâche B : minute 15 ;
- tâche C : minute 30 ;
- tâche D : minute 45.

Chaque tâche doit avoir un `worker_id` distinct, par exemple :

- `gpt-replay-worker-a`
- `gpt-replay-worker-b`
- `gpt-replay-worker-c`
- `gpt-replay-worker-d`

Le lease transactionnel PostgreSQL empêche deux workers d'écrire le même work item en même temps.
