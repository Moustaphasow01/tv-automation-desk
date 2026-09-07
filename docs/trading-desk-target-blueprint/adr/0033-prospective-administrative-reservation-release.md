# ADR 0033 — Clôture administrative prospective des réservations anciennes

Date : 2026-09-07. Statut : accepté pour les deux lots explicitement autorisés.

## Constat et autorité

L'opérateur atteste qu'aucun ordre manuel ni position réelle ne reste ouvert pour
huit dossiers invalid-origin puis, séparément, pour 49 autres réservations anciennes.
Cette attestation actuelle ne prouve ni une absence historique d'exécution, ni une
expiration, ni un résultat financier. Le statut EXPIRED sans preuve de bougie ne
suffit pas non plus à produire un résultat théorique.

## Décision

`portfolio-risk` possède deux audits append-only : adjudication invalid-origin 066,
annulation administrative générale 067. Le second lot n'est pas reclassé invalid-origin.
L'application valide le manifeste exact, l'attestation, les révisions, les empreintes
et l'absence actuelle d'indices d'exécution contradictoires. Une prévisualisation est
obligatoire dans le protocole opérationnel, puis une transaction atomique par lot.

La réservation disparaît uniquement après **date effective et date de connaissance**.
Les consultations antérieures la conservent. Aucun fill, événement d'expiration,
trade, R ou PnL n'est créé, modifié ou supprimé par la clôture administrative.

`execution` exclut ces dossiers de ses nouveaux candidats et refuse un candidat
retardé au moment de l'écriture. Les verrous de lineage sont acquis avant la lecture
des preuves ; une seconde lecture observe les transactions antérieures terminées.
Un trigger de sécurité empêche l'écriture d'exécution après clôture, y compris par
un writer qui attendait le verrou. Le protocole est éprouvé en READ COMMITTED,
l'isolation utilisée par les writers runtime ; il n'est pas une certification pour
un intégrateur externe utilisant REPEATABLE READ/SERIALIZABLE.

Les 57 dossiers exacts ont tous `trade_order_intent_id = null`, vérifié sur VPS.
Le garde portfolio couvre ce périmètre ; son extension à d'autres lots ou chemins
legacy demanderait une qualification nouvelle, pas une réutilisation arbitraire.

## Opérations et vérification

`operations` exige release/empreintes exactes, backup récent vérifié, arrêt des
producteurs, barrière de maintenance détenue, hash de configuration commun entre
drain et application. La reprise respecte les états précédents et reste distincte
d'une activation AUTO/LIVE ou d'un dégel des workers IA.

Tests : atomie, manifeste modifié refusé, CAS, idempotence, événements contradictoires,
historique avant connaissance conservé, concurrence dans les deux sens, absence de
réactivation après backfill, neutralité des résultats financiers. La suite PostgreSQL
réelle possède un job CI dédié ; une suite conditionnelle ignorée ne la remplace pas.

Alternatives refusées : supprimer les lignes anciennes, changer EXPIRED en résultat
historique inventé, remplacer le risque inconnu par zéro, appliquer une règle d'âge
générique, ou modifier les budgets pour absorber artificiellement ces réservations.
