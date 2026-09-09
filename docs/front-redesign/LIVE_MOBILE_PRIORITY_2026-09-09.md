# Live et Focus — usage mobile prioritaire

## Contrat d’écran

L’utilisateur doit pouvoir choisir un marché avant le graphique, voir un seul graphique sur téléphone et retrouver le nouveau ticket qui requiert son attention. Il peut observer librement sans ticket. Un ticket reçu ne doit ni modifier une saisie ni autoriser une opération.

Le bureau conserve sa grille indépendante. Live présente la séance dans son ensemble ; Focus permet de lire le ticket et de décider. Les fonctions historiques et les dossiers ne sont pas supprimés, mais accessibles à la demande.

## Direction

Extension du monde existant, mode Operate. Graphite `#111820`, surface `#17212b`, texte `#edf2f6`, secondaire `#a6b5c3`, accent `#91b8f8`. Typographie système pour l’interface, nombres tabulaires pour les prix. Pas de nouvelle police, de raster décoratif, de faux tick ou d’animation de marché.

La signature de cette adaptation est le passage du marché surveillé au ticket reçu sans empiler les écrans de la workstation. Le sélecteur natif est privilégié sur téléphone. La couleur signale une sélection ou un état réel, pas un décor.

## Traçabilité

| Besoin | Source / responsabilité | Interaction et preuve |
| --- | --- | --- |
| Marchés avant le graphique | Catalogue `marketSeries.supportedInstruments`, groupes locaux | Accès directs, sélecteur, liste ; tests de position DOM et de taille tactile |
| Un graphique mobile | Préférence bureau préservée | Un seul slot visible, actualisation dédiée inactive pour les autres, identité du premier slot préservée à la rotation |
| Ticket prioritaire | `live-focus.tradeCards`, dates et statut publiés | File par identité canonique, navigation atomique ticket/signal/marché, annonce et retour au marché précédent |
| Pas de vol de contexte | Saisie, dialogue, pause, inspection, état de commande | Mise en attente ; aucune commande ni permission créée par la navigation |
| Live plus lisible | `live-trading` | Marché et activité, détails progressifs, contexte et liens Focus |
| Cryptos futures | Courtier / produit de marché à préciser | Pas de fausse intégration ni d’activation moteur |

## États et règles retenues

UXR-0141–0160 (reflow réel), 0581–0600 (mobile, cibles 44 px, orientation), 0681–0700 (fraîcheur, déduplication, sauvegarde du contexte) et 0921–0940 (vérité, protection des décisions). Une création non datée, invalide ou dans le futur au-delà de la tolérance d’horloge, une expiration absente ou dépassée, ou une projection ancienne ne permettent pas de basculement automatique. Les tickets expirés ne sont pas remis en avant comme des opportunités actuelles.

Les commandes existantes conservent la relecture des autorités, l’identité compte/ticket, la révision, l’idempotence, la confirmation et la distinction reçu/exécution. Les critères d’affichage du front ne deviennent jamais des critères d’autorisation.

## Limites et recette

Une recette physique iPhone/Android reste nécessaire ; Chromium redimensionné ne la remplace pas. Les données sont des bougies reçues, pas un flux tick par tick. Les scénarios synthétiques de nouveaux tickets sont confinés au navigateur de test local et ne sont jamais injectés sur le VPS.

Le chargement de contexte Impeccable n’était pas disponible dans l’installation ; PRODUCT.md, DESIGN.md, les spécifications et les captures existantes ont été lus directement. Les guides Impeccable/adapt et polish, frontend-design et responsive-design ont orienté la conservation de l’identité et l’adaptation structurelle. Le guide accessibility-fix a conduit à rétablir la palette prévue face aux styles historiques et à rendre la bande OHLC navigable au clavier ; les quatre états ciblés passent ensuite le contrôle Axe. DESIGN.md n’a pas été réécrit hors demande.

Les preuves de tests, captures et livraison accompagnent le compte rendu de cette évolution. Aucune activation réelle d’exécution et aucun changement du moteur ne font partie de ce lot front.
