# Bilan écran par écran — Front préproduction

Date : 2026-07-18  
Portée : frontend local préproduction, après M0 à M17.  
Objectif : distinguer ce qui est réellement livré, ce qui mérite une amélioration UX/design et ce qui doit être priorisé.

## Verdict global

Le chantier front précédent est bien implémenté : la navigation par espaces, les écrans profonds routés, le Replay Lab multi-sessions, l'inspecteur GPT, l'observabilité, les runbooks, les notifications, la performance et l'historique sont présents et testés.

Le front n'est donc plus au stade mock ou maquette. Il fonctionne sur la pile locale réelle via le BFF et PostgreSQL. Le point faible restant est surtout qualitatif : finition visuelle, hiérarchie, lisibilité, densité contrôlée et harmonisation complète des écrans Live avec les écrans Operations/Replay.

## Couverture validée par tests

Les parcours suivants sont couverts par le test stack réel :

- Operations : table, board, timeline ;
- Replay Lab : run, journée, session, timeline prix/décisions, GPT inspector ;
- Incidents, notifications et runbooks ;
- Observabilité GPT, coûts mesurés et leases ;
- Performance, historique et gouvernance stratégie ;
- responsive 320 px sur les écrans critiques Operations/Replay/Performance/History/Strategies.

## Bilan par écran

