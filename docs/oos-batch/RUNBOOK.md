# OOS Batch MCP V1 — intégration technique

Branche : `feature/oos-batch-mcp-v1`. Base propre : `3486cf6`. Les modifications AV4/front/Telegram non commitées dans l'autre worktree n'ont pas été importées ou touchées. Aucun déploiement ni push main effectué.

## Ce qui existe

| Lot | Fichiers principaux | Tests / résultat |
|---|---|---|
| Archive et contrats | `packages/desk-oos-batch/src/domain`, `src/adapter/artifact-archive.js`, ADR-0049 | Dates V1, 8 vues, octets exacts, écriture sans remplacement, traversée interdite |
| Parcours et reprise | `src/application/{premarket-workflow,plan-freeze,replay-workflow,day-workflow}.js` | Fixtures synthétiques : capture → demande externe → freeze → replay → archive ; échec avant freeze, futur refusé, altération refusée, reprise |
| Persistance et MCP | `src/adapter/{postgres-registry,postgres-commands,tradingview-mcp}.js`, `mcp_gpt_desk/src/oos-*.js`, CLI | Vrai handshake SDK MCP local vérifié ; sérialisation exacte, erreur amont expurgée. Test PostgreSQL préparé mais non exécuté : Docker Desktop ne démarre pas |
| Suivi opérateur | `mcp_gpt_desk/src/front-oos-batch.js`, `apps/desk-control-plane/src/features/oos-batch`, repository/contract, route `/replay/oos` | Tests React, contrôle TypeScript et build réussis ; contrôles accès, allowlist des fichiers, mise en file sans effet TradingView dans le BFF |

Aucune règle de trading, scénario, niveau, direction, RR, filtre ou REARM introduit. Les métriques sont transportées telles que publiées. Les agrégations sont descriptives sur les champs numériques fournis, avec nombre de journées renseignées. Les audits shadow/refus détaillés restent consultables bruts, sans reconstruction.

## Ce qui n'est pas encore raccordé

1. Endpoint et tool du **Scenario Builder externe** : non fournis. Aucun prompt historique substitué.
2. Cutoff pré-market **à choisir explicitement**. Le formulaire ne présuppose pas 09:00 ou 15:25.
3. Grammaire complète / parseur syntaxique **SMC3 V3.9.8** : absents du dossier. Le port `validatePlanSyntax` doit être raccordé à un parseur certifié syntaxique uniquement. Un reçu test n'est pas une validation réelle.
4. Pont TradingView pour les opérations et preuves ci-dessous : la configuration seule ne convertit pas des tools bas niveau en ces opérations. Le client existant externe `C:/Users/CES/Desktop/TV_Automation/scanner/mcp_adapter.py` utilise notamment `chart_set_symbol`, `chart_set_timeframe`, `capture_screenshot`, `ui_evaluate`. Il ne suffit pas de renommer ces tools : les arguments, la provenance, le chargement exact et le hash relu doivent être adaptés et vérifiés. Aucun pont UI non vérifié n'est activé.
5. Validation sur un PostgreSQL isolé, application opérateur de la migration et recette d'une vraie journée avant un mois.

**Les journées juillet/août n'ont pas été réellement rejouées. Aucun résultat de marché n'a été fabriqué.**

## Configuration

Variables privées serveur : `OOS_BATCH_CONFIG` (chemin absolu JSON), `OOS_DATABASE_URL` (runner). Le BFF réutilise `store.persistence.pool`. Absence de config : `OOS_NOT_CONFIGURED`, pas de fallback. Le runner et le BFF doivent utiliser le même PostgreSQL et le même répertoire d'archives, sur un hôte capable de joindre TradingView.

Structure du JSON privé, à renseigner avant lancement :

```json
{
  "archive_root": "C:/OOS_ARCHIVE",
  "tradingview": { "transport": "http", "url": "https://REPLACE/mcp", "token_env": "OOS_TV_TOKEN", "tools": {} },
  "scenario_builder": { "transport": "http", "url": "https://REPLACE/mcp", "token_env": "OOS_BUILDER_TOKEN", "tools": { "requestPlan": "REPLACE" } },
  "syntax_validator": { "transport": "http", "url": "https://REPLACE/mcp", "token_env": "OOS_SYNTAX_TOKEN", "tools": { "validatePlanSyntax": "REPLACE" } }
}
```

Les noms `REPLACE` sont des emplacements, pas des endpoints déployés. Transport `stdio` également supporté : `command`, `args`, `cwd`, `tools`. Commandes stdio = configuration administrateur de confiance. HTTPS requis hors loopback. Aucun secret dans le navigateur ni dans le dépôt. Pas de capacités MCP sampling, de fallback analyste ou d'accès broker.

