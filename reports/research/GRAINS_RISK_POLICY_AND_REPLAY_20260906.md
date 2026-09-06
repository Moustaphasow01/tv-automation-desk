# Politique de risque grains — intégration et replay du 6 septembre 2026

## Périmètre et autorité

TD2-429. Branche `codex/grains-week-integrity`, baseline propre
`e93e37fac0cdf8b4f3715f8835f4d1c4d938301a`.

Plafonds fournis par l'opérateur : **500 USD par position, 2 000 USD par jour,
4 000 USD par semaine**. Le lot concerne le domaine Risk, son application dans
le pipeline partagé et les preuves locales PostgreSQL. Il ne modifie pas les
moteurs grains, leurs conditions, leurs prix ni leurs fenêtres d'entrée.

**Pas de déploiement ni de changement de configuration VPS dans ce lot.**
L'inspection VPS a été exclusivement en lecture seule ; elle n'a pas trouvé de
budget monétaire ni de capital de référence dans la configuration inspectée.
Les anciennes décisions VPS n'exposent pas les nouvelles métadonnées de sizing :
elles ne certifient pas une équivalence avec la politique locale testée.

## Politique exacte

Fichier figé : `reports/research/GRAINS_RISK_REPLAY_POLICY_20260906.json`.

- Plafond par position appliqué **avant** le multiplicateur de contexte.
- La quantité autorisée ne dépasse jamais la quantité proposée par la stratégie.
- Le budget disponible est le minimum de `500 × multiplicateur`, du solde
  quotidien et du solde hebdomadaire.
- Chaque solde soustrait la perte nette réalisée et le risque au stop déjà
  réservé par les ordres théoriques en attente ou les positions encore ouvertes.
- Quantité entière par arrondi inférieur : aucun minimum d'un contrat forcé.
- Périodes UTC, semaine commençant lundi, conformément au ledger existant.
- Perte nette = `max(0, -somme des PnL réalisés nets)` ; ce n'est pas la somme des
  seuls trades perdants. Les gains ne portent pas le budget au-dessus du plafond.
- Pas de conversion `R × 500`. Les USD viennent des résultats et des plans
  autorisés canoniques. Le capital inconnu laisse le risque en pourcentage inconnu.
- Anciennes limites de contrats conservées, sans hausse. Les limites en R
  restent indépendantes et ne remplacent pas les limites monétaires.

Le plafond est un **risque prévu au stop**, pas une garantie de perte physique :
un gap, un glissement ou des frais peuvent aggraver une perte exécutée. Ce lot ne
certifie pas le trading broker ni un mécanisme de liquidation physique.

## Corrections et invariants vérifiés

| Cause constatée | Correction | Invariant préservé |
|---|---|---|
| Un contrat multiplié par 0,85/0,65/0,5 devenait zéro dans l'ancienne politique | Mode monétaire explicite, réduction du budget plutôt que du contrat avant Risk | Ne pas gonfler la demande ni forcer un contrat |
| Absence de plafonds monétaires et de leur consommation persistée | Lecture causale des pertes nettes et des réserves ; limites jour/semaine dans Risk | Donnée inconnue ou devise incohérente = blocage |
| Réduction par les plafonds de contrats pouvant réserver un risque provisoire trop grand | Réserver le risque de la quantité finalement autorisée | Partage du budget entre allocations ; verrou transactionnel du compte |
| Nouvelle politique réutilisant une clé automatique de l'ancienne configuration | Empreinte de politique dans l'idempotence automatique | Ne pas rejouer une décision sous une autre politique silencieusement |
| CONFIG_MISSING pouvait consommer les signaux admissibles et laisser des candidats canoniques conflictuels | Attente jusqu'à expiration ; brouillons dans le payload d'audit du run, pas dans les allocations canoniques | Un refus Context reste terminal ; aucun intent sans Risk valide |
| `null` devenait zéro dans la projection Target | Propager l'absence réelle | Aucun risque en pourcentage fictif |
| Plusieurs contributions dont une seule avec une économie valide | Allocation monétaire multi-signal laissée PARTIAL, donc bloquée | Ne pas emprunter le risque d'un signal pour autoriser un autre plan |
| Résultat monétaire absent après un vrai target_hit du replay | Lire les unités figées sous `approved_trade_plan.economics.units` | Aucun point-value inventé ; moteur d'outcomes canonique réutilisé |
| Expiration historique écrite à l'heure réelle du test | Enregistrer le timestamp métier fourni dans gate/execution state | Garde anti-futur inchangée ; réception technique conservée séparément |
| Expiration Human Gate confondue avec fin théorique | Réserve conservée jusqu'à l'événement théorique terminal effectif | Une gate expirée n'efface pas la position théorique |

