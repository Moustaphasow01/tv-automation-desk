# Desk Control Plane V2 — Audit backend → frontend, composants et hardcoding

**Date :** 13 août 2026
**Méthode :** inspection du code, des contrats, des réponses BFF locales et des références visuelles stockées dans le repository.
**Classification :** 🔴 critique · 🟠 important · 🟡 amélioration · 🟢 correct.

---

## 1. Preuves structurantes

| Preuve | Fichier | Constat | Impact |
| --- | --- | --- | --- |
| 24 routes déclarées | `apps/desk-control-plane/src/app/routes.ts:23` | Bon inventaire, métadonnées utiles. | 🟢 Base de registry exploitable. |
| Routing en ternaires | `apps/desk-control-plane/src/app/App.tsx:41` | Toutes les pages importées et sélectionnées manuellement. | 🟠 Couplage, bundle initial, oubli probable à chaque ajout. |
| Sidebar indépendante | `apps/desk-control-plane/src/shell/DeskShell.tsx:34` | 13 liens en dur, sans réutiliser `vnextRoutes`. | 🟠 Deux sources de vérité, routes invisibles. |
| Mobile tronqué | `DeskShell.tsx:153` | `deskNavItems.slice(0, 5)`. | 🔴 La majorité du produit est inaccessible sur mobile. |
| Permission statique | `domains/permissions/PermissionGate.tsx:8` | Toutes les capacités de lecture sont allowlistées côté client. | 🔴 RBAC affiché non réel. |
| Query sans paramètres | `domains/front-api/repositories.ts:93` | Query key et requête ne prennent que `viewName`. | 🔴 Détails/filters/IDs impossibles. |
| Mock embarqué | `shared/transport.ts:4` | Dataset massif importé statiquement. | 🟠 Bundle, confusion de capacité, séparation test/prod faible. |
| Transport BFF simple | `shared/transport.ts:65` | Timeout et contrat présents. | 🟢 Bonne fondation ; manque erreurs typées/retry/query params. |
| Onze sources/vue | `mcp_gpt_desk/src/front-control-plane-api.js:120` | Toutes les sources sont chargées pour chaque vue. | 🔴 Latence, couplage et propagation des pannes. |
| Faux arbitrage/risk | `front-control-plane-api.js:235` | `ACCEPTED`, quantité 0 et `PASS` générés. | 🔴 Trompe l'opérateur. |
| Portfolio à zéro | `front-control-plane-api.js:249` | Equity, exposure, attribution, matrix utilisent des zéros/vides. | 🔴 Zéro réel impossible à distinguer d'absence. |
| Events coquille vide | `front-control-plane-api.js:325` | Vue structurée mais aucune donnée. | 🟠 Écran non exploitable. |
| IDs aléatoires | ex. `front-control-plane-api.js:256,313,320` | `randomUUID()` utilisé en fallback. | 🔴 Identités instables, cache et navigation cassés. |
| Commandes acceptées | `front-control-plane-command.js:3` | Toute commande produit un reçu/audit. | 🟠 Bonne base d'idempotence et audit. |
| Une mutation réelle | `front-control-plane-command.js:78` | Seul `research.bootstrap_demo_paper` a un plan. | 🔴 Les autres actions ne changent rien. |
| `ACCEPTED` affiché comme retour | plusieurs pages, ex. `OrdersPage.tsx:208` | L'UI met en avant le reçu initial. | 🔴 Confusion reçu/succès métier. |
| Drawer incomplet | `design-system/actions.tsx:30` | Pas de fermeture, focus trap, role dialog ni restauration focus. | 🟠 Accessibilité et interaction. |
| Table passive | `design-system/data.tsx:12` | Pas de caption, sort, filters, pagination, selection ou row link. | 🟠 Tous les écrans de données réimplémenteront ces besoins. |
| Action inerte | `design-system/workspace.tsx:24` | `InlineAction` ne reçoit aucun handler. | 🔴 Affordance mensongère. |
| CSS monolithique | `design-system/styles.css` | 9 666 lignes, plusieurs racines/shells, nombreuses règles `nth-child`. | 🟠 Régression et personnalisation difficiles. |
| Densité explicite | `shell/DeskDensityViewport.tsx` | Préférence auto/native/workstation persistée. | 🟢 Bonne correction locale ; compensation zoom à sécuriser pour a11y. |

