# 23 — Traceability and Completeness Matrix

- **Titre** : Matrice de traçabilité et de complétude
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : `traceability-matrix.yaml`, tous les documents `00`-`22`
- **Documents supersédés** : aucun
- **Dernière vérification code** : n/a — vérification de cohérence documentaire, pas un constat AS-IS
- **Portée** : ce document vérifie explicitement qu'aucune exigence de la North Star (`01`) n'est orpheline — chaque invariant et chaque critère de succès est rattaché à au moins un document, un ADR, ou un ticket qui le couvre. C'est le dernier document de contenu du dossier ; `00-MASTER-INDEX.md` reste le seul point d'entrée.

---

## 1. Méthode de vérification

Pour chaque invariant (INV-1 à INV-8) et chaque critère de succès (SC-1 à SC-10) de `01-NORTH-STAR-AND-SUCCESS-CRITERIA.md`, ce document vérifie qu'il existe au moins une entrée non vide dans `traceability-matrix.yaml`. Une exigence sans couverture est un défaut de ce dossier — aucune n'a été trouvée à la date de production de ce document (voir §4).

## 2. Invariants — couverture

| Invariant | Couvert par | Statut de couverture |
|---|---|---|
| INV-1 (pas de décision LLM synchrone sur capital réel) | ADR-0009, `04` §2, `10` §4, `12` §3 | ✅ Couvert |
| INV-2 (gates broker-facing actifs) | ADR-0016, `04` §4, Ticket 1.6 | ✅ Couvert |
| INV-3 (pas de migration destructrice) | ADR-0004, ADR-0019, Ticket 1.4 | ✅ Couvert |
| INV-4 (système opérable en continu) | ADR-0020, `21` | ✅ Couvert |
| INV-5 (feature flag + décision opérateur pour nouvelle capacité réelle) | ADR-0007, ADR-0018, `phase-gates.yaml` | ✅ Couvert |
| INV-6 (aucun accès non autorisé aux secrets/prod) | `15` §1, `22` | ✅ Couvert |
| INV-7 (`ACTIVE_STRATEGY_RUNTIME_VERSIONS` singulier) | ADR-0001, `05` §9, Tickets 1.1-1.3 | ✅ Couvert |
| INV-8 (agrégation de position prouvée par test) | ADR-0003, ADR-0005, Tickets 0.4-0.5 | ✅ Couvert |

## 3. Critères de succès — couverture

| Critère | Couvert par | Statut de couverture |
|---|---|---|
| SC-1 (100% des ordres via `evaluateBrokerPolicy`) | `13` §2.1 | ✅ Couvert |
| SC-2 (catalogue de conditions source unique) | `04` §4 | ✅ Couvert |
| SC-3 (reproductibilité bit-à-bit simulation) | ADR-0006, ADR-0010, ADR-0022, ADR-0023, `08` §2.5 | ✅ Couvert |
| SC-4 (SHADOW→PAPER→LIVE obligatoire) | ADR-0002, `05` §2.3 | ✅ Couvert |
| SC-5 (Portfolio Arbitration bloquant) | ADR-0008, `11` §7 | ✅ Couvert |
| SC-6 (AI Context Gate advisory-only) | ADR-0009, `12` §3-4 | ✅ Couvert |
| SC-7 (traçabilité causale complète) | ADR-0012, `14` §3 | ✅ Couvert |
| SC-8 (coupure GPT-first sans perte, rollback testé) | ADR-0020, `21` | ✅ Couvert |
| SC-9 (réduction de coût mesurée par migration) | ADR-0013, ADR-0014, `09` §3 | ✅ Couvert |
| SC-10 (pas de régression sur les gates existants) | `04` §4, `18` (suite de non-régression) | ✅ Couvert |

## 4. Résultat de la vérification de complétude

**Aucune exigence orpheline trouvée.** Les 8 invariants et les 10 critères de succès de `01` ont chacun au moins une couverture documentée. Ce résultat est vérifiable mécaniquement via `traceability-matrix.yaml` (champ `covered_by` non vide pour chaque entrée).

## 5. Couverture des points de l'addendum et de l'errata de sûreté déjà validés

