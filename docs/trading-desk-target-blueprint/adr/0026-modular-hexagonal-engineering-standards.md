# ADR-0026 — Standards obligatoires et monolithe modulaire hexagonal

- **Statut** : accepté
- **Date** : 2026-08-08

## Contexte

Le host MCP a grandi jusqu'à concentrer plusieurs responsabilités dans des fichiers de 1 000 à 4 800 lignes. Le nouveau desk ajoute stratégies, recherche, agents, portefeuille et providers ; continuer sans frontières obligatoires amplifierait le couplage.

## Décision

Adopter `docs/engineering/TRADING_DESK_ENGINEERING_STANDARDS.md` et le `AGENTS.md` racine. Le backend converge vers un monolithe modulaire par bounded contexts, architecture hexagonale et API publiques minimales. Les règles nouvelles s'appliquent immédiatement ; les violations historiques sont enregistrées et résorbées progressivement sans refactor big-bang. Toute zone legacy touchée réduit une dette mesurable et la clôture du programme exige la conformité complète du dépôt.

## Alternatives écartées

- Copier Spring Modulith/Java : incompatible avec le stack actuel et réécriture non justifiée.
- Microservices immédiats : coût d'exploitation et transactions distribuées sans frontière existante propre.
- Documentation non bloquante : insuffisante ; les règles doivent devenir des quality gates.

## Conséquences

- phase Engineering Foundation avant toute nouvelle feature ;
- tests automatiques de frontières et complexité ;
- vertical slices domaine/application/adapter/front ;
- registre de dérogations temporaire pour le legacy ;
- suivi du burn-down à chaque phase ;
- gate final bloqué tant qu'une dérogation ou violation de blocage subsiste.
