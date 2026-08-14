# Addendum de passation — corrections et compléments avant intervention Codex

**Version 2 — intègre l'errata de sûreté du 2026-08-07.** Ce document
s'appuie exclusivement sur les constats déjà établis dans
`00-INDEX-ET-METHODE.md`, `01-CARTOGRAPHIE-ET-FLUX.md`,
`02-REPONSES-SECTION-31.md` et `03-PLAN-EVOLUTION.md`, plus onze corrections
de sûreté reçues après la version 1 de cet addendum, intégrées ici
directement. Deux points ont fait l'objet d'une vérification ciblée propre à
cette version : la confirmation que `NO_DUPLICATE_POSITION`
(`packages/desk-domain/src/broker-execution.js:439-442`) est bien évalué en
phase `BROKER_SUBMIT`, aux côtés de `BRIDGE_HEALTHY`/`BRIDGE_CONNECTED` —
c'est-à-dire sur le chemin réel de soumission au broker, pas un chemin
paper — ce qui fonde la correction du point 3 de l'errata. Le reste de
cette version s'appuie sur les constats déjà établis, recomposés selon les
corrections reçues.

Toujours aucune modification de code fonctionnel. Lecture seule.

---

## 1. Nature exacte d'`ACTIVE_STRATEGY_RUNTIME_VERSIONS` — correction d'une conclusion précédente

**Vérification ciblée (version 1)** : lecture complète de
`mcp_gpt_desk/src/strategy-runtime-versioning.js:3-14`.

```js
export const ACTIVE_STRATEGY_RUNTIME_VERSIONS = Object.freeze({
  strategy_version: "autopilot_v5",
  autopilot_version: "5.4.0",
  master_contract: "5.4.0",
  monitor_contract: "2.4.0",
  execution_policy: "4.3.0",
  execution_plan: "1.4.0",
  monitor_command: "1.4.0",
  condition_catalog: "1.2.0",
  deterministic_compiler: "1.4.0",
  condition_engine: "1.2.0",
});
```

**Conclusion, CONFIRMÉ sans ambiguïté** : c'est un **Runtime Contract
Bundle**, pas une stratégie métier. Les 10 champs désignent tous une
version de schéma, de moteur ou de contrat — aucun ne porte d'information
métier. Le champ nommé `strategy_version` est trompeur : sa valeur
`"autopilot_v5"` est un nom de génération produit/moteur, pas l'identifiant
d'une stratégie de trading.

**Recommandation, inchangée** : le garder singulier et strict. Le
déverrouillage multi-stratégies ne suppose pas de le toucher — il suppose
de construire les entités absentes ci-dessous.

### Modèle en quatre entités séparées

| Entité | Existe aujourd'hui ? | Rôle |
|---|---|---|
| **Runtime Contract Bundle** | **Oui** — `ACTIVE_STRATEGY_RUNTIME_VERSIONS`. Reste singulier. | Garantit que tout payload est validé contre la même génération de schémas/moteur à un instant donné. Axe technique. |
| **Strategy Definition** | **Non, absent.** | Identité stable d'une idée de trading : famille/pattern, portée instrument, philosophie d'entrée/sortie. |
| **Strategy Version** | **Non, absent.** | Révision paramétrée d'une Strategy Definition. **Porte un statut propre (§4 ci-dessous), distinct de l'état d'exécution d'une instance.** |
| **Strategy Instance** | **Partiellement — analogue le plus proche : `desk_replay_autopilot_configs` (mono-bras) + la clé de session `strategyId`.** | Déploiement d'une Strategy Version, scopé compte/instrument/session/mode. **Porte un état runtime ET un mode d'exécution SHADOW/PAPER/LIVE, deux dimensions distinctes (§4).** |

### Correction — `trades.strategy_id` n'est pas une identité canonique (errata point 2)

