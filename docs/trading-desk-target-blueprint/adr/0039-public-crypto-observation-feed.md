# ADR 0039 — Cotations crypto publiques en lecture seule

Date : 2026-09-09. Statut : accepté pour le raccordement de données demandé explicitement par l’opérateur.

## Décision et frontière

Créer `@tv-automation/desk-market-data`, propriétaire `market-data`, avec domaine de validation, cache applicatif d’observation et adapter public Kraken. Le host existant assemble l’adapter via son export public. Une vue authentifiée `/front-api/v1/views/crypto-market` expose les seules observations ; le navigateur ne contacte aucun fournisseur directement.

Périmètre initial : Bitcoin, Solana et Dogecoin au comptant en USD sur Kraken. Le WebSocket public v2 fournit les cotations et les bougies ; REST amorce l’historique, limité par la source aux 720 entrées récentes. Ce choix évite clé privée, compte courtier, conversion implicite USDT/USD et agrégation de prix de places différentes. Binance propose aussi des endpoints de données seuls ; une seconde place n’est pas utilisée comme substitution silencieuse.

Le cache mémoire est une projection externe éphémère, bornée et explicitement non canonique. Il ne nourrit ni stratégies, ni risque, ni signaux, ni portefeuille, ni backtest. PostgreSQL reste la vérité métier ; aucune insertion de tick ou de bougie en base n’est ajoutée. Le trading et la collecte durable pour la recherche sont des chantiers séparés.

## Contrats et cycle de vie

- Catalogue fermé de trois instruments, unités publiées, précision des prix et provenance explicites ; pas d’URL fournisseur construite depuis une entrée libre.
- La vue distingue catalogue, historique et mises à jour légères. Les mises à jour visibles sont échantillonnées au plus une fois par seconde côté navigateur ; elles proviennent d’un flux serveur partagé, pas d’un appel par seconde au fournisseur.
- Prix reçu, date fournisseur, date de réception, état du flux et bougie en formation restent distincts. Aucune interpolation, aucun faux tick, aucune clôture inventée. La variation est celle publiée par la source.
- États : repos → connexion → connecté ; erreur ou silence prolongé → reconnexion avec délai borné ; inactivité → repos. Chaque état non nominal garde les dernières valeurs avec leur date, jamais un zéro de remplacement. Les anciens messages et dates incohérentes sont rejetés.
- Cache de bougies borné, requêtes historiques dédupliquées, délais réseau bornés, reprise après coupure et arrêt du flux inutilisé. Aucun secret ni endpoint d’ordre dans l’adapter.

## Validation et alternatives

Cycle observable : `IDLE → CONNECTING → CONNECTED → RECONNECTING → CONNECTING` ; après 90 s sans lecteur, retour à `IDLE`. Une cotation n'est `LIVE` que si la place est en état `online`, le transport répond et sa date a moins de 30 s. Un heartbeat conserve la connexion, jamais la fraîcheur d'un prix. Les commandes restent absentes dans tous les états.

Tests de normalisation, contrat, précision DOGE, messages anciens, horloges, panne/reconnexion, bornes et absence de commande. Vérification réelle de REST et WebSocket depuis le poste et le VPS, puis recette mobile dans Live et Focus.

Écartés : appeler Kraken depuis React, ajouter de fausses bougies dans le dataset canonique, assimiler le comptant à un future/perpétuel, modifier les instruments exécutables, activer une stratégie crypto, introduire un service autonome ou une dépendance WebSocket supplémentaire alors que le runtime fournit cette capacité.

Retour arrière : release précédente ; aucun schéma SQL ni compte externe à rétablir. Les règles de risque, stratégies et autorisations d’exécution existantes restent inchangées, mais le code serveur évolue pour la nouvelle source de données.

Sources : [Kraken ticker](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ticker), [Kraken OHLC WebSocket](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ohlc), [limites OHLC REST](https://docs.kraken.com/api-reference/market-data/get-ohlc-data), [Binance données publiques](https://developers.binance.com/en/docs/products/spot/rest-api).
