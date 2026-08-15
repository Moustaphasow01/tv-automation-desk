# DeskHourlyThesisMonitorContract


## Page 1

DeskHourlyThesisMonitorContract v1.0.0 —
FINAL
Hourly Thesis Control — Delta-Based, Position-Aware, Macro-
Technical Monitor
Version : 1.0.0
Statut : final validé
Compatible avec : DeskMasterAnalysisContract v4.0.0
Timezone par défaut : Europe/Paris
Univers principal : Futures US — MNQ, NQ, MES, ES
Rôle : suivre, challenger , maintenir , invalider ou transformer une thèse active
Fréquence cible : horaire
Modes supportés : live, replay, back-forward strict, paper
Principe central : Master Analysis → Active Thesis → Expected Path → Market Delta → Thesis Health
Score → Monitor Decision → Updated Thesis → Next Monitor 
1. Mission du monitor
Le monitor horaire n’est pas un nouveau Master Analysis.
Il ne doit pas refaire toute l’analyse complète à chaque passage.
Son rôle est de contrôler la thèse active produite par le Master Analysis.
Il doit répondre à la question suivante :
Depuis la dernière analyse ou le dernier monitor , le marché confirme-t-il, fragilise-t-il,
invalide-t-il ou transforme-t-il la thèse active ?
Le monitor doit produire une décision claire et actionnable :
maintenir la thèse ;
attendre davantage ;
armer le setup ;
déclencher GO ;
annuler le setup ;
fragiliser la thèse ;
marquer la thèse à risque ;
invalider la thèse ;
transformer le scénario ;
réduire le risque ;
passer le stop à break-even ;
prendre partiel ;
sortir ;
1. 
2. 
3. 
4. 
5. 
6. 
7. 
8. 
9. 
10. 
11. 
12. 
13. 
1


## Page 2

demander un replan complet ;
expirer le setup ;
ne rien faire.
Le monitor ne produit pas un commentaire horaire.
Il produit une décision de suivi.
2. Différence entre Master Analysis et Hourly
Monitor
Élément Master Analysis Hourly Monitor
Rôle Construire la thèse Contrôler la thèse
Fréquence Début de session / replan completHoraire
Profondeur Analyse complète Analyse ciblée sur delta
Point de départMarché global Thèse active
Données Pack complet + features +
contexte
Master + dernier monitor + snapshot 1h/
4h
Sortie
principale Playbook vivant Décision de suivi
Horizon Session entière Dernière heure + 4h + contexte session
Fonction Stratégie Supervision dynamique
Le Master construit le plan.
Le monitor vérifie si le marché respecte le plan.
3. Philosophie du monitor
Le monitor doit fonctionner comme un contrôleur de thèse.
Il ne cherche pas d’abord un nouveau trade.
Il vérifie d’abord si la thèse active est toujours défendable.
Ensuite seulement, il décide si :
la thèse doit être maintenue ;
le setup doit être armé ;
le setup doit être déclenché ;
14. 
15. 
16. 
• 
• 
• 
2


## Page 3

le setup doit être annulé ;
la thèse doit être fragilisée ;
la thèse doit être invalidée ;
un scénario alternatif doit devenir prioritaire ;
une position doit être protégée ;
une position doit être réduite ;
une position doit être fermée ;
un replan complet est nécessaire.
Le monitor fonctionne en delta :
Qu’est-ce qui a changé depuis le dernier check, et qu’est-ce que cela change pour la
thèse ?
4. Règles non négociables
Le monitor ne repart jamais de zéro.
Le monitor doit toujours charger la dernière Master Analysis pertinente.
Le monitor doit toujours charger la thèse active.
Le monitor doit toujours charger le dernier monitor disponible s’il existe.
Le monitor doit comparer l’expected path avec le marché réalisé.
Le monitor doit vérifier les conditions WAIT → GO.
Le monitor doit vérifier les invalidations.
Le monitor doit mettre à jour le thesis health score.
Le monitor doit détecter les signaux faibles.
Le monitor doit être position-aware.
Le monitor doit être time-aware.
Le monitor doit savoir transformer un scénario, pas seulement le valider ou l’invalider .
Le monitor ne doit pas déclencher GO si un hard gate est actif.
Le monitor ne doit pas ignorer le macro sous prétexte que la technique confirme.
Le monitor ne doit pas ignorer la technique sous prétexte que la macro confirme.
Chaque mouvement technique important doit être relié au macro/cross-asset ou signalé comme
non expliqué.
Chaque décision doit être sauvegardée.
Chaque décision importante doit générer une alerte hiérarchisée.
Chaque monitor doit produire un bloc transmissible au monitor suivant.
Chaque sortie doit finir par :
Décision exécutable ;
Règle finale.
5. Entrées obligatoires du monitor
Le monitor doit recevoir un contexte compressé mais complet.
Il ne doit pas recevoir uniquement l’actif tradé.
• 
• 
• 
• 
• 
• 
• 
• 
1. 
2. 
3. 
4. 
5. 
6. 
7. 
8. 
9. 
10. 
11. 
12. 
13. 
14. 
15. 
16. 
17. 
18. 
19. 
20. 
◦ 
◦ 
3


## Page 4

