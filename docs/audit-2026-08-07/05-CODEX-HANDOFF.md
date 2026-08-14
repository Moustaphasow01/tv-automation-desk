# CODEX-HANDOFF — Phases -1, 0 et 1 uniquement

**Version 2 — intègre l'errata de sûreté du 2026-08-07.** Trois
changements majeurs par rapport à la version 1, tous issus de l'errata :
(1) le fix de la collision `Map` précède désormais le déclenchement de la
réconciliation périodique — l'ordre des tickets 0.x est inversé sur ce
point ; (2) une nouvelle colonne `trades.strategy_instance_id` est
introduite en Phase 1, sans réinterprétation du `strategy_id` legacy ; (3)
le ticket de concurrence positionnelle est **fortement restreint** — il ne
touche plus les chemins réels de soumission broker, seulement la
comptabilité paper/shadow, jusqu'à la livraison du Portfolio Arbitration
Engine, du Global Risk Engine et du Broker Netting Engine. Voir
`04-ADDENDUM-PASSATION.md` (version 2) pour le détail et les citations.

Rien dans ce document n'a été exécuté. Aucun code fonctionnel n'a été
modifié pour le produire.

---

## 0. Décisions opérateur bloquantes — à trancher avant le Ticket 1

| # | Décision | Bloque |
|---|---|---|
| OP-1 | État réel actuel des 9 services WinSW | Ticket -1.1 |
| OP-2 | Version de contrat réellement active (5.4.0 vs 5.1.0) | Ticket -1.1, et tout ticket de Phase 1 référençant une version de contrat |
| OP-3 | Mode d'authentification Codex CLI en production | Non bloquant pour Phases -1/0/1 |
| OP-4 | Politique de netting pour positions opposées inter-stratégies (ADR-01) | Ticket 0.4 (rejet explicite par défaut si non tranchée) |
| OP-5 | Portée exacte du vocabulaire de la DSL de Strategy Specification | Ticket 1.1 — **le mécanisme lui-même n'est plus une décision ouverte** (ADR-02 résolu par l'errata : DSL déclarative sérialisée JSON, validée JSON Schema) |
| OP-6 (nouveau) | Confirmation de la source canonique de sémantique JS vs Python (ADR-07) | Non bloquant pour Phases -1/0/1 — à trancher avant la Phase 2/3 |

**Recommandation** : trancher OP-1, OP-2, OP-4 avant le premier commit de
code. OP-5 a une valeur par défaut recommandée (voir Ticket 1.1). OP-3 et
OP-6 peuvent attendre.

---

## 1. Ordre exact des tickets (révisé)

```
Phase -1 :  -1.1 → -1.2 → -1.3
Phase  0 :   0.1 →  0.2 →  0.3 →  0.4 →  0.5 →  0.6
Phase  1 :   1.1 →  1.2 →  1.3 →  1.4 →  1.5 →  1.6 →  1.7
```

**Changement de fond par rapport à la version 1** : l'ancien Ticket 0.4
(réconciliation périodique) et l'ancien Ticket 0.5 (fix `Map`) sont
**inversés**. Le nouveau 0.4 est le fix `Map` ; le nouveau 0.5 est la
réconciliation périodique, désormais explicitement bloquée tant que 0.4
n'est pas terminé (errata point 1).

Aucun ticket de Phase 0 ne démarre avant que les trois tickets de Phase -1
soient terminés. Aucun ticket de Phase 1 ne démarre avant que 0.4 (fix
`Map`) soit terminé et validé — 0.5 (réconciliation périodique) peut être
développé en parallèle de la Phase 1 dès lors que 0.4 est livré, il n'est
pas lui-même bloquant pour la Phase 1.

---

### Ticket -1.1 — Capture de l'état exact
**Fichiers concernés** : aucun fichier de code — sorties : tag Git, fichier
d'état consigné. **À ne pas modifier** : tout, lecture seule. **Actions** :
tag Git sur le commit socle ; état réel des 9 services (OP-1) ;
`get_active_contracts` (OP-2) ; `pg_dump --schema-only`. **Critère de
passage** : les 4 sorties existent, OP-1/OP-2 tranchées. **Risques** :
aucun. **Rollback** : sans objet.

