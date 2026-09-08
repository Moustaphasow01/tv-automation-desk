# Certification — Sémantique risque portefeuille actif / historique

Date de certification : 2026-09-08  
Ticket : TD2-440  
Commit fonctionnel final : `eeeb5308e64547d05d42b38e76f856472820232e`  
Release VPS : `portfolio-risk-truth-20260908.2`  
Déploiement : `deploy-20260908T014118Z-5b3f3326`

## Anomalie corrigée

La projection Front/BFF mélangeait des décisions de risque et des divergences de réconciliation historiques avec l'état opérationnel courant. Un desk sans ordre ni position ouverte pouvait donc afficher à tort des cibles en attente, un risque ouvert et une action urgente.

## Sémantique certifiée

- Les cibles, intentions, réservations et décisions de risque actives proviennent uniquement des intentions encore actives.
- Les divergences opérationnelles utilisent la dernière observation par compte et sont ignorées lorsque l'exécution physique est désactivée.
- Les divergences et décisions historiques restent conservées séparément pour l'audit.
- Un périmètre actif vide mais joignable est rendu comme une valeur connue à zéro, et non comme une donnée indisponible.
- Lorsque le broker est volontairement désactivé, l'état est `BROKER_SUBMIT_BLOCKED` et le centre de risque est `CONTROLLED`, sans fausse alerte `ACTION_REQUIRED`.

## Vérifications automatisées

- Tests ciblés de projection portefeuille/risque : **5/5 réussis**.
- Suite backend complète : **1 570 réussis, 0 échec, 50 ignorés**, soit 1 620 tests.
- Audit des dépendances de build : **0 vulnérabilité**.

## Preuves VPS après déploiement

- `/healthz` : `ok=true`, `live=true`, release `.2`.
- `/readyz` : `ready=true`, `ok=true`, release `.2`.
- Services Windows : **11/11 Running + Automatic**.
- Tâches calendrier grains, runtime shadow et santé : état `Ready`, dernier résultat `0`.
- Huit instances `US_GRAINS_DETERMINISTIC_SUITE` déléguées ; runtime `HEALTHY_IDLE` et pipeline `NO_PENDING_SIGNALS` hors session.
- Calendrier macro/agricole : `READY`, 80 événements disponibles, prochaine date de trading couverte.
- Telegram : service sain, canaux worker/admin/trading configurés.

## Vérité opérationnelle observée

```text
summary.status                         BROKER_SUBMIT_BLOCKED
openTrades                             0
pendingIntents                         0
activeOrders                           0
pendingTargetPositions                 0
pendingHumanGates                      0
reconciliationDivergences              0
historicalReconciliationDivergences    100

portfolio_state.openRisk               KNOWN / 0 USD
risk_center.availability               KNOWN
risk_center.globalStatus               CONTROLLED
risk_center.openRisk                   KNOWN / 0 USD
risk_center.pendingOrderIntents        0
risk_center.pendingTargetPositions     0
risk_center.historicalRiskDecisionCount 100
risk_center.limits                     0
risk_center.breaches                   0
```

## Politique de sécurité active

```text
Risque maximal par position   500 USD
Perte maximale journalière    2 000 USD
Perte maximale hebdomadaire   4 000 USD
Exécution physique broker     OFF
Bridge Ninja                  DISABLED
Kill switch                   ON
Contrats physiques maximum    0
Compte live autorisé          false
```

Le desk est donc certifié pour une journée **SHADOW / semi-manuelle** : détection, filtres, suivi théorique, Human Gate, Live Focus et notifications. Il n'est volontairement pas autorisé à envoyer automatiquement un ordre physique.

## Preuve temporelle restante

Le marché grains étant fermé pendant la certification, la seule preuve externe restante est la réception de la première bougie fraîche ZC/ZW M1/M5 après l'ouverture RTH du 8 septembre 2026 à **15:30 Europe/Paris**, puis l'observation du premier cycle réel. Ce point ne constitue pas un défaut logiciel connu et ne justifie pas l'activation de l'exécution physique.

## Historique du déploiement

1. Une première installation `.1` a été refusée proprement faute de sidecar de checksum ; le pipeline a restauré la release précédente.
2. La release `.1` corrigée a été installée et a révélé que la sous-vue `risk_center` conservait encore l'ancienne sémantique.
3. Le commit `eeeb530` a harmonisé toutes les projections actives/historiques.
4. La release `.2`, SHA-256 `1e881858ab7fab63f0c640d3882b3ae3cae422ced35407dff3f83d8b70fc75d5`, a passé migrations, canary et smoke public.
