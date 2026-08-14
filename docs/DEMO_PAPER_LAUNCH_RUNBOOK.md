# Desk Futures — gate de lancement démo/PAPER

Ce runbook décrit la porte finale avant de laisser les agents trader en
Simulation/PAPER. Il ne remplace pas les tests techniques : il empêche surtout
de lancer un desk “vert visuellement” alors que le flux marché, le broker ou les
services critiques ne sont pas réellement prêts.

## Commande de décision

Depuis la racine de la release :

```bash
DESK_OPERATOR_ADMIN_PIN=... npm run --silent gate:demo-paper-release -- --json
```

Le gate de release combine :

- le gate strict trading démo/PAPER ;
- le gate opérateur VNext.

La décision attendue avant activation des agents est :

```json
{ "ok": true, "status": "READY", "final_decision": "OPEN_DEMO_PAPER_AGENTS_ALLOWED" }
```

Si ce gate retourne `KEEP_AGENTS_CLOSED_OR_SHADOW`, les workers IA restent
fermés ou en shadow.

Les sous-commandes restent disponibles pour diagnostiquer séparément :

```bash
npm run --silent gate:demo-paper -- --json
```

Le parcours opérateur VNext doit aussi être vert avant d’utiliser les boutons
du control-plane :

```bash
DESK_OPERATOR_ADMIN_PIN=... npm run --silent gate:vnext-operator -- --json
```

Cette commande vérifie le login PIN, le cookie httpOnly, la projection
`/front-api/v1/views/auth-session`, l’acceptation d’une commande VNext auditée
et le replay idempotent de la même commande. Elle ne soumet aucun ordre broker.

Le résultat attendu du sous-gate trading avant activation des agents est :

```json
{ "ok": true, "profile": "demo-paper", "blockers": [] }
```

Si la commande retourne un code non nul, les workers IA restent fermés ou en
`shadow`. On ne force pas l’activation depuis le front.

## Dernière preuve de préprod

Validation effectuée le 12 août 2026 à 02:10 Paris :

- `npm run test:stack` : `4 passed` en 55,4 s, avec Nginx/API/PostgreSQL/frontend
  réels.
- `node --test scripts/stack/diagnose_ninjatrader_addon_readiness.test.mjs
  scripts/stack/diagnose_tradingview_freshness.test.mjs
  scripts/stack/diagnose_demo_paper_readiness.test.mjs
  scripts/stack/check_demo_paper_gate.test.mjs` : `24 pass / 0 fail`.
- `npm run doctor:tradingview` : `STALE_FEEDS`, avec provenance maintenant
  visible : les 4 feeds core sont classés `rescue`.
- `npm run doctor:demo-paper` puis `npm run gate:demo-paper` : `BLOCKED`
  sur `data.live_fresh`, `data.source_durable` et
  `broker.sim101_addon_ready`.
- `npm run --silent gate:vnext-operator -- --json` avec le PIN opérateur local :
  `READY`, login httpOnly et commande VNext auditée/idempotente validés.
- `npm run --silent gate:demo-paper-release -- --json` avec le PIN opérateur local :
  `BLOCKED`, décision `KEEP_AGENTS_CLOSED_OR_SHADOW`, sous-composant
  `vnext_operator=READY`, sous-composant `demo_paper=BLOCKED` sur
  `data.live_fresh`, `data.source_durable`, `broker.sim101_addon_ready`.

Conclusion opérationnelle : la pile front/back est validée, mais les agents ne
doivent pas trader tant que les alertes TradingView durables MNQ/MES ne
remplacent pas le secours `rescue`, et tant que NinjaTrader affiche encore
`Bienvenue !`, que la connexion `Simulation` n’est pas prête et que l’AddOn
DeskExecution reste `read_only` sans heartbeat frais.

## Ce que le gate vérifie

- API locale prête et connectée à PostgreSQL ;
- services critiques présents et healthy :
  - `broker_management` ;
  - `live_runtime_scheduler` ;
  - `replay_preparation_worker` ;
- aucun service critique manquant ;
- données marché live fraîches pour la trading date demandée ;
- provenance durable des flux core MNQ/MES, sans dépendance à un secours MCP ;
- absence de `data_blocker` côté runtime live ;
- broker PAPER/SIM réellement armé, pas seulement démarré en mode
  `ENVIRONMENT_NOT_ARMED`.
- état de session marché CME futures :
  - marché ouvert : les flux core MNQ/MES doivent être récents ;
  - maintenance quotidienne Globex : le dernier flux proche de la fermeture est
    accepté, mais une donnée ancienne reste bloquante ;
  - weekend : le dernier flux de clôture reste acceptable dans une fenêtre
    bornée.

