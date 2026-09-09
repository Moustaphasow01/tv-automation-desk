# ADR 0038 — Marché mobile unique et attention aux nouveaux tickets

Date : 2026-09-09. Statut : accepté pour l’évolution demandée par l’opérateur.

## Contexte

Le poste livré par l’ADR 0037 conserve une bonne lecture bureau mais empile ses graphiques sur téléphone. L’opérateur utilise principalement Live Focus sur mobile ; il demande un sélecteur en haut, un seul graphique et une mise en avant du marché d’un nouveau ticket. Il demande également une amélioration de Live et l’intégration future de Bitcoin, Solana et Dogecoin.

## Décision

1. Le mobile affiche le premier graphique et les accès aux actifs avant celui-ci. La liste complète, les groupes et les favoris restent accessibles. La disposition bureau 1/2/4 n’est pas écrasée par le mobile. Les graphiques masqués ne lancent pas d’actualisation dédiée ; une lecture déjà figée conserve son état à la rotation.
2. Le front reconnaît la transition vers un ticket canonique actionnable, non terminal, non expiré, dont l’instrument est publié. Avec une projection complète, fraîche et connectée, il peut sélectionner simultanément ce ticket et son marché. C’est une intention de navigation explicite, jamais une règle de trading ni une autorisation.
3. Cette préférence d’affichage est activée par défaut conformément à la demande utilisateur, désactivable et enregistrée localement par opérateur/environnement. Un rafraîchissement ou une révision seuls ne recommencent pas le basculement.
4. Une saisie, un dialogue, une fiche inspectée, une commande en cours, une lecture figée, le suivi ou le bilan retiennent les nouveaux tickets dans une file. Une arrivée groupée ne fait pas défiler automatiquement plusieurs dossiers. Les expirations et disparitions retirent les entrées devenues inactives.
5. La sélection manuelle du graphique reste indépendante de celle du ticket (ADR 0029). L’exception de navigation du point 2 est nommée et testée séparément. Le dossier, le compte, la révision et la prélecture avant commande restent inchangés.
6. Live reste la vue d’ensemble : marché observé, état de séance, activité, dossiers et contexte à la demande. Focus demeure le poste de décision. Le rendu financier existant est réutilisé ; la lecture historique détaillée reste accessible.

Un sélecteur de marché est un contrôle de navigation, pas une saisie d’ordre : son focus persistant après fermeture du menu natif ne bloque pas les tickets suivants et n’est pas retiré artificiellement. Les contrôles d’un formulaire de décision restent protégés par le dialogue et l’état de commande.

## Propriété et alternatives

Propriétaire `front-control-plane`, couche présentation/état, feature `live-trading`. Les données et permissions restent publiées par `/front-api/v1`. Les consommateurs sont `/live` et `/live?focus=1`.

Écartés : empiler quatre graphiques sur téléphone ; écraser la préférence bureau ; recalculer une priorité financière ; déplacer un dossier en cours de confirmation ; créer un deuxième front ou un deuxième moteur de signaux.

## Crypto : frontière explicite

Aucun flux crypto ni contrat de marché BTC/SOL/DOGE n’est raccordé dans la version inspectée. Choisir un symbole au comptant, un perpétuel ou un future courtier n’est pas un simple libellé frontend. La plateforme et le type de contrat doivent être précisés avant de publier des instruments prétendument tradables. Aucun cours, contrat, risque, signal ou raccordement fictif n’est ajouté. Aucun ordre, AUTO ou LIVE physique n’est activé par ce chantier.

## Compatibilité, validation, retour arrière

Pas de migration SQL, dépendance, changement de contrat BFF ou de moteur. La préférence v1 est étendue de manière compatible ; une ancienne valeur reçoit la valeur d’affichage demandée et conserve le reste de ses réglages.

Tests purs de déduplication/temps/file ; tests du hook sous saisie, dialogue, pause, déconnexion et changements groupés ; tests React du reflow ; recette locale contre le vrai BFF et événements contractuels isolés uniquement sur localhost ; contrôles visuels, accessibilité et non-régression. Aucun POST de commande autorisé pendant les audits.

Retour d’affichage : désactiver la priorité aux tickets ou ouvrir `workspace=classic` pour Focus. Retour de release par le kit Windows officiel. Le moteur demeure le commit `30715bd7889761271ebb0e2b2f85cfde3ed4c83d`.
