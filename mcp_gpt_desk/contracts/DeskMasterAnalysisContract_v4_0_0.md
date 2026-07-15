# DeskMasterAnalysisContract v4.0.0


## Page 1

DeskMasterAnalysisContract v4.0.0 — FINAL
Master Playbook — Opportunity-First, Macro-Technical, Monitor-
Ready
Version : 4.0.0
Statut : final validé
Timezone par défaut : Europe/Paris
Univers principal : Futures US — MNQ, NQ, MES, ES
Rôle : construire la thèse maître de la session et transmettre un playbook vivant au monitor
Modes supportés : live, replay, back-forward strict, paper
Principe central : macro → cross-asset → régime → technique → niveaux → hypothèses → élimination
→ setup → thèse active → transmission monitor 
1. Mission du Master Analysis
Le Master Analysis n’est pas un simple rapport journalier .
Il est le document stratégique de référence qui construit la thèse principale du desk pour une session
donnée.
Son rôle est de transformer les données disponibles en un playbook vivant, exploitable ensuite par le
monitor horaire.
Le Master doit répondre à la question suivante :
Quelle est la meilleure thèse de marché maintenant, comment doit-elle se comporter si
elle est correcte, comment doit-elle être invalidée, et que doit surveiller le monitor
ensuite ?
Le Master doit produire :
un cadre de décision ;
une continuité avec l’analyse précédente ;
un verrouillage du temps ;
une lecture macro ;
une lecture cross-asset ;
une attribution macro-technique des mouvements ;
une sélection d’actif ;
une analyse technique multi-timeframe ;
une extraction et pondération des niveaux ;
une lecture des réactions du prix ;
une estimation cassure vs rejet ;
des hypothèses concurrentes ;
des scénarios éliminés ;
des setups candidats ;
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
1


## Page 2

une décision finale ;
une thèse active ;
un expected path ;
un failure path ;
une trigger map ;
une invalidation map ;
une scenario transformation map ;
une monitoring priority ;
un monitoring playbook ;
un thesis health baseline ;
un context transmission ;
une session matrix ;
un résumé exécutable des fenêtres autorisées ;
un agenda de mise à jour ;
une décision exécutable ;
une règle finale.
2. Différence entre Master Analysis et Monitor
Élément Master Analysis Hourly Monitor
Rôle Construire la thèse Contrôler la thèse
Fréquence Début de session / replan completHoraire
Profondeur Analyse complète Suivi ciblé
Point de départMarché global Thèse active
Données Pack + contexte + features Master + dernier monitor + snapshot 1h/4h
Sortie Playbook vivant Maintien / GO / annulation / replan
Horizon Session entière Dernière heure + 4h + contexte session
Fonction Stratégie Supervision dynamique
Le Master construit le plan.
Le monitor vérifie si le marché respecte le plan.
3. Philosophie du Master
Le Master ne doit jamais partir d’un trade.
Il ne doit jamais dire :
Je veux vendre le Nasdaq, cherchons les confirmations.
15. 
16. 
17. 
18. 
19. 
20. 
21. 
22. 
23. 
24. 
25. 
26. 
27. 
28. 
29. 
30. 
2


## Page 3

Il doit dire :
Quel est le régime global ? Quelle est la lecture macro ? Quels flux cross-asset dominent ?
Quel actif exprime le mieux ce régime ? Quels niveaux sont décisionnels ? Quelle
hypothèse survit après challenge ? Quel setup offre le meilleur rapport risque/
rendement ?
Le trade final doit être la conséquence logique de l’entonnoir .
Le Master doit suivre ce raisonnement :
lecture → analyse → challenge → déduction → hypothèses → élimination → conclusion → setup
→ décision → transmission monitor
4. Règles non négociables
Le fondamental prime sur la technique.
La technique sert à exécuter une thèse macro/cross-asset, pas à inventer un biais.
Le desk verrouille d’abord le temps.
Le desk identifie ensuite le régime global.
Le desk choisit ensuite l’actif qui exprime le mieux ce régime.
Le desk identifie ensuite les niveaux décisionnels.
Le desk construit ensuite les setups.
Une contradiction ne donne pas automatiquement WAIT.
Une contradiction doit être analysée, hiérarchisée et challengée.
Le WAIT doit être prouvé autant qu’un trade.
Chaque niveau important doit être lu, analysé, challengé, pondéré et relié au contexte macro.
Chaque cassure, rejet, sweep, reclaim, breakout ou breakdown doit être relié au contexte macro/
cross-asset ou signalé comme non expliqué.
Le Master doit produire au minimum :
bull case ;
bear case ;
range case ;
best long candidate ;
best short candidate ;
WAIT proof.
Le Master doit produire une thèse active même si la décision finale est WAIT.
Une thèse active peut être :
directionnelle ;
conditionnelle ;
neutre ;
WAIT surveillé ;
post-event only.
Aucun trade ne peut être validé sans :
zone d’entrée ;
trigger ;
stop ;
TP ;
RR minimum de 2 ;
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
◦ 
◦ 
◦ 
◦ 
◦ 
◦ 
14. 
15. 
◦ 
◦ 
◦ 
◦ 
◦ 
16. 
◦ 
◦ 
◦ 
◦ 
◦ 
3


## Page 4

