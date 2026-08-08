# ADR-0012 — Event Envelope standardisé construit au-dessus du transport LISTEN/NOTIFY + outbox existant

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : SC-7 (`01` §5)

## Contexte

Le système actuel dispose déjà de deux mécanismes de transport événementiel fonctionnels : `LISTEN/NOTIFY` Postgres (`pg_notify('desk_ai_work_ready')`) comme accélérateur de réveil, et un pattern d'outbox à bail (`broker_execution_outbox`/`broker_management_outbox`) pour l'exécution broker. Aucun des deux ne porte actuellement une structure d'enveloppe uniforme (`correlation_id`/`causation_id`) traversant tous les domaines.

## Décision

L'Event Envelope cible (`05-DOMAIN-MODEL-AND-STATE-MACHINES.md` §4.6, `14-EVENTS-APIS-AND-MCP-SURFACE.md`) est une structure de données logique ajoutée **au-dessus** des mécanismes de transport existants, pas un nouveau système de message queue remplaçant `LISTEN/NOTIFY` ou l'outbox. Chaque paquet transporté par ces mécanismes existants est enrichi pour porter un `correlation_id`/`causation_id` cohérent.

## Alternatives rejetées

- **Introduire un nouveau bus de message (ex. Kafka, RabbitMQ)** : rejetée — hors scope de ce dossier (voir `01` §7, non-objectifs), le transport actuel n'a démontré aucune limite justifiant ce changement d'infrastructure ; violerait aussi ADR-0024 (topologie de déploiement conservée).
- **Ajouter la traçabilité uniquement au niveau applicatif (logs), sans structure de données portée par les événements eux-mêmes** : rejetée — rendrait la reconstruction de chaîne causale (SC-7) dépendante de la corrélation manuelle de logs, fragile et non garantie.

## Conséquences

- Tout nouveau composant du dossier (Research Lab, Live Strategy Runtime, Arbitrage) émet et propage l'Event Envelope de façon cohérente dès sa création — pas ajouté après coup.
- Les mécanismes de transport existants (LISTEN/NOTIFY, outbox, `pg_try_advisory_lock`) restent inchangés dans leur fonctionnement bas niveau.

## Preuve AS-IS

`pg_notify('desk_ai_work_ready')`, table de tâches durable, outbox à bail — tous confirmés existants et fonctionnels par lecture directe de `run_desk_ai_worker.mjs` et par l'audit du chemin broker. Voir `02` §4, §6.
