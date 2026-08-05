# Workers IA Codex natifs Windows — V5.1/V2.1

## Statut

La cible nominale du Desk est un ensemble de services Codex persistants sur le
VPS Windows. La migration V5.1/V2.1 reste sous `ENGINE_V5_VALIDATION_HOLD` tant que
les tests de certification et le replay comparatif ne sont pas validés par
l’opérateur. Pendant ce hold, les lanes LIVE/Replay restent fermées et les
services IA restent `disabled` ou arrêtés.

Les prompts ChatGPT MCP documentés dans `CHATGPT_LIVE_WORKER_PROMPT.md` et
`CHATGPT_REPLAY_WORKER_PROMPT.md` sont une voie de secours legacy. Ils ne sont
jamais actifs en même temps que les services Codex propriétaires de la lane.

## Objectif et frontière d’autorité

Les services persistent au plus près de PostgreSQL, des packs immuables et du
moteur, avec une latence de claim faible et une reprise automatique après
incident. Ils partagent la même pile contractuelle en LIVE et Replay :

- runtime Autopilot `5.1.0` ;
- `DeskMasterAnalysisContract_v5_1_0` (`schema_version=5.1.0`) ;
- `DeskExecutionPlanContract_v1_1_0` (`schema_version=1.1.0`) ;
- `DeskHourlyThesisMonitorContract_v2_1_0` (`schema_version=2.1.0`) ;
- `DeskMonitorCommandContract_v1_1_0` (`schema_version=1.1.0`) ;
- `DeskDeterministicExecutionPolicy_v4_1_0` (`schema_version=4.1.0`) ;
- `DeskConditionCatalogContract_v1_1_0` (`schema_version=1.1.0`) ;
- compilateur déterministe `1.1.0` ;
- moteur de conditions `1.1.0` ;
- profil `OPPORTUNITY_SEEKING_CONTROLLED`.

V5.0/V2.0 et V4/V1 restent immuables, en lecture seule, pour les runs
historiques. Un nouveau work item doit épingler V5.1/V2.1 et tous les hashes
compagnons ; aucun worker ne choisit une version de contrat à partir du seul
nom historique d’une file.

Codex reçoit une enveloppe analytique immuable. Il ne reçoit aucun accès shell,
SQL direct, broker ou NinjaTrader. Le service Node conserve la propriété des
claims, leases, heartbeats, validations Ajv, compilations, écritures,
idempotence et transitions déterministes.

```text
Master brut  : save_payload_json.analysis_output
             -> validation Master V5.1 / Plan V1.1
             -> compilation backend 1.1
             -> plan canonique immuable

Monitor brut : save_payload_json.monitor_output
             -> validation Monitor V2.1 / Command V1.1
             -> compilation backend 1.1
             -> commande canonique atomique
```

Le JSON brut est conservé pour audit. Aucun runtime, front, moteur, Replay ou
gateway broker ne doit le reparcourir pour déduire une action.

## Services et priorité

| Service Windows | Lane | Worker ID | Rôle |
|---|---|---|---|
| `DeskFuturesCodexLive01` | LIVE | `codex-live-01` | Worker LIVE principal |
| `DeskFuturesCodexLive02` | LIVE | `codex-live-02` | Redondance et rattrapage LIVE |
| `DeskFuturesCodexReplay01` | REPLAY | `codex-replay-01` | Replay à priorité système basse |

Chaque instance possède un verrou advisory PostgreSQL. Les lanes LIVE et Replay
ont des claims distincts. Le worker Replay cède lorsque du LIVE est dû, en
retry, loué ou en retard.

Avant chaque claim Replay, le service appelle l’autopilote en
`next_ready_config`. Le groupe `replay-v4` peut rester l’identifiant historique
de file ; les versions réellement exécutées proviennent exclusivement des
contrats et hashes épinglés dans la configuration.

## Cadences

- GPT LIVE : un checkpoint planifié fermé `M15` ou un événement critique, avec objectif de claim inférieur à deux
  minutes après disponibilité du bundle ;
- GPT Replay : steps GPT `M15` strictement séquentiels, moteur M1 continu ;
- moteur de conditions, setup et position : chaque bougie close `M1`, sans
  fallback silencieux M5/M15 ;
- aucune décision GPT n’interrompt la supervision M1 entre deux analyses.

Le catch-up LIVE est `LATEST_SETTLED_CLOSED_M15` : le dernier checkpoint planifié fermé
absorbe la fenêtre cumulative et les checkpoints précédents sont superseded.
Le Replay n’applique jamais cette règle et conserve chaque step dans l’ordre.

## Profil d’opportunité et sécurité

`OPPORTUNITY_SEEKING_CONTROLLED` permet davantage de candidats conditionnels,
pas davantage de risque broker :

- score pondéré cible `0.55` ;
- jusqu’à trois setups candidats backend-pinned et classés ;
- lacunes contextuelles facultatives traitées en soft gates ;
- risque par trade `<= 0.25 %` de `NET_EQUITY` ;
- contrats entiers calculés par arrondi supérieur côté broker, stop valide et
  RR recalculé `>= 2` ;
- excédent d’arrondi borné par `max_rounding_excess_pct`, sinon `BROKER_SUBMIT`
  est refusé ;
- données canoniques de trigger, anti-lookahead, scope, géométrie et broker
  safety toujours fail-closed à leur phase d’enforcement ;
- `EVENT_BLACKOUT` requis mais indécidable reste `UNKNOWN` et bloque uniquement
  `ENTRY_TRIGGER`; une donnée contextuelle facultative absente reste soft ;
- confirmation sur M1 fermée suivante et réacquisition de zone réévaluée par le
  moteur, sans prose exécutable.
