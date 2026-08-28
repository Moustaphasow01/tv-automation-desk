import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, matchPath, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  FaBell,
  FaAngleDoubleLeft,
  FaAngleDoubleRight,
  FaBolt,
  FaChartBar,
  FaClipboardList,
  FaCircle,
  FaCog,
  FaEnvelope,
  FaExclamationTriangle,
  FaFileInvoiceDollar,
  FaFlask,
  FaGlobeEurope,
  FaListAlt,
  FaPlayCircle,
  FaProjectDiagram,
  FaRobot,
  FaSearch,
  FaShieldAlt,
  FaTh,
  FaUserCircle,
  FaWallet
} from "react-icons/fa";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { useOperatorSession } from "@/domains/permissions/PermissionGate";
import { vnextRoutes } from "@/app/routes";
import { DESK_NAVIGATION_SECTIONS, deskPrimaryNavigation, NAV_GROUP_LABELS, type DeskNavigationIcon } from "@/shell/navigation";
import { presentConnectionStatus } from "@/design-system/labels";
import { DeskBrand } from "@/shell/DeskBrand";
import { DeskCommandPalette } from "@/shell/DeskCommandPalette";
import "@/shell/desk-shell-evolution.css";

const navIcons = {
  overview: FaTh,
  live: FaBolt,
  decisions: FaFileInvoiceDollar,
  portfolio: FaWallet,
  risk: FaShieldAlt,
  strategies: FaListAlt,
  research: FaFlask,
  replay: FaPlayCircle,
  performance: FaChartBar,
  providers: FaProjectDiagram,
  incidents: FaExclamationTriangle,
  audit: FaClipboardList,
  jarvis: FaRobot,
  settings: FaCog,
} satisfies Record<DeskNavigationIcon, typeof FaTh>;

