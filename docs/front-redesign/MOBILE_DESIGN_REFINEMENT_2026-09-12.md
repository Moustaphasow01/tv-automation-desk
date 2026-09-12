# Connexion et séance — amélioration visuelle mobile

Périmètre : `front-control-plane`, présentation de la connexion, Accueil, Live et Live Focus. Base : `feea01b`, qui contient les correctifs antérieurs de continuité. Aucun changement moteur, API, migration ou permission.

## Direction contract

THESIS : rendre immédiatement lisibles l'accès, l'état de séance et le marché observé. Mode Operate ; conserver le monde visuel de la séance déjà livré.

OWN-WORLD : reprendre les surfaces ardoise, texte clair et accent bleu doux des tokens workspace existants. Typographie système lisible, chiffres tabulaires, contrôles cohérents. Couleur réservée aux actions, sélections et états.

STORY : se connecter, comprendre les priorités à l'accueil, observer dans Live puis examiner un ticket dans Focus, en conservant les identités et routes existantes.

FIRST VIEWPORT : connexion avec marque discrète, titre, deux champs confortables et action principale ; accueil avec en-tête compact et résumé séparé des listes ; Live/Focus avec navigation distincte, contexte compact et marché lisible. Mobile dès 320 px, hauteur libre et safe areas.

FORM : amélioration des quatre surfaces existantes, construction directe sur les composants validés ; aucun remplacement d'identité, tournoi de concepts ou nouvelle bibliothèque.

FINISH : unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Placement et validation

La présentation de connexion appartient à `domains/permissions` et consomme le contexte de session existant. Les styles de séance restent dans leurs features `command-center` et `live-trading`. Une extraction de la connexion réduit les responsabilités de `PermissionGate` et retire ses styles de la feuille globale legacy. Les routes d'accueil et de marché réutilisent leurs projections, sans nouvelles valeurs calculées.

Alternatives écartées : autre application, nouveaux flux, effets décoratifs, graphiques simulés, réécriture de la navigation. Règles : UXR-0141/0142/0143/0153/0156/0160, 0181, 0281, 0321–0340, 0481, 0681. Validation : typage, tests front, contrats de connexion, audit responsive/navigation et Axe ; les preuves et limites seront ajoutées à la livraison.

## Livraison et preuves

Implémentation locale sur `codex/front-design-mobile-20260912`, sans déploiement ni push. Connexion extraite dans OperatorLoginScreen avec styles et cinq tests dédiés. Accueil, Live, Focus et navigation mobile harmonisés en conservant leurs contrats métier. Retrait de 111 lignes de styles de connexion globaux ; PermissionGate réduit de 77 lignes nettes. Aucune dépendance ajoutée.

Vérifications : 464 tests existants passent, puis cinq nouveaux tests de connexion passent dans une exécution dédiée. Build V2 avec typage réussi. Gardes architecture, frontières V2/legacy, data mode et vocabulaire réussies ; diff sans erreur d'espacement. Navigateur Edge : 17 configurations de géométrie (320, 390, 768, 1440 px et connexion à hauteur réduite), cinq scans Axe sans violation, aucune erreur JavaScript et aucune commande de trading envoyée. Neuf captures finales inspectées. Revue de finition effectuée dans la tâche, faute d'outil direct de revue indépendante ; les deux défauts identifiés ont été corrigés puis revérifiés.

Limites : pas de validation sur téléphone physique, Safari, lecteur d'écran, clavier virtuel réel ou zoom 200 %. Les audits statiques UI conservent des constats historiques ; ils ne sont pas tous verts. Le garde qualité global échoue sur des sources hors de cette modification : front-session-projection.js trop long, fonctions surdimensionnées, complexité et duplications au-dessus de la baseline. Ces dettes ne sont pas corrigées ici. Aucun test d'exécution d'ordre réel n'a été réalisé.

Direction documentée : palette, typographie et états existants conservés ; seules les dispositions locales évoluent. PRODUCT.md/DESIGN.md préservés, y compris leur décalage historique. Aucun asset raster de production ajouté.
