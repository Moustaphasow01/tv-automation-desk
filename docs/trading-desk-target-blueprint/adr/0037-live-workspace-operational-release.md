# ADR 0037 — Poste de séance opérationnel et activation du front

Statut : accepté pour la livraison demandée le 9 septembre 2026.

## Contexte

Après le pilote de l'ADR 0036, l'opérateur demande l'intégration des dix évolutions et leur déploiement sur le VPS. Le moteur de production doit rester celui de la release `grains-m5-continuity-20260908.2` (commit `30715bd7889761271ebb0e2b2f85cfde3ed4c83d`). Le dossier local contient d'autres changements qui ne sont pas inclus.

## Décision

Le nouveau poste devient la surface Live Focus par défaut (`#/live?focus=1`). L'ancien poste demeure disponible via `workspace=classic`, depuis Options ou par lien direct. Cette activation ne modifie aucune autorisation de trading. Le pipeline Windows Build/Update qualifie un artefact propre, construit sur le commit actuellement déployé, avec exclusivement les fichiers front et les documents de ce chantier.

Les vues existantes fournissent le calendrier, le registre de stratégies, les décisions, le suivi théorique et les preuves d'exécution. Les liens utilisent les identifiants canoniques exacts ; les informations absentes sont signalées. Aucun endpoint d'écriture, migration, règle financière ou moteur n'est ajouté. Les réglages restent locaux au navigateur, versionnés et isolés par opérateur/environnement ; les filtres, la sélection et la période restent dans l'URL. Les avertissements critiques ne sont pas masquables.

Les curseurs liés ne transportent qu'un horodatage. Les marqueurs se placent dans les seules bougies reçues contenant l'événement. Le changement de panneau ne reprend pas une lecture figée. La confirmation conserve les prélectures, identités, permissions, révisions, idempotence et distinctions entre demande acceptée et exécution.

## Vérification et retour arrière

Tests front, vérification des frontières, build, parcours navigateur, accessibilité et revue de finition précèdent la bascule. Le pipeline officiel conserve sauvegarde base et objets, drain, migrations idempotentes, canary, contrôles de santé et rollback. Les paramètres de sécurité, budgets et politiques de données existants sont comparés avant/après ; aucun secret n'est exposé dans les preuves.

Retour d'interface immédiat : `#/live?focus=1&workspace=classic`. Retour de release : procédure officielle `Rollback-Desk.ps1`, sans copie manuelle sur le répertoire courant.

## Limites

L'interface ne crée pas une source tick-by-tick, ne certifie pas une protection courtier absente des projections et n'invente pas un événement macro manquant. L'émulation mobile ne vaut pas validation sur iPhone physique. Le bilan consolidé demeure limité au périmètre et aux valeurs publiés par le serveur.