invalidation ;
fenêtre horaire autorisée.
Le Master doit créer un bloc active_thesis.
Le Master doit créer un bloc expected_path.
Le Master doit créer un bloc failure_path.
Le Master doit créer un bloc scenario_transformation_map.
Le Master doit créer un bloc monitoring_playbook.
Le Master doit créer un bloc context_transmission.
Le Master doit finir par :
Décision exécutable ;
Règle finale.
5. Modes du Master
5.1 Mode live
Le Master utilise les données réellement disponibles au moment de l’analyse.
Il peut intégrer :
prix live ;
calendrier macro ;
news digest ;
cross-assets ;
niveaux intraday ;
position active ;
contexte de session ;
derniers monitors ;
thèse active précédente si disponible.
5.2 Mode back-forward strict
Le Master se place à un cutoff historique précis.
Il ne peut pas utiliser :
actual J non encore disponible ;
actual J+1 ;
prix après cutoff ;
informations postérieures au cutoff ;
interprétation rétrospective.
Le rapport doit rappeler :
date ;
heure ;
timezone ;
cutoff ;
◦ 
◦ 
17. 
18. 
19. 
20. 
21. 
22. 
23. 
◦ 
◦ 
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
4


## Page 5

données autorisées ;
données interdites ;
règle de non-contamination.
5.3 Mode replay
Le Master analyse un pack historique au cutoff du pack.
Les règles anti-lookahead sont identiques au back-forward strict.
5.4 Mode paper
Le Master produit une thèse exploitable, mais sans exécution réelle.
6. Politique anti-lookahead
6.1 Règle générale
En back-forward et replay, le Master doit agir comme s’il était réellement au cutoff.
6.2 Autorisé pour J et J+1
Pour les annonces de J et J+1, le Master peut utiliser :
date ;
heure ;
event ;
devise ;
impact ;
previous ;
forecast ;
assets concernés.
6.3 Interdit pour J et J+1
Pour J et J+1, le Master ne doit jamais utiliser :
actual ;
surprise ;
interprétation post-publication ;
réaction de marché postérieure au cutoff ;
prix postérieurs au cutoff.
6.4 Cas J-1
Les actuals J-1 peuvent être utilisées uniquement si elles étaient publiées avant le cutoff.
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
5


## Page 6

Si la disponibilité n’est pas prouvée, le Master doit signaler l’incertitude.
6.5 Feature Engine et cutoff
Toutes les features backend utilisées dans un Master back-forward doivent respecter le cutoff du pack.
Chaque feature doit idéalement contenir :
{
"computed_with_cutoff": "YYYY-MM-DDTHH:MM:SS+02:00",
"anti_lookahead_compliant": true
}
7. Workflow MCP obligatoire du Master
Objectif
Garantir que le Master charge toutes les données nécessaires avant de produire une thèse.
Step Action Objectif
1 get_desk_methodology Charger la méthodologie officielle
2 Lire entièrement la méthodologie Respecter gates, anti-lookahead et
contrats
3 list_available_exports si batch/période Identifier les packs disponibles
4 Filtrer les packs Garder uniquement les packs
conformes
5 get_desk_pack ou 
get_master_analysis_bundle
Récupérer metadata, cutoff, qualité
et contexte
6 get_dataset si nécessaire Lire les datasets bruts ou semi-bruts
7 get_macro_calendar Vérifier J-1, J, J+1
8 get_news_digest si disponible Identifier catalysts/headlines
9 get_level_map ou get_market_levels Récupérer niveaux déterministes
10 get_raw_window si doute Auditer une feature ou un niveau
11 Construire Master Analysis Appliquer ce contrat
12 save_master_analysis Sauvegarder l’analyse complète
13 save_active_thesis Sauvegarder la thèse active
14 save_context_transmission Sauvegarder le contexte transmis
6


## Page 7

Step Action Objectif
15 save_desk_report Sauvegarder le rapport humain
16 save_desk_decision si décision exécutableSauvegarder la décision
8. Données obligatoires
8.1 Futures core
Dataset Utilité
MNQ_M5 Microstructure et triggers MNQ
MES_M5 Microstructure et triggers MES
NQ_M15 Zones d’exécution NQ
ES_M15 Zones d’exécution ES
NQ_H1 Direction de séance NQ
ES_H1 Direction de séance ES
NQ_H4 Régime principal NQ
ES_H4 Régime principal ES
MNQ_H4 Régime micro Nasdaq
MES_H4 Régime micro S&P
8.2 Cross-asset
Dataset Utilité
US10Y_US02Y Pression taux et pricing Fed
US10Y_US02Y_H4Régime taux HTF
DXY_CL_GC_VIX Dollar , pétrole, or , volatilité
DXY_CL_GC_VIX_H4Régime HTF cross-asset
8.3 Indices globaux
Dataset Utilité
indices_asie_europe Transmission risk-on/risk-off
indices_asie_europe_H4Régime global Asie/Europe
7


## Page 8

8.4 Mega caps / semis
Dataset Utilité
ny_close_mega_caps Moteurs de la session US précédente
mega_caps_premarketConfirmation ou divergence des leaders
mega_caps_premarket_H4Régime HTF des leaders tech
8.5 Macro / news
Dataset Utilité
macro_calendarRisque événementiel
news_digest Headlines, Fed, géopolitique, earnings
8.6 Features déterministes recommandées
Feature Utilité
level_map Supports/résistances pondérés bruts
technical_eventsBreakout, rejection, sweep, reclaim, fakeout
session_snapshotHigh/low, VWAP , POC, VAH, VAL
cross_asset_deltaVariation DXY/VIX/taux/gold/oil
condition_statusConditions WAIT→GO et invalidations
raw_data_refs Audit des features
9. Structure obligatoire du rapport Master
Le Master doit suivre cet ordre :
Cadre de décision
Continuité avec analyse précédente
Verrouillage du temps
Calendrier macro et catalysts
Régime global
Macro thesis
Cross-asset map
Macro-Technical Causality Engine
Déductions cross-asset
Choix de l’actif
Relative strength
Technical Price Engine H4
Technical Price Engine H1
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
8


## Page 9

