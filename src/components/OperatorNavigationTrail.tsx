import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Icon } from "@/components/common";
import { activeNavigationSpace } from "@/navigation";
import {
  gptProcessLabel,
  incidentLabel,
  replayLabel,
  workflowLabel,
} from "@/lib/presentation";

const STORAGE_KEY = "desk-navigation-history-v3";
const MAX_ITEMS = 12;

interface HistoryItem {
  href: string;
  label: string;
  at: string;
}

interface Crumb {
  label: string;
  to?: string;
}

export function OperatorNavigationTrail() {
  const location = useLocation();
  const href = `${location.pathname}${location.search}${location.hash}`;
  const descriptor = useMemo(
    () => describeLocation(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const space = activeNavigationSpace(location.pathname);
  const [history, setHistory] = useState<HistoryItem[]>(readHistory);

  useEffect(() => {
    setHistory(current => {
      const next = [
        { href, label: descriptor.label, at: new Date().toISOString() },
        ...current.filter(item => item.href !== href),
      ].slice(0, MAX_ITEMS);
      writeHistory(next);
      return next;
    });
  }, [descriptor.label, href]);

  const previous = history.find(item => item.href !== href) || null;
  const crumbs = [
    { label: space.label, to: space.to },
    ...descriptor.parents,
    { label: descriptor.label },
  ].filter((crumb, index, all) =>
    index === 0 || crumb.to !== all[index - 1]?.to || crumb.label !== all[index - 1]?.label);

  return <aside className="operator-nav-trail operator-nav-trail--breadcrumb" aria-label="Navigation contextuelle">
    <nav className="operator-nav-trail__crumbs" aria-label="Fil d’Ariane">
      {crumbs.map((crumb, index) => <span key={`${crumb.to || "current"}:${crumb.label}:${index}`}>
        {index > 0 && <Icon name="arrow" size={12}/>}
        {crumb.to && index < crumbs.length - 1
          ? <Link to={crumb.to}>{crumb.label}</Link>
          : <strong aria-current={index === crumbs.length - 1 ? "page" : undefined}>{crumb.label}</strong>}
      </span>)}
    </nav>
    {previous
      ? <Link className="operator-nav-trail__back" to={previous.href} title={`Revenir à ${previous.label}`}>
          <Icon name="collapse" size={13}/><span>Retour</span><strong>{previous.label}</strong>
        </Link>
      : <span className="operator-nav-trail__back is-empty"><Icon name="collapse" size={13}/><span>Retour</span></span>}
  </aside>;
}

function describeLocation(pathname: string, search: string): { label: string; parents: Crumb[] } {
  const params = new URLSearchParams(search);
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (parts[0] === "replay" && parts[1] === "runs" && parts[3] === "gpt") {
    return detail(gptProcessLabel(parts[4]), [
      { label: "Journées de test", to: "/replay" },
      { label: replayLabel(parts[2]), to: `/replay/runs/${encodeURIComponent(parts[2])}` },
    ]);
  }
  if (parts[0] === "replay" && parts[1] === "runs" && parts[3] === "days" && parts[5] === "sessions") {
    return detail(`Session ${sessionLabel(parts[6])}`, [
      { label: "Journées de test", to: "/replay" },
      { label: replayLabel(parts[2]), to: `/replay/runs/${encodeURIComponent(parts[2])}` },
      { label: formatDate(parts[4]), to: `/replay/runs/${encodeURIComponent(parts[2])}/days/${parts[4]}` },
    ]);
  }
  if (parts[0] === "replay" && parts[1] === "runs" && parts[3] === "days") {
    return detail(formatDate(parts[4]), [
      { label: "Journées de test", to: "/replay" },
      { label: replayLabel(parts[2]), to: `/replay/runs/${encodeURIComponent(parts[2])}` },
    ]);
  }
  if (parts[0] === "replay" && parts[1] === "runs") {
    return detail(replayLabel(parts[2]), [{ label: "Journées de test", to: "/replay" }]);
  }
  if (pathname === "/replay/compare") return detail("Comparer deux replays", [{ label: "Journées de test", to: "/replay" }]);

  if (parts[0] === "operations" && parts[1] === "incidents" && parts[2]) {
    return detail(incidentLabel(parts[2]), [{ label: "Incidents", to: "/operations/incidents" }]);
  }
  if (parts[0] === "operations" && parts[1] === "notifications" && parts[2]) {
    return detail(entityDetailLabel("Notification", parts[2]), [{ label: "Notifications", to: "/operations/notifications" }]);
  }
  if (parts[0] === "operations" && parts[1] === "runbooks" && parts[2]) {
    return detail(entityDetailLabel("Procédure", parts[2]), [{ label: "Procédures", to: "/operations/runbooks" }]);
  }
  if (parts[0] === "operations" && parts[1] === "workflows" && parts[2] && parts[3] === "events") {
    return detail("Transition détaillée", [
      { label: "Automatisations", to: "/operations" },
      { label: workflowLabel(parts[2]), to: `/operations/workflows/${encodeURIComponent(parts[2])}` },
    ]);
  }
  if (parts[0] === "operations" && parts[1] === "workflows" && parts[2]) {
    return detail(workflowLabel(parts[2]), [{ label: "Automatisations", to: "/operations" }]);
  }
  if (parts[0] === "history" && parts[1] === "sessions") {
    return detail(`Session ${formatDate(parts[2])}`, [{ label: "Archives", to: "/history" }]);
  }
  if (parts[0] === "live" && parts[1]) {
    const liveTabLabels: Record<string, string> = {
      thesis: "Plan actif",
      master: "Analyse initiale",
      monitors: "Suivis",
      news: "Agenda & actualités",
      timeline: "Journal",
      sessions: "Phases de marché",
    };
    return detail(liveTabLabels[parts[1]] || "Session en direct", [{ label: "Session en direct", to: "/live" }]);
  }
  if (parts[0] === "strategies" && parts[1]) {
    return detail("Version de stratégie", [{ label: "Stratégie & contrats", to: "/strategies" }]);
  }

  const process = params.get("process");
  const staticLabels: Record<string, string> = {
    "/dashboard": "Vue d’ensemble",
    "/live": "Session en direct",
    "/sessions": "Phases de marché",
    "/master": "Analyse initiale",
    "/monitors": "Suivis du plan",
    "/thesis": "Plan actif",
    "/setup": "Position",
    "/timeline": "Journal",
    "/news": "Agenda & actualités",
    "/audit": "Qualité des données",
    "/alerts": "Alertes de session",
    "/performance": "Calendrier des résultats",
    "/performance/analysis": "Analyse des performances",
    "/operations": "Automatisations",
    "/operations/agents": "Agents IA",
    "/operations/claim-lanes": "Files GPT",
    "/operations/execution": "NinjaTrader",
    "/operations/observability": process ? gptProcessLabel(process) : "Activité GPT",
    "/operations/incidents": "Incidents",
    "/operations/notifications": "Notifications",
    "/operations/runbooks": "Procédures",
    "/replay": "Journées de test",
    "/history": "Archives",
    "/strategies": "Stratégie & contrats",
    "/data-foundation": "Data Foundation",
    "/more": "Tous les écrans",
  };
  return detail(staticLabels[pathname] || "Desk");
}

function detail(label: string, parents: Crumb[] = []) {
  return { label, parents };
}

function formatDate(value?: string) {
  if (!value) return "Journée";
  const normalized = value.replaceAll("_", "-");
  const date = new Date(`${normalized.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? "Journée"
    : new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function sessionLabel(value?: string) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase()) || "de marché";
}

function entityDetailLabel(kind: string, value?: string) {
  const suffix = String(value || "").slice(-6).toUpperCase();
  return suffix ? `${kind} · #${suffix}` : kind;
}

function readHistory(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

function writeHistory(items: HistoryItem[]) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Navigation history must never block the desk.
  }
}
