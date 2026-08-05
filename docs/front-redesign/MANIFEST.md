# Manifeste de redesign Front V2 — Claude décide, Codex exécute

## 1. Objet du manifeste

Ce document organise le passage du frontend Desk Futures vers une véritable version 2.

La séparation des responsabilités est stricte :

- **Claude est directeur de design**. Il audite, choisit et spécifie l'intégralité de l'expérience visuelle et ergonomique.
- **Codex est l'exécutant technique**. Il transforme ensuite la spécification de Claude en code React, TypeScript et CSS, sans réinventer le design.
- **Le produit existant reste la source de vérité métier**. Les contrats backend, données réelles, règles de sécurité et parcours critiques ne doivent pas être altérés par le redesign.

Claude dispose d'une grande liberté créative. Il peut repenser la navigation, la hiérarchie, la densité, les couleurs, la typographie, les composants, les tableaux, les graphiques, les formulaires, les espacements et l'organisation de chaque écran. Cette liberté s'arrête là où commencent les contrats métier et les règles de sécurité.

## 2. Documents d'entrée obligatoires

Claude doit lire intégralement, dans cet ordre :

1. `docs/front-redesign/MANIFEST.md` — présent contrat de mission ;
2. `docs/front-redesign/HANDOFF.md` — contexte produit, inventaire des 27 écrans et copie du code/CSS actuel ;
3. `docs/OPERATIONS_REPLAY_LAB_ARCHITECTURE.md` — architecture fonctionnelle Operations/Replay ;
4. le frontend local sur `http://localhost:8080` lorsqu'un navigateur ou un skill d'inspection est disponible.

Claude doit utiliser les skills frontend, UI, UX, design system et inspection navigateur disponibles dans son environnement. L'audit ne doit pas reposer uniquement sur une lecture abstraite du code si l'application locale est accessible.

## 3. Répartition des responsabilités

### Claude — responsable de toutes les décisions de design

Claude prend les décisions suivantes :

- direction artistique et niveau de densité ;
- architecture de l'information et regroupement de la navigation ;
- structure du shell desktop, tablette et mobile ;
- typographies, échelles, graisses et hauteurs de ligne ;
- palette complète et sémantique des couleurs ;
- grille, largeurs, hauteurs, espacements et alignements ;
- rayons, bordures, ombres, élévations et surfaces ;
- iconographie et règles d'utilisation ;
- composants, variantes et états ;
- organisation précise de chaque écran ;
- comportement des tableaux, timelines, graphiques et inspecteurs ;
- responsive à 320, 768, 1280 et 1600 px ;
- interactions, feedback, transitions et mouvement ;
- accessibilité visuelle, clavier et tactile ;
- ordre de migration des écrans et critères de validation visuelle.

Claude ne doit pas déléguer ces décisions à Codex avec des formulations comme « à ajuster », « selon le rendu », « choisir une couleur adaptée » ou « rendre plus moderne ».

### Codex — responsable de l'implémentation ultérieure

Codex sera chargé, dans un chantier séparé, de :

- traduire les décisions de Claude en composants React et styles ;
- préserver les API, hooks, routes et contrats existants ;
- restructurer le code si la spécification le demande ;
- exécuter TypeScript, tests React, E2E et recette Docker réelle ;
- remonter uniquement les impossibilités techniques ou conflits métier réels.

Codex ne doit pas être obligé de choisir une palette, une taille, une grille, un placement, un breakpoint, une variante de composant ou un comportement responsive manquant.

### Ce que Claude ne doit pas faire

Claude ne doit pas :

- écrire ou modifier du React, TypeScript, JavaScript, CSS, HTML ou SVG ;
- fournir un patch, un diff, une pull request ou un fichier de code ;
- remplacer les données réelles par des mocks ;
- modifier les contrats backend ou proposer des payloads incompatibles ;
- supprimer silencieusement un écran ou un parcours ;
- rendre une action sensible plus facile au prix de la sécurité ;
- transformer le frontend en terminal de trading ou ajouter une exécution broker ;
- repousser les choix esthétiques à Codex ;
- produire uniquement quelques maquettes conceptuelles sans couvrir les 27 écrans.

Les tableaux de tokens, mesures, règles et mappings sont attendus. Ils ne sont pas considérés comme du code d'implémentation.

## 4. Liberté créative et contraintes produit

### Liberté accordée

Claude peut notamment :

- remplacer complètement le thème visuel ;
- proposer une nouvelle identité de produit ;
- réorganiser la sidebar et la navigation mobile ;
- créer de nouveaux gabarits de page ;
- réduire, fusionner ou redistribuer les cartes ;
- rendre certains panneaux collants ou repliables ;
- transformer des listes en tableaux, matrices, timelines ou vues comparatives ;
- créer un système cohérent de densité normale/compacte ;
- changer les libellés de navigation s'ils restent compréhensibles ;
- proposer une visualisation différente pour le Replay Lab et les workflows ;
- reléguer les inspecteurs JSON au niveau diagnostic ;
- recommander des composants visuels ou bibliothèques, avec justification et impact.

