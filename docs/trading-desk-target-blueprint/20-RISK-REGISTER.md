# 20 — Risk Register

- **Titre** : Registre de risques consolidé
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : `docs/audit-2026-08-07/04-ADDENDUM-PASSATION.md` §12, tous les ADR, `02` §10
- **Documents supersédés** : le registre de risques de l'addendum de passation (contenu repris et étendu ici)
- **Dernière vérification code** : voir chaque risque, colonne « Preuve »
- **Portée** : registre vivant, à mettre à jour au fil de l'implémentation. Chaque risque référence l'ADR ou le ticket qui le mitige.

---

## 1. Méthode

Chaque risque est noté `Probabilité × Impact` sur une échelle Faible/Moyen/Élevé, avec une mitigation explicite et un propriétaire de suivi (le ticket ou l'ADR qui en a la charge). Un risque sans mitigation identifiée est marqué `MITIGATION MANQUANTE` explicitement plutôt que silencieusement omis.

## 2. Risques de sûreté d'exécution (les plus critiques)

| ID | Risque | Probabilité | Impact | Mitigation | Propriétaire |
|---|---|---|---|---|---|
| R-01 | Activer la réconciliation périodique avant la correction de l'agrégation de position transforme un bug latent en verrouillages automatiques de compte | Élevée si non séquencé | Élevé | Séquencement bloquant strict (0.4 avant 0.5) | ADR-0005, Ticket 0.5 |
| R-02 | Une promotion PAPER→LIVE automatique basée sur un seuil de performance active du capital réel sans validation humaine | Moyenne si garde non implémentée en dur | Élevé | Garde technique de code, pas seulement procédurale, avec test négatif obligatoire | ADR-0007 |
| R-03 | Le Ticket de concurrence positionnelle (1.6) touche par erreur un des 4 fichiers broker-facing réels, activant une exécution multi-stratégie non gouvernée | Faible si revue stricte du diff | Élevé | Liste explicite de fichiers exclus, revue systématique du diff | Ticket 1.6, `17` |
| R-04 | Backfill de `strategy_instance_id` à partir de `strategy_id` legacy corrompt silencieusement l'historique de données | Faible si interdiction respectée | Moyen-Élevé (intégrité des données historiques) | Interdiction explicite du backfill, point de vigilance en revue | ADR-0004, Ticket 1.4 |
| R-05 | Deux Strategy Instances LIVE, chacune conforme individuellement, dépassent collectivement une limite de risque de portefeuille | Élevée sans Portfolio Arbitration | Élevé | Verrou architectural bloquant avant Phase 7 `PASSED` | ADR-0008 |
| R-06 | L'AI Context Gate dérive vers un rôle décisionnel de facto au fil du temps (extension progressive non gouvernée) | Moyenne sur le long terme | Élevé | Garde structurelle (aucun chemin de code vers `Order Intent`), test d'intégration dédié, décision opérateur requise pour tout renforcement | ADR-0009, `12` §4 |

## 3. Risques de reproductibilité et de qualité de recherche

| ID | Risque | Probabilité | Impact | Mitigation | Propriétaire |
|---|---|---|---|---|---|
| R-07 | Le Simulation Engine diverge silencieusement du moteur d'exécution réelle (simulation-live parity gap) | Moyenne si un second moteur est introduit | Élevé (invalide toute validation de stratégie) | Un seul Canonical Runtime partagé, jamais dupliqué | ADR-0010 |
| R-08 | Un Dataset de simulation non tracé produit des résultats non reproductibles, invalidant rétroactivement des Strategy Versions déjà publiées | Moyenne sans provenance formalisée | Moyen-Élevé | Data Acquisition & Provenance en Phase 2, avant Simulation Engine | ADR-0022 |
| R-09 | Le calcul de Feature diverge entre simulation et live (même nom, résultat numérique différent) | Moyenne si non testé explicitement | Moyen | Test de non-régression obligatoire par Feature migrée | `06` §5 |

## 4. Risques d'orchestration LLM et de coût

| ID | Risque | Probabilité | Impact | Mitigation | Propriétaire |
|---|---|---|---|---|---|
| R-10 | Le pipeline moniteur de thèse (haute fréquence) est bloqué par un sous-agent lent après migration vers le Multi-Agent Runtime | Moyenne sans politique de batch adaptée | Moyen (disponibilité) | Politique `TIMEOUT_WITH_PARTIAL_RESULTS` par défaut pour ce pipeline | ADR-0014 |
| R-11 | La migration des 3 pipelines LLM introduit une régression de valeur métier masquée par le succès technique de la migration d'infrastructure | Moyenne si mesuré seulement techniquement | Moyen | Mesure de métrique de valeur ajoutée avant/après, par pipeline, jeu de scénarios de non-régression dédié | ADR-0013, `09` §6 |

## 5. Risques de gouvernance et de dérive de scope

| ID | Risque | Probabilité | Impact | Mitigation | Propriétaire |
|---|---|---|---|---|---|
| R-12 | Un agent d'implémentation futur interprète la North Star comme un mandat de big-bang et modifie prématurément le chemin d'exécution réel | Moyenne sans garde-fou documentaire clair | Élevé | Invariants INV-1 à INV-8 rappelés systématiquement, `22-GPT-CODEX-IMPLEMENTATION-RUNBOOK.md` | `01` §3, `22` |
| R-13 | Le pipeline GPT-first est dégradé ou coupé par erreur avant que son successeur ne soit validé | Faible si tests de non-régression systématiques | Élevé | Test de non-régression du comportement GPT-first obligatoire à chaque ticket des Phases -1 à 10 | ADR-0020 |
| R-14 | Une migration de schéma combine ajout et suppression, empêchant un rollback simple en cas de problème en production | Faible si discipline respectée | Moyen-Élevé | Discipline expand/contract obligatoire | ADR-0019 |
| R-15 | L'ambiguïté de version des contrats (5.4.0 vs 5.1.0) est résolue par une supposition erronée plutôt qu'une vérification, cassant la compatibilité moteur | Faible si `OP-2` traitée avant Phase 1 | Élevé | Aucun ticket ne fige une version en dur avant confirmation opérateur | ADR-0021, `OP-2` |

## 6. Risques hérités de l'AS-IS, non introduits par ce dossier mais à surveiller

| ID | Risque | Probabilité | Impact | Mitigation | Propriétaire |
|---|---|---|---|---|---|
| R-16 | Le hold `ENGINE_V5_VALIDATION_HOLD` a un état différent à la date réelle de démarrage de l'implémentation par rapport à la date de cet audit (2026-08-07) | Élevée avec le temps | Moyen (planification erronée) | Revérification explicite obligatoire avant Ticket -1.1 | `OP-12` |
| R-17 | Le pont fichier NinjaTrader alternatif (non câblé) a un état d'implémentation réel non vérifié, pouvant surprendre en Phase 9 | Faible-Moyenne | Faible-Moyen | Marqué `INCERTAIN` explicitement, à revérifier à l'entrée de Phase 9 | `02` §10 |
| R-18 | Aucun test de charge n'existe pour un nombre de Strategy Instances actives significativement plus élevé qu'aujourd'hui | Moyenne à mesure que l'usage croît | Moyen (dégradation de performance non anticipée) | Test de charge recommandé avant activation de plusieurs instances LIVE simultanées | `15` §3.3 |

## 7. Risques sans mitigation actuellement documentée

Aucun — chaque risque identifié ci-dessus référence une mitigation explicite et un propriétaire de suivi (ADR ou ticket). Ce document doit être mis à jour dès qu'un nouveau risque est identifié pendant l'implémentation, avec la même discipline (pas de risque sans mitigation ou sans étiquette `MITIGATION MANQUANTE` explicite).

## 8. Revue périodique

**RECOMMANDATION D'ARCHITECTURE** : ce registre devrait être relu à chaque entrée de phase (voir `phase-gates.yaml`), pas seulement une fois à la production de ce dossier — certains risques (ex. R-16, R-18) sont datés par nature et se dégradent avec le temps si non revérifiés.