Technical Price Engine M15
Technical Price Engine M5
Extraction des niveaux
Pondération des niveaux
Réactions du prix
Cassure vs rejet
Hypothèses concurrentes
Scénarios éliminés
Setup engineering
Scoring pondéré
Decision gates
WAIT proof si nécessaire
Active thesis
Expected path
Failure path
Scenario transformation map
Level watchlist
Trigger map
Invalidation map
Monitoring priority
Monitoring playbook
Thesis health baseline
Context transmission
Session matrix
Résumé exécutable des fenêtres autorisées
Agenda de mise à jour du desk
Décision exécutable
Règle finale
10. Step 1 — Cadre de décision
Objectif
Définir exactement le contexte de travail.
Questions obligatoires
Quelle est la date ?
Quelle est la session ?
Quel est le cutoff ?
Quel est le mode ?
Le pack est-il ready, draft ou degraded ?
Quelles données sont disponibles ?
Quelles données sont interdites ?
Quelle est la timezone ?
Une décision exécutable est-elle possible ?
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
24. 
25. 
26. 
27. 
28. 
29. 
30. 
31. 
32. 
33. 
34. 
35. 
36. 
37. 
38. 
39. 
40. 
41. 
• 
• 
• 
• 
• 
• 
• 
• 
• 
9


## Page 10

Sortie attendue
Élément Réponse
Date YYYY-MM-DD
Session Asia Open / London / NY Open / Work-forward
Cutoff HH:MM Europe/Paris
Mode live / replay / back-forward / paper
Pack status ready / draft / degraded
Données disponiblesliste
Données interditesliste
Décision possible oui / non / conditionnelle
11. Step 2 — Continuité avec analyse précédente
Objectif
Ne pas repartir à zéro.
Le Master doit récupérer la dernière analyse pertinente si disponible.
Données à récupérer
dernière master analysis ;
dernière décision ;
dernier context transmission ;
thèse active précédente ;
dernier monitor si disponible ;
niveaux clés précédents ;
conditions WAIT → GO précédentes ;
invalidations précédentes.
Questions obligatoires
Quel était le biais précédent ?
Quel scénario dominant était surveillé ?
Quels niveaux étaient prioritaires ?
Qu’est-ce qui devait confirmer la thèse ?
Qu’est-ce qui devait l’invalider ?
Le marché a-t-il validé ou invalidé l’ancien plan ?
Le nouveau Master doit-il conserver , ajuster ou abandonner l’ancien biais ?
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
10


## Page 11

Sortie attendue
Élément Dernière analyseÉvolution observéeConclusion
Biais précédent ... ... conservé / ajusté / invalidé
Scénario dominant ... ... validé / invalidé / non testé
Niveau clé ... ... tenu / cassé / non testé
Cross-asset ... ... confirme / contredit
Nouvelle conséquence... ... ...
12. Step 3 — Verrouillage du temps
Objectif
Déterminer si le desk peut agir maintenant ou seulement préparer un plan.
Questions obligatoires
Y a-t-il un event majeur aujourd’hui ?
À quelle heure ?
Est-il avant ou pendant la fenêtre de trade ?
Le marché est-il en pré-event ?
Le marché est-il en post-event ?
Une entrée est-elle autorisée ?
Faut-il replanifier après un événement ?
Statuts autorisés
Statut Signification
Vert Nouvelles entrées autorisées
Jaune Entrées autorisées en taille réduite uniquement
Orange Gestion / observation seulement
Rouge Aucune nouvelle entrée
Sortie attendue
Jour Heure débutHeure fin Statut Règle desk
Une fenêtre sans heure de début et heure de fin est non conforme.
• 
• 
• 
• 
• 
• 
• 
11


## Page 12

13. Step 4 — Calendrier macro et catalysts
Objectif
Identifier les événements capables d’expliquer , déclencher , invalider ou bloquer les mouvements du
marché.
À analyser
events J-1 ;
events J ;
events J+1 ;
discours Fed/BCE/BoE ;
CPI, PCE, NFP , PMI, GDP , claims, retail sales ;
auctions ;
banques centrales ;
headlines géopolitiques ;
earnings / mega caps si pertinent.
Sortie attendue
Date Heure Event Impact Devise Previous Forecast Rôle dans l’analyse
Conclusion attendue
Le Master doit classer le calendrier :
exploitable ;
bloquant ;
neutre ;
post-event ;
pré-event ;
risque majeur ;
replan obligatoire.
14. Step 5 — Régime global
Objectif
Identifier le type de marché avant de choisir un instrument.
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

Régimes possibles
Régime Description Trade prioritaire
Risk-on expansion Appétit pour le risque largeLong continuation
Risk-off stress Fuite du risque Short rally / breakdown
Rotation tech NQ meilleur véhicule MNQ/NQ prioritaire
Rotation broad marketES meilleur véhicule MES/ES prioritaire
Compression Attente de catalyst Breakout/retest
Range Marché borné Rotation bas/haut de range
Exhaustion Extension excessive Sweep/reversal
Neutral Aucun driver clair WAIT ou setup très propre
Sortie attendue
Régime possibleArguments pourArguments contreStatut
Statuts :
dominant ;
secondaire ;
éliminé ;
non confirmé.
15. Step 6 — Macro thesis
Objectif
Construire la thèse macro avant la technique.
Questions obligatoires
Le marché price-t-il croissance ou ralentissement ?
Le marché price-t-il inflation ou détente ?
Les taux sont-ils un vent contraire ou favorable ?
Le dollar soutient-il ou pénalise-t-il les indices ?
Le VIX confirme-t-il appétit ou stress ?
Le pétrole crée-t-il un risque inflation/géopolitique ?
L’or indique-t-il hedge ou détente ?
Le calendrier impose-t-il prudence ?
Le macro favorise-t-il cassure ou réaction sur les niveaux ?
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
Élément macroLecture Analyse ChallengeDéductionConclusion
16. Step 7 — Cross-asset map
Objectif
Vérifier si les actifs périphériques confirment la thèse macro.
Actifs obligatoires
US10Y ;
US02Y ;
DXY ;
VIX ;
WTI / CL ;
Gold / GC ;
Nikkei ;
Hang Seng ;
DAX ;
Euro Stoxx ;
NVDA ;
AAPL ;
MSFT ;
TSLA ;
SMH / SOXX si disponible.
Process obligatoire
Chaque actif doit passer par :
lecture ;
analyse ;
challenge ;
déduction ;
conclusion.
Sortie attendue
Asset Lecture Analyse ChallengeDéductionConclusion
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
1. 
2. 
3. 
4. 
5. 
14