### Contraintes non négociables

- Les 27 routes documentées restent fonctionnelles et directement accessibles.
- Les écrans profonds Workflow, Replay, Session et GPT restent de vrais écrans routés avec fil d'Ariane et retour.
- Une journée Replay accepte plusieurs sessions, variantes et tentatives.
- La timeline Replay reste zoomable et synchronisée avec le prix et les couches GPT/décision/étape.
- Les actions sensibles conservent révision, idempotence, justification et phrase de confirmation exacte.
- Setup théorique et position canonique restent clairement séparés.
- Aucun ordre broker n'est introduit.
- Les états vides, partiels, stale, loading, erreur et conflit de révision doivent être dessinés.
- Le frontend reste utilisable à 320 px sans débordement horizontal global.
- Aucun redesign ne doit dépendre d'un fournisseur cloud précis ou de la future migration VPS.

## 5. Méthode d'audit obligatoire

Avant de proposer la V2, Claude doit effectuer et restituer un audit fondé sur des preuves.

### Audit visuel

Pour chaque grande famille d'écrans, relever :

- problèmes de hiérarchie ;
- incohérences de composants ;
- densité trop faible ou trop forte ;
- problèmes de contraste et de lisibilité ;
- duplication de navigation ;
- alignements, espacements et rythmes incohérents ;
- usage excessif ou insuffisant des cartes ;
- tableaux et graphiques sous-exploités ;
- problèmes responsive ;
- éléments techniques trop visibles pour l'utilisateur principal.

### Audit d'architecture de l'information

Claude doit identifier :

- les objets métier principaux ;
- les relations entre Live, Operations, Replay, Performance, Historique et Gouvernance ;
- les destinations de premier niveau ;
- les sous-navigations contextuelles ;
- les écrans index, détail et diagnostic ;
- les informations qui doivent rester visibles pendant un drill-down ;
- les doublons ou ambiguïtés de vocabulaire.

### Audit de composants

Claude doit inventorier :

- composants réutilisables actuels ;
- composants à conserver, fusionner, remplacer ou supprimer ;
- variantes manquantes ;
- états manquants ;
- composants spécifiques nécessaires aux tableaux, timelines et graphiques ;
- styles globaux qui doivent devenir des tokens ou composants.

### Audit de flux

Claude doit parcourir au minimum :

1. Live → Master → Monitor → Thèse → Setup/Position ;
2. Operations → Workflow → Événement → Action confirmée ;
3. Replay → Journée → Session → Timeline → Processus GPT ;
4. Performance → Historique → Stratégie → Comparaison de versions.

## 6. Livrable attendu de Claude

Claude doit produire une seule spécification de design structurée, exhaustive et directement exécutable par Codex. Cette spécification peut être longue ; la complétude est prioritaire.

### D0 — Résumé exécutif

- diagnostic synthétique ;
- vision de la V2 en une phrase ;
- trois à cinq principes directeurs ;
- principaux changements par rapport à l'existant ;
- risques et hypothèses décidées.

### D1 — Audit détaillé

- constats par famille d'écrans ;
- constats de navigation ;
- constats design system ;
- constats responsive/accessibilité ;
- tableau `problème → conséquence → décision V2`.

### D2 — Direction artistique

- personnalité recherchée ;
- références ou familles d'inspiration expliquées sans copier ;
- mood, densité et niveau de contraste ;
- anti-références et effets à éviter ;
- règles de composition.

### D3 — Architecture de l'information

- navigation desktop complète ;
- navigation mobile complète ;
- groupes, libellés, ordre et icônes ;
- sous-navigation contextuelle ;
- comportement actif/replié ;
- règles de fil d'Ariane et de retour ;
- mapping des 27 routes vers la nouvelle navigation.

### D4 — Design system exact

La spécification doit fournir des valeurs exactes pour :

- palette et couleurs sémantiques, avec codes HEX ou OKLCH ;
- surfaces et élévations ;
- typographies, fontes de repli, tailles, graisses, tracking et line-height ;
- échelle d'espacement ;
- grilles et largeur maximale ;
- rayons, bordures et ombres ;
- tailles d'icônes ;
- hauteurs de boutons, champs, lignes de tableau et headers ;
- z-index ;
- breakpoints ;
- durées et courbes de mouvement ;
- densité desktop/tablette/mobile.

Les tokens doivent être organisés dans des tableaux nommés et ne laisser aucun choix implicite à Codex.

### D5 — Shell applicatif

Spécifier précisément :

- sidebar desktop ouverte et repliée ;
- header global ;
- contexte de session automatique ;
- zone d'alertes ;
- navigation mobile ;
- largeur/hauteur/padding/gap de chaque zone ;
- comportement au scroll ;
- comportement à chaque breakpoint ;
- focus clavier et zones tactiles.

### D6 — Bibliothèque de composants

Pour chaque composant, fournir :

