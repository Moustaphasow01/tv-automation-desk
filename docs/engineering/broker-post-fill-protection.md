# Broker post-fill protection confirmation

Ticket source : `TD2-012`.

## Règle

Un fill d'entrée broker ne suffit pas à considérer une position saine.

Après fill, le desk attend une preuve positive issue du snapshot NinjaTrader AddOn :

- snapshot connecté ;
- référence de stop protecteur connue ;
- ordre stop retrouvé dans le snapshot ;
- ordre stop actif (`submitted`, `accepted`, `working`) ;
- side opposé à la position ;
- quantité protégée au moins égale à la quantité ouverte ;
- prix du stop conforme au stop canonique lorsque le prix est disponible.

## États persistés

L'état est écrit dans `trades.raw` :

- `broker_protection_state = pending` : attente normale pendant le délai de grâce ou snapshot incomplet ;
- `broker_protection_state = confirmed` : stop actif confirmé, le trade passe en `protected` ;
- `broker_protection_state = failed` : protection absente, annulée, rejetée, expirée, side/quantité/prix incohérent.

La preuve est conservée dans `broker_protection_evidence`.

## Fail-closed

Si la protection échoue après le délai de grâce, le desk :

- écrit un événement `manual_intervention` dans `trade_events` ;
- active un verrou `broker_execution_locks` au scope `account` ;
- laisse le trade lisible, mais ne le considère plus comme sain sans intervention opérateur.

Le verrou n'est pas auto-effacé après une erreur critique : l'opérateur doit décider de la reprise.

## Flux AddOn

Les références de protection reçues dans un événement AddOn sont attachées au trade même si elles arrivent dans le même événement que le fill.

Chaque snapshot AddOn déclenche ensuite :

1. règlement des sorties protectrices déjà remplies ;
2. confirmation de protection des positions restantes ;
3. réconciliation optionnelle si demandée.

## Couverture testée

Commande ciblée :

```bash
node --test mcp_gpt_desk/test/broker_execution_repository.test.js mcp_gpt_desk/test/broker_execution_service.test.js
```

Cas couverts :

- protection confirmée avec stop actif côté broker ;
- retard accepté pendant la fenêtre de grâce ;
- échec fail-closed quand le stop reste absent après la fenêtre ;
- non-régression service broker, AddOn, réconciliation, sizing et policies.
