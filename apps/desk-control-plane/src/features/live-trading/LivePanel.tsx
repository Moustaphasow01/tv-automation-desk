import { useId, type ReactNode } from "react";
import { FaCompress, FaExpand } from "react-icons/fa";
import { useFullscreenSurface } from "./useFullscreenSurface";

export type LivePanelProps = {
  title: string;
  className?: string;
  action?: ReactNode;
  children: ReactNode;
  expandable?: boolean;
};

export function LivePanel({
  title,
  className = "",
  action,
  children,
  expandable = true,
}: LivePanelProps) {
  const fullscreen = useFullscreenSurface<HTMLElement>();
  const titleId = useId();

  return (
    <>
      {fullscreen.expanded ? (
        <button
          type="button"
          className="lt-panel-backdrop"
          onClick={fullscreen.close}
          aria-label="Fermer le panneau"
          tabIndex={-1}
        />
      ) : null}
      <section
        ref={fullscreen.surfaceRef}
        className={`lt-panel ${className}${fullscreen.expanded ? " lt-panel--expanded" : ""}`}
        role={fullscreen.expanded ? "dialog" : undefined}
        aria-modal={fullscreen.expanded || undefined}
        aria-labelledby={fullscreen.expanded ? titleId : undefined}
        tabIndex={fullscreen.expanded ? -1 : undefined}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          {expandable ? (
            <button
              ref={fullscreen.triggerRef}
              type="button"
              className="lt-panel-expand"
              onClick={fullscreen.toggleExpanded}
              aria-expanded={fullscreen.expanded}
              aria-label={fullscreen.expanded ? `Réduire ${title}` : `Agrandir ${title}`}
            >
              {fullscreen.expanded ? <FaCompress aria-hidden="true" /> : <FaExpand aria-hidden="true" />}
            </button>
          ) : null}
          {action ? <div>{action}</div> : null}
        </header>
        <div className="lt-panel__body">{children}</div>
      </section>
    </>
  );
}
