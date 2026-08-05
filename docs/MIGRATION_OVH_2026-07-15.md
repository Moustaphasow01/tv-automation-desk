# Chantier separe — migration Firebase/Google Cloud vers OVH

Date initiale : 2026-07-15
Mise à jour : 2026-07-23
Statut : préparation locale terminée, provisionnement VPS non commencé
Exécution : kit Windows/PostgreSQL prêt ; aucun cutover externe

## 1. Principe de separation

La migration d'infrastructure est independante du chantier de nettoyage du Desk.

- Depot et code : branches et PR dediees a la migration.
- Pilotage : backlog, risques et validations propres.
- Deploiement : aucune suppression Firebase/Google Cloud pendant le nettoyage applicatif.
- Fonctionnel : aucune nouvelle logique de trading ou refonte d'interface pendant le basculement.
- Retour arriere : Firebase/Google Cloud reste disponible en lecture ou en secours pendant la fenêtre de validation.

Le rapport initial du chantier de nettoyage est conservé dans `docs/archive/2026-07-15/AUDIT_ARCHITECTURE_NETTOYAGE_2026-07-15.md`.

## 2. Objectif

Sortir progressivement de Firebase et Google Cloud sans modifier le comportement metier valide du Desk :

- Firebase Hosting vers un frontend statique servi par Caddy ;
- Firestore vers PostgreSQL, avec JSONB pour les contrats et projections ;
- Firebase Function TradingView vers un endpoint webhook Node.js ;
- Cloud Run MCP/BFF vers des services Windows Node.js natifs sur le VPS ;
- Cloud Run Jobs et Cloud Scheduler vers des workers et un scheduler controles ;
- Firebase Storage vers OVH Object Storage compatible S3 ;
- Firebase Auth, si utilise par le Desk cible, vers une authentification explicitement choisie ;
- Secret Manager vers une solution de secrets chiffree et sauvegardee hors Git.

Les API de modeles externes, notamment GPT ou Anthropic, restent des dependances externes et ne sont pas remplacees par cette migration.

## 3. Hors perimetre

Ce chantier ne doit pas :

- supprimer les scripts historiques avant leur classification dans le chantier de nettoyage ;
- choisir ou modifier la logique de trading ;
- arbitrer entre le Desk GPT/MCP et le committee Python shadow ;
- refaire l'UX du Desk ;
- changer simultanement les contrats d'API et l'hebergeur ;
- supprimer le projet Google avant la fin de la periode de retour arriere.

## 4. Architecture cible retenue

```text
Internet
  -> DNS
  -> VPS Windows
     -> Caddy (TLS, routage, frontend statique)
        -> API/MCP Node.js sur loopback
           -> PostgreSQL 16 natif sur loopback
           -> packs immuables sur disque de données
     -> services WinSW : API, LIVE runtime, broker management, Caddy
     -> session Windows interactive : NinjaTrader 8 + AddOn en Sim101
     -> tâches planifiées : health, sauvegarde et restauration de contrôle

Sauvegardes PostgreSQL
  -> copie locale à rétention bornée
  -> copie chiffrée hors VPS
```

Un VPS unique ne constitue pas une sauvegarde. Les dumps PostgreSQL, packs indispensables et secrets de recuperation doivent etre stockes hors de la machine de production, avec des tests de restauration.

Le runtime applicatif et PostgreSQL seront natifs Windows. Docker reste un outil
de développement local et la source du dump initial ; il n'est pas requis sur le
VPS.

## 5. Prerequis avant basculement

1. Manifeste des services, jobs, schedulers et entrypoints conservés : terminé.
2. Runtime cible Node.js/PostgreSQL natif et moteur V4 : terminé.
3. Baseline de tests et de sorties métier reproductible : terminé.
4. Base Firestore utile importée et organisée dans PostgreSQL local : terminé.
5. Schéma PostgreSQL et tables broker/trades : terminé.
6. Packaging, installation, update, rollback et services Windows : terminé.
7. Sécurité publique fail-closed et authentification opérateur serveur : terminé.
8. Domaine, certificats, IP et stockage hors site : à fournir avec le VPS.
9. Mesure finale de charge et coût sur la machine cible : à exécuter sur le VPS.

La fin complete du nettoyage n'est pas obligatoire pour commencer le cadrage OVH. En revanche, aucun cutover ne doit etre fait avant d'avoir stabilise le runtime a migrer.

## 6. Phases propres au chantier OVH

### M0 — cadrage et préparation locale — terminé

- inventaire et nettoyage du runtime actif ;
- migration Firestore vers PostgreSQL local ;
- architecture Windows/NinjaTrader et règles de rollback ;
- benchmark local et gates de sécurité.

### M1 — socle OVH sans trafic production — en attente du VPS

- provisionner le VPS et le stockage objet ;
- durcir RDP, le pare-feu, les mises à jour et la gestion des secrets ;
- installer Caddy, PostgreSQL natif, Node.js et WinSW ;
- mettre en place supervision, alertes et sauvegardes testees.

### M2 — migration de données — outillage prêt

- exporter la base Docker au gel des écritures ;
- restaurer dans PostgreSQL natif ;
- comparer comptages et agrégats de clés avec le script fourni ;
- appliquer les migrations ordonnées et tracer leurs SHA-256.

### M3 — runtime OVH en shadow — release prête

- deployer frontend, API, MCP, webhook et workers sans trafic principal ;
- rejouer les tests et checkpoints representatifs ;
- verifier idempotence, concurrence, latence et consommation de ressources ;
- plafonner les workers lourds pour proteger l'API et PostgreSQL.

### M4 — cutover contrôlé — non autorisé avant M1 à M3

- geler les changements de schema et de configuration ;
- effectuer la synchronisation finale ;
- basculer le trafic par composant, pas tout en une seule operation ;
- verifier le webhook TradingView, le MCP, le frontend et les jobs ;
- revenir vers Google si un critere critique echoue.

### M5 — observation et décommission

- conserver Google en secours pendant une fenetre definie, recommandee a 14 jours ;
- effectuer un export final et tester une restauration OVH ;
- desactiver puis supprimer les ressources Google par vagues ;
- ne fermer le projet ou la facturation qu'apres preuve d'absence de dependances.

## 7. Décisions résolues et décisions externes

- PostgreSQL standard 16 natif ; aucune extension time-series requise.
- Coordination et file de travaux dans PostgreSQL ; aucun Redis requis.
- Authentification opérateur serveur par cookie signé ; OAuth MCP conservé.
- Caddy, API, workers et NinjaTrader sur le même VPS Windows.
- NinjaTrader reste dans une session interactive et en Sim101 jusqu'aux gates.
- Restent à choisir : offre VPS, domaine, stockage hors site, RPO/RTO et durée
  exacte de coexistence Google/OVH.

Les commandes et critères sont détaillés dans
`docs/VPS_WINDOWS_CUTOVER_RUNBOOK_2026-07-23.md`.

## 8. Gate de demarrage

Statut actuel : `READY_FOR_VPS_PROVISIONING`, `NO_GO_CUTOVER`.

- `GO` pour provisionner, installer, restaurer, exécuter le mode shadow et Sim101.
- `NO-GO` pour changer les DNS, exécuter sur un compte broker LIVE ou supprimer
  Google tant que les gates du runbook ne sont pas validées.
