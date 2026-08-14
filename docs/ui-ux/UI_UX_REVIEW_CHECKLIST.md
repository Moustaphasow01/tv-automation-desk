# UI/UX Review Checklist — 100 contrôles prioritaires

Cette checklist courte ne remplace pas les 1 000 règles. Elle sélectionne deux contrôles prioritaires par chapitre pour les revues de PR, de design ou de release.

## 1. Gouvernance du référentiel et langage normatif

- [ ] **UXR-0001 · P0** — Toute tâche frontend doit identifier les règles de ce référentiel qui s'appliquent avant de modifier le code.
  - Preuve : La description de tâche ou de PR contient une section « Règles UI/UX applicables » avec des identifiants UXR.
- [ ] **UXR-0002 · P0** — Les exigences légales, de sécurité, d'accessibilité et de vérité des données priment sur toute préférence esthétique.
  - Preuve : Aucune décision visuelle ne contourne WCAG, RBAC, provenance, consentement ou contrat métier.

## 2. Recherche utilisateur et conception centrée humain

- [ ] **UXR-0021 · P0** — Une fonctionnalité doit répondre à un problème utilisateur observé, documenté ou explicitement hypothétique.
  - Preuve : La source du besoin est citée et les hypothèses non validées sont marquées comme telles.
- [ ] **UXR-0024 · P0** — Une seule personne interne ne doit pas être utilisée comme substitut permanent de l'ensemble des utilisateurs.
  - Preuve : Les décisions critiques reposent sur plusieurs profils ou sont marquées comme provisoires.

## 3. Objectif produit, tâche et contrat d'exploitation de page

- [ ] **UXR-0041 · P0** — Chaque écran doit avoir un objectif opérationnel formulable en une phrase sans décrire sa mise en page.
  - Preuve : Le Page Operating Contract contient un objectif centré sur le résultat utilisateur.
- [ ] **UXR-0042 · P0** — Chaque écran doit identifier les utilisateurs autorisés, leur contexte et leur fréquence d'usage.
  - Preuve : La fiche de page liste rôles, moments d'usage et niveau d'expertise.

## 4. Architecture de l'information et modèle mental

- [ ] **UXR-0071 · P0** — Une information agrégée doit permettre d'atteindre les objets qui la composent.
  - Preuve : Le clic ou l'action « contributeurs » applique un filtre ou ouvre un breakdown réel.
- [ ] **UXR-0061 · P1** — L'architecture de l'information doit utiliser le vocabulaire des utilisateurs et du domaine.
  - Preuve : Les libellés sont validés contre le glossaire métier et la recherche.

## 5. Navigation, orientation et repérage

- [ ] **UXR-0081 · P0** — La navigation principale doit provenir d'une source de vérité unique liée aux routes et aux capabilities.
  - Preuve : Sidebar, breadcrumbs, palette et mobile lisent le même registre.
- [ ] **UXR-0085 · P0** — Une destination autorisée sur desktop ne doit pas devenir inaccessible sur mobile.
  - Preuve : Le menu mobile expose tous les domaines disponibles via navigation directe ou « Plus ».

## 6. Profondeur de page, drill-down, drawers et sous-pages

- [ ] **UXR-0101 · P1** — Une vue L0 doit répondre à « que se passe-t-il et où regarder » sans prétendre contenir toute l'analyse.
  - Preuve : Le contenu priorise état, exceptions, tendances et accès aux domaines propriétaires.
- [ ] **UXR-0102 · P1** — Une vue L1 doit permettre de filtrer, comparer, sélectionner et agir sur les objets du domaine.
  - Preuve : La page possède les manipulations nécessaires à la tâche opérationnelle.

## 7. Layout, grille et hiérarchie visuelle

- [ ] **UXR-0121 · P1** — Le layout doit refléter l'ordre de décision défini par le contrat de page.
  - Preuve : Les premières zones contiennent contexte, état, exception et action principale.
- [ ] **UXR-0122 · P1** — Les alignements doivent suivre une grille ou des lignes directrices cohérentes.
  - Preuve : Les bords, titres, valeurs et contrôles partagent des axes visibles.

## 8. Responsive et conception adaptative

- [ ] **UXR-0141 · P0** — Toutes les fonctionnalités essentielles doivent rester accessibles à 320 CSS px de largeur ou à un zoom équivalent.
  - Preuve : Les tests reflow n'imposent pas de scroll horizontal global.
