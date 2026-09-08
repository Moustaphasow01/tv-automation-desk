# PASSAGE — Trading Desk VNext

> Document maître de reprise inter-poste et inter-chat.
> Dernière mise à jour : 8 septembre 2026.
> Toute affirmation ci-dessous est rattachée au dépôt Git, à une preuve
> versionnée ou à une observation explicite du VPS.

## 1. Identification de la tâche Codex

- **Nom de la tâche Codex** : `Expliquer architecture projet (2)`
- **ID de la tâche Codex** : `019ff999-cfc9-74c1-8a76-8c098c380a11`
- **Hôte observé** : `local`
- **Ancien répertoire de travail** :
  `/mnt/c/Users/CES/Desktop/TV_Automation_LIVE_FOCUS_VNEXT`
- **Projet Jira** : `TD2`
- **Ticket de reprise poste neuf** : `TD2-441`, terminé avec preuves

L'historique conversationnel est utile, mais il ne constitue pas une source de
vérité. Le prochain agent doit repartir de `main`, des documents ci-dessous et
des preuves runtime, puis vérifier l'état courant avant toute mutation.

## 2. Sources de vérité et versions

| Élément | Valeur canonique au 8 septembre 2026 |
|---|---|
| Dépôt actif | `https://github.com/Moustaphasow01/tv-automation-desk.git` |
| Branche active | `main` |
| Baseline distante contrôlée avant ce document | `f6a603aa7d99be35ed044e40a13fbb1b42faa100` |
| Branche de documentation/reprise | `codex/workstation-recovery-handoff` |
| VPS | `https://vps-6d6969db.vps.ovh.net` |
| Release VPS servie | `portfolio-risk-truth-20260908.2` |
| Dernier correctif fonctionnel déployé | `eeeb5308e64547d05d42b38e76f856472820232e` |
| Preuve de certification déployée | `2ee9a722efdaa5e7d69bcbca13f475d53bce6738` |
| Données opérationnelles | PostgreSQL 16 sur le VPS |
| Objets runtime | `C:\ProgramData\DeskFutures\objects` sur le VPS |
| Configuration productive | `C:\ProgramData\DeskFutures\config\desk.env` sur le VPS |

Une archive historique, à ne jamais fusionner intégralement dans VNext, est
également disponible :

- dépôt : `https://github.com/Moustaphasow01/TV_Automation.git` ;
- branche : `codex/workspace-recovery-archive-20260908` ;
- commit : `d512ad523e3750178f5998f0f2dd7421fdc76741`.

Cette archive contient les sources et documents historiques utiles. Les
exports générés, snapshots runtime, secrets, bases, logs et dépendances locales
en sont exclus volontairement.

## 3. Architecture à préserver

Le desk converge vers un monolithe modulaire Node.js/PostgreSQL :

```text
TradingView / sources macro
  -> market-data
  -> features
  -> live-runtime / moteurs déterministes
  -> StrategySignal
  -> Market Context préfiltré et advisory IA
  -> Portfolio Arbitration
  -> Global Risk
  -> TargetPosition
  -> OrderIntent
  -> Human Gate
  -> suivi théorique
  -> provider/broker uniquement lorsque la politique l'autorise
  -> reconciliation / audit / reporting
  -> BFF /front-api/v1
  -> Front Control Plane VNext
```

Frontière des dépendances : `adapter -> application -> domain`. PostgreSQL est
la vérité opérationnelle. Le frontend ne calcule jamais officiellement le
risque, la taille, le PnL, l'exposition, les permissions ou les actions
autorisées.

Bounded contexts principaux : `market-data`, `features`, `strategy`,
`simulation`, `research`, `agents`, `live-runtime`, `portfolio-risk`,
`execution`, `operations`, `audit`, `reporting` et `front-control-plane`.

## 4. Invariants de sécurité non négociables

