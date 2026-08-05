# Runbook local NinjaTrader — PREPROD Sim101

Date : 2026-07-22 — mise à jour : 2026-07-26  
Portée : machine Windows locale ou VPS, PostgreSQL, compte NinjaTrader `Sim*` uniquement.  
Interdit : compte live et ordre GPT direct.

## État sûr attendu

```text
DESK_BROKER_EXECUTION_ENABLED=false
DESK_NINJA_BRIDGE_MODE=disabled
DESK_NINJA_KILL_SWITCH=true
DESK_NINJA_MAX_CONTRACTS=0
broker provider disabled
paper account read_only
policy disabled
global PostgreSQL lock engaged
```

La réponse de `GET /api/v1/execution/overview` doit afficher `submissionPossible=false`.

## Composants

- `packages/desk-domain/src/broker-execution.js` : matérialisation, risk gates et rendu OIF.
- `packages/desk-domain/src/broker-position-management.js` : mapping Monitor, règles stop/réduction/fermeture et rendu déterministe.
- `packages/desk-domain/src/ninja-ati.js` : parseur déterministe des fichiers ATI `outgoing`.
- `mcp_gpt_desk/src/broker-execution-service.js` : orchestration, autorité `AUTO`/`SEMI_AUTO` et audit.
- `mcp_gpt_desk/src/broker-execution-repository.js` : ledger PostgreSQL, fills, trades et réconciliation.
- `mcp_gpt_desk/scripts/run_ninja_bridge.mjs` : bridge Windows fail-closed.
- `mcp_gpt_desk/scripts/watch_ninja_outgoing.mjs` : observer ATI read-only.
- `mcp_gpt_desk/scripts/run_broker_management_worker.mjs` : matérialisation continue des actions Monitor.
- `mcp_gpt_desk/scripts/run_ninja_sim101_matrix.mjs` : matrice d'acceptance physique ATI, verrouillée sur `Sim*`.
- `mcp_gpt_desk/scripts/run_ninja_addon_sim101_acceptance.mjs` : matrice
  d'acceptance physique de l'AddOn, exposée par
  `npm --prefix mcp_gpt_desk run ninja:addon:matrix:sim101`.
- `packages/desk-domain/src/ninja-addon-protocol.js` : commandes, événements et parité AddOn canoniques.
- `mcp_gpt_desk/src/ninja-addon-auth.js` : signature HMAC, fraîcheur et nonce anti-rejeu.
- `mcp_gpt_desk/scripts/run_ninja_addon_simulator.mjs` : simulateur shadow signé, sans ordre.
- `integrations/ninjatrader/DeskExecutionAddOn/DeskExecutionAddOn.cs` : AddOn bidirectionnel, shadow par défaut.
- `src/pages/ExecutionConsolePage.tsx` : cockpit opérateur réel, sans mock.

## Calcul normalisé des contrats

Le gateway broker est l'unique autorité sur la quantité envoyée à NinjaTrader. Une quantité issue de GPT, d'un setup ou d'une ancienne position n'est jamais transmise directement.

```text
capital = net_liquidation_value, sinon cash_value, sinon fallback opérateur autorisé
budget_risque = capital × pourcentage_de_risque_policy
risque_par_contrat = abs(entrée - stop) × point_value
contrats_théoriques = budget_risque / risque_par_contrat
contrats_broker = ceil(contrats_théoriques)
```

- `buying_power` est conservé pour l'observabilité mais exclu du capital de calcul ;
- le pourcentage de risque est configurable dans l'Execution Console entre `0,01 %` et `1,00 %` (`0,25 %` par défaut) ;
- le snapshot du compte doit dater de moins de 60 secondes et son capital net reste toujours prioritaire ;
- le capital net de secours est configurable depuis le front, désactivé par défaut et utilisé uniquement si le capital NinjaTrader frais est absent ;
- chaque modification de ces deux paramètres exige une confirmation explicite, une révision cohérente et produit un événement d'audit PostgreSQL ;
- `point_value` vient du contrat NinjaTrader PostgreSQL actif ;
- la quantité calculée doit rester sous les plafonds environnement, compte et policy ;
- risque théorique, risque réel et excès dû à l'arrondi sont persistés dans le risk check et l'intention ;
- si aucune source de capital autorisée ou aucun `point_value` n'est disponible, le calcul échoue en mode fail-closed.

