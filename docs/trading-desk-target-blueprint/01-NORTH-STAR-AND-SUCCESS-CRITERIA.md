# 01 — North Star and Success Criteria

- **Titre** : North Star architecturale et critères de succès mesurables
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : prompt maître (`prompt_maitre_claude_trading_desk.md`, §5-6), plan directeur initial, `docs/audit-2026-08-07/04-ADDENDUM-PASSATION.md`
- **Documents supersédés** : aucun
- **Dernière vérification code** : n/a — ce document est une déclaration d'intention cible, pas un constat AS-IS
- **Portée** : ce document fixe la destination finale et les critères permettant de dire objectivement « la transformation est terminée » ou « telle phase est terminée ». Il ne décrit ni l'état actuel ni le chemin — voir `02` et `16` pour ces sujets.

---

## 1. Énoncé de la North Star

Le Trading Desk cible est un système de trading algorithmique **data-driven, multi-agent, event-driven et scalable**, dans lequel :

1. **Le moteur d'exécution est déterministe et auditable.** Aucune décision qui engage un compte réel (ouverture, gestion, clôture de position) ne dépend d'un appel LLM au moment de la décision. Le LLM peut proposer, expliquer, chercher, résumer — jamais décider seul en direct sur du capital réel.
2. **La recherche et le raisonnement (LLM et algorithmique) sont séparés de l'exécution** par des contrats stables, versionnés et testables (Strategy Definition/Version, Signal Contract, Order Intent), de sorte que la logique de trading puisse être développée, testée et rejouée sans jamais toucher un compte réel.
3. **Toute stratégie traverse un cycle de vie explicite et vérifiable** avant de risquer du capital réel : conception → simulation historique (Simulation Engine) → SHADOW (calcule mais n'exécute rien) → PAPER (exécute sur compte simulé) → LIVE (exécute réellement), avec des portes de sortie mesurables à chaque étape, jamais un jugement qualitatif seul.
4. **Le risque est arbitré à l'échelle du portefeuille, pas stratégie par stratégie.** Un Portfolio Arbitration Engine et un Global Risk Engine consolident l'exposition nette avant toute soumission au broker, avant toute activation multi-stratégie réelle.
5. **Le système est piloté par les données et les événements, pas par des scripts ad hoc.** Chaque décision significative (signal généré, position modifiée, ordre soumis, agent invoqué) produit un événement traçable, horodaté, corrélable, permettant reconstruction complète et rejouabilité.
6. **Le système est nativement multi-agent et scalable horizontalement**, sans supposer un seul processus, un seul worker ou un seul type d'agent — l'ajout d'une nouvelle stratégie, d'un nouveau type d'analyse, ou d'un nouveau fournisseur d'exécution ne doit pas nécessiter de réécrire le cœur du système.
7. **Chaque changement du chemin d'exécution réel est réversible et gouverné**, jamais par une bascule de code brutale et irréversible — feature flags, gates de sortie de phase, tests de non-régression sur les garde-fous de sécurité existants (`NO_DUPLICATE_POSITION`, `BRIDGE_HEALTHY`, `PROTECTION_CONFIRMED`, etc.).

## 2. Ce que la North Star n'est PAS

Pour éviter toute ambiguïté d'interprétation à un opérateur ou à un agent d'implémentation lisant ce document isolément :

- Ce n'est **pas** un objectif de remplacer GPT/Codex — c'est un objectif de **déplacer** leur rôle de « décideur en direct sur capital réel » vers « chercheur, générateur d'hypothèses, rédacteur de stratégies candidates, analyste post-hoc ». Voir `09-RESEARCH-LAB-AND-MULTI-AGENT-RUNTIME.md` pour la migration précise des 3 pipelines LLM identifiés dans l'AS-IS.
- Ce n'est **pas** un objectif de big-bang. Toute la trajectoire (`16-END-TO-END-MIGRATION-ROADMAP.md`) est conçue pour que le système reste opérable et le moteur déterministe existant intact à chaque étape intermédiaire.
- Ce n'est **pas** un mandat pour élargir le scope au-delà du trading desk existant (pas de nouvelle classe d'actifs, pas de nouveau broker en dur, pas de nouvelle réglementation à couvrir) sauf décision opérateur explicite (voir `operator-decisions.yaml`).
- Ce n'est **pas** une autorisation à toucher, aujourd'hui, à un seul fichier du chemin d'exécution réel. La North Star décrit la destination ; `16` et `17` décrivent un chemin où le premier code fonctionnel touché reste, pendant plusieurs phases, strictement en dehors du chemin d'exécution réel (voir `05-CODEX-HANDOFF.md` pour les Phases -1/0/1 déjà spécifiées).

## 3. Invariants non négociables (valables à chaque phase, sans exception)

Ces invariants s'appliquent **dès la Phase -1** et restent vrais à **toutes** les phases suivantes, y compris après cutover complet (Phase 11). Toute proposition de ticket qui violerait un de ces invariants doit être rejetée ou reformulée, quelle que soit la phase.

