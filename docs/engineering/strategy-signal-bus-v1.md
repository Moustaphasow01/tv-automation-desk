# Strategy Signal Bus v1 — TD2-601

## Objectif

TD2-601 ajoute le premier transport durable entre le Live Strategy Runtime et les futurs moteurs d’arbitrage/risk/exécution.

Le runtime ne pousse pas un ordre broker directement. Il publie un `Signal` normalisé dans `strategy_signal_outbox`. Les consommateurs aval lisent cette outbox, décident quoi faire, puis marquent chaque signal consommé.

## Contrat d’architecture

- **Source canonique** : `strategy_signal_outbox`.
- **Notification rapide** : `pg_notify('desk_strategy_signal_ready', ...)` après insertion `pending`.
- **Résilience obligatoire** : un consommateur ne doit jamais dépendre uniquement de `LISTEN/NOTIFY`.
- **Fallback durable** : polling régulier sur `status='pending' AND expires_at_utc > now`.
- **Déduplication** : `dedupe_key` unique, dérivée du signal si elle n’est pas fournie.
- **Payload immuable logique** : le payload event-envelope est haché via `payload_hash`.

## Cycle nominal

1. Le scheduler d’instance TD2-600 détecte qu’une `Strategy Instance` est due.
2. Le Live Strategy Runtime calcule un signal déterministe en SHADOW/PAPER/LIVE.
3. `StrategySignalBusService.publishSignal()` normalise le signal.
4. Le repository insère dans `strategy_signal_outbox`.
5. PostgreSQL notifie `desk_strategy_signal_ready`.
6. Le consommateur réagit au notify ou au polling de secours.
7. Après traitement, le consommateur appelle `markConsumed()`.

## Invariants

- Un signal expiré ne doit pas être retourné par le polling fallback.
- Une même émission rejouée avec le même scope/corrélation retourne le même item d’outbox.
- Une perte de notification n’est pas bloquante : le polling récupère les signaux encore valides.
- Le bus transporte des signaux, pas des ordres broker. L’arbitrage portefeuille et le risk engine restent responsables de la suite.

## Tests de preuve

```bash
node --test \
  packages/desk-domain/test/strategy-signal-bus-v1.test.js \
  mcp_gpt_desk/test/strategy_signal_bus_service.test.js \
  mcp_gpt_desk/test/strategy_signal_bus_sql_schema.test.js
```
