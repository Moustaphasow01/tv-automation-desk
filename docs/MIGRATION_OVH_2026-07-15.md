# Chantier separe — migration Firebase/Google Cloud vers OVH

Date : 2026-07-15  
Statut : cadrage uniquement  
Execution : non commencee

## 1. Principe de separation

La migration d'infrastructure est independante du chantier de nettoyage du Desk.

- Depot et code : branches et PR dediees a la migration.
- Pilotage : backlog, risques et validations propres.
- Deploiement : aucune suppression Firebase/Google Cloud pendant le nettoyage applicatif.
- Fonctionnel : aucune nouvelle logique de trading ou refonte d'interface pendant le basculement.
- Retour arriere : Firebase/Google Cloud reste disponible en lecture ou en secours pendant la fenetre de validation.

Le chantier de nettoyage est decrit dans `docs/AUDIT_ARCHITECTURE_NETTOYAGE_2026-07-15.md`.

## 2. Objectif

Sortir progressivement de Firebase et Google Cloud sans modifier le comportement metier valide du Desk :

- Firebase Hosting vers un frontend statique servi par Caddy ;
- Firestore vers PostgreSQL, avec JSONB pour les contrats et projections ;
- Firebase Function TradingView vers un endpoint webhook Node.js ;
- Cloud Run MCP/BFF vers des conteneurs sur VPS ;
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

## 4. Architecture cible de travail

```text
Internet
  -> Caddy (TLS, routage, frontend statique)
     -> API Node.js (Desk API, MCP, webhook TradingView)
        -> PostgreSQL
        -> file de travaux PostgreSQL ou Redis si justifie
     -> workers Node/Python strictement conserves par le manifeste runtime

PostgreSQL et packs
  -> sauvegardes chiffrees hors VPS
  -> OVH Object Storage compatible S3
```

Un VPS unique ne constitue pas une sauvegarde. Les dumps PostgreSQL, packs indispensables et secrets de recuperation doivent etre stockes hors de la machine de production, avec des tests de restauration.

## 5. Prerequis avant basculement

1. Manifeste des services, jobs, schedulers et entrypoints reellement conserves.
2. Decision documentee sur le moteur Python shadow.
3. Baseline de tests et de sorties metier reproductible.
4. Mesure des volumes Firestore, Storage, trafic et couts Google reels.
5. Schema de correspondance Firestore vers PostgreSQL valide.
6. Inventaire des identites, secrets, domaines, certificats et webhooks externes.
7. Objectifs de disponibilite, sauvegarde et temps maximal de retour arriere.

La fin complete du nettoyage n'est pas obligatoire pour commencer le cadrage OVH. En revanche, aucun cutover ne doit etre fait avant d'avoir stabilise le runtime a migrer.

## 6. Phases propres au chantier OVH

### M0 — cadrage et mesure

- exporter la facturation Google utile ;
- mesurer les volumes de donnees et la charge maximale ;
- choisir le dimensionnement VPS et le budget de sauvegarde ;
- figer les criteres de performance, cout, disponibilite et rollback.

### M1 — socle OVH sans trafic production

- provisionner le VPS et le stockage objet ;
- durcir SSH, le pare-feu, les mises a jour et la gestion des secrets ;
- installer le reverse proxy, PostgreSQL et les conteneurs ;
- mettre en place supervision, alertes et sauvegardes testees.

### M2 — migration de donnees en miroir

- creer le schema PostgreSQL ;
- backfiller Firestore sans changer les lectures de production ;
- comparer comptages, identifiants, horodatages et projections ;
- documenter la procedure de reprise incrementale avant cutover.

### M3 — runtime OVH en shadow

- deployer frontend, API, MCP, webhook et workers sans trafic principal ;
- rejouer les tests et checkpoints representatifs ;
- verifier idempotence, concurrence, latence et consommation de ressources ;
- plafonner les workers lourds pour proteger l'API et PostgreSQL.

### M4 — cutover controle

- geler les changements de schema et de configuration ;
- effectuer la synchronisation finale ;
- basculer le trafic par composant, pas tout en une seule operation ;
- verifier le webhook TradingView, le MCP, le frontend et les jobs ;
- revenir vers Google si un critere critique echoue.

### M5 — observation et decommission

- conserver Google en secours pendant une fenetre definie, recommandee a 14 jours ;
- effectuer un export final et tester une restauration OVH ;
- desactiver puis supprimer les ressources Google par vagues ;
- ne fermer le projet ou la facturation qu'apres preuve d'absence de dependances.

## 7. Decisions encore ouvertes

- VPS-2 ou VPS-3 selon le nombre de workers conserves et les replays ;
- PostgreSQL standard ou extension time-series ;
- file de travaux dans PostgreSQL ou Redis ;
- authentification applicative legere ou fournisseur auto-heberge ;
- niveau de haute disponibilite attendu au-dela des sauvegardes ;
- duree exacte de coexistence Google/OVH.

Ces decisions seront prises dans le chantier OVH sur la base des mesures M0, sans bloquer les suppressions a faible risque du chantier de nettoyage.

## 8. Gate de demarrage

Statut actuel : `GO_CADRAGE`, `NO_GO_CUTOVER`.

- `GO` pour mesurer, concevoir le schema, estimer les couts et preparer une preuve de concept isolee.
- `NO-GO` pour migrer les donnees de production, changer les DNS ou supprimer une ressource Google tant que les prerequis de la section 5 ne sont pas valides.