Telegram reste optionnel pour le lancement technique : une alerte Telegram
désactivée produit au plus un warning, pas un feu vert trading.

## Ordre de lancement recommandé

1. Démarrer PostgreSQL, API, frontend et workers système :

   ```bash
   docker compose up -d postgres api frontend broker-management replay-preparation telegram live-runtime
   ```

2. Vérifier la stack et les parcours front/back :

   ```bash
   npm run test:stack
   ```

3. Vérifier le gate démo/PAPER :

   ```bash
   npm run gate:demo-paper
   ```

   Puis vérifier le parcours opérateur VNext :

   ```bash
   DESK_OPERATOR_ADMIN_PIN=... npm run gate:vnext-operator
   ```

   Pour obtenir une checklist opérateur lisible quand le gate reste rouge :

   ```bash
   npm run doctor:demo-paper
   ```

   Pour isoler uniquement la fraîcheur TradingView MNQ/MES :

   ```bash
   npm run doctor:tradingview
   ```

   Pour isoler uniquement NinjaTrader, Simulation et l’AddOn signé :

   ```bash
   npm run doctor:ninja
   ```

4. Si le gate est `PASS`, ouvrir progressivement les workers IA :
   - un worker LIVE ;
   - observation d’un Master puis d’un Monitor complets ;
   - deuxième worker LIVE ;
   - Replay seulement si le LIVE n’est pas dû ou en retard.

## Blocage typique : TradingView n’alimente pas la base

Symptôme :

```text
data.live_fresh: effective_market_date ancien
live_runtime.no_data_blocker: LOCAL_PACK_CORE_DATASET_MISSING
```

Action :

1. obtenir le détail exact des feeds bloquants :

   ```bash
   npm run doctor:tradingview
   ```

2. vérifier que TradingView est connecté au flux non delayed souhaité ;
3. vérifier que les alertes pointent vers le MCP/API actif de préprod ;
4. auditer les webhooks locaux si la session TradingView Desktop expose CDP :

   ```bash
   powershell.exe -NoProfile -ExecutionPolicy Bypass \
     -File "C:\Users\CES\Desktop\TV_Automation_PREPROD\scripts\tradingview\Start-TradingViewDesktopCdp.ps1" \
     -Port 9222
   python3 scripts/tradingview/audit_local_alert_webhooks.py
   ```

5. si l’audit montre des alertes MNQ/MES inactives, expirées ou pointant vers
   l’ancien endpoint, commencer par le plan de migration non mutateur :

   ```bash
   python3 scripts/tradingview/migrate_local_alert_webhooks.py
   ```

   La sortie doit indiquer `READY` ou lister `needs_migration` /
   `missing_alerts`. Cette commande ne lit pas le secret et ne modifie pas
   TradingView.

6. si l’opérateur valide la correction des webhooks TradingView vers le VPS,
   exécuter explicitement :

   ```bash
   python3 scripts/tradingview/migrate_local_alert_webhooks.py --execute
   ```

   Le secret reste lu côté VPS et n’est pas imprimé. Le script doit retourner
   `EXECUTED` ou `READY`, `secret_exposed=false`, et `verified_alerts=5` pour
   les alertes batch M1/M5/M15/H1/H4.

7. si les alertes core doivent être recréées manuellement, utiliser le tableau
   “Alertes TradingView core à créer” plus bas. Le fait que
   `data_get_ohlcv` retourne des prix récents prouve seulement que TradingView
   voit le marché ; cela ne prouve pas que les webhooks alimentent PostgreSQL.

8. si l’opérateur doit seulement débloquer un diagnostic de préprod avec des
   bougies TradingView réelles déjà visibles en local, utiliser le secours MCP
   local. Ce secours reste non durable : il passe par le webhook, ne synthétise
   aucune bougie et ne remplace pas les alertes :

   ```bash
   python3 scripts/tradingview/import_recent_ohlcv_to_webhook.py --execute --env-file .env.example
   ```

9. attendre une bougie MNQ et MES réelle, puis relancer :

   ```bash
   npm run gate:demo-paper
   ```

On n’importe pas de bougies inventées pour débloquer ce gate. Un backfill
TradingView M1 est acceptable uniquement s’il est scellé et manifesté via le
format `tradingview-m1-backfill-manifest-v2`.

## Blocage typique : flux frais mais source non durable

Symptôme :

```text
data.source_durable
tradingview_source_non_durable: MNQ 1:rescue, MNQ 5:rescue, MES 1:rescue, MES 5:rescue
```

Cela signifie que PostgreSQL contient bien des bougies TradingView récentes, mais
qu’elles viennent d’un secours opérateur (`tradingview_desktop_recent_ohlcv_rescue`)
ou d’une source webhook non prouvée. Le gate strict doit rester rouge dans ce
cas : un backfill ponctuel ne prouve pas que le live sera alimenté pendant toute
la séance.

