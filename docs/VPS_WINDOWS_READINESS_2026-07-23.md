# Readiness pré-VPS Windows — Desk Futures

Date : 2026-07-23
Statut : `READY_FOR_VPS_PROVISIONING`
Portée : préparation locale terminée ; aucun déploiement externe ni ordre LIVE.

## Résultat

Le dépôt contient désormais le runtime et l'outillage nécessaires pour installer
le Desk sur un VPS Windows unique, avec PostgreSQL natif et NinjaTrader sur la
même machine. Le futur travail sur le VPS est réduit au provisionnement,
à l'installation avec élévation, au DNS/TLS, à la connexion interactive
NinjaTrader et au cutover contrôlé.

Les contrats métier verrouillés restent les références non régressables :

- `packages/desk-contracts/contracts/DeskMasterAnalysisContract_v4_0_0.md` ;
- `packages/desk-contracts/contracts/DeskHourlyThesisMonitorContract_v1_0_0.md`.

Leur empreinte est protégée par `config/strategy-contract-lock.json` et
`npm run guard:strategy-contracts`.

## Architecture cible prête

```text
Internet
  -> DNS desk.example.com
  -> Pare-feu Windows : 80/443 uniquement
  -> Caddy : TLS automatique, headers de sécurité, journaux bornés
     -> frontend React statique
     -> /api, /mcp, /oauth, /.well-known, /sse
        -> Desk API/MCP Node.js sur 127.0.0.1:8787
           -> PostgreSQL 16 natif sur 127.0.0.1:5432
           -> objets immuables sur C:\ProgramData\DeskFutures\objects

Services Windows WinSW
  -> DeskApi
  -> DeskLiveRuntime
  -> DeskBrokerManagement
  -> DeskCaddy

Session Windows interactive persistante
  -> NinjaTrader 8 + DeskExecutionAddOn
  -> superviseur par tâche utilisateur
  -> API Desk signée sur loopback
  -> Sim101 uniquement jusqu'à validation explicite

Tâches planifiées
  -> health locale toutes les 5 minutes
  -> sauvegarde PostgreSQL quotidienne
  -> restauration de contrôle hebdomadaire
```

## Livrables

### Packaging et exploitation

- `deploy/windows/Build-DeskRelease.ps1`
- `deploy/windows/Test-DeskRelease.ps1`
- `deploy/windows/Install-Desk.ps1`
- `deploy/windows/Update-Desk.ps1`
- `deploy/windows/Rollback-Desk.ps1`
- `deploy/windows/Install-DeskServices.ps1`
- `deploy/windows/Set-DeskFirewall.ps1`
- `deploy/windows/Test-DeskDeployment.ps1`
- `deploy/windows/Install-DeskNinjaTrader.ps1`
- `deploy/windows/Register-DeskMaintenanceTasks.ps1`
- `deploy/caddy/Caddyfile.template`
- `deploy/windows/services/*.xml.template`
- `deploy/templates/desk.vps.env.example`

### PostgreSQL natif

- bootstrap des rôles owner/runtime/backup ;
- migrations ordonnées et tracées par SHA-256 ;
- export Docker, restauration native et comparaison source/cible ;
- sauvegarde avec somme de contrôle, métadonnées, rétention et copie hors site ;
- option de chiffrement `age` ;
- restauration périodique réelle dans la base isolée `desk_restore_check`.

Les scripts sont sous `deploy/windows/database/`. La migration
`infra/postgres/init/012_deployment_readiness.sql` ajoute le ledger de migrations,
les heartbeats de services et le catalogue de sauvegardes.

### Sécurité publique

`DESK_PUBLIC_MODE=true` fait échouer le démarrage si :

- l'URL publique ou les origines autorisées ne sont pas HTTPS ;
- un secret est absent, trop court ou identique à une valeur locale connue ;
- l'API ou PostgreSQL n'est pas prévu sur loopback ;
- la base distante n'est pas explicitement configurée ;
- le compte NinjaTrader LIVE est autorisé.

Le frontend public ne contient plus de clé opérateur. L'opérateur utilise un PIN
échangé contre un cookie signé `HttpOnly`, `Secure`, `SameSite=Strict`. Les codes
OAuth sont PKCE, à usage unique, et les refresh tokens restent liés à leur client.
Les webhooks TradingView publics refusent les secrets dans l'URL et limitent le
corps à 64 Kio.

### Runtime continu

`npm --prefix mcp_gpt_desk run live:runtime` exécute :

- la préparation LIVE M15 ;
- la continuité paper M5 entre deux analyses ;
- un heartbeat PostgreSQL ;
- un verrou consultatif PostgreSQL empêchant deux schedulers concurrents.

Le worker de gestion broker possède le même verrou mono-instance et un heartbeat.
Les deux restent fail-closed si l'environnement n'est pas armé.

## Preuve de migration locale

Un dump réel de la base Docker a été produit et restauré dans une instance
PostgreSQL 16 jetable :

