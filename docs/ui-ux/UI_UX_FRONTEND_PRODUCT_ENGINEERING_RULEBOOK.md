# UI/UX & Frontend Product Engineering Rulebook

**Version :** 1.0.0
**Date :** 2026-08-13
**Statut :** norme interne — 1 000 règles actives
**Portée :** Product Design, UX, UI, accessibilité, parcours, data UX, design system, architecture frontend et qualité de livraison
**Public :** Codex, Claude, designers, frontend engineers, product managers, QA, reviewers et architectes

> Ce référentiel synthétise des standards publics reconnus et les contrats internes du produit. Il complète les documents produit et d’architecture ; il ne remplace ni la recherche utilisateur, ni les obligations légales, ni les tests avec technologies d’assistance, ni le jugement d’un reviewer qualifié.

---

## 0. Mission du référentiel

Le but n’est pas de produire des interfaces simplement « belles ». Toute interface doit permettre à une personne autorisée de **comprendre son contexte, accomplir une tâche, prévenir ou récupérer une erreur, vérifier le résultat et conserver la confiance dans les données**.

Le cycle de référence est :

```text
Observer → Comprendre → Investiguer → Agir → Vérifier
```

Le référentiel doit être consulté avant la conception, cité pendant l’implémentation et utilisé pour l’auto-audit avant la livraison.

### 0.1 Ordre d’autorité

1. Loi, sécurité, confidentialité, accessibilité et politiques de risque.
2. Contrats produit validés : Page Operating Contract, Screen Specification, exigences métier et permissions.
3. Contrats backend, données canoniques et architecture approuvée.
4. Présent référentiel et décisions ADR applicables.
5. Design system et composants gouvernés.
6. Maquettes, captures et références visuelles.
7. Préférence esthétique individuelle.

Une maquette ne prouve jamais qu’une capacité backend existe. Une donnée inconnue ne devient jamais zéro. Une commande reçue ne devient jamais une commande réussie.

### 0.2 Langage normatif

| Niveau | Signification |
| --- | --- |
| `MUST` | Obligation. Toute violation nécessite une dérogation approuvée. |
| `MUST NOT` | Interdiction. Toute violation nécessite une dérogation approuvée. |
| `SHOULD` | Comportement attendu par défaut ; l’écart doit être justifié. |
| `SHOULD NOT` | Comportement à éviter ; l’écart doit être justifié. |
| `MAY` | Option contextuelle, non requise. |

### 0.3 Priorités

| Priorité | Effet |
| --- | --- |
| `P0` | Bloquant : sécurité, vérité, accessibilité critique, autorité, action sensible ou parcours principal. |
| `P1` | Important : cohérence, utilisabilité, maintenabilité ou qualité de service. |
| `P2` | Amélioration à planifier si non traitée. |
| `P3` | Option ou optimisation contextuelle. |

### 0.4 Type de contrôle

| Type | Signification |
| --- | --- |
| `AUTO` | Une partie significative peut être vérifiée par CI, linter ou test. |
| `SEMI` | Automatisation partielle + revue humaine. |
| `MANUAL` | Recherche, jugement produit, inspection ou test humain requis. |

### 0.5 Statistiques de la version

- **Règles :** 1000
- **Chapitres :** 50
- **Priorités :** P0=214, P1=752, P2=33, P3=1
- **Contrôles :** AUTO=528, SEMI=197, MANUAL=275

---

## 1. Mode d’emploi obligatoire

Pour chaque tâche frontend :

1. Lire les sources de vérité du dépôt.
2. Identifier le Page Operating Contract et les capacités backend réelles.
3. Sélectionner les chapitres et règles UXR applicables.
4. Construire la matrice `besoin → donnée/API → permission → composant → route → état → test`.
5. Implémenter le plus petit vertical slice prouvant le parcours.
6. Exécuter les contrôles automatisés et inspecter le rendu réel.
7. Réaliser l’auto-audit UXR et documenter les limites ou dérogations.

Les fichiers `CODEX_UI_UX_EXECUTION_PROTOCOL.md`, `UI_UX_REVIEW_CHECKLIST.md` et `templates/UI_UX_SCREEN_REVIEW_TEMPLATE.md` rendent ce processus directement exécutable.

---

## 2. Index des chapitres

| Chapitre | Plage | Sujet | Sources |
| ---: | --- | --- | --- |
| 1 | `UXR-0001`–`UXR-0020` | Gouvernance du référentiel et langage normatif | S04, S23, S30, S31 |
| 2 | `UXR-0021`–`UXR-0040` | Recherche utilisateur et conception centrée humain | S04, S05, S06, S17 |
| 3 | `UXR-0041`–`UXR-0060` | Objectif produit, tâche et contrat d'exploitation de page | S04, S06, S30 |
| 4 | `UXR-0061`–`UXR-0080` | Architecture de l'information et modèle mental | S05, S06, S10 |
| 5 | `UXR-0081`–`UXR-0100` | Navigation, orientation et repérage | S05, S06, S10, S15 |
| 6 | `UXR-0101`–`UXR-0120` | Profondeur de page, drill-down, drawers et sous-pages | S06, S30 |
| 7 | `UXR-0121`–`UXR-0140` | Layout, grille et hiérarchie visuelle | S07, S08, S09, S11, S15 |
| 8 | `UXR-0141`–`UXR-0160` | Responsive et conception adaptative | S01, S08, S09, S15 |
| 9 | `UXR-0161`–`UXR-0180` | Typographie, lisibilité et densité textuelle | S01, S08, S09, S15 |
| 10 | `UXR-0181`–`UXR-0200` | Couleur, contraste, thèmes et états visuels | S01, S07, S09, S11, S13, S16 |
| 11 | `UXR-0201`–`UXR-0220` | Espacement, forme, bordures, élévation et densité | S07, S09, S11, S23 |
| 12 | `UXR-0221`–`UXR-0240` | Iconographie, images, illustrations et médias | S01, S07, S08, S15, S16 |
| 13 | `UXR-0241`–`UXR-0260` | Mouvement, transitions et micro-interactions | S01, S07, S09, S16 |
| 14 | `UXR-0261`–`UXR-0280` | Fondations d'accessibilité et conception inclusive | S01, S02, S17 |
| 15 | `UXR-0281`–`UXR-0300` | Clavier, focus et ordre d’interaction | S01, S02 |
| 16 | `UXR-0301`–`UXR-0320` | Sémantique HTML, lecteurs d’écran et arbre d’accessibilité | S01, S02, S20 |
| 17 | `UXR-0321`–`UXR-0340` | Formulaires, saisie et choix | S01, S02, S10, S20 |
| 18 | `UXR-0341`–`UXR-0360` | Validation, prévention des erreurs et récupération | S01, S06, S10, S26 |
| 19 | `UXR-0361`–`UXR-0380` | Boutons, liens, actions, sélection et affordances | S01, S02, S07, S09 |
| 20 | `UXR-0381`–`UXR-0400` | Modales, drawers, popovers, menus et tooltips | S01, S02, S10, S11 |
| 21 | `UXR-0401`–`UXR-0420` | Recherche, filtres, tri, pagination et vues sauvegardées | S06, S10, S14 |
| 22 | `UXR-0421`–`UXR-0440` | Tables, data grids et listes opérationnelles | S01, S02, S11, S14 |
| 23 | `UXR-0441`–`UXR-0460` | Visualisation de données, graphiques et cartes analytiques | S01, S11, S12 |
| 24 | `UXR-0461`–`UXR-0480` | Dashboards, KPI, métriques et centres de commande | S06, S11, S12, S30 |
| 25 | `UXR-0481`–`UXR-0500` | Chargement, vide, données partielles, stale, offline et indisponibilité | S06, S09, S21, S22, S30 |
| 26 | `UXR-0501`–`UXR-0520` | Feedback, statuts, notifications, toasts et confirmations | S06, S07, S09 |
| 27 | `UXR-0521`–`UXR-0540` | Onboarding, apprentissage, aide et documentation intégrée | S05, S06, S10 |
| 28 | `UXR-0541`–`UXR-0560` | Content design, microcopy et langage produit | S06, S08, S10, S15, S16 |
| 29 | `UXR-0561`–`UXR-0580` | Internationalisation, localisation et diversité culturelle | S03, S08 |
| 30 | `UXR-0581`–`UXR-0600` | Mobile, tactile, gestes et contexte de mobilité | S01, S07, S08 |
| 31 | `UXR-0601`–`UXR-0620` | SaaS enterprise, rôles, permissions et multi-contexte | S04, S06, S13, S30 |
| 32 | `UXR-0621`–`UXR-0640` | Actions dangereuses, commandes, audit et réversibilité | S26, S27, S30 |
| 33 | `UXR-0641`–`UXR-0660` | Confidentialité, sécurité, confiance et absence de manipulation | S26, S27, S28, S29 |
| 34 | `UXR-0661`–`UXR-0680` | Expériences IA, explicabilité et contrôle humain | S17, S18, S30 |
| 35 | `UXR-0681`–`UXR-0700` | Temps réel, flux live et actualisation continue | S06, S19, S22, S30 |
| 36 | `UXR-0701`–`UXR-0720` | Design system, tokens, primitives et gouvernance visuelle | S07, S09, S11, S12, S13, S15, S23 |
| 37 | `UXR-0721`–`UXR-0740` | API de composants, composition et responsabilités UI | S02, S07, S09, S21, S24 |
| 38 | `UXR-0741`–`UXR-0760` | Architecture frontend par feature et séparation des couches | S21, S30, S31 |
| 39 | `UXR-0761`–`UXR-0780` | Contrats API, DTO, modèles de domaine UI et provenance | S21, S22, S26, S30 |
| 40 | `UXR-0781`–`UXR-0800` | État client, cache serveur, URL et synchronisation | S21, S22 |
| 41 | `UXR-0801`–`UXR-0820` | Performance réelle et performance perçue | S19, S20 |
| 42 | `UXR-0821`–`UXR-0840` | Tests UI, accessibilité, interaction, visuel et E2E | S01, S24, S25 |
| 43 | `UXR-0841`–`UXR-0860` | Mesure UX, analytics, expérimentation et apprentissage | S04, S06, S19 |
| 44 | `UXR-0861`–`UXR-0880` | Collaboration design-développement, handoff et décisions | S04, S23, S24, S31 |
| 45 | `UXR-0881`–`UXR-0900` | Personnalisation, thèmes, densité et préférences | S05, S09, S15, S30 |
| 46 | `UXR-0901`–`UXR-0920` | Résilience, modes dégradés, reprise et continuité de tâche | S01, S05, S10, S19, S26, S30 |
| 47 | `UXR-0921`–`UXR-0940` | Interfaces de contrôle à haut enjeu, trading et opérations temps réel | S01, S04, S05, S17, S26, S27, S30 |
| 48 | `UXR-0941`–`UXR-0960` | Anti-patterns UI/UX explicitement interdits | S01, S02, S05, S10, S16, S28, S29, S30, S31 |
| 49 | `UXR-0961`–`UXR-0980` | Definition of Done, release, feature flags et amélioration continue | S01, S19, S24, S25, S26, S30, S31 |
| 50 | `UXR-0981`–`UXR-1000` | Protocole d’exécution Codex et auto-audit obligatoire | S01, S21, S23, S24, S25, S30, S31 |

---

## 3. Règles normatives

# Chapitre 1 — Gouvernance du référentiel et langage normatif

**Objectif :** Transformer les principes UI/UX en obligations traçables, arbitrables et contrôlables par l'équipe comme par les agents LLM.

**Sources fondatrices :** S04, S23, S30, S31

**Plage :** `UXR-0001` à `UXR-0020`

### UXR-0001 — MUST · P0 · SEMI

**Règle.** Toute tâche frontend doit identifier les règles de ce référentiel qui s'appliquent avant de modifier le code.

**Preuve attendue.** La description de tâche ou de PR contient une section « Règles UI/UX applicables » avec des identifiants UXR.

### UXR-0002 — MUST · P0 · MANUAL

**Règle.** Les exigences légales, de sécurité, d'accessibilité et de vérité des données priment sur toute préférence esthétique.

**Preuve attendue.** Aucune décision visuelle ne contourne WCAG, RBAC, provenance, consentement ou contrat métier.

### UXR-0003 — MUST · P0 · MANUAL

**Règle.** Un Page Operating Contract validé prime sur une maquette lorsqu'ils divergent sur l'objectif, les données ou les actions.

**Preuve attendue.** La PR cite le contrat de page et explique tout écart avec la référence visuelle.

### UXR-0004 — MUST · P0 · SEMI

**Règle.** Une règle MUST ou MUST NOT ne peut être ignorée sans dérogation écrite, propriétaire, risque, mesure compensatoire et date d'expiration.

**Preuve attendue.** Le registre des dérogations contient une entrée complète et approuvée.

### UXR-0005 — SHOULD · P1 · MANUAL

**Règle.** Une règle SHOULD est appliquée par défaut et tout écart doit être justifié par un besoin utilisateur ou une contrainte mesurée.

**Preuve attendue.** La PR documente la justification et la preuve, pas une préférence personnelle.

### UXR-0006 — MAY · P3 · MANUAL

**Règle.** Une règle MAY peut être utilisée lorsque le contexte la rend utile sans créer de complexité durable.

**Preuve attendue.** La décision reste réversible et n'introduit pas de dépendance structurelle injustifiée.

### UXR-0007 — MUST · P0 · SEMI

**Règle.** Chaque règle appliquée doit produire une preuve vérifiable dans le design, le code, les tests ou la documentation.

**Preuve attendue.** La revue peut pointer vers un fichier, une story, un test, une capture ou une mesure.

### UXR-0008 — MUST NOT · P0 · MANUAL

**Règle.** Un agent ne doit pas déclarer une règle respectée sans avoir inspecté le rendu ou la preuve correspondante.

**Preuve attendue.** Le rapport distingue « vérifié », « partiellement vérifié » et « non vérifié » avec raison.

### UXR-0009 — MUST · P0 · MANUAL

**Règle.** Les conflits entre règles doivent être arbitrés explicitement selon l'ordre sécurité, vérité, accessibilité, tâche, cohérence, esthétique.

**Preuve attendue.** La décision d'arbitrage est écrite dans la PR ou un ADR UX.

### UXR-0010 — MUST · P1 · AUTO

**Règle.** Le référentiel doit être versionné et chaque changement normatif doit indiquer sa motivation et son impact.

**Preuve attendue.** Un changelog contient version, règles modifiées, migration et approbateurs.

### UXR-0011 — MUST · P1 · AUTO

**Règle.** Les règles doivent avoir des identifiants stables qui ne sont jamais réutilisés après suppression.

**Preuve attendue.** Le JSON et le Markdown conservent l'historique des IDs dépréciés.

### UXR-0012 — MUST · P1 · SEMI

**Règle.** Toute exception répétée trois fois doit déclencher une révision de la règle, du composant ou de l'architecture.

**Preuve attendue.** Le registre d'exceptions est analysé périodiquement et ouvre un ticket de fond.

### UXR-0013 — MUST · P0 · SEMI

**Règle.** Les règles P0 bloquent la fusion lorsqu'elles sont violées sans dérogation valide.

**Preuve attendue.** La CI ou la checklist de revue marque le contrôle comme bloquant.

### UXR-0014 — SHOULD · P1 · MANUAL

**Règle.** Les règles P1 bloquent la fusion lorsque l'écart affecte un parcours principal ou une action sensible.

**Preuve attendue.** Le reviewer évalue l'impact utilisateur et documente la décision.

### UXR-0015 — SHOULD · P2 · SEMI

**Règle.** Les règles P2 sont planifiées lorsqu'elles ne peuvent pas être traitées dans la modification courante.

**Preuve attendue.** Un ticket daté existe avant fusion si la dette est introduite par la PR.

### UXR-0016 — MUST · P0 · MANUAL

**Règle.** Les sources externes servent de fondation mais les règles internes peuvent être plus strictes pour un produit à haut enjeu.

**Preuve attendue.** La règle interne indique clairement qu'elle constitue un standard produit renforcé.

### UXR-0017 — MUST NOT · P0 · SEMI

**Règle.** Une capture, une maquette ou un prototype ne doit jamais être considéré comme preuve d'une capacité backend réelle.

**Preuve attendue.** La capacité est confirmée par contrat API, réponse réelle et test d'intégration.

### UXR-0018 — MUST · P1 · AUTO

**Règle.** Chaque écran doit posséder un propriétaire produit et un propriétaire technique pour les décisions durables.

**Preuve attendue.** La fiche d'écran ou CODEOWNERS identifie les responsabilités.

### UXR-0019 — MUST · P1 · SEMI

**Règle.** Une décision UI structurante doit être enregistrée lorsqu'elle affecte plusieurs écrans, le design system ou un parcours critique.

**Preuve attendue.** Un ADR UX contient contexte, options, décision, conséquences et date de réévaluation.

### UXR-0020 — MUST · P0 · SEMI

**Règle.** Le référentiel doit être lu comme une norme de construction, non comme une liste décorative de conseils.

**Preuve attendue.** Le protocole Codex exige une auto-évaluation par identifiants avant de déclarer la tâche terminée.

---

# Chapitre 2 — Recherche utilisateur et conception centrée humain

**Objectif :** Ancrer les décisions dans le travail réel, les contraintes du domaine, la diversité des utilisateurs et des situations d'usage.

**Sources fondatrices :** S04, S05, S06, S17

**Plage :** `UXR-0021` à `UXR-0040`

### UXR-0021 — MUST · P0 · MANUAL

**Règle.** Une fonctionnalité doit répondre à un problème utilisateur observé, documenté ou explicitement hypothétique.

**Preuve attendue.** La source du besoin est citée et les hypothèses non validées sont marquées comme telles.

### UXR-0022 — MUST · P1 · MANUAL

**Règle.** La recherche doit étudier le travail à accomplir et pas seulement les opinions déclarées des utilisateurs.

**Preuve attendue.** Les notes couvrent tâches, outils, contournements, contraintes, interruptions et critères de succès.

### UXR-0023 — MUST · P1 · MANUAL

**Règle.** Les rôles à haut enjeu doivent être observés dans leur contexte réel ou dans une simulation fidèle avant de figer le parcours.

**Preuve attendue.** Une session contextuelle ou un test de scénario métier est consigné.

### UXR-0024 — MUST NOT · P0 · MANUAL

**Règle.** Une seule personne interne ne doit pas être utilisée comme substitut permanent de l'ensemble des utilisateurs.

**Preuve attendue.** Les décisions critiques reposent sur plusieurs profils ou sont marquées comme provisoires.

### UXR-0025 — SHOULD · P1 · MANUAL

**Règle.** La recherche doit inclure des utilisateurs novices, réguliers, experts, administrateurs et utilisateurs occasionnels lorsque ces profils existent.

**Preuve attendue.** Le plan de recrutement couvre les niveaux de maîtrise pertinents.

### UXR-0026 — MUST · P0 · MANUAL

**Règle.** Les personnes en situation de handicap doivent être incluses dans la recherche des parcours critiques.

**Preuve attendue.** Le plan de test inclut des besoins visuels, moteurs, auditifs ou cognitifs pertinents.

### UXR-0027 — SHOULD · P1 · MANUAL

**Règle.** Les situations de stress, faible bande passante, mobilité, interruption et urgence doivent être considérées comme des contextes d'usage à part entière.

**Preuve attendue.** Les scénarios de recherche et d'acceptation couvrent les contextes dégradés.

### UXR-0028 — MUST · P1 · MANUAL

**Règle.** Chaque étude doit définir la question de recherche avant de choisir la méthode.

**Preuve attendue.** Le protocole sépare objectif, participants, tâches, métriques et analyse.

### UXR-0029 — MUST NOT · P1 · MANUAL

**Règle.** Un test d'utilisabilité ne doit pas être transformé en démonstration guidée du produit.

**Preuve attendue.** Le facilitateur laisse l'utilisateur tenter la tâche avant d'aider.

### UXR-0030 — MUST · P1 · MANUAL

**Règle.** Les tâches de test doivent être formulées comme des objectifs réalistes, non comme des instructions révélant les contrôles à utiliser.

**Preuve attendue.** Le script évite les termes exacts des boutons et menus testés.

### UXR-0031 — MUST · P1 · MANUAL

**Règle.** Les observations doivent distinguer fait observé, interprétation et recommandation.

**Preuve attendue.** Le rapport utilise des champs séparés pour preuve, hypothèse et décision.

### UXR-0032 — SHOULD · P2 · SEMI

**Règle.** La gravité d'un problème doit combiner fréquence, impact, persistance et criticité métier.

**Preuve attendue.** La priorisation expose les quatre dimensions ou une méthode équivalente.

### UXR-0033 — MUST · P1 · MANUAL

**Règle.** Une décision ne doit pas être généralisée à partir d'un cas isolé sans signaler l'incertitude.

**Preuve attendue.** Le rapport mentionne taille d'échantillon et niveau de confiance qualitatif.

### UXR-0034 — SHOULD · P1 · MANUAL

**Règle.** Les prototypes doivent être testés au niveau de fidélité le plus faible permettant de répondre à la question.

**Preuve attendue.** Le choix de fidélité est justifié pour éviter du travail visuel prématuré.

### UXR-0035 — MUST · P1 · MANUAL

**Règle.** Les résultats contradictoires doivent être conservés et examinés plutôt que supprimés pour simplifier le récit.

**Preuve attendue.** Le rapport présente les divergences et leurs hypothèses explicatives.

### UXR-0036 — SHOULD · P2 · SEMI

**Règle.** Les utilisateurs doivent pouvoir signaler une friction depuis le produit lorsque cela est compatible avec la sécurité et la confidentialité.

**Preuve attendue.** Un canal contextuel relie l'écran, l'état et le retour sans collecter de données excessives.

### UXR-0037 — MUST · P1 · SEMI

**Règle.** Les décisions issues de recherche doivent être traçables vers des exigences, règles ou tickets.

**Preuve attendue.** Chaque insight retenu possède un lien vers son implémentation ou son rejet motivé.

### UXR-0038 — SHOULD · P2 · SEMI

**Règle.** Les recherches anciennes doivent être réévaluées lorsque le rôle, le workflow ou les contraintes techniques changent significativement.

**Preuve attendue.** La date et le périmètre de validité de chaque insight sont visibles.

### UXR-0039 — MUST · P0 · MANUAL

**Règle.** Aucune optimisation mesurée ne doit dégrader un droit, une accessibilité ou une sécurité au nom de la conversion ou de la vitesse.

**Preuve attendue.** L'analyse inclut des garde-fous qualitatifs et non seulement une métrique business.

### UXR-0040 — MUST · P1 · SEMI

**Règle.** La conception centrée humain doit rester itérative après la mise en production.

**Preuve attendue.** Le plan de release prévoit observation, mesure, retours et cycle de correction.

---

# Chapitre 3 — Objectif produit, tâche et contrat d'exploitation de page

**Objectif :** Faire de chaque écran un outil de travail explicitement orienté vers un résultat, une décision et une vérification.

**Sources fondatrices :** S04, S06, S30

**Plage :** `UXR-0041` à `UXR-0060`

### UXR-0041 — MUST · P0 · MANUAL

**Règle.** Chaque écran doit avoir un objectif opérationnel formulable en une phrase sans décrire sa mise en page.

**Preuve attendue.** Le Page Operating Contract contient un objectif centré sur le résultat utilisateur.

### UXR-0042 — MUST · P0 · MANUAL

**Règle.** Chaque écran doit identifier les utilisateurs autorisés, leur contexte et leur fréquence d'usage.

**Preuve attendue.** La fiche de page liste rôles, moments d'usage et niveau d'expertise.

### UXR-0043 — MUST · P0 · MANUAL

**Règle.** Chaque écran doit lister les principales questions métier auxquelles il permet de répondre.

**Preuve attendue.** Les questions sont traduites en ordre de lecture et en données nécessaires.

### UXR-0044 — MUST · P0 · MANUAL

**Règle.** Chaque écran doit distinguer informations primaires, secondaires et détaillées.

**Preuve attendue.** Le layout et le responsive respectent cette hiérarchie.

### UXR-0045 — MUST · P0 · SEMI

**Règle.** Chaque écran doit définir ses actions principales, secondaires, contextuelles et dangereuses.

**Preuve attendue.** La spécification relie chaque action à une capability et à une permission.

### UXR-0046 — MUST · P0 · MANUAL

**Règle.** Une page ne doit pas exister uniquement parce qu'une route ou une API existe.

**Preuve attendue.** Son utilité est démontrée par une tâche et un résultat utilisateur.

### UXR-0047 — MUST · P1 · MANUAL

**Règle.** Une page doit optimiser une tâche principale avant d'ajouter des fonctionnalités périphériques.

**Preuve attendue.** Le CTA, le contenu et la navigation reflètent la priorité déclarée.

### UXR-0048 — MUST NOT · P0 · SEMI

**Règle.** Une donnée ne doit pas être affichée sans expliquer sa signification, son périmètre et son utilité pour la décision.

**Preuve attendue.** Les métriques possèdent unité, période, provenance et accès aux contributeurs.

### UXR-0049 — MUST · P0 · AUTO

**Règle.** Une action visible doit produire un effet réel ou être explicitement désactivée avec une raison vérifiable.

**Preuve attendue.** Le test relie le contrôle à un endpoint ou à une route réelle.

### UXR-0050 — MUST · P0 · MANUAL

**Règle.** Chaque parcours critique doit suivre Observer, Comprendre, Investiguer, Agir, Vérifier.

**Preuve attendue.** La cartographie montre les cinq étapes ou justifie celles qui ne s'appliquent pas.

### UXR-0051 — MUST · P1 · MANUAL

**Règle.** Le test des cinq secondes doit permettre d'identifier où l'on est, l'état, l'exception, l'information principale et l'action possible.

**Preuve attendue.** Une revue ou un test rapide valide ces cinq réponses sans explication orale.

### UXR-0052 — MUST · P1 · SEMI

**Règle.** Une page doit rester utile lorsque les couleurs et effets visuels sont retirés.

**Preuve attendue.** La structure sémantique et l'ordre du contenu conservent le sens.

### UXR-0053 — MUST · P0 · SEMI

**Règle.** Le niveau d'autorité d'une information doit être explicite lorsque plusieurs sources ou agents contribuent.

**Preuve attendue.** Le rendu distingue données canoniques, calculs, recommandations et hypothèses.

### UXR-0054 — MUST · P1 · MANUAL

**Règle.** Les critères de réussite d'un écran doivent être mesurables sans réduire la qualité à un seul KPI business.

**Preuve attendue.** La fiche combine réussite de tâche, erreurs, temps, compréhension et garde-fous.

### UXR-0055 — MUST NOT · P1 · SEMI

**Règle.** Une page ne doit pas dupliquer une autre page sans différence claire de tâche ou de profondeur.

**Preuve attendue.** L'inventaire des routes explique la responsabilité unique de chaque vue.

### UXR-0056 — SHOULD · P2 · MANUAL

**Règle.** Les informations répétées entre pages doivent servir le contexte local plutôt que recopier un dashboard global.

**Preuve attendue.** La répétition est justifiée par une décision immédiate de l'utilisateur.

### UXR-0057 — MUST · P1 · SEMI

**Règle.** Chaque écran doit définir ses états loading, empty, partial, stale, disconnected, forbidden, conflict, error et ready lorsqu'ils sont applicables.

**Preuve attendue.** La matrice de page et les stories couvrent ces états.

### UXR-0058 — MUST · P0 · AUTO

**Règle.** Chaque écran doit définir ce qui constitue un zéro réel, une absence, un inconnu et un non-applicable.

**Preuve attendue.** Le mapping de données utilise des états discriminés plutôt que des fallbacks numériques.

### UXR-0059 — MUST · P1 · AUTO

**Règle.** Chaque page de détail doit posséder une identité stable, une URL partageable et un retour contextuel.

**Preuve attendue.** Deux IDs produisent deux ressources et l'état de liste est restauré au retour.

### UXR-0060 — MUST · P0 · SEMI

**Règle.** La construction d'un écran ne peut commencer sans contrat minimal sur objectif, données, actions, états et permissions.

**Preuve attendue.** La tâche est bloquée tant que ces cinq éléments ne sont pas définis.

---

# Chapitre 4 — Architecture de l'information et modèle mental

**Objectif :** Organiser contenus, objets et relations selon la compréhension du domaine plutôt que selon l'organisation interne du code.

**Sources fondatrices :** S05, S06, S10

**Plage :** `UXR-0061` à `UXR-0080`

### UXR-0061 — MUST · P1 · MANUAL

**Règle.** L'architecture de l'information doit utiliser le vocabulaire des utilisateurs et du domaine.

**Preuve attendue.** Les libellés sont validés contre le glossaire métier et la recherche.

### UXR-0062 — MUST NOT · P1 · MANUAL

**Règle.** La navigation ne doit pas exposer directement les couches techniques, noms de microservices ou structures de base de données aux utilisateurs non techniques.

**Preuve attendue.** Les termes techniques restent dans un inspecteur ou un espace administrateur.

### UXR-0063 — MUST · P1 · MANUAL

**Règle.** Les catégories principales doivent être mutuellement compréhensibles même si elles ne sont pas mathématiquement exclusives.

**Preuve attendue.** Un test de tri de cartes ou une revue métier valide le classement.

### UXR-0064 — MUST · P1 · SEMI

**Règle.** Un objet métier doit conserver le même nom et la même identité à travers liste, détail, recherche, notification et audit.

**Preuve attendue.** Les composants utilisent un modèle d'entité partagé et des libellés cohérents.

### UXR-0065 — MUST · P1 · AUTO

**Règle.** Les relations entre objets doivent être explicites et navigables dans les deux sens lorsque le métier le permet.

**Preuve attendue.** Les pages de détail affichent relation, statut, date et lien vers l'objet associé.

### UXR-0066 — MUST · P1 · MANUAL

**Règle.** La profondeur de l'arborescence doit être déterminée par les tâches, pas par une limite arbitraire de niveaux.

**Preuve attendue.** Les parcours fréquents restent directs et les détails rares restent accessibles.

### UXR-0067 — SHOULD · P2 · MANUAL

**Règle.** Les regroupements doivent être testés avec des exemples réels, y compris les cas ambigus.

**Preuve attendue.** Les objets limites sont documentés et ne créent pas de catégorie fourre-tout.

### UXR-0068 — MUST NOT · P1 · SEMI

**Règle.** Une catégorie « Autres » ne doit pas devenir le dépôt permanent des contenus mal classés.

**Preuve attendue.** Son volume et ses usages sont suivis et déclenchent une refonte si récurrents.

### UXR-0069 — MUST · P1 · MANUAL

**Règle.** Les contenus critiques doivent rester trouvables par navigation et par recherche lorsqu'une recherche existe.

**Preuve attendue.** Un test utilisateur peut atteindre l'information par au moins un chemin prévisible.

### UXR-0070 — MUST · P1 · AUTO

**Règle.** Le système doit révéler la portée d'un changement de contexte comme environnement, tenant, établissement, compte ou période.

**Preuve attendue.** Le contexte est visible dans le shell et propagé aux routes et requêtes.

### UXR-0071 — MUST · P0 · AUTO

**Règle.** Une information agrégée doit permettre d'atteindre les objets qui la composent.

**Preuve attendue.** Le clic ou l'action « contributeurs » applique un filtre ou ouvre un breakdown réel.

### UXR-0072 — MUST · P1 · SEMI

**Règle.** Les pages doivent distinguer clairement vue globale, vue opérationnelle, détail et analyse profonde.

**Preuve attendue.** La route, le titre, les breadcrumbs et le layout reflètent le niveau L0 à L3.

### UXR-0073 — MUST · P1 · AUTO

**Règle.** Les filtres structurants doivent être traités comme partie de l'architecture de l'information.

**Preuve attendue.** Leur état est visible, partageable et restauré.

### UXR-0074 — SHOULD · P2 · SEMI

**Règle.** Les synonymes courants et anciennes appellations doivent être indexés dans la recherche sans polluer les libellés principaux.

**Preuve attendue.** Le catalogue de recherche inclut alias et mots-clés contrôlés.

### UXR-0075 — MUST · P1 · MANUAL

**Règle.** Les contenus doivent être ordonnés selon l'urgence, la fréquence ou la séquence de tâche pertinente.

**Preuve attendue.** L'ordre est justifié par le contrat de page, non par la facilité d'implémentation.

### UXR-0076 — MUST NOT · P1 · AUTO

**Règle.** L'ordre visuel ne doit pas contredire l'ordre sémantique ou clavier.

**Preuve attendue.** Le DOM et le parcours de focus suivent un ordre logique.

### UXR-0077 — MUST · P1 · SEMI

**Règle.** Les objets archivés, supprimés, suspendus ou indisponibles doivent conserver une représentation intelligible dans les relations et audits.

**Preuve attendue.** Le lien explique l'état et n'aboutit pas à un vide trompeur.

### UXR-0078 — SHOULD · P2 · MANUAL

**Règle.** Les informations secondaires doivent être progressivement révélées sans cacher ce qui est nécessaire pour décider.

**Preuve attendue.** Une personne peut terminer la tâche principale sans ouvrir tous les détails.

### UXR-0079 — MUST · P1 · AUTO

**Règle.** Chaque changement majeur d'arborescence doit prévoir redirections, compatibilité des liens et migration des favoris.

**Preuve attendue.** Les anciennes URLs sont testées ou documentées comme rompues volontairement.

### UXR-0080 — MUST · P1 · SEMI

**Règle.** L'architecture de l'information doit être documentée sous forme d'arbre et de graphe de relations métier.

**Preuve attendue.** Les deux représentations sont versionnées avec les routes et les capabilities.

---

# Chapitre 5 — Navigation, orientation et repérage

**Objectif :** Permettre à chacun de savoir où il se trouve, ce qu'il peut atteindre et comment revenir sans perdre son contexte.

**Sources fondatrices :** S05, S06, S10, S15

**Plage :** `UXR-0081` à `UXR-0100`

### UXR-0081 — MUST · P0 · AUTO

**Règle.** La navigation principale doit provenir d'une source de vérité unique liée aux routes et aux capabilities.

**Preuve attendue.** Sidebar, breadcrumbs, palette et mobile lisent le même registre.

