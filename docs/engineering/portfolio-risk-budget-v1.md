# Portfolio Risk Budget V1

TD2-701 ajoute le socle de budgets globaux avant toute exécution multi-stratégie.

## Objectif

Une Candidate Allocation peut être correcte isolément, mais dangereuse au niveau portefeuille. Le budget global sert à répondre à une question simple :

> “Si j’ajoute cette allocation au portefeuille virtuel courant, est-ce que je reste dans les limites opérateur ?”

## Contrat domaine

Implémentation : `packages/desk-domain/src/portfolio-risk-budget-v1.js`.

Exports :

- `normalizePortfolioRiskBudgetV1(input)` ;
- `evaluatePortfolioRiskBudgetV1(input)`.

Schémas :

- `portfolio_risk_budget_v1` ;
- `portfolio_risk_budget_evaluation_v1`.

## Budgets supportés

| Budget | Exemple |
|---|---|
| Portefeuille global | `max_portfolio_abs_size` |
| Compte | `max_account_abs_size["paper-sim101"]` |
| Instrument | `max_instrument_abs_size["MNQ"]` |
| Strategy Instance | `max_strategy_abs_size["inst-a"]` |
| Groupe corrélé | `max_correlation_group_abs_size["equity_index"]` |
| Perte journalière | `max_daily_loss_r` |
| Perte hebdomadaire | `max_weekly_loss_r` |

Les groupes de corrélation par défaut couvrent :

- `equity_index` : `MES`, `ES`, `MNQ`, `NQ`, `MYM`, `YM`, `M2K`, `RTY` ;
- `energy_crude` : `MCL`, `CL` ;
- `metals` : `MGC`, `GC`, `SIL`, `SI`.

## Statuts

| Statut | Sens |
|---|---|
| `PASS` | Allocation possible |
| `REDUCE` | Allocation possible seulement avec taille réduite |
| `BLOCK` | Allocation annulée par une limite déjà saturée ou un kill budget |
| `CONFIG_MISSING` | Aucun budget numérique configuré : fail-closed |

## Invariant de sécurité

Sans budget numérique, le moteur ne passe jamais en `PASS`.

Cela respecte `OP-8` : les valeurs de limites dépendent de l’opérateur et ne doivent pas être inventées par le code.

## Périmètre historique de TD2-701

TD2-701 ne produit pas encore :

- `Target Position` nette ;
- `OrderIntent` ;
- écriture SQL dédiée ;
- cockpit front budget.

Ces étapes arrivent dans TD2-702 à TD2-705.

## Extension monétaire — 6 septembre 2026

Le pipeline partagé live/replay persiste désormais Portfolio → Risk → TargetPosition
→ OrderIntent → Human Gate. L'extension ci-dessous ne change ni les moteurs de
signaux ni les prix des plans de trade.

Deux modes explicites existent :

- `REQUESTED_QUANTITY_CAP` : compatibilité historique, réduction du nombre de
  contrats demandé par le multiplicateur de contexte.
- `MONETARY_RISK_BUDGET` : le contexte réduit d'abord le budget monétaire, puis
  Risk calcule un nombre **entier** de contrats, sans dépasser la quantité proposée.
  Aucun minimum d'un contrat n'est forcé.

La politique opérateur pour le replay grains est figée dans
`reports/research/GRAINS_RISK_REPLAY_POLICY_20260906.json` : **500 USD par position,
2 000 USD/jour, 4 000 USD/semaine**, plafonds de contrats historiques inchangés.
Ce fichier ne constitue pas une activation sur le VPS.

### Contrat et calcul

`max_monetary_risk`, `max_monetary_risk_currency`,
`monetary_risk_scope: PER_ALLOCATION` définissent le plafond par position.
`max_daily_loss_monetary`, `max_weekly_loss_monetary`, `loss_currency`
définissent les protections monétaires du compte.

Le budget disponible est le minimum entre :

- plafond par position × multiplicateur de contexte ;
- plafond quotidien − perte nette réalisée du jour − risque déjà réservé ;
- plafond hebdomadaire − perte nette réalisée de la semaine − risque déjà réservé.

Les périodes restent en **UTC**, semaine commençant lundi, comme la projection R
existante. Une perte nette vaut `max(0, -PnL réalisé)` ; ce n'est pas la somme
brute des seuls trades perdants. Les gains ne permettent pas de dépasser le
plafond initial. Chaque nouvelle allocation réserve son risque dans le batch ;
le verrou transactionnel de compte protège les traitements concurrents.

Les pertes viennent des résultats théoriques finaux causaux en monnaie, et les
réserves des plans autorisés persistés : **jamais `R × 500`**. Une devise inconnue,
des valeurs absentes ou une provenance non prouvée bloquent le dimensionnement.
Les budgets exprimés en R restent supportés indépendamment ; ils ne remplacent
pas les plafonds en dollars. Le capital de compte manquant ne devient pas un
capital fictif : un risque en pourcentage reste indisponible.

Il s'agit de plafonds de **risque prévu au stop**, pas d'une garantie de perte
maximale exécutée : gaps, glissement et coûts peuvent faire dépasser le montant
prévu. Aucune exécution physique n'est autorisée par cette politique.

### Configuration applicative et activation

L'environnement ne passe pas automatiquement au nouveau mode. Pour un futur
déploiement contrôlé (non effectué par l'installation du code) :

```text
DESK_SHADOW_RISK_SIZING_MODE=MONETARY_RISK_BUDGET
DESK_SHADOW_RISK_MAX_MONETARY_RISK=500
DESK_SHADOW_RISK_CURRENCY=USD
DESK_SHADOW_RISK_MAX_DAILY_LOSS_MONETARY=2000
DESK_SHADOW_RISK_MAX_WEEKLY_LOSS_MONETARY=4000
```

Une politique de commande explicite est prioritaire sur l'environnement et n'est
pas fusionnée avec des valeurs cachées. Une configuration monétaire partielle
renvoie `RISK_CONFIG_MISSING` et garde les signaux admissibles en attente jusqu'à
leur expiration ; une nouvelle politique a une nouvelle empreinte d'idempotence.
Les refus Context restent terminaux. Les modes physiques restent désactivés.

Le replay accepte `--policy-file` et enregistre le hash du fichier, les valeurs
effectives, le hash des données et du code. Il refuse les paramètres d'exécution
broker dans ce fichier et n'altère jamais l'entrée figée.