- `AUTO_EXECUTION = OFF`.
- `LIVE_BROKER = OFF`.
- Kill switch actif.
- Maximum de contrats physiques : `0`.
- Human Gate obligatoire pour toute action physique future.
- Risque maximal : `500 USD` par position.
- Perte maximale : `2 000 USD` par jour.
- Perte maximale : `4 000 USD` par semaine.
- `StrategySignal != OrderIntent`.
- `Confirm != ACK != PARTIAL_FILL != FILL`.
- Une expiration Human Gate ne doit pas supprimer un suivi théorique autorisé.
- Aucun LLM ne soumet, ne dimensionne ou ne modifie directement un ordre.
- Aucun signal ne doit être filtré avant publication par consultation du futur.
- Replay, SHADOW, PAPER et LIVE réutilisent la même sémantique déterministe.
- Les données absentes, périmées, bloquées ou inapplicables ne deviennent
  jamais un faux zéro ou un faux état sain.

## 5. État VPS observé au passage

Observation publique du 8 septembre 2026 vers 18:02 UTC :

```text
/healthz                  ok=true, live=true
/readyz                   ready=true, ok=true, mode=postgres
release                   portfolio-risk-truth-20260908.2
services manquants        0
scheduler                 healthy
Telegram                  healthy
agents live/research      healthy
broker management         healthy, aucune exécution physique autorisée
```

### Alerte opérationnelle ouverte

La disponibilité applicative est saine, mais la disponibilité des données ne
l'est pas :

```text
data_readiness.ok         false
data_readiness.state      stale
session                   CBOT_GRAINS_RTH
scope instruments         ZC, ZW
scope timeframes          M1, M5
core_age_seconds          environ 19 060 lors du dernier contrôle
pipeline                  CONTEXT_WAITING
signaux alors en attente  2
Human Gate                0
```

Le flux TradingView grains M1/M5 a cessé d'être suffisamment frais. Les deux
signaux observés sont différés par le contexte ; ils ne sont pas des ordres
prêts à poser. Le prochain chantier P0 est de rétablir les alertes TradingView
à clôture de bougie et de prouver leur arrivée durable. Ne pas les remplacer
par un poller périodique présenté comme du live.

## 6. Baseline de validation connue

La reprise depuis un clone vierge a été vérifiée avec Node `22.23.2` et npm
`10.8.2` :

- installation reproductible des trois racines npm : réussie ;
- audit npm au moment de la certification : zéro vulnérabilité ;
- typecheck et build racine : réussis ;
- build `apps/desk-control-plane` : réussi ;
- contrats générés : à jour ;
- guards strategy, Windows deployment, supply chain et runtime safety : réussis ;
- configuration Docker Compose : valide ;
- suite backend : `1 620` tests, `1 570` réussis, `0` échec, `50` ignorés ;
- baseline frontend récente : `327/327` ;
- contrôle BFF/réseau ciblé : certifié dans les rapports du 7 septembre ;
- shallow clone de `main` et de la branche d'archive : réussi avec SHA exact.

Ces résultats certifient le code correspondant. Ils ne remplacent pas la
preuve prospective d'une journée de marché fraîche et ne certifient pas la
rentabilité des stratégies.

## 7. Les 50 derniers travaux versionnés

Périmètre exact : 50 commits entre `6a71e64` exclu et `f6a603a` inclus,
`353` fichiers touchés, `35 701` insertions et `5 397` suppressions.

### 1 — Référencement de l'archive historique

Commit `f6a603a`. Le guide de reprise VNext référence désormais le dépôt
historique, sa branche dédiée et son SHA exact. Il explique que cette archive
sert à la récupération sélective et non au déploiement.

### 2 — Reprise reproductible depuis un poste neuf

Commit `ff1757f`. Ajout de Node 22 via `.nvmrc`, contrainte d'engine npm,
actualisation du README et création du guide complet de restauration. Le clone,
les installations, builds, guards et tests ont été rejoués depuis zéro.

### 3 — Certification de la vérité portefeuille/risque

Commit `2ee9a72`, Jira `TD2-440`. Le rapport certifie la distinction entre
risque actif et historique ainsi que l'état opérationnel de la release VPS.

### 4 — Exclusion des intentions clôturées du risque actif

Commit `eeeb530`, Jira `TD2-440`. Les `OrderIntent` clôturés restent dans
l'historique mais ne gonflent plus les réservations et décisions actives du
Risk Center. Des tests de projection couvrent la régression.

### 5 — Séparation portefeuille actif / historique

Commit `97fd846`, Jira `TD2-440`. La projection portefeuille expose séparément
les dossiers actifs et les éléments historiques au lieu de présenter une
ancienne exposition comme encore ouverte.

### 6 — Certification de résolution d'exposition théorique

