# TD2-429 — Causalité de la détection grains et frontière bus / simulation

## Périmètre

Branche `codex/grains-week-integrity`, départ `6a71e64`. Travail local, sans changement VPS, front, broker ou données historiques. Pilotage/revue principal, réalisation Terra, audit indépendant Luna. Jira TD2-429 reste en cours tant que les critères globaux de requalification ne sont pas prouvés.

Les paramètres et les quatre familles de détection ne sont pas optimisés. Une correction de causalité change nécessairement certains signaux et résultats : l'ancien +116,4145 R n'est pas un objectif de reproduction de la nouvelle version.

## Décisions de placement

- `us-grains-strategy-suite` reste la frontière du runtime grains existant ; la détection causale est appelée par live et replay. Les extractions pures réduisent la taille et séparent données, contexte et orchestration.
- `persistence/postgres-grains-runtime-inputs` est la projection de lecture market-data consommée par le lanceur. Le SQL sort du lanceur ; ce dernier orchestre sans simuler les trades.
- `grains-causal-context-prefilter` applique le contexte du préfixe après publication sur le bus, sous la politique déterministe existante. Il n'autorise jamais seul un ordre. Portfolio et Risk restent propriétaires du dimensionnement et des autorisations.
- `us-grains-theoretical-replay` adapte le plan grains au moteur théorique existant, lui-même consommateur du simulateur public. Aucun deuxième algorithme de touch/fill n'est introduit.
- Le script d'audit lit des jeux figés et écrit un rapport explicite. Il ne touche ni une base ni un provider.

Alternatives écartées : reproduire les +116 R par ajustement de filtres ; publier seulement les gagnants du simulateur ; charger la journée entière pour décider un signal du matin ; faire passer un résultat contextuel pour une autorisation Human Gate ; recopier les règles d'exécution.

## Invariants d'acceptation

1. M5 source = heure d'ouverture ; décision seulement à clôture. L'expiration d'entrée part de la clôture et respecte la borne Chicago, y compris DST.
2. La qualité, le contexte propre/peer, les niveaux et la confiance utilisent seulement un préfixe disponible. Ajouter/modifier le futur ne change aucun signal déjà produit.
3. Le calendrier prévu peut être connu avant l'événement. Les actuals futurs ne sont pas chargés ; une date de connaissance absente n'est pas inventée.
4. Toutes les détections éligibles sont publiées brutes ; le résultat d'un trade simulé ne supprime pas un signal futur. Le bus applique les décisions, puis Portfolio/Risk/Intent/Human Gate.
5. Pause opérateur, dry-run en lecture seule, expiration du signal et publication idempotente restent protégés.
6. Les champs post-Risk restent immuables. Aucun ordre physique ni confirmation Human Gate durant ces tests.
7. Une fenêtre M1 incomplète ou une ambiguïté ne devient ni un zéro comptable ni un trade gagnant certifié.

## Contrats et compatibilité

La suite causale et le publisher portent une nouvelle version technique. Les identités de stratégies existantes ne sont pas réécrites dans PostgreSQL. Cela n'est pas une nouvelle certification des versions déjà promues : alignement des artefacts enregistrés et procédure de release restent préalables au déploiement.

Le compte de signaux bruts, le compte d'admissions contextuelles et le compte d'OrderIntents autorisés sont distincts. Le lanceur de détection ne prétend pas connaître les résultats des étapes asynchrones suivantes. Les champs de compatibilité correspondants sont explicitement null, pas zéro.

## Limites à conserver dans toute comparaison

- Une causalité sur l'heure de clôture OHLC ne prouve pas la disponibilité historique de chaque révision des données. Le ledger de réception legacy n'est pas un journal immuable des révisions.
- La politique déterministe sur contexte embarqué et la politique snapshot/worker sont deux modes différents ; ils doivent être épinglés dans le manifeste du run.
- Une simulation contextuelle isolée n'est pas un replay complet Portfolio/Risk/Human Gate. Aucun R de cette simulation ne sera présenté comme résultat des seuls ordres tradables.
- Les sessions Chicago/DST ne remplacent pas la certification d'un calendrier complet de jours fériés et fermetures exceptionnelles.
- Les périodes avril–août et 31 août–4 septembre ont déjà été consultées ; elles ne sont pas un holdout vierge.
- La politique d'exposition entre lots successifs, la prise en compte des positions déjà ouvertes et l'application exacte des réductions contextuelles doivent être certifiées dans le replay complet avant toute annonce de rentabilité.

