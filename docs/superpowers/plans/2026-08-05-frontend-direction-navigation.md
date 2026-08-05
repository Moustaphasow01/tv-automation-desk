# Direction générale & navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centraliser la traduction française des statuts/sessions dans un seul module partagé, et corriger le classement de navigation (Master/Monitor/Alertes/Sessions dans "Aujourd'hui" au lieu de "Réglages", Historique dans "Performance" au lieu de "Replay"), sans changer aucune route ni aucun comportement visible.

**Architecture:** `src/lib/presentation.ts` existe déjà comme module de fonctions de présentation pures (sans état, sans JSX). On y ajoute les fonctions de traduction actuellement dupliquées dans `deskCards.tsx`, `LiveDeskScreen.tsx` et `layout.tsx`, puis on migre chaque appelant. La correction de `src/navigation.ts` déplace des entrées entre tableaux existants sans changer la forme des données ni les routes de `src/App.tsx`.

**Tech Stack:** React 18, TypeScript, Vitest, React Router.

Référence : `docs/superpowers/specs/2026-08-05-frontend-direction-navigation-design.md`.

---

### Task 1: Ajouter les fonctions de traduction centralisées à `src/lib/presentation.ts`

**Files:**
- Modify: `src/lib/presentation.ts`
- Test: `src/test/navigationPresentation.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter les trois nouveaux noms à l'import existant en haut du fichier, puis
ajouter un nouveau bloc `describe` à la fin du fichier.

Modifier les lignes 3-9 de `src/test/navigationPresentation.test.ts` :

```typescript
import {
  deskStatusText,
  dataQualityLabel,
  gptProcessLabel,
  incidentLabel,
  replayLabel,
  sessionLabel,
  shortReference,
  workflowLabel,
} from "@/lib/presentation";
```

Ajouter à la fin du fichier (après la dernière accolade fermante) :

```typescript