---

## 2. Architecture et maintenabilité

### 🔴 Critique

#### Détails non adressables

**Constat :** les pages `StrategyDetail`, `StrategyCompare`, `ResearchExperimentDetail`, `ResearchRunDetail` et `LiveSignalDetail` lisent un paramètre de route mais `useFrontView` ne l'envoie pas. Les builders BFF de détail ne disposent donc pas de l'objet demandé.

**Conséquence :** URL apparemment partageable, mais réponse indépendante de l'ID ; sélection, cache et sécurité d'objet incorrects.

**Correction :** endpoints typés par entité, query keys `['strategy', id]`, validation d'ID, 404/403 réels, liens HAL ou `related` vers les objets associés.

#### État de vérité indéterminé

**Constat :** `number(x, 0)`, tableaux vides, PASS et statuts synthétiques transforment l'absence de capability en donnée de production.

**Conséquence :** une limite absente peut sembler inutilisée, une corrélation inconnue peut sembler nulle, un signal non arbitré peut sembler accepté.

**Correction :** union discriminée :

```ts
type DataValue<T> =
  | { state: 'KNOWN'; value: T; asOf: string; source: string }
  | { state: 'UNKNOWN'; reason: string }
  | { state: 'UNAVAILABLE'; source: string; lastKnownAt?: string }
  | { state: 'NOT_APPLICABLE'; reason: string };
```

#### Command runtime sans terminal métier

**Constat :** le BFF persiste `ACCEPTED`, mais la mutation est `NONE` pour presque tous les command types.

**Conséquence :** les confirmations UI ne correspondent pas à une action réalisée.

**Correction :** capability registry, rejet 501/422 d'une commande non implémentée, état terminal événementiel, relecture de la ressource, audit de résultat et non seulement d'intention.

### 🟠 Important

- `viewModels.ts` doit être scindé par feature ; chaque mapper est testé contre DTO partiel/inconnu.
- les routes doivent être lazy-loadées et déclarées par modules.
- le BFF doit utiliser un loader par vue et des timeouts/budgets distincts, avec circuit breakers.
- les filtres/périodes/tri/pagination doivent être transmis et vivre dans l'URL.
- le mock doit être chargé dynamiquement uniquement en test/demo et subdivisé par scénario.
- CSS : tokens → primitives → layouts → features ; supprimer les règles basées sur l'ordre `nth-child`.

### 🟢 Correct à préserver

- aucune lecture directe PostgreSQL/MCP/broker depuis le frontend ;
- React Query comme cache serveur ;
- validation de l'enveloppe BFF ;
- idempotency et correlation IDs déjà introduits ;
- SSE avec reprise par cursor amorcé ;
- séparation visuelle des tons et direction compacte.

---

## 3. Audit du hardcoding