La restriction multi-signal est volontairement prudente : cette extension ne
certifie pas une fusion de plans hétérogènes. L'ancien mode de compatibilité est
conservé, mais ne constitue pas une certification de ces allocations incomplètes.

## Comparaison contrôlée

Fenêtre : **31 août au 4 septembre 2026**, cutoff
`2026-09-04T23:59:59.999Z`. Deux bases PostgreSQL locales jetables, pleinement
migrées, même moteur causal déterministe, sans worker IA, provider ou Telegram.

Entrée : `output/research/grains-calendar-20260906/week-with-calendar.json`.
SHA-256 : `8e7d878c6b29dff2333157892cf669a7dbb9735d3fdf96a4abd0636963492495`.
17 044 bougies ; la comparaison exige les mêmes IDs et les mêmes payloads des
signaux bruts, ainsi que les mêmes empreintes de code.

Le témoin conserve `REQUESTED_QUANTITY_CAP`. Le candidat charge uniquement la
politique monétaire explicite. Aucun paramètre de stratégie n'est ajusté après
lecture des performances. Le script refuse un changement de code en cours de run.

Les deux replays sont terminés. **606 empreintes de code identiques**, données,
IDs et payloads bruts identiques. Empreinte des payloads détectés :
`2988b47540d2b61468b1ac7f2c024306484b8327ca5372496af22adda82b467f`.
Seule la politique de risque diffère. Le nom de fichier `certified` signifie
ici que les invariants de comparaison passent, pas que tous les trades sont
résolus ou que la release VPS est certifiée.

| Étape / résultat | Témoin quantité | Politique monétaire |
|---|---:|---:|
| Signaux bruts | 100 | 100 |
| Admis Context | 90 | 90 |
| Rejetés Context | 10 | 10 |
| Signaux refusés Portfolio | 90, taille arrondie à zéro | 75, réservation théorique existante |
| Décisions Risk individuelles | 0 | 10 |
| Allocations refusées Risk | 0 | 5, représentant 10 signaux |
| Signaux qualifiés → Target → Intent → Human Gate | 0 | 5 |
| Entrées théoriques remplies | 0 | 2 |
| Expirations théoriques prouvées | 0 | 1 |
| Entrées sans issue théorique prouvée | 0 | 2 |
| Trades théoriques clôturés | 0 | 2 : 1 TP et 1 stop |
| Somme des R clôturés | Non évaluable, aucun trade | **+0,5714 R** |
| Somme des PnL clôturés | Non évaluable | **0 USD** |
| Frais enregistrés | — | 0 USD, pas une certification de coûts réalistes |
| Drawdown des clôtures | — | 1 R / 137,50 USD |
| Commandes provider | 0 | 0 |

La partition des 100 signaux est : 10 rejetés Context + 75 refusés Portfolio +
10 contribuant aux 5 allocations refusées Risk + 5 qualifiés. Ne pas confondre
le nombre d'allocations et le nombre de signaux.

Les 5 refus Risk ne proviennent **pas des plafonds 500/2 000/4 000 saturés**.
Ce sont 5 allocations de deux signaux, dont les économies individuelles sont
KNOWN mais dont la fusion n'est pas certifiée. Le code générique persisté
`MONETARY_RISK_PER_CONTRACT_UNAVAILABLE` décrit une économie d'allocation non
autorisable, pas une absence de prix individuels. Quatre paires ont des empreintes
économiques identiques ; une paire a des plans différents. Leur traitement exige
une politique explicite de fusion/arbitrage, pas une suppression du contrôle.

### Résultats par journée UTC

| Date | Bruts | Admis Context | Rejetés Context | Intents / gates | Fills | TP | Stops | Expiration théorique | R clôturés | PnL clôturé USD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 31/08 | 11 | 7 | 4 | 1 | 1 | 1 | 0 | 0 | +1,5714 | +137,50 |
| 01/09 | 16 | 16 | 0 | 2 | 1 | 0 | 1 | 0 | -1 | -137,50 |
| 02/09 | 31 | 26 | 5 | 2 | 0 | 0 | 0 | 1 | 0 | 0 |
| 03/09 | 21 | 20 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04/09 | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**Pourquoi +0,5714 R et 0 USD ?** Le gagnant avait un risque initial de
87,50 USD et gagne 137,50 USD (+1,5714 R). Le perdant avait un risque initial de
137,50 USD et perd 137,50 USD (-1 R). Une somme de R de trades à risques
différents n'est pas le rendement monétaire du compte. Win rate : 1/2 = 50 %, sur
un échantillon insuffisant ; pas de conclusion de rentabilité.

