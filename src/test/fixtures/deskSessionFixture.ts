export const deskSessionFixture = {
  "meta": {
    "appName": "Desk Futures",
    "environment": "Mock contract data",
    "timezone": "Europe/Paris",
    "generatedAt": "2026-07-13T17:24:00+02:00",
    "masterContract": {
      "name": "DeskMasterAnalysisContract",
      "version": "4.0.0"
    },
    "monitorContract": {
      "name": "DeskHourlyThesisMonitorContract",
      "version": "1.0.0"
    },
    "schemaVersion": "demo-1.0.0",
    "generatedFor": "React mobile-first handoff",
    "contracts": {
      "master": "DeskMasterAnalysisContract 4.0.0",
      "monitor": "DeskHourlyThesisMonitorContract 1.0.0",
      "frontProjection": "DeskFrontProjectionContract 1.0.0 (cible)"
    }
  },
  "sessions": {
    "asia_open": {
      "id": "asia_open",
      "strategyId": "asia_open",
      "label": "Asia Open",
      "shortLabel": "ASIA",
      "date": "2026-07-13",
      "mode": "LIVE",
      "status": "REPLAN_REQUIRED",
      "severity": "critical",
      "lastDataAt": "14:45",
      "lastMonitorAt": "14:45",
      "nextMonitorAt": "15:00",
      "nextMacro": {
        "time": "16:00",
        "label": "Catalyseur macro moyen",
        "importance": "medium"
      },
      "dataQuality": {
        "label": "Données complètes",
        "status": "ready",
        "antiLookahead": true,
        "warnings": []
      },
      "automation": {
        "status": "active",
        "label": "Automatisation active"
      },
      "liveBrief": {
        "eyebrow": "Action immédiate",
        "headline": "Replan complet requis",
        "action": "NE PAS ENTRER",
        "summary": "La pression baissière anticipée sur le MNQ s’est matérialisée, mais le mouvement a déjà rejoint la zone des objectifs du Master. L’ancienne zone d’entrée n’est plus exploitable.",
        "why": "Le plan initial était borné jusqu’à 08:00. À 14:45, le prix est déjà au-delà de l’entrée 29848–29855 et proche des objectifs. Exécuter maintenant reviendrait à poursuivre un mouvement consommé avec un ratio rendement/risque dégradé.",
        "nextAction": "Construire un nouveau Master avant toute nouvelle exécution.",
        "decision": "REPLAN_FULL"
      },
      "thesis": {
        "id": "thesis_asia_2026_07_13_mnq",
        "instrument": "MNQ",
        "direction": "wait",
        "status": "REPLAN_REQUIRED",
        "previousStatus": "WAIT_MONITORED",
        "dominantScenario": "Le scénario baissier du Master a atteint ses objectifs mais n’est plus exécutable depuis l’ancienne zone d’entrée.",
        "secondaryScenario": "Aucun scénario alternatif ne doit être activé sans nouveau Master.",
        "confidence": 35,
        "initialConfidence": 64,
        "health": 35,
        "initialHealth": 64,
        "validUntil": "17:30",
        "nextFocus": "Nouveau Master immédiat ; ne plus utiliser les anciens niveaux d’exécution.",
        "scoreDriversPositive": [
          "Direction initiale correctement anticipée",
          "Cassure baissière réalisée"
        ],
        "scoreDriversNegative": [
          "Fenêtre d’exécution expirée",
          "Zone d’entrée dépassée",
          "Objectifs déjà approchés",
          "RR actuel insuffisant"
        ]
      },
      "marketBrief": {
        "headline": "Mouvement baissier réalisé, edge d’entrée consommé",
        "text": "Le flux reste orienté vers le bas, mais la qualité d’exécution s’est fortement dégradée. Le Desk distingue désormais la justesse directionnelle du Master de la validité opérationnelle du setup.",
        "consequence": "Biais réalisé ≠ nouvelle autorisation d’entrée."
      },
      "market": [
        {
          "symbol": "MNQ",
          "price": "29 716,25",
          "change": "-1,08 %",
          "trend": "down",
          "note": "Sous ancien trigger"
        },
        {
          "symbol": "MES",
          "price": "7 601,50",
          "change": "-0,21 %",
          "trend": "down",
          "note": "Résilience relative"
        },
        {
          "symbol": "DXY",
          "price": "100,94",
          "change": "+0,18 %",
          "trend": "up",
          "note": "Pression Nasdaq"
        },
        {
          "symbol": "VIX",
          "price": "16,21",
          "change": "+2,72 %",
          "trend": "up",
          "note": "Stress modéré"
        },
        {
          "symbol": "US10Y",
          "price": "4,583 %",
          "change": "+3 pb",
          "trend": "up",
          "note": "Taux fermes"
        },
        {
          "symbol": "SOXX",
          "price": "562,66",
          "change": "-3,06 %",
          "trend": "down",
          "note": "Semis faibles"
        },
        {
          "symbol": "SMH",
          "price": "597,09",
          "change": "-2,15 %",
          "trend": "down",
          "note": "Leadership fragile"
        }
      ],
      "crossAssetBrief": {
        "headline": "Le cross-asset confirme la pression, pas l’entrée tardive",
        "text": "Dollar et taux fermes, VIX en reprise et semiconducteurs faibles soutiennent la lecture baissière. Mais ces confirmations ne réparent pas un point d’entrée expiré.",
        "verdict": "Contexte baissier confirmé · Setup non exécutable"
      },
      "latestChange": {
        "title": "Depuis le dernier monitor",
        "items": [
          {
            "tone": "negative",
            "text": "Le MNQ a dépassé l’ancienne zone d’entrée."
          },
          {
            "tone": "negative",
            "text": "Le premier objectif du Master a été approché."
          },
          {
            "tone": "negative",
            "text": "Le ratio rendement/risque n’est plus propre au prix actuel."
          },
          {
            "tone": "warning",
            "text": "La limite temporelle de replan fixée à 08:00 est dépassée."
          }
        ],
        "consequence": "WAIT_MONITORED → REPLAN_REQUIRED"
      },
      "master": {
        "id": "master_asia_2026_07_13_0015",
        "createdAt": "00:15",
        "decision": "WAIT",
        "instrument": "MNQ",
        "direction": "short conditionnel",
        "confidence": 64,
        "summary": "Continuation baissière conditionnelle après cassure confirmée et retest rejeté de 29855,75.",
        "regime": "Risk-off modéré, pression relative sur le Nasdaq.",
        "macroThesis": "Le contexte autorise une continuation baissière uniquement si le prix confirme la perte du niveau pondéré et si le cross-asset ne se retourne pas.",
        "assetSelection": "MNQ choisi pour sa faiblesse relative face au MES et la fragilité des semiconducteurs.",
        "expectedPath": [
          "Clôture M5 sous 29855,75.",
          "Retest de 29848–29855 puis rejet.",
          "Extension vers 29743,25, 29716,25 puis 29677,50."
        ],
        "failurePath": [
          "Maintien M5 au-dessus de 29902,50 après déclenchement.",
          "Reprise durable de 29956,75.",
          "Expiration temporelle à 08:00 sans trigger propre."
        ],
        "monitoringPlaybook": [
          "Rester WAIT tant que la cassure M5 n’est pas confirmée.",
          "Armer uniquement après perte de 29855,75.",
          "Déclencher uniquement sur retest rejeté et RR ≥ 2.",
          "Annuler si le prix réintègre 29902,50.",
          "Replan obligatoire à 08:00."
        ],
        "sections": [
          {
            "title": "Cadre de décision",
            "summary": "Master de session Asia Open, cutoff 00:15 Paris, mode live, priorité à la causalité macro-technique.",
            "body": "Le Master construit la thèse de session et transmet au monitor un expected path, un failure path, des niveaux prioritaires, des conditions GO et des invalidations."
          },
          {
            "title": "Régime global et macro",
            "summary": "Risk-off modéré sans catalyseur rouge immédiat.",
            "body": "Le contexte global est compatible avec une pression sur les indices technologiques, mais ne justifie pas une entrée sans confirmation de prix."
          },
          {
            "title": "Cross-asset map",
            "summary": "DXY et taux fermes, VIX non comprimé, semis fragiles.",
            "body": "La combinaison réduit la qualité des longs Nasdaq et soutient un short conditionnel. Le MES résiste mieux, renforçant le choix relatif du MNQ."
          },
          {
            "title": "Technical Price Engine",
            "summary": "Niveau pivot 29855,75 ; invalidation 29902,50.",
            "body": "La lecture H4/H1 définit le régime, M15 valide l’acceptation et M5 fournit le trigger. Le prix au milieu du range reste un hard gate."
          },
          {
            "title": "Decision gates",
            "summary": "Pas de GO sans retest, RR ≥ 2 et fenêtre autorisée.",
            "body": "Les hard gates empêchent l’exécution si l’entrée est tardive, si le RR est inférieur à 2, si un événement majeur est imminent ou si les données critiques sont dégradées."
          },
          {
            "title": "Transmission au monitor",
            "summary": "Surveiller cassure, retest, invalidation et expiration.",
            "body": "Le monitor doit comparer le marché réalisé à l’expected path, mettre à jour la santé de la thèse et transmettre un prochain focus précis."
          }
        ]
      },
      "setup": {
        "id": "setup_asia_short_01",
        "label": "MNQ breakdown–retest conditionnel",
        "instrument": "MNQ",
        "direction": "SHORT",
        "status": "OBSOLETE",
        "statusLabel": "Désactivé · Ne pas exécuter",
        "entryFrom": 29848,
        "entryTo": 29855,
        "stop": 29902.5,
        "tp1": 29743.25,
        "tp2": 29716.25,
        "tp3": 29677.5,
        "risk": 0.5,
        "confidence": 64,
        "rr": 2.03,
        "reason": "Zone dépassée, objectifs approchés et fenêtre d’exécution expirée."
      },
      "monitors": [
        {
          "id": "monitor_asia_1445",
          "time": "14:45",
          "sequence": 1,
          "decision": "REPLAN_FULL",
          "severity": "critical",
          "statusBefore": "WAIT_MONITORED",
          "statusAfter": "REPLAN_REQUIRED",
          "healthBefore": 64,
          "healthAfter": 35,
          "summary": "Le scénario baissier s’est réalisé mais la thèse opérationnelle est obsolète.",
          "detailedReason": "Le seuil de replan 08:00 est dépassé et le prix se situe déjà au-delà de la zone d’entrée, autour des objectifs. Le Desk refuse de confondre confirmation directionnelle et autorisation d’entrée tardive.",
          "nextAction": "Ne pas déclencher. Construire un nouveau Master.",
          "nextFocus": "Nouveau régime, nouveaux niveaux, nouvelle fenêtre d’exécution.",
          "expectedVsRealized": [
            {
              "element": "Cassure 29855,75",
              "expected": "Cassure confirmée",
              "realized": "Réalisée",
              "verdict": "confirm",
              "impact": "Confirme le scénario prévu."
            },
            {
              "element": "Retest d’entrée",
              "expected": "29848–29855",
              "realized": "Zone dépassée",
              "verdict": "invalidate",
              "impact": "Bloque ou invalide l’exécution."
            },
            {
              "element": "Objectifs",
              "expected": "29743 puis 29716",
              "realized": "Approchés",
              "verdict": "confirm",
              "impact": "Confirme le scénario prévu."
            },
            {
              "element": "Timing",
              "expected": "Avant 08:00",
              "realized": "14:45",
              "verdict": "invalidate",
              "impact": "Bloque ou invalide l’exécution."
            }
          ],
          "weakSignals": [
            "Retard majeur de l’expected path",
            "Entry chase",
            "Edge temporel épuisé"
          ],
          "goConditions": [
            {
              "label": "Clôture M5 sous 29855,75",
              "status": "validated",
              "proof": "Cassure réalisée",
              "impact": "Autorise la progression",
              "deterministic": true
            },
            {
              "label": "Retest rejeté avec entrée disponible",
              "status": "failed",
              "proof": "Zone déjà dépassée",
              "impact": "Bloque le GO",
              "deterministic": true
            },
            {
              "label": "RR ≥ 2 au prix actuel",
              "status": "failed",
              "proof": "Potentiel consommé",
              "impact": "Bloque le GO",
              "deterministic": true
            },
            {
              "label": "Fenêtre autorisée",
              "status": "failed",
              "proof": "Après 08:00",
              "impact": "Bloque le GO",
              "deterministic": true
            }
          ],
          "invalidationConditions": [
            {
              "label": "Expiration temporelle",
              "status": "triggered",
              "proof": "08:00 dépassé",
              "impact": "Action immédiate requise",
              "deterministic": true
            },
            {
              "label": "Entry devenue obsolète",
              "status": "triggered",
              "proof": "Prix sous la zone",
              "impact": "Action immédiate requise",
              "deterministic": true
            },
            {
              "label": "Reprise 29956,75",
              "status": "not_triggered",
              "proof": "Non observée",
              "impact": "Pas d’action",
              "deterministic": true
            }
          ]
        }
      ],
      "timeline": [
        {
          "time": "00:15",
          "type": "master",
          "title": "Master créé",
          "status": "ready",
          "detail": "Confiance 64 % · Trigger 29855,75",
          "severity": "info",
          "summary": "WAIT · Short MNQ conditionnel",
          "sourceType": "MASTER"
        },
        {
          "time": "12:22",
          "type": "setup",
          "title": "Setup matérialisé",
          "status": "wait",
          "detail": "RR initial 2,03 · Risque 0,50 %",
          "severity": "info",
          "summary": "Zone 29848–29855",
          "sourceType": "SETUP"
        },
        {
          "time": "12:47",
          "type": "thesis",
          "title": "Thèse mise à jour",
          "status": "warning",
          "detail": "Santé 35 / 100",
          "severity": "warning",
          "summary": "WAIT_MONITORED → REPLAN_REQUIRED",
          "sourceType": "THESIS"
        },
        {
          "time": "14:45",
          "type": "monitor",
          "title": "Monitor terminé",
          "status": "critical",
          "detail": "Ne pas entrer sur l’ancien setup",
          "severity": "critical",
          "summary": "REPLAN_FULL",
          "sourceType": "MONITOR"
        }
      ],
      "activity": [
        {
          "time": "14:45",
          "title": "Monitor terminé",
          "detail": "Décision REPLAN_FULL",
          "status": "done"
        },
        {
          "time": "14:46",
          "title": "Thèse mise à jour",
          "detail": "REPLAN_REQUIRED",
          "status": "done"
        },
        {
          "time": "14:46",
          "title": "Setup désactivé",
          "detail": "Ancienne zone verrouillée",
          "status": "done"
        },
        {
          "time": "15:00",
          "title": "Prochain monitor",
          "detail": "En attente d’un nouveau Master",
          "status": "queued"
        }
      ],
      "levels": [
        {
          "price": "29 855,75",
          "role": "Trigger initial",
          "state": "consumed"
        },
        {
          "price": "29 902,50",
          "role": "Invalidation proche",
          "state": "reference"
        },
        {
          "price": "29 956,75",
          "role": "Replan structurel",
          "state": "reference"
        },
        {
          "price": "29 743,25",
          "role": "TP1",
          "state": "tested"
        },
        {
          "price": "29 716,25",
          "role": "TP2",
          "state": "near"
        }
      ],
      "audit": {
        "contracts": [
          {
            "name": "DeskMasterAnalysisContract",
            "version": "4.0.0",
            "status": "active"
          },
          {
            "name": "DeskHourlyThesisMonitorContract",
            "version": "1.0.0",
            "status": "active"
          }
        ],
        "checks": [
          {
            "label": "Master chargé",
            "status": "ok"
          },
          {
            "label": "Thèse active chargée",
            "status": "ok"
          },
          {
            "label": "Snapshot 1h / 4h",
            "status": "ok"
          },
          {
            "label": "Anti-lookahead",
            "status": "ok"
          },
          {
            "label": "Raw references",
            "status": "ok"
          }
        ],
        "apiMap": [
          {
            "view": "Live Desk",
            "endpoint": "get_live_desk_state"
          },
          {
            "view": "Master",
            "endpoint": "get_front_master_state"
          },
          {
            "view": "Monitor",
            "endpoint": "get_front_monitor_state"
          },
          {
            "view": "Journée",
            "endpoint": "get_strategy_day_detail"
          },
          {
            "view": "Audit",
            "endpoint": "get_audit_state"
          }
        ]
      },
      "position": {
        "active": false,
        "status": "NONE",
        "instrument": "MNQ",
        "direction": "short",
        "entry": null,
        "current": null,
        "unrealizedR": null,
        "note": "Aucune position live. Les anciens niveaux sont conservés uniquement pour la traçabilité."
      },
      "macro": [
        {
          "time": "16:00",
          "title": "Calendrier macro à surveiller",
          "importance": "medium",
          "impactText": "Aucun actual n’est utilisé avant sa publication. Le Desk applique le verrou temporel."
        }
      ],
      "news": {
        "digestUpdatedAt": "14:40",
        "digest": "Dollar, taux et faiblesse des semiconducteurs soutiennent la pression sur le Nasdaq, sans rendre l’ancienne entrée exécutable.",
        "headlines": [
          {
            "time": "14:38",
            "title": "Semiconducteurs sous pression",
            "source": "Desk digest",
            "impact": "Nasdaq négatif"
          },
          {
            "time": "14:20",
            "title": "Taux américains fermes",
            "source": "Desk digest",
            "impact": "Pression duration"
          }
        ]
      },
      "alerts": [
        {
          "level": "critical",
          "title": "Replan requis",
          "message": "Ne pas exécuter l’ancien setup MNQ.",
          "time": "14:45"
        }
      ]
    },
    "ny_open": {
      "id": "ny_open",
      "strategyId": "ny_open_1530",
      "label": "NY Open 15:30",
      "shortLabel": "NY",
      "date": "2026-07-13",
      "mode": "LIVE",
      "status": "EXPIRED",
      "severity": "warning",
      "lastDataAt": "17:15",
      "lastMonitorAt": "17:15",
      "nextMonitorAt": "—",
      "nextMacro": {
        "time": "—",
        "label": "Aucun catalyseur rouge immédiat",
        "importance": "low"
      },
      "dataQuality": {
        "label": "Données exploitables",
        "status": "degraded",
        "antiLookahead": true,
        "warnings": [
          "News digest absent"
        ]
      },
      "automation": {
        "status": "active",
        "label": "Automatisation active"
      },
      "liveBrief": {
        "eyebrow": "Clôture opérationnelle",
        "headline": "Setup expiré après déclenchement strict",
        "action": "GESTION TERMINÉE",
        "summary": "Le setup short MNQ sous 29630,75 a été déclenché en replay strict et marqué à +0,89R en mode conservateur. À 17:15, sa fenêtre d’exécution est définitivement expirée.",
        "why": "Le Master imposait un replan à 16:30 et une expiration à 17:00. Le dernier monitor interdit toute réutilisation des anciens niveaux, même si le biais directionnel initial était correct.",
        "nextAction": "Archiver la thèse et attendre la prochaine session ou un nouveau Master.",
        "decision": "EXPIRE_SETUP"
      },
      "thesis": {
        "id": "thesis_ny_2026_07_13_mnq",
        "instrument": "MNQ",
        "direction": "wait",
        "status": "EXPIRED",
        "previousStatus": "SETUP_TRIGGERED",
        "dominantScenario": "Ancien scénario short conditionnel expiré ; aucun scénario exécutable actif.",
        "secondaryScenario": "À reconstruire uniquement par un nouveau Master.",
        "confidence": 20,
        "initialConfidence": 58,
        "health": 20,
        "initialHealth": 58,
        "validUntil": "18:00",
        "nextFocus": "Archiver et ne plus utiliser 29630,75–29645,50 comme entrée.",
        "scoreDriversPositive": [
          "Breakdown réalisé",
          "Semiconducteurs faibles",
          "Replay strict +0,89R"
        ],
        "scoreDriversNegative": [
          "Fenêtre 17:00 expirée",
          "Replan 16:30 dépassé",
          "Thèse devenue historique"
        ]
      },
      "marketBrief": {
        "headline": "Le setup a fonctionné, mais la thèse est maintenant historique",
        "text": "Le Desk sépare le résultat du trade de la validité future du plan. Une exécution gagnante ne prolonge jamais automatiquement la durée de vie d’une thèse.",
        "consequence": "Résultat +0,89R · Aucun nouveau GO autorisé"
      },
      "market": [
        {
          "symbol": "MNQ",
          "price": "29 582,25",
          "change": "-1,31 %",
          "trend": "down",
          "note": "Sortie EOD mark"
        },
        {
          "symbol": "MES",
          "price": "7 604,75",
          "change": "+0,12 %",
          "trend": "up",
          "note": "Divergence forte"
        },
        {
          "symbol": "DXY",
          "price": "100,94",
          "change": "+0,02 %",
          "trend": "flat",
          "note": "Stable"
        },
        {
          "symbol": "VIX",
          "price": "16,21",
          "change": "-0,49 %",
          "trend": "down",
          "note": "Détente"
        },
        {
          "symbol": "US10Y",
          "price": "4,583 %",
          "change": "-0,2 pb",
          "trend": "flat",
          "note": "Stable"
        },
        {
          "symbol": "SOXX",
          "price": "562,66",
          "change": "-3,06 %",
          "trend": "down",
          "note": "Sous open cash"
        },
        {
          "symbol": "SMH",
          "price": "597,09",
          "change": "-2,15 %",
          "trend": "down",
          "note": "Sous open cash"
        }
      ],
      "crossAssetBrief": {
        "headline": "Semis faibles, mais divergence MNQ/MES à surveiller",
        "text": "SOXX et SMH ont confirmé la faiblesse tech. En parallèle, le MES a mieux résisté, ce qui montre que le mouvement était plus spécifique au Nasdaq qu’un risk-off généralisé.",
        "verdict": "Confirmation sectorielle · Régime global mixte"
      },
      "latestChange": {
        "title": "Décision du dernier monitor",
        "items": [
          {
            "tone": "positive",
            "text": "Le setup strict a produit +0,89R en mode conservateur."
          },
          {
            "tone": "warning",
            "text": "La fenêtre d’exécution a expiré à 17:00."
          },
          {
            "tone": "negative",
            "text": "La thèse a été classée EXPIRED."
          },
          {
            "tone": "neutral",
            "text": "Aucun scénario alternatif n’est activé sans nouveau Master."
          }
        ],
        "consequence": "SETUP_TRIGGERED → EXPIRED"
      },
      "master": {
        "id": "master_ny_2026_07_13_1530",
        "createdAt": "15:30",
        "decision": "WAIT",
        "instrument": "MNQ",
        "direction": "short conditionnel",
        "confidence": 58,
        "summary": "Continuation baissière conditionnelle sous 29630,75 après retest rejeté.",
        "regime": "Faiblesse spécifique Nasdaq avec semiconducteurs en gap baissier.",
        "macroThesis": "Le short reste conditionnel : la technique doit confirmer la faiblesse sectorielle sans entrer sur une impulsion déjà étendue.",
        "assetSelection": "MNQ préféré au MES en raison de la divergence et de la faiblesse SOXX/SMH.",
        "expectedPath": [
          "Test de 29630,75 sans entrée sur simple impulsion.",
          "Retest 29630,75–29645,50 puis rejet.",
          "Extension vers 29522,25, 29468 puis 29413,75."
        ],
        "failurePath": [
          "Reprise M5 de 29685.",
          "Reprise de 29748,50 avec semis au-dessus de leur open cash.",
          "Replan à 16:30 puis expiration 17:00."
        ],
        "monitoringPlaybook": [
          "Rester WAIT sans retest.",
          "Armer sous 29630,75.",
          "Déclencher si semis faibles et RR ≥ 2.",
          "Annuler au-dessus de 29685.",
          "Replan à 16:30 ; expiration 17:00."
        ],
        "sections": [
          {
            "title": "Cadre de décision",
            "summary": "Master NY Open à 15:30, données cutoff strictes.",
            "body": "L’analyse distingue la thèse, le setup et la position. Les performances ne proviennent que des trades exécutés et sauvegardés."
          },
          {
            "title": "Mega-cap leadership",
            "summary": "SOXX -3,06 %, SMH -2,15 %, NVDA en gap négatif.",
            "body": "La faiblesse des semiconducteurs est utilisée comme contexte causal du Nasdaq, jamais comme actif exécutable."
          },
          {
            "title": "Relative strength",
            "summary": "MNQ plus faible que MES.",
            "body": "La divergence favorise un instrument Nasdaq pour exprimer le scénario, mais exige de surveiller une éventuelle normalisation."
          },
          {
            "title": "Setup engineering",
            "summary": "Entrée 29630,75–29645,50, stop 29685, RR minimal 2.",
            "body": "Le setup nécessite un retest rejeté. L’impulsion seule ne constitue pas un trigger conforme."
          },
          {
            "title": "Time rules",
            "summary": "Replan 16:30, expiration 17:00.",
            "body": "Le temps fait partie du setup. Un niveau ne reste pas exécutable simplement parce qu’il existe encore sur le graphique."
          }
        ]
      },
      "setup": {
        "id": "setup_ny_short_01",
        "label": "MNQ breakdown–retest sous 29630,75",
        "instrument": "MNQ",
        "direction": "SHORT",
        "status": "EXPIRED",
        "statusLabel": "Expiré · Résultat strict +0,89R",
        "entryFrom": 29630.75,
        "entryTo": 29645.5,
        "stop": 29685,
        "tp1": 29522.25,
        "tp2": 29468,
        "tp3": 29413.75,
        "risk": 0.25,
        "confidence": 58,
        "rr": 2,
        "resultR": 0.89,
        "reason": "Trade marqué à 29582,25 puis setup expiré à 17:00."
      },
      "monitors": [
        {
          "id": "monitor_ny_1715",
          "time": "17:15",
          "sequence": 1,
          "decision": "EXPIRE_SETUP",
          "severity": "warning",
          "statusBefore": "SETUP_TRIGGERED",
          "statusAfter": "EXPIRED",
          "healthBefore": 58,
          "healthAfter": 20,
          "summary": "La fenêtre d’exécution du setup MNQ a expiré à 17:00 Paris.",
          "detailedReason": "Le dernier monitor classe l’ancien setup comme définitivement inutilisable. Le trade strict est clos pour le journal de performance, mais aucun nouveau déclenchement ne doit réutiliser les niveaux initiaux.",
          "nextAction": "Archiver la thèse et attendre un nouveau Master.",
          "nextFocus": "Prochaine session ou replan explicite.",
          "expectedVsRealized": [
            {
              "element": "Breakdown",
              "expected": "Sous 29630,75",
              "realized": "Réalisé",
              "verdict": "confirm",
              "impact": "Confirme le scénario prévu."
            },
            {
              "element": "Semis",
              "expected": "Sous open cash",
              "realized": "SOXX/SMH faibles",
              "verdict": "confirm",
              "impact": "Confirme le scénario prévu."
            },
            {
              "element": "Trade strict",
              "expected": "RR ≥ 2 au plan",
              "realized": "+0,89R EOD",
              "verdict": "partial",
              "impact": "Résultat partiel, sans validation complète."
            },
            {
              "element": "Expiration",
              "expected": "17:00",
              "realized": "17:15",
              "verdict": "invalidate",
              "impact": "Bloque ou invalide l’exécution."
            }
          ],
          "weakSignals": [
            "Divergence MES",
            "Fenêtre dépassée",
            "Aucun scénario alternatif actif"
          ],
          "goConditions": [
            {
              "label": "Clôture M5 sous 29630,75",
              "status": "validated",
              "proof": "Déclenchement strict",
              "impact": "Autorise la progression",
              "deterministic": true
            },
            {
              "label": "Retest rejeté",
              "status": "validated",
              "proof": "Entrée matérialisée",
              "impact": "Autorise la progression",
              "deterministic": true
            },
            {
              "label": "Semis sous open cash",
              "status": "validated",
              "proof": "SOXX / SMH faibles",
              "impact": "Autorise la progression",
              "deterministic": true
            },
            {
              "label": "Fenêtre encore valide",
              "status": "failed",
              "proof": "17:00 dépassé",
              "impact": "Bloque le GO",
              "deterministic": true
            }
          ],
          "invalidationConditions": [
            {
              "label": "Expiration 17:00",
              "status": "triggered",
              "proof": "Monitor 17:15",
              "impact": "Action immédiate requise",
              "deterministic": true
            },
            {
              "label": "Reprise 29685",
              "status": "not_triggered",
              "proof": "Non observée au trade",
              "impact": "Pas d’action",
              "deterministic": true
            },
            {
              "label": "Nouveau Master requis",
              "status": "triggered",
              "proof": "Replan 16:30 dépassé",
              "impact": "Action immédiate requise",
              "deterministic": true
            }
          ]
        }
      ],
      "timeline": [
        {
          "time": "15:30",
          "type": "master",
          "title": "Master NY Open",
          "status": "ready",
          "detail": "Confiance 58 %",
          "severity": "info",
          "summary": "WAIT · Short MNQ conditionnel",
          "sourceType": "MASTER"
        },
        {
          "time": "15:35",
          "type": "setup",
          "title": "Setup déclenché",
          "status": "action",
          "detail": "Risque 0,25 %",
          "severity": "action",
          "summary": "Entrée stricte 29630,75",
          "sourceType": "SETUP"
        },
        {
          "time": "15:45",
          "type": "trade",
          "title": "Marque conservatrice",
          "status": "positive",
          "detail": "Sortie 29582,25",
          "severity": "positive",
          "summary": "+0,89R",
          "sourceType": "TRADE"
        },
        {
          "time": "17:00",
          "type": "thesis",
          "title": "Fenêtre expirée",
          "status": "warning",
          "detail": "Replan déjà requis depuis 16:30",
          "severity": "warning",
          "summary": "Aucun nouveau GO",
          "sourceType": "THESIS"
        },
        {
          "time": "17:15",
          "type": "monitor",
          "title": "Monitor final",
          "status": "warning",
          "detail": "Thèse archivable",
          "severity": "warning",
          "summary": "EXPIRE_SETUP",
          "sourceType": "MONITOR"
        }
      ],
      "activity": [
        {
          "time": "15:30",
          "title": "Master sauvegardé",
          "detail": "WAIT short conditionnel",
          "status": "done"
        },
        {
          "time": "15:35",
          "title": "Setup strict déclenché",
          "detail": "Entrée 29630,75",
          "status": "done"
        },
        {
          "time": "15:45",
          "title": "Trade marqué",
          "detail": "+0,89R conservateur",
          "status": "done"
        },
        {
          "time": "17:15",
          "title": "Setup expiré",
          "detail": "Aucun nouveau GO",
          "status": "done"
        }
      ],
      "levels": [
        {
          "price": "29 630,75",
          "role": "Trigger de breakdown",
          "state": "consumed"
        },
        {
          "price": "29 645,50",
          "role": "Bord du retest",
          "state": "consumed"
        },
        {
          "price": "29 685,00",
          "role": "Invalidation",
          "state": "reference"
        },
        {
          "price": "29 748,50",
          "role": "Transformation haussière",
          "state": "reference"
        },
        {
          "price": "29 522,25",
          "role": "TP1",
          "state": "near"
        }
      ],
      "audit": {
        "contracts": [
          {
            "name": "DeskMasterAnalysisContract",
            "version": "4.0.0",
            "status": "active"
          },
          {
            "name": "DeskHourlyThesisMonitorContract",
            "version": "1.0.0",
            "status": "active"
          }
        ],
        "checks": [
          {
            "label": "Pack marché",
            "status": "ok"
          },
          {
            "label": "News digest",
            "status": "warning"
          },
          {
            "label": "Anti-lookahead",
            "status": "ok"
          },
          {
            "label": "Semis / mega caps",
            "status": "ok"
          },
          {
            "label": "Trade strict",
            "status": "ok"
          }
        ],
        "apiMap": [
          {
            "view": "Live Desk",
            "endpoint": "get_live_desk_state"
          },
          {
            "view": "Master",
            "endpoint": "get_front_master_state"
          },
          {
            "view": "Monitor",
            "endpoint": "get_front_monitor_state"
          },
          {
            "view": "Journée",
            "endpoint": "get_strategy_day_detail"
          },
          {
            "view": "Audit",
            "endpoint": "get_audit_state"
          }
        ]
      },
      "position": {
        "active": false,
        "status": "CLOSED",
        "instrument": "MNQ",
        "direction": "short",
        "entry": 29630.75,
        "current": 29582.25,
        "unrealizedR": 0.89,
        "note": "Trade strict clôturé au mark conservateur. Aucune position live n’est actuellement ouverte."
      },
      "macro": [
        {
          "time": "20:00",
          "title": "Prochaine fenêtre macro",
          "importance": "medium",
          "impactText": "Le calendrier reste disponible, mais l’ancien setup a déjà expiré."
        }
      ],
      "news": {
        "digestUpdatedAt": "indisponible",
        "digest": "News Digest absent dans ce pack. Les prix, le calendrier macro et les autres sources restent exploitables.",
        "headlines": [
          {
            "time": "16:52",
            "title": "Faiblesse persistante des semiconducteurs",
            "source": "Flux marché",
            "impact": "Confirme le biais sectoriel"
          },
          {
            "time": "16:30",
            "title": "Divergence Nasdaq / S&P",
            "source": "Feature Engine",
            "impact": "Régime global mixte"
          }
        ]
      },
      "alerts": [
        {
          "level": "warning",
          "title": "Setup expiré",
          "message": "Archiver la thèse et attendre un nouveau Master.",
          "time": "17:15"
        }
      ]
    }
  }
} as const;
