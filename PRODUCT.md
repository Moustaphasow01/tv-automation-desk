# Desk Control Plane V2 — Product Definition

## Produit

Desk Control Plane V2 est le poste de commande web du Trading Desk. Il permet à un opérateur, un superviseur, un chercheur ou un administrateur autorisé d'observer l'état réel du desk, comprendre les décisions et anomalies, investiguer chaque objet métier, déclencher une commande autorisée et vérifier son résultat terminal dans une piste d'audit.

## Utilisateurs et objectifs

- **Opérateur** : surveiller la session, les signaux, les ordres, le risque et les incidents ; exécuter les commandes PAPER autorisées ; vérifier leur résultat.
- **Superviseur** : prioriser les exceptions, contrôler la santé et la conformité, comparer attendu et observé.
- **Chercheur** : lancer et suivre des expériences reproductibles, comparer les stratégies et décider de leur promotion.
- **Administrateur** : gérer les accès, fournisseurs et réglages avec des garde-fous explicites.

## Mécanisme de confiance

Le produit repose sur une seule autorité backend pour les faits métier. Le frontend consomme des vues BFF versionnées, affiche l'origine et la fraîcheur des données, et traite toute mutation comme une commande auditée suivie jusqu'à un état terminal. Les mêmes définitions de stratégie et règles déterministes doivent rester traçables entre recherche, replay, SHADOW, PAPER et LIVE.

## Invariants

1. Le frontend ne fabrique ni donnée, ni état, ni résultat métier.
2. `0`, `false`, `[]`, `null`, `stale`, `unavailable` et `forbidden` sont des réalités différentes et doivent être rendues différemment.
3. Une acceptation de commande n'est pas un succès. Le succès exige un résultat terminal et un reçu d'audit.
4. Toute page de détail est résolue par l'identifiant de la route ; un identifiant absent ou inconnu produit un état explicite.
5. Les permissions et environnements sont fournis par la session backend ; aucune capacité sensible n'est accordée localement.
6. Aucun LLM ne soumet directement un ordre au broker. Le moteur déterministe et les risk gates restent autoritaires.
7. Le mode LIVE reste verrouillé jusqu'au cutover explicite. Les validations initiales s'effectuent en SHADOW/PAPER.
8. Les agrégats PnL/R, le risque, les statuts d'ordre et les états de workflow proviennent de projections canoniques.

## Identité produit

- Langue opérateur principale : français.
- Positionnement : SaaS enterprise, poste opérateur data-dense, précis et premium.
- Référence visuelle : console compacte sombre validée, sans hero décoratif, avec navigation globale puis drill-down dédié.
- Densité : professionnelle et compacte, mais jamais obtenue au prix d'une typographie illisible.

## Qualité attendue

- WCAG 2.2 AA, clavier complet et focus visible.
- Support laptop, Full HD, 2K et ultrawide ; mode workstation explicite pour Windows à 150 %.
- États standardisés : chargement, vide réel, indisponible, périmé, partiel, interdit et erreur.
- Tests de contrat, intégration, E2E critique et régression visuelle avant cutover.

## Sources de vérité du projet

- `docs/front-redesign/FRONTEND_V2_MASTER_BLUEPRINT_2026-08-13.md`
- `docs/front-redesign/FRONTEND_V2_PAGE_OPERATING_CONTRACTS_2026-08-13.md`
- `docs/front-redesign/FRONTEND_V2_BACKEND_FRONT_AUDIT_2026-08-13.md`
- `docs/ui-ux/UI_UX_RULEBOOK.md`
- contrats métier versionnés sous `packages/desk-contracts/contracts/`
