# Prop Firm Account Risk V1

TD2-707 ajoute une couche de contraintes compte pour les prop firms et le multi-compte.

## Objectif

Le Global Risk Engine doit pouvoir bloquer ou réduire une action si elle viole :

- trailing drawdown ;
- réserve minimale de buffer ;
- limite journalière ;
- limite de contrats par compte ;
- séparation stricte multi-compte.

## Moteur

`evaluatePropFirmAccountRiskV1` consomme :

- `accounts[]` / `prop_firm_accounts[]` ;
- `target_positions[]`, `order_intents[]` ou `allocations[]`.

Il retourne :

- `account_evaluations[]` ;
- `multi_account_routes[]` ;
- `evaluation_hash`.

## Drawdown

Modes supportés :

- `STATIC` : `initial_balance - trailing_drawdown_amount` ;
- `TRAILING_EOD` ;
- `TRAILING_INTRADAY`.

Pour les modes trailing :

```text
drawdown_floor = high_watermark_equity - trailing_drawdown_amount
```

Par défaut, le plancher peut être capé à `initial_balance`, ce qui modélise les règles fréquentes des évaluations prop firms.

## Décision

- `PASS` : le risque projeté respecte le buffer et les limites.
- `REDUCE` : une taille réduite reste possible.
- `BLOCK` : aucun risque approuvable ou limite dure violée.
- `CONFIG_MISSING` : aucune contrainte compte exploitable.

## Multi-compte

Les routes sont calculées par :

```text
account_id + instrument
```

Deux comptes sur le même instrument ne peuvent donc pas s’écraser mutuellement.

## Sortie front TD2-705

Le cockpit Portfolio Risk affichera :

- buffer drawdown restant ;
- risque projeté ;
- risque approuvé ;
- compte bloqué/réduit/passant ;
- routes multi-compte.