### UXR-0082 — MUST · P1 · AUTO

**Règle.** L'élément de navigation actif doit être identifiable sans dépendre uniquement de la couleur.

**Preuve attendue.** Un indicateur de forme, position, texte ou icône complète la couleur.

### UXR-0083 — MUST · P1 · AUTO

**Règle.** Chaque page L2 ou plus profonde doit afficher des breadcrumbs cohérents et cliquables.

**Preuve attendue.** Le chemin reflète la hiérarchie réelle et possède des noms humains.

### UXR-0084 — MUST · P1 · AUTO

**Règle.** Le bouton retour doit préserver filtres, tri, pagination, onglet, sélection et position de scroll lorsque le contexte l'exige.

**Preuve attendue.** Un test E2E revient à la liste sans réinitialisation inattendue.

### UXR-0085 — MUST NOT · P0 · AUTO

**Règle.** Une destination autorisée sur desktop ne doit pas devenir inaccessible sur mobile.

**Preuve attendue.** Le menu mobile expose tous les domaines disponibles via navigation directe ou « Plus ».

### UXR-0086 — MUST · P1 · MANUAL

**Règle.** Les libellés de navigation doivent décrire une destination ou une tâche, pas une métaphore ambiguë.

**Preuve attendue.** Un nouvel utilisateur peut prédire le contenu de la destination.

### UXR-0087 — MUST · P1 · AUTO

**Règle.** Les liens doivent naviguer et les boutons doivent déclencher une action.

**Preuve attendue.** Les éléments utilisent les sémantiques HTML et comportements attendus.

### UXR-0088 — MUST NOT · P1 · AUTO

**Règle.** Un lien ne doit pas être stylé comme désactivé tout en restant activable, ni inversement.

**Preuve attendue.** L'état visuel, sémantique et fonctionnel est cohérent.

### UXR-0089 — MUST · P1 · SEMI

**Règle.** Les changements de contexte majeurs doivent être visibles avant et après navigation.

**Preuve attendue.** Le shell montre environnement, périmètre et identité sélectionnés.

### UXR-0090 — SHOULD · P2 · MANUAL

**Règle.** Une palette de commandes peut accélérer la navigation experte sans remplacer les parcours visibles des novices.

**Preuve attendue.** Toutes les destinations importantes restent accessibles sans raccourci.

### UXR-0091 — MUST · P1 · SEMI

**Règle.** Les raccourcis clavier globaux doivent être découvrables, personnalisables si nécessaire et non conflictuels avec le navigateur ou les aides techniques.

**Preuve attendue.** Une aide liste les raccourcis et les tests couvrent les conflits.

### UXR-0092 — MUST NOT · P1 · MANUAL

**Règle.** Le logo ne doit pas être le seul moyen de revenir à l'accueil si sa fonction n'est pas évidente.

**Preuve attendue.** Une destination « Accueil » ou équivalente reste identifiable.

### UXR-0093 — MUST · P1 · AUTO

**Règle.** Les liens externes doivent être signalés lorsque leur ouverture ou leur contexte diffère de la navigation interne.

**Preuve attendue.** Le libellé ou l'icône possède une alternative accessible.

### UXR-0094 — SHOULD NOT · P2 · AUTO

**Règle.** Une nouvelle fenêtre ne devrait pas être ouverte sans bénéfice clair pour la tâche.

**Preuve attendue.** Toute ouverture externe est annoncée et sécurisée avec rel approprié.

### UXR-0095 — MUST · P1 · AUTO

**Règle.** Les routes protégées doivent expliquer un refus plutôt que rediriger silencieusement vers une page sans rapport.

**Preuve attendue.** Un 403 dédié décrit la capability manquante et le recours possible.

### UXR-0096 — MUST · P1 · MANUAL

**Règle.** Les erreurs 404 doivent proposer des voies de récupération adaptées au contexte.

**Preuve attendue.** La page offre recherche, parent pertinent ou retour sécurisé.

### UXR-0097 — SHOULD · P2 · SEMI

**Règle.** Les sections longues doivent offrir une navigation locale ou des ancres lorsque le balayage devient difficile.

**Preuve attendue.** Les titres et ancres restent synchronisés avec le scroll.

### UXR-0098 — MUST NOT · P1 · MANUAL

**Règle.** Les tabs ne doivent pas être utilisées pour masquer des étapes séquentielles obligatoires.

**Preuve attendue.** Un workflow séquentiel utilise des étapes ou pages distinctes.

### UXR-0099 — MUST · P1 · AUTO

**Règle.** Les onglets partageables doivent être encodés dans l'URL ou restaurables de manière déterministe.

**Preuve attendue.** Le rafraîchissement conserve l'onglet actif.

### UXR-0100 — MUST · P1 · SEMI

**Règle.** La navigation doit être testée avec clavier, lecteur d'écran, zoom, mobile et permissions réduites.

**Preuve attendue.** La matrice E2E couvre ces cinq contextes.

---

# Chapitre 6 — Profondeur de page, drill-down, drawers et sous-pages

**Objectif :** Donner de la profondeur au produit sans entasser toute l'information dans une page unique ni fragmenter inutilement le parcours.

**Sources fondatrices :** S06, S30

**Plage :** `UXR-0101` à `UXR-0120`

### UXR-0101 — MUST · P1 · MANUAL

**Règle.** Une vue L0 doit répondre à « que se passe-t-il et où regarder » sans prétendre contenir toute l'analyse.

**Preuve attendue.** Le contenu priorise état, exceptions, tendances et accès aux domaines propriétaires.

### UXR-0102 — MUST · P1 · MANUAL

**Règle.** Une vue L1 doit permettre de filtrer, comparer, sélectionner et agir sur les objets du domaine.

**Preuve attendue.** La page possède les manipulations nécessaires à la tâche opérationnelle.

### UXR-0103 — MUST · P1 · AUTO

**Règle.** Une vue L2 doit être une page adressable lorsqu'un objet possède plusieurs informations, relations, actions ou historiques.

**Preuve attendue.** La route contient un identifiant réel et survit au rafraîchissement.

### UXR-0104 — MUST · P1 · MANUAL

**Règle.** Une vue L3 doit regrouper preuves, comparaisons, logs ou contributions sans surcharger le résumé L2.

**Preuve attendue.** Les analyses profondes sont accessibles par onglet ou sous-route partageable.

### UXR-0105 — MUST · P1 · MANUAL

**Règle.** Un drawer doit servir à un aperçu rapide qui conserve le contexte de liste.

**Preuve attendue.** Il permet de consulter les faits essentiels et d'ouvrir la page complète.

### UXR-0106 — MUST NOT · P1 · MANUAL

**Règle.** Un drawer ne doit pas devenir la page principale d'un objet complexe.

**Preuve attendue.** Les workflows longs, historiques et multi-onglets basculent vers une route dédiée.

### UXR-0107 — MUST · P1 · MANUAL

**Règle.** Une modal doit être réservée à une confirmation, une saisie courte ou une décision bloquante.

**Preuve attendue.** Le contenu tient dans une tâche brève et possède une sortie claire.

### UXR-0108 — MUST NOT · P1 · MANUAL

**Règle.** Une modal ne doit pas contenir une navigation secondaire profonde ou un tableau d'investigation durable.

**Preuve attendue.** La spécification crée une page ou sous-page à la place.

### UXR-0109 — MUST · P1 · AUTO

**Règle.** Tout élément agrégé cliquable doit ouvrir un breakdown cohérent avec la valeur affichée.

**Preuve attendue.** Les filtres, période, unité et périmètre sont transmis au détail.

### UXR-0110 — MUST · P1 · SEMI

**Règle.** Le niveau de drill-down doit être déterminé avant l'implémentation du composant.

**Preuve attendue.** La Screen Specification décrit destination, données et comportement du retour.

### UXR-0111 — MUST · P1 · MANUAL

**Règle.** Un clic sur une ligne ou une carte doit avoir un résultat prévisible et cohérent dans tout le produit.

**Preuve attendue.** Le pattern de navigation est documenté et partagé.

### UXR-0112 — SHOULD · P2 · MANUAL

**Règle.** L'aperçu rapide doit éviter de répéter intégralement la page de détail.

**Preuve attendue.** Il montre seulement les informations nécessaires pour décider d'aller plus loin.

### UXR-0113 — MUST · P1 · SEMI

**Règle.** Les pages de détail doivent exposer les relations métier et non seulement les propriétés de l'objet.

**Preuve attendue.** Au moins les relations utiles à l'investigation sont navigables.

### UXR-0114 — MUST · P1 · AUTO

**Règle.** Le retour depuis un détail doit conserver l'objet ou la ligne d'origine visible lorsque possible.

**Preuve attendue.** La sélection et le scroll sont restaurés ou un repère est fourni.

### UXR-0115 — MUST NOT · P1 · MANUAL

**Règle.** Le drill-down ne doit pas aboutir à une page plus pauvre que l'aperçu qui l'a déclenché.

**Preuve attendue.** La page dédiée ajoute contexte, historique, relations ou actions vérifiables.

### UXR-0116 — MUST · P1 · AUTO

**Règle.** Les routes de détail doivent renvoyer 404 ou 403 réels, jamais un objet par défaut ou le premier objet disponible.

**Preuve attendue.** Les tests comparent plusieurs IDs valides et invalides.

### UXR-0117 — MUST · P1 · AUTO

**Règle.** Les pages parentes doivent pouvoir refléter un changement effectué dans un détail sans rechargement global inutile.

**Preuve attendue.** Le cache est invalidé précisément et l'état de liste reste cohérent.

### UXR-0118 — SHOULD · P2 · SEMI

**Règle.** Les liens profonds doivent pouvoir être partagés sans révéler des informations non autorisées dans l'URL.

**Preuve attendue.** Les paramètres sensibles restent côté serveur ou sont opaques.

### UXR-0119 — MUST · P1 · SEMI

**Règle.** Les sous-pages doivent partager un header d'entité stable pour réduire la désorientation.

**Preuve attendue.** Nom, statut, contexte et actions essentielles restent cohérents entre onglets.

### UXR-0120 — MUST · P1 · AUTO

**Règle.** La profondeur finale doit être validée sur un parcours complet, pas uniquement écran par écran.

**Preuve attendue.** Un test E2E traverse L0, L1, L2, L3 et revient au contexte initial.

---

# Chapitre 7 — Layout, grille et hiérarchie visuelle

**Objectif :** Structurer l'écran pour guider l'attention, préserver la lisibilité et permettre une densité professionnelle sans chaos visuel.

**Sources fondatrices :** S07, S08, S09, S11, S15

**Plage :** `UXR-0121` à `UXR-0140`

### UXR-0121 — MUST · P1 · MANUAL

**Règle.** Le layout doit refléter l'ordre de décision défini par le contrat de page.

**Preuve attendue.** Les premières zones contiennent contexte, état, exception et action principale.

### UXR-0122 — MUST · P1 · SEMI

**Règle.** Les alignements doivent suivre une grille ou des lignes directrices cohérentes.

**Preuve attendue.** Les bords, titres, valeurs et contrôles partagent des axes visibles.

### UXR-0123 — MUST NOT · P1 · MANUAL

**Règle.** Les espaces vides ne doivent pas être remplis par des cartes ou graphiques sans question utilisateur.

**Preuve attendue.** Chaque bloc possède un objectif et une source de données.

### UXR-0124 — MUST · P1 · MANUAL

**Règle.** La hiérarchie doit utiliser d'abord position, taille, espacement et typographie avant la couleur ou l'ombre.

**Preuve attendue.** Le sens reste compréhensible en niveaux de gris.

### UXR-0125 — MUST · P1 · MANUAL

**Règle.** Les éléments les plus importants doivent recevoir la plus grande priorité visuelle, pas nécessairement la plus grande surface.

**Preuve attendue.** La revue compare priorité métier et saillance perceptive.

### UXR-0126 — MUST · P1 · MANUAL

**Règle.** Les groupes visuels doivent correspondre à des relations sémantiques réelles.

**Preuve attendue.** La proximité et le contenant n'associent pas des informations sans lien.

### UXR-0127 — SHOULD · P2 · MANUAL

**Règle.** Le nombre de niveaux de surface simultanés doit rester limité pour éviter l'effet de panneaux imbriqués.

**Preuve attendue.** Les cartes dans les cartes sont supprimées ou justifiées.

### UXR-0128 — MUST · P1 · MANUAL

**Règle.** Les lignes de lecture et la densité doivent être adaptées à la tâche et au niveau d'expertise.

**Preuve attendue.** Le profil workstation n'utilise pas les mêmes espacements que le tactile.

### UXR-0129 — MUST · P1 · AUTO

**Règle.** Les zones interactives ne doivent pas se chevaucher ou dépendre de coordonnées fragiles.

**Preuve attendue.** Le layout reste utilisable au zoom et avec contenu long.

### UXR-0130 — MUST NOT · P1 · AUTO

**Règle.** Le positionnement absolu ne doit pas être utilisé pour la structure principale d'une page responsive.

**Preuve attendue.** La mise en page principale repose sur grid, flex ou flux normal.

### UXR-0131 — MUST · P1 · SEMI

**Règle.** Les largeurs maximales de contenu textuel doivent préserver une longueur de ligne lisible.

**Preuve attendue.** Les paragraphes ne s'étendent pas sur toute une grande workstation sans contrainte.

### UXR-0132 — MUST · P1 · AUTO

**Règle.** Les tableaux et graphiques doivent disposer d'un espace suffisant ou basculer vers un mode adapté.

**Preuve attendue.** Aucun contenu critique n'est compressé au point de devenir illisible.

### UXR-0133 — SHOULD · P2 · MANUAL

**Règle.** Les layouts répétitifs entre domaines doivent être évités lorsque les questions métier diffèrent.

**Preuve attendue.** Chaque page choisit la structure qui sert sa tâche principale.

### UXR-0134 — MUST · P1 · MANUAL

**Règle.** Une zone principale doit être identifiable sans ambiguïté parmi les panneaux secondaires.

**Preuve attendue.** Le focus visuel et la structure de titres désignent le contenu central.

### UXR-0135 — MUST · P1 · MANUAL

**Règle.** Les contrôles liés à une zone doivent être placés près de cette zone.

**Preuve attendue.** Un filtre local ne semble pas agir sur toute la page et inversement.

### UXR-0136 — MUST · P1 · AUTO

**Règle.** Les variations de hauteur dues au chargement doivent être réservées pour limiter les déplacements de layout.

**Preuve attendue.** Skeletons, dimensions d'images et placeholders stabilisent la géométrie.

### UXR-0137 — SHOULD · P2 · SEMI

**Règle.** Les panneaux secondaires peuvent être repliables sur laptop lorsque leur absence ne bloque pas la décision.

**Preuve attendue.** L'état replié est mémorisé et accessible.

### UXR-0138 — MUST · P1 · AUTO

**Règle.** Les contenus proches du bord d'écran doivent conserver une marge fonctionnelle et tactile.

**Preuve attendue.** Aucun contrôle n'est collé au viewport ou masqué par le système.

### UXR-0139 — MUST · P1 · AUTO

**Règle.** Le layout doit être testé avec données minimales, maximales, libellés longs et valeurs extrêmes.

**Preuve attendue.** Les stories de stress ne produisent ni overlap ni troncature silencieuse.

### UXR-0140 — MUST · P1 · MANUAL

**Règle.** Toute exception de grille doit être intentionnelle, documentée et visuellement alignée avec le reste du produit.

**Preuve attendue.** La PR explique la raison métier ou perceptive de la rupture.

---

# Chapitre 8 — Responsive et conception adaptative

**Objectif :** Adapter les priorités, interactions et contenus aux espaces disponibles plutôt que réduire mécaniquement le desktop.

**Sources fondatrices :** S01, S08, S09, S15

**Plage :** `UXR-0141` à `UXR-0160`

### UXR-0141 — MUST · P0 · AUTO

**Règle.** Toutes les fonctionnalités essentielles doivent rester accessibles à 320 CSS px de largeur ou à un zoom équivalent.

**Preuve attendue.** Les tests reflow n'imposent pas de scroll horizontal global.

### UXR-0142 — MUST · P0 · AUTO

**Règle.** Le texte doit pouvoir être agrandi à 200 % sans perte de contenu ni d'action.

**Preuve attendue.** Le test navigateur vérifie clipping, recouvrement et disparition.

### UXR-0143 — MUST · P1 · MANUAL

**Règle.** Le responsive doit prioriser les informations selon leur importance, pas simplement les empiler dans l'ordre DOM existant.

**Preuve attendue.** La Screen Specification définit les priorités par profil de viewport.

### UXR-0144 — MUST · P1 · MANUAL

**Règle.** Les breakpoints doivent être déclenchés par la rupture du contenu, non par des modèles d'appareils particuliers.

**Preuve attendue.** Les composants s'adaptent lorsque leur contenu ne tient plus correctement.

### UXR-0145 — MUST · P1 · AUTO

**Règle.** Chaque composant de données doit définir ses colonnes, métriques ou actions prioritaires par largeur disponible.

**Preuve attendue.** La configuration responsive est explicite et testée.

### UXR-0146 — MUST NOT · P0 · AUTO

**Règle.** Une navigation mobile ne doit pas masquer des domaines autorisés par une tranche arbitraire des premiers liens.

**Preuve attendue.** Un menu « Plus » ou une navigation complète reste disponible.

### UXR-0147 — MUST · P1 · MANUAL

**Règle.** Une table complexe doit proposer une stratégie mobile dédiée comme liste structurée, colonnes prioritaires ou page détail.

**Preuve attendue.** Le mobile ne dépend pas d'un scroll horizontal aveugle pour les tâches courantes.

### UXR-0148 — MUST · P1 · MANUAL

**Règle.** Les actions dangereuses doivent rester difficiles à déclencher accidentellement sur écran tactile.

**Preuve attendue.** Elles sont séparées, confirmées et non placées près des actions fréquentes.

### UXR-0149 — MUST · P1 · AUTO

**Règle.** Les overlays doivent tenir dans le viewport et permettre le scroll interne sans piéger l'utilisateur.

**Preuve attendue.** Les tests couvrent clavier virtuel, orientation et zoom.

### UXR-0150 — MUST · P1 · MANUAL

**Règle.** Le contenu critique ne doit pas être caché uniquement parce que l'écran est petit.

**Preuve attendue.** Il est reformulé, condensé ou déplacé vers une sous-page accessible.

### UXR-0151 — SHOULD · P2 · AUTO

**Règle.** Les layouts workstation peuvent utiliser des rails et panneaux simultanés, mais doivent dégrader vers une colonne principale cohérente.

**Preuve attendue.** Le passage de XL à laptop conserve le fil de décision.

### UXR-0152 — MUST · P1 · AUTO

**Règle.** Les contrôles de filtre doivent rester visibles ou clairement accessibles sur mobile.

**Preuve attendue.** Un indicateur montre les filtres actifs même lorsque le panneau est fermé.

### UXR-0153 — MUST · P1 · AUTO

**Règle.** Les changements d'orientation ne doivent pas perdre l'état ou la saisie en cours.

**Preuve attendue.** Les composants réutilisent le même modèle d'état lors du reflow.

### UXR-0154 — MUST · P1 · AUTO

**Règle.** Les images, graphiques et canvas doivent avoir des dimensions fluides et des limites explicites.

**Preuve attendue.** Ils ne débordent pas et conservent leur alternative textuelle.

### UXR-0155 — SHOULD · P2 · SEMI

**Règle.** Le contenu secondaire peut être différé sur mobile pour réduire le coût réseau et cognitif.

**Preuve attendue.** Le chargement différé ne bloque pas la tâche principale.

### UXR-0156 — MUST · P1 · AUTO

**Règle.** Les zones fixes comme topbar, bottom nav et toasts ne doivent pas masquer les actions ou le contenu.

**Preuve attendue.** Les safe areas et paddings compensatoires sont testés.

### UXR-0157 — MUST · P1 · AUTO

**Règle.** Les états hover doivent posséder un équivalent focus, actif ou explicite sur tactile.

**Preuve attendue.** Aucune information nécessaire ne dépend exclusivement du survol.

### UXR-0158 — MUST · P1 · SEMI

**Règle.** Le responsive doit être validé avec contenu localisé plus long et direction RTL lorsque le produit le prévoit.

**Preuve attendue.** Les captures couvrent au moins une langue expansive et un mode RTL.

### UXR-0159 — MUST · P1 · AUTO

**Règle.** Les tests doivent couvrir Desktop XL, Full HD, laptop, tablette et mobile selon le périmètre du produit.

**Preuve attendue.** La matrice de viewports est versionnée et exécutée en CI pour les écrans critiques.

### UXR-0160 — MUST NOT · P1 · AUTO

**Règle.** Une propriété CSS zoom ne doit pas être utilisée comme substitut global à une vraie densité responsive.

**Preuve attendue.** La densité est exprimée par tokens et composants adaptatifs.

---

# Chapitre 9 — Typographie, lisibilité et densité textuelle

**Objectif :** Créer une hiérarchie scannable, lisible et robuste aux préférences d'affichage, aux chiffres et aux langues.

**Sources fondatrices :** S01, S08, S09, S15

**Plage :** `UXR-0161` à `UXR-0180`

### UXR-0161 — MUST · P0 · AUTO

**Règle.** Aucun texte fonctionnel ne doit être inférieur à 10 px dans le profil workstation interne.

**Preuve attendue.** Le linter bloque les tailles sous le seuil hors cas documenté non fonctionnel.

### UXR-0162 — MUST · P1 · SEMI

**Règle.** Le corps de texte courant doit utiliser une taille et une hauteur de ligne adaptées à la lecture prolongée.

**Preuve attendue.** Les tokens définissent une rampe lisible et testée au zoom.

### UXR-0163 — MUST · P1 · AUTO

**Règle.** La hiérarchie typographique doit utiliser des rôles sémantiques stables plutôt que des tailles ad hoc par page.

**Preuve attendue.** Les styles portent des noms comme body, label, title et metric.

### UXR-0164 — MUST · P1 · AUTO

**Règle.** Une page doit posséder un seul titre principal de niveau 1 décrivant clairement son contenu.

**Preuve attendue.** Le DOM contient un h1 unique et pertinent.

### UXR-0165 — MUST · P1 · AUTO

**Règle.** Les niveaux de titres doivent suivre une structure logique sans être choisis pour leur apparence.

**Preuve attendue.** Le test de structure ne saute pas de niveau sans justification.

### UXR-0166 — MUST · P1 · AUTO

**Règle.** Les chiffres comparés en colonne doivent utiliser des chiffres tabulaires.

**Preuve attendue.** Les tokens ou styles numériques activent la variante appropriée.

### UXR-0167 — MUST · P1 · AUTO

**Règle.** Les unités, signes, décimales et séparateurs doivent être formatés de façon cohérente selon la locale et le domaine.

**Preuve attendue.** Une fonction de formatage centralisée est utilisée.

### UXR-0168 — MUST NOT · P1 · MANUAL

**Règle.** Les majuscules intégrales ne doivent pas être utilisées pour de longs textes ou comme unique hiérarchie.

**Preuve attendue.** Elles restent limitées aux labels courts et lisibles.

### UXR-0169 — MUST · P1 · MANUAL

**Règle.** La graisse ne doit pas être la seule différence entre deux niveaux lorsque le contraste hiérarchique est insuffisant.

**Preuve attendue.** Taille, espace ou position complètent la graisse.

### UXR-0170 — MUST · P1 · AUTO

**Règle.** Les textes sur une ligne doivent pouvoir se replier sans masquer une information essentielle.

**Preuve attendue.** Les libellés longs sont testés et les ellipses possèdent un accès au contenu complet.

### UXR-0171 — MUST NOT · P1 · MANUAL

**Règle.** Une ellipsis ne doit pas cacher silencieusement un identifiant, une erreur ou une valeur nécessaire à la décision.

**Preuve attendue.** Un tooltip accessible, une expansion ou une colonne adaptée expose la valeur.

### UXR-0172 — MUST · P1 · SEMI

**Règle.** Les polices doivent fournir les glyphes, accents, symboles et chiffres nécessaires aux langues et données supportées.

**Preuve attendue.** Les tests de glyph coverage couvrent les locales cibles.

### UXR-0173 — SHOULD · P2 · SEMI

**Règle.** Les polices système ou bien optimisées doivent être privilégiées lorsque la marque n'exige pas une famille spécifique.

**Preuve attendue.** Le coût réseau et le comportement de fallback sont mesurés.

### UXR-0174 — MUST · P1 · AUTO

**Règle.** Le chargement des polices ne doit pas rendre le texte invisible durablement.

**Preuve attendue.** font-display et fallback métriquement compatible sont configurés.

### UXR-0175 — MUST · P1 · AUTO

**Règle.** La longueur de ligne des contenus narratifs doit rester dans une plage confortable.

**Preuve attendue.** Un max-width en ch ou token équivalent limite les paragraphes.

### UXR-0176 — MUST · P1 · AUTO

**Règle.** Les labels doivent rester visibles même lorsque le champ contient une valeur.

**Preuve attendue.** Les placeholders ne remplacent pas les labels.

### UXR-0177 — MUST · P1 · MANUAL

**Règle.** Les acronymes et abréviations non évidents doivent être développés ou expliqués à la première occurrence.

**Preuve attendue.** Le glossaire ou le contenu contextuel fournit l'expansion.

### UXR-0178 — SHOULD · P2 · AUTO

**Règle.** Les variations de densité doivent modifier spacing et tailles dans une plage sûre, sans réduire la lisibilité sous les seuils.

**Preuve attendue.** Les profils workstation, compact et comfortable sont documentés.

### UXR-0179 — MUST · P1 · SEMI

**Règle.** Le texte doit conserver un contraste suffisant dans tous les états interactifs, y compris hover, selected et disabled informatif.

**Preuve attendue.** Les tests de contraste couvrent chaque variante.

### UXR-0180 — MUST · P1 · AUTO

**Règle.** La typographie doit être testée avec zoom 200 %, préférences de taille et contenu réel extrême.

**Preuve attendue.** Les golden screens incluent ces scénarios.

---

# Chapitre 10 — Couleur, contraste, thèmes et états visuels

**Objectif :** Utiliser la couleur comme système sémantique accessible et stable, jamais comme décoration ou unique porteur d'information.

**Sources fondatrices :** S01, S07, S09, S11, S13, S16

**Plage :** `UXR-0181` à `UXR-0200`

### UXR-0181 — MUST · P0 · AUTO

**Règle.** Le contraste du texte normal doit atteindre au moins 4,5:1 selon WCAG AA.

**Preuve attendue.** Un outil automatisé et une vérification des états réels confirment le ratio.

### UXR-0182 — MUST · P0 · SEMI

**Règle.** Le contraste des grands textes peut suivre le seuil WCAG de 3:1 uniquement lorsque leur taille et graisse répondent réellement à la définition applicable.

**Preuve attendue.** Le calcul documente taille, poids et arrière-plan.

### UXR-0183 — MUST · P0 · SEMI

**Règle.** Les composants graphiques essentiels, bordures de contrôle et icônes informatives doivent atteindre au moins 3:1 avec leur environnement adjacent.

**Preuve attendue.** Le scan de contraste non textuel couvre tous les états.

### UXR-0184 — MUST NOT · P0 · AUTO

**Règle.** La couleur ne doit jamais être l'unique moyen de transmettre statut, tendance, sélection ou erreur.

**Preuve attendue.** Un label, une icône, une forme ou un motif redondant est présent.

### UXR-0185 — MUST · P1 · AUTO

**Règle.** Les couleurs doivent provenir de tokens sémantiques et non de valeurs hexadécimales dispersées.

**Preuve attendue.** Le linter interdit les couleurs brutes hors fichiers de tokens autorisés.

### UXR-0186 — MUST · P1 · AUTO

**Règle.** Les tokens de couleur doivent distinguer primitives, alias sémantiques et tokens de composant.

**Preuve attendue.** La chaîne de résolution est documentée et sans cycles.

### UXR-0187 — MUST · P1 · AUTO

**Règle.** Un statut métier doit utiliser la même sémantique colorimétrique dans tout le produit.

**Preuve attendue.** Le registre de statuts centralise label, icône et token.

### UXR-0188 — MUST · P1 · AUTO

**Règle.** Les thèmes clair et sombre doivent être conçus et testés séparément, pas obtenus par inversion automatique.

**Preuve attendue.** Chaque thème possède des paires de contraste validées.

### UXR-0189 — MUST · P1 · MANUAL

**Règle.** Les surfaces adjacentes doivent rester distinguables sans dépendre d'ombres excessives.

**Preuve attendue.** Bordure, contraste de surface ou espace suffisent à la séparation.

### UXR-0190 — MUST NOT · P1 · MANUAL

**Règle.** Une teinte de marque ne doit pas être utilisée pour tous les appels à l'action, statuts et graphiques au détriment de la sémantique.

**Preuve attendue.** Les rôles brand, action, info, success, warning et danger sont séparés.

### UXR-0191 — MUST · P1 · AUTO

**Règle.** Les états hover, focus, pressed, selected, disabled et loading doivent être perceptibles et cohérents.

**Preuve attendue.** La story de chaque composant expose tous les états.

### UXR-0192 — MUST · P1 · MANUAL

**Règle.** Un état disabled qui doit rester informatif doit conserver une lisibilité suffisante malgré l'absence d'exigence WCAG stricte.

**Preuve attendue.** Le texte explique la raison et reste lisible dans le contexte produit.

### UXR-0193 — MUST · P1 · SEMI

**Règle.** Les palettes de graphiques doivent rester distinguables pour les déficiences de perception des couleurs.

**Preuve attendue.** Des motifs, marqueurs ou labels directs complètent les couleurs.

### UXR-0194 — MUST · P1 · AUTO

**Règle.** Les valeurs positives et négatives ne doivent pas être codées uniquement vert et rouge.

**Preuve attendue.** Signe, flèche, libellé ou position complète la sémantique.

### UXR-0195 — MUST · P1 · SEMI

**Règle.** Les overlays et focus rings doivent conserver leur contraste sur toutes les surfaces possibles.

**Preuve attendue.** Les tests utilisent les combinaisons de fond réelles.

### UXR-0196 — SHOULD · P2 · MANUAL

**Règle.** Le nombre de couleurs simultanées doit être limité à ce qui aide réellement la discrimination.

**Preuve attendue.** La revue supprime les couleurs décoratives concurrentes.

### UXR-0197 — MUST · P1 · AUTO

**Règle.** Les états stale, partial, unknown et unavailable doivent posséder des traitements distincts des erreurs et succès.

**Preuve attendue.** Le registre visuel montre leurs différences de label et d'icône.

### UXR-0198 — MUST NOT · P1 · SEMI

**Règle.** Un dégradé, effet glow ou transparence ne doit pas réduire la lisibilité des données et contrôles.

**Preuve attendue.** Le contraste est mesuré sur le point le plus défavorable.

### UXR-0199 — MUST · P1 · AUTO

**Règle.** Les préférences de contraste élevé du système doivent être supportées pour les écrans critiques.

**Preuve attendue.** Les tests forced-colors ou équivalents gardent contrôles et focus visibles.

### UXR-0200 — MUST · P1 · SEMI

**Règle.** Toute nouvelle couleur sémantique doit être ajoutée au design system avec usage, contraste, thèmes et restrictions.

**Preuve attendue.** La PR de token contient documentation et tests.

---

# Chapitre 11 — Espacement, forme, bordures, élévation et densité

**Objectif :** Limiter les décisions arbitraires de style et utiliser les fondations visuelles pour clarifier groupes, importance et interactivité.

**Sources fondatrices :** S07, S09, S11, S23

**Plage :** `UXR-0201` à `UXR-0220`

### UXR-0201 — MUST · P1 · AUTO

**Règle.** Tous les espacements récurrents doivent provenir d'une échelle de tokens limitée.

**Preuve attendue.** Le linter signale les valeurs hors échelle dans les composants de production.

### UXR-0202 — MUST · P1 · MANUAL

**Règle.** L'espacement doit exprimer la relation entre éléments proches et groupes distincts.

**Preuve attendue.** L'espace interne d'un groupe est inférieur à l'espace entre groupes.

### UXR-0203 — MUST NOT · P1 · AUTO

**Règle.** Des marges négatives ne doivent pas corriger une architecture de layout défaillante.

**Preuve attendue.** Toute marge négative est documentée et testée sur tous les viewports.

### UXR-0204 — MUST · P1 · AUTO

**Règle.** Les rayons de bordure doivent être définis par rôles et non choisis page par page.

**Preuve attendue.** Les composants utilisent une petite échelle cohérente.

### UXR-0205 — MUST · P1 · MANUAL

**Règle.** La forme ne doit pas être le seul indicateur d'un état ou d'une action.

**Preuve attendue.** Label, position ou icône complète la forme.

### UXR-0206 — MUST · P1 · MANUAL

**Règle.** Les bordures doivent séparer ou délimiter une fonction réelle, pas quadriller systématiquement chaque élément.

**Preuve attendue.** La revue supprime les lignes sans rôle perceptif.

### UXR-0207 — SHOULD · P2 · AUTO

**Règle.** Les ombres doivent être réservées aux overlays ou changements d'élévation utiles.

**Preuve attendue.** Le design system limite les niveaux d'ombre et leurs usages.

### UXR-0208 — MUST NOT · P1 · MANUAL

**Règle.** Les ombres fortes ne doivent pas compenser un contraste de surface insuffisant.

**Preuve attendue.** Les surfaces sont d'abord distinguées par tokens et bordures accessibles.

### UXR-0209 — MUST · P1 · AUTO

**Règle.** Les zones tactiles doivent inclure un espace suffisant autour du contenu visible.

**Preuve attendue.** La hitbox respecte le standard interne même si l'icône est petite.

### UXR-0210 — MUST · P1 · MANUAL

**Règle.** Les composants compacts doivent conserver une séparation suffisante pour éviter les erreurs de sélection.

**Preuve attendue.** Les tests tactiles et pointer évaluent les éléments adjacents.

### UXR-0211 — MUST · P1 · AUTO

**Règle.** La densité doit être un profil explicite partagé, pas une série de overrides locaux.