Le champ `trades.strategy_id` (`infra/postgres/init/003_trade_automation_schema.sql:336`),
utilisé dans le reste de ce document jusqu'à sa version 1, **n'est pas et
n'a jamais été une identité canonique de stratégie**. C'est une **clé
legacy de session/lane** (`asia_open`, `ny_open_1530`) — un partitionnement
horaire, pas un registre de stratégies.

**Conséquence directe et non négociable** : une nouvelle colonne
`trades.strategy_instance_id` (FK vers la future Strategy Instance) doit
être introduite **sans réinterprétation automatique des valeurs
historiques de `strategy_id`**. Aucune tentative de mapper
`asia_open`/`ny_open_1530` vers une Strategy Instance nouvellement créée ne
doit avoir lieu — ce serait encoder rétroactivement une intention qui
n'existait pas au moment où ces lignes ont été écrites. Les lignes
historiques gardent `strategy_instance_id IS NULL` indéfiniment ;
`strategy_id` reste lisible tel quel comme champ legacy, jamais fusionné
avec la nouvelle colonne.

---

## 2. Phase -1 — Baseline et tests de caractérisation

Inchangée sur le fond par rapport à la version 1, avec une précision ajoutée
par l'errata point 5 : les snapshots capturés par le test de caractérisation
du parcours fill → protection → clôture (Épic -1.C) doivent être
**horodatés explicitement**, pour servir de référence à la politique de
cohérence temporelle exigée à la Phase 0 révisée (§3 ci-dessous).

### Épic -1.A — Capture de l'état exact au jour J

- **Tag Git**, sur le commit socle exact, au moment T0 réel.
- **État des services** — capturé au moment T0, jamais déduit des documents
  (l'état du cutover du 2026-08-01 et celui observé le 2026-08-06 divergent
  déjà entre eux).
- **Versions et hashes des contrats actifs** — lever l'ambiguïté 5.4.0 vs
  5.1.0 en interrogeant `get_active_contracts` sur l'environnement cible.
- **Snapshot du schéma** — `pg_dump --schema-only`.
- **Résultats des tests** — suite complète déjà identifiée dans
  `.github/workflows/local-ci.yml` :
  ```
  npm ci
  npm run typecheck
  npm run build
  npm run test:react
  npm --prefix packages/desk-contracts run check:generated
  npm run guard:strategy-contracts
  npm run guard:windows-deployment
  node scripts/quality/check_contracts_finalization.mjs
  npm --prefix packages/desk-domain run coverage:gate
  npm --prefix packages/desk-replay-engine test
  npm --prefix packages/desk-audit test
  npm --prefix packages/desk-time test
  npm --prefix mcp_gpt_desk ci
  npm --prefix mcp_gpt_desk run audit:backend-cleanup
  npm --prefix mcp_gpt_desk test
  docker compose config --quiet
  ```

### Épic -1.B — Fixtures représentatives

Deux sessions (`asia_open`, `ny_open_1530`), positions ouvertes par
session, au moins un `trade` avec `strategy_id` legacy renseigné (pour
prouver que le comportement historique reste lisible sans réinterprétation
— voir §1), et un cas `POSITION_QUANTITY_MISMATCH` déjà connu.

### Épic -1.C — Tests de caractérisation de bout en bout

Sans déclencher de vrai appel Codex CLI ni de vrai ordre broker (LLM et
transport NinjaTrader stubés) :

- **Parcours claim → compilation → M1 → OrderIntent** — référence de
  non-régression pour tout ticket touchant `desk-ai-worker-service.js`,
  `deterministic-compiler-entry-v1.js`, `live-paper-execution.js`.
- **Parcours fill → protection → clôture** — caractérise le comportement
  **actuel**, défaut compris. **Capturer un horodatage explicite à chaque
  étape du snapshot** (errata point 5) — cette précision devient la
  référence temporelle du fix de réconciliation en §3.

---

## 3. Ticket de collision `Map` — révisé (errata points 1, 2, 5)