Il doit recevoir :
la Master Analysis de référence ;
la thèse active ;
le dernier monitor ;
la dernière décision ;
la position active si elle existe ;
le snapshot marché dernière heure ;
le snapshot marché 4 dernières heures ;
le contexte de session ;
le macro horizon ;
les conditions GO ;
les conditions d’invalidation ;
les scénarios transformables ;
les niveaux prioritaires ;
les features déterministes avec evidence ;
les références raw data si audit nécessaire.
6. Données d’entrée détaillées
6.1 Master context
Le monitor doit récupérer les éléments suivants du Master :
Élément Utilité
master_analysis_id Référence de la thèse
active_thesis Ce qui doit être surveillé
expected_path Ce que le marché devrait faire
failure_path Ce qui invalide la thèse
level_watchlist Niveaux prioritaires
trigger_map Conditions WAIT → GO
invalidation_map Conditions d’annulation
scenario_transformation_mapScénarios alternatifs
monitoring_priority Priorités du check
monitoring_playbook Arbre d’action
thesis_health_baseline Score initial
context_transmission Résumé transmissible
1. 
2. 
3. 
4. 
5. 
6. 
7. 
8. 
9. 
10. 
11. 
12. 
13. 
14. 
15. 
4


## Page 5

6.2 Dernier monitor
Le monitor doit récupérer le dernier check horaire.
Élément Utilité
Dernier statut de thèseContinuité
Dernier thesis health scoreVoir la variation
Dernière décision monitorÉviter de répéter
Derniers signaux faiblesDégradation progressive
Derniers niveaux testésNe pas réanalyser inutilement
Dernier focus Priorité actuelle
Dernière alerte Savoir si une action a déjà été signalée
6.3 Snapshot dernière heure
Objectif : voir ce qui vient de changer .
Données nécessaires :
Donnée Utilité
MNQ_M5 dernière heure Trigger , sweep, reclaim, microstructure
MES_M5 dernière heure Confirmation micro S&P
NQ_M15 dernière heure Acceptation ou rejet
ES_M15 dernière heure Confirmation marché large
DXY dernière heure Changement dollar
VIX dernière heure Stress ou détente
US10Y / US02Y dernière heurePression taux
Gold dernière heure Stress/refuge
Oil dernière heure Inflation/géopolitique
Mega caps si disponibles Confirmation Nasdaq
Semis si disponibles Qualité du leadership tech
6.4 Snapshot 4 dernières heures
Objectif : éviter de surinterpréter le bruit de la dernière heure.
5


## Page 6

Données nécessaires :
Donnée Utilité
NQ/ES M15 4h Structure intraday
MNQ/MES M5/M15 4hRéactions sur niveaux
DXY/VIX 4h Régime cross-asset
US10Y/US02Y 4h Régime taux
Gold/Oil 4h Stress/inflation
Indices Europe/AsieTransmission globale
Mega caps/semis Leadership tech
6.5 Contexte session
Élément Utilité
Session high/low Liquidité
Overnight high/lowZones de stop
Asia high/low Niveaux intraday
Previous NY high/lowRéférences institutionnelles
VWAP Acceptation intraday
POC / VAH / VAL Valeur
Range actuel Compression/expansion
Niveaux du MasterPriorités
6.6 Macro horizon
Le monitor doit connaître :
Élément Utilité
Events depuis dernier monitorExpliquer un mouvement
Events dans les 2 prochaines heuresRisque imminent
Events du reste de journée Time risk
Discours Fed/BCE/BoE Headline risk
News digest récent Catalyst ou rupture
6


## Page 7