## Page 15

17. Step 8 — Macro-Technical Causality Engine
Objectif
Relier chaque mouvement technique significatif à son contexte macro/cross-asset.
Questions obligatoires
À quelle heure le mouvement a-t-il eu lieu ?
Quel niveau a été touché ?
Y avait-il un event proche ?
Le mouvement était-il pré-event ?
Le mouvement était-il post-event ?
Le mouvement était-il session-driven ?
Le mouvement était-il headline-driven ?
Le mouvement était-il liquidity-driven ?
Le mouvement était-il purement technique ?
DXY a-t-il confirmé ?
VIX a-t-il confirmé ?
Les taux ont-ils confirmé ?
Les mega caps ont-elles confirmé ?
Le mouvement est-il crédible ou suspect ?
Sortie attendue
Heure InstrumentMouvementNiveau
Catalyst
macro/
news
Cross-
asset
confirmé ?
DéductionConclusion
Classification
Type Signification
Cassure d’acceptationCassure + maintien
Stop run Cassure rapide sans acceptation
Fakeout Breakout puis réintégration
Liquidation Mouvement avec stress DXY/VIX/taux
Rotation NQ/ES divergent
Continuation sainePullback tenu + confirmation
Reversal macro Catalyst opposé + retournement
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
15


## Page 16

18. Step 9 — Déductions cross-asset
Objectif
Transformer les observations en conséquences opérationnelles.
Sortie attendue
DéductionImpact sur NQImpact sur ESConséquence
Exemples de conclusion :
long NQ favorisé ;
short NQ favorisé ;
MES meilleur véhicule ;
NQ trop fragile ;
cross-asset neutre ;
aucun actif prioritaire ;
attente post-event obligatoire.
19. Step 10 — Choix de l’actif
Objectif
Choisir l’actif qui exprime le mieux le régime.
Questions obligatoires
Le marché favorise-t-il tech ou marché large ?
NQ est-il leader ou laggard ?
ES est-il plus propre ?
MNQ/MES confirment-ils NQ/ES ?
Les mega caps soutiennent-elles NQ ?
Les semis confirment-ils ?
Quel actif offre le meilleur RR ?
Quel actif doit être évité ?
Sortie attendue
Actif Arguments pourArguments contreStatut
Statuts :
prioritaire ;
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
16


## Page 17

secondaire ;
évité ;
non tradable.
20. Step 11 — Relative strength
Objectif
Déterminer le leadership interne.
Comparaisons
Comparaison Utilité
NQ vs ES Tech vs marché large
MNQ vs MES Micro confirmation
Mega caps vs NQSoutien du Nasdaq
Semis vs NQ Qualité du leadership tech
ES vs Europe Confirmation globale
Sortie attendue
ComparaisonLecture Analyse DéductionConclusion
21. Step 12 — Technical Price Engine H4
Objectif
Déterminer le régime technique principal.
Questions
Tendance, range, compression ou exhaustion ?
Higher highs / higher lows ?
Lower highs / lower lows ?
Où sont les swings majeurs ?
Le prix est-il près d’un niveau H4 ?
Le macro explique-t-il la structure ?
Qu’est-ce qui invaliderait cette structure ?
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

Sortie attendue
Élément Réponse
Régime H4 ...
Structure ...
Niveaux majeurs...
Macro associée...
Challenge ...
Déduction ...
Conclusion ...
22. Step 13 — Technical Price Engine H1
Objectif
Déterminer la direction de séance.
Questions
Impulsion ou correction ?
Creux montants ?
Sommets descendants ?
Acceptation au-dessus ou sous une zone ?
Pullback contrôlé ou distribution ?
Le mouvement H1 est-il macro-confirmé ?
Sortie attendue
Élément Réponse
Structure H1 ...
Direction de séance...
Catalyst probable...
Challenge ...
Déduction ...
Conclusion ...
• 
• 
• 
• 
• 
• 
18


## Page 19

23. Step 14 — Technical Price Engine M15
Objectif
Trouver les zones exploitables.
Questions
Où sont les supports/résistances M15 ?
Où sont les consolidations ?
Où sont les ranges ?
Quelle zone donne le meilleur RR ?
La macro favorise-t-elle cassure ou rejet ?
Le prix est-il trop loin du niveau ?
Sortie attendue
Zone Type RéactionsMacro autourScénario préféréStatut
24. Step 15 — Technical Price Engine M5
Objectif
Définir les triggers possibles.
M5 ne crée jamais la thèse.
M5 exécute uniquement.
Triggers acceptés
Trigger Utilité
Sweep + reclaim Reversal
Breakout + retest Continuation
Wick rejection Défense de niveau
Reclaim VWAP Activation long
Perte VWAP Invalidation long
Close M5/M15 au-dessus zoneAcceptation
Close M5/M15 sous zone Breakdown
• 
• 
• 
• 
• 
• 
19


## Page 20

