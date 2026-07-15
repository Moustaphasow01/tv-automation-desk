# Audit architecture et nettoyage du Desk

Date : 2026-07-15  
Projet cloud audite : `tv-automation-23d50`  
Branche locale : `codex/front-replay-lab-simplification`  
Revision de base : `38407bb6cf7cede134ffe22567ee9a6d0e29b513`  
Mode : lecture seule. Aucun fichier historique, service, job, scheduler ou document Firestore n'a ete supprime.

Ce document couvre uniquement le chantier de stabilisation, de nettoyage et de simplification sur l'infrastructure actuelle. La sortie de Firebase/Google Cloud vers OVH est un chantier distinct, documente dans `docs/MIGRATION_OVH_2026-07-15.md`. Aucun changement d'hebergeur ne doit etre integre aux PR de nettoyage.

## 1. Conclusion executive

Le depot ne contient pas seulement des archives : deux architectures metier sont encore actives en production.

1. Le Desk GPT/MCP actuel tourne avec le frontend React, `tv-desk-front-api`, `tv-gpt-desk-mcp`, les jobs Live Master/M15 et les packs Firestore.
2. L'ancien moteur Python `committee_v2` tourne encore en `shadow` via `tv-desk-cycle`, avec plusieurs schedulers US actifs et des appels Anthropic possibles.

Il n'est donc pas encore possible de supprimer globalement `scanner/`, `run_desk.py` ou `run_desk_cloud.py`. En revanche, une premiere vague importante peut etre retiree sans toucher au runtime cloud : second frontend explicitement exclu, archives `legacy/`, scripts de recherche sans reference de controle, rapports generes et ancien job pack orphelin.

Les chiffres principaux du working tree courant sont :

- 113 scripts `run_*.py` a la racine ;
- seulement 3 scripts racine atteints statiquement par les jobs Python actifs ;
- 55 scripts racine sans reference dans les configs, deploiements, tests ou sources de controle inspectes ;
- 31 fichiers d'un second frontend explicitement exclus du build TypeScript ;
- 240 fichiers suivis sous `legacy/`, references par les anciens gates de nettoyage mais pas par le runtime ;
- 350 fichiers suivis sous `reports/` ;
- 24 schedulers cloud, dont 16 actifs et 8 en pause ;
- 10 Cloud Run Jobs, dont 2 sans aucune execution et 1 ancien builder sans scheduler actif identifie.

## 2. Perimetre et limites

### Sources de verite consultees

- inventaire reel Google Cloud en lecture seule : Cloud Run Services, Cloud Run Jobs, Cloud Scheduler et Cloud Functions ;
- `firebase.json`, Dockerfiles et scripts `cloudrun_*.ps1` ;
- imports statiques Python depuis les entrypoints cloud ;
- imports React/TypeScript depuis `src/main.tsx` ;
- imports Node depuis les entrypoints MCP et les scripts de jobs deployes ;
- references dans la CI, les tests, `config/`, `desk_server/` et les scripts de deploiement ;
- etat Git du working tree.

### Limites

- le working tree contient de nombreuses modifications et de nombreux fichiers non suivis ; cet audit porte volontairement sur cet etat courant, pas uniquement sur `HEAD` ;
- l'analyse de dependances est statique : un import construit dynamiquement peut ne pas etre detecte ;
- aucune metrique de facturation detaillee n'a ete exportee ; les priorites de cout sont fondees sur les ressources, cadences et executions observees ;
- les logs Cloud Run n'ont pas ete utilises comme preuve de trafic, la requete de logs etant trop lente. Les dates et compteurs d'execution des jobs ont en revanche ete obtenus.

## 3. Inventaire cloud reel

### 3.1 Services HTTP

| Ressource | Etat observe | Runtime | Decision |
|---|---|---|---|
| `tradingviewwebhook` | actif, revision `00006` | Firebase Function Gen 2, Node 20, 256 MiB | Conserver |
| `tv-desk-front-api` | actif, role `front`, 512 MiB | image MCP/BFF | Conserver a court terme ; fusion possible avec le MCP |
| `tv-gpt-desk-mcp` | actif, role `mcp`, 512 MiB | image MCP/BFF | Conserver ; rendre stateless avant scale-to-zero |