Élément Utilité
Calendrier J+1 Prudence si event majeur demain
7. Politique anti-lookahead du monitor
7.1 Mode live
Le monitor utilise les données réellement disponibles au moment du check.
7.2 Mode replay / back-forward
Le monitor doit respecter le cutoff du check.
Il ne peut pas utiliser :
prix postérieurs au timestamp du monitor ;
actual J non disponibles au timestamp ;
actual J+1 ;
information future ;
réaction postérieure au check.
7.3 Events macro
Pour J et J+1, le monitor peut utiliser :
event ;
time ;
impact ;
previous ;
forecast ;
currency ;
assets.
Il ne peut pas utiliser :
actual ;
surprise ;
interprétation postérieure.
7.4 Features backend
Les features reçues doivent contenir idéalement :
```json id="fi1e48" { "computed_with_cutoff": "YYYY-MM-DDTHH:MM:SS+02:00",
"anti_lookahead_compliant": true } 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
7


## Page 8

Si une feature semble utiliser des données post-cutoff, le monitor doit 
refuser de déclencher GO.
---
# 8. Fonctions MCP recommandées pour le monitor
## 8.1 Fonctions de lecture
| Fonction | Rôle |
|---|---|
| `get_monitor_context_bundle` | Récupérer tout le contexte monitor |
| `get_active_thesis` | Récupérer la thèse active |
| `get_latest_master_analysis` | Récupérer le Master de référence |
| `get_latest_hourly_monitor` | Récupérer le dernier monitor |
| `get_active_position` | Récupérer position active |
| `get_condition_status` | Conditions GO/invalidation |
| Bundle monitor / snapshots pack | Contexte cross-asset DXY/VIX/taux/gold/oil déjà scellé au cutoff |
| `get_level_map` | Niveaux prioritaires |
| `get_technical_events` | Événements techniques récents |
| `get_raw_window` | Audit raw data scoped pack si doute, avec `pack_id`, `pack_build_id` et `as_of_utc` |
## 8.2 Fonctions d’écriture
| Fonction | Rôle |
|---|---|
| `save_hourly_monitor` | Sauvegarder résultat horaire |
| `update_active_thesis` | Mettre à jour statut / score / scénario |
| `save_monitor_alert` | Sauvegarder alerte |
| `save_monitor_context_transmission` | Transmettre contexte au prochain 
monitor |
| `update_position_management` | Gestion position |
| `archive_active_thesis` | Archiver thèse terminée |
---
# 9. Objet d’entrée recommandé : `monitor_context_bundle`
Le MCP doit idéalement fournir un bundle unique :
```json id="qcb59i"
{
  "bundle_id": "YYYY-MM-DD_HHMM_monitor_bundle",
  "timestamp_paris": "YYYY-MM-DDTHH:MM:SS+02:00",
  "session": "asia_open | london_session | ny_open | work_forward",
  "mode": "live | replay | backforward | paper",
  "master_analysis": {},
  "active_thesis": {},
  "previous_monitor": {},
  "latest_decision": {},
8


## Page 9

"active_position": {},
  "rolling_1h_snapshot": {},
  "rolling_4h_snapshot": {},
  "session_context": {},
  "macro_horizon": {},
  "level_map": {},
  "technical_events": [],
  "level_test_events": [],
  "cross_asset_delta": {},
  "condition_status": {},
  "data_quality": {},
  "raw_data_refs": {}
}
10. États de la thèse active
Le monitor doit maintenir une machine à états.
État Signification
NO_ACTIVE_THESIS Aucune thèse disponible
THESIS_ACTIVE Thèse valide
THESIS_UNTESTED Thèse non encore testée
THESIS_CONFIRMED Le marché confirme la thèse
THESIS_WEAKENED Thèse fragilisée
THESIS_AT_RISK Thèse proche invalidation
SETUP_CANDIDATE Setup identifié
SETUP_ARMED Setup proche d’activation
SETUP_TRIGGERED Conditions GO validées
ORDER_ACTIVE Ordre conditionnel actif
POSITION_ACTIVE Position ouverte
POSITION_PROTECTEDStop BE ou risque réduit
THESIS_INVALIDATEDThèse annulée
SCENARIO_TRANSFORMEDScénario remplacé par un autre
REPLAN_REQUIRED Replan complet nécessaire
EXPIRED Setup expiré
9


## Page 10

11. Décisions monitor autorisées
Décision Sens
MAINTAIN_THESIS La thèse tient
WAIT_MORE Conditions incomplètes
ARM_SETUP Setup proche du GO
TRIGGER_GO Conditions d’entrée validées
CANCEL_SETUP Setup annulé
WEAKEN_THESIS Thèse fragilisée
MARK_AT_RISK Thèse proche invalidation
INVALIDATE_THESISThèse invalidée
TRANSFORM_SCENARIOPasser au scénario alternatif
REDUCE_RISK Réduire exposition
MOVE_STOP_BE Passer stop à break-even
TAKE_PARTIAL Prendre partiel
EXIT_POSITION Sortir
REPLAN_FULL Refaire Master Analysis
EXPIRE_SETUP Setup trop ancien ou timing dépassé
NO_ACTION Rien à faire
12. Structure obligatoire du rapport monitor
Chaque monitor doit produire ces sections :
Cadre du monitor
Contexte maître récupéré
Dernier monitor récupéré
Snapshot marché 1h / 4h
Data quality check
Attendu vs réalisé
Macro update
Cross-asset delta
Technical delta
Macro-Technical causality check
Conditions WAIT → GO
Invalidations
Signaux faibles
1. 
2. 
3. 
4. 
5. 
6. 
7. 
8. 
9. 
10. 
11. 
12. 
13. 
10


## Page 11

Transformation de scénario
Time decay / expiry
Position-aware check
Thesis Health Score
Décision monitor
Mise à jour active thesis
Alerte éventuelle
Context transmission
Décision exécutable
Règle finale
13. Step 1 — Cadre du monitor
Objectif
Définir le contexte du check horaire.
Questions obligatoires
Quelle heure est-il ?
Quelle session est surveillée ?
Quel est le mode ?
Quelle thèse est active ?
Quel Master sert de référence ?
Quel était le dernier monitor ?
Le monitor peut-il prendre une décision fiable ?
Y a-t-il une position active ?
Sortie attendue
Élément Réponse
Timestamp YYYY-MM-DDTHH:MM:SS+02:00
Session Asia / London / NY / Work-forward
Mode live / replay / back-forward / paper
Master lié analysis_id
Thèse active thesis_id
Dernier monitormonitor_id
Position active oui / non
Décision possibleoui / non / conditionnelle
14. 
15. 
16. 
17. 
18. 
19. 
20. 
21. 
22. 
23. 
• 
• 
• 
• 
• 
• 
• 
• 
11


## Page 12

14. Step 2 — Charger le contexte maître
Objectif
Ne jamais repartir de zéro.
Actions
Le monitor charge :
Master Analysis ;
active thesis ;
expected path ;
failure path ;
trigger map ;
invalidation map ;
level watchlist ;
scenario transformation map ;
monitoring priority ;
monitoring playbook ;
thesis health baseline.
Questions
Quelle thèse dois-je surveiller ?
Quel niveau est prioritaire ?
Quelle réaction était attendue ?
Qu’est-ce qui valide ?
Qu’est-ce qui invalide ?
Quelle transformation est prévue si le scénario échoue ?
Sortie attendue
Élément Réponse
Thèse active ...
Instrument ...
Direction ...
Niveau prioritaire...
Conditions GO ...
Invalidations ...
Scénario alternatif...
Score initial ...
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
12


