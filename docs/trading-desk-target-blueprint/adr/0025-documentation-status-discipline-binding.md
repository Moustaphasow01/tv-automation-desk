# ADR-0025 — Discipline de statuts contraignante pour tout le dossier

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : méthode de `00-MASTER-INDEX.md` §4

## Contexte

Ce dossier consolide des mois potentiels de travail futur (23 documents, 25 ADR, 4 YAML, un backlog exécutable) rédigés par plusieurs agents et relus par plusieurs opérateurs dans le temps. Sans discipline de statut uniforme et contraignante, la distinction entre « fait vérifié », « déduction », « incertitude », et « décision à prendre » se perdrait au fil des révisions, réintroduisant exactement le risque que la méthode d'audit initiale (CONFIRMÉ/INFÉRÉ/INCERTAIN/ABSENT) cherchait à éliminer.

## Décision

Les huit statuts définis dans `00-MASTER-INDEX.md` §4 (CONFIRMÉ/INFÉRÉ/INCERTAIN/ABSENT pour l'AS-IS ; CIBLE REQUISE/RECOMMANDATION D'ARCHITECTURE/DÉCISION OPÉRATEUR/À REVALIDER À L'ENTRÉE DE PHASE pour la cible) sont **obligatoires** dans tout document futur ajouté à ce dossier, y compris ceux écrits par un agent d'implémentation en cours de projet (ex. mise à jour d'un ADR, ajout d'un ticket). Un document qui affirme un fait sans statut explicite est considéré incomplet et doit être corrigé avant d'être considéré comme faisant autorité.

## Alternatives rejetées

- **Discipline de statut recommandée mais non obligatoire** : rejetée — l'expérience de ce projet montre que des erreurs de fond (ex. la confusion initiale sur `ACTIVE_STRATEGY_RUNTIME_VERSIONS`, voir ADR-0001) sont précisément le type d'erreur que cette discipline permet de détecter et corriger tôt ; la rendre optionnelle en réduirait l'efficacité.
- **Simplifier à deux statuts seulement (vérifié / non vérifié)** : rejetée — perdrait la distinction utile entre « incertain par manque d'information » et « absent, recherché et non trouvé », qui appellent des actions de suivi différentes.

## Conséquences

- `23-TRACEABILITY-AND-COMPLETENESS-MATRIX.md` vérifie, entre autres, la conformité de chaque document à cette discipline.
- `22-GPT-CODEX-IMPLEMENTATION-RUNBOOK.md` rappelle cette obligation à tout agent d'implémentation amené à produire de la documentation dans le cadre de son travail.

## Preuve AS-IS

Sans objet — décision de gouvernance documentaire, pas un constat sur le code.
