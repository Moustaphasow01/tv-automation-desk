# Trading Desk — Standards d'ingénierie, d'architecture et de qualité

> **Statut : normatif**
> **Version : 1.0.0**
> **Portée : tout le monorepo Trading Desk**
> **Public : développeurs, reviewers, agents IA et exploitation**
> **Source d'inspiration : standards Nakili v1.0, adaptés au stack Node.js/React/PostgreSQL/Windows/Python du desk**

## 0. Objet

Le desk doit rester compréhensible, déterministe, résilient, testable, auditable et exploitable malgré sa croissance. Une modification n'est acceptable que si elle :

1. se trouve dans le bon bounded context et la bonne couche ;
2. possède une responsabilité et une raison de changement explicites ;
3. préserve les frontières, contrats et invariants ;
4. utilise des données réelles ou des doubles limités aux tests unitaires ;
5. traite idempotence, concurrence, temps, erreurs et audit ;
6. est observable et possède un rollback ;
7. est prouvée par des tests au niveau approprié.

Le fait que le code fonctionne ou que le front s'affiche ne suffit pas.

## 1. Langage normatif et hiérarchie

- **DOIT / OBLIGATOIRE** : violation bloquante.
- **INTERDIT / NE DOIT PAS** : pratique prohibée.
- **DEVRAIT** : règle par défaut ; exception justifiée.
- **PEUT** : option acceptable.
- **DÉROGATION** : entrée approuvée et temporaire dans `exception-register.md`.

Ordre de priorité :

1. sûreté broker, sécurité et protection des données ;
2. invariants trading/risk et contrats actifs ;
3. ADR acceptés ;
4. présent standard ;
5. `AGENTS.md` ;
6. documentation de feature ;
7. préférence individuelle.

## 2. Principes non négociables

1. Le métier détermine l'organisation du code.
2. Un module possède ses données, son vocabulaire et ses invariants.
3. Le domaine ne dépend d'aucun framework, transport ou fournisseur.
4. Un use case exprime une intention métier explicite, jamais un CRUD générique.
5. Une unité de code possède un seul vecteur principal de changement.
6. Les dépendances pointent vers le domaine, jamais vers l'infrastructure.
7. Replay, SHADOW, PAPER et LIVE réutilisent la même sémantique déterministe.
8. Le frontend ne calcule aucun KPI ou état de trading officiel.
9. Toute écriture est validée, autorisée, idempotente, concurrent-safe, auditée et observable.
10. Toute règle importante devient un contrôle CI ; elle ne repose pas seulement sur une revue humaine.
11. Aucun LLM ne soumet, dimensionne ou modifie directement un ordre.
12. Une modification incompréhensible sans son auteur est incomplète.

## 3. Architecture cible du monorepo

Structure de convergence, sans déplacement big-bang :

```text
/
├── AGENTS.md
├── apps/                         # futurs points d'entrée web/API si extraction justifiée
├── packages/
│   └── <bounded-context>/
│       └── src/
│           ├── api/              # contrats publics minimaux
│           ├── domain/           # modèle et politiques purs
│           ├── application/      # use cases et ports
│           └── adapter/          # DB, HTTP, MCP, jobs, providers
├── mcp_gpt_desk/                 # host legacy à décomposer progressivement
├── src/                          # front React de transition
├── workers/                      # compute/agent workers si séparés
├── deploy/ et infra/             # déploiement reproductible
├── scripts/                      # opérations explicites, pas de métier caché
└── docs/
    ├── engineering/
    └── trading-desk-target-blueprint/
```

Interdits : dossiers `misc`, `temp`, `old`, `legacy2`, `common2`, `utils2`, fichiers `.bak`, code mort conservé « au cas où ». Git conserve l'historique.

Les migrations depuis le host plat sont incrémentales : extraction par vertical slice avec tests de parité, jamais déplacement massif non fonctionnel.

## 4. Bounded contexts et propriété

Le catalogue canonique est `docs/engineering/module-catalog.md`.

Chaque module possède :

- vocabulaire, agrégats, invariants et machines à états ;
- tables et migrations ;
- commands, queries, événements, ports et projections ;
- documentation, tests et observabilité.

Un autre module ne :

- lit ou modifie directement ses tables ;
- importe ses fichiers `internal` ;
- reproduit ses règles ;
- utilise son DTO HTTP comme modèle de domaine ;
- recalcule silencieusement son KPI officiel.

