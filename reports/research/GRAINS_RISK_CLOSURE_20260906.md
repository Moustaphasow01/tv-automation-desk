# Grains — politique de risque, arbitrage et intégrité de la semaine

Date : 6 septembre 2026. Suivi : **TD2-429**. Branche : `codex/grains-week-integrity`.
Base de ce lot : `54613910d18ceb3273fad8d8024343a5cd9a9322`.

## Décision opérationnelle

**Activation monétaire VPS : NO-GO tant que les preuves historiques ne sont pas réconciliées.**
Les plafonds approuvés sont **500 USD/position, 2 000 USD/jour, 4 000 USD/semaine**.
Leur implémentation et leurs tests locaux ne signifient pas qu'ils sont actifs sur le VPS.
Ce lot n'a envoyé aucun ordre physique, confirmé aucun Human Gate, modifié aucun service
VPS, changé aucune alerte TradingView ni réécrit une ligne de la base VPS.

Deux défauts distincts ont été traités localement :

1. Portfolio peut sélectionner un plan complet parmi les propositions concurrentes,
   sans fusionner leurs prix ni gonfler leur quantité. Cette option reste désactivée par défaut.
2. Risk refuse désormais de consommer un résultat monétaire dont la valeur du point
   n'est pas prouvée par le plan autorisé canonique.

Le replay sert à mesurer leurs effets, **pas à prouver ou fabriquer la rentabilité**.
Les moteurs de stratégies, familles, paramètres et filtres Context n'ont pas été optimisés
sur les résultats de cette semaine. Aucun worker IA n'a participé à ces replays.

## 1. Sémantique des plafonds

- 500 USD est un plafond, pas le risque obligatoire de chaque trade et pas la valeur d'un R.
- Le multiplicateur Context réduit ce plafond avant de calculer un nombre entier de contrats.
- La quantité reste inférieure ou égale à celle proposée par la stratégie ; aucun contrat
  minimum n'est forcé si le budget ne le permet pas.
- Les pertes nettes réalisées du compte et le risque prévu au stop déjà réservé sont
  déduits du disponible quotidien/hebdomadaire. Les gains n'augmentent pas le plafond initial.
- Les périodes sont UTC, semaine commençant lundi. R et dollars restent indépendants.
- Les montants sont des risques prévus au stop : gaps, frais et glissement peuvent dépasser
  ce risque. Il ne s'agit pas d'une garantie de perte physique maximale.
- Le verrou transactionnel de compte protège la consommation concurrente. Les plafonds
  de contrats existants restent inchangés ; AUTO/LIVE restent des autorités séparées.

Politique témoin : `reports/research/GRAINS_RISK_REPLAY_POLICY_20260906.json`.
Politique candidate : `reports/research/GRAINS_RISK_SELECTION_POLICY_20260906.json`.

## 2. Arbitrage Portfolio : correction fonctionnelle, pas sélection par résultat

Le netting historique regroupe parfois plusieurs plans. Risk les refuse correctement :
il ne peut pas inventer une entrée ou un stop communs. `BEST_COMPLETE_PLAN_V1` choisit
un seul plan complet par compte/instrument, avant Risk, dans l'ordre :

1. confiance décroissante ;
2. date du signal croissante ;
3. ID canonique lexical croissant.

Les perdants restent auditables avec leur ID, le motif et l'ID retenu. Les moteurs
continuent de publier tous leurs signaux. Les prix sont immuables ; une proposition
LONG et une proposition SHORT ne produisent jamais deux positions opposées simultanées.
Les réserves antérieures continuent de s'appliquer, y compris entre lots distincts.

**Limite :** les confiances inter-stratégies ne sont pas calibrées comme des probabilités
comparables. Cette règle stable ne garantit donc pas de retenir le meilleur trade.
Le défaut reste `NET_BY_DIRECTION`. L'activation nécessite une politique explicite.
Une politique inconnue ne sélectionne rien. L'idempotence inclut la politique utilisée.
Une propriété de politique explicitement vide (`null` ou `undefined`) est refusée
avant la persistance Portfolio, sans consommer le signal ni ouvrir un Human Gate.
Seule l'absence de propriété permet le défaut historique ; le test a reproduit
le passage incorrect jusqu'au gate avant correction, puis vérifié son refus.

