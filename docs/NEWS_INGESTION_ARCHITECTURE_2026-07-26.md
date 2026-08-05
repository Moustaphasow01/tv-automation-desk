# Flux de news éditoriales — architecture locale et VPS

## Objectif

Le calendrier macro et les news éditoriales sont deux sources indépendantes. Le calendrier contient des événements passés et futurs autour du cutoff. Les news ne contiennent que des articles déjà publiés au cutoff.

## Source active

- Provider : GDELT DOC 2.0.
- Transport : JSON Article List, fenêtre de 48 heures, tri antéchronologique.
- Authentification : aucune clé.
- Cadence : 15 minutes, avec anti-throttle de 10 minutes.
- Limite : 100 articles reçus par cycle, extensible à 250.
- Rétention PostgreSQL : 90 jours.

L’adaptateur est isolé dans `news-ingestion-service.js`. Un provider payant comme Finnhub pourra être ajouté sans modifier les tables, l’API front ou les contrats V4.

## PostgreSQL

- `news_sources` : configuration et santé des providers.
- `news_articles` : articles dédupliqués, cutoff, domaines, actifs, instruments et sujets.
- `news_ingestion_runs` : journal complet des collectes et erreurs.

Les URLs canoniques sont uniques. Les index temporels et GIN permettent les lectures par cutoff, actif, instrument et sujet.

## Chaîne d’exécution

1. Le scheduler LIVE appelle l’ingestion même lorsque le marché est fermé.
2. Le provider retourne ses articles publiés.
3. Le service normalise les dates UTC, URLs et domaines.
4. Le filtre éditorial retire les petites annonces, comparatifs automatiques et doublons de titre.
5. Le classifieur déterministe conserve uniquement les sujets utiles au desk.
6. PostgreSQL déduplique les articles et journalise le run.
7. Le BFF retourne les 48 dernières heures, toujours filtrées au cutoff.
8. Le `LocalPackBuilder` fige ces mêmes articles dans `news_digest`.
9. Master, Monitor et Replay ne lisent ensuite que le dataset immuable du pack.

Les migrations `013_news_ingestion.sql` et `014_news_runtime_grants.sql` séparent
la création propriétaire du schéma des droits CRUD strictement nécessaires au
rôle applicatif `desk_runtime`.

## Déploiement vérifié

- Release VPS : `vps-staging-20260726.15`.
- Scheduler LIVE : `healthy`.
- Provider : `GDELT`, dernier run `READY`.
- Front public : calendrier macro et news éditoriales affichés ensemble.
- Contrats Master V4 et Monitor : inchangés et protégés par leur garde.

## Dégradation

- Une erreur provider produit un run `FETCH_FAILED` et une alerte `NEWS_INGESTION`.
- Aucun article n’est fabriqué.
- Le front conserve le calendrier macro comme fallback.
- Le dernier contenu déjà stocké reste lisible dans sa fenêtre de 48 heures.

## Variables

- `DESK_NEWS_ENABLED`
- `DESK_NEWS_GDELT_URL`
- `DESK_NEWS_GDELT_QUERY`
- `DESK_NEWS_REFRESH_MS`
- `DESK_NEWS_MIN_REFRESH_MS`
- `DESK_NEWS_TIMEOUT_MS`
- `DESK_NEWS_MAX_RECORDS`
- `DESK_NEWS_RETENTION_DAYS`
