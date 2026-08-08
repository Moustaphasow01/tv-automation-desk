# 25 — Convergence du plan directeur initial avec la cible vérifiée

- **Statut** : `CANONIQUE`
- **Version** : `1.0.0`
- **Date** : 2026-08-08
- **Source** : plan directeur initial de 33 sections fourni par l'opérateur, rapproché du code PREPROD et du blueprint Claude
- **Backlog résultant** : `24-CORRECTED-IMPLEMENTATION-BACKLOG-V2.md` version 2.1.0 et `implementation-backlog-v2.yaml` version 2.1.0

## 1. Conclusion

Le plan directeur initial décrit correctement la vision finale. Il est plus profond que le premier backlog sur quatre axes : recherche scientifique, simulation réaliste, scalabilité des calculs et remplacement progressif de NinjaTrader par PickMyTrade.

Il mélange cependant destination et choix techniques hypothétiques. La cible consolidée conserve ses exigences métier sans imposer immédiatement Spring Boot, Kafka, Redis, TimescaleDB ou une réécriture Python du moteur canonique.

## 2. Matrice d'existence vérifiée

### Déjà présent et réutilisable

- Backend Node.js, PostgreSQL, API REST/MCP et front React.
- Contrats versionnés, plans typés, compilateurs et prédicats déterministes.
- Risk gates, state machines Setup/Position et anti-lookahead.
- Services Windows permanents et worker Codex réveillé sur travail durable.
- `codex exec resume`, identité de conversation, rotation bornée et continuité backend.
- Politique d'analyse choisissant déjà un profil et un niveau de raisonnement selon Master/Monitor/état critique.
- PostgreSQL outbox/claims, advisory locks, `LISTEN/NOTIFY` et polling de secours.
- NinjaTrader AddOn, ordres, fills, gestion de position et réconciliation manuelle.
- Replay GPT-in-the-loop et outcome replayer déterministe.

### Présent partiellement

- Data Foundation : bougies et packs existent, mais historique, provenance et acquisition ne forment pas encore un Dataset Registry scientifique complet.
- Simulation : l'outcome replayer sait évaluer l'issue d'un setup et les ambiguïtés de bougie, mais ne simule pas encore un portefeuille événementiel multi-stratégie avec carnet d'ordres réaliste.
- Agent Runtime : continuité et réveil existent pour les pipelines du desk, mais pas encore le modèle générique Mission/Batch/Task/Event multi-rôle.
- Model routing : le raisonnement s'adapte déjà au workflow, mais il manque le routage versionné par rôle, coût, criticité, SLA et modèle.
- Events : transport durable disponible, mais enveloppe métier et catalogue d'événements incomplets.
- Front/API : console riche existante, mais projection encore liée au vocabulaire V4/V5 et API v2 cible incomplète.

### Absent à construire

- Strategy Definition/Version/Instance relationnelles et leur lifecycle complet.
- Dataset/Feature/Run/Experiment registries canoniques.
- Strategy DSL général et full Event-Driven Simulation Engine.
- Order Simulator réaliste et Robustness Engine.
- Research Lab scientifique, taxonomie d'agents, mémoire négative, génome et déduplication.
- Scheduler compute et pools de workers scalables.
- Live Runtime multi-stratégie, Portfolio Arbitration, Global Risk et Broker Netting.
- AI Context Decision Gate évalué en shadow.
- Execution Gateway provider-neutral et adaptateur PickMyTrade.
- Contrat API stable destiné au futur Front V3.

## 3. Architecture technique consolidée

```text
                           CONTROL PLANE
  React transition UI / Future Front V3
                 │ REST v2 + SSE/WebSocket + MCP scopes
                 ▼
  Node.js API + PostgreSQL + Agent Runtime + Audit/Event Outbox
                 │                         │
                 │ task/event contracts    │ Strategy/Signal/Order contracts
                 ▼                         ▼
             COMPUTE PLANE              TRADING PLANE
  Python workers quantitatifs        Canonical Strategy Runtime
  datasets / statistics /            Portfolio Arbitration
  walk-forward / bootstrap /         Global Risk + Broker Netting
  Monte-Carlo / optimisation         Execution Gateway
          │                               ├─ NinjaTrader adapter (transition)
          └─ artifacts/hash               ├─ PickMyTrade adapter (candidat)
                                          └─ Direct broker adapter (futur)
```

### Control plane

Le backend actuel reste propriétaire des identités, états, contrats, permissions, événements, audit et transitions. Le front actuel et le futur Front V3 ne lisent jamais directement les tables ou `desk_documents`.

### Compute plane

Python est retenu pour les calculs lourds et bibliothèques quantitatives. Un worker Python reçoit un `DatasetRef`, une `StrategyVersionRef`, une politique de simulation et un budget. Il retourne des artifacts scellés. Il n'invente pas une seconde logique d'entrée/sortie différente du Canonical Runtime.