Placement, alternatives, consommateurs et rollback :
`docs/trading-desk-target-blueprint/adr/0031-complete-plan-portfolio-selection.md`.

## 3. Qualification des données : trois entrées séparées

Toutes les comparaisons portent sur **31 août → 4 septembre 2026**, arrêté au
5 septembre 00:00 UTC. Le moteur consomme les données jusqu'à son instant simulé.
Le calendrier officiel versionné reconstruit ne prouve pas sa réception historique
par le VPS. Le backfill acquis le 6 septembre ne prouve pas non plus la réception live.

| Entrée | Bougies totales, préchauffage inclus | Différence |
|---|---:|---|
| Snapshot original figé | 17 044 | Inchangé |
| Original + 13 M1 ciblées | 17 057 | Ajout des 13 trous bloquant les premiers dossiers |
| Semaine M1/M5 native reconstruite | 17 445 | Remplacement dans une **nouvelle copie**, +401 lignes absentes |

Les 13 premières minutes manquantes existent réellement chez TradingView, avec volume
positif. Ce n'était pas une preuve d'absence de transaction de marché.

La lecture TradingView Desktop via MCP a ensuite récupéré toute la fenêtre native :

| Comparaison avec le snapshot | M1 | M5 |
|---|---:|---:|
| Bougies natives récupérées | 9 979 | 2 110 |
| Bougies présentes dans les deux sources | 9 616 | 2 072 |
| OHLCV strictement identiques | 9 363 | 2 022 |
| Lignes communes avec divergence | 253 | 50 |
| Manquantes dans le snapshot initial | 363 | 38 |
| Présentes dans le snapshot, absentes de TradingView | 0 | 0 |

Les divergences M1 concernent volume (253), close (81), high (7), low (6) ;
M5 : volume (50), close (22), high (5), low (1). Un même enregistrement peut
diverger sur plusieurs champs. Leur cause exacte côté ingestion reste à qualifier :
une différence entre capture live et historique ne prouve pas à elle seule quelle
révision était disponible au moment de la décision.

**1 730 agrégats complets de cinq M1 correspondent exactement aux M5 natives.**
380 agrégats n'ont pas cinq M1 natives : tous sont hors RTH selon `isGrainsRth`.
Ils restent non prouvés, sans interpolation. Aucun nombre arbitraire de bougies
par jour ni bougie de fermeture n'a été fabriqué. Le préchauffage avant le 31 août
est conservé tel quel : ce lot ne le certifie pas à nouveau.

Les champs OHLCV, identités, timeframes, doublons et horodatages ont été contrôlés.
Les acquisitions ont conservé leurs vraies dates de collecte et leur provenance.
Les sources continues `ZC1!`/`ZW1!` ne constituent pas une preuve de remplissage broker.

### Empreintes des entrées

```text
original : 8e7d878c6b29dff2333157892cf669a7dbb9735d3fdf96a4abd0636963492495
+13 M1   : 3372b34b51f1bdddc1bdc8714f78234f9e91ffb4ab830aaa563a768ce8190371
natif    : 685700061e3cbb9ea414b8ddc1ac1c08ebdfed7985a0d6690ddec8ba3e6c52ee
CSV M1   : 67f291d9903273a67a6e25445df09b55597e840775d9d87c480e9bffcd148ac5
CSV M5   : 3e89b14c76cd34a70b8a5c6c6912e92d47f7558d0f77b1167a559e3f7b3471ee
```

## 4. Replays canoniques PostgreSQL

Chaque paire utilise les mêmes données, le même code et les mêmes signaux détectés.
Seule la politique d'arbitrage diffère. Chaque run possède une base locale isolée,
la vraie chaîne Context → Portfolio → Risk → Target → Intent → Human Gate → suivi
théorique, puis supprime sa base temporaire. La simulation ne confirme pas le gate humain.

Les R suivants proviennent **uniquement des positions théoriques qualifiées et clôturées**,
pas des signaux bruts. Les expirations sans fill ne deviennent pas des trades à zéro R.
Les dossiers indéterminés ne deviennent ni des expirations prouvées ni des gains/pertes.

