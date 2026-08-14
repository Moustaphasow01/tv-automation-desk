# Desk Control Plane V2 — Design Direction

## Direction

Le V2 conserve le monde visuel validé du desk : une console opérateur compacte, sombre, dense et calme. La hiérarchie vient des contrastes de surface, des bordures, de la grille et des états, pas de grandes cartes décoratives ni de polices surdimensionnées.

## Principes

- **Exceptions d'abord** : la première lecture répond à « que dois-je regarder ou faire maintenant ? ».
- **Global → zoom** : les listes et KPI ouvrent une route de détail dédiée ; aucun panneau de détail permanent ne vole l'espace de la vue globale.
- **Vérité visible** : source, fraîcheur, indisponibilité et périmètre sont perceptibles sans ouvrir l'audit.
- **Action vérifiable** : une commande affiche sa progression, son résultat terminal et son reçu.
- **Densité lisible** : la compacité repose sur une grille précise, pas sur du texte inférieur au seuil lisible.

## Tokens canoniques

```yaml
color:
  canvas: "#03070e"
  sidebar: "#030a13"
  surface: "#071522"
  surfaceRaised: "#0a1b2b"
  border: "#15304b"
  borderSubtle: "#10243a"
  textPrimary: "#e8f2ff"
  textSecondary: "#8fa8c3"
  textMuted: "#6f879f"
  accent: "#1477f2"
  success: "#16d990"
  warning: "#ff9d2e"
  danger: "#ff4d5e"
  information: "#33a2ff"
type:
  family: "Inter, ui-sans-serif, system-ui, sans-serif"
  pageTitle: "22px/26px 700"
  metric: "24px/28px 700"
  body: "12px/16px 400"
  label: "11px/14px 600"
  table: "11px/14px 400"
space:
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 20px
  6: 24px
radius:
  control: 7px
  card: 8px
  modal: 12px
layout:
  sidebar: 196px
  topbar: 64px
  footer: 32px
  pagePadding: 16px
  gridGap: 10px
```

## Comportements

- Hover discret : variation de bordure/surface, sans translation spectaculaire.
- Focus : anneau visible et contrasté, jamais supprimé.
- Motion : 120–180 ms pour transitions de contrôle ; respect de `prefers-reduced-motion`.
- Loading : squelette structurel qui conserve la géométrie finale.
- Empty : explique un vide réellement observé et propose la prochaine action seulement si elle existe.
- Unavailable/stale/partial : affichage explicite, jamais transformé en zéro.
- Tables : en-tête fixe lorsque nécessaire, tri annoncé, pagination réelle, priorité aux colonnes métier.
- Responsive : navigation mobile complète via drawer ; tables adaptatives ou scroll horizontal signalé, jamais tronqué silencieusement.

## Référence de fidélité

La page Portefeuille validée sert de référence de densité et de placement : sidebar 196 px, topbar 64 px, footer 32 px, contenu 16 px, six KPI sur une ligne au format workstation et deux rangées compactes de panneaux. Les tests de régression utilisent un viewport logique fixe et masquent uniquement les zones réellement dynamiques.