**Vérification ciblée (version 1 et 2)** : lecture de `compareSnapshots`,
de son appelant `reconcile()`, et confirmation (cette version) que
`NO_DUPLICATE_POSITION` siège sur le chemin réel de soumission broker.

### Ce que le code fait réellement

```js
function compareSnapshots(desk, broker) {
  ...
  const deskPositions = new Map((desk.trades || []).map((item) => [
    positionKey(item.broker_symbol || item.instrument_code),
    { quantity: Number(item.quantity_open || 0), side: ... },
  ]));
  ...
}
```

`desk.trades` peut légitimement contenir plusieurs lignes sur le même
instrument ; `deskPositions` clé par instrument seul écrase silencieusement
toutes les lignes sauf la dernière → faux `POSITION_QUANTITY_MISMATCH`.

### Correction de séquencement (errata point 1) — précède toute réconciliation périodique

**Le fix de `compareSnapshots` doit être livré et validé avant que la
réconciliation périodique (ancien Ticket 0.4) ne soit activée.** Activer un
déclenchement périodique alors que `compareSnapshots` écrase encore
silencieusement les positions desk par instrument transformerait un bug
latent en verrouillage de compte périodique et automatique — une
dégradation du service, pas une amélioration de la sûreté. Ce ticket
(désormais numéroté 0.4 dans le handoff, voir `05-CODEX-HANDOFF.md`) doit
donc précéder le déclenchement périodique (désormais 0.5), et ce dernier
reste explicitement bloqué tant que celui-ci n'est pas terminé.

### Correction de portée (errata point 2) — la fonction n'a pas besoin d'attribution par stratégie

Puisque `trades.strategy_id` n'est pas une identité canonique (§1) et que
`trades.strategy_instance_id` n'existera qu'après la Phase 1, **la
correction de `compareSnapshots` elle-même ne dépend d'aucune des deux**.
Son unique rôle est de comparer la position **consolidée** du desk (toutes
lignes ouvertes sur un instrument donné, quelle que soit leur attribution)
à la position nette réelle du broker — une opération d'agrégation pure, pas
un chemin nécessitant l'identité de stratégie.

La **vue d'allocation interne par stratégie** (comptabilité virtuelle,
distincte de la comparaison broker) est donc **explicitement déportée en
Phase 1**, une fois `trades.strategy_instance_id` disponible (voir
`05-CODEX-HANDOFF.md`, Ticket 1.4 puis 1.6).

### Correction technique (errata point 5) — agrégation signée, snapshots horodatés, cohérence temporelle