- [ ] **UXR-0142 · P0** — Le texte doit pouvoir être agrandi à 200 % sans perte de contenu ni d'action.
  - Preuve : Le test navigateur vérifie clipping, recouvrement et disparition.

## 9. Typographie, lisibilité et densité textuelle

- [ ] **UXR-0161 · P0** — Aucun texte fonctionnel ne doit être inférieur à 10 px dans le profil workstation interne.
  - Preuve : Le linter bloque les tailles sous le seuil hors cas documenté non fonctionnel.
- [ ] **UXR-0162 · P1** — Le corps de texte courant doit utiliser une taille et une hauteur de ligne adaptées à la lecture prolongée.
  - Preuve : Les tokens définissent une rampe lisible et testée au zoom.

## 10. Couleur, contraste, thèmes et états visuels

- [ ] **UXR-0181 · P0** — Le contraste du texte normal doit atteindre au moins 4,5:1 selon WCAG AA.
  - Preuve : Un outil automatisé et une vérification des états réels confirment le ratio.
- [ ] **UXR-0182 · P0** — Le contraste des grands textes peut suivre le seuil WCAG de 3:1 uniquement lorsque leur taille et graisse répondent réellement à la définition applicable.
  - Preuve : Le calcul documente taille, poids et arrière-plan.

## 11. Espacement, forme, bordures, élévation et densité

- [ ] **UXR-0201 · P1** — Tous les espacements récurrents doivent provenir d'une échelle de tokens limitée.
  - Preuve : Le linter signale les valeurs hors échelle dans les composants de production.
- [ ] **UXR-0202 · P1** — L'espacement doit exprimer la relation entre éléments proches et groupes distincts.
  - Preuve : L'espace interne d'un groupe est inférieur à l'espace entre groupes.

## 12. Iconographie, images, illustrations et médias

- [ ] **UXR-0221 · P0** — Toute image informative doit posséder une alternative textuelle équivalente à son objectif.
  - Preuve : Le test DOM vérifie alt ou description associée pertinente.
- [ ] **UXR-0222 · P0** — Toute image purement décorative doit être ignorée par les technologies d'assistance.
  - Preuve : Elle utilise alt vide ou un traitement décoratif approprié.

## 13. Mouvement, transitions et micro-interactions

- [ ] **UXR-0243 · P0** — Les préférences prefers-reduced-motion doivent être respectées.
  - Preuve : Le test réduit ou supprime les animations non essentielles.
- [ ] **UXR-0244 · P0** — Aucun contenu ne doit clignoter au-delà des seuils de sécurité applicables.
  - Preuve : Les médias et animations sont contrôlés contre le risque de flash.

## 14. Fondations d'accessibilité et conception inclusive

- [ ] **UXR-0261 · P0** — Les parcours et composants de production doivent viser au minimum WCAG 2.2 niveau AA.
  - Preuve : La matrice de conformité et les tests couvrent les critères applicables.
- [ ] **UXR-0262 · P0** — L'accessibilité doit être traitée dès la spécification et non ajoutée après le développement.
  - Preuve : Chaque Screen Specification inclut clavier, sémantique, zoom, contraste et alternatives.

## 15. Clavier, focus et ordre d’interaction

- [ ] **UXR-0281 · P0** — Chaque contrôle interactif doit être atteignable au clavier dans un ordre logique.
  - Preuve : Un test Tab et Shift+Tab couvre le parcours complet.
- [ ] **UXR-0282 · P0** — Le focus clavier doit toujours être visible avec un contraste et une surface suffisants.
  - Preuve : Le focus reste perceptible sur tous les thèmes et états.

## 16. Sémantique HTML, lecteurs d’écran et arbre d’accessibilité

- [ ] **UXR-0301 · P0** — Chaque page doit utiliser un landmark main unique pour son contenu principal.
  - Preuve : Le snapshot ARIA expose un main identifiable.
- [ ] **UXR-0303 · P0** — Les titres doivent former une structure hiérarchique cohérente et descriptive.
  - Preuve : Un audit de headings confirme niveaux et libellés.

## 17. Formulaires, saisie et choix

- [ ] **UXR-0321 · P0** — Chaque champ doit avoir un label visible et programmatique décrivant la donnée attendue.
  - Preuve : Le label est lié au contrôle et reste visible après saisie.
