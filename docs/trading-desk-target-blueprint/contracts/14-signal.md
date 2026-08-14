# Contract — Signal

- **But** : sortie du Live Strategy Runtime, publiée sur le Standardized Signal Bus, immuable une fois émise.
- **Producteur** : Live Strategy Runtime (`10`).
- **Consommateurs** : Portfolio Arbitration Engine (`11`).
- **Statut** : `CIBLE REQUISE`, forme proposée.

## Champs clés

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | uuid | oui | Identifiant stable |
| `strategy_instance_id` | uuid (FK) | oui | Strategy Instance émettrice |
| `instrument` | string | oui | Instrument concerné |
| `direction` | enum | oui | `LONG`\|`SHORT`\|`FLAT` |
| `confidence` | number | non | Score de confiance |
| `execution_mode_origin` | enum | oui | `SHADOW`\|`PAPER`\|`LIVE` — mode de l'instance émettrice |
| `generated_at` / `expires_at` | timestamp | oui | Fenêtre de validité |
| `correlation_id` | string | oui | Traçabilité |

## Transport outbox PostgreSQL — TD2-601

Le `Signal` est transporté par la table canonique `strategy_signal_outbox`.

Principes obligatoires :

- `strategy_signal_outbox.dedupe_key` est unique et rend l’émission rejouable sans doublon aval.
- `strategy_signal_outbox.payload_hash` scelle le payload event-envelope publié.
- `pg_notify('desk_strategy_signal_ready', ...)` accélère le réveil des consommateurs.
- Le polling `status='pending' AND expires_at_utc > now()` reste le fallback obligatoire si la notification PostgreSQL est perdue.
- Le consommateur marque l’item `consumed` après traitement. Il ne modifie pas le signal d’origine.

La notification n’est donc pas la vérité métier : elle est seulement un accélérateur. La vérité durable est l’outbox PostgreSQL.

## Projection front transitoire — TD2-604

Le front opérateur lit le Signal Bus via `GET /api/v1/strategy-v2/signals`.

Règles :

- le front peut afficher les signaux en attente et leur fenêtre de validité ;
- le front peut marquer un item comme consommé via `POST /api/v1/strategy-v2/signals/{signalOutboxId}/actions` avec `action="consume"` ;
- le front ne publie jamais de nouveau signal ;
- un signal expiré ou consommé ne doit pas être réinventé par l’interface.

## Exemple JSON

```json
{
  "id": "a7b8c9d0-e1f2-4a3b-4c5d-6e7f80914263",
  "strategy_instance_id": "d4e5f6a7-8b9c-4d1e-9f2a-3b4c5d6e7f80",
  "instrument": "ES",
  "direction": "LONG",
  "confidence": 0.72,
  "execution_mode_origin": "PAPER",
  "generated_at": "2026-08-07T14:32:15Z",
  "expires_at": "2026-08-07T14:47:15Z",
  "correlation_id": "corr-20260807-1432-es"
}
```
