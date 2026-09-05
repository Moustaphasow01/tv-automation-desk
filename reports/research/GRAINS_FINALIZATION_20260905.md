# Desk grains — intégration locale et décision de release

Date : 5 septembre 2026. Epic Jira TD2-424. Branche `codex/grains-week-integrity`, baseline de cette tranche `8d06a28ffc64cd7e6547a5603874742804ed8797`.

Code versionné localement : `e8e863d` (calendrier), `374ace6` (Risk), `d013cd3` (Telegram), `19d0a13` (BFF/Focus), `a4fc824` (frontières runtime et dette). Ces commits ne sont ni poussés ni déployés. Le dernier commit documentaire est consultable dans l'historique de la branche.

## Décision

**Intégration locale avancée et vérifiée, mais fermeture globale et déploiement refusés en l'état.** Les tests de comportement passent ; ils ne prouvent ni une stratégie rentable, ni une alimentation live ponctuelle, ni un contexte macro historiquement complet. Aucun seuil de qualité n'a été relevé pour masquer ces limites.

Main distant vérifié : `3ed9f242c640e6b0885f5523ba2349c3203ca94a`. VPS lu sans mutation : release `live-focus-dashboard-20260905.2`, même commit, migration 062. Onze services Desk et huit instances grains running/shadow observés. La branche locale contient désormais une migration 063, non appliquée au VPS. Aucun merge main, déploiement, ordre provider, confirmation humaine réelle ou envoi Telegram réel dans cette tranche.

## État des cinq lots

| Lot | Livré et testé localement | Condition restant ouverte |
|---|---|---|
| Données et calendrier — TD2-426 | Sources calendaires immuables, sélection à l'instant T, refus des connaissances antidatées et ambiguës ; diagnostic HTTP/horodatages VPS | Archives NASS/WASDE/FAS complètes et prouvées, couverture prospective, attribution du retard amont |
| Chaîne canonique et Risk — TD2-425/429 | Suivi théorique indépendant du gate humain ; exposition/réservations atomiques ; pertes réalisées jour/semaine ; réduction de taille et précédence du blocage Risk | Compatibilité des paramètres effectifs VPS ; limites temporelles et monétaires ci-dessous |
| Requalification — TD2-427 | Replay réel PostgreSQL de la semaine sur 17 044 bougies figées ; parcours positif isolé ; parité d'extraction | Aucun trade historiquement qualifiable tant que le calendrier reste non prouvé ; robustesse économique non certifiée |
| Vérité opérateur — TD2-430 | Focus plus sobre, action liée au bon dossier, gate/expiration cohérents, Telegram canonique et livraison incertaine traitée | Livraison Telegram identifiée sur VPS et recette canary après release qualifiée |
| Release et shadow — TD2-428 | Build local, tests, procédure et critères de rollback documentés | Dette statique TD2-431, dépendances précédentes puis observation prospective en marché ouvert |

## Corrections importantes et architecture

### Calendrier connu à l'instant T

`infra/postgres/init/063_grains_calendar_version_ledger.sql` ajoute trois tables market-data append-only : versions, sources et événements. Le rôle runtime peut lire et insérer, pas réécrire ou supprimer les versions. Les empreintes, dates de collecte/connaissance et événements de chaque version restent liés. Une collision d'empreinte avec contenu contradictoire est refusée.

`mcp_gpt_desk/src/persistence/postgres-grains-calendar-ledger.js` centralise persistance et lecture as-of. Une preuve absente ne devient pas AVAILABLE. Une version récupérée après sa prétendue date de connaissance exige une preuve historique explicite. Deux versions contradictoires au même cutoff donnent UNKNOWN_COVERAGE. Une ancienne projection `market_agri_events` ne reconstitue pas à elle seule ce qui était connu dans le passé.

Le collecteur `src/adapters/usda-grains-calendar-collector.js` conserve les documents originaux et leurs empreintes. NASS a fourni 58 événements ; cela ne prouve pas la complétude NASS/WASDE/FAS. Le calendrier WASDE courant a été consulté, les pages FAS essayées renvoient 403 : aucune date FAS non vérifiée ni connaissance antidatée n'a été importée. Voir `USDA_GRAINS_CALENDAR_COVERAGE_20260905.md`.

