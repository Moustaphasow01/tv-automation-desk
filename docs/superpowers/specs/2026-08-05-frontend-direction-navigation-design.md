# Direction générale & navigation — redesign front V2 (chantier 1/3)

Statut : validé par l'opérateur le 2026-08-05.
Chantier : le premier des trois identifiés pour le redesign front pendant
l'indisponibilité de Codex (crédits épuisés jusqu'au 8 août). Les deux
suivants sont l'écran Live ("Aujourd'hui") et le parcours Replay ; ils
reprendront intégralement les décisions de ce document.

## 1. Constat de départ

Le front fonctionnel est terminé (voir `docs/FRONT_SCREEN_STATUS_REVIEW.md`),
mais :

- la navigation expose la tuyauterie interne (Master, Monitor, Thèse, Setup,
  Timeline sont des pages séparées) plutôt que des destinations orientées
  utilisateur ;
- les écrans ressemblent à un empilement de cartes/tableaux plutôt qu'à un
  cockpit qui répond directement à « où on en est, quel a été le dernier
  move, quel est le prochain, quel est le résultat actuel » ;
- les composants (ex. `LiveDeskScreen.tsx`) ne sont pas tous responsive en
  interne ;
- des états bruts du backend (`TRIGGERED`, `UNKNOWN`,
  `CANONICAL_TRIGGER_DATA_MISSING`, `MAJOR_EVENT_ENTRY_BLOCK`...) peuvent
  fuiter tels quels dans l'interface au lieu d'être traduits.

## 2. Vision

Un cockpit orienté résultats : on voit en un coup d'œil où en est le desk,
quel a été son dernier move, quel est le prochain, et quel est le résultat
actuel — sans devoir reconstituer l'histoire en sautant d'écran en écran.

## 3. Principes directeurs

1. **Usage perso en priorité.** Pas de vitrine commerciale pour l'instant ;
   optimiser pour le trading quotidien de l'opérateur, pas pour impressionner
   un client.
2. **Esprit terminal opérateur, pas dashboard SaaS.** Dense, sombre, les
   chiffres en avant. Référence : Bloomberg/TradingView, pas Linear/Vercel.
3. **Aucun état brut du backend ne s'affiche jamais tel quel.** Chaque état
   a une traduction française assumée, définie une seule fois dans un
   dictionnaire central — jamais retraduite localement écran par écran
   (le code actuel a plusieurs fonctions `xxxLabel` redondantes, ex.
   `LiveDeskScreen.tsx`).
4. **Les chiffres qui engagent de l'argent ou du risque gardent toujours le
   même poids visuel.** Entrée, stop, objectif, R : jamais relégués en
   petite légende secondaire.
5. **Le vocabulaire métier existant est conservé.** Master, Monitor, Setup,
   Position, Checkpoint restent tels quels : c'est déjà la langue du desk,
   pas du jargon d'implémentation.

## 4. Système visuel

### 4.1 Couleurs

| Rôle | Valeur | Usage |
|---|---|---|
| Canvas | `#05070A` | fond de page |
| Surface 1 | `#0C1017` | en-têtes, cellules de métriques, lignes |
| Surface 2 | `#131924` | états hover/actifs |
| Ligne / bordure | `#232C3A` | séparateurs, bordures de carte |
| Texte principal | `#EEF2F7` | valeurs, titres |
| Texte atténué | `#8B95A5` | labels — jamais une simple opacité, une vraie couleur pour rester lisible en petite taille |
| Texte discret | `#5B6472` | métadonnées (timestamps, compteurs) |
| Positif | `#22D67C` (fond `rgba(34,214,124,0.14)`) | R positif, objectif, statut favorable |
| Négatif | `#FF4D4F` (fond `rgba(255,77,79,0.14)`) | stop, R négatif, statut défavorable |
| Alerte | `#F5A623` (fond `rgba(245,166,35,0.14)`) | gate en attente, donnée manquante, action requise |
| Accent navigation | `#2FD0E0` | sélection, navigation active — jamais utilisé pour un statut de trade, pour ne jamais le confondre avec un résultat |

### 4.2 Typographie

- Chiffres et données (prix, R, pourcentages, timestamps) : monospace
  (`"SF Mono", Consolas, monospace`), `font-variant-numeric: tabular-nums`.
- Labels, titres, texte courant : `-apple-system, "Segoe UI", sans-serif`.
- Labels de métriques : 9,5–10px, majuscules, `letter-spacing: 0.05em`,
  couleur texte atténué.
- Valeurs de métriques : 15–17px, `font-weight: 700`.
- Valeurs héros (carte trade) : 17px, `font-weight: 800`.

### 4.3 Densité