**Preuve attendue.** Les tokens de densité pilotent hauteur, padding et typographie dans des limites sûres.

### UXR-0212 — MUST · P1 · AUTO

**Règle.** Les variations de densité ne doivent pas modifier la sémantique, l'ordre ou la disponibilité des actions.

**Preuve attendue.** Le même test fonctionnel passe dans chaque profil.

### UXR-0213 — MUST NOT · P1 · MANUAL

**Règle.** Une carte ne doit pas être imbriquée dans une carte uniquement pour créer du relief.

**Preuve attendue.** Les regroupements sémantiques utilisent sections, séparateurs ou sous-grilles.

### UXR-0214 — MUST · P1 · SEMI

**Règle.** Les séparateurs doivent posséder un contraste suffisant lorsqu'ils sont nécessaires à la compréhension.

**Preuve attendue.** Le contraste non textuel est contrôlé.

### UXR-0215 — MUST · P1 · AUTO

**Règle.** Les tokens de taille doivent inclure les dimensions des contrôles, icônes et zones interactives.

**Preuve attendue.** Aucune hauteur de contrôle critique n'est codée en dur dans une feature.

### UXR-0216 — SHOULD · P2 · SEMI

**Règle.** Les espaces verticaux doivent suivre un rythme cohérent afin d'améliorer le balayage.

**Preuve attendue.** La page n'accumule pas de valeurs presque identiques sans raison.

### UXR-0217 — MUST · P1 · AUTO

**Règle.** Les panneaux redimensionnables doivent imposer des limites minimales et maximales utilisables.

**Preuve attendue.** Le contenu reste lisible et les poignées sont accessibles au clavier.

### UXR-0218 — MUST · P1 · MANUAL

**Règle.** Les surfaces sticky ou fixes doivent conserver une séparation perceptible du contenu qui défile.

**Preuve attendue.** Le comportement est visible sans masquer les données.

### UXR-0219 — MUST · P1 · AUTO

**Règle.** Les tokens de forme et d'espacement doivent fonctionner dans tous les thèmes et densités supportés.

**Preuve attendue.** La matrice de stories couvre les combinaisons principales.

### UXR-0220 — MUST · P1 · MANUAL

**Règle.** Toute nouvelle valeur fondation doit être justifiée par un besoin non couvert avant d'élargir l'échelle.

**Preuve attendue.** La PR explique pourquoi un token existant ne convient pas.

---

# Chapitre 12 — Iconographie, images, illustrations et médias

**Objectif :** Employer les médias pour renforcer la compréhension sans introduire d'ambiguïté, de dette visuelle ou de barrière d'accessibilité.

**Sources fondatrices :** S01, S07, S08, S15, S16

**Plage :** `UXR-0221` à `UXR-0240`

### UXR-0221 — MUST · P0 · AUTO

**Règle.** Toute image informative doit posséder une alternative textuelle équivalente à son objectif.

**Preuve attendue.** Le test DOM vérifie alt ou description associée pertinente.

### UXR-0222 — MUST · P0 · AUTO

**Règle.** Toute image purement décorative doit être ignorée par les technologies d'assistance.

**Preuve attendue.** Elle utilise alt vide ou un traitement décoratif approprié.

### UXR-0223 — MUST · P1 · AUTO

**Règle.** Une icône interactive doit avoir un nom accessible décrivant son action.

**Preuve attendue.** Le bouton possède un label visible ou aria-label cohérent.

### UXR-0224 — MUST NOT · P1 · MANUAL

**Règle.** Une icône seule ne doit pas représenter une action rare ou ambiguë sans aide visible ou tooltip accessible.

**Preuve attendue.** Un test novice peut prédire l'action.

### UXR-0225 — MUST · P1 · SEMI

**Règle.** Les icônes d'un même ensemble doivent partager style, épaisseur, grille et taille optique.

**Preuve attendue.** Le design system fournit une bibliothèque approuvée.

### UXR-0226 — MUST · P1 · MANUAL

**Règle.** Les icônes ne doivent pas être utilisées comme simples ornements dans chaque titre ou carte.

**Preuve attendue.** Chaque icône apporte reconnaissance ou signification.

### UXR-0227 — MUST · P1 · AUTO

**Règle.** Les icônes de statut doivent être accompagnées d'un texte ou d'un nom accessible.

**Preuve attendue.** La signification reste compréhensible sans voir la forme.

### UXR-0228 — MUST · P1 · AUTO

**Règle.** Les images de texte doivent être évitées lorsque le texte HTML peut fournir la même information.

**Preuve attendue.** Le contenu reste redimensionnable, traduisible et sélectionnable.

### UXR-0229 — MUST · P1 · SEMI

**Règle.** Les graphiques complexes doivent posséder une description, un résumé et une alternative tabulaire lorsque nécessaire.

**Preuve attendue.** Un utilisateur non visuel peut obtenir les tendances et valeurs importantes.

### UXR-0230 — MUST · P1 · AUTO

**Règle.** Les médias doivent déclarer leurs dimensions ou réserver leur espace avant chargement.

**Preuve attendue.** Le CLS lié aux médias reste dans le budget.

### UXR-0231 — MUST · P1 · AUTO

**Règle.** Les formats et résolutions d'images doivent être adaptés à la taille rendue et au DPR.

**Preuve attendue.** Le pipeline produit srcset, formats modernes ou équivalent.

### UXR-0232 — MUST NOT · P1 · AUTO

**Règle.** Une image lourde ne doit pas être chargée pour un élément non visible ou non essentiel sans stratégie de priorité.

**Preuve attendue.** Le chargement différé et la priorité sont mesurés.

### UXR-0233 — MUST · P1 · SEMI

**Règle.** Les images générées ou modifiées par IA doivent être identifiées lorsque cette provenance est pertinente pour la confiance.

**Preuve attendue.** La métadonnée ou le contenu explique l'origine selon la politique produit.

### UXR-0234 — MUST · P1 · AUTO

**Règle.** Les avatars ne doivent pas servir d'unique identifiant de personne.

**Preuve attendue.** Nom ou initiales accessibles accompagnent l'image.

### UXR-0235 — MUST · P1 · MANUAL

**Règle.** Les drapeaux ne doivent pas représenter des langues.

**Preuve attendue.** Les langues utilisent leur nom ou code localisé.

### UXR-0236 — MUST · P1 · MANUAL

**Règle.** Les symboles culturels doivent être évalués dans les régions visées.

**Preuve attendue.** La revue de localisation signale les significations ambiguës ou offensantes.

### UXR-0237 — MUST · P1 · SEMI

**Règle.** Les vidéos nécessaires à une tâche doivent proposer sous-titres, transcription et contrôles accessibles.

**Preuve attendue.** Les tests vérifient clavier, volume, pause et alternatives.

### UXR-0238 — MUST NOT · P0 · AUTO

**Règle.** Un média ne doit pas démarrer automatiquement avec du son.

**Preuve attendue.** Le comportement par défaut reste silencieux et contrôlable.

### UXR-0239 — MUST · P1 · AUTO

**Règle.** Les animations ou vidéos doivent respecter prefers-reduced-motion et permettre la pause lorsque nécessaire.

**Preuve attendue.** Le mode réduit supprime ou simplifie le mouvement non essentiel.

### UXR-0240 — MUST · P1 · SEMI

**Règle.** Toute nouvelle ressource média doit avoir un propriétaire, une licence et une stratégie de remplacement.

**Preuve attendue.** Le dépôt contient provenance et droits d'utilisation.

---

# Chapitre 13 — Mouvement, transitions et micro-interactions

**Objectif :** Utiliser le mouvement pour expliquer les changements d'état et préserver l'orientation, jamais pour distraire ou ralentir.

**Sources fondatrices :** S01, S07, S09, S16

**Plage :** `UXR-0241` à `UXR-0260`

### UXR-0241 — MUST · P1 · MANUAL

**Règle.** Toute animation doit avoir une fonction liée à l'état, l'orientation, la progression ou le feedback.

**Preuve attendue.** La spécification nomme l'information transmise par le mouvement.

### UXR-0242 — MUST NOT · P1 · MANUAL

**Règle.** Une animation ne doit pas être ajoutée uniquement pour rendre l'interface « vivante ».

**Preuve attendue.** La revue supprime tout mouvement sans bénéfice utilisateur mesurable.

### UXR-0243 — MUST · P0 · AUTO

**Règle.** Les préférences prefers-reduced-motion doivent être respectées.

**Preuve attendue.** Le test réduit ou supprime les animations non essentielles.

### UXR-0244 — MUST · P0 · SEMI

**Règle.** Aucun contenu ne doit clignoter au-delà des seuils de sécurité applicables.

**Preuve attendue.** Les médias et animations sont contrôlés contre le risque de flash.

### UXR-0245 — MUST · P1 · AUTO

**Règle.** Les transitions doivent être courtes et cohérentes avec la distance et l'importance du changement.

**Preuve attendue.** Les tokens de durée et easing sont utilisés.

### UXR-0246 — MUST NOT · P1 · AUTO

**Règle.** transition: all ne doit pas être utilisée dans le code de production.

**Preuve attendue.** Chaque propriété animée est explicitement listée.

### UXR-0247 — MUST · P1 · AUTO

**Règle.** Les animations doivent privilégier transform et opacity pour éviter les recalculs de layout coûteux.

**Preuve attendue.** Les profils de performance ne montrent pas de jank lié au mouvement.

### UXR-0248 — MUST · P1 · AUTO

**Règle.** Un changement d'état critique ne doit pas dépendre uniquement d'une animation fugace.

**Preuve attendue.** Le nouvel état persiste par texte, icône ou statut.

### UXR-0249 — MUST · P1 · SEMI

**Règle.** L'ouverture et la fermeture d'un overlay doivent préserver la relation avec l'élément déclencheur.

**Preuve attendue.** Le mouvement et le focus indiquent origine et destination.

### UXR-0250 — MUST · P1 · MANUAL

**Règle.** Les listes réordonnées doivent permettre de comprendre ce qui a changé.

**Preuve attendue.** Un feedback textuel ou spatial accompagne la transition.

### UXR-0251 — SHOULD · P2 · AUTO

**Règle.** Les animations de chargement répétées doivent être synchronisées pour éviter un écran visuellement bruyant.

**Preuve attendue.** Les skeletons utilisent une cadence commune.

### UXR-0252 — MUST NOT · P1 · AUTO

**Règle.** Un skeleton ne doit pas simuler une structure différente du contenu final.

**Preuve attendue.** La transition vers les données évite les déplacements inattendus.

### UXR-0253 — MUST · P1 · AUTO

**Règle.** Une animation interrompue par navigation ou changement d'état doit se terminer proprement.

**Preuve attendue.** Aucun composant ne reste bloqué en état intermédiaire.

### UXR-0254 — MUST · P1 · MANUAL

**Règle.** Le mouvement ne doit pas retarder l'accès à une action urgente.

**Preuve attendue.** Les actions critiques restent immédiatement disponibles ou l'animation est contournable.

### UXR-0255 — MUST · P1 · SEMI

**Règle.** Les indicateurs de progression indéterminée et déterminée doivent être choisis selon la connaissance réelle de l'avancement.

**Preuve attendue.** Une durée inconnue n'affiche pas un pourcentage fabriqué.

### UXR-0256 — MUST · P1 · AUTO

**Règle.** Une animation longue doit pouvoir être ignorée, accélérée ou interrompue.

**Preuve attendue.** Le parcours ne force pas l'attente d'un effet non nécessaire.

### UXR-0257 — SHOULD · P2 · AUTO

**Règle.** Les micro-interactions doivent renforcer la cohérence du design system plutôt que varier par feature.

**Preuve attendue.** Les mêmes états utilisent les mêmes durées et comportements.

### UXR-0258 — MUST · P1 · MANUAL

**Règle.** Les transitions d'état en temps réel doivent éviter de capter l'attention pour des événements non critiques.

**Preuve attendue.** La priorité d'animation suit la sévérité métier.

### UXR-0259 — MUST · P1 · SEMI

**Règle.** Les animations doivent être testées sous charge CPU réduite et sur matériel moins performant.

**Preuve attendue.** Le produit reste manipulable sans frames longues.

### UXR-0260 — MUST · P1 · SEMI

**Règle.** Tout nouveau pattern de mouvement doit documenter son objectif, sa durée, son easing et son mode réduit.

**Preuve attendue.** La story du composant inclut ces variantes.

---

# Chapitre 14 — Fondations d'accessibilité et conception inclusive

**Objectif :** Intégrer l'accessibilité comme propriété du produit complet, au-delà de la conformité automatique de composants isolés.

**Sources fondatrices :** S01, S02, S17

**Plage :** `UXR-0261` à `UXR-0280`

### UXR-0261 — MUST · P0 · SEMI

**Règle.** Les parcours et composants de production doivent viser au minimum WCAG 2.2 niveau AA.

**Preuve attendue.** La matrice de conformité et les tests couvrent les critères applicables.

### UXR-0262 — MUST · P0 · MANUAL

**Règle.** L'accessibilité doit être traitée dès la spécification et non ajoutée après le développement.

**Preuve attendue.** Chaque Screen Specification inclut clavier, sémantique, zoom, contraste et alternatives.

### UXR-0263 — MUST · P0 · SEMI

**Règle.** L'utilisation de composants accessibles ne dispense pas de tester le parcours complet.

**Preuve attendue.** Les tests E2E couvrent ordre, messages, focus et états combinés.

### UXR-0264 — MUST · P0 · AUTO

**Règle.** Le HTML natif approprié doit être préféré à une reconstruction ARIA équivalente.

**Preuve attendue.** Le code utilise button, a, input, table et landmarks quand ils conviennent.

### UXR-0265 — MUST NOT · P0 · SEMI

**Règle.** Une ARIA incorrecte ne doit pas être ajoutée pour satisfaire un linter.

**Preuve attendue.** La sémantique est vérifiée dans l'arbre d'accessibilité et avec interaction réelle.

### UXR-0266 — MUST · P0 · AUTO

**Règle.** Toutes les fonctionnalités doivent être disponibles au clavier sauf gestes intrinsèquement dépendants d'un tracé libre.

**Preuve attendue.** Le parcours sans souris atteint et active chaque contrôle.

### UXR-0267 — MUST · P0 · SEMI

**Règle.** Le contenu doit rester compréhensible sans perception de couleur, son, position ou forme seule.

**Preuve attendue.** Des alternatives textuelles et structurelles redondantes existent.

### UXR-0268 — MUST · P0 · AUTO

**Règle.** Le zoom navigateur à 200 % et le reflow jusqu'à 320 CSS px doivent préserver contenu et actions.

**Preuve attendue.** Les tests automatiques et manuels n'observent aucune perte fonctionnelle.

### UXR-0269 — MUST · P0 · AUTO

**Règle.** Les cibles pointer doivent respecter au minimum WCAG 2.2 et le standard interne de 44 px pour le tactile principal.

**Preuve attendue.** Les exceptions sont documentées et l'espacement compense les petites cibles.

### UXR-0270 — MUST · P0 · SEMI

**Règle.** Les contenus temporels, animés ou auto-actualisés doivent fournir pause, arrêt ou contrôle lorsque requis.

**Preuve attendue.** Le test vérifie la capacité de stabiliser l'expérience.

### UXR-0271 — MUST · P0 · SEMI

**Règle.** Les erreurs, avertissements et succès doivent être annoncés de façon accessible au moment pertinent.

**Preuve attendue.** Le rôle live ou le focus est choisi sans produire de bavardage excessif.

### UXR-0272 — MUST · P0 · AUTO

**Règle.** Les contrôles doivent avoir un nom accessible, un rôle et un état corrects.

**Preuve attendue.** Les snapshots ARIA et tests par rôle valident le rendu.

### UXR-0273 — MUST · P0 · AUTO

**Règle.** L'ordre de lecture programmatique doit suivre l'ordre logique de la tâche.

**Preuve attendue.** Le DOM n'est pas réordonné uniquement par CSS de façon trompeuse.

### UXR-0274 — MUST · P0 · AUTO

**Règle.** Les utilisateurs doivent pouvoir agrandir le texte et utiliser leurs préférences de contraste, police et mouvement.

**Preuve attendue.** Aucune meta viewport ou CSS ne bloque ces adaptations.

### UXR-0275 — MUST · P0 · SEMI

**Règle.** Les contenus multimédias doivent fournir les alternatives nécessaires à l'information et à l'interaction.

**Preuve attendue.** Sous-titres, transcription, audiodescription ou texte équivalent sont présents selon le cas.

### UXR-0276 — MUST · P0 · MANUAL

**Règle.** Les composants doivent être testés avec au moins un lecteur d'écran représentatif sur les parcours critiques.

**Preuve attendue.** Le rapport consigne navigateur, lecteur, version et résultat.

### UXR-0277 — MUST · P1 · MANUAL

**Règle.** Les tests inclusifs doivent considérer limitations permanentes, temporaires et situationnelles.

**Preuve attendue.** Les scénarios couvrent diversité de capacités et de contextes.

### UXR-0278 — MUST · P0 · SEMI

**Règle.** Une dérogation d'accessibilité doit être temporaire, visible et accompagnée d'une mesure compensatoire.

**Preuve attendue.** Le registre contient gravité, utilisateurs affectés, échéance et ticket.

### UXR-0279 — MUST NOT · P0 · MANUAL

**Règle.** Une fonctionnalité inaccessible ne doit pas être présentée comme terminée parce qu'un scan automatisé est vert.

**Preuve attendue.** La Definition of Done exige contrôles automatiques et manuels.

### UXR-0280 — MUST · P0 · SEMI

**Règle.** Toute régression d'accessibilité critique doit bloquer la release comme une régression fonctionnelle.

**Preuve attendue.** La CI et le processus incident classent ces défauts comme bloquants.

---

# Chapitre 15 — Clavier, focus et ordre d’interaction

**Objectif :** Garantir une interaction complète, visible et prévisible sans souris ni écran tactile.

**Sources fondatrices :** S01, S02

**Plage :** `UXR-0281` à `UXR-0300`

### UXR-0281 — MUST · P0 · AUTO

**Règle.** Chaque contrôle interactif doit être atteignable au clavier dans un ordre logique.

**Preuve attendue.** Un test Tab et Shift+Tab couvre le parcours complet.

### UXR-0282 — MUST · P0 · SEMI

**Règle.** Le focus clavier doit toujours être visible avec un contraste et une surface suffisants.

**Preuve attendue.** Le focus reste perceptible sur tous les thèmes et états.

### UXR-0283 — MUST NOT · P0 · AUTO

**Règle.** outline: none ou outline: 0 ne doit pas supprimer le focus sans remplacement équivalent.

**Preuve attendue.** Le linter bloque les suppressions non compensées.

### UXR-0284 — MUST · P0 · AUTO

**Règle.** Aucun composant ne doit créer de piège clavier involontaire.

**Preuve attendue.** L'utilisateur peut quitter chaque zone avec les commandes attendues.

### UXR-0285 — MUST · P0 · AUTO

**Règle.** Les modales doivent déplacer le focus à l'intérieur, le contenir, puis le restaurer au déclencheur.

**Preuve attendue.** Les tests couvrent ouverture, Tab, Escape et fermeture.

### UXR-0286 — MUST · P0 · AUTO

**Règle.** Le focus ne doit pas être masqué par un header, footer ou overlay sticky.

**Preuve attendue.** Le scroll automatique laisse l'élément focalisé entièrement ou partiellement visible selon WCAG.

### UXR-0287 — MUST · P0 · AUTO

**Règle.** Un tabindex positif ne doit pas être utilisé pour réordonner artificiellement le focus.

**Preuve attendue.** Le DOM porte l'ordre logique et tabindex vaut 0 ou -1 selon le besoin.

### UXR-0288 — MUST · P1 · AUTO

**Règle.** Les widgets composites doivent suivre le modèle clavier WAI-ARIA correspondant.

**Preuve attendue.** Flèches, Home, End, Enter, Space et Escape sont testés selon le pattern.

### UXR-0289 — MUST · P1 · SEMI

**Règle.** Les raccourcis à caractère unique doivent pouvoir être désactivés, remappés ou limités au focus pertinent.

**Preuve attendue.** La configuration évite les déclenchements avec technologies vocales.

### UXR-0290 — MUST · P1 · AUTO

**Règle.** Un clic sur une carte entière ne doit pas créer plusieurs destinations ambiguës au clavier.

**Preuve attendue.** La structure sépare lien principal et actions secondaires.

### UXR-0291 — MUST · P1 · AUTO

**Règle.** Les éléments non interactifs ne doivent pas recevoir de focus uniquement pour être annoncés.

**Preuve attendue.** La lecture sémantique utilise titres, régions ou descriptions appropriées.

### UXR-0292 — MUST · P1 · MANUAL

**Règle.** Le focus programmatique doit être déplacé seulement lorsqu'il aide l'utilisateur à comprendre un changement.

**Preuve attendue.** Chaque déplacement possède une raison documentée et prévisible.

### UXR-0293 — MUST · P1 · AUTO

**Règle.** Après une suppression, le focus doit aller vers un élément logique proche ou le message de résultat.

**Preuve attendue.** Le test évite un retour au début de page ou une perte de focus.

### UXR-0294 — MUST · P1 · AUTO

**Règle.** Après validation avec erreurs, le focus doit atteindre un résumé ou le premier champ invalide selon le pattern choisi.

**Preuve attendue.** Les messages et liens d'erreur restent cohérents.

### UXR-0295 — MUST · P1 · AUTO

**Règle.** Les menus doivent s'ouvrir et se fermer avec les touches attendues sans déclencher l'action du parent.

**Preuve attendue.** Le test clavier couvre activation, navigation et Escape.

### UXR-0296 — MUST · P1 · SEMI

**Règle.** Les zones scrollables au clavier doivent être identifiables et utilisables sans capturer inutilement les flèches.

**Preuve attendue.** Le comportement natif est conservé tant qu'un widget spécialisé n'est pas requis.

### UXR-0297 — MUST · P1 · AUTO

**Règle.** Les contrôles drag-and-drop doivent proposer une alternative clavier complète.

**Preuve attendue.** Des boutons ou menus permettent les mêmes réorganisations avec feedback.

### UXR-0298 — MUST · P1 · AUTO

**Règle.** Le focus ne doit pas être réinitialisé à chaque mise à jour temps réel ou refetch.

**Preuve attendue.** Les clés et re-renders préservent l'élément actif.

### UXR-0299 — MUST · P1 · AUTO

**Règle.** Les skip links doivent permettre d'atteindre rapidement le contenu principal et les zones critiques des interfaces denses.

**Preuve attendue.** Ils sont visibles au focus et testés.

### UXR-0300 — MUST · P0 · MANUAL

**Règle.** Chaque nouvelle interaction personnalisée doit être testée uniquement au clavier avant approbation.

**Preuve attendue.** La checklist de revue contient le résultat et les touches utilisées.

---

# Chapitre 16 — Sémantique HTML, lecteurs d’écran et arbre d’accessibilité

**Objectif :** Faire correspondre la structure programmée à la structure perçue afin que l'interface reste compréhensible hors présentation visuelle.

**Sources fondatrices :** S01, S02, S20

**Plage :** `UXR-0301` à `UXR-0320`

### UXR-0301 — MUST · P0 · AUTO

**Règle.** Chaque page doit utiliser un landmark main unique pour son contenu principal.

**Preuve attendue.** Le snapshot ARIA expose un main identifiable.

### UXR-0302 — MUST · P1 · AUTO

**Règle.** Les zones répétées comme navigation, recherche et aside doivent avoir des landmarks et noms distincts lorsque plusieurs existent.

**Preuve attendue.** Les régions sont différenciables dans la liste des landmarks.

### UXR-0303 — MUST · P0 · AUTO

**Règle.** Les titres doivent former une structure hiérarchique cohérente et descriptive.

**Preuve attendue.** Un audit de headings confirme niveaux et libellés.

### UXR-0304 — MUST · P0 · AUTO

**Règle.** Les boutons, liens, champs et widgets doivent posséder des noms accessibles uniques dans leur contexte.

**Preuve attendue.** Les tests getByRole avec name sélectionnent sans ambiguïté.

### UXR-0305 — MUST NOT · P0 · AUTO

**Règle.** Un élément focusable ne doit pas être caché aux technologies d'assistance avec aria-hidden.

**Preuve attendue.** Le linter et le test DOM détectent cette contradiction.

### UXR-0306 — MUST · P0 · AUTO

**Règle.** Les états checked, selected, expanded, pressed, invalid et disabled doivent être exposés lorsque le widget les possède.

**Preuve attendue.** Le snapshot ARIA reflète les transitions réelles.

### UXR-0307 — MUST · P0 · SEMI

**Règle.** Les mises à jour dynamiques importantes doivent être annoncées par une région live adaptée à leur priorité.

**Preuve attendue.** Le test lecteur d'écran vérifie une annonce utile et non répétitive.

### UXR-0308 — MUST NOT · P1 · MANUAL

**Règle.** Une région aria-live ne doit pas annoncer chaque tick, prix ou événement non critique d'un flux rapide.

**Preuve attendue.** Les événements sont regroupés et filtrés par importance.

### UXR-0309 — MUST · P0 · AUTO

**Règle.** Les tableaux de données doivent utiliser caption, en-têtes et associations appropriées.

**Preuve attendue.** Le DOM expose lignes et colonnes compréhensibles.

### UXR-0310 — MUST · P1 · AUTO

**Règle.** Les listes visuelles doivent utiliser des structures de liste lorsqu'elles représentent réellement une collection.

**Preuve attendue.** Le lecteur d'écran annonce le nombre et les éléments.

### UXR-0311 — MUST · P1 · AUTO

**Règle.** Les groupes de contrôles liés doivent être programmatiquement regroupés et nommés.

**Preuve attendue.** fieldset, legend ou group avec label est présent.

### UXR-0312 — MUST · P1 · AUTO

**Règle.** Les descriptions supplémentaires doivent utiliser aria-describedby ou du texte associé sans remplacer le nom principal.

**Preuve attendue.** Le nom reste court et la description apporte le contexte.

### UXR-0313 — MUST NOT · P1 · AUTO

**Règle.** aria-label ne doit pas écraser un libellé visible avec un terme différent.

**Preuve attendue.** Le nom accessible commence par ou correspond au texte visible pertinent.

### UXR-0314 — MUST · P1 · AUTO

**Règle.** Les icônes décoratives doivent être masquées de l'arbre d'accessibilité.

**Preuve attendue.** Elles n'ajoutent pas de bruit à l'annonce du contrôle.

### UXR-0315 — MUST · P1 · SEMI

**Règle.** Les contenus conditionnels doivent être insérés à un endroit logique dans l'ordre de lecture.

**Preuve attendue.** Le focus et la lecture trouvent le nouveau contenu sans saut incohérent.

### UXR-0316 — MUST · P1 · MANUAL

**Règle.** Les détails techniques volumineux doivent être regroupés dans une région nommée et repliable lorsque pertinent.

**Preuve attendue.** Le lecteur peut ignorer ou ouvrir la section de diagnostic.

### UXR-0317 — MUST · P1 · SEMI

**Règle.** Les valeurs abrégées visuellement doivent fournir une forme prononçable ou un libellé accessible lorsque nécessaire.

**Preuve attendue.** Les unités et symboles sont compris lors de l'écoute.

### UXR-0318 — MUST · P1 · AUTO

**Règle.** Le document doit définir correctement la langue globale et les changements de langue internes.

**Preuve attendue.** Les attributs lang sont présents et valides.

### UXR-0319 — MUST · P1 · AUTO

**Règle.** Le sens d'une séquence ne doit pas reposer sur un ordre CSS différent du DOM.

**Preuve attendue.** L'ordre de lecture, focus et perception visuelle restent compatibles.

### UXR-0320 — MUST · P0 · AUTO

**Règle.** Chaque écran critique doit disposer d'un snapshot de l'arbre d'accessibilité ou d'assertions équivalentes revues.

**Preuve attendue.** Les changements structurels produisent un diff explicite en CI.

---

# Chapitre 17 — Formulaires, saisie et choix

**Objectif :** Réduire les erreurs et l'effort de saisie grâce à des contrôles natifs, des labels clairs et une progression prévisible.

**Sources fondatrices :** S01, S02, S10, S20

**Plage :** `UXR-0321` à `UXR-0340`

### UXR-0321 — MUST · P0 · AUTO

**Règle.** Chaque champ doit avoir un label visible et programmatique décrivant la donnée attendue.

**Preuve attendue.** Le label est lié au contrôle et reste visible après saisie.

### UXR-0322 — MUST NOT · P0 · AUTO

**Règle.** Un placeholder ne doit pas remplacer un label.

**Preuve attendue.** Le test DOM trouve un label associé hors placeholder.

### UXR-0323 — MUST · P1 · AUTO

**Règle.** Le type d'input et autocomplete doivent correspondre à la donnée demandée lorsque disponibles.

**Preuve attendue.** Les attributs facilitent clavier, validation et remplissage automatique.

### UXR-0324 — MUST · P1 · SEMI

**Règle.** Les formats acceptés doivent être expliqués avant la saisie lorsque l'utilisateur ne peut pas les déduire.

**Preuve attendue.** Un hint relié au champ décrit exemple ou contrainte.

### UXR-0325 — MUST · P1 · AUTO

**Règle.** Les champs obligatoires et optionnels doivent être indiqués de manière cohérente.

**Preuve attendue.** Le formulaire n'oblige pas à deviner la règle globale.

### UXR-0326 — MUST · P1 · MANUAL

**Règle.** Un formulaire ne doit demander que les informations nécessaires au résultat ou à une obligation explicite.

**Preuve attendue.** Chaque champ possède une justification produit ou légale.

### UXR-0327 — MUST · P1 · MANUAL

**Règle.** Les informations déjà connues ne doivent pas être redemandées sans raison de sécurité ou de confirmation.

**Preuve attendue.** Le système préremplit, réutilise ou explique la demande.

### UXR-0328 — MUST · P1 · AUTO

**Règle.** Les groupes de radios et checkboxes doivent posséder une légende claire.

**Preuve attendue.** La structure fieldset/legend ou équivalente est présente.

### UXR-0329 — MUST · P1 · MANUAL

**Règle.** Les radios doivent être utilisées pour un choix unique visible et les checkboxes pour des choix indépendants.

**Preuve attendue.** Le contrôle correspond au modèle mental et au nombre d'options.

### UXR-0330 — MUST · P1 · MANUAL

**Règle.** Un select natif ou combobox doit être choisi selon le volume, la recherche et la complexité réels des options.

**Preuve attendue.** Le choix du composant est documenté dans la spécification.

### UXR-0331 — MUST NOT · P1 · MANUAL

**Règle.** Un menu déroulant ne doit pas être utilisé pour masquer quelques options qui gagneraient à être visibles.

**Preuve attendue.** Les choix fréquents ou critiques sont présentés directement.

### UXR-0332 — MUST · P1 · AUTO

**Règle.** Les valeurs saisies doivent être conservées après une erreur de validation ou une panne récupérable.

**Preuve attendue.** Le test provoque l'erreur et confirme la persistance.

### UXR-0333 — MUST · P1 · SEMI

**Règle.** Les formulaires longs doivent être divisés selon des étapes logiques et permettre la reprise.

**Preuve attendue.** La progression, la sauvegarde et le retour sont définis.

### UXR-0334 — MUST · P1 · MANUAL

**Règle.** Une étape doit demander un ensemble cohérent de décisions sans mélanger plusieurs objectifs indépendants.

**Preuve attendue.** Le titre et le contenu de l'étape correspondent à une intention.

### UXR-0335 — MUST · P1 · AUTO

**Règle.** Les actions de soumission doivent être placées après les champs dans l'ordre de lecture.

**Preuve attendue.** Le clavier atteint les actions après la saisie pertinente.

### UXR-0336 — MUST · P1 · MANUAL

**Règle.** Le bouton de soumission doit décrire le résultat attendu plutôt qu'utiliser un libellé générique lorsque l'enjeu est important.

**Preuve attendue.** Le texte annonce « Enregistrer », « Publier » ou l'effet réel.

### UXR-0337 — MUST · P0 · AUTO

**Règle.** Une double soumission doit être empêchée sans masquer l'état de traitement.

**Preuve attendue.** Idempotence, état loading et résultat terminal sont testés.

### UXR-0338 — MUST · P1 · MANUAL

**Règle.** Les champs sensibles doivent expliquer usage, visibilité et conservation lorsque cela influence la confiance.

**Preuve attendue.** Le contenu contextuel est présent au moment de la saisie.

### UXR-0339 — MUST · P1 · SEMI

**Règle.** Les formulaires doivent être testés avec clavier, lecteur d'écran, autofill, erreurs et contenu long.

**Preuve attendue.** La matrice de tests couvre les cinq modes.

### UXR-0340 — MUST · P1 · AUTO

**Règle.** Toute nouvelle primitive de formulaire doit être documentée avec labels, hints, erreurs, disabled, readonly et états asynchrones.

**Preuve attendue.** Les stories exposent toutes les variantes.

---

# Chapitre 18 — Validation, prévention des erreurs et récupération

**Objectif :** Empêcher les erreurs évitables, expliquer les problèmes précisément et préserver le travail lors de la récupération.

**Sources fondatrices :** S01, S06, S10, S26

**Plage :** `UXR-0341` à `UXR-0360`

### UXR-0341 — MUST · P0 · AUTO

**Règle.** La validation métier autoritaire doit rester côté backend même lorsqu'une validation client améliore le feedback.

**Preuve attendue.** Le serveur rejette les entrées invalides et renvoie un code stable.

### UXR-0342 — MUST · P1 · MANUAL

**Règle.** La validation client doit intervenir au moment où elle aide sans interrompre prématurément la saisie.

**Preuve attendue.** Les champs ne deviennent pas rouges avant que l'utilisateur ait pu les compléter.

### UXR-0343 — MUST · P1 · MANUAL

**Règle.** Chaque message d'erreur doit expliquer ce qui ne va pas et comment corriger.

**Preuve attendue.** Le texte est spécifique, actionnable et sans jargon technique.

### UXR-0344 — MUST NOT · P1 · AUTO

**Règle.** Un message ne doit pas se limiter à « invalide », « erreur » ou un code interne.

