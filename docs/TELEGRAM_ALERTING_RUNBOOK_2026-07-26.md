# Alerting Telegram — architecture et exploitation

## État livré

- Release VPS : `vps-staging-20260726.24`
- Service Windows : `DeskFuturesTelegram`
- Stockage : PostgreSQL natif
- Transport : API Bot Telegram sortante, sans webhook ni port entrant
- Bots :
  - administration : incidents, infrastructure, données, files GPT, NinjaTrader et risque ;
  - trading : décisions exécutables, ordres, événements broker, trades et gestion de position.
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