| # | Invariant | Vérification |
|---|---|---|
| INV-1 | Aucune décision d'ouverture, modification ou clôture de position réelle n'est prise par un appel LLM synchrone au moment de la décision. | Revue de code + test de non-régression : tout chemin `BROKER_SUBMIT` doit être traçable jusqu'à une fonction pure du moteur déterministe, jamais jusqu'à une réponse de complétion LLM. |
| INV-2 | `NO_DUPLICATE_POSITION`, `BRIDGE_HEALTHY`, `BRIDGE_CONNECTED` et les gates équivalents du catalogue de conditions restent actifs et évalués en phase `BROKER_SUBMIT` pour toute soumission réelle, quelle que soit l'évolution du modèle de stratégies. | Test de non-régression obligatoire avant fusion de tout ticket touchant `packages/desk-domain/src/broker-execution.js`. |
| INV-3 | Aucune migration de schéma Postgres n'est un `DROP`/`DELETE` destructeur irréversible sur des données de production sans période expand/contract documentée et sans validation opérateur explicite. | Revue de migration + `operator-decisions.yaml`. |
| INV-4 | Le système reste opérable (le pipeline GPT-first actuel continue de fonctionner) à chaque étape intermédiaire tant que le cutover (Phase 11) n'est pas explicitement déclenché par l'opérateur. | Le pipeline GPT-first n'est jamais coupé unilatéralement par un ticket ; seul `21-CUTOVER-AND-GPT-FIRST-DECOMMISSION.md` décrit son extinction, sous gate opérateur. |
| INV-5 | Toute nouvelle capacité d'exécution automatique (nouvelle stratégie activée en LIVE, nouveau provider d'exécution, activation multi-stratégie réelle) est protégée par un feature flag par défaut désactivé et nécessite une décision opérateur explicite tracée. | `phase-gates.yaml` + `operator-decisions.yaml`. |
| INV-6 | Aucun secret, identifiant broker réel, ou environnement de production n'est contacté, modifié ou lu par un agent d'implémentation sans action humaine explicite hors du dossier de code. | Rappel systématique dans chaque ticket (`17-EXECUTABLE-BACKLOG.md`) et dans `22-GPT-CODEX-IMPLEMENTATION-RUNBOOK.md`. |
| INV-7 | `ACTIVE_STRATEGY_RUNTIME_VERSIONS` (ou son successeur direct) reste un verrou de compatibilité schéma/moteur singulier et strict — il n'est jamais réutilisé comme mécanisme de sélection de stratégie métier. | ADR-01 (`19-ARCHITECTURE-DECISION-RECORDS.md`). |
| INV-8 | Toute agrégation de position (Map, cache, projection) déclarée « source de vérité pour une décision d'exécution réelle » doit d'abord prouver, par test, l'absence de collision sous concurrence, avant d'être connectée à un chemin réel. | Voir Ticket 0.4 (Map-fix) et son test de non-régression, `17-EXECUTABLE-BACKLOG.md`. |

## 4. Principes directeurs (guident les arbitrages, non testables unitairement)

- **Fail-closed, pas fail-open** : en cas de doute, d'échec de vérification, ou de composant indisponible, le système par défaut est de ne rien exécuter, jamais de « exécuter quand même par optimisme ».
- **Le code et les données de production priment sur toute documentation**, y compris ce dossier (voir hiérarchie de vérité, `00-MASTER-INDEX.md` §5).
- **Composabilité avant optimisation** : préférer des contrats stables et de petites unités remplaçables à des optimisations locales qui rigidifient l'architecture.
- **Traçabilité avant vélocité** : tout événement métier significatif doit pouvoir être reconstruit a posteriori (qui/quoi/quand/pourquoi/sur quelle version de contrat) même si cela ralentit le développement initial.
- **Réversibilité avant élégance** : toute migration de schéma ou toute bascule de comportement doit avoir un chemin de retour arrière documenté avant d'être activée, même si le chemin d'arrivée est légèrement moins élégant.

## 5. Critères de succès mesurables — niveau système

Un critère est « mesurable » ici s'il peut être vérifié par une commande, un test automatisé, une requête, ou une inspection binaire (oui/non) — pas par un jugement qualitatif.

