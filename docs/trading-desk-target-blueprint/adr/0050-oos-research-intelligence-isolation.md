# ADR-0050 — Desk Intelligence, mémoire de recherche sans auto-patch

Date : 2026-10-04. Statut : accepté pour le premier lot de recherche ; activation production désactivée.

## Contexte

Les exigences 49–80 ajoutent un chercheur et un critique au corpus OOS existant. Elles ne donnent aucune autorité de modification des plans figés, du parser SMC3, d'ENGINE V3.9.8 ou du champion. Une association découverte sur juillet–août ne constitue pas une validation OOS d'une règle choisie sur ces résultats.

## Décision et propriétaire

`research` possède `@tv-automation/desk-oos-research` et `research_state.t3_*`. Le domaine contient les audits, observations, scorecards descriptives et gates scientifiques ; l'application possède le cycle, l'idempotence et la limitation des appels ; l'adapter PostgreSQL possède les transactions. Le host MCP ne fait que composer les API publiques et le transport Codex isolé.

```text
corpus forensic OOS déjà publié -- port READ allowlist --> ResearchCycle
                                                          |
                                  recherche + critique indépendantes
                                                          |
                                   mémoire immuable research_state.t3_*
                                                          |
                                protocole challenger, jamais exécuteur

plans / ENGINE / broker / replay : aucun port d'écriture depuis research
```

Le cycle pinne génération du corpus, hashes source, version des contrats de recherche et budget. Les clés de recherche/protocoles sont hashées après sérialisation canonique, sans réordonner les tableaux ni transformer les prix. Chaque scénario et chaque tentative publiée reçoit un audit ; les scénarios sans tentative publiée restent présents et inconnus, pas négatifs.

Les résultats économiques sont exclusivement des agrégations `DERIVED_LOCAL` de valeurs REAL publiées. Aucun remplissage alternatif, prix absent, excursion ou contre-factuel financier n'est inventé. Smoke et journées non scorables sont exclus. Le drawdown des trades clôturés n'est pas nommé drawdown d'equity du portefeuille.

Les sorties LLM sont strictement validées, ne peuvent remplacer les observations et restent `RESEARCH_INTERPRETATION`/`RESEARCH_HYPOTHESIS`. Les cas favorables et contre-exemples sont recherchés mécaniquement dans les audits persistés. Les idées sans support restent WEAK et ne bloquent pas les autres. Les conclusions individuelles non critiquées sont UNREVIEWED.

La sélection préfère Astra uniquement s'il apparaît dans `model/list` de l'installation effective et supporte xhigh. La préférence de modèles est explicite, pas un benchmark fourni par OpenAI. Le modèle est piné au premier appel. Le critique utilise une conversation distincte ; réutiliser le même modèle ne garantit pas une indépendance statistique.

Un appel payé est journalisé avant envoi. Un résultat incertain ne peut pas déclencher un second appel automatique. Le verrou de cycle évite deux workers concurrents. Une fin de recherche `COMPLETED` signifie dossier constitué, jamais amélioration d'edge ni expérience exécutée.

## Sécurité et exploitation

Deux identités PostgreSQL distinctes sont requises : lecture seule du corpus et écriture limitée à `research_state.t3_*`. Le host refuse superuser, CREATEROLE et privilèges d'écriture hors périmètre. Les contraintes/triggers SQL interdisent la mutation des snapshots. `research_enabled=false` par défaut conserve le catalogue OOS de 47 outils ; activation explicite ajoute six outils de recherche sans modifier OAuth.

## Alternatives écartées

- Réutiliser le moteur analytique historique : contamination sémantique.
- Donner le runtime OOS complet au chercheur : exposition inutile de commandes.
- Réexécuter les hypothèses sur juillet–août et annoncer de l'OOS : sur-apprentissage.
- Promouvoir automatiquement le challenger : aucune preuve scientifique ni autorité d'exécution.

## Limites et dette déclarée

Ce lot n'implémente pas un exécuteur d'expériences, une promotion, un ordonnanceur permanent, une UI de recherche ni des tests statistiques de multiples hypothèses. Les séries intrabar continues et la justification originelle détaillée des anciens plans ne sont pas persistées dans le corpus vérifié. Les mesures de couverture de marché, coût d'opportunité et causalité restent inconnues. Les protocoles validation/test ne peuvent utiliser les journées déjà exposées du corpus.

Le lifecycle SQL des hypothèses est une définition NEW immuable ; avis WEAK/REJECTED et critiques sont des artefacts distincts, pas une mutation de la définition. Les transitions complètes VALIDATED/FAILED et scorecards champion/challenger nécessiteront le module expérimental et un nouvel ADR.

Rollback : désactiver le flag et le runner ; conserver les tables et la mémoire, aucune migration destructive. Dette suivie dans le runbook. Aucune exception nouvelle au guard architecture.
