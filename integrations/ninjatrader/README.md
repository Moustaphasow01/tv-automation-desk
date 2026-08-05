# Intégration NinjaTrader locale

Cette intégration est limitée à la PREPROD locale et aux comptes NinjaTrader `Sim*`.

## Bridge ATI

Le bridge est désactivé par défaut. Son auto-test écrit seulement dans `.local/ninjatrader/dry-run` :

```bash
npm --prefix mcp_gpt_desk run ninja:bridge:self-test
```

Le mode Sim101 exige simultanément :

- `DESK_BROKER_EXECUTION_ENABLED=true` ;
- `DESK_NINJA_KILL_SWITCH=false` ;
- un mode `sim101_*` identique côté API et bridge ;
- un compte `Sim*` ;
- le processus NinjaTrader réellement détecté ;
- `DESK_NINJA_CONFIRMED_CONNECTED=true` seulement après vérification visuelle de la connexion Sim101 ;
- `DESK_NINJA_ATI_ENABLED=true` seulement après activation manuelle de l’ATI ;
- `DESK_NINJA_ATM_STRATEGY_NAME=<template>` après création et vérification manuelle d'un template ATM Sim101 qui pose stop et target ;
- la policy, le provider, le compte et le contrat activés en base ;
- aucun verrou PostgreSQL ;
- une intention avec risk check vert et approval opérateur explicite.

Le bridge n'est pas lancé par Docker et ne démarre pas automatiquement avec Windows.
Il refuse un ordre ATI Sim101 sans template ATM protecteur explicite. Le nom du template est injecté dans la commande OIF avec un identifiant de stratégie unique.

## AddOn N14

`DeskExecutionAddOn/DeskExecutionAddOn.cs` est le bridge AddOn bidirectionnel local. Il publie les heartbeats, snapshots compte/ordres/positions et événements ordre/fill/position vers l'API. Les requêtes sont signées en HMAC-SHA256 avec timestamp et nonce anti-rejeu.

Par défaut, l'AddOn reste en shadow read-only. Le polling de commandes exige simultanément :

- un compte configuré dont le nom correspond à `Sim*` ;
- `DESK_NINJA_ADDON_COMMANDS_ENABLED=true` ;
- `DESK_NINJA_BRIDGE_MODE=sim101_addon_approved_only` côté AddOn et backend ;
- un secret partagé d'au moins 32 caractères ;
- une connexion NinjaTrader active ;
- les mêmes policy, approval, sizing, TTL et verrous backend que le bridge ATI.

L'AddOn ne reçoit que des commandes canoniques déjà approuvées : entrée avec ATM protecteur, déplacement du stop exact, réduction ou fermeture. Le bridge ATI n'acquiert jamais une commande lorsque le mode AddOn est sélectionné ; le secours ATI est une bascule opérateur, jamais un double envoi automatique.

Auto-test cryptographique sans connexion NinjaTrader ni soumission :

```bash
npm --prefix mcp_gpt_desk run ninja:addon:self-test
```

Simulation transport/API en shadow, sans ordre :

```bash
docker compose --env-file .env.preprod exec -T api \
  node scripts/run_ninja_addon_simulator.mjs --once --claim
```

L'import de la source et son activation doivent être réalisés dans NinjaTrader Desktop. L'AddOn utilise uniquement les références NinjaScript natives `System.Net.Http` et `System.Web.Extensions`; l'installateur vérifie leur présence sans dépendre d'une référence supprimée lors de la régénération du projet par F5.

## Redémarrage Windows et connexion automatique

Le superviseur Windows est séparé de l’autorité d’exécution. Il peut relancer NinjaTrader après une fermeture ou une ouverture de session Windows, mais il ne modifie jamais le kill switch, les approvals, la policy ni les plafonds de contrats.

Installation locale :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  "C:\Users\CES\Desktop\TV_Automation_PREPROD\integrations\ninjatrader\windows\Install-DeskNinjaTraderSupervisor.ps1" `
  -ProjectRoot "C:\Users\CES\Desktop\TV_Automation_PREPROD" -Enable
```

Le réglage opérateur est disponible dans `#/operations/execution`. Lorsqu’il est actif, le superviseur :

- surveille le processus NinjaTrader toutes les 10 secondes ;
- limite les boucles de crash à trois tentatives sur quinze minutes ;
- cible la connexion de compte `Simulation` (`Provider=NinjaTrader`) et ne la remplace jamais par le flux local synthétique `Simulated Data Feed` ;
- réserve `ConnectOnStartup=true` au seul mode legacy `Provider=Simulator` lorsqu’il est explicitement demandé ; la connexion de compte `Simulation` est lancée après le login NinjaTrader ;
- conserve le mode global Simulation ;
- publie son état dans `.local/ninjatrader-control/supervisor-status.json` ;
- ne ferme pas NinjaTrader lorsqu’on désactive le redémarrage automatique.

La tâche Windows interactive `DeskFutures-NinjaTraderSupervisor` reste installée lorsque le bouton est désactivé afin que le superviseur continue de publier son état et puisse relire une activation ultérieure. L’entrée du dossier Startup ne fait que relancer cette tâche sans créer de second processus. Le changement est révisionné et audité dans `.local/ninjatrader-control/startup-audit.jsonl`.

NinjaTrader 8.1 ne fournit pas de mécanisme supporté pour mémoriser ou contourner le mot de passe de l’écran « Bienvenue ». Le superviseur détecte cette fenêtre et publie `login_required=true` au lieu d’annoncer une fausse connexion opérationnelle. Aucun mot de passe n’est stocké par le Desk et aucune automatisation de saisie n’est utilisée.

## Réconciliation

Le watcher ATI lit exclusivement `outgoing`, déduplique les changements de fichier et n'ingère que les ordres Desk dont l'identifiant commence par `order_intent_` :

```bash
DESK_NINJA_OUTGOING_ROOT="/mnt/c/Users/<user>/Documents/NinjaTrader 8/outgoing" \
npm --prefix mcp_gpt_desk run ninja:observer -- --once
```

La comparaison positions/ordres est volontairement opt-in, car un snapshot incomplet déclenche un verrou fail-closed :

```bash
DESK_NINJA_OUTGOING_ROOT="/mnt/c/Users/<user>/Documents/NinjaTrader 8/outgoing" \
npm --prefix mcp_gpt_desk run ninja:observer -- --once --reconcile
```

L'auto-test du parseur ne contacte pas NinjaTrader et n'écrit aucun ordre :

```bash
npm --prefix mcp_gpt_desk run ninja:observer:self-test
```

Un snapshot JSON `{ "orders": [], "positions": [] }` peut être envoyé au backend :

```bash
node mcp_gpt_desk/scripts/reconcile_ninja_snapshot.mjs path/to/snapshot.json
```

Tout écart force le compte et le bridge en lecture seule et crée un verrou d'exécution.
