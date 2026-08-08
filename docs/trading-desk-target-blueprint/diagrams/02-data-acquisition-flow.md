# Diagram 02 — Data Acquisition and Provenance Flow

Référencé par `06-DATA-ACQUISITION-FEATURES-AND-PROVENANCE.md`.

```mermaid
flowchart LR
    DS["Data Source\n(ex: flux de marché)"] --> ING["Ingestion Layer"]
    ING --> IB["Ingestion Batch\n(horodaté, hash de provenance)"]
    IB --> DB["Dataset Builder"]
    DB --> DSET["Dataset\n(figé, provenance_hash)"]
    DSET --> FE["Feature Engine\n(calcul versionné)"]
    FE --> FV["Feature Value\n(immuable, horodaté)"]
    DSET --> SIM["Simulation Engine (08)"]
    FV --> SIM
    FE -.même code.-> LIVE["Live Strategy Runtime (10)\n(calcul en flux courant)"]
```

**Point structurant** (`06` §2.4) : le Feature Engine est invoqué à l'identique en mode simulation (sur un `Dataset` figé) et en mode live (sur un flux courant) — c'est ce qui garantit qu'une feature calculée en backtest a la même définition qu'en production.