**Preuve attendue.** La revue de contenu bloque les messages génériques.

### UXR-0345 — MUST · P1 · AUTO

**Règle.** Les erreurs doivent apparaître près du champ concerné et dans un résumé pour les formulaires multi-champs.

**Preuve attendue.** Le résumé lie vers chaque contrôle invalide.

### UXR-0346 — MUST · P1 · AUTO

**Règle.** Après soumission invalide, le focus doit être dirigé vers le résumé d'erreurs ou le premier problème selon le pattern choisi.

**Preuve attendue.** Le test clavier confirme l'ordre de récupération.

### UXR-0347 — MUST · P1 · AUTO

**Règle.** Les messages du résumé et des champs doivent être cohérents.

**Preuve attendue.** Le même problème utilise le même libellé dans les deux emplacements.

### UXR-0348 — MUST · P1 · AUTO

**Règle.** La valeur fautive doit être conservée lorsque sa réutilisation est sûre.

**Preuve attendue.** L'utilisateur peut modifier sans ressaisir tout le formulaire.

### UXR-0349 — MUST · P0 · AUTO

**Règle.** Les erreurs serveur ne doivent pas exposer stack trace, SQL, secret ou détail sensible.

**Preuve attendue.** Le mapper transforme vers un problème utilisateur et conserve la corrélation.

### UXR-0350 — MUST · P1 · AUTO

**Règle.** Une erreur doit distinguer validation, conflit, permission, indisponibilité, réseau et erreur inattendue.

**Preuve attendue.** Le composant choisit récupération et message selon la catégorie.

### UXR-0351 — MUST · P1 · AUTO

**Règle.** Un conflit de version doit présenter les choix de relecture, comparaison ou abandon sans écraser silencieusement.

**Preuve attendue.** Le workflow 409 est testé avec données concurrentes.

### UXR-0352 — MUST · P1 · MANUAL

**Règle.** Les actions irréversibles doivent être prévenues par conception avant de compter sur un message d'erreur.

**Preuve attendue.** Preview, contraintes et confirmation réduisent le risque en amont.

### UXR-0353 — MUST · P1 · MANUAL

**Règle.** Une erreur récupérable doit proposer une action réaliste comme réessayer, modifier ou revenir.

**Preuve attendue.** Le CTA ne répète pas une opération vouée à échouer sans changement.

### UXR-0354 — MUST NOT · P0 · AUTO

**Règle.** Une commande ne doit pas être répétée automatiquement si elle peut produire un effet en double.

**Preuve attendue.** Les mutations utilisent idempotence et retry explicite contrôlé.

### UXR-0355 — MUST · P1 · AUTO

**Règle.** Les erreurs partielles doivent préserver les sections encore fiables.

**Preuve attendue.** La page indique la source indisponible sans masquer le reste.

### UXR-0356 — MUST · P1 · SEMI

**Règle.** La fermeture d'un message ne doit pas supprimer l'accès au diagnostic ou à l'audit nécessaire.

**Preuve attendue.** Un historique ou identifiant de corrélation reste disponible.

### UXR-0357 — SHOULD · P2 · SEMI

**Règle.** Les erreurs fréquentes doivent alimenter une amélioration de parcours plutôt qu'une accumulation de messages.

**Preuve attendue.** Les analytics et tickets identifient les causes récurrentes.

### UXR-0358 — MUST · P1 · AUTO

**Règle.** Les validations dépendantes d'un format local doivent respecter la locale et accepter les variations raisonnables.

**Preuve attendue.** Les tests couvrent formats de date, téléphone, nombres et noms pertinents.

### UXR-0359 — MUST · P1 · SEMI

**Règle.** Les erreurs doivent être testées avec technologie d'assistance et sans couleur.

**Preuve attendue.** Le message, le focus et l'association au contrôle sont vérifiés.

### UXR-0360 — MUST · P0 · SEMI

**Règle.** Une tâche ne peut être déclarée terminée sans scénarios d'erreur et de récupération pour ses parcours critiques.

**Preuve attendue.** Les tests d'acceptation incluent au moins une panne et une erreur utilisateur.

---

# Chapitre 19 — Boutons, liens, actions, sélection et affordances

**Objectif :** Rendre les possibilités d'action explicites, cohérentes et sûres tout en respectant les conventions de plateforme.

**Sources fondatrices :** S01, S02, S07, S09

**Plage :** `UXR-0361` à `UXR-0380`

### UXR-0361 — MUST · P0 · AUTO

**Règle.** Un bouton visible doit déclencher une action réelle ou être désactivé avec une raison accessible.

**Preuve attendue.** Le composant exige onAction ou un état disabled explicatif.

### UXR-0362 — MUST · P0 · AUTO

**Règle.** Un lien doit posséder une destination valide et un bouton ne doit pas simuler une navigation par défaut.

**Preuve attendue.** Le linter contrôle href, handlers et sémantique.

### UXR-0363 — MUST · P1 · MANUAL

**Règle.** Le libellé d'une action doit commencer par un verbe clair décrivant son résultat.

**Preuve attendue.** Les CTA évitent « OK », « Oui » ou « Continuer » lorsque l'effet est ambigu.

### UXR-0364 — MUST · P1 · MANUAL

**Règle.** Une page ne doit avoir qu'une action primaire visuellement dominante par contexte de décision.

**Preuve attendue.** Les actions concurrentes utilisent une hiérarchie secondaire ou tertiaire.

### UXR-0365 — MUST · P1 · MANUAL

**Règle.** Les actions dangereuses doivent être visuellement séparées des actions fréquentes et réversibles.

**Preuve attendue.** Le layout évite l'activation accidentelle et le style danger reste réservé.

### UXR-0366 — MUST · P1 · MANUAL

**Règle.** Une action indisponible doit être masquée ou désactivée selon que l'utilisateur doit connaître son existence.

**Preuve attendue.** La raison produit et la capability déterminent le choix.

### UXR-0367 — MUST · P1 · SEMI

**Règle.** Un état disabled doit expliquer comment ou pourquoi l'action devient disponible lorsque pertinent.

**Preuve attendue.** Tooltip accessible, hint ou message contextuel fournit la cause.

### UXR-0368 — MUST · P1 · AUTO

**Règle.** Les contrôles icon-only doivent avoir une zone interactive suffisante et un nom accessible.

**Preuve attendue.** Le test mesure hitbox et accessible name.

### UXR-0369 — MUST · P1 · MANUAL

**Règle.** La sélection d'un objet ne doit pas être confondue avec l'ouverture de son détail.

**Preuve attendue.** Checkbox, row click et actions ont des zones et comportements distincts.

### UXR-0370 — MUST · P1 · AUTO

**Règle.** Les actions de masse doivent apparaître seulement après sélection et indiquer le nombre d'objets concernés.

**Preuve attendue.** Le bandeau d'actions reflète la sélection réelle.

### UXR-0371 — MUST · P1 · AUTO

**Règle.** Une sélection persistante entre pages doit être explicitement annoncée et réinitialisable.

**Preuve attendue.** Le compteur et l'action « effacer » restent visibles.

### UXR-0372 — MUST NOT · P1 · MANUAL

**Règle.** Un hover ne doit pas être nécessaire pour découvrir l'unique action disponible.

**Preuve attendue.** L'action reste visible, focusable ou accessible par menu clairement signalé.

### UXR-0373 — MUST · P1 · AUTO

**Règle.** Les états pressed, selected et active doivent être distincts sémantiquement et visuellement.

**Preuve attendue.** Les composants utilisent les attributs et tokens appropriés.

### UXR-0374 — MUST · P1 · MANUAL

**Règle.** Un toggle doit changer un état immédiat tandis qu'un bouton doit déclencher une opération.

**Preuve attendue.** Le contrôle choisi reflète la temporalité et la persistance.

### UXR-0375 — MUST · P1 · AUTO

**Règle.** Les actions asynchrones doivent afficher progression, empêcher les doubles déclenchements et fournir un résultat terminal.

**Preuve attendue.** Le test couvre loading, succès, échec et reprise.

### UXR-0376 — MUST · P1 · MANUAL

**Règle.** Une action réversible doit proposer undo lorsque cela réduit fortement le coût d'erreur.

**Preuve attendue.** Le délai, la portée et le résultat de l'annulation sont clairs.

### UXR-0377 — MUST · P1 · AUTO

**Règle.** Les actions contextuelles doivent rester rattachées à l'objet concerné même dans une liste dense.

**Preuve attendue.** Le menu ou bouton porte l'identité de ligne dans son nom accessible.

### UXR-0378 — MUST · P1 · SEMI

**Règle.** Le placement et le style d'une action cohérente doivent rester constants entre écrans.

**Preuve attendue.** Le design system ou pattern library documente le comportement.

### UXR-0379 — MUST NOT · P1 · AUTO

**Règle.** Un contrôle visuellement interactif ne doit pas être un div ou span cliquable sans sémantique native.

**Preuve attendue.** Le linter bloque les onClick non sémantiques hors exception.

### UXR-0380 — MUST · P0 · AUTO

**Règle.** Toute action sensible doit être testée avec permissions réduites et backend non supporté.

**Preuve attendue.** Le contrôle est absent ou bloqué sans faux succès.

---

# Chapitre 20 — Modales, drawers, popovers, menus et tooltips

**Objectif :** Choisir le bon overlay, gérer correctement focus et fermeture, et éviter de cacher l'information critique.

**Sources fondatrices :** S01, S02, S10, S11

**Plage :** `UXR-0381` à `UXR-0400`

### UXR-0381 — MUST · P0 · AUTO

**Règle.** Une modal doit utiliser une sémantique de dialogue, un nom accessible et une gestion complète du focus.

**Preuve attendue.** Les tests couvrent role, label, focus trap et restauration.

### UXR-0382 — MUST · P1 · AUTO

**Règle.** Une modal doit posséder une méthode de fermeture visible et la touche Escape lorsque cela ne compromet pas une opération critique.

**Preuve attendue.** Le test active les deux chemins et conserve l'état attendu.

### UXR-0383 — MUST · P1 · MANUAL

**Règle.** Le clic sur l'overlay ne doit pas fermer une modal contenant une décision sensible ou une saisie non sauvegardée sans avertissement.

**Preuve attendue.** Le comportement dépend du risque et est documenté.

### UXR-0384 — MUST · P1 · AUTO

**Règle.** Un drawer doit permettre de revenir au contexte exact qui l'a ouvert.

**Preuve attendue.** Le focus, la sélection et le scroll sont restaurés.

### UXR-0385 — MUST · P1 · AUTO

**Règle.** Un popover doit être ancré au déclencheur, rester dans le viewport et se fermer selon les conventions attendues.

**Preuve attendue.** Les tests couvrent resize, scroll, Escape et clic extérieur.

### UXR-0386 — MUST · P1 · MANUAL

**Règle.** Un menu doit contenir des actions ou choix cohérents, pas du contenu éditorial complexe.

**Preuve attendue.** Les contenus longs ou formulaires utilisent un popover ou une page adaptée.

### UXR-0387 — MUST · P1 · MANUAL

**Règle.** Les tooltips doivent compléter un message existant et ne jamais contenir une information nécessaire à la tâche.

**Preuve attendue.** La tâche reste réalisable sans déclencher le tooltip.

### UXR-0388 — MUST · P1 · AUTO

**Règle.** Un tooltip doit apparaître au hover et au focus et rester dismissible et persistant selon WCAG.

**Preuve attendue.** Les tests couvrent pointer, clavier et Escape.

### UXR-0389 — MUST NOT · P1 · AUTO

**Règle.** Un tooltip ne doit pas contenir de contrôle interactif.

**Preuve attendue.** Un popover ou dialogue est utilisé si une interaction est nécessaire.

### UXR-0390 — MUST · P1 · MANUAL

**Règle.** Les overlays imbriqués doivent être évités ou strictement limités.

**Preuve attendue.** La revue refuse modal dans modal sauf besoin critique documenté.

### UXR-0391 — MUST · P1 · AUTO

**Règle.** Le z-index doit provenir d'une échelle contrôlée.

**Preuve attendue.** Le linter signale les valeurs arbitraires ou excessives.

### UXR-0392 — MUST · P1 · AUTO

**Règle.** Le fond derrière une modal doit être inerte pour pointer et clavier.

**Preuve attendue.** L'attribut inert ou une solution équivalente est testé.

### UXR-0393 — MUST · P1 · AUTO

**Règle.** Le scroll de fond doit être géré sans saut de layout lors de l'ouverture.

**Preuve attendue.** La position de page est restaurée après fermeture.

### UXR-0394 — MUST · P1 · AUTO

**Règle.** Les overlays doivent rester utilisables avec zoom, clavier virtuel et contenu localisé long.

**Preuve attendue.** Le contenu peut défiler et les actions restent atteignables.

### UXR-0395 — MUST · P1 · MANUAL

**Règle.** Une confirmation doit nommer l'objet, l'effet et l'irréversibilité éventuelle.

**Preuve attendue.** Le titre et le bouton ne reposent pas sur le contexte visuel extérieur.

### UXR-0396 — MUST · P1 · SEMI

**Règle.** Les actions primaires et secondaires d'une modal doivent suivre un ordre cohérent avec la plateforme et le produit.

**Preuve attendue.** La convention est documentée dans le design system.

### UXR-0397 — MUST · P1 · MANUAL

**Règle.** Une modal d'erreur ne doit pas empêcher l'accès aux informations nécessaires à la récupération.

**Preuve attendue.** Le diagnostic, la copie d'ID ou le retour restent disponibles.

### UXR-0398 — MUST · P1 · AUTO

**Règle.** Un menu contextuel doit avoir un déclencheur visible et un nom accessible lié à l'objet.

**Preuve attendue.** Le lecteur d'écran annonce le contexte de l'action.

### UXR-0399 — MUST · P1 · AUTO

**Règle.** Les overlays asynchrones doivent gérer loading, partial, error et fermeture pendant requête.

**Preuve attendue.** Aucun état bloqué ou perte de saisie silencieuse n'est possible.

### UXR-0400 — MUST · P0 · SEMI

**Règle.** Aucun nouvel overlay ne peut être approuvé sans test clavier, lecteur d'écran, mobile et zoom.

**Preuve attendue.** La checklist contient une preuve pour les quatre contextes.

---

# Chapitre 21 — Recherche, filtres, tri, pagination et vues sauvegardées

**Objectif :** Permettre aux utilisateurs de retrouver, réduire et réutiliser des ensembles de données sans perdre la compréhension du périmètre.

**Sources fondatrices :** S06, S10, S14

**Plage :** `UXR-0401` à `UXR-0420`

### UXR-0401 — MUST · P1 · MANUAL

**Règle.** Une recherche doit indiquer clairement son périmètre et les types d'objets indexés.

**Preuve attendue.** Le placeholder, label ou aide précise ce qui peut être trouvé.

### UXR-0402 — MUST · P1 · AUTO

**Règle.** La recherche doit tolérer casse, accents, espaces et variations raisonnables selon le domaine.

**Preuve attendue.** Les tests couvrent ces variantes sans produire de résultats trompeurs.

### UXR-0403 — MUST · P1 · SEMI

**Règle.** Les résultats doivent expliquer pourquoi ils correspondent lorsque la requête est ambiguë.

**Preuve attendue.** Les termes trouvés, alias ou champs pertinents sont visibles.

### UXR-0404 — MUST · P1 · AUTO

**Règle.** Une absence de résultat doit distinguer zéro donnée, filtres trop restrictifs et service indisponible.

**Preuve attendue.** L'empty state propose une récupération adaptée.

### UXR-0405 — MUST · P1 · AUTO

**Règle.** Les filtres actifs doivent rester visibles et supprimables individuellement.

**Preuve attendue.** Des chips, résumé ou panneau affichent état et nombre.

### UXR-0406 — MUST · P1 · AUTO

**Règle.** Un bouton « Effacer les filtres » doit restaurer un état prévisible sans supprimer une recherche ou un contexte non concerné.

**Preuve attendue.** La portée de la réinitialisation est explicite et testée.

### UXR-0407 — MUST · P1 · AUTO

**Règle.** Les filtres, le tri, la page ou le curseur et la période partageables doivent être sérialisés dans l'URL.

**Preuve attendue.** Le rafraîchissement et le partage reproduisent la vue.

### UXR-0408 — MUST · P1 · AUTO

**Règle.** Les valeurs de filtre doivent provenir de données ou d'un catalogue fiable et non d'une liste hardcodée divergente.

**Preuve attendue.** Les options reflètent les capacités et permissions réelles.

### UXR-0409 — MUST · P1 · AUTO

**Règle.** Le tri actif doit être annoncé visuellement et programmatiquement.

**Preuve attendue.** L'en-tête expose aria-sort et la direction.

### UXR-0410 — MUST NOT · P1 · AUTO

**Règle.** Un tri ne doit pas modifier silencieusement la sélection, le périmètre ou la période.

**Preuve attendue.** L'état non concerné est conservé et le changement est prévisible.

### UXR-0411 — MUST · P1 · AUTO

**Règle.** La pagination côté serveur doit être utilisée pour les collections volumineuses ou auditables.

**Preuve attendue.** La requête transporte curseur, taille, tri et filtres.

### UXR-0412 — MUST · P1 · SEMI

**Règle.** Un infinite scroll doit offrir une position, une reprise et une alternative de navigation fiables.

**Preuve attendue.** Le retour depuis un détail conserve l'emplacement et un contrôle de chargement existe.

### UXR-0413 — MUST · P1 · AUTO

**Règle.** Le nombre total doit être marqué inconnu lorsqu'il n'est pas calculable sans coût ou garantie.

**Preuve attendue.** L'UI n'invente pas un total à partir de la page courante.

### UXR-0414 — MUST · P1 · AUTO

**Règle.** Les vues sauvegardées doivent mémoriser uniquement les paramètres déclarés et afficher leur périmètre.

**Preuve attendue.** L'utilisateur sait ce qui sera restauré et peut modifier le nom.

### UXR-0415 — MUST · P1 · AUTO

**Règle.** Une vue partagée doit respecter les permissions du destinataire au moment de l'ouverture.

**Preuve attendue.** Les données et filtres interdits sont retirés ou refusés côté serveur.

### UXR-0416 — SHOULD · P2 · MANUAL

**Règle.** Les filtres fréquents peuvent proposer des presets basés sur les tâches réelles.

**Preuve attendue.** Les presets sont mesurés et ne remplacent pas l'accès aux filtres complets.

### UXR-0417 — MUST · P1 · MANUAL

**Règle.** Les filtres dépendants doivent indiquer quand une option est impossible ou limitée par une sélection précédente.

**Preuve attendue.** La relation est expliquée au lieu de masquer arbitrairement les valeurs.

### UXR-0418 — MUST · P1 · SEMI

**Règle.** Une recherche globale doit différencier navigation, objets et actions autorisées.

**Preuve attendue.** Les groupes possèdent labels, raccourcis et permissions cohérents.

### UXR-0419 — MUST · P1 · AUTO

**Règle.** Les résultats asynchrones doivent éviter le clignotement et les réponses hors ordre.

**Preuve attendue.** Debounce, annulation et identité de requête empêchent les remplacements obsolètes.

### UXR-0420 — MUST · P1 · AUTO

**Règle.** Les parcours de recherche et filtre doivent être testés avec URL copiée, retour navigateur, mobile et permissions réduites.

**Preuve attendue.** Les E2E couvrent ces quatre situations.

---

# Chapitre 22 — Tables, data grids et listes opérationnelles

**Objectif :** Présenter des collections complexes de manière scannable, accessible et réellement exploitable.

**Sources fondatrices :** S01, S02, S11, S14

**Plage :** `UXR-0421` à `UXR-0440`

### UXR-0421 — MUST · P1 · MANUAL

**Règle.** Une table doit être utilisée uniquement pour des données réellement tabulaires avec relations de lignes et colonnes.

**Preuve attendue.** Les layouts généraux utilisent grid ou listes plutôt qu'une table de présentation.

### UXR-0422 — MUST · P0 · AUTO

**Règle.** Toute table doit avoir une caption ou un nom accessible décrivant son contenu et son périmètre.

**Preuve attendue.** Le lecteur d'écran annonce la table de façon distincte.

### UXR-0423 — MUST · P0 · AUTO

**Règle.** Les en-têtes de colonnes et de lignes doivent être programmatiquement associés aux cellules.

**Preuve attendue.** Le DOM utilise th, scope ou associations adaptées.

### UXR-0424 — MUST · P1 · MANUAL

**Règle.** Les colonnes doivent avoir des libellés explicites, unités et formats cohérents.

**Preuve attendue.** Une légende ou tooltip accessible explique les termes rares.

### UXR-0425 — MUST · P1 · AUTO

**Règle.** Les valeurs numériques doivent être alignées et formatées pour faciliter la comparaison.

**Preuve attendue.** Chiffres tabulaires, décimales et unités sont cohérents.

### UXR-0426 — MUST · P1 · AUTO

**Règle.** Les actions de ligne doivent être accessibles sans dépendre du hover.

**Preuve attendue.** Un bouton ou menu focusable reste découvrable.

### UXR-0427 — MUST · P1 · MANUAL

**Règle.** Le clic sur la ligne ne doit pas entrer en conflit avec sélection, liens ou actions internes.

**Preuve attendue.** Les zones interactives et le comportement clavier sont définis.

### UXR-0428 — MUST · P1 · AUTO

**Règle.** Les tables triables doivent exposer la colonne et la direction du tri.

**Preuve attendue.** L'état aria-sort et l'indicateur visuel sont synchronisés.

### UXR-0429 — MUST · P1 · AUTO

**Règle.** Les tables filtrables doivent montrer le périmètre actif au-dessus ou à proximité.

**Preuve attendue.** L'utilisateur peut expliquer quelles lignes sont incluses.

### UXR-0430 — MUST · P1 · AUTO

**Règle.** La sélection de masse doit afficher le nombre sélectionné et les limites du périmètre.

**Preuve attendue.** La distinction page courante versus tout le résultat est explicite.

### UXR-0431 — MUST · P1 · AUTO

**Règle.** Les actions de masse dangereuses doivent fournir preview et confirmation sur les objets réellement concernés.

**Preuve attendue.** Le backend revalide l'ensemble au moment de l'action.

### UXR-0432 — MUST · P1 · SEMI

**Règle.** Les longues tables doivent utiliser pagination ou virtualisation sans dégrader la navigation clavier et lecteur d'écran.

**Preuve attendue.** Les tests couvrent focus, scroll et annonce de lignes.

### UXR-0433 — MUST · P1 · AUTO

**Règle.** Les colonnes sticky doivent rester alignées et ne pas masquer les autres cellules au zoom.

**Preuve attendue.** Les tests couvrent scroll horizontal et thèmes.

### UXR-0434 — MUST · P1 · AUTO

**Règle.** Les états loading, empty, partial, error et stale doivent apparaître au niveau pertinent de la table.

**Preuve attendue.** Une source partielle ne vide pas toute la collection fiable.

### UXR-0435 — MUST · P1 · SEMI

**Règle.** Une cellule tronquée doit permettre d'accéder à la valeur complète lorsqu'elle est pertinente.

**Preuve attendue.** Expansion, copie ou tooltip accessible est disponible.

### UXR-0436 — MUST · P1 · MANUAL

**Règle.** Les tableaux mobiles doivent utiliser une représentation priorisée, pas seulement réduire la taille des colonnes.

**Preuve attendue.** Les informations critiques et actions restent accessibles.

### UXR-0437 — MUST · P1 · AUTO

**Règle.** Les colonnes configurables doivent conserver un ensemble minimal obligatoire pour l'identité et la sécurité.

**Preuve attendue.** L'utilisateur ne peut pas masquer l'objet ou le statut essentiel sans avertissement.

### UXR-0438 — SHOULD · P2 · AUTO

**Règle.** Les densités de table peuvent être personnalisables pour les experts sans réduire les cibles sous les seuils sûrs.

**Preuve attendue.** La préférence est persistée et testée.

### UXR-0439 — MUST · P1 · AUTO

**Règle.** L'export d'une table doit refléter le périmètre, les filtres, la timezone et les permissions.

**Preuve attendue.** Le fichier contient métadonnées et ne révèle pas de colonnes interdites.

### UXR-0440 — MUST · P0 · SEMI

**Règle.** Une DataTable partagée ne peut être approuvée sans tests de sémantique, tri, filtres, pagination, sélection, responsive et états.

**Preuve attendue.** La story et les tests couvrent les sept axes.

---

# Chapitre 23 — Visualisation de données, graphiques et cartes analytiques

**Objectif :** Choisir des visualisations exactes, accessibles et orientées vers une question centrale plutôt que vers l'effet visuel.

**Sources fondatrices :** S01, S11, S12

**Plage :** `UXR-0441` à `UXR-0460`

### UXR-0441 — MUST · P1 · MANUAL

**Règle.** Chaque visualisation doit répondre à une question utilisateur clairement formulée.

**Preuve attendue.** Le titre ou la spécification exprime la question et l'insight attendu.

### UXR-0442 — MUST · P1 · MANUAL

**Règle.** Le type de graphique doit être choisi selon comparaison, tendance, distribution, relation ou part d'un tout.

**Preuve attendue.** La justification correspond à la structure des données.

### UXR-0443 — MUST NOT · P1 · MANUAL

**Règle.** Un graphique ne doit pas être ajouté pour occuper de l'espace ou « faire dashboard ».

**Preuve attendue.** La revue supprime toute visualisation sans décision ou insight associé.

### UXR-0444 — MUST · P1 · AUTO

**Règle.** Les axes, unités, période et échelle doivent être visibles ou explicitement disponibles.

**Preuve attendue.** L'utilisateur peut interpréter les valeurs sans deviner.

### UXR-0445 — MUST · P0 · SEMI

**Règle.** Une visualisation importante doit posséder une alternative textuelle et tabulaire adaptée.

**Preuve attendue.** Les tendances, anomalies et valeurs clés sont accessibles hors graphique.

### UXR-0446 — MUST · P1 · SEMI

**Règle.** La couleur ne doit pas être le seul moyen de distinguer les séries.

**Preuve attendue.** Marqueurs, motifs, traits ou labels directs complètent la palette.

### UXR-0447 — MUST · P1 · SEMI

**Règle.** Les palettes doivent maintenir un contraste et une distinction suffisants dans les thèmes supportés.

**Preuve attendue.** Les tests couvrent déficiences de couleur et niveaux de gris.

### UXR-0448 — MUST · P1 · AUTO

**Règle.** Les légendes doivent être proches, compréhensibles et interactives seulement si leur comportement est clair.

**Preuve attendue.** Le focus et la sélection de série sont accessibles.

### UXR-0449 — MUST · P1 · SEMI

**Règle.** Les tooltips de graphique doivent être accessibles au clavier ou doublés par une autre méthode d'exploration.

**Preuve attendue.** Les points de données ne dépendent pas du hover précis.

### UXR-0450 — MUST · P1 · MANUAL

**Règle.** Les domaines d'axe doivent éviter de déformer l'interprétation et signaler toute rupture ou troncature.

**Preuve attendue.** L'échelle et le zéro sont choisis selon la question et documentés.

### UXR-0451 — MUST NOT · P1 · AUTO

**Règle.** La 3D décorative ne doit pas être utilisée pour des graphiques 2D analytiques.

**Preuve attendue.** Aucune perspective ne déforme les valeurs.

### UXR-0452 — MUST · P1 · MANUAL

**Règle.** Les catégories trop nombreuses doivent être regroupées, filtrées ou remplacées par une vue plus adaptée.

**Preuve attendue.** La visualisation reste lisible et les détails restent accessibles.

### UXR-0453 — MUST · P1 · AUTO

**Règle.** Les données manquantes doivent être représentées comme manquantes, non interpolées silencieusement.

**Preuve attendue.** Le rendu et la légende distinguent absence, zéro et estimation.

### UXR-0454 — MUST · P1 · SEMI

**Règle.** Les données estimées ou prévues doivent être visuellement et textuellement distinctes des observations.

**Preuve attendue.** La provenance et l'incertitude sont exposées.

### UXR-0455 — MUST · P1 · MANUAL

**Règle.** Les annotations doivent signaler événements ou seuils réellement pertinents.

**Preuve attendue.** Elles n'encombrent pas la lecture et possèdent une alternative textuelle.

### UXR-0456 — MUST · P1 · SEMI

**Règle.** Le zoom et le pan doivent avoir des contrôles accessibles et une remise à zéro.

**Preuve attendue.** Le clavier et le tactile permettent l'exploration sans piège.

### UXR-0457 — MUST · P1 · AUTO

**Règle.** Les graphiques temps réel doivent afficher fraîcheur, cadence et pause.

**Preuve attendue.** L'utilisateur peut stabiliser la vue pour investiguer.

### UXR-0458 — MUST · P1 · MANUAL

**Règle.** Les grandes séries doivent être agrégées sans masquer les anomalies importantes.

**Preuve attendue.** La méthode d'agrégation et le niveau de détail sont visibles.

### UXR-0459 — MUST · P1 · AUTO

**Règle.** La visualisation doit être testée avec valeurs extrêmes, négatives, nulles, manquantes et séries uniques.

**Preuve attendue.** Les stories de stress conservent une interprétation correcte.

### UXR-0460 — MUST · P1 · SEMI

**Règle.** Toute bibliothèque de chart doit être évaluée pour accessibilité, performance, thèmes et maintenance avant adoption.

**Preuve attendue.** La décision de dépendance et ses limites sont documentées.

---

# Chapitre 24 — Dashboards, KPI, métriques et centres de commande

**Objectif :** Faire des dashboards des outils de décision et d'investigation plutôt que des mosaïques de chiffres décoratifs.

**Sources fondatrices :** S06, S11, S12, S30

**Plage :** `UXR-0461` à `UXR-0480`

### UXR-0461 — MUST · P0 · AUTO

**Règle.** Chaque KPI doit avoir une définition, une unité, un périmètre, une période, une fraîcheur et une provenance.

**Preuve attendue.** Le composant MetricCard exige ou dérive explicitement ces champs.

### UXR-0462 — MUST · P0 · AUTO

**Règle.** Une valeur inconnue ne doit jamais être remplacée par zéro, tiret ambigu ou statut rassurant.

**Preuve attendue.** Le modèle distingue KNOWN, UNKNOWN, UNAVAILABLE et NOT_APPLICABLE.

### UXR-0463 — MUST · P1 · AUTO

**Règle.** Chaque KPI important doit mener vers ses contributeurs ou son historique.

**Preuve attendue.** Le clic ouvre un filtre, breakdown ou détail cohérent.

### UXR-0464 — MUST · P1 · MANUAL

**Règle.** Un dashboard doit prioriser exceptions et décisions avant les métriques de contexte.

**Preuve attendue.** Le premier viewport montre ce qui nécessite l'attention.

### UXR-0465 — MUST NOT · P1 · MANUAL

**Règle.** Le même patron « six KPI plus panneaux » ne doit pas être imposé à tous les domaines.

**Preuve attendue.** Le layout découle des questions métier de la page.

### UXR-0466 — MUST · P1 · AUTO

**Règle.** Les tendances doivent préciser la référence de comparaison.

**Preuve attendue.** « +5 % » indique par rapport à quelle période ou baseline.

### UXR-0467 — MUST · P1 · SEMI

**Règle.** Les métriques agrégées doivent exposer leur périmètre et les exclusions.

**Preuve attendue.** Un utilisateur sait quels comptes, stratégies ou entités sont inclus.

### UXR-0468 — MUST · P1 · AUTO

**Règle.** Les seuils et objectifs doivent provenir d'une politique ou configuration autoritaire.

**Preuve attendue.** Le frontend ne code pas les limites métier en dur.

### UXR-0469 — MUST · P1 · AUTO

**Règle.** Un statut global doit être calculé côté autorité compétente ou présenté comme synthèse explicable.

**Preuve attendue.** Le frontend n'invente pas NOMINAL à partir d'absence d'erreur.

### UXR-0470 — MUST · P1 · MANUAL

**Règle.** Les alertes critiques doivent être visibles sans concurrencer des décorations ou KPI secondaires.

**Preuve attendue.** La hiérarchie de couleur, position et ordre reflète la sévérité.

### UXR-0471 — MUST · P1 · MANUAL

**Règle.** Les cartes doivent être choisies selon la question Metric, Alert, Entity, Chart ou Action.

**Preuve attendue.** Toute card ne correspondant à aucun type est supprimée ou fusionnée.

### UXR-0472 — MUST · P1 · AUTO

**Règle.** Un dashboard temps réel doit afficher un asOf global et les fraîcheurs locales divergentes.

**Preuve attendue.** Les sections stale ou partial sont identifiables.

### UXR-0473 — MUST · P1 · AUTO

**Règle.** Les valeurs monétaires, pourcentages, ratios et durées doivent utiliser des formats centralisés.

**Preuve attendue.** Le même concept est présenté identiquement sur tous les écrans.

### UXR-0474 — MUST · P1 · MANUAL

**Règle.** Les KPI ne doivent pas utiliser une précision supérieure à celle des données ou de la décision.

**Preuve attendue.** Le nombre de décimales est défini par domaine.

### UXR-0475 — MUST · P1 · SEMI

**Règle.** Les comparaisons doivent utiliser des périodes et périmètres homogènes ou expliquer les différences.

**Preuve attendue.** Le benchmark affiche sa source et ses limites.

### UXR-0476 — MUST · P1 · AUTO

**Règle.** Les widgets personnalisables doivent préserver un noyau d'informations critiques non masquable.

**Preuve attendue.** La personnalisation ne peut cacher alertes ou état de sécurité sans avertissement.

### UXR-0477 — MUST · P1 · MANUAL

**Règle.** Une page d'accueil doit résumer et orienter, non reproduire l'ensemble des fonctionnalités des domaines.

**Preuve attendue.** Les détails restent dans leurs pages propriétaires.

### UXR-0478 — MUST · P1 · AUTO

**Règle.** Le dashboard doit rester exploitable lorsque certaines sources échouent.

**Preuve attendue.** Les sections fiables restent visibles avec une bannière de qualité.

### UXR-0479 — MUST · P1 · AUTO

