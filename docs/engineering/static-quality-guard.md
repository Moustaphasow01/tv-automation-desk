# Static Quality Guard

Ce guard matérialise `TD2-ARCH-005` : taille, complexité, duplication et code potentiellement mort.

Commandes :

```bash
npm run guard:static-quality
npm run guard:static-quality:test
```

## Principe

Le dépôt contient déjà de la dette legacy mesurée. Le guard n'impose donc pas un nettoyage big-bang ; il applique une baseline anti-aggravation :

- aucun nouveau fichier non exempté au-dessus de 600 lignes ;
- aucun fichier legacy au-dessus de son budget de lignes actuel ;
- le nombre de fonctions longues ne peut pas augmenter ;
- le nombre de fonctions à complexité élevée ne peut pas augmenter ;
- le nombre de blocs dupliqués détectés ne peut pas augmenter ;
- le nombre de fichiers potentiellement morts ne peut pas augmenter.

La baseline canonique est `docs/engineering/static-quality-baseline.json`.

## Burn-down

Quand un chantier réduit réellement une dette, il doit régénérer la baseline avec :

```bash
npm run guard:static-quality -- --print-baseline
```

La nouvelle baseline ne doit jamais augmenter un budget sans justification, ticket et dérogation.

## Rebaseline TD2-ARCH-016 — 2026-08-09

La baseline a été régénérée après les vertical slices Data Foundation et la
validation P3 (`TD2-204` à `TD2-208`). Cette hausse est tracée par le ticket
`TD2-ARCH-016` / Jira `TD2-150`.

Décision : accepter une rebaseline mesurée après livraison fonctionnelle verte,
car refactorer immédiatement `store.js`, broker, OpenAPI et les projections
front dans le même batch aurait mélangé un chantier de réduction de dette
profond avec la clôture Data Foundation. La dette reste active : toute future
intervention sur ces hotspots doit réduire ou extraire le code touché dès que
c'est raisonnable.