Interactions préférées : événement métier, query API publique, command publique explicite, projection reporting. Toute dépendance circulaire est interdite.

Un nouvel écran ne justifie pas un nouveau module. Un nouveau module nécessite au moins trois critères : vocabulaire, invariants, données, lifecycle, permissions, événements, charge/cadence ou responsabilité distincts.

## 5. Architecture hexagonale d'un module

```text
api/
  command/ query/ event/ model/
domain/
  model/ policy/ service/ event/ error/
application/
  port/in/ port/out/ usecase/ command/ query/ mapper/
adapter/
  in/http/ in/mcp/ in/job/ in/event/
  out/postgres/ out/messaging/ out/storage/ out/provider/
```

Direction :

```text
adapter -> application -> domain
   \-----------> api
```

- `domain` : fonctions/types purs ; aucun SQL, HTTP, JSON wire format, React, Codex, NinjaTrader ou PickMyTrade.
- `application` : orchestration, transactions, autorisation, idempotence, ports, événements.
- `adapter` : détails de transport et technologie.
- `api` : surface publique minimale et versionnée.
- le host assemble les adapters ; il ne porte pas les règles métier.

## 6. Arbre de placement

Avant tout nouveau fichier :

1. **Règle/invariant métier ?** Agrégat, value object, policy ou domain service.
2. **Intention utilisateur/système ?** Use case applicatif.
3. **Intégration technique ?** Port sortant + adapter.
4. **Transport entrant ?** Adapter HTTP/MCP/job/event.
5. **Présentation uniquement ?** Feature/page/component/data-access/ViewModel frontend.
6. **Transversal ?** Prouver trois usages cohérents ou un invariant commun avant `shared`.

En cas d'incertitude, documenter placement, responsabilité, raison de changement, dépendances et alternative écartée. Une hésitation répétée déclenche un ADR de frontière.

## 7. Fonctions, classes et services

Créer une nouvelle fonction lorsqu'un bloc possède une intention nommable, un niveau d'abstraction distinct, une règle testable, une duplication réelle ou une branche indépendante.

Ne pas extraire pour déplacer arbitrairement quelques lignes ou contourner un seuil.

Une nouvelle classe/module représente un concept, une policy, une stratégie, un port, un adapter, un use case, une state machine, un mapper de frontière ou un lifecycle distinct.

Le mot `service` doit être qualifié :

- domain service : règle métier pure sans agrégat naturel ;
- use case : intention transactionnelle ;
- query service : read model sans mutation ;
- adapter : capacité technique nommée ;
- frontend client/store : HTTP ou état de feature réellement partagé.

Interdits sans justification : `Manager`, `Helper`, `Utils`, `Common`, `Generic`, `BaseService`, `DataService`, `ProcessService`, `Processor`, `Coordinator`, `Facade`.

## 8. Nommage et vocabulaire

- noms de code en anglais ; textes opérateur traduits côté présentation ;
- un concept possède un seul nom canonique défini dans `naming-glossary.md` ;
- acronymes comme mots : `StrategyId`, pas `StrategyID` ;
- aucun suffixe numérique ou abréviation locale opaque ;
- commandes : verbe d'intention (`PublishStrategyVersion`) ;
- queries : résultat demandé (`GetPortfolioExposure`) ;
- événements au passé (`StrategyVersionPublished`) ;
- policies : décision nommée (`LivePromotionPolicy`) ;
- ports : capacité domaine (`OrderExecutionProvider`) ;
- adapters : technologie + responsabilité (`NinjaTraderOrderExecutionAdapter`) ;
- méthodes/fonctions : verbe précis (`calculate`, `evaluate`, `publish`, `reconcile`, `claim`, `expire`).

Interdits : `doIt`, `processData`, `manage`, `runLogic`, `updateStuff`, `handleData`.

## 9. Taille, complexité et dette legacy

### Fonctions

| Mesure | Cible | Avertissement | Blocage nouveau code |
|---|---:|---:|---:|
| lignes logiques | ≤ 20 | > 30 | > 60 |
| complexité cyclomatique | ≤ 6 | > 10 | > 15 |
| complexité cognitive | ≤ 10 | > 15 | > 25 |
| paramètres | ≤ 3 | 4 | ≥ 5 |
| imbrication | ≤ 2 | 3 | > 3 |

### Fichiers/modules écrits à la main

| Mesure | Cible | Avertissement | Blocage nouveau code |
|---|---:|---:|---:|
| fichier production | ≤ 250 lignes | > 400 | > 600 |
| exports publics | ≤ 7 | > 10 | > 15 |
| dépendances directes | ≤ 5 | 6–7 | > 7 |

