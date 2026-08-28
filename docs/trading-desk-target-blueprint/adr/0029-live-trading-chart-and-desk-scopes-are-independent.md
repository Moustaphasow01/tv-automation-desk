# ADR-0029 — Le graphique et le dossier opérateur Live ont des scopes indépendants

- **Statut** : accepté
- **Date** : 2026-08-28

## Contexte

La vue Live utilisait auparavant l'instrument et la timeframe du graphique pour charger toute la projection. Un changement ZC → ZW pouvait donc recharger ou remplacer les signaux, le Context Gate, Portfolio, Risk, l'OrderIntent et le Human Gate. Cette dépendance visuelle rendait les données intermittentes et pouvait déplacer le dossier décisionnel pendant son inspection.

## Décision

Séparer deux scopes :

- le **Desk scope**, global et stable, contient les signaux multi-instruments et toute la lineage canonique jusqu'au Human Gate ;
- le **Chart scope**, local, contient uniquement l'instrument, la timeframe et la série de marché affichée.

Le BFF exclut les paramètres du graphique des loaders et clés de cache non-marché. Le Front conserve la dernière série valide pendant la transition et limite le chargement au panneau graphique. Un signal est sélectionné par son identifiant canonique ; il n'est jamais sélectionné implicitement par l'instrument du graphique.

## Alternatives écartées

- Une vue Live filtrée intégralement par instrument : elle masque les décisions des autres instruments.
- Un cache global `keepPreviousData` sur toute la page : il peut présenter temporairement un dossier correspondant à l'ancien scope comme s'il était courant.
- Dupliquer la logique Risk/Human Gate dans le Front : le Front n'est pas autorité métier.

## Conséquences

- changer de graphique ne modifie plus le Human Gate ;
- le flux signal reste global et filtrable ;
- les overlays n'affichent que les plans dont l'instrument correspond au graphique ;
- les sources BFF non-marché sont réutilisées entre changements de scope ;
- une projection paginée dédiée reste nécessaire pour dépasser la limite backend actuelle du catalogue de signaux.

## Rollback

Le rollback consiste à retirer la composition à deux requêtes et à restaurer la requête Live unique. Il ne requiert ni migration SQL ni changement de données, mais réintroduit le couplage documenté ci-dessus.
