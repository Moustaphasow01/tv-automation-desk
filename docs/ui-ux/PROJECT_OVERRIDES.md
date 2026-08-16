# Extensions projet du référentiel UI/UX

**Statut :** normatif pour l'intégration locale
**Référentiel parent :** UI/UX & Frontend Product Engineering Rulebook v1.0.0
**Date :** 2026-08-13

Ce document adapte l'usage du référentiel au Trading Desk sans modifier, renuméroter ni réinterpréter les règles `UXR-0001` à `UXR-1000`.

## Hiérarchie des sources

Le référentiel UI/UX est général. En cas de conflit, les sources de vérité propres au projet priment selon la hiérarchie déjà définie dans `docs/engineering/TRADING_DESK_ENGINEERING_STANDARDS.md` : sûreté broker, sécurité et protection des données, invariants trading/risk, contrats actifs, ADR acceptés, standards d'ingénierie, instructions agent et documentation produit/feature.

Le Rulebook complète ces sources sur l'UI, l'UX et l'ingénierie frontend. La règle compatible la plus stricte s'applique. Une divergence qui ne peut pas être résolue de cette manière exige une dérogation séparée, approuvée et datée ; elle ne modifie jamais un identifiant `UXR-XXXX`.

## Périmètre frontend canonique

- Nouvelle application : `apps/desk-control-plane/src`.
- Frontend historique de transition : `src`.
- BFF autoritaire : `/front-api/v1`.
- L'audit statique par défaut cible la nouvelle application. Toute tâche qui touche le frontend historique doit aussi auditer le chemin historique concerné.
- L'architecture locale reste `API DTO -> validation -> mapper -> ViewModel -> query/state -> feature -> primitive UI`, conformément aux standards du dépôt.

## Contrôles automatiques et preuves

- `npm run test:uiux-rules` valide le référentiel, le sélecteur et le scanner.
- `npm run audit:uiux` lance le scanner en mode strict et échoue sur ses détections P0.
- `npm run audit:uiux:report` produit seulement un rapport informatif JSON ; cette commande ne vaut ni conformité ni dérogation.
- La CI conserve le rapport informatif initial comme artefact pendant la résorption de l'existant. Le protocole agent maintient le contrôle strict obligatoire pour toute tâche frontend et interdit de déclarer Done avec une violation P0 applicable non couverte par une dérogation valide.
- Une réussite du scanner doit toujours être complétée par les contrôles manuels et dynamiques prévus dans le protocole.

## Baseline initiale

L'installation ne modifie aucun écran ni comportement métier. Le premier audit est donc enregistré comme état observé, pas comme état accepté. Les violations détectées restent ouvertes et doivent être traitées dans la roadmap frontend avant le gate de cutover.

## Dérogations

### OV-CC-001 — densité typographique du golden master Command Center

- **Règle concernée :** `UXR-0161`.
- **Périmètre strict :** `apps/desk-control-plane/src/features/command-center/command-center.css`, profil desktop workstation uniquement.
- **Décision produit source :** maquette et spécification Command Center explicitement approuvées comme référence normative le 2026-08-15 ; cette spécification impose une reproduction fidèle de la densité et prévaut sur le référentiel général pour ce rendu.
- **Écart borné :** microcopy, labels de statut, cellules compactes et métadonnées peuvent utiliser 6–9 px sur le golden master desktop. Le titre, les valeurs KPI et les informations décisionnelles principales restent au-dessus de ce seuil.
- **Compensations obligatoires :** contraste Axe sans blocker serious/critical, chiffres tabulaires, états non dépendants de la couleur seule, version responsive refluée, absence de clipping, zoom navigateur non neutralisé et détails accessibles par drill-down.
- **Preuves :** `reports/ui-ux/command-center/command-center-visual-qa.json`, `reports/ui-ux/front-v2-axe.json`, `design-qa.md`.
- **Expiration/révision :** à réexaminer si la maquette normative change, si une étude opérateur constate une difficulté de lecture, ou avant certification WCAG complète.

Cette dérogation ne désactive ni ne renumérote `UXR-0161`. Le scanner continue de publier les signaux correspondants afin qu'ils restent visibles. Elle n'autorise aucune taille inférieure à 10 px sur les autres écrans ni sur une nouvelle tranche sans décision séparée.

### OV-LT-001 — densité typographique du golden master Live Trading

- **Règle concernée :** `UXR-0161`.
- **Périmètre strict :** `apps/desk-control-plane/src/features/live-trading/live-trading.css`, profil desktop workstation uniquement.
- **Décision produit source :** maquette et spécification Live Trading approuvées comme référence normative le 2026-08-16 ; la grille 1 672 × 941, les treize panneaux simultanément visibles et leur hiérarchie imposent la densité observée.
- **Écart borné :** microcopy, métadonnées, entêtes de tableaux compacts, badges et légende lifecycle peuvent utiliser 5–9 px sur le golden master desktop. Le titre, la recherche et les termes opérateur critiques gardent un niveau supérieur ; les actions Human Gate conservent une cible d'au moins 32 px.
- **Compensations obligatoires :** reflow mobile dédié, zoom navigateur non neutralisé, résumé textuel du chart, états exprimés par texte et pas uniquement par couleur, focus visible, détails par navigation, absence de clipping et audit Axe sans blocker serious/critical.
- **Preuves :** `reports/ui-ux/live-trading/live-trading-visual-qa.json`, `reports/ui-ux/front-v2-axe.json`, `docs/front-redesign/LIVE_TRADING_VNEXT_VISUAL_QA.md`.
- **Expiration/révision :** à réexaminer après test opérateur de lisibilité, changement de maquette ou avant certification WCAG complète.

Cette dérogation ne désactive ni ne renumérote `UXR-0161`. Les détections restent dans le rapport statique ; toute autre règle P0 demeure bloquante.