## Page 13

15. Step 3 — Charger le dernier monitor
Objectif
Comprendre l’évolution progressive.
Questions
Quel était le dernier statut de la thèse ?
Le score montait-il ou baissait-il ?
Quels signaux faibles avaient été détectés ?
Un niveau avait-il déjà été testé ?
Le setup était-il armé ?
Une position était-elle active ?
Quelle était la prochaine priorité ?
Sortie attendue
Élément Dernier monitor
Statut thèse ...
Score précédent ...
Décision précédente...
Signaux faibles ...
Focus précédent ...
Alerte précédente...
16. Step 4 — Charger le snapshot marché
Objectif
Voir ce qui a changé depuis le dernier check.
Données
rolling 1h ;
rolling 4h ;
session context ;
macro horizon ;
technical events ;
level test events ;
contexte cross-asset issu des snapshots/packs immuables ;
condition status.
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
13


## Page 14

Sortie attendue
Bloc Changement observé
Prix ...
Niveaux ...
DXY ...
VIX ...
Taux ...
Gold/Oil ...
Mega caps...
Macro ...
17. Step 5 — Data quality check
Objectif
Savoir si le monitor peut prendre une décision fiable.
Hard checks
Check Action si échec
Master absent REPLAN_FULL ou NO_ACTIVE_THESIS
Active thesis absente NO_ACTIVE_THESIS
Snapshot absent NO_ACTION + alerte data
Données critiques incohérentesREPLAN_FULL
Indicateurs critiques nuls Pas de GO
Macro J/J+1 actual contaminé Pas de GO
Raw refs absents sur feature critiquePas de GO si doute critique
Sortie attendue
Donnée Statut Impact
14


## Page 15

18. Step 6 — Comparer attendu vs réalisé
Objectif
Mesurer si le marché suit le chemin prévu par le Master .
Questions
Le prix a-t-il fait ce que le Master attendait ?
Le niveau clé a-t-il été testé ?
La réaction attendue a-t-elle eu lieu ?
La cassure a-t-elle été acceptée ?
Le rejet a-t-il donné du follow-through ?
Le cross-asset a-t-il confirmé ?
La macro a-t-elle aidé ou contredit ?
Le marché respecte-t-il l’expected path ?
Le marché commence-t-il à suivre le failure path ?
Sortie attendue
Élément Attendu Réalisé Verdict
Prix ... ... confirme / fragilise / invalide
Niveau ... ... tenu / cassé / non testé
DXY ... ... confirme / contredit
VIX ... ... confirme / contredit
Taux ... ... confirme / contredit
Mega caps... ... confirme / contredit
Macro ... ... neutre / confirme / bloque
19. Step 7 — Macro update
Objectif
Vérifier si le contexte macro a changé depuis le Master .
Questions
Un event a-t-il eu lieu depuis le dernier check ?
Le mouvement récent coïncide-t-il avec un event ?
Un event approche-t-il dans les 2 prochaines heures ?
Le marché est-il en pré-event ?
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
15


## Page 16

Le marché est-il en post-event ?
Y a-t-il un discours/headline qui change le régime ?
Le macro autorise-t-il encore l’exécution ?
Faut-il un replan complet après event ?
Sortie attendue
Event Timing Impact potentielAction
Décisions possibles
Situation Décision
Event majeur dans 30 minPas de GO
Event majeur dans 2h Taille réduite / prudence
Event vient de tomberReplan partiel ou complet
Headline de rupture Replan complet
Macro inchangée Continuer check
20. Step 8 — Cross-asset delta
Objectif
Vérifier si DXY, taux, VIX, or , pétrole, indices et mega caps confirment encore la thèse.
Questions
DXY a-t-il changé de régime ?
VIX spike-t-il ou reste-t-il comprimé ?
US10Y/US02Y exercent-ils une pression ?
Gold signale-t-il stress ou hedge ?
Oil change-t-il le régime inflation/géopolitique ?
Les indices Europe/Asie confirment-ils ?
Mega caps/semis soutiennent-ils le Nasdaq ?
Le cross-asset est-il en delta favorable ou défavorable depuis le dernier check ?
Sortie attendue
Asset Attendu par la thèseMaintenantImpact
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
16


## Page 17

Classification
Impact Signification
Confirme Renforce la thèse
Neutre Pas de changement
Fragilise Réduit la confiance
Invalide Casse la thèse
TransformeActive scénario alternatif
21. Step 9 — Technical delta
Objectif
Analyser les changements techniques depuis le dernier monitor .
Questions
Le prix a-t-il testé un niveau de la watchlist ?
Le niveau a-t-il tenu ?
Le prix a-t-il cassé ?
La cassure a-t-elle été acceptée ?
Y a-t-il eu sweep + reclaim ?
Y a-t-il eu fakeout ?
La structure M15 a-t-elle changé ?
La structure M5 confirme-t-elle le trigger ?
Le prix est-il trop loin de l’entry ?
Le RR reste-t-il valable ?
Un niveau secondaire est-il devenu prioritaire ?
Sortie attendue
InstrumentNiveau MouvementLecture Déduction
22. Step 10 — Macro-Technical causality check
Objectif
Relier les mouvements techniques au contexte macro/cross-asset.
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
17