L'arrondi supérieur peut produire un risque réel légèrement supérieur au pourcentage configuré. Exemple à `0,25 %` : `6,25` contrats théoriques deviennent `7`. Ce dépassement est affiché et audité, jamais masqué.

## Modes d'autorité

Le mode se configure depuis l'Execution Console et chaque changement incrémente la révision de policy et crée une trace d'audit.

- `AUTO` : une entrée qui passe tous les risk gates est autorisée par le système et mise en file sans validation humaine. La gestion déterministe de la position est également automatique.
- `SEMI_AUTO` : l'entrée reste en attente d'approbation opérateur. Dès qu'elle est exécutée, stop, réduction de risque et sortie restent automatiques afin qu'une absence de l'opérateur ne laisse jamais une position sans gestion.
- Dans les deux modes, le compte reste limité à `Sim101` ; les comptes live sont refusés, et kill switch, limites, fraîcheur des données, session, idempotence et réconciliation restent obligatoires.

## Démarrage et contrôle sans ordre

```bash
docker compose --env-file .env.preprod up -d
docker compose --env-file .env.preprod ps
npm run guard:strategy-contracts
npm --prefix mcp_gpt_desk run ninja:bridge:self-test
npm --prefix mcp_gpt_desk run ninja:observer:self-test
```

Les deux auto-tests doivent annoncer `submitted:false`. Le bridge dry-run écrit uniquement sous `.local/ninjatrader/dry-run`.

### Continuité après redémarrage Windows

Le bouton « Activer/Désactiver le redémarrage auto » de l’Execution Console pilote `.local/ninjatrader-control/startup-control.json`. Il ne pilote jamais l’armement broker.

Le superviseur Windows est exécuté par la tâche interactive persistante `DeskFutures-NinjaTraderSupervisor` et relance NinjaTrader si le processus disparaît lorsque le réglage est actif. L’entrée du dossier Startup sert de déclencheur de secours vers cette même tâche. La cible normale est la connexion de compte `Simulation` (`Provider=NinjaTrader`) : elle fournit les données réelles temps réel ou delayed selon les droits du compte et ne doit jamais être confondue avec `Simulated Data Feed`, qui est synthétique. NinjaTrader 8.1 impose une authentification principale à chaque lancement ; après le login, l’opérateur lance `Simulation`. Le front affiche `AUTHENTIFICATION REQUISE` tant que nécessaire et ne considère la connexion effective que si le heartbeat et le snapshot AddOn sont tous les deux frais et connectés.

Après chaque lancement automatique, contrôler dans la console :

1. `Superviseur ACTIF` ;
2. `Processus EN COURS` ;
3. `Auto-connexion flux CONFIGURÉE` ;
4. après le login NinjaTrader, `Connexion effective SIM101 CONNECTÉ` et AddOn `READ_ONLY` tant que l’exécution n’est pas explicitement armée ;
5. `submissionPossible=false` lorsque les verrous de sécurité sont engagés.

Désactiver le réglage empêche les prochains redémarrages mais ne tue pas un NinjaTrader déjà lancé. Après un reboot complet du VPS Windows, une session interactive Windows doit néanmoins être ouverte automatiquement pour permettre l’exécution de l’application graphique NinjaTrader.

Ajouter la validation AddOn sans ordre :

```bash
npm --prefix mcp_gpt_desk run ninja:addon:self-test
docker compose --env-file .env.preprod exec -T api \
  node scripts/run_ninja_addon_simulator.mjs --once --claim
```

