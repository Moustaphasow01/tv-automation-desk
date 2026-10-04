# Desk Intelligence — premier lot exécutable

## État réel de livraison

Le lot implémente observation → diagnostic → familles → hypothèses → recherche de contre-exemples → critique indépendante → dossier de recherche/protocole. Un runner autonome borné peut avancer ce cycle et reprendre les checkpoints. Il n'exécute aucune expérience, ne promeut aucun challenger et ne modifie aucun champion.

**Non déployé et non activé sur le VPS dans ce lot.** Aucune migration de production appliquée. Aucun audit LLM exhaustif du corpus de juillet–août annoncé comme achevé. Le catalogue public existant reste inchangé ; le test local MCP prouve 47 outils sans activation, 53 avec les six outils de recherche explicitement injectés.

## Intégration et fichiers

| Propriétaire | Fichiers | Rôle |
|---|---|---|
| research/domain | `packages/desk-oos-research/src/domain/*.js` | preuves, audits A–G, cinq couches, features disponibles, familles structurelles, cohortes, gates walk-forward, schémas de sorties et hash canonique |
| research/application | `packages/desk-oos-research/src/application/*.js` | observation paginée, cycle/reprises, appels modèle comptabilisés, hypothèses/critique/protocoles, API et runner borné |
| research/adapter | `packages/desk-oos-research/src/adapter/postgres-research-memory.js` | transactions, révisions, snapshots immuables, pagination, verrou exclusif de cycle |
| research/storage | `infra/postgres/init/075_oos_research_memory.sql` | 11 tables additives ; triggers d'immutabilité ; aucun changement OOS |
| host | `mcp_gpt_desk/src/oos-research-{host,runtime,model,capabilities,tools}.js` | composition, deux credentials DB, découverte réelle des modèles, transport subprocess sans outils métier, OAuth scopes existants |
| host | `mcp_gpt_desk/src/oos-mcp-server.js`, `oos-http-server.js`, `scripts/serve_oos.mjs` | enregistrement et activation optionnels, aucune mutation des contrats OOS |
| operations | `mcp_gpt_desk/scripts/run_oos_research.mjs` | start/advance/run/status/artifacts/scorecard/experiment, sans TradingView |
| quality | nouveaux tests du package et `mcp_gpt_desk/test/oos_research_*.test.js` | preuves, contre-revue, transport MCP, permissions et sélection de modèles |

Les manifests, plans, captures, ENGINE, parser SMC3, résultats et anciens prompts analytiques ne sont pas édités. Les sorties de tests sont synthétiques et ne deviennent jamais données de marché.

## Configuration avant activation

1. Appliquer 075 par le mécanisme de migration existant dans un environnement de recherche. La migration est additive et rejouable.
2. Provisionner les rôles selon les permissions commentées dans 075. Le lecteur a SELECT sur le corpus OOS, aucun INSERT/UPDATE/DELETE. Le writer n'a que SELECT/INSERT recherche et UPDATE limité aux colonnes de checkpoint des cycles. Aucun superuser, CREATEROLE, ownership de tables métier ou rôle hérité permettant de modifier OOS.
3. Injecter les secrets uniquement par environnement : `OOS_RESEARCH_DATABASE_URL`, `OOS_FORENSIC_DATABASE_URL`. Ne pas réutiliser l'identité DB d'exécution.
4. Indiquer `archive_root`, `index_root` (défaut : `archive_root/forensic-index-v2`) et `model.codex_bin`. La découverte utilise initialize → initialized → model/list ; elle ne lance aucune inférence. Astra est préféré s'il est réellement disponible avec xhigh ; sinon une préférence explicitement configurée doit être disponible.
5. Pour le serveur existant, `research_enabled=true` et `research.model` activent les tools. Sans ce flag, aucun changement de catalogue. Aucun nouveau service obligatoire ni endpoint REST.

Exemple de configuration non secrète pour le CLI :

```json
{
  "archive_root": "/chemin/du/corpus/oos",
  "model": {
    "codex_bin": "/chemin/codex",
    "timeout_ms": 780000,
    "discovery_timeout_ms": 60000,
    "model_priority": ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol"]
  }
}
```

