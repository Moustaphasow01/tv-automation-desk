# Roadmap de requalification du Desk grains

Date : 5 septembre 2026. Epic Jira : TD2-424. Branche : `codex/grains-week-integrity`.
Baseline : `dbbf57c50c715b9eaf53dfab7d23253729e53d06` ; main observé : `3ed9f242c640e6b0885f5523ba2349c3203ca94a`.

## Objectif et limites

Rendre la chaîne données → détection → contexte → Portfolio → Risk → OrderIntent → Human Gate → suivi théorique explicable, causale et reproductible. Requalifier ensuite les stratégies ZC/ZW sur des preuves honnêtes. Une performance positive n'est pas une condition permettant de modifier rétroactivement les règles.

MNQ, MES, Bitcoin et Solana restent différés. AUTO et LIVE physiques restent OFF. Ni signal ni confirmation humaine ne constituent un fill broker. La qualification prospective exige une observation ultérieure en marché ouvert ; elle ne peut pas être déclarée acquise par un test historique.

Référence factuelle : `reports/research/GRAINS_WEEK_INTEGRITY_AND_DESK_ROADMAP_20260905.md`. L'ancien +116,4145 R est reproductible mais non certifié causal. Les six clôtures théoriques de la semaine totalisent −0,82857143 R ; ce n'est pas du PnL broker.

## Ordre des lots et critères de sortie

| Étape | Jira | Travail | Preuve requise avant clôture |
|---|---|---|---|
| 1 | TD2-425 | Suivi indépendant du Human Gate, événements terminaux, unités monétaires canoniques | Tests réels PostgreSQL : expiration humaine sans perte du suivi, idempotence, point value absent explicite, aucun ordre physique |
| 2 | TD2-426 | Fraîcheur et qualité : source, arrivée webhook, persistance, calcul, publication | Cause du retard M5 mesurée, écarts M1/M5 classés, aucune réécriture fictive de l'heure d'arrivée |
| 3 | TD2-429 | Détection causale : clôture M5, préfixes disponibles, sessions Chicago/DST | Ajouter des données futures ne change jamais un signal déjà produit |
| 4 | TD2-429 | Moteur d'exécution commun live/replay, expiration d'entrée distincte de clôture de position | Même manifeste → mêmes signaux, transitions, fills et résultats ; ambiguïtés explicitement classées |
| 5 | TD2-426 | Contexte global disponible à l'instant T et workers bornés | Calendrier connu avant publication ; actuals seulement après disponibilité ; pas de bypass silencieux ni redémarrage contre une pause opérateur |
| 6 | TD2-429 | Chaîne canonique complète et publication de tous les signaux moteurs | Traçabilité par ID de chaque admission/refus Context, Portfolio, Risk, Intent, Gate ; aucune sélection pilotée par le futur |
| 7 | TD2-427 | Replays historiques identiques et comparaison aux événements live | Avril–août puis 31 août–4 septembre, manifestes version/données/policy/coûts et attribution des écarts |
| 8 | TD2-427 | Robustesse et recherche sans ajustement au holdout | Coûts/slippage, stabilité, concentration, drawdown, échantillon, périodes distinctes ; échec publié tel quel |
| 9 | TD2-430 | Vérité produit : dashboard, tickets, contexte et Telegram | Brut ≠ qualifié ≠ ordre ≠ théorique ≠ broker ; mêmes unités/périodes ; Rulebook, responsive et tests sans régression |
| 10 | TD2-428 | Release, canary VPS, shadow prospectif et fermeture | Tests locaux complets, rollback prêt, canary vérifié, observation à marché ouvert, commentaires Jira de preuve avant Done |

## Architecture et contrôle des changements

Les correctifs de persistance restent dans les adaptateurs existants d'exécution (`mcp_gpt_desk/src/broker-*-repository.js`). Les calculs purs restent dans les packages domaine/replay existants. Les scripts orchestrent sans ajouter un deuxième Risk ni une deuxième stratégie. Les nouvelles extractions doivent réduire la dette des fichiers touchés, avec tests de parité.