Le résultat attendu contient `signed=true`, puis `submitted=false`. Avec l'état sûr ci-dessus, le claim répond `ENVIRONMENT_NOT_ARMED`.

## AddOn N14 — installation et shadow

Avant de démarrer NinjaTrader, définir les variables utilisateur Windows. Employer un secret local distinct ; ne pas recopier le placeholder ci-dessous dans un environnement partagé.

```powershell
[Environment]::SetEnvironmentVariable("DESK_NINJA_ADDON_API_BASE_URL", "http://127.0.0.1:8787/api/v1", "User")
[Environment]::SetEnvironmentVariable("DESK_NINJA_ADDON_SHARED_SECRET", "<secret-local-de-32-caracteres-minimum>", "User")
[Environment]::SetEnvironmentVariable("DESK_NINJA_ADDON_ID", "desk-local-nt8", "User")
[Environment]::SetEnvironmentVariable("DESK_NINJA_ACCOUNT_NAME", "Sim101", "User")
[Environment]::SetEnvironmentVariable("DESK_NINJA_BROKER_ACCOUNT_ID", "ninjatrader_paper_local", "User")
[Environment]::SetEnvironmentVariable("DESK_NINJA_BRIDGE_MODE", "disabled", "User")
[Environment]::SetEnvironmentVariable("DESK_NINJA_ADDON_COMMANDS_ENABLED", "false", "User")
```

1. Importer `DeskExecutionAddOn.cs` dans l'éditeur NinjaScript.
2. Vérifier que les références natives `System.Net.Http` et `System.Web.Extensions` sont présentes dans le projet NinjaScript.
3. Compiler, puis redémarrer NinjaTrader manuellement si l'éditeur le demande.
4. Vérifier dans l'Execution Console : `AddOn SHADOW`, protocole `desk_ninja_addon_v1`, compteur de snapshots et événements.
5. Laisser tourner au moins 20 snapshots avec l'observer ATI read-only actif pour mesurer la parité.

Un statut de parité `incomplete` est normal tant qu'aucun snapshot ATI frais n'existe. Une divergence ne doit pas être ignorée pour armer les commandes.

### Activation des commandes Sim101

Cette activation est séparée du shadow et reste limitée à `Sim*` :

1. arrêter le bridge ATI d'envoi ; l'observer read-only peut rester actif ;
2. vérifier visuellement le compte de simulation et le template ATM ;
3. activer provider, compte, contrat, policy, plafond et capital/risk sizing ;
4. libérer les verrous uniquement avec les confirmations opérateur prévues ;
5. configurer `DESK_NINJA_BRIDGE_MODE=sim101_addon_approved_only` côté API et côté Windows ;
6. configurer `DESK_NINJA_ADDON_COMMANDS_ENABLED=true`, puis redémarrer NinjaTrader manuellement ;
7. vérifier `command_enabled=true` dans la console avant toute soumission autorisée.

Le retour ATI n'est pas automatique. Pour basculer : réengager le kill switch, arrêter l'AddOn command-enabled, constater l'absence de lease, changer le mode, puis seulement lancer le bridge ATI.

## Observer ATI sans écrire dans NinjaTrader

```bash
DESK_NINJA_OUTGOING_ROOT="/mnt/c/Users/<user>/Documents/NinjaTrader 8/outgoing" \
npm --prefix mcp_gpt_desk run ninja:observer -- --once
```

Le watcher :

- lit uniquement les fichiers `.txt` de `outgoing` ;
- accepte seulement un compte `Sim*` et le compte PostgreSQL paper ;
- attribue `order_intent_*` aux entrées et `management_intent_*` aux réductions ;
- résout les références de stop protecteur existantes pour confirmer un `CHANGE`, sans adopter les ordres manuels ;
- déduplique par nom, contenu et date de modification ;
- ne crée aucun fichier dans `incoming`.

Ajouter `--reconcile` seulement lorsque la liste `outgoing` est complète. Toute divergence quantité/sens/ordre crée un lock de compte et force `read_only`.

## Gestion continue Monitor → NinjaTrader