### Les cinq ordres qualifiés, sans confusion avec les signaux bruts

Tous LIMIT LONG, quantité 1, prix inchangés après Risk. Horaires UTC ; heures
des événements liées aux bougies M1, dont le timestamp représente leur ouverture.

| Instrument / demande | Entrée | Stop | TP1 / TP2 | Risque USD | Issue canonique |
|---|---:|---:|---:|---:|---|
| ZW, 31/08 17:45 | 769,25 | 767,50 | 772 / 773,25 | 87,50 | Fill 18:01, TP 18:13 |
| ZC, 01/09 15:00 | 542,50 | 541,25 | 544,50 / 545,25 | 62,50 | Indéterminé, 2 minutes M1 absentes |
| ZW, 01/09 16:25 | 786,75 | 784 | 791 / 793 | 137,50 | Fill 16:25, stop 16:31 |
| ZW, 02/09 14:35 | 780,25 | 777,75 | 784 / 786 | 125 | Expiration théorique 15:20 |
| ZW, 02/09 15:35 | 780,25 | 777,75 | 784 / 786 | 125 | Indéterminé, 11 minutes M1 absentes |

À la fin : zéro position remplie encore ouverte, **mais deux mandats théoriques
non résolus**, réservant 187,50 USD. Toutes les confirmations humaines ont
expiré : cela n'est pas leur résultat théorique. Les 75 refus Portfolio incluent
des réservations ordinaires pendant le suivi et celles prolongées par ces trous ;
ne pas attribuer arbitrairement les 75 aux seules données manquantes.

### Cause prouvée des deux dossiers non résolus

Le rapprochement direct avec l'entrée figée trouve :

- ZC `portfolio_order_intent_36e1de7cebec7da97d9644db` : fenêtre 01/09
  15:00–15:45, **43/45** bougies ; absentes à **15:06 et 15:08 UTC**.
- ZW `portfolio_order_intent_d9aea24b1087d8f9a3c328e4` : fenêtre 02/09
  15:35–16:20, **34/45** bougies ; absentes à **15:46–15:50, 15:56–15:59,
  16:12 et 16:16 UTC**.

Les autres fenêtres d'entrée sont complètes (35/35, 45/45, 45/45).
`completeEntryWindow()` refuse correctement de fabriquer une expiration lorsque
des minutes manquent. Les prix disponibles ne prouvent pas de fill, et aucune
issue terminale n'existe dans le ledger pour ces deux intents. La réserve ne doit
donc pas être retirée sur la seule base de l'expiration Human Gate.

**Prochaine dépendance données** : récupérer une source historique vérifiable
pour ces 13 minutes, ou une preuve qualifiée d'absence de transactions. L'absence
locale ne permet pas de choisir entre trou d'ingestion et minute sans échanges.
Aucune bougie interpolée ni issue reconstruite au jugé n'a été injectée.
Une entrée enrichie devra porter une nouvelle empreinte et servir à deux nouveaux
replays comparables ; cette preuve originale reste inchangée.

Les runs diagnostiques précédents ne servent pas de résultat final : l'un a
révélé le défaut d'outcome, un autre a été invalidé par
`REPLAY_CODE_CHANGED_DURING_RUN` lors du correctif.

## Limites de la preuve

- Calendrier officiel **reconstruit**, pas preuve de réception historique VPS.
  Voir `USDA_GRAINS_CALENDAR_QUALIFICATION_20260906.md` pour les réserves NASS/FAS.
- Heures de réception historiques des bougies non certifiées.
- Détection causale préparée, puis publication et exécution chronologiques par
  les services canoniques ; pas un nouveau simulateur de fills.
- Résultats théoriques seulement, pas PnL broker ni pourcentage du capital.
- Cette semaine vérifie l'intégration ; elle ne prouve ni rentabilité future ni
  robustesse hors échantillon.
- Aucune affirmation de données live fraîches ou de services VPS reconfigurés.

## Validation et reproductibilité

Les preuves détaillées sont conservées localement sous
`output/research/grains-risk-20260906/` (ignorées par Git).