## Preuves

Les tests utilisent PostgreSQL local avec des bases éphémères et les 62 migrations, jamais les tables VPS. La publication sur bus est réelle dans cette base ; deux signaux de fixture passent par les services et repositories canoniques : le short est refusé par le contexte, le long atteint Risk → Target → Intent → Human Gate. Les plans sont conservés, l'outbox contient la provenance contextuelle, et aucune commande broker n'est créée. Ce test n'est pas encore un replay historique complet multi-batch avec exposition persistée.

Les tests adverses vérifient également : contexte absent, expiré, mauvais instrument ou calendrier invalide → WAIT ; différence ACK/fill inchangée ; trou M1 avant touch/exit → résultat indéterminé ; stop et objectif ambigus → revue ; expiration seulement sur fenêtre complète ; timestamps Chicago hiver/été ; ajout/modification des prix futurs sans modification des signaux précédents.

Les commandes finales et la comparaison par clôture sont récapitulées dans la section de clôture ci-dessous. Aucun contrôle non exécuté n'est réputé vert.

## Diagnostic hebdomadaire, non assimilable à un résultat du Desk

Source locale figée : `output/research/grains-week-20260905/vps-week-ledger.json`, SHA-256 `8417abff18e08015cd58460dc1cfee312ceca360e8eff34e26bc5c3d0450bdf6`. Aucun OHLC n'a été réécrit. Fenêtre : 31 août–4 septembre 2026, ZW et ZC, cutoff final `2026-09-04T23:59:59.999Z`.

| Étape diagnostique | Compte |
|---|---:|
| Signaux bruts du détecteur causal | 100 |
| Admissions par le contexte embarqué seul | 90 |
| Refus par ce contexte | 10 |
| Simulations individuelles clôturées | 32 |
| Expirations d'entrée prouvées | 29 |
| Résultats indéterminés | 29 |

Les indéterminés sont 27 fenêtres d'entrée incomplètes et 2 fenêtres de sortie incomplètes. Parmi les seules clôtures observables : 14 TP et 18 stops, somme **+3,6349 R**. **Ce chiffre n'est ni le résultat des ordres Human Gate, ni une rentabilité certifiée : Portfolio/Risk, netting/exposition et sélection entre variantes ne sont pas exécutés dans cette composition.** Il ne corrige pas le bilan live −0,82857143 R. Les coûts/slippage ne font pas encore l'objet d'une certification économique de ce run.

| Date | ZW bruts | ZC bruts |
|---|---:|---:|
| 31 août | 9 | 2 |
| 1 septembre | 3 | 13 |
| 2 septembre | 15 | 16 |
| 3 septembre | 11 | 10 |
| 4 septembre | 12 | 9 |

Les 42 événements du ledger n'ont **aucun** `source_published_at_utc`/`known_at_utc`. `actual_available_at_utc` n'est pas renommé en connaissance du calendrier. Ils sont exclus du contexte causal, sans inventer une disponibilité ; **la couverture macro historique est donc NON PROUVÉE**, pas « aucun risque macro ». L'événement HIGH de la semaine conservé dans le ledger est daté du 1 septembre à 19:00 UTC, hors session RTH grains, mais cela ne prouve pas que le calendrier est exhaustif. La composition est volontairement marquée `CONTEXT_ONLY_NOT_PORTFOLIO_RISK_HUMAN_GATE` et `tradable:false`.

## Consommation et comparaison reproductibles