- nom et responsabilité ;
- anatomie ;
- dimensions ;
- variantes ;
- états ;
- règles responsive ;
- contenu autorisé ;
- règles d'accessibilité ;
- composants actuels à remplacer ou fusionner.

Inclure au minimum : boutons, champs, selects, recherche, chips, tabs, breadcrumbs, badges de statut, métriques, cards/panels, tables, pagination/virtualisation, stepper, timeline, graphique Replay, inspecteur GPT, formulaire de confirmation, alertes, toasts, empty/error/loading states et inspecteur brut.

### D7 — Spécification des 27 écrans

Chaque écran doit posséder une fiche complète avec le format suivant :

1. route et nom ;
2. objectif utilisateur ;
3. information prioritaire ;
4. structure desktop de haut en bas ;
5. grille exacte, colonnes, largeurs, hauteurs minimales et espacements ;
6. structure tablette ;
7. structure mobile 320 px ;
8. composants et variantes utilisés ;
9. ordre et regroupement des données existantes ;
10. interactions et navigation ;
11. états loading/empty/error/stale/partial ;
12. actions disponibles et garde-fous ;
13. contenu ou composant actuel conservé, déplacé, fusionné ou supprimé ;
14. critères d'acceptation visuelle mesurables.

Les écrans les plus importants — `/live`, `/operations`, détail workflow, `/replay`, journée Replay, session Replay, inspecteur GPT et `/setup` — doivent être spécifiés au niveau le plus fin.

### D8 — Responsive, interaction et mouvement

- règles exactes pour 320, 768, 1280 et 1600 px ;
- priorités de masquage/recomposition ;
- comportement des tables sur mobile ;
- comportement des graphiques ;
- zones sticky ;
- navigation clavier ;
- focus ;
- feedback de mutation ;
- transitions, durées et easing ;
- préférence `prefers-reduced-motion`.

### D9 — Plan d'implémentation linéaire pour Codex

Le plan doit être découpé en lots ordonnés. Chaque lot indique :

- objectif ;
- fichiers/composants concernés ;
- décisions de design appliquées ;
- dépendances ;
- résultat visible attendu ;
- tests et largeurs à vérifier ;
- condition de sortie avant le lot suivant.

Codex doit pouvoir exécuter les lots dans l'ordre sans revenir demander une décision esthétique.

### D10 — Matrice de recette

Fournir une checklist finale :

- par route ;
- par breakpoint ;
- par état fonctionnel ;
- par parcours critique ;
- accessibilité ;
- cohérence visuelle ;
- absence de régression métier.

## 7. Niveau de précision exigé

### Formulations refusées

- « utiliser un bleu sombre moderne » ;
- « augmenter légèrement l'espacement » ;
- « faire une sidebar élégante » ;
- « adapter le tableau sur mobile » ;
- « choisir une police lisible » ;
- « ajouter une animation subtile » ;
- « Codex ajustera selon le rendu ».

### Formulations attendues

- « fond principal `#070A0F`, surface niveau 1 `#0E131B`, bordure `#202938` » ;
- « sidebar 264 px ouverte, 72 px repliée, padding horizontal 16 px » ;
- « ligne de tableau 44 px en densité compacte et 52 px en densité confortable » ;
- « sous 768 px, remplacer les colonnes secondaires par une ligne de métadonnées sous le titre » ;
- « titre de page 28/34 px, poids 650, tracking -0,02em » ;
- « transition d'ouverture 160 ms, cubic-bezier(...), désactivée avec reduced motion ».

Les valeurs ci-dessus illustrent le niveau de précision, pas la direction à adopter. Claude choisit ses propres valeurs et les assume.

## 8. Gestion des hypothèses

Claude a autorité pour trancher les choix de design. Lorsqu'une information manque :

1. il prend une hypothèse raisonnable ;
2. il la consigne dans un journal de décisions ;
3. il poursuit la spécification ;
4. il ne bloque pas la mission avec une série de questions esthétiques.

Seules les ambiguïtés qui changeraient une règle métier, une permission ou une action sensible doivent être signalées comme nécessitant une validation produit.

## 9. Definition of Ready pour Codex

La spécification de Claude est prête à être implémentée uniquement si :

- les 27 routes sont couvertes ;
- le shell et la navigation sont complètement définis ;
- tous les tokens ont une valeur exacte ;
- les composants et leurs états sont spécifiés ;
- les quatre breakpoints sont traités ;
- les parcours critiques sont couverts ;
- les actions sensibles restent conformes ;
- le plan d'implémentation est ordonné ;
- aucune décision visuelle importante n'est laissée à Codex ;
- aucun code d'implémentation n'a été produit à la place de la spécification.

## 10. Résultat attendu

À la fin du travail de Claude, Codex doit pouvoir prendre la spécification et exécuter le redesign écran après écran, composant après composant, avec une marge d'interprétation minimale. Claude livre la vision et toutes les décisions ; Codex livre ensuite le produit fonctionnel.