### Event transport

PostgreSQL outbox + `LISTEN/NOTIFY` est le premier bus. Les contrats permettent une migration future vers RabbitMQ/Kafka/Redis Streams sans changer les événements métier. L'autoscaling est un objectif de contrat ; il ne justifie pas d'ajouter une infrastructure distribuée avant mesure.

## 4. Processus scientifique obligatoire

Chaque mission de recherche porte : question falsifiable, instrument, timeframe, population, variables, résultat attendu, invalidation, budget tokens/compute/temps et critères d'arrêt.

La séquence minimale est :

```text
Hypothesis
→ Baseline simple
→ Train run
→ Validation run
→ Out-of-sample
→ Walk-forward
→ Stress coûts/slippage
→ Bootstrap/Monte-Carlo
→ Revue contradictoire
→ Promotion, révision, attente ou rejet
```

Une seule modification principale est autorisée par itération. Les échecs, paramètres instables et résultats négatifs sont conservés et recherchables.

## 5. Taxonomie d'agents cible

| Rôle | Responsabilité | Profil d'inférence initial |
|---|---|---|
| Research Planner | couverture et priorité des missions | `STANDARD_RESEARCH` |
| Pattern Miner | relations statistiques et hypothèses | compute Python + `STANDARD_RESEARCH` |
| Strategy Builder | Strategy Specification structurée | `DEEP_STRATEGY_REVIEW` |
| Experiment Agent | batches et itérations contrôlées | `STANDARD_RESEARCH` |
| Backtest Validator | cohérence, seuils et fuite temporelle | `SAFETY_REVIEW` |
| Robustness Auditor | stress et tentative de réfutation | compute Python + `DEEP_STRATEGY_REVIEW` |
| Regime Analyst | segmentation volatilité/tendance/macro | compute Python + `STANDARD_RESEARCH` |
| Research Reviewer | promotion/révision/rejet | `SAFETY_REVIEW` |
| Live Performance Monitor | dérive live/historique | `CONTEXT_DECISION` |

Chaque rôle reçoit des permissions MCP minimales. Un agent de recherche ne peut pas appeler une capacité d'exécution broker.

## 6. PickMyTrade consolidé

PickMyTrade est le candidat cloud identifié pour router vers Rithmic ou Tradovate et potentiellement gérer plusieurs comptes. Il reste derrière l'Execution Gateway.

La due diligence doit prouver avant tout pilote :

- API backend-to-backend officiellement supportée sans TradingView ;
- authentification et rotation des secrets ;
- callbacks et statut broker fiable ;
- clés d'idempotence et comportement après timeout ;
- brackets, stops, targets, trailing, cancel/replace/reverse et partial fills ;
- multi-compte et compatibilité exacte Apex/Rithmic ;
- contraintes de sessions Rithmic ;
- symbol mapping et rollover ;
- rate limits, SLA, journaux et coûts.

Le parcours reste : démo → PAPER → shadow comparison → risque minimal → provider principal éventuel. NinjaTrader reste disponible comme secours jusqu'à certification et rollback. Le fallback n'est autorisé qu'après preuve certaine qu'un ordre n'existe pas chez le premier provider.

## 7. Stockage et scalabilité

- PostgreSQL reste la source de vérité transactionnelle.
- Parquet/object storage est la cible des datasets bruts/figés volumineux après définition des besoins.
- TimescaleDB n'est activé que si les benchmarks de séries chaudes le justifient.
- Redis n'est pas une source de vérité et n'est ajouté que pour un besoin mesuré de cache/coordination.
- Les workers doivent rester stateless autant que possible ; Missions, Tasks, Runs et artifacts restent persistés.
- Le scheduler impose la priorité `Execution > Risk > Live > Monitoring > Validation > Research` et des quotas CPU/RAM/tokens/temps.

## 8. Front et surfaces d'intégration

Le front React actuel accompagne chaque vertical slice et reste la console opérateur. La future refonte complète n'est lancée qu'une fois les capacités backend stabilisées.

Les frontières destinées au Front V3 sont construites dès maintenant :

- REST `/api/v2` pour ressources et commandes ;
- SSE/WebSocket pour événements avec cursor et reprise ;
- OpenAPI versionné et politique de dépréciation ;
- auth scopes lecture/opérateur/automation ;
- MCP séparé par domaines research/data/live/execution/admin ;
- aucune dépendance client à une collection historique ou à une version V4/V5.

## 9. Décisions différées, pas oublis

Les éléments suivants restent à décider au moment de leur phase : volume d'historique à acheter/importer, disponibilité ticks/bid-ask, stockage objet concret, fréquence de réconciliation, seuils de robustesse, métrique de promotion, provider PickMyTrade après due diligence, nombre de comptes et règles prop firm finales.

Ils sont représentés par des tickets et des gates ; ils ne doivent pas être remplacés par des hypothèses silencieuses.
