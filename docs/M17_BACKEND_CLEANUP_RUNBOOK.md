# M17 — Nettoyage backend contrôlé

Objectif : supprimer les vestiges backend seulement quand la preuve locale montre qu'ils ne participent plus au runtime préprod.

## Règle de sécurité

Aucune suppression automatique. Chaque lot doit passer :

1. preuve `rg` sans référence runtime ;
2. classification : `safe-delete`, `quarantine`, `keep-runtime`, `keep-doc`;
3. suppression ciblée ;
4. tests backend ciblés ;
5. `npm run typecheck`, `npm run test:react`, `npm run build` ;
6. `npm run test:stack` après rebuild Docker si le backend ou le front a changé.

## Audit reproductible

Depuis `mcp_gpt_desk` :

```bash
npm run audit:backend-cleanup
```

Le script scanne le périmètre de findings actifs :

- `mcp_gpt_desk/src`
- `mcp_gpt_desk/scripts`
- `scripts`
- `docs`

Les documents de mémoire froide sous `docs/archive/` et les notes de migration d'infrastructure `docs/MIGRATION_*` restent lisibles, mais ne produisent pas de findings actifs dans ce chantier.

Et il élargit le périmètre de recherche de références à :

- `packages`

Il sort un JSON avec :

- références à des fournisseurs cloud sortis du runtime local ;
- marqueurs d'obsolescence historiques ;
- scripts de rattrapage ou publication de packs ;
- scripts sans référence détectée.

Note M17-1 : un script signalé comme sans référence ne doit pas être supprimé sans preuve `rg` globale. Les deux premiers candidats apparents étaient encore référencés depuis les packages internes :

- `scripts/quality/check_contracts_finalization.mjs` est documenté par `packages/desk-contracts/README.md` ;
- `scripts/quality/check_desk_domain_coverage.mjs` est appelé par `packages/desk-domain/package.json`.

Le script d'audit tient maintenant compte de ces références.

Note M17-2 : les marqueurs historiques actifs ont été retirés du runtime `mcp_gpt_desk/src`. Le code d'erreur exposé par les chemins replay en lecture seule est désormais `READ_ONLY_REPLAY_FORBIDDEN`, ce qui décrit mieux la logique actuelle. Le dernier audit M17-2 donnait `22` findings, `0` script sans référence; les findings restants étaient documentaires.

Note M17-3 : la commande d'audit devient `audit:backend-cleanup`, les rapports datés du 15/07 passent sous `docs/archive/2026-07-15/`, et les notes de migration d'infrastructure restent exclues du nettoyage applicatif actif.

Résultat M17-3 validé : `212` fichiers scannés, `71` fichiers dans le périmètre actif de findings, `0` finding actif et `0` script sans référence.

Note M17-4 : les scripts racine sont séparés par rôle :

- `scripts/handoff/` pour la génération du dossier de passation front ;
- `scripts/quality/` pour les gates de contrats et domaine ;
- `scripts/stack/` pour les tests de pile locale Docker.

Résultat M17-4 validé : les anciens chemins racine ne sont plus référencés, `npm run handoff:claude`, `npm --prefix packages/desk-domain run coverage:gate`, `node scripts/quality/check_contracts_finalization.mjs`, `npm --prefix packages/desk-contracts run check:generated`, `npm run build`, `npm run test:react`, `npm run typecheck` et `npm run test:stack` passent.

Note M17-5 : la documentation Claude est figée dans `docs/front-redesign/` :

- `README.md` pour le point d'entrée ;
- `MANIFEST.md` pour le contrat de mission ;
- `PROMPT.md` pour le prompt prêt à transmettre ;
- `HANDOFF.md` pour le snapshot généré par `npm run handoff:claude`.

Résultat M17-5 validé : `213` fichiers scannés, `72` fichiers dans le périmètre actif de findings, `0` finding actif et `0` script sans référence.

Note M17-6 : le manifeste final `docs/PREPROD_PROJECT_MANIFEST.md` clôture le nettoyage en séparant clairement runtime actif, qualité/gates, documentation active et archive.

Résultat M17-6 validé : `214` fichiers scannés, `73` fichiers dans le périmètre actif de findings, `0` finding actif et `0` script sans référence.

## Décision M17 de cette passe

Le dépôt préprod est déjà largement nettoyé : les scripts cloud retirés ne sont plus présents dans `mcp_gpt_desk/scripts`, et le runtime local passe par PostgreSQL/Docker. Cette passe ajoute donc un garde-fou vérifiable au lieu de supprimer en aveugle dans un worktree qui contient beaucoup de chantiers parallèles.

Le prochain lot ne doit être ouvert que lorsqu'un nouveau fichier, script ou document ne rentre plus clairement dans les catégories du manifeste.

Les suppressions réelles doivent être regroupées par famille, pas mélangées aux milestones produit.

## Phase 15 — retrait V4 par lots (2026-07-20)

Les preuves de parité replay/LIVE sont désormais un prérequis à la suppression.
Les lots sont :

1. retirer physiquement `desk_cross_asset_deltas` après sauvegarde ;
2. masquer puis retirer du MCP les tools déterministes historiques, jobs,
   NY Open strict et écritures génériques ;
3. exclure les runs importés de la file et de l'observabilité sans supprimer
   leur historique ;
4. retirer des projections Operations les familles qui ne sont plus V4 ;
5. conserver temporairement `get_backtest_results` comme façade de lecture
   des résultats replay ;
6. exécuter les tests contrats, replay, LIVE, persistance et stack entre les
   lots.

Le fichier `config/autopilot-v4-scope.json` est la liste exécutable de la cible.

## Résultat final de la phase 15

Les six lots ont été exécutés et validés :

1. `desk_cross_asset_deltas` a été supprimé du schéma/runtime et contient
   désormais zéro document ;
2. `get_cross_asset_delta` et `get_desk_methodology` ont été retirés des
   schémas, du registre et des contrats générés ;
3. le profil MCP `compatibility/all` est refusé : seul le profil
   `autopilot_v4` est exécutable ;
4. les surfaces déterministes historiques, jobs, NY Open strict et écritures
   génériques ne sont plus exposées par le runtime MCP ;
5. Operations et l'observabilité projettent uniquement les workflows V4 ;
   les imports PROD restent disponibles dans History mais sont exclus des
   files, alertes et coûts PREPROD ;
6. `get_backtest_results` est conservé comme façade de lecture compatible des
   résultats replay V4.

Le dernier audit reproductible retourne :

- `251` fichiers scannés ;
- `78` fichiers dans le périmètre actif ;
- `0` finding actif ;
- `0` script sans référence.

Les tests de clôture donnent :

- backend : `264/264` ;
- React : `16/16` ;
- pile réelle Playwright : `4/4` ;
- contrats finalisés : `5`, violation `0`.

Les scripts one-shot de migration restent en quarantaine sous
`scripts/db/archive/`; ils ne font partie ni du runtime ni des commandes
d'exploitation. Aucun déploiement VPS n'a été effectué.