Le service Docker `broker-management` inspecte les derniers Monitors toutes les 15 secondes. Il reste inoffensif tant que l'environnement n'est pas armé.

Actions reconnues :

| Décision Monitor | Action broker |
|---|---|
| `MOVE_STOP_BE` | `CHANGE` sur la référence exacte du stop protecteur |
| `TAKE_PARTIAL`, `REDUCE_RISK` | ordre marché opposé inférieur à la quantité ouverte |
| `EXIT_POSITION`, `INVALIDATE_THESIS` | `CLOSESTRATEGY` si ATM connu, sinon `CLOSEPOSITION` |

Chaque action apparaît dans « Gestion continue des positions » sur `#/operations/execution`. Si elle est strictement réductrice de risque et passe les contrôles de révision, elle reçoit une autorisation système et rejoint automatiquement l'outbox prioritaire, en `AUTO` comme en `SEMI_AUTO`.

Contrôles utiles :

```bash
docker compose ps broker-management
docker compose logs --tail=50 broker-management
npm --prefix mcp_gpt_desk run ninja:management:once
```

En état sûr, le résultat attendu est `ENVIRONMENT_NOT_ARMED`.

## Recette physique Sim101 — procédure manuelle

Ne pas exécuter ces étapes si un seul contrôle visuel est incertain.

1. Ouvrir NinjaTrader manuellement.
2. Vérifier visuellement que le compte est `Sim101` et qu'aucun compte live n'est connecté.
3. Activer ATI manuellement.
4. Créer ou vérifier un template ATM de simulation avec stop et target. Noter son nom exact.
5. Limiter temporairement provider, compte, contrat MNQ ou MES, policy et variables d'environnement à un contrat micro maximum.
6. Libérer le kill switch PostgreSQL avec la confirmation opérateur, jamais par un seed automatique.
7. Matérialiser une seule position paper, faire passer les risk gates et approuver l'intention avec `CONFIRM_SIM101_ORDER`.
8. Lancer le bridge Windows avec le chemin exact `incoming` et `DESK_NINJA_ATM_STRATEGY_NAME`.
9. Constater à l'écran l'entrée Sim101 et la création immédiate des protections ATM.
10. Lancer le watcher `outgoing --reconcile`, puis vérifier ordre, fill, trade et réconciliation dans l'Execution Console.
11. Annuler/flatten en simulation, vérifier `FLAT`, puis réengager tous les verrous.

Le bridge recontrôle juste avant le dépôt : processus NinjaTrader présent, compte `Sim*`, connexion confirmée, mode identique à l'API, environnement activé, kill switch libéré, policy/compte/contrat autorisés, autorisation auditée valide (`system` en `AUTO`, `operator` en `SEMI_AUTO`) et template ATM renseigné.

## Matrice ATI Sim101 automatisée

Cette commande est réservée à une fenêtre d'acceptance locale où NinjaTrader est connecté à une source `Simulation`, le mode global Simulation est actif et aucun compte live n'est connecté.

```bash
DESK_NINJA_MATRIX_CONFIRMATION=I_CONFIRM_SIM101_ONLY \
DESK_NINJA_NO_LIVE_CONNECTIONS_CONFIRMED=true \
DESK_NINJA_ACCOUNT_NAME=Sim101 \
DESK_NINJA_INCOMING_ROOT="/mnt/c/Users/<user>/Documents/NinjaTrader 8/incoming" \
DESK_NINJA_OUTGOING_ROOT="/mnt/c/Users/<user>/Documents/NinjaTrader 8/outgoing" \
DESK_NINJA_CONFIG_PATH="/mnt/c/Users/<user>/Documents/NinjaTrader 8/Config.xml" \
DESK_NINJA_ATM_STRATEGY_NAME=TVA_SIM_SAFE_1X_320_400 \
npm --prefix mcp_gpt_desk run ninja:matrix:sim101
```

La matrice vérifie réellement :

