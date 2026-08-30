# Clôture Recette 3 — Desk Control Plane

## Périmètre

- Rapport source : Recette 3 du build `index-CEdr2mYw.js`.
- Baseline de correction : `main@5ca2f4e4cd1a2396a115c3c59b72a9742ed0b589`.
- Écran prioritaire : Live Trading semi-manuel.
- Autorité : le frontend présente les états, échéances et `allowedActions` publiés ; il ne crée ni signal, ni décision Risk, ni permission Human Gate.

## Règles UI/UX appliquées

- Bloquantes : `UXR-0001`, `UXR-0013`, `UXR-0049`, `UXR-0081`, `UXR-0181`, `UXR-0266`, `UXR-0272`, `UXR-0301`, `UXR-0601`, `UXR-0681`, `UXR-0821`, `UXR-0921`, `UXR-0922`, `UXR-0923`, `UXR-0940`, `UXR-0962`, `UXR-0968`, `UXR-0985`, `UXR-0990`.
- Importantes : `UXR-0082`, `UXR-0141`, `UXR-0183`, `UXR-0385`, `UXR-0391`, `UXR-0501`, `UXR-0511`, `UXR-0682`, `UXR-0695`, `UXR-0823`, `UXR-0832`, `UXR-0930`, `UXR-0937`.

## Matrice de fermeture

| Écart | État dans la baseline courante | Fermeture / preuve attendue |
| --- | --- | --- |
| REG-002 cache périmé | Corrigé avant ce lot | Cache suffixé par build, navigation network-first, `skipWaiting`, `clients.claim`, API exclues du cache et test PWA. |
| FRONT-50 build invisible | Corrigé dans ce lot | Build affiché dans le rail déployé et dans le menu opérateur, y compris rail compact/masqué. |
| REG-004 navigation active | Corrigé et renforcé | Accent structurel, fond, texte principal et `aria-current`; couleurs forcées couvertes. |
| REG-005 menu opérateur partiel | Corrigé dans ce lot | Menu intégré sur les quatre Golden Masters concernés, fallback global sur les autres Golden Masters, menu dans la topbar générique. |
| FRONT-18/19/21 perception périphérique | Déjà corrigé | Titre et favicon dérivés du compteur Human Gate réel; badges navigation et Live dérivés des projections backend. |
| FRONT-01/02/12/13 actionnabilité | Déjà corrigé | États opérateur issus du signal, des gates et `allowedActions`; compte à rebours avec paliers confortable/attention/urgent/expiré. |
| FRONT-07 bande pleine largeur | Déjà corrigé | Flight bar Live : scope, état opérateur, jalon et fraîcheur. |
| FRONT-22 notifications | Déjà corrigé sans inventer de backend | Alertes visuelles/SSE, son local optionnel et notification navigateur consentie; configuration depuis Réglages. |
| DESK-001 entrée | Corrigé côté BFF/runtime | Le plan résolu conserve l'économie d'entrée; absence historique reste visible dans la provenance brute. |
| DESK-005 tunnel décision | Déjà corrigé | Signal → Contexte → Portfolio/Risk → OrderIntent → Human Gate, chaque étage backend-driven. |
| Hauteur navigation Live | Corrigé dans ce lot | Hauteur et structure alignées sur le rail global à 38 px en desktop. |

## États et limites de validation

- Le marché est fermé le 30 août 2026 : un nouveau signal actionnable et son expiration réelle ne peuvent pas être produits à la demande sans fabriquer une donnée.
- Les tests couvrent signal expiré, capability absente, capability autorisée, compte à rebours et statut inconnu.
- La validation finale en séance doit observer un vrai `allowedActions.CONFIRM`, le passage des paliers d'échéance et le rafraîchissement du compteur sans rechargement global.

## Direction visuelle conservée

Le lot ne redessine pas le cockpit. Il conserve le langage « flight director » existant et corrige seulement la cohérence globale, la priorité de l'état opérateur et l'accès aux contrôles. Cela évite une nouvelle divergence avec les Golden Masters validés.

## Validation locale

- Tests frontend : `275/275`.
- Build production : réussi avec code splitting et identifiant de build injecté.
- Live Trading visual QA : `5/5` formats, zéro overflow, zéro contrôle masqué, zéro backdrop, texte minimum `11 px`.
- Command Center visual QA : géométrie Golden Master réalignée sur le rail validé à `200 px`; scénarios laptop et tablette rejoués individuellement sans défaut.
- Portfolio visual QA : `4/4`, dont Windows à 150 % et mobile.
- Axe ciblé : zéro violation serious/critical et zéro défaut de vocabulaire opérateur. Deux réponses `502` transitoires du BFF VPS ont été observées pendant la première passe; les endpoints `jarvis-workspace` et `risk` répondaient ensuite `200`, sans erreur de contrat frontend.
- Rulebook : `1 000/1 000` règles valides; scanner heuristique `0` erreur et `715` avertissements historiques non bloquants.