Exceptions : code généré identifié, migration, DSL lisible, mapping mécanique ou algorithme documenté/testé.

Les fichiers legacy dépassant les seuils sont enregistrés dans `legacy-baseline-2026-08-08.md` et `exception-register.md`. Toute modification doit réduire ou ne pas augmenter lignes, complexité et responsabilités. Une feature nouvelle ne doit pas être ajoutée dans un god file si une extraction sûre est possible.

Interdit de contourner les seuils par fonctions d'une ligne sans intention, classes internes, renommage, suppression de règles ou `eslint-disable` large.

## 10. Types, paramètres et immutabilité

- contrats publics explicitement typés par JSON Schema et types générés ou interfaces stables ;
- pas de `Map<String,Object>`/objet libre comme contrat métier ;
- value objects immuables pour identifiants, argent, pourcentage de risque, prix, quantité, instant et fenêtre ;
- absence explicite, jamais `null` comme commande de comportement ;
- collections copiées/encapsulées aux frontières ;
- paramètres booléens de contrôle interdits ; utiliser enum/policy ;
- cinq paramètres ou plus imposent command/query/criteria/value object ;
- états métier par enums/types, jamais comparaisons dispersées de chaînes ;
- guard clauses ; profondeur cible ≤ 2.

## 11. Domaine, use cases et transactions

Le domaine protège les invariants, mutations, transitions et événements. Aucun setter public, repository ou I/O.

Un use case :

- autorise et valide le contexte ;
- charge par ports ;
- ouvre une transaction courte ;
- appelle le domaine ;
- persiste ;
- écrit l'outbox dans la même transaction ;
- retourne un résultat applicatif.

Interdits dans un use case : SQL, format HTTP/MCP, construction de JSON wire, SDK fournisseur, attente réseau dans transaction, calcul dupliqué.

Toute commande rejouable utilise idempotency key ou identifiant stable. Optimistic locking obligatoire sur états sensibles ; pas de last-write-wins silencieux. Bulk : politique d'échec explicite.

## 12. Ports, adapters et providers

Un port sortant exprime le besoin du domaine, pas l'API du fournisseur.

Préférer `OrderExecutionProvider.submit(intent)` à `PickMyTradeClient.call(payload)` dans l'application.

Chaque adapter externe possède : timeout, retry borné, backoff, circuit breaker si nécessaire, idempotence, métriques, correlation ID, mapping d'erreurs, logs sans secrets et sandbox/PAPER.

Un fallback broker n'est autorisé qu'après réconciliation prouvant l'absence d'ordre chez le premier provider. Aucun resend aveugle après timeout.

## 13. PostgreSQL et migrations

- tables/colonnes/index en `snake_case` ; conventions uniformes documentées ;
- FK, unique, check et not-null protègent les invariants structurels ;
- JSONB réservé aux payloads d'intégration, snapshots d'audit et métadonnées extensibles ;
- modèle métier relationnel connu interdit dans `desk_documents` à terme ;
- pas de `SELECT *` ; listes paginées et ordre déterministe ;
- `EXPLAIN (ANALYZE, BUFFERS)` sur requêtes critiques ; timeout ; pas de N+1 ;
- migration immuable après fusion ; expand/contract ; pas de suppression utilisée par la release précédente ;
- migration testée sur base vide et copie de version précédente ;
- seed de référence idempotent séparé des migrations structurelles ;
- suppression/purge comme use case autorisé et audité ; aucune cascade destructive large par défaut.

Chaque module devient propriétaire de ses tables. Tant que le schéma `public` est partagé, la propriété logique est documentée et contrôlée par tests de requêtes/imports.

## 14. API HTTP, MCP et événements

- REST pragmatique sous `/api/v2` pour la cible ; OpenAPI source de vérité ;
- RFC 9457 Problem Details ; codes d'erreur stables ; ISO 8601 ; pagination ;
- GET sans effet ; commandes métier nommées ; pas de `/doAction`, `/process`, `/updateStatus` ;
- version/ETag ou expected revision ; `409` explicite ;
- MCP séparé par rôles et permissions minimales ; aucun outil ne contourne Risk/Execution Gateway ;
- DTO wire distinct du domaine et du ViewModel ;
- événement immuable, au passé, avec `event_id`, `correlation_id`, `causation_id`, timestamp, schema version et payload minimal ;
- événement d'intégration écrit dans l'outbox avec la mutation métier ;
- consommateur idempotent, retry, dead-letter et replay contrôlé.

