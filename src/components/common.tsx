import { useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode, type SVGProps } from "react";

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

export function LoadingView({
  title = "Chargement des données réelles",
  message = "Le Desk rassemble les dernières informations disponibles.",
  source = "Données du Desk"
}: {
  title?: string;
  message?: string;
  source?: string;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 4_000);
    return () => window.clearTimeout(timer);
  }, []);
  return <section className="view loading-view" aria-live="polite">
    <article className="card loading-panel">
      <div>
        <span className="eyebrow">Actualisation</span>
        <h1>{title}</h1>
        <p>{slow ? "Le backend met plus de temps que prévu. La page restera sur données réelles ou passera en erreur si le timeout client est atteint." : message}</p>
      </div>
      <DataSourceBadge label={source}/>
    </article>
    <div className="skeleton loading-hero"/>
    <div className="skeleton loading-row"/>
    <div className="skeleton loading-row"/>
  </section>;
}

export function ErrorView({ title = "Impossible de charger le Desk", message, retry }: { title?: string; message: string; retry: () => void }) {
  return <section className="view"><div className="card empty-state error-state"><div className="empty-state__icon"><Icon name="alert"/></div><h1>{title}</h1><p>{message}</p><button className="primary-btn" onClick={retry}>Réessayer</button></div></section>;
}

export function DataSourceBadge({ label = "POSTGRES", detail = "données réelles" }: { label?: string; detail?: string }) {
  return <span className="data-source-badge"><Icon name="database" size={13}/><strong>{label}</strong><small>{detail}</small></span>;
}

export function InlineStateCard({ tone = "info", code: _code, title, text, action }: { tone?: StatusTone; code: string; title: string; text: string; action?: ReactNode }) {
  return <Card className={`inline-state-card inline-state-card--${tone}`}>
    <div><h3>{title}</h3><p>{text}</p></div>{action}
  </Card>;
}