### Ticket -1.2 — Baseline de tests et fixtures
**Fichiers concernés** : nouvelles fixtures uniquement. **À ne pas
modifier** : tout code de production. **Actions** : suite CI complète,
pass/fail consigné ; fixtures (deux sessions, `strategy_id` legacy
renseigné sur au moins une ligne pour prouver la non-réinterprétation
future). **Critère de passage** : suite complète tourne, fixtures
committées. **Risques** : aucun. **Rollback** : suppression des fixtures.

### Ticket -1.3 — Tests de caractérisation de bout en bout
**Fichiers concernés (en lecture, tests contre eux)** :
`desk-ai-worker-service.js`, `deterministic-compiler-entry-v1.js`,
`live-paper-execution.js`, `broker-execution-repository.js`. **À ne pas
modifier** : ces fichiers eux-mêmes. **Actions** : stubber
`CodexExecAdapter.analyze()` et le transport NinjaTrader (aucun vrai appel
Codex, aucun vrai ordre, même simulé, ne doit sortir) ; écrire les deux
tests de parcours, **avec horodatage explicite de chaque étape du snapshot
fill → protection → clôture** (errata point 5 — sert de référence
temporelle au Ticket 0.5). **Critère de passage** : les deux tests passent
et deviennent référence de non-régression. **Risques** : un stub mal
conçu masquerait un vrai appel réseau — vérifier l'isolation. **Rollback** :
suppression des tests.

### Ticket 0.1 — Relancer la capture de données
**Fichiers concernés** : configuration du job d'ingestion existant. **À
ne pas modifier** : `tradingview-m1-backfill-importer.js` (logique
inchangée). **Tests** : idempotence de la reprise (`ON CONFLICT DO
NOTHING`, ligne 451-478). **Critère de passage** : bougies fraîches,
retard mesuré et alerté ; test d'idempotence passe. **Risques** :
duplication si mal configuré. **Rollback** : arrêt du job, aucune perte.

### Ticket 0.2 — Importer les 33 103 lignes déjà capturées
**Fichiers concernés** : importeur déjà existant. **À ne pas modifier** :
aucun fichier de logique de production. **Tests** : dry-run par buckets
avant commit réel. **Critère de passage** : lignes importées, dry-run
exact, second passage idempotent. **Risques** : faible. **Rollback** :
suppression par `import_id`.

### Ticket 0.3 — Brancher `PROTECTION_CONFIRMED` — **définition corrigée (errata point 6)**