Densité compacte par défaut (esprit terminal) : cellules de métriques
9px de padding vertical, lignes de statut 7-8px de padding. Pas de mode
confortable séparé pour ce chantier — à réévaluer si un écran spécifique
le justifie (ex. lecture longue dans l'historique).

### 4.4 Patterns de composants

**Carte trade (3 colonnes Entrée / Stop / Objectif)**

- Même taille de chiffre pour les trois colonnes — aucune hiérarchie
  cachée entre elles.
- Stop toujours en rouge (`--neg`), objectif toujours en vert (`--pos`),
  entrée neutre (texte principal).
- Chaque colonne affiche aussi la distance en points et le ratio
  risque/récompense, pour éviter tout calcul mental.
- **Position réellement engagée (déclenchée)** : bordure gauche épaisse
  colorée (`--pos`/`--neg` selon le sens), badge de statut saturé.
- **Setup théorique (pas encore déclenché)** : même mise en page et même
  taille de chiffres, mais bordure et badge en accent neutre avec le
  libellé « Conditionnel » — la couleur signale l'absence d'argent engagé,
  jamais une réduction de lisibilité des chiffres.

**Lignes de statut / journal**

- Fond `--surf1`, bordure gauche de 2px transparente par défaut, colorée
  (`--pos`/`--warn`) quand la ligne mérite l'attention.
- Statut affiché en "chip" (texte + fond teinté), jamais en texte coloré
  seul, pour rester repérable dans une grille dense.

**Bandeau de métriques**

- Cellules à largeur égale, séparées par une bordure verticale `--line`,
  label au-dessus de la valeur.

### 4.5 Règle de contenu (copie)

- Le desk est en français : tout le texte visible par l'opérateur est en
  français, y compris les statuts.
- Aucun enum ou état brut du backend n'apparaît jamais à l'écran. Exemples
  de traduction obligatoire :

  | Brut backend | Texte produit |
  |---|---|
  | `TRIGGERED` | Déclenché |
  | `UNKNOWN` | En attente de donnée |
  | `MAJOR_EVENT_ENTRY_BLOCK` | Confirmation événement macro majeur |
  | `CANONICAL_TRIGGER_DATA_MISSING` | Donnée de déclenchement manquante |

  Cette liste n'est pas exhaustive : chaque nouvel état rencontré pendant
  les chantiers suivants (Live, Replay) doit être ajouté au même
  dictionnaire central, jamais traduit localement dans un composant.
- Vocabulaire métier conservé tel quel : Master, Monitor, Setup, Position,
  Checkpoint, Thèse, Replay.

## 5. Navigation

### 5.1 Constat

La navigation actuelle compte 12 entrées de premier niveau (`/live`,
`/sessions`, `/master`, `/monitors`, `/thesis`, `/setup`, `/timeline`,
`/news`, `/audit`, `/alerts`, `/performance`, `/operations`, `/replay`,
`/history`, `/strategies`, plus `/more`), plus les sous-écrans d'Operations
et de Replay. Plusieurs de ces entrées (`Master`, `Monitors`, `Thèse`,
`Setup`, `Timeline`, `News`, `Alertes`) sont en réalité des facettes d'un
seul état — celui du Live — pas des destinations indépendantes.

### 5.2 Structure cible : 5 destinations

| Destination | Contenu |
|---|---|
| **Aujourd'hui** | Fusionne Live, Master, Monitors, Thèse, Setup, Timeline, News, Alertes en une seule page à sections ancrées (repose sur la nav interne déjà existante du Live : Décision · Marché · Lecture · Exécution · Risque · Activité). Détail complet dans le chantier suivant. |
| **Résultats** | Performance (calendrier + analyse) et Historique des sessions. |
| **Replay** | Inchangé — déjà bien structuré selon `docs/FRONT_SCREEN_STATUS_REVIEW.md`. Detail dans le chantier 3. |
| **Opérations** | Workflows, incidents, notifications, runbooks, observabilité, console d'exécution, claim lanes — inchangé dans sa portée fonctionnelle, revu visuellement plus tard. |
| **Système** | Stratégies (registre, versions) et Audit/gouvernance. |

### 5.3 Contraintes respectées

- Les 27 routes documentées restent toutes accessibles (aucune suppression
  de fonctionnalité), conformément à `docs/front-redesign/MANIFEST.md`. Les
  URLs actuelles `/master`, `/monitors`, `/thesis`, `/setup`, `/timeline`,
  `/news`, `/alerts` ne disparaissent pas : elles redirigent vers `/live`
  avec l'ancre de section correspondante (ex. `/setup` → `/live#live-execution`),
  pour rester bookmarkables et compatibles avec un lien externe existant.
  Seule la navigation principale (sidebar/menu) n'affiche plus ces sept
  entrées séparément.
- L'accès rapide à Setup/Position pendant le trading reste possible en un
  clic via l'ancre de section « Exécution » de la page Aujourd'hui, comme
  c'est déjà le cas avec la nav interne actuelle du Live (raccourcis
  `F1`–`F6`).

## 6. Décisions prises par hypothèse raisonnable

- Traitement visuel identique (même taille de chiffres) entre setup
  théorique et position réelle, seule la couleur/le badge changent — validé
  implicitement par l'approbation du principe 4 ci-dessus.
- Densité compacte unique pour ce chantier, pas de mode confortable
  alternatif — à rouvrir si un écran ultérieur le justifie.

## 7. Hors périmètre de ce chantier

- Le détail complet de la page « Aujourd'hui » (contenu de chaque section,
  responsive 320/768/1280/1600px, états vides/erreur/chargement) : chantier
  suivant.
- Le parcours Replay (journée, session, timeline zoomable, comparaison) :
  troisième chantier.
- Operations, Performance, Stratégies : reverront leur habillage visuel
  plus tard, en réutilisant ce système sans le remettre en question.
- Le passage en production sur le VPS : décision de déploiement séparée,
  hors sujet de cette spec.

## 8. Suite

Ce document sert de fondation aux chantiers suivants :

1. Page « Aujourd'hui » (redesign complet de `src/screens/live/`).
2. Parcours Replay.

Chaque chantier suivant reprend telle quelle la palette, la typographie,
les patterns de composants et la règle de contenu définis ici, et n'a pas à
les rouvrir sauf découverte d'un cas non couvert.