L'expiration humaine bloque l'action physique ; elle ne supprime pas le mandat de suivi théorique déjà autorisé. Un ordre annulé/supplanté pour une autre raison ne doit pas être réactivé par un filtre trop large. Les résultats historiques sont conservés, les corrections sont versionnées et motivées.

## Protocole de recherche et décision de conservation

Les mois d'avril à août et la semaine du 31 août au 4 septembre ont déjà été consultés. Ils servent à la réconciliation et au diagnostic, pas à prétendre disposer d'un holdout vierge. Les nouvelles hypothèses et leurs coûts, bornes, critères d'admission et nombre d'essais doivent être figés avant l'évaluation sur une période réellement non consultée ou prospective.

Le rapport de requalification devra fournir par jour, instrument et famille : signaux bruts, décisions de chaque gate, ordres qualifiés, expirations prouvées, fills, résultats indéterminés, R bruts/nets de coûts, risque monétaire, drawdown et concentration des gains. Il distinguera une régression technique d'une faiblesse statistique ; six trades ne suffisent pas à attribuer une semaine négative à la seule variance normale.

Les tests de robustesse incluront frais/slippage plausibles, sensibilité à de petits écarts de paramètres sans optimisation au holdout, périodes chronologiques, dépendance entre variantes et stabilité par sous-période. Un résultat négatif ou insuffisamment documenté conduit à maintenir la stratégie en recherche/shadow, pas à abaisser les gates jusqu'à obtenir un score positif.

Après stabilisation des contrats, le lot produit revoit les informations utiles au quotidien : diagnostic de données et contexte, file des seuls ordres qualifiés, motif de blocage des autres signaux, suivi théorique et comparaison opérateur séparés, navigation par identifiant et historique. Ce n'est pas une nouvelle refonte globale préalable à la correction du moteur.

## Avancement

- Audit initial et jeux de données figés : disponibles au commit de baseline.
- TD2-424 : en cours. TD2-425 : correctif local testé, revue d'intégration requise. TD2-426 et TD2-429 : premières tranches locales testées, en cours ; aucune clôture globale. TD2-427/428/430 : à faire, dépendants des preuves P0.
- Aucun déploiement ni changement des données de production dans cette phase locale.
- Les résultats de commandes et preuves de chaque lot seront ajoutés ci-dessous ; une ligne planifiée n'est pas une fonctionnalité livrée.

### Preuves du premier lot local — TD2-425

Livré dans le code local :

- Les dossiers expirés par le sweeper Human Gate restent éligibles au suivi théorique ; les expirations d'autre provenance ne sont pas réactivées arbitrairement.
- L'entrée terminale est vérifiée sous verrou : fill/expiration concurrents sont mutuellement exclusifs.
- Les requêtes M1, la file des positions et son backlog sont bornés à la clôture de la bougie et à l'horloge fournie au replay.
- Une fenêtre complète non touchée produit une expiration ; une fenêtre incomplète reste indéterminée. Une expiration au milieu d'une minute n'est pas certifiée à partir d'un OHLC incomplet.
- Les unités du plan canonique sont conservées à l'entrée. Aucun fallback monétaire à 1 ; des unités absentes portent un motif explicite. Une correction du résultat conserve l'ancienne révision comme `void`, avec une seule révision finale active.
- Une ambiguïté stop/objectif est mise en attente de revue, sans avancer jusqu'à un futur résultat favorable. Aucune clôture théorique ne peut modifier une position de source broker.
- L'extraction des lectures de bougies réutilise le simulateur existant au lieu de dupliquer ses conditions de touch.

Commandes vérifiées le 05/09/2026 (Windows Node dans ce poste WSL : `node.exe`) :

