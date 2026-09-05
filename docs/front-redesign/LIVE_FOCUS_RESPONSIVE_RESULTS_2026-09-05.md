# Live Focus — responsive, cohérence des R et 25 améliorations

Date : 5 septembre 2026. Périmètre : correction locale du Focus et de sa projection de reporting ; aucune modification des stratégies, des gates, du sizing ou de l’exécution.

## 1. État et référence

- Référence initiale propre : `main`, `bb69a33337800476f8639a813805e2c2539c48dd`.
- Branche de correction : `codex/live-focus-responsive-results`.
- VPS vérifié par `/healthz` : `live-focus-dashboard-20260905.1`, réponse `ok: true`.
- Cette passe ne déploie pas sur le VPS, ne modifie pas PostgreSQL et ne confirme aucun ordre. Le build local et le backend de reporting doivent être livrés ensemble pour activer les nouveaux chiffres.
- Données examinées : vraies réponses `/front-api/v1/views/live-focus` et `/front-api/v1/views/live-trading`, dont le relevé du 05/09/2026 à 00:23 UTC. Aucun résultat fictif ajouté au runtime.

## 2. Diagnostic du responsive

**Constat → problème → conséquence.** Le Focus desktop imposait `height: 100dvh`, cinq lignes de grille dont une seule pouvait se réduire, et `overflow: hidden`. Le nouveau dashboard occupait environ 332 px à 1366 × 768. Les panneaux restants n’avaient plus qu’environ 202 px, consommés presque entièrement par leurs en-têtes. Le scroll interne existait mais ne compensait pas l’absence de défilement général.

**Correction → bénéfice.** Le document retrouve une hauteur naturelle et son défilement. Le corps opérateur conserve au moins 560 px, indépendamment de l’ouverture des détails. Les trois panneaux restent parallèles sur desktop et s’empilent sur petit écran. Le dashboard affiche cinq indicateurs essentiels, les explications et les contributions détaillées étant repliées par défaut.

Résultat observé avec dashboard rempli à 1366 × 768 : environ 175 px pour le dashboard ; trois panneaux de 540 px utiles dans un corps de 560 px. Le bas est accessible par scroll normal, sans dézoom. Aucun débordement horizontal détecté sur les dix résolutions testées.

## 3. Pourquoi −0,83 R devenait −2,67 R

Le problème n’était pas une erreur d’addition, mais un mélange de périmètres et une décomposition incomplète.

| Population réellement présente dans la réponse Focus | Clôtures | R publié cumulé | Compteur ancien |
| --- | ---: | ---: | --- |
| ZC/ZW, objectifs touchés | 2 | +3,17142857 | 2 TP |
| ZC/ZW, stops touchés | 4 | −4,00000000 | 4 stops |
| Anciennes positions MNQ, état `CLOSED` | 18 | −6,41590039 | Omises du compteur TP/stop |
| Anciennes positions MES, état `CLOSED` | 11 | +4,57638182 | Omises du compteur TP/stop |
| Total mélangé | 35 | **−2,66809000** | Toujours 2 TP / 4 stops |

Les six clôtures grains donnent **−0,82857143 R**. Les 29 anciennes clôtures indices ajoutent **−1,83951857 R**. D’où les deux valeurs vues à l’écran, sans que le compteur TP/stop change.

Autre anomalie : les boutons « Semaine » et « Mois » appliquaient des fenêtres glissantes de 7 et 30 jours, sur la date de création des dossiers. Le 5 septembre, « Mois » incluait donc encore août. Ce n’était pas un mois calendaire.

Ce relevé décrit les dossiers exposés dans la réponse, pas une certification de toute la performance historique du desk ni un rendement broker.

## 4. Règles désormais explicites

1. **Périmètre grains.** La projection utilise les instruments du catalogue backend `US_GRAINS_INSTRUMENTS` : ZW/ZC. Les indices historiques restent disponibles dans leurs dossiers ; ils ne polluent plus les chiffres du Focus grains. Le nombre et les instruments exclus sont publiés et expliqués dans le détail.
2. **Calendrier Paris.** Aujourd’hui = date civile de Paris ; semaine = lundi à aujourd’hui ; mois = premier jour du mois à aujourd’hui. Les bornes apparaissent à l’écran. Ce n’est pas la date de séance CBOT ni une période glissante.
3. **Résultats par clôture.** Les R suivent `closedAt`, issu de `theoreticalExecution.exitAt`. Les tickets et signaux suivent leur date de création. Aucune substitution silencieuse de la date de création à une date de clôture absente.
4. **Décomposition exhaustive des R exposés.** Objectif touché, stop touché, autre clôture/motif non publié. Une clôture positive n’est pas automatiquement un TP ; une clôture à −1 R n’est pas automatiquement un stop.
5. **Absence différente de zéro.** Aucune clôture : texte explicite. Résultat manquant : non publié. Somme réellement nulle : `0,00 R`. Une clôture non datée est exclue des périodes calendaires et signalée ; elle reste consultable dans le total exposé.
6. **Présent différent d’historique.** « Prêts maintenant » et « Positions ouvertes » restent des compteurs actuels. Le choix de mois ne transforme jamais un ancien ordre en ordre actionnable.
7. **Autorité backend.** La synthèse est produite côté BFF ; React valide puis formate, sans recalculer officiellement les R, les gates ou le risque. Confirmation humaine et fill restent distincts.