| Niveau | Élément | Localisation | Problème | Stratégie |
| --- | --- | --- | --- | --- |
| 🔴 | Prix ESM5/NQM5/CLN5 | `DeskShell.tsx:50` | Prix visibles comme marché réel. | Tape API réelle ; masquer si indisponible ; symbole configuré. |
| 🔴 | Environnement `LIVE` | `DeskShell.tsx:91` | Peut contredire le runtime PAPER/MOCK. | Session/environment context autoritaire. |
| 🔴 | Utilisateur Alexandre Martin | `DeskShell.tsx:128` | Identité fictive en shell. | Auth session ; fallback anonyme explicite. |
| 🔴 | Notifications 12/2 | `DeskShell.tsx:126` | Badges fictifs. | Notification API ou masquage. |
| 🔴 | Capabilities toujours admises | `PermissionGate.tsx:8` | Contrôle d'accès non effectif. | Capabilities session/catalogue côté serveur. |
| 🔴 | Faux résultats `PASS/ACCEPTED` | `front-control-plane-api.js:235` | Mensonge opérationnel. | Statut unknown/unsupported et données canoniques. |
| 🔴 | Identités `randomUUID()` | multiples projections BFF | Changement à chaque lecture. | Exiger ID canonique ou rejeter/flagger la ligne. |
| 🔴 | Inline actions sans handler | `workspace.tsx:24` | Bouton trompeur. | Composant lien/bouton typé qui exige `to` ou `onAction`. |
| 🟠 | Version `v2.4.1`, ©2025 | `DeskShell.tsx:100` | Désynchronisée de la release. | Build metadata/runtime config. |
| 🟠 | Timezone Europe/Paris | shell/projections | Peut être valable par défaut mais non personnalisée. | Préférence utilisateur + timezone desk canonique. |
| 🟠 | Session Asia/NY dérivée en binaire | `front-control-plane-api.js:228` | Ignore session continue/full-day et autres phases. | Session calendar backend. |
| 🟠 | Pools compute et capacités | `front-control-plane-api.js:487` | 2 vCPU/4 GB fabriqués. | Scheduler/host metrics réels. |
| 🟠 | Lookahead PASS/gaps 0 | `front-control-plane-api.js:483` | Qualité non calculée. | Quality report versionné et daté. |
| 🟠 | Mock de 4 894 lignes | `mocks/canonicalDataset.ts` | Décrit des capacités non implémentées. | Fixtures par use case + capability manifest. |
| 🟡 | Libellés métier dispersés | pages + projection | Traduction/nomenclature divergent. | Lexique + i18n/message catalog. |
| 🟡 | Tailles de colonnes par page/nth-child | fin de `styles.css` | Fragile à l'ordre du DOM. | Column metadata et CSS grid/table primitives. |
| 🟢 | Data mode mock explicite | `createDeskTransport` | Le mock n'est pas le défaut implicite. | Conserver, ajouter bannière et build exclusion. |

---

## 4. Audit des composants

| Composant actuel | État | Limite | Cible |
| --- | --- | --- | --- |
| `Card`, `KpiCard` | 🟡 | Présentation sans contrat provenance/drill-down. | `MetricCard` exige unit/période/asOf/source/action/state. |
| `StatusBadge` | 🟡 | Tons visuels mais sémantique métier dispersée. | Status registry par domaine + icon/label non-color. |
| `DataFreshnessBanner` | 🟢 | Bonne primitive. | Étendre à partial/disconnected/last-known. |
| `ProgressBar`, `Gauge` | 🟡 | Usage parfois décoratif. | Valeur, borne, seuil, label accessible et source requis. |
| `Sparkline` | 🟡 | Pas d'axes/tooltip/description. | AccessibleSparkline + drilldown ; chart complet ailleurs. |
| `DataTable` | 🟠 | Rendu passif seulement. | Sort/filter/pagination/selection/row navigation/caption/virtualization. |
| `MobileDataList` | 🟡 | Empilage générique. | Priorisation par type d'objet et actions critiques. |
| `Timeline` | 🟡 | Liste simple, aucune causalité/zoom. | Timeline planned-vs-actual, groups, cursor, detail action. |
| `DrawerShell` | 🔴 | Pas un vrai dialogue accessible. | Portal, overlay, close/Escape, focus trap/restore, label. |
| `CommandProgressToast` | 🟠 | Existe mais n'est pas intégré au lifecycle. | Command Center global persistant + terminal + retry/detail. |
| `ReasonInput` | 🟢 | Base correcte. | Validation, policy, counter, reason codes. |
| `InlineAction` | 🔴 | Toujours inerte. | `EntityLink` ou `ActionButton`, handler/route obligatoire. |
| `OperatorPageHeader` | 🟡 | Réutilisable mais générique. | Context, breadcrumbs, freshness, primary action slot. |
| `MetricBox` | 🟠 | Valeur/label sans contexte. | Fusionner dans primitives métriques documentées. |

### Composants manquants P0/P1