describe("traduction des sessions, de la qualité et des statuts", () => {
  it("traduit les codes de session connus et laisse passer les autres", () => {
    expect(sessionLabel("asia_open")).toBe("Session Asie");
    expect(sessionLabel("ny_open")).toBe("Session New York");
    expect(sessionLabel("full_day")).toBe("Journée continue");
    expect(sessionLabel("Asia Open")).toBe("Session Asie");
    expect(sessionLabel("NY Open")).toBe("Session New York");
    expect(sessionLabel("custom_scope")).toBe("custom scope");
    expect(sessionLabel(null)).toBe("");
  });

  it("traduit les statuts de qualité de donnée connus et laisse passer les autres", () => {
    expect(dataQualityLabel("ready")).toBe("prête");
    expect(dataQualityLabel("healthy")).toBe("opérationnelle");
    expect(dataQualityLabel("context_limited")).toBe("contexte partiel");
    expect(dataQualityLabel("degraded")).toBe("dégradée");
    expect(dataQualityLabel("waiting")).toBe("en attente");
    expect(dataQualityLabel("unmapped_status")).toBe("unmapped status");
  });

  it("traduit les phrases et codes de statut du desk", () => {
    expect(deskStatusText("WAIT")).toBe("Attente");
    expect(deskStatusText("NO_SETUP")).toBe("Aucun setup");
    expect(deskStatusText("NO POSITION")).toBe("Aucune position");
    expect(deskStatusText("Master analysis required")).toBe("Analyse Master requise");
    expect(deskStatusText("")).toBe("");
    expect(deskStatusText(null)).toBe("");
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

Run: `npm run test:react -- navigationPresentation`
Expected: FAIL — `sessionLabel`, `dataQualityLabel` et `deskStatusText` ne sont
pas exportés par `@/lib/presentation` (erreur d'import ou `undefined`).

- [ ] **Step 3: Implémenter les fonctions dans `src/lib/presentation.ts`**

Ajouter à la fin du fichier (après la fonction `extractTime` existante, ligne 53) :

```typescript

const SESSION_LABELS: Record<string, string> = {
  "Asia Open": "Session Asie",
  "NY Open": "Session New York",
  asia_open: "Session Asie",
  ny_open: "Session New York",
  full_day: "Journée continue",
};

export function sessionLabel(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return SESSION_LABELS[trimmed] || trimmed.replaceAll("_", " ");
}

const DATA_QUALITY_LABELS: Record<string, string> = {
  ready: "prête",
  healthy: "opérationnelle",
  context_limited: "contexte partiel",
  degraded: "dégradée",
  waiting: "en attente",
};

export function dataQualityLabel(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return DATA_QUALITY_LABELS[trimmed] || trimmed.replaceAll("_", " ");
}

const DESK_STATUS_COPY: Record<string, string> = {
  "Run Master to create a current thesis.": "Lancez le Master pour créer la thèse courante.",
  "Master analysis required": "Analyse Master requise",
  WAIT: "Attente",
  wait: "Attente",
  "MARKET FEED": "Flux marché",
  NO_ACTION: "Aucune action",
  "NO ACTIVE THESIS": "Aucune thèse active",
  NO_ACTIVE_THESIS: "Aucune thèse active",
  "NO SETUP": "Aucun setup",
  NO_SETUP: "Aucun setup",
  "NO POSITION": "Aucune position",
  NO_POSITION: "Aucune position",
};

export function deskStatusText(value?: string | null) {
  if (!value) return "";
  const trimmed = value.trim();
  if (DESK_STATUS_COPY[trimmed]) return DESK_STATUS_COPY[trimmed];
  return Object.entries(DESK_STATUS_COPY).reduce((text, [code, label]) => {
    if (code === "WAIT" || code === "wait") return text;
    return text.replaceAll(code, label);
  }, value);
}
```

- [ ] **Step 4: Lancer les tests pour vérifier le succès**

Run: `npm run test:react -- navigationPresentation`
Expected: PASS — tous les tests du fichier passent, y compris les nouveaux.

- [ ] **Step 5: Commit**

```bash
git add src/lib/presentation.ts src/test/navigationPresentation.test.ts
git commit -m "feat: centralize session, data-quality and desk status labels in presentation.ts"
```

---

### Task 2: Migrer `src/components/deskCards.tsx` vers le dictionnaire centralisé

**Files:**
- Modify: `src/components/deskCards.tsx:1-29`

- [ ] **Step 1: Remplacer l'import et supprimer le dictionnaire local**

Remplacer les lignes 1-29 de `src/components/deskCards.tsx` (de `import { useNavigate }`
jusqu'à la fermeture de `humanDeskText`, juste avant `const severityTone`) par :

```typescript
import { useNavigate } from "react-router-dom";
import { Card, Icon, SectionTitle, StatusBadge, StatusPill } from "@/components/common";
import { deskStatusText as humanDeskText } from "@/lib/presentation";
import type { DeskSession, TimelineEvent } from "@/types";

const fmt = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
const sameText = (left?: string | null, right?: string | null) => (left || "").trim().toLowerCase() === (right || "").trim().toLowerCase();
```

Les ~20 appels existants à `humanDeskText(...)` plus loin dans le fichier ne
changent pas : l'alias d'import fait que `humanDeskText` continue de désigner
la même fonction, maintenant importée depuis `@/lib/presentation` au lieu
d'être définie localement.

- [ ] **Step 2: Vérifier qu'il ne reste aucune référence à `deskCopy` dans le fichier**

Run: `grep -n "deskCopy" src/components/deskCards.tsx`
Expected: aucune sortie (le dictionnaire local a été entièrement supprimé).

- [ ] **Step 3: Typecheck et tests**

Run: `npm run typecheck`
Expected: PASS — aucune erreur de type (la signature de `deskStatusText`
est identique à l'ancienne `humanDeskText`).

Run: `npm run test:react`
Expected: PASS — tous les tests existants passent, notamment ceux qui
rendent `DecisionCard`, `ThesisSummary`, `SetupCard` et `PositionCard`.

- [ ] **Step 4: Commit**

```bash
git add src/components/deskCards.tsx
git commit -m "refactor: deskCards.tsx uses centralized desk status dictionary"
```

---

### Task 3: Migrer `src/screens/live/LiveDeskScreen.tsx` vers les fonctions centralisées

**Files:**
- Modify: `src/screens/live/LiveDeskScreen.tsx:22-24` (imports)
- Modify: `src/screens/live/LiveDeskScreen.tsx:50` (appel `sessionDisplayLabel`/`deskLabel`)
- Modify: `src/screens/live/LiveDeskScreen.tsx:55` (appel `qualityLabel`)
- Modify: `src/screens/live/LiveDeskScreen.tsx:181-197` (suppression des fonctions locales)

**Important :** ne pas importer `workflowLabel` depuis `@/lib/presentation`
dans ce fichier. `LiveDeskScreen.tsx` définit sa propre fonction locale
`workflowLabel` (ligne 210, qui traduit `LIVE_MASTER`/`LIVE_M15_MONITOR` en
libellés d'écran) qui n'a aucun rapport avec la fonction `workflowLabel`
exportée par `presentation.ts` (qui formate une référence technique de
workflow en date lisible). Importer les deux sous le même nom provoquerait
une collision de déclaration. Cette tâche ne touche pas à cette fonction.

- [ ] **Step 1: Ajouter l'import**

Modifier la ligne 22 de `src/screens/live/LiveDeskScreen.tsx` :

```typescript
import type { LiveDeskScreenProps } from "./LiveDeskScreen.types";
import { dataQualityLabel, sessionLabel } from "@/lib/presentation";
import type { DeskSession } from "@/types";
import "./liveDeskScreen.css";
```

- [ ] **Step 2: Mettre à jour les appels**

Modifier la ligne 50 (dans `PageHeading subtitle`) :

```typescript
      subtitle={`${sessionLabel(data.label)} · ${data.date} · ${sessionLabel(data.strategyId)}`}
```

Modifier la ligne 55 (dans `DataSourceBadge detail`) :

```typescript
        <DataSourceBadge label="SOURCE LIVE" detail={dataQualityLabel(data.dataQuality.status)}/>
```

- [ ] **Step 3: Supprimer les fonctions locales devenues inutiles**

Supprimer entièrement les fonctions `deskLabel` (lignes 181-183),
`sessionDisplayLabel` (lignes 185-193) et `qualityLabel` (lignes 195-197).
Les fonctions `fmtLive`, `taskStatusTone`, `formatUpdatedAt`,
`claimLatencyLabel` et `workflowLabel` restent inchangées.

- [ ] **Step 4: Typecheck et tests**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/live/LiveDeskScreen.tsx
git commit -m "refactor: LiveDeskScreen.tsx uses centralized session and data-quality labels"
```

---

### Task 4: Migrer `src/components/layout.tsx` vers `sessionLabel`

**Files:**
- Modify: `src/components/layout.tsx:1-12` (imports)
- Modify: `src/components/layout.tsx:127` et `:130` (appels `humanSessionLabel`)
- Modify: `src/components/layout.tsx:218-227` (suppression de la fonction locale)

- [ ] **Step 1: Ajouter l'import**

Modifier les lignes 1-12 de `src/components/layout.tsx` en ajoutant une ligne
après l'import de `useDesk` :

```typescript
import { useDeskMarketSnapshot, useDeskSessionBase } from "@/hooks/useDesk";
import { sessionLabel } from "@/lib/presentation";
import {
  activeNavigationSpace,
  navigationCatalog,
  navigationSpaces,
  type NavigationItem,
} from "@/navigation";
```

- [ ] **Step 2: Mettre à jour les deux appels**

Ligne 127 :

```typescript
      <button className="brand-button mobile-brand" onClick={() => navigate("/more")} aria-label="Menu"><BrandMark/><span><strong>Desk Futures</strong><small>{sessionLabel(data?.label) || "Cockpit"}</small></span></button>
```

Ligne 130 (dans `topbar-terminal-state`) :

```typescript
        <span>SESSION <strong>{sessionLabel(data?.label) || "—"}</strong></span>
```

- [ ] **Step 3: Supprimer la fonction locale**

Supprimer entièrement la fonction `humanSessionLabel` (lignes 218-227, juste
avant la fermeture du fichier).

- [ ] **Step 4: Typecheck et tests**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout.tsx
git commit -m "refactor: layout.tsx uses centralized sessionLabel"
```

---

### Task 5: Corriger le classement de navigation dans `src/navigation.ts`

**Files:**
- Modify: `src/navigation.ts`
- Test: `src/test/navigationPresentation.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter au bloc `describe("information architecture V3", ...)` existant
(après le test `"garde les écrans zoom dans leur espace métier"`, avant la
fermeture du `describe`) :

```typescript

  it("classe les facettes du Live dans l'espace Aujourd'hui, pas Réglages", () => {
    const today = navigationSpaces.find(space => space.id === "today")!;
    const settings = navigationSpaces.find(space => space.id === "settings")!;
    const todayPaths = today.items.map(item => item.to);
    const settingsPaths = settings.items.map(item => item.to);
    expect(todayPaths).toEqual(expect.arrayContaining(["/master", "/monitors", "/alerts", "/sessions"]));
    expect(settingsPaths).not.toEqual(expect.arrayContaining(["/master", "/monitors", "/alerts", "/sessions"]));
  });

  it("classe l'historique dans Performance, pas Replay", () => {
    const replay = navigationSpaces.find(space => space.id === "replay")!;
    const performance = navigationSpaces.find(space => space.id === "performance")!;
    expect(performance.items.map(item => item.to)).toContain("/history");
    expect(replay.items.map(item => item.to)).not.toContain("/history");
    expect(activeNavigationSpace("/history/sessions/session_123").id).toBe("performance");
  });

  it("n'expose qu'une seule fois chaque espace dans le catalogue de recherche", () => {
    const labels = navigationCatalog.map(group => group.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain("Documents de session");
  });
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

Run: `npm run test:react -- navigationPresentation`
Expected: FAIL — les trois nouveaux tests échouent contre le classement actuel.

- [ ] **Step 3: Déplacer les items entre tableaux**

Dans `src/navigation.ts`, modifier `todayItems` (lignes 16-23) pour ajouter
les quatre items déplacés :

```typescript
const todayItems: NavigationItem[] = [
  item("/dashboard", "Vue d’ensemble", "Santé, session et priorités", "chart"),
  item("/live", "Session en direct", "Décision courante et marché", "live"),
  item("/master", "Analyse initiale", "Document Master de la session", "master"),
  item("/monitors", "Suivis", "Évolutions du plan actif", "monitor"),
  item("/thesis", "Plan actif", "Thèse et invalidations", "brain"),
  item("/setup", "Position", "Setup et cycle de vie", "position"),
  item("/timeline", "Journal", "Décisions dans l’ordre", "timeline"),
  item("/news", "Agenda & actualités", "Macro, événements et risques", "news"),
  item("/alerts", "Alertes de session", "Historique des alertes LIVE", "bell"),
  item("/sessions", "Phases de marché", "Découpage horaire de la journée", "clock"),
];
```

Modifier `replayItems` (lignes 25-29) pour retirer `/history` :

```typescript
const replayItems: NavigationItem[] = [
  item("/replay", "Journées de test", "Préparer et suivre les replays", "layers"),
  item("/replay/compare", "Comparer", "Comparer deux exécutions", "change"),
];
```

Modifier `performanceItems` (lignes 31-34) pour ajouter `/history` :

```typescript
const performanceItems: NavigationItem[] = [
  item("/performance/analysis", "Analyse", "Résultats, risque et distributions", "chart"),
  item("/performance", "Calendrier", "Résultats journaliers en R", "calendar"),
  item("/history", "Archives", "Sessions et mémoire du desk", "database"),
];
```

Modifier `settingsItems` (lignes 49-56) pour ne garder que la gouvernance :

```typescript
const settingsItems: NavigationItem[] = [
  item("/strategies", "Stratégie & contrats", "Versions actives et compatibilité", "settings"),
  item("/audit", "Qualité des données", "Sources, couverture et contrôles", "audit"),
];
```

- [ ] **Step 4: Aligner les prédicats `matches` sur le nouveau classement**

Modifier la définition de l'espace `replay` (ligne 61-62) pour ne plus
matcher `/history` :

```typescript
  space("replay", "/replay", "Replay", "Tester des journées passées", "layers", replayItems, pathname =>
    pathname.startsWith("/replay")),
```

Modifier la définition de l'espace `performance` (ligne 63-64) pour matcher
`/history` :

```typescript
  space("performance", "/performance/analysis", "Performance", "Mesurer les résultats", "chart", performanceItems, pathname =>
    pathname.startsWith("/performance") || pathname.startsWith("/history")),
```

La définition de l'espace `today` (ligne 59-60) matche déjà `/master`,
`/monitors`, `/sessions` et `/alerts` — elle ne change pas. La définition de
l'espace `settings` (ligne 69-70) ne matchait déjà pas ces quatre chemins —
elle ne change pas non plus.

- [ ] **Step 5: Dédupliquer le catalogue de recherche**

Remplacer les lignes 73-85 (définition de `navigationCatalog`) par :

```typescript
export const navigationCatalog: Array<{ label: string; items: NavigationItem[] }> =
  navigationSpaces.map(({ label, items }) => ({ label, items }));
```

- [ ] **Step 6: Lancer les tests pour vérifier le succès**

Run: `npm run test:react -- navigationPresentation`
Expected: PASS — les six tests du fichier passent (les trois existants plus
les trois nouveaux).

- [ ] **Step 7: Typecheck complet**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/navigation.ts src/test/navigationPresentation.test.ts
git commit -m "fix: reclassify Master/Monitor/Alerts/Sessions under Aujourd'hui, History under Performance"
```

---

### Task 6: Validation complète et vérification manuelle

**Files:** aucun fichier modifié — validation uniquement.

- [ ] **Step 1: Suite de validation complète**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS — l'ensemble de la suite React, pas seulement
`navigationPresentation`.

Run: `npm run build`
Expected: PASS — le build Vite se termine sans erreur.

- [ ] **Step 2: Vérification visuelle manuelle dans le navigateur**

Démarrer la stack locale si elle ne tourne pas déjà :

```bash
docker compose --env-file .env.preprod up --build -d
```

Ouvrir `http://localhost:8080` et vérifier :
- la sidebar affiche « Aujourd'hui » avec Master/Monitors/Alertes/Sessions
  désormais listés dans sa sous-navigation ;
- « Réglages » ne montre plus que Stratégie & contrats et Qualité des
  données ;
- « Replay » ne montre plus Archives, qui apparaît maintenant sous
  « Performance » ;
- naviguer directement vers `/master`, `/monitors`, `/alerts`, `/sessions`
  et `/history` fonctionne toujours (aucune route cassée) et met en
  surbrillance le bon espace dans la sidebar ;
- le menu mobile « Plus » (`/more`) n'affiche plus de section dupliquée
  « Documents de session ».

- [ ] **Step 3: Commit final si des ajustements manuels ont eu lieu**

Si la vérification visuelle n'a rien changé, aucune action. Si un ajustement
mineur a été nécessaire, committer séparément avec un message décrivant
précisément l'ajustement.

---

## Notes de suivi (hors plan, pour le chantier suivant)

Le chantier 2 (page « Aujourd'hui ») reprendra le travail de fusion visuelle
des pages Master/Monitors/Thèse/Setup/Timeline/News/Alertes en une seule
page à sections ancrées, ainsi que la hiérarchie visuelle de
`SetupCard`/`PositionCard` (Entrée/Stop/TP1-2-3). Ce plan-ci ne fait que
préparer le terrain (classement correct + dictionnaire centralisé) sans
toucher au contenu ou à la mise en page de ces écrans.