Une preuve de capabilities datée peut encore être fournie via `model.capabilities_file`, option contrôlée par exploitation. Sans fichier, la découverte est automatique. Une preuve périmée, mal datée ou un catalogue incomplet bloque. Le classement est une préférence explicite, pas une mesure scientifique des performances des modèles. Les métadonnées du transport CLI identifient le modèle demandé, pas une attestation du modèle interne du fournisseur.

## Lancement et reprise

`OOS_RESEARCH_CONFIG` désigne cette configuration. Après installation des dépendances du host :

```bash
node mcp_gpt_desk/scripts/run_oos_research.mjs start '{"dates":["2026-07-02"],"budget":{"maximum_model_calls":50}}'
node mcp_gpt_desk/scripts/run_oos_research.mjs run '{"cycle_id":"<SHA-256 retourné>","maximum_steps":1000,"maximum_cases":1}'
node mcp_gpt_desk/scripts/run_oos_research.mjs status '{"cycle_id":"<SHA-256 retourné>"}'
node mcp_gpt_desk/scripts/run_oos_research.mjs artifacts '{"cycle_id":"<SHA-256 retourné>","kind":"scenario_audit","limit":50}'
```

Choisir le budget en connaissant le nombre total de tentatives : tous les scénarios sont conservés. Les limites portent sur les appels par lot, jamais sur le nombre de scénarios du plan. La comparaison inter-cas est chunkée, chaque proposition est ensuite confrontée à tous les audits du cycle, y compris les contre-exemples. Le runner termine au dossier COMPLETED, à son budget technique ou à un blocage ; jamais de retry infini.

Tools ajoutés si activation explicite :

- `start_research_cycle` — desk.write ; définition/pins de recherche.
- `advance_research_cycle` — desk.write ; étape bornée, éventuellement inférence payée.
- `get_research_status` — desk.read ; checkpoint, budget et nombre de propositions, y compris sans support.
- `get_research_artifacts` — desk.read ; audits, findings, familles, hypothèses, critiques, protocoles paginés.
- `get_research_scorecard` — desk.read ; agrégats de REAL publiés et cohortes descriptives.
- `register_research_experiment` — desk.write ; protocole seulement, aucune exécution.

Le READ corpus est limité à huit fonctions forensic publiques. Aucun objet de commandes OOS n'est transmis au domaine/application. Les événements portent le namespace T3_RESEARCH et restent dans ces tables, pas dans le bus métier.

## Sémantique scientifique

- Chaque scénario et chaque attempt est audité, même sans confirmation ; absence d'événement n'est pas preuve de condition fausse.
- Les questions A–G sont obligatoires. HTF/biais/rationale historiques non persistés restent NOT_PERSISTED, pas reconstruits a posteriori.
- Features dérivées uniquement de records/événements publiés. Une hypothèse ne peut injecter ses propres cas ni remplacer les trades.
- Supports/contre-exemples/winners sont des IDs citables ; corrélation dans la même journée visible. Les winners exposés à un prédicat ne sont pas déclarés supprimés par un challenger non exécuté.
- No-trade n'est pas classé GOOD_SELECTIVITY sans preuve. Un loser n'est pas automatiquement management failure.
- Les familles sont des signatures structurelles exactes, pas une équivalence causale entre opportunités.
- Juillet–août déjà étudié = DISCOVERY. Validation/test doivent être ultérieurs, disjoints et absents du corpus exposé.
- Le protocole préenregistre métrique, arrêt, contrôle de multiplicité. Aucune p-value ou validation d'edge n'est calculée dans ce lot. Une critique favorable autorise au plus la préparation d'une expérience.
- Expectancy/PF/distribution et DD de trades clôturés agrègent REAL publié. Les sorties absentes ne valent pas zéro ; métriques incomplètes explicitement marquées. Coût d'opportunité, DD d'equity, catégories de régime et PATH_ALIGNMENT_SCORE restent indisponibles sans données/rubrique préalable.

