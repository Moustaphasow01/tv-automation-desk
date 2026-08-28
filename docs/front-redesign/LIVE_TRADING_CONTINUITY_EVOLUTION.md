# Live Trading — continuité, cockpit et profondeur opérateur

- **Slice** : `codex/live-trading-continuity-suite`
- **Date** : 2026-08-28
- **Autorité** : le backend décide ; le Front affiche, explique, navigue et transmet uniquement les commandes autorisées.
- **Sécurité** : AUTO OFF et broker physique OFF restent inchangés.
- **Statut** : implémentation terminée ; certification finale et publication VPS en cours.

## Résultat produit

Le Live n'est plus une page dont tout le contenu dépend du sélecteur du graphique. Il devient un cockpit continu organisé autour de quatre objets distincts : marché affiché, flux global de signaux, dossier de décision sélectionné et action Human Gate courante.

## Couverture des 20 évolutions du graphique

1. Instrument et timeframe modifiables sans recharger la page.
2. Conservation de la dernière série valide pendant le chargement.
3. État local de chargement, d'erreur et de fraîcheur.
4. Pan horizontal souris et clavier.
5. Zoom temporel centré sur le curseur.
6. Pan vertical explicite.
7. Zoom vertical explicite.
8. Retour à l'échelle prix automatique.
9. Plages rapides 24, 48 et 96 bougies.
10. Mode suivi du dernier prix ou inspection historique.
11. Reset complet du viewport.
12. Mini-navigateur de la plage réellement chargée.
13. Axe prix lisible avec marge contrôlée.
14. Axe temps lisible et borné.
15. Bougies OHLC, volume et VWAP.
16. Ligne du dernier prix.
17. Marqueurs issus de timestamps backend uniquement.
18. Zones entrée/stop/targets avec ratios R publiés.
19. Masquage sûr des plans hors instrument ou hors échelle.
20. Tableau accessible des bougies visibles et raccourcis documentés.

## Couverture des 50 évolutions Live Trading

Les 50 évolutions sont implémentées sous dix ensembles de cinq capacités :

1. **Continuité** : requête Desk stable, requête graphique locale, absence de skeleton global, conservation de la donnée précédente, état de transition explicite.
2. **Vérité** : aucun faux Risk, aucun faux Human Gate, aucune permission déduite, aucun niveau à zéro, état vide distinct d'indisponible.
3. **Flux global** : tous instruments, recherche, filtre instrument, filtre état, affichage progressif sans limite UI à six lignes.
4. **Lineage** : signal sélectionnable par ID, étape atteinte, liens vers le détail, affichage sur graphique, corrélation avec suivi théorique.
5. **Dossier** : identité du signal, cutoff source, étape canonique, plan proposé, plan post-Risk, avertissement si l'OrderIntent courant appartient à un autre signal.
6. **Décision** : Human Gate backend-driven, actions inchangées, statut commande séparé du broker, lecture seule post-Risk, navigation dossier canonique.
7. **Activité** : dock Position, Événements, Signaux, Qualité, Performance, Jarvis ; compteurs réels et mode agrandi.
8. **Lisibilité** : densité cockpit, hiérarchie primaire/secondaire, états sémantiques, tooltips utiles, données techniques reléguées au détail.
9. **Responsive** : hauteur courte scrollable, colonnes bornées, dock adaptable, contrôles tactiles, aucun fond bloquant.
10. **Accessibilité** : tablist clavier, tableaux, libellés d'axes, zones live, focus visible, réduction des mouvements.

## Couverture des 50 évolutions globales Desk

Les 50 évolutions sont implémentées sous dix ensembles de cinq capacités :

1. **Identité** : remplacement du « D », marque SVG, nom produit, lien accueil, libellé accessible.
2. **IA** : Surveiller, Décider, Améliorer, Exploiter, Système ; routes existantes conservées.
3. **Priorité opérateur** : Trading en direct, Décisions à traiter et Incidents rendus immédiatement accessibles.
4. **Palette** : Ctrl/Cmd+K, recherche, navigation clavier, Escape, restauration du focus.
5. **Honnêteté** : aucune fausse notification, aucun compteur inventé, aucun bouton métier local.
6. **Navigation mobile** : destinations explicites, labels courts, cibles tactiles, cohérence avec la sidebar.
7. **Responsive shell** : rail borné, marque compacte, palette adaptative, espaces sûrs, overflow maîtrisé.
8. **Cohérence visuelle** : tokens de surface, focus, états actifs, densité, contraste.
9. **Interconnexion** : routes stables, liens par identifiants, Human Gate global, Audit accessible, graphique indépendant.
10. **Robustesse** : état inconnu toléré, aucune dépendance provider directe, aucun accès DB front, cache BFF scoppé, tests de continuité.

## Limites backend explicites

- la projection globale actuelle est limitée côté backend ; une pagination/cursor est nécessaire au-delà de la fenêtre publiée ;
- Portfolio et Risk ne disposent pas toujours d'un timestamp d'étape assez précis pour un marqueur chart fiable ;
- les préférences de disposition ne sont pas encore persistées par session ;
- un endpoint BFF dédié à la seule série de marché réduira encore la taille réseau, sans changer le contrat métier.
- en attendant cette vue dédiée, le cache graphique possède une clé isolée, conserve la dernière série et effectue un polling borné à 15 secondes ; les événements métier ordinaires n'invalident plus le graphique.

Ces limites n'ont pas été compensées par des données locales ou des états inventés.

## Certification locale avant release

- Frontend : **221/221** tests verts, dont Golden Master Live, continuité chart/Desk, viewport, navigation, cache et scope BFF.
- Backend/BFF/PostgreSQL : **1194/1194** tests verts ; contrôle ciblé final Human Gate/Risk/lineage : **3/3** vert.
- Build production : **178 modules** générés sans erreur.
- QA visuelle : **5/5** viewports (desktop, laptop et mobile), sans overflow, masque bloquant ni champ post-Risk éditable.
- E2E non mutatif : **2 réussis, 1 ignoré** ; le scénario de commande exigeant un PIN administrateur n'a pas été exécuté et aucune commande Human Gate n'a été envoyée.
- Rulebook UI/UX : **1 000 règles valides** ; scan statique de **156 fichiers**, **0 erreur bloquante**, 606 avertissements heuristiques historiques.
- Accessibilité ciblée à froid : **8 audits**, **0 violation serious/critical**, **0 erreur runtime**.
- Migration 058 : ledger et checksum vérifiés, trois colonnes de lineage, trois clés étrangères `ON DELETE SET NULL` et trois index partiels valides.
- `git diff --check` et syntaxe du runner Axe : verts.

La certification Axe exhaustive des 76 routes, les 37 budgets de performance et les smokes directs seront rejoués contre la release réellement servie sur le VPS. Le précédent essai via le proxy local a été interrompu par l'instabilité d'authentification de l'ancienne release VPS ; il ne constitue donc pas une preuve de la nouvelle release.
