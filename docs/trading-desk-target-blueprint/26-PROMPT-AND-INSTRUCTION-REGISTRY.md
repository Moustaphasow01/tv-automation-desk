# 26 — Prompt & Instruction Registry

- **Statut** : `CIBLE CANONIQUE`
- **Version** : `1.0.0`
- **Date** : 2026-08-08
- **ADR** : `adr/0027-hybrid-prompt-instruction-registry.md`
- **Module propriétaire** : `agents`

## 1. Objectif

Centraliser les prompts, instructions partagées, bindings d'agents, politiques d'exécution et preuves d'évaluation sans perdre la revue Git ni permettre une mutation silencieuse en production.

Le registre ne remplace ni les contrats métier, ni les règles déterministes, ni la continuité PostgreSQL. Un prompt explique une mission à un modèle ; il ne devient jamais la source de vérité d'une stratégie, d'un risque, d'un ordre ou d'un état de workflow.

## 2. Modèle hybride retenu

- **Git** contient les seeds revus, les migrations, les schémas, les exemples et la version de secours reproductible.
- **PostgreSQL** contient le catalogue opérationnel, les versions immuables, les affectations, les déploiements, les évaluations et l'audit.
- **Le work item** épingle la version résolue et son hash avant le claim.
- **La conversation Codex** conserve du contexte de travail, mais ne remplace jamais la version épinglée.

Après un claim, aucun appel à `latest` n'est autorisé. Une reprise utilise exactement le snapshot résolu par le work item, même si une version plus récente a été publiée entre-temps.

## 3. Agrégats et tables cibles

### 3.1 Catalogue

| Table | Responsabilité | Invariants principaux |
|---|---|---|
| `prompt_definitions` | identité stable d'un prompt métier | `prompt_key` unique, responsabilité et type de sortie explicites |
| `prompt_versions` | texte/version immuable d'un prompt | SemVer, contenu, variables, hash et statut ; contenu non modifiable après publication |
| `instruction_definitions` | identité d'une règle réutilisable | une responsabilité précise, aucun secret |
| `instruction_versions` | version immuable d'une instruction | contenu et hash scellés après publication |
| `prompt_compositions` | composition ordonnée d'un prompt et de modules | ordre déterministe, versions exactes, hash rendu |
| `prompt_composition_items` | membres ordonnés d'une composition | aucune référence implicite à `latest` en publication |

### 3.2 Affectation et exploitation

| Table | Responsabilité | Invariants principaux |
|---|---|---|
| `agent_prompt_bindings` | associer mission/agent à une composition | scope, environnement et plage de validité explicites |
| `prompt_deployments` | publication/canary/rollback | last-known-good obligatoire avant promotion globale |
| `prompt_evaluations` | résultats de tests et critères de promotion | dataset, modèle, policy, métriques et preuve reproductibles |
| `prompt_render_snapshots` | preuve exacte envoyée au modèle | texte rendu, variables normalisées, hashes, sans secret |

Les clés métier utilisent un nom contrôlé comme `LIVE_CONTEXT_DECISION`, `REPLAY_RESEARCH_REVIEW` ou `STRATEGY_CANDIDATE_CRITIQUE`. Les identifiants techniques restent opaques et ne sont pas présentés comme libellés opérateur.

## 4. Cycle de vie

```text
DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED -> DEPRECATED
                                  |            |
                                  +----------> REVOKED
```

- `DRAFT` : éditable, jamais exécutable en production.
- `IN_REVIEW` : contenu figé pour revue et évaluation.
- `APPROVED` : évaluations minimales satisfaites, pas encore affecté.
- `PUBLISHED` : immuable et éligible à un binding.
- `DEPRECATED` : aucun nouveau binding, reprises existantes autorisées selon politique.
- `REVOKED` : non utilisable pour un nouveau claim ; traitement des travaux déjà claimés défini par décision de sécurité explicite.

La suppression physique d'une version référencée par un run, une décision ou un audit est interdite.

## 5. Résolution déterministe

Avant de créer un work item, le service applicatif :