**Définition non négociable pour ce ticket** : `PROTECTION_CONFIRMED`
signifie qu'un ordre protecteur a été **accepté côté broker et observé
dans un état valide** — une lecture positive de l'état réel de l'ordre
chez NinjaTrader (via l'AddOn, déjà connecté aux objets `Order` natifs),
jamais une inférence depuis une valeur enregistrée localement.
**L'enregistrement local d'un prix de stop ne constitue à aucun moment une
confirmation** — c'est précisément le défaut actuel à corriger, pas une
définition à assouplir.

**Fichiers concernés** : `broker-execution-repository.js`
(`persistEntryFillAndTrade`, lignes 1010-1055), `position-state-machine-v1.js`
(lignes 12-91, **invoquée, pas réécrite**), point d'exposition déjà
existant côté AddOn pour lire l'état réel de l'ordre protecteur. **À ne
pas modifier** : la machine à états elle-même — risque de casser
`ENGINE_ONLY_EVENTS` si altérée plutôt qu'appelée.

**Tests à écrire avant changement** :
1. Mise à jour du test de caractérisation -1.3 (divergence délibérée).
2. Fill sans stop attaché → fermeture d'urgence + alerte, jamais un
   `status='open'` silencieux.
3. Fill avec stop **localement enregistré mais jamais confirmé côté
   broker** → ne doit **pas** produire `PROTECTION_CONFIRMED` (test
   spécifique à la définition corrigée — c'est le cas que le bug actuel
   traite incorrectement comme confirmé).
4. Fill avec stop confirmé par une lecture positive côté broker →
   `PROTECTION_CONFIRMED` émis.

**Critère de passage au ticket suivant** : les 4 tests passent, -1.3 mis à
jour. **Risques** : faux négatif de fermeture d'urgence — tester
explicitement le test 3 en particulier, c'est le piège le plus probable
d'une implémentation qui confondrait encore enregistrement local et
confirmation réelle. **Rollback** : feature flag, retour au comportement
-1.3 en cas de faux positifs excessifs en shadow.

### Ticket 0.4 — Corriger la collision `Map` — **précède désormais 0.5 (errata point 1), portée narrow (errata point 2), agrégation signée (errata point 5)**

**Ce ticket doit être terminé et validé avant le Ticket 0.5 et avant tout
ticket de Phase 1.**

**Fichiers concernés** : `broker-execution-service.js` (fonction
`compareSnapshots` uniquement).

**Fichiers à ne pas modifier** : `reconciliationSnapshot(accountId)` côté
repository (scope compte déjà correct en amont). **Ne pas introduire de
dépendance à `strategy_id` ou `strategy_instance_id` dans ce ticket** — la
correction est une agrégation pure par instrument, l'attribution par
stratégie est explicitement déportée au Ticket 1.6.

**Décision préalable** : OP-4 (politique de netting pour sens opposés) —
si non tranchée, implémenter par défaut le rejet explicite plutôt qu'un
comportement silencieux.

**Actions** :
1. Agréger `desk.trades` par instrument en sommant des **quantités
   signées** (LONG positif, SHORT négatif) — pas quantité non signée +
   champ `side` séparé (errata point 5).
2. S'assurer que le snapshot desk et le snapshot broker comparés portent
   un horodatage explicite.
3. Introduire une fenêtre de tolérance temporelle bornée avant de
   classifier un écart transitoire comme `POSITION_QUANTITY_MISMATCH` dur
   (fills/clôtures en cours).

**Tests à écrire avant changement** :
1. Deux `trades` ouverts, même compte/instrument, `strategy_id` legacy
   différents, même sens → somme signée correcte, pas de faux mismatch.
2. Sens opposés → rejet explicite conforme à OP-4.
3. Écriture concurrente dans la fenêtre de tolérance → pas de faux
   mismatch.
4. Instrument connu du broker, absent de `desk.trades` — non-régression.
5. Invariant continu (hors fenêtre de tolérance) : quantité signée
   consolidée desk = somme signée des `quantity_open` ouverts sur
   `(compte, instrument)`.
6. Fill confirmé côté broker mais pas encore écrit côté desk (ou
   l'inverse), dans la fenêtre de tolérance → pas de mismatch dur.

**Critère de passage au Ticket 0.5** : les 6 tests passent ; le test de
caractérisation -1.3 ne régresse pas.

**Risques** : une fenêtre de tolérance trop large masquerait une vraie
divergence ; trop courte réintroduirait des faux positifs pendant les
fills. Calibrer sur les horodatages capturés par -1.3. **Rollback** :
comportement actuel derrière un flag.

### Ticket 0.5 — Déclencher la réconciliation périodique — **bloqué tant que 0.4 n'est pas terminé (errata point 1)**

**Fichiers concernés** : `run_broker_management_worker.mjs` (point
d'accroche), `broker-execution-service.js` (`reconcile()`, **appelée, pas
réécrite** — sa logique interne a déjà été corrigée par le Ticket 0.4).

**Fichiers à ne pas modifier** : `compareSnapshots` elle-même — déjà
corrigée par 0.4, ce ticket ne fait qu'ajouter un déclenchement planifié.

**Tests à écrire avant changement** : une divergence artificiellement
introduite en base de test est détectée et verrouille le compte dans un
délai mesuré, sans intervention manuelle — **exécuté contre la version
corrigée de `compareSnapshots` (0.4), jamais contre l'ancienne**.

**Critère de passage au ticket suivant** : le test ci-dessus passe ; la
cadence de déclenchement est explicitement documentée.

**Risques** : activer ce ticket avant 0.4 transformerait le bug latent en
verrouillages périodiques automatiques — c'est précisément le risque que
l'errata a fait corriger par le reséquencement. **Rollback** : désactiver
le déclenchement planifié, le mécanisme manuel reste disponible.

### Ticket 0.6 — Corrections ponctuelles — **`atr_14` et hash sous nouvelle version obligatoire (errata point 7)**

**Contrainte non négociable** : toute nouvelle sémantique doit être
introduite sous une **nouvelle version de contrat/schéma**, jamais comme
redéfinition silencieuse dans la version actuelle. Les artefacts existants
restent immuables.

**Fichiers concernés** : `desk-market-feature-algorithms.js`
(`recentAverageRange`, lignes 780-783) — soit une nouvelle clé versionnée
est ajoutée à côté de `atr_14` (pas un renommage in place sous la même
version), soit une nouvelle version de schéma de feature est créée.
`poc_vah_val` (ligne 394) **laissée telle quelle**, correctement
documentée comme non calculable, pas un bug. Extension du hash macro/news
(`pack-integrity.js:431`, `desk-replay-orchestration-algorithms.js:2340`)
— si jugée nécessaire avant Phase 1, **également sous nouvelle version de
schéma de pack**, sinon reporter.

**Fichiers à ne pas modifier** : tout consommateur de `atr_14` non recensé
au préalable ; aucun artefact/pack déjà produit ne doit être réinterprété
rétroactivement.

**Tests à écrire avant changement** : non-régression sur chaque
consommateur identifié de l'ancienne clé ; vérification qu'un artefact
produit sous l'ancienne version reste lisible et inchangé après
introduction de la nouvelle version.

**Critère de passage au ticket suivant** : nouvelle sémantique disponible
sous une version distincte, tous les consommateurs recensés migrés
explicitement vers la version de leur choix (pas basculés automatiquement).

**Risques** : consommateur non recensé casserait silencieusement.
**Rollback** : trivial, la nouvelle version est additive.

### Ticket 1.1 — Strategy Definition (schéma)

**Décision préalable** : OP-5 (portée du vocabulaire) — le mécanisme est
déjà résolu par l'errata (ADR-02) : **DSL déclarative sérialisée en JSON,
validée par JSON Schema**. Ne pas re-débattre JSON Schema comme alternative
à une DSL — ce sont deux couches différentes (langage vs mécanisme de
validation), pas deux options concurrentes.

**Fichiers concernés** : nouveau schéma, sur le modèle de
`packages/desk-contracts/schemas/entities/*.schema.json`.

**Fichiers à ne pas modifier** : **`strategy-runtime-versioning.js` — ni ce
ticket ni aucun ticket de Phase 1 ne doit le toucher.**

**Tests** : validation contre au moins 2 exemples (dont `BREAKOUT_RETEST`
du catalogue déjà existant).

**Critère de passage au ticket suivant** : schéma existe, validé, un
exemple passe.

### Ticket 1.2 — Strategy Version (schéma) — **porte un statut propre (errata point 4)**

**Fichiers concernés** : nouveau schéma référençant une Strategy
Definition par id. **Champ obligatoire ajouté** : un statut propre à la
Version elle-même (ex. `DRAFT`/`VALIDATED`/`DEPRECATED`), **distinct** de
tout état d'exécution — celui-ci appartient à la Strategy Instance (Ticket
1.3), pas à la Version.

**Fichiers à ne pas modifier** : idem 1.1.

**Tests** : deux Strategy Versions distinctes référençant la même
Definition, validées, avec des statuts différents.

**Critère de passage au ticket suivant** : schéma existe et est validé.

### Ticket 1.3 — Strategy Instance (schéma) — **remplace l'ancien Ticket 1.3 du plan précédent, deux axes distincts (errata point 4)**

**Ce ticket remplace explicitement l'ancienne recommandation « remplacer
`ACTIVE_STRATEGY_RUNTIME_VERSIONS` par un ensemble ».**

**Fichiers concernés** : nouveau schéma, référence une Strategy Version
(1.2), porte le scope compte/instrument/session/mode, **et deux champs
distincts, jamais fusionnés** :
- **état runtime** (en cours, en pause, en erreur, retirée) ;
- **mode d'exécution** `SHADOW` / `PAPER` / `LIVE`.

**Garde technique non négociable** : le mode ne peut passer à `LIVE` en
présence d'une autre Strategy Instance déjà `LIVE` sur le même compte que
si un drapeau explicite « triple verrou validé » (Portfolio Arbitration +
Global Risk + Broker Netting Engine, hors périmètre de ce document) est
positionné. **Implémenter ce refus comme une garde de code active, pas
comme une absence de développement** — sans cette garde, rien n'empêche
techniquement une activation accidentelle.

**Fichiers à ne pas modifier** : `strategy-runtime-versioning.js`.

**Tests** :
1. Deux Strategy Instances actives simultanément en mode `SHADOW`/`PAPER`,
   Versions différentes, **sous le même Runtime Contract Bundle actif
   inchangé** — preuve de l'orthogonalité avec §1 de l'addendum.
2. Tentative de passage d'une deuxième instance en mode `LIVE` sans le
   drapeau de triple verrou → rejet explicite, testé positivement (le test
   doit vérifier que le rejet a bien lieu, pas seulement l'absence
   d'erreur).

**Critère de passage au ticket suivant** : les deux tests passent.

### Ticket 1.4 (nouveau) — `trades.strategy_instance_id`, sans réinterprétation du `strategy_id` legacy (errata point 2)

**Fichiers concernés** : migration additive sur `trades` (nouvelle colonne
`strategy_instance_id`, FK nullable vers Strategy Instance).

**Fichiers à ne pas modifier** : la colonne `strategy_id` existante reste
inchangée, en lecture, jamais réécrite ni mappée automatiquement.

**Contrainte non négociable** : **aucun script de backfill ne doit
tenter de déduire une `strategy_instance_id` à partir des valeurs
historiques de `strategy_id`.** Toutes les lignes existantes gardent
`strategy_instance_id IS NULL` indéfiniment. Seules les nouvelles lignes,
écrites après la mise en service d'une vraie Strategy Instance, portent la
nouvelle colonne renseignée.

**Tests à écrire avant changement** :
1. Une ligne `trades` historique (fixture de -1.2, `strategy_id` renseigné)
   reste lisible, inchangée, avec `strategy_instance_id IS NULL` après la
   migration.
2. Une nouvelle ligne créée avec une Strategy Instance valide porte
   `strategy_instance_id` renseigné et `strategy_id` peut rester vide ou
   porter une valeur de compatibilité — sans confusion entre les deux
   champs dans aucune requête existante.

**Critère de passage au ticket suivant** : les deux tests passent ; aucune
requête existante lisant `strategy_id` n'est modifiée par ce ticket.

**Risques** : la tentation d'un backfill « pratique » est le risque
principal — explicitement interdit par l'errata, à documenter dans la
revue de code de ce ticket comme point de vigilance. **Rollback** :
colonne additive, retrait trivial si nécessaire (mais préférer un flag
désactivant son usage plutôt qu'un `DROP COLUMN`, cf. discipline
expand/migrate/contract).

### Ticket 1.5 (anciennement 1.4) — Peupler `strategy_catalog`/`desk_strategy_versions`

**Fichiers concernés** : `front-operations-service.js` (lignes 1288-1341,
**lecture seule, non modifiée**), nouveau chemin d'écriture.

**Fichiers à ne pas modifier** : le code de lecture frontend existant ne
doit nécessiter aucune modification.

**Tests** : une Strategy créée via 1.1-1.4 apparaît dans ces tables et est
lisible par le frontend existant sans modification de celui-ci.

**Critère de passage au ticket suivant** : le test passe.

### Ticket 1.6 (anciennement 1.5) — Concurrence positionnelle **paper/shadow uniquement** — **portée fortement restreinte (errata point 3)**

**Correction de portée majeure, non négociable.** Ce ticket ne touche
**que** la comptabilité desk-side paper/shadow. Il ne rend **à aucun
moment** le broker ou l'AddOn NinjaTrader conscients de plusieurs
stratégies.

**Fichiers concernés, et UNIQUEMENT ceux-ci** :
- `live-paper-execution.js` (`max_simultaneous_positions: 1`, lignes
  87-95) — nom du fichier lui-même confirmant le scope paper. Adapté pour
  autoriser plusieurs Strategy Instances en `SHADOW`/`PAPER` sur le même
  instrument.
- La vue d'allocation interne par stratégie déportée depuis le Ticket 0.4
  (`04-ADDENDUM-PASSATION.md` §3) — construite ici, en s'appuyant sur
  `trades.strategy_instance_id` (Ticket 1.4), uniquement pour la
  comptabilité virtuelle, jamais transmise à `compareSnapshots`.

**Fichiers explicitement exclus de ce ticket — vérifiés sur le chemin réel
`BROKER_SUBMIT` avant cette version du document** :
- `packages/desk-domain/src/broker-execution.js`
  (`NO_DUPLICATE_POSITION`, lignes 439-442) — **confirmé** évalué en phase
  `BROKER_SUBMIT` aux côtés de `BRIDGE_HEALTHY`/`BRIDGE_CONNECTED`, c'est
  un verrou réel de soumission broker.
- le gate AddOn exigeant le broker flat avant toute entrée
  (`broker-execution-service.js`, ~862-865).
- les marks de gestion exigeant une correspondance de quantité exacte
  (`broker-execution-service.js`, ~826-833).
- `CLOSEPOSITION` instrument-wide
  (`packages/desk-domain/src/broker-position-management.js`, lignes
  333-337).

**Ces quatre points restent strictement inchangés jusqu'à la livraison du
Broker Netting Engine** (`04-ADDENDUM-PASSATION.md` §7). Toute modification
de ces quatre points en dehors de ce chantier constitue une violation de
la portée de la Phase 1.

**Fichiers à ne pas modifier** : `position-state-machine-v1.js`
(consommée, pas altérée) ; les quatre points listés ci-dessus.

**Tests à écrire avant changement** :
1. Deux Strategy Instances en mode `PAPER`, même instrument, coexistent
   sans déclencher `max_simultaneous_positions: 1`.
2. **Test négatif explicite** : une tentative de faire passer une des deux
   instances en mode `LIVE` alors qu'une autre est active sur le même
   compte échoue (garde du Ticket 1.3) — preuve que ce ticket n'ouvre
   aucune brèche vers l'exécution réelle.
3. Les quatre points exclus, testés en non-régression stricte (comportement
   identique à avant ce ticket, sur le chemin `BROKER_SUBMIT` réel).
4. La vue d'allocation interne agrège correctement par
   `(compte, instrument, strategy_instance_id)`, distincte de l'agrégation
   pure par instrument du Ticket 0.4.

**Critère de passage au ticket suivant** : les 4 tests passent, en
particulier le test négatif (2) et la non-régression des quatre points
exclus (3).

**Risques** : c'est le ticket où une erreur de portée aurait l'impact le
plus grave (activation prématurée d'exécution réelle multi-stratégies
non gouvernée) — la revue de ce ticket doit vérifier explicitement qu'aucun
des quatre fichiers exclus n'apparaît dans le diff. **Rollback** : chaque
changement derrière son propre flag, désactivable indépendamment.

### Ticket 1.7 (anciennement 1.6) — Cycle de vie minimal, trois axes (errata point 4)

**Fichiers concernés** : état runtime et mode d'exécution portés par le
schéma de 1.3 (déjà distincts), logique de transition `DRAFT → PAPER →
ACTIVE → RETIRED` pour l'état runtime, indépendante du statut de la
Strategy Version (1.2) et du mode d'exécution (1.3).

**Rappel explicite** : le mode `LIVE` pour une Strategy Instance en
concurrence avec une autre reste techniquement bloqué par la garde du
Ticket 1.3, quel que soit l'état runtime atteint par ce ticket.

**Tests** : chaque transition d'état runtime valide et invalide testée
explicitement ; confirmation que l'état runtime `ACTIVE` n'implique jamais
automatiquement le mode d'exécution `LIVE` — les deux axes restent
indépendants même à l'état runtime le plus avancé.

**Critère de passage à la suite (Live Strategy Runtime, hors périmètre de
ce document)** : une Strategy Instance peut être créée en `DRAFT`, promue
`PAPER`, sans qu'aucun ordre réel ne soit jamais soumis avant `ACTIVE` **et**
avant que le triple verrou §7 de l'addendum ne soit validé pour le mode
`LIVE` — vérifié par test, pas par relecture de code seule.

---

## 2. Ce que ce document ne couvre délibérément pas

Aucun détail fichier pour : Simulation Engine (Phase 2), Live Strategy
Runtime au-delà du critère de sortie du Ticket 1.7, Experiment Registry,
Portfolio Arbitration/Global Risk/Broker Netting Engine, migration du rôle
du LLM, Data Acquisition and Provenance, ExecutionProvider/PickMyTrade. Ces
chantiers restent au niveau d'intention fixé dans `03-PLAN-EVOLUTION.md` et
`04-ADDENDUM-PASSATION.md` jusqu'à ce que les Phases -1/0/1 soient livrées
et qu'un nouveau point de passation soit produit sur cette base.
