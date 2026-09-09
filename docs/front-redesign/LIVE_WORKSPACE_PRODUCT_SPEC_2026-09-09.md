# Poste de séance — refonte Live Focus

Statut : premier lot implémenté et vérifié en local, pilote explicite `workspace=next`, pas de déploiement VPS. Recette opérateur requise avant bascule.

## Contrat produit

Permettre à un opérateur de suivre plusieurs marchés, repérer les décisions en attente, examiner un ticket et consigner sa décision sans perdre les graphiques ni son contexte. La demande du 9 septembre remplace la composition visuelle précédente, pas les invariants d'exécution.

Questions principales : quels marchés changent ? Quelle donnée date de quand ? Ai-je une décision à prendre ? Quel est le plan autorisé ? Quelles positions sont suivies et sur quelle preuve ?

## Audit de départ

Captures neuves du VPS du 9 septembre, release `grains-m5-continuity-20260908.2`, 48 dossiers exposés. Le contrôle technique existant passe ses 10 formats et Axe, mais n'évalue pas la qualité de la hiérarchie.

1. Live Focus desktop 1440×900 : environ 350 px de bandeaux avant le travail, historique expiré occupant le centre, niveaux répétés dans chaque ticket, graphique derrière un overlay.
2. Live Focus mobile 390×844 : presque le premier écran entier pour l'identité et les statistiques ; décision et marché trop éloignés.
3. Journal : une fiche longue par dossier, signaux diagnostiques mélangés au parcours de lecture, comparaison difficile.
4. Graphique : un scope unique, rendu SVG artisanal, interaction distincte du poste de séance.

Forces conservées : plans en lecture seule, véritables projections, états d'absence, identifiants canoniques, séparation des marchés et des décisions (ADR-0029), commandes idempotentes.

## Direction et contre-revue

Poste compact de marché : bandeau de séance, liste multi-actifs, graphiques toujours visibles, carnet opérationnel en bas, ticket sélectionné à droite. Le vide de décision reste un état de veille ; aucun ancien ordre n'est proposé par défaut.

La signature est la continuité marché → ticket, avec des graphiques indépendants de la sélection du dossier. Pas de décor imitant un terminal : couleurs réservées à la sélection, au sens et aux exceptions ; pas de faux ticker animé.

Palette sémantique locale : graphite `#111820`, surface `#17212b`, séparation `#354350`, texte `#edf2f6`, secondaire `#a6b5c3`, sélection `#91b8f8`. Hausse `#7cc9a6`, baisse `#ed999a`, vigilance `#e8c283`. Typographie de travail Segoe UI Variable / Segoe UI / système ; données Consolas / SFMono avec chiffres tabulaires. Corps 13–14 px, labels 12 px minimum, prix 24 px ; les titres restent modestes.

Contre-revue : une nouvelle grille de grandes cartes aurait reproduit le problème. Le carnet est une liste comparative compacte ; les comptes détaillés et la prose sont accessibles à la demande. Le mobile n'empile pas la workstation : Marchés, Tickets et Suivi, avec inspection d'un ticket dans un dialogue natif.

## Placement et traçabilité

Propriétaire : `front-control-plane`, feature `live-trading/workspace`. Couche présentation et état de query. Consommateur : route Live existante avec `focus=1&workspace=next`.

| Besoin | Autorité existante | Présentation / interaction | Preuve prévue |
| --- | --- | --- | --- |
| Suivre plusieurs actifs | `live-trading.marketSeries`, `watchlist` | 1, 2 ou 4 graphiques ; sélection de marché indépendante | tests scopes, navigateur, resize |
| Repérer les décisions | `live-focus.tradeCards` | file active, suivi, historique distincts ; nouveaux tickets annoncés sans déplacement forcé | tests états, sélection stable |
| Comprendre le ticket | plan autorisé, `whyThisTrade`, parcours existant | panneau sélectionné et détails à la demande | identité, null, terminal, mobile |
| Autoriser/refuser/consigner | actions publiées, builders et transport existants | confirmation avec objet, environnement, révision et reçu suivi | droits refusés, réseau, commande locale interceptée |
| Lire la séance | `session`, brief, catalysts, synthèse officielle | statut compact, contexte et résultats accessibles | données réelles, absence, langue |
| Percevoir l'actualisation | flux existant, asOf et nouvelles valeurs | dernière réception, âge, variation brièvement soulignée | reconnexion et mise à jour contrôlées |

Aucun nouveau calcul officiel, endpoint, schéma SQL, permission, activation AUTO ou connexion broker. Les graphiques utilisent les seules bougies reçues du BFF. Une absence n'est jamais convertie en zéro. Un changement d'instrument ne sélectionne jamais un ticket.

## Règles retenues avant code

UXR-0041–0060 (contrat), 0101–0120 (profondeur), 0121–0160 (layout/reflow), 0161–0200 (typo/contraste), 0281–0300 (clavier), 0381–0400 (dialogues), 0421–0460 (listes/graphiques), 0481–0500 (états), 0541–0560 (langage), 0681–0700 (temps réel), 0921–0940 (trading). Tests ciblés P0 : identité, autorité, fraîcheur, refus, confirmation et parcours de retour.