export function DeskShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const realtime = useContext(RealtimeContext);
  const { session } = useOperatorSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const previousPathnameRef = useRef(location.pathname);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileMenuCloseRef = useRef<HTMLButtonElement>(null);
  const mobileMenuDrawerRef = useRef<HTMLElement>(null);
  const [liveSidebarCollapsed, setLiveSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const currentRoute = useMemo(
    () => vnextRoutes.find((route) => matchPath({ path: `/${route.path}`, end: true }, location.pathname)),
    [location.pathname]
  );
  useEffect(() => {
    document.title = currentRoute ? `${currentRoute.title} · Desk Control Plane` : "Desk Control Plane";
  }, [currentRoute]);
  useLayoutEffect(() => {
    if (previousPathnameRef.current === location.pathname) return;
    previousPathnameRef.current = location.pathname;
    setMobileMenuOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const drawer = mobileMenuDrawerRef.current;
    const shell = drawer?.closest(".desk-app-shell");
    const siblings = shell ? [...shell.children].filter((node) => node !== drawer && node instanceof HTMLElement) as HTMLElement[] : [];
    siblings.forEach((node) => node.setAttribute("inert", ""));
    mobileMenuCloseRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileMenuOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const focusable = [...drawer.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1) as HTMLElement;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      siblings.forEach((node) => node.removeAttribute("inert"));
      mobileMenuTriggerRef.current?.focus();
    };
  }, [mobileMenuOpen]);
  const searchResults = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase("fr");
    if (needle.length < 2) return [];
    return deskPrimaryNavigation.filter((item) => `${item.label} ${item.routeLabel} ${NAV_GROUP_LABELS[item.group]}`.toLocaleLowerCase("fr").includes(needle)).slice(0, 6);
  }, [searchQuery]);
  const submitSearch = () => {
    const target = searchResults[0];
    if (!target) return;
    navigate(target.to);
    setSearchQuery("");
  };
  const runtimeTone = realtime?.connectionStatus === "FAILED" || realtime?.connectionStatus === "RECONNECTING" ? "status-warn" : "status-ok";
  const currentDate = realtime?.now
    ? new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      }).format(realtime.now)
    : "—";
  const isGoldenCommandCenter = currentRoute?.path === "command-center";
  const isGoldenLiveTrading = currentRoute?.path === "live";
  const isGoldenStrategyCenter = currentRoute?.path === "strategies";
  const isGoldenResearchLab = currentRoute?.path === "research";
  const isGoldenRiskCenter = currentRoute?.path === "risk";
  const isGoldenOrdersHumanGate = currentRoute?.path === "orders";
  const isGoldenPortfolio = currentRoute?.path === "portfolio";
  const isGoldenExecutionProviders = currentRoute?.path === "execution/providers";
  const isGoldenIncidentsOperations = currentRoute?.path === "execution/incidents";
  const isGoldenPerformance = currentRoute?.path === "performance";
  const isGoldenReplay = currentRoute?.path === "replay";
  const isGoldenSurface = isGoldenCommandCenter || isGoldenLiveTrading || isGoldenStrategyCenter || isGoldenResearchLab
    || isGoldenRiskCenter || isGoldenOrdersHumanGate || isGoldenPortfolio || isGoldenExecutionProviders
    || isGoldenIncidentsOperations || isGoldenPerformance || isGoldenReplay;
  const visibleDeskNavItems = deskPrimaryNavigation;
  const visibleNavSections = DESK_NAVIGATION_SECTIONS
    .map((section) => ({ section, items: visibleDeskNavItems.filter((item) => item.section === section) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className={`desk-app-shell${isGoldenCommandCenter ? " desk-app-shell--command-center" : ""}${isGoldenLiveTrading ? " desk-app-shell--live-trading" : ""}${isGoldenLiveTrading && liveSidebarCollapsed ? " desk-app-shell--live-collapsed" : ""}${isGoldenStrategyCenter ? " desk-app-shell--strategy-center" : ""}${isGoldenResearchLab ? " desk-app-shell--research-lab" : ""}${isGoldenRiskCenter ? " desk-app-shell--risk-center" : ""}${isGoldenOrdersHumanGate ? " desk-app-shell--orders-human-gate" : ""}${isGoldenPortfolio ? " desk-app-shell--portfolio" : ""}${isGoldenExecutionProviders ? " desk-app-shell--execution-providers" : ""}${isGoldenIncidentsOperations ? " desk-app-shell--incidents-operations" : ""}${isGoldenPerformance ? " desk-app-shell--performance" : ""}${isGoldenReplay ? " desk-app-shell--replay" : ""}`}>
      <a className="skip-link" href="#main-content">Aller au contenu principal</a>
      <aside className="desk-sidebar" aria-label="Barre latérale du desk">
        <div className="brand-block">
          <DeskBrand />
        </div>
        <DeskCommandPalette destinations={deskPrimaryNavigation.map((item) => ({ label: item.label, route: item.to, group: item.section, keywords: `${item.routeLabel} ${NAV_GROUP_LABELS[item.group]}` }))} />
        <nav className="sidebar-nav" tabIndex={0} aria-label="Navigation principale">
          {visibleNavSections.map(({ section, items }) => (
            <div className="sidebar-nav-group" key={section}>
              <h2>{section}</h2>
              {items.map((item) => {
                const Icon = navIcons[item.icon];
                return (
                <NavLink key={item.to} to={item.to} aria-label={item.label} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
                  <Icon className="nav-icon" aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        {isGoldenLiveTrading ? <button className="live-sidebar-collapse" type="button" aria-label={liveSidebarCollapsed ? "Déployer la navigation" : "Réduire la navigation"} aria-pressed={liveSidebarCollapsed} onClick={() => setLiveSidebarCollapsed((value) => !value)}>{liveSidebarCollapsed ? <FaAngleDoubleRight /> : <FaAngleDoubleLeft />}<span>{liveSidebarCollapsed ? "Déployer" : "Réduire"}</span></button> : null}
        <div className="sidebar-status-stack">
          <section>
            <p>ENVIRONNEMENT</p>
            <strong className={session?.summary.environment === "LIVE" ? "status-warn" : "status-ok"}><FaCircle aria-hidden="true" /> {session?.summary.environment ?? "INDISPONIBLE"}</strong>
          </section>
          <section>
            <p>SYSTÈME</p>
            <strong className={runtimeTone}><FaCircle aria-hidden="true" /> {realtime?.connectionStatus ? presentConnectionStatus(realtime.connectionStatus).label : "—"}</strong>
            <span>{realtime?.events.acceptedCount ?? 0} events · {realtime?.events.duplicateCount ?? 0} doublons</span>
          </section>
          <small>Desk Control Plane<br />version publiée par le build</small>
        </div>
      </aside>

      <div className="desk-main">
        {!isGoldenSurface ? <header className="desk-topbar">
          <div className="topbar-time">
            <strong>{realtime?.heartbeatLabel ?? "—"} CET</strong>
            <span>{currentDate}</span>
          </div>
          <form className="topbar-search" role="search" onSubmit={(event) => { event.preventDefault(); submitSearch(); }}>
            <FaSearch aria-hidden="true" />
            <input aria-label="Rechercher un écran" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Rechercher un écran ou un espace…" autoComplete="off" />
            {searchResults.length ? (
              <div className="topbar-search-results" role="listbox" aria-label="Résultats de navigation">
                {searchResults.map((item) => <button key={item.to} type="button" role="option" onClick={() => { navigate(item.to); setSearchQuery(""); }}><span>{item.label}</span><small>{NAV_GROUP_LABELS[item.group]}</small></button>)}
              </div>
            ) : null}
          </form>
          <div className="market-tape" role="status" aria-label="État du flux temps réel">
            <article className={`market-tick ${runtimeTone}`}>
              <strong>ÉVÉNEMENTS</strong>
              <span>{realtime?.events.acceptedCount ?? "—"}</span>
              <small>{realtime?.heartbeatLabel ? `asOf ${realtime.heartbeatLabel}` : "source indisponible"}</small>
            </article>
          </div>
          <div className="topbar-ops">
            <span className="timezone-chip"><FaGlobeEurope aria-hidden="true" />Europe/Paris</span>
            <strong><FaCircle aria-hidden="true" />OPÉRATIONNEL</strong>
            <span className="notification-chip" title="Notifications indisponibles"><FaBell aria-hidden="true" /><small>—</small></span>
            <span className="notification-chip" title="Messages indisponibles"><FaEnvelope aria-hidden="true" /><small>—</small></span>
            <span className="user-chip"><FaUserCircle aria-hidden="true" /><span>{session?.principal.displayName ?? "Session indisponible"}<small>{session?.principal.roles.join(", ") || "—"}</small></span></span>
          </div>
        </header> : null}

        <main className="desk-content" id="main-content" tabIndex={-1}>
          {currentRoute && !isGoldenSurface ? (
            <nav className="desk-breadcrumbs" aria-label="Fil d’Ariane">
              <Link to="/command-center">Desk</Link>
              <span aria-hidden="true">/</span>
              <span>{NAV_GROUP_LABELS[currentRoute.navGroup]}</span>
              <span aria-hidden="true">/</span>
              <strong aria-current="page">{currentRoute.label}</strong>
            </nav>
          ) : null}
          <Outlet />
        </main>

        {!isGoldenSurface ? <footer className="desk-status-footer">
          <div>
            <span className={runtimeTone}><FaCircle aria-hidden="true" /> {realtime?.connectionStatus ? presentConnectionStatus(realtime.connectionStatus).label : "Runtime"}</span>
            <span>asOf {realtime?.heartbeatLabel ?? "—"}</span>
            <span>·</span>
            <span>{realtime?.events.acceptedCount ?? 0} événements reçus</span>
            <span>·</span>
            <span>dernier {realtime?.events.lastEventId ?? "—"}</span>
          </div>
          <div>
            <span>Commandes suivies : {Object.keys(realtime?.commands.commands ?? {}).length}</span>
            <span>Hors-ordre : {realtime?.events.outOfOrderCount ?? 0}</span>
            <span>{realtime?.latestError ? `Runtime : ${realtime.latestError}` : "Runtime : nominal"}</span>
          </div>
        </footer> : null}
      </div>

      <nav className="desk-bottom-nav" aria-label="Navigation mobile">
        {deskPrimaryNavigation.filter((route) => route.mobile).map((route) => (
          <NavLink
            key={route.to}
            to={route.to}
            className={({ isActive }) => `bottom-nav-link${isActive ? " active" : ""}`}
          >
            {route.label}
          </NavLink>
        ))}
        <button ref={mobileMenuTriggerRef} type="button" className="bottom-nav-link" aria-haspopup="dialog" aria-expanded={mobileMenuOpen} aria-controls="mobile-full-navigation" onClick={() => setMobileMenuOpen((open) => !open)}>Plus</button>
      </nav>
      {mobileMenuOpen ? (
        <aside ref={mobileMenuDrawerRef} id="mobile-full-navigation" className="desk-mobile-drawer" role="dialog" aria-modal="true" aria-label="Toutes les rubriques">
          <button ref={mobileMenuCloseRef} type="button" onClick={() => setMobileMenuOpen(false)}>Fermer</button>
          <nav aria-label="Toutes les rubriques">
            {deskPrimaryNavigation.map((route) => <NavLink key={route.to} to={route.to} onClick={() => setMobileMenuOpen(false)}>{route.label}</NavLink>)}
          </nav>
        </aside>
      ) : null}
    </div>
  );
}