| Entrée / politique | Bruts | Intent / Human Gate | Fills clôturés | TP / SL | Expirés prouvés | Non résolus | R clôturés | USD clôturés |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Original / netting | 100 | 5 | 2 | 1 / 1 | 1 | 2 | +0,5714 | 0,00 |
| Original / plan complet | 100 | 8 | 5 | 1 / 4 | 1 | 2 | −2,4286 | −312,50 |
| +13 M1 / netting | 100 | 8 | 2 | 1 / 1 | 4 | 2 | +0,5714 | 0,00 |
| +13 M1 / plan complet | 100 | 9 | 5 | 1 / 4 | 2 | 2 | −2,4286 | −312,50 |
| Semaine native / netting, code final | 105 | 24 | 7 | 4 / 3 | 17 | 0 | +3,0444 | +237,50 |
| Semaine native / plan complet, code final | 105 | 32 | 15 | 7 / 8 | 17 | 0 | +2,8000 | +225,00 |

Les données natives changent la détection de 100 à 105 signaux ; comparer la paire
native en interne, pas prétendre que son entrée est identique à l'original incomplet.
Le contrôle supplémentaire d'unité monétaire a été ajouté après les deux premières
paires. La relecture a ensuite renforcé les preuves de résultats et l'admissibilité
des plans. La paire finale a été vérifiée le **6 septembre à 11:50:09 UTC** :
mêmes données, mêmes IDs et contenus des signaux bruts, mêmes sources de code entre
témoin/candidat, code embarqué identique au code courant. Les répétitions après
durcissement retrouvent les mêmes comptes, événements et résultats que la première
paire native ; ce ne sont pas de nouvelles recherches de paramètres.

La paire native finale obtient 11 refus Context et 94 signaux admissibles.
Le netting produit 40 décisions Risk (24 passent, 16 bloquées pour plusieurs plans
sans risque unitaire canonique). La sélection complète produit 32 décisions Risk,
toutes approuvées ; 11 propositions concurrentes sont auditées comme non retenues,
les autres refus Portfolio proviennent de réserves existantes.

La sélection complète donne plus de dossiers et de fills, **mais pas un meilleur
résultat financier sur cette semaine** : +225 contre +237,50 USD, avant frais.
Son drawdown clôturé maximal vaut 3 R / 400 USD contre 2 R / 225 USD pour le témoin.
Sept ou quinze trades ne suffisent pas à certifier une rentabilité.

| Jour UTC | Bruts | Context admissibles | Intent témoin | R témoin | USD témoin | Intent sélection | R sélection | USD sélection |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 31/08 | 11 | 7 | 1 | +1,5714 | +137,50 | 3 | −0,4286 | −50,00 |
| 01/09 | 16 | 16 | 4 | −1,0000 | −137,50 | 6 | −0,4000 | −162,50 |
| 02/09 | 32 | 27 | 8 | +0,4286 | +37,50 | 9 | −0,5714 | −62,50 |
| 03/09 | 24 | 22 | 5 | 0,0000 | 0,00 | 6 | +1,5455 | +212,50 |
| 04/09 | 22 | 22 | 6 | +2,0444 | +200,00 | 8 | +2,6545 | +287,50 |

Les frais persistés dans ces replays valent zéro. Aucun profit broker n'est revendiqué.
Le risque réellement autorisé par proposition dans la paire native va de **50 à
137,50 USD**, avec un contrat par proposition : le plafond de 500 USD n'est jamais
transformé en objectif de risque à consommer obligatoirement.
L'effet constaté de la reconstruction des données ne permet pas de réécrire les
décisions live comme si ces données avaient été reçues à temps.

### Certificat final de la paire

`verification-final.json` vérifie les 607 fichiers du manifeste, les preuves
monétaires des **7 + 15 résultats finaux**, leurs unités canoniques Intent/Target,
les quantités entières non augmentées, le plafond monétaire par proposition,
l'absence de position encore ouverte et l'égalité dossiers = clôtures + expirations.
Les protections quotidiennes/hebdomadaires et la concurrence sont vérifiées par
les tests domaine/PostgreSQL ; ce certificat ne les remplace pas.

```text
code manifest : 0c38f6e2e2416dc36dab8dbf2cbea58cf496bfbcc7bfe48503d10826f8c4eb29
raw signals   : 46a10105da87dbfb733f02a1e921a900d1c4f8dffebfabe08caa9e00cb5b473c
```