1. **Quantités signées** : agréger en sommant des quantités **signées**
   (LONG positif, SHORT négatif), pas une quantité non signée accompagnée
   d'un champ `side` séparé — évite les erreurs de signe lors de
   l'agrégation et permet de détecter algébriquement une configuration
   opposée qui aurait dû être rejetée (voir l'ADR ci-dessous).
2. **Snapshots horodatés** : le snapshot desk et le snapshot broker comparés
   doivent porter un horodatage explicite ; ne jamais comparer un snapshot
   desk périmé à un snapshot broker frais ou l'inverse.
3. **Politique de cohérence temporelle** : durant une fenêtre de tolérance
   courte autour d'un fill ou d'une clôture en cours (l'écriture desk et la
   confirmation broker n'arrivent jamais exactement au même instant), un
   écart transitoire ne doit pas être immédiatement traité comme un
   `POSITION_QUANTITY_MISMATCH` dur — appliquer une fenêtre de grâce bornée
   avant classification en divergence réelle.

### Six concepts distincts

| Concept | État | Où |
|---|---|---|
| **Compte** | **CONFIRMÉ, déjà correct** — scope de `reconciliationSnapshot(accountId)` | `broker-execution-service.js:663` |
| **Instrument** | **CONFIRMÉ, déjà correct** — `positionKey()` | `broker-execution-service.js` |
| **Identifiant natif broker** | **CONFIRMÉ, déjà correct** — `broker_symbol`/`instrument_code` | idem |
| **Position broker consolidée (nettée)** | **CONFIRMÉ, déjà correct** — une seule ligne par instrument, réalité du broker | construction de `brokerPositions` |
| **Allocation interne (par stratégie)** | **ABSENT, déporté en Phase 1** (voir ci-dessus) | à construire une fois `strategy_instance_id` disponible |
| **Position virtuelle de stratégie** | **ABSENT, déporté en Phase 1** | idem |

### ADR — positions opposées inter-stratégies (inchangé, toujours ouvert)

Deux stratégies avec des positions de sens opposé sur le même instrument :
le broker ne peut représenter qu'une position nette unique.
**Recommandation maintenue : rejet explicite, pas de nettage silencieux**,
tant que le Broker Netting Engine (§7, nouvelle dénomination) n'existe pas.

### Tests requis (mis à jour)

1. Deux `trades` ouverts, même compte/instrument, `strategy_id` legacy
   différents (**pas** `strategy_instance_id`, absent à ce stade), même
   sens → somme signée correcte, pas de faux mismatch.
2. Sens opposés → rejet explicite conforme à l'ADR ci-dessus.
3. Concurrence d'écriture (clôture d'une ligne pendant l'ouverture d'une
   autre sur le même instrument) — dans la fenêtre de tolérance temporelle
   du point 3 ci-dessus.
4. Instrument connu du broker, absent de `desk.trades` — non-régression.
5. Invariant continu : quantité signée consolidée desk = somme signée des
   `quantity_open` ouverts sur `(compte, instrument)`, à tout instant en
   dehors de la fenêtre de tolérance.
6. **Nouveau (errata point 5)** : un fill confirmé côté broker mais pas
   encore écrit côté desk (ou l'inverse), à l'intérieur de la fenêtre de
   tolérance, ne déclenche pas de mismatch dur.

---

## 4. Confirmation `PROTECTION_CONFIRMED` (errata point 6)

**Définition corrigée, non négociable** : `PROTECTION_CONFIRMED` signifie
qu'un ordre protecteur a été **accepté côté broker et observé dans un état
valide** — c'est-à-dire une lecture positive de l'état réel de l'ordre chez
le broker (via l'AddOn, qui a déjà accès aux objets `Order` natifs de
NinjaTrader), pas une inférence.

**L'enregistrement local d'un prix de stop ne constitue en aucun cas une
confirmation.** C'est exactement le défaut actuel de
`persistEntryFillAndTrade()` (`mcp_gpt_desk/src/broker-execution-repository.js:1010-1055`,
qui écrit `status='open'` inconditionnellement et stocke le prix **voulu**,
jamais confirmé). Le Ticket correspondant (`05-CODEX-HANDOFF.md`, Ticket
0.3) doit vérifier une lecture positive de l'état broker, pas seulement
la présence d'une valeur en base desk.

---

## 5. Run Registry minimal — déplacé dans le chantier Simulation Engine (Phase 2)

Inchangé par rapport à la version 1. Dès le Ticket 2.3 (simulateur
événementiel), aucun run de backtest sans : `run_id`, `dataset_id`,
`strategy_version_id`, version du moteur, paramètres, seed, hash des
résultats (sur le modèle de `content_hash` déjà éprouvé dans
`packages/desk-replay-engine/src/outcome-engine.js`).

---

## 6. Nouveau chantier — Live Strategy Runtime

Inchangé sur le fond par rapport à la version 1 : permet à plusieurs
Strategy Specifications validées de consommer les données live, calculer
leurs features, maintenir leur état, produire des signaux standardisés,
fonctionner en shadow, partager les mêmes primitives que le backtest.

**Rappel explicite issu de l'errata point 3** : ce chantier, comme toute la
Phase 1, opère en **SHADOW ou PAPER uniquement**. Il ne rend à aucun moment
le broker ou l'AddOn NinjaTrader « strategy-aware » — voir §7.

---

## 7. Portfolio Arbitration Engine, Global Risk Engine, **et Broker Netting Engine** — trois verrous distincts avant toute exécution réelle multi-stratégies

**Correction de nommage et de portée (errata point 3)** : la version 1 de
cet addendum mentionnait le « netting broker » comme une simple ligne à
l'intérieur du Portfolio Arbitration Engine. L'errata le sépare en un
**troisième composant nommé, le Broker Netting Engine**, aux côtés du
Portfolio Arbitration Engine et du Global Risk Engine. Les trois doivent
être livrés avant que le broker ou l'AddOn ne deviennent conscients de
plusieurs stratégies simultanées.

**Ce que cela signifie concrètement pour la Phase 1** : les Strategy
Instances multiples autorisées par la Phase 1 (§1) restent, sans
exception, en mode **SHADOW ou PAPER**. Les positions réelles restent
consolidées **par compte et par instrument seulement** — exactement le
comportement actuel — jusqu'à ce que les trois composants ci-dessous soient
livrés. Le mode **LIVE reste techniquement impossible pour une deuxième
Strategy Instance simultanée** avant validation de ce triple verrou (voir
§8, cycle de vie révisé).

**Composants requis avant le verrou peut être levé** :

- **Portfolio Arbitration Engine** : exposition consolidée inter-stratégies,
  corrélation entre instruments (MNQ/MES/ES), résolution de conflits
  (même instrument même direction / directions opposées).
- **Global Risk Engine** : drawdown global glissant (absent aujourd'hui —
  seule une perte journalière existe), trailing drawdown (absent), max
  trades par jour (absent), budget de risque portefeuille agrégé.
- **Broker Netting Engine** (nouveau, nommé explicitement) : position
  broker réelle unique par compte/instrument, comptabilité interne exacte
  par Strategy Instance (portefeuille virtuel — la vue d'allocation interne
  déportée en §3), politique de netting pour positions opposées
  inter-stratégies (résout l'ADR de §3), et — seulement à ce stade — les
  quatre points réels du câblage mono-position identifiés dans l'audit
  initial et **explicitement exclus de la Phase 1** (voir §8) :
  `NO_DUPLICATE_POSITION` (`broker-execution.js:439-442`, confirmé sur le
  chemin réel `BROKER_SUBMIT`), le gate AddOn « flat obligatoire », la
  correspondance de quantité exacte des marks de gestion, `CLOSEPOSITION`
  instrument-wide.

---

## 8. Cycle de vie — trois axes séparés (errata point 4)

**Correction de modélisation, non négociable** : le statut de la Strategy
Version, l'état runtime de la Strategy Instance, et le mode d'exécution
SHADOW/PAPER/LIVE sont **trois dimensions indépendantes**, jamais
fusionnées dans un seul champ de statut.

| Axe | Exemples de valeurs | Porté par |
|---|---|---|
| **Statut de la Strategy Version** | `DRAFT`, `VALIDATED`, `DEPRECATED` | Strategy Version (§1) |
| **État runtime de la Strategy Instance** | en cours, en pause, en erreur, retirée | Strategy Instance (§1) |
| **Mode d'exécution** | `SHADOW`, `PAPER`, `LIVE` | Strategy Instance (§1), séparé de l'état runtime |

**Contrainte technique non négociable** : une Strategy Instance ne peut
passer en mode `LIVE` en présence d'au moins une autre Strategy Instance
déjà `LIVE` sur le même compte **que si** le triple verrou du §7 (Portfolio
Arbitration + Global Risk + Broker Netting Engine) est explicitement
validé. Ce n'est pas une intention documentée seulement — le Ticket 1.7 du
handoff (cycle de vie) doit implémenter cette contrainte comme une garde
technique (refus explicite, pas une simple absence de développement),
pour qu'un déploiement accéléré ou une erreur opérateur ne puisse pas
contourner le verrou par omission.

---

## 9. Nouveau chantier — Migration explicite du rôle du LLM

Inchangé par rapport à la version 1. Trois pipelines (GPT actuel /
déterministe sans IA / déterministe avec AI Context Gate), métriques de
valeur ajoutée réelle (delta de performance, taux d'accord, coût token par
décision utile, latence ajoutée, taux d'échec Codex CLI) à instrumenter
avant toute décision de retrait du LLM.

---

## 10. Nouveau chantier — Data Acquisition and Provenance

Inchangé par rapport à la version 1 (historique pluriannuel, contrats
futures individuels, rollovers, sources, licences, qualité, versionnement,
données brutes immuables, critères de promotion — voir la version 1 pour
le détail complet, non reproduit ici faute de changement).

---

## 11. Correction — sémantique `atr_14` et hash des packs (errata point 7)

**Correction, non négociable** : la sémantique de `atr_14` et l'algorithme
de hachage des packs **ne doivent pas être modifiés sous une même version
contractuelle**. Toute nouvelle sémantique (un vrai calcul d'ATR, une
extension du périmètre haché à macro/news) doit être introduite sous une
**nouvelle version** de contrat/schéma, exactement sur le modèle déjà
appliqué à `DeskMasterAnalysisContract`/`DeskConditionCatalogContract` etc.
(historique versionné, hash-locké, jamais réécrit). Les artefacts déjà
produits sous l'ancienne sémantique restent **immuables** et lisibles tels
quels — aucune migration rétroactive de leur contenu.

Ceci s'applique au Ticket 0.6 (`05-CODEX-HANDOFF.md`) : soit une nouvelle
clé versionnée est introduite à côté de `atr_14` (pas un renommage in
place), soit une nouvelle version de schéma de feature est créée qui
redéfinit `atr_14` — jamais une redéfinition silencieuse dans la version
actuelle.

---

## 12. Livrables manquants (mise à jour)

### 12.1 Registre des risques (extrait, mis à jour)

| Risque | Probabilité | Impact | Mitigation | Statut |
|---|---|---|---|---|
| Capture de données arrêtée depuis le 2026-07-31 | Certain | Élevé | Ticket 0.1/0.2 | Ouvert |
| Enregistrement local d'un stop pris pour une confirmation de protection | Élevée si non corrigé selon §4 | Élevé (perte non bornée) | Ticket 0.3, définition corrigée §4 | Ouvert |
| Réconciliation activée avant correction du bug `Map` | **Éliminé par le reséquencement §3** | Aurait été élevé (verrouillages périodiques automatiques) | Ticket 0.4 précède 0.5 | Résolu par reséquencement |
| Bug `Map` d'auto-verrouillage multi-positions | Certain dès 2ᵉ ligne sur même instrument | Élevé | Ticket 0.4 révisé (§3), agrégation signée | Ouvert |
| Réinterprétation automatique erronée de `strategy_id` legacy | **Éliminé** — explicitement interdit §1 | Aurait été élevé (fausse attribution historique) | Nouvelle colonne `strategy_instance_id`, sans backfill | Résolu par la contrainte |
| Phase 1 rendant par erreur le broker/AddOn strategy-aware prématurément | **Éliminé par la portée corrigée** §6-§8 | Aurait été critique (exécution réelle multi-stratégies non gouvernée) | Scope de Ticket 1.6 limité au paper ; garde technique sur le mode LIVE (§8) | Résolu par la contrainte |
| Confusion Runtime Contract Bundle / Strategy Version | Déjà réalisée dans le plan précédent | Élevé si non corrigée | Corrigé §1 | Corrigé en doc |
| Ambiguïté de version de contrat active | Certaine | Moyen | Ticket -1.1 | Ouvert |
| Historique de données insuffisant | Certain | Élevé | Chantier Data Acquisition | Ouvert |
| Redéfinition silencieuse de `atr_14`/hash de packs sous la même version | **Éliminé par la contrainte** §11 | Aurait été élevé (artefacts existants faussement réinterprétés) | Nouvelle version de contrat obligatoire | Résolu par la contrainte |

### 12.2 Architecture Decision Records — mise à jour

- **ADR-01** : politique de netting pour positions opposées inter-stratégies
  — **recommandation maintenue** : rejet explicite jusqu'au Broker Netting
  Engine (§7).
- **ADR-02** : format de la Strategy Specification — **résolu par l'errata
  point 9** : pas une alternative DSL vs JSON Schema, mais une **DSL
  déclarative sérialisée en JSON et validée par JSON Schema** (JSON Schema
  est un mécanisme de validation, pas un langage de stratégie en soi).
  Décision opérateur restante : la portée exacte du vocabulaire de la DSL,
  pas le choix du mécanisme.
- **ADR-03** : bus de messages — **précisé par l'errata point 10** :
  PostgreSQL reste suffisant à ce stade, mais **la source durable est la
  table de tâches/outbox** (`desk_documents`, `broker_execution_outbox`,
  etc.) — `LISTEN`/`NOTIFY` n'est qu'un mécanisme de réveil, jamais la
  source d'état. Tout travail futur sur l'Event Envelope (Phase 4) doit
  respecter ce principe explicitement.
- **ADR-04** : portée exacte de l'AI Context Gate.
- **ADR-05** : seuil minimal de profondeur de données out-of-sample avant
  promotion live — décision opérateur.
- **ADR-06** : mode d'authentification Codex CLI en production.
- **ADR-07 (nouveau, errata point 8)** : **source canonique de la
  sémantique entre le moteur live JavaScript et le futur simulateur
  Python.** Tant que cet ADR n'est pas tranché, adopter par défaut : le
  moteur JavaScript (`packages/desk-domain`, déjà testé et en production)
  est la référence canonique ; toute feature portée en Python doit produire
  des valeurs identiques (Ticket 2.2 déjà formulé ainsi dans
  `03-PLAN-EVOLUTION.md`) ; et surtout — **toute stratégie candidate doit
  être validée par le moteur canonique avant promotion**, quel que soit le
  moteur ayant produit le résultat prometteur initial. Cette règle
  s'applique dès que la Phase 2 (Simulation Engine) et la Phase 3
  (Experiment Registry) existeront — à consigner maintenant pour ne pas
  être découverte tardivement.

### 12.3 Stratégie de migrations, feature flags, rollback — corrigée (errata point 11)

**Correction, non négociable** : les migrations de schéma suivent la
discipline **expand / migrate / contract** — ajout additif d'abord
(nouvelles colonnes/tables, ex. `trades.strategy_instance_id` en §1),
migration progressive du code et des données pour les consommer, puis
seulement bien plus tard, une fois plus rien n'en dépend, retrait des
anciennes structures (« contract »).

**Le rollback opérationnel repose en premier lieu sur les feature flags et
le retour à l'ancienne version du code — pas sur des migrations `DOWN`
destructives.** Une migration `DOWN` qui supprime une colonne ou une table
fraîchement ajoutée est un dernier recours, jamais le mécanisme de premier
niveau. Chaque ticket introduisant une nouvelle capacité (Strategy
Definition/Version/Instance, `strategy_instance_id`, agrégation signée de
`compareSnapshots`, etc.) doit être livré derrière un flag désactivable
individuellement — le retour arrière normal est de désactiver le flag et de
redéployer le code précédent, pas d'exécuter une migration inverse sur la
base de production.

---

*Ce document se poursuit dans `05-CODEX-HANDOFF.md` (version 2), limité aux
Phases -1, 0 et 1, avec l'ordre exact des premiers tickets révisé selon
l'errata.*
