# Passation Claude — redesign complet du frontend Desk Futures

> Snapshot fonctionnel généré par `npm run handoff:claude`. Ce fichier est volontairement autonome : contexte produit, inventaire des écrans, contraintes, architecture et code/CSS actuels.

## Documents complémentaires

- `docs/front-redesign/MANIFEST.md` définit la séparation des rôles : Claude décide du design, Codex l'implémente ensuite.
- `docs/front-redesign/PROMPT.md` contient le prompt prêt à copier dans Claude.

## Mission confiée à Claude

Redesigner profondément le frontend, aujourd’hui jugé visuellement faible et mal organisé, en utilisant les skills de design/frontend disponibles. Le résultat attendu doit être cohérent, dense mais lisible, professionnel, responsive et réellement connecté au backend existant.

Le redesign peut réorganiser les composants React, la navigation, le design system et le CSS. Il ne doit pas modifier les contrats métier, supprimer un parcours, remplacer les données réelles par des mocks ou contourner les confirmations opérateur.

## Diagnostic du frontend actuel

- Deux langages visuels cohabitent : les anciens écrans Live basés sur `SectionTitle` et les nouveaux écrans Operations basés sur `WorkspaceNav`/`PageHeading`.
- La navigation principale mélange temps réel, recherche, opérations, historique et gouvernance dans une liste plate trop longue.
- Le sous-menu Operations/Replay est ajouté dans le contenu, ce qui duplique la navigation globale.
- `globals.css` est un monolithe global de plus de 1 000 lignes avec des styles historiques et récents entremêlés.
- Plusieurs pages sont du JSX très compact, parfois sur une seule ligne, ce qui rend leur structure difficile à faire évoluer.
- Les tableaux, cartes, formulaires, états vides, détails et inspecteurs JSON ne partagent pas toujours le même gabarit.
- La taxonomie mélange français et anglais : Live Desk, Control plane, Research workspace, Long-term memory, etc.
- Le niveau de densité et la hiérarchie visuelle varient fortement entre le Live Desk, Replay Lab et les pages de gouvernance.
- Certains détails historiques utilisent encore un drawer alors que les nouveaux détails utilisent des écrans routés.

## Principes non négociables

1. Conserver toutes les routes et tous les parcours fonctionnels listés ci-dessous.
2. Continuer à lire les API réelles via TanStack Query. Aucun mock dans le code de production.
3. Ne pas changer les contrats backend, les identifiants, les statuts ni les payloads d’action sans chantier backend explicite.
4. Les actions sensibles gardent : révision attendue, clé d’idempotence, justification et phrase `CONFIRM_<ACTION>`.
5. Préserver la séparation entre setup théorique, position canonique et absence totale d’exécution broker depuis ces écrans.
6. Les détails profonds s’ouvrent dans de vrais écrans, avec fil d’Ariane et retour. Ne pas empiler des cartes ou drawers pour Replay/Workflow/GPT.
7. Une journée Replay peut avoir plusieurs sessions, plusieurs variantes et plusieurs tentatives de la même session.
8. La timeline Replay doit rester zoomable, synchronisée au prix et filtrable par couches décision/étape/GPT.
9. Prévoir desktop dense, tablette et mobile 320 px sans débordement horizontal global.
10. La migration VPS/OVH est un chantier séparé et ne doit pas influencer ce redesign.

## Architecture fonctionnelle cible suggérée

Organiser la navigation en quatre espaces stables plutôt qu’en une liste plate :

- **Temps réel** : Live Desk, Master, Monitors, Thèse, Setup & Position, Macro & News, Journal.
- **Automatisation** : Cockpit Operations, workflows, incidents.
- **Recherche** : Replay Lab, comparaison, performance, historique.
- **Gouvernance** : stratégies, versions, audit, alertes et paramètres de session.

Sur desktop, privilégier une sidebar persistante groupée et repliable, complétée par un header contextuel. Sur mobile, garder cinq destinations majeures et ouvrir le reste dans un menu structuré. Le contexte de session automatique Europe/Paris doit rester visible sans prendre le dessus sur le titre de la page.

## Parcours métier à préserver

### Parcours Live

`Session automatique → Master → Monitors → Thèse active → Setup → Position → Clôture → Journal/Audit`

### Parcours automatisation

`Cockpit Operations → Workflow → Étape/événement → Action confirmée → Audit/incident`

### Parcours Replay

`Replay Lab → Run → Journée → Session/variante/tentative → Timeline → Processus GPT → Conclusion`

### Parcours recherche et gouvernance

`Performance/Comparaison → Historique → Stratégie → Versions → Diff structurel`

## Inventaire des écrans et contexte de chacun

### A. Temps réel et décision

| Route | Écran | Contexte métier et contenu critique | Attente de redesign |
|---|---|---|---|
| `/live` | Live Desk | Écran d’entrée du desk pour la session automatique courante. Agrège prix/OHLC, lecture du marché, thèse, setup/position, qualité des données, activité workers et journal. Doit répondre immédiatement : que se passe-t-il, quelle est la décision et faut-il intervenir ? | En faire un vrai cockpit priorisé, avec une hiérarchie claire entre état du marché, décision, risque et activité secondaire. |
| `/sessions` | Sessions | Explique la sélection automatique Asia/London/New York selon Europe/Paris, l’état des deux contextes de stratégie et la prochaine transition. | Présenter la chronologie de journée et le contexte actif, sans donner l’impression d’un sélecteur manuel quand la sélection est automatique. |
| `/master` | Master Analysis | Plan initial figé au cutoff : biais, scénarios, niveaux, chemins attendu/échec, playbook de monitoring et chapitres complets du contrat Master. | Transformer le long empilement de cartes en document analytique scannable avec sommaire, niveaux saillants et scénarios comparables. |
| `/monitors` | Monitors | Série chronologique des contrôles GPT de la thèse : attendu/réalisé, delta, score, WAIT→GO, invalidations et décision de replan. | Donner une lecture temporelle évidente et faciliter la comparaison entre checkpoints sans noyer les conditions. |
| `/thesis` | Thèse active | État vivant issu du Master et actualisé par les Monitors : statut, confiance, niveaux, conditions et invalidations actuelles. | Créer une fiche de thèse centrale, lisible en quelques secondes, distinguant faits, interprétation, conditions et invalidation. |
| `/setup` | Setup & Position | Sépare le plan théorique de l’exécution canonique. Affiche géométrie entrée/SL/TP, risque, statut et capacités opérateur sécurisées. | Mettre la sécurité et la distinction plan/exécution au centre. Les actions confirmées doivent être explicites, jamais ambiguës. |
| `/timeline` | Journal de décision | Trace Master → Thèse → Monitor → Setup → Position, avec événements, acteurs et références. | Utiliser une timeline verticale structurée, filtrable, avec détails accessibles mais pas affichés en permanence. |
| `/news` | Macro & News | Calendrier macro quotidien à l’heure de Paris, prochain événement, fenêtres rouges et headlines complémentaires. | Prioriser le prochain risque temporel et réduire le bruit éditorial. |
| `/audit` | Audit | Contrats actifs, qualité, anti-lookahead, sources, avertissements et mapping API. Écran de confiance technique et métier. | Séparer clairement conformité, qualité de données et diagnostic technique avec niveaux de sévérité cohérents. |
| `/alerts` | Centre d’alertes Live | Alertes de la session courante provenant du read model Live. Différent du cycle d’incidents global Operations. | Clarifier cette différence et permettre de comprendre la cible et l’urgence de chaque alerte. |
| `/performance` | Calendrier R | Calendrier mensuel du résultat net quotidien en R ; un drawer ouvre le détail d’une journée. | Harmoniser avec l’analyse globale. Le drawer historique peut devenir un écran routé si cela améliore la cohérence. |

### B. Automatisation et supervision

| Route | Écran | Contexte métier et contenu critique | Attente de redesign |
|---|---|---|---|
| `/operations` | Cockpit des opérations | Vue globale de tous les jobs, replays, backtests et feature runs normalisés. KPIs, filtres, recherche, progression, attente GPT, blocages et incidents. | Concevoir un control plane dense : KPI utiles, filtres persistants, tableau performant et interventions évidentes. |
| `/operations/incidents` | Incidents & alertes | Cycle de vie global des alertes/erreurs/data quality : open, acknowledged, snoozed, resolved, reopened. Actions révisionnées et auditées. | Créer une inbox opérationnelle claire avec priorité, âge, cible, propriétaire implicite et action suivante. |
| `/operations/workflows/:workflowId` | Détail workflow | État canonique, progression, durée, étapes, événements et actions autorisées : pause, reprise, retry ou annulation selon le type/état. | Structurer comme une fiche d’exécution avec header d’état, stepper, journal et zone d’action séparée. |
| `/operations/workflows/:workflowId/events/:eventId` | Détail événement | Une transition précise du workflow : type, horodatage, statut, acteur, référence et payload projeté. | Faire un écran de diagnostic concis ; le JSON brut doit rester secondaire et repliable. |

### C. Replay Lab et processus GPT

| Route | Écran | Contexte métier et contenu critique | Attente de redesign |
|---|---|---|---|
| `/replay` | Replay Lab | Vue de toutes les journées et runs, progression, résultat R, erreurs, sessions. Permet de créer un replay réel à partir d’un pack/build immuable. | Offrir une vue portefeuille/recherche, des filtres temporels et une création guidée qui explique pack, cadence et session. |
| `/replay/compare` | Comparaison Replay | Sélection de 2 à 8 runs/variantes/tentatives et comparaison des métriques canoniques. | Rendre la sélection et les écarts visuellement comparables ; éviter une simple juxtaposition de cartes. |
| `/replay/runs/:runId` | Vue run | Synthèse d’un run : statut, stratégie, progression, performance, journées, timeline et processus GPT associés. | En faire le hub du run avec résumé décisionnel et accès clair aux journées/sessions. |
| `/replay/runs/:runId/days/:date` | Journée Replay | Matrice de toutes les exécutions du jour. Une même session peut avoir plusieurs variantes et tentatives numérotées. | Utiliser un tableau/matrice dense et responsive qui rend immédiatement visibles session, variante, tentative, état et résultat. |
| `/replay/runs/:runId/days/:date/sessions/:sessionExecutionId` | Session Replay | Détail d’une exécution : métriques, timeline prix/décisions zoomable, couches décision/étape/GPT, événements et processus GPT. | C’est l’écran analytique principal : maximiser la surface du graphique, synchroniser sélection et détails, conserver une timeline de secours. |
| `/replay/runs/:runId/gpt/:processId` | Inspecteur GPT | Cycle d’un work item GPT : statut, durée, tentative, bundle, manifest, save target, lease, erreurs, événements, décision et conclusion. | Présenter le lifecycle comme un pipeline inspectable ; rendre la conclusion lisible et les données techniques progressives. |

### D. Analyse, mémoire et gouvernance

| Route | Écran | Contexte métier et contenu critique | Attente de redesign |
|---|---|---|---|
| `/performance/analysis` | Analyse de performance | Consolidation réelle des trades par journée, session, instrument et direction : R, win rate et autres ventilations. | Créer un espace analytics avec filtres partagés, graphiques utiles et tableaux de drill-down. |
| `/history` | Historique des sessions | Mémoire consolidée construite à partir des workflows persistés : date, session, état, nombre de workflows et performance. | Mettre en place recherche, filtres et regroupements temporels ; éviter une simple liste de cartes. |
| `/history/sessions/:sessionId` | Session historique | Détail d’une session passée et tableau de ses workflows. | Réutiliser les patterns du cockpit sans perdre le contexte historique. |
| `/strategies` | Stratégies & versions | Catalogue, configuration, runtime, contrats actifs et historique des versions. | Concevoir une vue de gouvernance comparable à un registry, avec santé et version courante visibles. |
| `/strategies/:strategyId` | Détail stratégie | Versions publiées, contrats, configuration courante et comparaison structurelle de deux versions. | Remplacer le JSON-first par un diff lisible, tout en gardant l’inspecteur brut disponible. |
| `/more` | Navigation complète | Accès mobile/secondaire à tous les espaces du Desk. | Le transformer en menu organisé par domaines, identique à la taxonomie desktop. |

## États transverses à designer

Chaque famille d’écran doit disposer de composants cohérents pour : chargement initial, rafraîchissement discret, erreur récupérable, état vide, données partielles/stale, accès interdit, révision conflictuelle, action en cours, action réussie et échec d’action.

Les statuts normalisés Operations sont : `queued`, `running`, `waiting_gpt`, `paused`, `blocked`, `failed`, `completed`, `cancelled`, `unknown`. Le Live Desk possède également ses statuts métier propres ; ne pas les fusionner aveuglément.

## Données, rafraîchissement et sécurité

- React 18, React Router 6 avec `HashRouter`, TanStack Query 5 et TypeScript.
- Le contexte Live sélectionne automatiquement `asia_open` ou `ny_open` selon la phase Europe/Paris.
- Les read models Live sont rafraîchis séparément selon leur criticité.
- Operations utilise polling + SSE `/api/v1/events` pour invalider les queries.
- Les écritures passent par le BFF local avec clé API de préproduction ; ne pas concevoir de dépendance à un fournisseur d'auth cloud côté front.
- Les données indisponibles doivent être indiquées honnêtement ; ne jamais inventer prix, résultats, conclusions ou états.

## Critères d’acceptation visuels et UX

- Un utilisateur doit identifier en moins de cinq secondes : contexte, état, anomalie et action suivante.
- Aucune page ne doit ressembler à une accumulation indifférenciée de cartes.
- Tables et timelines doivent rester efficaces avec de gros volumes.
- Le graphique Replay doit être le centre de l’écran session sur desktop.
- Tous les écrans profonds ont un fil d’Ariane et un retour prévisible.
- Les couleurs de statut restent accessibles et ne sont jamais le seul vecteur de sens.
- Navigation clavier, focus visibles, labels de formulaire et zones tactiles mobiles correctes.
- Vérification obligatoire aux largeurs 320, 768, 1280 et 1600 px.
- Conserver les tests fonctionnels ; mettre à jour uniquement les assertions de présentation devenues obsolètes.

## Ordre de travail recommandé à Claude

1. Définir tokens, typographie, grilles, densité, statuts et composants de base.
2. Refaire `AppShell` et l’architecture de navigation par domaines.
3. Créer des gabarits communs : cockpit, index/tableau, détail d’exécution, analyse, document métier.
4. Refaire Operations et Replay Session comme écrans pilotes à forte densité.
5. Migrer le Live Desk et les écrans décisionnels vers le même design system.
6. Migrer historique, performance et gouvernance.
7. Consolider le CSS, tester responsive/accessibilité et exécuter TypeScript + React + E2E réel.

## Code source et CSS actuels

Les fichiers ci-dessous sont copiés intégralement. Les tests ne sont pas inclus afin de garder ce document centré sur le redesign ; ils restent disponibles dans le dépôt.

### `index.html`

````html
<!doctype html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#0a0e14" />
  <meta name="description" content="Desk Futures — cockpit mobile de décision" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" href="/desk-mark.svg" type="image/svg+xml" />
  <title>Desk Futures</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
````

### `package.json`

````json
{
  "name": "tv-automation-desk-front",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc -b && vite build",
    "preview": "vite preview --host 0.0.0.0",
    "typecheck": "tsc -b --pretty false",
    "test:react": "vitest run --pool=threads --maxWorkers=1 --no-file-parallelism",
    "pretest:e2e": "VITE_DESK_API_KEY=e2e-operator-key vite build --mode development",
    "test:e2e": "playwright test",
    "test:stack": "bash scripts/stack/test_real_stack.sh",
    "test:front": "npm run test:react && npm run test:e2e",
    "handoff:claude": "node scripts/handoff/build_claude_front_handoff.mjs"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.59.20",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.61.1",
    "@types/node": "^26.1.1",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^6.0.3",
    "typescript": "^5.8.3",
    "vite": "^8.1.4",
    "vitest": "^4.1.10"
  }
}
````

### `public/desk-mark.svg`

````xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="16" fill="#080b10"/>
<path d="M14 43V21h12c9 0 15 4 15 11s-6 11-15 11H14Z" fill="none" stroke="#9dff57" stroke-width="6"/>
<path d="M43 21v22" stroke="#59c8ff" stroke-width="6" stroke-linecap="round"/>
</svg>
````

### `public/manifest.webmanifest`

````json
{
  "name": "Desk Futures",
  "short_name": "Desk",
  "start_url": "/live",
  "display": "standalone",
  "background_color": "#080b10",
  "theme_color": "#080b10",
  "icons": [{ "src": "/desk-mark.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }]
}
````

### `public/sw.js`

````js
const CACHE = "desk-futures-react-v1";
const SHELL = ["./", "./index.html", "./desk-mark.svg", "./manifest.webmanifest"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match("./index.html")))
  );
});
````

### `src/api/deskApi.ts`

````tsx
import { deskEndpoints } from "@/api/endpoints";
import { getOperatorIdToken } from "@/api/operatorAuth";
import type {
  DeskApi,
  DeskDetailScope,
  DeskOperatorCommandResult,
  DeskOperatorScope,
  DeskOperatorState,
  DeskSession,
  SessionId
} from "@/types";

const apiBase = String(import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/+$/, "");

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `API ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function postOperatorJson<T>(path: string, body: unknown): Promise<T> {
  const token = await getOperatorIdToken();
  const devApiKey = String(import.meta.env.VITE_DESK_API_KEY || "");
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(devApiKey ? { "X-Desk-Api-Key": devApiKey } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : devApiKey ? { Authorization: `Bearer ${devApiKey}` } : {})
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    throw new Error(payload?.code ? `${payload.code}: ${payload.error || response.statusText}` : payload?.error || `API ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

const sessionPath = (path: string, id: SessionId) => `${path}?session=${encodeURIComponent(id)}`;
const detailPath = (path: string, scope: DeskDetailScope) => {
  const query = new URLSearchParams({
    session: scope.session,
    strategy_id: scope.strategyId,
    trading_date: scope.date
  });
  return `${path}?${query.toString()}`;
};

const operatorPath = (scope: DeskOperatorScope) => {
  const query = new URLSearchParams({
    session: scope.session,
    strategy_id: scope.strategyId,
    trading_date: scope.tradingDate,
    mode: scope.mode
  });
  return `${deskEndpoints.operatorState}?${query.toString()}`;
};

const performancePath = (path: string, id: SessionId, values: Record<string, string | number>) => {
  const strategyId = id === "ny_open" ? "ny_open_1530" : "asia_open";
  const query = new URLSearchParams({ session: id, strategy_id: strategyId });
  Object.entries(values).forEach(([key, value]) => query.set(key, String(value)));
  return `${path}?${query.toString()}`;
};

const restApi: DeskApi = {
  getSession: id => getJson<DeskSession>(sessionPath(deskEndpoints.liveDesk, id)),
  getMarketSnapshot: id => getJson(sessionPath(deskEndpoints.marketSnapshot, id)),
  getPosition: id => getJson(sessionPath(deskEndpoints.position, id)),
  getMacroCalendar: id => getJson(sessionPath(deskEndpoints.macroCalendar, id)),
  getNewsDigest: id => getJson(sessionPath(deskEndpoints.newsDigest, id)),
  getNewsHeadlines: id => getJson(sessionPath(deskEndpoints.newsHeadlines, id)),
  getDeskActivity: id => getJson(sessionPath(deskEndpoints.deskActivity, id)),
  getAlerts: id => getJson(sessionPath(deskEndpoints.alerts, id)),
  getAudit: id => getJson(sessionPath(deskEndpoints.audit, id)),
  getPerformanceCalendar: (id, year, month, pricingMode) => getJson(performancePath(deskEndpoints.performanceCalendar, id, { year, month, pricing_mode: pricingMode })),
  getPerformanceDay: (id, date, pricingMode) => getJson(performancePath(deskEndpoints.performanceDay, id, { date, pricing_mode: pricingMode })),
  getTimeline: scope => getJson(detailPath(deskEndpoints.timeline(scope.strategyId, scope.date), scope)),
  getMaster: (masterId, scope) => getJson(detailPath(deskEndpoints.master(masterId), scope)),
  getMonitor: (monitorId, scope) => getJson(detailPath(deskEndpoints.monitor(monitorId), scope)),
  getThesis: (thesisId, scope) => getJson(detailPath(deskEndpoints.thesis(thesisId), scope)),
  getThesisConditions: (thesisId, scope) => getJson(detailPath(deskEndpoints.thesisConditions(thesisId), scope)),
  getSetup: (setupId, scope) => getJson(detailPath(deskEndpoints.setup(setupId), scope)),
  getOperatorState: scope => getJson<DeskOperatorState>(operatorPath(scope)),
  executeOperatorCommand: input => postOperatorJson<DeskOperatorCommandResult>(deskEndpoints.operatorCommands, input)
};

export const deskApi = restApi;
````

### `src/api/endpoints.ts`

````tsx
const pathPart = (value: string) => encodeURIComponent(value);

export const deskEndpoints = {
  liveDesk: "/live-desk/current",
  timeline: (strategyId: string, date: string) => `/sessions/${pathPart(strategyId)}/${pathPart(date)}/timeline`,
  master: (masterId: string) => `/masters/${pathPart(masterId)}`,
  monitor: (monitorId: string) => `/monitors/${pathPart(monitorId)}`,
  thesis: (thesisId: string) => `/theses/${pathPart(thesisId)}`,
  thesisConditions: (thesisId: string) => `/theses/${pathPart(thesisId)}/conditions`,
  setup: (setupId: string) => `/setups/${pathPart(setupId)}`,
  position: "/positions/current",
  marketSnapshot: "/market/snapshot",
  macroCalendar: "/macro/calendar",
  newsHeadlines: "/news/headlines",
  newsDigest: "/news/digest",
  deskActivity: "/desk/activity",
  alerts: "/alerts",
  audit: "/audit",
  performanceCalendar: "/performance/calendar",
  performanceDay: "/performance/day",
  operatorState: "/operator/state",
  operatorCommands: "/operator/commands",
  openApi: "/openapi.json"
} as const;

export const refreshPolicyMs = {
  market: 30_000,
  news: 90_000,
  newsDigest: 300_000,
  macro: 300_000,
  macroNearEvent: 45_000,
  activePosition: 10_000,
  deskActivityRunning: 10_000,
  deskActivityIdle: 30_000,
  alerts: 15_000,
  audit: 60_000,
  projection: 30_000,
  performance: 60_000
} as const;
````

### `src/api/operationsApi.ts`

````tsx
import { getOperatorIdToken } from "@/api/operatorAuth";
import type {
  DeskHistory, GptProcessDetail, GptProcessList, HistorySessionDetail, IncidentList, ObservabilityOverview,
  NotificationActionInput, NotificationList, NotificationSync, ObservabilityIncidentSync, ObservabilityPolicyActionInput,
  ObservabilityPolicyResponse, OperationsCommandInput, OperationsSummary,
  PerformanceOverview, ReplayDayDetail, ReplayList, ReplayRunDetail, ReplaySessionDetail, RunbookDetail, RunbookList, StrategyList,
  StrategyVersionComparison, WorkflowDetail, WorkflowList
} from "@/operationsTypes";

const apiBase = String(import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/+$/, "");
const part = (value: string) => encodeURIComponent(value);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = init?.method === "POST" ? await getOperatorIdToken() : null;
  const devApiKey = String(import.meta.env.VITE_DESK_API_KEY || "");
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(devApiKey && init?.method === "POST" ? { "X-Desk-Api-Key": devApiKey } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : devApiKey && init?.method === "POST" ? { Authorization: `Bearer ${devApiKey}` } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    throw new Error(payload?.code ? `${payload.code}: ${payload.error || response.statusText}` : payload?.error || `API ${response.status}`);
  }
  return response.json() as Promise<T>;
}

const query = (values: Record<string, string | number | null | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => value !== null && value !== undefined && value !== "" && params.set(key, String(value)));
  const text = params.toString();
  return text ? `?${text}` : "";
};

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const operationsApi = {
  getSummary: () => request<OperationsSummary>("/operations/summary"),
  listWorkflows: (filters: Record<string, string | number | null | undefined> = {}) => request<WorkflowList>(`/workflows${query(filters)}`),
  getWorkflow: (id: string) => request<WorkflowDetail>(`/workflows/${part(id)}`),
  executeWorkflowAction: (id: string, input: OperationsCommandInput) => post(`/workflows/${part(id)}/actions`, input),
  listReplays: (filters: Record<string, string | number | null | undefined> = {}) => request<ReplayList>(`/replays${query(filters)}`),
  createReplay: (input: Record<string, unknown>) => post<Record<string, unknown>>("/replays", input),
  getReplay: (id: string) => request<ReplayRunDetail>(`/replays/${part(id)}`),
  getReplayDay: (id: string, date: string) => request<ReplayDayDetail>(`/replays/${part(id)}/days/${part(date)}`),
  getReplaySession: (id: string, sessionExecutionId: string) => request<ReplaySessionDetail>(`/replays/${part(id)}/sessions/${part(sessionExecutionId)}`),
  listGptProcesses: (runId?: string) => request<GptProcessList>(`/gpt-processes${query({ run_id: runId })}`),
  getGptProcess: (id: string) => request<GptProcessDetail>(`/gpt-processes/${part(id)}`),
  getObservability: (filters: Record<string, string | number | null | undefined> = {}) => request<ObservabilityOverview>(`/observability/overview${query(filters)}`),
  getObservabilityPolicy: () => request<ObservabilityPolicyResponse>("/observability/policy"),
  updateObservabilityPolicy: (input: ObservabilityPolicyActionInput) => post<{ policy: ObservabilityPolicyResponse["policy"]; idempotent: boolean }>("/observability/policy", input),
  evaluateObservabilityIncidents: (input: { autoResolve?: boolean; syncNotifications?: boolean; reason?: string } = {}) => post<ObservabilityIncidentSync>("/observability/incidents/evaluate", input),
  getPerformance: (filters: Record<string, string | null | undefined> = {}) => request<PerformanceOverview>(`/performance/overview${query(filters)}`),
  compareReplays: (ids: string[]) => request<Record<string, unknown>>(`/replays/compare${query({ ids: ids.join(",") })}`),
  listIncidents: () => request<IncidentList>("/incidents"),
  executeIncidentAction: (id: string, input: OperationsCommandInput) => post(`/incidents/${part(id)}/actions`, input),
  listNotifications: (filters: Record<string, string | number | null | undefined> = {}) => request<NotificationList>(`/notifications${query(filters)}`),
  syncNotifications: (input: { autoClear?: boolean; limit?: number; reason?: string } = {}) => post<NotificationSync>("/notifications/sync", input),
  executeNotificationAction: (id: string, input: NotificationActionInput) => post(`/notifications/${part(id)}/actions`, input),
  listRunbooks: (filters: Record<string, string | number | null | undefined> = {}) => request<RunbookList>(`/runbooks${query(filters)}`),
  getRunbook: (id: string) => request<RunbookDetail>(`/runbooks/${part(id)}`),
  getHistory: (filters: Record<string, string | number | null | undefined> = {}) => request<DeskHistory>(`/history/sessions${query(filters)}`),
  getHistorySession: (id: string) => request<HistorySessionDetail>(`/history/sessions/${part(id)}`),
  listStrategies: () => request<StrategyList>("/strategies"),
  compareStrategyVersions: (id: string, left: string, right: string) => request<StrategyVersionComparison>(`/strategies/${part(id)}/versions/compare${query({ left, right })}`),
  eventsUrl: `${apiBase}/events`
};
````

### `src/api/operatorAuth.ts`

````tsx
export type OperatorUser = {
  email: string | null;
  displayName: string | null;
  getIdToken: () => Promise<string>;
};

type OperatorListener = (user: OperatorUser | null) => void;
type Unsubscribe = () => void;

const localApiKey = String(import.meta.env.VITE_DESK_API_KEY || "").trim();
const listeners = new Set<OperatorListener>();
let signedIn = Boolean(localApiKey);

export async function listenToOperatorAuth(listener: OperatorListener): Promise<Unsubscribe> {
  listeners.add(listener);
  listener(currentUser());
  return () => listeners.delete(listener);
}

export async function signInOperator(): Promise<OperatorUser> {
  if (!localApiKey) {
    throw new Error("La clé opérateur locale VITE_DESK_API_KEY n’est pas configurée.");
  }
  signedIn = true;
  const user = currentUser();
  if (!user) throw new Error("Impossible d’initialiser l’opérateur local.");
  notify();
  return user;
}

export async function signOutOperator(): Promise<void> {
  signedIn = false;
  notify();
}

export async function getOperatorIdToken(): Promise<string | null> {
  return signedIn ? localApiKey || null : null;
}

export async function operatorAuthAvailable(): Promise<boolean> {
  return Boolean(localApiKey);
}

function currentUser(): OperatorUser | null {
  if (!signedIn || !localApiKey) return null;
  return {
    email: "preprod.operator@desk.local",
    displayName: "Opérateur préproduction",
    getIdToken: async () => localApiKey,
  };
}

function notify(): void {
  const user = currentUser();
  for (const listener of listeners) listener(user);
}
````

### `src/App.tsx`

````tsx
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout";
import { OverlayProvider } from "@/context/OverlayContext";
import LiveDeskPage from "@/pages/LiveDeskPage";
import SessionsPage from "@/pages/SessionsPage";
import MasterPage from "@/pages/MasterPage";
import MonitorsPage from "@/pages/MonitorsPage";
import ThesisPage from "@/pages/ThesisPage";
import SetupPage from "@/pages/SetupPage";
import TimelinePage from "@/pages/TimelinePage";
import NewsPage from "@/pages/NewsPage";
import AuditPage from "@/pages/AuditPage";
import AlertsPage from "@/pages/AlertsPage";
import MorePage from "@/pages/MorePage";
import PerformanceCalendarPage from "@/pages/PerformanceCalendarPage";
import OperationsPage from "@/pages/OperationsPage";
import WorkflowDetailPage from "@/pages/WorkflowDetailPage";
import ReplayLabPage from "@/pages/ReplayLabPage";
import ReplayRunPage from "@/pages/ReplayRunPage";
import ReplayDayPage from "@/pages/ReplayDayPage";
import ReplaySessionPage from "@/pages/ReplaySessionPage";
import GptProcessPage from "@/pages/GptProcessPage";
import IncidentsPage from "@/pages/IncidentsPage";
import PerformanceAnalysisPage from "@/pages/PerformanceAnalysisPage";
import ReplayComparePage from "@/pages/ReplayComparePage";
import HistoryPage from "@/pages/HistoryPage";
import StrategiesPage from "@/pages/StrategiesPage";
import WorkflowEventPage from "@/pages/WorkflowEventPage";
import StrategyDetailPage from "@/pages/StrategyDetailPage";
import HistorySessionPage from "@/pages/HistorySessionPage";
import ObservabilityPage from "@/pages/ObservabilityPage";
import NotificationsPage from "@/pages/NotificationsPage";
import RunbooksPage from "@/pages/RunbooksPage";

export default function App() {
  return <OverlayProvider><Routes>
    <Route element={<AppShell/>}>
      <Route index element={<Navigate to="/live" replace/>}/>
      <Route path="/live" element={<LiveDeskPage/>}/>
      <Route path="/sessions" element={<SessionsPage/>}/>
      <Route path="/master" element={<MasterPage/>}/>
      <Route path="/monitors" element={<MonitorsPage/>}/>
      <Route path="/thesis" element={<ThesisPage/>}/>
      <Route path="/setup" element={<SetupPage/>}/>
      <Route path="/timeline" element={<TimelinePage/>}/>
      <Route path="/news" element={<NewsPage/>}/>
      <Route path="/audit" element={<AuditPage/>}/>
      <Route path="/alerts" element={<AlertsPage/>}/>
      <Route path="/performance" element={<PerformanceCalendarPage/>}/>
      <Route path="/operations" element={<OperationsPage/>}/>
      <Route path="/operations/observability" element={<ObservabilityPage/>}/>
      <Route path="/operations/incidents" element={<IncidentsPage/>}/>
      <Route path="/operations/notifications" element={<NotificationsPage/>}/>
      <Route path="/operations/runbooks" element={<RunbooksPage/>}/>
      <Route path="/operations/workflows/:workflowId" element={<WorkflowDetailPage/>}/>
      <Route path="/operations/workflows/:workflowId/events/:eventId" element={<WorkflowEventPage/>}/>
      <Route path="/replay" element={<ReplayLabPage/>}/>
      <Route path="/replay/compare" element={<ReplayComparePage/>}/>
      <Route path="/replay/runs/:runId" element={<ReplayRunPage/>}/>
      <Route path="/replay/runs/:runId/days/:date" element={<ReplayDayPage/>}/>
      <Route path="/replay/runs/:runId/days/:date/sessions/:sessionExecutionId" element={<ReplaySessionPage/>}/>
      <Route path="/replay/runs/:runId/gpt/:processId" element={<GptProcessPage/>}/>
      <Route path="/performance/analysis" element={<PerformanceAnalysisPage/>}/>
      <Route path="/history" element={<HistoryPage/>}/>
      <Route path="/history/sessions/:sessionId" element={<HistorySessionPage/>}/>
      <Route path="/strategies" element={<StrategiesPage/>}/>
      <Route path="/strategies/:strategyId" element={<StrategyDetailPage/>}/>
      <Route path="/more" element={<MorePage/>}/>
      <Route path="*" element={<Navigate to="/live" replace/>}/>
    </Route>
  </Routes></OverlayProvider>;
}
````

### `src/components/common.tsx`

````tsx
import { useEffect, useId, useRef, type HTMLAttributes, type ReactNode, type SVGProps } from "react";

export type IconName =
  | "menu" | "bell" | "live" | "master" | "monitor" | "timeline" | "audit"
  | "news" | "arrow" | "refresh" | "info" | "alert" | "brain" | "globe"
  | "change" | "check" | "x" | "minus" | "chevron" | "trendUp"
  | "trendDown" | "clock" | "layers" | "database" | "target" | "chart"
  | "close" | "position" | "settings" | "calendar" | "search" | "filter"
  | "sort" | "download" | "pause" | "play" | "retry" | "cancel"
  | "expand" | "collapse";

const paths: Record<IconName, ReactNode> = {
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M10 19h4"/></>,
  live: <><path d="M4 18V8M10 18V4M16 18v-7M22 18V6"/><path d="M2 18h21"/></>,
  master: <><path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
  monitor: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M6 12l3-3 3 2 5-5"/></>,
  timeline: <><path d="M7 4v16M7 7h10M7 12h7M7 17h12"/><circle cx="7" cy="7" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="7" cy="17" r="2"/></>,
  audit: <><path d="M12 3 4 6v5c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6l-8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
  news: <><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  arrow: <path d="m9 18 6-6-6-6"/>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
  alert: <><path d="M12 3 2.8 19h18.4L12 3Z"/><path d="M12 9v4M12 16h.01"/></>,
  brain: <><path d="M9.5 4.5A3.5 3.5 0 0 0 6 8v.5A3.5 3.5 0 0 0 6.5 15v.5A3.5 3.5 0 0 0 10 19h2V5H9.5ZM14.5 4.5A3.5 3.5 0 0 1 18 8v.5a3.5 3.5 0 0 1-.5 6.5v.5A3.5 3.5 0 0 1 14 19h-2V5h2.5Z"/><path d="M8 9h4M12 14h4"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
  change: <><path d="M4 7h12l-3-3M20 17H8l3 3M16 7l4 4M8 17l-4-4"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  x: <path d="m6 6 12 12M18 6 6 18"/>,
  minus: <path d="M5 12h14"/>,
  chevron: <path d="m7 10 5 5 5-5"/>,
  trendUp: <><path d="m5 15 5-5 4 4 5-7M14 7h5v5"/></>,
  trendDown: <><path d="m5 9 5 5 4-4 5 7M14 17h5v-5"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
  target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3"/></>,
  chart: <><path d="M4 19V9M10 19V5M16 19v-7M22 19V3M2 19h21"/></>,
  close: <path d="M6 6l12 12M18 6 6 18"/>,
  position: <><path d="M4 18h16M7 15l3-5 3 2 4-6"/><circle cx="17" cy="6" r="2"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1A7 7 0 0 0 15 6l-.3-2.5h-4L10.4 6A7 7 0 0 0 9 7L6.6 6 4.5 9.5l2 1.5a7 7 0 0 0 0 2l-2 1.5L6.6 18 9 17a7 7 0 0 0 1.4 1l.3 2.5h4L15 18a7 7 0 0 0 1.5-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1Z"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
  filter: <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z"/>,
  sort: <><path d="m8 4-3 3 3 3M5 7h10M16 14l3 3-3 3M19 17H9"/></>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M4 19h16"/></>,
  pause: <path d="M8 5v14M16 5v14"/>,
  play: <path d="m8 5 11 7-11 7V5Z"/>,
  retry: <><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></>,
  cancel: <><circle cx="12" cy="12" r="9"/><path d="m8 8 8 8M16 8l-8 8"/></>,
  expand: <path d="m8 10 4 4 4-4"/>,
  collapse: <path d="m15 6-6 6 6 6"/>
};

export function Icon({ name, size = 20, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}

export function BrandMark({ large = false }: { large?: boolean }) {
  return <span className={`brand-mark ${large ? "brand-mark--large" : ""}`}><span/><span/><span/></span>;
}

export type StatusTone = "critical" | "warning" | "positive" | "info" | "muted";

/** Unique primitive for every compact state displayed by the Desk. */
export function StatusPill({ children, tone = "info", status }: { children: ReactNode; tone?: StatusTone; status?: string }) {
  const modifier = status ? `status-pill--${status.toLowerCase()}` : `status-pill--${tone}`;
  return <span className={`status-pill ${modifier}`}>{children}</span>;
}

/** Compatibility alias while feature pages migrate to the shared StatusPill API. */
export function StatusBadge(props: { children: ReactNode; tone?: StatusTone }) {
  return <StatusPill {...props}/>;
}

type CardProps = { children: ReactNode; className?: string; onClick?: () => void } & Omit<HTMLAttributes<HTMLElement>, "onClick">;

export function Card({ children, className = "", onClick, onKeyDown, role, tabIndex, ...props }: CardProps) {
  return <article
    {...props}
    className={`card ${onClick ? "card--clickable" : ""} ${className}`}
    onClick={onClick}
    role={onClick ? "button" : role}
    tabIndex={onClick ? 0 : tabIndex}
    onKeyDown={event => {
      onKeyDown?.(event);
      if (!event.defaultPrevented && onClick && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        onClick();
      }
    }}
  >{children}</article>;
}

export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <header className="section-title"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>;
}

export function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useDialogBehavior(open, onClose);
  const titleId = useId();
  return <>
    <button className={`scrim ${open ? "open" : ""}`} onClick={onClose} aria-label="Fermer" tabIndex={open ? 0 : -1}/>
    <section ref={ref} className={`drawer ${open ? "open" : ""}`} aria-hidden={!open} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="drawer__grab"/>
      <header className="drawer__header"><div><p className="eyebrow">Détail</p><h2 id={titleId}>{title}</h2></div><button className="icon-btn" onClick={onClose} aria-label="Fermer le panneau"><Icon name="close"/></button></header>
      <div className="drawer__content">{children}</div>
    </section>
  </>;
}

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useDialogBehavior(open, onClose);
  const titleId = useId();
  return <>
    <button className={`scrim ${open ? "open" : ""}`} onClick={onClose} aria-label="Fermer" tabIndex={open ? 0 : -1}/>
    <section ref={ref} className={`modal ${open ? "open" : ""}`} aria-hidden={!open} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal__card">
        <button className="icon-btn modal__close" onClick={onClose} aria-label="Fermer la confirmation"><Icon name="close"/></button>
        <div className="modal__icon"><Icon name="alert"/></div>
        <h2 id={titleId}>{title}</h2>{children}
      </div>
    </section>
  </>;
}

function useDialogBehavior(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add("overlay-open");
    const frame = window.requestAnimationFrame(() => {
      const first = ref.current?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
      first?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !ref.current) return;
      const focusable = [...ref.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")].filter(node => node.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.classList.remove("overlay-open");
      window.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [open, onClose]);
  return ref;
}

export function LoadingView() {
  return <section className="view loading-view"><div className="skeleton loading-hero"/><div className="skeleton loading-row"/><div className="skeleton loading-row"/></section>;
}

export function ErrorView({ message, retry }: { message: string; retry: () => void }) {
  return <section className="view"><div className="card empty-state"><div className="empty-state__icon"><Icon name="alert"/></div><h3>Impossible de charger le Desk</h3><p>{message}</p><button className="primary-btn" onClick={retry}>Réessayer</button></div></section>;
}
````

### `src/components/ConfirmActionForm.tsx`

````tsx
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/common";

export type ConfirmActionValues = {
  confirmationPhrase: string;
  reason: string;
};

type ConfirmActionFormProps = {
  target: string;
  revision: number;
  expectedPhrase: string;
  onCancel: () => void;
  onConfirm: (values: ConfirmActionValues) => Promise<void>;
  confirmLabel?: string;
  danger?: boolean;
  children?: ReactNode;
  validateExtra?: () => boolean;
};

export function ConfirmActionForm({
  target,
  revision,
  expectedPhrase,
  onCancel,
  onConfirm,
  confirmLabel = "Confirmer l’écriture",
  danger = false,
  children,
  validateExtra = () => true
}: ConfirmActionFormProps) {
  const reasonId = useId();
  const confirmationId = useId();
  const [reason, setReason] = useState("");
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = confirmationPhrase === expectedPhrase && reason.trim().length >= 3 && validateExtra();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({ confirmationPhrase, reason: reason.trim() });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSubmitting(false);
    }
  };

  return <form className="confirm-action" onSubmit={submit}>
    <div className="confirm-action__scope" aria-label="Portée de l’action">
      <div><span>Cible</span><strong>{target}</strong></div>
      <div><span>Révision attendue</span><strong className="mono">{revision}</strong></div>
    </div>
    <div className="confirm-action__warning">
      <Icon name="alert" size={18}/>
      <p>Cette écriture est journalisée et ne sera appliquée que si la révision canonique correspond toujours.</p>
    </div>
    <label htmlFor={reasonId}>
      Justification opérateur
      <textarea id={reasonId} value={reason} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="Pourquoi cette action est-elle justifiée maintenant ?" autoFocus required/>
      <small>{reason.trim().length}/500 · minimum 3 caractères</small>
    </label>
    {children}
    <label htmlFor={confirmationId}>
      Confirmation explicite
      <span className="confirm-action__phrase">Recopiez <code>{expectedPhrase}</code></span>
      <input id={confirmationId} value={confirmationPhrase} onChange={event => setConfirmationPhrase(event.target.value.toUpperCase())} autoComplete="off" spellCheck={false} placeholder={expectedPhrase} required/>
    </label>
    {error && <p className="operator-feedback operator-feedback--error" role="alert">{error}</p>}
    <div className="modal__actions">
      <button type="button" className="secondary-btn" onClick={onCancel} disabled={submitting}>Annuler</button>
      <button type="submit" className={danger ? "danger-btn" : "primary-btn"} disabled={!confirmed || submitting}>
        {submitting ? "Enregistrement…" : confirmLabel}
      </button>
    </div>
  </form>;
}
````

### `src/components/deskCards.tsx`

````tsx
import { useNavigate } from "react-router-dom";
import { Card, Icon, SectionTitle, StatusBadge, StatusPill } from "@/components/common";
import type { DeskSession } from "@/types";

const fmt = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
const severityTone = (value: string): "critical" | "warning" | "positive" | "info" =>
  value === "critical" ? "critical" : value === "warning" ? "warning" : "info";

export function StatusRibbon({ data }: { data: DeskSession }) {
  const sessionTone = data.severity === "critical" ? "critical" : data.severity === "warning" || data.severity === "watch" ? "warning" : "info";
  const qualityTone = data.dataQuality.status === "ready" ? "info" : "warning";
  return <div className="status-ribbon">
    <StatusPill tone={sessionTone}>{data.status}</StatusPill>
    <span className="status-chip">Données <strong>{data.lastDataAt}</strong></span>
    <StatusPill tone={qualityTone}>{data.dataQuality.label}</StatusPill>
    <span className="status-chip">Monitor <strong>{data.lastMonitorAt}</strong></span>
    <span className="status-chip">Prochain <strong>{data.nextMonitorAt}</strong></span>
  </div>;
}

export function DecisionCard({ data }: { data: DeskSession }) {
  const navigate = useNavigate();
  const tone = data.severity === "critical" ? "critical" : data.severity === "warning" || data.severity === "watch" ? "warning" : "info";
  return <Card className="decision-card">
    <div className="decision-card__signal" data-severity={data.severity}/>
    <div className="decision-card__body">
      <div className="decision-card__top">
        <div>
          <p className="eyebrow">{data.liveBrief.eyebrow}</p>
          <h2>{data.liveBrief.headline}</h2>
        </div>
        <StatusBadge tone={tone}>{data.status}</StatusBadge>
      </div>
      <div className="decision-card__decision">{data.liveBrief.decision}</div>
      <p className="decision-card__summary">{data.liveBrief.summary}</p>
      <div className="decision-card__reasoning">
        <div><span>Pourquoi</span><p>{data.liveBrief.why}</p></div>
        <div><span>Prochaine action</span><p>{data.liveBrief.nextAction}</p></div>
      </div>
      <div className="decision-card__footer">
        <span className="action-pill">{data.liveBrief.action}</span>
        <button className="secondary-btn" onClick={() => navigate("/setup")}>Setup & Position <Icon name="arrow" size={15}/></button>
      </div>
    </div>
  </Card>;
}

export function ThesisSummary({ data }: { data: DeskSession }) {
  const navigate = useNavigate();
  return <Card className="thesis-summary" onClick={() => navigate("/thesis") }>
    <div className="thesis-summary__head"><div><p className="eyebrow">Thèse active</p><h2>{data.thesis.instrument} · {data.thesis.direction}</h2></div><StatusBadge tone={data.thesis.status === "ACTIVE" ? "info" : "warning"}>{data.thesis.status}</StatusBadge></div>
    <p>{data.thesis.dominantScenario}</p>
    <div className="thesis-summary__metrics"><div><span>Confiance</span><strong>{data.thesis.confidence}%</strong></div><div><span>Santé</span><strong>{data.thesis.health}/100</strong></div></div>
    <dl><dt>Valide jusqu’à</dt><dd>{data.thesis.validUntil}</dd><dt>Prochain focus</dt><dd>{data.thesis.nextFocus}</dd></dl>
  </Card>;
}

export function MarketTable({ data }: { data: DeskSession }) {
  return <div className="data-table-wrap market-table-wrap"><table className="data-table market-table">
    <thead><tr><th>Symbole</th><th>Prix</th><th>Variation</th><th>RSI 14</th><th>ATR 14</th><th>Note</th></tr></thead>
    <tbody>{data.market.length ? data.market.map(item => <tr key={item.symbol}>
      <td data-label="Symbole"><strong>{item.symbol}</strong><small>{item.marketDate || item.seriesTimeframe || "Marché"}</small></td>
      <td data-label="Prix" className="mono">{item.price}</td>
      <td data-label="Variation" className={`mono ${item.trend === "up" ? "positive" : item.trend === "down" ? "negative" : ""}`}>{item.change}</td>
      <td data-label="RSI 14" className="mono">{item.rsi || "—"}</td>
      <td data-label="ATR 14" className="mono">{item.atr || "—"}</td>
      <td data-label="Note">{item.note || "Non disponible"}</td>
    </tr>) : <tr className="terminal-table-empty"><td colSpan={6}><span>MARKET_FEED_WAITING</span><small>Aucun snapshot matérialisé · en attente du prochain cycle backend</small></td></tr>}</tbody>
  </table></div>;
}

export function AuditMini({ data }: { data: DeskSession }) {
  const navigate = useNavigate();
  const ready = data.dataQuality.status === "ready" && !data.dataQuality.warnings.length;
  return <Card className="audit-mini" onClick={() => navigate("/audit") }>
    <div className="brief-card__header"><div><p className="eyebrow">Qualité & audit</p><h3>{data.dataQuality.label}</h3></div><StatusBadge tone={ready ? "info" : "warning"}>{ready ? "CONFORME" : "À CONTRÔLER"}</StatusBadge></div>
    <dl className="definition-grid"><dt>Anti-lookahead</dt><dd>{data.dataQuality.antiLookahead ? "Actif" : "Inactif"}</dd><dt>Avertissements</dt><dd>{data.dataQuality.warnings.length}</dd></dl>
    {!!data.dataQuality.warnings.length && <p>{data.dataQuality.warnings.join(" · ")}</p>}
    <span className="row-link">Ouvrir l’audit <Icon name="arrow" size={14}/></span>
  </Card>;
}

export function BriefCard({ eyebrow, headline, text, verdict, icon }: { eyebrow: string; headline: string; text: string; verdict?: string; icon: "globe" | "chart" | "brain" | "news" }) {
  return <Card className="brief-card">
    <div className="brief-card__header"><div><p className="eyebrow">{eyebrow}</p><h3>{headline}</h3></div><span className="card-icon"><Icon name={icon}/></span></div>
    <p>{text}</p>{verdict && <div className="brief-card__verdict">{verdict}</div>}
  </Card>;
}

export function DeltaCard({ data }: { data: DeskSession }) {
  return <Card className="delta-card">
    <div className="brief-card__header"><div><p className="eyebrow">Delta Monitor</p><h3>{data.latestChange.title}</h3></div><span className="card-icon"><Icon name="change"/></span></div>
    <div className="delta-list">{data.latestChange.items.length ? data.latestChange.items.map((item, i) => <div className="delta-item" data-tone={item.tone} key={i}><span className="delta-item__dot"/><span>{item.text}</span></div>) : <TerminalEmpty code="NO_MONITOR_DELTA" label="Aucune évolution matérialisée depuis le dernier cycle."/>}</div>
    <div className="delta-consequence">{data.latestChange.consequence}</div>
  </Card>;
}

export function ThesisCard({ data }: { data: DeskSession }) {
  const navigate = useNavigate();
  return <Card className="thesis-card" onClick={() => navigate("/thesis")}>
    <div className="thesis-card__top">
      <div className="thesis-card__instrument"><span className="instrument-badge">{data.thesis.instrument}</span><div><h3>Thèse active</h3><div className="thesis-card__subtitle">{data.thesis.direction.toUpperCase()} · jusqu’à {data.thesis.validUntil}</div></div></div>
      <StatusBadge tone={data.thesis.health < 40 ? "critical" : "warning"}>{data.thesis.status}</StatusBadge>
    </div>
    <p className="thesis-card__scenario">{data.thesis.dominantScenario}</p>
    <div className="thesis-card__metrics">
      <div><span>Santé</span><strong>{data.thesis.health}</strong><small>{data.thesis.initialHealth} initial</small></div>
      <div><span>Confiance</span><strong>{data.thesis.confidence}%</strong><small>{data.thesis.initialConfidence}% initial</small></div>
    </div>
    <div className="thesis-card__focus"><span>Prochain focus</span><p>{data.thesis.nextFocus}</p></div>
  </Card>;
}

export function SetupCard({ data }: { data: DeskSession }) {
  const navigate = useNavigate();
  const s = data.setup;
  return <Card className="setup-card" onClick={() => navigate("/setup")}>
    <div className="setup-card__header"><div><p className="eyebrow">Setup</p><h3>{s.label}</h3></div><StatusBadge tone={s.status === "ACTIVE" ? "info" : "critical"}>{s.status}</StatusBadge></div>
    <div className="setup-card__body">
      <div className="price-grid">
        <div className="price-box"><span>Entrée</span><strong>{fmt(s.entryFrom)}–{fmt(s.entryTo)}</strong></div>
        <div className="price-box"><span>Stop</span><strong>{fmt(s.stop)}</strong></div>
        <div className="price-box"><span>TP1</span><strong>{fmt(s.tp1)}</strong></div>
        <div className="price-box"><span>TP2 / TP3</span><strong>{fmt(s.tp2)} / {fmt(s.tp3)}</strong></div>
      </div>
      <div className="setup-card__reason">{s.reason}</div>
    </div>
    <div className="setup-card__footer"><span>{s.statusLabel}</span><span>RR {fmt(s.rr)} · risque {s.risk == null ? "—" : `${fmt(s.risk)}%`}</span></div>
  </Card>;
}

export function PositionCard({ data }: { data: DeskSession }) {
  const navigate = useNavigate();
  const p = data.position;
  return <Card className="position-react-card" onClick={() => navigate("/setup#position")}>
    <div className="brief-card__header"><div><p className="eyebrow">Position canonique</p><h3>{p.active ? `${p.instrument} ${p.direction}` : p.status === "CLOSED" ? "Trade historique clôturé" : "Aucune position live"}</h3></div><StatusBadge tone={p.active ? "info" : p.status === "CLOSED" ? "positive" : "muted"}>{p.status}</StatusBadge></div>
    <div className="position-react-grid">
      <div><span>Entry</span><strong>{fmt(p.entry)}</strong></div><div><span>Mark / Exit</span><strong>{fmt(p.current)}</strong></div><div><span>Résultat</span><strong>{p.unrealizedR != null ? `${p.unrealizedR.toFixed(2)} R` : "—"}</strong></div>
    </div>
    <p>{p.note}</p>
    <div className="source-priority-react"><Icon name="database" size={15}/> Source prioritaire : backend d’exécution</div>
  </Card>;
}

export function ActivityCard({ data }: { data: DeskSession }) {
  return <Card className="activity-card">
    <div className="brief-card__header"><div><p className="eyebrow">Activité du Desk</p><h3>Ce que le système fait</h3></div><span className="card-icon"><Icon name="settings"/></span></div>
    <div className="activity-list">{data.activity.length ? data.activity.map((item, i) => <div className="activity-item" data-state={item.status === "queued" ? "scheduled" : item.status} key={i}><span className="activity-time">{item.time}</span><span className="activity-line"><span className="activity-dot"/></span><div><div className="activity-label">{item.title}</div><div className="activity-detail">{item.detail}</div></div></div>) : <TerminalEmpty code="NO_WORKER_ACTIVITY" label="Aucune activité worker pour cette session."/>}</div>
  </Card>;
}

export function ExpectedRealized({ monitor, compact = false }: { monitor: DeskSession["monitors"][number]; compact?: boolean }) {
  return <div className={`comparison-react ${compact ? "compact" : ""}`}>
    {monitor.expectedVsRealized.map((row, i) => <div className="comparison-react__row" key={i}>
      <div className="comparison-react__head"><strong>{row.element}</strong><StatusBadge tone={row.verdict === "invalidate" ? "critical" : row.verdict === "confirm" ? "info" : "muted"}>{row.verdict}</StatusBadge></div>
      <div className="comparison-react__cols"><div><span>Attendu</span><p>{row.expected}</p></div><div><span>Réalisé</span><p>{row.realized}</p></div></div>
      {!compact && <small>{row.impact}</small>}
    </div>)}
  </div>;
}

export function Conditions({ title, items }: { title: string; items: DeskSession["monitors"][number]["goConditions"] }) {
  return <Card className="conditions-react"><h3>{title}</h3><div>{items.length ? items.map((item, i) => <div className="condition-react" key={i}>
    <span className={`condition-react__icon ${item.status}`}><Icon name={item.status === "failed" || item.status === "triggered" ? "x" : item.status === "validated" || item.status === "previously_validated" ? "check" : "minus"} size={15}/></span>
    <div><div className="condition-react__head"><strong>{item.label}</strong><StatusBadge tone={item.status === "failed" || item.status === "triggered" ? "critical" : item.status === "completed" ? "positive" : "info"}>{item.status}</StatusBadge></div><p>{item.proof}</p><small>{item.impact} · {item.deterministic ? "déterministe" : "interprétation"}</small></div>
  </div>) : <p className="empty-copy">Aucune condition disponible.</p>}</div></Card>;
}

export function Timeline({ data, compact = false, onSelect }: { data: DeskSession; compact?: boolean; onSelect?: (event: DeskSession["timeline"][number]) => void }) {
  const items = compact ? data.timeline.slice(-4) : data.timeline;
  return <div className="timeline">{items.length ? items.map((event, i) => <div className="timeline-item" data-type={event.type.toLowerCase()} data-status={severityTone(event.severity)} key={i}>
    <time className="timeline-item__time">{event.time}</time>
    <button className="timeline-item__content" onClick={() => onSelect?.(event)}>
      <div className="timeline-item__header"><strong>{event.title}</strong><StatusBadge tone={severityTone(event.severity)}>{event.status}</StatusBadge></div>
      <p>{event.summary}</p>{!compact && <small>{event.type} · {event.sourceType}</small>}
    </button>
  </div>) : <TerminalEmpty code="NO_TIMELINE_EVENT" label="Le journal se remplira au prochain événement du Desk."/>}</div>;
}

function TerminalEmpty({ code, label }: { code: string; label: string }) {
  return <div className="terminal-empty-state"><span>{code}</span><small>{label}</small></div>;
}

export function MacroNewsCard({ data }: { data: DeskSession }) {
  const navigate = useNavigate();
  const next = data.macro[0];
  return <Card className="brief-card" onClick={() => navigate("/news")}>
    <div className="brief-card__header"><div><p className="eyebrow">Macro & News</p><h3>{next ? `${next.time} · ${next.title}` : "Aucun event imminent"}</h3></div><span className="card-icon"><Icon name="news"/></span></div>
    {next && <p>{next.impactText}</p>}
    <div className="news-digest-preview"><span>Digest · {data.news.digestUpdatedAt}</span><p>{data.news.digest}</p></div>
    <div className="brief-card__verdict">{data.news.headlines.length} headlines disponibles</div>
  </Card>;
}

export function LiveSectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <SectionTitle title={title} subtitle={subtitle} action={action}/>;
}
````

### `src/components/layout.tsx`

````tsx
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { BrandMark, Icon, type IconName } from "@/components/common";
import { useDeskContext } from "@/context/DeskContext";
import { useDeskSession } from "@/hooks/useDesk";

export interface NavigationItem {
  to: string;
  label: string;
  description: string;
  icon: IconName;
}

export interface NavigationGroup {
  label: string;
  items: NavigationItem[];
}

export const navigationGroups: NavigationGroup[] = [
  { label: "Temps réel", items: [
    { to: "/live", label: "Live Desk", description: "Décision et état de session", icon: "live" },
    { to: "/sessions", label: "Sessions", description: "Phases automatiques Paris", icon: "clock" },
    { to: "/master", label: "Master", description: "Plan figé au cutoff", icon: "master" },
    { to: "/monitors", label: "Monitors", description: "Checkpoints et évolution", icon: "monitor" },
    { to: "/thesis", label: "Thèse active", description: "État vivant du plan", icon: "brain" },
    { to: "/setup", label: "Setup & Position", description: "Plan et exécution canonique", icon: "position" },
    { to: "/timeline", label: "Journal", description: "Traçabilité des décisions", icon: "timeline" },
    { to: "/news", label: "Macro & News", description: "Calendrier et risques", icon: "news" },
    { to: "/audit", label: "Audit", description: "Qualité et contrats", icon: "audit" },
    { to: "/alerts", label: "Alertes Live", description: "Alertes de la session", icon: "bell" },
    { to: "/performance", label: "Calendrier R", description: "Résultats quotidiens", icon: "calendar" },
  ] },
  { label: "Automatisation", items: [
    { to: "/operations", label: "Cockpit opérations", description: "Workflows automatisés", icon: "monitor" },
    { to: "/operations/observability", label: "Observabilité GPT", description: "Queue, leases, coûts et SLA", icon: "chart" },
    { to: "/operations/incidents", label: "Incidents & alertes", description: "Cycle de vie global", icon: "alert" },
    { to: "/operations/notifications", label: "Notifications", description: "Outbox et escalade locale", icon: "bell" },
    { to: "/operations/runbooks", label: "Runbooks", description: "Procédures opérateur", icon: "layers" },
  ] },
  { label: "Recherche", items: [
    { to: "/replay", label: "Replay Lab", description: "Runs, sessions et GPT", icon: "layers" },
    { to: "/replay/compare", label: "Comparaison", description: "Comparer les exécutions", icon: "change" },
    { to: "/performance/analysis", label: "Analyse performance", description: "Ventilations et résultats", icon: "chart" },
    { to: "/history", label: "Historique", description: "Mémoire des sessions", icon: "database" },
  ] },
  { label: "Gouvernance", items: [
    { to: "/strategies", label: "Stratégies & versions", description: "Registry et contrats", icon: "settings" },
  ] },
];

const bottom: NavigationItem[] = [
  { to: "/live", label: "Live", description: "", icon: "live" },
  { to: "/operations", label: "Ops", description: "", icon: "monitor" },
  { to: "/replay", label: "Replay", description: "", icon: "layers" },
  { to: "/performance/analysis", label: "Analyse", description: "", icon: "chart" },
  { to: "/more", label: "Plus", description: "", icon: "menu" },
];

export function AppShell() {
  const { sessionId, phase, phaseLabel, nextPhaseAt } = useDeskContext();
  const { data } = useDeskSession(sessionId);
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("desk-sidebar") === "collapsed");
  const [density, setDensity] = useState<"compact" | "comfortable">(() => localStorage.getItem("desk-density") === "comfortable" ? "comfortable" : "compact");

  useEffect(() => {
    document.documentElement.dataset.density = density;
    localStorage.setItem("desk-density", density);
  }, [density]);
  useEffect(() => localStorage.setItem("desk-sidebar", collapsed ? "collapsed" : "open"), [collapsed]);

  return <div className={`app-shell-v2 ${collapsed ? "is-collapsed" : ""}`}>
    <a className="skip-link" href="#main-content">Aller au contenu</a>
    <aside className="app-sidebar" aria-label="Navigation principale">
      <header className="app-sidebar__brand">
        <Link to="/live" aria-label="Desk Futures"><BrandMark/><span className="app-sidebar__brand-copy"><strong>Desk Futures</strong><small><i className="api-dot"/> API connectée</small></span></Link>
        <button className="icon-btn sidebar-collapse" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? "Déployer la navigation" : "Replier la navigation"}><Icon name={collapsed ? "arrow" : "collapse"}/></button>
      </header>
      <div className="session-context-card" title={`Prochaine phase à ${nextPhaseAt}`}>
        <p>Phase automatique</p><div><span className="phase-orb">{phaseLabel.slice(0, 1)}</span><strong>{phaseLabel}</strong><em>AUTO</em></div>
        <div className="phase-track" aria-label={`Phase active ${phaseLabel}`}><span className={phase === "asia" ? "active" : ""}>ASIA</span><span className={phase === "london" ? "active" : ""}>LONDON</span><span className={phase === "ny" ? "active" : ""}>NY</span></div>
        <small>Prochaine phase à {nextPhaseAt}</small>
      </div>
      <nav className="domain-nav">
        {navigationGroups.map(group => <section key={group.label} className="domain-nav__group"><h2>{group.label}</h2>{group.items.map(item => <NavLink key={item.to} to={item.to} end={["/live", "/performance", "/operations", "/replay"].includes(item.to)} title={collapsed ? item.label : undefined} className={({ isActive }) => isActive ? "active" : ""}><Icon name={item.icon}/><span>{item.label}</span></NavLink>)}</section>)}
      </nav>
      <footer className="app-sidebar__footer">
        <div className="density-toggle" role="group" aria-label="Densité de l’interface"><button className={density === "compact" ? "active" : ""} onClick={() => setDensity("compact")}>Terminal</button><button className={density === "comfortable" ? "active" : ""} onClick={() => setDensity("comfortable")}>Confort.</button></div>
        <span className="auth-state"><i/> Lecture seule</span>
      </footer>
    </aside>

    <header className="app-topbar">
      <button className="brand-button mobile-brand" onClick={() => navigate("/more")} aria-label="Menu"><BrandMark/><span><strong>Desk Futures</strong><small>{data?.label || "Cockpit"}</small></span></button>
      <div className="topbar-terminal-state" aria-label="État du desk">
        <span><i className="api-dot"/>LIVE</span>
        <span>SESSION <strong>{data?.label || "—"}</strong></span>
        <span>PHASE <strong>{phaseLabel}</strong></span>
      </div>
      <div className="terminal-market-tape" aria-label="Bande de marché">
        {data?.market?.length ? data.market.slice(0, 4).map(item => <span className="terminal-market-tape__quote" key={item.symbol}>
          <strong>{item.symbol}</strong><b>{item.price}</b><em className={item.trend === "up" ? "positive" : item.trend === "down" ? "negative" : ""}>{item.change}</em>
        </span>) : <span className="terminal-market-tape__empty"><strong>MARKET FEED</strong><em>WAIT</em></span>}
      </div>
      <div className="global-search"><Icon name="search" size={16}/><input aria-label="Recherche globale" placeholder="Rechercher workflow, run, session, ID…"/><kbd>/</kbd></div>
      <div className="app-topbar__actions"><button className="icon-btn" onClick={() => setDensity(value => value === "compact" ? "comfortable" : "compact")} aria-label="Changer la densité"><Icon name="layers"/></button><button className="icon-btn notification-btn" onClick={() => navigate("/alerts")} aria-label="Alertes"><Icon name="bell"/>{!!data?.alerts?.length && <span>{data.alerts.length}</span>}</button></div>
    </header>

    <button type="button" className="mobile-context" aria-label={`Session automatique : ${phaseLabel}`} onClick={() => navigate("/sessions")}><i className="api-dot"/><strong>{phaseLabel}</strong><em>AUTO</em><span>→ {nextPhaseAt}</span></button>
    <main id="main-content" className="app-main"><Outlet/></main>
    <nav className="bottom-nav" aria-label="Navigation mobile">{bottom.map(item => <NavLink key={item.to} to={item.to} end={item.to === "/live"} className={({ isActive }) => `bottom-nav__item ${isActive ? "active" : ""}`}><Icon name={item.icon}/><span>{item.label}</span></NavLink>)}</nav>
  </div>;
}
````

### `src/components/operations.tsx`

````tsx
import { useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Card, Icon, StatusPill } from "@/components/common";
import type { OperationsEvent, PricePoint, WorkflowStatus, WorkflowSummary } from "@/operationsTypes";

export function Breadcrumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return <nav className="breadcrumbs" aria-label="Fil d’Ariane">
    {items.map((item, index) => <span key={`${item.label}-${index}`}>
      {index > 0 && <Icon name="arrow" size={12}/>} {item.to ? <Link to={item.to}>{item.label}</Link> : <strong aria-current="page">{item.label}</strong>}
    </span>)}
  </nav>;
}

export function PageHeading({ eyebrow, title, subtitle, backTo, actions, tabs }: { eyebrow?: string; title: string; subtitle?: string; backTo?: string; actions?: ReactNode; tabs?: ReactNode }) {
  const navigate = useNavigate();
  return <header className="workspace-heading page-header-v2">
    <div className="workspace-heading__main">
      {backTo && <button className="back-btn" onClick={() => navigate(backTo)} aria-label="Retour au parent"><Icon name="collapse" size={17}/></button>}
      <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
    </div>
    {actions && <div className="workspace-heading__actions">{actions}</div>}
    {tabs && <div className="page-header-v2__tabs">{tabs}</div>}
  </header>;
}

export function PageTabs({ items }: { items: Array<{ label: string; to: string; end?: boolean }> }) {
  return <>{items.map(item => <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>)}</>;
}

const statusGlyph: Record<string, string> = { queued: "○", running: "◐", waiting_gpt: "▲", paused: "Ⅱ", blocked: "□", failed: "×", completed: "✓", cancelled: "⊘", unknown: "?", open: "!", acknowledged: "✓", snoozed: "Ⅱ", resolved: "✓", archived: "○", pending: "!", read: "✓", dismissed: "−", cleared: "○", action_required: "!", waiting: "…", watching: "◐" };

export function StatusTag({ status }: { status: WorkflowStatus | string }) {
  const normalized = String(status || "unknown").toLowerCase();
  return <StatusPill status={normalized}><i aria-hidden="true">{statusGlyph[normalized] || "•"}</i>{statusLabel(normalized)}</StatusPill>;
}

export function ProgressBar({ value, status }: { value: number; status?: string }) {
  const safe = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return <div className={`progress-line progress-line--${status || "default"}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={safe}><i style={{ width: `${safe}%` }}/><span>{safe}%</span></div>;
}

export function MetricStrip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`metric-grid metric-strip ${className}`}>{children}</div>;
}

export function MetricCard({ label, value, detail, tone = "neutral", onClick }: { label: string; value: ReactNode; detail?: string; tone?: string; onClick?: () => void }) {
  const Element = onClick ? "button" : "div";
  return <Element className={`metric-card metric-card--${tone} ${onClick ? "metric-card--interactive" : ""}`} onClick={onClick}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</Element>;
}

export function EmptyWorkspace({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <Card className="workspace-empty"><Icon name="database" size={24}/><h3>{title}</h3><p>{text}</p>{action}</Card>;
}

export function WorkflowTable({ items, basePath = "/operations/workflows" }: { items: WorkflowSummary[]; basePath?: string }) {
  if (!items.length) return <EmptyWorkspace title="Aucune exécution" text="Les prochaines exécutions produites par le backend apparaîtront ici automatiquement."/>;
  return <div className="data-table-wrap"><table className="data-table">
    <thead><tr><th scope="col">Workflow</th><th scope="col">État</th><th scope="col">Session</th><th scope="col">Progression</th><th scope="col">Mise à jour</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
    <tbody>{items.map(item => <tr key={item.id}>
      <td data-label="Workflow"><strong>{item.name}</strong><small>{item.sourceId}</small></td>
      <td data-label="État"><StatusTag status={item.status}/></td>
      <td data-label="Session"><span>{item.tradingDate || "—"}</span><small>{item.session || item.kind}</small></td>
      <td data-label="Progression"><ProgressBar value={item.progress} status={item.status}/></td>
      <td data-label="Mise à jour"><time>{formatDateTime(item.updatedAt)}</time></td>
      <td data-label="Action"><Link className="row-link" to={`${basePath}/${encodeURIComponent(item.id)}`}><span>Ouvrir</span><Icon name="arrow" size={15}/></Link></td>
    </tr>)}</tbody>
  </table></div>;
}

export function EventTimeline({ events, runId, workflowId, selectedId, onSelect }: { events: OperationsEvent[]; runId?: string; workflowId?: string; selectedId?: string | null; onSelect?: (event: OperationsEvent) => void }) {
  if (!events.length) return <EmptyWorkspace title="Timeline vide" text="Les décisions, transitions et appels GPT seront horodatés ici."/>;
  return <ol className="event-timeline">{events.map(event => <li key={event.id} data-layer={event.layer || "event"} className={selectedId === event.id ? "is-selected" : ""}>
    <time>{formatDateTime(event.at)}</time><i aria-hidden="true"/><div tabIndex={onSelect ? 0 : undefined} onClick={() => onSelect?.(event)} onKeyDown={key => key.key === "Enter" && onSelect?.(event)}><div className="event-timeline__top"><strong>{event.title || event.type}</strong><StatusTag status={event.status}/></div>
      <p>{event.detail || event.conclusion || event.decision || "Transition enregistrée"}</p>
      {event.processId && runId && <Link to={`/replay/runs/${encodeURIComponent(runId)}/gpt/${encodeURIComponent(event.processId)}`}>Inspecter GPT <Icon name="arrow" size={13}/></Link>}
      {!event.processId && (workflowId || event.workflowId) && <Link to={`/operations/workflows/${encodeURIComponent(workflowId || event.workflowId || "")}/events/${encodeURIComponent(event.id)}`}>Ouvrir l’événement <Icon name="arrow" size={13}/></Link>}
    </div>
  </li>)}</ol>;
}

export function ReplayChart({ prices, events, runId, onSelect }: { prices: PricePoint[]; events: OperationsEvent[]; runId: string; onSelect?: (event: OperationsEvent | null) => void }) {
  const [zoom, setZoom] = useState(1);
  const [layers, setLayers] = useState({ decision: true, step: true, gpt: true });
  const [selected, setSelected] = useState<OperationsEvent | null>(null);
  const visible = useMemo(() => {
    const count = Math.max(20, Math.ceil(prices.length / zoom));
    return prices.slice(Math.max(0, prices.length - count));
  }, [prices, zoom]);
  const filteredEvents = useMemo(() => events.filter(event => layers[event.layer as keyof typeof layers] !== false), [events, layers]);
  const chart = useMemo(() => chartModel(visible, filteredEvents), [visible, filteredEvents]);
  const select = (event: OperationsEvent | null) => { setSelected(event); onSelect?.(event); };
  const windowLabel = visible.length ? `${formatTime(visible[0]?.time)}–${formatTime(visible.at(-1)?.time)}` : "indisponible";

  return <Card className="decision-chart replay-chart-v2">
    <header><div><p className="eyebrow">Timeline synchronisée</p><h2>Prix & décisions</h2><small>Fenêtre · {windowLabel}</small></div><div className="chart-controls">
      <div className="zoom-control"><button type="button" aria-label="Réduire le zoom" onClick={() => setZoom(value => Math.max(1, value - 1))}>−</button><label>Zoom <input aria-label="Zoom timeline" type="range" min="1" max="8" step="1" value={zoom} onChange={event => setZoom(Number(event.target.value))}/></label><button type="button" aria-label="Augmenter le zoom" onClick={() => setZoom(value => Math.min(8, value + 1))}>+</button></div>
      <div className="layer-toggles" role="group" aria-label="Couches affichées">{Object.keys(layers).map(layer => <button type="button" key={layer} data-layer={layer} aria-pressed={layers[layer as keyof typeof layers]} className={layers[layer as keyof typeof layers] ? "active" : ""} onClick={() => setLayers(value => ({ ...value, [layer]: !value[layer as keyof typeof layers] }))}><i/>{layerLabel(layer)}</button>)}</div>
    </div></header>
    {!visible.length ? <div className="chart-empty"><Icon name="chart"/><strong>Aucune bougie matérialisée</strong><p>Les décisions restent disponibles ci-dessous. Aucun prix n’est inventé.</p><ol className="chart-fallback-timeline">{filteredEvents.map(event => <li key={event.id}><time>{formatTime(event.at)}</time><span><strong>{event.title}</strong><small>{event.conclusion || event.detail || statusLabel(event.status)}</small></span><StatusTag status={event.status}/></li>)}</ol></div> : <div className="chart-scroll"><svg viewBox="0 0 1000 420" preserveAspectRatio="none" role="img" aria-label="Évolution du prix et décisions du replay">
      {[0,1,2,3,4].map(index => { const y = 35 + index * 78; return <g key={index}><line x1="70" x2="975" y1={y} y2={y} className="chart-grid"/><text x="5" y={y + 4}>{(chart.max - (chart.spread * index / 4)).toFixed(2)}</text></g>; })}
      <path d={chart.area} className="price-area"/><path d={chart.line} className="price-line"/>
      {chart.markers.map(marker => <g key={marker.event.id} className={`chart-marker chart-marker--${marker.event.layer} ${selected?.id === marker.event.id ? "is-selected" : ""}`} tabIndex={0} role="button" aria-label={`${marker.event.title}, ${formatTime(marker.event.at)}, ${marker.event.conclusion || marker.event.detail || marker.event.status}`} onFocus={() => select(marker.event)} onMouseEnter={() => select(marker.event)} onClick={() => select(marker.event)}>
        <line x1={marker.x} x2={marker.x} y1="35" y2="347"/>{markerShape(marker.event.layer, marker.x, marker.y)}
      </g>)}
      {selected && chart.markers.find(item => item.event.id === selected.id) && (() => { const marker = chart.markers.find(item => item.event.id === selected.id)!; return <g className="chart-tooltip"><line x1={marker.x} x2={marker.x} y1="28" y2="356"/><rect x={Math.min(765, Math.max(75, marker.x - 100))} y="10" width="200" height="52" rx="6"/><text x={Math.min(780, Math.max(90, marker.x - 85))} y="31">{formatTime(marker.event.at)} · {marker.event.title}</text><text x={Math.min(780, Math.max(90, marker.x - 85))} y="49">{marker.event.decision || marker.event.status}</text></g>; })()}
      <text x="70" y="392">{formatTime(visible[0]?.time)}</text><text x="900" y="392">{formatTime(visible.at(-1)?.time)}</text>
    </svg></div>}
    <div className="chart-event-strip" aria-label="Événements du graphique">{filteredEvents.slice(-12).map(event => <Link key={event.id} className={selected?.id === event.id ? "is-selected" : ""} onMouseEnter={() => select(event)} onFocus={() => select(event)} to={event.processId ? `/replay/runs/${encodeURIComponent(runId)}/gpt/${encodeURIComponent(event.processId)}` : "#timeline-events"}><i data-layer={event.layer}/><span>{formatTime(event.at)}</span><strong>{event.title}</strong></Link>)}</div>
  </Card>;
}

export const DecisionChart = ReplayChart;

function markerShape(layer: string | undefined, x: number, y: number) {
  if (layer === "decision") return <rect x={x - 6} y={y - 6} width="12" height="12" transform={`rotate(45 ${x} ${y})`}/>;
  if (layer === "gpt") return <path d={`M ${x} ${y - 8} L ${x + 8} ${y + 7} L ${x - 8} ${y + 7} Z`}/>;
  return <circle cx={x} cy={y} r="7"/>;
}

function layerLabel(layer: string) { return ({ decision: "Décision", step: "Étape", gpt: "GPT" } as Record<string,string>)[layer] || layer; }

function chartModel(points: PricePoint[], events: OperationsEvent[]) {
  const closes = points.map(point => point.close).filter(Number.isFinite);
  const min = closes.length ? Math.min(...closes) : 0;
  const max = closes.length ? Math.max(...closes) : 1;
  const spread = Math.max(max - min, Math.abs(max || 1) * .001);
  const x = (index: number) => 70 + (index / Math.max(1, points.length - 1)) * 905;
  const y = (price: number) => 347 - ((price - min) / spread) * 312;
  const coords = points.map((point, index) => [x(index), y(point.close)] as const);
  const line = coords.map(([cx, cy], index) => `${index ? "L" : "M"} ${cx.toFixed(1)} ${cy.toFixed(1)}`).join(" ");
  const from = Date.parse(points[0]?.time || "");
  const to = Date.parse(points.at(-1)?.time || "");
  const markers = events.map(event => {
    const at = Date.parse(event.at || "");
    if (!Number.isFinite(at) || !Number.isFinite(from) || !Number.isFinite(to) || at < from || at > to) return null;
    const cx = 70 + ((at - from) / Math.max(1, to - from)) * 905;
    const nearest = points.reduce((best, point, index) => Math.abs(Date.parse(point.time) - at) < Math.abs(Date.parse(points[best]?.time || "") - at) ? index : best, 0);
    return { event, x: cx, y: y(points[nearest]?.close || min) };
  }).filter(Boolean) as Array<{ event: OperationsEvent; x: number; y: number }>;
  const area = line ? `${line} L ${coords.at(-1)?.[0] || 70} 347 L 70 347 Z` : "";
  return { min, max, spread, line, area, markers };
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = { queued:"En attente",running:"En cours",waiting_gpt:"Attente GPT",blocked:"Bloqué",failed:"Échec",completed:"Terminé",cancelled:"Annulé",paused:"En pause",unknown:"Inconnu",open:"Ouvert",acknowledged:"Acquitté",snoozed:"Reporté",resolved:"Résolu",archived:"Archivé",pending:"À lire",read:"Lu",dismissed:"Masqué",cleared:"Clôturé",action_required:"Action requise",waiting:"Waiting",watching:"Watching" };
  return labels[status] || status;
}

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { dateStyle:"short",timeStyle:"short",timeZone:"Europe/Paris" }).format(date);
}
export function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(11,16) || value : new Intl.DateTimeFormat("fr-FR", { hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris" }).format(date);
}
export function formatDuration(value?: number | null) {
  if (value == null) return "—";
  if (value < 60_000) return `${Math.round(value / 1000)} s`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)} min`;
  return `${(value / 3_600_000).toFixed(1)} h`;
}
````

### `src/context/DeskContext.tsx`

````tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SessionId } from "@/types";

type MarketPhase = "asia" | "london" | "ny";

interface Value {
  sessionId: SessionId;
  phase: MarketPhase;
  phaseLabel: string;
  nextPhaseAt: string;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}
const Context = createContext<Value | null>(null);

export function resolveAutomaticSession(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === "hour")?.value || 0);
  const minute = Number(parts.find(part => part.type === "minute")?.value || 0);
  const minutes = hour * 60 + minute;
  if (minutes < 8 * 60) return { sessionId: "asia_open" as const, phase: "asia" as const, phaseLabel: "Asia", nextPhaseAt: "08:00" };
  if (minutes < 15 * 60 + 30) return { sessionId: "asia_open" as const, phase: "london" as const, phaseLabel: "London", nextPhaseAt: "15:30" };
  return { sessionId: "ny_open" as const, phase: "ny" as const, phaseLabel: "New York", nextPhaseAt: "00:00" };
}

export function DeskProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const automatic = useMemo(() => resolveAutomaticSession(now), [now]);
  const value = useMemo(() => ({ ...automatic, menuOpen, setMenuOpen }), [automatic, menuOpen]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useDeskContext() {
  const value = useContext(Context);
  if (!value) throw new Error("DeskProvider missing");
  return value;
}
````

### `src/context/OverlayContext.tsx`

````tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Drawer, Modal } from "@/components/common";

interface OverlayState { title: string; content: ReactNode }
interface Value {
  openDrawer: (title: string, content: ReactNode) => void;
  openModal: (title: string, content: ReactNode) => void;
  closeModal: () => void;
}
const Context = createContext<Value | null>(null);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState<OverlayState | null>(null);
  const [modal, setModal] = useState<OverlayState | null>(null);
  const value = useMemo(() => ({
    openDrawer: (title: string, content: ReactNode) => setDrawer({ title, content }),
    openModal: (title: string, content: ReactNode) => setModal({ title, content }),
    closeModal: () => setModal(null)
  }), []);
  return <Context.Provider value={value}>
    {children}
    <Drawer open={!!drawer} title={drawer?.title ?? ""} onClose={() => setDrawer(null)}>{drawer?.content}</Drawer>
    <Modal open={!!modal} title={modal?.title ?? ""} onClose={() => setModal(null)}>{modal?.content}</Modal>
  </Context.Provider>;
}
export function useOverlay() {
  const value = useContext(Context);
  if (!value) throw new Error("OverlayProvider missing");
  return value;
}
````

### `src/hooks/useDesk.ts`

````tsx
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { deskApi } from "@/api/deskApi";
import { refreshPolicyMs } from "@/api/endpoints";
import type {
  DeskActivityResource,
  DeskAlertsResource,
  DeskAuditResource,
  DeskDetailScope,
  DeskMacroResource,
  DeskMarketResource,
  DeskNewsDigestResource,
  DeskNewsHeadlinesResource,
  DeskPositionResource,
  DeskSession,
  SessionId
} from "@/types";

export const deskKeys = {
  session: (id: SessionId) => ["desk-session", id] as const,
  market: (id: SessionId) => ["desk-market", id] as const,
  position: (id: SessionId) => ["desk-position", id] as const,
  macro: (_id: SessionId) => ["desk-macro", "daily"] as const,
  newsDigest: (_id: SessionId) => ["desk-news-digest", "daily"] as const,
  newsHeadlines: (_id: SessionId) => ["desk-news-headlines", "daily"] as const,
  activity: (id: SessionId) => ["desk-activity", id] as const,
  alerts: (id: SessionId) => ["desk-alerts", id] as const,
  audit: (id: SessionId) => ["desk-audit", id] as const,
  timeline: (scope: DeskDetailScope) => ["desk-timeline", scope.session, scope.strategyId, scope.date] as const,
  master: (id: string, scope: DeskDetailScope) => ["desk-master", id, scope.session, scope.date] as const,
  monitor: (id: string, scope: DeskDetailScope) => ["desk-monitor", id, scope.session, scope.date] as const,
  thesis: (id: string, scope: DeskDetailScope) => ["desk-thesis", id, scope.session, scope.date] as const,
  thesisConditions: (id: string, scope: DeskDetailScope) => ["desk-thesis-conditions", id, scope.session, scope.date] as const,
  setup: (id: string, scope: DeskDetailScope) => ["desk-setup", id, scope.session, scope.date] as const
};

interface DeskSessionResources {
  market?: DeskMarketResource;
  position?: DeskPositionResource;
  macro?: DeskMacroResource;
  newsDigest?: DeskNewsDigestResource;
  newsHeadlines?: DeskNewsHeadlinesResource;
  activity?: DeskActivityResource;
  alerts?: DeskAlertsResource;
  audit?: DeskAuditResource;
}

/**
 * Merge independently refreshed read models over the initial aggregate.
 * Missing optional resources keep the last aggregate value, while canonical
 * execution resources override it whenever a fresher response is available.
 */
export function mergeDeskSessionResources(session: DeskSession, resources: DeskSessionResources): DeskSession {
  const resourceWarnings = Object.values(resources).flatMap(resource => resource?.warnings || []);
  const news = resources.newsDigest?.news || session.news;
  return {
    ...session,
    ...(resources.market && {
      lastDataAt: resources.market.lastDataAt,
      market: resources.market.market,
      marketBrief: resources.market.marketBrief,
      crossAssetBrief: resources.market.crossAssetBrief,
      levels: resources.market.levels
    }),
    ...(resources.position && { position: resources.position.position }),
    ...(resources.macro && { nextMacro: resources.macro.nextMacro, macro: resources.macro.macro }),
    news: {
      ...news,
      headlines: resources.newsHeadlines?.headlines || news.headlines
    },
    ...(resources.activity && { automation: resources.activity.automation, activity: resources.activity.activity }),
    ...(resources.alerts && { alerts: resources.alerts.alerts }),
    ...(resources.audit && { audit: resources.audit.audit }),
    dataQuality: {
      ...(resources.audit?.dataQuality || session.dataQuality),
      warnings: [...new Set([
        ...(resources.audit?.dataQuality.warnings || session.dataQuality.warnings),
        ...resourceWarnings
      ])]
    }
  };
}

export function useDeskSession(id: SessionId) {
  const sessionQuery = useQuery({
    queryKey: deskKeys.session(id),
    queryFn: () => deskApi.getSession(id),
    staleTime: 15_000,
    refetchInterval: refreshPolicyMs.projection,
    retry: 1
  });
  const dedicatedResourcesEnabled = Boolean(sessionQuery.data);
  const marketQuery = useQuery({
    queryKey: deskKeys.market(id),
    queryFn: () => deskApi.getMarketSnapshot(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 30_000,
    refetchInterval: refreshPolicyMs.market,
    retry: 1
  });
  const positionQuery = useQuery({
    queryKey: deskKeys.position(id),
    queryFn: () => deskApi.getPosition(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 5_000,
    refetchInterval: query => query.state.data?.position.active ? refreshPolicyMs.activePosition : refreshPolicyMs.projection,
    retry: 1
  });
  const macroQuery = useQuery({
    queryKey: deskKeys.macro(id),
    queryFn: () => deskApi.getMacroCalendar(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 30_000,
    refetchInterval: query => query.state.data?.nearEvent ? refreshPolicyMs.macroNearEvent : refreshPolicyMs.macro,
    retry: 1
  });
  const newsDigestQuery = useQuery({
    queryKey: deskKeys.newsDigest(id),
    queryFn: () => deskApi.getNewsDigest(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 60_000,
    refetchInterval: refreshPolicyMs.newsDigest,
    retry: 1
  });
  const newsHeadlinesQuery = useQuery({
    queryKey: deskKeys.newsHeadlines(id),
    queryFn: () => deskApi.getNewsHeadlines(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 30_000,
    refetchInterval: refreshPolicyMs.news,
    retry: 1
  });
  const activityQuery = useQuery({
    queryKey: deskKeys.activity(id),
    queryFn: () => deskApi.getDeskActivity(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 5_000,
    refetchInterval: query => isRunning(query.state.data?.automation.status) ? refreshPolicyMs.deskActivityRunning : refreshPolicyMs.deskActivityIdle,
    retry: 1
  });
  const alertsQuery = useQuery({
    queryKey: deskKeys.alerts(id),
    queryFn: () => deskApi.getAlerts(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 5_000,
    refetchInterval: refreshPolicyMs.alerts,
    retry: 1
  });
  const auditQuery = useQuery({
    queryKey: deskKeys.audit(id),
    queryFn: () => deskApi.getAudit(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 30_000,
    refetchInterval: refreshPolicyMs.audit,
    retry: 1
  });

  const data = useMemo(() => {
    if (!sessionQuery.data) return undefined;
    return mergeDeskSessionResources(sessionQuery.data, {
      market: marketQuery.data,
      position: positionQuery.data,
      macro: macroQuery.data,
      newsDigest: newsDigestQuery.data,
      newsHeadlines: newsHeadlinesQuery.data,
      activity: activityQuery.data,
      alerts: alertsQuery.data,
      audit: auditQuery.data
    });
  }, [
    sessionQuery.data,
    marketQuery.data,
    positionQuery.data,
    macroQuery.data,
    newsDigestQuery.data,
    newsHeadlinesQuery.data,
    activityQuery.data,
    alertsQuery.data,
    auditQuery.data
  ]);

  return {
    ...sessionQuery,
    data,
    refetch: async () => {
      const refetches: Array<() => Promise<unknown>> = [
        () => sessionQuery.refetch(),
        () => marketQuery.refetch(),
        () => positionQuery.refetch(),
        () => macroQuery.refetch(),
        () => newsDigestQuery.refetch(),
        () => newsHeadlinesQuery.refetch(),
        () => activityQuery.refetch(),
        () => alertsQuery.refetch(),
        () => auditQuery.refetch()
      ];
      await Promise.all(refetches.map(refetch => refetch()));
    }
  };
}

export function deskDetailScope(session: DeskSession): DeskDetailScope {
  return { session: session.id, strategyId: session.strategyId, date: session.date };
}

export function useTimelineDetail(scope: DeskDetailScope) {
  return useQuery({
    queryKey: deskKeys.timeline(scope),
    queryFn: () => deskApi.getTimeline(scope),
    enabled: Boolean(scope.strategyId && scope.date),
    staleTime: 15_000,
    refetchInterval: refreshPolicyMs.projection,
    retry: 1
  });
}

export function useMasterDetail(masterId: string, scope: DeskDetailScope) {
  return useQuery({
    queryKey: deskKeys.master(masterId, scope),
    queryFn: () => deskApi.getMaster(masterId, scope),
    enabled: detailEnabled(masterId),
    staleTime: 30_000,
    refetchInterval: refreshPolicyMs.projection,
    retry: 1
  });
}

export function useMonitorDetail(monitorId: string, scope: DeskDetailScope) {
  return useQuery({
    queryKey: deskKeys.monitor(monitorId, scope),
    queryFn: () => deskApi.getMonitor(monitorId, scope),
    enabled: detailEnabled(monitorId),
    staleTime: 15_000,
    refetchInterval: refreshPolicyMs.projection,
    retry: 1
  });
}

export function useThesisDetail(thesisId: string, scope: DeskDetailScope) {
  return useQuery({
    queryKey: deskKeys.thesis(thesisId, scope),
    queryFn: () => deskApi.getThesis(thesisId, scope),
    enabled: detailEnabled(thesisId),
    staleTime: 30_000,
    refetchInterval: refreshPolicyMs.projection,
    retry: 1
  });
}

export function useThesisConditionsDetail(thesisId: string, scope: DeskDetailScope) {
  return useQuery({
    queryKey: deskKeys.thesisConditions(thesisId, scope),
    queryFn: () => deskApi.getThesisConditions(thesisId, scope),
    enabled: detailEnabled(thesisId),
    staleTime: 15_000,
    refetchInterval: refreshPolicyMs.projection,
    retry: 1
  });
}

export function useSetupDetail(setupId: string, scope: DeskDetailScope) {
  return useQuery({
    queryKey: deskKeys.setup(setupId, scope),
    queryFn: () => deskApi.getSetup(setupId, scope),
    enabled: detailEnabled(setupId),
    staleTime: 30_000,
    refetchInterval: refreshPolicyMs.projection,
    retry: 1
  });
}

function isRunning(status: string | undefined) {
  return Boolean(status && !["idle", "unknown", "done", "failed", "cancelled"].includes(status.toLowerCase()));
}

function detailEnabled(id: string) {
  return Boolean(id) && !id.startsWith("no-");
}
````

### `src/hooks/useOperations.ts`

````tsx
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { operationsApi } from "@/api/operationsApi";

export const operationsKeys = {
  all: ["operations"] as const,
  summary: ["operations", "summary"] as const,
  workflows: (filters: Record<string, unknown>) => ["operations", "workflows", filters] as const,
  workflow: (id: string) => ["operations", "workflow", id] as const,
  replays: ["operations", "replays"] as const,
  replay: (id: string) => ["operations", "replay", id] as const,
  replayDay: (id: string, date: string) => ["operations", "replay", id, "day", date] as const,
  replaySession: (id: string, session: string) => ["operations", "replay", id, "session", session] as const,
  gpt: (runId?: string) => ["operations", "gpt", runId || "all"] as const,
  gptProcess: (id: string) => ["operations", "gpt-process", id] as const,
  observability: (filters: Record<string, unknown> = {}) => ["operations", "observability", filters] as const,
  performance: ["operations", "performance"] as const,
  incidents: ["operations", "incidents"] as const,
  notifications: (filters: Record<string, unknown> = {}) => ["operations", "notifications", filters] as const,
  runbooks: (filters: Record<string, unknown> = {}) => ["operations", "runbooks", filters] as const,
  runbook: (id: string) => ["operations", "runbook", id] as const,
  history: (filters: Record<string, unknown> = {}) => ["operations", "history", filters] as const,
  historySession: (id: string) => ["operations", "history-session", id] as const,
  strategies: ["operations", "strategies"] as const,
};

export function useOperationsSummary() {
  return useQuery({ queryKey: operationsKeys.summary, queryFn: operationsApi.getSummary, refetchInterval: 15_000 });
}

export function useWorkflows(filters: Record<string, string | number | null | undefined> = {}) {
  return useQuery({ queryKey: operationsKeys.workflows(filters), queryFn: () => operationsApi.listWorkflows(filters), refetchInterval: 15_000 });
}

export function useWorkflow(id: string) {
  return useQuery({ queryKey: operationsKeys.workflow(id), queryFn: () => operationsApi.getWorkflow(id), enabled: Boolean(id), refetchInterval: 10_000 });
}

export function useReplays(filters: Record<string, string | number | null | undefined> = {}) {
  return useQuery({ queryKey: [...operationsKeys.replays, filters], queryFn: () => operationsApi.listReplays(filters), refetchInterval: 20_000 });
}

export function useReplay(id: string) {
  return useQuery({ queryKey: operationsKeys.replay(id), queryFn: () => operationsApi.getReplay(id), enabled: Boolean(id), refetchInterval: 10_000 });
}

export function useReplayDay(id: string, date: string) {
  return useQuery({ queryKey: operationsKeys.replayDay(id, date), queryFn: () => operationsApi.getReplayDay(id, date), enabled: Boolean(id && date), refetchInterval: 15_000 });
}

export function useReplaySession(id: string, sessionId: string) {
  return useQuery({ queryKey: operationsKeys.replaySession(id, sessionId), queryFn: () => operationsApi.getReplaySession(id, sessionId), enabled: Boolean(id && sessionId), refetchInterval: 10_000 });
}

export function useGptProcesses(runId?: string) {
  return useQuery({ queryKey: operationsKeys.gpt(runId), queryFn: () => operationsApi.listGptProcesses(runId), refetchInterval: 10_000 });
}

export function useGptProcess(id: string) {
  return useQuery({ queryKey: operationsKeys.gptProcess(id), queryFn: () => operationsApi.getGptProcess(id), enabled: Boolean(id), refetchInterval: 10_000 });
}

export function useObservability(filters: Record<string, string | number | null | undefined> = {}) {
  return useQuery({
    queryKey: operationsKeys.observability(filters),
    queryFn: () => operationsApi.getObservability(filters),
    refetchInterval: 10_000,
  });
}

export function useNotifications(filters: Record<string, string | number | null | undefined> = {}) {
  return useQuery({
    queryKey: operationsKeys.notifications(filters),
    queryFn: () => operationsApi.listNotifications(filters),
    refetchInterval: 10_000,
  });
}

export function useRunbooks(filters: Record<string, string | number | null | undefined> = {}) {
  return useQuery({
    queryKey: operationsKeys.runbooks(filters),
    queryFn: () => operationsApi.listRunbooks(filters),
    refetchInterval: 10_000,
  });
}

export function useRunbook(id: string) {
  return useQuery({
    queryKey: operationsKeys.runbook(id),
    queryFn: () => operationsApi.getRunbook(id),
    enabled: Boolean(id),
    refetchInterval: 10_000,
  });
}

export function useOperationsEvents() {
  const client = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const stream = new EventSource(operationsApi.eventsUrl, { withCredentials: true });
    const refresh = () => client.invalidateQueries({ queryKey: operationsKeys.all });
    stream.addEventListener("operations", refresh);
    return () => {
      stream.removeEventListener("operations", refresh);
      stream.close();
    };
  }, [client]);
}
````

### `src/hooks/useOperator.ts`

````tsx
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deskApi } from "@/api/deskApi";
import {
  listenToOperatorAuth,
  operatorAuthAvailable,
  signInOperator,
  signOutOperator,
  type OperatorUser
} from "@/api/operatorAuth";
import { deskKeys } from "@/hooks/useDesk";
import type { DeskOperatorCommandInput, DeskOperatorScope, DeskSession } from "@/types";

type OperatorAuthState = {
  status: "loading" | "ready" | "signed_out" | "unavailable" | "error";
  email: string | null;
  message: string | null;
};

const operatorKeys = {
  state: (scope: DeskOperatorScope) => ["desk-operator-state", scope.session, scope.strategyId, scope.tradingDate, scope.mode] as const
};

function deskOperatorScope(session: DeskSession): DeskOperatorScope {
  return {
    session: session.id,
    strategyId: session.strategyId,
    tradingDate: session.date,
    mode: String(session.mode).toLowerCase() === "paper" ? "paper" : "live"
  };
}

export function useOperatorState(session: DeskSession) {
  const scope = deskOperatorScope(session);
  return useQuery({
    queryKey: operatorKeys.state(scope),
    queryFn: () => deskApi.getOperatorState(scope),
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1
  });
}

export function useOperatorCommand(session: DeskSession) {
  const queryClient = useQueryClient();
  const scope = deskOperatorScope(session);
  return useMutation({
    mutationFn: (input: Omit<DeskOperatorCommandInput, keyof DeskOperatorScope>) => deskApi.executeOperatorCommand({ ...scope, ...input }),
    onSuccess: async result => {
      queryClient.setQueryData(operatorKeys.state(scope), result.operatorState);
      queryClient.setQueryData(deskKeys.session(scope.session), result.session);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: deskKeys.session(scope.session) }),
        queryClient.invalidateQueries({ queryKey: deskKeys.position(scope.session) }),
        queryClient.invalidateQueries({ queryKey: deskKeys.setup(result.session.setup.id, {
          session: scope.session,
          strategyId: scope.strategyId,
          date: scope.tradingDate
        }) }),
        queryClient.invalidateQueries({ queryKey: operatorKeys.state(scope) })
      ]);
    }
  });
}

export function useOperatorAuth() {
  const [state, setState] = useState<OperatorAuthState>({ status: "loading", email: null, message: null });

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => undefined;
    void operatorAuthAvailable().then(async available => {
      if (!active) return;
      if (!available) {
        setState({ status: "unavailable", email: null, message: "La clé opérateur locale n’est pas configurée." });
        return;
      }
      unsubscribe = await listenToOperatorAuth(user => {
        if (!active) return;
        setState(authStateFromUser(user));
      });
    }).catch(error => {
      if (active) setState({ status: "error", email: null, message: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signIn = async () => {
    setState(current => ({ ...current, status: "loading", message: null }));
    try {
      const user = await signInOperator();
      setState(authStateFromUser(user));
    } catch (error) {
      setState({ status: "error", email: null, message: error instanceof Error ? error.message : String(error) });
    }
  };
  const signOut = async () => {
    await signOutOperator();
    setState({ status: "signed_out", email: null, message: null });
  };

  return { ...state, signIn, signOut };
}

function authStateFromUser(user: OperatorUser | null): OperatorAuthState {
  return user
    ? { status: "ready", email: user.email, message: null }
    : { status: "signed_out", email: null, message: null };
}
````

### `src/main.tsx`

````tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import App from "@/App";
import { DeskProvider } from "@/context/DeskContext";
import "@/styles/v2.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnMount: "always",
      refetchOnWindowFocus: "always",
      refetchOnReconnect: "always",
      refetchIntervalInBackground: true
    }
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DeskProvider><App/></DeskProvider>
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => undefined));
}
````

### `src/operationsTypes.ts`

````tsx
export type WorkflowStatus = "queued" | "running" | "waiting_gpt" | "blocked" | "failed" | "completed" | "cancelled" | "paused" | "unknown";

export interface WorkflowSummary {
  id: string;
  sourceId: string;
  kind: "replay" | "backtest" | "job" | "feature" | string;
  name: string;
  status: WorkflowStatus;
  rawStatus: string;
  revision: number;
  tradingDate: string | null;
  session: string | null;
  strategyId: string | null;
  variantId: string | null;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  durationMs: number | null;
  error: { code?: string | null; message: string; retryable?: boolean | null } | null;
  metrics: { totalR?: number | null; stepsDone?: number; stepsTotal?: number; gptProcesses?: number; [key: string]: unknown };
  currentStepId: string | null;
  currentWorkItemId: string | null;
  nextAction: string | null;
  automationEnabled: boolean;
  attempt?: number;
  sessionExecutionId?: string;
}

export interface WorkflowStep {
  id: string;
  sequence: number;
  type: string;
  status: WorkflowStatus;
  rawStatus: string;
  at: string | null;
  durationMs: number | null;
  inputRef: unknown;
  outputRef: unknown;
  error: WorkflowSummary["error"];
}

export interface OperationsEvent {
  id: string;
  type: string;
  status: WorkflowStatus;
  at: string | null;
  title: string;
  detail: string;
  actor: unknown;
  ref: unknown;
  layer?: "decision" | "step" | "gpt" | string;
  processId?: string | null;
  decision?: string | null;
  conclusion?: string | null;
  price?: number | null;
  severity?: string;
  workflowId?: string;
  workflowName?: string;
}

export interface OperationsSummary {
  contract: "DeskOperationsSummary";
  schemaVersion: "1.0.0";
  generatedAt: string;
  totals: {
    workflows: number; running: number; waitingGpt: number; blocked: number; failed: number;
    completed: number; openIncidents: number; gptInProgress: number;
  };
  health: { status: string; label: string };
  recent: WorkflowSummary[];
}

export interface WorkflowList { contract: string; schemaVersion: string; count: number; items: WorkflowSummary[] }
export interface WorkflowDetail {
  contract: string; schemaVersion: string; workflow: WorkflowSummary; steps: WorkflowStep[];
  events: OperationsEvent[]; allowedActions: Array<"retry" | "resume" | "pause" | "cancel">;
  relations: Record<string, unknown>;
}

export interface ReplayDaySummary {
  date: string;
  status: WorkflowStatus;
  sessionCount: number;
  running: number;
  failed: number;
  totalProgress: number;
  totalR: number;
  sessions: WorkflowSummary[];
}

export interface ReplayList {
  contract: string;
  schemaVersion: string;
  generatedAt?: string;
  filters?: Record<string, string | null>;
  count: number;
  summary?: {
    executions: number; days: number; active: number; running: number; waitingGpt: number; blocked: number;
    failed: number; completed: number; averageProgress: number; totalR: number; gptProcesses: number;
  };
  facets?: { statuses: string[]; sessions: string[]; strategies: string[]; variants: string[] };
  days: ReplayDaySummary[];
  items: WorkflowSummary[];
}
export interface ReplayDayDetail {
  contract: string; schemaVersion: string; runId: string; date: string; status: WorkflowStatus;
  metrics: { totalR: number; progress: number; sessionCount: number; gptProcesses?: number; gptWaiting?: number; gptFailed?: number; events?: number };
  sessions: WorkflowSummary[]; variants: string[];
  gptProcesses?: GptProcess[];
  conclusions?: Array<{ processId: string; runId: string | null; conclusion: string; at: string | null }>;
  timeline?: OperationsEvent[];
}

export interface PricePoint { time: string; open: number | null; high: number | null; low: number | null; close: number; volume?: number | null; source?: string }

export interface GptProcess {
  id: string; runId: string | null; stepId: string | null; workflow: string; status: WorkflowStatus; rawStatus: string;
  revision: number; attempt: number; maxAttempts: number; worker: string | null; leaseExpiresAt: string | null;
  createdAt: string | null; startedAt: string | null; completedAt: string | null; updatedAt: string | null;
  durationMs: number | null; events: OperationsEvent[]; conclusion: string | null; decision: string | null;
  error: WorkflowSummary["error"]; telemetry: GptTelemetry; bundle: { bundleId: string; manifest: unknown; dataQuality: unknown } | null;
}

export interface GptProcessList { contract: string; schemaVersion: string; count: number; items: GptProcess[] }
export interface GptTransportContract {
  saveTool: string | null;
  suggestedPayload: Record<string, unknown> | null;
  workItemId: string | null;
  workerId: string | null;
  leaseToken: string | null;
  hasLeaseHandle: boolean;
  lease: { state: "none" | "active" | "expiring" | "expired"; expiresAt: string | null; remainingMs: number | null };
  manifestAvailable: boolean;
  saveTargetAvailable: boolean;
  promptAvailable: boolean;
}
export interface GptProcessDetail { contract: string; schemaVersion: string; process: GptProcess; manifest: unknown; prompt: string | null; saveTarget: unknown; transport: GptTransportContract; error: unknown; raw: unknown }

export interface GptTelemetry {
  available: boolean;
  provider: string | null;
  model: string | null;
  requestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
  apiLatencyMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ObservabilityProcess {
  id: string;
  scope: "live" | "replay" | string;
  workflow: string;
  runId: string | null;
  workItemId: string | null;
  cursorId: string | null;
  checkpoint: string | null;
  tradingDate: string | null;
  session: string | null;
  strategyId: string | null;
  status: WorkflowStatus;
  rawStatus: string;
  worker: string | null;
  attempts: number;
  maxAttempts: number;
  failureCount: number;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  leaseExpiresAt: string | null;
  queueMs: number | null;
  executionMs: number | null;
  endToEndMs: number | null;
  lease: { state: "none" | "active" | "expiring" | "expired"; expiresAt: string | null; remainingMs: number | null };
  telemetry: GptTelemetry;
  sla: { queueBreached: boolean; executionBreached: boolean; leaseBreached: boolean };
  error: WorkflowSummary["error"];
}

export interface ObservabilityBreakdown {
  label: string;
  processes: number;
  running: number;
  failed: number;
  successRate: number | null;
  avgExecutionMs: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  costCoverage: { available: number; total: number; percent: number };
}

export interface ObservabilityPolicy {
  id: string;
  revision: number;
  enabled: boolean;
  queueWarningMs: number;
  executionWarningMs: number;
  leaseExpiringMs: number;
  telemetryCoverageWarningPct: number;
  costCoverageMinimumPct: number;
  failureRateWarningPct: number;
  dailyCostBudgetUsd: number | null;
  monthlyCostBudgetUsd: number | null;
  updatedAt: string | null;
}

export interface GuardrailSignal {
  id: string;
  type: string;
  severity: "critical" | "warning";
  title: string;
  message: string;
  targetId: string;
  processId?: string | null;
  runId?: string | null;
  observedValue: number | null;
  thresholdValue: number | null;
  unit: "ms" | "percent" | "usd" | string;
  observedAt: string | null;
}

export interface BudgetPeriod {
  period: string;
  measuredCostUsd: number;
  limitUsd: number | null;
  coveragePct: number;
  state: "not_configured" | "breached" | "insufficient_data" | "within";
}

export interface ObservabilityPolicyActionInput {
  action: "update";
  expectedRevision: number;
  idempotencyKey: string;
  confirmationPhrase: "CONFIRM_UPDATE";
  reason: string;
  policy: Omit<ObservabilityPolicy, "id" | "revision" | "updatedAt">;
}

export interface ObservabilityPolicyResponse {
  contract: "DeskObservabilityPolicy";
  schemaVersion: "1.0.0";
  policy: ObservabilityPolicy;
  persisted: boolean;
}

export interface ObservabilityOverview {
  contract: "DeskObservabilityOverview";
  schemaVersion: "1.0.0";
  generatedAt: string;
  filters: Record<string, string | null>;
  sla: { queueWarningMs: number; executionWarningMs: number; leaseExpiringMs: number };
  summary: {
    processes: number; queued: number; running: number; failed: number; completed: number; retries: number;
    successRate: number | null; avgQueueMs: number | null; avgExecutionMs: number | null; p95ExecutionMs: number | null;
    inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; costUsd: number | null; slaBreaches: number;
  };
  coverage: {
    telemetry: { available: number; total: number; percent: number };
    tokens: { available: number; total: number; percent: number };
    cost: { available: number; total: number; percent: number };
  };
  guardrails: {
    policy: ObservabilityPolicy;
    enabled: boolean;
    summary: {
      signals: number; critical: number; warning: number; telemetryCoveragePct: number;
      costCoveragePct: number; failureRatePct: number | null;
    };
    budgets: { daily: BudgetPeriod[]; monthly: BudgetPeriod[] };
    signals: GuardrailSignal[];
  };
  leases: { active: number; expiring: number; expired: number };
  queue: { depth: number; oldestQueuedMs: number | null };
  facets: {
    scopes: string[]; workflows: string[]; workers: string[]; sessions: string[]; models: string[]; providers: string[];
    statuses: string[]; dateRange: { from: string | null; to: string | null };
  };
  breakdowns: { workflows: ObservabilityBreakdown[]; workers: ObservabilityBreakdown[]; models: ObservabilityBreakdown[] };
  daily: Array<{ date: string; processes: number; completed: number; failed: number; totalTokens: number | null; costUsd: number | null }>;
  count: number;
  items: ObservabilityProcess[];
}

export interface ReplayRunDetail {
  contract: string; schemaVersion: string; run: WorkflowSummary; canonicalState: Record<string, unknown>;
  timeline: OperationsEvent[]; priceSeries: PricePoint[]; gptProcesses: GptProcess[];
  conclusions: Array<{ processId: string; conclusion: string; at: string | null }>;
}

export interface ReplaySessionDetail extends ReplayRunDetail { parentRunId: string; sessionExecutionId: string }

export interface Incident {
  id: string; sourceId: string; sourceCollection: string; kind: string; title: string; message: string;
  severity: string; lifecycleStatus: "open" | "acknowledged" | "snoozed" | "resolved" | "archived";
  revision: number; tradingDate: string | null; session: string | null; runId: string | null;
  processId?: string | null; targetId?: string | null; workflow?: string | null; worker?: string | null;
  source?: string | null; guardrailType?: string | null; fingerprint?: string | null; owner?: string | null;
  occurrenceCount?: number; observedValue?: number | null; thresholdValue?: number | null; unit?: string | null;
  policyRevision?: number | null; policySnapshot?: Record<string, unknown> | null; evidence?: Record<string, unknown> | null;
  timeline?: IncidentTimelineEvent[];
  createdAt: string | null; firstObservedAt?: string | null; lastObservedAt?: string | null; resolvedAt?: string | null;
  updatedAt: string | null; snoozedUntil: string | null;
}

export interface IncidentTimelineEvent {
  id: string;
  type: string;
  at: string | null;
  title: string;
  message: string;
  severity: string;
  actor: unknown;
  evidence: Record<string, unknown> | null;
}

export interface IncidentList {
  contract: string;
  schemaVersion: string;
  count: number;
  summary?: {
    open: number; critical: number; warning: number; acknowledged: number; snoozed: number; resolved: number; guardrails: number;
  };
  items: Incident[];
}

export interface ObservabilityIncidentSync {
  contract: "DeskObservabilityIncidentSync";
  schemaVersion: "1.0.0";
  generatedAt: string;
  evaluatedSignals: number;
  opened: number;
  updated: number;
  unchanged: number;
  resolved: number;
  active: number;
  incidents: Incident[];
  notifications?: NotificationSync | { ok: false; error: unknown } | null;
}

export type NotificationStatus = "pending" | "read" | "dismissed" | "cleared";
export type EscalationLevel = "page" | "action" | "watch" | "muted" | "cleared";

export interface OperationsNotification {
  id: string;
  sourceId: string;
  source: string | null;
  channel: string;
  deliveryState: string;
  status: NotificationStatus;
  escalationLevel: EscalationLevel;
  priority: number;
  reasonCodes: string[];
  title: string;
  message: string;
  severity: string;
  revision: number;
  incidentId: string | null;
  incidentSourceId: string | null;
  incidentKind: string | null;
  incidentRevision: number;
  incidentLifecycleStatus: string | null;
  owner: string | null;
  runId: string | null;
  processId: string | null;
  workflow: string | null;
  worker: string | null;
  tradingDate: string | null;
  session: string | null;
  targetId: string | null;
  targetUrl: string | null;
  dedupeKey: string | null;
  fingerprint: string | null;
  evidence: Record<string, unknown> | null;
  timeline: IncidentTimelineEvent[];
  firstNotifiedAt: string | null;
  lastEvaluatedAt: string | null;
  readAt: string | null;
  dismissedAt: string | null;
  clearedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  allowedActions: NotificationAction[];
}

export interface NotificationList {
  contract: "DeskNotificationList";
  schemaVersion: "1.0.0";
  generatedAt: string;
  filters: Record<string, string | null>;
  count: number;
  summary: {
    active: number; pending: number; read: number; dismissed: number; cleared: number;
    page: number; action: number; watch: number; muted: number;
  };
  items: OperationsNotification[];
}

export interface NotificationSync {
  contract: "DeskNotificationSync";
  schemaVersion: "1.0.0";
  generatedAt: string;
  evaluatedIncidents: number;
  opened: number;
  updated: number;
  unchanged: number;
  cleared: number;
  active: number;
  notifications: OperationsNotification[];
}

export type NotificationAction = "mark_read" | "dismiss";
export interface NotificationActionInput {
  action: NotificationAction;
  expectedRevision: number;
  idempotencyKey: string;
  confirmationPhrase: string;
  reason: string;
}

export type RunbookStatus = "action_required" | "waiting" | "watching" | "resolved";
export type RunbookKind = "lease_expired" | "workflow_blocked" | "gpt_failure" | "telemetry_missing" | "cost_budget_breach" | "data_quality_issue" | "incident_response" | string;

export interface RunbookStep {
  id: string;
  index: number;
  kind: "investigation" | "operator_action" | string;
  title: string;
  description: string;
  href?: string;
  commandAction?: string;
}

export interface RunbookLink {
  label: string;
  href: string;
  kind: string;
}

export interface OperationsRunbook {
  id: string;
  sourceId: string;
  kind: RunbookKind;
  title: string;
  summary: string;
  severity: string;
  status: RunbookStatus;
  priority: number;
  reasonCodes: string[];
  notificationId: string | null;
  incidentId: string | null;
  workflowId: string | null;
  runId: string | null;
  processId: string | null;
  owner: string | null;
  session: string | null;
  tradingDate: string | null;
  updatedAt: string | null;
  context: Record<string, string | number | boolean | null>;
  steps: RunbookStep[];
  nextAction: RunbookStep | null;
  links: RunbookLink[];
  timeline: Array<IncidentTimelineEvent & { source?: string }>;
}

export interface RunbookList {
  contract: "DeskRunbookList";
  schemaVersion: "1.0.0";
  generatedAt: string;
  filters: Record<string, string | null>;
  count: number;
  summary: {
    actionRequired: number; waiting: number; watching: number; critical: number; warning: number;
    leaseExpired: number; workflowBlocked: number; gptFailure: number; dataQuality: number;
  };
  items: OperationsRunbook[];
}

export interface RunbookDetail {
  contract: "DeskRunbookDetail";
  schemaVersion: "1.0.0";
  generatedAt: string;
  runbook: OperationsRunbook;
  related: { incidentId: string | null; notificationId: string | null; workflowId: string | null; processId: string | null };
}
export interface PerformanceTotals {
  totalR: number; trades: number; wins: number; losses: number; flats: number; winRate: number | null; expectancyR: number | null;
  grossProfitR: number; grossLossR: number; profitFactor: number | null; maxDrawdownR: number; currentDrawdownR: number;
  bestTradeR: number | null; worstTradeR: number | null; bestDayR: number | null; worstDayR: number | null;
  activeDays: number; winningDays: number; losingDays: number;
}
export interface PerformanceDailyPoint {
  date: string; totalR: number; trades: number; wins: number; losses: number; winRate: number | null;
  runIds: string[]; strategyIds: string[]; sessions: string[]; source: string;
}
export interface PerformanceEquityPoint {
  sequence: number; date: string | null; at: string | null; tradeId: string | null; runId: string | null;
  strategyId: string | null; resultR: number; cumulativeR: number; drawdownR: number;
}
export interface PerformanceBreakdownItem {
  label: string; totalR: number; trades: number; wins?: number; losses?: number; winRate?: number | null; expectancyR?: number | null;
}
export interface PerformanceOverview {
  contract: string; schemaVersion: string; generatedAt: string; filters: Record<string, string | null>;
  totals: PerformanceTotals; risk: Pick<PerformanceTotals, "maxDrawdownR" | "currentDrawdownR" | "profitFactor" | "bestTradeR" | "worstTradeR" | "bestDayR" | "worstDayR">;
  facets: { strategies: string[]; sessions: string[]; instruments: string[]; directions: string[]; dateRange: { from: string | null; to: string | null } };
  stats: Array<Record<string, unknown>>; daily: Array<Record<string, unknown>>; dailySeries: PerformanceDailyPoint[];
  equity: PerformanceEquityPoint[]; relatedRuns: WorkflowSummary[]; replayDays: ReplayDaySummary[];
  breakdowns: Array<{ dimension: string; items: PerformanceBreakdownItem[] }>;
}
export interface HistorySessionSummary {
  id: string; tradingDate: string | null; session: string | null; status: WorkflowStatus; workflowCount: number;
  progress: number; totalR: number; gptProcesses: number; incidentCount: number; kinds: string[]; strategies: string[];
  startedAt: string | null; completedAt: string | null; updatedAt: string | null; durationMs: number;
  performance: PerformanceDailyPoint | null; workflows: WorkflowSummary[];
}
export interface DeskHistory {
  contract: string; schemaVersion: string; generatedAt: string; filters: Record<string, string | null>;
  summary: {
    sessions: number; workflows: number; running: number; waitingGpt: number; blocked: number; failed: number; completed: number;
    openIncidents: number; totalR: number; gptProcesses: number; activeDays: number; strategies: number;
  };
  facets: {
    statuses: string[]; sessions: string[]; kinds: string[]; strategies: string[];
    dateRange: { from: string | null; to: string | null };
  };
  sessions: HistorySessionSummary[]; incidents: Incident[]; audit: Array<Record<string, unknown>>; performance: PerformanceOverview;
}
export interface HistorySessionDetail {
  contract: string; schemaVersion: string; generatedAt: string; session: HistorySessionSummary;
  summary: {
    workflows: number; running: number; waitingGpt: number; blocked: number; failed: number; completed: number;
    progress: number; totalR: number; gptProcesses: number; incidents: number; events: number; strategies: number;
  };
  workflows: WorkflowSummary[]; gptProcesses: GptProcess[]; incidents: Incident[]; timeline: OperationsEvent[];
  performance: PerformanceOverview;
}
export interface StrategyList {
  contract: string; schemaVersion: string; count: number;
  items: Array<{
    id: string; catalog: Record<string, unknown> | null; config: Record<string, unknown> | null; runtime: Record<string, unknown> | null;
    stats: Record<string, unknown> | null; performance: PerformanceTotals; replayCount: number;
    versions: Array<Record<string, unknown>>; activeContracts: Array<{ name: string; version: string; status: string }>;
  }>;
}
export interface StrategyVersionChange { path: string; before: unknown; after: unknown }
export interface StrategyVersionComparison {
  contract: string; schemaVersion: string; strategyId: string;
  left: Record<string, unknown> | null; right: Record<string, unknown> | null; changes: StrategyVersionChange[];
}

export interface OperationsCommandInput {
  action: "retry" | "resume" | "pause" | "cancel" | "acknowledge" | "assign" | "snooze" | "resolve" | "reopen";
  expectedRevision: number;
  idempotencyKey: string;
  confirmationPhrase: string;
  reason: string;
  snoozedUntilUtc?: string;
  owner?: string;
}
````

### `src/pages/AlertsPage.tsx`

````tsx
import { Link } from "react-router-dom";
import { Card, Icon, StatusBadge } from "@/components/common";
import { PageHeading } from "@/components/operations";
import { DeskPage } from "@/pages/pageState";

export default function AlertsPage() {
  return <DeskPage>{data => <section className="view">
    <PageHeading eyebrow="Temps réel" title="Alertes Live" subtitle="Signaux de la session courante nécessitant ton attention"/>
    <Card className="alerts-scope-banner">
      <Icon name="info"/><div><strong>Alertes de marché en temps réel</strong><p>Cette vue suit uniquement la session active. Les incidents techniques et les interventions opérateur restent dans le cockpit.</p></div>
      <Link className="secondary-btn" to="/operations/incidents">Voir les incidents</Link>
    </Card>
    <div className="alert-list-react">
      {data.alerts.map((alert, index) => <Card key={index} className={`alert-react alert-react--${alert.level}`}>
        <span className="alert-react__icon"><Icon name="alert"/></span><div><div className="alert-react__head"><h3>{alert.title}</h3><StatusBadge tone={alert.level === "critical" ? "critical" : "warning"}>{alert.time}</StatusBadge></div><p>{alert.message}</p></div>
      </Card>)}
      {!data.alerts.length && <Card className="workspace-empty"><Icon name="check"/><h3>Aucune alerte Live</h3><p>La session courante ne requiert aucune action.</p></Card>}
    </div>
  </section>}</DeskPage>;
}
````

### `src/pages/AuditPage.tsx`

````tsx
import { Card, Icon, StatusBadge } from "@/components/common";
import { PageHeading } from "@/components/operations";
import { DeskPage } from "@/pages/pageState";

export default function AuditPage() {
  return <DeskPage>{data => <section className="view">
    <PageHeading eyebrow="Gouvernance" title="Audit" subtitle="Contrats, qualité, anti-lookahead et mapping API"/>
    <Card className="audit-summary-react">
      <div><span className={`audit-orb ${data.dataQuality.status}`}/><div><p className="eyebrow">Data readiness</p><h2>{data.dataQuality.label}</h2><p>Anti-lookahead : {data.dataQuality.antiLookahead ? "conforme" : "à vérifier"}</p></div></div>
      {data.dataQuality.warnings.length > 0 && <div className="audit-warnings-react">{data.dataQuality.warnings.map(w => <span key={w}><Icon name="alert" size={15}/>{w}</span>)}</div>}
    </Card>
    <div className="content-grid content-grid--start">
      <Card className="audit-detail-card"><h3>Contrats actifs</h3><div className="audit-list-react">{data.audit.contracts.map(item => <div key={item.name}><div><strong>{item.name}</strong><small>v{item.version}</small></div><StatusBadge tone="info">{item.status}</StatusBadge></div>)}</div></Card>
      <Card className="audit-detail-card"><h3>Checks backend</h3><div className="audit-list-react">{data.audit.checks.map(item => <div key={item.label}><strong>{item.label}</strong><StatusBadge tone={item.status === "warning" ? "warning" : "info"}>{item.status}</StatusBadge></div>)}</div></Card>
    </div>
    <Card className="audit-detail-card"><h3>Mapping front → backend</h3><div className="api-map-react">{data.audit.apiMap.map(item => <div key={item.view}><span>{item.view}</span><code>{item.endpoint}</code></div>)}</div></Card>
  </section>}</DeskPage>;
}
````

### `src/pages/GptProcessPage.tsx`

````tsx
import { useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, EventTimeline, formatDateTime, formatDuration, MetricCard, MetricStrip, PageHeading, StatusTag } from "@/components/operations";
import { useGptProcess } from "@/hooks/useOperations";
import type { GptProcess, GptTransportContract } from "@/operationsTypes";

export default function GptProcessPage() {
  const { runId = "", processId = "" } = useParams();
  const parent = decodeURIComponent(runId);
  const id = decodeURIComponent(processId);
  const query = useGptProcess(id);

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Processus GPT introuvable"} retry={() => query.refetch()}/>;

  const data = query.data;
  return <section className="view workspace-view gpt-inspector-v3">
    <Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: parent, to: `/replay/runs/${encodeURIComponent(parent)}` }, { label: "Processus GPT" }, { label: data.process.workflow }]}/>
    <PageHeading eyebrow="GPT process inspector" title={data.process.workflow} subtitle={`${data.process.id} · ${data.process.rawStatus}`} backTo={`/replay/runs/${encodeURIComponent(parent)}`} actions={<StatusTag status={data.process.status}/>}/>

    <MetricStrip className="metric-grid--compact replay-summary-strip">
      <MetricCard label="Tentative" value={`${data.process.attempt}/${data.process.maxAttempts || "—"}`}/>
      <MetricCard label="Durée" value={formatDuration(data.process.durationMs)}/>
      <MetricCard label="Worker" value={data.process.worker || "—"}/>
      <MetricCard label="Lease" value={formatDateTime(data.process.leaseExpiresAt)}/>
      <MetricCard label="Bundle" value={data.process.bundle?.bundleId || "—"}/>
      <MetricCard label="Fin" value={formatDateTime(data.process.completedAt)}/>
      <MetricCard label="Modèle" value={data.process.telemetry.model || "N/D"} detail={data.process.telemetry.provider || "Télémétrie absente"}/>
      <MetricCard label="Tokens" value={data.process.telemetry.totalTokens === null ? "N/D" : data.process.telemetry.totalTokens.toLocaleString("fr-FR")} detail={tokenDetail(data.process)}/>
      <MetricCard label="Coût observé" value={data.process.telemetry.costUsd === null ? "N/D" : `$${data.process.telemetry.costUsd.toFixed(4)}`} detail="Aucune estimation locale"/>
    </MetricStrip>

    <GptLifecycle process={data.process}/>
    <GptContractPanel transport={data.transport}/>

    {data.process.error && <Card className="error-box gpt-error-box"><div><span>PROCESS_FAILURE</span><strong>{data.process.error.code || "Erreur GPT"}</strong></div><p>{data.process.error.message}</p></Card>}

    <div className="gpt-inspector-workbench">
      <Card className="gpt-conclusion-panel">
        <header><div><p className="eyebrow">Sortie canonique sauvegardée</p><h2>{data.process.decision || "Décision GPT en attente"}</h2></div><StatusTag status={data.process.conclusion ? "completed" : data.process.status}/></header>
        <p className="conclusion-copy">{data.process.conclusion || "Aucune conclusion n’a encore été sauvegardée par le workflow."}</p>
        <div className="gpt-output-meta"><span>PROCESS <strong>{data.process.id}</strong></span><span>STEP <strong>{data.process.stepId || "—"}</strong></span><span>RUN <strong>{data.process.runId || parent}</strong></span></div>
      </Card>
      <Card className="gpt-transport-panel">
        <header><p className="eyebrow">Transport & ownership</p><span className="terminal-code">{data.process.status.toUpperCase()}</span></header>
        <dl className="definition-grid"><dt>État source</dt><dd>{data.process.rawStatus}</dd><dt>Worker réclamant</dt><dd>{data.process.worker || "—"}</dd><dt>Révision</dt><dd>{data.process.revision}</dd><dt>Lease expire</dt><dd>{formatDateTime(data.transport.lease.expiresAt)}</dd><dt>Save tool</dt><dd>{data.transport.saveTool || "—"}</dd><dt>Lease token</dt><dd>{maskSecret(data.transport.leaseToken)}</dd><dt>Bundle</dt><dd>{data.process.bundle?.bundleId || "—"}</dd><dt>Qualité</dt><dd>{bundleQuality(data.process)}</dd><dt>Request ID</dt><dd>{data.process.telemetry.requestId || "N/D"}</dd><dt>Latence API</dt><dd>{formatDuration(data.process.telemetry.apiLatencyMs)}</dd></dl>
      </Card>
    </div>

    <div className="gpt-payload-grid">
      <details className="raw-inspector" open><summary>Manifest du bundle</summary><pre>{JSON.stringify(data.manifest, null, 2)}</pre></details>
      <details className="raw-inspector"><summary>Save target</summary><pre>{JSON.stringify(data.saveTarget, null, 2)}</pre></details>
      <details className="raw-inspector"><summary>Prompt d’exécution</summary><pre>{data.prompt || "Non exposé"}</pre></details>
    </div>

    <section className="replay-terminal-section">
      <header><div><p className="eyebrow">Audit du worker</p><h2>Cycle de vie GPT</h2></div><span>{data.process.events.length} événements persistés</span></header>
      <EventTimeline events={data.process.events} runId={parent}/>
    </section>
  </section>;
}

function GptContractPanel({ transport }: { transport: GptTransportContract }) {
  return <Card className="gpt-contract-panel" aria-label="Contrat M7 GPT">
    <header><div><p className="eyebrow">M7 · transport GPT</p><h2>Contrat M7 GPT</h2></div><LeaseBadge state={transport.lease.state}/></header>
    <div className="gpt-contract-grid">
      <span><small>Save tool</small><strong>{transport.saveTool || "—"}</strong></span>
      <span><small>Work item</small><strong>{transport.workItemId || "—"}</strong></span>
      <span><small>Worker payload</small><strong>{transport.workerId || "—"}</strong></span>
      <span><small>Lease token</small><strong>{maskSecret(transport.leaseToken)}</strong></span>
      <span><small>Handle</small><strong>{transport.hasLeaseHandle ? "complet" : "incomplet"}</strong></span>
      <span><small>Prompt</small><strong>{transport.promptAvailable ? "exposé" : "absent"}</strong></span>
      <span><small>Manifest</small><strong>{transport.manifestAvailable ? "présent" : "absent"}</strong></span>
      <span><small>Save target</small><strong>{transport.saveTargetAvailable ? "présent" : "absent"}</strong></span>
    </div>
  </Card>;
}

function LeaseBadge({ state }: { state: GptTransportContract["lease"]["state"] }) {
  return <span className="lease-badge" data-state={state}>{state === "active" ? "ACTIVE" : state === "expiring" ? "EXPIRING" : state === "expired" ? "EXPIRED" : "NO LEASE"}</span>;
}

function GptLifecycle({ process }: { process: GptProcess }) {
  const terminal = process.status === "completed";
  const failed = process.status === "failed";
  const claimed = Boolean(process.worker) || process.events.some(event => /CLAIM/i.test(event.type));
  const executed = terminal || failed || process.status === "running" || process.events.some(event => /RUN|EXECUT|SAV/i.test(event.type));
  const current = terminal ? 3 : executed ? 2 : claimed ? 1 : 0;
  const stages = [
    { key: "01", label: "Work item", detail: "Créé / prêt" },
    { key: "02", label: "Claim", detail: process.worker || "Worker attendu" },
    { key: "03", label: "Exécution", detail: process.rawStatus },
    { key: "04", label: "Sauvegarde", detail: process.decision || "Sortie attendue" },
  ];
  return <div className="gpt-lifecycle-rail" aria-label="Progression du processus GPT">{stages.map((stage, index) => {
    const state = failed && index === current ? "failed" : terminal || index < current ? "completed" : index === current ? "current" : "pending";
    return <div key={stage.key} data-state={state}><span>{stage.key}</span><i/><div><strong>{stage.label}</strong><small>{stage.detail}</small></div></div>;
  })}</div>;
}

function bundleQuality(process: GptProcess) {
  const quality = process.bundle?.dataQuality;
  if (quality && typeof quality === "object" && "status" in quality) return String((quality as { status?: unknown }).status || "—");
  return quality ? String(quality) : "—";
}

function tokenDetail(process: GptProcess) {
  const telemetry = process.telemetry;
  if (telemetry.inputTokens === null && telemetry.outputTokens === null) return "Télémétrie absente";
  return `${telemetry.inputTokens ?? "N/D"} in · ${telemetry.outputTokens ?? "N/D"} out`;
}

function maskSecret(value?: string | null) {
  if (!value) return "—";
  if (value.length <= 10) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
````

### `src/pages/HistoryPage.tsx`

````tsx
import { useDeferredValue, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { formatDateTime, MetricCard, MetricStrip, PageHeading, ProgressBar, StatusTag } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";
import type { HistorySessionSummary } from "@/operationsTypes";

export default function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const rawFilters = useMemo(() => ({
    q: params.get("q") || "",
    status: params.get("status") || "",
    session: params.get("session") || "",
    kind: params.get("kind") || "",
    strategyId: params.get("strategy") || "",
    from: params.get("from") || "",
    to: params.get("to") || "",
  }), [params]);
  const filters = useDeferredValue(rawFilters);
  const apiFilters = useMemo(() => ({
    q: filters.q || null, status: filters.status || null, session: filters.session || null,
    kind: filters.kind || null, strategy_id: filters.strategyId || null,
    from: filters.from || null, to: filters.to || null,
  }), [filters]);
  const query = useQuery({ queryKey: operationsKeys.history(apiFilters), queryFn: () => operationsApi.getHistory(apiFilters) });
  const setFilter = (key: string, value: string) => setParams(current => {
    const next = new URLSearchParams(current);
    value ? next.set(key, value) : next.delete(key);
    return next;
  }, { replace: true });
  const clearFilters = () => setParams({}, { replace: true });

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Historique indisponible"} retry={() => query.refetch()}/>;

  const data = query.data;
  const summary = data.summary;
  const hasFilters = Object.values(rawFilters).some(Boolean);
  return <section className="view workspace-view history-v3">
    <PageHeading eyebrow="Mémoire opérationnelle" title="Historique des sessions" subtitle="Sessions, workflows, incidents, GPT et performance consolidés depuis l’état persistant." actions={<><button className="secondary-btn" onClick={() => query.refetch()}>Actualiser</button><Link className="primary-btn" to="/operations">Cockpit live</Link></>}/>

    <MetricStrip className="metric-grid--compact history-kpi-strip">
      <MetricCard label="Sessions" value={summary.sessions} detail={`${summary.activeDays} journées`}/>
      <MetricCard label="Workflows" value={summary.workflows} detail={`${summary.completed} terminés`}/>
      <MetricCard label="Actifs" value={summary.running + summary.waitingGpt} detail={`${summary.waitingGpt} attente GPT`} tone={summary.running + summary.waitingGpt ? "info" : "neutral"}/>
      <MetricCard label="Bloqués / échecs" value={summary.blocked + summary.failed} detail={`${summary.failed} échecs`} tone={summary.blocked + summary.failed ? "critical" : "neutral"}/>
      <MetricCard label="Résultat cumulé" value={formatR(summary.totalR)} tone={summary.totalR >= 0 ? "positive" : "critical"}/>
      <MetricCard label="Incidents ouverts" value={summary.openIncidents} detail={`${summary.gptProcesses} processus GPT`} tone={summary.openIncidents ? "warning" : "neutral"}/>
    </MetricStrip>

    <Card className="history-filter-bar" aria-label="Filtres de l’historique">
      <label className="history-filter-search"><span>Recherche</span><div><Icon name="search" size={13}/><input aria-label="Rechercher dans l’historique" placeholder="Run, workflow, statut…" value={rawFilters.q} onChange={event => setFilter("q", event.target.value)}/></div></label>
      <FilterSelect label="État" value={rawFilters.status} values={data.facets.statuses} onChange={value => setFilter("status", value)}/>
      <FilterSelect label="Session" value={rawFilters.session} values={data.facets.sessions} onChange={value => setFilter("session", value)} format={shortLabel}/>
      <FilterSelect label="Type" value={rawFilters.kind} values={data.facets.kinds} onChange={value => setFilter("kind", value)}/>
      <FilterSelect label="Stratégie" value={rawFilters.strategyId} values={data.facets.strategies} onChange={value => setFilter("strategy", value)}/>
      <label><span>Du</span><input aria-label="Historique depuis" type="date" value={rawFilters.from} min={data.facets.dateRange.from || undefined} max={data.facets.dateRange.to || undefined} onChange={event => setFilter("from", event.target.value)}/></label>
      <label><span>Au</span><input aria-label="Historique jusqu’au" type="date" value={rawFilters.to} min={data.facets.dateRange.from || undefined} max={data.facets.dateRange.to || undefined} onChange={event => setFilter("to", event.target.value)}/></label>
      <div className="history-filter-bar__result"><strong>{data.sessions.length}</strong><span>sessions</span>{hasFilters && <button className="text-btn" onClick={clearFilters}>Réinitialiser</button>}</div>
    </Card>

    {!data.sessions.length ? <Card className="workspace-empty history-empty-state"><span className="terminal-code">{hasFilters ? "NO_MATCHING_HISTORY" : "NO_HISTORY_MATERIALIZED"}</span><h3>{hasFilters ? "Aucune session ne correspond aux filtres" : "Aucune session historique"}</h3><p>Cette vue est construite uniquement à partir des workflows persistés. Aucun historique n’est fabriqué côté frontend.</p>{hasFilters && <button className="secondary-btn" onClick={clearFilters}>Effacer les filtres</button>}</Card> :
      <section className="replay-terminal-section history-session-ledger">
        <header><div><p className="eyebrow">Registre consolidé</p><h2>Sessions matérialisées</h2></div><span>{data.sessions.length} lignes · source PostgreSQL</span></header>
        <div className="data-table-wrap"><table className="data-table history-session-table">
          <thead><tr><th>Date / session</th><th>État</th><th>Workflows</th><th>Composition</th><th>Progression</th><th>Résultat</th><th>Flux</th><th>Dernière activité</th><th/></tr></thead>
          <tbody>{data.sessions.map(session => <HistoryRow key={session.id} session={session}/>)}</tbody>
        </table></div>
      </section>}
  </section>;
}

function HistoryRow({ session }: { session: HistorySessionSummary }) {
  return <tr>
    <td data-label="Date / session"><strong>{session.tradingDate || "Date inconnue"}</strong><small>{shortLabel(session.session || "global")} · {session.id}</small></td>
    <td data-label="État"><StatusTag status={session.status}/></td>
    <td data-label="Workflows"><strong>{session.workflowCount}</strong><small>{session.strategies.length} stratégies</small></td>
    <td data-label="Composition"><div className="history-kind-stack">{session.kinds.map(kind => <span key={kind}>{kind}</span>)}</div></td>
    <td data-label="Progression"><ProgressBar value={session.progress} status={session.status}/></td>
    <td data-label="Résultat" className={session.totalR >= 0 ? "positive" : "negative"}><strong>{formatR(session.totalR)}</strong></td>
    <td data-label="Flux"><strong>{session.gptProcesses} GPT</strong><small>{session.incidentCount} incidents</small></td>
    <td data-label="Dernière activité"><time>{formatDateTime(session.updatedAt)}</time></td>
    <td data-label="Action"><Link className="row-link" to={`/history/sessions/${encodeURIComponent(session.id)}`}>Explorer <Icon name="arrow" size={13}/></Link></td>
  </tr>;
}

function FilterSelect({ label, value, values, onChange, format = value => value }: { label: string; value: string; values: string[]; onChange: (value: string) => void; format?: (value: string) => string }) {
  return <label><span>{label}</span><select aria-label={`Filtrer l’historique par ${label.toLowerCase()}`} value={value} onChange={event => onChange(event.target.value)}><option value="">Tous</option>{values.map(item => <option key={item} value={item}>{format(item)}</option>)}</select></label>;
}

function shortLabel(value: string) { return value.replaceAll("_", " ").toUpperCase(); }
function formatR(value: number) { return `${value > 0 ? "+" : ""}${Number(value || 0).toFixed(2)} R`; }
````

### `src/pages/HistorySessionPage.tsx`

````tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { Breadcrumbs, EventTimeline, formatDateTime, formatDuration, MetricCard, MetricStrip, PageHeading, StatusTag, WorkflowTable } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";
import type { OperationsEvent } from "@/operationsTypes";

export default function HistorySessionPage() {
  const { sessionId = "" } = useParams();
  const id = decodeURIComponent(sessionId);
  const query = useQuery({ queryKey: operationsKeys.historySession(id), queryFn: () => operationsApi.getHistorySession(id), enabled: Boolean(id) });
  const [selected, setSelected] = useState<OperationsEvent | null>(null);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Session historique introuvable"} retry={() => query.refetch()}/>;

  const data = query.data;
  const session = data.session;
  const totals = data.summary;
  const activeEvent = selected || data.timeline.at(-1) || null;
  return <section className="view workspace-view history-session-v3">
    <Breadcrumbs items={[{ label: "Historique", to: "/history" }, { label: session.tradingDate || id }, { label: sessionLabel(session.session) }]}/>
    <PageHeading eyebrow="Session historique workstation" title={`${session.tradingDate || "Date inconnue"} · ${sessionLabel(session.session)}`} subtitle={`${id} · lecture consolidée persistante`} backTo="/history" actions={<><StatusTag status={session.status}/><Link className="secondary-btn" to={`/operations?session=${encodeURIComponent(session.session || "")}`}>Voir le cockpit</Link></>}/>

    <MetricStrip className="metric-grid--compact history-kpi-strip">
      <MetricCard label="Workflows" value={totals.workflows} detail={`${totals.completed} terminés`}/>
      <MetricCard label="Progression" value={`${totals.progress}%`} detail={`${totals.running} actifs`}/>
      <MetricCard label="Résultat" value={formatR(totals.totalR)} tone={totals.totalR >= 0 ? "positive" : "critical"}/>
      <MetricCard label="Processus GPT" value={totals.gptProcesses} detail={`${totals.waitingGpt} en attente`}/>
      <MetricCard label="Incidents" value={totals.incidents} detail={`${totals.failed} échecs · ${totals.blocked} bloqués`} tone={totals.incidents || totals.failed ? "warning" : "neutral"}/>
      <MetricCard label="Événements" value={totals.events} detail={formatDuration(session.durationMs)}/>
    </MetricStrip>

    <div className="replay-session-context-strip">
      <span>SESSION ID <strong>{id}</strong></span><span>STRATÉGIES <strong>{session.strategies.join(", ") || "—"}</strong></span><span>TYPES <strong>{session.kinds.join(", ") || "—"}</strong></span><span>PREMIER ÉVÉNEMENT <strong>{formatDateTime(session.startedAt)}</strong></span><span>SOURCE <strong>POSTGRES</strong></span>
    </div>

    <div className="history-session-workbench">
      <section className="replay-terminal-section history-session-workflows">
        <header><div><p className="eyebrow">Exécutions persistées</p><h2>Workflows de la session</h2></div><span>{data.workflows.length} workflows</span></header>
        <WorkflowTable items={data.workflows}/>
      </section>
      <aside className="history-session-rail">
        <Card className="history-event-inspector">
          <header><div><p className="eyebrow">Dernier événement</p><h2>{activeEvent?.title || "Aucune activité"}</h2></div>{activeEvent && <StatusTag status={activeEvent.status}/>}</header>
          {activeEvent ? <><div className="replay-event-inspector__meta"><span>HEURE <strong>{formatDateTime(activeEvent.at)}</strong></span><span>WORKFLOW <strong>{activeEvent.workflowName || "—"}</strong></span><span>COUCHE <strong>{activeEvent.layer || activeEvent.type}</strong></span></div><p>{activeEvent.conclusion || activeEvent.detail || activeEvent.decision || "Transition persistée."}</p></> : <TerminalEmpty code="NO_EVENT" text="Aucun événement lié à ces workflows."/>}
        </Card>

        <Card className="history-performance-rail">
          <header><div><p className="eyebrow">Performance du scope</p><h2>{formatR(data.performance.totals.totalR)}</h2></div><span className="terminal-counter">{data.performance.totals.trades} trades</span></header>
          <div className="history-rail-stats"><span>Win rate <strong>{data.performance.totals.winRate === null ? "—" : `${(data.performance.totals.winRate * 100).toFixed(1)}%`}</strong></span><span>Expectancy <strong>{data.performance.totals.expectancyR === null ? "—" : formatR(data.performance.totals.expectancyR)}</strong></span><span>Max DD <strong>{formatR(data.performance.totals.maxDrawdownR)}</strong></span></div>
        </Card>

        <Card className="replay-gpt-rail">
          <header><div><p className="eyebrow">Orchestration IA</p><h2>Processus GPT</h2></div><span className="terminal-counter">{data.gptProcesses.length}</span></header>
          {!data.gptProcesses.length ? <TerminalEmpty code="NO_GPT_PROCESS" text="Aucun processus GPT lié."/> : <div className="replay-gpt-process-list">{data.gptProcesses.map(process => <Link key={process.id} to={process.runId ? `/replay/runs/${encodeURIComponent(process.runId)}/gpt/${encodeURIComponent(process.id)}` : "/operations"}>
            <span className="replay-gpt-process-list__index">{String(process.attempt).padStart(2, "0")}</span><div><strong>{process.workflow}</strong><small>{process.conclusion || process.decision || process.rawStatus}</small></div><StatusTag status={process.status}/>
          </Link>)}</div>}
        </Card>

        <Card className="history-incident-rail">
          <header><div><p className="eyebrow">Surveillance</p><h2>Incidents liés</h2></div><Link className="row-link" to="/operations/incidents">Tous <Icon name="arrow" size={12}/></Link></header>
          {!data.incidents.length ? <TerminalEmpty code="NO_INCIDENT" text="Aucun incident sur ce scope."/> : <div className="history-incident-list">{data.incidents.map(incident => <div key={incident.id}><i data-severity={incident.severity}/><span><strong>{incident.title}</strong><small>{incident.message || incident.kind}</small></span><StatusTag status={incident.lifecycleStatus}/></div>)}</div>}
        </Card>
      </aside>
    </div>

    <section id="timeline-events" className="replay-terminal-section history-timeline">
      <header><div><p className="eyebrow">Journal consolidé</p><h2>Timeline de la session</h2></div><span>{data.timeline.length} transitions · tous workflows</span></header>
      <EventTimeline events={data.timeline} selectedId={activeEvent?.id} onSelect={setSelected}/>
    </section>
  </section>;
}

function TerminalEmpty({ code, text }: { code: string; text: string }) {
  return <div className="terminal-empty-state"><span>{code}</span><small>{text}</small></div>;
}
function sessionLabel(value?: string | null) { return value === "asia_open" ? "Asia Open" : value === "ny_open" ? "NY Open" : value?.replaceAll("_", " ") || "Global"; }
function formatR(value: number) { return `${value > 0 ? "+" : ""}${Number(value || 0).toFixed(2)} R`; }
````

### `src/pages/IncidentsPage.tsx`

````tsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, Icon, LoadingView, Modal } from "@/components/common";
import { ConfirmActionForm } from "@/components/ConfirmActionForm";
import { Breadcrumbs, formatDateTime, PageHeading, PageTabs, StatusTag } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";
import type { Incident, OperationsCommandInput } from "@/operationsTypes";

type IncidentAction = Extract<OperationsCommandInput["action"], "acknowledge" | "assign" | "snooze" | "resolve" | "reopen">;

const actionLabels: Record<IncidentAction, string> = {
  acknowledge: "Acquitter",
  assign: "Assigner",
  snooze: "Reporter",
  resolve: "Résoudre",
  reopen: "Réouvrir",
};

export default function IncidentsPage() {
  const query = useQuery({ queryKey: operationsKeys.incidents, queryFn: operationsApi.listIncidents, refetchInterval: 10_000 });
  const client = useQueryClient();
  const [status, setStatus] = useState("active");
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [commandTarget, setCommandTarget] = useState<Incident | null>(null);
  const [action, setAction] = useState<IncidentAction>("acknowledge");
  const [owner, setOwner] = useState("");
  const [snoozeMinutes, setSnoozeMinutes] = useState(60);

  const command = useMutation({
    mutationFn: (input: OperationsCommandInput) => operationsApi.executeIncidentAction(commandTarget!.id, input),
    onSuccess: async () => {
      setCommandTarget(null);
      await client.invalidateQueries({ queryKey: operationsKeys.all });
    },
  });
  const sync = useMutation({
    mutationFn: () => operationsApi.evaluateObservabilityIncidents({ autoResolve: true, reason: "Synchronisation manuelle Command Center incidents" }),
    onSuccess: async () => client.invalidateQueries({ queryKey: operationsKeys.all }),
  });

  const items = query.data?.items || [];
  const filtered = useMemo(() => {
    const search = q.trim().toLowerCase();
    return items.filter((incident) => {
      if (kind !== "all" && incident.kind !== kind) return false;
      if (status === "active" && ["resolved", "archived"].includes(incident.lifecycleStatus)) return false;
      if (status !== "active" && status !== "all" && incident.lifecycleStatus !== status) return false;
      if (!search) return true;
      return [incident.id, incident.title, incident.message, incident.kind, incident.guardrailType, incident.runId, incident.processId, incident.workflow, incident.owner]
        .filter(Boolean).join(" ").toLowerCase().includes(search);
    });
  }, [items, kind, q, status]);

  const selected = filtered.find((incident) => incident.id === selectedId) || filtered[0] || null;
  const summary = query.data?.summary || summarize(items);
  const expected = `CONFIRM_${action.toUpperCase()}`;

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Incidents indisponibles"} retry={() => query.refetch()}/>;

  const openCommand = (incident: Incident, nextAction: IncidentAction) => {
    setCommandTarget(incident);
    setAction(nextAction);
    setOwner(incident.owner || "");
    setSnoozeMinutes(60);
  };

  return <section className="view workspace-view incident-command-view">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Incidents" }]}/>
    <PageHeading
      eyebrow="Incident Command"
      title="Centre incidents"
      subtitle="Alertes, erreurs et guardrails matérialisés avec evidence, ownership et timeline."
      backTo="/operations"
      actions={<button className="secondary-btn" onClick={() => sync.mutate()} disabled={sync.isPending}><Icon name="refresh" size={14}/>{sync.isPending ? "Sync…" : "Évaluer guardrails"}</button>}
      tabs={<PageTabs items={[{ label: "Cockpit", to: "/operations", end: true }, { label: "Observabilité", to: "/operations/observability" }, { label: "Incidents", to: "/operations/incidents" }, { label: "Notifications", to: "/operations/notifications" }, { label: "Runbooks", to: "/operations/runbooks" }]}/>}
    />

    <div className="metric-grid metric-grid--compact incident-command-kpis">
      <Card className="metric-card" data-tone={summary.critical ? "negative" : "positive"}><span>Critiques ouvertes</span><strong>{summary.critical}</strong><small>{summary.open} actifs</small></Card>
      <Card className="metric-card"><span>Guardrails</span><strong>{summary.guardrails}</strong><small>{sync.data ? `${sync.data.active} signaux actifs` : "SLA, leases, budgets"}</small></Card>
      <Card className="metric-card"><span>Acquittés</span><strong>{summary.acknowledged}</strong><small>Owner confirmé</small></Card>
      <Card className="metric-card"><span>Reportés</span><strong>{summary.snoozed}</strong><small>Réveil automatique</small></Card>
      <Card className="metric-card"><span>Résolus</span><strong>{summary.resolved}</strong><small>Historique conservé</small></Card>
    </div>

    <div className="incident-command-layout">
      <Card className="incident-ledger-panel">
        <header className="incident-command-toolbar">
          <div>
            <p className="eyebrow">Ledger</p>
            <h2>{filtered.length} incidents</h2>
          </div>
          <div>
            <label>Statut<select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrer par statut"><option value="active">Actifs</option><option value="open">Ouverts</option><option value="acknowledged">Acquittés</option><option value="snoozed">Reportés</option><option value="resolved">Résolus</option><option value="all">Tous</option></select></label>
            <label>Source<select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Filtrer par source"><option value="all">Toutes</option><option value="guardrail">Guardrails</option><option value="alert">Alertes</option><option value="error">Erreurs</option><option value="data_quality">Data quality</option></select></label>
            <label>Recherche<input value={q} onChange={(event) => setQ(event.target.value)} placeholder="run, worker, titre…" aria-label="Rechercher un incident"/></label>
          </div>
        </header>
        {!filtered.length ? <div className="workspace-empty incident-empty"><Icon name="check"/><h3>Aucun incident dans ce filtre</h3><p>Les guardrails peuvent être matérialisés via l’évaluation manuelle ou le scheduler local.</p></div> : <div className="data-table-wrap incident-ledger-wrap">
          <table className="data-table incident-ledger-table">
            <thead><tr><th>Incident</th><th>Signal</th><th>Owner</th><th>Âge</th><th>État</th></tr></thead>
            <tbody>{filtered.map((incident) => <tr key={incident.id} className={selected?.id === incident.id ? "is-selected" : ""} data-severity={incident.severity} onClick={() => setSelectedId(incident.id)}>
              <td data-label="Incident"><strong><i data-severity={incident.severity}/>{incident.title}</strong><small>{kindLabel(incident.kind)} · {incident.runId || incident.targetId || incident.sourceId}</small></td>
              <td data-label="Signal"><span className="terminal-code">{incident.guardrailType || incident.kind}</span><small>{formatValue(incident.observedValue, incident.unit)} / {formatValue(incident.thresholdValue, incident.unit)}</small></td>
              <td data-label="Owner">{incident.owner || "Non assigné"}<small>{incident.workflow || incident.worker || "desk"}</small></td>
              <td data-label="Âge">{formatAge(incident.firstObservedAt || incident.createdAt)}<small>{formatDateTime(incident.updatedAt)}</small></td>
              <td data-label="État"><StatusTag status={incident.lifecycleStatus}/></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </Card>

      <Card className="incident-detail-panel">
        {!selected ? <div className="workspace-empty incident-empty"><Icon name="database"/><h3>Aucun détail</h3><p>Sélectionne un incident dans le ledger.</p></div> : <IncidentDetail incident={selected} onCommand={openCommand}/>}
      </Card>
    </div>

    <Modal open={Boolean(commandTarget)} title={commandTarget ? `${actionLabels[action]} · ${commandTarget.title}` : "Traiter l’incident"} onClose={() => !command.isPending && setCommandTarget(null)}>
      {commandTarget && <>
        <label className="confirm-action__action">Action
          <select value={action} onChange={(event) => setAction(event.target.value as IncidentAction)}>
            <option value="acknowledge">Acquitter</option><option value="assign">Assigner</option><option value="snooze">Reporter</option><option value="resolve">Résoudre</option><option value="reopen">Réouvrir</option>
          </select>
        </label>
        <ConfirmActionForm
          key={`${commandTarget.id}:${action}`}
          target={commandTarget.title}
          revision={commandTarget.revision}
          expectedPhrase={expected}
          onCancel={() => setCommandTarget(null)}
          danger={action === "resolve" || action === "reopen"}
          confirmLabel={actionLabels[action]}
          validateExtra={() => !["acknowledge", "assign"].includes(action) || owner.trim().length >= 2}
          onConfirm={({ confirmationPhrase, reason }) => {
            const snoozedUntilUtc = action === "snooze" ? new Date(Date.now() + Math.max(5, snoozeMinutes) * 60_000).toISOString() : undefined;
            return command.mutateAsync({
              action,
              reason,
              confirmationPhrase,
              idempotencyKey: crypto.randomUUID(),
              expectedRevision: commandTarget.revision,
              owner: ["acknowledge", "assign"].includes(action) ? owner.trim() : undefined,
              snoozedUntilUtc,
            }).then(() => undefined);
          }}
        >
          {["acknowledge", "assign"].includes(action) && <label>Responsable<input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="desk-operator, email, équipe…" required/></label>}
          {action === "snooze" && <label>Durée du report<input type="number" min={5} max={1440} value={snoozeMinutes} onChange={(event) => setSnoozeMinutes(Number(event.target.value) || 60)}/><small>{snoozeMinutes} minutes</small></label>}
        </ConfirmActionForm>
      </>}
    </Modal>
  </section>;
}

function IncidentDetail({ incident, onCommand }: { incident: Incident; onCommand: (incident: Incident, action: IncidentAction) => void }) {
  const active = !["resolved", "archived"].includes(incident.lifecycleStatus);
  const timeline = incident.timeline || [];
  return <>
    <header className="incident-detail-head">
      <div>
        <p className="eyebrow">{kindLabel(incident.kind)} · rev {incident.revision}</p>
        <h2>{incident.title}</h2>
        <p>{incident.message || "Aucun message détaillé."}</p>
      </div>
      <StatusTag status={incident.lifecycleStatus}/>
    </header>
    <div className="incident-action-strip">
      {active && <button className="secondary-btn" onClick={() => onCommand(incident, "acknowledge")}>Acquitter</button>}
      {active && <button className="secondary-btn" onClick={() => onCommand(incident, "assign")}>Assigner</button>}
      {active && <button className="secondary-btn" onClick={() => onCommand(incident, "snooze")}>Reporter</button>}
      {active ? <button className="danger-btn" onClick={() => onCommand(incident, "resolve")}>Résoudre</button> : <button className="secondary-btn" onClick={() => onCommand(incident, "reopen")}>Réouvrir</button>}
    </div>
    <dl className="incident-evidence-grid">
      <div><dt>Mesure</dt><dd>{formatValue(incident.observedValue, incident.unit)}</dd></div>
      <div><dt>Seuil</dt><dd>{formatValue(incident.thresholdValue, incident.unit)}</dd></div>
      <div><dt>Policy</dt><dd>{incident.policyRevision ?? "N/D"}</dd></div>
      <div><dt>Owner</dt><dd>{incident.owner || "Non assigné"}</dd></div>
      <div><dt>Run</dt><dd>{incident.runId ? <Link to={`/replay/runs/${encodeURIComponent(incident.runId)}`}>{incident.runId}</Link> : "N/D"}</dd></div>
      <div><dt>Process</dt><dd>{incident.processId && incident.runId ? <Link to={`/replay/runs/${encodeURIComponent(incident.runId)}/gpt/${encodeURIComponent(incident.processId)}`}>{incident.processId}</Link> : incident.processId || "N/D"}</dd></div>
      <div><dt>Workflow</dt><dd>{incident.workflow || "N/D"}</dd></div>
      <div><dt>Worker</dt><dd>{incident.worker || "N/D"}</dd></div>
    </dl>
    <section className="incident-policy-evidence">
      <header><p className="eyebrow">Evidence policy</p><span>{incident.fingerprint?.slice(0, 12) || "no-fingerprint"}</span></header>
      <pre>{JSON.stringify(incident.policySnapshot || incident.evidence || {}, null, 2)}</pre>
    </section>
    <section className="incident-timeline-panel">
      <header><p className="eyebrow">Timeline</p><span>{timeline.length} événements</span></header>
      {!timeline.length ? <p className="empty-copy">Aucun événement matérialisé.</p> : <ol className="incident-timeline">
        {timeline.map((event) => <li key={event.id}>
          <time>{formatDateTime(event.at)}</time>
          <i data-severity={event.severity}/>
          <div><strong>{event.type}</strong><p>{event.message || event.title}</p></div>
        </li>)}
      </ol>}
    </section>
  </>;
}

function summarize(items: Incident[]) {
  const open = items.filter((item) => !["resolved", "archived"].includes(item.lifecycleStatus));
  return {
    open: open.length,
    critical: open.filter((item) => item.severity === "critical").length,
    warning: open.filter((item) => item.severity === "warning").length,
    acknowledged: items.filter((item) => item.lifecycleStatus === "acknowledged").length,
    snoozed: items.filter((item) => item.lifecycleStatus === "snoozed").length,
    resolved: items.filter((item) => item.lifecycleStatus === "resolved").length,
    guardrails: items.filter((item) => item.kind === "guardrail").length,
  };
}

function kindLabel(kind: string) {
  if (kind === "guardrail") return "Guardrail";
  if (kind === "data_quality") return "Data quality";
  if (kind === "error") return "Erreur";
  return "Alerte";
}

function formatAge(value?: string | null) {
  const at = Date.parse(value || "");
  if (!Number.isFinite(at)) return "N/D";
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}j`;
}

function formatValue(value?: number | null, unit?: string | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "N/D";
  if (unit === "ms") {
    const seconds = Math.round(Number(value) / 1000);
    return Math.abs(seconds) >= 60 ? `${Math.round(seconds / 60)}m` : `${seconds}s`;
  }
  if (unit === "usd") return `$${Number(value).toFixed(4)}`;
  if (unit === "percent") return `${Number(value).toFixed(0)}%`;
  return `${Number(value).toLocaleString("fr-FR")} ${unit || ""}`.trim();
}
````

### `src/pages/LiveDeskPage.tsx`

````tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/common";
import { MetricCard, MetricStrip, PageHeading } from "@/components/operations";
import {
  ActivityCard, AuditMini, BriefCard, DecisionCard, DeltaCard, LiveSectionHeading, MacroNewsCard,
  MarketTable, PositionCard, SetupCard, StatusRibbon, ThesisSummary, Timeline
} from "@/components/deskCards";
import { useOverlay } from "@/context/OverlayContext";
import { useDeskContext } from "@/context/DeskContext";
import { DeskPage } from "@/pages/pageState";

const liveSections = [
  { id: "live-decision", key: "F1", label: "Décision" },
  { id: "live-market", key: "F2", label: "Marché" },
  { id: "live-thesis", key: "F3", label: "Lecture" },
  { id: "live-execution", key: "F4", label: "Exécution" },
  { id: "live-risk", key: "F5", label: "Risque" },
  { id: "live-activity", key: "F6", label: "Activité" },
] as const;

export default function LiveDeskPage() {
  const navigate = useNavigate();
  const overlay = useOverlay();
  const { phaseLabel } = useDeskContext();
  const [activeSection, setActiveSection] = useState<(typeof liveSections)[number]["id"]>("live-decision");
  const jumpTo = (id: (typeof liveSections)[number]["id"]) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return <DeskPage>{data => <section className="view live-desk-v2">
    <PageHeading eyebrow={`Session automatique · ${phaseLabel}`} title="Live Desk" subtitle={`${data.label} · ${data.date} · ${data.strategyId}`} actions={<><button className="text-btn" onClick={() => navigate("/timeline")}>Ouvrir le journal</button><button className="secondary-btn" onClick={() => navigate("/setup")}>Setup & Position</button></>}/>
    <nav className="desk-function-bar" aria-label="Sections du Live Desk">
      {liveSections.map(item => <button key={item.id} className={activeSection === item.id ? "active" : ""} aria-pressed={activeSection === item.id} onClick={() => jumpTo(item.id)}><kbd>{item.key}</kbd><span>{item.label}</span></button>)}
    </nav>
    <div id="live-decision" className="live-module live-module--decision">
      <StatusRibbon data={data}/>
      <div className="live-decision-grid"><DecisionCard data={data}/><ThesisSummary data={data}/></div>
      <MetricStrip className="live-metric-strip metric-strip--six">
        <MetricCard label="Confiance" value={`${data.thesis.confidence}%`}/><MetricCard label="Santé" value={`${data.thesis.health}/100`}/><MetricCard label="Risque setup" value={data.setup.risk == null ? "—" : `${fmtLive(data.setup.risk)}%`}/><MetricCard label="R non réalisé" value={data.position.unrealizedR == null ? "—" : `${data.position.unrealizedR.toFixed(2)} R`} tone={data.position.unrealizedR == null ? "neutral" : data.position.unrealizedR >= 0 ? "positive" : "negative"}/><MetricCard label="Prochain monitor" value={data.nextMonitorAt}/><MetricCard label="Prochain macro" value={data.macro[0] ? `${data.macro[0].time} · ${data.macro[0].title}` : "Aucun"}/>
      </MetricStrip>
    </div>
    <div id="live-market" className="live-module"><LiveSectionHeading title="Prix & évolution" subtitle="MNQ, MES, MCL et mega caps · OHLC quotidien, RSI et ATR"/><MarketTable data={data}/></div>
    <div id="live-thesis" className="live-module">
      <LiveSectionHeading title="Lecture du Desk" subtitle="Faits, interprétation et évolution de la thèse"/>
      <div className="content-grid">
        <BriefCard eyebrow="Marché" headline={data.marketBrief.headline} text={data.marketBrief.text} verdict={data.marketBrief.verdict} icon="chart"/>
        <BriefCard eyebrow="Cross-asset" headline={data.crossAssetBrief.headline} text={data.crossAssetBrief.text} verdict={data.crossAssetBrief.verdict} icon="globe"/>
      </div>
      <DeltaCard data={data}/>
    </div>
    <div id="live-execution" className="live-module"><LiveSectionHeading title="Plan & exécution" subtitle="Setup théorique et position canonique restent distincts"/><div className="content-grid"><SetupCard data={data}/><PositionCard data={data}/></div></div>
    <div id="live-risk" className="live-module"><LiveSectionHeading title="Risque temporel & qualité"/><div className="content-grid live-risk-grid"><MacroNewsCard data={data}/><AuditMini data={data}/></div></div>
    <div id="live-activity" className="live-module">
      <LiveSectionHeading title="Activité & journal" subtitle="Traçabilité des décisions et des workers" action={
        <button className="text-btn" onClick={() => navigate("/timeline")}>Tout voir <Icon name="arrow" size={15}/></button>
      }/>
      <div className="content-grid">
        <ActivityCard data={data}/>
        <article className="card timeline-card">
          <Timeline data={data} compact onSelect={event => overlay.openModal(event.title, <div>
            <section className="drawer-section"><p>{event.summary}</p><div className="detail-pairs"><div><span>Heure</span><strong>{event.time}</strong></div><div><span>Type</span><strong>{event.type}</strong></div><div><span>Statut</span><strong>{event.status}</strong></div></div></section>
            <section className="drawer-section"><h3>Détail</h3><p>{event.detail}</p></section>
          </div>)}/>
        </article>
      </div>
    </div>
  </section>}</DeskPage>;
}

function fmtLive(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
}
````

### `src/pages/MasterPage.tsx`

````tsx
import { Card, Icon, StatusBadge } from "@/components/common";
import { PageHeading } from "@/components/operations";
import { deskDetailScope, useMasterDetail } from "@/hooks/useDesk";
import { DeskPage } from "@/pages/pageState";
import type { DeskSession } from "@/types";

function StepList({ title, items, tone }: { title: string; items: string[]; tone: "critical" | "warning" | "info" }) {
  return <Card className="step-card"><div className="brief-card__header"><h3>{title}</h3><StatusBadge tone={tone}>{items.length}</StatusBadge></div>
    <ol className="step-list">{items.map((item, index) => <li key={index}><span>{index + 1}</span><p>{item}</p></li>)}</ol>
  </Card>;
}

export default function MasterPage() {
  return <DeskPage>{data => <MasterWorkspace initialData={data}/>}</DeskPage>;
}

function MasterWorkspace({ initialData }: { initialData: DeskSession }) {
  const query = useMasterDetail(initialData.master.id, deskDetailScope(initialData));
  const data = { ...initialData, master: query.data?.master || initialData.master };
  return <section className="view master-document-page">
    <PageHeading eyebrow="Plan figé de session" title="Master Analysis" subtitle={`Créé au cutoff · ${data.master.createdAt}`}/>
    <div className="master-document-grid">
      <article className="master-document-content">
        <Card className="master-hero-react">
          <div className="master-hero-react__top"><div><p className="eyebrow">Décision initiale</p><h1>{data.master.decision}</h1><p>{data.master.summary}</p></div><StatusBadge tone="warning">Confiance {data.master.confidence}%</StatusBadge></div>
          <div className="detail-pairs detail-pairs--four"><div><span>Instrument</span><strong>{data.master.instrument}</strong></div><div><span>Direction</span><strong>{data.master.direction}</strong></div><div><span>Régime</span><strong>{data.master.regime}</strong></div><div><span>ID</span><strong className="truncate">{data.master.id}</strong></div></div>
        </Card>
        <section id="contexte" className="master-prose-section"><h2>Contexte & sélection</h2><div className="content-grid"><Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Thèse macro</p><h3>Contexte fondamental</h3></div><span className="card-icon"><Icon name="globe"/></span></div><p>{data.master.macroThesis}</p></Card><Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Sélection d’actif</p><h3>Pourquoi {data.master.instrument}</h3></div><span className="card-icon"><Icon name="target"/></span></div><p>{data.master.assetSelection}</p></Card></div></section>
        {data.master.sections.map((section, index) => <section className="master-prose-section" id={`section-${index + 1}`} key={section.title}><p className="eyebrow">Chapitre {String(index + 1).padStart(2, "0")}</p><h2>{section.title}</h2><p>{section.content}</p></section>)}
      </article>
      <aside className="master-document-rail">
        <Card className="master-toc"><p className="eyebrow">Sommaire</p><nav aria-label="Sommaire du Master"><a href="#contexte">Contexte & sélection</a>{data.master.sections.map((section, index) => <a href={`#section-${index + 1}`} key={section.title}>{section.title}</a>)}</nav></Card>
        <Card className="workspace-panel"><h2>Niveaux saillants</h2><div className="master-levels">{data.levels.map(level => <div key={`${level.price}:${level.role}`}><strong>{level.price}</strong><span>{level.role}</span><small>{level.state}</small></div>)}</div></Card>
        <StepList title="Chemin attendu" items={data.master.expectedPath} tone="info"/>
        <StepList title="Chemin d’échec" items={data.master.failurePath} tone="critical"/>
        <StepList title="Playbook de monitoring" items={data.master.monitoringPlaybook} tone="info"/>
      </aside>
    </div>
  </section>;
}
````

### `src/pages/MonitorsPage.tsx`

````tsx
import { useState } from "react";
import { Card, SectionTitle, StatusBadge } from "@/components/common";
import { MetricCard, MetricStrip, PageHeading } from "@/components/operations";
import { Conditions, ExpectedRealized } from "@/components/deskCards";
import { deskDetailScope, useMonitorDetail } from "@/hooks/useDesk";
import { DeskPage } from "@/pages/pageState";
import type { MonitorItem } from "@/types";

function MonitorDetail({ monitor }: { monitor: MonitorItem }) {
  return <>
    <Card className="monitor-hero-react">
      <div><p className="eyebrow">Monitor #{monitor.sequence} · {monitor.time}</p><h1>{monitor.decision}</h1><p>{monitor.summary}</p></div>
      <MetricStrip className="monitor-health-strip">
        <MetricCard label="Santé avant" value={monitor.healthBefore}/>
        <MetricCard label="Santé après" value={monitor.healthAfter} tone={monitor.healthAfter < 40 ? "negative" : monitor.healthAfter < 70 ? "warning" : "neutral"}/>
      </MetricStrip>
    </Card>
    <Card className="brief-card">
      <div className="brief-card__header"><h3>Pourquoi cette décision ?</h3><StatusBadge tone={monitor.severity === "critical" ? "critical" : "warning"}>{monitor.statusAfter}</StatusBadge></div>
      <p>{monitor.detailedReason}</p>
      <div className="monitor-actions-react"><div><span>Action</span><strong>{monitor.nextAction}</strong></div><div><span>Prochain focus</span><strong>{monitor.nextFocus}</strong></div></div>
    </Card>
    <SectionTitle title="Attendu vs réalisé"/>
    <ExpectedRealized monitor={monitor}/>
    <div className="content-grid">
      <Conditions title="Conditions WAIT → GO" items={monitor.goConditions}/>
      <Conditions title="Invalidations" items={monitor.invalidationConditions}/>
    </div>
    <Card className="weak-signals-react"><h3>Signaux faibles</h3><div className="tag-list">{monitor.weakSignals.map(item => <span key={item}>{item}</span>)}</div></Card>
  </>;
}

export default function MonitorsPage() {
  return <DeskPage>{data => <MonitorWorkspace data={data}/>}</DeskPage>;
}

function MonitorWorkspace({ data }: { data: import("@/types").DeskSession }) {
  const [selectedId, setSelectedId] = useState(data.monitors.at(-1)?.id ?? "");
  const selectedBase = data.monitors.find(m => m.id === selectedId) ?? data.monitors[0];
  const query = useMonitorDetail(selectedBase?.id || "", deskDetailScope(data));
  const selected = query.data?.monitor || selectedBase;
  return <section className="view">
      <PageHeading eyebrow="Temps réel" title="Monitors" subtitle="Contrôle dynamique de la thèse active"/>
      {data.monitors.length > 1 && <div className="monitor-selector-react" aria-label="Choisir un monitor">
        {data.monitors.map(m => <button key={m.id} className={selected?.id === m.id ? "active" : ""} onClick={() => setSelectedId(m.id)}>
          <span>{m.time}</span><strong>{m.decision}</strong><small>{m.statusBefore} → {m.statusAfter}</small>
        </button>)}
      </div>}
      {selected ? <MonitorDetail monitor={selected}/> : <Card><p>Aucun monitor disponible.</p></Card>}
    </section>;
}
````

### `src/pages/MorePage.tsx`

````tsx
import { Link } from "react-router-dom";
import { Icon } from "@/components/common";
import { navigationGroups } from "@/components/layout";
import { useDeskContext } from "@/context/DeskContext";
import { PageHeading } from "@/components/operations";

export default function MorePage() {
  const { phaseLabel, nextPhaseAt } = useDeskContext();
  return <section className="view workspace-view more-page-v2">
    <PageHeading eyebrow="Navigation" title="Tous les espaces" subtitle="La même organisation sur mobile et sur desktop."/>
    <div className="more-session-context"><span className="phase-orb">{phaseLabel.slice(0, 1)}</span><div><small>Phase automatique</small><strong>{phaseLabel}</strong></div><em>AUTO</em><span>Prochaine · {nextPhaseAt}</span></div>
    <div className="more-domains">{navigationGroups.map(group => <section key={group.label}><h2>{group.label}</h2><div>{group.items.map(item => <Link key={item.to} to={item.to}><Icon name={item.icon}/><span><strong>{item.label}</strong><small>{item.description}</small></span><Icon name="arrow" size={16}/></Link>)}</div></section>)}</div>
  </section>;
}
````

### `src/pages/NewsPage.tsx`

````tsx
import { useEffect, useRef } from "react";
import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { PageHeading } from "@/components/operations";
import { DeskPage } from "@/pages/pageState";
import type { DeskSession } from "@/types";

export default function NewsPage() {
  return <DeskPage>{data => <NewsContent data={data}/>}</DeskPage>;
}

function NewsContent({ data }: { data: DeskSession }) {
  const nextEventRef = useRef<HTMLElement | null>(null);
  const editorialHeadlines = data.news.headlines.filter(headline => headline.source !== "Calendrier macro");

  useEffect(() => {
    if (!nextEventRef.current) return;
    const timer = window.setTimeout(() => {
      nextEventRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [data.date, data.macro]);

  return <section className="view news-view">
    <PageHeading eyebrow="Contexte marché" title="Macro & News" subtitle={"Calendrier quotidien · " + data.date + " · prochain événement mis en évidence"}/>
    <Card className="digest-react digest-react--compact">
      <div className="brief-card__header"><div><p className="eyebrow">Point quotidien · {data.news.digestUpdatedAt}</p><h3>Synthèse macro</h3></div><span className="card-icon"><Icon name="news"/></span></div>
      <p>{data.news.digest}</p>
    </Card>

    <div className="news-day-heading"><div><h2>Événements du jour</h2><p>{data.macro.length} publication{data.macro.length > 1 ? "s" : ""}</p></div><span>Heure de Paris</span></div>
    <div className="macro-list-react macro-list-react--compact">
      {data.macro.map(event => <article
        key={(event.scheduledAt || event.time) + "-" + event.title}
        className={"macro-event-react macro-event-react--compact " + (event.isNext ? "is-next" : "")}
        ref={event.isNext ? nextEventRef : undefined}
      >
        <div className="macro-event-react__time"><time>{event.time}</time><small>{event.currency || "—"}</small></div>
        <div className="macro-event-react__content">
          <div className="macro-event-react__title"><h3>{event.title}</h3>{event.isNext && <span className="next-event-badge">PROCHAIN</span>}</div>
          <div className="macro-values">
            <div><span>Préc.</span><strong>{event.previous || "—"}</strong></div>
            <div><span>Prévu</span><strong>{event.forecast || "—"}</strong></div>
            <div className="macro-value--actual"><span>Réel</span><strong>{event.actual || "—"}</strong></div>
          </div>
        </div>
        <StatusBadge tone={event.importance.toLowerCase() === "high" ? "critical" : "warning"}>{event.importance}</StatusBadge>
      </article>)}
    </div>

    {editorialHeadlines.length > 0 && <>
      <SectionTitle title="Headlines" subtitle="Flux éditorial complémentaire"/>
      <div className="headline-list-react">
        {editorialHeadlines.map((headline, i) => <Card key={headline.scheduledAt || i} className="headline-react"><time>{headline.time}</time><div><h3>{headline.title}</h3><small>{headline.source}</small><p>{headline.impact}</p></div></Card>)}
      </div>
    </>}
    <Card className="source-rules-react"><p><strong>Source :</strong> calendrier quotidien backend. Les valeurs précédent, prévision et réel sont affichées telles qu’elles sont disponibles, indépendamment des sessions et des workers.</p></Card>
  </section>;
}
````

### `src/pages/NotificationsPage.tsx`

````tsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, Icon, LoadingView, Modal } from "@/components/common";
import { ConfirmActionForm } from "@/components/ConfirmActionForm";
import { Breadcrumbs, formatDateTime, PageHeading, PageTabs, StatusTag } from "@/components/operations";
import { operationsKeys, useNotifications } from "@/hooks/useOperations";
import type { NotificationAction, NotificationActionInput, OperationsNotification } from "@/operationsTypes";

const tabs = [
  { label: "Cockpit", to: "/operations", end: true },
  { label: "Observabilité", to: "/operations/observability" },
  { label: "Incidents", to: "/operations/incidents" },
  { label: "Notifications", to: "/operations/notifications" },
  { label: "Runbooks", to: "/operations/runbooks" },
];

const actionLabels: Record<NotificationAction, string> = {
  mark_read: "Marquer lu",
  dismiss: "Masquer",
};

export default function NotificationsPage() {
  const client = useQueryClient();
  const [status, setStatus] = useState("active");
  const [level, setLevel] = useState("all");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [commandTarget, setCommandTarget] = useState<OperationsNotification | null>(null);
  const [action, setAction] = useState<NotificationAction>("mark_read");
  const filters = useMemo(() => ({
    status: status === "all" ? null : status,
    level: level === "all" ? null : level,
    q: q.trim() || null,
  }), [level, q, status]);
  const query = useNotifications(filters);

  const sync = useMutation({
    mutationFn: () => operationsApi.syncNotifications({ autoClear: true, reason: "Synchronisation manuelle Notification Center" }),
    onSuccess: async () => client.invalidateQueries({ queryKey: operationsKeys.all }),
  });
  const command = useMutation({
    mutationFn: (input: NotificationActionInput) => operationsApi.executeNotificationAction(commandTarget!.id, input),
    onSuccess: async () => {
      setCommandTarget(null);
      await client.invalidateQueries({ queryKey: operationsKeys.all });
    },
  });

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Notifications indisponibles"} retry={() => query.refetch()}/>;

  const items = query.data.items;
  const summary = query.data.summary;
  const selected = items.find((item) => item.id === selectedId) || items[0] || null;
  const expected = `CONFIRM_${action.toUpperCase()}`;
  const openCommand = (notification: OperationsNotification, nextAction: NotificationAction) => {
    setCommandTarget(notification);
    setAction(nextAction);
  };

  return <section className="view workspace-view notification-center-view">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Notifications" }]}/>
    <PageHeading
      eyebrow="Notification Center"
      title="Notifications & escalade"
      subtitle="Outbox locale dédupliquée par incident, avec priorité, niveau d’escalade et actions opérateur."
      backTo="/operations"
      actions={<button className="secondary-btn" onClick={() => sync.mutate()} disabled={sync.isPending}><Icon name="refresh" size={14}/>{sync.isPending ? "Sync…" : "Synchroniser"}</button>}
      tabs={<PageTabs items={tabs}/>}
    />

    <div className="metric-grid metric-grid--compact notification-kpis">
      <Card className="metric-card" data-tone={summary.page ? "negative" : "positive"}><span>Page</span><strong>{summary.page}</strong><small>Escalade immédiate</small></Card>
      <Card className="metric-card" data-tone={summary.action ? "warning" : "neutral"}><span>Action</span><strong>{summary.action}</strong><small>{summary.pending} en attente</small></Card>
      <Card className="metric-card"><span>Watch</span><strong>{summary.watch}</strong><small>Surveillance active</small></Card>
      <Card className="metric-card"><span>Lues</span><strong>{summary.read}</strong><small>Acquittées localement</small></Card>
      <Card className="metric-card"><span>Clôturées</span><strong>{summary.cleared}</strong><small>Incidents résolus</small></Card>
    </div>

    <div className="notification-center-layout">
      <Card className="notification-ledger-panel">
        <header className="incident-command-toolbar notification-toolbar">
          <div>
            <p className="eyebrow">Outbox locale</p>
            <h2>{items.length} notifications</h2>
          </div>
          <div>
            <label>Statut<select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrer par statut notification"><option value="active">Actives</option><option value="pending">À lire</option><option value="read">Lues</option><option value="dismissed">Masquées</option><option value="cleared">Clôturées</option><option value="all">Toutes</option></select></label>
            <label>Niveau<select value={level} onChange={(event) => setLevel(event.target.value)} aria-label="Filtrer par niveau"><option value="all">Tous</option><option value="page">Page</option><option value="action">Action</option><option value="watch">Watch</option><option value="muted">Muted</option><option value="cleared">Cleared</option></select></label>
            <label>Recherche<input value={q} onChange={(event) => setQ(event.target.value)} placeholder="incident, run, worker…" aria-label="Rechercher une notification"/></label>
          </div>
        </header>
        {!items.length ? <div className="workspace-empty incident-empty"><Icon name="bell"/><h3>Outbox vide</h3><p>Lance la synchronisation pour matérialiser les notifications des incidents actifs.</p></div> : <div className="data-table-wrap notification-ledger-wrap">
          <table className="data-table notification-ledger-table">
            <thead><tr><th>Notification</th><th>Niveau</th><th>Incident</th><th>Contexte</th><th>État</th></tr></thead>
            <tbody>{items.map((item) => <tr key={item.id} className={selected?.id === item.id ? "is-selected" : ""} data-level={item.escalationLevel} onClick={() => setSelectedId(item.id)}>
              <td data-label="Notification"><strong><i data-level={item.escalationLevel}/>{item.title}</strong><small>{item.reasonCodes.join(" · ") || item.sourceId}</small></td>
              <td data-label="Niveau"><span className="terminal-code">{levelLabel(item.escalationLevel)}</span><small>prio {item.priority}</small></td>
              <td data-label="Incident">{item.incidentKind || "incident"}<small>{item.incidentSourceId || item.incidentId || "N/D"}</small></td>
              <td data-label="Contexte">{item.workflow || item.runId || "desk"}<small>{item.worker || item.processId || "local"}</small></td>
              <td data-label="État"><StatusTag status={item.status}/><small>{formatDateTime(item.updatedAt)}</small></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </Card>

      <Card className="notification-detail-panel">
        {!selected ? <div className="workspace-empty incident-empty"><Icon name="database"/><h3>Aucun détail</h3><p>Sélectionne une notification dans l’outbox.</p></div> : <NotificationDetail notification={selected} onCommand={openCommand}/>}
      </Card>
    </div>

    <Modal open={Boolean(commandTarget)} title={commandTarget ? `${actionLabels[action]} · ${commandTarget.title}` : "Traiter la notification"} onClose={() => !command.isPending && setCommandTarget(null)}>
      {commandTarget && <>
        <label className="confirm-action__action">Action
          <select value={action} onChange={(event) => setAction(event.target.value as NotificationAction)}>
            {commandTarget.allowedActions.includes("mark_read") && <option value="mark_read">Marquer lu</option>}
            {commandTarget.allowedActions.includes("dismiss") && <option value="dismiss">Masquer</option>}
          </select>
        </label>
        <ConfirmActionForm
          key={`${commandTarget.id}:${action}`}
          target={commandTarget.title}
          revision={commandTarget.revision}
          expectedPhrase={expected}
          onCancel={() => setCommandTarget(null)}
          confirmLabel={actionLabels[action]}
          onConfirm={({ confirmationPhrase, reason }) => command.mutateAsync({
            action,
            reason,
            confirmationPhrase,
            idempotencyKey: crypto.randomUUID(),
            expectedRevision: commandTarget.revision,
          }).then(() => undefined)}
        />
      </>}
    </Modal>
  </section>;
}

function NotificationDetail({ notification, onCommand }: { notification: OperationsNotification; onCommand: (notification: OperationsNotification, action: NotificationAction) => void }) {
  const timeline = notification.timeline || [];
  return <>
    <header className="incident-detail-head notification-detail-head">
      <div>
        <p className="eyebrow">{levelLabel(notification.escalationLevel)} · rev {notification.revision}</p>
        <h2>{notification.title}</h2>
        <p>{notification.message || "Aucun message détaillé."}</p>
      </div>
      <StatusTag status={notification.status}/>
    </header>
    <div className="incident-action-strip">
      {notification.allowedActions.includes("mark_read") && <button className="secondary-btn" onClick={() => onCommand(notification, "mark_read")}>Marquer lu</button>}
      {notification.allowedActions.includes("dismiss") && <button className="danger-btn" onClick={() => onCommand(notification, "dismiss")}>Masquer</button>}
      {notification.incidentId && <Link className="secondary-btn" to={`/operations/incidents?incident=${encodeURIComponent(notification.incidentId)}`}>Ouvrir incident</Link>}
    </div>
    <dl className="incident-evidence-grid notification-evidence-grid">
      <div><dt>Niveau</dt><dd>{levelLabel(notification.escalationLevel)}</dd></div>
      <div><dt>Priorité</dt><dd>{notification.priority}</dd></div>
      <div><dt>Owner</dt><dd>{notification.owner || "Non assigné"}</dd></div>
      <div><dt>Canal</dt><dd>{notification.channel}</dd></div>
      <div><dt>Run</dt><dd>{notification.runId || "N/D"}</dd></div>
      <div><dt>Process</dt><dd>{notification.processId || "N/D"}</dd></div>
      <div><dt>Workflow</dt><dd>{notification.workflow || "N/D"}</dd></div>
      <div><dt>Dedupe</dt><dd>{notification.dedupeKey || "N/D"}</dd></div>
    </dl>
    <section className="incident-policy-evidence notification-policy-evidence">
      <header><p className="eyebrow">Evidence</p><span>{notification.fingerprint?.slice(0, 12) || "no-fingerprint"}</span></header>
      <pre>{JSON.stringify(notification.evidence || {}, null, 2)}</pre>
    </section>
    <section className="incident-timeline-panel">
      <header><p className="eyebrow">Timeline outbox</p><span>{timeline.length} événements</span></header>
      {!timeline.length ? <p className="empty-copy">Aucun événement matérialisé.</p> : <ol className="incident-timeline">
        {timeline.map((event) => <li key={event.id}>
          <time>{formatDateTime(event.at)}</time>
          <i data-severity={event.severity}/>
          <div><strong>{event.type}</strong><p>{event.message || event.title}</p></div>
        </li>)}
      </ol>}
    </section>
  </>;
}

function levelLabel(level: string) {
  if (level === "page") return "PAGE";
  if (level === "action") return "ACTION";
  if (level === "muted") return "MUTED";
  if (level === "cleared") return "CLEARED";
  return "WATCH";
}
````

### `src/pages/ObservabilityPage.tsx`

````tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView, Modal } from "@/components/common";
import { ConfirmActionForm } from "@/components/ConfirmActionForm";
import {
  Breadcrumbs,
  formatDateTime,
  formatDuration,
  MetricCard,
  MetricStrip,
  PageHeading,
  PageTabs,
  StatusTag,
} from "@/components/operations";
import { operationsKeys, useObservability, useOperationsEvents } from "@/hooks/useOperations";
import type {
  GuardrailSignal,
  ObservabilityBreakdown,
  ObservabilityPolicy,
  ObservabilityPolicyActionInput,
  ObservabilityProcess,
  ObservabilityOverview,
} from "@/operationsTypes";

export default function ObservabilityPage() {
  useOperationsEvents();
  const [configuring, setConfiguring] = useState(false);
  const [params, setParams] = useSearchParams();
  const filters = {
    q: params.get("q") || "",
    scope: params.get("scope") || "",
    workflow: params.get("workflow") || "",
    worker: params.get("worker") || "",
    model: params.get("model") || "",
    status: params.get("status") || "",
  };
  const query = useObservability({ ...filters, limit: 1000 });
  const setFilter = (key: string, value: string) => setParams(current => {
    const next = new URLSearchParams(current);
    value ? next.set(key, value) : next.delete(key);
    return next;
  }, { replace: true });

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Observabilité indisponible"} retry={() => query.refetch()}/>;

  const data = query.data;
  const summary = data.summary;
  return <section className="view workspace-view observability-v3">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Observabilité GPT" }]}/>
    <PageHeading
      eyebrow="Automation control plane"
      title="Observabilité & coûts GPT"
      subtitle="File, workers, leases, latences et consommation mesurée sur les workflows LIVE et REPLAY."
      backTo="/operations"
      actions={<><button className="secondary-btn" onClick={() => setConfiguring(true)}>Configurer les guardrails</button><span className="observability-refresh">AUTO 10S · {formatDateTime(data.generatedAt)}</span></>}
      tabs={<OperationsTabs/>}
    />

    <MetricStrip className="metric-strip--six observability-kpis">
      <MetricCard label="Processus" value={summary.processes} detail={`${summary.running} actifs · ${summary.queued} queue`}/>
      <MetricCard label="Leases à risque" value={data.leases.expiring + data.leases.expired} detail={`${data.leases.expired} expirées`} tone={data.leases.expired ? "critical" : data.leases.expiring ? "warning" : "positive"}/>
      <MetricCard label="Succès terminal" value={formatPercent(summary.successRate)} detail={`${summary.failed} échecs · ${summary.retries} retries`} tone={summary.failed ? "warning" : "positive"}/>
      <MetricCard label="P95 exécution" value={formatDuration(summary.p95ExecutionMs)} detail={`moy. ${formatDuration(summary.avgExecutionMs)}`}/>
      <MetricCard label="Jetons observés" value={formatTokens(summary.totalTokens)} detail={`${data.coverage.tokens.percent}% de couverture`}/>
      <MetricCard label="Coût observé" value={formatCost(summary.costUsd)} detail={`${data.coverage.cost.percent}% de couverture`} tone={summary.costUsd === null ? "warning" : "neutral"}/>
    </MetricStrip>

    <CoverageRail data={data}/>
    <GuardrailBoard data={data}/>

    <div className="workspace-toolbar observability-filter-bar">
      <label>Recherche<input value={filters.q} onChange={event => setFilter("q", event.target.value)} placeholder="Process, run, worker…"/></label>
      <label>Scope<select value={filters.scope} onChange={event => setFilter("scope", event.target.value)}><option value="">LIVE + REPLAY</option>{data.facets.scopes.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Workflow<select value={filters.workflow} onChange={event => setFilter("workflow", event.target.value)}><option value="">Tous</option>{data.facets.workflows.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Worker<select value={filters.worker} onChange={event => setFilter("worker", event.target.value)}><option value="">Tous</option>{data.facets.workers.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Modèle<select value={filters.model} onChange={event => setFilter("model", event.target.value)}><option value="">Tous</option>{data.facets.models.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>État<select value={filters.status} onChange={event => setFilter("status", event.target.value)}><option value="">Tous</option>{data.facets.statuses.map(value => <option key={value}>{value}</option>)}</select></label>
      <button className="text-btn" onClick={() => query.refetch()}>Actualiser</button>
    </div>

    <div className="observability-workbench">
      <Card className="observability-health-panel">
        <header><div><p className="eyebrow">SLA & transport</p><h2>Santé du pipeline</h2></div><span className={summary.slaBreaches ? "negative" : "positive"}>{summary.slaBreaches} BREACH</span></header>
        <div className="observability-health-grid">
          <HealthCell label="Queue depth" value={data.queue.depth} detail={`attente max ${formatDuration(data.queue.oldestQueuedMs)}`} tone={data.queue.oldestQueuedMs && data.queue.oldestQueuedMs > data.sla.queueWarningMs ? "warning" : "positive"}/>
          <HealthCell label="Queue moyenne" value={formatDuration(summary.avgQueueMs)} detail={`SLA ${formatDuration(data.sla.queueWarningMs)}`}/>
          <HealthCell label="Leases actives" value={data.leases.active} detail={`${data.leases.expiring} expirantes`} tone={data.leases.expiring ? "warning" : "positive"}/>
          <HealthCell label="Exécution moyenne" value={formatDuration(summary.avgExecutionMs)} detail={`SLA ${formatDuration(data.sla.executionWarningMs)}`}/>
        </div>
      </Card>
      <BreakdownPanel title="Workflows" items={data.breakdowns.workflows}/>
      <BreakdownPanel title="Workers" items={data.breakdowns.workers}/>
      <BreakdownPanel title="Modèles" items={data.breakdowns.models}/>
    </div>

    <section className="replay-terminal-section observability-process-ledger">
      <header><div><p className="eyebrow">Process ledger</p><h2>Exécutions GPT globales</h2></div><span>{data.count} lignes · aucun coût estimé</span></header>
      <ProcessTable items={data.items}/>
    </section>
    <GuardrailPolicyModal open={configuring} policy={data.guardrails.policy} onClose={() => setConfiguring(false)}/>
  </section>;
}

function OperationsTabs() {
  return <PageTabs items={[
    { label: "Cockpit", to: "/operations", end: true },
    { label: "Observabilité", to: "/operations/observability" },
    { label: "Incidents", to: "/operations/incidents" },
    { label: "Notifications", to: "/operations/notifications" },
    { label: "Runbooks", to: "/operations/runbooks" },
  ]}/>;
}

function CoverageRail({ data }: { data: ObservabilityOverview }) {
  return <div className="observability-coverage" aria-label="Couverture de la télémétrie">
    <span>TELEMETRY COVERAGE</span>
    {([
      ["Payload", data.coverage.telemetry],
      ["Tokens", data.coverage.tokens],
      ["Cost USD", data.coverage.cost],
    ] as const).map(([label, value]) => <div key={label}><strong>{label}</strong><i><b style={{ width: `${value.percent}%` }}/></i><em>{value.available}/{value.total} · {value.percent}%</em></div>)}
    <small>Les valeurs N/D ne sont ni extrapolées ni tarifées localement.</small>
  </div>;
}

function GuardrailBoard({ data }: { data: ObservabilityOverview }) {
  const guardrails = data.guardrails;
  const daily = guardrails.budgets.daily[0] || null;
  const monthly = guardrails.budgets.monthly[0] || null;
  return <section className="guardrail-board" aria-label="Guardrails SLA et budgets GPT">
    <header>
      <div><p className="eyebrow">Active guardrails</p><h2>SLA & budgets mesurés</h2></div>
      <span data-enabled={guardrails.enabled}>{guardrails.enabled ? `POLICY R${guardrails.policy.revision}` : "DISABLED"}</span>
    </header>
    <div className="guardrail-summary">
      <GuardrailCounter label="Critiques" value={guardrails.summary.critical} tone="critical"/>
      <GuardrailCounter label="Warnings" value={guardrails.summary.warning} tone="warning"/>
      <BudgetCell label="Budget jour" period={daily} limit={guardrails.policy.dailyCostBudgetUsd}/>
      <BudgetCell label="Budget mois" period={monthly} limit={guardrails.policy.monthlyCostBudgetUsd}/>
      <GuardrailCounter label="Failure rate" value={guardrails.summary.failureRatePct === null ? "N/D" : `${guardrails.summary.failureRatePct}%`} tone={guardrails.summary.failureRatePct !== null && guardrails.summary.failureRatePct > guardrails.policy.failureRateWarningPct ? "critical" : "neutral"}/>
    </div>
    <div className="guardrail-signals">
      {!guardrails.signals.length ? <div className="guardrail-signal guardrail-signal--healthy"><i/><div><strong>Aucun signal actif</strong><small>Les seuils configurés sont respectés sur les données mesurées.</small></div></div>
        : guardrails.signals.slice(0, 8).map(signal => <GuardrailSignalRow key={signal.id} signal={signal}/>)}
    </div>
  </section>;
}

function GuardrailCounter({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return <div data-tone={tone}><span>{label}</span><strong>{value}</strong></div>;
}

function BudgetCell({ label, period, limit }: { label: string; period: ObservabilityOverview["guardrails"]["budgets"]["daily"][number] | null; limit: number | null }) {
  return <div data-tone={period?.state === "breached" ? "critical" : period?.state === "insufficient_data" ? "warning" : "neutral"}>
    <span>{label}</span><strong>{limit === null ? "NON CONFIG." : `${formatCost(period?.measuredCostUsd ?? 0)} / ${formatCost(limit)}`}</strong>
  </div>;
}

function GuardrailSignalRow({ signal }: { signal: GuardrailSignal }) {
  const content = <><i/><div><strong>{signal.title}</strong><small>{signal.message}</small></div><em>{formatGuardrailValue(signal.observedValue, signal.unit)}</em></>;
  return signal.processId && signal.runId
    ? <Link className={`guardrail-signal guardrail-signal--${signal.severity}`} to={`/replay/runs/${encodeURIComponent(signal.runId)}/gpt/${encodeURIComponent(signal.processId)}`}>{content}</Link>
    : <div className={`guardrail-signal guardrail-signal--${signal.severity}`}>{content}</div>;
}

function GuardrailPolicyModal({ open, policy, onClose }: { open: boolean; policy: ObservabilityPolicy; onClose: () => void }) {
  return <Modal open={open} title="Configurer les guardrails GPT" onClose={onClose}>
    {open && <GuardrailPolicyForm key={policy.revision} policy={policy} onClose={onClose}/>}
  </Modal>;
}

function GuardrailPolicyForm({ policy, onClose }: { policy: ObservabilityPolicy; onClose: () => void }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState({
    enabled: policy.enabled,
    queueWarningMinutes: policy.queueWarningMs / 60_000,
    executionWarningMinutes: policy.executionWarningMs / 60_000,
    leaseExpiringMinutes: policy.leaseExpiringMs / 60_000,
    telemetryCoverageWarningPct: policy.telemetryCoverageWarningPct,
    costCoverageMinimumPct: policy.costCoverageMinimumPct,
    failureRateWarningPct: policy.failureRateWarningPct,
    dailyCostBudgetUsd: policy.dailyCostBudgetUsd === null ? "" : String(policy.dailyCostBudgetUsd),
    monthlyCostBudgetUsd: policy.monthlyCostBudgetUsd === null ? "" : String(policy.monthlyCostBudgetUsd),
  });
  const mutation = useMutation({
    mutationFn: operationsApi.updateObservabilityPolicy,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: operationsKeys.all });
      onClose();
    },
  });
  const update = (field: keyof typeof draft, value: string | number | boolean) => setDraft(current => ({ ...current, [field]: value }));
  const valid = () => (
    draft.queueWarningMinutes >= 1
    && draft.executionWarningMinutes >= 1
    && draft.leaseExpiringMinutes >= .5
    && [draft.telemetryCoverageWarningPct, draft.costCoverageMinimumPct, draft.failureRateWarningPct].every(value => value >= 0 && value <= 100)
    && [draft.dailyCostBudgetUsd, draft.monthlyCostBudgetUsd].every(value => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0))
  );
  return <ConfirmActionForm
    target="observability-policy/default"
    revision={policy.revision}
    expectedPhrase="CONFIRM_UPDATE"
    confirmLabel="Enregistrer la policy"
    onCancel={onClose}
    validateExtra={valid}
    onConfirm={({ confirmationPhrase, reason }) => {
      const input: ObservabilityPolicyActionInput = {
        action: "update",
        expectedRevision: policy.revision,
        idempotencyKey: crypto.randomUUID(),
        confirmationPhrase: confirmationPhrase as "CONFIRM_UPDATE",
        reason,
        policy: {
          enabled: draft.enabled,
          queueWarningMs: Math.round(draft.queueWarningMinutes * 60_000),
          executionWarningMs: Math.round(draft.executionWarningMinutes * 60_000),
          leaseExpiringMs: Math.round(draft.leaseExpiringMinutes * 60_000),
          telemetryCoverageWarningPct: Number(draft.telemetryCoverageWarningPct),
          costCoverageMinimumPct: Number(draft.costCoverageMinimumPct),
          failureRateWarningPct: Number(draft.failureRateWarningPct),
          dailyCostBudgetUsd: draft.dailyCostBudgetUsd === "" ? null : Number(draft.dailyCostBudgetUsd),
          monthlyCostBudgetUsd: draft.monthlyCostBudgetUsd === "" ? null : Number(draft.monthlyCostBudgetUsd),
        },
      };
      return mutation.mutateAsync(input).then(() => undefined);
    }}
  >
    <div className="guardrail-policy-form">
      <label className="guardrail-policy-toggle"><input type="checkbox" checked={draft.enabled} onChange={event => update("enabled", event.target.checked)}/><span>Guardrails actifs</span></label>
      <PolicyNumber label="Queue SLA (min)" value={draft.queueWarningMinutes} min={1} onChange={value => update("queueWarningMinutes", value)}/>
      <PolicyNumber label="Exécution SLA (min)" value={draft.executionWarningMinutes} min={1} onChange={value => update("executionWarningMinutes", value)}/>
      <PolicyNumber label="Lease expirante (min)" value={draft.leaseExpiringMinutes} min={.5} step={.5} onChange={value => update("leaseExpiringMinutes", value)}/>
      <PolicyNumber label="Couverture télémétrie (%)" value={draft.telemetryCoverageWarningPct} min={0} max={100} onChange={value => update("telemetryCoverageWarningPct", value)}/>
      <PolicyNumber label="Couverture coût minimale (%)" value={draft.costCoverageMinimumPct} min={0} max={100} onChange={value => update("costCoverageMinimumPct", value)}/>
      <PolicyNumber label="Taux d’échec max. (%)" value={draft.failureRateWarningPct} min={0} max={100} onChange={value => update("failureRateWarningPct", value)}/>
      <PolicyText label="Budget journalier USD" value={draft.dailyCostBudgetUsd} placeholder="Non configuré" onChange={value => update("dailyCostBudgetUsd", value)}/>
      <PolicyText label="Budget mensuel USD" value={draft.monthlyCostBudgetUsd} placeholder="Non configuré" onChange={value => update("monthlyCostBudgetUsd", value)}/>
    </div>
  </ConfirmActionForm>;
}

function PolicyNumber({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max?: number; step?: number; onChange: (value: number) => void }) {
  return <label>{label}<input type="number" value={value} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))}/></label>;
}

function PolicyText({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label>{label}<input type="number" value={value} min="0" step="0.0001" placeholder={placeholder} onChange={event => onChange(event.target.value)}/></label>;
}

function HealthCell({ label, value, detail, tone = "neutral" }: { label: string; value: string | number; detail: string; tone?: string }) {
  return <div data-tone={tone}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function BreakdownPanel({ title, items }: { title: string; items: ObservabilityBreakdown[] }) {
  return <Card className="observability-breakdown">
    <header><h2>{title}</h2><span>{items.length}</span></header>
    <div>{items.slice(0, 6).map(item => <div className="observability-breakdown__row" key={item.label}>
      <strong title={item.label}>{item.label}</strong>
      <span>{item.processes} proc.</span>
      <span>{formatPercent(item.successRate)}</span>
      <span>{formatDuration(item.avgExecutionMs)}</span>
      <em>{formatCost(item.costUsd)}</em>
    </div>)}</div>
  </Card>;
}

function ProcessTable({ items }: { items: ObservabilityProcess[] }) {
  if (!items.length) return <Card className="workspace-empty"><h3>Aucun processus</h3><p>Aucune exécution persistée ne correspond aux filtres.</p></Card>;
  return <div className="data-table-wrap"><table className="data-table observability-process-table">
    <thead><tr><th>Scope / Workflow</th><th>État</th><th>Worker</th><th>Queue</th><th>Exécution</th><th>Lease</th><th>Modèle</th><th>Tokens</th><th>Coût</th><th><span className="sr-only">Action</span></th></tr></thead>
    <tbody>{items.map(item => <tr key={item.id} data-breach={item.sla.queueBreached || item.sla.executionBreached || item.sla.leaseBreached}>
      <td data-label="Workflow"><strong><i data-scope={item.scope}/>{item.workflow}</strong><small>{item.scope.toUpperCase()} · {item.tradingDate || "—"} · {item.session || "—"}</small></td>
      <td data-label="État"><StatusTag status={item.status}/><small>{item.attempts}/{item.maxAttempts || "—"} tent.</small></td>
      <td data-label="Worker"><span className="terminal-code" title={item.worker || "Non assigné"}>{item.worker || "—"}</span></td>
      <td data-label="Queue"><DurationValue value={item.queueMs} breached={item.sla.queueBreached}/></td>
      <td data-label="Exécution"><DurationValue value={item.executionMs} breached={item.sla.executionBreached}/></td>
      <td data-label="Lease"><LeaseState item={item}/></td>
      <td data-label="Modèle"><strong>{item.telemetry.model || "N/D"}</strong><small>{item.telemetry.provider || "telemetry absente"}</small></td>
      <td data-label="Tokens"><span>{formatTokens(item.telemetry.totalTokens)}</span><small>{item.telemetry.inputTokens === null ? "N/D" : `${item.telemetry.inputTokens} in · ${item.telemetry.outputTokens ?? "N/D"} out`}</small></td>
      <td data-label="Coût"><strong>{formatCost(item.telemetry.costUsd)}</strong></td>
      <td data-label="Action">{item.scope === "replay" && item.runId && item.workItemId
        ? <Link className="row-link" to={`/replay/runs/${encodeURIComponent(item.runId)}/gpt/${encodeURIComponent(item.workItemId)}`}>Inspecter <span>→</span></Link>
        : <span className="observability-live-ref" title={item.cursorId || ""}>CURSOR</span>}</td>
    </tr>)}</tbody>
  </table></div>;
}

function DurationValue({ value, breached }: { value: number | null; breached: boolean }) {
  return <span className={breached ? "observability-breach" : ""}>{formatDuration(value)}{breached && <small>SLA</small>}</span>;
}

function LeaseState({ item }: { item: ObservabilityProcess }) {
  const labels = { none: "—", active: "ACTIVE", expiring: "EXPIRING", expired: "EXPIRED" };
  return <span className="lease-state" data-state={item.lease.state}>{labels[item.lease.state]}<small>{item.lease.state === "none" ? "" : formatDateTime(item.lease.expiresAt)}</small></span>;
}

function formatPercent(value: number | null) {
  return value === null ? "N/D" : `${Math.round(value * 100)}%`;
}

function formatTokens(value: number | null) {
  return value === null ? "N/D" : new Intl.NumberFormat("fr-FR").format(value);
}

function formatCost(value: number | null) {
  if (value === null) return "N/D";
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

function formatGuardrailValue(value: number | null, unit: GuardrailSignal["unit"]) {
  if (value === null) return "N/D";
  if (unit === "ms") return formatDuration(Math.abs(value));
  if (unit === "percent") return `${value}%`;
  if (unit === "usd") return formatCost(value);
  return new Intl.NumberFormat("fr-FR").format(value);
}
````

### `src/pages/OperationsPage.tsx`

````tsx
import { Link, useSearchParams } from "react-router-dom";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { formatDateTime, MetricCard, MetricStrip, PageHeading, PageTabs, ProgressBar, StatusTag, WorkflowTable } from "@/components/operations";
import { useOperationsEvents, useOperationsSummary, useWorkflows } from "@/hooks/useOperations";
import type { WorkflowSummary } from "@/operationsTypes";

export default function OperationsPage() {
  useOperationsEvents();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") || "";
  const kind = params.get("kind") || "";
  const q = params.get("q") || "";
  const view = params.get("view") || "table";
  const setFilter = (key: string, value: string) => setParams(current => {
    const next = new URLSearchParams(current);
    value ? next.set(key, value) : next.delete(key);
    return next;
  }, { replace: true });
  const summary = useOperationsSummary();
  const workflows = useWorkflows({ status, kind, q, limit: 500 });
  if (summary.isLoading || workflows.isLoading) return <LoadingView/>;
  if (summary.isError || workflows.isError || !summary.data || !workflows.data) return <ErrorView message={(summary.error || workflows.error)?.message || "Cockpit indisponible"} retry={() => { summary.refetch(); workflows.refetch(); }}/ >;
  const totals = summary.data.totals;
  return <section className="view workspace-view">
    <PageHeading eyebrow="Automatisation" title="Cockpit des opérations" subtitle="Tous les workflows automatisés, leur progression et les interventions requises." actions={<Link className="secondary-btn" to="/operations/incidents">Incidents · {totals.openIncidents}</Link>} tabs={<PageTabs items={[{ label: "Cockpit", to: "/operations", end: true }, { label: "Observabilité", to: "/operations/observability" }, { label: "Incidents", to: "/operations/incidents" }, { label: "Notifications", to: "/operations/notifications" }, { label: "Runbooks", to: "/operations/runbooks" }]}/>}/>
    <MetricStrip className="metric-strip--six">
      <MetricCard label="Workflows" value={totals.workflows} detail={summary.data.health.label} onClick={() => setFilter("status", "")}/>
      <MetricCard label="En cours" value={totals.running} tone="info" onClick={() => setFilter("status", "running")}/>
      <MetricCard label="Attente GPT" value={totals.waitingGpt} tone="warning" onClick={() => setFilter("status", "waiting_gpt")}/>
      <MetricCard label="Bloqués / échecs" value={totals.blocked + totals.failed} tone={totals.failed ? "critical" : "warning"} onClick={() => setFilter("status", totals.failed ? "failed" : "blocked")}/>
      <MetricCard label="Terminés" value={totals.completed} tone="positive" onClick={() => setFilter("status", "completed")}/>
      <MetricCard label="Process GPT actifs" value={totals.gptInProgress}/>
    </MetricStrip>
    <div className="workspace-toolbar">
      <label>Recherche<input value={q} onChange={event => setFilter("q", event.target.value)} placeholder="ID, type, état…"/></label>
      <label>Type<select value={kind} onChange={event => setFilter("kind", event.target.value)}><option value="">Tous</option><option value="replay">Replay</option><option value="backtest">Backtest</option><option value="job">Job</option><option value="feature">Feature</option></select></label>
      <label>État<select value={status} onChange={event => setFilter("status", event.target.value)}><option value="">Tous</option><option value="running">En cours</option><option value="waiting_gpt">Attente GPT</option><option value="blocked">Bloqué</option><option value="failed">Échec</option><option value="completed">Terminé</option><option value="paused">Pause</option></select></label>
      <div className="workspace-view-switch" role="group" aria-label="Vue workflows"><button className={view === "table" ? "active" : ""} onClick={() => setFilter("view", "table")}>Table</button><button className={view === "board" ? "active" : ""} onClick={() => setFilter("view", "board")}>Board</button><button className={view === "timeline" ? "active" : ""} onClick={() => setFilter("view", "timeline")}>Timeline</button></div>
      <button className="text-btn" onClick={() => workflows.refetch()}>Actualiser</button>
    </div>
    {view === "board" ? <WorkflowBoard items={workflows.data.items}/> : view === "timeline" ? <WorkflowTimeline items={workflows.data.items}/> : <WorkflowTable items={workflows.data.items}/>}
  </section>;
}

function WorkflowBoard({ items }: { items: WorkflowSummary[] }) {
  const lanes = ["running", "waiting_gpt", "blocked", "failed", "queued", "paused", "completed"];
  const grouped = items.reduce<Record<string, WorkflowSummary[]>>((output, item) => {
    const key = lanes.includes(item.status) ? item.status : "queued";
    (output[key] ||= []).push(item);
    return output;
  }, {});
  return <div className="workflow-board" aria-label="Board workflows automatisés">
    {lanes.map((lane) => <Card className="workflow-board__lane" key={lane}>
      <header><div><p className="eyebrow">{laneLabel(lane)}</p><h2>{grouped[lane]?.length || 0}</h2></div><StatusTag status={lane}/></header>
      <div>{(grouped[lane] || []).map((item) => <Link className="workflow-board-card" key={item.id} to={`/operations/workflows/${encodeURIComponent(item.id)}`}>
        <div><strong>{item.name}</strong><small>{item.sourceId}</small></div>
        <ProgressBar value={item.progress} status={item.status}/>
        <footer><span>{item.session || item.kind}</span><span>{formatDateTime(item.updatedAt)}</span></footer>
      </Link>)}</div>
    </Card>)}
  </div>;
}

function WorkflowTimeline({ items }: { items: WorkflowSummary[] }) {
  const ordered = [...items].sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  return <Card className="workflow-timeline-panel">
    <header><div><p className="eyebrow">Timeline workflows</p><h2>Dernières transitions automatisées</h2></div><span>{ordered.length} événements</span></header>
    {!ordered.length ? <div className="terminal-empty-state"><span>NO_WORKFLOW</span><small>Aucun workflow dans le filtre courant.</small></div> : <ol className="workflow-timeline">
      {ordered.map((item) => <li key={item.id} data-status={item.status}>
        <time>{formatDateTime(item.updatedAt)}</time>
        <i/>
        <div><div><strong>{item.name}</strong><StatusTag status={item.status}/></div><p>{item.error?.message || `${item.kind} · ${item.session || "session globale"} · ${item.progress}%`}</p><Link className="row-link" to={`/operations/workflows/${encodeURIComponent(item.id)}`}>Ouvrir le workflow <Icon name="arrow" size={13}/></Link></div>
      </li>)}
    </ol>}
  </Card>;
}

function laneLabel(status: string) {
  return ({ running: "En cours", waiting_gpt: "Attente GPT", blocked: "Bloqués", failed: "Échecs", queued: "Queue", paused: "Pause", completed: "Terminés" } as Record<string, string>)[status] || status;
}
````

### `src/pages/pageState.tsx`

````tsx
import type { ReactNode } from "react";
import { ErrorView, LoadingView } from "@/components/common";
import { useDeskContext } from "@/context/DeskContext";
import { useDeskSession } from "@/hooks/useDesk";
import type { DeskSession } from "@/types";

export function DeskPage({ children }: { children: (data: DeskSession) => ReactNode }) {
  const { sessionId } = useDeskContext();
  const query = useDeskSession(sessionId);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error instanceof Error ? query.error.message : "Erreur inconnue"} retry={() => query.refetch()}/>;
  return <>{children(query.data)}</>;
}
````

### `src/pages/PerformanceAnalysisPage.tsx`

````tsx
import { useDeferredValue, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { MetricCard, MetricStrip, PageHeading, PageTabs, ProgressBar, StatusTag } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";
import type { PerformanceBreakdownItem, PerformanceDailyPoint, PerformanceEquityPoint, PerformanceOverview } from "@/operationsTypes";

export default function PerformanceAnalysisPage() {
  const [params, setParams] = useSearchParams();
  const rawFilters = useMemo(() => ({
    strategyId: params.get("strategy") || "",
    session: params.get("session") || "",
    instrument: params.get("instrument") || "",
    direction: params.get("direction") || "",
    from: params.get("from") || "",
    to: params.get("to") || "",
  }), [params]);
  const filters = useDeferredValue(rawFilters);
  const apiFilters = useMemo(() => ({
    strategy_id: filters.strategyId || null,
    session: filters.session || null,
    instrument: filters.instrument || null,
    direction: filters.direction || null,
    from: filters.from || null,
    to: filters.to || null,
  }), [filters]);
  const query = useQuery({ queryKey: [...operationsKeys.performance, apiFilters], queryFn: () => operationsApi.getPerformance(apiFilters) });
  const setFilter = (key: string, value: string) => setParams(current => {
    const next = new URLSearchParams(current);
    value ? next.set(key, value) : next.delete(key);
    return next;
  }, { replace: true });
  const clearFilters = () => setParams({}, { replace: true });

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Analyse indisponible"} retry={() => query.refetch()}/>;

  const data = query.data;
  const totals = data.totals;
  const hasFilters = Object.values(rawFilters).some(Boolean);
  const isEmpty = !data.equity.length && !data.dailySeries.length && !data.breakdowns.some(item => item.items.length);

  return <section className="view workspace-view performance-intelligence-v3">
    <PageHeading eyebrow="Performance intelligence" title="Analyse de performance" subtitle="Equity, drawdown, régularité et attribution sur les trades réellement persistés." actions={<><button className="secondary-btn" onClick={() => query.refetch()}>Actualiser</button><Link className="primary-btn" to="/replay/compare">Comparer les runs</Link></>} tabs={<PageTabs items={[{ label: "Analyse", to: "/performance/analysis", end: true }, { label: "Calendrier R", to: "/performance" }]}/>}/>

    <MetricStrip className="metric-grid--compact performance-kpi-strip">
      <MetricCard label="Résultat net" value={formatR(totals.totalR)} detail={`${totals.activeDays} jours actifs`} tone={tone(totals.totalR)}/>
      <MetricCard label="Trades" value={totals.trades} detail={`${totals.wins} W · ${totals.losses} L · ${totals.flats} flat`}/>
      <MetricCard label="Win rate" value={formatPercent(totals.winRate)} detail={`${totals.winningDays} jours gagnants`}/>
      <MetricCard label="Expectancy" value={formatNullableR(totals.expectancyR)} tone={tone(totals.expectancyR)}/>
      <MetricCard label="Max drawdown" value={formatR(totals.maxDrawdownR)} detail={`Actuel ${formatR(totals.currentDrawdownR)}`} tone={totals.maxDrawdownR < 0 ? "critical" : "neutral"}/>
      <MetricCard label="Profit factor" value={totals.profitFactor === null ? "∞" : totals.profitFactor.toFixed(2)} detail={`${formatR(totals.grossProfitR)} / ${formatR(-totals.grossLossR)}`}/>
    </MetricStrip>

    <Card className="performance-filter-bar" aria-label="Filtres de performance">
      <FilterSelect label="Stratégie" value={rawFilters.strategyId} values={data.facets.strategies} onChange={value => setFilter("strategy", value)}/>
      <FilterSelect label="Session" value={rawFilters.session} values={data.facets.sessions} onChange={value => setFilter("session", value)} format={shortLabel}/>
      <FilterSelect label="Instrument" value={rawFilters.instrument} values={data.facets.instruments} onChange={value => setFilter("instrument", value)}/>
      <FilterSelect label="Direction" value={rawFilters.direction} values={data.facets.directions} onChange={value => setFilter("direction", value)} format={shortLabel}/>
      <label><span>Du</span><input aria-label="Performance depuis" type="date" value={rawFilters.from} min={data.facets.dateRange.from || undefined} max={data.facets.dateRange.to || undefined} onChange={event => setFilter("from", event.target.value)}/></label>
      <label><span>Au</span><input aria-label="Performance jusqu’au" type="date" value={rawFilters.to} min={data.facets.dateRange.from || undefined} max={data.facets.dateRange.to || undefined} onChange={event => setFilter("to", event.target.value)}/></label>
      <div className="performance-filter-bar__result"><strong>{totals.trades}</strong><span>trades</span>{hasFilters && <button className="text-btn" onClick={clearFilters}>Réinitialiser</button>}</div>
    </Card>

    {isEmpty ? <Card className="workspace-empty performance-empty-state"><span className="terminal-code">{hasFilters ? "NO_MATCHING_PERFORMANCE" : "NO_PERFORMANCE_MATERIALIZED"}</span><h3>{hasFilters ? "Aucun résultat pour ces filtres" : "Pas encore de résultat matérialisé"}</h3><p>Cette vue lit les trades, bilans journaliers et courbes d’equity persistés. Aucune performance n’est simulée côté frontend.</p>{hasFilters && <button className="secondary-btn" onClick={clearFilters}>Effacer les filtres</button>}</Card> : <>
      <div className="performance-workbench-v3">
        <PerformanceEquityChart points={data.equity}/>
        <PerformanceRiskRail data={data}/>
      </div>
      <DailyPerformanceTable days={data.dailySeries} equity={data.equity} runs={data.relatedRuns}/>
      <PerformanceBreakdowns groups={data.breakdowns}/>
      <RelatedRunsTable runs={data.relatedRuns}/>
    </>}
  </section>;
}

function FilterSelect({ label, value, values, onChange, format = value => value }: { label: string; value: string; values: string[]; onChange: (value: string) => void; format?: (value: string) => string }) {
  return <label><span>{label}</span><select aria-label={`Filtrer par ${label.toLowerCase()}`} value={value} onChange={event => onChange(event.target.value)}><option value="">Tous</option>{values.map(item => <option key={item} value={item}>{format(item)}</option>)}</select></label>;
}

function PerformanceEquityChart({ points }: { points: PerformanceEquityPoint[] }) {
  const model = useMemo(() => equityChartModel(points), [points]);
  return <Card className="performance-equity-panel">
    <header><div><p className="eyebrow">Courbe cumulée</p><h2>Equity & drawdown</h2></div><div className="performance-chart-legend"><span><i data-series="equity"/>Equity R</span><span><i data-series="drawdown"/>Drawdown</span></div></header>
    {!points.length ? <div className="performance-chart-empty"><Icon name="chart"/><strong>Aucun point d’equity</strong><p>La série apparaîtra après matérialisation d’un trade ou d’un bilan journalier.</p></div> : <svg viewBox="0 0 1000 340" preserveAspectRatio="none" role="img" aria-label="Courbe d’equity et drawdown">
      {[0, 1, 2, 3, 4].map(index => <g key={index}><line className="performance-grid-line" x1="70" x2="980" y1={28 + index * 48} y2={28 + index * 48}/><text x="8" y={33 + index * 48}>{(model.max - model.spread * index / 4).toFixed(2)} R</text></g>)}
      <line className="performance-zero-line" x1="70" x2="980" y1={model.zeroY} y2={model.zeroY}/>
      <path className="performance-equity-area" d={model.area}/><path className="performance-equity-line" d={model.line}/>
      {model.points.map(point => <g key={`${point.source.sequence}:${point.x}`}><circle className="performance-equity-point" cx={point.x} cy={point.y} r="4"><title>{`${point.source.date || "—"} · ${formatR(point.source.cumulativeR)}`}</title></circle></g>)}
      <line className="performance-drawdown-baseline" x1="70" x2="980" y1="250" y2="250"/>
      <path className="performance-drawdown-area" d={model.drawdownArea}/><path className="performance-drawdown-line" d={model.drawdownLine}/>
      <text x="8" y="255">DD 0</text><text x="8" y="320">{model.minDrawdown.toFixed(2)} R</text>
      <text x="70" y="337">{points[0]?.date || "—"}</text><text x="900" y="337">{points.at(-1)?.date || "—"}</text>
    </svg>}
    <footer><span>Source · trades/equity PostgreSQL</span><strong>{points.length} points matérialisés</strong></footer>
  </Card>;
}

function PerformanceRiskRail({ data }: { data: PerformanceOverview }) {
  const totals = data.totals;
  return <aside className="performance-risk-rail">
    <Card><header><p className="eyebrow">Risk tape</p><span className="terminal-counter">{totals.trades}</span></header><dl className="performance-risk-list"><dt>Gain brut</dt><dd className="positive">{formatR(totals.grossProfitR)}</dd><dt>Perte brute</dt><dd className="negative">{formatR(-totals.grossLossR)}</dd><dt>Meilleur trade</dt><dd>{formatNullableR(totals.bestTradeR)}</dd><dt>Pire trade</dt><dd>{formatNullableR(totals.worstTradeR)}</dd><dt>Meilleure journée</dt><dd>{formatNullableR(totals.bestDayR)}</dd><dt>Pire journée</dt><dd>{formatNullableR(totals.worstDayR)}</dd></dl></Card>
    <Card><header><p className="eyebrow">Research scope</p><span>CANONICAL</span></header><dl className="performance-risk-list"><dt>Période source</dt><dd>{data.facets.dateRange.from || "—"}</dd><dt>Dernier jour</dt><dd>{data.facets.dateRange.to || "—"}</dd><dt>Stratégies</dt><dd>{data.facets.strategies.length}</dd><dt>Sessions</dt><dd>{data.facets.sessions.length}</dd><dt>Runs liés</dt><dd>{data.relatedRuns.length}</dd><dt>Mise à jour</dt><dd>{new Date(data.generatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</dd></dl></Card>
  </aside>;
}

function DailyPerformanceTable({ days, equity, runs }: { days: PerformanceDailyPoint[]; equity: PerformanceEquityPoint[]; runs: PerformanceOverview["relatedRuns"] }) {
  const equityByDay = new Map<string, PerformanceEquityPoint>();
  equity.forEach(point => point.date && equityByDay.set(point.date, point));
  return <section className="replay-terminal-section performance-daily-section"><header><div><p className="eyebrow">Distribution temporelle</p><h2>Journées matérialisées</h2></div><span>{days.length} séances agrégées</span></header>
    <div className="data-table-wrap"><table className="data-table performance-daily-table"><thead><tr><th>Date</th><th>Résultat</th><th>Trades</th><th>Win rate</th><th>Equity clôture</th><th>Drawdown</th><th>Stratégies</th><th>Sessions</th><th/></tr></thead><tbody>{[...days].reverse().map(day => {
      const point = equityByDay.get(day.date);
      const run = (day.runIds.length ? runs.find(item => day.runIds.includes(item.sourceId)) : undefined) || runs.find(item => item.tradingDate === day.date);
      return <tr key={day.date}><td data-label="Date"><strong>{day.date}</strong><small>{day.source}</small></td><td data-label="Résultat" className={tone(day.totalR)}><strong>{formatR(day.totalR)}</strong><ResultBar value={day.totalR} max={Math.max(1, ...days.map(item => Math.abs(item.totalR)))}/></td><td data-label="Trades">{day.trades}<small>{day.wins} W · {day.losses} L</small></td><td data-label="Win rate">{formatPercent(day.winRate)}</td><td data-label="Equity">{point ? formatR(point.cumulativeR) : "—"}</td><td data-label="Drawdown" className={tone(point?.drawdownR)}>{point ? formatR(point.drawdownR) : "—"}</td><td data-label="Stratégies">{day.strategyIds.join(", ") || "—"}</td><td data-label="Sessions">{day.sessions.map(shortLabel).join(", ") || "—"}</td><td data-label="Action">{run ? <Link className="row-link" to={`/replay/runs/${encodeURIComponent(run.sourceId)}/days/${day.date}`}>Replay <Icon name="arrow" size={13}/></Link> : <span className="muted-copy">—</span>}</td></tr>;
    })}</tbody></table></div>
  </section>;
}

function PerformanceBreakdowns({ groups }: { groups: PerformanceOverview["breakdowns"] }) {
  const visible = groups.filter(group => group.dimension !== "day" && group.items.length);
  if (!visible.length) return null;
  return <section className="performance-breakdown-terminal"><header><div><p className="eyebrow">Attribution</p><h2>Ventilations comparées</h2></div><span>{visible.length} dimensions</span></header><div className="performance-breakdown-matrix">{visible.map(group => <div key={group.dimension}><header><strong>{dimensionLabel(group.dimension)}</strong><span>{group.items.length}</span></header>{group.items.slice(0, 12).map(item => <BreakdownRow key={item.label} dimension={group.dimension} item={item}/>)}</div>)}</div></section>;
}

function BreakdownRow({ dimension, item }: { dimension: string; item: PerformanceBreakdownItem }) {
  const label = dimension === "strategy" && item.label !== "unknown" ? <Link to={`/strategies/${encodeURIComponent(item.label)}`}>{item.label}</Link> : shortLabel(item.label);
  return <div className="performance-breakdown-row"><span>{label}</span><strong className={tone(item.totalR)}>{formatR(item.totalR)}</strong><small>{item.trades} T · {formatPercent(item.winRate ?? null)}</small></div>;
}

function RelatedRunsTable({ runs }: { runs: PerformanceOverview["relatedRuns"] }) {
  if (!runs.length) return null;
  return <section className="replay-terminal-section performance-related-runs"><header><div><p className="eyebrow">Traçabilité</p><h2>Runs Replay sur la période</h2></div><span>{runs.length} exécutions liées par date/stratégie/session</span></header><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Run</th><th>Date / session</th><th>Stratégie</th><th>État</th><th>Progression</th><th>Résultat</th><th/></tr></thead><tbody>{runs.map(run => <tr key={run.id}><td data-label="Run"><strong>{run.sourceId}</strong><small>{run.variantId || run.kind}</small></td><td data-label="Date"><strong>{run.tradingDate || "—"}</strong><small>{shortLabel(run.session || "global")}</small></td><td data-label="Stratégie">{run.strategyId ? <Link className="row-link" to={`/strategies/${encodeURIComponent(run.strategyId)}`}>{run.strategyId}</Link> : "—"}</td><td data-label="État"><StatusTag status={run.status}/></td><td data-label="Progression"><ProgressBar value={run.progress} status={run.status}/></td><td data-label="Résultat" className={tone(Number(run.metrics.totalR || 0))}>{formatR(Number(run.metrics.totalR || 0))}</td><td data-label="Action"><Link className="row-link" to={`/replay/runs/${encodeURIComponent(run.sourceId)}`}>Inspecter <Icon name="arrow" size={13}/></Link></td></tr>)}</tbody></table></div></section>;
}

function ResultBar({ value, max }: { value: number; max: number }) {
  return <span className="performance-result-bar" aria-hidden="true"><i data-tone={value >= 0 ? "positive" : "negative"} style={{ width: `${Math.max(3, Math.abs(value) / max * 100)}%` }}/></span>;
}

function equityChartModel(points: PerformanceEquityPoint[]) {
  const values = points.map(point => Number(point.cumulativeR || 0));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const spread = Math.max(1, max - min);
  const x = (index: number) => 70 + index / Math.max(1, points.length - 1) * 910;
  const y = (value: number) => 220 - (value - min) / spread * 192;
  const coords = points.map((point, index) => ({ source: point, x: x(index), y: y(point.cumulativeR) }));
  const line = coords.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = line ? `${line} L ${coords.at(-1)?.x || 70} 220 L 70 220 Z` : "";
  const minDrawdown = Math.min(-0.01, ...points.map(point => Number(point.drawdownR || 0)));
  const ddY = (value: number) => 250 + Math.abs(value / minDrawdown) * 68;
  const ddCoords = points.map((point, index) => ({ x: x(index), y: ddY(point.drawdownR) }));
  const drawdownLine = ddCoords.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const drawdownArea = drawdownLine ? `${drawdownLine} L ${ddCoords.at(-1)?.x || 70} 250 L 70 250 Z` : "";
  return { min, max, spread, points: coords, line, area, zeroY: y(0), minDrawdown, drawdownLine, drawdownArea };
}

function formatR(value: number) { return `${value > 0 ? "+" : ""}${Number(value || 0).toFixed(2)} R`; }
function formatNullableR(value: number | null | undefined) { return value === null || value === undefined ? "—" : formatR(value); }
function formatPercent(value: number | null | undefined) { return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`; }
function tone(value: number | null | undefined) { return Number(value || 0) > 0 ? "positive" : Number(value || 0) < 0 ? "negative" : "neutral"; }
function shortLabel(value: string) { return value.replaceAll("_", " ").toUpperCase(); }
function dimensionLabel(value: string) { return ({ strategy: "Stratégies", session: "Sessions", instrument: "Instruments", direction: "Directions" } as Record<string, string>)[value] || value.toUpperCase(); }
````

### `src/pages/PerformanceCalendarPage.tsx`

````tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { deskApi } from "@/api/deskApi";
import { refreshPolicyMs } from "@/api/endpoints";
import { Card, Icon } from "@/components/common";
import { PageHeading } from "@/components/operations";
import { useDeskContext } from "@/context/DeskContext";
import type { PerformanceCalendarDay, PerformancePricingMode, PerformanceSummary } from "@/types";

const weekDays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const pricingLabels: Record<PerformancePricingMode, string> = {
  conservative: "Conservateur",
  middle: "Médian",
  optimistic: "Optimiste"
};

function parisToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function formatR(value: number | null | undefined) {
  const amount = Number(value || 0);
  return `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${Math.abs(amount).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} R`;
}

function rTone(value: number | null | undefined) {
  return Number(value || 0) > 0 ? "positive" : Number(value || 0) < 0 ? "negative" : "flat";
}

function formatPercent(value: number | null | undefined) {
  return value == null ? "—" : `${(value * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

function valueOf(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "—";
}

function DaySummary({ summary }: { summary?: PerformanceSummary }) {
  return <div className="performance-summary-grid">
    <Card className={`performance-kpi performance-kpi--${rTone(summary?.total_R)}`}><span>Résultat</span><strong>{formatR(summary?.total_R)}</strong><small>sur le mois</small></Card>
    <Card className="performance-kpi"><span>Trades clôturés</span><strong>{summary?.closed_trades ?? 0}</strong><small>{summary?.wins ?? 0} gagnants · {summary?.losses ?? 0} perdants</small></Card>
    <Card className="performance-kpi"><span>Taux de réussite</span><strong>{formatPercent(summary?.win_rate)}</strong><small>expectancy {formatR(summary?.expectancy_R)}</small></Card>
    <Card className="performance-kpi"><span>Drawdown max</span><strong>{formatR(summary?.max_drawdown_R)}</strong><small>sur la période</small></Card>
  </div>;
}

export default function PerformanceCalendarPage() {
  const { sessionId } = useDeskContext();
  const today = parisToday();
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [pricingMode, setPricingMode] = useState<PerformancePricingMode>("conservative");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const calendarQuery = useQuery({
    queryKey: ["performance-calendar", sessionId, cursor.year, cursor.month, pricingMode],
    queryFn: () => deskApi.getPerformanceCalendar(sessionId, cursor.year, cursor.month, pricingMode),
    staleTime: refreshPolicyMs.performance,
    refetchInterval: refreshPolicyMs.performance
  });
  const dayQuery = useQuery({
    queryKey: ["performance-day", sessionId, selectedDate, pricingMode],
    queryFn: () => deskApi.getPerformanceDay(sessionId, selectedDate!, pricingMode),
    enabled: Boolean(selectedDate),
    staleTime: 15_000,
    refetchInterval: selectedDate ? refreshPolicyMs.performance : false
  });

  const monthLabel = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(cursor.year, cursor.month - 1, 1)));
  const leading = (new Date(Date.UTC(cursor.year, cursor.month - 1, 1)).getUTCDay() + 6) % 7;
  const cells = useMemo(() => [...Array.from({ length: leading }, () => null), ...(calendarQuery.data?.calendar.days || [])], [calendarQuery.data, leading]);
  const selectedDay = calendarQuery.data?.calendar.days.find(day => day.date === selectedDate);

  const moveMonth = (delta: number) => {
    const next = new Date(Date.UTC(cursor.year, cursor.month - 1 + delta, 1));
    setCursor({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 });
    setSelectedDate(null);
  };

  return <section className="view performance-view">
    <PageHeading eyebrow="Performance" title="Calendrier des performances" subtitle="Résultat net quotidien en R · cliquez sur une date pour ouvrir la journée"/>

    <div className="performance-toolbar">
      <div className="performance-month-nav">
        <button className="icon-btn performance-prev" onClick={() => moveMonth(-1)} aria-label="Mois précédent"><Icon name="arrow"/></button>
        <strong>{monthLabel}</strong>
        <button className="icon-btn" onClick={() => moveMonth(1)} aria-label="Mois suivant"><Icon name="arrow"/></button>
      </div>
      <div className="performance-pricing" aria-label="Mode de calcul">
        {(Object.keys(pricingLabels) as PerformancePricingMode[]).map(mode => <button key={mode} className={pricingMode === mode ? "active" : ""} onClick={() => setPricingMode(mode)}>{pricingLabels[mode]}</button>)}
      </div>
    </div>

    {calendarQuery.isLoading ? <Card className="performance-loading">Chargement du calendrier…</Card> : calendarQuery.isError ? <Card className="performance-error"><Icon name="alert"/><div><strong>Calendrier indisponible</strong><p>{calendarQuery.error.message}</p></div><button className="text-btn" onClick={() => calendarQuery.refetch()}>Réessayer</button></Card> : <>
      <DaySummary summary={calendarQuery.data?.calendar.summary}/>
      <Card className="performance-calendar-card">
        <div className="performance-weekdays">{weekDays.map(day => <span key={day}>{day}</span>)}</div>
        <div className="performance-calendar-grid">
          {cells.map((day, index) => day ? <CalendarDay key={day.date} day={day} today={today} onClick={() => setSelectedDate(day.date)}/> : <span className="performance-day-placeholder" key={`empty-${index}`}/>) }
        </div>
        <footer className="performance-legend"><span><i className="positive"/>Gain</span><span><i className="negative"/>Perte</span><span><i className="flat"/>Flat / sans trade</span></footer>
      </Card>
    </>}

    {selectedDate && <Card className="performance-master-detail" aria-live="polite">
      <header><div><p className="eyebrow">Détail de la journée</p><h2>{new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${selectedDate}T12:00:00Z`))}</h2></div><button className="icon-btn" onClick={() => setSelectedDate(null)} aria-label="Fermer le détail de la journée"><Icon name="close"/></button></header>
      {dayQuery.isLoading ? <div className="performance-day-loading">Chargement de la journée…</div> : dayQuery.isError ? <div className="performance-day-loading">Impossible de charger le détail.<button className="text-btn" onClick={() => dayQuery.refetch()}>Réessayer</button></div> : dayQuery.data ? <DayZoom day={dayQuery.data.day} calendarDay={selectedDay}/> : null}
    </Card>}
  </section>;
}

function CalendarDay({ day, today, onClick }: { day: PerformanceCalendarDay; today: string; onClick: () => void }) {
  const hasActivity = day.has_trade || day.closed_trades > 0 || day.has_open_position;
  return <button className={`performance-day performance-day--${rTone(day.total_R)} ${hasActivity ? "has-activity" : "is-empty"} ${day.date === today ? "is-today" : ""}`} onClick={onClick}>
    <span className="performance-day__number">{Number(day.date.slice(-2))}</span>
    <strong>{hasActivity ? formatR(day.total_R) : "—"}</strong>
    <small>{day.has_open_position ? "Position ouverte" : day.closed_trades ? `${day.closed_trades} trade${day.closed_trades > 1 ? "s" : ""}` : day.setup_count ? `${day.setup_count} setup${day.setup_count > 1 ? "s" : ""}` : "Sans trade"}</small>
  </button>;
}

function DayZoom({ day, calendarDay }: { day: Awaited<ReturnType<typeof deskApi.getPerformanceDay>>["day"]; calendarDay?: PerformanceCalendarDay }) {
  const summary = day.performance.summary;
  const totalR = summary?.total_R ?? calendarDay?.total_R ?? 0;
  return <div className="performance-day-zoom">
    <div className={`performance-day-result performance-day-result--${rTone(totalR)}`}><span>Résultat de la journée</span><strong>{formatR(totalR)}</strong><small>Mode {pricingLabels[day.pricing_mode]}</small></div>
    <div className="performance-day-stats"><div><span>Trades</span><strong>{summary?.closed_trades ?? day.trades.length}</strong></div><div><span>Gagnants</span><strong>{summary?.wins ?? 0}</strong></div><div><span>Perdants</span><strong>{summary?.losses ?? 0}</strong></div><div><span>Win rate</span><strong>{formatPercent(summary?.win_rate)}</strong></div></div>

    {day.master && <section className="performance-detail-section"><p className="eyebrow">Plan Master</p><h3>{valueOf(day.master, "decision", "status")}</h3><p>{valueOf(day.master, "summary", "dominant_scenario", "macro_thesis")}</p></section>}

    <section className="performance-detail-section"><p className="eyebrow">Trades</p>{day.trades.length ? <div className="performance-trades">{day.trades.map((trade, index) => <div className="performance-trade" key={valueOf(trade, "trade_id", "id") + index}><div><strong>{valueOf(trade, "instrument", "symbol")}</strong><span>{valueOf(trade, "direction", "side")} · {valueOf(trade, "status")}</span></div><strong className={`r-${rTone(Number(trade.result_R || 0))}`}>{formatR(Number(trade.result_R || 0))}</strong></div>)}</div> : <p className="performance-empty-detail">Aucun trade enregistré pour cette journée.</p>}</section>

    {!!day.setups.length && <section className="performance-detail-section"><p className="eyebrow">Setups</p><div className="performance-trades">{day.setups.map((setup, index) => <div className="performance-trade" key={valueOf(setup, "setup_id", "id") + index}><div><strong>{valueOf(setup, "instrument", "label")}</strong><span>{valueOf(setup, "direction")} · {valueOf(setup, "status", "lifecycle_status")}</span></div><span>{valueOf(setup, "setup_type", "label")}</span></div>)}</div></section>}

    {!!day.timeline.length && <section className="performance-detail-section"><p className="eyebrow">Chronologie</p><div className="performance-day-timeline">{day.timeline.map((event, index) => <div key={index}><time>{valueOf(event, "time").slice(11, 16)}</time><span><strong>{valueOf(event, "type")}</strong>{valueOf(event, "title")}</span></div>)}</div></section>}
  </div>;
}
````

### `src/pages/ReplayComparePage.tsx`

````tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, MetricCard, MetricStrip, PageHeading, PageTabs, ProgressBar, StatusTag } from "@/components/operations";
import { operationsKeys, useReplays } from "@/hooks/useOperations";

export default function ReplayComparePage() {
  const replays = useReplays();
  const [selected, setSelected] = useState<string[]>([]);
  const comparison = useQuery({ queryKey: [...operationsKeys.replays, "compare", selected], queryFn: () => operationsApi.compareReplays(selected), enabled: selected.length >= 2 });
  const selectedItems = useMemo(() => replays.data?.items.filter(item => selected.includes(item.sourceId)) || [], [replays.data, selected]);
  if (replays.isLoading) return <LoadingView/>;
  if (replays.isError || !replays.data) return <ErrorView message={replays.error?.message || "Comparateur indisponible"} retry={() => replays.refetch()}/>;
  const toggle = (id: string) => setSelected(value => value.includes(id) ? value.filter(item => item !== id) : value.length < 8 ? [...value, id] : value);
  const baselineR = Number(selectedItems[0]?.metrics.totalR || 0);
  const results = selectedItems.map(item => Number(item.metrics.totalR || 0));
  const averageR = results.length ? results.reduce((total, value) => total + value, 0) / results.length : 0;
  return <section className="view workspace-view replay-compare-v3">
    <Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: "Comparaison" }]}/><PageHeading eyebrow="Comparison workstation" title="Comparer les exécutions" subtitle="Jusqu’à huit variantes ou tentatives, calculées par le backend canonique." backTo="/replay" tabs={<PageTabs items={[{ label: "Vue globale", to: "/replay", end: true }, { label: "Comparaison", to: "/replay/compare" }]}/>}/>
    <Card className="workspace-panel comparison-selector-v3"><header><div><p className="eyebrow">Univers disponible</p><h2>Sélection · {selected.length}/8</h2></div>{selected.length > 0 && <button className="text-btn" onClick={() => setSelected([])}>Tout effacer</button>}</header><div className="comparison-picker">{replays.data.items.map(item => <label key={item.id} className={selected.includes(item.sourceId) ? "selected" : ""}><input type="checkbox" checked={selected.includes(item.sourceId)} onChange={() => toggle(item.sourceId)}/><div><strong>{item.tradingDate} · {item.session || item.kind}</strong><small>{item.variantId || item.sourceId}</small></div><StatusTag status={item.status}/></label>)}</div></Card>
    {selected.length < 2 ? <Card className="workspace-empty"><span className="terminal-code">SELECT_2_TO_8_RUNS</span><h3>Sélectionnez au moins deux runs</h3><p>La matrice sera demandée au backend dès que deux exécutions seront cochées.</p></Card> : comparison.isLoading ? <LoadingView/> : comparison.isError ? <ErrorView message={comparison.error.message} retry={() => comparison.refetch()}/> : <>
      <MetricStrip className="metric-grid--compact replay-summary-strip"><MetricCard label="Runs comparés" value={selectedItems.length}/><MetricCard label="Meilleur résultat" value={`${Math.max(...results).toFixed(2)} R`} tone="positive"/><MetricCard label="Résultat moyen" value={`${averageR.toFixed(2)} R`} tone={averageR >= 0 ? "positive" : "negative"}/><MetricCard label="Écart max/min" value={`${(Math.max(...results) - Math.min(...results)).toFixed(2)} R`}/><MetricCard label="Terminés" value={selectedItems.filter(item => item.status === "completed").length}/><MetricCard label="Processus GPT" value={selectedItems.reduce((total, item) => total + Number(item.metrics.gptProcesses || 0), 0)}/></MetricStrip>
      <section className="replay-terminal-section"><header><div><p className="eyebrow">Comparaison canonique</p><h2>Matrice comparative</h2></div><span>Référence · première ligne sélectionnée</span></header><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Run</th><th>État</th><th>Progression</th><th>Résultat</th><th>Δ référence</th><th>Étapes</th><th>GPT</th></tr></thead><tbody>{selectedItems.map(item => {
        const resultR = Number(item.metrics.totalR || 0);
        const delta = resultR - baselineR;
        return <tr key={item.id}><td data-label="Run"><strong>{item.tradingDate} · {item.session}</strong><small>{item.variantId}</small></td><td data-label="État"><StatusTag status={item.status}/></td><td data-label="Progression"><ProgressBar value={item.progress} status={item.status}/></td><td data-label="Résultat" className={resultR >= 0 ? "positive" : "negative"}><strong>{resultR.toFixed(2)} R</strong></td><td data-label="Delta" className={delta >= 0 ? "positive" : "negative"}>{delta >= 0 ? "+" : ""}{delta.toFixed(2)} R</td><td data-label="Étapes">{item.metrics.stepsDone || 0}/{item.metrics.stepsTotal || 0}</td><td data-label="GPT">{item.metrics.gptProcesses || 0}</td></tr>;
      })}</tbody></table></div></section>
    </>}
  </section>;
}
````

### `src/pages/ReplayDayPage.tsx`

````tsx
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { Breadcrumbs, EventTimeline, formatDateTime, MetricCard, MetricStrip, PageHeading, ProgressBar, StatusTag } from "@/components/operations";
import { useReplayDay } from "@/hooks/useOperations";
import type { OperationsEvent, WorkflowSummary } from "@/operationsTypes";

export default function ReplayDayPage() {
  const { runId = "", date = "" } = useParams();
  const id = decodeURIComponent(runId);
  const query = useReplayDay(id, date);
  const [sessionFilter, setSessionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [variantFilter, setVariantFilter] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<OperationsEvent | null>(null);

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Journée introuvable"} retry={() => query.refetch()}/>;

  const day = query.data;
  const sessions = day.sessions.filter(item =>
    (!sessionFilter || item.session === sessionFilter) &&
    (!statusFilter || item.status === statusFilter) &&
    (!variantFilter || item.variantId === variantFilter)
  );
  const lanes = groupSessions(day.sessions);
  const statusCounts = countValues(day.sessions.map(item => item.status));
  const sessionOptions = [...new Set(day.sessions.map(item => item.session).filter(Boolean))] as string[];

  return <section className="view workspace-view replay-day-v3">
    <Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: id, to: `/replay/runs/${encodeURIComponent(id)}` }, { label: day.date }]}/>
    <PageHeading eyebrow="Trading day workstation" title={day.date} subtitle={`${day.sessions.length} exécutions · ${day.variants.length} variantes · données PostgreSQL`} backTo="/replay" actions={<StatusTag status={day.status}/>}/>

    <MetricStrip className="metric-grid--compact replay-summary-strip">
      <MetricCard label="Exécutions" value={day.metrics.sessionCount} detail={`${sessionOptions.length} sessions`}/>
      <MetricCard label="Variantes" value={day.variants.length}/>
      <MetricCard label="Progression moy." value={`${day.metrics.progress}%`}/>
      <MetricCard label="Résultat cumulé" value={`${day.metrics.totalR.toFixed(2)} R`} tone={day.metrics.totalR >= 0 ? "positive" : "negative"}/>
      <MetricCard label="Processus GPT" value={day.metrics.gptProcesses || 0} detail={`${day.metrics.gptWaiting || 0} attente`}/>
      <MetricCard label="Échecs / bloqués" value={`${day.metrics.gptFailed || statusCounts.failed || 0} / ${statusCounts.blocked || 0}`} tone={day.metrics.gptFailed || statusCounts.failed || statusCounts.blocked ? "critical" : "neutral"}/>
    </MetricStrip>

    <section className="replay-terminal-section">
      <header><div><p className="eyebrow">Carte des exécutions</p><h2>Sessions et tentatives</h2></div><span>Une ligne par session métier</span></header>
      <div className="replay-session-lanes">{Object.entries(lanes).map(([session, items]) => <div className="replay-session-lane" key={session}>
        <div><strong>{sessionLabel(session)}</strong><small>{items.length} tentative{items.length > 1 ? "s" : ""}</small></div>
        <div className="replay-session-lane__track">{items.map(item => <Link key={item.id} data-status={item.status} to={sessionUrl(id, day.date, item)} title={`${item.sourceId} · ${item.status}`}>
          <span>#{item.attempt || 1}</span><i/><small>{item.variantId || "default"}</small>
        </Link>)}</div>
        <div className="replay-session-lane__result"><strong>{items.reduce((total, item) => total + Number(item.metrics.totalR || 0), 0).toFixed(2)} R</strong><small>{Math.round(items.reduce((total, item) => total + item.progress, 0) / items.length)}%</small></div>
      </div>)}</div>
    </section>

    <div className="replay-day-intelligence-grid">
      <Card className="replay-day-gpt-panel">
        <header><div><p className="eyebrow">Processus GPT</p><h2>État par session</h2></div><span>{day.gptProcesses?.length || 0}</span></header>
        {!day.gptProcesses?.length ? <div className="terminal-empty-state"><span>NO_GPT_PROCESS</span><small>Aucun processus GPT matérialisé sur cette journée.</small></div> : <div className="replay-day-gpt-list">{day.gptProcesses.map((process) => <Link key={process.id} to={`/replay/runs/${encodeURIComponent(process.runId || id)}/gpt/${encodeURIComponent(process.id)}`}>
          <span>{process.workflow}</span><strong>{process.id}</strong><small>{process.worker || "worker non assigné"}</small><StatusTag status={process.status}/>
        </Link>)}</div>}
      </Card>
      <Card className="replay-day-conclusion-panel">
        <header><div><p className="eyebrow">Conclusions GPT</p><h2>Dernières synthèses</h2></div><span>{day.conclusions?.length || 0}</span></header>
        {!day.conclusions?.length ? <p className="muted-copy">Aucune conclusion GPT persistée.</p> : <div>{day.conclusions.map((item) => <blockquote key={`${item.runId}:${item.processId}`}><span>{formatDateTime(item.at)}</span>{item.conclusion}</blockquote>)}</div>}
      </Card>
    </div>

    <Card className="replay-day-filters">
      <label><span>Session</span><select aria-label="Filtrer les exécutions par session" value={sessionFilter} onChange={event => setSessionFilter(event.target.value)}><option value="">Toutes</option>{sessionOptions.map(value => <option value={value} key={value}>{sessionLabel(value)}</option>)}</select></label>
      <label><span>État</span><select aria-label="Filtrer les exécutions par état" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">Tous</option>{Object.keys(statusCounts).map(value => <option value={value} key={value}>{value}</option>)}</select></label>
      <label><span>Variante</span><select aria-label="Filtrer les exécutions par variante" value={variantFilter} onChange={event => setVariantFilter(event.target.value)}><option value="">Toutes</option>{day.variants.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
      <div><strong>{sessions.length}</strong><span>lignes visibles</span>{(sessionFilter || statusFilter || variantFilter) && <button className="text-btn" onClick={() => { setSessionFilter(""); setStatusFilter(""); setVariantFilter(""); }}>Réinitialiser</button>}</div>
    </Card>

    <section className="replay-terminal-section">
      <header><div><p className="eyebrow">Matrice détaillée</p><h2>Sessions, variantes et tentatives</h2></div><span>Navigation sans empilement</span></header>
      <div className="data-table-wrap"><table className="data-table replay-session-table">
        <thead><tr><th>Session</th><th>Stratégie</th><th>Variante</th><th>Tentative</th><th>État</th><th>Progression</th><th>Résultat</th><th>GPT</th><th>Mise à jour</th><th/></tr></thead>
        <tbody>{sessions.map(session => <tr key={session.id}>
          <td data-label="Session"><strong>{sessionLabel(session.session || "globale")}</strong><small>{session.sessionExecutionId}</small></td>
          <td data-label="Stratégie">{session.strategyId || "—"}</td>
          <td data-label="Variante"><span className="mono">{session.variantId || "default"}</span></td>
          <td data-label="Tentative"><strong>#{session.attempt || 1}</strong></td>
          <td data-label="État"><StatusTag status={session.status}/></td>
          <td data-label="Progression"><ProgressBar value={session.progress} status={session.status}/></td>
          <td data-label="Résultat" className={Number(session.metrics.totalR || 0) >= 0 ? "positive" : "negative"}><strong>{Number(session.metrics.totalR || 0).toFixed(2)} R</strong></td>
          <td data-label="GPT">{Number(session.metrics.gptProcesses || 0)}</td>
          <td data-label="Mise à jour"><time>{formatDateTime(session.updatedAt)}</time></td>
          <td data-label="Action"><Link className="row-link" to={sessionUrl(id, day.date, session)}>Inspecter <Icon name="arrow" size={13}/></Link></td>
        </tr>)}</tbody>
      </table></div>
      {!sessions.length && <div className="terminal-empty-state"><span>NO_SESSION_MATCH</span><small>Aucune exécution ne correspond aux filtres actifs.</small></div>}
    </section>

    <section className="replay-terminal-section replay-day-timeline-section">
      <header><div><p className="eyebrow">Timeline consolidée journée</p><h2>Décisions, étapes et GPT</h2></div><span>{day.timeline?.length || 0} événements</span></header>
      <EventTimeline events={day.timeline || []} runId={id} selectedId={selectedEvent?.id} onSelect={setSelectedEvent}/>
    </section>
  </section>;
}

function sessionUrl(parent: string, date: string, session: WorkflowSummary) {
  return `/replay/runs/${encodeURIComponent(parent)}/days/${date}/sessions/${encodeURIComponent(session.sessionExecutionId || session.sourceId)}`;
}

function groupSessions(items: WorkflowSummary[]) {
  return items.reduce<Record<string, WorkflowSummary[]>>((output, item) => {
    const key = item.session || "globale";
    (output[key] ||= []).push(item);
    return output;
  }, {});
}

function countValues(values: string[]) {
  return values.reduce<Record<string, number>>((output, value) => ({ ...output, [value]: (output[value] || 0) + 1 }), {});
}

function sessionLabel(value: string) {
  return value === "asia_open" ? "Asia Open" : value === "ny_open" ? "NY Open" : value.replaceAll("_", " ");
}
````

### `src/pages/ReplayLabPage.tsx`

````tsx
import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, Drawer, ErrorView, Icon, LoadingView } from "@/components/common";
import { formatDateTime, MetricCard, MetricStrip, PageHeading, PageTabs, ProgressBar, StatusTag } from "@/components/operations";
import { operationsKeys, useReplays } from "@/hooks/useOperations";
import type { ReplayDaySummary, WorkflowSummary } from "@/operationsTypes";

type ReplayFilters = { q: string; status: string; session: string; strategyId: string; from: string; to: string };

const emptyFilters: ReplayFilters = { q: "", status: "", session: "", strategyId: "", from: "", to: "" };

export default function ReplayLabPage() {
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState<ReplayFilters>(emptyFilters);
  const deferredFilters = useDeferredValue(filters);
  const apiFilters = useMemo(() => ({
    q: deferredFilters.q || null,
    status: deferredFilters.status || null,
    session: deferredFilters.session || null,
    strategy_id: deferredFilters.strategyId || null,
    from: deferredFilters.from || null,
    to: deferredFilters.to || null,
    limit: 500,
  }), [deferredFilters]);
  const query = useReplays(apiFilters);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), session: "asia_open", strategyId: "asia_open", packId: "", packBuildId: "", start: "02:00", end: "10:00", cadence: "15m" });
  const create = useMutation({ mutationFn: () => {
    const suffix = `${form.date}_${form.session}_${Date.now()}`.replace(/[^a-zA-Z0-9]+/g, "_");
    return operationsApi.createReplay({ backtest_id: `replay_${suffix}`, strategy_id: form.strategyId, trading_date: form.date, date: form.date, session: form.session, pack_id: form.packId, pack_build_id: form.packBuildId, start_time: `${form.date}T${form.start}:00+02:00`, end_time: `${form.date}T${form.end}:00+02:00`, cadence: form.cadence, automation_enabled: true, idempotency_key: crypto.randomUUID() });
  }, onSuccess: async () => { setCreating(false); await client.invalidateQueries({ queryKey: operationsKeys.all }); } });

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Replay Lab indisponible"} retry={() => query.refetch()}/>;

  const { days, items } = query.data;
  const summary = query.data.summary || fallbackSummary(days, items);
  const hasFilters = Object.values(filters).some(Boolean);

  return <section className="view workspace-view replay-lab-v3">
    <PageHeading eyebrow="Research workstation" title="Replay Lab" subtitle="Journées, sessions, tentatives, décisions et processus GPT sur données persistées." actions={<><button className="primary-btn" onClick={() => setCreating(value => !value)}>Nouveau replay</button><Link className="secondary-btn" to="/replay/compare">Comparer</Link></>} tabs={<PageTabs items={[{ label: "Vue globale", to: "/replay", end: true }, { label: "Comparaison", to: "/replay/compare" }]}/>}/>
    <Drawer open={creating} title="Nouveau replay" onClose={() => !create.isPending && setCreating(false)}><div className="replay-create-drawer"><p className="muted-copy">Le pack et son build doivent déjà être prêts. La création est persistée et déclenche l’orchestration réelle.</p><div className="replay-create-form"><label>Date<input type="date" value={form.date} onChange={event => setForm(value => ({ ...value, date: event.target.value }))}/></label><label>Session<select value={form.session} onChange={event => setForm(value => ({ ...value, session: event.target.value, strategyId: event.target.value === "ny_open" ? "ny_open_1530" : "asia_open" }))}><option value="asia_open">Asia Open</option><option value="ny_open">NY Open</option></select></label><label>Stratégie<input value={form.strategyId} onChange={event => setForm(value => ({ ...value, strategyId: event.target.value }))}/></label><label>Pack ID<input value={form.packId} onChange={event => setForm(value => ({ ...value, packId: event.target.value }))}/></label><label>Pack build ID<input value={form.packBuildId} onChange={event => setForm(value => ({ ...value, packBuildId: event.target.value }))}/></label><div className="replay-create-form__row"><label>Début<input type="time" value={form.start} onChange={event => setForm(value => ({ ...value, start: event.target.value }))}/></label><label>Fin<input type="time" value={form.end} onChange={event => setForm(value => ({ ...value, end: event.target.value }))}/></label></div><label>Cadence<select value={form.cadence} onChange={event => setForm(value => ({ ...value, cadence: event.target.value }))}><option value="15m">15 min</option><option value="30m">30 min</option><option value="60m">60 min</option></select></label><div className="modal__actions"><button className="secondary-btn" onClick={() => setCreating(false)}>Annuler</button><button className="primary-btn" disabled={!form.packId || !form.packBuildId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Création…" : "Créer et démarrer"}</button></div></div>{create.isError && <p className="form-error">{create.error.message}</p>}</div></Drawer>

    <MetricStrip className="metric-grid--compact replay-summary-strip">
      <MetricCard label="Exécutions" value={summary.executions} detail={`${summary.days} journées`}/>
      <MetricCard label="Actives" value={summary.active} detail={`${summary.waitingGpt} attente GPT`} tone={summary.active ? "info" : "neutral"}/>
      <MetricCard label="Progression moy." value={`${Math.round(summary.averageProgress)}%`}/>
      <MetricCard label="Résultat cumulé" value={`${summary.totalR.toFixed(2)} R`} tone={summary.totalR >= 0 ? "positive" : "negative"}/>
      <MetricCard label="Processus GPT" value={summary.gptProcesses}/>
      <MetricCard label="Échecs" value={summary.failed} detail={`${summary.blocked} bloqués`} tone={summary.failed ? "critical" : "neutral"}/>
    </MetricStrip>

    <Card className="replay-filter-bar" aria-label="Filtres Replay Lab">
      <label className="replay-filter-search"><span>Recherche</span><div><Icon name="search" size={14}/><input aria-label="Rechercher un replay" placeholder="Run, stratégie, statut…" value={filters.q} onChange={event => setFilters(value => ({ ...value, q: event.target.value }))}/></div></label>
      <label><span>État</span><select aria-label="Filtrer par état" value={filters.status} onChange={event => setFilters(value => ({ ...value, status: event.target.value }))}><option value="">Tous</option><option value="running">En cours</option><option value="waiting_gpt">Attente GPT</option><option value="blocked">Bloqué</option><option value="failed">Échec</option><option value="completed">Terminé</option><option value="paused">En pause</option></select></label>
      <label><span>Session</span><select aria-label="Filtrer par session" value={filters.session} onChange={event => setFilters(value => ({ ...value, session: event.target.value }))}><option value="">Toutes</option><option value="asia_open">Asia Open</option><option value="ny_open">NY Open</option></select></label>
      <label><span>Stratégie</span><input aria-label="Filtrer par stratégie" placeholder="asia_open…" value={filters.strategyId} onChange={event => setFilters(value => ({ ...value, strategyId: event.target.value }))}/></label>
      <label><span>Du</span><input aria-label="Date de début" type="date" value={filters.from} onChange={event => setFilters(value => ({ ...value, from: event.target.value }))}/></label>
      <label><span>Au</span><input aria-label="Date de fin" type="date" value={filters.to} onChange={event => setFilters(value => ({ ...value, to: event.target.value }))}/></label>
      <div className="replay-filter-bar__result"><strong>{query.data.count}</strong><span>résultats</span>{hasFilters && <button className="text-btn" onClick={() => setFilters(emptyFilters)}>Réinitialiser</button>}</div>
    </Card>

    {!days.length ? <Card className="workspace-empty replay-empty-state"><span className="terminal-code">{hasFilters ? "NO_MATCHING_REPLAY" : "NO_REPLAY_MATERIALIZED"}</span><h3>{hasFilters ? "Aucun replay ne correspond aux filtres" : "Aucun replay enregistré"}</h3><p>Le Lab lit PostgreSQL directement. Aucun résultat, statut ou prix n’est simulé côté front.</p>{hasFilters && <button className="secondary-btn" onClick={() => setFilters(emptyFilters)}>Effacer les filtres</button>}</Card> : <>
      <ReplayEvolution days={days}/>
      <section className="replay-terminal-section">
        <header><div><p className="eyebrow">Vue consolidée</p><h2>Journées de backtest</h2></div><span>{days.length} journées · tri décroissant</span></header>
        <div className="data-table-wrap"><table className="data-table replay-overview-table">
          <thead><tr><th>Date</th><th>État</th><th>Sessions</th><th>Répartition</th><th>Progression</th><th>Résultat</th><th>Flux</th><th/></tr></thead>
          <tbody>{days.map(day => <ReplayDayRow key={day.date} day={day}/>)}</tbody>
        </table></div>
      </section>
      <section className="replay-terminal-section">
        <header><div><p className="eyebrow">Exécutions unitaires</p><h2>Runs, variantes et tentatives</h2></div><span>{items.length} lignes matérialisées</span></header>
        <div className="data-table-wrap"><table className="data-table replay-run-table">
          <thead><tr><th>Run</th><th>Session</th><th>Stratégie / variante</th><th>État</th><th>Progression</th><th>R</th><th>GPT</th><th>Mise à jour</th><th/></tr></thead>
          <tbody>{items.map(item => <ReplayRunRow key={item.id} item={item}/>)}</tbody>
        </table></div>
      </section>
    </>}
  </section>;
}

function ReplayEvolution({ days }: { days: ReplayDaySummary[] }) {
  const ordered = [...days].sort((left, right) => left.date.localeCompare(right.date));
  const maxAbsR = Math.max(1, ...ordered.map((day) => Math.abs(day.totalR || 0)));
  return <Card className="replay-evolution-panel">
    <header><div><p className="eyebrow">Évolution des backtests</p><h2>Journées, sessions et résultat R</h2></div><span>{ordered.length} points</span></header>
    <div className="replay-evolution-chart" role="img" aria-label="Évolution des journées de backtest">
      {ordered.map((day) => {
        const height = 12 + Math.round((Math.abs(day.totalR || 0) / maxAbsR) * 72);
        return <Link key={day.date} to={`/replay/runs/${encodeURIComponent(day.sessions[0]?.sourceId || "")}/days/${day.date}`} data-status={day.status} title={`${day.date} · ${day.totalR.toFixed(2)} R · ${day.sessionCount} sessions`}>
          <i style={{ height }} data-positive={day.totalR >= 0}/><span>{day.date.slice(5)}</span><strong>{day.sessionCount}</strong>
        </Link>;
      })}
    </div>
  </Card>;
}

function ReplayDayRow({ day }: { day: ReplayDaySummary }) {
  const sessionCounts = countValues(day.sessions.map(item => item.session || "global"));
  const gpt = day.sessions.reduce((total, item) => total + Number(item.metrics.gptProcesses || 0), 0);
  const parent = day.sessions[0]?.sourceId || "";
  return <tr>
    <td data-label="Date"><strong>{day.date}</strong><small>{day.sessionCount} exécutions</small></td>
    <td data-label="État"><StatusTag status={day.status}/></td>
    <td data-label="Sessions"><div className="replay-attempt-track" aria-label={`${day.sessionCount} exécutions`}>{day.sessions.slice(0, 12).map(session => <i key={session.id} data-status={session.status} title={`${session.session || "session"} · ${session.status}`}/>)}</div></td>
    <td data-label="Répartition"><div className="replay-session-counts">{Object.entries(sessionCounts).map(([label, count]) => <span key={label}>{shortSession(label)} <strong>{count}</strong></span>)}</div></td>
    <td data-label="Progression"><ProgressBar value={day.totalProgress} status={day.status}/></td>
    <td data-label="Résultat" className={day.totalR >= 0 ? "positive" : "negative"}><strong>{day.totalR.toFixed(2)} R</strong></td>
    <td data-label="Flux"><span className="mono">{gpt} GPT</span><small>{day.running} actifs · {day.failed} échecs</small></td>
    <td data-label="Action"><Link className="row-link" to={`/replay/runs/${encodeURIComponent(parent)}/days/${day.date}`}>Explorer <Icon name="arrow" size={13}/></Link></td>
  </tr>;
}

function ReplayRunRow({ item }: { item: WorkflowSummary }) {
  return <tr>
    <td data-label="Run"><strong>{item.sourceId}</strong><small>{item.tradingDate || "Date inconnue"}</small></td>
    <td data-label="Session"><strong>{shortSession(item.session || "global")}</strong><small>{item.attempt ? `Tentative #${item.attempt}` : item.kind}</small></td>
    <td data-label="Stratégie"><span>{item.strategyId || "—"}</span><small>{item.variantId || "default"}</small></td>
    <td data-label="État"><StatusTag status={item.status}/></td>
    <td data-label="Progression"><ProgressBar value={item.progress} status={item.status}/></td>
    <td data-label="Résultat" className={Number(item.metrics.totalR || 0) >= 0 ? "positive" : "negative"}>{Number(item.metrics.totalR || 0).toFixed(2)} R</td>
    <td data-label="GPT">{Number(item.metrics.gptProcesses || 0)}</td>
    <td data-label="Mise à jour"><time>{formatDateTime(item.updatedAt)}</time></td>
    <td data-label="Action"><Link className="row-link" to={`/replay/runs/${encodeURIComponent(item.sourceId)}`}>Ouvrir <Icon name="arrow" size={13}/></Link></td>
  </tr>;
}

function countValues(values: string[]) {
  return values.reduce<Record<string, number>>((output, value) => ({ ...output, [value]: (output[value] || 0) + 1 }), {});
}

function shortSession(value: string) {
  return value === "asia_open" ? "ASIA" : value === "ny_open" ? "NY" : value.replaceAll("_", " ").toUpperCase();
}

function fallbackSummary(days: ReplayDaySummary[], items: WorkflowSummary[]) {
  const totalR = items.reduce((total, item) => total + Number(item.metrics.totalR || 0), 0);
  return {
    executions: items.length, days: days.length,
    active: items.filter(item => ["running", "waiting_gpt", "blocked"].includes(item.status)).length,
    running: items.filter(item => item.status === "running").length,
    waitingGpt: items.filter(item => item.status === "waiting_gpt").length,
    blocked: items.filter(item => item.status === "blocked").length,
    failed: items.filter(item => item.status === "failed").length,
    completed: items.filter(item => item.status === "completed").length,
    averageProgress: items.length ? items.reduce((total, item) => total + item.progress, 0) / items.length : 0,
    totalR,
    gptProcesses: items.reduce((total, item) => total + Number(item.metrics.gptProcesses || 0), 0),
  };
}
````

### `src/pages/ReplayRunPage.tsx`

````tsx
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, EventTimeline, MetricCard, MetricStrip, PageHeading, ProgressBar, ReplayChart, StatusTag } from "@/components/operations";
import { useReplay } from "@/hooks/useOperations";
import type { OperationsEvent } from "@/operationsTypes";

export default function ReplayRunPage() {
  const { runId = "" } = useParams();
  const id = decodeURIComponent(runId);
  const query = useReplay(id);
  const [selected, setSelected] = useState<OperationsEvent | null>(null);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Replay introuvable"} retry={() => query.refetch()}/>;
  const data = query.data;
  return <section className="view workspace-view replay-run-v3">
    <Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: data.run.tradingDate || data.run.name }]}/>
    <PageHeading eyebrow="Exécution replay" title={data.run.name} subtitle={data.run.sourceId} backTo="/replay" actions={<StatusTag status={data.run.status}/>}/>
    <MetricStrip className="metric-grid--compact"><MetricCard label="Progression" value={`${data.run.progress}%`}/><MetricCard label="Étapes" value={`${data.run.metrics.stepsDone || 0}/${data.run.metrics.stepsTotal || 0}`}/><MetricCard label="Process GPT" value={data.gptProcesses.length}/><MetricCard label="Résultat" value={`${Number(data.run.metrics.totalR || 0).toFixed(2)} R`} tone={Number(data.run.metrics.totalR || 0) >= 0 ? "positive" : "negative"}/></MetricStrip>
    <ProgressBar value={data.run.progress}/>
    <div className="inline-actions"><Link className="primary-btn" to={`/replay/runs/${encodeURIComponent(id)}/days/${data.run.tradingDate}`}>Sessions de la journée</Link><Link className="secondary-btn" to={`/operations/workflows/${encodeURIComponent(data.run.id)}`}>Contrôler le workflow</Link></div>
    <div className="replay-session-context-strip"><span>RUN <strong>{id}</strong></span><span>SESSION <strong>{data.run.session || "—"}</strong></span><span>VARIANTE <strong>{data.run.variantId || "default"}</strong></span><span>SOURCE <strong>POSTGRES</strong></span></div>
    <div className="replay-session-workbench"><ReplayChart prices={data.priceSeries} events={data.timeline} runId={id} onSelect={setSelected}/><aside className="replay-session-rail">
      <Card className="workspace-panel"><h2>Conclusions GPT</h2>{!data.conclusions.length ? <p className="muted-copy">Aucune conclusion GPT matérialisée.</p> : data.conclusions.map(item => <Link className="conclusion-item" key={item.processId} to={`/replay/runs/${encodeURIComponent(id)}/gpt/${encodeURIComponent(item.processId)}`}><strong>{item.conclusion}</strong><span>Inspecter →</span></Link>)}</Card>
      <Card className="workspace-panel"><h2>Processus GPT</h2>{!data.gptProcesses.length ? <p className="muted-copy">Aucun processus lié.</p> : data.gptProcesses.map(process => <Link className="gpt-row" key={process.id} to={`/replay/runs/${encodeURIComponent(id)}/gpt/${encodeURIComponent(process.id)}`}><div><strong>{process.workflow}</strong><small>Tentative {process.attempt}/{process.maxAttempts || "—"}</small></div><StatusTag status={process.status}/></Link>)}</Card>
    </aside></div>
    <section id="timeline-events" className="replay-terminal-section"><header><div><p className="eyebrow">Journal consolidé</p><h2>Timeline complète</h2></div><span>{data.timeline.length} événements</span></header><EventTimeline events={data.timeline} runId={id} selectedId={selected?.id} onSelect={setSelected}/></section>
  </section>;
}
````

### `src/pages/ReplaySessionPage.tsx`

````tsx
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { Breadcrumbs, EventTimeline, formatDateTime, formatDuration, formatTime, MetricCard, MetricStrip, PageHeading, ReplayChart, StatusTag } from "@/components/operations";
import type { OperationsEvent } from "@/operationsTypes";
import { useReplaySession } from "@/hooks/useOperations";

export default function ReplaySessionPage() {
  const { runId = "", date = "", sessionExecutionId = "" } = useParams();
  const parent = decodeURIComponent(runId);
  const execution = decodeURIComponent(sessionExecutionId);
  const query = useReplaySession(parent, execution);
  const [selected, setSelected] = useState<OperationsEvent | null>(null);

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Session introuvable"} retry={() => query.refetch()}/>;

  const data = query.data;
  const activeEvent = selected || data.timeline.at(-1) || null;
  const resultR = Number(data.run.metrics.totalR || 0);

  return <section className="view workspace-view replay-session-v3">
    <Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: date, to: `/replay/runs/${encodeURIComponent(parent)}/days/${date}` }, { label: data.run.session || execution }]}/>
    <PageHeading eyebrow="Session replay workstation" title={`${sessionLabel(data.run.session)} · ${data.run.strategyId || "Desk"}`} subtitle={`${execution} · ${data.run.variantId || "default"}`} backTo={`/replay/runs/${encodeURIComponent(parent)}/days/${date}`} actions={<><StatusTag status={data.run.status}/><Link className="secondary-btn" to={`/operations/workflows/${encodeURIComponent(data.run.id)}`}>Workflow</Link></>}/>

    <MetricStrip className="metric-grid--compact replay-summary-strip">
      <MetricCard label="Progression" value={`${data.run.progress}%`}/>
      <MetricCard label="Durée" value={formatDuration(data.run.durationMs)}/>
      <MetricCard label="Événements" value={data.timeline.length}/>
      <MetricCard label="Processus GPT" value={data.gptProcesses.length} detail={`${data.gptProcesses.filter(item => item.status === "waiting_gpt").length} en attente`}/>
      <MetricCard label="Résultat" value={`${resultR.toFixed(2)} R`} tone={resultR >= 0 ? "positive" : "negative"}/>
      <MetricCard label="Dernier signal" value={formatTime(data.timeline.at(-1)?.at)} detail={data.timeline.at(-1)?.title || "Aucun"}/>
    </MetricStrip>

    <div className="replay-session-context-strip">
      <span>PARENT <strong>{parent}</strong></span><span>SESSION <strong>{data.run.session || "—"}</strong></span><span>VARIANTE <strong>{data.run.variantId || "default"}</strong></span><span>TENTATIVE <strong>#{data.run.attempt || 1}</strong></span><span>SOURCE <strong>POSTGRES</strong></span>
    </div>

    <div className="replay-session-workbench">
      <ReplayChart prices={data.priceSeries} events={data.timeline} runId={parent} onSelect={setSelected}/>
      <aside className="replay-session-rail">
        <Card className="replay-event-inspector">
          <header><div><p className="eyebrow">Événement sélectionné</p><h2>{activeEvent?.title || "Aucun événement"}</h2></div>{activeEvent && <StatusTag status={activeEvent.status}/>}</header>
          {activeEvent ? <><div className="replay-event-inspector__meta"><span>HEURE <strong>{formatDateTime(activeEvent.at)}</strong></span><span>COUCHE <strong>{activeEvent.layer || activeEvent.type}</strong></span><span>PRIX <strong>{activeEvent.price ?? "—"}</strong></span></div><p>{activeEvent.conclusion || activeEvent.detail || activeEvent.decision || "Transition enregistrée."}</p>{activeEvent.processId && <Link className="row-link" to={`/replay/runs/${encodeURIComponent(parent)}/gpt/${encodeURIComponent(activeEvent.processId)}`}>Inspecter le processus GPT <Icon name="arrow" size={13}/></Link>}</> : <div className="terminal-empty-state"><span>NO_EVENT_SELECTED</span><small>Sélectionnez un marqueur sur la timeline.</small></div>}
        </Card>

        <Card className="replay-gpt-rail">
          <header><div><p className="eyebrow">Orchestration IA</p><h2>Processus GPT de la session</h2></div><span className="terminal-counter">{data.gptProcesses.length}</span></header>
          {!data.gptProcesses.length ? <div className="terminal-empty-state"><span>NO_GPT_PROCESS</span><small>Aucun processus GPT lié à cette session.</small></div> : <div className="replay-gpt-process-list">{data.gptProcesses.map(process => <Link key={process.id} to={`/replay/runs/${encodeURIComponent(parent)}/gpt/${encodeURIComponent(process.id)}`}>
            <span className="replay-gpt-process-list__index">{String(process.attempt).padStart(2, "0")}</span>
            <div><strong>{process.workflow}</strong><small>{process.decision || process.conclusion || process.rawStatus}</small></div>
            <StatusTag status={process.status}/>
          </Link>)}</div>}
        </Card>

        <Card className="replay-conclusion-rail">
          <header><p className="eyebrow">Conclusions matérialisées</p><span className="terminal-counter">{data.conclusions.length}</span></header>
          {!data.conclusions.length ? <p className="muted-copy">Aucune conclusion enregistrée.</p> : data.conclusions.map(item => <blockquote key={item.processId}><span>{formatTime(item.at)}</span>{item.conclusion}</blockquote>)}
        </Card>
      </aside>
    </div>

    <section id="timeline-events" className="replay-terminal-section">
      <header><div><p className="eyebrow">Journal synchronisé</p><h2>Décisions horodatées</h2></div><span>{data.timeline.length} événements · prix, étapes et GPT</span></header>
      <EventTimeline events={data.timeline} runId={parent} selectedId={activeEvent?.id} onSelect={setSelected}/>
    </section>
  </section>;
}

function sessionLabel(value?: string | null) {
  return value === "asia_open" ? "Asia Open" : value === "ny_open" ? "NY Open" : value?.replaceAll("_", " ") || "Session";
}
````

### `src/pages/RunbooksPage.tsx`

````tsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { Breadcrumbs, formatDateTime, PageHeading, PageTabs, StatusTag } from "@/components/operations";
import { useRunbooks } from "@/hooks/useOperations";
import type { OperationsRunbook } from "@/operationsTypes";

const operationsTabs = [
  { label: "Cockpit", to: "/operations", end: true },
  { label: "Observabilité", to: "/operations/observability" },
  { label: "Incidents", to: "/operations/incidents" },
  { label: "Notifications", to: "/operations/notifications" },
  { label: "Runbooks", to: "/operations/runbooks" },
];

export default function RunbooksPage() {
  const [status, setStatus] = useState("action_required");
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filters = useMemo(() => ({
    status: status === "all" ? null : status,
    kind: kind === "all" ? null : kind,
    q: q.trim() || null,
  }), [kind, q, status]);
  const query = useRunbooks(filters);

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Runbooks indisponibles"} retry={() => query.refetch()}/>;

  const items = query.data.items;
  const summary = query.data.summary;
  const selected = items.find((item) => item.id === selectedId) || items[0] || null;

  return <section className="view workspace-view runbook-center-view">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Runbooks" }]}/>
    <PageHeading
      eyebrow="Operator Runbooks"
      title="Runbooks opérateur"
      subtitle="Procédures générées depuis les incidents, notifications, workflows et processus GPT réellement persistés."
      backTo="/operations"
      actions={<button className="secondary-btn" onClick={() => query.refetch()}><Icon name="refresh" size={14}/>Actualiser</button>}
      tabs={<PageTabs items={operationsTabs}/>}
    />

    <div className="metric-grid metric-grid--compact runbook-kpis">
      <Card className="metric-card" data-tone={summary.actionRequired ? "negative" : "positive"}><span>Action requise</span><strong>{summary.actionRequired}</strong><small>{summary.critical} critiques</small></Card>
      <Card className="metric-card"><span>Lease</span><strong>{summary.leaseExpired}</strong><small>récupération work item</small></Card>
      <Card className="metric-card"><span>Workflow</span><strong>{summary.workflowBlocked}</strong><small>bloqué / échec</small></Card>
      <Card className="metric-card"><span>GPT</span><strong>{summary.gptFailure}</strong><small>erreurs outil/modèle</small></Card>
      <Card className="metric-card"><span>Data quality</span><strong>{summary.dataQuality}</strong><small>pack/cutoff/données</small></Card>
    </div>

    <div className="runbook-layout">
      <Card className="runbook-ledger-panel">
        <header className="incident-command-toolbar runbook-toolbar">
          <div><p className="eyebrow">Procédures actives</p><h2>{items.length} runbooks</h2></div>
          <div>
            <label>Statut<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="action_required">Action requise</option><option value="waiting">Waiting</option><option value="watching">Watching</option><option value="all">Tous</option></select></label>
            <label>Type<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">Tous</option><option value="lease_expired">Lease</option><option value="workflow_blocked">Workflow</option><option value="gpt_failure">GPT failure</option><option value="telemetry_missing">Télémétrie</option><option value="cost_budget_breach">Budget</option><option value="data_quality_issue">Data quality</option></select></label>
            <label>Recherche<input value={q} onChange={(event) => setQ(event.target.value)} placeholder="run, incident, worker…"/></label>
          </div>
        </header>
        {!items.length ? <div className="workspace-empty incident-empty"><Icon name="check"/><h3>Aucun runbook actif</h3><p>Les runbooks apparaissent dès qu’un incident, une notification ou un workflow exige une intervention.</p></div> : <div className="data-table-wrap runbook-ledger-wrap">
          <table className="data-table runbook-ledger-table">
            <thead><tr><th>Runbook</th><th>Priorité</th><th>Contexte</th><th>Next action</th><th>État</th></tr></thead>
            <tbody>{items.map((item) => <tr key={item.id} data-kind={item.kind} className={selected?.id === item.id ? "is-selected" : ""} onClick={() => setSelectedId(item.id)}>
              <td data-label="Runbook"><strong><i data-severity={item.severity}/>{item.title}</strong><small>{kindLabel(item.kind)} · {item.reasonCodes.join(" · ") || item.sourceId}</small></td>
              <td data-label="Priorité"><span className="terminal-code">{item.priority}</span><small>{item.severity}</small></td>
              <td data-label="Contexte">{item.runId || item.workflowId || "desk"}<small>{item.processId || item.context.worker || item.owner || "local"}</small></td>
              <td data-label="Next action">{item.nextAction?.title || "Inspecter"}<small>{item.nextAction?.commandAction || item.nextAction?.kind || "read"}</small></td>
              <td data-label="État"><StatusTag status={item.status}/><small>{formatDateTime(item.updatedAt)}</small></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </Card>

      <Card className="runbook-detail-panel">
        {!selected ? <div className="workspace-empty incident-empty"><Icon name="database"/><h3>Aucun détail</h3><p>Sélectionne une procédure.</p></div> : <RunbookDetail runbook={selected}/>}
      </Card>
    </div>
  </section>;
}

function RunbookDetail({ runbook }: { runbook: OperationsRunbook }) {
  return <>
    <header className="incident-detail-head runbook-detail-head">
      <div>
        <p className="eyebrow">{kindLabel(runbook.kind)} · prio {runbook.priority}</p>
        <h2>{runbook.title}</h2>
        <p>{runbook.summary}</p>
      </div>
      <StatusTag status={runbook.status}/>
    </header>
    <div className="runbook-link-strip">
      {runbook.links.map((link) => <Link className="secondary-btn" key={`${link.kind}:${link.href}`} to={link.href}>{link.label}</Link>)}
    </div>
    <ol className="runbook-steps">
      {runbook.steps.map((step) => <li key={step.id} data-kind={step.kind}>
        <span>{step.index}</span>
        <div><strong>{step.title}</strong><p>{step.description}</p>{step.href && <Link className="row-link" to={step.href}>Ouvrir <Icon name="arrow" size={13}/></Link>}</div>
        <em>{step.commandAction || step.kind}</em>
      </li>)}
    </ol>
    <dl className="incident-evidence-grid runbook-context-grid">
      <div><dt>Incident</dt><dd>{runbook.incidentId || "N/D"}</dd></div>
      <div><dt>Notification</dt><dd>{runbook.notificationId || "N/D"}</dd></div>
      <div><dt>Workflow</dt><dd>{runbook.workflowId || "N/D"}</dd></div>
      <div><dt>Process</dt><dd>{runbook.processId || "N/D"}</dd></div>
    </dl>
    <section className="incident-timeline-panel">
      <header><p className="eyebrow">Timeline liée</p><span>{runbook.timeline.length} événements</span></header>
      {!runbook.timeline.length ? <p className="empty-copy">Aucun événement source matérialisé.</p> : <ol className="incident-timeline">
        {runbook.timeline.map((event) => <li key={event.id}>
          <time>{formatDateTime(event.at)}</time>
          <i data-severity={event.severity}/>
          <div><strong>{event.type}</strong><p>{event.message || event.title}</p></div>
        </li>)}
      </ol>}
    </section>
  </>;
}

function kindLabel(kind: string) {
  return ({
    lease_expired: "Lease GPT",
    workflow_blocked: "Workflow bloqué",
    gpt_failure: "Échec GPT",
    telemetry_missing: "Télémétrie",
    cost_budget_breach: "Budget GPT",
    data_quality_issue: "Data quality",
    incident_response: "Incident",
  } as Record<string, string>)[kind] || kind;
}
````

### `src/pages/SessionsPage.tsx`

````tsx
import { Link } from "react-router-dom";
import { Card, StatusBadge } from "@/components/common";
import { PageHeading } from "@/components/operations";
import { useDeskContext } from "@/context/DeskContext";
import { useDeskSession } from "@/hooks/useDesk";
import type { DeskSession } from "@/types";

const phases = [
  { id: "asia", label: "Asia", start: 0, end: 8, hours: "00:00–08:00" },
  { id: "london", label: "London", start: 8, end: 15.5, hours: "08:00–15:30" },
  { id: "ny", label: "New York", start: 15.5, end: 24, hours: "15:30–00:00" }
] as const;

export default function SessionsPage() {
  const { phase, phaseLabel, nextPhaseAt } = useDeskContext();
  const asia = useDeskSession("asia_open");
  const ny = useDeskSession("ny_open");
  const now = parisHour();
  return <section className="view sessions-page-v2">
    <PageHeading eyebrow="Sélection automatique" title="Sessions" subtitle={`${phaseLabel} active · prochaine transition à ${nextPhaseAt}`}/>
    <Card className="session-day-timeline">
      <header><div><p className="eyebrow">Journée Europe/Paris</p><h2>Chronologie des phases</h2></div><StatusBadge tone="info">AUTOMATIQUE</StatusBadge></header>
      <div className="session-day-timeline__track" aria-label={`Phase active ${phaseLabel} ; prochaine transition à ${nextPhaseAt}`}>
        {phases.map(item => <div key={item.id} className={phase === item.id ? "active" : ""} style={{ width: `${((item.end - item.start) / 24) * 100}%` }}><strong>{item.label}</strong><span>{item.hours}</span></div>)}
        <i className="session-now" style={{ left: `${(now / 24) * 100}%` }}><span>Maintenant</span></i>
      </div>
      <p>La session est choisie par l’heure de Paris. Cette chronologie est indicative et ne permet aucune sélection manuelle.</p>
    </Card>
    <div className="session-context-grid">
      <SessionContextCard title="Contexte Asia" data={asia.data} loading={asia.isLoading} active={phase === "asia" || phase === "london"}/>
      <SessionContextCard title="Contexte New York" data={ny.data} loading={ny.isLoading} active={phase === "ny"}/>
    </div>
  </section>;
}

function SessionContextCard({ title, data, loading, active }: { title: string; data?: DeskSession; loading: boolean; active: boolean }) {
  return <Card className={`session-context-detail ${active ? "active" : ""}`}>
    <header><div><p className="eyebrow">{title}</p><h2>{data?.label || (loading ? "Chargement…" : "Non disponible")}</h2></div><StatusBadge tone={active ? "info" : "muted"}>{active ? "CONTEXTE ACTIF" : "EN ATTENTE"}</StatusBadge></header>
    {data ? <><dl className="definition-grid"><dt>Stratégie</dt><dd>{data.strategyId}</dd><dt>Mode</dt><dd>{data.mode}</dd><dt>État</dt><dd>{data.status}</dd><dt>Prochain monitor</dt><dd>{data.nextMonitorAt}</dd></dl><Link className="row-link" to="/live">Voir dans Live Desk →</Link></> : !loading && <p className="muted-copy">Le contexte n’est pas matérialisé par le backend.</p>}
  </Card>;
}

function parisHour() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return Number(parts.find(part => part.type === "hour")?.value || 0) + Number(parts.find(part => part.type === "minute")?.value || 0) / 60;
}
````

### `src/pages/SetupPage.tsx`

````tsx
import { useState } from "react";
import { ConfirmActionForm } from "@/components/ConfirmActionForm";
import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { PageHeading } from "@/components/operations";
import { PositionCard, SetupCard } from "@/components/deskCards";
import { useOverlay } from "@/context/OverlayContext";
import { deskDetailScope, useSetupDetail } from "@/hooks/useDesk";
import { useOperatorAuth, useOperatorCommand, useOperatorState } from "@/hooks/useOperator";
import { DeskPage } from "@/pages/pageState";
import type { DeskOperatorCapability, DeskOperatorCommandType, DeskSession } from "@/types";

export default function SetupPage() {
  return <DeskPage>{data => <SetupWorkspace initialData={data}/>}</DeskPage>;
}

function SetupWorkspace({ initialData }: { initialData: DeskSession }) {
  const query = useSetupDetail(initialData.setup.id, deskDetailScope(initialData));
  const data = {
    ...initialData,
    setup: query.data?.setup || initialData.setup,
    levels: query.data?.levels || initialData.levels
  };
  return <section className="view">
    <PageHeading eyebrow="Exécution" title="Setup & Position" subtitle="Plan théorique séparé de l’exécution canonique"/>
    <SetupCard data={data}/>
    <section id="position"><PositionCard data={data}/></section>
    <OperatorCommandPanel data={data}/>
    <Card className="source-rules-react">
      <div className="brief-card__header"><div><p className="eyebrow">Priorité des sources</p><h3>Règle opérationnelle</h3></div><span className="card-icon"><Icon name="database"/></span></div>
      <div className="source-priority-list">
        <div><span>1</span><p><strong>Position et stop réels</strong><small>Backend d’exécution</small></p></div>
        <div><span>2</span><p><strong>Statut du setup</strong><small>desk_setups</small></p></div>
        <div><span>3</span><p><strong>Action recommandée</strong><small>Dernier Monitor valide</small></p></div>
        <div><span>4</span><p><strong>Plan initial</strong><small>Master Analysis</small></p></div>
      </div>
    </Card>
    <SectionTitle title="Niveaux liés"/>
    <div className="levels-react">{data.levels.map(level => <Card key={level.price} className="level-react"><strong>{level.price}</strong><span>{level.role}</span><StatusBadge tone={level.state === "consumed" ? "critical" : "info"}>{level.state}</StatusBadge></Card>)}</div>
  </section>;
}

const commandLabels: Record<DeskOperatorCommandType, string> = {
  cancel_setup: "Annuler le setup",
  confirm_trigger: "Confirmer le trigger",
  move_break_even: "Déplacer au break-even",
  take_partial: "Prendre un partiel",
  exit_position: "Sortir de la position",
  request_replan: "Demander un replan"
};

function OperatorCommandPanel({ data }: { data: DeskSession }) {
  const overlay = useOverlay();
  const auth = useOperatorAuth();
  const stateQuery = useOperatorState(data);
  const command = useOperatorCommand(data);
  const [feedback, setFeedback] = useState<string | null>(null);
  const state = stateQuery.data;
  const canWrite = auth.status === "ready";

  const openConfirmation = (capability: DeskOperatorCapability) => {
    if (!state || !capability.enabled || !canWrite) return;
    overlay.openModal(commandLabels[capability.command], <OperatorConfirmation
      capability={capability}
      revision={state.revision}
      onCancel={overlay.closeModal}
      onConfirm={async values => {
        const result = await command.mutateAsync({
          command: capability.command,
          expectedRevision: state.revision,
          idempotencyKey: createIdempotencyKey(capability.command),
          confirmationPhrase: values.confirmationPhrase,
          targetId: capability.targetId || undefined,
          reason: values.reason,
          ...(capability.command === "take_partial" ? { partialFraction: values.partialFraction } : {})
        });
        setFeedback(`${commandLabels[capability.command]} enregistrée · révision ${result.command.revision} · audit ${result.command.auditId}`);
        overlay.closeModal();
      }}
    />);
  };

  return <Card className="operator-panel">
    <div className="operator-panel__head">
      <div><p className="eyebrow">Commandes opérateur</p><h3>État canonique uniquement</h3></div>
      <StatusBadge tone={canWrite ? "info" : auth.status === "loading" ? "warning" : "muted"}>
        {canWrite ? "AUTHENTIFIÉ" : auth.status === "loading" ? "CONNEXION" : "LECTURE SEULE"}
      </StatusBadge>
    </div>
    <p className="operator-panel__notice">Chaque action exige une confirmation textuelle, la révision courante et une clé d’idempotence. Aucun ordre broker n’est envoyé.</p>
    <div className="operator-panel__identity">
      <span>{auth.email || auth.message || "Connexion Google requise pour écrire"}</span>
      {!canWrite && auth.status !== "loading" && auth.status !== "unavailable" && <button type="button" className="secondary-btn" onClick={() => void auth.signIn()}>Se connecter</button>}
      {canWrite && !auth.email?.endsWith("@desk.local") && <button type="button" className="text-btn" onClick={() => void auth.signOut()}>Déconnexion</button>}
    </div>
    {stateQuery.isError && <p className="operator-feedback operator-feedback--error">{stateQuery.error.message}</p>}
    {feedback && <p className="operator-feedback"><Icon name="check" size={16}/>{feedback}</p>}
    <div className="operator-command-grid">
      {(state?.allowedCommands || []).map(capability => <button
        type="button"
        key={capability.command}
        className={`operator-command operator-command--${capability.dangerLevel}`}
        disabled={!canWrite || !capability.enabled || command.isPending}
        onClick={() => openConfirmation(capability)}
        title={capability.reason || commandLabels[capability.command]}
      >
        <strong>{commandLabels[capability.command]}</strong>
        <span>{capability.enabled ? capability.targetId || "Session active" : humanReason(capability.reason)}</span>
      </button>)}
    </div>
    {state && <div className="operator-panel__revision"><span>Révision opérateur</span><strong>{state.revision}</strong><span>Broker</span><strong>désactivé</strong></div>}
  </Card>;
}

export function OperatorConfirmation({
  capability,
  revision,
  onCancel,
  onConfirm
}: {
  capability: DeskOperatorCapability;
  revision: number;
  onCancel: () => void;
  onConfirm: (values: { confirmationPhrase: string; reason: string; partialFraction: number }) => Promise<void>;
}) {
  const [partialFraction, setPartialFraction] = useState(0.5);
  return <ConfirmActionForm
    target={capability.targetId || "Session active"}
    revision={revision}
    expectedPhrase={capability.confirmationPhrase}
    onCancel={onCancel}
    danger={capability.dangerLevel === "critical"}
    validateExtra={() => partialFraction > 0 && partialFraction < 1}
    onConfirm={({ confirmationPhrase, reason }) => onConfirm({ confirmationPhrase, reason, partialFraction })}
  >
    {capability.command === "take_partial" && <label>
      Fraction à sortir
      <select value={partialFraction} onChange={event => setPartialFraction(Number(event.target.value))}>
        <option value={0.25}>25 %</option><option value={0.5}>50 %</option><option value={0.75}>75 %</option>
      </select>
    </label>}
  </ConfirmActionForm>;
}

export function operatorConfirmationIsValid(confirmationPhrase: string, expectedPhrase: string, reason: string) {
  return confirmationPhrase === expectedPhrase && reason.trim().length >= 3;
}

function createIdempotencyKey(command: DeskOperatorCommandType) {
  const random = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `front:${command}:${random}`;
}

function humanReason(reason: string | null) {
  return ({
    canonical_setup_missing: "Aucun setup canonique",
    setup_terminal: "Setup déjà terminé",
    setup_already_triggered: "Trigger déjà confirmé",
    active_position_missing: "Aucune position active",
    position_not_active: "Position inactive",
    position_entry_missing: "Prix d’entrée manquant",
    active_thesis_missing: "Aucune thèse active"
  } as Record<string, string>)[reason || ""] || "Action indisponible";
}
````

### `src/pages/StrategiesPage.tsx`

````tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { ErrorView, Icon, LoadingView } from "@/components/common";
import { MetricCard, MetricStrip, PageHeading } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";

export default function StrategiesPage() {
  const query = useQuery({ queryKey: operationsKeys.strategies, queryFn: operationsApi.listStrategies });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Stratégies indisponibles"} retry={() => query.refetch()}/>;
  const items = query.data.items;
  const totalR = items.reduce((total, item) => total + Number(item.performance.totalR || 0), 0);
  const trades = items.reduce((total, item) => total + Number(item.performance.trades || 0), 0);
  return <section className="view workspace-view strategies-v3">
    <PageHeading eyebrow="Strategy governance" title="Stratégies & versions" subtitle="Catalogue, runtime, performance réelle, contrats et historique des versions." actions={<Link className="secondary-btn" to="/performance/analysis">Performance globale</Link>}/>
    <MetricStrip className="metric-grid--compact">
      <MetricCard label="Stratégies détectées" value={items.length}/>
      <MetricCard label="Résultat cumulé" value={formatR(totalR)} tone={totalR >= 0 ? "positive" : "critical"}/>
      <MetricCard label="Trades persistés" value={trades}/>
      <MetricCard label="Versions publiées" value={items.reduce((total, item) => total + item.versions.length, 0)}/>
    </MetricStrip>
    <section className="replay-terminal-section strategy-terminal-section"><header><div><p className="eyebrow">Registry canonique</p><h2>Catalogue et activité</h2></div><span>{items.length} stratégies matérialisées</span></header><div className="data-table-wrap"><table className="data-table strategy-registry-table"><thead><tr><th>Stratégie</th><th>État des sources</th><th>Résultat</th><th>Trades</th><th>Win rate</th><th>Drawdown</th><th>Replays</th><th>Versions</th><th>Contrats</th><th/></tr></thead><tbody>{items.map(strategy => <tr key={strategy.id}>
      <td data-label="Stratégie"><strong>{strategy.id}</strong><small>{String(strategy.catalog?.name || strategy.config?.name || "Détectée par les données")}</small></td>
      <td data-label="Sources"><div className="strategy-source-flags"><i data-ready={Boolean(strategy.catalog)}>CAT</i><i data-ready={Boolean(strategy.config)}>CFG</i><i data-ready={Boolean(strategy.runtime)}>RUN</i><i data-ready={Boolean(strategy.stats)}>STAT</i></div></td>
      <td data-label="Résultat" className={strategy.performance.totalR >= 0 ? "positive" : "negative"}><strong>{formatR(strategy.performance.totalR)}</strong></td>
      <td data-label="Trades">{strategy.performance.trades}</td>
      <td data-label="Win rate">{strategy.performance.winRate === null ? "—" : `${(strategy.performance.winRate * 100).toFixed(1)}%`}</td>
      <td data-label="Drawdown" className={strategy.performance.maxDrawdownR < 0 ? "negative" : ""}>{formatR(strategy.performance.maxDrawdownR)}</td>
      <td data-label="Replays">{strategy.replayCount}</td><td data-label="Versions">{strategy.versions.length}</td><td data-label="Contrats">{strategy.activeContracts.length}</td>
      <td data-label="Action"><Link className="row-link" to={`/strategies/${encodeURIComponent(strategy.id)}`}>Ouvrir <Icon name="arrow" size={13}/></Link></td>
    </tr>)}</tbody></table></div></section>
  </section>;
}

function formatR(value: number) { return `${value > 0 ? "+" : ""}${Number(value || 0).toFixed(2)} R`; }
````

### `src/pages/StrategyDetailPage.tsx`

````tsx
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, MetricCard, MetricStrip, PageHeading } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";
import type { StrategyVersionChange, StrategyVersionComparison } from "@/operationsTypes";

export default function StrategyDetailPage() {
  const { strategyId = "" } = useParams();
  const id = decodeURIComponent(strategyId);
  const strategies = useQuery({ queryKey: operationsKeys.strategies, queryFn: operationsApi.listStrategies });
  const strategy = strategies.data?.items.find(item => item.id === id);
  const versions = useMemo(() => strategy?.versions || [], [strategy]);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const comparison = useQuery({ queryKey: ["operations", "strategy-compare", id, left, right], queryFn: () => operationsApi.compareStrategyVersions(id, left, right), enabled: Boolean(left && right) });
  useEffect(() => {
    if (versions.length < 2 || left || right) return;
    setLeft(versionKey(versions[1]));
    setRight(versionKey(versions[0]));
  }, [left, right, versions]);
  if (strategies.isLoading) return <LoadingView/>;
  if (strategies.isError || !strategy) return <ErrorView message={strategies.error?.message || "Stratégie introuvable"} retry={() => strategies.refetch()}/>;
  const performance = strategy.performance;
  return <section className="view workspace-view strategy-detail-v3 strategy-governance-v3"><Breadcrumbs items={[{ label: "Stratégies", to: "/strategies" }, { label: id }]}/><PageHeading eyebrow="Gouvernance stratégie" title={id} subtitle="Versions, configuration, runtime, contrats et impact de performance traçables." backTo="/strategies" actions={<Link className="primary-btn" to={`/performance/analysis?strategy=${encodeURIComponent(id)}`}>Analyser la performance</Link>}/>
    <MetricStrip className="metric-grid--compact strategy-kpi-strip"><MetricCard label="Versions" value={versions.length} detail={`${strategy.activeContracts.length} contrats actifs`}/><MetricCard label="Résultat" value={formatR(performance.totalR)} tone={performance.totalR >= 0 ? "positive" : "critical"}/><MetricCard label="Trades" value={performance.trades}/><MetricCard label="Win rate" value={performance.winRate === null ? "—" : `${(performance.winRate * 100).toFixed(1)}%`}/><MetricCard label="Max drawdown" value={formatR(performance.maxDrawdownR)} tone={performance.maxDrawdownR < 0 ? "critical" : "neutral"}/><MetricCard label="Replays" value={strategy.replayCount}/></MetricStrip>
    <div className="replay-session-context-strip"><span>CATALOGUE <strong>{strategy.catalog ? "READY" : "ABSENT"}</strong></span><span>CONFIG <strong>{strategy.config ? "READY" : "DEFAULT"}</strong></span><span>RUNTIME <strong>{strategy.runtime ? "MATERIALIZED" : "INACTIVE"}</strong></span><span>REPLAYS <strong>{strategy.replayCount}</strong></span></div>
    <div className="strategy-governance-grid"><Card className="workspace-panel strategy-version-ledger"><header><div><p className="eyebrow">Registre</p><h2>Versions publiées</h2></div><span className="terminal-counter">{versions.length}</span></header>{!versions.length ? <p className="muted-copy">Aucune version explicite.</p> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Version</th><th>État</th><th>Création</th><th>Rôle comparaison</th></tr></thead><tbody>{versions.map((version, index) => { const key = versionKey(version); return <tr key={key || String(index)}><td><strong>{String(version.version || version.version_id)}</strong><small>{String(version.version_id || "identifiant implicite")}</small></td><td>{String(version.status || "archivée").toUpperCase()}</td><td>{formatVersionDate(version)}</td><td><div className="version-role-actions"><button className={left === key ? "active" : ""} onClick={() => setLeft(key)}>Avant</button><button className={right === key ? "active" : ""} onClick={() => setRight(key)}>Après</button></div></td></tr>; })}</tbody></table></div>}</Card><Card className="workspace-panel strategy-contract-ledger"><header><div><p className="eyebrow">Compatibilité</p><h2>Contrats actifs</h2></div><span className="terminal-counter">{strategy.activeContracts.length}</span></header>{!strategy.activeContracts.length ? <p className="muted-copy">Aucun contrat spécifique lié.</p> : <div className="version-list">{strategy.activeContracts.map(contract => <div key={`${contract.name}:${contract.version}`}><strong>{contract.name}</strong><small>v{contract.version} · {contract.status}</small></div>)}</div>}</Card></div>
    {versions.length >= 2 && <Card className="workspace-panel strategy-diff-panel"><header><div><p className="eyebrow">Contrôle de changement</p><h2>Diff de configuration</h2></div>{comparison.data && <span className="terminal-counter">{comparison.data.changes.length} changements</span>}</header><div className="strategy-diff-toolbar"><label>Avant<select value={left} onChange={event => setLeft(event.target.value)}>{versions.map((version, index) => <option key={index} value={versionKey(version)}>{String(version.version || version.version_id)}</option>)}</select></label><span>→</span><label>Après<select value={right} onChange={event => setRight(event.target.value)}>{versions.map((version, index) => <option key={index} value={versionKey(version)}>{String(version.version || version.version_id)}</option>)}</select></label></div>{left === right ? <div className="terminal-empty-state"><span>IDENTICAL_VERSION_SELECTION</span><small>Sélectionnez deux versions différentes.</small></div> : comparison.isLoading ? <p className="muted-copy">Calcul du diff canonique…</p> : comparison.isError ? <p className="form-error">{comparison.error.message}</p> : comparison.data && <StrategyDiff data={comparison.data}/>}</Card>}
    <details className="raw-inspector"><summary>Configuration courante</summary><pre>{JSON.stringify(strategy.config || strategy.catalog || strategy.stats, null, 2)}</pre></details>
  </section>;
}

function StrategyDiff({ data }: { data: StrategyVersionComparison }) {
  const groups = data.changes.reduce((counts, change) => ({ ...counts, [changeKind(change)]: (counts[changeKind(change)] || 0) + 1 }), {} as Record<string, number>);
  if (!data.changes.length) return <div className="terminal-empty-state"><span>NO_STRUCTURAL_CHANGE</span><small>Les deux versions sont structurellement identiques.</small></div>;
  return <><div className="strategy-diff-summary"><span>MODIFIÉS <strong>{groups.modified || 0}</strong></span><span>AJOUTÉS <strong>{groups.added || 0}</strong></span><span>SUPPRIMÉS <strong>{groups.removed || 0}</strong></span></div><div className="data-table-wrap"><table className="data-table strategy-diff-table"><thead><tr><th>Chemin</th><th>Avant</th><th>Après</th><th>Type</th></tr></thead><tbody>{data.changes.map(row => <tr key={row.path} data-change={changeKind(row)}><td data-label="Chemin"><strong>{row.path}</strong></td><td data-label="Avant"><code>{formatValue(row.before)}</code></td><td data-label="Après"><code>{formatValue(row.after)}</code></td><td data-label="Type"><span>{changeLabel(row)}</span></td></tr>)}</tbody></table></div></>;
}

function versionKey(version: Record<string, unknown>) { return String(version.version_id || version.version || ""); }
function formatVersionDate(version: Record<string, unknown>) { const value = version.created_at_utc || version.created_at || version.updated_at_utc || version.updated_at; return value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(String(value))) : "—"; }
function changeKind(change: StrategyVersionChange) { return change.before === null ? "added" : change.after === null ? "removed" : "modified"; }
function changeLabel(change: StrategyVersionChange) { return changeKind(change) === "added" ? "AJOUT" : changeKind(change) === "removed" ? "SUPPRESSION" : "MODIFICATION"; }
function formatValue(value: unknown) { if (value === null || value === undefined) return "∅"; if (typeof value === "string") return value; return JSON.stringify(value); }
function formatR(value: number) { return `${value > 0 ? "+" : ""}${Number(value || 0).toFixed(2)} R`; }
````

### `src/pages/ThesisPage.tsx`

````tsx
import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { MetricCard, MetricStrip, PageHeading } from "@/components/operations";
import { Conditions } from "@/components/deskCards";
import { deskDetailScope, useThesisConditionsDetail, useThesisDetail } from "@/hooks/useDesk";
import { DeskPage } from "@/pages/pageState";
import type { DeskSession } from "@/types";

export default function ThesisPage() {
  return <DeskPage>{data => <ThesisWorkspace initialData={data}/>}</DeskPage>;
}

function ThesisWorkspace({ initialData }: { initialData: DeskSession }) {
  const scope = deskDetailScope(initialData);
  const thesisQuery = useThesisDetail(initialData.thesis.id, scope);
  const conditionsQuery = useThesisConditionsDetail(initialData.thesis.id, scope);
  const data = {
    ...initialData,
    thesis: thesisQuery.data?.thesis || initialData.thesis,
    levels: thesisQuery.data?.levels || initialData.levels
  };
  return <section className="view">
    <PageHeading eyebrow="Temps réel" title="Thèse active" subtitle="État vivant mis à jour par les Monitors"/>
    <Card className="thesis-page-hero">
      <div className="thesis-page-hero__copy">
        <div className="instrument-title"><span className="instrument-badge">{data.thesis.instrument}</span><div><p className="eyebrow">{data.thesis.direction}</p><h1>{data.thesis.status}</h1></div></div>
        <p>{data.thesis.dominantScenario}</p>
        <StatusBadge tone={data.thesis.health < 40 ? "critical" : "warning"}>{data.thesis.previousStatus} → {data.thesis.status}</StatusBadge>
      </div>
      <MetricStrip className="thesis-health-strip">
        <MetricCard label="Santé" value={`${data.thesis.health}/100`} tone={data.thesis.health < 40 ? "negative" : data.thesis.health < 70 ? "warning" : "neutral"}/>
        <MetricCard label="Confiance" value={`${data.thesis.confidence}%`}/>
        <MetricCard label="Valide jusqu’à" value={data.thesis.validUntil}/>
      </MetricStrip>
    </Card>
    <div className="content-grid">
      <Card className="score-drivers-react positive"><h3><Icon name="trendUp"/> Facteurs positifs</h3>{data.thesis.scoreDriversPositive.length ? <ul>{data.thesis.scoreDriversPositive.map(x => <li key={x}>{x}</li>)}</ul> : <p>Aucun facteur positif dominant.</p>}</Card>
      <Card className="score-drivers-react negative"><h3><Icon name="trendDown"/> Facteurs négatifs</h3><ul>{data.thesis.scoreDriversNegative.map(x => <li key={x}>{x}</li>)}</ul></Card>
    </div>
    <Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Scénario secondaire</p><h3>Transformation possible</h3></div><span className="card-icon"><Icon name="change"/></span></div><p>{data.thesis.secondaryScenario}</p></Card>
    <Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Prochain focus</p><h3>Ce que le prochain monitor doit vérifier</h3></div><span className="card-icon"><Icon name="target"/></span></div><p>{data.thesis.nextFocus}</p><div className="brief-card__verdict">Valide jusqu’à {data.thesis.validUntil}</div></Card>

    <SectionTitle title="Niveaux de la thèse"/>
    <div className="levels-react">
      {data.levels.map(level => <Card key={`${level.price}-${level.role}`} className="level-react"><strong>{level.price}</strong><span>{level.role}</span><StatusBadge tone={level.state === "consumed" ? "critical" : level.state === "tested" ? "warning" : "info"}>{level.state}</StatusBadge></Card>)}
    </div>
    <SectionTitle title="Conditions courantes" subtitle={`Dernier Monitor · ${conditionsQuery.data?.monitorId || "indisponible"}`}/>
    <div className="content-grid">
      <Conditions title="Conditions WAIT → GO" items={conditionsQuery.data?.go || data.monitors.at(-1)?.goConditions || []}/>
      <Conditions title="Invalidations" items={conditionsQuery.data?.invalidations || data.monitors.at(-1)?.invalidationConditions || []}/>
    </div>
  </section>;
}
````

### `src/pages/TimelinePage.tsx`

````tsx
import { Card } from "@/components/common";
import { PageHeading } from "@/components/operations";
import { Timeline } from "@/components/deskCards";
import { useOverlay } from "@/context/OverlayContext";
import { deskDetailScope, useTimelineDetail } from "@/hooks/useDesk";
import { DeskPage } from "@/pages/pageState";
import type { DeskSession } from "@/types";

export default function TimelinePage() {
  const overlay = useOverlay();
  return <DeskPage>{data => <TimelineWorkspace initialData={data} onSelect={event => overlay.openDrawer(event.title, <div>
    <section className="drawer-section"><p>{event.summary}</p></section>
    <section className="drawer-section"><div className="detail-pairs"><div><span>Heure</span><strong>{event.time}</strong></div><div><span>Source</span><strong>{event.sourceType}</strong></div><div><span>Statut</span><strong>{event.status}</strong></div></div></section>
    <section className="drawer-section"><h3>Trace</h3><p>{event.detail}</p></section>
  </div>)}/>}</DeskPage>;
}

function TimelineWorkspace({ initialData, onSelect }: { initialData: DeskSession; onSelect: (event: DeskSession["timeline"][number]) => void }) {
  const query = useTimelineDetail(deskDetailScope(initialData));
  const data = { ...initialData, timeline: query.data?.timeline || initialData.timeline };
  return <section className="view">
    <PageHeading eyebrow="Traçabilité" title="Journal de décision" subtitle="Master → Thèse → Monitor → Setup → Position"/>
    <Card className="timeline-page-card">
      <Timeline data={data} onSelect={onSelect}/>
    </Card>
  </section>;
}
````

### `src/pages/WorkflowDetailPage.tsx`

````tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView, Modal } from "@/components/common";
import { ConfirmActionForm } from "@/components/ConfirmActionForm";
import { Breadcrumbs, EventTimeline, formatDateTime, formatDuration, MetricCard, PageHeading, ProgressBar, StatusTag } from "@/components/operations";
import { operationsKeys, useWorkflow } from "@/hooks/useOperations";
import type { OperationsCommandInput } from "@/operationsTypes";

export default function WorkflowDetailPage() {
  const { workflowId = "" } = useParams();
  const query = useWorkflow(decodeURIComponent(workflowId));
  const client = useQueryClient();
  const [action, setAction] = useState<OperationsCommandInput["action"] | "">("");
  const mutation = useMutation({
    mutationFn: (input: OperationsCommandInput) => operationsApi.executeWorkflowAction(decodeURIComponent(workflowId), input),
    onSuccess: async () => { setAction(""); await client.invalidateQueries({ queryKey: operationsKeys.all }); }
  });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Workflow introuvable"} retry={() => query.refetch()}/>;
  const { workflow, steps, events, allowedActions } = query.data;
  const expectedPhrase = action ? `CONFIRM_${action.toUpperCase()}` : "";
  return <section className="view workspace-view">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: workflow.name }]}/>
    <PageHeading eyebrow={workflow.kind} title={workflow.name} subtitle={workflow.sourceId} backTo="/operations" actions={<StatusTag status={workflow.status}/>}/>
    <div className="metric-grid metric-grid--compact">
      <MetricCard label="Progression" value={`${workflow.progress}%`} detail={workflow.rawStatus}/>
      <MetricCard label="Durée" value={formatDuration(workflow.durationMs)}/>
      <MetricCard label="Étapes" value={`${steps.filter(step => step.status === "completed").length}/${steps.length}`}/>
      <MetricCard label="Révision" value={workflow.revision}/>
    </div>
    <ProgressBar value={workflow.progress}/>
    {workflow.kind === "replay" && <div className="inline-actions"><Link className="primary-btn" to={`/replay/runs/${encodeURIComponent(workflow.sourceId)}`}>Ouvrir dans Replay Lab</Link>{workflow.currentWorkItemId && <Link className="secondary-btn" to={`/replay/runs/${encodeURIComponent(workflow.sourceId)}/gpt/${encodeURIComponent(workflow.currentWorkItemId)}`}>Processus GPT courant</Link>}</div>}
    {!!allowedActions.length && <Card className="command-panel">
      <div><p className="eyebrow">Actions contrôlées</p><h2>Intervenir sur le workflow</h2><p>Chaque action vérifie la révision, exige une clé d’idempotence et écrit un événement d’audit.</p></div>
      <div className="command-panel__actions">{allowedActions.map(item => <button type="button" className={item === "cancel" ? "danger-btn" : "secondary-btn"} key={item} onClick={() => setAction(item)}>{item}</button>)}</div>
    </Card>}
    <div className="content-grid content-grid--start">
      <Card className="workspace-panel"><h2>Étapes</h2>{!steps.length ? <p className="muted-copy">Ce workflow ne publie pas d’étapes détaillées.</p> : <ol className="step-list">{steps.map(step => <li key={step.id}><span>{step.sequence}</span><div><strong>{step.type}</strong><small>{formatDateTime(step.at)}</small></div><StatusTag status={step.status}/></li>)}</ol>}</Card>
      <Card className="workspace-panel"><h2>État canonique</h2><dl className="definition-grid"><dt>Stratégie</dt><dd>{workflow.strategyId || "—"}</dd><dt>Session</dt><dd>{workflow.session || "—"}</dd><dt>Date</dt><dd>{workflow.tradingDate || "—"}</dd><dt>Prochaine action</dt><dd>{workflow.nextAction || "—"}</dd><dt>Dernière mise à jour</dt><dd>{formatDateTime(workflow.updatedAt)}</dd></dl>{workflow.error && <div className="error-box"><strong>{workflow.error.code || "Erreur"}</strong><p>{workflow.error.message}</p></div>}</Card>
    </div>
    <div id="timeline-events"><h2>Événements</h2><EventTimeline events={events} runId={workflow.kind === "replay" ? workflow.sourceId : undefined} workflowId={workflow.id}/></div>
    <Modal open={Boolean(action)} title={`Confirmer · ${action}`} onClose={() => !mutation.isPending && setAction("")}>
      {action && <ConfirmActionForm
        key={action}
        target={workflow.name}
        revision={workflow.revision}
        expectedPhrase={expectedPhrase}
        onCancel={() => setAction("")}
        danger={action === "cancel"}
        onConfirm={({ confirmationPhrase, reason }) => mutation.mutateAsync({ action, expectedRevision: workflow.revision, idempotencyKey: crypto.randomUUID(), confirmationPhrase, reason }).then(() => undefined)}
      />}
    </Modal>
  </section>;
}
````

### `src/pages/WorkflowEventPage.tsx`

````tsx
import { useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, formatDateTime, PageHeading, StatusTag } from "@/components/operations";
import { useWorkflow } from "@/hooks/useOperations";

export default function WorkflowEventPage() {
  const { workflowId = "", eventId = "" } = useParams();
  const id = decodeURIComponent(workflowId);
  const query = useWorkflow(id);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Événement introuvable"} retry={() => query.refetch()}/>;
  const event = query.data.events.find(item => item.id === decodeURIComponent(eventId));
  if (!event) return <ErrorView message="Cet événement n’existe plus dans la projection du workflow." retry={() => query.refetch()}/>;
  return <section className="view workspace-view"><Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: query.data.workflow.name, to: `/operations/workflows/${encodeURIComponent(id)}` }, { label: event.title }]}/><PageHeading eyebrow={event.type} title={event.title} subtitle={formatDateTime(event.at)} backTo={`/operations/workflows/${encodeURIComponent(id)}`} actions={<StatusTag status={event.status}/>}/><Card className="workspace-panel"><h2>Détail de la transition</h2><p className="conclusion-copy">{event.detail || "Aucun détail complémentaire."}</p><dl className="definition-grid"><dt>Identifiant</dt><dd>{event.id}</dd><dt>Type</dt><dd>{event.type}</dd><dt>Acteur</dt><dd>{event.actor ? JSON.stringify(event.actor) : "backend"}</dd><dt>Référence</dt><dd>{event.ref ? JSON.stringify(event.ref) : "—"}</dd></dl></Card><details className="raw-inspector"><summary>Événement projeté</summary><pre>{JSON.stringify(event, null, 2)}</pre></details></section>;
}
````

### `src/styles/v2.css`

````css
:root {
  color-scheme: dark;
  --slate-950:#05080c;--slate-900:#080d13;--slate-850:#0d141d;--slate-800:#121c28;--slate-750:#1a2736;--slate-700:#253448;--slate-600:#34465d;
  --surface-0:#05080c;--surface-1:#080d13;--surface-2:#0d141d;--surface-3:#121c28;--line:#202d3d;--line-soft:rgba(163,184,210,.08);
  --overlay-scrim:rgba(6,9,13,.66);--elev-1:0 1px 2px rgba(0,0,0,.4);--elev-2:0 4px 12px rgba(0,0,0,.45);--elev-3:0 16px 48px rgba(0,0,0,.55);
  --text-primary:#e6edf3;--text-secondary:#9ba8b7;--text-tertiary:#6c7a8a;--text-disabled:#48535f;--text-on-accent:#04121f;--text-on-signal:#0a0e14;
  --accent:#4c8dff;--accent-hover:#6ba1ff;--accent-pressed:#3a78e6;--accent-soft:rgba(76,141,255,.14);--accent-border:rgba(76,141,255,.42);
  --positive:#3fb950;--positive-soft:rgba(63,185,80,.14);--negative:#f85149;--negative-soft:rgba(248,81,73,.14);--warning:#d29922;--warning-soft:rgba(210,153,34,.15);--info:#58a6ff;--info-soft:rgba(88,166,255,.14);--gpt:#a371f7;--gpt-soft:rgba(163,113,247,.15);--neutral-status:#6c7a8a;
  --layer-decision:#4c8dff;--layer-step:#58a6ff;--layer-gpt:#a371f7;--price-line:#e6edf3;
  --font-sans:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --space-0:0;--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:20px;--space-6:24px;--space-8:32px;--space-10:40px;--space-12:48px;--space-16:64px;
  --layout-max:1920px;--grid-gutter:12px;--content-pad-x:12px;--sidebar-w:248px;--sidebar-w-rail:64px;--topbar-h:56px;--context-h:40px;--bottomnav-h:56px;
  --radius-xs:1px;--radius-sm:2px;--radius-md:2px;--radius-lg:4px;--radius-pill:2px;
  --z-base:0;--z-sticky:20;--z-sidebar:40;--z-topbar:50;--z-scrim:70;--z-drawer:80;--z-modal:90;--z-popover:100;--z-toast:110;
  --dur-1:120ms;--dur-2:160ms;--dur-3:200ms;--dur-4:240ms;--ease-standard:cubic-bezier(.2,0,0,1);--ease-out:cubic-bezier(0,0,0,1);--ease-in:cubic-bezier(.3,0,1,1);
  --row-h:28px;--control-h:28px;--pad-card:8px;--gap-section:8px;
  --bg:var(--surface-0);--panel:var(--surface-1);--panel-2:var(--surface-2);--muted:var(--text-secondary);--muted-2:var(--text-tertiary);--border:var(--line);--critical:var(--negative);
}

:root[data-density="comfortable"]{--row-h:36px;--control-h:34px;--pad-card:12px;--gap-section:14px}
*{box-sizing:border-box}
html{background:var(--surface-0);font-family:var(--font-sans);font-feature-settings:"tnum" 1,"cv01" 1;scroll-behavior:smooth}
body{margin:0;background:var(--surface-0)!important;color:var(--text-primary);font:440 12px/16px var(--font-sans);min-width:320px;background-image:none!important}
button,input,select,textarea{font:inherit} button,a,input,select,textarea{transition:color var(--dur-1) var(--ease-standard),background var(--dur-1) var(--ease-standard),border-color var(--dur-1) var(--ease-standard),opacity var(--dur-1) var(--ease-standard)}
a{color:inherit;text-decoration:none}button{color:inherit}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent)!important;outline-offset:2px}
code,pre,kbd,.mono,.data-table small,.workspace-heading__main>div>p:last-child{font-family:var(--font-mono)}
.skip-link{position:fixed;left:12px;top:-60px;z-index:999;background:var(--accent);color:var(--text-on-accent);padding:8px 12px;border-radius:var(--radius-sm);font-weight:600}.skip-link:focus{top:10px}

.app-shell-v2{min-height:100dvh;display:grid;grid-template-columns:var(--sidebar-w) minmax(0,1fr);grid-template-rows:var(--topbar-h) minmax(0,1fr);background:var(--surface-0)}
.app-shell-v2.is-collapsed{grid-template-columns:var(--sidebar-w-rail) minmax(0,1fr)}
.app-sidebar{grid-column:1;grid-row:1/3;position:sticky;top:0;height:100dvh;z-index:var(--z-sidebar);display:flex;flex-direction:column;background:var(--surface-1);border-right:1px solid var(--line);overflow:hidden;transition:width var(--dur-3) var(--ease-standard)}
.app-sidebar__brand{height:56px;flex:0 0 56px;padding:0 10px 0 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}
.app-sidebar__brand>a{display:flex;align-items:center;gap:10px;min-width:0}.app-sidebar__brand-copy{display:grid;line-height:16px;white-space:nowrap}.app-sidebar__brand-copy strong{font-size:15px;font-weight:620}.app-sidebar__brand-copy small{font-size:11px;color:var(--text-tertiary)}
.brand-mark{display:inline-grid!important;grid-template-columns:repeat(3,3px);align-items:end;gap:2px;width:14px!important;height:20px!important;border:0!important;background:none!important;border-radius:0!important}.brand-mark span{display:block!important;width:3px!important;background:var(--accent)!important;border-radius:1px!important}.brand-mark span:nth-child(1){height:9px}.brand-mark span:nth-child(2){height:16px}.brand-mark span:nth-child(3){height:12px}
.api-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent);margin-right:4px}.icon-btn{width:var(--control-h);height:var(--control-h);min-width:32px;display:inline-grid;place-items:center;border:1px solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--text-secondary);cursor:pointer}.icon-btn:hover{background:var(--surface-3);border-color:var(--line);color:var(--text-primary)}
.session-context-card{margin:12px;padding:12px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--radius-md);display:grid;gap:8px}.session-context-card>p{margin:0;color:var(--text-tertiary);font-size:11px;line-height:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}.session-context-card>div:first-of-type{display:flex;align-items:center;gap:8px}.session-context-card strong{font-weight:600}.session-context-card em,.mobile-context em,.more-session-context em{margin-left:auto;color:var(--accent);font-style:normal;font:600 10px/18px var(--font-mono);letter-spacing:.06em}.phase-orb{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--accent-soft);border:1px solid var(--accent-border);color:var(--accent);font:600 11px/1 var(--font-mono)}
.phase-track{display:grid!important;grid-template-columns:repeat(3,1fr);gap:2px;padding:2px;background:var(--surface-1);border-radius:var(--radius-xs)}.phase-track span{padding:3px 1px;text-align:center;color:var(--text-tertiary);font-size:9px;font-weight:600;border-radius:3px}.phase-track span.active{background:var(--surface-3);color:var(--text-primary)}.session-context-card>small{color:var(--text-tertiary);font-size:11px}
.domain-nav{flex:1;overflow:auto;padding:0 8px 16px;scrollbar-width:thin}.domain-nav__group{margin-top:14px}.domain-nav__group h2{margin:0 8px 5px;color:var(--text-tertiary);font-size:10px;line-height:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}.domain-nav__group a{position:relative;height:var(--row-h);padding:0 10px;display:grid;grid-template-columns:20px minmax(0,1fr);align-items:center;gap:10px;border-radius:var(--radius-sm);color:var(--text-secondary);font-size:13px}.domain-nav__group a:hover{background:var(--surface-2);color:var(--text-primary)}.domain-nav__group a.active{background:var(--surface-2);color:var(--text-primary);box-shadow:inset 2px 0 var(--accent)}.domain-nav__group a.active svg{color:var(--accent)}
.app-sidebar__footer{padding:10px 12px;border-top:1px solid var(--line);display:grid;gap:9px}.density-toggle{display:grid;grid-template-columns:1fr 1fr;background:var(--surface-2);padding:2px;border-radius:var(--radius-sm)}.density-toggle button{height:28px;border:0;border-radius:4px;background:transparent;color:var(--text-tertiary);font-size:11px;cursor:pointer}.density-toggle button.active{background:var(--surface-3);color:var(--text-primary)}.auth-state{color:var(--text-tertiary);font-size:11px}.auth-state i{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--warning);margin-right:5px}
.is-collapsed .app-sidebar__brand-copy,.is-collapsed .session-context-card>p,.is-collapsed .session-context-card strong,.is-collapsed .session-context-card em,.is-collapsed .session-context-card small,.is-collapsed .phase-track,.is-collapsed .domain-nav__group h2,.is-collapsed .domain-nav__group a span,.is-collapsed .app-sidebar__footer{display:none}.is-collapsed .app-sidebar__brand{padding:0;justify-content:center}.is-collapsed .app-sidebar__brand>a{display:none}.is-collapsed .session-context-card{margin:12px 10px;padding:8px;place-items:center}.is-collapsed .session-context-card>div:first-of-type{display:block}.is-collapsed .domain-nav{padding-inline:8px}.is-collapsed .domain-nav__group a{grid-template-columns:1fr;padding:0;place-items:center}.is-collapsed .domain-nav__group{padding-top:7px;border-top:1px solid var(--line-soft)}
.app-topbar{grid-column:2;grid-row:1;position:sticky;top:0;z-index:var(--z-topbar);height:56px;display:flex;align-items:center;justify-content:center;padding:0 24px;background:var(--surface-0);border-bottom:1px solid var(--line)}.global-search{width:min(420px,42vw);height:32px;padding:0 8px;display:grid;grid-template-columns:16px 1fr auto;align-items:center;gap:7px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--radius-sm);color:var(--text-tertiary)}.global-search input{min-width:0;border:0;outline:0;background:transparent;color:var(--text-primary);font-size:12px}.global-search kbd{padding:1px 5px;border:1px solid var(--line);border-radius:3px;background:var(--surface-1);color:var(--text-tertiary);font-size:10px}.app-topbar__actions{position:absolute;right:24px;display:flex;gap:5px}.notification-btn{position:relative}.notification-btn>span{position:absolute;right:-3px;top:-3px;min-width:16px;height:16px;padding:0 3px;display:grid;place-items:center;border-radius:9px;background:var(--negative);color:#fff;font-size:9px;font-weight:700}.mobile-brand,.mobile-context{display:none!important}
.app-main{grid-column:2;grid-row:2;min-width:0!important;max-width:none!important;width:100%!important;min-height:0!important;height:calc(100dvh - 56px);margin:0!important;padding:20px var(--content-pad-x);padding-bottom:20px!important;overflow:auto;scrollbar-gutter:stable}
.view{width:min(100%,var(--layout-max))!important;max-width:var(--layout-max)!important;margin:0 auto!important;padding:0!important;display:grid;gap:var(--gap-section)}

.app-shell-v2.is-collapsed .app-topbar,.app-shell-v2.is-collapsed .app-main{grid-column:2}
.bottom-nav{display:none}
.more-session-context{display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--surface-1);border:1px solid var(--line);border-radius:var(--radius-md)}.more-session-context div{display:grid}.more-session-context small{color:var(--text-tertiary);font-size:11px}.more-session-context>span:last-child{color:var(--text-secondary);font-size:12px}.more-domains{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.more-domains>section{border:1px solid var(--line);border-radius:var(--radius-md);overflow:hidden;background:var(--surface-1)}.more-domains h2{margin:0;padding:11px 14px;border-bottom:1px solid var(--line);color:var(--text-secondary);font-size:11px;text-transform:uppercase;letter-spacing:.08em}.more-domains>section>div{display:grid}.more-domains a{min-height:52px;padding:8px 12px;display:grid;grid-template-columns:20px minmax(0,1fr) 16px;align-items:center;gap:10px;border-bottom:1px solid var(--line-soft)}.more-domains a:last-child{border:0}.more-domains a:hover{background:var(--surface-2)}.more-domains a>span{display:grid}.more-domains a strong{font-size:13px}.more-domains a small{color:var(--text-tertiary);font-size:11px}

@media(max-width:1023px){
  :root{--content-pad-x:20px;--grid-gutter:16px;--row-h:44px;--control-h:40px;--pad-card:16px;--gap-section:20px}
  .app-shell-v2,.app-shell-v2.is-collapsed{display:grid;grid-template-columns:1fr;grid-template-rows:56px 40px minmax(0,1fr) calc(56px + env(safe-area-inset-bottom));width:100%;height:100dvh;min-height:0;overflow:hidden;padding:0}
  .app-sidebar,.global-search,.app-topbar__actions{display:none}.app-topbar{grid-column:1;grid-row:1;position:relative;padding:0 16px;justify-content:space-between}.mobile-brand{display:flex!important;align-items:center;gap:9px;border:0;background:transparent;padding:0;color:var(--text-primary)}.mobile-brand>span:last-child{display:grid;text-align:left;line-height:15px}.mobile-brand strong{font-size:14px}.mobile-brand small{font-size:10px;color:var(--text-tertiary)}.app-topbar:after{content:"";width:36px}
  .mobile-context{grid-column:1;grid-row:2;display:flex!important;align-items:center;gap:7px;width:100%;height:40px;padding:0 16px;background:var(--surface-1);border:0;border-bottom:1px solid var(--line);color:var(--text-primary);font-size:12px;text-align:left;cursor:pointer}.mobile-context em{margin-left:0}.mobile-context span{margin-left:auto;color:var(--text-tertiary);font:500 11px/1 var(--font-mono)}
  .app-main{grid-column:1;grid-row:3;height:auto;min-height:0;padding:16px var(--content-pad-x);overflow:auto;overscroll-behavior-y:contain}.bottom-nav{grid-column:1;grid-row:4;display:grid;grid-template-columns:repeat(5,1fr);position:relative;z-index:var(--z-sidebar);height:calc(56px + env(safe-area-inset-bottom));padding-bottom:env(safe-area-inset-bottom);background:var(--surface-1);border-top:1px solid var(--line)}.bottom-nav__item{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:var(--text-tertiary);font-size:10px;font-weight:600}.bottom-nav__item svg{width:20px;height:20px}.bottom-nav__item.active{color:var(--accent)}.bottom-nav__item.active:before{content:"";position:absolute;top:0;width:28px;height:2px;background:var(--accent)}
  .more-domains{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:767px){:root{--content-pad-x:16px;--grid-gutter:12px}.more-domains{grid-template-columns:1fr}.more-session-context{flex-wrap:wrap}.more-session-context>span:last-child{width:100%;padding-left:30px}}
@media(max-width:359px){:root{--content-pad-x:12px}}
@media(pointer:coarse){:root{--row-h:44px;--control-h:40px;--pad-card:16px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}

/* Foundations and shared primitives */
.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
.eyebrow{margin:0 0 3px!important;color:var(--text-tertiary)!important;font:650 10px/14px var(--font-sans)!important;letter-spacing:.09em!important;text-transform:uppercase!important}
.muted-copy,.empty-copy{color:var(--text-secondary)}
.positive{color:var(--positive)!important}.negative{color:var(--negative)!important}
.card{min-width:0;margin:0!important;padding:var(--pad-card)!important;background:var(--surface-1)!important;background-image:none!important;border:1px solid var(--line)!important;border-radius:var(--radius-md)!important;box-shadow:none!important;color:var(--text-primary)}
.card::before,.card::after{display:none!important}.card--clickable{cursor:pointer}.card--clickable:hover{background:var(--surface-2)!important;border-color:var(--slate-600)!important}
.section-title{display:flex!important;align-items:flex-end!important;justify-content:space-between!important;gap:16px!important;margin:4px 0 0!important;padding:0!important;border:0!important;background:none!important}.section-title h2,.panel-heading h2{margin:0;color:var(--text-primary);font-size:15px;line-height:20px;font-weight:620;letter-spacing:-.01em}.section-title p{margin:2px 0 0;color:var(--text-tertiary);font-size:12px}
.primary-btn,.secondary-btn,.danger-btn,.text-btn,.back-btn{min-height:var(--control-h);padding:0 12px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:var(--radius-sm);font-size:12px;font-weight:620;line-height:1;cursor:pointer;white-space:nowrap}
.primary-btn{border:1px solid var(--accent);background:var(--accent);color:var(--text-on-accent);box-shadow:none}.primary-btn:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
.secondary-btn{border:1px solid var(--line);background:var(--surface-2);color:var(--text-primary)}.secondary-btn:hover{background:var(--surface-3);border-color:var(--slate-600)}
.danger-btn{border:1px solid var(--negative);background:var(--negative-soft);color:var(--negative)}.danger-btn:hover{background:var(--negative);color:#fff}
.text-btn,.back-btn{padding-inline:7px;border:1px solid transparent;background:transparent;color:var(--text-secondary)}.text-btn:hover,.back-btn:hover{background:var(--surface-2);color:var(--text-primary)}
button:disabled{opacity:.42;cursor:not-allowed!important;filter:none!important}
label{color:var(--text-secondary);font-size:12px;font-weight:550}input,select,textarea{width:100%;min-height:var(--control-h);margin-top:5px;padding:6px 9px;border:1px solid var(--line);border-radius:var(--radius-sm);outline:0;background:var(--surface-2);color:var(--text-primary)}textarea{min-height:88px;resize:vertical}input::placeholder,textarea::placeholder{color:var(--text-disabled)}select{color-scheme:dark}
.inline-actions,.workspace-heading__actions,.command-panel__actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}

/* Page heading and navigation */
.breadcrumbs{min-height:18px;display:flex;align-items:center;gap:4px;color:var(--text-tertiary);font-size:11px}.breadcrumbs>span{display:inline-flex;align-items:center;gap:4px}.breadcrumbs a:hover{color:var(--accent)}.breadcrumbs strong{color:var(--text-secondary);font-weight:540}
.workspace-heading.page-header-v2{position:relative;min-height:72px;margin:0!important;padding:0 0 14px!important;display:grid!important;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:16px;border-bottom:1px solid var(--line)!important;background:none!important}.workspace-heading__main{min-width:0;display:flex;align-items:flex-start;gap:8px}.workspace-heading__main h1{margin:0;color:var(--text-primary);font-size:24px;line-height:30px;font-weight:650;letter-spacing:-.025em}.workspace-heading__main p:last-child{margin:3px 0 0;color:var(--text-secondary);font-size:12px;line-height:17px}.back-btn{margin-top:16px;padding:0;width:32px;flex:0 0 32px}.page-header-v2__tabs{grid-column:1/-1;display:flex;align-items:center;gap:18px;margin-bottom:-15px;overflow:auto}.page-header-v2__tabs a,.page-header-v2__tabs button{height:34px;border:0;border-bottom:2px solid transparent;background:none;color:var(--text-tertiary);font-size:12px;white-space:nowrap}.page-header-v2__tabs .active,.page-header-v2__tabs [aria-current="page"]{border-color:var(--accent);color:var(--text-primary)}

/* Signals, metrics and progress */
.status-pill,.status-chip,.action-pill{width:max-content;min-height:22px;padding:2px 7px;display:inline-flex!important;align-items:center;gap:5px;border:1px solid var(--line)!important;border-radius:var(--radius-pill)!important;background:var(--surface-2)!important;color:var(--text-secondary)!important;font:620 10px/16px var(--font-sans)!important;letter-spacing:.025em;text-transform:uppercase;white-space:nowrap}.status-pill i{font-style:normal;font:700 11px/1 var(--font-mono)}
.status-pill--completed,.status-pill--resolved,.status-pill--acknowledged,.status-pill--read,.status-pill--positive{border-color:rgba(63,185,80,.34)!important;background:var(--positive-soft)!important;color:var(--positive)!important}.status-pill--failed,.status-pill--cancelled,.status-pill--open,.status-pill--critical,.status-pill--action_required{border-color:rgba(248,81,73,.38)!important;background:var(--negative-soft)!important;color:var(--negative)!important}.status-pill--blocked,.status-pill--paused,.status-pill--snoozed,.status-pill--pending,.status-pill--warning,.status-pill--waiting{border-color:rgba(210,153,34,.38)!important;background:var(--warning-soft)!important;color:var(--warning)!important}.status-pill--running,.status-pill--info,.status-pill--watching{border-color:var(--accent-border)!important;background:var(--accent-soft)!important;color:var(--accent)!important}.status-pill--waiting_gpt{border-color:rgba(163,113,247,.38)!important;background:var(--gpt-soft)!important;color:var(--gpt)!important}.status-pill--muted,.status-pill--queued,.status-pill--unknown,.status-pill--archived,.status-pill--dismissed,.status-pill--cleared{border-color:var(--line)!important;background:var(--surface-2)!important;color:var(--text-tertiary)!important}
.metric-grid,.metric-strip{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:0!important;border:1px solid var(--line);border-radius:var(--radius-md);overflow:hidden;background:var(--surface-1)}.metric-card{min-width:0;min-height:78px;margin:0!important;padding:12px 14px!important;display:flex!important;flex-direction:column;align-items:flex-start!important;justify-content:center;border:0!important;border-right:1px solid var(--line)!important;border-radius:0!important;background:transparent!important;color:var(--text-primary);text-align:left;box-shadow:none!important}.metric-card:last-child{border-right:0!important}.metric-card>span{color:var(--text-tertiary)!important;font-size:10px!important;line-height:14px;text-transform:uppercase;letter-spacing:.06em}.metric-card>strong{margin-top:2px;color:var(--text-primary);font:650 20px/25px var(--font-mono);letter-spacing:-.025em}.metric-card>small{margin-top:1px;color:var(--text-tertiary);font-size:10px}.metric-card--positive>strong{color:var(--positive)}.metric-card--negative>strong,.metric-card--critical>strong{color:var(--negative)}.metric-card--warning>strong{color:var(--warning)}.metric-card--interactive{cursor:pointer}.metric-card--interactive:hover{background:var(--surface-2)!important}.metric-grid--compact .metric-card{min-height:68px}
.metric-strip--six{grid-template-columns:repeat(6,minmax(0,1fr))}
.progress-line{position:relative;min-width:112px;height:14px;display:flex;align-items:center;gap:7px}.progress-line:before{content:"";position:absolute;left:0;right:36px;height:4px;border-radius:2px;background:var(--surface-3)}.progress-line i{position:relative;height:4px;max-width:calc(100% - 36px);border-radius:2px;background:var(--accent)}.progress-line span{margin-left:auto;color:var(--text-tertiary);font:550 10px/1 var(--font-mono)}.progress-line--failed i,.progress-line--blocked i{background:var(--negative)}.progress-line--completed i{background:var(--positive)}

/* Data tables turn into labelled cards below 768px */
.data-table-wrap{width:100%;min-width:0;overflow:hidden;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--surface-1)}.data-table{width:100%;min-width:0!important;border-collapse:collapse;table-layout:auto}.data-table thead{background:var(--surface-2)}.data-table th{height:32px;padding:0 12px;border-bottom:1px solid var(--line);color:var(--text-tertiary);font-size:10px;font-weight:620;letter-spacing:.055em;text-align:left;text-transform:uppercase;white-space:nowrap}.data-table td{height:var(--row-h);padding:7px 12px;border-bottom:1px solid var(--line-soft);color:var(--text-secondary);font-size:12px;vertical-align:middle}.data-table tbody tr:last-child td{border-bottom:0}.data-table tbody tr:hover{background:var(--surface-2)}.data-table td>strong{display:block;color:var(--text-primary);font-weight:600}.data-table td>small{display:block;color:var(--text-tertiary);font-size:10px}.data-table time{font-family:var(--font-mono);font-size:10px;white-space:nowrap}.row-link{display:inline-flex;align-items:center;gap:3px;color:var(--accent);font-size:11px;font-weight:600}.row-link:hover{color:var(--accent-hover)}

/* Panels, definitions, lists and state views */
.content-grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--gap-section)!important}.content-grid--start{align-items:start}.content-grid--briefs{grid-template-columns:repeat(3,minmax(0,1fr))!important}.workspace-panel{display:grid;gap:12px}.workspace-panel>h2,.command-panel h2,.decision-chart h2{margin:0;color:var(--text-primary);font-size:15px;line-height:20px;font-weight:620}.definition-grid,.detail-pairs{margin:0;display:grid;grid-template-columns:minmax(100px,.65fr) minmax(0,1fr);gap:0!important}.definition-grid dt,.definition-grid dd,.detail-pairs>div{min-height:var(--row-h);margin:0;padding:7px 0;border-bottom:1px solid var(--line-soft)}.definition-grid dt{color:var(--text-tertiary);font-size:11px}.definition-grid dd{color:var(--text-primary);font:540 11px/18px var(--font-mono);text-align:right}.detail-pairs>div{display:flex;align-items:center;justify-content:space-between;gap:12px}.detail-pairs small{color:var(--text-tertiary)}.detail-pairs strong{font-family:var(--font-mono);font-weight:580;text-align:right}.detail-pairs--four{grid-template-columns:repeat(4,minmax(0,1fr))}
.workspace-empty,.empty-state{min-height:180px;display:flex!important;flex-direction:column;align-items:center;justify-content:center;text-align:center}.workspace-empty svg,.empty-state__icon{color:var(--text-tertiary)}.workspace-empty h3,.empty-state h3{margin:10px 0 3px;font-size:15px}.workspace-empty p,.empty-state p{max-width:520px;margin:0 0 14px;color:var(--text-secondary);font-size:12px}.error-box,.performance-error{padding:10px 12px;border:1px solid rgba(248,81,73,.35);border-radius:var(--radius-sm);background:var(--negative-soft);color:var(--negative)}.error-box p{margin:3px 0 0;color:var(--text-secondary)}
.skeleton{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--surface-1)!important;animation:v2-pulse 1.4s ease-in-out infinite}.skeleton:after{display:none}.loading-hero{height:100px}.loading-row{height:64px}@keyframes v2-pulse{50%{background:var(--surface-2)!important}}

/* Event and replay timelines */
.event-timeline{position:relative;margin:0;padding:0;list-style:none}.event-timeline:before{content:"";position:absolute;left:127px;top:13px;bottom:13px;width:1px;background:var(--line)}.event-timeline>li{display:grid;grid-template-columns:112px 15px minmax(0,1fr);gap:8px;align-items:start;padding:5px 0}.event-timeline>li>time{padding-top:9px;color:var(--text-tertiary);font:520 10px/14px var(--font-mono);text-align:right}.event-timeline>li>i{position:relative;z-index:1;width:9px;height:9px;margin:11px 0 0 3px;border:2px solid var(--surface-0);border-radius:50%;background:var(--info);box-shadow:0 0 0 1px var(--line)}.event-timeline>li[data-layer="decision"]>i{border-radius:1px;background:var(--layer-decision);transform:rotate(45deg)}.event-timeline>li[data-layer="gpt"]>i{border-radius:0;background:var(--layer-gpt);clip-path:polygon(50% 0,100% 100%,0 100%)}.event-timeline>li>div{padding:8px 10px;border:1px solid transparent;border-radius:var(--radius-sm)}.event-timeline>li>div:hover,.event-timeline>li.is-selected>div{border-color:var(--accent-border);background:var(--surface-1)}.event-timeline__top{display:flex;align-items:center;justify-content:space-between;gap:10px}.event-timeline p{margin:3px 0;color:var(--text-secondary);font-size:11px}.event-timeline a{display:inline-flex;align-items:center;gap:3px;color:var(--accent);font-size:10px}
.decision-chart{padding:0!important;overflow:hidden}.decision-chart>header{padding:12px 14px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line)}.decision-chart>header small{color:var(--text-tertiary);font:500 10px/14px var(--font-mono)}.chart-controls{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap}.zoom-control{height:30px;display:flex;align-items:center;border:1px solid var(--line);border-radius:var(--radius-sm);overflow:hidden;background:var(--surface-2)}.zoom-control button{width:29px;height:100%;border:0;background:transparent;color:var(--text-secondary);cursor:pointer}.zoom-control button:hover{background:var(--surface-3)}.zoom-control label{height:100%;padding:0 7px;display:flex;align-items:center;gap:6px;border-inline:1px solid var(--line);font-size:10px}.zoom-control input{width:70px;min-height:0;margin:0;padding:0;accent-color:var(--accent)}.layer-toggles{display:flex;align-items:center;gap:4px}.layer-toggles button{height:30px;padding:0 8px;display:flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-2);color:var(--text-tertiary);font-size:10px;cursor:pointer}.layer-toggles button.active{color:var(--text-primary);border-color:var(--slate-600)}.layer-toggles i{width:7px;height:7px;border-radius:50%;background:var(--text-disabled)}.layer-toggles [data-layer="decision"] i{border-radius:1px;background:var(--layer-decision);transform:rotate(45deg)}.layer-toggles [data-layer="step"] i{background:var(--layer-step)}.layer-toggles [data-layer="gpt"] i{border-radius:0;background:var(--layer-gpt);clip-path:polygon(50% 0,100% 100%,0 100%)}
.chart-scroll{overflow:hidden;background:var(--surface-0)}.chart-scroll svg{display:block;width:100%;height:420px}.chart-scroll text{fill:var(--text-tertiary);font:10px var(--font-mono)}.chart-grid{stroke:var(--line-soft);stroke-width:1}.price-area{fill:rgba(230,237,243,.035)}.price-line{fill:none;stroke:var(--price-line);stroke-width:1.7;vector-effect:non-scaling-stroke}.chart-marker{cursor:pointer;outline:none}.chart-marker>line{stroke:currentColor;stroke-width:.6;stroke-dasharray:3 4;opacity:.25}.chart-marker circle,.chart-marker rect,.chart-marker path{fill:currentColor;stroke:var(--surface-0);stroke-width:2;vector-effect:non-scaling-stroke}.chart-marker--decision{color:var(--layer-decision)}.chart-marker--step{color:var(--layer-step)}.chart-marker--gpt{color:var(--layer-gpt)}.chart-marker:focus circle,.chart-marker:focus rect,.chart-marker:focus path,.chart-marker.is-selected circle,.chart-marker.is-selected rect,.chart-marker.is-selected path{stroke:var(--text-primary);stroke-width:4}.chart-tooltip line{stroke:var(--text-secondary);stroke-width:1}.chart-tooltip rect{fill:var(--surface-3);stroke:var(--slate-600)}.chart-tooltip text{fill:var(--text-primary);font-size:10px}.chart-empty{min-height:240px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--text-tertiary)}.chart-empty strong{margin-top:8px;color:var(--text-primary)}.chart-empty>p{max-width:410px;margin:4px 0;font-size:11px}.chart-fallback-timeline{width:min(100%,760px);max-height:280px;margin:14px 0 0;padding:0;overflow:auto;display:grid;list-style:none;text-align:left;border:1px solid var(--line);border-radius:var(--radius-sm)}.chart-fallback-timeline li{min-height:48px;padding:7px 9px;display:grid;grid-template-columns:54px minmax(0,1fr) auto;align-items:center;gap:10px;border-bottom:1px solid var(--line-soft)}.chart-fallback-timeline li:last-child{border:0}.chart-fallback-timeline time{font:10px var(--font-mono)}.chart-fallback-timeline span,.chart-fallback-timeline strong,.chart-fallback-timeline small{display:block}.chart-fallback-timeline small{color:var(--text-tertiary)}.chart-event-strip{display:flex;overflow:auto;border-top:1px solid var(--line);background:var(--surface-1)}.chart-event-strip a{min-width:130px;padding:7px 9px;display:grid;grid-template-columns:7px 1fr;gap:0 5px;border-right:1px solid var(--line-soft)}.chart-event-strip a:hover,.chart-event-strip a.is-selected{background:var(--surface-2)}.chart-event-strip i{grid-row:1/3;width:6px;height:6px;margin-top:5px;border-radius:50%;background:var(--info)}.chart-event-strip i[data-layer="decision"]{border-radius:1px;background:var(--layer-decision);transform:rotate(45deg)}.chart-event-strip i[data-layer="gpt"]{border-radius:0;background:var(--layer-gpt);clip-path:polygon(50% 0,100% 100%,0 100%)}.chart-event-strip span{color:var(--text-tertiary);font:500 9px/12px var(--font-mono)}.chart-event-strip strong{overflow:hidden;color:var(--text-secondary);font-size:10px;text-overflow:ellipsis;white-space:nowrap}

/* Controlled action overlay */
.scrim{position:fixed;inset:0;z-index:var(--z-scrim);visibility:hidden;border:0;background:var(--overlay-scrim);opacity:0;pointer-events:none;backdrop-filter:none!important}.scrim.open{visibility:visible;opacity:1;pointer-events:auto}.modal,.drawer{position:fixed;z-index:var(--z-modal);visibility:hidden;opacity:0;pointer-events:none}.modal.open,.drawer.open{visibility:visible;opacity:1;pointer-events:auto}.modal{inset:0;display:grid;place-items:center;padding:20px}.modal__card{position:relative;width:min(100%,560px);max-height:calc(100dvh - 40px);padding:20px;overflow:auto;border:1px solid var(--slate-600);border-radius:var(--radius-lg);background:var(--surface-1);box-shadow:var(--elev-3)}.modal__card>h2{margin:0 40px 14px 0;font-size:18px;line-height:24px}.modal__close{position:absolute;right:12px;top:12px}.modal__icon{display:none}.modal__actions{display:flex;justify-content:flex-end;gap:8px;padding-top:4px}.drawer{right:0;top:0;bottom:0;width:min(480px,100%);transform:translateX(20px);background:var(--surface-1);border-left:1px solid var(--slate-600);box-shadow:var(--elev-3)}.drawer.open{transform:translateX(0)}.drawer__grab{display:none}.drawer__header{height:64px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.drawer__header h2{margin:0;font-size:17px}.drawer__content{height:calc(100% - 64px);padding:16px;overflow:auto}.overlay-open{overflow:hidden}
.confirm-action{display:grid;gap:13px}.confirm-action__scope{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-2)}.confirm-action__scope>div{min-width:0;padding:9px 11px;display:grid;gap:2px}.confirm-action__scope>div+div{border-left:1px solid var(--line)}.confirm-action__scope span{color:var(--text-tertiary);font-size:10px;text-transform:uppercase;letter-spacing:.05em}.confirm-action__scope strong{overflow:hidden;color:var(--text-primary);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.confirm-action__warning{padding:9px 11px;display:grid;grid-template-columns:18px 1fr;gap:8px;border:1px solid rgba(210,153,34,.3);border-radius:var(--radius-sm);background:var(--warning-soft);color:var(--warning)}.confirm-action__warning p{margin:0;color:var(--text-secondary);font-size:11px}.confirm-action label{display:block}.confirm-action label>small{display:block;margin-top:3px;color:var(--text-tertiary);font-size:9px;text-align:right}.confirm-action__phrase{display:block;margin-top:4px;color:var(--text-tertiary);font-size:10px}.confirm-action code{padding:2px 5px;border:1px solid var(--accent-border);border-radius:3px;background:var(--accent-soft);color:var(--accent)}.confirm-action__action{display:block;margin-bottom:12px}.operator-feedback{margin:0;padding:8px 10px;border-radius:var(--radius-sm);background:var(--positive-soft);color:var(--positive);font-size:11px}.operator-feedback--error,.form-error{background:var(--negative-soft);color:var(--negative)}

/* Core workflow and detail screen patterns */
.workspace-toolbar{padding:8px!important;display:flex;align-items:center;justify-content:space-between;gap:10px}.workspace-toolbar>div{display:flex;gap:6px;flex-wrap:wrap}.command-panel{display:flex;align-items:center;justify-content:space-between;gap:18px;border-left:2px solid var(--warning)!important}.command-panel p{max-width:700px;margin:3px 0 0;color:var(--text-secondary);font-size:11px}.step-list{margin:0;padding:0;display:grid;list-style:none}.step-list>li{min-height:var(--row-h);display:grid;grid-template-columns:26px minmax(0,1fr) auto;align-items:center;gap:8px;border-bottom:1px solid var(--line-soft)}.step-list>li:last-child{border:0}.step-list>li>span{display:grid;place-items:center;width:20px;height:20px;border:1px solid var(--line);border-radius:50%;color:var(--text-tertiary);font:600 9px/1 var(--font-mono)}.step-list strong,.step-list small{display:block}.step-list strong{font-size:11px}.step-list small{color:var(--text-tertiary);font:9px/13px var(--font-mono)}.incident-list{display:grid;gap:8px}.incident-card{padding:12px 14px!important;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:16px}.incident-card>div:last-child{display:flex;align-items:center;gap:8px}.incident-card__title{display:flex;align-items:center;gap:10px}.incident-card__title i{width:8px;height:8px;border-radius:50%;background:var(--info)}.incident-card__title i[data-severity="critical"]{background:var(--negative)}.incident-card__title i[data-severity="warning"]{background:var(--warning)}.incident-card__title strong,.incident-card__title small{display:block}.incident-card__title small{color:var(--text-tertiary);font-size:10px}.incident-card p{margin:5px 0 0 18px;color:var(--text-secondary);font-size:11px}
.raw-inspector{margin:0;max-height:420px;padding:12px;overflow:auto;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-0);color:var(--text-secondary);font:10px/16px var(--font-mono);white-space:pre-wrap}.conclusion-copy{margin:0;color:var(--text-primary);font-size:14px;line-height:22px}.tag-list{display:flex;gap:5px;flex-wrap:wrap}.tag-list>span{padding:3px 7px;border:1px solid var(--line);border-radius:var(--radius-pill);background:var(--surface-2);color:var(--text-secondary);font-size:10px}
.raw-inspector>summary{cursor:pointer;color:var(--text-secondary);font:600 11px/18px var(--font-sans)}.raw-inspector>pre{margin:10px 0 0}.strategy-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.strategy-card{height:100%;display:grid;gap:12px}.strategy-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.strategy-card h2{margin:0;font:650 17px/22px var(--font-mono)}.strategy-card>header>span{padding:2px 6px;border:1px solid var(--line);border-radius:var(--radius-pill);color:var(--text-tertiary);font-size:9px}.version-list{display:grid}.version-list>div{min-height:var(--row-h);padding:6px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line-soft)}.version-list>div:last-child{border:0}.version-list strong{font:560 11px/17px var(--font-mono)}.version-list small{color:var(--text-tertiary);font-size:9px}.session-list-react{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.session-card-react{min-height:150px;display:flex!important;flex-direction:column;justify-content:space-between}.session-card-react h2{margin:0;font-size:19px}.session-card-react p:not(.eyebrow){margin:4px 0;color:var(--text-secondary)}.session-card-react.active{border-color:var(--accent-border)!important;box-shadow:inset 2px 0 var(--accent)!important}.automatic-phase-state{width:max-content;padding:3px 7px;border:1px solid var(--line);border-radius:var(--radius-pill);color:var(--text-tertiary);font-size:9px}.session-card-react.active .automatic-phase-state{border-color:var(--accent-border);background:var(--accent-soft);color:var(--accent)}
.session-day-timeline{display:grid;gap:14px}.session-day-timeline>header,.session-context-detail>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.session-day-timeline h2,.session-context-detail h2{margin:0;font-size:16px}.session-day-timeline>p{margin:0;color:var(--text-secondary);font-size:12px}.session-day-timeline__track{position:relative;height:72px;display:flex;overflow:hidden;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-2)}.session-day-timeline__track>div{padding:13px 9px;display:flex;flex-direction:column;justify-content:center;border-right:1px solid var(--line);color:var(--text-tertiary)}.session-day-timeline__track>div:last-of-type{border:0}.session-day-timeline__track>div.active{background:var(--accent-soft);color:var(--text-primary);box-shadow:inset 0 -2px var(--accent)}.session-day-timeline__track strong{font-size:12px}.session-day-timeline__track span{font:500 10px/14px var(--font-mono)}.session-now{position:absolute;z-index:2;top:0;bottom:0;width:1px;background:var(--warning)}.session-now:before{content:"";position:absolute;left:-3px;top:-1px;width:7px;height:7px;border-radius:50%;background:var(--warning)}.session-now span{position:absolute;left:5px;bottom:4px;color:var(--warning);font:600 9px/12px var(--font-sans);white-space:nowrap}.session-context-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.session-context-detail{min-height:160px;display:grid;gap:12px}.session-context-detail.active{border-color:var(--accent-border)!important;box-shadow:inset 2px 0 var(--accent)!important}.session-context-detail>.row-link{align-self:end}
.master-document-grid{display:grid;grid-template-columns:minmax(0,8fr) minmax(280px,4fr);gap:24px;align-items:start}.master-document-content{min-width:0;display:grid;gap:24px}.master-document-content>.master-hero-react,.master-prose-section{width:min(100%,720px)}.master-hero-react .detail-pairs--four{grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px!important;margin-top:16px}.master-prose-section{scroll-margin-top:84px}.master-prose-section>h2{margin:0 0 10px;font-size:19px;line-height:26px}.master-prose-section>p:not(.eyebrow){margin:0;color:var(--text-secondary);font-size:14px;line-height:23px;white-space:pre-line}.master-document-rail{position:sticky;top:12px;display:grid;gap:12px}.master-toc nav{display:grid}.master-toc a{min-height:32px;padding:6px 0;border-bottom:1px solid var(--line-soft);color:var(--text-secondary);font-size:12px}.master-toc a:hover{color:var(--accent)}.master-levels{display:grid}.master-levels>div{min-height:36px;padding:6px 0;display:grid;grid-template-columns:80px 1fr auto;align-items:center;gap:8px;border-bottom:1px solid var(--line-soft)}.master-levels strong{font:620 12px/18px var(--font-mono)}.master-levels span,.master-levels small{color:var(--text-secondary);font-size:12px}.master-document-rail .step-list p{margin:0;color:var(--text-secondary);font-size:12px}

/* Business cards in the Slate & Signal language */
.master-hero-react,.monitor-hero-react{background:var(--surface-1)!important;background-image:none!important;border:1px solid var(--line)!important;box-shadow:none!important}.decision-card__top,.setup-card__header,.brief-card__header,.thesis-card__top,.operator-panel__head,.comparison-react__head,.condition-react__head,.alert-react__head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.decision-card__decision{color:var(--text-primary)!important;font-size:24px!important;line-height:30px!important;font-weight:650!important}.decision-card__summary,.setup-card__reason{color:var(--text-secondary)!important}.decision-card__footer,.setup-card__footer{padding-top:10px;border-top:1px solid var(--line)}.card-icon{width:30px!important;height:30px!important;display:grid!important;place-items:center!important;border:1px solid var(--line)!important;border-radius:var(--radius-sm)!important;background:var(--surface-2)!important;color:var(--text-secondary)!important}.instrument-badge{border-color:var(--accent-border)!important;background:var(--accent-soft)!important;color:var(--accent)!important}.price-grid,.position-react-grid,.thesis-card__metrics,.comparison-react__cols{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:1px!important;overflow:hidden;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--line)}.price-box,.position-react-grid>div,.thesis-card__metrics>div,.comparison-react__cols>div{padding:8px!important;background:var(--surface-2)!important;border:0!important;border-radius:0!important}.price-box small,.position-react-grid small,.thesis-card__metrics small{display:block;color:var(--text-tertiary);font-size:9px}.price-box strong,.position-react-grid strong,.thesis-card__metrics strong{font-family:var(--font-mono)}
.status-ribbon{display:flex!important;align-items:center;gap:5px!important;overflow:auto;padding:0!important;background:transparent!important;border:0!important}.status-ribbon>*{flex:0 0 auto}
.live-decision-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);gap:16px}.decision-card{position:relative;min-height:180px;padding:0!important;display:grid!important;grid-template-columns:4px minmax(0,1fr);overflow:hidden}.decision-card__signal{background:var(--accent)}.decision-card__signal[data-severity="critical"],.decision-card__signal[data-severity="action"]{background:var(--negative)}.decision-card__signal[data-severity="warning"],.decision-card__signal[data-severity="watch"]{background:var(--warning)}.decision-card__signal[data-severity="positive"]{background:var(--accent)}.decision-card__body{min-width:0;padding:16px 18px;display:grid;gap:10px}.decision-card__top h2{margin:0;color:var(--text-primary);font-size:15px;line-height:20px;font-weight:600}.decision-card__summary{max-width:920px;margin:0;font-size:13px;line-height:20px}.decision-card__reasoning{display:grid;grid-template-columns:1fr 1fr;gap:12px}.decision-card__reasoning>div{padding:8px 10px;border-left:2px solid var(--line);background:var(--surface-2)}.decision-card__reasoning span{color:var(--text-tertiary);font-size:12px;font-weight:620;text-transform:uppercase;letter-spacing:.05em}.decision-card__reasoning p{margin:3px 0 0;color:var(--text-secondary);font-size:12px;line-height:18px}.decision-card__footer{display:flex;align-items:center;justify-content:space-between;gap:10px}.live-metric-strip .metric-card>strong{font-size:14px}.thesis-summary{display:grid;gap:10px;cursor:pointer}.thesis-summary__head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.thesis-summary h2{margin:0;font-size:16px;text-transform:capitalize}.thesis-summary>p{margin:0;color:var(--text-secondary);font-size:12px;line-height:18px}.thesis-summary__metrics{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);border-radius:var(--radius-sm);overflow:hidden}.thesis-summary__metrics>div{padding:9px;background:var(--surface-2)}.thesis-summary__metrics>div+div{border-left:1px solid var(--line)}.thesis-summary__metrics span{display:block;color:var(--text-tertiary);font-size:12px}.thesis-summary__metrics strong{font:620 16px/22px var(--font-mono)}.thesis-summary dl{margin:0;display:grid;grid-template-columns:110px 1fr;gap:5px 9px}.thesis-summary dt{color:var(--text-tertiary);font-size:12px}.thesis-summary dd{margin:0;color:var(--text-secondary);font-size:12px}.market-table td:nth-child(n+2):nth-child(-n+5),.market-table th:nth-child(n+2):nth-child(-n+5){text-align:right}.market-table td:last-child{max-width:420px}.audit-mini{display:grid;gap:10px;cursor:pointer}.audit-mini h3{margin:0;font-size:15px}.audit-mini>p{margin:0;color:var(--warning);font-size:12px}.live-desk-v2 :is(.eyebrow,small,.status-pill,.status-chip,.action-pill,.row-link,.section-title p,.metric-card>span,.metric-card>small,.market-table th,.market-table td,.activity-item,.timeline-item,.brief-card__verdict,.setup-card__footer,.setup-card__footer span,.source-priority-react,.news-digest-preview span,.news-digest-preview p,.definition-grid dt,.definition-grid dd){font-size:12px!important}.live-desk-v2 .metric-card{min-height:64px}.live-desk-v2 .status-ribbon{min-height:28px}
.conditions-react,.delta-list,.activity-list,.timeline,.accordion-list,.source-priority-list,.levels-react,.audit-list-react,.alert-list-react,.macro-list-react,.headline-list-react,.breakdown-list,.performance-trades{display:grid;gap:6px}.condition-react,.delta-item,.activity-item,.timeline-item,.accordion-react,.level-react,.headline-react,.performance-trade{padding:9px 10px!important;border:1px solid var(--line)!important;border-radius:var(--radius-sm)!important;background:var(--surface-2)!important}.next-event-badge{color:var(--warning)}
.session-card-react--auto.active,.macro-event-react--compact.is-next,.performance-day--positive.has-activity,.performance-day--negative.has-activity{background-image:none!important;box-shadow:none!important}.session-card-react--auto.active,.macro-event-react--compact.is-next{background:var(--surface-2)!important}.performance-day--positive.has-activity{background:var(--positive-soft)!important}.performance-day--negative.has-activity{background:var(--negative-soft)!important}.timeline:before{background:var(--line)!important}.activity-dot,.audit-orb{box-shadow:none!important}.bottom-nav{backdrop-filter:none!important}
.operator-panel{display:grid;gap:12px;border-left:2px solid var(--accent)!important}.operator-panel__notice{margin:0;color:var(--text-secondary);font-size:11px}.operator-panel__identity{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--text-tertiary);font-size:11px}.operator-command-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.operator-command{min-height:58px;padding:8px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-2);color:var(--text-primary);text-align:left;cursor:pointer}.operator-command:hover{border-color:var(--accent-border)}.operator-command strong,.operator-command span{display:block}.operator-command strong{font-size:11px}.operator-command span{margin-top:2px;color:var(--text-tertiary);font-size:9px}.operator-command--critical{border-color:rgba(248,81,73,.35)}.operator-panel__revision{display:flex;align-items:center;gap:8px;color:var(--text-tertiary);font-size:10px}.operator-panel__revision strong{padding-right:10px;color:var(--text-primary);font-family:var(--font-mono)}
.replay-create-drawer{display:grid;gap:14px}.replay-create-drawer>p{margin:0}.replay-create-form{display:grid;gap:12px}.replay-create-form__row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.replay-day-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.replay-day-card{display:grid;gap:11px}.replay-day-card>header{display:flex;align-items:flex-start;justify-content:space-between}.replay-day-card h2{margin:0;font-size:17px}.replay-day-card__metrics{display:grid;grid-template-columns:1fr 1fr;gap:1px;overflow:hidden;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--line)}.replay-day-card__metrics>span{padding:8px;background:var(--surface-2);color:var(--text-tertiary);font-size:10px}.replay-day-card__metrics strong{display:block;color:var(--text-primary);font:600 14px/20px var(--font-mono)}.session-preview-list{display:grid}.session-preview-list>a,.gpt-row,.conclusion-item{min-height:var(--row-h);padding:6px 0;display:flex;align-items:center;justify-content:space-between;gap:9px;border-bottom:1px solid var(--line-soft)}.session-preview-list>a:last-child,.gpt-row:last-child,.conclusion-item:last-child{border:0}.session-preview-list>a>span,.gpt-row small{color:var(--text-tertiary);font-size:10px}.gpt-row>div{min-width:0}.gpt-row strong,.gpt-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.conclusion-item strong{color:var(--text-secondary);font-size:11px;font-weight:500}.conclusion-item span{color:var(--accent);font-size:10px;white-space:nowrap}.workspace-panel blockquote{margin:0;padding:9px 11px;border-left:2px solid var(--gpt);background:var(--gpt-soft);color:var(--text-secondary);font-size:11px}.comparison-picker{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.comparison-picker>label{min-height:52px;padding:8px 10px;display:grid;grid-template-columns:18px minmax(0,1fr) auto;align-items:center;gap:8px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-2);cursor:pointer}.comparison-picker>label.selected{border-color:var(--accent-border);background:var(--accent-soft)}.comparison-picker input{width:15px;min-height:15px;margin:0;accent-color:var(--accent)}.comparison-picker strong,.comparison-picker small{display:block}.comparison-picker strong{color:var(--text-primary);font-size:11px}.comparison-picker small{color:var(--text-tertiary);font:9px/13px var(--font-mono)}

/* Domain composition — carried-forward page rules live here in V2 tokens. */
.brief-card,.delta-card,.thesis-card,.activity-card,.position-react-card,.timeline-card,.conditions-react,.weak-signals-react,.source-rules-react,.digest-react,.audit-summary-react,.audit-detail-card,.timeline-page-card{display:grid;gap:12px}.brief-card h3,.delta-card h3,.thesis-card h3,.activity-card h3,.position-react-card h3,.timeline-card h3{margin:0;font-size:15px;line-height:20px}.brief-card>p,.position-react-card>p,.thesis-card__scenario{margin:0;color:var(--text-secondary);font-size:12px;line-height:18px}.brief-card__verdict,.setup-card__footer,.source-priority-react{padding-top:10px;border-top:1px solid var(--line);color:var(--text-tertiary);font-size:11px}.delta-item{display:grid!important;grid-template-columns:8px minmax(0,1fr);gap:9px!important;align-items:start}.delta-item__dot{width:6px;height:6px;margin-top:7px;border-radius:50%;background:var(--text-disabled)}.delta-item[data-tone="negative"] .delta-item__dot{background:var(--negative)}.delta-item[data-tone="warning"] .delta-item__dot{background:var(--warning)}.delta-item[data-tone="positive"] .delta-item__dot{background:var(--accent)}.delta-consequence{padding:10px 12px;border-left:2px solid var(--negative);background:var(--negative-soft);color:var(--negative);font-size:12px}.thesis-card__instrument,.instrument-title{display:flex;align-items:center;gap:10px}.thesis-card__subtitle{color:var(--text-tertiary);font-size:11px}.thesis-card__focus{padding:10px;border-left:2px solid var(--warning);background:var(--warning-soft)}.thesis-card__focus span{color:var(--warning);font-size:10px;font-weight:650;text-transform:uppercase}.thesis-card__focus p{margin:3px 0 0;color:var(--text-secondary);font-size:12px}.setup-card{padding:0!important;overflow:hidden}.setup-card__header,.setup-card__body,.setup-card__footer{padding:12px 14px}.setup-card__header h3{margin:2px 0 0;font-size:15px}.setup-card__reason{margin-top:10px;padding:9px 10px;border-left:2px solid var(--negative);background:var(--negative-soft)}.setup-card__footer{display:flex;align-items:center;justify-content:space-between;gap:10px}.source-priority-react{display:flex;align-items:center;gap:7px}.news-digest-preview{padding:9px 10px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--radius-sm)}.news-digest-preview span{color:var(--text-tertiary);font-size:10px;text-transform:uppercase}.news-digest-preview p{margin:3px 0 0;color:var(--text-secondary);font-size:11px}.activity-item{display:grid!important;grid-template-columns:46px 14px minmax(0,1fr);gap:8px!important;min-height:52px}.activity-time{color:var(--text-tertiary);font:10px var(--font-mono)}.activity-line{position:relative;display:flex;justify-content:center}.activity-line:before{content:"";position:absolute;top:11px;bottom:-14px;width:1px;background:var(--line)}.activity-item:last-child .activity-line:before{display:none}.activity-dot{position:relative;z-index:1;width:7px;height:7px;margin-top:4px;border-radius:50%;background:var(--accent)}.activity-item[data-state="scheduled"] .activity-dot{background:var(--warning)}.activity-label{font-size:12px;font-weight:600}.activity-detail{margin-top:2px;color:var(--text-tertiary);font-size:11px}.timeline{position:relative}.timeline-item{display:grid!important;grid-template-columns:48px minmax(0,1fr);gap:9px!important}.timeline-item__time{padding-top:10px;color:var(--text-tertiary);font:10px var(--font-mono);text-align:right}.timeline-item__content{padding:9px 10px;border-left:2px solid var(--line);cursor:pointer}.timeline-item[data-type="master"] .timeline-item__content{border-color:var(--accent)}.timeline-item[data-type="monitor"] .timeline-item__content{border-color:var(--warning)}.timeline-item[data-status="critical"] .timeline-item__content{border-color:var(--negative)}.timeline-item[data-status="positive"] .timeline-item__content{border-color:var(--accent)}.timeline-item__header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.timeline-item__content p{margin:3px 0 0;color:var(--text-secondary);font-size:11px}.drawer-section+.drawer-section{margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}.drawer-section h3{margin:0 0 6px;font-size:13px}.drawer-section p{margin:0;color:var(--text-secondary);font-size:12px;line-height:18px}.drawer-section ul{padding-left:18px;color:var(--text-secondary);font-size:12px}.tag-list{display:flex;flex-wrap:wrap;gap:6px}.tag-list span{padding:5px 8px;border:1px solid var(--line);border-radius:var(--radius-pill);background:var(--surface-2);color:var(--text-secondary);font-size:10px}

.monitor-selector-react{display:flex;gap:8px;overflow:auto;padding-bottom:4px}.monitor-selector-react button{min-width:190px;padding:10px;display:grid;gap:3px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-1);color:var(--text-primary);text-align:left;cursor:pointer}.monitor-selector-react button.active{border-color:var(--accent-border);background:var(--accent-soft)}.monitor-selector-react span,.monitor-selector-react small{color:var(--text-tertiary);font-size:10px}.monitor-actions-react{display:grid;grid-template-columns:1fr 1fr;gap:8px}.monitor-actions-react>div{padding:9px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--radius-sm)}.monitor-actions-react span{display:block;color:var(--text-tertiary);font-size:10px;text-transform:uppercase}.monitor-actions-react strong{font-size:12px}.instrument-title{margin-bottom:12px}.instrument-badge{min-width:42px;min-height:42px;padding:7px;display:grid;place-items:center;border:1px solid var(--accent-border);border-radius:var(--radius-sm);font:600 10px var(--font-mono)}.thesis-page-hero__copy>p{color:var(--text-secondary)}.score-drivers-react h3{display:flex;align-items:center;gap:7px}.score-drivers-react.positive h3{color:var(--accent)!important}.score-drivers-react.negative h3{color:var(--negative)}.score-drivers-react ul{margin:10px 0 0;padding-left:18px;display:grid;gap:6px;color:var(--text-secondary)}.levels-react{grid-template-columns:repeat(2,minmax(0,1fr))}.level-react{display:grid!important;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:3px 10px!important}.level-react>span:not(.status-pill){grid-column:1;color:var(--text-tertiary);font-size:10px}.level-react>.status-pill{grid-column:2;grid-row:1/3}.condition-react{display:grid!important;grid-template-columns:26px minmax(0,1fr);gap:9px!important}.condition-react__icon{width:24px;height:24px;display:grid;place-items:center;border:1px solid var(--line);border-radius:50%;color:var(--text-tertiary)}.condition-react__icon.validated,.condition-react__icon.previously_validated{color:var(--accent);border-color:var(--accent-border);background:var(--accent-soft)}.condition-react__icon.failed,.condition-react__icon.triggered{color:var(--negative);border-color:rgba(248,81,73,.35);background:var(--negative-soft)}.condition-react p{margin:4px 0;color:var(--text-secondary);font-size:12px}.condition-react small{color:var(--text-tertiary);font-size:10px}.condition-react__head{align-items:center}.comparison-react{display:grid;gap:8px}.comparison-react__row{padding:10px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-1)}.comparison-react__head{margin-bottom:8px}.comparison-react__cols span{color:var(--text-tertiary);font-size:10px;text-transform:uppercase}.comparison-react__cols p{margin:4px 0 0;color:var(--text-secondary);font-size:12px}.comparison-react__row>small{display:block;margin-top:8px;color:var(--text-tertiary)}

.news-day-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.news-day-heading h2{margin:0;font-size:16px}.news-day-heading p,.news-day-heading>span{margin:2px 0 0;color:var(--text-tertiary);font-size:10px}.macro-event-react{position:relative;display:grid!important;grid-template-columns:50px minmax(0,1fr) auto;gap:12px!important;align-items:start}.macro-event-react__time{display:grid;color:var(--accent);font:600 11px var(--font-mono)}.macro-event-react__time small{color:var(--text-tertiary);font-size:9px}.macro-event-react__title{display:flex;align-items:center;gap:6px}.macro-event-react__title h3{margin:0;font-size:12px}.macro-event-react__content>p,.headline-react p{margin:4px 0 0;color:var(--text-secondary);font-size:11px}.macro-event-react.is-next{border-color:var(--accent-border)!important;background:var(--accent-soft)!important}.macro-values{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:7px}.macro-values>div{padding:5px 6px;background:var(--surface-3);border-radius:var(--radius-xs)}.macro-values span{display:block;color:var(--text-tertiary);font-size:9px}.macro-values strong{font:550 10px var(--font-mono)}.headline-react{display:grid;grid-template-columns:56px minmax(0,1fr);gap:10px!important}.headline-react time{color:var(--accent);font:600 10px var(--font-mono)}.audit-summary-react>div:first-child{display:flex;align-items:center;gap:12px}.audit-summary-react h2{margin:0;font-size:18px}.audit-summary-react p{margin:2px 0 0;color:var(--text-secondary)}.audit-orb{width:12px;height:36px;border-radius:2px;background:var(--warning)}.audit-orb.ready{background:var(--accent)}.audit-warnings-react{display:flex;flex-wrap:wrap;gap:6px}.audit-warnings-react span{padding:6px 8px;border:1px solid rgba(210,153,34,.35);border-radius:var(--radius-pill);background:var(--warning-soft);color:var(--warning);font-size:10px}.audit-list-react>div,.source-priority-list>div,.api-map-react>div{min-height:42px;padding:8px 9px;display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-2)}.source-priority-list>div{display:grid;grid-template-columns:28px minmax(0,1fr);justify-content:initial}.source-priority-list>div>span{width:24px;height:24px;display:grid;place-items:center;border:1px solid var(--accent-border);border-radius:50%;color:var(--accent);font-size:10px}.source-priority-list p{margin:0;display:grid}.source-priority-list small,.audit-list-react small{color:var(--text-tertiary)}.api-map-react{display:grid;gap:7px}.api-map-react>div{display:grid;grid-template-columns:96px minmax(0,1fr)}.api-map-react code{color:var(--accent);overflow-wrap:anywhere}.alert-react{display:grid!important;grid-template-columns:36px minmax(0,1fr);gap:11px!important}.alert-react__icon{width:34px;height:34px;display:grid;place-items:center;border:1px solid rgba(210,153,34,.35);border-radius:var(--radius-sm);background:var(--warning-soft);color:var(--warning)}.alert-react--critical .alert-react__icon{border-color:rgba(248,81,73,.35);background:var(--negative-soft);color:var(--negative)}.alert-react p{margin:4px 0 0;color:var(--text-secondary)}

/* Performance, history and calendar */
.breakdown-grid,.performance-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.performance-toolbar,.performance-month-nav{display:flex;align-items:center;justify-content:space-between;gap:12px}.performance-pricing{color:var(--text-tertiary);font-size:10px}.performance-calendar-card{padding:0!important;overflow:hidden}.performance-weekdays,.performance-calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}.performance-weekdays>span{padding:8px;color:var(--text-tertiary);font-size:9px;text-align:center;text-transform:uppercase}.performance-calendar-grid>*{min-height:86px;padding:7px;border-top:1px solid var(--line);border-right:1px solid var(--line);background:transparent;color:var(--text-secondary)}.performance-calendar-grid>*:nth-child(7n){border-right:0}.performance-calendar-grid button:hover{background:var(--surface-2)}.performance-day__number{font-family:var(--font-mono)}.performance-day-stats{display:grid;margin-top:8px;color:var(--text-tertiary);font-size:9px}.performance-day-timeline{height:4px;margin-top:7px;background:var(--surface-3)}.performance-master-detail{display:grid;gap:16px;scroll-margin-top:16px}.performance-master-detail>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-bottom:12px;border-bottom:1px solid var(--line)}.performance-master-detail h2{margin:0;font-size:18px;text-transform:capitalize}.performance-detail-section{display:grid;gap:10px}.performance-day-zoom{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,.45fr);gap:16px}.history-session{display:grid;grid-template-columns:minmax(0,1.5fr) repeat(4,minmax(80px,.6fr)) auto;align-items:center;gap:10px}.history-session>*{min-width:0}
.performance-month-nav strong{min-width:170px;text-align:center;text-transform:capitalize}.performance-prev svg{transform:rotate(180deg)}.performance-pricing{display:flex;gap:2px;padding:2px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-1)}.performance-pricing button{min-height:28px;padding:0 9px;border:0;border-radius:4px;background:transparent;color:var(--text-tertiary);font-size:10px;cursor:pointer}.performance-pricing button.active{background:var(--surface-3);color:var(--text-primary)}.performance-kpi{min-height:88px;display:grid;align-content:center}.performance-kpi>span{color:var(--text-tertiary);font-size:10px;text-transform:uppercase}.performance-kpi>strong{margin:3px 0;font:650 22px var(--font-mono)}.performance-kpi>small{color:var(--text-tertiary);font-size:10px}.performance-kpi--positive>strong{color:var(--positive)}.performance-kpi--negative>strong{color:var(--negative)}.performance-day{position:relative;display:grid;align-content:space-between;min-width:0;text-align:left;cursor:pointer}.performance-day>strong{margin-top:8px;font:600 14px var(--font-mono)}.performance-day>small{overflow:hidden;color:var(--text-tertiary);font-size:9px;text-overflow:ellipsis;white-space:nowrap}.performance-day--positive>strong{color:var(--positive)}.performance-day--negative>strong{color:var(--negative)}.performance-day.is-empty{opacity:.56}.performance-day.is-today .performance-day__number{width:22px;height:22px;display:grid;place-items:center;border:1px solid var(--accent-border);border-radius:var(--radius-xs);color:var(--accent)}.performance-day-placeholder{background:var(--surface-0)}.performance-legend{padding:9px 12px;display:flex;justify-content:flex-end;gap:14px;border-top:1px solid var(--line);color:var(--text-tertiary);font-size:9px}.performance-legend span{display:flex;align-items:center;gap:5px}.performance-legend i{width:7px;height:7px;border-radius:50%;background:var(--text-disabled)}.performance-legend i.positive{background:var(--positive)}.performance-legend i.negative{background:var(--negative)}.performance-loading,.performance-day-loading{min-height:180px;display:grid;place-content:center;text-align:center}.performance-day-result{padding:14px;display:grid;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-2)}.performance-day-result span,.performance-day-stats span{color:var(--text-tertiary);font-size:10px;text-transform:uppercase}.performance-day-result strong{margin:4px 0;font:650 30px var(--font-mono)}.performance-day-result small{color:var(--text-tertiary)}.performance-day-result--positive strong,.r-positive{color:var(--positive)!important}.performance-day-result--negative strong,.r-negative{color:var(--negative)!important}.performance-day-stats{grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;overflow:hidden;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--line)}.performance-day-stats>div{padding:8px;background:var(--surface-2)}.performance-day-stats strong{display:block;color:var(--text-primary);font:600 13px var(--font-mono)}.performance-detail-section{padding:12px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-1)}.performance-detail-section h3{margin:2px 0 5px}.performance-detail-section>p:last-child{margin:0;color:var(--text-secondary)}.performance-trade{display:flex!important;align-items:center;justify-content:space-between;gap:10px!important}.performance-trade>div{display:grid}.performance-trade span{color:var(--text-tertiary);font-size:10px}.performance-day-timeline{height:auto;display:grid;gap:6px;background:transparent}.performance-day-timeline>div{display:grid;grid-template-columns:44px minmax(0,1fr);gap:9px}.performance-day-timeline time{color:var(--accent);font:10px var(--font-mono)}.performance-day-timeline span,.performance-day-timeline strong{display:block}.performance-day-timeline span{color:var(--text-tertiary);font-size:10px}

.monitor-hero-react,.thesis-page-hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.65fr);align-items:center;gap:16px}.monitor-health-strip,.thesis-health-strip{align-self:stretch}.alerts-scope-banner{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;border-left:2px solid var(--accent)!important}.alerts-scope-banner>svg{color:var(--accent)}.alerts-scope-banner strong{display:block}.alerts-scope-banner p{margin:2px 0 0;color:var(--text-secondary);font-size:12px}

@media(max-width:1279px){
  .metric-strip--six{grid-template-columns:repeat(3,minmax(0,1fr))}.metric-strip--six .metric-card:nth-child(3){border-right:0!important}.metric-strip--six .metric-card:nth-child(n+4){border-top:1px solid var(--line)!important}.content-grid--briefs{grid-template-columns:repeat(2,minmax(0,1fr))!important}.operator-command-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.performance-day-zoom{grid-template-columns:1fr}.replay-day-grid,.strategy-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:1023px){
  .workspace-heading.page-header-v2{min-height:64px}.workspace-heading__main h1{font-size:22px;line-height:28px}.metric-card{min-height:82px}.content-grid--briefs{grid-template-columns:repeat(2,minmax(0,1fr))!important}.detail-pairs--four{grid-template-columns:repeat(2,minmax(0,1fr))}.breakdown-grid,.performance-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.live-decision-grid{grid-template-columns:1fr}.master-document-grid{grid-template-columns:1fr}.master-document-content>.master-hero-react,.master-prose-section{width:100%}.master-document-rail{position:static;grid-template-columns:repeat(2,minmax(0,1fr))}.master-toc{grid-column:1/-1}.chart-scroll svg{height:300px}.monitor-hero-react,.thesis-page-hero{grid-template-columns:1fr}
}
@media(max-width:767px){
  .workspace-heading.page-header-v2{grid-template-columns:1fr;align-items:start;padding-bottom:11px!important}.workspace-heading__main h1{font-size:20px;line-height:26px}.workspace-heading__actions{justify-content:flex-start}.back-btn{margin-top:14px}.breadcrumbs{overflow:auto;white-space:nowrap}.metric-grid,.metric-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.metric-card:nth-child(2n){border-right:0!important}.metric-card:nth-child(n+3){border-top:1px solid var(--line)!important}.content-grid,.content-grid--briefs{grid-template-columns:1fr!important}.detail-pairs--four{grid-template-columns:1fr}.command-panel{align-items:flex-start;flex-direction:column}.command-panel__actions{width:100%}.command-panel__actions>*{flex:1}.incident-card{grid-template-columns:1fr}.incident-card>div:last-child{justify-content:space-between}.event-timeline:before{left:7px}.event-timeline>li{grid-template-columns:15px minmax(0,1fr);gap:7px}.event-timeline>li>time{grid-column:2;grid-row:1;padding:0;text-align:left}.event-timeline>li>i{grid-column:1;grid-row:1/3;margin-top:3px}.event-timeline>li>div{grid-column:2;grid-row:2}.decision-chart>header{align-items:stretch;flex-direction:column}.chart-controls{justify-content:flex-start}.layer-toggles{width:100%;overflow:auto}.zoom-control{width:max-content}.chart-event-strip a{min-width:116px}.modal{padding:0;align-items:end}.modal__card{width:100%;max-height:90dvh;border-radius:var(--radius-lg) var(--radius-lg) 0 0;border-bottom:0;padding:16px}.drawer{top:auto;width:100%;height:min(88dvh,720px);border:1px solid var(--slate-600);border-bottom:0;border-radius:var(--radius-lg) var(--radius-lg) 0 0;transform:translateY(20px)}.drawer.open{transform:translateY(0)}.drawer__grab{display:block;width:34px;height:3px;margin:7px auto -10px;border-radius:2px;background:var(--slate-600)}.confirm-action__scope{grid-template-columns:1fr}.confirm-action__scope>div+div{border-left:0;border-top:1px solid var(--line)}.modal__actions>*{flex:1}
  .data-table-wrap{overflow:visible;border:0;background:transparent}.data-table,.data-table tbody{width:100%;min-width:0!important;display:grid;gap:8px}.data-table thead{display:none}.data-table tr{min-width:0;padding:5px 12px;display:grid;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--surface-1)}.data-table td{min-width:0;min-height:34px;height:auto;padding:7px 0;display:grid;grid-template-columns:94px minmax(0,1fr);align-items:center;gap:8px;border-bottom:1px solid var(--line-soft)!important;text-align:right}.data-table td:last-child{border:0!important}.data-table td:before{content:attr(data-label);color:var(--text-tertiary);font-size:9px;font-weight:620;letter-spacing:.04em;text-align:left;text-transform:uppercase}.data-table td>*{max-width:100%;justify-self:end}.data-table td>strong,.data-table td>small{grid-column:2}.data-table td>.progress-line{width:min(100%,180px)}.row-link span{display:inline}.operator-command-grid{grid-template-columns:1fr}.performance-calendar-grid>*{min-height:58px;padding:5px}.performance-weekdays>span{font-size:8px;padding:5px 1px}.performance-day-stats{display:none}.history-session{grid-template-columns:1fr 1fr}.history-session>*:first-child{grid-column:1/-1}
  .replay-day-grid,.comparison-picker,.strategy-grid,.session-list-react,.session-context-grid,.live-decision-grid,.master-document-rail{grid-template-columns:1fr}.replay-create-form__row{grid-template-columns:1fr}.decision-card__body{padding:13px}.decision-card__reasoning{grid-template-columns:1fr}.decision-card__footer{align-items:flex-start;flex-direction:column}.decision-card__footer .secondary-btn{width:100%}.market-table td:last-child{max-width:none}.live-risk-grid{grid-template-columns:1fr!important}.session-day-timeline__track{overflow-x:auto}.session-day-timeline__track>div{min-width:110px}.session-day-timeline__track>div:first-of-type{min-width:140px}.chart-scroll svg{height:240px}.chart-fallback-timeline li{grid-template-columns:46px minmax(0,1fr)}.chart-fallback-timeline .status-pill{grid-column:2}.alerts-scope-banner{grid-template-columns:auto minmax(0,1fr)}.alerts-scope-banner .secondary-btn{grid-column:1/-1;width:100%}
}
@media(max-width:479px){.metric-grid,.metric-strip{grid-template-columns:1fr}.metric-card{border-right:0!important;border-top:1px solid var(--line)!important;min-height:62px}.metric-card:first-child{border-top:0!important}.layer-toggles button{padding-inline:6px}.layer-toggles button{font-size:9px}.performance-summary-grid,.breakdown-grid{grid-template-columns:1fr 1fr}.data-table td{grid-template-columns:80px minmax(0,1fr)}}

/* Observability V3 — dense operations workstation */
.observability-v3{--observability-accent:var(--gpt)}
.observability-refresh{height:22px;padding:0 7px;display:flex;align-items:center;border:1px solid var(--line);background:var(--surface-0);color:var(--text-tertiary);font:650 8px/1 var(--font-mono);white-space:nowrap}
.observability-kpis{grid-template-columns:repeat(6,minmax(0,1fr))!important}
.observability-coverage{min-height:31px;display:grid;grid-template-columns:auto repeat(3,minmax(120px,1fr)) minmax(220px,1.3fr);align-items:center;gap:8px;padding:4px 7px;border:1px solid var(--line);background:var(--surface-0);font:650 7px/1 var(--font-mono)}
.observability-coverage>span{color:var(--gpt);letter-spacing:.07em}.observability-coverage>div{min-width:0;display:grid;grid-template-columns:auto minmax(30px,1fr) auto;align-items:center;gap:5px}.observability-coverage strong{color:var(--text-secondary);font-size:7px}.observability-coverage i{height:3px;display:block;background:var(--surface-3)}.observability-coverage i b{height:100%;display:block;background:var(--gpt)}.observability-coverage em{color:var(--text-tertiary);font-style:normal;white-space:nowrap}.observability-coverage small{color:var(--text-tertiary);font-size:7px;text-align:right}
.observability-filter-bar{grid-template-columns:minmax(170px,1.4fr) repeat(5,minmax(105px,.8fr)) auto!important}
.observability-filter-bar label{min-width:0}.observability-filter-bar input,.observability-filter-bar select{width:100%}
.observability-workbench{min-width:0;display:grid;grid-template-columns:minmax(260px,1.45fr) repeat(3,minmax(175px,1fr));align-items:stretch;gap:6px}
.observability-health-panel,.observability-breakdown{min-width:0;padding:0!important;overflow:hidden}
.observability-health-panel>header,.observability-breakdown>header{height:29px;padding:0 7px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:var(--surface-2)}
.observability-health-panel h2,.observability-breakdown h2{margin:0;font-size:10px;line-height:13px}.observability-health-panel>header>span,.observability-breakdown>header>span{font:650 7px/1 var(--font-mono)}.observability-health-panel .eyebrow{font-size:6px}
.observability-health-grid{display:grid;grid-template-columns:1fr 1fr}.observability-health-grid>div{min-height:44px;padding:5px 7px;display:grid;align-content:center;border-right:1px solid var(--line-soft);border-bottom:1px solid var(--line-soft)}.observability-health-grid>div:nth-child(2n){border-right:0}.observability-health-grid>div:nth-last-child(-n+2){border-bottom:0}.observability-health-grid span,.observability-health-grid small{color:var(--text-tertiary);font:600 7px/1 var(--font-mono)}.observability-health-grid strong{margin:2px 0;color:var(--text-primary);font:650 13px/1 var(--font-mono)}.observability-health-grid [data-tone="positive"] strong{color:var(--positive)}.observability-health-grid [data-tone="warning"] strong{color:var(--warning)}
.observability-breakdown>div{max-height:118px;overflow:auto}.observability-breakdown__row{min-height:23px;padding:3px 6px;display:grid;grid-template-columns:minmax(60px,1fr) auto auto auto auto;align-items:center;gap:5px;border-bottom:1px solid var(--line-soft);font:600 7px/1 var(--font-mono)}.observability-breakdown__row:last-child{border-bottom:0}.observability-breakdown__row strong{overflow:hidden;color:var(--text-secondary);text-overflow:ellipsis;white-space:nowrap}.observability-breakdown__row span{color:var(--text-tertiary)}.observability-breakdown__row em{color:var(--text-primary);font-style:normal}
.observability-process-ledger>header{border-left-color:var(--observability-accent)}
.observability-process-table{min-width:1050px}.observability-process-table th{white-space:nowrap}.observability-process-table td{white-space:nowrap}.observability-process-table tr[data-breach="true"]{box-shadow:inset 2px 0 var(--warning)}.observability-process-table td:first-child{min-width:155px}.observability-process-table td:first-child>strong{display:flex;align-items:center;gap:5px}.observability-process-table td:first-child i{width:5px;height:5px;display:inline-block;background:var(--accent)}.observability-process-table td:first-child i[data-scope="replay"]{background:var(--gpt)}.observability-process-table td:nth-child(3){max-width:130px}.observability-process-table .terminal-code{display:block;overflow:hidden;text-overflow:ellipsis}.observability-process-table .status-pill+small{margin-top:2px}.observability-process-table td:nth-child(4),.observability-process-table td:nth-child(5),.observability-process-table td:nth-child(8),.observability-process-table td:nth-child(9){font-family:var(--font-mono)}
.observability-breach{color:var(--warning)!important}.observability-breach small{display:inline!important;margin-left:3px;padding:1px 2px;background:var(--warning-soft);color:var(--warning)!important;font-size:6px!important}
.lease-state{display:grid;color:var(--text-tertiary);font:650 7px/1 var(--font-mono)}.lease-state[data-state="active"]{color:var(--positive)}.lease-state[data-state="expiring"]{color:var(--warning)}.lease-state[data-state="expired"]{color:var(--negative)}.lease-state small{margin-top:2px;color:var(--text-tertiary)!important;font-size:6px!important}.observability-live-ref{padding:2px 4px;border:1px solid var(--line);color:var(--text-tertiary);font:650 7px/1 var(--font-mono)}
.guardrail-board{min-width:0;display:grid;grid-template-columns:minmax(530px,1.15fr) minmax(360px,.85fr);border:1px solid var(--line);background:var(--surface-0)}
.guardrail-board>header{grid-column:1/-1;height:30px;padding:0 7px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:var(--surface-2)}
.guardrail-board>header h2{margin:0;font-size:10px;line-height:12px}.guardrail-board>header .eyebrow{font-size:6px}.guardrail-board>header>span{padding:2px 5px;border:1px solid rgba(63,185,80,.28);background:var(--positive-soft);color:var(--positive);font:700 7px/1 var(--font-mono)}.guardrail-board>header>span[data-enabled="false"]{border-color:var(--line);background:var(--surface-0);color:var(--text-tertiary)}
.guardrail-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border-right:1px solid var(--line)}.guardrail-summary>div{min-width:0;min-height:46px;padding:5px 7px;display:grid;align-content:center;border-right:1px solid var(--line-soft)}.guardrail-summary>div:last-child{border-right:0}.guardrail-summary span{color:var(--text-tertiary);font:650 7px/1 var(--font-mono);text-transform:uppercase}.guardrail-summary strong{margin-top:4px;overflow:hidden;color:var(--text-primary);font:700 11px/1 var(--font-mono);text-overflow:ellipsis;white-space:nowrap}.guardrail-summary [data-tone="critical"] strong{color:var(--negative)}.guardrail-summary [data-tone="warning"] strong{color:var(--warning)}
.guardrail-signals{max-height:92px;overflow:auto}.guardrail-signal{min-height:30px;padding:4px 7px;display:grid;grid-template-columns:4px minmax(0,1fr) auto;align-items:center;gap:6px;border-bottom:1px solid var(--line-soft);color:inherit}.guardrail-signal:last-child{border-bottom:0}.guardrail-signal:hover{background:var(--surface-2)}.guardrail-signal>i{width:3px;height:18px;background:var(--warning)}.guardrail-signal>div{min-width:0}.guardrail-signal strong,.guardrail-signal small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.guardrail-signal strong{font:650 8px/1 var(--font-mono)}.guardrail-signal small{margin-top:2px;color:var(--text-tertiary);font:500 7px/1 var(--font-mono)}.guardrail-signal em{color:var(--text-secondary);font:650 8px/1 var(--font-mono);font-style:normal}.guardrail-signal--critical>i{background:var(--negative)}.guardrail-signal--critical strong,.guardrail-signal--critical em{color:var(--negative)}.guardrail-signal--warning strong,.guardrail-signal--warning em{color:var(--warning)}.guardrail-signal--healthy>i{background:var(--positive)}.guardrail-signal--healthy strong{color:var(--positive)}
.guardrail-policy-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;padding:8px;border:1px solid var(--line);background:var(--surface-0)}.guardrail-policy-form>label{min-width:0;display:grid!important;gap:3px;color:var(--text-tertiary);font:650 8px/1 var(--font-mono);text-transform:uppercase}.guardrail-policy-form input{height:28px;min-height:28px;margin:0;padding:3px 6px;font:550 9px/1 var(--font-mono)}.guardrail-policy-toggle{grid-column:1/-1;min-height:27px;display:flex!important;grid-auto-flow:column;grid-template-columns:auto 1fr!important;align-items:center;justify-content:start;gap:7px!important;border-bottom:1px solid var(--line)}.guardrail-policy-toggle input{width:13px;height:13px;min-height:0;margin:0;accent-color:var(--accent)}.guardrail-policy-toggle span{color:var(--text-primary)}
@media(max-width:1180px){.observability-kpis{grid-template-columns:repeat(3,minmax(0,1fr))!important}.observability-workbench{grid-template-columns:repeat(2,minmax(0,1fr))}.observability-filter-bar{grid-template-columns:repeat(3,minmax(0,1fr))!important}.observability-coverage{grid-template-columns:auto repeat(3,minmax(100px,1fr))}.observability-coverage small{grid-column:1/-1;text-align:left}.guardrail-board{grid-template-columns:1fr}.guardrail-board>header{grid-column:auto}.guardrail-summary{border-right:0;border-bottom:1px solid var(--line)}}
@media(max-width:720px){.observability-kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}.observability-workbench{grid-template-columns:1fr}.observability-filter-bar{grid-template-columns:repeat(2,minmax(0,1fr))!important}.observability-coverage{grid-template-columns:1fr}.observability-coverage>div{grid-template-columns:60px minmax(30px,1fr) auto}.observability-refresh{display:none}.guardrail-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.guardrail-summary>div{border-bottom:1px solid var(--line-soft)}.guardrail-summary>div:nth-child(2n){border-right:0}.guardrail-summary>div:last-child{grid-column:1/-1;border-bottom:0}}
@media(max-width:479px){.observability-kpis{grid-template-columns:1fr!important}.observability-filter-bar{grid-template-columns:1fr!important}.guardrail-policy-form{grid-template-columns:1fr}.guardrail-policy-toggle{grid-column:auto}}

.incident-command-view{--incident-accent:var(--warning)}
.incident-command-kpis{grid-template-columns:repeat(5,minmax(0,1fr))!important}.incident-command-kpis .metric-card[data-tone="negative"] strong{color:var(--negative)}.incident-command-kpis .metric-card[data-tone="positive"] strong{color:var(--positive)}
.incident-command-layout{min-width:0;display:grid;grid-template-columns:minmax(0,7.5fr) minmax(340px,4.5fr);align-items:start;gap:7px}.incident-ledger-panel,.incident-detail-panel{min-width:0;overflow:hidden}.incident-ledger-panel{padding:0!important}.incident-command-toolbar{min-height:40px;padding:6px 8px;display:grid;grid-template-columns:minmax(0,1fr) minmax(420px,1.3fr);align-items:end;gap:8px;border-bottom:1px solid var(--line);background:var(--surface-2)}.incident-command-toolbar h2{margin:0;font-size:12px;line-height:15px}.incident-command-toolbar>div:last-child{display:grid;grid-template-columns:100px 110px minmax(140px,1fr);gap:6px}.incident-command-toolbar label{min-width:0;color:var(--text-tertiary);font:650 7px/1 var(--font-mono);text-transform:uppercase}.incident-command-toolbar select,.incident-command-toolbar input{height:24px;min-height:24px;margin-top:2px;padding:2px 5px;font:550 9px/1 var(--font-mono)}
.incident-ledger-wrap{border:0;border-radius:0}.incident-ledger-table{min-width:860px}.incident-ledger-table tr{cursor:pointer}.incident-ledger-table tr.is-selected{background:var(--surface-2);box-shadow:inset 2px 0 var(--accent)}.incident-ledger-table tr[data-severity="critical"]{box-shadow:inset 2px 0 var(--negative)}.incident-ledger-table tr[data-severity="warning"]{box-shadow:inset 2px 0 var(--warning)}.incident-ledger-table td{white-space:nowrap}.incident-ledger-table td:first-child strong{display:flex;align-items:center;gap:5px;min-width:0}.incident-ledger-table td:first-child i{width:5px;height:18px;display:inline-block;background:var(--info)}.incident-ledger-table td:first-child i[data-severity="critical"]{background:var(--negative)}.incident-ledger-table td:first-child i[data-severity="warning"]{background:var(--warning)}.incident-ledger-table .terminal-code{font-size:8px}
.incident-detail-panel{display:grid;gap:8px}.incident-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding-bottom:7px;border-bottom:1px solid var(--line)}.incident-detail-head h2{margin:0;font-size:14px;line-height:18px}.incident-detail-head p:not(.eyebrow){margin:2px 0 0;color:var(--text-secondary);font-size:10px;line-height:14px}.incident-action-strip{display:flex;gap:5px;flex-wrap:wrap}.incident-evidence-grid{margin:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--line)}.incident-evidence-grid>div{min-width:0;padding:6px;background:var(--surface-2)}.incident-evidence-grid dt{color:var(--text-tertiary);font:650 7px/1 var(--font-mono);text-transform:uppercase}.incident-evidence-grid dd{margin:3px 0 0;overflow:hidden;color:var(--text-primary);font:650 9px/1.25 var(--font-mono);text-overflow:ellipsis;white-space:nowrap}.incident-evidence-grid a{color:var(--accent)}.incident-policy-evidence,.incident-timeline-panel{min-width:0;border:1px solid var(--line);background:var(--surface-0)}.incident-policy-evidence>header,.incident-timeline-panel>header{height:28px;padding:0 7px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:var(--surface-2)}.incident-policy-evidence>header span,.incident-timeline-panel>header span{color:var(--text-tertiary);font:650 7px/1 var(--font-mono)}.incident-policy-evidence pre{max-height:136px;margin:0;padding:7px;overflow:auto;color:var(--text-secondary);font:8px/12px var(--font-mono);white-space:pre-wrap}.incident-timeline{max-height:190px;margin:0;padding:5px 7px;overflow:auto;list-style:none}.incident-timeline li{display:grid;grid-template-columns:72px 5px minmax(0,1fr);gap:6px;padding:4px 0;border-bottom:1px solid var(--line-soft)}.incident-timeline li:last-child{border-bottom:0}.incident-timeline time{color:var(--text-tertiary);font:600 7px/1 var(--font-mono)}.incident-timeline i{width:5px;height:18px;background:var(--info)}.incident-timeline i[data-severity="critical"]{background:var(--negative)}.incident-timeline i[data-severity="warning"]{background:var(--warning)}.incident-timeline strong{font:650 8px/1 var(--font-mono)}.incident-timeline p{margin:2px 0 0;color:var(--text-secondary);font-size:8px;line-height:12px}.incident-empty{min-height:210px}
@media(max-width:1180px){.incident-command-kpis{grid-template-columns:repeat(3,minmax(0,1fr))!important}.incident-command-layout{grid-template-columns:1fr}.incident-command-toolbar{grid-template-columns:1fr}.incident-command-toolbar>div:last-child{grid-template-columns:repeat(3,minmax(0,1fr))}.incident-evidence-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:720px){.incident-command-kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}.incident-command-toolbar>div:last-child{grid-template-columns:1fr}.incident-ledger-table{min-width:0}.incident-evidence-grid{grid-template-columns:1fr}.incident-detail-head{display:grid}.incident-timeline li{grid-template-columns:58px 5px minmax(0,1fr)}}
@media(max-width:479px){.incident-command-kpis{grid-template-columns:1fr!important}}
.notification-center-view{--notification-accent:var(--accent)}
.notification-kpis{grid-template-columns:repeat(5,minmax(0,1fr))!important}.notification-kpis .metric-card[data-tone="negative"] strong{color:var(--negative)}.notification-kpis .metric-card[data-tone="warning"] strong{color:var(--warning)}
.notification-center-layout{min-width:0;display:grid;grid-template-columns:minmax(0,7fr) minmax(340px,4.8fr);align-items:start;gap:7px}.notification-ledger-panel,.notification-detail-panel{min-width:0;overflow:hidden}.notification-ledger-panel{padding:0!important}.notification-toolbar>div:last-child{grid-template-columns:92px 92px minmax(150px,1fr)}
.notification-ledger-wrap{border:0;border-radius:0}.notification-ledger-table{min-width:880px}.notification-ledger-table tr{cursor:pointer}.notification-ledger-table tr.is-selected{background:var(--surface-2);box-shadow:inset 2px 0 var(--accent)}.notification-ledger-table tr[data-level="page"]{box-shadow:inset 2px 0 var(--negative)}.notification-ledger-table tr[data-level="action"]{box-shadow:inset 2px 0 var(--warning)}.notification-ledger-table tr[data-level="watch"]{box-shadow:inset 2px 0 var(--accent)}.notification-ledger-table tr[data-level="muted"]{box-shadow:inset 2px 0 var(--text-tertiary)}.notification-ledger-table td{white-space:nowrap}.notification-ledger-table td:first-child strong{display:flex;align-items:center;gap:5px;min-width:0}.notification-ledger-table td:first-child i{width:5px;height:18px;display:inline-block;background:var(--accent)}.notification-ledger-table td:first-child i[data-level="page"]{background:var(--negative)}.notification-ledger-table td:first-child i[data-level="action"]{background:var(--warning)}.notification-ledger-table td:first-child i[data-level="muted"],.notification-ledger-table td:first-child i[data-level="cleared"]{background:var(--text-tertiary)}
.notification-detail-panel{display:grid;gap:8px}.notification-detail-head .status-pill--pending{border-color:rgba(210,153,34,.45);background:var(--warning-soft);color:var(--warning)}.notification-detail-head .status-pill--read{border-color:var(--accent-border);background:var(--accent-soft);color:var(--accent)}.notification-detail-head .status-pill--dismissed,.notification-detail-head .status-pill--cleared{border-color:var(--line);background:var(--surface-2);color:var(--text-tertiary)}.notification-evidence-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.notification-policy-evidence pre{max-height:150px}
@media(max-width:1180px){.notification-kpis{grid-template-columns:repeat(3,minmax(0,1fr))!important}.notification-center-layout{grid-template-columns:1fr}.notification-toolbar>div:last-child{grid-template-columns:repeat(3,minmax(0,1fr))}.notification-evidence-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:720px){.notification-kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}.notification-toolbar>div:last-child{grid-template-columns:1fr}.notification-ledger-table{min-width:0}.notification-evidence-grid{grid-template-columns:1fr}}
@media(max-width:479px){.notification-kpis{grid-template-columns:1fr!important}}
.runbook-center-view{--runbook-accent:var(--gpt)}
.runbook-kpis{grid-template-columns:repeat(5,minmax(0,1fr))!important}.runbook-kpis .metric-card[data-tone="negative"] strong{color:var(--negative)}.runbook-kpis .metric-card[data-tone="positive"] strong{color:var(--positive)}
.runbook-layout{min-width:0;display:grid;grid-template-columns:minmax(0,6.8fr) minmax(360px,5fr);align-items:start;gap:7px}.runbook-ledger-panel,.runbook-detail-panel{min-width:0;overflow:hidden}.runbook-ledger-panel{padding:0!important}.runbook-toolbar>div:last-child{grid-template-columns:116px 128px minmax(160px,1fr)}
.runbook-ledger-wrap{border:0;border-radius:0}.runbook-ledger-table{min-width:880px}.runbook-ledger-table tr{cursor:pointer}.runbook-ledger-table tr.is-selected{background:var(--surface-2);box-shadow:inset 2px 0 var(--gpt)}.runbook-ledger-table tr[data-kind="lease_expired"]{box-shadow:inset 2px 0 var(--negative)}.runbook-ledger-table tr[data-kind="workflow_blocked"],.runbook-ledger-table tr[data-kind="gpt_failure"]{box-shadow:inset 2px 0 var(--warning)}.runbook-ledger-table td{white-space:nowrap}.runbook-ledger-table td:first-child strong{display:flex;align-items:center;gap:5px;min-width:0}.runbook-ledger-table td:first-child i{width:5px;height:18px;display:inline-block;background:var(--accent)}.runbook-ledger-table td:first-child i[data-severity="critical"]{background:var(--negative)}.runbook-ledger-table td:first-child i[data-severity="warning"]{background:var(--warning)}
.runbook-detail-panel{display:grid;gap:8px}.runbook-link-strip{display:flex;gap:5px;flex-wrap:wrap}.runbook-steps{margin:0;padding:0;display:grid;gap:5px;list-style:none}.runbook-steps li{display:grid;grid-template-columns:28px minmax(0,1fr) max-content;gap:8px;align-items:start;padding:8px;border:1px solid var(--line);background:var(--surface-2)}.runbook-steps li>span{width:22px;height:22px;display:grid;place-items:center;border:1px solid var(--accent-border);background:var(--accent-soft);color:var(--accent);font:700 10px/1 var(--font-mono)}.runbook-steps strong{display:block;font-size:11px}.runbook-steps p{margin:2px 0;color:var(--text-secondary);font-size:10px;line-height:14px}.runbook-steps em{align-self:center;color:var(--text-tertiary);font:650 8px/1 var(--font-mono);text-transform:uppercase}.runbook-steps li[data-kind="operator_action"]>span{border-color:rgba(210,153,34,.4);background:var(--warning-soft);color:var(--warning)}.runbook-context-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
@media(max-width:1180px){.runbook-kpis{grid-template-columns:repeat(3,minmax(0,1fr))!important}.runbook-layout{grid-template-columns:1fr}.runbook-toolbar>div:last-child{grid-template-columns:repeat(3,minmax(0,1fr))}.runbook-context-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:720px){.runbook-kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}.runbook-toolbar>div:last-child{grid-template-columns:1fr}.runbook-ledger-table{min-width:0}.runbook-context-grid{grid-template-columns:1fr}.runbook-steps li{grid-template-columns:24px minmax(0,1fr)}.runbook-steps em{grid-column:2}}
@media(max-width:479px){.runbook-kpis{grid-template-columns:1fr!important}}
.workspace-view-switch{display:flex;align-self:end;height:24px;border:1px solid var(--line);background:var(--surface-2)}.workspace-view-switch button{height:22px;padding:0 8px;border:0;border-right:1px solid var(--line);border-radius:0;background:transparent;color:var(--text-tertiary);font:650 8px/1 var(--font-mono);text-transform:uppercase}.workspace-view-switch button:last-child{border-right:0}.workspace-view-switch button.active{background:var(--accent-soft);color:var(--accent)}
.workflow-board{display:grid;grid-template-columns:repeat(7,minmax(170px,1fr));gap:7px;overflow:auto}.workflow-board__lane{min-width:170px;padding:0!important;overflow:hidden}.workflow-board__lane>header{height:42px;padding:6px 7px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:var(--surface-2)}.workflow-board__lane h2{margin:0;font:700 15px/1 var(--font-mono)}.workflow-board__lane>div{max-height:560px;padding:5px;display:grid;gap:5px;overflow:auto}.workflow-board-card{padding:7px;display:grid;gap:6px;border:1px solid var(--line);background:var(--surface-0);color:inherit;text-decoration:none}.workflow-board-card:hover{border-color:var(--accent-border);background:var(--surface-2)}.workflow-board-card strong{display:block;overflow:hidden;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.workflow-board-card small,.workflow-board-card footer{color:var(--text-tertiary);font-size:8px}.workflow-board-card footer{display:flex;justify-content:space-between;gap:5px}
.workflow-timeline-panel{padding:0!important;overflow:hidden}.workflow-timeline-panel>header{height:44px;padding:6px 8px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:var(--surface-2)}.workflow-timeline-panel h2{margin:0;font-size:13px}.workflow-timeline-panel>header span{color:var(--text-tertiary);font:650 8px/1 var(--font-mono)}.workflow-timeline{margin:0;padding:7px 9px 10px;list-style:none}.workflow-timeline li{display:grid;grid-template-columns:92px 7px minmax(0,1fr);gap:8px;padding:7px 0;border-bottom:1px solid var(--line-soft)}.workflow-timeline li:last-child{border-bottom:0}.workflow-timeline time{color:var(--text-tertiary);font:650 8px/1.2 var(--font-mono)}.workflow-timeline i{width:7px;height:26px;background:var(--accent)}.workflow-timeline li[data-status="failed"] i,.workflow-timeline li[data-status="blocked"] i{background:var(--negative)}.workflow-timeline li[data-status="waiting_gpt"] i{background:var(--gpt)}.workflow-timeline li[data-status="completed"] i{background:var(--positive)}.workflow-timeline li>div>div{display:flex;align-items:center;justify-content:space-between;gap:7px}.workflow-timeline strong{font-size:11px}.workflow-timeline p{margin:3px 0;color:var(--text-secondary);font-size:10px;line-height:14px}
@media(max-width:1180px){.workflow-board{grid-template-columns:repeat(4,minmax(170px,1fr))}}
@media(max-width:720px){.workspace-toolbar{grid-template-columns:1fr!important}.workspace-view-switch{width:100%}.workspace-view-switch button{flex:1}.workflow-board{grid-template-columns:1fr;overflow:visible}.workflow-board__lane{min-width:0}.workflow-timeline li{grid-template-columns:70px 7px minmax(0,1fr)}}
.replay-evolution-panel{padding:0!important;overflow:hidden}.replay-evolution-panel>header{height:44px;padding:6px 8px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:var(--surface-2)}.replay-evolution-panel h2{margin:0;font-size:13px}.replay-evolution-panel>header span{color:var(--text-tertiary);font:650 8px/1 var(--font-mono)}.replay-evolution-chart{height:138px;padding:10px 8px 8px;display:flex;align-items:end;gap:5px;overflow:auto}.replay-evolution-chart a{min-width:42px;height:112px;display:grid;grid-template-rows:1fr 12px 12px;align-items:end;justify-items:center;color:inherit;text-decoration:none}.replay-evolution-chart i{width:18px;min-height:8px;display:block;background:var(--negative);box-shadow:0 0 0 1px rgba(248,81,73,.25)}.replay-evolution-chart i[data-positive="true"]{background:var(--positive);box-shadow:0 0 0 1px rgba(63,185,80,.25)}.replay-evolution-chart a[data-status="failed"] i,.replay-evolution-chart a[data-status="blocked"] i{background:var(--negative)}.replay-evolution-chart span{color:var(--text-tertiary);font:650 8px/1 var(--font-mono)}.replay-evolution-chart strong{color:var(--text-secondary);font:650 8px/1 var(--font-mono)}
.replay-day-intelligence-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(320px,.8fr);gap:7px}.replay-day-gpt-panel,.replay-day-conclusion-panel{padding:0!important;overflow:hidden}.replay-day-gpt-panel>header,.replay-day-conclusion-panel>header{height:38px;padding:6px 8px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:var(--surface-2)}.replay-day-gpt-panel h2,.replay-day-conclusion-panel h2{margin:0;font-size:12px}.replay-day-gpt-panel>header span,.replay-day-conclusion-panel>header span{color:var(--text-tertiary);font:650 8px/1 var(--font-mono)}.replay-day-gpt-list{max-height:230px;overflow:auto}.replay-day-gpt-list a{display:grid;grid-template-columns:120px minmax(0,1fr) minmax(90px,.6fr) max-content;gap:8px;align-items:center;padding:7px 8px;border-bottom:1px solid var(--line-soft);color:inherit;text-decoration:none}.replay-day-gpt-list a:hover{background:var(--surface-2)}.replay-day-gpt-list span,.replay-day-gpt-list small{overflow:hidden;color:var(--text-tertiary);font:650 8px/1 var(--font-mono);text-overflow:ellipsis;white-space:nowrap}.replay-day-gpt-list strong{overflow:hidden;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.replay-day-conclusion-panel blockquote{margin:0;padding:8px;border-bottom:1px solid var(--line-soft);color:var(--text-secondary);font-size:10px;line-height:15px}.replay-day-conclusion-panel blockquote span{display:block;margin-bottom:3px;color:var(--text-tertiary);font:650 8px/1 var(--font-mono)}.replay-day-timeline-section .event-timeline{max-height:460px;overflow:auto}
@media(max-width:960px){.replay-day-intelligence-grid{grid-template-columns:1fr}.replay-day-gpt-list a{grid-template-columns:1fr max-content}.replay-day-gpt-list small,.replay-day-gpt-list span{display:none}}

/* Terminal density — the compact mode is the operational default. */
.app-sidebar__brand{padding-inline:8px}.app-sidebar__brand>a{gap:7px}.app-sidebar__brand-copy{line-height:13px}.app-sidebar__brand-copy strong{font-size:13px}.app-sidebar__brand-copy small{font:9px/12px var(--font-mono)}
.session-context-card{margin:8px;padding:7px 8px;gap:5px;border-radius:var(--radius-sm)}.session-context-card>p{font-size:8px;line-height:10px}.session-context-card>div:first-of-type{gap:6px}.session-context-card strong{font-size:11px}.session-context-card>small{font:9px/12px var(--font-mono)}.phase-orb{width:17px;height:17px;border-radius:1px;font-size:9px}.phase-track span{padding:2px 1px;border-radius:1px;font:600 8px/11px var(--font-mono)}
.domain-nav{padding:0 5px 8px}.domain-nav__group{margin-top:8px}.domain-nav__group h2{margin:0 6px 2px;font-size:8px;line-height:10px}.domain-nav__group a{height:var(--row-h);padding:0 7px;grid-template-columns:16px minmax(0,1fr);gap:7px;border-radius:1px;font-size:11px}.domain-nav__group a svg{width:14px;height:14px}.domain-nav__group a.active{box-shadow:inset 2px 0 var(--accent),inset 0 1px rgba(255,255,255,.025),inset 0 -1px rgba(255,255,255,.025)}
.app-sidebar__footer{padding:6px 8px;gap:5px}.density-toggle{padding:1px;border:1px solid var(--line);border-radius:1px}.density-toggle button{height:24px;border-radius:1px;font:600 9px/1 var(--font-mono)}.auth-state{font:9px/12px var(--font-mono)}
.app-topbar{padding:0 12px;display:grid;grid-template-columns:auto minmax(160px,1fr) minmax(220px,320px) auto;justify-content:initial;gap:8px;background:var(--surface-1)}.topbar-terminal-state{position:static;min-width:0;display:flex;align-items:center;height:28px;border:1px solid var(--line);background:var(--surface-0)}.topbar-terminal-state>span{height:100%;min-width:0;padding:0 7px;display:flex;align-items:center;gap:4px;border-right:1px solid var(--line);color:var(--text-tertiary);font:650 8px/1 var(--font-mono);letter-spacing:.04em}.topbar-terminal-state>span:last-child{border-right:0}.topbar-terminal-state>span:first-child{color:var(--positive)}.topbar-terminal-state strong{max-width:104px;overflow:hidden;color:var(--text-primary);font-weight:650;text-overflow:ellipsis;white-space:nowrap}.topbar-terminal-state .api-dot{width:5px;height:5px;margin:0;background:var(--positive)}.terminal-market-tape{height:28px;min-width:0;display:flex;align-items:stretch;overflow:hidden;border:1px solid var(--line);background:var(--surface-0)}.terminal-market-tape__quote,.terminal-market-tape__empty{min-width:max-content;padding:0 7px;display:flex;align-items:center;gap:5px;border-right:1px solid var(--line);font:650 8px/1 var(--font-mono)}.terminal-market-tape__quote strong,.terminal-market-tape__empty strong{color:var(--text-secondary)}.terminal-market-tape__quote b{color:var(--text-primary);font-weight:650}.terminal-market-tape__quote em,.terminal-market-tape__empty em{color:var(--text-tertiary);font-style:normal}.terminal-market-tape__empty{width:100%;justify-content:space-between}.terminal-market-tape__empty em{color:var(--warning)}.global-search{width:100%;height:28px;border-radius:1px;background:var(--surface-0)}.global-search input{font:11px/1 var(--font-mono)}.global-search kbd{border-radius:1px;font-size:8px}.app-topbar__actions{position:static;right:auto;justify-self:end}.icon-btn{border-radius:1px}.notification-btn>span{border-radius:1px}
.app-main{padding:9px var(--content-pad-x);padding-bottom:10px!important}.view{gap:var(--gap-section)}
.card{border-radius:var(--radius-md)!important}.section-title{align-items:center!important;gap:8px!important;margin:1px 0 0!important;min-height:22px}.section-title h2,.panel-heading h2{font-size:12px;line-height:16px;letter-spacing:.01em}.section-title p{margin:0;color:var(--text-tertiary);font-size:9px}.eyebrow{margin:0 0 1px!important;font:650 8px/11px var(--font-mono)!important;letter-spacing:.08em!important}
.primary-btn,.secondary-btn,.danger-btn,.text-btn,.back-btn{padding:0 8px;gap:5px;border-radius:1px;font:620 10px/1 var(--font-sans)}.text-btn,.back-btn{padding-inline:5px}.inline-actions,.workspace-heading__actions,.command-panel__actions{gap:5px}label{font-size:10px}input,select,textarea{margin-top:3px;padding:4px 7px;border-radius:1px;font-size:11px}textarea{min-height:68px}
.breadcrumbs{min-height:13px;font:9px/12px var(--font-mono)}.workspace-heading.page-header-v2{min-height:48px;padding:0 0 7px!important;gap:7px}.workspace-heading__main{gap:5px}.workspace-heading__main h1{font-size:19px;line-height:22px;letter-spacing:-.015em}.workspace-heading__main p:last-child{margin:1px 0 0;font-size:9px;line-height:13px}.back-btn{width:26px;min-width:26px;margin-top:11px}.page-header-v2__tabs{gap:12px;margin-bottom:-8px}.page-header-v2__tabs a,.page-header-v2__tabs button{height:27px;font:600 9px/1 var(--font-mono)}
.status-ribbon{min-height:26px!important;padding:3px 7px!important;border-radius:1px!important}.status-pill,.status-chip,.action-pill{min-height:18px;padding:1px 5px;border-radius:1px!important;font:650 8px/13px var(--font-mono)!important;letter-spacing:.035em}.status-pill i{font-size:9px}
.metric-grid,.metric-strip{border-radius:1px}.metric-card{min-height:52px;padding:6px 9px!important}.metric-card>span{font:650 8px/11px var(--font-mono)!important;letter-spacing:.055em}.metric-card>strong{margin-top:0;font-size:16px;line-height:19px}.metric-card>small{margin-top:0;font-size:8px}.metric-grid--compact .metric-card{min-height:46px}
.data-table-wrap{border-radius:1px}.data-table th{height:25px;padding:0 8px;font:650 8px/1 var(--font-mono);letter-spacing:.055em}.data-table td{height:var(--row-h);padding:4px 8px;font-size:10px;line-height:13px}.data-table td>strong{font-size:10px}.data-table td>small,.data-table time{font-size:8px}.row-link{gap:2px;font:600 9px/1 var(--font-mono)}
.content-grid{gap:var(--gap-section)!important}.workspace-panel{gap:7px}.workspace-panel>h2,.command-panel h2,.decision-chart h2{font-size:12px;line-height:16px}.definition-grid dt,.definition-grid dd,.detail-pairs>div{padding:4px 0}.definition-grid dt{font-size:9px}.definition-grid dd{font-size:9px;line-height:14px}.detail-pairs{font-size:10px}.workspace-toolbar{padding:5px!important}.command-panel{gap:10px}.command-panel p{margin:1px 0 0;font-size:9px;line-height:13px}.step-list>li{grid-template-columns:21px minmax(0,1fr) auto;gap:5px}.step-list>li>span{width:16px;height:16px;border-radius:1px;font-size:8px}.incident-list{gap:4px}.incident-card{padding:7px 9px!important;gap:8px}.incident-card p{margin:2px 0 0 14px;font-size:9px}
.live-decision-grid{grid-template-columns:minmax(0,2.35fr) minmax(260px,.65fr);gap:8px}.decision-card{min-height:136px;grid-template-columns:3px minmax(0,1fr)}.decision-card__body{padding:9px 11px;gap:6px}.decision-card__top,.setup-card__header,.brief-card__header,.thesis-card__top,.operator-panel__head,.comparison-react__head,.condition-react__head,.alert-react__head{gap:7px}.decision-card__decision{font-size:18px!important;line-height:21px!important}.decision-card__top h2{font-size:12px;line-height:16px}.decision-card__summary{font-size:10px;line-height:15px}.decision-card__reasoning{gap:7px}.decision-card__reasoning>div{padding:5px 7px}.decision-card__reasoning span{font:650 8px/11px var(--font-mono)}.decision-card__reasoning p{margin:1px 0 0;font-size:9px;line-height:13px}.decision-card__footer,.setup-card__footer{padding-top:6px}.live-desk-v2 :is(.eyebrow,small,.status-pill,.status-chip,.action-pill,.row-link,.section-title p,.metric-card>span,.metric-card>small,.market-table th,.market-table td,.activity-item,.timeline-item,.brief-card__verdict,.setup-card__footer,.setup-card__footer span,.source-priority-react,.news-digest-preview span,.news-digest-preview p,.definition-grid dt,.definition-grid dd){font-size:9px!important}.live-desk-v2 .metric-card{min-height:48px}.live-desk-v2 .status-ribbon{min-height:24px!important}.thesis-summary{gap:6px}.thesis-summary h2{font-size:13px}.thesis-summary>p{font-size:9px;line-height:13px}.thesis-summary__metrics>div{padding:5px 6px}.thesis-summary__metrics span,.thesis-summary dt,.thesis-summary dd{font-size:9px}.thesis-summary__metrics strong{font-size:13px;line-height:17px}.thesis-summary dl{grid-template-columns:82px 1fr;gap:2px 6px}.audit-mini{gap:5px}.audit-mini h3{font-size:12px}.audit-mini>p{font-size:9px}
.strategy-grid,.session-list-react,.replay-day-grid{gap:7px}.strategy-card{gap:7px}.strategy-card h2,.session-card-react h2,.replay-day-card h2{font-size:14px;line-height:18px}.session-card-react{min-height:104px}.session-card-react p:not(.eyebrow){margin:2px 0;font-size:10px}.replay-day-card{gap:6px}.replay-day-card__metrics>span{padding:5px 6px;font-size:8px}.replay-day-card__metrics strong{font-size:11px;line-height:15px}.comparison-picker>label{min-height:38px;padding:5px 7px;border-radius:1px}.session-preview-list>a,.gpt-row,.conclusion-item{padding:3px 0}
.master-document-grid{grid-template-columns:minmax(0,9fr) minmax(260px,3fr);gap:12px}.master-document-content{gap:12px}.master-document-content>.master-hero-react,.master-prose-section{width:min(100%,860px)}.master-hero-react .detail-pairs--four{margin-top:8px;gap:0 10px!important}.master-prose-section>h2{margin:0 0 5px;font-size:15px;line-height:20px}.master-prose-section>p:not(.eyebrow){font-size:11px;line-height:18px}.master-document-rail{gap:7px}.master-toc a{min-height:26px;padding:4px 0;font-size:9px}.master-levels>div{min-height:28px;padding:3px 0;font-size:9px}.master-levels strong,.master-levels span,.master-levels small,.master-document-rail .step-list p{font-size:9px}
.performance-calendar-grid>*{min-height:66px;padding:4px}.performance-weekdays>span{padding:5px;font:650 8px/1 var(--font-mono)}.performance-day>strong{margin-top:4px;font-size:11px}.performance-day-stats{margin-top:4px;font-size:8px}.performance-kpi{min-height:58px}.performance-kpi>strong{font-size:17px}.performance-master-detail{gap:8px}.performance-master-detail>header{padding-bottom:7px}.performance-master-detail h2{font-size:14px}.performance-detail-section{padding:7px;gap:6px;border-radius:1px}.performance-day-result{padding:8px}.performance-day-result strong{font-size:20px}.performance-day-stats>div{padding:5px}
.timeline-item{grid-template-columns:40px minmax(0,1fr);gap:5px!important}.timeline-item__time{padding-top:6px;font-size:8px}.timeline-item__content{padding:5px 7px}.timeline-item__content p{margin:1px 0 0;font-size:9px}.activity-label{font-size:10px}.activity-detail{margin-top:1px;font-size:8px}.tag-list{gap:3px}.tag-list span{padding:2px 5px;border-radius:1px;font-size:8px}
.desk-function-bar{position:sticky;top:-9px;z-index:var(--z-sticky);min-width:0;height:30px;display:flex;align-items:stretch;overflow-x:auto;border:1px solid var(--line);background:var(--surface-0);scrollbar-width:none}.desk-function-bar::-webkit-scrollbar{display:none}.desk-function-bar button{min-width:max-content;height:28px;padding:0 10px;display:flex;align-items:center;gap:6px;border:0;border-right:1px solid var(--line);background:var(--surface-1);color:var(--text-secondary);font:650 9px/1 var(--font-mono);cursor:pointer}.desk-function-bar button:hover{background:var(--surface-2);color:var(--text-primary)}.desk-function-bar button.active{background:var(--accent-soft);color:var(--text-primary);box-shadow:inset 0 -2px var(--accent)}.desk-function-bar kbd{min-width:18px;padding:2px 3px;border:1px solid rgba(210,153,34,.42);border-radius:1px;background:var(--warning-soft);color:var(--warning);font:700 8px/1 var(--font-mono);text-align:center}.live-module{min-width:0;display:grid;gap:6px;scroll-margin-top:38px}.live-module>.section-title{padding-left:7px!important;border-left:2px solid var(--line)!important}.live-module:hover>.section-title{border-left-color:var(--accent)!important}.live-module--decision{gap:7px}.terminal-empty-state{min-height:40px;padding:7px 8px;display:grid;align-content:center;gap:2px;border:1px dashed var(--line);background:repeating-linear-gradient(-45deg,transparent,transparent 5px,rgba(255,255,255,.012) 5px,rgba(255,255,255,.012) 10px)}.terminal-empty-state span{color:var(--warning);font:650 9px/1 var(--font-mono)}.terminal-empty-state small{color:var(--text-tertiary);font-size:9px}.terminal-table-empty td{height:42px!important;text-align:center!important}.terminal-table-empty td:before{display:none!important}.terminal-table-empty td>span,.terminal-table-empty td>small{display:inline!important;font:650 9px/1 var(--font-mono)!important}.terminal-table-empty td>span{margin-right:8px;color:var(--warning)}.terminal-table-empty td>small{color:var(--text-tertiary)!important}

@media(max-width:1023px){
  :root{--content-pad-x:12px;--grid-gutter:10px;--row-h:40px;--control-h:40px;--pad-card:10px;--gap-section:9px}
  .app-topbar{display:flex}.topbar-terminal-state,.terminal-market-tape{display:none}.app-main{padding:10px var(--content-pad-x)}.workspace-heading.page-header-v2{min-height:50px}.workspace-heading__main h1{font-size:19px;line-height:23px}.metric-card{min-height:58px}.mobile-context{padding-inline:12px}.master-document-content{gap:10px}.desk-function-bar{top:-10px}
}
@media(min-width:1024px) and (max-width:1279px){.topbar-terminal-state>span:last-child{display:none}.terminal-market-tape__quote:nth-child(n+3){display:none}.app-topbar{grid-template-columns:auto minmax(130px,1fr) minmax(200px,260px) auto}}
@media(max-width:767px){
  :root{--content-pad-x:10px;--grid-gutter:8px;--pad-card:9px;--gap-section:8px}
  .workspace-heading.page-header-v2{padding-bottom:7px!important}.workspace-heading__main h1{font-size:18px;line-height:22px}.workspace-heading__actions{gap:4px}.breadcrumbs{font-size:8px}.data-table,.data-table tbody{gap:5px}.data-table tr{padding:3px 8px;border-radius:1px}.data-table td{min-height:31px;padding:4px 0;grid-template-columns:82px minmax(0,1fr)}.data-table td:before{font-size:8px}.decision-card__body{padding:8px 9px}.modal__card,.drawer{border-radius:3px 3px 0 0}.performance-calendar-grid>*{min-height:54px}.more-domains{gap:7px}.more-domains>section{border-radius:1px}.more-domains a{min-height:44px}
}
@media(max-width:479px){.metric-card{min-height:50px}.performance-kpi{min-height:54px}}
@media(pointer:coarse){:root{--row-h:44px;--control-h:40px;--pad-card:10px}}

/* Replay Lab V3 — dense research workstation */
.replay-lab-v3,.replay-day-v3,.replay-session-v3,.replay-run-v3,.gpt-inspector-v3,.replay-compare-v3{--replay-accent:var(--gpt)}
.replay-summary-strip{grid-template-columns:repeat(6,minmax(0,1fr))!important}.replay-summary-strip .metric-card:nth-child(6){border-right:0!important}
.replay-filter-bar{padding:6px!important;display:grid;grid-template-columns:minmax(210px,1.35fr) repeat(3,minmax(116px,.65fr)) repeat(2,minmax(126px,.7fr)) auto;align-items:end;gap:5px}.replay-filter-bar label{min-width:0;display:grid;gap:2px}.replay-filter-bar label>span,.replay-day-filters label>span{color:var(--text-tertiary);font:650 8px/1 var(--font-mono);letter-spacing:.05em;text-transform:uppercase}.replay-filter-bar input,.replay-filter-bar select,.replay-day-filters select{height:28px;min-height:28px;margin:0;padding:3px 6px;font:550 9px/1 var(--font-mono)}.replay-filter-search>div{height:28px;display:grid;grid-template-columns:15px 1fr;align-items:center;padding:0 6px;border:1px solid var(--line);background:var(--surface-2);color:var(--text-tertiary)}.replay-filter-search>div input{height:26px;border:0;background:transparent}.replay-filter-bar__result{height:28px;min-width:106px;padding:0 7px;display:flex;align-items:center;gap:4px;border:1px solid var(--line);background:var(--surface-0);white-space:nowrap}.replay-filter-bar__result strong{font:650 13px/1 var(--font-mono)}.replay-filter-bar__result span{color:var(--text-tertiary);font-size:8px}.replay-filter-bar__result .text-btn{margin-left:auto}
.replay-terminal-section{min-width:0;display:grid;gap:5px}.replay-terminal-section>header{min-height:28px;display:flex;align-items:end;justify-content:space-between;gap:10px;padding:0 7px 4px;border-left:2px solid var(--replay-accent);border-bottom:1px solid var(--line)}.replay-terminal-section>header h2{margin:0;font-size:12px;line-height:15px}.replay-terminal-section>header>span{color:var(--text-tertiary);font:500 8px/1 var(--font-mono);white-space:nowrap}.replay-empty-state{min-height:150px}.terminal-code{width:max-content;padding:2px 5px;border:1px solid rgba(163,113,247,.38);background:var(--gpt-soft);color:var(--gpt);font:650 8px/1 var(--font-mono)}
.replay-overview-table td,.replay-run-table td,.replay-session-table td{white-space:nowrap}.replay-overview-table td:first-child,.replay-run-table td:first-child{min-width:125px}.replay-overview-table .progress-line,.replay-run-table .progress-line,.replay-session-table .progress-line{min-width:92px}.replay-attempt-track{min-width:80px;height:18px;display:flex;align-items:center;gap:2px}.replay-attempt-track i{width:9px;height:9px;border:1px solid var(--line);background:var(--text-disabled)}.replay-attempt-track i[data-status="completed"]{background:var(--positive)}.replay-attempt-track i[data-status="running"]{background:var(--accent)}.replay-attempt-track i[data-status="waiting_gpt"]{background:var(--gpt)}.replay-attempt-track i[data-status="failed"],.replay-attempt-track i[data-status="blocked"]{background:var(--negative)}.replay-session-counts{display:flex;gap:3px}.replay-session-counts span{padding:2px 4px;border:1px solid var(--line);background:var(--surface-2);color:var(--text-tertiary);font:650 8px/1 var(--font-mono)}.replay-session-counts strong{color:var(--text-primary)}.replay-overview-table td:nth-child(6),.replay-run-table td:nth-child(6){font-family:var(--font-mono)}.replay-overview-table td:last-child,.replay-run-table td:last-child,.replay-session-table td:last-child{text-align:right}
.replay-session-lanes{display:grid;border:1px solid var(--line);background:var(--surface-1)}.replay-session-lane{min-height:50px;display:grid;grid-template-columns:120px minmax(0,1fr) 74px;align-items:center;border-bottom:1px solid var(--line)}.replay-session-lane:last-child{border-bottom:0}.replay-session-lane>div:first-child{height:100%;padding:7px 9px;display:grid;align-content:center;border-right:1px solid var(--line);background:var(--surface-2)}.replay-session-lane>div:first-child strong,.replay-session-lane>div:first-child small{display:block}.replay-session-lane>div:first-child strong{font:650 10px/1 var(--font-mono)}.replay-session-lane>div:first-child small{margin-top:3px;color:var(--text-tertiary);font-size:8px}.replay-session-lane__track{min-width:0;display:flex;align-items:center;gap:5px;padding:5px 8px;overflow-x:auto}.replay-session-lane__track a{min-width:94px;height:34px;padding:4px 6px;display:grid;grid-template-columns:18px 6px minmax(0,1fr);align-items:center;gap:4px;border:1px solid var(--line);background:var(--surface-0)}.replay-session-lane__track a:hover{border-color:var(--accent-border);background:var(--surface-2)}.replay-session-lane__track a>span{font:650 8px/1 var(--font-mono)}.replay-session-lane__track a>i{width:6px;height:18px;background:var(--text-disabled)}.replay-session-lane__track a[data-status="completed"]>i{background:var(--positive)}.replay-session-lane__track a[data-status="running"]>i{background:var(--accent)}.replay-session-lane__track a[data-status="waiting_gpt"]>i{background:var(--gpt)}.replay-session-lane__track a[data-status="failed"]>i,.replay-session-lane__track a[data-status="blocked"]>i{background:var(--negative)}.replay-session-lane__track small{overflow:hidden;color:var(--text-tertiary);font:7px/10px var(--font-mono);text-overflow:ellipsis;white-space:nowrap}.replay-session-lane__result{padding:0 8px;text-align:right}.replay-session-lane__result strong,.replay-session-lane__result small{display:block;font-family:var(--font-mono)}.replay-session-lane__result strong{font-size:10px}.replay-session-lane__result small{color:var(--text-tertiary);font-size:8px}
.replay-day-filters{padding:6px!important;display:grid;grid-template-columns:repeat(3,minmax(140px,220px)) minmax(160px,1fr);align-items:end;gap:5px}.replay-day-filters label{display:grid;gap:2px}.replay-day-filters>div:last-child{height:28px;padding:0 7px;display:flex;align-items:center;justify-content:flex-end;gap:4px;border:1px solid var(--line);background:var(--surface-0)}.replay-day-filters>div strong{font:650 12px/1 var(--font-mono)}.replay-day-filters>div span{color:var(--text-tertiary);font-size:8px}
.replay-session-context-strip{min-width:0;height:27px;display:flex;overflow:hidden;border:1px solid var(--line);background:var(--surface-0)}.replay-session-context-strip>span{min-width:0;padding:0 7px;display:flex;align-items:center;gap:4px;border-right:1px solid var(--line);color:var(--text-tertiary);font:650 8px/1 var(--font-mono);white-space:nowrap}.replay-session-context-strip strong{max-width:190px;overflow:hidden;color:var(--text-primary);text-overflow:ellipsis}.replay-session-context-strip>span:last-child strong{color:var(--positive)}
.replay-session-workbench{min-width:0;display:grid;grid-template-columns:minmax(0,8fr) minmax(270px,4fr);align-items:start;gap:7px}.replay-session-rail{min-width:0;display:grid;gap:6px}.replay-session-workbench .decision-chart{min-width:0}.replay-session-workbench .chart-scroll svg{height:300px}.replay-session-workbench .chart-empty{min-height:210px}.replay-event-inspector,.replay-gpt-rail,.replay-conclusion-rail{display:grid;gap:6px}.replay-event-inspector>header,.replay-gpt-rail>header,.replay-conclusion-rail>header,.gpt-conclusion-panel>header,.gpt-transport-panel>header,.comparison-selector-v3>header{display:flex;align-items:flex-start;justify-content:space-between;gap:7px}.replay-event-inspector h2,.replay-gpt-rail h2,.gpt-conclusion-panel h2{margin:0;font-size:12px;line-height:16px}.replay-event-inspector__meta{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line)}.replay-event-inspector__meta span{min-width:0;padding:5px;background:var(--surface-2);color:var(--text-tertiary);font:650 7px/10px var(--font-mono)}.replay-event-inspector__meta strong{display:block;overflow:hidden;color:var(--text-primary);font-size:8px;text-overflow:ellipsis;white-space:nowrap}.replay-event-inspector>p{margin:0;color:var(--text-secondary);font-size:9px;line-height:13px}.terminal-counter{min-width:20px;height:18px;padding:0 4px;display:grid;place-items:center;border:1px solid var(--line);background:var(--surface-0);font:650 8px/1 var(--font-mono)}.replay-gpt-process-list{display:grid}.replay-gpt-process-list>a{min-height:34px;padding:3px 0;display:grid;grid-template-columns:20px minmax(0,1fr) auto;align-items:center;gap:5px;border-bottom:1px solid var(--line-soft)}.replay-gpt-process-list>a:last-child{border-bottom:0}.replay-gpt-process-list__index{color:var(--gpt);font:650 8px/1 var(--font-mono)}.replay-gpt-process-list strong,.replay-gpt-process-list small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.replay-gpt-process-list strong{font-size:9px}.replay-gpt-process-list small{color:var(--text-tertiary);font-size:8px}.replay-conclusion-rail blockquote{margin:0;padding:5px 7px;border-left:2px solid var(--gpt);background:var(--gpt-soft);color:var(--text-secondary);font-size:9px;line-height:13px}.replay-conclusion-rail blockquote span{display:block;color:var(--gpt);font:650 7px/10px var(--font-mono)}
.decision-chart>header{padding:7px 9px}.decision-chart>header small{font-size:8px}.zoom-control,.layer-toggles button{height:26px}.zoom-control button{width:25px}.zoom-control label{padding-inline:5px;font-size:8px}.zoom-control input{width:54px}.layer-toggles button{padding-inline:6px;border-radius:1px;font:600 8px/1 var(--font-mono)}.chart-event-strip a{min-width:108px;padding:5px 7px}.chart-event-strip span{font-size:7px}.chart-event-strip strong{font-size:8px}.event-timeline:before{left:92px}.event-timeline>li{grid-template-columns:78px 13px minmax(0,1fr);padding:2px 0}.event-timeline>li>time{padding-top:6px;font-size:8px}.event-timeline>li>i{margin-top:7px}.event-timeline>li>div{padding:5px 7px;border-radius:1px}.event-timeline p{margin:1px 0;font-size:9px;line-height:13px}.event-timeline a{font-size:8px}
.gpt-lifecycle-rail{min-height:52px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--line);background:var(--surface-1)}.gpt-lifecycle-rail>div{position:relative;min-width:0;padding:7px 8px;display:grid;grid-template-columns:20px 7px minmax(0,1fr);align-items:center;gap:5px;border-right:1px solid var(--line)}.gpt-lifecycle-rail>div:last-child{border-right:0}.gpt-lifecycle-rail>div>span{font:650 8px/1 var(--font-mono)}.gpt-lifecycle-rail>div>i{width:7px;height:22px;background:var(--text-disabled)}.gpt-lifecycle-rail>div[data-state="completed"]>i{background:var(--positive)}.gpt-lifecycle-rail>div[data-state="current"]>i{background:var(--gpt)}.gpt-lifecycle-rail>div[data-state="failed"]>i{background:var(--negative)}.gpt-lifecycle-rail strong,.gpt-lifecycle-rail small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gpt-lifecycle-rail strong{font-size:9px}.gpt-lifecycle-rail small{margin-top:2px;color:var(--text-tertiary);font:7px/10px var(--font-mono)}.gpt-inspector-workbench{display:grid;grid-template-columns:minmax(0,8fr) minmax(280px,4fr);align-items:start;gap:7px}.gpt-conclusion-panel,.gpt-transport-panel{display:grid;gap:7px}.gpt-conclusion-panel .conclusion-copy{min-height:70px;margin:0;padding:9px;border-left:2px solid var(--gpt);background:var(--gpt-soft);color:var(--text-primary);font-size:12px;line-height:18px}.gpt-output-meta{display:flex;overflow:hidden;border:1px solid var(--line)}.gpt-output-meta span{min-width:0;padding:4px 6px;border-right:1px solid var(--line);color:var(--text-tertiary);font:650 7px/1 var(--font-mono)}.gpt-output-meta strong{color:var(--text-primary)}.gpt-error-box{padding:7px 9px!important;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:10px}.gpt-error-box>div{display:grid}.gpt-error-box span{color:var(--negative);font:650 7px/1 var(--font-mono)}.gpt-error-box p{margin:0}.gpt-payload-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.gpt-payload-grid .raw-inspector{min-width:0;padding:6px 8px;border:1px solid var(--line);background:var(--surface-1)}.gpt-payload-grid .raw-inspector>pre{max-height:260px;margin:6px 0 0;padding:7px;overflow:auto;border:1px solid var(--line);background:var(--surface-0);color:var(--text-secondary);font-size:8px;line-height:12px}
.gpt-contract-panel{padding:0!important;overflow:hidden}.gpt-contract-panel>header{height:36px;padding:5px 8px;display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid var(--line);background:var(--surface-2)}.gpt-contract-panel h2{margin:0;font-size:12px;line-height:16px}.lease-badge{height:18px;padding:0 6px;display:inline-grid;place-items:center;border:1px solid var(--line);background:var(--surface-0);color:var(--text-tertiary);font:650 8px/1 var(--font-mono)}.lease-badge[data-state="active"]{border-color:rgba(63,185,80,.35);background:var(--positive-soft);color:var(--positive)}.lease-badge[data-state="expiring"]{border-color:rgba(210,153,34,.36);background:var(--warning-soft);color:var(--warning)}.lease-badge[data-state="expired"]{border-color:rgba(248,81,73,.35);background:var(--negative-soft);color:var(--negative)}.gpt-contract-grid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));background:var(--line)}.gpt-contract-grid>span{min-width:0;padding:6px 7px;display:grid;gap:3px;background:var(--surface-1)}.gpt-contract-grid small{overflow:hidden;color:var(--text-tertiary);font:650 7px/1 var(--font-mono);text-transform:uppercase;text-overflow:ellipsis;white-space:nowrap}.gpt-contract-grid strong{overflow:hidden;color:var(--text-primary);font:650 9px/1.25 var(--font-mono);text-overflow:ellipsis;white-space:nowrap}
.comparison-selector-v3{gap:6px}.comparison-picker{grid-template-columns:repeat(4,minmax(0,1fr))}.comparison-picker>label{min-height:38px}.comparison-picker>label.selected{box-shadow:inset 2px 0 var(--gpt)}

@media(max-width:1279px){
  .replay-summary-strip{grid-template-columns:repeat(3,minmax(0,1fr))!important}.replay-summary-strip .metric-card:nth-child(3){border-right:0!important}.replay-summary-strip .metric-card:nth-child(n+4){border-top:1px solid var(--line)!important}
  .replay-filter-bar{grid-template-columns:repeat(3,minmax(0,1fr))}.replay-filter-search{grid-column:span 2}.replay-filter-bar__result{justify-content:flex-end}
  .comparison-picker{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:1023px){
  .replay-session-workbench,.gpt-inspector-workbench{grid-template-columns:1fr}.replay-session-rail{grid-template-columns:repeat(2,minmax(0,1fr))}.replay-event-inspector{grid-column:1/-1}.gpt-payload-grid{grid-template-columns:1fr}.gpt-contract-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.replay-session-context-strip{overflow-x:auto}.replay-session-context-strip>span{min-width:max-content}
}
@media(max-width:767px){
  .replay-summary-strip{grid-template-columns:repeat(2,minmax(0,1fr))!important}.replay-summary-strip .metric-card:nth-child(2n){border-right:0!important}.replay-summary-strip .metric-card:nth-child(3){border-right:1px solid var(--line)!important}.replay-summary-strip .metric-card:nth-child(n+3){border-top:1px solid var(--line)!important}
  .replay-filter-bar{grid-template-columns:1fr 1fr}.replay-filter-search,.replay-filter-bar__result{grid-column:1/-1}.replay-filter-bar__result{justify-content:flex-start}.replay-filter-bar__result .text-btn{margin-left:auto}.replay-terminal-section>header{align-items:flex-start;flex-direction:column}.replay-terminal-section>header>span{white-space:normal}
  .replay-day-filters{grid-template-columns:1fr 1fr}.replay-day-filters>div:last-child{grid-column:1/-1}.replay-session-lane{grid-template-columns:82px minmax(0,1fr) 54px}.replay-session-lane__track a{min-width:84px}.replay-session-rail{grid-template-columns:1fr}.replay-event-inspector{grid-column:auto}.gpt-lifecycle-rail{grid-template-columns:1fr 1fr}.gpt-lifecycle-rail>div:nth-child(2){border-right:0}.gpt-lifecycle-rail>div:nth-child(n+3){border-top:1px solid var(--line)}.gpt-contract-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.gpt-output-meta{display:grid}.gpt-output-meta span{border-right:0;border-bottom:1px solid var(--line)}.comparison-picker{grid-template-columns:1fr}.chart-empty{padding:10px}.replay-session-workbench .chart-scroll svg{height:240px}
}
@media(max-width:479px){.replay-filter-bar,.replay-day-filters{grid-template-columns:1fr}.replay-filter-search,.replay-filter-bar__result,.replay-day-filters>div:last-child{grid-column:auto}.replay-summary-strip{grid-template-columns:1fr!important}.replay-summary-strip .metric-card{border-right:0!important}.replay-session-lane{grid-template-columns:72px minmax(0,1fr)}.replay-session-lane__result{display:none}.gpt-lifecycle-rail,.gpt-contract-grid{grid-template-columns:1fr}}

/* Performance Intelligence V3 — equity, risk and attribution terminal */
.performance-intelligence-v3{--performance-accent:var(--positive)}
.performance-kpi-strip{grid-template-columns:repeat(6,minmax(0,1fr))!important}.performance-kpi-strip .metric-card:nth-child(6){border-right:0!important}
.performance-filter-bar{padding:6px!important;display:grid;grid-template-columns:repeat(4,minmax(105px,.7fr)) repeat(2,minmax(125px,.75fr)) auto;align-items:end;gap:5px}.performance-filter-bar label{min-width:0;display:grid;gap:2px}.performance-filter-bar label>span{color:var(--text-tertiary);font:650 8px/1 var(--font-mono);letter-spacing:.05em;text-transform:uppercase}.performance-filter-bar input,.performance-filter-bar select{height:28px;min-height:28px;margin:0;padding:3px 6px;font:550 9px/1 var(--font-mono)}.performance-filter-bar__result{height:28px;min-width:104px;padding:0 7px;display:flex;align-items:center;gap:4px;border:1px solid var(--line);background:var(--surface-0);white-space:nowrap}.performance-filter-bar__result strong{font:650 13px/1 var(--font-mono)}.performance-filter-bar__result span{color:var(--text-tertiary);font-size:8px}.performance-filter-bar__result .text-btn{margin-left:auto}
.performance-workbench-v3{min-width:0;display:grid;grid-template-columns:minmax(0,8fr) minmax(250px,4fr);align-items:start;gap:7px}.performance-equity-panel{min-width:0;padding:0!important;overflow:hidden}.performance-equity-panel>header{height:38px;padding:5px 8px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line)}.performance-equity-panel h2,.performance-breakdown-terminal h2{margin:0;font-size:12px;line-height:16px}.performance-chart-legend{display:flex;align-items:center;gap:10px;color:var(--text-tertiary);font:600 8px/1 var(--font-mono)}.performance-chart-legend span{display:flex;align-items:center;gap:4px}.performance-chart-legend i{width:13px;height:2px;background:var(--positive)}.performance-chart-legend i[data-series="drawdown"]{background:var(--negative)}.performance-equity-panel svg{display:block;width:100%;height:302px;background:var(--surface-0)}.performance-equity-panel svg text{fill:var(--text-tertiary);font:8px var(--font-mono)}.performance-grid-line{stroke:var(--line-soft);stroke-width:1}.performance-zero-line{stroke:var(--text-tertiary);stroke-width:.7;stroke-dasharray:3 4}.performance-equity-area{fill:rgba(63,185,80,.055)}.performance-equity-line{fill:none;stroke:var(--positive);stroke-width:1.8;vector-effect:non-scaling-stroke}.performance-equity-point{fill:var(--positive);stroke:var(--surface-0);stroke-width:2;vector-effect:non-scaling-stroke}.performance-drawdown-baseline{stroke:var(--line);stroke-width:1}.performance-drawdown-area{fill:rgba(248,81,73,.09)}.performance-drawdown-line{fill:none;stroke:var(--negative);stroke-width:1.3;vector-effect:non-scaling-stroke}.performance-equity-panel>footer{height:27px;padding:0 8px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--line);color:var(--text-tertiary);font:550 8px/1 var(--font-mono)}.performance-equity-panel>footer strong{color:var(--text-secondary)}.performance-chart-empty{min-height:302px;display:grid;place-content:center;justify-items:center;color:var(--text-tertiary);text-align:center}.performance-chart-empty strong{margin-top:5px;color:var(--text-primary);font-size:11px}.performance-chart-empty p{max-width:380px;margin:2px 0;font-size:9px}
.performance-risk-rail{min-width:0;display:grid;gap:6px}.performance-risk-rail>.card{padding:7px 9px!important}.performance-risk-rail header{height:20px;display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid var(--line)}.performance-risk-rail header>span{color:var(--positive);font:650 7px/1 var(--font-mono)}.performance-risk-list{margin:0;display:grid;grid-template-columns:minmax(0,1fr) auto}.performance-risk-list dt,.performance-risk-list dd{min-height:27px;margin:0;padding:5px 0;border-bottom:1px solid var(--line-soft)}.performance-risk-list dt{color:var(--text-tertiary);font-size:9px}.performance-risk-list dd{color:var(--text-primary);font:600 9px/16px var(--font-mono);text-align:right}.performance-risk-list .positive{color:var(--positive)!important}.performance-risk-list .negative{color:var(--negative)!important}
.performance-daily-section>header,.performance-related-runs>header{border-left-color:var(--performance-accent)}.performance-daily-table td{white-space:nowrap}.performance-daily-table td:nth-child(2){min-width:104px;font-family:var(--font-mono)}.performance-daily-table td:nth-child(5),.performance-daily-table td:nth-child(6){font-family:var(--font-mono)}.performance-result-bar{width:72px;height:3px;margin-top:3px;display:block;background:var(--surface-3)}.performance-result-bar i{height:100%;display:block;background:var(--positive)}.performance-result-bar i[data-tone="negative"]{background:var(--negative)}
.performance-breakdown-terminal{display:grid;gap:5px}.performance-breakdown-terminal>header{min-height:28px;padding:0 7px 4px;display:flex;align-items:end;justify-content:space-between;border-left:2px solid var(--performance-accent);border-bottom:1px solid var(--line)}.performance-breakdown-terminal>header>span{color:var(--text-tertiary);font:500 8px/1 var(--font-mono)}.performance-breakdown-matrix{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--line);background:var(--surface-1)}.performance-breakdown-matrix>div{min-width:0;border-right:1px solid var(--line)}.performance-breakdown-matrix>div:last-child{border-right:0}.performance-breakdown-matrix>div>header{height:27px;padding:0 7px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:var(--surface-2);color:var(--text-tertiary);font:650 8px/1 var(--font-mono)}.performance-breakdown-row{min-height:32px;padding:4px 7px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:2px 7px;border-bottom:1px solid var(--line-soft)}.performance-breakdown-row:last-child{border-bottom:0}.performance-breakdown-row>span{min-width:0;overflow:hidden;color:var(--text-secondary);font:550 9px/1 var(--font-mono);text-overflow:ellipsis;white-space:nowrap}.performance-breakdown-row>span a{color:var(--accent)}.performance-breakdown-row>strong{font:650 9px/1 var(--font-mono)}.performance-breakdown-row>small{grid-column:1/-1;color:var(--text-tertiary);font:7px/1 var(--font-mono)}.performance-related-runs td:last-child{text-align:right}.performance-empty-state{min-height:170px}
.strategy-terminal-section>header{border-left-color:var(--warning)}.strategy-registry-table td{white-space:nowrap}.strategy-source-flags{display:flex;gap:2px}.strategy-source-flags i{padding:2px 3px;border:1px solid var(--line);background:var(--surface-0);color:var(--text-disabled);font:650 7px/1 var(--font-mono);font-style:normal}.strategy-source-flags i[data-ready="true"]{border-color:rgba(63,185,80,.32);background:var(--positive-soft);color:var(--positive)}

@media(max-width:1279px){
  .performance-kpi-strip{grid-template-columns:repeat(3,minmax(0,1fr))!important}.performance-kpi-strip .metric-card:nth-child(3){border-right:0!important}.performance-kpi-strip .metric-card:nth-child(n+4){border-top:1px solid var(--line)!important}
  .performance-filter-bar{grid-template-columns:repeat(4,minmax(0,1fr))}.performance-filter-bar__result{justify-content:flex-end}
}
@media(max-width:1023px){
  .performance-workbench-v3{grid-template-columns:1fr}.performance-risk-rail{grid-template-columns:1fr 1fr}.performance-breakdown-matrix{grid-template-columns:repeat(2,minmax(0,1fr))}.performance-breakdown-matrix>div:nth-child(2){border-right:0}.performance-breakdown-matrix>div:nth-child(n+3){border-top:1px solid var(--line)}
}
@media(max-width:767px){
  .performance-kpi-strip{grid-template-columns:repeat(2,minmax(0,1fr))!important}.performance-kpi-strip .metric-card:nth-child(2n){border-right:0!important}.performance-kpi-strip .metric-card:nth-child(3){border-right:1px solid var(--line)!important}.performance-kpi-strip .metric-card:nth-child(n+3){border-top:1px solid var(--line)!important}
  .performance-filter-bar{grid-template-columns:1fr 1fr}.performance-filter-bar__result{grid-column:1/-1;justify-content:flex-start}.performance-filter-bar__result .text-btn{margin-left:auto}.performance-risk-rail{grid-template-columns:1fr}.performance-breakdown-terminal>header{align-items:flex-start;flex-direction:column}.performance-equity-panel svg{height:250px}
}
@media(max-width:479px){
  .performance-kpi-strip{grid-template-columns:1fr!important}.performance-kpi-strip .metric-card{border-right:0!important}.performance-filter-bar{grid-template-columns:1fr}.performance-filter-bar__result{grid-column:auto}.performance-breakdown-matrix{grid-template-columns:1fr}.performance-breakdown-matrix>div{border-right:0;border-top:1px solid var(--line)}.performance-breakdown-matrix>div:first-child{border-top:0}.performance-equity-panel>header{height:auto;align-items:flex-start;flex-direction:column}.performance-chart-legend{padding-bottom:4px}.performance-equity-panel svg{height:220px}
}

/* Historique & Gouvernance V3 — dense operational memory and semantic version control */
.history-v3,.history-session-v3,.strategy-governance-v3{--memory-accent:var(--info)}
.history-kpi-strip{grid-template-columns:repeat(6,minmax(0,1fr))!important}.history-kpi-strip .metric-card:nth-child(6){border-right:0!important}
.strategy-kpi-strip{grid-template-columns:repeat(6,minmax(0,1fr))!important}.strategy-kpi-strip .metric-card:nth-child(6){border-right:0!important}
.history-filter-bar{padding:6px!important;display:grid;grid-template-columns:minmax(150px,1.3fr) repeat(4,minmax(92px,.65fr)) repeat(2,minmax(118px,.72fr)) auto;align-items:end;gap:5px}.history-filter-bar label{min-width:0;display:grid;gap:2px}.history-filter-bar label>span{color:var(--text-tertiary);font:650 8px/1 var(--font-mono);letter-spacing:.05em;text-transform:uppercase}.history-filter-bar input,.history-filter-bar select{height:28px;min-height:28px;margin:0;padding:3px 6px;font:550 9px/1 var(--font-mono)}.history-filter-search>div{height:28px;padding:0 6px;display:flex;align-items:center;gap:4px;border:1px solid var(--line);background:var(--surface-0)}.history-filter-search>div:focus-within{border-color:var(--accent-border)}.history-filter-search>div input{min-width:0;padding:0;border:0;background:transparent}.history-filter-bar__result{height:28px;min-width:102px;padding:0 7px;display:flex;align-items:center;gap:4px;border:1px solid var(--line);background:var(--surface-0);white-space:nowrap}.history-filter-bar__result strong{font:650 13px/1 var(--font-mono)}.history-filter-bar__result span{color:var(--text-tertiary);font-size:8px}.history-filter-bar__result .text-btn{margin-left:auto}
.history-session-ledger>header,.history-timeline>header,.history-session-workflows>header{border-left-color:var(--memory-accent)}.history-session-table td{white-space:nowrap}.history-session-table td:first-child small{max-width:190px;overflow:hidden;text-overflow:ellipsis}.history-kind-stack{display:flex;gap:2px}.history-kind-stack span{padding:2px 4px;border:1px solid var(--line);background:var(--surface-0);color:var(--text-secondary);font:650 7px/1 var(--font-mono);text-transform:uppercase}.history-empty-state{min-height:170px}
.history-session-workbench{min-width:0;display:grid;grid-template-columns:minmax(0,8fr) minmax(285px,4fr);align-items:start;gap:7px}.history-session-workflows{min-width:0}.history-session-rail{min-width:0;display:grid;gap:6px}.history-session-rail>.card{padding:7px 9px!important;display:grid;gap:6px}.history-session-rail header{display:flex;align-items:flex-start;justify-content:space-between;gap:7px}.history-session-rail h2{margin:0;font-size:12px;line-height:16px}.history-event-inspector>p{margin:0;color:var(--text-secondary);font-size:9px;line-height:13px}.history-rail-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--line)}.history-rail-stats span{min-width:0;padding:6px;background:var(--surface-2);color:var(--text-tertiary);font-size:8px}.history-rail-stats strong{display:block;margin-top:2px;overflow:hidden;color:var(--text-primary);font:650 9px/1 var(--font-mono);text-overflow:ellipsis;white-space:nowrap}.history-incident-list{display:grid}.history-incident-list>div{min-height:34px;padding:4px 0;display:grid;grid-template-columns:6px minmax(0,1fr) auto;align-items:center;gap:6px;border-bottom:1px solid var(--line-soft)}.history-incident-list>div:last-child{border-bottom:0}.history-incident-list i{width:5px;height:20px;background:var(--info)}.history-incident-list i[data-severity="critical"]{background:var(--negative)}.history-incident-list i[data-severity="warning"]{background:var(--warning)}.history-incident-list strong,.history-incident-list small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-incident-list strong{font-size:9px}.history-incident-list small{color:var(--text-tertiary);font-size:8px}
.strategy-governance-grid{min-width:0;display:grid;grid-template-columns:minmax(0,8fr) minmax(260px,4fr);align-items:start;gap:7px}.strategy-version-ledger,.strategy-contract-ledger,.strategy-diff-panel{min-width:0;display:grid;gap:6px}.strategy-version-ledger>header,.strategy-contract-ledger>header,.strategy-diff-panel>header{display:flex;align-items:flex-start;justify-content:space-between;gap:7px}.strategy-governance-v3 .workspace-panel h2{margin:0}.strategy-version-ledger td{white-space:nowrap}.version-role-actions{display:flex;gap:3px}.version-role-actions button{height:22px;padding:0 6px;border:1px solid var(--line);background:var(--surface-0);color:var(--text-tertiary);font:650 8px/1 var(--font-mono);cursor:pointer}.version-role-actions button:hover,.version-role-actions button.active{border-color:var(--accent-border);background:var(--accent-soft);color:var(--accent)}.strategy-diff-toolbar{min-height:36px;padding:4px 6px;display:flex;align-items:end;gap:7px;border:1px solid var(--line);background:var(--surface-0)}.strategy-diff-toolbar label{min-width:150px;display:grid;gap:2px;color:var(--text-tertiary);font:650 7px/1 var(--font-mono);text-transform:uppercase}.strategy-diff-toolbar select{height:24px;min-height:24px;padding:2px 5px;font:550 9px/1 var(--font-mono)}.strategy-diff-toolbar>span{padding-bottom:7px;color:var(--accent)}.strategy-diff-summary{height:26px;display:flex;align-items:center;border:1px solid var(--line);background:var(--surface-0)}.strategy-diff-summary span{height:100%;padding:0 8px;display:flex;align-items:center;gap:5px;border-right:1px solid var(--line);color:var(--text-tertiary);font:650 7px/1 var(--font-mono)}.strategy-diff-summary strong{color:var(--text-primary);font-size:10px}.strategy-diff-table{table-layout:fixed}.strategy-diff-table th:first-child{width:25%}.strategy-diff-table th:nth-child(2),.strategy-diff-table th:nth-child(3){width:29%}.strategy-diff-table th:last-child{width:17%}.strategy-diff-table code{display:block;max-height:52px;overflow:auto;color:var(--text-secondary);font:8px/12px var(--font-mono);white-space:pre-wrap;word-break:break-word}.strategy-diff-table tr[data-change="added"] td:last-child span{color:var(--positive)}.strategy-diff-table tr[data-change="removed"] td:last-child span{color:var(--negative)}.strategy-diff-table tr[data-change="modified"] td:last-child span{color:var(--warning)}.strategy-diff-table td:last-child span{font:650 7px/1 var(--font-mono)}

@media(max-width:1279px){
  .history-kpi-strip{grid-template-columns:repeat(3,minmax(0,1fr))!important}.history-kpi-strip .metric-card:nth-child(3){border-right:0!important}.history-kpi-strip .metric-card:nth-child(n+4){border-top:1px solid var(--line)!important}
  .strategy-kpi-strip{grid-template-columns:repeat(3,minmax(0,1fr))!important}.strategy-kpi-strip .metric-card:nth-child(3){border-right:0!important}.strategy-kpi-strip .metric-card:nth-child(n+4){border-top:1px solid var(--line)!important}
  .history-filter-bar{grid-template-columns:repeat(4,minmax(0,1fr))}.history-filter-search{grid-column:span 2}.history-filter-bar__result{justify-content:flex-end}
}
@media(max-width:1023px){
  .history-session-workbench,.strategy-governance-grid{grid-template-columns:1fr}.history-session-rail{grid-template-columns:repeat(2,minmax(0,1fr))}.history-event-inspector{grid-column:1/-1}
}
@media(max-width:767px){
  .history-kpi-strip{grid-template-columns:repeat(2,minmax(0,1fr))!important}.history-kpi-strip .metric-card:nth-child(2n){border-right:0!important}.history-kpi-strip .metric-card:nth-child(3){border-right:1px solid var(--line)!important}.history-kpi-strip .metric-card:nth-child(n+3){border-top:1px solid var(--line)!important}
  .strategy-kpi-strip{grid-template-columns:repeat(2,minmax(0,1fr))!important}.strategy-kpi-strip .metric-card:nth-child(2n){border-right:0!important}.strategy-kpi-strip .metric-card:nth-child(3){border-right:1px solid var(--line)!important}.strategy-kpi-strip .metric-card:nth-child(n+3){border-top:1px solid var(--line)!important}
  .history-filter-bar{grid-template-columns:1fr 1fr}.history-filter-search,.history-filter-bar__result{grid-column:1/-1}.history-filter-bar__result{justify-content:flex-start}.history-filter-bar__result .text-btn{margin-left:auto}.history-session-rail{grid-template-columns:1fr}.history-event-inspector{grid-column:auto}.strategy-diff-toolbar{align-items:stretch;flex-direction:column}.strategy-diff-toolbar label{min-width:0}.strategy-diff-toolbar>span{display:none}
}
@media(max-width:479px){
  .history-kpi-strip{grid-template-columns:1fr!important}.history-kpi-strip .metric-card{border-right:0!important}.history-filter-bar{grid-template-columns:1fr}.history-filter-search,.history-filter-bar__result{grid-column:auto}.history-rail-stats{grid-template-columns:1fr}.strategy-diff-summary{height:auto;display:grid;grid-template-columns:repeat(3,1fr)}.strategy-diff-summary span{min-height:27px;padding-inline:5px}
  .strategy-kpi-strip{grid-template-columns:1fr!important}.strategy-kpi-strip .metric-card{border-right:0!important}
}
````

### `src/types.ts`

````tsx
export type SessionId = "asia_open" | "ny_open";
export type Severity = "info" | "watch" | "warning" | "action" | "critical" | "positive";
export type Trend = "up" | "down" | "flat";

export interface MarketItem {
  symbol: string;
  price: string;
  change: string;
  trend: Trend;
  note: string;
  ohlc?: { open: string; high: string; low: string; close: string };
  marketDate?: string;
  asOf?: string;
  source?: string;
  rsi?: string;
  atr?: string;
  seriesTimeframe?: string;
  series?: Array<{
    time: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number;
  }>;
}

export interface ConditionItem {
  label: string;
  status: "validated" | "failed" | "triggered" | "not_triggered" | "previously_validated" | string;
  proof: string;
  impact: string;
  deterministic: boolean;
}

export interface MonitorItem {
  id: string;
  time: string;
  sequence: number;
  decision: string;
  severity: Severity;
  statusBefore: string;
  statusAfter: string;
  healthBefore: number;
  healthAfter: number;
  summary: string;
  detailedReason: string;
  nextAction: string;
  nextFocus: string;
  expectedVsRealized: Array<{
    element: string;
    expected: string;
    realized: string;
    verdict: "confirm" | "invalidate" | "partial" | string;
    impact: string;
  }>;
  weakSignals: string[];
  goConditions: ConditionItem[];
  invalidationConditions: ConditionItem[];
}

export interface TimelineEvent {
  time: string;
  type: string;
  title: string;
  status: string;
  detail: string;
  severity: Severity;
  summary: string;
  sourceType: string;
}

export interface DeskSession {
  id: SessionId;
  strategyId: string;
  label: string;
  shortLabel: string;
  date: string;
  mode: string;
  status: string;
  severity: Severity;
  lastDataAt: string;
  lastMonitorAt: string;
  nextMonitorAt: string;
  nextMacro: string;
  dataQuality: {
    label: string;
    status: "ready" | "degraded" | string;
    antiLookahead: boolean;
    warnings: string[];
  };
  automation: { status: string; worker: string; cadence: string };
  liveBrief: {
    eyebrow: string; headline: string; action: string; summary: string;
    why: string; nextAction: string; decision: string;
  };
  thesis: {
    id: string; instrument: string; direction: string; status: string; previousStatus: string;
    dominantScenario: string; secondaryScenario: string; confidence: number; initialConfidence: number;
    health: number; initialHealth: number; validUntil: string; nextFocus: string;
    scoreDriversPositive: string[]; scoreDriversNegative: string[];
  };
  marketBrief: { headline: string; text: string; verdict: string };
  market: MarketItem[];
  crossAssetBrief: { headline: string; text: string; verdict: string };
  latestChange: {
    title: string;
    items: Array<{ tone: string; text: string }>;
    consequence: string;
  };
  master: {
    id: string; createdAt: string; decision: string; instrument: string; direction: string;
    confidence: number; summary: string; regime: string; macroThesis: string; assetSelection: string;
    expectedPath: string[]; failurePath: string[]; monitoringPlaybook: string[];
    sections: Array<{ title: string; content: string }>;
  };
  setup: {
    id: string; label: string; instrument: string; direction: string; status: string; statusLabel: string;
    entryFrom: number | null; entryTo: number | null; stop: number | null;
    tp1: number | null; tp2: number | null; tp3: number | null;
    risk: number | null; confidence: number | null; rr: number | null; resultR?: number | null; reason: string;
  };
  position: {
    active: boolean; status: string; instrument: string; direction: string;
    entry: number | null; current: number | null; unrealizedR: number | null; note: string;
  };
  monitors: MonitorItem[];
  timeline: TimelineEvent[];
  activity: Array<{ time: string; title: string; detail: string; status: string }>;
  levels: Array<{ price: string; role: string; state: string }>;
  macro: Array<{
    time: string; title: string; importance: string; impactText: string;
    scheduledAt?: string; date?: string; currency?: string;
    previous?: string; forecast?: string; actual?: string; isNext?: boolean;
  }>;
  news: {
    digestUpdatedAt: string;
    digest: string;
    headlines: Array<{
      time: string; title: string; source: string; impact: string;
      scheduledAt?: string; date?: string; currency?: string; importance?: string;
      previous?: string; forecast?: string; actual?: string; isNext?: boolean;
    }>;
  };
  alerts: Array<{ level: Severity; title: string; message: string; time: string }>;
  audit: {
    contracts: Array<{ name: string; version: string; status: string }>;
    checks: Array<{ label: string; status: string }>;
    apiMap: Array<{ view: string; endpoint: string }>;
  };
}

export interface FrontResourceMeta {
  contract: string;
  schemaVersion: "1.0.0";
  scope: {
    strategyId: string;
    session: SessionId;
    tradingDate: string;
    mode: "live" | "paper";
  };
  warnings: string[];
}

export interface DeskMarketResource extends FrontResourceMeta {
  lastDataAt: DeskSession["lastDataAt"];
  market: DeskSession["market"];
  marketBrief: DeskSession["marketBrief"];
  crossAssetBrief: DeskSession["crossAssetBrief"];
  levels: DeskSession["levels"];
}

export interface DeskPositionResource extends FrontResourceMeta {
  position: DeskSession["position"];
}

export interface DeskMacroResource extends FrontResourceMeta {
  nextMacro: DeskSession["nextMacro"];
  nearEvent: boolean;
  macro: DeskSession["macro"];
}

export interface DeskNewsDigestResource extends FrontResourceMeta {
  news: DeskSession["news"];
}

export interface DeskNewsHeadlinesResource extends FrontResourceMeta {
  headlines: DeskSession["news"]["headlines"];
}

export interface DeskActivityResource extends FrontResourceMeta {
  automation: DeskSession["automation"];
  activity: DeskSession["activity"];
}

export interface DeskAlertsResource extends FrontResourceMeta {
  alerts: DeskSession["alerts"];
}

export interface DeskAuditResource extends FrontResourceMeta {
  dataQuality: DeskSession["dataQuality"];
  audit: DeskSession["audit"];
}

export type PerformancePricingMode = "conservative" | "middle" | "optimistic";

export interface PerformanceSummary {
  closed_trades?: number;
  wins?: number;
  losses?: number;
  win_rate?: number | null;
  total_R?: number;
  expectancy_R?: number;
  max_drawdown_R?: number;
}

export interface PerformanceCalendarDay {
  date: string;
  status: string;
  total_R: number;
  closed_trades: number;
  setup_count: number;
  has_master: boolean;
  has_trade: boolean;
  has_open_position: boolean;
  pack_status: string | null;
  master_decision: string | null;
  setup_status: string | null;
}

export interface PerformanceCalendar {
  strategy_id: string;
  pricing_mode: PerformancePricingMode;
  year: number;
  month: number;
  from_date: string;
  to_date: string;
  summary?: PerformanceSummary;
  days: PerformanceCalendarDay[];
}

export interface PerformanceDay {
  strategy_id: string;
  pricing_mode: PerformancePricingMode;
  date: string;
  master: Record<string, unknown> | null;
  thesis: Record<string, unknown> | null;
  setups: Array<Record<string, unknown>>;
  monitors: Array<Record<string, unknown>>;
  trades: Array<Record<string, unknown>>;
  performance: { summary?: PerformanceSummary; [key: string]: unknown };
  timeline: Array<Record<string, unknown>>;
}

export interface DeskPerformanceCalendarResource extends FrontResourceMeta {
  calendar: PerformanceCalendar;
}

export interface DeskPerformanceDayResource extends FrontResourceMeta {
  day: PerformanceDay;
}

export interface DeskDetailScope {
  session: SessionId;
  strategyId: string;
  date: string;
}

export interface DeskTimelineResource extends FrontResourceMeta {
  timeline: DeskSession["timeline"];
}

export interface DeskMasterResource extends FrontResourceMeta {
  master: DeskSession["master"];
}

export interface DeskMonitorResource extends FrontResourceMeta {
  monitor: MonitorItem;
}

export interface DeskThesisResource extends FrontResourceMeta {
  thesis: DeskSession["thesis"];
  levels: DeskSession["levels"];
}

export interface DeskThesisConditionsResource extends FrontResourceMeta {
  thesisId: string;
  monitorId: string | null;
  go: ConditionItem[];
  invalidations: ConditionItem[];
}

export interface DeskSetupResource extends FrontResourceMeta {
  setup: DeskSession["setup"];
  position: DeskSession["position"];
  levels: DeskSession["levels"];
}

export type DeskOperatorCommandType =
  | "cancel_setup"
  | "confirm_trigger"
  | "move_break_even"
  | "take_partial"
  | "exit_position"
  | "request_replan";

export interface DeskOperatorScope {
  session: SessionId;
  strategyId: string;
  tradingDate: string;
  mode: "live" | "paper";
}

export interface DeskOperatorCapability {
  command: DeskOperatorCommandType;
  enabled: boolean;
  reason: string | null;
  targetId: string | null;
  confirmationPhrase: string;
  dangerLevel: "medium" | "high" | "critical";
}

export interface DeskOperatorState {
  contract: "DeskFrontOperatorState";
  schemaVersion: "1.0.0";
  scope: DeskOperatorScope;
  revision: number;
  setup: { id: string; status: string } | null;
  position: { id: string; status: string; entry: number | null } | null;
  thesis: { id: string; status: string } | null;
  allowedCommands: DeskOperatorCapability[];
  brokerExecution: false;
}

export interface DeskOperatorCommandInput extends DeskOperatorScope {
  command: DeskOperatorCommandType;
  expectedRevision: number;
  idempotencyKey: string;
  confirmationPhrase: string;
  targetId?: string;
  reason: string;
  partialFraction?: number;
}

export interface DeskOperatorCommandResult {
  contract: "DeskFrontOperatorCommandResult";
  schemaVersion: "1.0.0";
  ok: true;
  idempotent: boolean;
  command: {
    id: string;
    type: DeskOperatorCommandType;
    status: "APPLIED";
    revision: number;
    auditId: string;
    brokerExecution: false;
  };
  operatorState: DeskOperatorState;
  session: DeskSession;
}

export interface DeskApi {
  getSession(id: SessionId): Promise<DeskSession>;
  getMarketSnapshot(id: SessionId): Promise<DeskMarketResource>;
  getPosition(id: SessionId): Promise<DeskPositionResource>;
  getMacroCalendar(id: SessionId): Promise<DeskMacroResource>;
  getNewsDigest(id: SessionId): Promise<DeskNewsDigestResource>;
  getNewsHeadlines(id: SessionId): Promise<DeskNewsHeadlinesResource>;
  getDeskActivity(id: SessionId): Promise<DeskActivityResource>;
  getAlerts(id: SessionId): Promise<DeskAlertsResource>;
  getAudit(id: SessionId): Promise<DeskAuditResource>;
  getPerformanceCalendar(id: SessionId, year: number, month: number, pricingMode: PerformancePricingMode): Promise<DeskPerformanceCalendarResource>;
  getPerformanceDay(id: SessionId, date: string, pricingMode: PerformancePricingMode): Promise<DeskPerformanceDayResource>;
  getTimeline(scope: DeskDetailScope): Promise<DeskTimelineResource>;
  getMaster(masterId: string, scope: DeskDetailScope): Promise<DeskMasterResource>;
  getMonitor(monitorId: string, scope: DeskDetailScope): Promise<DeskMonitorResource>;
  getThesis(thesisId: string, scope: DeskDetailScope): Promise<DeskThesisResource>;
  getThesisConditions(thesisId: string, scope: DeskDetailScope): Promise<DeskThesisConditionsResource>;
  getSetup(setupId: string, scope: DeskDetailScope): Promise<DeskSetupResource>;
  getOperatorState(scope: DeskOperatorScope): Promise<DeskOperatorState>;
  executeOperatorCommand(input: DeskOperatorCommandInput): Promise<DeskOperatorCommandResult>;
}
````

### `tsconfig.app.json`

````json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vitest/globals"],
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
````

### `tsconfig.json`

````json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
````

### `tsconfig.node.json`

````json
{
  "compilerOptions": {
    "composite": true,
    "noEmit": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": [
    "vite.config.ts",
    "vitest.config.ts",
    "playwright.config.ts"
  ]
}
````

### `vite.config.ts`

````tsx
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { sourcemap: true, target: "es2020" }
});
````