- fichier : `desk-docker-20260723T133439Z.dump` ;
- taille : environ 58 Mio ;
- SHA-256 :
  `001307ea8955f1b0f89bfcc5a667e024a09ce13260bb48d27a6a0f0ea5e0e464`.

La comparaison a validé les comptages et agrégats de clés, notamment :

| Table | Lignes |
|---|---:|
| `desk_documents` | 44 096 |
| `market_candles` | 142 929 |
| `market_feeds` | 50 |
| `tradingview_events` | 200 |
| `desk_pack_objects` | 116 |
| `trade_decisions` | 8 |
| `trade_order_intents` | 7 |
| `trades` | 6 |

Cette répétition ne remplace pas le dump final au moment du cutover.

Toutes les migrations `infra/postgres/init/*.sql` ont ensuite été appliquées
deux fois sur la restauration jetable. Les deux passages ont conservé exactement
`44 096` documents, `142 929` bougies, `8` décisions et `6` trades. Les tables
de déploiement, sauvegarde, heartbeat et AddOn sont présentes après chaque
passage.

## Preuve packaging, installation et retour arrière

Deux releases locales distinctes ont été construites, inventoriées et signées :

- chaque manifeste couvre `3 830` fichiers de production ;
- le ZIP, chaque fichier déclaré et l'absence de fichier injecté sont vérifiés ;
- les dépendances backend de production ont été installées avec
  `0 vulnérabilité` signalée ;
- l'installation isolée a rendu la configuration publique sans placeholder,
  sans clé locale intégrée au front et avec une jonction `current` valide ;
- le cycle `A → B → rollback automatique vers A → retour explicite vers B` a
  conservé la cohérence entre la jonction, `previous-release.txt` et
  `DESK_RELEASE_VERSION`.

La répétition a aussi permis de corriger deux incompatibilités PowerShell 5.1 :
l'exécution des fichiers `.cmd` et la suppression sûre d'une jonction NTFS.
L'update restaure désormais automatiquement la cible précédente si la fin du
basculement échoue.

Artefact de répétition final :

- archive : `.local/releases/pre-vps-ready-20260723.zip` ;
- SHA-256 :
  `8d97fc44d048e768aa349afde259bea77cbb09e09c5d95c571c29eb2e7e420b3` ;
- installation finale de répétition : cohérente, sans placeholder et sans clé
  de développement dans le frontend.

Cet artefact porte volontairement `dirty=true`. Après validation des changements
dans Git, reconstruire la release de cutover sans `-AllowDirty`.

## Performance mesurée

Après projection SQL des documents GPT lourds, préchauffage serveur et cache
court/coalescé de la projection Operations, le benchmark local réel final
(48 requêtes par endpoint, concurrence 6) a mesuré :

| Ressource | p95 |
|---|---:|
| `/status` | 82 ms |
| Live | 55 ms |
| résumé Operations | 37 ms |
| Replays | 93 ms |
| overview exécution | 968 ms |

Avant correction, certaines pages lisaient environ 60 Mio de bundles complets et
dépassaient 12 secondes. Elles ne lisent désormais que les champs nécessaires au
niveau SQL. La matrice Playwright réelle passe aussi sur desktop et à 320 px.

Les gates locales finales comprennent également :

- `322 / 322` tests backend ;
- `4 / 4` scénarios Playwright sur la stack Docker réelle ;
- typage et build Vite de production ;
- contrats générés à jour et contrats stratégiques verrouillés ;
- `0` reliquat détecté et `0` script actif non référencé ;
- validation Caddy et parsing PowerShell 5.1.

## Limites impossibles à lever avant le VPS

Les éléments suivants exigent la future machine ou une décision externe :

1. acheter/provisionner le VPS Windows et choisir son dimensionnement ;
2. attribuer une IPv4 fixe ;
3. acheter ou rattacher le domaine, puis créer les enregistrements DNS ;
4. exécuter les installateurs Windows depuis un PowerShell administrateur ;
5. installer PostgreSQL natif et saisir son mot de passe superuser ;
6. ouvrir 80/443 et obtenir le certificat public Caddy ;
7. installer NinjaTrader, se connecter une première fois et compiler l'AddOn ;
8. conserver une session interactive Windows ouverte pour NinjaTrader ;
9. configurer le stockage de sauvegarde hors VPS ;
10. reconfigurer TradingView et les connecteurs GPT après validation shadow.

NinjaTrader ne fonctionne pas comme un service Windows sans session graphique.
Après un redémarrage complet, une reconnexion au compte principal NinjaTrader peut
encore être nécessaire selon ses règles de session. L'AddOn et la connexion au
Desk se rétablissent ensuite automatiquement. Une déconnexion RDP doit utiliser
« Disconnect » et non « Sign out ».

## Gate

- `GO` : provisionnement du VPS, installation native, restauration, mode shadow,
  Sim101 et validation des connecteurs.
- `NO-GO` : compte NinjaTrader LIVE, envoi d'ordres LIVE, suppression de la
  source Google ou bascule DNS sans sauvegarde finale et preuve de rollback.