- [ ] **UXR-0322 · P0** — Un placeholder ne doit pas remplacer un label.
  - Preuve : Le test DOM trouve un label associé hors placeholder.

## 18. Validation, prévention des erreurs et récupération

- [ ] **UXR-0341 · P0** — La validation métier autoritaire doit rester côté backend même lorsqu'une validation client améliore le feedback.
  - Preuve : Le serveur rejette les entrées invalides et renvoie un code stable.
- [ ] **UXR-0349 · P0** — Les erreurs serveur ne doivent pas exposer stack trace, SQL, secret ou détail sensible.
  - Preuve : Le mapper transforme vers un problème utilisateur et conserve la corrélation.

## 19. Boutons, liens, actions, sélection et affordances

- [ ] **UXR-0361 · P0** — Un bouton visible doit déclencher une action réelle ou être désactivé avec une raison accessible.
  - Preuve : Le composant exige onAction ou un état disabled explicatif.
- [ ] **UXR-0362 · P0** — Un lien doit posséder une destination valide et un bouton ne doit pas simuler une navigation par défaut.
  - Preuve : Le linter contrôle href, handlers et sémantique.

## 20. Modales, drawers, popovers, menus et tooltips

- [ ] **UXR-0381 · P0** — Une modal doit utiliser une sémantique de dialogue, un nom accessible et une gestion complète du focus.
  - Preuve : Les tests couvrent role, label, focus trap et restauration.
- [ ] **UXR-0400 · P0** — Aucun nouvel overlay ne peut être approuvé sans test clavier, lecteur d'écran, mobile et zoom.
  - Preuve : La checklist contient une preuve pour les quatre contextes.

## 21. Recherche, filtres, tri, pagination et vues sauvegardées

- [ ] **UXR-0401 · P1** — Une recherche doit indiquer clairement son périmètre et les types d'objets indexés.
  - Preuve : Le placeholder, label ou aide précise ce qui peut être trouvé.
- [ ] **UXR-0402 · P1** — La recherche doit tolérer casse, accents, espaces et variations raisonnables selon le domaine.
  - Preuve : Les tests couvrent ces variantes sans produire de résultats trompeurs.

## 22. Tables, data grids et listes opérationnelles

- [ ] **UXR-0422 · P0** — Toute table doit avoir une caption ou un nom accessible décrivant son contenu et son périmètre.
  - Preuve : Le lecteur d'écran annonce la table de façon distincte.
- [ ] **UXR-0423 · P0** — Les en-têtes de colonnes et de lignes doivent être programmatiquement associés aux cellules.
  - Preuve : Le DOM utilise th, scope ou associations adaptées.

## 23. Visualisation de données, graphiques et cartes analytiques

- [ ] **UXR-0445 · P0** — Une visualisation importante doit posséder une alternative textuelle et tabulaire adaptée.
  - Preuve : Les tendances, anomalies et valeurs clés sont accessibles hors graphique.
- [ ] **UXR-0441 · P1** — Chaque visualisation doit répondre à une question utilisateur clairement formulée.
  - Preuve : Le titre ou la spécification exprime la question et l'insight attendu.

## 24. Dashboards, KPI, métriques et centres de commande

- [ ] **UXR-0461 · P0** — Chaque KPI doit avoir une définition, une unité, un périmètre, une période, une fraîcheur et une provenance.
  - Preuve : Le composant MetricCard exige ou dérive explicitement ces champs.
- [ ] **UXR-0462 · P0** — Une valeur inconnue ne doit jamais être remplacée par zéro, tiret ambigu ou statut rassurant.
  - Preuve : Le modèle distingue KNOWN, UNKNOWN, UNAVAILABLE et NOT_APPLICABLE.

## 25. Chargement, vide, données partielles, stale, offline et indisponibilité

- [ ] **UXR-0481 · P0** — Chaque source de données doit distinguer loading, ready, empty, partial, stale, disconnected, forbidden et error lorsque pertinents.
  - Preuve : Le type de vue ou la query expose ces états sans ambiguïté.
- [ ] **UXR-0482 · P0** — Un état empty ne doit être utilisé que lorsque l'absence de données est confirmée.
  - Preuve : Une source indisponible ou non chargée n'affiche jamais « aucun résultat ».

