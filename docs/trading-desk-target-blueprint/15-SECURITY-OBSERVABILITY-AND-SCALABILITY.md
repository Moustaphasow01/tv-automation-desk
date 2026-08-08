# 15 — Security, Observability and Scalability

- **Titre** : Sécurité, observabilité et scalabilité
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : `01`, `02` §4, `03` §15, ADR-0024
- **Documents supersédés** : aucun
- **Dernière vérification code** : sandboxing Codex CLI vérifié par lecture directe (`02` §4)
- **Portée** : recommandations transverses, non engageantes en capacité (voir `01` §7, non-objectifs). Ce document ne mandate aucune migration d'infrastructure — voir ADR-0024.

---

## 1. Sécurité

### 1.1 Ce qui existe déjà et doit être préservé

- **CONFIRMÉ** : sandboxing du sous-processus Codex CLI, allowlist d'environnement (`sanitizedCodexEnv` incluant `CODEX_API_KEY`), garde `CODEX_SESSION_SCOPE_MISMATCH` (`codex-exec-adapter.js`, `02` §4). Ces mécanismes doivent rester actifs et inchangés à travers toutes les phases — aucun composant nouveau de ce dossier ne doit les contourner pour un accès plus direct au sous-processus Codex.
- **CONFIRMÉ** : authentification HMAC sur le protocole AddOn NinjaTrader — inchangée, voir `04` §4.

### 1.2 Recommandations pour les nouveaux composants

- **RECOMMANDATION D'ARCHITECTURE** : tout nouvel `Agent` (Research Lab, `09`) hérite du même modèle de sandboxing que le pipeline existant — pas de nouveau chemin d'invocation LLM moins contrôlé introduit « pour aller plus vite ».
- **RECOMMANDATION D'ARCHITECTURE** : les secrets nécessaires à un futur Execution Provider (ex. clés PickMyTrade, Phase 10) suivent le même mécanisme de gestion de secrets que les identifiants NinjaTrader existants — pas de nouveau magasin de secrets ad hoc.
- **CIBLE REQUISE** : aucun composant de la couche Recherche (`04` §2) ne doit avoir accès en écriture à un identifiant ou une configuration de compte broker réel — seule la couche Exécution y accède, cohérent avec la séparation en couches de `04`.

## 2. Observabilité

### 2.1 Ce qui existe déjà

- **INCERTAIN/PARTIEL** : aucun inventaire formalisé d'observabilité (dashboards, alerting) n'a été confirmé de façon exhaustive pendant l'audit — hors du périmètre précis de l'audit initial, qui portait sur les flux fonctionnels plutôt que sur l'outillage d'exploitation. **À REVALIDER À L'ENTRÉE DE PHASE** si un inventaire précis est nécessaire pour planifier ce chantier en détail.

### 2.2 Recommandations cibles

- **CIBLE REQUISE** : chaque `Event Envelope` (`14`) publié est une source potentielle de métrique d'observabilité (compte d'événements par type, latence entre `causation_id` chaînés) — pas un système d'observabilité séparé à construire à partir de zéro.
- **RECOMMANDATION D'ARCHITECTURE** : un tableau de bord opérateur minimal (§6 de `01`) devrait exposer, pour chaque `Strategy Instance` active, son état runtime, son mode d'exécution, et ses dernières métriques de sortie de phase — construit au-dessus des entités déjà définies en `05`, pas un nouveau modèle de données parallèle.
- **DÉCISION OPÉRATEUR** : le choix d'un outil d'observabilité externe (ex. Grafana, Datadog) reste une décision opérateur, hors scope technique de ce dossier — ce document ne mandate aucun outil spécifique.

## 3. Scalabilité

### 3.1 Principe

- **CIBLE REQUISE** : la scalabilité horizontale est une propriété de conception logicielle (séparation en couches, Multi-Agent Runtime généralisé capable de plusieurs workers, Lease/Lock généralisant un mécanisme déjà compatible multi-process), pas un engagement de capacité d'infrastructure (voir ADR-0024).

### 3.2 Ce qui est déjà compatible multi-worker

- **CONFIRMÉ** : le mécanisme `pg_try_advisory_lock` déjà en production (`run_desk_ai_worker.mjs:46-50`) est nativement compatible avec plusieurs workers concurrents sans modification — c'est la fondation directe de `Lease`/`Lock` (ADR-0015), qui hérite donc de cette compatibilité sans travail supplémentaire de conception.

### 3.3 Ce qui devra être revalidé à plus grande échelle

- **À REVALIDER À L'ENTRÉE DE PHASE** : le comportement du système sous un nombre de `Strategy Instance` actives simultanément significativement plus élevé qu'aujourd'hui n'a fait l'objet d'aucun test de charge (`02` §10, zone explicitement non vérifiée). Ce dossier ne suppose pas de limite précise ; il recommande qu'un test de charge soit conduit avant toute activation de plus de quelques `Strategy Instance` simultanées en LIVE, en Phase 7 ou ultérieurement, selon décision opératrice.

## 4. Ce que ce chantier ne fait PAS

- Il ne mandate aucune migration d'infrastructure (ADR-0024).
- Il ne choisit aucun outil d'observabilité externe à la place de l'opérateur.
- Il ne fixe aucune limite de capacité chiffrée — les tests de charge, s'ils sont jugés nécessaires par l'opérateur, sont un chantier distinct non détaillé ici au niveau fichier.
