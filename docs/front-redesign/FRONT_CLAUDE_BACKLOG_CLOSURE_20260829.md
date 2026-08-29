# Fermeture du backlog Claude — Live Trading et navigation

Date : 2026-08-29  
Branche : `codex/front-complete-claude-backlog-20260829`  
Sources : `FRONT_50_AMELIORATIONS.md`, `AUDIT_UI_NAVIGATION.md`, `RECETTE_2.md`.

## Règles d'autorité

- Les états actionnables viennent exclusivement des `allowedActions`, permissions, révisions et échéances publiées par le backend.
- Le front ne calcule ni décision Risk, ni quantité autorisée, ni état broker.
- Un champ non publié reste `Non publié`; il n'est jamais transformé en zéro.
- `J’ai passé l’ordre` est une déclaration semi-manuelle, pas un ACK ni un FILL.

## Matrice des 50 évolutions

| ID | Statut | Preuve d'implémentation |
|---|---|---|
| FRONT-01 | IMPLÉMENTÉ | Registre unique `ACTIONABLE / EVALUATING / WATCHED / EXPIRED / REJECTED` dans `signalOperatorState.ts`. |
| FRONT-02 | IMPLÉMENTÉ | Vert action exclusive `--lt-flight-green`; l'infrastructure conserve ses propres tons. |
| FRONT-03 | IMPLÉMENTÉ | Ligne actionnable = badge, liseré épais et marqueur de statut. |
| FRONT-04 | IMPLÉMENTÉ | Pulsation limitée au badge actionnable, désactivée avec `prefers-reduced-motion`. |
| FRONT-05 | IMPLÉMENTÉ | Un état opérateur principal dans la flight bar; les autres zones décrivent leur étage propre. |
| FRONT-06 | IMPLÉMENTÉ | Titre de page ramené à 14 px; état et compte à rebours deviennent dominants. |
| FRONT-07 | IMPLÉMENTÉ | Flight bar pleine largeur, backend-driven. |
| FRONT-08 | IMPLÉMENTÉ | Marché et dock secondaire atténués lorsqu'une action attend; chart et décision restent intacts. |
| FRONT-09 | IMPLÉMENTÉ | Premier viewport limité aux quatre surfaces cockpit; la profondeur passe par le dock et le plein écran. |
| FRONT-10 | IMPLÉMENTÉ | Action sensible concentrée dans le Human Gate. |
| FRONT-11 | IMPLÉMENTÉ | Valeurs décisionnelles promues; libellés plafonnés dans la couche Live. |
| FRONT-12 | IMPLÉMENTÉ | Compte à rebours Human Gate 28 px. |
| FRONT-13 | IMPLÉMENTÉ | Paliers confortable, attention, urgent et expiré. |
| FRONT-14 | IMPLÉMENTÉ | Progression proportionnelle à la fenêtre backend publiée. |
| FRONT-15 | IMPLÉMENTÉ — FLUX CRITIQUE | Temps relatif dans l'inbox; heures exactes conservées en tooltip et inspecteur. |
| FRONT-16 | IMPLÉMENTÉ | Expiration change état, ton, tri et disponibilité des actions. |
| FRONT-17 | IMPLÉMENTÉ | Fenêtre moyenne calculée uniquement depuis les timestamps publiés de la stratégie. |
| FRONT-18 | IMPLÉMENTÉ | Compteur Human Gate dans `document.title`. |
| FRONT-19 | IMPLÉMENTÉ | Favicon dynamique généré avec compteur. |
| FRONT-20 | IMPLÉMENTÉ | Compteurs Décisions et Incidents critiques dans le rail et sur mobile. |
| FRONT-21 | IMPLÉMENTÉ | Badge Human Gate dans l'en-tête Live. |
| FRONT-22 | IMPLÉMENTÉ — OPT-IN | Sons locaux différenciés info/warning/danger, désactivés par défaut. |
| FRONT-23 | IMPLÉMENTÉ — OPT-IN | Permission bureau demandée par geste; instrument, sens et échéance publiés dans le message. |
| FRONT-24 | IMPLÉMENTÉ | Résumé au retour : nouveaux, expirés, actionnables. |
| FRONT-25 | IMPLÉMENTÉ | État SSE/resync et âge de projection visibles. |
| FRONT-26 | IMPLÉMENTÉ | Prédicats traduits via `presentStrategyPredicate`; code brut reste secondaire. |
| FRONT-27 | IMPLÉMENTÉ | Plan signal/post-Risk tracé par l'overlay chart existant, sans réinterprétation locale. |
| FRONT-28 | IMPLÉMENTÉ | Distance au range d'entrée depuis dernier close et niveaux publiés. |
| FRONT-29 | IMPLÉMENTÉ | RR publié mis en évidence; `Non publié` sinon. |
| FRONT-30 | IMPLÉMENTÉ | Historique de setup limité aux signaux/résultats présents dans la projection Live. |
| FRONT-31 | IMPLÉMENTÉ — CAPABILITY-DRIVEN | Décomposition affichée seulement si `signalQuality` la publie. |
| FRONT-32 | IMPLÉMENTÉ | Contexte adjacent dans la chaîne Signal → Contexte → Portfolio/Risk. |
| FRONT-33 | IMPLÉMENTÉ | Conflit affiché depuis position/arbitrage publié. |
| FRONT-34 | IMPLÉMENTÉ | Aperçu riche au survol/focus; désactivé en mobile étroit. |
| FRONT-35 | IMPLÉMENTÉ | L'étage publié le plus avancé s'ouvre par défaut; Human Gate prioritaire. |
| FRONT-36 | IMPLÉMENTÉ | Libellé semi-manuel `J’ai passé l’ordre`; confirmation ≠ fill. |
| FRONT-37 | IMPLÉMENTÉ | Cinq motifs de refus et champ libre. |
| FRONT-38 | IMPLÉMENTÉ | Slider accessible dans la confirmation renforcée. |
| FRONT-39 | IMPLÉMENTÉ | `G` et `R` ouvrent la confirmation, sans jamais soumettre directement. |
| FRONT-40 | IMPLÉMENTÉ | Receipt et état de commande visibles; actions verrouillées pendant l'exécution. |
| FRONT-41 | PRÊT CÔTÉ FRONT / BLOQUÉ BACKEND | Bouton Undo n'existe que si le backend publie explicitement `UNDO`; aucun fallback local. |
| FRONT-42 | IMPLÉMENTÉ | Tri actionnable puis échéance, puis récence. |
| FRONT-43 | IMPLÉMENTÉ | Segments À traiter / Historique / Tous. |
| FRONT-44 | IMPLÉMENTÉ | Pagination de l'inbox et de la file Décisions existante. |
| FRONT-45 | IMPLÉMENTÉ — DONNÉES PUBLIÉES | Résumé session : signaux, suivis, décisions, expirés, ouverts, R théorique clos. |
| FRONT-46 | IMPLÉMENTÉ | Densité Auto / Confort / Compact. |
| FRONT-47 | IMPLÉMENTÉ | Formulation canonique `Non publié` pour une valeur absente. |
| FRONT-48 | IMPLÉMENTÉ | Audit Axe échoue si `unavailable` ou `undefined` apparaît dans le rendu opérateur. |
| FRONT-49 | IMPLÉMENTÉ | Registre `En cours de calcul / Non applicable / Non publié`. |
| FRONT-50 | IMPLÉMENTÉ | Build visible dans le rail; PWA versionnée. |

