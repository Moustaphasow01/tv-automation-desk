# Human Gate, Telegram et résultats opérateur — preuve de clôture

## Statut

- Points 2 à 5 : terminés, testés et déployés.
- Point 1 : validation réelle à effectuer à la prochaine réouverture du marché ; aucun blocage logiciel connu.
- Release VPS : `preprod-v2-human-gate-outcomes-20260830.3`.
- Commit applicatif déployé : `93202910d41c00f539083123146b0871c06b039b`.
- Archive : SHA-256 `b705d353c23df50be79d6fea8a283295a6d78760515dad3e99abcb8b2bca303f`.
- Manifeste applicatif : SHA-256 `e4c721f852f15b739b2857b98a9209584a60cd6bd4c1e74e29b2363d66a31276`.
- Niveau de migration : `059_human_gate_undo_window`.

## Sécurité d'exécution

- `AUTO_EXECUTION=false`.
- `PHYSICAL_LIVE=false`.
- Le mode worker IA reste `shadow`.
- Aucun ordre provider ou broker n'a été envoyé pendant la recette.
- Aucun Human Gate réel n'a été confirmé pendant la recette.
- Une confirmation opérateur reste distincte de `ACK`, `PARTIAL_FILL` et `FILL`.

## Point 2 — Human Gate et décisions opérateur

- Ajout d'une transition canonique `UNDO` après confirmation, avec fenêtre de 10 secondes configurable entre 3 et 60 secondes.
- Refus systématique de l'annulation si la fonctionnalité est désactivée, si la révision a changé, si l'intention a expiré, si la fenêtre est dépassée ou si une commande provider existe déjà.
- Persistance de `undo_expires_at_utc`, `undone_at_utc` et de l'événement d'audit `REVERTED`.
- Les actions `CONFIRM`, `REJECT` et `UNDO` sont pilotées exclusivement par les capacités et `allowedActions` backend.
- Sans session opérateur, les actions restent refusées ; `execution.live` reste verrouillée.

## Point 3 — Résultats historiques et attribution opérateur

- Projection canonique de suivi théorique reliée aux OrderIntents, aux décisions Risk/Human Gate et aux événements théoriques/manuels.
- `CAPTURED` n'est attribué que lorsqu'une preuve manuelle `PLACED`, `FILLED` ou `CLOSED` existe.
- Les issues non exécutées sont distinguées entre `MISSED_OPPORTUNITY` et `AVOIDED_LOSS`.
- Une confirmation sans preuve de fill reste `EXECUTION_UNVERIFIED`.
- La performance publiée utilise la source explicite `THEORETICAL_BACKEND`; les champs R absents restent `null` et ne deviennent pas de faux zéros.
- État réel de la base lors de la recette : aucune déclaration manuelle historique. Le frontend affiche donc honnêtement un état vide pour l'attribution opérateur, sans fabriquer de résultat `CAPTURED`.
- Événements théoriques disponibles : 967 entrées remplies, 5 entrées expirées, 472 stops, 158 targets et 139 sorties à revoir. Ils restent séparés de l'exécution broker.

## Point 4 — Telegram

- Les alertes utilisent désormais la lignée canonique OrderIntent → Risk/Human Gate → suivi théorique/manual.
- Le format rappelle explicitement la simulation, l'absence de fill broker et les actions attendues.
- Les nouvelles sources sont initialisées silencieusement pour éviter de rejouer tout l'historique au premier démarrage.
- Une temporisation de 1 200 ms entre livraisons et la gestion de `retry_after` protègent contre les réponses Telegram `429`.
- Un incident de reprise historique a été détecté pendant la recette : 300 messages historiques en échec ont été conservés puis classés `suppressed` avec la raison `CANONICAL_HISTORY_BASELINED_AFTER_SOURCE_ROLLOUT`. Ils n'ont pas été supprimés et ne seront pas renvoyés.
- Après correction : aucune notification canonique nouvelle en attente et aucune répétition historique.
- Test d'acceptation VPS réussi sur les deux canaux : message admin `1096`, message trading `1962`.

## Point 5 — Santé runtime, cohérence et opérations

- Les anciens services optionnels arrêtés ne dégradent plus artificiellement le Desk.
- Un service attendu mais arrêté, ou un service bloqué en `stopping`, reste correctement dégradant.
- Les trois anciens heartbeats optionnels ont été retirés proprement de l'état actif avec une trace d'audit.
- `/healthz`, `/readyz`, `/status` et `/front-api/v1/capabilities` répondent correctement.
- État VPS final : `ready=true`, `ok=true`, `operationsOk=true`, aucune dépendance obligatoire manquante.
- Les neuf services runtime attendus sont sains et portent la release `.3`.
- Le marché est classé `market_closed` avec la raison `cme_weekend_closed`, et non comme une panne de données.

## Preuves de tests

- Backend/MCP : 1 215 tests réussis sur 1 215.
- Tests ciblés Telegram et santé opérationnelle : 10 réussis sur 10.
- E2E navigateur réel : 3 scénarios réussis sur 3, dont authentification opérateur, commande sûre `control_plane.verify`, reçu d'audit et reflow 320 px.
- Les contrôles architecture, migrations SQL, sécurité runtime, secrets navigateur, chaîne de livraison et déploiement Windows sont réussis.
- Le contrôle de qualité statique signale encore de la dette historique sur plusieurs gros fichiers et fonctions. Aucun seuil n'a été abaissé et les nouveaux modules Telegram/santé n'ajoutent pas d'excès à cette dette.

## Déploiement et reprise

- Déploiement complet `.2` : `deploy-20260830T015922Z-a6ad0e78`.
- Sauvegarde PostgreSQL : `C:\ProgramData\DeskFutures\backups\desk-native-20260830T015039Z.dump`, SHA-256 `007fbab07fa391a7002c83c61099e5d8214f93dcbca31da2999f1b6b6f14408d`.
- Sauvegarde objets : `C:\ProgramData\DeskFutures\backups\desk-objects-20260830T015721Z.tar.gz`, SHA-256 `113858ffef93aa72b5266a519b981435d81682bbcd0f5c03229dcfea9dead852`.
- Déploiement correctif `.3` : `deploy-20260830T023348Z-46b2c825`, avec drain, migrations, canary et smoke tests réussis. Les sauvegardes complètes précédentes, vérifiées et vieilles de quelques minutes, ont été réutilisées.

## Seule validation restante — point 1

À la prochaine réouverture réelle du CME, observer sans activer l'exécution physique :

1. réception des premières bougies M1 puis M5 clôturées ;
2. évaluations déterministes des stratégies ;
3. éventuel signal puis passage Context → Portfolio → Risk → TargetPosition → OrderIntent ;
4. notification Telegram associée ;
5. création et évolution du suivi théorique ;
6. cohérence du rendu Live et de la chronologie.

Cette validation dépend uniquement du retour du marché. Les composants nécessaires sont actifs et prêts.