### Limite volontairement visible

Le Focus charge actuellement une cohorte limitée à **48 dossiers**, avec des bornes également présentes dans la lecture du dépôt d’exécution. Le mot **« historique partiel »** reste donc visible. Le bouton Total signifie total de l’historique exposé, pas total exhaustif de la base.

Ce correctif ne prétend pas remplacer cette cohorte par un grand livre paginé. La proposition 1 ci-dessous est nécessaire pour certifier un mois ou un total exhaustif. Les clôtures anciennes sans motif détaillé ne sont pas reclassées arbitrairement.

## 5. Architecture et fichiers

| Fichier | Responsabilité |
| --- | --- |
| `mcp_gpt_desk/src/front-live-focus-dashboard.js` | Projection de reporting : périmètre grains, fenêtres calendaires, agrégats, exclusions et contributeurs. |
| `mcp_gpt_desk/src/front-live-focus-projection.js` | Publication du dashboard et des dates/statuts théoriques canoniques. |
| `apps/desk-control-plane/src/domains/front-api/focusDashboardContract.ts` | DTO typé et validation à la frontière, notamment des nombres et des liens internes. |
| `apps/desk-control-plane/src/domains/front-api/viewModels.ts` | Contrat Focus enrichi de façon additive. |
| `apps/desk-control-plane/src/features/live-trading/focusDashboardModel.ts` | Présentation française uniquement, états vides et explication du périmètre. |
| `apps/desk-control-plane/src/features/live-trading/FocusDashboard.tsx` | Composant extrait, cinq indicateurs, filtres et détail repliable. |
| `apps/desk-control-plane/src/features/live-trading/focus-dashboard.css` | Styles isolés du dashboard et reflow. |
| `apps/desk-control-plane/src/features/live-trading/LiveFocusMode.tsx` et `live-focus.css` | Intégration et correction du budget vertical. |
| Tests dashboard/projection/backend, `focusDashboardModel.test.ts` | Régressions des résultats, dates, null/zéro, périmètres et états théoriques. |
| `apps/desk-control-plane/scripts/audit-live-focus-layout.mjs` | Contrôles navigateur des dimensions, défilements, filtres, détail et accessibilité. |

Alternative écartée : réduire la police, masquer davantage de contenu ou imposer un zoom navigateur. Autre alternative écartée : conserver des sommes métier dans React ou forcer les données manquantes à zéro.

Réduction de dette : suppression des calculs historiques locaux et extraction de la présentation hors du gros composant Focus ; `focusDashboardModel.ts` ramené à 72 lignes, environ 190 lignes de CSS retirées du fichier Focus avant ajout d’une feuille isolée de 82 lignes. Aucun nouveau fichier de production au-delà de 600 lignes, aucune nouvelle dépendance, aucune migration SQL, aucun ADR dérogatoire.

Compatibilité : champs BFF additifs ; un ancien front les ignore. Le nouveau front face à un ancien backend affiche uniquement le dashboard non publié, sans inventer de KPI et sans bloquer les dossiers. Un rollback doit restaurer le couple front/backend de la release précédente.

## 6. Vérifications et preuves

| Vérification | Résultat |
| --- | --- |
| Suite frontend complète : `node.exe ./node_modules/vitest/vitest.mjs run --reporter=json --outputFile=../../output/playwright/focus-dashboard-frontend-tests.json` depuis le package front | **304/304**, 62 fichiers de tests. |
| Backend : `node.exe --test test/front_live_focus_dashboard.test.js test/front_live_focus_projection.test.js test/front_live_theoretical_execution_projection.test.js` depuis `mcp_gpt_desk` | **22/22**. |
| TypeScript : `node.exe ./node_modules/typescript/bin/tsc -b` depuis le package front | Passe. |
| ESLint sur les quatre nouveaux fichiers/modèles front | Passe, zéro avertissement. |
| Build : `node.exe ./node_modules/vite/bin/vite.js build` | Passe ; entrée `index-BGZi4FYm.js`. |
| Contrôles navigateur Focus | Dix résolutions, filtres, dernier ticket, clavier, scroll général, scroll des trois panneaux et détails : passent. |
| Axe sur le Focus | **0 violation** après correction du balisage de liste descriptive ; avant correction, une violation `definition-list` serious sur le dashboard. |
| Scanner UI/UX strict | 200 fichiers, **0 erreur**, 892 avertissements existants. Aucun seuil P0 abaissé. |
| Guards isolation legacy et mode runtime VNext | Passent. |
| Guards architecture front, frontières de modules et compatibilité API | Passent ; 446 fichiers contrôlés pour les frontières de modules. |