Fichiers de référence : `replay-release-baseline.json`,
`replay-release-selection.json`, `comparison-final.json`, `verification-final.json`.
Le nom de fichier « release » désigne ici le candidat local figé, **pas un paquet
déployé ou une release VPS certifiée**. La décision opérationnelle demeure NO-GO.

## 5. VPS réellement observé et blocages de données historiques

La release observée est **`live-focus-dashboard-20260905.2`**, commit
**`3ed9f242…`**, également tête du `main` local au début de ce lot.
La branche de travail descend de ce main ; aucune réécriture du travail de Claude.
Le VPS est au niveau de migration 062 ; la branche comporte la 063 additive du
calendrier versionné. Aucune migration n'est ajoutée par le correctif Portfolio de ce lot.

Le contrôle de release existante a réussi ; 11 services Desk sont démarrés en
démarrage automatique. Les vérifications HTTP publiques ont répondu 200. Un essai
local sur le port 8000 refusé ne constitue pas un diagnostic d'indisponibilité du BFF :
ce n'était pas son port servi. L'inspection complète et horodatée est conservée
dans les preuves du lot.

Les cinq paramètres du mode monétaire approuvé ne sont pas configurés sur le VPS.
AUTO et LIVE physique sont désactivés ; provider/Ninja désactivés, kill switch actif,
plafond broker nul. Telegram manuel n'autorise pas un ordre physique par lui-même.

### P0 — six anciens résultats grains utilisent une mauvaise unité

Sur les résultats théoriques finaux examinés, six dossiers grains de la semaine ont
`evidence.point_value = 1` alors que le plan canonique porte **50**. La formule
mathématique peut correspondre à sa propre preuve tout en utilisant une unité fausse.

- Quatre résultats ZC : total enregistré −1,25 USD ; **−62,50 USD** avec la valeur
  du point canonique, à prix/quantité/frais inchangés.
- Deux résultats ZW : leur somme est nulle dans les deux unités. Cela ne rend pas
  leurs montants individuels exacts.
- Ce contrôle n'est pas une conversion `R × 500` et ne réécrit aucun résultat.

La projection Risk locale vérifie maintenant cette concordance, l'absence de conflit
entre les sources Intent/Target, l'empreinte de preuve et les montants brut/frais/net
via le calculateur de domaine existant. Elle rend le disponible monétaire indisponible
en cas d'écart courant, plutôt que sous-estimer les pertes.
L'ancienne preuve devra être conservée lors d'une révision versionnée des résultats.
Cette révision doit distinguer la date économique de clôture de la date à laquelle
la correction est devenue connue : ni réception antidatée, ni déplacement silencieux
de la perte vers une autre journée/semaine. Le correctif local détecte l'anomalie ;
il n'implémente pas encore cette procédure de réparation des anciennes lignes VPS.

### P0 — huit réserves historiques sans preuve terminale exploitable

Huit dossiers grains des 26/27 août sont marqués EXPIRED mais n'ont ni économie
monétaire complète ni événement théorique permettant de prouver fill ou expiration.
Leur quantité est 1, leur risque enregistré est nul et leurs unités sont absentes.
Ils ne peuvent pas être ignorés simplement parce que leur gate humain a expiré.
Ils font partie d'un ensemble de **123 réserves théoriques en attente sur le compte
partagé** (MNQ/MES et grains). Huit est le nombre de lacunes monétaires identifiées,
pas le nombre total de réserves à réconcilier. Les autres réserves documentées
consomment également le budget de compte ; corriger huit lignes ne garantit donc
pas que les plafonds autorisent immédiatement de nouveaux trades.

```text
portfolio_order_intent_76cdf00503a3dd6bc1d4c290
portfolio_order_intent_992136b97674b2ab89264b93
portfolio_order_intent_0bd7386b2bdb2f001386303a
portfolio_order_intent_282a54a876b4fae76f7617b3
portfolio_order_intent_712451937a93497bcfeb328e
portfolio_order_intent_32ae43edc75abf9acd80b208
portfolio_order_intent_a2859895e880da7307ea1b43
portfolio_order_intent_b50eab184ac98b50fd084140
```

La fermeture nécessite une preuve reconstructible ou une décision opérateur
explicitement auditée sur ces dossiers historiques. Aucun reset de compte, faux
événement d'expiration ou suppression de réserve n'a été utilisé pour passer Risk.
Le changement de semaine n'efface pas l'erreur des anciens montants et ne libère
pas ces huit réserves : elles restent bloquantes indépendamment du compteur hebdomadaire.

