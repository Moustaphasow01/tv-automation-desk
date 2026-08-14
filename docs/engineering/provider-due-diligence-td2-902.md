# TD2-902 — Due diligence providers exécution

Date d'audit : 2026-08-10.

## Décision recommandée

| Provider / option | Recommandation | Rôle cible |
|---|---|---|
| NinjaTrader AddOn actuel | `KEEP_TRANSITION` | Pont court terme, paper/simulation, déjà sous contrôle VPS |
| Tradovate direct API | `GO_FOR_PAPER_PROTOTYPE` | Candidat principal backend-to-backend moyen terme |
| Rithmic direct API | `WATCH_FOR_LATER` | Candidat performance, plus lourd contractuellement et techniquement |
| PickMyTrade | `NO_GO_AS_PRIMARY_EXECUTION` | Possible bridge externe, pas source primaire tant que callbacks/fills/réconciliation ne sont pas prouvés |
| Apex Group Copier | `NO_GO_AS_EXECUTION_PROVIDER` | Outil opérateur/copie, pas provider API du desk |

## Décision opérateur TD2-908

Le 2026-08-10, l'opérateur a approuvé `GO_PICKMYTRADE_LIMITED_BRIDGE_PAPER` pour TD2-903.

Cette décision ne change pas la recommandation provider primaire :

- PickMyTrade reste `NO_GO_AS_PRIMARY_EXECUTION` ;
- NinjaTrader reste le pont de transition court terme ;
- Tradovate direct API reste le candidat backend-to-backend moyen terme ;
- TD2-903 implémente seulement un adapter paper borné, sans activation live.

## Critères desk

Le provider cible doit couvrir :

- backend-to-backend sans dépendance à un écran local ;
- idempotence d'envoi ;
- ack/reject/fill/partial fill ;
- positions et ordres actifs ;
- bracket/protections ;
- multi-compte contrôlable ;
- limites de débit mesurables ;
- environnement paper/simulation durable ;
- réconciliation exploitable par `broker_provider_events`.

## Tradovate direct API

Points favorables :

- API officielle REST + WebSocket.
- Environnements séparés : `live.tradovateapi.com`, `demo.tradovateapi.com`, `md.tradovateapi.com`.
- Le Partner API expose la gestion temps réel via WebSocket, ainsi que comptes, permissions, risk settings et market data.
- Tradovate annonce que les ordres sont tenus côté cloud si la connexion de l'utilisateur tombe.
- Sim/demo disponible côté plateforme.

Risques :

- Selon le chemin d'accès, il peut falloir un compte actif, API access, ou des credentials partner (`API Key`, `CID`).
- Limite opérationnelle rapportée côté Apex/Tradovate : 5000 actions uniques par fenêtre de 60 minutes ; chaque ordre/modification/annulation compte, et le multi-compte multiplie les actions.
- Le Group Trade Apex/Tradovate ne supporte pas les bracket/ATM et n'est pas utilisable depuis TradingView, donc il ne remplace pas notre Execution Gateway.

Recommandation :

`GO_FOR_PAPER_PROTOTYPE`, avec adapter direct `ExecutionProviderCommand -> Tradovate REST/WebSocket` et un simulateur de rate-limit avant tout live.

## Rithmic direct API

Points favorables :

- R|API+ est positionné comme suite développeur pour market data, order routing et account APIs.
- Rithmic est conçu pour exécution faible latence et usage futures professionnel.
- Apex/Rithmic fournit comptes et RTrader Pro ; les comptes peuvent aussi se connecter à NinjaTrader.

Risques :

- Accès développeur plus lourd : SDK/API, credentials, éventuellement conformance ou contact Rithmic.
- Rithmic/Apex mentionne une contrainte importante de session : une seule session market data à la fois, sauf add-on de deuxième session.
- Intégration plus longue qu'un REST/WebSocket cloud type Tradovate.

Recommandation :

`WATCH_FOR_LATER`. Rithmic est intéressant si la priorité devient latence/performance, mais il n'est pas le chemin le plus court pour stabiliser le desk.

## PickMyTrade

Points favorables :

- Cloud 24/7, pas besoin que le PC reste allumé.
- Supporte Tradovate et une plateforme multi-broker incluant Rithmic.
- Coût indiqué dans leur documentation : par exemple `$30/mo` Tradovate et `$50/mo` multi-broker selon login.
- Un login peut couvrir plusieurs sous-comptes selon l'organisation broker.
- Les webhooks officiels sont publiés par plateforme.

Risques :

- Les URLs documentées sont des webhooks d'entrée, pas une API générale de gestion d'ordres.
- Le JSON ne doit pas être modifié manuellement selon leur documentation ; cela réduit notre contrôle contractuel.
- Pas de preuve suffisante, dans les sources consultées, d'un flux complet ack/reject/fill/position callback conforme à notre `broker_provider_event_v1`.
- Risque de boîte noire : idempotence, rate limits, retries, partial fills et divergence seraient externalisés.

Recommandation :

`NO_GO_AS_PRIMARY_EXECUTION` tant que PickMyTrade ne prouve pas :

- endpoint backend sécurisé accepté sans passer par TradingView ;
- idempotency key desk conservée ;
- callbacks ou API de lecture ack/fills/positions ;
- garanties multi-compte et rollback ;
- mapping bracket/protections exact.

PickMyTrade peut être testé en `GO_PICKMYTRADE_LIMITED_BRIDGE_PAPER` comme pont cloud secondaire, mais uniquement derrière l'Execution Gateway et sans passage live.

## Apex Group Copier

Points favorables :

- Fonction intégrée pour comptes Tradovate Apex multiples.
- Utile côté opérateur si on veut copier manuellement.

Risques bloquants :

- Group Trade Apex/Tradovate interdit les bracket orders/ATMs.
- Group Trading n'est pas disponible depuis TradingView.
- Les quantités doivent être multiples du total du groupe.
- Le multi-compte consomme les limites API par compte/action.

Recommandation :

`NO_GO_AS_EXECUTION_PROVIDER`. À utiliser seulement comme contrainte opérateur ou secours manuel.

## Sources consultées

- Tradovate Partner API — introduction et accès : https://partner.tradovate.com/
- Tradovate plateforme — demo, cloud orders, pricing : https://www.tradovate.com/
- Tradovate integration tools : https://www.tradovate.com/platform/add-on-integration-tools/
- Apex — Tradovate API request limit : https://apextraderfunding.com/help-center/tradovate/tradovate-api-request-limit/
- Apex — Tradovate Group Copier : https://apextraderfunding.com/help-center/tradovate/tradovate-group-copier/
- Rithmic R|API+ : https://www.rithmic.com/products/api-suite
- Rithmic API inquiries : https://www.rithmic.com/support/contact
- Apex — Rithmic account setup/session notes : https://apextraderfunding.com/help-center/rithmic/rithmic-account-setup/
- PickMyTrade docs : https://docs.pickmytrade.io/docs/
- PickMyTrade Tradovate docs : https://docs.pickmytrade.trade/docs/

## Historique de décision

Options étudiées pour TD2-908 :

1. `GO_TRADOVATE_DIRECT_PAPER` — recommandé.
2. `GO_PICKMYTRADE_LIMITED_BRIDGE_PAPER` — approuvé comme pilote paper limité, non provider primaire.
3. `WAIT_RITHMIC_DIRECT` — plus long, potentiellement meilleur plus tard.
4. `KEEP_NINJATRADER_ONLY_FOR_NOW` — le plus sûr à court terme.
