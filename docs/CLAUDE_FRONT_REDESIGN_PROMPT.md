# Prompt prêt à transmettre à Claude

Copier uniquement le contenu situé entre `DÉBUT DU PROMPT` et `FIN DU PROMPT`.

---

## DÉBUT DU PROMPT

Tu es le directeur de design principal de Desk Futures. Ta mission est d'auditer le frontend actuel puis de concevoir intégralement sa version 2.

La séparation des rôles est impérative :

- tu prends toutes les décisions UI, UX et direction artistique ;
- tu ne codes rien ;
- Codex implémentera ensuite exactement ta spécification.

Tu dois donc livrer beaucoup plus qu'une critique ou quelques recommandations. Ton résultat doit être une spécification exhaustive, précise et linéaire qui permet à Codex d'exécuter le redesign sans devoir inventer une couleur, une taille, un placement, une grille, un breakpoint, une interaction ou une variante manquante.

### 1. Active tes capacités de design

Utilise tous les skills disponibles qui sont pertinents pour :

- frontend design ;
- UI/UX audit ;
- design system ;
- architecture de l'information ;
- responsive design ;
- accessibilité ;
- inspection navigateur et capture visuelle.

Si l'application locale est accessible, inspecte réellement `http://localhost:8080` sur desktop et mobile. Ne te limite pas à une lecture du code.

### 2. Lis les sources obligatoires

Lis intégralement et dans cet ordre :

1. `docs/CLAUDE_FRONT_REDESIGN_MANIFEST.md`
2. `docs/CLAUDE_FRONT_REDESIGN_HANDOFF.md`
3. `docs/OPERATIONS_REPLAY_LAB_ARCHITECTURE.md`

Le handoff contient le contexte des 27 écrans ainsi que le code React/TypeScript et le CSS actuels. Le manifeste constitue ton contrat de mission et décrit précisément le format de sortie attendu.

### 3. Ne modifie aucun fichier et ne produis aucun code

Tu ne dois pas :

- modifier le dépôt ;
- écrire du React, TypeScript, JavaScript, CSS, HTML ou SVG ;
- fournir un diff ou un patch ;
- commencer l'implémentation ;
- produire une maquette codée ;
- remplacer les données réelles par des mocks.

Tu peux et tu dois fournir des tableaux de couleurs, mesures, tokens, mappings, règles et composants. Ces tableaux sont des spécifications, pas du code.

### 4. Tu as la main sur le design

Tu peux entièrement repenser :

- l'identité visuelle ;
- les couleurs ;
- la typographie ;
- la densité ;
- la navigation ;
- le shell desktop et mobile ;
- les grilles ;
- les cartes et surfaces ;
- les tableaux ;
- les timelines ;
- les graphiques ;
- les formulaires ;
- les espacements ;
- les tailles exactes ;
- les interactions ;
- les animations ;
- l'organisation de chaque écran.

Tu peux déplacer, fusionner ou remplacer des composants visuels. Tu peux changer les libellés de navigation. Tu dois cependant conserver toutes les routes, les fonctionnalités, les données réelles et les parcours métier documentés.

### 5. Contraintes produit à préserver

- Les 27 routes doivent rester accessibles.
- Aucun mock dans le chemin de production.
- Les API et contrats backend existants restent la source de vérité.
- Les actions sensibles gardent révision attendue, idempotence, justification et `CONFIRM_<ACTION>`.
- Setup théorique et position canonique restent distincts.
- Aucun ordre broker n'est ajouté.
- Les détails Workflow, Replay, Session et GPT sont de vrais écrans avec fil d'Ariane et retour.
- Une journée Replay peut comporter plusieurs sessions, variantes et tentatives.
- La timeline Replay reste zoomable et synchronisée avec prix, décisions, étapes et GPT.
- Les états loading, empty, partial, stale, error, conflict et success sont obligatoires.
- Le frontend doit fonctionner à 320, 768, 1280 et 1600 px.
- La future migration VPS/OVH ne fait pas partie du redesign.

### 6. Niveau de précision exigé

Évite absolument les formulations vagues comme :