## 6. Validation, responsabilités et dette

La sélection appartient au domaine Portfolio ; l'application transmet la politique
et protège l'idempotence. La projection d'exposition monétaire appartient à
Portfolio/Risk et utilise la preuve de résultat existante. Aucune règle de trading
n'est ajoutée à une page, un contrôleur ou un script de données.

Contrôles terminés : domaine **518/518** ; couverture **98,48 % lignes, 95,68 %
fonctions** (seuils 90/90), 73,5 % branches (pas de seuil de branche revendiqué).
La suite PostgreSQL réelle passe **51/51**, sans skip, dont **10** tests d'exposition
théorique/monétaire. Après extraction d'une validation de conteneurs, le parcours
PostgreSQL bus → Risk → Human Gate a été rejoué : **3/3**.
Après ajout des preuves complètes à l'export de résultats, la suite dédiée de replay
PostgreSQL passe **4/4**, dont vérification du résultat exporté par le calculateur
monétaire de domaine et concordance de la valeur du point (50 pour les grains).
Le backend final passe **1 439 tests**, zéro échec, **32 skips** explicites (tests
conditionnels, dont PostgreSQL activé séparément pour les suites concernées).
Les 24 tests ciblés de transmission/validation de politique passent également.

Les guards architecture (501 fichiers), runtime-safety, migrations (63) et
compatibilité API (11 opérations critiques / 106 cataloguées) sont verts.
Les déclarations TypeScript du package domaine sont vérifiées sans émission de code.
Le guard statique
global reste rouge sur sa dette historique : 270 fonctions surdimensionnées/plafond 250,
720 fonctions complexes/plafond 650, 95 duplications/plafond 72. Aucun seuil diminué.
La recette visuelle, le build frontend et une release candidate complète ne sont pas
certifiés par ce lot backend. Aucun fichier de production frontend n'a changé ici.

Réduction ciblée de dette : le classement de propositions est extrait dans un module
pur avec tests de permutation, doublon divergent et plan falsifié ; le refus d'un plan monétaire ambigu
possède désormais un arbitrage amont explicite ; les mauvaises unités deviennent
une indisponibilité testée au lieu d'un budget faussement disponible.
La correction urgente d'intégrité du lecteur SQL conserve sa structure existante,
avec test PostgreSQL compensatoire ; sa dette de lisibilité reste à résorber sous TD2-429.

Fichiers du lot, regroupés par responsabilité :

- Domaine : `portfolio-signal-selection-v1.js`, `portfolio-candidate-allocation-v1.js`,
  `trade-outcome.js`, exports `packages/desk-domain/index.js` / `index.d.ts` et deux
  suites unitaires.
- Application/persistance : `portfolio-risk-runtime-service.js`,
  `portfolio-risk-runtime-repository.js`, `strategy-signal-decision-pipeline-service.js`,
  `portfolio-theoretical-exposure-repository.js` et leurs tests d'intégration/contrat.
- Projection d'audit : `persistence/postgres-grains-replay-ledger.js` conserve aussi
  version du schéma/moteur, date de calcul et corps de preuve des résultats. Les
  anciens exports ne contenaient que leur empreinte : ils ne suffisaient pas à
  revérifier hors base toute l'arithmétique. Aucun résultat métier n'est recalculé
  par cette projection, qui ne fait qu'exporter les colonnes canoniques persistées.
- Replay : `grains-replay-risk-policy.mjs`, son test et la politique candidate figée.
- Gouvernance : ADR 0031, documentation du budget, ce rapport et exclusion Git ciblée
  des volumineuses preuves locales. Aucun fichier de données source n'est remplacé.

## 7. Fermeture et retour arrière

| Priorité | Propriétaire | Travail restant | Condition de fermeture |
|---|---|---|---|
| P0 | Exécution théorique / données | Réviser les six résultats à unité erronée | Anciennes preuves préservées, nouveaux résultats canoniques vérifiés |
| P0 | Portfolio / opérateur | Qualifier les huit réserves historiques | Preuve terminale ou disposition opérateur auditée, sans fill inventé |
| P0 | Market Data | Expliquer trous et révisions observés live/historique | Audit des événements de réception et révisions par timestamp |
| P0 | Release / Risk | Déployer le code et configurer les plafonds | Backup, migration 063, canary, contrôle Risk et safety après release |
| P1 | Portfolio / recherche | Évaluer la sélection complète hors échantillon | Pas de revendication de rentabilité sur cette seule semaine |

