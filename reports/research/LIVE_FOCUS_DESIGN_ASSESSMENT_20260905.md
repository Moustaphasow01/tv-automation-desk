# Assessment A — Live Focus — 2026-09-05

Mode : Operate. Revue de design non ancrée, lecture seule. Cible réelle identifiée : route hash `#/live`, `apps/desk-control-plane/src/pages/LiveTradingPage.tsx`, composée principalement par `apps/desk-control-plane/src/features/live-trading/LiveFocusMode.tsx` et `live-focus.css`. Aucun contrôle broker, gate ou commande n’a été exécuté.

## Limites d’observation

L’inspection navigateur in-app n’a pas pu démarrer : le runtime Browser a rejeté le workspace avec `sandboxCwd is not a local file URI: file:///mnt/c/users/ces/desktop/tv_automation`. Il n’y a donc pas de capture visuelle, de mesure de viewport, ni de confirmation du rendu réel à 100 %. Le jugement visuel ci-dessous vient du JSX/CSS et des contrats de route ; les états de données visibles n’ont pas été inventés. Le parent a déjà exécuté `context.mjs`, conformément à la consigne, et il n’a pas été relancé.

## Verdict de spécificité produit

L’interface est nettement écrite pour un desk de trading opérateur : états A–F, Human Gate, dossier post-Risk, distinction signal/ordre, horloge New York, raccourcis de clavier, journal et file de tickets. Elle n’est donc pas une simple dashboard interchangeable.

Elle donne toutefois une impression de « vibecode » par accumulation : halos radiaux, grille de fond, cartes arrondies, badges et micro-labels concurrencent la décision centrale. La personnalité métier est présente dans le contenu mais moins dans la hiérarchie visuelle. Le bon axe est une réduction éditoriale, pas une refonte décorative : conserver la console sombre, le rail de tickets et les preuves backend, puis faire dominer une seule décision à la fois.

## Santé heuristique

| # | Heuristique | Score /4 | Observation |
|---|---|---:|---|
| 1 | Visibilité de l’état système | 3 | États Focus, compte à rebours, fraîcheur et statut backend sont explicites ; trop de signaux d’état sont simultanément affichés. |
| 2 | Correspondance système / monde réel | 3 | Vocabulaire desk, session CBOT/New York, post-Risk et Human Gate cohérents ; « ticket » et « dossier » changent parfois de niveau conceptuel. |
| 3 | Contrôle et liberté | 3 | Retour, Esc, drawers, refus, copie et navigation clavier sont présents ; la densité de panneaux rend le retour mental coûteux. |
| 4 | Cohérence et standards | 2 | Les composants partagent tokens et états, mais le mélange de pills, cartes 14–20 px, halos et micro-typographie manque d’une grammaire stricte. |
| 5 | Prévention des erreurs | 4 | Les actions viennent des capabilities backend, le dossier historique est non actionnable, et le message « ne pas poser » est adapté au risque opérateur. |
| 6 | Reconnaissance plutôt que rappel | 3 | Les libellés « Où en suis-je ? », pipeline et plan rendent la décision reconnaissable ; la file longue impose encore de mémoriser quel ticket est sélectionné. |
| 7 | Flexibilité et efficacité | 3 | Raccourcis ↑↓/G/C/R/S/Entrée et sélection de ticket sont solides ; la visibilité des raccourcis dépend du footer et du panneau d’aide. |
| 8 | Esthétique et minimalisme | 2 | La direction sombre compacte est appropriée, mais le fond quadrillé, les gradients, les ombres et les cartes empilent du bruit visuel. |
| 9 | Aide à la récupération | 3 | Erreurs, stale, expiré, absence de données et drawer de preuves sont prévus ; les états dégradés pourraient être regroupés dans une bande unique. |
| 10 | Aide et documentation | 2 | Aide raccourcis et microcopy existent ; aucune explication persistante du parcours signal → contexte → portefeuille → gate n’est visible sans ouvrir le brief. |
| **Total** |  | **28/40** | **Base exploitable, mais charge visuelle élevée pour un écran d’action.** |

## Ce qui fonctionne

- La sûreté est traduite en interface : `LiveFocusMode.tsx:183-193` n’affiche les actions qu’à partir des autorisations backend et distingue clairement confirmer d’un fill broker.
- Le produit possède une vraie structure opérateur : brief à gauche, décision au centre, file de tickets à droite (`live-focus.css:396-418`), plutôt qu’un tableau de métriques générique.
- La traçabilité est concrète : le dossier expose plans stratégie/contexte/Risk, filiation et Human Gate dans le drawer ; le clavier n’est pas un gadget mais un accélérateur de revue (`LiveFocusMode.tsx:150-153,224`).

## Priorités de correction

### P1 — Faire gagner la décision centrale

La grille trois colonnes (`live-focus.css:396-440`) donne presque le même poids au brief, à l’action et à la file. Le ticket actionnable devrait être la seule surface visuellement dominante ; le brief devient une bande secondaire repliable et le rail reste stable, compact et scrollable. Réduire les ombres/gradients sur `.live-focus__body > section`, réserver la couleur d’état au ticket et au rail, puis fixer un ordre de lecture 1 → 2 → 3. Fichiers : `live-focus.css`, `LiveFocusMode.tsx`.

### P1 — Réduire l’effet « vibecode » sans perdre l’identité sombre