Commit `d56481a`, Jira `TD2-439`. Le rapport prouve la résolution
administrative sans inventer de résultat, prix de sortie, PnL ou R.

### 7 — Résolution administrative des dossiers ambigus

Commit `513aa6a`, Jira `TD2-439`. Ajout de l'ADR 0034, de la migration 069,
du use case, de la persistance append-only et des gardes empêchant une
réexécution tardive. L'exposition est libérée mais l'historique indéterminé est
préservé.

### 8 — Certification de déduplication contextuelle

Commit `98ddbce`. Le rapport temps réel documente la preuve que les mêmes
événements marché ne réveillent plus plusieurs fois l'analyste contextuel.

### 9 — Déduplication des réveils par événement marché

Commit `0c4b3ab`. Introduction d'une policy événementielle dédiée et adaptation
du scheduler. Les doublons, supersessions et contrats temporels sont testés.

### 10 — Certification BFF et résilience réseau

Commit `e95837f`. Ajout des preuves navigateur et documentation de la reprise
après perte réseau, sans masquer un état déconnecté.

### 11 — Contexte courant partagé entre sources Live Focus

Commit `e273f5e`. Le BFF utilise un contexte courant cohérent pour les sources
de Live Focus. Un audit de perte/reprise réseau et des tests API ont été ajoutés.

### 12 — Stabilisation des lectures BFF et perte réseau explicite

Commit `effb914`. Le transport, le provider temps réel et Live Focus gardent la
dernière projection connue, affichent une bannière hors ligne et bloquent les
actions sensibles pendant la resynchronisation.

### 13 — Preuve de résilience du contexte Live Focus

Commit `feb1d73`. Le rapport de clôture consigne les résultats et les limites
du durcissement des lectures de contexte.

### 14 — Durcissement de la lecture Market Context

Commit `62d861f`. Ajout de la migration 068 et de lectures PostgreSQL
résilientes. Le BFF distingue données courantes, absentes et dégradées au lieu
de fabriquer un contexte disponible.

### 15 — Preuves ledger et temps réel déployées

Commit `106c463`. Consolidation du rapport de fermeture causale, outbox, SSE,
réconciliation temporelle et comportement déployé.

### 16 — Dépendance de test temps réel montée explicitement

Commit `ce19601`. La dépendance nécessaire aux tests React montés du realtime
est inscrite dans le package et son lockfile, supprimant une dépendance cachée
du poste de développement.

### 17 — Fermeture des gaps ledger causal et realtime

Commit `3b55ef5`, Jira `TD2-433`, `TD2-435`, `TD2-437`. Ajout du curseur outbox
natif, invalidation ciblée des queries, déduplication, gestion des séquences,
SSE PostgreSQL et verrou d'admission des producteurs pendant un déploiement.

### 18 — Attestation de publication du contexte réel

Commit `ed2f400`, Jira `TD2-432`. Le rapport distingue la publication de
contexte réellement observée des intégrations encore manquantes.

### 19 — Lancement de l'analyste grains via la jonction de release

Commit `ba4e787`, Jira `TD2-432` et `TD2-434`. Le runner de contexte grains est
lancé depuis la release Windows active, avec tests de processus, CLI et
supersession des tâches.

### 20 — Horloges de contexte et runtime analyste borné

Commit `cd55422`, Jira `TD2-432`. Introduction du calendrier RTH CBOT,
qualification des horloges `validFrom/validUntil/sourceDataCutoff`, scope
analyste préservé et tests d'installation/scheduler/PostgreSQL.

### 21 — Certification du calendrier autonome VPS

Commit `1f4fe32`. Le rapport opérationnel décrit le calendrier grains autonome,
ses sources, sa cadence, son état de fraîcheur et les limites restantes.

### 22 — Préservation de la précision des timestamps calendrier

Commit `0909742`. La requalification d'une preuve stockée ne tronque plus sa
précision temporelle. Le ledger PostgreSQL vérifie ce comportement.

### 23 — Enrichissement borné et plans opposés refusés

Commit `546d4b5`. Les enrichissements des candidats sont limités à l'enveloppe
autorisée ; un plan Target/Order opposé à la direction retenue est refusé.

### 24 — Libération des 49 réservations historiques attestées

