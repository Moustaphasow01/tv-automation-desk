# Market Calendar, Sessions and Futures Rollover — TD2-203

TD2-203 crée le modèle canonique cible pour sortir progressivement les constantes de temps et de session du code applicatif.

Tables ajoutées :

- `market_calendars` : calendrier de marché, venue et timezone canonique ;
- `market_calendar_days` : date de trading, statut (`TRADING_DAY`, `HOLIDAY`, `CLOSED`, `EARLY_CLOSE`) et fenêtre journalière éventuelle ;
- `market_session_templates` : définition stable d’une session (`asia_open`, `ny_open`, etc.) dans la timezone de marché ;
- `market_session_occurrences` : occurrence réelle d’une session sur une date donnée, avec bornes UTC et bornes locales textuelles ;
- `market_futures_rollovers` : changement de contrat futures par racine/instrument, méthode et statut.

## Frontière actuelle

Cette migration ne remplace pas encore les constantes existantes dans le scheduler Live/Replay. Le runtime actuel continue de fonctionner avec ses chemins testés. Les prochaines étapes pourront lire ces tables via une API contrôlée et migrer les usages un par un.

## Invariants

- Une occurrence de session porte toujours `start_at_utc`, `end_at_utc`, `start_local`, `end_local` et `timezone`.
- Les fenêtres UTC sont strictement ordonnées.
- Les jours `HOLIDAY` / `CLOSED` ne portent pas une fenêtre complète.
- Un rollover futures ne peut pas avoir le même contrat source et cible.

## Pourquoi c’est important

Le replay et le live doivent converger sur la même définition :

- date de trading ;
- session opérateur ;
- cutoff anti-lookahead ;
- contrat futures actif.

Sans ce registre, on retombe dans des constantes dispersées et des écarts subtils entre replay et live.