Sortie attendue
Trigger Niveau ConditionValidité
25. Step 16 — Extraction des niveaux
Objectif
Identifier les zones décisionnelles.
Niveaux à extraire
H4 swing high ;
H4 swing low ;
H1 swing high ;
H1 swing low ;
M15 range high ;
M15 range low ;
Asia high ;
Asia low ;
overnight high ;
overnight low ;
previous NY high ;
previous NY low ;
VWAP ;
POC ;
VAH ;
VAL ;
prix ronds ;
zones de liquidité ;
high/low d’impulsion.
Sortie attendue
InstrumentNiveau Type TF Source Utilité
26. Step 17 — Pondération des niveaux
Objectif
Classer les niveaux selon leur importance.
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
20


## Page 21

Score sur 10
Critère Points
Niveau H4/H1 +2
Plusieurs réactions +1 à +2
Réaction forte +1 à +2
Alignement VWAP/POC/VAH/VAL+1 à +2
Liquidité évidente +1
Cassure ratée précédente +1
Confirmé par macro/cross-asset+1 à +2
Niveau trop consommé -1 à -2
Niveau au milieu du bruit -1 à -2
Sortie attendue
InstrumentNiveau Type TF RéactionsPoids Plan
27. Step 18 — Réactions du prix
Objectif
Comprendre comment le prix s’est comporté sur les niveaux.
Réactions possibles
Réaction Interprétation
Rejet violent Défense forte
Rejet faible Défense fragile
Creux montants sous résistanceCassure probable
Sommets descendants sur supportBreakdown probable
Sweep + reclaim Stop hunt / reversal
Breakout sans follow-throughFakeout possible
Cassure + acceptation Continuation crédible
Cassure + retest Setup exploitable
21


## Page 22

Sortie attendue
Niveau Réaction passéeAnalyse ChallengeDéductionConclusion
28. Step 19 — Cassure vs rejet
Objectif
Déterminer le comportement probable du prix sur chaque niveau important.
Questions
Le niveau a-t-il été trop testé ?
Les réactions s’affaiblissent-elles ?
Le prix construit-il de la pression ?
Le macro favorise-t-il cassure ou rejet ?
Le cross-asset confirme-t-il ?
Quelle option donne le meilleur RR ?
Sortie attendue
Niveau Pression
acheteuse
Pression
vendeuse
Macro/cross-
asset
Proba
cassure
Proba
rejet Plan
29. Step 20 — Hypothèses concurrentes
Objectif
Empêcher le desk de se verrouiller dans une seule idée.
Hypothèses minimales
Hypothèse Description
Bull case Scénario long
Bear case Scénario short
Range case Scénario neutre
Best long candidateMeilleur long possible
Best short candidateMeilleur short possible
• 
• 
• 
• 
• 
• 
22


## Page 23

Hypothèse Description
WAIT case Pourquoi attendre
Sortie attendue
HypothèseArguments pourArguments contreConditions d’activationStatut
Statuts :
dominante ;
candidate ;
conditionnelle ;
éliminée ;
WAIT prouvé.
30. Step 21 — Élimination des scénarios
Objectif
Transformer l’analyse en vrai entonnoir .
Questions
Quel scénario est affaibli par le macro ?
Quel scénario est contredit par le cross-asset ?
Quel scénario n’a pas de niveau ?
Quel scénario a un mauvais RR ?
Quel scénario est bloqué par le calendrier ?
Quel scénario reste logiquement le plus fort ?
Sortie attendue
Scénario Raison d’éliminationCe qui le réactiverait
31. Step 22 — Setup engineering
Objectif
Construire les trades candidats.
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
23


## Page 24

Champs obligatoires
Élément Description
Instrument MNQ / NQ / MES / ES
Direction Long / short
Setup type Pullback, breakout, rejection, sweep, breakdown
Entry zone Zone exacte
Entry triggerCondition d’activation
Stop loss Stop structurel ou ATR
TP1 Premier objectif
TP2 Objectif principal
TP3 Extension
RR Minimum 2
Invalidation Condition claire
Risk % Selon confiance
Gestion BE, partiel, trailing
Timing Heure limite d’entrée
Sortie attendue
Setup InstrumentDirection Entry SL TP1 TP2 RR Statut
32. Step 23 — Scoring pondéré
Objectif
Objectiver la qualité des setups sans remplacer le raisonnement.
Pondération
Bloc Poids
Macro / calendrier 20%
Cross-asset 20%
Mega caps / semis 15%
24


## Page 25

Bloc Poids
Relative strength 15%
Technical Price Engine20%
Setup engineering / RR10%
Décision selon score
Score Décision
85–100 PRENDRE
75–84 PRENDRE si fenêtre autorisée et RR ≥ 2
65–74 ATTENDRE MEILLEUR PRIX
55–64 SETUP CANDIDAT NON EXÉCUTABLE
<55 WAIT / NE PAS PRENDRE
33. Step 24 — Decision gates
Objectif
Bloquer les trades non conformes malgré un bon raisonnement.
Hard gates
Gate Effet
Pack degraded Pas de prendre sauf override explicite
Dataset critique manquantPas de prendre
Actual J/J+1 utilisé Pas de prendre
Event majeur imminent Rouge / Orange
RR < 2 Pas de prendre
Pas de stop logique Pas de prendre
Pas de TP logique Pas de prendre
Mega caps absentes pour NQPas de prendre
Indicateurs critiques nulsPas de prendre
Prix au milieu du range Pas de prendre
25


## Page 26