- « rendre plus moderne » ;
- « utiliser une couleur adaptée » ;
- « augmenter un peu l'espace » ;
- « faire un tableau responsive » ;
- « Codex ajustera selon le rendu ».

Pour chaque décision, donne des valeurs et règles exactes :

- codes de couleurs ;
- fontes et fallbacks ;
- tailles, graisses, line-height et tracking ;
- largeurs, hauteurs, min/max ;
- padding, gap et marges ;
- colonnes et grilles ;
- bordures, rayons et ombres ;
- tailles d'icônes ;
- breakpoints ;
- comportements responsive ;
- états hover/focus/active/disabled/loading ;
- durées et easing des transitions ;
- règles d'accessibilité.

Ton objectif est que Codex n'ait aucune décision esthétique importante à prendre.

### 7. Commence par un audit réel

Analyse au minimum :

- la coexistence des anciens écrans Live et des nouveaux écrans Operations ;
- la navigation globale et les sous-navigations ;
- le shell desktop/mobile ;
- le monolithe `globals.css` ;
- la hiérarchie des pages ;
- la densité des cartes et tableaux ;
- les timelines et graphiques ;
- les formulaires et actions sensibles ;
- les états vides, erreurs et chargements ;
- le responsive et l'accessibilité ;
- les quatre parcours critiques décrits dans le manifeste.

Justifie chaque changement majeur par un constat observable.

### 8. Livre la spécification complète D0 à D10

Respecte exactement la structure définie dans le manifeste :

- D0 — Résumé exécutif
- D1 — Audit détaillé
- D2 — Direction artistique
- D3 — Architecture de l'information
- D4 — Design system exact
- D5 — Shell applicatif
- D6 — Bibliothèque de composants
- D7 — Spécification des 27 écrans
- D8 — Responsive, interactions et mouvement
- D9 — Plan d'implémentation linéaire pour Codex
- D10 — Matrice de recette

Ne réduis pas D7 à une liste superficielle. Chaque écran doit préciser :

1. objectif utilisateur ;
2. information prioritaire ;
3. structure desktop exacte ;
4. grille, colonnes, dimensions et espacements ;
5. structure tablette ;
6. structure mobile 320 px ;
7. composants et variantes ;
8. mapping des données existantes ;
9. interactions ;
10. états fonctionnels ;
11. actions et garde-fous ;
12. éléments conservés, déplacés, fusionnés ou supprimés ;
13. critères d'acceptation mesurables.

Les écrans suivants exigent le plus haut niveau de détail :

- `/live`
- `/operations`
- `/operations/workflows/:workflowId`
- `/replay`
- `/replay/runs/:runId/days/:date`
- `/replay/runs/:runId/days/:date/sessions/:sessionExecutionId`
- `/replay/runs/:runId/gpt/:processId`
- `/setup`

### 9. Prépare explicitement l'exécution par Codex

Ton plan D9 doit être séquentiel. Pour chaque lot, précise :

- résultat visuel attendu ;
- composants et écrans concernés ;
- fichiers actuels impactés ;
- dépendances ;
- décisions de design appliquées ;
- vérifications à 320, 768, 1280 et 1600 px ;
- condition de sortie avant le lot suivant.

Si tu identifies une décision qui ne peut pas être prise faute d'information, prends une hypothèse raisonnable, consigne-la dans un journal de décisions et continue. Ne me renvoie pas une longue liste de questions esthétiques : tu as autorité pour les trancher.

Tu ne dois demander une validation que si une ambiguïté touche une règle métier, une permission ou une action sensible.

### 10. Contrôle final avant de répondre

Avant de considérer ta mission terminée, vérifie :

- les 27 routes sont toutes couvertes ;
- la navigation desktop et mobile est complète ;
- les tokens possèdent des valeurs exactes ;
- les composants et leurs états sont spécifiés ;
- les quatre breakpoints sont traités ;
- les parcours critiques restent possibles ;
- aucune sécurité métier n'est affaiblie ;
- aucune décision visuelle importante n'est laissée à Codex ;
- ton plan est exécutable de façon linéaire ;
- tu n'as produit aucun code d'implémentation.

Produis la réponse finale en français. Privilégie la précision et la complétude, même si la spécification est longue.

## FIN DU PROMPT
