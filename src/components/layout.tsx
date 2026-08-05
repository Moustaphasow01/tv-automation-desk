import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BrandMark, Icon, type IconName } from "@/components/common";
import { OperatorNavigationTrail } from "@/components/OperatorNavigationTrail";
import { useDeskContext } from "@/context/DeskContext";
import { useDeskMarketSnapshot, useDeskSessionBase } from "@/hooks/useDesk";
import {
  activeNavigationSpace,
  navigationCatalog,
  navigationSpaces,
  type NavigationItem,
} from "@/navigation";

type DeskTheme = "light" | "dark";

interface CommandSuggestion {
  label: string;
  detail: string;
  to: string;
  icon: IconName;
  kind: string;
}

const bottom: NavigationItem[] = [
  { to: "/live", label: "Live", description: "", icon: "live" },
  { to: "/operations", label: "Ops", description: "", icon: "monitor" },
  { to: "/replay", label: "Replay", description: "", icon: "layers" },
  { to: "/performance/analysis", label: "Analyse", description: "", icon: "chart" },
  { to: "/more", label: "Plus", description: "", icon: "menu" },
];

export function AppShell() {
  const { sessionId, phase, phaseLabel, nextPhaseAt } = useDeskContext();
  const location = useLocation();
  const navigate = useNavigate();
  const showMarketTape = location.pathname === "/live";
  const { data } = useDeskSessionBase(sessionId, { enabled: showMarketTape, refetchInterval: false });
  const { data: marketData } = useDeskMarketSnapshot(sessionId, {
    enabled: showMarketTape,
    refetchInterval: 30_000
  });
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("desk-sidebar") === "collapsed");
  const [density, setDensity] = useState<"compact" | "comfortable">(() => localStorage.getItem("desk-density") === "comfortable" ? "comfortable" : "compact");
  const [theme, setTheme] = useState<DeskTheme>(() => localStorage.getItem("desk-theme") === "dark" ? "dark" : "light");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const activeSpace = activeNavigationSpace(location.pathname);
  const suggestions = useMemo(() => commandSuggestions(search), [search]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("desk-theme", theme);
    document.querySelector<HTMLMetaElement>("meta[name='theme-color']")?.setAttribute("content", theme === "light" ? "#f6f8fb" : "#05080c");
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.density = density;
    localStorage.setItem("desk-density", density);
  }, [density]);
  useEffect(() => localStorage.setItem("desk-sidebar", collapsed ? "collapsed" : "open"), [collapsed]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape" && document.activeElement === searchRef.current) {
        setSearch("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const openSuggestion = (suggestion: CommandSuggestion) => {
    navigate(suggestion.to);
    setSearch("");
    searchRef.current?.blur();
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    if (suggestions[0]) openSuggestion(suggestions[0]);
  };

  return <div className={`app-shell-v2 ${collapsed ? "is-collapsed" : ""}`}>
    <a className="skip-link" href="#main-content">Aller au contenu</a>
    <aside className="app-sidebar" aria-label="Navigation principale">
      <header className="app-sidebar__brand">
        <Link to="/live" aria-label="Desk Futures"><BrandMark/><span className="app-sidebar__brand-copy"><strong>Desk Futures</strong><small><i className="api-dot"/> API connectée</small></span></Link>
        <button className="icon-btn sidebar-collapse" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? "Déployer la navigation" : "Replier la navigation"}><Icon name={collapsed ? "arrow" : "collapse"}/></button>
      </header>
      <nav className="domain-nav domain-nav--spaces">
        <p className="domain-nav__caption">Espaces</p>
        <div className="domain-nav__spaces">
          {navigationSpaces.map(space => <NavLink
            key={space.id}
            to={space.to}
            title={collapsed ? space.label : space.description}
            className={space.id === activeSpace.id ? "active" : ""}
          ><Icon name={space.icon}/><span>{space.label}</span></NavLink>)}
        </div>
        <section className="domain-nav__secondary" aria-label={`Rubriques ${activeSpace.label}`}>
          <header><span>{activeSpace.label}</span><small>{activeSpace.description}</small></header>
          <div>{activeSpace.items.map(item => <NavLink
            key={item.to}
            to={item.to}
            end={["/live", "/performance", "/operations", "/replay"].includes(item.to)}
            title={collapsed ? item.label : item.description}
          ><Icon name={item.icon}/><span>{item.label}</span></NavLink>)}</div>
        </section>
      </nav>
      <div className="session-context-card" title={`Prochaine phase à ${nextPhaseAt}`}>
        <p>Phase automatique</p><div><span className="phase-orb">{phaseLabel.slice(0, 1)}</span><strong>{phaseLabel}</strong><em>AUTO</em></div>
        <div className="phase-track" aria-label={`Phase active ${phaseLabel}`}><span className={phase === "asia" ? "active" : ""}>Asie</span><span className={phase === "london" ? "active" : ""}>Londres</span><span className={phase === "ny" ? "active" : ""}>NY</span></div>
        <small>Prochaine phase à {nextPhaseAt}</small>
      </div>
      <footer className="app-sidebar__footer">
        <div className="density-toggle" role="group" aria-label="Densité de l’interface"><button className={density === "compact" ? "active" : ""} onClick={() => setDensity("compact")}>Compact</button><button className={density === "comfortable" ? "active" : ""} onClick={() => setDensity("comfortable")}>Confort</button></div>
        <div className="theme-toggle" role="group" aria-label="Thème de l’interface"><button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>Clair</button><button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>Sombre</button></div>
        <span className="auth-state"><i/> Lecture seule</span>
      </footer>
    </aside>

    <header className="app-topbar">
      <button className="brand-button mobile-brand" onClick={() => navigate("/more")} aria-label="Menu"><BrandMark/><span><strong>Desk Futures</strong><small>{humanSessionLabel(data?.label) || "Cockpit"}</small></span></button>
      <div className="topbar-terminal-state" aria-label="État du desk">
        <span><i className="api-dot"/>LIVE</span>
        <span>SESSION <strong>{humanSessionLabel(data?.label) || "—"}</strong></span>
        <span>PHASE <strong>{phaseLabel}</strong></span>
      </div>
      {showMarketTape && <div className="terminal-market-tape" aria-label="Bande de marché">
        {marketData?.market?.length ? <div className="terminal-market-tape__track">
          {[...marketData.market, ...marketData.market].map((item, index) => <span
            className="terminal-market-tape__quote"
            key={`${item.symbol}-${index}`}
            aria-hidden={index >= marketData.market.length}
          >
            <strong>{item.symbol}</strong><b>{item.price}</b><em className={item.trend === "up" ? "positive" : item.trend === "down" ? "negative" : ""}>{item.change}</em>
          </span>)}
        </div> : <span className="terminal-market-tape__empty"><strong>Flux marché</strong><em>En attente</em></span>}
      </div>}
      <WorldClocks/>
      <form className={`global-search ${search ? "is-open" : ""}`} role="search" onSubmit={submitSearch}>
        <Icon name="search" size={16}/>
        <input ref={searchRef} aria-label="Recherche globale" placeholder="Rechercher une journée, une session ou une automatisation…" value={search} onChange={event => setSearch(event.target.value)}/>
        <kbd>/</kbd>
        {search && <div className="global-search__results" role="listbox">
          {suggestions.slice(0, 7).map((suggestion) => <button type="button" key={`${suggestion.kind}:${suggestion.to}`} onMouseDown={event => event.preventDefault()} onClick={() => openSuggestion(suggestion)}>
            <Icon name={suggestion.icon} size={14}/><span><strong>{suggestion.label}</strong><small>{suggestion.detail}</small></span><em>{suggestion.kind}</em>
          </button>)}
          {!suggestions.length && <p>Aucun résultat. Vous pouvez aussi saisir une référence technique complète.</p>}
        </div>}
      </form>
      <div className="app-topbar__actions"><button className="icon-btn theme-mode-btn" onClick={() => setTheme(value => value === "light" ? "dark" : "light")} aria-label={theme === "light" ? "Passer en mode sombre" : "Passer en mode clair"}><span>{theme === "light" ? "☀" : "☾"}</span></button><button className="icon-btn" onClick={() => setDensity(value => value === "compact" ? "comfortable" : "compact")} aria-label="Changer la densité"><Icon name="layers"/></button><button className="icon-btn notification-btn" onClick={() => navigate("/alerts")} aria-label="Alertes"><Icon name="bell"/>{!!data?.alerts?.length && <span>{data.alerts.length}</span>}</button></div>
    </header>

    <button type="button" className="mobile-context" aria-label={`Session automatique : ${phaseLabel}`} onClick={() => navigate("/sessions")}><i className="api-dot"/><strong>{phaseLabel}</strong><em>AUTO</em><span>→ {nextPhaseAt}</span></button>
    <main id="main-content" className="app-main"><OperatorNavigationTrail/><Outlet/></main>
    <nav className="bottom-nav" aria-label="Navigation mobile">{bottom.map(item => <NavLink key={item.to} to={item.to} end={item.to === "/live"} className={({ isActive }) => `bottom-nav__item ${isActive ? "active" : ""}`}><Icon name={item.icon}/><span>{item.label}</span></NavLink>)}</nav>
  </div>;
}

