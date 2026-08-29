# Recette — Actionnabilité, navigation et mise à jour du Front VNext

Date : 2026-08-29  
Branche : `codex/front-actionability-navigation-20260829`  
Baseline : `6cfaba57f5804c8f44bcffb9541b3474ccaefc08`

## Périmètre livré

- Les décisions Live utilisent désormais cinq états opérateur uniques : `À prendre`, `En cours d’évaluation`, `Surveillé`, `Expiré`, `Refusé`.
- `À prendre` n’est jamais déduit du seul statut : il exige une projection fraîche, une action `CONFIRM` publiée par le backend, une permission Human Gate `ALLOWED` et une fenêtre non expirée.
- Le Live présente l’état opérateur comme information primaire, avec filtres, recherche et pagination URL.
- Le compteur Human Gate alimente le titre, le favicon et les accès navigation sans inventer de valeur lorsque la projection est partielle.
- La navigation est issue d’un registre canonique et propose les modes déployé, compact et masqué sur tous les écrans ; le choix est mémorisé et le mobile conserve une seule navigation.
- Les actions directes non sûres de la liste Décisions ont été supprimées. Toute action sensible reste portée par le dossier canonique et ses capacités backend.
- Les projections partielles Risque, Décisions et Fournisseurs ne provoquent plus de crash et ne produisent plus de faux zéros autoritaires.
- Le service worker est versionné par build, sert la navigation en `network-first`, ne met jamais les API en cache et purge uniquement ses anciens caches. Le build est visible et un bandeau annonce une nouvelle version.

## Sécurité métier

- Aucun calcul Risk, quantité, niveau d’ordre ou permission n’est ajouté au frontend.
- `AUTO_EXECUTION` et `LIVE` ne sont pas activés.
- `CONFIRM`, `ACK` et `FILL` restent des états distincts.
- Une action dont la permission backend n’est pas `ALLOWED` est refusée par le constructeur de commande.

## Règles UI/UX appliquées

Sélection principale : UXR-0049, UXR-0057, UXR-0058, UXR-0081, UXR-0082, UXR-0085, UXR-0141, UXR-0142, UXR-0146, UXR-0159, UXR-0181, UXR-0183, UXR-0184, UXR-0199, UXR-0272, UXR-0282, UXR-0361, UXR-0362, UXR-0407, UXR-0411, UXR-0413, UXR-0422, UXR-0423, UXR-0432, UXR-0440, UXR-0445, UXR-0456, UXR-0457, UXR-0602, UXR-0603, UXR-0621, UXR-0662, UXR-0663, UXR-0664, UXR-0665, UXR-0666, UXR-0667, UXR-0668, UXR-0669, UXR-0670, UXR-0821, UXR-0823, UXR-0824, UXR-0830, UXR-0831, UXR-0832, UXR-0833, UXR-0840, UXR-0921, UXR-0922, UXR-0926, UXR-0928, UXR-0930, UXR-0939, UXR-0940, UXR-0941, UXR-0942, UXR-0946, UXR-0947, UXR-0957, UXR-0959, UXR-0960, UXR-0968, UXR-0985, UXR-0989, UXR-0995, UXR-0997 et UXR-1000.

## Preuves exécutées

- Tests frontend : 53 fichiers, 266 tests réussis.
- Build TypeScript/Vite : réussi.
- Axe ciblé : 10 audits, 0 violation `serious`/`critical`, 0 erreur runtime.
- Recette visuelle Live : 5 scénarios sur 5 (1672×941, 1440×900, 1280×800, 390×844, 430×932).
- Guards architecture, données réelles et isolation legacy : réussis.
- Rulebook : 1 000 règles séquentielles valides ; sélecteur et scanner auto-testés.
- Audit statique UI/UX : 0 erreur, avertissements heuristiques existants conservés comme dette informative.

## Réserves

- Le scanner statique est heuristique : il ne prouve pas à lui seul la conformité aux 1 000 règles.
- Les compteurs ne s’affichent que lorsque le BFF publie un nombre réel ; une projection partielle reste honnêtement sans compteur.
- Les actions Human Gate vivantes devront encore être recettées avec une véritable fenêtre backend ouverte ; aucune capacité n’a été simulée pour les besoins du test.
- L’unification complète des anciens tokens par écran reste un chantier de fond distinct ; elle n’a pas été mélangée à ce correctif P0.
