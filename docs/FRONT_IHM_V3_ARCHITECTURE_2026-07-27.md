# Front/IHM V3 — architecture et validation

Date : 2026-07-27  
Statut : implémenté et validé localement

## Objectif

Le desk doit présenter en premier la situation métier et l’action utile. Les références
techniques restent accessibles comme preuves, mais ne structurent plus les titres,
les menus ou les cartes principales.

## Architecture de navigation

La navigation principale contient exactement six espaces stables :

1. Aujourd’hui — session courante, plan, position, journal et agenda.
2. Replay — préparation, journées de test, comparaison et archives.
3. Performance — résultats et calendrier en R.
4. Opérations — automatisations, files GPT, activité, incidents, notifications et procédures.
5. Exécution — NinjaTrader Sim101, ordres et positions.
6. Réglages — stratégie, contrats et qualité des données.

Chaque espace expose uniquement son sous-menu local. La page « Tous les écrans »
reste disponible sur mobile sans dupliquer la navigation desktop.

## Modèle global → zoom

Les listes sont des vues globales. Un clic ouvre une route dédiée, avec un fil
d’Ariane et un retour vers le contexte exact :

- incident : `/operations/incidents/:incidentId`;
- notification : `/operations/notifications/:notificationId`;
- procédure : `/operations/runbooks/:runbookId`;
- automatisation : `/operations/workflows/:workflowId`;
- événement : `/operations/workflows/:workflowId/events/:eventId`;
- replay, journée, exécution de session et analyse GPT : routes Replay dédiées.

Il n’existe plus de panneau de zoom permanent à droite pour les incidents,
notifications ou procédures.

## Vingt améliorations livrées

1. Six espaces métier stables.
2. Sous-menu contextuel au lieu d’une liste globale de liens.
3. Fil d’Ariane unique.
4. Retour vers la page précédente exacte.
5. Écrans zoom dédiés aux incidents.
6. Écrans zoom dédiés aux notifications.
7. Écrans zoom dédiés aux procédures.
8. Titres humains pour les replays datés.
9. Titres humains pour les processus GPT.
10. Titres humains pour les automatisations.
11. Identifiants bruts repliés dans « Références techniques ».
12. Statuts backend traduits et normalisés.
13. Recherche globale centrée et alignée.
14. Recherche par vocabulaire métier avec référence technique en recours.
15. Thème clair par défaut, thème sombre conservé.
16. Densité compacte ou confortable persistée.
17. Tableaux responsives sans débordement global à 320 px.
18. Cockpit mobile compacté en deux colonnes.
19. États partiels/timeout affichés localement sans masquer tout l’écran.
20. Découpage des routes en chunks pour réduire le chargement initial.

## Politique de données

Le frontend ne fabrique aucune donnée métier. Une API lente, absente ou vide
produit un état `chargement`, `partiel`, `timeout` ou `vide`. Les écrans continuent
d’afficher les ressources déjà disponibles.

## Validation

- TypeScript : succès.
- Tests React : 20/20.
- E2E shell et parcours : 5/5.
- Routes vérifiées directement : 36.
- Viewports vérifiés : 320, 768, 1280 et 1600 px.
- Build Vite : succès.

