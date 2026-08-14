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

Aucune dérogation UI/UX n'est accordée par ce document.