- `npm run test:grains:causal` : tests du détecteur, invariants indépendants, comparateur, contexte bus et adaptateur théorique.
- `npm run test:grains:postgres` : tests DB locaux isolés, dont lecture des seuls préfixes clôturés et chaîne canonique.
- `npm run audit:grains:causal -- --input <ledger> --output <rapport> --start YYYY-MM-DD --end YYYY-MM-DD` : vérifie chaque clôture RTH M5, **y compris sans signal**, compare les deux ensembles complets et perturbe les prix futurs propres/peer. Chaque journée reste indépendante ; les données des jours précédents restent chargées pour les niveaux antérieurs.
- `npm run grains:replay-context-theoretical -- --input <ledger-ou-rowsBySymbol> --output <rapport> --start YYYY-MM-DD --end YYYY-MM-DD --as-of <UTC> --instruments ZW,ZC` : diagnostic individuel explicitement hors qualification Portfolio/Risk/Human Gate.

Le manifeste épingle l'entrée et les sources des modules grains/context/exécution ainsi que les packages domaine/replay/time, pas seulement un fichier index. Les chemins d'entrée/sortie doivent différer ; les CLI refusent les sources inutilisables au lieu d'annoncer zéro trade. Les artefacts générés restent dans `output/`.

Pour limiter le coût, les quatre familles réutilisent un cadre par clôture et par journée. Les conversions Chicago partagent un cache FIFO borné à 8 192 timestamps : valeurs immuables, aucun OHLC/contexte stocké dans ce cache. Après optimisation, les 100 signaux de la semaine sont strictement identiques au JSON préalable (assertion profonde indépendante). Mesure indicative sur ce poste chargé : 13,8 s avant le cache temporel, 8,0 s au premier passage puis 7,0 s au second ; ce n'est pas un SLA live.

## Dépendances P0 avant certification ou déploiement

1. **TD2-426 / données** : restituer des preuves réelles de connaissance du calendrier et des révisions OHLC ; distinguer absence d'événement et absence de couverture. Ne pas remplacer ces preuves par les dates actual ou celles d'un backfill effectué après coup.
2. **TD2-429 / chaîne complète** : conserver l'exposition/les positions/intents entre les lots du replay et prouver la prise en compte du multiplicateur contextuel dans Portfolio/Risk. Aujourd'hui le multiplicateur est correctement enregistré dans l'advisory, mais son application au sizing final n'est pas démontrée.
3. **TD2-429 / certification moteur** : figer de nouvelles versions d'artefacts promus et leur mapping vers les instances ; les identités de catalogue n'ont pas été réécrites par ce patch. La nouvelle version technique ne vaut pas revalidation des stratégies.
4. **TD2-427 / performance** : relancer le manifeste complet jusqu'aux seuls ordres qualifiés, puis robustesse/coûts/stabilité. Aucun objectif de reproduire artificiellement les +116 R.
5. **TD2-430/428 / produit et release** : exposer les états indéterminés/advisories sans faux zéros, recette UI/Telegram, release contrôlée puis observation shadow en marché ouvert.

Le scheduler live existant sélectionne explicitement le contexte embarqué via `DESK_STRATEGY_SIGNAL_PREFER_EMBEDDED_CONTEXT_GATE` (valeur différente de `false`). L'API de pipeline sans cette option conserve le chemin snapshot. Ce choix doit figurer dans tout manifeste comparatif, pas être supposé identique. Les décisions embarquées legacy ne sont plus attribuées à un snapshot courant non utilisé.

## Qualité et statut de livraison

Les nouveaux modules restent sous 600 lignes et leurs nouvelles fonctions sous les limites mesurées (60 lignes / complexité 15). La suite principale passe d'un fichier de 595 lignes observé dans la baseline à 526 lignes après extraction et caches ; le découpage sépare réellement les responsabilités.

Le garde statique global reste **FAIL**, budgets inchangés : 272 fonctions longues (identique au départ), complexité 721 contre 723 au départ, doublons 104 contre 106. Les fichiers potentiellement non consommés passent de 23 à 26 : les imports depuis les CLI ne sont pas inclus dans le graphe de ce scanner ; deux nouvelles entrées CLI et le simulateur historique conservé pour reproduire les anciens audits sont concernés. Les commandes CLI et tests prouvent leur consommation, sans modifier le garde ni maquiller sa sortie. Les autres dépassements de fichiers legacy restent listés par le garde.