## Page 18

Questions
Le breakout est-il appuyé par DXY/VIX/taux ?
Le rejet est-il confirmé par risk-off ?
Le sweep est-il un stop hunt isolé ou un reversal macro ?
Le fakeout est-il cohérent avec une divergence cross-asset ?
Le mouvement est-il purement technique ?
S’il est purement technique, faut-il réduire la confiance ?
Y a-t-il un catalyst identifié ?
Y a-t-il absence de catalyst ?
Sortie attendue
Heure MouvementNiveau Contexte macroCross-assetConclusion
Formulations autorisées
Niveau de certitudeFormulation
Catalyst identifié “Le mouvement intervient après…”
Cross-asset confirmé“Le flux est cohérent avec…”
Corrélation probable“Le mouvement semble cohérent avec…”
Cause non prouvée“Aucun catalyst clair identifié ; confiance réduite.”
23. Step 11 — Vérifier les conditions WAIT → GO
Objectif
Savoir si une thèse conditionnelle devient exécutable.
Process
Le monitor prend chaque condition GO du Master et la classe :
validée ;
non validée ;
échouée ;
invalide ;
non observable.
Sortie attendue
Condition GOStatut Preuve Impact
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
18


## Page 19

Décision
Résultat Action
Toutes conditions GO validées TRIGGER_GO
Conditions majeures presque validéesARM_SETUP
Conditions partielles WAIT_MORE
Condition clé échouée CANCEL_SETUP ou WEAKEN_THESIS
24. Step 12 — Vérifier les invalidations
Objectif
Annuler rapidement les thèses qui ne tiennent plus.
Process
Le monitor prend chaque invalidation du Master et vérifie si elle est déclenchée.
Sortie attendue
InvalidationStatut Preuve Action
Décision
Résultat Action
Invalidation majeure validéeINVALIDATE_THESIS
Invalidation partielle MARK_AT_RISK
Plusieurs fragilités WEAKEN_THESIS
Invalidation + scénario alternatifTRANSFORM_SCENARIO
Invalidation de régime REPLAN_FULL
25. Step 13 — Détection des signaux faibles
Objectif
Être proactif avant l’invalidation.
19


## Page 20

Signaux faibles à détecter
Signal faible Interprétation
DXY approche résistance invalidanteLong NQ fragilisé
VIX ne baisse plus Risk-on perd force
US10Y accélère Pression sur NQ
Mega caps divergent NQ suspect
Rejets sur résistance deviennent plus fortsBreakout moins probable
Pullback trop profond Continuation fragilisée
Range se contracte avant event Attendre
Volume/range s’éteint Setup perd edge
Plusieurs closes M5 contre thèse Fragilité micro
M15 perd creux/sommet clé Structure compromise
Sortie attendue
Signal faiblePreuve Impact Action
26. Step 14 — Scenario transformation check
Objectif
Transformer intelligemment un scénario quand le marché change.
Questions
Le breakout long a-t-il échoué ?
Cela devient-il un fakeout short ?
Le support long a-t-il cassé ?
Cela devient-il un breakdown short ?
Le short rejection a-t-il échoué ?
Cela devient-il un breakout long ?
Le range a-t-il cassé et accepté ?
Cela devient-il une continuation ?
Le Master avait-il prévu cette transformation ?
Faut-il replan complet ou transformation contrôlée ?
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
20


## Page 21

Sortie attendue
Scénario initialÉvénementNouveau scénarioStatut
Décisions possibles
TRANSFORM_SCENARIO
REPLAN_FULL
WAIT_MORE
CANCEL_SETUP
27. Step 15 — Time decay / expiry check
Objectif
Vérifier si le setup est encore valide dans le temps.
Questions
Le setup avait-il une heure d’expiration ?
La fenêtre d’exécution est-elle dépassée ?
Un event approche-t-il ?
La session a-t-elle changé de phase ?
Le niveau n’a-t-il jamais été testé ?
Le setup perd-il sa pertinence ?
L’expected path n’a-t-il pas pris trop de retard ?
Sortie attendue
Élément temporelStatut Action
Décisions
Situation Action
Setup expiré EXPIRE_SETUP
Event proche WAIT_MORE ou GESTION_SEULE
Session change Revalidation
Timing encore valideContinuer monitoring
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
21


## Page 22

28. Step 16 — Position-aware check
Objectif
Si une position existe, gérer le risque.
Questions
Position active ou non ?
Entry, stop, TP ?
Prix actuel en R ?
Position à +0.6R / +0.7R ?
TP1 proche ?
TP1 touché ?
Thèse toujours valide ?
Cross-asset confirme encore ?
Event proche ?
Niveau structurel cassé contre position ?
Le stop doit-il être déplacé ?
Faut-il réduire ?
Faut-il sortir ?
Sortie attendue
Élément Statut Action
Règles de gestion
Situation Action
+0.6R / +0.7R et contexte fragileMOVE_STOP_BE
TP1 touché TAKE_PARTIAL + BE
Event majeur proche REDUCE_RISK ou EXIT_POSITION
Thèse macro invalidée EXIT_POSITION
Niveau structurel cassé EXIT_POSITION
Cross-asset contraire violentREDUCE_RISK
Extension favorable Maintenir avec trailing
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
22