`tv-gpt-desk-mcp` est configure avec `minScale=1`, `maxScale=1` et session affinity. Cette configuration est coherente avec la map de sessions en memoire actuelle, mais impose une instance chaude. Le gain de cout viendra d'un transport MCP stateless, puis de `minScale=0`.

### 3.2 Cloud Run Jobs

| Job | Entrypoint | Execution observee | Classification |
|---|---|---:|---|
| `tv-desk-cycle` | `run_desk_cloud.py` par CMD Docker | 1 390 ; derniere le 2026-07-14 | Actif, ancien moteur Python shadow |
| `tv-gpt-desk-live-cycle-asia` | `scripts/run_live_checkpoint_cycle.mjs --session asia_open` | 164 ; derniere le 2026-07-15 | Actif, logique actuelle |
| `tv-gpt-desk-live-cycle-ny` | `scripts/run_live_checkpoint_cycle.mjs --session ny_open` | 58 ; derniere le 2026-07-14 | Actif, logique actuelle |
| `tv-gpt-desk-pack-build` | `scripts/build_and_publish_firestore_pack.mjs` | 11 | Actif |
| `tv-gpt-desk-pack-build-ny` | meme builder, session NY | 3 | Actif |
| `tv-gpt-desk-replay-source-build` | meme builder, source replay | 2 | Actif |
| `tv-gpt-pack-builder` | ancien builder pack | 2 ; derniere le 2026-07-02 | Candidat suppression cloud |
| `tv-macro-news-update` | `run_macro_news_update.py` | 763 ; derniere le 2026-07-15 | Actif ; extraire dans un runtime mince |
| `tv-replay-worker` | `run_replay_cloud.py` | aucune execution exposee | Dormant ; scheduler en pause |
| `tv-system-workflow-worker` | `run_system_workflow_requests.py` | aucune execution exposee | Dormant ; scheduler en pause |

### 3.3 Schedulers

24 schedulers existent : 16 actifs et 8 en pause.

Schedulers en pause :

- `tv-desk-cycle-m5` ;
- `tv-replay-worker-poll` ;
- `tv-desk-cycle-eu-m15` ;
- `tv-desk-cycle-evening-m15` ;
- `tv-desk-evening-review` ;
- `tv-desk-master-cutoff-asia-0005` ;
- `tv-desk-cycle-preus-m15` ;
- `tv-system-workflow-worker-poll`.

Schedulers Python shadow encore actifs :

- `tv-desk-cycle-us-open-m5` ;
- `tv-desk-cycle-us-m5` ;
- `tv-desk-cycle-us-close-m5` ;
- `tv-desk-hourly-brief`.

Ils empechent de declarer `run_desk_cloud.py`, `run_desk.py` et leur fermeture `scanner/` comme historiques. Une decision explicite de cutover est necessaire.

## 4. Finding securite prioritaire

La configuration Cloud Run de `tv-gpt-desk-mcp` expose actuellement des secrets applicatifs comme variables d'environnement ordinaires, et non comme references Secret Manager. Les valeurs ne sont volontairement pas reproduites dans ce rapport.

Variables concernees observees :

- `DESK_MCP_API_KEY` ;
- `DESK_OAUTH_ADMIN_PIN` ;
- `DESK_OAUTH_TOKEN_SECRET`.

Action P0 :

1. faire une rotation des trois valeurs ;
2. les stocker dans Secret Manager ;
3. redeployer avec `--set-secrets` ;
4. verifier que les schedulers Master n'embarquent pas une ancienne cle en header ;
5. supprimer les anciennes revisions ou configurations qui conservent les valeurs obsoletes selon la politique de rollback retenue.

Autre risque operationnel : le projet `gcloud` par defaut local est `addzify-prod-20260617`, pas `tv-automation-23d50`. Les scripts de ce depot doivent continuer a fournir `--project tv-automation-23d50` explicitement.

