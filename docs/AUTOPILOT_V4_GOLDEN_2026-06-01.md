# Référence golden — 1er juin 2026

Cette journée sert de preuve de compatibilité entre le workflow V4 historique
et PREPROD PostgreSQL.

## Scope

- session : `asia_open`
- départ : `2026-06-01T00:00:00+02:00`
- fin : `2026-06-01T20:00:00+02:00`
- source : pack replay immuable sans fallback LIVE
- cadence de validation : celle portée par la configuration du replay

## Contrats de référence

Les empreintes doivent rester identiques à la référence PROD capturée avant le
chantier :

- Master V4 :
  `702f9fe325f61fdb53e913592da268b5a4aa2bafe5dd879ece915adc64d1c8e8`
- Monitor V1 :
  `be807ab3cb0450d0c84817d882a4b6dea70ea3ccae377d07da545798d80a6bd0`
- Front V1 :
  `f1109aa10a3a9ff1ee4c45eb9f303bc31ee6734ec605da70ef9fd36d5fc79d94`

## Comparaison attendue

Pour un même `pack_build_id` et un même cutoff :

- les identifiants de datasets et leurs hashes sont identiques ;
- aucun enregistrement postérieur au cutoff n'est visible ;
- `source_coverage`, `data_quality` et les informations de contrat ont la
  même forme ;
- les payloads suggérés pour les saves contiennent les mêmes invariants ;
- les différences admises se limitent aux métadonnées d'environnement et aux
  URI physiques locales.

Les décisions analytiques GPT ne sont pas figées comme golden : ce sont les
entrées, contrats, transitions et écritures qui le sont.

## Validation PREPROD du 20 juillet 2026

Le run de preuve est :
`preprod_v4_golden_20260601_validation_v2`.

- `pack_build_id` :
  `packbuild__2026-06-01_asia_open_replay_source__665d45ec-d8d6-428e-ae05-b615f5c19759`
- `source_manifest_hash` :
  `816f2a1b8872410d081c37f949da72de5735c2aaff14e09edaedd24378e7d305`
- contrat Master :
  `702f9fe325f61fdb53e913592da268b5a4aa2bafe5dd879ece915adc64d1c8e8`
- contrat Monitor :
  `be807ab3cb0450d0c84817d882a4b6dea70ea3ccae377d07da545798d80a6bd0`
- Master matérialisé avec sa thèse dans une transaction locale ;
- horloge avancée de `00:00` à `00:15` Paris ;
- bundle Monitor préparé à la révision `4` ;
- anti-lookahead valide et exécution autorisée ;
- aucune collection LIVE utilisée ;
- run classé `preprod_v4_validation/history/read_only` après la preuve afin
  qu'il ne déclenche aucune alerte opérationnelle.

Cette validation utilise une sortie analytique de fixture uniquement pour
éprouver les écritures et transitions. Elle ne remplace pas une analyse GPT.

## Limite de données locale connue

La journée golden du 1er juin est complète grâce à ses objets immuables
miroir. En revanche, un pack construit uniquement depuis les flux SQL du
17 juillet est actuellement `degraded_optional` :

- indices Asie/Europe absents ;
- mégacaps premarket absentes ;
- source locale de news non configurée.

Les datasets cœur, les taux, DXY/CL/GC/VIX et le calendrier macro sont bien
produits. Le builder échoue fermé si un dataset cœur manque ; les trois
familles ci-dessus restent un chantier d'ingestion avant exploitation VPS
avec la richesse complète de PROD.
