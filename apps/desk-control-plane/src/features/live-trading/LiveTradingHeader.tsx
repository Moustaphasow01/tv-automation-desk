import { useContext, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaBell, FaCircle, FaMoon, FaSearch, FaShieldAlt, FaSyncAlt } from "react-icons/fa";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { useOperatorSession } from "@/domains/permissions/PermissionGate";
import { OperatorMenu } from "@/shell/OperatorMenu";
import type { LiveTradingModel } from "./model";

const searchTargets = [
  { label: "Centre des stratégies", keywords: "strategy stratégies instances", route: "/strategies" },
  { label: "Portefeuille", keywords: "portfolio positions exposition", route: "/portfolio" },
  { label: "Risque", keywords: "risk risque limites", route: "/risk" },
  { label: "OrderIntents", keywords: "orders ordres intentions", route: "/orders" },
  { label: "Exécution", keywords: "provider execution broker", route: "/execution/providers" },
];

export function LiveTradingHeader({ model, onRefresh, refreshing }: { model: LiveTradingModel; onRefresh(): void; refreshing: boolean }) {
  const navigate = useNavigate();
  const realtime = useContext(RealtimeContext);
  const { session } = useOperatorSession();
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("fr");
    if (needle.length < 2) return [];
    return searchTargets.filter((item) => `${item.label} ${item.keywords}`.toLocaleLowerCase("fr").includes(needle));
  }, [query]);
  const now = realtime?.now ?? null;

  return (
    <>
      <header className="lt-header">
        <h1>Trading en direct</h1>
        <form className="lt-search" role="search" onSubmit={(event) => { event.preventDefault(); if (results[0]) navigate(results[0].route); }}>
          <FaSearch aria-hidden="true" />
          <input aria-label="Rechercher dans les espaces du desk" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher instruments, stratégies, portefeuilles..." autoComplete="off" />
          <kbd>⌘ K</kbd>
          {results.length ? <div role="listbox" aria-label="Résultats de recherche">{results.map((item) => <button key={item.route} type="button" role="option" onClick={() => navigate(item.route)}>{item.label}</button>)}</div> : null}
        </form>
        <div className="lt-header__environment"><small>Environnement</small><strong>{model.mode.environment}</strong></div>
        <time className="lt-header__clock" dateTime={now?.toISOString()}><strong>{now ? formatClock(now) : "—"} ET</strong><small>{now ? formatDate(now) : "Horloge indisponible"}</small></time>
        <button className="lt-icon-button" type="button" aria-label="Thème sombre actif" disabled><FaMoon /></button>
        <button className="lt-icon-button" type="button" aria-label="Notifications indisponibles" disabled><FaBell /><span>—</span></button>
        <OperatorMenu variant="live-trading" displayName={session?.principal.displayName ?? "Session indisponible"} roleLabel={session?.principal.roles.join(", ") || "Rôle indisponible"} />
      </header>
      <section className="lt-policy" aria-label="Politique opérationnelle autoritaire">
        <PolicyChip tone="info">{model.mode.environment}</PolicyChip>
        <PolicyChip tone="info">{model.mode.executionMode.replace("_", "-")}</PolicyChip>
        <PolicyChip tone={model.mode.autoExecutionEnabled ? "danger" : "warning"}>EXÉCUTION AUTO {model.mode.autoExecutionEnabled ? "ACTIVÉE" : "DÉSACTIVÉE"}</PolicyChip>
        <PolicyChip tone={model.mode.physicalExecutionEnabled ? "danger" : "danger"}>BROKER LIVE {model.mode.physicalExecutionEnabled ? "ACTIVÉ" : "DÉSACTIVÉ"}</PolicyChip>
        <PolicyChip tone={model.mode.humanGateRequired ? "warning" : "danger"}>Human Gate {model.mode.humanGateRequired ? "Requis" : "Non requis"}</PolicyChip>
        <span className={`lt-policy__freshness lt-tone--${model.truth.tone}`}><FaCircle aria-hidden="true" />Données {model.freshness.marketData.toLowerCase()} · asOf {formatTimestamp(model.meta.asOf)}</span>
        <button type="button" className="lt-policy__refresh" onClick={onRefresh} disabled={refreshing} aria-label="Actualiser la projection Live"><FaSyncAlt className={refreshing ? "is-spinning" : ""} /></button>
        <FaShieldAlt className="lt-policy__shield" aria-label="Politique backend active" />
      </section>
    </>
  );
}

function PolicyChip({ tone, children }: { tone: "info" | "warning" | "danger"; children: React.ReactNode }) {
  return <span className={`lt-policy-chip lt-policy-chip--${tone}`}>{children}</span>;
}

function formatClock(date: Date) { return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date); }
function formatDate(date: Date) { return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }).format(date); }
function formatTimestamp(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date); }