**Règle.** Les métriques doivent être testées contre des fixtures de zéro réel, inconnu, valeurs extrêmes et changement de période.

**Preuve attendue.** Les mappers et composants couvrent ces cas.

### UXR-0480 — MUST · P0 · SEMI

**Règle.** Aucun dashboard à haut enjeu ne peut être validé uniquement sur données mockées.

**Preuve attendue.** Une capture et un E2E contre le BFF réel sont requis avant cutover.

---

# Chapitre 25 — Chargement, vide, données partielles, stale, offline et indisponibilité

**Objectif :** Rendre l'état de la donnée explicite et préserver l'actionnabilité dans les situations asynchrones ou dégradées.

**Sources fondatrices :** S06, S09, S21, S22, S30

**Plage :** `UXR-0481` à `UXR-0500`

### UXR-0481 — MUST · P0 · AUTO

**Règle.** Chaque source de données doit distinguer loading, ready, empty, partial, stale, disconnected, forbidden et error lorsque pertinents.

**Preuve attendue.** Le type de vue ou la query expose ces états sans ambiguïté.

### UXR-0482 — MUST · P0 · AUTO

**Règle.** Un état empty ne doit être utilisé que lorsque l'absence de données est confirmée.

**Preuve attendue.** Une source indisponible ou non chargée n'affiche jamais « aucun résultat ».

### UXR-0483 — MUST · P1 · MANUAL

**Règle.** Un empty state doit expliquer ce que signifie l'absence et proposer la prochaine action utile.

**Preuve attendue.** Le contenu varie entre première utilisation, filtre vide et état nominal.

### UXR-0484 — MUST · P1 · AUTO

**Règle.** Un skeleton doit refléter la structure du contenu final et être utilisé pour des chargements suffisamment longs.

**Preuve attendue.** La transition n'entraîne pas de déplacement majeur.

### UXR-0485 — MUST NOT · P1 · AUTO

**Règle.** Un spinner global ne doit pas bloquer toute une page lorsque des sections peuvent se charger indépendamment.

**Preuve attendue.** Les requêtes et états sont localisés par section.

### UXR-0486 — MUST · P1 · AUTO

**Règle.** Les données stale doivent rester visibles avec leur dernier asOf et une indication de fraîcheur.

**Preuve attendue.** Le produit ne remplace pas automatiquement la dernière valeur connue par vide.

### UXR-0487 — MUST · P0 · AUTO

**Règle.** Une dernière valeur connue doit être clairement distinguée d'une valeur actuelle.

**Preuve attendue.** Le label, timestamp et source indiquent le caractère historique.

### UXR-0488 — MUST · P1 · SEMI

**Règle.** Une page partielle doit expliquer quelles sections et décisions sont affectées.

**Preuve attendue.** La bannière de qualité liste sources manquantes et impact.

### UXR-0489 — MUST · P1 · AUTO

**Règle.** Une erreur d'une source ne doit pas effacer les données fiables des autres sources.

**Preuve attendue.** Le composant conserve les sections utilisables.

### UXR-0490 — MUST · P1 · AUTO

**Règle.** Le retry d'une lecture doit être borné, visible et adapté au type d'erreur.

**Preuve attendue.** Les 403, 404, 409 et 422 ne sont pas retraités comme des pannes réseau.

### UXR-0491 — MUST NOT · P0 · AUTO

**Règle.** Une mutation sensible ne doit pas être automatiquement rejouée après une incertitude réseau sans garantie d'idempotence.

**Preuve attendue.** Le lifecycle vérifie le statut de commande avant toute reprise.

### UXR-0492 — MUST · P1 · MANUAL

**Règle.** L'état offline doit distinguer les actions consultables, mises en attente et interdites.

**Preuve attendue.** Le produit ne promet pas une synchronisation non implémentée.

### UXR-0493 — MUST · P1 · MANUAL

**Règle.** Les changements de connectivité doivent être annoncés sans interrompre inutilement la tâche.

**Preuve attendue.** Une bannière persistante remplace les toasts répétés.

### UXR-0494 — MUST · P1 · SEMI

**Règle.** Les données mises en cache doivent afficher leur provenance et politique de fraîcheur dans les écrans critiques.

**Preuve attendue.** Le diagnostic expose dataUpdatedAt et stale status.

### UXR-0495 — MUST · P1 · AUTO

**Règle.** Le chargement optimiste doit être réservé aux préférences ou actions réversibles à faible risque.

**Preuve attendue.** Les ordres, risques et changements de rôle attendent la confirmation autoritaire.

### UXR-0496 — MUST · P1 · AUTO

**Règle.** Les placeholders ne doivent pas ressembler à de vraies données de production.

**Preuve attendue.** Le mode démo ou inconnu est explicitement signalé.

### UXR-0497 — MUST · P1 · AUTO

**Règle.** Les progressions longues doivent proposer état, étape courante, possibilité de quitter et reprise.

**Preuve attendue.** La navigation ne détruit pas le suivi de l'opération.

### UXR-0498 — MUST · P1 · AUTO

**Règle.** Les timeouts doivent produire un état distinct d'une erreur métier.

**Preuve attendue.** Le message propose réessai, diagnostic ou contact adapté.

### UXR-0499 — MUST · P1 · AUTO

**Règle.** Tous les états de données doivent être documentés dans les stories et testés au niveau mapper et écran.

**Preuve attendue.** La matrice d'états est complète avant fusion.

### UXR-0500 — MUST · P0 · AUTO

**Règle.** Le frontend ne doit jamais déduire le succès ou l'état nominal de l'absence d'erreur.

**Preuve attendue.** Seul un statut ou une donnée autoritaire peut établir le résultat.

---

# Chapitre 26 — Feedback, statuts, notifications, toasts et confirmations

**Objectif :** Informer l'utilisateur au bon moment, avec la bonne persistance et sans créer de bruit ou de faux sentiment de succès.

**Sources fondatrices :** S06, S07, S09

**Plage :** `UXR-0501` à `UXR-0520`

### UXR-0501 — MUST · P0 · AUTO

**Règle.** Toute action utilisateur doit produire un feedback perceptible indiquant réception, progression ou résultat.

**Preuve attendue.** Le test confirme un changement visible et accessible après activation.

### UXR-0502 — MUST · P0 · AUTO

**Règle.** Un reçu ACCEPTED ne doit pas être présenté comme un succès métier terminal.

**Preuve attendue.** L'UI suit RUNNING puis SUCCEEDED ou FAILED et relit la ressource.

### UXR-0503 — MUST · P1 · MANUAL

**Règle.** Un toast doit être réservé à un message bref, non bloquant et non nécessaire à une décision ultérieure.

**Preuve attendue.** Les informations critiques utilisent une bannière, un panneau ou une page d'état.

### UXR-0504 — MUST · P1 · SEMI

**Règle.** Les toasts doivent rester assez longtemps pour être lus et pouvoir être consultés autrement s'ils contiennent une information importante.

**Preuve attendue.** Un centre de notifications ou historique conserve les événements utiles.

### UXR-0505 — MUST NOT · P1 · AUTO

**Règle.** Plusieurs toasts ne doivent pas s'empiler jusqu'à masquer le contenu ou les actions.

**Preuve attendue.** Les événements sont regroupés, dédupliqués ou mis en file.

### UXR-0506 — MUST · P1 · MANUAL

**Règle.** Les messages de succès doivent nommer l'objet ou l'effet réel lorsque cela aide la vérification.

**Preuve attendue.** « Stratégie suspendue » est préféré à « Succès ».

### UXR-0507 — MUST · P1 · AUTO

**Règle.** Les notifications doivent distinguer information, succès, avertissement, erreur et action requise.

**Preuve attendue.** Le registre de statuts associe sémantique, priorité et présentation.

### UXR-0508 — MUST · P1 · MANUAL

**Règle.** La sévérité visuelle doit refléter l'impact utilisateur, non le niveau technique interne.

**Preuve attendue.** Une panne de source secondaire ne ressemble pas à un incident critique global.

### UXR-0509 — MUST · P1 · AUTO

**Règle.** Les alertes persistantes doivent pouvoir être acquittées seulement lorsque l'acquittement a une signification métier réelle.

**Preuve attendue.** L'action est auditée et ne supprime pas la cause.

### UXR-0510 — MUST · P1 · AUTO

**Règle.** Une notification liée à un objet doit permettre d'ouvrir cet objet ou son incident.

**Preuve attendue.** Le lien conserve contexte et permission.

### UXR-0511 — MUST · P1 · AUTO

**Règle.** Les compteurs non lus doivent provenir d'une source réelle et être remis à jour de façon cohérente.

**Preuve attendue.** Aucun badge statique ou fictif n'est affiché.

### UXR-0512 — MUST · P1 · MANUAL

**Règle.** Les confirmations ne doivent pas répéter systématiquement les actions sans risque.

**Preuve attendue.** Elles sont réservées aux conséquences coûteuses, irréversibles ou surprenantes.

### UXR-0513 — MUST · P1 · MANUAL

**Règle.** Une confirmation sensible doit présenter objet, impact, portée, raison et action finale sans ambiguïté.

**Preuve attendue.** Le CTA reprend le verbe exact de l'opération.

### UXR-0514 — MUST · P1 · AUTO

**Règle.** Un succès partiel doit indiquer ce qui a réussi, échoué et ce qui reste à faire.

**Preuve attendue.** Le message ne masque pas les éléments en erreur.

### UXR-0515 — MUST · P1 · MANUAL

**Règle.** Les notifications temps réel doivent être priorisées pour protéger l'attention.

**Preuve attendue.** Les événements mineurs alimentent un flux sans interrompre la tâche.

### UXR-0516 — MUST · P1 · SEMI

**Règle.** Les annonces aria-live doivent être limitées aux transitions importantes et utiliser le niveau de politesse approprié.

**Preuve attendue.** Le lecteur d'écran ne répète pas les mises à jour non essentielles.

### UXR-0517 — MUST · P1 · MANUAL

**Règle.** La fermeture d'une bannière doit être persistée seulement si l'utilisateur peut raisonnablement ne plus la voir.

**Preuve attendue.** Les alertes critiques réapparaissent tant que la condition persiste.

### UXR-0518 — MUST · P1 · AUTO

**Règle.** Les notifications doivent respecter les préférences, quiet hours et canaux sans permettre de désactiver silencieusement les alertes obligatoires.

**Preuve attendue.** La politique et la préférence sont distinguées.

### UXR-0519 — MUST · P1 · AUTO

**Règle.** Les timestamps de notifications doivent utiliser timezone et format cohérents, avec date absolue accessible lorsque le relatif devient ambigu.

**Preuve attendue.** Le tooltip ou détail expose l'heure exacte.

### UXR-0520 — MUST · P0 · AUTO

**Règle.** Le feedback d'une action critique doit être vérifié contre l'état backend final et l'audit, pas seulement contre la réponse HTTP initiale.

**Preuve attendue.** Le test E2E confirme mutation, ressource et receipt.

---

# Chapitre 27 — Onboarding, apprentissage, aide et documentation intégrée

**Objectif :** Aider les utilisateurs à devenir autonomes sans transformer chaque écran en tutoriel permanent.

**Sources fondatrices :** S05, S06, S10

**Plage :** `UXR-0521` à `UXR-0540`

### UXR-0521 — MUST · P1 · MANUAL

**Règle.** L'onboarding doit être centré sur la première valeur obtenue, pas sur la visite exhaustive des menus.

**Preuve attendue.** Le parcours mène à une tâche réelle et un résultat observable.

### UXR-0522 — MUST · P1 · MANUAL

**Règle.** Les informations indispensables à une tâche doivent être disponibles au moment et à l'endroit où elles sont nécessaires.

**Preuve attendue.** L'utilisateur n'est pas obligé de consulter une documentation externe pour une étape critique.

### UXR-0523 — MUST NOT · P1 · AUTO

**Règle.** Une visite guidée imposée ne doit pas bloquer l'accès au produit sans raison réglementaire ou de sécurité.

**Preuve attendue.** Elle peut être ignorée et relancée.

### UXR-0524 — MUST · P1 · MANUAL

**Règle.** Les empty states de première utilisation doivent expliquer le concept, la prochaine action et un exemple réaliste.

**Preuve attendue.** Le contenu ne se limite pas à « aucune donnée ».

### UXR-0525 — MUST · P1 · SEMI

**Règle.** L'aide contextuelle doit utiliser le vocabulaire de l'écran et conserver le contexte d'objet.

**Preuve attendue.** Le lien d'aide ouvre la section pertinente, pas la page d'accueil de la documentation.

### UXR-0526 — MUST · P1 · AUTO

**Règle.** Les utilisateurs doivent pouvoir retrouver ultérieurement les aides montrées une seule fois.

**Preuve attendue.** Un centre d'aide, une commande ou un lien permet de les relancer.

### UXR-0527 — MUST · P1 · MANUAL

**Règle.** Les nouveautés produit doivent être annoncées selon leur impact et non par une accumulation de badges.

**Preuve attendue.** Les changements critiques disposent d'un résumé et d'une migration claire.

### UXR-0528 — SHOULD · P2 · AUTO

**Règle.** Les exemples doivent utiliser des données crédibles et étiquetées comme démonstration.

**Preuve attendue.** Aucune donnée fictive ne peut être confondue avec une donnée réelle.

### UXR-0529 — MUST · P1 · MANUAL

**Règle.** Les concepts complexes doivent être expliqués par niveaux de profondeur.

**Preuve attendue.** Un résumé court mène vers détails, définition et preuve technique.

### UXR-0530 — MUST · P1 · MANUAL

**Règle.** La documentation des actions dangereuses doit inclure conséquences, prérequis, rollback et audit.

**Preuve attendue.** Le lien est disponible avant confirmation.

### UXR-0531 — MUST · P1 · SEMI

**Règle.** Les raccourcis et fonctions expertes doivent être découvrables sans encombrer l'expérience novice.

**Preuve attendue.** Une palette, aide clavier ou tooltip fournit l'information.

### UXR-0532 — MUST · P1 · MANUAL

**Règle.** Une aide ne doit pas masquer un défaut de conception récurrent.

**Preuve attendue.** Les questions fréquentes déclenchent une amélioration du parcours.

### UXR-0533 — MUST · P1 · SEMI

**Règle.** Les termes métier doivent être définis dans un glossaire accessible depuis le contexte.

**Preuve attendue.** Les définitions restent cohérentes entre produit et documentation.

### UXR-0534 — MUST · P1 · SEMI

**Règle.** Les contenus d'aide doivent être versionnés avec le produit et testés contre l'interface actuelle.

**Preuve attendue.** Les liens, captures et étapes obsolètes sont détectés avant release.

### UXR-0535 — MUST · P1 · AUTO

**Règle.** Les tutoriels doivent respecter clavier, lecteur d'écran, zoom et réduction de mouvement.

**Preuve attendue.** L'aide n'introduit pas une couche inaccessible au-dessus du produit.

### UXR-0536 — MUST · P1 · AUTO

**Règle.** Les utilisateurs expérimentés doivent pouvoir désactiver les conseils non essentiels.

**Preuve attendue.** La préférence n'affecte pas les alertes ou obligations.

### UXR-0537 — SHOULD · P2 · MANUAL

**Règle.** Le produit peut proposer des exemples de requêtes, filtres ou commandes pour réduire la charge de rappel.

**Preuve attendue.** Les exemples sont contextuels et modifiables.

### UXR-0538 — MUST · P1 · MANUAL

**Règle.** Les messages d'aide doivent expliquer le « pourquoi » lorsque l'action paraît restrictive ou inhabituelle.

**Preuve attendue.** La règle, la permission ou le risque est exprimé clairement.

### UXR-0539 — MUST · P1 · SEMI

**Règle.** L'onboarding doit être mesuré par réussite de tâche et autonomie, pas seulement par taux de complétion.

**Preuve attendue.** Les métriques incluent activation, erreurs et besoin d'assistance.

### UXR-0540 — MUST · P1 · MANUAL

**Règle.** Chaque parcours critique doit être utilisable par un nouvel utilisateur du rôle sans explication orale prolongée.

**Preuve attendue.** Un test d'utilisabilité valide la prise en main.

---

# Chapitre 28 — Content design, microcopy et langage produit

**Objectif :** Écrire une interface claire, cohérente, actionnable et localisable qui réduit la charge cognitive.

**Sources fondatrices :** S06, S08, S10, S15, S16

**Plage :** `UXR-0541` à `UXR-0560`

### UXR-0541 — MUST · P1 · MANUAL

**Règle.** Le contenu doit être clair, direct et orienté vers la tâche plutôt que promotionnel dans l'interface produit.

**Preuve attendue.** La revue supprime jargon, slogans et formulations vagues.

### UXR-0542 — MUST · P1 · MANUAL

**Règle.** Les libellés d'action doivent décrire le résultat réel avec un verbe spécifique.

**Preuve attendue.** Le CTA permet de prédire l'effet sans contexte supplémentaire.

### UXR-0543 — MUST · P1 · MANUAL

**Règle.** Les titres doivent aider à trouver et comprendre le contenu, pas répéter la navigation mot pour mot sans valeur.

**Preuve attendue.** Chaque titre indique objet, état ou tâche pertinente.

### UXR-0544 — MUST · P1 · SEMI

**Règle.** Les messages doivent utiliser une terminologie stable issue d'un glossaire.

**Preuve attendue.** Les synonymes non contrôlés et changements de vocabulaire sont signalés.

### UXR-0545 — MUST NOT · P1 · MANUAL

**Règle.** Le produit ne doit pas culpabiliser, intimider ou manipuler l'utilisateur pour obtenir une action.

**Preuve attendue.** Les refus, annulations et choix alternatifs utilisent un ton neutre.

### UXR-0546 — MUST · P1 · MANUAL

**Règle.** Les messages d'erreur doivent être spécifiques, humains et actionnables.

**Preuve attendue.** Ils nomment le problème et la correction sans blâme.

### UXR-0547 — MUST · P1 · MANUAL

**Règle.** Les confirmations doivent nommer l'objet et l'effet plutôt que demander seulement « Êtes-vous sûr ? ».

**Preuve attendue.** Le texte reste compréhensible hors contexte visuel.

### UXR-0548 — MUST · P1 · AUTO

**Règle.** Les dates, nombres, devises et unités doivent être formatés, pas concaténés à la main.

**Preuve attendue.** Les fonctions de localisation centralisées sont utilisées.

### UXR-0549 — MUST · P1 · MANUAL

**Règle.** Les abréviations doivent être limitées aux termes connus du public cible et expliquées autrement.

**Preuve attendue.** Le test novice ou glossaire valide les termes.

### UXR-0550 — MUST · P1 · MANUAL

**Règle.** Les phrases doivent rester courtes sans sacrifier les conditions nécessaires à une décision sensible.

**Preuve attendue.** Le contenu hiérarchise résumé et détails.

### UXR-0551 — SHOULD · P2 · MANUAL

**Règle.** La voix du produit doit être documentée par contexte comme neutre, urgent, pédagogique ou rassurant.

**Preuve attendue.** Les exemples couvrent succès, erreur, incident et action dangereuse.

### UXR-0552 — MUST · P1 · MANUAL

**Règle.** Les informations critiques ne doivent pas être cachées dans un tooltip, une note de bas de page ou un texte secondaire peu contrasté.

**Preuve attendue.** Elles apparaissent dans le flux principal de décision.

### UXR-0553 — MUST · P1 · AUTO

**Règle.** Les labels visibles et noms accessibles doivent rester cohérents.

**Preuve attendue.** Un contrôle n'est pas annoncé avec une action différente de son texte.

### UXR-0554 — MUST · P1 · MANUAL

**Règle.** Les pronoms, genres et références culturelles doivent être évités lorsqu'ils ne sont pas nécessaires.

**Preuve attendue.** Le contenu reste inclusif et localisable.

### UXR-0555 — MUST · P1 · AUTO

**Règle.** Les chaînes UI doivent être externalisées et ne pas être fragmentées en morceaux impossibles à traduire.

**Preuve attendue.** Le catalogue contient des messages complets avec contexte.

### UXR-0556 — MUST · P1 · AUTO

**Règle.** Les textes de statut doivent décrire l'état réel et non une interprétation optimiste.

**Preuve attendue.** UNKNOWN, PARTIAL et STALE restent explicites.

### UXR-0557 — MUST · P1 · AUTO

**Règle.** Les liens doivent avoir un texte descriptif qui reste compréhensible hors contexte.

**Preuve attendue.** « Voir les détails de l'incident » remplace « Cliquer ici ».

### UXR-0558 — MUST · P1 · MANUAL

**Règle.** Les unités techniques rares doivent être expliquées ou converties selon le rôle utilisateur.

**Preuve attendue.** L'inspecteur peut conserver la valeur brute.

### UXR-0559 — MUST · P1 · SEMI

**Règle.** Le contenu doit être testé avec longueur localisée, lecteur d'écran et données réelles.

**Preuve attendue.** Les stories de contenu extrême ne cassent pas la compréhension.

### UXR-0560 — MUST · P1 · SEMI

**Règle.** Toute modification de terminologie métier doit prévoir migration, recherche par alias et mise à jour de la documentation.

**Preuve attendue.** La décision est enregistrée dans le glossaire et les tests.

---

# Chapitre 29 — Internationalisation, localisation et diversité culturelle

**Objectif :** Préparer le produit aux langues, scripts, formats et conventions variés sans reconstruire l'interface à chaque marché.

**Sources fondatrices :** S03, S08

**Plage :** `UXR-0561` à `UXR-0580`

### UXR-0561 — MUST · P1 · AUTO

**Règle.** L'internationalisation doit être intégrée à l'architecture avant la première localisation.

**Preuve attendue.** Les chaînes, formats et direction ne sont pas codés en dur dans les composants.

### UXR-0562 — MUST · P1 · AUTO

**Règle.** Le document HTML doit déclarer la langue principale et les changements de langue internes.

**Preuve attendue.** Les attributs lang sont valides et testés.

### UXR-0563 — MUST · P1 · AUTO

**Règle.** Le layout doit supporter les directions LTR et RTL lorsque les marchés cibles l'exigent.

**Preuve attendue.** Les propriétés logiques CSS remplacent left et right lorsque pertinent.

### UXR-0564 — MUST · P1 · AUTO

**Règle.** Les dates, heures, nombres, devises et pourcentages doivent utiliser les APIs de localisation.

**Preuve attendue.** Aucune concaténation manuelle ne produit les formats affichés.

### UXR-0565 — MUST · P1 · AUTO

**Règle.** La timezone de l'utilisateur et celle du domaine doivent être distinguées lorsque leur différence affecte la décision.

**Preuve attendue.** Le libellé montre la zone et l'instant autoritaire.

### UXR-0566 — MUST · P1 · AUTO

**Règle.** Les chaînes ne doivent pas être assemblées à partir de fragments qui imposent une grammaire.

**Preuve attendue.** Les messages complets utilisent paramètres nommés et règles pluriel.

### UXR-0567 — MUST · P1 · AUTO

**Règle.** Les pluriels et genres doivent utiliser les mécanismes de message adaptés à la locale.

**Preuve attendue.** Les tests couvrent zéro, un, deux et plusieurs selon les langues.

### UXR-0568 — MUST · P1 · AUTO

**Règle.** Le contenu doit supporter une expansion importante sans troncature fonctionnelle.

**Preuve attendue.** Les pseudo-locales et libellés longs sont testés.

### UXR-0569 — MUST · P1 · MANUAL

**Règle.** Les noms de personnes, adresses et téléphones ne doivent pas être modélisés selon un seul pays sans besoin explicite.

**Preuve attendue.** Les formulaires acceptent les structures pertinentes aux marchés.

### UXR-0570 — MUST NOT · P1 · MANUAL

**Règle.** Un drapeau ne doit pas être utilisé pour sélectionner une langue.

**Preuve attendue.** Le sélecteur affiche les noms des langues dans une forme compréhensible.

### UXR-0571 — MUST · P1 · MANUAL

**Règle.** Les symboles, couleurs et métaphores doivent être évalués culturellement.

**Preuve attendue.** La revue locale documente les risques d'ambiguïté.

### UXR-0572 — MUST · P1 · MANUAL

**Règle.** Les contenus traduits doivent conserver le même niveau d'autorité, de sécurité et de précision que la langue source.

**Preuve attendue.** Les actions dangereuses et erreurs sont revues humainement.

### UXR-0573 — MUST · P1 · AUTO

**Règle.** Le fallback de traduction doit être explicite et ne pas afficher des clés internes.

**Preuve attendue.** Le produit utilise une langue de repli ou marque le contenu indisponible.

### UXR-0574 — MUST · P1 · AUTO

**Règle.** Les recherches doivent prendre en compte accents, variantes de casse et segmentation de la langue.

**Preuve attendue.** Les tests utilisent des requêtes localisées réelles.

### UXR-0575 — MUST · P1 · SEMI

**Règle.** Les polices doivent couvrir les scripts supportés sans fallback visuellement incohérent.

**Preuve attendue.** La matrice typographique teste les glyphes cibles.

### UXR-0576 — MUST · P1 · AUTO

**Règle.** Les captures, images et exemples contenant du texte doivent être localisables ou remplacés par du contenu HTML.

**Preuve attendue.** Aucun texte critique n'est figé dans un média.

### UXR-0577 — MUST · P1 · AUTO

**Règle.** Les formats d'export doivent indiquer locale, timezone et conventions numériques.

**Preuve attendue.** Le fichier reste interprétable hors interface.

### UXR-0578 — MUST · P1 · SEMI

**Règle.** Les raccourcis clavier basés sur des lettres doivent être évalués selon clavier et langue.

**Preuve attendue.** Une configuration ou alternative existe en cas de conflit.

### UXR-0579 — MUST · P1 · SEMI

**Règle.** Chaque locale doit avoir un propriétaire, un état de couverture et des tests de régression.

**Preuve attendue.** La release ne mélange pas traductions manquantes et contenu réel sans signalement.

### UXR-0580 — MUST · P1 · AUTO

**Règle.** L'interface doit être testée dans au moins une pseudo-locale expansive et un mode RTL avant validation du design system.

**Preuve attendue.** Les composants critiques passent les deux scénarios.

---

# Chapitre 30 — Mobile, tactile, gestes et contexte de mobilité

**Objectif :** Concevoir pour l'attention limitée, le toucher, les interruptions et les contraintes réelles d'un usage mobile.

**Sources fondatrices :** S01, S07, S08

**Plage :** `UXR-0581` à `UXR-0600`

### UXR-0581 — MUST · P0 · AUTO

**Règle.** Les cibles tactiles principales doivent atteindre au moins 44 par 44 CSS px selon le standard interne.

**Preuve attendue.** Les tests mesurent la hitbox réelle, pas seulement l'icône.

### UXR-0582 — MUST · P1 · MANUAL

**Règle.** Les contrôles adjacents doivent être suffisamment espacés pour limiter les activations involontaires.

**Preuve attendue.** Les actions dangereuses sont particulièrement isolées.

### UXR-0583 — MUST · P1 · AUTO

**Règle.** Les gestes doivent avoir une alternative visible pour les utilisateurs qui ne peuvent pas les effectuer ou les découvrir.

**Preuve attendue.** Swipe, drag et pinch ne sont jamais l'unique chemin.

### UXR-0584 — MUST · P1 · MANUAL

**Règle.** Les actions fréquentes doivent être accessibles dans la zone de confort sans masquer les contenus critiques.

**Preuve attendue.** Le placement considère une utilisation à une main sans en faire une règle absolue.

### UXR-0585 — MUST · P1 · AUTO

**Règle.** Le clavier virtuel ne doit pas masquer le champ actif, les erreurs ou l'action de progression.

**Preuve attendue.** Le viewport et le scroll s'ajustent sur iOS et Android cibles.

### UXR-0586 — MUST · P1 · AUTO

**Règle.** Les types de clavier doivent correspondre aux données attendues.

**Preuve attendue.** email, tel, decimal et autres inputmode sont configurés.

### UXR-0587 — MUST NOT · P1 · AUTO

**Règle.** Le zoom utilisateur ne doit pas être désactivé par la meta viewport.

**Preuve attendue.** Le linter bloque user-scalable=no et maximum-scale restrictif.

### UXR-0588 — MUST · P1 · AUTO

**Règle.** Les safe areas, encoches et barres système doivent être prises en compte.

**Preuve attendue.** Les éléments fixes utilisent les insets appropriés.

### UXR-0589 — MUST · P1 · AUTO

**Règle.** Les états hover doivent avoir un équivalent tactile explicite.

**Preuve attendue.** Les informations et actions restent disponibles après tap ou dans une vue dédiée.

### UXR-0590 — MUST · P1 · MANUAL

**Règle.** Les tableaux denses doivent être transformés selon les priorités mobiles.

**Preuve attendue.** Les cartes ou listes conservent identité, statut et action critique.

### UXR-0591 — MUST · P1 · MANUAL

**Règle.** Les formulaires mobiles doivent minimiser la saisie et exploiter autofill, sélection et capture appropriée.

**Preuve attendue.** Le nombre de frappes nécessaires est évalué.

### UXR-0592 — MUST · P1 · AUTO

**Règle.** Les flux doivent tolérer les interruptions et permettre la reprise sans perte de données.

**Preuve attendue.** La navigation système et le retour à l'application restaurent l'état.

### UXR-0593 — MUST · P1 · AUTO

**Règle.** Les données critiques doivent indiquer leur fraîcheur lorsque le réseau mobile est instable.

**Preuve attendue.** Le dernier asOf et l'état offline restent visibles.

### UXR-0594 — MUST · P1 · AUTO

**Règle.** Les composants ne doivent pas dépendre d'un pointer précis ou d'un hover prolongé.

**Preuve attendue.** Le tactile et les limitations motrices sont pris en compte.

### UXR-0595 — MUST · P1 · SEMI

**Règle.** Les animations et effets doivent être limités pour préserver performance, batterie et attention.

**Preuve attendue.** Le profil mobile mesure jank et consommation réseau.

### UXR-0596 — MUST · P1 · AUTO

**Règle.** Les changements d'orientation ne doivent pas déclencher une action ni perdre la sélection.

**Preuve attendue.** Le state reste cohérent en portrait et paysage.

### UXR-0597 — MUST · P1 · SEMI

**Règle.** Les notifications push doivent respecter consentement, pertinence, fréquence et navigation profonde.

**Preuve attendue.** Chaque notification mène à un état actuel et autorisé.

### UXR-0598 — MUST · P1 · MANUAL

**Règle.** Les actions critiques ne doivent pas être placées uniquement dans un geste caché ou un menu difficile à atteindre.

**Preuve attendue.** Un chemin visible et confirmable existe.

### UXR-0599 — MUST · P1 · MANUAL

**Règle.** Les écrans mobiles doivent être testés sur appareils réels, pas uniquement dans un émulateur desktop.

**Preuve attendue.** La matrice de release inclut au moins les plateformes cibles représentatives.

### UXR-0600 — MUST · P1 · MANUAL

**Règle.** Le mobile doit afficher d'abord état, exception, action et objet courant, puis déplacer l'analyse secondaire vers des sous-pages.

**Preuve attendue.** La hiérarchie suit le contrat d'exploitation mobile.

---

# Chapitre 31 — SaaS enterprise, rôles, permissions et multi-contexte

**Objectif :** Concevoir des produits professionnels où les accès, environnements, rôles et responsabilités restent compréhensibles et sûrs.

**Sources fondatrices :** S04, S06, S13, S30

**Plage :** `UXR-0601` à `UXR-0620`

### UXR-0601 — MUST · P0 · AUTO

**Règle.** La visibilité d'une route et d'une action doit être dérivée des capabilities et permissions réelles de session.

**Preuve attendue.** Le frontend ne contient pas d'allowlist statique qui simule le RBAC.

### UXR-0602 — MUST · P0 · AUTO

**Règle.** Le backend doit revalider toute permission, même lorsque le frontend masque ou désactive l'action.

**Preuve attendue.** Les tests d'autorisation appellent directement l'API avec un rôle insuffisant.

### UXR-0603 — MUST · P0 · AUTO

**Règle.** Le contexte actif comme tenant, établissement, compte ou environnement doit être visible en permanence lorsqu'une confusion serait dangereuse.

**Preuve attendue.** Le shell expose le contexte et les requêtes le transportent explicitement.

### UXR-0604 — MUST · P0 · AUTO

**Règle.** Un changement vers un environnement plus sensible doit demander une confirmation et un step-up selon la politique.

**Preuve attendue.** Le passage LIVE ou admin produit un audit et un feedback clair.

### UXR-0605 — MUST · P1 · SEMI

**Règle.** Les écrans doivent expliquer les données partielles causées par les permissions.

**Preuve attendue.** Un agrégat indique que certains domaines sont exclus sans révéler leur contenu.

### UXR-0606 — MUST · P1 · MANUAL

**Règle.** Les rôles doivent être décrits par capacités et responsabilités plutôt que par titres vagues uniquement.

**Preuve attendue.** La page d'accès montre ce qui est permis et interdit.

### UXR-0607 — MUST · P1 · SEMI

**Règle.** Les demandes d'accès doivent indiquer ressource, justification, durée, approbateurs et risque.

**Preuve attendue.** Le workflow ne se limite pas à un bouton « demander ».

### UXR-0608 — MUST · P1 · AUTO

**Règle.** Les accès temporaires doivent afficher leur expiration et proposer renouvellement contrôlé.

**Preuve attendue.** L'utilisateur et l'administrateur voient la date et l'impact.

### UXR-0609 — MUST · P1 · AUTO

**Règle.** Les actions nécessitant quatre yeux doivent montrer clairement l'auteur, l'approbateur et l'état de la demande.

**Preuve attendue.** Aucun utilisateur ne peut remplir les deux rôles lorsque la policy l'interdit.

### UXR-0610 — MUST · P1 · AUTO

**Règle.** Les changements de contexte doivent conserver seulement les états compatibles et réinitialiser explicitement les autres.

**Preuve attendue.** Filtres, sélections et caches ne traversent pas un tenant de façon dangereuse.

### UXR-0611 — MUST · P0 · AUTO

**Règle.** Aucune donnée d'un autre tenant ou périmètre ne doit apparaître pendant un chargement, une transition ou un cache stale.