| Commande | Résultat |
|---|---|
| `node.exe --test mcp_gpt_desk/test/*.test.js` (rapport complet dans `output/research/grains-week-20260905/p0-backend-tests.log`) | 1 296 tests : 1 294 passent, 0 échec, 2 ignorés |
| `npm run test:grains:postgres` — exécution équivalente vérifiée avec le bootstrap Node du script | 7 tests passent, 0 ignoré ; base PostgreSQL isolée créée, 62 migrations exécutées, base supprimée ensuite |
| Suite ciblée moteur/service/projections/schéma | Verte ; le dernier ajout nullable est également passé |
| `node.exe scripts/quality/check_architecture_boundaries.mjs` | PASS, 447 fichiers |
| `git diff --check` | PASS |
| `node.exe scripts/quality/check_static_quality_guard.mjs` | FAIL préexistant ; fichier théorique réduit de 1 026 à 942 lignes, budgets inchangés. Autres dettes non masquées |

Le garde runtime global reste à exécuter dans un environnement où le processus Node Windows trouve `rg`. Aucun contrôle n'a été désactivé. Ces tests ne certifient ni le VPS ni l'intégralité de la chaîne stratégie/context/Risk : ils couvrent le suivi à partir d'OrderIntents autorisés. La résolution opérateur des ambiguïtés et leur présentation explicite restent dans le lot produit/reconciliation.

Prochaine dépendance : TD2-429 doit supprimer la consultation future du contexte et l'antériorité des fills à la clôture M5 avant toute nouvelle annonce de performance. TD2-426 doit expliquer le retard observé à l'arrivée des M5. Les anciens résultats ne sont pas recalculés dans la base de production durant cette étape.

### Tranches suivantes locales — TD2-426 / TD2-429

Pilotage architecture/revue conservé par l'agent principal ; exécution déléguée à Terra/Luna, avec retours de correction et validation indépendante. Le périmètre, les tests et les limites sont versionnés dans `docs/engineering/GRAINS_DATA_RELIABILITY_SLICE.md` ; les constats sont dans `reports/research/GRAINS_DATA_TIMING_AND_RUNTIME_SLICE_20260905.md`.

- Réception et première insertion événement distinguées de l'ouverture/clôture ; doublons et corrections OHLC gardent une provenance non réécrite.
- Santé bornée aux bougies clôturées, chaque paire instrument/timeframe exigée et source liée à l'événement exact ; marché fermé distingué d'une panne.
- Audit M1→M5 reproductible : 14 divergences OHLC sur 520 fenêtres complètes, trous et bords séparés ; aucune correction de données en production.
- Pause opérateur respectée par le lanceur ; dry-run réellement non mutateur ; publication grains sous verrou d'instance, avec test PostgreSQL concurrent.
- Vérification : backend 1 315 pass / 1 320, 0 fail et 5 skips conditionnels ; 19 tests PostgreSQL isolés pass ; 34 tests data et 13 tests runtime ciblés pass. Architecture verte, dette statique globale non masquée.
- VPS lu seulement : release `live-focus-dashboard-20260905.2`, huit instances grains running/shadow. Retard M1/M5 d'environ dix minutes retrouvé à la réception les 3–4 septembre ; cause amont et erreurs HTTP encore à attribuer.

La prochaine tranche traite la causalité et la chaîne canonique complète. Elle devra aussi distinguer date de création outbox et timestamp explicite de publication (null dans le ledger observé), sans renommer l'une comme preuve de l'autre. Aucune promesse de performance ni de readiness lundi n'est déduite de ces tests hors marché.

### Détection causale et simulation commune — TD2-429

Implémentation locale : `a38ed8b`, garde du diagnostic legacy : `40bac0d`. Rapport détaillé et limites : `reports/research/GRAINS_CAUSAL_RUNTIME_SLICE_20260905.md`.

