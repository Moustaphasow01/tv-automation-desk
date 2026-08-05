# Page « Aujourd'hui » — fusion des facettes du Live (chantier 2/3)

Statut : validé par l'opérateur le 2026-08-05.
Chantier : le deuxième des trois identifiés pour le redesign front pendant
l'indisponibilité de Codex. Reprend intégralement les décisions de
`docs/superpowers/specs/2026-08-05-frontend-direction-navigation-design.md`
(palette, typographie, densité, règle de contenu, carte trade
Entrée/Stop/Objectifs) sans les rouvrir.

## 1. Constat de départ

`src/screens/live/LiveDeskScreen.tsx` a déjà une nav interne à 6 sections
(Décision · Marché · Lecture · Exécution · Risque · Activité), mais celles-ci
montrent des **versions résumées** : `ThesisSummary` pour la thèse,
`SetupCard`/`PositionCard` pour l'exécution, `MacroNewsCard` pour le risque,
`ActivityCard`/`Timeline` compact pour l'activité. Les versions complètes
vivent séparément sur `/master`, `/monitors`, `/thesis`, `/timeline`,
`/news`, `/sessions`, `/alerts` — sept pages qu'il faut visiter une par une
pour reconstituer la situation complète.

Deux de ces pages ont un contenu substantiel qui empêche une simple
concaténation à plat :

- `MasterPage.tsx` est un document long avec sommaire de chapitres
  (`data.master.sections.map(...)`, nombre variable), rail latéral de
  niveaux et playbooks.
- `MonitorsPage.tsx` a un sélecteur parmi tous les monitors passés de la
  session, chacun avec son propre appel de détail (`useMonitorDetail`).

`SetupPage.tsx` contient en plus le **panneau de commandes opérateur réel**
(`OperatorCommandPanel`) : annulation de setup, confirmation de trigger,
déplacement au break-even, sortie de position, demande de replan — chacune
avec authentification, révision attendue, clé d'idempotence et phrase de
confirmation exacte. C'est la zone la plus sensible de toute l'application.

## 2. Décision validée : héros + zone d'action fixe + onglets

Trois options ont été comparées (fusion à plat, héros+accordéon,
héros+onglets). Fusionner à plat recrée le problème de départ dans une
seule page trop longue au lieu de plusieurs pages ; l'accordéon et les
onglets restent compacts par défaut. L'opérateur a choisi **héros + onglets**.

### Structure retenue

1. **Héros** (toujours visible, en haut) — où en est le desk, dernier move,
   résultat actuel. Remplace/enrichit l'actuelle section Décision.
2. **Marché** (toujours visible, inchangé) — `MarketTable` telle quelle.
3. **Exécution — Setup & Position** (toujours visible, contenu complet) —
   absorbe l'intégralité de l'ancien `/setup`, y compris
   `OperatorCommandPanel`. Aucune simplification de la sécurité : révision,
   idempotence et phrase de confirmation restent obligatoires et
   inchangées.
4. **Onglets** pour le reste, avec correspondance directe vers les
   anciennes pages :

   | Onglet | Contenu | Ancienne page |
   |---|---|---|
   | Lecture | Thèse active complète | `/thesis` |
   | Master | Document Master complet | `/master` |
   | Monitors | Historique complet + sélecteur | `/monitors` |
   | Risque | Agenda macro/news complet | `/news` |
   | Activité | Journal/timeline complet | `/timeline` |
   | Sessions | Phases de marché | `/sessions` |

   Onglet actif par défaut : **Lecture**.

`/alerts` (alertes de session) n'a pas d'onglet dédié dans cette première
version : son contenu est déjà couvert par le composant `AuditMini`/journal
existant dans la section Activité. Si l'opérateur constate en usage réel
qu'il lui manque une vue dédiée, un onglet Alertes sera ajouté au chantier
suivant plutôt que d'être anticipé ici sans preuve d'usage.

## 3. Routage et redirections