Pour `tradingview.tools`, renseigner les noms réels des opérations : `openSymbol`, `setReplayDate`, `setReplayCutoff`, `setTimeframe`, `applyViewPreset`, `capture`, `setEngineVersion`, `setBookMode`, `loadPlan`, `readPlanFingerprint`, `startReplay`, `advanceTo`, `openDashboard`, `collectVisibleAudit`. Contrat détaillé : [MCP_PORTS.md](MCP_PORTS.md).

## PostgreSQL et archive

Migration additive : `infra/postgres/init/070_oos_batch_mcp_v1.sql`, tables `oos_batch_days`, `oos_batch_events`, `oos_batch_commands`, trigger d'identité immuable, index de file. Ne pas renuméroter ou appliquer à l'aveugle si une autre branche a occupé 070. Rebaser/reconcilier d'abord les migrations.

Le rôle runtime a besoin de SELECT/INSERT/UPDATE sur days/commands et SELECT/INSERT sur events. Aucun DELETE nécessaire. Le rôle de migration crée tables/index/fonction/trigger. Le service OOS ne doit recevoir aucune permission sur les tables broker. Appliquer avec l'outil de migration normal du dépôt ou `psql` sur une base isolée pour la recette ; aucune migration n'a été exécutée en production.

Archive : `<archive_root>/<batch_id>/<mois>/<jour>/premarket|plan|replay|evidence`. Le niveau batch supplémentaire évite les écrasements entre expériences. PNG, texte UTF-8 et JSON sont publiés avec lien atomique sans remplacement après fsync. Un fichier déjà présent n'est accepté que si ses octets sont identiques. SHA-256 plan/manifeste épinglés également dans PostgreSQL. Conserver ensemble DB et fichiers lors des sauvegardes ; pas de purge automatique.

`evidence/` conserve les réponses partielles pour reprendre après crash. Ce dossier n'est exposé ni au Scenario Builder ni au navigateur. Un accès administrateur au disque peut altérer un fichier, mais la relecture avant replay vérifie les empreintes épinglées. Droits d'accès du répertoire et sauvegardes restent indispensables.

## Lancement

Installation : `npm --prefix mcp_gpt_desk ci --ignore-scripts` et `npm --prefix apps/desk-control-plane ci --ignore-scripts`. Les dépendances locales des packages legacy doivent également être installées si l'on lance le host complet ; le runner OOS seul ne dépend pas du kernel historique.

Créer une requête opérateur JSON (ne pas utiliser les fixtures de test comme données réelles) avec : `batch_id`, `symbol` exact TradingView, `cutoff_time` HH:MM Paris, `action`, et **un seul** de `date`, `month`, `from`+`to`. V1 : juillet/août 2026, replay jusqu'à 20:00 Paris, moteur V3.9.8, mode PORTEFEUILLE_REALISTE.

```text
node mcp_gpt_desk/scripts/run_oos_batch.mjs run request.json
node mcp_gpt_desk/scripts/run_oos_batch.mjs queue request.json command-id-unique
node mcp_gpt_desk/scripts/run_oos_batch.mjs work --once
node mcp_gpt_desk/scripts/run_oos_batch.mjs work
```

`run` : commande interactive séquentielle. `queue` : commande persistée. `work` : consomme la file, arrêt SIGINT/SIGTERM après l'opération en cours. Un seul consommateur actif protégé par advisory lock ; un second reçoit OOS_BUSY. La file et le checkpoint persistent. Le runner est un processus CLI Node optionnel, pas un nouveau microservice ni un scheduler analytique.

Les demandes par mois/plage incluent toutes les dates calendaires : pas de filtre de séance inventé. Un fournisseur doit signaler explicitement l'absence de séance/données. Un même batch_id n'accepte pas un changement de symbole/cutoff/version après sa création.

## Reprises

- `capture` s'arrête au pré-market ; `scenario` au freeze ; `replay` exige le freeze ; `run` déroule l'ensemble.
- `WAITING_SCENARIO` : relancer `scenario` ou `run`, même request_id, sans créer un nouveau plan. Un provider `PENDING` n'est pas pollé en boucle automatiquement.
- `FAILED_TECHNICAL` : action `retry`, mêmes preuves déjà persistées. Après interruption pendant le replay, le graphe est remis au cutoff, le plan rechargé et la simulation réinitialisée avant d'avancer de nouveau.
- `FAILED_PLAN_VALIDATION` : arrêt ; `new-plan` demande une nouvelle réponse externe et incrémente la tentative. Jamais de correction locale.
- `COMPLETED` : aucune relance avec cet identifiant. Nouveau batch pour une nouvelle expérience.
- Même command_id + même requête : même reçu. Même ID + autre requête : conflit. L'avancement d'une commande ne signifie pas que chaque journée a réussi ; lire ses receipts.