**Preuve attendue.** Les query keys et caches incluent le contexte d'autorisation.

### UXR-0612 — MUST · P1 · MANUAL

**Règle.** Les administrateurs doivent disposer d'un espace distinct des tâches quotidiennes lorsque les actions sont rares et sensibles.

**Preuve attendue.** La navigation et le style réduisent les déclenchements accidentels.

### UXR-0613 — MUST · P1 · AUTO

**Règle.** Les états d'accès refusé doivent préciser le scope manquant et le recours autorisé sans exposer de données sensibles.

**Preuve attendue.** Le 403 est contextualisé et auditable.

### UXR-0614 — MUST · P1 · AUTO

**Règle.** Les fonctionnalités non souscrites, non autorisées et non implémentées doivent avoir des états distincts.

**Preuve attendue.** Le message et le CTA correspondent à la cause réelle.

### UXR-0615 — MUST · P1 · AUTO

**Règle.** Les préférences personnelles ne doivent pas modifier les politiques organisationnelles ou masquer les contrôles obligatoires.

**Preuve attendue.** La provenance de chaque réglage est visible.

### UXR-0616 — MUST · P1 · SEMI

**Règle.** Les journaux d'audit doivent afficher acteur, action, objet, contexte, heure, résultat et corrélation.

**Preuve attendue.** L'utilisateur habilité peut vérifier une modification sensible.

### UXR-0617 — MUST · P1 · MANUAL

**Règle.** Les invitations et activations de compte doivent expliquer l'organisation, le rôle et la durée avant acceptation.

**Preuve attendue.** L'utilisateur sait à quel périmètre il rejoint.

### UXR-0618 — MUST · P1 · SEMI

**Règle.** Les changements de rôle doivent fournir un diff compréhensible des capacités gagnées et perdues.

**Preuve attendue.** La confirmation montre l'impact avant enregistrement.

### UXR-0619 — MUST · P1 · AUTO

**Règle.** Les vues enterprise doivent supporter grandes cardinalités, filtres serveur, exports et saved views sans masquer les limites.

**Preuve attendue.** Les budgets et limites sont documentés.

### UXR-0620 — MUST · P0 · AUTO

**Règle.** Les scénarios E2E doivent couvrir au minimum lecteur, opérateur, approbateur et administrateur avec accès distincts.

**Preuve attendue.** La matrice confirme routes, actions, refus et audit pour chaque rôle.

---

# Chapitre 32 — Actions dangereuses, commandes, audit et réversibilité

**Objectif :** Encadrer les opérations à fort impact par prévisualisation, autorisation, progression terminale et preuve.

**Sources fondatrices :** S26, S27, S30

**Plage :** `UXR-0621` à `UXR-0640`

### UXR-0621 — MUST · P0 · AUTO

**Règle.** Toute action dangereuse doit être liée à un command type backend réellement implémenté.

**Preuve attendue.** Le capability catalog annonce support, permission et lifecycle.

### UXR-0622 — MUST · P0 · AUTO

**Règle.** Une action dangereuse doit présenter un preview d'impact avant confirmation.

**Preuve attendue.** Le preview nomme objets, portée, conséquences et dépendances.

### UXR-0623 — MUST · P0 · AUTO

**Règle.** La confirmation doit demander une raison lorsque l'audit ou la politique l'exige.

**Preuve attendue.** La raison est validée, persistée et visible dans le receipt.

### UXR-0624 — MUST · P0 · AUTO

**Règle.** Les opérations les plus critiques doivent utiliser une confirmation renforcée comme phrase, re-authentification ou quatre yeux.

**Preuve attendue.** Le niveau de confirmation est défini par policy, pas par la page.

### UXR-0625 — MUST · P0 · AUTO

**Règle.** Chaque commande doit utiliser une clé d'idempotence et une version attendue lorsque la concurrence est possible.

**Preuve attendue.** Les doublons et conflits sont testés.

### UXR-0626 — MUST · P0 · AUTO

**Règle.** L'interface doit distinguer SUBMITTED, ACCEPTED, RUNNING, SUCCEEDED, FAILED, CANCELLED et TIMED_OUT selon le contrat réel.

**Preuve attendue.** Le statut terminal vient du backend et non d'un timeout UI.

### UXR-0627 — MUST · P0 · AUTO

**Règle.** Un succès ne doit être affiché qu'après état terminal et relecture cohérente de la ressource.

**Preuve attendue.** Le test E2E compare résultat attendu et projection.

### UXR-0628 — MUST · P0 · AUTO

**Règle.** Une commande non implémentée doit être absente, désactivée avec raison ou rejetée explicitement.

**Preuve attendue.** Elle ne produit jamais un faux reçu de succès.

### UXR-0629 — MUST · P0 · AUTO

**Règle.** Les retries de commande doivent vérifier le statut existant avant de créer une nouvelle intention.

**Preuve attendue.** Le système évite les doubles effets après rupture réseau.

### UXR-0630 — MUST · P0 · AUTO

**Règle.** Toute action dangereuse doit produire un audit receipt consultable.

**Preuve attendue.** Le receipt contient command ID, acteur, objet, raison, timestamps, résultat et corrélation.

### UXR-0631 — MUST · P1 · MANUAL

**Règle.** Le rollback doit être proposé lorsque techniquement et métierment possible.

**Preuve attendue.** Le preview explique ce qui est réversible et ce qui ne l'est pas.

### UXR-0632 — MUST · P1 · MANUAL

**Règle.** Une action destructive doit préférer une désactivation, archive ou période de grâce lorsque le métier le permet.

**Preuve attendue.** Le choix de suppression définitive est justifié.

### UXR-0633 — MUST · P0 · AUTO

**Règle.** Les actions de kill, cutover, promotion LIVE, override et modification de policy doivent être isolées dans un workflow dédié.

**Preuve attendue.** Elles ne sont pas déclenchables depuis une simple carte overview.

### UXR-0634 — MUST · P1 · AUTO

**Règle.** La progression d'une commande doit rester consultable après navigation ou reconnexion.

**Preuve attendue.** Un centre global de commandes et l'audit restaurent l'état.

### UXR-0635 — MUST · P1 · AUTO

**Règle.** L'utilisateur doit pouvoir annuler une commande seulement si l'autorité confirme qu'elle est encore annulable.

**Preuve attendue.** Le bouton se base sur capability et état courant.

### UXR-0636 — MUST · P1 · SEMI

**Règle.** Une commande concurrente ou superseded doit expliquer quelle intention fait autorité.

**Preuve attendue.** Le détail montre la relation entre commandes et résultat final.

### UXR-0637 — MUST · P0 · AUTO

**Règle.** Les paramètres sensibles d'une commande doivent être affichés dans le preview mais masqués selon les permissions.

**Preuve attendue.** Aucun secret ne fuit dans l'UI, l'URL ou l'audit.

### UXR-0638 — MUST · P1 · AUTO

**Règle.** Le résultat partiel d'une commande de masse doit détailler chaque objet et permettre une reprise ciblée.

**Preuve attendue.** Le produit ne résume pas tout par un succès global.

### UXR-0639 — MUST · P1 · AUTO

**Règle.** Les écrans de commande doivent être testés avec 403, 409, 422, 501, 503, timeout et reconnexion.

**Preuve attendue.** Chaque cas possède un message et une récupération distincts.

### UXR-0640 — MUST · P0 · SEMI

**Règle.** Aucune action à haut risque ne peut être libérée sans revue sécurité, test E2E réel, feature flag et rollback de release.

**Preuve attendue.** La Definition of Done contient les quatre preuves.

---

# Chapitre 33 — Confidentialité, sécurité, confiance et absence de manipulation

**Objectif :** Préserver l'autonomie, la sécurité et la compréhension des utilisateurs dans chaque choix et chaque traitement de données.

**Sources fondatrices :** S26, S27, S28, S29

**Plage :** `UXR-0641` à `UXR-0660`

### UXR-0641 — MUST · P0 · MANUAL

**Règle.** La collecte de données doit être limitée à ce qui est nécessaire pour la finalité déclarée.

**Preuve attendue.** Chaque champ et événement analytique possède une justification et une durée de conservation.

### UXR-0642 — MUST · P0 · SEMI

**Règle.** Les paramètres par défaut doivent protéger la confidentialité et limiter l'exposition.

**Preuve attendue.** Les options les plus permissives exigent un choix explicite lorsqu'applicable.

### UXR-0643 — MUST · P0 · MANUAL

**Règle.** Le consentement doit être libre, spécifique, informé, explicite et aussi simple à retirer qu'à donner.

**Preuve attendue.** Les parcours accepter, refuser et retirer ont une complexité comparable.

### UXR-0644 — MUST NOT · P0 · MANUAL

**Règle.** Le design ne doit pas utiliser de faux choix, obstruction, urgence artificielle, honte ou asymétrie visuelle pour influencer une décision.

**Preuve attendue.** Une revue anti-patterns évalue chaque parcours de consentement et abonnement.

### UXR-0645 — MUST · P0 · MANUAL

**Règle.** Les conséquences de sécurité et de confidentialité doivent être présentées avant l'action, pas après.

**Preuve attendue.** Le contenu explique partage, visibilité, conservation et révocation.

### UXR-0646 — MUST · P0 · AUTO

**Règle.** Les secrets, tokens, mots de passe et données sensibles ne doivent pas apparaître dans URL, logs, analytics ou messages d'erreur.

**Preuve attendue.** Les tests et scans inspectent les canaux de sortie.

### UXR-0647 — MUST · P0 · AUTO

**Règle.** Les champs de secret doivent supporter les gestionnaires de mots de passe et les méthodes d'authentification accessibles.

**Preuve attendue.** Le produit n'empêche pas paste ou autofill sans raison démontrée.

### UXR-0648 — MUST · P0 · MANUAL

**Règle.** L'authentification doit réduire la friction inutile tout en appliquant le niveau d'assurance approprié au risque.

**Preuve attendue.** La policy définit step-up et alternatives de récupération.

### UXR-0649 — MUST · P0 · AUTO

**Règle.** Les sessions, appareils et environnements actifs doivent être visibles et révocables selon le rôle.

**Preuve attendue.** Le compte montre activité, date, localisation approximative et action sûre.

### UXR-0650 — MUST · P0 · AUTO

**Règle.** Les messages de sécurité ne doivent pas confirmer l'existence d'un compte ou d'une ressource à un utilisateur non autorisé.

**Preuve attendue.** Les réponses et contenus évitent l'énumération.

### UXR-0651 — MUST · P0 · AUTO

**Règle.** Les données masquées doivent rester masquées dans le DOM, les exports et les APIs, pas seulement par CSS.

**Preuve attendue.** Le backend applique la redaction et les tests inspectent la réponse.

### UXR-0652 — MUST · P1 · SEMI

**Règle.** Les actions de copie, export et partage de données sensibles doivent être explicites et auditables.

**Preuve attendue.** Le produit indique périmètre et classification avant l'action.

### UXR-0653 — MUST · P1 · MANUAL

**Règle.** Les liens externes et téléchargements doivent signaler le changement de contexte et les risques pertinents.

**Preuve attendue.** L'utilisateur connaît destination, format et sensibilité.

### UXR-0654 — MUST · P0 · AUTO

**Règle.** Les inputs doivent être validés et encodés sans demander au frontend de garantir seul la sécurité.

**Preuve attendue.** Le backend applique validation, autorisation et sortie sûre.

### UXR-0655 — MUST · P1 · SEMI

**Règle.** Les contenus générés par des utilisateurs doivent être distingués des messages système et neutralisés contre l'usurpation visuelle.

**Preuve attendue.** Le style et la provenance empêchent de simuler une alerte autoritaire.

### UXR-0656 — MUST · P1 · MANUAL

**Règle.** Les choix de confidentialité doivent utiliser un langage neutre et symétrique.

**Preuve attendue.** Refuser n'est pas visuellement dégradé ou caché.

### UXR-0657 — MUST · P1 · MANUAL

**Règle.** Les fonctionnalités de personnalisation doivent expliquer quelles données sont utilisées et permettre la désactivation lorsque requise.

**Preuve attendue.** Le contrôle et la politique sont accessibles depuis le contexte.

### UXR-0658 — MUST · P1 · AUTO

**Règle.** Les analytics produit ne doivent pas capturer automatiquement des champs, payloads ou écrans sensibles.

**Preuve attendue.** Une allowlist d'événements et redaction est appliquée.

### UXR-0659 — MUST · P0 · SEMI

**Règle.** Les parcours de récupération de compte doivent être testés contre abus, exclusion et perte d'accès.

**Preuve attendue.** Plusieurs méthodes sûres et accessibles sont prévues selon le risque.

### UXR-0660 — MUST · P0 · SEMI

**Règle.** Une revue privacy et security doit être menée pour toute nouvelle donnée personnelle, action sensible ou intégration tierce.

**Preuve attendue.** La PR contient classification, menace, finalité, rétention et contrôles.

---

# Chapitre 34 — Expériences IA, explicabilité et contrôle humain

**Objectif :** Concevoir l'IA comme une capacité explicable et contrôlée qui soutient l'utilisateur sans usurper l'autorité métier.

**Sources fondatrices :** S17, S18, S30

**Plage :** `UXR-0661` à `UXR-0680`

### UXR-0661 — MUST · P0 · MANUAL

**Règle.** Une fonctionnalité IA doit résoudre un besoin utilisateur réel que l'IA peut traiter de façon appropriée.

**Preuve attendue.** La spécification compare l'approche IA à une solution déterministe ou manuelle.

### UXR-0662 — MUST · P0 · AUTO

**Règle.** Le produit doit indiquer clairement quand un contenu, score ou recommandation provient d'une IA.

**Preuve attendue.** Le label reste visible au moment de la décision.

### UXR-0663 — MUST · P0 · AUTO

**Règle.** Le niveau d'autorité de l'IA doit être explicite comme advisory, proposal ou automated selon la policy.

**Preuve attendue.** La présentation ne confond pas recommandation et décision canonique.

### UXR-0664 — MUST · P0 · AUTO

**Règle.** L'IA ne doit pas déclencher directement une action sensible lorsque le contrat exige une décision humaine ou déterministe.

**Preuve attendue.** Le workflow passe par preview, permission et confirmation.

### UXR-0665 — MUST · P1 · MANUAL

**Règle.** Les explications doivent être adaptées à la question de l'utilisateur et non exposer un raisonnement interne brut.

**Preuve attendue.** Le produit fournit sources, facteurs, limites et résultat utile.

### UXR-0666 — MUST · P0 · SEMI

**Règle.** Les sources, cutoffs, modèle, version de prompt et outils doivent être traçables pour les décisions importantes.

**Preuve attendue.** Un inspecteur autorisé expose la provenance et l'audit.

### UXR-0667 — MUST · P1 · MANUAL

**Règle.** Le produit doit expliquer les limites, incertitudes et cas où l'IA peut se tromper.

**Preuve attendue.** Le contenu est contextuel et évite les avertissements génériques invisibles.

### UXR-0668 — MUST · P1 · AUTO

**Règle.** L'utilisateur doit pouvoir corriger, rejeter ou ignorer une recommandation lorsque le rôle le permet.

**Preuve attendue.** Le système conserve le feedback sans pénaliser arbitrairement l'utilisateur.

### UXR-0669 — MUST · P1 · MANUAL

**Règle.** Les recommandations doivent être évaluées avec des métriques liées au résultat utilisateur et aux risques.

**Preuve attendue.** La qualité ne se limite pas à l'engagement ou au taux d'acceptation.

### UXR-0670 — MUST · P0 · AUTO

**Règle.** Les hallucinations ou sources indisponibles doivent produire un état incertain, pas une réponse confiante.

**Preuve attendue.** Le rendu marque absence de preuve et bloque l'action sensible.

### UXR-0671 — MUST · P1 · AUTO

**Règle.** Les citations doivent ouvrir la source exacte ou le contexte utilisé.

**Preuve attendue.** Un lien générique vers une page d'accueil n'est pas une preuve suffisante.

### UXR-0672 — MUST · P1 · AUTO

**Règle.** Les actions préparées par l'IA doivent être présentées comme brouillons modifiables avant exécution.

**Preuve attendue.** L'utilisateur voit paramètres, portée et conséquences.

### UXR-0673 — MUST · P1 · MANUAL

**Règle.** Les interfaces IA doivent protéger contre l'automation bias en présentant alternatives et facteurs contradictoires pertinents.

**Preuve attendue.** La recommandation n'occupe pas seule tout l'espace de décision.

### UXR-0674 — MUST · P1 · AUTO

**Règle.** Les conversations doivent conserver contexte, entités, permissions et version de modèle de façon traçable.

**Preuve attendue.** Le retour ultérieur reproduit le périmètre ou signale ce qui a changé.

### UXR-0675 — MUST · P1 · AUTO

**Règle.** Les données sensibles envoyées à un modèle doivent respecter minimisation, consentement, redaction et politique fournisseur.

**Preuve attendue.** Le pipeline est documenté et testé.

### UXR-0676 — MUST · P1 · AUTO

**Règle.** Les latences longues de génération doivent afficher progression honnête, possibilité d'annuler et travail en arrière-plan si prévu.

**Preuve attendue.** Aucun faux pourcentage n'est affiché.

### UXR-0677 — MUST · P1 · MANUAL

**Règle.** Un fallback déterministe ou humain doit exister pour les tâches critiques lorsque l'IA est indisponible.

**Preuve attendue.** Le parcours reste réalisable ou explicitement bloqué avec recours.

### UXR-0678 — MUST · P1 · AUTO

**Règle.** Les prompts utilisateur et contenus récupérés doivent être traités comme non fiables.

**Preuve attendue.** Le système sépare instructions système, données et contenu externe.

### UXR-0679 — MUST · P1 · SEMI

**Règle.** Les changements de modèle ou prompt doivent être versionnés, évalués et déployés sous feature flag.

**Preuve attendue.** Les régressions de comportement et d'explication sont testées.

### UXR-0680 — MUST · P0 · MANUAL

**Règle.** Toute expérience IA à fort impact doit être revue pour biais, exclusion, sécurité, contrôle humain et audit avant release.

**Preuve attendue.** La checklist de gouvernance IA contient des preuves pour les cinq axes.

---

# Chapitre 35 — Temps réel, flux live et actualisation continue

**Objectif :** Maintenir conscience de la fraîcheur, protéger l'attention et garantir la cohérence lors de mises à jour fréquentes.

**Sources fondatrices :** S06, S19, S22, S30

**Plage :** `UXR-0681` à `UXR-0700`

### UXR-0681 — MUST · P0 · AUTO

**Règle.** Toute donnée live doit afficher son asOf, sa source et son état de connexion.

**Preuve attendue.** L'utilisateur peut distinguer actuel, stale et last known.

### UXR-0682 — MUST · P0 · AUTO

**Règle.** Une déconnexion ne doit jamais être interprétée comme un état nominal ou une absence d'événement.

**Preuve attendue.** Le statut passe à disconnected avec dernier heartbeat.

### UXR-0683 — MUST · P1 · AUTO

**Règle.** Les mises à jour temps réel doivent préserver focus, sélection, scroll et saisie.

**Preuve attendue.** Les tests injectent des événements pendant l'interaction.

### UXR-0684 — MUST · P1 · MANUAL

**Règle.** Les listes live ne doivent pas réordonner agressivement les lignes sous le pointeur ou le focus.

**Preuve attendue.** Les nouveaux éléments sont regroupés, signalés ou appliqués sur demande.

### UXR-0685 — MUST · P1 · AUTO

**Règle.** Les utilisateurs doivent pouvoir mettre en pause un flux lorsqu'une investigation exige un état stable.

**Preuve attendue.** Le compteur de nouveaux événements reste visible et la reprise est contrôlée.

### UXR-0686 — MUST · P1 · MANUAL

**Règle.** La cadence d'actualisation doit être adaptée à la décision et au coût, pas maximale par défaut.

**Preuve attendue.** Le contrat de donnée définit fréquence, tolérance et budget.

### UXR-0687 — MUST · P1 · AUTO

**Règle.** Les événements doivent invalider uniquement les queries et objets concernés.

**Preuve attendue.** Aucun refetch global n'est déclenché pour chaque tick.

### UXR-0688 — MUST · P1 · AUTO

**Règle.** La reconnexion doit utiliser un curseur, sequence ou mécanisme de reprise pour éviter pertes et doublons.

**Preuve attendue.** Les tests simulent interruption et replay.

### UXR-0689 — MUST · P1 · AUTO

**Règle.** Les événements hors ordre, dupliqués ou retardés doivent être détectés et traités explicitement.

**Preuve attendue.** Le reducer utilise IDs stables, versions et timestamps autoritaires.

### UXR-0690 — MUST · P1 · SEMI

**Règle.** Les transitions critiques doivent être annoncées tandis que les updates fréquentes restent silencieuses pour les lecteurs d'écran.

**Preuve attendue.** Le système de priorité filtre aria-live.

### UXR-0691 — MUST · P1 · MANUAL

**Règle.** Les animations de mise à jour ne doivent pas créer de distraction continue.

**Preuve attendue.** Seules les nouvelles exceptions importantes reçoivent une attention visuelle temporaire.

### UXR-0692 — MUST · P1 · SEMI

**Règle.** Une valeur qui change rapidement doit permettre d'accéder à son historique ou à sa tendance.

**Preuve attendue.** L'utilisateur peut distinguer bruit et changement significatif.

### UXR-0693 — MUST · P1 · AUTO

**Règle.** Les horloges et countdowns doivent utiliser une source de temps cohérente et gérer dérive et timezone.

**Preuve attendue.** Le serveur ou une synchronisation autoritaire fournit la référence.

### UXR-0694 — MUST · P1 · AUTO

**Règle.** Les commandes live doivent conserver leur progression même si le flux d'événements se coupe.

**Preuve attendue.** Le fallback polling ou status lookup restaure le lifecycle.

### UXR-0695 — MUST · P1 · AUTO

**Règle.** Une vue live doit offrir un état de session explicite comme pré-ouverture, active, pause ou fermée.

**Preuve attendue.** Le calendrier backend fait autorité.

### UXR-0696 — MUST · P1 · AUTO

**Règle.** Les données de prix ou métriques rapides doivent limiter les re-renders et le travail du thread principal.

**Preuve attendue.** Le profiling confirme des interactions fluides.

### UXR-0697 — MUST · P1 · AUTO

**Règle.** Les notifications live doivent être dédupliquées par identifiant et cause.

**Preuve attendue.** Une même condition ne génère pas une avalanche de messages.

### UXR-0698 — MUST · P1 · SEMI

**Règle.** Les utilisateurs doivent pouvoir distinguer un événement planifié d'un événement réellement observé.

**Preuve attendue.** La timeline planned versus actual utilise sémantique et source distinctes.

### UXR-0699 — MUST · P1 · AUTO

**Règle.** Les vues live doivent être testées sous latence, perte, duplication, burst et clock skew.

**Preuve attendue.** Les scénarios de résilience font partie de l'E2E.

### UXR-0700 — MUST · P0 · SEMI

**Règle.** Un écran live à haut enjeu ne peut être validé uniquement avec un flux mock régulier.

**Preuve attendue.** Les tests utilisent le runtime réel ou un simulateur contractuel injectant des anomalies.

---

# Chapitre 36 — Design system, tokens, primitives et gouvernance visuelle

**Objectif :** Construire une couche stable, accessible et partageable qui réduit l'arbitraire sans empêcher les besoins métier légitimes.

**Sources fondatrices :** S07, S09, S11, S12, S13, S15, S23

**Plage :** `UXR-0701` à `UXR-0720`

### UXR-0701 — MUST · P0 · AUTO

**Règle.** Le design system doit être la source de vérité pour tokens, primitives et patterns transverses.

**Preuve attendue.** Les features ne recopient pas styles et composants fondamentaux.

### UXR-0702 — MUST · P1 · AUTO

**Règle.** Les tokens doivent suivre une nomenclature sémantique et un format interopérable aligné sur le standard DTCG lorsque possible.

**Preuve attendue.** Le fichier de tokens est validé par schéma et résolu sans erreur.

### UXR-0703 — MUST · P1 · AUTO

**Règle.** Les primitives globales doivent rester indépendantes du domaine métier.

**Preuve attendue.** Button ou Modal ne connaît ni stratégie, ni élève, ni ordre.

### UXR-0704 — MUST · P1 · MANUAL

**Règle.** Un composant ne doit entrer dans shared que si son contrat est stable, transverse ou réellement réutilisé.

**Preuve attendue.** La PR fournit les usages et invariants communs.

### UXR-0705 — MUST NOT · P1 · SEMI

**Règle.** Le dossier shared ne doit pas devenir une zone de dépôt par défaut.

**Preuve attendue.** Chaque ajout indique propriétaire, responsabilité et consommateurs.

### UXR-0706 — MUST · P1 · AUTO

**Règle.** Chaque composant doit documenter objectif, variantes, états, accessibilité, responsive, densité et exemples d'usage.

**Preuve attendue.** La documentation Storybook ou équivalente est complète.

### UXR-0707 — MUST · P1 · AUTO

**Règle.** Chaque composant interactif doit fournir ses comportements clavier et sémantiques par défaut.

**Preuve attendue.** Les consommateurs ne reconstruisent pas focus et ARIA localement.

### UXR-0708 — MUST · P1 · AUTO

**Règle.** Les props de style arbitraires doivent être limitées au profit de variantes nommées et tokens.

**Preuve attendue.** La surface API n'accepte pas des valeurs libres qui contournent le système.

### UXR-0709 — MUST · P1 · MANUAL

**Règle.** Les composants doivent exposer loading, disabled, error ou empty uniquement lorsque ces états appartiennent réellement à leur responsabilité.

**Preuve attendue.** Le composant ne mélange pas logique de page et présentation générique.

### UXR-0710 — MUST · P1 · MANUAL

**Règle.** Les variantes visuelles doivent correspondre à une différence sémantique ou de contexte documentée.

**Preuve attendue.** Deux variantes presque identiques sont fusionnées ou justifiées.

### UXR-0711 — MUST · P1 · AUTO

**Règle.** La dépréciation d'un composant ou token doit fournir migration, délai et détection des usages restants.

**Preuve attendue.** La CI signale les imports dépréciés.

### UXR-0712 — MUST · P1 · AUTO

**Règle.** Les composants doivent être testés dans tous les thèmes et densités supportés.

**Preuve attendue.** La matrice de stories rend les combinaisons pertinentes.

### UXR-0713 — MUST · P1 · SEMI

**Règle.** Les composants de données doivent accepter des modèles typés plutôt que des fragments HTML arbitraires pour les invariants importants.

**Preuve attendue.** L'API garantit unité, état, provenance et actions attendues.

### UXR-0714 — MUST · P1 · MANUAL

**Règle.** Les escape hatches doivent être rares, nommées et documentées avec les risques.

**Preuve attendue.** Toute prop unsafe ou unstyled possède un cas d'usage approuvé.

### UXR-0715 — MUST · P1 · SEMI

**Règle.** Une contribution au design system doit être revue par design, frontend et accessibilité.

**Preuve attendue.** Les approbateurs sont définis dans CODEOWNERS ou le workflow.

### UXR-0716 — MUST · P1 · AUTO

**Règle.** Les tokens de fondation ne doivent pas être modifiés sans analyse d'impact visuel multi-écrans.

**Preuve attendue.** Une visual regression couvre les consommateurs majeurs.

### UXR-0717 — MUST · P1 · AUTO

**Règle.** Le design system doit inclure des états de vérité comme partial, stale, disconnected et forbidden lorsque le produit en dépend.

**Preuve attendue.** Les patterns sont cohérents dans tous les domaines.

### UXR-0718 — MUST · P1 · MANUAL

**Règle.** Les composants complexes doivent fournir une composition guidée plutôt qu'un composant géant configurable par dizaines de flags.

**Preuve attendue.** L'API favorise sous-composants et slots contrôlés.

### UXR-0719 — MUST · P1 · AUTO

**Règle.** Le catalogue interne doit servir de documentation exécutable et de banc de tests.

**Preuve attendue.** Chaque story représente un état utilisateur, pas seulement une variante esthétique.

### UXR-0720 — MUST · P0 · SEMI

**Règle.** Une feature ne doit pas contourner une limitation du design system par copie locale silencieuse.

**Preuve attendue.** Elle contribue une correction, ouvre une dérogation ou documente un composant métier distinct.

---

# Chapitre 37 — API de composants, composition et responsabilités UI

**Objectif :** Créer des composants explicites, composables et testables qui expriment l'intention sans mélanger transport, métier et rendu.

**Sources fondatrices :** S02, S07, S09, S21, S24

**Plage :** `UXR-0721` à `UXR-0740`

### UXR-0721 — MUST · P1 · MANUAL

**Règle.** Un composant doit avoir une responsabilité visuelle ou interactionnelle cohérente et une raison principale de changer.

**Preuve attendue.** La description du composant tient en une phrase précise.

### UXR-0722 — MUST · P1 · AUTO

**Règle.** Les composants de présentation doivent recevoir des données déjà adaptées à l'affichage.

**Preuve attendue.** Ils ne calculent pas un KPI métier ni ne normalisent un DTO brut.

### UXR-0723 — MUST · P1 · AUTO

**Règle.** Les composants de feature peuvent connaître le domaine mais ne doivent pas appeler directement le transport si une couche data-access existe.

**Preuve attendue.** Les requêtes et commandes sont injectées par hooks ou contrôleurs de feature.

### UXR-0724 — MUST · P1 · SEMI

**Règle.** Une page routée doit orchestrer contexte, paramètres, états et composition sans contenir tout le markup du domaine.

**Preuve attendue.** Les sections cohérentes sont extraites selon leur responsabilité.

### UXR-0725 — MUST NOT · P1 · AUTO

**Règle.** Un composant ne doit pas recevoir un grand objet global lorsqu'il n'utilise que quelques champs.

**Preuve attendue.** Les props minimisent le couplage et restent typées.

### UXR-0726 — MUST · P1 · AUTO

**Règle.** Les props doivent exprimer intention et état, pas des détails CSS comme blue, small ou marginLeft.

**Preuve attendue.** Les variantes portent des noms sémantiques.

### UXR-0727 — MUST · P1 · SEMI

**Règle.** Les événements émis doivent décrire l'intention utilisateur comme confirmRequested ou rowSelected.

**Preuve attendue.** Les noms onClick génériques sont évités dans les composants métier.

### UXR-0728 — MUST · P1 · MANUAL

**Règle.** Un composant contrôlé doit documenter source de vérité, événements et comportement par défaut.

**Preuve attendue.** Les consommateurs savent qui possède l'état.

### UXR-0729 — MUST · P1 · AUTO

**Règle.** L'état local doit rester local tant qu'il n'est pas partagé ou nécessaire à une URL.

**Preuve attendue.** Aucun store global n'est créé pour un toggle isolé.

### UXR-0730 — MUST · P1 · AUTO

**Règle.** Les composants doivent éviter les états impossibles en utilisant unions discriminées ou modèles explicites.

**Preuve attendue.** Loading et data incohérents ne coexistent pas sans signification.

### UXR-0731 — MUST · P1 · MANUAL

**Règle.** Les children ou slots doivent être utilisés lorsque la composition est plus stable qu'une multiplication de flags.

**Preuve attendue.** L'API reste lisible et les invariants essentiels sont protégés.

### UXR-0732 — MUST NOT · P1 · AUTO

**Règle.** Une prop boolean ne doit pas changer simultanément plusieurs comportements sans nom explicite.

**Preuve attendue.** Les modes complexes utilisent une variante ou un objet de configuration typé.

### UXR-0733 — MUST · P1 · AUTO

**Règle.** Les composants asynchrones doivent séparer rendu, effet et commande pour faciliter les tests.

**Preuve attendue.** Les tests peuvent simuler chaque état sans réseau réel.

### UXR-0734 — MUST · P1 · AUTO

**Règle.** Les composants doivent préserver les attributs HTML et refs nécessaires à l'accessibilité lorsqu'ils enveloppent un élément natif.

**Preuve attendue.** Le focus et les labels restent fonctionnels.

### UXR-0735 — MUST · P1 · AUTO

**Règle.** Les clés de liste doivent être stables et issues de l'identité métier.

**Preuve attendue.** Index, Math.random et UUID généré au rendu sont interdits.

### UXR-0736 — MUST · P1 · AUTO

**Règle.** Les composants doivent être résilients aux contenus vides, longs et localisés.

**Preuve attendue.** Les stories de stress couvrent les limites.

### UXR-0737 — MUST · P1 · AUTO

**Règle.** Un composant ne doit pas muter ses props ou données serveur.

**Preuve attendue.** Les transformations créent des view models immuables.

### UXR-0738 — MUST · P1 · MANUAL

**Règle.** Les composants complexes doivent exposer des points d'extension contrôlés plutôt qu'autoriser du DOM arbitraire partout.

**Preuve attendue.** L'API documente ce qui peut être remplacé sans casser la sémantique.

### UXR-0739 — MUST · P1 · AUTO

**Règle.** Toute nouvelle primitive doit posséder tests d'interaction, accessibilité et visual regression.

**Preuve attendue.** La CI exécute les stories correspondantes.

### UXR-0740 — MUST · P1 · MANUAL

**Règle.** Une abstraction ne doit être créée qu'après preuve d'un invariant commun, pas seulement d'une ressemblance visuelle.

**Preuve attendue.** La PR cite les usages et les différences écartées.

---

# Chapitre 38 — Architecture frontend par feature et séparation des couches

**Objectif :** Organiser le code autour des capacités métier avec des frontières explicites entre application, données, modèle et interface.

**Sources fondatrices :** S21, S30, S31

**Plage :** `UXR-0741` à `UXR-0760`

### UXR-0741 — MUST · P0 · AUTO

**Règle.** Le frontend doit être organisé par feature ou domaine métier, non par dossiers globaux de tous les composants et services.

**Preuve attendue.** La structure contient features/<domain> avec routes, pages, components, api et model.

### UXR-0742 — MUST · P1 · AUTO

**Règle.** Le dossier core doit contenir uniquement les capacités transverses uniques comme auth, HTTP, query, realtime, commands et errors.

