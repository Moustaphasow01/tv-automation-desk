# Accueil et continuité de séance

## Périmètre et direction

Lot front isolé de `origin/main` 89f7b03. Le moteur, les contrats, les fournisseurs et le déploiement de l'autre agent ne sont pas modifiés.

- **Thèse :** commencer par ce qui demande une lecture ou une décision, puis garder le contexte jusqu'au résultat.
- **Monde :** extension du Focus validé, mode Operate, graphite, séparation par lignes, typographie système et chiffres tabulaires. Aucun décor ni nouvelle marque.
- **Parcours :** accueil → Live / Focus → signal → dossier d'exécution → position → retour au contexte d'origine.
- **Premier écran :** état du desk, accès Focus, décisions/positions/incidents publiés ; sur mobile, pas de mosaïque de supervision avant la tâche.
- **Forme :** listes de travail, résumé des termes et preuves ; références et supervision accessibles par divulgation progressive. Plan, déclaration et preuve courtier demeurent distincts.
- **Finition :** mêmes contrastes et états sur les écrans concernés ; cibles tactiles 44 px, reflow 320 px, clavier, capture bureau/mobile et panne simulée. Pas de mouvement décoratif.

## Placement et responsabilité

Propriétaire : `front-control-plane`, couche présentation. `features/command-center` compose uniquement la vue existante `command-center`. `features/trading-journey` porte le contexte de navigation et les primitives de lecture partagées par accueil, Live, signal, ordre et position. Les pages restent des points de composition ; les termes, compteurs et droits proviennent du BFF. Aucun agrégat financier officiel n'est calculé ici.

Alternatives écartées : cloner le moteur pour une API d'accueil, ajouter un deuxième routeur, recopier des ressources serveur dans le stockage local, remplacer toutes les pages de supervision. Le détail technique existant reste disponible ; les dossiers gardent des URL partageables.

## Contrat et traçabilité

| Besoin | Source existante | Présentation et état | Vérification |
| --- | --- | --- | --- |
| Préparer la séance | `command-center` : summary, risk, humanGate, incidents, market | Accueil hiérarchisé ; vide prouvé distinct de source absente | complet, partiel, nul, panne, mobile |
| Retour sans perte | URL Live/Focus et filtres autorisés | `returnTo` interne validé, pas d'URL externe ou imbriquée | URL hostile, historique, sélection conservée |
| Suivre une décision | `order-detail`, mapping existant | Plan/validation en premier, preuves et références repliables | identité, droits refusés, cycle de commande inchangé |
| Lire une position | `position-detail` | État, quantité, R, niveaux, ordres, chronologie | zéro distinct d'inconnu, identité et source |
| Focus / Live cohérents | projections et contrôles existants | accès direct au suivi, dossier complet visible, contexte préservé | clavier, ticket mobile, retour |

Règles appliquées avant code : UXR-0121–0160, 0281–0300, 0681–0700, 0781–0800, 0821–0840, 0921–0940. Lecture des contrats de page, blueprint, PRODUCT.md, DESIGN.md, spécifications Workspace et Mobile Priority. Tests automatiques et navigateur sur lectures réelles ; aucune commande financière envoyée au VPS. Chromium émulé ne vaut pas une recette physique iPhone/Android.

La priorité d'affichage n'est jamais une autorisation. Une ligne historique de validation ne devient pas « à décider » faute d'état canonique correspondant. La réception d'une projection ne certifie pas la fraîcheur de chaque flux marché.

## Compte rendu de fin — 9 septembre 2026

Statut : implémentation et vérifications locales terminées sur `codex/front-journey-20260909`, base `89f7b033b2466bbfe7d96a251ca68fd9889bfd27`. La référence du commit est portée par le document de livraison externe lié ci-dessous. Ce lot n'est ni fusionné dans `main` ni déployé. Le présent ajout conserve le contrat ci-dessus et documente le résultat ; il n'ouvre pas une nouvelle revue de design.

### Comportements livrés

| Surface | Résultat et responsabilité | Limite de portée |
| --- | --- | --- |
| Accueil | `DeskHome`, `HomeSections` et `homeModel` composent la projection réelle `command-center` : état, accès Focus, décisions, positions, incidents, marchés et dossiers récents. | Les valeurs absentes, partielles ou anciennes restent à vérifier. La supervision historique est conservée dans `CommandCenterSupervision`, chargée à la demande par `?view=supervision`. |
| Live mobile | Navigation Marché / Activité / Décision, conservée dans `livePanel`, avec instrument et période du graphique préservés. | La navigation ne change ni le scope autoritaire du desk ni les permissions. |
| Focus / Suivi | Dossiers visibles par lots de 12, preuves repliables, ticket vers dossier complet puis retour à l'URL Focus attendue et au ticket. | Pagination de présentation sur les lignes déjà publiées ; aucune pagination serveur ou nouvelle collecte historique. |
| Signal / ordre / position | Identité lisible, prix et termes prioritaires, résumé puis chronologie, références et preuves accessibles à la demande. Plan, validation humaine et preuve courtier restent distincts. | La position ouverte est vérifiée par un scénario contractuel local. Les listes de `OrdersPage` et `PortfolioPage` reçoivent seulement les liens de retour contextualisés. |

