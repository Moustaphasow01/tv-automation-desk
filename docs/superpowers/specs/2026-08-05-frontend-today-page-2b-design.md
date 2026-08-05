# Page "Aujourd'hui" — chantier 2b (les 5 onglets restants) — Design

Statut : validé par l'opérateur le 2026-08-05.
Reprend `docs/superpowers/specs/2026-08-05-frontend-today-page-design.md`
(vision, structure héros/Exécution/onglets) et le mécanisme prouvé par le
chantier 2a (composant de présentation + conteneur de données par onglet,
voir `docs/superpowers/plans/2026-08-05-frontend-today-page-2a.md`). Ce
document ne couvre que les décisions nouvelles nécessaires pour ajouter les
5 onglets restants : Master, Monitors, Risque (News), Journal (Timeline),
Sessions.

## 1. Décision : sort de la zone Activité

`LiveDeskScreen.tsx` a aujourd'hui une section Activité qui mélange trois
choses : le journal (Timeline compact), le flux d'activité des workers
(`ActivityCard`) et un repli qualité des données (`AuditMini`). Le journal
complet devient l'onglet Timeline ; `ActivityCard` et `AuditMini` n'ont pas
d'équivalent dans les pages migrées.

**Décision (option B)** : `ActivityCard` et `AuditMini` restent une petite
zone toujours visible, distincte du panneau d'onglets — ni supprimés
(option A), ni fusionnés dans le contenu de l'onglet (option C).

Conséquence de nommage : l'onglet qui absorbe le contenu de
`TimelinePage.tsx` s'appelle **Journal**, pas "Activité" — pour ne pas avoir
deux choses appelées "Activité" en même temps (l'onglet et la zone toujours
visible).

## 2. Correspondance onglets → anciennes pages (mise à jour)

| Onglet | Contenu | Ancienne page |
|---|---|---|
| Lecture | Thèse active complète (déjà fait, chantier 2a) | `/thesis` |
| **Master** | Document Master complet (sommaire de chapitres, rail de niveaux, playbooks) | `/master` |
| **Monitors** | Historique complet avec sélecteur parmi les monitors de la session | `/monitors` |
| **Risque** | Agenda macro/news complet | `/news` |
| **Journal** | Journal de décision complet, avec recherche et zoom historique | `/timeline` |
| **Sessions** | Phases de marché (Asia/London/NY) + contexte Asia/NY | `/sessions` |

Onglet par défaut inchangé : **Lecture**.

## 3. Nav interne F1-F6 → F1-F5

Constat déjà signalé lors de la revue du chantier 2a : l'ordre visuel réel
de la page (Décision → Marché → Exécution → panneau d'onglets → Activité)
ne correspondait plus à l'ordre des raccourcis F1-F6 (qui listait encore
Lecture avant Exécution). Puisque Risque disparaît comme section propre et
qu'Activité rétrécit, ce chantier corrige la nav interne en même temps :

| Raccourci | Section | Ancre |
|---|---|---|
| F1 | Décision | `live-decision` |
| F2 | Marché | `live-market` |
| F3 | Exécution | `live-execution` |
| F4 | Analyse *(nouveau libellé générique — couvre les 6 onglets)* | `live-thesis` *(id inchangé)* |
| F5 | Activité *(zone réduite : ActivityCard + AuditMini uniquement)* | `live-activity` |

Le raccourci "Risque" est retiré (son contenu vit désormais dans le panneau
d'onglets, plus dans une section défilante séparée).

## 4. Détails par onglet

- **Master** : conserve sa mise en page à deux colonnes (contenu + rail de
  sommaire/niveaux/playbooks) telle quelle à l'intérieur du panneau
  d'onglet — pas de simplification en une colonne, le document reste long
  et le sommaire garde sa valeur de navigation interne.
- **Monitors** : conserve son sélecteur parmi les monitors de la session
  (`useState` local pour l'index sélectionné) exactement comme aujourd'hui.
- **Risque (News)** : contenu identique à `NewsPage.tsx`, y compris le
  défilement automatique vers le prochain événement macro.
- **Journal (Timeline)** : contenu identique à `TimelinePage.tsx`, y
  compris la recherche et le zoom historique (slider de profondeur).
- **Sessions** : contenu identique à `SessionsPage.tsx`. Le lien "Voir dans
  Live Desk →" de `SessionContextCard` (qui pointait vers `/live` depuis une
  page séparée) est retiré : redondant maintenant qu'on est déjà sur `/live`.

## 5. Routage et redirections (extension du chantier 2a)

- Nouvelles routes : `/live/master`, `/live/monitors`, `/live/news`,
  `/live/timeline`, `/live/sessions` — toutes via la même route générique
  `/live/:tab` déjà en place (aucune modification de `App.tsx` nécessaire
  au-delà des redirections ci-dessous).
- `/master`, `/monitors`, `/news`, `/timeline`, `/sessions` deviennent des
  redirections pures vers leur `/live/<onglet>` respectif, sur le modèle de
  `/thesis`→`/live/thesis` du chantier 2a.
- `/alerts` reste hors périmètre (déjà décidé au chantier 2, à réévaluer
  après usage réel).

## 6. Navigation et fil d'Ariane

- `src/navigation.ts` : les items `todayItems` pour Master, Monitors, News,
  Timeline, Sessions pointent directement vers leurs routes `/live/<tab>`
  (plus de saut de redirection), sur le modèle du chantier 2a pour Thèse.
- `src/components/OperatorNavigationTrail.tsx` : `liveTabLabels` reçoit les
  5 entrées manquantes (`master`, `monitors`, `news`, `timeline`,
  `sessions`) avec leurs libellés métier (« Analyse initiale », « Suivis »,
  « Agenda & actualités », « Journal », « Phases de marché »).

## 7. Hors périmètre

- `/alerts` (inchangé, cf. §5).
- Tout habillage visuel nouveau : palette, typographie, densité restent
  celles du chantier 1, non rouvertes.
- Le parcours Replay (chantier 3).