## 5. Analyse du code Python

723 fichiers Python ont ete parcourus dans les racines applicatives et de test selectionnees.

### 5.1 Closure du cloud actif

Les deux entrypoints Python avec activite cloud recente sont :

- `run_desk_cloud.py` ;
- `run_macro_news_update.py`.

Leur closure statique contient 88 fichiers, dont 85 sous `scanner/`, et trois scripts racine :

- `run_desk_cloud.py` ;
- `run_desk.py` ;
- `run_macro_news_update.py`.

Zones `scanner/` fortement utilisees par le runtime actif :

- `scanner/desk` : 34 fichiers atteints sur 72 ;
- `scanner/session_analyst` : 25 sur 37 ;
- `scanner/live_data` : 10 sur 18 ;
- `scanner/core` : 4 sur 5 ;
- `scanner/data_source` : 3 sur 7 ;
- `scanner/replay` : 3 sur 20.

Conclusion : supprimer `scanner/` en bloc casserait le job Python shadow et le job macro/news. Le bon ordre est de decider le sort du shadow, puis d'extraire macro/news dans une petite fonction ou image dediee.

### 5.2 Closure des jobs en pause

Les jobs dormants atteignent encore :

- `run_replay_cloud.py` et `run_replay.py` ;
- `run_system_workflow_requests.py` ;
- une partie de `scanner/replay`, `scanner/system_startup`, `scanner/workflows` et `desk_server`.

Supprimer d'abord les ressources cloud dormantes permet ensuite de retirer ce sous-arbre avec une preuve plus forte.

### 5.3 Scripts racine sans reference de controle

55 scripts n'ont aucune reference detectee dans les deploiements, configs, tests ou sources de controle inspectes. Cela ne prouve pas qu'ils n'ont jamais ete lances manuellement, mais ils ne doivent plus rester des entrypoints de premier rang a la racine.

Familles a supprimer ou sortir dans un depot de recherche :

- `run_tvautomation_*` de walkforward, payout, benchmark et robustesse ;
- `run_debate_*`, `run_veto_policy_whatif.py`, `run_vote_outcome_audit.py` ;
- `run_post_entry_*` ;
- `run_ifvg_*` ;
- `run_trade_adjustment_audit.py` ;
- `run_replay_7days_real.py` ;
- anciens debug/smoke : `run_agent_lifecheck.py`, `run_data_debug.py`, `run_pipeline_test.py`, `run_precheck_debug.py`, `run_stability_test.py`.

Familles a deplacer sous `scripts/ops`, `scripts/migrations` ou `scripts/governance`, pas a supprimer immediatement :

- backfills Firestore et TradingView ;
- `run_aggregate_market_feed_timeframes.py` ;
- feature/level engine ;
- audits Firestore et snapshots ;
- gates `run_desk_v2_*` ;
- outils catalogue, plateforme et readiness.

## 6. Deux frontends dans `src/`

Le frontend deploye part de `src/main.tsx`, qui importe `src/App.tsx`.

Une seconde generation est encore presente mais explicitement exclue par `tsconfig.app.json` :

- `src/app/` ;
- `src/cockpit-v2/` ;
- `src/mocks/` ;
- `src/services/` ;
- `src/components/audit/` ;
- `src/components/layout/` ;
- `src/components/live/` ;
- `src/components/manual/` ;
- `src/components/master/` ;
- `src/components/monitor/` ;
- `src/components/nyopen/` ;
- `src/components/replay/`.

Ces chemins totalisent 31 fichiers. Ils ne sont pas atteints depuis `src/main.tsx` et sont exclus de la verification TypeScript. Ils constituent une premiere suppression a faible risque, sous reserve de conserver dans les contrats partages toute specification encore utile.

Deux autres fichiers ne sont pas atteints par le frontend courant :

- `src/contracts/frontProjection.ts`, remplace fonctionnellement par les contrats partages ;
- `src/styles/cockpit-v2.css`.

## 7. MCP et scripts Node

Les entrypoints deployes analyses sont :

