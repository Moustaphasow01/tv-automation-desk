# Lot 022 — AUTO/LIVE technical readiness

Date: 2026-08-14

## Verdict

Statut final: PARTIEL / BLOQUÉ EXTERNE.

Le repository dispose de gates techniques pour Demo/PAPER, VNext opérateur et release globale. Les tests unitaires de ces gates passent. Le runtime local actuellement joignable sur `127.0.0.1:8787` n'est pas prêt pour Demo/PAPER strict et ne doit pas ouvrir les agents autrement qu'en SHADOW/closed.

AUTO et LIVE ne sont pas activés.

## Preuves code

- Gate Demo/PAPER: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/stack/check_demo_paper_gate.mjs:27`
- Conditions data fraîches et source durable: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/stack/check_demo_paper_gate.mjs:86`
- Conditions broker PAPER safe: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/stack/check_demo_paper_gate.mjs:114`
- Mode manuel Telegram safe: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/stack/check_demo_paper_gate.mjs:200`
- AddOn Sim101 ready: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/stack/check_demo_paper_gate.mjs:209`
- Release gate combiné Demo/PAPER + VNext opérateur: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/stack/check_demo_paper_release_gate.mjs:39`
- Décision finale `KEEP_AGENTS_CLOSED_OR_SHADOW` si blocker: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/stack/check_demo_paper_release_gate.mjs:84`
- Gate d'interdiction AUTO: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/reports/compliance-closure/AUTOMATIC-EXECUTION-REACTIVATION-GATE.md:1`

## Tests passés

```text
node --test scripts/stack/check_demo_paper_gate.test.mjs scripts/stack/diagnose_demo_paper_readiness.test.mjs scripts/stack/check_demo_paper_release_gate.test.mjs scripts/stack/check_vnext_operator_e2e.test.mjs
23 pass / 0 fail
```

## Preuve runtime locale

### Profil stack

Commande:

```text
npm run --silent gate:demo-paper -- --json --profile=stack --status-url=http://127.0.0.1:8787/status
```

Résultat:

```text
ok=true
warnings=data.live_fresh.stack_profile
api.ready=true
api.postgres_mode=postgres
data_state=stale
core_age_seconds≈157156
effective_market_date=2026-08-12
```

Interprétation: la stack répond, mais les données live ne sont pas fraîches.

### Profil Demo/PAPER strict

Commande:

```text
npm run --silent gate:demo-paper -- --json --profile=demo-paper --status-url=http://127.0.0.1:8787/status
```

Résultat:

```text
ok=false
blockers:
- service.live_runtime_scheduler.healthy
- data.live_fresh
- data.source_durable
- live_runtime.no_data_blocker
- broker.paper_environment_safe
- execution.manual_telegram_ready
```

Faits importants:

```text
data_state=stale
core_age_seconds≈157185
source_health.durable=false
MNQ/MES M1/M5 provenance=rescue
broker.execution_enabled=false
bridge_mode=disabled
kill_switch_released=false
execution_authority_mode=auto
entry_operator_approval_required=false
manual_telegram_execution_enabled=true
telegram tradingConfigured=false
```

### Doctor Demo/PAPER

Commande:

```text
npm run --silent doctor:demo-paper -- --json --exit-zero --status-url=http://127.0.0.1:8787/status
```

Actions produites:

1. Réactiver les alertes TradingView MNQ/MES.
2. Remplacer les feeds rescue par des alertes durables.
3. Vérifier le mode exécution manuelle Telegram.
4. Activer la validation opérateur à l'entrée.
5. Relâcher le kill switch DB uniquement si Simulation/Sim101 est validé.
6. Activer le canal Telegram trading.

### Release gate global

Commande:

```text
npm run --silent gate:demo-paper-release -- --json --exit-zero --status-url=http://127.0.0.1:8787/status --vnext-base-url=http://127.0.0.1:8090
```

Résultat:

```text
ok=false
status=BLOCKED
final_decision=KEEP_AGENTS_CLOSED_OR_SHADOW
additional blocker=vnext-operator.operator.pin_configured
```

## Requirement matrix

| Requirement | Current status | Gap | Implementation | Tests | Runtime proof | Final status |
|---|---:|---|---|---|---|---:|
| Gate Demo/PAPER strict | FAIT | Aucun gap local | `check_demo_paper_gate` | 10 tests | Runtime local exécuté | FAIT |
| Gate release global VNext + backend | FAIT | PIN opérateur requis pour preuve complète | `check_demo_paper_release_gate` | 4 tests | Runtime local bloque sans PIN | FAIT |
| AUTO non activé sans autorisation | FAIT | Aucun gap local | gate document + release decision | release gate test | Runtime décision `KEEP_AGENTS_CLOSED_OR_SHADOW` | FAIT |
| LIVE non activé implicitement | FAIT | Aucun gap local | `authorizeLiveActivationV1` + config fail-closed | runtime cutover tests | Pas d'approbation LIVE fournie | FAIT |
| Données live prêtes pour Demo/PAPER | NON PROUVÉ | Feed stale/rescue au moment du test | Data readiness gate | gate runtime | `data.live_fresh=false` | BLOQUÉ EXTERNE |
| Telegram trading prêt | NON PROUVÉ | Worker/config trading désactivés | doctor action | gate runtime | `tradingConfigured=false` | BLOQUÉ EXTERNE |
| Semi-manual opérateur prêt | PARTIEL | runtime actuel expose `authority=auto`, approval=false | broker gate | gate runtime | Doit être changé via front/ops | PARTIEL |

## Blockers production / demo paper

1. Flux TradingView durables MNQ/MES M1/M5 à rétablir.
2. Scheduler live à repasser healthy.
3. Data blocker `LOCAL_PACK_CORE_DATASET_STALE` / `LIVE_PACK_RETRY_WAIT` à lever.
4. Mode opérateur à réaligner en `semi_auto`.
5. Validation opérateur entrée à activer.
6. Telegram trading à configurer/activer/tester.
7. PIN opérateur à fournir uniquement au release gate.

## Résultat de lot

- FAIT gagnés: gates Demo/PAPER, release, VNext operator testés ; document de réactivation AUTO créé.
- PARTIEL restant: readiness runtime réelle.
- NON FAIT: aucun nouveau.
- NON PROUVÉ: readiness feed/Telegram/operator sur environnement cible.
- BLOQUÉ EXTERNE: alertes TradingView durables, Telegram credentials, PIN opérateur, décision humaine.

## Prochain lot

LOT 023 — Final 139 Requirements Audit.

Objectif: réauditer la conformité stricte après Lots 013 à 022 et produire une matrice synthétique honnête.