Commit `b2363ce`. Après attestation opérateur, les réservations historiques sans
position réelle ont été clôturées administrativement. Aucun fill, outcome ou
PnL n'a été inventé ; ADR 0033, migration 067 et tests de concurrence couvrent
la procédure.

### 25 — Barrière des producteurs pendant les déploiements

Commit `46f7def`. Le drain Windows bloque les nouveaux producteurs, attend les
tâches en cours et vérifie la compatibilité Node et les tâches planifiées avant
la bascule d'une release.

### 26 — Intégrité supply-chain et lockfiles frontend

Commit `eb52ace`. Les intégrités de registre sont épinglées et le scanner couvre
les lockfiles frontend. Les contrôles de sécurité associés ont été étendus.

### 27 — Fallback calendrier lié à une preuve de panne primaire

Commit `82b6504`. Une source secondaire ne peut plus se substituer silencieusement
à la source principale : son activation exige une preuve de panne qualifiée et
une provenance persistée.

### 28 — Adaptateur secondaire borné Export Sales

Commit `8d1352c`. Ajout de l'adaptateur Dorman/FAS-403 et de son ADR 0032, avec
parser PDF, worker, policy de source et tests. Ce fallback reste borné et ne
transforme pas une preuve partielle en contexte complet.

### 29 — Projection de lecture d'adjudication explicite

Commit `9f1871e`. Le read model d'adjudication des intentions d'origine invalide
est séparé de la commande qui réalise la mutation.

### 30 — Adjudication des anciennes intentions d'origine invalide

Commit `3b56d75`, Jira `TD2-429`. Migration 066, use case, domaine et persistance
auditent les fermetures prospectives des dossiers invalides sans réécrire leur
histoire.

### 31 — Données dégradées conservées dans Live Focus

Commit `29e60fc`, Jira `TD2-429`. Une panne partielle ou une donnée périmée
n'apparaît plus comme une liste réellement vide. Les actions restent fermées
tant que l'autorité backend n'est pas disponible.

### 32 — Actions historiques et horloge calendrier clarifiées

Commit `2d9f27f`, Jira `TD2-429`. Live Focus distingue actions actuelles,
éléments historiques et temps du calendrier, avec tests BFF et React.

### 33 — Preuve USDA partielle conservée sans admission

Commit `e676de7`, Jira `TD2-426`. Les fragments récupérés sont conservés pour
audit, mais une couverture incomplète n'autorise pas le contexte ni un trade.

### 34 — Expiration conservée et activation Risk préparée

Commit `cd8dbc6`, Jira `TD2-429`. Les preuves d'expiration théorique sont
préservées et les scripts Windows de policy grains vérifient les plafonds avant
activation.

### 35 — Audit historique et opérations grains autonomes

Commit `648a693`, Jira `TD2-426` et `TD2-429`. Livraison du collecteur calendrier,
leases, archive, correction append-only des outcomes, qualification des anciens
intents, tâches Windows, tests de santé et durcissement du rollback DB/release.

### 36 — Certification de release Risk grains

Commit `592e0e4`, Jira `TD2-429`. Le rapport consigne la release VPS testée, les
plafonds actifs et les blocages restant à lever.

### 37 — Validation de la preuve monétaire et des plans complets

Commit `c1a7213`, Jira `TD2-429`. Ajout de la sélection de signaux possédant un
plan complet, preuve monétaire canonique et ADR 0031. Un candidat incomplet ne
peut plus être traité comme une allocation prête.

### 38 — Budgets monétaires SHADOW et outcomes causaux

Commit `5461391`, Jira `TD2-429`. Implémentation des plafonds 500/2 000/4 000,
réservations d'exposition théorique et comparaison de replays sous la même
policy. Les montants absents bloquent au lieu d'utiliser un fallback fictif.

### 39 — Qualification calendrier USDA et replay de semaine identique

Commit `e93e37f`, Jira `TD2-426`. Import d'évidence, détection, versionnement et
comparateur rejouent la même semaine avec la même connaissance disponible à
l'instant T.

### 40 — Documentation des preuves et blocages de qualification

Commit `878adf4`, Jira `TD2-424`. La roadmap et le rapport de finalisation
consignent ce qui est prouvé, ce qui est seulement local et ce qui reste bloqué.

### 41 — Séparation des frontières runtime et parité

