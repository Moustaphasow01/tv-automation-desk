# Front events resume contract

Ticket : TD2-1001.

## Surface

Le flux temps réel opérateur reste exposé sur :

- `/api/v1/events`

Le protocole cible est SSE. WebSocket pourra être ajouté plus tard uniquement si un besoin bidirectionnel réel apparaît ; le front actuel a surtout besoin de recevoir des changements d'état et de reprendre après coupure.

## Enveloppe

Chaque événement métier `operations` transporte une enveloppe `front_events_v1` :

- `schema_version` : `front_events_v1` ;
- `event_id` : curseur SSE stable ;
- `event_type` : type métier versionné ;
- `stream` : `operations`, `heartbeat` ou `error` ;
- `emitted_at_utc` ;
- `cursor` ;
- `payload`.

L'événement `operations` utilise un curseur content-addressed :

```text
front_events_v1:operations:<sha256(payload)>
```

Donc :

- même projection opérations = même cursor ;
- projection changée = nouveau cursor ;
- reconnexion avec `Last-Event-ID` ou `?cursor=` = pas de doublon si la projection n'a pas changé.

## Reprise front

Le hook front conserve le dernier `lastEventId` dans `localStorage` sous :

```text
desk.operations.events.cursor
```

À la reconnexion, il appelle :

```text
/api/v1/events?cursor=<lastEventId>
```

Le navigateur peut aussi transmettre `Last-Event-ID` pendant une reconnexion SSE native.

## Garanties

- Le flux est idempotent pour les snapshots identiques.
- Une coupure ne force pas un rechargement complet de tout le desk : le front invalide les queries opérations uniquement quand le snapshot change.
- Les heartbeats sont typés et ne déplacent pas le curseur opérations.
- Les erreurs sont typées et gardent le dernier curseur connu.

## Limite volontaire

Ce contrat ne promet pas encore un replay exhaustif de tous les événements intermédiaires pendant une coupure longue. Il garantit la reprise sur le dernier état matérialisé des opérations. Le replay exhaustif durable appartient à un futur event store backend, pas au flux SSE léger du front.