function WorldClocks() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const zones = [
    { label: "Paris", timeZone: "Europe/Paris" },
    { label: "New York", timeZone: "America/New_York" },
    { label: "Tokyo", timeZone: "Asia/Tokyo" },
  ];
  return <div className="world-clocks" aria-label="Horloges internationales">
    {zones.map(zone => <span key={zone.timeZone}><small>{zone.label}</small><strong>{formatClock(now, zone.timeZone)}</strong></span>)}
  </div>;
}

function formatClock(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
}

function commandSuggestions(raw: string): CommandSuggestion[] {
  const term = raw.trim();
  const q = term.toLowerCase();
  const suggestionEntries = navigationCatalog.flatMap(group => group.items.map(item => {
    const suggestion: CommandSuggestion = {
      label: item.label,
      detail: `${group.label} · ${item.description}`,
      to: item.to,
      icon: item.icon,
      kind: "page",
    };
    return [item.to, suggestion] as const;
  }));
  const staticSuggestions = [...new Map(suggestionEntries).values()];
  if (!q) return staticSuggestions.slice(0, 6);
  const matched = staticSuggestions.filter(item => `${item.label} ${item.detail} ${item.to}`.toLowerCase().includes(q));
  if (term.length < 3) return matched;
  return [
    ...matched,
    { label: "Ouvrir l’automatisation", detail: "Recherche par référence technique", to: `/operations/workflows/${encodeURIComponent(term)}`, icon: "monitor", kind: "référence" },
    { label: "Ouvrir le replay", detail: "Recherche par référence technique", to: `/replay/runs/${encodeURIComponent(term)}`, icon: "layers", kind: "référence" },
    { label: "Ouvrir la session", detail: "Recherche par référence technique", to: `/history/sessions/${encodeURIComponent(term)}`, icon: "database", kind: "référence" },
    { label: "Ouvrir l’incident", detail: "Recherche par référence technique", to: `/operations/incidents/${encodeURIComponent(term)}`, icon: "alert", kind: "référence" },
    { label: "Ouvrir l’analyse GPT", detail: "Recherche par référence technique", to: `/operations/observability?process=${encodeURIComponent(term)}`, icon: "brain", kind: "référence" }
  ];
}

function humanSessionLabel(value?: string | null) {
  if (!value) return "";
  return ({
    "Asia Open": "Session Asie",
    "NY Open": "Session New York",
    asia_open: "Session Asie",
    ny_open: "Session New York",
    full_day: "Journée continue",
  } as Record<string, string>)[value] || value.replaceAll("_", " ");
}