Commit `a4fc824`, Jira `TD2-431`. Extraction de gros fichiers legacy :
persistance théorique, workflows de replay, input/technique grains, recherche
et réponses HTTP. Des tests de parité empêchent un changement silencieux.

### 42 — Vérité Human Gate et actions focalisées

Commit `19d0a13`, Jira `TD2-430`. Le BFF monolithique est découpé en projections
audit, historique, orders, portfolio, provider, risk, research et Telegram.
Live Focus affiche les actions autorisées par le backend uniquement.

### 43 — Telegram limité aux ordres qualifiés

Commit `d013cd3`, Jira `TD2-430`. Séparation source, qualification, construction
du message et livraison. Les envois incertains sont mis en quarantaine ; un
signal brut ne produit pas une fausse alerte « ordre à poser ».

### 44 — Exposition et budgets de pertes canoniques

Commit `374ace6`, Jira `TD2-429`. Le domaine et le repository appliquent les
limites de portefeuille à l'exposition théorique courante, avec tests unitaires
et PostgreSQL.

### 45 — Preuve calendrier « as-of » immuable

Commit `e8e863d`, Jira `TD2-426`. Migration 063 et ledger versionné conservent
ce qui était réellement connu à chaque instant du replay ou du live.

### 46 — Synthèse des cinq lots et audit Live Focus

Commit `8d06a28`. Rapports d'avancement grains, audit design/technique Live Focus
et plan de raffinement. Ces documents n'inventent aucune conformité non testée.

### 47 — Contexte causal et exposition SHADOW canonique

Commit `56b0b4a`. Ajout du replay PostgreSQL causal, couverture calendrier,
lecture atomique de l'exposition, idempotence, lock de compte et tests complets
du chemin signal -> contexte -> risque -> suivi théorique.

### 48 — Rapport des limites de qualification causale

Commit `16f6c16`. Le rapport sépare résultats reproductibles, preuves causales
et limites statistiques ou de données encore ouvertes.

### 49 — Refus des anciens rapports dans l'audit causal

Commit `40bac0d`. L'auditeur hebdomadaire refuse les artefacts legacy lorsqu'il
évalue la suite causale, empêchant de réutiliser le `+116,4145 R` comme preuve
de rentabilité certifiée.

### 50 — Détection causale et exécution théorique partagée

Commit `a38ed8b`. Les quatre familles grains publient leurs signaux à clôture M5
sans consultation future. Le contexte, la session Chicago, la qualité,
l'expiration et le simulateur théorique sont partagés entre replay et live.

## 8. Vérité stratégie et performance

- L'ancien résultat d'environ `+116,4145 R` est reproductible comme artefact
  historique, mais il n'est **pas certifié causal** et ne doit pas être présenté
  comme performance live attendue.
- La semaine du 31 août au 4 septembre a produit six clôtures théoriques pour
  environ `-0,82857143 R`. Ce n'est pas un PnL broker.
- Un replay causal avec connaissance calendrier non prouvée a correctement
  publié 100 signaux bruts puis produit 100 `WAIT`, zéro Human Gate et zéro
  ordre provider. C'est un résultat de sûreté, pas une preuve de rentabilité.
- MNQ, MES, Bitcoin et Solana restent différés. La priorité validée est ZC/ZW.
- La rentabilité et la robustesse hors échantillon restent à démontrer avec
  manifeste figé, coûts, slippage, drawdown, concentration, périodes distinctes
  et sans ajustement rétroactif au holdout.

## 9. Prochain ordre de travail recommandé

### P0 — Restaurer la fraîcheur marché

1. Vérifier dans TradingView les cinq alertes à clôture de bougie, surtout les
   batches M1 et M5 contenant ZC1!/ZW1!.
2. Vérifier le statut de livraison du webhook, son timeout et la réception côté
   VPS sans exposer le secret.
3. Prouver pour ZC et ZW : `bar close -> webhook received -> row PostgreSQL ->
   freshness -> scheduler -> component frontend`.
4. Ne pas remplacer l'alerte par un pull Windows toutes les trois minutes.
5. Ne pas backdater `receivedAt` lors d'un backfill.

### P0 — Rejouer le pipeline réel après reprise du flux

