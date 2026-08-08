# 17 — Executable Backlog

- **Titre** : Backlog exécutable, niveau fichier/fonction (Phases -1/0/1)
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : `docs/audit-2026-08-07/05-CODEX-HANDOFF.md` (v2, validé comme base de travail), `implementation-backlog.yaml`
- **Documents supersédés** : `docs/audit-2026-08-07/05-CODEX-HANDOFF.md` en tant que document de travail actif (son contenu est repris ici à l'identique, consolidé dans le dossier canonique — il reste consultable comme archive de la genèse de ces tickets, notamment pour l'historique des corrections d'errata)
- **Dernière vérification code** : voir chaque ticket, citations héritées de l'audit et de l'addendum déjà validés
- **Portée** : c'est le document de démarrage pour tout agent d'implémentation. Détail complet fichier/fonction pour les Phases -1, 0, 1. Les Phases 2-12 ne sont pas détaillées ici (voir `16` §8) — un nouveau point de passation devra être produit une fois ces trois phases livrées.

---

## 0. Gabarit de ticket (utilisé pour chaque ticket ci-dessous)

Chaque ticket suit ce gabarit à 12 champs, repris systématiquement :

1. **ID et titre**
2. **Dépend de**
3. **Fichiers concernés** (créés ou modifiés)
4. **Fichiers à ne pas modifier** (explicitement listés, jamais implicites)
5. **Décision(s) opérateur bloquante(s)**, le cas échéant
6. **Contrainte non négociable**, le cas échéant
7. **Tests à écrire avant changement**
8. **Critère de passage au ticket suivant**
9. **Risques**
10. **Rollback**
11. **Statut** (`NOT_STARTED` pour tous à la date de ce document)
12. **Source** (renvoi à l'audit/addendum d'origine pour traçabilité)

## 1. Décisions opérateur bloquantes avant le Ticket -1.1

Voir `operator-decisions.yaml` pour le détail complet. Rappel des plus urgentes : **OP-1** (état réel des 9 services WinSW), **OP-2** (version de contrat active), **OP-12** (état du hold `ENGINE_V5_VALIDATION_HOLD` à la date de démarrage réelle — à revérifier, pas supposé constant depuis 2026-08-01).

## 2. Ordre exact des tickets

```
Phase -1 :  -1.1 → -1.2 → -1.3
Phase  0 :   0.1 →  0.2 →  0.3 →  0.4 →  0.5 →  0.6
Phase  1 :   1.1 →  1.2 →  1.3 →  1.4 →  1.5 →  1.6 →  1.7
```

Le Ticket 0.4 (fix `Map`) précède strictement le Ticket 0.5 (réconciliation périodique) — voir ADR-0005. Le Ticket 1.5 peut être développé en parallèle du Ticket 1.6 une fois 1.1-1.4 terminés (`16` §3).

---

## Phase -1 — Baseline et caractérisation

### Ticket -1.1 — Capture de l'état exact
- **Dépend de** : rien.
- **Fichiers concernés** : aucun fichier de code — sorties : tag Git, fichier d'état consigné.
- **Fichiers à ne pas modifier** : tout, lecture seule.
- **Décisions opérateur bloquantes** : OP-1, OP-2.
- **Actions** : tag Git sur le commit socle ; état réel des 9 services (OP-1) ; `get_active_contracts` (OP-2) ; `pg_dump --schema-only`.
- **Critère de passage** : les 4 sorties existent, OP-1/OP-2 tranchées.
- **Risques** : aucun.
- **Rollback** : sans objet.
- **Statut** : `NOT_STARTED`.
- **Source** : `docs/audit-2026-08-07/05-CODEX-HANDOFF.md`, Ticket -1.1.

### Ticket -1.2 — Baseline de tests et fixtures
- **Dépend de** : -1.1.
- **Fichiers concernés** : nouvelles fixtures uniquement.
- **Fichiers à ne pas modifier** : tout code de production.
- **Actions** : suite CI complète, pass/fail consigné ; fixtures (deux sessions, `strategy_id` legacy renseigné sur au moins une ligne pour prouver la non-réinterprétation future).
- **Critère de passage** : suite complète tourne, fixtures committées.
- **Risques** : aucun.
- **Rollback** : suppression des fixtures.
- **Statut** : `NOT_STARTED`.
- **Source** : idem, Ticket -1.2.

### Ticket -1.3 — Tests de caractérisation de bout en bout
- **Dépend de** : -1.2.
- **Fichiers concernés (en lecture, tests contre eux)** : `desk-ai-worker-service.js`, `deterministic-compiler-entry-v1.js`, `live-paper-execution.js`, `broker-execution-repository.js`.
- **Fichiers à ne pas modifier** : ces fichiers eux-mêmes.
- **Actions** : stubber `CodexExecAdapter.analyze()` et le transport NinjaTrader (aucun vrai appel Codex, aucun vrai ordre, même simulé, ne doit sortir) ; écrire deux tests de parcours, avec horodatage explicite de chaque étape du snapshot fill → protection → clôture.
- **Critère de passage** : les deux tests passent et deviennent référence de non-régression.
- **Risques** : un stub mal conçu masquerait un vrai appel réseau — vérifier l'isolation.
- **Rollback** : suppression des tests.
- **Statut** : `NOT_STARTED`.
- **Source** : idem, Ticket -1.3.

---

## Phase 0 — Sûreté immédiate et fondations de données

### Ticket 0.1 — Relancer la capture de données
- **Dépend de** : -1.3.
- **Fichiers concernés** : configuration du job d'ingestion existant.
- **Fichiers à ne pas modifier** : `tradingview-m1-backfill-importer.js` (logique inchangée).
- **Tests** : idempotence de la reprise (`ON CONFLICT DO NOTHING`, lignes 451-478).
- **Critère de passage** : bougies fraîches, retard mesuré et alerté ; test d'idempotence passe.
- **Risques** : duplication si mal configuré.
- **Rollback** : arrêt du job, aucune perte.
- **Statut** : `NOT_STARTED`.
- **Source** : idem, Ticket 0.1.

### Ticket 0.2 — Importer les 33 103 lignes déjà capturées
- **Dépend de** : 0.1.
- **Fichiers concernés** : importeur déjà existant.
- **Fichiers à ne pas modifier** : aucun fichier de logique de production.
- **Tests** : dry-run par buckets avant commit réel.
- **Critère de passage** : lignes importées, dry-run exact, second passage idempotent.
- **Risques** : faible.
- **Rollback** : suppression par `import_id`.
- **Statut** : `NOT_STARTED`.
- **Source** : idem, Ticket 0.2.

### Ticket 0.3 — Brancher `PROTECTION_CONFIRMED` (définition corrigée)
- **Dépend de** : 0.2.
- **Définition non négociable** : `PROTECTION_CONFIRMED` signifie qu'un ordre protecteur a été accepté côté broker et observé dans un état valide — une lecture positive de l'état réel de l'ordre chez NinjaTrader (via l'AddOn, déjà connecté aux objets `Order` natifs), jamais une inférence depuis une valeur enregistrée localement. L'enregistrement local d'un prix de stop ne constitue à aucun moment une confirmation.
- **Fichiers concernés** : `broker-execution-repository.js` (`persistEntryFillAndTrade`, lignes 1010-1055), `position-state-machine-v1.js` (lignes 12-91, **invoquée, pas réécrite**), point d'exposition déjà existant côté AddOn pour lire l'état réel de l'ordre protecteur.
- **Fichiers à ne pas modifier** : la machine à états elle-même — risque de casser `ENGINE_ONLY_EVENTS` si altérée plutôt qu'appelée.
- **Tests à écrire avant changement** :
  1. Mise à jour du test de caractérisation -1.3 (divergence délibérée).
  2. Fill sans stop attaché → fermeture d'urgence + alerte, jamais un `status='open'` silencieux.
  3. Fill avec stop **localement enregistré mais jamais confirmé côté broker** → ne doit **pas** produire `PROTECTION_CONFIRMED`.
  4. Fill avec stop confirmé par une lecture positive côté broker → `PROTECTION_CONFIRMED` émis.
