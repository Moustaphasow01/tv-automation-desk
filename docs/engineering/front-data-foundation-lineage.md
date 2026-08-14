# Front Data Foundation Lineage — TD2-205

TD2-205 ajoute l’écran transitoire `/data-foundation`.

Il sert à rendre lisibles, côté opérateur, les données réelles de la Data Foundation sans exposer les tables PostgreSQL au front.

## Données consommées

La page lit uniquement l’API BFF :

```text
GET /api/v1/data-foundation/overview
GET /api/v1/data-foundation/datasets
GET /api/v1/data-foundation/features
GET /api/v1/data-foundation/market-data-profiles
GET /api/v1/data-foundation/storage-objects
GET /api/v1/data-foundation/hot-series-windows
```

## Sections front

- Métriques globales : datasets prêts, features publiées, couverture bloquante, objets froids, fenêtres chaudes, accès direct table.
- Couverture marché : état par feed, manques, recommandation storage et volume observé.
- Datasets & lineage : cutoff, nombre de batches, source lineage, hash.
- Features point-in-time : catégorie, type de sortie, version publiée, datasets requis et politique cutoff.
- Stockage chaud/froid : objets Parquet/archive et fenêtres PostgreSQL chaudes.

## Règles UI/UX

- Les IDs techniques restent disponibles en `small`, mais le premier niveau est traduit en libellé opérateur.
- Un état vide reste un état vide réel : aucun mock, aucun fallback inventé.
- `source.direct_table_access=true` devient une alerte critique dans le view-model.
- Les erreurs API ne doivent pas être masquées par une carte “OK”.

## Fichiers

- Page : `src/pages/DataFoundationPage.tsx`
- View-model : `src/features/data-foundation/viewModel.ts`
- Tests : `src/test/dataFoundationViewModel.test.ts`
- Navigation : `src/navigation.ts`
