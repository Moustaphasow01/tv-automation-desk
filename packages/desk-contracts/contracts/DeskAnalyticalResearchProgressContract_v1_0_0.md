# DeskAnalyticalResearchProgressContract v1.0.0

## 1. Rôle et autorité

Ce contrat fixe le protocole analytique progressif commun aux analyses `LIVE`
et `REPLAY`. Il rend observable une recherche ordonnée, prouvée par des reçus
backend et limitée au cutoff du claim courant.

Le modèle ne décide ni de l'ordre des phases, ni de leur état final, ni de la
validité des preuves. Le backend est l'autorité pour :

- ouvrir et fermer les phases ;
- émettre, lier et vérifier les reçus de preuve ;
- calculer la couverture et la projection `research_progress` ;
- appliquer le cutoff anti-lookahead ;
- limiter les lectures au scope du claim.

La projection `research_progress` est informative et dérivée. Elle ne remplace
pas le journey audité, ses reçus, les documents Master/Monitor, le plan
d'exécution ni le résultat du validateur de décision.

## 2. Identité

- contrat : `DeskAnalyticalResearchProgressContract` ;
- version : `1.0.0` ;
- `schema_version` de la projection :
  `desk_analytical_research_progress_v1` ;
- JSON Schema :
  `schemas/entities/analytical-research-progress-v1.schema.json`.

Le JSON Schema valide la projection en racine. Ses définitions `$defs`
normatives décrivent également le reçu de preuve, le scope du claim, la
politique d'outils read-only, l'enveloppe anti-lookahead et la parité
LIVE/REPLAY. Ces composants restent séparés de la projection afin de ne pas
exposer les handles protégés ou le détail des preuves dans une vue de progrès.

## 3. Parcours obligatoire

Les dix phases sont obligatoires, uniques et ordonnées :

| # | Phase | Criticité | Preuve requise | Objet |
|---:|---|---|---|---|
| 1 | `CONTINUITY` | `HARD` | `CONTINUITY_STATE` | État antérieur, thèse et continuité du run |
| 2 | `CORE_MARKET` | `HARD` | `CANONICAL_MARKET` | Marchés canoniques MNQ/MES au cutoff |
| 3 | `INDEX_CONFIRMATION` | `CONTEXT` | `INDEX_CONFIRMATION` | Confirmation NQ/ES |
| 4 | `CROSS_ASSET` | `CONTEXT` | `CROSS_ASSET_CONTEXT` | DXY, VIX, taux, pétrole et or |
| 5 | `MEGACAPS` | `CONTEXT` | `MEGACAP_CONTEXT` | Indices globaux et mégacaps |
| 6 | `MACRO` | `CONTEXT` | `MACRO_CONTEXT` | Calendrier macro visible au cutoff |
| 7 | `NEWS` | `CONTEXT` | `NEWS_CONTEXT` | Actualités disponibles au cutoff |
| 8 | `THESIS_EVOLUTION` | `HARD` | `THESIS_STATE` | Évolution explicite de la thèse |
| 9 | `OPPORTUNITY` | `HARD` | `OPPORTUNITY_SET` | Ensemble d'opportunités structurées |
| 10 | `CONCLUSION` | `HARD` | `ANALYTICAL_CONCLUSION` | Conclusion et intention de décision |

Une phase ne commence que lorsque toutes les phases antérieures sont
terminales. Une phase terminale est immuable. Aucune phase ne peut être
omise, même si sa source est indisponible : l'absence doit être prouvée par un
reçu backend.

## 4. États exacts

Les seuls états autorisés sont :

- `NOT_STARTED` : phase non visitée ;
- `IN_PROGRESS` : phase ouverte, au plus une à la fois ;
- `COMPLETE` : toutes les preuves requises sont disponibles ;
- `DEGRADED` : preuves comptabilisées mais qualité partielle ;
- `UNAVAILABLE` : source requise explicitement indisponible ;
- `BLOCKED` : intégrité, politique ou accès empêchant une conclusion sûre.

Les états terminaux sont `COMPLETE`, `DEGRADED`, `UNAVAILABLE` et `BLOCKED`.
Le statut global est dérivé par le backend, jamais fourni librement par le
modèle.

## 5. Evidence receipts

Chaque preuve est transformée par le backend en
`desk_analytical_evidence_receipt_v1`. Un reçu contient notamment :