- Nouvelles routes imbriquées sous `/live` par segment de chemin, cohérent
  avec le reste de l'application (`/operations/workflows/:workflowId`,
  `/replay/runs/:runId/days/:date`) plutôt qu'un paramètre de requête :
  `/live/thesis`, `/live/master`, `/live/monitors`, `/live/news`,
  `/live/timeline`, `/live/sessions`. `/live` seul redirige vers
  `/live/thesis` (l'onglet par défaut).
- Les anciennes routes `/master`, `/monitors`, `/thesis`, `/timeline`,
  `/news`, `/sessions` redirigent vers leur route `/live/<onglet>`
  correspondante. Un lien externe, une notification ou un runbook qui
  pointe vers `/master` atterrit donc directement sur l'onglet Master
  pré-sélectionné, pas sur l'onglet par défaut.
- `/setup` redirige vers `/live#live-execution` (l'ancre de section
  `live-execution` existe déjà dans `LiveDeskScreen.tsx` pour la nav interne
  F1-F6) : la page atterrit avec un défilement automatique vers la zone
  Exécution toujours visible, plutôt qu'en haut de page. L'exécution n'est
  pas un onglet séparé, donc pas de segment de chemin dédié — seulement
  cette ancre.
- `/alerts` reste une route à part entière pour l'instant (pas absorbée
  dans les onglets, voir §2) ; elle n'est pas redirigée.
- Chaque route `/live/<onglet>` reste bookmarkable et fonctionne après un
  rafraîchissement de page (l'onglet actif vient de l'URL, pas d'un état
  React local perdu au reload).

## 4. Chargement des données par onglet

Chaque onglet correspond aujourd'hui à son propre hook de détail
(`useMasterDetail`, `useMonitorDetail`, `useThesisDetail` +
`useThesisConditionsDetail`, etc.). Pour éviter de déclencher les six
requêtes au chargement de la page alors qu'un seul onglet est visible à la
fois, chaque onglet ne déclenche sa requête de détail que lorsqu'il devient
actif (chargement paresseux à l'activation), pas au montage de la page.
Une fois un onglet visité pendant la session du navigateur, son contenu
reste en cache React Query normal — revenir dessus ne redéclenche pas la
requête avant l'intervalle de rafraîchissement habituel.

## 5. Structure de fichiers

Suit le pattern déjà établi par `src/screens/live/` (séparation
Page/Screen, un dossier d'écran par composant de présentation) :

- `src/screens/live/LiveDeskScreen.tsx` — accueille désormais le héros,
  Marché, Exécution et le conteneur d'onglets ; ne fait plus que
  l'agencement, chaque onglet est un composant importé.
- `src/screens/live/tabs/ThesisTab.tsx`, `MasterTab.tsx`,
  `MonitorsTab.tsx`, `NewsTab.tsx`, `TimelineTab.tsx`, `SessionsTab.tsx` —
  un fichier par onglet, chacun reprenant le contenu JSX de l'ancienne page
  correspondante, adapté pour recevoir ses données en props plutôt que de
  faire son propre routage.
- Les fichiers `src/pages/MasterPage.tsx`, `MonitorsPage.tsx`,
  `ThesisPage.tsx`, `TimelinePage.tsx`, `NewsPage.tsx`, `SessionsPage.tsx`,
  `SetupPage.tsx` deviennent de simples composants de redirection (voir
  §3) ; leur logique métier est déplacée dans les fichiers de `tabs/`
  ci-dessus ou directement dans `LiveDeskScreen.tsx` pour Setup/Position.

## 6. Système visuel (hérité, non rouvert)

Palette, typographie, densité, règle de contenu (aucun état brut du
backend, dictionnaire centralisé) et traitement de la carte trade
Entrée/Stop/Objectifs suivent exactement
`docs/superpowers/specs/2026-08-05-frontend-direction-navigation-design.md`
§4. La barre d'onglets reprend le même principe visuel que la nav de
sections F1-F6 déjà présente (pilules horizontales, défilement sans
troncature à 320 px, pas de nouveau token de couleur).

## 7. Contraintes non négociables (rappel du manifeste)

- Setup/Position conserve révision, idempotence, justification et phrase
  de confirmation exacte — aucune option de ce chantier ne les simplifie
  ni ne les rend plus faciles à déclencher par erreur.
- Les états vides, partiels, en chargement, en erreur et de conflit de
  révision restent dessinés pour chaque onglet et pour la zone Exécution.
- Le frontend reste utilisable à 320, 768, 1280 et 1600 px sans
  débordement horizontal global.
- Aucun ordre broker n'est introduit ; aucune donnée réelle n'est
  remplacée par un mock.

## 8. Hors périmètre de ce chantier

- Le parcours Replay (chantier 3).
- Un onglet dédié pour `/alerts` (à réévaluer après usage réel, voir §2).
- L'habillage visuel d'Operations, Performance, Stratégies.
- Le passage en production sur le VPS.

## 9. Suite

Après ce chantier, `/live` est la page de référence pour le pattern
héros + zone d'action fixe + onglets. Le chantier 3 (Replay) peut réutiliser
la même barre d'onglets et le même principe de chargement paresseux si son
propre contenu (journée, session, comparaison) s'y prête.