Pour la future release : préparer un paquet depuis des commits propres, utiliser
Build-DeskRelease/Test-DeskRelease/Update-Desk, backup et drain contrôlés, migration,
canary puis rollback prévu. Ne pas utiliser AllowDirty. Ne pas activer AUTO/LIVE.
Un retour à NET_BY_DIRECTION ne modifie que les futurs arbitrages : les plans et
réserves déjà persistés ne sont pas réécrits. La migration calendrier 063 est
forward-only ; le retour arrière applicatif doit rester compatible avec son schéma.

## 8. Preuves et reproduction

Répertoire des preuves : `output/research/grains-risk-closure-20260906/`.
Les gros exports de marché et résultats complets sont conservés localement, ignorés
par Git ; leurs hashes rendent les entrées identifiables, pas disponibles magiquement
dans un clone neuf. Aucun secret n'est nécessaire dans le rapport.

- `market-backfill-*-qualification.json`, `market-backfill-*-provenance.json` et CSV : source et différences.
- `prepare-recovered-input.mjs`, `prepare-native-week.mjs`, receipts : copies séparées et original inchangé.
- `replay-*.json`, `comparison-*.json` : ledger canonique, hashes code/données, politique effective et résultats.
- `pipeline-explicit-policy-before.log` / `pipeline-explicit-policy-after.log` :
  reproduction du défaut de configuration puis test de son refus sans consommation.
- `verify-certified-pair.mjs` : contrôle de la paire, du code courant, des preuves
  monétaires exportées, des unités Target/Intent, des plafonds par proposition et
  de l'absence de commande provider. Il ne simule pas un nouveau trade.
- `vps-inspection.json`, `vps-release-and-monetary-audit.json` : contrôles VPS en lecture seule.
- `*-tests.log`, `*-certified.log`, `static_quality_guard.log` : commandes et validations.

Commande canonique, à répéter avec le fichier de politique témoin puis candidat :

```bash
node.exe mcp_gpt_desk/scripts/replay_us_grains_causal_postgres.mjs \
  --input output/research/grains-risk-closure-20260906/week-native-m1-m5.json \
  --output <nouveau-fichier-resultat.json> \
  --policy-file reports/research/GRAINS_RISK_SELECTION_POLICY_20260906.json \
  --start 2026-08-31 --end 2026-09-04 --as-of 2026-09-05T00:00:00Z
```

Prérequis explicites : Node Windows et PostgreSQL local de test configurés comme
dans le dépôt, migrations disponibles, fichiers de données dont les hashes correspondent.
Ne jamais pointer ce replay isolé sur une base de production ni remplacer son entrée.

Commandes pour reproduire les validations exécutées (les redirections vers les
logs ne sont pas nécessaires au fonctionnement) :

```bash
node.exe scripts/quality/check_desk_domain_coverage.mjs
node.exe --test --test-concurrency=4 mcp_gpt_desk/test/*.test.js
npm.cmd run test:grains:postgres
node.exe --input-type=module -e 'process.env.RUN_POSTGRES_TESTS="1"; await import("./mcp_gpt_desk/test/grains_causal_pipeline_postgres.test.js");'
node.exe --input-type=module -e 'process.env.RUN_POSTGRES_TESTS="1"; await import("./mcp_gpt_desk/test/us_grains_causal_postgres_replay.test.js");'
node.exe node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext packages/desk-domain/index.d.ts
node scripts/quality/check_architecture_boundaries.mjs
node scripts/quality/check_runtime_safety.mjs
node scripts/quality/check_sql_migrations.mjs
node scripts/quality/check_api_compatibility.mjs
node scripts/quality/check_static_quality_guard.mjs
git.exe diff --check
```

Les guards ont utilisé Node Linux avec `rg` disponible. Les tests PostgreSQL ont
utilisé Node Windows ; `RUN_POSTGRES_TESTS` est fixé **dans ce processus**, pas
supposé transmis de WSL à Windows. `test:grains:postgres` est le script réel du
package racine, exécutant les onze suites sans skip.