## Blocages et traitement

| Code | Comportement |
|---|---|
| RESEARCH_CORPUS_DRIFT / RESEARCH_MODEL_DRIFT | arrêt ; nouvelle version/cycle requis, aucun mélange |
| RESEARCH_MODEL_NOT_CONFIGURED / DISCOVERY_UNAVAILABLE | données persistées conservées ; config manquante visible |
| RESEARCH_BUDGET_EXHAUSTED | arrêt ; pas de nouvel appel payé automatique |
| RESEARCH_MODEL_REQUEST_INDETERMINATE | arrêt fail-closed ; inspecter le request journal, ne pas payer deux fois un résultat incertain |
| RESEARCH_SOURCE_INTEGRITY_FAILED / EPISODE_COVERAGE_MISMATCH | ne pas produire un audit complet fictif |
| RESEARCH_HOLDOUT_CONTAMINATED | protocole refusé, aucune adaptation pour transformer discovery en OOS |
| RESEARCH_DATABASE_ROLE_NOT_ISOLATED | activation refusée avant toute recherche |

Un crash entre réponse modèle et commit nécessite une procédure explicite de récupération du résultat, non fournie dans ce lot. Ce refus est volontaire ; recréer automatiquement la requête ferait disparaître la trace d'incertitude.

## Validation exécutée

Tests dédiés : audit >5 scénarios/toutes tentatives, données inconnues, exclusion smoke/gap, absence de futurs prix, hash/idempotence (y compris ordre de clés JSON), budget/requêtes incertaines, modèle réellement exposé, critique séparée, protocoles sans exécuteur, cycle autonome borné complet. Tests MCP locaux : 47→53 uniquement si activation, scopes et champs inconnus rejetés. Tests PostgreSQL 16 réel en instance temporaire : migration rejouable, concurrence, rollback, immutabilité, rôles physiques (63 tests passés). Aucun serveur de marché ni replay n'est utilisé par ces tests.

Dernière suite dédiée : **108/108 PASS**, zéro skip, PostgreSQL réel inclus. Suite de non-régression OOS/contrats : **81/81 PASS**. Le transport de découverte réel a annoncé Astra avec xhigh ; la contre-revue Astra a été effectuée dans le harness. L'inférence du rôle de recherche déployé sur VPS n'a pas été testée.

Guards architecture et migrations PASS. Contrôle ciblé des nouveaux modules : aucun fichier >600 lignes, aucune fonction >60 lignes ou complexité >15. Guard statique global FAIL sur `front-session-projection.js` et budgets globaux du dépôt ; aucune baseline affaiblie, aucun fichier de trading modifié pour le contourner.

## Reste à livrer pour l'objectif 49–80 complet

| Lot | État |
|---|---|
| mémoire/audits/features accessibles/familles/cohortes/contre-exemples/critique/runner | implémenté, tests locaux ; production OFF |
| ingestion de la justification du Scenario Builder lors de prochains cycles | à définir, jamais rétro-inventée sur les plans historiques |
| analyse visuelle profonde des PREMARKET et panels par modèle | non raccordée à ce premier port de recherche textuel |
| temporalité détaillée, rearm, portfolio et qualité des données | partiellement accessible dans les snapshots, rubriques causales à étendre |
| régimes point-in-time / path score / graphe causal | bloqué sans définitions préenregistrées et données suffisantes ; pas d'estimation |
| lifecycle complet hypothèses VALIDATED/FAILED et findings résolus | versions/reviews à ajouter, pas de mutation historique |
| challenger scorecard / exécution SHADOW / walk-forward roulant | futur module expérimental, jeux non contaminés requis |
| contrôle statistique des découvertes multiples | déclaration/comptage implémentés ; test statistique non implémenté |
| worker permanent supervisé / UI recherche / déploiement VPS | non réalisés dans ce lot |

Rollback : mettre `research_enabled=false`, arrêter le runner, conserver la mémoire. Ne jamais effacer les tables pour revenir au champion : celui-ci n'a pas changé. Rentabilité future non garantie.
