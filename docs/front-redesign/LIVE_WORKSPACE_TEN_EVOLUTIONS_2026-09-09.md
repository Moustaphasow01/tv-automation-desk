# Poste de séance — dix évolutions

## Périmètre autorisé

Extension du poste existant dans `apps/desk-control-plane/src/features/live-trading/workspace` ; consommation des projections et permissions existantes. Aucun changement de stratégie, de taille autorisée, de règles de risque, de permission ou d'exécution. Les préférences sont locales, versionnées et isolées par opérateur/environnement. Les filtres et la sélection sont partageables dans l'URL. Les données absentes ne sont pas reconstruites.

Le déploiement sera composé à partir du commit de la release VPS constatée (`30715bd7889761271ebb0e2b2f85cfde3ed4c83d`), exclusivement avec les changements front de ce chantier. Les modifications indépendantes du dossier de travail ne font pas partie de la livraison.

## Direction contract

THESIS: un poste unique pour voir, décider et suivre, avec une séparation nette entre observations, décisions et exécutions ; pas de grille de KPI décorative.

OWN-WORLD: prolonger le graphite, la typographie système, les nombres tabulaires et les séparateurs fins du poste actuel ; couleurs réservées au sens métier et aux changements reçus.

STORY: l'opérateur identifie ce qui réclame son attention, examine un ticket dans son contexte, confirme explicitement une action autorisée et retrouve son suivi sans perdre ses marchés.

FIRST VIEWPORT: barre de séance compacte, lecture Maintenant, liste de marchés à gauche, un à quatre graphiques centraux, tickets sous les marchés et détail latéral redimensionnable ; mobile en espaces Marchés, Tickets, Suivi et Bilan avec fiches contextuelles.

FORM: extension code-led de la composition déjà validée ; position et seed key non applicables (aucun nouveau monde ni tirage de concept). Interaction signature : naviguer du changement reçu au ticket puis au suivi sans remplacer l'actif observé.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Le moteur Impeccable installé ne propose pas la commande `surface-brief` : ce contrat développement est conservé ici, hors des fichiers servis. Aucun raster généré n'est nécessaire.

## Traçabilité et critères d'acceptation

| Évolution | Livraison attendue | Autorité / limites |
| --- | --- | --- |
| 1. Informations fiables | Noms publiés des stratégies ; état et dates des sources ; calendrier publié ou absence explicite | Aucun tick ni événement macro inventé ; registre lié par identifiants exacts |
| 2. Maintenant | Décisions en attente, changement reçu et prochain événement publié ; accès direct | Horloge de connexion distincte de fraîcheur marché |
| 3. Ticket V2 | Pourquoi, déclencheur, invalidation, changements depuis lecture, confirmation | Plan et quantité autorisés restent ceux du serveur |
| 4. Suivi unifié | Théorie, déclaration opérateur et preuves courtier séparées ; protections et risque publiés | Accusé de réception ≠ exécution ; absence de preuve ≠ absence de position |
| 5. Listes personnelles | Groupes enregistrés, favoris, filtre et classement stable explicite | Aucun calcul local de variation de marché |
| 6. Graphiques | Unités indépendantes, curseur lié facultatif, repères horodatés, agrandissement d'un panneau | Pas de bougie reconstruite ni de prix interpolé |
| 7. Alertes | Nouveaux tickets, échéance proche, changements d'état, dégradation ; déduplication, son opt-in | Acquittement visuel local ≠ décision métier ; santé critique non masquable |
| 8. Poste configurable | Disposition, densité, panneaux, largeur de fiche et raccourcis enregistrés | Préférences locales au navigateur, isolées par opérateur et environnement |
| 9. Mobile | Suivi et décisions accessibles au pouce ; fiche et confirmations ; petits écrans et rotation | Émulation et appareil iOS physique distingués dans les preuves |
| 10. Journal / bilan | Parcours avant, pendant, après ; filtres et retour contextualisé au ticket | Résultats officiels publiés uniquement ; périmètre reçu explicite |

## Architecture et justification

Les projections de présentation, préférences et alertes restent des modules distincts dans la feature Live Trading. Les vues serveur existantes sont consommées par les repositories, jamais par des requêtes réseau dans les composants. Le bus de curseur ne transporte qu'un temps d'observation et n'entre pas dans les commandes. Les autorisations restent relues avant toute soumission. Alternative écartée : seconde application/front parallèle et duplication de la logique du moteur.

Références de conception : UXR 21 (filtres), 26 (alertes), 30 (mobile), 40 (état), 45 (préférences), 49 (preuve de livraison), ADR 18/24/29/30/36. DESIGN.md reste la référence du langage existant.
