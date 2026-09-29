# Contrats techniques des ports OOS

Ce sont des contrats à raccorder, pas la liste de tools déjà installés chez un fournisseur. Les adapters retournent un objet via `structuredContent` ou un bloc texte JSON MCP. `capture` peut également retourner un bloc image MCP PNG et des métadonnées JSON ; sans métadonnées, l'image est refusée. Aucun nom de tool ni paramètre de fournisseur n'est deviné.

## TradingView

| Opération | Arguments principaux | Preuve / résultat |
|---|---|---|
| openSymbol | symbol, replay_only:true | mutation technique terminée |
| setReplayDate | date, timezone, replay_only:true | date de replay sélectionnée |
| setReplayCutoff | cutoff, replay_only:true | curseur au cutoff ; aucune bougie future visible |
| setTimeframe | timeframe:5m/15m/1h/4h | changement effectif, pas seulement clic envoyé |
| applyViewPreset | view:global/zoom | vue technique ; ne modifier ni scénario ni indicateur |
| capture PREMARKET | symbol,date,cutoff,timeframe,view,phase | symbol,date,cutoff,timeframe,view,replay:true,visible_as_of,captured_at,source,image_base64 ; indicator_fingerprint si disponible |
| setEngineVersion | engine_version:V3.9.8,replay_only:true | moteur exact existant ; ne pas modifier son code |
| setBookMode | book_mode:PORTEFEUILLE_REALISTE,replay_only:true | mode vérifié |
| loadPlan | plan_text,plan_sha256,replay_only:true,reset_simulation:true | charger tous les octets sans normalisation métier ; reset explicite pour reprise |
| readPlanFingerprint | symbol,cutoff | symbol,cutoff,plan_sha256,engine_version,book_mode relus depuis le moteur chargé |
| startReplay | plan_sha256,replay_only:true | démarrage uniquement simulation |
| advanceTo | at (20:00 Paris),plan_sha256,replay_only:true | replay:true,at,symbol,plan_sha256 après atteinte réelle de la fin |
| openDashboard | replay_only:true | dashboard effectif |
| capture RESULT | name,phase,at,symbol,plan_sha256,replay_only:true,timeframe si graphe | image_base64,replay:true,at,symbol,plan_sha256,timeframe si demandé,captured_at,source |
| collectVisibleAudit | plan_sha256,at,replay_only:true | symbol,at,plan_sha256,engine_version,book_mode,source,audit,logs facultatif |

Timeout connexion 30s, call 120s. Les opérations longues doivent fournir une implémentation bornée/cohérente ; aucun succès anticipé. Une reprise réinitialise la simulation, ne rajoute pas d'épisodes à un run partiel. Le runner vérifie le fingerprint après les changements d'inputs Pine et rétablit le cutoff.

## Scenario Builder : requestPlan

Entrée exacte : `{request_id, manifest, manifest_sha256, images:[{name,mime_type:"image/png",sha256,data}]}`. `data` est le base64 des vrais octets PNG. Le provider doit réellement donner les pixels à son modèle et n'utiliser que ces observations ; recevoir du base64 dans un appel MCP ne prouve pas à lui seul que son modèle les a vus. Identité request_id stable pour les relances techniques.

Sortie : `{status:"PENDING"}` ou `{status:"READY",plan_text,generated_by,generated_at}`. `plan_text` est la chaîne UTF-8 exacte, sans fence ni réécriture locale. Aucune syntaxe ou scénario n'est inventé par l'orchestrateur. Chaîne Unicode mal formée refusée, pas réparée.

## Parseur : validatePlanSyntax

Entrée : `{plan_text,date,symbol,schema:"SMC3",engine_version:"V3.9.8",plan_sha256}`.

Sortie acceptée : `{syntax_valid:true,validation_scope:"SYNTAX_ONLY",date,symbol,schema,engine_version,plan_sha256}`. Le parseur doit réellement vérifier le document, y compris la cohérence de ses en-têtes ; il ne doit pas simplement recopier les arguments. Identités différentes ou syntax_valid différent de true : refus. Il ne retourne pas un plan corrigé et le desk n'en consomme aucun.

Interdit : RR minimum, sélection/suppression de scénarios, changement de direction, ENTRY/SL/TP, REARM, paramètres de coûts ou filtres. Sans grammaire autorisée ou parseur certifié, le freeze reste bloqué.

## Audit

Objet JSON original conservé. Champs numériques descriptifs reconnus : net_r,net_usd,fills,wins,losses,mfe_p,mfe_n,mae,duration,time_to_mfe,giveback,rearm,fallback_1m,fallback_15m,event_count,dropped_events. N'utiliser ces noms que pour des valeurs déjà calculées et explicitement publiées par la source ; unité source inchangée. Détails de refus et shadow conservés sans interprétation. Toute donnée inconnue reste absente/null, jamais zéro par défaut.
