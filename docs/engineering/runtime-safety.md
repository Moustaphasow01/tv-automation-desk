# Runtime safety — time, idempotence and locking

> Statut : normatif pour live, replay, workers, broker et opérations.

Le ticket `TD2-ARCH-009` transforme les règles de concurrence en contrôles
automatisés. L'objectif est simple : pas de double traitement silencieux, pas de
révision écrasée, pas de lease infini, pas de nouvelle horloge implicite.

## Commandes

```bash
npm run guard:runtime-safety
npm run guard:runtime-safety:test
```

La certification globale rejoue ces deux commandes via :

```bash
npm run certify:resilience
```

## Règles bloquantes

- `packages/desk-time` doit exposer `ClockPort`, `SystemClock`, `FixedClock`,
  `toUtcIso`, `toParisIso` et `parisOffset`.
- Les tables idempotentes critiques doivent avoir une clé unique stable.
- Les outbox/queues critiques doivent porter `lease_token`,
  `lease_expires_at*` et `attempt_count`.
- Les agrégats à écriture concurrente doivent porter `revision` ou
  `expected_revision`.
- Le nombre d'usages directs de `new Date()` sans argument / `Date.now()` hors tests ne peut
  pas augmenter au-dessus de la baseline.

## Dette connue

La baseline actuelle tolère 130 usages directs legacy de l'horloge implicite
hors tests. Les conversions déterministes de timestamps déjà fournis
(`new Date(value)`) ne comptent pas comme horloge implicite, mais elles restent
à extraire progressivement vers `packages/desk-time` lorsqu'une zone
temps/cutoff/session est refactorée.