- effets soft explicites : `REQUIRE_CONFIRMATION` devient une condition Catalog
  V1.1; `REDUCE_RISK` devient un risque demandé abaissé dans un nouveau plan. Sans
  matérialisation, ils restent advisory et ne deviennent jamais un veto.
- mémoire : `VETO` temporaire=`LATEST_ONLY` et reconfirmation M1 après levée;
  `INVALIDATION` structurelle=`INVALIDATE_TERMINAL`; aucun `BLOCK_IF_TRUE` ne
  peut utiliser `LATCH_UNTIL_TRIGGER`.

GPT ne peut demander que `SETUP_CANDIDATE`, `PRE_ARMED` ou
`ARMED_CONDITIONAL`. Le moteur seul produit un trigger, un fill, une position et
un résultat en R.

## Modes

- `disabled` : aucun heartbeat analytique ni claim ;
- `shadow` : service vivant, canary et observabilité actifs, aucun claim ;
- `active` : claim, analyse, save et completion autorisés pour la lane.

Une nouvelle installation et toute nouvelle release contractuelle commencent
toujours en `shadow`. Le mode `active` est interdit pendant
`ENGINE_V5_VALIDATION_HOLD`.

## Installation Codex

Exécuter dans PowerShell administrateur :

```powershell
& C:\DeskFutures\current\deploy\windows\Install-DeskCodex.ps1 `
  -CodexHome C:\ProgramData\DeskFutures\codex `
  -DeviceLogin
```

L’authentification est détenue par `C:\ProgramData\DeskFutures\codex`, avec ACL
restreintes. Ne jamais transmettre `auth.json`, token ou clé API dans un chat.

## Certification avant levée du hold

Toutes les conditions suivantes sont obligatoires :

1. API, PostgreSQL, stockage objet et schedulers sains ;
2. contrats actifs V5.1/V2.1, Policy V4.1 et compagnons V1.1 enregistrés avec
   leurs hashes attendus ;
3. V5.0/V2.0 et V4/V1 historiques toujours hash-lockés, en lecture seule et
   non réécrits ;
4. génération, JSON Schemas et catalogue conditionnel sans dérive ;
5. `analysis_output` Master V5.1 et `monitor_output` Monitor V2.1 valides en
   canary ;
6. égalité des IDs épinglés : plan, thèse, setup, Monitor, Command et révision ;
7. parité de compilation LIVE/Replay pour une même sortie analytique ;
8. moteur M1 certifié sur tous les prédicats, y compris break/retest ordonné ;
9. gates testées aux quatre phases et seuils frontière `0.25/0.2501` et
   `2/1.999` ;
10. remplacement de setup atomique et idempotent ;
11. expiration de thèse suivie d’un replan backend ;
12. replay comparatif approuvé par l’opérateur ;
13. NinjaTrader limité à Simulation/Sim101 et kill switch vérifié.

Valider l’authentification et la sortie structurée sans claim ni écriture Desk :

```powershell
& C:\DeskFutures\current\deploy\windows\Test-DeskCodexInference.ps1
```

Le résultat attendu est `CANARY_OK`. Le canary utilise l’adaptateur isolé, sans
bundle métier, SQL ou broker.

## Activation progressive après autorisation

Les commandes suivantes documentent la procédure future ; ne pas les exécuter
tant que le hold n’est pas explicitement levé.

Activer un seul worker LIVE :

```powershell
& C:\DeskFutures\current\deploy\windows\Set-DeskAiWorkerMode.ps1 `
  -Target Live01 `
  -Mode active
```

Après un Master V5.1, deux Monitors V2.1 et leurs completions idempotentes, activer
le second worker LIVE :

```powershell
& C:\DeskFutures\current\deploy\windows\Set-DeskAiWorkerMode.ps1 `
  -Target Live02 `
  -Mode active
```

Le Replay est ouvert seulement après validation LIVE :

```powershell
& C:\DeskFutures\current\deploy\windows\Set-DeskAiWorkerMode.ps1 `
  -Target Replay01 `
  -Mode active
```

Chaque changement produit un reçu JSON dans
`C:\ProgramData\DeskFutures\state`.

## Retour immédiat en shadow

```powershell
& C:\DeskFutures\current\deploy\windows\Set-DeskAiWorkerMode.ps1 `
  -Target All `
  -Mode shadow
```

Ce retour n’annule aucun document validé. Un lease interrompu expire et devient
récupérable selon les règles existantes ; l’idempotence empêche une seconde
matérialisation.

## Bascule de secours vers ChatGPT MCP

1. Fermer la lane concernée.
2. Passer les services Codex propriétaires en `shadow` ou `disabled`.
3. Vérifier qu’aucun lease n’est encore actif.
4. Activer les tâches ChatGPT de la même lane seulement.
5. Rouvrir la lane et observer un cycle complet.

Pour revenir à Codex, appliquer la même procédure dans l’autre sens. Ne jamais
faire un handoff en laissant les deux plateformes réclamer simultanément.

## Invariants de sécurité

- aucune écriture SQL directe par Codex ;
- aucune commande NinjaTrader par Codex ;
- aucune invention d’identifiant, lease, pack, cutoff ou révision ;
- `analysis_output` et `monitor_output` seuls à la frontière analytique
  V5.1/V2.1 ;
- compilation et matérialisation atomiques côté backend ;
- scope LIVE/Replay, IDs épinglés et hashes vérifiés avant save ;
- heartbeat du lease pendant l’inférence ;
- LIVE prioritaire sur Replay ;
- délais, retries, dead letters et latence bundle→claim observables ;
- environnement transmis à Codex nettoyé de tous les secrets Desk ;
- aucun worker réactivé automatiquement après un déploiement sous hold.
