# Architecture des écrans exportables

Chaque route React est séparée en deux couches :

1. `src/pages/<Nom>Page.tsx` connecte les données, le routeur, les overlays et les
   effets externes ;
2. `src/screens/<nom>/<Nom>Screen.tsx` rend l'interface à partir de props typées et
   expose les intentions utilisateur via des callbacks.

Un dossier d'écran exportable contient :

- le composant `*Screen.tsx` ;
- son contrat stable `*Screen.types.ts` ;
- ses styles locaux `*Screen.css` ;
- un `index.ts` d'exports publics ;
- un guide de passation `CLAUDE_DESIGN.md`.

Ainsi, un outil de design peut recevoir et rendre un seul dossier d'écran. Le
branchement backend et la route restent intacts dans `src/pages`.

Le Live Desk (`src/screens/live`) est l'implémentation de référence. Les autres
routes seront migrées vers cette convention écran par écran.