- `PLACE LIMIT`, `CHANGE` et `CANCEL` ;
- `PLACE MARKET` et lecture du fill/position ;
- target + stop OCO, modification du stop et annulation OCO ;
- `CLOSEPOSITION` ;
- `REVERSEPOSITION` puis fermeture ;
- entrée avec le template ATM, deux protections actives, `CLOSESTRATEGY`, protections annulées et position `FLAT` ;
- `CANCELALLORDERS` et `FLATTENEVERYTHING` en préflight et en nettoyage final.

Le script refuse tout compte qui ne correspond pas à `Sim*`, revalide `Config.xml` avant chaque dépôt, exige le mode global Simulation, exige le double opt-in explicite et produit une preuve JSON. Les fichiers réels `outgoing` sont normalisés de `Sim101_<orderId>.txt` vers l'identifiant canonique et de `MNQ SEP26` vers `MNQ 09-26`.

## Arrêt d'urgence et retour à l'état sûr

1. Réengager immédiatement le kill switch depuis l'Execution Console.
2. Arrêter le processus bridge Windows.
3. Remettre `DESK_BROKER_EXECUTION_ENABLED=false`, `DESK_NINJA_BRIDGE_MODE=disabled`, `DESK_NINJA_KILL_SWITCH=true`, `DESK_NINJA_MAX_CONTRACTS=0`.
4. Désactiver provider/policy/contrats et remettre le compte paper en `read_only=true`, `order_submission_enabled=false`.
5. Confirmer `submissionPossible=false` dans `/api/v1/execution/overview`.

Ne jamais effacer les événements, fills ou réconciliations pour masquer un incident. Les données de test portent des identifiants dédiés et les scripts automatiques nettoient uniquement leurs propres fixtures.

## Validation logicielle exécutée

- garde SHA-256 des deux contrats stratégiques : vert ;
- domaine : 93 tests, 0 échec ;
- backend MCP complet : 301 tests, 0 échec ;
- ciblage Replay/LIVE/Ninja : 72 tests, 0 échec ;
- test PostgreSQL/API réel : déduplication événement, fill et trade vérifiés, fixtures supprimées ;
- build TypeScript/Vite et écran `#/operations/execution` : verts ;
- AddOn N14 : signature/anti-rejeu, shadow, isolation ATI et claim autorisé couverts ;
- simulateur signé contre l'API/PostgreSQL réelle : heartbeat `read_only`, snapshot et événement persistés, claim `ENVIRONMENT_NOT_ARMED`, `submitted=false` ;
- source C# AddOn compilée contre les assemblies NinjaTrader 8 locales ;
- rendu 1440 × 1000 de l'Execution Console vérifié sans erreur console : protocole, état AddOn et parité ATI↔AddOn visibles ;
- stack Docker locale : PostgreSQL/API/worker de gestion/frontend sains ;
- matrice physique `Sim101` complète : 30 étapes, `status=passed` ;
- template ATM `TVA_SIM_SAFE_1X_320_400` : 1 contrat, stop 320 ticks, target 400 ticks, auto-reverse désactivé ;
- preuve : `mcp_gpt_desk/.local/ninjatrader/matrix/sim101_matrix_20260722140134_28618.json`, SHA-256 `910e5f87db80cda2183ea3d97359178b24c61c4a6dd2f97d5aafb96e565ba54d` ;
- état final vérifié : `FLAT`, aucun OIF restant, NinjaTrader arrêté, ATI désactivée, confirmation d'ordre réactivée, policy désactivée, compte read-only et kill switch PostgreSQL engagé.

## Références officielles

- https://ninjatrader.com/support/helpguides/nt8/file_interface.htm
- https://ninjatrader.com/support/helpguides/nt8/order_instruction_files_oif.htm
- https://ninjatrader.com/support/helpguides/nt8/information_update_files.htm
- https://ninjatrader.com/support/helpguides/nt8/order_state_definitions.htm
- https://ninjatrader.com/support/helpGuides/nt8/addon_development_overview.htm