1. Observer une bougie fermée M1 et M5 par instrument.
2. Vérifier les huit instances `US_GRAINS_DETERMINISTIC_SUITE` en SHADOW.
3. Pour chaque signal, tracer les IDs à travers Context, Portfolio, Risk,
   TargetPosition, OrderIntent, Human Gate et suivi théorique.
4. Vérifier que les signaux différés expirent ou sont réévalués selon le contrat,
   sans promotion arbitraire.
5. Vérifier que Telegram n'envoie comme ordre actionnable qu'un OrderIntent
   qualifié ; les autres notifications doivent être clairement informatives.

### P1 — Parité live/replay

1. Figer dataset, versions stratégie, calendrier, policy risque, coûts et cutoff.
2. Rejouer exactement le même intervalle observé en live.
3. Comparer d'abord les signaux bruts, puis chaque gate séparément.
4. Classer tout écart par source, horloge, version, idempotence ou donnée manquante.
5. Ne calibrer aucun filtre pour rendre rétroactivement les journées positives.

### P1 — Recette produit

1. Vérifier Live Focus avec données fraîches aux résolutions desktop/laptop.
2. Confirmer la distinction visuelle brut / filtré / qualifié / théorique / broker.
3. Confirmer que le Risk Center actif reste à zéro lorsqu'aucun dossier actif
   n'existe, tout en conservant l'historique.
4. Vérifier perte réseau, reconnexion SSE, déduplication et resynchronisation.
5. Vérifier historique, deep links par ID, journal et affichage des expirations.

### P1 — Robustesse et dette

1. Exécuter la matrice CI complète après tout correctif.
2. Continuer `touch-and-improve` sur les trois dépassements legacy encore connus.
3. Corriger les dépendances vulnérables sans affaiblir les guards.
4. Observer une journée SHADOW complète avant toute nouvelle prétention de
   readiness opérationnelle.

## 10. Fichiers prioritaires à lire

Ordre obligatoire :

1. `AGENTS.md`
2. `docs/engineering/TRADING_DESK_ENGINEERING_STANDARDS.md`
3. `docs/engineering/module-catalog.md`
4. `docs/engineering/naming-glossary.md`
5. `docs/WORKSTATION_RECOVERY_HANDOFF_2026-09-08.md`
6. `docs/engineering/GRAINS_REQUALIFICATION_ROADMAP.md`
7. `reports/research/GRAINS_OPERATIONAL_CLOSURE_20260907.md`
8. `reports/research/GRAINS_CONTEXT_RESUMPTION_20260907.md`
9. `reports/research/GRAINS_REALTIME_LEDGER_CLOSURE_20260907.md`
10. `reports/research/THEORETICAL_TRADE_ADMINISTRATIVE_RESOLUTION_20260908_CERTIFICATION.md`
11. `reports/research/PORTFOLIO_RISK_ACTIVE_HISTORY_SEMANTICS_20260908_CERTIFICATION.md`
12. `docs/front-redesign/FRONTEND_V2_IMPLEMENTATION_PROGRESS.md`
13. ADR 0024, 0031, 0032, 0033 et 0034.

## 11. Reprise depuis le nouveau PC

```bash
git clone https://github.com/Moustaphasow01/tv-automation-desk.git
cd tv-automation-desk
git switch main
nvm install
nvm use
npm ci --ignore-scripts
npm --prefix apps/desk-control-plane ci --ignore-scripts
npm --prefix mcp_gpt_desk ci --ignore-scripts --install-links
```

Puis exécuter les validations décrites dans
`docs/WORKSTATION_RECOVERY_HANDOFF_2026-09-08.md`.

Les secrets ne sont pas dans Git. Le nouveau poste doit disposer :

- d'un accès GitHub et Jira ;
- d'une nouvelle clé SSH provisionnée via OVH ou d'une clé transférée dans un
  coffre chiffré ;
- des secrets Telegram, TradingView, opérateur et PostgreSQL via un canal sûr ;
- de PowerShell 7, Docker Desktop/WSL2, Node 22, npm 10 et Python 3.12.

Si l'ancienne clé privée n'est plus récupérable, créer une nouvelle paire sur
le nouveau PC, ajouter uniquement sa clé publique via la console OVH, tester
l'accès puis révoquer l'ancienne clé.

## 12. Commandes de contrôle initiales

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git fetch origin
git rev-parse origin/main