## Page 23

29. Step 17 — Thesis Health Score
Objectif
Quantifier la santé de la thèse et sa variation.
Score initial
Le monitor part du thesis_health_baseline du Master ou du score du dernier monitor .
Ajustements possibles
Élément Impact
Niveau clé tenu proprement+10 à +15
Breakout accepté +15
Retest tenu +15
DXY confirme +10
VIX confirme +10
Taux confirment +5 à +10
Mega caps confirment +10 à +15
Condition GO validée +10
Prix non testé 0
Cross-asset neutre 0
DXY contre thèse -10 à -20
VIX contre thèse -10 à -25
Niveau fragilisé -10
Fakeout contre thèse -20
Invalidation partielle -20 à -30
Event proche -15 à -25
Invalidation majeure Score < 40
Interprétation
Score État
85–100 Thèse confirmée
70–84 Thèse valide
23


## Page 24

Score État
55–69 Thèse fragilisée
40–54 Thèse très fragile
<40 Thèse invalidée / replan
Sortie attendue
Score précédentScore actuelVariation Raison
30. Step 18 — Décision monitor
Objectif
Produire une action claire.
Format attendu
Élément Verdict
Thèse confirmée / valide / fragilisée / invalidée
Setup actif / armé / annulé / expiré
Position aucune / maintenir / réduire / sortir
Décision décision monitor
Alerte oui / non
Prochain focusquoi surveiller
Prochain checkheure
Décisions possibles
MAINTAIN_THESIS
WAIT_MORE
ARM_SETUP
TRIGGER_GO
CANCEL_SETUP
WEAKEN_THESIS
MARK_AT_RISK
INVALIDATE_THESIS
TRANSFORM_SCENARIO
REDUCE_RISK
MOVE_STOP_BE
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
24


## Page 25

TAKE_PARTIAL
EXIT_POSITION
REPLAN_FULL
EXPIRE_SETUP
NO_ACTION
31. Step 19 — Mise à jour de la thèse active
Objectif
Mettre à jour l’état de la thèse pour le prochain monitor .
Champs à mettre à jour
Champ Exemple
thesis_status THESIS_ACTIVE / THESIS_WEAKENED / INVALIDATED
health_score 72
confidence_pct 68
dominant_scenario ...
secondary_scenario...
active_setup_id ...
next_focus ...
next_revalidation_time...
invalidation_status ...
wait_to_go_status ...
last_monitor_id ...
32. Step 20 — Alerting
Objectif
Alerter uniquement quand une action est nécessaire.
Niveaux d’alerte
Niveau Signification Exemple
Info Pas d’action Thèse maintenue
• 
• 
• 
• 
• 
25


## Page 26

Niveau Signification Exemple
Watch Surveillance DXY proche niveau invalidant
Warning Fragilité Thèse affaiblie
Action Action requisePasser BE / annuler setup
Critical Urgent Sortir / replan complet
Décisions qui déclenchent une alerte
Décision Alerte
TRIGGER_GO Action
ARM_SETUP Watch / Action
WEAKEN_THESIS Warning
MARK_AT_RISK Warning
INVALIDATE_THESISAction
TRANSFORM_SCENARIOWarning / Action
REDUCE_RISK Action
MOVE_STOP_BE Action
TAKE_PARTIAL Action
EXIT_POSITION Critical
REPLAN_FULL Critical
Format alerte
```json id="uw8xb2" { "alert_payload": { "alert_required": true, "alert_level": "warning | action | critical",
"title": "MNQ thesis weakened", "message": "...", "instrument": "MNQ", "decision": "WEAKEN_THESIS",
"action_required": "Do not trigger; watch DXY/VIX and MNQ 30080", "timestamp_paris": "..." } } 
---
# 33. Step 21 — Context transmission vers le prochain monitor
## Objectif
Préparer le prochain check.
## Sortie attendue
```json id="krto0n"
{
26


## Page 27

"monitor_context_transmission": {
    "timestamp_paris": "...",
    "current_thesis_status": "...",
    "health_score": 0,
    "score_delta": 0,
    "dominant_scenario": "...",
    "secondary_scenario": "...",
    "validated_elements": [],
    "weakened_elements": [],
    "invalidated_elements": [],
    "levels_to_watch_next": [],
    "cross_asset_to_watch_next": [],
    "macro_risks_next": [],
    "next_wait_to_go_conditions": [],
    "next_invalidation_conditions": [],
    "next_monitoring_focus": "...",
    "next_revalidation_time": "..."
  }
}
34. Règles de décision principales
34.1 Maintenir la thèse
Décision : MAINTAIN_THESIS
Conditions :
aucune invalidation déclenchée ;
niveau clé non cassé ;
cross-asset stable ou favorable ;
macro inchangée ;
score stable ou en légère hausse ;
pas de position nécessitant action.
34.2 Attendre davantage
Décision : WAIT_MORE
Conditions :
thèse encore valide ;
conditions GO non complètes ;
prix trop loin de l’entrée ;
RR insuffisant au prix actuel ;
event trop proche ;
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
27


## Page 28

