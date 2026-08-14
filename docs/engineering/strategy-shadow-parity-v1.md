# Strategy SHADOW parity v1 — TD2-602

## Objectif

TD2-602 ajoute une preuve déterministe de parité entre une sortie Simulation et une sortie SHADOW.

La preuve ne cherche pas encore à simuler un portefeuille complet. Elle vérifie une invariant plus bas niveau, indispensable avant TD2-603/TD2-604 :

> à scénario figé équivalent, Simulation et SHADOW doivent produire la même sémantique de `Signal`, ou exposer une divergence explicite.

## Ce que compare le rapport

`buildStrategyShadowParityReportV1` normalise les deux sorties puis compare :

- le type de sortie : `SIGNAL` ou `NO_OP` ;
- `strategy_instance_id` ;
- `strategy_version_id` ;
- instrument ;
- direction `LONG`/`SHORT`/`FLAT` ;
- confiance ;
- mode d’origine `SHADOW` ;
- timestamps `generated_at_utc` et `expires_at_utc` ;
- `correlation_id` ;
- payload métier du signal ;
- hashes d’évidence.

Le hash sémantique ignore volontairement `signal_id`, parce que Simulation et SHADOW peuvent émettre deux identifiants techniques différents pour la même décision métier. En revanche, `payload_hash_match` reste affiché pour signaler cette différence technique.

## Cas couverts

- signal `LONG` identique ;
- signal `FLAT` identique malgré `signal_id` différent ;
- divergence déterministe `LONG` vs `SHORT` ;
- no-op d’expiration ;
- rejet d’une preuve incomplète ou invalide.

## Non-objectifs

- Pas de broker.
- Pas de données live non figées.
- Pas de portefeuille multi-stratégies.
- Pas de promotion PAPER/LIVE.

Ces sujets restent dans TD2-603+ et P8.

## Tests de preuve

```bash
npm --prefix packages/desk-domain test -- strategy-shadow-parity-v1.test.js
```