### Exposition et sizing

La lecture dans `portfolio-theoretical-exposure-repository.js` retourne positions, réservations et pertes réalisées en une seule vue PostgreSQL, sous le verrou du compte dans le service. Une réservation sur un instrument consomme le budget commun ; deux lots concurrents ne peuvent pas ignorer leurs expositions. La direction opposée simultanée et les réadmissions du même signal sont bloquées selon le contrat existant.

Le domaine `packages/desk-domain/src/portfolio-risk-budget-v1.js` conserve le mode par défaut `REQUESTED_QUANTITY_CAP`. Le mode explicite `MONETARY_RISK_BUDGET` applique la réduction au budget monétaire avant division par le risque d'un contrat, avec arrondi inférieur et plafond de quantité demandé. Aucun minimum artificiel de 1 contrat. **Un hard BLOCK garde la priorité sur une réduction**, et un Risk refusé ne produit ni cible ni ordre.

Les pertes sont calculées sur les outcomes théoriques finaux canoniques, pas sur les acquittements opérateur. Périodes documentées : jour UTC et semaine UTC commençant lundi, pas session CBOT. Une clôture sans outcome final devient indisponible à compter de sa clôture. L'historique des statuts/corrections n'est pas une base bitemporelle complète : aucune certification de cet historique n'est revendiquée. L'activation des nouvelles tailles sur le VPS requiert aussi de vérifier unités, devise, capital et policies réelles.

### Front et Telegram

Le BFF conserve le véritable état Human Gate et sa révision. Une attente périmée est présentée expirée même avant passage du sweeper ; une confirmation reste une confirmation, pas un fill. Une ligne OrderIntent READY n'invente pas un gate ou une action CONFIRM. La page détail et les actions utilisent le même état, la même expiration et la même horloge.

`apps/desk-control-plane/src/features/live-trading/LiveFocusMode.tsx` lie les boutons au dossier sélectionné. Un bouton du dossier B ne peut pas accompagner le plan du dossier A. Le rail vertical de tickets est conservé. Hiérarchie plus sobre, libellés français, moins de halos/ombres, centre plus exploitable : intervention ciblée guidée par Impeccable, pas nouvelle refonte globale. La logique Risk demeure backend.

Telegram ne promeut plus un signal brut en ordre prêt à poser. Qualification canonique, identités, plan autorisé, état du gate et expiration sont relus avant l'envoi. Les événements observés restent distincts des instructions actionnables. Un résultat de clôture ne peut pas contaminer rétrospectivement le message d'entrée du même trade.

`telegram-delivery-runtime.js` utilise claim/lease PostgreSQL et revalidation. Une réponse positive avec message ID prouve l'envoi ; timeout, réponse indécidable ou échec de persistance du reçu après envoi donnent un état incertain, sans réessai automatique susceptible de doubler une instruction. Seul un refus transitoire explicitement reconnu tel que 429 permet ce retry. Le texte est structuré en français avec emojis et valeurs absentes explicites, sans fabriquer un prix ou un sens.

### Réduction de dette et contre-expertise

Les neuf dépassements de taille de fichiers identifiés ont été supprimés par extraction cohérente : vues/projections BFF ; persistance théorique ; orchestration/évaluation replay ; plan/enregistrement research ; valeurs/technique/synthèse du moteur grains ; réponses HTTP et conversions horaires. Les helpers préexistants ne sont mutualisés que si leur sémantique est identique.

La contre-vérification a découvert et corrigé cinq références manquantes dans l'extraction legacy grains, une référence de catalogue par défaut research et un ancien fallback BFF vers une fonction absente. Un nouveau test permanent couvre un replay legacy non vide et un résultat attendu, pas seulement les imports ou le moteur causal voisin. Les 20 comparaisons strictes avec la baseline sont identiques après correction, y compris ZC/ZW sur les bougies figées et 16 configurations research. Cela démontre la parité de cette extraction, **pas la causalité ni la rentabilité du moteur diagnostic legacy**.