**Preuve attendue.** Aucune logique métier spécifique n'est placée dans core.

### UXR-0743 — MUST · P1 · AUTO

**Règle.** Le shell doit gérer navigation, contexte et chrome sans calculer les données des domaines.

**Preuve attendue.** Les widgets métier restent dans les features ou un endpoint composé explicite.

### UXR-0744 — MUST · P1 · AUTO

**Règle.** Chaque feature doit posséder une API publique claire et ne pas importer les internals d'une autre.

**Preuve attendue.** Les règles d'architecture bloquent les imports interdits.

### UXR-0745 — MUST · P1 · AUTO

**Règle.** Les routes doivent être déclarées par modules et chargées paresseusement lorsque pertinent.

**Preuve attendue.** L'ajout d'une feature n'exige pas une chaîne de ternaires dans App.

### UXR-0746 — MUST · P0 · AUTO

**Règle.** Le registre de routes, navigation, breadcrumbs et recherche doit être une source de vérité unique enrichie par capabilities.

**Preuve attendue.** Aucune sidebar parallèle n'est codée en dur.

### UXR-0747 — MUST · P1 · AUTO

**Règle.** Les pages doivent lire leurs paramètres de route et les transmettre jusqu'à la requête réelle.

**Preuve attendue.** Deux IDs distincts produisent des query keys et réponses distinctes.

### UXR-0748 — MUST · P1 · AUTO

**Règle.** Les appels réseau doivent être concentrés dans la couche api ou data-access de la feature.

**Preuve attendue.** Le linter signale fetch ou axios dans pages et composants.

### UXR-0749 — MUST · P1 · AUTO

**Règle.** Les mappers doivent convertir DTO vers modèle de vue sans réimplémenter les règles métier autoritaires.

**Preuve attendue.** Les calculs officiels restent backend et les transformations sont testées.

### UXR-0750 — MUST · P1 · AUTO

**Règle.** Les selectors doivent dériver uniquement des informations d'affichage ou de composition.

**Preuve attendue.** Ils ne fabriquent pas statut, permission ou résultat métier.

### UXR-0751 — MUST · P1 · AUTO

**Règle.** Les erreurs doivent être normalisées dans core/errors puis contextualisées par la feature.

**Preuve attendue.** Les pages ne parsèment pas des messages techniques ad hoc.

### UXR-0752 — MUST · P1 · AUTO

**Règle.** Le realtime doit être centralisé pour connexion, reprise et distribution, puis consommé par les features.

**Preuve attendue.** Chaque page ne crée pas sa propre connexion SSE ou WebSocket.

### UXR-0753 — MUST · P1 · AUTO

**Règle.** Le lifecycle de commande doit être une capacité transverse réutilisée par toutes les actions sensibles.

**Preuve attendue.** Les features fournissent command type et payload, pas un faux succès local.

### UXR-0754 — MUST NOT · P1 · AUTO

**Règle.** Un fichier viewModels, styles ou mocks monolithique ne doit pas regrouper tous les domaines.

**Preuve attendue.** Les limites de taille et de responsabilité déclenchent un découpage par feature.

### UXR-0755 — MUST · P1 · AUTO

**Règle.** Les mocks doivent être chargés uniquement dans les environnements de test ou démonstration explicites.

**Preuve attendue.** Le bundle de production n'importe pas le dataset de démonstration.

### UXR-0756 — MUST · P1 · AUTO

**Règle.** Les styles doivent suivre tokens, primitives, layouts puis features.

**Preuve attendue.** Les selectors globaux et nth-child fragiles sont limités et revus.

### UXR-0757 — MUST · P1 · AUTO

**Règle.** Les dépendances entre features doivent passer par entités partagées stables ou navigation, pas par accès interne.

**Preuve attendue.** Un graphe de dépendances reste acyclique.

### UXR-0758 — MUST · P1 · MANUAL

**Règle.** Les capacités techniques doivent être abstraites seulement lorsqu'un second besoin réel ou un contrat stable existe.

**Preuve attendue.** L'architecture évite les façades génériques prématurées.

### UXR-0759 — MUST · P1 · AUTO

**Règle.** Chaque feature doit inclure ses tests, fixtures et stories à proximité.

**Preuve attendue.** Le déplacement ou la suppression de la feature ne laisse pas de tests orphelins.

### UXR-0760 — MUST · P0 · AUTO

**Règle.** Les frontières frontend doivent être vérifiées automatiquement dans la CI.

**Preuve attendue.** Un outil d'architecture contrôle cycles, imports, taille et placement des appels réseau.

---

# Chapitre 39 — Contrats API, DTO, modèles de domaine UI et provenance

**Objectif :** Garantir que les données affichées sont typées, interprétées correctement et traçables jusqu'à une source autoritaire.

**Sources fondatrices :** S21, S22, S26, S30

**Plage :** `UXR-0761` à `UXR-0780`

### UXR-0761 — MUST · P0 · AUTO

**Règle.** Le frontend doit consommer un contrat API documenté et versionné.

**Preuve attendue.** Le client est généré ou fortement typé depuis OpenAPI ou schéma équivalent.

### UXR-0762 — MUST · P0 · AUTO

**Règle.** Les réponses doivent être validées à l'exécution aux frontières lorsque l'incohérence présente un risque.

**Preuve attendue.** Une version ou forme inconnue produit un état explicite, pas un crash silencieux.

### UXR-0763 — MUST · P1 · AUTO

**Règle.** Les DTO de transport doivent être distincts des view models affichés.

**Preuve attendue.** Un mapper explicite gère noms, états, formats et valeurs optionnelles.

### UXR-0764 — MUST · P0 · AUTO

**Règle.** Une valeur métier doit distinguer zéro réel, null, unknown, unavailable, not applicable et stale.

**Preuve attendue.** Le type discriminé interdit les fallbacks ambigus.

### UXR-0765 — MUST · P0 · AUTO

**Règle.** Les IDs doivent être canoniques, stables et fournis par l'autorité.

**Preuve attendue.** randomUUID ou Math.random ne servent jamais de fallback de lecture.

### UXR-0766 — MUST · P1 · AUTO

**Règle.** Chaque donnée critique doit porter ou permettre d'obtenir source, asOf et périmètre.

**Preuve attendue.** Le composant de provenance est alimenté par le modèle.

### UXR-0767 — MUST · P1 · AUTO

**Règle.** Les unités et devises doivent être explicites dans le contrat ou le modèle.

**Preuve attendue.** Le frontend ne déduit pas une unité d'un nom de champ vague.

### UXR-0768 — MUST · P1 · AUTO

**Règle.** Les enums inconnues doivent être préservées et rendues comme « valeur non reconnue » plutôt que remappées vers un état existant.

**Preuve attendue.** Le mapper possède un fallback sûr et observable.

### UXR-0769 — MUST · P0 · AUTO

**Règle.** Le frontend ne doit pas recalculer un statut officiel, une permission, un risque ou un PnL canonique.

**Preuve attendue.** La valeur autoritaire vient du backend avec version de règle si nécessaire.

### UXR-0770 — MUST · P1 · AUTO

**Règle.** Les listes volumineuses doivent recevoir pagination, tri et filtres côté serveur.

**Preuve attendue.** Le contrat accepte des paramètres typés et renvoie curseur ou métadonnées.

### UXR-0771 — MUST · P1 · AUTO

**Règle.** Les endpoints de détail doivent exiger l'identifiant et renvoyer 404 ou 403 stricts.

**Preuve attendue.** Ils ne réutilisent pas une vue agrégée sans sélection réelle.

### UXR-0772 — MUST · P1 · AUTO

**Règle.** Les relations entre objets doivent être exposées par identifiants stables et libellés utiles ou liens relationnels.

**Preuve attendue.** Le frontend ne reconstruit pas des relations à partir de texte.

### UXR-0773 — MUST · P1 · AUTO

**Règle.** Les dates techniques doivent être transportées dans un format non ambigu avec timezone.

**Preuve attendue.** Le parsing utilise des types et rejette les chaînes invalides.

### UXR-0774 — MUST · P1 · AUTO

**Règle.** Les erreurs API doivent utiliser des codes stables et une structure comme Problem Details.

**Preuve attendue.** Le frontend mappe code, statut, détails et corrélation sans parser un message libre.

### UXR-0775 — MUST · P1 · SEMI

**Règle.** Les champs optionnels doivent avoir une sémantique documentée.

**Preuve attendue.** L'absence ne signifie pas implicitement false ou zéro.

### UXR-0776 — MUST · P1 · AUTO

**Règle.** Les données partielles doivent indiquer quelles sous-sources ont échoué.

**Preuve attendue.** Le modèle de page conserve les sections fiables et expose les erreurs locales.

### UXR-0777 — MUST · P1 · SEMI

**Règle.** Le contrat doit définir les cardinalités et limites afin que l'UI choisisse table, pagination ou résumé correctement.

**Preuve attendue.** La Screen Specification cite volumes attendus et extrêmes.

### UXR-0778 — MUST · P1 · AUTO

**Règle.** Les changements breaking doivent utiliser version, migration et compatibilité explicites.

**Preuve attendue.** Le frontend ne dépend pas de champs retirés sans gate de release.

### UXR-0779 — MUST · P1 · AUTO

**Règle.** Les fixtures de contrat doivent inclure données complètes, partielles, inconnues, extrêmes et invalides.

**Preuve attendue.** Les tests de mapper couvrent chaque catégorie.

### UXR-0780 — MUST · P0 · AUTO

**Règle.** Aucune donnée affichée comme réelle ne peut provenir d'un mock implicite ou d'une constante de page.

**Preuve attendue.** Le transport expose clairement le mode et la production exclut les fixtures.

---

# Chapitre 40 — État client, cache serveur, URL et synchronisation

**Objectif :** Choisir une autorité unique pour chaque état afin d'éviter duplication, incohérence et perte de contexte.

**Sources fondatrices :** S21, S22

**Plage :** `UXR-0781` à `UXR-0800`

### UXR-0781 — MUST · P1 · AUTO

**Règle.** L'état serveur doit être géré par une couche de query/cache dédiée, pas recopié dans un store client général.

**Preuve attendue.** Les données API restent dans TanStack Query ou équivalent.

### UXR-0782 — MUST · P1 · AUTO

**Règle.** L'état UI local doit rester dans le composant le plus proche qui le possède.

**Preuve attendue.** Un store global n'est pas créé pour un état isolé.

### UXR-0783 — MUST · P1 · AUTO

**Règle.** Les filtres, tri, pagination, période, onglet et comparaison partageables doivent vivre dans l'URL.

**Preuve attendue.** Le refresh et le lien reproduisent la vue.

### UXR-0784 — MUST · P1 · AUTO

**Règle.** Les query keys doivent inclure toutes les variables qui déterminent la requête, y compris contexte et permissions pertinentes.

**Preuve attendue.** Le linter ou les tests vérifient les dépendances exhaustives.

### UXR-0785 — MUST · P1 · AUTO

**Règle.** Les query keys doivent être stables, sérialisables et structurées par entité ou domaine.

**Preuve attendue.** Des factories partagées évitent les collisions.

### UXR-0786 — MUST · P1 · AUTO

**Règle.** Les invalidations doivent cibler les ressources affectées par une mutation ou un événement.

**Preuve attendue.** Aucun invalidateQueries global n'est utilisé sans justification.

### UXR-0787 — MUST · P1 · SEMI

**Règle.** La staleTime et la stratégie de refetch doivent être définies selon la volatilité et le risque de la donnée.

**Preuve attendue.** Les politiques diffèrent entre catalogue, stratégie, risque et prix live.

### UXR-0788 — MUST · P1 · AUTO

**Règle.** Un cache ne doit jamais franchir un changement de tenant, environnement ou utilisateur sans isolation.

**Preuve attendue.** Le contexte fait partie de la clé et le cache est purgé si nécessaire.

### UXR-0789 — MUST · P1 · AUTO

**Règle.** Les données placeholder et initiales doivent être identifiables pour éviter de les présenter comme fraîchement chargées.

**Preuve attendue.** Le composant peut distinguer placeholderData et réponse réelle.

### UXR-0790 — MUST · P1 · AUTO

**Règle.** L'état dérivé ne doit pas être stocké lorsqu'il peut être calculé de façon sûre à partir d'une source unique.

**Preuve attendue.** Les duplications comme fullName ou compteurs locaux sont supprimées.

### UXR-0791 — MUST · P1 · AUTO

**Règle.** Les états impossibles doivent être évités par une modélisation explicite.

**Preuve attendue.** Unions discriminées remplacent plusieurs booleans contradictoires.

### UXR-0792 — MUST · P1 · AUTO

**Règle.** Les mutations optimistes doivent être limitées aux actions réversibles à faible risque.

**Preuve attendue.** Les opérations métier sensibles attendent l'autorité serveur.

### UXR-0793 — MUST · P1 · AUTO

**Règle.** Les réponses hors ordre doivent être ignorées ou rattachées à leur requête correcte.

**Preuve attendue.** AbortController, clés et versions empêchent les écrasements obsolètes.

### UXR-0794 — MUST · P1 · AUTO

**Règle.** Le back et forward navigateur doivent restaurer un état utilisable sans requêtes excessives ou perte de contexte.

**Preuve attendue.** Les tests E2E couvrent l'historique.

### UXR-0795 — MUST · P1 · AUTO

**Règle.** La sélection transitoire doit être invalidée lorsque le périmètre change et l'objet n'est plus visible.

**Preuve attendue.** Le produit annonce ou réinitialise la sélection.

### UXR-0796 — MUST · P1 · AUTO

**Règle.** Le state local ne doit pas contenir de copie mutable d'une ressource serveur sans workflow d'édition explicite.

**Preuve attendue.** Les formulaires utilisent draft, version et résolution de conflit.

### UXR-0797 — MUST · P1 · AUTO

**Règle.** Les événements realtime doivent mettre à jour ou invalider le cache selon un reducer testé.

**Preuve attendue.** Le même événement ne produit pas d'états divergents entre pages.

### UXR-0798 — MUST · P1 · AUTO

**Règle.** Les erreurs de query doivent rester associées à la source concernée et ne pas être aplaties en un état global unique.

**Preuve attendue.** La page partielle conserve ses données fiables.

### UXR-0799 — MUST · P1 · AUTO

**Règle.** Les préférences persistées doivent avoir version, défaut et migration.

**Preuve attendue.** Un changement de schéma ne casse pas le chargement de l'application.

### UXR-0800 — MUST · P0 · MANUAL

**Règle.** Toute source d'état doit avoir un propriétaire explicite : URL, serveur, session, composant ou préférence.

**Preuve attendue.** La revue refuse les duplications d'autorité non justifiées.

---

# Chapitre 41 — Performance réelle et performance perçue

**Objectif :** Maintenir une interface rapide, stable et réactive en mesurant l'expérience réelle plutôt que seulement le temps de build.

**Sources fondatrices :** S19, S20

**Plage :** `UXR-0801` à `UXR-0820`

### UXR-0801 — MUST · P0 · AUTO

**Règle.** Les écrans web publics ou compatibles doivent viser LCP ≤ 2,5 s, INP ≤ 200 ms et CLS ≤ 0,1 au 75e percentile.

**Preuve attendue.** Les métriques terrain et laboratoire sont suivies par route critique.

### UXR-0802 — MUST · P1 · SEMI

**Règle.** Les applications internes doivent définir des budgets équivalents de chargement, interaction et stabilité adaptés à leur contexte.

**Preuve attendue.** Le blueprint produit contient seuils P75 et environnement de mesure.

### UXR-0803 — MUST · P1 · AUTO

**Règle.** Le shell interactif doit apparaître rapidement sans attendre toutes les données métier.

**Preuve attendue.** Le chargement des features et sources est progressif et ciblé.

### UXR-0804 — MUST · P1 · AUTO

**Règle.** Chaque vue doit charger uniquement les données nécessaires à sa question et à son premier viewport.

**Preuve attendue.** Le graphe BFF par vue exclut les sources inutiles.

### UXR-0805 — MUST · P1 · AUTO

**Règle.** Les routes et composants lourds doivent être lazy-loadés par feature.

**Preuve attendue.** Le bundle initial ne contient pas les 24 pages si elles ne sont pas nécessaires.

### UXR-0806 — MUST · P1 · AUTO

**Règle.** Les images, fonts, charts et librairies doivent être chargés selon leur priorité réelle.

**Preuve attendue.** Les ressources non critiques sont différées et mesurées.

### UXR-0807 — MUST · P1 · AUTO

**Règle.** Les dimensions de contenu dynamique doivent être réservées pour limiter le CLS.

**Preuve attendue.** Images, tables et skeletons stabilisent la mise en page.

### UXR-0808 — MUST · P1 · AUTO

**Règle.** Les interactions ne doivent pas exécuter de longues tâches synchrones sur le thread principal.

**Preuve attendue.** Le profiling identifie et découpe les tâches longues.

### UXR-0809 — MUST · P1 · AUTO

**Règle.** Les mises à jour live doivent être regroupées et limitées pour éviter des re-renders inutiles.

**Preuve attendue.** Les composants s'abonnent au minimum de données nécessaire.

### UXR-0810 — MUST · P1 · SEMI

**Règle.** Les listes longues doivent utiliser pagination, windowing ou rendu progressif selon l'accessibilité et la tâche.

**Preuve attendue.** Le choix est testé sur volume cible et extrême.

### UXR-0811 — MUST · P1 · AUTO

**Règle.** Les calculs coûteux doivent être effectués côté backend ou worker lorsqu'ils ne relèvent pas d'une simple présentation.

**Preuve attendue.** Le thread UI reste disponible pour les interactions.

### UXR-0812 — MUST · P1 · SEMI

**Règle.** Le cache doit réduire les fetches inutiles sans masquer la fraîcheur ou les changements d'autorisation.

**Preuve attendue.** Les politiques de stale et invalidation sont documentées.

### UXR-0813 — MUST · P1 · MANUAL

**Règle.** Les états de chargement doivent apparaître assez tôt pour éviter l'impression de blocage, sans clignoter pour des réponses instantanées.

**Preuve attendue.** Un délai ou stratégie de transition est cohérent.

### UXR-0814 — MUST NOT · P1 · MANUAL

**Règle.** Une animation de chargement ne doit pas masquer une latence structurelle non mesurée.

**Preuve attendue.** La cause réseau, backend ou rendu est profilée et traitée.

### UXR-0815 — MUST · P1 · AUTO

**Règle.** Les métriques de performance doivent être collectées en conditions réelles avec contexte de route, appareil et réseau sans données sensibles.

**Preuve attendue.** Le RUM complète les tests de laboratoire.

### UXR-0816 — MUST · P1 · AUTO

**Règle.** Les budgets de bundle doivent être appliqués par feature et dépendance.

**Preuve attendue.** Une augmentation exige justification et mesure d'impact.

### UXR-0817 — MUST · P1 · AUTO

**Règle.** Les bibliothèques dupliquées, polyfills inutiles et imports globaux doivent être détectés.

**Preuve attendue.** L'analyse de bundle fait partie de la CI.

### UXR-0818 — MUST · P1 · AUTO

**Règle.** La performance doit être testée avec données réalistes et non uniquement sur une page vide.

**Preuve attendue.** Les fixtures reproduisent cardinalités, contenu long et flux live.

### UXR-0819 — MUST · P1 · MANUAL

**Règle.** Une optimisation ne doit pas dégrader accessibilité, exactitude ou maintenabilité sans preuve et arbitrage.

**Preuve attendue.** Le benchmark inclut les effets secondaires et une décision documentée.

### UXR-0820 — MUST · P0 · AUTO

**Règle.** Toute régression au-delà d'un budget critique doit bloquer la release ou déclencher une dérogation datée.

**Preuve attendue.** La CI ou le monitoring de release applique le seuil.

---

# Chapitre 42 — Tests UI, accessibilité, interaction, visuel et E2E

**Objectif :** Prouver le comportement réel à plusieurs niveaux et empêcher que les baselines remplacent le jugement.

**Sources fondatrices :** S01, S24, S25

**Plage :** `UXR-0821` à `UXR-0840`

### UXR-0821 — MUST · P0 · AUTO

**Règle.** Chaque mapper doit être testé avec DTO complet, partiel, inconnu, nul et invalide.

**Preuve attendue.** Les tests vérifient états de vérité et absence de faux fallbacks.

### UXR-0822 — MUST · P1 · AUTO

**Règle.** Chaque composant partagé doit avoir des stories couvrant variantes, états et contenu extrême.

**Preuve attendue.** Le catalogue est exécutable en CI.

### UXR-0823 — MUST · P0 · AUTO

**Règle.** Les composants interactifs doivent avoir des tests clavier et focus.

**Preuve attendue.** Les scénarios utilisent des rôles et noms accessibles.

### UXR-0824 — MUST · P0 · AUTO

**Règle.** Les scans axe ou équivalents doivent être exécutés sur composants et pages critiques.

**Preuve attendue.** Les violations nouvelles P0/P1 bloquent la CI.

### UXR-0825 — MUST · P0 · MANUAL

**Règle.** Les scans automatisés ne remplacent pas les tests manuels avec lecteurs d'écran et utilisateurs.

**Preuve attendue.** La Definition of Done distingue les deux preuves.

### UXR-0826 — MUST · P1 · AUTO

**Règle.** Les snapshots ARIA doivent protéger la structure accessible des écrans critiques.

**Preuve attendue.** Les changements de rôle, nom, niveau et état sont revus.

### UXR-0827 — MUST · P1 · AUTO

**Règle.** Les tests visuels doivent comparer les pixels dans un environnement stable.

**Preuve attendue.** Les baselines sont versionnées et les diffs revus humainement.

### UXR-0828 — MUST NOT · P1 · MANUAL

**Règle.** Une baseline visuelle ne doit pas être mise à jour automatiquement pour faire passer la CI.

**Preuve attendue.** Chaque changement est accepté avec intention et commentaire si significatif.

### UXR-0829 — MUST · P1 · AUTO

**Règle.** Les tests d'interaction doivent utiliser les contrôles comme un utilisateur, non appeler directement des handlers internes.

**Preuve attendue.** Les scénarios cliquent, tapent et naviguent par rôle.

### UXR-0830 — MUST · P0 · AUTO

**Règle.** Les parcours E2E doivent couvrir au minimum succès, erreur, permission refusée, données partielles et reprise.

**Preuve attendue.** Chaque flow critique possède ces variantes ou une justification.

### UXR-0831 — MUST · P0 · AUTO

**Règle.** Les actions sensibles doivent être testées jusqu'à l'état terminal backend et l'audit.

**Preuve attendue.** Le test ne s'arrête pas au reçu ACCEPTED.

### UXR-0832 — MUST · P1 · AUTO

**Règle.** Les tests de responsive doivent couvrir les viewports et densités contractuels.

**Preuve attendue.** Les captures vérifient overflow, contenu masqué et navigation.

### UXR-0833 — MUST · P1 · AUTO

**Règle.** Les tests de contenu doivent inclure chaînes longues, langues, chiffres extrêmes et absence de données.

**Preuve attendue.** Le layout ne dépend pas des exemples courts.

### UXR-0834 — MUST · P1 · AUTO

**Règle.** Les tests temps réel doivent injecter perte, duplication, réordonnancement, burst et reconnexion.

**Preuve attendue.** Le state final reste cohérent et traçable.

### UXR-0835 — MUST · P1 · AUTO

**Règle.** Les tests de performance doivent utiliser les budgets définis et une cardinalité réaliste.

**Preuve attendue.** Les résultats sont comparables dans le temps.

### UXR-0836 — MUST · P1 · AUTO

**Règle.** Les tests de sécurité UI doivent couvrir redaction, URLs, exports, permissions et contenus non fiables.

**Preuve attendue.** Aucune donnée sensible ne fuit dans le DOM ou les logs.

### UXR-0837 — MUST · P1 · AUTO

**Règle.** Les fixtures doivent être nommées par scénario et ne pas devenir un dataset fourre-tout.

**Preuve attendue.** Chaque fixture exprime l'état qu'elle prouve.

### UXR-0838 — MUST · P1 · AUTO

**Règle.** Les tests fragiles basés sur classes ou structure non sémantique doivent être remplacés par rôles, labels ou test IDs stables en dernier recours.

**Preuve attendue.** Les tests reflètent l'expérience utilisateur.

### UXR-0839 — MUST · P1 · SEMI

**Règle.** Chaque bug UI important doit recevoir un test de non-régression au niveau le plus proche de sa cause.

**Preuve attendue.** Le ticket lie bug, test et règle UXR.

### UXR-0840 — MUST · P0 · SEMI

**Règle.** Une page n'est pas Done tant que ses états, responsive, accessibilité, interactions et E2E principaux ne sont pas prouvés.

**Preuve attendue.** La checklist de release contient les preuves exécutées.

---

# Chapitre 43 — Mesure UX, analytics, expérimentation et apprentissage

**Objectif :** Mesurer la capacité des utilisateurs à réussir leurs tâches tout en protégeant confidentialité, qualité et causalité.

**Sources fondatrices :** S04, S06, S19

**Plage :** `UXR-0841` à `UXR-0860`

### UXR-0841 — MUST · P1 · MANUAL

**Règle.** Chaque parcours critique doit définir un résultat utilisateur et non seulement un événement de clic.

**Preuve attendue.** La métrique mesure réussite, qualité ou temps jusqu'au résultat.

### UXR-0842 — MUST · P1 · AUTO

**Règle.** Les événements analytics doivent être nommés par intention et versionnés.

**Preuve attendue.** Le schéma indique déclencheur, propriétés, finalité et propriétaire.

### UXR-0843 — MUST · P0 · AUTO

**Règle.** Les analytics ne doivent pas collecter de payload, texte libre ou donnée sensible sans justification et protection.

**Preuve attendue.** Une allowlist de propriétés est appliquée.

### UXR-0844 — MUST · P1 · SEMI

**Règle.** Les métriques doivent distinguer abandon, erreur, refus volontaire et perte de connexion.

**Preuve attendue.** Le funnel ne fusionne pas des causes différentes.

### UXR-0845 — MUST · P1 · MANUAL

**Règle.** Les temps de tâche doivent utiliser des points de début et de fin définis par le workflow.

**Preuve attendue.** La mesure ne dépend pas d'une page arbitraire.

### UXR-0846 — MUST · P1 · MANUAL

**Règle.** Une hausse de conversion ne doit pas être considérée positive si elle augmente erreurs, regrets, tickets ou risques.

**Preuve attendue.** Les garde-fous sont définis avant l'expérience.

### UXR-0847 — MUST · P1 · SEMI

**Règle.** Les expérimentations doivent avoir hypothèse, population, métrique principale, garde-fous et durée avant lancement.

**Preuve attendue.** Le plan évite le choix opportuniste de résultats.

### UXR-0848 — MUST · P0 · MANUAL

**Règle.** Une expérience ne doit pas modifier silencieusement un parcours de sécurité, consentement ou accessibilité critique.

**Preuve attendue.** Une revue et un niveau de risque approprié sont requis.

### UXR-0849 — MUST · P1 · AUTO

**Règle.** Les variantes doivent préserver la même vérité des données et les mêmes permissions.

**Preuve attendue.** L'expérimentation porte sur la présentation ou le parcours, pas sur l'autorité.

### UXR-0850 — MUST · P1 · MANUAL

**Règle.** Les résultats doivent indiquer taille, incertitude et limites d'interprétation.

**Preuve attendue.** Le rapport ne transforme pas une corrélation en causalité sans méthode.

### UXR-0851 — MUST · P1 · MANUAL

**Règle.** Les cohortes doivent être définies sans créer de discrimination ou fuite de données.

**Preuve attendue.** La segmentation est revue privacy et fairness.

### UXR-0852 — MUST · P1 · AUTO

**Règle.** Les événements doivent être testés pour absence de doublons et ordre correct.

**Preuve attendue.** La CI ou les tests E2E vérifient le contrat analytics.

### UXR-0853 — MUST · P1 · SEMI

**Règle.** Le produit doit permettre de relier un problème UX aux conditions de contexte sans enregistrer plus de données que nécessaire.

**Preuve attendue.** Route, rôle, état et erreur suffisent souvent au diagnostic.

### UXR-0854 — MUST · P1 · MANUAL

**Règle.** Les métriques terrain doivent être combinées à des retours qualitatifs.

**Preuve attendue.** Une anomalie ouvre une investigation utilisateur, pas seulement une optimisation numérique.

### UXR-0855 — MUST · P1 · AUTO

**Règle.** Les dashboards analytics internes doivent suivre les mêmes règles de provenance, période et inconnus que le produit.

**Preuve attendue.** Aucun KPI d'usage n'utilise un zéro ambigu.

### UXR-0856 — MUST · P1 · AUTO

**Règle.** Les changements de schéma analytics doivent prévoir compatibilité et migration des rapports.

**Preuve attendue.** La version d'événement est visible.

### UXR-0857 — SHOULD · P2 · MANUAL

**Règle.** Les funnels peuvent inclure les étapes Observer, Comprendre, Investiguer, Agir et Vérifier pour détecter où le parcours échoue.

**Preuve attendue.** Les étapes sont adaptées au cas réel.

### UXR-0858 — MUST · P1 · AUTO

**Règle.** Les données de test et bots doivent être filtrés ou identifiés.

**Preuve attendue.** Les décisions produit ne reposent pas sur du trafic artificiel.

### UXR-0859 — MUST · P1 · SEMI

**Règle.** Les métriques de succès doivent avoir un propriétaire et une fréquence de revue.

**Preuve attendue.** Les signaux inutilisés sont supprimés pour limiter la collecte.

### UXR-0860 — MUST · P0 · MANUAL

**Règle.** Aucune décision majeure ne doit être attribuée aux analytics seuls lorsque les données ne permettent pas cette conclusion.

**Preuve attendue.** Le rapport distingue mesure, interprétation et recommandation.

---

# Chapitre 44 — Collaboration design-développement, handoff et décisions

**Objectif :** Maintenir une compréhension commune entre produit, design, frontend, backend, QA et agents LLM.

**Sources fondatrices :** S04, S23, S24, S31

**Plage :** `UXR-0861` à `UXR-0880`

### UXR-0861 — MUST · P1 · SEMI

**Règle.** Toute tâche écran doit partir du Page Operating Contract et de la Screen Specification, pas seulement d'une capture.

**Preuve attendue.** La PR lie objectif, questions, données, actions et états.

### UXR-0862 — MUST · P1 · MANUAL

**Règle.** Le handoff doit fournir comportements, responsive, états, contenu et données, pas uniquement dimensions et couleurs.

**Preuve attendue.** Les cas interactifs et dégradés sont documentés.

### UXR-0863 — MUST · P1 · SEMI

**Règle.** Les composants de design et de code doivent partager noms, variantes et tokens autant que possible.

**Preuve attendue.** Le mapping Figma-code ou équivalent est maintenu.

### UXR-0864 — MUST · P1 · MANUAL

**Règle.** Une décision visuelle qui modifie le comportement doit être revue comme une décision produit.

**Preuve attendue.** Le changement possède critères d'acceptation et tests.

### UXR-0865 — MUST · P1 · MANUAL

**Règle.** Les annotations doivent expliquer l'intention et les contraintes, pas dicter chaque pixel sans contexte.

**Preuve attendue.** Le développeur peut prendre une décision cohérente dans les cas non dessinés.

### UXR-0866 — MUST · P1 · SEMI

**Règle.** Les maquettes doivent identifier les données fictives et les capacités non implémentées.

**Preuve attendue.** Un badge DEMO ou une note évite leur interprétation comme vérité produit.

### UXR-0867 — MUST · P1 · SEMI

**Règle.** Les designers doivent utiliser les composants et tokens disponibles avant d'inventer une variante.

**Preuve attendue.** Toute nouvelle variante passe par la gouvernance du design system.

### UXR-0868 — MUST · P1 · MANUAL

**Règle.** Les développeurs ne doivent pas corriger silencieusement une maquette ambiguë sur un parcours critique.

**Preuve attendue.** La question est résolue dans le ticket ou un ADR UX.

### UXR-0869 — MUST · P1 · MANUAL

**Règle.** Les changements de contrat backend qui affectent l'UX doivent être discutés avec design et produit.

**Preuve attendue.** Les états, latences, erreurs et cardinalités sont réévalués.

### UXR-0870 — MUST · P1 · SEMI

**Règle.** Les reviews doivent examiner le rendu réel avec données et états, pas seulement le diff de code.

**Preuve attendue.** La PR contient captures ou environnement de preview.

### UXR-0871 — MUST · P1 · AUTO

**Règle.** Les captures de PR doivent utiliser les viewports, thèmes et densités contractuels.

**Preuve attendue.** Les images isolées hors contexte ne suffisent pas.

### UXR-0872 — MUST · P1 · SEMI

**Règle.** Les décisions structurantes doivent être enregistrées dans un ADR UX ou architecture.

**Preuve attendue.** Le document contient alternatives, impacts et date de révision.

### UXR-0873 — MUST · P1 · AUTO

**Règle.** Le glossaire métier et le catalogue de composants doivent être accessibles aux agents et humains dans le dépôt.

**Preuve attendue.** L'ordre de lecture est défini dans START_HERE ou AGENTS.

### UXR-0874 — MUST · P1 · AUTO

**Règle.** Le handoff généré doit être régénéré depuis les sources plutôt que modifié manuellement.

**Preuve attendue.** La commande de build et le fichier source sont documentés.

### UXR-0875 — MUST · P1 · SEMI

**Règle.** Les tickets doivent relier règle métier, API, permission, composant, route, états, responsive, tests et flag.

**Preuve attendue.** La matrice de traçabilité est complète avant développement.

### UXR-0876 — MUST · P1 · MANUAL

**Règle.** Les commentaires de revue doivent citer le principe ou la règle concernée plutôt qu'une préférence vague.

**Preuve attendue.** Les identifiants UXR rendent la discussion actionnable.

### UXR-0877 — MUST · P1 · MANUAL

**Règle.** Les désaccords doivent être tranchés par utilisateur, risque, données et cohérence, non par séniorité seule.

**Preuve attendue.** La décision et la preuve sont consignées.

### UXR-0878 — MUST · P1 · SEMI