`features/trading-journey` est une capacité de présentation du module `front-control-plane`, consommée par l'accueil, Live/Focus et les dossiers. Elle porte les liens de retour internes, les sections de lecture, la provenance et la progression des listes. Les requêtes et l'état de commande du dossier d'ordre sont extraits dans `useOrderDossier`, sans modification du builder, du transport ou de l'autorité backend. Aucun calcul financier officiel, endpoint, permission, dépendance, asset structurant, ADR ou dérogation n'est ajouté.

### Contrôle du système visuel persistant

La documentation de fin applique Impeccable/document comme comparaison avec le système établi. Le chargement de contexte a échoué lors de sa tentative unique dans cette séance ; le contexte a été lu directement dans `PRODUCT.md`, `DESIGN.md`, les contrats de page, Workspace et Mobile Priority. Aucun nouveau chargement, détecteur, hook, navigateur ou rebuild n'a été lancé pour cette documentation.

- L'autorité locale est le Focus graphite validé, en mode Operate, et les contrats du 9 septembre. Cette extension part du code existant ; aucune nouvelle maquette approuvée ou `QUALITY BAR` n'est déclarée.
- Le lot réutilise les valeurs de `workspace.tokens.css`. Son changement étend les sélecteurs aux surfaces de parcours ; il ne remplace pas les valeurs de la palette. Les styles de parcours conservent la typographie système, les chiffres tabulaires, les séparations par lignes, le focus visible et les cibles mobiles de 44 px.
- Le pont vers le shell historique reste local aux surfaces de parcours. Ses surcharges de hauteur, débordement et mise à l'échelle doivent être préservées lors de l'intégration ; elles ne deviennent pas une règle globale de mise en page.
- Écart documentaire conservé : `DESIGN.md` décrit toujours le système historique bleu sombre et Inter, tandis que les contrats Workspace/Mobile Priority décrivent le graphite local et Segoe UI/système. Le fichier global n'utilise pas le frontmatter canonique du guide document et `.impeccable/design.json` était absent. Ce constat ne vaut pas autorisation de moderniser ces artefacts. `PRODUCT.md`, `DESIGN.md`, les tokens globaux et l'absence du sidecar sont préservés.

### Preuves finales et portée des contrôles

Le [rapport navigateur final](/mnt/c/Users/CES/Documents/Codex/2026-09-09/h/outputs/front-journey/review-fix-1/audit.json), daté du 9 septembre à 18:05:47 UTC, identifie le build compilé `index-GXsO3wbM.js`. Il contient sept parcours, 19 captures de page entière et les mesures de lecture des prix ; les 14 captures de viewport associées portent le corpus final à 33 images. Les fichiers référencés existent. Le principal et le relecteur ont ouvert ces 33 captures.

| Contrôle exécuté après les dernières corrections | Résultat | Portée de la preuve |
| --- | --- | --- |
| Tests frontend Vitest | 464 / 464 réussis dans 73 fichiers | [Rapport JSON](/mnt/c/Users/CES/Documents/Codex/2026-09-09/h/outputs/front-journey/tests.json). |
| TypeScript, ESLint ciblé, build de production | Code 0 ; ESLint sans avertissement ; Vite 5,43 s, 286 modules | Résultats relevés par l'agent principal ; lint sur les TS/TSX modifiés. |
| Guards frontend existants | Code 0 pour architecture de feature (100 fichiers du périmètre `live-desk`), isolation legacy (292 fichiers) et mode de données runtime | `check_front_feature_architecture.mjs`, `check_front_vnext_legacy_isolation.mjs`, `check_front_vnext_runtime_data_mode.mjs`. |
| Intégrité du diff | `git diff --check` réussi | Contrôle du principal, puis contrôle documentaire des deux fichiers de livraison. |
| Parcours navigateur | Sept parcours réussis ; aucun débordement de document, aucune erreur de page ni commande financière | Lectures du BFF déployé via aperçu local compilé ; seul le cas de position ouverte utilise une fixture contractuelle locale. Les trois HTTP 503 enregistrés sont volontaires pour la panne de l'accueil. |
| Accessibilité automatique | Huit scans sans violation retenue | Scopes des huit surfaces à 390 px ; tags `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`. Ce n'est pas une certification WCAG complète. |
| Relecture de finition | `disposition: ship` ; trois constats `resolved` | [Relecture finale](/mnt/c/Users/CES/Documents/Codex/2026-09-09/h/outputs/front-journey/RELECTURE_FINALE.md), limitée aux trois corrections, sans autorisation de déployer. |

Les trois corrections prouvées sont : zone d'entrée `729,50 – 730,00` entièrement lisible à 320 et 390 px ; entrée, stop et cible du signal et de l'ordre visibles à 390 × 844 avant la navigation située vers y = 758 ; vocabulaire opérateur en français et codes source conservés dans la traçabilité. À 320 × 640, le reflow et l'intégrité des valeurs sont vérifiés, mais tous les niveaux ne tiennent pas dans le premier écran.

