# ADR-0036 — Poste de séance et moteur graphique financier

Date : 2026-09-09. Statut : accepté pour le pilote local autorisé par la demande de refonte ; activation VPS non effectuée.

## Décision

Introduire un poste de séance au sein du front-control-plane existant, sélectionné explicitement par `focus=1&workspace=next`. Réutiliser les projections et commandes `/front-api/v1`, conserver les identités sélectionnées et les scopes de graphique indépendants (ADR-0029).

Utiliser `lightweight-charts` **5.2.1**, version exacte, pour le rendu financier du pilote : canvas redimensionnable, chandeliers, volume, réticule, zoom/pan et niveaux publiés. L'adapter graphique reste dans la feature front, sans réseau autonome ni domaine métier. Les bougies absentes restent absentes ; les corrections d'historique ne sont pas ignorées. Une alternative tabulaire et des commandes clavier complètent le canvas.

## Justification et alternatives

Le rendu SVG historique demeure disponible avec l'ancien Focus. L'étendre encore pour un poste multi-actifs ajouterait de la géométrie et de la maintenance UI dans son fichier déjà complexe. Une iframe TradingView perdrait la maîtrise de la source autoritaire et des niveaux ; une nouvelle application indépendante dupliquerait session, permissions et transport. Le pilote dans l'application limite la migration et permet une comparaison réelle.

## Dépendance et maintenance

La bibliothèque est Apache-2.0, dépend de `fancy-canvas`, n'apporte aucun flux de marché et est chargée avec le module du poste. Attribution TradingView visible et notice conservée. Sources : https://tradingview.github.io/lightweight-charts/docs et https://github.com/tradingview/lightweight-charts. Types installés et documentation v5 utilisés ; coût du bundle mesuré au build. Aucune dépendance backend.

## Risques et validation

Le canvas n'est pas une interface de lecteur d'écran : tableau OHLCV, boutons de navigation et valeurs textuelles obligatoires. Les mises à jour préservent le zoom ; le mode inspection gèle les graphiques et bloque les nouvelles décisions sensibles jusqu'à reprise. Le temps réel du transport n'implique jamais des cotations tick par tick.

Tests de données manquantes, doublons, corrections, changement de marché, niveaux d'un autre instrument, viewport, déconnexion, sélection et commandes requises. La certification broker/risk existante n'est pas remplacée par un test visuel.

## Rollback

Pilote désactivé par défaut. Retirer `workspace=next` restaure la vue existante ; aucun rollback SQL ou opération broker nécessaire.