| Route | État | Ce qui est fait | Reste à améliorer | Priorité |
|---|---|---|---|---|
| `/live` | Fonctionnel | Cockpit Live connecté au contexte automatique, cartes marché/décision/activité. | Hiérarchie plus forte type desk : marché, décision, risque, activité secondaire. Réduire la sensation d'empilement. | P1 |
| `/sessions` | Fonctionnel | Sélection automatique Europe/Paris et état des phases. | Rendre la journée plus visuelle avec une timeline de session et une transition suivante plus évidente. | P2 |
| `/master` | Fonctionnel | Analyse Master, scénarios, niveaux et contrat affichés. | Transformer le contenu long en document analytique scannable avec sommaire et blocs comparables. | P1 |
| `/monitors` | Fonctionnel | Suite des checkpoints et décisions de monitoring. | Vue temporelle plus lisible, comparaison entre checkpoints et mise en avant des deltas critiques. | P1 |
| `/thesis` | Fonctionnel | Thèse active, statut, confiance, niveaux et invalidations. | Fiche centrale plus nette : faits, interprétation, conditions et invalidation séparés. | P2 |
| `/setup` | Fonctionnel | Distinction setup théorique / position canonique, actions sécurisées. | Rendre la sécurité encore plus visible : zone risque, confirmation, état exécutable/non exécutable. | P1 |
| `/timeline` | Fonctionnel | Journal décisionnel. | Ajouter filtres plus visibles et densité de lecture proche registre d'audit. | P2 |
| `/news` | Fonctionnel | Macro/news et fenêtres de risque. | Prioriser prochain événement, heure de Paris et impact sur décision en tête d'écran. | P2 |
| `/audit` | Fonctionnel | Qualité, contrats et diagnostics. | Séparer conformité métier, données et diagnostic technique avec niveaux de sévérité plus lisibles. | P2 |
| `/alerts` | Fonctionnel | Alertes Live. | Clarifier la différence avec incidents Operations et afficher cible/urgence/action suivante. | P2 |
| `/performance` | Fonctionnel | Calendrier R. | Harmoniser avec `/performance/analysis`; remplacer le détail secondaire par une navigation plus cohérente si utile. | P2 |
| `/operations` | Très avancé | Cockpit global, filtres, KPI, table, board et timeline. Test stack réel. | Finitions : filtres persistants, densité de tableau, bulk actions futures si nécessaire. | P1 |
| `/operations/observability` | Très avancé | Télémétrie GPT, coûts mesurés, leases, guardrails, policy. Test stack réel. | Ajouter drill-down coût/modèle plus direct et rendre la couverture manquante encore plus actionnable. | P1 |
| `/operations/incidents` | Avancé | Cycle incidents, actions révisionnées, audit. Test stack réel. | Vue inbox plus opérateur : âge, priorité, cible, action suivante. | P1 |
| `/operations/notifications` | Avancé | Outbox locale, escalade, read/dismiss. Test stack réel. | Mieux différencier notification, incident source et action requise. | P2 |
| `/operations/runbooks` | Avancé | Runbooks générés depuis incidents/workflows/GPT. Test stack réel. | Ajouter une lecture pas-à-pas plus guidée avec état prérequis/action/résultat attendu. | P1 |
| `/operations/workflows/:workflowId` | Avancé | Détail workflow, étapes, événements, actions contrôlées. | Fiche d'exécution plus structurée : header d'état, stepper, journal, zone actions séparée. | P1 |
| `/operations/workflows/:workflowId/events/:eventId` | Fonctionnel | Détail événement routé avec payload projeté. | Rendre l'écran plus diagnostic-first; JSON brut secondaire et repliable. | P2 |
| `/replay` | Très avancé | Vue globale Replay Lab, journées, runs, création réelle. Test stack réel. | Améliorer l'effet portefeuille/recherche : filtres temporels, comparaison et lecture résultat plus immédiate. | P1 |
| `/replay/compare` | Fonctionnel | Comparaison multi-runs. | Rendre les écarts plus visuels, moins juxtaposition de cartes/tableaux. | P1 |
| `/replay/runs/:runId` | Avancé | Hub de run avec statut, progression, journées et liens. | Résumé décisionnel du run plus compact et plus orienté conclusion. | P1 |
| `/replay/runs/:runId/days/:date` | Très avancé | Journée multi-sessions, variantes, tentatives, GPT consolidé. Test stack réel. | Améliorer la matrice session/variante/tentative avec zoom et tri plus opérateur. | P1 |
| `/replay/runs/:runId/days/:date/sessions/:sessionExecutionId` | Très avancé | Timeline prix/décisions zoomable, couches GPT/décision/étape. Test stack réel. | Maximiser la surface graphique, améliorer sélection synchronisée et inspecteur latéral. | P1 |
| `/replay/runs/:runId/gpt/:processId` | Très avancé | Cycle GPT, manifest, save target, lease, erreurs, conclusion, contrat M7. Test stack réel. | Masquer davantage le technique par défaut et mieux faire ressortir conclusion/action. | P1 |
| `/performance/analysis` | Très avancé | Performance réelle, filtres, equity/drawdown, ventilations, journées. Test stack réel. | Ajouter plus d'aide à l'interprétation : meilleur/pire segment, causes et liens replay. | P1 |
| `/history` | Avancé | Historique filtrable, sessions, métriques, GPT/incidents. Test stack réel. | Améliorer regroupements temporels et recherche longue période. | P2 |
| `/history/sessions/:sessionId` | Avancé | Détail session, workflows, performance, incidents, GPT, timeline. Test stack réel. | Rapprocher encore la lecture du cockpit Operations tout en gardant le contexte historique. | P2 |
| `/strategies` | Avancé | Registry stratégie, sources, stats, versions. Test stack réel. | Vue gouvernance plus claire : santé, version courante, couverture de config. | P2 |
| `/strategies/:strategyId` | Avancé | Versions, contrats, diff structurel, lien performance. Test stack réel. | Diff plus lisible visuellement, avec résumé impact métier avant le détail brut. | P2 |
| `/more` | Fonctionnel | Menu complet mobile/secondaire. | Le rendre identique à la taxonomie desktop et plus utile sur mobile. | P2 |

## Priorités recommandées

### P1 — prochaine passe front utile

1. Harmoniser Live/Master/Monitors/Setup avec la densité et les composants Operations.
2. Raffiner Replay Session : graphique plus dominant, inspecteur synchronisé, timeline plus lisible.
3. Raffiner Operations : workflow detail, incidents et runbooks en mode vraie console opérateur.
4. Améliorer Performance/Replay Compare pour lire les écarts et causes plus vite.

### P2 — finition ensuite

1. Sessions, News, Audit, Alerts et More.
2. Historique et Stratégies : polish de gouvernance et recherche longue période.
3. Microcopy, états vides, aides contextuelles, cohérence français/anglais.

## Conclusion

Le gros chantier fonctionnel est terminé. Le prochain chantier front ne doit pas repartir de zéro : il doit capitaliser sur les écrans déjà connectés et concentrer l'effort sur l'expérience opérateur, la densité, les priorités visuelles et la clarté de décision.
