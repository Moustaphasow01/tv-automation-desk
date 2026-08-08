# ADR-0024 — Topologie de déploiement conservée jusqu'à Phase 9, aucune migration d'infrastructure mandatée

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : `01` §7 (non-objectifs — dimensionnement infrastructure hors scope)

## Contexte

Le système actuel tourne sur un Windows Server VPS (OVH), avec des services Windows wrappés WinSW, et PostgreSQL 16. Le plan directeur mentionne une architecture « scalable » cible, ce qui pourrait être mal interprété comme exigeant une migration d'infrastructure (ex. conteneurisation complète, migration cloud multi-région) comme prérequis à ce dossier.

## Décision

Aucune des Phases -1 à 9 de ce dossier ne requiert de changement de topologie de déploiement. Le même Windows Server VPS, les mêmes services WinSW, la même instance PostgreSQL 16 restent la cible de déploiement. La « scalabilité » exigée par la North Star (`01` §1.6) est satisfaite par la conception logicielle (séparation en couches, Multi-Agent Runtime généralisé, Event Envelope) plutôt que par un changement d'infrastructure physique. Les recommandations de scalabilité horizontale future sont documentées dans `15-SECURITY-OBSERVABILITY-AND-SCALABILITY.md` comme options, pas comme prérequis.

## Alternatives rejetées

- **Mandater une migration cloud/conteneurisation comme prérequis à la Phase 2** : rejetée — introduirait un chantier d'infrastructure massif sans rapport direct avec les écarts fonctionnels identifiés dans `03`, contraire au principe YAGNI et aux non-objectifs explicites de `01` §7.
- **Laisser la question de l'infrastructure totalement ouverte, sans ADR** : rejetée — un agent d'implémentation pourrait légitimement se demander si la « scalabilité » de la North Star implique une migration d'infrastructure ; cette ADR referme explicitement cette ambiguïté.

## Conséquences

- Tous les documents de domaine (`06`-`15`) et la roadmap (`16`) conçoivent leurs architectures cibles comme déployables sur la topologie actuelle.
- Une migration d'infrastructure reste possible en Phase 12+ (au-delà du scope de ce dossier) si l'opérateur le décide, sur la base de métriques de charge réelles observées après cutover.

## Preuve AS-IS

Topologie confirmée : Windows Server VPS OVH, services WinSW, PostgreSQL 16 (`02` §1-§2). Aucune limite de capacité documentée ou observée n'a été trouvée justifiant une migration immédiate.
