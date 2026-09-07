# ADR 0032 — Secours Dorman pour le calendrier Export Sales

Date : 2026-09-07. Statut : implémenté localement, activation VPS non certifiée.
Propriétaire : Market Data / Calendar.

## Constat et décision

Le collecteur autonome VPS reçoit les calendriers officiels NASS et WASDE, mais
le point public FAS `scheduled-reports` répond actuellement `HTTP 403` depuis le
VPS. Le Desk ne calcule pas les jeudis, ne transforme pas une observation
courante en connaissance historique et ne dépend d'aucun relais PC.

La politique `GRAINS_CALENDAR_SOURCE_POLICY_V1_USDA_DIRECT` reste le défaut. La
politique opt-in `GRAINS_CALENDAR_SOURCE_POLICY_V2_DORMAN_FAS403` autorise Dorman
Trading comme `SECONDARY_PUBLISHER` uniquement après l'échec exact
`USDA_SOURCE_HTTP_403` de FAS. Elle ne présente jamais Dorman comme USDA/FAS :
la provenance conserve `provider=DORMAN_TRADING`, `upstream_claim=USDA` et le
motif d'activation. Le motif ne vient jamais du document Dorman : le collecteur
archive une observation structurée de l'échec FAS, avec heure, URL et SHA-256,
puis la lie au hash et au `knownAt` de la version. Append et load revalident cette
preuve. Tout autre échec FAS reste indisponible.

Dorman publie une page annuelle publique qui lie douze PDF mensuels. Le runtime
valide l'hôte et les chemins exacts, exige les douze liens de l'année, puis ne
télécharge que les mois couvrant la fenêtre demandée. Chaque octet est borné,
hashé et archivé avec son heure réelle de réception avant analyse. Le manifeste
composite conserve les reçus et leur SHA-256 ; son `knownAt` est la réception la
plus tardive. Aucune date de publication fournisseur n'est inférée.

Le ledger impose encore `source_published_at_utc NOT NULL` comme borne anti-
lookahead commune. Pour compatibilité, l'événement Dorman y porte l'heure de
réception, et son payload précise `knowledge_timestamp_basis=DOCUMENT_RECEIPT_AT_RUNTIME`,
`received_at_utc` et `provider_publication_time_status=UNKNOWN`. Cette valeur ne
constitue donc pas une affirmation sur la date de publication par Dorman.

## Extraction et sécurité

L'extracteur lit les cellules textuelles positionnées du PDF : titre mois/année,
six colonnes lundi-samedi, toutes les dates imprimées, légende Central, attribution
USDA, avertissement de modification et libellé exact `Export Sales 7:30`. Il
associe chaque libellé à la cellule de date située dans sa colonne et sa ligne ;
il ne génère aucune récurrence. La notation est interprétée par cette politique
comme `07:30 America/Chicago`. Toute ambiguïté de structure, de position, d'heure,
de couverture ou de doublon ferme la couverture.

Les PDF sont analysés avec `unpdf` épinglé en `1.8.1` (MIT, PDF.js embarqué sous
Apache-2.0), sans canvas. Le backend exige Node.js 22 ou supérieur. L'analyse a
lieu dans un worker isolé, à mémoire bornée, sans argument d'exécution hérité,
terminé par le parent après cinq secondes et fermé après usage. Le PDF commercial
n'est ni commité ni redistribué ; seuls les faits calendrier, hashes et reçus
internes sont persistés.

## Qualification et conflits

NASS et WASDE officiels restent obligatoires. V2 accepte le groupe Export Sales
si FAS direct est qualifié, ou si Dorman est qualifié avec une observation 403
primaire archivée et des reçus intègres. Si des jeux primaire et secondaire sont fournis ensemble, leurs
horodatages explicites doivent être identiques dans la fenêtre ; un conflit rend
la version `UNKNOWN_COVERAGE` et le primaire reste le seul jeu canonique exposé.
Une politique inconnue, une provenance altérée ou des reçus incomplets est refusée.

Les versions V2 restent soumises à la fraîcheur maximale de six heures. Une
collecte actuelle ne requalifie jamais un replay antérieur ni une couverture OOS.
Une collecte partielle reste visible et archivable mais non admissible ; elle ne
prolonge pas le dernier succès.

## Alternatives et retour arrière

Ont été écartés : projection hebdomadaire, proxy/relais PC, contournement WAF,
alias CDN non qualifié et antidatage de la réception. Le retour arrière consiste
à remettre la variable `DESK_GRAINS_CALENDAR_SOURCE_POLICY` à V1 (ou à l'omettre),
sans réécrire les versions déjà reçues. L'activation VPS et toute décision de
redistribution restent des décisions opérationnelles séparées.

## Preuves exigées avant activation

- tests unitaires extraction, index annuel, hôte/chemins, archives binaires,
  provenance, motif 403, conflits, fraîcheur et ledger PostgreSQL ;
- extraction réelle des PDF 2026, dont les exceptions explicites du 11 septembre
  et du 27 novembre, sous Node 22+ et Windows ;
- accès direct depuis le VPS, audit npm et vérification du lockfile ;
- aucune écriture production pendant la qualification.