Soft gates
Gate Effet
Cross-asset partielTaille réduite
Macro neutre Technique doit être parfaite
Divergence NQ/ESChoisir leader ou WAIT
Volatilité élevée Stop plus large ou WAIT
Niveau consomméConfirmation obligatoire
34. Step 25 — WAIT proof
Objectif
Empêcher un WAIT paresseux.
Si la décision finale est WAIT, le Master doit répondre :
Question Réponse obligatoire
Quel long a été envisagé ? Setup, zone, condition
Pourquoi il n’est pas pris ? Macro, RR, timing, niveau
Quel short a été envisagé ? Setup, zone, condition
Pourquoi il n’est pas pris ? Macro, RR, timing, niveau
Quel prix rendrait le trade valable ?Zone exacte
Quel signal transforme WAIT en GO ?Reclaim, cassure, retest, rejet
Quel signal annule tout ? Invalidation
Quand revalider ? Heure précise
Un WAIT sans preuve est non conforme.
35. Step 26 — Active Thesis
Objectif
Transformer la conclusion du Master en thèse suivable par le monitor .
Le Master doit toujours produire une active_thesis, même si la décision finale est WAIT.
26


## Page 27

États possibles
État Signification
NO_ACTIVE_THESIS Aucun plan exploitable
THESIS_ACTIVE Thèse valide
THESIS_CONDITIONAL Thèse valide sous conditions
SETUP_CANDIDATE Setup candidat
SETUP_ARMED Setup presque déclenchable
WAIT_MONITORED WAIT mais conditions à surveiller
POST_EVENT_REPLAN_ONLYPas de trade avant event
INVALIDATED Thèse annulée
Format
{
"active_thesis": {
"thesis_id": "YYYY-MM-DD_session_instrument_thesis",
"status": "THESIS_ACTIVE | THESIS_CONDITIONAL | WAIT_MONITORED",
"instrument": "MNQ | NQ | MES | ES | WAIT",
"direction": "long | short | neutral | wait",
"dominant_scenario": "...",
"secondary_scenario": "...",
"bias_summary": "...",
"confidence_pct": 0,
"risk_pct_if_triggered": 0,
"valid_from": "YYYY-MM-DDTHH:MM:SS+02:00",
"valid_until": "YYYY-MM-DDTHH:MM:SS+02:00",
"setup_expiry_time": "YYYY-MM-DDTHH:MM:SS+02:00",
"requires_replan_after": "YYYY-MM-DDTHH:MM:SS+02:00",
"linked_setup_id": "...",
"key_levels": [],
"wait_to_go_conditions": [],
"invalidation_conditions": [],
"monitoring_priority": []
}
}
27


## Page 28

36. Step 27 — Expected Path
Objectif
Dire au monitor ce que le marché devrait faire si la thèse est correcte.
Questions
Quel niveau doit tenir ?
Quel niveau doit casser ?
Quel comportement DXY/VIX/taux doit accompagner ?
Que doivent faire les mega caps ?
Quelle structure M15/M5 doit apparaître ?
Quel timing est attendu ?
Sortie attendue
Élément Attendu si thèse valide
Prix ...
Niveau clé ...
M15 ...
M5 ...
DXY ...
VIX ...
Taux ...
Mega caps...
Timing ...
37. Step 28 — Failure Path
Objectif
Définir ce que le marché ferait si la thèse est fausse.
Sortie attendue
Élément Signal d’échec
Prix ...
• 
• 
• 
• 
• 
• 
28


## Page 29

Élément Signal d’échec
Niveau ...
DXY ...
VIX ...
Taux ...
Mega caps...
Structure ...
Action annuler / réduire / replan
38. Step 29 — Scenario Transformation Map
Objectif
Permettre au monitor de transformer un scénario plutôt que seulement le valider ou l’invalider .
Format
Scénario initialSi échec Nouveau scénarioCondition
Exemples
Scénario initial Si échec Nouveau
scénario Condition
Long breakout
MNQ
Réintégration sous
résistance Fakeout short DXY/VIX confirment
Long pullback Support cassé Breakdown shortAcceptation M15 sous
support
Short rejection Reclaim résistance Breakout long Retest tenu
Range rotation Acceptation hors rangeTrend
continuation Close H1 hors range
39. Step 30 — Level Watchlist
Objectif
Transmettre au monitor les niveaux prioritaires.
29


## Page 30

Format
InstrumentNiveau Poids Rôle Réaction attendueAlternative
Champs obligatoires JSON
{
"level_watchlist": [
{
"instrument": "MNQ",
"level_from": 30080,
"level_to": 30120,
"type": "H1 resistance",
"weight": 8,
"role": "decision_level",
"expected_reaction": "breakout_retest_if_risk_on_confirms",
"alternative_reaction": "fakeout_short_if_reintegrated",
"monitoring_action": "watch close/retest and DXY/VIX"
}
]
}
40. Step 31 — Trigger Map
Objectif
Définir les conditions exactes qui transforment une thèse en GO.
Format
Setup Condition GOValidation requise
Exemple
Setup Condition GO Validation
MNQ long breakoutM15 close above 30120DXY stable/faible + VIX comprimé
MNQ long retest Retest 30080–30120 tenuM5 reclaim + RR ≥ 2
MES short breakdownM15 close sous supportVIX/DXY haussiers
30


## Page 31

41. Step 32 — Invalidation Map
Objectif
Définir ce qui annule immédiatement la thèse.
Format
Scénario InvalidationAction
Exemple
Scénario Invalidation Action
MNQ longM15 close sous zone casséeAnnuler long
MNQ longDXY breakout + VIX spike Replan complet
MES shortReclaim résistance + VIX baisseAnnuler short
42. Step 33 — Monitoring Priority
Objectif
Dire au monitor quoi regarder en premier .
Priorités possibles
Priorité Description
Niveau clé Zone décisionnelle majeure
Cross-asset DXY/VIX/taux
Macro Event proche
Mega caps Confirmation NQ
Structure M15Acceptation/rejet
Position Gestion active
Format
Priorité Élément Pourquoi Action monitor
31


## Page 32

