# AI Context Advisory V1

TD2-800 formalise le contrat exécutable de l’AI Context Gate.

## Objectif

L’AI Context Gate produit un avis contextualisé sur un `StrategySignal`, une position existante ou une `CandidateAllocation` déjà déterministe.

Il ne produit jamais :

- `OrderIntent` ;
- ordre broker ;
- `TargetPosition` ;
- nouvelle `CandidateAllocation` ;
- quantité exécutable ;
- instruction de soumission ou d’annulation.

## Placement

- Domaine pur : `packages/desk-domain/src/ai-context-advisory-v1.js`.
- API publique : `packages/desk-domain/index.js`.
- Tests : `packages/desk-domain/test/ai-context-advisory-v1.test.js`.

Le module appartient au bounded context `agents`. Sa sortie peut être lue par `portfolio-risk`, mais uniquement comme preuve consultative.

## Contrat

Un advisory normalisé contient :

- `schema_version = ai_context_advisory_v1` ;
- `advisory_id` stable ;
- `subject` (`SIGNAL`, `POSITION`, `CANDIDATE_ALLOCATION`) ;
- `recommendation` dans `TAKE`, `TAKE_REDUCED`, `WAIT`, `REJECT` ;
- `confidence` bornée entre 0 et 1 ;
- `rationale` ;
- `model_ref` ;
- `evidence_refs` ;
- `effect = READ_ONLY_ADVISORY` ;
- `issued_at_utc` / `expires_at_utc` ;
- `advisory_hash`.

## Preuve d’isolation

`proveAiContextAdvisoryIsolationV1` retourne `ai_context_advisory_isolation_proof_v1`.

La preuve vérifie :

- aucune présence de champs d’ordre, broker, quantité, provider ou outbox ;
- enum de recommandation fermé ;
- aucune sémantique de création de `OrderIntent`, `TargetPosition` ou `CandidateAllocation` ;
- effet strictement `READ_ONLY_ADVISORY`.

Une référence `candidate_allocation_id` est autorisée uniquement comme sujet déjà existant : elle ne crée pas l’allocation et ne la modifie pas.

## Invariant

Même une recommandation `TAKE` ne devient jamais une décision d’exécution. La décision réelle reste :

`StrategySignal` → `CandidateAllocation` → `RiskDecision` → `TargetPosition` → `OrderIntent`.

L’advisory est une annotation auditable, pas un raccourci.
