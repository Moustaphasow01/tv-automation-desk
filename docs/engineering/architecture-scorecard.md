# Architecture Compliance Scorecard

Dernière mise à jour : 2026-08-09.

## Engineering Foundation P-1

- Tickets P-1 : 16 / 16 terminés.
- Guards livrés : frontières/cycles, qualité statique, dérogations, scorecard, gouvernance PR, sécurité supply-chain, migrations SQL, Problem Details, runtime safety, slices MCP, architecture front features/data-access/ViewModels.
- Exceptions actives : 3.
- Prochaine expiration : 2026-12-31.
- Gate final bloquant : `zero_active_exceptions`.

## Dette bornée

Les budgets de dette actuels sont conservés dans `architecture-scorecard.json` et validés contre `static-quality-baseline.json` :

- fonctions longues : 243 ;
- complexités élevées : 592 ;
- blocs dupliqués : 50 ;
- fichiers potentiellement morts : 14.

Note : la hausse 2026-08-09 est tracée par `TD2-ARCH-016` après les vertical
slices Data Foundation. Elle constitue une nouvelle baseline mesurée, pas une
clôture de dette.

## Règle de phase

Chaque phase doit publier son avant/après. Toute zone legacy touchée doit réduire au moins une dette mesurable ou ouvrir une dérogation priorisée et expirée.