npm run typecheck
npm run build
npm --prefix packages/desk-contracts run check:generated
npm run guard:strategy-contracts
npm run guard:windows-deployment
npm run guard:security-supply-chain
npm run guard:runtime-safety
npm --prefix mcp_gpt_desk test
docker compose config --quiet
```

Contrôle public non mutateur :

```bash
curl -fsS https://vps-6d6969db.vps.ovh.net/healthz
curl -fsS https://vps-6d6969db.vps.ovh.net/readyz
```

Ne jamais déclencher une confirmation Human Gate, un provider ou un ordre
broker pour une simple recette technique.

## 13. Git, déploiement et rollback

- Commencer une nouvelle modification depuis `main` à jour, dans une branche
  `codex/<objectif>`.
- Ne jamais fusionner l'archive historique entière.
- Utiliser `deploy/windows/Build-DeskRelease.ps1` puis
  `deploy/windows/Update-Desk.ps1`.
- Le pipeline officiel réalise backup, drain, migrations, canary, bascule et
  rollback automatique.
- Ne jamais remplacer ce pipeline par une copie manuelle sur le VPS.
- AUTO/LIVE physiques doivent rester OFF après rollback comme après upgrade.

## 14. Limites et données volontairement non versionnées

Dans l'ancien workspace, `156` exports générés et `193` snapshots
`mcp_gpt_desk/local_data` restent hors Git. Ils ne sont pas la source de vérité
du produit. Dans VNext, `output/`, logs, builds, bases locales et preuves brutes
volumineuses restent également hors Git.

PostgreSQL et les objets VPS doivent être protégés par les sauvegardes décrites
dans `docs/DESK_RESILIENCE_AND_DR_RUNBOOK.md`. Un clone Git restaure le produit,
pas les secrets ni une base productive.

## 15. Prompt prêt à transmettre au prochain chat

```text
Tu reprends le Trading Desk VNext comme chef de projet technique.

Commence par cloner ou mettre à jour :
https://github.com/Moustaphasow01/tv-automation-desk.git
branche main, puis vérifie que le SHA distant attendu est au moins
f6a603aa7d99be35ed044e40a13fbb1b42faa100.

Lis intégralement PASSAGE.md, AGENTS.md, les standards d'ingénierie, le
catalogue des modules, le glossaire et les rapports prioritaires cités dans
PASSAGE.md. Ne te fie pas à un ancien résumé de conversation si le runtime ou
Git le contredit.

La priorité P0 est la fraîcheur du flux TradingView ZC/ZW M1/M5. Le VPS est
joignable et ses services sont sains, mais data_readiness était STALE au
passage et deux signaux étaient CONTEXT_WAITING. Audite la chaîne à partir de
la clôture réelle de bougie jusqu'à PostgreSQL, le scheduler, le pipeline et
Live Focus. N'utilise pas un poller périodique comme remplacement du webhook
TradingView. Ne backdate aucune réception.

Conserve impérativement AUTO et LIVE broker désactivés, kill switch actif,
Human Gate obligatoire et plafonds 500 USD/position, 2 000 USD/jour,
4 000 USD/semaine. Ne confirme aucun ordre réel pendant la recette.

Après restauration des données fraîches, observe un cycle causal complet,
compare live et replay sur le même manifeste, documente chaque divergence,
teste Telegram et Live Focus, puis utilise le pipeline Windows officiel pour
tout déploiement. Crée une branche codex dédiée, applique touch-and-improve,
exécute les tests/guards adaptés et ne déclare Done qu'avec des preuves.

La tâche Codex précédente s'appelle « Expliquer architecture projet (2) » et
porte l'ID 019ff999-cfc9-74c1-8a76-8c098c380a11.
```

## 16. Critères de passage réussi

- Le nouveau PC clone `main` sans dépendance cachée.
- Les installations déterministes et validations minimales passent.
- L'accès VPS utilise une nouvelle clé ou une clé transférée de façon chiffrée.
- Les secrets restent hors Git et hors rapports.
- La source de vérité PostgreSQL/objets VPS est accessible et sauvegardée.
- Les alertes ZC/ZW M1/M5 redeviennent fraîches et leur provenance est prouvée.
- Le pipeline réel est observé sans ordre physique.
- Tout nouveau résultat de replay est causal, comparable et non overfitté.