Exemples du corpus final : [accueil mobile](/mnt/c/Users/CES/Documents/Codex/2026-09-09/h/outputs/front-journey/review-fix-1/home-390-viewport.png), [Suivi Focus mobile](/mnt/c/Users/CES/Documents/Codex/2026-09-09/h/outputs/front-journey/review-fix-1/focus-tracking-390-viewport.png), [ordre mobile](/mnt/c/Users/CES/Documents/Codex/2026-09-09/h/outputs/front-journey/review-fix-1/order-390-viewport.png), [signal mobile](/mnt/c/Users/CES/Documents/Codex/2026-09-09/h/outputs/front-journey/review-fix-1/signal-390-viewport.png), [position contractuelle](/mnt/c/Users/CES/Documents/Codex/2026-09-09/h/outputs/front-journey/review-fix-1/position-contract-390-viewport.png), [accueil en panne](/mnt/c/Users/CES/Documents/Codex/2026-09-09/h/outputs/front-journey/review-fix-1/home-outage-390-viewport.png).

Les répertoires `confirmation` et `confirmation-built`, les recaptures interrompues et le fichier résiduel `review-fix-1/failure.png`, absent du corpus final, ne sont pas des preuves de réussite finale. Le passage complet réussi via IPv4 les remplace sans nouvelle modification UI. Les scans UI/UX statiques antérieurs aux corrections et le détecteur Impeccable exécuté une seule fois sur `trading-journey` avant le dernier lot ne constituent pas une preuve globale actuelle.

### Dette mesurée et limites

| Point de composition | Avant | Après | Réduction de responsabilité |
| --- | ---: | ---: | --- |
| `CommandCenterPage.tsx` | 86 lignes | 11 lignes | Choix accueil/supervision ; la supervision fonctionnelle est extraite dans sa feature. |
| `OrderIntentDossierPage.tsx` | 193 lignes | 43 lignes | Composition ; requête/commande, résumé et preuves séparés. |

Ces mesures ne signifient pas une réduction du volume total de code. Les nouveaux fichiers de production écrits à la main restent sous 600 lignes ; le plus long ajouté dans `src` est `journey.css` avec 104 lignes. Aucun changement de baseline historique, ADR ou dérogation n'est créé par cette documentation.

La réponse signal examinée contient 100 éléments `existingPositions`, globaux ou historiques. Le libellé « Positions présentes dans la réponse » décrit cette portée sans prétendre prouver une exposition actuelle ou un lien causal au signal. Les limites de publication du BFF restent à traiter par leur propriétaire.

Non exécutés dans ce lot : Safari, appareil physique iPhone/Android, lecteur d'écran, exécution courtier, CI globale, recette de toute la stack et des données. Aucune mesure globale de performance, de conformité au rulebook ou de fermeture de la dette historique n'est revendiquée. Les règles du contrat initial restent la sélection d'implémentation ; le compte rendu suit en plus UXR-0862, 0875, 0880, 0980, 0994–0996 et 1000 pour la traçabilité et les limites.

### Intégration, observabilité et retour arrière

Le lot utilise exclusivement les projections et commandes existantes de `/front-api/v1`. Il ne change ni contrat API, ni migration SQL, ni autorité de trading, ni permission, ni activation LIVE/AUTO. Source, `asOf`, corrélation, identifiants et codes d'origine restent consultables. Un reçu de commande, une validation humaine ou un niveau de protection affiché ne devient jamais une preuve d'exécution courtier.

L'agent moteur a annoncé séparément les migrations additives 070 et 071 sur le VPS à 17:41 UTC, sans redémarrer le front courant `live-crypto-observation-20260909.3`, puis une recette de sidecar natif sans autorité d'ordre. C'est une information de coordination, pas une validation de ce lot moteur par la recette frontend. Lors de l'assemblage, conserver ces tables, leur ledger et leurs checksums ; aucun downgrade de base.

Avant intégration : reprendre le commit front indiqué dans la livraison, comparer les contrats réellement assemblés, refaire les contrôles ciblés si la résolution de conflits modifie le code, puis suivre le pipeline officiel et sa recette. Ce compte rendu ne fusionne ni ne déploie le lot. Après une future livraison, surveiller chargement des vues, erreurs, fraîcheur publiée, dossiers et retour de contexte ; aucun nouveau collecteur de télémétrie n'est ajouté ici.

Retour arrière du lot front : revert du commit front sur une branche d'intégration, ou retour à la release frontend précédente par la procédure officielle compatible avec l'état serveur courant. L'accès `?view=supervision` conserve l'ancien accueil détaillé ; `workspace=classic` reste le repli Focus existant. Ces accès ne retirent pas l'ensemble du lot. Aucun rollback des migrations 070/071 ni mutation des ledgers n'appartient au retour arrière frontend ; cette procédure n'a pas été exercée dans la recette locale.

Le [document de livraison réutilisable](/mnt/c/Users/CES/Documents/Codex/2026-09-09/h/outputs/FRONT_JOURNEY_LIVRAISON_2026-09-09.md) rassemble l'inventaire des fichiers, les preuves et les consignes pour l'assemblage ultérieur.
