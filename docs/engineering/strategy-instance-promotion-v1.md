# Strategy Instance promotion v1 — TD2-603

## Objectif

TD2-603 verrouille la promotion d’une `Strategy Instance` de `SHADOW` vers `PAPER`.

Le principe est volontairement strict : une bonne métrique ou une preuve de parité ne suffit jamais à promouvoir automatiquement une instance. Le passage à `PAPER` est une décision opérateur explicite.

## Règles implémentées

- `SHADOW → PAPER` exige un `operator_approval_id` fourni dans la commande de transition.
- `PAPER → SHADOW` est un rollback opérateur et exige une `reason` auditée.
- Le rollback vers `SHADOW` efface l’approval paper actif (`operator_approval_id = null`).
- `PAPER → LIVE` conserve la règle existante : approbation opérateur + triple-lock.
- `SHADOW → LIVE` reste interdit.

## Ce que TD2-603 ne fait pas

- Aucun passage automatique vers `PAPER`.
- Aucun passage automatique vers `LIVE`.
- Aucun ordre broker.
- Aucun changement de contrat broker ou NinjaTrader.

## Tests de preuve

```bash
node --test \
  packages/desk-domain/test/strategy-registry-v1.test.js \
  mcp_gpt_desk/test/strategy_kernel_service.test.js
```
