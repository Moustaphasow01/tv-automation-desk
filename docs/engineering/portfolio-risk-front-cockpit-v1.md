# Portfolio Risk Front Cockpit V1

TD2-705 ajoute le cockpit opérateur transitoire du Portfolio Risk.

## Objectif

Rendre lisible, depuis le front actuel, l’état consolidé du risque portefeuille avant l’activation multi-stratégie réelle.

Le cockpit affiche :

- santé globale du portefeuille ;
- comptes broker, capital lu et policy de risque ;
- exposition nette par `account_id + instrument` ;
- intentions d’ordre et ordres actifs ;
- divergences broker/PostgreSQL ;
- concentration des Strategy Instances par instrument ;
- actions opérateur contrôlées.

## Placement

- Backend : `mcp_gpt_desk/src/front-portfolio-risk-projection.js`, bounded context `reporting`.
- REST : `GET /api/v1/portfolio-risk/overview`.
- Front : `src/features/portfolio-risk/*` + `src/pages/PortfolioRiskPage.tsx`.

La projection agrège des sources déjà persistées :

- `execution/overview` ;
- `strategy-v2/overview` ;
- `performance/overview`.

Si une source échoue, le contrat retourne `source.status=partial` et expose l’erreur. Le front ne fabrique aucun chiffre de substitution.

## Responsabilités

Le cockpit est une vue de supervision.

Il ne :

- publie pas de `RiskDecision` ;
- ne modifie pas de `TargetPosition` ;
- ne soumet pas d’ordre ;
- ne contourne pas l’Execution Gateway.

Les actions sensibles sont visibles mais contrôlées : l’action sûre ouvre la console d’exécution, l’écriture portefeuille reste désactivée jusqu’au use case révisionné.

## Navigation globale et zoom

La vue globale reste compacte.

Chaque section ouvre une route dédiée :

- `/operations/portfolio-risk/accounts` ;
- `/operations/portfolio-risk/exposures` ;
- `/operations/portfolio-risk/controls` ;
- `/operations/portfolio-risk/strategy` ;
- `/operations/portfolio-risk/intents` ;
- `/operations/portfolio-risk/reconciliation`.

Cela respecte la logique globale → zoom sans panneau de détail permanent.

## Limites assumées

Les tables transactionnelles Portfolio Risk cibles ne sont pas encore le ledger officiel du module. TD2-705 lit donc une projection réelle issue de l’exécution et de la stratégie.

Quand le ledger Portfolio Risk sera introduit, ce même endpoint pourra basculer sa source sans changer le parcours front.
