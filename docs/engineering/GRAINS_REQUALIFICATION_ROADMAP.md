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
- TD2-424 : en cours. TD2-425 : correctif local testé, revue d'intégration requise. Autres lots : à faire, dépendants des preuves P0.
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