Le fond radial + grille (`live-focus.css:70-112`), les rayons 14–20 px, ombres et nombreuses pills produisent une esthétique de prototype premium plutôt qu’une console de production. Garder une seule texture de fond, des rayons plus faibles et une surface plate pour les zones secondaires ; réserver le cyan/ambre/rouge aux états et actions. Fichier : `live-focus.css`.

### P1 — Donner au rail de tickets une lecture terminale

Le rail combine en-tête, export, recherche, filtres, KPIs, track, cartes, plan à cinq colonnes et timeline (`live-focus.css:999-1060,1299-1380`). C’est riche mais trop concurrentiel à 100 % : le ticket sélectionné doit avoir une ligne d’état, instrument/direction/expiration et prochaine action en premier regard ; les détails de plan doivent être secondaires ou ouverts. Fichiers : `LiveFocusJournal.tsx`, `live-focus.css`.

### P2 — Consolider l’explication du pipeline

Le pipeline est rendu dans `FocusPipeline` (`LiveFocusMode.tsx:~430`), mais sa présence dépend de l’état B et le reste bascule vers la position. Une bande compacte persistante « Signal → Contexte → Portfolio/Risk → OrderIntent → Human Gate » rendrait l’absence d’un ticket immédiatement compréhensible, sans faire croire qu’un signal est actionnable. Fichiers : `LiveFocusMode.tsx`, `live-focus.css`, éventuellement `LiveFocusJournal.tsx`.

### P2 — Clarifier la hiérarchie temporelle

La barre affiche horloge New York, fenêtre, fraîcheur, expiration et countdown dans plusieurs zones (`LiveFocusMode.tsx:157-167`). Regrouper “maintenant”, “données arrêtées à” et “échéance du ticket” dans une seule ligne temporelle ; conserver les valeurs backend, supprimer les répétitions et signaler visuellement une donnée stale sans multiplier les badges. Fichiers : `LiveFocusMode.tsx`, `FocusDashboard.tsx`, `live-focus.css`.

## Charge cognitive

La décision principale devrait répondre à trois questions : que s’est-il passé, quelle autorisation existe, quelle action est permise. L’écran en expose au moins huit groupes avant interaction : identité/policy/horloge, mission, chiffres clés, brief, ticket, deux cartes de support, rail et footer. Les groupes qui dépassent quatre choix sont le dashboard de périodes (`FocusDashboard.tsx`), les actions du ticket (`LiveFocusMode.tsx:183-189`) et les filtres du rail. Recommandation : réduire l’action primaire à une seule action backend, déplacer copie/dossier/refus dans un second niveau, et garder le rail comme navigation plutôt que deuxième dashboard.

## Risques opérateur

- Un opérateur pressé peut confondre “signal observé”, “ticket qualifié” et “ordre proposé” malgré la bonne microcopy, car ces états sont affichés simultanément dans la mission, le ticket et le footer.
- Le bouton “Copier le plan” partage le style d’action principale (`LiveFocusMode.tsx:188`), ce qui peut diluer la hiérarchie d’une action de validation.
- Les valeurs denses du plan à cinq colonnes risquent de tronquer entrée/stop/objectifs à largeur moyenne ; le CSS utilise `overflow-wrap`, mais la compréhension dépend encore du drawer.
- La barre de raccourcis fixe l’attention en bas, alors que la file de tickets et les drawers capturent l’attention au centre ; il faut vérifier le focus visible et le retour après fermeture sur petit écran.

## Personas

- **Opérateur expert** : les raccourcis et la navigation ↑↓ sont adaptés ; il perd du temps si l’action primaire, le ticket sélectionné et la fraîcheur ne partagent pas une même zone stable.
- **Opérateur de relève** : les termes “brief”, “dossier”, “ticket”, “plan ajusté” nécessitent le drawer et la mémoire du pipeline ; risque de traiter un signal observé comme une intention.
- **Responsable risque** : la séparation backend est rassurante, mais les indicateurs de confiance, santé et R du dashboard peuvent attirer l’œil avant les blocages et capabilities qui déterminent réellement l’action.

## Observations mineures

- `FocusDashboard` affiche jusqu’à cinq métriques par ligne et trois périodes ; le bloc est utile mais visuellement trop proche d’un tableau de performance.
- Le marqueur diamant et les halos par état apportent une signature, mais plusieurs traitements lumineux dans la même vue réduisent la priorité du statut.
- Le header “DIRECT DESK · FOCUS OPÉRATEUR” est spécifique et mémorable ; il gagnerait à être plus court pour libérer de l’espace au statut et à l’horloge.
- Les contrôles ont une cible minimale de 44 px, bon choix pour la sûreté, mais les petits labels mono sont à vérifier à 100 % sur la densité réelle.

## Questions de direction

1. Le rail doit-il être la file de travail principale, ou seulement un sélecteur de dossiers autour d’un ticket central ?
2. Quel est le seul élément que l’opérateur doit voir dans les deux premières secondes : l’état, l’échéance ou l’action autorisée ?
3. Peut-on retirer la moitié des surfaces décoratives et laisser les preuves backend porter la personnalité du produit ?

## Run notes

- Cible : route hash `#/live`, module `apps/desk-control-plane/src/features/live-trading`.
- Assessment : A uniquement, indépendante d’une assessment B non consultée.
- Inspection source : JSX, CSS, route map, package scripts et tests Live Focus.
- Browser : échec avant navigation, erreur précise `sandboxCwd is not a local file URI`; aucune capture ni overlay revendiquée.
- Données : aucune fixture exécutée ni donnée métier inventée ; aucun serveur local démarré.
- Produit : aucun fichier applicatif modifié ; seul ce rapport est ajouté.
