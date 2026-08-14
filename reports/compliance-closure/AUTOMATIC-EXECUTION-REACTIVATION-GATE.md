# Automatic Execution Reactivation Gate

Date: 2026-08-14

## Statut

AUTO execution: BLOCKED.

LIVE execution: BLOCKED.

Demo/PAPER semi-manual: conditionnel, seulement après passage du release gate.

## Chaîne obligatoire

```text
Data
→ StrategySignal
→ AI Context Gate
→ Portfolio Arbitration
→ Global Risk
→ TargetPosition
→ OrderIntent
→ Human Execution Gate
→ Execution Gateway
→ Provider
→ Broker Events
→ Reconciliation
```

Tout ordre hors de cette chaîne est un bypass bloquant.

## Conditions minimales avant réactivation AUTO/PAPER

1. `npm run --silent gate:demo-paper -- --json` doit retourner `ok=true`.
2. `npm run --silent gate:demo-paper-release -- --json` doit retourner `ok=true`.
3. Les flux MNQ/MES M1/M5 doivent être frais et durables, pas issus d'un rescue/backfill local.
4. Le runtime live scheduler doit être healthy.
5. Le mode doit être `semi_auto` tant que l'opérateur n'a pas explicitement approuvé AUTO.
6. Le Human Execution Gate doit rester obligatoire pour l'entrée semi-manuelle.
7. Le canal Telegram trading doit être actif si le mode manuel Telegram est utilisé.
8. `DESK_NINJA_ALLOW_LIVE_ACCOUNT=false` doit rester en vigueur tant que l'activation LIVE séparée n'est pas approuvée.
9. `DESK_LEGACY_POSITION_EXECUTION_ENABLED=false` doit rester en vigueur hors procédure rollback explicitement approuvée.
10. Aucun provider ACK/HTTP 200 ne doit être compté comme fill.

## Conditions supplémentaires avant LIVE

1. Approbation opérateur séparée, non expirée, `APPROVE_LIVE`.
2. Strategy Instance précise.
3. Compte et provider précis.
4. Limite de risque validée.
5. Reconciliation provider prouvée.
6. Rollback PAPER/SHADOW disponible.
7. Observation PAPER suffisante.

## État runtime observé le 2026-08-14

`gate:demo-paper --profile=stack`:

```text
ok=true
warnings=data.live_fresh.stack_profile
data_state=stale
core_age_seconds≈157156
effective_market_date=2026-08-12
```

`gate:demo-paper --profile=demo-paper`:

```text
ok=false
blockers:
- service.live_runtime_scheduler.healthy
- data.live_fresh
- data.source_durable
- live_runtime.no_data_blocker
- broker.paper_environment_safe
- execution.manual_telegram_ready
```

`gate:demo-paper-release`:

```text
ok=false
final_decision=KEEP_AGENTS_CLOSED_OR_SHADOW
additional blocker:
- vnext-operator.operator.pin_configured
```

## Action humaine requise

- Réactiver les alertes TradingView durables MNQ/MES M1/M5.
- Vérifier que les sources reçues ne sont plus classées `rescue`.
- Remettre le runtime en `semi_auto` pour le scénario opérateur.
- Activer la validation opérateur à l'entrée.
- Activer/configurer Telegram trading.
- Fournir le PIN opérateur uniquement au moment du release gate.
- Ne jamais activer LIVE par défaut.

AUTO EXECUTION SHALL NOT BE ENABLED WITHOUT EXPLICIT HUMAN AUTHORIZATION.