## Acceptation et limites

Build, typecheck, tests frontend, lint ciblé, guards VNext et audit UXR. Captures et interactions desktop/laptop/tablette/mobile 320 px ; Axe, clavier et perte de connexion. Les tests de commandes utilisent un transport isolé ; aucune confirmation de trading sur le VPS pendant l'audit.

Rollback immédiat du pilote : retirer `workspace=next` de l'URL. L'ancien Focus reste disponible. La refonte de recherche, d'administration et de tout le produit hors parcours de séance reste un lot ultérieur.

## Décisions prises pendant la vérification

- Le catalogue des instruments disponibles inclut des archives. Le poste ouvre les instruments du périmètre publié, puis propose l'ajout explicite d'autres marchés. La liste de surveillance dispose d'un défilement dédié ; elle ne déplace plus les tickets sous plusieurs écrans de contenu.
- Sans ticket sélectionné, les marchés occupent toute la largeur utile. Le panneau de décision apparaît à la sélection ou à l'arrivée d'une décision active ; une longue fiche vide ne monopolise pas l'écran de veille.
- Une cotation ancienne n'est pas présentée comme le prix de la dernière bougie. Le dernier prix publié utilisable ou la clôture reçue sont identifiés ; aucune variation n'est recalculée. Le classement ne s'active qu'avec des variations publiées et disponibles.
- Les plans proposés ne déclenchent pas une autorisation. Identité du ticket, instrument, compte connu, plan autorisé lisible, actions permises et révision sont obligatoires. Les enveloppes de décision doivent être complètes, non périmées et générées depuis moins de 120 secondes (tolérance d'horloge future de 30 secondes).
- Le dialogue conserve le plan et le compte effectivement présentés au moment de son ouverture. Changement de plan, quantité, compte, expiration, révision ou sélection : nouvelle relecture obligatoire. Les trois vues d'autorité sont relues avant l'envoi. Quitter le poste pendant cette vérification annule l'envoi.
- Le reçu de commande reste lié au ticket d'origine, même après une autre sélection. Reçu, traitement terminé et exécution courtier sont distingués. Un résultat réseau incertain n'est jamais répété automatiquement.
- Une décision humaine refusée ne clôture pas un suivi théorique encore ouvert. Une annulation de décision reste conditionnée à l'action explicitement publiée pour cette ressource.
- Le rendu graphique conserve la fenêtre temporelle pendant une lecture historique, y compris lors de l'arrivée tardive de bougies. Le mode figé affiche les changements reçus sans modifier l'image lue et suspend les décisions.

## Compatibilité et dette

La route et les contrats BFF existants restent inchangés. Aucun code de calcul financier, endpoint, schéma, droit d'accès ou paramètre d'exécution n'est ajouté. Les anciens écrans restent le chemin par défaut ; le pilote est chargé à la demande.

`LiveTradingPage.tsx` passe de 320 à 305 lignes par extraction des requêtes et de la composition du modèle dans `useLiveTradingProjection.ts`. Le fichier historique `LiveFocusMode.tsx` n'est pas modifié. Les composants du nouveau poste sont répartis par responsabilité, sans nouveau fichier de production de plus de 600 lignes.

Le pont CSS vers l'ancien shell annule sa mise à l'échelle et rétablit une colonne pleine largeur en Focus, notamment au seuil 1024 px. Les `!important` restants sont limités à ce pont hérité et à la préférence système de réduction du mouvement. Le reste de la cascade utilise des tokens et des sélecteurs de faible spécificité. Ces exceptions ne sont pas un mécanisme de mise à l'échelle responsive du nouveau poste.

## Priorités après ce premier lot

Vérification finale du 9 septembre : 66 fichiers / 384 tests frontend réussis, types et build réussis, guards frontend réussis. Audit navigateur local : 10 formats, 8 groupes d'interactions, aucune erreur JavaScript ni réseau lors du dernier passage, aucune violation Axe dans les 3 états inspectés, aucune commande de trading envoyée. Une réponse 503 ponctuelle a été observée lors du passage précédent. Le guard global de dette backend reste en échec hors périmètre ; il n'a pas été assoupli.

1. Recette opérateur de la séance et des parcours actifs sur environnement d'essai autorisé avant toute bascule VPS.
2. Qualité de publication : noms de stratégies, fraîcheur, sources partielles, contrat d'abonnement au marché plus léger que les vues complètes actuelles. Le front ne fabrique pas les informations manquantes.
3. Préférences persistantes de watchlist et d'agencement, alertes opérateur configurables, comparaison des suivis théoriques et des exécutions déclarées.
4. Extension de la même hiérarchie produit aux dossiers complets, ordres, positions et autres écrans du desk. Validation Safari/iOS réelle et recette avec lecteurs d'écran.