- **États :** Skeleton, Empty, Partial, Stale, Error, Forbidden, Disconnected.
- **Navigation :** Breadcrumb, local tabs, command palette, entity link.
- **Formulaires :** Input/Select/MultiSelect/Checkbox/Radio/Switch/DateRange/Filters avec labels/erreurs.
- **Overlay :** Modal/Drawer/Popover/Tooltip accessibles.
- **Actions :** CommandDialog, impact preview, confirmation phrase, CommandProgress, AuditReceipt.
- **Data :** ServerDataTable, Pagination, SavedView, MetricBreakdown, RelationGraph.
- **Technique :** ProvenanceBadge, CopyableId, TechnicalInspector, JsonViewer.

### Audit des cartes

Le type de carte doit découler de la question utilisateur :

| Type | Question | Contenu minimum | Clic |
| --- | --- | --- | --- |
| Metric | Quelle valeur et tendance ? | valeur, unité, période, delta, seuil, asOf, source, state | contributeurs |
| Alert | Que dois-je traiter ? | severity, impact, age, owner, next action | incident/detail |
| Entity | Quel est l'état de cet objet ? | identité humaine, status, key facts, relations | page détail |
| Chart | Comment cela évolue/se distribue ? | question, axes, période, benchmark, tooltip | analyse L3 |
| Action | Quelle décision est attendue ? | contexte, impact, permission, deadline | workflow de commande |

Toute carte qui ne répond pas à une de ces questions doit être supprimée ou fusionnée.

---

## 5. Données et comportements observés sur le BFF local

Les cardinalités ci-dessous ont été observées en lecture seule. Elles illustrent l'écart entre forme d'écran et donnée réellement exploitable ; elles ne constituent pas un snapshot de production.

| Vue BFF | Données présentes | Données vides ou non garanties | Diagnostic |
| --- | --- | --- | --- |
| auth-session | 3 env., 4 permissions, 5 guards, 1 event | actions | Session illustrative ; permissions non appliquées. |
| operator-settings | aucune collection | tout | Page non branchée. |
| admin-access | aucune collection | tout | Page non branchée. |
| command-center | 6 systèmes, 6 activités, 4 lanes, 1 upcoming | contributeurs/actions | Synthèse construite, pas navigable. |
| demo-paper-readiness | 2 composants, 3 actions, 4 liens | preuves granulaires | Base intéressante, gate à contractualiser. |
| events-audit | aucune | tout | Coquille vide. |
| operations-queue | 50 missions, 7 incidents | event flow, gates, DLQ, actions | Partiel mais affiché comme produit complet. |
| research-agent-fleet | 50 agents | queues, conversations, incidents, actions | Annuaire, pas supervision. |
| research-compute-scheduler | 2 pools, 50 workers, 40 jobs, 1 réservation | DLQ, actions | Certaines capacités sont synthétiques. |
| research-data-catalog | 1 dataset, 1 instrument, 1 lineage, 7 incidents | features, actions | Qualité/lookahead non prouvés. |
| research-experiment-detail | aucune | tout | ID non transmis. |
| research-run-detail | aucune | tout | ID non transmis. |
| research-lab | 1 expérience, 50 agents, 56 résultats, 40 jobs, 1 dataset | une grande part des décisions | Agrégat lourd mais prometteur. |
| strategy-center | 43 stratégies | lifecycle, performance, top, events | Catalogue réel, analytics absents. |
| strategy-detail | aucune | tout | ID non transmis. |
| strategy-compare | aucune | tout | IDs de comparaison absents. |
| live-trading | 15 orders, 6 positions, 1 provider, 7 incidents, 6 timeline | signaux ; arbitrage/risk générés | Critique : statut synthétique. |
| live-signal-detail | aucune | tout | ID non transmis. |
| orders | 7 intents, 15 orders, 1 provider | fills/protection/state/history/actions | L'état d'exécution est incomplet. |
| risk | 1 exposition | limites, corrélations, stress, breaches, actions | Ne peut pas soutenir un Risk Center. |
| execution-providers | 1 provider, 2 comptes, 1 health, 7 incidents | adapters, switch, events, actions | Read-only partiel. |
| execution-incidents | 7 incidents | retries, actions | Investigation/action incomplète. |
| portfolio | 6 positions, 1 exposition, 6 broker rows, 7 allocations | matrix, attribution, timeline ; equity zéro | Maquette plus riche que la vérité. |
| jarvis-workspace | contexte synthétique | conversations/actions effectives | Autorité et persistance à formaliser. |