- **Critère de passage** : les 4 tests passent, -1.3 mis à jour.
- **Risques** : faux négatif de fermeture d'urgence — tester explicitement le test 3.
- **Rollback** : feature flag, retour au comportement -1.3 en cas de faux positifs excessifs en shadow.
- **Statut** : `NOT_STARTED`.
- **Source** : idem, Ticket 0.3.

### Ticket 0.4 — Corriger la collision `Map`
- **Dépend de** : 0.3. **Doit être terminé et validé avant le Ticket 0.5 et avant tout ticket de Phase 1** (ADR-0005).
- **Fichiers concernés** : `broker-execution-service.js` (fonction `compareSnapshots` uniquement).
- **Fichiers à ne pas modifier** : `reconciliationSnapshot(accountId)` côté repository (scope compte déjà correct en amont). Ne pas introduire de dépendance à `strategy_id` ou `strategy_instance_id` dans ce ticket — la correction est une agrégation pure par instrument, l'attribution par stratégie est explicitement déportée au Ticket 1.6.
- **Décision préalable** : OP-4 (politique de netting pour sens opposés) — si non tranchée, implémenter par défaut le rejet explicite plutôt qu'un comportement silencieux.
- **Actions** :
  1. Agréger `desk.trades` par instrument en sommant des **quantités signées** (LONG positif, SHORT négatif) — pas quantité non signée + champ `side` séparé.
  2. S'assurer que le snapshot desk et le snapshot broker comparés portent un horodatage explicite.
  3. Introduire une fenêtre de tolérance temporelle bornée avant de classifier un écart transitoire comme `POSITION_QUANTITY_MISMATCH` dur.