- `mcp_gpt_desk/src/server.js` ;
- `mcp_gpt_desk/scripts/run_live_checkpoint_cycle.mjs` ;
- `mcp_gpt_desk/scripts/build_and_publish_firestore_pack.mjs`.

37 fichiers Node sont atteints depuis ces entrypoints.

Les modules suivants appartiennent uniquement aux outils manuels d'audit/migration identifies :

- `src/storage-isolation-audit.js` ;
- `src/storage-isolation-migration.js` ;
- les scripts `audit_*`, `migrate_*` et plusieurs backfills.

Ils peuvent rester dans `scripts/ops` ou `scripts/migrations`, mais ne devraient pas etre copies dans l'image runtime MCP. `pack-publisher-v2.js` doit rester tant que les outils de publication manuelle le consomment.

## 8. Archives, rapports et contexte Docker

### 8.1 Legacy

240 fichiers sont suivis sous `legacy/`. Les references actives trouvees visent uniquement :

- `scripts/check_t23_cleanup_quarantine.mjs` ;
- `scripts/final_cdc_conformance_gate.mjs` ;
- `tests/test_t23_cleanup_quarantine_gate.py`.

Le runtime ne depend donc pas de `legacy/`. Le repertoire peut etre retire de la branche principale apres remplacement des anciens gates T23 par un gate qui interdit les nouvelles references legacy.

### 8.2 Rapports et exports

- `reports/` : environ 15 MiB et 350 fichiers suivis ;
- `exports/` : environ 155 MiB dans le working tree ;
- `data/` : environ 158 MiB dans le working tree ;
- `legacy/` : environ 2,5 MiB.

Les rapports utilises comme fixtures ou manifests de validation doivent etre separes des rapports historiques. Proposition :

- `tests/fixtures/` pour les donnees necessaires aux tests ;
- Storage ou release Git pour les exports/reports historiques ;
- aucun export massif non suivi dans le contexte Docker.

### 8.3 Image Python

Le Dockerfile racine fait actuellement :

```dockerfile
COPY . /app
```

Le `.dockerignore` n'exclut pas explicitement `exports/`, `data/`, `legacy/`, la majorite de `reports/`, `tests/`, `docs/`, `src/` ou `mcp_gpt_desk/local_data/`. Une partie significative du working tree peut donc entrer dans le contexte de build et dans l'image Python alors qu'elle n'est pas utile au job.

Priorite haute : remplacer `COPY .` par une liste blanche des entrypoints, packages Python, configs et ressources effectivement necessaires.

## 9. Classification de suppression

### Vague A — faible risque, aucun cutover metier requis

1. Retirer le second frontend explicitement exclu de `tsconfig.app.json`.
2. Retirer `legacy/` apres mise a jour des trois gates qui l'exigent.
3. Deplacer les scripts governance/backfill/ops hors de la racine.
4. Sortir les familles recherche `run_tvautomation_*`, `run_debate_*`, `run_post_entry_*` et `run_ifvg_*` de la branche runtime.
5. Externaliser les rapports et exports historiques ; conserver uniquement les fixtures referencees.
6. Remplacer le contexte Docker Python global par une liste blanche.
7. Exclure les scripts MCP de migration/audit de l'image serveur.

### Vague B — decommission cloud dormant

Apres export des configurations et smoke test :

1. supprimer le scheduler en pause et le job `tv-replay-worker` si le replay MCP actuel est la seule voie retenue ;
2. supprimer le scheduler en pause et le job `tv-system-workflow-worker` si les commandes operateur MCP/BFF le remplacent ;
3. supprimer l'ancien job `tv-gpt-pack-builder`, non cible par les schedulers inventories et inactif depuis le 2 juillet ;
4. nettoyer les images Artifact Registry devenues orphelines avec une politique de retention.

### Vague C — decision de cutover Python shadow

Si le Desk GPT/MCP devient l'unique logique :

