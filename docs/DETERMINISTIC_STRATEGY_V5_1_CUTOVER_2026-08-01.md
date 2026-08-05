# Cutover Deterministic Strategy V5.1 — 2026-08-01

## Résultat

La release Windows `2026.08.01-engine-v5-1-hold.3` est installée sur le VPS
OVH et reste sous gel strict `ENGINE_V5_VALIDATION_HOLD`.

- LIVE, préparation Replay, broker et workers IA ne sont pas démarrés.
- Les files `live` et `replay` sont `PAUSED` et `enabled=false`.
- Le verrou broker global est actif.
- Le 11 juin 2026 est importé dans PostgreSQL natif.
- Le replay du 11 juin est préparé en `PAUSED`, sans run et sans analyse.
- Aucune lecture ou écriture Firestore n'a été exécutée pendant ce cutover.

## Release déployée

| Élément | Valeur |
| --- | --- |
| Release | `2026.08.01-engine-v5-1-hold.3` |
| Profil | `deterministic_strategy_v5_frozen` |
| Archive SHA-256 | `5db56b3783f738d04bbfe7a1fad58703f07325a512bdc9ce19de00e7a38c00fb` |
| Fichiers vérifiés | `4171` |
| Commit de base | `f977d28ea5afa0d188f5cf52e4cbe5c0eb6e4c26` |
| Manifest `dirty` | `true`, accepté explicitement pour ce cutover contrôlé |
| Junction active | `C:\DeskFutures\releases\2026.08.01-engine-v5-1-hold.3` |

Le SHA a été recalculé localement puis sur le VPS avant extraction. Le
manifest et chacun des 4 171 fichiers ont ensuite été revérifiés sur le VPS.

## Sauvegardes précédant la bascule finale

| Périmètre | Fichier | SHA-256 |
| --- | --- | --- |
| PostgreSQL | `desk-native-20260801T185129Z.dump` | `e0dd258955c47d3503cfc23596cf7d347d9ff52e6304d1a39adaed5310ff0254` |
| Objets immuables | `desk-objects-20260801T185228Z.tar.gz` | `a34cc7398421b65009904c36277199560733c794fab8b8758ca0f18188b95ce4` |

## Matrice contractuelle active

| Slot | Contrat actif | Version | Hash Markdown | Hash schéma canonique |
| --- | --- | --- | --- | --- |
| Master | `DeskMasterAnalysisContract_v5_1_0` | `5.1.0` | `772065b34de26ffaf9bafaf54bc87bbb73766551c64890444f7b9d6db7828a37` | `5842b6bc4636d98cf1cb1533a7077cb0f38277a7c73fe7e225f76535af76371d` |
| Monitor | `DeskHourlyThesisMonitorContract_v2_1_0` | `2.1.0` | `c0e66252286628a86c6bdd0f9c3323dadeacc76db1262b6bd053d7429bf778a5` | `1ed2368f3a0554cd17fd7fcefc7af60d1bd83e028e9030069d88ffb7fd31b374` |
| Execution Plan | `DeskExecutionPlanContract_v1_1_0` | `1.1.0` | `993fd94b08129165f0de2c88cea0699ebacd1ebf3a7636fd07618301d880acaf` | `d5640feb3ea31662b761abc0069811a8719d7543e6dadebc1909e80ccf312e08` |
| Monitor Command | `DeskMonitorCommandContract_v1_1_0` | `1.1.0` | `7b29c0af28be04e4facf8da84691c44c2bb6a3d3acc3b98985dd31b69249c258` | `510c000904a1098aed11c98f4a8d6031ded5200ae74777ea05ce3427b6b69157` |
| Condition Catalog | `DeskConditionCatalogContract_v1_1_0` | `1.1.0` | `777913b4f18c5ae2ef62e3bb164bb462bd187d3072f652667b6248d63310c80e` | `50d6a1bd3fc1b16b7eb5eff0b947088c145df8353c42279a722ccd59b4b40739` |
| Front Projection | `DeskFrontProjectionContract_v1_0_0` | `1.0.0` | `f1109aa76401e53da560d682ff03fedeef12bc12717c47e67ce2b107ccd399d6` | `c7546b4c1edb5b38c1e032d3f6438faac49adc339b926d785517b5fd5b546b03` |
| Execution Policy | `DeskDeterministicExecutionPolicy_v4_1_0` | `4.1.0` | `8722e6eba6b83c50aa6f96a7feef1854458987e7bc5b2e4ff76b27ee867b6e9e` | `d5640feb3ea31662b761abc0069811a8719d7543e6dadebc1909e80ccf312e08` |