## 26. Feedback, statuts, notifications, toasts et confirmations

- [ ] **UXR-0501 · P0** — Toute action utilisateur doit produire un feedback perceptible indiquant réception, progression ou résultat.
  - Preuve : Le test confirme un changement visible et accessible après activation.
- [ ] **UXR-0502 · P0** — Un reçu ACCEPTED ne doit pas être présenté comme un succès métier terminal.
  - Preuve : L'UI suit RUNNING puis SUCCEEDED ou FAILED et relit la ressource.

## 27. Onboarding, apprentissage, aide et documentation intégrée

- [ ] **UXR-0521 · P1** — L'onboarding doit être centré sur la première valeur obtenue, pas sur la visite exhaustive des menus.
  - Preuve : Le parcours mène à une tâche réelle et un résultat observable.
- [ ] **UXR-0522 · P1** — Les informations indispensables à une tâche doivent être disponibles au moment et à l'endroit où elles sont nécessaires.
  - Preuve : L'utilisateur n'est pas obligé de consulter une documentation externe pour une étape critique.

## 28. Content design, microcopy et langage produit

- [ ] **UXR-0541 · P1** — Le contenu doit être clair, direct et orienté vers la tâche plutôt que promotionnel dans l'interface produit.
  - Preuve : La revue supprime jargon, slogans et formulations vagues.
- [ ] **UXR-0542 · P1** — Les libellés d'action doivent décrire le résultat réel avec un verbe spécifique.
  - Preuve : Le CTA permet de prédire l'effet sans contexte supplémentaire.

## 29. Internationalisation, localisation et diversité culturelle

- [ ] **UXR-0561 · P1** — L'internationalisation doit être intégrée à l'architecture avant la première localisation.
  - Preuve : Les chaînes, formats et direction ne sont pas codés en dur dans les composants.
- [ ] **UXR-0562 · P1** — Le document HTML doit déclarer la langue principale et les changements de langue internes.
  - Preuve : Les attributs lang sont valides et testés.

## 30. Mobile, tactile, gestes et contexte de mobilité

- [ ] **UXR-0581 · P0** — Les cibles tactiles principales doivent atteindre au moins 44 par 44 CSS px selon le standard interne.
  - Preuve : Les tests mesurent la hitbox réelle, pas seulement l'icône.
- [ ] **UXR-0582 · P1** — Les contrôles adjacents doivent être suffisamment espacés pour limiter les activations involontaires.
  - Preuve : Les actions dangereuses sont particulièrement isolées.

## 31. SaaS enterprise, rôles, permissions et multi-contexte

- [ ] **UXR-0601 · P0** — La visibilité d'une route et d'une action doit être dérivée des capabilities et permissions réelles de session.
  - Preuve : Le frontend ne contient pas d'allowlist statique qui simule le RBAC.
- [ ] **UXR-0602 · P0** — Le backend doit revalider toute permission, même lorsque le frontend masque ou désactive l'action.
  - Preuve : Les tests d'autorisation appellent directement l'API avec un rôle insuffisant.

## 32. Actions dangereuses, commandes, audit et réversibilité

- [ ] **UXR-0621 · P0** — Toute action dangereuse doit être liée à un command type backend réellement implémenté.
  - Preuve : Le capability catalog annonce support, permission et lifecycle.
- [ ] **UXR-0622 · P0** — Une action dangereuse doit présenter un preview d'impact avant confirmation.
  - Preuve : Le preview nomme objets, portée, conséquences et dépendances.

## 33. Confidentialité, sécurité, confiance et absence de manipulation

- [ ] **UXR-0641 · P0** — La collecte de données doit être limitée à ce qui est nécessaire pour la finalité déclarée.
  - Preuve : Chaque champ et événement analytique possède une justification et une durée de conservation.
- [ ] **UXR-0642 · P0** — Les paramètres par défaut doivent protéger la confidentialité et limiter l'exposition.
  - Preuve : Les options les plus permissives exigent un choix explicite lorsqu'applicable.

## 34. Expériences IA, explicabilité et contrôle humain

- [ ] **UXR-0661 · P0** — Une fonctionnalité IA doit résoudre un besoin utilisateur réel que l'IA peut traiter de façon appropriée.
  - Preuve : La spécification compare l'approche IA à une solution déterministe ou manuelle.
