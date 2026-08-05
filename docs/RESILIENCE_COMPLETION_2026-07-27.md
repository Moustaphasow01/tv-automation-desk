# Desk Futures — clôture du chantier résilience

Date de validation : 27 juillet 2026  
Release VPS validée : `vps-staging-20260727.12`

## Périmètre livré

1. Résilience des entrées : timeouts bornés, réponses dégradées, cache de
   projections, limitation de débit, circuits de dépendances et état de
   readiness distinct de la simple santé du processus.
2. Traitements lourds : préparation Replay sortie du cycle HTTP/MCP et confiée
   à un worker persistant, avec lease, reprise après crash et idempotence.
3. Moteur et exécution : files LIVE et Replay séparées, continuité de position,
   outbox transactionnelles, réconciliation et commandes NinjaTrader
   idempotentes.
4. Exploitation : drain avant bascule, canary, rollback vérifié, sauvegardes
   PostgreSQL et objets, restauration réelle périodique, rétention et
   maintenance.
5. Résultat de trade : calcul canonique et déterministe en `R`, applicable au
   LIVE comme au Replay, sans reconstruction depuis les logs.
6. IHM : six espaces métier, navigation global → détail, fil d’Ariane, écrans
   de zoom dédiés, thème clair par défaut, responsive à 320 px et suppression
   des identifiants techniques dans les parcours usuels.

## Validation finale

- Certification résilience : `49/49`.
- Tests unitaires front : `20/20`.
- Tests E2E : `5/5`, dont les 36 routes et les largeurs 320, 768, 1280 et
  1600 px.
- Build production : 129 modules, sans clé locale ou clé E2E incorporée.
- VPS : six services `Running` et `Automatic`.
- Readiness : `ready=true`, données marché du jour disponibles.
- Files de claims : `live=RUNNING`, `replay=RUNNING`.
- Scheduler LIVE : préchauffage autonome confirmé au checkpoint de 11 h 30,
  statut `PREWARMED`, sans claim manuel.
- Sauvegarde de restauration contrôlée : 77 638 documents, 177 519 bougies,
  18 migrations.
- NinjaTrader : processus actif, connexion `Simulation`, compte `Sim101`,
  AddOn compilé et sources release/staging/custom identiques.
- Broker lors de la validation : 0 trade ouvert, 0 ordre en attente, 0 action
  de gestion en attente.
- Benchmark public chaud :
  - Live Desk : p95 32 ms ;
  - liste Replay : p95 32 ms ;
  - résumé opérations : médiane 23 ms.

## Contrats stratégiques protégés

- Master : `DeskMasterAnalysisContract_v4_0_0`,
  SHA-256 `702f9fe325f61fdb53e913592da268b5a4aa2bafe5dd879ece915adc64d1c8e8`.
- Monitor : `DeskHourlyThesisMonitorContract_v1_0_0`,
  SHA-256 `be807ab3cb0450d0c84817d882a4b6dea70ea3ccae377d07da545798d80a6bd0`.

Les contrats actifs et leurs hashes persistés sont inchangés.

## Dégradation externe encore observable

GDELT peut répondre `429`. Cette source est désormais optionnelle : le circuit
évite la boucle d’appels, le calendrier macro et le moteur restent opérationnels,
aucune news n’est inventée et la readiness centrale reste saine.
