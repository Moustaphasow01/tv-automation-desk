# Passation Claude — redesign complet du frontend Desk Futures

> Snapshot fonctionnel du frontend de préproduction. Ce fichier est volontairement autonome : contexte produit, inventaire des écrans, contraintes, architecture et code/CSS actuels.

## Documents complémentaires

- `docs/CLAUDE_FRONT_REDESIGN_MANIFEST.md` définit la séparation des rôles : Claude décide du design, Codex l'implémente ensuite.
- `docs/CLAUDE_FRONT_REDESIGN_PROMPT.md` contient le prompt prêt à copier dans Claude.

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
- Les écritures utilisent Firebase Auth si disponible ou la clé API locale de préproduction.
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
  <meta name="theme-color" content="#080b10" />
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
    "test:stack": "bash scripts/test_real_stack.sh",
    "test:front": "npm run test:react && npm run test:e2e",
    "handoff:claude": "node scripts/build_claude_front_handoff.mjs"
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
  const query = new URLSearchParams({ session: id, strategy_id: "ny_open_1530" });
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
  DeskHistory, GptProcessDetail, GptProcessList, IncidentList, OperationsCommandInput, OperationsSummary,
  PerformanceOverview, ReplayDayDetail, ReplayList, ReplayRunDetail, ReplaySessionDetail, StrategyList,
  WorkflowDetail, WorkflowList
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
  getPerformance: (filters: Record<string, string | null | undefined> = {}) => request<PerformanceOverview>(`/performance/overview${query(filters)}`),
  compareReplays: (ids: string[]) => request<Record<string, unknown>>(`/replays/compare${query({ ids: ids.join(",") })}`),
  listIncidents: () => request<IncidentList>("/incidents"),
  executeIncidentAction: (id: string, input: OperationsCommandInput) => post(`/incidents/${part(id)}/actions`, input),
  getHistory: () => request<DeskHistory>("/history/sessions"),
  listStrategies: () => request<StrategyList>("/strategies"),
  compareStrategyVersions: (id: string, left: string, right: string) => request<Record<string, unknown>>(`/strategies/${part(id)}/versions/compare${query({ left, right })}`),
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
      <Route path="/operations/incidents" element={<IncidentsPage/>}/>
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
import { useEffect, type ReactNode, type SVGProps } from "react";

export type IconName =
  | "menu" | "bell" | "live" | "master" | "monitor" | "timeline" | "audit"
  | "news" | "arrow" | "refresh" | "info" | "alert" | "brain" | "globe"
  | "change" | "check" | "x" | "minus" | "chevron" | "trendUp"
  | "trendDown" | "clock" | "layers" | "database" | "target" | "chart"
  | "close" | "position" | "settings" | "calendar";

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
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></>
};

export function Icon({ name, size = 20, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}

export function BrandMark({ large = false }: { large?: boolean }) {
  return <span className={`brand-mark ${large ? "brand-mark--large" : ""}`}><span/><span/><span/></span>;
}

export function HealthOrb({ score, label = "Santé" }: { score: number; label?: string }) {
  const color = score < 40 ? "var(--negative)" : score < 70 ? "var(--warning)" : "var(--positive)";
  return <div className="health-orb" style={{ "--score": score, "--orb-color": color } as React.CSSProperties}>
    <div style={{ position: "relative", textAlign: "center" }}><div className="health-orb__value">{score}</div><div className="health-orb__label">{label}</div></div>
  </div>;
}

export function StatusBadge({ children, tone = "info" }: { children: ReactNode; tone?: "critical" | "warning" | "positive" | "info" | "muted" }) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}

export function Card({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return <article className={`card ${onClick ? "card--clickable" : ""} ${className}`} onClick={onClick}>{children}</article>;
}

export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <header className="section-title"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>;
}

export function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.body.classList.add("overlay-open");
    window.addEventListener("keydown", fn);
    return () => { document.body.classList.remove("overlay-open"); window.removeEventListener("keydown", fn); };
  }, [open, onClose]);
  return <>
    <button className={`scrim ${open ? "open" : ""}`} onClick={onClose} aria-label="Fermer"/>
    <section className={`drawer ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="drawer__grab"/>
      <header className="drawer__header"><div><p className="eyebrow">Détail</p><h2>{title}</h2></div><button className="icon-btn" onClick={onClose}><Icon name="close"/></button></header>
      <div className="drawer__content">{children}</div>
    </section>
  </>;
}

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return <>
    <button className={`scrim ${open ? "open" : ""}`} onClick={onClose} aria-label="Fermer"/>
    <section className={`modal ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="modal__card">
        <button className="icon-btn modal__close" onClick={onClose}><Icon name="close"/></button>
        <div className="modal__icon"><Icon name="alert"/></div>
        <h2>{title}</h2>{children}
      </div>
    </section>
  </>;
}

export function LoadingView() {
  return <section className="view loading-view"><div className="skeleton loading-hero"/><div className="skeleton loading-row"/><div className="skeleton loading-row"/></section>;
}

export function ErrorView({ message, retry }: { message: string; retry: () => void }) {
  return <section className="view"><div className="card empty-state"><div className="empty-state__icon"><Icon name="alert"/></div><h3>Impossible de charger le Desk</h3><p>{message}</p><button className="primary-btn" onClick={retry}>Réessayer</button></div></section>;
}
````

### `src/components/deskCards.tsx`