| ID | Critère | Comment le mesurer | Phase associée |
|---|---|---|---|
| SC-1 | 100 % des soumissions d'ordres réels passent par `evaluateBrokerPolicy` et ses gates, sans exception de contournement. | Grep exhaustif des points d'appel producteurs d'`OrderIntent` ; revue de code. | Continu, vérifié à chaque phase |
| SC-2 | Le catalogue de conditions (`condition-catalog-v1-2.json` ou son successeur) reste la source unique des prédicats/gates ; aucune condition métier n'est dupliquée en dur ailleurs. | Grep de littéraux dupliquant un ID de gate existant. | Continu |
| SC-3 | Toute stratégie candidate peut être rejouée sur données historiques (Simulation Engine) et produire des métriques de performance reproductibles bit-à-bit sur un même dataset figé. | Rejouer deux fois le même Run Registry entry, comparer les métriques. | Phase 3 |
| SC-4 | Une stratégie ne peut atteindre l'état d'exécution réelle (LIVE) sans être passée, dans l'ordre, par SHADOW puis PAPER, avec des critères de sortie chiffrés satisfaits à chaque étape. | Vérification de la state machine Strategy Instance + logs d'audit du passage de gate. | Phase 6-7 |
| SC-5 | Le Portfolio Arbitration Engine et le Global Risk Engine sont actifs et bloquants avant toute activation LIVE multi-stratégie. | Test d'intégration : deux stratégies LIVE simultanées ne peuvent dépasser l'exposition nette configurée. | Phase 7 |
| SC-6 | L'AI Context Gate ne peut produire que des recommandations SHADOW/ADVISORY (TAKE/TAKE_REDUCED/WAIT/REJECT) qui sont journalisées mais n'influencent l'exécution réelle qu'après une période d'observation et une décision opérateur explicite de promotion. | Revue de code du point d'intégration + test garantissant qu'aucun retour de l'AI Context Gate ne peut, seul, déclencher un `OrderIntent`. | Phase 8 |
| SC-7 | Chaque événement métier (signal, décision, ordre, agent invoqué) porte un `correlation_id` et, le cas échéant, un `causation_id`, permettant de reconstruire une chaîne causale complète. | Requête de traçabilité end-to-end sur un scénario de test. | Phase 5 |
| SC-8 | Le pipeline GPT-first legacy peut être coupé (Phase 12) sans perte de capacité de trading, avec un plan de rollback testé vers le pipeline legacy en moins du délai fixé par l'opérateur (voir OP-6). | Exercice de bascule/rollback chronométré en environnement de simulation. | Phase 11-12 |
| SC-9 | Le coût par décision (tokens/appels LLM) diminue mesurablement pour les décisions à fréquence élevée (evaluation continue de conditions) une fois migrées vers le moteur déterministe/algorithmique, avec métriques de valeur ajoutée documentées par pipeline migré. | Comparaison des métriques de coût avant/après migration par pipeline (voir `09` §« Migration des 3 pipelines »). | Phase 4-5 |
| SC-10 | Aucune régression sur les 12 hard gates et 10 soft gates existants du catalogue de conditions n'est introduite par la transformation, à aucune phase. | Suite de tests de non-régression sur le catalogue, exécutée en CI à chaque PR touchant `packages/desk-domain` ou `packages/desk-contracts`. | Continu |

## 6. Critères de succès — niveau opérateur (valeur métier)

- L'opérateur peut lancer une nouvelle idée de stratégie en simulation historique en moins d'une session de travail, sans intervention d'un développeur.
- L'opérateur peut observer, pour toute stratégie en SHADOW ou PAPER, un tableau de bord des métriques de sortie de phase (win rate, drawdown, Sharpe/Sortino ou équivalent, nombre de trades) sans requêter la base manuellement.
- L'opérateur peut, à tout moment, désactiver une stratégie individuelle sans affecter les autres stratégies actives ni interrompre le moteur global (isolation des pannes).
- L'opérateur peut retracer, pour n'importe quel ordre exécuté sur les 90 derniers jours, la chaîne complète de décision (signal → arbitrage portefeuille → risque global → intention d'ordre → exécution → réconciliation).
- L'opérateur conserve, à tout instant de la transformation, la capacité de revenir en une seule action (flag ou rollback documenté) au comportement actuel du pipeline GPT-first, jusqu'à ce qu'il décide explicitement (Phase 12) de le retirer.

## 7. Non-objectifs explicites (hors scope de ce dossier)

- Choix ou négociation d'un nouveau broker réel — reste une décision opérateur (`OP-7`), ce dossier ne fait que préparer l'abstraction (Execution Provider) qui la rendrait possible sans réécriture.
- Certification réglementaire, conformité légale, fiscalité — hors périmètre technique de ce dossier.
- Dimensionnement infrastructure cloud/VPS au-delà de ce qui est nécessaire pour exécuter la trajectoire décrite — voir `15-SECURITY-OBSERVABILITY-AND-SCALABILITY.md` pour les recommandations, non un engagement de capacité.
- Interface utilisateur / expérience opérateur détaillée au-delà des besoins de traçabilité et de pilotage listés en §6 — le chantier frontend (« ReplayComparePage », etc.) suit son propre cycle, indépendant de ce dossier.

## 8. Comment ce document est utilisé par le reste du dossier

- `03-AS-IS-TO-TARGET-GAP-MAP.md` mesure l'écart entre `02-VERIFIED-AS-IS-SUMMARY.md` et chaque invariant/critère listé ici.
- `16-END-TO-END-MIGRATION-ROADMAP.md` séquence les phases de sorte que chaque invariant (§3) soit respecté dès la phase où il devient applicable, jamais reporté « pour plus tard ».
- `23-TRACEABILITY-AND-COMPLETENESS-MATRIX.md` vérifie que chaque critère de succès (§5-6) est couvert par au moins un ticket, un test, ou une porte de phase — aucun ne doit rester orphelin.