43. Step 34 — Monitoring Playbook
Objectif
Créer un arbre d’action pour le monitor .
Format
Si le marché fait ça Alors le monitor doit faire
Breakout + retest tenu + DXY/VIX favorablesARM_SETUP ou TRIGGER_GO
Breakout sans retest WAIT_MORE
Breakout puis réintégration Transformer en fakeout scenario
Support cassé + DXY/VIX haussiers INVALIDATE_THESIS
Prix reste au milieu du range WAIT_MORE
Event majeur dans 30 min GESTION_SEULE
Position à +0.7R MOVE_STOP_BE
TP1 touché TAKE_PARTIAL + BE
44. Step 35 — Thesis Health Baseline
Objectif
Donner au monitor un score initial de santé de la thèse.
Format
Élément Impact initial
Macro alignée +20
Cross-asset aligné +20
Mega caps confirment +15
RS confirme +15
Technique propre +20
RR valide +10
32


## Page 33

Score
Score État
85–100 Thèse forte
70–84 Thèse valide
55–69 Thèse fragile
40–54 Thèse très fragile
<40 Thèse non exploitable
JSON attendu
{
"thesis_health_baseline": {
"score": 72,
"state": "valid_but_conditional",
"main_strengths": [],
"main_risks": [],
"what_would_improve_score": [],
"what_would_reduce_score": []
}
}
45. Step 36 — Context Transmission
Objectif
Créer le bloc que la prochaine analyse ou le monitor devra récupérer .
Format
{
"context_transmission": {
"date": "YYYY-MM-DD",
"session": "asia_open",
"pack_id": "...",
"previous_bias": "...",
"dominant_scenario": "...",
"secondary_scenario": "...",
"rejected_scenarios": [],
"key_levels_to_monitor": [],
"macro_risks_to_monitor": [],
"cross_asset_conditions_to_monitor": [],
33


## Page 34

"wait_to_go_conditions": [],
"invalidation_conditions": [],
"scenario_transformation_map": [],
"monitoring_priority": [],
"open_questions_for_next_session": [],
"expected_market_reaction": "...",
"failure_reaction": "...",
"next_revalidation_time": "...",
"next_analysis_focus": "..."
}
}
46. Step 37 — Session Matrix
Format obligatoire
Jour Heure débutHeure fin Statut Règle desk
47. Step 38 — Résumé exécutable des fenêtres
autorisées
Format obligatoire
Jour Fenêtres autorisées
Si aucune fenêtre :
Jour Fenêtres autorisées
YYYY-MM-DDAucune nouvelle entrée autorisée
48. Step 39 — Agenda de mise à jour du desk
Format obligatoire
Jour Heure Type de mise à jourDéclencheurAction attendue
34


## Page 35

Types :
Validation de continuation ;
Mise à jour partielle ;
Invalidation ;
Replan complet.
49. Structure JSON complète du Master
{
"schema_version": "4.0.0",
"contract_name": "DeskMasterAnalysisContract",
"analysis_id": "...",
"mode": "live | replay | backforward | paper",
"analysis_type": "asia_open | london_session | ny_open | work_forward | 
post_event_replan",
"pack_id": "...",
"report_id": "...",
"decision_id": "...",
"date": "YYYY-MM-DD",
"timezone": "Europe/Paris",
"created_at_paris": "...",
"scope": {},
"source_pack": {},
"previous_context": {},
"continuity_analysis": {},
"time_lock": {},
"macro_calendar": {},
"macro_thesis": {},
"global_regime": {},
"cross_asset_map": [],
"macro_technical_causality": [],
"cross_asset_deductions": {},
"asset_selection": {},
"relative_strength": {},
"technical_price_engine": {},
"extracted_levels": [],
"weighted_levels": [],
"price_reactions": [],
"breakout_vs_rejection": [],
"competing_hypotheses": [],
"eliminated_scenarios": [],
"setups": [],
"setup_scores": {},
"decision_gates": {},
"wait_proof": {},
"executable_decision": {},
"active_thesis": {},
• 
• 
• 
• 
35


## Page 36

"expected_path": {},
"failure_path": {},
"scenario_transformation_map": [],
"level_watchlist": [],
"trigger_map": [],
"invalidation_map": [],
"monitoring_priority": [],
"monitoring_playbook": [],
"thesis_health_baseline": {},
"context_transmission": {},
"session_matrix": [],
"authorized_windows_summary": [],
"update_agenda": [],
"risk_management": {},
"monitoring_rules": {},
"final_sections": {}
}
50. Champs obligatoires d’un setup
{
"setup_id": "...",
"label": "...",
"instrument": "MNQ | NQ | MES | ES | WAIT",
"decision": "prendre | wait | ne_pas_prendre | gestion_seule",
"direction": "long | short | neutral | wait",
"setup_type": "pullback | breakout_retest | breakdown_retest | rejection | 
sweep_reclaim | range_rotation | wait_only",
"entry_zone": {
"from": 0,
"to": 0
},
"entry_trigger": "...",
"stop_loss": 0,
"stop_type": "structural | atr | hybrid",
"take_profits": [
{
"name": "TP1",
"target": 0,
"action": "partial + BE"
},
{
"name": "TP2",
"target": 0,
"action": "runner"
}
],
"rr_minimum": 2,
36


## Page 37

"risk_pct": 0,
"confidence_pct": 0,
"macro_reason": "...",
"technical_reason": "...",
"cross_asset_reason": "...",
"invalidation": "...",
"conditions": [],
"management_rules": [],
"status": "executable | candidate | conditional | rejected | wait"
}
51. Champs obligatoires de la décision
exécutable
{
"decision_id": "...",
"pack_id": "...",
"report_id": "...",
"analysis_id": "...",
"session": "asia_open | asia_to_london | ny_open | work_forward",
"date": "YYYY-MM-DD",
"timezone": "Europe/Paris",
"instrument": "MNQ | NQ | MES | ES | WAIT",
"decision": "prendre | wait | ne_pas_prendre | gestion_seule",
"direction": "long | short | neutral | wait",
"setup_id": "...",
"setup_type": "...",
"order_type": "...",
"confidence_pct": 0,
"risk_pct": 0,
"rr_minimum": 2,
"entry_zone": {},
"entry_trigger": "...",
"stop_loss": 0,
"take_profits": {},
"invalidation": "...",
"action_now": "...",
"no_trade_condition": "...",
"management_rules": [],
"time_rules": {},
"macro_bias": "...",
"technical_bias": "...",
"cross_asset_bias": "...",
"reason_summary": "...",
"detailed_reason": "...",
37


## Page 38

"status": "draft | active | cancelled | expired"
}
52. Décisions autorisées
Décision Sens
PRENDRE Trade exécutable
ATTENDRE MEILLEUR PRIXSetup valide mais mauvais prix
WAIT CONDITIONNEL Trade possible si conditions GO
NE PAS PRENDRE Scénario rejeté
GESTION SEULE Pas de nouvelle entrée
INTERDIT Event ou hard gate
REPLAN COMPLET Ancienne thèse non utilisable
53. Règle spéciale — Preferred Instrument
Le champ preferred_instrument du pack ne doit jamais être le verdict final.
Il est seulement une indication brute.
Le Master doit le challenger .
Si preferred_instrument = WAIT, le Master doit quand même produire :
best long candidate ;
best short candidate ;
WAIT proof ;
active thesis ;
conditions WAIT → GO ;
conditions d’invalidation ;
monitoring playbook.
54. Règle spéciale — Technique reliée au macro
Une cassure technique sans contexte macro est seulement une hypothèse.
• 
• 
• 
• 
• 
• 
• 
38