````tsx
import { useNavigate } from "react-router-dom";
import { Card, HealthOrb, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { useOverlay } from "@/context/OverlayContext";
import type { DeskSession, MarketItem } from "@/types";

const fmt = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
const severityTone = (value: string): "critical" | "warning" | "positive" | "info" =>
  value === "critical" ? "critical" : value === "warning" ? "warning" : value === "positive" ? "positive" : "info";

function MarketIntradayChart({ item }: { item: MarketItem }) {
  const series = (item.series || []).filter(point => Number.isFinite(point.close));
  const timeframe = item.seriesTimeframe || "M1";
  if (series.length < 2) return <section className="drawer-section market-chart-card">
    <div className="market-chart-card__heading"><div><p className="eyebrow">Évolution intraday</p><h3>Courbe M1</h3></div><StatusBadge tone="muted">INDISPONIBLE</StatusBadge></div>
    <p className="market-chart-empty">Aucune série de bougies M1 n’est disponible pour {item.symbol}.</p>
  </section>;

  const width = 720;
  const height = 230;
  const padX = 12;
  const padTop = 14;
  const padBottom = 26;
  const closes = series.map(point => point.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = Math.max(max - min, Math.abs(max) * 0.0001, 1e-9);
  const chartHeight = height - padTop - padBottom;
  const coords = series.map((point, index) => ({
    x: padX + index * (width - padX * 2) / Math.max(series.length - 1, 1),
    y: padTop + (max - point.close) / range * chartHeight,
  }));
  const polyline = coords.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${padX},${height - padBottom} ${polyline} ${width - padX},${height - padBottom}`;
  const firstTime = new Date(series[0].time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const lastTime = new Date(series.at(-1)!.time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const formatPrice = (value: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);

  return <section className={`drawer-section market-chart-card market-chart-card--${item.trend}`}>
    <div className="market-chart-card__heading">
      <div><p className="eyebrow">Évolution intraday</p><h3>Courbe {timeframe}</h3></div>
      <StatusBadge tone={timeframe === "M1" ? "positive" : "warning"}>{timeframe === "M1" ? "TEMPS RÉEL" : "M1 INDISPONIBLE"}</StatusBadge>
    </div>
    <div className="market-chart-card__stats">
      <span>Bas <strong>{formatPrice(min)}</strong></span><span>Haut <strong>{formatPrice(max)}</strong></span><span>Dernier <strong>{formatPrice(series.at(-1)!.close)}</strong></span>
    </div>
    <div className="market-chart-card__plot">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Courbe ${timeframe} de ${item.symbol}`}>
        <line x1={padX} y1={padTop} x2={width - padX} y2={padTop} className="market-chart-grid"/>
        <line x1={padX} y1={padTop + chartHeight / 2} x2={width - padX} y2={padTop + chartHeight / 2} className="market-chart-grid"/>
        <line x1={padX} y1={height - padBottom} x2={width - padX} y2={height - padBottom} className="market-chart-grid"/>
        <polygon points={area} className="market-chart-area"/>
        <polyline points={polyline} className="market-chart-line"/>
        <circle cx={coords.at(-1)!.x} cy={coords.at(-1)!.y} r="5" className="market-chart-last"/>
      </svg>
      <div className="market-chart-card__axis"><span>{firstTime}</span><span>{series.length} bougies</span><span>{lastTime}</span></div>
    </div>
  </section>;
}

export function StatusRibbon({ data }: { data: DeskSession }) {
  const quality = data.dataQuality.status === "ready" ? "ready" : "warning";
  return <div className="status-ribbon">
    <span className="status-chip"><i className={`status-dot status-dot--${data.severity}`}/><strong>{data.status}</strong></span>
    <span className="status-chip">Données <strong>{data.lastDataAt}</strong></span>
    <span className="status-chip"><i className={`status-dot status-dot--${quality}`}/>{data.dataQuality.label}</span>
    <span className="status-chip">Monitor <strong>{data.lastMonitorAt}</strong></span>
    <span className="status-chip">Prochain <strong>{data.nextMonitorAt}</strong></span>
  </div>;
}

export function HeroCard({ data }: { data: DeskSession }) {
  const overlay = useOverlay();
  return <Card className="hero-card">
    <div data-severity={data.severity}>
      <div className="hero-card__top">
        <div>
          <p className="eyebrow">{data.liveBrief.eyebrow}</p>
          <h1>{data.liveBrief.headline}</h1>
          <div className="hero-card__decision"><i className={`status-dot status-dot--${data.severity}`}/>{data.liveBrief.decision}</div>
        </div>
        <HealthOrb score={data.thesis.health}/>
      </div>
      <p className="hero-card__summary">{data.liveBrief.summary}</p>
      <div className="hero-card__footer">
        <span className="action-pill">{data.liveBrief.action}</span>
        <button className="text-btn" onClick={() => overlay.openDrawer("Pourquoi cette décision ?", <div>
          <section className="drawer-section"><h3>Raisonnement</h3><p>{data.liveBrief.why}</p></section>
          <section className="drawer-section"><h3>Action immédiate</h3><p>{data.liveBrief.nextAction}</p></section>
          <section className="drawer-section"><div className="detail-pairs"><div><span>Décision</span><strong>{data.liveBrief.decision}</strong></div><div><span>Thèse</span><strong>{data.thesis.status}</strong></div><div><span>Confiance</span><strong>{data.thesis.confidence} %</strong></div></div></section>
        </div>)}>Pourquoi ? <Icon name="arrow" size={15}/></button>
      </div>
    </div>
  </Card>;
}

export function MarketStrip({ data }: { data: DeskSession }) {
  const overlay = useOverlay();
  const futures = data.market.filter(item => ["MNQ", "MES", "MCL"].includes(item.symbol));
  const megaCaps = data.market.filter(item => ["NVDA", "AAPL", "MSFT", "TSLA", "SMH", "SOXX"].includes(item.symbol));
  const groupedItems = new Set([...futures, ...megaCaps]);
  const other = data.market.filter(item => !groupedItems.has(item));
  const groups = [
    { key: "futures", label: "Futures", items: futures },
    { key: "mega-caps", label: "Mega caps & semis", items: megaCaps },
    { key: "cross-asset", label: "Cross-asset", items: other },
  ].filter(group => group.items.length);
  return <div className="market-overview">
    {groups.map(group => <section className={`market-group market-group--${group.key}`} key={group.key}>
      <div className="market-group__heading"><h3>{group.label}</h3><span>OHLC journalier</span></div>
      <div className="market-strip">
        {group.items.map(item => {
          const ohlc = item.ohlc || { open: "—", high: "—", low: "—", close: item.price };
          return <button key={item.symbol} className={"market-card market-card--" + item.trend + " card--clickable"} onClick={() => overlay.openDrawer(item.symbol + " · prix & évolution", <div>
            <section className="drawer-section"><div className="drawer-market-price">{item.price}</div><div className={"drawer-market-change " + item.trend}>{item.change}</div><p>{item.note}</p></section>
            <MarketIntradayChart item={item}/>
            <section className="drawer-section"><h3>OHLC du jour</h3><div className="detail-pairs detail-pairs--four"><div><span>Open</span><strong>{ohlc.open}</strong></div><div><span>High</span><strong>{ohlc.high}</strong></div><div><span>Low</span><strong>{ohlc.low}</strong></div><div><span>Close</span><strong>{ohlc.close}</strong></div></div></section>
            <section className="drawer-section"><h3>Indicateurs & source</h3><div className="detail-pairs"><div><span>RSI 14</span><strong>{item.rsi || "—"}</strong></div><div><span>ATR 14</span><strong>{item.atr || "—"}</strong></div><div><span>Source</span><strong>{item.source || "backend"}</strong></div><div><span>Date marché</span><strong>{item.marketDate || "—"}</strong></div></div></section>
          </div>)}>
            <div className="market-card__top">
              <span className="market-card__symbol">{item.symbol}</span>
              <span className={"trend-mark trend-mark--" + item.trend}><Icon name={item.trend === "up" ? "trendUp" : item.trend === "down" ? "trendDown" : "minus"}/></span>
            </div>
            <div className="market-card__quote">
              <strong className="market-card__price">{item.price}</strong>
              <span className={"market-card__change " + item.trend}>{item.change}</span>
            </div>
            <div className="market-card__ohlc" aria-label={`OHLC ${item.symbol}`}>
              <span><small>Open</small><strong>{ohlc.open}</strong></span>
              <span><small>High</small><strong>{ohlc.high}</strong></span>
              <span><small>Low</small><strong>{ohlc.low}</strong></span>
              <span><small>Close</small><strong>{ohlc.close}</strong></span>
            </div>
            <div className="market-card__footer">
              <div className="market-card__indicators"><span><small>RSI</small><strong>{item.rsi || "—"}</strong></span><span><small>ATR</small><strong>{item.atr || "—"}</strong></span></div>
              <time className="market-card__note">{item.note}</time>
            </div>
          </button>;
        })}
      </div>
    </section>)}
  </div>;
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
    <div className="delta-list">{data.latestChange.items.map((item, i) => <div className="delta-item" data-tone={item.tone} key={i}><span className="delta-item__dot"/><span>{item.text}</span></div>)}</div>
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
    <div className="setup-card__header"><div><p className="eyebrow">Setup</p><h3>{s.label}</h3></div><StatusBadge tone={s.status === "ACTIVE" ? "positive" : "critical"}>{s.status}</StatusBadge></div>
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
    <div className="brief-card__header"><div><p className="eyebrow">Position canonique</p><h3>{p.active ? `${p.instrument} ${p.direction}` : p.status === "CLOSED" ? "Trade historique clôturé" : "Aucune position live"}</h3></div><StatusBadge tone={p.active ? "positive" : "info"}>{p.status}</StatusBadge></div>
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
    <div className="activity-list">{data.activity.map((item, i) => <div className="activity-item" data-state={item.status === "queued" ? "scheduled" : item.status} key={i}><span className="activity-time">{item.time}</span><span className="activity-line"><span className="activity-dot"/></span><div><div className="activity-label">{item.title}</div><div className="activity-detail">{item.detail}</div></div></div>)}</div>
  </Card>;
}

export function ExpectedRealized({ monitor, compact = false }: { monitor: DeskSession["monitors"][number]; compact?: boolean }) {
  return <div className={`comparison-react ${compact ? "compact" : ""}`}>
    {monitor.expectedVsRealized.map((row, i) => <div className="comparison-react__row" key={i}>
      <div className="comparison-react__head"><strong>{row.element}</strong><StatusBadge tone={row.verdict === "invalidate" ? "critical" : row.verdict === "confirm" ? "positive" : "info"}>{row.verdict}</StatusBadge></div>
      <div className="comparison-react__cols"><div><span>Attendu</span><p>{row.expected}</p></div><div><span>Réalisé</span><p>{row.realized}</p></div></div>
      {!compact && <small>{row.impact}</small>}
    </div>)}
  </div>;
}

export function Conditions({ title, items }: { title: string; items: DeskSession["monitors"][number]["goConditions"] }) {
  return <Card className="conditions-react"><h3>{title}</h3><div>{items.length ? items.map((item, i) => <div className="condition-react" key={i}>
    <span className={`condition-react__icon ${item.status}`}><Icon name={item.status === "failed" || item.status === "triggered" ? "x" : item.status === "validated" || item.status === "previously_validated" ? "check" : "minus"} size={15}/></span>
    <div><div className="condition-react__head"><strong>{item.label}</strong><StatusBadge tone={item.status === "failed" || item.status === "triggered" ? "critical" : "positive"}>{item.status}</StatusBadge></div><p>{item.proof}</p><small>{item.impact} · {item.deterministic ? "déterministe" : "interprétation"}</small></div>
  </div>) : <p className="empty-copy">Aucune condition disponible.</p>}</div></Card>;
}

export function Timeline({ data, compact = false, onSelect }: { data: DeskSession; compact?: boolean; onSelect?: (event: DeskSession["timeline"][number]) => void }) {
  const items = compact ? data.timeline.slice(-4) : data.timeline;
  return <div className="timeline">{items.map((event, i) => <div className="timeline-item" data-type={event.type.toLowerCase()} data-status={severityTone(event.severity)} key={i}>
    <time className="timeline-item__time">{event.time}</time>
    <button className="timeline-item__content" onClick={() => onSelect?.(event)}>
      <div className="timeline-item__header"><strong>{event.title}</strong><StatusBadge tone={severityTone(event.severity)}>{event.status}</StatusBadge></div>
      <p>{event.summary}</p>{!compact && <small>{event.type} · {event.sourceType}</small>}
    </button>
  </div>)}</div>;
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
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { BrandMark, Icon, type IconName } from "@/components/common";
import { useDeskContext } from "@/context/DeskContext";
import { useDeskSession } from "@/hooks/useDesk";

const bottom: Array<{ to: string; label: string; icon: IconName }> = [
  { to: "/live", label: "Live", icon: "live" },
  { to: "/operations", label: "Ops", icon: "monitor" },
  { to: "/replay", label: "Replay", icon: "layers" },
  { to: "/performance/analysis", label: "Analyse", icon: "chart" },
  { to: "/more", label: "Plus", icon: "menu" }
];

const menu: Array<{ to: string; label: string; icon: IconName }> = [
  { to: "/live", label: "Live Desk", icon: "live" },
  { to: "/operations", label: "Cockpit opérations", icon: "monitor" },
  { to: "/replay", label: "Replay Lab", icon: "layers" },
  { to: "/performance/analysis", label: "Analyse performance", icon: "chart" },
  { to: "/history", label: "Historique", icon: "database" },
  { to: "/strategies", label: "Stratégies & versions", icon: "settings" },
  { to: "/sessions", label: "Sessions", icon: "layers" },
  { to: "/master", label: "Master", icon: "master" },
  { to: "/monitors", label: "Monitors", icon: "monitor" },
  { to: "/thesis", label: "Thèse active", icon: "brain" },
  { to: "/setup", label: "Setup & Position", icon: "position" },
  { to: "/news", label: "Macro & News", icon: "news" },
  { to: "/performance", label: "Calendrier R", icon: "calendar" },
  { to: "/timeline", label: "Journal", icon: "timeline" },
  { to: "/audit", label: "Audit", icon: "audit" }
];

export function AppShell() {
  const { sessionId, phase, phaseLabel, nextPhaseAt, menuOpen, setMenuOpen } = useDeskContext();
  const { data } = useDeskSession(sessionId);
  const navigate = useNavigate();

  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar__brand">
        <button className="icon-btn topbar__menu" onClick={() => setMenuOpen(true)} aria-label="Menu"><Icon name="menu"/></button>
        <button className="brand-button" onClick={() => navigate("/live")}>
          <BrandMark/>
          <span><span className="brand-name">Desk Futures</span><span className="brand-subtitle">{data ? `${data.label} · ${data.mode.toLowerCase()}` : "Cockpit"}</span></span>
        </button>
      </div>
      <div className="topbar__actions">
        <div className="automatic-session" title={"Prochaine phase à " + nextPhaseAt} aria-label={"Session automatique : " + phaseLabel}>
          <i className="status-dot status-dot--ready"/><span>{phaseLabel}</span><small>AUTO</small>
        </div>
        <button className="icon-btn notification-btn" onClick={() => navigate("/alerts")} aria-label="Alertes">
          <span className="notification-icon"><Icon name="bell"/></span>
          {!!data?.alerts?.length && <span className="notification-dot"/>}
        </button>
      </div>
    </header>

    <aside className={`side-menu ${menuOpen ? "open" : ""}`}>
      <header className="side-menu__header">
        <BrandMark large/>
        <span><strong>Desk Futures</strong><small>API connectée</small></span>
        <button className="icon-btn" onClick={() => setMenuOpen(false)}><Icon name="close"/></button>
      </header>
      <div className="side-menu__context">
        <p className="eyebrow">Phase automatique</p>
        <strong className="side-session-label">{phaseLabel}</strong>
        <span className="side-session-status"><i className={`status-dot status-dot--${data?.severity ?? "warning"}`}/>{data?.status ?? "…"}</span>
      </div>
      <div className="session-segment">
        <span className={phase === "asia" ? "active" : ""}>ASIA</span>
        <span className={phase === "london" ? "active" : ""}>LONDON</span>
        <span className={phase === "ny" ? "active" : ""}>NY</span>
      </div>
      <p className="session-auto-note">Sélection selon l’heure de Paris · prochaine phase {nextPhaseAt}</p>
      <nav className="side-menu__nav">
        {menu.map(item => <NavLink key={item.to} to={item.to} onClick={() => setMenuOpen(false)} className={({ isActive }) => isActive ? "active" : ""}>
          <span className="side-nav-icon"><Icon name={item.icon}/></span><span>{item.label}</span><Icon name="arrow" size={16}/>
        </NavLink>)}
      </nav>
    </aside>
    <button className={`scrim ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(false)} aria-label="Fermer le menu"/>

    <main className="app-main"><Outlet/></main>

    <nav className="bottom-nav">
      {bottom.map(item => <NavLink key={item.to} to={item.to} className={({ isActive }) => `bottom-nav__item ${isActive ? "active" : ""}`}>
        <span className="nav-icon"><Icon name={item.icon}/></span><span>{item.label}</span>
      </NavLink>)}
    </nav>
  </div>;
}
````

### `src/components/operations.tsx`

````tsx
import { useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Card, Icon, StatusBadge } from "@/components/common";
import type { OperationsEvent, PricePoint, WorkflowStatus, WorkflowSummary } from "@/operationsTypes";

export function WorkspaceNav() {
  const items = [
    ["/operations", "Opérations"], ["/replay", "Replay Lab"], ["/performance/analysis", "Performance"],
    ["/history", "Historique"], ["/strategies", "Stratégies"]
  ];
  return <nav className="workspace-nav" aria-label="Espaces métier">
    {items.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => isActive ? "active" : ""}>{label}</NavLink>)}
  </nav>;
}

export function Breadcrumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return <nav className="breadcrumbs" aria-label="Fil d’Ariane">
    {items.map((item, index) => <span key={`${item.label}-${index}`}>
      {index > 0 && <Icon name="arrow" size={13}/>} {item.to ? <Link to={item.to}>{item.label}</Link> : <strong>{item.label}</strong>}
    </span>)}
  </nav>;
}

export function PageHeading({ eyebrow, title, subtitle, backTo, actions }: { eyebrow?: string; title: string; subtitle?: string; backTo?: string; actions?: ReactNode }) {
  const navigate = useNavigate();
  return <header className="workspace-heading">
    <div className="workspace-heading__main">
      {backTo && <button className="back-btn" onClick={() => navigate(backTo)} aria-label="Retour"><Icon name="arrow" size={18}/></button>}
      <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
    </div>
    {actions && <div className="workspace-heading__actions">{actions}</div>}
  </header>;
}

export function StatusTag({ status }: { status: WorkflowStatus | string }) {
  const tone = status === "failed" ? "critical" : status === "blocked" || status === "waiting_gpt" || status === "paused" ? "warning" : status === "completed" ? "positive" : status === "running" ? "info" : "muted";
  return <StatusBadge tone={tone}>{statusLabel(status)}</StatusBadge>;
}

export function ProgressBar({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return <div className="progress-line" title={`${safe}%`}><i style={{ width: `${safe}%` }}/><span>{safe}%</span></div>;
}

export function MetricCard({ label, value, detail, tone = "neutral" }: { label: string; value: ReactNode; detail?: string; tone?: string }) {
  return <Card className={`metric-card metric-card--${tone}`}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</Card>;
}

export function EmptyWorkspace({ title, text }: { title: string; text: string }) {
  return <Card className="workspace-empty"><Icon name="database"/><h3>{title}</h3><p>{text}</p></Card>;
}

export function WorkflowTable({ items, basePath = "/operations/workflows" }: { items: WorkflowSummary[]; basePath?: string }) {
  if (!items.length) return <EmptyWorkspace title="Aucune exécution" text="Les prochaines exécutions produites par le backend apparaîtront ici automatiquement."/>;
  return <div className="data-table-wrap"><table className="data-table">
    <thead><tr><th>Workflow</th><th>État</th><th>Session</th><th>Progression</th><th>Mise à jour</th><th/></tr></thead>
    <tbody>{items.map(item => <tr key={item.id}>
      <td><strong>{item.name}</strong><small>{item.sourceId}</small></td>
      <td><StatusTag status={item.status}/></td>
      <td>{item.tradingDate || "—"}<small>{item.session || item.kind}</small></td>
      <td><ProgressBar value={item.progress}/></td>
      <td>{formatDateTime(item.updatedAt)}</td>
      <td><Link className="row-link" to={`${basePath}/${encodeURIComponent(item.id)}`}><span>Ouvrir</span><Icon name="arrow" size={15}/></Link></td>
    </tr>)}</tbody>
  </table></div>;
}

export function EventTimeline({ events, runId, workflowId }: { events: OperationsEvent[]; runId?: string; workflowId?: string }) {
  if (!events.length) return <EmptyWorkspace title="Timeline vide" text="Les décisions, transitions et appels GPT seront horodatés ici."/>;
  return <ol className="event-timeline">{events.map(event => <li key={event.id} data-layer={event.layer || "event"}>
    <time>{formatDateTime(event.at)}</time><i/><div><div className="event-timeline__top"><strong>{event.title || event.type}</strong><StatusTag status={event.status}/></div>
      <p>{event.detail || event.conclusion || event.decision || "Transition enregistrée"}</p>
      {event.processId && runId && <Link to={`/replay/runs/${encodeURIComponent(runId)}/gpt/${encodeURIComponent(event.processId)}`}>Inspecter GPT <Icon name="arrow" size={13}/></Link>}
      {!event.processId && workflowId && <Link to={`/operations/workflows/${encodeURIComponent(workflowId)}/events/${encodeURIComponent(event.id)}`}>Ouvrir l’événement <Icon name="arrow" size={13}/></Link>}
    </div>
  </li>)}</ol>;
}

export function DecisionChart({ prices, events, runId }: { prices: PricePoint[]; events: OperationsEvent[]; runId: string }) {
  const [zoom, setZoom] = useState(1);
  const [layers, setLayers] = useState({ decision: true, step: true, gpt: true });
  const visible = useMemo(() => {
    const count = Math.max(20, Math.round(prices.length / zoom));
    return prices.slice(-count);
  }, [prices, zoom]);
  const chart = useMemo(() => chartModel(visible, events.filter(event => layers[event.layer as keyof typeof layers] !== false)), [visible, events, layers]);
  return <Card className="decision-chart">
    <header><div><p className="eyebrow">Timeline synchronisée</p><h2>Prix & décisions</h2></div><div className="chart-controls">
      <label>Zoom <input aria-label="Zoom timeline" type="range" min="1" max="8" step="1" value={zoom} onChange={event => setZoom(Number(event.target.value))}/></label>
      {Object.keys(layers).map(layer => <button key={layer} className={layers[layer as keyof typeof layers] ? "active" : ""} onClick={() => setLayers(value => ({ ...value, [layer]: !value[layer as keyof typeof layers] }))}>{layer}</button>)}
    </div></header>
    {!visible.length ? <div className="chart-empty">Aucune bougie n’est encore matérialisée pour ce replay. Les décisions restent visibles dans la timeline ci-dessous.</div> : <div className="chart-scroll"><svg viewBox="0 0 1000 340" role="img" aria-label="Évolution du prix et décisions du replay">
      <defs><linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#69f0b4" stopOpacity=".28"/><stop offset="1" stopColor="#69f0b4" stopOpacity="0"/></linearGradient></defs>
      {[0, 1, 2, 3, 4].map(index => <line key={index} x1="55" x2="980" y1={35 + index * 65} y2={35 + index * 65} className="chart-grid"/>)}
      <path d={`${chart.area} L ${chart.lastX} 305 L 55 305 Z`} fill="url(#priceFill)"/>
      <path d={chart.line} className="price-line"/>
      {chart.markers.map(marker => <g key={marker.event.id} className={`chart-marker chart-marker--${marker.event.layer}`}>
        <line x1={marker.x} x2={marker.x} y1="35" y2="305"/><circle cx={marker.x} cy={marker.y} r="7"/>
        <title>{`${marker.event.title}: ${marker.event.conclusion || marker.event.detail || marker.event.status}`}</title>
      </g>)}
      <text x="55" y="330">{formatTime(visible[0]?.time)}</text><text x="900" y="330">{formatTime(visible.at(-1)?.time)}</text>
      <text x="5" y="42">{chart.max.toFixed(2)}</text><text x="5" y="305">{chart.min.toFixed(2)}</text>
    </svg></div>}
    <div className="chart-event-strip">{events.slice(-12).map(event => <Link key={event.id} to={event.processId ? `/replay/runs/${encodeURIComponent(runId)}/gpt/${encodeURIComponent(event.processId)}` : "#timeline-events"}><i data-layer={event.layer}/><span>{formatTime(event.at)}</span><strong>{event.title}</strong></Link>)}</div>
  </Card>;
}

function chartModel(points: PricePoint[], events: OperationsEvent[]) {
  const closes = points.map(point => point.close).filter(Number.isFinite);
  const min = closes.length ? Math.min(...closes) : 0;
  const max = closes.length ? Math.max(...closes) : 1;
  const spread = Math.max(max - min, Math.abs(max || 1) * .001);
  const x = (index: number) => 55 + (index / Math.max(1, points.length - 1)) * 925;
  const y = (price: number) => 295 - ((price - min) / spread) * 250;
  const coords = points.map((point, index) => [x(index), y(point.close)] as const);
  const line = coords.map(([cx, cy], index) => `${index ? "L" : "M"} ${cx.toFixed(1)} ${cy.toFixed(1)}`).join(" ");
  const from = Date.parse(points[0]?.time || "");
  const to = Date.parse(points.at(-1)?.time || "");
  const markers = events.map(event => {
    const at = Date.parse(event.at || "");
    if (!Number.isFinite(at) || !Number.isFinite(from) || !Number.isFinite(to) || at < from || at > to) return null;
    const cx = 55 + ((at - from) / Math.max(1, to - from)) * 925;
    const nearest = points.reduce((best, point, index) => Math.abs(Date.parse(point.time) - at) < Math.abs(Date.parse(points[best]?.time || "") - at) ? index : best, 0);
    return { event, x: cx, y: y(points[nearest]?.close || min) };
  }).filter(Boolean) as Array<{ event: OperationsEvent; x: number; y: number }>;
  return { min, max, line, area: line, lastX: coords.at(-1)?.[0] || 55, markers };
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = { queued: "En attente", running: "En cours", waiting_gpt: "Attente GPT", blocked: "Bloqué", failed: "Échec", completed: "Terminé", cancelled: "Annulé", paused: "En pause", unknown: "Inconnu" };
  return labels[status] || status;
}

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" }).format(date);
}

export function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(11, 16) || value : new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(date);
}

export function formatDuration(value?: number | null) {
  if (value === null || value === undefined) return "—";
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
  performance: ["operations", "performance"] as const,
  incidents: ["operations", "incidents"] as const,
  history: ["operations", "history"] as const,
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

export function useReplays() {
  return useQuery({ queryKey: operationsKeys.replays, queryFn: () => operationsApi.listReplays(), refetchInterval: 20_000 });
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
import "@/styles/globals.css";

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

export interface ReplayList { contract: string; schemaVersion: string; count: number; days: ReplayDaySummary[]; items: WorkflowSummary[] }
export interface ReplayDayDetail {
  contract: string; schemaVersion: string; runId: string; date: string; status: WorkflowStatus;
  metrics: { totalR: number; progress: number; sessionCount: number };
  sessions: WorkflowSummary[]; variants: string[];
}

export interface PricePoint { time: string; open: number | null; high: number | null; low: number | null; close: number; volume?: number | null; source?: string }

export interface GptProcess {
  id: string; runId: string | null; stepId: string | null; workflow: string; status: WorkflowStatus; rawStatus: string;
  revision: number; attempt: number; maxAttempts: number; worker: string | null; leaseExpiresAt: string | null;
  createdAt: string | null; startedAt: string | null; completedAt: string | null; updatedAt: string | null;
  durationMs: number | null; events: OperationsEvent[]; conclusion: string | null; decision: string | null;
  error: WorkflowSummary["error"]; bundle: { bundleId: string; manifest: unknown; dataQuality: unknown } | null;
}

export interface GptProcessList { contract: string; schemaVersion: string; count: number; items: GptProcess[] }
export interface GptProcessDetail { contract: string; schemaVersion: string; process: GptProcess; manifest: unknown; prompt: string | null; saveTarget: unknown; error: unknown; raw: unknown }

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
  createdAt: string | null; updatedAt: string | null; snoozedUntil: string | null;
}

export interface IncidentList { contract: string; schemaVersion: string; count: number; items: Incident[] }
export interface PerformanceOverview { contract: string; schemaVersion: string; totals: Record<string, number | null>; stats: unknown[]; daily: Array<Record<string, unknown>>; replayDays: ReplayDaySummary[]; breakdowns: Array<{ dimension: string; items: Array<Record<string, unknown>> }> }
export interface DeskHistory { contract: string; schemaVersion: string; sessions: Array<{ id: string; tradingDate: string | null; session: string | null; status: WorkflowStatus; workflowCount: number; workflows: WorkflowSummary[] }>; incidents: Incident[]; audit: Array<Record<string, unknown>>; performance: PerformanceOverview }
export interface StrategyList { contract: string; schemaVersion: string; count: number; items: Array<{ id: string; catalog: Record<string, unknown> | null; config: Record<string, unknown> | null; runtime: Record<string, unknown> | null; versions: Array<Record<string, unknown>>; activeContracts: Array<{ name: string; version: string; status: string }> }> }

export interface OperationsCommandInput {
  action: "retry" | "resume" | "pause" | "cancel" | "acknowledge" | "snooze" | "resolve" | "reopen";
  expectedRevision: number;
  idempotencyKey: string;
  confirmationPhrase: string;
  reason: string;
  snoozedUntilUtc?: string;
}
````

### `src/pages/AlertsPage.tsx`

````tsx
import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { DeskPage } from "@/pages/pageState";

export default function AlertsPage() {
  return <DeskPage>{data => <section className="view">
    <SectionTitle title="Centre d’alertes" subtitle="Actions et événements nécessitant ton attention"/>
    <div className="alert-list-react">
      {data.alerts.map((alert, index) => <Card key={index} className={`alert-react alert-react--${alert.level}`}>
        <span className="alert-react__icon"><Icon name="alert"/></span><div><div className="alert-react__head"><h3>{alert.title}</h3><StatusBadge tone={alert.level === "critical" ? "critical" : "warning"}>{alert.time}</StatusBadge></div><p>{alert.message}</p></div>
      </Card>)}
    </div>
  </section>}</DeskPage>;
}
````

### `src/pages/AuditPage.tsx`

````tsx
import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { DeskPage } from "@/pages/pageState";

export default function AuditPage() {
  return <DeskPage>{data => <section className="view">
    <SectionTitle title="Audit" subtitle="Contrats, qualité, anti-lookahead et mapping API"/>
    <Card className="audit-summary-react">
      <div><span className={`audit-orb ${data.dataQuality.status}`}/><div><p className="eyebrow">Data readiness</p><h2>{data.dataQuality.label}</h2><p>Anti-lookahead : {data.dataQuality.antiLookahead ? "conforme" : "à vérifier"}</p></div></div>
      {data.dataQuality.warnings.length > 0 && <div className="audit-warnings-react">{data.dataQuality.warnings.map(w => <span key={w}><Icon name="alert" size={15}/>{w}</span>)}</div>}
    </Card>
    <div className="content-grid content-grid--start">
      <Card className="audit-detail-card"><h3>Contrats actifs</h3><div className="audit-list-react">{data.audit.contracts.map(item => <div key={item.name}><div><strong>{item.name}</strong><small>v{item.version}</small></div><StatusBadge tone="positive">{item.status}</StatusBadge></div>)}</div></Card>
      <Card className="audit-detail-card"><h3>Checks backend</h3><div className="audit-list-react">{data.audit.checks.map(item => <div key={item.label}><strong>{item.label}</strong><StatusBadge tone={item.status === "warning" ? "warning" : "positive"}>{item.status}</StatusBadge></div>)}</div></Card>
    </div>
    <Card className="audit-detail-card"><h3>Mapping front → backend</h3><div className="api-map-react">{data.audit.apiMap.map(item => <div key={item.view}><span>{item.view}</span><code>{item.endpoint}</code></div>)}</div></Card>
  </section>}</DeskPage>;
}
````

### `src/pages/GptProcessPage.tsx`

````tsx
import { useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, EventTimeline, formatDateTime, formatDuration, MetricCard, PageHeading, StatusTag, WorkspaceNav } from "@/components/operations";
import { useGptProcess } from "@/hooks/useOperations";

export default function GptProcessPage() {
  const { runId = "", processId = "" } = useParams();
  const id = decodeURIComponent(processId);
  const query = useGptProcess(id);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Processus GPT introuvable"} retry={() => query.refetch()}/>;
  const data = query.data;
  return <section className="view workspace-view">
    <WorkspaceNav/><Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: decodeURIComponent(runId), to: `/replay/runs/${runId}` }, { label: "GPT" }, { label: data.process.workflow }]}/>
    <PageHeading eyebrow="Inspecteur GPT" title={data.process.workflow} subtitle={data.process.id} backTo={`/replay/runs/${runId}`} actions={<StatusTag status={data.process.status}/>}/>
    <div className="metric-grid metric-grid--compact"><MetricCard label="Tentative" value={`${data.process.attempt}/${data.process.maxAttempts || "—"}`}/><MetricCard label="Durée" value={formatDuration(data.process.durationMs)}/><MetricCard label="Worker" value={data.process.worker || "—"}/><MetricCard label="Fin" value={formatDateTime(data.process.completedAt)}/></div>
    {data.process.error && <Card className="error-box"><strong>{data.process.error.code || "Erreur GPT"}</strong><p>{data.process.error.message}</p></Card>}
    <div className="content-grid content-grid--start">
      <Card className="workspace-panel"><p className="eyebrow">Conclusion matérialisée</p><h2>{data.process.decision || "Décision GPT"}</h2><p className="conclusion-copy">{data.process.conclusion || "Aucune conclusion n’a encore été sauvegardée par le workflow."}</p></Card>
      <Card className="workspace-panel"><h2>Transport & lease</h2><dl className="definition-grid"><dt>État source</dt><dd>{data.process.rawStatus}</dd><dt>Step</dt><dd>{data.process.stepId || "—"}</dd><dt>Lease</dt><dd>{formatDateTime(data.process.leaseExpiresAt)}</dd><dt>Bundle</dt><dd>{data.process.bundle?.bundleId || "—"}</dd></dl></Card>
    </div>
    <details className="raw-inspector"><summary>Manifest du bundle</summary><pre>{JSON.stringify(data.manifest, null, 2)}</pre></details>
    <details className="raw-inspector"><summary>Save target</summary><pre>{JSON.stringify(data.saveTarget, null, 2)}</pre></details>
    <details className="raw-inspector"><summary>Prompt d’exécution</summary><pre>{data.prompt || "Non exposé"}</pre></details>
    <div><h2>Cycle de vie GPT</h2><EventTimeline events={data.process.events} runId={decodeURIComponent(runId)}/></div>
  </section>;
}
````

### `src/pages/HistoryPage.tsx`

````tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { PageHeading, StatusTag, WorkspaceNav } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";

export default function HistoryPage() {
  const query = useQuery({ queryKey: operationsKeys.history, queryFn: operationsApi.getHistory });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Historique indisponible"} retry={() => query.refetch()}/>;
  return <section className="view workspace-view"><WorkspaceNav/><PageHeading eyebrow="Long-term memory" title="Historique des sessions" subtitle="Sessions, workflows, incidents et performance réunis sans perdre la traçabilité."/>{!query.data.sessions.length ? <Card className="workspace-empty"><h3>Aucune session historique</h3><p>L’historique se construit directement à partir des workflows persistés.</p></Card> : query.data.sessions.map(session => <Link className="history-session" key={session.id} to={`/history/sessions/${encodeURIComponent(session.id)}`}><div><strong>{session.tradingDate || "Date inconnue"}</strong><span>{session.session || "global"} · {session.workflowCount} workflows</span></div><StatusTag status={session.status}/><span className="row-link">Ouvrir →</span></Link>)}</section>;
}
````

### `src/pages/HistorySessionPage.tsx`

````tsx
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, PageHeading, StatusTag, WorkspaceNav, WorkflowTable } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";

export default function HistorySessionPage() {
  const { sessionId = "" } = useParams();
  const id = decodeURIComponent(sessionId);
  const query = useQuery({ queryKey: operationsKeys.history, queryFn: operationsApi.getHistory });
  if (query.isLoading) return <LoadingView/>;
  const session = query.data?.sessions.find(item => item.id === id);
  if (query.isError || !session) return <ErrorView message={query.error?.message || "Session historique introuvable"} retry={() => query.refetch()}/>;
  return <section className="view workspace-view"><WorkspaceNav/><Breadcrumbs items={[{ label: "Historique", to: "/history" }, { label: session.tradingDate || id }]}/><PageHeading eyebrow="Session historique" title={`${session.tradingDate} · ${session.session || "global"}`} subtitle={`${session.workflowCount} workflows persistés`} backTo="/history" actions={<StatusTag status={session.status}/>}/><WorkflowTable items={session.workflows}/></section>;
}
````

### `src/pages/IncidentsPage.tsx`

````tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, formatDateTime, PageHeading, StatusTag, WorkspaceNav } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";
import type { Incident, OperationsCommandInput } from "@/operationsTypes";

export default function IncidentsPage() {
  const query = useQuery({ queryKey: operationsKeys.incidents, queryFn: operationsApi.listIncidents, refetchInterval: 15_000 });
  const client = useQueryClient();
  const [selected, setSelected] = useState<Incident | null>(null);
  const [action, setAction] = useState<OperationsCommandInput["action"]>("acknowledge");
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const mutation = useMutation({ mutationFn: (input: OperationsCommandInput) => operationsApi.executeIncidentAction(selected!.id, input), onSuccess: async () => { setSelected(null); setReason(""); setPhrase(""); await client.invalidateQueries({ queryKey: operationsKeys.all }); } });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Incidents indisponibles"} retry={() => query.refetch()}/>;
  const expected = `CONFIRM_${action.toUpperCase()}`;
  return <section className="view workspace-view">
    <WorkspaceNav/><Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Incidents" }]}/><PageHeading eyebrow="Alert lifecycle" title="Incidents & alertes" subtitle="Acquitter, reporter, résoudre et réouvrir avec une trace d’audit." backTo="/operations"/>
    {!query.data.items.length ? <Card className="workspace-empty"><h3>Aucun incident</h3><p>Les alertes canoniques, erreurs et audits de qualité sont consolidés ici.</p></Card> : <div className="incident-list">{query.data.items.map(incident => <Card className="incident-card" key={incident.id}><div><div className="incident-card__title"><i data-severity={incident.severity}/><div><strong>{incident.title}</strong><small>{incident.kind} · {formatDateTime(incident.updatedAt)}</small></div></div><p>{incident.message}</p></div><div><StatusTag status={incident.lifecycleStatus}/>{incident.lifecycleStatus !== "resolved" ? <button className="secondary-btn" onClick={() => setSelected(incident)}>Traiter</button> : <button className="text-btn" onClick={() => { setSelected(incident); setAction("reopen"); }}>Réouvrir</button>}</div></Card>)}</div>}
    {selected && <Card className="command-panel"><div><p className="eyebrow">Incident sélectionné</p><h2>{selected.title}</h2></div><div className="command-panel__form"><label>Action<select value={action} onChange={event => { setAction(event.target.value as typeof action); setPhrase(""); }}><option value="acknowledge">Acquitter</option><option value="snooze">Reporter</option><option value="resolve">Résoudre</option><option value="reopen">Réouvrir</option></select></label><label>Motif<input value={reason} onChange={event => setReason(event.target.value)}/></label><label>Confirmation<input value={phrase} placeholder={expected} onChange={event => setPhrase(event.target.value)}/></label><button className="primary-btn" disabled={phrase !== expected || reason.length < 3 || mutation.isPending} onClick={() => mutation.mutate({ action, reason, confirmationPhrase: phrase, idempotencyKey: crypto.randomUUID(), expectedRevision: selected.revision })}>Appliquer</button><button className="text-btn" onClick={() => setSelected(null)}>Annuler</button></div>{mutation.isError && <p className="form-error">{mutation.error.message}</p>}</Card>}
  </section>;
}
````

### `src/pages/LiveDeskPage.tsx`

````tsx
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/common";
import {
  ActivityCard, BriefCard, DeltaCard, HeroCard, LiveSectionHeading, MacroNewsCard,
  MarketStrip, PositionCard, SetupCard, StatusRibbon, ThesisCard, Timeline
} from "@/components/deskCards";
import { useOverlay } from "@/context/OverlayContext";
import { DeskPage } from "@/pages/pageState";

export default function LiveDeskPage() {
  const navigate = useNavigate();
  const overlay = useOverlay();
  return <DeskPage>{data => <section className="view view--live">
    <StatusRibbon data={data}/>
    <HeroCard data={data}/>
    <LiveSectionHeading title="Prix & évolution" subtitle="MNQ, MES, MCL et mega caps · OHLC quotidien, RSI et ATR"/>
    <MarketStrip data={data}/>

    <LiveSectionHeading title="Lecture du Desk" subtitle="Faits, interprétation et évolution de la thèse"/>
    <div className="content-grid content-grid--briefs">
      <BriefCard eyebrow="Marché" headline={data.marketBrief.headline} text={data.marketBrief.text} verdict={data.marketBrief.verdict} icon="chart"/>
      <BriefCard eyebrow="Cross-asset" headline={data.crossAssetBrief.headline} text={data.crossAssetBrief.text} verdict={data.crossAssetBrief.verdict} icon="globe"/>
    </div>

    <DeltaCard data={data}/>
    <div className="content-grid">
      <ThesisCard data={data}/>
      <SetupCard data={data}/>
    </div>
    <PositionCard data={data}/>
    <MacroNewsCard data={data}/>

    <LiveSectionHeading title="Activité & journal" subtitle="Traçabilité des décisions et des workers" action={
      <button className="text-btn" onClick={() => navigate("/timeline")}>Tout voir <Icon name="arrow" size={15}/></button>
    }/>
    <div className="content-grid">
      <ActivityCard data={data}/>
      <article className="card timeline-card">
        <Timeline data={data} compact onSelect={event => overlay.openDrawer(event.title, <div>
          <section className="drawer-section"><p>{event.summary}</p><div className="detail-pairs"><div><span>Heure</span><strong>{event.time}</strong></div><div><span>Type</span><strong>{event.type}</strong></div><div><span>Statut</span><strong>{event.status}</strong></div></div></section>
          <section className="drawer-section"><h3>Détail</h3><p>{event.detail}</p></section>
        </div>)}/>
      </article>
    </div>
  </section>}</DeskPage>;
}
````

### `src/pages/MasterPage.tsx`

````tsx
import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { deskDetailScope, useMasterDetail } from "@/hooks/useDesk";
import { DeskPage } from "@/pages/pageState";
import type { DeskSession } from "@/types";

function StepList({ title, items, tone }: { title: string; items: string[]; tone: "positive" | "critical" | "info" }) {
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
  return <section className="view">
    <SectionTitle title="Master Analysis" subtitle={`Plan figé au cutoff · ${data.master.createdAt}`}/>
    <Card className="master-hero-react">
      <div className="master-hero-react__top"><div><p className="eyebrow">Décision initiale</p><h1>{data.master.decision}</h1><p>{data.master.summary}</p></div><StatusBadge tone="warning">{data.master.confidence}%</StatusBadge></div>
      <div className="detail-pairs detail-pairs--four">
        <div><span>Instrument</span><strong>{data.master.instrument}</strong></div>
        <div><span>Direction</span><strong>{data.master.direction}</strong></div>
        <div><span>Régime</span><strong>{data.master.regime}</strong></div>
        <div><span>ID</span><strong className="truncate">{data.master.id}</strong></div>
      </div>
    </Card>

    <div className="content-grid">
      <Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Macro Thesis</p><h3>Contexte fondamental</h3></div><span className="card-icon"><Icon name="globe"/></span></div><p>{data.master.macroThesis}</p></Card>
      <Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Asset Selection</p><h3>Pourquoi {data.master.instrument}</h3></div><span className="card-icon"><Icon name="target"/></span></div><p>{data.master.assetSelection}</p></Card>
    </div>

    <div className="content-grid">
      <StepList title="Expected path" items={data.master.expectedPath} tone="positive"/>
      <StepList title="Failure path" items={data.master.failurePath} tone="critical"/>
    </div>
    <StepList title="Monitoring playbook" items={data.master.monitoringPlaybook} tone="info"/>

    <SectionTitle title="Analyse complète" subtitle="Chapitres du contrat Master v4.0.0"/>
    <div className="accordion-list">
      {data.master.sections.map((section, index) => <details className="accordion-react card" key={index} open={index === 0}>
        <summary><span>{String(index + 1).padStart(2, "0")}</span><strong>{section.title}</strong><Icon name="chevron"/></summary>
        <div><p>{section.content}</p></div>
      </details>)}
    </div>
  </section>;
}
````

### `src/pages/MonitorsPage.tsx`

````tsx
import { useState } from "react";
import { Card, HealthOrb, SectionTitle, StatusBadge } from "@/components/common";
import { Conditions, ExpectedRealized } from "@/components/deskCards";
import { deskDetailScope, useMonitorDetail } from "@/hooks/useDesk";
import { DeskPage } from "@/pages/pageState";
import type { MonitorItem } from "@/types";

function MonitorDetail({ monitor }: { monitor: MonitorItem }) {
  return <>
    <Card className="monitor-hero-react">
      <div><p className="eyebrow">Monitor #{monitor.sequence} · {monitor.time}</p><h1>{monitor.decision}</h1><p>{monitor.summary}</p></div>
      <HealthOrb score={monitor.healthAfter}/>
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
      <SectionTitle title="Monitors" subtitle="Contrôle dynamique de la thèse active"/>
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
import { useNavigate } from "react-router-dom";
import { Card, Icon, type IconName, SectionTitle } from "@/components/common";

const links: Array<{to:string; label:string; text:string; icon:IconName}> = [
  {to:"/operations",label:"Cockpit opérations",text:"Tous les workflows automatisés",icon:"monitor"},
  {to:"/replay",label:"Replay Lab",text:"Backtests, journées et processus GPT",icon:"layers"},
  {to:"/performance/analysis",label:"Analyse performance",text:"Comparaisons et ventilations",icon:"chart"},
  {to:"/history",label:"Historique",text:"Sessions et décisions passées",icon:"database"},
  {to:"/strategies",label:"Stratégies",text:"Configurations et versions",icon:"settings"},
  {to:"/sessions",label:"Sessions",text:"Changer de workspace",icon:"layers"},
  {to:"/thesis",label:"Thèse",text:"État vivant du plan",icon:"brain"},
  {to:"/setup",label:"Setup & Position",text:"Exécution et gestion",icon:"position"},
  {to:"/news",label:"Macro & News",text:"Calendrier et digest",icon:"news"},
  {to:"/performance",label:"Calendrier R",text:"Résultats quotidiens et zoom",icon:"calendar"},
  {to:"/alerts",label:"Alertes",text:"Actions prioritaires",icon:"bell"},
  {to:"/audit",label:"Audit",text:"Qualité et contrats",icon:"audit"}
];

export default function MorePage() {
  const navigate = useNavigate();
  return <section className="view"><SectionTitle title="Navigation" subtitle="Tous les espaces du Desk"/>
    <div className="more-grid-react">{links.map(link => <Card key={link.to} onClick={() => navigate(link.to)} className="more-link-react"><span className="card-icon"><Icon name={link.icon}/></span><div><h3>{link.label}</h3><p>{link.text}</p></div><Icon name="arrow"/></Card>)}</div>
  </section>;
}
````

### `src/pages/NewsPage.tsx`

````tsx
import { useEffect, useRef } from "react";
import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
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
    <SectionTitle title="Macro & News" subtitle={"Calendrier quotidien · " + data.date + " · prochain événement mis en évidence"}/>
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

### `src/pages/OperationsPage.tsx`

````tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { ErrorView, LoadingView } from "@/components/common";
import { MetricCard, PageHeading, WorkspaceNav, WorkflowTable } from "@/components/operations";
import { useOperationsEvents, useOperationsSummary, useWorkflows } from "@/hooks/useOperations";

export default function OperationsPage() {
  useOperationsEvents();
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const summary = useOperationsSummary();
  const workflows = useWorkflows({ status, kind, q, limit: 500 });
  if (summary.isLoading || workflows.isLoading) return <LoadingView/>;
  if (summary.isError || workflows.isError || !summary.data || !workflows.data) return <ErrorView message={(summary.error || workflows.error)?.message || "Cockpit indisponible"} retry={() => { summary.refetch(); workflows.refetch(); }}/ >;
  const totals = summary.data.totals;
  return <section className="view workspace-view">
    <WorkspaceNav/>
    <PageHeading eyebrow="Control plane" title="Cockpit des opérations" subtitle="Tous les workflows automatisés, leur progression et les interventions requises." actions={<Link className="secondary-btn" to="/operations/incidents">Incidents · {totals.openIncidents}</Link>}/>
    <div className="metric-grid">
      <MetricCard label="Workflows" value={totals.workflows} detail={summary.data.health.label}/>
      <MetricCard label="En cours" value={totals.running} tone="info"/>
      <MetricCard label="Attente GPT" value={totals.waitingGpt} tone="warning"/>
      <MetricCard label="Bloqués / échecs" value={totals.blocked + totals.failed} tone={totals.failed ? "critical" : "warning"}/>
      <MetricCard label="Terminés" value={totals.completed} tone="positive"/>
      <MetricCard label="Process GPT actifs" value={totals.gptInProgress}/>
    </div>
    <div className="workspace-toolbar">
      <label>Recherche<input value={q} onChange={event => setQ(event.target.value)} placeholder="ID, type, état…"/></label>
      <label>Type<select value={kind} onChange={event => setKind(event.target.value)}><option value="">Tous</option><option value="replay">Replay</option><option value="backtest">Backtest</option><option value="job">Job</option><option value="feature">Feature</option></select></label>
      <label>État<select value={status} onChange={event => setStatus(event.target.value)}><option value="">Tous</option><option value="running">En cours</option><option value="waiting_gpt">Attente GPT</option><option value="blocked">Bloqué</option><option value="failed">Échec</option><option value="completed">Terminé</option><option value="paused">Pause</option></select></label>
      <button className="text-btn" onClick={() => workflows.refetch()}>Actualiser</button>
    </div>
    <WorkflowTable items={workflows.data.items}/>
  </section>;
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
import { useQuery } from "@tanstack/react-query";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { MetricCard, PageHeading, WorkspaceNav } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";

export default function PerformanceAnalysisPage() {
  const query = useQuery({ queryKey: operationsKeys.performance, queryFn: () => operationsApi.getPerformance() });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Analyse indisponible"} retry={() => query.refetch()}/>;
  const data = query.data;
  const totals = data.totals;
  return <section className="view workspace-view">
    <WorkspaceNav/><PageHeading eyebrow="Analytics" title="Analyse de performance" subtitle="Résultats réels consolidés par session, instrument, direction et journée."/>
    <div className="metric-grid"><MetricCard label="Résultat" value={`${Number(totals.totalR || 0).toFixed(2)} R`} tone={Number(totals.totalR || 0) >= 0 ? "positive" : "critical"}/><MetricCard label="Trades" value={Number(totals.trades || 0)}/><MetricCard label="Win rate" value={totals.winRate === null ? "—" : `${(Number(totals.winRate) * 100).toFixed(1)}%`}/><MetricCard label="Expectancy" value={totals.expectancyR === null ? "—" : `${Number(totals.expectancyR).toFixed(2)} R`}/></div>
    {!data.breakdowns.some(item => item.items.length) ? <Card className="workspace-empty"><h3>Pas encore de résultat matérialisé</h3><p>Les performances calculées par le backend s’afficheront dès que des trades ou bilans journaliers seront disponibles.</p></Card> : <div className="breakdown-grid">{data.breakdowns.map(group => <Card className="workspace-panel" key={group.dimension}><h2>Par {group.dimension}</h2><div className="breakdown-list">{group.items.map((item, index) => <div key={String(item.label || index)}><span>{String(item.label || "—")}</span><strong>{Number(item.totalR || 0).toFixed(2)} R</strong><small>{Number(item.trades || 0)} trades</small></div>)}</div></Card>)}</div>}
  </section>;
}
````

### `src/pages/PerformanceCalendarPage.tsx`

````tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { deskApi } from "@/api/deskApi";
import { refreshPolicyMs } from "@/api/endpoints";
import { Card, Drawer, Icon, SectionTitle } from "@/components/common";
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
    <SectionTitle title="Calendrier des performances" subtitle="Résultat net quotidien en R · cliquez sur une date pour ouvrir la journée"/>

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

    <Drawer open={Boolean(selectedDate)} title={selectedDate ? new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${selectedDate}T12:00:00Z`)) : "Journée"} onClose={() => setSelectedDate(null)}>
      {dayQuery.isLoading ? <div className="performance-day-loading">Chargement de la journée…</div> : dayQuery.isError ? <div className="performance-day-loading">Impossible de charger le détail.<button className="text-btn" onClick={() => dayQuery.refetch()}>Réessayer</button></div> : dayQuery.data ? <DayZoom day={dayQuery.data.day} calendarDay={selectedDay}/> : null}
    </Drawer>
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
import { Breadcrumbs, PageHeading, StatusTag, WorkspaceNav } from "@/components/operations";
import { operationsKeys, useReplays } from "@/hooks/useOperations";

export default function ReplayComparePage() {
  const replays = useReplays();
  const [selected, setSelected] = useState<string[]>([]);
  const comparison = useQuery({ queryKey: [...operationsKeys.replays, "compare", selected], queryFn: () => operationsApi.compareReplays(selected), enabled: selected.length >= 2 });
  const selectedItems = useMemo(() => replays.data?.items.filter(item => selected.includes(item.sourceId)) || [], [replays.data, selected]);
  if (replays.isLoading) return <LoadingView/>;
  if (replays.isError || !replays.data) return <ErrorView message={replays.error?.message || "Comparateur indisponible"} retry={() => replays.refetch()}/>;
  const toggle = (id: string) => setSelected(value => value.includes(id) ? value.filter(item => item !== id) : value.length < 8 ? [...value, id] : value);
  return <section className="view workspace-view">
    <WorkspaceNav/><Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: "Comparaison" }]}/><PageHeading eyebrow="A/B replay" title="Comparer les exécutions" subtitle="Jusqu’à huit variantes ou tentatives, à partir des résultats canoniques." backTo="/replay"/>
    <Card className="workspace-panel"><h2>Sélection · {selected.length}/8</h2><div className="comparison-picker">{replays.data.items.map(item => <label key={item.id} className={selected.includes(item.sourceId) ? "selected" : ""}><input type="checkbox" checked={selected.includes(item.sourceId)} onChange={() => toggle(item.sourceId)}/><div><strong>{item.tradingDate} · {item.session || item.kind}</strong><small>{item.variantId || item.sourceId}</small></div><StatusTag status={item.status}/></label>)}</div></Card>
    {selected.length < 2 ? <Card className="workspace-empty"><h3>Sélectionnez au moins deux runs</h3><p>La comparaison sera demandée au backend dès que deux exécutions seront cochées.</p></Card> : comparison.isLoading ? <LoadingView/> : comparison.isError ? <ErrorView message={comparison.error.message} retry={() => comparison.refetch()}/> : <Card className="workspace-panel"><h2>Matrice comparative</h2><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Run</th><th>État</th><th>Progression</th><th>Résultat</th><th>Étapes</th><th>GPT</th></tr></thead><tbody>{selectedItems.map(item => <tr key={item.id}><td><strong>{item.tradingDate} · {item.session}</strong><small>{item.variantId}</small></td><td><StatusTag status={item.status}/></td><td>{item.progress}%</td><td>{Number(item.metrics.totalR || 0).toFixed(2)} R</td><td>{item.metrics.stepsDone || 0}/{item.metrics.stepsTotal || 0}</td><td>{item.metrics.gptProcesses || 0}</td></tr>)}</tbody></table></div></Card>}
  </section>;
}
````