niveau pas encore testé.
34.3 Armer le setup
Décision : ARM_SETUP
Conditions :
majorité des conditions GO validées ;
niveau clé testé proprement ;
cross-asset favorable ;
RR potentiellement ≥ 2 ;
timing encore valide ;
pas de hard gate.
34.4 Déclencher GO
Décision : TRIGGER_GO
Conditions obligatoires :
toutes les conditions GO validées ;
aucune invalidation active ;
macro autorise l’entrée ;
cross-asset confirme ou ne contredit pas ;
niveau pondéré validé ;
trigger M5/M15 validé ;
RR ≥ 2 ;
stop logique ;
TP logique ;
fenêtre verte ou jaune ;
pas d’event rouge imminent.
34.5 Fragiliser la thèse
Décision : WEAKEN_THESIS
Conditions :
signaux faibles contre la thèse ;
DXY/VIX/taux deviennent moins favorables ;
niveau clé tient mais moins proprement ;
structure M15 perd de la qualité ;
mega caps divergent ;
score baisse sous 70 mais reste >55.
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
28


## Page 29

34.6 Marquer la thèse à risque
Décision : MARK_AT_RISK
Conditions :
score entre 40 et 55 ;
prix proche invalidation ;
cross-asset devient contraire ;
plusieurs signaux faibles alignés ;
event majeur proche.
34.7 Invalider la thèse
Décision : INVALIDATE_THESIS
Conditions :
invalidation majeure déclenchée ;
niveau clé cassé et accepté contre thèse ;
macro/cross-asset change de régime ;
DXY/VIX/taux invalident le scénario ;
mega caps cassent la thèse NQ ;
score < 40.
34.8 Transformer le scénario
Décision : TRANSFORM_SCENARIO
Conditions :
le scénario initial échoue ;
le Master avait prévu un scénario alternatif ;
le mouvement confirme cette transformation ;
la transformation est validée par macro/cross-asset ou nécessite replan partiel.
Exemples :
Initial Échec Transformation
Long breakoutRéintégration sous résistanceFakeout short
Long pullbackSupport cassé Breakdown short
Short rejectionReclaim résistance Breakout long
Range Acceptation hors range Trend continuation
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
29


## Page 30

34.9 Demander un replan complet
Décision : REPLAN_FULL
Conditions :
event macro majeur publié ;
régime cross-asset change ;
scénario dominant invalidé ;
scénario alternatif non préparé ;
niveau H4 cassé ;
données incohérentes ;
plusieurs monitors consécutifs contradictoires ;
active thesis obsolète ;
position active mais thèse d’origine invalide.
35. Gestion des positions
Le monitor doit toujours vérifier s’il existe une position active.
35.1 Si aucune position
Le monitor décide :
maintenir ;
attendre ;
armer ;
déclencher ;
annuler ;
replan.
35.2 Si ordre conditionnel actif
Le monitor décide :
garder l’ordre ;
modifier l’ordre ;
annuler l’ordre ;
replan.
35.3 Si position active
Le monitor décide :
maintenir ;
réduire ;
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
30


## Page 31

BE ;
partiel ;
sortir ;
replan.
35.4 Règles position
Situation Action
+0.6R / +0.7R et contexte fragileBE
TP1 touché Partiel + BE
Event dans 30 min Réduire ou sortir
Thèse invalidée Sortir
Niveau structurel cassé Sortir
Cross-asset contraire violentRéduire / sortir
Extension favorable Maintenir avec trailing
36. Structure JSON complète du monitor
```json id="fhxyou" { "schema_version": "1.0.0", "contract_name": "DeskHourlyThesisMonitorContract",
"monitor_id": "...", "timestamp_paris": "YYYY-MM-DDTHH:MM:SS+02:00", "session": "asia_open |
london_session | ny_open | work_forward", "mode": "live | replay | backforward | paper",
"linked_master_analysis_id": "...", "linked_active_thesis_id": "...", "linked_previous_monitor_id": "...",
"linked_decision_id": "...", "instrument_scope": ["MNQ", "MES", "NQ", "ES"], "data_quality": {},
"master_context_summary": {}, "previous_monitor_summary": {}, "active_thesis_before": {},
"rolling_1h_snapshot_summary": {}, "rolling_4h_snapshot_summary": {}, "session_context_summary": {},
"macro_horizon": {}, "expected_vs_realized": [], "macro_update": {}, "cross_asset_delta": {},
"technical_delta": {}, "macro_technical_causality": [], "wait_to_go_check": [], "invalidation_check": [],
"weak_signals": [], "scenario_transformation_check": {}, "time_decay_check": {}, "position_check": {},
"thesis_health_score": { "previous_score": 0, "current_score": 0, "delta": 0, "state": "...",
"score_drivers_positive": [], "score_drivers_negative": [] }, "monitor_decision": { "decision":
"MAINTAIN_THESIS | WAIT_MORE | ARM_SETUP | TRIGGER_GO | CANCEL_SETUP | WEAKEN_THESIS |
MARK_AT_RISK | INVALIDATE_THESIS | TRANSFORM_SCENARIO | REDUCE_RISK | MOVE_STOP_BE |
TAKE_PARTIAL | EXIT_POSITION | REPLAN_FULL | EXPIRE_SETUP | NO_ACTION", "thesis_status_after":
"...", "action_required": true, "alert_level": "info | watch | warning | action | critical", "reason_summary":
"...", "detailed_reason": "...", "next_action": "...", "next_monitoring_focus": "...", "next_revalidation_time":
"..." }, "active_thesis_update": {}, "alert_payload": {}, "monitor_context_transmission": {}, "final_sections":
{ "decision_executable": "...", "regle_finale": "..." } } 
---
# 37. Format minimal d’une décision monitor
```json id="i1hvv9"
• 
• 
• 
• 
31