- [ ] **UXR-0662 · P0** — Le produit doit indiquer clairement quand un contenu, score ou recommandation provient d'une IA.
  - Preuve : Le label reste visible au moment de la décision.

## 35. Temps réel, flux live et actualisation continue

- [ ] **UXR-0681 · P0** — Toute donnée live doit afficher son asOf, sa source et son état de connexion.
  - Preuve : L'utilisateur peut distinguer actuel, stale et last known.
- [ ] **UXR-0682 · P0** — Une déconnexion ne doit jamais être interprétée comme un état nominal ou une absence d'événement.
  - Preuve : Le statut passe à disconnected avec dernier heartbeat.

## 36. Design system, tokens, primitives et gouvernance visuelle

- [ ] **UXR-0701 · P0** — Le design system doit être la source de vérité pour tokens, primitives et patterns transverses.
  - Preuve : Les features ne recopient pas styles et composants fondamentaux.
- [ ] **UXR-0720 · P0** — Une feature ne doit pas contourner une limitation du design system par copie locale silencieuse.
  - Preuve : Elle contribue une correction, ouvre une dérogation ou documente un composant métier distinct.

## 37. API de composants, composition et responsabilités UI

- [ ] **UXR-0721 · P1** — Un composant doit avoir une responsabilité visuelle ou interactionnelle cohérente et une raison principale de changer.
  - Preuve : La description du composant tient en une phrase précise.
- [ ] **UXR-0722 · P1** — Les composants de présentation doivent recevoir des données déjà adaptées à l'affichage.
  - Preuve : Ils ne calculent pas un KPI métier ni ne normalisent un DTO brut.

## 38. Architecture frontend par feature et séparation des couches

- [ ] **UXR-0741 · P0** — Le frontend doit être organisé par feature ou domaine métier, non par dossiers globaux de tous les composants et services.
  - Preuve : La structure contient features/<domain> avec routes, pages, components, api et model.
- [ ] **UXR-0746 · P0** — Le registre de routes, navigation, breadcrumbs et recherche doit être une source de vérité unique enrichie par capabilities.
  - Preuve : Aucune sidebar parallèle n'est codée en dur.

## 39. Contrats API, DTO, modèles de domaine UI et provenance

- [ ] **UXR-0761 · P0** — Le frontend doit consommer un contrat API documenté et versionné.
  - Preuve : Le client est généré ou fortement typé depuis OpenAPI ou schéma équivalent.
- [ ] **UXR-0762 · P0** — Les réponses doivent être validées à l'exécution aux frontières lorsque l'incohérence présente un risque.
  - Preuve : Une version ou forme inconnue produit un état explicite, pas un crash silencieux.

## 40. État client, cache serveur, URL et synchronisation

- [ ] **UXR-0800 · P0** — Toute source d'état doit avoir un propriétaire explicite : URL, serveur, session, composant ou préférence.
  - Preuve : La revue refuse les duplications d'autorité non justifiées.
- [ ] **UXR-0781 · P1** — L'état serveur doit être géré par une couche de query/cache dédiée, pas recopié dans un store client général.
  - Preuve : Les données API restent dans TanStack Query ou équivalent.

## 41. Performance réelle et performance perçue

- [ ] **UXR-0801 · P0** — Les écrans web publics ou compatibles doivent viser LCP ≤ 2,5 s, INP ≤ 200 ms et CLS ≤ 0,1 au 75e percentile.
  - Preuve : Les métriques terrain et laboratoire sont suivies par route critique.
- [ ] **UXR-0820 · P0** — Toute régression au-delà d'un budget critique doit bloquer la release ou déclencher une dérogation datée.
  - Preuve : La CI ou le monitoring de release applique le seuil.

## 42. Tests UI, accessibilité, interaction, visuel et E2E

- [ ] **UXR-0821 · P0** — Chaque mapper doit être testé avec DTO complet, partiel, inconnu, nul et invalide.
  - Preuve : Les tests vérifient états de vérité et absence de faux fallbacks.
- [ ] **UXR-0823 · P0** — Les composants interactifs doivent avoir des tests clavier et focus.
  - Preuve : Les scénarios utilisent des rôles et noms accessibles.

## 43. Mesure UX, analytics, expérimentation et apprentissage

- [ ] **UXR-0843 · P0** — Les analytics ne doivent pas collecter de payload, texte libre ou donnée sensible sans justification et protection.
  - Preuve : Une allowlist de propriétés est appliquée.