### `src/pages/ReplayDayPage.tsx`

````tsx
import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, MetricCard, PageHeading, ProgressBar, StatusTag, WorkspaceNav } from "@/components/operations";
import { useReplayDay } from "@/hooks/useOperations";

export default function ReplayDayPage() {
  const { runId = "", date = "" } = useParams();
  const id = decodeURIComponent(runId);
  const query = useReplayDay(id, date);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Journée introuvable"} retry={() => query.refetch()}/>;
  const day = query.data;
  return <section className="view workspace-view">
    <WorkspaceNav/><Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: id, to: `/replay/runs/${encodeURIComponent(id)}` }, { label: day.date }]}/>
    <PageHeading eyebrow="Journée replay" title={day.date} subtitle={`${day.sessions.length} exécutions · ${day.variants.length} variantes`} backTo={`/replay/runs/${encodeURIComponent(id)}`} actions={<StatusTag status={day.status}/>}/>
    <div className="metric-grid metric-grid--compact"><MetricCard label="Sessions" value={day.metrics.sessionCount}/><MetricCard label="Variantes" value={day.variants.length}/><MetricCard label="Progression moyenne" value={`${day.metrics.progress}%`}/><MetricCard label="Résultat cumulé" value={`${day.metrics.totalR.toFixed(2)} R`}/></div>
    <Card className="workspace-panel"><div className="panel-heading"><div><p className="eyebrow">Exécutions distinctes</p><h2>Sessions, variantes et tentatives</h2></div></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Session</th><th>Variante</th><th>Tentative</th><th>État</th><th>Progression</th><th>Résultat</th><th/></tr></thead><tbody>{day.sessions.map(session => <tr key={session.id}><td><strong>{session.session || "globale"}</strong><small>{session.sessionExecutionId}</small></td><td>{session.variantId || "default"}</td><td>#{session.attempt || 1}</td><td><StatusTag status={session.status}/></td><td><ProgressBar value={session.progress}/></td><td>{Number(session.metrics.totalR || 0).toFixed(2)} R</td><td><Link className="row-link" to={`/replay/runs/${encodeURIComponent(id)}/days/${day.date}/sessions/${encodeURIComponent(session.sessionExecutionId || session.sourceId)}`}>Ouvrir →</Link></td></tr>)}</tbody></table></div>
    </Card>
    <Card className="workspace-panel"><h2>Variantes présentes</h2><div className="tag-list">{day.variants.map(variant => <span key={variant}>{variant}</span>)}</div></Card>
  </section>;
}
````

### `src/pages/ReplayLabPage.tsx`

````tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { MetricCard, PageHeading, ProgressBar, StatusTag, WorkspaceNav } from "@/components/operations";
import { operationsKeys, useReplays } from "@/hooks/useOperations";

export default function ReplayLabPage() {
  const query = useReplays();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), session: "asia_open", strategyId: "asia_open", packId: "", packBuildId: "", start: "02:00", end: "10:00", cadence: "15m" });
  const create = useMutation({ mutationFn: () => {
    const suffix = `${form.date}_${form.session}_${Date.now()}`.replace(/[^a-zA-Z0-9]+/g, "_");
    return operationsApi.createReplay({ backtest_id: `replay_${suffix}`, strategy_id: form.strategyId, trading_date: form.date, date: form.date, session: form.session, pack_id: form.packId, pack_build_id: form.packBuildId, start_time: `${form.date}T${form.start}:00+02:00`, end_time: `${form.date}T${form.end}:00+02:00`, cadence: form.cadence, automation_enabled: true, idempotency_key: crypto.randomUUID() });
  }, onSuccess: async () => { setCreating(false); await client.invalidateQueries({ queryKey: operationsKeys.all }); } });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Replay Lab indisponible"} retry={() => query.refetch()}/>;
  const { days, items } = query.data;
  return <section className="view workspace-view">
    <WorkspaceNav/>
    <PageHeading eyebrow="Research workspace" title="Replay Lab" subtitle="Évolution de tous les backtests, journées, sessions et processus GPT." actions={<><button className="primary-btn" onClick={() => setCreating(value => !value)}>Nouveau replay</button><Link className="secondary-btn" to="/replay/compare">Comparer</Link></>}/>
    {creating && <Card className="workspace-panel"><p className="eyebrow">Création canonique</p><h2>Lancer une journée replay</h2><p className="muted-copy">Le pack et son build doivent déjà être prêts dans le backend. La création est persistée et déclenche l’orchestration réelle.</p><div className="replay-create-form"><label>Date<input type="date" value={form.date} onChange={event => setForm(value => ({ ...value, date: event.target.value }))}/></label><label>Session<select value={form.session} onChange={event => setForm(value => ({ ...value, session: event.target.value, strategyId: event.target.value === "ny_open" ? "ny_open_1530" : "asia_open" }))}><option value="asia_open">Asia Open</option><option value="ny_open">NY Open</option></select></label><label>Stratégie<input value={form.strategyId} onChange={event => setForm(value => ({ ...value, strategyId: event.target.value }))}/></label><label>Pack ID<input value={form.packId} onChange={event => setForm(value => ({ ...value, packId: event.target.value }))}/></label><label>Pack build ID<input value={form.packBuildId} onChange={event => setForm(value => ({ ...value, packBuildId: event.target.value }))}/></label><label>Début<input type="time" value={form.start} onChange={event => setForm(value => ({ ...value, start: event.target.value }))}/></label><label>Fin<input type="time" value={form.end} onChange={event => setForm(value => ({ ...value, end: event.target.value }))}/></label><label>Cadence<select value={form.cadence} onChange={event => setForm(value => ({ ...value, cadence: event.target.value }))}><option value="15m">15 min</option><option value="30m">30 min</option><option value="60m">60 min</option></select></label><button className="primary-btn" disabled={!form.packId || !form.packBuildId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Création…" : "Créer et démarrer"}</button><button className="text-btn" onClick={() => setCreating(false)}>Annuler</button></div>{create.isError && <p className="form-error">{create.error.message}</p>}</Card>}
    <div className="metric-grid metric-grid--compact">
      <MetricCard label="Exécutions" value={items.length}/><MetricCard label="Journées" value={days.length}/>
      <MetricCard label="En cours" value={items.filter(item => item.status === "running").length} tone="info"/>
      <MetricCard label="Échecs" value={items.filter(item => item.status === "failed").length} tone="critical"/>
    </div>
    {!days.length ? <Card className="workspace-empty"><h3>Aucun replay enregistré</h3><p>Le Lab est connecté à PostgreSQL. Les runs créés par l’autopilot apparaîtront ici, sans jeu de données simulé côté front.</p></Card> : <div className="replay-day-grid">{days.map(day => <Card key={day.date} className="replay-day-card">
      <header><div><p className="eyebrow">Journée</p><h2>{day.date}</h2></div><StatusTag status={day.status}/></header>
      <div className="replay-day-card__metrics"><span><strong>{day.sessionCount}</strong> sessions</span><span><strong>{day.totalR.toFixed(2)} R</strong> cumulé</span></div>
      <ProgressBar value={day.totalProgress}/>
      <div className="session-preview-list">{day.sessions.slice(0, 4).map((session, index) => <Link key={session.id} to={`/replay/runs/${encodeURIComponent(session.sourceId)}/days/${day.date}`}><span>{session.session || "session"} · tentative {index + 1}</span><StatusTag status={session.status}/></Link>)}</div>
      <Link className="row-link" to={`/replay/runs/${encodeURIComponent(day.sessions[0].sourceId)}/days/${day.date}`}>Explorer la journée <span>→</span></Link>
    </Card>)}</div>}
  </section>;
}
````

### `src/pages/ReplayRunPage.tsx`

````tsx
import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, DecisionChart, EventTimeline, MetricCard, PageHeading, ProgressBar, StatusTag, WorkspaceNav } from "@/components/operations";
import { useReplay } from "@/hooks/useOperations";