## Dette de recette et navigation

| Dette | Statut | Résolution |
|---|---|---|
| REG-002 service worker périmé | FERMÉ | Cache par build, suppression des caches anciens, `skipWaiting`, `clients.claim`, mise à jour visible. |
| REG-003 chaînes techniques | FERMÉ + GARDE | Présentateurs et contrôle multi-route dans l'audit Axe. |
| DESK-001 prix d'entrée | FRONT FERMÉ / PUBLICATION BACKEND REQUISE | Le front consomme zone/plan/termes autorisés; aucune entrée n'est inventée. |
| DESK-002 alignement chart | FERMÉ | Alignement initial sur le signal si aucun instrument explicite; ensuite les deux scopes restent indépendants. |
| DESK-005 tunnel vide | CAPABILITY-DRIVEN | Les cinq étages existent; un étage reste vide si aucun objet canonique lié n'est publié. |
| DESK-007 liens bidirectionnels | FERMÉ | Signal → OrderIntent et OrderIntent → signal via IDs canoniques. |
| DESK-010 prédicats | FERMÉ | Traduction opérateur et compteur fondé sur les lignes réellement rendues. |
| DESK-021 pagination | FERMÉ | Files paginées et filtrables. |
| DESK-022 notifications | FRONT FERMÉ / BACKEND PARTIEL | Alertes SSE locales opérationnelles; les règles de notification distantes restent backend-driven. |
| DESK-023 déconnexion | FERMÉ | Déconnexion dans le menu opérateur. |
| DESK-025 grains absents de la tape | FERMÉ | Priorité aux instruments du chart et des signaux publiés; aucune liste d'actifs codée en dur. |
| Navigation incohérente | FERMÉ | Registre unique, rail 200/56/0, préférence mémorisée, une seule navigation par breakpoint. |

## Dette non masquée

1. `UNDO` nécessite un contrat backend, une permission, une révision et une commande canonique.
2. Une décomposition de confiance, un prix d'entrée, un historique ou un conflit ne sont visibles que s'ils sont publiés.
3. Les règles de notification backend restent distinctes des préférences locales du navigateur.
4. Le suivi `R capté / R manqué` exige une source backend liant décisions opérateur et résultats théoriques; le front n'en fabrique aucune.

## Validation de fermeture

Exécutée sur la branche `codex/front-complete-claude-backlog-20260829` avant merge :

- TypeScript + ESLint : vert, zéro warning ESLint.
- Tests front : 57 fichiers, 273/273 tests verts.
- Build production Vite : vert, 191 modules transformés.
- Contrats Front API/BFF : 193/193 tests verts, dont Human Gate, Risk, Portfolio, signaux Live, SSE et séparation ACK/FILL.
- Axe : 76/76 audits desktop/mobile, zéro violation `serious/critical`, zéro erreur runtime, zéro chaîne `unavailable/undefined` rendue à l'opérateur.
- QA Live Trading : 5/5 formats, sans overflow, interaction masquée, backdrop parasite, champ post-Risk éditable ni action Gate inventée.
- QA plateforme : 4/4 formats, dont Windows Full HD à 150 %, laptop et mobile ; 9 KPI Portfolio réels et aucun overflow global.
- Performance BFF : 37/37 vues sous le budget P75 de 1 000 ms.
- Rulebook : 1 000/1 000 règles valides ; sélecteur et scanner auto-testés.
- Scanner statique : zéro erreur et 714 avertissements heuristiques historiques ; ce résultat n'est pas une preuve de conformité exhaustive.
- Détecteur Impeccable final : cinq avertissements non bloquants (quatre accents latéraux intentionnels d'état opérateur, une police Inter historique), aucune erreur.

AUTO et LIVE sont restés désactivés pendant toute la recette. Aucune commande broker ni confirmation Human Gate réelle n'a été envoyée.
