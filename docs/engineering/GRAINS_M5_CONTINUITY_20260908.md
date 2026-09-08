# Continuité M5 — correctif du 8 septembre 2026

## Périmètre

L'opérateur a demandé que les défauts M1 ne paralysent plus le desk lorsque les stratégies peuvent travailler en M5, puis a autorisé l'activation sur VPS **après les tests**. Le mode SHADOW, le verrou global, le kill switch et le maximum de contrats à zéro doivent rester inchangés.

Le module propriétaire est `market-data` : politique pure dans `packages/desk-domain/src/grains-data-continuity-v1.js`, contrat TypeScript voisin et exports publics. Les adapters/runtime existants la consomment ; aucun moteur parallèle, aucune donnée M1 synthétique et aucune migration SQL. Voir ADR-0035.

## Chemins corrigés

- Qualité grains et contexte causal : le M5 doit rester READY ; M1 reste diagnostiqué mais facultatif sous la politique activée. Les quatre familles et leurs IDs de signaux sont inchangés.
- Bus/pipeline : contrôle explicite de la politique courante, du cutoff, de l'identité du catalogue et de l'origine SHADOW. Retour strict effectif même sur un signal déjà en attente.
- Readiness : M5 seul uniquement pour un ensemble actif entièrement compatible ; état M1 et provenance conservés. Une instance étrangère ou non-SHADOW rétablit les obligations strictes.
- Contexte consultatif : le cutoff des prix suit les sources obligatoires M5 et n'est plus retenu par un M1 figé. Calendrier et session restent impératifs. Prompt et preuves signalent le repli sans présenter M1 comme réparé.
- Configuration : `Set-DeskGrainsDataPolicy.ps1`, Preview/Apply, contrôle de révision, audit et sauvegarde avec ACL protégée. Application administrateur uniquement. Aucun service redémarré implicitement par cet outil.

## Validation avant livraison

- Backend complet : 1 587 tests réussis, zéro échec, 50 tests conditionnels ignorés dans cette invocation.
- PostgreSQL isolé : six tests réels réussis après correction d'une fixture non valide ; bus → contexte → Risk → HumanGate, zéro ProviderCommand/ProviderEvent.
- Domaine : gate de couverture 98,70 % des lignes et 96,94 % des fonctions ; seuils 90 % respectés.
- Tests ciblés : M1 absent/figé/partiel/sans volume, récupération M1, M5 manquant/vieux/dupliqué/hors date/avec trous/sans volume, calendrier, expiration, scope, rollback, cutoff et invariance causale.
- Relecture en lecture seule des bougies du 8 septembre, avec la version du calendrier connue à chaque clôture : 24 candidats inchangés (16 ZC, 8 ZW). Qualité admise : 0 en strict, 24 avec repli ; préfiltre : 23 admissibles, 1 refus directionnel. Ce n'est ni un backtest de rentabilité, ni une preuve de livraison d'alertes, ni une reconstitution des latences réelles. Aucun candidat historique n'est republié.
- Architecture, exceptions, sécurité supply-chain, runtime-safety, contrats stratégies, déploiement Windows et compatibilité API passent. Le guard static-quality reste rouge sur la dette préexistante ; les budgets ne sont pas relevés et aucune nouvelle fonction ne dépasse le seuil de complexité.
- Le test local d'écriture de configuration a révélé que la session Windows locale n'est pas élevée. Le script exige désormais explicitement un administrateur avant toute création de fichier privé. Le test complet Preview/Apply/conflit/rollback doit être exécuté dans un répertoire isolé sur le VPS administrateur avant activation réelle.

## Retour arrière et limites

Appliquer `M1_M5_STRICT` avec l'outil de configuration, puis recharger les consommateurs. Les signaux déjà publiés conservent leur preuve et sont soumis au flag au bus. La release précédente reste disponible via le kit de rollback. Les données et migrations ne sont jamais annulées.

Le repli ne supprime ni le retard de l'abonnement CBOT non actif ni les autres raisons légitimes d'attente. Le marché grains étant fermé pendant cette intervention, une alerte prospective en séance ne peut pas encore être certifiée. Les indicateurs existants continuent de publier la fraîcheur par flux ; aucun nouveau composant d'interface n'est ajouté.

## Touch-and-improve

- Politique partagée explicitement typée : aucune → une, commune aux consommateurs sans dépendance fournisseur.
- Exigence M1 et cutoff intégral imposés sans alternative sur deux chemins : deux → zéro pour le périmètre M5 autorisé ; garde-fous stricts conservés ailleurs.
- Couverture de régression dédiée au repli : zéro → tests de domaine, qualité, scope, rollback, contexte, readiness et chaîne PostgreSQL réelle.
- Projection de santé et qualité : calculs temporels/diagnostics séparés des projections, fonctions dédiées bornées ; pas de nouveau fichier de production dépassant 600 lignes ni de nouvelle fonction dépassant 60 lignes.
- ADR-0035 créé ; aucune dérogation ajoutée. Le résultat du déploiement et les empreintes finales sont consignés dans le compte rendu de livraison, distinct de cette préparation.