Le scanner statique reconnaît maintenant les points d'entrée réellement importés par les CLI et distingue les déclarations `.d.ts` de fichiers exécutables orphelins ; un test garde le cas d'un vrai orphelin. La dernière mutualisation supprime 31 fenêtres dupliquées des projections SQL théoriques et 10 des valeurs replay, avec 25 tests ciblés et 9 PostgreSQL repassés après cette extraction. Le total descend de 104 au départ à 95, après un pic intermédiaire à 136. Il reste bloquant sur les fonctions longues, la complexité et les doublons. TD2-431 suit cette dette et bloque TD2-428. Les seuils et règles P0 restent inchangés.

## Preuves locales

Les commandes utilisent `node.exe` sur ce poste WSL/Windows ; les gardes nécessitant les outils Linux utilisent le Node Linux disponible. Les sorties brutes sont sous `output/research/grains-week-20260905/`, sauf preuves visuelles sous `output/playwright/`. Ces artefacts locaux ignorés par Git ne sont pas des preuves déployées.

| Vérification | Résultat / artefact |
|---|---|
| Backend complet `node.exe --test mcp_gpt_desk/test/*.test.js` | 1 426 tests : 1 401 pass, 0 fail, 25 conditionnels ignorés ; `finalization-backend-tests-release-candidate.log` après dernière mutualisation |
| Domaine complet `node.exe --test packages/desk-domain/test/*.test.js` | 491/491 ; `finalization-domain-tests-verified.log` |
| Frontend Vitest complet | 308/308, 62 fichiers ; `output/playwright/finalization-frontend-tests-final.log` ; action du bon dossier présente, autre dossier ou ID absent bloqués |
| BFF `node.exe --test mcp_gpt_desk/test/front_*.test.js` | 237/237 ; `finalization-bff-tests-closure-final.log`, inclus dans le backend, ne pas additionner |
| PostgreSQL activé (`npm run test:grains:postgres`, équivalent Windows explicite) | 44/44, zéro exclusion, 411 s ; `finalization-postgres-tests-verified.log`. Les premiers échecs de fixture ont été conservés puis corrigés : le contrôle utilise une collecte courante, pas une fausse preuve historique |
| Parité extraction avec baseline 8d06a28 | 20/20 comparaisons strictes ; `finalization-extraction-parity.json` |
| Test permanent legacy et plan research | 4/4 ; inclus dans le backend complet |
| Typecheck + build VNext | PASS ; `index-0tHfY_hP.js`, CSS `index-CNeeGDsH.css`, chunk live `LiveTradingPage-BB-Q6MX4.js` ; `output/playwright/finalization-vnext-build.log` |
| Rulebook / sélection / scanner | 1 000 règles valides, self-tests sélecteur et scanner pass ; audit 200 fichiers : 0 erreur P0, 883 avertissements. Ce scanner heuristique ne prouve pas toute la conformité UX |
| Recette navigateur local réel | 10 résolutions, zéro erreur page/réseau, scroll général/interne, filtres/détails, 0 serious/critical Axe ; `output/playwright/live-focus-layout-populated-action-bound/live-focus-layout-audit.json` |
| Données de recette UI | Trois dossiers de contrôle dans PostgreSQL local, aucun provider command ; pas de données fictives dans le runtime de production. Dashboard ZC/ZW : 2 tickets, le troisième ZS étant exclu de ce scope |
| Gardes architecture / migrations / runtime | PASS ; architecture 495 fichiers, 63 migrations/146 tables, horloge 126 usages pour budget 130 |
| Autres gardes ciblés | PASS : Problem Details, architecture frontend, compatibilité API, isolation legacy VNext, mode de données runtime VNext, contrats stratégie, secrets navigateur ; `finalization-guards-summary.jsonl` |
| Garde statique | FAIL conservé : 270 fonctions longues /250, 720 complexes /650, 95 fenêtres dupliquées /72 ; `finalization-static-release-candidate.log`. Le test ciblé du scanner passe, pas le test global exigeant un dépôt conforme |
| Références JavaScript modifiées | Aucun identifiant non résolu sur les 52 fichiers examinés après correction ; `finalization-reference-check-verified.json`. Ce contrôle n'est pas un typecheck complet backend |