## Page 39

Elle devient un setup uniquement si :
le contexte macro ne l’invalide pas ;
le cross-asset ne la contredit pas ;
le timing l’autorise ;
le niveau est pondéré ;
la réaction du prix est comprise ;
le RR est suffisant ;
l’invalidation est claire.
55. Règle spéciale — Backend features
Le Master peut utiliser les features calculées par le backend, mais ne doit jamais les prendre comme
vérité non challengée.
Chaque feature doit pouvoir être auditée via :
evidence ;
raw_data_refs ;
get_raw_window si nécessaire.
Le backend calcule.
Le Master interprète.
56. Checklist finale du Master
Avant finalisation, le Master doit vérifier :
Question Oui/Non
Méthodologie chargée ?
Anti-lookahead respecté ?
Contexte précédent récupéré ?
Temps verrouillé ?
Calendrier analysé ?
Régime global défini ?
Macro analysé ?
Cross-assets analysés ?
Technique reliée au macro ?
Actif choisi après déduction ?
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
39


## Page 40

Question Oui/Non
H4/H1/M15/M5 analysés ?
Niveaux extraits ?
Niveaux pondérés ?
Réactions analysées ?
Cassure vs rejet estimé ?
Long, short, range construits ?
Scénarios faibles éliminés ?
Entry, stop, TP , RR construits ?
WAIT prouvé si WAIT ?
Active thesis produite ?
Expected path produit ?
Failure path produit ?
Scenario transformation map produite ?
Monitoring playbook produit ?
Context transmission produit ?
Session matrix produite ?
Agenda de revalidation produit ?
57. Exemple de conclusion Master conforme
Conclusion conforme :
Le régime global est risk-on sélectif tech, mais non confirmé comme risk-on large. Le VIX
reste contenu, le DXY ne bloque pas encore les indices, et les mega caps soutiennent
davantage le Nasdaq que le S&P . La meilleure expression du régime est donc MNQ plutôt
que MES.
Techniquement, MNQ travaille sous une résistance H1/M15 déjà testée plusieurs fois. Les
rejets deviennent moins violents et les creux montent, ce qui augmente la probabilité
d’une cassure. Cette lecture technique est cohérente avec le contexte macro/cross-asset
tant que DXY ne reclaim pas sa résistance et que VIX reste compressé.
Le short de résistance est éliminé tant que DXY/VIX ne remontent pas et que les mega
caps restent fermes. Le long immédiat est aussi rejeté car le prix est trop proche de la
résistance et le RR est insuffisant. Le meilleur scénario est donc un MNQ long
conditionnel sur cassure/retest de 30080–30120.
40


## Page 41

La thèse active transmise au monitor est : surveiller cassure/retest de 30080–30120. Si
M15 clôture au-dessus, que le retest tient, que DXY/VIX restent favorables et que le RR
reste supérieur à 2, le monitor peut armer ou déclencher le setup. Si le prix réintègre
sous 30080 avec DXY/VIX en hausse, le scénario se transforme en fakeout short et un
replan est requis.
Conclusion non conforme :
NQ est fort, on achète.
58. Décision exécutable
Le DeskMasterAnalysisContract v4.0.0 transforme le Master Analysis en playbook vivant.
Le Master ne doit plus seulement produire une analyse et une décision.
Il doit produire :
une thèse active ;
un expected path ;
un failure path ;
une level watchlist ;
une trigger map ;
une invalidation map ;
une scenario transformation map ;
un monitoring playbook ;
un thesis health baseline ;
un context transmission.
Le monitor pourra ensuite vérifier heure par heure si le marché respecte ou invalide cette thèse.
59. Règle finale
Le Master ne doit jamais être un rapport isolé.
Il doit être le point de départ d’une chaîne de décision continue :
analyse maître → thèse active → niveaux surveillés → conditions GO → invalidations → monitor
horaire → maintien / transformation / annulation / replan.
Le trade final n’est pas une opinion.
Il est la conclusion logique d’un entonnoir macro, cross-asset, technique, temporel et probabiliste.
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
41