### Performance

Les lectures locales observées étaient généralement de l'ordre de **0,7 à 1,5 seconde**, même pour des vues presque vides. Cause principale : `loadControlPlaneView` déclenche les onze familles de sources pour chaque vue. La cible est un graphe de dépendances par vue avec timeout et cache individuels.

---

## 6. Mapping backend → frontend

### 6.1 Capacités actuellement consommées

| Backend capability / API | Utilisée | Écran | Utilisation actuelle | Potentiel UX | Action proposée |
| --- | --- | --- | --- | --- | --- |
| `/front-api/v1/views/:view` | Oui | 24 routes | Snapshot agrégé sans paramètres | Foundation BFF stable | Scinder overview/list/detail, query params typés. |
| `/front-api/v1/events` | Oui | Shell/realtime | Heartbeat générique 15 s | Invalidations ciblées et progression | Événements métier réels, cursor/replay, topics. |
| `/front-api/v1/commands` | Oui | nombreuses pages | Reçu `ACCEPTED` | Control plane sûr | Capability registry + terminal + ressource relue. |
| execution overview | Oui via BFF | Live/Orders/Portfolio | orders/intents/trades/provider | État complet et réconciliation | Projeter IDs stables, state machine, fills, protection. |
| strategy overview | Oui via BFF | Strategy/Live | catalogue/signals partiels | Lifecycle complet | Endpoints par stratégie/version/instance/signal. |
| research overview | Oui via BFF | Research | agrégat expériences/résultats | Pipeline candidate | Exposer experiments/candidates/runs/reports. |
| agent runtime | Oui via BFF | Ops/Agents/Compute | tâches aplaties | Mission/conversation/budget | Contrats worker, work item, conversation, cost. |
| portfolio risk | Oui via BFF | Command/Live/Risk/Portfolio | summary/exposure partiel | Breakdowns et limites | Valeurs typées + provenance + stress/limits. |
| AI context | Oui via BFF | Live/Jarvis | advisory summary | Explication/citations | Prompts/version/cutoff/tool trace, advisory explicite. |
| health | Oui via BFF | Command/Readiness | disponibilité agrégée | Dependency map | Santé par composant, SLA/asOf, last-known. |

### 6.2 Capacités existantes sous-exploitées ou non consommées

| Domaine `/api/v2` | Capacité disponible | Écran cible | Utilisation UX proposée | Priorité |
| --- | --- | --- | --- | --- |
| Today | live desk current, market snapshot, macro calendar, news | Live/Command/News | contexte de session, freshness, calendrier, latest news fallback | P0/P1 |
| Today | master/monitor/thesis/setup/timeline | Live/Plan/Timeline | planned-vs-actual, analyse structurée, setup réel, prochain jalon | P0 |
| Operations | workflow list/detail/steps/events/actions | Operations/Workflow Detail | queue→étapes→cause→action→preuve | P0 |
| Operations | incident actions, notifications, runbooks, observability | Incidents/Command | résolution guidée, alerting, diagnostic | P0/P1 |
| Operations | replay runs/day/session/compare/price series | Replay | progression, décisions, résultats R live, comparaison | P1 |
| Operations | GPT processes/history | Replay/Live/Agents | statut claim, latence, conversation, résultat | P1 |
| Performance | overview, calendar/day | Performance | global→jour→trade→décision | P1 |
| Strategy | definitions/version/instances/detail/actions/compare/audit | Strategy | catalogue, diff, promotion, rollback, historique | P0/P1 |
| Strategy | signals | Live/Strategy | causalité strategy→signal | P0 |
| Research | experiments/candidates/reports/details | Research | hypothèse→candidate→gate | P1 |
| Data foundation | sources/datasets/features/values/computations | Data/Signal/Run | lineage et preuve point-in-time | P1 |
| Data foundation | ingestion/storage/hot windows/profiles | Data/Ops | fraîcheur, backfill, capacité | P1/P2 |
| Execution | overview/intent detail/actions/AddOn/bridge | Orders/Providers | state machine, provider, commandes réelles | P0 |
| Governance | operator state/commands | Auth/Admin/Commands | permissions et lifecycle de commande | P0 |
| Governance | catalog/OpenAPI | Shell/core API | navigation/capabilities/client typé | P0 |
| Governance | AI context | Jarvis/Agents/Prompts | provenance IA, prompts, modèle/effort | P1 |
| Governance | portfolio risk | Portfolio/Risk | exposition et limites canoniques | P0 |

