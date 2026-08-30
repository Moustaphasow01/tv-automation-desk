# Alerting Telegram — architecture et exploitation

## État livré

- Release initiale : `vps-staging-20260726.24` (consulter `/status` pour la release active)
- Service Windows : `DeskFuturesTelegram`
- Stockage : PostgreSQL natif
- Transport : API Bot Telegram sortante, sans webhook ni port entrant
- Bots :
  - administration : incidents, infrastructure, données, files GPT, NinjaTrader et risque ;
- trading : `OrderIntent` canoniques post-Risk, décisions Human Gate, suivi théorique, déclarations opérateur, événements broker et gestion de position.
- Commandes : lecture seule sur le bot administration.
- Exécution d’ordres par Telegram : interdite.

## Garanties

- verrou advisory PostgreSQL : un seul worker actif ;
- outbox et tentatives persistées ;
- déduplication persistante ;
- reprise après crash : un envoi interrompu devient `uncertain` et n’est pas renvoyé automatiquement ;
- trois tentatives maximum sur erreur temporaire ;
- baselining initial sans envoi de l’historique ;
- regroupement des dépassements SLA par file `LIVE` ou `REPLAY` ;
- une alerte de file lors du passage à `active`, puis une récupération lors du passage à `cleared` ;
- tokens absents du front, des réponses API et des logs.
- source principale des tickets semi-manuels : `portfolio_order_intent_lineage` + `human_execution_gates` ;
- événements d’entrée/TP/SL/expiration : `trade_theoretical_execution_events`, toujours libellés **théoriques** ;
- déclarations opérateur : `trade_manual_execution_events`, sans modification du suivi théorique ;
- les anciens `trade_order_intents` ne sont notifiés que lorsqu’ils ne possèdent aucune lignée canonique, afin d’éviter les doublons ;
- `CONFIRMED`, `ACK`, `PARTIAL_FILL` et `FILL` restent des états distincts ; aucune notification ne transforme une confirmation en fill.

## Politique de notification trading

| Événement | Canal | Priorité | Sémantique |
| --- | --- | --- | --- |
| OrderIntent + Human Gate | trading | normale | ticket opérateur, aucun ordre broker envoyé |
| Entrée théorique touchée | trading | haute | simulation déterministe, pas un fill broker |
| TP/SL/expiration théorique | trading | haute | résultat théorique clôturé ou ordre expiré |
| Déclaration opérateur | trading | normale | preuve déclarative pour attribution, pas une preuve provider |
| Provider/broker event | trading | haute | état physique uniquement si un provider réel le publie |

La clé de source et l’empreinte du payload rendent chaque transition idempotente. Une requête Telegram ambiguë n’est jamais renvoyée aveuglément.

## Commandes administration

`/help`, `/status`, `/live`, `/feed`, `/gpt`, `/ninja`, `/positions`,
`/risk`, `/replay`, `/incidents`, `/last_errors`, `/mute <minutes>`,
`/resume`.

Ces commandes lisent l’état PostgreSQL. Elles ne peuvent ni ouvrir ni modifier
ni clôturer un ordre.

## Exploitation

Le statut masqué et les réglages sont disponibles dans :

`Opérations > Notifications > Alerting Telegram`

Variables de service :

```text
DESK_TELEGRAM_ENABLED=true
DESK_TELEGRAM_COMMANDS_ENABLED=true
DESK_TELEGRAM_POLL_MS=5000
TELEGRAM_ADMIN_BOT_TOKEN=<secret VPS>
TELEGRAM_ADMIN_CHAT_ID=<secret VPS>
TELEGRAM_ALERT_BOT_TOKEN=<secret VPS>
TELEGRAM_ALERT_CHAT_ID=<secret VPS>
TELEGRAM_LEGACY_FALLBACK=false
```

Le fichier VPS est `C:\ProgramData\DeskFutures\config\desk.env` avec ACL
restreinte à `SYSTEM` et `Administrators`.

## Contrôles rapides

```powershell
Get-Service DeskFuturesTelegram
Invoke-RestMethod https://vps-6d6969db.vps.ovh.net/api/v1/telegram
Get-Content C:\ProgramData\DeskFutures\logs\telegram\DeskTelegram.wrapper.log -Tail 50
```

Un arrêt complet du VPS empêche nécessairement le bot hébergé sur ce même VPS
d’envoyer une alerte. Un dead-man externe reste le complément recommandé pour
ce seul cas.
