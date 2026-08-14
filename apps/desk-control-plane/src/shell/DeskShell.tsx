import { useContext, useEffect, useMemo, useState } from "react";
import { Link, matchPath, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { IconType } from "react-icons";
import {
  FaBell,
  FaChartLine,
  FaChessRook,
  FaCircle,
  FaCog,
  FaEnvelope,
  FaFlask,
  FaGlobeEurope,
  FaListAlt,
  FaRegStar,
  FaSearch,
  FaShieldAlt,
  FaStream,
  FaTh,
  FaUserCircle
} from "react-icons/fa";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { useOperatorSession } from "@/domains/permissions/PermissionGate";
import { vnextRoutes, type VNextNavGroup } from "@/app/routes";
import { NAV_GROUP_LABELS } from "@/shell/navigation";

type DeskNavItem = {
  label: string;
  to: string;
  icon: IconType;
  badge?: string;
  group: VNextNavGroup;
};

const navIcons: Record<VNextNavGroup, IconType> = { pilotage: FaTh, live: FaChartLine, operations: FaChessRook, research: FaFlask, strategy: FaListAlt, replay: FaStream, performance: FaChartLine, execution: FaShieldAlt, governance: FaCog };
const deskNavItems: readonly DeskNavItem[] = vnextRoutes
  .filter((route) => !route.path.includes(":") && route.navigation !== false)
  .map((route) => ({ label: route.label, to: `/${route.path}`, icon: navIcons[route.navGroup], group: route.navGroup, badge: route.path === "jarvis" ? "AI" : undefined }));
const deskNavGroups = Object.entries(NAV_GROUP_LABELS).map(([group, label]) => ({
  group: group as VNextNavGroup,
  label,
  items: deskNavItems.filter((item) => item.group === group),
})).filter((group) => group.items.length);

export function DeskShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const realtime = useContext(RealtimeContext);
  const { session } = useOperatorSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const currentRoute = useMemo(
    () => vnextRoutes.find((route) => matchPath({ path: `/${route.path}`, end: true }, location.pathname)),
    [location.pathname]
  );
  useEffect(() => {
    document.title = currentRoute ? `${currentRoute.title} · Desk Control Plane` : "Desk Control Plane";
  }, [currentRoute]);
  const searchResults = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase("fr");
    if (needle.length < 2) return [];
    return deskNavItems.filter((item) => `${item.label} ${NAV_GROUP_LABELS[item.group]}`.toLocaleLowerCase("fr").includes(needle)).slice(0, 6);
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

  return (
    <div className="desk-app-shell">
      <a className="skip-link" href="#main-content">Aller au contenu principal</a>
      <aside className="desk-sidebar" aria-label="Barre latérale du desk">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true"><FaRegStar /></span>
          <div>
            <h1>DESK</h1>
            <p className="eyebrow">Portfolio Control</p>
          </div>
        </div>
        <nav className="sidebar-nav" tabIndex={0} aria-label="Navigation principale">
          {deskNavGroups.map((group) => (
            <section className="sidebar-nav-group" key={group.group}>
              <h2>{group.label}</h2>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
                >
                  <item.icon className="nav-icon" aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.badge ? <small>{item.badge}</small> : null}
                </NavLink>
              ))}
            </section>
          ))}
        </nav>
        <div className="sidebar-status-stack">
          <section>
            <p>ENVIRONNEMENT</p>
            <strong className={session?.summary.environment === "LIVE" ? "status-warn" : "status-ok"}><FaCircle aria-hidden="true" /> {session?.summary.environment ?? "INDISPONIBLE"}</strong>
          </section>
          <section>
            <p>SYSTÈME</p>
            <strong className={runtimeTone}><FaCircle aria-hidden="true" /> {realtime?.connectionStatus ?? "—"}</strong>
            <span>{realtime?.events.acceptedCount ?? 0} events · {realtime?.events.duplicateCount ?? 0} doublons</span>
          </section>
          <small>Desk Control Plane<br />version publiée par le build</small>
        </div>
      </aside>

      <div className="desk-main">
        <header className="desk-topbar">
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
        </header>

        <main className="desk-content" id="main-content" tabIndex={-1}>
          {currentRoute ? (
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

        <footer className="desk-status-footer">
          <div>
            <span className={runtimeTone}><FaCircle aria-hidden="true" /> {realtime?.connectionStatus ?? "RUNTIME"}</span>
            <span>asOf {realtime?.heartbeatLabel ?? "—"}</span>
            <span>·</span>
            <span>{realtime?.events.acceptedCount ?? 0} events reçus</span>
            <span>·</span>
            <span>dernier {realtime?.events.lastEventId ?? "—"}</span>
          </div>
          <div>
            <span>Commandes suivies : {Object.keys(realtime?.commands.commands ?? {}).length}</span>
            <span>Out-of-order : {realtime?.events.outOfOrderCount ?? 0}</span>
            <span>{realtime?.latestError ? `Runtime : ${realtime.latestError}` : "Runtime : nominal"}</span>
          </div>
        </footer>
      </div>

      <nav className="desk-bottom-nav" aria-label="Navigation mobile">
        {deskNavItems.slice(0, 4).map((route) => (
          <NavLink
            key={route.to}
            to={route.to}
            className={({ isActive }) => `bottom-nav-link${isActive ? " active" : ""}`}
          >
            {route.label}
          </NavLink>
        ))}
        <button type="button" className="bottom-nav-link" aria-expanded={mobileMenuOpen} aria-controls="mobile-full-navigation" onClick={() => setMobileMenuOpen((open) => !open)}>Plus</button>
      </nav>
      {mobileMenuOpen ? (
        <nav id="mobile-full-navigation" className="desk-mobile-drawer" aria-label="Toutes les rubriques">
          <button type="button" onClick={() => setMobileMenuOpen(false)}>Fermer</button>
          {deskNavItems.map((route) => <NavLink key={route.to} to={route.to} onClick={() => setMobileMenuOpen(false)}>{route.label}</NavLink>)}
        </nav>
      ) : null}
    </div>
  );
}
