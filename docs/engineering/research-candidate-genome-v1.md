# Research Candidate Genome V1 — TD2-507

## Objectif

`TD2-507` donne à chaque candidate de recherche une signature stable avant de consommer du compute : famille stratégique, régimes visés, axes de logique, hash de génome, score de nouveauté et décision de déduplication.

## Contrat domaine

Implémentation : `packages/desk-domain/src/research-candidate-genome-v1.js`.

Exports principaux :

- `buildResearchCandidateGenomeV1`
- `compareResearchCandidateGenomesV1`
- `evaluateResearchCandidateNoveltyV1`
- `buildResearchCandidateKnowledgeNodeV1`

## Taxonomie V1

Familles :

- `BREAKOUT_RETEST`
- `MOMENTUM_CONTINUATION`
- `MEAN_REVERSION`
- `RANGE_ROTATION`
- `VOLATILITY_EXPANSION`
- `EVENT_DRIVEN`
- `CROSS_ASSET_CONFIRMATION`
- `RISK_MANAGEMENT_VARIANT`
- `UNKNOWN`

Régimes :

- `TREND`
- `RANGE`
- `LOW_VOL_COMPRESSION`
- `VOLATILITY_EXPANSION`
- `EVENT_WINDOW`
- `CROSS_ASSET_DIVERGENCE`
- `UNKNOWN`

## Axes de génome

Le hash de génome est calculé sur :

- `family`
- `instruments`
- `timeframes`
- `session_scope`
- `entry_logic`
- `confirmation_signals`
- `exit_logic`
- `risk_model`
- `regime_filters`

Les listes sont normalisées, triées et dédupliquées pour garantir un hash stable.

## Novelty / déduplication

`evaluateResearchCandidateNoveltyV1` compare la candidate à des génomes existants :

- `DUPLICATE` si hash identique ou similarité ≥ `duplicate_threshold` (`0.92` par défaut).
- `TOO_CLOSE` si similarité ≥ `too_close_threshold` (`0.78` par défaut).
- `NOVEL` sinon.

Le score de nouveauté vaut `1 - max_similarity`.

## Graphe logique

`buildResearchCandidateKnowledgeNodeV1` produit un node consommable par le futur graphe (`TD2-509`) :

- labels `ResearchCandidate`, `StrategyGenome`, famille ;
- propriétés de taxonomie et hash ;
- edges `HAS_FAMILY`, `TARGETS_REGIME`, puis `DUPLICATES`/`SIMILAR_TO` quand une comparaison existe.

## Limites

La V1 ne persiste pas encore les génomes et ne remplace pas la validation scientifique. Elle fournit le contrat déterministe consommable par `TD2-508`, `TD2-509`, `TD2-511` et les workflows de génération.
