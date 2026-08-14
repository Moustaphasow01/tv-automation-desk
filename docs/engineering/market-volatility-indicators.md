# Market volatility indicators

Date: 2026-08-09
Ticket: TD2-014

## Décision

Le desk distingue désormais deux indicateurs différents :

| Champ | Sens | Version |
| --- | --- | --- |
| `atr_14` | ATR Wilder 14 réel : true range puis lissage Wilder. | `wilder_atr_14_v1` |
| `average_range_14` | Moyenne legacy des ranges `high - low`, sans gap ni lissage Wilder. | `average_high_low_range_v1` |

Avant TD2-014, le Feature Engine exposait une moyenne `high-low` sous le nom `atr_14`. C’était dangereux : un gap entre le close précédent et la bougie courante était ignoré alors que c’est précisément une partie de la définition ATR.

## Compatibilité

`recentAverageRange()` reste exporté pour les consommateurs historiques, mais son usage métier doit être compris comme `average_range_legacy`.

Les snapshots Feature Engine ajoutent :

- `atr_14_version` ;
- `average_range_14` ;
- `average_range_legacy_version` ;
- `legacy_atr_14` pour audit/backward-read uniquement ;
- `volatility_reference_source`.

Le front affiche maintenant le libellé `ATR Wilder` lorsqu’il montre `atr_14`.

## Règle pour les prochains chantiers

Ne pas utiliser `average_range_14` pour dimensionner un stop de type `ATR`. Un stop `ATR` doit être basé sur `atr_14` et sa version.
