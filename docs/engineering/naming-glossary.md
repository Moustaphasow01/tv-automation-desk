# Glossaire de nommage du Trading Desk

| Produit | Code canonique | À éviter |
|---|---|---|
| définition de stratégie | `StrategyDefinition` | `StrategyConfig`, `AlgoData` |
| version de stratégie | `StrategyVersion` | confusion avec runtime contract version |
| instance active | `StrategyInstance` | `StrategySession` ambigu |
| verrou de compatibilité moteur | `RuntimeContractBundle` | `StrategyVersion` métier |
| hypothèse de recherche | `ResearchHypothesis` | `IdeaData` |
| expérience | `Experiment` | `TestRun` ambigu |
| exécution de simulation | `SimulationRun` | `Replay` lorsqu'il n'y a pas de GPT |
| replay qualitatif GPT | `GptReplayRun` | `SimulationRun` |
| dataset figé | `Dataset` | `Pack` sans précision |
| feature calculée | `FeatureValue` | `IndicatorData` générique |
| mission IA | `AgentMission` | `Job` sans domaine |
| tâche IA | `AgentTask` | `Claim` lorsqu'on désigne le travail |
| conversation Codex | `AgentConversation` | `Session` ambigu |
| définition de prompt | `PromptDefinition` | `PromptConfig` |
| version de prompt | `PromptVersion` | prompt texte modifiable |
| signal de stratégie | `StrategySignal` | `Trade` avant arbitrage |
| allocation candidate | `CandidateAllocation` | `Position` avant autorisation |
| décision risque | `RiskDecision` | `AiDecision` |
| position cible nette | `TargetPosition` | `Signal` |
| intention d'ordre | `OrderIntent` | `Order` avant soumission |
| ordre broker | `BrokerOrder` | `OrderIntent` |
| exécution/remplissage | `BrokerFill` | `TradeResult` |
| position interne | `TradePosition` | `Setup` |
| rapprochement broker | `ReconciliationRun` | `Sync` générique |
| fournisseur d'exécution | `OrderExecutionProvider` | `BrokerService` |
| thèse historique V5 | `LegacyTradingThesis` lorsque nécessaire | réutiliser comme StrategyDefinition |

## Conventions

- commands : verbe d'intention, ex. `PublishStrategyVersion` ;
- queries : résultat demandé, ex. `GetPortfolioExposure` ;
- events : fait passé, ex. `StrategySignalGenerated` ;
- policies : décision métier, ex. `LivePromotionPolicy` ;
- ports : capacité, ex. `OrderExecutionProvider` ;
- adapters : technologie + responsabilité, ex. `PickMyTradeOrderExecutionAdapter` ;
- IDs : `<concept>_id` dans les contrats wire/SQL, `conceptId` dans le code JS/TS.
