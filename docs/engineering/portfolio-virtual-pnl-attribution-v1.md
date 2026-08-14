# Portfolio Virtual PnL Attribution V1

TD2-706 attribue le PnL virtuel par Strategy Instance et mesure la similarité entre stratégies/candidates.

## Objectif

Le Portfolio Risk ne doit pas seulement voir une exposition nette.

Il doit aussi savoir :

- quelles Strategy Instances génèrent le R ;
- quelles instances occupent déjà le même “territoire” stratégique ;
- quelle allocation réduire lorsqu’une stratégie est trop similaire à une autre plus performante.

## Moteur

`buildPortfolioVirtualPnlAttributionV1` consomme :

- `trades[]` ou `virtual_trades[]` ;
- `virtual_portfolio.by_strategy_instance[]` ;
- `candidate_allocations[].contributing_signals[]` ;
- `strategy_genomes[]` issus de TD2-507.

Il retourne :

- `portfolio_totals` ;
- `strategy_attributions[]` ;
- `similarity.pairs[]` ;
- `similarity.alerts[]` ;
- `allocation_impacts[]` ;
- `attribution_hash`.

## Règles PnL

- `total_r` = somme des `net_r/pnl_r/result_r/r`.
- `expectancy_r` = `total_r / trade_count`.
- `win_rate` = nombre de trades R positif / nombre total.
- `open_signed_size` vient du portefeuille virtuel.
- `allocation_size` vient des Candidate Allocations.

## Similarité

La similarité réutilise `compareResearchCandidateGenomesV1` de TD2-507.

Seuils par défaut :

- `duplicate_threshold = 0.92` ;
- `too_close_threshold = 0.78` ;
- `too_close_allocation_multiplier = 0.5`.

Une paire trop similaire produit une recommandation d’impact sur la stratégie la moins performante.

## Sortie front TD2-705

Le cockpit Portfolio Risk pourra afficher :

- contribution R par instance ;
- stratégies trop proches ;
- allocation recommandée ;
- raisons et axes de similarité.