export default function ReplayRunPage() {
  const { runId = "" } = useParams();
  const id = decodeURIComponent(runId);
  const query = useReplay(id);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Replay introuvable"} retry={() => query.refetch()}/>;
  const data = query.data;
  return <section className="view workspace-view">
    <WorkspaceNav/><Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: data.run.tradingDate || data.run.name }]}/>
    <PageHeading eyebrow="Replay run" title={data.run.name} subtitle={data.run.sourceId} backTo="/replay" actions={<StatusTag status={data.run.status}/>}/>
    <div className="metric-grid metric-grid--compact"><MetricCard label="Progression" value={`${data.run.progress}%`}/><MetricCard label="Étapes" value={`${data.run.metrics.stepsDone || 0}/${data.run.metrics.stepsTotal || 0}`}/><MetricCard label="Process GPT" value={data.gptProcesses.length}/><MetricCard label="Résultat" value={`${Number(data.run.metrics.totalR || 0).toFixed(2)} R`}/></div>
    <ProgressBar value={data.run.progress}/>
    <div className="inline-actions"><Link className="primary-btn" to={`/replay/runs/${encodeURIComponent(id)}/days/${data.run.tradingDate}`}>Sessions de la journée</Link><Link className="secondary-btn" to={`/operations/workflows/${encodeURIComponent(data.run.id)}`}>Contrôler le workflow</Link></div>
    <DecisionChart prices={data.priceSeries} events={data.timeline} runId={id}/>
    <div className="content-grid content-grid--start"><Card className="workspace-panel"><h2>Conclusions GPT</h2>{!data.conclusions.length ? <p className="muted-copy">Aucune conclusion GPT matérialisée.</p> : data.conclusions.map(item => <Link className="conclusion-item" key={item.processId} to={`/replay/runs/${encodeURIComponent(id)}/gpt/${encodeURIComponent(item.processId)}`}><strong>{item.conclusion}</strong><span>Inspecter →</span></Link>)}</Card><Card className="workspace-panel"><h2>Processus GPT</h2>{data.gptProcesses.map(process => <Link className="gpt-row" key={process.id} to={`/replay/runs/${encodeURIComponent(id)}/gpt/${encodeURIComponent(process.id)}`}><div><strong>{process.workflow}</strong><small>Tentative {process.attempt}/{process.maxAttempts || "—"}</small></div><StatusTag status={process.status}/></Link>)}</Card></div>
    <div id="timeline-events"><h2>Timeline complète</h2><EventTimeline events={data.timeline} runId={id}/></div>
  </section>;
}
````

### `src/pages/ReplaySessionPage.tsx`

````tsx
import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, DecisionChart, EventTimeline, formatDuration, MetricCard, PageHeading, StatusTag, WorkspaceNav } from "@/components/operations";
import { useReplaySession } from "@/hooks/useOperations";

export default function ReplaySessionPage() {
  const { runId = "", date = "", sessionExecutionId = "" } = useParams();
  const parent = decodeURIComponent(runId);
  const execution = decodeURIComponent(sessionExecutionId);
  const query = useReplaySession(parent, execution);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Session introuvable"} retry={() => query.refetch()}/>;
  const data = query.data;
  return <section className="view workspace-view">
    <WorkspaceNav/><Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: parent, to: `/replay/runs/${encodeURIComponent(parent)}` }, { label: date, to: `/replay/runs/${encodeURIComponent(parent)}/days/${date}` }, { label: data.run.session || execution }]}/>
    <PageHeading eyebrow="Session replay" title={`${data.run.session || "Session"} · ${data.run.strategyId || "Desk"}`} subtitle={execution} backTo={`/replay/runs/${encodeURIComponent(parent)}/days/${date}`} actions={<StatusTag status={data.run.status}/>}/>
    <div className="metric-grid metric-grid--compact"><MetricCard label="Progression" value={`${data.run.progress}%`}/><MetricCard label="Durée" value={formatDuration(data.run.durationMs)}/><MetricCard label="Processus GPT" value={data.gptProcesses.length}/><MetricCard label="Résultat" value={`${Number(data.run.metrics.totalR || 0).toFixed(2)} R`}/></div>
    <DecisionChart prices={data.priceSeries} events={data.timeline} runId={execution}/>
    <div className="content-grid content-grid--start">
      <Card className="workspace-panel"><h2>Processus GPT de la session</h2>{!data.gptProcesses.length ? <p className="muted-copy">Aucun processus GPT lié.</p> : data.gptProcesses.map(process => <Link className="gpt-row" key={process.id} to={`/replay/runs/${encodeURIComponent(execution)}/gpt/${encodeURIComponent(process.id)}`}><div><strong>{process.workflow}</strong><small>{process.decision || process.conclusion || process.rawStatus}</small></div><StatusTag status={process.status}/></Link>)}</Card>
      <Card className="workspace-panel"><h2>Conclusions</h2>{!data.conclusions.length ? <p className="muted-copy">Les conclusions enregistrées apparaîtront après matérialisation.</p> : data.conclusions.map(item => <blockquote key={item.processId}>{item.conclusion}</blockquote>)}</Card>
    </div>
    <div id="timeline-events"><h2>Décisions horodatées</h2><EventTimeline events={data.timeline} runId={execution}/></div>
  </section>;
}
````

### `src/pages/SessionsPage.tsx`

````tsx
import { Card, SectionTitle } from "@/components/common";
import { useDeskContext } from "@/context/DeskContext";

export default function SessionsPage() {
  const { phase, phaseLabel, nextPhaseAt } = useDeskContext();
  const phases = [
    { id: "asia", label: "Asia", hours: "00:00–08:00", detail: "Ouverture et flux Asie" },
    { id: "london", label: "London", hours: "08:00–15:30", detail: "Session européenne" },
    { id: "ny", label: "New York", hours: "15:30–00:00", detail: "Cash US et clôture" },
  ] as const;
  return <section className="view">
    <SectionTitle title="Sessions" subtitle={"Sélection automatique Europe/Paris · " + phaseLabel + " active · prochaine phase " + nextPhaseAt}/>
    <div className="session-list-react">
      {phases.map(item => <Card className={"session-card-react session-card-react--auto " + (phase === item.id ? "active" : "")} key={item.id}>
        <div><p className="eyebrow">{item.hours}</p><h2>{item.label}</h2><p>{item.detail}</p></div>
        <span className="automatic-phase-state">{phase === item.id ? "ACTIVE AUTO" : "PROGRAMMÉE"}</span>
      </Card>)}
    </div>
  </section>;
}
````

### `src/pages/SetupPage.tsx`

````tsx
import { useState, type FormEvent } from "react";
import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
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
    <SectionTitle title="Setup & Position" subtitle="Plan théorique séparé de l’exécution canonique"/>
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
      <StatusBadge tone={canWrite ? "positive" : auth.status === "loading" ? "warning" : "muted"}>
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
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [reason, setReason] = useState("");
  const [partialFraction, setPartialFraction] = useState(0.5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = operatorConfirmationIsValid(confirmationPhrase, capability.confirmationPhrase, reason);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({ confirmationPhrase, reason: reason.trim(), partialFraction });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSubmitting(false);
    }
  };

  return <form className="operator-confirmation" onSubmit={submit}>
    <p>La commande sera appliquée à la cible <strong>{capability.targetId || "session active"}</strong> depuis la révision <strong>{revision}</strong>.</p>
    <label>
      Justification opérateur
      <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="Pourquoi cette action est-elle justifiée maintenant ?" autoFocus/>
    </label>
    {capability.command === "take_partial" && <label>
      Fraction à sortir
      <select value={partialFraction} onChange={event => setPartialFraction(Number(event.target.value))}>
        <option value={0.25}>25 %</option><option value={0.5}>50 %</option><option value={0.75}>75 %</option>
      </select>
    </label>}
    <label>
      Recopiez <code>{capability.confirmationPhrase}</code>
      <input value={confirmationPhrase} onChange={event => setConfirmationPhrase(event.target.value.toUpperCase())} autoComplete="off" spellCheck={false}/>
    </label>
    {error && <p className="operator-feedback operator-feedback--error">{error}</p>}
    <div className="modal__actions">
      <button type="button" className="secondary-btn" onClick={onCancel} disabled={submitting}>Annuler</button>
      <button type="submit" className={capability.dangerLevel === "critical" ? "danger-btn" : "primary-btn"} disabled={!confirmed || submitting}>
        {submitting ? "Enregistrement…" : "Confirmer l’écriture"}
      </button>
    </div>
  </form>;
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
import { Card, ErrorView, LoadingView } from "@/components/common";
import { PageHeading, WorkspaceNav } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";

export default function StrategiesPage() {
  const query = useQuery({ queryKey: operationsKeys.strategies, queryFn: operationsApi.listStrategies });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Stratégies indisponibles"} retry={() => query.refetch()}/>;
  return <section className="view workspace-view">
    <WorkspaceNav/><PageHeading eyebrow="Version governance" title="Stratégies & versions" subtitle="Configuration, runtime, contrats actifs et historique des versions."/>
    <div className="strategy-grid">{query.data.items.map(strategy => <Link key={strategy.id} to={`/strategies/${encodeURIComponent(strategy.id)}`}><Card className="strategy-card"><header><div><p className="eyebrow">Stratégie</p><h2>{strategy.id}</h2></div><span>{strategy.versions.length} versions</span></header><dl className="definition-grid"><dt>Catalogue</dt><dd>{strategy.catalog ? "Présent" : "Non publié"}</dd><dt>Configuration</dt><dd>{strategy.config ? "Active" : "Par défaut"}</dd><dt>Runtime</dt><dd>{strategy.runtime ? "Matérialisé" : "Inactif"}</dd><dt>Contrats</dt><dd>{strategy.activeContracts.length}</dd></dl><span className="row-link">Ouvrir la stratégie →</span></Card></Link>)}</div>
  </section>;
}
````

### `src/pages/StrategyDetailPage.tsx`

````tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, PageHeading, WorkspaceNav } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";

export default function StrategyDetailPage() {
  const { strategyId = "" } = useParams();
  const id = decodeURIComponent(strategyId);
  const strategies = useQuery({ queryKey: operationsKeys.strategies, queryFn: operationsApi.listStrategies });
  const strategy = strategies.data?.items.find(item => item.id === id);
  const versions = useMemo(() => strategy?.versions || [], [strategy]);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const comparison = useQuery({ queryKey: ["operations", "strategy-compare", id, left, right], queryFn: () => operationsApi.compareStrategyVersions(id, left, right), enabled: Boolean(left && right) });
  if (strategies.isLoading) return <LoadingView/>;
  if (strategies.isError || !strategy) return <ErrorView message={strategies.error?.message || "Stratégie introuvable"} retry={() => strategies.refetch()}/>;
  return <section className="view workspace-view"><WorkspaceNav/><Breadcrumbs items={[{ label: "Stratégies", to: "/strategies" }, { label: id }]}/><PageHeading eyebrow="Strategy governance" title={id} subtitle="Configuration, runtime, contrats et comparaison de versions" backTo="/strategies"/><div className="content-grid content-grid--start"><Card className="workspace-panel"><h2>Versions publiées</h2>{!versions.length ? <p className="muted-copy">Aucune version explicite.</p> : <div className="version-list">{versions.map((version, index) => <div key={String(version.version_id || index)}><strong>{String(version.version || version.version_id)}</strong><small>{String(version.status || "archivée")}</small></div>)}</div>}</Card><Card className="workspace-panel"><h2>Contrats actifs</h2><div className="version-list">{strategy.activeContracts.map(contract => <div key={`${contract.name}:${contract.version}`}><strong>{contract.name}</strong><small>v{contract.version} · {contract.status}</small></div>)}</div></Card></div>{versions.length >= 2 && <Card className="workspace-panel"><h2>Comparer deux versions</h2><div className="workspace-toolbar"><label>Avant<select value={left} onChange={event => setLeft(event.target.value)}><option value="">Sélectionner</option>{versions.map((version, index) => <option key={index} value={String(version.version_id || version.version)}>{String(version.version || version.version_id)}</option>)}</select></label><label>Après<select value={right} onChange={event => setRight(event.target.value)}><option value="">Sélectionner</option>{versions.map((version, index) => <option key={index} value={String(version.version_id || version.version)}>{String(version.version || version.version_id)}</option>)}</select></label></div>{comparison.data && <details className="raw-inspector" open><summary>Diff structurel</summary><pre>{JSON.stringify(comparison.data, null, 2)}</pre></details>}</Card>}<details className="raw-inspector"><summary>Configuration courante</summary><pre>{JSON.stringify(strategy.config || strategy.catalog, null, 2)}</pre></details></section>;
}
````

### `src/pages/ThesisPage.tsx`

````tsx
import { Card, HealthOrb, Icon, SectionTitle, StatusBadge } from "@/components/common";
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
    <SectionTitle title="Thèse active" subtitle="État vivant mis à jour par les Monitors"/>
    <Card className="thesis-page-hero">
      <div className="thesis-page-hero__copy">
        <div className="instrument-title"><span className="instrument-badge">{data.thesis.instrument}</span><div><p className="eyebrow">{data.thesis.direction}</p><h1>{data.thesis.status}</h1></div></div>
        <p>{data.thesis.dominantScenario}</p>
        <StatusBadge tone={data.thesis.health < 40 ? "critical" : "warning"}>{data.thesis.previousStatus} → {data.thesis.status}</StatusBadge>
      </div>
      <HealthOrb score={data.thesis.health}/>
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
import { Card, SectionTitle } from "@/components/common";
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
    <SectionTitle title="Journal de décision" subtitle="Master → Thèse → Monitor → Setup → Position"/>
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
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, EventTimeline, formatDateTime, formatDuration, MetricCard, PageHeading, ProgressBar, StatusTag, WorkspaceNav } from "@/components/operations";
import { operationsKeys, useWorkflow } from "@/hooks/useOperations";
import type { OperationsCommandInput } from "@/operationsTypes";

export default function WorkflowDetailPage() {
  const { workflowId = "" } = useParams();
  const query = useWorkflow(decodeURIComponent(workflowId));
  const client = useQueryClient();
  const [action, setAction] = useState<OperationsCommandInput["action"] | "">("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const mutation = useMutation({
    mutationFn: (input: OperationsCommandInput) => operationsApi.executeWorkflowAction(decodeURIComponent(workflowId), input),
    onSuccess: async () => { setAction(""); setReason(""); setConfirmation(""); await client.invalidateQueries({ queryKey: operationsKeys.all }); }
  });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Workflow introuvable"} retry={() => query.refetch()}/>;
  const { workflow, steps, events, allowedActions } = query.data;
  const expectedPhrase = action ? `CONFIRM_${action.toUpperCase()}` : "";
  const submit = () => action && mutation.mutate({ action, expectedRevision: workflow.revision, idempotencyKey: crypto.randomUUID(), confirmationPhrase: confirmation, reason });
  return <section className="view workspace-view">
    <WorkspaceNav/><Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: workflow.name }]}/>
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
      <div className="command-panel__form">
        <label>Action<select value={action} onChange={event => { setAction(event.target.value as typeof action); setConfirmation(""); }}><option value="">Sélectionner</option>{allowedActions.map(item => <option value={item} key={item}>{item}</option>)}</select></label>
        <label>Motif<input value={reason} onChange={event => setReason(event.target.value)} placeholder="Motif opérationnel"/></label>
        <label>Confirmation<input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={expectedPhrase || "Choisissez une action"}/></label>
        <button className="danger-btn" disabled={!action || reason.trim().length < 3 || confirmation !== expectedPhrase || mutation.isPending} onClick={submit}>{mutation.isPending ? "Application…" : "Confirmer"}</button>
      </div>{mutation.isError && <p className="form-error">{mutation.error.message}</p>}
    </Card>}
    <div className="content-grid content-grid--start">
      <Card className="workspace-panel"><h2>Étapes</h2>{!steps.length ? <p className="muted-copy">Ce workflow ne publie pas d’étapes détaillées.</p> : <ol className="step-list">{steps.map(step => <li key={step.id}><span>{step.sequence}</span><div><strong>{step.type}</strong><small>{formatDateTime(step.at)}</small></div><StatusTag status={step.status}/></li>)}</ol>}</Card>
      <Card className="workspace-panel"><h2>État canonique</h2><dl className="definition-grid"><dt>Stratégie</dt><dd>{workflow.strategyId || "—"}</dd><dt>Session</dt><dd>{workflow.session || "—"}</dd><dt>Date</dt><dd>{workflow.tradingDate || "—"}</dd><dt>Prochaine action</dt><dd>{workflow.nextAction || "—"}</dd><dt>Dernière mise à jour</dt><dd>{formatDateTime(workflow.updatedAt)}</dd></dl>{workflow.error && <div className="error-box"><strong>{workflow.error.code || "Erreur"}</strong><p>{workflow.error.message}</p></div>}</Card>
    </div>
    <div id="timeline-events"><h2>Événements</h2><EventTimeline events={events} runId={workflow.kind === "replay" ? workflow.sourceId : undefined} workflowId={workflow.id}/></div>
  </section>;
}
````

