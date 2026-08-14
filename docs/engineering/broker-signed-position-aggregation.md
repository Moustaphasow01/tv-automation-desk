# Broker signed position aggregation

Ticket source : `TD2-011`.

## Problème corrigé

La réconciliation broker comparait les positions par instrument uniquement. Une map de type `instrument -> position` pouvait donc écraser silencieusement :

- plusieurs trades ouverts sur le même contrat ;
- un long et un short partiels sur le même compte ;
- le même contrat présent sur deux comptes différents.

## Règle cible

La comparaison broker est maintenant faite par clé canonique :

```text
account_id + instrument
```

Les quantités sont agrégées en signé :

- `LONG` / `BUY` : quantité positive ;
- `SHORT` / `SELL` : quantité négative ;
- `FLAT` ou quantité nulle : zéro.

Le desk et le snapshot broker sont donc tous les deux réduits à une position nette par compte et instrument avant comparaison.

## Effets attendus

- Deux comptes qui portent `MNQ 09-26` ne peuvent plus s'écraser.
- Deux lignes partielles sur le même compte sont nettées avant comparaison.
- Une inversion de sens à quantité équivalente produit `POSITION_SIDE_MISMATCH`.
- Une divergence de taille produit `POSITION_QUANTITY_MISMATCH`.
- Une position broker inconnue du desk produit `POSITION_UNKNOWN_TO_DESK`.

## Couverture testée

Commande ciblée :

```bash
node --test mcp_gpt_desk/test/broker_execution_service.test.js
```

Cas couverts :

- side mismatch existant conservé ;
- agrégation signée long/short par compte et instrument ;
- même instrument sur deux comptes sans écrasement ;
- état flat / quantité zéro ;
- réconciliation, AddOn claim, sizing et policy broker inchangés.
