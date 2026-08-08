# ADR-0016 — Execution Gateway encapsule l'AddOn NinjaTrader existant comme premier provider, sans réécriture

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : INV-2 (`01` §3)

## Contexte

Le chemin d'exécution réel actuel est directement couplé à l'AddOn NinjaTrader C# compilé via HTTP+HMAC (`02` §6). Le plan directeur demande une abstraction Execution Gateway/Execution Provider permettant d'ajouter de futurs providers (PickMyTrade, broker direct) sans réécrire le cœur du système.

## Décision

L'Execution Gateway (`04` §3, `13-EXECUTION-GATEWAY-PROVIDERS-AND-RECONCILIATION.md`) est une couche d'abstraction ajoutée **devant** le code d'intégration NinjaTrader existant, qui devient le premier `Execution Provider` concret, encapsulé sans modification de son protocole HTTP+HMAC ni de son AddOn C# compilé. Le comportement observable du chemin d'exécution réel doit être strictement identique avant et après l'introduction de cette abstraction — vérifié par tests de non-régression.

## Alternatives rejetées

- **Réécrire l'intégration NinjaTrader en même temps que l'introduction de l'abstraction** : rejetée — combinerait un changement structurel (abstraction) avec un changement comportemental (réécriture), rendant toute régression difficile à attribuer ; violerait aussi le principe de petits changements testables.
- **Différer l'abstraction jusqu'à ce qu'un deuxième provider soit réellement nécessaire (YAGNI strict)** : considérée mais non retenue comme approche par défaut — le plan directeur et le Ticket PickMyTrade (Phase 10, ADR-0017) rendent un deuxième provider suffisamment probable pour justifier l'abstraction en Phase 9, avant qu'elle ne devienne urgente sous pression de calendrier.

## Conséquences

- Phase 9 introduit l'Execution Gateway avec un seul provider concret (NinjaTrader), validé par tests de non-régression prouvant l'absence de changement de comportement réel.
- Le protocole HTTP+HMAC et l'AddOn C# restent la source de vérité de l'intégration NinjaTrader ; l'Execution Gateway ne les réimplémente pas, il les invoque.

## Preuve AS-IS

Chaîne d'exécution confirmée : `materializeEligiblePositions` → `materializeTradeDecision` → `evaluateBrokerPolicy` → `createOrderIntent` → approbation → outbox → NinjaTrader AddOn (HTTP+HMAC). Voir `02` §6.