Résolutions : 1280×720, 1280×600, 1366×768, 1440×900, 1920×1080, 2560×1440, 1024×768, 960×540, 390×844 et 320×640. La taille 960×540 contrôle le reflow équivalent d’un Full HD à 200 %, sans prétendre simuler tous les comportements du zoom natif.

### Nature exacte du test navigateur rempli

Deux passages sont distingués :

- Front local → BFF VPS non modifié : valide la compatibilité avec l’ancien backend et le défilement.
- Front local → données réelles BFF, enrichies **dans le harnais de test uniquement** par la nouvelle projection backend : valide le dashboard rempli et ses interactions. Mode de preuve `LOCAL_NEW_PROJECTION_WITH_REAL_READONLY_BFF_DATA`. Le harnais refuse de s’activer sur une URL non locale. Aucun mock importé dans le runtime de l’application, aucun ordre/fill fabriqué.

Le second passage rejoint les dates disponibles dans `live-trading` par ID canonique. Cette vue ne renvoie pas toute la cohorte historique Focus : trois anciennes clôtures grains n’y ont pas leur date. Elles restent explicitement non datées dans ce test. Ainsi **−0,40 R pour semaine/mois dans ce harnais n’est pas une mesure de production exhaustive**. Le total grains exposé est −0,83 R, les 29 dossiers indices sont exclus. La validation du backend déployé devra relire la cohorte Focus complète et ses dates avant d’annoncer les nouveaux totaux calendaires servis.

Preuves locales :

- `output/playwright/focus-dashboard-before.png` : écran avant correction.
- `output/playwright/live-focus-layout/live-focus-layout-audit.json` : passage sur le BFF non modifié.
- `output/playwright/focus-dashboard-populated/live-focus-layout-audit.json` : passage rempli, valeurs visibles comparées à la projection, source et exclusions, zéro erreur réseau/JS.
- `output/playwright/focus-dashboard-populated/live-focus-1366x768.png` et captures des neuf autres tailles.
- `output/playwright/focus-dashboard-populated/live-focus-dashboard-expanded.png` : détail et bas de page accessibles.
- `output/playwright/focus-dashboard-frontend-tests.json`, `output/playwright/focus-dashboard-uiux.json`.

Le skill responsive a guidé la suppression de la hauteur bloquante et le maintien du défilement. Le protocole accessibility-fix a guidé le cycle avant/après du balisage ; AccessLint n’étant pas disponible, le contrôle a utilisé Axe déjà installé dans le projet. Ni Axe ni le scanner heuristique ne constituent une certification complète WCAG ou des 1 000 règles. Pas de test humain avec lecteur d’écran ni de nouvel E2E d’exécution broker dans cette passe.

Règles retenues : UXR-0141, 0142, 0149, 0159 (reflow, zoom, scroll, matrice viewport), 0461, 0462, 0463, 0467, 0475, 0480 (KPI, périodes, sources, exclusions et preuves), 0769 (absence de PnL officiel calculé dans le front). Documents produit et ADR 0029/0030 restent prioritaires.

## 7. Les 25 améliorations proposées

Ce sont des propositions pour la suite, pas 25 fonctionnalités déclarées implémentées. Priorité à la compréhension et à la fiabilité avant l’ajout de widgets.