1. pauser les quatre schedulers Python shadow encore actifs ;
2. observer une semaine complete de sessions Asia/NY avec alerting ;
3. verifier qu'aucune projection, alerte ou position utile ne depend de `tv-desk-cycle` ;
4. supprimer `tv-desk-cycle` ;
5. extraire `tv-macro-news-update` dans une Firebase Function ou une image Python minimale ;
6. recalculer la closure Python ;
7. supprimer `run_desk_cloud.py`, `run_desk.py` et les modules `scanner/` devenus inatteignables.

Tant que cette vague n'est pas decidee, la suppression du moteur Python est bloquee par une preuve d'activite production.

## 10. Architecture cible apres nettoyage

```text
src/                         frontend React unique
firebase/functions/          webhook TradingView
mcp_gpt_desk/src/            MCP + BFF
mcp_gpt_desk/scripts/jobs/   jobs Live et packs deployes
packages/                    contrats, domaine, adapters, replay
apps/macro-news/             petit runtime dedie si Python conserve
scripts/ops/                 operations manuelles
scripts/migrations/          backfills bornes
scripts/governance/          gates CI
tests/fixtures/              seules donnees versionnees requises
docs/current/                documentation active
```

Absents de la cible :

- second frontend ;
- archives legacy dans la branche principale ;
- 100+ runners a la racine ;
- rapports de runs versionnes en masse ;
- jobs cloud sans scheduler ni execution ;
- image Python construite avec tout le monorepo.

## 11. Ordre d'execution recommande

Les phases P0 a P3 ci-dessous appartiennent toutes au chantier **Nettoyage et stabilisation**. Elles ne comprennent ni provisionnement OVH, ni migration Firestore/PostgreSQL, ni basculement DNS ou de trafic.

### P0 — securite et manifeste

1. rotation et migration Secret Manager des secrets MCP ;
2. creation d'un manifeste unique des ressources runtime actives ;
3. ajout d'un gate CI refusant tout entrypoint non declare.

### P1 — PR de nettoyage sans changement fonctionnel

1. second frontend ;
2. legacy et anciens gates T23 ;
3. scripts recherche ;
4. rangement ops/migrations/governance ;
5. Dockerfiles en liste blanche ;
6. rapports/exports hors contexte.

### P2 — ressources cloud dormantes

1. ancien pack builder ;
2. replay worker Python ;
3. system workflow worker ;
4. schedulers en pause devenus inutiles ;
5. images orphelines.

### P3 — cutover moteur

Choisir explicitement entre le Desk GPT/MCP et le committee Python shadow. La recommandation de cet audit, compte tenu de l'evolution actuelle du produit, est de promouvoir le Desk GPT/MCP comme voie unique puis de decommissionner le shadow Python apres une fenetre d'observation.

## 12. Gates avant toute suppression

La future PR de nettoyage devra au minimum executer :

```bash
npm run typecheck
npm run build
npm run test:react
npm --prefix firebase/functions test
npm --prefix mcp_gpt_desk test
npm --prefix packages/desk-domain test
npm --prefix packages/desk-firebase-adapter test
npm --prefix packages/desk-replay-engine test
pytest -q
node scripts/final_cdc_conformance_gate.mjs
```

Ajouter ensuite :

- build de l'image MCP ;
- build de l'image Python minimale ;
- smoke `/status`, `/mcp` et `/api/v1/live-desk/current` ;
- smoke d'un checkpoint Asia et NY sans ecriture broker ;
- verification des schedulers et jobs par manifeste.

## 13. Decision finale de l'audit

Statut : `GO_PAR_VAGUES`.

- `GO` immediat pour la vague A dans une PR dediee et testee.
- `GO` conditionnel pour la vague B apres confirmation fonctionnelle du replay et des commandes operateur actuelles.
- `NO-GO` pour supprimer le moteur Python tant que ses schedulers actifs ne sont pas pauses et que le cutover GPT/MCP n'est pas valide.

La migration OVH ne commence pas dans ce chantier. Son gate d'entree est une baseline fonctionnelle stabilisee, un manifeste des runtimes conserves et une decision explicite sur le moteur Python shadow. Les travaux preparatoires sans impact production, comme l'estimation des couts et la conception du schema PostgreSQL, peuvent etre menes separement.