Le garde runtime global reste **FAIL** : 133 horloges implicites pour un budget de 130, même valeur qu'avant cette tranche ; aucun plafond augmenté. Le nouveau replay reçoit une horloge explicite. L'architecture des dépendances passe. L'intégralité du dépôt n'est donc pas déclarée conforme.

**Statut : tranche locale ; TD2-429 en cours, aucun merge vers main, aucun déploiement VPS, aucune autorisation AUTO/LIVE.**

## Clôture de la tranche locale — 5 septembre 2026

Code : `a38ed8b6281fd3617f7262e4fbd2dfdbc62e74e6`. Le garde additionnel `40bac0d` interdit l'ancien script `audit_us_grains_week.mjs` avec la suite causale : un ancien rapport doit être reproduit depuis son commit épinglé, jamais avec une nouvelle sémantique cachée.

| Vérification exécutée | Résultat et preuve locale |
|---|---|
| Backend complet `node.exe --test --test-concurrency=4 mcp_gpt_desk/test/*.test.js` | **1 360 tests, 1 353 pass, 0 fail, 7 skips conditionnels** ; `output/research/grains-week-20260905/causal-a38ed8b-backend.log` |
| Six suites PostgreSQL de `test:grains:postgres` | **21/21 pass, aucun skip** ; `causal-final-postgres.log` dans le même dossier |
| Suite causale ciblée | **30/30 pass** avant le dernier cas d'enveloppe ; `causal-targeted-final.log` |
| Comparateur final + CLI, dont enveloppe réelle `signal.emitted` | **12/12 pass** ; `causal-final-audit-cli-tests.log` ; dernier comparateur seul **9/9 pass** |
| Architecture | **PASS**, 462 fichiers, frontières conservées |
| Refus du diagnostic legacy avec suite V2 | **PASS**, erreur attendue `LEGACY_GRAINS_AUDIT_VERSION_MISMATCH` avant lecture/écriture de données |
| Statique / runtime globaux | **FAIL connus et conservés** ; `causal-static-guard.log` / `causal-runtime-guard.log` |
| Git whitespace | **PASS** `git diff --check` et revue du contenu staged |

La campagne de causalité est exécutée en trois partitions (31 août–1 septembre, 2–3 septembre, 4 septembre), avec le **même fichier source intégral** et les mêmes empreintes de code. Cette partition est valable uniquement pour la détection journalière indépendante ; elle ne remplace pas un replay séquentiel d'exposition/Portfolio entre journées. Les rapports sont `causal-audit-mon-tue-final.json`, `causal-audit-wed-thu-final.json` et `causal-audit-fri-final.json` dans le dossier d'évidence local.

| Partition | Signaux bruts | Clôtures vérifiées | Écarts causaux | Signaux live rapprochés |
|---|---:|---:|---:|---:|
| 31 août–1 septembre | 27 | 115 | 0 | 10/10 |
| 2–3 septembre | 52 | 109 | 0 | 11/11 |
| 4 septembre | 21 | 57 | 0 | 7/7 |
| **Total** | **100** | **281** | **0** | **28/28** |

Aucun signal supplémentaire n'apparaît dans un préfixe après disparition dans le batch complet. Les 281 points correspondent aux clôtures réellement présentes dans le ledger ; les bougies absentes ne sont pas certifiées. La vérification finale relit chaque JSON, recalcule les empreintes actuelles des sources et exige leur égalité stricte avec celles des trois runs : **PASS**.

Le matching legacy déroule l'enveloppe réelle `payload.type=signal.emitted` puis sa charge `payload.payload` ; il ne devine pas la famille à partir d'un ID raccourci. Les 28 rapprochements se font sur instrument + famille + direction + ouverture source. Le plan complet et le contexte sont versionnés/différents, notamment la connaissance à clôture et le TTL : **28 rapprochements ne signifient pas 28 trades identiques ni 28 ordres qualifiés**. Les 72 détections supplémentaires sont des signaux bruts de la nouvelle chaîne, pas 72 ordres à poser.