Vérification croisée que chacun des 10 points de l'addendum de passation et des 11 points de l'errata de sûreté (base de travail déjà validée par l'opérateur avant ce dossier) est repris quelque part dans le dossier canonique — pas seulement archivé dans `docs/audit-2026-08-07/`.

| Point source | Repris dans |
|---|---|
| Addendum §1 — nature de `ACTIVE_STRATEGY_RUNTIME_VERSIONS` | ADR-0001, `05` §2.1, §9 |
| Addendum §2 — Phase -1 baseline | `16` §1, `17` Phase -1 |
| Addendum §3 — révision du ticket Map | ADR-0003, `17` Ticket 0.4 |
| Addendum §4 — définition `PROTECTION_CONFIRMED` | `17` Ticket 0.3 |
| Addendum §5 — Run Registry dans Simulation Engine | ADR-0023, `08` §2.5 |
| Addendum §6 — chantier Live Strategy Runtime | `10` (document complet) |
| Addendum §7 — LLM migration chantier, 3 pipelines | ADR-0013, `09` (document complet) |
| Addendum §8 — Portfolio Arbitration/Global Risk avant multi-stratégie réelle | ADR-0008, `11` (document complet) |
| Addendum §9 — chantier Data Acquisition | ADR-0022, `06` (document complet) |
| Addendum §10 — livrables manquants (risk register, ADR, dépendances, DoR/DoD, etc.) | `20`, `19`, `16` §2-§7 |
| Errata point 1 — séquencement Map avant réconciliation | ADR-0005 |
| Errata point 2 — pas de backfill `strategy_instance_id` | ADR-0004 |
| Errata point 3 — restriction du ticket de concurrence positionnelle | `17` Ticket 1.6, fichiers exclus explicites |
| Errata point 4 — trois axes (statut Version / état runtime / mode d'exécution) | ADR-0002, `05` §2.2-2.3 |
| Errata point 5 — agrégation par quantités signées, horodatage explicite | `17` Ticket 0.4 |
| Errata point 6 — définition stricte de `PROTECTION_CONFIRMED` | `17` Ticket 0.3 |
| Errata point 7 — versionning obligatoire `atr_14`/hash | `17` Ticket 0.6 |
| Errata point 8-11 — décisions opérateur, ordre des tickets, documents à ne pas toucher, garde technique LIVE | `operator-decisions.yaml`, `17` §2, ADR-0007 |

**Aucun point source non repris trouvé.**

## 6. Couverture des exigences structurelles du prompt maître

| Exigence du prompt maître | Statut | Emplacement |
|---|---|---|
| Dossier canonique avec 23 documents numérotés | ✅ | `docs/trading-desk-target-blueprint/` |
| 4 fichiers YAML machine-readable | ✅ | `implementation-backlog.yaml`, `phase-gates.yaml`, `operator-decisions.yaml`, `traceability-matrix.yaml` |
| Sous-dossier `adr/` avec ADR détaillés | ✅ | 25 fichiers, `adr/0001`-`0025` |
| 25 ADR mandatés | ✅ | `19-ARCHITECTURE-DECISION-RECORDS.md` + `adr/` |
| 32 entités avec state machines | ✅ | `05-DOMAIN-MODEL-AND-STATE-MACHINES.md` §8 |
| Roadmap 13 phases (Phase -1 à Phase 12) | ✅ | `16-END-TO-END-MIGRATION-ROADMAP.md` (14 phases en comptant -1) |
| Ticket template mandaté | ✅ | `17-EXECUTABLE-BACKLOG.md` §0 |
| Rapport de mission final | En cours | `docs/audit-2026-08-07/` + ce dossier — synthèse finale à produire séparément du présent document, voir tâche de clôture |
| Sous-dossiers `contracts/`, `examples/`, `diagrams/`, `backlog/` | Créés, contenu partiel | Voir `18-TEST-AND-VALIDATION-STRATEGY.md` pour les exemples de contrats JSON et diagrammes ; `backlog/` reste réservé pour un futur export détaillé si nécessaire |

## 7. Limites connues de ce dossier, déclarées explicitement

- Les documents de domaine (`06`-`15`) décrivent une architecture cible et des critères de sortie, mais ne fournissent pas de détail fichier/fonction au-delà des Phases -1/0/1, conformément à l'instruction explicite reçue — ce n'est pas un oubli, c'est une contrainte de portée respectée.
- Plusieurs décisions opérateur (`operator-decisions.yaml`) restent `open` à la date de ce document — c'est attendu et documenté, pas un défaut de complétude du dossier lui-même.
- Le rapport final de mission (section 22 du prompt maître) est un document séparé, produit à l'issue de ce dossier — voir la synthèse de clôture communiquée directement à l'opérateur.

## 8. Comment maintenir cette matrice à jour

**RECOMMANDATION D'ARCHITECTURE** : à chaque nouvelle exigence ajoutée à `01` (North Star) ou à chaque nouvel ADR, cette matrice et `traceability-matrix.yaml` doivent être mis à jour dans le même changement — jamais après coup, pour éviter exactement la dérive que ce document a pour rôle de détecter.
