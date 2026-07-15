import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { BrandMark, Icon, type IconName } from "@/components/common";
import { useDeskContext } from "@/context/DeskContext";
import { useDeskSession } from "@/hooks/useDesk";

const bottom: Array<{ to: string; label: string; icon: IconName }> = [
  { to: "/live", label: "Live", icon: "live" },
  { to: "/master", label: "Master", icon: "master" },
  { to: "/monitors", label: "Monitors", icon: "monitor" },
  { to: "/timeline", label: "Journal", icon: "timeline" },
  { to: "/more", label: "Plus", icon: "menu" }
];

const menu: Array<{ to: string; label: string; icon: IconName }> = [
  { to: "/live", label: "Live Desk", icon: "live" },
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