### 6.3 APIs à créer ou formaliser

1. recherche transverse d'entités avec permission filtering ;
2. notification center + unread counts réels ;
3. user preferences et device sessions ;
4. RBAC/users/roles/access requests ;
5. prompt registry/version activation/diff/audit ;
6. command capability manifest et command status/detail ;
7. relation graph par entité ;
8. saved views/filters ;
9. export jobs ;
10. risk limits/breaches/stress si non déjà exposés.

---

## 7. Gestion cible des données

### Query keys

```ts
['command-center', environment, scope]
['strategies', filters, sort, cursor]
['strategy', strategyId]
['strategy', strategyId, 'performance', period, regime]
['order', orderId]
['workflow', workflowId, 'events', cursor]
```

### Politique

- **Server state :** TanStack Query uniquement.
- **UI state partagé :** environnement, densité, thème, command palette et sélections courtes.
- **URL state :** filtres, tri, pagination, période, onglet, comparaison.
- **Optimistic update :** seulement préférence personnelle ou annotation réversible ; jamais risk/order/provider.
- **Pagination :** cursor côté serveur pour audit/events/orders/workflows ; virtualisation pour longues tables.
- **Retry :** aucune répétition automatique d'une commande ; lectures GET avec backoff limité et classification.
- **Cache :** domain-specific et invalidation par event, pas `refetch` global.
- **Partial data :** chaque section porte sa source/asOf/error ; l'écran reste exploitable sans masquer la panne.

---

## 8. Navigation et doublons

### Problèmes

- les groupes route (`command`, `operations`, `research`, etc.) existent mais la sidebar ne les utilise pas ;
- Operations/Events/Incidents se chevauchent sans hiérarchie parent-enfant ;
- Portfolio/Risk/Orders/Providers sont dispersés comme pairs alors qu'ils forment Execution & Risk ;
- Data & Compute est un lien vers Data, alors que Compute a une route séparée ;
- Reports pointe vers Event Explorer, ce qui est sémantiquement faux ;
- Jarvis occupe une route principale mais devrait également être accessible contextuellement ;
- Replay et Performance, pourtant riches dans l'API legacy/canonique, manquent de routes V2.

### Correction

Route registry générée par modules avec : `path`, `label`, `domain`, `capability`, `navVisibility`, `parent`, `breadcrumbs`, `searchKeywords`, `lazyComponent`. La sidebar rend les domaines ; la sous-navigation rend les enfants ; la command palette indexe le même registry.

---

## 9. Responsive et UI visuelle

### Ce que les références valident

- palette sombre premium et bordures fines ;
- sidebar stable, topbar compacte, forte densité ;
- tableaux et timelines adaptés à un opérateur expert ;
- six KPI peuvent fonctionner sur certaines vues workstation.

### Ce qu'elles ne valident pas

- les screenshots portent un état `MOCK` ;
- la répétition du même layout sur tous les domaines ;
- la réalité des actions ;
- la lisibilité des textes 7–9 px ;
- le responsive mobile, où le bottom nav recouvre une partie du contenu et ne couvre que cinq routes ;
- la fidélité au backend.

### Règle cible