**Règle.** Une dérogation visuelle ou interactionnelle doit avoir une date d'expiration et un propriétaire.

**Preuve attendue.** Le registre évite la dette permanente implicite.

### UXR-0879 — MUST · P1 · MANUAL

**Règle.** Les démonstrations de fin de sprint doivent montrer parcours, erreurs et responsive, pas uniquement le happy path desktop.

**Preuve attendue.** La checklist de démo couvre les états critiques.

### UXR-0880 — MUST · P0 · MANUAL

**Règle.** Un agent LLM doit signaler toute information manquante qu'il n'a pas pu vérifier au lieu de la compléter par invention.

**Preuve attendue.** Le rapport de sortie liste hypothèses, preuves et limites.

---

# Chapitre 45 — Personnalisation, thèmes, densité et préférences

**Objectif :** Offrir de la flexibilité sans casser la cohérence, les politiques, la sécurité ou l'accessibilité.

**Sources fondatrices :** S05, S09, S15, S30

**Plage :** `UXR-0881` à `UXR-0900`

### UXR-0881 — MUST · P1 · MANUAL

**Règle.** La personnalisation doit améliorer une tâche réelle et non créer une complexité de configuration sans valeur.

**Preuve attendue.** Chaque option possède un usage et une population identifiés.

### UXR-0882 — MUST · P1 · AUTO

**Règle.** Les préférences personnelles doivent être distinctes des policies organisationnelles.

**Preuve attendue.** L'UI montre ce qui est modifiable, imposé ou hérité.

### UXR-0883 — MUST · P1 · AUTO

**Règle.** Les thèmes doivent utiliser des tokens sémantiques et préserver contrastes, focus et états.

**Preuve attendue.** Les tests couvrent clair, sombre et contraste élevé.

### UXR-0884 — MUST · P1 · AUTO

**Règle.** Les profils de densité doivent être nommés, persistés et limités à des seuils accessibles.

**Preuve attendue.** Aucun profil ne réduit texte ou cibles sous les minima internes.

### UXR-0885 — MUST · P1 · AUTO

**Règle.** La personnalisation d'un dashboard ne doit pas permettre de masquer silencieusement les alertes ou informations obligatoires.

**Preuve attendue.** Les widgets critiques sont fixes ou leur retrait produit un avertissement fort.

### UXR-0886 — MUST · P1 · MANUAL

**Règle.** Les préférences doivent avoir des valeurs par défaut sûres et adaptées au rôle.

**Preuve attendue.** Le premier lancement reste utilisable sans configuration.

### UXR-0887 — MUST · P1 · AUTO

**Règle.** La synchronisation des préférences doit indiquer état, conflit et portée multi-appareil.

**Preuve attendue.** Un échec ne produit pas un faux succès.

### UXR-0888 — MUST · P1 · AUTO

**Règle.** Les préférences locales doivent être versionnées et migrées.

**Preuve attendue.** Une ancienne valeur ne casse pas le shell après mise à jour.

### UXR-0889 — MUST · P1 · MANUAL

**Règle.** Un reset doit préciser s'il concerne la section, la vue ou toutes les préférences.

**Preuve attendue.** La portée est prévisualisée et confirmée si large.

### UXR-0890 — MUST · P1 · AUTO

**Règle.** Les vues sauvegardées doivent séparer préférences de layout et filtres métier.

**Preuve attendue.** L'utilisateur peut partager les filtres sans imposer sa densité personnelle.

### UXR-0891 — MUST · P1 · AUTO

**Règle.** Les raccourcis personnalisables doivent détecter les conflits et préserver une méthode d'accès alternative.

**Preuve attendue.** Le produit n'accepte pas une combinaison réservée sans avertissement.

### UXR-0892 — MUST · P1 · AUTO

**Règle.** Les préférences d'accessibilité système doivent être respectées par défaut.

**Preuve attendue.** Reduced motion, contrast, color scheme et taille ne sont pas neutralisés.

### UXR-0893 — MUST · P1 · AUTO

**Règle.** La personnalisation ne doit pas modifier les calculs, permissions ou ordre d'autorité des données.

**Preuve attendue.** Elle affecte présentation et organisation contrôlée uniquement.

### UXR-0894 — MUST · P1 · MANUAL

**Règle.** Les paramètres avancés doivent être séparés des réglages fréquents.

**Preuve attendue.** La page évite de submerger l'utilisateur occasionnel.

### UXR-0895 — MUST · P1 · SEMI

**Règle.** Les options doivent avoir un aperçu lorsque l'effet visuel est difficile à imaginer.

**Preuve attendue.** Le preview est réversible avant sauvegarde.

### UXR-0896 — MUST · P1 · AUTO

**Règle.** La personnalisation doit fonctionner sur tous les viewports supportés ou être limitée explicitement.

**Preuve attendue.** Une disposition desktop impossible sur mobile reçoit une adaptation claire.

### UXR-0897 — SHOULD · P2 · MANUAL

**Règle.** Le produit peut proposer des presets par rôle sans enfermer l'utilisateur dans un persona rigide.

**Preuve attendue.** Les presets sont modifiables et expliqués.

### UXR-0898 — MUST · P1 · AUTO

**Règle.** Les préférences sensibles comme notifications critiques doivent respecter une limite imposée par policy.

**Preuve attendue.** Le contrôle explique pourquoi il ne peut pas être désactivé.

### UXR-0899 — MUST · P1 · SEMI

**Règle.** Le volume d'options doit être surveillé et les préférences inutilisées supprimées ou regroupées.

**Preuve attendue.** Les analytics respectueux de la vie privée alimentent la simplification.

### UXR-0900 — MUST · P1 · AUTO

**Règle.** Chaque préférence doit être testée avec valeur par défaut, personnalisée, invalide, migration et conflit.

**Preuve attendue.** Les tests couvrent le cycle complet.

---

# Chapitre 46 — Résilience, modes dégradés, reprise et continuité de tâche

**Objectif :** Préserver la compréhension, la sécurité et la progression lorsque le réseau, une source, une commande ou une dépendance échoue.

**Sources fondatrices :** S01, S05, S10, S19, S26, S30

**Plage :** `UXR-0901` à `UXR-0920`

### UXR-0901 — MUST · P0 · AUTO

**Règle.** Chaque dépendance externe visible dans un parcours critique doit avoir un état de disponibilité distinct de la valeur métier.

**Preuve attendue.** L'UI distingue source indisponible, valeur inconnue et valeur réellement nulle.

### UXR-0902 — MUST · P0 · SEMI

**Règle.** Une panne partielle ne doit pas transformer l'ensemble de l'écran en erreur si des sections fiables restent exploitables.

**Preuve attendue.** Les sections portent leur propre état, source et dernier asOf.

### UXR-0903 — MUST · P0 · AUTO

**Règle.** Les dernières valeurs connues doivent être datées et explicitement marquées comme anciennes.

**Preuve attendue.** Aucune donnée stale ne ressemble à une donnée live.

### UXR-0904 — MUST · P0 · AUTO

**Règle.** Une reconnexion ne doit pas réexécuter automatiquement une commande non idempotente.

**Preuve attendue.** Le protocole de reprise sépare relecture et mutation.

### UXR-0905 — MUST · P1 · SEMI

**Règle.** Une action interrompue doit indiquer si elle n'a pas été envoyée, a été reçue ou a un résultat indéterminé.

**Preuve attendue.** Le message propose la prochaine vérification sûre.

### UXR-0906 — MUST · P1 · AUTO

**Règle.** Les formulaires longs doivent préserver le brouillon local ou serveur selon le risque et la sensibilité.

**Preuve attendue.** Un test couvre fermeture, refresh, perte réseau et reprise.

### UXR-0907 — MUST · P1 · AUTO

**Règle.** Les files d'attente hors ligne ne doivent être utilisées que pour des actions réversibles et explicitement compatibles.

**Preuve attendue.** Les mutations sensibles restent bloquées jusqu'à une connexion vérifiée.

### UXR-0908 — MUST · P1 · AUTO

**Règle.** Le produit doit permettre de réessayer une lecture sans perdre filtres, sélection ni position de scroll.

**Preuve attendue.** Le retry conserve le contexte de travail.

### UXR-0909 — MUST · P1 · AUTO

**Règle.** Les retries automatiques doivent être bornés, temporisés et visibles lorsqu'ils affectent la fraîcheur.

**Preuve attendue.** Le client ne crée pas de boucle de charge ou de faux état nominal.

### UXR-0910 — MUST · P0 · AUTO

**Règle.** Une erreur de permission ne doit jamais être présentée comme une panne réseau ou une ressource vide.

**Preuve attendue.** 401, 403, 404, 409, 422, 429 et 503 ont des traitements distincts.

### UXR-0911 — MUST · P1 · SEMI

**Règle.** Une erreur globale doit indiquer l'étendue affectée, l'heure, une référence de diagnostic et une action sûre.

**Preuve attendue.** Le message évite les détails sensibles et le jargon inutile.

### UXR-0912 — MUST · P1 · SEMI

**Règle.** Le produit doit offrir un chemin de retour lorsque l'état local devient incompatible avec l'état serveur.

**Preuve attendue.** Refresh ciblé, rebase, annulation ou reprise sont définis selon le workflow.

### UXR-0913 — MUST · P1 · MANUAL

**Règle.** Les conflits de version doivent montrer ce qui a changé avant de proposer écrasement ou nouvelle tentative.

**Preuve attendue.** Une action destructive n'est jamais le choix par défaut.

### UXR-0914 — MUST · P1 · AUTO

**Règle.** La reprise après incident doit restaurer le contexte pertinent sans restaurer une action dangereuse non confirmée.

**Preuve attendue.** La route et les filtres reviennent, la confirmation sensible non.

### UXR-0915 — MUST · P1 · AUTO

**Règle.** Les composants temps réel doivent signaler déconnexion, tentative de reprise et retour au nominal.

**Preuve attendue.** Le statut n'est pas uniquement une animation ou une couleur.

### UXR-0916 — MUST · P1 · AUTO

**Règle.** Une source lente doit avoir un budget et ne pas bloquer les sources indépendantes.

**Preuve attendue.** Les loaders et timeouts sont définis par vue ou section.

### UXR-0917 — MUST · P1 · MANUAL

**Règle.** Les données partielles doivent expliquer précisément quelles conclusions ne peuvent plus être tirées.

**Preuve attendue.** Le message relie l'indisponibilité à son impact utilisateur.

### UXR-0918 — MUST · P1 · SEMI

**Règle.** Les modes de maintenance planifiée doivent indiquer début, durée estimée, fonctions affectées et alternatives.

**Preuve attendue.** L'utilisateur peut différencier maintenance et incident imprévu.

### UXR-0919 — MUST · P1 · SEMI

**Règle.** Les scénarios de chaos UX doivent couvrir au minimum source lente, source absente, stream coupé, commande ambiguë et reprise après refresh.

**Preuve attendue.** Les tests de résilience produisent des preuves reproductibles.

### UXR-0920 — MUST · P0 · AUTO

**Règle.** Le système ne doit jamais déclarer une opération réussie uniquement parce qu'aucune erreur n'a été reçue.

**Preuve attendue.** Le succès exige un état terminal et, lorsque pertinent, la relecture cohérente de la ressource.

---

# Chapitre 47 — Interfaces de contrôle à haut enjeu, trading et opérations temps réel

**Objectif :** Renforcer la vérité, la vigilance, la prévention des erreurs et la traçabilité dans les postes de contrôle où une mauvaise décision a un coût élevé.

**Sources fondatrices :** S01, S04, S05, S17, S26, S27, S30

**Plage :** `UXR-0921` à `UXR-0940`

### UXR-0921 — MUST · P0 · AUTO

**Règle.** L'environnement opérationnel actif doit être visible en permanence et impossible à confondre avec DEMO, PAPER ou REPLAY.

**Preuve attendue.** Le shell, les dialogues et les reçus répètent l'environnement autoritaire.

### UXR-0922 — MUST · P0 · AUTO

**Règle.** Les données de marché, risque, ordre et position doivent afficher leur fraîcheur et leur source lorsque l'âge influence la décision.

**Preuve attendue.** Chaque valeur critique possède asOf, source et état de connexion.

### UXR-0923 — MUST · P0 · SEMI

**Règle.** Une recommandation IA ne doit jamais être visuellement équivalente à une décision déterministe, un verdict risque ou un ordre exécuté.

**Preuve attendue.** Le niveau d'autorité est explicite par label, structure et provenance.

### UXR-0924 — MUST · P0 · AUTO

**Règle.** Les actions de kill, flatten, cancel, override, cutover ou passage LIVE doivent être isolées des actions courantes.

**Preuve attendue.** Le contrôle exige capability, step-up, impact, raison et confirmation renforcée.

### UXR-0925 — MUST · P0 · SEMI

**Règle.** Une action sensible doit montrer l'objet, le compte, l'instrument, la quantité, l'environnement et l'effet attendu avant confirmation.

**Preuve attendue.** Le résumé de confirmation ne dépend pas du contexte mémorisé.

### UXR-0926 — MUST · P0 · AUTO

**Règle.** Les ordres et positions doivent utiliser une machine d'état canonique sans normaliser un statut inconnu vers un statut rassurant.

**Preuve attendue.** Les transitions brutes et canoniques restent inspectables.

### UXR-0927 — MUST · P0 · AUTO

**Règle.** Une position dite protégée doit être prouvée par des ordres ou règles actives et non par un simple booléen de présentation.

**Preuve attendue.** Le détail montre stop, target, provider et dernière confirmation.

### UXR-0928 — MUST · P0 · AUTO

**Règle.** Les limites de risque absentes doivent être affichées NOT_CONFIGURED ou UNKNOWN, jamais comme non utilisées.

**Preuve attendue.** La page bloque les conclusions qui dépendent de la limite.

### UXR-0929 — MUST · P0 · AUTO

**Règle.** Les KPI de risque et performance doivent relier agrégat, contributeurs, positions, événements et politique applicable.

**Preuve attendue.** Le drill-down conserve période et environnement.

### UXR-0930 — MUST · P1 · MANUAL

**Règle.** La page live doit prioriser l'état courant, l'exception, la décision, la position et le prochain jalon avant l'historique exhaustif.

**Preuve attendue.** Le test des cinq secondes valide cette hiérarchie.

### UXR-0931 — MUST · P1 · AUTO

**Règle.** Les timelines doivent distinguer prévu, demandé, accepté, exécuté, confirmé, réconcilié et échoué.

**Preuve attendue.** Les événements sont ordonnés par temps et causalité lorsque disponibles.

### UXR-0932 — MUST · P1 · AUTO

**Règle.** Les événements hors ordre, dupliqués ou manquants doivent être signalés plutôt que silencieusement réarrangés.

**Preuve attendue.** L'intégrité du flux possède un statut observable.

### UXR-0933 — MUST · P1 · AUTO

**Règle.** Les nombres financiers doivent utiliser chiffres tabulaires, signe explicite, unité, devise et précision cohérente.

**Preuve attendue.** Les comparaisons restent alignées et non ambiguës.

### UXR-0934 — MUST · P1 · AUTO

**Règle.** La couleur rouge ou verte ne doit pas être l'unique moyen de distinguer perte, gain, achat, vente ou statut.

**Preuve attendue.** Labels, signes, icônes ou motifs portent le sens.

### UXR-0935 — MUST · P1 · AUTO

**Règle.** Les raccourcis clavier d'action sensible doivent être désactivables, documentés et protégés contre les déclenchements accidentels.

**Preuve attendue.** Une confirmation et un focus explicite restent requis.

### UXR-0936 — MUST · P1 · SEMI

**Règle.** Les alertes doivent être dédupliquées, corrélées et priorisées par impact, pas seulement par volume.

**Preuve attendue.** L'opérateur voit owner, âge, portée et prochaine action.

### UXR-0937 — MUST · P1 · MANUAL

**Règle.** Le produit doit limiter l'alarme fatigue en réservant les interruptions fortes aux états réellement urgents.

**Preuve attendue.** La sévérité a une définition et une politique d'escalade.

### UXR-0938 — MUST · P1 · AUTO

**Règle.** Les opérations manuelles et automatiques doivent être distinguées dans la timeline et l'audit.

**Preuve attendue.** Acteur, policy, modèle et raison sont visibles selon permission.

### UXR-0939 — MUST · P1 · AUTO

**Règle.** Tout écran critique doit avoir un mode de lecture stable pendant les pics de stream.

**Preuve attendue.** Pause, buffering ou compteur de nouveaux événements évitent les déplacements incontrôlés.

### UXR-0940 — MUST · P0 · SEMI

**Règle.** La Definition of Done d'un parcours critique doit inclure un E2E contre le backend réel, une panne simulée, une permission refusée et une preuve d'audit.

**Preuve attendue.** Une maquette ou fixture seule ne valide jamais l'opérabilité.

---

# Chapitre 48 — Anti-patterns UI/UX explicitement interdits

**Objectif :** Empêcher les raccourcis qui rendent les produits visuellement crédibles mais confus, trompeurs, fragiles ou inexploitables.

**Sources fondatrices :** S01, S02, S05, S10, S16, S28, S29, S30, S31

**Plage :** `UXR-0941` à `UXR-0960`

### UXR-0941 — MUST NOT · P0 · AUTO

**Règle.** Ne pas afficher une action sans route, handler ou commande réelle.

**Preuve attendue.** Le composant exige un to ou un onAction typé et testé.

### UXR-0942 — MUST NOT · P0 · AUTO

**Règle.** Ne pas convertir une absence de donnée en zéro, PASS, OK, NOMINAL, ACCEPTED ou valeur vide rassurante.

**Preuve attendue.** Les états discriminés rendent l'inconnu explicite.

### UXR-0943 — MUST NOT · P1 · MANUAL

**Règle.** Ne pas construire une page comme une répétition automatique de six KPI et six cartes.

**Preuve attendue.** La structure découle des questions et actions du Page Operating Contract.

### UXR-0944 — MUST NOT · P1 · MANUAL

**Règle.** Ne pas utiliser des cartes uniquement pour remplir l'espace ou donner une impression de richesse.

**Preuve attendue.** Chaque carte répond à une question et possède une action ou une justification.

### UXR-0945 — MUST NOT · P1 · MANUAL

**Règle.** Ne pas placer tout le détail d'un objet dans une modale ou un drawer lorsque l'investigation est longue ou partageable.

**Preuve attendue.** Une page L2/L3 stable est créée.

### UXR-0946 — MUST NOT · P1 · AUTO

**Règle.** Ne pas masquer la navigation principale derrière des icônes ambiguës ou une tranche arbitraire de destinations.

**Preuve attendue.** Tous les domaines autorisés restent trouvables sur chaque viewport.

### UXR-0947 — MUST NOT · P1 · AUTO

**Règle.** Ne pas utiliser une police minuscule pour simuler la densité professionnelle.

**Preuve attendue.** La densité vient de la hiérarchie, des espacements et du choix d'information.

### UXR-0948 — MUST NOT · P0 · AUTO

**Règle.** Ne pas supprimer l'outline de focus sans remplacement visible et conforme.

**Preuve attendue.** Le focus reste perceptible dans tous les thèmes et états.

### UXR-0949 — MUST NOT · P1 · AUTO

**Règle.** Ne pas utiliser transition all, animations permanentes ou mouvement décoratif qui perturbe la tâche.

**Preuve attendue.** Les propriétés animées sont explicites et reduced-motion est respecté.

### UXR-0950 — MUST NOT · P1 · AUTO

**Règle.** Ne pas utiliser le placeholder comme seul label de champ.

**Preuve attendue.** Un label persistant et une description accessible existent.

### UXR-0951 — MUST NOT · P0 · AUTO

**Règle.** Ne pas rendre un div ou span cliquable comme substitut d'un bouton ou d'un lien natif.

**Preuve attendue.** La sémantique native et le clavier sont utilisés.

### UXR-0952 — MUST NOT · P1 · SEMI

**Règle.** Ne pas utiliser des icônes sans label lorsqu'elles ne sont pas universellement comprises ou lorsqu'elles déclenchent une action critique.

**Preuve attendue.** Tooltip, nom accessible et texte visible selon contexte sont fournis.

### UXR-0953 — MUST NOT · P1 · AUTO

**Règle.** Ne pas ouvrir systématiquement un nouvel onglet ou une nouvelle fenêtre sans nécessité et annonce.

**Preuve attendue.** Le contexte de navigation reste prévisible.

### UXR-0954 — MUST NOT · P1 · MANUAL

**Règle.** Ne pas demander confirmation pour chaque petite action ni omettre la confirmation des actions irréversibles.

**Preuve attendue.** La friction est proportionnelle au risque.

### UXR-0955 — MUST NOT · P0 · MANUAL

**Règle.** Ne pas employer des dark patterns, urgence artificielle, case précochée trompeuse, double négation ou bouton déséquilibré pour obtenir un consentement.

**Preuve attendue.** Les choix sont équivalents, clairs et réversibles.

### UXR-0956 — MUST NOT · P1 · MANUAL

**Règle.** Ne pas introduire un carrousel, un accordéon ou un scroll horizontal pour cacher une mauvaise hiérarchie de contenu.

**Preuve attendue.** Le pattern est justifié par la tâche et testé.

### UXR-0957 — MUST NOT · P1 · AUTO

**Règle.** Ne pas coder des couleurs, tailles, z-index ou espacements arbitraires dans chaque feature.

**Preuve attendue.** Les tokens et primitives gouvernées sont utilisés.

### UXR-0958 — MUST NOT · P1 · AUTO

**Règle.** Ne pas créer de composant générique avec de nombreux flags booléens pour couvrir des concepts métier différents.

**Preuve attendue.** La composition ou des variantes sémantiques remplacent les modes incohérents.

### UXR-0959 — MUST NOT · P1 · AUTO

**Règle.** Ne pas charger toutes les sources backend pour toutes les pages par commodité.

**Preuve attendue.** Chaque vue déclare ses dépendances, budgets et erreurs partielles.

### UXR-0960 — MUST NOT · P0 · SEMI

**Règle.** Ne pas déclarer une page terminée sur la seule base d'une capture desktop happy path.

**Preuve attendue.** États, clavier, responsive, données réelles, permissions, actions et erreurs sont vérifiés.

---

# Chapitre 49 — Definition of Done, release, feature flags et amélioration continue

**Objectif :** Transformer les standards en critères de livraison vérifiables, réversibles et maintenus dans le temps.

**Sources fondatrices :** S01, S19, S24, S25, S26, S30, S31

**Plage :** `UXR-0961` à `UXR-0980`

### UXR-0961 — MUST · P0 · SEMI

**Règle.** Une page n'est Done que si son Page Operating Contract et sa Screen Specification sont validés.

**Preuve attendue.** La PR lie les documents et les critères d'acceptation.

### UXR-0962 — MUST · P0 · AUTO

**Règle.** Toutes les données visibles doivent provenir d'une API documentée ou être marquées indisponibles, démo ou inconnues.

**Preuve attendue.** Le test et le mapping identifient source, état et asOf.

### UXR-0963 — MUST · P0 · SEMI

**Règle.** Chaque action doit avoir permission, capability, confirmation appropriée, idempotence, progression, terminal et audit lorsqu'ils s'appliquent.

**Preuve attendue.** Le parcours est testé jusqu'au résultat métier.

### UXR-0964 — MUST · P1 · AUTO

**Règle.** Les filtres, tri, période, onglet et pagination partageables doivent survivre au refresh et au retour.

**Preuve attendue.** Les tests couvrent URL et restauration du contexte.

### UXR-0965 — MUST · P1 · AUTO

**Règle.** Les niveaux L0, L1, L2 et L3 nécessaires doivent être navigables avec breadcrumbs et retour contextuel.

**Preuve attendue.** Les routes et relations d'entités sont testées.

### UXR-0966 — MUST · P0 · AUTO

**Règle.** Les états loading, empty, partial, stale, disconnected, forbidden, conflict, error et ready applicables doivent être implémentés et testés.

**Preuve attendue.** Le catalogue de stories ou fixtures couvre la matrice.

### UXR-0967 — MUST · P1 · AUTO

**Règle.** Les viewports contractuels doivent être testés sans overflow ni action masquée.

**Preuve attendue.** Les golden screens incluent workstation, Full HD, laptop et mobile priorisé.

### UXR-0968 — MUST · P0 · SEMI

**Règle.** La navigation clavier, le focus, les noms accessibles et les contrastes doivent passer les contrôles automatiques et manuels pertinents.

**Preuve attendue.** Axe, ARIA snapshot et revue clavier sont joints.

### UXR-0969 — MUST · P1 · AUTO

**Règle.** Les mappers, composants, intégrations BFF et parcours E2E doivent avoir des tests au niveau approprié.

**Preuve attendue.** La stratégie de test évite les doublons inutiles tout en couvrant le risque.

### UXR-0970 — MUST · P1 · AUTO

**Règle.** Les budgets de performance et de requêtes doivent être mesurés sur l'environnement de référence.

**Preuve attendue.** La release ne contient pas de source inutile ou de régression non acceptée.

### UXR-0971 — MUST · P0 · SEMI

**Règle.** Toute nouvelle capacité doit être placée derrière un feature flag lorsqu'un cutover progressif ou un rollback est nécessaire.

**Preuve attendue.** Le flag possède propriétaire, population, métriques et date de retrait.

### UXR-0972 — MUST · P1 · AUTO

**Règle.** Un feature flag ne doit pas devenir une branche permanente non testée.

**Preuve attendue.** Les deux variantes sont couvertes jusqu'à retrait du flag.

### UXR-0973 — MUST · P0 · MANUAL

**Règle.** La release d'un parcours sensible doit avoir un runbook de rollback testé.

**Preuve attendue.** Le retour arrière conserve intégrité des données et visibilité opérateur.

### UXR-0974 — MUST · P1 · SEMI

**Règle.** Les migrations de design system doivent être incrémentales et instrumentées.

**Preuve attendue.** Les anciennes variantes sont dépréciées avec calendrier et migration.

### UXR-0975 — MUST · P1 · SEMI

**Règle.** Les baselines visuelles ne doivent être mises à jour qu'après revue du changement attendu.

**Preuve attendue.** La PR explique chaque différence et référence la décision.

### UXR-0976 — MUST · P1 · AUTO

**Règle.** Les dérogations ouvertes doivent être contrôlées avant release.

**Preuve attendue.** Aucune dérogation expirée ou sans propriétaire ne subsiste.

### UXR-0977 — MUST · P1 · SEMI

**Règle.** Les logs, métriques et erreurs frontend nécessaires au support doivent être disponibles sans exposer de données sensibles.

**Preuve attendue.** Le runbook indique où vérifier et comment corréler.

### UXR-0978 — MUST · P1 · SEMI

**Règle.** La mise en production doit vérifier les métriques de tâche, erreurs, performance et accessibilité définies.

**Preuve attendue.** Le suivi post-release distingue succès apparent et résultat utilisateur.

### UXR-0979 — MUST · P1 · MANUAL

**Règle.** Les incidents UX importants doivent alimenter le référentiel, les composants ou les tests de non-régression.

**Preuve attendue.** La correction durable dépasse le patch local lorsqu'un pattern est en cause.

### UXR-0980 — MUST · P0 · SEMI

**Règle.** Une preuve de release doit relier Operating Contract, API ou commande, composant, route, tests, flag et version déployée.

**Preuve attendue.** La chaîne de traçabilité est consultable après la mise en production.

---

# Chapitre 50 — Protocole d’exécution Codex et auto-audit obligatoire

**Objectif :** Donner aux agents LLM un processus déterministe pour concevoir, implémenter, vérifier et expliquer une modification UI/UX sans improvisation.

**Sources fondatrices :** S01, S21, S23, S24, S25, S30, S31

**Plage :** `UXR-0981` à `UXR-1000`

### UXR-0981 — MUST · P0 · SEMI

**Règle.** Avant tout code, l'agent doit lire AGENTS.md, ce référentiel, le Page Operating Contract, la Screen Specification et les sources de vérité du projet.

**Preuve attendue.** Le plan de travail liste les documents lus et leur ordre d'autorité.

### UXR-0982 — MUST · P0 · SEMI

**Règle.** L'agent doit inspecter le repository, les routes, composants, styles, contrats API, données et tests avant de proposer une architecture.

**Preuve attendue.** Le rapport cite les fichiers réellement observés.

### UXR-0983 — MUST · P0 · MANUAL

**Règle.** L'agent doit définir objectif, utilisateurs, questions, informations, actions, états, permissions et responsive avant de modifier un écran non spécifié.

**Preuve attendue.** Une fiche minimale est produite ou l'absence bloque le développement.

### UXR-0984 — MUST · P0 · SEMI

**Règle.** L'agent doit sélectionner les règles UXR applicables et les classer en bloquantes, importantes et contextuelles.

**Preuve attendue.** La tâche contient une matrice règle vers décision et preuve prévue.

### UXR-0985 — MUST · P0 · MANUAL

**Règle.** L'agent ne doit pas inventer une donnée, une capability, une permission ou un résultat de commande absent du code ou du contrat.

**Preuve attendue.** L'inconnu est déclaré et un besoin backend est ouvert si nécessaire.

### UXR-0986 — MUST · P1 · MANUAL

**Règle.** L'agent doit proposer le plus petit vertical slice qui prouve le parcours de bout en bout.

**Preuve attendue.** Le plan évite une refonte massive ou un design system abstrait sans usage réel.

### UXR-0987 — MUST · P1 · SEMI

**Règle.** L'agent doit réutiliser une primitive existante seulement si son contrat correspond au besoin.

**Preuve attendue.** Toute extension indique compatibilité, usages et risque de régression.

### UXR-0988 — MUST · P1 · AUTO

**Règle.** L'agent doit séparer API DTO, validation, mapper, view model, query, composant de feature et primitive UI.

**Preuve attendue.** La structure de fichiers et les imports respectent les frontières.

### UXR-0989 — MUST · P0 · SEMI

**Règle.** L'agent doit implémenter les états de vérité et d'erreur avant de polir le happy path.

**Preuve attendue.** Les fixtures et tests couvrent partial, stale, forbidden et erreur dès la première tranche.

### UXR-0990 — MUST · P1 · AUTO

**Règle.** L'agent doit exécuter le linter UI/UX, les tests, l'accessibilité et les contrôles visuels applicables avant de conclure.

**Preuve attendue.** Le rapport donne commandes, résultats et limites.

### UXR-0991 — MUST · P1 · SEMI

**Règle.** L'agent doit inspecter le rendu réel aux viewports contractuels et ne pas se fier uniquement au DOM ou aux tests unitaires.

**Preuve attendue.** Des captures ou une preuve de preview sont jointes.

### UXR-0992 — MUST · P0 · SEMI

**Règle.** L'agent doit tester au moins une permission refusée, une donnée inconnue et une action non supportée sur tout parcours critique.

**Preuve attendue.** L'UI reste honnête et sûre dans ces scénarios.

### UXR-0993 — MUST · P1 · MANUAL

**Règle.** L'agent doit comparer le résultat au Page Operating Contract et au test des cinq secondes.

**Preuve attendue.** Le rapport répond explicitement aux questions principales de la page.

### UXR-0994 — MUST · P1 · MANUAL

**Règle.** L'agent doit documenter les décisions, alternatives écartées et compromis mesurés.

**Preuve attendue.** Les préférences esthétiques sans justification sont exclues.

### UXR-0995 — MUST · P0 · MANUAL

**Règle.** L'agent doit signaler tout contrôle non exécuté ou toute preuve inaccessible.

**Preuve attendue.** La sortie distingue vérifié, non vérifié et supposé avec raisons.

### UXR-0996 — MUST · P1 · AUTO

**Règle.** L'agent doit produire une liste précise des fichiers créés, modifiés et supprimés.

**Preuve attendue.** Le résumé permet une revue rapide et un rollback.

### UXR-0997 — MUST · P1 · AUTO

**Règle.** L'agent doit créer ou mettre à jour les tests de non-régression pour chaque bug ou invariant touché.

**Preuve attendue.** Les tests échouent avant la correction lorsque reproductible.

### UXR-0998 — MUST · P1 · SEMI

**Règle.** L'agent doit éviter les changements voisins non nécessaires et ouvrir un ticket séparé pour la dette large.

**Preuve attendue.** Le diff reste cohérent avec la mission et la Boy Scout Rule contrôlée.

### UXR-0999 — MUST · P0 · SEMI

**Règle.** L'agent ne doit déclarer Done qu'après auto-audit par règles UXR et Definition of Done du chapitre 49.

**Preuve attendue.** Toute violation résiduelle possède dérogation ou bloque la conclusion.

### UXR-1000 — MUST · P0 · SEMI

**Règle.** La sortie finale de l'agent doit contenir résultat, preuves, règles appliquées, tests, limites, risques, dérogations et prochaine étape de validation.

**Preuve attendue.** Le rapport est reproductible par un reviewer humain.

---

# Annexes opérationnelles

## A. Format de dérogation

```markdown
## UX-EXC-XXXX — Titre

- Règle(s) UXR :
- Fichiers / écrans :
- Justification utilisateur ou technique :
- Risque :
- Mesure compensatoire :
- Preuve :
- Propriétaire :
- Approbateurs :
- Date d’expiration :
- Ticket de suppression :
```

## B. Format minimal d’une auto-évaluation

```markdown
### Règles applicables
- UXR-XXXX — respectée — preuve
- UXR-YYYY — partiellement vérifiée — limite
- UXR-ZZZZ — dérogation UX-EXC-XXXX

### Contrôles exécutés
- lint UI/UX :
- tests composants :
- accessibilité :
- E2E :
- visuel / viewports :
- performance :

### Non vérifié
- contrôle : raison et risque
```

## C. Entretien du référentiel

- Ne jamais réutiliser un identifiant retiré.
- Déprécier avant suppression lorsqu’un remplacement existe.
- Revoir les sources au minimum à chaque version majeure de WCAG, APG, standards de tokens ou contrats produit.
- Transformer les incidents répétés en règle, test ou primitive partagée.
- Mesurer le volume de dérogations pour détecter les règles inadaptées ou les composants manquants.

La bibliographie détaillée figure dans `SOURCES.md`. Le fichier `ui-ux-rules.json` est la représentation machine-readable de cette version.