| # | Priorité | Amélioration concrète | Utilité quotidienne / preuve attendue |
| ---: | --- | --- | --- |
| 1 | P1 | **Grand livre complet côté backend**, filtré avant pagination et agrégation. | Fin de la limite des 48 dossiers pour les chiffres ; total comparé directement au registre canonique. |
| 2 | P1 | **Clic sur un chiffre → journal correspondant**, avec filtre visible et retour simple. | Passer de « quatre stops » aux quatre dossiers, sans rechercher à la main. |
| 3 | P1 | **Filtre ZC / ZW / tous les grains** partagé par statistiques et journal, distinct du choix de graphique. | Comparer les instruments sans cacher involontairement une alerte d’un autre instrument. |
| 4 | P1 | **Période personnalisée** et raccourci dernière séance clôturée. | Consulter vendredi le samedi sans confondre aujourd’hui civil et séance marché. |
| 5 | P1 | **Ventilation par instrument des clôtures** et des R, à la demande. | Identifier immédiatement la contribution ZC contre ZW ; ne plus mélanger les anciens indices. |
| 6 | P1 | **Motif de sortie canonique conservé** pour toutes les clôtures. | Distinguer TP, stop, fin de session, sortie manuelle théorique ou motif absent ; ne pas déduire du signe du R. |
| 7 | P1 | **Théorique / exécution déclarée opérateur** côte à côte dans le détail du résultat. | Savoir ce que le desk aurait fait et ce que l’opérateur a réellement déclaré, sans confondre les deux. |
| 8 | P1 | **Aucune action : vrai état d’attente au centre**, historique ouvert seulement après sélection. | Éviter qu’un vieux dossier occupe par défaut la zone visuelle réservée à la décision courante. |
| 9 | P1 | **Actions historiques nommées « Consulter »**, et non « Valider / refuser ». | Les liens des tickets expirés ne doivent pas promettre une décision encore possible. |
| 10 | P1 | **Progression d’exécution explicite** : attente limite → entrée exécutée → ouverte → clôturée. | Suivre une position sans assimiler confirmation humaine à fill. Toutes les transitions viennent du backend. |
| 11 | P1 | **Signal, création du ticket, fill et clôture : quatre heures distinctes**. | Comprendre les retards de pipeline et le rattachement des résultats à une période. |
| 12 | P1 | **Blocage principal unique et lien de diagnostic** pour chaque dossier. | Identifier la gate responsable sans lire une succession de codes ni confondre une politique inactive avec une panne. |
| 13 | P1 | **Fraîcheur par bloc**, séparant marché, contexte, résultats et suivi théorique. | Une analyse périmée ne doit pas donner l’impression que les résultats historiques sont eux aussi obsolètes. |
| 14 | P1 | **Calendrier grains : prochaine annonce avec date, heure locale et statut passé/à venir**. | Éviter un « prochain catalyseur 18:00 » sans date qui paraît encore futur après son passage. |
| 15 | P1 | **Brief expiré replié**, avec accès explicite à l’analyse historique. | Garder son audit sans lui donner plus de place qu’à la situation actuelle. |
| 16 | P1 | **Traduction française complète des états visibles**, avec codes techniques seulement dans l’inspecteur. | Supprimer notamment « No human action required » du bandeau et homogénéiser les libellés. |
| 17 | P1 | **Vrais noms de stratégies résolus par ID**, absence signalée proprement. | Ne plus afficher « Strategy » comme nom d’une stratégie dans les tickets et l’état opérateur. |
| 18 | P2 | **Ancres Brief / Décision / Journal**, accessibles au clavier et sur petits écrans. | Atteindre une section longue sans dézoomer ni parcourir tout le document. |
| 19 | P2 | **Agrandissement local d’un panneau**, avec retour à la disposition et au scroll précédents. | Lire un dossier ou le journal sur laptop sans changer le zoom du navigateur. |
| 20 | P2 | **Densité confortable / compacte**, fondée sur des tokens et des hauteurs minimales testées. | Adapter l’affichage à l’opérateur sans réintroduire les textes illisibles ni les panneaux comprimés. |
| 21 | P2 | **Conserver le scroll et le ticket sélectionné pendant les mises à jour**. | Une nouvelle réponse ne doit pas interrompre la lecture ou ramener en haut du journal. |
| 22 | P2 | **Indicateur discret de nouveaux événements non lus**. | Signaler l’arrivée d’un événement sans pop-up central ni réordonnancement imposé pendant la lecture. |
| 23 | P2 | **Filtres actifs résumés et bouton de réinitialisation commun**. | Comprendre pourquoi une liste est vide et retrouver rapidement tous les dossiers. |
| 24 | P2 | **Export de la sélection et des contributions R**, avec fuseau, périmètre et exclusions. | Pouvoir vérifier les chiffres hors du desk sans reconstruire la sélection manuellement. |
| 25 | P2 | **Comparaison à la période précédente de même durée**, seulement sur des données complètes comparables. | Évaluer l’évolution sans comparer une semaine complète à un mois partiel ou mélanger les univers. |

## 8. Suite recommandée

Livrer d’abord ce correctif front + projection BFF, puis refaire le contrôle navigateur sans interception sur le VPS et comparer les nouvelles valeurs au payload servi. Traiter ensuite le grand livre complet et les liens chiffres → dossiers (propositions 1 et 2), avant d’ajouter des graphiques ou davantage de cartes. Les écritures de trading, les signaux et leurs règles restent hors de ce chantier UI/reporting.