Le catalogue déterministe JSON V1.1 reste scellé par
`18f32266c6ef9615e93fa1f18a948961847260dd1e24ac3da7a766d47c2d7bf5`.

Les versions antérieures restent lisibles et archivées. Elles ne sont ni
réécrites, ni réactivées, ni éligibles aux nouveaux writers. Le document V4
historique importé avant PostgreSQL conserve sa projection persistée telle
quelle ; son hash de provenance correspond au fichier V4 canonique original
`702f9fe325f61fdb53e913592da268b5a4aa2bafe5dd879ece915adc64d1c8e8`.

## Certification

- Domaine et moteur déterministe : `190/190`.
- Backend MCP complet de la release `.2` : `659/659`.
- Delta final contrats, seed et intégrité release `.3` : `25/25`.
- Front React : `20/20`.
- TypeScript, build Vite, génération des schémas et garde stratégique : OK.
- Vérification d'archive Windows : OK, `4171` fichiers.
- `git diff --check` : OK.
- Parse PowerShell du contrôleur de cutover : OK.

Les avertissements non bloquants connus restent :

- une vulnérabilité npm de sévérité modérée, sans `npm audit fix` automatique ;
- des avertissements React SSR `useLayoutEffect` dans les tests, sans échec.

## Import scellé du 11 juin

| Preuve | Valeur |
| --- | --- |
| Import ID | `tv_m1_backfill__0fd35d23ff12a8e3bdc84781266458350b02a55b` |
| Manifest SHA-256 | `0fd35d23ff12a8e3bdc84781266458350b02a55bf00a7d5eb8e924846c13e054` |
| Capture proof SHA-256 | `0af3a904dc924e558c775292a5d7b4b1d0766ae22bb341cc8d8c6144937d507c` |
| Evidence SHA-256 | `c016c16974520e19b04b1cfd9e53c2c20840ef20fb71e47a3e03ee39b8fa2fc8` |
| Politique de capture | `settled_closed_bar_v2` |
| Fenêtre Paris | `[2026-06-11 00:00, 2026-06-11 22:00)` |

Couverture PostgreSQL vérifiée :

| Feed | Timeframe | Lignes | Ouvertes |
| --- | --- | --- | --- |
| `prod__tradingview__MNQ1!__1` | M1 | `1320` | `0` |
| `prod__tradingview__MES1!__1` | M1 | `1320` | `0` |
| `prod__tradingview__MNQ1!__5` | M5 | `264` | `0` |
| `prod__tradingview__MES1!__5` | M5 | `264` | `0` |

Le dry-run strict a prouvé `528/528` buckets M5 exacts avant le commit.
L'import a ensuite été rejoué et a retourné `ALREADY_IMPORTED` avec
`idempotent=true`.

## Replay préparé, non démarré

| Élément | Valeur |
| --- | --- |
| Preparation ID | `replayprep__6c6c12102ee7b74f30588680` |
| État préparation | `AWAITING_CONFIRMATION` |
| Config ID | `replay_autopilot__2026_06_11__full_day__a463d2134a67` |
| État config | `PAUSED`, `enabled=false` |
| Backtest ID | `replay_2026-06-11_full_day_5m_a463d2134a67` |
| Pack ID | `2026-06-11_full_day_replay_source` |
| Pack build ID | `packbuild__2026-06-11_full_day_replay_source__352264ad-1deb-4da4-8ca2-bd55cd1b5f29` |
| Cadence GPT | `5m` |
| Run scope | `full_day` |
| Receipt ID | `v5_frozen_prepare_receipt__2026_06_11__0fd35d23ff12a8e3` |

La receipt persistée affirme et la base confirme :

- `run_created=false` ;
- `analytics_started=false` ;
- aucun document `desk_replay_runs` pour ce backtest ;
- aucun work item `READY` ou `CLAIMED` ;
- aucun config cible activé.

## État opérationnel final

Services actifs :

- `DeskFuturesApi` ;
- `DeskFuturesCaddy` ;
- `DeskFuturesTelegram`.

Services arrêtés et désactivés :

- `DeskFuturesLiveRuntime` ;
- `DeskFuturesReplayPreparation` ;
- `DeskFuturesBrokerManagement` ;
- `DeskFuturesCodexLive01` ;
- `DeskFuturesCodexLive02` ;
- `DeskFuturesCodexReplay01`.

Contrôles publics finaux :

- front HTTPS : `200` ;
- health : `200` ;
- readiness : `200`.

La prochaine étape d'activation devra être une décision opérateur distincte.
Elle devra retirer le hold, activer explicitement la seule config choisie puis
démarrer uniquement les workers nécessaires. Cette activation ne fait pas
partie du présent cutover.