| Contrôle exécuté sur le code final | Résultat / preuve |
|---|---|
| Domaine complet | **507/507 PASS**, `domain-certified.log` |
| Backend complet | **1 434 PASS, 29 SKIP conditionnels, 0 FAIL** sur 1 463 tests, `backend-certified.log` |
| PostgreSQL réel ciblé, relance complète | **22/22 PASS**, aucun skip, `postgres-certified-retry.log` |
| Expiration historique, relance isolée | **8/8 PASS**, `postgres-expiry-retry.log` |
| Deux replays canoniques, même code | Terminés, 100 signaux chacun, 0 commande provider |
| Comparaison données / code / IDs / payloads | Quatre invariants **true**, `comparison-certified.json` |
| Architecture / sûreté runtime / migrations | PASS ; 606 fichiers du manifeste replay ; aucune migration ajoutée |
| Qualité statique globale | **FAIL historique inchangé** : 270 fonctions longues / 250, 720 complexes / 650, 95 duplications / 72 |
| Espaces et conflits de patch | `git diff --check` PASS |
| Relecture monétaire indépendante | Aucun nouveau défaut de sécurité/unité démontré ; aucune modification pendant le gel |

Première passe PostgreSQL : 21/22, timeout de connexion locale de 5 secondes
pendant les créations concurrentes de bases. Le fichier concerné passe ensuite
8/8 et la suite entière 22/22 **sans changer le timeout ni désactiver un test**.
Les logs initiaux sont conservés. Aucun seuil de qualité abaissé. Frontend non
modifié, tests visuels non relancés : aucune certification front supplémentaire.

Les tests couvrent configuration manquante, reprise idempotente, montant ou devise
invalides, arrondi entier, solde inférieur au coût d'un contrat, réserves dans le
batch et entre batches, concurrence, position partiellement clôturée, garde as-of,
bornes UTC, absence d'outcome, lifecycle d'expiration et fill sans confirmation.
Les limites de 2 000/4 000 sont testées par cas de frontière, **pas atteintes par
les deux trades de cette semaine**.

Artefacts principaux : `replay-count-certified.json`,
`replay-monetary-certified.json`, `comparison-certified.json`,
`entry-window-audit.json`, `vps-risk-policy.json` (inspection en lecture seule).

Empreintes SHA-256 des preuves finales :

| Fichier | SHA-256 |
|---|---|
| Politique versionnée | `5ade16bf4ed7448b6951839b8ecf2ac6c6fa20dbe50536d280c5120ca300e8a8` |
| `replay-count-certified.json` | `2d35cf08074591afc5b558ceba9da0738f12222bd27536b405986e3c17073df0` |
| `replay-monetary-certified.json` | `91c67db1e55fbcc91c2878354026a3511002bcf4f615f6fd2b3ce9aa7d3cbb54` |
| `comparison-certified.json` | `e64724262a3a1b524e6841d3cbf904c0064bc332638b6f3ac6341f7658b599fc` |
| `entry-window-audit.json` | `d39a58aff20ec81bc9485671a11a133eea10f83ad89c39bd1ef295e728e8f889` |

```bash
node mcp_gpt_desk/scripts/replay_us_grains_causal_postgres.mjs \
  --input output/research/grains-calendar-20260906/week-with-calendar.json \
  --output output/research/grains-risk-20260906/replay-count-certified.json \
  --start 2026-08-31 --end 2026-09-04 --as-of 2026-09-04T23:59:59.999Z

node mcp_gpt_desk/scripts/replay_us_grains_causal_postgres.mjs \
  --input output/research/grains-calendar-20260906/week-with-calendar.json \
  --output output/research/grains-risk-20260906/replay-monetary-certified.json \
  --policy-file reports/research/GRAINS_RISK_REPLAY_POLICY_20260906.json \
  --start 2026-08-31 --end 2026-09-04 --as-of 2026-09-04T23:59:59.999Z

node mcp_gpt_desk/scripts/compare_grains_risk_replays.mjs \
  output/research/grains-risk-20260906/replay-count-certified.json \
  output/research/grains-risk-20260906/replay-monetary-certified.json \
  output/research/grains-risk-20260906/comparison-certified.json
```

Sur cette machine, les exécutions PostgreSQL utilisent `node.exe`. Les bases de
replay n'acceptent que la boucle locale et sont supprimées après le run. Les
empreintes de données, code et politique sont incluses dans chaque artefact.

## Passage ultérieur au VPS

La configuration ne bascule pas implicitement. Le futur déploiement doit vérifier
la release réellement active, ses migrations, le ledger théorique courant et sa
provenance avant d'appliquer les cinq variables documentées dans
`docs/engineering/portfolio-risk-budget-v1.md`. Il devra ensuite vérifier une
décision Risk canonique avec les bons plafonds, les réserves et l'audit associé,
sans activer AUTO/LIVE ni confirmer un ordre réel à des fins de test.

Le code du lot est validé localement, mais **TD2-429 reste ouvert** : données M1
des deux dossiers non résolus à qualifier, fusion des allocations multi-signaux
à traiter explicitement, puis validation de la configuration/release VPS. Il ne
faut pas annoncer que le desk est prêt en production sur la base de ce seul replay.