### `src/pages/WorkflowEventPage.tsx`

````tsx
import { useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, formatDateTime, PageHeading, StatusTag, WorkspaceNav } from "@/components/operations";
import { useWorkflow } from "@/hooks/useOperations";

export default function WorkflowEventPage() {
  const { workflowId = "", eventId = "" } = useParams();
  const id = decodeURIComponent(workflowId);
  const query = useWorkflow(id);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Événement introuvable"} retry={() => query.refetch()}/>;
  const event = query.data.events.find(item => item.id === decodeURIComponent(eventId));
  if (!event) return <ErrorView message="Cet événement n’existe plus dans la projection du workflow." retry={() => query.refetch()}/>;
  return <section className="view workspace-view"><WorkspaceNav/><Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: query.data.workflow.name, to: `/operations/workflows/${encodeURIComponent(id)}` }, { label: event.title }]}/><PageHeading eyebrow={event.type} title={event.title} subtitle={formatDateTime(event.at)} backTo={`/operations/workflows/${encodeURIComponent(id)}`} actions={<StatusTag status={event.status}/>}/><Card className="workspace-panel"><h2>Détail de la transition</h2><p className="conclusion-copy">{event.detail || "Aucun détail complémentaire."}</p><dl className="definition-grid"><dt>Identifiant</dt><dd>{event.id}</dd><dt>Type</dt><dd>{event.type}</dd><dt>Acteur</dt><dd>{event.actor ? JSON.stringify(event.actor) : "backend"}</dd><dt>Référence</dt><dd>{event.ref ? JSON.stringify(event.ref) : "—"}</dd></dl></Card><details className="raw-inspector"><summary>Événement projeté</summary><pre>{JSON.stringify(event, null, 2)}</pre></details></section>;
}
````

### `src/styles/globals.css`

````css
:root {
  --bg: #07100e;
  --bg-elevated: #0c1915;
  --surface: rgba(19, 36, 31, 0.94);
  --surface-2: rgba(25, 47, 40, 0.92);
  --surface-3: rgba(35, 61, 52, 0.78);
  --surface-soft: rgba(255, 255, 255, 0.052);
  --border: rgba(226, 255, 244, 0.12);
  --border-strong: rgba(226, 255, 244, 0.2);
  --text: #eef7f3;
  --muted: #a8bbb4;
  --muted-2: #7f948d;
  --accent: #69f0b4;
  --accent-strong: #2edb91;
  --accent-soft: rgba(105, 240, 180, 0.12);
  --positive: #6ef0a9;
  --positive-soft: rgba(110, 240, 169, 0.12);
  --warning: #f7c86c;
  --warning-soft: rgba(247, 200, 108, 0.12);
  --negative: #ff7f82;
  --negative-soft: rgba(255, 127, 130, 0.12);
  --info: #72b7ff;
  --info-soft: rgba(114, 183, 255, 0.12);
  --critical: #ff6f75;
  --shadow: 0 22px 60px rgba(0, 0, 0, 0.38);
  --radius-xl: 28px;
  --radius-lg: 22px;
  --radius-md: 16px;
  --radius-sm: 12px;
  --topbar-h: 68px;
  --bottom-nav-h: 78px;
  --max-width: 1180px;
  --ease: cubic-bezier(.2, .8, .2, 1);
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
html { background: var(--bg); scroll-behavior: smooth; }
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(circle at 8% -5%, rgba(51, 204, 142, 0.17), transparent 32%),
    radial-gradient(circle at 95% 18%, rgba(60, 132, 112, 0.13), transparent 28%),
    linear-gradient(180deg, #07110e 0%, #07100e 100%);
  color: var(--text);
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  overscroll-behavior-y: none;
}
button, input, select { font: inherit; }
button { color: inherit; }
button, [role="button"] { -webkit-tap-highlight-color: transparent; }
button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
svg { display: block; }
a { color: inherit; text-decoration: none; }

.app-shell { min-height: 100vh; }
.topbar {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 50;
  height: calc(var(--topbar-h) + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 16px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(180deg, rgba(7,16,14,.97) 0%, rgba(7,16,14,.88) 74%, rgba(7,16,14,0) 100%);
  backdrop-filter: blur(20px);
}
.topbar__brand, .topbar__actions { display: flex; align-items: center; gap: 11px; }
.topbar__menu { margin-left: -8px; }
.brand-name { font-size: 15px; font-weight: 760; letter-spacing: -0.02em; }
.brand-subtitle { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .12em; margin-top: 1px; }
.brand-mark { width: 29px; height: 29px; border-radius: 10px; display: flex; align-items: end; justify-content: center; gap: 3px; padding: 7px; background: linear-gradient(145deg, rgba(105,240,180,.2), rgba(105,240,180,.05)); border: 1px solid rgba(105,240,180,.26); box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }
.brand-mark span { width: 3px; border-radius: 999px; background: var(--accent); box-shadow: 0 0 8px rgba(105,240,180,.3); }
.brand-mark span:nth-child(1) { height: 8px; opacity: .65; }
.brand-mark span:nth-child(2) { height: 14px; }
.brand-mark span:nth-child(3) { height: 10px; opacity: .82; }
.brand-mark--large { width: 42px; height: 42px; border-radius: 14px; padding: 10px; }
.brand-mark--large span { width: 4px; }

.icon-btn {
  width: 40px; height: 40px; padding: 0; border: 0; border-radius: 13px;
  display: grid; place-items: center; background: transparent; cursor: pointer;
  transition: background .2s var(--ease), transform .2s var(--ease);
}
.icon-btn:active { transform: scale(.94); }
.icon-btn:hover { background: rgba(255,255,255,.05); }
.icon-btn svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.notification-btn { position: relative; background: rgba(255,255,255,.035); border: 1px solid var(--border); }
.notification-icon { display:grid; place-items:center; }
.notification-icon svg { width:20px; height:20px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.notification-dot { position: absolute; right: 8px; top: 7px; width: 7px; height: 7px; border-radius: 50%; background: var(--negative); border: 2px solid var(--bg); }

.app-main {
  width: 100%; max-width: var(--max-width); margin: 0 auto;
  min-height: 100vh;
  padding: calc(var(--topbar-h) + env(safe-area-inset-top) + 10px) 14px calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + 22px);
}
.view { display: grid; gap: 14px; animation: viewIn .35s var(--ease) both; }
@keyframes viewIn { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }

.eyebrow { margin: 0; color: var(--accent); font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .15em; }
.section-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 18px 2px 0; }
.view > .section-title:first-child { margin-top: 0; }
.section-title h2 { margin: 0; font-size: 18px; letter-spacing: -.02em; }
.section-title p { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
.section-title button { border: 0; background: transparent; color: var(--accent); font-size: 12px; padding: 8px 0; cursor: pointer; }

.card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: linear-gradient(150deg, rgba(22,39,34,.94), rgba(12,25,21,.94));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.035), 0 18px 45px rgba(0,0,0,.13);
}
.card--clickable { cursor: pointer; transition: transform .2s var(--ease), border-color .2s var(--ease), background .2s var(--ease); }
.card--clickable:active { transform: scale(.987); }
.card--clickable:hover { border-color: rgba(105,240,180,.23); }

.status-ribbon {
  display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding: 1px 1px 10px; margin-bottom: 2px;
}
.status-ribbon::-webkit-scrollbar, .market-strip::-webkit-scrollbar { display: none; }
.status-chip { flex: 0 0 auto; display: flex; align-items: center; gap: 7px; height: 32px; padding: 0 11px; border: 1px solid var(--border); background: rgba(255,255,255,.026); border-radius: 999px; color: var(--muted); font-size: 11px; }
.status-chip strong { color: var(--text); font-weight: 700; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); box-shadow: 0 0 0 3px rgba(255,255,255,.03); }
.status-dot--ready { background: var(--positive); box-shadow: 0 0 11px rgba(110,240,169,.42); }
.status-dot--warning { background: var(--warning); box-shadow: 0 0 11px rgba(247,200,108,.35); }
.status-dot--critical { background: var(--negative); box-shadow: 0 0 11px rgba(255,127,130,.38); }