Le verrou graphique OOS ne coordonne que les runners OOS. **Pour une vraie recette, réserver une instance/layout TradingView dédié** et empêcher les anciens captures/workers ou interventions manuelles de déplacer ce graphique. Aucun worker de production n'a été arrêté par cette mission.

## UI / BFF

Navigation « Batchs OOS », route `/#/replay/oos`. Filtres/journée/commande conservés dans l'URL. GET `/front-api/v1/oos-batch/days`, `/day`, `/artifact`, `/command`. POST `/commands` met en file et retourne 202 ; jamais d'appel TradingView depuis une requête HTTP opérateur.

Tous les endpoints refusent anonymous/rest_read ; scope desk.read pour lire, desk.write pour demander une simulation. Session opérateur/API key/OAuth existants. Artefacts accessibles seulement par allowlist de la journée, réponses privées no-store. Les outils broker/risk ne sont ni enregistrés ni importés par ce module.

## Anti-hindsight : portée réelle

Le corps envoyé au builder contient uniquement request_id, manifeste figé, hash et huit PNG pré-market. Ni chemin du disque, ni plan précédent, ni résultat/audit. `visible_as_of <= cutoff` vérifié. Les images doivent avoir une provenance authentique fournie par le pont TradingView ; cette couche ne peut pas déceler un fournisseur qui ment sur les pixels ou leurs timestamps. Le builder doit avoir un contexte isolé par demande, sans mémoire post-cutoff ni accès au disque complet. Ce confinement externe doit être certifié avant un run réel.

## Vérifications

Résultats locaux du 29/09/2026 : **25 tests OOS passés**, **4 tests UI OOS passés**, **5 tests de routes passés**, **59 tests de non-régression BFF/catalogue passés**. Le test PostgreSQL est **SKIP** faute de base isolée. TypeScript/build passent. Guards architecture, migrations, secrets navigateur, architecture front et compatibilité API passent. Contrôle static-quality ciblé sur les 15 fichiers runtime OOS : zéro fonction >60 lignes, zéro complexité au-dessus du seuil, zéro bloc dupliqué ; le guard global reste en échec comme décrit ci-dessous.

Contrôle visuel : 1440×1000 et 390×844, formulaire mobile ouvert et largeur document vérifiée à 390 px (pas de débordement de page). Les tableaux défilent dans leur région dédiée. Les requêtes annexes du shell (orders/incidents/events), non simulées dans cette recette ciblée, ont reçu des 404 ; ce n'est pas une recette intégrée du backend complet. Images locales ignorées par Git sous `output/playwright/oos-*.png`.

```text
node --test packages/desk-oos-batch/test/*.test.js mcp_gpt_desk/test/oos_front.test.js mcp_gpt_desk/test/oos_mcp.test.js mcp_gpt_desk/test/oos_postgres.test.js
npm --prefix apps/desk-control-plane run test -- src/features/oos-batch/oosBatch.test.tsx
npm --prefix apps/desk-control-plane run build
node scripts/quality/check_architecture_boundaries.mjs
node scripts/quality/check_sql_migrations.mjs
node scripts/quality/check_browser_secret_exposure.mjs
node --test mcp_gpt_desk/test/front_api_v2_catalog.test.js mcp_gpt_desk/test/front_control_plane_api.test.js
```

Pour le test PostgreSQL, définir `OOS_TEST_DATABASE_URL` vers une base **de test**, rôle autorisé à créer un schéma isolé. Le test crée puis supprime uniquement son schéma aléatoire `oos_test_*`. Sans cette variable, il est explicitement SKIP, pas PASS. Docker local a échoué sur son Secrets Engine ; aucun reset Docker ou changement de production n'a été tenté.

Le guard global static-quality n'est pas vert (fichier legacy front-session-projection et budgets agrégés dépassés). Ne pas mettre à jour la baseline pour masquer ce signal. Le contrôle ciblé OOS ne doit introduire ni fonction >60 lignes ni fichier >600 lignes. Relecture visuelle faite uniquement sur fixtures navigateur clairement marquées TEST_UI, aucune donnée de marché.

## Critère avant batch réel

Tester une journée dans une instance TradingView sans broker : 8 images vérifiables, seule cette observation reçue par le builder, plan syntaxiquement reçu et figé, texte relu identique après chargement, replay jusqu'à 20:00, trois captures finales avec identité/temps prouvés, audit visible sans invention, reprise contrôlée. Ensuite seulement lancer une plage puis les deux mois. Pas de validation de performance ni d'optimisation de stratégie dans ce chantier.