- Les quatre familles publient leurs détections brutes à clôture M5 ; le contexte est calculé sur préfixes propres/peer, filtré seulement après le bus. Aucun résultat futur de simulation ne supprime une détection.
- Expiration issue de la clôture, borne RTH Chicago/DST ; métadonnées source/révision conservées, SQL hors lanceur, catalogue vérifié par instrument.
- Rejeu contextuel consommant le moteur théorique live existant, mais explicitement non assimilé à un résultat Portfolio/Risk/Human Gate. Trous et ambiguïtés restent indéterminés.
- Le contexte bus vérifie dates, qualité, identité, contrat et calendrier ; sa provenance est persistée et émise sans emprunter un snapshot non utilisé.
- Tests backend : 1 353 pass / 1 360, 0 fail, 7 conditionnels ; PostgreSQL réel : 21/21 pass. Garde d'architecture vert ; dettes globales statique/runtime non masquées.
- Comparaison figée 31 août–4 septembre : 100 détections brutes ; les 28 signaux live sont retrouvés par famille/sens/bougie source, sans prétendre que leur plan/cycle est inchangé. Les données historiques ne prouvent pas la connaissance préalable de leurs 42 événements agricoles.

TD2-429 reste **en cours** : exposition entre lots, application effective des réductions dans Risk, manifeste complet et requalification des artefacts sont les prochaines conditions de sortie. La restauration de provenance/coverage macro relève également de TD2-426. Aucun merge main ou déploiement VPS dans cette tranche.

### Cinq lots et analyste front parallèle — 5 septembre, tranche suivante

Référence courante : `reports/research/GRAINS_FIVE_LOTS_PROGRESS_20260905.md` ; baseline de tranche `16f6c16a44a8e5f489776270f54193a67f910809`. Les paragraphes précédents restent les preuves de leurs versions, pas l'état final de cette tranche.

Correctifs et outils versionnés localement : `56b0b4a`. Intégration PostgreSQL complète : 34/34, zéro exclusion ; dernier correctif de fixture Human Gate relancé séparément : 4/4 exposition.

- TD2-426 : 58 événements NASS récupérés officiellement avec leur source originale. Couverture historique complète non établie ; garde partagé live/replay sans lookahead, sans calendrier vide implicite. Connaissance absente → WAIT après publication du signal brut.
- TD2-429 : lecture PostgreSQL atomique de l'exposition/réservations, verrou de compte, idempotence et réductions de taille vérifiés. Aucun FLAT/flatten implicite sur refus Risk. Les pertes jour/semaine non publiées restent un blocage explicite si leur plafond est demandé.
- Nouveau replay local utilisant le vrai bus, le service canonique et le suivi théorique partagé, bases isolées et manifeste complet : semaine 31 août–4 septembre, 100 signaux publiés, 100 WAIT `AGRI_CALENDAR_KNOWLEDGE_UNPROVEN`, puis expiration ; zéro Human Gate, zéro fill, zéro ordre provider. Ce résultat ne qualifie pas la performance.
- Parcours positif PostgreSQL sur jeu de contrôle : signal → Context → Portfolio/Risk → OrderIntent → Human Gate non confirmé → entrée limite théorique → target. Aucun ordre physique. Le test contrôlé et les résultats historiques restent distincts.
- Suites locales : backend 1 374 pass / 1 389, 0 fail, 15 exclusions conditionnelles ; domaine 486/486 ; replay/adaptateur PostgreSQL 8/8 sans exclusions ; autres tests PostgreSQL exposition/pipeline indépendants pass. Focus 15/15 et Telegram 14/14 sans appel réel. Architecture PASS ; dettes statique/runtime toujours signalées.
- TD2-430 : deux analyses indépendantes de Live Focus et plan ciblé livrés, pour supprimer les effets décoratifs concurrents et clarifier la décision sans déplacer le rail de tickets validé. Aucun fichier frontend modifié, aucune nouvelle preuve visuelle revendiquée.

TD2-426/429/427/430/428 ne sont pas clôturés globalement. La prochaine qualification exige une preuve de calendrier et des policies/sources comparables ; le marché fermé n'autorise pas à annoncer un desk prêt. Pas de merge main ni de déploiement VPS de cette tranche non qualifiée.