.hero-card { position: relative; overflow: hidden; padding: 20px; border-radius: var(--radius-xl); min-height: 0; }
.hero-card::before { content: ""; position: absolute; width: 260px; height: 260px; right: -120px; top: -120px; border-radius: 50%; background: radial-gradient(circle, rgba(255,111,117,.15), transparent 68%); pointer-events: none; }
.hero-card[data-severity="warning"]::before { background: radial-gradient(circle, rgba(247,200,108,.13), transparent 68%); }
.hero-card__top { position: relative; display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.hero-card h1 { margin: 8px 0 7px; max-width: 650px; font-size: clamp(29px, 6.8vw, 41px); line-height: 1.02; letter-spacing: -.045em; }
.hero-card__decision { display: inline-flex; align-items: center; gap: 7px; color: var(--negative); font-size: 11px; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
.hero-card[data-severity="warning"] .hero-card__decision { color: var(--warning); }
.hero-card__summary { position: relative; margin: 16px 0 0; color: #d2dfda; font-size: 15px; line-height: 1.62; max-width: 700px; }
.hero-card__footer { position: relative; margin-top: 19px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.action-pill { display: inline-flex; align-items: center; min-height: 39px; border-radius: 12px; padding: 0 13px; background: var(--negative-soft); color: #ffb4b6; border: 1px solid rgba(255,127,130,.22); font-size: 11px; font-weight: 850; letter-spacing: .075em; }
.hero-card[data-severity="warning"] .action-pill { background: var(--warning-soft); color: #ffe0a0; border-color: rgba(247,200,108,.22); }
.text-btn { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--accent); font-size: 12px; font-weight: 700; padding: 8px 0; cursor: pointer; }
.text-btn svg { width: 15px; fill: none; stroke: currentColor; stroke-width: 2; }

.health-orb { --score: 50; flex: 0 0 auto; position: relative; width: 68px; height: 68px; display: grid; place-items: center; border-radius: 50%; background: conic-gradient(var(--orb-color, var(--warning)) calc(var(--score) * 1%), rgba(255,255,255,.07) 0); box-shadow: 0 0 34px rgba(0,0,0,.16); }
.health-orb::before { content: ""; position: absolute; inset: 5px; border-radius: 50%; background: #10201b; border: 1px solid rgba(255,255,255,.06); }
.health-orb__value { position: relative; font-size: 19px; font-weight: 820; line-height: 1; letter-spacing: -.04em; }
.health-orb__label { position: relative; margin-top: -2px; font-size: 8px; color: var(--muted); text-transform: uppercase; letter-spacing: .1em; }

.market-strip { display: flex; gap: 9px; overflow-x: auto; scrollbar-width: none; scroll-snap-type: x proximity; margin: 13px -14px 0; padding: 0 14px 5px; }
.market-card { min-width: 145px; scroll-snap-align: start; padding: 14px; border-radius: 17px; border: 1px solid var(--border); background: var(--surface); text-align: left; }
.market-card__top { display: flex; align-items: center; justify-content: space-between; }
.market-card__symbol { font-weight: 800; font-size: 12px; letter-spacing: .03em; }
.trend-mark { width: 19px; height: 19px; border-radius: 7px; display: grid; place-items: center; background: var(--surface-soft); }
.trend-mark svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.trend-mark--up { color: var(--positive); background: var(--positive-soft); }
.trend-mark--down { color: var(--negative); background: var(--negative-soft); }
.trend-mark--flat { color: var(--muted); }
.market-card__price { margin-top: 10px; font-size: 17px; font-weight: 760; letter-spacing: -.035em; }
.market-card__change { margin-top: 1px; font-size: 11px; font-weight: 700; }
.market-card__change.up { color: var(--positive); }
.market-card__change.down { color: var(--negative); }
.market-card__change.flat { color: var(--muted); }
.market-card__note { margin-top: 7px; color: var(--muted); font-size: 10px; white-space: nowrap; }

.brief-card { padding: 18px; }
.brief-card__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.brief-card h3 { margin: 5px 0 0; font-size: 18px; line-height: 1.18; letter-spacing: -.025em; }
.brief-card p { margin: 13px 0 0; color: #b9cbc4; line-height: 1.62; }
.brief-card__verdict { margin-top: 15px; padding-top: 13px; border-top: 1px solid var(--border); color: var(--accent); font-size: 12px; font-weight: 700; }
.card-icon { flex: 0 0 auto; width: 39px; height: 39px; border-radius: 13px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.card-icon svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

.delta-card { padding: 18px; }
.delta-list { display: grid; gap: 11px; margin-top: 15px; }
.delta-item { display: grid; grid-template-columns: 10px 1fr; gap: 10px; align-items: start; color: #bed0c9; font-size: 13px; }
.delta-item__dot { width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--muted); }
.delta-item[data-tone="negative"] .delta-item__dot { background: var(--negative); box-shadow: 0 0 10px rgba(255,127,130,.35); }
.delta-item[data-tone="warning"] .delta-item__dot { background: var(--warning); }
.delta-item[data-tone="positive"] .delta-item__dot { background: var(--positive); }
.delta-consequence { margin-top: 16px; padding: 12px 13px; border-radius: 13px; background: var(--negative-soft); color: #ffb9bb; font-size: 12px; font-weight: 760; text-align: center; }

.thesis-card { padding: 18px; }
.thesis-card__top { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.thesis-card__instrument { display: flex; align-items: center; gap: 10px; }
.instrument-badge { width: 43px; height: 43px; border-radius: 14px; display: grid; place-items: center; background: linear-gradient(145deg, rgba(105,240,180,.16), rgba(105,240,180,.05)); color: var(--accent); border: 1px solid rgba(105,240,180,.18); font-weight: 850; font-size: 12px; }
.thesis-card h3 { margin: 0; font-size: 17px; }
.thesis-card__subtitle { color: var(--muted); font-size: 11px; margin-top: 2px; }
.status-badge { display: inline-flex; align-items: center; min-height: 28px; padding: 0 10px; border-radius: 999px; font-size: 10px; font-weight: 850; letter-spacing: .055em; border: 1px solid var(--border); background: rgba(255,255,255,.045); white-space: nowrap; }
.status-badge--critical { color: #ffb4b7; background: var(--negative-soft); border-color: rgba(255,127,130,.18); }
.status-badge--warning { color: #ffe0a1; background: var(--warning-soft); border-color: rgba(247,200,108,.18); }
.status-badge--positive { color: #aff8d0; background: var(--positive-soft); border-color: rgba(110,240,169,.18); }
.status-badge--info { color: #b8d9ff; background: var(--info-soft); border-color: rgba(114,183,255,.2); }
.status-badge--muted { color: var(--muted); background: var(--surface-soft); }
.thesis-card__scenario { margin-top: 16px; color: #c3d3cd; line-height: 1.62; }
.thesis-card__metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-top: 16px; }
.thesis-card__metrics > div { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 3px 10px; padding: 12px 13px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-soft); }
.thesis-card__metrics span { color: var(--muted); font-size: 11px; font-weight: 700; }
.thesis-card__metrics strong { font-size: 20px; line-height: 1; letter-spacing: -.04em; }
.thesis-card__metrics small { grid-column: 1 / -1; color: var(--muted-2); font-size: 10px; }
.thesis-card__focus { margin-top: 10px; padding: 12px 13px; border-left: 3px solid var(--warning); border-radius: 4px 13px 13px 4px; background: var(--warning-soft); }
.thesis-card__focus span { color: var(--warning); font-size: 10px; font-weight: 850; letter-spacing: .07em; text-transform: uppercase; }
.thesis-card__focus p { margin: 5px 0 0; color: #f0ddba; font-size: 12px; line-height: 1.5; }
.setup-card { overflow: hidden; }
.setup-card__header { padding: 17px 18px 14px; display: flex; justify-content: space-between; gap: 12px; }
.setup-card__header h3 { margin: 5px 0 0; font-size: 17px; line-height: 1.2; }
.setup-card__body { padding: 0 18px 17px; }
.price-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.price-box { padding: 12px; border-radius: 13px; background: rgba(255,255,255,.028); border: 1px solid rgba(255,255,255,.05); }
.price-box span { display: block; color: var(--muted); font-size: 9px; text-transform: uppercase; letter-spacing: .08em; }
.price-box strong { display: block; margin-top: 3px; font-size: 14px; letter-spacing: -.025em; }
.setup-card__reason { margin-top: 13px; padding: 12px 13px; border-radius: 13px; color: #f3bdbe; background: var(--negative-soft); font-size: 12px; }
.setup-card__footer { display: flex; justify-content: space-between; align-items: center; padding: 13px 18px; background: rgba(0,0,0,.14); border-top: 1px solid var(--border); color: var(--muted); font-size: 11px; }

.activity-card { padding: 18px; }
.activity-list { display: grid; gap: 0; margin-top: 13px; }
.activity-item { display: grid; grid-template-columns: 44px 17px 1fr; gap: 9px; min-height: 59px; }
.activity-time { color: var(--muted); font-size: 10px; padding-top: 3px; }
.activity-line { position: relative; display: flex; justify-content: center; }
.activity-line::before { content: ""; position: absolute; top: 12px; bottom: -4px; width: 1px; background: var(--border); }
.activity-item:last-child .activity-line::before { display: none; }
.activity-dot { position: relative; z-index: 1; width: 9px; height: 9px; margin-top: 5px; border-radius: 50%; background: var(--positive); box-shadow: 0 0 0 4px #12221d; }
.activity-item[data-state="scheduled"] .activity-dot { background: var(--warning); }
.activity-label { font-size: 12px; font-weight: 700; }
.activity-detail { color: var(--muted); font-size: 11px; margin-top: 2px; }

.timeline { position: relative; padding-left: 7px; }
.timeline::before { content: ""; position: absolute; left: 23px; top: 15px; bottom: 20px; width: 1px; background: linear-gradient(var(--border-strong), var(--border)); }
.timeline-item { position: relative; display: grid; grid-template-columns: 46px 1fr; gap: 10px; padding-bottom: 13px; }
.timeline-item__time { color: var(--muted); font-size: 11px; padding-top: 17px; text-align: right; padding-right: 8px; }
.timeline-item__content { position: relative; padding: 14px 15px; border-radius: 16px; border: 1px solid var(--border); background: rgba(255,255,255,.027); cursor: pointer; }
.timeline-item__content::before { content: ""; position: absolute; left: -20px; top: 18px; width: 9px; height: 9px; border-radius: 50%; background: var(--muted); box-shadow: 0 0 0 5px var(--bg); }
.timeline-item[data-type="master"] .timeline-item__content::before { background: var(--info); }
.timeline-item[data-type="monitor"] .timeline-item__content::before { background: var(--warning); }
.timeline-item[data-status="critical"] .timeline-item__content::before { background: var(--negative); }
.timeline-item[data-status="positive"] .timeline-item__content::before { background: var(--positive); }
.empty-state { padding: 28px; text-align: center; }
.empty-state__icon { width: 48px; height: 48px; margin: 0 auto 12px; border-radius: 16px; display: grid; place-items: center; background: var(--negative-soft); color: var(--negative); }
.empty-state h3 { margin: 14px 0 5px; }
.empty-state p { margin: 0; color: var(--muted); font-size: 12px; }

.primary-btn, .secondary-btn, .danger-btn { min-height: 43px; border-radius: 13px; padding: 0 15px; font-size: 12px; font-weight: 760; cursor: pointer; border: 1px solid transparent; }
.primary-btn { display: inline-flex; align-items: center; justify-content: center; background: var(--accent); color: #042117; box-shadow: 0 10px 25px rgba(46,219,145,.14); }
.secondary-btn { background: rgba(255,255,255,.045); color: var(--text); border-color: var(--border); }
.danger-btn { background: var(--negative); color: #2d0507; }
.bottom-nav {
  position: fixed; z-index: 55; inset: auto 0 0 0;
  height: calc(var(--bottom-nav-h) + env(safe-area-inset-bottom));
  padding: 7px 7px env(safe-area-inset-bottom);
  display: grid; grid-template-columns: repeat(5, 1fr);
  background: rgba(8,18,15,.93); border-top: 1px solid var(--border); backdrop-filter: blur(22px);
}
.bottom-nav__item { position: relative; border: 0; background: transparent; color: var(--muted); border-radius: 15px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font-size: 10px; font-weight: 700; cursor: pointer; }
.bottom-nav__item::before { content: ""; position: absolute; top: 4px; width: 36px; height: 28px; border-radius: 11px; background: transparent; transition: background .2s var(--ease); }
.bottom-nav__item.active { color: var(--accent); }
.bottom-nav__item.active::before { background: var(--accent-soft); }
.nav-icon { position: relative; z-index: 1; width: 21px; height: 21px; display: grid; place-items: center; }
.nav-icon svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.bottom-nav__item span:last-child { position: relative; z-index: 1; }

.side-menu { position: fixed; z-index: 80; inset: 0 auto 0 0; width: min(86vw, 360px); padding: calc(16px + env(safe-area-inset-top)) 14px calc(16px + env(safe-area-inset-bottom)); background: #0b1714; border-right: 1px solid var(--border); box-shadow: var(--shadow); transform: translateX(-105%); transition: transform .3s var(--ease); display: flex; flex-direction: column; }
.side-menu.open { transform: translateX(0); }
.side-menu__header { display: grid; grid-template-columns: 42px 1fr 40px; gap: 11px; align-items: center; }
.side-menu__header strong { display: block; font-size: 15px; }
.side-menu__header small { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }
.side-menu__context { margin: 18px 0 10px; padding: 13px; border-radius: 15px; background: var(--surface-soft); border: 1px solid var(--border); }
.side-menu__nav svg { width: 19px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

.scrim { position: fixed; z-index: 78; inset: 0; border: 0; background: rgba(0,0,0,.58); backdrop-filter: blur(3px); opacity: 0; visibility: hidden; pointer-events: none; transition: opacity .25s var(--ease), visibility 0s linear .25s; }
.scrim.open { opacity: 1; visibility: visible; pointer-events: auto; transition-delay: 0s; }
.drawer { position: fixed; z-index: 82; inset: auto 0 0 0; max-height: min(88vh, 820px); background: #0c1815; border-radius: 25px 25px 0 0; border: 1px solid var(--border-strong); border-bottom: 0; box-shadow: var(--shadow); transform: translateY(105%); visibility: hidden; pointer-events: none; transition: transform .34s var(--ease), visibility 0s linear .34s; padding-bottom: env(safe-area-inset-bottom); }
.drawer.open { transform: translateY(0); visibility: visible; pointer-events: auto; transition-delay: 0s; }
.drawer__grab { width: 42px; height: 4px; margin: 9px auto 1px; border-radius: 99px; background: rgba(255,255,255,.16); }
.drawer__header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding: 14px 17px 13px; border-bottom: 1px solid var(--border); }
.drawer__header h2 { margin: 3px 0 0; font-size: 21px; line-height: 1.12; letter-spacing: -.035em; }
.drawer__content { max-height: calc(88vh - 100px); overflow-y: auto; padding: 16px 17px 28px; }
.drawer-section + .drawer-section { margin-top: 21px; padding-top: 18px; border-top: 1px solid var(--border); }
.drawer-section h3 { margin: 0 0 8px; font-size: 13px; }
.drawer-section p { margin: 0; color: #bdcec7; font-size: 12px; line-height: 1.65; }
.drawer-section ul { margin: 10px 0 0; padding-left: 17px; color: #bdcec7; font-size: 12px; }
.drawer-section li + li { margin-top: 7px; }

.modal { position: fixed; z-index: 85; inset: 0; padding: 22px; display: grid; place-items: center; pointer-events: none; opacity: 0; transition: opacity .25s var(--ease); }
.modal.open { pointer-events: auto; opacity: 1; }
.modal__card { position: relative; width: min(100%, 440px); padding: 25px 20px 20px; border-radius: 24px; background: #10201b; border: 1px solid var(--border-strong); box-shadow: var(--shadow); transform: translateY(14px) scale(.98); transition: transform .25s var(--ease); }
.modal.open .modal__card { transform: none; }
.modal__close { position: absolute; right: 8px; top: 8px; }
.modal__icon { width: 50px; height: 50px; border-radius: 17px; display: grid; place-items: center; margin-bottom: 15px; background: var(--negative-soft); color: var(--negative); }
.modal__icon svg { width: 24px; fill: none; stroke: currentColor; stroke-width: 1.8; }
.modal h2 { margin: 5px 0 10px; font-size: 23px; line-height: 1.08; letter-spacing: -.04em; }
.modal__card p { color: #bdcec7; font-size: 12px; line-height: 1.65; }
.modal__actions { display: grid; gap: 8px; margin-top: 19px; }

.skeleton { position: relative; overflow: hidden; background: rgba(255,255,255,.035); border-radius: 10px; min-height: 16px; }
.skeleton::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgba(255,255,255,.06), transparent); animation: shimmer 1.3s infinite; }
@keyframes shimmer { to { transform: translateX(100%); } }
.loading-view { display: grid; gap: 12px; }
.loading-hero { height: 280px; border-radius: var(--radius-xl); }
.loading-row { height: 145px; border-radius: var(--radius-lg); }

@media (min-width: 680px) {
  .app-main { padding-left: 24px; padding-right: 24px; }
  .market-strip { margin-left: 0; margin-right: 0; padding-left: 0; padding-right: 0; }
  .hero-card { padding: 28px; }
  .brief-card, .delta-card, .thesis-card, .activity-card { padding: 21px; }
  .price-grid { grid-template-columns: repeat(4, 1fr); }
  .drawer { width: min(540px, 100vw); left: auto; top: 0; max-height: none; border-radius: 25px 0 0 25px; border-bottom: 1px solid var(--border); transform: translateX(105%); }
  .drawer.open { transform: translateX(0); }
  .drawer__grab { display: none; }
  .drawer__content { max-height: calc(100vh - 82px); }
  .modal__actions { grid-template-columns: 1fr 1fr; }
}

/* Operations, Replay Lab and versioned workspaces */
.workspace-view { gap: 17px; }
.workspace-nav { display: flex; gap: 7px; overflow-x: auto; scrollbar-width: none; margin: 0 -14px; padding: 0 14px 4px; }
.workspace-nav::-webkit-scrollbar { display: none; }
.workspace-nav a { flex: 0 0 auto; padding: 9px 13px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 11px; font-weight: 750; background: rgba(255,255,255,.025); }
.workspace-nav a.active { color: var(--accent); border-color: rgba(105,240,180,.28); background: var(--accent-soft); }
.breadcrumbs { display: flex; align-items: center; gap: 3px; min-width: 0; color: var(--muted); font-size: 11px; overflow-x: auto; white-space: nowrap; }
.breadcrumbs > span { display: inline-flex; align-items: center; gap: 3px; }
.breadcrumbs a:hover { color: var(--accent); }
.breadcrumbs strong { color: var(--text); }
.workspace-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.workspace-heading__main { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.workspace-heading h1 { margin: 4px 0 0; font-size: clamp(25px, 6vw, 42px); line-height: 1.05; letter-spacing: -.04em; overflow-wrap: anywhere; }
.workspace-heading p:not(.eyebrow) { margin: 7px 0 0; color: var(--muted); max-width: 720px; }
.workspace-heading__actions, .inline-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.back-btn { flex: 0 0 auto; width: 38px; height: 38px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-soft); display: grid; place-items: center; cursor: pointer; transform: rotate(180deg); }
.primary-btn, .secondary-btn, .danger-btn { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; border-radius: 11px; padding: 0 13px; cursor: pointer; font-weight: 780; font-size: 11px; border: 1px solid transparent; }
.primary-btn { color: #052117; background: var(--accent); }
.secondary-btn { color: var(--text); background: var(--surface-soft); border-color: var(--border); }
.danger-btn { color: #ffd2d3; background: var(--negative-soft); border-color: rgba(255,127,130,.28); }
.primary-btn:disabled, .secondary-btn:disabled, .danger-btn:disabled { opacity: .42; cursor: not-allowed; }
.metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.metric-card { padding: 15px; min-height: 100px; display: flex; flex-direction: column; justify-content: space-between; }
.metric-card > span { color: var(--muted); font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
.metric-card > strong { margin-top: 8px; font-size: clamp(24px, 6vw, 34px); line-height: 1; letter-spacing: -.045em; }
.metric-card > small { margin-top: 8px; color: var(--muted-2); }
.metric-card--info { border-color: rgba(114,183,255,.25); }
.metric-card--warning { border-color: rgba(247,200,108,.25); }
.metric-card--critical { border-color: rgba(255,127,130,.27); }
.metric-card--positive { border-color: rgba(110,240,169,.24); }
.workspace-toolbar { display: flex; flex-wrap: wrap; align-items: end; gap: 9px; padding: 12px; border: 1px solid var(--border); border-radius: 16px; background: rgba(255,255,255,.022); }
.workspace-toolbar label, .command-panel__form label { display: grid; gap: 4px; color: var(--muted); font-size: 9px; font-weight: 780; text-transform: uppercase; letter-spacing: .08em; }
.workspace-toolbar input, .workspace-toolbar select, .command-panel input, .command-panel select { min-height: 38px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-elevated); color: var(--text); padding: 0 10px; font-size: 12px; text-transform: none; letter-spacing: 0; outline: none; }
.replay-create-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); align-items: end; gap: 8px; }
.replay-create-form label { display: grid; gap: 4px; color: var(--muted); font-size: 9px; font-weight: 780; text-transform: uppercase; letter-spacing: .08em; }
.replay-create-form input, .replay-create-form select { min-height: 38px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-elevated); color: var(--text); padding: 0 10px; font-size: 12px; text-transform: none; letter-spacing: 0; }
.workspace-toolbar input:focus, .workspace-toolbar select:focus, .command-panel input:focus, .command-panel select:focus { border-color: var(--accent); }
.data-table-wrap { width: 100%; overflow-x: auto; border: 1px solid var(--border); border-radius: 16px; background: rgba(10,24,20,.78); }
.data-table { width: 100%; min-width: 790px; border-collapse: collapse; }
.data-table th { padding: 11px 13px; color: var(--muted-2); font-size: 9px; text-transform: uppercase; letter-spacing: .09em; text-align: left; background: rgba(255,255,255,.025); }
.data-table td { padding: 12px 13px; border-top: 1px solid var(--border); vertical-align: middle; font-size: 12px; }
.data-table td > strong, .data-table td > small { display: block; }
.data-table td > small { color: var(--muted-2); margin-top: 3px; max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
.data-table tbody tr:hover { background: rgba(105,240,180,.025); }
.row-link { display: inline-flex; align-items: center; gap: 5px; color: var(--accent); font-size: 11px; font-weight: 750; white-space: nowrap; }
.progress-line { min-width: 110px; height: 22px; position: relative; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,.05); }
.progress-line i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, rgba(105,240,180,.42), var(--accent)); }
.progress-line span { position: absolute; inset: 0 7px 0 auto; display: flex; align-items: center; font-size: 8px; font-weight: 800; text-shadow: 0 1px 2px #000; }
.workspace-empty { min-height: 190px; display: grid; place-items: center; align-content: center; text-align: center; padding: 28px; color: var(--muted); }
.workspace-empty svg { color: var(--accent); }
.workspace-empty h3 { margin: 12px 0 0; color: var(--text); }
.workspace-empty p { margin: 7px auto 0; max-width: 520px; }
.workspace-panel { padding: 17px; min-width: 0; }
.workspace-panel > h2, .panel-heading h2, .command-panel h2, .decision-chart h2 { margin: 3px 0 14px; font-size: 17px; }
.muted-copy { color: var(--muted); }
.definition-grid { display: grid; grid-template-columns: minmax(85px, .55fr) 1fr; gap: 8px 12px; margin: 0; }
.definition-grid dt { color: var(--muted); font-size: 10px; }
.definition-grid dd { margin: 0; overflow-wrap: anywhere; font-size: 11px; font-weight: 700; }
.step-list { list-style: none; padding: 0; margin: 0; display: grid; }
.step-list li { display: grid; grid-template-columns: 30px 1fr auto; align-items: center; gap: 9px; padding: 10px 0; border-top: 1px solid var(--border); }
.step-list li:first-child { border-top: 0; }
.step-list li > span { width: 27px; height: 27px; display: grid; place-items: center; border-radius: 9px; background: var(--surface-soft); color: var(--accent); font-size: 10px; font-weight: 800; }
.step-list small { display: block; color: var(--muted); margin-top: 2px; }
.command-panel { padding: 17px; display: grid; gap: 16px; border-color: rgba(247,200,108,.22); }
.command-panel p { margin: 4px 0 0; color: var(--muted); }
.command-panel__form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; gap: 8px; align-items: end; }
.form-error { color: var(--negative)!important; }
.error-box { padding: 13px; border: 1px solid rgba(255,127,130,.25); border-radius: 13px; background: var(--negative-soft); }
.error-box strong { color: #ffc1c3; }
.error-box p { margin: 4px 0 0; color: #efb7b9; }
.event-timeline { list-style: none; padding: 0; margin: 0; display: grid; }
.event-timeline li { display: grid; grid-template-columns: 112px 17px 1fr; gap: 9px; min-height: 76px; }
.event-timeline time { padding-top: 14px; color: var(--muted); font-size: 9px; text-align: right; }
.event-timeline li > i { position: relative; }
.event-timeline li > i::before { content: ""; position: absolute; left: 8px; top: 0; bottom: 0; width: 1px; background: var(--border-strong); }
.event-timeline li > i::after { content: ""; position: absolute; left: 4px; top: 17px; width: 9px; height: 9px; border-radius: 50%; background: var(--info); border: 2px solid var(--bg-elevated); }
.event-timeline li[data-layer="gpt"] > i::after { background: #b58aff; }
.event-timeline li[data-layer="decision"] > i::after { background: var(--accent); }
.event-timeline li > div { margin: 4px 0 10px; padding: 12px; border: 1px solid var(--border); border-radius: 13px; background: var(--surface); }
.event-timeline__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.event-timeline p { margin: 6px 0 0; color: var(--muted); font-size: 11px; }
.event-timeline a { margin-top: 7px; display: inline-flex; align-items: center; gap: 4px; color: var(--accent); font-size: 10px; }
.replay-day-grid, .strategy-grid, .breakdown-grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
.replay-day-card { padding: 17px; }
.replay-day-card > header, .strategy-card > header { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
.replay-day-card h2, .strategy-card h2 { margin: 3px 0 0; }
.replay-day-card__metrics { margin: 15px 0 10px; display: flex; gap: 17px; color: var(--muted); font-size: 10px; }
.replay-day-card__metrics strong { color: var(--text); }
.session-preview-list { display: grid; margin: 13px 0; }
.session-preview-list a { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 0; border-top: 1px solid var(--border); font-size: 11px; }
.tag-list { display: flex; flex-wrap: wrap; gap: 7px; }
.tag-list span { padding: 7px 10px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 10px; }
.decision-chart { padding: 16px; overflow: hidden; }
.decision-chart > header { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
.chart-controls { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.chart-controls label { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 9px; }
.chart-controls input { width: 80px; accent-color: var(--accent); }
.chart-controls button { border: 1px solid var(--border); border-radius: 999px; padding: 5px 8px; background: transparent; color: var(--muted); cursor: pointer; font-size: 9px; }
.chart-controls button.active { color: var(--accent); border-color: rgba(105,240,180,.3); background: var(--accent-soft); }
.chart-scroll { overflow-x: auto; margin: 8px -8px 0; }
.chart-scroll svg { min-width: 720px; width: 100%; height: auto; }
.chart-grid { stroke: rgba(255,255,255,.07); stroke-width: 1; }
.price-line { fill: none; stroke: var(--accent); stroke-width: 2.5; vector-effect: non-scaling-stroke; }
.chart-marker line { stroke: currentColor; stroke-dasharray: 4 6; opacity: .45; }
.chart-marker circle { fill: var(--bg-elevated); stroke: currentColor; stroke-width: 4; }
.chart-marker--gpt { color: #b58aff; }
.chart-marker--decision { color: var(--accent); }
.chart-marker--step { color: var(--info); }
.chart-scroll text { fill: var(--muted); font-size: 14px; }
.chart-empty { min-height: 150px; display: grid; place-items: center; text-align: center; color: var(--muted); padding: 20px; border: 1px dashed var(--border); border-radius: 13px; }
.chart-event-strip { display: flex; gap: 7px; overflow-x: auto; padding: 8px 0 2px; }
.chart-event-strip a { flex: 0 0 145px; display: grid; grid-template-columns: 8px 1fr; gap: 2px 6px; padding: 8px; border: 1px solid var(--border); border-radius: 10px; }
.chart-event-strip i { grid-row: 1 / 3; width: 6px; border-radius: 999px; background: var(--info); }
.chart-event-strip i[data-layer="gpt"] { background: #b58aff; }
.chart-event-strip i[data-layer="decision"] { background: var(--accent); }
.chart-event-strip span { color: var(--muted); font-size: 8px; }
.chart-event-strip strong { font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gpt-row, .conclusion-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid var(--border); }
.gpt-row:first-of-type, .conclusion-item:first-of-type { border-top: 0; }
.gpt-row small { display: block; margin-top: 3px; color: var(--muted); font-size: 9px; }
.conclusion-item strong { font-size: 11px; line-height: 1.4; }
.conclusion-item span { flex: 0 0 auto; color: var(--accent); font-size: 9px; }
.conclusion-copy { color: #cad8d3; font-size: 14px; line-height: 1.65; }
.workspace-panel blockquote { margin: 8px 0; padding: 10px 12px; border-left: 3px solid var(--accent); background: var(--accent-soft); color: #d0e4dc; }
.raw-inspector, .history-session { border: 1px solid var(--border); border-radius: 14px; background: var(--surface); overflow: hidden; }
.raw-inspector summary, .history-session summary { padding: 13px 15px; cursor: pointer; font-weight: 750; }
.raw-inspector pre { margin: 0; padding: 14px; border-top: 1px solid var(--border); background: rgba(0,0,0,.22); max-height: 420px; overflow: auto; color: #b9d7cc; font: 10px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.incident-list { display: grid; gap: 8px; }
.incident-card { padding: 14px; display: flex; align-items: start; justify-content: space-between; gap: 14px; }
.incident-card__title { display: flex; gap: 9px; align-items: start; }
.incident-card__title i { width: 8px; height: 8px; margin-top: 5px; border-radius: 50%; background: var(--warning); }
.incident-card__title i[data-severity="critical"] { background: var(--negative); box-shadow: 0 0 12px rgba(255,127,130,.45); }
.incident-card small { display: block; color: var(--muted); margin-top: 2px; }
.incident-card p { margin: 7px 0 0 17px; color: var(--muted); font-size: 11px; }
.incident-card > div:last-child { display: flex; align-items: center; gap: 8px; }
.breakdown-list, .version-list { display: grid; }
.breakdown-list > div, .version-list > div { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 9px 0; border-top: 1px solid var(--border); }
.breakdown-list small, .version-list small { grid-column: 1 / -1; color: var(--muted); }
.comparison-picker { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 7px; }
.comparison-picker label { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 12px; cursor: pointer; }
.comparison-picker label.selected { border-color: rgba(105,240,180,.35); background: var(--accent-soft); }
.comparison-picker input { accent-color: var(--accent); }
.comparison-picker small { display: block; color: var(--muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; }
.history-session { padding: 13px 15px; display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px; }
.history-session > summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.history-session span { display: block; color: var(--muted); margin-top: 2px; font-size: 10px; }
.history-session > .data-table-wrap { border-width: 1px 0 0; border-radius: 0; }
.strategy-card { padding: 16px; cursor: pointer; }
.strategy-card.selected { border-color: rgba(105,240,180,.35); }
.strategy-card header > span { color: var(--muted); font-size: 10px; }

@media (min-width: 760px) {
  .metric-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .metric-grid--compact { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .replay-day-grid, .strategy-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .breakdown-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .command-panel { grid-template-columns: .65fr 1.35fr; align-items: end; }
}

@media (max-width: 680px) {
  .workspace-heading { align-items: flex-start; flex-direction: column; }
  .workspace-heading__actions { width: 100%; }
  .command-panel__form { grid-template-columns: 1fr; }
  .event-timeline li { grid-template-columns: 53px 15px 1fr; gap: 6px; }
  .event-timeline time { font-size: 8px; }
  .incident-card { flex-direction: column; }
  .incident-card > div:last-child { width: 100%; justify-content: space-between; }
  .decision-chart > header { flex-direction: column; }
  .chart-controls { justify-content: flex-start; }
}

/* Performance calendar */
.performance-view { max-width: 1180px; }
.performance-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin: 16px 0; }
.performance-month-nav { display: flex; align-items: center; gap: 10px; }
.performance-month-nav strong { min-width: 170px; color: var(--text); font-size: 15px; text-align: center; text-transform: capitalize; }
.performance-prev svg { transform: rotate(180deg); }
.performance-pricing { display: flex; gap: 3px; padding: 3px; border: 1px solid var(--border); border-radius: 11px; background: rgba(255,255,255,.025); }
.performance-pricing button { min-height: 30px; padding: 0 11px; border: 0; border-radius: 8px; color: var(--muted); font: inherit; font-size: 10px; font-weight: 750; background: transparent; cursor: pointer; }
.performance-pricing button.active { color: var(--text); background: rgba(69,211,159,.13); box-shadow: inset 0 0 0 1px rgba(69,211,159,.2); }
.performance-summary-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 10px; margin-bottom: 12px; }
.performance-kpi { display: grid; align-content: center; min-height: 96px; padding: 14px 16px; }
.performance-kpi > span { color: var(--muted); font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.performance-kpi > strong { margin: 5px 0 3px; color: var(--text); font-size: clamp(20px,3vw,28px); line-height: 1; }
.performance-kpi > small { color: var(--muted-2); font-size: 9px; }
.performance-kpi--positive > strong { color: var(--positive); }
.performance-kpi--negative > strong { color: var(--negative); }
.performance-calendar-card { padding: 15px; overflow: hidden; }
.performance-weekdays, .performance-calendar-grid { display: grid; grid-template-columns: repeat(7,minmax(0,1fr)); gap: 7px; }
.performance-weekdays { margin-bottom: 7px; }
.performance-weekdays span { padding: 5px; color: var(--muted); font-size: 9px; font-weight: 850; text-align: center; text-transform: uppercase; }
.performance-day { position: relative; display: grid; align-content: space-between; min-width: 0; min-height: 98px; padding: 9px; overflow: hidden; border: 1px solid rgba(255,255,255,.06); border-radius: 11px; color: var(--text); text-align: left; background: rgba(255,255,255,.025); cursor: pointer; transition: border-color .15s ease, transform .15s ease, background .15s ease; }
.performance-day:hover { z-index: 1; border-color: rgba(69,211,159,.45); transform: translateY(-1px); }
.performance-day__number { width: 23px; height: 23px; display: grid; place-items: center; border-radius: 7px; color: var(--muted); font-size: 10px; font-weight: 800; }
.performance-day strong { margin-top: 12px; font-size: 16px; letter-spacing: -.02em; }
.performance-day small { margin-top: 4px; overflow: hidden; color: var(--muted-2); font-size: 8px; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
.performance-day--positive.has-activity { border-color: rgba(69,211,159,.22); background: linear-gradient(145deg,rgba(69,211,159,.13),rgba(69,211,159,.025)); }
.performance-day--positive.has-activity strong { color: var(--positive); }
.performance-day--negative.has-activity { border-color: rgba(255,100,114,.23); background: linear-gradient(145deg,rgba(255,100,114,.13),rgba(255,100,114,.025)); }
.performance-day--negative.has-activity strong { color: var(--negative); }
.performance-day--flat.has-activity strong { color: var(--warning); }
.performance-day.is-empty { opacity: .58; }
.performance-day.is-today .performance-day__number { color: #06130e; background: var(--positive); }
.performance-day-placeholder { min-height: 98px; }
.performance-legend { display: flex; justify-content: flex-end; gap: 15px; margin-top: 12px; color: var(--muted); font-size: 9px; }
.performance-legend span { display: flex; align-items: center; gap: 5px; }
.performance-legend i { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
.performance-legend i.positive { background: var(--positive); }.performance-legend i.negative { background: var(--negative); }
.performance-loading, .performance-error { min-height: 180px; padding: 22px; display: flex; align-items: center; justify-content: center; gap: 12px; color: var(--muted); }
.performance-error p { margin: 4px 0 0; font-size: 10px; }
.performance-day-loading { min-height: 200px; display: grid; place-content: center; gap: 10px; color: var(--muted); text-align: center; }
.performance-day-zoom { display: grid; gap: 12px; }
.performance-day-result { display: grid; padding: 18px; border: 1px solid var(--border); border-radius: 15px; background: rgba(255,255,255,.025); }
.performance-day-result span, .performance-day-stats span { color: var(--muted); font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }
.performance-day-result strong { margin: 5px 0; font-size: 34px; line-height: 1; }
.performance-day-result small { color: var(--muted-2); font-size: 9px; }
.performance-day-result--positive strong, .r-positive { color: var(--positive)!important; }
.performance-day-result--negative strong, .r-negative { color: var(--negative)!important; }
.performance-day-stats { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 6px; }
.performance-day-stats > div { display: grid; gap: 4px; padding: 10px; border-radius: 10px; background: rgba(255,255,255,.035); }
.performance-day-stats strong { font-size: 14px; }
.performance-detail-section { padding: 14px; border: 1px solid var(--border); border-radius: 13px; background: rgba(255,255,255,.018); }
.performance-detail-section h3 { margin: 4px 0 7px; font-size: 15px; }
.performance-detail-section > p:last-child { color: var(--muted); font-size: 10px; line-height: 1.5; }
.performance-trades { display: grid; gap: 6px; margin-top: 9px; }
.performance-trade { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px; border-radius: 9px; background: rgba(255,255,255,.035); }
.performance-trade > div { display: grid; gap: 2px; }.performance-trade strong { font-size: 11px; }.performance-trade span { color: var(--muted); font-size: 9px; }
.performance-empty-detail { margin-top: 8px; }
.performance-day-timeline { display: grid; gap: 8px; margin-top: 10px; }
.performance-day-timeline > div { display: grid; grid-template-columns: 38px 1fr; gap: 9px; }
.performance-day-timeline time { color: var(--positive); font-size: 9px; }.performance-day-timeline span { display: grid; color: var(--muted); font-size: 9px; }.performance-day-timeline strong { color: var(--text); font-size: 10px; }

@media (max-width: 760px) {
  .performance-toolbar { align-items: stretch; flex-direction: column; }
  .performance-month-nav { justify-content: space-between; }
  .performance-pricing { display: grid; grid-template-columns: repeat(3,1fr); }
  .performance-summary-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .performance-calendar-card { padding: 9px; }
  .performance-weekdays, .performance-calendar-grid { gap: 3px; }
  .performance-day, .performance-day-placeholder { min-height: 69px; }
  .performance-day { padding: 5px; border-radius: 8px; }
  .performance-day__number { width: 18px; height: 18px; font-size: 8px; }
  .performance-day strong { margin-top: 6px; font-size: 10px; }
  .performance-day small { font-size: 6px; }
  .performance-legend { justify-content: flex-start; flex-wrap: wrap; }
}

@media (min-width: 1000px) {
  :root { --bottom-nav-h: 0px; }
  .topbar { left: 238px; padding-left: 28px; padding-right: 28px; }
  .topbar__menu { display: none; }
  .app-main { margin-left: 238px; width: calc(100% - 238px); padding-bottom: 42px; }
  .bottom-nav { display: none; }
  .side-menu { transform: none; width: 238px; box-shadow: none; border-right: 1px solid var(--border); }
  .side-menu .icon-btn { display: none; }
  .side-menu__context { margin-top: 26px; }
  .hero-card { min-height: 0; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}

/* React application additions */
.brand-button {
  display: flex; align-items: center; gap: 10px; color: inherit; min-width: 0;
  padding: 0; border: 0; background: transparent; text-align: left; cursor: pointer;
}
.brand-button > span:last-child { display: grid; min-width: 0; }
.brand-name, .brand-subtitle { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 390px) {
  .topbar { padding-left: 10px; padding-right: 10px; }
  .topbar__brand { min-width: 0; flex: 1; gap: 5px; }
  .topbar__actions { flex: 0 0 auto; gap: 6px; }
  .brand-button { flex: 1; gap: 7px; overflow: hidden; }
  .brand-name { font-size: 13px; }
  .brand-subtitle { display: none; }
  .brand-mark { width: 27px; height: 27px; padding: 6px; border-radius: 9px; }
  .notification-btn { width: 36px; height: 36px; }
}
.side-menu__header > span { display: grid; gap: 2px; flex: 1; }
.side-menu__header small { color: var(--muted); }
.side-session-label { display: block; margin: 3px 0 8px; }
.side-session-status { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 12px; }
.session-segment { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 12px 16px; padding: 4px; border-radius: 14px; background: var(--surface-soft); }
.session-segment span { padding: 9px 6px; border-radius: 10px; color: var(--muted); font-size: 10px; font-weight: 900; text-align: center; }
.session-segment span.active { color: var(--bg); background: var(--accent); }
.side-menu__nav { display: grid; gap: 3px; padding: 8px 10px 22px; overflow: auto; }
.side-menu__nav a { position: relative; display: grid; grid-template-columns: 34px 1fr 18px; align-items: center; gap: 9px; min-height: 48px; padding: 8px 11px; color: var(--muted); border: 1px solid transparent; border-radius: 13px; font-size: 13px; font-weight: 650; text-decoration: none; }
.side-menu__nav a.active, .side-menu__nav a:hover { color: var(--text); background: var(--surface-2); border-color: var(--border); }
.side-menu__nav a.active::before { content: ""; position: absolute; left: -3px; width: 3px; height: 24px; border-radius: 99px; background: var(--accent); box-shadow: 0 0 14px rgba(105,240,180,.35); }
.side-nav-icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: var(--surface-soft); color: var(--accent); }
.content-grid { display: grid; gap: 14px; }
.content-grid--start { align-items: start; }
.content-grid--briefs { align-items: stretch; }
.detail-pairs { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
.detail-pairs > div { display: grid; gap: 4px; padding: 11px; border-radius: 13px; background: var(--surface-soft); }
.detail-pairs span { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
.detail-pairs strong { font-size: 12px; overflow-wrap: anywhere; }
.detail-pairs--four { margin-top: 18px; }
.drawer-market-price { font-size: 40px; font-weight: 900; letter-spacing: -.04em; }
.drawer-market-change { margin: 5px 0 18px; font-weight: 900; }
.drawer-market-change.up { color: var(--positive); }
.drawer-market-change.down { color: var(--negative); }
.drawer-market-change.flat { color: var(--warning); }
.market-chart-card { --market-chart-color: var(--warning); }
.market-chart-card--up { --market-chart-color: var(--positive); }
.market-chart-card--down { --market-chart-color: var(--negative); }
.market-chart-card__heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.market-chart-card__heading h3 { margin: 3px 0 0; font-size: 16px; }
.market-chart-card__stats { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 7px; margin-top: 12px; }
.market-chart-card__stats span { display: grid; gap: 2px; padding: 8px 9px; border-radius: 10px; background: var(--surface-soft); color: var(--muted); font-size: 9px; text-transform: uppercase; letter-spacing: .05em; }
.market-chart-card__stats strong { overflow: hidden; color: var(--text); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.market-chart-card__plot { margin-top: 10px; overflow: hidden; border: 1px solid var(--border); border-radius: 13px; background: linear-gradient(180deg, rgba(255,255,255,.035), rgba(0,0,0,.08)); }
.market-chart-card__plot svg { display: block; width: 100%; height: 220px; overflow: visible; }
.market-chart-grid { stroke: rgba(226,255,244,.1); stroke-width: 1; vector-effect: non-scaling-stroke; }
.market-chart-area { fill: color-mix(in srgb, var(--market-chart-color) 13%, transparent); }
.market-chart-line { fill: none; stroke: var(--market-chart-color); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.market-chart-last { fill: var(--market-chart-color); stroke: #10201b; stroke-width: 2; vector-effect: non-scaling-stroke; }
.market-chart-card__axis { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 9px 8px; color: var(--muted); font-size: 9px; }
.market-chart-empty { margin-top: 10px !important; padding: 16px; border: 1px dashed var(--border-strong); border-radius: 12px; background: var(--surface-soft); text-align: center; }

.position-react-card { padding: 18px; }
.position-react-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin: 16px 0; }
.position-react-grid > div { display: grid; gap: 5px; padding: 12px 9px; background: var(--surface-soft); border-radius: 13px; }
.position-react-grid span { color: var(--muted); font-size: 10px; text-transform: uppercase; }
.position-react-grid strong { font-size: 13px; }
.source-priority-react { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 11px; margin-top: 13px; padding-top: 12px; border-top: 1px solid var(--border); }

.comparison-react { display: grid; gap: 10px; }
.comparison-react__row { border: 1px solid var(--border); background: var(--surface); border-radius: var(--radius-md); padding: 14px; }
.comparison-react__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 11px; }
.comparison-react__cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.comparison-react__cols > div { background: var(--surface-soft); padding: 10px; border-radius: 11px; }
.comparison-react__cols span { color: var(--muted); font-size: 10px; font-weight: 750; text-transform: uppercase; letter-spacing: .07em; }
.comparison-react__cols p { margin: 5px 0 0; font-size: 13px; line-height: 1.5; }
.comparison-react__row > small { display: block; margin-top: 10px; color: var(--muted); }
.comparison-react.compact .comparison-react__row { padding: 11px; }

.conditions-react { padding: 17px; }
.conditions-react > h3 { margin-bottom: 14px; }
.condition-react { display: grid; grid-template-columns: 28px 1fr; gap: 10px; padding: 12px 0; border-top: 1px solid var(--border); }
.condition-react:first-child { border-top: 0; }
.condition-react__icon { width: 25px; height: 25px; display: grid; place-items: center; border-radius: 50%; background: var(--surface-soft); color: var(--muted); }
.condition-react__icon.validated, .condition-react__icon.previously_validated { color: var(--positive); background: var(--positive-soft); }
.condition-react__icon.failed, .condition-react__icon.triggered { color: var(--negative); background: var(--negative-soft); }
.condition-react__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.condition-react p { margin: 5px 0; font-size: 12px; }
.condition-react small { color: var(--muted); font-size: 10px; }
.empty-copy { color: var(--muted); }
.news-digest-preview { margin-top: 14px; padding: 12px; border-radius: 13px; background: var(--surface-soft); }
.news-digest-preview span { color: var(--muted); font-size: 10px; text-transform: uppercase; }
.news-digest-preview p { margin: 5px 0 0; font-size: 12px; }

.session-list-react { display: grid; gap: 14px; }
.session-card-react { padding: 20px; }
.session-card-react h2 { margin: 3px 0 8px; }
.session-card-react p { color: var(--muted); }

.master-hero-react, .monitor-hero-react, .thesis-page-hero { padding: 22px; }
.master-hero-react__top, .monitor-hero-react, .thesis-page-hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.master-hero-react h1, .monitor-hero-react h1, .thesis-page-hero h1 { font-size: clamp(27px,6vw,36px); line-height: 1.05; margin: 5px 0 10px; letter-spacing: -.04em; }
.master-hero-react p, .monitor-hero-react p, .thesis-page-hero p { max-width: 760px; color: #c3d4ce; line-height: 1.6; }
.truncate { display: block; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.step-card { padding: 17px; }
.step-list { list-style: none; display: grid; gap: 9px; margin-top: 13px; }
.step-list li { display: grid; grid-template-columns: 27px 1fr; gap: 10px; align-items: start; }
.step-list li > span { width: 25px; height: 25px; display: grid; place-items: center; border-radius: 50%; color: var(--accent); background: var(--accent-soft); font-size: 10px; font-weight: 900; }
.step-list p { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
.accordion-list { display: grid; gap: 9px; }
.accordion-react { padding: 0; overflow: hidden; }
.accordion-react summary { list-style: none; display: grid; grid-template-columns: 30px 1fr 20px; align-items: center; gap: 10px; padding: 15px; cursor: pointer; }
.accordion-react summary::-webkit-details-marker { display: none; }
.accordion-react summary > span { color: var(--accent); font-size: 10px; font-weight: 900; }
.accordion-react[open] summary svg { transform: rotate(180deg); }
.accordion-react > div { border-top: 1px solid var(--border); padding: 15px; color: var(--muted); }

.monitor-selector-react { display: flex; gap: 8px; overflow-x: auto; margin: 0 -16px 14px; padding: 0 16px 5px; scrollbar-width: none; }
.monitor-selector-react button { min-width: 190px; text-align: left; display: grid; gap: 4px; padding: 13px; border: 1px solid var(--border); border-radius: 15px; background: var(--surface); color: var(--text); }
.monitor-selector-react button.active { border-color: rgba(105,240,180,.5); background: var(--accent-soft); }
.monitor-selector-react span, .monitor-selector-react small { color: var(--muted); font-size: 10px; }
.monitor-actions-react { display: grid; gap: 8px; margin-top: 14px; }
.monitor-actions-react > div { display: grid; gap: 5px; background: var(--surface-soft); border-radius: 12px; padding: 11px; }
.monitor-actions-react span { color: var(--muted); font-size: 10px; text-transform: uppercase; }
.monitor-actions-react strong { font-size: 12px; }
.weak-signals-react { padding: 17px; }
.tag-list { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
.tag-list span { border-radius: 999px; padding: 7px 10px; background: var(--warning-soft); color: var(--warning); font-size: 10px; }

.thesis-page-hero__copy { flex: 1; }
.instrument-title { display: flex; align-items: center; gap: 11px; margin-bottom: 14px; }
.score-drivers-react { padding: 17px; }
.score-drivers-react h3 { display: flex; align-items: center; gap: 8px; }
.score-drivers-react.positive h3 { color: var(--positive); }
.score-drivers-react.negative h3 { color: var(--negative); }
.score-drivers-react ul { margin: 13px 0 0 18px; color: var(--muted); display: grid; gap: 8px; }
.levels-react { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 9px; }
.level-react { display: grid; gap: 6px; padding: 13px; }
.level-react strong { font-size: 15px; }
.level-react > span:not(.status-badge) { color: var(--muted); font-size: 10px; min-height: 25px; }

.source-rules-react { padding: 17px; }
.operator-panel { padding: 17px; }
.operator-panel__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.operator-panel__head h3 { margin: 4px 0 0; font-size: 18px; letter-spacing: -.025em; }
.operator-panel__notice { margin: 13px 0; color: var(--muted); font-size: 12px; line-height: 1.55; }
.operator-panel__identity { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 13px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 13px; background: rgba(255,255,255,.025); color: #c2d2cc; font-size: 11px; }
.operator-panel__identity .secondary-btn { min-height: 34px; white-space: nowrap; }
.operator-command-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
.operator-command { min-height: 76px; display: grid; align-content: center; gap: 6px; padding: 12px 13px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-soft); text-align: left; cursor: pointer; transition: border-color .2s var(--ease), background .2s var(--ease), transform .2s var(--ease); }
.operator-command:hover:not(:disabled) { border-color: rgba(105,240,180,.45); background: var(--accent-soft); }
.operator-command:not(:disabled) { border-color: rgba(105,240,180,.34); background: rgba(105,240,180,.09); }
.operator-command--critical { border-color: rgba(255,93,101,.28); }
.operator-command strong { font-size: 12px; line-height: 1.3; }
.operator-command span { overflow: hidden; color: var(--muted); font-family: ui-monospace,SFMono-Regular,Menlo,monospace; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.operator-command:disabled { cursor: not-allowed; color: #9cafA8; background: rgba(255,255,255,.025); border-color: rgba(255,255,255,.07); }
.operator-command:disabled strong { opacity: .72; }
.operator-command:disabled span { color: #748780; }
.operator-panel__revision { display: grid; grid-template-columns: 1fr auto 1fr auto; gap: 9px; align-items: center; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); color: var(--muted); font-size: 10px; }
.operator-panel__revision strong { color: var(--text); text-transform: uppercase; }
.operator-feedback { display: flex; gap: 7px; align-items: flex-start; margin: 10px 0; padding: 9px 11px; border-radius: 11px; background: var(--positive-soft); color: var(--positive); font-size: 11px; line-height: 1.45; }
.operator-feedback--error { background: var(--negative-soft); color: var(--negative); }
.operator-confirmation { display: grid; gap: 13px; }
.operator-confirmation > p { margin: 0; }
.operator-confirmation label { display: grid; gap: 7px; color: #c4d5ce; font-size: 11px; font-weight: 750; }
.operator-confirmation textarea, .operator-confirmation input, .operator-confirmation select { width: 100%; border: 1px solid var(--border-strong); border-radius: 12px; background: #0b1713; color: var(--text); padding: 11px 12px; outline: none; }
.operator-confirmation textarea { min-height: 86px; resize: vertical; line-height: 1.45; }
.operator-confirmation textarea:focus, .operator-confirmation input:focus, .operator-confirmation select:focus { border-color: var(--accent); }
.operator-confirmation code { width: fit-content; padding: 3px 6px; border-radius: 6px; background: rgba(255,255,255,.06); color: var(--warning); font-size: 10px; }
.operator-confirmation button:disabled { cursor: not-allowed; opacity: .45; }
.source-priority-list { display: grid; gap: 8px; margin-top: 13px; }
.source-priority-list > div { display: grid; grid-template-columns: 26px 1fr; gap: 10px; align-items: center; padding: 10px; border-radius: 12px; background: var(--surface-soft); }
.source-priority-list > div > span { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-size: 10px; font-weight: 900; }
.source-priority-list p { display: grid; margin: 0; gap: 2px; }
.source-priority-list small { color: var(--muted); }

.timeline-page-card { padding: 18px; }
.macro-list-react, .headline-list-react, .alert-list-react { display: grid; gap: 10px; }
.macro-event-react { display: grid; grid-template-columns: 48px 1fr auto; gap: 12px; align-items: start; padding: 15px; }
.macro-event-react time, .headline-react time { color: var(--accent); font-weight: 900; font-size: 12px; }
.macro-event-react p, .headline-react p { color: var(--muted); margin-top: 5px; }
.digest-react { padding: 18px; }
.headline-react { display: grid; grid-template-columns: 45px 1fr; gap: 12px; padding: 15px; }
.headline-react small { color: var(--muted); }

.audit-summary-react { padding: 18px; }
.audit-summary-react > div:first-child { display: flex; gap: 13px; align-items: center; }
.audit-summary-react h2 { margin: 3px 0 2px; font-size: 22px; letter-spacing: -.03em; }
.audit-summary-react p { margin: 0; color: var(--muted); }
.audit-orb { width: 42px; height: 42px; border-radius: 50%; background: var(--warning); box-shadow: 0 0 0 8px var(--warning-soft); }
.audit-orb.ready { background: var(--positive); box-shadow: 0 0 0 8px var(--positive-soft); }
.audit-warnings-react { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 15px; }
.audit-warnings-react span { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 999px; background: var(--warning-soft); color: var(--warning); font-size: 11px; }
.audit-detail-card { padding: 18px; }
.audit-detail-card > h3 { margin: 0; font-size: 16px; }
.audit-list-react { display: grid; gap: 8px; margin-top: 13px; }
.audit-list-react > div { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; background: var(--surface-soft); border-radius: 11px; }
.audit-list-react > div > div { display: grid; gap: 2px; }
.audit-list-react small { color: var(--muted); }
.api-map-react { display: grid; gap: 8px; margin-top: 13px; }
.api-map-react > div { display: grid; grid-template-columns: 95px 1fr; gap: 10px; align-items: center; padding: 10px; background: var(--surface-soft); border-radius: 11px; }
.api-map-react code { color: var(--accent); font-size: 11px; overflow-wrap: anywhere; }

.alert-react { display: grid; grid-template-columns: 38px 1fr; gap: 12px; padding: 16px; }
.alert-react__icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 12px; background: var(--warning-soft); color: var(--warning); }
.alert-react--critical .alert-react__icon { background: var(--negative-soft); color: var(--negative); }
.alert-react__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 9px; }
.alert-react p { color: var(--muted); margin-top: 5px; }

.more-grid-react { display: grid; gap: 10px; }
.more-link-react { display: grid; grid-template-columns: 42px 1fr 20px; align-items: center; gap: 12px; padding: 15px; }
.more-link-react p { color: var(--muted); margin-top: 3px; }
@media (min-width: 680px) {
  .content-grid, .session-list-react, .more-grid-react { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .detail-pairs--four { grid-template-columns: repeat(4,minmax(0,1fr)); }
  .levels-react { grid-template-columns: repeat(3,minmax(0,1fr)); }
  .monitor-actions-react { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .operator-command-grid { grid-template-columns: repeat(3,minmax(0,1fr)); }
}
@media (min-width: 1000px) {
  .content-grid--briefs { grid-template-columns: 1.15fr .85fr; }
  .more-grid-react { grid-template-columns: repeat(3,minmax(0,1fr)); }
  .levels-react { grid-template-columns: repeat(5,minmax(0,1fr)); }
  .view { gap: 16px; }
  .master-hero-react, .monitor-hero-react, .thesis-page-hero { padding: 27px 29px; }
  .audit-summary-react { display: flex; align-items: center; justify-content: space-between; gap: 22px; padding: 20px 24px; }
  .audit-warnings-react { justify-content: flex-end; margin-top: 0; }
  .api-map-react { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 679px) {
  .app-main { padding-left: 12px; padding-right: 12px; }
  .view { gap: 16px; }
  .section-title { margin-top: 14px; }
  .section-title h2 { font-size: 17px; }
  .section-title p { font-size: 12px; line-height: 1.45; }
  .card { border-radius: 18px; }
  .hero-card { padding: 18px; border-radius: 22px; }
  .hero-card__top { gap: 10px; }
  .hero-card h1 { font-size: clamp(28px, 9vw, 35px); }
  .hero-card__summary { font-size: 14px; line-height: 1.55; }
  .hero-card__footer { align-items: flex-end; }
  .health-orb { flex: 0 0 auto; transform: scale(.9); transform-origin: top right; }
  .market-strip { margin: 4px -12px 0; padding-left: 12px; padding-right: 12px; }
  .market-card { min-width: 151px; }
  .thesis-card__top { align-items: flex-start; }
  .thesis-card__instrument { align-items: flex-start; }
  .thesis-card__metrics > div { padding: 11px; }
  .thesis-card__metrics strong { font-size: 18px; }
  .comparison-react__cols { grid-template-columns: 1fr; }
  .position-react-grid { grid-template-columns: 1fr; }
  .position-react-grid > div { grid-template-columns: 1fr auto; align-items: center; }
  .operator-panel__identity { align-items: flex-start; flex-direction: column; }
  .operator-panel__revision { grid-template-columns: 1fr auto; }
  .levels-react { gap: 12px; }
  .audit-summary-react > div:first-child { align-items: flex-start; }
  .api-map-react > div { grid-template-columns: 78px minmax(0, 1fr); }
}

@media (max-width: 999px) {
  body { height: 100dvh; overflow: hidden; }
  .app-shell { height: 100dvh; min-height: 0; overflow: hidden; }
  .app-main {
    height: calc(100dvh - var(--bottom-nav-h) - env(safe-area-inset-bottom));
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    scrollbar-gutter: stable;
    -webkit-overflow-scrolling: touch;
  }
  .bottom-nav {
    background: #091512;
    box-shadow: 0 -12px 30px rgba(0, 0, 0, .28);
  }
  .view > .card,
  .view > section,
  .content-grid > .card {
    min-width: 0;
    isolation: isolate;
  }
}

@media (max-width: 350px) {
  .hero-card__top > div:first-child { min-width: 0; }
  .health-orb { transform: scale(.78); margin-right: -8px; }
  .hero-card h1 { font-size: 29px; }
}

/* Automatic market phase, daily prices and compact macro calendar */
.automatic-session {
  min-height: 36px; display: flex; align-items: center; gap: 7px; padding: 0 10px;
  border: 1px solid rgba(105,240,180,.2); border-radius: 999px; background: var(--accent-soft);
  color: var(--text); font-size: 11px; font-weight: 800; white-space: nowrap;
}
.automatic-session small { padding: 2px 5px; border-radius: 6px; background: var(--accent); color: var(--bg); font-size: 8px; letter-spacing: .08em; }
.session-segment { grid-template-columns: repeat(3, minmax(0,1fr)); }
.session-segment span { padding: 9px 4px; border-radius: 10px; color: var(--muted); font-size: 9px; font-weight: 900; text-align: center; }
.session-segment span.active { color: var(--bg); background: var(--accent); box-shadow: 0 0 18px rgba(105,240,180,.22); }
.session-auto-note { margin: -5px 18px 7px; color: var(--muted-2); font-size: 9px; line-height: 1.4; }
.side-menu__nav { scrollbar-width: none; -ms-overflow-style: none; }
.side-menu__nav::-webkit-scrollbar { display: none; width: 0; height: 0; }
.session-card-react--auto { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-width: 0; }
.session-card-react--auto.active { border-color: rgba(105,240,180,.38); background: linear-gradient(145deg, rgba(38,83,66,.72), rgba(13,29,24,.96)); }
.automatic-phase-state { flex: 0 0 auto; padding: 6px 8px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 9px; font-weight: 900; }
.session-card-react--auto.active .automatic-phase-state { color: var(--accent); border-color: rgba(105,240,180,.3); background: var(--accent-soft); }

.market-overview { display: grid; gap: 16px; min-width: 0; }
.market-group { min-width: 0; }
.market-group__heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 2px 7px; }
.market-group__heading h3 { margin: 0; font-size: 13px; }
.market-group__heading span { color: var(--muted); font-size: 9px; text-transform: uppercase; letter-spacing: .08em; }
.market-card { min-width: 168px; width: 168px; overflow: hidden; }
.market-card--up { border-color: rgba(110,240,169,.23); background: linear-gradient(145deg, rgba(28,75,56,.78), rgba(12,31,24,.96)); }
.market-card--down { border-color: rgba(255,127,130,.23); background: linear-gradient(145deg, rgba(76,35,38,.78), rgba(31,18,20,.96)); }
.market-card--flat { background: linear-gradient(145deg, rgba(42,54,50,.8), rgba(18,29,25,.96)); }
.market-card__ohlc { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 3px 7px; margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.09); }
.market-card__ohlc span { min-width: 0; color: var(--muted); font-size: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.market-card__ohlc strong { color: var(--text); font-size: 9px; }
.market-card__indicators { display: flex; gap: 8px; margin-top: 7px; color: #c4d5ce; font-size: 8px; }

.news-view { scroll-margin-top: 80px; }
.digest-react--compact { padding: 14px 15px; }
.digest-react--compact .card-icon { width: 34px; height: 34px; border-radius: 11px; }
.digest-react--compact h3 { margin: 3px 0 0; font-size: 16px; }
.digest-react--compact > p { margin: 9px 0 0; color: #c0d0ca; font-size: 12px; line-height: 1.5; }
.news-day-heading { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin: 7px 2px 0; }
.news-day-heading h2 { margin: 0; font-size: 17px; }
.news-day-heading p, .news-day-heading > span { margin: 2px 0 0; color: var(--muted); font-size: 10px; }
.macro-list-react--compact { gap: 7px; }
.macro-event-react--compact {
  position: relative; grid-template-columns: 46px minmax(0,1fr) auto; grid-template-areas: "time content importance";
  gap: 9px; align-items: center; min-width: 0; padding: 10px 11px; border-radius: 15px; scroll-margin: 110px;
}
.macro-event-react__time { grid-area: time; display: grid; gap: 1px; }
.macro-event-react__time small { color: var(--muted); font-size: 8px; font-weight: 800; }
.macro-event-react__content { grid-area: content; min-width: 0; }
.macro-event-react--compact > .status-badge { grid-area: importance; align-self: start; min-height: 23px; padding: 0 7px; font-size: 8px; }
.macro-event-react__title { display: flex; align-items: center; gap: 7px; min-width: 0; }
.macro-event-react__title h3 { margin: 0; min-width: 0; overflow: hidden; font-size: 12px; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
.next-event-badge { flex: 0 0 auto; padding: 3px 5px; border-radius: 6px; background: var(--accent); color: var(--bg); font-size: 7px; font-weight: 950; letter-spacing: .08em; }
.macro-values { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 5px; margin-top: 7px; }
.macro-values > div { display: flex; align-items: baseline; justify-content: space-between; gap: 4px; min-width: 0; padding: 5px 6px; border-radius: 8px; background: rgba(255,255,255,.035); }
.macro-values span { color: var(--muted); font-size: 7px; text-transform: uppercase; letter-spacing: .05em; }
.macro-values strong { overflow: hidden; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.macro-value--actual { border: 1px solid rgba(105,240,180,.13); }
.macro-event-react--compact.is-next { border-color: rgba(105,240,180,.52); background: linear-gradient(135deg, rgba(35,80,63,.94), rgba(12,30,24,.97)); box-shadow: 0 0 0 1px rgba(105,240,180,.09), 0 12px 28px rgba(27,104,76,.18); }
.macro-event-react--compact.is-next::before { content: ""; position: absolute; inset: 10px auto 10px -1px; width: 3px; border-radius: 99px; background: var(--accent); box-shadow: 0 0 12px rgba(105,240,180,.55); }
.source-rules-react { padding: 11px 13px; }
.source-rules-react p { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.5; }

@media (min-width: 680px) {
  .market-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); overflow: visible; }
  .market-card { width: auto; min-width: 0; }
  .macro-event-react--compact { grid-template-columns: 56px minmax(0,1fr) auto; padding: 11px 13px; }
}

@media (max-width: 500px) {
  .automatic-session { padding: 0 8px; }
  .automatic-session span { max-width: 62px; overflow: hidden; text-overflow: ellipsis; }
  .automatic-session small { display: none; }
  .session-card-react--auto { align-items: flex-start; }
  .macro-event-react--compact { grid-template-columns: 42px minmax(0,1fr); grid-template-areas: "time content" "importance content"; align-items: start; }
  .macro-event-react--compact > .status-badge { justify-self: start; margin-top: 3px; }
  .macro-values { gap: 3px; }
  .macro-values > div { display: grid; gap: 1px; padding: 4px 5px; }
}

/* Live Desk density: keep the cockpit scannable without affecting detail pages. */
.view--live {
  gap: 10px;
  font-size: 13px;
}
.view--live .card { border-radius: 16px; }
.view--live .status-ribbon { gap: 6px; padding-bottom: 4px; margin-bottom: 0; }
.view--live .status-chip { height: 28px; gap: 5px; padding: 0 9px; font-size: 9px; }
.view--live .status-dot { width: 6px; height: 6px; }
.view--live .section-title { margin-top: 8px; }
.view--live .section-title h2 { font-size: 15px; }
.view--live .section-title p { margin-top: 2px; font-size: 10px; line-height: 1.35; }
.view--live .section-title button { padding: 4px 0; font-size: 10px; }

.view--live .hero-card { padding: 14px 15px; border-radius: 19px; }
.view--live .hero-card__top { gap: 10px; }
.view--live .hero-card h1 { margin: 5px 0 4px; font-size: clamp(22px, 5vw, 30px); line-height: 1.05; }
.view--live .hero-card__decision { gap: 5px; font-size: 9px; }
.view--live .hero-card__summary { margin-top: 9px; font-size: 12px; line-height: 1.45; }
.view--live .hero-card__footer { margin-top: 11px; }
.view--live .action-pill { min-height: 31px; padding: 0 10px; border-radius: 9px; font-size: 9px; }
.view--live .text-btn { padding: 4px 0; font-size: 10px; }
.view--live .health-orb { width: 56px; height: 56px; transform: none; }
.view--live .health-orb::before { inset: 4px; }
.view--live .health-orb__value { font-size: 16px; }
.view--live .health-orb__label { font-size: 7px; }
.view--live .eyebrow { font-size: 8px; }

.view--live .market-overview { gap: 9px; }
.view--live .market-group__heading { margin-bottom: 5px; }
.view--live .market-group__heading h3 { font-size: 11px; }
.view--live .market-group__heading span { font-size: 8px; }
.view--live .market-strip { gap: 7px; margin-top: 0; padding-bottom: 4px; }
.view--live .market-card {
  display: flex; flex-direction: column; min-width: 146px; width: 146px; min-height: 164px;
  padding: 10px; border-radius: 13px;
}
.view--live .market-card__top { min-height: 20px; }
.view--live .market-card__symbol { font-size: 12px; letter-spacing: .045em; }
.view--live .trend-mark { width: 20px; height: 20px; border-radius: 7px; }
.view--live .trend-mark svg { width: 13px; height: 13px; }
.view--live .market-card__quote { display: flex; align-items: end; justify-content: space-between; gap: 7px; margin-top: 7px; }
.view--live .market-card__price { min-width: 0; margin: 0; overflow: hidden; font-size: 17px; line-height: 1.05; text-overflow: ellipsis; white-space: nowrap; }
.view--live .market-card__change { flex: 0 0 auto; margin: 0; padding: 2px 5px; border-radius: 6px; font-size: 10px; line-height: 1.25; background: rgba(255,255,255,.055); }
.view--live .market-card__change.up { background: var(--positive-soft); }
.view--live .market-card__change.down { background: var(--negative-soft); }
.view--live .market-card__ohlc { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 4px; margin-top: 8px; padding-top: 7px; }
.view--live .market-card__ohlc span { display: grid; gap: 1px; min-width: 0; padding: 4px 5px; border-radius: 7px; background: rgba(255,255,255,.04); }
.view--live .market-card__ohlc small { color: var(--muted); font-size: 7px; font-weight: 750; line-height: 1.1; text-transform: uppercase; letter-spacing: .05em; }
.view--live .market-card__ohlc strong { overflow: hidden; color: var(--text); font-size: 10px; line-height: 1.2; text-overflow: ellipsis; }
.view--live .market-card__footer { display: grid; gap: 4px; margin-top: auto; padding-top: 7px; }
.view--live .market-card__indicators { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 5px; margin: 0; }
.view--live .market-card__indicators span { display: flex; align-items: baseline; justify-content: space-between; gap: 3px; min-width: 0; }
.view--live .market-card__indicators small { color: var(--muted); font-size: 7px; font-weight: 800; }
.view--live .market-card__indicators strong { overflow: hidden; color: #d9e8e2; font-size: 9px; text-overflow: ellipsis; }
.view--live .market-card__note { margin: 0; overflow: hidden; color: var(--muted-2); font-size: 8px; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }

.view--live .content-grid { gap: 9px; }
.view--live .brief-card,
.view--live .delta-card,
.view--live .thesis-card,
.view--live .activity-card,
.view--live .position-react-card,
.view--live .timeline-card { padding: 13px; }
.view--live .brief-card__header { gap: 9px; }
.view--live .brief-card h3,
.view--live .delta-card h3,
.view--live .activity-card h3,
.view--live .position-react-card h3 { margin-top: 3px; font-size: 14px; line-height: 1.2; }
.view--live .brief-card > p,
.view--live .position-react-card > p { margin-top: 8px; font-size: 11px; line-height: 1.45; }
.view--live .brief-card__verdict { margin-top: 9px; padding-top: 8px; font-size: 10px; }
.view--live .card-icon { width: 31px; height: 31px; border-radius: 10px; }
.view--live .card-icon svg { width: 16px; height: 16px; }

.view--live .delta-list { gap: 7px; margin-top: 9px; }
.view--live .delta-item { gap: 7px; font-size: 11px; }
.view--live .delta-item__dot { width: 6px; height: 6px; margin-top: 5px; }
.view--live .delta-consequence { margin-top: 9px; padding: 8px 10px; border-radius: 10px; font-size: 10px; }

.view--live .thesis-card__top { gap: 9px; }
.view--live .thesis-card__instrument { gap: 8px; }
.view--live .instrument-badge { width: 35px; height: 35px; border-radius: 11px; font-size: 10px; }
.view--live .thesis-card h3 { font-size: 14px; }
.view--live .thesis-card__subtitle { font-size: 9px; }
.view--live .status-badge { min-height: 23px; padding: 0 7px; font-size: 8px; }
.view--live .thesis-card__scenario { margin-top: 10px; font-size: 11px; line-height: 1.45; }
.view--live .thesis-card__metrics { gap: 6px; margin-top: 10px; }
.view--live .thesis-card__metrics > div { gap: 2px 7px; padding: 8px 9px; border-radius: 10px; }
.view--live .thesis-card__metrics span { font-size: 9px; }
.view--live .thesis-card__metrics strong { font-size: 15px; }
.view--live .thesis-card__metrics small { font-size: 8px; }
.view--live .thesis-card__focus { margin-top: 7px; padding: 8px 9px; border-radius: 3px 10px 10px 3px; }
.view--live .thesis-card__focus span { font-size: 8px; }
.view--live .thesis-card__focus p { margin-top: 3px; font-size: 10px; line-height: 1.4; }

.view--live .setup-card__header { padding: 12px 13px 9px; }
.view--live .setup-card__header h3 { margin-top: 3px; font-size: 14px; }
.view--live .setup-card__body { padding: 0 13px 11px; }
.view--live .price-grid { gap: 6px; }
.view--live .price-box { padding: 8px 9px; border-radius: 10px; }
.view--live .price-box span { font-size: 8px; }
.view--live .price-box strong { margin-top: 2px; font-size: 11px; }
.view--live .setup-card__reason { margin-top: 8px; padding: 8px 9px; border-radius: 10px; font-size: 10px; }
.view--live .setup-card__footer { padding: 9px 13px; font-size: 9px; }

.view--live .position-react-grid { gap: 6px; margin: 10px 0; }
.view--live .position-react-grid > div { gap: 3px; padding: 8px; border-radius: 10px; }
.view--live .position-react-grid span { font-size: 8px; }
.view--live .position-react-grid strong { font-size: 11px; }
.view--live .source-priority-react { gap: 5px; margin-top: 8px; padding-top: 8px; font-size: 9px; }
.view--live .news-digest-preview { margin-top: 8px; padding: 8px 9px; border-radius: 10px; }
.view--live .news-digest-preview span { font-size: 8px; }
.view--live .news-digest-preview p { margin-top: 3px; font-size: 10px; line-height: 1.4; }

.view--live .activity-list { margin-top: 8px; }
.view--live .activity-item { grid-template-columns: 36px 13px 1fr; gap: 7px; min-height: 44px; }
.view--live .activity-time { font-size: 8px; }
.view--live .activity-label { font-size: 10px; }
.view--live .activity-detail { font-size: 9px; }
.view--live .activity-dot { width: 7px; height: 7px; }
.view--live .timeline { padding-left: 4px; }
.view--live .timeline::before { left: 18px; }
.view--live .timeline-item { grid-template-columns: 36px 1fr; gap: 7px; padding-bottom: 8px; }
.view--live .timeline-item__time { padding-top: 11px; padding-right: 5px; font-size: 8px; }
.view--live .timeline-item__content { padding: 9px 10px; border-radius: 11px; }
.view--live .timeline-item__content::before { left: -15px; top: 12px; width: 7px; height: 7px; }
.view--live .timeline-item__header { gap: 7px; }
.view--live .timeline-item__header strong { font-size: 10px; }
.view--live .timeline-item__content p { margin: 3px 0 0; font-size: 9px; line-height: 1.4; }

@media (min-width: 680px) {
  .view--live .market-group--futures .market-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .view--live .market-group--mega-caps .market-strip { grid-template-columns: repeat(6, minmax(146px, 1fr)); overflow-x: auto; }
  .view--live .market-card { width: auto; min-width: 0; }
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