- [ ] **UXR-0848 · P0** — Une expérience ne doit pas modifier silencieusement un parcours de sécurité, consentement ou accessibilité critique.
  - Preuve : Une revue et un niveau de risque approprié sont requis.

## 44. Collaboration design-développement, handoff et décisions

- [ ] **UXR-0880 · P0** — Un agent LLM doit signaler toute information manquante qu'il n'a pas pu vérifier au lieu de la compléter par invention.
  - Preuve : Le rapport de sortie liste hypothèses, preuves et limites.
- [ ] **UXR-0861 · P1** — Toute tâche écran doit partir du Page Operating Contract et de la Screen Specification, pas seulement d'une capture.
  - Preuve : La PR lie objectif, questions, données, actions et états.

## 45. Personnalisation, thèmes, densité et préférences

- [ ] **UXR-0881 · P1** — La personnalisation doit améliorer une tâche réelle et non créer une complexité de configuration sans valeur.
  - Preuve : Chaque option possède un usage et une population identifiés.
- [ ] **UXR-0882 · P1** — Les préférences personnelles doivent être distinctes des policies organisationnelles.
  - Preuve : L'UI montre ce qui est modifiable, imposé ou hérité.

## 46. Résilience, modes dégradés, reprise et continuité de tâche

- [ ] **UXR-0901 · P0** — Chaque dépendance externe visible dans un parcours critique doit avoir un état de disponibilité distinct de la valeur métier.
  - Preuve : L'UI distingue source indisponible, valeur inconnue et valeur réellement nulle.
- [ ] **UXR-0902 · P0** — Une panne partielle ne doit pas transformer l'ensemble de l'écran en erreur si des sections fiables restent exploitables.
  - Preuve : Les sections portent leur propre état, source et dernier asOf.

## 47. Interfaces de contrôle à haut enjeu, trading et opérations temps réel

- [ ] **UXR-0921 · P0** — L'environnement opérationnel actif doit être visible en permanence et impossible à confondre avec DEMO, PAPER ou REPLAY.
  - Preuve : Le shell, les dialogues et les reçus répètent l'environnement autoritaire.
- [ ] **UXR-0922 · P0** — Les données de marché, risque, ordre et position doivent afficher leur fraîcheur et leur source lorsque l'âge influence la décision.
  - Preuve : Chaque valeur critique possède asOf, source et état de connexion.

## 48. Anti-patterns UI/UX explicitement interdits

- [ ] **UXR-0941 · P0** — Ne pas afficher une action sans route, handler ou commande réelle.
  - Preuve : Le composant exige un to ou un onAction typé et testé.
- [ ] **UXR-0942 · P0** — Ne pas convertir une absence de donnée en zéro, PASS, OK, NOMINAL, ACCEPTED ou valeur vide rassurante.
  - Preuve : Les états discriminés rendent l'inconnu explicite.

## 49. Definition of Done, release, feature flags et amélioration continue

- [ ] **UXR-0961 · P0** — Une page n'est Done que si son Page Operating Contract et sa Screen Specification sont validés.
  - Preuve : La PR lie les documents et les critères d'acceptation.
- [ ] **UXR-0962 · P0** — Toutes les données visibles doivent provenir d'une API documentée ou être marquées indisponibles, démo ou inconnues.
  - Preuve : Le test et le mapping identifient source, état et asOf.

## 50. Protocole d’exécution Codex et auto-audit obligatoire

- [ ] **UXR-0981 · P0** — Avant tout code, l'agent doit lire AGENTS.md, ce référentiel, le Page Operating Contract, la Screen Specification et les sources de vérité du projet.
  - Preuve : Le plan de travail liste les documents lus et leur ordre d'autorité.
- [ ] **UXR-0982 · P0** — L'agent doit inspecter le repository, les routes, composants, styles, contrats API, données et tests avant de proposer une architecture.
  - Preuve : Le rapport cite les fichiers réellement observés.

## Verdict de revue

- [ ] Aucun P0 violé sans dérogation valide.
- [ ] Les P1 non traités ont une justification ou un ticket daté.
- [ ] Les contrôles non exécutés sont déclarés avec leur risque.
- [ ] La chaîne `contrat → données → action → test → preuve` est consultable.