## 15. Prompt & Instruction Registry

- prompt definition, version, module d'instruction, composition, binding et deployment sont distincts ;
- toute version publiée est immuable et hashée ;
- Git contient seeds/revues ; PostgreSQL résout la version opérationnelle ;
- le work item épingle version, modules, composition hash, rendered hash, model policy et contracts ;
- aucune résolution implicite de `latest` après claim ;
- secrets interdits dans les prompts ;
- changement Live : tests, canary, approbation et rollback last-known-good ;
- conversation IA jamais source de vérité ; mission/task/backend restent canoniques.

## 16. Temps, prix, argent, risque et identifiants

- horloge injectée ; aucun `Date.now()` caché dans domaine/application ;
- timestamps techniques UTC, affichage/session avec timezone explicite ;
- DST, calendrier, sessions et cutoff testés ;
- prix et montants sans float imprécis lorsque l'exactitude l'exige ; tick size et devise explicites ;
- risque en pourcentage/value object borné ; arrondis centralisés ;
- quantités de contrats entières ;
- identifiants opaques sans signification métier encodée ;
- aucune date ou portée implicite dans une chaîne libre si un type existe.

## 17. Erreurs et résilience

Catégories : `ValidationError`, `AuthorizationError`, `NotFoundError`, `ConflictError`, `BusinessRuleViolation`, `ExternalDependencyError`, `UnexpectedError`.

- code stable et message opérateur séparés ;
- jamais de `throw Error('error')` sans code/contexte ;
- `catch` global uniquement aux boundaries ; ne jamais avaler ;
- conserver cause technique sans exposer stack/SQL/secrets ;
- timeout explicite ; retry seulement si transitoire et idempotent ;
- circuit breaker ; DLQ ; health/readiness ; mode dégradé documenté ;
- aucune attente infinie, spinner infini ou fallback silencieux.

## 18. Frontend React de transition

Organisation cible par feature :

```text
src/
  core/          # auth, http, telemetry, error handling
  shell/         # navigation et workspace
  shared/ui/     # design system prouvé réutilisable
  features/<feature>/
    pages/ components/ data-access/ state/ model/ testing/
```

- page routée orchestre et compose ; aucune règle métier ;
- HTTP uniquement dans client data-access ;
- `API DTO -> mapper -> ViewModel -> component` ;
- mapper ne calcule pas risque/KPI et n'invente pas de données ;
- état local au plus près ; pas de cache/store global par défaut ;
- données métier réelles uniquement dans l'application ; fixtures/mocks limités aux tests isolés ;
- toute page gère loading, error, empty, forbidden, conflict et stale ;
- accessibilité : clavier, focus, labels, contraste, modales, tables ;
- responsive et visual regression selon le périmètre ;
- design tokens pour valeurs répétées ; aucune refonte silencieuse ;
- DTO backend jamais consommé directement dans le template lorsque son évolution est indépendante.

## 19. Observabilité, audit et sécurité

Logs JSON structurés : correlation ID, use case, module, résultat, durée ; aucun token, secret, prompt sensible ou payload marché massif inutile.

Métriques critiques : débit, latence, erreurs, retries, DLQ, backlog, saturation, fraîcheur data, dérive broker, protection, coût/tokens IA.

Traces aux boundaries HTTP/MCP, use case, SQL critique, provider et job ; pas de spans sur chaque fonction.

Audit métier distinct du log : acteur, action, objet, avant/après adapté, justification, source, correlation ID.

Sécurité : deny by default, moindre privilège, validation frontière, requêtes paramétrées, secrets hors dépôt, scan secrets/dépendances/images/SBOM, scopes serveur, rate limiting sensible.

## 20. Tests et qualité

Pyramide :

1. domaine pur : invariants, transitions, refus, limites, calculs ;
2. application : orchestration, ports, autorisation, idempotence ;
3. adapters : PostgreSQL réel, providers simulés par serveur contrôlé ;
4. architecture : imports, cycles, couches et propriété ;
5. contrats API/MCP/events/prompts ;
6. composants React ;
7. E2E backend/PostgreSQL réels ;
8. visuel, accessibilité, sécurité, performance et résilience ciblés.

Règles : déterministe, horloge fixe, IDs contrôlés, aucun réseau public, pas de sleep, pas de dépendance à l'ordre, assertions métier utiles.