1. résout l'`Agent Execution Policy` ;
2. résout le binding applicable à la mission, au scope et à l'environnement ;
3. charge les versions exactes du prompt et des instructions ;
4. valide les variables contre leur schéma ;
5. rend la composition dans un ordre stable ;
6. calcule le hash canonique ;
7. persiste le snapshot et épingle ses identifiants dans le work item ;
8. refuse le claim si une référence, un contrat ou une variable obligatoire manque.

Le worker reçoit au minimum :

```json
{
  "prompt_definition_key": "LIVE_CONTEXT_DECISION",
  "prompt_version": "2.4.0",
  "composition_id": "opaque-id",
  "render_snapshot_id": "opaque-id",
  "rendered_sha256": "sha256:...",
  "execution_policy_version": "opaque-version",
  "contract_versions": ["opaque-version"]
}
```

## 6. Sécurité et permissions

- Aucun token, mot de passe, clé API, PIN opérateur ou donnée broker sensible dans un prompt ou une instruction.
- Variables sensibles injectées au dernier moment depuis le gestionnaire de secrets et exclues du snapshot, des logs et de l'UI.
- Rôles séparés : auteur, reviewer, approbateur, déployeur et lecteur d'audit.
- Une publication, un binding, un rollback et une révocation produisent un événement d'audit.
- L'UI interdit l'édition d'une version publiée ; elle crée une nouvelle version.
- Les endpoints exposent des DTO contrôlés, jamais un accès SQL ou une mutation générique de document.

## 7. Évaluation, canary et rollback

Une version ne peut devenir `PUBLISHED` que si :

- le rendu est déterministe ;
- les schémas d'entrée/sortie et contrats sont compatibles ;
- les tests de non-régression passent sur un dataset épinglé ;
- les limites de coût, délai, sécurité et hallucination sont mesurées ;
- la stratégie de rollback désigne une version last-known-good.

Le déploiement suit `SHADOW -> CANARY -> ACTIVE`. Le canary compare décision, validité contractuelle, latence, coût et taux d'erreur. Le rollback ne modifie pas les runs passés : il change le binding des nouveaux travaux et conserve toutes les preuves.

## 8. Migration depuis l'existant

1. Inventorier les prompts Live/Replay dans le code et les documents, ainsi que leurs noms, versions et hashes actuels.
2. Créer les seeds correspondant exactement aux versions `2.4.0` actuellement utilisées.
3. Prouver que le renderer reproduit les mêmes octets et hashes pour les mêmes variables.
4. Brancher d'abord le Replay en shadow, puis le Live, sans modifier les contrats ou la stratégie.
5. Comparer les outputs et erreurs à comportement constant.
6. Activer les bindings par feature flag avec rollback vers le constructeur historique.
7. Interdire toute nouvelle construction de prompt hors registre.
8. Retirer les textes dupliqués seulement après observation et preuve d'absence de consommateur.

## 9. API et front opérateur

Le front de transition doit permettre :

- consulter definitions, versions, statut, hashes et dépendances ;
- voir quel agent, mission et environnement utilise quelle version ;
- comparer deux versions et leurs évaluations ;
- publier en canary, promouvoir, déprécier ou revenir au last-known-good selon permissions ;
- retrouver depuis un run le rendu exact, le modèle, le niveau de raisonnement, les contrats et les résultats ;
- afficher des libellés métier lisibles et conserver les identifiants techniques dans le détail/audit.

## 10. Critères d'acceptation du registre

- Live et Replay résolvent leurs prompts depuis PostgreSQL avec parité octet/hash démontrée.
- Deux rendus avec les mêmes versions et variables produisent le même hash.
- Une version publiée ne peut plus être modifiée.
- Un work item déjà claimé n'est pas affecté par une publication ultérieure.
- Un rollback vers le last-known-good est démontré sans redéploiement de code.
- Tous les futurs workers et agents passent par le même port applicatif de résolution.
- Les secrets sont absents du registre, des snapshots, des logs et de l'UI.
- Chaque décision IA reste traçable jusqu'au prompt, aux instructions, au modèle, à la policy et aux contrats exacts.