Le composant choisit son layout par espace disponible et importance, pas par ordre DOM. Les tableaux possèdent une configuration de colonnes prioritaires. Mobile montre d'abord alertes, décisions, positions et commandes critiques, puis ouvre des pages filles.

---

## 10. Accessibilité

| Défaut | Impact | Correction |
| --- | --- | --- |
| Drawer `aria-hidden` sans semantics | Focus peut rester dans contenu caché. | Dialog accessible complet. |
| Boutons visuels sans handler | Navigation clavier trompeuse. | Ne pas rendre un bouton sans action. |
| Textes très petits en workstation | Lisibilité et zoom. | 10 px absolu minimum, 12 px courant, densité explicite. |
| Tables sans caption/sort state | Lecteurs d'écran. | Caption, scopes, `aria-sort`, navigation et résumé mobile. |
| Statuts surtout colorés | Daltons/non-visuel. | Icône + label + texte. |
| Flux live potentiellement bavard | Surcharge `aria-live`. | Annoncer uniquement transitions critiques. |
| Bottom nav partiel | Accès fonctionnel. | Menu domaines + Plus ; focus visible. |

---

## 11. Stratégie de tests

### Pyramide

1. **Contrats/mappers :** DTO complets, partiels, inconnus, nulls, version incompatible.
2. **Composants :** interactions, clavier, focus, variantes/états, Axe.
3. **Features :** query + filters URL + command lifecycle + permission.
4. **BFF intégration :** chaque vue ne charge que ses dépendances ; timeout/partial/error/403/404/409.
5. **E2E réel :** login→navigation→detail→command→terminal→audit ; research→run→candidate ; signal→order→position→result.
6. **Visuel :** golden screens validés aux viewports/densités cibles.
7. **Résilience :** SSE disconnect/reconnect, stale data, source lente, command duplicate/conflict.

### Lacunes actuelles

- tests surtout orientés dataset/transport/reducer/density ;
- pas de bibliothèque de test composants/interactions étendue ;
- pas de gate Axe ;
- pas de suite Playwright exhaustive des 24 routes contre le BFF réel ;
- `design-qa.md` prouve surtout des reçus `ACCEPTED`, pas l'effet métier terminal.

### Scénarios E2E bloquants

| Flow | Preuve attendue |
| --- | --- |
| Permission refusée | route et action absentes/403, événement audité. |
| Détail par ID | deux IDs donnent deux ressources et caches distincts ; 404 strict. |
| Commande supportée | ACCEPTED→RUNNING→SUCCEEDED puis ressource modifiée et audit. |
| Commande non supportée | bouton absent/désactivé ou 501 explicite, jamais succès. |
| Live partial | données utilisables restantes + section indisponible + `asOf`. |
| Provider disconnect | commandes sensibles bloquées, last-known daté, incident lié. |
| Research promotion | evidence/gates/permission/four-eyes/audit. |
| Responsive mobile | toutes destinations nécessaires, aucun contenu/action masqué. |

---

## 12. Décisions d'implémentation issues de l'audit

1. Ne pas migrer écran par écran avant le chantier **Truth & Safety**.
2. Ne pas conserver `/views/<name>` comme seul niveau d'API pour les détails et listes volumineuses.
3. Ne pas dériver la navigation des réponses mock ; la dériver du route/capability catalog.
4. Ne pas afficher une action avant que son command type ait un effet terminal testable.
5. Ne pas utiliser `randomUUID` comme fallback d'identité de lecture.
6. Ne pas dupliquer le design system dans les features.
7. Ne pas considérer la maquette workstation comme seule cible responsive.
8. Conserver la direction visuelle, mais laisser chaque domaine choisir la structure qui répond à sa question principale.

---

## 13. Traçabilité attendue pour la phase 2

Chaque ticket Jira d'implémentation doit lier :

```text
Page Operating Contract
  → question métier
  → donnée/API ou commande
  → capability/permission
  → mapper/view model
  → composant du Design System
  → route/drill-down
  → états et responsive
  → tests
  → feature flag
  → preuve de release
```

Cette chaîne empêche le retour à des cartes décoratives, des actions simulées et des écrans conçus indépendamment du backend.