Seuil initial domaine conservé au moins au niveau actuel ; aucune baisse de couverture. Les règles broker/risk/conditions nécessitent branchement élevé et mutation testing ciblé recommandé.

## 21. Quality gates à construire

- ESLint strict backend/front, TypeScript strict front et cible backend à décider par ADR ;
- complexité, profondeur, paramètres, lignes fichier/fonction ;
- imports interdits et cycles entre bounded contexts ;
- code/export inutilisé ; duplication ;
- architecture tests ;
- tests/migrations/OpenAPI/contracts générés sans diff ;
- absence de mocks métier en production ;
- secrets, vulnérabilités, licences, SBOM et images ;
- TODO invalides ; migrations modifiées ; dérogations expirées ;
- budget bundle, E2E, visual et a11y frontend ;
- Windows deployment kit, Docker config et rollback.

Une règle non encore automatisée reste obligatoire en revue et possède un ticket `TD2-ARCH-*`.

## 22. Dépendances, partage et refactorisation

Avant une dépendance : besoin, alternative native, maintenance, licence, sécurité, poids, abstraction et plan de mise à jour. Versions dynamiques interdites ; SDK fournisseur hors domaine.

Règle des trois usages avant extraction `shared`, sauf invariant/contrat/design system incontestable. Une petite duplication entre concepts divergents est préférable à une abstraction à booléens.

Refactorer immédiatement : violation de frontière, invariant dupliqué, sécurité, transaction incorrecte, règle métier au front/transport, nom mensonger, seuil de blocage dans nouveau code.

Créer un ticket séparé : dette large hors scope, migration progressive ou optimisation non mesurée. Boy Scout uniquement petit, testé et sans comportement caché.

## 23. Git, documentation et ADR

- commit cohérent, sans secret/code commenté/génération inutile ;
- format recommandé `type(scope): intention` ;
- diff cible < 400 lignes, avertissement > 800, découpage > 1 500 hors migration/génération ;
- ne pas mélanger feature, refactor global, dépendances massives et refonte visuelle ;
- documenter nouveau module, événement, permission, provider, job, read model, migration, runbook ou exception ;
- ADR si technologie, frontière, contrat public, exception durable, extraction ou migration coûteuse ;
- TODO : `TODO(TD2-..., owner, YYYY-MM-DD): raison et condition de suppression`.

## 24. Processus obligatoire pour agents IA

Avant modification : lire `AGENTS.md`, ce document, module catalog, glossary, ADR ; inspecter voisinage ; rechercher l'existant ; annoncer placement ; livrer vertical slice ; valider.

Compte rendu : fichiers, module/couche, responsabilité, alternatives, contrats/migrations, tests/résultats, observabilité/sécurité/rollback, limites/dette, ADR/dérogation.

Un agent ne déclare jamais terminé sans résultats de commandes.

## 25. Definition of Done

Une capacité est terminée lorsque :

- invariants, transitions, autorisation, audit, concurrence et idempotence sont définis ;
- module/couche/ports/adapters corrects ;
- API et PostgreSQL réels ; migrations et événements ;
- projection frontend réelle avec tous les états ;
- observabilité, sécurité, health et rollback ;
- tests au bon niveau et CI verte ;
- documentation/ADR/dérogation/Jira synchronisés ;
- aucune activation LIVE implicite.

## 26. Dérogations

Une dérogation contient règle, fichiers, justification, risque, mesure compensatoire, propriétaire, expiration, ticket et approbation. Elle n'est jamais implicite ou permanente et ne devient pas un précédent.

## 27. Checklist courte

```text
[ ] Bon bounded context et bonne couche
[ ] Vocabulaire canonique et responsabilité unique
[ ] Pas de dépendance/cross-table interdite
[ ] Contrats et migrations compatibles
[ ] Temps, idempotence, concurrence et audit
[ ] Risk/broker safety et aucun ordre LLM direct
[ ] Données réelles, frontend sans calcul métier
[ ] Loading/error/empty/stale/conflict + accessibilité
[ ] Logs/métriques/traces sans secret
[ ] Tests déterministes au bon niveau
[ ] Taille/complexité et dette non aggravées
[ ] ADR/dérogation/rollback/Jira
```

La cible n'est pas seulement « le desk fonctionne », mais « le desk fonctionne, ses responsabilités sont explicites, ses frontières sont testées, ses décisions sont reproductibles et un nouvel intervenant sait où modifier sans fragiliser le reste ».
