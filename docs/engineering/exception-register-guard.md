# Exception Register Guard

Ce guard matérialise `TD2-ARCH-012` : aucune dérogation ne doit devenir implicite, permanente ou invisible.

Commandes :

```bash
npm run guard:exceptions
npm run guard:exceptions:test
```

## Règles contrôlées

- chaque ligne `EXC-TD-*` doit avoir un identifiant stable ;
- propriétaire obligatoire ;
- expiration obligatoire au format `YYYY-MM-DD` ;
- une dérogation expirée est bloquante ;
- la colonne ADR/Ticket doit référencer `TD2-*` ou un ADR ;
- la mesure compensatoire doit mentionner un guard ou `touch-and-improve` ;
- le backlog final doit conserver le gate `zero_active_exceptions` et le ticket `TD2-1105`.

Le rapport inclut aussi les budgets de `static-quality-baseline.json` afin de suivre le burn-down de dette à chaque phase.