- `issuer = DESK_BACKEND` ;
- l'identité du journey, la phase et son ordinal ;
- `evidence_kind`, la source et sa disponibilité ;
- `effective_at_utc` et le `cutoff_utc` épinglé ;
- un hash de contenu et son origine ;
- les flags qualité et reason codes ;
- un identifiant et un hash déterministes du reçu.

Le modèle ne peut jamais fournir ou remplacer `issuer`, `receipt_id`,
`receipt_hash`, `issued_at_utc` ou `schema_version`. Une preuve `AVAILABLE`
doit être liée à un payload hashé par le backend ou à un hash de source
immuable. Une preuve `DEGRADED`, `UNAVAILABLE` ou `BLOCKED` exige au moins un
reason code.

Une phase ne devient terminale que lorsque chaque `evidence_kind` requis est
comptabilisé par un reçu valide. Un reçu d'absence est une preuve
d'indisponibilité, pas une permission d'inventer la donnée.

## 6. Couverture

La projection contient exactement dix lignes de phase. Le backend calcule :

- `coverage.required = 10` ;
- `coverage.total = 10` ;
- `coverage.complete` = nombre de phases terminales ;
- `coverage.percent` = pourcentage entier arrondi ;
- `evidence_count` et `tool_call_count` par phase ;
- `evidence_receipts_count` et `tool_calls_count` globaux.

Les sommes et les relations temporelles sont des invariants cross-champs
contrôlés au runtime. Le JSON Schema contrôle la forme, les bornes, l'ordre et
les enums ; il ne remplace pas le validateur d'intégrité du journey.

## 7. Parité LIVE / REPLAY

LIVE et REPLAY appliquent strictement :

- le même ordre de dix phases ;
- les mêmes états et règles de fermeture ;
- les mêmes preuves requises ;
- le même calcul de couverture ;
- le même validateur de décision.

La seule différence admise est l'origine temporelle des données :

- LIVE : dernier checkpoint clôturé et réglé, avec cutoff roulant ;
- REPLAY : pack immuable reconstruit au cutoff historique.

Une donnée ne devient ni plus obligatoire ni moins bloquante selon le mode.
Un résultat de replay n'est comparable au live que si cette parité est
respectée.

## 8. Anti-lookahead

Chaque journey possède un cutoff backend. Pour chaque reçu :

`effective_at_utc <= cutoff_utc`

et, pour l'enveloppe du claim :

`available_data_until_utc <= cutoff_utc`.

En REPLAY, aucune lecture live ou donnée publiée après le cutoff n'est
autorisée. En LIVE, seuls les checkpoints clôturés sont lisibles. Une fuite
future produit un blocage déterministe ; elle ne peut pas être convertie en
simple warning. `future_data_used` vaut obligatoirement `false` dans une
enveloppe admissible.

## 9. Scope du claim et outils read-only

Une capacité de contexte appartient à un seul claim et à un seul worker. Le
scope épingle au minimum le mode, le workflow, la date, la session, le cutoff,
le pack, le build et le bundle :

- LIVE : `cursor_id`, `checkpoint` et `run_id` ;
- REPLAY : `work_item_id`, `backtest_id`, `replay_run_id` et `step_id`.

Le lease reste un secret de transport. La forme normative expose seulement
`lease_bound = true`, jamais le token.

Les outils de contexte autorisés en v1 sont exclusivement :

1. `get_context_catalog` ;
2. `get_continuity_context` ;
3. `get_market_context` ;
4. `get_macro_context` ;
5. `get_news_context` ;
6. `get_thesis_evolution_context` ;
7. `get_replay_section_page` ;
8. `get_market_dataset`.

Ils fonctionnent en `READ_ONLY`, sont `claim_scoped` et n'autorisent aucun
outil d'écriture. Un appel hors scope, après expiration ou avec une identité
incohérente doit être rejeté.

## 10. Compatibilité et exposition

Ce contrat est un compagnon normatif non exécutable. Son schema est exposé
par le codegen dans `entitySchemas` et accessible via
`getEntitySchema("analytical-research-progress-v1.schema.json")`.

Il n'est pas ajouté à `registry.entity_contracts` dans cette version : le gate
de finalisation actuel n'autorise qu'un ensemble fermé de contrats entité et
le worker n'accepte pas encore `research_progress` dans son output. Une
promotion dans le registry devra être une migration explicite et atomique du
producteur, du validateur et du lifecycle, jamais une activation documentaire
anticipée.