Action :

1. auditer les alertes batch existantes sans mutation :

   ```bash
   python3 scripts/tradingview/migrate_local_alert_webhooks.py
   ```

2. si `needs_migration` n’est pas vide et que l’opérateur valide la migration :

   ```bash
   python3 scripts/tradingview/migrate_local_alert_webhooks.py --execute
   ```

3. créer ou corriger manuellement les alertes TradingView MNQ/MES M1/M5 si elles
   sont absentes ;
4. chaque payload d’alerte doit poster vers `/api/v1/webhooks/tradingview` ;
5. inclure au minimum `source=tradingview_alert_webhook` ou un `alert_id`
   stable dans le JSON ;
6. attendre une nouvelle bougie reçue depuis ces alertes ;
7. relancer :

   ```bash
   npm run doctor:tradingview
   npm run gate:demo-paper
   ```

### Alertes TradingView core à créer

Créer ou vérifier exactement ces 4 alertes, toutes en **Once Per Bar Close** :

| Alert ID | Symbole chart | Timeframe | Source attendue |
| --- | --- | --- | --- |
| `tv-alert-mnq-m1-core-v1` | `MNQ1!` | `1` | `tradingview_alert_webhook` |
| `tv-alert-mnq-m5-core-v1` | `MNQ1!` | `5` | `tradingview_alert_webhook` |
| `tv-alert-mes-m1-core-v1` | `MES1!` | `1` | `tradingview_alert_webhook` |
| `tv-alert-mes-m5-core-v1` | `MES1!` | `5` | `tradingview_alert_webhook` |

Webhook URL :

```text
https://vps-6d6969db.vps.ovh.net/api/v1/webhooks/tradingview
```

Message JSON à copier pour `MNQ1!` en M1 :

```json
{
  "token": "__TRADINGVIEW_WEBHOOK_SECRET__",
  "source": "tradingview_alert_webhook",
  "alert_id": "tv-alert-mnq-m1-core-v1",
  "symbol": "MNQ1!",
  "timeframe": "1",
  "timestamp_utc": "{{time}}",
  "bar_status": "closed",
  "open": {{open}},
  "high": {{high}},
  "low": {{low}},
  "close": {{close}},
  "volume": {{volume}}
}
```

Pour les trois autres alertes, modifier uniquement `alert_id`, `symbol` et
`timeframe` selon le tableau ci-dessus. Le champ `source` doit rester
`tradingview_alert_webhook`, sinon le gate continuera à bloquer
`data.source_durable`.

## Blocage typique : broker PAPER non armé

Symptôme :

```text
broker.paper_armed: SKIPPED / ENVIRONMENT_NOT_ARMED
```

Action sur VPS Windows, après avoir vérifié que NinjaTrader est connecté à
`Simulation` et au compte `Sim101` :

```powershell
C:\desk\deploy\windows\Enable-DeskSim101Environment.ps1 -MaxContracts 10
C:\desk\deploy\windows\Prepare-DeskSim101.ps1 -MaxContracts 10
```

Puis :

```bash
npm run gate:demo-paper
```

Le gate doit rester rouge si le bridge n’est pas connecté, si le compte n’est
pas `Sim101`, si le kill switch est actif, ou si un ordre pourrait sortir du
cadre Simulation/PAPER.

## Blocage typique : NinjaTrader / AddOn pas prêt

Symptôme :

```text
broker.sim101_addon_ready
```

Diagnostic lisible :

```bash
npm run doctor:demo-paper
npm run doctor:ninja
```

Actions attendues sur le VPS Windows :

1. ouvrir NinjaTrader ;
2. terminer le login si l’écran indique `Bienvenue !` ou `login_required` ;
3. connecter le provider `NinjaTrader` en mode `Simulation` ;
4. vérifier que le compte actif est `Sim101` ;
5. ouvrir ou relancer l’AddOn DeskExecution ;
6. vérifier que l’AddOn n’est plus en `read_only`/`shadow`, qu’il publie un
   heartbeat frais et que `command_enabled=true`.

Le desk doit rester fail-closed tant que l’AddOn ne publie pas un heartbeat
frais : aucune simulation “inventée” du bridge ne doit être utilisée pour faire
passer ce gate.

## Différence avec le profil stack

Pour vérifier seulement l’infrastructure, sans autoriser le trading :

```bash
node scripts/stack/check_demo_paper_gate.mjs --profile=stack
```

Dans ce profil, une donnée live stale devient un warning. Ce profil ne suffit
jamais pour lancer les agents traders.
