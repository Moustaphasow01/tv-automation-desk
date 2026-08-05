# Autopilot V4 LIVE — readiness PREPROD locale

## Résultat

Le chemin LIVE reprend le métier Replay V4 sans utiliser l'horloge Replay :

1. TradingView écrit les bougies closes dans PostgreSQL.
2. Le builder scelle un pack roulant au cutoff courant.
3. Le curseur LIVE réclame un Master ou un Monitor M15.
4. GPT lit le bundle et écrit l'analyse via MCP.
5. Le backend matérialise les setups conditionnels avec les mêmes règles que Replay V4.
6. Le moteur paper évalue les bougies closes entre deux Monitors, ouvre une position simulée et suit TP/stop.
7. Le frontend lit le setup et la position canoniques dans PostgreSQL.

Le runtime PREPROD est volontairement en `shadow` :

- `DESK_LIVE_EXECUTION_MODE=shadow`
- `DESK_LIVE_PAPER_EXECUTION_ENABLED=true`
- `broker_execution=false`
- aucun ordre broker n'est envoyé.

## Cadence

| Élément | Cadence |
| --- | --- |
| Master Asia | 00:15 Paris |
| Monitors Asia | M15, de 00:30 à 14:45 |
| Master NY | 15:30 Paris |
| Monitors NY | M15, de 15:45 à 21:45 inclus |
| Tick setup/position paper | M5 |

La cadence M15 est identique à Replay V4. Les bougies M5 servent uniquement à simuler précisément le fill, le stop et le TP entre deux décisions GPT ; elles ne transforment pas le desk en stratégie de scalping.

## Fraîcheur SQL

Le LIVE ne peut pas réutiliser un checkpoint périmé.

| Dataset | Règle LIVE |
| --- | --- |
| `MNQ_M5`, `MES_M5` | dernière bougie close âgée de 5 minutes maximum |
| `NQ_M15`, `ES_M15` | dernière bougie close âgée de 15 minutes maximum |
| `NQ_H1`, `ES_H1` | dataset obligatoire ; `last_known` autorisé comme contexte |
| `MNQ_H4`, `MES_H4`, `NQ_H4`, `ES_H4` | dataset obligatoire ; `last_known` autorisé comme contexte |
| Taux, DXY, VIX, CL/MCL, GC, indices et mega caps | contexte optionnel, fraîcheur exposée explicitement |

Un trigger requis absent ou périmé renvoie :

```json
{
  "status": "DATA_NOT_READY",
  "reason": "live_source_not_fresh",
  "next_action": "wait_for_fresh_closed_candles"
}
```

Dans ce cas, aucun lease n'est pris, aucun bundle GPT n'est servi et aucun fallback Replay n'est autorisé.

## Continuité setup et position

Le Monitor LIVE peut enregistrer des setups `SETUP_CANDIDATE`, `PRE_ARMED` ou `ARMED_CONDITIONAL`. Le backend réutilise les règles Replay V4 :

- conditions classées `HARD_BLOCKER`, `MANDATORY`, `PRIMARY`, `SECONDARY`, `OPTIONAL` ou `ADVISORY` ;
- toutes les conditions mandatory doivent passer ;
- les conditions secondaires/optionnelles alimentent un score ;
- `trigger_policy.min_score` a toujours une valeur définie ;
- tolérance par défaut de 0,25 point, sauf seuil explicitement strict ;
- géométrie obligatoire : instrument, direction, entrée/zone, stop et TP1 ;
- aucune condition prose non évaluable n'est inventée par le backend.

Le tick paper M5 :

- ne lit que les bougies closes ;
- n'utilise jamais une bougie antérieure au fill pour clôturer une position ;
- simule le fill d'un ordre conditionnel ;
- applique stop ou TP de manière conservatrice ;
- écrit la position dans `desk_positions` ;
- écrit les transitions dans `desk_decision_journal` ;
- reste idempotent par identifiants stables.

## Commandes locales

Vérifier et construire uniquement le pack LIVE, sans lease et sans analyse GPT :

```bash
npm --prefix mcp_gpt_desk run live:shadow-readiness -- \
  --trading-date 2026-07-20 \
  --session asia_open \
  --checkpoint-paris 2026-07-20T12:00:00+02:00
```

Évaluer les setups/positions paper sur le dernier intervalle M5 :

```bash
npm --prefix mcp_gpt_desk run live:paper-tick -- \
  --trading-date 2026-07-20 \
  --session asia_open \
  --timestamp-paris 2026-07-20T12:05:00+02:00
```

Le worker GPT réclame ensuite le travail avec `claim_next_live` ou la façade `claim_next_desk_work`, puis utilise `heartbeat_live`, `complete_live` et `fail_live` avec le lease fourni.

## État réel au 20 juillet 2026

Le test de readiness sur PostgreSQL retourne correctement `DATA_NOT_READY` :

- cutoff testé : `2026-07-20T12:00:00+02:00` ;
- dernier `MNQ_M5` : `2026-07-17T20:55:00.000Z` ;
- âge : 3 665 minutes ;
- maximum autorisé : 5 minutes ;
- aucun lease curseur ;
- aucune analyse GPT ;
- aucune position broker.

Le code LIVE est prêt pour le shadow local. Le démarrage opérationnel reste conditionné à la réception de nouvelles bougies TradingView dans PostgreSQL et à la disponibilité du worker GPT MCP.

## Checklist de démarrage

- [ ] Webhook TradingView joignable par les alertes.
- [ ] Flux frais pour MNQ M5, MES M5, NQ M15 et ES M15.
- [ ] H1/H4 présents pour les quatre familles obligatoires.
- [ ] `live:shadow-readiness` retourne `READY`.
- [ ] Worker GPT MCP connecté avec le profil `autopilot_v4`.
- [ ] Claims M15 activés.
- [ ] Tick paper M5 activé.
- [ ] Frontend affiche explicitement `Position paper`.
- [ ] Une journée complète shadow est auditée avant toute discussion d'exécution broker.