- **Tests à écrire avant changement** :
  1. Deux `trades` ouverts, même compte/instrument, `strategy_id` legacy différents, même sens → somme signée correcte, pas de faux mismatch.
  2. Sens opposés → rejet explicite conforme à OP-4.
  3. Écriture concurrente dans la fenêtre de tolérance → pas de faux mismatch.
  4. Instrument connu du broker, absent de `desk.trades` — non-régression.
  5. Invariant continu (hors fenêtre de tolérance) : quantité signée consolidée desk = somme signée des `quantity_open` ouverts sur `(compte, instrument)`.
  6. Fill confirmé côté broker mais pas encore écrit côté desk (ou l'inverse), dans la fenêtre de tolérance → pas de mismatch dur.
- **Critère de passage au Ticket 0.5** : les 6 tests passent ; le test de caractérisation -1.3 ne régresse pas.
- **Risques** : une fenêtre de tolérance trop large masquerait une vraie divergence ; trop courte réintroduirait des faux positifs pendant les fills. Calibrer sur les horodatages capturés par -1.3.
- **Rollback** : comportement actuel derrière un flag.
- **Statut** : `NOT_STARTED`.
- **Source** : idem, Ticket 0.4 ; voir aussi ADR-0003.

### Ticket 0.5 — Déclencher la réconciliation périodique
- **Dépend de** : 0.4. **Bloqué tant que 0.4 n'est pas terminé** (ADR-0005).
- **Fichiers concernés** : `run_broker_management_worker.mjs` (point d'accroche), `broker-execution-service.js` (`reconcile()`, **appelée, pas réécrite** — sa logique interne a déjà été corrigée par le Ticket 0.4).
- **Fichiers à ne pas modifier** : `compareSnapshots` elle-même — déjà corrigée par 0.4, ce ticket ne fait qu'ajouter un déclenchement planifié.
- **Décision préalable** : OP-10 (fréquence, comportement en cas de désynchronisation).
- **Tests à écrire avant changement** : une divergence artificiellement introduite en base de test est détectée et verrouille le compte dans un délai mesuré, sans intervention manuelle — exécuté contre la version corrigée de `compareSnapshots` (0.4), jamais contre l'ancienne.
- **Critère de passage** : le test ci-dessus passe ; la cadence de déclenchement est explicitement documentée.
- **Risques** : activer ce ticket avant 0.4 transformerait le bug latent en verrouillages périodiques automatiques.
- **Rollback** : désactiver le déclenchement planifié, le mécanisme manuel reste disponible.
- **Statut** : `NOT_STARTED`.
- **Source** : idem, Ticket 0.5 ; voir aussi ADR-0005.

### Ticket 0.6 — Corrections ponctuelles (`atr_14` et hash sous nouvelle version)
- **Dépend de** : 0.5.
- **Contrainte non négociable** : toute nouvelle sémantique doit être introduite sous une nouvelle version de contrat/schéma, jamais comme redéfinition silencieuse dans la version actuelle. Les artefacts existants restent immuables.
- **Fichiers concernés** : `desk-market-feature-algorithms.js` (`recentAverageRange`, lignes 780-783) — nouvelle clé versionnée ajoutée à côté de `atr_14` (pas un renommage in place), ou nouvelle version de schéma de feature. `poc_vah_val` (ligne 394) laissée telle quelle. Extension du hash macro/news (`pack-integrity.js:431`, `desk-replay-orchestration-algorithms.js:2340`) si jugée nécessaire avant Phase 1, également sous nouvelle version de schéma de pack, sinon reporter.
- **Fichiers à ne pas modifier** : tout consommateur de `atr_14` non recensé au préalable ; aucun artefact/pack déjà produit ne doit être réinterprété rétroactivement.
- **Tests à écrire avant changement** : non-régression sur chaque consommateur identifié de l'ancienne clé ; vérification qu'un artefact produit sous l'ancienne version reste lisible et inchangé.
- **Critère de passage** : nouvelle sémantique disponible sous une version distincte, tous les consommateurs recensés migrés explicitement vers la version de leur choix.
- **Risques** : consommateur non recensé casserait silencieusement.
- **Rollback** : trivial, la nouvelle version est additive.
- **Statut** : `NOT_STARTED`.
- **Source** : idem, Ticket 0.6.

---

## Phase 1 — Strategy Definition / Version / Instance

### Ticket 1.1 — Strategy Definition (schéma)
- **Dépend de** : 0.6.
- **Décision préalable** : OP-5 (résolue par l'errata — DSL déclarative sérialisée en JSON, validée par JSON Schema).
- **Fichiers concernés** : nouveau schéma, sur le modèle de `packages/desk-contracts/schemas/entities/*.schema.json`.
- **Fichiers à ne pas modifier** : `strategy-runtime-versioning.js` — ni ce ticket ni aucun ticket de Phase 1 ne doit le toucher (ADR-0001).
- **Tests** : validation contre au moins 2 exemples (dont `BREAKOUT_RETEST` du catalogue déjà existant).
- **Critère de passage** : schéma existe, validé, un exemple passe.
- **Risques** : faible.
- **Rollback** : additif.
- **Statut** : `NOT_STARTED`.
- **Source** : idem, Ticket 1.1.

### Ticket 1.2 — Strategy Version (schéma, statut propre)
- **Dépend de** : 1.1.
- **Fichiers concernés** : nouveau schéma référençant une Strategy Definition par id. Champ obligatoire ajouté : un statut propre à la Version elle-même (`DRAFT`/`VALIDATED`/`DEPRECATED`), distinct de tout état d'exécution (celui-ci appartient à la Strategy Instance, Ticket 1.3).
- **Fichiers à ne pas modifier** : idem 1.1.
- **Tests** : deux Strategy Versions distinctes référençant la même Definition, validées, avec des statuts différents.
- **Critère de passage** : schéma existe et est validé.
- **Risques** : faible.
- **Rollback** : additif.
- **Statut** : `NOT_STARTED`.
- **Source** : idem, Ticket 1.2.

### Ticket 1.3 — Strategy Instance (schéma, deux axes distincts)
- **Dépend de** : 1.2. **Remplace explicitement l'ancienne recommandation « remplacer `ACTIVE_STRATEGY_RUNTIME_VERSIONS` par un ensemble »** (voir ADR-0001).
- **Fichiers concernés** : nouveau schéma, référence une Strategy Version (1.2), porte le scope compte/instrument/session/mode, et deux champs distincts, jamais fusionnés : état runtime (en cours, en pause, en erreur, retirée) ; mode d'exécution `SHADOW`/`PAPER`/`LIVE`.
- **Garde technique non négociable** : le mode ne peut passer à `LIVE` en présence d'une autre Strategy Instance déjà `LIVE` sur le même compte que si un drapeau explicite « triple verrou validé » (Portfolio Arbitration + Global Risk + Broker Netting Engine, Phase 7, hors périmètre de ce ticket) est positionné. Implémenter ce refus comme une garde de code active (ADR-0007).
- **Fichiers à ne pas modifier** : `strategy-runtime-versioning.js`.
- **Tests** :
  1. Deux Strategy Instances actives simultanément en mode `SHADOW`/`PAPER`, Versions différentes, sous le même Runtime Contract Bundle actif inchangé — preuve de l'orthogonalité avec ADR-0001.
  2. Tentative de passage d'une deuxième instance en mode `LIVE` sans le drapeau de triple verrou → rejet explicite, testé positivement.
- **Critère de passage** : les deux tests passent.
- **Risques** : c'est le ticket où une erreur de portée sur la garde technique aurait l'impact le plus élevé.
- **Rollback** : additif, flag.
- **Statut** : `NOT_STARTED`.
- **Source** : idem, Ticket 1.3 ; voir aussi ADR-0001, ADR-0002, ADR-0007.

### Ticket 1.4 — `trades.strategy_instance_id`, sans réinterprétation du `strategy_id` legacy
- **Dépend de** : 1.3.
- **Fichiers concernés** : migration additive sur `trades` (nouvelle colonne `strategy_instance_id`, FK nullable vers Strategy Instance).
- **Fichiers à ne pas modifier** : la colonne `strategy_id` existante reste inchangée, en lecture, jamais réécrite ni mappée automatiquement.
- **Contrainte non négociable** : aucun script de backfill ne doit tenter de déduire une `strategy_instance_id` à partir des valeurs historiques de `strategy_id`. Toutes les lignes existantes gardent `strategy_instance_id IS NULL` indéfiniment.
- **Tests à écrire avant changement** :
  1. Une ligne `trades` historique reste lisible, inchangée, avec `strategy_instance_id IS NULL` après la migration.
  2. Une nouvelle ligne créée avec une Strategy Instance valide porte `strategy_instance_id` renseigné, sans confusion entre les deux champs dans aucune requête existante.
- **Critère de passage** : les deux tests passent ; aucune requête existante lisant `strategy_id` n'est modifiée.
- **Risques** : la tentation d'un backfill « pratique » est le risque principal — explicitement interdit.
- **Rollback** : colonne additive, retrait trivial si nécessaire (préférer un flag désactivant son usage plutôt qu'un `DROP COLUMN`, discipline expand/migrate/contract, ADR-0019).
- **Statut** : `NOT_STARTED`.
- **Source** : idem, Ticket 1.4 ; voir aussi ADR-0004.

### Ticket 1.5 — Peupler `strategy_catalog`/`desk_strategy_versions`
- **Dépend de** : 1.4. **Parallélisable avec le Ticket 1.6** (`16` §3).
- **Fichiers concernés** : `front-operations-service.js` (lignes 1288-1341, **lecture seule, non modifiée**), nouveau chemin d'écriture.
- **Fichiers à ne pas modifier** : le code de lecture frontend existant ne doit nécessiter aucune modification.
- **Tests** : une Strategy créée via 1.1-1.4 apparaît dans ces tables et est lisible par le frontend existant sans modification de celui-ci.
- **Critère de passage** : le test passe.
- **Risques** : faible.
- **Rollback** : additif.
- **Statut** : `NOT_STARTED`.
- **Source** : idem, Ticket 1.5.

### Ticket 1.6 — Concurrence positionnelle paper/shadow uniquement (portée fortement restreinte)
- **Dépend de** : 1.4. **Parallélisable avec le Ticket 1.5** (`16` §3).
- **Correction de portée majeure, non négociable** : ce ticket ne touche **que** la comptabilité desk-side paper/shadow. Il ne rend **à aucun moment** le broker ou l'AddOn NinjaTrader conscients de plusieurs stratégies.
- **Fichiers concernés, et UNIQUEMENT ceux-ci** :
  - `live-paper-execution.js` (`max_simultaneous_positions: 1`, lignes 87-95) — adapté pour autoriser plusieurs Strategy Instances en `SHADOW`/`PAPER` sur le même instrument.
  - La vue d'allocation interne par stratégie (comptabilité virtuelle uniquement), s'appuyant sur `trades.strategy_instance_id` (Ticket 1.4), jamais transmise à `compareSnapshots`.
- **Fichiers explicitement exclus de ce ticket** — vérifiés sur le chemin réel `BROKER_SUBMIT` :
  - `packages/desk-domain/src/broker-execution.js` (`NO_DUPLICATE_POSITION`, lignes 439-442) — confirmé évalué en phase `BROKER_SUBMIT` réelle.
  - Le gate AddOn exigeant le broker flat avant toute entrée (`broker-execution-service.js`, ~862-865).
  - Les marks de gestion exigeant une correspondance de quantité exacte (`broker-execution-service.js`, ~826-833).
  - `CLOSEPOSITION` instrument-wide (`packages/desk-domain/src/broker-position-management.js`, lignes 333-337).
  - Ces quatre points restent strictement inchangés jusqu'à la livraison du Broker Netting Engine (Phase 7).
- **Fichiers à ne pas modifier** : `position-state-machine-v1.js` (consommée, pas altérée) ; les quatre points listés ci-dessus.
- **Tests à écrire avant changement** :
  1. Deux Strategy Instances en mode `PAPER`, même instrument, coexistent sans déclencher `max_simultaneous_positions: 1`.
  2. **Test négatif explicite** : une tentative de faire passer une des deux instances en mode `LIVE` alors qu'une autre est active sur le même compte échoue (garde du Ticket 1.3).
  3. Les quatre points exclus, testés en non-régression stricte (comportement identique à avant ce ticket, sur le chemin `BROKER_SUBMIT` réel).
  4. La vue d'allocation interne agrège correctement par `(compte, instrument, strategy_instance_id)`, distincte de l'agrégation pure par instrument du Ticket 0.4.
- **Critère de passage** : les 4 tests passent, en particulier le test négatif (2) et la non-régression des quatre points exclus (3).
- **Risques** : c'est le ticket où une erreur de portée aurait l'impact le plus grave (activation prématurée d'exécution réelle multi-stratégies non gouvernée) — la revue doit vérifier explicitement qu'aucun des quatre fichiers exclus n'apparaît dans le diff.
- **Rollback** : chaque changement derrière son propre flag, désactivable indépendamment.
- **Statut** : `NOT_STARTED`.
- **Source** : idem, Ticket 1.6 ; voir aussi ADR-0007.

### Ticket 1.7 — Cycle de vie minimal, trois axes
- **Dépend de** : 1.5 et 1.6.
- **Fichiers concernés** : état runtime et mode d'exécution portés par le schéma de 1.3 (déjà distincts), logique de transition `DRAFT → PAPER → ACTIVE → RETIRED` pour l'état runtime, indépendante du statut de la Strategy Version (1.2) et du mode d'exécution (1.3).
- **Rappel explicite** : le mode `LIVE` pour une Strategy Instance en concurrence avec une autre reste techniquement bloqué par la garde du Ticket 1.3, quel que soit l'état runtime atteint par ce ticket.
- **Tests** : chaque transition d'état runtime valide et invalide testée explicitement ; confirmation que l'état runtime `ACTIVE` n'implique jamais automatiquement le mode d'exécution `LIVE`.
- **Critère de passage** (vers la Phase 2, hors périmètre de ce document) : une Strategy Instance peut être créée en `DRAFT`, promue `PAPER`, sans qu'aucun ordre réel ne soit jamais soumis avant `ACTIVE` **et** avant que le triple verrou (Phase 7) ne soit validé pour le mode `LIVE` — vérifié par test, pas par relecture de code seule.
- **Risques** : faible, garde déjà posée par 1.3.
- **Rollback** : additif.
- **Statut** : `NOT_STARTED`.
- **Source** : idem, Ticket 1.7.

---

## 3. Commandes de build/test (héritées de `.github/workflows/local-ci.yml`)

**CIBLE REQUISE** : chaque ticket ci-dessus, avant d'être considéré `DONE`, doit passer la suite CI existante dans son intégralité, pas seulement ses propres tests nouveaux. La liste exacte des commandes CI est reprise verbatim de `.github/workflows/local-ci.yml` (lu en intégralité pendant l'audit) et doit être exécutée localement avant toute proposition de fusion — voir `18-TEST-AND-VALIDATION-STRATEGY.md` pour le détail complet de la stratégie de test.

## 4. Ce que ce backlog ne couvre délibérément pas

Aucun détail fichier pour : Data Foundation (Phase 2), Strategy DSL/Simulation Engine (Phase 3), Experiment Registry/Research Lab (Phase 4), Multi-Agent Runtime (Phase 5), Live Strategy Runtime (Phase 6), Portfolio Arbitration/Global Risk/Broker Netting (Phase 7), AI Context Gate (Phase 8), Execution Gateway/PickMyTrade (Phases 9-10), Cutover/Decommission (Phases 11-12). Ces chantiers restent au niveau architecture cible fixé dans `06`-`15` et `21`, jusqu'à ce que les Phases -1/0/1 soient livrées et qu'un nouveau point de passation soit produit sur cette base — cohérent avec l'instruction explicite reçue de ne pas préparer l'implémentation détaillée des phases lointaines.