L'outil navigateur intégré était indisponible avant bootstrap ; la recette a utilisé le runner Playwright du projet sur le vrai BFF/PostgreSQL local. Aucun mock réseau n'a été substitué à une preuve de connexion. Le scénario visuel n'est ni une réception broker ni un envoi Telegram réel.

## Replay de la semaine : interprétation correcte

Entrée figée `vps-week-ledger.json`, SHA-256 `8417abff18e08015cd58460dc1cfee312ceca360e8eff34e26bc5c3d0450bdf6`, 17 044 bougies. Fenêtre de décision : 31 août–4 septembre 2026 ; cutoff final 5 septembre 00:00 UTC ; ZW et ZC.

Le replay canonique publie **100 signaux bruts, 100 WAIT macro, zéro OrderIntent/Human Gate, zéro fill, zéro provider command**. Les 42 événements agricoles legacy sans version probante sont explicitement écartés. Les WAIT arrivent ensuite à expiration ; aucune donnée de couverture n'est inventée pour créer des trades.

Le parcours positif complet est testé séparément sur une base PostgreSQL de contrôle : Signal → Context → Portfolio/Risk → TargetPosition → OrderIntent → Human Gate non confirmé → attente limite → fill théorique → target. Il démontre le câblage, pas la performance de la semaine. Les paramètres par défaut locaux ne sont pas déclarés identiques aux policies VPS. Le replay final `causal-postgres-calendar-ledger-final-manifest.json` est terminé avec succès : ses 600 empreintes de fichiers concordent avec le code versionné dans `a4fc824`, sans réécriture des replays précédents. La comparaison d'extraction relancée après ce commit confirme aussi 20/20 résultats identiques à la baseline.

## Alimentation VPS : ce qui est prouvé et ce qui ne l'est pas

Lecture des logs HTTP et de la base sans modification : les 3–4 septembre, les premières insertions M1/M5 de ZC/ZW se trouvent environ 10,08–10,12 minutes après clôture. Les délais HTTP observés sont surtout de quelques secondes, donc ils n'expliquent pas à eux seuls ces dix minutes. Le statut HTTP 0 n'est pas compté comme succès. Des 401/422/502 existent ; la rotation des logs et l'absence de corrélation versionnée historique empêchent une attribution complète par bougie.

Une alerte/source TradingView retardée est une hypothèse à vérifier, pas une cause certifiée. Les anciens `received_at` modifiables ne deviennent pas une fausse preuve de réception originelle. Le nouveau tracing permettra la mesure prospective, mais n'a pas été déployé. Preuves : `finalization-vps-webhook-readonly.json`, `finalization-vps-timing-readonly.json`.

## Plan de fermeture et rollback

1. Terminer TD2-431 sans relever la baseline ; qualification des points d'entrée et parité des extractions, pas déplacement cosmétique de dette.
2. Obtenir une couverture calendrier complète traçable, puis figer données, policies et coûts. Une source rétrospective sans preuve demeure diagnostic ; une collecte actuelle ne se prétend pas ancienne.
3. Vérifier producteur TradingView, horaires/bar closes, entitlement éventuel, réponses webhook et première persistance. Qualifier la compatibilité des budgets/limites du VPS.
4. Rejouer la chaîne historique avec les mêmes manifestes, produire attribution par gate et robustesse sur fenêtres distinctes. Les périodes déjà consultées ne sont pas un holdout vierge.
5. Seulement après ces gates : merge contrôlé, sauvegarde DB, release versionnée/migration 063, canary local puis VPS, test Telegram explicitement identifié, vérification opérateur. Aucun AUTO/LIVE implicite.
6. Observer en marché ouvert la chaîne complète et la latence ; ne pas confondre huit processus running avec huit stratégies certifiées rentables.

Rollback prévu : conserver la release VPS actuelle comme référence ; sauvegarder les réglages et la DB avant toute future migration. La 063 est additive et les versions append-only sont conservées, pas supprimées pour revenir à l'ancien binaire. Si le futur canary échoue, retour au binaire précédent avec producteurs drainés selon le runbook existant ; ne pas laisser la qualification macro ouverte ni activer la livraison physique pour contourner un refus. **Cette procédure n'a pas été exécutée sur VPS dans cette tranche.**