## Page 32

{
  "monitor_decision": {
    "decision": "WEAKEN_THESIS",
    "thesis_status_after": "THESIS_WEAKENED",
    "action_required": true,
    "alert_level": "warning",
    "reason_summary": "La thèse long MNQ reste possible mais se fragilise : 
DXY remonte vers résistance, VIX ne baisse plus et MNQ n'a pas confirmé le 
retest.",
    "detailed_reason": "Le Master attendait un retest tenu au-dessus de 
30080-30120 avec DXY stable et VIX comprimé. Le prix reste au-dessus de la 
zone mais le cross-asset devient moins favorable. Pas de GO. La priorité est 
de surveiller une réintégration sous 30080 ou un regain de confirmation DXY/
VIX.",
    "next_action": "Ne pas déclencher. Surveiller DXY/VIX et clôture M15 sur 
zone.",
    "next_monitoring_focus": "Zone MNQ 30080-30120, DXY résistance H1, VIX 
compression",
    "next_revalidation_time": "YYYY-MM-DDTHH:MM:SS+02:00"
  }
}
38. Sauvegarde obligatoire
Chaque monitor doit sauvegarder :
le monitor result ;
la mise à jour de la thèse active ;
l’alerte éventuelle ;
le bloc de transmission au prochain monitor .
Collections recommandées
```text id="wbk6e0" desk_hourly_monitors/
desk_active_theses/
desk_alerts/
desk_monitor_context_transmissions/ {context_id} 
---
# 39. Exemple de sortie conforme
```text id="wcvdq5"
Thèse précédente :
1. 
2. 
3. 
4. 
32


## Page 33

MNQ long conditionnel sur cassure/retest de 30080–30120.
Attendu :
M15 devait accepter au-dessus de 30120, DXY rester stable/faible, VIX rester 
comprimé, mega caps soutenir.
Réalisé :
MNQ a cassé 30120 mais n’a pas encore retesté proprement. DXY reste stable, 
VIX comprimé, mega caps neutres. Pas d’invalidation.
Déduction :
La thèse long reste valide mais pas encore déclenchable. Le breakout sans 
retest ne donne pas un RR propre. Le setup passe de THESIS_ACTIVE à 
SETUP_CANDIDATE.
Décision monitor :
ARM_SETUP uniquement si retest 30080–30120 tient et RR ≥ 2. Pas de GO 
immédiat.
Décision exécutable :
WAIT_MORE / ARM_SETUP conditionnel.
Règle finale :
Pas d’entrée sans retest tenu et confirmation DXY/VIX.
40. Exemple de sortie non conforme
text id="rsbqw8"
MNQ est fort. On garde le plan.
Non conforme, car :
pas de comparaison attendu vs réalisé ;
pas de DXY/VIX/taux ;
pas de niveaux ;
pas de conditions GO ;
pas d’invalidation ;
pas de score ;
pas de décision actionnable.
41. Checklist finale du monitor
Avant de finaliser , le monitor doit vérifier :
• 
• 
• 
• 
• 
• 
• 
33


## Page 34

Question Oui/Non
Master chargé ?
Thèse active chargée ?
Dernier monitor chargé ?
Snapshot 1h chargé ?
Snapshot 4h chargé ?
Data quality vérifiée ?
Attendu vs réalisé comparé ?
Macro vérifié ?
DXY/VIX/taux vérifiés ?
Gold/oil vérifiés ?
Mega caps/semis vérifiés ?
Niveaux clés vérifiés ?
Mouvements techniques récents analysés ?
Technique reliée au macro ?
WAIT → GO testé ?
Invalidations testées ?
Signaux faibles détectés ?
Transformation de scénario vérifiée ?
Time decay vérifié ?
Position active vérifiée ?
Thesis health score mis à jour ?
Décision claire produite ?
Contexte prochain monitor préparé ?
42. Décision exécutable
Le DeskHourlyThesisMonitorContract v1.0.0 définit le monitor comme un contrôleur dynamique de
thèse.
Le monitor ne refait pas le Master .
34


## Page 35

Il récupère :
le Master ;
la thèse active ;
le dernier monitor ;
le snapshot marché 1h ;
le snapshot marché 4h ;
le contexte de session ;
le macro horizon ;
les conditions GO ;
les invalidations ;
les deltas cross-asset ;
les événements techniques ;
la position active si disponible.
Il compare ce qui était attendu avec ce que le marché a réellement fait.
Il met à jour la santé de la thèse, teste les conditions GO, teste les invalidations, détecte les signaux
faibles, gère les positions éventuelles et décide clairement :
maintenir ;
attendre ;
armer ;
déclencher ;
annuler ;
fragiliser ;
invalider ;
transformer ;
réduire ;
protéger ;
sortir ;
replanifier .
43. Règle finale
Le monitor ne doit jamais être un commentaire horaire.
Il doit être un système de contrôle vivant.
Il suit la chaîne :
Master Analysis → Active Thesis → Expected Path → Market Delta → Thesis Health Score →
Decision Monitor → Updated Thesis → Next Monitor.
Une thèse qui n’est pas suivie, challengée et mise à jour n’est pas une thèse de desk.
C’est seulement une opinion figée.
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
• 
35
