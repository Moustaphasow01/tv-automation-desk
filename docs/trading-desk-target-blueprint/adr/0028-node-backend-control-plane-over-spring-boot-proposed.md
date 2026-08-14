# ADR-0028 — Backend Node.js comme control plane cible, sans réécriture Spring Boot immédiate

Statut: À DÉCIDER (OPÉRATEUR)

Date: 2026-08-14

## Contexte

Le cahier des charges initial mentionnait Spring Boot comme backend/orchestrateur central. Le repository réel du Trading Desk utilise aujourd'hui Node.js/ESM, PostgreSQL, React/VNext et un worker Python limité au calcul lourd de simulation/statistiques.

Une réécriture Spring Boot massive modifierait le runtime, les migrations, les services MCP/BFF, les workers Windows, les tests, la release VPS et les runbooks. Elle n'est donc pas considérée comme une correction sûre tant qu'un défaut fonctionnel ou architectural bloquant de Node.js n'est pas prouvé.

## Décision proposée

Conserver Node.js comme backend/control plane cible pour la transformation V2, à condition que le repository prouve les propriétés architecturales attendues :

- PostgreSQL source de vérité ;
- orchestration backend centralisée ;
- pipeline data-driven/event-driven ;
- séparation Data → StrategySignal → AI Context Gate → Portfolio → Risk → TargetPosition → OrderIntent → Execution Gateway ;
- fail-closed ;
- auditabilité ;
- API/BFF stable ;
- observabilité ;
- tests end-to-end.

Spring Boot devient une option future, pas une exigence immédiate.

## Alternatives

### Réécriture immédiate vers Spring Boot

Rejetée pour l'instant.

Raisons :

- coût élevé ;
- risque de régression sur un système déjà très couplé au runtime Node/VPS ;
- gain fonctionnel non démontré ;
- perte de vitesse sur les lots de sécurité, risk, execution et research ;
- double maintenance pendant le cutover.

### Microservice Spring Boot autour de l'exécution

Différée.

Un service dédié pourrait être justifié plus tard si une contrainte stricte apparaît : latence, intégration broker, typage JVM, gouvernance enterprise, ou besoin d'équipe.

### Node.js backend + Python compute worker

Option retenue provisoirement.

Elle respecte déjà le découpage actuel : Node orchestre et persiste ; Python peut être utilisé uniquement pour simulation/statistiques lourdes sans devenir source de vérité.

## Conséquences

- Les exigences Spring Boot ne doivent pas être marquées FAIT tant que cette ADR n'est pas approuvée.
- Les nouveaux lots doivent renforcer les propriétés architecturales, pas migrer de langage.
- Toute nouvelle limite démontrée de Node.js doit réouvrir cette ADR.
- Le cutover final doit auditer la propriété, pas seulement la technologie.

## Preuves AS-IS

- Backend Node.js/MCP/BFF réel: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/package.json`
- Root scripts Node/VNext/gates: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/package.json`
- PostgreSQL migrations: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/infra/postgres/init`
- Rapport d'audit antérieur recommandant de ne pas réécrire: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/docs/audit-2026-08-07/RAPPORT-COMPLET.md:381`
- Addendum cible consolidé: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/docs/trading-desk-target-blueprint/25-DIRECTOR-PLAN-CONVERGENCE-ADDENDUM.md:13`

## Critère de résolution

Cette ADR passe à `TRANCHÉE` uniquement après approbation explicite opérateur.

Tant qu'elle est `À DÉCIDER`, l'exigence “Spring Boot backend central” reste PARTIEL / décision d'architecture ouverte.
